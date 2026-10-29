import { describe, it, expect } from "vitest";
import {
  computeAgeGroup,
  computeExactAge,
  isOver40,
  ageGroupSortKey,
  sortAgeGroups,
  buildActiveSegments,
  monthHasActiveOverlap,
  totalSeasonMonthsDue,
  playerFinance,
  complianceStatus,
  yearsOfService,
} from "./billing.js";

// A fixed "today" so every test is deterministic regardless of what
// timezone runs the suite. Constructed via Date.UTC deliberately - see the
// UTC-consistency notes in billing.js for why local-time construction here
// would make some of these tests timezone-dependent (and once did).
const TODAY = new Date(Date.UTC(2026, 6, 10)); // 10 July 2026 (month is 0-indexed: 6 = July)
const TODAY_OCT = new Date(Date.UTC(2026, 9, 1)); // 1 October 2026 - past the Aug 31 age-group cutoff

describe("computeAgeGroup", () => {
  it("computes the right U-group before the Aug 31 cutoff", () => {
    expect(computeAgeGroup("2017-05-01", TODAY)).toBe("U9");
  });

  it("bumps everyone up a group once the season's cutoff has passed", () => {
    expect(computeAgeGroup("2017-05-01", TODAY_OCT)).toBe("U10");
  });

  it("returns Seniors for anyone 18 or older", () => {
    expect(computeAgeGroup("2005-01-01", TODAY)).toBe("Seniors");
  });

  it("returns Unassigned when there's no date of birth", () => {
    expect(computeAgeGroup(null, TODAY)).toBe("Unassigned");
    expect(computeAgeGroup(undefined, TODAY)).toBe("Unassigned");
  });

  it("returns Unassigned for an invalid or future date of birth", () => {
    expect(computeAgeGroup("not-a-date", TODAY)).toBe("Unassigned");
    expect(computeAgeGroup("2027-01-01", TODAY)).toBe("Unassigned");
  });
});

describe("computeExactAge / isOver40", () => {
  it("doesn't count this year's birthday until it's actually happened", () => {
    expect(computeExactAge("2000-07-15", TODAY)).toBe(25); // birthday is 5 days from now
  });

  it("counts the birthday on the exact day", () => {
    expect(computeExactAge("2000-07-10", TODAY)).toBe(26);
  });

  it("counts the birthday once it's passed", () => {
    expect(computeExactAge("2000-01-01", TODAY)).toBe(26);
  });

  it("isOver40 is false the day before someone's 40th", () => {
    expect(isOver40("1987-07-15", TODAY)).toBe(false);
  });

  it("isOver40 is true on someone's exact 40th birthday", () => {
    expect(isOver40("1986-07-10", TODAY)).toBe(true);
  });
});

describe("yearsOfService", () => {
  it("formats whole years and months together", () => {
    expect(yearsOfService("2023-03-05", TODAY)).toBe("3 years, 4 months");
  });

  it("omits the months part when it's exactly whole years", () => {
    expect(yearsOfService("2023-07-10", TODAY)).toBe("3 years");
  });

  it("uses singular 'year' and 'month' correctly", () => {
    expect(yearsOfService("2025-07-10", TODAY)).toBe("1 year");
    expect(yearsOfService("2026-06-01", TODAY)).toBe("1 month");
    expect(yearsOfService("2025-06-05", TODAY)).toBe("1 year, 1 month");
  });

  it("returns a friendly message for less than a month of service", () => {
    expect(yearsOfService("2026-06-20", TODAY)).toBe("Less than a month");
  });

  it("returns an empty string for an invalid join date", () => {
    expect(yearsOfService("not-a-date", TODAY)).toBe("");
  });
});

describe("sortAgeGroups", () => {
  it("orders U-groups numerically, then Seniors, then Unassigned last", () => {
    expect(sortAgeGroups(["U10", "U7", "Seniors", "Unassigned", "U9"]))
      .toEqual(["U7", "U9", "U10", "Seniors", "Unassigned"]);
  });

  it("slots unrecognized custom text between U-groups and Seniors", () => {
    const result = sortAgeGroups(["Seniors", "U8", "Custom Squad", "U7"]);
    expect(result).toEqual(["U7", "U8", "Custom Squad", "Seniors"]);
  });
});

describe("buildActiveSegments", () => {
  it("treats a player with no status history as active since their join date", () => {
    const segments = buildActiveSegments("2024-03-15", []);
    expect(segments).toHaveLength(1);
    expect(segments[0].status).toBe("active");
  });

  it("builds alternating segments from a pause/resume history", () => {
    const segments = buildActiveSegments("2024-01-01", [
      { status: "inactive", changedAt: "2024-06-01T00:00:00Z" },
      { status: "active", changedAt: "2024-09-01T00:00:00Z" },
    ]);
    expect(segments.map((s) => s.status)).toEqual(["active", "inactive", "active"]);
  });

  it("returns an empty array for an invalid join date", () => {
    expect(buildActiveSegments("not-a-date", [])).toEqual([]);
  });
});

