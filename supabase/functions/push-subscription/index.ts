// supabase/functions/push-subscription/index.ts
//
// Player-facing endpoint for turning push notifications on and off on one
// device:
//   GET    -> { publicKey } - the VAPID public key the browser needs to
//             subscribe. Served from the same secret the sender uses, so
//             the app and the server can never disagree about it.
//   POST   { subscription } - saves this device for the caller. If the
//             same device was saved for someone else (shared phone), it
//             moves to the caller.
//   DELETE { endpoint } - removes this device, only if it's the caller's.
//
// Any signed-in Player Portal user may save a device. WHO actually gets a
// given notification is decided at send time (age groups, supporters), not
// here, so this needs no player/supporter lookup.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.js";
import { checkRateLimit } from "../_shared/rate-limit.js";
import { checkSubscription } from "../_shared/webpush.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// More than this many devices for one login is almost certainly stale
// rows (new phones over the years); the least recently seen are dropped.
const MAX_DEVICES_PER_USER = 10;

Deno.serve(async (req) => {
  const CORS_HEADERS = buildCorsHeaders(req, "GET, POST, DELETE, OPTIONS");
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS_HEADERS });
  if (!["GET", "POST", "DELETE"].includes(req.method)) return json({ error: "Use GET, POST or DELETE" }, 405);

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
  const userId = userData.user.id;

  if (req.method === "GET") {
    const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    if (!publicKey) return json({ error: "Notifications aren't set up on the server yet." }, 503);
    return json({ publicKey });
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const rl = await checkRateLimit(adminClient, userId, "push-subscription", { maxRequests: 20, windowSeconds: 60 });
  if (!rl.allowed) return json({ error: "Too many requests - please slow down." }, 429);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  if (req.method === "DELETE") {
    const endpoint = body.endpoint;
    if (typeof endpoint !== "string") return json({ error: "Missing endpoint" }, 400);
    const { error } = await adminClient
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .eq("auth_user_id", userId);
    if (error) {
      console.error("push-subscription: delete failed", error);
      return json({ error: "Could not turn notifications off - please try again." }, 500);
    }
    return json({ ok: true });
  }

  // POST - save this device.
  const check = checkSubscription(body.subscription);
  if (!check.ok) return json({ error: check.error }, 400);

  const now = new Date().toISOString();
  const { error: upsertErr } = await adminClient
    .from("push_subscriptions")
    .upsert({
      auth_user_id: userId,
      endpoint: check.endpoint,
      p256dh: check.p256dh,
      auth: check.auth,
      user_agent: (req.headers.get("User-Agent") || "").slice(0, 300),
      last_seen_at: now,
      failure_count: 0,
    }, { onConflict: "endpoint" });
  if (upsertErr) {
    console.error("push-subscription: save failed", upsertErr);
    return json({ error: "Could not turn notifications on - please try again." }, 500);
  }

  // Keep the newest few devices for this login.
  const { data: rows } = await adminClient
    .from("push_subscriptions")
    .select("id")
    .eq("auth_user_id", userId)
    .order("last_seen_at", { ascending: false });
  const stale = (rows || []).slice(MAX_DEVICES_PER_USER).map((r) => r.id);
  if (stale.length) await adminClient.from("push_subscriptions").delete().in("id", stale);

  return json({ ok: true });
});
