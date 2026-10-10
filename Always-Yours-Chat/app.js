'use strict';
// Official secure v2 private chat, cryptographic authentication enforced server-side. Keeps all identity + encryption private keys in origin-local IndexedDB.
const AUTH_BASE='https://zegjegutcigbydtzggur.supabase.co/functions/v1/always-yours-chat';
const API_BASE='https://zegjegutcigbydtzggur.supabase.co/functions/v1/always-yours-secure-v2';
const AUTH_DB='always-yours-identity-keys-v1',ENC_DB='always-yours-secure-encryption-v1';
const $=id=>document.getElementById(id),te=new TextEncoder(),td=new TextDecoder();
const state={role:null,identity:null,fp:null,session:null,expires:0,encryption:null,keys:[],busy:false,timer:null};
let lastApprovalFocus=null;
const validB64=/^[A-Za-z0-9_-]+$/;
function b64(bytes){const v=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);let s='';for(const c of v)s+=String.fromCharCode(c);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function un64(s){if(!validB64.test(s))throw new Error('无效的加密编码');return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));}
async function digest(value){return b64(await crypto.subtle.digest('SHA-256',typeof value==='string'?te.encode(value):value));}
function status(text){(state.role?$('chatStatus'):$('gateStatus')).textContent=text;}
function dbOpen(name,version,upgrader){return new Promise((resolve,reject)=>{const r=indexedDB.open(name,version);r.onupgradeneeded=()=>upgrader?.(r.result);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function txReq(db,store,mode,callback){return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);const rq=callback(tx.objectStore(store));rq.onsuccess=()=>resolve(rq.result);rq.onerror=()=>reject(rq.error);tx.oncomplete=()=>db.close();});}
async function findSigningIdentity(role){
 // New devices may register without knowing the old chat encryption password.
 // Prefer an existing v2 identity; otherwise reuse exactly one legacy authorized key.
 const db=await dbOpen(AUTH_DB,1,d=>{if(!d.objectStoreNames.contains('keys'))d.createObjectStore('keys');});
 const entries=await txReq(db,'keys','readonly',store=>store.getAllKeys());
 const all=entries||[];
 let slot='v2:'+role;
 if(!all.includes(slot)){
  const old=all.filter(k=>typeof k==='string'&&k.endsWith(':'+role)&&k!==slot);
  if(old.length===1)slot=old[0];
  else if(old.length>1)throw new Error('检测到多把旧设备私钥，请先在原 Chat 确认要使用的设备');
  else{
   const newPair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
   const d=await dbOpen(AUTH_DB,1);await txReq(d,'keys','readwrite',store=>store.put({pair:newPair},slot));
  }
 }
 const d=await dbOpen(AUTH_DB,1);const stored=await txReq(d,'keys','readonly',store=>store.get(slot));
 if(!stored?.pair?.privateKey||!stored?.pair?.publicKey||stored.pair.privateKey.extractable)throw new Error('本机签名私钥不存在或不安全');
 const pub=await crypto.subtle.exportKey('jwk',stored.pair.publicKey);
 const fp=await digest('AY-DEVICE-FP-V1|'+pub.x+'|'+pub.y);
 return {pair:stored.pair,fp,pub};
}
async function checkOrApplyDevice(identity,apply=false){
 const role=state.role;
 const nonce=b64(crypto.getRandomValues(new Uint8Array(16)));
 const signature=b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},identity.pair.privateKey,
     te.encode(['AY-DEVICE-ENROLL-V2',role,nonce].join('\n'))));
 const x=await jsonFetch(API_BASE+(apply?'/enroll':'/enroll/status'),{user_name:role,publicKey:{kty:'EC',crv:'P-256',x:identity.pub.x,y:identity.pub.y},nonce,signature});
 if(x.fingerprint!==identity.fp)throw new Error('设备指纹校验失败');
 return x.deviceState;
}
async function jsonFetch(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify(body)});const x=await r.json().catch(()=>({}));if(!r.ok)throw new Error(x.error||'服务器暂时无法连接');return x;}
async function login(force=false){
 if(!state.role||!state.identity)throw new Error('先选择已授权身份');
 if(!force&&state.session&&state.expires-Date.now()>60000)return;
 status('正在验证您已获授权的设备签名…');
 const role=state.role,fp=state.fp;
 const c=await jsonFetch(AUTH_BASE+'/api/v2/device/challenge',{user_name:role,fingerprint:fp});
 if(!/^[a-f0-9-]{36}$/.test(c.challengeId||'')||!/^[A-Za-z0-9_-]{43}$/.test(c.challenge||''))throw new Error('挑战响应不正确');
 const payload=te.encode(['AY-V2-DEVICE-CHALLENGE',role,c.challengeId,c.challenge].join('\n'));
 const proof=b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},state.identity.privateKey,payload));
 const x=await jsonFetch(AUTH_BASE+'/api/v2/device/verify',{user_name:role,challengeId:c.challengeId,signature:proof});
 if(!x.deviceVerified||!x.accessToken||x.fingerprint!==fp)throw new Error('服务器未批准当前设备');
 state.session=x.accessToken;state.expires=Date.now()+Math.min(600,Number(x.expiresInSeconds)||600)*1000;
}
async function request(path,method='GET',payload=null){
 await login();
 const url=API_BASE+path,body=payload===null?'':JSON.stringify(payload);
 const time=String(Date.now()),nonce=b64(crypto.getRandomValues(new Uint8Array(16)));
 const sessionHash=await digest('AY-DEVICE-SESSION-V1|'+state.session);
 const contentHash=await digest(body);
 const pathname=path; // Server authenticates function-relative route, never proxy-specific URL.
 const canonical=['AY-SECURE-V2-REQUEST',state.role,state.fp,sessionHash,method,pathname,time,nonce,contentHash];
 const signature=b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},state.identity.privateKey,te.encode(canonical.join('\n'))));
 const r=await fetch(url,{method,cache:'no-store',headers:{'Authorization':'Bearer '+state.session,'X-Device-Time':time,'X-Device-Nonce':nonce,'X-Device-Proof':signature,...(method==='GET'?{}:{'Content-Type':'application/json'})},...(method==='GET'?{}:{body})});
 const x=await r.json().catch(()=>({}));
 if(!r.ok){if(r.status===401){state.session=null;state.expires=0;}throw new Error(x.error||'安全请求失败');}
 return x;
}
async function encryptionPair(){
 const db=await dbOpen(ENC_DB,1,d=>{if(!d.objectStoreNames.contains('keys'))d.createObjectStore('keys');});
 const key=state.role+':'+state.fp;
 let pair=await txReq(db,'keys','readonly',store=>store.get(key));
 if(!pair){pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);const d=await dbOpen(ENC_DB,1);await txReq(d,'keys','readwrite',store=>store.put(pair,key));}
 if(pair.privateKey.extractable)throw new Error('加密私钥必须不可导出');
 return pair;
}
async function setupEncryption(){
 state.encryption=await encryptionPair();
 const p=await crypto.subtle.exportKey('jwk',state.encryption.publicKey);
 await request('/keys','POST',{publicKey:{kty:'EC',crv:'P-256',x:p.x,y:p.y}});
 await loadKeys();
}
async function loadKeys(){const x=await request('/keys');state.keys=x.keys||[];return state.keys;}
async function deriveWrap(privateKey,publicKey,id,fp){
 const bits=await crypto.subtle.deriveBits({name:'ECDH',public:publicKey},privateKey,256);
 const hk=await crypto.subtle.importKey('raw',bits,'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:te.encode('AY-SAFE-V2'),info:te.encode(id+'|'+fp)},hk,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function encryptMessage(text){
 const keys=await loadKeys();
 if(!keys.some(k=>k.user_name==='Ko Ko')||!keys.some(k=>k.user_name==='Chit Chit'))throw new Error('请先让 HE 和 SHE 两边的已批准设备各进入本测试页面一次，以登记加密公钥。');
 const id=crypto.randomUUID(),contentKeyBytes=crypto.getRandomValues(new Uint8Array(32));
 const contentKey=await crypto.subtle.importKey('raw',contentKeyBytes,'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12)),data=te.encode(text);
 const ciphertext=b64(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:te.encode('AY-SAFE-TEXT-V1\n'+id)},contentKey,data));
 const ephemeral=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const publicKey=await crypto.subtle.exportKey('jwk',ephemeral.publicKey),envelopes={};
 for(const rec of keys){
  const pk=await crypto.subtle.importKey('jwk',rec.enc_public_key,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const wrap=await deriveWrap(ephemeral.privateKey,pk,id,rec.fingerprint);
  const wiv=crypto.getRandomValues(new Uint8Array(12));
  const wct=await crypto.subtle.encrypt({name:'AES-GCM',iv:wiv,additionalData:te.encode('AY-WRAP|'+id+'|'+rec.fingerprint)},wrap,contentKeyBytes);
  envelopes[rec.fingerprint]={iv:b64(wiv),ciphertext:b64(wct)};
 }
 return {id,iv:b64(iv),ciphertext,ephemeralPublicKey:{kty:'EC',crv:'P-256',x:publicKey.x,y:publicKey.y},envelopes};
}
async function decryptMessage(m){
 const env=m.envelopes?.[state.fp];if(!env)throw new Error('无本机密钥');
 const ephemeral=await crypto.subtle.importKey('jwk',env.ephemeralPublicKey||m.ephemeral_public_key,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const wrapping=await deriveWrap(state.encryption.privateKey,ephemeral,m.id,state.fp);
 const rawKey=await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(env.iv),additionalData:te.encode('AY-WRAP|'+m.id+'|'+state.fp)},wrapping,un64(env.ciphertext));
 const key=await crypto.subtle.importKey('raw',rawKey,'AES-GCM',false,['decrypt']);
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(m.iv),additionalData:te.encode('AY-SAFE-TEXT-V1\n'+m.id)},key,un64(m.ciphertext));
 return td.decode(plain);
}
async function shareVisibleHistory(){
 if(!state.role||!state.encryption)throw new Error('请先用已授权设备进入聊天');
 const keys=await loadKeys(),data=await request('/messages');
 let shared=0,missing=0;
 for(const m of data.messages||[]){
  const absent=keys.filter(k=>!m.envelopes?.[k.fingerprint]);
  if(!absent.length)continue;
  const ownEnv=m.envelopes?.[state.fp];if(!ownEnv)continue;
  const sourcePub=await crypto.subtle.importKey('jwk',ownEnv.ephemeralPublicKey||m.ephemeral_public_key,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const oldWrap=await deriveWrap(state.encryption.privateKey,sourcePub,m.id,state.fp);
  const contentBytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(ownEnv.iv),additionalData:te.encode('AY-WRAP|'+m.id+'|'+state.fp)},oldWrap,un64(ownEnv.ciphertext)));
  for(const k of absent){
   const fresh=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
   const p=await crypto.subtle.exportKey('jwk',fresh.publicKey);
   const pub=await crypto.subtle.importKey('jwk',k.enc_public_key,{name:'ECDH',namedCurve:'P-256'},false,[]);
   const wrap=await deriveWrap(fresh.privateKey,pub,m.id,k.fingerprint),iv=crypto.getRandomValues(new Uint8Array(12));
   const sealed=b64(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:te.encode('AY-WRAP|'+m.id+'|'+k.fingerprint)},wrap,contentBytes));
   await request('/messages/grant','POST',{id:m.id,fingerprint:k.fingerprint,envelope:{iv:b64(iv),ciphertext:sealed,ephemeralPublicKey:{kty:'EC',crv:'P-256',x:p.x,y:p.y}}});
   shared++;
  }
  missing++;
 }
 return {shared,messages:missing};
}
let lastPaint='',refreshBusy=false,haveSnapshot=false,seenMessages=new Set();
let notificationAudio=null;
function playHeartNote(){
 try{
   if(!localStorage.getItem('ay-v2-sound'))return;
   const C=window.AudioContext||window.webkitAudioContext;if(!C)return;
   if(!notificationAudio)notificationAudio=new C();
   if(notificationAudio.state!=='running')return;
   const t=notificationAudio.currentTime;
   for(const [delay,freq] of [[0,659.25],[0.13,783.99]]){
     const o=notificationAudio.createOscillator(),g=notificationAudio.createGain();
     o.type='sine';o.frequency.value=freq;g.gain.setValueAtTime(0.0001,t+delay);
     g.gain.exponentialRampToValueAtTime(0.06,t+delay+0.015);
     g.gain.exponentialRampToValueAtTime(0.0001,t+delay+0.17);
     o.connect(g).connect(notificationAudio.destination);o.start(t+delay);o.stop(t+delay+0.2);
   }
   if(navigator.vibrate)navigator.vibrate([70,45,70]);
 }catch{}
}
async function enablePush(){
 if(!state.role)throw new Error('请先进入已授权的聊天');
 if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))throw new Error('当前浏览器不支持后台通知');
 if(notificationAudio===null){const C=window.AudioContext||window.webkitAudioContext;if(C)notificationAudio=new C();}
 if(notificationAudio?.state==='suspended')await notificationAudio.resume();
 localStorage.setItem('ay-v2-sound','1');
 const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
 if(permission!=='granted')throw new Error('尚未获得系统通知权限。iPhone/iPad 请从 Safari「添加到主屏幕」，从主屏幕打开后再开启。');
 const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
 await navigator.serviceWorker.ready;
 const cfg=await request('/push/config');
 if(!cfg.configured||!cfg.publicKey)throw new Error('服务器推送配置尚未就绪');
 const sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:un64(cfg.publicKey)});
 await request('/push/subscribe','POST',{subscription:sub.toJSON()});
 $('notify').textContent='🔔 已开启';
 status('手机通知已订阅 · 页面内轻柔提示音已开启');
}

