// Who a notice or Home banner is for. Since 2026-10 that's a list of age
// groups (target_age_groups); an empty list means everyone. Rows saved
// before then may only have the old single value (target_age_group).

/** The age groups a database row is for ([] = everyone). */
export function groupsFromRow(row) {
  const list = Array.isArray(row?.target_age_groups) && row.target_age_groups.length
    ? row.target_age_groups
    : [row?.target_age_group];
  return cleanGroups(list);
}

/** Trimmed, no blanks, no "ALL", no repeats, in age order. */
export function cleanGroups(list) {
  const seen = new Set();
  const out = [];
  for (const g of list || []) {
    const v = String(g ?? "").trim();
    if (!v || v.toUpperCase() === "ALL" || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return sortGroups(out);
}

/** Youngest first (U7, U8 ... U19), then anything else (e.g. Seniors). */
export function sortGroups(list) {
  const num = (g) => { const m = String(g).match(/^u(\d+)/i); return m ? Number(m[1]) : null; };
  return [...list].sort((a, b) => {
    const na = num(a), nb = num(b);
    if (na !== null && nb !== null) return na - nb;
    if (na !== null) return -1;
    if (nb !== null) return 1;
    return String(a).localeCompare(String(b));
  });
}

/** "Everyone", or the groups joined, e.g. "U7, U8, U9". */
export function audienceLabel(groups) {
  return groups && groups.length ? groups.join(", ") : "Everyone";
}

/** The fields to save: the list, plus the old single column kept in step. */
export function audienceColumns(groups, everyoneValue = null) {
  const list = cleanGroups(groups);
  return { target_age_groups: list, target_age_group: list.length ? list[0] : everyoneValue };
}
