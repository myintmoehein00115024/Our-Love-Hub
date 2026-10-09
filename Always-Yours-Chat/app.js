// Supabase Edge Function URL is public. The chat encryption key remains on each device.
const WORKER_URL_KEY="alwaysYoursSupabaseFunctionUrlV1";
function validWorkerUrl(raw){
  try{
    const parsed=new URL(String(raw||"").trim());
    if(parsed.protocol!=="https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.port) return null;
    if(!/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname))return null;
    if(!/^\/functions\/v1\/always-yours-chat\/?$/.test(parsed.pathname))return null;
    return parsed.origin+parsed.pathname.replace(/\/$/,"");
  }catch{return null;}
}
// Initialize this new, dedicated chat backend once, even if the browser cached
// a previous Cloudflare/old Supabase connection. Later user overrides still persist.
const DEFAULT_CHAT_API = validWorkerUrl(window.ALWAYS_YOURS_CHAT_ROUTES?.apiBase);
const INITIALIZED_API_KEY="alwaysYoursChatProjectZegjegutcigbydtzggurInitializedV1";
let savedWorkerUrl=null;
try{
  if(DEFAULT_CHAT_API && localStorage.getItem(INITIALIZED_API_KEY)!=="yes"){
    localStorage.setItem(WORKER_URL_KEY,DEFAULT_CHAT_API);
    localStorage.setItem(INITIALIZED_API_KEY,"yes");
  }
  savedWorkerUrl=localStorage.getItem(WORKER_URL_KEY);
}catch{}
let API_BASE = validWorkerUrl(savedWorkerUrl) || DEFAULT_CHAT_API;
const API_TIMEOUT_MS = 9000;
const POLL_MS = 10000;
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30-day rolling retention
const ROOM_SALT = "always-yours-room-v2";
const KEY_SALT = "always-yours-e2ee-v2";
const MAX_VISIBLE_MESSAGES = 80;
const CACHE_PREFIX = "alwaysYoursMessageCache:";
const STICKERS = ["🥰","😘","🫶","💞","🌙","💋","🩷","🤍","抱抱 ♡","想你了 ♡","晚安 🌙","永远是你 💞"];
const EMOJIS = ["😊","🥰","😘","😍","🫶","💕","💗","💖","💞","💋","🌹","🌙","✨","🥺","🤍","❤️‍🔥","🩷","😚","😌","💐"];

const $ = (id) => document.getElementById(id);
const gate = $("gate");
const chat = $("chat");
const secretInput = $("secret");
const statusEl = $("status");
const messagesEl = $("messages");
const emptyState = $("emptyState");
const input = $("messageInput");
const sendBtn = $("sendBtn");
const toastEl = $("toast");
const connectionState = $("connectionState");
const stickerPanel = $("stickerPanel");
const photoBtn = $("photoBtn");
const photoInput = $("photoInput");
const gifBtn = $("gifBtn");
const gifInput = $("gifInput");
const replyPreview = $("replyPreview");
const replyPreviewLabel = $("replyPreviewLabel");
const replyPreviewText = $("replyPreviewText");
const photoPreview = $("photoPreview");
const photoPreviewImg = $("photoPreviewImg");
const photoPreviewName = $("photoPreviewName");
const photoPreviewMeta = $("photoPreviewMeta");
const removePhotoBtn = $("removePhotoBtn");
const installBtn = $("installBtn");
const newMessageHint = $("newMessageHint");
const selectedPerson = $("selectedPerson");
const gateInstallBtn = $("gateInstallBtn");
const installModal = $("installModal");
const installSteps = $("installSteps");
const installLead = $("installLead");
const installAction = $("installAction");
const closeInstall = $("closeInstall");
const installButtons = [installBtn, gateInstallBtn].filter(Boolean);
const emojiPanel = $("emojiPanel");

const chatHeader = document.querySelector(".chat-header > div:first-child");
const roomLabelEl = $("roomLabel");
let presenceEl = null;
let editBar = null;

function ensurePresenceUi(){
  if(!chatHeader || presenceEl) return;
  presenceEl=document.createElement("div");
  presenceEl.id="partnerPresence";
  presenceEl.className="partner-presence is-away";
  presenceEl.innerHTML='<span class="presence-dot" aria-hidden="true"></span><span class="presence-text">Chit Chit · checking…</span>';
  (roomLabelEl || chatHeader).insertAdjacentElement("afterend",presenceEl);
}
function ensureEditBar(){
  if(editBar || !document.querySelector(".composer-wrap")) return;
  editBar=document.createElement("div");
  editBar.id="editBar";
  editBar.className="edit-bar hidden";
  editBar.innerHTML='<div class="edit-bar-copy"><span class="edit-bar-icon">✎</span><div><strong>正在编辑消息</strong><span id="editBarText"></span></div></div><button type="button" id="cancelEditBtn" class="edit-cancel">取消</button>';
  document.querySelector(".composer-wrap").insertBefore(editBar,document.querySelector(".composer-wrap").firstElementChild);
  editBar.querySelector("#cancelEditBtn").addEventListener("click",cancelEdit);
}
ensurePresenceUi();
ensureEditBar();

let selectedName = "Ko Ko";
let roleChosen = false;
let rememberedRole = null;
try {
  const remembered = localStorage.getItem("alwaysYoursName");
  if(remembered === "Ko Ko" || remembered === "Chit Chit") {
    selectedName = remembered;
    rememberedRole = remembered;
  }
} catch {}
const DEVICE_DB = "always-yours-private-device-v1";
function openDeviceDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DEVICE_DB,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains("secrets"))req.result.createObjectStore("secrets");};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function deviceRecord(mode,record){
  const db=await openDeviceDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("secrets",mode==="get"?"readonly":"readwrite");
    const store=tx.objectStore("secrets");
    const req=mode==="get"?store.get("room"):mode==="delete"?store.delete("room"):store.put(record,"room");
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
    tx.oncomplete=()=>db.close();
  });
}
async function deviceCredentials(){try{const v=await deviceRecord("get");return v?.key&&/^[a-f0-9]{40}$/.test(v?.room)?v:null;}catch{return null;}}
function revealSetup(msg=""){ $("setup").classList.remove("hidden"); if(msg)setStatus(msg); secretInput.focus(); }
async function openPreparedRoom(){
  if(!roomId||!cryptoKey||!validRole(selectedName))return;
  lastMessageIds="";firstSync=true;
  const cached=await loadCache();
  showChat();
  $("roomLabel").textContent=`${selectedName === "Ko Ko" ? "HE · Ko Ko" : "SHE · Chit Chit"} ♡`;
  if(cached.length)renderMessages(cached);
  updateConnection("连接中…");
  startPolling();startPresence();refreshNotifyButton().catch(()=>{});
}
function validRole(name){return name==="Ko Ko"||name==="Chit Chit";}
async function chooseRole(name){
  if(!validRole(name))return;
  const previousRole = roleChosen ? selectedName : null;
  selectedName=name;roleChosen=true;
  if (previousRole && previousRole!==name) {
    try { localStorage.removeItem("alwaysYoursPushRegistration"); } catch {}
  }
  try{localStorage.setItem("alwaysYoursName",selectedName);}catch{}
  document.querySelectorAll(".name-option").forEach(b=>b.classList.toggle("selected-role",b.dataset.name===name));
  syncNameChoice();setStatus("");
  const stored=await deviceCredentials();
  if(stored){roomId=stored.room;cryptoKey=stored.key;$("setup").classList.add("hidden");await openPreparedRoom();}
  else revealSetup("首次使用，请输入一次你们共同保存的独立聊天加密密钥，以后只需选择 HE / SHE。您不需要输入生日。");
}

