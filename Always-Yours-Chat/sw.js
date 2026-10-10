'use strict';
self.addEventListener('install',event=>{self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});
self.addEventListener('push',event=>{
 event.waitUntil((async()=>{
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const shown=clients.filter(c=>c.visibilityState==='visible'&&c.url.includes('/Always-Yours-Chat/'));
  if(shown.length){for(const client of shown){client.postMessage({type:'ay-v2-new-message'});}return;}
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
