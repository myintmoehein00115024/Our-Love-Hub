'use strict';

// Our Journey is now a story and navigation page only.
// No remote photo/video requests, uploads, edits, or deletes are made here.
const $ = id => document.getElementById(id);

function updateDaysTogether() {
  const output = $('storyDays');
  if (!output) return;
  // Use local calendar dates normalized to UTC to avoid DST transitions.
  const now = new Date();
  const day = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const start = Date.UTC(2024, 2, 23);
  const count = Math.max(0, Math.round((day - start) / 86400000));
  const language=window.OLHJourneyLanguage?.()||'my';
  const t=(key,values)=>window.OLHJourneyTranslate?.(key,values)||'';
  output.textContent = count.toLocaleString(language==='my'?'my-MM':language==='en'?'en-US':'zh-CN');
  output.setAttribute('aria-label',t('daysAria',{count})||`已经相恋 ${count} 天`);
  const next = $('nextAnniversary');
  if (next) {
    const thisYear = now.getFullYear();
    const anniversaryThisYear = Date.UTC(thisYear, 2, 23);
    const nextYear = day > anniversaryThisYear ? thisYear + 1 : thisYear;
    const daysRemaining = Math.round((Date.UTC(nextYear, 2, 23) - day) / 86400000);
    next.textContent = daysRemaining === 0
      ? (t('annivNow')||'今天是我们的相恋纪念日 ♡')
      : (t('annivFuture',{count:daysRemaining})||`下一次 3 月 23 日纪念日，还有 ${daysRemaining} 天 ♡`);
  }
}
updateDaysTogether();
window.addEventListener('pageshow', updateDaysTogether);
document.addEventListener('olh:languagechange', updateDaysTogether);
window.setInterval(updateDaysTogether, 60 * 1000);

const backToTop = $('backTop');
function refreshBackToTop() {
  if (backToTop) backToTop.classList.toggle('visible', window.scrollY > 420);
}
window.addEventListener('scroll', refreshBackToTop, {passive:true});
refreshBackToTop();
backToTop?.addEventListener('click', () => window.scrollTo({top:0, behavior:'smooth'}));

// The root index uses this tab-scoped flag for its anniversary gate.
// This button locks the landing page again; this client-only gate is not access control.
$('lockJourney')?.addEventListener('click', () => {
  try { sessionStorage.removeItem('our_love_hub_unlocked_at'); } catch (_) {}
  window.location.assign(window.OurLoveRoutes?.hub || new URL('../', window.location.href).href);
});

