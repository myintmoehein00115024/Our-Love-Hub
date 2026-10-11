(() => {
  'use strict';
  const languageKey='olh_language';
  const languages=['my','zh','en'];
  function getLanguage(){
    try{const saved=localStorage.getItem(languageKey);return languages.includes(saved)?saved:'my';}
    catch(_){return 'my';}
  }
  const dialogCopy={
    title:{zh:'只保留一个 Our Love Hub ♡',en:'Keep Just One Our Love Hub ♡',my:'Our Love Hub တစ်ခုတည်းကိုပဲ ထားကြမယ်နော် ♡'},
    description:{zh:'为了避免桌面出现 2025、2026 两个重复图标，请先打开总首页，再使用浏览器的“添加到主屏幕 / 安装应用”。这样保留统一的 Our Love Hub 入口。',en:'To avoid separate 2025 and 2026 icons, open the main Our Love Hub page first, then use your browser’s “Add to Home Screen” or “Install App”. That keeps one entrance for our little world.',my:'ဖုန်းပင်မမျက်နှာပြင်မှာ ၂၀၂၅ နဲ့ ၂၀၂၆ အတွက် အိုင်ကွန်နှစ်ခု မထပ်စေဖို့ Our Love Hub ပင်မစာမျက်နှာကို အရင်ဖွင့်ပါနော်။ ပြီးမှ browser ရဲ့ “Add to Home Screen / Install App” ကို ရွေးလိုက်ရင် တို့နှစ်ယောက်ရဲ့ ကမ္ဘာလေးအတွက် အဝင်ပေါက်တစ်ခုတည်း ရှိနေမှာပါ။'},
    go:{zh:'前往 Our Love Hub 总首页 ↗',en:'Go to the Our Love Hub Home ↗',my:'Our Love Hub ပင်မစာမျက်နှာသို့ သွားမယ် ↗'},
    close:{zh:'关闭',en:'Close',my:'ပိတ်ရန်'}
  };
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
  const close=dialog.querySelector('.hub-popup-close');
  const title=dialog.querySelector('#hub-install-title');
  const description=dialog.querySelector('.hub-family-popup-card p');
  const destination=dialog.querySelector('.hub-popup-link');
  function updateDialog(){
    const lang=getLanguage();
    if(title)title.textContent=dialogCopy.title[lang];
    if(description)description.textContent=dialogCopy.description[lang];
    if(destination)destination.textContent=dialogCopy.go[lang];
    if(close)close.setAttribute('aria-label',dialogCopy.close[lang]);
    dialog.setAttribute('lang',lang==='zh'?'zh-CN':lang);
  }
  document.addEventListener('olh:languagechange',updateDialog);
  window.addEventListener('storage',event=>{if(event.key===languageKey)updateDialog();});
  updateDialog();

  const shut = () => {dialog.hidden=true;installBtn.focus({preventScroll:true});};
  installBtn.addEventListener('click',()=> {updateDialog();dialog.hidden=false;close.focus({preventScroll:true});});
  close.addEventListener('click',shut);
  dialog.addEventListener('click',(e)=>{if(e.target===dialog)shut();});
  document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&!dialog.hidden)shut();});
})();
