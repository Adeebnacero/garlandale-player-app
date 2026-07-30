// page-shared.js
//
// Common UI wiring that was previously duplicated (byte-for-byte, in most
// cases) across every authenticated page: the hamburger drawer, the
// notices badge, the Loyalty nav-item visibility check, refresh/sign-out,
// service worker registration, and HTML-escaping. Extracted here so a fix
// only has to happen in one place instead of five.

import { cachedFetch, clearUserCache } from './cache.js';

// Wires up the hamburger menu button and the drawer overlay it opens.
// Hiding/showing #header-brand while the drawer is open is optional -
// pages that don't have that element (or don't want the behaviour) are
// unaffected, since the null checks just skip it.
export function setupDrawer() {
  const menuBtn = document.getElementById('menu-btn');
  const drawerOverlay = document.getElementById('drawer-overlay');
  const headerBrand = document.getElementById('header-brand');
  if (!menuBtn || !drawerOverlay) return;

  menuBtn.addEventListener('click', () => {
    drawerOverlay.classList.add('open');
    if (headerBrand) headerBrand.style.display = 'none';
  });
  drawerOverlay.addEventListener('click', (e) => {
    if (e.target.id === 'drawer-overlay') {
      drawerOverlay.classList.remove('open');
      if (headerBrand) headerBrand.style.display = '';
    }
  });
}

// Wires up the pull-to-refresh button and the sign-out button. Both need
// the live Supabase client (to call auth.signOut()) and the current
// user's id (to know which cache entries to clear).
export function setupRefreshAndSignOut(supabase, userId) {
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      clearUserCache(userId);
      window.location.reload();
    });
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      clearUserCache(userId);
      // Defense-in-depth: also wipe the service worker's Cache Storage, in
      // case any same-origin page asset was cached mid-session. Harmless -
      // static files just get re-fetched fresh next load.
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      await supabase.auth.signOut();
      window.location.href = 'index.html';
    });
  }
}

export function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

// Populates the "Notices" drawer badge with the unread count. Non-critical
// on failure - the badge just doesn't show for this load rather than
// blocking the page.
export async function loadNoticeBadge(SUPABASE_URL, accessToken, userId) {
  try {
    const body = await cachedFetch(userId, 'get-my-notice-count', async () => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-my-notice-count`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load notice count');
      return json;
    });
    const badges = document.querySelectorAll('#notices-badge, [data-notice-badge]');
    if (!badges.length) return;
    const label = body.unread > 99 ? '99+' : String(body.unread);
    badges.forEach((badge) => {
      if (body.unread > 0) {
        if (!badge.hasAttribute('data-notice-badge')) badge.textContent = label;
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    });
  } catch (err) {
    // Non-critical - badge just doesn't show this load.
  }
}

// Reveals the "Loyalty" drawer nav item if this player is a loyalty-active
// member. Per-child (an active status differs per kid), unlike
// loadNoticeBadge which stays combined. Non-critical on failure - the tab
// just stays hidden this load.
export async function loadActiveStatus(SUPABASE_URL, accessToken, userId, playerId) {
  try {
    const body = await cachedFetch(userId, `get-my-active-status:${playerId}`, async () => {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/get-my-active-status?player_id=${encodeURIComponent(playerId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load active status');
      return json;
    });
    const els = document.querySelectorAll('#loyalty-nav-item, [data-loyalty-nav]');
    els.forEach((el) => {
      el.style.display = body.active ? (el.tagName === 'A' && el.classList.contains('tile') ? 'block' : 'flex') : 'none';
    });
  } catch (err) {
    // Non-critical - Loyalty tab just stays hidden this load.
  }
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Multi-child (guardian) support
//
// Most accounts are still single-child, and none of this changes anything
// for them: loadMyPlayers() returns one player, resolveSelectedPlayer()
// picks it automatically, and renderChildSwitcher() is a no-op when there's
// only one to show. All of the below only becomes visible once a guardian
// actually has more than one linked child.
// ---------------------------------------------------------------------------

const SELECTED_PLAYER_KEY_PREFIX = 'gfc_selected_player_';

// Fetches the list of children linked to the calling guardian. Cached like
// everything else via cachedFetch - it's account-wide, not per-child, so
// no player_id suffix needed on the cache key.
export async function loadMyPlayers(SUPABASE_URL, accessToken, userId) {
  return cachedFetch(userId, 'get-my-players', async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/get-my-players`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Could not load linked players');
    return json;
  });
}

/** Reads the guardian's currently-selected child for this device, falling
 *  back to (and persisting) the first linked player if nothing's stored
 *  yet, or if a previously-selected child is no longer in the list (e.g.
 *  they left the club). */
export function resolveSelectedPlayer(userId, players) {
  if (!players || players.length === 0) return null;
  const storageKey = SELECTED_PLAYER_KEY_PREFIX + userId;
  let storedId = null;
  try {
    storedId = localStorage.getItem(storageKey);
  } catch {
    storedId = null;
  }
  const match = players.find((p) => p.id === storedId);
  if (match) return match.id;

  const fallbackId = players[0].id;
  try {
    localStorage.setItem(storageKey, fallbackId);
  } catch {
    // Non-critical - just means the choice won't persist across reloads.
  }
  return fallbackId;
}

export function setSelectedPlayer(userId, playerId) {
  try {
    localStorage.setItem(SELECTED_PLAYER_KEY_PREFIX + userId, playerId);
  } catch {
    // Non-critical.
  }
}

const AVATAR_COLORS = ['#4a3d78', '#1e7a41', '#c98a12', '#5b5470', '#2c6e8a'];

/** Renders the child-switcher tab row into `container` (an element already
 *  in the page) if there's more than one linked player - single-child
 *  accounts see nothing here at all, matching today's layout exactly.
 *  Calls onSelect(playerId) when the guardian taps a different child. */
export function renderChildSwitcher(container, players, selectedId, onSelect) {
  if (!container) return;
  if (!players || players.length <= 1) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = '';
  container.innerHTML = players
    .map((p, i) => {
      const initial = escapeHtml((p.name || '?').trim().charAt(0).toUpperCase());
      const color = AVATAR_COLORS[i % AVATAR_COLORS.length];
      const active = p.id === selectedId ? ' active' : '';
      const squadBits = [p.age_group, p.squad_number ? `#${p.squad_number}` : null]
        .filter(Boolean)
        .join(' · ');
      return `
        <button class="child-tab${active}" data-player-id="${escapeAttr(p.id)}" type="button">
          <span class="child-avatar" style="background:${color};">${initial}</span>
          <span class="child-meta">
            <span class="child-name">${escapeHtml(p.name)}</span>
            <span class="child-squad">${escapeHtml(squadBits)}</span>
          </span>
        </button>`;
    })
    .join('');

  container.querySelectorAll('.child-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const playerId = btn.getAttribute('data-player-id');
      if (playerId === selectedId) return;
      onSelect(playerId);
    });
  });
}
