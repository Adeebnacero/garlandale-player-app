// Push notifications in the Player Portal (step 1: turning them on/off and
// a test notification).
//
// How it fits together:
//   - The browser makes a "subscription" for this device: a private
//     address at its push service (Google, Apple, Mozilla, Microsoft) plus
//     encryption keys. We save that with push-subscription (POST).
//   - The club's server sends to that address; service-worker.js shows the
//     notification. The phone never polls - nothing runs until a message
//     arrives.
//   - Signing out removes this device (so the next person to sign in on a
//     shared phone doesn't get the previous person's notifications).
//
// Where it works:
//   - Android (Chrome, Samsung Internet, Edge, Firefox): in the browser or
//     installed.
//   - iPhone/iPad: iOS 16.4+, and ONLY once added to the Home Screen.
//   - Not in WhatsApp/Facebook/Instagram's built-in browsers.

import { SUPABASE_URL } from './config.js';

const FN = `${SUPABASE_URL}/functions/v1/push-subscription`;
const SYNC_KEY = (uid) => `gfc_push_synced:${uid}`;
const SYNC_EVERY_MS = 24 * 3600 * 1000;

function withTimeout(promise, ms, label = 'Timed out') {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(label)), ms); }),
  ]);
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function browserCanPush() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function swRegistration() {
  if (!('serviceWorker' in navigator)) throw new Error('No service worker');
  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) reg = await navigator.serviceWorker.register('service-worker.js');
  return withTimeout(navigator.serviceWorker.ready, 8000, 'The app is still starting up - try again in a moment.');
}