let roomId = null;
let cryptoKey = null;
let deferredInstallPrompt = null;
let pollTimer = null;
let syncing = false;
let lastMessageIds = "";
let lastRenderedCount = 0;
let firstSync = true;
let draftTimer = null;
let selectedPhotoFile = null;
let selectedPhotoPreviewUrl = null;
const mediaObjectUrls = new Set();
let editingMessageId = null;
let editingMessageReply = null;
let replyingTo = null;
let presenceTimer = null;
let presenceSyncBusy = false;
const readMarkedIds = new Set();

function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove("show"), 2300);
}
function setStatus(msg){ statusEl.textContent = msg; }
function updateConnection(msg){ connectionState.textContent = msg; }
function bytesToBase64(bytes){
  let s="";
  const a=new Uint8Array(bytes);
  for(let i=0;i<a.length;i+=0x8000) s+=String.fromCharCode(...a.subarray(i,i+0x8000));
  return btoa(s);
}
function base64ToBytes(s){
  const bin=atob(s); const out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
  return out;
}
async function sha256Hex(text){
  const b=new TextEncoder().encode(text);
  const h=await crypto.subtle.digest("SHA-256", b);
  return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function deriveKey(secret){
  const raw=await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {name:"PBKDF2", salt:new TextEncoder().encode(KEY_SALT), iterations:150000, hash:"SHA-256"},
    raw,
    {name:"AES-GCM", length:256},
    false,
    ["encrypt","decrypt"]
  );
}
async function encryptPayload(payload){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const plaintext=new TextEncoder().encode(JSON.stringify(payload));
  const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},cryptoKey,plaintext);
  return {iv:bytesToBase64(iv), ciphertext:bytesToBase64(cipher)};
}
async function decryptPayload(ivB64,cipherB64){
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:base64ToBytes(ivB64)},cryptoKey,base64ToBytes(cipherB64));
  return JSON.parse(new TextDecoder().decode(plain));
}
function sanitizeSecret(v){ return v.trim().replace(/\s+/g," "); }
function formatTime(value){
  const d=new Date(Number(value)||Date.now());
  return new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(d);
}
function formatSeenTime(value){ return new Intl.DateTimeFormat(undefined,{hour:"2-digit",minute:"2-digit"}).format(new Date(Number(value)||Date.now())); }

function showChat(){ gate.classList.add("hidden"); chat.classList.remove("hidden"); ensurePresenceUi(); ensureEditBar(); }
function showGate(){
  roleChosen=false;
  document.querySelectorAll(".name-option").forEach(b=>b.classList.remove("selected-role"));
  messagesEl.replaceChildren();
  emptyState.classList.remove("hidden");
  lastMessageIds="";lastRenderedCount=0;firstSync=true;
  readMarkedIds.clear();
  for(const url of mediaObjectUrls){try{URL.revokeObjectURL(url)}catch{}}
  mediaObjectUrls.clear();
  clearBackendIssue();
  chat.classList.add("hidden");
  gate.classList.remove("hidden");
  stopPolling();
  stopPresence();
  cancelEdit();
  clearReply();
  input.value="";
}
function otherUser(name){return name==="Ko Ko"?"Chit Chit":"Ko Ko";}
function userIsMine(sender){ return sender===selectedName; }
function renderSticker(text){ const d=document.createElement("div"); d.className="sticker-message"; d.textContent=text; return d; }

function cacheKey(){ return `${CACHE_PREFIX}${roomId}`; }
// Offline copies are encrypted as well. Remove legacy plaintext caches when encountered.
async function saveCache(items){
  if(!cryptoKey||!roomId)return;
  const key=cacheKey();
  try{
    const packet=await encryptPayload({items:items.slice(-MAX_VISIBLE_MESSAGES)});
    localStorage.setItem(key,JSON.stringify({version:2,...packet}));
  }catch{}
}
async function loadCache(){
  try{
    const key=cacheKey(),value=JSON.parse(localStorage.getItem(key)||"null");
    if(!value)return [];
    if(value.version!==2||!value.iv||!value.ciphertext){localStorage.removeItem(key);return [];}
    const packet=await decryptPayload(value.iv,value.ciphertext);
    const now=Date.now();
    return Array.isArray(packet.items)?packet.items.filter(m=>Number(m.expires_at||0)>now):[];
  }catch{return []}
}

function dayKey(value){ const d=new Date(Number(value)||Date.now()); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; }
function dayLabel(value){ const d=new Date(Number(value)||Date.now()); const now=new Date(); if(dayKey(d.getTime())===dayKey(now.getTime())) return "Today"; const y=new Date(now); y.setDate(now.getDate()-1); if(dayKey(d.getTime())===dayKey(y.getTime())) return "Yesterday"; return new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric"}).format(d); }
function expiryLabel(ts){
  const remain=Math.max(0,Number(ts||0)-Date.now());
  if(!remain) return "30 天保存期已结束";
  const days=Math.ceil(remain/(24*60*60*1000));
  if(days>1) return `剩余 ${days} 天`;
  const h=Math.ceil(remain/(60*60*1000));
  return h>1?`剩余 ${h} 小时`:`将在 1 小时内清理`;
}
function showNewHint(){ if(!newMessageHint) return; newMessageHint.classList.remove("hidden"); clearTimeout(showNewHint._t); showNewHint._t=setTimeout(()=>newMessageHint.classList.add("hidden"),2200); }
function renderMessages(items){
  for(const url of mediaObjectUrls){ try{URL.revokeObjectURL(url)}catch{} }
  mediaObjectUrls.clear();
  messagesEl.innerHTML="";
  if(!items.length){ emptyState.classList.remove("hidden"); return; }
  emptyState.classList.add("hidden");
  let previousDay="";
  for(const item of items){
    const currentDay=dayKey(item.created_at);
    if(currentDay!==previousDay){
      const divider=document.createElement("div"); divider.className="date-divider"; divider.textContent=dayLabel(item.created_at); messagesEl.appendChild(divider); previousDay=currentDay;
    }
    const mine=userIsMine(item.sender);
    const row=document.createElement("div");
    row.className=`message-row ${mine?"mine":"theirs"}`;
    if(item.kind==="image") row.classList.add("photo-row");
    if(item.kind==="sticker") row.classList.add("sticker-row");
    const bubble=document.createElement("div"); bubble.className="message-bubble";
    if(item.kind==="image") bubble.classList.add("photo-bubble");
    if(item.kind==="sticker") bubble.classList.add("sticker-bubble");
    const sender=document.createElement("div"); sender.className="sender"; sender.textContent=mine?"我 · "+(selectedName==="Ko Ko"?"HE":"SHE"):(item.sender==="Ko Ko"?"HE":"SHE");
    bubble.appendChild(sender);
    if(item.reply){
      const quote=document.createElement("button");
      quote.type="button"; quote.className="message-reply-quote";
      quote.setAttribute("aria-label","跳转到引用的消息");
      const who=document.createElement("strong");who.textContent=(item.reply.sender==="Ko Ko"?"HE":"SHE")+" · 回复";
      const snippet=document.createElement("span");snippet.textContent=String(item.reply.text||"消息").slice(0,120);
      quote.append(who,snippet);
      quote.addEventListener("click",()=>{
        const match=[...messagesEl.querySelectorAll("[data-chat-message-id]")].find(el=>el.dataset.chatMessageId===item.reply.id);
        if(match){match.scrollIntoView({block:"center",behavior:"smooth"});match.classList.add("highlight-replied");setTimeout(()=>match.classList.remove("highlight-replied"),1300);}
        else toast("这条引用的消息不在当前列表中 ♡");
      });
      bubble.appendChild(quote);
    }
    if(item.kind==="sticker") bubble.appendChild(renderSticker(item.text));
    else if(item.kind==="image"){
      const media=document.createElement("div"); media.className="image-message";
      hydrateImageMessage(media,item);
      bubble.appendChild(media);
    } else {
      const t=document.createElement("div"); t.className="message-text"; t.textContent=item.text; bubble.appendChild(t);

    }
    const meta=document.createElement("div"); meta.className="message-meta-row";
    const tm=document.createElement("div"); tm.className="message-time"; tm.textContent=formatTime(item.created_at); meta.appendChild(tm);
    if(item.edited_at){ const ed=document.createElement("span"); ed.className="message-edited"; ed.textContent="edited"; meta.appendChild(ed); }
    const age=document.createElement("span"); age.className="message-age"; age.textContent=expiryLabel(item.expires_at); meta.appendChild(age);
    bubble.appendChild(meta);
    const actions=document.createElement("div");actions.className="message-actions enhanced-message-actions";
    const replyBtn=document.createElement("button");replyBtn.type="button";replyBtn.className="message-reply-button";
    replyBtn.textContent="↩ 回复";replyBtn.setAttribute("aria-label", "回复"+(mine?"自己":"对方")+"的消息");
    replyBtn.addEventListener("click",()=>beginReply(item));actions.appendChild(replyBtn);
    if(mine&&item.kind==="text"){
      const editBtn=document.createElement("button");editBtn.type="button";editBtn.className="message-edit-button";
      editBtn.textContent="✎ 编辑";editBtn.setAttribute("aria-label","编辑这条消息");
      editBtn.addEventListener("click",()=>beginEdit(item));actions.appendChild(editBtn);
    }
    bubble.appendChild(actions);
    if(mine){
      const read=document.createElement("div"); read.className=`message-read-status ${item.seen_at?"is-seen":"is-sent"}`;
      read.textContent=item.seen_at?`Seen ♡ · ${formatSeenTime(item.seen_at)}`:"Sent · waiting to be seen";
      bubble.appendChild(read);
    }
    row.dataset.chatMessageId=item.id;
    row.appendChild(bubble); messagesEl.appendChild(row);
  }
  requestAnimationFrame(()=>{ messagesEl.scrollTop = messagesEl.scrollHeight; });
}

async function withTimeout(promise){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), API_TIMEOUT_MS);
  try{ return await promise(controller.signal); } finally { clearTimeout(timer); }
}

