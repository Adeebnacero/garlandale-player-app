// billing.test.js
//
// Automated test suite for billing.js - the season/proration/compliance
// math that determines what every family is told they owe. Run with:
//
//   deno test supabase/functions/_shared/
//
// (Deno's test runner auto-discovers any *.test.js file, so no extra
// config is needed - this matches billing.js's own "zero dependencies"
// design, so no std-lib import is needed either: the tiny assert
// helpers below are all this file needs beyond billing.js itself.)
//
// Every test pins an explicit `today` rather than relying on the real
// current date, so results are 100% deterministic regardless of when the
// suite runs - this was the #1 reason billing.js was written to accept
// `today` as a parameter in the first place (see billing.js's own
// top-of-file comment).

import {
  computeAgeGroup,
  computeExactAge,
  isOver40,
  yearsOfService,
  ageGroupSortKey,
  sortAgeGroups,
  buildActiveSegments,
  monthHasActiveOverlap,
  totalSeasonMonthsDue,
  playerFinance,
  complianceStatus,
  complianceReason,
} from "./billing.js";

// ---------------------------------------------------------------------------
// Tiny assertion helpers - deliberately not importing Deno's std/testing
// asserts, to keep this file as dependency-free as billing.js itself.
// ---------------------------------------------------------------------------

