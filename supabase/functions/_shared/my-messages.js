// Private messages from the club (Club Management -> Messages -> Player
// Messages -> "Send in app"), as a guardian sees them. Used by
// get-my-messages and mark-messages-read. Tested with:
//   deno test supabase/functions/_shared/
//
// Each message belongs to one player; any of that player's linked
// guardians can read it, and the first to open it marks it read for all.

export const MAX_MESSAGES = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

/**
 * Database rows -> what the app shows, newest first.
 * rows: player_messages { id, player_id, body, created_at, read_at }
 * players: [{ id, name }] - the caller's linked players
 */
export function shapeMessages(rows, players) {
  const names = new Map((players || []).map((p) => [p.id, firstName(p.name)]));
  return (rows || [])
    .map((r) => ({
      id: r.id,
      playerId: r.player_id,
      playerName: names.get(r.player_id) || "",
      body: r.body,
      sentAt: r.created_at,
      read: !!r.read_at,
    }))
    .sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)));
}

/** The ids a mark-read request may touch: real ids, no repeats, capped. */
export function cleanIds(value) {
  if (!Array.isArray(value)) return null;
  const ids = [...new Set(value.filter((v) => typeof v === "string" && UUID.test(v)))];
  if (ids.length === 0 || ids.length > MAX_MESSAGES) return null;
  return ids;
}
