const CACHE="always-yours-v16-unified-icon";
const ASSETS=["./","./index.html","./styles.css","./app.js","../manifest.webmanifest","../assets/favicon-32.png","../assets/icon-192.png","../assets/icon-512.png","../assets/icon-512-maskable.png","../assets/apple-touch-icon.png"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("always-yours-")&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET") return;
  const url=new URL(e.request.url);
  if(url.origin===location.origin){
    e.respondWith(fetch(e.request,{cache:"no-store"}).then(r=>{const copy=r.clone(); caches.open(CACHE).then(c=>c.put(e.request,copy)); return r;}).catch(()=>caches.match(e.request)));
  }
});
