'use strict';
// R13: Keep only short-lived readiness hints in SW RAM (no identity, keys, or message data).
const readyClients=new Map();
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
    body:'收到一条新的悄悄话 ♡',
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
