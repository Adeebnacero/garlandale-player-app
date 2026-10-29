// Supabase Edge Function: invite-user
//
// Invites a new staff member by email and assigns them a role. Only an
// existing Admin can call this successfully - it re-checks the caller's
// role server-side using the service role key, so a Treasurer or Coach
// cannot invite anyone even if they somehow call this function directly.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically by
// Supabase to every Edge Function - no manual secret-setting needed for
// this function (unlike send-email, which needs its own SMTP secrets).
//
// Deploy with:
//   supabase functions deploy invite-user

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const callerToken = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // Client scoped to the caller's own token, just to identify who's calling.
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

    // Admin client (service role) to check the caller's role and perform the invite.
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerStaff, error: staffErr } = await adminClient
      .from("staff")
      .select("role")
      .eq("user_id", callerData.user.id)
      .single();

    if (staffErr || !callerStaff || !["admin", "chairman"].includes(callerStaff.role)) {
      return new Response(JSON.stringify({ error: "Only an Admin or Chairman can invite new staff." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email, role, redirectTo } = await req.json();
    if (!email || !role || !["admin", "treasurer", "coach", "referee", "chairman"].includes(role)) {
      return new Response(JSON.stringify({ error: "Missing or invalid 'email'/'role'." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try to invite. If the user already exists in auth, fall back to
    // looking them up so we can still (re)assign their staff role.
    let userId;
    const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: redirectTo || undefined,
    });

    if (inviteErr) {
      const isAlreadyRegistered = (inviteErr.message || "").toLowerCase().includes("already registered") ||
        (inviteErr.message || "").toLowerCase().includes("already been registered");
      if (!isAlreadyRegistered) {
        return new Response(JSON.stringify({ error: inviteErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Find their existing user id by listing and matching email.
      const { data: list, error: listErr } = await adminClient.auth.admin.listUsers();
      if (listErr) throw listErr;
      const existing = list.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
      if (!existing) throw new Error("User already registered but could not be found.");
      userId = existing.id;
    } else {
      userId = inviteData.user.id;
    }

    const { error: upsertErr } = await adminClient
      .from("staff")
      .upsert({ user_id: userId, email, role }, { onConflict: "user_id" });
    if (upsertErr) throw upsertErr;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Unknown error inviting user." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
