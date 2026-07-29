// supabase/functions/get-my-balance/index.ts
//
// Player-facing endpoint: returns the calling player's subscription balance
// and compliance status. Deliberately narrow and fixed-shape (no arbitrary
// filters/params from the client) - see the player app's architecture
// notes on why this exists as an Edge Function rather than letting the
// player app query Supabase's REST API directly.
//
// Auth model:
//   1. Validate the caller's JWT and resolve which of their linked
//      children (current_player_ids()) this request is for, via
//      resolveRequestedPlayerId - a guardian with multiple kids passes
//      ?player_id=..., everyone else (the common single-child case) gets
//      their one linked player by default. Requesting a player_id outside
//      the caller's own linked set is rejected with 403.
//   2. Once we have a confirmed, authorized player id, switch to the
//      service-role client for the actual data reads. RLS on
//      payments/tiers/players is NOT what's protecting this data - the
//      explicit `.eq('id', playerId)` / `.eq('player_id', playerId)`
//      filters below are. RLS stays enabled on these tables as
//      defense-in-depth for other access paths (e.g. someone hitting
//      PostgREST directly), not as this function's security boundary.
//
// billing.js is copied in unmodified from the admin app (see billing.test.js
// for the 35 tests already covering this logic) - do not re-derive the
// balance math here, only adapt DB rows into the shape it expects.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.js";
import { playerFinance, complianceStatus, complianceReason } from "../_shared/billing.js";
import { checkRateLimit } from "../_shared/rate-limit.js";
import { resolveRequestedPlayerId } from "../_shared/resolve-player.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Browser-facing functions need explicit CORS headers, or the browser
// blocks the response before your code ever sees it (shows up client-side
// as a generic "Failed to fetch", no other detail). The allowed origin is
// restricted to this app's own domains (see _shared/cors.js) rather than
// "*" - the JWT check below still does the real access control, but a
// wildcard origin would let any website relay a stolen/leaked player
// token, so it's worth locking down as defense-in-depth.
Deno.serve(async (req) => {
  const CORS_HEADERS = buildCorsHeaders(req, "GET, OPTIONS");

  // Preflight: the browser sends this automatically before the real
  // request whenever an Authorization header is involved. Must return
  // 200 + the CORS headers with no body, or the real request never fires.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("Authorization") ?? "";

  // ---- Step 1: who is calling, as themselves ----
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

  const requestedPlayerId = new URL(req.url).searchParams.get("player_id");
  const resolved = await resolveRequestedPlayerId(callerClient, requestedPlayerId);
  if (!resolved.ok) {
    return new Response(JSON.stringify({ error: resolved.error }), {
      status: resolved.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
  const playerId = resolved.playerId;

  // ---- Rate limit: reject if this player has hit this endpoint too
  // often recently. Checked using the same service-role client the data
  // fetch below already needs, so no extra client creation.
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const rl = await checkRateLimit(adminClient, userData.user.id, "get-my-balance");
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests - please slow down." }), {
      status: 429,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // ---- Step 2: fetch the actual data, service-role, explicitly scoped ----
  const [{ data: player, error: playerErr }, { data: statusLog }, { data: payments }, { data: tiers }] =
    await Promise.all([
      adminClient
        .from("players")
        .select("id, name, join_date, billing_start_date, tier_id, active, documents_complete")
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

  // ---- Step 3: adapt snake_case DB rows into billing.js's expected shape ----
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
  const status = complianceStatus(mappedPlayer, mappedTiers);
  const reason = complianceReason(mappedPlayer, mappedTiers);

  return new Response(
    JSON.stringify({
      name: player.name,
      due: finance.due,
      paid: finance.paid,
      balance: finance.balance,
      status,
      reason,
    }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
});