function assertEqual(actual, expected, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

function assertClose(actual, expected, msg = "") {
  if (Math.abs(actual - expected) > 0.001) {
    throw new Error(`${msg}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
}

// UTC-anchored date helper, matching how billing.js itself reads dates -
// avoids any test ever depending on the machine's local timezone.
const d = (s) => new Date(s + "T00:00:00Z");

// ---------------------------------------------------------------------------
// computeAgeGroup - the 31 August cutoff
// ---------------------------------------------------------------------------

Deno.test("computeAgeGroup: before the Aug 31 cutoff uses the current year", () => {
  // Born May 2015, today is June 2024 (before the cutoff) -> cutoff year
  // is 2024 itself -> age 9 -> U9.
  assertEqual(computeAgeGroup("2015-05-01", d("2024-06-01")), "U9");
});

Deno.test("computeAgeGroup: on/after the Aug 31 cutoff rolls to next season's year", () => {
  // Same birth date, but today is September 2024 (past the cutoff) ->
  // cutoff year rolls to 2025 -> age 10 -> U10.
  assertEqual(computeAgeGroup("2015-05-01", d("2024-09-01")), "U10");
});

Deno.test("computeAgeGroup: exactly on the cutoff date (Aug 31) still uses the current year", () => {
  // getUTCMonth() >= 8 (September, 0-indexed) is what rolls the year -
  // Aug 31 is month 7, so it does NOT roll yet.
  assertEqual(computeAgeGroup("2015-08-31", d("2024-08-31")), "U9");
});

Deno.test("computeAgeGroup: September 1 is the first day the cutoff has rolled", () => {
  assertEqual(computeAgeGroup("2015-09-01", d("2024-09-01")), "U10");
});

Deno.test("computeAgeGroup: 18+ is always Seniors", () => {
  assertEqual(computeAgeGroup("2000-01-01", d("2024-06-01")), "Seniors");
});

Deno.test("computeAgeGroup: age 0 or negative (future/newborn edge) is Unassigned", () => {
  assertEqual(computeAgeGroup("2024-01-01", d("2024-06-01")), "Unassigned");
});

Deno.test("computeAgeGroup: missing or invalid dob is Unassigned, not a thrown error", () => {
  assertEqual(computeAgeGroup(null), "Unassigned");
  assertEqual(computeAgeGroup(""), "Unassigned");
  assertEqual(computeAgeGroup("not-a-date"), "Unassigned");
});

// ---------------------------------------------------------------------------
// computeExactAge / isOver40
// ---------------------------------------------------------------------------

Deno.test("computeExactAge: birthday not yet reached this year counts the lower age", () => {
  assertEqual(computeExactAge("1984-06-15", d("2024-06-14")), 39);
});

Deno.test("computeExactAge: on the exact birthday, the new age already counts", () => {
  assertEqual(computeExactAge("1984-06-15", d("2024-06-15")), 40);
});

Deno.test("isOver40: false the day before turning 40, true from the birthday itself", () => {
  assertEqual(isOver40("1984-06-15", d("2024-06-14")), false);
  assertEqual(isOver40("1984-06-15", d("2024-06-15")), true);
});

// ---------------------------------------------------------------------------
// yearsOfService
// ---------------------------------------------------------------------------

Deno.test("yearsOfService: under a month reads as 'Less than a month'", () => {
  assertEqual(yearsOfService("2024-06-01", d("2024-06-15")), "Less than a month");
});

Deno.test("yearsOfService: day-of-month rollover borrows correctly (Jan 15 -> Jun 1 = 4 months, not 5)", () => {
  // From 2023-01-15 to 2024-06-01: naive month diff is 17 months (1y5m),
  // but the 1st is before the 15th, so the partial last month doesn't
  // count yet -> 1 year, 4 months.
  assertEqual(yearsOfService("2023-01-15", d("2024-06-01")), "1 year, 4 months");
});

Deno.test("yearsOfService: exact whole years with no leftover months", () => {
  assertEqual(yearsOfService("2020-01-01", d("2024-01-01")), "4 years");
});

Deno.test("yearsOfService: a join date in the future reads as 'Not yet started'", () => {
  assertEqual(yearsOfService("2099-01-01", d("2024-06-01")), "Not yet started");
});

// ---------------------------------------------------------------------------
// sortAgeGroups
// ---------------------------------------------------------------------------

Deno.test("sortAgeGroups: numeric U-groups in order, Seniors then Unassigned last", () => {
  assertEqual(
    sortAgeGroups(["Seniors", "U9", "Unassigned", "U7", "U10", "U8"]),
    ["U7", "U8", "U9", "U10", "Seniors", "Unassigned"]
  );
});

// ---------------------------------------------------------------------------
// buildActiveSegments / monthHasActiveOverlap
// ---------------------------------------------------------------------------

Deno.test("buildActiveSegments: no status changes means one open-ended active segment from joinDate", () => {
  const segs = buildActiveSegments("2024-01-01", []);
  assertEqual(segs.length, 1);
  assertEqual(segs[0].status, "active");
  assertEqual(segs[0].start.toISOString().slice(0, 10), "2024-01-01");
});

Deno.test("buildActiveSegments: an invalid join date returns no segments rather than throwing", () => {
  assertEqual(buildActiveSegments("not-a-date", []), []);
});

Deno.test("buildActiveSegments: out-of-order status log entries are sorted before building segments", () => {
  // Deliberately passed in reverse chronological order.
  const log = [
    { status: "active", changedAt: "2024-05-01T00:00:00Z" },
    { status: "inactive", changedAt: "2024-03-01T00:00:00Z" },
  ];
  const segs = buildActiveSegments("2024-01-01", log);
  assertEqual(segs.map((s) => s.status), ["active", "inactive", "active"]);
});

// ---------------------------------------------------------------------------
// totalSeasonMonthsDue - the core proration engine
// ---------------------------------------------------------------------------

Deno.test("totalSeasonMonthsDue: the join month itself is due immediately, even mid-month", () => {
  assertEqual(totalSeasonMonthsDue("2024-01-01", [], d("2024-01-15")), 1);
});

Deno.test("totalSeasonMonthsDue: accrues one month per elapsed calendar month, current month included", () => {
  // Jan, Feb, Mar all due by March 20th.
  assertEqual(totalSeasonMonthsDue("2024-01-01", [], d("2024-03-20")), 3);
});

Deno.test("totalSeasonMonthsDue: a full season (Jan-Oct) is 10 months", () => {
  assertEqual(totalSeasonMonthsDue("2024-01-01", [], d("2024-10-31")), 10);
});

Deno.test("totalSeasonMonthsDue: November/December accrue nothing on top of a full season", () => {
  assertEqual(totalSeasonMonthsDue("2024-01-01", [], d("2024-11-15")), 10);
  assertEqual(totalSeasonMonthsDue("2024-01-01", [], d("2024-12-31")), 10);
});

Deno.test("totalSeasonMonthsDue: balance is a running total across season boundaries, not reset each January", () => {
  // 10 months for 2024 + Jan, Feb, Mar of 2025 = 13.
  assertEqual(totalSeasonMonthsDue("2024-01-01", [], d("2025-03-15")), 13);
});

Deno.test("totalSeasonMonthsDue: joining mid-season prorates from the join month, not January", () => {
  assertEqual(totalSeasonMonthsDue("2024-06-10", [], d("2024-06-15")), 1);
  // June through October = 5 months.
  assertEqual(totalSeasonMonthsDue("2024-06-10", [], d("2024-10-31")), 5);
});

Deno.test("totalSeasonMonthsDue: joining after the season end (Nov/Dec) accrues nothing that same year", () => {
  assertEqual(totalSeasonMonthsDue("2024-11-05", [], d("2024-12-01")), 0);
});

Deno.test("totalSeasonMonthsDue: a late-year join still bills normally once the next season starts", () => {
  // Joined Nov 2024 (nothing accrues in 2024); by March 2025, Jan-Mar
  // 2025 (3 months) are due.
  assertEqual(totalSeasonMonthsDue("2024-11-05", [], d("2025-03-15")), 3);
});

Deno.test("totalSeasonMonthsDue: billingStartDate defers the start of billing without touching join history", () => {
  // A long-standing member (joined 2018) whose billing only starts in
  // 2024 owes nothing for 2018-2023, and prorates from 2024 like a new
  // member would.
  assertEqual(
    totalSeasonMonthsDue("2018-01-01", [], d("2024-03-15"), "2024-01-01"),
    3
  );
});

Deno.test("totalSeasonMonthsDue: a paused month is not billed; billing resumes the month it restarts", () => {
  // Active Jan1-Mar1, inactive Mar1-May1, active May1 onward.
  // Interval semantics are half-open ([start, end)): whichever status is
  // in effect as of the 1st of a calendar month decides whether that
  // whole month is billed. So the pause takes effect FROM March (not
  // billed) and billing resumes FROM May (billed in full), even though
  // both changes were logged mid-way through those months in principle -
  // this test pins that behaviour explicitly since it's easy to
  // misread as an off-by-one if changed casually later.
  const statusLog = [
    { status: "inactive", changedAt: "2024-03-01T00:00:00Z" },
    { status: "active", changedAt: "2024-05-01T00:00:00Z" },
  ];
  // Jan, Feb, May, Jun due; Mar, Apr skipped = 4 months by June 15.
  assertEqual(totalSeasonMonthsDue("2024-01-01", statusLog, d("2024-06-15")), 4);
});

Deno.test("totalSeasonMonthsDue: multiple pause/resume cycles across a season all apply independently", () => {
  const statusLog = [
    { status: "inactive", changedAt: "2024-02-01T00:00:00Z" },
    { status: "active", changedAt: "2024-03-01T00:00:00Z" },
    { status: "inactive", changedAt: "2024-05-01T00:00:00Z" },
    { status: "active", changedAt: "2024-06-01T00:00:00Z" },
  ];
  // Jan (active), Feb (paused), Mar (active), Apr (active),
  // May (paused), Jun (active) = 4 months due by June 30.
  assertEqual(totalSeasonMonthsDue("2024-01-01", statusLog, d("2024-06-30")), 4);
});

// ---------------------------------------------------------------------------
// playerFinance
// ---------------------------------------------------------------------------

const TIERS = [{ id: "t1", name: "Standard", monthlyFee: 250 }];

function makePlayer(overrides = {}) {
  return {
    joinDate: "2024-01-01",
    billingStartDate: null,
    tierId: "t1",
    active: true,
    documentsComplete: true,
    statusLog: [],
    payments: [],
    ...overrides,
  };
}

Deno.test("playerFinance: due is monthsDue * monthly fee, balance is due minus paid", () => {
  const player = makePlayer({ payments: [{ amount: 500 }] });
  const finance = playerFinance(player, TIERS, d("2024-03-15")); // 3 months due
  assertClose(finance.due, 750);
  assertClose(finance.paid, 500);
  assertClose(finance.balance, 250);
  assertEqual(finance.tierName, "Standard");
});

Deno.test("playerFinance: an unassigned/unknown tier is treated as a R0 fee, not a crash", () => {
  const player = makePlayer({ tierId: "does-not-exist" });
  const finance = playerFinance(player, TIERS, d("2024-03-15"));
  assertClose(finance.due, 0);
  assertEqual(finance.tierName, "");
});

Deno.test("playerFinance: multiple payments sum correctly, including an overpayment going negative (credit)", () => {
  const player = makePlayer({ payments: [{ amount: 250 }, { amount: 250 }, { amount: 750 }] });
  const finance = playerFinance(player, TIERS, d("2024-03-15")); // 750 due
  assertClose(finance.paid, 1250);
  assertClose(finance.balance, -500);
});

// ---------------------------------------------------------------------------
// complianceStatus / complianceReason - single source of truth, so status
// and its human-readable explanation are tested together throughout.
// ---------------------------------------------------------------------------

Deno.test("compliance: inactive players are always 'inactive', regardless of balance", () => {
  const player = makePlayer({ active: false, payments: [] }); // would otherwise be red
  assertEqual(complianceStatus(player, TIERS, d("2024-03-15")), "inactive");
  assertEqual(complianceReason(player, TIERS, d("2024-03-15")), "Player is marked inactive.");
});

Deno.test("compliance: incomplete documents are 'red' even if fully paid", () => {
  const player = makePlayer({ documentsComplete: false, payments: [{ amount: 750 }] });
  assertEqual(complianceStatus(player, TIERS, d("2024-03-15")), "red");
});

Deno.test("compliance: no tier assigned yet is 'amber'", () => {
  const player = makePlayer({ tierId: null });
  assertEqual(complianceStatus(player, TIERS, d("2024-03-15")), "amber");
});

Deno.test("compliance: fully paid (balance <= 0) is 'green'", () => {
  const player = makePlayer({ payments: [{ amount: 750 }] });
  assertEqual(complianceStatus(player, TIERS, d("2024-03-15")), "green");
  assertEqual(complianceReason(player, TIERS, d("2024-03-15")), "Fully paid up.");
});

Deno.test("compliance: owing up to one month's fee is 'amber', not 'red'", () => {
  const player = makePlayer({ payments: [{ amount: 500 }] }); // owes exactly 250 = 1 fee
  assertEqual(complianceStatus(player, TIERS, d("2024-03-15")), "amber");
  assertEqual(complianceReason(player, TIERS, d("2024-03-15")), "Owes R250,00 — within one month's fee.");
});

Deno.test("compliance: owing more than one month's fee is 'red'", () => {
  const player = makePlayer({ payments: [] }); // owes 750, fee is 250
  assertEqual(complianceStatus(player, TIERS, d("2024-03-15")), "red");
  assertEqual(complianceReason(player, TIERS, d("2024-03-15")), "Owes R750,00 — more than one month's fee.");
});

Deno.test("compliance: a credit balance (overpaid) still reads as 'green', not amber/red", () => {
  const player = makePlayer({ payments: [{ amount: 1250 }] });
  assertEqual(complianceStatus(player, TIERS, d("2024-03-15")), "green");
});
