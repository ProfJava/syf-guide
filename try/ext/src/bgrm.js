/* SYF — «حذف الخلفية»: the sixth tab of «محرر الصور والمحوّل» (spec: specs/bg-remove.md).
 * Manual mode — magic wand (contiguous or by colour) + keep/erase brushes + feather — on
 * local canvases only; the image never leaves the device and is never stored.
 *
 * - The MASK is the document: one Uint8ClampedArray of alpha at the image's FULL
 *   resolution (255 = keep). The preview is a scaled copy; export composes the full-size
 *   pixels with the (feathered) mask. Feather is applied at render/export, never baked in,
 *   so moving its slider is not an edit and needs no undo step.
 * - Undo snapshots are run-length encoded: a 25 MP mask is 25 MB raw, twenty of those
 *   would be half a gigabyte; a cut-out mask is a few thousand runs.
 * - Automatic mode (spec §3–4, CLAUDE.md §5.32): U²-Netp in a hidden extension-page frame
 *   (bgrm-engine.html) over a private MessageChannel; its 320² mask is upscaled here and
 *   lands as one undoable step. `SYFS.bgrm.setMask(alpha)` stays the outside hook.
 * - Pure helpers live on `SYFS.bgrm._p` for tools/bgrm-test.js.
 * Loaded lazily (LAZY_TOOL_FILES) BEFORE src/media.js, which builds the tab. */
