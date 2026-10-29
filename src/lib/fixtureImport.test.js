import { describe, it, expect } from "vitest";
import {
  stripTeamCode,
  isGarlandale,
  extractGarlandaleFixtures,
  findUnmappedDivisions,
  groupFixturesByDate,
  formatDisplayTime,
  fmtImportDateHeader,
} from "./fixtureImport.js";

// Real sample rows, matching the actual federation spreadsheet format
// (CTTLFA Cape Town Tygerberg LFA) used when this feature was built.
const SAMPLE_ROWS = [
  { Season: "CTTLFA 2026", Division: "O3 - Under 12 Premier Three", Competition: "", "Home Team": "O3-16- Garlandale", "Away Team": "O3-08- Green Point Salesians", Date: "18/07/26", Day: "Sat", Time: "08:15", Venue: "Garlandale", Pitch: "Garlandale A" },
  { Season: "CTTLFA 2026", Division: "O8- Under 12 Division Seven", Competition: "", "Home Team": "O8-09- Lansdowne", "Away Team": "O8-10- Garlandale B", Date: "18/07/26", Day: "Sat", Time: "08:15", Venue: "Lansdowne", Pitch: "Chukker Road A" },
  { Season: "CTTLFA 2026", Division: "D4 - 6th Division", Competition: "", "Home Team": "D4-01- Garlandale FC", "Away Team": "D4-10- Sunningdale City", Date: "18/07/26", Day: "Sat", Time: "14:00", Venue: "Garlandale", Pitch: "Garlandale A" },
  { Season: "CTTLFA 2026", Division: "F2 - Vets 040 B", Competition: "", "Home Team": "F2-03- Garlandale", "Away Team": "F2-11- Saxon Rovers", Date: "18/07/26", Day: "Sat", Time: "15:45", Venue: "Garlandale", Pitch: "Garlandale B" },
  { Season: "CTTLFA 2026", Division: "G1 - Vets 045 A", Competition: "", "Home Team": "G1-01- De Beers", "Away Team": "G1-04- Hanover Park", Date: "14/07/26", Day: "Tue", Time: "19:00", Venue: "De Beers", Pitch: "Somerset West A" },
];

describe("stripTeamCode", () => {
  it("strips a leading division code prefix off a team name", () => {
    expect(stripTeamCode("O3-16- Garlandale")).toBe("Garlandale");
    expect(stripTeamCode("D4-01- Garlandale FC")).toBe("Garlandale FC");
    expect(stripTeamCode("M9-05- Meadowridge D")).toBe("Meadowridge D");
  });

  it("handles names with no code prefix gracefully", () => {
    expect(stripTeamCode("Just A Name")).toBe("Just A Name");
  });

  it("handles empty/missing input", () => {
    expect(stripTeamCode("")).toBe("");
    expect(stripTeamCode(null)).toBe("");
    expect(stripTeamCode(undefined)).toBe("");
  });
});

describe("isGarlandale", () => {
  it("recognizes Garlandale under any of its team-code variations", () => {
    expect(isGarlandale("O3-16- Garlandale")).toBe(true);
    expect(isGarlandale("D4-01- Garlandale FC")).toBe(true);
    expect(isGarlandale("O8-10- Garlandale B")).toBe(true);
  });

  it("does not match other clubs, including ones with similar-looking codes", () => {
    expect(isGarlandale("O3-08- Green Point Salesians")).toBe(false);
    expect(isGarlandale("G1-01- De Beers")).toBe(false);
  });
});

