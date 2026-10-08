const $ = (id) => document.getElementById(id);
const config = window.OUR_JOURNEY_CONFIG || {};

const backTop = $("backTop");
function updateBackTop() {
  if (!backTop) return;
  if (window.scrollY > 420) backTop.classList.add("show");
  else backTop.classList.remove("show");
}
window.addEventListener("scroll", updateBackTop, {passive:true});
if (backTop) backTop.addEventListener("click", () => window.scrollTo({top:0, behavior:"smooth"}));

document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener("click", event => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({behavior:"smooth", block:"start"});
  });
});
const sectionLinks = document.querySelectorAll('a[href^="#"]');
sectionLinks.forEach(link => {
  link.addEventListener("click", () => {
    document.body.classList.add("navigating");
    window.setTimeout(() => document.body.classList.remove("navigating"), 450);
  });
});

// v3 — cross-platform PWA installation
let deferredInstallPrompt = null;
const installTrigger = $("installTrigger");
const installLabel = $("installLabel");
const installModal = $("installModal");
const nativeInstallBox = $("nativeInstallBox");
const nativeInstall = $("nativeInstall");
const installGuide = $("installGuide");

function platformInfo() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isMac = /Macintosh|Mac OS X/i.test(ua) && !isIOS;
  const isWindows = /Windows/i.test(ua);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  return {isIOS,isAndroid,isMac,isWindows,isStandalone};
}
function guideHTML(info) {
  if (info.isIOS) return `<h3>iPhone / iPad</h3><div class="step"><span class="num">1</span><div><strong>Open this page in Safari</strong><p>Use Safari, not an in-app browser.</p></div></div><div class="step"><span class="num">2</span><div><strong>Tap Share</strong><p>Choose <b>Add to Home Screen</b>.</p></div></div><div class="step"><span class="num">3</span><div><strong>Turn on “Open as Web App”</strong><p>Then tap <b>Add</b>.</p></div></div>`;
  if (info.isAndroid) return `<h3>Android</h3><div class="step"><span class="num">1</span><div><strong>Use Chrome or a supported browser</strong><p>If an install button appears above, tap it.</p></div></div><div class="step"><span class="num">2</span><div><strong>Or open the browser menu</strong><p>Choose <b>Install app</b> or <b>Add to Home screen</b>.</p></div></div>`;
  if (info.isMac) return `<h3>Mac</h3><div class="step"><span class="num">1</span><div><strong>Safari · macOS Sonoma 14+</strong><p>Choose <b>Share → Add to Dock</b>.</p></div></div><div class="step"><span class="num">2</span><div><strong>Chrome / Edge</strong><p>Use the browser's <b>Install</b> option when available.</p></div></div>`;
  if (info.isWindows) return `<h3>Windows PC</h3><div class="step"><span class="num">1</span><div><strong>Chrome / Edge</strong><p>Use the <b>Install</b> icon in the address bar or browser menu.</p></div></div>`;
  return `<h3>Install on your device</h3><div class="step"><span class="num">1</span><div><strong>Use your browser's install option</strong><p>Look for <b>Install</b>, <b>Add to Home Screen</b>, or <b>Add to Dock</b>.</p></div></div>`;
}
function updateInstallUI(){
  if (!installTrigger) return;
  const info = platformInfo();
  if (info.isStandalone) { installTrigger.hidden = true; return; }
  installTrigger.hidden = false;
  if (installLabel) installLabel.textContent = info.isIOS ? "Add to Home" : info.isMac ? "Add to Dock" : "Install App";
}
function openInstallModal(){
  const info = platformInfo();
  if (installGuide) installGuide.innerHTML = guideHTML(info);
  if (installModal) { installModal.hidden=false; installModal.setAttribute("aria-hidden","false"); }
  document.body.style.overflow="hidden";
  if (nativeInstallBox) nativeInstallBox.hidden = !(deferredInstallPrompt && !info.isIOS);
}
function closeInstallModal(){
  if (installModal) { installModal.hidden=true; installModal.setAttribute("aria-hidden","true"); }
  document.body.style.overflow="";
}
installTrigger?.addEventListener("click", openInstallModal);
document.querySelectorAll("[data-install-close]").forEach(el => el.addEventListener("click", closeInstallModal));
document.addEventListener("keydown", e => { if (e.key === "Escape") { if (installModal && !installModal.hidden) closeInstallModal(); if (!$("memoryModal")?.hidden) closeMemoryModal(); if (!$("memoryLightbox")?.hidden) closeLightbox(); if (!$("memoryImageEditor")?.hidden) closeImageEditor(); if (!$("memoryTextEditor")?.hidden) closeMemoryTextEditor(); } });
window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); deferredInstallPrompt=event; updateInstallUI(); });
nativeInstall?.addEventListener("click", async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt=null; closeInstallModal(); updateInstallUI(); });
window.addEventListener("appinstalled", () => { deferredInstallPrompt=null; closeInstallModal(); updateInstallUI(); });
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(()=>{}));
updateInstallUI();

// Live relationship day counter — together since 23 March 2024.
// Compare local *calendar dates* in UTC to avoid daylight-saving off-by-one errors.
(function(){
  const el = $("storyDays");
  if (!el) return;
  const startDayUTC = Date.UTC(2024, 2, 23);
  function updateStoryDays(){
    const today = new Date();
    const todayDayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const diff = Math.max(0, Math.round((todayDayUTC - startDayUTC) / 86400000));
    el.textContent = `${diff.toLocaleString()} days together`;
  }
  updateStoryDays();
  window.setInterval(updateStoryDays, 60 * 1000);
})();

// v7 — owner-backed Google Drive memory cabinet
// The browser never signs into Google. Cloudflare Worker owns the Google OAuth
// session and resolves the private Our-Journey folder on the owner's Drive.
const DRIVE_API_BASE = String(config.DRIVE_API_BASE || "").replace(/\/$/, "");
const DRIVE_FOLDER_HINT = config.DRIVE_FOLDER_ID || "";
let driveFolderId = DRIVE_FOLDER_HINT;
let driveContext = { rootId: DRIVE_FOLDER_HINT, photosId: "", videosId: "", thumbnailsId: "" };
let driveReady = false;
let driveStatusPromise = null;
let driveMemories = [];