(function () {
  window.SYFS = window.SYFS || {};

  var MAX_PX = 25e6;                 /* spec §11 — above this the tab refuses, it does not freeze */
  var PREVIEW_MAX = 900;             /* longest side of the on-screen canvas */
  var HIST_CAP = 25;                 /* spec §6 — at least 20 steps */
  var PREF_KEY = 'bgrm_prefs';

  /* ================= pure helpers (no DOM) ================= */
  function clampInt(v, lo, hi, def) { v = Math.round(+v); if (!isFinite(v)) return def; return Math.max(lo, Math.min(hi, v)); }

  /* `bgrm_prefs` is written by the settings import too (any JSON) ⇒ filtered on read */
  function cleanPrefs(v) {
    v = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    return {
      tol: clampInt(v.tol, 0, 100, 30),
      mode: v.mode === 'global' ? 'global' : 'flood',
      bg: ['none', 'white', 'color'].indexOf(v.bg) >= 0 ? v.bg : 'none',
      color: (typeof v.color === 'string' && /^#[0-9a-f]{6}$/i.test(v.color)) ? v.color.toLowerCase() : '#ffffff',
      feather: clampInt(v.feather, 0, 10, 1),
      brush: clampInt(v.brush, 4, 200, 30)
    };
  }
  function hexRgb(hex) { var n = parseInt(String(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  /* tolerance 0–100 → squared RGBA distance; 100 reaches the far corner (510 = √(4·255²)) */
  function tolLimit(t) { var d = clampInt(t, 0, 100, 30) / 100 * 510; return d * d; }

  /* magic wand: 1 where the pixel is within `tol` of the clicked one. `contiguous` = only
     the 4-connected region around the click (flood), else every such pixel in the image. */
  function wand(data, w, h, x, y, tol, contiguous) {
    var n = w * h, sel = new Uint8Array(n);
    x = clampInt(x, 0, w - 1, 0); y = clampInt(y, 0, h - 1, 0);
    var p0 = y * w + x, j0 = p0 * 4, lim = tolLimit(tol);
    var r0 = data[j0], g0 = data[j0 + 1], b0 = data[j0 + 2], a0 = data[j0 + 3];
    function near(p) {
      var j = p * 4, dr = data[j] - r0, dg = data[j + 1] - g0, db = data[j + 2] - b0, da = data[j + 3] - a0;
      return dr * dr + dg * dg + db * db + da * da <= lim;
    }
    if (!contiguous) { for (var p = 0; p < n; p++) if (near(p)) sel[p] = 1; return sel; }
    /* a pixel is marked when PUSHED, so the stack never holds more than the region */
    var stack = new Int32Array(Math.min(n, 65536)), sp = 0;
    function push(q) {
      if (sp === stack.length) { var s2 = new Int32Array(Math.min(n, stack.length * 2)); s2.set(stack); stack = s2; }
      sel[q] = 1; stack[sp++] = q;
    }
    push(p0);
    while (sp) {
      var q = stack[--sp], qx = q % w;
      if (qx > 0 && !sel[q - 1] && near(q - 1)) push(q - 1);
      if (qx < w - 1 && !sel[q + 1] && near(q + 1)) push(q + 1);
      if (q >= w && !sel[q - w] && near(q - w)) push(q - w);
      if (q + w < n && !sel[q + w] && near(q + w)) push(q + w);
    }
    return sel;
  }
  function applySel(mask, sel, v) { for (var p = 0; p < sel.length; p++) if (sel[p]) mask[p] = v; }

  /* brush: a filled circle, and a stroke as dabs every half-radius so a fast drag has no gaps */
  function dab(mask, w, h, cx, cy, r, v) {
    var x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
    var y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r)), r2 = r * r;
    for (var y = y0; y <= y1; y++) {
      var dy = y - cy, row = y * w;
      for (var x = x0; x <= x1; x++) { var dx = x - cx; if (dx * dx + dy * dy <= r2) mask[row + x] = v; }
    }
  }
  function strokeLine(mask, w, h, xa, ya, xb, yb, r, v) {
    var d = Math.hypot(xb - xa, yb - ya), steps = Math.max(1, Math.ceil(d / Math.max(1, r * 0.5)));
    for (var i = 0; i <= steps; i++) dab(mask, w, h, xa + (xb - xa) * i / steps, ya + (yb - ya) * i / steps, r, v);
  }

  /* feather: two passes of a separable box blur ≈ gaussian. Uniform areas come back
     unchanged, so it softens the edge and nothing else. Returns a NEW array. */
  function blur1(src, dst, w, h, r, horiz) {
    var d = 2 * r + 1, len = horiz ? w : h, lines = horiz ? h : w;
    for (var l = 0; l < lines; l++) {
      var base = horiz ? l * w : l, step = horiz ? 1 : w, acc = 0, i;
      for (i = -r; i <= r; i++) acc += src[base + Math.min(len - 1, Math.max(0, i)) * step];
      for (i = 0; i < len; i++) {
        dst[base + i * step] = acc / d;
        acc += src[base + Math.min(len - 1, i + r + 1) * step] - src[base + Math.max(0, i - r) * step];
      }
    }
  }
  function feather(mask, w, h, r) {
    r = clampInt(r, 0, 64, 0);
    var out = new Uint8ClampedArray(mask);
    if (!r) return out;
    var tmp = new Uint8ClampedArray(mask.length);
    for (var k = 0; k < 2; k++) { blur1(out, tmp, w, h, r, true); blur1(tmp, out, w, h, r, false); }
    return out;
  }

  /* pixels × mask → RGBA. `bg` = [r,g,b] flattens onto that colour with alpha 255 (JPEG
     has no alpha — same rule as media.js's white matte); null keeps real transparency. */
  function compose(src, mask, bg) {
    var n = mask.length, out = new Uint8ClampedArray(n * 4);
    for (var p = 0, j = 0; p < n; p++, j += 4) {
      var a = mask[p] * src[j + 3] / 255;
      if (!bg) { out[j] = src[j]; out[j + 1] = src[j + 1]; out[j + 2] = src[j + 2]; out[j + 3] = a; }
      else {
        var k = a / 255;
        out[j] = src[j] * k + bg[0] * (1 - k); out[j + 1] = src[j + 1] * k + bg[1] * (1 - k);
        out[j + 2] = src[j + 2] * k + bg[2] * (1 - k); out[j + 3] = 255;
      }
    }
    return out;
  }

  /* the engine's 320² mask → the image's full size, bilinear on pixel centres. The mask is
     applied at FULL resolution; the image is never shrunk to fit the model. */
  function upscaleMask(m, sw, sh, W, H) {
    var out = new Uint8ClampedArray(W * H);
    var x0 = new Int32Array(W), x1 = new Int32Array(W), wx = new Float32Array(W), x, y;
    for (x = 0; x < W; x++) {
      var sx = Math.max(0, (x + 0.5) * sw / W - 0.5), a = Math.min(sw - 1, Math.floor(sx));
      x0[x] = a; x1[x] = Math.min(sw - 1, a + 1); wx[x] = sx - a;
    }
    for (y = 0; y < H; y++) {
      var sy = Math.max(0, (y + 0.5) * sh / H - 0.5), b = Math.min(sh - 1, Math.floor(sy));
      var r0 = b * sw, r1 = Math.min(sh - 1, b + 1) * sw, wy = sy - b, o = y * W;
      for (x = 0; x < W; x++) {
        var top = m[r0 + x0[x]] + (m[r0 + x1[x]] - m[r0 + x0[x]]) * wx[x];
        var bot = m[r1 + x0[x]] + (m[r1 + x1[x]] - m[r1 + x0[x]]) * wx[x];
        out[o + x] = top + (bot - top) * wy;
      }
    }
    return out;
  }
  var AI_SIZE = 320;                 /* U²-Netp's input (src/bgrm-engine.js) */

  /* undo snapshots: [value, count, value, count, …] */
  function rle(m) {
    var runs = [], v = m[0], c = 0;
    for (var i = 0; i < m.length; i++) { if (m[i] === v) c++; else { runs.push(v, c); v = m[i]; c = 1; } }
    if (m.length) runs.push(v, c);
    return Uint32Array.from(runs);
  }
  function unrle(runs, len) {
    var m = new Uint8ClampedArray(len), o = 0;
    for (var i = 0; i < runs.length; i += 2) { m.fill(runs[i], o, o + runs[i + 1]); o += runs[i + 1]; }
    return m;
  }
  function History(cap) { this.cap = cap || HIST_CAP; this.back = []; this.fwd = []; }
  History.prototype.push = function (snap) { this.back.push(snap); if (this.back.length > this.cap) this.back.shift(); this.fwd = []; };
  History.prototype.undo = function (cur) { if (!this.back.length) return null; this.fwd.push(cur); return this.back.pop(); };
  History.prototype.redo = function (cur) { if (!this.fwd.length) return null; this.back.push(cur); return this.fwd.pop(); };
  History.prototype.clear = function () { this.back = []; this.fwd = []; };

  /* ================= UI ================= */
  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }
  function T(s) { return SYFS.t ? SYFS.t.apply(null, arguments) : s; }
  function safeBase(name) { return (String(name || '').replace(/\.[^.]+$/, '').replace(/[^\w؀-ۿ.-]+/g, '_').slice(0, 60)) || 'image'; }
  function dlBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  var active = null;                 /* the mounted tab, for setMask() */

  function mount(panel) {
    try { panel.parentElement.style.width = '430px'; } catch (e) { /* ignore */ }
    var ui = h(
      '<div class="syf-form syf-bgrm" tabindex="-1">' +
        '<div class="syf-bgrm-drop" tabindex="0" role="button">اسحب صورة هنا أو انقر للاختيار — أو الصقها (Ctrl+V)</div>' +
        '<input type="file" hidden>' +
        '<div class="syf-bgrm-work" style="display:none">' +
          '<div class="syf-row"><button class="syf-btn" type="button" data-a="auto" title="يعمل على جهازك — لا يُرسَل شيء">✨ تلقائي (ذكاء محلّي)</button>' +
            '<button class="syf-mini" type="button" data-a="cancel" style="display:none">إلغاء</button>' +
            '<span class="syf-note-hint" style="flex:1">محلّي بالكامل — الصورة لا تغادر جهازك.</span></div>' +
          '<div class="syf-seg" data-g="tool"><button type="button" data-v="wand" class="on">العصا السحرية</button><button type="button" data-v="keep">فرشاة: أبقِ</button><button type="button" data-v="erase">فرشاة: احذف</button></div>' +
          '<div class="syf-row" data-r="wand"><span class="syf-bgrm-lbl">التفاوت</span><input type="range" min="0" max="100" data-i="tol" style="flex:1"><b class="syf-bgrm-val" data-o="tol"></b></div>' +
          '<div class="syf-seg" data-g="mode" data-r="wand"><button type="button" data-v="flood">المنطقة المتّصلة</button><button type="button" data-v="global">كل هذا اللون</button></div>' +
          '<div class="syf-row" data-r="brush" style="display:none"><span class="syf-bgrm-lbl">حجم الفرشاة</span><input type="range" min="4" max="200" data-i="brush" style="flex:1"><b class="syf-bgrm-val" data-o="brush"></b></div>' +
          '<div class="syf-row"><span class="syf-bgrm-lbl">تنعيم الحافّة</span><input type="range" min="0" max="10" data-i="feather" style="flex:1"><b class="syf-bgrm-val" data-o="feather"></b></div>' +
          '<div class="syf-bgrm-stage"><canvas></canvas></div>' +
          '<div class="syf-row">' +
            '<button class="syf-mini" type="button" data-a="undo" title="تراجع (Ctrl+Z)">↩ تراجع</button>' +
            '<button class="syf-mini" type="button" data-a="redo" title="إعادة (Ctrl+Shift+Z)">↪ إعادة</button>' +
            '<button class="syf-mini" type="button" data-a="before" aria-pressed="false">قبل / بعد</button>' +
            '<button class="syf-mini" type="button" data-a="reset">إعادة الضبط</button>' +
            '<button class="syf-mini" type="button" data-a="new">صورة أخرى</button>' +
          '</div>' +
          '<div class="syf-row"><span class="syf-bgrm-lbl">الخلفية</span>' +
            '<div class="syf-seg" data-g="bg" style="flex:1"><button type="button" data-v="none">شفّافة</button><button type="button" data-v="white">بيضاء</button><button type="button" data-v="color">لون</button></div>' +
            '<input type="color" data-i="color" title="لون الخلفية" class="syf-bgrm-color">' +
          '</div>' +
          '<div class="syf-row">' +
            '<button class="syf-btn" type="button" data-a="png" style="flex:1">تنزيل PNG</button>' +
            '<button class="syf-mini" type="button" data-a="webp">WebP</button>' +
            '<button class="syf-mini" type="button" data-a="jpg">JPG</button>' +
            '<button class="syf-mini" type="button" data-a="copy">📋 نسخ</button>' +
          '</div>' +
          '<div class="syf-row"><button class="syf-mini" type="button" data-a="edit" style="flex:1">أرسل إلى تبويب «تحرير» للقصّ والكتابة</button></div>' +
        '</div>' +
        '<div class="syf-note-hint" data-o="st" style="display:none"></div>' +
      '</div>'
    );
    panel.appendChild(ui);

    var $ = function (s) { return ui.querySelector(s); };
    var drop = $('.syf-bgrm-drop'), fileIn = $('input[type=file]'), work = $('.syf-bgrm-work'), stEl = $('[data-o="st"]');
    /* ⚠️ not in the template: a literal «image/» + «*» there opens a "comment" for
       tools/i18n-extract.js, which then skipped every msgid of this tab */
    fileIn.accept = 'image/' + '*';
    var disp = $('.syf-bgrm-stage canvas'), dx = disp.getContext('2d');
    var prefs = cleanPrefs(null), tool = 'wand', before = false;
    var W = 0, H = 0, name = 'image', src = null, mask = null;    /* full resolution */
    var small = null, pw = 0, ph = 0, xIdx = null, yIdx = null;   /* preview */
    var hist = new History(HIST_CAP), rafQ = false, ptr = null, painting = null;

    function status(s) { stEl.style.display = s ? '' : 'none'; stEl.textContent = s || ''; }
    function savePrefs() { if (SYFS.store) SYFS.store.set(PREF_KEY, prefs); }
    function seg(g, v) { ui.querySelectorAll('[data-g="' + g + '"] button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); }); }
    function showPrefs() {
      ['tol', 'brush', 'feather'].forEach(function (k) { $('[data-i="' + k + '"]').value = prefs[k]; $('[data-o="' + k + '"]').textContent = prefs[k]; });
      $('[data-i="color"]').value = prefs.color;
      seg('mode', prefs.mode); seg('bg', prefs.bg);
    }
    function setTool(v) {
      tool = v; seg('tool', v);
      ui.querySelectorAll('[data-r="wand"]').forEach(function (e) { e.style.display = v === 'wand' ? '' : 'none'; });
      ui.querySelectorAll('[data-r="brush"]').forEach(function (e) { e.style.display = v === 'wand' ? 'none' : ''; });
      render();
    }
    function bgRgb() { return prefs.bg === 'white' ? [255, 255, 255] : prefs.bg === 'color' ? hexRgb(prefs.color) : null; }

    /* ---------- load ---------- */
    function load(file) {
      if (!file) return;
      if (!(SYFS.imgkit && SYFS.imgkit.decodeAny)) { status(T('تعذّر فتح الصورة.')); return; }
      status(T('جارٍ فتح الصورة…'));
      SYFS.imgkit.decodeAny(file).then(function (d) {
        var w = d.width, hh = d.height;
        if (w * hh > MAX_PX) { SYFS.imgkit.release(d); status(T('الصورة أكبر من ٢٥ ميجابكسل — صغّرها أولاً من تبويب «تغيير الحجم».')); return; }
        var c = document.createElement('canvas'); c.width = w; c.height = hh;
        var g = c.getContext('2d'); g.drawImage(d, 0, 0); SYFS.imgkit.release(d);
        src = g.getImageData(0, 0, w, hh).data; W = w; H = hh;
        mask = new Uint8ClampedArray(w * hh).fill(255);
        name = safeBase(file.name);
        var s = Math.min(1, PREVIEW_MAX / Math.max(w, hh));
        pw = Math.max(1, Math.round(w * s)); ph = Math.max(1, Math.round(hh * s));
        disp.width = pw; disp.height = ph;
        var sc = document.createElement('canvas'); sc.width = pw; sc.height = ph;
        var sg = sc.getContext('2d'); sg.imageSmoothingQuality = 'high'; sg.drawImage(c, 0, 0, pw, ph);
        small = sg.getImageData(0, 0, pw, ph);
        xIdx = new Int32Array(pw); yIdx = new Int32Array(ph);
        for (var x = 0; x < pw; x++) xIdx[x] = Math.min(w - 1, Math.floor((x + 0.5) * w / pw));
        for (var y = 0; y < ph; y++) yIdx[y] = Math.min(hh - 1, Math.floor((y + 0.5) * hh / ph)) * w;
        hist.clear(); before = false; $('[data-a="before"]').setAttribute('aria-pressed', 'false');
        drop.style.display = 'none'; work.style.display = '';
        status(T('انقر على الخلفية بالعصا السحرية لحذفها، ثم صحّح الحوافّ بالفرشاة.'));
        render();
      }).catch(function (e) {
        status(T((e && e.message) || 'تعذّر فتح الصورة.'));
      });
    }

    /* ---------- preview ---------- */
    function render() {
      if (rafQ || !src) return;
      rafQ = true;
      requestAnimationFrame(function () { rafQ = false; paint(); });
    }
    function paint() {
      if (!src) return;
      if (before) { dx.putImageData(small, 0, 0); return; }
      var pm = new Uint8ClampedArray(pw * ph);
      for (var y = 0, p = 0; y < ph; y++) { var row = yIdx[y]; for (var x = 0; x < pw; x++, p++) pm[p] = mask[row + xIdx[x]]; }
      var f = prefs.feather ? feather(pm, pw, ph, Math.max(1, Math.round(prefs.feather * pw / W))) : pm;
      dx.putImageData(new ImageData(compose(small.data, f, bgRgb()), pw, ph), 0, 0);
      if (ptr && tool !== 'wand') {
        dx.save(); dx.beginPath(); dx.arc(ptr.x, ptr.y, prefs.brush / 2 * viewK(), 0, Math.PI * 2);
        dx.lineWidth = 1.5; dx.strokeStyle = 'rgba(0,0,0,.55)'; dx.stroke();
        dx.lineWidth = 1; dx.strokeStyle = 'rgba(255,255,255,.9)'; dx.stroke(); dx.restore();
      }
    }
    /* preview px per CSS px — the brush slider is in screen pixels */
    function viewK() { var r = disp.getBoundingClientRect(); return r.width ? pw / r.width : 1; }
    function toImg(e) {
      var r = disp.getBoundingClientRect();
      return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height,
               px: (e.clientX - r.left) * pw / r.width, py: (e.clientY - r.top) * ph / r.height };
    }

    /* ---------- edits ---------- */
    function snap() { hist.push(rle(mask)); }
    function step(dir) {
      if (!mask) return;
      var s = dir < 0 ? hist.undo(rle(mask)) : hist.redo(rle(mask));
      if (s) { mask = unrle(s, W * H); render(); }
    }
    disp.addEventListener('pointerdown', function (e) {
      if (!src || e.button !== 0) return;
      e.preventDefault(); ui.focus({ preventScroll: true });
      var p = toImg(e);
      if (tool === 'wand') {
        snap();
        applySel(mask, wand(src, W, H, Math.floor(p.x), Math.floor(p.y), prefs.tol, prefs.mode === 'flood'), 0);
        render(); return;
      }
      snap();
      var r = prefs.brush / 2 * viewK() * W / pw, v = tool === 'keep' ? 255 : 0;
      dab(mask, W, H, p.x, p.y, r, v);
      painting = { x: p.x, y: p.y, r: r, v: v };
      try { disp.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      render();
    });
    disp.addEventListener('pointermove', function (e) {
      if (!src) return;
      var p = toImg(e);
      ptr = { x: p.px, y: p.py };
      if (painting) { strokeLine(mask, W, H, painting.x, painting.y, p.x, p.y, painting.r, painting.v); painting.x = p.x; painting.y = p.y; }
      if (painting || tool !== 'wand') render();
    });
    function endPaint() { painting = null; }
    disp.addEventListener('pointerup', endPaint);
    disp.addEventListener('pointercancel', endPaint);
    disp.addEventListener('pointerleave', function () { ptr = null; if (tool !== 'wand') render(); });

    /* ---------- export ---------- */
    function fullCanvas(flatten) {
      var bg = bgRgb() || (flatten ? [255, 255, 255] : null);
      var f = prefs.feather ? feather(mask, W, H, prefs.feather) : mask;
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      c.getContext('2d').putImageData(new ImageData(compose(src, f, bg), W, H), 0, 0);
      return c;
    }
    function save(type, ext) {
      if (!src) return;
      status(T('جارٍ التجهيز…'));
      var c = fullCanvas(type === 'image/jpeg');
      c.toBlob(function (b) {
        if (!b) { status(T('تعذّر إنشاء الصورة')); return; }
        dlBlob(b, name + '-nobg.' + ext); status('');
      }, type, type === 'image/png' ? undefined : 0.92);
    }

    /* ---------- wiring ---------- */
    drop.addEventListener('click', function () { fileIn.click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
    fileIn.addEventListener('change', function () { load(fileIn.files && fileIn.files[0]); fileIn.value = ''; });
    ['dragenter', 'dragover'].forEach(function (t) { ui.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ui.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    ui.addEventListener('drop', function (e) {
      e.preventDefault(); drop.classList.remove('over');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) load(f);
    });
    ui.addEventListener('paste', function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && /^image\//.test(items[i].type)) { e.preventDefault(); load(items[i].getAsFile()); return; }
      }
    });

    ui.querySelectorAll('.syf-seg').forEach(function (s) {
      s.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        var g = s.dataset.g;
        if (g === 'tool') { setTool(b.dataset.v); return; }
        prefs[g] = b.dataset.v; seg(g, b.dataset.v); savePrefs(); render();
      });
    });
    ['tol', 'brush', 'feather'].forEach(function (k) {
      $('[data-i="' + k + '"]').addEventListener('input', function () {
        prefs[k] = +this.value; $('[data-o="' + k + '"]').textContent = prefs[k]; render();
      });
      $('[data-i="' + k + '"]').addEventListener('change', savePrefs);
    });
    $('[data-i="color"]').addEventListener('input', function () {
      prefs.color = cleanPrefs({ color: this.value }).color; prefs.bg = 'color'; seg('bg', 'color'); render();
    });
    $('[data-i="color"]').addEventListener('change', savePrefs);

    /* ---------- automatic mode: the engine frame (src/bgrm-engine.js, §5.32) ----------
     * An extension page in a zero-size iframe — wasm runs under OUR CSP, not the site's.
     * ⛔ One private MessageChannel: the pixels go down port1→port2 and the mask comes back
     *    on it. Nothing is posted to or read from `window` messages, which the host page
     *    shares. The frame lives in this tab (session cached across runs) and dies with it;
     *    «إلغاء» removes it, which is the only real way to stop wasm mid-run. */
    var eng = null, job = 0;
    function engine() {
      if (eng) return eng;
      var fr = document.createElement('iframe');
      fr.className = 'syf-bgrm-engine'; fr.tabIndex = -1; fr.setAttribute('aria-hidden', 'true');
      fr.src = chrome.runtime.getURL('bgrm-engine.html');
      var ch = new MessageChannel(), e = { frame: fr, port: ch.port1, seq: 0, pend: {} };
      e.ready = new Promise(function (res, rej) {
        /* a frame the site's CSP (or anything else) refuses never loads and never says so */
        var to = setTimeout(function () { rej(new Error('engine-timeout')); }, 20000);
        ch.port1.onmessage = function (ev) {
          var m = ev.data || {};
          if (m.op === 'ready') { clearTimeout(to); res(m); return; }
          var p = e.pend[m.id]; if (!p) return;
          if (m.stage) { p.stage(m.stage); return; }
          delete e.pend[m.id];
          if (m.ok && m.mask instanceof ArrayBuffer) p.res(m.mask); else p.rej(new Error(m.error || 'engine'));
        };
        fr.addEventListener('load', function () {
          try { fr.contentWindow.postMessage({ type: 'syfs-bgrm-port' }, new URL(fr.src).origin, [ch.port2]); }
          catch (x) { clearTimeout(to); rej(x); }
        });
      });
      e.ready.catch(function () { /* surfaced by the run */ });
      ui.appendChild(fr);
      eng = e;
      return e;
    }
    function killEngine() {
      if (!eng) return;
      Object.keys(eng.pend).forEach(function (k) { eng.pend[k].rej(new Error('cancelled')); });
      try { eng.port.close(); } catch (x) { /* ignore */ }
      eng.frame.remove(); eng = null;
    }
    /* the original pixels at 320² (not the current mask — the model sees the photo) */
    function modelInput() {
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      c.getContext('2d').putImageData(new ImageData(src, W, H), 0, 0);
      var s = document.createElement('canvas'); s.width = AI_SIZE; s.height = AI_SIZE;
      var g = s.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, AI_SIZE, AI_SIZE);
      return g.getImageData(0, 0, AI_SIZE, AI_SIZE).data;
    }
    function busyUi(on) {
      var a = $('[data-a="auto"]'), c = $('[data-a="cancel"]');
      a.disabled = on; c.style.display = on ? '' : 'none';
    }
    function autoRun() {
      if (!src || eng && Object.keys(eng.pend).length) return;
      var my = ++job, t0 = Date.now(), px = modelInput();
      busyUi(true); status(T('جارٍ تجهيز المحرّك…'));
      var e = engine();
      e.ready.then(function (r) {
        if (r && r.simd === false) throw new Error('no-simd');
        return new Promise(function (res, rej) {
          var id = ++e.seq;
          e.pend[id] = { res: res, rej: rej, stage: function (s) { if (my === job) status(s === 'run' ? T('جارٍ التحليل…') : T('جارٍ تجهيز المحرّك…')); } };
          e.port.postMessage({ op: 'run', id: id, w: AI_SIZE, h: AI_SIZE, px: px.buffer }, [px.buffer]);
        });
      }).then(function (buf) {
        if (my !== job || !src) return;
        var m = upscaleMask(new Uint8Array(buf), AI_SIZE, AI_SIZE, W, H);
        snap(); mask = m; render();
        status(T('تمّ في {0} ث — صحّح الحوافّ بالفرشاة إن لزم.', ((Date.now() - t0) / 1000).toFixed(1)));
      }).catch(function (err) {
        if (my !== job) return;
        var k = err && err.message;
        if (k === 'cancelled') status(T('أُلغي.'));
        else if (k === 'no-simd') status(T('المتصفّح لا يدعم WebAssembly SIMD (كروم ٩١ فأحدث) — استعمل العصا السحرية والفرشاة.'));
        else if (k === 'engine-timeout') { killEngine(); status(T('تعذّر تشغيل المحرّك في هذه الصفحة — افتح الأداة من مساحة العمل وجرّب هناك.')); }
        else status(T('تعذّر حذف الخلفية تلقائياً: {0}', k || T('خطأ')));
      }).then(function () { if (my === job) busyUi(false); });
    }

    var ACT = {
      auto: function () { autoRun(); },
      cancel: function () { job++; killEngine(); busyUi(false); status(T('أُلغي.')); },
      undo: function () { step(-1); },
      redo: function () { step(1); },
      before: function (b) { before = !before; b.setAttribute('aria-pressed', String(before)); b.classList.toggle('on', before); render(); },
      reset: function () { if (!mask) return; snap(); mask.fill(255); render(); },
      'new': function () { fileIn.click(); },
      png: function () { save('image/png', 'png'); },
      webp: function () { save('image/webp', 'webp'); },
      jpg: function () { save('image/jpeg', 'jpg'); },
      copy: function () {
        if (!src) return;
        if (!(navigator.clipboard && window.ClipboardItem)) { status(T('الحافظة غير مدعومة (يحتاج HTTPS)')); return; }
        var c = fullCanvas(false);
        /* the blob goes in as a promise so the click's activation still covers write() */
        var png = new Promise(function (res, rej) { c.toBlob(function (b) { if (b) res(b); else rej(new Error('blob')); }, 'image/png'); });
        navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
          .then(function () { status(T('نُسخت الصورة ✓')); }, function () { status(T('تعذّر النسخ')); });
      },
      /* media.js's «تحرير» tab consumes SYFS._imgToEdit when it mounts (the same hand-over
         the screenshot tool uses) — so: leave the picture there and click that tab */
      edit: function () {
        if (!src) return;
        SYFS._imgToEdit = fullCanvas(false).toDataURL('image/png');
        var bar = panel.parentNode && panel.parentNode.querySelector('.syf-tabs');
        var first = bar && bar.querySelector('.syf-tab');
        if (first) first.click(); else status(T('افتح تبويب «تحرير» — الصورة بانتظارك هناك.'));
      }
    };
    ui.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]'); if (!b || b.disabled || !ACT[b.dataset.a]) return;
      ACT[b.dataset.a](b);
    });

    /* keys by event.code (an Arabic layout has no «[» key-value); a key we use stops here so
       the rail's hotkeys and the page never see it. Typing in a field is left alone. */
    ui.addEventListener('keydown', function (e) {
      var t = e.target && e.target.tagName;
      if ((t === 'INPUT' && e.target.type !== 'range') || t === 'TEXTAREA') return;
      var mod = e.ctrlKey || e.metaKey, used = true;
      if (mod && e.code === 'KeyZ') step(e.shiftKey ? 1 : -1);
      else if (mod && e.code === 'KeyY') step(1);
      else if (!mod && !e.altKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
        prefs.brush = clampInt(prefs.brush + (e.code === 'BracketRight' ? 5 : -5), 4, 200, 30);
        showPrefs(); savePrefs(); render();
      } else used = false;
      if (used) { e.preventDefault(); e.stopPropagation(); }
    });

    if (SYFS.store) SYFS.store.get(PREF_KEY, null).then(function (v) { prefs = cleanPrefs(v); showPrefs(); render(); });
    showPrefs();

    active = {
      panel: panel,
      setMask: function (alpha) {
        if (!src || !alpha || alpha.length !== W * H) return false;
        snap(); mask = new Uint8ClampedArray(alpha); render(); return true;
      }
    };
  }

  SYFS.bgrm = {
    PREF_KEY: PREF_KEY,
    mount: mount,
    /* the AI step: an alpha mask the size of the open image ⇒ one undoable edit */
    setMask: function (alpha) { return !!(active && active.panel.isConnected && active.setMask(alpha)); },
    applyMask: compose,
    _p: { cleanPrefs: cleanPrefs, tolLimit: tolLimit, wand: wand, applySel: applySel, dab: dab, strokeLine: strokeLine,
          feather: feather, compose: compose, rle: rle, unrle: unrle, History: History, hexRgb: hexRgb, HIST_CAP: HIST_CAP, MAX_PX: MAX_PX,
          upscaleMask: upscaleMask, AI_SIZE: AI_SIZE }
  };
}());
