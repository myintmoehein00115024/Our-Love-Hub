'use strict';
// R13: Keep only short-lived readiness hints in SW RAM (no identity, keys, or message data).
const readyClients=new Map();
// R12 / Phase 12: persist ONLY the selected interface language; no message metadata.
const PUSH_LOCALE_CACHE='ay-v2-push-locale-v1';
const PUSH_LOCALE_URL=new URL('./__push-language__',self.registration.scope).href;
const PUSH_LOCALES=new Set(['my','zh','en']);
let pushLocale=null;
async function rememberPushLocale(value){
 if(!PUSH_LOCALES.has(value))return;
 pushLocale=value;
 const cache=await caches.open(PUSH_LOCALE_CACHE);
 await cache.put(PUSH_LOCALE_URL,new Response(value,{
  headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}
 }));
}
async function notificationLanguage(){
 if(PUSH_LOCALES.has(pushLocale))return pushLocale;
 try{
  const cache=await caches.open(PUSH_LOCALE_CACHE);
  const value=await (await cache.match(PUSH_LOCALE_URL))?.text();
  if(PUSH_LOCALES.has(value))return (pushLocale=value);
 }catch{}
 return 'my'; // New installs default to Myanmar, matching site localization.
}
const PUSH_BODIES=Object.freeze({
 my:'ချစ်သူဆီက စာအသစ်လေး ရောက်လာပြီ ♡',
 zh:'收到一条新的悄悄话 ♡',
 en:'You have a new private message ♡'
});
self.addEventListener('message',event=>{
 if(event.data?.type!=='ay-v2-push-language')return;
 // Only messages from controlled same-scope windows may change this display preference.
 const src=event.source;
 if(!src?.url?.startsWith(self.registration.scope))return;
 const lang=event.data.language;
 if(!PUSH_LOCALES.has(lang))return;
 event.waitUntil(rememberPushLocale(lang).catch(()=>{}));
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
