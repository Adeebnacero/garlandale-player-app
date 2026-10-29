import { describe, it, expect } from "vitest";
import {
  buildCombinedLedger,
  computePeriodRange,
  computePeriodLabel,
  computeBalanceCutoff,
  isPastPeriod,
  computeStats,
  computeMonthlyChartData,
  computeAvailableYears,
  filterLedger,
} from "./financeCalc.js";

// A fixed "today" so every test is deterministic regardless of what
// timezone runs the suite. Constructed via Date.UTC deliberately - see
// billing.test.js for why local-time construction here would make some
// of these tests timezone-dependent.
const TODAY = new Date(Date.UTC(2026, 6, 13)); // 13 July 2026

// A realistic ledger spanning two years, including an opening balance and
// a mix of manual entries - used across most of the tests below.
const LEDGER = [
  { id: "1", date: "2025-01-01", type: "income", category: "Opening Balance", amount: 1000 },
  { id: "2", date: "2025-03-15", type: "income", category: "Donation", amount: 500 },
  { id: "3", date: "2025-06-10", type: "expense", category: "Equipment", amount: 300 },
  { id: "4", date: "2026-01-20", type: "income", category: "Sponsorship", amount: 800 },
  { id: "5", date: "2026-03-05", type: "expense", category: "Ground hire", amount: 200 },
  { id: "6", date: "2026-03-25", type: "income", category: "Donation", amount: 150 },
];

