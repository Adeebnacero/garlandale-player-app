// supabase/functions/get-my-fixtures/index.ts
//
// Player-facing endpoint: returns upcoming club fixtures FILTERED to the
// calling player's own age group (default assumption, confirm if wrong:
// "Over 40" is treated as a flag on top of the normal age group, not a
// separate division - so an Over-40 player still matches on their normal
// computed age group, e.g. "Seniors", not a distinct "Over 40" bucket).
//
// Matching is normalized (trimmed + case-insensitive) rather than an exact
// database equality check, since matches.age_group is free text entered
// in the admin app and its exact conventions weren't confirmed - this
// trades a little query efficiency for resilience against minor
// formatting differences ("U9" vs "u9 " vs "U9 ").
//
// "Upcoming" filtering (match_date >= today) still happens here in the
// API layer, not in the RLS policy - the policy (matches_select_for_players)
// intentionally allows seeing all fixtures, past and future; trimming to
// just what's relevant for display is this endpoint's job.

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

  // Confirm the caller is a linked player at all - this endpoint doesn't
  // need WHICH player, just that they're one, since fixtures aren't
  // player-scoped.
  const { data: playerId, error: rpcErr } = await callerClient.rpc("current_player_id");
  if (rpcErr || !playerId) {
    return new Response(JSON.stringify({ error: "No linked player account for this user" }), {
      status: 403,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const rl = await checkRateLimit(adminClient, userData.user.id, "get-my-fixtures");
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests - please slow down." }), {
      status: 429,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Need the player's own age group to filter fixtures - reuses the same
  // tested computeAgeGroup() logic as get-my-profile, so the two stay
  // consistent with each other by construction, not by coincidence.
  const { data: player, error: playerErr } = await adminClient
    .from("players")
    .select("dob, age_group_override")
    .eq("id", playerId)
    .single();

  if (playerErr || !player) {
    return new Response(JSON.stringify({ error: "Player record not found" }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const myAgeGroup = (player.age_group_override || computeAgeGroup(player.dob)).trim().toLowerCase();

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const { data: matches, error: matchesErr } = await adminClient
    .from("matches")
    .select(
      "id, opponent, home_away, venue, match_date, kickoff_time, division, competition, age_group"
    )
    .gte("match_date", today)
    .order("match_date", { ascending: true })
    .order("kickoff_time", { ascending: true })
    .limit(50); // fetch generously; age-group filtering below trims to what's actually relevant

  if (matchesErr) {
    return new Response(JSON.stringify({ error: matchesErr.message }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const filtered = (matches ?? [])
    .filter((m) => (m.age_group ?? "").trim().toLowerCase() === myAgeGroup)
    .slice(0, 10);

  return new Response(JSON.stringify({ fixtures: filtered }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
