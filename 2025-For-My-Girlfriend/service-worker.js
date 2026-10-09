const CACHE_NAME = "thinthin-shell-v17-pwa-audit-20261009";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "../assets/favicon-32.png",
  "../assets/apple-touch-icon.png",
  "../assets/icon-192.png",
  "../assets/icon-512.png",
  "../assets/icon-512-maskable.png",
  "./css/style.css",
  "./css/2025-responsive.css",
  "./css/2025-inner.css",
  "./js/index.js",
  "./js/pwa-install.js",
  "./message/index.html",
  "./message/css/style.css",
  "./Love/index.html",
  "./Love/love.html",
  "./Love/css/styles.css",
  "./Love/js/love.js",
  "./heartbeat/index.html",
  "./heartbeat/css/style.css",
  "./heartbeat/js/script.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Keep the 2025 chapter available if one non-essential image or subpage fails.
    await cache.addAll(["./", "./index.html", "./css/style.css", "./js/index.js"]);
    await Promise.allSettled(SHELL.map(path => cache.add(path)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("thinthin-") && k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/\.(mp3|mp4|webm|wav|ogg|mov)$/i.test(url.pathname)) return;

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const clone = fresh.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(req, clone)).catch(() => {}));
        return fresh;
      } catch (_) {
        const cached = await caches.match(req);
        return cached || caches.match("./index.html");
      }
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const clone = fresh.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(req, clone)).catch(() => {}));
      }
      return fresh;
    } catch (_) {
      const cached = await caches.match(req);
      return cached || Response.error();
    }
  })());
});
