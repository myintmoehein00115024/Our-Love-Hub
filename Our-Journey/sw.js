const CACHE = "our-journey-v13-unified-icon";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./drive-config.js",
  "../manifest.webmanifest",
  "../assets/icon-192.png",
  "../assets/icon-512.png",
  "../assets/apple-touch-icon.png",
  "../assets/favicon-32.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key.startsWith("our-journey-") && key !== CACHE).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Keep external birthday/chat pages online-first and leave third-party resources to the browser.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
