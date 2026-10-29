import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Federation fixture spreadsheets list every match across every division in
// the league, one row each, with team names carrying a code prefix (e.g.
// "O3-16- Garlandale"). This module finds every row involving Garlandale,
// cleans up the names, and turns them into rows ready to store in the
// `fixtures` table (see schema.sql).
// ---------------------------------------------------------------------------

/** Reads the uploaded file (an ArrayBuffer) into an array of row objects. */
export function parseFederationWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

/** Strips a leading team code like "O3-16- " or "D4-01- " off a team name. */
export function stripTeamCode(name) {
  return String(name || "").replace(/^[A-Za-z0-9]+-\d+-\s*/, "").trim();
}

export function isGarlandale(name) {
  return stripTeamCode(name).toLowerCase().includes("garlandale");
}

function parseFedDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      let [, d, mo, y] = m;
      let year = parseInt(y, 10);
      if (y.length === 2) year += 2000;
      return new Date(Date.UTC(year, parseInt(mo, 10) - 1, parseInt(d, 10)));
    }
  }
  return null;
}

/** Parses a federation time value into a proper "HH:MM" 24-hour string, suitable for storing in a SQL `time` column. */
export function parseFedTime(value) {
  if (value instanceof Date) {
    const hh = String(value.getUTCHours()).padStart(2, "0");
    const mm = String(value.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  if (typeof value === "string") {
    const m = value.trim().match(/^(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  }
  return null;
}

/** Formats a stored "HH:MM" time as "08h15" - the display convention used on the poster/PDF/fixtures table. */
export function formatDisplayTime(hhmm) {
  if (!hhmm) return "";
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(hhmm);
  return `${m[1].padStart(2, "0")}h${m[2]}`;
}

/** Formats a date as "18 July 2026" - the display convention used on the poster/PDF/fixtures table. */
export function fmtImportDateHeader(date) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  return `${day} ${month} ${d.getUTCFullYear()}`;
}

/**
 * Scans every row for Garlandale involvement (either side) and returns a
 * clean, sorted list ready to store: { division, opponent, date, time,
 * venue, homeAway }. `date` is a Date (UTC midnight), `time` is "HH:MM" or
 * null - both are storage-ready, not display-formatted (see
 * formatDisplayTime/fmtImportDateHeader for that).
 */
export function extractGarlandaleFixtures(rows) {
  const results = [];
  for (const row of rows) {
    const home = row["Home Team"];
    const away = row["Away Team"];
    const homeIsUs = isGarlandale(home);
    const awayIsUs = isGarlandale(away);
    if (!homeIsUs && !awayIsUs) continue;

    const opponentRaw = homeIsUs ? away : home;
    const opponent = stripTeamCode(opponentRaw);
    const division = String(row["Division"] || row["Competition"] || "").trim();
    const date = parseFedDate(row["Date"]);
    const time = parseFedTime(row["Time"]);
    const venue = String(row["Pitch"] || row["Venue"] || "").trim();
    const homeAway = homeIsUs ? "H" : "A";

    results.push({ division, opponent, date, time, venue, homeAway });
  }

  results.sort((a, b) => {
    if (!a.date || !b.date) return 0;
    const d = a.date.getTime() - b.date.getTime();
    if (d !== 0) return d;
    return (a.time || "").localeCompare(b.time || "");
  });
  return results;
}

/** Every distinct division seen that doesn't yet have a saved friendly label. */
export function findUnmappedDivisions(fixtures, divisionLabelMap) {
  const seen = new Set();
  const unmapped = [];
  for (const f of fixtures) {
    if (!f.division || seen.has(f.division)) continue;
    seen.add(f.division);
    if (!divisionLabelMap[f.division]) unmapped.push(f.division);
  }
  return unmapped;
}

/** Groups fixtures by calendar day - used by the Fixtures tab's table view and the poster/PDF selection. */
export function groupFixturesByDate(fixtures) {
  const groups = new Map();
  for (const f of fixtures) {
    const key = f.date ? (f.date instanceof Date ? f.date.toISOString().slice(0, 10) : String(f.date).slice(0, 10)) : "unknown";
    if (!groups.has(key)) groups.set(key, { date: f.date, rows: [] });
    groups.get(key).rows.push(f);
  }
  return Array.from(groups.keys())
    .sort()
    .map((key) => groups.get(key));
}
