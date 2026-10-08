// The hub controls only its own shell; module-specific workers keep their own caches.
const CACHE_NAME = 'our-love-hub-shell-v2-direct-journey-20240323';
const SHELL = ['./', './index.html', './manifest.webmanifest', './assets/icon-192.png', './assets/icon-512.png', './assets/apple-touch-icon.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('our-love-hub-shell-') && k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const base = new URL(self.registration.scope).pathname;
  if (req.mode === 'navigate' && (url.pathname === base || url.pathname === base + 'index.html')) {
    event.respondWith(fetch(req).then(response => {
      if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(req,copy));}
      return response;
    }).catch(()=>caches.match(req).then(r=>r||caches.match('./index.html'))));
  }
});