async function currentSubscription() {
  if (!browserCanPush()) return null;
  try {
    const reg = await swRegistration();
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

async function callFn(method, accessToken, body) {
  const res = await withTimeout(fetch(FN, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }), 10000, 'Couldn’t reach the club’s server. Check your connection and try again.');
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Something went wrong. Please try again.');
  return json;
}

/**
 * Where this device stands:
 *   'on' | 'off' | 'denied' | 'needs-install' | 'in-app' | 'unsupported'
 */
export async function pushState(env) {
  if (env && env.inApp) return 'in-app';
  if (env && env.ios && !env.installed) return 'needs-install';
  if (!browserCanPush()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  return (await currentSubscription()) ? 'on' : 'off';
}

async function saveSubscription(accessToken, uid, sub) {
  await callFn('POST', accessToken, { subscription: sub.toJSON() });
  try { localStorage.setItem(SYNC_KEY(uid), String(Date.now())); } catch { /* storage unavailable */ }
}

/**
 * Turns notifications on. Call straight from a tap: browsers (iPhones in
 * particular) only show the permission question in response to one, which
 * is why the key and service worker are fetched ahead of time.
 */
async function enablePush(accessToken, uid, reg, publicKey) {
  const options = { userVisibleOnly: true, applicationServerKey: b64urlToBytes(publicKey) };
  let sub;
  try {
    sub = await reg.pushManager.subscribe(options);
  } catch (err) {
    if (err && err.name === 'InvalidStateError') {
      // An older subscription made with a different key - replace it.
      const old = await reg.pushManager.getSubscription();
      if (old) await old.unsubscribe();
      sub = await reg.pushManager.subscribe(options);
    } else {
      throw err;
    }
  }
  try {
    await saveSubscription(accessToken, uid, sub);
  } catch (err) {
    // Don't leave the phone thinking it's on when the club doesn't know.
    try { await sub.unsubscribe(); } catch { /* ignore */ }
    throw err;
  }
}

async function disablePush(accessToken) {
  const sub = await currentSubscription();
  if (!sub) return;
  await callFn('DELETE', accessToken, { endpoint: sub.endpoint });
  await sub.unsubscribe();
}

/**
 * Quietly re-saves this device about once a day while notifications are
 * on. Push services occasionally change a device's address; this keeps the
 * club's copy current. One tiny request a day, and only when it's on.
 */
export async function syncPushSubscription(accessToken, uid, { force = false } = {}) {
  try {
    if (!browserCanPush() || Notification.permission !== 'granted') return;
    if (!force) {
      const last = Number(localStorage.getItem(SYNC_KEY(uid)) || 0);
      if (Date.now() - last < SYNC_EVERY_MS) return;
    }
    const sub = await currentSubscription();
    if (sub) await saveSubscription(accessToken, uid, sub);
  } catch { /* non-critical - tried again next time */ }
}

/**
 * Sign-out: removes this device from the club's list and from the browser.
 * Best effort and quick - never holds up signing out.
 */
export async function removePushOnSignOut(supabase) {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    const { data } = await withTimeout(supabase.auth.getSession(), 2000);
    const token = data && data.session && data.session.access_token;
    if (token) await withTimeout(callFn('DELETE', token, { endpoint: sub.endpoint }), 3000).catch(() => {});
    await withTimeout(sub.unsubscribe(), 2000).catch(() => {});
  } catch { /* signing out carries on regardless */ }
}

// ---------------------------------------------------------------------------
// Profile card
// ---------------------------------------------------------------------------

const COPY = {
  off: 'Get a notification on this phone when the club posts a notice, even when the app is closed.',
  on: 'Notifications are on for this phone.',
  denied: 'Notifications are blocked for this app. To turn them on, allow notifications for Garlandale FC in your phone’s settings, then come back here.',
  'needs-install': 'On iPhone and iPad, notifications work once the app is on your Home Screen.',
  'in-app': 'Open this page in Chrome or Safari (not inside WhatsApp or Facebook) to turn on notifications.',
  unsupported: 'This phone or browser can’t show notifications from the app. On iPhone, update to iOS 16.4 or later and add the app to your Home Screen.',
};

/**
 * Adds a "Notifications" card to `container` (before `before`, if given).
 */
export async function renderNotificationsCard(container, { accessToken, uid, before = null } = {}) {
  if (!container) return;
  const { environment, isInstalled, startInstall } = await import('./install.js');
  const env = { ...environment(), installed: isInstalled() };

  const card = document.createElement('div');
  card.className = 'card push-card';
  card.innerHTML = `
    <p class="card-label">Notifications</p>
    <p class="supporter-note push-text"></p>
    <div class="push-actions"></div>
    <p class="push-msg" role="status" hidden></p>`;
  container.insertBefore(card, before);

  const text = card.querySelector('.push-text');
  const actions = card.querySelector('.push-actions');
  const msg = card.querySelector('.push-msg');
  const say = (t, ok = false) => { msg.textContent = t; msg.hidden = !t; msg.classList.toggle('ok', ok); };

  // Fetched up front so the "Turn on" tap can go straight to the browser.
  let reg = null;
  let publicKey = null;
  async function prepare() {
    if (!browserCanPush()) return;
    try { reg = await swRegistration(); } catch { /* retried on tap */ }
    try { publicKey = (await callFn('GET', accessToken)).publicKey; } catch { /* retried on tap */ }
  }

  function button(label, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', async () => {
      const original = b.textContent;
      actions.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      try { await onClick(b); } finally {
        b.textContent = original;
        actions.querySelectorAll('button').forEach((x) => { x.disabled = false; });
      }
    });
    actions.appendChild(b);
    return b;
  }

  async function draw(state) {
    text.textContent = COPY[state] || COPY.unsupported;
    actions.innerHTML = '';

    if (state === 'off') {
      button('Turn on notifications', 'supporter-primary', async (b) => {
        b.textContent = 'Turning on…';
        say('');
        try {
          if (!reg) reg = await swRegistration();
          if (!publicKey) publicKey = (await callFn('GET', accessToken)).publicKey;
          await enablePush(accessToken, uid, reg, publicKey);
          await draw('on');
          say('Done. Send yourself a test to check it works.', true);
        } catch (err) {
          if (err && err.name === 'NotAllowedError') {
            await draw(Notification.permission === 'denied' ? 'denied' : 'off');
            if (Notification.permission !== 'denied') say('Notifications weren’t allowed. Tap the button again and choose Allow.');
          } else {
            say((err && err.message) || 'Couldn’t turn notifications on. Please try again.');
          }
        }
      });
    } else if (state === 'on') {
      button('Send a test notification', 'password-btn', async (b) => {
        b.textContent = 'Sending…';
        say('');
        try {
          const res = await withTimeout(fetch(`${SUPABASE_URL}/functions/v1/send-test-push`, {
            method: 'POST', headers: { Authorization: `Bearer ${accessToken}` },
          }), 15000, 'Couldn’t reach the club’s server. Check your connection and try again.');
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || 'Couldn’t send a test right now.');
          if (json.sent > 0) say('Sent – it should arrive in a few seconds.', true);
          else say('This phone isn’t registered any more. Turn notifications off and on again.');
        } catch (err) {
          say((err && err.message) || 'Couldn’t send a test right now.');
        }
      });
      button('Turn off', 'push-off', async (b) => {
        b.textContent = 'Turning off…';
        say('');
        try {
          await disablePush(accessToken);
          await draw('off');
          say('Notifications are off for this phone.', true);
        } catch (err) {
          say((err && err.message) || 'Couldn’t turn notifications off. Please try again.');
        }
      });
    } else if (state === 'needs-install') {
      button('Show me how', 'password-btn', async () => { await startInstall(null); });
    }
  }

  const state = await pushState(env);
  await draw(state);
  if (state === 'off') prepare();
  // Already on: make sure the club's copy is current (and belongs to this login).
  if (state === 'on') syncPushSubscription(accessToken, uid, { force: true });
}
