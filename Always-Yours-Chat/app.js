'use strict';
// Official secure v2 private chat, cryptographic authentication enforced server-side. Keeps all identity + encryption private keys in origin-local IndexedDB.
const AUTH_BASE='https://zegjegutcigbydtzggur.supabase.co/functions/v1/always-yours-chat';
const API_BASE='https://zegjegutcigbydtzggur.supabase.co/functions/v1/always-yours-secure-v2';
const AUTH_DB='always-yours-identity-keys-v1',ENC_DB='always-yours-secure-encryption-v1';
const $=id=>document.getElementById(id),te=new TextEncoder(),td=new TextDecoder();
const state={role:null,identity:null,fp:null,session:null,expires:0,authPromise:null,authEpoch:0,encryption:null,keys:[],busy:false,timer:null,replyTo:null,editingId:null,editingIv:null,messageIvs:new Map(),attachment:null,decryptedMap:new Map(),pendingSend:null};
// R28: a visible page can suppress push notifications only after a recent, successful
// signed message sync. Local browser connectivity alone does not prove the chat is live.
let lastForegroundSync=0;
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
// R20: Coalesce concurrent logins. Sign each request with a stable session
// snapshot, and discard responses from an identity that has since been exited.
function resetAuthEpoch(){
 state.authEpoch++;
 state.authPromise=null;
 lastForegroundSync=0;
 if(refreshAbort)refreshAbort.abort();
 refreshQueued=false;
 syncSWChatReadiness();
 // A continuation must never cross a role, device, or authorization boundary.
 historyShareCursor=null;historySyncIssues.clear();
 const report=$('historySyncSummary');if(report){report.classList.add('hidden');report.open=false;}
}
async function login(force=false){
 if(!state.role||!state.identity||!state.fp)throw new Error('先选择已授权身份');
 if(!force&&state.session&&state.expires-Date.now()>60000)return;
 if(state.authPromise)return state.authPromise;
 const role=state.role,fp=state.fp,identity=state.identity,epoch=state.authEpoch;
 const current=()=>epoch===state.authEpoch&&role===state.role&&fp===state.fp&&identity===state.identity;
 const work=(async()=>{
  status('正在验证您已获授权的设备签名…');
  let c;
  try{c=await jsonFetch(AUTH_BASE+'/api/v2/device/challenge',{user_name:role,fingerprint:fp});}
  catch(e){
   if(current()&&/Device not approved|授权已撤销|设备未授权/i.test(String(e?.message||''))&&!$('chat').classList.contains('hidden'))lockRevokedDevice();
   throw e;
  }
  if(!current())throw new Error('已切换身份，旧登录已取消');
  if(!/^[a-f0-9-]{36}$/.test(c.challengeId||'')||!/^[A-Za-z0-9_-]{43}$/.test(c.challenge||''))throw new Error('挑战响应不正确');
  const payload=te.encode(['AY-V2-DEVICE-CHALLENGE',role,c.challengeId,c.challenge].join('\n'));
  const proof=b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},identity.privateKey,payload));
  if(!current())throw new Error('已切换身份，旧登录已取消');
  const x=await jsonFetch(AUTH_BASE+'/api/v2/device/verify',{user_name:role,challengeId:c.challengeId,signature:proof});
  if(!current())throw new Error('已切换身份，旧登录已取消');
  if(!x.deviceVerified||!x.accessToken||x.fingerprint!==fp)throw new Error('服务器未批准当前设备');
  state.session=x.accessToken;
  state.expires=Date.now()+Math.min(600,Number(x.expiresInSeconds)||600)*1000;
  syncSWChatReadiness();
 })();
 state.authPromise=work;
 try{await work;}
 finally{if(state.authPromise===work)state.authPromise=null;}
}
async function request(path,method='GET',payload=null,signal=null){
 await login();
 const role=state.role,fp=state.fp,identity=state.identity,token=state.session,epoch=state.authEpoch;
 if(!role||!fp||!identity?.privateKey||!token)throw new Error('安全会话已失效，请重新进入聊天');
 const url=API_BASE+path,body=payload===null?'':JSON.stringify(payload);
 const time=String(Date.now()),nonce=b64(crypto.getRandomValues(new Uint8Array(16)));
 const sessionHash=await digest('AY-DEVICE-SESSION-V1|'+token);
 const contentHash=await digest(body);
 const canonical=['AY-SECURE-V2-REQUEST',role,fp,sessionHash,method,path,time,nonce,contentHash];
 const signature=b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},identity.privateKey,te.encode(canonical.join('\n'))));
 if(epoch!==state.authEpoch||role!==state.role||fp!==state.fp||identity!==state.identity)
  throw new Error('身份已切换，请在当前页面重新操作');
 const r=await fetch(url,{method,cache:'no-store',...(signal?{signal}:{}),headers:{'Authorization':'Bearer '+token,'X-Device-Time':time,'X-Device-Nonce':nonce,'X-Device-Proof':signature,...(method==='GET'?{}:{'Content-Type':'application/json'})},...(method==='GET'?{}:{body})});
 const x=await r.json().catch(()=>({}));
 // R25: a delayed server response from a previous login cannot be consumed after logout or role switch.
 if(epoch!==state.authEpoch||role!==state.role||fp!==state.fp||identity!==state.identity)
  throw new Error('身份已切换，旧请求结果已丢弃');
 if(!r.ok){
  if(r.status===401&&state.session===token){state.session=null;state.expires=0;syncSWChatReadiness();}
  if(r.status===403&&epoch===state.authEpoch&&/此设备未授权|授权已撤销|Device not approved/i.test(String(x.error||'')))lockRevokedDevice();
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
// R22: paginated, resumable E2EE history-key sharing. The source device alone
// unwraps each content key. No plaintext/key material or continuation cursor is persisted.
// Process at most 240 source-visible messages per click, resuming on next click.
let historyShareCursor=null,historyShareRunning=false;
// R24: only message IDs and diagnostic kinds. No plaintext, ciphertext or private keys are stored.
const historySyncIssues=new Map();
const HISTORY_SHARE_BATCH=240;
function showHistorySyncReport(text){
 const panel=$('historySyncSummary'),label=$('historySyncSummaryText');
 if(!panel||!label)return;
 label.textContent=text;panel.classList.remove('hidden');panel.open=true;
}

function historyShareIdentityOK(role,fp,epoch){
 return state.role===role&&state.fp===fp&&state.authEpoch===epoch&&
  !!state.encryption&&!$('chat').classList.contains('hidden');
}
async function shareVisibleHistory(){
 if(historyShareRunning)throw new Error('历史密钥同步正在进行，请稍候');
 if(!state.role||!state.encryption||!state.fp||$('chat').classList.contains('hidden'))
  throw new Error('请先用已授权设备进入聊天');
 const role=state.role,fp=state.fp,epoch=state.authEpoch;
 const assertCurrent=()=>{
  if(!historyShareIdentityOK(role,fp,epoch))throw new Error('身份或授权状态已变化，密钥同步已停止');
 };
 historyShareRunning=true;
 let shared=0,messages=0,failed=0,unreadable=0,integrityFailures=0,checked=0,hasMore=false;
 let cursor=historyShareCursor?.role===role&&historyShareCursor?.fp===fp&&
  historyShareCursor?.epoch===epoch?historyShareCursor:null;
 try{
  const keys=await loadKeys();assertCurrent();
  if(!keys.length)throw new Error('当前没有可以共享的已批准设备加密公钥');
  while(checked<HISTORY_SHARE_BATCH){
   assertCurrent();
   const path=cursor?'/messages/older?before='+encodeURIComponent(cursor.before)+
     '&before_id='+encodeURIComponent(cursor.beforeId):'/messages';
   const data=await request(path);assertCurrent();
   const rows=data?.messages;
   if(!Array.isArray(rows)||rows.length>80||
       (cursor&&typeof data.hasMore!=='boolean'))throw new Error('服务器返回的历史分页不正确');
   if(!rows.length){hasMore=false;break;}
   hasMore=cursor?data.hasMore:rows.length===80;
   let interrupted=false;
   // Server pages are ascending, so traverse newest to oldest for a stable cursor.
   for(const m of [...rows].reverse()){
    assertCurrent();
    if(checked>=HISTORY_SHARE_BATCH){hasMore=true;interrupted=true;break;}
    if(typeof m.id!=='string'||typeof m.created_at!=='string'||
       typeof m.iv!=='string'||!m.envelopes?.[fp]){
     throw new Error('历史消息缺少必要的安全分页字段');
    }
    const absent=keys.filter(k=>!m.envelopes?.[k.fingerprint]);
    let perMessageFailed=false,anyShared=false;
    if(!absent.length){
      // Other approved devices may have already finished sharing this message.
      historySyncIssues.delete(m.id);
    }else{
      let contentBytes=null,sourceIssue=null;
      try{
        const ownEnv=m.envelopes[fp];
        const sourcePub=await crypto.subtle.importKey('jwk',ownEnv.ephemeralPublicKey||m.ephemeral_public_key,
          {name:'ECDH',namedCurve:'P-256'},false,[]);
        const oldWrap=await deriveWrap(state.encryption.privateKey,sourcePub,m.id,fp);
        contentBytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(ownEnv.iv),
          additionalData:te.encode('AY-WRAP|'+m.id+'|'+fp)},oldWrap,un64(ownEnv.ciphertext)));
        if(contentBytes.length!==32)throw new Error('密钥长度不正确');
      }catch(e){assertCurrent();sourceIssue='key';}
      // R24: unwrapping is NOT enough. Verify that the content key decrypts
      // the exact authenticated message before handing it to other devices.
      // Never store message plaintext or private keys in the diagnostic log.
      if(contentBytes&&!sourceIssue){
        try{
          const checkKey=await crypto.subtle.importKey('raw',contentBytes,'AES-GCM',false,['decrypt']);
          const plaintext=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(m.iv),
            additionalData:te.encode('AY-SAFE-TEXT-V1\n'+m.id)},checkKey,un64(m.ciphertext)));
          plaintext.fill(0);
        }catch(e){assertCurrent();sourceIssue='integrity';}
      }
      if(sourceIssue){
        if(contentBytes)contentBytes.fill(0);
        historySyncIssues.set(m.id,sourceIssue);
        unreadable++;
        if(sourceIssue==='integrity')integrityFailures++;
      }else if(contentBytes){
        historySyncIssues.delete(m.id);
        try{
          for(const k of absent){
            assertCurrent();
            try{
              const fresh=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
              const pubJwk=await crypto.subtle.exportKey('jwk',fresh.publicKey);
              const publicKey=await crypto.subtle.importKey('jwk',k.enc_public_key,
                {name:'ECDH',namedCurve:'P-256'},false,[]);
              const wrap=await deriveWrap(fresh.privateKey,publicKey,m.id,k.fingerprint);
              const wiv=crypto.getRandomValues(new Uint8Array(12));
              const encrypted=b64(await crypto.subtle.encrypt({name:'AES-GCM',iv:wiv,
                additionalData:te.encode('AY-WRAP|'+m.id+'|'+k.fingerprint)},wrap,contentBytes));
              assertCurrent();
              const result=await request('/messages/grant','POST',{
                id:m.id,expectedIv:m.iv,fingerprint:k.fingerprint,
                envelope:{iv:b64(wiv),ciphertext:encrypted,
                  ephemeralPublicKey:{kty:'EC',crv:'P-256',x:pubJwk.x,y:pubJwk.y}}
              });
              assertCurrent();
              if(result.shared){shared++;anyShared=true;}
              else if(!result.existing)throw new Error('历史密钥共享结果不明确');
            }catch(e){assertCurrent();failed++;perMessageFailed=true;}
          }
        }finally{contentBytes.fill(0);}
      }
    }
    if(anyShared)messages++;
    if(perMessageFailed){
     // Retry this same message on the next click. Successful grants are idempotent.
     hasMore=true;interrupted=true;break;
    }
    checked++;
    cursor={role,fp,epoch,before:m.created_at,beforeId:m.id};
    historyShareCursor=cursor;
   }
   if(interrupted)break;
   if(!hasMore)break;
   status('正在逐页同步历史密钥：已检查 '+checked+' 条，已补发 '+shared+' 份…');
  }
  if(!hasMore)historyShareCursor=null;
  return {shared,messages,failed,unreadable,integrityFailures,checked,hasMore,
    unresolved:historySyncIssues.size,
    unresolvedIntegrity:[...historySyncIssues.values()].filter(x=>x==='integrity').length,
    complete:!hasMore&&historySyncIssues.size===0,paused:hasMore,limit:HISTORY_SHARE_BATCH};
 }finally{
  historyShareRunning=false;
 }
}
async function showHistoryCoverage(){
 const x=await request('/history/status');
 if(!x.ok||!Number.isInteger(x.total)||!Number.isInteger(x.availableHere)||!Number.isInteger(x.noApprovedKey))
  throw new Error('历史密钥检查结果无效');
 const partial=x.truncated?'（仅检查最近1000条，非全部统计）':'';
 status(`近30天加密消息 ${x.total} 条${partial} · 本机持有密钥封装 ${x.availableHere} 条 · 当前所有已批准设备均无密钥封装 ${x.noApprovedKey} 条。`+
  (x.noApprovedKey?'这些记录只有曾获授权的旧设备可能协助恢复：原设备需重新申请获批、保留原本机私钥，再使用「同步新设备历史」。服务器不能替代设备解密。':'可以在拥有历史解密密钥的设备上选择「同步新设备历史」。'));
}
// R21: keep earlier encrypted history in memory only for this authorized chat session.
// No plaintext or private keys are persisted in localStorage/IndexedDB by pagination.
let visibleHistory=new Map(),olderHasMore=null,olderLoading=false;
function orderedHistory(){return [...visibleHistory.values()].sort((a,b)=>
 Date.parse(a.created_at)-Date.parse(b.created_at)||a.id.localeCompare(b.id));}
