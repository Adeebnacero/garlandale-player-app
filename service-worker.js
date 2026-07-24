// Garlandale FC player portal — offline-cache service worker.
//
// Strategy: NETWORK-FIRST, not cache-first. On every request, try the
// network first and cache whatever comes back; only serve the cached
// copy if the network genuinely fails (offline, no signal). This means
// every normal visit gets the latest deployed version automatically -
// the cache exists purely as an offline fallback, never as a reason to
// show stale content while online.
//
// CACHE_NAME is bumped whenever this file itself changes, which forces
// old cached entries to be discarded (see the "activate" handler below).
const CACHE_NAME = "garlandale-player-app-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./home.html",
  "./profile.html",
  "./fixtures.html",
  "./notices.html",
  "./loyalty.html",
  "./accept-invite.html",
  "./styles.css",
  "./config.js",
  "./cache.js",
  "./manifest.json",
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
