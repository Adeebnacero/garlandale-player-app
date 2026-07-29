// supabase/functions/mark-notice-read/index.ts
//
// Player-facing endpoint: records that the calling guardian has read a
// specific notice, on behalf of every one of their linked children the
// notice is actually relevant to (matching for_children in
// get-my-notices) - not just whichever child happens to be selected in
// the switcher. A notice with a single relevant child (the common case)
// behaves exactly as before.
//
// Now writes via the SERVICE-ROLE client rather than the caller's own
// JWT. The previous "row belongs to me" RLS policy
// (notice_reads_insert_own: player_id = current_player_id()) only ever
// let a caller write ONE player_id - insufficient once a guardian needs
// to mark a notice read for more than one linked child in the same
// request. The safety property doesn't change: current_player_ids() is
// still resolved from the caller's own JWT first, and every player_id
// written below is drawn from that same validated set - never from
// anything the client sends directly.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.js";
import { checkRateLimit } from "../_shared/rate-limit.js";
import { computeAgeGroup } from "../_shared/billing.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const CORS_HEADERS = buildCorsHeaders(req, "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
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

  const rl = await checkRateLimit(adminClient, userData.user.id, "mark-notice-read", {
    maxRequests: 60,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests - please slow down." }), {
      status: 429,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const noticeId = body.notice_id;
  if (typeof noticeId !== "string") {
    return new Response(JSON.stringify({ error: "Missing notice_id" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { data: notice, error: noticeErr } = await adminClient
    .from("notices")
    .select("target_age_group")
    .eq("id", noticeId)
    .single();

  if (noticeErr || !notice) {
    return new Response(JSON.stringify({ error: "Notice not found" }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const target = (notice.target_age_group ?? "").trim().toLowerCase();

  const { data: players, error: playersErr } = await adminClient
    .from("players")
    .select("id, dob, age_group_override")
    .in("id", playerIds);

  if (playersErr || !players) {
    return new Response(JSON.stringify({ error: "Could not load player accounts" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const relevantPlayerIds = players
    .filter((p) => {
      const ageGroup = (p.age_group_override || computeAgeGroup(p.dob)).trim().toLowerCase();
      return target === "" || target === "all" || target === ageGroup;
    })
    .map((p) => p.id);

  if (relevantPlayerIds.length === 0) {
    return new Response(
      JSON.stringify({ error: "This notice isn't relevant to any of your linked players" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // upsert with ignoreDuplicates: re-marking an already-read notice is a
  // harmless no-op, not an error - the client doesn't need to track which
  // notices it's already reported, for which child.
  const { error: insertErr } = await adminClient
    .from("notice_reads")
    .upsert(
      relevantPlayerIds.map((playerId) => ({ player_id: playerId, notice_id: noticeId })),
      { onConflict: "player_id,notice_id", ignoreDuplicates: true }
    );

  if (insertErr) {
    console.error("mark-notice-read: failed to record read receipt", insertErr);
    return new Response(JSON.stringify({ error: "Could not mark notice as read - please try again." }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
