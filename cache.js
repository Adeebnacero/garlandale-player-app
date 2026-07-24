// Garlandale FC Player Portal — shared caching helper
//
// Strategy: refresh at two fixed points a day (10:00 and 17:00 local
// time), not on every page load. First-ever fetch for a given key always
// happens immediately (nothing to show otherwise). After that, a page
// only re-fetches if one of today's/yesterday's refresh boundaries has
// passed since the last successful fetch - otherwise it uses what's
// already cached in localStorage, with zero network call.
//
// Cache is namespaced per logged-in user (their Supabase auth user id),
// so if two different players ever use the same browser/device without
// fully signing out, one player's cached data can never leak into what
// the other sees.

const REFRESH_HOURS = [10, 17]; // 10am and 5pm, local time

function lastBoundary(now) {
  const candidates = [];
  for (const h of REFRESH_HOURS) {
    const today = new Date(now);
    today.setHours(h, 0, 0, 0);
    candidates.push(today);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    candidates.push(yesterday);
  }
  const passed = candidates.filter((d) => d <= now).sort((a, b) => b - a);
  return passed[0] || null;
}

function cacheKey(userId, key) {
  return `gfc_cache_${userId}_${key}`;
}

/**
 * Fetches `key` via `fetchFn` (an async function returning JSON-serializable
 * data), using the cached copy if we're still within the same refresh
 * window as the last successful fetch. Pass `force: true` to always bypass
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

  const boundary = lastBoundary(now);
  const needsRefresh =
    force || !cached || !boundary || new Date(cached.fetchedAt) < boundary;

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
 *  fresh rather than waiting for the next scheduled refresh window.
 *  (e.g. update-my-profile succeeding should immediately invalidate the
 *  cached get-my-profile result, not wait until 10am/5pm.) */
export function invalidateCacheKey(userId, key) {
  localStorage.removeItem(cacheKey(userId, key));
}
