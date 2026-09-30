// supabase/functions/update-my-supporter/index.ts
//
// Player-facing endpoint: an approved supporter updates their own name,
// cellphone and the teams they follow. Email can't be changed here.
//
//   POST { full_name, phone, follows: ["Seniors", "U13"] } -> { ok: true }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.js";
import { checkRateLimit } from "../_shared/rate-limit.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
import { approvedSupporter, parseSupporterUpdate } from "../_shared/account.js";

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
  const userId = userData.user.id;

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const rl = await checkRateLimit(adminClient, userId, "update-my-supporter", { maxRequests: 20, windowSeconds: 60 });
  if (!rl.allowed) return json({ error: "Too many requests - please slow down." }, 429);
  if (!(await approvedSupporter(adminClient, userId))) return json({ error: "This isn’t an active supporter account." }, 403);

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const parsed = parseSupporterUpdate(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const { error } = await adminClient.from("supporters").update(parsed.row).eq("auth_user_id", userId);
  if (error) {
    console.error("update-my-supporter: failed", error);
    return json({ error: "Could not save your details - please try again." }, 500);
  }
  return json({ ok: true });
});