function showBackendIssue(error){
  const banner=$("chatNetworkBanner");
  if(!banner)return;
  const problem=String(error?.message||"").slice(0,120);
  $("networkBannerText").textContent=/fetch|network|abort|load failed|failed/i.test(problem)?
    "云端暂时连接失败。当前消息未送达；请检查 Supabase Edge Function 地址、部署和网络。":
    `聊天服务提示：${problem||"未连接"}。请检查 Supabase 部署。`;
  banner.classList.remove("hidden");
  chat.classList.add("has-network-issue");
}
function clearBackendIssue(){ $("chatNetworkBanner")?.classList.add("hidden");chat.classList.remove("has-network-issue"); }
async function checkWorkerURL(raw,save){
  const url=validWorkerUrl(raw);
  if(!url)throw new Error("请输入 Supabase Edge Function 完整地址：https://项目ID.supabase.co/functions/v1/always-yours-chat");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8000);
  try{
    const res=await fetch(`${url}/api/health`,{mode:"cors",cache:"no-store",signal:controller.signal});
    const payload=await res.json().catch(()=>null);
    if(!res.ok||!payload?.ok||payload.service!=="always-yours-chat-api")throw new Error("Supabase 函数未就绪：请检查数据库和私有图片存储。");
    if(!payload.photos)throw new Error("Supabase 私有图片存储桶尚未配置。");
    if(save){API_BASE=url;localStorage.setItem(WORKER_URL_KEY,url);}
    return "连接检测通过：Supabase 聊天服务已就绪。";
  }catch(error){
    if(error?.name==="AbortError"||error instanceof TypeError)throw new Error("无法访问 Supabase：请确认 Edge Function 已部署、URL 正确且允许 GitHub 域名访问。");
    throw error;
  }finally{clearTimeout(timer);}
}
const workerUrlInput=$("workerUrlInput");
if(workerUrlInput)workerUrlInput.value=API_BASE||"";
$("testWorkerBtn")?.addEventListener("click",async()=>{
  const btn=$("testWorkerBtn"),label=$("workerTestResult");
  btn.disabled=true;label.textContent="正在检测 Supabase 连接…";
  try{label.textContent=await checkWorkerURL(workerUrlInput.value,true);label.classList.add("is-success");clearBackendIssue();}
  catch(error){label.textContent=error.message;label.classList.remove("is-success");}
  finally{btn.disabled=false;}
});
$("networkSettingsBtn")?.addEventListener("click",()=>{
  showGate();roomId=null;cryptoKey=null;
  // Connection is preconfigured in routes.js. No user-visible URL form.
  setStatus("连接已预设。如果无法连接，请稍后重试。");
});
async function apiGetMessages(){
  if(!API_BASE)throw new Error("尚未配置 Supabase 服务地址，请在入口的连接设置中填写 Edge Function URL。");
  return withTimeout(async(signal)=>{
    const res=await fetch(`${API_BASE}/api/messages`,{method:"GET",headers:{"X-Room-Key":roomId},signal,cache:"no-store"});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||"Could not read messages");
    return data.messages||[];
  });
}

