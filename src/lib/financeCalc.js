// ---------------------------------------------------------------------------
// Pure finance calculation logic, extracted from the Finance.jsx component
// so it can be unit tested directly (see financeCalc.test.js), the same way
// billing.js is - this is now the second most financially consequential
// piece of logic in the app after season billing, so it gets the same
// testing discipline.
// ---------------------------------------------------------------------------

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Builds one combined ledger from two sources:
 *  - manual finance_entries (bank transactions, donations, other income/expense)
 *  - subscription payments, read LIVE from each player's payment history
 * Subscription payments are never copied into finance_entries - this keeps
 * a single source of truth, so editing a payment in a player's ledger is
 * automatically reflected here too, with no risk of the two drifting apart.
 */
export function buildCombinedLedger(financeEntries, players) {
  const manual = (financeEntries || []).map((e) => ({
    id: e.id, date: e.date, description: e.description, category: e.category,
    type: e.type, amount: e.amount, isSubscription: false,
  }));

  const subscriptionRows = (players || []).flatMap((p) =>
    (p.payments || []).map((pm) => ({
      id: `sub-${pm.id}`, date: pm.date, description: `Subscription — ${p.name}`,
      category: "Subscription", type: "income", amount: Number(pm.amount) || 0, isSubscription: true,
    }))
  );

  return [...manual, ...subscriptionRows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/**
 * The period currently being viewed, as [start, end] (end is inclusive,
 * last instant of the period) - drives both the stat totals and which
 * ledger rows are shown for "Month"/"Year" modes. "all" returns nulls,
 * meaning "no boundary, include everything".
 *
 * UTC-anchored throughout: entry dates are plain "YYYY-MM-DD" strings,
 * which JS parses as UTC midnight - anchoring boundaries to local time
 * instead (as an earlier version of this file did) caused entries near a
 * month boundary to be silently miscounted in any timezone behind UTC
 * (verified: correct in Cape Town/UTC+2, wrong in US timezones). Matches
 * the same fix already applied to src/lib/billing.js for the same reason.
 */
export function computePeriodRange(viewMode, selectedYear, selectedMonth) {
  if (viewMode === "month") {
    const start = new Date(Date.UTC(selectedYear, selectedMonth, 1));
    const end = new Date(Date.UTC(selectedYear, selectedMonth + 1, 0, 23, 59, 59));
    return { start, end };
  }
  if (viewMode === "year") {
    const start = new Date(Date.UTC(selectedYear, 0, 1));
    const end = new Date(Date.UTC(selectedYear, 11, 31, 23, 59, 59));
    return { start, end };
  }
  return { start: null, end: null };
}

export function computePeriodLabel(viewMode, selectedYear, selectedMonth) {
  if (viewMode === "month") return `${MONTH_NAMES[selectedMonth]} ${selectedYear}`;
  if (viewMode === "year") return `${selectedYear}`;
  return "All time";
}

/**
 * "As of" cutoff for the cash balance - the end of the selected period, or
 * `today` if that period includes today (so looking at the current
 * month/year still shows today's real balance, not an artificially
 * earlier one).
 */
export function computeBalanceCutoff(periodRange, today) {
  if (!periodRange.end) return today;
  return periodRange.end < today ? periodRange.end : today;
}

export function isPastPeriod(periodRange, today) {
  return !!(periodRange.end && periodRange.end < today);
}

/**
 * Computes the dashboard stat figures for the given ledger/period:
 *  - balance: cash balance as of balanceCutoff (a running total of every
 *    entry up to that point - NOT limited to the selected period, since a
 *    bank balance is inherently cumulative)
 *  - totalIncome / totalExpense: flow totals WITHIN the selected period only
 *    (excludes the "Opening Balance" category, which is a one-off starting
 *    point, not a recurring income event)
 *  - assetsValue / netWorth: assetsValue is always "as of today" (there's
 *    no historical asset-value tracking); netWorth = balance + assetsValue
 */
export function computeStats(ledger, periodRange, balanceCutoff, assets) {
  let balance = 0;
  let totalIncome = 0;
  let totalExpense = 0;
  for (const row of ledger) {
    const d = new Date(row.date);
    const signed = row.type === "expense" ? -row.amount : row.amount;
    if (d <= balanceCutoff) balance += signed;

    const withinPeriod = !periodRange.start || (d >= periodRange.start && d <= periodRange.end);
    if (withinPeriod && row.category !== "Opening Balance") {
      if (row.type === "expense") totalExpense += row.amount;
      else totalIncome += row.amount;
    }
  }
  const assetsValue = (assets || []).reduce((s, a) => s + (Number(a.quantity) || 0) * (Number(a.unitValue) || 0), 0);
  return { balance, totalIncome, totalExpense, assetsValue, netWorth: balance + assetsValue };
}

/**
 * Monthly income/expense breakdown for whichever year is currently
 * selected - shown regardless of Month/Year/All-time mode, since it's a
 * "look at the shape of the year" view rather than a single-period total.
 * When viewMode is "all", defaults to today's year.
 */
export function computeMonthlyChartData(ledger, viewMode, selectedYear, today) {
  const chartYear = viewMode === "all" ? today.getUTCFullYear() : selectedYear;
  const months = MONTH_NAMES.map((name) => ({ month: name.slice(0, 3), income: 0, expense: 0 }));
  ledger.forEach((row) => {
    if (row.category === "Opening Balance") return;
    const d = new Date(row.date);
    if (isNaN(d.getTime()) || d.getUTCFullYear() !== chartYear) return;
    const bucket = months[d.getUTCMonth()];
    if (row.type === "expense") bucket.expense += row.amount;
    else bucket.income += row.amount;
  });
  return { year: chartYear, data: months };
}

export function computeAvailableYears(ledger, today) {
  const years = new Set([today.getUTCFullYear()]);
  ledger.forEach((r) => {
    const d = new Date(r.date);
    if (!isNaN(d.getTime())) years.add(d.getUTCFullYear());
  });
  return Array.from(years).sort((a, b) => b - a);
}

export function filterLedger(ledger, periodRange, categoryFilter) {
  let rows = ledger;
  if (periodRange.start) {
    rows = rows.filter((r) => {
      const d = new Date(r.date);
      return d >= periodRange.start && d <= periodRange.end;
    });
  }
  if (categoryFilter && categoryFilter !== "All") rows = rows.filter((r) => r.category === categoryFilter);
  return rows;
}
