// supabase/functions/mark-messages-read/index.ts
//
// Player-facing: POST { ids: [...] } marks those messages read, once the
// Messages page has shown them. Only messages for the caller's OWN linked
// children are touched - any other id is silently ignored - and a message
// already read keeps its first read time (that's what Club Management's
// "Read" column shows).
//
// Ids rather than "mark everything": a message that arrives while the page
// is open stays unread until it's actually been shown.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.js";
import { checkRateLimit } from "../_shared/rate-limit.js";
import { cleanIds } from "../_shared/my-messages.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const CORS_HEADERS = buildCorsHeaders(req, "POST, OPTIONS");
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const rl = await checkRateLimit(adminClient, userData.user.id, "mark-messages-read", { maxRequests: 30, windowSeconds: 60 });
  if (!rl.allowed) return json({ error: "Too many requests - please slow down." }, 429);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const ids = cleanIds(body.ids);
  if (!ids) return json({ error: "Send the ids of the messages shown" }, 400);

  const { data: playerIds, error: rpcErr } = await callerClient.rpc("current_player_ids");
  if (rpcErr || !playerIds || playerIds.length === 0) return json({ error: "No linked player accounts for this user" }, 403);

  const { data, error } = await adminClient
    .from("player_messages")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .in("player_id", playerIds)
    .is("read_at", null)
    .select("id");
  if (error) {
    console.error("mark-messages-read: update failed", error);
    return json({ error: "Could not mark messages as read" }, 500);
  }
  return json({ marked: (data || []).length });
});