async function apiSendMessage(payload){
  if(!API_BASE)throw new Error("尚未配置 Supabase 服务地址，消息未发送。");
  return withTimeout(async(signal)=>{
    const res=await fetch(`${API_BASE}/api/messages`,{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Room-Key":roomId},
      body:JSON.stringify(payload),
      signal,
      cache:"no-store"
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||"Could not send message");
    return data;
  });
}

async function apiEditMessage(id,payload){
  return withTimeout(async(signal)=>{
    const res=await fetch(`${API_BASE}/api/messages/${encodeURIComponent(id)}`,{
      method:"PATCH",
      headers:{"Content-Type":"application/json","X-Room-Key":roomId,"X-User":selectedName},
      body:JSON.stringify(payload),
      signal,
      cache:"no-store"
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||"Could not edit message");
    return data;
  });
}

async function apiMarkRead(ids){
  const list=[...new Set(ids||[])].slice(0,MAX_VISIBLE_MESSAGES);
  if(!list.length || !roomId) return;
  return withTimeout(async(signal)=>{
    const res=await fetch(`${API_BASE}/api/read`,{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Room-Key":roomId,"X-User":selectedName},
      body:JSON.stringify({ids:list}),
      signal,
      cache:"no-store"
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||"Could not mark messages as seen");
    return data;
  });
}

async function apiPresence(online=true){
  return withTimeout(async(signal)=>{
    const res=await fetch(`${API_BASE}/api/presence`,{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Room-Key":roomId,"X-User":selectedName},
      body:JSON.stringify({online}),
      signal,
      cache:"no-store",
      keepalive:!online
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||"Could not update presence");
    return data;
  });
}

async function apiGetPresence(){
  return withTimeout(async(signal)=>{
    const res=await fetch(`${API_BASE}/api/presence`,{method:"GET",headers:{"X-Room-Key":roomId},signal,cache:"no-store"});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||"Could not read presence");
    return data;
  });
}



async function apiUploadMedia(encryptedBuffer, mediaKey){
  if(!API_BASE)throw new Error("尚未配置 Supabase 服务地址，照片未上传。");
  return withTimeout(async(signal)=>{
    const res=await fetch(`${API_BASE}/api/media`,{
      method:"POST",
      headers:{"Content-Type":"application/octet-stream","X-Room-Key":roomId,"X-Media-Key":mediaKey},
      body:encryptedBuffer,
      signal,
      cache:"no-store"
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||"Could not upload photo");
    return data;
  });
}

async function apiGetMedia(mediaKey){
  return withTimeout(async(signal)=>{
    const res=await fetch(`${API_BASE}/api/media?key=${encodeURIComponent(mediaKey)}`,{
      method:"GET",
      headers:{"X-Room-Key":roomId},
      signal,
      cache:"no-store"
    });
    if(!res.ok) throw new Error("Photo is no longer available.");
    return await res.arrayBuffer();
  });
}

async function encryptBinary(buffer){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},cryptoKey,buffer);
  return {iv:bytesToBase64(iv),ciphertext:cipher};
}

// Strip image metadata, resize large mobile photos and prefer compact WebP/JPEG.
// Output is encrypted before it ever reaches Supabase Storage.
async function compressImage(file){
  if(file.type==="image/gif" || /\.gif$/i.test(file.name||"")){
    if(file.size>2*1024*1024)throw new Error("GIF 最大支持 2 MB，请选择较小的动图。");
    // Re-encoding with canvas would destroy animation; preserve GIF bytes and encrypt them directly.
    const magic=new Uint8Array(await file.slice(0,6).arrayBuffer());
    const sig=String.fromCharCode(...magic);
    if(sig!=="GIF87a"&&sig!=="GIF89a")throw new Error("所选文件不是有效的 GIF 动图。");
    return new File([file],`our-gif-${Date.now()}.gif`,{type:"image/gif"});
  }
  const MAX_ORIGINAL = 25 * 1024 * 1024;
  const TARGET = 750 * 1024;
  const MAX_OUTPUT = 1250 * 1024;
  if(file.size > MAX_ORIGINAL) throw new Error("请选择小于 25 MB 的照片。");
  if(!file.type.startsWith("image/")) throw new Error("请先选择一张照片。");
  // Safari fallback for devices without createImageBitmap or with unsupported HEIC decoding.
  let bitmap, release=()=>{};
  if(typeof createImageBitmap==="function") {
    try { bitmap=await createImageBitmap(file,{imageOrientation:"from-image"}); }
    catch { try { bitmap=await createImageBitmap(file); } catch {} }
  }
  if(bitmap) release=()=>bitmap.close();
  else {
    const tempUrl=URL.createObjectURL(file);
    try {
      bitmap=await new Promise((resolve,reject)=>{
        const image=new Image();
        image.onload=()=>resolve(image);
        image.onerror=()=>reject(new Error("无法读取这张照片，请改用 JPG 或 PNG。"));
        image.src=tempUrl;
      });
    } finally { URL.revokeObjectURL(tempUrl); }
  }
  const sourceWidth=bitmap.naturalWidth||bitmap.width, sourceHeight=bitmap.naturalHeight||bitmap.height;
  const canvas=document.createElement("canvas");
  const ctx=canvas.getContext("2d",{alpha:false});
  if(!ctx){release();throw new Error("当前设备不支持图片压缩。");}
  const preferred = "image/webp";
  let edge=1600, blob=null, mime=preferred;
  try {
    for(let pass=0;pass<5;pass++) {
      const scale=Math.min(1,edge/Math.max(sourceWidth,sourceHeight));
      canvas.width=Math.max(1,Math.round(sourceWidth*scale));
      canvas.height=Math.max(1,Math.round(sourceHeight*scale));
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      for(const quality of [.82,.70,.58,.47]) {
        let next=await new Promise(r=>canvas.toBlob(r,mime,quality));
        if(!next || next.type!==mime) {
          mime="image/jpeg";
          next=await new Promise(r=>canvas.toBlob(r,mime,quality));
        }
        if(next && (!blob || next.size < blob.size)) blob=next;
        if(blob && blob.size<=TARGET) break;
      }
      if(blob && blob.size<=TARGET) break;
      edge=Math.max(720,Math.round(edge*.79));
    }
  } finally { release(); canvas.width=0; canvas.height=0; }
  if(!blob || blob.size > MAX_OUTPUT) throw new Error("照片仍然太大，请选择较小的图片。");
  const ext=blob.type==="image/jpeg"?"jpg":"webp";
  return new File([blob],`our-memory-${Date.now()}.${ext}`,{type:blob.type||mime});
}

function clearSelectedPhoto(){
  if(selectedPhotoPreviewUrl){ URL.revokeObjectURL(selectedPhotoPreviewUrl); selectedPhotoPreviewUrl=null; }
  selectedPhotoFile=null;
  if(photoPreviewImg) photoPreviewImg.removeAttribute("src");
  photoPreview?.classList.add("hidden");
  if(photoInput) photoInput.value="";
  if(gifInput) gifInput.value="";
  if(input) input.placeholder="想和 TA 说些什么…";
  updateSendButton();
}

function updateSendButton(){
  if(!sendBtn) return;
  const hasText=Boolean(input?.value.trim());
  const hasPhoto=Boolean(selectedPhotoFile);
  sendBtn.textContent=hasPhoto?(selectedPhotoFile.type==="image/gif"?"发送 GIF ♡":"发送照片 ♡"):(editingMessageId?"保存修改 ♡":(replyingTo?"回复 ♡":"发送 ♡"));
  sendBtn.disabled=!hasText && !hasPhoto;
}

async function choosePhoto(file){
  if(editingMessageId) cancelEdit();
  if(!file || (!file.type.startsWith("image/")&&!/\.gif$/i.test(file.name||""))) return;
  try{
    const prepared=await compressImage(file);
    if(selectedPhotoPreviewUrl) URL.revokeObjectURL(selectedPhotoPreviewUrl);
    selectedPhotoFile=prepared;
    selectedPhotoPreviewUrl=URL.createObjectURL(prepared);
    photoPreviewImg.src=selectedPhotoPreviewUrl;
    photoPreviewName.textContent=file.name;
    const beforeKB=Math.round(file.size/1024);
    const afterKB=Math.max(1,Math.round(prepared.size/1024));
    const saved=file.size>0?Math.max(0,Math.round((1-prepared.size/file.size)*100)):0;
    photoPreviewMeta.textContent=prepared.type==="image/gif"?
      `GIF 动画保留 · ${afterKB} KB · 端到端加密 · 30 天保存`:
      `已压缩 ${beforeKB} KB → ${afterKB} KB · 节省 ${saved}% · 发送前加密`;
    photoPreview.classList.remove("hidden");
    input.placeholder=prepared.type==="image/gif"?"为 GIF 留一句话…":"给照片加一句话…";
    input.focus();
    updateSendButton();
  }catch(error){
    console.error(error);
    toast(error.message||"无法处理这张图片或 GIF。");
    clearSelectedPhoto();
  }
}

async function savePhotoBlob(blob,mime,name){
  const ext=mime.includes("gif")?"gif":mime.includes("png")?"png":mime.includes("jpeg")||mime.includes("jpg")?"jpg":"webp";
  const safeName=(name||`always-yours-${Date.now()}.${ext}`).replace(/[^a-zA-Z0-9._-]+/g,"-");
  const file=new File([blob],safeName,{type:mime||blob.type||"image/webp"});
  try{
    if(navigator.share && navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({title:"Always Yours ♡",text:"A little memory for us.",files:[file]});
      toast("Choose Save Image / Save to Photos ♡");
      return;
    }
  }catch(error){
    if(error?.name==="AbortError") return;
  }
  const url=URL.createObjectURL(blob);
  mediaObjectUrls.add(url);
  const a=document.createElement("a");
  a.href=url; a.download=safeName; a.rel="noopener";
  document.body.appendChild(a); a.click(); a.remove();
  toast("Photo saved to your downloads ♡");
  setTimeout(()=>{URL.revokeObjectURL(url);mediaObjectUrls.delete(url)},1500);
}

async function hydrateImageMessage(container,item){
  const loading=document.createElement("div"); loading.className="image-loading"; loading.textContent="Opening our little memory…";
  container.appendChild(loading);
  try{
    const encrypted=await apiGetMedia(item.media_key);
    const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:base64ToBytes(item.image_iv)},cryptoKey,encrypted);
    const blob=new Blob([plain],{type:item.mime||"image/webp"});
    const url=URL.createObjectURL(blob); mediaObjectUrls.add(url);
    loading.remove();
    const frame=document.createElement("div"); frame.className="image-frame";
    const img=document.createElement("img"); img.className="message-image"; img.alt=item.mime==="image/gif"?"动画 GIF":"收到的照片"; img.loading="lazy"; img.src=url;
    img.addEventListener("click",()=>openPhotoViewer({url,blob,name:item.name||"always-yours-photo.webp",mime:item.mime||"image/webp"}));
    frame.appendChild(img); container.appendChild(frame);
    if(item.text){ const cap=document.createElement("div"); cap.className="image-caption"; cap.textContent=item.text; container.appendChild(cap); }
    const actions=document.createElement("div"); actions.className="image-actions";
    const save=document.createElement("button"); save.type="button"; save.className="image-action-button"; save.textContent="Save to Photos / Gallery ♡";
    save.addEventListener("click",()=>savePhotoBlob(blob,item.mime||"image/webp",item.name)); actions.appendChild(save);
    container.appendChild(actions);
  }catch(error){
    loading.className="image-error"; loading.textContent="This photo has expired or is no longer available. ♡";
  }
}

