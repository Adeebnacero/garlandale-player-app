// ---------------------------------------------------------------------------
// Pure billing/date/age logic for Garlandale FC.
//
// Deliberately has ZERO dependencies on React, Supabase, or any other part
// of the app - just plain functions in, plain values out. That's what makes
// this file cleanly unit-testable (see billing.test.js) without dragging in
// the rest of the application (and its Supabase client, jsPDF, etc).
//
// Every function that depends on "today" accepts it as an optional
// parameter (defaulting to `new Date()`), so tests can pin a fixed date and
// get fully deterministic results instead of "it depends what day you run
// the test suite."
// ---------------------------------------------------------------------------

export const SEASON_START_MONTH = 0; // January (0-indexed)
export const SEASON_END_MONTH = 9;   // October (0-indexed) - last billable month of the season

/**
 * Computes a player's age-group label (U7, U8, ... Seniors) from their date
 * of birth, using the English/SA grassroots convention that the age-group
 * cutoff is 31 August each year.
 */
export function computeAgeGroup(dob, today = new Date()) {
  if (!dob) return "Unassigned";
  const birth = new Date(dob);
  if (isNaN(birth)) return "Unassigned";
  // UTC getters throughout: date-only strings (dob, join dates) are parsed
  // as UTC by JS, so comparisons must stay in UTC terms too - mixing UTC
  // and local-time reads here caused real-world calendar-month bugs
  // depending on the server/browser's timezone (see billing.test.js).
  const cutoffYear = today.getUTCMonth() >= 8 ? today.getUTCFullYear() + 1 : today.getUTCFullYear();
  const age = cutoffYear - birth.getUTCFullYear();
  if (age >= 18) return "Seniors";
  if (age <= 0) return "Unassigned";
  return "U" + age;
}

/** Computes a person's exact age in whole years as of `today`. */
export function computeExactAge(dob, today = new Date()) {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth)) return null;
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const hasHadBirthdayThisYear =
    today.getUTCMonth() > birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() >= birth.getUTCDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

export function isOver40(dob, today = new Date()) {
  const age = computeExactAge(dob, today);
  return age !== null && age >= 40;
}

/**
 * Formats how long someone has been a member as "X years, Y months" (used
 * for the tenure/service indicator on a player's profile - not related to
 * billing, which is why this lives separately from the season math below).
 */
export function yearsOfService(joinDate, today = new Date()) {
  const join = new Date(joinDate);
  if (isNaN(join)) return "";
  let totalMonths = (today.getUTCFullYear() - join.getUTCFullYear()) * 12 + (today.getUTCMonth() - join.getUTCMonth());
  if (today.getUTCDate() < join.getUTCDate()) totalMonths -= 1;
  if (totalMonths < 0) return "Not yet started";

  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;

  if (years === 0 && months === 0) return "Less than a month";
  const yearPart = years > 0 ? `${years} year${years === 1 ? "" : "s"}` : "";
  const monthPart = months > 0 ? `${months} month${months === 1 ? "" : "s"}` : "";
  return [yearPart, monthPart].filter(Boolean).join(", ");
}

/** Sort key used to order age groups sensibly: U7, U8, ... Seniors, Unassigned last. */
export function ageGroupSortKey(g) {
  if (g === "Unassigned") return [3, 0];
  if (g === "Seniors") return [2, 0];
  const m = /^U(\d+)$/.exec(g);
  if (m) return [0, Number(m[1])];
  return [1, g]; // custom override text, sorted alphabetically between U-groups and Seniors
}

export function sortAgeGroups(groups) {
  return [...groups].sort((a, b) => {
    const ka = ageGroupSortKey(a);
    const kb = ageGroupSortKey(b);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (typeof ka[1] === "number" && typeof kb[1] === "number") return ka[1] - kb[1];
    return String(ka[1]).localeCompare(String(kb[1]));
  });
}

/**
 * Builds a timeline of active/inactive segments for a player from their
 * join date and status-change history. A player is assumed active from
 * their join date until the first logged status change; after that, each
 * logged change opens a new segment running until the next one (or to the
 * far future for the current, still-open segment).
 */
export function buildActiveSegments(joinDate, statusLog) {
  const join = new Date(joinDate);
  if (isNaN(join)) return [];
  const sorted = [...(statusLog || [])]
    .map((s) => ({ status: s.status, at: new Date(s.changedAt) }))
    .filter((s) => !isNaN(s.at))
    .sort((a, b) => a.at - b.at);

  const segments = [];
  let cursor = join;
  let cursorStatus = "active";
  for (const entry of sorted) {
    if (entry.at > cursor) {
      segments.push({ status: cursorStatus, start: cursor, end: entry.at });
      cursor = entry.at;
    }
    cursorStatus = entry.status;
  }
  segments.push({ status: cursorStatus, start: cursor, end: new Date(8640000000000000) });
  return segments;
}

export function monthHasActiveOverlap(segments, monthStart, monthEnd) {
  return segments.some((seg) => seg.status === "active" && seg.start < monthEnd && seg.end > monthStart);
}

