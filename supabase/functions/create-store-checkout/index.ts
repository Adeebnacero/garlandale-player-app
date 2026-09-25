// supabase/functions/create-store-checkout/index.ts
//
// Player-facing endpoint: turns the guardian's cart into an order and
// starts a Yoco hosted checkout for it.
//
//   POST { items: [{ productId, sizeId, quantity }], name, phone, email,
//          agreedToPolicy: true }
//   -> { redirectUrl, orderId }
//
// The cart only says WHAT and HOW MANY. Prices, the admin fee, stock,
// whether the shop is open and whether pre-orders have closed are all
// decided by the database function store_create_order(), so an edited
// cart can't change what anyone pays. Stock is only reduced once Yoco
// confirms payment (store_mark_paid(), called by yoco-webhook).
//
// This is a STORE payment: the Yoco metadata carries kind: "store_order"
// and an orderId, and never a playerId, so it can never be recorded as a
// fee payment (see yoco-webhook).
//
// Uses the same secrets as create-yoco-checkout: YOCO_SECRET_KEY, APP_URL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.js";
import { checkRateLimit } from "../_shared/rate-limit.js";
import { parseCheckoutBody } from "../_shared/store.js";
import { YOCO_API_HOST } from "../_shared/yoco.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YOCO_SECRET_KEY = Deno.env.get("YOCO_SECRET_KEY") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "";

Deno.serve(async (req) => {
  const CORS_HEADERS = buildCorsHeaders(req, "POST, OPTIONS");
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  if (!YOCO_SECRET_KEY || !APP_URL) return json({ error: "Payments are not configured yet - contact the club." }, 500);

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
  const userId = userData.user.id;

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const rl = await checkRateLimit(adminClient, userId, "create-store-checkout", { maxRequests: 10, windowSeconds: 60 });
  if (!rl.allowed) return json({ error: "Too many requests - please slow down." }, 429);

  // Only Player Portal accounts linked to a player can buy (the same
  // accounts that can see anything else in the app).
  const { count: linkCount, error: linkErr } = await adminClient
    .from("guardian_players")
    .select("player_id", { count: "exact", head: true })
    .eq("auth_user_id", userId);
  if (linkErr) {
    console.error("create-store-checkout: failed to check guardian link", linkErr);
    return json({ error: "Could not start checkout - please try again." }, 500);
  }
  if (!linkCount) return json({ error: "This account isn't linked to a player, so it can't use the shop." }, 403);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const parsed = parseCheckoutBody(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  // Price, check and save the order. Any problem with the cart comes back
  // as a plain-language error from the database (sold out, closed, etc.).
  const { data: order, error: orderErr } = await adminClient.rpc("store_create_order", {
    p_user: userId,
    p_name: parsed.name,
    p_phone: parsed.phone,
    p_email: parsed.email,
    p_items: parsed.items,
  });
  if (orderErr) {
    // P0001 = a "raise exception" from store_create_order: safe to show.
    if (orderErr.code === "P0001") return json({ error: orderErr.message }, 400);
    console.error("create-store-checkout: store_create_order failed", orderErr);
    return json({ error: "Could not start checkout - please try again." }, 500);
  }

  const orderId: string = order.order_id;
  const amountCents = Math.round(Number(order.total) * 100);

  let yocoRes: Response;
  try {
    yocoRes = await fetch(`${YOCO_API_HOST}/checkouts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${YOCO_SECRET_KEY}` },
      body: JSON.stringify({
        amount: amountCents,
        currency: "ZAR",
        successUrl: `${APP_URL}/shop.html?paid=${orderId}`,
        cancelUrl: `${APP_URL}/shop.html?checkout=cancelled`,
        failureUrl: `${APP_URL}/shop.html?checkout=failed`,
        metadata: {
          kind: "store_order",
          orderId,
          customerName: parsed.name,
        },
      }),
    });
  } catch (e) {
    console.error("create-store-checkout: network error calling Yoco", e);
    return json({ error: "Could not reach the payment provider - try again shortly." }, 502);
  }

  const yocoBody = await yocoRes.json().catch(() => null);
  if (!yocoRes.ok || !yocoBody?.redirectUrl) {
    console.error("create-store-checkout: Yoco rejected the checkout", yocoRes.status, yocoBody);
    return json({ error: "Could not start payment - try again shortly." }, 502);
  }

  const { error: saveErr } = await adminClient
    .from("store_orders")
    .update({ yoco_checkout_id: yocoBody.id ?? null })
    .eq("id", orderId);
  if (saveErr) console.error("create-store-checkout: couldn't save Yoco checkout id (non-fatal)", saveErr);

  return json({ redirectUrl: yocoBody.redirectUrl, orderId });
});