describe("totalSeasonMonthsDue - the core billing calculation", () => {
  const joinDate = "2024-03-15"; // March = pro-rated first season

  it("pro-rates the first season from the join month, bills full seasons after, caps at the current month", () => {
    // 2024: Mar-Oct = 8 months (pro-rated first season)
    // 2025: Jan-Oct = 10 months (full season)
    // 2026: Jan-Jul = 7 months (today is 10 July, so July counts, Aug onward doesn't yet)
    expect(totalSeasonMonthsDue(joinDate, [], TODAY)).toBe(8 + 10 + 7);
  });

  it("skips months fully covered by an inactive period - no charge while paused", () => {
    const statusLog = [
      { status: "inactive", changedAt: "2025-03-01T00:00:00Z" },
      { status: "active", changedAt: "2025-06-01T00:00:00Z" },
    ];
    // Same as above, minus the 3 fully-paused months (Mar, Apr, May 2025)
    expect(totalSeasonMonthsDue(joinDate, statusLog, TODAY)).toBe(8 + 10 + 7 - 3);
  });

  it("charges nothing for a player's join year if they joined in Nov/Dec (after season end)", () => {
    // Joining in November means the season (Jan-Oct) is already over for that year.
    expect(totalSeasonMonthsDue("2024-11-15", [], TODAY)).toBe(0 + 10 + 7);
  });

  it("never accrues anything for November or December, regardless of season year", () => {
    const novToday = new Date(Date.UTC(2026, 10, 15)); // 15 Nov 2026
    const octToday = new Date(Date.UTC(2026, 9, 15)); // 15 Oct 2026
    // Nov and Dec shouldn't add any months beyond what October already gave.
    expect(totalSeasonMonthsDue("2026-01-01", [], novToday))
      .toBe(totalSeasonMonthsDue("2026-01-01", [], octToday));
  });

  it("returns 0 for an invalid join date", () => {
    expect(totalSeasonMonthsDue("not-a-date", [], TODAY)).toBe(0);
  });

  it("uses billingStartDate instead of join date when provided - for long-standing members who joined before this billing system existed", () => {
    // A player who joined in 1996 but should only be billed from 2024
    // onward must be billed exactly as if they joined fresh in Jan 2024 -
    // NOT for 30 years of backdated seasons.
    const asIfJoinedJan2024 = totalSeasonMonthsDue("2024-01-01", [], TODAY);
    const legacyMember = totalSeasonMonthsDue("1996-05-01", [], TODAY, "2024-01-01");
    expect(legacyMember).toBe(asIfJoinedJan2024);
  });

  it("falls back to join date when billingStartDate is not set (default, unaffected behavior)", () => {
    const withoutBillingStart = totalSeasonMonthsDue("2024-03-15", [], TODAY);
    const withNullBillingStart = totalSeasonMonthsDue("2024-03-15", [], TODAY, null);
    expect(withNullBillingStart).toBe(withoutBillingStart);
  });
});

describe("playerFinance", () => {
  const basePlayer = {
    joinDate: "2024-03-15",
    statusLog: [],
    payments: [{ amount: 100 }],
    tierId: "t1",
  };
  const tiers = [{ id: "t1", monthlyFee: 50, name: "Standard" }];

  it("computes due, paid, and balance correctly from tier fee and payment history", () => {
    const fin = playerFinance(basePlayer, tiers, TODAY);
    const expectedMonths = 8 + 10 + 7; // matches the totalSeasonMonthsDue test above
    expect(fin.due).toBe(expectedMonths * 50);
    expect(fin.paid).toBe(100);
    expect(fin.balance).toBe(expectedMonths * 50 - 100);
    expect(fin.tierName).toBe("Standard");
  });

  it("treats a player with no assigned tier as owing nothing", () => {
    const fin = playerFinance({ ...basePlayer, tierId: null }, tiers, TODAY);
    expect(fin.due).toBe(0);
    expect(fin.fee).toBe(0);
    expect(fin.tierName).toBe("");
  });

  it("uses billingStartDate over the real join date when a player joined long before this billing system existed", () => {
    const legacyPlayer = { ...basePlayer, joinDate: "1996-05-01", billingStartDate: "2024-03-15" };
    const fin = playerFinance(legacyPlayer, tiers, TODAY);
    const expectedMonths = 8 + 10 + 7; // same as if they'd joined fresh on 2024-03-15
    expect(fin.due).toBe(expectedMonths * 50);
  });
});

describe("complianceStatus", () => {
  const player = {
    joinDate: "2024-03-15",
    statusLog: [],
    payments: [{ amount: (8 + 10 + 7) * 50 }], // fully paid up
    tierId: "t1",
    documentsComplete: true,
    active: true,
  };
  const tiers = [{ id: "t1", monthlyFee: 50, name: "Standard" }];

  it("is 'inactive' whenever the player is inactive, regardless of anything else", () => {
    expect(complianceStatus({ ...player, active: false, documentsComplete: false }, tiers, TODAY)).toBe("inactive");
  });

  it("is 'red' when required documents aren't complete", () => {
    expect(complianceStatus({ ...player, documentsComplete: false }, tiers, TODAY)).toBe("red");
  });

  it("is 'amber' when no tier is assigned yet", () => {
    expect(complianceStatus({ ...player, tierId: null }, tiers, TODAY)).toBe("amber");
  });

  it("is 'green' when fully paid up with docs complete and a tier assigned", () => {
    expect(complianceStatus(player, tiers, TODAY)).toBe("green");
  });

  it("is 'amber' when owing an amount within one month's fee", () => {
    const owesOneMonth = { ...player, payments: [{ amount: (8 + 10 + 7) * 50 - 50 }] };
    expect(complianceStatus(owesOneMonth, tiers, TODAY)).toBe("amber");
  });

  it("is 'red' when owing more than one month's fee", () => {
    const owesTwoMonths = { ...player, payments: [{ amount: (8 + 10 + 7) * 50 - 200 }] };
    expect(complianceStatus(owesTwoMonths, tiers, TODAY)).toBe("red");
  });
});
