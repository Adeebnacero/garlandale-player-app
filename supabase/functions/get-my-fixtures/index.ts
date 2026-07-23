// supabase/functions/get-my-fixtures/index.ts
//
// Player-facing endpoint: returns upcoming club fixtures. Per the decision
// already made (small club, not worth gating by age_group/division for
// v1), every linked player sees every upcoming fixture - so this function
// doesn't scope by player_id anywhere, it only confirms the caller IS a
// linked player before returning anything.
//
// "Upcoming" filtering (match_date >= today) happens here in the API
// layer, not in the RLS policy - the policy (matches_select_for_players)
// intentionally allows seeing all fixtures, past and future; trimming to
// just what's relevant for display is this endpoint's job.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const { data: matches, error: matchesErr } = await adminClient
    .from("matches")
    .select(
      "id, opponent, home_away, venue, match_date, kickoff_time, division, competition, age_group"
    )
    .gte("match_date", today)
    .order("match_date", { ascending: true })
    .order("kickoff_time", { ascending: true })
    .limit(10);

  if (matchesErr) {
    return new Response(JSON.stringify({ error: matchesErr.message }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ fixtures: matches ?? [] }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
