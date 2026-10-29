// Supabase Edge Function: manage-player-guardians
//
// Lets staff see and remove the Player Portal logins linked to a player.
//
//   { action: "list",   playerId }              -> { accounts: [...] }
//   { action: "remove", playerId, authUserId }  -> { success: true }
//
// "list" needs the service-role key because login emails and activation
// status live in Supabase Auth, not in a public table.
//
// "remove" only deletes the guardian_players link for THIS player. It never
// deletes the login itself, because the same login may also be linked to a
// sibling, or belong to a staff member.
//
// Listing: any staff role that can read players. Removing: Admin or Coach
// (the same roles that can send invites).
//
// Deploy with:
//   supabase functions deploy manage-player-guardians

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const callerToken = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${callerToken}` } },
    });
    const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerData?.user) return json({ error: "Not authenticated." }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerStaff } = await adminClient
      .from("staff")
      .select("role")
      .eq("user_id", callerData.user.id)
      .single();
    if (!callerStaff) return json({ error: "Staff access required." }, 403);

    const { action, playerId, authUserId } = await req.json();
    if (!playerId) return json({ error: "Missing 'playerId'." }, 400);

    if (action === "list") {
      const { data: perm } = await callerClient.rpc("has_permission", { p_table: "players", p_action: "select" });
      if (!perm) return json({ error: "You don't have access to player records." }, 403);

      const { data: links, error } = await adminClient
        .from("guardian_players")
        .select("auth_user_id, invited_email, created_at")
        .eq("player_id", playerId)
        .order("created_at", { ascending: true });
      if (error) throw error;

      const accounts = await Promise.all((links || []).map(async (l) => {
        const { data } = await adminClient.auth.admin.getUserById(l.auth_user_id);
        const u = data?.user;
        return {
          authUserId: l.auth_user_id,
          email: u?.email || l.invited_email || "(unknown)",
          linkedAt: l.created_at,
          activated: !!(u?.email_confirmed_at || u?.last_sign_in_at),
          lastSignInAt: u?.last_sign_in_at || null,
        };
      }));
      return json({ accounts });
    }

    if (action === "remove") {
      if (!["admin", "chairman", "coach"].includes(callerStaff.role)) {
        return json({ error: "Only an Admin, Chairman or Coach can remove app access." }, 403);
      }
      if (!authUserId) return json({ error: "Missing 'authUserId'." }, 400);

      const { error: delErr } = await adminClient
        .from("guardian_players")
        .delete()
        .eq("player_id", playerId)
        .eq("auth_user_id", authUserId);
      if (delErr) throw delErr;

      // Clear the legacy 1:1 column too if it points at this login, so a
      // re-run of the backfill migration can't quietly restore the link.
      await adminClient
        .from("players")
        .update({ user_id: null })
        .eq("id", playerId)
        .eq("user_id", authUserId);

      return json({ success: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    console.error("manage-player-guardians: unexpected error", err);
    return json({ error: "Something went wrong - please try again." }, 500);
  }
});
