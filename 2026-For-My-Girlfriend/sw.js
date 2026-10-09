// 2026 chapter — scoped cache; never handles Chat push or Supabase data.
const CACHE_NAME='pututulay-v11-pwa-audit-20261009';
const CORE=['./','./index.html'];
const OPTIONAL=[
  './css/2026-responsive.css','../assets/love-hub-family.css',
  '../assets/love-hub-family.js','../assets/icon-192.png',
  '../assets/icon-512.png','../manifest.webmanifest',
  './site.webmanifest','./heart-icon.png','./heart-icon-192.png','./heart-icon-512.png'
];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE_NAME);
  await cache.addAll(CORE);
  await Promise.allSettled(OPTIONAL.map(p=>cache.add(p)));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(n=>n.startsWith('pututulay-')&&n!==CACHE_NAME).map(n=>caches.delete(n)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url), scope=new URL(self.registration.scope);
  if(url.origin!==scope.origin || !url.pathname.startsWith(scope.pathname))return;
  if(/\.(mp3|mp4|m4a|wav|ogg|mov|webm)$/i.test(url.pathname))return;
  event.respondWith((async()=>{
    try{
      const fresh=await fetch(req);
      if(fresh.ok){
        const copy=fresh.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(c=>c.put(req,copy)).catch(()=>{}));
      }
      return fresh;
    }catch{
      const cached=await caches.match(req,{ignoreSearch:true});
      if(cached)return cached;
      if(req.mode==='navigate')return (await caches.match('./index.html'))||Response.error();
      return Response.error(); // Never send HTML in place of a missing image or JS.
    }
  })());
});
