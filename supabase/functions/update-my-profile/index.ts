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
import { buildCorsHeaders } from "../_shared/cors.js";
import { checkRateLimit } from "../_shared/rate-limit.js";
import { resolveRequestedPlayerId } from "../_shared/resolve-player.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EDITABLE_FIELDS = ["phone", "email", "guardian_name", "guardian_phone"];

// Per-field validation. Kept intentionally permissive (this is a contact
// book, not a form with rigid formatting requirements) but bounded enough to
// catch obvious garbage before it lands in the database and breaks
// downstream email/SMS flows.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Digits plus common separators/punctuation used in phone numbers
// (spaces, dashes, parens, leading +). Deliberately not stricter than that -
// international formats vary too much to validate more tightly here.
const PHONE_RE = /^[0-9+()\-.\s]+$/;

const FIELD_RULES: Record<string, { maxLength: number; pattern?: RegExp; label: string }> = {
  phone: { maxLength: 30, pattern: PHONE_RE, label: "Phone" },
  guardian_phone: { maxLength: 30, pattern: PHONE_RE, label: "Guardian phone" },
  email: { maxLength: 254, pattern: EMAIL_RE, label: "Email" },
  guardian_name: { maxLength: 100, label: "Guardian name" },
};

Deno.serve(async (req) => {
  const CORS_HEADERS = buildCorsHeaders(req, "POST, OPTIONS");

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

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Stricter limit than read endpoints - this is a write, and a
  // legitimate player has no reason to save their profile more than a
  // handful of times a minute.
  const rl = await checkRateLimit(adminClient, userData.user.id, "update-my-profile", {
    maxRequests: 10,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests - please slow down." }), {
      status: 429,
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

  const keys = Object.keys(body).filter((k) => k !== "player_id");
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

  // player_id is optional in the body - a single-child guardian (still the
  // overwhelming majority of accounts) never needs to send it, and gets
  // their one linked player by default. A multi-child guardian must send
  // it, and it must be one of THEIR OWN linked children - this is what
  // stops one guardian from editing another family's player record.
  const requestedPlayerId = typeof body.player_id === "string" ? body.player_id : null;
  const resolved = await resolveRequestedPlayerId(callerClient, requestedPlayerId);
  if (!resolved.ok) {
    return new Response(JSON.stringify({ error: resolved.error }), {
      status: resolved.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
  const playerId = resolved.playerId;

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

      const trimmed = value.trim();
      const rule = FIELD_RULES[key];

      if (trimmed.length > rule.maxLength) {
        return new Response(
          JSON.stringify({ error: `${rule.label} must be ${rule.maxLength} characters or fewer` }),
          { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      // Empty string clears the field - allow it through without pattern
      // checks (e.g. a player removing a guardian phone they no longer want
      // stored).
      if (trimmed.length > 0 && rule.pattern && !rule.pattern.test(trimmed)) {
        return new Response(
          JSON.stringify({ error: `${rule.label} is not a valid format` }),
          { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }

      update[key] = trimmed;
    }
  }

  const { data: updated, error: updateErr } = await adminClient
    .from("players")
    .update(update)
    .eq("id", playerId)
    .select("phone, email, guardian_name, guardian_phone")
    .single();

  if (updateErr) {
    console.error("update-my-profile: database update failed", updateErr);
    return new Response(JSON.stringify({ error: "Could not save changes - please try again." }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(updated), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
