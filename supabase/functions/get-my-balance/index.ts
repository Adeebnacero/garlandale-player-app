// supabase/functions/get-my-balance/index.ts
//
// Player-facing endpoint: returns the calling player's subscription balance
// and compliance status. Deliberately narrow and fixed-shape (no arbitrary
// filters/params from the client) - see the player app's architecture
// notes on why this exists as an Edge Function rather than letting the
// player app query Supabase's REST API directly.
//
// Auth model:
//   1. Validate the caller's JWT and resolve current_player_id() AS THE
//      CALLER (their own token, respects RLS/security-definer as normal).
//      If this comes back null, the caller isn't a linked player - reject.
//   2. Once we have a confirmed player id, switch to the service-role
//      client for the actual data reads. RLS on payments/tiers/players is
//      NOT what's protecting this data - the explicit `.eq('id', playerId)`
//      / `.eq('player_id', playerId)` filters below are. RLS stays enabled
//      on these tables as defense-in-depth for other access paths (e.g.
//      someone hitting PostgREST directly), not as this function's
//      security boundary.
//
// billing.js is copied in unmodified from the admin app (see billing.test.js
// for the 35 tests already covering this logic) - do not re-derive the
// balance math here, only adapt DB rows into the shape it expects.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { playerFinance, complianceStatus, complianceReason } from "./billing.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Browser-facing functions need explicit CORS headers, or the browser
// blocks the response before your code ever sees it (shows up client-side
// as a generic "Failed to fetch", no other detail). "*" is fine here since
// this endpoint is already gated by requiring a valid player JWT - the
// origin isn't doing any of the access control.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
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

  const { data: playerId, error: rpcErr } = await callerClient.rpc("current_player_id");
  if (rpcErr || !playerId) {
    return new Response(
      JSON.stringify({ error: "No linked player account for this user" }),
      { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // ---- Step 2: fetch the actual data, service-role, explicitly scoped ----
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const [{ data: player, error: playerErr }, { data: statusLog }, { data: payments }, { data: tiers }] =
    await Promise.all([
      adminClient
        .from("players")
        .select("id, join_date, billing_start_date, tier_id, active, documents_complete")
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
      due: finance.due,
      paid: finance.paid,
      balance: finance.balance,
      status,
      reason,
    }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
});
