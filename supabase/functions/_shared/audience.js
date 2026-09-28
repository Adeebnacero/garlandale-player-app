// Who a notice or Home banner is for, shared by the Player Portal's
// Edge Functions. Pure, tested with: deno test supabase/functions/_shared/
//
// Since 2026-10 a notice or banner can be for several age groups
// (target_age_groups, e.g. ["U7", "U8", "U9"]); an empty list means
// everyone. Rows saved before then may only have the old single value
// (target_age_group), which is still understood.

/** The groups a row is for, lower-case; an empty list means everyone. */
export function audienceGroups(row) {
  const list = Array.isArray(row?.target_age_groups) && row.target_age_groups.length
    ? row.target_age_groups
    : [row?.target_age_group];
  return list
    .map((g) => String(g ?? "").trim().toLowerCase())
    .filter((g) => g !== "" && g !== "all");
}

/** Whether a row is for a given age group (lower-case). */
export function isForAgeGroup(row, ageGroup) {
  const groups = audienceGroups(row);
  return groups.length === 0 || groups.includes(String(ageGroup ?? "").trim().toLowerCase());
}
