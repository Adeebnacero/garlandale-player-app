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
const CACHE_NAME = "garlandale-player-app-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./home.html",
  "./styles.css",
  "./config.js",
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
