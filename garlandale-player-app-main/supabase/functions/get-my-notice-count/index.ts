// supabase/functions/get-my-notice-count/index.ts
//
// Player-facing endpoint: returns just the unread notice count, for the
// drawer badge shown on every page. Deliberately its own tiny endpoint
// rather than reusing get-my-notices, since every page needs this on
// load (not just the notices page itself) and shouldn't have to fetch
// full notice bodies just to show a number.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit } from "../_shared/rate-limit.js";
import { computeAgeGroup } from "../_shared/billing.js";

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

  const { data: playerId, error: rpcErr } = await callerClient.rpc("current_player_id");
  if (rpcErr || !playerId) {
    return new Response(JSON.stringify({ error: "No linked player account for this user" }), {
      status: 403,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const rl = await checkRateLimit(adminClient, userData.user.id, "get-my-notice-count");
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests - please slow down." }), {
      status: 429,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

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

  const [{ data: allNotices }, { data: reads }] = await Promise.all([
    adminClient
      .from("notices")
      .select("id, target_age_group")
      .order("posted_at", { ascending: false })
      .limit(50), // keep in sync with get-my-notices' limit
    adminClient.from("notice_reads").select("notice_id").eq("player_id", playerId),
  ]);

  const readIds = new Set((reads ?? []).map((r) => r.notice_id));
  const unread = (allNotices ?? []).filter((n) => {
    const target = (n.target_age_group ?? "").trim().toLowerCase();
    const relevant = target === "" || target === "all" || target === myAgeGroup;
    return relevant && !readIds.has(n.id);
  }).length;

  return new Response(JSON.stringify({ unread }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
