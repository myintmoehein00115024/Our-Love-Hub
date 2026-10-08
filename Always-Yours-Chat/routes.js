/* Our Love Hub — Chat paths. Keep routes in this file, never embed passwords. */
(() => {
  'use strict';
  const chatRoot = new URL('./', document.currentScript?.src || location.href);
  const siteRoot = new URL('../', chatRoot);
  window.ALWAYS_YOURS_CHAT_ROUTES = Object.freeze({
    chatHome: chatRoot.href,
    siteHome: siteRoot.href,
    journeyHome: new URL('Our-Journey/', siteRoot).href,
    apiBase: 'https://always-yours-chat-api.myintmoehein0115024.workers.dev'
  });
})();
