// page-shared.js
//
// Common UI wiring that was previously duplicated (byte-for-byte, in most
// cases) across every authenticated page: the hamburger drawer, the
// notices badge, the Loyalty nav-item visibility check, refresh/sign-out,
// service worker registration, and HTML-escaping. Extracted here so a fix
// only has to happen in one place instead of five.

import { cachedFetch, clearUserCache } from './cache.js';

// ---------------------------------------------------------------------------
// Add-to-calendar (.ics) support for fixtures. Pure client-side - no
// network call, no backend change needed. Times are written as "floating"
// (no Z/timezone suffix), which calendar apps interpret in the viewer's
// own local time - correct here since a fixture kicks off at a fixed
// local wall-clock time regardless of where the guardian's phone thinks
// it is.
// ---------------------------------------------------------------------------

function icsEscape(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Builds the raw .ics file contents for a single fixture. Falls back to
// an all-day event if kickoff_time isn't set - still useful (shows up on
// the right date) rather than being skipped entirely.
export function buildFixtureICS(fixture) {
  const summary = `Garlandale FC vs ${fixture.opponent || 'TBC'}`;
  const location = fixture.venue || 'TBC';
  const directions = safeMapsLink(fixture.location_link);
  const description = 'Please report 1 hour before kick-off.' +
    (directions ? `\nDirections: ${directions}` : '');
  const uid = `gfc-${fixture.match_date}-${Math.random().toString(36).slice(2)}@garlandalefc`;

  const now = new Date();
  const dtstamp =
    `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}T` +
    `${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`;

  const [y, m, d] = fixture.match_date.split('-').map(Number);
  let dtStartLine, dtEndLine;

  if (fixture.kickoff_time) {
    const [hh, mm] = fixture.kickoff_time.split(':').map(Number);
    const start = new Date(y, m - 1, d, hh, mm, 0);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // 2-hour default duration
    const fmt = (dt) =>
      `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}T` +
      `${pad2(dt.getHours())}${pad2(dt.getMinutes())}00`;
    dtStartLine = `DTSTART:${fmt(start)}`;
    dtEndLine = `DTEND:${fmt(end)}`;
  } else {
    const dateOnly = `${y}${pad2(m)}${pad2(d)}`;
    const next = new Date(Date.UTC(y, m - 1, d));
    next.setUTCDate(next.getUTCDate() + 1);
    const nextDate = `${next.getUTCFullYear()}${pad2(next.getUTCMonth() + 1)}${pad2(next.getUTCDate())}`;
    dtStartLine = `DTSTART;VALUE=DATE:${dateOnly}`;
    dtEndLine = `DTEND;VALUE=DATE:${nextDate}`;
  }

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Garlandale FC//Player App//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    dtStartLine,
    dtEndLine,
    `SUMMARY:${icsEscape(summary)}`,
    `LOCATION:${icsEscape(location)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

// ---------------------------------------------------------------------------
// Venue locations (fixtures and notices). Staff paste these in Club
// Management; the Player Portal only ever shows what they entered, never a
// guess. Two optional fields per item:
//   location_link  -> Directions button (a Google Maps share link)
//   location_embed -> Show map button (a Google Maps embed address)
//
// Both are checked in Club Management and by the database before they're
// saved. They are checked once more here before anything is displayed, so
// a bad value can never reach a guardian's screen, and the map iframe is
// always built by this code - pasted HTML is never inserted.
// ---------------------------------------------------------------------------

const MAPS_LINK_RULES = [
  { host: /^maps\.app\.goo\.gl$/, path: /^\/.+/ },
  { host: /^goo\.gl$/, path: /^\/maps\/.+/ },
  { host: /^(www\.)?google\.(com|co\.za)$/, path: /^\/maps(\/|$)/ },
  { host: /^maps\.google\.(com|co\.za)$/, path: /^\// },
];
const MAPS_UNSAFE_CHARS = /[\s"'<>`\\]/;

function parseSafeHttpsUrl(value) {
  const s = String(value || '');
  if (!s || s.length > 2000 || MAPS_UNSAFE_CHARS.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    return u;
  } catch {
    return null;
  }
}

// Returns the link if it's a genuine Google Maps link, otherwise null.
export function safeMapsLink(value) {
  const u = parseSafeHttpsUrl(value);
  if (!u) return null;
  return MAPS_LINK_RULES.some((r) => r.host.test(u.hostname) && r.path.test(u.pathname)) ? u.href : null;
}

// Returns the address if it's a genuine Google Maps embed, otherwise null.
export function safeMapsEmbed(value) {
  const u = parseSafeHttpsUrl(value);
  if (!u) return null;
  return /^(www\.)?google\.com$/.test(u.hostname) &&
    /^\/maps\/embed(\/v1\/[a-z]+)?$/.test(u.pathname) && u.search
    ? u.href
    : null;
}

const PIN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>';
const MAP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>';

/**
 * HTML for the Directions / Show map buttons of one fixture or notice.
 * Returns '' when the item has no (valid) location, so callers can drop it
 * straight into a template. `key` must be unique on the page - it links
 * the Show map button to its map box (see locationMapBoxHtml).
 */
export function locationButtonsHtml(item, key) {
  const link = safeMapsLink(item && item.location_link);
  const embed = safeMapsEmbed(item && item.location_embed);
  let html = '';
  if (link) {
    html += `<a class="add-to-calendar-btn" href="${escapeAttr(link)}" target="_blank" rel="noopener">${PIN_ICON} Directions</a>`;
  }
  if (embed) {
    html += `<button type="button" class="add-to-calendar-btn show-map-btn" data-map-key="${escapeAttr(key)}" aria-expanded="false">${MAP_ICON} <span>Show map</span></button>`;
  }
  return html;
}

// Empty, hidden box the map is loaded into when Show map is tapped.
export function locationMapBoxHtml(item, key) {
  const embed = safeMapsEmbed(item && item.location_embed);
  return embed
    ? `<div class="venue-map" data-map-box="${escapeAttr(key)}" data-embed="${escapeAttr(embed)}" hidden></div>`
    : '';
}

/**
 * Handles a click on a Show map button inside `root`. Call it first from a
 * delegated click handler; returns true if it dealt with the click. The
 * iframe is only created the first time a map is opened, so a page of
 * fixtures doesn't download several maps on a phone connection.
 */
export function handleShowMapClick(e, root) {
  const btn = e.target.closest('.show-map-btn');
  if (!btn || !root.contains(btn)) return false;
  const key = btn.getAttribute('data-map-key');
  const box = Array.from(root.querySelectorAll('[data-map-box]')).find((b) => b.getAttribute('data-map-box') === key);
  if (!box) return true;
  const opening = box.hidden;
  if (opening && !box.firstChild) {
    const src = safeMapsEmbed(box.getAttribute('data-embed'));
    if (!src) return true;
    const iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.title = 'Venue map';
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'no-referrer-when-downgrade';
    iframe.allowFullscreen = true;
    // Google Maps needs scripts to draw the map; everything else a framed
    // page could do (redirect this app, open forms, etc.) stays blocked.
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    box.appendChild(iframe);
  }
  box.hidden = !opening;
  const label = btn.querySelector('span');
  if (label) label.textContent = opening ? 'Hide map' : 'Show map';
  btn.setAttribute('aria-expanded', String(opening));
  return true;
}

// Triggers a browser download of the .ics file for one fixture.
export function downloadFixtureICS(fixture) {
  const ics = buildFixtureICS(fixture);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeOpponent = (fixture.opponent || 'fixture').replace(/[^a-z0-9]+/gi, '-');
  a.download = `garlandale-fc-vs-${safeOpponent}-${fixture.match_date}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// How long we'll wait for the initial auth.getSession() call before giving
// up and showing a retry option. Plain "is there a session" reads are
// normally instant, but supabase-js can end up waiting on a stuck token
// refresh - e.g. a request that was in flight when the OS suspended the
// tab/app, or a cross-tab auth lock that never released - and in that case
// the promise can simply hang forever with nothing to indicate why.
const SESSION_CHECK_TIMEOUT_MS = 7000;

/**
 * Wraps supabase.auth.getSession() with a timeout. Without this, a stuck
 * session check leaves the "Checking your session..." screen up
 * indefinitely with no way out short of a force-quit - this is the
 * underlying cause of the app appearing to hang on refresh or on reopen
 * after the device has been idle for a while.
 *
 * Resolves with the normal { data } shape on success. Throws
 * SESSION_CHECK_TIMEOUT on timeout so callers can show a retry state.
 */
export async function getSessionOrTimeout(supabase, timeoutMs = SESSION_CHECK_TIMEOUT_MS) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error('Timed out checking your session');
      err.code = 'SESSION_CHECK_TIMEOUT';
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([supabase.auth.getSession(), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Puts a loading screen into its "couldn't check your session" state:
 * swaps the message and reveals a "Try again" button that hard-reloads
 * the page. Used when the initial session check times out or throws, so
 * the person has a way out other than force-quitting the app.
 *
 * Expects the loading element to contain a `[data-loading-message]` node
 * for the text and a `[data-loading-retry]` button - see the loading-page
 * markup in each page's HTML.
 */
export function showSessionCheckError(loadingEl) {
  if (!loadingEl) return;
  const messageEl = loadingEl.querySelector('[data-loading-message]');
  if (messageEl) {
    messageEl.textContent = "Couldn't check your session. Check your connection and try again.";
  }
  loadingEl.classList.add('is-error');
  const retryBtn = loadingEl.querySelector('[data-loading-retry]');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => window.location.reload());
  }
}

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
      startNavigationFeedback();
      window.location.reload();
    });
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      startNavigationFeedback();
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
      // On the home page the badge sits inside a quick-action tile - highlight
      // the whole tile (not just the badge) when there's something unread.
      // No-ops elsewhere (e.g. the bottom nav dot has no .tile ancestor).
      const tile = badge.closest('.tile');
      if (tile) tile.classList.toggle('tile-accent', body.unread > 0);
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

// ---------------------------------------------------------------------------
// Loading feedback when moving between screens.
//
// Each screen is its own page, so after a tap the old screen stays put
// until the next one arrives. setupNavigationFeedback() shows that the tap
// worked: a thin gold bar across the top if the next screen takes more
// than 0.3 seconds, and the crest with a turning ring if it takes more than
// 1 second. Quick switches show nothing, so there's no flicker.
//
// Call it once per page. For navigations started from code rather than a
// link (e.g. opening Yoco, signing out), call startNavigationFeedback()
// just before changing window.location.
// ---------------------------------------------------------------------------
const NAV_BAR_DELAY_MS = 300;
const NAV_OVERLAY_DELAY_MS = 1000;
let navTimers = [];
let navEls = null;

function navElements() {
  if (navEls) return navEls;
  const bar = document.createElement('div');
  bar.className = 'nav-progress';
  bar.setAttribute('aria-hidden', 'true');
  const overlay = document.createElement('div');
  overlay.className = 'nav-overlay';
  overlay.setAttribute('role', 'status');
  overlay.innerHTML = '<div class="loader-emblem" aria-hidden="true"><img src="images/crest.png" alt="" width="48" height="56"></div><span>Loading…</span>';
  document.body.append(bar, overlay);
  navEls = { bar, overlay };
  return navEls;
}

export function stopNavigationFeedback() {
  navTimers.forEach(clearTimeout);
  navTimers = [];
  if (navEls) {
    navEls.bar.classList.remove('show');
    navEls.overlay.classList.remove('show');
  }
}

export function startNavigationFeedback() {
  const { bar, overlay } = navElements();
  stopNavigationFeedback();
  navTimers.push(setTimeout(() => bar.classList.add('show'), NAV_BAR_DELAY_MS));
  navTimers.push(setTimeout(() => overlay.classList.add('show'), NAV_OVERLAY_DELAY_MS));
}

export function setupNavigationFeedback() {
  if (window.__gfcNavFeedback) return;
  window.__gfcNavFeedback = true;
  navElements(); // create now, so the crest image is already loaded when needed

  document.addEventListener('click', (e) => {
    // Runs after the page's own click handlers, so anything they handled
    // themselves (defaultPrevented) is left alone.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.hasAttribute('download')) return;
    if (a.target && a.target !== '_self') return;           // opens a new tab or app
    let url;
    try { url = new URL(a.href, location.href); } catch { return; }
    if (url.origin !== location.origin) return;             // tel:, mailto:, other sites
    if (url.pathname === location.pathname && url.search === location.search) return; // same screen
    startNavigationFeedback();
  });

  // Coming back with the phone's back button can show the old page from
  // memory, still showing the loader: clear it.
  window.addEventListener('pageshow', stopNavigationFeedback);
}

// The top bar stays at the top of the screen while scrolling (see the
// sticky header rule in styles.css). This adds a soft shadow under it once
// the page has scrolled, so it's clear the content is moving beneath it,
// and makes the browser leave room for the bar when it scrolls anything
// into view. Does nothing on Home, whose big header isn't fixed.
export function setupStickyHeader() {
  const header = document.querySelector('body.home-page header:not(.hero-header)');
  if (!header || getComputedStyle(header).position !== 'sticky') return;
  const update = () => header.classList.toggle('is-scrolled', window.scrollY > 4);
  window.addEventListener('scroll', update, { passive: true });
  update();
  document.documentElement.style.scrollPaddingTop = `${header.offsetHeight + 8}px`;
}

// Shows the Shop tab in the bottom navigation only while the club shop is
// open. Shows the last known state straight away (so the tab doesn't pop
// in and out), then checks get-shop?summary=1 in the background, so
// switching the shop on or off in Club Management shows up the next time
// a page opens. Non-critical: if the check fails, nothing changes.
export async function updateShopNav(SUPABASE_URL, accessToken, userId) {
  const key = `gfc_shop_open_${userId}`;
  const apply = (open) => {
    document.querySelectorAll('[data-shop-nav]').forEach((el) => { el.style.display = open ? 'flex' : 'none'; });
  };
  try { apply(localStorage.getItem(key) === '1'); } catch { /* storage unavailable */ }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/get-shop?summary=1`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return;
    const body = await res.json();
    apply(!!body.open);
    try { localStorage.setItem(key, body.open ? '1' : '0'); } catch { /* storage unavailable */ }
  } catch {
    // Offline or not deployed yet - keep whatever is showing.
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
// Tappable web links in notice text.
//
// Notices are typed as plain text in Club Management. linkifyText() turns
// any secure web address in that text into a link that opens in the
// phone's browser, and escapes everything else, so the result is always
// safe to put into innerHTML.
//
//   https://...  -> link
//   www....      -> link (treated as https://)
//   http://...   -> left as plain text (not secure)
//
// Addresses with a username/password part (a trick for disguising the real
// site, e.g. https://garlandale.co.za@other.site) also stay as plain text.
// Trailing punctuation (the full stop after a link at the end of a
// sentence, a closing bracket around it) is left outside the link. Long
// addresses are shortened on screen, but the site name always stays
// visible so guardians can see where a link goes.
// ---------------------------------------------------------------------------

const LINK_CANDIDATE = /\b(?:https?:\/\/|www\.)[^\s<>"`]+/gi;
const LINK_DISPLAY_MAX = 40;
const CLOSING_TO_OPENING = { ')': '(', ']': '[', '}': '{' };

function trimLinkPunctuation(raw) {
  let s = raw;
  for (;;) {
    const last = s.slice(-1);
    if (/[.,;:!?'*]/.test(last)) { s = s.slice(0, -1); continue; }
    // Only drop a closing bracket if it doesn't belong to the address
    // itself: keep the ")" in .../Foo_(bar), drop it in "(see ...)".
    const opening = CLOSING_TO_OPENING[last];
    if (opening && s.split(last).length > s.split(opening).length) { s = s.slice(0, -1); continue; }
    return s;
  }
}

function toSecureLink(candidate) {
  if (/^http:\/\//i.test(candidate)) return null;
  const withScheme = /^www\./i.test(candidate) ? `https://${candidate}` : candidate;
  let u;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  if (!u.hostname.includes('.') || u.hostname.endsWith('.')) return null;
  return u;
}

function linkDisplayText(u) {
  let text = u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname) + u.search + u.hash;
  try { text = decodeURI(text); } catch { /* keep the encoded form */ }
  return text.length > LINK_DISPLAY_MAX ? `${text.slice(0, LINK_DISPLAY_MAX - 1)}…` : text;
}

/**
 * Escapes `text` for HTML and turns each secure web address in it into a
 * link that opens in the browser. Safe to assign to innerHTML.
 */
export function linkifyText(text) {
  const str = String(text ?? '');
  let html = '';
  let last = 0;
  for (const match of str.matchAll(LINK_CANDIDATE)) {
    const candidate = trimLinkPunctuation(match[0]);
    const u = toSecureLink(candidate);
    if (!u) continue; // stays plain text, escaped along with the rest
    html += escapeHtml(str.slice(last, match.index));
    html += `<a class="notice-link" href="${escapeAttr(u.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkDisplayText(u))}</a>`;
    last = match.index + candidate.length;
  }
  return html + escapeHtml(str.slice(last));
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