function historyButton(){
 if(!olderHasMore)return null;
 const b=document.createElement('button');b.type='button';b.id='loadOlder';
 b.className='outline';b.textContent=olderLoading?'正在加载更早消息…':'↑ 加载更早消息 ♡';
 b.disabled=olderLoading;
 b.style.cssText='align-self:center;flex:0 0 auto;min-height:36px;padding:8px 16px;font-size:12px;max-width:95%;margin:0 auto 4px';
 b.addEventListener('click',loadOlderHistory);return b;
}
async function loadOlderHistory(){
 if(olderLoading||refreshBusy||!state.role||!visibleHistory.size)return;
 const role=state.role,fp=state.fp,epoch=state.authEpoch;
 const oldest=orderedHistory()[0];if(!oldest)return;
 const btn=$('loadOlder');olderLoading=true;if(btn){btn.disabled=true;btn.textContent='正在加载更早消息…';}
 try{
  const path='/messages/older?before='+encodeURIComponent(oldest.created_at)+'&before_id='+encodeURIComponent(oldest.id);
  const response=await request(path);
  if(state.role!==role||state.fp!==fp||state.authEpoch!==epoch||$('chat').classList.contains('hidden'))return;
  if(!response.ok||!Array.isArray(response.messages)||typeof response.hasMore!=='boolean'||response.messages.length>80)
   throw new Error('历史消息分页结果不正确');
  let added=0;
  for(const msg of response.messages){
   if(typeof msg.id!=='string'||!msg.created_at||!msg.envelopes?.[fp])continue;
   if(!visibleHistory.has(msg.id))added++;
   visibleHistory.set(msg.id,msg);seenMessages.add(msg.id);
  }
  olderHasMore=response.hasMore;
  const box=$('messages'),oldScroll=box.scrollTop,oldHeight=box.scrollHeight;
  lastPaint='';await refresh();
  if(state.role===role&&state.fp===fp&&state.authEpoch===epoch){
   box.scrollTop=Math.max(0,oldScroll+box.scrollHeight-oldHeight);
   status(added?'已加载 '+added+' 条更早的加密消息 ♡':(olderHasMore?'继续点击加载更早消息':'已经查看到本机可解密的最早消息 ♡'));
  }
 }catch(e){if(state.role===role&&state.fp===fp&&state.authEpoch===epoch)status('加载更早消息失败：'+e.message+'，可稍后重试');}
 finally{olderLoading=false;const active=$('loadOlder');if(active){active.disabled=false;active.textContent='↑ 加载更早消息 ♡';}}
}
let lastPaint='',refreshBusy=false,refreshQueued=false,refreshAbort=null,haveSnapshot=false,seenMessages=new Set();
function markForegroundSynced(){
 if(document.hidden||!document.hasFocus())return;
 lastForegroundSync=Date.now();
 syncSWChatReadiness();
}
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
// R28: Foreground re-entry coalesces with an in-flight sync, and never
// announces readiness before a successful foreground message fetch.
function resumeForegroundChat(){
 lastForegroundSync=0;syncSWChatReadiness();
 if(!state.role||$('chat').classList.contains('hidden')||document.hidden)return;
 if(!navigator.onLine){status('网络尚未恢复，等待连接后同步。');return;}
 lastPaint='';
 if(readQueue.size)void markVisibleRead([...readQueue][0]);
 void refresh();
}
window.addEventListener('online',()=>{
 if(state.role&&!$('chat').classList.contains('hidden'))status('网络已恢复，正在重新同步消息…');
 resumeForegroundChat();
});
window.addEventListener('offline',()=>{
 lastForegroundSync=0;syncSWChatReadiness();
 if(refreshAbort)refreshAbort.abort();
 if(state.role&&!$('chat').classList.contains('hidden'))status('目前离线 · 暂时不能发送和同步。已输入的内容会保留在此页面。');
});
v2Broadcast?.addEventListener('message',e=>{if(e.data?.type==='changed'&&e.data?.role===state.role&&state.role)refresh();});
let notificationAudio=null,readObserver=null,readQueue=new Set(),readFlushBusy=false;
// This cannot delete plaintext/screenshots already retained by the browser or user. It locks this live view
// after server-side device revocation and does not delete local non-exportable private keys.
function clearPrivateView(){
 clearInterval(state.timer);state.timer=null;
 resetAuthEpoch();state.session=null;state.expires=0;state.encryption=null;state.keys=[];
 state.pendingSend=null;renderSendRecovery();state.busy=false;visibleHistory.clear();olderHasMore=null;olderLoading=false;state.decryptedMap.clear();state.messageIvs.clear();state.replyTo=null;state.editingId=null;state.editingIv=null;
 state.attachment=null;lastPaint='';haveSnapshot=false;seenMessages=new Set();newWhileAway=0;
 readQueue.clear();if(readObserver){readObserver.disconnect();readObserver=null;}
 $('send').disabled=false;$('send').textContent='发送 ♡';$('sendCheck').disabled=false;
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
  state.session&&state.expires>Date.now()&&navigator.onLine&&
  lastForegroundSync>0&&Date.now()-lastForegroundSync<20000&&!document.hidden&&
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
 const role=state.role,fp=state.fp,epoch=state.authEpoch;
 const current=()=>state.role===role&&state.fp===fp&&state.authEpoch===epoch&&
   !$('chat').classList.contains('hidden');
 readQueue.add(id);if(readFlushBusy)return;
 readFlushBusy=true;
 try{
  await new Promise(resolve=>setTimeout(resolve,250));
  while(readQueue.size&&!document.hidden&&current()){
   const ids=[...readQueue].slice(0,80);
   ids.forEach(v=>readQueue.delete(v));
   try{
    const x=await request('/messages/read','POST',{ids});
    if(!current())break;
    // Older pages are cached in memory; keep their read status in sync after ack.
    if(x.ok){const time=new Date().toISOString();for(const mid of ids){
      const m=visibleHistory.get(mid);
      if(m&&m.sender!==state.role&&!m.read_at)visibleHistory.set(mid,{...m,read_at:time});
    }}
    if(x.seen){lastPaint='';announceLocalChange();}
   }catch(e){
    // R25: never repopulate a newly logged-in identity with old message IDs.
    if(current())ids.forEach(v=>readQueue.add(v));
    if(current())console.warn('Read receipt not saved',e.message);
    break;
   }
  }
 }finally{
  readFlushBusy=false;
  if(!current()&&readQueue.size&&!document.hidden&&state.role&&
     !$('chat').classList.contains('hidden')){
    void markVisibleRead([...readQueue][0]);
  }
 }
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
 if(!state.role||document.hidden||$('chat').classList.contains('hidden'))return;
 if(refreshBusy){refreshQueued=true;return;}
 if(!navigator.onLine){lastForegroundSync=0;syncSWChatReadiness();status('目前离线 · 等待网络恢复后同步。');return;}
 refreshBusy=true;
 // Abort a stalled foreground GET without affecting writes, encryption or shared logins.
 const controller=new AbortController();refreshAbort=controller;
 const timeout=setTimeout(()=>controller.abort(),15000);
 const requestedRole=state.role,requestedFp=state.fp,requestedEpoch=state.authEpoch;
 const current=()=>requestedRole===state.role&&requestedFp===state.fp&&
   requestedEpoch===state.authEpoch&&!document.hidden&&
   !$('chat').classList.contains('hidden');
 try{
  const data=await request('/messages','GET',null,controller.signal);
  if(!current())return;
  // Device envelope changes (e.g. history-key share) must repaint, even if read/edit time is unchanged.
  if(!Array.isArray(data.messages))throw new Error('聊天同步数据格式不正确');
  const latest=data.messages;
  if(olderHasMore===null)olderHasMore=latest.length>=80;
  for(const msg of latest)visibleHistory.set(msg.id,msg);
  // Discard expired data; avoid retaining previously displayed plaintext beyond the 30-day window.
  const tooOld=Date.now()-30*24*60*60*1000;
  for(const [mid,m] of visibleHistory)if(!Number.isFinite(Date.parse(m.created_at))||Date.parse(m.created_at)<tooOld)visibleHistory.delete(mid);
  // Keep only the latest 500 messages per open tab to bound memory use.
  const full=orderedHistory();
  if(full.length>500){for(const msg of full.slice(0,full.length-500))visibleHistory.delete(msg.id);olderHasMore=false;}
  const arr=orderedHistory(),signature=JSON.stringify([olderHasMore,...arr.map(m=>[m.id,m.read_at,m.edited_at,m.envelopes?.[requestedFp]||null])]);
  // R19: snapshot message versions for optimistic edit concurrency control.
  state.messageIvs=new Map(arr.filter(m=>typeof m.id==='string'&&typeof m.iv==='string').map(m=>[m.id,m.iv]));
  if(signature===lastPaint){markForegroundSynced();return;}
  const incoming=arr.filter(m=>m.sender!==state.role&&haveSnapshot&&!seenMessages.has(m.id));
  for(const m of arr)seenMessages.add(m.id);
  if(incoming.length&&document.visibilityState==='visible')playHeartNote();
  haveSnapshot=true;
  // R25: decrypt locally first; publish nothing from a superseded identity.
  const parsed=[],decrypted=new Map();
  for(const m of arr){
   if(!current())return;
   let p;
   try{p=decodePayload(await decryptMessage(m));}
   catch{p={t:'text',body:'[本设备暂时无法解密这条消息]'};}
   if(!current())return;
   decrypted.set(m.id,p);parsed.push({m,p});
  }
  if(!current())return;
  state.decryptedMap=decrypted;
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
  const olderButton=historyButton();if(olderButton)elements.unshift(olderButton);
  const box=$('messages'),wasBottom=(box.scrollHeight-box.scrollTop-box.clientHeight)<150;
  if(!wasBottom)newWhileAway+=incoming.length;
  if(readObserver){readObserver.disconnect();readObserver=null;}
  box.replaceChildren(...elements);if(wasBottom)box.scrollTop=box.scrollHeight;
  updateJumpButton();
  box.querySelectorAll('[data-needs-read]').forEach(b=>observeRead(b,b.dataset.mid||b.closest('.messageRow')?.dataset.mid));
  lastPaint=signature;
  status('设备已授权 · 新消息保持端到端加密 · 单勾未读 / 双勾已读');
  markForegroundSynced();
  // Broadcast only actual writes, not every poll/render; avoids cross-tab repaint loops.
 }catch(e){if(current()){
   lastForegroundSync=0;syncSWChatReadiness();
   status(e?.name==='AbortError'?'连接超时，等待网络恢复后重新同步':'读取失败：'+e.message);
  }}
 finally{
  clearTimeout(timeout);if(refreshAbort===controller)refreshAbort=null;
  refreshBusy=false;
  if(refreshQueued){
    refreshQueued=false;
    if(state.role&&!document.hidden&&!$('chat').classList.contains('hidden'))
      queueMicrotask(()=>{void refresh();});
  }
 }
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
 resetAuthEpoch();state.role=null;state.identity=null;state.fp=null;state.session=null;
 $('gateStatus').textContent='选择身份后，将自动检查本机授权状态。';
 (lastApprovalFocus?.isConnected?lastApprovalFocus:document.querySelector('[data-role]'))?.focus({preventScroll:true});
}
async function chooseRole(role,apply=false){
 if(state.busy)return;
 const isSamePending=state.role===role&&!$('deviceApproval').classList.contains('hidden');
 state.busy=true;resetAuthEpoch();clearInterval(state.timer);state.session=null;state.encryption=null;state.role=role;syncSWChatReadiness();lastPaint='';haveSnapshot=false;seenMessages=new Set();visibleHistory.clear();olderHasMore=null;olderLoading=false;state.decryptedMap=new Map();state.pendingSend=null;renderSendRecovery();newWhileAway=0;readQueue.clear();
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
// R26: never infer success from a lost response or a bare 409 duplicate.
// The encrypted pending packet exists only in this tab's RAM: never in localStorage.
function sendContext(role,fp,epoch){
 return !!(role&&fp&&role===state.role&&fp===state.fp&&epoch===state.authEpoch&&
   !$('chat').classList.contains('hidden'));
}
function renderSendRecovery(){
 const panel=$('sendRecovery'),discard=$('sendDiscard');
 if(!panel)return;
 const p=state.pendingSend;
 panel.classList.toggle('hidden',!p||!p.uncertain);
 if(!p||!p.uncertain){if(discard){discard.dataset.confirm='';discard.textContent='放弃本机重试';}return;}
 $('sendRecoveryText').textContent=(p.kind==='edit'?'上次编辑':p.kind==='emoji'?'上次贴纸':'上次发送')+
  '尚未确认。请先核对状态；同一份草稿再点「发送」会复用原加密请求，不会创建新消息编号。';
}
function clearPendingPacket(p){
 if(state.pendingSend===p){state.pendingSend=null;renderSendRecovery();}
}
async function checkPendingPacket(p){
 // An emoji sticker is a normal encrypted message for server acknowledgement.
 // /messages/status accepts only send|edit, never the UI-only kind=emoji.
 const kind=p.kind==='edit'?'edit':'send';
 const path='/messages/status?kind='+encodeURIComponent(kind)+
   '&id='+encodeURIComponent(p.packet.id)+'&iv='+encodeURIComponent(p.packet.iv);
 return request(path);
}
function currentComposerRaw(){
 const body=$('message').value.trim();
 const data=state.editingId?{t:'text',body,replyTo:state.replyTo||null}:
   (state.attachment?{...state.attachment,body:body.slice(0,150),replyTo:state.replyTo||null}:
     {t:'text',body,replyTo:state.replyTo||null});
 return 'AYV2:'+JSON.stringify(data);
}
async function clearMatchingComposer(p){
 if(p.kind==='emoji')return;
 if((p.kind==='edit')!==!!state.editingId)return;
 if(p.kind==='edit'&&(p.packet.id!==state.editingId||p.packet.expectedIv!==state.editingIv))return;
 if((await digest(currentComposerRaw()))!==p.fingerprint)return;
 if(!sendContext(p.role,p.fp,p.epoch))return;
 $('message').value='';attachmentReset();clearComposerMode();
}
// An explicitly retried packet always has the same ID, IV and ciphertext.
// Even if the original request commits after a status check, the database UUID
// constraint makes a second POST harmless; a conflict is never trusted as success.
async function submitV2Safely(raw,kind='send',editId=null,expectedIv=null){
 const role=state.role,fp=state.fp,epoch=state.authEpoch;
 const current=()=>sendContext(role,fp,epoch);
 if(!current())throw Error('当前聊天身份已失效');
 const fingerprint=await digest(raw);
 if(!current())throw Error('身份已切换，发送已停止');
 let p=state.pendingSend;
 if(p&&!(p.role===role&&p.fp===fp&&p.epoch===epoch&&
   p.kind===kind&&p.fingerprint===fingerprint&&
   (kind!=='edit'||(p.packet.id===editId&&p.packet.expectedIv===expectedIv)))){
   // Resolve the previous request first. Do not quietly replace its pending ID.
   const ack=await checkPendingPacket(p);
   if(!current())throw Error('身份已切换，旧请求已丢弃');
   if(ack.confirmed){clearPendingPacket(p);throw Error('上次消息已确认保存；请再次点击发送当前内容');}
   p.uncertain=true;renderSendRecovery();
   throw Error('上次发送尚未确认。请先使用「检查上次发送」，或恢复原草稿重试');
 }
 if(!p){
   if(kind==='edit'&&!expectedIv)throw Error('消息版本标记失效，请刷新后重新编辑');
   const packet=await encryptMessage(raw,kind==='edit'?editId:null);
   if(!current())throw Error('身份已切换，未发送旧消息');
   p={kind,role,fp,epoch,fingerprint,packet:kind==='edit'?{...packet,expectedIv}:packet,
      attempts:0,uncertain:false};
   state.pendingSend=p;
 }
 const assertCurrent=()=>{
   if(!current()||state.pendingSend!==p)throw Error('身份已切换，旧发送结果已丢弃');
 };
 if(p.attempts>0){
   const found=await checkPendingPacket(p);
   assertCurrent();
   if(found.confirmed){clearPendingPacket(p);return {confirmed:true,recovered:true};}
   if(p.kind!=='edit'&&found.found)throw Error('消息编号对应不同加密内容，停止重试以防误判');
 }
 p.attempts++;
 try{await request(kind==='edit'?'/messages/edit':'/messages','POST',p.packet);}
 catch(err){
   assertCurrent();
   let verified=null;
   try{verified=await checkPendingPacket(p);}catch{}
   assertCurrent();
   if(verified?.confirmed){clearPendingPacket(p);return {confirmed:true,recovered:true};}
   p.uncertain=true;renderSendRecovery();
   if(kind!=='edit'&&verified?.found)
     throw Error('服务器发现同编号但加密版本不同，未作为发送成功处理');
   throw Error('服务器未确认保存，原加密消息已保留供安全重试（'+String(err?.message||'网络异常')+'）');
 }
 assertCurrent();clearPendingPacket(p);
 return {confirmed:true,recovered:false};
}

$('composer').addEventListener('submit',async e=>{
 e.preventDefault();if(state.busy||!state.role)return;
 const input=$('message'),message=input.value.trim(),editing=!!state.editingId;
 if(!message&&!state.attachment)return;
 if(editing&&!message){status('编辑消息不能为空');return;}
 const role=state.role,fp=state.fp,epoch=state.authEpoch;
 const active=()=>sendContext(role,fp,epoch);
 state.busy=true;$('send').disabled=true;
 $('send').textContent=editing?'保存中…':'发送中…';
 let confirmed=false;
 try{
   const raw=currentComposerRaw();
   const outcome=await submitV2Safely(raw,editing?'edit':'send',
     editing?state.editingId:null,editing?state.editingIv:null);
   if(!active())return;
   if(outcome.confirmed){
     confirmed=true;
     input.value='';attachmentReset();clearComposerMode();lastPaint='';announceLocalChange();
     status(outcome.recovered?'已核实服务器保存了上次的消息 ♡':'消息已安全保存 ♡');
   }
 }catch(err){
   if(active())status(String(err?.message||'发送状态尚未确认'));
 }finally{
   if(active()){
     state.busy=false;$('send').disabled=false;
     $('send').textContent=state.editingId?'保存 ♡':'发送 ♡';
   }
 }
 if(confirmed&&active()){
   try{await refresh();}catch{if(active())status('消息已经保存，聊天列表稍后会自动刷新');}
 }
});
$('sendCheck').addEventListener('click',async()=>{
 const p=state.pendingSend;
 if(!p||state.busy||!sendContext(p.role,p.fp,p.epoch))return;
 const active=()=>sendContext(p.role,p.fp,p.epoch)&&state.pendingSend===p;
 state.busy=true;$('sendCheck').disabled=true;
 try{
   const ack=await checkPendingPacket(p);
   if(!active())return;
   if(ack.confirmed){
     await clearMatchingComposer(p);
     if(!active())return;
     clearPendingPacket(p);lastPaint='';announceLocalChange();
     status('已确认上次'+(p.kind==='edit'?'编辑':p.kind==='emoji'?'贴纸':'消息')+'保存在服务器 ♡');
     await refresh();
   }else if(p.kind!=='edit'&&ack.found){
     status('消息编号被其他加密版本占用，不能认定发送成功');
   }else status('还未确认保存。保持原草稿，点击「发送」可安全重试同一编号');
 }catch(err){if(active())status('确认暂不可用：'+String(err?.message||'网络中断'));}
 finally{if(sendContext(p.role,p.fp,p.epoch)){state.busy=false;$('sendCheck').disabled=false;}}
});
$('sendDiscard').addEventListener('click',()=>{
 const p=state.pendingSend;if(!p||state.busy)return;
 const button=$('sendDiscard');
 if(button.dataset.confirm!=='yes'){
   button.dataset.confirm='yes';button.textContent='再次点击确认放弃';
   status('放弃只会清除本页面的重试记录，不能撤回可能已送达服务器的消息。');
   return;
 }
 clearPendingPacket(p);
 status('已放弃本页面继续重试；之前的请求可能已经送达，请先检查聊天记录以免重复发送。');
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
 if(state.busy||!state.role)return;
 const role=state.role,fp=state.fp,epoch=state.authEpoch;
 const active=()=>sendContext(role,fp,epoch);
 state.busy=true;
 let confirmed=false;
 try{
   const raw='AYV2:'+JSON.stringify({t:'emoji',body:text,replyTo:state.replyTo||null});
   const result=await submitV2Safely(raw,'emoji');
   if(!active())return;
   confirmed=!!result.confirmed;
   if(confirmed){clearComposerMode();lastPaint='';announceLocalChange();}
 }catch(e){if(active())status('心动贴纸状态未确认：'+String(e?.message||'网络故障'));}
 finally{if(active())state.busy=false;}
 if(confirmed&&active())try{await refresh();}catch{}
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
  const summary=x.shared?`本轮检查 ${x.checked} 条历史消息，已为 ${x.messages} 条消息补发 ${x.shared} 份设备密钥封装。`:
    `本轮已检查 ${x.checked} 条历史消息，没有新增密钥封装。`;
  const pending=x.failed?`有 ${x.failed} 次共享请求失败，已停在对应消息，下次点击会从失败处重试。` : '';
  const blocked=x.unresolved?`当前标签页累计发现 ${x.unresolved} 条尚无法由本机验证的历史消息（其中 ${x.unresolvedIntegrity} 条正文完整性验证失败），这些消息没有向新设备补发密钥。` : '';
  const remedy=x.unresolved?`请先在曾能正常打开这些消息、且仍持有原始加密私钥的设备上获批登录再同步。当前页面遍历完毕后，再次点击可以重新检查异常消息；服务器无法解密或恢复丢失的私钥。` : '';
  const next=x.paused?'还有更早的消息，或正在等待重新尝试失败请求；再次点击可继续。':
    (x.complete?'本机可安全处理的历史已检查完成。':'历史已遍历，但仍有无法恢复或验证的消息，并非全部同步成功。');
  showHistorySyncReport([summary,pending,blocked,next,remedy].filter(Boolean).join(' '));
  status(summary+(x.unreadable?` 本轮有 ${x.unreadable} 条无法验证。`:'')+(x.failed?` ${x.failed} 次共享失败。`:'')+' 可展开历史同步诊断查看处理建议。');
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
 if(document.hidden){
  lastForegroundSync=0;if(refreshAbort)refreshAbort.abort();
  syncSWChatReadiness();
 }else resumeForegroundChat();
});
window.addEventListener('focus',resumeForegroundChat);
window.addEventListener('blur',()=>{lastForegroundSync=0;syncSWChatReadiness();});
// iOS Safari may restore a page from BFCache without repeating a normal load.
window.addEventListener('pageshow',event=>{if(event.persisted)resumeForegroundChat();});
// R27: a pending encrypted packet is intentionally kept in RAM, not persisted.
// When a send is uncertain, warn before a desktop refresh/leave that would erase
// its original UUID and IV. Mobile browsers may ignore beforeunload prompts.
window.addEventListener('beforeunload',event=>{
 const p=state.pendingSend;
 if(!p?.uncertain||!sendContext(p.role,p.fp,p.epoch))return;
 event.preventDefault();
 event.returnValue='';
});
window.addEventListener('pagehide',()=>{
 lastForegroundSync=0;if(refreshAbort)refreshAbort.abort();
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
