// Shared date helpers for the Player Portal's Edge Functions. Pure
// functions, no imports, so they can be tested with:
//
//   deno test supabase/functions/_shared/
//
// Edge Functions run in UTC, but the club works in South African time
// (UTC+2, no daylight saving). Without this, "today" would still be
// yesterday between midnight and 02:00 in South Africa.

/** A calendar date (YYYY-MM-DD) in South Africa. */
export function saDate(when = new Date()) {
  const d = when instanceof Date ? when : new Date(when);
  return new Date(d.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Whether a notice should still be shown. Birthday notices are for their
 * day only (South African time); every other notice is always current.
 */
export function isCurrentNotice(notice, today = saDate()) {
  if (!notice || notice.category !== "birthday") return true;
  return !!notice.posted_at && saDate(notice.posted_at) === today;
}
