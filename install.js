// Helping people install the Player Portal as an app.
//
// Browsers never let a site install itself, so this gets as close as they
// allow:
//   - Android / Chrome, Edge, Samsung Internet: the browser says the app is
//     installable (the "beforeinstallprompt" event, caught early by a small
//     script in each page's <head>). Our Install button opens the browser's
//     own install screen: one tap for us, one tap to confirm.
//   - iPhone / iPad: Apple doesn't allow that, so we show a short guide that
//     points at Safari's Share button.
//   - Inside WhatsApp, Facebook, Instagram etc.: apps can't be installed from
//     those built-in browsers at all, so we first help people open the page
//     in Chrome (Android, one tap) or Safari (iPhone, two steps).
//   - Already installed (opened from the home-screen icon): nothing is shown.
//
// The Home card can be dismissed for 30 days; "Install the app" stays in
// the ☰ menu.

import { escapeHtml } from './page-shared.js';

const DISMISS_KEY = 'gfc_install_dismissed_until';
const DISMISS_DAYS = 30;
const CREST = 'images/crest.png';

const ICON_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v8h14v-8"/></svg>';
const ICON_ADD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>';

// ---------------------------------------------------------------------------
// Where are we?
// ---------------------------------------------------------------------------
export function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true;
}

/** Details about the browser, from its user-agent. */
export function environment(ua = navigator.userAgent, platform = navigator.platform, touchPoints = navigator.maxTouchPoints) {
  const ios = /iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
  const android = /Android/i.test(ua);
  const inAppName =
    /WhatsApp/i.test(ua) ? 'WhatsApp' :
    /FBAN|FBAV|FB_IAB|FBIOS/i.test(ua) ? 'Facebook' :
    /Instagram/i.test(ua) ? 'Instagram' :
    /Line\//i.test(ua) ? 'LINE' :
    /Snapchat/i.test(ua) ? 'Snapchat' :
    /TikTok|musical_ly|Bytedance/i.test(ua) ? 'TikTok' :
    (android && /; wv\)/.test(ua)) ? 'this app' : null;
  const iosOtherBrowser = ios && /CriOS|FxiOS|EdgiOS/i.test(ua);
  return { ios, android, inApp: inAppName, iosOtherBrowser, ipad: /iPad/i.test(ua) || (ios && touchPoints > 1 && !/iPhone/i.test(ua)) };
}

function installPrompt() { return window.__gfcInstallPrompt || null; }

function dismissedNow() {
  try { return Number(localStorage.getItem(DISMISS_KEY) || 0) > Date.now(); } catch { return false; }
}
function dismissForAWhile() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86400000)); } catch { /* storage unavailable */ }
}

/** What help to offer: 'prompt' | 'ios' | 'inapp' | null (nothing). */
export function installMode(env = environment()) {
  if (isInstalled()) return null;
  if (env.inApp) return 'inapp';
  if (installPrompt()) return 'prompt';
  if (env.ios) return 'ios';
  return null;
}

/** An intent link that opens this page in Chrome (Android in-app browsers). */
export function openInChromeUrl(href = location.href) {
  const u = new URL(href);
  const fallback = encodeURIComponent(u.href);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
}

// ---------------------------------------------------------------------------
// The card (Home) and the in-app notice (sign-in page)
// ---------------------------------------------------------------------------
function inAppHtml(env, { beforeSignIn = false } = {}) {
  const where = escapeHtml(env.inApp || 'this app');
  const why = beforeSignIn
    ? `You opened this from ${where}. To install the app, open it in ${env.ios ? 'Safari' : 'Chrome'} first, then sign in there.`
    : `You opened this from ${where}, and apps can’t be installed from inside ${where}. Open it in ${env.ios ? 'Safari' : 'Chrome'} first.`;
  if (env.android) {
    return `<b>Open in Chrome to install the app</b><p>${why}</p>
      <a class="install-btn" href="${escapeHtml(openInChromeUrl())}">Open in Chrome</a>`;
  }
  return `<b>Open in Safari to install the app</b><p>${why}</p>
    <ol class="install-steps">
      <li><span>Tap the menu button (${ICON_SHARE} or ⋯) at the top or bottom of the screen</span></li>
      <li><span>Choose <b>Open in Safari</b> (or <b>Open in browser</b>)</span></li>
    </ol>`;
}

/**
 * Home: fills `container` with the install card when there's something
 * useful to offer, or empties it.
 */
export function renderInstallCard(container) {
  if (!container) return;
  const env = environment();
  const mode = installMode(env);
  if (!mode || dismissedNow()) { container.innerHTML = ''; return; }
  if (mode === 'inapp') {
    container.innerHTML = `<section class="install-inapp" aria-label="Open in your browser">
      <button class="install-close" type="button" aria-label="Not now">×</button>${inAppHtml(env)}</section>`;
  } else {
    container.innerHTML = `<section class="install-card" aria-label="Get the app">
      <button class="install-close" type="button" aria-label="Not now">×</button>
      <div class="install-head"><img src="${CREST}" alt="" width="46" height="46"><div>
        <b>Get the Garlandale FC app</b><span>Opens straight from your home screen, works offline, and saves mobile data.</span></div></div>
      <button class="install-btn" type="button" data-install-go>${mode === 'prompt' ? 'Install' : 'Show me how (3 quick steps)'}</button>
    </section>`;
  }
  container.querySelector('.install-close').addEventListener('click', () => { dismissForAWhile(); container.innerHTML = ''; });
  const go = container.querySelector('[data-install-go]');
  if (go) go.addEventListener('click', () => startInstall(container));
}

