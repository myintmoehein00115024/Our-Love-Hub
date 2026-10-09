// Our Love Hub: root landing / anniversary login only.
// Each subsite keeps its own scoped Service Worker, especially Chat (Web Push).
const CACHE_NAME='our-love-hub-shell-v3-pwa-audit-20261009';
const CORE=['./','./index.html'];
const OPTIONAL=['./manifest.webmanifest','./assets/icon-192.png','./assets/icon-512.png','./assets/apple-touch-icon.png'];
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await cache.addAll(CORE);
    await Promise.allSettled(OPTIONAL.map(path=>cache.add(path)));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(n=>n.startsWith('our-love-hub-shell-')&&n!==CACHE_NAME).map(n=>caches.delete(n)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET'||req.mode!=='navigate')return;
  const url=new URL(req.url);
  const base=new URL(self.registration.scope);
  if(url.origin!==base.origin || ![base.pathname,base.pathname+'index.html'].includes(url.pathname))return;
  event.respondWith((async()=>{
    try{
      const response=await fetch(req);
      if(response.ok){
        const clone=response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put('./index.html',clone)).catch(()=>{}));
      }
      return response;
    }catch{
      return (await caches.match('./index.html'))||Response.error();
    }
  })());
});
