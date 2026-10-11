/* SYF — App Mode workspace (app.html).
 *
 * A Photoshop-style workspace: a left tool palette (dock) launches each tool as a
 * FLOATING, draggable, resizable window; many tools stay open at once. It runs on
 * the standalone extension page (NOT a content script) and reuses the exact same
 * registry — each tool's mount(body) verbatim and rail.css's .syfs-win window
 * chrome — so there is no second implementation of any tool or window.
 *
 * app.html loads EVERY tool file the rail gets (manifest bootstrap + LAZY_TOOL_FILES)
 * except a short list of files that only act on a host web page — that list, with the
 * reason for each, is in tools/appmode-parity-test.js, which fails the moment a tool
 * file or a tool id reaches the rail and not this page. Tools from loaded files that
 * still need a host page are hidden by PAGE_ONLY below. Everything is offline /
 * whitelisted exactly as in the rail; this page opens no new capability. app.js
 * provides the SYFS helpers the tools expect from rail.js (mountEl / topZ / openFrame /
 * openToolById / openSide / openPanel). */
(function () {
  'use strict';

  var SYFS = window.SYFS || (window.SYFS = {});
  var tools = SYFS.tools || (SYFS.tools = []);
  var cats = SYFS.cats || (SYFS.cats = {});
  var store = SYFS.store;

  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    /* the template's own text IS the msgid — translate the built tree rather than
       splitting the markup (see src/i18n.js). Free in the default language. */
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }

  /* ---- which tools belong in app mode (page-context tools are hidden) ----
     screenshot + regionshot ARE shown, but with app-mode mounts (APP_OVERRIDE)
     that capture the active REAL web tab instead of this extension page. */
  var PAGE_ONLY = {
    sitecleaner: 1, formfill: 1,    /* extras.js — act on the current site / its forms */
    watch: 1,                       /* extras.js — watches THIS tab's document (v0.115.0) */
    devcolor: 1, devinspect: 1, devviewport: 1,  /* dev.js — inspect the host page */
    devpage: 1, devnet: 1,                       /* dev2.js — audit / request from the host page (v0.118.0) */
    cookiemgr: 1, readsave: 1                    /* tools3.js — this site's cookies / this page's article (v0.118.0) */
  };
  /* the wide-window list lives in src/tools.js (v0.139.0) so the rail and this page
     open the same tools wide — every page that runs app.js loads tools.js first. The
     local copy that used to stand in for it had already drifted (no `notepad`). */
  var WIDE = SYFS.WIDE_TOOLS || {};

  /* ---- full-screen "page" tools that open as tabs INSIDE the workspace ----
     In App Mode these normally open a separate browser tab (tool.action → background
     → chrome.tabs.create). When the workspace hosts a tab strip (#syfa-tabs, present
     only in app.html) we instead embed the very same extension page in an <iframe>
     browser-style tab. The page is loaded with #embed so its own copy of app.js
     suppresses the redundant floating dock (this workspace already has one). */
  var PAGE_TABS = {
    sheetview:  { url: 'sheet.html',  label: 'جداول الإكسيل' },
    docedit:    { url: 'word.html',   label: 'مستندات Word' },
    slidesedit: { url: 'slides.html', label: 'عروض PowerPoint' },
    mailwriter: { url: 'mail.html',   label: 'محرّر الإيميلات' },
    /* phones.html carries no copy of app.js, so there is no second dock to
       suppress — it embeds cleanly with nothing to do about #embed. */
    phones:     { url: 'phones.html', label: 'منسّق أرقام الجوال' },
    status:     { url: 'status.html', label: 'صانع الحالات' },
    /* four entries, one page — the fragment picks the panel (src/video-page.js) */
    frames:     { url: 'video.html#frames',  label: 'الفيديو ⇒ صور' },
    vaudio:     { url: 'video.html#audio',   label: 'فصل الصوت' },
    vtrim:      { url: 'video.html#trim',    label: 'قصّ الفيديو' },
    vconv:      { url: 'video.html#convert', label: 'تحويل صيغة الفيديو' }
  };
  /* this page is itself embedded in a workspace tab → don't build a second dock */
  var EMBED = /(^|[#&])embed\b/.test(location.hash || '');

  function usable(t) { return t && t.id !== 'appmode' && !t.noRail && !PAGE_ONLY[t.id] && (typeof t.mount === 'function' || typeof t.action === 'function'); }
  function toolById(id) { for (var i = 0; i < tools.length; i++) if (tools[i].id === id) return tools[i]; return null; }

  /* v0.77.0 — the same order the rail ships (src/rail.js ORDER + 'ai'), from the
     user's own export. These two lists USED to disagree — the workspace dock put
     links second while the rail put shield fourth — so the same
     product taught two different layouts depending on which surface you opened.
     Keep them in step: a change here needs the same change there. */
  var CAT_ORDER = ['islam', 'calc', 'note', 'docs', 'time', 'media', 'util', 'shield', 'perf', 'links', 'dev', 'ai'];
  var CAT_FALLBACK = {
    calc: 'حاسبات', time: 'الوقت', islam: 'إسلامية', note: 'ملاحظات ونصوص',
    media: 'الصور', dev: 'مطوّرين', util: 'أدوات', links: 'روابط', ai: 'المساعد الذكي',
    shield: 'الحماية', docs: 'المستندات'
  };
  var DEFAULT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>';
  var STAR_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17.3 5.8 20.9l1.6-6.8L2.2 8.9l6.9-.6z"/></svg>';
  function catLabel(ck) { return (cats[ck] && cats[ck].label) || CAT_FALLBACK[ck] || ck; }
  function catIcon(ck) { return (cats[ck] && cats[ck].icon) || DEFAULT_ICON; }

  /* ---- theme (accent + button style), shared with the rail ---- */
  var root = document.getElementById('syfa-root');
  /* The host page tunes where the dock sits and under which key its position is
     saved: App Mode owns the whole viewport, while sheet.html hosts the dock over
     a spreadsheet and must clear its footer. Everything else is identical. */
  var DOCK_KEY = (root && root.dataset.dockKey) || 'app_dock_pos';
  var DOCK_BOTTOM = (root && parseInt(root.dataset.dockBottom, 10)) || 20;
  function hexRgb(hex) { hex = hex.replace('#', ''); return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]; }
  function applyAccent(hex) {
    if (!/^#?[0-9a-fA-F]{6}$/.test(hex)) return;
    var t = hexRgb(hex), d = t.map(function (v) { return Math.max(0, Math.round(v * 0.72)); });
    var l = t.map(function (v) { return Math.min(255, Math.round(v * 1.32)); });   /* the lit face of the 160deg gradient */
    /* apply to the app root AND the floating overlay (windows + palette live there) */
    [root, layerEl].forEach(function (el) {
      if (!el) return;
      el.style.setProperty('--pri', 'rgb(' + t.join(',') + ')');
      el.style.setProperty('--pri2', 'rgb(' + l.join(',') + ')');
      el.style.setProperty('--pri-d', 'rgb(' + d.join(',') + ')');
      el.style.setProperty('--pri-rgb', t.join(','));
      /* components on their own: the glass window head tints with rgba() and an
         `rgb(…)` string cannot take an alpha (same reason as rail.js) */
      el.style.setProperty('--pri-d-rgb', d.join(','));
    });
  }
  function loadTheme() {
    store.get('accent', '#457364').then(function (a) { applyAccent(a || '#457364'); });
    store.get('cstyle', 'solid').then(function (s) {
      s = cstyleOf(s);
      root.dataset.cstyle = s; if (layerEl) layerEl.dataset.cstyle = s;
    });
    /* window-button look (rail.js settings → «شكل أزرار النافذة») */
    store.get('winbtn', SYFS.prefs.WINBTN_DEFAULT).then(function (s) {
      s = SYFS.prefs.pickOne(SYFS.prefs.WINBTN_VALUES, s, SYFS.prefs.WINBTN_DEFAULT);
      root.dataset.winbtn = s; if (layerEl) layerEl.dataset.winbtn = s;
    });
  }
  /* v0.139.4: the stored style is checked against the known list, same rule as the rail
     and the import (SYFS.prefs.pickOne) — an unknown value falls back to 'solid' instead
     of landing in a data attribute the CSS has no rule for. rail.js (which owns
     SYFS.STYLES) is not loaded on this page, hence the local copy of the ids. */
  var CSTYLE_IDS = ['solid', 'glass', 'frost', 'liquid', 'outline', 'dark', 'contrast', 'neon', 'gradient', 'tonal', 'neu', 'key3d', 'round', 'minimal', 'gold'];
  function cstyleOf(s) {
    var ids = SYFS.STYLES ? SYFS.STYLES.map(function (x) { return x[0]; }) : CSTYLE_IDS;
    return SYFS.prefs ? SYFS.prefs.pickOne(ids, s, 'solid') : (ids.indexOf(s) >= 0 ? s : 'solid');
  }

  /* ---- floating layer: a fixed, click-through overlay whose children (windows,
         sticky notes) are interactive — mirrors rail.js's host overlay ---- */
  var zTop = 30, layerEl = null;
  function layer() {
    if (!layerEl) {
      layerEl = document.createElement('div');
      layerEl.className = 'syfs-wrap';
      layerEl.setAttribute('dir', 'rtl');
      layerEl.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
      var st = getComputedStyle(root);
      ['--pri', '--pri2', '--pri-d', '--pri-rgb', '--pri-d-rgb'].forEach(function (v) { var val = st.getPropertyValue(v); if (val) layerEl.style.setProperty(v, val.trim()); });
      /* the windows live here, so the button looks must too — loadTheme() may have run first */
      ['cstyle', 'winbtn'].forEach(function (k) { if (root.dataset[k]) layerEl.dataset[k] = root.dataset[k]; });
      document.body.appendChild(layerEl);
    }
    return layerEl;
  }

  /* ---- favorites (shared with the rail via the 'favorites' storage key) ---- */
  var favs = [];
  function isFav(id) { return favs.indexOf(id) >= 0; }
  function toggleFav(id) {
    var i = favs.indexOf(id);
    if (i >= 0) favs.splice(i, 1); else favs.push(id);
    store.set('favorites', favs);
    renderPalette();
    for (var wid in openWins) if (openWins.hasOwnProperty(wid)) { var s = openWins[wid].querySelector('.syfs-win-star'); if (s) s.classList.toggle('on', isFav(wid)); }
  }

  /* ---------- app-mode capture (screenshot / region) ----------
     These target the active REAL web tab via the worker (SYFS_APP_CAPTURE), not
     this extension page. Region cropping is done here on the captured image.
     Works best with App Mode opened as a standalone window (⤢) so a real page
     stays active in the browser window. */
  function capName(p) { return (p || 'shot') + '-' + Date.now() + '.png'; }
  function capErr(e) {
    if (e === 'no-tab') return 'لا يوجد تبويب ويب حقيقي نشط. افتح صفحة ويب في نافذة المتصفّح (والأفضل أن يكون وضع العمل في نافذة مستقلّة ⤢) ثم أعد المحاولة.';
    return 'تعذّر الالتقاط — تأكّد من وجود صفحة ويب حقيقية نشطة (ليست صفحة داخلية)' + (e ? ' — ' + e : '') + '.';
  }
  function dlData(dataUrl, name) { var a = document.createElement('a'); a.href = dataUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  function copyCanvas(canvas, cb) {
    if (!(navigator.clipboard && window.ClipboardItem)) { cb(false, 'الحافظة غير مدعومة'); return; }
    canvas.toBlob(function (b) { if (!b) { cb(false); return; } navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).then(function () { cb(true); }).catch(function (e) { cb(false, e && e.message); }); }, 'image/png');
  }
  function imgToCanvas(im) { var c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); return c; }

  function mountAppShot(body) {
    body.textContent = '';
    var wrap = h('<div class="syf-form"></div>');
    var btn = h('<button class="syf-btn" type="button">📸 التقط التبويب الحالي</button>');
    var st = h('<div style="min-height:18px;color:var(--mut);font-size:12px;margin:6px 0"></div>');
    var img = h('<img alt="لقطة الشاشة" style="max-width:100%;border:1px solid var(--line);border-radius:8px;display:none">');
    var acts = h('<div class="syf-seg" style="display:none;gap:6px;margin-top:8px"></div>');
    var dlBtn = h('<button class="syf-mini" type="button">تنزيل PNG</button>');
    var cpBtn = h('<button class="syf-mini" type="button">نسخ</button>');
    acts.appendChild(dlBtn); acts.appendChild(cpBtn);
    wrap.appendChild(btn); wrap.appendChild(st); wrap.appendChild(img); wrap.appendChild(acts);
    body.appendChild(wrap);
    var cur = null;
    btn.addEventListener('click', function () {
      st.textContent = SYFS.t('جارٍ الالتقاط…');
      bg('SYFS_APP_CAPTURE').then(function (r) {
        r = r || { ok: false };
        if (!r.ok) { st.textContent = capErr(r.error); return; }
        cur = r.dataUrl; img.src = cur; img.style.display = 'block'; acts.style.display = 'flex';
        st.textContent = r.title ? SYFS.t('من: {0}', r.title) : SYFS.t('تمّ ✓');   /* textContent — page title never injected as HTML */
      });
    });
    dlBtn.addEventListener('click', function () { if (cur) dlData(cur, capName('tab')); });
    cpBtn.addEventListener('click', function () { if (!cur) return; var im = new Image(); im.onload = function () { copyCanvas(imgToCanvas(im), function (ok, e) { st.textContent = ok ? SYFS.t('نُسخت ✓') : SYFS.t('تعذّر النسخ: {0}', e || ''); }); }; im.src = cur; });
  }

  function mountAppRegion(body) {
    body.textContent = '';
    var wrap = h('<div class="syf-form"></div>');
    var btn = h('<button class="syf-btn" type="button">📸 التقط التبويب ثم حدّد منطقة</button>');
    var st = h('<div style="min-height:18px;color:var(--mut);font-size:12px;margin:6px 0"></div>');
    var stage = h('<div style="position:relative;display:none;max-width:100%;overflow:auto;border:1px solid var(--line);border-radius:8px"></div>');
    var canvas = h('<canvas style="display:block;max-width:100%;cursor:crosshair"></canvas>');
    var sel = h('<div style="position:absolute;border:2px dashed var(--pri);background:rgba(var(--pri-rgb),.15);display:none;pointer-events:none"></div>');
    stage.appendChild(canvas); stage.appendChild(sel);
    var acts = h('<div class="syf-seg" style="display:none;gap:6px;margin-top:8px"></div>');
    var dlBtn = h('<button class="syf-mini" type="button">تنزيل القصّ</button>');
    var cpBtn = h('<button class="syf-mini" type="button">نسخ القصّ</button>');
    acts.appendChild(dlBtn); acts.appendChild(cpBtn);
    wrap.appendChild(btn); wrap.appendChild(st); wrap.appendChild(stage); wrap.appendChild(acts);
    body.appendChild(wrap);

    var img = null, crop = null, dragging = false, sx = 0, sy = 0;
    btn.addEventListener('click', function () {
      st.textContent = SYFS.t('جارٍ الالتقاط…');
      bg('SYFS_APP_CAPTURE').then(function (r) {
        r = r || { ok: false };
        if (!r.ok) { st.textContent = capErr(r.error); return; }
        var im = new Image();
        im.onload = function () { img = im; canvas.width = im.naturalWidth; canvas.height = im.naturalHeight; canvas.getContext('2d').drawImage(im, 0, 0); stage.style.display = 'block'; acts.style.display = 'none'; sel.style.display = 'none'; st.textContent = SYFS.t('اسحب لتحديد منطقة على الصورة.'); };
        im.src = r.dataUrl;
      });
    });
    /* v0.139.4: the document listeners live for one drag only. They were added once per
       mount and never removed, so every re-open of this tool stacked another pair (each
       holding its captured image) for the life of the page. */
    canvas.addEventListener('mousedown', function (e) {
      if (!img) return;
      var rect = canvas.getBoundingClientRect();
      dragging = true; sx = e.clientX - rect.left; sy = e.clientY - rect.top;
      sel.style.display = 'block'; sel.style.left = sx + 'px'; sel.style.top = sy + 'px'; sel.style.width = '0px'; sel.style.height = '0px';
      document.addEventListener('mousemove', regionMove); document.addEventListener('mouseup', regionUp);
      e.preventDefault();
    });
    function regionMove(e) {
      if (!dragging) return;
      var rect = canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
      sel.style.left = Math.min(sx, x) + 'px'; sel.style.top = Math.min(sy, y) + 'px';
      sel.style.width = Math.abs(x - sx) + 'px'; sel.style.height = Math.abs(y - sy) + 'px';
    }
    function regionUp() {
      document.removeEventListener('mousemove', regionMove); document.removeEventListener('mouseup', regionUp);
      if (!dragging) return; dragging = false;
      var s = canvas.clientWidth / canvas.width; if (!s) return;
      var l = parseFloat(sel.style.left) / s, t = parseFloat(sel.style.top) / s, w = parseFloat(sel.style.width) / s, hh = parseFloat(sel.style.height) / s;
      if (w < 4 || hh < 4) { sel.style.display = 'none'; return; }
      w = Math.round(w); hh = Math.round(hh);
      var c = document.createElement('canvas'); c.width = w; c.height = hh;
      c.getContext('2d').drawImage(img, Math.round(l), Math.round(t), w, hh, 0, 0, w, hh);
      crop = c; acts.style.display = 'flex'; st.textContent = SYFS.t('تمّ القصّ ✓ ({0}×{1})', w, hh);
    }
    dlBtn.addEventListener('click', function () { if (crop) dlData(crop.toDataURL('image/png'), capName('region')); });
    cpBtn.addEventListener('click', function () { if (crop) copyCanvas(crop, function (ok, er) { st.textContent = ok ? SYFS.t('نُسخت ✓') : SYFS.t('تعذّر: {0}', er || ''); }); });
  }

  /* tools whose app-mode UI differs from their rail mount (page-context capture) */
  var APP_OVERRIDE = { screenshot: mountAppShot, regionshot: mountAppRegion };
  /* The studio's «التقاط» group (src/studio.js → SYFS._media) shoots THIS page on the
     rail — here that is the workspace itself. Same answer as the two tools above: the
     active real web tab, through the worker. One visible shot serves all three kinds:
     the region is cut in the studio's own editor, and scrolling another tab for a
     full-page shot is not something this page can do. */
  function appTabCanvas() {
    return bg('SYFS_APP_CAPTURE').then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || 'failed');
      return new Promise(function (res, rej) {
        var im = new Image();
        im.onload = function () { res(imgToCanvas(im)); };
        im.onerror = rej;
        im.src = r.dataUrl;
      });
    });
  }
  if (SYFS._media) ['regionCanvas', 'visibleCanvas', 'fullCanvas'].forEach(function (k) { SYFS._media[k] = appTabCanvas; });

  /* ---------- window manager (floating, multi, draggable, resizable) ---------- */
  var openWins = {};
  function focusWin(win) { win.style.zIndex = ++zTop; }
  function place(win, x, y) {
    x = Math.min(Math.max(0, x), window.innerWidth - 90);
    y = Math.min(Math.max(0, y), window.innerHeight - 44);
    win.style.left = x + 'px'; win.style.top = y + 'px';
  }
  /* still used by «رصف النوافذ» (cascadeAll) — arranging everything on screen is a
     command the user asks for, which is a different question from where one window
     opens */
  function cascadeXY(n) { return { x: 250 + (n % 8) * 30, y: 82 + (n % 8) * 30 }; }
  /* Centred, with a diagonal step per already-open window so the second one is not
     hidden exactly behind the first. Same rule as the page rail (`centreWin` in
     src/rail.js) — a tool must not open in one place over a web page and another
     place here. */
  function centreWin(win) {
    var w = win.offsetWidth || 340, hgt = win.offsetHeight || 260;
    var n = Object.keys(openWins).length - 1; if (n < 0) n = 0;
    var step = (n % 5) * 28;
    place(win, Math.round((window.innerWidth - w) / 2) + step,
               Math.max(12, Math.round((window.innerHeight - hgt) / 2) - 24) + step);
  }

  function savePlace(id, win) {
    if (win.classList.contains('syfs-max') || win.classList.contains('syfs-min')) return;
    var b = win.querySelector('.syfs-win-body');
    store.set('app_win_' + id, { x: win.offsetLeft, y: win.offsetTop, w: win.offsetWidth, h: b.offsetHeight });
  }
  function restorePlace(win, id, wide) {
    return store.get('app_win_' + id, null).then(function (p) {
      /* size restored, position always centred — see centreWin above. The saved x/y
         is still written by savePlace and simply not read. */
      if (p && typeof p === 'object') {
        /* same floor rule as the rail (v0.137.0) — src/winsize.js owns it */
        var mw = SYFS.winsize ? SYFS.winsize.minW(win, 280) : 280;
        win.style.width = Math.min(Math.max(mw, p.w || 340), window.innerWidth - 20) + 'px';
        if (p.h) { var b = win.querySelector('.syfs-win-body'); b.style.maxHeight = 'none'; b.style.height = Math.min(Math.max(120, p.h), window.innerHeight - 80) + 'px'; }
      }
      centreWin(win);
    });
  }

  function makeDraggable(win, id) {
    /* المستمعان داخل `mousedown` ويُنزَعان في `mouseup` — نفس ما يفعله `addResize` أسفله.
       تسجيلهما على `document` مع كل نافذة (بلا نزع) يجعل القائمة وأشجار النوافذ المُزالة
       تكبر بلا حدّ، وهذه صفحة تُفتح ساعات. نفس إصلاح `src/rail.js`. */
    var head = win.querySelector('.syfs-win-head');
    head.addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) return;
      if (win.classList.contains('syfs-max')) return;
      var ox = e.clientX - win.offsetLeft, oy = e.clientY - win.offsetTop;
      e.preventDefault();
      function mv(ev) { place(win, ev.clientX - ox, ev.clientY - oy); }
      function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); savePlace(id, win); }
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
  }
  /* Same engine as the rail (src/winsize.js, v0.132.0) — see the note at its
     call site in src/rail.js for the four bugs the old copy carried. App mode
     keeps its own 280px floor: its windows sit on a workspace, not over someone
     else's page, and have never been as narrow as the rail's. */
  function addResize(win, id) {
    if (!SYFS.winsize) return;
    SYFS.winsize.attach(win, {
      minW: 280, minH: 120,
      onChange: function () { savePlace(id, win); }
    });
  }

  /* line minimized windows up along the bottom instead of stacking them */
  function layoutMinimized() {
    /* :not(.syfs-shut) — a window on its way out still carries .syfs-min for the
       length of its close animation, and would otherwise hold a slot in the strip
       while the survivors shuffle around it. */
    var mins = layer().querySelectorAll('.syfs-win.syfs-min:not(.syfs-shut)'), x = 8;
    for (var i = 0; i < mins.length; i++) { mins[i].style.left = x + 'px'; x += 268; }
  }

  /* ---------- THE CASCADE (mirrors src/rail.js — the same window, two surfaces) --
     The head is the anchor: the panel unrolls out of it downward, and rolls back
     up into it on close. Every row carries its distance from the head in --i, the
     body carries the largest in --n, and rail.css does the movement.
     `.syfs-shut` is a class and not a `remove()` because a DOM removal cannot be
     transitioned — the node leaves only after the movement is over. */
  var WI = SYFS.winIcons || {};
  var SHUT_MS = 440;
  function indexRows(body) {
    var host = (body.children.length === 1 && body.firstElementChild
                && body.firstElementChild.classList.contains('syf-form')) ? body.firstElementChild : body;
    var rows = [];
    Array.prototype.forEach.call(host.children, function (el) {
      /* a list or a results grid holds rows — it is not one */
      if (el.classList.contains('syf-note-list') || el.classList.contains('syf-out')) {
        Array.prototype.forEach.call(el.children, function (r) { rows.push(r); });
      } else rows.push(el);
    });
    if (rows.length > 22) rows = rows.slice(0, 22);   /* an entrance, not a loading bar */
    body.style.setProperty('--n', String(Math.max(rows.length - 1, 0)));
    rows.forEach(function (r, k) { r.classList.add('syfs-win-row'); r.style.setProperty('--i', String(k)); });
  }
  function showWin(win) {
    clearTimeout(win._shutT);
    void win.offsetWidth;   /* flush, or both changes land in one style pass and it just appears */
    win.classList.remove('syfs-shut');
  }
  function closeWindow(id) {
    var win = openWins[id]; if (!win) return;
    delete openWins[id];    /* free the id now: re-opening mid-animation must build a fresh window */
    clearTimeout(win._shutT);
    win.classList.add('syfs-shut');
    win._shutT = setTimeout(function () { win.remove(); layoutMinimized(); }, SHUT_MS);
    layoutMinimized(); updateHint(); markPaletteOpen();
  }

  function openWindow(tool) {
    /* full-screen page tools → open as an in-workspace browser-style tab (app.html
       only). Elsewhere (no tab strip) fall through to the normal browser-tab action. */
    if (tabHost && paneHost && PAGE_TABS[tool.id]) { openPageTab(tool); return; }
    if (openWins[tool.id]) {
      var w = openWins[tool.id];
      if (w.classList.contains('syfs-min')) { w.classList.remove('syfs-min'); layoutMinimized(); }
      focusWin(w); return;
    }
    if (typeof tool.mount !== 'function') { if (typeof tool.action === 'function') { try { tool.action(); } catch (e) {} } return; }

    var win = h('<div class="syfs-win syfs-shut"><div class="syfs-win-head">'
      + '<span class="syfs-win-ic"></span><span class="syfs-win-title"></span>'
      + '<span class="syfs-win-actions">'
      + '<button class="syfs-win-x" title="إغلاق">' + WI.close + '</button>'
      + '<button class="syfs-win-star" title="إضافة للمفضلة">' + WI.star + '</button>'
      + '<button class="syfs-win-ctrl syfs-win-help" title="شرح الأداة — دليل الاستخدام">' + WI.help + '</button>'
      + '<button class="syfs-win-ctrl syfs-win-shot" title="تصوير الأداة ونسخ الصورة">' + WI.camera + '</button>'
      + '<button class="syfs-win-ctrl syfs-win-max" title="تكبير لكامل الشاشة">' + WI.max + '</button>'
      + '<button class="syfs-win-ctrl syfs-win-min" title="تصغير للأسفل">' + WI.min + '</button>'
      + '</span></div><div class="syfs-win-body"></div><div class="syfs-win-grip" title="تغيير الحجم"></div></div>');
    win.querySelector('.syfs-win-title').textContent = SYFS.t(tool.name);
    /* the tool's own glyph, the same one on its dock button */
    if (tool.icon) win.querySelector('.syfs-win-ic').innerHTML = tool.icon;
    win.style.width = (WIDE[tool.id] ? 640 : 340) + 'px';
    layer().appendChild(win);
    openWins[tool.id] = win;

    var body = win.querySelector('.syfs-win-body');
    var mountFn = APP_OVERRIDE[tool.id] || tool.mount;   /* screenshot/regionshot use app-mode capture mounts */
    try { mountFn(body); } catch (e) { body.textContent = SYFS.t('تعذّر تحميل الأداة.'); }
    /* same «تجريبي» chip + note as the rail's markBeta (src/rail.js) */
    if (tool.beta) {
      var title = win.querySelector('.syfs-win-title');
      title.parentNode.insertBefore(h('<span class="syfs-win-beta">تجريبي</span>'), title.nextSibling);
      body.insertBefore(h('<div class="syf-note-warn syfs-beta-note" role="note">🧪 نسخة تجريبية — قد تواجه بعض المشاكل في هذه الأداة، ونعمل على إصلاحها.</div>'), body.firstChild);
    }
    indexRows(body);

    var star = win.querySelector('.syfs-win-star');
    star.classList.toggle('on', isFav(tool.id));
    star.addEventListener('click', function (e) { e.stopPropagation(); toggleFav(tool.id); });
    win.querySelector('.syfs-win-help').addEventListener('click', function (e) { e.stopPropagation(); SYFS.openToolGuide(tool.id); });
    var shotBtn = win.querySelector('.syfs-win-shot');
    shotBtn.addEventListener('click', function (e) { e.stopPropagation(); SYFS.shotWinClick(win, shotBtn); });
    win.querySelector('.syfs-win-x').addEventListener('click', function (e) { e.stopPropagation(); closeWindow(tool.id); });
    var maxBtn = win.querySelector('.syfs-win-max');
    win.querySelector('.syfs-win-min').addEventListener('click', function (e) {
      e.stopPropagation(); win.classList.remove('syfs-max'); maxBtn.innerHTML = WI.max || ''; win.classList.toggle('syfs-min'); layoutMinimized();
    });
    maxBtn.addEventListener('click', function (e) {
      e.stopPropagation(); win.classList.remove('syfs-min'); var m = win.classList.toggle('syfs-max');
      maxBtn.innerHTML = (m ? WI.rest : WI.max) || '';
      maxBtn.title = m ? SYFS.t('استعادة الحجم') : SYFS.t('تكبير لكامل الشاشة');
      if (m) { body.style.height = ''; body.style.maxHeight = ''; }   /* let the maximize CSS fill; drop any resized inline size */
      focusWin(win); layoutMinimized();
    });
    win.querySelector('.syfs-win-head').addEventListener('dblclick', function (e) {
      if (e.target.closest('button')) return;
      if (win.classList.contains('syfs-min')) { win.classList.remove('syfs-min'); layoutMinimized(); focusWin(win); }
    });
    win.addEventListener('mousedown', function () { focusWin(win); });

    focusWin(win);
    /* open only once it is WHERE it belongs — showing first and moving after
       would play the entrance in the wrong corner, then teleport */
    restorePlace(win, tool.id, !!WIDE[tool.id]).then(function () { showWin(win); });
    makeDraggable(win, tool.id);
    addResize(win, tool.id);
    updateHint(); markPaletteOpen();
  }

  function cascadeAll() {
    var ids = Object.keys(openWins), n = 0;
    ids.forEach(function (id) {
      var w = openWins[id];
      w.classList.remove('syfs-max', 'syfs-min');
      var c = cascadeXY(n++); place(w, c.x, c.y); focusWin(w); savePlace(id, w);
    });
    layoutMinimized();
  }
  function closeAll() { Object.keys(openWins).forEach(closeWindow); }

  /* ---------- SYFS helper shims the tools call ---------- */
  SYFS.mountEl = function (el) { layer().appendChild(el); };
  SYFS.topZ = function () { return ++zTop; };
  SYFS.openToolById = function (id) { var t = toolById(id); if (t && usable(t)) openWindow(t); };

  function safeUrl(x) { x = (x || '').trim(); if (!x) return ''; if (/^https?:\/\//i.test(x)) return x; if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(x)) return 'https://' + x; return ''; }
  function frameHostOf(u) { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; } }
  /* عدّاد لكل مضيف — الاستثناء يبقى ما دام عارضٌ واحد على الأقل مفتوحاً عليه (نفس عقد
     `frameHostCounts` في `src/rail.js`، ونطاقات الصفحة الأخرى تحتفظ بحمايتها). */
  var frameHostCounts = {};
  function frameApply() {
    var domains = Object.keys(frameHostCounts).filter(function (d) { return frameHostCounts[d] > 0; });
    /* resolves once the worker has answered — openFrame waits on it before navigating,
       and a worker that never answers must not leave the viewer blank forever */
    return Promise.race([
      bg('SYFS_FRAME', { op: domains.length ? 'set' : 'off', domains: domains }),
      new Promise(function (res) { setTimeout(res, 1500); })
    ]);
  }
  function bg(type, extra) { return new Promise(function (res) { try { chrome.runtime.sendMessage(Object.assign({ type: type }, extra || {}), function (r) { void chrome.runtime.lastError; res(r); }); } catch (e) { res(null); } }); }

  /* Side dock, same contract as rail.js's SYFS.openSide (v0.135.0): a real window snapped to
     the screen edge, for sites a frame cannot host. `shrink` is false here — app mode IS the
     window the user is working in, and stealing a third of it to dock a chat is not the deal. */
  SYFS.openSide = function (url, opts) {
    url = safeUrl(url); if (!url) return false;
    opts = opts || {};
    bg('SYFS_SIDE', {
      url: url, side: opts.side, w: opts.w, shrink: opts.shrink === true,
      metrics: { left: screen.availLeft || 0, top: screen.availTop || 0,
                 width: screen.availWidth, height: screen.availHeight }
    });
    return true;
  };

  /* Chrome's own side panel, same contract as rail.js's SYFS.openPanel (v0.136.0).
     Workspace mode lives in a tab, so the panel opens beside it exactly as on any page. */
  SYFS.openPanel = function (url, opts) {
    url = safeUrl(url); if (!url) return false;
    bg('SYFS_PANEL', { op: 'open', url: url }).then(function (r) {
      if (!r || !r.ok) SYFS.openSide(url, opts);
    });
    return true;
  };

  /* In-page site viewer, same contract as rail.js's SYFS.openFrame. */
  SYFS.openFrame = function (title, url, opts) {
    url = safeUrl(url); if (!url) return null;
    opts = opts || {};
    var fHost = frameHostOf(url);
    var vw = window.innerWidth, vh = window.innerHeight;
    var w = Math.min(Math.max(opts.w || 560, 320), Math.max(360, vw - 40));
    var hgt = Math.min(Math.max(opts.h || 680, 300), Math.max(320, vh - 60));

    var win = h('<div class="syfs-win syfs-frame-win"></div>');
    win.style.width = w + 'px';
    var head = h('<div class="syfs-win-head"><span class="syfs-win-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3.5 9h17M3.5 15h17"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/></svg></span><span class="syfs-win-title"></span><span class="syfs-fr-actions"><button class="syfs-fr-btn syfs-fr-reload" title="تحديث">' + WI.reload + '</button><button class="syfs-fr-btn syfs-fr-open" title="فتح في نافذة منفصلة">' + WI.popout + '</button><button class="syfs-win-x" title="إغلاق">' + WI.close + '</button></span></div>');
    head.querySelector('.syfs-win-title').textContent = title || SYFS.t('عارض');
    var fbody = h('<div class="syfs-win-body syfs-frame-body"></div>');
    fbody.style.height = hgt + 'px';
    var frame = document.createElement('iframe');
    frame.className = 'syfs-frame';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('allow', 'clipboard-write; fullscreen');
    /* `src` is set AFTER the worker has stripped the framing headers for this host —
       same race, same fix as src/rail.js (مراجعة 2026-09-19): appending a frame with a src starts
       the navigation, and a fast response arrived before the session rule existed */
    var hint = h('<div class="syfs-frame-hint">لو ظهرت فارغة، الموقع يمنع العرض المضمّن — اضغط ⤢ لفتحه في نافذة منفصلة.</div>');
    fbody.appendChild(frame); fbody.appendChild(hint);
    var grip = h('<div class="syfs-frame-grip" title="تغيير الحجم"></div>');
    win.appendChild(head); win.appendChild(fbody); win.appendChild(grip);
    layer().appendChild(win);

    /* ⚠️ عدّ مرجعي كما في `src/rail.js` (v0.104.0): بلا عدّاد كان عارضٌ ثانٍ يكتب قائمة
       نطاقاته فوق قائمة الأول (فينكسر الأول)، وإغلاق أيٍّ منهما يُرسل `off` فيُنزع
       الاستثناء عن العارض الباقي أيضاً. القائمة تُرسَل كاملة عند كل تغيّر. */
    function navigate() { if (!win.__closed) frame.src = url; }
    if (fHost) { frameHostCounts[fHost] = (frameHostCounts[fHost] || 0) + 1; frameApply().then(navigate); }
    else navigate();
    function close() {
      if (win.__closed) return; win.__closed = true; win.remove();
      if (fHost && frameHostCounts[fHost]) { if (--frameHostCounts[fHost] <= 0) delete frameHostCounts[fHost]; frameApply(); }
    }
    head.querySelector('.syfs-fr-reload').addEventListener('click', function (e) { e.stopPropagation(); frame.src = url; });
    head.querySelector('.syfs-fr-open').addEventListener('click', function (e) { e.stopPropagation(); bg('SYFS_POPUP', { url: url, w: Math.round(w), h: Math.round(hgt) }); });
    head.querySelector('.syfs-win-x').addEventListener('click', function (e) { e.stopPropagation(); close(); });
    win.addEventListener('mousedown', function () { win.style.zIndex = SYFS.topZ(); });

    place(win, Math.max(12, (vw - w) / 2), Math.max(12, (vh - hgt) / 2 - 20));
    win.style.zIndex = SYFS.topZ();
    head.addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) return;
      var ox = e.clientX - win.offsetLeft, oy = e.clientY - win.offsetTop;
      e.preventDefault();
      function mv(ev) { place(win, ev.clientX - ox, ev.clientY - oy); }
      function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    /* cross-origin iframe body ⇒ nothing measurable, so no fit (see src/rail.js) */
    if (SYFS.winsize) SYFS.winsize.attach(win, { grip: grip, body: fbody, minW: 320, minH: 240, canFit: false });
    return win;
  };

  /* ---------- floating category dock + tool-grid flyout (the launcher) ----------
     A compact bar of CATEGORY icons that never scrolls. Clicking a category opens a
     flyout GRID of that category's tool icons (labelled tiles). This replaces the old
     tall, scrolling tool list — like an OS dock with folders. */
  var hintEl = document.getElementById('syfa-hint');
  /* workspace tab strip + iframe pane host (app.html only — null on tool pages) */
  var tabHost = document.getElementById('syfa-tabs');
  var paneHost = document.getElementById('syfa-panes');
  var pageTabs = {};        /* instanceId -> { btn, pane, iframe, toolId } — many per tool */
  var tabSeq = {};          /* per-tool monotonic counter (for the "٢/٣…" tab suffix + unique id) */
  var activeTab = null;
  var query = '';
  var dockEl2 = null, dockRun = null, dockPos = null;
  /* ⚠️ حالة السحب **على مستوى الوحدة** لا داخل `buildDock` (v0.104.0): مستمعا
     `mousemove`/`mouseup` على `document` صارا يُركَّبان مرّة واحدة (`dockWired`)، ولو بقيت
     الحالة محلّية لقرأ المستمعُ المُركَّب أوّلَ مرّة متغيّراتِ البناء الأول بينما يكتب المقبض
     الجديد في متغيّرات البناء الثاني ⇒ سحبٌ لا يتحرّك. */
  var dockWired = false, dockDrag = false, dockOx = 0, dockOy = 0, dockMoved = false;
  /* the shelf + fold state, mirroring src/rail.js */
  var shelfEl = null, openCat = null, openCatEl = null, shelfRaf = 0, foldClipT = null;
  var dockFolded = false, hasWorkspace = false, inPopup = false;
  var FOLD_KEY = 'app_dock_folded', ORIENT_KEY = 'app_dock_orient';
  /* Orientation, not position: the dock is placed by dragging it, but the rail's
     whole directional stylesheet keys off [data-pos] — so 'v' borrows the right
     rail's rules and 'h' borrows the top rail's, including the flat bar's
     right-to-left mirror. One value, and every directional rule follows. */
  /* horizontal by default: this dock shares a screen with WINDOWS, and windows fill
     the middle. A column down one side eats the width they need; a bar along the
     bottom sits in the strip nothing else wants. (The page rail defaults to the
     right edge because there it shares the screen with someone else's page, which
     it must not cover.) */
  var dockOrient = 'h';
  function horiz() { return dockOrient === 'h'; }
  var IS_MAC = (navigator.platform || '').indexOf('Mac') >= 0;
  /* dock appearance (shared with the page rail via src/dockfx.js) + workspace tool
   * visibility (app_hidden_tools — which tools show in this dock's categories). */
  var SIZE_BASE = 40;      /* px at 100% — the dock's own baseline (the rail's is 38) */
  /* pre-load values only — applyDockPrefs overwrites both from dockfx.DEFAULTS */
  var dockFx = 'lift', dockPeek = false, dockLabels = 'list';
  var appHidden = [];
  function isAppHidden(id) { return appHidden.indexOf(id) >= 0; }
  /* Tool order inside a category. `tool_order` is the SAME storage key the rail's
     manager writes, so dragging a row there reorders this dock too — the two
     surfaces are one product and must not disagree about what comes first.
     DEFAULT_TOOL_ORDER duplicates src/rail.js's list on purpose: app.js runs on
     pages that never load rail.js (app.html, sheet.html), so it cannot import it.
     Change one, change the other — a test asserts they match. */
  var toolOrder = {};
  var DEFAULT_TOOL_ORDER = {
    islam:   ['quran', 'qradio', 'prayer', 'athkar', 'wird', 'hifz', 'kids', 'occasions', 'hijri'],
    calc:    ['calc', 'finance', 'money', 'tax', 'units', 'currency'],
    note:    ['notes', 'notepad', 'clipboard', 'textdiff', 'readsave', 'counter', 'checklist', 'translate', 'voice', 'phones'],
    docs:    ['docedit', 'sheetview', 'slidesedit', 'mailwriter', 'mdview', 'pdfcompress', 'ziptool', 'ocr', 'whiteboard'],
    time:    ['calendar', 'datediff', 'timelog', 'timer', 'alerts', 'worldclock'],
    media:   ['studio', 'capbar', 'regionshot', 'screenrec', 'status', 'frames', 'vtrim', 'vaudio', 'vconv', 'videodl', 'screenshot', 'imgedit', 'imgbatch', 'exif'],
    util:    ['display', 'password', 'qrgen', 'qrread', 'speed', 'watch', 'sessions', 'ytplus', 'formfill', 'vault', 'appmode'],
    shield:  ['adblock', 'sitecleaner', 'cookiemgr', 'waprivacy', 'msprivacy'],
    perf:    ['speedlite', 'speedembed', 'speedfreeze', 'speedfetch', 'speedtabs'],
    links:   ['siteviewer', 'waweb', 'lnk-google', 'lnk-custom', 'lnk-gmail', 'lnk-outlook', 'lnk-teams',
              'lnk-facebook', 'lnk-youtube', 'lnk-drive', 'lnk-calendar', 'lnk-telegram', 'lnk-linkedin', 'lnk-x'],
    dev:     ['techdetect', 'perfaudit', 'devpage', 'devformat', 'codemin', 'devencode', 'devconvert', 'devregex', 'devlogs', 'devnet', 'devfake', 'devcolor', 'devinspect', 'devviewport'],
    ai:      ['sam-ai', 'lnk-claude', 'lnk-gemini', 'lnk-chatgpt', 'lnk-higgsfield', 'lnk-kimi', 'lnk-deepseek',
              'lnk-perplexity', 'lnk-copilot', 'lnk-grok', 'lnk-qwen', 'lnk-mistral', 'lnk-notebooklm']
  };
  function toolRank(ck, id) { var o = toolOrder[ck] || DEFAULT_TOOL_ORDER[ck]; if (!o) return 1000; var i = o.indexOf(id); return i < 0 ? 1000 : i; }
  function applyDockPrefs(p) {
    if (!dockEl2 || !p) return;
    /* the fallbacks come from dockfx's own DEFAULTS, so a changed default is changed
       in ONE place — three copies of the word 'magnify' is three chances to disagree */
    dockFx = p.effect || SYFS.dockfx.DEFAULTS.effect;
    dockPeek = !!p.peek;
    dockLabels = p.labels || SYFS.dockfx.DEFAULTS.labels;
    /* the appearance vars are the RAIL's now (rail.css reads them off .syfs-wrap),
       so one size/effect/opacity setting really does drive both surfaces */
    var lay = layer();
    lay.dataset.fx = dockFx;
    lay.style.setProperty('--syfs-cat-size', Math.round(SIZE_BASE * (p.scale || SYFS.dockfx.DEFAULTS.scale) / 100) + 'px');
    lay.style.setProperty('--syfs-dock-op', p.opacity != null ? p.opacity : 1);
    /* the shelf reads [data-labels] off the wrap, exactly as the page rail does —
       one markup, two display modes (rail.css hides .syfs-tb-nm for «icons») */
    lay.dataset.labels = dockLabels;
    if (openCatEl) placeShelf(openCatEl);   /* its box just changed size */
  }
  /* orientation: 'v' → the right rail's rules, 'h' → the top rail's (mirrored) */
  function applyOrient(o) {
    dockOrient = (o === 'h') ? 'h' : 'v';
    var lay = layer();
    lay.dataset.pos = horiz() ? 'top' : 'right';
    if (dockEl2) {
      staggerRun(dockRun);
      if (dockPos) placeDock(dockPos.x, dockPos.y);
      if (openCatEl) placeShelf(openCatEl);
    }
  }

  function appTools() { return tools.filter(function (t) { return usable(t) && !isAppHidden(t.id); }); }
  function byCat() {
    var g = {};
    appTools().forEach(function (t) { (g[t.cat] = g[t.cat] || []).push(t); });
    Object.keys(g).forEach(function (ck) { g[ck].sort(function (a, b) { return toolRank(ck, a.id) - toolRank(ck, b.id); }); });
    return g;
  }
  function orderedCats(g) { return CAT_ORDER.concat(Object.keys(g)).filter(function (v, i, a) { return a.indexOf(v) === i && g[v] && g[v].length; }); }
  function matches(t) { return !query || (t.name || '').toLowerCase().indexOf(query) >= 0; }
  function updateHint() { if (hintEl) hintEl.style.display = (Object.keys(openWins).length || Object.keys(pageTabs).length) ? 'none' : ''; }

  /* ---- workspace tabs (browser-style) for the full-screen page tools ----
     Multiple instances per tool: every launch opens a NEW tab (its own iframe), so
     you can keep several Word/Excel/PowerPoint/Mail files open side by side. Tabs are
     keyed by a unique instance id; the 2nd+ instance of a tool gets a "٢/٣…" suffix. */
  var AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  function toArabicNum(n) { return String(n).replace(/\d/g, function (d) { return AR_DIGITS[+d]; }); }
  function activateTab(id) {
    if (!pageTabs[id]) return;
    activeTab = id;
    for (var k in pageTabs) if (pageTabs.hasOwnProperty(k)) {
      var on = k === id;
      pageTabs[k].btn.classList.toggle('on', on);
      pageTabs[k].pane.classList.toggle('on', on);
    }
    document.body.classList.add('syfa-tabbing');
    updateHint();
  }
  function closeTab(id) {
    var t = pageTabs[id]; if (!t) return;
    var toolId = t.toolId;
    t.btn.remove(); t.pane.remove(); delete pageTabs[id];
    /* if this tool has no tabs left, reset its counter so numbering restarts at 1 */
    var still = false;
    for (var k in pageTabs) if (pageTabs.hasOwnProperty(k) && pageTabs[k].toolId === toolId) { still = true; break; }
    if (!still) tabSeq[toolId] = 0;
    if (activeTab === id) {
      activeTab = null;
      var rest = Object.keys(pageTabs);
      if (rest.length) activateTab(rest[rest.length - 1]);
      else document.body.classList.remove('syfa-tabbing');
    }
    updateHint();
  }
  function openPageTab(tool) {
    var meta = PAGE_TABS[tool.id];
    var n = (tabSeq[tool.id] = (tabSeq[tool.id] || 0) + 1);      /* 1st, 2nd, … instance of this tool */
    var id = tool.id + '#' + n;                                  /* unique per instance */
    var label = (meta.label || tool.name) + (n > 1 ? ' ' + toArabicNum(n) : '');

    var btn = h('<button class="syfa-tab" type="button"><span class="syfa-tab-ic"></span><span class="syfa-tab-nm"></span><span class="syfa-tab-x" title="إغلاق التبويب" role="button" aria-label="إغلاق">✕</span></button>');
    btn.querySelector('.syfa-tab-ic').innerHTML = tool.icon || DEFAULT_ICON;   /* internal, trusted SVG */
    btn.querySelector('.syfa-tab-nm').textContent = label;
    btn.setAttribute('title', label);
    btn.addEventListener('click', function (e) { if (e.target.closest('.syfa-tab-x')) return; activateTab(id); });
    btn.querySelector('.syfa-tab-x').addEventListener('click', function (e) { e.stopPropagation(); closeTab(id); });
    tabHost.appendChild(btn);

    var pane = h('<div class="syfa-pane"></div>');
    var frame = document.createElement('iframe');
    frame.className = 'syfa-frame2';
    frame.setAttribute('title', label);
    frame.src = chrome.runtime.getURL(meta.url) + '#embed';   /* same-origin extension page; #embed hides its own dock */
    pane.appendChild(frame);
    paneHost.appendChild(pane);

    pageTabs[id] = { btn: btn, pane: pane, iframe: frame, toolId: tool.id };
    activateTab(id);
  }

  /* The user's own links (rail manager → «روابط مخصّصة», key `custom_links`) close the
     «روابط» shelf here exactly as they do on the rail (src/rail.js catItems). Checked
     on READ, same rule as the rail's safeLink: the key is shared with «استيراد», which
     writes any JSON, so a stored `javascript:` link is dropped, never opened. */
  var customLinks = [];
  var LINK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15l6-6M10.5 6l1-1a4 4 0 015.5 5.5l-1 1M13.5 18l-1 1a4 4 0 01-5.5-5.5l1-1"/></svg>';
  function customLinkTools() {
    return customLinks.map(function (cl) {
      var u = String((cl && cl.u) || '').trim();
      if (!/^https?:\/\//i.test(u)) return null;
      return { id: '', name: String((cl && cl.n) || u), cat: 'links', icon: LINK_ICON,
        action: function () { try { window.open(u, '_blank', 'noopener'); } catch (e) {} } };
    }).filter(Boolean);
  }

  /* the tools shown in a flyout for a given key ('__fav' / '__search' / a category) */
  function catList(ck) {
    if (ck === '__fav') return favs.map(toolById).filter(function (t) { return t && usable(t) && !isAppHidden(t.id); });
    if (ck === '__search') return appTools().filter(matches);
    var list = byCat()[ck] || [];
    if (ck === 'links') list = list.concat(customLinkTools());
    return list.filter(matches);
  }

  /* one tool button in the shelf — .syfs-tool-btn, the page rail's own (rail.css).
     It replaces a round icon-only tile whose name appeared only on hover: the rail
     shows the name, and a launcher you must hover to read is one you hunt through. */
  function toolBtn(t) {
    var b = h('<button class="syfs-tool-btn" type="button"><span class="syfs-tb-ic"></span><span class="syfs-tb-nm"></span></button>');
    b.dataset.id = t.id;
    /* a tool's own `name` IS its msgid (see src/i18n.js) — resolved here, at render */
    var nm = SYFS.t(t.name);
    b.dataset.tip = nm;                     /* CSS tooltip — internal trusted string */
    /* v0.147.0 — known problems: amber dot + the word in the tooltip (rail.css) */
    if (t.beta) { b.classList.add('beta'); b.dataset.tip = nm + ' — ' + SYFS.t('تجريبي'); }
    b.setAttribute('aria-label', nm);
    b.querySelector('.syfs-tb-nm').textContent = nm;
    b.querySelector('.syfs-tb-ic').innerHTML = t.icon || DEFAULT_ICON;   /* internal, trusted SVG */
    b.addEventListener('click', function (e) { e.stopPropagation(); openWindow(t); closeShelf(); });
    return b;
  }

  /* ---- one category on the bar — .syfs-cat > .syfs-cat-btn, as the rail builds it.
     Clicking TOGGLES the shelf. It used to open on hover, which is the one thing a
     free-floating dock cannot afford: it sits over your windows, so crossing it on
     the way somewhere else threw a panel open every time. */
  function catBtn(ck, label, icon, alt) {
    var cat = h('<div class="syfs-cat"></div>');
    var b = h('<button class="syfs-cat-btn' + (alt ? ' alt' : '') + '" type="button"></button>');
    cat.dataset.cat = ck;
    label = SYFS.t(label);
    b.dataset.tip = label;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.insertAdjacentHTML('afterbegin', icon);   /* internal, trusted SVG string */
    cat.appendChild(b);
    return cat;
  }
  /* renderPalette rebuilds the bar's buttons (kept this name so the window manager's
     callbacks still work). The run reads exactly as the page rail's does:
     المفضّلة ‖ التصنيفات ‖ البحث · [أدوات النوافذ] · الإعدادات   [الطيّ] */
  function renderPalette() {
    if (!dockRun) return;
    closeShelf();                 /* the button it was anchored to is about to go */
    dockRun.textContent = '';
    var g = byCat();

    /* HEAD — favourites, hidden until something is starred (exactly the rail) */
    var favList = favs.map(toolById).filter(function (t) { return t && usable(t) && !isAppHidden(t.id); });
    var favCat = catBtn('__fav', 'المفضلة', STAR_ICON, true);
    favCat.classList.add('syfs-favcat');
    if (!favList.length) favCat.style.display = 'none';
    favCat.querySelector('.syfs-cat-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      toggleShelf('__fav', 'المفضلة', catList('__fav'), favCat);
    });
    dockRun.appendChild(favCat);
    dockRun.appendChild(h('<div class="syfs-sep"></div>'));

    orderedCats(g).forEach(function (ck) {
      var cat = catBtn(ck, catLabel(ck), catIcon(ck), false);
      cat.querySelector('.syfs-cat-btn').addEventListener('click', function (e) {
        e.stopPropagation();
        toggleShelf(ck, catLabel(ck), catList(ck), cat);
      });
      dockRun.appendChild(cat);
    });

    /* TAIL — the bar's own controls, graphite so the categories keep the accent */
    dockRun.appendChild(h('<div class="syfs-sep"></div>'));
    var searchCat = catBtn('__search', 'بحث في كل الأدوات', DOCK_SVG.search, true);
    searchCat.classList.add('syfs-searchcat');
    var sBtn = searchCat.querySelector('.syfs-cat-btn');
    sBtn.appendChild(h('<span class="syfs-kbd-chip"></span>')).textContent = IS_MAC ? '⌘K' : '^K';
    sBtn.addEventListener('click', function (e) { e.stopPropagation(); closeShelf(); openPalette(); });
    dockRun.appendChild(searchCat);

    /* THE ONE THING THE PAGE RAIL DOES NOT HAVE: this surface owns windows, so it
       carries the three controls that act on them. They are bar controls, so they
       stand with search and the gear rather than among the categories. */
    if (hasWorkspace) WORKSPACE_ACTS.forEach(function (a) {
      if (a.act === 'window' && inPopup) return;
      var cat = catBtn('__' + a.act, a.tip, DOCK_SVG[a.act], true);
      cat.classList.add('syfs-actcat');
      var btn = cat.querySelector('.syfs-cat-btn');
      btn.dataset.act = a.act;                       /* CSS: close-all turns red on hover */
      btn.addEventListener('click', function (e) {
        e.stopPropagation(); closeShelf();
        if (a.act === 'cascade') cascadeAll();
        else if (a.act === 'closeall') closeAll();
        else if (a.act === 'window') SYFS.openApp('window').then(function (ok) { if (ok) { try { window.close(); } catch (e2) {} } });
      });
      dockRun.appendChild(cat);
    });

    var mgCat = catBtn('__gear', 'إعدادات الدوك والأدوات', DOCK_SVG.gear, true);
    mgCat.querySelector('.syfs-cat-btn').addEventListener('click', function (e) { e.stopPropagation(); closeShelf(); openDockSettings(); });
    dockRun.appendChild(mgCat);

    staggerRun(dockRun);
    updateFoldCount();
    markPaletteOpen();
  }
  /* the running dot: the one signal the page rail has no use for. It does not own
     windows — this surface does, and which category has one open is real status. */
  function markPaletteOpen() {
    if (!dockEl2) return;
    var runCats = {};
    Object.keys(openWins).forEach(function (id) { var t = toolById(id); if (t) runCats[t.cat] = 1; });
    var favRun = favs.some(function (id) { return !!openWins[id]; });
    dockEl2.querySelectorAll('.syfs-cat').forEach(function (c) {
      var ck = c.dataset.cat;
      c.classList.toggle('running', ck === '__fav' ? favRun : !!runCats[ck]);
    });
    if (shelfEl) shelfEl.querySelectorAll('.syfs-tool-btn').forEach(function (b) {
      b.classList.toggle('open', !!openWins[b.dataset.id]);
    });
  }

  /* ===== the shelf — ONE panel, anchored under whichever button opened it =====
     Ported from src/rail.js, which is the point: it is the same panel, so it uses
     the same markup and rail.css styles it. (app.js cannot import rail.js — it
     runs on pages that never load it — so this is a deliberate second copy, like
     DEFAULT_TOOL_ORDER above. Change one, change the other.) */
  function closeShelf() {
    if (shelfEl) shelfEl.classList.remove('on', 'in');
    if (dockEl2) dockEl2.querySelectorAll('.syfs-cat.open').forEach(function (c) { c.classList.remove('open'); });
    openCat = null; openCatEl = null;
  }
  /* Line the panel up with the button that opened it, then keep it on screen. The
     tick (--cx/--cy) is measured AFTER the clamp, so it keeps pointing at the real
     button even when the panel had to slide away from it. */
  function placeShelf(catEl) {
    if (!shelfEl || !catEl || !dockEl2) return;
    var r = dockEl2.getBoundingClientRect(), b = catEl.getBoundingClientRect();
    /* offsetWidth/Height, not the rect: the shelf rests at scale(.97) while closed
       and a transformed rect would measure it 3% small every time. */
    var sw = shelfEl.offsetWidth, sh = shelfEl.offsetHeight;
    if (horiz()) {
      var left = Math.max(8, Math.min((b.left + b.width / 2) - sw / 2, window.innerWidth - sw - 8));
      shelfEl.style.setProperty('--sx', Math.round(left - r.left) + 'px');
      shelfEl.style.setProperty('--cx', Math.round((b.left + b.width / 2) - left) + 'px');
    } else {
      var top = Math.max(8, Math.min((b.top + b.height / 2) - sh / 2, window.innerHeight - sh - 8));
      shelfEl.style.setProperty('--sy', Math.round(top - r.top) + 'px');
      shelfEl.style.setProperty('--cy', Math.round((b.top + b.height / 2) - top) + 'px');
    }
  }
  function openShelf(key, label, list, catEl) {
    if (!shelfEl) return;
    var grid = shelfEl.querySelector('.syfs-flyout');
    grid.textContent = '';
    list.forEach(function (t, i) {
      var tb = toolBtn(t);
      tb.style.setProperty('--i', String(i));
      grid.appendChild(tb);
    });
    if (!list.length) grid.appendChild(h('<div class="syfs-shelf-empty">لا أدوات</div>'));
    shelfEl.querySelector('.syfs-shelf-title').textContent = label;
    shelfEl.querySelector('.syfs-shelf-count').textContent = list.length ? String(list.length) : '';
    dockEl2.querySelectorAll('.syfs-cat.open').forEach(function (c) { c.classList.remove('open'); });
    if (catEl) catEl.classList.add('open');
    openCat = key; openCatEl = catEl;
    shelfEl.classList.remove('in');
    placeShelf(catEl);
    shelfEl.classList.add('on');
    markPaletteOpen();
    /* two frames: the from-state has to be PAINTED before `.in` removes it, or the
       browser folds both into one style pass and the stagger never runs */
    cancelAnimationFrame(shelfRaf);
    shelfRaf = requestAnimationFrame(function () {
      shelfRaf = requestAnimationFrame(function () { if (shelfEl) shelfEl.classList.add('in'); });
    });
  }
  function toggleShelf(key, label, list, catEl) {
    if (openCat === key) { closeShelf(); return; }
    openShelf(key, label, list, catEl);
  }

  /* ===== the fold — the whole run collapses into the badge (ported from rail.js) ===== */
  function isFoldedDock() { return !!(dockEl2 && dockEl2.classList.contains('folded')); }
  function setFolded(on, instant) {
    if (!dockEl2) return;
    var badge = dockEl2.querySelector('.syfs-fold');
    clearTimeout(foldClipT);
    if (instant) dockEl2.classList.add('syfs-noanim');
    dockEl2.classList.toggle('folded', on);
    if (badge) { badge.setAttribute('aria-expanded', String(!on)); badge.title = on ? SYFS.t('فتح الشريط') : SYFS.t('طيّ الشريط'); }
    if (dockRun) dockRun.style.overflow = 'hidden';
    if (on) closeShelf();
    if (instant) {
      void dockEl2.offsetWidth;   /* flush, or both class changes coalesce and it animates anyway */
      dockEl2.classList.remove('syfs-noanim');
      if (!on && dockRun) dockRun.style.overflow = 'visible';
      return;
    }
    if (on) return;
    foldClipT = setTimeout(function () { if (dockRun) dockRun.style.overflow = 'visible'; }, 640);
  }
  function updateFoldCount() {
    if (!dockEl2) return;
    var cnt = dockEl2.querySelector('.syfs-fold-cnt'); if (!cnt) return;
    var n = 0;
    dockEl2.querySelectorAll('.syfs-run .syfs-cat').forEach(function (c) { if (c.style.display !== 'none') n++; });
    cnt.textContent = String(n);
  }
  /* --i = distance from the badge, along PAINT order. See the note in src/rail.js:
     the badge trails the run today, but reading `order` back means an `order` added
     later fails loudly instead of unrolling the strip from the wrong end. */
  function cssOrder(el) { var v = parseInt(getComputedStyle(el).order, 10); return v || 0; }
  function staggerRun(run) {
    if (!run) return;
    var seq = Array.prototype.slice.call(run.children)
      .map(function (c, k) { return { el: c, k: k, o: cssOrder(c) }; })
      .sort(function (a, b) { return (a.o - b.o) || (a.k - b.k); })
      .map(function (s) { return s.el; });
    var last = seq.length - 1;
    var fold = dockEl2 && dockEl2.querySelector('.syfs-fold');
    var leads = !!(fold && cssOrder(fold) < cssOrder(run));
    run.style.setProperty('--n', String(last < 0 ? 0 : last));
    seq.forEach(function (el, v) { el.style.setProperty('--i', String(leads ? v : last - v)); });
  }

  /* ===== the command palette — the search button's destination, as on the rail =====
     It replaces a search box wedged into a flyout header. Same reason as the shelf:
     one product, one way to find a tool by name. */
  function openPalette() {
    if (openWins.__palette) {
      focusWin(openWins.__palette);
      var q0 = openWins.__palette.querySelector('.syfs-pal-in');
      if (q0) { q0.value = ''; q0.focus(); }
      return;
    }
    var win = h('<div class="syfs-win syfs-shut" style="width:320px"><div class="syfs-win-head">'
      + '<span class="syfs-win-ic">' + DOCK_SVG.search + '</span>'
      + '<span class="syfs-win-title">بحث في كل الأدوات</span>'
      /* ⚙ beside ✕ — the same pair the rail's palette carries, for the same reason:
         the search window is where you are when you cannot find something. */
      + '<span class="syfs-win-actions"><button class="syfs-win-x" title="إغلاق">' + WI.close + '</button>'
      + '<button class="syfs-win-ctrl syfs-pal-set" title="إعدادات الدوك والأدوات">' + WI.gear + '</button></span></div>'
      + '<div class="syfs-win-body"><div class="syf-form">'
      + '<input class="syf-in syfs-pal-in" type="text" placeholder="اكتب اسم الأداة…">'
      + '<div class="syf-note-list syfs-pal-list"></div></div></div></div>');
    layer().appendChild(win);
    openWins.__palette = win;
    var input = win.querySelector('.syfs-pal-in'), list = win.querySelector('.syfs-pal-list');
    win.querySelector('.syfs-pal-set').addEventListener('click', function (e) {
      e.stopPropagation();                       /* the head is the drag handle */
      openDockSettings();
    });

    function render() {
      var q = (input.value || '').trim().toLowerCase();
      list.textContent = '';
      var hits = appTools().filter(function (t) { return !q || (t.name || '').toLowerCase().indexOf(q) >= 0; }).slice(0, 40);
      if (!hits.length) { list.appendChild(h('<div class="syf-empty">لا نتائج.</div>')); return; }
      hits.forEach(function (t, i) {
        var row = h('<button class="syfs-pal-row' + (i === 0 ? ' on' : '') + '"><span class="ic"></span><span class="nm"></span><span class="cat"></span></button>');
        row.querySelector('.ic').innerHTML = t.icon || DEFAULT_ICON;   /* internal, trusted SVG */
        row.querySelector('.nm').textContent = SYFS.t(t.name);
        row.querySelector('.cat').textContent = catLabel(t.cat);
        row.addEventListener('click', function (e) { e.stopPropagation(); closeWindow('__palette'); openWindow(t); });
        list.appendChild(row);
      });
    }
    /* ↑/↓ move the highlight, Enter takes it, Esc closes — a palette you have to
       reach for the mouse to finish is not a palette. */
    input.addEventListener('keydown', function (e) {
      var rows = Array.prototype.slice.call(list.querySelectorAll('.syfs-pal-row'));
      var i = rows.map(function (r) { return r.classList.contains('on'); }).indexOf(true);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!rows.length) return;
        var j = Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
        rows.forEach(function (r, k) { r.classList.toggle('on', k === j); });
        rows[j].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault(); if (rows[i < 0 ? 0 : i]) rows[i < 0 ? 0 : i].click();
      } else if (e.key === 'Escape') { e.preventDefault(); closeWindow('__palette'); }
    });
    input.addEventListener('input', render);
    win.querySelector('.syfs-win-x').addEventListener('click', function () { closeWindow('__palette'); });
    win.addEventListener('mousedown', function () { focusWin(win); });
    render();
    focusWin(win);
    place(win, Math.max(20, Math.round(window.innerWidth / 2 - 160)), 90);
    indexRows(win.querySelector('.syfs-win-body'));
    showWin(win);
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 30);
  }

  /* ---- dock build + drag + position ---- */
  function placeDock(x, y) {
    var dw = dockEl2.offsetWidth, dh = dockEl2.offsetHeight;
    x = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - dw - 8));
    y = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - dh - 8));
    dockPos = { x: x, y: y };
    dockEl2.style.left = x + 'px';
    dockEl2.style.top = y + 'px';
    if (openCatEl) placeShelf(openCatEl);   /* the shelf is anchored to a button that just moved */
  }
  /* ---- dock chrome icons (internal, trusted SVG strings) ----
     The workspace row and the gear used to be emoji (🔍 ⤢ ⌗ ✕ ⚙). Emoji come out
     coloured, at a different optical size per platform, and never line up with the
     stroked category icons above them — which is what made the strip look patched
     together. Same 24-box, same 2px stroke as the category icons now. */
  var DOCK_SVG = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>',
    window: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7"/><path d="M21 3l-8.5 8.5"/><path d="M10 4H6a3 3 0 00-3 3v11a3 3 0 003 3h11a3 3 0 003-3v-4"/></svg>',
    cascade: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="13" height="13" rx="2.5"/><path d="M8 4h11a2 2 0 012 2v11"/></svg>',
    closeall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9.5 10l5 5M14.5 10l-5 5"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>'
  };

  /* Workspace-only dock actions (what the old app.html header held): search /
     standalone-window / arrange / close-all, as icon buttons beside the gear.
     Only app.html has #syfa-workspace, so tool pages that also build a dock
     (sheet/word/…) don't get them — they never had that header. */
  /* The three controls this surface has and the page rail does not. Search and the
     gear are NOT here — the rail carries those too, so they are built with it. */
  var WORKSPACE_ACTS = [
    { act: 'window',   tip: 'نافذة مستقلّة' },
    { act: 'cascade',  tip: 'ترتيب النوافذ' },
    { act: 'closeall', tip: 'إغلاق كل النوافذ' }
  ];
  function buildDock() {
    /* THE PAGE RAIL'S OWN MARKUP — .syfs-rail › .syfs-shelf + .syfs-bar › (.syfs-run,
       .syfs-fold). It is not a lookalike: rail.css styles every one of these, so the
       glass, the buttons, the shelf, the cascade and the fold are literally the same
       code path as on a web page. `.syfa-dock2` stays on the element for the handful
       of things that are genuinely this surface's own (free-drag placement, the
       grip, the workspace controls, the running dot) — app-dock.css and nothing else.
       The grip carries no glyph — app-dock.css draws it as a rounded bar (::before). */
    /* ⛔ بناءٌ ثانٍ لا يترك الأول في الطبقة: `buildDock` يُنادى مرّة تزامنياً ومرّة بعد وصول
       قاموس اللغة (القوالب تُخبز بمُعرّفاتها العربية قبل وصوله)، وبلا هذا السطر كان الرصيفان
       يتراكبان — زجاج مضاعف، وطيّ الأول يطوي الثاني ويترك نفسه مفتوحاً. قِيس: `en` ⇒ رصيفان. */
    if (dockEl2 && dockEl2.parentNode) dockEl2.parentNode.removeChild(dockEl2);
    dockEl2 = h('<div class="syfs-rail syfa-dock2">'
      + '<div class="syfs-shelf"><div class="syfs-shelf-head"><span class="syfs-shelf-title"></span><span class="syfs-shelf-count"></span></div><div class="syfs-flyout"></div></div>'
      + '<div class="syfs-bar">'
      + '<span class="syfa-dock-grip" data-tip="اسحب لتحريك الدوك" role="button" aria-label="اسحب لتحريك الدوك"></span>'
      + '<div class="syfs-run"></div>'
      + '<button class="syfs-fold" type="button" title="طيّ الشريط" aria-expanded="true">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 6 5 5 5-5"/><path d="m7 13 5 5 5-5"/></svg>'
      + '<span class="syfs-fold-cnt"></span></button>'
      + '</div></div>');
    dockRun = dockEl2.querySelector('.syfs-run');
    shelfEl = dockEl2.querySelector('.syfs-shelf');
    hasWorkspace = !!document.getElementById('syfa-workspace');
    layer().appendChild(dockEl2);
    /* stamp the default orientation before the first paint — [data-pos] decides the
       flex direction and the mirror, so building without it lays the bar out one
       way and the restored value flips it a frame later, in front of the user */
    applyOrient(dockOrient);

    dockEl2.querySelector('.syfs-fold').addEventListener('click', function (e) {
      e.stopPropagation();
      dockFolded = !dockEl2.classList.contains('folded');
      setFolded(dockFolded); store.set(FOLD_KEY, dockFolded);
    });

    /* macOS-style magnifier over the category buttons — the rail's items and the
       rail's axis, so a size preset behaves the same on both surfaces. */
    if (SYFS.dockfx) SYFS.dockfx.attachMagnify(dockEl2, {
      items: function () { return dockRun.querySelectorAll('.syfs-cat-btn'); },
      axis: function () { return horiz() ? 'x' : 'y'; },
      enabled: function () { return dockFx === 'magnify'; },
      max: 1.5, influence: 110, spread: false
    });
    /* NO edge-peek here. It tucks a rail against a screen EDGE, and this dock is
       placed by hand anywhere on the page — there is no edge to tuck against. The
       fold badge is this surface's way to get the strip out of the way, and it is
       the better one: explicit, counted, and remembered. The peek setting in the
       dock's own settings window still drives the page rail, which is whose
       setting it is. */

    var grip = dockEl2.querySelector('.syfa-dock-grip');
    /* المقبض يعيش مع عقدته فيُربط مع كل بناء؛ ومستمعو `document`/`window` أدناه يقرأون
       `dockEl2` من نطاق الوحدة فيصحّون مع أي بناء لاحق ⇒ يُركَّبون مرّة واحدة. */
    grip.addEventListener('mousedown', function (e) { dockDrag = true; dockMoved = false; dockOx = e.clientX - dockEl2.offsetLeft; dockOy = e.clientY - dockEl2.offsetTop; closeShelf(); e.preventDefault(); });
    if (!dockWired) {
      dockWired = true;
      document.addEventListener('mousemove', function (e) { if (dockDrag) { dockMoved = true; placeDock(e.clientX - dockOx, e.clientY - dockOy); } });
      document.addEventListener('mouseup', function () { if (dockDrag) { dockDrag = false; if (dockMoved && dockPos) store.set(DOCK_KEY, dockPos); } });
      window.addEventListener('resize', function () {
        if (!dockPos) return;
        placeDock(dockPos.x, dockPos.y);
      });
      /* click anywhere outside the dock closes the shelf */
      document.addEventListener('mousedown', function (e) {
        if (!openCat) return;
        if (dockEl2 && dockEl2.contains(e.target)) return;
        closeShelf();
      });
      /* ⌘K / Ctrl+K opens the palette, exactly as on the page rail */
      document.addEventListener('keydown', function (e) {
        if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); closeShelf(); openPalette(); }
      });
    }

    renderPalette();
    store.get(FOLD_KEY, false).then(function (f) { dockFolded = !!f; setFolded(dockFolded, true); });
    /* ORIENTATION FIRST, then placement — and this ordering is load-bearing, not
       tidiness: the default position is derived from the dock's MEASURED box, and
       that box is a tall column or a wide bar depending on the orientation. Placing
       before the flip centres the wrong shape. */
    store.get(ORIENT_KEY, 'h').then(function (o) {
      applyOrient(o);
      return store.get(DOCK_KEY, null);
    }).then(function (p) {
      if (p && typeof p === 'object' && typeof p.x === 'number') { placeDock(p.x, p.y); return; }
      /* the default: a horizontal bar along the BOTTOM, centred — where a dock
         belongs on a workspace whose windows fill the middle of the screen. The
         fallbacks are only for a box that has not laid out yet, so they follow the
         orientation too; placeDock clamps whatever comes out. */
      var dw = dockEl2.offsetWidth || (horiz() ? 620 : 62);
      var dh = dockEl2.offsetHeight || (horiz() ? 62 : 520);
      if (horiz()) placeDock((window.innerWidth - dw) / 2, window.innerHeight - dh - DOCK_BOTTOM);
      else placeDock(window.innerWidth - dw - DOCK_BOTTOM, (window.innerHeight - dh) / 2);
    });
  }

  /* ---------- dock + workspace-tools settings window ---------- */
  var dockSettingsWin = null;
  function openDockSettings() {
    if (dockSettingsWin) { focusWin(dockSettingsWin); return; }
    var win = h('<div class="syfs-win" style="width:330px"><div class="syfs-win-head"><span class="syfs-win-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h8M16 6h4M4 12h4M12 12h8M4 18h11M19 18h1"/><circle cx="14" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg></span><span class="syfs-win-title">إعدادات الدوك والأدوات</span><span class="syfs-win-actions"><button class="syfs-win-x" title="إغلاق">' + WI.close + '</button></span></div><div class="syfs-win-body"></div></div>');
    layer().appendChild(win); dockSettingsWin = win;
    var body = win.querySelector('.syfs-win-body');

    /* appearance — same four settings as the page rail (src/dockfx.js), so a change
       here also updates the floating rail on web pages */
    if (SYFS.dockfx) {
      var apc = h('<div class="syf-form"><label style="font-weight:800;color:var(--pri);border-bottom:1px solid var(--line);padding-bottom:4px">مظهر الدوك</label></div>');
      /* Orientation is THIS dock's own setting — the page rail picks a screen edge
         and gets its direction from that, while this one is dragged anywhere, so
         it has to be told. Horizontal lays the bar flat right-to-left, the same
         mirror the top/bottom rail uses. */
      apc.appendChild(h('<label>اتجاه الدوك</label>'));
      var orRow = h('<div class="syfs-fx-row"></div>');
      [['v', 'عمودي'], ['h', 'أفقي']].forEach(function (o) {
        var b = h('<button class="syfs-fx" data-or="' + o[0] + '"></button>'); b.textContent = SYFS.t(o[1]);
        b.classList.toggle('on', dockOrient === o[0]);
        b.addEventListener('click', function () {
          store.set(ORIENT_KEY, o[0]); applyOrient(o[0]);
          orRow.querySelectorAll('.syfs-fx').forEach(function (x) { x.classList.toggle('on', x === b); });
        });
        orRow.appendChild(b);
      });
      apc.appendChild(orRow);
      /* «مثل الماك» named one of the six options — and no longer the default one */
      apc.appendChild(h('<label style="margin-top:6px">تأثير التمرير</label>'));
      var fxRow = h('<div class="syfs-fx-row"></div>');
      SYFS.dockfx.EFFECTS.forEach(function (e) {
        var b = h('<button class="syfs-fx" data-fx="' + e[0] + '"></button>'); b.textContent = SYFS.t(e[1]);
        b.addEventListener('click', function () { SYFS.dockfx.save({ dock_effect: e[0] }); fxRow.querySelectorAll('.syfs-fx').forEach(function (x) { x.classList.toggle('on', x === b); }); });
        fxRow.appendChild(b);
      });
      apc.appendChild(fxRow);
      /* one slider, same key as the page rail (⛔ the four presets are gone — see the
         tombstone in src/dockfx.js). This dock floats and is never shrunk to fit a
         screen edge, so there is no cap hint here: what you pick is what you get. */
      apc.appendChild(h('<label style="margin-top:6px">حجم الأيقونات</label>'));
      var szRow = h('<div class="syfs-op-row"></div>');
      var SC = SYFS.dockfx.SCALE;
      var szIn = h('<input type="range" min="' + SC.min + '" max="' + SC.max + '" step="' + SC.step + '">');
      var szVal = h('<span class="syfs-op-val"></span>');
      szRow.appendChild(szIn); szRow.appendChild(szVal);
      apc.appendChild(szRow);
      szIn.addEventListener('input', function () { szVal.textContent = szIn.value + '%'; SYFS.dockfx.save({ dock_scale: +szIn.value }); });
      apc.appendChild(h('<label style="margin-top:6px">عرض أدوات التصنيف</label>'));
      var lbRow = h('<div class="syfs-fx-row"></div>');
      SYFS.dockfx.LABELS.forEach(function (l) {
        var b = h('<button class="syfs-fx" data-lb="' + l[0] + '"></button>'); b.textContent = SYFS.t(l[1]);
        b.addEventListener('click', function () { SYFS.dockfx.save({ dock_labels: l[0] }); lbRow.querySelectorAll('.syfs-fx').forEach(function (x) { x.classList.toggle('on', x === b); }); });
        lbRow.appendChild(b);
      });
      apc.appendChild(lbRow);
      apc.appendChild(h('<label style="margin-top:6px">الشفافية</label>'));
      var opRow = h('<div class="syfs-op-row"></div>');
      var opIn = h('<input type="range" min="35" max="100" step="5">');
      var opVal = h('<span class="syfs-op-val"></span>');
      opRow.appendChild(opIn); opRow.appendChild(opVal); apc.appendChild(opRow);
      opIn.addEventListener('input', function () { opVal.textContent = opIn.value + '%'; SYFS.dockfx.save({ dock_opacity: (+opIn.value) / 100 }); });
      var peekCk = h('<label class="syf-ck" style="margin-top:8px"><input type="checkbox"> إخفاء الدوك عند الحافة — يظهر عند الاقتراب</label>');
      peekCk.querySelector('input').addEventListener('change', function () { SYFS.dockfx.save({ dock_peek: this.checked }); });
      apc.appendChild(peekCk);
      body.appendChild(apc);

      /* UI font — same preference as the page rail (src/fontkit.js, key `ui_font`),
         so the workspace, the floating rail and every extension page stay in step */
      if (SYFS.fontkit) {
        var FK = SYFS.fontkit;
        apc.appendChild(h('<label style="margin-top:6px">خط الواجهة</label>'));
        var fnRow = h('<div class="syfs-fn-row"></div>');
        var sysB = h('<button class="syfs-fn" data-f=""></button>');
        sysB.textContent = SYFS.t('خط النظام');
        fnRow.appendChild(sysB);
        FK.FAMILIES.forEach(function (f) {
          var b = h('<button class="syfs-fn" data-f="' + f[0] + '"></button>');
          b.textContent = SYFS.t(f[2]);       /* msgid → Latin family name (§6.103/7) */
          b.style.fontFamily = FK.stackFor(f[0]);   /* the chip previews itself */
          FK.load(f[0]);
          fnRow.appendChild(b);
        });
        apc.appendChild(fnRow);
        var locWrap = h('<div class="syf-row" style="margin-top:6px"></div>');
        var locIn = h('<input class="syf-in" placeholder="أو اكتب اسم خط مثبّت على جهازك">');
        var locB = h('<button class="syf-mini">تطبيق</button>');
        locWrap.appendChild(locIn); locWrap.appendChild(locB);
        apc.appendChild(locWrap);
        apc.appendChild(h('<div class="syf-mg-hint">الخطوط المرفقة مضمّنة داخل الإضافة (رخصة OFL) وتعمل بلا إنترنت — لا يُرسَل أي طلب لخوادم جوجل.</div>'));
        var markFont = function (v) {
          var isLocal = v && v.indexOf('local:') === 0;
          fnRow.querySelectorAll('.syfs-fn').forEach(function (b) { b.classList.toggle('on', !isLocal && b.dataset.f === v); });
          locIn.value = isLocal ? v.slice(6) : '';
          locWrap.classList.toggle('on', !!isLocal);
        };
        fnRow.querySelectorAll('.syfs-fn').forEach(function (b) {
          b.addEventListener('click', function () { FK.set(b.dataset.f); markFont(b.dataset.f); });
        });
        var applyLocal = function () {
          var n = FK.cleanLocal(locIn.value);
          if (!n) { locIn.value = ''; return; }
          locIn.value = n;
          FK.set('local:' + n); markFont('local:' + n);
        };
        locB.addEventListener('click', applyLocal);
        locIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') applyLocal(); });
        FK.get(markFont);
      }

      SYFS.dockfx.load(function (p) {
        fxRow.querySelectorAll('.syfs-fx').forEach(function (b) { b.classList.toggle('on', b.dataset.fx === p.effect); });
        szIn.value = p.scale; szVal.textContent = szIn.value + '%';
        lbRow.querySelectorAll('.syfs-fx').forEach(function (b) { b.classList.toggle('on', b.dataset.lb === (p.labels || 'icons')); });
        opIn.value = Math.round((p.opacity != null ? p.opacity : 1) * 100); opVal.textContent = opIn.value + '%';
        peekCk.querySelector('input').checked = !!p.peek;
      });
    }

    /* workspace tool visibility — which tools appear in this dock's categories */
    var tc = h('<div class="syf-form" style="margin-top:10px"><label style="font-weight:800;color:var(--pri);border-bottom:1px solid var(--line);padding-bottom:4px">أدوات مساحة العمل</label><div class="syf-mg-hint">اختر الأدوات التي تظهر في الدوك. غير المحدّدة تُخفى من مساحة العمل (تبقى متاحة في الشريط العائم).</div></div>');
    var listBox = h('<div class="syf-mg-list"></div>'); tc.appendChild(listBox);
    var all = tools.filter(usable);
    var groups = {}; all.forEach(function (t) { (groups[t.cat] = groups[t.cat] || []).push(t); });
    var order = CAT_ORDER.concat(Object.keys(groups)).filter(function (v, i, a) { return a.indexOf(v) === i && groups[v] && groups[v].length; });
    order.forEach(function (ck) {
      var acc = h('<div class="syf-acc open"></div>');
      var head = h('<div class="syf-acc-head" style="cursor:default"><span class="syf-acc-title"></span><span class="syf-acc-badge"></span></div>');
      head.querySelector('.syf-acc-title').textContent = catLabel(ck);
      var badge = head.querySelector('.syf-acc-badge');
      var paint = function () { badge.textContent = groups[ck].filter(function (t) { return !isAppHidden(t.id); }).length + '/' + groups[ck].length; };
      acc.appendChild(head);
      var bodyEl = h('<div class="syf-acc-body"></div>');
      groups[ck].forEach(function (t) {
        var row = h('<div class="syf-mg-row"><input type="checkbox" class="syf-mg-ck"' + (isAppHidden(t.id) ? '' : ' checked') + '><span class="nm"></span></div>');
        row.querySelector('.nm').textContent = SYFS.t(t.name);
        row.querySelector('.syf-mg-ck').addEventListener('change', function () {
          var i = appHidden.indexOf(t.id);
          if (this.checked) { if (i >= 0) appHidden.splice(i, 1); } else if (i < 0) appHidden.push(t.id);
          store.set('app_hidden_tools', appHidden); paint(); renderPalette();
        });
        bodyEl.appendChild(row);
      });
      paint();
      acc.appendChild(bodyEl); listBox.appendChild(acc);
    });
    body.appendChild(tc);

    win.querySelector('.syfs-win-x').addEventListener('click', function () { win.remove(); dockSettingsWin = null; });
    win.addEventListener('mousedown', function () { focusWin(win); });
    focusWin(win);
    place(win, Math.max(20, (window.innerWidth - 330) / 2), 70);
    makeDraggable(win, '__docksettings');
  }

  /* ---------- init ---------- */
  /* The workspace search + window/cascade/close-all actions moved from the removed
     top header into the dock (buildDockActions, workspace-only). cascadeAll/closeAll
     stay as-is; the standalone-window action opens App Mode as its own popup then
     closes this tab so it "moves" into the app-like window. */

  layer();          /* create the overlay up-front so the dock + accent attach to it */
  loadTheme();
  /* Language before anything that carries a label. Unlike the rail this page cannot
     wait — the dock is built synchronously below — so the labels paint in Arabic and
     the palette is re-rendered once the dictionary lands. That repaint is invisible
     in the default language, where apply() resolves without fetching anything. */
  store.get(SYFS.i18n.KEY, SYFS.i18n.DEFAULT).then(function (l) {
    return SYFS.i18n.apply(l);
  }).then(function (l) {
    document.documentElement.setAttribute('dir', SYFS.i18n.dir(l));
    document.documentElement.setAttribute('lang', l);
    /* ⚠️ the ATTRIBUTE on the wrap too, not just the custom property. app.html hard-codes
       `dir="rtl"` on #syfa-root, and an attribute on the element itself is not touched by
       the one on <html> — so the property said `ltr` while the attribute still said `rtl`,
       and every `[dir="ltr"]` rule in rail.css missed this surface. Same writer, same two
       outputs as the rail's markDir(). */
    if (root) {
      root.setAttribute('dir', SYFS.i18n.dir(l));
      root.style.setProperty('--syfs-dir', SYFS.i18n.dir(l));
    }
    /* إعادة البناء لازمة فعلاً — قوالب الرصيف (`title`/`aria-label`/`data-tip`) تُخبز
       بمُعرّفاتها العربية قبل وصول القاموس — والعطل كان أن `buildDock` بلا حارس: يُلحق
       رصيفاً ثانياً ويترك الأول. الحارس صار داخلها (تُزيل عقدتها وتربط مستمعي `document`
       مرّة واحدة)، فبقي النداء هنا كما هو. `renderPalette` تناديها هي بنفسها. */
    if (l !== SYFS.i18n.DEFAULT && !EMBED) buildDock();
  });
  /* embedded in a workspace tab → the host workspace already shows the dock, so skip
     building a second one here (the tool's own content is built by its own script). */
  if (!EMBED) buildDock();   /* it restores its own orientation, then its position */
  if (!EMBED && SYFS.dockfx) { SYFS.dockfx.load(applyDockPrefs); SYFS.dockfx.onChange(applyDockPrefs); }
  store.get('app_hidden_tools', []).then(function (v) { appHidden = Array.isArray(v) ? v : []; renderPalette(); });
  /* the rail manager's drag-reorder, honoured here too. Flyouts are built on open,
     so this landing after buildDock() is fine — nothing showing a tool list yet. */
  store.get('tool_order', {}).then(function (v) { if (v && typeof v === 'object') toolOrder = v; renderPalette(); });
  store.get('favorites', []).then(function (v) { favs = Array.isArray(v) ? v : []; renderPalette(); });
  store.get('custom_links', []).then(function (v) { customLinks = Array.isArray(v) ? v : []; });
  /* The standalone window has no use for «نافذة مستقلّة» — it IS one. Asked from there,
     the worker focuses this very window (one workspace at a time) and the button's
     close-after-success would then shut the workspace itself. */
  try { chrome.windows.getCurrent(function (w) { inPopup = !!(w && w.type === 'popup'); if (inPopup) renderPalette(); }); } catch (e) {}

  /* ---- the user's keyboard shortcuts (rail manager ⌨, key `hotkeys`) ----
     Same bindings, same combo format as src/rail.js comboFromEvent / idForCombo, so a
     tool bound on the rail opens here too: the user's own entry wins, a tool's shipped
     `hotkey:` applies unless the user rebound or cleared it (`false`), and typing in a
     field is left alone. */
  var hotkeys = {};
  store.get('hotkeys', {}).then(function (v) { hotkeys = (v && typeof v === 'object') ? v : {}; });
  function comboOf(e) {
    if (/^(Alt|Control|Shift|Meta)$/.test(e.key) || !(e.ctrlKey || e.altKey || e.metaKey)) return null;
    var p = [];
    if (e.ctrlKey) p.push('Ctrl');
    if (e.altKey) p.push('Alt');
    if (e.shiftKey) p.push('Shift');
    if (e.metaKey) p.push('Meta');
    p.push(e.code || e.key);
    return p.join('+');
  }
  function toolForCombo(c) {
    for (var id in hotkeys) if (hotkeys.hasOwnProperty(id) && hotkeys[id] === c) return toolById(id);
    for (var i = 0; i < tools.length; i++) if (tools[i].hotkey === c && !hotkeys.hasOwnProperty(tools[i].id)) return tools[i];
    return null;
  }
  document.addEventListener('keydown', function (e) {
    var el = e.target, tag = (el && el.tagName || '').toLowerCase();
    if (el && (el.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select')) return;
    var c = comboOf(e), t = c && toolForCombo(c);
    if (!t || t.id === 'appmode' || PAGE_ONLY[t.id]) return;   /* already here / needs a host page */
    e.preventDefault();
    openWindow(t);
  });
  updateHint();
}());
