// Our Journey: refreshed UI and removal of the unused Google Drive cabinet.
const CACHE = 'our-journey-v15-routes-separated';
const CORE = [
  './', './index.html', './styles.css', './routes.js', './app.js',
  '../manifest.webmanifest', '../assets/icon-192.png',
  '../assets/icon-512.png', '../assets/apple-touch-icon.png',
  '../assets/favicon-32.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('our-journey-') && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Network-first prevents old HTML/CSS/JS from lingering after GitHub Pages updates.
  event.respondWith(fetch(req).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(req, copy)));
    }
    return response;
  }).catch(() => caches.match(req)));
});