const driveStatus = $("driveStatus");
const driveStatusText = $("driveStatusText");
const driveAddBtn = $("driveAddBtn");
const driveRefreshBtn = $("driveRefreshBtn");
const driveSetupNote = $("driveSetupNote");
const memoryGrid = $("memoryGrid");
const memoryEmpty = $("memoryEmpty");
const memoryModal = $("memoryModal");
const memoryFile = $("memoryFile");
const memoryFileName = $("memoryFileName");
const memoryPreview = $("memoryPreview");
const memoryDate = $("memoryDate");
const memoryTitleInput = $("memoryTitleInput");
const memoryNote = $("memoryNote");
const memorySoftTone = $("memorySoftTone");
const memoryUploadBtn = $("memoryUploadBtn");
const memoryProgress = $("memoryProgress");
const memoryProgressLabel = $("memoryProgressLabel");
const memoryProgressValue = $("memoryProgressValue");
const memoryProgressBar = $("memoryProgressBar");
const lightbox = $("memoryLightbox");
const lightboxMedia = $("lightboxMedia");
const lightboxCaption = $("lightboxCaption");

function workerConfigured(){
  return Boolean(DRIVE_API_BASE && !DRIVE_API_BASE.includes("REPLACE-WITH-YOUR-WORKER"));
}
function setDriveStatus(state, text){
  if (driveStatus) driveStatus.dataset.state=state;
  if (driveStatusText) driveStatusText.textContent=text;
}
function showToast(message, kind="normal"){
  let t=document.getElementById("ojToast");
  if(!t){ t=document.createElement("div"); t.id="ojToast"; t.className="oj-toast"; document.body.appendChild(t); }
  t.dataset.kind=kind; t.textContent=message; t.classList.add("show");
  clearTimeout(showToast._timer); showToast._timer=setTimeout(()=>t.classList.remove("show"),3600);
}
function escapeHTML(value){
  return String(value ?? "").replace(/[&<>\"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
}
function isoToday(){ return new Date().toISOString().slice(0,10); }
function workerURL(path){
  if(!workerConfigured()) throw new Error("还没有配置 Google Drive Worker 地址。");
  return `${DRIVE_API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}
async function workerFetch(path, options={}){
  const response=await fetch(workerURL(path), {...options, cache:"no-store", credentials:"omit"});
  const contentType=response.headers.get("content-type")||"";
  if(!response.ok){
    let message=`云端请求失败：${response.status}`;
    if(contentType.includes("application/json")){
      const data=await response.json().catch(()=>({}));
      message=data.error?.message || data.error_description || data.error || message;
    }else{
      const text=await response.text().catch(()=>""); if(text) message=text.slice(0,220);
    }
    throw new Error(message);
  }
  return response;
}

async function resolveDriveContext(){
  const hint=driveFolderId || DRIVE_FOLDER_HINT;
  const suffix=hint ? `?folderId=${encodeURIComponent(hint)}` : "";
  const response=await workerFetch(`/api/drive/context${suffix}`);
  const data=await response.json();
  if(!data?.rootId) throw new Error("没有找到可访问的 Our-Journey 文件夹。请确认 Owner Google Drive 账号里存在 My Drive / Our-Journey。");
  driveContext={
    rootId:data.rootId,
    photosId:data.photosId||"",
    videosId:data.videosId||"",
    thumbnailsId:data.thumbnailsId||""
  };
  driveFolderId=data.rootId;
  try{ localStorage.setItem("ourJourneyDriveFolderId", driveFolderId); }catch{}
  return driveContext;
}

async function initOwnerDrive(force=false){
  if(!workerConfigured()){
    driveReady=false; setDriveStatus("error","Google Drive Worker not configured");
    if(driveSetupNote) driveSetupNote.hidden=false; return false;
  }
  if(!force && driveStatusPromise) return driveStatusPromise;
  driveStatusPromise=(async()=>{
    try{
      setDriveStatus("busy","Connecting to our private Drive…");
      const status=await workerFetch("/api/owner/status");
      const statusData=await status.json().catch(()=>({}));
      if(!statusData.configured || statusData.token_refresh_ok===false) throw new Error("Owner Google Drive 还没有准备好，请检查 Cloudflare Worker Secret。");
      await resolveDriveContext();
      driveReady=true;
      if(driveSetupNote) driveSetupNote.hidden=true;
      if(driveAddBtn) driveAddBtn.hidden=false;
      if(driveRefreshBtn) driveRefreshBtn.hidden=false;
      setDriveStatus("connected","Google Drive connected");
      await listMemories();
      return true;
    }catch(err){
      driveReady=false;
      if(driveAddBtn) driveAddBtn.hidden=true;
      if(driveRefreshBtn) driveRefreshBtn.hidden=true;
      setDriveStatus("error","Google Drive connection failed");
      showToast(err.message||"Google Drive 连接失败","error");
      return false;
    }finally{ driveStatusPromise=null; }
  })();
  return driveStatusPromise;
}
async function ensureDriveReady(){ return driveReady && driveFolderId ? true : await initOwnerDrive(true); }
function formatBytes(bytes){
  const n=Number(bytes||0); if(!n) return "—"; const units=["B","KB","MB","GB"]; let i=0,v=n;
  while(v>=1024&&i<units.length-1){v/=1024;i++;}
  return `${v.toFixed(v>=10||i===0?0:1)} ${units[i]}`;
}
function memoryCardHTML(item,index){
  const title=escapeHTML(item.appProperties?.oj_title||item.name);
  const date=escapeHTML(item.appProperties?.oj_date||item.createdTime?.slice(0,10)||"");
  const note=escapeHTML(item.appProperties?.oj_note||"");
  const kind=item.mimeType?.startsWith("video/")?"video":"photo";
  const posterId=item.appProperties?.oj_posterId||"";
  const mediaId=kind==="video"?posterId:item.id;
  const textStyle=memoryTextStyle(item);
  return `<article class="memory-card" ${textStyle} data-memory-index="${index}">
    <button class="memory-visual" type="button" aria-label="Open ${title}">
      <div class="memory-media-shell" data-memory-media data-id="${escapeHTML(mediaId)}" data-kind="${kind}" data-name="${escapeHTML(item.name)}"><span class="memory-loading">♡</span></div>
      ${kind==='video'?'<span class="memory-type">VIDEO</span>':''}
    </button>
    <div class="memory-meta"><div><span>${date}</span><h3>${title}</h3></div><span class="memory-size">${formatBytes(item.size)}</span></div>
    ${note?`<p>${note}</p>`:""}
    <div class="memory-actions">
      <button class="memory-edit-btn" type="button" data-memory-edit aria-label="Edit ${title}" title="Edit memory">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3Z"/><path d="m14.5 7.5 2 2"/></svg>
        <span>Edit</span>
      </button>
      <button class="memory-delete-btn" type="button" data-memory-delete aria-label="Delete ${title}" title="Delete memory">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h6M10 5V4h4v1m-8 2h12m-9 0 .6 11h8.8L19 7m-7 3v6m-3-6-.5 6m7-6-.5 6"/></svg>
        <span>Delete</span>
      </button>
    </div>
  </article>`;
}
async function listMemories(){
  if(!memoryGrid||!memoryEmpty) return;
  if(!driveContext.rootId){ await resolveDriveContext(); }
  const ids=[driveContext.rootId,driveContext.photosId,driveContext.videosId].filter(Boolean);
  const qs=ids.map(id=>`folderId=${encodeURIComponent(id)}`).join("&");
  const response=await workerFetch(`/api/drive/list?${qs}`);
  const data=await response.json();
  const all=(data.files||[]).filter(item=>{
    const kind=item.appProperties?.oj_kind;
    return kind==="photo"||kind==="video";
  });
  const seen=new Set();
  driveMemories=all.filter(item=>!seen.has(item.id)&&seen.add(item.id));
  memoryGrid.innerHTML=""; memoryGrid.appendChild(memoryEmpty); memoryEmpty.hidden=!driveMemories.length;
  if(!driveMemories.length) return;
  driveMemories.forEach((item,index)=>memoryGrid.insertAdjacentHTML("beforeend",memoryCardHTML(item,index)));
  await hydrateMemoryMedia();
}
async function fetchDriveBlob(fileId){ if(!fileId) throw new Error("缺少媒体文件 ID。"); return (await workerFetch(`/api/drive/media/${encodeURIComponent(fileId)}`)).blob(); }
async function hydrateMemoryMedia(){
  const nodes=[...document.querySelectorAll("[data-memory-media]")]; if(!nodes.length) return;
  const load=n=>loadMemoryThumb(n).catch(()=>{});
  if(!("IntersectionObserver" in window)){ await Promise.all(nodes.map(load)); return; }
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){observer.unobserve(entry.target);load(entry.target);}}),{rootMargin:"160px"});
  nodes.forEach(n=>observer.observe(n));
}
async function loadMemoryThumb(shell){
  if(shell.dataset.loaded==="1") return; shell.dataset.loaded="1";
  const id=shell.dataset.id; if(!id){shell.innerHTML='<span class="memory-fallback">Video</span>';return;}
  try{const blob=await fetchDriveBlob(id);const url=URL.createObjectURL(blob);shell.innerHTML=`<img src="${url}" alt="Memory" loading="lazy">`;shell.dataset.objectUrl=url;}
  catch{shell.innerHTML='<span class="memory-fallback">♡</span>';}
}
function openMemoryModal(){
  if(!driveReady){showToast("Google Drive 还在连接，请稍等片刻。","error");initOwnerDrive(true);return;}
  if(memoryDate) memoryDate.value=isoToday(); if(memoryTitleInput) memoryTitleInput.value=""; if(memoryNote) memoryNote.value=""; if(memoryFile) memoryFile.value="";
  if(memoryFileName) memoryFileName.textContent="Nothing selected yet"; if(memoryPreview){memoryPreview.hidden=true;memoryPreview.innerHTML="";}
  if(memoryProgress) memoryProgress.hidden=true; memoryModal.hidden=false; memoryModal.setAttribute("aria-hidden","false"); document.body.style.overflow="hidden";
}
function closeMemoryModal(){if(!memoryModal)return;memoryModal.hidden=true;memoryModal.setAttribute("aria-hidden","true");document.body.style.overflow="";if(memoryPreview)memoryPreview.innerHTML="";}
function setProgress(label,value){if(memoryProgress)memoryProgress.hidden=false;if(memoryProgressLabel)memoryProgressLabel.textContent=label;if(memoryProgressValue)memoryProgressValue.textContent=`${Math.round(value)}%`;if(memoryProgressBar)memoryProgressBar.style.width=`${Math.max(0,Math.min(100,value))}%`;}
async function previewSelectedFile(){
  const file=memoryFile.files?.[0];if(!file)return;memoryFileName.textContent=`${file.name} · ${formatBytes(file.size)}`;const url=URL.createObjectURL(file);
  memoryPreview.innerHTML=file.type.startsWith("video/")?`<video src="${url}" controls muted playsinline></video>`:`<img src="${url}" alt="Selected memory">`;memoryPreview.hidden=false;
}
async function prepareImage(file,pastel){
  let source,width,height,cleanup=()=>{};
  if(window.createImageBitmap){const bitmap=await createImageBitmap(file);source=bitmap;width=bitmap.width;height=bitmap.height;cleanup=()=>bitmap.close();}
  else{const url=URL.createObjectURL(file);const img=new Image();img.src=url;await new Promise((r,j)=>{img.onload=r;img.onerror=j;});source=img;width=img.naturalWidth;height=img.naturalHeight;cleanup=()=>URL.revokeObjectURL(url);}
  const maxSide=2560,scale=Math.min(1,maxSide/Math.max(width,height)),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;const ctx=canvas.getContext("2d",{alpha:false});if(pastel)ctx.filter="saturate(0.95) brightness(1.015) sepia(0.02)";ctx.drawImage(source,0,0,w,h);cleanup();
  const blob=await new Promise((r,j)=>canvas.toBlob(b=>b?r(b):j(new Error("图片压缩失败")),"image/jpeg",0.9));return new File([blob],file.name.replace(/\.[^.]+$/i,"")+".jpg",{type:"image/jpeg",lastModified:Date.now()});
}
async function createVideoPoster(file){
  const url=URL.createObjectURL(file),video=document.createElement("video");video.preload="metadata";video.muted=true;video.playsInline=true;video.src=url;
  await new Promise((r,j)=>{video.onloadedmetadata=r;video.onerror=()=>j(new Error("无法读取视频预览"));});
  const seekTime=Math.min(1.5,Math.max(0,(video.duration||1)/3));await new Promise((r,j)=>{video.currentTime=seekTime;video.onseeked=r;video.onerror=()=>j(new Error("无法生成视频封面"));});
  const maxSide=1280,scale=Math.min(1,maxSide/Math.max(video.videoWidth,video.videoHeight)),w=Math.max(1,Math.round(video.videoWidth*scale)),h=Math.max(1,Math.round(video.videoHeight*scale));
  const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;canvas.getContext("2d").drawImage(video,0,0,w,h);
  const blob=await new Promise((r,j)=>canvas.toBlob(b=>b?r(b):j(new Error("无法生成视频封面")),"image/jpeg",0.86));URL.revokeObjectURL(url);video.remove();
  return new File([blob],file.name.replace(/\.[^.]+$/i,"")+"-poster.jpg",{type:"image/jpeg",lastModified:Date.now()});
}
async function uploadViaWorker(file,metadata){
  const form=new FormData();form.append("metadata",JSON.stringify(metadata));form.append("file",file,file.name);const response=await workerFetch("/api/drive/upload",{method:"POST",body:form});return response.json();
}
async function deleteViaWorker(fileId){
  if(!fileId) return false;
  try{
    const response=await workerFetch(`/api/drive/file/${encodeURIComponent(fileId)}`,{method:"DELETE"});
    return response.ok;
  }catch(error){
    console.warn("Drive delete failed", error);
    return false;
  }
}

function ensureDeleteDialog(){
  let dialog=document.getElementById("memoryDeleteDialog");
  if(dialog) return dialog;
  dialog=document.createElement("div");
  dialog.id="memoryDeleteDialog";
  dialog.className="memory-delete-dialog";
  dialog.hidden=true;
  dialog.innerHTML=`<div class="memory-delete-backdrop" data-delete-cancel></div>
    <div class="memory-delete-sheet" role="dialog" aria-modal="true" aria-labelledby="memoryDeleteTitle">
      <button class="memory-delete-close" type="button" data-delete-cancel aria-label="Close">×</button>
      <div class="memory-delete-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 5h6M10 5V4h4v1m-8 2h12m-9 0 .6 11h8.8L19 7m-7 3v6m-3-6 .5 6m7-6-.5 6"/></svg></div>
      <span class="memory-delete-eyebrow">PRIVATE MEMORY</span>
      <h3 id="memoryDeleteTitle">Delete this memory?</h3>
      <p id="memoryDeleteText">This memory will be permanently removed from the private Google Drive.</p>
      <div class="memory-delete-actions">
        <button type="button" class="memory-delete-keep" data-delete-cancel>Keep it</button>
        <button type="button" class="memory-delete-confirm" data-delete-confirm><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h6M10 5V4h4v1m-8 2h12m-9 0 .6 11h8.8L19 7m-7 3v6m-3-6 .5 6m7-6-.5 6"/></svg><span>Delete memory</span></button>
      </div>
    </div>`;
  document.body.appendChild(dialog);
  return dialog;
}

function confirmDeleteMemory(title){
  const dialog=ensureDeleteDialog();
  const text=dialog.querySelector("#memoryDeleteText");
  const confirm=dialog.querySelector("[data-delete-confirm]");
  if(text) text.textContent=`“${title}” will be permanently removed from the private Google Drive.`;
  dialog.hidden=false;
  document.body.style.overflow="hidden";
  return new Promise(resolve=>{
    const cleanup=result=>{
      dialog.hidden=true;
      document.body.style.overflow="";
      dialog.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };
    const onClick=event=>{
      if(event.target.closest("[data-delete-confirm]")){cleanup(true);return;}
      if(event.target.closest("[data-delete-cancel]")){cleanup(false);}
    };
    const onKey=event=>{if(event.key==="Escape") cleanup(false);};
    dialog.addEventListener("click",onClick);
    document.addEventListener("keydown",onKey);
    confirm?.focus();
  });
}

async function deleteMemory(item){
  if(!item?.id) return;
  const title=item.appProperties?.oj_title||item.name||"this memory";
  const approved=await confirmDeleteMemory(title);
  if(!approved) return;
  showToast("Deleting this memory…");
  const deleted=await deleteViaWorker(item.id);
  if(!deleted){showToast("删除失败，请稍后再试。","error");return;}
  const posterId=item.appProperties?.oj_posterId||"";
  if(posterId) await deleteViaWorker(posterId);
  showToast(`已删除：${title}`,"success");
  await listMemories();
}
async function uploadMemory(){
  const file=memoryFile.files?.[0];if(!file){showToast("先选择一张照片或一个视频。","error");return;}if(!memoryDate.value){showToast("请选择日期。","error");return;}if(!await ensureDriveReady())return;
  const kind=file.type.startsWith("video/")?"video":"photo";const targetId=kind==="video"?driveContext.videosId:driveContext.photosId;if(!targetId){showToast(`没有找到 ${kind==='video'?"Videos":"Photos"} 文件夹。` ,"error");return;}
  const title=(memoryTitleInput.value||file.name).trim().slice(0,80),note=memoryNote.value.trim().slice(0,240);memoryUploadBtn.disabled=true;let posterId="";
  try{
    let uploadFile=file;setProgress("Preparing your memory…",6);if(file.type.startsWith("image/"))uploadFile=await prepareImage(file,memorySoftTone.checked);
    if(kind==="video"){
      setProgress("Making a soft video cover…",14);const poster=await createVideoPoster(file);const posterMeta={name:poster.name,parents:[driveContext.thumbnailsId],appProperties:{oj_kind:"poster",oj_parentName:file.name}};
      const posterResult=await uploadViaWorker(poster,posterMeta);posterId=posterResult.id||"";if(!posterId)throw new Error("视频封面上传失败。");
    }
    setProgress("Uploading to our private Google Drive…",24);
    const metadata={name:uploadFile.name,parents:[targetId],appProperties:{oj_kind:kind,oj_date:memoryDate.value,oj_title:title,oj_note:note,oj_posterId:posterId,oj_originalName:file.name}};
    const result=await uploadViaWorker(uploadFile,metadata);if(!result?.id)throw new Error("Google Drive 没有返回文件 ID。");
    setProgress("Saved to our little cabinet",100);showToast(`已保存：${title}`,"success");closeMemoryModal();await listMemories();
  }catch(err){console.error(err);if(posterId)await deleteViaWorker(posterId);showToast(err.message||"保存记忆失败","error");}
  finally{memoryUploadBtn.disabled=false;}
}

/* v11 — memory text/style editor */
const memoryTextEditorState={item:null};
const EDITOR_FONT_OPTIONS={
  cormorant:{label:"Cormorant Garamond",family:'"Cormorant Garamond",serif'},
  parisienne:{label:"Parisienne",family:'Parisienne,cursive'},
  dm:{label:"DM Sans",family:'"DM Sans",sans-serif'},
  georgia:{label:"Georgia",family:'Georgia,serif'},
  system:{label:"System",family:'system-ui,sans-serif'}
};
function safeEditorFont(value){return EDITOR_FONT_OPTIONS[String(value||"")]?String(value):"cormorant";}
function safeEditorSize(value,base=24){const n=Number(value);return Number.isFinite(n)?Math.max(12,Math.min(48,Math.round(n))):base;}
function safeEditorColor(value,base="#65486d"){return /^#[0-9a-f]{6}$/i.test(String(value||""))?String(value):base;}
function safeEditorAlign(value){return ["left","center"].includes(String(value))?String(value):"left";}
function memoryTextStyle(item){
  const props=item?.appProperties||{};
  const titleFont=safeEditorFont(props.oj_titleFont);
  const noteFont=safeEditorFont(props.oj_noteFont||"dm");
  const titleSize=safeEditorSize(props.oj_titleSize,24);
  const noteSize=safeEditorSize(props.oj_noteSize,10);
  const titleColor=safeEditorColor(props.oj_titleColor,"#65486d");
  const noteColor=safeEditorColor(props.oj_noteColor,"#9b839f");
  const align=safeEditorAlign(props.oj_textAlign);
  return `style="--memory-title-font:${EDITOR_FONT_OPTIONS[titleFont].family};--memory-title-size:${titleSize}px;--memory-title-color:${titleColor};--memory-note-font:${EDITOR_FONT_OPTIONS[noteFont].family};--memory-note-size:${noteSize}px;--memory-note-color:${noteColor};--memory-text-align:${align}"`;
}
function ensureMemoryTextEditor(){
  let modal=document.getElementById("memoryTextEditor");
  if(modal) return modal;
  modal=document.createElement("div");modal.id="memoryTextEditor";modal.className="memory-text-editor";modal.hidden=true;
  modal.innerHTML=`<div class="memory-text-backdrop" data-text-editor-close></div>
  <section class="memory-text-sheet" role="dialog" aria-modal="true" aria-labelledby="memoryTextEditorTitle">
    <button class="memory-text-close" type="button" data-text-editor-close aria-label="Close">×</button>
    <div class="memory-text-head"><span class="memory-text-eyebrow">MEMORY DETAILS</span><h3 id="memoryTextEditorTitle">Edit this memory</h3><p>Change the date, words and typography. Your photo and video stay untouched.</p></div>
    <div class="memory-text-grid">
      <label><span>Date</span><input type="date" data-text-field="date"></label>
      <label><span>Title</span><input type="text" maxlength="80" data-text-field="title" placeholder="A little moment"></label>
      <label class="memory-text-wide"><span>Note</span><textarea maxlength="240" data-text-field="note" placeholder="Add a little story…"></textarea></label>
      <div class="memory-style-card memory-text-wide"><div class="memory-style-title"><span>Title style</span><i>Preview</i></div>
        <div class="memory-style-grid">
          <label><span>Font</span><select data-text-field="titleFont">${Object.entries(EDITOR_FONT_OPTIONS).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join("")}</select></label>
          <label><span>Size</span><input type="range" min="18" max="40" step="1" data-text-field="titleSize"><b data-text-value="titleSize"></b></label>
          <label><span>Color</span><input type="color" data-text-field="titleColor"></label>
          <div class="memory-style-preview" data-text-preview="title">Our little moment</div>
        </div>
      </div>
      <div class="memory-style-card memory-text-wide"><div class="memory-style-title"><span>Note style</span><i>Preview</i></div>
        <div class="memory-style-grid">
          <label><span>Font</span><select data-text-field="noteFont">${Object.entries(EDITOR_FONT_OPTIONS).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join("")}</select></label>
          <label><span>Size</span><input type="range" min="9" max="18" step="1" data-text-field="noteSize"><b data-text-value="noteSize"></b></label>
          <label><span>Color</span><input type="color" data-text-field="noteColor"></label>
          <div class="memory-style-preview memory-style-preview-note" data-text-preview="note">A soft little note, just for us.</div>
        </div>
      </div>
      <div class="memory-style-card memory-text-wide"><div class="memory-style-title"><span>Alignment</span><i>Card text</i></div>
        <div class="memory-align-picker" role="group" aria-label="Text alignment"><button type="button" data-text-align="left">Left</button><button type="button" data-text-align="center">Center</button></div>
      </div>
    </div>
    <div class="memory-text-actions"><button class="memory-text-cancel" type="button" data-text-editor-close>Cancel</button><button class="memory-text-save" type="button" data-text-editor-save>Save changes</button></div>
  </section>`;
  document.body.appendChild(modal);
  const updatePreview=()=>{
    const get=k=>modal.querySelector(`[data-text-field="${k}"]`);
    const tf=safeEditorFont(get("titleFont")?.value);const nf=safeEditorFont(get("noteFont")?.value||"dm");
    const ts=safeEditorSize(get("titleSize")?.value,24);const ns=safeEditorSize(get("noteSize")?.value,10);
    const tc=safeEditorColor(get("titleColor")?.value,"#65486d");const nc=safeEditorColor(get("noteColor")?.value,"#9b839f");
    const tp=modal.querySelector('[data-text-preview="title"]');const np=modal.querySelector('[data-text-preview="note"]');
    if(tp){tp.style.cssText=`font-family:${EDITOR_FONT_OPTIONS[tf].family};font-size:${ts}px;color:${tc}`;tp.textContent=get("title")||"Our little moment";}
    if(np){np.style.cssText=`font-family:${EDITOR_FONT_OPTIONS[nf].family};font-size:${ns}px;color:${nc}`;np.textContent=get("note")||"A soft little note, just for us.";}
    const tv=modal.querySelector('[data-text-value="titleSize"]');const nv=modal.querySelector('[data-text-value="noteSize"]');
    if(tv) tv.textContent=`${ts}px`;if(nv) nv.textContent=`${ns}px`;
  };
  modal.addEventListener("input",e=>{if(e.target.matches("[data-text-field]"))updatePreview();});
  modal.addEventListener("change",e=>{if(e.target.matches("[data-text-field]"))updatePreview();});
  modal.addEventListener("click",e=>{
    if(e.target.closest("[data-text-editor-close]")){closeMemoryTextEditor();return;}
    const align=e.target.closest("[data-text-align]");if(align){modal.dataset.align=align.dataset.textAlign;modal.querySelectorAll("[data-text-align]").forEach(b=>b.classList.toggle("active",b===align));}
    if(e.target.closest("[data-text-editor-save]"))saveMemoryTextEditor();
  });
  return modal;
}
function openMemoryTextEditor(item){
  if(!item?.id||!driveReady)return;
  const modal=ensureMemoryTextEditor();const p=item.appProperties||{};memoryTextEditorState.item=item;
  const vals={date:p.oj_date||item.createdTime?.slice(0,10)||isoToday(),title:p.oj_title||item.name||"",note:p.oj_note||"",titleFont:safeEditorFont(p.oj_titleFont),titleSize:safeEditorSize(p.oj_titleSize,24),titleColor:safeEditorColor(p.oj_titleColor,"#65486d"),noteFont:safeEditorFont(p.oj_noteFont||"dm"),noteSize:safeEditorSize(p.oj_noteSize,10),noteColor:safeEditorColor(p.oj_noteColor,"#9b839f")};
  Object.entries(vals).forEach(([k,v])=>{const el=modal.querySelector(`[data-text-field="${k}"]`);if(el)el.value=String(v);});
  modal.dataset.align=safeEditorAlign(p.oj_textAlign);modal.querySelectorAll("[data-text-align]").forEach(b=>b.classList.toggle("active",b.dataset.textAlign===modal.dataset.align));
  modal.hidden=false;modal.setAttribute("aria-hidden","false");document.body.style.overflow="hidden";
  modal.querySelector('[data-text-field="title"]')?.focus();
  ["title","note","titleFont","titleSize","titleColor","noteFont","noteSize","noteColor"].forEach(k=>{const el=modal.querySelector(`[data-text-field="${k}"]`);if(el)el.dispatchEvent(new Event("input",{bubbles:true}));});
}
function closeMemoryTextEditor(){const modal=document.getElementById("memoryTextEditor");if(!modal)return;modal.hidden=true;modal.setAttribute("aria-hidden","true");document.body.style.overflow="";memoryTextEditorState.item=null;}
async function saveMemoryTextEditor(){
  const item=memoryTextEditorState.item,modal=ensureMemoryTextEditor();if(!item)return;
  if(!(await ensureDriveReady()))return;
  const get=k=>modal.querySelector(`[data-text-field="${k}"]`)?.value||"";
  const metadata={
    name:item.name,
    appProperties:{...(item.appProperties||{}),oj_kind:item.appProperties?.oj_kind||"photo",oj_date:get("date")||isoToday(),oj_title:get("title").trim().slice(0,80)||item.name,oj_note:get("note").trim().slice(0,240),oj_titleFont:safeEditorFont(get("titleFont")),oj_titleSize:String(safeEditorSize(get("titleSize"),24)),oj_titleColor:safeEditorColor(get("titleColor"),"#65486d"),oj_noteFont:safeEditorFont(get("noteFont")||"dm"),oj_noteSize:String(safeEditorSize(get("noteSize"),10)),oj_noteColor:safeEditorColor(get("noteColor"),"#9b839f"),oj_textAlign:safeEditorAlign(modal.dataset.align)}
  };
  const btn=modal.querySelector("[data-text-editor-save]");if(btn)btn.disabled=true;
  try{showToast("Saving memory details…");const response=await workerFetch("/api/drive/update",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileId:item.id,metadata})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error?.message||result.error_description||"保存记忆信息失败");closeMemoryTextEditor();showToast("Memory details updated.","success");await listMemories();}
  catch(error){console.error(error);showToast(error.message||"保存失败","error");}
  finally{if(btn)btn.disabled=false;}
}

/* v10 — lightweight in-browser photo editor */
const imageEditorState = {
  item: null,
  source: null,
  sourceUrl: "",
  rotation: 0,
  flipX: false,
  flipY: false,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  grayscale: 0
};

function editorSupportedType(mime){
  return /^image\/(jpeg|png|webp)$/i.test(String(mime||""));
}

function ensureImageEditor(){
  let modal=document.getElementById("memoryImageEditor");
  if(modal) return modal;
  modal=document.createElement("div");
  modal.id="memoryImageEditor";
  modal.className="memory-image-editor";
  modal.hidden=true;
  modal.innerHTML=`<div class="memory-editor-backdrop" data-editor-close></div>
    <section class="memory-editor-sheet" role="dialog" aria-modal="true" aria-labelledby="memoryEditorTitle">
      <button class="memory-editor-close" type="button" data-editor-close aria-label="Close">×</button>
      <div class="memory-editor-head">
        <span class="memory-editor-eyebrow">PHOTO STUDIO</span>
        <h3 id="memoryEditorTitle">Edit your memory</h3>
        <p id="memoryEditorSubtitle">Your original stays untouched until you save the edited version.</p>
      </div>
      <div class="memory-editor-stage">
        <div class="memory-editor-canvas-wrap">
          <canvas id="memoryEditorCanvas" aria-label="Edited photo preview"></canvas>
          <div class="memory-editor-loading" id="memoryEditorLoading">Preparing photo…</div>
        </div>
        <div class="memory-editor-panel">
          <div class="memory-editor-toolgrid">
            <button type="button" class="memory-editor-tool" data-editor-rotate><span>↻</span><small>Rotate</small></button>
            <button type="button" class="memory-editor-tool" data-editor-flip-x><span>↔</span><small>Flip</small></button>
            <button type="button" class="memory-editor-tool" data-editor-reset><span>↺</span><small>Reset</small></button>
          </div>
          <div class="memory-editor-sliders">
            <label><span>Brightness</span><b data-editor-value="brightness">100%</b><input type="range" min="60" max="140" value="100" step="1" data-editor-range="brightness"></label>
            <label><span>Contrast</span><b data-editor-value="contrast">100%</b><input type="range" min="60" max="140" value="100" step="1" data-editor-range="contrast"></label>
            <label><span>Saturation</span><b data-editor-value="saturation">100%</b><input type="range" min="0" max="160" value="100" step="1" data-editor-range="saturation"></label>
            <label><span>Fade to B&amp;W</span><b data-editor-value="grayscale">0%</b><input type="range" min="0" max="100" value="0" step="1" data-editor-range="grayscale"></label>
          </div>
          <div class="memory-editor-tip"><span>♡</span><p>Edits are processed in your browser, then the finished photo replaces the current photo in your private Drive.</p></div>
        </div>
      </div>
      <div class="memory-editor-actions">
        <button type="button" class="memory-editor-cancel" data-editor-close>Cancel</button>
        <button type="button" class="memory-editor-save" data-editor-save>Save changes</button>
      </div>
    </section>`;
  document.body.appendChild(modal);

  modal.addEventListener("click", event=>{
    if(event.target.closest("[data-editor-close]")) closeImageEditor();
    if(event.target.closest("[data-editor-rotate]")){imageEditorState.rotation=(imageEditorState.rotation+90)%360;drawImageEditor();}
    if(event.target.closest("[data-editor-flip-x]")){imageEditorState.flipX=!imageEditorState.flipX;drawImageEditor();}
    if(event.target.closest("[data-editor-reset]")){resetImageEditor();drawImageEditor();}
    if(event.target.closest("[data-editor-save]")) saveImageEdit();
    const range=event.target.closest("[data-editor-range]");
    if(range && range.tagName==="INPUT"){ const key=range.dataset.editorRange; imageEditorState[key]=Number(range.value); updateEditorValue(key); requestAnimationFrame(drawImageEditor); }
  });
  modal.querySelectorAll("[data-editor-range]").forEach(input=>{
    input.addEventListener("input",()=>{
      const key=input.dataset.editorRange;
      imageEditorState[key]=Number(input.value);
      updateEditorValue(key);
      drawImageEditor();
    });
  });
  return modal;
}

function updateEditorValue(key){
  const el=document.querySelector(`[data-editor-value="${key}"]`);
  if(el) el.textContent=`${Math.round(imageEditorState[key])}%`;
}

function resetImageEditor(){
  imageEditorState.rotation=0;
  imageEditorState.flipX=false;
  imageEditorState.flipY=false;
  imageEditorState.brightness=100;
  imageEditorState.contrast=100;
  imageEditorState.saturation=100;
  imageEditorState.grayscale=0;
  document.querySelectorAll("[data-editor-range]").forEach(input=>{
    const key=input.dataset.editorRange;
    input.value=String(imageEditorState[key]);
    updateEditorValue(key);
  });
}

async function loadEditorSource(item){
  const blob=await fetchDriveBlob(item.id);
  if(imageEditorState.sourceUrl) URL.revokeObjectURL(imageEditorState.sourceUrl);
  imageEditorState.sourceUrl=URL.createObjectURL(blob);

  if(window.createImageBitmap){
    try{
      imageEditorState.source=await createImageBitmap(blob);
      return;
    }catch{}
  }
  const img=new Image();
  img.decoding="async";
  img.src=imageEditorState.sourceUrl;
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error("无法读取这张照片。"));});
  imageEditorState.source=img;
}

function drawEditorToCanvas(canvas, maxSide=1800){
  const source=imageEditorState.source;
  if(!source) return;
  const sourceW=source.width||source.naturalWidth;
  const sourceH=source.height||source.naturalHeight;
  const quarterTurn=imageEditorState.rotation%180!==0;
  const outW=quarterTurn?sourceH:sourceW;
  const outH=quarterTurn?sourceW:sourceH;
  const scale=Math.min(1,maxSide/Math.max(outW,outH));
  const w=Math.max(1,Math.round(outW*scale));
  const h=Math.max(1,Math.round(outH*scale));
  canvas.width=w; canvas.height=h;
  const ctx=canvas.getContext("2d",{alpha:true});
  ctx.clearRect(0,0,w,h);
  ctx.save();
  ctx.translate(w/2,h/2);
  ctx.rotate(imageEditorState.rotation*Math.PI/180);
  ctx.scale(imageEditorState.flipX?-1:1,imageEditorState.flipY?-1:1);
  ctx.filter=`brightness(${imageEditorState.brightness}%) contrast(${imageEditorState.contrast}%) saturate(${imageEditorState.saturation}%) grayscale(${imageEditorState.grayscale}%)`;
  ctx.drawImage(source,-sourceW*scale/2,-sourceH*scale/2,sourceW*scale,sourceH*scale);
  ctx.restore();
}

function drawImageEditor(){
  const canvas=document.getElementById("memoryEditorCanvas");
  if(canvas) drawEditorToCanvas(canvas,1800);
}

function openImageEditor(item){
  if(!item?.id) return;
  if(item.mimeType && !editorSupportedType(item.mimeType)){
    showToast("这张照片格式暂不支持浏览器编辑，请使用 JPG、PNG 或 WebP。","error");
    return;
  }
  if(!driveReady){showToast("Google Drive 还在连接，请稍等片刻。","error");return;}
  const modal=ensureImageEditor();
  const loading=modal.querySelector("#memoryEditorLoading");
  const canvas=modal.querySelector("#memoryEditorCanvas");
  const save=modal.querySelector("[data-editor-save]");
  imageEditorState.item=item;
  resetImageEditor();
  modal.hidden=false;
  modal.setAttribute("aria-hidden","false");
  document.body.style.overflow="hidden";
  if(loading) loading.hidden=false;
  if(canvas) canvas.hidden=true;
  if(save) save.disabled=true;
  (async()=>{
    try{
      await loadEditorSource(item);
      if(canvas) canvas.hidden=false;
      if(loading) loading.hidden=true;
      if(save) save.disabled=false;
      drawImageEditor();
    }catch(error){
      if(loading) loading.textContent="Unable to open this photo";
      showToast(error.message||"无法打开照片","error");
    }
  })();
}

function closeImageEditor(){
  const modal=document.getElementById("memoryImageEditor");
  if(!modal) return;
  modal.hidden=true;
  modal.setAttribute("aria-hidden","true");
  document.body.style.overflow="";
  if(imageEditorState.source?.close) imageEditorState.source.close();
  imageEditorState.source=null;
  if(imageEditorState.sourceUrl){URL.revokeObjectURL(imageEditorState.sourceUrl);imageEditorState.sourceUrl="";}
  imageEditorState.item=null;
}

function canvasToEditedFile(item){
  const canvas=document.getElementById("memoryEditorCanvas");
  if(!canvas) return Promise.reject(new Error("编辑画布不存在。"));
  return new Promise((resolve,reject)=>{
    let mime=/^image\/(png|webp|jpeg)$/i.test(item.mimeType||"") ? item.mimeType : "image/jpeg";
    const ext=mime==="image/png"?".png":mime==="image/webp"?".webp":".jpg";
    const done=blob=>{
      if(!blob){reject(new Error("图片导出失败。"));return;}
      resolve(new File([blob],String(item.name||"memory").replace(/\.[^.]+$/,"")+ext,{type:mime,lastModified:Date.now()}));
    };
    canvas.toBlob(done,mime,mime==="image/png"?undefined:0.92);
  });
}

async function saveImageEdit(){
  const item=imageEditorState.item;
  if(!item) return;
  if(!(await ensureDriveReady())) return;
  const modal=ensureImageEditor();
  const save=modal.querySelector("[data-editor-save]");
  if(save) save.disabled=true;
  try{
    showToast("Preparing your edited photo…");
    const file=await canvasToEditedFile(item);
    const props=item.appProperties||{};
    const metadata={
      name:file.name,
      parents:[driveContext.photosId],
      appProperties:{
        oj_kind:"photo",
        oj_date:props.oj_date||item.createdTime?.slice(0,10)||isoToday(),
        oj_title:props.oj_title||item.name||"Edited memory",
        oj_note:props.oj_note||"",
        oj_posterId:"",
        oj_originalName:props.oj_originalName||item.name,
        oj_editedAt:new Date().toISOString()
      }
    };
    const result=await uploadViaWorker(file,metadata);
    if(!result?.id) throw new Error("Google Drive 没有返回新图片 ID。");
    const removed=await deleteViaWorker(item.id);
    closeImageEditor();
    if(!removed){
      showToast("新版本已保存，但旧图片删除失败。请刷新后检查重复文件。","error");
    }else{
      showToast("照片已更新。","success");
    }
    await listMemories();
  }catch(error){
    console.error(error);
    showToast(error.message||"保存编辑结果失败","error");
    if(save) save.disabled=false;
  }
}

function openLightbox(item){
  lightboxMedia.innerHTML='<div class="lightbox-loading">Loading…</div>';
  lightboxCaption.innerHTML=`<strong>${escapeHTML(item.appProperties?.oj_title||item.name)}</strong><span>${escapeHTML(item.appProperties?.oj_date||"")}</span>${item.appProperties?.oj_note?`<p>${escapeHTML(item.appProperties.oj_note)}</p>`:""}`;
  lightbox.hidden=false;lightbox.setAttribute("aria-hidden","false");document.body.style.overflow="hidden";
  (async()=>{try{const kind=item.mimeType?.startsWith("video/")?"video":"photo";const blob=await fetchDriveBlob(item.id);const url=URL.createObjectURL(blob);lightboxMedia.innerHTML=kind==="photo"?`<img src="${url}" alt="Memory">`:`<video src="${url}" controls autoplay playsinline></video>`;}catch{lightboxMedia.innerHTML='<div class="lightbox-error">Unable to open this memory right now.</div>';}})();
}
function closeLightbox(){if(!lightbox)return;lightbox.hidden=true;lightbox.setAttribute("aria-hidden","true");lightboxMedia.innerHTML="";document.body.style.overflow="";}
driveAddBtn?.addEventListener("click",openMemoryModal);
driveRefreshBtn?.addEventListener("click",()=>initOwnerDrive(true));
memoryFile?.addEventListener("change",previewSelectedFile);memoryUploadBtn?.addEventListener("click",uploadMemory);
document.querySelectorAll("[data-memory-close]").forEach(el=>el.addEventListener("click",closeMemoryModal));document.querySelectorAll("[data-lightbox-close]").forEach(el=>el.addEventListener("click",closeLightbox));
memoryGrid?.addEventListener("click",event=>{
  const editButton=event.target.closest("[data-memory-edit]");
  if(editButton){
    event.preventDefault();
    event.stopPropagation();
    const card=editButton.closest("[data-memory-index]");
    const index=Number(card?.dataset.memoryIndex);
    if(Number.isInteger(index)&&driveMemories[index]) openMemoryTextEditor(driveMemories[index]);
    return;
  }
  const deleteButton=event.target.closest("[data-memory-delete]");
  if(deleteButton){
    event.preventDefault();
    event.stopPropagation();
    const card=deleteButton.closest("[data-memory-index]");
    const index=Number(card?.dataset.memoryIndex);
    if(Number.isInteger(index)&&driveMemories[index]) deleteMemory(driveMemories[index]);
    return;
  }
  const card=event.target.closest("[data-memory-index]");
  if(!card)return;
  const index=Number(card.dataset.memoryIndex);
  if(Number.isInteger(index)&&driveMemories[index])openLightbox(driveMemories[index]);
});
if(driveSetupNote&&workerConfigured())driveSetupNote.innerHTML='<span>♡</span><div><strong>Private by design</strong><p>This shared memory cabinet uses your private Google Drive through a secure Cloudflare Worker. Visitors do not need to sign in to Google.</p></div>';
setDriveStatus("busy","Connecting to our private Drive…");
window.addEventListener("pageshow",()=>initOwnerDrive(false));
window.addEventListener("focus",()=>{if(!driveReady)initOwnerDrive(false);});
