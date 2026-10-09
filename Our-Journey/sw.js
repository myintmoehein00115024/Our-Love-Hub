// Our Journey · stable offline shell with network-first updates.
const CACHE = 'our-journey-v19-unread-count-only-20261010';
const ESSENTIAL = ['./', './index.html', './styles.css', './routes.js', './app.js'];
const OPTIONAL = ['../manifest.webmanifest','../assets/icon-192.png','../assets/icon-512.png',
  '../assets/apple-touch-icon.png','../assets/favicon-32.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ESSENTIAL);
    await Promise.allSettled(OPTIONAL.map(url => cache.add(url)));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('our-journey-') && name !== CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  // Do not intercept cross-page chat or Supabase requests.
  const url = new URL(request.url);
  if (!url.pathname.startsWith(new URL('./',self.registration.scope).pathname)) return;
  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      if (fresh.ok) {
        const copy = fresh.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(request,copy)));
      }
      return fresh;
    } catch {
      const match = await caches.match(request, {ignoreSearch:true});
      if (match) return match;
      if (request.mode === 'navigate') return await caches.match('./index.html') || Response.error();
      return Response.error();
    }
  })());
});
