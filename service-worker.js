// Our Love Hub: root landing / anniversary login only.
// Each subsite keeps its own scoped Service Worker, especially Chat (Web Push).
const CACHE_NAME='our-love-hub-shell-v4-i18n-offline-20261011';
const CORE=['./','./index.html'];
const OPTIONAL=['./manifest.webmanifest','./assets/icon-192.png','./assets/icon-512.png','./assets/apple-touch-icon.png','./i18n-home.js?v=20261011-p3'];
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
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  const base=new URL(self.registration.scope);
  const isRootPage=req.mode==='navigate'&&[base.pathname,base.pathname+'index.html'].includes(url.pathname);
  const isLanguageScript=url.pathname===base.pathname+'i18n-home.js';
  if(url.origin!==base.origin || (!isRootPage&&!isLanguageScript))return;
  event.respondWith((async()=>{
    try{
      const response=await fetch(req);
      if(response.ok){
        const clone=response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(isRootPage?'./index.html':'./i18n-home.js?v=20261011-p3',clone)).catch(()=>{}));
      }
      return response;
    }catch{
      return (await caches.match(isRootPage?'./index.html':'./i18n-home.js?v=20261011-p3'))||Response.error();
    }
  })());
});
