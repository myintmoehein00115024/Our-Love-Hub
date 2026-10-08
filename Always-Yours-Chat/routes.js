/* Our Love Hub — central Chat routes, with Supabase Edge Function URL (public, not secret). */
(() => {
  "use strict";
  const chatRoot = new URL("./", document.currentScript?.src || location.href);
  const siteRoot = new URL("../", chatRoot);
  window.ALWAYS_YOURS_CHAT_ROUTES = Object.freeze({
    chatHome: chatRoot.href,
    siteHome: siteRoot.href,
    journeyHome: new URL("Our-Journey/", siteRoot).href,
    // Fill after creating a DEDICATED Supabase Chat project. Never paste a secret/service_role key.
    apiBase: ""
  });
})();
