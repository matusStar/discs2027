/* swap.js: switch pages without reloading, so the starry canvas never restarts.
   Clicks on internal links fetch the next page, replace only the .initial-content block
   and the title, and update the address bar. If anything goes wrong it falls back to a normal
   page load, so the site keeps working without this script. */
(() => {
  'use strict';
  const SEL = '.initial-content';
  if (!window.fetch || !window.DOMParser || !history.pushState || !document.querySelector(SEL)) return;

  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target || a.hasAttribute('download')) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin) return;
    if (!/\/$|\.html?$|\/[^./]+$/.test(u.pathname)) return;            // leave PDFs, images, etc. alone
    if (u.pathname === location.pathname && u.search === location.search) return;   // same page: normal anchor jump
    e.preventDefault();
    load(u, true);
  });

  async function load(u, push) {
    try {
      const r = await fetch(u.href, { headers: { Accept: 'text/html' } });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('text/html')) throw new Error('not a page');
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      const next = doc.querySelector(SEL);
      if (!next) throw new Error('no content block');
      document.querySelector(SEL).replaceWith(document.importNode(next, true));
      document.title = doc.title;
      document.body.className = doc.body.className;                      // keeps layout--single / layout--splash styling
      if (push) history.pushState({}, '', u.href);
      const sc = document.querySelector('.search-content.is--visible');   // close the search overlay if it was open
      if (sc) document.querySelector('.search__toggle').click();
      const target = u.hash && document.getElementById(decodeURIComponent(u.hash.slice(1)));
      if (target) target.scrollIntoView(); else window.scrollTo(0, 0);
      document.dispatchEvent(new CustomEvent('page:swap'));
    } catch (err) {
      location.href = u.href;
    }
  }
  addEventListener('popstate', () => load(new URL(location.href), false));
})();
