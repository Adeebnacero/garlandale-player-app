// supabase/functions/get-my-payments/index.ts
//
// Player-facing endpoint: returns the resolved player's own payment
// history (date, amount, method), newest first. Read-only, same
// auth/resolve/rate-limit pattern as get-my-fixtures and get-my-notices.
//
// Deliberately returns only display fields (date, amount, method) - not
// `reference`, which is an internal reconciliation id (Yoco's payment id,
// SnapScan transaction ref, etc.) with no reason to reach the client.
//
// This is a pure read of the same `payments` table get-my-balance and
// create-yoco-checkout already sum via billing.js - no new writes, no
// new balance math, just a different projection of existing rows for
// display purposes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.js";
import { checkRateLimit } from "../_shared/rate-limit.js";
import { resolveRequestedPlayerId } from "../_shared/resolve-player.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const CORS_HEADERS = buildCorsHeaders(req, "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
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

  const requestedPlayerId = new URL(req.url).searchParams.get("player_id");
  const resolved = await resolveRequestedPlayerId(callerClient, requestedPlayerId);
  if (!resolved.ok) {
    return new Response(JSON.stringify({ error: resolved.error }), {
      status: resolved.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
  const playerId = resolved.playerId;

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const rl = await checkRateLimit(adminClient, userData.user.id, "get-my-payments");
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests - please slow down." }), {
      status: 429,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { data: payments, error: paymentsErr } = await adminClient
    .from("payments")
    .select("date, amount, method")
    .eq("player_id", playerId)
    .order("date", { ascending: false })
    .limit(200);

  if (paymentsErr) {
    console.error("get-my-payments: failed to load payments", paymentsErr);
    return new Response(JSON.stringify({ error: "Could not load payment history - please try again." }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ payments: payments ?? [] }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
