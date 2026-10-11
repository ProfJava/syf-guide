/* SYF — «الاستوديو» frame (studio.html, v0.166.0): side nav, themes, labels toggle, the
 * shared image, toasts, and the bridge to the page that hosts it.
 *
 * A tool is { id, group, label, icon, desc, full?, mount(page, ctx) → optional cleanup },
 * or { id, group, label, icon, action } for a button that runs instead of opening a page
 * (the capture group). The shared image (SL.doc) is what every single-image tool opens
 * on: open it once, then remove its background, convert it, read its EXIF… without
 * picking the file again.
 *
 * WHERE IT RUNS. studio.html is an extension page, so its engines (onnxruntime, pdf.js,
 * Tesseract) load under the EXTENSION's CSP, never the host site's. It is shown three ways:
 *   ?host=win   inside the rail's floating window (src/studio.js) — design هـ
 *   ?host=full  the same window over the whole page                  — design د
 *   (no host)   a tab of its own (SYFS_EDIT_OPEN, «فتح في تبويب»)
 *
 * THE BRIDGE (embedded only). Studio → host: window.parent.postMessage({syfsStudio:1,
 * cmd}) with commands only — mode / capture / close — never data. Host → studio: the
 * same shape, and ⚠️ it CANNOT be authenticated here: a content script and the page's own
 * scripts post from the same window, so `e.source === parent` is true for both. Hence
 * nothing the host says is trusted with consequence: `load` carries a storage.session KEY
 * (only the worker writes one; content scripts cannot read that area), `mode` repaints a
 * switch, `note` picks a message from NOTES by code — never text from the message. */
