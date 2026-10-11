/* SYF — UI font engine (shared by the page rail, the workspace dock and every
 * standalone extension page).
 *
 * One preference (`ui_font`) picks the typeface for the whole extension UI:
 *   ''            → the system stack (default — zero bytes loaded)
 *   a bundled slug → one of the Google Fonts shipped in fonts/ (OFL, see LICENSE.txt)
 *   'local:NAME'  → any font already installed on the user's own machine
 *
 * ⛔ Nothing here touches the network. The bundled families are woff2 files inside
 * the package and they are loaded as BINARY through the FontFace constructor, not
 * through an @font-face url(). That is deliberate and load-bearing:
 *   - The rail lives in a Shadow DOM inside the HOST page, so an @font-face url()
 *     — even a chrome-extension:// or a data: one — is fetched under the *host
 *     page's* CSP. Any site with `font-src 'self'` (banks, code hosts, most
 *     enterprise apps) would block it and the font would silently vanish on
 *     exactly the pages people use most.
 *   - `new FontFace(name, arrayBuffer)` performs no fetch at all, so no CSP
 *     applies. The bytes arrive over chrome.runtime.getURL + fetch, which runs in
 *     the content script's isolated world and is governed by the extension.
 * A Google Fonts CDN was rejected for the same reason plus privacy: it would send
 * a request to Google from every page the user visits.
 *
 * Google serves each family split by unicode-range; ARABIC_RANGE / LATIN_RANGE are
 * those two ranges verbatim, identical across all twelve bundled families. They must
 * be passed through to the FontFace descriptors — a face that claims the full range
 * but lacks the glyph does NOT fall back to a sibling face of the same family. */
