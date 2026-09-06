// Minimal app-shell cache so the PWA is installable. Data (db.json etc.) always
// goes straight to Google Drive and is never touched by this cache.
//
// Network-first, not cache-first: every deploy must actually reach users the
// next time they're online. A cache-first strategy here previously meant the
// very first version anyone loaded got stuck forever, since no CACHE_NAME
// bump is triggered by a normal deploy. Cache is only a fallback for when the
// network request itself fails (e.g. genuinely offline).
const CACHE_NAME = "cfo-app-shell-v2";
const APP_SHELL = ["/", "/index.html", "/css/styles.css", "/js/app.js"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))),
      self.clients.claim(),
    ])
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
