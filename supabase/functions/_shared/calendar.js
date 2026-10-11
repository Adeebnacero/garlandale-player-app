// Club calendar helpers for the get-club-calendar Edge Function. Pure,
// tested with: deno test supabase/functions/_shared/
//
// The calendar shows club events (Club Management -> Calendar) and every
// Garlandale FC fixture (the Fixtures tab, plus Matchday-only matches) to
// everyone signed in to the Player Portal.

/** Longest date range one request may ask for. */
export const MAX_RANGE_DAYS = 400;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const REPEAT_WORDS = { weekly: "Every week", fortnightly: "Every 2 weeks", monthly: "Every month" };

function isRealDate(s) {
  if (!DATE_RE.test(String(s || ""))) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/**
 * Reads ?from=YYYY-MM-DD&to=YYYY-MM-DD. Both are optional: the default is
 * the whole of the current year (South African date `today`).
 * Returns { ok: true, from, to } or { ok: false, error }.
 */
export function parseRange(from, to, today) {
  const year = String(today).slice(0, 4);
  const f = from || `${year}-01-01`;
  const t = to || `${year}-12-31`;
  if (!isRealDate(f) || !isRealDate(t)) return { ok: false, error: "Dates must look like 2026-10-31." };
  if (t < f) return { ok: false, error: "The end date is before the start date." };
  if (daysBetween(f, t) > MAX_RANGE_DAYS) return { ok: false, error: `Ask for ${MAX_RANGE_DAYS} days or fewer at a time.` };
  return { ok: true, from: f, to: t };
}

const hhmm = (t) => (t ? String(t).slice(0, 5) : "");

/** "Every week until 8 Dec 2026", or "" for a one-off event. */
export function repeatText(rule, until) {
  if (!REPEAT_WORDS[rule] || !isRealDate(until)) return "";
  const [y, m, d] = until.split("-").map(Number);
  return `${REPEAT_WORDS[rule]} until ${d} ${MONTHS3[m - 1]} ${y}`;
}

export function shapeCategory(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    text_color: row.text_color,
    is_system: row.is_system || null,
  };
}

/** One club event, as the Player Portal shows it. */
export function shapeEvent(row) {
  return {
    id: `event:${row.id}`,
    kind: "event",
    category_id: row.category_id,
    title: row.title,
    date: row.event_date,
    start: row.all_day ? "" : hhmm(row.start_time),
    end: row.all_day ? "" : hhmm(row.end_time),
    all_day: !!row.all_day || !row.start_time,
    venue: row.venue || "",
    description: row.description || "",
    location_link: row.location_link || "",
    location_embed: row.location_embed || "",
    repeat_text: row.series_id ? repeatText(row.repeat_rule, row.repeat_until) : "",
  };
}

function fixtureTitle(team, homeAway, opponent) {
  return `${team ? team + " " : ""}${homeAway === "A" ? "@" : "vs"} ${opponent || "TBC"}`;
}

/** A row from the fixtures table (Club Management -> Fixtures). */
export function shapeFixture(row) {
  const team = row.squad_age_group || row.team_label || "";
  return {
    id: `fixture:${row.id}`,
    kind: "fixture",
    title: fixtureTitle(team, row.home_away, row.opponent),
    team,
    opponent: row.opponent || "",
    home_away: row.home_away || "",
    date: row.match_date,
    start: hhmm(row.kickoff_time),
    end: "",
    all_day: !row.kickoff_time,
    venue: row.venue || "",
    description: "",
    location_link: row.location_link || "",
    location_embed: row.location_embed || "",
  };
}

/** A Matchday entry that wasn't created from a fixture (friendlies, one-offs). */
export function shapeMatch(row) {
  return {
    ...shapeFixture({ ...row, squad_age_group: row.age_group, team_label: "" }),
    id: `match:${row.id}`,
    description: row.competition || "",
  };
}

/** Everything for the calendar, sorted by date, then all-day first, then time. */
export function sortCalendarItems(items) {
  return [...items].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const ta = a.all_day ? "" : a.start;
    const tb = b.all_day ? "" : b.start;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return String(a.title).localeCompare(String(b.title));
  });
}
