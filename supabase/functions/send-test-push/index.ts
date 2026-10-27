// supabase/functions/send-test-push/index.ts
//
// Player-facing "Send me a test notification" button on Profile. Sends one
// notification to every device the CALLER has turned notifications on for,
// and nobody else - there is no way to name another user. Useful for anyone
// checking their phone is set up, and for the club checking the whole chain
// (keys, service worker, push services) works before real notices go out.
//
// Returns { sent, removed, failed }: removed counts devices the push
// service said no longer exist, which are deleted as part of the send.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.js";
import { checkRateLimit } from "../_shared/rate-limit.js";
import { sendToUser } from "../_shared/webpush.js";

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
  // A test is a one-off; a handful per 10 minutes is plenty.
  const rl = await checkRateLimit(adminClient, userData.user.id, "send-test-push", { maxRequests: 5, windowSeconds: 600 });
  if (!rl.allowed) return json({ error: "That's a few tests already - try again in a few minutes." }, 429);

  try {
    const result = await sendToUser(adminClient, userData.user.id, {
      title: "Garlandale FC",
      body: "Test notification – notifications are working on this device.",
      url: "profile.html",
      tag: "gfc-test",
    }, { ttl: 600, urgency: "high" });
    return json(result);
  } catch (err) {
    console.error("send-test-push failed", err);
    return json({ error: "Couldn't send a test notification right now." }, 500);
  }
});
