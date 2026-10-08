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
  output.textContent = count.toLocaleString('zh-CN');
  output.setAttribute('aria-label', `已经相恋 ${count} 天`);
}
updateDaysTogether();
window.addEventListener('pageshow', updateDaysTogether);
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

let pendingInstall = null;
const dialog = $('installDialog');
const installOpen = $('installOpen');
const nativeInstall = $('nativeInstall');
const instructions = $('installInstructions');

function platformInstructions() {
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return '在 Safari 中打开网站，点击“分享”→“添加到主屏幕”，即可从桌面打开我们的世界。';
  if (/Android/i.test(ua)) return '在 Chrome 中打开菜单，选择“安装应用”或“添加到主屏幕”。';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Safari 可以选择“分享”→“添加到程序坞”；Chrome 则可以在浏览器菜单中选择“安装”。';
  return '在 Chrome 或 Edge 的地址栏或菜单中，选择“安装应用”，即可添加统一的 Our Love Hub 图标。';
}
function openDialog() {
  if (!dialog) return;
  instructions.textContent = platformInstructions();
  nativeInstall.hidden = !pendingInstall;
  dialog.hidden = false;
  document.body.classList.add('dialog-open');
  dialog.querySelector('.dialog-close')?.focus();
}
function closeDialog() {
  if (!dialog) return;
  dialog.hidden = true;
  document.body.classList.remove('dialog-open');
  installOpen?.focus();
}
installOpen?.addEventListener('click', openDialog);
document.querySelectorAll('[data-close-install]').forEach(node => node.addEventListener('click', closeDialog));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !dialog?.hidden) closeDialog();
});
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  pendingInstall = event;
});
nativeInstall?.addEventListener('click', async () => {
  if (!pendingInstall) return;
  const event = pendingInstall;
  pendingInstall = null;
  await event.prompt();
  await event.userChoice;
  closeDialog();
});
window.addEventListener('appinstalled', () => { pendingInstall = null; closeDialog(); });
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', {scope:'./'}).catch(() => {});
  });
}
