// supabase/functions/get-my-players/index.ts
//
// Returns the list of players (children) linked to the calling guardian's
// account, via current_player_ids() rather than the old single-player
// current_player_id(). The front end calls this once after sign-in to
// decide whether to show a child switcher at all (single-child accounts -
// still the overwhelming majority - see nothing new) and, if there's more
// than one, what to put in it.
//
// Deliberately returns only what a switcher UI needs (id, name, squad
// number, age group) - not balance/compliance/contact fields, which stay
// behind the existing per-child endpoints once a child is selected.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeAgeGroup } from "../_shared/billing.js";
import { checkRateLimit } from "../_shared/rate-limit.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
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

  const { data: playerIds, error: rpcErr } = await callerClient.rpc("current_player_ids");
  if (rpcErr || !playerIds || playerIds.length === 0) {
    return new Response(JSON.stringify({ error: "No linked player accounts for this user" }), {
      status: 403,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const rl = await checkRateLimit(adminClient, userData.user.id, "get-my-players");
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests - please slow down." }), {
      status: 429,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { data: players, error: playersErr } = await adminClient
    .from("players")
    .select("id, name, dob, age_group_override, squad_number")
    .in("id", playerIds);

  if (playersErr || !players) {
    return new Response(JSON.stringify({ error: "Could not load player accounts" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const result = players
    .map((p) => ({
      id: p.id,
      name: p.name,
      squad_number: p.squad_number,
      age_group: p.age_group_override || computeAgeGroup(p.dob),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return new Response(JSON.stringify({ players: result }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
