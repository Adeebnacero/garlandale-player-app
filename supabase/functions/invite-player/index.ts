// Supabase Edge Function: invite-player
//
// Invites a guardian to claim access to a SPECIFIC player (by playerId) for
// the player-facing app, and links the resulting auth user to that exact
// player row via the guardian_players join table. This is the deliberate
// alternative to open self-signup: only a player row that already exists in
// the club's records - and that an Admin/Coach explicitly triggers from
// that player's profile - can ever end up with a claimable account.
//
// Multi-child guardians: linking is additive, via guardian_players
// (auth_user_id, player_id), not the old single-value players.user_id
// column. This means the SAME email can be invited to a second, third,
// etc. child and each call adds one more link rather than overwriting the
// last one - which is exactly what lets one guardian see all their kids
// from a single login. If this email already has an account (whether from
// an earlier invite to a sibling, or because they're also staff), that
// existing account is looked up and linked to this player too, rather than
// a new account being created (Supabase Auth requires unique emails, so a
// second inviteUserByEmail for the same address would fail anyway).
//
// Only an Admin or Coach can call this successfully - re-checked server-side
// using the service role key, mirroring invite-user's pattern.
//
// Deploy with:
//   supabase functions deploy invite-player

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.js";

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req, "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const callerToken = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${callerToken}` } },
    });
    const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerData?.user) {
      return new Response(JSON.stringify({ error: "Not authenticated." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerStaff, error: staffErr } = await adminClient
      .from("staff")
      .select("role")
      .eq("user_id", callerData.user.id)
      .single();

    if (staffErr || !callerStaff || !["admin", "coach"].includes(callerStaff.role)) {
      return new Response(JSON.stringify({ error: "Only an Admin or Coach can invite a player." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { playerId, email, redirectTo } = await req.json();
    if (!playerId || !email) {
      return new Response(JSON.stringify({ error: "Missing 'playerId' or 'email'." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: playerRow, error: playerErr } = await adminClient
      .from("players")
      .select("id, name")
      .eq("id", playerId)
      .single();
    if (playerErr || !playerRow) {
      return new Response(JSON.stringify({ error: "Player not found." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try to invite. If this email is already registered (e.g. a guardian
    // being linked to a second child, a parent who is also staff, or
    // re-inviting after a lost link), fall back to looking them up so we
    // can still link the account to this player.
    let userId;
    let alreadyRegistered = false;
    const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: redirectTo || undefined,
    });

    if (inviteErr) {
      const isAlreadyRegistered = (inviteErr.message || "").toLowerCase().includes("already registered") ||
        (inviteErr.message || "").toLowerCase().includes("already been registered");
      if (!isAlreadyRegistered) {
        console.error("invite-player: inviteUserByEmail failed", inviteErr);
        return new Response(JSON.stringify({ error: "Could not send invite - please try again." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      alreadyRegistered = true;
      const { data: list, error: listErr } = await adminClient.auth.admin.listUsers();
      if (listErr) throw listErr;
      const existing = list.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
      if (!existing) throw new Error("User already registered but could not be found.");
      userId = existing.id;
    } else {
      userId = inviteData.user.id;
    }

    // Additive link: upsert into guardian_players rather than overwriting
    // players.user_id. A guardian already linked to one child who's now
    // being invited to a second gets a SECOND row here, not a replacement
    // of the first - that's what lets them see both from one login.
    // ignoreDuplicates makes re-running this (e.g. re-sending a lost
    // invite) a harmless no-op rather than an error.
    const { error: linkErr } = await adminClient
      .from("guardian_players")
      .upsert(
        { auth_user_id: userId, player_id: playerId },
        { onConflict: "auth_user_id,player_id", ignoreDuplicates: true }
      );
    if (linkErr) throw linkErr;

    return new Response(
      JSON.stringify({ success: true, alreadyRegistered }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("invite-player: unexpected error", err);
    return new Response(JSON.stringify({ error: "Could not send invite - please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