/**
 * Season runs January (0) through October (9). November/December accrue
 * nothing. A player's very first billable season is pro-rated from their
 * start month; every season after that bills the full Jan-Oct run.
 * Balances are one continuous running total across every season a player
 * has been billed (unpaid amounts carry forward rather than resetting each
 * year). Any month fully covered by an inactive period is skipped entirely
 * - no fee accrues while paused, no matter how many times a player pauses
 * and returns.
 *
 * `billingStartDate` is optional and defaults to `joinDate` - this is what
 * lets a long-standing member's real join date (e.g. 1996) stay an honest
 * tenure record while billing only starts from whenever the club actually
 * wants it to (e.g. when this system went live), instead of retroactively
 * billing decades of "seasons" that predate any subscription system.
 * Active/inactive history is still read from the true `joinDate` onward,
 * in case a pause was ever logged before the billing start date.
 */
export function totalSeasonMonthsDue(joinDate, statusLog, today = new Date(), billingStartDate = null) {
  const effectiveStart = new Date(billingStartDate || joinDate);
  if (isNaN(effectiveStart)) return 0;
  const segments = buildActiveSegments(joinDate, statusLog);
  const startYear = effectiveStart.getUTCFullYear();
  const startMonth = effectiveStart.getUTCMonth();
  if (startMonth > SEASON_END_MONTH && today.getUTCFullYear() === startYear) return 0;

  let count = 0;
  for (let y = startYear; y <= today.getUTCFullYear(); y++) {
    const firstMonthOfYear = y === startYear ? Math.min(startMonth, SEASON_END_MONTH + 1) : SEASON_START_MONTH;
    if (y === startYear && startMonth > SEASON_END_MONTH) continue;

    let endMonthExclusive;
    if (y < today.getUTCFullYear()) {
      endMonthExclusive = SEASON_END_MONTH + 1;
    } else {
      const currentMonth = today.getUTCMonth();
      endMonthExclusive = currentMonth > SEASON_END_MONTH ? SEASON_END_MONTH + 1 : currentMonth + 1;
    }

    for (let m = firstMonthOfYear; m < endMonthExclusive; m++) {
      // UTC-anchored month boundaries - matches how join dates (parsed as
      // UTC-midnight from date-only strings) and status-log timestamps
      // (stored as UTC instants) actually represent time, so a status
      // change logged near midnight lands in the same calendar month
      // no matter what timezone the calculation runs in.
      const monthStart = new Date(Date.UTC(y, m, 1));
      const monthEnd = new Date(Date.UTC(y, m + 1, 1));
      if (monthHasActiveOverlap(segments, monthStart, monthEnd)) count++;
    }
  }
  return count;
}

export function playerFinance(player, tiers, today = new Date()) {
  const tier = (tiers || []).find((t) => t.id === player.tierId);
  const fee = tier ? Number(tier.monthlyFee) || 0 : 0;
  const monthsDue = totalSeasonMonthsDue(player.joinDate, player.statusLog, today, player.billingStartDate);
  const due = monthsDue * fee;
  const paid = (player.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const balance = due - paid;
  return { due, paid, balance, fee, tierName: tier ? tier.name : "" };
}

/**
 * Single source of truth for compliance status AND the human-readable
 * reason behind it - kept together deliberately so the badge color and its
 * tooltip explanation can never disagree with each other.
 */
function computeComplianceDetail(player, tiers, today = new Date()) {
  if (!player.active) {
    return { status: "inactive", reason: "Player is marked inactive." };
  }
  const { balance, fee } = playerFinance(player, tiers, today);
  if (!player.documentsComplete) {
    return { status: "red", reason: "Registration documents are incomplete." };
  }
  if (!player.tierId) {
    return { status: "amber", reason: "No subscription tier has been assigned yet." };
  }
  if (balance <= 0) {
    return { status: "green", reason: "Fully paid up." };
  }
  if (fee > 0 && balance <= fee) {
    return { status: "amber", reason: `Owes ${fmtMoneyLocal(balance)} — within one month's fee.` };
  }
  if (balance > 0) {
    return { status: "red", reason: `Owes ${fmtMoneyLocal(balance)} — more than one month's fee.` };
  }
  return { status: "green", reason: "Fully paid up." };
}

// Tiny local copy of the money formatter - kept minimal here rather than
// importing from lib/format.js, since billing.js is deliberately dependency-free.
function fmtMoneyLocal(n) {
  const v = Number(n) || 0;
  return (v < 0 ? "-" : "") + "R" + Math.abs(v).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function complianceStatus(player, tiers, today = new Date()) {
  return computeComplianceDetail(player, tiers, today).status;
}

export function complianceReason(player, tiers, today = new Date()) {
  return computeComplianceDetail(player, tiers, today).reason;
}

export const STATUS_LABEL = { green: "Compliant", amber: "Payment due", red: "Non-compliant", inactive: "Inactive" };