async function decodeItems(raw){
  const out=[];
  for(const item of raw){
    if(Number(item.expires_at||0)<=Date.now()) continue;
    try{
      const payload=await decryptPayload(item.iv,item.ciphertext);
      out.push({
        id:item.id,
        sender:item.sender,
        created_at:item.created_at,
        expires_at:item.expires_at,
        edited_at:Number(item.edited_at||0) || 0,
        seen_at:Number(item.seen_at||0) || 0,
        kind:payload.kind,
        text:payload.text || "",
        media_key:payload.mediaKey || item.media_key || "",
        image_iv:payload.imageIv || "",
        mime:payload.mime || "image/webp",
        name:payload.name || "always-yours-photo.webp",
        reply:payload.reply && typeof payload.reply==="object" && /^[a-f0-9-]{36}$/i.test(payload.reply.id||"") ? {
          id:payload.reply.id, sender:payload.reply.sender==="Ko Ko"?"Ko Ko":"Chit Chit",
          kind:String(payload.reply.kind||"text"),text:String(payload.reply.text||"").slice(0,120)
        }:null
      });
    }catch{}
  }
  return out.slice(-MAX_VISIBLE_MESSAGES);
}


async function markVisibleMessagesRead(items){
  if(!roomId || !items?.length) return;
  const unreadIds=items.filter(item=>!userIsMine(item.sender) && !readMarkedIds.has(item.id)).map(item=>item.id);
  if(!unreadIds.length) return;
  try{
    await apiMarkRead(unreadIds);
    unreadIds.forEach(id=>readMarkedIds.add(id));
  }catch{}
}

function renderPresenceStatus(data){
  ensurePresenceUi();
  if(!presenceEl) return;
  const partner=otherUser(selectedName);
  const record=data?.presence?.[partner];
  const online=Boolean(record?.online);
  const text=online ? `${partner} · Online now` : (record?.last_seen ? `${partner} · ${lastSeenLabel(record.last_seen)}` : `${partner} · not online yet`);
  presenceEl.classList.toggle("is-online",online);
  presenceEl.classList.toggle("is-away",!online);
  const textEl=presenceEl.querySelector(".presence-text");
  if(textEl) textEl.textContent=text;
}
function lastSeenLabel(value){
  const diff=Math.max(0,Date.now()-Number(value||0));
  if(diff<60000) return "just now";
  const mins=Math.floor(diff/60000);
  if(mins<60) return `last seen ${mins}m ago`;
  const hours=Math.floor(mins/60);
  if(hours<24) return `last seen ${hours}h ago`;
  return `last seen ${Math.floor(hours/24)}d ago`;
}
async function syncPresence(){
  if(!roomId || presenceSyncBusy || document.visibilityState==="hidden") return;
  presenceSyncBusy=true;
  try{ renderPresenceStatus(await apiGetPresence()); }catch{} finally{ presenceSyncBusy=false; }
}
function startPresence(){
  stopPresence();
  apiPresence(true).catch(()=>{});
  syncPresence();
  presenceTimer=setInterval(()=>{
    if(document.visibilityState==="hidden") return;
    apiPresence(true).catch(()=>{});
    syncPresence();
  },30000);
}
function stopPresence(){ if(presenceTimer){clearInterval(presenceTimer);presenceTimer=null;} }

async function syncMessages({silent=false}={}){
  if(!roomId || !cryptoKey || syncing) return;
  syncing=true;
  try{
    const raw=await apiGetMessages();
    const items=await decodeItems(raw);
    const ids=items.map(x=>`${x.id}:${x.edited_at||0}:${x.seen_at||0}`).join("|");
    const changed=ids!==lastMessageIds;
    lastMessageIds=ids;
    if (changed && 'BroadcastChannel' in window) {
      const channel = new BroadcastChannel('always-yours-chat-events');
      channel.postMessage({type:'messages-updated'});
      channel.close();
    }
    saveCache(items);
    if(changed || !messagesEl.children.length) renderMessages(items);
    markVisibleMessagesRead(items);
    syncPresence();
    updateConnection("已连接 · 已同步");
    clearBackendIssue();
    if(!firstSync && changed && items.length>lastRenderedCount){ showNewHint(); }
    firstSync=false;
    lastRenderedCount=items.length;
  }catch(error){
    const cached=await loadCache();
    if(cached.length && !messagesEl.children.length) renderMessages(cached);
    updateConnection(navigator.onLine?"服务器未连接":"离线 · 最近消息仅在本机");
    showBackendIssue(error);
    if(!silent && navigator.onLine) toast("聊天服务器未连接，请检查连接设置。");
  }finally{
    syncing=false;
  }
}

function startPolling(){
  stopPolling();
  syncMessages({silent:true});
  pollTimer=setInterval(()=>{ if(document.visibilityState!=="hidden") syncMessages({silent:true}); }, POLL_MS);
}
function stopPolling(){ if(pollTimer){clearInterval(pollTimer);pollTimer=null;} }

async function connectRoom(secret){
  if(!roleChosen||!validRole(selectedName)){setStatus("请先选择 HE 或 SHE。");return;}
  secret=sanitizeSecret(secret);
  if(secret.length<10){setStatus("共同密钥至少需要 10 个字符。");return;}
  setStatus("正在安全保存设备连接…");
  try{
    const id=(await sha256Hex(`${ROOM_SALT}:${secret}`)).slice(0,40);
    const key=await deriveKey(secret);
    await deviceRecord("put",{room:id,key}); // Non-extractable WebCrypto key, no raw passphrase stored.
    roomId=id;cryptoKey=key;secretInput.value="";
    $("setup").classList.add("hidden");openPreparedRoom();
  }catch(error){console.error(error);setStatus("设备保存失败。请开启浏览器存储后重试。");}
}

