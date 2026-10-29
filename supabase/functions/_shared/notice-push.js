// Hourly notice notifications - the rules, kept separate from the Edge
// Function (send-notice-pushes) so they can be tested on their own.
// Tested with: deno test supabase/functions/_shared/
//
// The rules agreed for the club:
//   - One run an hour (pg_cron, five past). Each person gets at most ONE
//     notification per run, covering everything new for them.
//   - Quiet hours 21:00-07:00 Cape Town time: only notices marked urgent go
//     out. Everything else waits for the 07:05 run.
//   - Who a notice is for is exactly who sees it in the app (get-my-notices):
//       guardians/players - any linked child in one of its age groups (or
//                           it's for everyone); birthday notices only on
//                           their day
//       approved supporters (no linked child) - only notices marked "Also
//                           show to supporters", never birthdays

import { isForAgeGroup } from "./audience.js";
import { supporterNoticeFilter } from "./account.js";
import { saDate, isCurrentNotice } from "./dates.js";
import { computeAgeGroup } from "./billing.js";

export const QUIET_FROM_HOUR = 21; // 21:00
export const QUIET_UNTIL_HOUR = 7; // 07:00

// A notice that somehow waited longer than this (e.g. the job was broken
// for a weekend) is marked as handled without a notification - news that
// old belongs in the app, not on a lock screen.
export const MAX_AGE_HOURS = 24;

/** The hour (0-23) on a Cape Town clock. South Africa has no daylight saving. */
export function saHour(when = new Date()) {
  const d = when instanceof Date ? when : new Date(when);
  return (d.getUTCHours() + 2) % 24;
}

export function isQuietHour(when = new Date()) {
  const h = saHour(when);
  return h >= QUIET_FROM_HOUR || h < QUIET_UNTIL_HOUR;
}

/**
 * Splits not-yet-pushed notices into what to send now, what to mark as
 * handled without sending, and (by omission) what to leave for later.
 * Returns { send: [...], skip: [...] }.
 */
export function dueNotices(notices, now = new Date()) {
  const quiet = isQuietHour(now);
  const today = saDate(now);
  const oldest = now.getTime() - MAX_AGE_HOURS * 3600 * 1000;
  const send = [];
  const skip = [];
  for (const n of notices || []) {
    const posted = new Date(n.posted_at).getTime();
    if (!Number.isFinite(posted) || posted > now.getTime()) continue;        // not posted yet
    if (posted < oldest || !isCurrentNotice(n, today)) { skip.push(n); continue; } // too old / yesterday's birthday
    if (quiet && !n.urgent) continue;                                         // waits for the morning
    send.push(n);
  }
  return { send, skip };
}

/** A player's age group the same way every other endpoint works it out. */
export function playerAgeGroup(p) {
  return String(p.age_group_override || computeAgeGroup(p.dob)).trim().toLowerCase();
}

/**
 * The notices one person should hear about.
 * person: { ageGroups: [lower-case groups of linked children], supporter: bool }
 */
export function noticesForPerson(person, notices) {
  if (person.ageGroups && person.ageGroups.length) {
    return notices.filter((n) => person.ageGroups.some((g) => isForAgeGroup(n, g)));
  }
  if (person.supporter) return notices.filter(supporterNoticeFilter);
  return [];
}

function oneLine(text, max) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/**
 * The notification for one person's notices (already filtered, any order).
 * Urgent ones come first. Returns { message, urgent } or null.
 */
export function buildMessage(notices) {
  if (!notices || notices.length === 0) return null;
  const sorted = [...notices].sort((a, b) =>
    (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || String(b.posted_at).localeCompare(String(a.posted_at)));
  const urgent = sorted.some((n) => n.urgent);
  const label = (n) => (n.urgent ? "Urgent: " : "") + oneLine(n.title, 80);

  if (sorted.length === 1) {
    const n = sorted[0];
    return { urgent, message: { title: label(n), body: oneLine(n.body, 140), url: "notices.html" } };
  }
  return {
    urgent,
    message: {
      title: `${sorted.length} new club notices`,
      body: oneLine(sorted.map(label).join(" · "), 160),
      url: "notices.html",
    },
  };
}
