// Messages page (messages.html): how the list is grouped and filtered.
// Pure functions with no page or network code, so they can be tested with
//   node --test messages-view.test.js
//
// Messages come from get-my-messages, newest first:
//   { id, playerId, playerName, body, sentAt, read }

const DAY_MS = 24 * 60 * 60 * 1000;
export const RECENT_DAYS = 7;
const TZ = 'Africa/Johannesburg';

// Year and month (1-12) of a moment, on the South African calendar.
function saMonth(date) {
  const parts = new Intl.DateTimeFormat('en-ZA', { timeZone: TZ, year: 'numeric', month: 'numeric' }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { year: get('year'), month: get('month') };
}

function monthName(year, month) {
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleString('en-ZA', { month: 'long', timeZone: 'UTC' });
}

/** The children the messages are about, for the filter buttons, A to Z. */
export function childrenIn(messages) {
  return [...new Set((messages || []).map((m) => m.playerName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** Only the messages about one child, or all of them when child is ''. */
export function filterByChild(messages, child) {
  return child ? (messages || []).filter((m) => m.playerName === child) : (messages || []);
}

/**
 * Splits messages (newest first) into groups, newest group first:
 *   "Last 7 days", then one group per month ("Earlier in November" for
 *   the rest of this month, "October", ... and "December 2025" once the
 *   year differs). Empty groups are left out.
 * Returns [{ id, title, messages, unread }], unread = how many are unread.
 */
export function groupMessages(messages, now = new Date()) {
  const nowMs = now.getTime();
  const current = saMonth(now);
  const groups = [];
  const byId = new Map();
  const add = (id, title, m) => {
    if (!byId.has(id)) { const g = { id, title, messages: [], unread: 0 }; byId.set(id, g); groups.push(g); }
    const g = byId.get(id);
    g.messages.push(m);
    if (!m.read) g.unread++;
  };
  const sorted = (messages || []).slice().sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)));
  for (const m of sorted) {
    const at = new Date(m.sentAt);
    if (nowMs - at.getTime() < RECENT_DAYS * DAY_MS) { add('recent', `Last ${RECENT_DAYS} days`, m); continue; }
    const { year, month } = saMonth(at);
    const id = `${year}-${String(month).padStart(2, '0')}`;
    const name = monthName(year, month);
    const title = year === current.year && month === current.month
      ? `Earlier in ${name}`
      : year === current.year ? name : `${name} ${year}`;
    add(id, title, m);
  }
  // The recent group always comes first, even if a clock is slightly off.
  groups.sort((a, b) => (a.id === 'recent' ? -1 : b.id === 'recent' ? 1 : b.id.localeCompare(a.id)));
  return groups;
}
