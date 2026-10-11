/* tools/web-demo/try.js — SITE ONLY. The demo page's own UI around the real extension:
 * language + theme, the tool index (from the guide's data), the window that shows an
 * extension page, toasts for what the website cannot do, and loading the content bundle. */
'use strict';
(function () {
  var D = document, H = D.documentElement;
  var lang = H.getAttribute('lang') === 'en' ? 'en' : 'ar';
  var isSample = D.body.hasAttribute('data-sample');

  var T = {
    ar: {
      brand: 'SYF Tools', guide: 'الدليل', sample: 'الصفحة التجريبية', lang: 'English', theme: 'الوضع الداكن',
      install: 'ثبّت الإضافة', installed: 'مثبّتة عندك ✓', nav: 'تنقّل', close: 'إغلاق', try: 'التجربة',
      oldT: 'الإضافة المثبّتة عندك قديمة.', oldD: 'لذلك تظهر في هذه الصفحة مع التجربة. حدّثها من chrome://extensions، أو أوقفها مؤقتاً لتجرّب بشريط واحد.',
      h1: 'جرّب الإضافة الآن — بلا تثبيت',
      lead: 'هذا هو شريط SYF Tools الحقيقي، بنفس كود الإضافة. افتح أي أداة من الشريط على حافة الشاشة أو من الفهرس تحت.',
      openRail: 'افتح أداة الآن', trySample: 'جرّب أدوات الصفحة', reset: 'أعد ضبط التجربة',
      privacy: 'كل ما تكتبه هنا يبقى في متصفحك فقط. لا خادم، ولا حسابات، ولا تتبّع.',
      mobT: 'التجربة الكاملة على الكمبيوتر', mobD: 'الشريط مصمَّم لشاشة الكمبيوتر. على الجوال جرّب هذه الصفحات المستقلة، أو اقرأ الدليل.',
      idx: 'كل الأدوات', tA: 'تعمل هنا', tB: 'على الصفحة التجريبية', tC: 'تعمل بعد التثبيت',
      search: 'ابحث عن أداة', searchPh: 'ابحث عن أداة…', foot: 'SYF Tools — صندوق أدوات المتصفح',
      none: 'لا أداة بهذا الاسم.', open: 'افتح', readGuide: 'اقرأ عنها في الدليل',
      resetDone: 'مُسحت بيانات التجربة.', blockedT: 'تعمل بعد التثبيت',
      blockedD: 'هذا الفعل يحتاج صلاحية لا يملكها أي موقع ويب، فلم يُنفَّذ هنا. ثبّت الإضافة لتعمل فعلاً.',
      cOnly: 'هذه الأداة تحتاج صلاحيات المتصفح. تفتح نافذتها هنا لتراها، لكنها لا تُنفِّذ شيئاً حتى تثبّت الإضافة.',
      bOnly: 'هذه الأداة تعمل على الصفحة المفتوحة — جرّبها على الصفحة التجريبية.', goSample: 'اذهب إلى الصفحة التجريبية',
      noKey: 'المفاتيح وكلمات المرور لا تُكتب في موقع عام. هذه الأداة تعمل بعد التثبيت فقط.',
      ver: 'الإصدار', sampleH: 'صفحة تجريبية لأدوات الصفحة', sampleLead: 'افتح من الشريط أدوات مثل «احفظ المقال»، «الترجمة»، «العرض والقراءة»، «الملء التلقائي»، «فاحص العناصر» أو «كاشف التقنيات» — وجرّبها على هذه الصفحة.'
    },
    en: {
      brand: 'SYF Tools', guide: 'Guide', sample: 'Sample page', lang: 'العربية', theme: 'Dark mode',
      install: 'Install the extension', installed: 'Installed ✓', nav: 'Navigation', close: 'Close', try: 'Try it',
      oldT: 'Your installed copy is out of date.', oldD: 'That is why it shows on this page alongside the demo. Update it from chrome://extensions, or pause it to try with one bar.',
      h1: 'Try the extension now — no install',
      lead: 'This is the real SYF Tools bar, running the extension’s own code. Open any tool from the bar at the edge of the screen, or from the index below.',
      openRail: 'Open a tool now', trySample: 'Try the page tools', reset: 'Reset the demo',
      privacy: 'Everything you type here stays in your browser. No server, no accounts, no tracking.',
      mobT: 'The full demo needs a computer', mobD: 'The bar is built for a desktop screen. On a phone, try these standalone pages or read the guide.',
      idx: 'Every tool', tA: 'Works here', tB: 'On the sample page', tC: 'Works after install',
      search: 'Search for a tool', searchPh: 'Search for a tool…', foot: 'SYF Tools — your browser toolbox',
      none: 'No tool by that name.', open: 'Open', readGuide: 'Read about it in the guide',
      resetDone: 'Demo data cleared.', blockedT: 'Works after install',
      blockedD: 'This action needs a permission no website has, so it did not run here. Install the extension for the real thing.',
      cOnly: 'This tool needs browser permissions. Its window opens here so you can see it, but it does nothing until you install the extension.',
      bOnly: 'This tool works on the open page — try it on the sample page.', goSample: 'Go to the sample page',
      noKey: 'Keys and passwords are never typed into a public website. This tool works after install only.',
      ver: 'Version', sampleH: 'A sample page for the page tools', sampleLead: 'Open tools such as «Save the article», «Translate», «Display & reading», «Form autofill», «Element inspector» or «Tech detector» from the bar — and try them on this page.'
    }
  };
  function t(k) { return (T[lang] && T[lang][k]) || T.ar[k] || k; }

  /* ---------- tiers (spec §3) ---------- */
  var TIER_B = ['readsave', 'translate', 'clipboard', 'display', 'formfill', 'watch', 'siteviewer', 'mdview',
    'devinspect', 'devviewport', 'devpage', 'devnet', 'devlogs', 'techdetect', 'perfaudit',
    'speedlite', 'speedembed', 'speedfreeze', 'speedfetch'];
  var TIER_C = ['sessions', 'ytplus', 'appmode', 'adblock', 'waprivacy', 'msprivacy', 'sitecleaner', 'cookiemgr',
    'waopen', 'wablur', 'msopen', 'msblur', 'speedtabs', 'videodl', 'screenshot', 'regionshot', 'capbar'];
  var NO_KEY = ['vault', 'sam-ai'];
  function tier(id) {
    if (NO_KEY.indexOf(id) >= 0) return 'k';
    if (TIER_C.indexOf(id) >= 0) return 'c';
    if (TIER_B.indexOf(id) >= 0) return 'b';
    return 'a';
  }
  /* the Chrome Web Store listing — empty until the public listing exists; the install
     buttons then lead to the guide instead */
  var STORE = '';

  /* standalone pages that also work on a phone */
  var PAGES = [
    { f: 'kids.html', ar: 'مصحف الأطفال', en: 'Children’s Mushaf' },
    { f: 'hifz.html', ar: 'التحفيظ', en: 'Memorisation' },
    { f: 'qrtool.html', ar: 'رمز QR', en: 'QR tools' },
    { f: 'ocr.html', ar: 'نص من صورة', en: 'Text from an image' },
    { f: 'studio.html', ar: 'الاستوديو', en: 'Studio' },
    { f: 'word.html', ar: 'مستندات Word', en: 'Word documents' },
    { f: 'sheet.html', ar: 'جداول البيانات', en: 'Spreadsheets' }
  ];

  /* ---------- text ---------- */
  function applyText() {
    D.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    D.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    D.querySelectorAll('[data-i18n-aria]').forEach(function (el) { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
    if (STORE) D.querySelectorAll('[data-install]').forEach(function (el) { el.setAttribute('href', STORE); el.setAttribute('rel', 'noopener'); });
    D.querySelectorAll('[data-href-en]').forEach(function (el) {
      if (!el.hasAttribute('data-href-ar')) el.setAttribute('data-href-ar', el.getAttribute('href'));
      el.setAttribute('href', lang === 'en' ? el.getAttribute('data-href-en') : el.getAttribute('data-href-ar'));
    });
    D.title = isSample ? t('sampleH') + ' — SYF Tools' : (lang === 'en' ? 'Try SYF Tools without installing' : 'جرّب SYF Tools دون تثبيت');
    var man = window.chrome && chrome.runtime && chrome.runtime.getManifest();
    var v = D.getElementById('syf-ver'); if (v && man) v.textContent = t('ver') + ' ' + man.version;
    markInstalled();
  }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

  D.getElementById('syf-lang').addEventListener('click', function () {
    lang = lang === 'en' ? 'ar' : 'en';
    store('syf_site_lang', lang);
    H.setAttribute('lang', lang); H.setAttribute('dir', lang === 'en' ? 'ltr' : 'rtl');
    applyText(); renderIndex();
  });
  D.getElementById('syf-theme').addEventListener('click', function () {
    var next = H.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    H.setAttribute('data-theme', next); store('syf_site_theme', next);
  });

  /* ---------- toasts ---------- */
  function toast(title, text, action) {
    var box = D.getElementById('syf-toasts'), el = D.createElement('div');
    el.className = 'syf-toast'; el.setAttribute('role', 'status');
    var b = D.createElement('strong'); b.textContent = title; el.appendChild(b);
    if (text) { var p = D.createElement('p'); p.textContent = text; el.appendChild(p); }
    if (action) { var a = D.createElement('a'); a.href = action.href; a.textContent = action.label; a.className = 'syf-toast-a'; el.appendChild(a); }
    var x = D.createElement('button'); x.type = 'button'; x.className = 'syf-toast-x'; x.textContent = '✕'; x.setAttribute('aria-label', t('close'));
    x.addEventListener('click', function () { el.remove(); }); el.appendChild(x);
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, 7000);
  }
  var lastBlocked = 0;

  /* ---------- the extension page window ---------- */
  var sheet = D.getElementById('syf-sheet'), frame = D.getElementById('syf-sheet-f');
  function openPage(url) {
    var u;
    try { u = new URL(url, location.href); } catch (e) { return; }
    var base = window.SYF_DEMO && SYF_DEMO.base;
    /* spec §5: no real passwords or API keys typed into a public website — the vault and
       the keys page stay closed here, whichever button asked for them */
    if (base && /\/(vault|aikeys)\.html$/.test(u.pathname)) { toast(t('blockedT'), t('noKey'), { href: STORE || '../index.html', label: t('install') }); return; }
    if (base && u.href.indexOf(base) === 0) {
      D.getElementById('syf-sheet-t').textContent = u.pathname.split('/').pop().replace(/\.html$/, '');
      frame.src = u.href; sheet.hidden = false; D.body.classList.add('syf-sheet-on');
      D.getElementById('syf-sheet-x').focus();
      return;
    }
    if (u.protocol === 'https:' || u.protocol === 'http:') window.open(u.href, '_blank', 'noopener');
  }
  /* the window's title is the page's own <title> once it loads */
  frame.addEventListener('load', function () {
    try { var tt = frame.contentDocument && frame.contentDocument.title; if (tt) D.getElementById('syf-sheet-t').textContent = tt; } catch (e) { /* not ours */ }
  });
  function closePage() { sheet.hidden = true; frame.src = 'about:blank'; D.body.classList.remove('syf-sheet-on'); }
  D.getElementById('syf-sheet-x').addEventListener('click', closePage);
  D.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) closePage(); });

  var offFrame = null;
  window.SYF_DEMO = window.SYF_DEMO || {};
  SYF_DEMO.hooks = {
    open: openPage,
    note: function (title, text) { toast(title || 'SYF Tools', text); },
    blocked: function () {
      if (Date.now() - lastBlocked < 4000) return;
      lastBlocked = Date.now();
      toast(t('blockedT'), t('blockedD'), { href: STORE || '../index.html', label: t('install') });
    },
    offscreen: function (url) {
      if (offFrame) return;
      offFrame = D.createElement('iframe'); offFrame.hidden = true; offFrame.title = 'offscreen';
      offFrame.setAttribute('allow', 'autoplay'); offFrame.src = url; D.body.appendChild(offFrame);
    },
    offscreenClose: function () { if (offFrame) { offFrame.remove(); offFrame = null; } }
  };

  /* ---------- reset ---------- */
  var reset = D.getElementById('syf-reset');
  if (reset) reset.addEventListener('click', function () {
    if (SYF_DEMO.reset) SYF_DEMO.reset();
    toast(t('resetDone'));
    setTimeout(function () { location.reload(); }, 900);
  });

  /* ---------- installed / old copy (spec §7–8) ---------- */
  function markInstalled() {
    var v = H.getAttribute('data-syf-installed'), btn = D.getElementById('syf-install');
    if (!btn) return;
    if (v) { btn.textContent = t('installed') + ' v' + v; btn.classList.add('syf-btn-done'); btn.setAttribute('href', '../index.html'); }
    else btn.textContent = t('install');
  }
  new MutationObserver(markInstalled).observe(H, { attributes: true, attributeFilter: ['data-syf-installed'] });
  /* a copy from before the exclusion still builds its own rail here: two hosts, or one
     built before ours started */
  function checkOld() {
    var n = D.querySelectorAll('#syfs-host').length;
    if (n > 1 || (n === 1 && !booted)) D.getElementById('syf-old').hidden = false;
  }

  /* ---------- index ---------- */
  function guideHref(id) { return (lang === 'en' ? '../en.html' : '../index.html') + '#tool-' + encodeURIComponent(id); }
  function openTool(id) {
    /* no rail on a phone (spec §10): a card opens that tool's page in the guide */
    if (!wide.matches) { location.href = guideHref(id); return; }
    var k = tier(id);
    if (k === 'k') { toast(t('blockedT'), t('noKey'), { href: guideHref(id), label: t('readGuide') }); return; }
    if (k === 'b' && !isSample) { toast(t('tB'), t('bOnly'), { href: 'sample.html#' + encodeURIComponent(id), label: t('goSample') }); return; }
    /* a click while the bundle is still loading waits for it instead of being lost */
    if (!booted || !window.SYFS || !SYFS.openToolById) { var n = 0; (function wait() { if (booted && window.SYFS && SYFS.openToolById) openTool(id); else if (n++ < 80) setTimeout(wait, 250); }()); return; }
    SYFS.openToolById(id);
    if (k === 'c') toast(t('tC'), t('cOnly'));
  }
  function renderIndex() {
    var box = D.getElementById('syf-idx');
    if (!box || !window.SYF_GUIDE) return;
    var q = (D.getElementById('syf-q').value || '').trim().toLowerCase();
    var meta = (window.SYF_GUIDE_META && SYF_GUIDE_META.tools) || {};
    var man = chrome.runtime.getManifest();
    box.textContent = '';
    var any = false;
    (window.SYF_GUIDE_CATS || []).forEach(function (c) {
      var list = SYF_GUIDE.filter(function (g) {
        if (g.cat !== c.id) return false;
        if (g.id === 'videodl' && !/downloads/.test(JSON.stringify(man.permissions || []))) return false;
        if (!q) return true;
        return (g.ar.n + ' ' + g.en.n + ' ' + g.ar.w + ' ' + g.en.w).toLowerCase().indexOf(q) >= 0;
      });
      if (!list.length) return;
      any = true;
      var sec = D.createElement('div'); sec.className = 'syf-cat';
      var h = D.createElement('h3'); h.textContent = c[lang] || c.ar; sec.appendChild(h);
      var grid = D.createElement('div'); grid.className = 'syf-grid';
      list.forEach(function (g) {
        var k = tier(g.id), L = g[lang] || g.ar;
        var card = D.createElement('button'); card.type = 'button'; card.className = 'syf-card';
        card.setAttribute('data-tool', g.id);
        var ic = D.createElement('span'); ic.className = 'syf-card-ic'; ic.setAttribute('aria-hidden', 'true');
        /* the icon markup comes from our own generated file (guide-meta.js), never from the page or the user */
        if (meta[g.id] && meta[g.id].icon) ic.innerHTML = meta[g.id].icon;
        var nm = D.createElement('span'); nm.className = 'syf-card-n'; nm.textContent = L.n;
        var wd = D.createElement('span'); wd.className = 'syf-card-w'; wd.textContent = L.w;
        var tg = D.createElement('span'); tg.className = 'syf-tier syf-tier-' + (k === 'k' ? 'c' : k);
        tg.textContent = t(k === 'a' ? 'tA' : k === 'b' ? 'tB' : 'tC');
        card.appendChild(ic); card.appendChild(nm); card.appendChild(wd); card.appendChild(tg);
        card.addEventListener('click', function () { openTool(g.id); });
        grid.appendChild(card);
      });
      sec.appendChild(grid); box.appendChild(sec);
    });
    if (!any) { var p = D.createElement('p'); p.className = 'syf-note'; p.textContent = t('none'); box.appendChild(p); }
  }
  var qIn = D.getElementById('syf-q');
  if (qIn) qIn.addEventListener('input', renderIndex);

  function renderPages() {
    var box = D.getElementById('syf-pages');
    if (!box) return;
    box.textContent = '';
    PAGES.forEach(function (p) {
      var a = D.createElement('a'); a.className = 'syf-btn syf-btn-ghost'; a.href = 'ext/' + p.f; a.textContent = p[lang];
      box.appendChild(a);
    });
  }

  /* ---------- the extension's content bundle ---------- */
  var booted = false;
  function loadBundle() {
    var man = chrome.runtime.getManifest();
    var files = [];
    man.content_scripts.forEach(function (cs) {
      /* the rail bundle and the display tool run on every website; the rest are for
         named sites (WhatsApp, YouTube…) or are ad blocking in the page's own world */
      if ((cs.matches || []).indexOf('<all_urls>') < 0 || cs.world === 'MAIN') return;
      if (cs.all_frames && (cs.js || []).some(function (f) { return /adblock/.test(f); })) return;
      (cs.js || []).forEach(function (f) { if (files.indexOf(f) < 0) files.push(f); });
    });
    var i = 0;
    (function next() {
      if (i >= files.length) { booted = true; window.SYF_DEMO_READY = true; return; }
      var s = D.createElement('script'); s.src = SYF_DEMO.base + files[i++];
      s.onload = next; s.onerror = function () { console.error('[syf-demo] load', s.src); next(); };
      D.body.appendChild(s);
    }());
  }

  var wide = window.matchMedia('(min-width: 768px)');
  var mob = D.getElementById('syf-mobile');
  if (mob) mob.hidden = wide.matches;
  checkOld();
  /* a visitor who hid the rail (or a tool that did) gets it back on the next page:
     a demo with no bar shows nothing at all */
  if (wide.matches) chrome.storage.local.set({ enabled: true }, loadBundle);
  setTimeout(checkOld, 4000);

  var openBtn = D.getElementById('syf-open-rail');
  if (openBtn) openBtn.hidden = !wide.matches;
  if (openBtn) openBtn.addEventListener('click', function () {
    chrome.storage.local.set({ enabled: true }, function () { openTool('calc'); });
  });

  /* the sample form is for autofill only — it never goes anywhere */
  D.querySelectorAll('form').forEach(function (f) { f.addEventListener('submit', function (e) { e.preventDefault(); }); });

  applyText(); renderIndex(); renderPages();
  /* sample.html#<tool> opens that tool once the rail is up */
  if (isSample && location.hash.length > 1) {
    var want = decodeURIComponent(location.hash.slice(1)), n = 0;
    (function wait() { if (window.SYFS && SYFS.openToolById && booted) openTool(want); else if (n++ < 60) setTimeout(wait, 250); }());
  }
}());
