/* SYF — help.html behaviour: the slide deck + the general settings panel.
 *
 * ⚠️ This file exists because MV3's extension-page CSP is `script-src 'self'` — an
 * inline <script> in help.html is BLOCKED, which is why the settings/export/import
 * panel silently did nothing before v0.74.0. Keep this logic in a real file; never
 * move it back inline.
 *
 * The page is a slide deck in the illustrated guide's format (v0.166.1): plain HTML in
 * help.html, one <section class="s-slide"> per slide; deck() below only moves `.on`.
 * Nothing here builds markup from a string: it only toggles classes, writes numbers
 * into textContent, and reads/writes its own two storage keys.
 *
 * ⚠️ ONE script, TWO pages (v0.95.0). help.html (العربية) and help-en.html are twins:
 * their PROSE is duplicated, their design (help.css) and their behaviour (this file)
 * are not. So the runtime strings below — the ones this file writes rather than the
 * markup — go through the dictionary like everything else. */
(function () {
  'use strict';
  var S = (window.chrome && chrome.storage && chrome.storage.local) ? chrome.storage.local : null;

  /* ⚠️ The PAGE decides the language here, not `ui_lang`. Someone who just clicked
     "English guide" is reading English NOW; answering them from storage would hand
     the English page an Arabic step counter. The two facts are independent on this
     surface and only this surface — everywhere else the stored value is the truth. */
  var LANG = (document.documentElement.getAttribute('lang') === 'en') ? 'en' : 'ar';

  /* src/i18n.js is loaded by both pages before this file. The local fallback is a
     guard, not a second engine: if that script is ever dropped from one page the
     guide degrades to Arabic — never to a literal "{0}" on screen. */
  function t(id) {
    if (window.SYFS && SYFS.t) return SYFS.t.apply(null, arguments);
    var a = arguments;
    return String(id).replace(/\{(\d+)\}/g, function (m, i) {
      var x = a[(+i) + 1];
      return x === undefined ? m : String(x);
    });
  }

  var AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  /* ⚠️ Arabic-Indic digits are part of the Arabic text, not of the number. "Step ٣ of ٧"
     reads as a broken font, not as a translation — so this is a no-op in English. */
  function ar(n) {
    if (LANG !== 'ar') return String(n);
    return String(n).replace(/\d/g, function (d) { return AR_DIGITS[+d]; });
  }

  /* ================= the deck (v0.166.1) =================
     The page is the illustrated guide's format: every <section class="s-slide"> in the
     markup is one slide, one shows at a time, and the strip/foot are the guide's own.
     The slides are STATIC markup (prose translated by duplication, §6.100) — this only
     moves `.on`, writes numbers, and builds the cover's icon wall from guide-meta.js.
     ⛔ No innerHTML: labels are textContent, icons are our own SVG parsed as XML and
     imported (the guide's rule), so nothing here can turn a string into markup. */
  function deck() {
    var stage = document.getElementById('s-stage');
    if (!stage) return;
    var slides = Array.prototype.slice.call(stage.querySelectorAll('.s-slide'));
    if (!slides.length) return;
    var RTL = getComputedStyle(document.documentElement).direction === 'rtl';
    var byId = {};
    slides.forEach(function (s, i) {
      byId[s.getAttribute('data-slide')] = i;
      /* the guide's staggered entrance: each riser waits a little longer than the last */
      Array.prototype.forEach.call(s.querySelectorAll('.s-rise'), function (r, k) { r.style.setProperty('--d', k); });
      Array.prototype.forEach.call(s.querySelectorAll('.s-card, .s-grid button, .s-toc-cat'), function (r, k) { r.style.setProperty('--i', k); });
    });

    /* the jump menu: one option per slide, grouped like the contents */
    var jump = document.getElementById('s-jump');
    var groups = {};
    slides.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.getAttribute('data-slide');
      o.textContent = s.getAttribute('data-name');
      var g = s.getAttribute('data-group');
      if (!g) { jump.appendChild(o); return; }
      if (!groups[g]) { groups[g] = document.createElement('optgroup'); groups[g].label = g; jump.appendChild(groups[g]); }
      groups[g].appendChild(o);
    });

    /* contents: the slide number beside every line */
    Array.prototype.forEach.call(stage.querySelectorAll('.s-toc-t'), function (b) {
      var n = byId[b.getAttribute('data-goto')], p = b.querySelector('.s-toc-p');
      if (p && n != null) p.textContent = ar(n + 1);
    });

    /* the cover's icon wall — every tool's real icon (guide-meta.js); a click opens that
       tool's page in the illustrated guide */
    var META = window.SYF_GUIDE_META;
    var wall = stage.querySelector('.s-wall');
    if (wall && META && META.tools) {
      var parser = new DOMParser();
      var ids = ((META.order && META.order.tools) || Object.keys(META.tools)).filter(function (id) { return META.tools[id] && META.tools[id].icon; });
      var guide = LANG === 'en' ? 'guide-slides-en.html' : 'guide-slides.html';
      var per = Math.max(18, Math.ceil(Math.max(window.innerWidth, 1280) * 1.5 / 92));
      for (var r = 0; r < 10 && ids.length; r++) {
        var row = document.createElement('div');
        row.className = 's-row' + (r % 2 ? ' rev' : '');
        row.style.setProperty('--t', (70 + r * 9) + 's');
        var picks = [];
        for (var k = 0; k < per; k++) picks.push(ids[(r * 15 + k * 7) % ids.length]);
        picks.concat(picks).forEach(function (id) {
          var a = document.createElement('a');
          a.className = 's-cell';
          a.href = guide + '#tool-' + id;
          a.tabIndex = -1;                         /* decoration: the deck is the way through */
          var svg = META.tools[id].icon;
          if (!/^<svg[^>]*\sxmlns=/.test(svg)) svg = svg.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
          var doc = parser.parseFromString(svg, 'image/svg+xml');
          var box = document.createElement('span');
          box.className = 'ic';
          if (doc.documentElement.nodeName === 'svg' && !doc.getElementsByTagName('parsererror').length) box.appendChild(document.importNode(doc.documentElement, true));
          a.appendChild(box);
          row.appendChild(a);
        });
        wall.appendChild(row);
      }
    }

    var cur = -1;
    var pos = document.getElementById('s-pos'), fill = document.getElementById('s-bar-i');
    var prev = document.getElementById('s-prev'), next = document.getElementById('s-next');
    function go(i) {
      i = Math.max(0, Math.min(slides.length - 1, i));
      if (i === cur) return;
      if (cur >= 0) slides[cur].classList.remove('on');
      cur = i;
      var s = slides[i];
      s.classList.add('on');
      var sc = s.querySelector('.s-in'); if (sc) sc.scrollTop = 0;
      pos.textContent = ar(i + 1) + ' / ' + ar(slides.length);
      fill.style.width = ((i + 1) / slides.length * 100) + '%';
      prev.disabled = i === 0;
      next.disabled = i === slides.length - 1;
      jump.value = s.getAttribute('data-slide');
      if (history.replaceState) history.replaceState(null, '', '#' + s.getAttribute('data-slide'));
    }
    /* old deep links keep working: #start → the first step, #start-3 → step 3,
       #tools → the categories divider; anything else is a slide id */
    function fromHash(h) {
      var id = String(h || '').slice(1), m = /^start(?:-(\d+))?$/.exec(id);
      if (m) id = 'step-' + (m[1] || 1);
      return byId[id];
    }

    prev.addEventListener('click', function () { go(cur - 1); });
    next.addEventListener('click', function () { go(cur + 1); });
    jump.addEventListener('change', function () { if (byId[jump.value] != null) go(byId[jump.value]); });
    stage.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-goto]');
      if (b && byId[b.getAttribute('data-goto')] != null) go(byId[b.getAttribute('data-goto')]);
    });
    window.addEventListener('hashchange', function () { var n = fromHash(location.hash); if (n != null) go(n); });
    var printBtn = document.getElementById('s-print');
    if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
    function toggleFull() {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    }
    var fullBtn = document.getElementById('s-full');
    if (fullBtn) fullBtn.addEventListener('click', toggleFull);

    document.addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var tg = e.target, tag = tg && tg.tagName;
      if (/^(SELECT|INPUT|TEXTAREA)$/.test(tag) || (tg && tg.isContentEditable)) return;
      var k = e.key;
      /* Space/Enter on a focused button or link is that control's own press */
      if ((k === ' ' || k === 'Enter') && /^(BUTTON|A)$/.test(tag)) return;
      var fwd = RTL ? 'ArrowLeft' : 'ArrowRight', back = RTL ? 'ArrowRight' : 'ArrowLeft';
      if (k === fwd || k === 'PageDown' || k === ' ') { e.preventDefault(); go(cur + 1); }
      else if (k === back || k === 'PageUp') { e.preventDefault(); go(cur - 1); }
      else if (k === 'Home') { e.preventDefault(); go(0); }
      else if (k === 'End') { e.preventDefault(); go(slides.length - 1); }
      else if (k === 'f' || k === 'F') toggleFull();
    });

    /* swipe on touch screens: a horizontal drag of 50px+ turns the page */
    var sx = null, sy = 0;
    stage.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (sx == null) return;
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      sx = null;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
      go(cur + ((RTL ? dx > 0 : dx < 0) ? 1 : -1));
    });

    var start = fromHash(location.hash);
    go(start != null ? start : 0);
  }

  /* ================= general settings + export / import / reset ================= */
  function settings() {
    /* same list as SYFS.ACCENTS in src/rail.js (this page does not load it) */
    var ACCENTS = [['#457364', 'تركوازي'], ['#2563eb', 'أزرق'], ['#7c3aed', 'بنفسجي'], ['#059669', 'أخضر'], ['#ea580c', 'برتقالي'], ['#db2777', 'وردي'], ['#0891b2', 'سماوي'], ['#475569', 'رمادي'],
      ['#dc2626', 'أحمر'], ['#9f1239', 'عنابي'], ['#c026d3', 'فوشيا'], ['#4f46e5', 'نيلي'], ['#1e3a8a', 'كحلي'], ['#0d9488', 'أزرق مخضر'], ['#4d7c0f', 'زيتي'], ['#65a30d', 'ليموني'],
      ['#d97706', 'كهرماني'], ['#92400e', 'بني'], ['#f43f5e', 'مرجاني'], ['#1f2937', 'فحمي']];
    var acc = document.getElementById('set-accent');
    if (!acc) return;
    ACCENTS.forEach(function (a) { var o = document.createElement('option'); o.value = a[0]; o.textContent = t(a[1]); acc.appendChild(o); });
    var enabled = document.getElementById('set-enabled'), pos = document.getElementById('set-pos'), msg = document.getElementById('set-msg');
    function note(s, ok) { msg.style.display = ''; msg.textContent = s; var bad = ok === false; msg.style.background = bad ? 'var(--bad-bg)' : 'var(--ok-bg)'; msg.style.borderColor = bad ? 'var(--bad-line)' : 'var(--ok-line)'; msg.style.color = bad ? 'var(--bad-ink)' : 'var(--ok-ink)'; }
    function syncForm(v) {
      enabled.checked = v.enabled !== false; pos.value = v.pos || 'right';
      var a = /^#[0-9a-f]{6}$/i.test(v.accent || '') ? v.accent.toLowerCase() : '#457364';
      /* a colour picked in the rail's custom field is not on the list — show it as such
         instead of leaving the select blank */
      var cus = acc.querySelector('option[data-cus]');
      if (!ACCENTS.some(function (x) { return x[0] === a; })) {
        if (!cus) { cus = document.createElement('option'); cus.setAttribute('data-cus', ''); acc.appendChild(cus); }
        cus.value = a; cus.textContent = t('لون مخصّص') + ' ' + a;
      } else if (cus) cus.remove();
      acc.value = a;
    }
    if (!S) { note(t('تعذّر الوصول لتخزين الإضافة (افتح الصفحة من الإضافة نفسها).'), false); return; }

    S.get(['enabled', 'pos', 'accent'], syncForm);
    enabled.addEventListener('change', function () { S.set({ enabled: enabled.checked }); note(t('حُفظ. أعد تحميل الصفحات المفتوحة لتطبيق التغيير.')); });
    pos.addEventListener('change', function () { S.set({ pos: pos.value }); note(t('حُفظ الموضع. أعد تحميل الصفحات.')); });
    acc.addEventListener('change', function () { S.set({ accent: acc.value }); note(t('حُفظ اللون. أعد تحميل الصفحات.')); });

    /* ⛔ Both doors run the SAME filter, `SYFS.prefs` in src/storage.js (§5.11/3). Until
       v0.139.0 this page exported `get(null)` as-is — provider keys, the vault blob and
       the WhatsApp lock hash in a file named "settings" — while the rail's door filtered
       them. No prefs module ⇒ no export at all: fail closed, never fall back to raw. */
    var P = (window.SYFS && SYFS.prefs) ? SYFS.prefs : null;
    document.getElementById('set-export').addEventListener('click', function () {
      if (!P) { note(t('تعذّر التصدير.'), false); return; }
      S.get(null, function (all) {
        try {
          var ex = P.exportable(all);
          var blob = new Blob([JSON.stringify(ex.out, null, 2)], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a'); a.href = url; a.download = 'syf-tools-settings.json'; a.click();
          setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
          note(ex.dropped ? t('تم التصدير إلى syf-tools-settings.json — بلا المفاتيح والخزنة ({0} عنصراً حسّاساً لم يُكتب).', String(ex.dropped))
                          : t('تم تصدير الإعدادات إلى ملف syf-tools-settings.json'));
        } catch (e) { note(t('تعذّر التصدير: {0}', e.message), false); }
      });
    });

    var fileIn = document.getElementById('set-import');
    document.getElementById('set-import-btn').addEventListener('click', function () { fileIn.click(); });
    fileIn.addEventListener('change', function () {
      var f = fileIn.files && fileIn.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var obj = JSON.parse(rd.result);
          if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(t('صيغة غير صالحة'));
          if (!P) throw new Error(t('صيغة غير صالحة'));
          var im = P.cleanImport(obj);
          S.set(im.clean, function () {
            note(im.skipped ? t('تم الاستيراد ✓ — أُسقط {0} مفتاحاً غير صالح أو حسّاس. أعد تحميل الصفحة.', String(im.skipped))
                            : t('تم الاستيراد بنجاح. أعد تحميل الصفحات لتطبيق كل شيء.'));
            S.get(['enabled', 'pos', 'accent'], syncForm);
          });
        } catch (e) { note(t('ملف غير صالح: {0}', e.message), false); }
        fileIn.value = '';
      };
      rd.readAsText(f);
    });

    document.getElementById('set-reset').addEventListener('click', function () {
      if (!window.confirm(t('سيتم حذف كل الإعدادات والبيانات المحلية (المفضلة، الملاحظات، الترتيب، الروابط المخصّصة…). لا يمكن التراجع. متابعة؟'))) return;
      S.clear(function () { note(t('أُعيد تعيين كل الإعدادات. أعد تحميل الصفحات.')); syncForm({}); });
    });
  }

  /* ================= light / dark (v0.165.1) =================
     Light is the default whatever the OS says (project rule). The key is the illustrated
     guide's own (`syfs_slides_theme`, guide-slides.js) — the two pages share one design,
     so a reader who chose dark there must not land on a white page here. localStorage,
     not chrome.storage: a per-viewer convenience on an extension page, read synchronously
     so the saved theme is on <html> before the first paint (the attribute is set the
     moment this file runs; the button is painted in boot()). */
  var THEME_KEY = 'syfs_slides_theme';
  var root = document.documentElement;
  try {
    var savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === 'dark' || savedTheme === 'light') root.setAttribute('data-theme', savedTheme);
  } catch (e) { /* storage blocked → light */ }

  function theme() {
    var btn = document.getElementById('h-theme');
    if (!btn) return;
    function paint() {
      var dark = root.getAttribute('data-theme') === 'dark';
      var label = dark ? t('الوضع الفاتح') : t('الوضع الداكن');
      btn.textContent = dark ? '☀' : '☾';
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }
    btn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* not remembered */ }
      paint();
    });
    paint();
  }

  /* the footer version came from a hand-typed string that went stale at 0.38.0 */
  function version() {
    var el = document.getElementById('help-ver');
    if (!el) return;
    try { el.textContent = chrome.runtime.getManifest().version; } catch (e) {}
  }

  /* ⚠️ Nothing renders before the dictionary is in hand. The three sections used to be
     IIFEs running at parse time; that was correct while every string was Arabic and is
     not any more — a step counter painted half a tick early paints it in Arabic on the
     English page and never repaints (§6.99/3, the same reason the worker awaits its
     load). In Arabic apply() resolves without a fetch, so this costs one microtask. */
  function boot() { theme(); deck(); settings(); version(); }
  if (window.SYFS && SYFS.i18n && SYFS.i18n.apply) SYFS.i18n.apply(LANG).then(boot, boot);
  else boot();
}());
