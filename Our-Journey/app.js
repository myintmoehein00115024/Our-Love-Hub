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
  const next = $('nextAnniversary');
  if (next) {
    const thisYear = now.getFullYear();
    const anniversaryThisYear = Date.UTC(thisYear, 2, 23);
    const nextYear = day > anniversaryThisYear ? thisYear + 1 : thisYear;
    const daysRemaining = Math.round((Date.UTC(nextYear, 2, 23) - day) / 86400000);
    next.textContent = daysRemaining === 0
      ? '今天是我们的相恋纪念日 ♡'
      : `下一次 3 月 23 日纪念日，还有 ${daysRemaining} 天 ♡`;
  }
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

// Install only the unified root application; subpages never create separate apps.
$('installOpen')?.addEventListener('click', () => {
  window.location.assign(window.OurLoveRoutes?.hub || new URL('../', location.href).href);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', {scope:'./'}).catch(() => {});
  });
}


// Only metadata is read for the bell, and only after this browser has previously
// configured the HE / SHE chat with its private room ID. No secret in page source.
(() => {
  const bell = document.getElementById('chatBell');
  const counter = document.getElementById('chatBellCount');
  if (!bell || !counter || !('indexedDB' in window)) return;
  const CHAT_API = 'https://zegjegutcigbydtzggur.supabase.co/functions/v1/always-yours-chat';
  const chatDbName = 'always-yours-private-device-v1';
  let activeFetch = false;
  let roomPromise = null;
  let previousUnread = null;
  let soundEnabled = false;
  let audioContext = null;
  // Sound requires a user gesture; locked/background devices depend on Web Push.
  function enableBellSound() {
    soundEnabled = true;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    } catch { soundEnabled = false; }
  }
  function playBell() {
    if (!soundEnabled || !audioContext || document.hidden) return;
    try {
      const now = audioContext.currentTime;
      [0, .17].forEach((offset, i) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = i ? 988 : 784;
        gain.gain.setValueAtTime(.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(.09, now + offset + .02);
        gain.gain.exponentialRampToValueAtTime(.0001, now + offset + .42);
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + .44);
      });
    } catch {}
  }
  document.addEventListener('pointerdown', enableBellSound, {once:true});
  document.addEventListener('keydown', enableBellSound, {once:true});
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('always-yours-chat-events') : null;
  if (channel) channel.onmessage = event => {
    if (event.data?.type === 'messages-updated') updateBell();
  };
  function getRoomFromDevice() {
    if (roomPromise) return roomPromise;
    roomPromise = new Promise(resolve => {
      let request;
      try { request = indexedDB.open(chatDbName); } catch { resolve(null); return; }
      request.onerror = () => resolve(null);
      request.onupgradeneeded = () => { request.transaction?.abort(); resolve(null); };
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('secrets')) { db.close(); resolve(null); return; }
        const tx = db.transaction('secrets','readonly');
        const read = tx.objectStore('secrets').get('room');
        read.onsuccess = () => { const value = read.result?.room; resolve(typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) ? value : null); };
        read.onerror = () => resolve(null);
        tx.oncomplete = () => db.close();
      };
    });
    return roomPromise;
  }
  async function updateBell() {
    if (activeFetch || document.hidden || !navigator.onLine) return;
    activeFetch = true;
    try {
      const roomId = await getRoomFromDevice();
      const role = localStorage.getItem('alwaysYoursName');
      if (!roomId || !['Ko Ko','Chit Chit'].includes(role)) {
        counter.hidden = true;
        bell.classList.remove('has-unread');
        previousUnread = null;
        return;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      let response;
      try { response = await fetch(CHAT_API + '/api/messages', {headers:{'X-Room-Key':roomId},cache:'no-store',signal:controller.signal}); }
      finally {clearTimeout(timeout);}
      if (!response.ok) return;
      const payload = await response.json();
      const unread = (Array.isArray(payload.messages) ? payload.messages : []).filter(m => m.sender !== role && !m.seen_at && Number(m.expires_at)>Date.now()).length;
      if (previousUnread !== null && unread > previousUnread) playBell();
      previousUnread = unread;
      counter.textContent = unread > 99 ? '99+' : String(unread);
      counter.hidden = unread === 0;
      bell.classList.toggle('has-unread', unread > 0);
      bell.setAttribute('aria-label', unread ? `打开悄悄话，${unread} 条未读消息` : '打开悄悄话，没有未读消息');
      document.title = unread ? `（${unread > 99 ? '99+' : unread}）Our Journey · 悄悄话 ♡` : 'Our Journey · 只属于我们的故事 ♡';
    } catch { /* Network/authorization failure: never pretend to have read messages. */ }
    finally {activeFetch = false;}
  }
  updateBell();
  window.setInterval(updateBell, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { roomPromise = null; updateBell(); } });
  window.addEventListener('pageshow', () => { roomPromise = null; updateBell(); });
  window.addEventListener('storage', event => { if (event.key === 'alwaysYoursName') { roomPromise = null; previousUnread = null; updateBell(); } });
})();