function replySummary(item){
  const preview=item.kind==="image"?(item.mime==="image/gif"?"🎞️ GIF 动图":"📷 照片")+(item.text?" · "+item.text:"") : String(item.text||"消息");
  return {id:item.id,sender:item.sender,kind:item.kind,text:preview.slice(0,120)};
}
function clearReply(){
  replyingTo=null;
  replyPreview?.classList.add("hidden");
  updateSendButton();
}
function beginReply(item){
  if(!item||!item.id)return;
  if(editingMessageId)cancelEdit();
  replyingTo=replySummary(item);
  if(replyPreviewLabel)replyPreviewLabel.textContent=`↩ 回复 ${item.sender==="Ko Ko"?"HE · Ko Ko":"SHE · Chit Chit"}`;
  if(replyPreviewText)replyPreviewText.textContent=replyingTo.text;
  replyPreview?.classList.remove("hidden");
  input.placeholder="写下你的回复…";
  input.focus();
  requestAnimationFrame(()=>document.querySelector(".composer-wrap")?.scrollIntoView({behavior:"smooth",block:"end"}));
}
$("cancelReplyBtn")?.addEventListener("click",clearReply);

function beginEdit(item){
  if(!item || item.kind!=="text" || !userIsMine(item.sender)) return;
  clearReply();
  editingMessageId=item.id;
  editingMessageReply=item.reply||null;
  ensureEditBar();
  input.value=item.text||"";
  input.style.height="auto";
  input.style.height=Math.min(input.scrollHeight,130)+"px";
  if(editBar){
    editBar.classList.remove("hidden");
    const label=editBar.querySelector("#editBarText");
    if(label) label.textContent=(item.text||"").slice(0,80);
  }
  sendBtn.textContent="保存修改 ♡";
  sendBtn.disabled=!String(input.value||"").trim();
  input.placeholder="编辑这条消息…";
  input.focus();
  requestAnimationFrame(()=>{ document.querySelector(".composer-wrap")?.scrollIntoView({behavior:"smooth",block:"end"}); });
}
function cancelEdit(){
  editingMessageId=null;
  editingMessageReply=null;
  if(editBar) editBar.classList.add("hidden");
  if(input) input.placeholder="想和 TA 说些什么…";
  updateSendButton();
}
async function editMessage(){
  const id=editingMessageId;
  const text=String(input.value||"").trim();
  if(!id) return sendMessage();
  if(!text){ toast("An edited message cannot be empty."); return; }
  if(text.length>2000){ toast("Message is too long."); return; }
  sendBtn.disabled=true;
  try{
    const encrypted=await encryptPayload({kind:"text",text,reply:editingMessageReply||undefined});
    await apiEditMessage(id,encrypted);
    cancelEdit();
    input.value="";
    input.style.height="auto";
    try{localStorage.removeItem("alwaysYoursDraft")}catch{}
    await syncMessages({silent:true});
    toast("Message updated ♡");
  }catch(error){
    console.error(error);
    toast(error.message||"Could not edit message.");
  }finally{
    updateSendButton();
    input.focus();
  }
}

async function sendMessage(kind="text", value=input.value){
  const textValue=String(value||"").trim();
  const hasPhoto=Boolean(selectedPhotoFile);
  if(!roomId || !cryptoKey || !validRole(selectedName) || (!textValue && !hasPhoto)) return;
  if(textValue.length>2000){ toast("Message is too long."); return; }
  sendBtn.disabled=true;
  try{
    if(hasPhoto){
      const arrayBuffer=await selectedPhotoFile.arrayBuffer();
      const encryptedImage=await encryptBinary(arrayBuffer);
      const mediaKey=`${roomId}/${crypto.randomUUID()}.bin`;
      setStatus("Sending our little photo…");
      await apiUploadMedia(encryptedImage.ciphertext,mediaKey);
      const encryptedMessage=await encryptPayload({
        kind:"image",
        reply:replyingTo||undefined,
        text:textValue,
        mediaKey,
        imageIv:encryptedImage.iv,
        mime:selectedPhotoFile.type||"image/webp",
        name:selectedPhotoFile.name||"always-yours-photo.webp"
      });
      await apiSendMessage({id:crypto.randomUUID(),sender:selectedName,media_key:mediaKey,...encryptedMessage});
      clearSelectedPhoto();
    }else{
      const encrypted=await encryptPayload({kind,text:textValue,reply:replyingTo||undefined});
      await apiSendMessage({id:crypto.randomUUID(),sender:selectedName,...encrypted});
      input.value="";
      input.style.height="auto";
      try{localStorage.removeItem("alwaysYoursDraft")}catch{}
    }
    clearReply();
    stickerPanel.classList.add("hidden");
    if(emojiPanel) emojiPanel.classList.add("hidden");
    $("stickerBtn")?.setAttribute("aria-expanded","false");
    $("emojiBtn")?.setAttribute("aria-expanded","false");
    setStatus("");
    clearBackendIssue();
    await syncMessages({silent:true});
  }catch(error){
    console.error(error);
    toast(navigator.onLine?(error.message||"Could not send right now."):"You're offline · try again when connected.");
    updateConnection("未送达 · 请检查连接");
    showBackendIssue(error);
  }finally{
    updateSendButton();
    input.focus();
  }
}

function syncNameChoice(){
  document.querySelectorAll(".name-option").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.name===selectedName)));
  if(selectedPerson)selectedPerson.textContent=`${selectedName=== "Ko Ko" ? "HE" : "SHE"} 已选择`;
}
for(const btn of document.querySelectorAll(".name-option"))btn.addEventListener("click",()=>chooseRole(btn.dataset.name));
syncNameChoice();
$("toggleSecret").addEventListener("click",()=>{
  const show=secretInput.type==="password";secretInput.type=show?"text":"password";
  $("toggleSecret").textContent=show?"隐藏":"显示";
  $("toggleSecret").setAttribute("aria-label",show?"隐藏密钥":"显示密钥");
});
$("enterBtn").addEventListener("click",()=>connectRoom(secretInput.value));
secretInput.addEventListener("keydown",e=>{if(e.key==="Enter")connectRoom(secretInput.value);});
$("changeSecretBtn").addEventListener("click",()=>{showGate();roomId=null;cryptoKey=null;setStatus("");$("setup").classList.add("hidden");});
$("resetDeviceBtn").addEventListener("click",async()=>{
  if(!confirm("要重新配置这台设备吗？此操作不会删除云端消息，但需要再次输入之前的共同密钥。"))return;
  await deviceRecord("delete");roomId=null;cryptoKey=null;
  revealSetup("请重新输入之前的共同密钥。");
});
sendBtn.addEventListener("click",()=>editingMessageId?editMessage():sendMessage());
photoBtn?.addEventListener("click",()=>photoInput?.click());
gifBtn?.addEventListener("click",()=>gifInput?.click());
gifInput?.addEventListener("change",()=>{const file=gifInput.files?.[0];if(file)choosePhoto(file);});
photoInput?.addEventListener("change",()=>{ const file=photoInput.files?.[0]; if(file) choosePhoto(file); });
removePhotoBtn?.addEventListener("click",clearSelectedPhoto);
updateSendButton();
input.addEventListener("input",()=>{ input.style.height="auto"; input.style.height=Math.min(input.scrollHeight,130)+"px"; updateSendButton(); });
input.addEventListener("keydown",e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); editingMessageId?editMessage():sendMessage(); } });
// Previous versions cached plaintext drafts. Do not persist unencrypted new drafts.
try{localStorage.removeItem("alwaysYoursDraft");}catch{}

