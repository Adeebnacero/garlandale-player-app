// supabase/functions/get-my-account/index.ts
//
// Player-facing endpoint: what kind of account the caller has.
//
//   GET -> { type: "guardian" }
//        | { type: "supporter", supporter: { fullName, phone, email, status, follows } }
//        | { type: "none" }
//        plus clubEmail (for "contact the club" messages)
//
// Every page uses this to decide between the guardian and supporter views,
// and to send supporters who aren't approved yet to the waiting screen.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.js";
import { checkRateLimit } from "../_shared/rate-limit.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const CORS_HEADERS = buildCorsHeaders(req, "GET, OPTIONS");
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS_HEADERS });
  if (req.method !== "GET") return json({ error: "Use GET" }, 405);

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
  const userId = userData.user.id;

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const rl = await checkRateLimit(adminClient, userId, "get-my-account", { maxRequests: 60, windowSeconds: 60 });
  if (!rl.allowed) return json({ error: "Too many requests - please slow down." }, 429);

  const { data: settings } = await adminClient.from("club_settings").select("reply_to_email, sender_email").eq("id", 1).maybeSingle();
  const clubEmail = settings?.reply_to_email || settings?.sender_email || "";

  const { data: playerIds } = await callerClient.rpc("current_player_ids");
  if (playerIds && playerIds.length > 0) return json({ type: "guardian", clubEmail });

  const { data: s } = await adminClient.from("supporters")
    .select("full_name, phone, email, status, follows").eq("auth_user_id", userId).maybeSingle();
  if (!s) return json({ type: "none", clubEmail });
  return json({
    type: "supporter",
    clubEmail,
    supporter: { fullName: s.full_name, phone: s.phone, email: s.email, status: s.status, follows: s.follows || [] },
  });
});