describe("buildCombinedLedger", () => {
  it("merges manual entries and subscription payments into one sorted ledger", () => {
    const financeEntries = [
      { id: "m1", date: "2026-01-01", description: "Donation", category: "Donation", type: "income", amount: 100 },
    ];
    const players = [
      { name: "Thabo Nkosi", payments: [{ id: "p1", date: "2026-02-01", amount: 350 }] },
    ];
    const ledger = buildCombinedLedger(financeEntries, players);
    expect(ledger).toHaveLength(2);
    expect(ledger.find((r) => r.id === "m1").isSubscription).toBe(false);
    expect(ledger.find((r) => r.id === "sub-p1")).toMatchObject({
      description: "Subscription — Thabo Nkosi",
      category: "Subscription",
      type: "income",
      amount: 350,
      isSubscription: true,
    });
  });

  it("sorts newest first", () => {
    const financeEntries = [
      { id: "a", date: "2026-01-01", description: "Old", category: "Donation", type: "income", amount: 10 },
      { id: "b", date: "2026-06-01", description: "New", category: "Donation", type: "income", amount: 20 },
    ];
    const ledger = buildCombinedLedger(financeEntries, []);
    expect(ledger.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("handles no players or entries gracefully", () => {
    expect(buildCombinedLedger([], [])).toEqual([]);
    expect(buildCombinedLedger(undefined, undefined)).toEqual([]);
  });
});

describe("computePeriodRange", () => {
  it("computes a full calendar month for 'month' mode", () => {
    const range = computePeriodRange("month", 2026, 2); // March 2026
    expect(range.start).toEqual(new Date(Date.UTC(2026, 2, 1)));
    expect(range.end).toEqual(new Date(Date.UTC(2026, 2, 31, 23, 59, 59)));
  });

  it("computes a full calendar year for 'year' mode", () => {
    const range = computePeriodRange("year", 2025, 6);
    expect(range.start).toEqual(new Date(Date.UTC(2025, 0, 1)));
    expect(range.end).toEqual(new Date(Date.UTC(2025, 11, 31, 23, 59, 59)));
  });

  it("returns null boundaries for 'all' mode", () => {
    expect(computePeriodRange("all", 2026, 6)).toEqual({ start: null, end: null });
  });
});

describe("computeBalanceCutoff / isPastPeriod", () => {
  it("uses today as the cutoff when the period includes today (current month)", () => {
    const range = computePeriodRange("month", 2026, 6); // July 2026, today is 13 July
    expect(computeBalanceCutoff(range, TODAY)).toBe(TODAY);
    expect(isPastPeriod(range, TODAY)).toBe(false);
  });

  it("uses the period's own end date when looking at a past period", () => {
    const range = computePeriodRange("month", 2026, 2); // March 2026 - already over
    const cutoff = computeBalanceCutoff(range, TODAY);
    expect(cutoff).toEqual(new Date(Date.UTC(2026, 2, 31, 23, 59, 59)));
    expect(isPastPeriod(range, TODAY)).toBe(true);
  });

  it("uses today as the cutoff for 'all time'", () => {
    const range = computePeriodRange("all", 2026, 6);
    expect(computeBalanceCutoff(range, TODAY)).toBe(TODAY);
    expect(isPastPeriod(range, TODAY)).toBe(false);
  });
});

describe("computeStats - the core dashboard figures", () => {
  it("computes correct totals for all time", () => {
    const range = computePeriodRange("all", 2026, 6);
    const cutoff = computeBalanceCutoff(range, TODAY);
    const stats = computeStats(LEDGER, range, cutoff, []);
    // balance: 1000 + 500 - 300 + 800 - 200 + 150 = 1950
    // income (excl. Opening Balance): 500 + 800 + 150 = 1450
    // expense: 300 + 200 = 500
    expect(stats.balance).toBe(1950);
    expect(stats.totalIncome).toBe(1450);
    expect(stats.totalExpense).toBe(500);
  });

  it("computes a past year's balance as of the end of that year, not today", () => {
    const range = computePeriodRange("year", 2025, 6);
    const cutoff = computeBalanceCutoff(range, TODAY);
    const stats = computeStats(LEDGER, range, cutoff, []);
    // balance as of end of 2025: 1000 + 500 - 300 = 1200
    expect(stats.balance).toBe(1200);
    expect(stats.totalIncome).toBe(500);
    expect(stats.totalExpense).toBe(300);
  });

  it("computes the current (partial) year using today's real balance, not year-end", () => {
    const range = computePeriodRange("year", 2026, 6);
    const cutoff = computeBalanceCutoff(range, TODAY);
    const stats = computeStats(LEDGER, range, cutoff, []);
    // balance as of today (13 Jul 2026): 1200 + 800 - 200 + 150 = 1950
    expect(stats.balance).toBe(1950);
    expect(stats.totalIncome).toBe(950); // 800 + 150, within 2026 only
    expect(stats.totalExpense).toBe(200);
  });

  it("computes a specific past month correctly", () => {
    const range = computePeriodRange("month", 2026, 0); // January 2026
    const cutoff = computeBalanceCutoff(range, TODAY);
    const stats = computeStats(LEDGER, range, cutoff, []);
    // balance as of end of Jan 2026: 1200 + 800 = 2000
    expect(stats.balance).toBe(2000);
    expect(stats.totalIncome).toBe(800);
    expect(stats.totalExpense).toBe(0);
  });

  it("adds current asset value to cash balance for net worth, regardless of period", () => {
    const range = computePeriodRange("all", 2026, 6);
    const cutoff = computeBalanceCutoff(range, TODAY);
    const assets = [{ quantity: 2, unitValue: 500 }, { quantity: 1, unitValue: 1000 }];
    const stats = computeStats(LEDGER, range, cutoff, assets);
    expect(stats.assetsValue).toBe(2000); // (2*500) + (1*1000)
    expect(stats.netWorth).toBe(stats.balance + 2000);
  });

  it("excludes the Opening Balance category from income/expense flow totals", () => {
    const range = computePeriodRange("year", 2025, 6);
    const cutoff = computeBalanceCutoff(range, TODAY);
    const stats = computeStats(LEDGER, range, cutoff, []);
    // The 1000 Opening Balance entry (Jan 2025) must not appear as "income"
    expect(stats.totalIncome).toBe(500);
  });
});

describe("computeMonthlyChartData", () => {
  it("buckets income/expense correctly by month for the given year", () => {
    const chart = computeMonthlyChartData(LEDGER, "year", 2026, TODAY);
    expect(chart.year).toBe(2026);
    const jan = chart.data.find((m) => m.month === "Jan");
    const mar = chart.data.find((m) => m.month === "Mar");
    expect(jan).toMatchObject({ income: 800, expense: 0 });
    expect(mar).toMatchObject({ income: 150, expense: 200 });
    // every other month should be zero
    const others = chart.data.filter((m) => m.month !== "Jan" && m.month !== "Mar");
    others.forEach((m) => {
      expect(m.income).toBe(0);
      expect(m.expense).toBe(0);
    });
  });

  it("excludes Opening Balance from the chart", () => {
    const chart = computeMonthlyChartData(LEDGER, "year", 2025, TODAY);
    const jan2025 = chart.data.find((m) => m.month === "Jan");
    expect(jan2025.income).toBe(0); // the 1000 Opening Balance entry is excluded
  });

  it("defaults to today's year when viewMode is 'all'", () => {
    const chart = computeMonthlyChartData(LEDGER, "all", 2020, TODAY);
    expect(chart.year).toBe(TODAY.getFullYear());
  });
});

describe("computeAvailableYears", () => {
  it("includes every year present in the ledger, plus the current year, sorted newest first", () => {
    const years = computeAvailableYears(LEDGER, TODAY);
    expect(years).toEqual([2026, 2025]);
  });

  it("still includes the current year even with an empty ledger", () => {
    expect(computeAvailableYears([], TODAY)).toEqual([2026]);
  });
});

describe("filterLedger", () => {
  it("filters to the selected period", () => {
    const range = computePeriodRange("year", 2025, 6);
    const rows = filterLedger(LEDGER, range, "All");
    expect(rows.map((r) => r.id).sort()).toEqual(["1", "2", "3"]);
  });

  it("filters by category on top of the period", () => {
    const range = computePeriodRange("all", 2026, 6);
    const rows = filterLedger(LEDGER, range, "Donation");
    expect(rows.map((r) => r.id).sort()).toEqual(["2", "6"]);
  });

  it("returns everything for 'all' period with no category filter", () => {
    const range = computePeriodRange("all", 2026, 6);
    expect(filterLedger(LEDGER, range, "All")).toHaveLength(LEDGER.length);
  });
});
