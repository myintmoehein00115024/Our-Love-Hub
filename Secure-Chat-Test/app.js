'use strict';
// Secure v2 staging client. Keeps all identity + encryption private keys in origin-local IndexedDB.
const AUTH_BASE='https://zegjegutcigbydtzggur.supabase.co/functions/v1/always-yours-chat';
const API_BASE='https://zegjegutcigbydtzggur.supabase.co/functions/v1/always-yours-secure-v2';
const AUTH_DB='always-yours-identity-keys-v1',ENC_DB='always-yours-secure-encryption-v1';
const $=id=>document.getElementById(id),te=new TextEncoder(),td=new TextDecoder();
const state={role:null,identity:null,fp:null,session:null,expires:0,encryption:null,keys:[],busy:false,timer:null};
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
async function enrollIfNeeded(identity){
 const role=state.role;
 const nonce=b64(crypto.getRandomValues(new Uint8Array(16)));
 const signature=b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},identity.pair.privateKey,
     te.encode(['AY-DEVICE-ENROLL-V2',role,nonce].join('\n'))));
 const x=await jsonFetch(API_BASE+'/enroll',{user_name:role,publicKey:{kty:'EC',crv:'P-256',x:identity.pub.x,y:identity.pub.y},nonce,signature});
 if(x.fingerprint!==identity.fp)throw new Error('设备指纹校验失败');
 if(x.deviceState!=='approved')throw new Error('此设备尚未获批准，已提交授权申请。请在独立 Device-Approval 网页批准后，再选择 '+(role==='Ko Ko'?'HE':'SHE')+' 进入。\n设备指纹：'+identity.fp);
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
 const pathname=new URL(url).pathname+new URL(url).search;
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
 const ephemeral=await crypto.subtle.importKey('jwk',m.ephemeral_public_key,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const wrapping=await deriveWrap(state.encryption.privateKey,ephemeral,m.id,state.fp);
 const rawKey=await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(env.iv),additionalData:te.encode('AY-WRAP|'+m.id+'|'+state.fp)},wrapping,un64(env.ciphertext));
 const key=await crypto.subtle.importKey('raw',rawKey,'AES-GCM',false,['decrypt']);
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(m.iv),additionalData:te.encode('AY-SAFE-TEXT-V1\n'+m.id)},key,un64(m.ciphertext));
 return td.decode(plain);
}
let lastPaint='',refreshBusy=false;
async function refresh(){
 if(!state.role||refreshBusy||document.hidden)return;refreshBusy=true;
 try{
  const data=await request('/messages');
  const signature=JSON.stringify((data.messages||[]).map(m=>m.id));
  if(signature===lastPaint)return;
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
async function chooseRole(role){
 if(state.busy)return;state.busy=true;clearInterval(state.timer);state.session=null;state.encryption=null;state.role=role;lastPaint='';
 try{
  status('正在寻找本机已有的设备身份…');
  const data=await findSigningIdentity(role);
  state.identity=data.pair;state.fp=data.fp;
  await enrollIfNeeded(data);await login();await setupEncryption();
  try{localStorage.setItem('ay-secure-role-v1',role);}catch{}
  $('gate').classList.add('hidden');$('chat').classList.remove('hidden');$('who').textContent=(role==='Ko Ko'?'HE · Ko Ko':'SHE · Chit Chit')+' · 已验证设备';
  $('messages').replaceChildren();await refresh();state.timer=setInterval(refresh,10000);
 }catch(e){$('chat').classList.add('hidden');$('gate').classList.remove('hidden');state.role=null;status('无法进入安全聊天：'+e.message+'\n请检查您是否在同一浏览器里已获设备批准。');}
 finally{state.busy=false;if(state.role)refresh();}
}
document.querySelectorAll('[data-role]').forEach(b=>b.addEventListener('click',()=>chooseRole(b.dataset.role)));
$('exit').addEventListener('click',()=>{try{localStorage.removeItem('ay-secure-role-v1');}catch{}clearInterval(state.timer);state.role=null;state.session=null;state.identity=null;state.encryption=null;$('chat').classList.add('hidden');$('gate').classList.remove('hidden');$('gateStatus').textContent='请选择此设备已经批准的身份。';});
$('composer').addEventListener('submit',async e=>{
 e.preventDefault();if(state.busy||!state.role)return;const input=$('message'),message=input.value.trim();if(!message)return;
 state.busy=true;$('send').disabled=true;try{const payload=await encryptMessage(message);await request('/messages','POST',payload);input.value='';lastPaint='';await refresh();}catch(err){status('发送失败：'+err.message);}finally{state.busy=false;$('send').disabled=false;refresh();}
});
$('message').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('composer').requestSubmit();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.role)refresh();});
try{const previous=localStorage.getItem('ay-secure-role-v1');if(previous==='Ko Ko'||previous==='Chit Chit'){setTimeout(()=>chooseRole(previous),200);}}catch{}