// Install one root-scoped PWA. Show guidance here instead of redirecting the
// unlocked root gate straight back to Journey (which looked like a refresh).
const installButton = $('installOpen');
const installDialog = $('olhInstallDialog');
const INSTALL_COPY = {
 zh: {
   title:'将 Our Love Hub 添加到桌面 ♡',intro:'为了只有一个 Our Love Hub 图标，请从总首页安装。点击这个按钮不会自动安装，也不会刷新聊天页面。',
   android:'Android · 在 Chrome 中打开总首页，点右上角 ⋮ →「安装应用」或「添加到主屏幕」。',
   ios:'iPhone / iPad · 在 Safari 中打开总首页，点分享 →「添加到主屏幕」。',
   desktop:'电脑 · 在 Chrome 或 Edge 中打开总首页，点击地址栏安装图标；没有图标时查看浏览器菜单。',
   note:'已安装或已在主屏幕打开？不需要再次安装。不要从 2025、2026 子页面另外创建图标。',
   go:'前往总首页安装 ↗',close:'关闭',open:'添加 Our Love Hub 到桌面'
 },
 en: {
   title:'Add Our Love Hub to Home Screen ♡',intro:'Keep just one Our Love Hub icon. Install from the main home page; this button opens instructions rather than reloading the page.',
   android:'Android · Open the main home page in Chrome, tap ⋮ → “Install app” or “Add to Home screen”.',
   ios:'iPhone / iPad · Open the main home page in Safari, tap Share → “Add to Home Screen”.',
   desktop:'Desktop · Open the main home page in Chrome or Edge, then use the install icon in the address bar or the browser menu.',
   note:'Already installed? You do not need another icon. Avoid installing the 2025 and 2026 pages separately.',
   go:'Open home page to install ↗',close:'Close',open:'Add Our Love Hub to Home Screen'
 },
 my: {
   title:'Our Love Hub ကို ပင်မမျက်နှာပြင်မှာ ထည့်မယ် ♡',
   intro:'Our Love Hub အိုင်ကွန်တစ်ခုတည်း ရှိစေဖို့ ပင်မစာမျက်နှာကနေ ထည့်သွင်းပါနော်။ ဒီခလုတ်ကို နှိပ်ရုံနဲ့ စာမျက်နှာ ပြန်မဖွင့်ပါဘူး။',
   android:'Android · Chrome မှာ ပင်မစာမျက်နှာကို ဖွင့်ပြီး ⋮ → “Install app” သို့မဟုတ် “Add to Home screen” ကို ရွေးပါ။',
   ios:'iPhone / iPad · Safari မှာ ပင်မစာမျက်နှာကို ဖွင့်ပြီး Share → “Add to Home Screen” ကို ရွေးပါ။',
   desktop:'ကွန်ပျူတာ · Chrome သို့မဟုတ် Edge မှာ ပင်မစာမျက်နှာကို ဖွင့်ပြီး လိပ်စာတန်းက Install အိုင်ကွန် သို့မဟုတ် browser menu ကို သုံးပါ။',
   note:'ထည့်သွင်းပြီးသားဆိုရင် ထပ်မံထည့်စရာ မလိုပါဘူး။ ၂၀၂၅၊ ၂၀၂၆ စာမျက်နှာတွေကနေ အိုင်ကွန်အသစ် မထည့်ပါနဲ့နော်။',
   go:'ပင်မစာမျက်နှာသို့ သွားမယ် ↗',close:'ပိတ်ရန်',open:'Our Love Hub ကို ဖုန်းမျက်နှာပြင်သို့ ထည့်ရန်'
 }
};
function updateInstallLanguage(){
 const lang=window.OLHJourneyLanguage?.()||'my',t=INSTALL_COPY[lang]||INSTALL_COPY.my;
 for(const key of ['title','intro','android','ios','desktop','note','go','close']){
  const target=installDialog?.querySelector(`[data-install-text="${key}"]`);
  if(target)target.textContent=t[key];
 }
 installDialog?.setAttribute('lang',lang==='zh'?'zh-CN':lang);
 installButton?.setAttribute('aria-label',t.open);
 const go=installDialog?.querySelector('#olhInstallGo');
 // Bypass automatic redirect at the unlocked root ONLY for intentional install guidance.
 if(go){const home=window.OurLoveRoutes?.hub||new URL('../',document.baseURI).href;
  const u=new URL(home);u.searchParams.set('install','1');go.href=u.href;}
}
if(installDialog && installButton){
 installButton.addEventListener('click',()=>{
  updateInstallLanguage();
  installDialog.showModal();
  document.body.classList.add('dialog-open');
 });
 installDialog.addEventListener('close',()=>{
  document.body.classList.remove('dialog-open');
  installButton.focus({preventScroll:true});
 });
 installDialog.addEventListener('click',e=>{
  if(e.target===installDialog)installDialog.close();
 });
 document.addEventListener('olh:languagechange',updateInstallLanguage);
 updateInstallLanguage();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', {scope:'./'}).catch(() => {});
  });
}


