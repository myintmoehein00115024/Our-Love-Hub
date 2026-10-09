const CACHE_NAME = 'pututulay-v9-responsive-20261009';
const APP_SHELL = [
  './',
  './index.html',
  './css/2026-responsive.css',
  '../assets/love-hub-family.css',
  '../assets/love-hub-family.js',
  '../assets/icon-192.png',
  '../assets/icon-512.png',
  './site.webmanifest',
  './heart-icon.png',
  './heart-icon-192.png',
  './heart-icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith("pututulay-") && key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // Keep external music/API requests online-only; cache only this site's shell.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;


  event.respondWith((async () => {
    const cached = await caches.match(request);
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone())));
      }
      return response;
    } catch (_) {
      return cached || await caches.match('./index.html') || Response.error();
    }
  })());
});