/** Sign-in page: before signing in, point in-app browsers at Chrome/Safari. */
export function renderSignInNotice(container) {
  if (!container) return;
  const env = environment();
  if (isInstalled() || !env.inApp) { container.innerHTML = ''; return; }
  container.innerHTML = `<div class="install-inapp signin">${inAppHtml(env, { beforeSignIn: true })}</div>`;
}

// ---------------------------------------------------------------------------
// Doing it
// ---------------------------------------------------------------------------
export async function startInstall(cardContainer) {
  const env = environment();
  const mode = installMode(env);
  if (mode === 'prompt') {
    const p = installPrompt();
    try {
      p.prompt();
      const choice = await p.userChoice;
      window.__gfcInstallPrompt = null;              // each prompt can only be used once
      if (choice && choice.outcome === 'accepted' && cardContainer) cardContainer.innerHTML = '';
    } catch { /* the browser refused; nothing else to do */ }
    refreshInstallMenu();
    return;
  }
  if (mode === 'ios') { showIosGuide(env); return; }
  if (mode === 'inapp') { showInAppSheet(env); }
}

function closeOnEscape(el) {
  const onKey = (e) => { if (e.key === 'Escape') { el.remove(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

function showIosGuide(env) {
  document.getElementById('install-guide')?.remove();
  // Safari puts Share in the bottom bar on iPhone; iPad Safari and other
  // iOS browsers put it at the top right.
  const shareAtTop = env.ipad || env.iosOtherBrowser;
  const el = document.createElement('div');
  el.id = 'install-guide';
  el.className = `install-guide${shareAtTop ? ' share-top' : ''}`;
  el.innerHTML = `
    <div class="install-guide-dim"></div>
    <div class="install-guide-card" role="dialog" aria-modal="true" aria-labelledby="install-guide-title">
      <h3 id="install-guide-title">Add the app to your home screen</h3>
      <ol class="install-steps">
        <li><span>Tap <b>Share</b> ${ICON_SHARE} ${shareAtTop ? 'at the top right of the screen' : 'in Safari’s bar at the bottom of the screen'}</span></li>
        <li><span>Scroll down and tap <b>Add to Home Screen</b> ${ICON_ADD}</span></li>
        <li><span>Tap <b>Add</b> in the top right corner</span></li>
      </ol>
      <p class="install-guide-note">The Garlandale FC icon then appears on your home screen. Open the app from there.</p>
      <p class="install-guide-note"><b>Don’t see Add to Home Screen?</b> You may be in another app’s browser (for example after tapping a link in WhatsApp). Tap the Safari (compass) button to open the page in Safari, then try again.</p>
      <button type="button" class="install-btn" data-close>Got it</button>
    </div>
    <span class="install-guide-arrow" aria-hidden="true"></span>`;
  document.body.appendChild(el);
  el.querySelector('[data-close]').addEventListener('click', () => el.remove());
  el.querySelector('.install-guide-dim').addEventListener('click', () => el.remove());
  el.querySelector('[data-close]').focus();
  closeOnEscape(el);
}

function showInAppSheet(env) {
  document.getElementById('install-guide')?.remove();
  const el = document.createElement('div');
  el.id = 'install-guide';
  el.className = 'install-guide';
  el.innerHTML = `<div class="install-guide-dim"></div>
    <div class="install-guide-card install-inapp" role="dialog" aria-modal="true">${inAppHtml(env)}
      <button type="button" class="install-btn secondary" data-close>Close</button></div>`;
  document.body.appendChild(el);
  el.querySelector('[data-close]').addEventListener('click', () => el.remove());
  el.querySelector('.install-guide-dim').addEventListener('click', () => el.remove());
  closeOnEscape(el);
}

// ---------------------------------------------------------------------------
// The ☰ menu item
// ---------------------------------------------------------------------------
export function refreshInstallMenu() {
  const show = !!installMode();
  document.querySelectorAll('[data-install-menu]').forEach((el) => { el.style.display = show ? 'flex' : 'none'; });
}

/**
 * Call once per page: wires the ☰ "Install the app" item and keeps it (and
 * the Home card, if given) up to date as the browser reports installability.
 */
export function setupInstall({ card } = {}) {
  document.querySelectorAll('[data-install-menu]').forEach((el) => {
    el.addEventListener('click', (e) => { e.preventDefault(); startInstall(card); });
  });
  refreshInstallMenu();
  if (card) renderInstallCard(card);
  window.addEventListener('gfc-installable', () => { refreshInstallMenu(); if (card) renderInstallCard(card); });
  window.addEventListener('appinstalled', () => {
    window.__gfcInstallPrompt = null;
    refreshInstallMenu();
    if (card) card.innerHTML = '';
  });
}