function buildStickerPanel(){
  stickerPanel.innerHTML="";
  const head=document.createElement("div");
  head.className="picker-head";
  head.innerHTML='<div><span class="picker-overline">JUST FOR US ♡</span><strong>心动小贴纸</strong><small>点一下，把爱意送给 TA</small></div>';
  const close=document.createElement("button");
  close.type="button";close.className="picker-close";close.textContent="×";close.setAttribute("aria-label","关闭贴纸面板");
  close.addEventListener("click",()=>{stickerPanel.classList.add("hidden");$("stickerBtn").setAttribute("aria-expanded","false");});
  head.appendChild(close);stickerPanel.appendChild(head);
  const makeTitle=(title)=>{const el=document.createElement("div");el.className="picker-section-label";el.textContent=title;stickerPanel.appendChild(el);};
  const iconGrid=document.createElement("div");iconGrid.className="sticker-grid compact-sticker-grid";
  const wordsGrid=document.createElement("div");wordsGrid.className="sticker-words-grid";
  for(const s of STICKERS){
    const isWord=/[\u3400-\u9fff]/.test(s);
    const b=document.createElement("button");
    b.type="button";b.className=isWord?"sticker-word":"sticker compact-sticker";
    b.textContent=s;
    b.title=`发送 ${s}`;b.setAttribute("aria-label",`发送 ${s}`);
    b.addEventListener("click",()=>sendMessage("sticker",s));
    (isWord?wordsGrid:iconGrid).appendChild(b);
  }
  makeTitle("心动表情");stickerPanel.appendChild(iconGrid);
  makeTitle("暖心短句");stickerPanel.appendChild(wordsGrid);
}
buildStickerPanel();

function buildEmojiPanel(){
  if(!emojiPanel) return;
  const groups={
    "常用": EMOJIS,
    "心情": ["😊","🥰","😘","😍","🫶","🥺","😚","😌","🤭","☺️","😇","🤗","😋","😉"],
    "爱意": ["🫶","💕","💗","💖","💞","💋","🌹","💘","🩷","🤍","❤️‍🔥","💐","💓","💝"],
    "温柔": ["🌙","✨","🥺","🤍","🩷","💗","💞","🌷","🌸","🪽","☁️","⭐","💫","🫧"]
  };
  let current="常用";
  const render=()=>{
    emojiPanel.innerHTML="";
    const head=document.createElement("div");
    head.className="emoji-panel-head";
    head.innerHTML='<div><span class="picker-overline">LITTLE FEELINGS ♡</span><strong>挑一个心情</strong><small>让每一句话更可爱</small></div>';
    const close=document.createElement('button');close.type='button';close.className='picker-close';close.textContent='×';close.setAttribute('aria-label','关闭表情面板');
    close.addEventListener('click',()=>{emojiPanel.classList.add('hidden');$('emojiBtn').setAttribute('aria-expanded','false');});
    head.appendChild(close);
    emojiPanel.appendChild(head);
    const tabs=document.createElement("div");
    tabs.className="emoji-tabs";
    Object.keys(groups).forEach(name=>{
      const tab=document.createElement("button");
      tab.type="button"; tab.className="emoji-tab"; tab.textContent=name;
      tab.setAttribute("aria-selected",String(name===current));
      tab.addEventListener("click",(event)=>{event.preventDefault();event.stopPropagation();current=name;render();});
      tabs.appendChild(tab);
    });
    emojiPanel.appendChild(tabs);
    const grid=document.createElement("div"); grid.className="emoji-grid";
    groups[current].forEach(e=>{
      const b=document.createElement("button");
      b.type="button"; b.className="emoji-choice"; b.textContent=e; b.title=`Use ${e}`;
      b.addEventListener("click",(event)=>{event.preventDefault();event.stopPropagation();input.value += e;input.focus();updateSendButton();});
      grid.appendChild(b);
    });
    emojiPanel.appendChild(grid);
    const foot=document.createElement("div");
    foot.className="emoji-panel-foot"; foot.textContent="轻点表情加入文字，再按发送 ♡";
    emojiPanel.appendChild(foot);
  };
  render();
}
buildEmojiPanel();

