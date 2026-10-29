// When a notice reaches phones, for the Notice Board in Messages.
//
// Mirrors the Player Portal's hourly push job
// (garlandale-player-app: supabase/functions/_shared/notice-push.js):
//   - runs at five past every hour
//   - quiet hours 21:00-07:00 Cape Town time: only urgent notices go out
// South Africa has no daylight saving, so Cape Town is always UTC+2.

export const QUIET_FROM_HOUR = 21;
export const QUIET_UNTIL_HOUR = 7;
const SA_OFFSET_MS = 2 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;

function saHour(d) {
  return (d.getUTCHours() + 2) % 24;
}

export function isQuietHour(d) {
  const h = saHour(d);
  return h >= QUIET_FROM_HOUR || h < QUIET_UNTIL_HOUR;
}

/** The run that will pick up a notice saved at `now`. */
export function nextPushTime(now = new Date(), urgent = false) {
  const t = new Date(now.getTime());
  const beforeFivePast = t.getUTCMinutes() < 5;
  t.setUTCMinutes(5, 0, 0);
  if (!beforeFivePast) t.setTime(t.getTime() + HOUR_MS);
  if (!urgent) {
    while (isQuietHour(t)) t.setTime(t.getTime() + HOUR_MS);
  }
  return t;
}

function saDay(d) {
  return new Date(d.getTime() + SA_OFFSET_MS).toISOString().slice(0, 10);
}

function saClock(d) {
  return new Date(d.getTime() + SA_OFFSET_MS).toISOString().slice(11, 16);
}

/** "at 10:05" or "tomorrow at 07:05", in Cape Town time. */
export function whenLabel(when, now = new Date()) {
  const day = saDay(when) === saDay(now) ? "" : "tomorrow ";
  return `${day}at ${saClock(when)}`;
}
