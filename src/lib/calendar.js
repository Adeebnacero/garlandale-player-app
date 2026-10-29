// ---------------------------------------------------------------------------
// Club calendar: pure helpers (no React, no Supabase), so they can be unit
// tested. Used by components/Calendar.jsx.
//
// Dates are plain "YYYY-MM-DD" strings ("keys") everywhere, compared as
// strings. Weeks start on Monday. Times are "HH:MM".
// ---------------------------------------------------------------------------

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Most dates one repeating event may create. */
export const MAX_OCCURRENCES = 104;

export const REPEAT_OPTIONS = [
  { value: "none", label: "Does not repeat" },
  { value: "weekly", label: "Every week" },
  { value: "fortnightly", label: "Every 2 weeks" },
  { value: "monthly", label: "Every month" },
];

/** Colours offered for categories. Each text colour passes 4.5:1 on its background. */
export const PALETTE = [
  { name: "Navy", color: "#241a45", textColor: "#ffffff" },
  { name: "Green", color: "#1e7a41", textColor: "#ffffff" },
  { name: "Gold", color: "#e8ac2e", textColor: "#1c1730" },
  { name: "Slate", color: "#5b5470", textColor: "#ffffff" },
  { name: "Red", color: "#c1443c", textColor: "#ffffff" },
  { name: "Sand", color: "#f6d9a8", textColor: "#5c3a00" },
  { name: "Stone", color: "#e2dbc9", textColor: "#1c1730" },
  { name: "Blue", color: "#2f5d9e", textColor: "#ffffff" },
  { name: "Teal", color: "#1f7070", textColor: "#ffffff" },
  { name: "Plum", color: "#7a3b69", textColor: "#ffffff" },
  { name: "Orange", color: "#b85c14", textColor: "#ffffff" },
];

const FALLBACK_CATEGORY = { id: "", name: "Other", color: "#e2dbc9", textColor: "#1c1730", isSystem: "other" };

// ---------- dates ----------

export function pad(n) {
  return (n < 10 ? "0" : "") + n;
}

export function toKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseKey(k) {
  const [y, m, d] = String(k).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isDateKey(k) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(k || ""))) return false;
  return toKey(parseKey(k)) === k;
}

/** Today's date on this computer. */
export function todayKey(now = new Date()) {
  return toKey(now);
}

