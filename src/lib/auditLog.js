// ---------------------------------------------------------------------------
// Pure display helpers for the audit log (see schema.sql's audit_log_trigger
// for how entries are actually created - this module only concerns itself
// with turning old_data/new_data JSON into something readable).
// ---------------------------------------------------------------------------

const IGNORED_FIELDS = new Set(["id", "created_at", "updated_at"]);

/** Turns "monthly_fee" into "Monthly fee". */
export function humanizeFieldName(key) {
  const words = key.split("_");
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

/**
 * Compares an audit entry's old_data and new_data, returning only the
 * fields that actually changed as [{ field, oldValue, newValue }]. For an
 * INSERT (no old_data), every field in new_data is shown as "added". For a
 * DELETE (no new_data), every field in old_data is shown as "removed".
 */
export function diffFields(oldData, newData) {
  const old = oldData || {};
  const fresh = newData || {};
  const keys = new Set([...Object.keys(old), ...Object.keys(fresh)]);
  const changes = [];

  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) continue;
    const oldValue = old[key] ?? null;
    const newValue = fresh[key] ?? null;
    // Compare as strings so e.g. 300 and "300" (or two equal numbers) don't
    // falsely register as a change - jsonb round-trips can shift types.
    if (String(oldValue) === String(newValue)) continue;
    changes.push({ key, field: humanizeFieldName(key), oldValue, newValue });
  }

  return changes;
}
