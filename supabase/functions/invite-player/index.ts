// Supabase Edge Function: invite-player
//
// Invites a guardian (or an adult player) to the Player Portal and links
// their login to a SPECIFIC player via the guardian_players join table.
// Only a player row that already exists in the club's records - and that an
// Admin/Coach explicitly triggers from that player's profile - can ever end
// up with a claimable account.
//
// Linking is additive and many-to-many:
//   - one guardian can be linked to several children (siblings), and
//   - one child can be linked to several guardian accounts (e.g. both
//     parents on their own logins), up to MAX_ACCOUNTS_PER_PLAYER.
//
// THIS IS THE ONLY COPY OF THIS FUNCTION. It used to exist in both the
// club-management and player-app repos with different behaviour; the
// player-app copy has been removed. Deploy from this repo only:
//   supabase functions deploy invite-player
//
// Response: { success, emailSent, emailError, alreadyRegistered, alreadyLinked }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// How many separate logins may be linked to one player. Two covers "both
// parents"; raise it if the club needs to allow more (e.g. step-parents).
const MAX_ACCOUNTS_PER_PLAYER = 2;

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

// listUsers() is paginated (50 per page by default), so a plain
// list.users.find(...) silently misses anyone past the first page once the
// club has more than 50 logins. Walk every page instead.
// deno-lint-ignore no-explicit-any
async function findUserByEmail(adminClient: any, email: string) {
  const target = email.toLowerCase();
  const perPage = 1000;
  for (let page = 1; page < 100; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users || [];
    // deno-lint-ignore no-explicit-any
    const hit = users.find((u: any) => (u.email || "").toLowerCase() === target);
    if (hit) return hit;
    if (users.length < perPage) return null;
  }
  return null;
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

    const { data: callerStaff, error: staffErr } = await adminClient
      .from("staff")
      .select("role")
      .eq("user_id", callerData.user.id)
      .single();
    if (staffErr || !callerStaff || !["admin", "chairman", "coach"].includes(callerStaff.role)) {
      return json({ error: "Only an Admin, Chairman or Coach can invite a player." }, 403);
    }

    const body = await req.json();
    const playerId = body?.playerId;
    const email = String(body?.email || "").trim();
    const redirectTo = body?.redirectTo || undefined;
    if (!playerId || !email) return json({ error: "Missing 'playerId' or 'email'." }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "That doesn't look like a valid email address." }, 400);

    const { data: playerRow, error: playerErr } = await adminClient
      .from("players")
      .select("id, name")
      .eq("id", playerId)
      .single();
    if (playerErr || !playerRow) return json({ error: "Player not found." }, 404);

    // Look the email up FIRST, so we can enforce the per-player limit
    // before creating an auth user or sending anything.
    let existing = await findUserByEmail(adminClient, email);

    const { data: links, error: linksErr } = await adminClient
      .from("guardian_players")
      .select("auth_user_id")
      .eq("player_id", playerId);
    if (linksErr) throw linksErr;

    // deno-lint-ignore no-explicit-any
    const linkedIds = new Set((links || []).map((l: any) => l.auth_user_id));
    const alreadyLinked = !!existing && linkedIds.has(existing.id);

    if (!alreadyLinked && linkedIds.size >= MAX_ACCOUNTS_PER_PLAYER) {
      return json({
        error: `${playerRow.name} already has ${linkedIds.size} linked app accounts (the maximum). Remove one before adding another.`,
      }, 409);
    }

    // Decide whether to send an invite email:
    //   - brand-new email                 -> invite (creates the account)
    //   - account exists, never activated -> invite again (Supabase resends
    //                                        for unconfirmed users)
    //   - account exists and is active    -> just link; they'll see this
    //                                        child next time they open the app
    let userId: string | null = existing?.id ?? null;
    let emailSent = false;
    let emailError: string | null = null;
    const isActive = !!existing && !!(existing.email_confirmed_at || existing.last_sign_in_at);

    if (!isActive) {
      const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (!inviteErr) {
        userId = inviteData.user.id;
        emailSent = true;
      } else {
        // The account may still have been created even though the email
        // failed (e.g. SMTP problem) - or someone activated it in between.
        // Link it if it exists and report the email problem honestly.
        console.error("invite-player: inviteUserByEmail failed", inviteErr);
        existing = existing || (await findUserByEmail(adminClient, email));
        if (!existing) return json({ error: "Could not send invite - please try again." }, 500);
        userId = existing.id;
        const msg = (inviteErr.message || "").toLowerCase();
        if (!msg.includes("already")) emailError = inviteErr.message || "unknown reason";
      }
    }

    const { error: linkErr } = await adminClient
      .from("guardian_players")
      .upsert(
        { auth_user_id: userId, player_id: playerId, invited_email: email.toLowerCase(), invited_by: callerData.user.id },
        { onConflict: "auth_user_id,player_id" },
      );
    if (linkErr) throw linkErr;

    return json({
      success: true,
      emailSent,
      emailError,
      alreadyRegistered: !!existing,
      alreadyLinked,
    });
  } catch (err) {
    console.error("invite-player: unexpected error", err);
    return json({ error: "Could not send invite - please try again." }, 500);
  }
});