async function refresh(){
 if(!state.role||refreshBusy||document.hidden)return;refreshBusy=true;
 try{
  const data=await request('/messages');
  const signature=JSON.stringify((data.messages||[]).map(m=>m.id));
  if(signature===lastPaint)return;
  const incoming=(data.messages||[]).filter(m=>m.sender!==state.role&&haveSnapshot&&!seenMessages.has(m.id));
  for(const m of data.messages||[])seenMessages.add(m.id);
  if(incoming.length&&document.visibilityState==='visible')playHeartNote();
  haveSnapshot=true;
  const elements=[];
  for(const m of data.messages||[]){
   const b=document.createElement('div');b.className='bubble'+(m.sender===state.role?' own':'');
   const content=document.createElement('div');content.className='msg';
   try{content.textContent=await decryptMessage(m);}catch{content.textContent='[此设备无法解密的消息]';}
   const meta=document.createElement('div');meta.className='meta';meta.textContent=new Date(m.created_at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
   b.append(content,meta);elements.push(b);
  }
  if(!elements.length){const empty=document.createElement('div');empty.className='system';empty.textContent='等待属于你们的第一条加密消息 ♡';elements.push(empty);}
  const box=$('messages'),wasBottom=(box.scrollHeight-box.scrollTop-box.clientHeight)<150;
  box.replaceChildren(...elements);if(wasBottom)box.scrollTop=box.scrollHeight;
  lastPaint=signature;status('设备已授权 · 新消息已启用端到端加密');
 }catch(e){status('读取失败：'+e.message);}
 finally{refreshBusy=false;}
}
function approvalText(message,stage='待审核'){
 $('approvalState').textContent=stage;
 $('approvalMessage').textContent=message;
}
function openApproval(role){
 lastApprovalFocus=document.activeElement;
 $('approvalRole').textContent=role==='Ko Ko'?'HE · Ko Ko':'SHE · Chit Chit';
 $('approvalFingerprint').textContent='正在生成安全设备指纹…';
 $('approvalCopy').disabled=true;
 $('approvalApply').classList.add('hidden');
 $('approvalApply').disabled=true;
 $('deviceApproval').classList.remove('hidden');
 $('approvalRetry').disabled=true;
 approvalText('正在检查本机设备是否已经获得授权…','检查中…');
 $('approvalClose').focus({preventScroll:true});
}
function closeApproval(){
 if(state.busy)return;
 $('deviceApproval').classList.add('hidden');
 state.role=null;state.identity=null;state.fp=null;state.session=null;
 $('gateStatus').textContent='选择身份后，将自动检查本机授权状态。';
 (lastApprovalFocus?.isConnected?lastApprovalFocus:document.querySelector('[data-role]'))?.focus({preventScroll:true});
}
async function chooseRole(role,apply=false){
 if(state.busy)return;
 const isSamePending=state.role===role&&!$('deviceApproval').classList.contains('hidden');
 state.busy=true;clearInterval(state.timer);state.session=null;state.encryption=null;state.role=role;lastPaint='';haveSnapshot=false;seenMessages=new Set();
 if(!isSamePending)openApproval(role);
 $('approvalRetry').disabled=true;
 $('approvalApply').classList.add('hidden');
 $('approvalApply').disabled=true;
 let approvalVerified=false;
 try{
  approvalText('正在验证本机身份，请稍候…','检查中…');
  const data=await findSigningIdentity(role);
  state.identity=data.pair;state.fp=data.fp;
  $('approvalFingerprint').textContent=data.fp;
  $('approvalCopy').disabled=false;
  const deviceState=await checkOrApplyDevice(data,apply);
  if(deviceState!=='approved'){
   if(deviceState==='pending'){
    approvalText('申请已提交，正在等待管理员确认。\n请将设备指纹交给管理员核对，批准后点击「重新检查授权」。','待管理员审批');
   }else if(deviceState==='revoked'){
    approvalText('这台设备的授权已被撤销，无法进入聊天。请联系管理员处理。','已撤销');
   }else if(deviceState==='unregistered'){
    approvalText('本机尚未提交授权申请。点击「申请本机设备授权」，由管理员在独立页面批准后，再返回检查。','未申请');
    $('approvalApply').classList.remove('hidden');
    $('approvalApply').disabled=false;
   }else{
    approvalText('此设备没有有效授权。可以先刷新检查；仍有问题请联系管理员。','尚未授权');
   }
   $('gateStatus').textContent='本机授权待确认 · 请在授权窗口查看状态。';
   return;
  }
  approvalVerified=true;
  approvalText('设备已获批准，正在完成服务器私钥验证和加密准备…','已批准');
  await login();await setupEncryption();
  try{localStorage.setItem('ay-secure-role-v1',role);}catch{}
  $('deviceApproval').classList.add('hidden');
  $('gate').classList.add('hidden');$('chat').classList.remove('hidden');
  $('who').textContent=(role==='Ko Ko'?'HE · Ko Ko':'SHE · Chit Chit')+' · 已验证设备';
  $('messages').replaceChildren();if('Notification' in window&&Notification.permission==='granted'){request('/push/status').then(d=>{if(d.registered)$('notify').textContent='🔔 已开启';}).catch(()=>{});}await refresh();state.timer=setInterval(refresh,5000);
 }catch(e){
  $('chat').classList.add('hidden');$('gate').classList.remove('hidden');
  const message=e?.message||'未知错误';
  if(approvalVerified){
   approvalText('服务器确认已批准本机，但安全登录尚未完成：'+message+'\n请刷新测试页后点击「重新检查授权」。不需要重复申请或修改管理员审批。','登录验证失败');
  }else{
   approvalText('无法完成本机授权检查：'+message+'\n请确认网络正常，然后点击「重新检查授权」。','检查失败');
  }
 }finally{
  state.busy=false;$('approvalRetry').disabled=false;
  if(state.role&& !$('chat').classList.contains('hidden'))refresh();
 }
}
document.querySelectorAll('[data-role]').forEach(b=>b.addEventListener('click',()=>chooseRole(b.dataset.role)));
$('approvalRetry').addEventListener('click',()=>{if(state.role)chooseRole(state.role);});
$('approvalApply').addEventListener('click',()=>{if(state.role)chooseRole(state.role,true);});
$('approvalCopy').addEventListener('click',async()=>{
 if(!state.fp)return;
 try{await navigator.clipboard.writeText(state.fp);$('approvalCopy').textContent='✓ 已复制';}
 catch{ $('approvalFingerprint').textContent=state.fp+'\n（复制失败，请长按指纹手动复制）';$('approvalCopy').textContent='请长按复制'; }
 setTimeout(()=>{if($('approvalCopy'))$('approvalCopy').textContent='复制设备指纹';},2200);
});
$('approvalClose').addEventListener('click',closeApproval);
$('approvalSwitch').addEventListener('click',closeApproval);
$('deviceApproval').addEventListener('keydown',e=>{
 if(e.key==='Escape'){e.preventDefault();closeApproval();}
 if(e.key==='Tab'){
  const focusable=Array.from($('deviceApproval').querySelectorAll('button:not(:disabled)'));
  if(!focusable.length)return;
  const first=focusable[0],last=focusable[focusable.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
 }
});
$('exit').addEventListener('click',()=>{
 try{localStorage.removeItem('ay-secure-role-v1');}catch{}
 clearInterval(state.timer);state.role=null;state.session=null;state.identity=null;state.encryption=null;haveSnapshot=false;seenMessages=new Set();
 $('chat').classList.add('hidden');$('gate').classList.remove('hidden');
 $('gateStatus').textContent='选择身份后，将自动检查本机授权状态。';
});
$('composer').addEventListener('submit',async e=>{
 e.preventDefault();if(state.busy||!state.role)return;const input=$('message'),message=input.value.trim();if(!message)return;
 state.busy=true;$('send').disabled=true;try{const payload=await encryptMessage(message);await request('/messages','POST',payload);input.value='';lastPaint='';await refresh();}catch(err){status('发送失败：'+err.message);}finally{state.busy=false;$('send').disabled=false;refresh();}
});
$('message').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('composer').requestSubmit();}});
$('notify').addEventListener('click',async()=>{
 $('notify').disabled=true;
 try{await enablePush();playHeartNote();}catch(e){status('开启提醒失败：'+e.message);}
 finally{$('notify').disabled=false;}
});
$('syncHistory').addEventListener('click',async()=>{
 $('syncHistory').disabled=true;
 try{
  status('正在为新设备重新封装旧消息密钥，请保持页面开启…');
  const x=await shareVisibleHistory();
  status(x.shared?`已经安全共享 ${x.messages} 条消息的 ${x.shared} 个设备解密凭证。请让新设备刷新聊天。`:'当前没有需要向新设备补发的可解密记录（最多检查最近80条）。');
 }catch(e){status('历史同步失败：'+e.message);}
 finally{$('syncHistory').disabled=false;}
});
$('testPush').addEventListener('click',async()=>{
 $('testPush').disabled=true;
 try{const x=await request('/push/test','POST',{});status('已安排约 '+(x.afterSeconds||6)+' 秒后的锁屏提醒；请立即切到后台或锁屏测试。');}
 catch(e){status('测试通知失败：'+e.message);}
 finally{$('testPush').disabled=false;}
});
if(navigator.serviceWorker)navigator.serviceWorker.addEventListener('message',event=>{
 if(event.data?.type==='ay-v2-new-message')refresh();
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.role)refresh();});
try{const previous=localStorage.getItem('ay-secure-role-v1');if(previous==='Ko Ko'||previous==='Chit Chit'){setTimeout(()=>chooseRole(previous),200);}}catch{}
