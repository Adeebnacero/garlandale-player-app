// Garlandale FC Player Portal — shared caching helper
//
// Strategy: reuse a saved copy for at most MAX_AGE_MS (1 hour), and never
// across midnight in South Africa - so a new day always starts with fresh
// fixtures and notices (yesterday's match or birthday notice can't linger).
// First-ever fetch for a given key always happens immediately (nothing to
// show otherwise). The manual "Refresh now" action bypasses this entirely.
//
// (This replaced an earlier rule of refreshing only at 10:00 and 17:00,
// which meant anything opened before 10:00 showed the previous evening's
// data.)
//
// Cache is namespaced per logged-in user (their Supabase auth user id),
// so if two different players ever use the same browser/device without
// fully signing out, one player's cached data can never leak into what
// the other sees.
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

/** A calendar date (YYYY-MM-DD) in South Africa (UTC+2, no daylight saving). */
export function saDate(when = new Date()) {
  const d = when instanceof Date ? when : new Date(when);
  return new Date(d.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isStale(fetchedAt, now) {
  const fetched = new Date(fetchedAt);
  if (Number.isNaN(fetched.getTime())) return true;
  if (now - fetched > MAX_AGE_MS) return true;
  if (fetched > now) return true;                 // phone clock went backwards
  return saDate(fetched) !== saDate(now);         // a new day has started
}

function cacheKey(userId, key) {
  return `gfc_cache_${userId}_${key}`;
}

/**
 * Fetches `key` via `fetchFn` (an async function returning JSON-serializable
 * data), using the saved copy if it's less than an hour old and from
 * today (South African time). Pass `force: true` to always bypass
 * the cache (used by the manual "Refresh now" action).
 */
export async function cachedFetch(userId, key, fetchFn, { force = false } = {}) {
  const storageKey = cacheKey(userId, key);
  const now = new Date();

  let cached = null;
  try {
    const raw = localStorage.getItem(storageKey);
    cached = raw ? JSON.parse(raw) : null;
  } catch {
    cached = null;
  }

  const needsRefresh = force || !cached || isStale(cached.fetchedAt, now);

  if (!needsRefresh) {
    return cached.data;
  }

  const data = await fetchFn();
  try {
    localStorage.setItem(storageKey, JSON.stringify({ data, fetchedAt: now.toISOString() }));
  } catch {
    // Storage full or unavailable - non-critical, just means this
    // particular result won't be cached, not a functional failure.
  }
  return data;
}

/** Clears all cached data for one user - called on sign-out and by the
 *  manual "Refresh now" action. */
export function clearUserCache(userId) {
  const prefix = `gfc_cache_${userId}_`;
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) toRemove.push(k);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}

/** Invalidates just ONE cached key for one user - used right after a
 *  successful write, so the next read of that same data is guaranteed
 *  fresh rather than waiting for the saved copy to expire.
 *  (e.g. update-my-profile succeeding should immediately invalidate the
 *  cached get-my-profile result.) */
export function invalidateCacheKey(userId, key) {
  localStorage.removeItem(cacheKey(userId, key));
}
