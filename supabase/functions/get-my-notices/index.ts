// supabase/functions/get-my-notices/index.ts
//
// Player-facing endpoint: returns the notice board, pinned items first,
// then most recent. Same auth pattern as the other endpoints - confirm
// the caller is A linked player (notices aren't player-specific, so no
// need to know WHICH one), then read with the service-role key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit } from "./rate-limit.js";

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

  const rl = await checkRateLimit(adminClient, userData.user.id, "get-my-notices");
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests - please slow down." }), {
      status: 429,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { data: notices, error: noticesErr } = await adminClient
    .from("notices")
    .select("id, title, body, category, pinned, posted_at")
    .order("pinned", { ascending: false })
    .order("posted_at", { ascending: false })
    .limit(30);

  if (noticesErr) {
    return new Response(JSON.stringify({ error: noticesErr.message }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Fetch which of these notices this player has already read, so the
  // client can show unread ones distinctly without a second round trip.
  const { data: reads } = await adminClient
    .from("notice_reads")
    .select("notice_id")
    .eq("player_id", playerId);

  const readIds = new Set((reads ?? []).map((r) => r.notice_id));
  const withReadStatus = (notices ?? []).map((n) => ({
    ...n,
    is_read: readIds.has(n.id),
  }));

  return new Response(JSON.stringify({ notices: withReadStatus }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