function ensurePhotoViewer(){
  if(document.getElementById("photoViewer")) return document.getElementById("photoViewer");
  const modal=document.createElement("div");
  modal.id="photoViewer"; modal.className="photo-viewer hidden"; modal.setAttribute("aria-hidden","true");
  modal.innerHTML=`
    <div class="photo-viewer-backdrop" data-photo-close="1"></div>
    <div class="photo-viewer-sheet" role="dialog" aria-modal="true" aria-label="Photo viewer">
      <div class="photo-viewer-topbar">
        <div class="photo-viewer-title"><span class="photo-viewer-heart">♡</span><span id="photoViewerName">Our little memory</span></div>
        <button type="button" class="photo-viewer-close" id="photoViewerClose" aria-label="Back to chat">Back to chat</button>
      </div>
      <div class="photo-viewer-stage" id="photoViewerStage">
        <img id="photoViewerImg" alt="Shared photo">
      </div>
      <div class="photo-viewer-controls">
        <button type="button" class="viewer-tool" id="photoZoomOut" aria-label="Zoom out">−</button>
        <button type="button" class="viewer-zoom" id="photoZoomReset" aria-label="Reset zoom">100%</button>
        <button type="button" class="viewer-tool" id="photoZoomIn" aria-label="Zoom in">+</button>
        <button type="button" class="viewer-tool viewer-save" id="photoViewerSave">Save ♡</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  let scale=1, state=null;
  const img=modal.querySelector("#photoViewerImg");
  const stage=modal.querySelector("#photoViewerStage");
  const label=modal.querySelector("#photoViewerName");
  const zoomLabel=modal.querySelector("#photoZoomReset");
  const applyScale=()=>{scale=Math.min(3.5,Math.max(.5,scale)); img.style.transform=`scale(${scale})`; zoomLabel.textContent=`${Math.round(scale*100)}%`;};
  const close=()=>{modal.classList.add("hidden");modal.setAttribute("aria-hidden","true");document.body.classList.remove("photo-viewer-open");img.style.transform="scale(1)";scale=1;state=null;};
  window.__alwaysYoursPhotoViewer={open(next){
    state=next; scale=1; applyScale(); img.src=next.url; img.alt=next.name||"Shared photo"; label.textContent=next.name||"Our little memory";
    modal.classList.remove("hidden"); modal.setAttribute("aria-hidden","false"); document.body.classList.add("photo-viewer-open");
  },close};
  modal.querySelector("#photoViewerClose").addEventListener("click",close);
  modal.querySelector("[data-photo-close]").addEventListener("click",close);
  modal.querySelector("#photoZoomOut").addEventListener("click",()=>{scale-=.25;applyScale();});
  modal.querySelector("#photoZoomIn").addEventListener("click",()=>{scale+=.25;applyScale();});
  modal.querySelector("#photoZoomReset").addEventListener("click",()=>{scale=1;applyScale();});
  modal.querySelector("#photoViewerSave").addEventListener("click",()=>{if(state) savePhotoBlob(state.blob,state.mime,state.name);});
  stage.addEventListener("wheel",e=>{if(modal.classList.contains("hidden"))return;e.preventDefault();scale += e.deltaY<0?.15:-.15;applyScale();},{passive:false});
  img.addEventListener("dblclick",()=>{scale=scale>1?1:2;applyScale();});
  document.addEventListener("keydown",e=>{
    if(modal.classList.contains("hidden")) return;
    if(e.key==="Escape" || e.key==="Backspace"){e.preventDefault();close();}
    if(e.key==="+"){scale+=.25;applyScale();}
    if(e.key==="-"){scale-=.25;applyScale();}
    if(e.key==="0"){scale=1;applyScale();}
  });
  return modal;
}
function openPhotoViewer(data){ ensurePhotoViewer(); window.__alwaysYoursPhotoViewer?.open(data); }

$("emojiBtn").addEventListener("click",()=>{ const open=emojiPanel.classList.toggle("hidden"); stickerPanel.classList.add("hidden"); $("emojiBtn").setAttribute("aria-expanded",String(!open)); $("stickerBtn").setAttribute("aria-expanded","false"); });
$("stickerBtn").addEventListener("click",()=>{ const open=stickerPanel.classList.toggle("hidden"); emojiPanel.classList.add("hidden"); $("stickerBtn").setAttribute("aria-expanded",String(!open)); $("emojiBtn").setAttribute("aria-expanded","false"); });

document.addEventListener("click",e=>{
  const target=e.target;
  if(emojiPanel && !emojiPanel.classList.contains("hidden") && !emojiPanel.contains(target) && target!==$("emojiBtn")){emojiPanel.classList.add("hidden");$("emojiBtn").setAttribute("aria-expanded","false");}
  if(stickerPanel && !stickerPanel.classList.contains("hidden") && !stickerPanel.contains(target) && target!==$("stickerBtn")){stickerPanel.classList.add("hidden");$("stickerBtn").setAttribute("aria-expanded","false");}
});

function isStandalone(){
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function deviceType(){
  const ua=navigator.userAgent||"";
  const iPad = /iPad/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const iPhone = /iPhone|iPod/i.test(ua);
  const android = /Android/i.test(ua);
  if(iPad) return "ipad";
  if(iPhone) return "ios";
  if(android) return "android";
  return /Macintosh/i.test(ua) ? "mac" : "desktop";
}
function openInstallModal(){
  if (!installModal) return;
  installModal.querySelector("h3").textContent = "安装 Our Love Hub ♡";
  installLead.textContent = "整个网站只有一个桌面入口。请从 Our Love Hub 总首页添加到主屏幕，避免单独安装 Chat。";
  installSteps.innerHTML = '<div class="install-step"><span class="install-step-num">1</span><div class="install-step-text"><strong>打开总首页</strong><span>点击下方按钮进入 Our Love Hub。</span></div></div><div class="install-step"><span class="install-step-num">2</span><div class="install-step-text"><strong>添加到主屏幕</strong><span>iPhone：在 Safari 点分享 → 添加到主屏幕。其他浏览器选择安装应用。</span></div></div>';
  installAction.textContent = "前往 Our Love Hub 总首页 ↗";
  installAction.classList.remove("hidden");
  installModal.classList.remove("hidden");
  document.body.classList.add("install-open");
}
function closeInstallModal(){
  installModal?.classList.add("hidden");
  document.body.classList.remove("install-open");
}
function refreshInstallButtons(){
  const installed=isStandalone();
  for(const b of installButtons) b?.classList.toggle("hidden", installed);
}
// All install actions use the root hub, not a separate chat PWA.
window.addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); deferredInstallPrompt=null; });
function hubInstallUrl(){ return new URL('../', location.href).href; }
for(const button of installButtons) button?.addEventListener('click',openInstallModal);
closeInstall?.addEventListener('click',closeInstallModal);
installModal?.addEventListener('click',e=>{ if(e.target.dataset.closeInstall!==undefined) closeInstallModal(); });
installAction?.addEventListener('click',()=>{ window.location.assign(hubInstallUrl()); });
window.addEventListener("load",refreshInstallButtons);

window.addEventListener("online",()=>{ updateConnection("Back online · syncing…"); syncMessages({silent:true}); });
window.addEventListener("offline",()=>updateConnection("Offline · last messages kept here"));
document.addEventListener("visibilitychange",()=>{ if(!roomId) return; if(document.visibilityState!=="hidden"){ apiPresence(true).catch(()=>{}); syncMessages({silent:true}); syncPresence(); } else { apiPresence(false).catch(()=>{}); } });
window.addEventListener("beforeunload",()=>{ apiPresence(false).catch(()=>{}); stopPolling(); stopPresence(); window.__alwaysYoursPhotoViewer?.close(); if(selectedPhotoPreviewUrl){try{URL.revokeObjectURL(selectedPhotoPreviewUrl)}catch{}} for(const url of mediaObjectUrls){try{URL.revokeObjectURL(url)}catch{}} });

// Web Push: never transmit plaintext or the encryption key in a push notification.
const notifyBtn=$("notifyBtn");
function b64urlToBytes(value){
  const pad="=".repeat((4-value.length%4)%4);
  return base64ToBytes(value.replace(/-/g,"+").replace(/_/g,"/")+pad);
}
async function refreshNotifyButton(){
  if(!notifyBtn)return;
  const supported=Boolean(API_BASE)&&("serviceWorker" in navigator)&&("PushManager" in window)&&("Notification" in window);
  notifyBtn.disabled=!supported;
  if(!supported){notifyBtn.textContent=API_BASE?"此浏览器不支持推送":"先连接 Supabase 再开启通知";return;}
  const reg=await navigator.serviceWorker.ready;
  const subscription=await reg.pushManager.getSubscription();
  const registration=roomId?`${roomId}:${selectedName}`:"";
  const on=Boolean(subscription)&&Notification.permission==="granted"&&Boolean(registration)&&localStorage.getItem("alwaysYoursPushRegistration")===registration;
  notifyBtn.classList.toggle("is-enabled",on);
  notifyBtn.textContent=on?"✓ 已开启提醒":"🔔 消息提醒";
  notifyBtn.setAttribute("aria-label",on?"手机消息提醒已开启":"开启手机消息提醒");
}
notifyBtn?.addEventListener("click",async()=>{
  if(!roomId){toast("请先进入聊天");return;}
  notifyBtn.disabled=true;
  try{
    if(!API_BASE)throw new Error("请先连接 Supabase 后再配置手机推送。");
    if(!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) throw new Error("当前浏览器不支持推送。iPhone 请用 Safari 添加到主屏幕后，从桌面图标打开。");
    const permit=await Notification.requestPermission();
    if(permit!=="granted")throw new Error("需要在系统中允许此网站发送通知。");
    const reg=await navigator.serviceWorker.ready;
    const configRes=await fetch(`${API_BASE}/api/push/config`,{cache:"no-store"});
    const config=await configRes.json();
    if(!configRes.ok||!config.publicKey)throw new Error(config.error||"Supabase 推送服务尚未配置。");
    let sub=await reg.pushManager.getSubscription();
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64urlToBytes(config.publicKey)});
    const response=await fetch(`${API_BASE}/api/push/subscribe`,{
      method:"POST",headers:{"Content-Type":"application/json","X-Room-Key":roomId,"X-User":selectedName},
      body:JSON.stringify({subscription:sub.toJSON()}),cache:"no-store"
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"无法完成推送订阅");
    localStorage.setItem("alwaysYoursPushRegistration",`${roomId}:${selectedName}`);
    toast("通知已开启，收到对方消息时会提醒你 ♡");
  }catch(error){toast(error.message||"无法开启通知");console.warn("Push subscribe:",error.message);}
  finally{notifyBtn.disabled=false;refreshNotifyButton().catch(()=>{});}
});

// Restore identity automatically on this browser when its encrypted room key exists.
// Switching HE/SHE remains available in the chat header.
(async function restoreChatIdentity(){
  if(!rememberedRole || !validRole(rememberedRole))return;
  const stored=await deviceCredentials();
  if(!stored || roleChosen)return;
  await chooseRole(rememberedRole);
})().catch(err=>console.warn('Unable to restore previous chat identity',err));
