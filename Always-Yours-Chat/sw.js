'use strict';
// R13: Keep only short-lived readiness hints in SW RAM (no identity, keys, or message data).
const readyClients=new Map();
// R12 / Phase 12: persist ONLY the selected interface language; no message metadata.
const PUSH_LOCALE_CACHE='ay-v2-push-locale-v1';
const PUSH_LOCALE_URL=new URL('./__push-language__',self.registration.scope).href;
const PUSH_LOCALES=new Set(['my','zh','en']);
const SITE_SCOPE=new URL('../',self.registration.scope).href;
let localeSnapshot=null;
let localeQueue=Promise.resolve();
async function loadLocaleSnapshot(){
 if(localeSnapshot)return localeSnapshot;
 try{
  const cache=await caches.open(PUSH_LOCALE_CACHE);
  const raw=await (await cache.match(PUSH_LOCALE_URL))?.text();
  if(PUSH_LOCALES.has(raw))return localeSnapshot={language:raw,updatedAt:0};
  if(raw){
   const parsed=JSON.parse(raw);
   if(PUSH_LOCALES.has(parsed?.language)&&Number.isSafeInteger(parsed?.updatedAt))
    return localeSnapshot={language:parsed.language,updatedAt:parsed.updatedAt};
  }
 }catch{}
 return localeSnapshot={language:'my',updatedAt:0};
}
function rememberPushLocale(language,updatedAt){
 localeQueue=localeQueue.catch(()=>{}).then(async()=>{
  const previous=await loadLocaleSnapshot();
  if(updatedAt<previous.updatedAt)return;
  const next={language,updatedAt};
  const cache=await caches.open(PUSH_LOCALE_CACHE);
  await cache.put(PUSH_LOCALE_URL,new Response(JSON.stringify(next),{
   headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
  }));
  localeSnapshot=next;
 });
 return localeQueue;
}
async function notificationLanguage(){
 await localeQueue.catch(()=>{});
 return (await loadLocaleSnapshot()).language;
}
const PUSH_BODIES=Object.freeze({
 my:'ချစ်သူဆီက စာအသစ်လေး ရောက်လာပြီ ♡',
 zh:'收到一条新的悄悄话 ♡',
 en:'You have a new private message ♡'
});
self.addEventListener('message',event=>{
 if(event.data?.type!=='ay-v2-push-language')return;
 // Allow only pages of this Our Love Hub site, not other same-origin repositories.
 const src=event.source;
 if(typeof src?.url!=='string'||!src.url.startsWith(SITE_SCOPE))return;
 const lang=event.data.language,stamp=event.data.updatedAt;
 if(!PUSH_LOCALES.has(lang)||!Number.isSafeInteger(stamp)||
    Math.abs(Date.now()-stamp)>300000)return;
 event.waitUntil(rememberPushLocale(lang,stamp).catch(()=>{}));
});

self.addEventListener('message',event=>{
 const source=event.source,data=event.data;
 if(data?.type!=='ay-v2-chat-readiness'||!source?.id||typeof source.url!=='string')return;
 if(!source.url.startsWith(self.registration.scope))return;
 if(data.ready===true)readyClients.set(source.id,Date.now());
 else readyClients.delete(source.id);
});
self.addEventListener('install',event=>{self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});
self.addEventListener('push',event=>{
 event.waitUntil((async()=>{
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const now=Date.now();
  // A focused login / device-approval screen is not an open, authorized chat.
  // Missing or stale readiness => show system notification (fail-safe).
  const shown=clients.filter(c=>c.visibilityState==='visible'&&c.focused===true&&
    c.url.startsWith(self.registration.scope)&&now-(readyClients.get(c.id)||0)<25000);
  if(shown.length){for(const client of shown){client.postMessage({type:'ay-v2-new-message'});}return;}
  // Visible-but-unfocused windows must not suppress the system notification.
  await self.registration.showNotification('Always Yours ♡',{
    body:PUSH_BODIES[await notificationLanguage()],
    icon:'../assets/icon-192.png',badge:'../assets/favicon-32.png',
    tag:'ay-v2-message',renotify:true,data:{href:'../Always-Yours-Chat/'},
    silent:false
  });
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const target=new URL('../Always-Yours-Chat/',self.registration.scope).href;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows){if(client.url.startsWith(target)&&'focus'in client){await client.focus();return;}}
  await self.clients.openWindow(target);
 })());
});
