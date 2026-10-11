/* SYF — OCR, «استخراج نصّ من صورة» (ocr.html). Tesseract, entirely on the device.
 *
 * THE WHOLE POINT IS THAT NOTHING LEAVES. The other path to OCR — hand the image to a
 * multimodal model — costs zero bytes and reads Arabic better, and it was rejected for
 * this tool: an OCR button is pointed at payslips, ID cards, contracts and prescriptions,
 * and «it never leaves your device» is the only promise that survives being pointed at
 * those. That promise is only true if the engine is local, so every path tesseract.js
 * would otherwise take to a CDN is pinned here:
 *
 *   workerPath  → the bundled worker.min.js      (default: jsdelivr)
 *   corePath    → the bundled SIMD wasm loader   (default: jsdelivr)
 *   langPath    → lib/tesseract/lang             (default: tessdata.projectnaptha.com)
 *
 * ⛔ ALL THREE MUST STAY SET. Dropping any one of them does not fail — it silently
 * starts downloading megabytes from a third party the first time someone runs OCR, and
 * on an extension page that fetch is NOT filtered by `ALLOWED` in background.js (that
 * list governs the content-script relay, §8). tools/ocr-test.js asserts all three.
 *
 * Two more settings that look cosmetic and are not:
 *   · workerBlobURL:false — a Blob worker makes emscripten's scriptDirectory empty, so
 *     the core would look for its .wasm next to the PAGE instead of next to the worker
 *     and fail; MV3's CSP does not admit blob: workers either. The worker and the .wasm
 *     therefore live in the SAME folder and must keep living there.
 *   · cacheMethod:'none' — the language data is already a local file. Caching it puts a
 *     second copy of a 2.4MB model into IndexedDB and buys nothing.
 *
 * The image is read from a File in this tab and handed to the worker as bytes. It is
 * never fetched, never uploaded, never stored. The recognised text reaches the DOM
 * through `value`/`textContent` only. One storage key is written — the chosen language
 * — and it is whitelisted on read (§5.11), because it selects a resource path. */
