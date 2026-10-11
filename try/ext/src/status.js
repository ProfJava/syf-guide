/* SYF — status maker (status.html). The UI layer: controls, canvas, export.
 *
 * All of the arithmetic — wrapping, the auto-fit search, the safe box, the ink
 * decision, the whitelists — lives in src/status-core.js and is tested in node
 * (tools/status-test.js). This file owns only what needs a browser.
 *
 * Three rules it does not break:
 *   · the user's text is drawn with `fillText` and never becomes markup — there is no
 *     innerHTML path for it, here or in the core;
 *   · the picked image is read with createImageBitmap from a File and never fetched,
 *     uploaded or stored — closing the tab is the whole cleanup;
 *   · exactly ONE storage key is written (`status_prefs`), and it is read back through
 *     the core's whitelist, so a hand-edited value cannot reach a canvas or a filename.
 *
 * The canvas is the FULL output size (1080×1920 and friends) and is only displayed
 * smaller by CSS: what you download is the thing that was measured, not a scaled redraw. */
(function () {
  'use strict';
  var SYFS = window.SYFS || (window.SYFS = {});
  var CORE = SYFS.statusCore;
  var store = SYFS.storage;
  var FK = SYFS.fontkit;

  /* i18n-via: T — every Arabic string below reaches the DOM through this wrapper
     (§6.103). Variadic on purpose: a fixed (s, a, b) signature silently dropped a
     third placeholder once and printed «{2}» on screen. */
  var T = function () { return SYFS.t ? SYFS.t.apply(null, arguments) : arguments[0]; };

  var $ = function (id) { return document.getElementById(id); };
  var cv = $('st-canvas'), ctx = cv.getContext('2d');
  var state = CORE.mergeOptions(null);
  var text = '';
  var bgBitmap = null;                    /* the picked image, in this tab's memory only */
  var PREF_KEY = 'status_prefs';

  /* ===== toast ===== */
  var toastT = 0;
  function toast(msg) {
    var el = $('st-toast');
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('on'); }, 2200);
  }

  /* ===== chip rows =====
   * One builder for every segmented control on the page. `items` is [value, label];
   * the label is translated HERE, at the write, and written with textContent. */
  function chips(host, items, get, set) {
    host.innerHTML = '';
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip';
      b.textContent = T(it[1]);
      b.dataset.v = String(it[0]);
      b.addEventListener('click', function () { set(it[0]); syncChips(host, get); render(); save(); });
      host.appendChild(b);
    });
    syncChips(host, get);
  }
  function syncChips(host, get) {
    var v = String(get());
    host.querySelectorAll('.chip').forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); });
  }

  /* ===== fonts =====
   * The same bundled OFL families the rest of the extension uses (src/fontkit.js).
   * ⚠️ A canvas will silently paint a fallback if the face is not loaded YET, so the
   * bytes are pulled and `document.fonts.load` is awaited before the redraw — this is
   * the one asynchronous thing between picking a font and seeing it. */
  function fontStack(slug) {
    var name = FK && FK.cssName ? FK.cssName(slug) : '';
    return (name ? "'" + name + "', " : '') + "'Segoe UI', system-ui, -apple-system, sans-serif";
  }
  function fontSpec(size) { return state.weight + ' ' + size + 'px ' + fontStack(state.font); }
  function ensureFont(slug) {
    if (!FK || !FK.load) return Promise.resolve();
    return FK.load(slug).then(function () {
      if (!document.fonts || !document.fonts.load) return null;
      /* one representative size is enough — the face is size-independent */
      return document.fonts.load('700 100px ' + fontStack(slug)).catch(function () { return null; });
    }).catch(function () { return null; });
  }

  /* ===== drawing ===== */
  function measureAt(size, str) {
    ctx.font = fontSpec(size);
    return ctx.measureText(String(str)).width;
  }

  function paintBackground(p) {
    if (state.bg === 'image' && bgBitmap) {
      /* cover-fit: fill the frame and crop the overflow, never letterbox */
      var s = Math.max(p.w / bgBitmap.width, p.h / bgBitmap.height);
      var dw = bgBitmap.width * s, dh = bgBitmap.height * s;
      if (state.blur) ctx.filter = 'blur(' + state.blur + 'px)';
      /* drawn slightly oversized so the blur cannot smear a transparent edge inwards */
      var over = state.blur ? state.blur * 3 : 0;
      ctx.drawImage(bgBitmap, (p.w - dw) / 2 - over, (p.h - dh) / 2 - over, dw + over * 2, dh + over * 2);
      ctx.filter = 'none';
      if (state.scrim > 0) {
        ctx.fillStyle = 'rgba(0,0,0,' + state.scrim + ')';
        ctx.fillRect(0, 0, p.w, p.h);
      }
      return;
    }
    if (state.bg === 'solid') {
      ctx.fillStyle = CORE.hex(state.solid) || CORE.DEFAULTS.solid;
      ctx.fillRect(0, 0, p.w, p.h);
      return;
    }
    var pal = CORE.palette(state.palette);
    var rad = (state.angle - 90) * Math.PI / 180;
    var cx = p.w / 2, cy = p.h / 2, len = (Math.abs(Math.cos(rad)) * p.w + Math.abs(Math.sin(rad)) * p.h) / 2;
    var g = ctx.createLinearGradient(cx - Math.cos(rad) * len, cy - Math.sin(rad) * len,
                                     cx + Math.cos(rad) * len, cy + Math.sin(rad) * len);
    g.addColorStop(0, pal.from); g.addColorStop(1, pal.to);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, p.w, p.h);
  }

  function render() {
    var p = CORE.preset(state.preset);
    if (cv.width !== p.w || cv.height !== p.h) { cv.width = p.w; cv.height = p.h; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, p.w, p.h);
    paintBackground(p);

    var box = CORE.safeBox(p, state);
    var lay = CORE.layout(measureAt, text, box, state);
    var ink = CORE.pickInk(state);

    /* «plate»: a translucent slab behind the block, for a busy photo where neither a
       shadow nor an outline is enough. Drawn from the block's own measured height. */
    if (state.effect === 'plate' && text.trim()) {
      var padx = lay.size * 0.5, pady = lay.size * 0.42;
      ctx.fillStyle = ink === '#ffffff' ? 'rgba(10,14,18,.42)' : 'rgba(255,255,255,.55)';
      var r = Math.min(lay.size * 0.5, 48);
      var x = box.x - padx / 2, y = lay.top - pady, w = box.w + padx, hgt = lay.blockH + pady * 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, hgt, r); else ctx.rect(x, y, w, hgt);
      ctx.fill();
    }

    ctx.direction = 'rtl';                       /* Arabic first; the engine still orders
                                                    an embedded latin run correctly */
    ctx.textBaseline = 'middle';
    ctx.textAlign = state.align === 'center' ? 'center' : (state.align === 'start' ? 'right' : 'left');
    var tx = state.align === 'center' ? box.x + box.w / 2 : (state.align === 'start' ? box.x + box.w : box.x);
    ctx.font = fontSpec(lay.size);
    ctx.fillStyle = ink;

    if (state.effect === 'shadow') {
      ctx.shadowColor = ink === '#ffffff' ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.5)';
      ctx.shadowBlur = Math.max(6, lay.size * 0.22);
      ctx.shadowOffsetY = Math.max(2, lay.size * 0.05);
    } else { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; }

    lay.lines.forEach(function (line, i) {
      var y = lay.top + lay.lineH * (i + 0.5);
      if (state.effect === 'outline') {
        ctx.lineWidth = Math.max(2, lay.size * 0.085);
        ctx.strokeStyle = ink === '#ffffff' ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.75)';
        ctx.lineJoin = 'round';
        ctx.strokeText(line, tx, y);
      }
      ctx.fillText(line, tx, y);
    });
    ctx.shadowColor = 'transparent';

    paintSafeOverlay(p);
    /* ⚠️ «1080×1920» inside an Arabic sentence comes out «1920×1080»: the × is a
       neutral character, so the whole run is re-ordered with the paragraph. The pair
       below is an LTR isolate — same class of bug as the leading «+» on a phone number
       (§6.98/9), and the same shape of fix. */
    $('st-meta').textContent = T('{0} بكسل · {1} سطر · حجم الخطّ {2}px',
      '⁦' + p.w + '×' + p.h + '⁩', String(lay.lines.length), String(lay.size));
  }

  /* the safe-zone hatching is a DOM overlay, not canvas paint: it must be impossible
     for it to end up in the exported file */
  function paintSafeOverlay(p) {
    var v = $('st-safeview');
    v.hidden = !state.safe;
    v.querySelector('i.t').style.height = (p.safeTop * 100) + '%';
    v.querySelector('i.b').style.height = (p.safeBottom * 100) + '%';
  }

  /* ===== export ===== */
  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function exportAs(type) {
    var jpg = type === 'jpg';
    cv.toBlob(function (blob) {
      if (!blob) { toast(T('تعذّر إنشاء الصورة.')); return; }
      download(blob, CORE.fileName(text, jpg ? 'jpg' : 'png'));
      toast(T('تم التنزيل ✓'));
    }, jpg ? 'image/jpeg' : 'image/png', jpg ? 0.92 : undefined);
  }
  function copyImage() {
    if (!navigator.clipboard || typeof ClipboardItem !== 'function') {
      toast(T('النسخ للحافظة غير مدعوم في هذا المتصفّح — استعمل التنزيل.')); return;
    }
    cv.toBlob(function (blob) {
      if (!blob) { toast(T('تعذّر إنشاء الصورة.')); return; }
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        .then(function () { toast(T('نُسخت الصورة ✓')); })
        .catch(function () { toast(T('تعذّر النسخ — استعمل التنزيل.')); });
    }, 'image/png');
  }

  /* ===== preferences — one key, whitelisted on the way back in ===== */
  var saveT = 0;
  function save() {
    /* ⚠️ the TEXT is never stored — a status is often personal, and this is a tool, not
       a notebook. What persists is the LOOK: preset, background, font, effect. */
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      try { if (store) store.set(PREF_KEY, state); } catch (e) { /* ignore */ }
    }, 300);
  }

  /* ===== wiring ===== */
  function rangeCtl(id, vid, get, set, fmt) {
    var el = $(id), out = $(vid);
    var show = function () { out.textContent = fmt(get()); };
    el.value = String(get());
    show();
    el.addEventListener('input', function () { set(Number(el.value)); show(); render(); save(); });
    return show;
  }

  function build() {
    chips($('st-preset'), CORE.PRESETS.map(function (p) { return [p.id, p.ar]; }),
      function () { return state.preset; }, function (v) { state.preset = v; });

    chips($('st-bg'), [['gradient', 'تدرّج'], ['solid', 'لون واحد'], ['image', 'صورة']],
      function () { return state.bg; }, function (v) { state.bg = v; bgMode(); });

    /* the palettes are swatches, not words: the name of a gradient tells you less than
       two square centimetres of it */
    var pal = $('st-pal'); pal.innerHTML = '';
    CORE.PALETTES.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'sw'; b.dataset.v = p.id;
      b.title = T(p.ar); b.setAttribute('aria-label', T(p.ar));
      b.style.background = 'linear-gradient(150deg,' + p.from + ',' + p.to + ')';
      b.addEventListener('click', function () {
        state.palette = p.id;
        pal.querySelectorAll('.sw').forEach(function (x) { x.classList.toggle('on', x === b); });
        render(); save();
      });
      pal.appendChild(b);
    });
    var markPal = function () { pal.querySelectorAll('.sw').forEach(function (x) { x.classList.toggle('on', x.dataset.v === state.palette); }); };
    markPal();

    var solids = ['#14301f', '#0b0f14', '#3b2a55', '#123b52', '#5c2f2f', '#f7f3e8', '#ffffff', '#457364'];
    var sh = $('st-solids'); sh.innerHTML = '';
    solids.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'sw'; b.dataset.v = c;
      b.style.background = c; b.setAttribute('aria-label', c);
      b.addEventListener('click', function () {
        state.solid = c;
        sh.querySelectorAll('.sw').forEach(function (x) { x.classList.toggle('on', x === b); });
        render(); save();
      });
      sh.appendChild(b);
    });
    var markSolid = function () { sh.querySelectorAll('.sw').forEach(function (x) { x.classList.toggle('on', x.dataset.v === state.solid); }); };
    markSolid();

    /* the font chips preview themselves, exactly as the rail's picker does */
    var fh = $('st-fonts'); fh.innerHTML = '';
    (FK ? FK.FAMILIES : []).forEach(function (f) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.dataset.v = f[0];
      b.textContent = T(f[2]);
      b.style.fontFamily = fontStack(f[0]);
      FK.load(f[0]);
      b.addEventListener('click', function () {
        state.font = f[0];
        fh.querySelectorAll('.chip').forEach(function (x) { x.classList.toggle('on', x === b); });
        ensureFont(f[0]).then(render);
        save();
      });
      fh.appendChild(b);
    });
    var markFont = function () { fh.querySelectorAll('.chip').forEach(function (x) { x.classList.toggle('on', x.dataset.v === state.font); }); };
    markFont();

    chips($('st-weight'), [[400, 'عادي'], [700, 'عريض']],
      function () { return state.weight; }, function (v) { state.weight = v; });
    chips($('st-align'), [['center', 'توسيط'], ['start', 'يمين'], ['end', 'يسار']],
      function () { return state.align; }, function (v) { state.align = v; });
    chips($('st-ink'), [['auto', 'تلقائي'], ['light', 'أبيض'], ['dark', 'أسود']],
      function () { return state.ink; }, function (v) { state.ink = v; });
    chips($('st-effect'), [['shadow', 'ظلّ'], ['outline', 'حدّ'], ['plate', 'لوح خلف النصّ'], ['none', 'بدون']],
      function () { return state.effect; }, function (v) { state.effect = v; });

    rangeCtl('st-size', 'st-size-v', function () { return state.size; }, function (v) { state.size = v; },
      function (v) { return v ? v + 'px' : T('تلقائي'); });
    rangeCtl('st-lh', 'st-lh-v', function () { return Math.round(state.lineHeight * 100); },
      function (v) { state.lineHeight = v / 100; }, function (v) { return (v / 100).toFixed(2); });
    rangeCtl('st-angle', 'st-angle-v', function () { return state.angle; }, function (v) { state.angle = v; },
      function (v) { return v + '°'; });
    rangeCtl('st-scrim', 'st-scrim-v', function () { return Math.round(state.scrim * 100); },
      function (v) { state.scrim = v / 100; }, function (v) { return v + '%'; });
    rangeCtl('st-blur', 'st-blur-v', function () { return state.blur; }, function (v) { state.blur = v; },
      function (v) { return v + 'px'; });

    var safeCk = $('st-safe');
    safeCk.checked = state.safe;
    safeCk.addEventListener('change', function () { state.safe = safeCk.checked; render(); save(); });

    $('st-text').addEventListener('input', function () { text = this.value; render(); });

    $('st-file').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) { toast(T('اختر ملفّ صورة.')); return; }
      /* createImageBitmap from the File itself: the bytes never become a URL that
         anything could fetch, and nothing is written anywhere */
      createImageBitmap(f).then(function (bmp) {
        bgBitmap = bmp; state.bg = 'image'; bgMode();
        syncChips($('st-bg'), function () { return state.bg; });
        render(); save();
      }).catch(function () { toast(T('تعذّرت قراءة الصورة.')); });
    });

    $('st-png').addEventListener('click', function () { exportAs('png'); });
    $('st-jpg').addEventListener('click', function () { exportAs('jpg'); });
    $('st-copy').addEventListener('click', copyImage);

    function bgMode() {
      $('st-grad').hidden = state.bg !== 'gradient';
      $('st-solidbox').hidden = state.bg !== 'solid';
      $('st-imgbox').hidden = state.bg !== 'image';
    }
    bgMode();
  }

  /* ===== boot =====
   * The language is applied BEFORE anything is built: every chip label is written from
   * JS, and a control painted one frame early paints Arabic into an English page and is
   * never repainted (§6.100/4). Same order phones.js uses. */
  function boot() {
    var ready = function () {
      var done = function () {
        build();
        ensureFont(state.font).then(render);
      };
      if (!store) { done(); return; }
      store.get(PREF_KEY, null)
        .then(function (stored) { state = CORE.mergeOptions(stored); done(); }, done);   /* whitelist on read (§4.1) */
    };
    if (store && SYFS.i18n && SYFS.i18n.apply) {
      store.get(SYFS.i18n.KEY, SYFS.i18n.DEFAULT)
        .then(function (l) { return SYFS.i18n.apply(l); })
        .then(ready, ready);
    } else ready();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());
