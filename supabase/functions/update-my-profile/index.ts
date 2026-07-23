// supabase/functions/update-my-profile/index.ts
//
// Player-facing endpoint: lets a linked player update ONLY their contact
// fields. This is the write counterpart to get-my-profile.
//
// Whitelist enforcement happens at TWO layers, but they protect against
// DIFFERENT things - worth being precise about this rather than treating
// them as a simple redundant double-check:
//   1. HERE - this function rejects any request containing a field outside
//      the whitelist before it ever reaches the database. This is what
//      actually protects every request that comes through this function.
//   2. The `players_enforce_player_whitelist` trigger in the database
//      (see player_app_rls_migration.sql) protects a DIFFERENT path: a
//      player hitting PostgREST directly with their own session, bypassing
//      this function entirely. Because this function writes using the
//      service-role key (no caller JWT on the connection), the trigger's
//      `current_player_id()` check resolves to null on THIS function's own
//      writes and does not re-check them - it isn't a second check on this
//      code path, it's coverage for a path that skips this code entirely.
//
// Expects a JSON body containing ONLY some subset of:
//   { phone, email, guardian_name, guardian_phone }
// Any other key in the body is a hard rejection (400), not silently
// ignored - a client sending an unexpected field is a bug worth surfacing
// loudly, not masking.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EDITABLE_FIELDS = ["phone", "email", "guardian_name", "guardian_phone"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const keys = Object.keys(body);
  if (keys.length === 0) {
    return new Response(JSON.stringify({ error: "No fields provided" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const disallowed = keys.filter((k) => !EDITABLE_FIELDS.includes(k));
  if (disallowed.length > 0) {
    return new Response(
      JSON.stringify({ error: `Field(s) not editable: ${disallowed.join(", ")}` }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  const update: Record<string, string> = {};
  for (const key of EDITABLE_FIELDS) {
    if (key in body) {
      const value = body[key];
      if (typeof value !== "string") {
        return new Response(JSON.stringify({ error: `${key} must be a string` }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
      update[key] = value.trim();
    }
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: updated, error: updateErr } = await adminClient
    .from("players")
    .update(update)
    .eq("id", playerId)
    .select("phone, email, guardian_name, guardian_phone")
    .single();

  if (updateErr) {
    return new Response(JSON.stringify({ error: updateErr.message }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(updated), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
