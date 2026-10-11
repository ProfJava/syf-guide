/* SYF Studio Lab — the «تحويل وتحسين» group. ONE pipeline (decode → resize → watermark →
 * encode), five pages that each lead with their own job:
 *   convert  · تحويل الصيغة     — the format first
 *   compress · ضغط الصور        — quality or a size target, with the saving per file
 *   resize   · تغيير المقاس      — exact sizes, social presets, fit/fill/stretch
 *   watermark· علامة مائية       — text or logo, position, opacity
 *   batch    · معالجة مجمّعة     — all of it at once + renaming
 * Engines: lib/imgkit.js (decode/encode/target size/ZIP) and lib/canvas-pdf.js (PDF).
 * Nothing leaves the device. */
(function () {
  'use strict';
  var SL = window.SL, I = SL.icon, K = function () { return window.SYFS && SYFS.imgkit; };

  var FORMATS = [['webp', 'WebP'], ['jpeg', 'JPG'], ['png', 'PNG'], ['avif', 'AVIF'], ['gif', 'GIF'], ['bmp', 'BMP'], ['ico', 'ICO'], ['tiff', 'TIFF'], ['pdf', 'PDF']];
  var SOCIAL = [
    ['ig-sq', 'إنستغرام مربع', 1080, 1080], ['ig-pt', 'إنستغرام عمودي', 1080, 1350], ['story', 'ستوري / ريلز', 1080, 1920],
    ['fb-cover', 'غلاف فيسبوك', 1640, 624], ['x-post', 'منشور X', 1600, 900], ['yt-thumb', 'صورة يوتيوب', 1280, 720],
    ['in-post', 'منشور لينكدإن', 1200, 627], ['wa-dp', 'صورة واتساب', 640, 640], ['hd', 'Full HD', 1920, 1080]
  ];
  var DEF = {
    fmt: 'webp', q: 82, target: false, targetKB: 200,
    rmode: 'none', longest: 1920, percent: 50, w: 1080, h: 1080, fit: 'contain', fill: '#ffffff', upscale: false,
    wm: false, wmKind: 'text', wmText: '© SYF', wmSize: 5, wmOp: 45, wmPos: 'br', wmColor: '#ffffff', wmTile: false,
    rename: '{name}', pdfMerge: true, pdfA4: false, keepTransparency: true
  };

  /* ---------------- the pipeline ---------------- */
  async function processFile(file, o, logo) {
    var kit = K();
    var bmp = file.__canvas || await kit.decodeAny(file);
    var src = bmp, sw = src.width, sh = src.height, cv;
    /* 1) size */
    if (o.rmode === 'none') cv = drawTo(src, sw, sh, 0, 0, sw, sh);
    else if (o.rmode === 'longest' || o.rmode === 'percent') {
      var s = o.rmode === 'percent' ? o.percent / 100 : o.longest / Math.max(sw, sh);
      if (!o.upscale) s = Math.min(1, s);
      var f = kit.fitCanvas(sw * s, sh * s); cv = drawTo(src, f.w, f.h, 0, 0, f.w, f.h);
    } else {
      var W = Math.max(1, o.w | 0), H = Math.max(1, o.h | 0);
      if (o.fit === 'stretch') cv = drawTo(src, W, H, 0, 0, W, H);
      else {
        var k = o.fit === 'cover' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
        var dw = sw * k, dh = sh * k;
        cv = drawTo(src, W, H, (W - dw) / 2, (H - dh) / 2, dw, dh, o.fit === 'contain' ? o.fill : null);
      }
    }
    if (bmp !== file.__canvas) kit.release(bmp);
    /* 2) watermark */
    if (o.wm) watermark(cv, o, logo);
    /* 3) encode */
    var fmt = o.fmt, blob, q = o.q / 100, ext;
    if (fmt === 'pdf') return { canvas: cv, pdf: true };
    if (fmt === 'avif') {
      blob = await SL.toBlob(cv, 'image/avif', q);
      if (!blob || blob.type !== 'image/avif') { fmt = 'webp'; blob = null; }
    }
    if (!blob) {
      if (o.target && (fmt === 'jpeg' || fmt === 'webp' || fmt === 'png')) {
        var r = await kit.encodeToTarget(cv, fmt, o.targetKB * 1024); blob = r.blob; cv = r.canvas;
      } else { var e = await kit.encodeAs(cv, fmt, q); blob = e.blob; ext = e.ext; }
    }
    ext = ext || ({ jpeg: 'jpg' })[fmt] || fmt;
    return { blob: blob, canvas: cv, ext: ext };
  }
  function drawTo(src, W, H, x, y, w, h, fill) {
    var c = document.createElement('canvas'); c.width = Math.round(W); c.height = Math.round(H);
    var g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    if (fill) { g.fillStyle = fill; g.fillRect(0, 0, c.width, c.height); }
    g.drawImage(src, x, y, w, h); return c;
  }
  function watermark(cv, o, logo) {
    var g = cv.getContext('2d'), W = cv.width, H = cv.height, m = Math.round(Math.min(W, H) * 0.03);
    g.save(); g.globalAlpha = o.wmOp / 100;
    var bw, bh, draw;
    if (o.wmKind === 'logo' && logo) {
      bw = W * o.wmSize * 3 / 100; bh = bw * logo.height / logo.width;
      draw = function (x, y) { g.drawImage(logo, x, y, bw, bh); };
    } else {
      var size = Math.max(10, Math.round(Math.min(W, H) * o.wmSize / 100));
      g.font = '700 ' + size + 'px "IBM Plex Sans Arabic", Tahoma, sans-serif'; g.textBaseline = 'top';
      bw = g.measureText(o.wmText).width; bh = size * 1.2;
      g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = size * 0.12;
      draw = function (x, y) { g.fillStyle = o.wmColor; g.fillText(o.wmText, x, y); };
    }
    if (o.wmTile) {
      g.translate(W / 2, H / 2); g.rotate(-Math.PI / 6); g.translate(-W, -H);
      for (var y = 0; y < H * 2; y += bh * 3.2) for (var x = 0; x < W * 2; x += bw * 1.8) draw(x, y);
    } else {
      var px = /l/.test(o.wmPos) ? m : (/r/.test(o.wmPos) ? W - bw - m : (W - bw) / 2);
      var py = /t/.test(o.wmPos) ? m : (/b/.test(o.wmPos) ? H - bh - m : (H - bh) / 2);
      draw(px, py);
    }
    g.restore();
  }
  function outName(pattern, file, i, ext) {
    var base = SL.base(file.name);
    var n = String(pattern || '{name}').replace(/\{name\}/g, base).replace(/\{n\}/g, String(i + 1).padStart(2, '0')).replace(/\{date\}/g, SL.stamp());
    return (n.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || base) + '.' + ext;
  }

  /* ---------------- the page (shared by the five tools) ---------------- */
  function page(kind) {
    return function (body, ctx) {
      var o = Object.assign({}, DEF, SL.LS.get('q_' + kind, {}));
      if (kind === 'convert') o.rmode = o.rmode || 'none';
      if (kind === 'compress' && !SL.LS.get('q_' + kind, null)) { o.fmt = 'jpeg'; o.target = true; }
      if (kind === 'resize' && !SL.LS.get('q_' + kind, null)) { o.rmode = 'exact'; o.fit = 'cover'; o.fmt = 'jpeg'; o.q = 90; }
      if (kind === 'watermark' && !SL.LS.get('q_' + kind, null)) { o.wm = true; o.fmt = 'jpeg'; o.q = 92; }
      var save = function () { SL.LS.set('q_' + kind, o); schedulePv(); };
      var files = [], results = [], logo = null;

      var grid = SL.h('<div class="grid2"><div class="stack" data-left></div><div data-right></div></div>');
      body.appendChild(grid);
      var left = grid.querySelector('[data-left]'), right = grid.querySelector('[data-right]');

      var dz = SL.dropzone({ multiple: true, accept: 'image/*,.svg', title: 'اسحب الصور هنا أو انقر للاختيار', hint: 'صورة واحدة أو مئات — PNG · JPG · WebP · GIF · BMP · ICO · AVIF · SVG · كل المعالجة على جهازك',
        onFiles: function (fs) { add(fs); } });
      left.appendChild(dz);
      var useDoc = SL.button('استخدام الصورة المفتوحة', 'image', 'sm', function () { var d = SL.doc(); if (!d) return; var f = new File([], d.name); f.__canvas = d.canvas; f.__size = d.meta.size || 0; add([f]); });
      var listCard = SL.h('<div class="card"><h3>' + I('batch', 's') + '<span>الملفات</span><span class="sp" style="flex:1"></span></h3><div class="list"></div><div class="row end" data-acts style="margin-top:12px"></div></div>');
      listCard.querySelector('h3').appendChild(useDoc);
      var clearBtn = SL.button('مسح القائمة', 'trash', 'sm ghost', function () { files = []; results = []; paintList(); });
      listCard.querySelector('h3').appendChild(clearBtn);
      left.appendChild(listCard);
      var list = listCard.querySelector('.list'), acts = listCard.querySelector('[data-acts]');
      var total = SL.h('<div class="saving" hidden><span></span><b class="num"></b></div>');
      left.appendChild(total);

      /* live preview: the FIRST file through the real pipeline — encoded, then decoded back,
         so a low JPG quality shows its blocks and the size is the size you will get */
      var pvCard = SL.h('<div class="card" hidden><h3>' + I('eye', 's') + '<span>معاينة مباشرة</span><span style="flex:1"></span><span class="note" data-info></span></h3><div class="preview checker" style="min-height:200px"><img alt=""></div></div>');
      left.appendChild(pvCard);
      var pvT = 0, pvGen = 0, pvUrl = null;
      function pvSource() {
        if (files.length) return files[0];
        var d = SL.doc(); if (!d) return null;
        var f = new File([], d.name); f.__canvas = d.canvas; f.__size = d.meta.size || 0; return f;
      }
      function schedulePv() { clearTimeout(pvT); pvT = setTimeout(runPv, 350); }
      async function runPv() {
        var f = pvSource(); if (!f || o.fmt === 'pdf') { pvCard.hidden = true; return; }
        var mine = ++pvGen;
        pvCard.querySelector('[data-info]').textContent = SL.t('يحسب…');
        try {
          var r = await processFile(f, o, logo);
          if (mine !== pvGen || !r.blob) return;
          if (pvUrl) URL.revokeObjectURL(pvUrl); pvUrl = URL.createObjectURL(r.blob);
          pvCard.hidden = false; pvCard.querySelector('img').src = pvUrl;
          var before = f.__canvas ? (f.__size || 0) : f.size;
          pvCard.querySelector('[data-info]').textContent = SL.dims(r.canvas.width, r.canvas.height) + ' · ' + SL.fmtBytes(r.blob.size) +
            (before ? ' · ' + SL.ltr((r.blob.size <= before ? '−' : '+') + Math.abs(Math.round((1 - r.blob.size / before) * 100)) + '%') : '');
        } catch (e) { if (mine === pvGen) pvCard.querySelector('[data-info]').textContent = SL.t('تعذّرت المعاينة'); }
      }

      function add(fs) {
        fs.forEach(function (f) { if (f.__canvas || /^image\//.test(f.type) || /\.(svg|ico|heic|heif|avif)$/i.test(f.name)) files.push(f); });
        results = []; paintList(); schedulePv();
      }
      function paintList() {
        list.textContent = ''; acts.textContent = ''; total.hidden = true;
        useDoc.hidden = !SL.doc();
        listCard.hidden = !files.length && !SL.doc();
        if (!files.length) { list.appendChild(SL.h('<div class="note">لا ملفات بعد.</div>')); return; }
        files.forEach(function (f, i) {
          var it = SL.h('<div class="fileitem"><img alt=""><div class="meta"><b></b><span></span></div><span class="res"></span></div>');
          if (f.__canvas) it.querySelector('img').src = f.__canvas.toDataURL('image/jpeg', .5);
          else { var u = URL.createObjectURL(f); it.querySelector('img').src = u; it.querySelector('img').onload = function () { URL.revokeObjectURL(u); }; }
          /* i18n-dyn: the user's file name */
          it.querySelector('b').textContent = f.name;
          it.querySelector('.meta span').textContent = SL.fmtBytes(f.__canvas ? (f.__size || NaN) : f.size);
          var r = results[i];
          if (r) {
            var res = it.querySelector('.res');
            if (r.err) { res.textContent = '✗ ' + SL.t(r.err); res.classList.add('bad'); }
            else {
              var before = f.__canvas ? (f.__size || 0) : f.size;
              it.querySelector('.meta span').textContent = (before ? SL.fmtBytes(before) + ' ← ' : '') + SL.fmtBytes(r.blob ? r.blob.size : 0) + ' · ' + SL.dims(r.canvas.width, r.canvas.height);
              if (before && r.blob) { var p = Math.round((1 - r.blob.size / before) * 100); res.textContent = SL.ltr((p >= 0 ? '−' : '+') + Math.abs(p) + '%'); res.classList.toggle('bad', p < 0); }
              else res.textContent = '✓';
              var dl = SL.button('', 'download', 'sm icon ghost tiponly', function () { SL.download(r.blob, r.name); }); dl.dataset.tip = SL.t('تنزيل'); dl.setAttribute('aria-label', SL.t('تنزيل'));
              if (r.blob) it.appendChild(dl);
            }
          }
          list.appendChild(it);
        });
        var ok = results.filter(function (r) { return r && r.blob; });
        if (ok.length) {
          var before = 0, after = 0;
          files.forEach(function (f, i) { var r = results[i]; if (r && r.blob) { before += f.__canvas ? (f.__size || 0) : f.size; after += r.blob.size; } });
          if (before) {
            total.hidden = false; total.classList.toggle('bad', after > before);
            total.querySelector('span').textContent = after <= before ? SL.t('وفّرت {0} من الحجم', SL.pct((1 - after / before) * 100)) : SL.t('الملفات صارت أكبر — جرّب جودة أقل أو صيغة WebP');
            total.querySelector('b').textContent = SL.fmtBytes(before) + ' ← ' + SL.fmtBytes(after);
          }
          if (ok.length > 1) acts.appendChild(SL.button('تنزيل الكل (ZIP)', 'download', 'pri', function () {
            K().zipWrite(ok.map(function (r) { return { name: r.name, blob: r.blob }; })).then(function (z) { SL.download(z, kind + '-' + SL.stamp() + '.zip'); });
          }));
          if (ok.length === 1) acts.appendChild(SL.button('تنزيل', 'download', 'pri', function () { SL.download(ok[0].blob, ok[0].name); }));
          acts.appendChild(SL.button('فتح في المحرر', 'editor', '', function () { SL.setDoc(ok[0].canvas, ok[0].name); SL.open('editor'); }));
          acts.appendChild(SL.button('نسخ', 'copy', '', function () { SL.copyCanvas(ok[0].canvas); }));
        }
      }

      /* ---- options ---- */
      var opts = SL.h('<div class="card stack"></div>');
      right.appendChild(opts);
      function h3(t, ic) { var e = SL.h('<h3>' + I(ic, 's') + '<span></span></h3>'); e.querySelector('span').textContent = t; return e; }
      function sec(t, ic) { var s = SL.h('<div class="stack"></div>'); s.appendChild(h3(t, ic)); opts.appendChild(s); return s; }

      function fmtSection(open) {
        var s = sec('الصيغة', 'convert');
        var segEl = SL.seg(FORMATS.filter(function (f) { return kind === 'convert' || kind === 'batch' || ['webp', 'jpeg', 'png', 'avif'].indexOf(f[0]) >= 0; }), o.fmt, function (v) { o.fmt = v; save(); paintFmt(); });
        s.appendChild(segEl);
        var q = SL.slider('الجودة', 30, 100, 1, o.q, '٪', function (v) { o.q = v; save(); }); s.appendChild(q);
        var tgt = SL.h('<label class="check"><input type="checkbox" class="sw"><span>حجم مستهدف لكل صورة</span></label>');
        var tin = SL.h('<div class="row"><input class="in num" type="number" min="5" max="20000" style="width:120px"><span class="note">كيلوبايت</span></div>');
        tgt.querySelector('input').checked = o.target; tin.querySelector('input').value = o.targetKB;
        tgt.querySelector('input').addEventListener('change', function (e) { o.target = e.target.checked; save(); paintFmt(); });
        tin.querySelector('input').addEventListener('input', function (e) { o.targetKB = Math.max(5, Number(e.target.value) || 200); save(); });
        s.appendChild(tgt); s.appendChild(tin);
        var pdfo = SL.h('<div class="stack"></div>');
        var m1 = SL.h('<label class="check"><input type="checkbox" class="sw"><span>دمج كل الصور في ملف PDF واحد</span></label>'); m1.querySelector('input').checked = o.pdfMerge;
        m1.querySelector('input').addEventListener('change', function (e) { o.pdfMerge = e.target.checked; save(); });
        var m2 = SL.h('<label class="check"><input type="checkbox" class="sw"><span>صفحات A4 بهوامش</span></label>'); m2.querySelector('input').checked = o.pdfA4;
        m2.querySelector('input').addEventListener('change', function (e) { o.pdfA4 = e.target.checked; save(); });
        pdfo.appendChild(m1); pdfo.appendChild(m2); s.appendChild(pdfo);
        var hint = SL.h('<div class="note"></div>'); s.appendChild(hint);
        function paintFmt() {
          var lossy = ['jpeg', 'webp', 'avif', 'pdf'].indexOf(o.fmt) >= 0;
          q.hidden = !lossy || (o.target && o.fmt !== 'pdf'); tgt.hidden = ['jpeg', 'webp', 'png'].indexOf(o.fmt) < 0; tin.hidden = tgt.hidden || !o.target;
          pdfo.hidden = o.fmt !== 'pdf';
          hint.textContent = ({ webp: 'WebP: أصغر حجماً بجودة ممتازة — الأنسب للمواقع.', jpeg: 'JPG: للصور الفوتوغرافية — بلا شفافية (تُملأ بالأبيض).', png: 'PNG: بلا فقد، يحفظ الشفافية — حجمه أكبر.',
            avif: 'AVIF: الأصغر حجماً — إن لم يدعمه المتصفّح يُحفظ WebP.', gif: 'GIF: ٢٥٦ لوناً — للرسومات البسيطة.', bmp: 'BMP: بلا ضغط.', ico: 'ICO: أيقونة بمقاسات ١٦ و٣٢ و٤٨ و٢٥٦.',
            tiff: 'TIFF: للطباعة والأرشفة.', pdf: 'PDF: صفحة لكل صورة.' })[o.fmt] || '';
        }
        paintFmt();
        void open;
      }
      function sizeSection() {
        var s = sec('المقاس', 'resize');
        var modes = [['none', 'كما هو'], ['longest', 'أطول ضلع'], ['percent', 'نسبة'], ['exact', 'مقاس محدّد']];
        s.appendChild(SL.seg(modes, o.rmode, function (v) { o.rmode = v; save(); paint(); }));
        var lg = SL.slider('أطول ضلع', 64, 8000, 1, o.longest, 'px', function (v) { o.longest = v; save(); });
        var pc = SL.slider('النسبة', 5, 300, 1, o.percent, '٪', function (v) { o.percent = v; save(); });
        var ex = SL.h('<div class="stack"><div class="presetrow row"></div><div class="row"><input class="in num" type="number" min="1" max="8000" style="width:110px"><span>×</span><input class="in num" type="number" min="1" max="8000" style="width:110px"><span class="note">px</span></div><div data-fit></div><div class="row" data-fill><span class="note">لون الهوامش</span><input type="color"></div></div>');
        SOCIAL.forEach(function (p) { ex.querySelector('.presetrow').appendChild(SL.button(p[1], '', 'sm', function () { o.w = p[2]; o.h = p[3]; save(); wi.value = p[2]; hi.value = p[3]; })); });
        var wi = ex.querySelectorAll('input')[0], hi = ex.querySelectorAll('input')[1];
        wi.value = o.w; hi.value = o.h;
        wi.addEventListener('input', function () { o.w = Number(wi.value) || 1; save(); }); hi.addEventListener('input', function () { o.h = Number(hi.value) || 1; save(); });
        ex.querySelector('[data-fit]').appendChild(SL.seg([['cover', 'ملء وقصّ', 'crop'], ['contain', 'احتواء بهوامش', 'fit'], ['stretch', 'مطّ', 'resize']], o.fit, function (v) { o.fit = v; save(); paint(); }));
        var fill = ex.querySelector('[data-fill] input'); fill.value = o.fill; fill.addEventListener('input', function () { o.fill = fill.value; save(); });
        var up = SL.h('<label class="check"><input type="checkbox" class="sw"><span>السماح بالتكبير</span></label>'); up.querySelector('input').checked = o.upscale;
        up.querySelector('input').addEventListener('change', function (e) { o.upscale = e.target.checked; save(); });
        [lg, pc, ex, up].forEach(function (e) { s.appendChild(e); });
        function paint() { lg.hidden = o.rmode !== 'longest'; pc.hidden = o.rmode !== 'percent'; ex.hidden = o.rmode !== 'exact'; up.hidden = o.rmode !== 'longest' && o.rmode !== 'percent'; ex.querySelector('[data-fill]').hidden = o.fit !== 'contain'; }
        paint();
      }
      function wmSection() {
        var s = sec('العلامة المائية', 'watermark');
        if (kind !== 'watermark') {
          var on = SL.h('<label class="check"><input type="checkbox" class="sw"><span>إضافة علامة مائية</span></label>'); on.querySelector('input').checked = o.wm;
          on.querySelector('input').addEventListener('change', function (e) { o.wm = e.target.checked; save(); paint(); }); s.appendChild(on);
        }
        var box = SL.h('<div class="stack"></div>'); s.appendChild(box);
        box.appendChild(SL.seg([['text', 'نص', 'text'], ['logo', 'شعار', 'image']], o.wmKind, function (v) { o.wmKind = v; save(); paint(); }));
        var tx = SL.h('<div class="row"><input class="in" style="flex:1"><input type="color"></div>');
        tx.querySelector('.in').value = o.wmText; tx.querySelector('[type=color]').value = o.wmColor;
        tx.querySelector('.in').addEventListener('input', function (e) { o.wmText = e.target.value; save(); });
        tx.querySelector('[type=color]').addEventListener('input', function (e) { o.wmColor = e.target.value; save(); });
        var lg = SL.button('اختر الشعار (PNG شفاف)', 'upload', 'sm', function () { SL.pickFiles('image/*').then(function (f) { if (f[0]) SL.fileToCanvas(f[0]).then(function (c) { logo = c; lg.querySelector('.lbl').textContent = SL.t('الشعار: {0}', f[0].name); schedulePv(); }); }); });
        box.appendChild(tx); box.appendChild(lg);
        box.appendChild(SL.slider('الحجم', 1, 25, 1, o.wmSize, '٪', function (v) { o.wmSize = v; save(); }));
        box.appendChild(SL.slider('الشفافية', 5, 100, 1, o.wmOp, '٪', function (v) { o.wmOp = v; save(); }));
        var posWrap = SL.h('<div class="field"><label>الموضع</label><div class="anchor"></div></div>');
        [['tl', 'tc', 'tr'], ['ml', 'mc', 'mr'], ['bl', 'bc', 'br']].forEach(function (row) { row.forEach(function (p) {
          var b = SL.h('<button type="button"></button>'); b.title = p; b.classList.toggle('on', o.wmPos === p);
          b.addEventListener('click', function () { o.wmPos = p; save(); [].forEach.call(posWrap.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); }); });
          posWrap.querySelector('.anchor').appendChild(b);
        }); });
        box.appendChild(posWrap);
        var tile = SL.h('<label class="check"><input type="checkbox" class="sw"><span>تكرار مائل على كامل الصورة</span></label>'); tile.querySelector('input').checked = o.wmTile;
        tile.querySelector('input').addEventListener('change', function (e) { o.wmTile = e.target.checked; save(); });
        box.appendChild(tile);
        function paint() { box.hidden = !o.wm; tx.hidden = o.wmKind !== 'text'; lg.hidden = o.wmKind !== 'logo'; }
        paint();
      }
      function renameSection() {
        var s = sec('تسمية الملفات', 'file');
        var r = SL.h('<input class="in" dir="ltr">'); r.value = o.rename;
        r.addEventListener('input', function () { o.rename = r.value; save(); });
        s.appendChild(r); s.appendChild(SL.h('<div class="note">{name} الاسم الأصلي · {n} الرقم · {date} التاريخ</div>'));
      }

      if (kind === 'convert') { fmtSection(true); sizeSection(); }
      else if (kind === 'compress') { fmtSection(true); sizeSection(); }
      else if (kind === 'resize') { sizeSection(); fmtSection(); }
      else if (kind === 'watermark') { wmSection(); fmtSection(); }
      else { fmtSection(true); sizeSection(); wmSection(); renameSection(); }

      var prog = SL.h('<div class="progress" hidden><i></i></div>');
      var run = SL.button(({ convert: 'تحويل', compress: 'ضغط', resize: 'تغيير المقاس', watermark: 'إضافة العلامة', batch: 'تنفيذ على الكل' })[kind], 'sparkles', 'pri block', go);
      opts.appendChild(prog); opts.appendChild(run);

      async function go() {
        if (!files.length) { var d = SL.doc(); if (d) { var f = new File([], d.name); f.__canvas = d.canvas; f.__size = d.meta.size || 0; files.push(f); } else { SL.toast('أضف صورة أولاً', 'image', true); return; } }
        run.disabled = true; prog.hidden = false; results = [];
        var pdfPages = [];
        for (var i = 0; i < files.length; i++) {
          prog.firstChild.style.width = Math.round(i / files.length * 100) + '%';
          try {
            var r = await processFile(files[i], o, logo);
            if (r.pdf) { pdfPages.push(r.canvas); r.name = outName(o.rename, files[i], i, 'pdf'); if (!o.pdfMerge) r.blob = SYFS_PDF.canvasesToPdfBlob([r.canvas], o.q / 100, o.pdfA4 ? { fit: 'a4' } : undefined); }
            else r.name = outName(o.rename, files[i], i, r.ext);
            results[i] = r;
          } catch (e) { results[i] = { err: (e && e.message) || 'تعذّر' }; }
          paintList();
          await new Promise(function (res) { setTimeout(res, 0); });
        }
        if (o.fmt === 'pdf' && o.pdfMerge && pdfPages.length) {
          var pdf = SYFS_PDF.canvasesToPdfBlob(pdfPages, o.q / 100, o.pdfA4 ? { fit: 'a4' } : undefined);
          SL.download(pdf, 'images-' + SL.stamp() + '.pdf'); SL.toast(SL.t('حُفظ PDF من {0} صفحة · {1}', pdfPages.length, SL.fmtBytes(pdf.size)), 'check');
        }
        prog.firstChild.style.width = '100%'; setTimeout(function () { prog.hidden = true; }, 600);
        run.disabled = false;
        var okN = results.filter(function (r) { return r && !r.err; }).length;
        if (o.fmt !== 'pdf') SL.toast(SL.t('تم: {0} من {1}', okN, files.length), okN === files.length ? 'check' : 'info', okN !== files.length);
      }
      paintList();
      schedulePv();
      var un = SL.onDoc(function () { paintList(); schedulePv(); });
      return un;
    };
  }

  /* ---------------- collage (grid layouts) ---------------- */
  function collage(body) {
    var o = Object.assign({ layout: '2x2', gap: 12, radius: 12, bg: '#ffffff', w: 1600, ratio: 1 }, SL.LS.get('q_collage', {}));
    var save = function () { SL.LS.set('q_collage', o); };
    var imgs = [];
    var LAYOUTS = { '1x2': [[0, 0, 1, 1], [1, 0, 1, 1]], '2x1': [[0, 0, 1, 1], [0, 1, 1, 1]], '2x2': [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1]],
      '3x1': [[0, 0, 1, 1], [1, 0, 1, 1], [2, 0, 1, 1]], 'hero': [[0, 0, 2, 2], [2, 0, 1, 1], [2, 1, 1, 1]], '3x3': (function () { var a = []; for (var y = 0; y < 3; y++) for (var x = 0; x < 3; x++) a.push([x, y, 1, 1]); return a; }()) };
    var grid = SL.h('<div class="grid2"><div class="stack" data-l></div><div class="card stack" data-r></div></div>'); body.appendChild(grid);
    var L = grid.querySelector('[data-l]'), R = grid.querySelector('[data-r]');
    L.appendChild(SL.dropzone({ multiple: true, title: 'أضف صور المجمّع', hint: 'تُرتَّب بالترتيب الذي تختاره', onFiles: function (fs) { Promise.all(fs.map(SL.fileToCanvas)).then(function (cs) { imgs = imgs.concat(cs); draw(); }); } }));
    var pv = SL.h('<div class="preview checker"><canvas></canvas></div>'); L.appendChild(pv);
    var cv = pv.querySelector('canvas');
    R.appendChild(SL.h('<h3>' + I('collage', 's') + 'التخطيط</h3>'));
    R.appendChild(SL.seg([['1x2', 'جنباً لجنب'], ['2x1', 'فوق بعض'], ['2x2', '٢×٢'], ['3x1', 'ثلاثة'], ['hero', 'رئيسية + ٢'], ['3x3', '٣×٣']], o.layout, function (v) { o.layout = v; save(); draw(); }));
    R.appendChild(SL.seg([[1, '1:1'], [1.25, '4:5'], [0.5625, '16:9'], [1.7778, '9:16']], o.ratio, function (v) { o.ratio = Number(v); save(); draw(); }));
    R.appendChild(SL.slider('المسافة', 0, 60, 1, o.gap, 'px', function (v) { o.gap = v; save(); draw(); }));
    R.appendChild(SL.slider('الاستدارة', 0, 60, 1, o.radius, 'px', function (v) { o.radius = v; save(); draw(); }));
    var bg = SL.h('<div class="row"><span class="note">الخلفية</span><input type="color"></div>'); bg.querySelector('input').value = o.bg;
    bg.querySelector('input').addEventListener('input', function (e) { o.bg = e.target.value; save(); draw(); }); R.appendChild(bg);
    R.appendChild(SL.button('مسح الصور', 'trash', 'sm ghost', function () { imgs = []; draw(); }));
    R.appendChild(SL.button('تنزيل PNG', 'download', 'pri block', function () { SL.toBlob(cv).then(function (b) { SL.download(b, 'collage-' + SL.stamp() + '.png'); }); }));
    R.appendChild(SL.button('فتح في المحرر', 'editor', 'block', function () { SL.setDoc(SL.cloneCanvas(cv), 'collage.png'); SL.open('editor'); }));
    function draw() {
      var cells = LAYOUTS[o.layout], cols = 0, rows = 0;
      cells.forEach(function (c) { cols = Math.max(cols, c[0] + c[2]); rows = Math.max(rows, c[1] + c[3]); });
      var W = o.w, H = Math.round(W * o.ratio); cv.width = W; cv.height = H;
      var g = cv.getContext('2d'); g.fillStyle = o.bg; g.fillRect(0, 0, W, H);
      var gp = o.gap, cw = (W - gp * (cols + 1)) / cols, ch = (H - gp * (rows + 1)) / rows;
      cells.forEach(function (c, i) {
        var x = gp + c[0] * (cw + gp), y = gp + c[1] * (ch + gp), w = cw * c[2] + gp * (c[2] - 1), h = ch * c[3] + gp * (c[3] - 1);
        g.save(); g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, o.radius); else g.rect(x, y, w, h); g.clip();
        var im = imgs[i];
        if (im) { var k = Math.max(w / im.width, h / im.height), dw = im.width * k, dh = im.height * k; g.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); }
        else { g.fillStyle = 'rgba(127,127,127,.18)'; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(127,127,127,.6)'; g.font = '600 28px system-ui'; g.textAlign = 'center'; g.fillText(String(i + 1), x + w / 2, y + h / 2 + 10); }
        g.restore();
      });
    }
    draw();
  }

  SL.tools.push(
    { id: 'convert', group: 'convert', label: 'تحويل الصيغة', icon: 'convert', desc: 'بين PNG · JPG · WebP · AVIF · GIF · BMP · ICO · TIFF · PDF — صورة أو مئات.', mount: page('convert') },
    { id: 'compress', group: 'convert', label: 'ضغط الصور', icon: 'compress', desc: 'بجودة تختارها أو حجم مستهدف بالكيلوبايت — مع التوفير لكل ملف.', mount: page('compress') },
    { id: 'resize', group: 'convert', label: 'تغيير المقاس', icon: 'resize', desc: 'مقاسات التواصل الجاهزة، أطول ضلع، نسبة، ملء أو احتواء.', mount: page('resize') },
    { id: 'watermark', group: 'convert', label: 'علامة مائية', icon: 'watermark', desc: 'نص أو شعار على صورة أو مجموعة صور، بموضع وشفافية.', mount: page('watermark') },
    { id: 'batch', group: 'convert', label: 'معالجة مجمّعة', icon: 'batch', desc: 'الصيغة والضغط والمقاس والعلامة والتسمية دفعة واحدة — ZIP واحد.', mount: page('batch') },
    { id: 'collage', group: 'make', label: 'مجمّع الصور', icon: 'collage', desc: 'ضع عدّة صور في تخطيط واحد بمسافات وزوايا مستديرة.', mount: collage }
  );
}());
