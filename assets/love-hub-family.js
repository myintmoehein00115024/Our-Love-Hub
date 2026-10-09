(() => {
  'use strict';
  const current = /\/2025-For-My-Girlfriend\//.test(location.pathname) ? '2025' : '2026';
  document.querySelectorAll('.hub-family-links a').forEach(link => {
    if (link.dataset.hubPage === current) link.setAttribute('aria-current', 'page');
  });
  // Refresh the local 2025 offline cache after the design update, without
  // creating another installable app. The only install entry is the Hub root.
  if (current === '2025' && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('./service-worker.js', {scope:'./', updateViaCache:'none'}).catch(()=>{});
  }
  const installBtn = document.querySelector('[data-hub-install]');
  if (!installBtn) return;
  const dialog = document.createElement('div');
  dialog.className = 'hub-family-popup';
  dialog.setAttribute('role','presentation');
  dialog.hidden = true;
  dialog.innerHTML = `<div class="hub-family-popup-card" role="dialog" aria-modal="true" aria-labelledby="hub-install-title">
    <button class="hub-popup-close" type="button" aria-label="关闭">×</button>
    <div class="hub-popup-heart" aria-hidden="true">♡</div>
    <h2 id="hub-install-title">只保留一个 Our Love Hub ♡</h2>
    <p>为了避免桌面出现 2025、2026 两个重复图标，请先打开总首页，再使用浏览器的“添加到主屏幕 / 安装应用”。这样保留统一的 Our Love Hub 入口。</p>
    <a class="hub-popup-link" href="../">前往 Our Love Hub 总首页 ↗</a>
  </div>`;
  document.body.append(dialog);
  const close = dialog.querySelector('.hub-popup-close');
  const shut = () => {dialog.hidden=true;installBtn.focus({preventScroll:true});};
  installBtn.addEventListener('click',()=> {dialog.hidden=false;close.focus({preventScroll:true});});
  close.addEventListener('click',shut);
  dialog.addEventListener('click',(e)=>{if(e.target===dialog)shut();});
  document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&!dialog.hidden)shut();});
})();
