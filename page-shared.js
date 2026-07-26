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
    const badge = document.getElementById('notices-badge');
    if (!badge) return;
    if (body.unread > 0) {
      badge.textContent = body.unread > 99 ? '99+' : String(body.unread);
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  } catch (err) {
    // Non-critical - badge just doesn't show this load.
  }
}

// Reveals the "Loyalty" drawer nav item if this player is a loyalty-active
// member. Non-critical on failure - the tab just stays hidden this load.
export async function loadActiveStatus(SUPABASE_URL, accessToken, userId) {
  try {
    const body = await cachedFetch(userId, 'get-my-active-status', async () => {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-my-active-status`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load active status');
      return json;
    });
    if (body.active) {
      const el = document.getElementById('loyalty-nav-item');
      if (el) el.style.display = 'flex';
    }
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