describe("extractGarlandaleFixtures", () => {
  const fixtures = extractGarlandaleFixtures(SAMPLE_ROWS);

  it("finds exactly the rows involving Garlandale, excluding everything else", () => {
    // 4 of the 5 sample rows involve Garlandale; the De Beers vs Hanover
    // Park row must be excluded.
    expect(fixtures).toHaveLength(4);
  });

  it("correctly identifies the opponent regardless of home/away side", () => {
    const vsGreenPoint = fixtures.find((f) => f.opponent === "Green Point Salesians");
    expect(vsGreenPoint).toBeTruthy();
    expect(vsGreenPoint.homeAway).toBe("H"); // Garlandale was Home Team in this row

    const vsLansdowne = fixtures.find((f) => f.opponent === "Lansdowne");
    expect(vsLansdowne).toBeTruthy();
    expect(vsLansdowne.homeAway).toBe("A"); // Garlandale was Away Team (as "Garlandale B") in this row
  });

  it("parses DD/MM/YY dates correctly", () => {
    const row = fixtures.find((f) => f.opponent === "Sunningdale City");
    expect(row.date.getUTCFullYear()).toBe(2026);
    expect(row.date.getUTCMonth()).toBe(6); // July (0-indexed)
    expect(row.date.getUTCDate()).toBe(18);
  });

  it("parses times into a raw 'HH:MM' value, ready for storage", () => {
    const row = fixtures.find((f) => f.opponent === "Green Point Salesians");
    expect(row.time).toBe("08:15");
  });

  it("uses the Pitch field as the venue (matches the club's own reference document)", () => {
    const row = fixtures.find((f) => f.opponent === "Lansdowne");
    expect(row.venue).toBe("Chukker Road A");
  });

  it("sorts fixtures chronologically", () => {
    // The De Beers row is excluded, but its date (14 July) is earlier than
    // the rest (18 July) - confirms sorting works on the remaining rows,
    // and that a 5-row input didn't leave a stray ordering artifact.
    const dates = fixtures.map((f) => f.date.getTime());
    const sorted = [...dates].sort((a, b) => a - b);
    expect(dates).toEqual(sorted);
  });
});

describe("findUnmappedDivisions", () => {
  const fixtures = extractGarlandaleFixtures(SAMPLE_ROWS);

  it("returns divisions with no saved label", () => {
    const unmapped = findUnmappedDivisions(fixtures, {});
    expect(unmapped).toContain("O3 - Under 12 Premier Three");
    expect(unmapped).toContain("D4 - 6th Division");
    expect(unmapped).toHaveLength(4); // all 4 divisions in the sample are unmapped
  });

  it("excludes divisions that already have a saved label", () => {
    const divisionLabelMap = { "D4 - 6th Division": "1st Team" };
    const unmapped = findUnmappedDivisions(fixtures, divisionLabelMap);
    expect(unmapped).not.toContain("D4 - 6th Division");
    expect(unmapped).toHaveLength(3);
  });

  it("returns an empty list once everything is mapped", () => {
    const divisionLabelMap = {
      "O3 - Under 12 Premier Three": "Under 12 'A'",
      "O8- Under 12 Division Seven": "Under 12 'B'",
      "D4 - 6th Division": "1st Team",
      "F2 - Vets 040 B": "Over 40",
    };
    expect(findUnmappedDivisions(fixtures, divisionLabelMap)).toEqual([]);
  });
});

describe("formatDisplayTime", () => {
  it("formats a stored 'HH:MM' value as '08h15' style for display", () => {
    expect(formatDisplayTime("08:15")).toBe("08h15");
    expect(formatDisplayTime("14:00")).toBe("14h00");
  });

  it("returns an empty string for a missing time", () => {
    expect(formatDisplayTime(null)).toBe("");
    expect(formatDisplayTime("")).toBe("");
  });
});

describe("fmtImportDateHeader", () => {
  it("formats a date as '18 July 2026' regardless of local timezone", () => {
    const date = new Date(Date.UTC(2026, 6, 18));
    expect(fmtImportDateHeader(date)).toBe("18 July 2026");
  });

  it("returns an empty string for a missing date", () => {
    expect(fmtImportDateHeader(null)).toBe("");
  });
});

describe("groupFixturesByDate", () => {
  const fixtures = extractGarlandaleFixtures(SAMPLE_ROWS);

  it("groups all same-day fixtures into one group", () => {
    const groups = groupFixturesByDate(fixtures);
    expect(groups).toHaveLength(1); // all 4 remaining fixtures are on 18 July
    expect(groups[0].rows).toHaveLength(4);
  });
});
