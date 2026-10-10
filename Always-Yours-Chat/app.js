'use strict';
// Official secure v2 private chat, cryptographic authentication enforced server-side. Keeps all identity + encryption private keys in origin-local IndexedDB.
const AUTH_BASE='https://zegjegutcigbydtzggur.supabase.co/functions/v1/always-yours-chat';
const API_BASE='https://zegjegutcigbydtzggur.supabase.co/functions/v1/always-yours-secure-v2';
const AUTH_DB='always-yours-identity-keys-v1',ENC_DB='always-yours-secure-encryption-v1';
const $=id=>document.getElementById(id),te=new TextEncoder(),td=new TextDecoder();
const state={role:null,identity:null,fp:null,session:null,expires:0,encryption:null,keys:[],busy:false,timer:null,replyTo:null,editingId:null,editingIv:null,messageIvs:new Map(),attachment:null,decryptedMap:new Map(),pendingSend:null};
let lastApprovalFocus=null;
const validB64=/^[A-Za-z0-9_-]+$/;
function b64(bytes){const v=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);let s='';for(const c of v)s+=String.fromCharCode(c);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function un64(s){if(!validB64.test(s))throw new Error('无效的加密编码');return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));}
async function digest(value){return b64(await crypto.subtle.digest('SHA-256',typeof value==='string'?te.encode(value):value));}
function status(text){const target=state.role?$('chatStatus'):$('gateStatus');target.textContent=text;if(target.id==='chatStatus')target.classList.toggle('statusQuiet',/^设备已授权 ·/.test(text));}
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
 let c;try{c=await jsonFetch(AUTH_BASE+'/api/v2/device/challenge',{user_name:role,fingerprint:fp});}
 catch(e){if(/Device not approved|授权已撤销|设备未授权/i.test(String(e?.message||''))&&!$('chat').classList.contains('hidden'))lockRevokedDevice();throw e;}
 if(!/^[a-f0-9-]{36}$/.test(c.challengeId||'')||!/^[A-Za-z0-9_-]{43}$/.test(c.challenge||''))throw new Error('挑战响应不正确');
 const payload=te.encode(['AY-V2-DEVICE-CHALLENGE',role,c.challengeId,c.challenge].join('\n'));
 const proof=b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},state.identity.privateKey,payload));
 const x=await jsonFetch(AUTH_BASE+'/api/v2/device/verify',{user_name:role,challengeId:c.challengeId,signature:proof});
 if(!x.deviceVerified||!x.accessToken||x.fingerprint!==fp)throw new Error('服务器未批准当前设备');
 state.session=x.accessToken;state.expires=Date.now()+Math.min(600,Number(x.expiresInSeconds)||600)*1000;syncSWChatReadiness();
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
 if(!r.ok){
   if(r.status===401){state.session=null;state.expires=0;}
   if(r.status===403&&/此设备未授权|授权已撤销|Device not approved/i.test(String(x.error||'')))lockRevokedDevice();
   throw new Error(x.error||'安全请求失败');
  }
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
async function encryptMessage(text,idOverride=null){
 const keys=await loadKeys();
 if(!keys.some(k=>k.user_name==='Ko Ko')||!keys.some(k=>k.user_name==='Chit Chit'))throw new Error('请先让 HE 和 SHE 两边的已批准设备各进入本测试页面一次，以登记加密公钥。');
 const id=idOverride||crypto.randomUUID(),contentKeyBytes=crypto.getRandomValues(new Uint8Array(32));
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
// R12: message keys never leave the device unencrypted. Errors are isolated per
// message/recipient so one malformed historical envelope cannot stop all others.
async function shareVisibleHistory(){
 if(!state.role||!state.encryption)throw new Error('请先用已授权设备进入聊天');
 const selectedRole=state.role,selectedFp=state.fp;
 const keys=await loadKeys(),data=await request('/messages');
 let shared=0,messages=0,failed=0,unreadable=0;
 for(const m of data.messages||[]){
  if(selectedRole!==state.role||selectedFp!==state.fp||$('chat').classList.contains('hidden'))
   throw new Error('设备身份已变化，同步已停止');
  const absent=keys.filter(k=>!m.envelopes?.[k.fingerprint]);
  if(!absent.length)continue;
  const ownEnv=m.envelopes?.[selectedFp];if(!ownEnv)continue;
  let contentBytes;
  try{
   const sourcePub=await crypto.subtle.importKey('jwk',ownEnv.ephemeralPublicKey||m.ephemeral_public_key,{name:'ECDH',namedCurve:'P-256'},false,[]);
   const oldWrap=await deriveWrap(state.encryption.privateKey,sourcePub,m.id,selectedFp);
   contentBytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(ownEnv.iv),additionalData:te.encode('AY-WRAP|'+m.id+'|'+selectedFp)},oldWrap,un64(ownEnv.ciphertext)));
  }catch(e){unreadable++;continue;}
  let anyShared=false;
  for(const k of absent){
   try{
    const fresh=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
    const p=await crypto.subtle.exportKey('jwk',fresh.publicKey);
    const pub=await crypto.subtle.importKey('jwk',k.enc_public_key,{name:'ECDH',namedCurve:'P-256'},false,[]);
    const wrap=await deriveWrap(fresh.privateKey,pub,m.id,k.fingerprint),iv=crypto.getRandomValues(new Uint8Array(12));
    const sealed=b64(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:te.encode('AY-WRAP|'+m.id+'|'+k.fingerprint)},wrap,contentBytes));
    const res=await request('/messages/grant','POST',{id:m.id,expectedIv:m.iv,fingerprint:k.fingerprint,envelope:{iv:b64(iv),ciphertext:sealed,ephemeralPublicKey:{kty:'EC',crv:'P-256',x:p.x,y:p.y}}});
    if(res.shared){shared++;anyShared=true;}
   }catch(e){
    // A revoked source must stop immediately rather than continuing with another recipient.
    if(!state.role||state.role!==selectedRole||state.fp!==selectedFp||$('chat').classList.contains('hidden'))throw e;
    failed++;
   }
  }
  if(anyShared)messages++;
  contentBytes.fill(0);
 }
 return {shared,messages,failed,unreadable,checked:(data.messages||[]).length};
}
async function showHistoryCoverage(){
 const x=await request('/history/status');
 if(!x.ok||!Number.isInteger(x.total)||!Number.isInteger(x.availableHere)||!Number.isInteger(x.noApprovedKey))
  throw new Error('历史密钥检查结果无效');
 const partial=x.truncated?'（仅检查最近1000条，非全部统计）':'';
 status(`近30天加密消息 ${x.total} 条${partial} · 本机持有密钥封装 ${x.availableHere} 条 · 当前所有已批准设备均无密钥封装 ${x.noApprovedKey} 条。`+
  (x.noApprovedKey?'这些记录只有曾获授权的旧设备可能协助恢复：原设备需重新申请获批、保留原本机私钥，再使用「同步新设备历史」。服务器不能替代设备解密。':'可以在拥有历史解密密钥的设备上选择「同步新设备历史」。'));
}
let lastPaint='',refreshBusy=false,haveSnapshot=false,seenMessages=new Set();
const v2Broadcast='BroadcastChannel' in window?new BroadcastChannel('ay-v2-chat'):null;
let newWhileAway=0;
function announceLocalChange(){try{v2Broadcast?.postMessage({type:'changed',role:state.role});}catch{}}
function updateJumpButton(){
 const box=$('messages'),button=$('jumpLatest');if(!box||!button)return;
 const distance=box.scrollHeight-box.scrollTop-box.clientHeight;
 const away=distance>140;button.classList.toggle('hidden',!away);
 if(!away)newWhileAway=0;
 button.textContent=newWhileAway?'↓ '+newWhileAway+' 条新消息':'↓ 回到最新';
 button.setAttribute('aria-label',newWhileAway?'跳到最新消息，共 '+newWhileAway+' 条新消息':'跳到最新消息');
}
$('messages').addEventListener('scroll',()=>updateJumpButton(),{passive:true});
$('jumpLatest').addEventListener('click',()=>{$('messages').scrollTo({top:$('messages').scrollHeight,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});newWhileAway=0;updateJumpButton();});
window.addEventListener('online',()=>{if(state.role){status('网络已恢复，正在同步消息…');lastPaint='';if(readQueue.size)markVisibleRead([...readQueue][0]);refresh();}});
window.addEventListener('offline',()=>{if(state.role)status('目前离线 · 暂时不能发送和同步。已输入的内容会保留在此页面。');});
v2Broadcast?.addEventListener('message',e=>{if(e.data?.type==='changed'&&e.data?.role===state.role&&state.role)refresh();});
let notificationAudio=null,readObserver=null,readQueue=new Set(),readFlushBusy=false;
// This cannot delete plaintext/screenshots already retained by the browser or user. It locks this live view
// after server-side device revocation and does not delete local non-exportable private keys.
function clearPrivateView(){
 clearInterval(state.timer);state.timer=null;
 state.session=null;state.expires=0;state.encryption=null;state.keys=[];
 state.pendingSend=null;state.decryptedMap.clear();state.messageIvs.clear();state.replyTo=null;state.editingId=null;state.editingIv=null;
 state.attachment=null;lastPaint='';haveSnapshot=false;seenMessages=new Set();newWhileAway=0;
 readQueue.clear();if(readObserver){readObserver.disconnect();readObserver=null;}
 $('messages').replaceChildren();$('message').value='';$('photoInput').value='';$('gifInput').value='';
 $('replyPreview').classList.add('hidden');$('attachmentInfo').classList.add('hidden');
 $('photoViewer').classList.add('hidden');$('viewerImage').removeAttribute('src');
 viewerState.uri='';viewerState.pointers.clear();
 $('chat').classList.add('hidden');$('gate').classList.remove('hidden');document.body.classList.remove('chatMode');
 syncSWChatReadiness();
}
function lockRevokedDevice(){
 clearPrivateView();state.role=null;state.identity=null;state.fp=null;
 try{localStorage.removeItem('ay-secure-role-v1');}catch{}
 $('gateStatus').textContent='服务器已拒绝此设备的授权：聊天已锁定。请联系管理员核对设备状态。';
}
// R13: Never suppress OS notifications for a device that has not finished
// entering an authenticated, decryptable Chat V2 view.
function v2ChatActiveForPush(){
 return !!(state.role&&state.identity?.privateKey&&state.encryption?.privateKey&&
  state.session&&state.expires>Date.now()&&navigator.onLine&&!document.hidden&&
  document.hasFocus()&&!$('chat').classList.contains('hidden'));
}
function syncSWChatReadiness(){
 try{navigator.serviceWorker?.controller?.postMessage({
   type:'ay-v2-chat-readiness',ready:v2ChatActiveForPush()
 });}catch{}
}
function soundOn(){return localStorage.getItem('ay-v2-sound')==='1';}
async function enableSound(){
 const C=window.AudioContext||window.webkitAudioContext;
 if(!C)throw new Error('本浏览器不支持网页提示音');
 if(!notificationAudio)notificationAudio=new C();
 if(notificationAudio.state!=='running')await notificationAudio.resume();
 if(notificationAudio.state!=='running')throw new Error('浏览器暂未解锁音频，请再点击一次');
 localStorage.setItem('ay-v2-sound','1');$('sound').textContent='♪ 已开启';
 playHeartNote();status('已开启页面内提示音。关闭网页后需另外开启系统通知。');
}
function playHeartNote(){
 try{
  if(!soundOn()||!notificationAudio||notificationAudio.state!=='running')return;
  const t=notificationAudio.currentTime;
  for(const [delay,freq] of [[0,659.25],[0.14,783.99]]){
   const o=notificationAudio.createOscillator(),g=notificationAudio.createGain();
   o.type='sine';o.frequency.value=freq;
   g.gain.setValueAtTime(0.0001,t+delay);
   g.gain.exponentialRampToValueAtTime(.05,t+delay+.02);
   g.gain.exponentialRampToValueAtTime(.0001,t+delay+.18);
   o.connect(g).connect(notificationAudio.destination);o.start(t+delay);o.stop(t+delay+.2);
  }
  if(navigator.vibrate)navigator.vibrate([55,40,55]);
 }catch{}
}
async function enablePush(){
 if(!state.role)throw new Error('请先进入已授权聊天');
 if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))
  throw new Error('本浏览器不支持后台推送；您仍可单独开启「网页声音」。');
 const ua=navigator.userAgent||'';
 const ios=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const standalone=window.navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;
 if(ios&&!standalone)throw new Error('iPhone / iPad 请先用 Safari「分享 → 添加到主屏幕」，从主屏幕打开 Our Love Hub 后再开启通知。网页声音可单独开启。');
 const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
 if(permission!=='granted')throw new Error('系统通知权限未允许；可在系统设置中修改。网页提示音可单独开启。');
 const registration=await navigator.serviceWorker.register('./sw.js?v=20261010-push-r13',{scope:'./',updateViaCache:'none'});
 await navigator.serviceWorker.ready;
 const cfg=await request('/push/config');
 if(!cfg.configured||!cfg.publicKey)throw new Error('Supabase 推送配置尚未完成');
 const options={userVisibleOnly:true,applicationServerKey:un64(cfg.publicKey)};
 const sub=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe(options);
 await request('/push/subscribe','POST',{subscription:sub.toJSON()});
 $('notify').textContent='🔔 已订阅';
 status('系统通知已订阅。请用「测试铃铛」验证锁屏推送。网页声音需单独开启。');
}
function decodePayload(plain){
 if(!plain.startsWith('AYV2:'))return {t:'text',body:plain};
 try{
  const p=JSON.parse(plain.slice(5));
  if(!p||!['text','emoji','image','gif'].includes(p.t))throw Error();
  return p;
 }catch{return {t:'text',body:'[暂时无法识别的消息格式]'};}
}
function summaryOf(p){
 if(!p)return '一条消息';
 if(p.t==='image')return '📷 '+(p.body||'照片');
 if(p.t==='gif')return 'GIF '+(p.body||'动图');
 return String(p.body||'').slice(0,48);
}
function replyToMessage(id){
 const p=state.decryptedMap.get(id);if(!p)return;
 state.replyTo=id;state.editingId=null;state.editingIv=null;$('replyPreview').classList.remove('hidden');
 $('replyPreviewText').textContent='↩ 回复：'+summaryOf(p);$('send').textContent='发送 ♡';
 $('message').focus();
}
function editMessage(id){
 const p=state.decryptedMap.get(id);
 if(!p||p.t!=='text')return status('目前仅支持编辑文字消息');
 const originalIv=state.messageIvs.get(id);
 if(typeof originalIv!=='string'||!/^[A-Za-z0-9_-]{16}$/.test(originalIv))return status('未找到这条消息的安全版本，请刷新后再编辑');
 state.editingId=id;state.editingIv=originalIv;state.replyTo=p.replyTo||null;
 $('replyPreview').classList.remove('hidden');$('replyPreviewText').textContent='✎ 正在编辑自己的消息';
 $('message').value=p.body||'';$('send').textContent='保存 ♡';$('message').focus();
}
function clearComposerMode(){
 state.replyTo=null;state.editingId=null;state.editingIv=null;
 $('replyPreview').classList.add('hidden');$('replyPreviewText').textContent='';
 $('send').textContent='发送 ♡';
}
function attachmentReset(){state.attachment=null;$('attachmentInfo').classList.add('hidden');$('attachmentInfo').textContent='';$('gifInput').value='';$('photoInput').value='';}
function renderMessageBody(element,p){
 if(p.t==='emoji'){
  const em=document.createElement('span');em.className='emojiMotion';em.textContent=String(p.body||'💗').slice(0,12);element.append(em);
 }else if(p.t==='image'||p.t==='gif'){
  const uri=String(p.data||'');const ok=p.t==='image'?/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(uri):/^data:image\/gif;base64,[A-Za-z0-9+/=]+$/.test(uri);
  if(ok&&uri.length<=350000){
   const zoom=document.createElement('button');zoom.type='button';zoom.className='chatMediaOpen';zoom.title='点击放大、缩放或保存图片';zoom.setAttribute('aria-label','打开图片，可缩放或保存到手机');
   const im=document.createElement('img');im.className='chatMedia';im.alt=p.t==='gif'?'发送的 GIF 动图':'发送的照片';im.loading='lazy';im.src=uri;
   zoom.append(im);zoom.addEventListener('click',()=>openImageViewer(uri,p.t));element.append(zoom);
  }
  else element.textContent='[媒体文件格式不正确]';
  if(p.body){const caption=document.createElement('div');caption.className='captionText';caption.textContent=String(p.body).slice(0,150);element.append(caption);}
 }else element.textContent=String(p.body??'');
}
// Local-only media lightbox: decrypted bytes never leave this device unless the user explicitly shares/saves.
const viewerState={uri:'',kind:'image',zoom:1,x:0,y:0,focus:null,pointers:new Map(),gesture:null};
function setViewerZoom(next){
 viewerState.zoom=Math.max(1,Math.min(4,Math.round(next*10)/10));
 if(viewerState.zoom===1){viewerState.x=0;viewerState.y=0;}
 const range=$('viewerZoom');range.value=String(viewerState.zoom);
 $('viewerZoomLabel').textContent=Math.round(viewerState.zoom*100)+'%';
 positionViewer();
}
function positionViewer(){
 const stage=$('viewerStage');if(!stage)return;
 const maxX=(stage.clientWidth*(viewerState.zoom-1))/2;
 const maxY=(stage.clientHeight*(viewerState.zoom-1))/2;
 viewerState.x=Math.max(-maxX,Math.min(maxX,viewerState.x));
 viewerState.y=Math.max(-maxY,Math.min(maxY,viewerState.y));
 $('viewerImage').style.transform=`translate3d(${viewerState.x}px,${viewerState.y}px,0) scale(${viewerState.zoom})`;
}
function openImageViewer(uri,kind){
 if(!/^data:image\/(?:jpeg|gif);base64,[A-Za-z0-9+/=]+$/.test(uri)||uri.length>350000)return;
 viewerState.focus=document.activeElement;viewerState.uri=uri;viewerState.kind=kind;viewerState.pointers.clear();viewerState.gesture=null;
 $('viewerTitle').textContent=kind==='gif'?'我们的 GIF ♡':'我们的照片 ♡';
 $('viewerImage').alt=kind==='gif'?'聊天 GIF 动图预览':'聊天照片预览';
 $('viewerImage').src=uri;
 $('viewerHint').textContent='双指放大 · 拖动查看 · 点击保存图片，可保存至本机';
 $('photoViewer').classList.remove('hidden');document.body.classList.add('viewerOpen');
 setViewerZoom(1);$('viewerClose').focus({preventScroll:true});
}
function closeImageViewer(){
 if($('photoViewer').classList.contains('hidden'))return;
 $('photoViewer').classList.add('hidden');document.body.classList.remove('viewerOpen');
 $('viewerImage').removeAttribute('src');viewerState.uri='';viewerState.pointers.clear();viewerState.gesture=null;
 if(viewerState.focus?.isConnected)viewerState.focus.focus({preventScroll:true});
}
function localMediaBlob(uri){
 const match=/^data:(image\/(?:jpeg|gif));base64,([A-Za-z0-9+/=]+)$/.exec(uri);
 if(!match||uri.length>350000)throw Error('不支持的图片格式');
 const decoded=atob(match[2]);const bytes=new Uint8Array(decoded.length);
 for(let i=0;i<decoded.length;i++)bytes[i]=decoded.charCodeAt(i);
 return new Blob([bytes],{type:match[1]});
}
async function saveViewedImage(){
 if(!viewerState.uri)return;
 const kind=viewerState.kind,blob=localMediaBlob(viewerState.uri);
 const filename='our-love-'+new Date().toISOString().replace(/[:.]/g,'-')+(kind==='gif'?'.gif':'.jpg');
 const file=new File([blob],filename,{type:blob.type});
 // On iOS the native share sheet can save to Photos or Files.
 if(typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&navigator.canShare({files:[file]})){
   try{await navigator.share({files:[file],title:'Our Love Hub · 私人照片'});$('viewerHint').textContent='已打开系统分享菜单；可选择存储图像或保存到文件。';return;}
   catch(e){if(e?.name==='AbortError')return;}
 }
 const url=URL.createObjectURL(blob);
 try{const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
    $('viewerHint').textContent='已请求浏览器保存图片；在 iPhone 上可从下载项打开并保存到相册。';
 }finally{setTimeout(()=>URL.revokeObjectURL(url),30000);}
}
$('viewerClose').addEventListener('click',closeImageViewer);
$('photoViewer').addEventListener('click',e=>{if(e.target===$('photoViewer'))closeImageViewer();});
$('viewerPlus').addEventListener('click',()=>setViewerZoom(viewerState.zoom+.5));
$('viewerMinus').addEventListener('click',()=>setViewerZoom(viewerState.zoom-.5));
$('viewerZoom').addEventListener('input',e=>setViewerZoom(Number(e.target.value)));
$('viewerSave').addEventListener('click',()=>saveViewedImage().catch(e=>{$('viewerHint').textContent='保存失败：'+e.message;}));
$('viewerStage').addEventListener('dblclick',()=>setViewerZoom(viewerState.zoom>1?1:2.2));
$('viewerStage').addEventListener('wheel',e=>{if($('photoViewer').classList.contains('hidden'))return;e.preventDefault();setViewerZoom(viewerState.zoom+(e.deltaY<0?.25:-.25));},{passive:false});
function getDistance(p){const points=[...p.values()];return Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);}
$('viewerStage').addEventListener('pointerdown',e=>{
 if(e.pointerType==='mouse'&&e.button!==0)return;
 const stage=$('viewerStage');viewerState.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
 try{stage.setPointerCapture(e.pointerId);}catch{}
 if(viewerState.pointers.size===1)viewerState.gesture={type:'pan',startX:e.clientX,startY:e.clientY,x:viewerState.x,y:viewerState.y};
 else if(viewerState.pointers.size===2)viewerState.gesture={type:'pinch',distance:getDistance(viewerState.pointers),zoom:viewerState.zoom};
});
$('viewerStage').addEventListener('pointermove',e=>{
 const p=viewerState.pointers;if(!p.has(e.pointerId))return;
 p.set(e.pointerId,{x:e.clientX,y:e.clientY});const g=viewerState.gesture;
 if(p.size===2&&g?.type==='pinch')setViewerZoom(g.zoom*getDistance(p)/Math.max(g.distance,1));
 else if(p.size===1&&g?.type==='pan'&&viewerState.zoom>1){viewerState.x=g.x+(e.clientX-g.startX);viewerState.y=g.y+(e.clientY-g.startY);positionViewer();}
});
function endViewerPointer(e){viewerState.pointers.delete(e.pointerId);if(viewerState.pointers.size===1){const p=[...viewerState.pointers.values()][0];viewerState.gesture={type:'pan',startX:p.x,startY:p.y,x:viewerState.x,y:viewerState.y};}else if(!viewerState.pointers.size)viewerState.gesture=null;}
['pointerup','pointercancel','lostpointercapture'].forEach(t=>$('viewerStage').addEventListener(t,endViewerPointer));
document.addEventListener('keydown',e=>{
 if($('photoViewer').classList.contains('hidden'))return;
 if(e.key==='Escape'){e.preventDefault();closeImageViewer();return;}
 if(e.key==='+'||e.key==='='){e.preventDefault();setViewerZoom(viewerState.zoom+.25);}
 if(e.key==='-'){e.preventDefault();setViewerZoom(viewerState.zoom-.25);}
 if(e.key==='Tab'){
  const nodes=[...$('viewerDialog').querySelectorAll('button:not(:disabled),input:not(:disabled)')];
  if(nodes.length&&(e.shiftKey&&document.activeElement===nodes[0])){e.preventDefault();nodes[nodes.length-1].focus();}
  else if(nodes.length&&!e.shiftKey&&document.activeElement===nodes[nodes.length-1]){e.preventDefault();nodes[0].focus();}
 }
});
// Keep the compact menu from lingering above content after interactions.
document.addEventListener('click',e=>{const menu=$('chatOptions');if(menu?.open&&!menu.contains(e.target))menu.open=false;});
$('chatOptions').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{$('chatOptions').open=false;}));

