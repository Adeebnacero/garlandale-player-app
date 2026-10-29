// ---------------------------------------------------------------------------
// Aggregates per-match goals/assists (recorded in match_squad) into
// season-long totals per player. Grouped by each player's own current age
// group (from their profile), not the age group recorded on any single
// match - simpler, and matches "player stats per division" as a season-wide
// view of the current squad, not a per-match snapshot.
// ---------------------------------------------------------------------------

/**
 * @param {Array<{playerId: string, goals: number, assists: number}>} squadRows - every match_squad row across every match
 * @param {Array<{id: string, name: string, ageGroup: string}>} players - the current roster (for name/age-group lookup)
 * @returns {Array<{playerId, name, ageGroup, goals, assists, goalContributions}>} sorted by goals desc, then assists desc
 */
export function aggregatePlayerStats(squadRows, players) {
  const byId = new Map((players || []).map((p) => [p.id, p]));
  const totals = new Map();

  for (const row of squadRows || []) {
    if (!row.playerId) continue;
    const existing = totals.get(row.playerId) || { goals: 0, assists: 0 };
    existing.goals += Number(row.goals) || 0;
    existing.assists += Number(row.assists) || 0;
    totals.set(row.playerId, existing);
  }

  const result = [];
  for (const [playerId, { goals, assists }] of totals) {
    if (goals === 0 && assists === 0) continue; // no point listing a player with nothing recorded
    const player = byId.get(playerId);
    result.push({
      playerId,
      name: player ? player.name : "Unknown player",
      ageGroup: player ? player.ageGroup : "",
      goals,
      assists,
      goalContributions: goals + assists,
    });
  }

  result.sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.name.localeCompare(b.name));
  return result;
}

/** Every distinct age group present in a stats list, "All" first, sorted the same way age groups sort elsewhere in the app. */
export function statsAgeGroups(stats) {
  return Array.from(new Set((stats || []).map((s) => s.ageGroup).filter(Boolean)));
}

export function filterStatsByAgeGroup(stats, ageGroup) {
  if (!ageGroup || ageGroup === "All") return stats;
  return (stats || []).filter((s) => s.ageGroup === ageGroup);
}