(function () {
  'use strict';
  var SYFS = window.SYFS || (window.SYFS = {});
  var store = SYFS.storage;

  /* i18n-via: T — every Arabic string below reaches the DOM through this wrapper
     (§6.103). Variadic on purpose (§5.13/9). */
  var T = function () { return SYFS.t ? SYFS.t.apply(null, arguments) : arguments[0]; };
  var $ = function (id) { return document.getElementById(id); };

  var PREF_KEY = 'ocr_prefs';
  var MAX_BYTES = 25 * 1024 * 1024;
  /* Whitelist, not «whatever the picker returned»: the type ends up choosing a decoder
     inside a wasm module. These are the raster formats leptonica reads. */
  var TYPES = { 'image/png': 1, 'image/jpeg': 1, 'image/webp': 1, 'image/bmp': 1, 'image/gif': 1 };
  /* [value, label]. The value is a resource path segment, so it is a closed list and the
     stored preference is checked against it on READ, not only on write (§5.11/1). */
  var LANGS = [
    ['ara', 'العربية'],
    ['eng', 'English'],
    ['ara+eng', 'العربية + English']
  ];
  function langOk(v) {
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i][0] === v) return v;
    return 'ara';
  }

  var file = null, previewUrl = '', lang = 'ara', busy = false;

  /* ===== toast ===== */
  var toastT = 0;
  function toast(msg) {
    var el = $('oc-toast');
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('on'); }, 2400);
  }
  function say(msg) { $('oc-stat').textContent = msg; }
  function bar(p) { $('oc-bar').style.width = Math.max(0, Math.min(1, p)) * 100 + '%'; }

  /* ===== capability =====
   * The bundled core is the SIMD build — one file rather than four, which is what keeps
   * the download at 2.9MB. This is a real probe (it validates a module that returns a
   * v128), not a version guess, so it can only be wrong by being right. Chrome has had
   * SIMD since 91; saying so beats a wasm error nobody can read. */
  function hasSimd() {
    try {
      return WebAssembly.validate(new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
      ]));
    } catch (e) { return false; }
  }

  /* ===== language chips ===== */
  function buildLangs() {
    var host = $('oc-langs');
    host.textContent = '';
    LANGS.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'chip';
      /* i18n-dyn: the label half of the LANGS table */
      b.textContent = T(it[1]);
      b.dataset.v = it[0];
      b.addEventListener('click', function () {
        if (busy) return;
        lang = it[0]; syncLangs();
        try { store.set(PREF_KEY, { lang: lang }); } catch (e) { /* a preference, not the work */ }
      });
      host.appendChild(b);
    });
    syncLangs();
  }
  function syncLangs() {
    var els = $('oc-langs').querySelectorAll('.chip');
    for (var i = 0; i < els.length; i++) els[i].classList.toggle('on', els[i].dataset.v === lang);
  }

  /* ===== the picked image ===== */
  function clearPreview() {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ''; }
  }
  function setFile(f) {
    if (!f) return;
    /* a paste/drop mid-run swapped the preview and revoked its URL while the engine was
       still reading the old image — the result then sat under the wrong picture (v0.139.4) */
    if (busy) { toast(T('انتظر حتى تنتهي القراءة الحالية.')); return; }
    if (!TYPES[f.type]) { toast(T('صيغة غير مدعومة — اختر PNG أو JPG أو WebP أو BMP.')); return; }
    if (f.size > MAX_BYTES) { toast(T('الصورة أكبر من ٢٥ ميجابايت.')); return; }
    clearPreview();
    file = f;
    previewUrl = URL.createObjectURL(f);
    var drop = $('oc-drop');
    drop.textContent = '';
    var img = document.createElement('img');
    img.src = previewUrl;
    img.alt = T('الصورة المختارة');
    drop.appendChild(img);
    /* i18n-dyn: the user's own file name */
    $('oc-fname').textContent = f.name + ' — ' + fmtSize(f.size);
    $('oc-go').disabled = false;
    say('');
    bar(0);
  }
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  function resetDrop() {
    var drop = $('oc-drop');
    drop.textContent = '';
    var a = document.createElement('div'); a.className = 'big'; a.textContent = T('أفلت الصورة هنا');
    var b = document.createElement('div'); b.className = 'sm'; b.textContent = T('أو انقر للاختيار — ويمكنك اللصق بـ Ctrl+V');
    drop.appendChild(a); drop.appendChild(b);
  }

  /* ===== recognition ===== */
  function pct(p) {
    /* tesseract reports two phases; the numbers it hands back are per-phase, so the bar
       is driven by `progress` alone and the WORD beside it says which phase we are in. */
    var m = {
      'loading tesseract core': 'يحمّل المحرّك…',
      'initializing tesseract': 'يهيّئ المحرّك…',
      'loading language traineddata': 'يحمّل بيانات اللغة…',
      'initializing api': 'يهيّئ…',
      'recognizing text': 'يقرأ الصورة…'
    };
    return m[p.status] || '';
  }

  async function run() {
    if (!file || busy) return;
    if (!hasSimd()) {
      say(T('متصفّحك لا يدعم WebAssembly SIMD — حدّث كروم إلى إصدار ٩١ أو أحدث.'));
      return;
    }
    busy = true;
    $('oc-go').disabled = true;
    bar(0.02);
    say(T('يحمّل المحرّك…'));
    var worker = null, t0 = Date.now();
    try {
      worker = await window.Tesseract.createWorker(lang, 1, {
        /* ⛔ the three pinned paths — see the file header */
        workerPath: chrome.runtime.getURL('lib/tesseract/worker.min.js'),
        corePath: chrome.runtime.getURL('lib/tesseract/tesseract-core-simd-lstm.js'),
        langPath: chrome.runtime.getURL('lib/tesseract/lang'),
        gzip: true,
        workerBlobURL: false,
        cacheMethod: 'none',
        logger: function (p) {
          var label = pct(p);
          if (label) say(T(label));
          if (typeof p.progress === 'number') bar(p.progress);
        }
      });
      say(T('يقرأ الصورة…'));
      var res = await worker.recognize(file);
      var text = (res && res.data && res.data.text) || '';
      $('oc-out').value = text;
      bar(1);
      var secs = ((Date.now() - t0) / 1000).toFixed(1);
      say(T('تمّ في {0} ثانية.', secs));
      meta(text);
      if (!text.trim()) toast(T('لم يُعثر على نصّ في هذه الصورة.'));
    } catch (e) {
      bar(0);
      /* The engine's own message is English and can carry a path, so it is not shown
         (§4.6). What the user can act on is said instead. */
      say(T('تعذّر تشغيل المحرّك. جرّب صورة أخرى أو أعد تحميل الصفحة.'));
    } finally {
      if (worker) { try { await worker.terminate(); } catch (e) { /* nothing left to do */ } }
      busy = false;
      $('oc-go').disabled = !file;
    }
  }

  function meta(text) {
    var words = text.trim() ? text.trim().split(/\s+/).length : 0;
    var chars = text.length;
    $('oc-meta').textContent = T('{0} كلمة · {1} محرفاً', String(words), String(chars));
  }

  /* ===== output ===== */
  function safeName() {
    var base = (file && file.name ? file.name : 'ocr').replace(/\.[^.]+$/, '');
    /* the name reaches the file system: letters, digits, Arabic, space, dash, underscore */
    base = base.replace(/[^\w؀-ۿ \-]+/g, '').trim().slice(0, 60);
    return (base || 'ocr') + '.txt';
  }
  function download() {
    var text = $('oc-out').value;
    if (!text) { toast(T('لا نصّ لتنزيله.')); return; }
    var url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url; a.download = safeName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function copy() {
    var text = $('oc-out').value;
    if (!text) { toast(T('لا نصّ لنسخه.')); return; }
    navigator.clipboard.writeText(text).then(
      function () { toast(T('نُسخ.')); },
      function () { toast(T('تعذّر النسخ.')); }
    );
  }

  /* ===== wiring ===== */
  function init() {
    buildLangs();
    resetDrop();

    var drop = $('oc-drop'), pick = $('oc-file');
    drop.addEventListener('click', function () { if (!busy) pick.click(); });
    drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!busy) pick.click(); }
    });
    pick.addEventListener('change', function () { setFile(pick.files && pick.files[0]); pick.value = ''; });

    ['dragenter', 'dragover'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) setFile(f);
    });
    document.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.files;
      if (items && items.length) setFile(items[0]);
    });

    $('oc-go').addEventListener('click', run);
    $('oc-clear').addEventListener('click', function () {
      if (busy) return;
      clearPreview(); file = null; resetDrop();
      $('oc-fname').textContent = ''; $('oc-out').value = ''; $('oc-meta').textContent = '';
      $('oc-go').disabled = true; bar(0); say('');
    });
    $('oc-copy').addEventListener('click', copy);
    $('oc-dl').addEventListener('click', download);
    $('oc-out').addEventListener('input', function () { meta($('oc-out').value); });

    window.addEventListener('pagehide', clearPreview);
  }

  /* The dictionary arrives BEFORE anything is drawn — a chip painted half a beat early
     is painted in Arabic on an English page and is never repainted (§6.100/4). Same
     order status.js and phones.js use. */
  function boot() {
    var ready = function () {
      var done = function (stored) { lang = langOk(stored && stored.lang); init(); };
      if (!store) { done(null); return; }
      store.get(PREF_KEY, null).then(done, function () { done(null); });   /* whitelist on read (§5.11) */
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
