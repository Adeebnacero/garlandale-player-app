// Supabase Edge Function: manage-supporters
//
// Removes a supporter account (Club Management -> Admin -> Supporters).
//
//   POST { action: "remove", userId } -> { ok: true }
//
// Deleting the login removes the supporter record with it; past shop
// orders are kept (their login link is cleared). Only Admin, Chairman and
// Treasurer can do this, and only for supporter accounts - never for staff
// or guardian logins.
//
// Approving and declining don't need this function: Club Management calls
// the decide_supporter() database function directly.
//
// Deploy with:
//   supabase functions deploy manage-supporters

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userData, error: userErr } = await caller.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Not authenticated." }, 401);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: me } = await admin.from("staff").select("role").eq("user_id", userData.user.id).maybeSingle();
    if (!me || !["admin", "chairman", "treasurer"].includes(me.role)) {
      return json({ error: "Only an Admin, Chairman or Treasurer can manage supporters." }, 403);
    }

    const { action, userId } = await req.json();
    if (action !== "remove") return json({ error: "Unknown action." }, 400);
    if (typeof userId !== "string" || !UUID_RE.test(userId)) return json({ error: "Invalid supporter." }, 400);

    const { data: supporter } = await admin.from("supporters").select("auth_user_id").eq("auth_user_id", userId).maybeSingle();
    if (!supporter) return json({ error: "This supporter no longer exists." }, 404);
    const { data: staffRow } = await admin.from("staff").select("id").eq("user_id", userId).maybeSingle();
    if (staffRow) return json({ error: "This login belongs to a staff member; manage it under Users." }, 400);
    const { count: links } = await admin.from("guardian_players").select("player_id", { count: "exact", head: true }).eq("auth_user_id", userId);
    if (links) return json({ error: "This login is linked to a player, so it's managed from the player's profile." }, 400);

    // Clear rate-limit records first, in case that table's link to the login would block the deletion.
    await admin.from("api_rate_limits").delete().eq("user_id", userId);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      console.error("manage-supporters: delete failed", error);
      return json({ error: "Could not remove this supporter - please try again." }, 500);
    }
    return json({ ok: true });
  } catch (err) {
    console.error("manage-supporters: unexpected error", err);
    return json({ error: "Something went wrong - please try again." }, 500);
  }
});
