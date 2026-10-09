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
const MAX_VISIBLE_MESSAGES = 80; // Per-page size; older days load on demand.
const PAGE_SIZE = 80;
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
  const epoch=++viewEpoch;
  historyMessages=[];hasMoreHistory=false;historyBusy=false;
  messagePlaintextCache.clear();
  updateLoadOlderButton();
  lastMessageIds="";lastContentIds="";firstSync=true;
  const cached=await loadCache();
  if(epoch!==viewEpoch)return;
  showChat();
  $("roomLabel").textContent=`${selectedName === "Ko Ko" ? "HE · Ko Ko" : "SHE · Chit Chit"} ♡`;
  if(cached.length){ historyMessages=cached; renderMessages(cached); }
  updateConnection("连接中…");
  startPolling();startPresence();refreshNotifyButton().catch(()=>{});
  setTimeout(()=>repairPushBinding().catch(err=>console.warn("Notification check:",err.message)),300);
}
function validRole(name){return name==="Ko Ko"||name==="Chit Chit";}
async function chooseRole(name){
  if(!validRole(name))return;
  if(outgoingBusy){toast("正在发送或保存消息，请稍等再切换身份 ♡");return;}
  // An installed device remembers its role. Warn before redirecting its notifications
  // to the other profile; this is a mis-tap guard, NOT server-side authentication.
  const previousRole = roleChosen ? selectedName : rememberedRole;
  if (previousRole && previousRole !== name) {
    const from = previousRole === "Ko Ko" ? "HE · Ko Ko" : "SHE · Chit Chit";
    const to = name === "Ko Ko" ? "HE · Ko Ko" : "SHE · Chit Chit";
    if (!window.confirm(`这台设备原来使用 ${from}。\n切换到 ${to} 后，此设备的手机消息提醒也会重新绑定。\n\n确认切换身份吗？`)) return;
  }
  selectedName=name;roleChosen=true;
  rememberedRole=name;
  if (previousRole && previousRole!==name) {
    // Existing subscription is re-bound to the newly selected HE/SHE profile below.
    verifiedPushRole=null;
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
let lastContentIds = "";
let lastRenderedCount = 0;
let firstSync = true;
let viewEpoch = 0;
let historyMessages = [];
let hasMoreHistory = false;
let historyBusy = false;
let outgoingBusy = false;
const messagePlaintextCache = new Map();
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
// Dates are already separated by day in the chat timeline. Show only HH:mm in each bubble.
function formatBubbleTime(value){
  return new Intl.DateTimeFormat("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false})
    .format(new Date(Number(value)||Date.now()));
}
// A receipt is based ONLY on the server's seen_at field, never on online presence.
function setReadReceipt(element, seen){
  if(!element)return;
  const isSeen=Boolean(seen);
  element.classList.toggle("is-seen",isSeen);
  element.classList.toggle("is-sent",!isSeen);
  const description=isSeen?"对方已读":"已发送，对方尚未阅读";
  element.setAttribute("aria-label",description);
  element.title=description;
  const checks=element.querySelector(".receipt-checks");
  if(checks) checks.textContent=isSeen?"✓✓":"✓";
}


function showChat(){ gate.classList.add("hidden"); chat.classList.remove("hidden"); ensurePresenceUi(); ensureEditBar(); }
function showGate(){
  if(outgoingBusy){toast("消息仍在发送，请稍等 ♡");return;}
  ++viewEpoch;
  historyMessages=[];hasMoreHistory=false;historyBusy=false;
  messagePlaintextCache.clear();updateLoadOlderButton();
  roleChosen=false;
  document.querySelectorAll(".name-option").forEach(b=>b.classList.remove("selected-role"));
  messagesEl.replaceChildren();
  emptyState.classList.remove("hidden");
  lastMessageIds="";lastContentIds="";lastRenderedCount=0;firstSync=true;
  syncing=false;
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
function showNewHint(){ if(!newMessageHint) return; newMessageHint.classList.remove("hidden"); clearTimeout(showNewHint._t); showNewHint._t=setTimeout(()=>newMessageHint.classList.add("hidden"),2200); }
function renderMessages(items){
  const shouldStickToBottom=messagesEl.scrollHeight-messagesEl.clientHeight-messagesEl.scrollTop<100;
  const priorScrollTop=messagesEl.scrollTop;
  for(const url of mediaObjectUrls){ try{URL.revokeObjectURL(url)}catch{} }
  mediaObjectUrls.clear();
  messagesEl.replaceChildren();
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
    // Left/right alignment identifies each side visually; no repeated HE/SHE label in the bubble.
    // Keep an accessible description for assistive technologies.
    row.setAttribute("role","group");
    row.setAttribute("aria-label",mine?"我发送的消息":"对方发送的消息");
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
    if(item.edited_at){
      const ed=document.createElement("span"); ed.className="message-edited";
      ed.textContent="✎"; ed.title="消息已编辑"; ed.setAttribute("aria-label","消息已编辑");
      meta.appendChild(ed);
    }
    const tm=document.createElement("time");
    tm.className="message-time";
    tm.textContent=formatBubbleTime(item.created_at);
    tm.dateTime=new Date(Number(item.created_at)||Date.now()).toISOString();
    tm.title=formatTime(item.created_at);
    meta.appendChild(tm);
    if(mine){
      const read=document.createElement("span");
      read.className="message-read-status";
      read.setAttribute("role","img");
      const checks=document.createElement("span");
      checks.className="receipt-checks";
      checks.setAttribute("aria-hidden","true");
      read.appendChild(checks);
      setReadReceipt(read,item.seen_at);
      meta.appendChild(read);
    }
    // Keep the retention timestamp for local filtering; omit per-message countdown UI.
    bubble.appendChild(meta);
    const actions=document.createElement("div");
    actions.className="message-side-actions";
    const replyBtn=document.createElement("button");
    replyBtn.type="button"; replyBtn.className="message-reply-button";
    replyBtn.textContent="↩";
    replyBtn.title="回复这条消息";
    replyBtn.setAttribute("aria-label","回复"+(mine?"自己":"对方")+"的消息");
    replyBtn.addEventListener("click",()=>beginReply(item));
    actions.appendChild(replyBtn);
    if(mine&&item.kind==="text"){
      const editBtn=document.createElement("button");
      editBtn.type="button"; editBtn.className="message-edit-button";
      editBtn.textContent="✎";
      editBtn.title="编辑这条消息";
      editBtn.setAttribute("aria-label","编辑这条消息");
      editBtn.addEventListener("click",()=>beginEdit(item));
      actions.appendChild(editBtn);
    }
    row.dataset.chatMessageId=item.id;
    // Keep the controls beside the message, not below its text (compact WhatsApp-style).
    if(mine) row.append(actions,bubble);
    else row.append(bubble,actions);
    messagesEl.appendChild(row);
  }
  requestAnimationFrame(()=>{
    // Preserve history reading position, and only stick to the bottom when the reader already was there.
    messagesEl.scrollTop=shouldStickToBottom?messagesEl.scrollHeight:priorScrollTop;
  });
}

function updateReadReceipts(items){
  const byId=new Map(items.map(x=>[x.id,x]));
  for(const row of messagesEl.querySelectorAll('[data-chat-message-id]')){
    const m=byId.get(row.dataset.chatMessageId);
    if(!m)continue;
    const read=row.querySelector('.message-read-status');
    if(read) setReadReceipt(read,m.seen_at);
  }
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
  if(outgoingBusy){toast("消息还在发送，暂时不能切换 ♡");return;}
  showGate();roomId=null;cryptoKey=null;
  // Connection is preconfigured in routes.js. No user-visible URL form.
  setStatus("连接已预设。如果无法连接，请稍后重试。");
});
async function apiGetMessages({before=null,beforeId=null}={}){
  if(!API_BASE)throw new Error("Supabase 服务暂时不可用，请检查网络。");
  const requestedRoom=roomId;
  const url=new URL(`${API_BASE}/api/messages`);
  url.searchParams.set("limit",String(PAGE_SIZE));
  if(before!==null && beforeId){url.searchParams.set("before",String(before));url.searchParams.set("before_id",beforeId);}
  return withTimeout(async(signal)=>{
    const res=await fetch(url.href,{method:"GET",headers:{"X-Room-Key":requestedRoom},signal,cache:"no-store"});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error||"Could not read messages");
    return {messages:Array.isArray(data.messages)?data.messages:[],hasMore:Boolean(data.hasMore)};
  });
}

async function apiSendMessage(payload){
  if(!API_BASE)throw new Error("尚未配置 Supabase 服务地址，消息未发送。");
  return withTimeout(async(signal)=>{
    const res=await fetch(`${API_BASE}/api/messages`,{
      method:"POST",
      // Older clients are still accepted by the backend during the safe rollout.
      // Current clients additionally state the sending role for integrity checking.
      headers:{"Content-Type":"application/json","X-Room-Key":roomId,"X-User":selectedName},
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
      let payload;
      const cached=messagePlaintextCache.get(item.id);
      if(cached?.iv===item.iv && cached.ciphertext===item.ciphertext){payload=cached.payload;}
      else{
        payload=await decryptPayload(item.iv,item.ciphertext);
        messagePlaintextCache.set(item.id,{iv:item.iv,ciphertext:item.ciphertext,payload});
        if(messagePlaintextCache.size>400){messagePlaintextCache.delete(messagePlaintextCache.keys().next().value);}
      }
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
  return out;
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

function updateLoadOlderButton(){
  const button=$("loadOlderMessages");
  if(!button)return;
  button.hidden=!hasMoreHistory && !historyBusy;
  button.disabled=historyBusy;
  button.textContent=historyBusy?"正在加载以前的回忆…":"查看更早的消息 ♡";
}
function mergeHistory(recent,old){
  const merged=new Map();
  for(const item of old){if(Number(item.expires_at)>Date.now())merged.set(item.id,item);}
  for(const item of recent){merged.set(item.id,item);}
  return [...merged.values()].sort((a,b)=>Number(a.created_at)-Number(b.created_at)||a.id.localeCompare(b.id));
}
async function loadOlderMessages(){
  if(historyBusy||!hasMoreHistory||!roomId||!historyMessages.length)return;
  historyBusy=true;updateLoadOlderButton();
  const epoch=viewEpoch;
  const oldest=historyMessages[0];
  const preservedTop=messagesEl.scrollTop;
  const preservedHeight=messagesEl.scrollHeight;
  try{
    const response=await apiGetMessages({before:oldest.created_at,beforeId:oldest.id});
    if(epoch!==viewEpoch)return;
    const older=await decodeItems(response.messages);
    if(epoch!==viewEpoch)return;
    historyMessages=mergeHistory(older,historyMessages);
    hasMoreHistory=response.hasMore;
    const ids=historyMessages.map(x=>`${x.id}:${x.edited_at||0}:${x.seen_at||0}`).join("|");
    lastMessageIds=ids;
    lastContentIds=historyMessages.map(x=>`${x.id}:${x.edited_at||0}`).join("|");
    renderMessages(historyMessages);
    if(document.visibilityState!=="hidden")markVisibleMessagesRead(older);
    // Keep the current place in the timeline after older messages are prepended.
    requestAnimationFrame(()=>{if(epoch===viewEpoch)messagesEl.scrollTop=preservedTop+(messagesEl.scrollHeight-preservedHeight);});
  }catch(e){if(epoch===viewEpoch)toast("较早的消息暂时无法加载，请稍后重试 ♡");}
  finally{if(epoch===viewEpoch){historyBusy=false;updateLoadOlderButton();}}
}
$("loadOlderMessages")?.addEventListener("click",loadOlderMessages);
async function syncMessages({silent=false}={}){
  if(!roomId || !cryptoKey || syncing)return;
  syncing=true;
  const epoch=viewEpoch;
  try{
    const response=await apiGetMessages();
    if(epoch!==viewEpoch)return;
    const recent=await decodeItems(response.messages);
    if(epoch!==viewEpoch)return;
    const items=mergeHistory(recent,historyMessages);
    historyMessages=items;
    // Only replace the "older history available" flag before the first user request to load history.
    if(!items.length || items.length===recent.length)hasMoreHistory=response.hasMore;
    updateLoadOlderButton();
    const ids=items.map(x=>`${x.id}:${x.edited_at||0}:${x.seen_at||0}`).join("|");
    const changed=ids!==lastMessageIds;
    const contentIds=items.map(x=>`${x.id}:${x.edited_at||0}`).join("|");
    const contentChanged=contentIds!==lastContentIds;
    lastMessageIds=ids;
    lastContentIds=contentIds;
    if(changed && 'BroadcastChannel' in window){
      const channel=new BroadcastChannel('always-yours-chat-events');
      channel.postMessage({type:'messages-updated'});
      channel.close();
    }
    // Keep the encrypted offline cache small rather than putting a month of plaintext in storage.
    saveCache(items.slice(-MAX_VISIBLE_MESSAGES));
    if(contentChanged || !messagesEl.children.length)renderMessages(items);
    else if(changed)updateReadReceipts(items);
    if(document.visibilityState!=="hidden")markVisibleMessagesRead(recent);
    syncPresence();
    updateConnection("已连接 · 已同步");
    clearBackendIssue();
    if(!firstSync && recent.some(m=>m.sender!==selectedName && m.created_at>Date.now()-60000) && changed)showNewHint();
    firstSync=false;
    lastRenderedCount=items.length;
  }catch(error){
    if(epoch!==viewEpoch)return;
    const cached=await loadCache();
    if(epoch!==viewEpoch)return;
    if(cached.length && !messagesEl.children.length)renderMessages(cached);
    updateConnection(navigator.onLine?"服务器未连接":"离线 · 最近消息仅在本机");
    showBackendIssue(error);
    if(!silent && navigator.onLine)toast("聊天服务器暂时未连接，请稍后重试。");
  }finally{syncing=false;}
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
  input.focus({preventScroll:true});
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
  input.focus({preventScroll:true});
}
function cancelEdit(){
  editingMessageId=null;
  editingMessageReply=null;
  if(editBar) editBar.classList.add("hidden");
  if(input) input.placeholder="想和 TA 说些什么…";
  updateSendButton();
}
async function editMessage(){
  if(outgoingBusy)return;
  const id=editingMessageId;
  const text=String(input.value||"").trim();
  if(!id) return sendMessage();
  if(!text){ toast("An edited message cannot be empty."); return; }
  if(text.length>2000){ toast("Message is too long."); return; }
  outgoingBusy=true;sendBtn.disabled=true;
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
    outgoingBusy=false;
    updateSendButton();
    input.focus();
  }
}

async function sendMessage(kind="text", value=input.value){
  if(outgoingBusy)return;
  const textValue=String(value||"").trim();
  const hasPhoto=Boolean(selectedPhotoFile);
  if(!roomId || !cryptoKey || !validRole(selectedName) || (!textValue && !hasPhoto)) return;
  if(textValue.length>2000){ toast("Message is too long."); return; }
  outgoingBusy=true;sendBtn.disabled=true;
  const messageId=crypto.randomUUID();
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
      await apiSendMessage({id:messageId,sender:selectedName,media_key:mediaKey,...encryptedMessage});
      clearSelectedPhoto();
    }else{
      const encrypted=await encryptPayload({kind,text:textValue,reply:replyingTo||undefined});
      await apiSendMessage({id:messageId,sender:selectedName,...encrypted});
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
    console.warn("Message send uncertain or failed:",String(error?.message||error).slice(0,140));
    // A timed-out POST can have reached Supabase: verify its unique ID before telling the user to retry.
    let delivered=false;
    try{
      const page=await apiGetMessages();
      delivered=page.messages.some(item=>item.id===messageId);
    }catch{}
    if(delivered){
      clearSelectedPhoto(); input.value="";input.style.height="auto"; clearReply();
      await syncMessages({silent:true});
      toast("消息已在云端确认送达 ♡");
    }else{
      toast(navigator.onLine?"暂时无法确认送达，请检查聊天记录后再重发。":"当前离线，消息尚未确认送达。");
      updateConnection("未确认送达 · 请检查连接");
      showBackendIssue(error);
    }
  }finally{
    outgoingBusy=false;
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
$("changeSecretBtn").addEventListener("click",()=>{
  if(outgoingBusy){toast("消息正在发送，请稍等再切换身份 ♡");return;}
  showGate();roomId=null;cryptoKey=null;setStatus("");$("setup").classList.add("hidden");
});
$("resetDeviceBtn").addEventListener("click",async()=>{
  if(!confirm("要重新配置这台设备吗？此操作不会删除云端消息，但需要再次输入之前的共同密钥。"))return;
  await deviceRecord("delete");roomId=null;cryptoKey=null;
  revealSetup("请重新输入之前的共同密钥。");
});
sendBtn.addEventListener("click",()=>editingMessageId?editMessage():sendMessage());
photoBtn?.addEventListener("click",()=>photoInput?.click());
gifBtn?.addEventListener("click",()=>toggleGifPanel());
const gifPanel=$("gifPanel");
const gifUrlInput=$("gifUrlInput");
const gifImportBtn=$("gifImportBtn");
const gifPickBtn=$("gifPickBtn");
const gifStatus=$("gifStatus");
const CURATED_GIFS=[
  {file:"pulse-love.gif",label:"心动"},
  {file:"hugs.gif",label:"抱抱"},
  {file:"miss-you.gif",label:"想你了"},
  {file:"good-night.gif",label:"晚安"},
  {file:"kiss.gif",label:"亲亲"},
  {file:"forever.gif",label:"永远是你"}
];
function hideGifPanel(){gifPanel?.classList.add("hidden");gifBtn?.setAttribute("aria-expanded","false");}
function toggleGifPanel(){
  const opening=gifPanel?.classList.contains("hidden");
  if(!gifPanel)return;
  gifPanel.classList.toggle("hidden",!opening);
  gifBtn?.setAttribute("aria-expanded",String(opening));
  emojiPanel?.classList.add("hidden");stickerPanel?.classList.add("hidden");
  if(opening)gifUrlInput?.focus({preventScroll:true});
}
function setGifStatus(message){if(gifStatus)gifStatus.textContent=message;}
async function selectRomanticGif(filename,label){
  setGifStatus(`准备 ${label} 动图…`);
  try{
    const url=new URL(`./romantic-gifs/${filename}`,window.location.href);
    const res=await fetch(url,{cache:"force-cache"});
    if(!res.ok)throw new Error("内置动图加载失败");
    const file=new File([await res.blob()],filename,{type:"image/gif"});
    await choosePhoto(file);
    if(selectedPhotoFile){hideGifPanel();toast(`已选「${label}」♡ 点击发送即可加密分享`);}
  }catch(e){setGifStatus(e.message||"动图暂时不可用");}
}
function normalizeRomanticGifUrl(value){
  const raw=String(value||"").trim();
  let u;
  try { u=new URL(raw); }catch{throw new Error("请输入 GIF 图片的网址（https://…）");}
  if(u.protocol!=="https:"||u.username||u.password||u.port)throw new Error("只接受 HTTPS GIF 网址");
  const host=u.hostname.toLowerCase();
  // GIPHY GIF page links can be converted into their official media endpoint.
  if(host==="giphy.com"||host==="www.giphy.com"){
    const last=u.pathname.split("/").filter(Boolean).pop()||"";
    const gifId=last.split("-").pop();
    if(!/^[a-zA-Z0-9]{8,40}$/.test(gifId))throw new Error("GIPHY 页面地址不完整，请使用复制图片地址");
    u=new URL(`https://media.giphy.com/media/${gifId}/giphy.gif`);
  }
  const allowed=host==="media.giphy.com"||host==="i.giphy.com"||host==="media.tenor.com"||host==="c.tenor.com"||host==="giphy.com"||host==="www.giphy.com";
  if(!allowed)throw new Error("仅支持 GIPHY 和 Tenor 的 GIF 图片直链");
  if(!/\.gif$/i.test(u.pathname))throw new Error("请复制 .gif 图片地址，而不是网页地址");
  u.search="";u.hash="";
  return u.href;
}
async function importOnlineGif(){
  const btn=gifImportBtn;
  try{
    const url=normalizeRomanticGifUrl(gifUrlInput?.value);
    btn.disabled=true;
    setGifStatus("正在安全获取 GIF…（最多 2 MB）");
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12000);
    let file;
    try{
      const response=await fetch(url,{credentials:"omit",mode:"cors",redirect:"follow",signal:controller.signal,cache:"no-store"});
      if(!response.ok)throw new Error("图片下载失败，请换一个 GIF");
      if(Number(response.headers.get("Content-Length")||0)>2*1024*1024)throw new Error("GIF 超过 2 MB，请换较小的 GIF");
      if(!response.body)throw new Error("此图片网站暂不支持获取 GIF");
      const chunks=[];let size=0;const reader=response.body.getReader();
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
        if(size>2*1024*1024){await reader.cancel();throw new Error("GIF 超过 2 MB，请换较小的动图");}
        chunks.push(value);
      }
      file=new File(chunks,`our-romantic-gif-${Date.now()}.gif`,{type:"image/gif"});
    }finally{clearTimeout(timeout);}
    await choosePhoto(file);
    if(selectedPhotoFile){hideGifPanel();toast("GIF 已选好，确认发送后会加密上传 ♡");}
  }catch(e){setGifStatus(e.name==="AbortError"?"下载超时，请换一个 GIF 直链":e instanceof TypeError?"图片站点限制了跨域下载；试试另存 GIF 后本地上传":e.message);}
  finally{if(btn)btn.disabled=false;}
}
function initializeGifPanel(){
  if(!gifPanel)return;
  // Chat-relative sheet never shifts the whole page or overflows beyond the header.
  chat.appendChild(gifPanel);
  const grid=gifPanel.querySelector(".romantic-gif-grid");
  for(const entry of CURATED_GIFS){
    const btn=document.createElement("button");btn.type="button";btn.className="romantic-gif-option";btn.title=`选择 ${entry.label} GIF`;
    const img=document.createElement("img");img.src=`./romantic-gifs/${entry.file}`;img.alt=`${entry.label} GIF`;img.width=120;img.height=94;img.loading="lazy";
    const caption=document.createElement("span");caption.textContent=entry.label;
    btn.append(img,caption);btn.addEventListener("click",()=>selectRomanticGif(entry.file,entry.label));
    grid?.appendChild(btn);
  }
  gifImportBtn?.addEventListener("click",importOnlineGif);
  gifUrlInput?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();importOnlineGif();}});
  gifPickBtn?.addEventListener("click",()=>gifInput?.click());
  $("closeGifPanel")?.addEventListener("click",hideGifPanel);
}
initializeGifPanel();
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

$("emojiBtn").addEventListener("click",()=>{ const open=emojiPanel.classList.toggle("hidden"); stickerPanel.classList.add("hidden"); hideGifPanel(); $("emojiBtn").setAttribute("aria-expanded",String(!open)); $("stickerBtn").setAttribute("aria-expanded","false"); });
$("stickerBtn").addEventListener("click",()=>{ const open=stickerPanel.classList.toggle("hidden"); emojiPanel.classList.add("hidden"); hideGifPanel(); $("stickerBtn").setAttribute("aria-expanded",String(!open)); $("emojiBtn").setAttribute("aria-expanded","false"); });

document.addEventListener("click",e=>{
  const target=e.target;
  if(emojiPanel && !emojiPanel.classList.contains("hidden") && !emojiPanel.contains(target) && target!==$("emojiBtn")){emojiPanel.classList.add("hidden");$("emojiBtn").setAttribute("aria-expanded","false");}
  if(stickerPanel && !stickerPanel.classList.contains("hidden") && !stickerPanel.contains(target) && target!==$("stickerBtn")){stickerPanel.classList.add("hidden");$("stickerBtn").setAttribute("aria-expanded","false");}
  if(gifPanel && !gifPanel.classList.contains("hidden") && !gifPanel.contains(target) && target!==gifBtn)hideGifPanel();
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

// Web Push is independent of the browser page: messages are delivered to the scoped Service Worker.
// The device never uploads the chat passphrase or decryptable message bodies.
const notifyBtn=$("notifyBtn");
const pushDiagnostics=$("pushDiagnostics");
const pushDiagStatus=$("pushDiagStatus");
const pushDiagResult=$("pushDiagResult");
const pushDiagTest=$("pushDiagTest");
const pushDiagSync=$("pushDiagSync");
let verifiedPushRole=null;
let pushSyncBusy=false;
let lastPushSync=0;
const PUSH_LOCAL_KEY="alwaysYoursPushRegistration";
function b64urlToBytes(value){
  const pad="=".repeat((4-value.length%4)%4);
  return base64ToBytes(value.replace(/-/g,"+").replace(/_/g,"/")+pad);
}
function pushIdentity(){return roomId && validRole(selectedName) ? `${roomId}:${selectedName}` : "";}
function pushAvailable(){return !!API_BASE && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;}
async function scopedChatRegistration(){
  if(!('serviceWorker' in navigator))throw new Error('当前浏览器不支持后台通知');
  const reg=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
  if(!reg.active){
    const pending=reg.installing||reg.waiting;
    if(pending) await Promise.race([
      new Promise(resolve=>{if(pending.state==='activated')return resolve();pending.addEventListener('statechange',()=>{if(pending.state==='activated')resolve();});}),
      new Promise((_,reject)=>setTimeout(()=>reject(new Error('后台服务还未启动，请刷新后再试')),8000))
    ]);
  }
  if(!reg.active)throw new Error('聊天通知后台尚未准备好，请刷新页面');
  return reg;
}
async function getPushConfig(){
  const response=await fetch(`${API_BASE}/api/push/config`,{cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.publicKey)throw new Error(data.error||'推送服务器未准备好');
  return data.publicKey;
}
async function savePushSubscription(sub,publicKey){
  const response=await fetch(`${API_BASE}/api/push/subscribe`,{
    method:'POST',headers:{'Content-Type':'application/json','X-Room-Key':roomId,'X-User':selectedName},
    body:JSON.stringify({subscription:sub.toJSON()}),cache:'no-store'
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Supabase 未接受当前设备订阅');
  const identity=pushIdentity();
  try{localStorage.setItem(PUSH_LOCAL_KEY,identity);}catch{}
  verifiedPushRole=identity;
  lastPushSync=Date.now();
  try{const reg=await scopedChatRegistration();reg.active?.postMessage({type:'always-yours-push-profile',roomId,role:selectedName,publicKey,apiBase:API_BASE});}catch{}
  return data;
}
async function repairPushBinding({create=false,force=false}={}){
  if(!pushAvailable() || !pushIdentity() || Notification.permission!=='granted')return false;
  if(pushSyncBusy)return false;
  const identity=pushIdentity();
  if(!force && verifiedPushRole===identity && Date.now()-lastPushSync<3*60*1000)return true;
  pushSyncBusy=true;
  try{
    const reg=await scopedChatRegistration();
    const publicKey=await getPushConfig();
    let sub=await reg.pushManager.getSubscription();
    // Only the explicit button click can create a fresh subscription / prompt.
    if(!sub&&create)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64urlToBytes(publicKey)});
    if(!sub)return false;
    await savePushSubscription(sub,publicKey);
    return true;
  }finally{
    pushSyncBusy=false;
    refreshNotifyButton().catch(()=>{});
  }
}
async function refreshNotifyButton(){
  if(!notifyBtn)return;
  if(!pushAvailable()){
    notifyBtn.disabled=true;notifyBtn.textContent='🔕 不支持系统推送';return;
  }
  notifyBtn.disabled=false;
  const active=Notification.permission==='granted' && verifiedPushRole===pushIdentity();
  notifyBtn.classList.toggle('is-enabled',active);
  notifyBtn.textContent=active?'✓ 已绑定消息提醒':'🔔 开启消息提醒';
  notifyBtn.setAttribute('aria-label',active?'消息推送已绑定当前 HE/SHE 身份':'开启或重新绑定系统推送');
}
notifyBtn?.addEventListener('click',async()=>{
  if(!roomId){toast('请先进入聊天');return;}
  notifyBtn.disabled=true;
  try{
    if(!pushAvailable())throw new Error('当前浏览器不支持 Web Push。iPhone 请先从 Safari 添加到主屏幕。');
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw new Error('请在浏览器或手机系统中允许此网站通知。');
    const ok=await repairPushBinding({create:true,force:true});
    if(!ok)throw new Error('通知订阅失败，请在「更多 → 通知检测」中检查');
    toast('已为当前身份绑定推送。建议再发送一次测试通知 ♡');
  }catch(e){toast(e.message||'无法开启通知');console.warn('Push configuration:',e.message);}
  finally{notifyBtn.disabled=false;refreshNotifyButton().catch(()=>{});}
});
function pushMessage(msg){if(pushDiagStatus)pushDiagStatus.textContent=msg;}
function showPushDiagnostics(show){
  if(!pushDiagnostics)return;
  pushDiagnostics.classList.toggle('hidden',!show);
  if(show){pushMessage('正在检测当前设备的系统通知…');loadPushDiagnostics().catch(e=>pushMessage(e.message));}
}
$('openPushDiagnostics')?.addEventListener('click',()=>showPushDiagnostics(true));
$('closePushDiagnostics')?.addEventListener('click',()=>showPushDiagnostics(false));
pushDiagnostics?.addEventListener('click',e=>{if(e.target?.dataset?.dismissPush!==undefined)showPushDiagnostics(false);});
function formatPushAttempt(a){
  if(a.status_code===102)return '排队：正在等待 8 秒后的测试';
  if(a.status_code>=200&&a.status_code<300)return '推送服务已接收（手机是否显示仍需实测）';
  if(a.status_code===404||a.status_code===410)return '订阅已失效，请重新开启提醒';
  if(a.status_code===401||a.status_code===403)return '推送服务拒绝认证，请检查 VAPID 密钥';
  return a.status_code ? `推送失败（HTTP ${a.status_code}）` : '推送失败（网络或加密错误）';
}
async function localPushReceipt(reg){
 if(!reg?.active)return null;
 return new Promise(resolve=>{
  const onMessage=event=>{
   if(event.data?.type==='always-yours-push-receipt'){
    clearTimeout(timer);navigator.serviceWorker.removeEventListener('message',onMessage);
    resolve(event.data.at||null);
   }
  };
  const timer=setTimeout(()=>{navigator.serviceWorker.removeEventListener('message',onMessage);resolve(null);},1200);
  navigator.serviceWorker.addEventListener('message',onMessage);
  reg.active.postMessage({type:'always-yours-push-last-received'});
 });
}
async function loadPushDiagnostics(){
  if(!pushDiagStatus||!roomId)return;
  const supported=pushAvailable();
  const permission=supported?Notification.permission:'不支持';
  const reg=supported?await scopedChatRegistration():null;
  const sub=reg?await reg.pushManager.getSubscription():null;
  let line=`当前身份：${selectedName==='Ko Ko'?'HE':'SHE'} · 通知权限：${permission==='granted'?'允许':permission==='denied'?'被阻止':permission==='default'?'尚未授权':permission}`;
  line+=` · 本机订阅：${sub?'存在':'没有'}`;
  if(reg)line+=` · 后台：${reg.active?'正常':'未启动'}`;
  const lastLocal=await localPushReceipt(reg);
  line+=`\n本机最后实际收到的后台推送：${lastLocal?new Date(lastLocal).toLocaleString():'尚无记录'}`;
  const response=await fetch(`${API_BASE}/api/push/status`,{cache:'no-store',headers:{'X-Room-Key':roomId,'X-User':selectedName}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'服务器状态查询失败');
  line+=`
Supabase 当前身份订阅设备：${data.registeredDevices} · 对方订阅设备：${data.partnerDevices}`;
  pushMessage(line);
  const attempts=data.latestAttempts||[];
  pushDiagResult.textContent=attempts.length?('最近推送：'+formatPushAttempt(attempts[0])):'暂无推送记录。可以点击测试通知。';
}
pushDiagSync?.addEventListener('click',async()=>{
  pushDiagSync.disabled=true;
  try{
    if(!pushAvailable())throw new Error('当前浏览器不支持 Web Push');
    if(Notification.permission!=='granted')throw new Error('请先点击聊天顶部的「开启消息提醒」');
    const ok=await repairPushBinding({create:false,force:true});
    if(!ok)throw new Error('没有本机推送订阅，请先点击顶部「开启消息提醒」');
    await loadPushDiagnostics();toast('接收身份已重新绑定 ♡');
  }catch(e){pushMessage(e.message);}
  finally{pushDiagSync.disabled=false;}
});
pushDiagTest?.addEventListener('click',async()=>{
  pushDiagTest.disabled=true;
  try{
    if(Notification.permission!=='granted')throw new Error('请先开启系统通知权限');
    const ok=await repairPushBinding({create:false,force:true});
    if(!ok)throw new Error('本设备没有订阅，请先开启消息提醒');
    const response=await fetch(`${API_BASE}/api/push/test`,{method:'POST',headers:{'Content-Type':'application/json','X-Room-Key':roomId,'X-User':selectedName},body:'{}',cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'无法发送测试通知');
    pushMessage(`已预约 ${data.registeredDevices} 台当前身份设备的测试通知。请立即锁屏/关闭浏览器，约 8 秒后查看。`);
    pushDiagResult.textContent='注意：发送到推送服务成功，也不能保证设备一定响铃；请检查安卓通知权限及电池限制。';
  }catch(e){pushMessage(e.message||'测试失败');}
  finally{pushDiagTest.disabled=false;}
});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&roomId)repairPushBinding().catch(()=>{});});
// Restore identity automatically on this browser when its encrypted room key exists.
// Switching HE/SHE remains available in the chat header.
(async function restoreChatIdentity(){
  if(!rememberedRole || !validRole(rememberedRole))return;
  const stored=await deviceCredentials();
  if(!stored || roleChosen)return;
  await chooseRole(rememberedRole);
})().catch(err=>console.warn('Unable to restore previous chat identity',err));
