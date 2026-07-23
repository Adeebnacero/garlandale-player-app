// Minimal offline-cache service worker for the Garlandale FC player portal.
// Iteration 1: caches the app shell only, so it can still open with no
// network. No real API caching yet - that comes once the app talks to
// real Supabase endpoints.
const CACHE_NAME = "garlandale-player-app-v1";
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
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