export function addDays(k, n) {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export function mondayOf(k) {
  const d = parseKey(k);
  return addDays(k, -((d.getDay() + 6) % 7));
}

export function firstOfMonth(k) {
  return k.slice(0, 8) + "01";
}

export function longDate(k) {
  const d = parseKey(k);
  return `${DAYS_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function shortDate(k) {
  const d = parseKey(k);
  return `${d.getDate()} ${MON3[d.getMonth()]} ${d.getFullYear()}`;
}

/** "HH:MM" from a database time such as "17:30:00". */
export function hhmm(t) {
  return t ? String(t).slice(0, 5) : "";
}

export function timeLabel(item) {
  if (item.allDay || !item.start) return "All day";
  return item.end ? `${item.start} – ${item.end}` : item.start;
}

// ---------- repeating events ----------

/**
 * Every date a repeating event falls on, from `date` up to and including
 * `until`. Monthly repeats keep the same day of the month and skip months
 * that don't have it (an event on the 31st skips 30-day months). Always
 * includes `date` itself; never more than MAX_OCCURRENCES dates.
 */
export function occurrences(date, rule, until, max = MAX_OCCURRENCES) {
  const out = [date];
  if (!rule || rule === "none" || !until || until <= date) return out;
  const start = parseKey(date);
  for (let i = 1; out.length < max; i++) {
    let d;
    if (rule === "weekly") d = parseKey(addDays(date, 7 * i));
    else if (rule === "fortnightly") d = parseKey(addDays(date, 14 * i));
    else if (rule === "monthly") {
      d = new Date(start.getFullYear(), start.getMonth() + i, start.getDate());
      if (d.getDate() !== start.getDate()) {
        if (toKey(new Date(start.getFullYear(), start.getMonth() + i, 1)) > until) break;
        continue;
      }
    } else break;
    const k = toKey(d);
    if (k > until) break;
    out.push(k);
  }
  return out;
}

/** "every week until 8 Dec 2026", for use mid-sentence. */
export function lowerFirst(text) {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : "";
}

/** "Every week until 8 Dec 2026", or "" for a one-off event. */
export function repeatLabel(rule, until) {
  const opt = REPEAT_OPTIONS.find((o) => o.value === rule);
  if (!opt || rule === "none" || !until) return "";
  return `${opt.label} until ${shortDate(until)}`;
}

// ---------- views ----------

/** The dates shown in month view: whole weeks, Monday first. */
export function monthGrid(cursor) {
  const first = firstOfMonth(cursor);
  const d = parseKey(first);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const lead = (d.getDay() + 6) % 7;
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;
  const start = addDays(first, -lead);
  return Array.from({ length: cells }, (_, i) => addDays(start, i));
}

/** Monday to Sunday of the week containing `cursor`. */
export function weekDates(cursor) {
  const mon = mondayOf(cursor);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

export function periodLabel(view, cursor) {
  const d = parseKey(cursor);
  if (view === "year") return String(d.getFullYear());
  if (view === "month") return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const days = weekDates(cursor);
  const a = parseKey(days[0]);
  const b = parseKey(days[6]);
  return `${a.getDate()} ${MON3[a.getMonth()]} – ${b.getDate()} ${MON3[b.getMonth()]} ${b.getFullYear()}`;
}

/** Moves the cursor one week, month or year back (-1) or forward (+1). */
export function shiftCursor(view, cursor, dir) {
  const d = parseKey(cursor);
  if (view === "week") return addDays(cursor, 7 * dir);
  if (view === "month") return toKey(new Date(d.getFullYear(), d.getMonth() + dir, 1));
  return toKey(new Date(d.getFullYear() + dir, d.getMonth(), 1));
}

/** Sorts by date, all-day items first, then start time, then title. */
export function sortItems(items) {
  return [...items].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const ta = a.allDay || !a.start ? "" : a.start;
    const tb = b.allDay || !b.start ? "" : b.start;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return String(a.title).localeCompare(String(b.title));
  });
}

/** { "YYYY-MM-DD": [items] } */
export function groupByDate(items) {
  const out = {};
  for (const it of items) (out[it.date] = out[it.date] || []).push(it);
  return out;
}

// ---------- categories ----------

export function categoryFor(categories, id) {
  return categories.find((c) => c.id === id) || categories.find((c) => c.isSystem === "other") || FALLBACK_CATEGORY;
}

export function fixtureCategory(categories) {
  return categories.find((c) => c.isSystem === "fixture") || { ...FALLBACK_CATEGORY, name: "Fixture", color: "#241a45", textColor: "#ffffff", isSystem: "fixture" };
}

/** Error message for a category name, or "". */
export function categoryNameError(name, categories, id) {
  const n = String(name || "").trim();
  if (!n) return "Give the category a name.";
  if (n.length > 40) return "Keep the name to 40 characters or fewer.";
  if (categories.some((c) => c.id !== id && c.name.trim().toLowerCase() === n.toLowerCase())) return `There's already a category called ${n}.`;
  return "";
}

// ---------- items shown on the calendar ----------

/**
 * Fixtures for the calendar: every row from the Fixtures tab, plus
 * Matchday entries that weren't created from a fixture (friendlies and
 * other one-offs), since players see those in the Player Portal too.
 */
export function fixtureItems(fixtures, matches) {
  const fromFixtures = (fixtures || []).filter((f) => f.matchDate).map((f) => {
    const team = f.squadAgeGroup || f.teamLabel || "";
    return {
      id: `fixture:${f.id}`,
      kind: "fixture",
      source: "fixtures",
      title: `${team ? team + " " : ""}${f.homeAway === "A" ? "@" : "vs"} ${f.opponent || "TBC"}`,
      date: f.matchDate,
      start: hhmm(f.kickoffTime),
      end: "",
      allDay: !f.kickoffTime,
      venue: f.venue || "",
      team,
      homeAway: f.homeAway,
      description: "",
      locationLink: f.locationLink || "",
      locationEmbed: f.locationEmbed || "",
    };
  });
  const fromMatchday = (matches || []).filter((m) => m.matchDate && !m.fixtureId).map((m) => ({
    id: `match:${m.id}`,
    kind: "fixture",
    source: "matchday",
    title: `${m.ageGroup ? m.ageGroup + " " : ""}${m.homeAway === "A" ? "@" : "vs"} ${m.opponent || "TBC"}`,
    date: m.matchDate,
    start: hhmm(m.kickoffTime),
    end: "",
    allDay: !m.kickoffTime,
    venue: m.venue || "",
    team: m.ageGroup || "",
    homeAway: m.homeAway,
    description: m.competition || "",
    locationLink: m.locationLink || "",
    locationEmbed: m.locationEmbed || "",
  }));
  return [...fromFixtures, ...fromMatchday];
}

/** A saved event as a calendar item. */
export function eventItem(ev) {
  return { ...ev, kind: "event" };
}

// ---------- forms ----------

export function blankEventForm(date, categories) {
  const first = (categories || []).find((c) => !c.isSystem) || (categories || []).find((c) => c.isSystem === "other");
  return {
    id: "",
    title: "",
    categoryId: first ? first.id : "",
    date,
    allDay: false,
    start: "18:00",
    end: "19:30",
    venue: "",
    description: "",
    locationLink: "",
    locationEmbed: "",
    repeatRule: "none",
    repeatUntil: "",
    seriesId: "",
    scope: "one",
    notify: false,
  };
}

/** Error message for an event form, or "". */
export function eventFormError(form) {
  if (!String(form.title || "").trim()) return "Give the event a title.";
  if (String(form.title).trim().length > 120) return "Keep the title to 120 characters or fewer.";
  if (!form.categoryId) return "Pick a category.";
  if (!isDateKey(form.date)) return "Pick a date.";
  if (!form.allDay) {
    if (!/^\d{2}:\d{2}$/.test(form.start || "")) return "Pick a start time, or tick All-day event.";
    if (form.end && !/^\d{2}:\d{2}$/.test(form.end)) return "Pick an end time, or leave it empty.";
    if (form.end && form.end <= form.start) return "The end time must be after the start time.";
  }
  if ((form.venue || "").length > 200) return "Keep the venue to 200 characters or fewer.";
  if ((form.description || "").length > 2000) return "Keep the details to 2,000 characters or fewer.";
  if (!form.id && form.repeatRule && form.repeatRule !== "none") {
    if (!isDateKey(form.repeatUntil) || form.repeatUntil <= form.date) return "The Until date must be after the first event.";
    const n = occurrences(form.date, form.repeatRule, form.repeatUntil, MAX_OCCURRENCES + 1).length;
    if (n > MAX_OCCURRENCES) return `That would create more than ${MAX_OCCURRENCES} events. Pick an earlier Until date.`;
  }
  return "";
}

// ---------- Notice Board posts ----------

function whenText(ev) {
  return longDate(ev.date) + (ev.allDay || !ev.start ? "" : `, ${timeLabel(ev)}`) + (ev.venue ? ` at ${ev.venue}` : "");
}

/**
 * Title and message for the Notice Board post made alongside an event.
 * kind: "new" | "update" | "cancel". opts.series: { rule, until, fromDate,
 * count } when the post is about several dates of a repeating event.
 */
export function noticeText(kind, ev, opts = {}) {
  const title = String(ev.title || "").trim() || "[Event title]";
  const series = opts.series;
  const footer = "See the Club calendar for details.";
  if (kind === "cancel") {
    const body = series
      ? `${title} (${lowerFirst(repeatLabel(series.rule, series.until))}) is cancelled from ${longDate(series.fromDate)} onwards.`
      : `${title} on ${longDate(ev.date)} is cancelled.`;
    return { title: `Cancelled: ${title}`, body: `${body}\n\n${footer}` };
  }
  const lines = [`${whenText(ev)}.`];
  if (series && series.count > 1) {
    lines.push(kind === "new"
      ? `${repeatLabel(series.rule, series.until)} (${series.count} dates).`
      : `This applies from ${longDate(series.fromDate)} onwards.`);
  }
  if (String(ev.description || "").trim()) lines.push(String(ev.description).trim());
  return { title: `${kind === "new" ? "New event" : "Updated"}: ${title}`, body: `${lines.join("\n\n")}\n\n${footer}` };
}
