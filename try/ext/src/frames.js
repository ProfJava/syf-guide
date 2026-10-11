/* SYF — video.html, mode «الفيديو ⇒ صور».
 *
 * The cheapest thing that works: seek the <video> to each timestamp and draw the frame
 * onto a canvas. No library, no WebCodecs, no worker — and it cannot fail in a way the
 * browser itself would not have failed at playing the file.
 *
 * ⚠️ It is a LOOP OVER SEEKS, so it is cancellable between frames and reports honest
 * progress (frame k of n, both known before the run starts). It is not fast enough to
 * pull every frame of a long clip — that needs WebCodecs, and the UI says so instead of
 * pretending.
 *
 * The shell (opening the file, the tab bar, the toast, downloads) is src/video-page.js;
 * the maths (timestamps, names, the ZIP) is src/videokit.js. This file is the screen. */
(function () {
  'use strict';
  var SYFS = window.SYFS || (window.SYFS = {});
  var P = SYFS.videoPage, VK = SYFS.videokit;
  if (!P || !VK) return;
  /* i18n-via: T — T IS SYFS.t (via src/video-page.js); every Arabic literal below
     reaches the DOM through it (§6.103) */
  var T = P.T, $ = P.$, ltr = P.ltr;

  var frames = [];           /* [{ t, blob, url }] — the last run */
  var running = false, cancelled = false;
  var opts = { mode: 'every', step: 1, count: 24, start: 0, end: 0, fmt: 'jpg', quality: 92, scale: 1 };

  P.register({
    id: 'frames', label: 'الفيديو ⇒ صور', panel: 'vp-frames',
    init: function () {
      P.chips($('vf-mode'), [['every', 'كل فاصل زمني'], ['count', 'عدد محدّد']],
        function () { return opts.mode; }, function (v) { opts.mode = v; modeBoxes(); estimate(); });
      P.chips($('vf-fmt'), [['jpg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP']],
        function () { return opts.fmt; }, function (v) { opts.fmt = v; });
      P.chips($('vf-scale'), [[1, 'الأبعاد الأصلية'], [0.5, 'النصف'], [0.25, 'الرُّبع']],
        function () { return opts.scale; }, function (v) { opts.scale = Number(v); });

      P.range('vf-step', 'vf-step-v', function () { return opts.step; },
        function (v) { opts.step = Math.max(0.5, v); estimate(); },
        function (v) { return T('{0} ثانية', ltr(v)); });
      P.range('vf-count-in', 'vf-count-v', function () { return opts.count; },
        function (v) { opts.count = Math.max(1, Math.min(VK.MAX_FRAMES, Math.round(v))); estimate(); },
        function (v) { return ltr(v); });
      P.range('vf-q', 'vf-q-v', function () { return opts.quality; },
        function (v) { opts.quality = v; }, function (v) { return ltr(v); });

      $('vf-start').addEventListener('input', function () {
        opts.start = Math.min(Number(this.value), opts.end); syncRange(); estimate();
      });
      $('vf-end').addEventListener('input', function () {
        opts.end = Math.max(Number(this.value), opts.start); syncRange(); estimate();
      });
      $('vf-run').addEventListener('click', run);
      $('vf-stop').addEventListener('click', function () { cancelled = true; });
      $('vf-zip').addEventListener('click', saveZip);
      $('vf-sheet').addEventListener('click', saveSheet);
      modeBoxes();
    },
    onFile: function (v) {
      clearFrames();
      opts.start = 0; opts.end = v.duration;
      $('vf-start').max = $('vf-end').max = String(Math.floor(v.duration));
      $('vf-start').value = '0'; $('vf-end').value = String(Math.ceil(v.duration));
      syncRange(); estimate();
    },
    onLeave: function () { cancelled = true; }
  });

  function modeBoxes() {
    $('vf-stepbox').hidden = opts.mode !== 'every';
    $('vf-countbox').hidden = opts.mode !== 'count';
  }
  function syncRange() {
    $('vf-start-v').textContent = VK.fmtTime(opts.start);   /* i18n-dyn: a timecode */
    $('vf-end-v').textContent = VK.fmtTime(opts.end);
  }
  function plan() {
    var v = P.video();
    return VK.times(v ? v.duration : 0,
      { mode: opts.mode, step: opts.step, count: opts.count, start: opts.start, end: opts.end });
  }
  function estimate() {
    if (!P.video()) return;
    var p = plan();
    $('vf-est').textContent = p.capped
      ? T('{0} صورة — بلغت الحدّ الأقصى ({1}). قلّل المدى أو زد الفاصل الزمني.', ltr(p.times.length), ltr(VK.MAX_FRAMES))
      : T('{0} صورة ستُستخرج.', ltr(p.times.length));
    $('vf-est').classList.toggle('warn', !!p.capped);
  }

  function clearFrames() {
    frames.forEach(function (f) { if (f.url) URL.revokeObjectURL(f.url); });
    frames = [];
    $('vf-grid').textContent = '';
    $('vf-out').hidden = true;
  }

  /* The name follows the bytes, not the picker: the format can change after a run, and
     toBlob falls back to PNG when a type (e.g. webp) isn't supported (v0.139.4). */
  function blobExt(blob) {
    var t = blob && blob.type;
    return t === 'image/png' ? 'png' : (t === 'image/webp' ? 'webp' : 'jpg');
  }

  function grab(v, t, cv, cx) {
    return VK.seek(v.el, t).then(function () {
      cx.drawImage(v.el, 0, 0, cv.width, cv.height);
      return new Promise(function (res) {
        cv.toBlob(res,
          opts.fmt === 'png' ? 'image/png' : (opts.fmt === 'webp' ? 'image/webp' : 'image/jpeg'),
          opts.fmt === 'png' ? undefined : opts.quality / 100);
      });
    });
  }

  function run() {
    var v = P.video();
    if (!v || running) return;
    var p = plan();
    clearFrames();
    running = true; cancelled = false;
    var g = P.gen();
    $('vf-run').hidden = true; $('vf-stop').hidden = false;
    $('vf-prog').hidden = false;

    var cv = document.createElement('canvas');
    cv.width = Math.max(2, Math.round(v.width * opts.scale));
    cv.height = Math.max(2, Math.round(v.height * opts.scale));
    var cx = cv.getContext('2d');
    var i = 0;

    var step = function () {
      if (cancelled || i >= p.times.length) return finish(g);
      var t = p.times[i];
      return grab(v, t, cv, cx).then(function (blob) {
        if (cancelled) return finish(g);
        if (blob) {
          frames.push({ t: t, blob: blob, url: URL.createObjectURL(blob) });
          addThumb(frames[frames.length - 1], frames.length - 1);
        }
        i++; progress(i, p.times.length);
        /* yield to the event loop between frames: this is what keeps «إيقاف»
           clickable and the page from freezing on a long run */
        return new Promise(function (r) { setTimeout(r, 0); }).then(step);
      }).catch(function () {
        i++; progress(i, p.times.length);      /* one unreadable position must not sink
                                                  the whole run — skip it and carry on */
        return new Promise(function (r) { setTimeout(r, 0); }).then(step);
      });
    };
    step();
  }
  function progress(done, total) {
    $('vf-bar').style.width = Math.round(done / total * 100) + '%';
    $('vf-count').textContent = ltr(done + ' / ' + total);
  }
  function finish(g) {
    running = false;
    $('vf-run').hidden = false; $('vf-stop').hidden = true;
    $('vf-prog').hidden = true;
    /* another file was opened mid-run: these stills belong to a clip that is gone */
    if (g !== P.gen()) { clearFrames(); return; }
    if (!frames.length) { P.toast(T('لم تُستخرج أي صورة.')); return; }
    $('vf-out').hidden = false;
    $('vf-outmeta').textContent = cancelled
      ? T('أُوقفت بعد {0} صورة.', ltr(frames.length))
      : T('{0} صورة جاهزة.', ltr(frames.length));
  }
  function addThumb(f, i) {
    var d = document.createElement('div');
    d.className = 'thumb';
    var img = document.createElement('img');
    img.src = f.url; img.alt = VK.fmtTime(f.t); img.loading = 'lazy';
    var s = document.createElement('span');
    s.textContent = VK.fmtTime(f.t);          /* i18n-dyn: a timecode, not a label */
    var a = document.createElement('a');
    a.href = f.url; a.download = VK.frameName(i, f.t, blobExt(f.blob));
    a.title = T('حفظ هذه الصورة'); a.setAttribute('aria-label', T('حفظ هذه الصورة'));
    a.appendChild(img); a.appendChild(s);
    d.appendChild(a);
    $('vf-grid').appendChild(d);
  }

  function saveZip() {
    if (!frames.length) return;
    var f0 = P.file();
    var jobs = frames.map(function (f, i) {
      return f.blob.arrayBuffer().then(function (buf) {
        return { name: VK.frameName(i, f.t, blobExt(f.blob)), data: new Uint8Array(buf) };
      });
    });
    $('vf-zip').disabled = true;
    Promise.all(jobs).then(function (entries) {
      var bytes = VK.zipBytes(entries);
      P.download(new Blob([bytes], { type: 'application/zip' }), VK.baseName(f0 && f0.name) + '-frames.zip');
      $('vf-zip').disabled = false;
      P.toast(T('تم التنزيل ✓'));
    }).catch(function () { $('vf-zip').disabled = false; P.toast(T('تعذّر إنشاء الملفّ المضغوط.')); });
  }

  /* every frame in one image with its timecode — the fastest way to find WHERE
     something happens without scrubbing */
  function saveSheet() {
    var v = P.video();
    if (!frames.length || !v) return;
    var cell = 320, cellH = Math.round(cell * (v.height / v.width)) + 22, gap = 8;
    var g = VK.sheetGrid(frames.length, cell, cellH, gap, 4096);
    var cv = document.createElement('canvas');
    cv.width = g.w; cv.height = g.h;
    var cx = cv.getContext('2d');
    cx.fillStyle = '#101418'; cx.fillRect(0, 0, cv.width, cv.height);
    /* ONE bitmap alive at a time (v0.139.3): decoding all 500 frames first held
       500 full-size (4K ⇒ ~33MB each) bitmaps at once and the tab died */
    var list = frames.slice();
    list.reduce(function (chain, f, i) {
      return chain.then(function () {
        return createImageBitmap(f.blob, { resizeWidth: cell, resizeHeight: cellH - 22 });
      }).then(function (b) {
        var col = i % g.cols, row = Math.floor(i / g.cols);
        var x = gap + col * (cell + gap), y = gap + row * (cellH + gap);
        cx.drawImage(b, x, y, cell, cellH - 22);
        cx.fillStyle = 'rgba(255,255,255,.86)';
        cx.font = '600 13px ui-monospace, monospace';
        cx.textAlign = 'left'; cx.direction = 'ltr';
        cx.fillText(VK.fmtTime(f.t), x + 3, y + cellH - 6);
        if (b.close) b.close();
      });
    }, Promise.resolve()).then(function () {
      cv.toBlob(function (blob) {
        var f0 = P.file();
        P.download(blob, VK.baseName(f0 && f0.name) + '-sheet.jpg');
        P.toast(T('تم التنزيل ✓'));
      }, 'image/jpeg', 0.9);
    }).catch(function () { P.toast(T('تعذّر إنشاء ورقة التجميع.')); });
  }
}());
