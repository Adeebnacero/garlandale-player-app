// Garlandale FC player portal — offline-cache service worker.
//
// Strategy: NETWORK-FIRST, not cache-first. On every request, try the
// network first and cache whatever comes back; only serve the cached
// copy if the network genuinely fails (offline, no signal). This means
// every normal visit gets the latest deployed version automatically -
// the cache exists purely as an offline fallback, never as a reason to
// show stale content while online.
//
// Exception: pictures in images/ and icons/ (the club crest, app icons)
// are served from the phone's saved copy once they've been downloaded,
// because they almost never change and fetching them on every screen
// wastes mobile data. If you replace one of those pictures, keep the same
// file name AND bump CACHE_NAME below, so phones pick up the new one.
//
// CACHE_NAME is bumped whenever this file itself changes, which forces
// old cached entries to be discarded (see the "activate" handler below).
const CACHE_NAME = "garlandale-player-app-v16";
const APP_SHELL = [
  "./",
  "./index.html",
  "./home.html",
  "./profile.html",
  "./fixtures.html",
  "./notices.html",
  "./calendar.html",
  "./calendar.js",
  "./loyalty.html",
  "./shop.html",
  "./shop.js",
  "./signup.html",
  "./signup.js",
  "./supporter.js",
  "./install.js",
  "./push.js",
  "./reset-password.html",
  "./reset.js",
  "./password.js",
  "./accept-invite.html",
  "./styles.css",
  "./config.js",
  "./cache.js",
  "./manifest.json",
  "./images/crest.png",
  "./icons/favicon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // SECURITY: only cache same-origin requests (this app's own static
  // files). Cross-origin requests - every Supabase call (auth, REST,
  // Edge Functions) - are per-user data and must NEVER be cached by the
  // service worker. The service worker's cache has no concept of "which
  // player is asking" - it matches purely by URL, so caching an API
  // response here could serve one player's balance/contact info back to
  // a DIFFERENT player later on a shared device. Cross-origin requests
  // are passed straight to the network with no caching involved at all;
  // if the network's unavailable, they simply fail, which is correct -
  // an API call has no business "succeeding" offline with stale data.
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Only cache GET requests - same-origin POSTs don't occur in this app,
  // but this guards against ever accidentally caching a non-idempotent
  // request if that changes later.
  if (event.request.method !== "GET") {
    event.respondWith(fetch(event.request));
    return;
  }

  // Pictures: saved copy first, network only if it isn't saved yet.
  if (url.pathname.includes("/images/") || url.pathname.includes("/icons/")) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          }
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Got a real response - cache a copy for offline use, then return it.
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return response;
      })
      .catch(() => {
        // Network failed (offline) - fall back to whatever's cached.
        return caches.match(event.request);
      })
  );
});

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------
// The club's server (Supabase Edge Functions, see _shared/webpush.js) sends
// an encrypted message through the phone's push service; the browser
// decrypts it and hands it to us here as JSON:
//   { title, body, url, tag }
// Every push MUST show a notification - iPhones withdraw permission from
// sites that receive pushes without showing one - so a message we can't
// read still shows a plain "Garlandale FC" notification.
//
// tag: a later notification with the same tag replaces the earlier one on
// the lock screen instead of stacking (e.g. hourly "new notices" updates).

const DEFAULT_PUSH_URL = "notices.html";

// Only ever open pages of this app - never a URL from elsewhere, even if
// one somehow arrived in a message.
function safePushUrl(value) {
  try {
    const url = new URL(value || DEFAULT_PUSH_URL, self.registration.scope);
    if (url.origin === self.location.origin) return url.href;
  } catch { /* fall through */ }
  return new URL(DEFAULT_PUSH_URL, self.registration.scope).href;
}

self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : "" };
  }
  const title = (typeof msg.title === "string" && msg.title) || "Garlandale FC";
  const options = {
    body: typeof msg.body === "string" ? msg.body : "",
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",
    data: { url: safePushUrl(msg.url) },
    lang: "en-ZA",
  };
  if (typeof msg.tag === "string" && msg.tag) {
    options.tag = msg.tag;
    options.renotify = true; // still buzz when it replaces an older one
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping a notification: reuse an open app window if there is one,
// otherwise open the app at the notification's page.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safePushUrl(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      try {
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      } catch { /* that window can't be reused - open a new one below */ }
    }
    await self.clients.openWindow(target);
  })());
});
