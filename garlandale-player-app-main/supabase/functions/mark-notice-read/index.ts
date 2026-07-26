// supabase/functions/mark-notice-read/index.ts
//
// Player-facing endpoint: records that the calling player has read a
// specific notice. Deliberately writes using the CALLER's own JWT
// (not the service role) - the notice_reads_insert_own RLS policy
// (player_id = current_player_id()) is the actual enforcement here,
// so a player can only ever mark their own reads, never anyone else's.
// This is the opposite pattern from update-my-profile, which needed
// service-role writes for a column whitelist RLS can't express; a
// straightforward "row belongs to me" check is exactly what RLS is
// built for, so there's no need to bypass it here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit } from "../_shared/rate-limit.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
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

  const { data: playerId, error: rpcErr } = await callerClient.rpc("current_player_id");
  if (rpcErr || !playerId) {
    return new Response(JSON.stringify({ error: "No linked player account for this user" }), {
      status: 403,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Rate-limit table has no RLS policies - only the service role can
  // touch it - so a separate admin client is needed here purely for this
  // check, even though the actual write below uses the caller's own JWT.
  const adminClientForRateLimit = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const rl = await checkRateLimit(adminClientForRateLimit, userData.user.id, "mark-notice-read", {
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

  // upsert with ignoreDuplicates: re-marking an already-read notice is a
  // harmless no-op, not an error - the client doesn't need to track which
  // notices it's already reported.
  const { error: insertErr } = await callerClient
    .from("notice_reads")
    .upsert(
      { player_id: playerId, notice_id: noticeId },
      { onConflict: "player_id,notice_id", ignoreDuplicates: true }
    );

  if (insertErr) {
    return new Response(JSON.stringify({ error: insertErr.message }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