(function () {
  'use strict';
  var SL = window.SL;
  var I = SL.icon;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var HAS_CHROME = !!(window.chrome && chrome.storage && chrome.storage.local);

  /* t() — the extension's dictionary (src/i18n.js), or the msgid itself outside it */
  SL.t = function () { return (window.SYFS && SYFS.t) ? SYFS.t.apply(null, arguments) : String(arguments[0]); };
  SL.dir = function () { return (window.SYFS && SYFS.i18n) ? SYFS.i18n.dir() : 'rtl'; };
  SL.locale = function () { return (window.SYFS && SYFS.i18n) ? SYFS.i18n.locale() : 'ar-EG'; };

  /* ---------- per-tool preferences ----------
   * One object under `studio_prefs` in chrome.storage.local, read once at boot so every
   * tool keeps a sync LS.get(). ⚠️ Not localStorage: inside a third-party page the frame's
   * storage is partitioned by the TOP site, so a theme chosen on one site would not follow
   * the user to the next. A stored value is used only when it has the type of the default
   * it replaces — anything else is ignored, never half-trusted. */
  var PREF_KEY = 'studio_prefs';
  var prefs = {}, prefTimer = 0;
  var LS = {
    get: function (k, d) {
      var v = prefs[k];
      if (v === undefined || v === null) return d;
      if (d !== null && d !== undefined && (typeof v !== typeof d || Array.isArray(v) !== Array.isArray(d))) return d;
      return v;
    },
    set: function (k, v) {
      prefs[k] = v;
      clearTimeout(prefTimer);
      prefTimer = setTimeout(function () {
        var o = {}; o[PREF_KEY] = prefs;
        try { if (HAS_CHROME) chrome.storage.local.set(o); else localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {}
      }, 250);
    }
  };
  function loadPrefs() {
    return new Promise(function (res) {
      function take(v) { if (v && typeof v === 'object' && !Array.isArray(v)) prefs = v; res(); }
      try {
        if (HAS_CHROME) chrome.storage.local.get(PREF_KEY, function (r) { take(r && r[PREF_KEY]); });
        else take(JSON.parse(localStorage.getItem(PREF_KEY) || 'null'));
      } catch (e) { res(); }
    });
  }
  function loadLang() {
    if (!HAS_CHROME || !window.SYFS || !SYFS.i18n) return Promise.resolve('ar');
    return new Promise(function (res) {
      chrome.storage.local.get({ ui_lang: 'ar' }, function (r) {
        /* whitelisted, not sanitised: it builds a resource path and a dir attribute */
        SYFS.i18n.apply(r && r.ui_lang === 'en' ? 'en' : 'ar').then(res, function () { res('ar'); });
      });
    });
  }

  /* ---------- the extension's colour ----------
   * The «لون الإضافة» theme paints the side nav and the accent with the colour picked in
   * the extension's settings (`accent`, the same key src/rail.js applyAccent reads, same
   * #rrggbb shape — anything else falls back to SYF's green). Followed live: change the
   * colour in the settings and an open studio repaints. */
  var ACCENT_RE = /^#[0-9a-f]{6}$/i;
  function paintAccent(hex) {
    if (!ACCENT_RE.test(String(hex || ''))) hex = '#457364';
    var t = [1, 3, 5].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); });
    var d = t.map(function (v) { return Math.round(v * 0.62); });
    var s = document.documentElement.style;
    s.setProperty('--ext', hex);
    s.setProperty('--ext-rgb', t.join(','));
    s.setProperty('--ext-d', 'rgb(' + d.join(',') + ')');
    s.setProperty('--ext-d-rgb', d.join(','));
  }
  function loadAccent() {
    if (!HAS_CHROME) { paintAccent(''); return Promise.resolve(); }
    return new Promise(function (res) {
      chrome.storage.local.get({ accent: '#457364' }, function (r) { paintAccent(r && r.accent); res(); });
    });
  }
  if (HAS_CHROME && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area === 'local' && ch.accent) paintAccent(ch.accent.newValue);
    });
  }

  var THEMES = [
    { id: 'accent', name: 'لون الإضافة', sw: ['#ffffff', '#eef1f3', 'var(--ext, #457364)'], nav: 'var(--ext-d, #32534a)' },
    { id: 'accent-dark', name: 'لون الإضافة — داكن', sw: ['#1c2326', '#0e1315', 'var(--ext, #457364)'], nav: 'var(--ext-d, #32534a)' },
    { id: 'graphite', name: 'جرافيت', sw: ['#141417', '#26262b', '#3b9eff'] },
    { id: 'midnight', name: 'منتصف الليل', sw: ['#080c18', '#131c33', '#8b7cff'] },
    { id: 'glass', name: 'زجاجي', sw: ['#0d1b2a', '#3b2a7a', '#2dd4bf'] },
    { id: 'light', name: 'فاتح', sw: ['#ffffff', '#eef0f4', '#2563eb'] },
    { id: 'syf', name: 'SYF', sw: ['#17201c', '#eef1ef', '#2f6b57'] },
    { id: 'sand', name: 'رملي', sw: ['#2a211a', '#f3ede4', '#c2410c'] }
  ];
  var GROUPS = [
    ['capture', 'التقاط'], ['edit', 'تحرير'], ['convert', 'تحويل وتحسين'], ['docs', 'مستندات ونصوص'], ['make', 'إنشاء'], ['info', 'معلومات'], ['settings', 'إعدادات']
  ];

  SL.tools = SL.tools || [];
  SL.LS = LS;

  /* ---------- helpers every tool uses ----------
   * Every helper that paints a label translates it here, so a tool passes the Arabic
   * msgid and never thinks about the language. h() translates the tree it builds. */
  SL.h = function (html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  };
  SL.esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  /* Latin numbers inside Arabic text are reordered by the bidi algorithm («4.96 MB ← 193 KB»
     came out scrambled) — every measurement is wrapped in an LTR isolate */
  SL.ltr = function (s) { return '⁦' + s + '⁩'; };
  SL.fmtBytes = function (n) { if (!(n >= 0)) return '—'; var s; if (n < 1024) s = n + ' B'; else if (n < 1048576) s = (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB'; else s = (n / 1048576).toFixed(2) + ' MB'; return SL.ltr(s); };
  SL.dims = function (w, h) { return SL.ltr(w + '×' + h); };
  /* ⚠️ not t('{0}٪'): a msgid with one Arabic letter is under the extractor's floor and
     would ship «٪» into English with every gate green (CLAUDE.md §6.99/8) */
  SL.pctSign = function () { return SL.dir() === 'rtl' ? '٪' : '%'; };
  SL.pct = function (n) { return Math.round(n) + SL.pctSign(); };
  SL.stamp = function () { var d = new Date(), p = function (x) { return String(x).padStart(2, '0'); }; return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); };
  SL.base = function (name) { return (String(name || 'image').replace(/\.[^.]+$/, '').replace(/[^\w؀-ۿ.-]+/g, '_').slice(0, 60)) || 'image'; };
  SL.download = function (blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
  };
  SL.toBlob = function (cv, type, q) { return new Promise(function (res) { cv.toBlob(res, type || 'image/png', q); }); };
  SL.copyCanvas = function (cv) {
    return SL.toBlob(cv, 'image/png').then(function (b) { return navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); })
      .then(function () { SL.toast('نُسخت الصورة إلى الحافظة', 'check'); }, function () { SL.toast('تعذّر النسخ — المتصفّح منع الحافظة', 'close', true); });
  };
  SL.loadImage = function (src) { return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = src; }); };
  /* any File/Blob → canvas (via createImageBitmap, which honours EXIF orientation) */
  SL.fileToCanvas = function (file) {
    var make = window.createImageBitmap ? createImageBitmap(file, { imageOrientation: 'from-image' }) :
      SL.loadImage(URL.createObjectURL(file));
    return Promise.resolve(make).then(function (bmp) {
      var cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
      cv.getContext('2d').drawImage(bmp, 0, 0); if (bmp.close) bmp.close(); return cv;
    });
  };
  SL.cloneCanvas = function (src) { var c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0); return c; };
  SL.pickFiles = function (accept, multiple) {
    return new Promise(function (res) {
      var i = document.createElement('input'); i.type = 'file'; i.accept = accept || 'image/*'; i.multiple = !!multiple;
      i.onchange = function () { res([].slice.call(i.files || [])); }; i.click();
    });
  };
  /* a drop zone wired to a callback with the dropped/picked files */
  SL.dropzone = function (opts) {
    var z = SL.h('<div class="drop" tabindex="0" role="button">'
      + '<span class="big">' + I(opts.icon || 'upload', 'l') + '</span>'
      + '<b></b><small></small></div>');
    z.querySelector('b').textContent = opts.title ? SL.t(opts.title) : SL.t('اسحب صورة هنا أو انقر للاختيار');
    z.querySelector('small').textContent = opts.hint ? SL.t(opts.hint) : SL.t('أو الصقها بـ Ctrl+V — كل شيء يُعالَج على جهازك ولا يُرفع');
    function take(list) { list = list.filter(function (f) { return !opts.filter || opts.filter(f); }); if (list.length) opts.onFiles(list); }
    z.addEventListener('click', function () { SL.pickFiles(opts.accept, opts.multiple).then(take); });
    z.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); z.click(); } });
    ['dragenter', 'dragover'].forEach(function (t) { z.addEventListener(t, function (e) { e.preventDefault(); z.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { z.addEventListener(t, function (e) { e.preventDefault(); z.classList.remove('over'); }); });
    z.addEventListener('drop', function (e) { take([].slice.call((e.dataTransfer && e.dataTransfer.files) || [])); });
    return z;
  };
  /* a segmented control: items [[value, label, icon?]] — labels are msgids */
  SL.seg = function (items, value, onChange) {
    var s = SL.h('<div class="seg" role="radiogroup"></div>');
    items.forEach(function (it) {
      var b = SL.h('<button type="button" role="radio"></button>');
      if (it[2]) b.insertAdjacentHTML('beforeend', I(it[2], 's'));
      b.appendChild(document.createTextNode(SL.t(String(it[1]))));
      b.dataset.v = String(it[0]);
      b.addEventListener('click', function () { set(it[0]); onChange(it[0]); });
      s.appendChild(b);
    });
    function set(v) { [].forEach.call(s.children, function (b) { var on = b.dataset.v === String(v); b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); }
    set(value); s.set = set;
    return s;
  };
  /* a labelled slider with a live number */
  SL.slider = function (label, min, max, step, value, unit, onInput) {
    var f = SL.h('<div class="field"><label><span></span><span class="num"></span></label><input type="range"></div>');
    var r = f.querySelector('input'), out = f.querySelector('.num');
    f.querySelector('label span').textContent = SL.t(label);
    r.min = min; r.max = max; r.step = step; r.value = value;
    function show() { out.textContent = r.value + (unit === '٪' ? SL.pctSign() : unit ? SL.t(unit) : ''); }
    r.addEventListener('input', function () { show(); onInput(Number(r.value)); });
    show(); f.input = r; f.set = function (v) { r.value = v; show(); };
    return f;
  };
  SL.button = function (label, icon, cls, onClick) {
    var b = SL.h('<button type="button" class="btn ' + (cls || '') + '"></button>');
    if (icon) b.insertAdjacentHTML('beforeend', I(icon, 's'));
    if (label) {
      var tl = SL.t(label);
      var s = document.createElement('span'); s.className = 'lbl'; s.textContent = tl; b.appendChild(s);
      b.setAttribute('data-tip', tl); b.setAttribute('aria-label', tl);
    }
    if (onClick) b.addEventListener('click', onClick);
    return b;
  };

  /* ---------- toasts ---------- */
  SL.toast = function (msg, icon, bad) {
    var box = $('.toasts');
    if (!box) return;
    var t = SL.h('<div class="toast' + (bad ? ' bad' : '') + '" role="status"></div>');
    if (icon) t.insertAdjacentHTML('beforeend', I(icon, 's'));
    t.appendChild(document.createTextNode(SL.t(msg)));
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  };

  /* ---------- the shared image ---------- */
  var doc = null, docListeners = [];
  SL.doc = function () { return doc; };
  SL.setDoc = function (canvas, name, meta) {
    doc = { canvas: canvas, name: name || ('image-' + SL.stamp() + '.png'), meta: meta || {} };
    paintFileChip();
    docListeners.slice().forEach(function (f) { try { f(doc); } catch (e) { console.error(e); } });
  };
  SL.onDoc = function (f) { docListeners.push(f); return function () { var i = docListeners.indexOf(f); if (i >= 0) docListeners.splice(i, 1); }; };
  SL.openFileAsDoc = function (file) {
    return SL.fileToCanvas(file).then(function (cv) {
      SL.setDoc(cv, file.name, { size: file.size, type: file.type, file: file });
      return cv;
    }).catch(function () { SL.toast('تعذّر فتح الصورة — الصيغة غير مدعومة', 'close', true); });
  };
  function paintFileChip() {
    var chip = $('#filechip');
    if (!chip) return;
    if (!doc) { chip.hidden = true; return; }
    chip.hidden = false;
    var th = chip.querySelector('img');
    var t = document.createElement('canvas'), k = Math.min(1, 52 / Math.max(doc.canvas.width, doc.canvas.height));
    t.width = Math.max(1, Math.round(doc.canvas.width * k)); t.height = Math.max(1, Math.round(doc.canvas.height * k));
    t.getContext('2d').drawImage(doc.canvas, 0, 0, t.width, t.height);
    th.src = t.toDataURL();
    /* i18n-dyn: the user's file name, not a label */
    chip.querySelector('b').textContent = doc.name;
    chip.querySelector('span').textContent = doc.canvas.width + '×' + doc.canvas.height;
  }

  /* ---------- the host bridge ---------- */
  var Q = new URLSearchParams(location.search);
  var HOST = /^(win|full)$/.test(Q.get('host') || '') ? Q.get('host') : '';
  SL.embedded = !!HOST;
  var modeSeg = null;
  function toHost(cmd, extra) {
    if (!HOST) return;
    var m = { syfsStudio: 1, cmd: cmd };
    if (extra) Object.keys(extra).forEach(function (k) { m[k] = extra[k]; });
    /* '*' because the host page's origin is unknown here, and the message carries a
       command name only — no image, no text, nothing a listener could misuse */
    window.parent.postMessage(m, '*');
  }
  /* host-side notes by CODE: the text never travels in the message (see the header) */
  var NOTES = {
    cancelled: ['أُلغي الالتقاط', 'info', false],
    failed: ['فشل الالتقاط', 'close', true],
    toobig: ['الصورة أكبر من أن تُمرَّر — قصّها أولاً', 'close', true]
  };
  /* A staged image: the worker put it in chrome.storage.session under this key; read it
     once and remove it. The pattern is the worker's own (background.js editKeys). */
  var KEY_RE = /^syfs_edit_[0-9a-f-]{36}$/;
  function takeStaged(k, tool) {
    if (!HAS_CHROME || !chrome.storage.session || typeof k !== 'string' || !KEY_RE.test(k)) return;
    chrome.storage.session.get(k, function (r) {
      var url = r && r[k];
      chrome.storage.session.remove(k);
      if (typeof url !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(url)) return;
      SL.loadImage(url).then(function (im) {
        var cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
        cv.getContext('2d').drawImage(im, 0, 0);
        var t = toolById(tool);
        if (t && !t.action && t.id !== current) open(t.id);
        else if (!t && current !== 'editor') open('editor');
        SL.setDoc(cv, 'capture-' + SL.stamp() + '.png');
      }).catch(function () { SL.toast('تعذّر فتح الصورة — الصيغة غير مدعومة', 'close', true); });
    });
  }
  window.addEventListener('message', function (e) {
    if (!HOST || e.source !== window.parent) return;
    var d = e.data;
    if (!d || typeof d !== 'object' || d.syfsStudio !== 1) return;
    if (d.cmd === 'load') takeStaged(d.k, d.tool);
    else if (d.cmd === 'mode' && /^(win|full)$/.test(d.mode)) { HOST = d.mode; document.documentElement.dataset.host = HOST; if (modeSeg) modeSeg.set(HOST); }
    else if (d.cmd === 'note' && typeof d.code === 'string' && Object.prototype.hasOwnProperty.call(NOTES, d.code)) {
      var n = NOTES[d.code]; SL.toast(n[0], n[1], n[2]);
    }
  });
  /* the whole studio — with whatever image is open — moves to a tab of its own */
  function toTab() {
    if (!HAS_CHROME || !chrome.runtime) return;
    var cur = doc && doc.canvas, url = null;
    if (cur) {
      url = cur.toDataURL('image/png');
      if (url.length > 9 * 1024 * 1024) url = cur.toDataURL('image/jpeg', 0.92);
      if (url.length > 9 * 1024 * 1024) { SL.toast('الصورة أكبر من أن تُمرَّر — قصّها أولاً', 'close', true); return; }
    }
    if (!url) { chrome.tabs.create({ url: chrome.runtime.getURL('studio.html') + '#' + (current || 'editor') }); toHost('close'); return; }
    chrome.runtime.sendMessage({ type: 'SYFS_EDIT_OPEN', dataUrl: url, tool: current || 'editor' }, function (r) {
      if (chrome.runtime.lastError || !r || !r.ok) { SL.toast('تعذّر فتح التبويب', 'close', true); return; }
      toHost('close');
    });
  }

  /* the capture group: buttons, not pages — the HOST shoots its own page */
  if (HOST) {
    SL.tools.push(
      { id: 'cap-region', group: 'capture', label: 'تحديد منطقة', icon: 'region', desc: 'اسحب على أي جزء من الصفحة.', action: function () { toHost('capture', { kind: 'region' }); } },
      { id: 'cap-visible', group: 'capture', label: 'الشاشة المرئية', icon: 'monitor', desc: 'ما يظهر الآن في النافذة.', action: function () { toHost('capture', { kind: 'visible' }); } },
      { id: 'cap-full', group: 'capture', label: 'الصفحة كاملة', icon: 'fullpage', desc: 'الصفحة من أعلاها إلى أسفلها.', action: function () { toHost('capture', { kind: 'full' }); } }
    );
  }

  /* ---------- the frame ---------- */
  var current = null, cleanup = null;
  function toolById(id) { return SL.tools.filter(function (x) { return x.id === id; })[0] || null; }
  function build() {
    /* v0.170.0 — «لوح جانبي زجاجي» (approved design A): the nav is a pane of the same
       frosted glass as the rail, and the current tool's head is the rail window's head —
       the accent as a TINT, white type, the tool's glyph in a lit chip. Everything that
       was in the old top bar (file chip, هـ ⇄ د switch, actions) now lives in that head. */
    var app = SL.h('<div class="app">'
      + '<nav class="nav" aria-label="أدوات الصور">'
      +   '<div class="brand"><span class="mark">' + I('logo') + '</span><div><span class="lbl">الاستوديو</span><small>استوديو الصور الاحترافي</small></div></div>'
      +   '<label class="nsearch">' + I('zoom', 's') + '<input class="in" id="navq" type="search" placeholder="ابحث عن أداة…" aria-label="ابحث عن أداة"></label>'
      +   '<div class="scroll" id="navlist"></div><div class="foot" id="navfoot"></div>'
      + '</nav>'
      + '<div class="work">'
      +   '<header class="whead">'
      +     '<span id="hback"></span>'
      +     '<span class="pic" id="hpic"></span>'
      +     '<div class="ht"><h1 id="htitle"></h1><p id="hdesc"></p></div>'
      +     '<div class="hsibs" id="hsibs"></div>'
      +     '<span class="row" id="hslot"></span>'
      +     '<span class="sp"></span>'
      +     '<div class="filechip" id="filechip" hidden><img alt=""><b></b><span class="num"></span></div>'
      +     '<span id="layslot"></span>'
      +     '<span id="modeslot"></span>'
      +     '<span id="topacts" class="row"></span>'
      +   '</header>'
      +   '<main class="main" id="main"></main>'
      + '</div>'
      + '</div>');
    document.body.appendChild(app);
    document.body.appendChild(SL.h('<div class="toasts" aria-live="polite"></div>'));

    /* هـ ⇄ د — the switch the v0.165.0 studio hid behind the window's ⤢. Labelled, in the
       top bar, always in view: the user asked for it by name and could not find it. */
    if (HOST) {
      modeSeg = SL.seg([['win', 'نافذة عائمة‖وضع الاستوديو', 'floatwin'], ['full', 'ملء الشاشة', 'maximize']], HOST, function (v) {
        HOST = v; document.documentElement.dataset.host = v; toHost('mode', { mode: v });
      });
      modeSeg.classList.add('modeseg');
      modeSeg.setAttribute('aria-label', SL.t('طريقة العرض'));
      $('#modeslot').appendChild(modeSeg);
    }

    /* v0.172.0 — «بلاطات» ⇄ «قائمة جانبية». Tiles (the default): no side nav, a start
       screen of every tool in glass columns, and a «كل الأدوات» key back to it. The side
       list is the v0.170.0 frame, unchanged. Each key = glyph + word; the word folds away
       on a narrow head. */
    layoutSeg = SL.h('<div class="seg layseg" role="radiogroup"></div>');
    layoutSeg.setAttribute('aria-label', SL.t('شكل الاستوديو'));
    [['tiles', 'بلاطات', 'tiles'], ['side', 'قائمة جانبية', 'sidelist']].forEach(function (it) {
      var b = SL.h('<button type="button" role="radio">' + I(it[2], 's') + '<span class="lbl"></span></button>');
      var tl = SL.t(it[1]);
      b.querySelector('.lbl').textContent = tl; b.dataset.tip = tl; b.dataset.v = it[0];
      b.addEventListener('click', function () { setLayout(it[0]); });
      layoutSeg.appendChild(b);
    });
    $('#layslot').appendChild(layoutSeg);
    var back = SL.button('كل الأدوات', 'chevron', 'sm back', showHome);
    $('#hback').appendChild(back);

    /* top actions — each icon + label, collapsing to the icon in icons-only mode */
    /* in the head the actions are glyphs with a tooltip — «فتح صورة» alone keeps its word,
       it is the first thing a new user looks for */
    var acts = $('#topacts');
    acts.appendChild(SL.button('فتح صورة', 'open', 'sm', function () { SL.pickFiles('image/*').then(function (f) { if (f[0]) SL.openFileAsDoc(f[0]); }); }));
    var labBtn = SL.button('', 'labels', 'sm icon tiponly', toggleLabels); acts.appendChild(labBtn);
    acts.appendChild(SL.button('المظهر', 'theme', 'sm icon tiponly', toggleThemes));
    if (HOST && HAS_CHROME) acts.appendChild(SL.button('فتح في تبويب', 'tab', 'sm icon tiponly', toTab));
    function paintLabBtn() {
      var icons = document.documentElement.dataset.labels === 'icons';
      labBtn.innerHTML = I(icons ? 'labels' : 'iconsOnly', 's') + '<span class="lbl"></span>';
      var t = icons ? SL.t('إظهار النصوص') : SL.t('أيقونات فقط');
      labBtn.querySelector('.lbl').textContent = t; labBtn.dataset.tip = t; labBtn.setAttribute('aria-label', t);
    }
    function toggleLabels() {
      var icons = document.documentElement.dataset.labels !== 'icons';
      document.documentElement.dataset.labels = icons ? 'icons' : 'full';
      LS.set('labels', icons ? 'icons' : 'full'); paintLabBtn();
    }
    SL.toggleLabels = toggleLabels;
    paintLabBtn();

    /* nav */
    var list = $('#navlist');
    GROUPS.forEach(function (g) {
      var tools = SL.tools.filter(function (t) { return t.group === g[0]; });
      if (!tools.length) return;
      var h = document.createElement('h6'); h.textContent = SL.t(g[1]); list.appendChild(h);
      tools.forEach(function (t) {
        var b = SL.h('<button type="button" class="item">' + I(t.icon) + '<span class="lbl"></span></button>');
        var tl = SL.t(t.label);
        b.querySelector('.lbl').textContent = tl;
        if (t.badge) { var bd = document.createElement('span'); bd.className = 'badge'; bd.textContent = SL.t(t.badge); b.appendChild(bd); }
        b.dataset.tip = tl; b.dataset.id = t.id; b.setAttribute('aria-label', tl);
        if (t.action) { b.classList.add('act'); b.addEventListener('click', t.action); }
        else b.addEventListener('click', function () { open(t.id); });
        list.appendChild(b);
      });
    });
    /* the search filters the list in place; a group whose every tool is filtered out
       loses its heading too. Enter opens the first match. */
    var q = $('#navq');
    q.addEventListener('input', function () {
      var s = q.value.trim().toLowerCase(), head = null, shown = 0;
      [].forEach.call(list.children, function (el) {
        if (el.tagName === 'H6') { if (head) head.hidden = !shown; head = el; shown = 0; return; }
        var hit = !s || (el.getAttribute('aria-label') || '').toLowerCase().indexOf(s) >= 0;
        el.hidden = !hit; if (hit) shown++;
      });
      if (head) head.hidden = !shown;
    });
    q.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var first = list.querySelector('.item:not([hidden])');
      if (first) first.click();
    });

    var foot = $('#navfoot');
    var shortcuts = SL.h('<button type="button" class="item">' + I('keyboard') + '<span class="lbl">اختصارات لوحة المفاتيح</span></button>');
    shortcuts.dataset.tip = SL.t('اختصارات لوحة المفاتيح');
    shortcuts.addEventListener('click', function () { SL.toast('V تحريك · M تحديد · C قصّ · B فرشاة · E ممحاة · T نص · U شكل · I قطّارة · G تعبئة · H يد · Z تكبير · Ctrl+Z تراجع', 'keyboard'); });
    foot.appendChild(shortcuts);

    /* paste an image anywhere = open it */
    document.addEventListener('paste', function (e) {
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image/') === 0) {
          var f = items[i].getAsFile();
          if (f) { e.preventDefault(); SL.openFileAsDoc(new File([f], 'pasted-' + SL.stamp() + '.png', { type: f.type })); }
          return;
        }
      }
    });
  }

  /* ---------- theme popover ---------- */
  var pop = null;
  function applyTheme(id) { document.documentElement.dataset.theme = id; LS.set('theme', id); if (pop) paintThemes(); }
  function paintThemes() {
    [].forEach.call(pop.querySelectorAll('.theme-card'), function (c) { c.classList.toggle('on', c.dataset.id === document.documentElement.dataset.theme); });
  }
  function toggleThemes(e) {
    if (e) e.stopPropagation();
    if (pop) { pop.remove(); pop = null; return; }
    pop = SL.h('<div class="pop" role="dialog" aria-label="المظهر"><h4>المظهر</h4><div class="themes"></div>'
      + '<h4 style="margin-top:14px">عرض الأدوات</h4><div id="labseg"></div></div>');
    var box = pop.querySelector('.themes');
    THEMES.forEach(function (t) {
      var c = SL.h('<button type="button" class="theme-card"><div class="tp"><i></i><div><i></i><i></i></div></div><span></span></button>');
      var is = c.querySelectorAll('i');
      is[0].style.background = t.nav || t.sw[0]; is[1].style.background = t.sw[0]; is[2].style.background = t.sw[1];
      is[1].style.borderBottom = '3px solid ' + t.sw[2];
      c.querySelector('span').textContent = SL.t(t.name);
      c.dataset.id = t.id;
      c.addEventListener('click', function () { applyTheme(t.id); });
      box.appendChild(c);
    });
    pop.querySelector('#labseg').appendChild(SL.seg([['full', 'أيقونات ونصوص', 'labels'], ['icons', 'أيقونات فقط', 'iconsOnly']],
      document.documentElement.dataset.labels === 'icons' ? 'icons' : 'full', function (v) {
        if ((document.documentElement.dataset.labels === 'icons') !== (v === 'icons')) SL.toggleLabels();
      }));
    pop.addEventListener('click', function (ev) { ev.stopPropagation(); });
    document.body.appendChild(pop);
    paintThemes();
  }
  document.addEventListener('click', function () { if (pop) { pop.remove(); pop = null; } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && pop) { pop.remove(); pop = null; } });

  /* ---------- layout: «بلاطات» (start screen) ⇄ «قائمة جانبية» (v0.172.0) ---------- */
  var layoutSeg = null;
  var GROUP_IC = { capture: 'region', edit: 'editor', convert: 'compress', docs: 'pdf', make: 'qr', info: 'info', settings: 'settings' };
  function tiles() { return document.documentElement.dataset.layout === 'tiles'; }
  function setLayout(v) {
    v = v === 'side' ? 'side' : 'tiles';
    document.documentElement.dataset.layout = v; LS.set('layout', v);
    if (layoutSeg) [].forEach.call(layoutSeg.children, function (b) { var on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    /* the start screen exists only in tiles; the side list always shows a tool */
    if (v === 'side' && current === 'home') open(LS.get('tool', 'editor'));
    else if (current && current !== 'home') paintSibs(toolById(current));
  }
  function setHash(id) {
    /* the hash names the page; the staged-image key (?k=) is single-use — dropped here */
    var qs = new URLSearchParams(location.search); qs.delete('k');
    var want = location.pathname + (qs.toString() ? '?' + qs : '') + '#' + id;
    if (location.pathname + location.search + location.hash !== want) history.replaceState(null, '', want);
  }
  /* the head's strip of the open tool's neighbours (same group) — tiles only */
  function paintSibs(t) {
    var box = $('#hsibs'); box.textContent = '';
    if (!t || !tiles()) return;
    var sibs = SL.tools.filter(function (x) { return x.group === t.group && !x.action; });
    if (sibs.length < 2) return;
    sibs.forEach(function (x) {
      var b = SL.h('<button type="button" class="hsib">' + I(x.icon, 's') + '<span></span></button>');
      b.lastChild.textContent = SL.t(x.label);
      if (x.id === t.id) { b.classList.add('on'); b.setAttribute('aria-current', 'page'); }
      b.addEventListener('click', function () { open(x.id); });
      box.appendChild(b);
    });
  }
  function remember(id) {
    var r = LS.get('recent', []);
    r = [id].concat((Array.isArray(r) ? r : []).filter(function (x) { return x !== id && toolById(x); })).slice(0, 3);
    LS.set('recent', r);
  }
  /* a tool row on the start screen and its chip in «آخر استخدام» run what the nav
     item runs: a capture key fires its action, every other tool opens */
  function run(t) { if (t.action) { remember(t.id); t.action(); } else open(t.id); }

  function showHome() {
    if (!tiles()) { open(LS.get('tool', 'editor')); return; }
    if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
    current = 'home'; setHash('home');
    document.documentElement.dataset.page = 'home';
    [].forEach.call(document.querySelectorAll('.nav .item[data-id]'), function (b) { b.classList.remove('on'); b.setAttribute('aria-current', 'false'); });
    $('#hpic').innerHTML = I('logo');
    $('#htitle').textContent = SL.t('الاستوديو');
    $('#hdesc').textContent = SL.t('كل أدوات الصور في مكان واحد — على جهازك، بلا رفع.');
    $('#hslot').textContent = ''; $('#hsibs').textContent = '';
    var main = $('#main'); main.textContent = '';
    var page = SL.h('<div class="page home">'
      + '<div class="hero"><h2>ماذا تريد أن تفعل بالصورة؟</h2>'
      +   '<label class="hsearch">' + I('zoom') + '<input class="in" type="search" placeholder="ابحث: ضغط، خلفية، QR…" aria-label="ابحث عن أداة"></label>'
      +   '<div class="recent" hidden><span class="hint">آخر استخدام:</span></div></div>'
      + '<div class="hcols"></div>'
      + '<p class="hnone" hidden>لا أداة بهذا الاسم.</p>'
      + '</div>');
    main.appendChild(page);

    var rec = page.querySelector('.recent');
    (LS.get('recent', []) || []).map(toolById).filter(Boolean).forEach(function (t) {
      var c = SL.h('<button type="button" class="hchip">' + I(t.icon, 's') + '<span></span></button>');
      c.lastChild.textContent = SL.t(t.label);
      c.addEventListener('click', function () { run(t); });
      rec.appendChild(c); rec.hidden = false;
    });

    /* «أعمدة زجاجية» (approved design 1): one glass column per group. CSS columns pack
       them — a short group sits under another rather than leaving a hole. */
    var cols = page.querySelector('.hcols'), rows = [];
    GROUPS.forEach(function (g) {
      var tools = SL.tools.filter(function (t) { return t.group === g[0]; });
      if (!tools.length) return;
      var col = SL.h('<section class="hcol"><div class="hgh"><span class="gi">' + I(GROUP_IC[g[0]] || tools[0].icon, 's') + '</span><b></b><span class="n num"></span></div></section>');
      col.querySelector('b').textContent = SL.t(g[1]);
      col.querySelector('.n').textContent = tools.length; /* i18n-dyn: a count */
      tools.forEach(function (t) {
        var b = SL.h('<button type="button" class="htool"><span class="ti">' + I(t.icon) + '</span><b><span class="lbl"></span></b><span class="d"></span></button>');
        var tl = SL.t(t.label), d = t.desc ? SL.t(t.desc) : '';
        b.querySelector('.lbl').textContent = tl;
        if (t.badge) { var bd = document.createElement('span'); bd.className = 'badge'; bd.textContent = SL.t(t.badge); b.querySelector('b').appendChild(bd); }
        b.querySelector('.d').textContent = d; if (d) b.title = d;
        b.addEventListener('click', function () { run(t); });
        col.appendChild(b);
        rows.push({ b: b, col: col, text: (tl + ' ' + d + ' ' + t.label).toLowerCase() });
      });
      cols.appendChild(col);
    });

    /* the search hides rows in place, a column with no row left goes too; Enter = first */
    var q = page.querySelector('input'), none = page.querySelector('.hnone');
    q.addEventListener('input', function () {
      var s = q.value.trim().toLowerCase(), any = false;
      rows.forEach(function (r) { r.b.hidden = !!s && r.text.indexOf(s) < 0; });
      [].forEach.call(cols.children, function (c) { c.hidden = !c.querySelector('.htool:not([hidden])'); if (!c.hidden) any = true; });
      none.hidden = any;
    });
    q.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var first = cols.querySelector('.htool:not([hidden])');
      if (first) first.click();
    });
    if (!('ontouchstart' in window)) q.focus();
  }
  SL.home = showHome;

  /* ---------- routing ---------- */
  function open(id) {
    if (id === 'home') { showHome(); return; }
    var t = toolById(id);
    if (!t || t.action) t = toolById('editor') || SL.tools.filter(function (x) { return !x.action; })[0];
    if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
    current = t.id; LS.set('tool', t.id); remember(t.id);
    document.documentElement.dataset.page = 'tool';
    setHash(t.id);
    paintSibs(t);
    [].forEach.call(document.querySelectorAll('.nav .item[data-id]'), function (b) { b.classList.toggle('on', b.dataset.id === t.id); b.setAttribute('aria-current', b.dataset.id === t.id ? 'page' : 'false'); });
    var main = $('#main'); main.textContent = '';
    /* the glass head names the tool (it replaced each page's own heading) */
    $('#hpic').innerHTML = I(t.icon);
    $('#htitle').textContent = SL.t(t.label);
    $('#hdesc').textContent = t.desc ? SL.t(t.desc) : '';
    var slot = $('#hslot'); slot.textContent = '';
    var page;
    if (t.full) { page = SL.h('<div style="flex:1;min-height:0;display:flex;flex-direction:column"></div>'); }
    else page = SL.h('<div class="page"><div data-body></div></div>');
    main.appendChild(page);
    try {
      cleanup = t.mount(t.full ? page : page.querySelector('[data-body]'), { head: t.full ? null : slot }) || null;
      if (!t.full) sideTabs(page, t.id);
    }
    catch (e) { console.error(e); main.textContent = SL.t('خطأ في تحميل الأداة: {0}', e.message); }
  }
  SL.open = open;

  /* ---------- side tabs («أيقونة فوق نص», approved design T2, v0.170.0) ----------
   * Every tool builds its options column the same way: a heading <h3> (glyph + words)
   * opening each section — either a bare <h3> followed by its controls, or a .card/.stack
   * whose first child is the <h3>. Rather than rewrite fourteen tools, the frame reads
   * that shape after mount and turns each section into a vertical tab: the h3's own glyph
   * over its own words. The tool keeps every reference it holds — nodes are MOVED, never
   * rebuilt — so its listeners and later updates land where they always did.
   * The run button (.btn.pri) and the progress bar are never inside a tab: they stay
   * under the panel, whichever tab is open. Fewer than two sections ⇒ nothing changes. */
  function collect(box) {
    var out = { secs: [], pre: [], foot: [] }, cur = null;
    [].slice.call(box.children).forEach(function (c) {
      var first = c.firstElementChild;
      if (c.tagName === 'H3') { cur = { h3: c, nodes: [c] }; out.secs.push(cur); return; }
      if (first && first.tagName === 'H3' && (c.classList.contains('card') || c.classList.contains('stack'))) {
        cur = null; out.secs.push({ h3: first, wrap: c, nodes: [c] }); return;
      }
      if (c.classList.contains('progress') || (c.classList.contains('btn') && c.classList.contains('pri'))) { out.foot.push(c); return; }
      if (cur) cur.nodes.push(c);
      else (out.secs.length ? out.foot : out.pre).push(c);
    });
    return out;
  }
  function sideTabs(page, toolId) {
    var col = page.querySelector('.grid2 > [data-r], .grid2 > [data-right]');
    if (!col) return;
    var box = col, got = collect(box);
    while (got.secs.length < 2 && box.children.length === 1) { box = box.firstElementChild; got = collect(box); }
    if (got.secs.length < 2) return;

    var nav = SL.h('<nav class="stabs-nav" role="tablist" aria-orientation="vertical"></nav>');
    nav.setAttribute('aria-label', SL.t('إعدادات الأداة'));
    var panel = SL.h('<div class="stabs-panel card stack"></div>');
    got.pre.forEach(function (n) { panel.appendChild(n); });
    var tabs = got.secs.map(function (s, i) {
      var pane = SL.h('<div class="stabs-pane stack" role="tabpanel"></div>');
      s.nodes.forEach(function (n) { pane.appendChild(n); });
      if (s.wrap) { s.wrap.classList.remove('card'); s.wrap.classList.add('stabs-wrap'); }
      panel.appendChild(pane);
      /* the tab's words: the heading minus any button or note a tool put inside it */
      var h = s.h3.cloneNode(true);
      [].forEach.call(h.querySelectorAll('button, .note, .sp, svg'), function (x) { x.remove(); });
      var label = h.textContent.trim();
      var svg = s.h3.querySelector('svg');
      var b = SL.h('<button type="button" role="tab" class="stab"><span class="tw"></span><span class="tl"></span></button>');
      if (svg) { var g = svg.cloneNode(true); g.setAttribute('class', 'ic'); b.firstChild.appendChild(g); }
      b.lastChild.textContent = label;
      b.id = 'stab-' + toolId + '-' + i; pane.id = b.id + '-p';
      b.setAttribute('aria-controls', pane.id); pane.setAttribute('aria-labelledby', b.id);
      b.addEventListener('click', function () { pick(i, true); });
      nav.appendChild(b);
      return { b: b, pane: pane, watch: s.wrap || s.h3 };
    });
    got.foot.forEach(function (n) { panel.appendChild(n); });
    col.textContent = '';
    col.classList.remove('card');
    col.classList.add('stabs');
    col.appendChild(nav); col.appendChild(panel);
    col.parentNode.classList.add('has-stabs');

    var key = 'stab_' + toolId, cur = -1;
    function visible(i) { return !tabs[i].watch.hidden; }
    function pick(i, remember) {
      if (!visible(i)) i = tabs.map(function (x, k) { return k; }).filter(visible)[0];
      if (i === undefined) return;
      cur = i;
      tabs.forEach(function (x, k) { var on = k === i; x.b.classList.toggle('on', on); x.b.setAttribute('aria-selected', on); x.b.tabIndex = on ? 0 : -1; x.pane.hidden = !on; });
      if (remember) LS.set(key, i);
    }
    /* a tool hides a section until it applies (e.g. a card shown once an image is open):
       the tab follows its section */
    var mo = new MutationObserver(function () {
      tabs.forEach(function (x, k) { x.b.hidden = !visible(k); });
      if (cur < 0 || !visible(cur)) pick(LS.get(key, 0), false);
    });
    tabs.forEach(function (x, k) { x.b.hidden = !visible(k); mo.observe(x.watch, { attributes: true, attributeFilter: ['hidden'] }); });
    nav.addEventListener('keydown', function (e) {
      var d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      for (var k = 1; k <= tabs.length; k++) {
        var j = (cur + d * k + tabs.length * k) % tabs.length;
        if (visible(j)) { pick(j, true); tabs[j].b.focus(); return; }
      }
    });
    var want = LS.get(key, 0);
    pick(want >= 0 && want < tabs.length ? want : 0, false);
  }

  /* ---------- English: translate whatever the tools paint later ----------
   * Helpers and h() already translate. This catches the rest — a status line a tool
   * rewrites after the fact — with the same tree() src/i18n.js uses on a built fragment.
   * In Arabic (the default) it is never installed. Translating twice is a no-op: the
   * English text is not a msgid, so the lookup returns it unchanged. */
  var ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip'];
  function watchI18n() {
    if (!window.SYFS || !SYFS.i18n || SYFS.i18n.get() === SYFS.i18n.DEFAULT) return;
    new MutationObserver(function (list) {
      list.forEach(function (m) {
        if (m.type === 'childList') { for (var i = 0; i < m.addedNodes.length; i++) SYFS.i18n.tree(m.addedNodes[i]); }
        else if (m.type === 'characterData') SYFS.i18n.tree(m.target);
        else if (m.type === 'attributes') {
          var v = (m.target.getAttribute(m.attributeName) || '').trim();
          if (!v) return;
          var tv = SL.t(v);
          if (tv !== v) m.target.setAttribute(m.attributeName, tv);
        }
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function start() {
    var root = document.documentElement;
    root.setAttribute('lang', (window.SYFS && SYFS.i18n) ? SYFS.i18n.get() : 'ar');
    root.setAttribute('dir', SL.dir());
    root.dataset.host = HOST || 'tab';
    var th = LS.get('theme', 'accent');
    root.dataset.theme = THEMES.some(function (x) { return x.id === th; }) ? th : 'accent';
    root.dataset.labels = LS.get('labels', 'full') === 'icons' ? 'icons' : 'full';
    document.title = SL.t('الاستوديو — SYF');
    root.dataset.layout = LS.get('layout', 'tiles') === 'side' ? 'side' : 'tiles';
    watchI18n();
    build();
    setLayout(root.dataset.layout);
    /* tiles open on the start screen unless the URL names a tool or brings an image;
       the side list opens the last tool, as it always did */
    var hash = (location.hash || '').slice(1);
    var k = Q.get('k');
    var want = hash && hash !== 'home' ? hash : (k || !tiles() ? LS.get('tool', 'editor') : 'home');
    open(want);
    if (k) takeStaged(k, want);
    toHost('ready');
  }
  function boot() { Promise.all([loadPrefs(), loadLang(), loadAccent()]).then(start, start); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
}());
