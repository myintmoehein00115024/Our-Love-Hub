// Dedicated chat PWA worker: same unified icon, scoped to /Always-Yours-Chat/.
const CACHE="always-yours-v24-reply-gif-bubble-20261009";
const ASSETS=["./","./index.html","./styles.css","./app.js","./routes.js","./manifest.webmanifest","../assets/favicon-32.png","../assets/icon-192.png","../assets/icon-512.png","../assets/apple-touch-icon.png"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("always-yours-")&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET")return;
 const url=new URL(e.request.url);
 if(url.origin===location.origin)e.respondWith(fetch(e.request,{cache:"no-store"}).then(r=>{
   if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});}return r;
 }).catch(()=>caches.match(e.request)));
});
self.addEventListener("push",event=>{
 let data={};try{data=event.data?.json()||{};}catch{}
 event.waitUntil(self.registration.showNotification("Always Yours ♡",{
   body:"有一条来自你的那个人的新消息 💌",icon:"../assets/icon-192.png",badge:"../assets/favicon-32.png",
   tag:"always-yours-new-message",renotify:true,data:{url:new URL("./",self.registration.scope).href}
 }));
});
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 event.waitUntil((async()=>{
   const path=new URL("./",self.registration.scope).href;
   const windows=await clients.matchAll({type:"window",includeUncontrolled:true});
   const match=windows.find(w=>w.url.startsWith(path));
   if(match){await match.focus();return;}
   await clients.openWindow(path);
 })());
});
