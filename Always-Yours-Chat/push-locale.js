/* Our Love Hub — chat push language only. No chat text, credentials or keys. */
(()=>{'use strict';
  const valid=new Set(['my','zh','en']);
  const current=()=>{
    try{const value=localStorage.getItem('olh_language');return valid.has(value)?value:'my';}
    catch{return 'my';}
  };
  let lastStamp=0;
  function send(){
    if(!('serviceWorker' in navigator))return;
    lastStamp=Math.max(Date.now(),lastStamp+1);
    const data={type:'ay-v2-push-language',language:current(),updatedAt:lastStamp};
    // The controller may be absent right after installation; the active worker
    // will still receive the language update.
    try{navigator.serviceWorker.controller?.postMessage(data);}catch{}
    navigator.serviceWorker.ready.then(reg=>{
      try{reg.active?.postMessage(data);}catch{}
    }).catch(()=>{});
  }
  window.addEventListener('storage',event=>{
    if(event.key==='olh_language')send();
  });
  document.addEventListener('change',event=>{
    if(event.target?.matches?.('.olh-language-picker select')){
      // The existing localization handler writes localStorage in the same event.
      queueMicrotask(send);
    }
  });
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)send();
  });
  navigator.serviceWorker?.addEventListener('controllerchange',send);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',send,{once:true});
  else send();
})();
