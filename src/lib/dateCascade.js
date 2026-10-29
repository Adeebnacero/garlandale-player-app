// ---------------------------------------------------------------------------
// Generic "cascade by month" helpers for any list of dated rows. Used by
// Fixtures and Matchday to filter a list down to a single month/year, the
// same pattern Finance already uses for its ledger (see financeCalc.js).
// Kept separate from financeCalc.js because that module's period helpers are
// entangled with ledger balance/stat calculations that don't apply here.
// ---------------------------------------------------------------------------

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Years present across `rows` (via `getDate`), plus the current year so the
 * dropdown always has somewhere sensible to land even with no data yet.
 * Descending, most recent first.
 */
export function computeAvailableYears(rows, getDate, today) {
  const years = new Set([today.getUTCFullYear()]);
  (rows || []).forEach((r) => {
    const raw = getDate(r);
    if (!raw) return;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) years.add(d.getUTCFullYear());
  });
  return Array.from(years).sort((a, b) => b - a);
}

/** [start, end] UTC bounds (end inclusive) for a given year/month (0-11). */
export function computeMonthRange(year, month) {
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));
  return { start, end };
}

/** Rows whose date (via `getDate`) falls within the given year/month. */
export function filterByMonth(rows, getDate, year, month) {
  const { start, end } = computeMonthRange(year, month);
  return (rows || []).filter((r) => {
    const raw = getDate(r);
    if (!raw) return false;
    const d = new Date(raw);
    return !isNaN(d.getTime()) && d >= start && d <= end;
  });
}

/**
 * Distinct "YYYY-M" keys present in `rows`, newest first, each with a
 * ready-to-render label like "March 2026" - handy for a single "jump to
 * month" dropdown built straight from the data rather than from a
 * fixed year/month pair of selects.
 */
export function computeMonthOptions(rows, getDate) {
  const map = new Map();
  (rows || []).forEach((r) => {
    const raw = getDate(r);
    if (!raw) return;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return;
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const key = `${year}-${month}`;
    if (!map.has(key)) map.set(key, { key, year, month, label: `${MONTH_NAMES[month]} ${year}` });
  });
  return Array.from(map.values()).sort((a, b) => (b.year - a.year) || (b.month - a.month));
}
