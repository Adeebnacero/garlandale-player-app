// supabase/functions/get-my-profile/index.ts
//
// Player-facing endpoint: returns the calling player's profile fields.
// Same auth pattern as get-my-balance - validate the caller's own JWT via
// current_player_id(), then read with the service-role key, explicitly
// scoped to that one id.
//
// Returns BOTH read-only fields (name, reg_no, squad_number - for display
// only, never editable here) and the whitelisted editable fields (phone,
// email, guardian_name, guardian_phone) that update-my-profile allows
// changing. Deliberately does NOT return billing/compliance fields
// (tier_id, monthly_fee, documents_complete, notes) - those aren't this
// endpoint's concern and a player has no reason to see staff-only notes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeAgeGroup, isOver40 } from "./billing.js";
import { checkRateLimit } from "./rate-limit.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { data: playerId, error: rpcErr } = await callerClient.rpc("current_player_id");
  if (rpcErr || !playerId) {
    return new Response(JSON.stringify({ error: "No linked player account for this user" }), {
      status: 403,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const rl = await checkRateLimit(adminClient, userData.user.id, "get-my-profile");
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests - please slow down." }), {
      status: 429,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { data: player, error: playerErr } = await adminClient
    .from("players")
    .select("name, dob, age_group_override, reg_no, squad_number, phone, email, guardian_name, guardian_phone")
    .eq("id", playerId)
    .single();

  if (playerErr || !player) {
    return new Response(JSON.stringify({ error: "Player record not found" }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const ageGroup = player.age_group_override || computeAgeGroup(player.dob);
  const over40 = isOver40(player.dob);

  return new Response(
    JSON.stringify({
      name: player.name,
      reg_no: player.reg_no,
      squad_number: player.squad_number,
      phone: player.phone,
      email: player.email,
      guardian_name: player.guardian_name,
      guardian_phone: player.guardian_phone,
      age_group: ageGroup,
      over_40: over40,
    }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    }
  );
});
