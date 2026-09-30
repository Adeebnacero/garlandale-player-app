// supabase/functions/delete-my-account/index.ts
//
// Player-facing endpoint: a supporter deletes their own account.
//
//   POST { confirm: "DELETE" } -> { ok: true }
//
// Deletes the login, which removes the supporter record with it. Past shop
// orders are kept for the club's records (their login link is cleared).
// Guardian accounts are linked to players and are removed by the club, so
// this only works for supporter accounts (approved, waiting or declined).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.js";
import { checkRateLimit } from "../_shared/rate-limit.js";

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
  const userId = userData.user.id;

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const rl = await checkRateLimit(adminClient, userId, "delete-my-account", { maxRequests: 5, windowSeconds: 60 });
  if (!rl.allowed) return json({ error: "Too many requests - please slow down." }, 429);

  let body: { confirm?: string } = {};
  try { body = await req.json(); } catch { /* checked below */ }
  if (body?.confirm !== "DELETE") return json({ error: "Please confirm that you want to delete your account." }, 400);

  const { data: playerIds } = await callerClient.rpc("current_player_ids");
  if (playerIds && playerIds.length > 0) {
    return json({ error: "This account is linked to a player. Contact the club to close it." }, 403);
  }
  const { data: staffRow } = await adminClient.from("staff").select("id").eq("user_id", userId).maybeSingle();
  if (staffRow) return json({ error: "Staff accounts are managed in Club Management." }, 403);
  const { data: s } = await adminClient.from("supporters").select("auth_user_id").eq("auth_user_id", userId).maybeSingle();
  if (!s) return json({ error: "This isn’t a supporter account." }, 403);

  // Clear this login's rate-limit records first, in case that table's link
  // to the login would otherwise block the deletion.
  await adminClient.from("api_rate_limits").delete().eq("user_id", userId);

  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) {
    console.error("delete-my-account: failed", error);
    return json({ error: "Could not delete your account - please try again." }, 500);
  }
  return json({ ok: true });
});