(function () {
  'use strict';
  var SYFS = window.SYFS || (window.SYFS = {});
  if (SYFS.fontkit) return;                       // shared singleton across bootstrap files
  var FK = SYFS.fontkit = {};

  var ARABIC_RANGE = 'U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC, U+102E0-102FB, U+10E60-10E7E, U+10EC2-10EC4, U+10EFC-10EFF, U+1EE00-1EE03, U+1EE05-1EE1F, U+1EE21-1EE22, U+1EE24, U+1EE27, U+1EE29-1EE32, U+1EE34-1EE37, U+1EE39, U+1EE3B, U+1EE42, U+1EE47, U+1EE49, U+1EE4B, U+1EE4D-1EE4F, U+1EE51-1EE52, U+1EE54, U+1EE57, U+1EE59, U+1EE5B, U+1EE5D, U+1EE5F, U+1EE61-1EE62, U+1EE64, U+1EE67-1EE6A, U+1EE6C-1EE72, U+1EE74-1EE77, U+1EE79-1EE7C, U+1EE7E, U+1EE80-1EE89, U+1EE8B-1EE9B, U+1EEA1-1EEA3, U+1EEA5-1EEA9, U+1EEAB-1EEBB, U+1EEF0-1EEF1';
  var LATIN_RANGE = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

  /* [slug, CSS family name, Arabic label, kind] — the picker builds itself from this,
   * and the file names follow `<slug>-<subset>-<weight>.woff2`. */
  FK.FAMILIES = [
    ['tajawal', 'Tajawal', 'تجوّل', 'sans'],
    ['cairo', 'Cairo', 'القاهرة', 'sans'],
    ['almarai', 'Almarai', 'المراعي', 'sans'],
    ['plexarabic', 'IBM Plex Sans Arabic', 'IBM Plex عربي', 'sans'],
    ['notokufi', 'Noto Kufi Arabic', 'نوتو كوفي', 'kufi'],
    ['changa', 'Changa', 'تشانغا', 'kufi'],
    ['readexpro', 'Readex Pro', 'ريدكس برو', 'sans'],
    ['elmessiri', 'El Messiri', 'المسيري', 'sans'],
    ['rubik', 'Rubik', 'روبيك', 'sans'],
    ['alexandria', 'Alexandria', 'الإسكندرية', 'sans'],
    ['notonaskh', 'Noto Naskh Arabic', 'نوتو نسخ', 'naskh'],
    ['amiri', 'Amiri', 'أميري', 'naskh']
  ];
  /* the stack every choice falls back into (and the whole value when nothing is picked) */
  FK.FALLBACK = "'Segoe UI', system-ui, -apple-system, sans-serif";
  FK.DEFAULT = '';                                 /* system stack */
  FK.KEY = 'ui_font';

  function meta(slug) { for (var i = 0; i < FK.FAMILIES.length; i++) if (FK.FAMILIES[i][0] === slug) return FK.FAMILIES[i]; return null; }
  FK.meta = meta;

  /* ⛔ The CSS family we register is NAMESPACED, never the bare upstream name.
   * `document.fonts` on a web page is the HOST page's font set — registering a face
   * literally called "Cairo" would join any family the site itself defines under that
   * name and could change how the SITE renders. "SYF Cairo" can collide with nothing.
   * (A font the user names by hand is not ours to rename — that one is used verbatim.) */
  function cssName(m) { return 'SYF ' + m[1]; }
  FK.cssName = function (slug) { var m = meta(slug); return m ? cssName(m) : ''; };

  /* A locally-installed font name is whatever the user typed, and it is dropped
   * straight into a live CSS font-family value — so it is filtered by WHITELIST, not
   * by blacklisting the dangerous characters. Only letters (Latin + Arabic), digits,
   * spaces and hyphens survive; quotes, semicolons, braces, backslashes, comment
   * markers and control characters cannot be spelled at all. Length-capped.
   * Never turn this into a blacklist. */
  function cleanLocal(name) {
    return String(name || '').replace(/[^0-9A-Za-z؀-ۿ \-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  }
  FK.cleanLocal = cleanLocal;

  /* a stored value → the CSS font-family string to use (always ends in the fallback) */
  FK.stackFor = function (pref) {
    pref = String(pref || '');
    if (pref.indexOf('local:') === 0) {
      var n = cleanLocal(pref.slice(6));
      return n ? "'" + n + "', " + FK.FALLBACK : FK.FALLBACK;
    }
    var m = meta(pref);
    return m ? "'" + cssName(m) + "', " + FK.FALLBACK : FK.FALLBACK;
  };

  /* ---- loading a bundled family --------------------------------------------
   * Four files (arabic/latin × 400/700). Each becomes its own FontFace with the
   * matching weight + unicode-range. Faces are added to `document.fonts`, which the
   * shadow tree resolves against too, so the rail picks them up without its own copy.
   * Results are memoised per slug: a second call while the first is still in flight
   * returns the same promise, and a completed load never re-reads the files. */
  var loads = {};
  FK.load = function (slug) {
    var m = meta(slug);
    if (!m) return Promise.resolve(false);
    if (loads[slug]) return loads[slug];
    if (typeof FontFace !== 'function' || !document.fonts) { loads[slug] = Promise.resolve(false); return loads[slug]; }
    var jobs = [];
    ['arabic', 'latin'].forEach(function (sub) {
      [400, 700].forEach(function (w) {
        var url;
        try { url = chrome.runtime.getURL('fonts/' + slug + '-' + sub + '-' + w + '.woff2'); } catch (e) { return; }
        jobs.push(
          fetch(url).then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.arrayBuffer(); })
            .then(function (buf) {
              var face = new FontFace(cssName(m), buf, { weight: String(w), style: 'normal', display: 'swap', unicodeRange: sub === 'arabic' ? ARABIC_RANGE : LATIN_RANGE });
              return face.load().then(function (f) { document.fonts.add(f); return true; });
            })
        );
      });
    });
    /* one missing subset must not sink the other three — a partial family still
     * renders, and the fallback stack covers whatever is missing */
    loads[slug] = Promise.all(jobs.map(function (p) { return p.catch(function () { return false; }); }))
      .then(function (r) { return r.some(Boolean); });
    return loads[slug];
  };

  /* ---- applying ------------------------------------------------------------
   * Sets `--syfs-font` on the target element(s); every surface's CSS reads that
   * variable with the system stack as its own fallback, so an unset or failed font is
   * simply the default look rather than an unstyled one.
   *   target: an element, or an array of elements (rail wrap + page root). */
  FK.applyTo = function (target, pref) {
    var els = (target && target.nodeType) ? [target] : (target || []);
    var stack = FK.stackFor(pref);
    for (var i = 0; i < els.length; i++) if (els[i] && els[i].style) els[i].style.setProperty('--syfs-font', stack);
    if (pref && pref.indexOf('local:') !== 0) FK.load(pref);      /* bundled → pull the bytes in */
  };

  FK.get = function (cb) {
    try {
      chrome.storage.local.get({ ui_font: FK.DEFAULT }, function (r) {
        if (chrome.runtime && chrome.runtime.lastError) { cb(FK.DEFAULT); return; }
        var v = String(r.ui_font || '');
        if (v && v.indexOf('local:') !== 0 && !meta(v)) v = FK.DEFAULT;   /* stale/unknown slug */
        cb(v);
      });
    } catch (e) { cb(FK.DEFAULT); }
  };
  FK.set = function (pref) { try { chrome.storage.local.set({ ui_font: String(pref || '') }); } catch (e) {} };
  FK.onChange = function (cb) {
    try {
      chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch.ui_font) FK.get(cb); });
    } catch (e) {}
  };

  /* ---- the same font ON THE PAGE ITSELF (v0.99.0, `ui_font_pages`) -----------
   * Everything above styles the EXTENSION. This styles the site underneath it, which
   * is a different kind of act and is off by default.
   *
   * ⚠️ IT CANNOT TOUCH CHROME'S OWN INTERFACE. Tabs, the address bar, menus and
   * settings are browser chrome; no extension may restyle them (and none should be
   * able to — a page that could repaint the address bar could forge it). This changes
   * the CONTENT of pages, nothing around it. Say so wherever it is offered.
   *
   * It works at all because `document.fonts` is the HOST page's font set (§5.7/3): the
   * face registered as «SYF Cairo» is already visible to the page's own CSS, so a
   * stylesheet naming that family needs no new bytes and makes no request.
   *
   * ⛔ THE EXCLUSION LIST IS THE FEATURE, not decoration. `* { font-family: … }` with
   * `!important` also overrides ICON fonts, whose glyphs live at private code points —
   * Font Awesome, Material Icons and every `<i class="fa-…">` on the web turn into
   * empty boxes or random letters. That does not read as "my font is on", it reads as
   * "this site is broken". Icons are matched by the class conventions they actually
   * ship with, and `pre`/`code` keep their monospace because proportional code is a
   * regression no matter whose font it is. */
  FK.PAGE_KEY = 'ui_font_pages';
  var PAGE_STYLE_ID = 'syfs-page-font';
  var ICON_NOT = ':not(i):not([class*="icon" i]):not([class*="fa-" i]):not([class*="glyph" i])'
    + ':not([class*="material-icons" i]):not([class*="material-symbols" i])'
    + ':not(pre):not(pre *):not(code):not(kbd):not(samp)';

  function pageStyleEl(make) {
    var el = document.getElementById(PAGE_STYLE_ID);
    if (el || !make) return el;
    el = document.createElement('style');
    el.id = PAGE_STYLE_ID;
    /* documentElement, not head: at document_start there may be no <head> yet */
    (document.head || document.documentElement).appendChild(el);
    return el;
  }

  /* on/off + which font; called on load and on every change to either key */
  FK.applyPage = function (on, pref) {
    var el;
    if (!on || !pref) { el = pageStyleEl(false); if (el) el.remove(); return; }
    if (pref.indexOf('local:') !== 0) FK.load(pref);          /* bundled → pull the bytes in */
    var stack = FK.stackFor(pref);
    el = pageStyleEl(true);
    if (!el) return;
    /* `html`/`body` carry the inheritance for everything the list below excludes on
       purpose; the descendant rule then re-states it for elements a site has styled */
    el.textContent = 'html, body { font-family: ' + stack + ' !important; }\n'
      + 'body ' + ICON_NOT + ' { font-family: ' + stack + ' !important; }\n'
      /* the extension's own overlay is a sibling of the page's content and must not be
         restyled by the page sheet — it already follows --syfs-font */
      + '#syfs-host, #syfs-host *, .syfs-wrap, .syfs-wrap * { font-family: var(--syfs-font, inherit) !important; }';
  };

  FK.getPage = function (cb) {
    try {
      var q = {}; q[FK.PAGE_KEY] = false;
      chrome.storage.local.get(q, function (r) {
        if (chrome.runtime && chrome.runtime.lastError) { cb(false); return; }
        cb(!!r[FK.PAGE_KEY]);
      });
    } catch (e) { cb(false); }
  };
  FK.setPage = function (on) { try { var p = {}; p[FK.PAGE_KEY] = !!on; chrome.storage.local.set(p); } catch (e) {} };

  /* keep the page sheet in step with BOTH keys, from any tab */
  FK.bindPage = function () {
    function go() { FK.getPage(function (on) { FK.get(function (v) { FK.applyPage(on, v); }); }); }
    go();
    try {
      chrome.storage.onChanged.addListener(function (ch, area) {
        if (area === 'local' && (ch.ui_font || ch[FK.PAGE_KEY])) go();
      });
    } catch (e) {}
  };

  /* convenience for the standalone pages: wire <html> to the pref, live */
  FK.bindRoot = function (extraEls) {
    var els = [document.documentElement].concat(extraEls || []);
    function go(v) { FK.applyTo(els, v); }
    FK.get(go); FK.onChange(go);
  };

  /* A standalone extension page binds itself the moment this file is included — an
   * inline <script> to call bindRoot() would be blocked by the extension-page CSP
   * (`script-src 'self'`), and every page would need the same three lines anyway.
   * Content scripts are skipped: there `location` is the HOST page, and the rail
   * applies the variable to its own shadow wrap instead of the page's <html>. */
  try { if (location.protocol === 'chrome-extension:') FK.bindRoot(); } catch (e) {}
}());