async function markVisibleRead(id){
 if(!id||document.hidden||!state.role)return;
 readQueue.add(id);if(readFlushBusy)return;
 readFlushBusy=true;
 try{
  await new Promise(resolve=>setTimeout(resolve,250));
  while(readQueue.size&&!document.hidden&&state.role){
   const ids=[...readQueue].slice(0,80);
   ids.forEach(v=>readQueue.delete(v));
   try{
    const x=await request('/messages/read','POST',{ids});
    if(x.seen){lastPaint='';announceLocalChange();}
   }catch(e){
    // Read receipts are best-effort; keep the pending batch available for the next refresh.
    ids.forEach(v=>readQueue.add(v));
    console.warn('Read receipt not saved',e.message);
    break;
   }
  }
 }finally{readFlushBusy=false;}
}
function observeRead(b,id){
 if(!('IntersectionObserver' in window)){if(!document.hidden)markVisibleRead(id);return;}
 if(!readObserver)readObserver=new IntersectionObserver(entries=>{
  if(document.hidden)return;
  for(const e of entries)if(e.isIntersecting&&e.intersectionRatio>=.5){
   readObserver.unobserve(e.target);markVisibleRead(e.target.dataset.mid);
  }
 },{root:$('messages'),threshold:[0,.5]});
 b.dataset.mid=id;readObserver.observe(b);
}
async function refresh(){
 if(!state.role||refreshBusy||document.hidden)return;
 if(!navigator.onLine){status('目前离线 · 等待网络恢复后同步。');return;}
 refreshBusy=true;
 try{
  const requestedRole=state.role,requestedFp=state.fp;
  const data=await request('/messages');
  if(state.role!==requestedRole||state.fp!==requestedFp||$('chat').classList.contains('hidden'))return;
  // Device envelope changes (e.g. history-key share) must repaint, even if read/edit time is unchanged.
  const arr=data.messages||[],signature=JSON.stringify(arr.map(m=>[m.id,m.read_at,m.edited_at,m.envelopes?.[requestedFp]||null]));
  // R19: snapshot message versions for optimistic edit concurrency control.
  state.messageIvs=new Map(arr.filter(m=>typeof m.id==='string'&&typeof m.iv==='string').map(m=>[m.id,m.iv]));
  if(signature===lastPaint)return;
  const incoming=arr.filter(m=>m.sender!==state.role&&haveSnapshot&&!seenMessages.has(m.id));
  for(const m of arr)seenMessages.add(m.id);
  if(incoming.length&&document.visibilityState==='visible')playHeartNote();
  haveSnapshot=true;
  const parsed=[];state.decryptedMap=new Map();
  for(const m of arr){
   let p;
   try{p=decodePayload(await decryptMessage(m));}
   catch{p={t:'text',body:'[本设备暂时无法解密这条消息]'};}
   state.decryptedMap.set(m.id,p);parsed.push({m,p});
  }
  const elements=[];
  for(const {m,p} of parsed){
   const own=m.sender===state.role;
   const wrap=document.createElement('div');wrap.className='messageRow'+(own?' mine':'');
   const b=document.createElement('div');b.className='bubble'+(own?' own':'');
   if(p.replyTo){
    const q=document.createElement('div');q.className='replyQuote';
    q.textContent='↩ '+summaryOf(state.decryptedMap.get(p.replyTo));b.append(q);
   }
   const content=document.createElement('div');content.className='msg';renderMessageBody(content,p);
   const meta=document.createElement('div');meta.className='meta';
   const when=new Date(m.created_at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
   meta.textContent=when+(m.edited_at?' · 已编辑':'')+(own?'  '+(m.read_at?'✓✓':'✓'):'');
   if(own){const ticks=document.createElement('span');ticks.className='ticks'+(m.read_at?' read':'');ticks.textContent='';meta.append(ticks);}
   b.append(content,meta);
   const actions=document.createElement('div');actions.className='msgActions';
   const reply=document.createElement('button');reply.type='button';reply.title='回复此消息';reply.textContent='↩';reply.setAttribute('aria-label','回复此消息');reply.addEventListener('click',()=>replyToMessage(m.id));actions.append(reply);
   if(own&&p.t==='text'){
    const edit=document.createElement('button');edit.type='button';edit.textContent='✎';edit.title='编辑消息';edit.setAttribute('aria-label','编辑消息');edit.addEventListener('click',()=>editMessage(m.id));actions.append(edit);
   }
   if(own)wrap.append(actions,b);else wrap.append(b,actions);elements.push(wrap);
   if(!own&&!m.read_at&&!String(p.body||'').startsWith('[本设备暂时无法解密')) {b.dataset.needsRead='1';b.dataset.mid=m.id;}
  }
  if(!elements.length){const empty=document.createElement('div');empty.className='system';empty.textContent='等待属于你们的第一条加密消息 ♡';elements.push(empty);}
  const box=$('messages'),wasBottom=(box.scrollHeight-box.scrollTop-box.clientHeight)<150;
  if(!wasBottom)newWhileAway+=incoming.length;
  if(readObserver){readObserver.disconnect();readObserver=null;}
  box.replaceChildren(...elements);if(wasBottom)box.scrollTop=box.scrollHeight;
  updateJumpButton();
  box.querySelectorAll('[data-needs-read]').forEach(b=>observeRead(b,b.dataset.mid||b.closest('.messageRow')?.dataset.mid));
  lastPaint=signature;
  status('设备已授权 · 新消息保持端到端加密 · 单勾未读 / 双勾已读');
  // Broadcast only actual writes, not every poll/render; avoids cross-tab repaint loops.
 }catch(e){if(state.role)status('读取失败：'+e.message);}
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
 state.busy=true;clearInterval(state.timer);state.session=null;state.encryption=null;state.role=role;syncSWChatReadiness();lastPaint='';haveSnapshot=false;seenMessages=new Set();state.decryptedMap=new Map();state.pendingSend=null;newWhileAway=0;readQueue.clear();
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
    approvalText('这台设备先前的授权已解除。您可以用本机原有私钥重新提交设备申请，管理员重新批准后即可恢复 Chat V2 访问。\n在等待批准期间无法访问私人消息。','可重新申请');
    $('approvalApply').classList.remove('hidden');
    $('approvalApply').disabled=false;
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
  $('gate').classList.add('hidden');$('chat').classList.remove('hidden');document.body.classList.add('chatMode');syncSWChatReadiness();
  $('who').textContent=(role==='Ko Ko'?'HE · Ko Ko':'SHE · Chit Chit')+' · 已验证设备';if(soundOn()){$('sound').textContent='♪ 重启声音';$('sound').title='浏览器重开后须手动点击，才能重新播放网页提示音';}
  $('messages').replaceChildren();if('Notification' in window&&Notification.permission==='granted'){request('/push/status').then(d=>{if(d.registered)$('notify').textContent='🔔 已开启';}).catch(()=>{});}await refresh();state.timer=setInterval(refresh,5000);
 }catch(e){
  $('chat').classList.add('hidden');$('gate').classList.remove('hidden');document.body.classList.remove('chatMode');syncSWChatReadiness();
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
 clearPrivateView();state.role=null;state.fp=null;state.identity=null;clearComposerMode();attachmentReset();
 $('gateStatus').textContent='选择身份后，将自动检查本机授权状态。';
});
$('composer').addEventListener('submit',async e=>{
 e.preventDefault();if(state.busy||!state.role)return;
 const input=$('message'),message=input.value.trim(),editing=!!state.editingId;
 if(!message&&!state.attachment)return;
 if(editing&&!message){status('编辑消息不能为空');return;}
 state.busy=true;$('send').disabled=true;
 $('send').textContent=editing?'保存中…':'发送中…';
 try{
  const content=editing?{t:'text',body:message,replyTo:state.replyTo||null}:
    (state.attachment?{...state.attachment,body:message.slice(0,150),replyTo:state.replyTo||null}:
     {t:'text',body:message,replyTo:state.replyTo||null});
  const raw='AYV2:'+JSON.stringify(content);
  if(editing){
   if(!state.editingIv)throw new Error('消息版本已失效，请刷新后重新编辑');
   const packet={...(await encryptMessage(raw,state.editingId)),expectedIv:state.editingIv};
   await request('/messages/edit','POST',packet);
   state.pendingSend=null;
  }else{
   // A lost HTTP response must not create a second message when the user taps Send again.
   // Reuse the same random message ID / ciphertext for the unchanged in-page draft.
   const fingerprint=await digest(raw);
   if(!state.pendingSend||state.pendingSend.fingerprint!==fingerprint||state.pendingSend.role!==state.role)
    state.pendingSend={fingerprint,role:state.role,packet:await encryptMessage(raw)};
   try{await request('/messages','POST',state.pendingSend.packet);}
   catch(err){if(!/重复消息/.test(String(err?.message||'')))throw err;}
   state.pendingSend=null;
  }
  input.value='';attachmentReset();clearComposerMode();lastPaint='';announceLocalChange();
  await refresh();
 }catch(err){status('发送未确认：'+err.message+'。请检查网络后重试，系统会复用同一条消息编号。');}
 finally{state.busy=false;$('send').disabled=false;$('send').textContent=state.editingId?'保存 ♡':'发送 ♡';}
});
function setAttachment(att,display){
 state.attachment=att;clearComposerMode();$('attachmentInfo').classList.remove('hidden');$('attachmentInfo').textContent=display;
 $('message').focus();
}
$('replyCancel').addEventListener('click',clearComposerMode);
$('attachmentClear').addEventListener('click',attachmentReset);
$('photoOpen').addEventListener('click',()=>$('photoInput').click());
$('gifOpen').addEventListener('click',()=>$('gifInput').click());
$('emojiOpen').addEventListener('click',()=>$('emojiPanel').classList.toggle('hidden'));
document.querySelectorAll('.emojiPick').forEach(b=>b.addEventListener('click',async()=>{
 $('emojiPanel').classList.add('hidden');
 const text=b.textContent||'💗';
 if(state.busy)return;
 state.busy=true;
 try{
  const packet=await encryptMessage('AYV2:'+JSON.stringify({t:'emoji',body:text,replyTo:state.replyTo||null}));
  await request('/messages','POST',packet);clearComposerMode();lastPaint='';announceLocalChange();await refresh();
 }catch(e){status('心动贴纸发送失败：'+e.message);}finally{state.busy=false;}
}));
function readFileData(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(Error('本机无法读取所选文件'));r.onload=()=>resolve(r.result);r.readAsDataURL(file);});}
$('gifInput').addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file)return;
 try{
  if(file.type!=='image/gif'||!/\.gif$/i.test(file.name))throw Error('请选择真正的 .gif 动图');
  if(file.size>175*1024)throw Error('请选用不超过 175 KB 的 GIF，以减少加密聊天占用容量');
  const uri=await readFileData(file);
  if(!/^data:image\/gif;base64,[A-Za-z0-9+/=]+$/.test(uri))throw Error('GIF 格式验证失败');
  setAttachment({t:'gif',data:uri},'GIF 已准备 · '+Math.ceil(file.size/1024)+' KB');
 }catch(err){status(err.message);attachmentReset();}
});
$('photoInput').addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file)return;
 try{
  if(!file.type.startsWith('image/')||file.type==='image/svg+xml')throw Error('请选用照片文件');
  if(file.size>15*1024*1024)throw Error('图片超过15MB，建议先缩小');
  const blob=URL.createObjectURL(file);
  try{
   const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('无法读取图片'));img.src=blob;});
   let result='';
   for(const width of [960,780,600,480,360]){
    const ratio=Math.min(1,width/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    for(const quality of [.72,.58,.43]){result=canvas.toDataURL('image/jpeg',quality);if(result.length<160000)break;}
    if(result.length<160000)break;
   }
   if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(result)||result.length>=160000)throw Error('图片压缩失败，请选择更小的照片');
   setAttachment({t:'image',data:result},'照片已压缩 · 约 '+Math.round(result.length*.75/1024)+' KB');
  }finally{URL.revokeObjectURL(blob);}
 }catch(err){status(err.message);attachmentReset();}
});
$('message').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('composer').requestSubmit();}});
$('sound').addEventListener('click',async()=>{
 $('sound').disabled=true;try{await enableSound();}catch(e){status('网页提示音：'+e.message);}finally{$('sound').disabled=false;}
});
$('notify').addEventListener('click',async()=>{
 $('notify').disabled=true;
 try{await enablePush();}catch(e){status('开启提醒失败：'+e.message);}
 finally{$('notify').disabled=false;}
});
$('syncHistory').addEventListener('click',async()=>{
 $('syncHistory').disabled=true;
 try{
  status('正在为新设备安全补发历史消息的加密密钥，请保持页面开启…');
  const x=await shareVisibleHistory();
  const summary=x.shared?`已安全补发 ${x.messages} 条消息、${x.shared} 份设备密钥封装。`:'没有新的密钥封装需要补发。';
  const issues=x.failed||x.unreadable?` 另有 ${x.failed} 次共享失败、${x.unreadable} 条在本机无法解密；未删除或覆盖消息。`:'';
  status(summary+issues+' 本次最多检查最近80条；需要时可点「检查历史密钥覆盖」。');
  lastPaint='';await refresh();
 }catch(e){status('历史同步未完成：'+e.message);}
 finally{$('syncHistory').disabled=false;}
});
$('keyCoverage').addEventListener('click',async()=>{
 $('keyCoverage').disabled=true;
 try{status('正在安全检查历史消息密钥覆盖情况…');await showHistoryCoverage();}
 catch(e){status('历史密钥检查失败：'+e.message);}
 finally{$('keyCoverage').disabled=false;}
});
$('retrySync').addEventListener('click',async()=>{
 status('正在重新检查连接并同步最新消息…');lastPaint='';await refresh();
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
document.addEventListener('visibilitychange',()=>{
 syncSWChatReadiness();
 if(!document.hidden&&state.role){if(readQueue.size)markVisibleRead([...readQueue][0]);refresh();}
});
window.addEventListener('focus',syncSWChatReadiness);
window.addEventListener('blur',syncSWChatReadiness);
window.addEventListener('pagehide',()=>{
 try{navigator.serviceWorker?.controller?.postMessage({type:'ay-v2-chat-readiness',ready:false});}catch{}
});
window.addEventListener('offline',syncSWChatReadiness);
window.addEventListener('online',syncSWChatReadiness);
if('serviceWorker' in navigator){
 navigator.serviceWorker.addEventListener('controllerchange',syncSWChatReadiness);
 // Register an updated SW without asking for push permission or changing the subscription.
 navigator.serviceWorker.register('./sw.js?v=20261010-push-r13',{
   scope:'./',updateViaCache:'none'
 }).then(syncSWChatReadiness).catch(()=>{});
 setInterval(syncSWChatReadiness,10000);
}
try{const previous=localStorage.getItem('ay-secure-role-v1');if(previous==='Ko Ko'||previous==='Chit Chit'){setTimeout(()=>chooseRole(previous),200);}}catch{}
