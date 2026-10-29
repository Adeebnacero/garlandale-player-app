import { describe, it, expect } from "vitest";
import { aggregatePlayerStats, statsAgeGroups, filterStatsByAgeGroup } from "./playerStats.js";

const PLAYERS = [
  { id: "p1", name: "Thabo Nkosi", ageGroup: "U12" },
  { id: "p2", name: "Sipho Dlamini", ageGroup: "U12" },
  { id: "p3", name: "Aiden Smith", ageGroup: "U14" },
];

describe("aggregatePlayerStats", () => {
  it("sums goals and assists across multiple matches for the same player", () => {
    const squadRows = [
      { playerId: "p1", goals: 2, assists: 1 },
      { playerId: "p1", goals: 1, assists: 0 },
    ];
    const stats = aggregatePlayerStats(squadRows, PLAYERS);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ name: "Thabo Nkosi", ageGroup: "U12", goals: 3, assists: 1, goalContributions: 4 });
  });

  it("sorts by goals first, then assists, as a tiebreaker", () => {
    const squadRows = [
      { playerId: "p1", goals: 2, assists: 1 },
      { playerId: "p3", goals: 2, assists: 3 },
    ];
    const stats = aggregatePlayerStats(squadRows, PLAYERS);
    expect(stats.map((s) => s.playerId)).toEqual(["p3", "p1"]); // same goals, p3 has more assists
  });

  it("excludes a player who played but recorded zero goals and zero assists", () => {
    const squadRows = [
      { playerId: "p1", goals: 0, assists: 0 },
      { playerId: "p2", goals: 1, assists: 0 },
    ];
    const stats = aggregatePlayerStats(squadRows, PLAYERS);
    expect(stats.map((s) => s.playerId)).toEqual(["p2"]);
  });

  it("handles a player no longer on the roster gracefully", () => {
    const squadRows = [{ playerId: "gone", goals: 1, assists: 0 }];
    const stats = aggregatePlayerStats(squadRows, PLAYERS);
    expect(stats[0].name).toBe("Unknown player");
  });

  it("returns an empty list for no data", () => {
    expect(aggregatePlayerStats([], PLAYERS)).toEqual([]);
    expect(aggregatePlayerStats([], [])).toEqual([]);
  });
});

describe("statsAgeGroups / filterStatsByAgeGroup", () => {
  const stats = aggregatePlayerStats(
    [
      { playerId: "p1", goals: 1, assists: 0 },
      { playerId: "p3", goals: 1, assists: 0 },
    ],
    PLAYERS
  );

  it("lists every distinct age group present", () => {
    expect(statsAgeGroups(stats).sort()).toEqual(["U12", "U14"]);
  });

  it("filters to just one age group", () => {
    const filtered = filterStatsByAgeGroup(stats, "U12");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].ageGroup).toBe("U12");
  });

  it("returns everything for 'All' or no filter", () => {
    expect(filterStatsByAgeGroup(stats, "All")).toHaveLength(2);
    expect(filterStatsByAgeGroup(stats, null)).toHaveLength(2);
  });
});