// Secure Chat V2 unread indicator. Reuses this origin's approved non-exportable signing key.
// Never stores the session bearer, signing key, messages or shared secrets in localStorage.
(() => {
 const bell=document.getElementById('chatBell'),counter=document.getElementById('chatBellCount');
 if(!bell||!counter||!('indexedDB' in window))return;
 const API='https://zegjegutcigbydtzggur.supabase.co/functions/v1/always-yours-secure-v2';
 const AUTH='https://zegjegutcigbydtzggur.supabase.co/functions/v1/always-yours-chat';
 const te=new TextEncoder();let active=false,prev=null,session=null,expires=0,identity=null,who=null;
 let audio=null,audioUnlocked=false;
 function b64(v){let s='';for(const x of new Uint8Array(v))s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
 const sha=async v=>b64(await crypto.subtle.digest('SHA-256',te.encode(v)));
 const tr=(key,values)=>window.OLHJourneyTranslate?.(key,values)||key;
 function clearUnread(messageKey='unreadVerify'){prev=null;counter.hidden=true;counter.textContent='0';bell.classList.remove('has-unread');bell.setAttribute('aria-label',tr(messageKey));document.title=tr('pageTitle');}
 function note(){if(!audioUnlocked||!audio||audio.state!=='running'||document.hidden)return;
  const t=audio.currentTime;for(const [delay,f] of [[0,700],[.14,860]]){
   const o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.value=f;
   g.gain.setValueAtTime(.0001,t+delay);g.gain.exponentialRampToValueAtTime(.035,t+delay+.02);
   g.gain.exponentialRampToValueAtTime(.0001,t+delay+.18);o.connect(g);g.connect(audio.destination);o.start(t+delay);o.stop(t+delay+.2);
  }
 }
 function audioStart(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;
  audio ||= new C();if(audio.state==='suspended')audio.resume().catch(()=>{});
  audioUnlocked=true;
 }catch{}}
 document.addEventListener('pointerdown',audioStart,{once:true});document.addEventListener('keydown',audioStart,{once:true});
 function openDb(){return new Promise((resolve,reject)=>{
   const r=indexedDB.open('always-yours-identity-keys-v1');
   r.onupgradeneeded=()=>{r.transaction.abort();reject(Error('No device key store'));};
   r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
 });}
 async function getIdentity(role){
  if(identity&&who===role)return identity;
  const db=await openDb();try{
   if(!db.objectStoreNames.contains('keys'))return null;
   const keys=await new Promise((resolve,reject)=>{const rq=db.transaction('keys').objectStore('keys').getAllKeys();rq.onsuccess=()=>resolve(rq.result);rq.onerror=()=>reject(rq.error);});
   let slot='v2:'+role;
   if(!keys.includes(slot)){
    const matching=keys.filter(k=>typeof k==='string'&&k.endsWith(':'+role));
    if(matching.length!==1)return null;slot=matching[0];
   }
   const saved=await new Promise((resolve,reject)=>{const rq=db.transaction('keys').objectStore('keys').get(slot);rq.onsuccess=()=>resolve(rq.result);rq.onerror=()=>reject(rq.error);});
   if(!saved?.pair?.privateKey||!saved?.pair?.publicKey)return null;
   const pub=await crypto.subtle.exportKey('jwk',saved.pair.publicKey);
   const fp=await sha('AY-DEVICE-FP-V1|'+pub.x+'|'+pub.y);
   identity={fp,key:saved.pair.privateKey};who=role;return identity;
  }finally{db.close();}
 }
 async function post(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify(body)});
  const j=await r.json();if(!r.ok)throw Error(j.error||'Unauthorized');return j;}
 async function login(role,id){if(session&&expires>Date.now()+30000)return session;
  const c=await post(AUTH+'/api/v2/device/challenge',{user_name:role,fingerprint:id.fp});
  const payload=['AY-V2-DEVICE-CHALLENGE',role,c.challengeId,c.challenge].join('\n');
  const signature=b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},id.key,te.encode(payload)));
  const s=await post(AUTH+'/api/v2/device/verify',{user_name:role,challengeId:c.challengeId,signature});
  if(!s.deviceVerified||!s.accessToken)throw Error('Not authorized');
  session=s.accessToken;expires=Date.now()+Math.min(600,Number(s.expiresInSeconds)||600)*1000;return session;
 }
 async function unread(role,id){const token=await login(role,id),path='/unread',time=String(Date.now());
  const nonce=b64(crypto.getRandomValues(new Uint8Array(16)));
  const canonical=['AY-SECURE-V2-REQUEST',role,id.fp,await sha('AY-DEVICE-SESSION-V1|'+token),'GET',path,time,nonce,await sha('')].join('\n');
  const proof=b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},id.key,te.encode(canonical)));
  const r=await fetch(API+path,{headers:{Authorization:'Bearer '+token,'X-Device-Time':time,'X-Device-Nonce':nonce,'X-Device-Proof':proof},cache:'no-store'});
  if(!r.ok){if(r.status===401)session=null;throw Error('Unread authorization failed');}
  const value=await r.json();if(!Number.isInteger(value.unread)||value.unread<0)throw Error('Invalid unread count');return value.unread;
 }
 async function update(){if(active||document.hidden)return;if(!navigator.onLine){clearUnread('unreadOffline');return;}active=true;
  try{const role=localStorage.getItem('ay-secure-role-v1');if(role!=='Ko Ko'&&role!=='Chit Chit'){clearUnread();session=null;identity=null;return;}
   const id=await getIdentity(role);if(!id){clearUnread();session=null;return;}
   const n=await unread(role,id);
   // The user may have switched identities while the signed request was in flight.
   if(document.hidden||localStorage.getItem('ay-secure-role-v1')!==role)return;
   if(prev!==null&&n>prev)note();prev=n;counter.hidden=n===0;counter.textContent=n>99?'99+':String(n);
   bell.classList.toggle('has-unread',n>0);
   bell.setAttribute('aria-label',n?tr('unreadCount',{count:n}):tr('unreadEmpty'));
   document.title=n?tr('pageTitleUnread',{count:n>99?'99+':n}):tr('pageTitle');
  }catch(e){
   // Fail closed: do not display a cached unread count when authorization or connectivity cannot be verified.
   session=null;expires=0;clearUnread('unreadFailed');
  }finally{active=false;}
 }
 document.addEventListener('olh:languagechange',()=>{
  bell.setAttribute('aria-label',prev===null?tr('unreadVerify'):prev>0?tr('unreadCount',{count:prev}):tr('unreadEmpty'));
  document.title=prev>0?tr('pageTitleUnread',{count:prev>99?'99+':prev}):tr('pageTitle');
 });
 const channel='BroadcastChannel' in window?new BroadcastChannel('ay-v2-chat'):null;
 if(channel)channel.onmessage=()=>update();
 window.setInterval(update,6000);window.addEventListener('offline',()=>clearUnread('unreadOffline'));window.addEventListener('online',update);document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
 window.addEventListener('pageshow',update);window.addEventListener('storage',e=>{if(e.key==='ay-secure-role-v1'){identity=null;session=null;prev=null;update();}});
 update();
})();
