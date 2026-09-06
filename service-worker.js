// Minimal app-shell cache so the PWA is installable. Data (db.json etc.) always
// goes straight to Google Drive and is never touched by this cache.
const CACHE_NAME = "cfo-app-shell-v1";
const APP_SHELL = ["/", "/index.html", "/css/styles.css", "/js/app.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
