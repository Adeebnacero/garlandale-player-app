// supabase/functions/send-notice-pushes/index.ts
//
// The hourly notice notifications. Called by pg_cron at five past every
// hour (see migrations/0006_notice_pushes.sql) - never by the app.
//
// Each run:
//   1. Finds notices not yet pushed (notices.push_sent_at is null). In quiet
//      hours (21:00-07:00 Cape Town) only urgent ones; the rest wait for
//      the 07:05 run. Rules live in _shared/notice-push.js.
//   2. Claims them (stamps push_sent_at) BEFORE sending, so two overlapping
//      runs can never send the same notice twice.
//   3. Works out, for everyone with notifications on, which of those
//      notices they'd see on the notice board - and sends each person ONE
//      notification covering all of theirs.
//
// Auth: pg_net can't send a Supabase login, so JWT checking is off for this
// function (supabase/config.toml) and the caller must instead present the
// shared secret from Vault in an x-cron-secret header, matched against the
// PUSH_CRON_SECRET function secret.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dueNotices, noticesForPerson, buildMessage, playerAgeGroup, isQuietHour } from "../_shared/notice-push.js";
import { deliver, vapidFromEnv } from "../_shared/webpush.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("PUSH_CRON_SECRET") || "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Compares two secrets without leaking how much of them matched. */
function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function chunks<T>(list: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  if (!CRON_SECRET || !sameSecret(req.headers.get("x-cron-secret") || "", CRON_SECRET)) {
    return json({ error: "Not allowed" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const now = new Date();
  const nowIso = now.toISOString();
  const quiet = isQuietHour(now);

  // 1. What's waiting.
  let query = admin
    .from("notices")
    .select("id, title, body, category, urgent, posted_at, target_age_group, target_age_groups, show_to_supporters")
    .is("push_sent_at", null)
    .lte("posted_at", nowIso)
    .order("posted_at", { ascending: true })
    .limit(200);
  if (quiet) query = query.eq("urgent", true);
  const { data: pending, error: pendingErr } = await query;
  if (pendingErr) {
    console.error("send-notice-pushes: couldn't load notices", pendingErr);
    return json({ error: "Couldn't load notices" }, 500);
  }

  const { send, skip } = dueNotices(pending || [], now);

  // Too old to be worth a notification - mark handled, quietly.
  if (skip.length) {
    await admin.from("notices").update({ push_sent_at: nowIso })
      .in("id", skip.map((n) => n.id)).is("push_sent_at", null);
  }
  if (send.length === 0) return json({ quiet, notices: 0, skipped: skip.length });

  // 2. Claim before sending.
  const { data: claimed, error: claimErr } = await admin.from("notices")
    .update({ push_sent_at: nowIso })
    .in("id", send.map((n) => n.id))
    .is("push_sent_at", null)
    .select("id");
  if (claimErr) {
    console.error("send-notice-pushes: couldn't claim notices", claimErr);
    return json({ error: "Couldn't claim notices" }, 500);
  }
  const claimedIds = new Set((claimed || []).map((r) => r.id));
  const notices = send.filter((n) => claimedIds.has(n.id));
  if (notices.length === 0) return json({ quiet, notices: 0, note: "another run already took them" });

  // If anything fails before the first message goes out, hand the notices
  // back so the next run tries again instead of them being silently lost.
  const release = async () => {
    await admin.from("notices").update({ push_sent_at: null }).in("id", [...claimedIds]);
  };

  let deliveries;
  let vapid;
  let people = 0;
  try {
    vapid = await vapidFromEnv(); // fails here, not mid-send, if the keys are missing
    // 3a. Everyone with notifications on.
    const subs: Array<Record<string, unknown>> = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("push_subscriptions")
        .select("id, auth_user_id, endpoint, p256dh, auth, failure_count")
        .order("id").range(from, from + 999);
      if (error) throw error;
      subs.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const userIds = [...new Set(subs.map((s) => s.auth_user_id as string))];

    // 3b. Their linked children's age groups, and supporter status.
    const childrenOf = new Map<string, string[]>();
    const playerIds = new Set<string>();
    for (const ids of chunks(userIds)) {
      const { data, error } = await admin.from("guardian_players").select("auth_user_id, player_id").in("auth_user_id", ids);
      if (error) throw error;
      for (const l of data || []) {
        childrenOf.set(l.auth_user_id, [...(childrenOf.get(l.auth_user_id) || []), l.player_id]);
        playerIds.add(l.player_id);
      }
    }
    const groupOf = new Map<string, string>();
    for (const ids of chunks([...playerIds])) {
      const { data, error } = await admin.from("players").select("id, dob, age_group_override").in("id", ids);
      if (error) throw error;
      for (const p of data || []) groupOf.set(p.id, playerAgeGroup(p));
    }
    const supporters = new Set<string>();
    for (const ids of chunks(userIds.filter((u) => !childrenOf.has(u)))) {
      const { data, error } = await admin.from("supporters").select("auth_user_id").eq("status", "approved").in("auth_user_id", ids);
      if (error) throw error;
      for (const s of data || []) supporters.add(s.auth_user_id);
    }

    // 3c. One message per person, to each of their devices.
    const messageFor = new Map<string, ReturnType<typeof buildMessage>>();
    for (const u of userIds) {
      const ageGroups = (childrenOf.get(u) || []).map((id) => groupOf.get(id)).filter(Boolean) as string[];
      const built = buildMessage(noticesForPerson({ ageGroups, supporter: supporters.has(u) }, notices));
      if (built) { messageFor.set(u, built); people++; }
    }
    deliveries = subs
      .filter((s) => messageFor.has(s.auth_user_id as string))
      .map((sub) => {
        const built = messageFor.get(sub.auth_user_id as string)!;
        return { sub, message: built.message, options: { urgency: built.urgent ? "high" : "normal", ttl: 12 * 3600 } };
      });
  } catch (err) {
    console.error("send-notice-pushes: failed before sending - notices handed back for the next run", err);
    await release();
    return json({ error: "Failed before sending; will retry next run" }, 500);
  }

  const result = await deliver(admin, deliveries, { vapid });
  const summary = { quiet, notices: notices.length, skipped: skip.length, people, ...result };
  console.log("send-notice-pushes", JSON.stringify(summary));
  return json(summary);
});
