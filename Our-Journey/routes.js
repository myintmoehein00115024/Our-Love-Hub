/* Our Love Hub — site routes and navigation live here.
   Paths are computed from this script's folder, so /Our-Love-Hub/
   and other repository prefixes work without hard-coded domains.
   The original href attributes in index.html remain usable without JS. */
(function () {
  'use strict';
  const scriptUrl = document.currentScript && document.currentScript.src;
  const journeyBase = new URL('.', scriptUrl || document.baseURI);
  const hubBase = new URL('../', journeyBase);
  const routes = Object.freeze({
    hub: hubBase.href,
    journey: journeyBase.href,
    chat: new URL('Always-Yours-Chat/', hubBase).href,
    gift2025: new URL('2025-For-My-Girlfriend/', hubBase).href,
    gift2026: new URL('2026-For-My-Girlfriend/', hubBase).href
  });
  window.OurLoveRoutes = routes;
  document.querySelectorAll('a[data-site-route]').forEach(link => {
    const route = link.getAttribute('data-site-route');
    if (Object.prototype.hasOwnProperty.call(routes, route)) {
      link.href = routes[route];
    }
  });
})();
