// supabase/functions/create-yoco-checkout/index.ts
//
// Player-facing endpoint: computes the calling guardian's linked child's
// current amount due (reusing billing.js - the exact same math
// get-my-balance uses, never re-derived here) and creates a Yoco hosted
// Checkout session. The front end redirects the browser to the returned
// redirectUrl - Yoco's own hosted page collects card details; this app's
// Supabase project never touches them.
//
// Replaces the previous create-payfast-payment function (removed).
//
// Auth model: identical pattern to get-my-balance - resolve the caller's
// own JWT to one of their linked children via resolveRequestedPlayerId,
// then read with the service-role key, explicitly scoped to that id.
//
// Required secrets (set with `supabase secrets set`):
//   YOCO_SECRET_KEY (sk_test_... or sk_live_...), APP_URL (the player
//   app's public base URL, e.g. https://players.garlandalefc.co.za, used
//   to build successUrl/cancelUrl/failureUrl).
//
// Yoco's webhook (yoco-webhook function) is registered separately via
// Yoco's Webhooks API / Business Portal - it is not passed per-request
// the way PayFast's notify_url was.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.js";
import { playerFinance } from "../_shared/billing.js";
import { checkRateLimit } from "../_shared/rate-limit.js";
import { resolveRequestedPlayerId } from "../_shared/resolve-player.js";
import { YOCO_API_HOST } from "../_shared/yoco.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const YOCO_SECRET_KEY = Deno.env.get("YOCO_SECRET_KEY") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "";

Deno.serve(async (req) => {
  const CORS_HEADERS = buildCorsHeaders(req, "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  if (!YOCO_SECRET_KEY || !APP_URL) {
    return new Response(
      JSON.stringify({ error: "Payments are not configured yet - contact the club." }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const requestedPlayerId = typeof body.player_id === "string" ? body.player_id : null;
  const resolved = await resolveRequestedPlayerId(callerClient, requestedPlayerId);
  if (!resolved.ok) {
    return new Response(JSON.stringify({ error: resolved.error }), {
      status: resolved.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
  const playerId = resolved.playerId;

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Payments are a write-adjacent action - stricter limit than a plain read.
  const rl = await checkRateLimit(adminClient, userData.user.id, "create-yoco-checkout", {
    maxRequests: 10,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests - please slow down." }), {
      status: 429,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Identical fetch-and-map pattern to get-my-balance - do not re-derive
  // the balance math here, only reuse billing.js's playerFinance().
  const [{ data: player, error: playerErr }, { data: statusLog }, { data: payments }, { data: tiers }] =
    await Promise.all([
      adminClient
        .from("players")
        .select("id, name, join_date, billing_start_date, tier_id, active, documents_complete, email")
        .eq("id", playerId)
        .single(),
      adminClient.from("player_status_log").select("status, changed_at").eq("player_id", playerId),
      adminClient.from("payments").select("amount").eq("player_id", playerId),
      adminClient.from("tiers").select("id, name, monthly_fee"),
    ]);

  if (playerErr || !player) {
    return new Response(JSON.stringify({ error: "Player record not found" }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const mappedPlayer = {
    joinDate: player.join_date,
    billingStartDate: player.billing_start_date,
    tierId: player.tier_id,
    active: player.active,
    documentsComplete: player.documents_complete,
    statusLog: (statusLog ?? []).map((s) => ({ status: s.status, changedAt: s.changed_at })),
    payments: (payments ?? []).map((p) => ({ amount: p.amount })),
  };
  const mappedTiers = (tiers ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    monthlyFee: t.monthly_fee,
  }));

  const finance = playerFinance(mappedPlayer, mappedTiers);

  // Optional guardian-edited amount (see home.html's "Edit amount"
  // toggle) - lets someone pay a partial amount or pay ahead, instead of
  // always paying the exact computed balance due. Falls back to the
  // computed balance below when omitted, so older cached clients that
  // never send `amount` keep working exactly as before.
  const requestedAmount = typeof body.amount === "number" && Number.isFinite(body.amount)
    ? body.amount
    : null;

  let payAmount: number;
  if (requestedAmount !== null) {
    // Never trust the client's own validation - re-check the same rules
    // here regardless of what home.html already checked.
    if (requestedAmount < 2) {
      return new Response(
        JSON.stringify({ error: "The minimum payment is R2." }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
    if (requestedAmount > 10000) {
      return new Response(
        JSON.stringify({ error: "For amounts over R10,000, please contact the club directly." }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
    payAmount = requestedAmount;
  } else {
    if (finance.balance <= 0) {
      return new Response(JSON.stringify({ error: "No amount is currently due." }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    // Yoco won't accept payments under R2.
    if (finance.balance < 2) {
      return new Response(
        JSON.stringify({ error: "The amount due is below the minimum payment of R2." }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
    payAmount = finance.balance;
  }

  // Amounts are in cents for Yoco. Round to the nearest cent to avoid
  // floating point drift (e.g. 350.1 * 100 !== 35010 in float math).
  const amountCents = Math.round(payAmount * 100);

  // metadata.playerId carries the player id through Yoco and back via the
  // webhook - this is how yoco-webhook knows which player's payments row
  // to insert. checkoutRef (below) is used as our own idempotency key.
  const checkoutRef = crypto.randomUUID();

  let yocoRes: Response;
  try {
    yocoRes = await fetch(`${YOCO_API_HOST}/checkouts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${YOCO_SECRET_KEY}`,
      },
      body: JSON.stringify({
        amount: amountCents,
        currency: "ZAR",
        successUrl: `${APP_URL}/home.html?payment=success`,
        cancelUrl: `${APP_URL}/home.html?payment=cancelled`,
        failureUrl: `${APP_URL}/home.html?payment=failed`,
        // Lets a human manually checking the Yoco Business Portal / Sales
        // History identify who a payment was for at a glance, without
        // needing an API call - metadata below covers the same info but
        // isn't reliably surfaced in Yoco's own UI. displayName renders on
        // Yoco's hosted checkout page itself and in sales breakdowns;
        // price here is display-only and does not affect the amount
        // actually collected (that's still driven by `amount` above).
        externalId: playerId,
        lineItems: [
          {
            displayName: `${player.name || "Player"} — monthly fee`,
            quantity: 1,
            pricingDetails: { price: amountCents },
          },
        ],
        metadata: {
          playerId,
          checkoutRef,
          playerName: player.name || "Player",
        },
      }),
    });
  } catch (e) {
    console.error("create-yoco-checkout: network error calling Yoco", e);
    return new Response(JSON.stringify({ error: "Could not reach the payment provider - try again shortly." }), {
      status: 502,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const yocoBody = await yocoRes.json().catch(() => null);

  if (!yocoRes.ok || !yocoBody?.redirectUrl) {
    console.error("create-yoco-checkout: Yoco rejected the checkout", yocoRes.status, yocoBody);
    return new Response(JSON.stringify({ error: "Could not start payment - try again shortly." }), {
      status: 502,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ redirectUrl: yocoBody.redirectUrl }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
});
