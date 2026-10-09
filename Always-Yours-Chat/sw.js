// Dedicated chat PWA worker: same unified icon, scoped to /Always-Yours-Chat/.
const CACHE="always-yours-v28-back-clean-20261009";
const ASSETS=["./","./index.html","./styles.css","./app.js","./routes.js","./manifest.webmanifest","../assets/favicon-32.png","../assets/icon-192.png","../assets/icon-512.png","../assets/apple-touch-icon.png", "./romantic-gifs/pulse-love.gif", "./romantic-gifs/hugs.gif", "./romantic-gifs/miss-you.gif", "./romantic-gifs/good-night.gif", "./romantic-gifs/kiss.gif", "./romantic-gifs/forever.gif"];
self.addEventListener("install",e=>e.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 // Optional images must not prevent activation of the worker responsible for push.
 await Promise.allSettled(ASSETS.map(asset=>cache.add(asset)));
 await self.skipWaiting();
})()));
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
 event.waitUntil((async()=>{
   try{await storePushReceipt(Date.now());}catch{}
   await self.registration.showNotification("Always Yours ♡",{
   body:"有一条来自你的那个人的新消息 💌",icon:"../assets/icon-192.png",badge:"../assets/favicon-32.png",
   tag:"always-yours-new-message",renotify:true,vibrate:[120,70,120],
   data:{url:new URL("./",self.registration.scope).href}
   });
 })());
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


// Background subscription recovery. Store the derived room identifier and selected role,
// NEVER the encryption passphrase or AES key. The profile is saved only after opt-in.
const PUSH_DB='always-yours-sw-push-v1';
function pushProfileDb(){
 return new Promise((resolve,reject)=>{
   const req=indexedDB.open(PUSH_DB,2);
   req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('profiles'))req.result.createObjectStore('profiles');if(!req.result.objectStoreNames.contains('stats'))req.result.createObjectStore('stats');};
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(req.error);
 });
}
async function storedPushProfile(value){
 const db=await pushProfileDb();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('profiles',value?'readwrite':'readonly');
  const request=value?tx.objectStore('profiles').put(value,'current'):tx.objectStore('profiles').get('current');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
  tx.oncomplete=()=>db.close();
 });
}
self.addEventListener('message',event=>{
 const data=event.data;
 if(data?.type!=='always-yours-push-profile')return;
 try{
  const url=new URL(data.apiBase);
  if(!/^[a-f0-9]{40}$/.test(data.roomId)||!['Ko Ko','Chit Chit'].includes(data.role)
   ||!/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/always-yours-chat$/.test(url.href)
   ||!/^[-_a-zA-Z0-9]{80,100}$/.test(data.publicKey))return;
  event.waitUntil(storedPushProfile({room:data.roomId,role:data.role,api:url.href,publicKey:data.publicKey}).catch(()=>{}));
 }catch{}
});
function decodePushKey(key){
 const padded=key.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-key.length%4)%4);
 return Uint8Array.from(atob(padded),c=>c.charCodeAt(0));
}
self.addEventListener('pushsubscriptionchange',event=>{
 event.waitUntil((async()=>{
  try{
   const profile=await storedPushProfile();
   if(!profile)return;
   const existing=await self.registration.pushManager.getSubscription();
   const sub=existing||await self.registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodePushKey(profile.publicKey)});
   const result=await fetch(profile.api+'/api/push/subscribe',{
    method:'POST',headers:{'Content-Type':'application/json','X-Room-Key':profile.room,'X-User':profile.role},
    body:JSON.stringify({subscription:sub.toJSON()}),cache:'no-store'
   });
   if(!result.ok)throw new Error('Push refresh rejected: '+result.status);
  }catch(err){console.warn('Push subscription requires renewal on next visit:',String(err).slice(0,160));}
 })());
});

async function storePushReceipt(at){
 const db=await pushProfileDb();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('stats','readwrite');
  const req=tx.objectStore('stats').put(at,'last-received');
  req.onsuccess=()=>resolve(true);
  req.onerror=()=>reject(req.error);
  tx.oncomplete=()=>db.close();
 });
}
async function getPushReceipt(){
 const db=await pushProfileDb();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('stats','readonly');
  const req=tx.objectStore('stats').get('last-received');
  req.onsuccess=()=>resolve(req.result||null);
  req.onerror=()=>reject(req.error);
  tx.oncomplete=()=>db.close();
 });
}
self.addEventListener('message',event=>{
 if(event.data?.type!=='always-yours-push-last-received')return;
 event.waitUntil(getPushReceipt().then(at=>{
  event.source?.postMessage({type:'always-yours-push-receipt',at});
 }).catch(()=>{}));
});
