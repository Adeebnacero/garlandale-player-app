// supabase/functions/get-my-loyalty/index.ts
//
// Player-facing endpoint: returns the calling player's loyalty card data
// (name, reg number) plus the active list of loyalty partners. Only
// returns real card data if the player is currently active - matches the
// "loyalty tab only for active players" rule as a server-side backstop,
// in case a player reaches loyalty.html directly (nav visibility alone
// is a UI nicety, not a security boundary).
//
// Note for future work: this is deliberately where a per-player QR code
// would be generated and returned, once that's built - the response
// shape here (an object keyed by concern) makes that a pure addition
// later, not a restructure.

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

  const rl = await checkRateLimit(adminClient, userData.user.id, "get-my-loyalty");
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests - please slow down." }), {
      status: 429,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { data: player, error: playerErr } = await adminClient
    .from("players")
    .select("name, reg_no, active")
    .eq("id", playerId)
    .single();

  if (playerErr || !player) {
    return new Response(JSON.stringify({ error: "Player record not found" }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  if (!player.active) {
    return new Response(JSON.stringify({ active: false }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { data: partners, error: partnersErr } = await adminClient
    .from("partners")
    .select("id, name, logo_url")
    .eq("active", true)
    .order("display_order", { ascending: true });

  if (partnersErr) {
    console.error("get-my-loyalty: failed to load partners", partnersErr);
    return new Response(JSON.stringify({ error: "Could not load loyalty card - please try again." }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      active: true,
      name: player.name,
      reg_no: player.reg_no,
      partners: partners ?? [],
    }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
});
