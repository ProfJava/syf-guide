/* SYF — «الصور»: full-page screenshot + quick image editor + format converter.
 * fullshot scroll-captures via SYFS_CAPTURE messages to the worker
 * (chrome.tabs.captureVisibleTab needs the <all_urls> host permission and is
 * limited to 2 calls/sec — the loop waits 600ms between slices and retries once).
 * Everything is stitched/edited/converted on local canvases; no image ever
 * leaves the device. Loaded BEFORE src/rail.js. */
(function () {
  window.SYFS = window.SYFS || {};

  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    /* the template's own text IS the msgid — translate the built tree rather than
       splitting the markup (see src/i18n.js). Free in the default language. */
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }
  function dl(url, name) { var a = document.createElement('a'); a.href = url; a.download = name; a.click(); }
  function dlBlob(blob, name) { var url = URL.createObjectURL(blob); dl(url, name); setTimeout(function () { URL.revokeObjectURL(url); }, 5000); }
  /* copy a canvas image to the clipboard (PNG). Needs a secure context + user gesture.
   * done(true) on success, done(false, err) otherwise. */
  function copyCanvas(canvas, done) {
    if (!(navigator.clipboard && window.ClipboardItem)) { done(false, 'الحافظة غير مدعومة (يحتاج HTTPS)'); return; }
    canvas.toBlob(function (blob) {
      if (!blob) { done(false, 'تعذّر إنشاء الصورة'); return; }
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function () { done(true); }).catch(function (e) { done(false, e && e.message); });
    }, 'image/png');
  }
  /* PDF encoding lives in lib/canvas-pdf.js — shared with the pro editor page
   * (src/editor.js). Loaded before this file in manifest content_scripts. Multi-page
   * output goes through window.SYFS_PDF.createWriter, one page at a time. */
  function canvasToPdfBlob(canvas, q, opts) { return window.SYFS_PDF.canvasToPdfBlob(canvas, q, opts); }
  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(2) + ' م.ب' : Math.round(n / 1024) + ' ك.ب'; }
  var MAX_SAFE_IMGS = 100;                       /* soft batch limit — warn, don't block */
  function arCount(n) {                           /* Arabic plural for "صورة" */
    if (n === 1) return 'صورة واحدة';
    if (n === 2) return 'صورتان';
    if (n >= 3 && n <= 10) return n + ' صور';
    return n + ' صورة';
  }
  function safeBase(name) {                       /* sanitize a filename stem for download */
    return (String(name || '').replace(/\.[^.]+$/, '').replace(/[^\w؀-ۿ.-]+/g, '_').slice(0, 60)) || 'image';
  }
  /* Deliver a batch: one ZIP if >1 (or forceZip), else a single file download.
   * results: [{ name, blob }]. Local only — nothing is uploaded. */
  async function deliver(results, zipName, forceZip) {
    results = results.filter(function (r) { return r && r.blob; });
    if (!results.length) return;
    if (results.length === 1 && !forceZip) { dlBlob(results[0].blob, results[0].name); return; }
    if (SYFS.imgkit && SYFS.imgkit.zipWrite) {
      var zip = await SYFS.imgkit.zipWrite(results);
      dlBlob(zip, (zipName || 'images') + '-' + stamp() + '.zip');
    } else {
      results.forEach(function (r) { dlBlob(r.blob, r.name); });
    }
  }
  function noteRow(list, txt, mark) {
    var r = h('<div class="syf-note-row"><span class="t"></span><b></b></div>');
    r.querySelector('.t').textContent = txt;                    /* textContent — filenames are user input */
    r.querySelector('b').textContent = mark === undefined ? '…' : (mark ? '✓' : '✗');
    list.appendChild(r); return r;
  }
  /* Any row still showing "…" when a run ends succeeded (failures already wrote ✗). */
  function markPending(list) {
    list.querySelectorAll('.syf-note-row').forEach(function (r) {
      var b = r.querySelector('b');
      if (b && b.textContent === '…') b.textContent = '✓';
    });
  }
  /* Run an async job behind a button (v0.139.5). A click while it runs is ignored; the
   * button is disabled + aria-busy for the whole job and its label always comes back,
   * whatever the job threw. fn may rewrite btn.textContent for progress. runFiles, the
   * converter, PDF⇄images and the seven PDF tabs each carried their own copy of this —
   * and two of them awaited work BEFORE locking, so a double click ran the job twice. */
  async function withBusy(btn, fn) {
    if (btn.disabled) return undefined;
    var orig = btn.textContent;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try { return await fn(); }
    finally { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = orig; }
  }
  /* One line under the results when the browser's canvas limit (imgkit.fitCanvas)
     shrank anything — a silent downscale reads as a bug in the output. */
  function noteCapped(list, n) {
    if (!n) return;
    var r = noteRow(list, SYFS.t('صُغّر {0} من الصور/الصفحات لأنها تتجاوز حدّ المتصفّح ({1} بكسل للضلع).', n, SYFS.imgkit.MAX_SIDE));
    r.querySelector('b').textContent = '⚠';
  }
  /* Run an async per-file step over a batch with a locked button, live progress,
   * a result row per file, a yield between files (keeps the UI responsive), and
   * a final summary row. eachAsync(file,i) -> { blob, capped? } | null. Returns [{name,blob}]. */
  async function runFiles(files, btn, list, eachAsync) {
    var out = await withBusy(btn, function () { return runFilesNow(files, btn, list, eachAsync); });
    return out || [];
  }
  async function runFilesNow(files, btn, list, eachAsync) {
    var results = [], inBytes = 0, outBytes = 0, capped = 0;
    for (var i = 0; i < files.length; i++) {
      btn.textContent = SYFS.t('جارٍ المعالجة {0}/{1}…', i + 1, files.length);
      var f = files[i], row = noteRow(list, f.name);
      try {
        var r = await eachAsync(f, i);
        if (r && r.blob) {
          if (r.capped) capped++;
          results.push({ name: r.name, blob: r.blob });
          inBytes += f.size; outBytes += r.blob.size;
          /* i18n-dyn: the user's own file name and its byte counts */
          row.querySelector('.t').textContent = f.name + ' — ' + fmtSize(f.size) + ' ← ' + fmtSize(r.blob.size);
          row.querySelector('b').textContent = '✓';
        } else {
          row.querySelector('.t').textContent = SYFS.t('{0} — تعذّرت المعالجة', f.name);
          row.querySelector('b').textContent = '✗';
        }
      } catch (e) {
        row.querySelector('.t').textContent = SYFS.t('{0} — تعذّرت المعالجة', f.name);
        row.querySelector('b').textContent = '✗';
      }
      await sleep(0);
    }
    var pct = inBytes ? Math.round((1 - outBytes / inBytes) * 100) : 0;
    /* whole sentences — the old line glued «اكتمل:» + «· الحجم» and never translated */
    noteRow(list, inBytes
      ? SYFS.t('اكتمل: {0}/{1} · الحجم {2} ← {3} ({4})', results.length, files.length, fmtSize(inBytes), fmtSize(outBytes), (pct >= 0 ? '−' : '+') + Math.abs(pct) + '%')
      : SYFS.t('اكتمل: {0}/{1}', results.length, files.length),
      results.length === files.length);
    noteCapped(list, capped);
    return results;
  }
  /* Wire a file input's change event to a count line + >100 warning box. */
  function wireCount(input, countEl, warnEl) {
    input.addEventListener('change', function () {
      var n = input.files ? input.files.length : 0;
      countEl.style.display = n ? '' : 'none';
      countEl.textContent = n ? SYFS.t('تم اختيار {0}', arCount(n)) : '';
      if (warnEl) warnEl.style.display = n > MAX_SAFE_IMGS ? '' : 'none';
    });
  }
  function stamp() { var d = new Date(); function p(x) { return String(x).padStart(2, '0'); } return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function loadImg(url) { return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = url; }); }
  function capture() {
    return new Promise(function (res) {
      try {
        chrome.runtime.sendMessage({ type: 'SYFS_CAPTURE' }, function (r) {
          if (chrome.runtime.lastError || !r) { res({ ok: false, error: 'no-response' }); return; }
          res(r);
        });
      } catch (e) { res({ ok: false, error: String(e) }); }
    });
  }

  /* Hand a canvas to the studio in a TAB of its own (v0.166.0: studio.html, which
   * replaced the Konva editor.html). The worker stages it in memory-only
   * chrome.storage.session (10MB quota) and opens the page; a big PNG can blow the
   * quota, so fall back to JPEG rather than failing. `done(ok, err)` reports back. */
  var EDIT_MAX = 9 * 1024 * 1024;
  function openInProEditor(canvas, done) {
    var url = canvas.toDataURL('image/png');
    var lossy = false;
    if (url.length > EDIT_MAX) { url = canvas.toDataURL('image/jpeg', 0.92); lossy = true; }
    if (url.length > EDIT_MAX) { done(false, 'الصورة أكبر من أن تُمرَّر للمحرّر — قصّها أولاً'); return; }
    try {
      chrome.runtime.sendMessage({ type: 'SYFS_EDIT_OPEN', dataUrl: url }, function (r) {
        if (chrome.runtime.lastError || !r || !r.ok) { done(false, (r && r.error) || 'تعذّر فتح المحرّر'); return; }
        done(true, lossy ? 'فُتح المحرّر (حُوّلت لـJPEG لضخامة الحجم)' : '');
      });
    } catch (e) { done(false, String(e)); }
  }

  /* Hand a canvas to the editor. v0.166.0 — the layered editor of «الاستوديو»
   * (studio.html, hosted in-page by src/studio.js, loaded after this file); the old
   * `imgedit` window is the fallback for a page where the studio did not load. */
  function toEditor(canvas) {
    if (!canvas) return;
    if (SYFS.studio && SYFS.studio.openImage) { SYFS.studio.openImage(canvas, 'editor'); return; }
    SYFS._imgToEdit = canvas.toDataURL('image/png');
    if (SYFS.openToolById) SYFS.openToolById('imgedit');
  }

  SYFS.cats = SYFS.cats || {};
  SYFS.cats.media = {
    label: 'الصور',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="15" height="15" rx="2"/><circle cx="7.5" cy="7.5" r="1.3"/><path d="M18 13.5l-4-4-8 8"/><path d="M18 8h1a2 2 0 012 2v9a2 2 0 01-2 2h-9a2 2 0 01-2-2v-1"/></svg>'
  };

  SYFS.tools = SYFS.tools || [];

  /* ===================== 1) تصوير الصفحة كاملة ===================== */
  var MAX_CSS_H = 15000;   /* CSS-px page-height cap */
  var MAX_DEV = 16384;     /* max canvas dimension (device px) — keeps memory sane */

  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var FULLSHOT_ICON = SVG + '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
  var REGION_ICON = SVG + '<path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"/><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"/></svg>';
  /* icon-only action buttons (16px, inherit colour) */
  var I_COPY = SVG + '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var I_DOWN = SVG + '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';
  var I_EDIT = SVG + '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  var I_PRO  = SVG + '<path d="M12 2L2 7l10 5 10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>';

  /* Tiny status toast for tools that run without a panel (the regionshot hotkey).
   * Own shadow root so page CSS can't touch it; marked data-syfs-shot-hide so the
   * capture routine hides it instead of baking it into the image. */
  function miniToast(msg, autoMs) {
    var host = document.createElement('div');
    host.setAttribute('data-syfs-shot-hide', '');
    /* ⚠️ the direction goes on the HOST, not in the sheet. This overlay hangs off
       <html>, outside .syfs-wrap, so `var(--syfs-dir)` has nothing to resolve against
       and would silently fall back to rtl in an English interface. Shadow content
       inherits `direction` from its host, so one inline property covers the sheet. */
    host.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483646;'
      + 'direction:' + ((SYFS.i18n && SYFS.i18n.dir()) || 'rtl');
    var sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML =
      '<style>' +
        '.t{display:flex;align-items:center;gap:10px;background:#0f172a;color:#fff;' +
          'font:600 13px system-ui,sans-serif;padding:9px 14px;border-radius:999px;box-shadow:0 6px 20px #0004}' +
        'button{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:999px;' +
          'background:#ffffff1f;color:#fff;cursor:pointer}' +
        'button:hover{background:#fff3}' +
        'svg{width:15px;height:15px}' +
        '.hide{display:none}' +
      '</style>' +
      '<div class="t"><span class="m"></span>' +
        '<button class="cp hide" title="نسخ للحافظة" aria-label="نسخ للحافظة">' + I_COPY + '</button>' +
        '<button class="ed hide" title="تحرير في الاستوديو" aria-label="تحرير في الاستوديو">' + I_EDIT + '</button>' +
        '<button class="pro hide" title="المحرر الاحترافي" aria-label="المحرر الاحترافي">' + I_PRO + '</button>' +
        '<button class="x" title="إغلاق" aria-label="إغلاق">✕</button>' +
      '</div>';
    document.documentElement.appendChild(host);
    var m = sr.querySelector('.m'), pro = sr.querySelector('.pro'), ed = sr.querySelector('.ed'), cp = sr.querySelector('.cp'), timer = 0;
    function close() { clearTimeout(timer); host.remove(); }
    sr.querySelector('.x').addEventListener('click', close);
    function arm(ms) { clearTimeout(timer); if (ms) timer = setTimeout(close, ms); }
    m.textContent = msg; arm(autoMs === undefined ? 4000 : autoMs);
    return {
      close: close,
      set: function (text, canvas) {
        m.textContent = text;
        if (canvas) {
          cp.classList.remove('hide');
          cp.onclick = function () {
            copyCanvas(canvas, function (ok, err) { m.textContent = ok ? SYFS.t('نُسِخت للحافظة ✓') : SYFS.t('تعذّر النسخ: {0}', err || ''); arm(6000); });
          };
          pro.classList.remove('hide');
          pro.onclick = function () { openInProEditor(canvas, function () {}); close(); };
          ed.classList.remove('hide');
          ed.onclick = function () { toEditor(canvas); close(); };
        }
        arm(6000);
      }
    };
  }
  /* The whole page, top to bottom, stitched from viewport captures → { canvas, cut }.
   * Lifted out of the fullshot panel (v0.166.0) so the studio's «الصفحة كاملة» and the
   * capture bar run the same routine. Our own chrome (the rail host and every
   * data-syfs-shot-hide overlay) is hidden for the run and put back in `finally`, with
   * the scroll position. `onStatus(text)` gets progress. Throws on a failed capture. */
  var fullBusy = false;
  async function fullPageCanvas(onStatus) {
    if (fullBusy) throw new Error('busy');
    fullBusy = true;
    var say = typeof onStatus === 'function' ? onStatus : function () {};
    var se = document.scrollingElement || document.documentElement;
    var de = document.documentElement;
    var x0 = se.scrollLeft, y0 = se.scrollTop, sb = de.style.scrollBehavior;
    var hiddenEls = [], ours = [], oursPrev = [];
    function hideOurs(el) { if (el) { ours.push(el); oursPrev.push(el.style.display); el.style.display = 'none'; } }
    try {
      de.style.scrollBehavior = 'auto';
      var vh = window.innerHeight;
      var fullH = se.scrollHeight;
      var total = Math.min(fullH, MAX_CSS_H);
      var dpr = window.devicePixelRatio || 1;
      var s = Math.min(1, MAX_DEV / (total * dpr));   /* stitch scale to stay under canvas limits */
      say(SYFS.t('التصوير…'));
      hideOurs(document.getElementById('syfs-host'));
      [].forEach.call(document.querySelectorAll('[data-syfs-shot-hide]'), hideOurs);
      se.scrollTop = 0; await sleep(450);
      var first = await capture();
      if (!first.ok) throw new Error(first.error || 'capture-failed');
      var im0 = await loadImg(first.url);
      var cv = document.createElement('canvas');
      cv.width = Math.round(im0.width * s);
      cv.height = Math.round(total * dpr * s);
      var cx = cv.getContext('2d');
      cx.drawImage(im0, 0, 0, im0.width, im0.height, 0, 0, Math.round(im0.width * s), Math.round(im0.height * s));
      /* hide fixed/sticky bars so they don't repeat on every slice below the first */
      if (total > vh + 2 && document.body) {
        var all = document.body.getElementsByTagName('*');
        var n = Math.min(all.length, 4000);
        for (var i = 0; i < n; i++) {
          var p = getComputedStyle(all[i]).position;
          if (p === 'fixed' || p === 'sticky') { hiddenEls.push([all[i], all[i].style.visibility]); all[i].style.visibility = 'hidden'; }
        }
      }
      var y = vh, guard = 0, lastSy = -1;
      while (y < total && guard < 80) {
        guard++;
        se.scrollTop = y;
        await sleep(600);                       /* render settle + stay under 2 captures/sec */
        var sy = se.scrollTop;                  /* clamped at the bottom */
        if (sy <= lastSy) break;                /* scroll can't advance (clamped / page shrank) — stop */
        lastSy = sy;
        var r = await capture();
        if (!r.ok) { await sleep(700); r = await capture(); }  /* one retry (rate limit) */
        if (!r.ok) throw new Error(r.error || 'capture-failed');
        var im = await loadImg(r.url);
        cx.drawImage(im, 0, 0, im.width, im.height, 0, Math.round(sy * dpr * s), Math.round(im.width * s), Math.round(im.height * s));
        say(SYFS.t('التصوير… {0}', Math.min(100, Math.round(((sy + vh) / total) * 100)) + '%'));
        if (sy + vh >= total) break;
        y = sy + vh;
      }
      return { canvas: cv, cut: fullH > MAX_CSS_H };
    } finally {
      hiddenEls.forEach(function (hv) { hv[0].style.visibility = hv[1]; });
      ours.forEach(function (el, i) { el.style.display = oursPrev[i]; });
      de.style.scrollBehavior = sb;
      se.scrollTop = y0; se.scrollLeft = x0;
      fullBusy = false;
    }
  }

  function mountFullshot(body) {
      var ui = h(
        '<div class="syf-form">' +
          '<button class="syf-btn" id="fs-go">📸 ابدأ التصوير الكامل</button>' +
          '<div class="syf-note-hint">تُصوَّر الصفحة من الأعلى للأسفل بالتمرير التلقائي ثم تُدمج بصورة واحدة — محلياً بالكامل. لا تحرّك الصفحة أثناء التصوير. (لا يشمل مناطق التمرير الداخلية)</div>' +
          '<div class="syf-empty" id="fs-st" style="display:none"></div>' +
          '<div id="fs-out" style="display:none">' +
            '<img id="fs-img" style="max-width:100%;max-height:300px;border:1px solid #e5e9f2;border-radius:8px;display:block;margin:0 auto">' +
            '<div class="syf-row" style="margin-top:8px">' +
              '<button class="syf-mini" id="fs-copy">📋 نسخ للحافظة</button>' +
              '<button class="syf-mini" id="fs-png">تنزيل PNG</button>' +
              '<button class="syf-mini" id="fs-jpg">تنزيل JPG</button>' +
              '<button class="syf-mini" id="fs-pdf">تنزيل PDF</button>' +
              '<button class="syf-mini" id="fs-edit">✏️ تحرير سريع</button>' +
              '<button class="syf-mini" id="fs-pro">🎨 المحرر الاحترافي</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
      body.appendChild(ui);
      var st = ui.querySelector('#fs-st'), out = ui.querySelector('#fs-out'), img = ui.querySelector('#fs-img');
      var goBtn = ui.querySelector('#fs-go');
      var result = null;
      function status(t) { st.style.display = ''; st.textContent = t; }

      async function run() {
        if (goBtn.disabled) return;
        goBtn.disabled = true;
        try {
          var r = await fullPageCanvas(status);
          result = r.canvas;
          img.src = r.canvas.toDataURL('image/jpeg', 0.8);   /* light preview */
          out.style.display = '';
          status('تم ✅ ' + r.canvas.width + '×' + r.canvas.height + (r.cut ? ' — اقتُطعت الصفحة عند الحد الأقصى' : ''));
        } catch (e) {
          status('فشل التصوير: ' + (e && e.message ? e.message : e));
        } finally {
          goBtn.disabled = false;
        }
      }

      goBtn.addEventListener('click', run);
      ui.querySelector('#fs-copy').addEventListener('click', function () { if (result) copyCanvas(result, function (ok, err) { status(ok ? 'نُسِخت الصورة للحافظة ✓' : 'تعذّر النسخ: ' + (err || '')); }); });
      ui.querySelector('#fs-png').addEventListener('click', function () { if (result) dl(result.toDataURL('image/png'), 'fullpage-' + stamp() + '.png'); });
      ui.querySelector('#fs-jpg').addEventListener('click', function () { if (result) dl(result.toDataURL('image/jpeg', 0.92), 'fullpage-' + stamp() + '.jpg'); });
      ui.querySelector('#fs-pdf').addEventListener('click', function () { if (result) dlBlob(canvasToPdfBlob(result, 0.92), 'fullpage-' + stamp() + '.pdf'); });
      ui.querySelector('#fs-edit').addEventListener('click', function () {
        if (result) toEditor(result);
      });
      ui.querySelector('#fs-pro').addEventListener('click', function () {
        if (result) openInProEditor(result, function (ok, note) { if (note || !ok) status(note || 'تعذّر فتح المحرّر'); });
      });
  }

  /* Visible-viewport capture via getDisplayMedia — auto-copies to clipboard. */
  function mountVisibleShot(body){
    body.appendChild(h('<div class="syf-form"><button class="syf-btn" id="ss-go">التقاط لقطة</button><div class="syf-note-hint" id="ss-st">يلتقط نافذة أو شاشة تختارها ثم ينسخها تلقائياً للحافظة.</div><img id="ss-prev" alt="" style="max-width:100%;border-radius:10px;border:1px solid var(--line);display:none"><div class="syf-row" id="ss-actions" style="display:none"><button class="syf-mini" id="ss-copy">📋 نسخ للحافظة</button><a id="ss-dl" class="syf-mini" style="text-align:center;text-decoration:none">تنزيل PNG</a><button class="syf-mini" id="ss-edit">✏️ تحرير سريع</button><button class="syf-mini" id="ss-pro">🎨 المحرر الاحترافي</button></div></div>'));
    var st=body.querySelector('#ss-st'),prev=body.querySelector('#ss-prev'),dl=body.querySelector('#ss-dl'),actions=body.querySelector('#ss-actions');
    var shot=null;
    function copyShot(cb){ if(!shot){cb&&cb(false);return;} if(!(navigator.clipboard&&window.ClipboardItem)){cb&&cb(false,'الحافظة غير مدعومة (يحتاج HTTPS)');return;} shot.toBlob(function(blob){ if(!blob){cb&&cb(false);return;} navigator.clipboard.write([new ClipboardItem({'image/png':blob})]).then(function(){cb&&cb(true);}).catch(function(e){cb&&cb(false,e&&e.message);}); },'image/png'); }
    body.querySelector('#ss-copy').addEventListener('click',function(){ copyShot(function(ok,err){ st.textContent=ok?SYFS.t('نُسِخت للحافظة ✓'):SYFS.t('تعذّر النسخ: {0}',err||''); }); });
    /* hand the full-resolution shot to the editor (same contract as the fullshot tool) */
    body.querySelector('#ss-edit').addEventListener('click',function(){
      if(shot) toEditor(shot);
    });
    body.querySelector('#ss-pro').addEventListener('click',function(){
      if(shot) openInProEditor(shot,function(ok,note){ if(note||!ok) st.textContent=note||SYFS.t('تعذّر فتح المحرّر'); });
    });
    body.querySelector('#ss-go').addEventListener('click',function(){
      if(!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia){st.textContent=SYFS.t('غير مدعوم في هذا المتصفّح.');return;}
      st.textContent=SYFS.t('اختر ما تريد التقاطه…');
      navigator.mediaDevices.getDisplayMedia({video:true}).then(function(stream){
        var video=document.createElement('video');video.srcObject=stream;video.muted=true;video.play();
        video.onloadedmetadata=function(){ setTimeout(function(){
          var c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;c.getContext('2d').drawImage(video,0,0);
          stream.getTracks().forEach(function(t){t.stop();});
          shot=c;
          var url=c.toDataURL('image/png');prev.src=url;prev.style.display='';dl.href=url;dl.download='screenshot.png';actions.style.display='';
          copyShot(function(ok){ st.textContent=ok?SYFS.t('تم الالتقاط ونُسِخ للحافظة ✓'):SYFS.t('تم الالتقاط ✓ — اضغط «نسخ للحافظة»'); });
        },250); };
      }).catch(function(){st.textContent=SYFS.t('أُلغي الالتقاط.');});
    });
  }

  /* ===================== 1b) التقاط منطقة محدَّدة ===================== */
  function raf2() { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); }
  function vw() { return document.documentElement.clientWidth; }
  function vh() { return document.documentElement.clientHeight; }

  function scrollEl() { return document.scrollingElement || document.documentElement; }

  /* Full-viewport scrim in its own shadow root (page CSS can't reach it).
   *
   * The rect is tracked in DOCUMENT coordinates, not viewport ones: the page keeps
   * scrolling while you drag (wheel, or auto-scroll when the pointer nears an edge),
   * so a selection may be taller than the screen. Everything is re-projected to
   * viewport coords on every scroll.
   *
   * Visibility is toggled with a `.hide` class, never `style.display = ''` — clearing
   * the inline style just re-exposes the stylesheet's `display:none` and the element
   * stays invisible. That bug shipped in v0.46.0 and made the marquee never appear.
   *
   * The dark scrim is the selection rect's own huge box-shadow spread, so the selected
   * area is the one thing NOT covered — the hole is exact and needs no extra elements. */
  function selectRegion() {
    return new Promise(function (resolve) {
      var se = scrollEl();
      var host = document.createElement('div');
      /* direction on the host — same reason as miniToast: outside .syfs-wrap */
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;'
        + 'direction:' + ((SYFS.i18n && SYFS.i18n.dir()) || 'rtl');
      var sr = host.attachShadow({ mode: 'open' });
      sr.innerHTML =
        '<style>' +
          '.hide{display:none!important}' +
          '.scrim{position:fixed;inset:0;cursor:crosshair}' +
          '.dim{position:fixed;inset:0;background:rgba(15,23,42,.55);pointer-events:none}' +
          /* the shadow paints OUTSIDE the rect — the selection stays fully lit */
          '.sel{position:fixed;box-sizing:border-box;border:1.5px solid #fff;pointer-events:none;' +
            'box-shadow:0 0 0 100vmax rgba(15,23,42,.55),0 0 0 1px rgba(0,0,0,.5) inset}' +
          '.tip{position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;font:600 13px system-ui,sans-serif;padding:7px 14px;border-radius:999px;white-space:nowrap;pointer-events:none}' +
          '.badge{position:fixed;background:#0f172a;color:#fff;font:600 12px system-ui,sans-serif;padding:3px 8px;border-radius:6px;pointer-events:none;white-space:nowrap}' +
        '</style>' +
        '<div class="scrim">' +
          '<div class="dim"></div><div class="sel hide"></div>' +
          '<div class="tip">اسحب لتحديد المنطقة · مرّر بالعجلة لتحديد أطول من الشاشة · أفلت للالتقاط · Esc إلغاء</div>' +
          '<div class="badge hide"></div>' +
        '</div>';
      document.documentElement.appendChild(host);

      var scrim = sr.querySelector('.scrim'), dim = sr.querySelector('.dim'), sel = sr.querySelector('.sel');
      var badge = sr.querySelector('.badge');
      var startDoc = null, curDoc = null, dragging = false, rect = null, edgeTimer = 0;

      function docMax() {
        return { w: Math.max(se.scrollWidth, vw()), h: Math.max(se.scrollHeight, vh()) };
      }
      function toDoc(e) {
        var m = docMax();
        return {
          x: Math.max(0, Math.min(m.w, e.clientX + se.scrollLeft)),
          y: Math.max(0, Math.min(m.h, e.clientY + se.scrollTop))
        };
      }
      function norm(a, b) {
        return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
      }
      /* doc rect -> viewport pixels */
      function paint(r) {
        var vx = r.x - se.scrollLeft, vy = r.y - se.scrollTop;
        dim.classList.add('hide');
        sel.classList.remove('hide');
        sel.style.left = vx + 'px'; sel.style.top = vy + 'px';
        sel.style.width = r.w + 'px'; sel.style.height = r.h + 'px';
        badge.classList.remove('hide');
        badge.textContent = Math.round(r.w) + ' × ' + Math.round(r.h) + (r.h > vh() ? SYFS.t(' (تمرير)') : '');
        badge.style.left = Math.max(2, Math.min(vx, vw() - 120)) + 'px';
        badge.style.top = (vy > 26 ? Math.min(vy - 24, vh() - 24) : Math.max(2, vy + r.h + 6)) + 'px';
      }
      function reset() {
        rect = null; startDoc = curDoc = null;
        sel.classList.add('hide'); badge.classList.add('hide');
        dim.classList.remove('hide');
      }
      function onScroll() {
        if (dragging && startDoc && curDoc) { rect = norm(startDoc, curDoc); paint(rect); }
      }
      function done(r) {
        stopEdge();
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('scroll', onScroll, true);
        host.remove();
        resolve(r);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
      }
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', onScroll, true);

      /* auto-scroll while the pointer is dragged against the top/bottom edge */
      function stopEdge() { if (edgeTimer) { clearInterval(edgeTimer); edgeTimer = 0; } }
      function edgeScroll(clientY) {
        stopEdge();
        var EDGE = 60, STEP = 24;
        var dir = clientY < EDGE ? -1 : (clientY > vh() - EDGE ? 1 : 0);
        if (!dir || !dragging) return;
        edgeTimer = setInterval(function () {
          if (!dragging) { stopEdge(); return; }
          se.scrollTop += dir * STEP;
          curDoc.y = Math.max(0, Math.min(docMax().h, curDoc.y + dir * STEP));
          rect = norm(startDoc, curDoc);
          paint(rect);
        }, 16);
      }

      scrim.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        scrim.setPointerCapture(e.pointerId);
        dragging = true; rect = null;
        startDoc = curDoc = toDoc(e);
        paint(norm(startDoc, curDoc));
      });
      scrim.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        curDoc = toDoc(e);
        rect = norm(startDoc, curDoc);
        paint(rect);
        edgeScroll(e.clientY);
      });
      /* Releasing the pointer captures immediately — there is no confirm button.
       * The promise resolves inside the pointerup handler, so the transient user
       * activation is still live when copyCanvas() reaches navigator.clipboard.write. */
      scrim.addEventListener('pointerup', function () {
        if (!dragging) return;
        dragging = false; stopEdge();
        var r = norm(startDoc, curDoc);
        if (r.w < 8 || r.h < 8) { reset(); return; }        /* a click, not a drag */
        done(r);
      });
      /* ⚠️ `pointercancel` ليس حالة نادرة: المتصفّح ينتزع الإيماءة (تمرير باللمس، فقد التركيز،
       * تبديل نافذة) و**لا يُطلق `pointerup` بعدها أبداً**. بدون هذا المستمع يبقى `dragging`
       * مرفوعاً ويظلّ مؤقّت التمرير عند الحافة يمرّر الصفحة إلى ما لا نهاية بلا سحب يوقفه —
       * وحده Esc كان يوقفه. والإلغاء **يُلغي ولا يلتقط**: إيماءةٌ انتزعها المتصفّح لم يُفلتها
       * المستخدم، فالتقاط منطقة لم يطلبها مفاجأة لا إنقاذ. */
      scrim.addEventListener('pointercancel', function () {
        dragging = false; stopEdge(); reset();
      });
    });
  }

  /* Capture a DOCUMENT-coordinate rect. If it already fits inside the current viewport
   * it is one captureVisibleTab + a crop. Otherwise the page is scrolled and the slices
   * are stitched, exactly like the full-page tool — fixed/sticky bars are hidden first
   * so they don't repeat down the image.
   *
   * The scale always comes from the returned image (img.width / clientWidth), never from
   * devicePixelRatio: under browser zoom the two disagree and the crop lands off-target. */
  async function captureDocRegion(rect, onStatus) {
    var se = scrollEl(), de = document.documentElement;
    var x0 = se.scrollLeft, y0 = se.scrollTop, sb = de.style.scrollBehavior;
    var hiddenEls = [];
    var VW = vw(), VH = vh();
    var note = '';

    /* a rect wider than the viewport would need horizontal stitching too — out of scope */
    if (rect.w > VW) { rect = { x: rect.x, y: rect.y, w: VW, h: rect.h }; note = ' — قُصّ العرض عند عرض الشاشة'; }

    var multiPass = rect.y < y0 || rect.y + rect.h > y0 + VH || rect.x < x0 || rect.x + rect.w > x0 + VW;

    try {
      de.style.scrollBehavior = 'auto';
      if (multiPass) {
        /* fixed/sticky elements are painted into every slice — hide them or they repeat */
        var all = document.body ? document.body.getElementsByTagName('*') : [];
        var n = Math.min(all.length, 4000);
        for (var i = 0; i < n; i++) {
          var pos = getComputedStyle(all[i]).position;
          if (pos === 'fixed' || pos === 'sticky') { hiddenEls.push([all[i], all[i].style.visibility]); all[i].style.visibility = 'hidden'; }
        }
        se.scrollLeft = Math.max(0, Math.min(rect.x, se.scrollWidth - VW));
        se.scrollTop = Math.max(0, Math.min(rect.y, se.scrollHeight - VH));
        await sleep(450);
      }

      onStatus && onStatus('التصوير…');
      var first = await capture();
      if (!first.ok) throw new Error(first.error || 'capture-failed');
      var im = await loadImg(first.url);
      var scale = im.width / Math.max(1, VW);

      /* stay inside the canvas dimension limit */
      if (rect.h * scale > MAX_DEV) { rect = { x: rect.x, y: rect.y, w: rect.w, h: MAX_DEV / scale }; note += ' — اقتُطع الطول عند الحد الأقصى'; }

      var cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(rect.w * scale));
      cv.height = Math.max(1, Math.round(rect.h * scale));
      var cx = cv.getContext('2d');
      var srcX = (rect.x - se.scrollLeft) * scale;
      var sw = rect.w * scale;
      var bottomEdge = rect.y + rect.h;
      var sy = se.scrollTop, lastSy = -1, guard = 0;

      while (guard++ < 120) {
        /* the slice of the document currently on screen is [sy, sy + VH] */
        var top = Math.max(rect.y, sy), bot = Math.min(bottomEdge, sy + VH);
        if (bot > top) {
          cx.drawImage(im,
            srcX, (top - sy) * scale, sw, (bot - top) * scale,
            0, (top - rect.y) * scale, sw, (bot - top) * scale);
        }
        if (bot >= bottomEdge - 0.5) break;

        se.scrollTop = sy + VH;
        await sleep(600);                                   /* render settle + stay under 2 captures/sec */
        lastSy = sy;
        sy = se.scrollTop;
        if (sy <= lastSy) break;                            /* clamped at the bottom — stop */
        var r = await capture();
        if (!r.ok) { await sleep(700); r = await capture(); }   /* one retry (rate limit) */
        if (!r.ok) throw new Error(r.error || 'capture-failed');
        im = await loadImg(r.url);
        srcX = (rect.x - se.scrollLeft) * scale;
        onStatus && onStatus('التصوير… ' + Math.min(100, Math.round(((bot - rect.y) / rect.h) * 100)) + '%');
      }
      return { canvas: cv, note: note };
    } finally {
      hiddenEls.forEach(function (hv) { hv[0].style.visibility = hv[1]; });
      de.style.scrollBehavior = sb;
      se.scrollTop = y0; se.scrollLeft = x0;
    }
  }

  /* Select → capture → auto-copy. Shared by the panel tab and the standalone
   * hotkey tool, so both behave identically.
   *
   * The clipboard write needs a live transient user activation. selectRegion()
   * resolves inside its own pointerup handler, so a single-pass capture (the rect
   * fits the viewport) still lands inside the 5s activation window. A scroll-and-
   * stitch capture waits ~600ms per slice and will outlive it — copy then fails and
   * the caller is told to use the copy button. That is reported, never swallowed. */
  var regionBusy = false;
  async function runRegionCapture(onStatus, noCopy) {
    if (regionBusy) return null;
    regionBusy = true;
    /* Our own chrome lives outside document.body, so captureDocRegion's fixed/sticky
     * sweep never sees it — hide it here or it is baked into the shot. The rail goes
     * first (it would sit over the region you are trying to drag); the toast stays up
     * until the drag ends, since it carries the instructions. */
    var hidden = [], prev = [];
    function hide(el) { if (el) { hidden.push(el); prev.push(el.style.display); el.style.display = 'none'; } }
    hide(document.getElementById('syfs-host'));
    try {
      var rect = await selectRegion();
      if (!rect) return null;
      [].forEach.call(document.querySelectorAll('[data-syfs-shot-hide]'), hide);
      await raf2();                                          /* let the overlay's removal paint */
      var out = await captureDocRegion(rect, onStatus);
      if (!noCopy) out.copied = await new Promise(function (res) { copyCanvas(out.canvas, function (ok) { res(!!ok); }); });
      return out;
    } finally {
      hidden.forEach(function (el, i) { el.style.display = prev[i]; });
      regionBusy = false;
    }
  }
  /* The viewport as it is → canvas. No picker: SYFS_CAPTURE shoots this tab as it is,
   * so our own chrome (rail host + every data-syfs-shot-hide overlay, the floating bar
   * included) is hidden for the frame and put back in `finally`. Shared by the bar's
   * «المرئي» (quickShot) and the studio's «الشاشة المرئية» (v0.166.0). Throws on failure. */
  var visibleBusy = false;
  async function visibleCanvas() {
    if (visibleBusy) throw new Error('busy');
    visibleBusy = true;
    var hidden = [], prev = [];
    function hide(el) { if (el) { hidden.push(el); prev.push(el.style.display); el.style.display = 'none'; } }
    try {
      hide(document.getElementById('syfs-host'));
      [].forEach.call(document.querySelectorAll('[data-syfs-shot-hide]'), hide);
      await raf2();
      var r = await capture();
      if (!r.ok) { await sleep(700); r = await capture(); }
      if (!r.ok) throw new Error(r.error || 'capture-failed');
      var im = await loadImg(r.url);
      var cv = document.createElement('canvas');
      cv.width = im.width; cv.height = im.height;
      cv.getContext('2d').drawImage(im, 0, 0);
      return cv;
    } finally {
      hidden.forEach(function (el, i) { el.style.display = prev[i]; });
      visibleBusy = false;
    }
  }
  function shotLabel(out) {
    return (out.copied ? 'تم ✅ نُسِخت للحافظة' : 'تم ✅ (اضغط زر النسخ — تعذّر النسخ التلقائي)') +
           ' · ' + out.canvas.width + '×' + out.canvas.height + (out.note || '');
  }

  /* v0.169.0 — what a quick capture (the floating bar's three buttons, the «التقاط
   * منطقة» hotkey) does with the shot: «المحرر» opens it in the studio's editor (the
   * default), «نسخ» puts it on the clipboard with the toast's buttons as a way on.
   * One stored choice, `cap_after`, set on the bar or in the studio's settings and
   * read fresh on every capture — whitelisted, storage is shared with settings import. */
  var AFTER = ['editor', 'copy'];
  function afterMode() {
    if (!(SYFS.store && SYFS.store.get)) return Promise.resolve('editor');
    return SYFS.store.get('cap_after', 'editor').then(function (v) { return AFTER.indexOf(v) >= 0 ? v : 'editor'; });
  }
  var quickBusy = false;
  async function quickShot(kind) {
    if (quickBusy) return;
    quickBusy = true;
    var t = null;
    try {
      var mode = await afterMode(), out = null;
      if (kind === 'region') {
        t = miniToast(SYFS.t('اسحب لتحديد المنطقة…'), 0);
        out = await runRegionCapture(function (m) { t.set(m); }, mode === 'editor');
        if (!out) { t.close(); return; }
      } else if (kind === 'full') {
        t = miniToast(SYFS.t('التصوير…'), 0);
        out = await fullPageCanvas(function (m) { t.set(m); });
        out.note = out.cut ? SYFS.t(' — اقتُطعت الصفحة عند الحد الأقصى') : '';
      } else {
        if (visibleBusy) return;
        out = { canvas: await visibleCanvas(), note: '' };
      }
      if (mode === 'editor') { if (t) t.close(); toEditor(out.canvas); return; }
      /* a stitched capture can outlive the click's activation — the copy then fails and
         the toast says so, with its own copy button */
      if (out.copied === undefined) out.copied = await new Promise(function (res) { copyCanvas(out.canvas, function (ok) { res(!!ok); }); });
      (t || miniToast('', 0)).set(shotLabel(out), out.canvas);
    } catch (e) {
      (t || miniToast('', 0)).set(SYFS.t('فشل الالتقاط: {0}', (e && e.message ? e.message : String(e))));
    } finally {
      quickBusy = false;
    }
  }

  function mountRegionShot(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<button class="syf-btn" id="rs-go">✂️ حدّد منطقة والتقطها</button>' +
        '<div class="syf-note-hint" id="rs-st">اسحب مستطيلاً على الصفحة — تُلتقط وتُنسخ فور إفلات الفأرة. مرّر بالعجلة (أو اسحب نحو حافة الشاشة) لتحديد منطقة أطول من الشاشة: تُصوَّر بالتمرير وتُدمج. عيّن اختصاراً لأداة «التقاط منطقة» من الإعدادات لتشغيلها من أي صفحة.</div>' +
        '<img id="rs-prev" alt="" style="max-width:100%;max-height:300px;border-radius:10px;border:1px solid var(--line);display:none">' +
        '<div class="syf-row" id="rs-actions" style="display:none">' +
          '<button class="syf-mini ico" id="rs-copy" title="نسخ للحافظة" aria-label="نسخ للحافظة">' + I_COPY + '</button>' +
          '<button class="syf-mini ico" id="rs-png" title="تنزيل PNG" aria-label="تنزيل PNG">' + I_DOWN + '</button>' +
          '<button class="syf-mini ico" id="rs-edit" title="تحرير سريع" aria-label="تحرير سريع">' + I_EDIT + '</button>' +
          '<button class="syf-mini ico" id="rs-pro" title="المحرر الاحترافي" aria-label="المحرر الاحترافي">' + I_PRO + '</button>' +
        '</div>' +
      '</div>'
    ));
    var st = body.querySelector('#rs-st'), prev = body.querySelector('#rs-prev'), actions = body.querySelector('#rs-actions');
    var goBtn = body.querySelector('#rs-go');
    var shot = null;

    async function run() {
      if (goBtn.disabled) return;
      goBtn.disabled = true;
      try {
        var out = await runRegionCapture(function (t) { st.textContent = t; });
        if (!out) { st.textContent = SYFS.t('أُلغي التحديد.'); return; }
        shot = out.canvas;
        prev.src = shot.toDataURL('image/jpeg', 0.85);       /* light preview only */
        prev.style.display = '';
        actions.style.display = '';
        st.textContent = shotLabel(out);
      } catch (e) {
        st.textContent = SYFS.t('فشل الالتقاط: {0}', (e && e.message ? e.message : e));
      } finally {
        goBtn.disabled = false;
      }
    }

    goBtn.addEventListener('click', run);
    body.querySelector('#rs-copy').addEventListener('click', function () {
      if (shot) copyCanvas(shot, function (ok, err) { st.textContent = ok ? SYFS.t('نُسِخت للحافظة ✓') : SYFS.t('تعذّر النسخ: {0}', err || ''); });
    });
    body.querySelector('#rs-png').addEventListener('click', function () { if (shot) dl(shot.toDataURL('image/png'), 'region-' + stamp() + '.png'); });
    body.querySelector('#rs-edit').addEventListener('click', function () {
      if (shot) toEditor(shot);
    });
    body.querySelector('#rs-pro').addEventListener('click', function () {
      if (shot) openInProEditor(shot, function (ok, note) { if (note || !ok) st.textContent = note || SYFS.t('تعذّر فتح المحرّر'); });
    });
  }

  SYFS.tools.push({
    id: 'screenshot', name: 'لقطة شاشة', cat: 'media',
    icon: FULLSHOT_ICON,
    mount: function (body) {
      SYFS.tabs(body, [
        { label: 'تحديد منطقة', build: mountRegionShot },
        { label: 'المنطقة المرئية', build: mountVisibleShot },
        { label: 'الصفحة كاملة', build: mountFullshot }
      ]);
    }
  });

  /* Standalone, window-less tool: an `action` runs on click AND on its keyboard
   * combo (rail.js runHotkey calls t.action()). No panel opens — the scrim comes
   * up at once, and on release the shot goes where `cap_after` says (quickShot). */
  SYFS.tools.push({
    id: 'regionshot', name: 'التقاط منطقة', cat: 'media',
    icon: REGION_ICON,
    action: function () { quickShot('region'); }
  });

  /* ===================== 2) محرر الصور السريع ===================== */
  var IMGEDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M14.3 7.2l2.5 2.5"/><path d="M8 16l.9-3.4 6.3-6.3 2.5 2.5-6.3 6.3z"/></svg>';
  function mountImgEdit(body) {
      try { body.parentElement.style.width = '430px'; } catch (e) {}
      var ui = h(
        '<div class="syf-form">' +
          '<input type="file" id="ie-file" accept="image/*" class="syf-in" style="padding:6px">' +
          '<div class="syf-seg" id="ie-tools">' +
            '<button data-t="pen" class="on">قلم</button><button data-t="line">خط</button><button data-t="rect">إطار</button>' +
            '<button data-t="arrow">سهم</button><button data-t="text">نص</button><button data-t="crop">قص</button>' +
            '<button data-t="blur">طمس</button>' +
          '</div>' +
          '<div class="syf-row">' +
            '<input type="color" id="ie-color" value="#e11d48" title="اللون" style="width:42px;height:30px;border:none;background:none;padding:0;cursor:pointer">' +
            '<input type="range" id="ie-size" min="2" max="16" value="4" title="السماكة (وشدّة الطمس)">' +
            '<button class="syf-mini" id="ie-rot" title="تدوير 90°">⟳</button>' +
            '<button class="syf-mini" id="ie-undo" title="تراجع">↩</button>' +
          '</div>' +
          '<div class="syf-row" id="ie-textrow" style="display:none"><input class="syf-in" id="ie-text" placeholder="اكتب النص ثم انقر موضعه على الصورة"></div>' +
          '<div class="syf-row" id="ie-croprow" style="display:none"><button class="syf-mini" id="ie-cropok">✓ تأكيد القص</button><button class="syf-mini" id="ie-cropno">✕ إلغاء</button><span class="syf-note-hint" style="flex:1">اسحب مستطيلاً جديداً لإعادة التحديد.</span></div>' +
          '<canvas id="ie-cv" style="width:100%;border:1px solid #e5e9f2;border-radius:8px;cursor:crosshair;display:none;touch-action:none"></canvas>' +
          '<div class="syf-empty" id="ie-hint">افتح صورة للبدء — أو «فتح في المحرر» من أداة التصوير.</div>' +
          '<div class="syf-row"><button class="syf-btn" id="ie-png" style="flex:1">تنزيل PNG</button><button class="syf-mini" id="ie-copy">📋 نسخ</button><button class="syf-mini" id="ie-jpg">JPG</button><button class="syf-mini" id="ie-pdf">PDF</button></div>' +
          '<div class="syf-row"><button class="syf-mini" id="ie-pro" style="flex:1">🎨 افتح في المحرر الاحترافي (طبقات · مرشّحات · تراجع غير محدود)</button></div>' +
          '<div class="syf-note-hint" id="ie-st" style="display:none"></div>' +
        '</div>'
      );
      body.appendChild(ui);

      var disp = ui.querySelector('#ie-cv'), dx = disp.getContext('2d');
      var base = document.createElement('canvas'), bx = base.getContext('2d');   /* committed state, full res */
      var hint = ui.querySelector('#ie-hint'), textRow = ui.querySelector('#ie-textrow'), textIn = ui.querySelector('#ie-text');
      var cropRow = ui.querySelector('#ie-croprow'), stEl = ui.querySelector('#ie-st');
      var colorIn = ui.querySelector('#ie-color'), sizeIn = ui.querySelector('#ie-size');
      var tool = 'pen', drawing = false, sx = 0, sy = 0, hist = [], loaded = false;
      var cropRect = null;   /* pending crop, awaiting confirm — {x,y,w,h} */

      function status(t) { stEl.style.display = t ? '' : 'none'; stEl.textContent = t || ''; }
      function blit() { dx.clearRect(0, 0, disp.width, disp.height); dx.drawImage(base, 0, 0); }
      function dashRect(r) { dx.save(); dx.strokeStyle = '#e11d48'; dx.lineWidth = Math.max(1, viewScale()); dx.setLineDash([8, 6]); dx.strokeRect(r.x, r.y, r.w, r.h); dx.restore(); }
      function clearCrop() { cropRect = null; cropRow.style.display = 'none'; blit(); }
      function setSize(w, hgt) { base.width = w; base.height = hgt; disp.width = w; disp.height = hgt; }
      function pushHist() { hist.push(base.toDataURL('image/png')); if (hist.length > 10) hist.shift(); }
      function commit() { bx.clearRect(0, 0, base.width, base.height); bx.drawImage(disp, 0, 0); }
      /* keep the visual thickness constant regardless of the CSS downscale */
      function viewScale() { var r = disp.getBoundingClientRect(); return Math.max(1, disp.width / Math.max(1, r.width)); }
      function stroke(g) { g.strokeStyle = colorIn.value; g.lineWidth = +sizeIn.value * viewScale(); g.lineCap = 'round'; g.lineJoin = 'round'; }
      function pos(e) {
        var r = disp.getBoundingClientRect();
        return { x: (e.clientX - r.left) * disp.width / r.width, y: (e.clientY - r.top) * disp.height / r.height };
      }
      function loadFromUrl(url) {
        loadImg(url).then(function (im) {
          var s = Math.min(1, 6000 / Math.max(im.width, im.height));   /* cap huge sources */
          setSize(Math.round(im.width * s), Math.round(im.height * s));
          bx.drawImage(im, 0, 0, base.width, base.height);
          cropRect = null; cropRow.style.display = 'none';
          blit();
          hist = []; loaded = true; status('');
          disp.style.display = ''; hint.style.display = 'none';
        }).catch(function () { hint.textContent = SYFS.t('تعذّر فتح الصورة.'); });
      }

      /* image handed over from the fullshot tool */
      if (SYFS._imgToEdit) { loadFromUrl(SYFS._imgToEdit); SYFS._imgToEdit = null; }

      ui.querySelector('#ie-file').addEventListener('change', function () {
        var f = this.files && this.files[0]; if (!f) return;
        var rd = new FileReader();
        rd.onload = function () { loadFromUrl(rd.result); };
        rd.readAsDataURL(f);
      });

      ui.querySelector('#ie-tools').addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        tool = b.dataset.t;
        this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        textRow.style.display = tool === 'text' ? '' : 'none';
        disp.style.cursor = tool === 'text' ? 'text' : 'crosshair';
        if (tool !== 'crop' && cropRect) clearCrop();     /* leaving crop drops the pending marquee */
      });

      function drawArrow(g, x1, y1, x2, y2) {
        var a = Math.atan2(y2 - y1, x2 - x1), L = Math.max(12, g.lineWidth * 3.5);
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2);
        g.moveTo(x2, y2); g.lineTo(x2 - L * Math.cos(a - 0.45), y2 - L * Math.sin(a - 0.45));
        g.moveTo(x2, y2); g.lineTo(x2 - L * Math.cos(a + 0.45), y2 - L * Math.sin(a + 0.45));
        g.stroke();
      }

      /* Pointer capture lets a drag leave the canvas, so a marquee can extend past the
       * image. Clamp it, or drawImage() samples outside the source and bakes in
       * transparent bands. Returns null when nothing is left inside. */
      function clampRect(x, y, w, hgt) {
        var x0 = Math.max(0, Math.min(x, base.width)), y0 = Math.max(0, Math.min(y, base.height));
        var x1 = Math.max(0, Math.min(x + w, base.width)), y1 = Math.max(0, Math.min(y + hgt, base.height));
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }

      /* Redact a region by mosaicking it: downscale to blocks, then upscale with
       * smoothing off. Destroys the pixels on `base` — the exported image carries
       * no recoverable original (unlike a CSS blur). Clipped so only the rect changes.
       * Block size is scaled by viewScale() so the slider means the same thing whether
       * the source is a 400px thumbnail or a 3000px screenshot. */
      function applyBlur(x, y, w, hgt) {
        var block = Math.max(6, Math.round(+sizeIn.value * 2 * viewScale()));
        var sw = Math.max(1, Math.round(w / block)), sh = Math.max(1, Math.round(hgt / block));
        var small = document.createElement('canvas');
        small.width = sw; small.height = sh;
        small.getContext('2d').drawImage(base, x, y, w, hgt, 0, 0, sw, sh);
        bx.save();
        bx.beginPath(); bx.rect(x, y, w, hgt); bx.clip();
        bx.imageSmoothingEnabled = false;
        bx.drawImage(small, 0, 0, sw, sh, x, y, w, hgt);
        bx.restore();                                                /* restores imageSmoothingEnabled + clip */
      }

      disp.addEventListener('pointerdown', function (e) {
        if (!loaded) return;
        e.preventDefault(); disp.setPointerCapture(e.pointerId);
        var p = pos(e); sx = p.x; sy = p.y;
        if (tool === 'text') {
          var t = (textIn.value || '').trim(); if (!t) { textIn.focus(); return; }
          pushHist();
          bx.fillStyle = colorIn.value;
          bx.font = '700 ' + Math.round(+sizeIn.value * 5 * viewScale()) + 'px Tajawal, system-ui, sans-serif';
          bx.textBaseline = 'middle';
          bx.fillText(t, p.x, p.y);
          blit();
          return;
        }
        if (tool === 'crop' && cropRect) { cropRect = null; cropRow.style.display = 'none'; blit(); }  /* new marquee replaces the pending one */
        drawing = true;
        if (tool === 'pen') { pushHist(); dx.beginPath(); dx.moveTo(p.x, p.y); stroke(dx); }
      });
      disp.addEventListener('pointermove', function (e) {
        if (!drawing || !loaded) return;
        var p = pos(e);
        if (tool === 'pen') { dx.lineTo(p.x, p.y); dx.stroke(); return; }
        blit(); stroke(dx);
        if (tool === 'line') { dx.beginPath(); dx.moveTo(sx, sy); dx.lineTo(p.x, p.y); dx.stroke(); }
        else if (tool === 'rect') { dx.strokeRect(Math.min(sx, p.x), Math.min(sy, p.y), Math.abs(p.x - sx), Math.abs(p.y - sy)); }
        else if (tool === 'arrow') { drawArrow(dx, sx, sy, p.x, p.y); }
        else if (tool === 'crop' || tool === 'blur') { dashRect({ x: Math.min(sx, p.x), y: Math.min(sy, p.y), w: Math.abs(p.x - sx), h: Math.abs(p.y - sy) }); }
      });
      disp.addEventListener('pointerup', function (e) {
        if (!drawing || !loaded) return;
        drawing = false;
        var p = pos(e);
        if (tool === 'pen') { commit(); return; }
        if (tool === 'crop' || tool === 'blur') {
          var r = clampRect(Math.round(Math.min(sx, p.x)), Math.round(Math.min(sy, p.y)),
                            Math.round(Math.abs(p.x - sx)), Math.round(Math.abs(p.y - sy)));
          blit();                                       /* drop the dashed preview */
          if (r.w < 8 || r.h < 8) return;               /* stray click, or dragged off-image — ignore */
          if (tool === 'blur') { pushHist(); applyBlur(r.x, r.y, r.w, r.h); blit(); status('طُمِست المنطقة — الطمس نهائي على البكسل.'); return; }
          cropRect = r;                                 /* stage it; the user confirms below */
          cropRow.style.display = '';
          dashRect(cropRect);
          return;
        }
        pushHist(); commit();
      });

      ui.querySelector('#ie-cropok').addEventListener('click', function () {
        if (!loaded || !cropRect) return;
        var r = cropRect;
        pushHist();
        var tmp = document.createElement('canvas'); tmp.width = r.w; tmp.height = r.h;
        tmp.getContext('2d').drawImage(base, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        cropRect = null; cropRow.style.display = 'none';
        setSize(r.w, r.h); bx.drawImage(tmp, 0, 0); blit();
        status('تم القص — ' + r.w + '×' + r.h);
      });
      ui.querySelector('#ie-cropno').addEventListener('click', function () { clearCrop(); status(''); });

      ui.querySelector('#ie-rot').addEventListener('click', function () {
        if (!loaded) return;
        if (cropRect) clearCrop();                      /* rect coords are stale after a rotate */
        pushHist();
        var tmp = document.createElement('canvas'); tmp.width = base.height; tmp.height = base.width;
        var tg = tmp.getContext('2d');
        tg.translate(tmp.width / 2, tmp.height / 2); tg.rotate(Math.PI / 2);
        tg.drawImage(base, -base.width / 2, -base.height / 2);
        setSize(tmp.width, tmp.height); bx.drawImage(tmp, 0, 0); blit();
      });
      ui.querySelector('#ie-undo').addEventListener('click', function () {
        var u = hist.pop(); if (!u) return;
        if (cropRect) clearCrop();
        loadImg(u).then(function (im) { setSize(im.width, im.height); bx.drawImage(im, 0, 0); blit(); });
      });
      ui.querySelector('#ie-copy').addEventListener('click', function () {
        if (!loaded) return;
        copyCanvas(base, function (ok, err) { status(ok ? 'نُسِخت الصورة للحافظة ✓' : 'تعذّر النسخ: ' + (err || '')); });
      });
      ui.querySelector('#ie-pro').addEventListener('click', function () {
        if (!loaded) { status('افتح صورة أولاً.'); return; }
        openInProEditor(base, function (ok, note) { if (note || !ok) status(note || 'تعذّر فتح المحرّر'); });
      });
      ui.querySelector('#ie-png').addEventListener('click', function () { if (loaded) dl(base.toDataURL('image/png'), 'edited-' + stamp() + '.png'); });
      ui.querySelector('#ie-jpg').addEventListener('click', function () {
        if (!loaded) return;
        var tmp = document.createElement('canvas'); tmp.width = base.width; tmp.height = base.height;
        var tg = tmp.getContext('2d');
        tg.fillStyle = '#fff'; tg.fillRect(0, 0, tmp.width, tmp.height);   /* JPEG has no alpha */
        tg.drawImage(base, 0, 0);
        dl(tmp.toDataURL('image/jpeg', 0.92), 'edited-' + stamp() + '.jpg');
      });
      ui.querySelector('#ie-pdf').addEventListener('click', function () { if (loaded) dlBlob(canvasToPdfBlob(base, 0.92), 'edited-' + stamp() + '.pdf'); });
  }

  SYFS.tools.push({
    id: 'imgedit', name: 'محرر الصور والمحوّل', cat: 'media',
    icon: IMGEDIT_ICON,
    mount: function (body) {
      SYFS.tabs(body, [
        { label: 'تحرير', build: mountImgEdit },
        { label: 'تحويل صيغة', build: mountImgConvert },
        { label: 'PDF ⇄ صور', build: mountPdfImages },
        { label: 'ضغط', build: mountImgCompress },
        { label: 'تغيير الحجم', build: mountImgResize },
        /* src/bgrm.js (loaded just before this file); absent ⇒ a line, not a thrown tab */
        { label: 'حذف الخلفية', build: function (p) {
          if (SYFS.bgrm) SYFS.bgrm.mount(p);
          else p.appendChild(h('<div class="syf-empty">تعذّر تحميل أداة حذف الخلفية.</div>'));
        } }
      ]);
    }
  });

  /* ================= converter plumbing (shared by both tabs) ================= */

  var PDF_IN_DPI = 150;                          /* rasterise a PDF source at this DPI in the format tab */
  function isPdfFile(f) {
    return ((f && f.type) === 'application/pdf') || /\.pdf$/i.test((f && f.name) || '');
  }
  function pad3(n) { return String(n).padStart(3, '0'); }

  /* Render one pdf.js page at `scale`, inside the browser's canvas limit
     (imgkit.fitCanvas). A poster or a CAD sheet at 300 DPI passed it and came back
     as an empty page; the scale is now lowered first and cv.syfsCapped says so. */
  async function renderPage(page, scale) {
    var vp = page.getViewport({ scale: scale });
    var fit = SYFS.imgkit.fitCanvas(vp.width, vp.height);
    if (fit.capped) vp = page.getViewport({ scale: scale * Math.min(fit.w / vp.width, fit.h / vp.height) });
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.min(fit.w, Math.round(vp.width)));
    cv.height = Math.max(1, Math.min(fit.h, Math.round(vp.height)));
    if (fit.capped) cv.syfsCapped = true;
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    return cv;
  }
  /* Render one pdf.js page to a canvas at the given DPI (PDF user space is 72 DPI). */
  async function renderPdfPage(doc, pageNo, dpi) {
    return renderPage(await doc.getPage(pageNo), dpi / 72);
  }

  /* Parse "1-3,7,10-12" against a page count.
   * Returns an ascending, de-duplicated, in-range list, or null when the text is
   * malformed / resolves to nothing. Empty input means "every page".
   * Strict regex first — no arithmetic is ever built from this string. */
  function parsePages(str, max) {
    str = String(str == null ? '' : str).trim();
    if (!str) { var all = []; for (var i = 1; i <= max; i++) all.push(i); return all; }
    if (!/^[\d,\s-]+$/.test(str)) return null;
    var out = [], seen = {};
    function add(n) { if (n >= 1 && n <= max && !seen[n]) { seen[n] = 1; out.push(n); } }
    var parts = str.split(',');
    for (var k = 0; k < parts.length; k++) {
      var part = parts[k].trim();
      if (!part) continue;
      var m = /^(\d+)\s*-\s*(\d+)$/.exec(part);
      if (m) {
        var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (a > b) { var t = a; a = b; b = t; }
        if (b - a > 5000) return null;                  /* refuse an absurd span */
        for (var p = a; p <= b; p++) add(p);
      } else if (/^\d+$/.test(part)) {
        add(parseInt(part, 10));
      } else {
        return null;
      }
    }
    out.sort(function (x, y) { return x - y; });
    return out.length ? out : null;
  }

  /* Walk a file list and hand every *image source* to cb(canvas, baseName).
   * An image file yields one canvas; a PDF yields one canvas per page. Sources
   * are produced one at a time so a big batch never holds every bitmap at once.
   * A file that cannot be read (HEIC, corrupt, password-protected PDF) is
   * reported through onError and *skipped* — one bad file must not kill a batch
   * of fifty good ones. Returns { ok, failed, capped } — capped counts sources the
   * canvas limit shrank (read BEFORE cb, which may free the canvas). */
  async function forEachSource(files, opts, cb, onFile, onError) {
    var kit = SYFS.imgkit, ok = 0, failed = 0, capped = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (onFile) onFile(f, i);
      try {
        if (isPdfFile(f)) {
          var pdfjs = await loadPdfjs();
          var doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
          try {
            var pages = parsePages(opts.pages || '', doc.numPages) || [];
            for (var p = 0; p < pages.length; p++) {
              var cv = await renderPdfPage(doc, pages[p], opts.dpi || PDF_IN_DPI);
              if (cv.syfsCapped) capped++;
              await cb(cv, safeBase(f.name) + '-p' + pad3(pages[p]), f, pages[p], pages.length);
              await sleep(0);
            }
          } finally {
            try { doc.destroy(); } catch (e) { /* ignore */ }
          }
        } else {
          var d = await kit.decodeAny(f);
          var canvas = kit.resize(d, {});               /* natural size, own canvas */
          kit.release(d);
          if (canvas.syfsCapped) capped++;
          await cb(canvas, safeBase(f.name), f, 1, 1);
          await sleep(0);
        }
        ok++;
      } catch (e) {
        failed++;
        if (onError) onError(e, f, i);
      }
    }
    return { ok: ok, failed: failed, capped: capped };
  }

  /* Downscale a canvas in place-ish if it exceeds a longest-side cap. */
  function capDim(canvas, maxDim) {
    if (!maxDim) return canvas;
    var big = Math.max(canvas.width, canvas.height);
    if (big <= maxDim) return canvas;
    var s = maxDim / big;
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(canvas.width * s));
    cv.height = Math.max(1, Math.round(canvas.height * s));
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(canvas, 0, 0, cv.width, cv.height);
    return cv;
  }

  /* ===================== 3) محوّل صيغ الصور ===================== */
  /* ===== format converter — any readable input → any writable output ===== */
  var ACCEPT_IN = 'image/*,.svg,.bmp,.ico,.gif,.avif,.tif,.tiff,application/pdf,.pdf';

  function mountImgConvert(body) {
      var kit = SYFS.imgkit;
      var ui = h(
        '<div class="syf-form">' +
          '<input type="file" id="ic-files" accept="' + ACCEPT_IN + '" multiple class="syf-in" style="padding:6px">' +
          '<div class="syf-note-hint" id="ic-count" style="display:none"></div>' +
          '<div class="syf-note-warn" id="ic-warn" style="display:none">⚠️ اخترت أكثر من 100 ملف — قد يتباطأ الجهاز أو يتهنّج أثناء التحويل على الأجهزة الضعيفة. يُفضَّل التحويل على دفعات بحد أقصى 100.</div>' +
          '<label>الصيغة الهدف</label>' +
          '<div class="syf-seg" id="ic-fmt">' +
            '<button data-f="png" class="on">PNG</button><button data-f="jpeg">JPG</button><button data-f="webp">WebP</button>' +
            '<button data-f="bmp">BMP</button><button data-f="ico">ICO</button><button data-f="gif">GIF</button>' +
            '<button data-f="tiff">TIFF</button><button data-f="pdf">PDF</button>' +
          '</div>' +
          '<div class="syf-row" id="ic-qrow" style="display:none"><label style="margin:0">الجودة <b id="ic-qv">90%</b></label><input type="range" id="ic-q" min="40" max="100" value="90" style="flex:1"></div>' +
          '<div id="ic-icorow" style="display:none"><label>مقاسات الأيقونة</label><div class="syf-seg" id="ic-ico"><button data-s="multi" class="on">متعدّد (16·32·48·256)</button><button data-s="16">16</button><button data-s="32">32</button><button data-s="48">48</button><button data-s="64">64</button><button data-s="128">128</button><button data-s="256">256</button></div></div>' +
          '<div id="ic-pdfrow" style="display:none">' +
            '<label class="syf-ck"><input type="checkbox" id="ic-merge" checked> <span>دمج الكل في ملف PDF واحد</span></label>' +
            '<label class="syf-ck"><input type="checkbox" id="ic-a4"> <span>ملاءمة صفحة A4 (توسيط مع هوامش) بدل مقاس الصورة</span></label>' +
          '</div>' +
          '<div class="syf-row"><label class="syf-ck"><input type="checkbox" id="ic-mwon"> <span>أقصى بُعد</span></label><input type="number" id="ic-mw" class="syf-in" value="1920" style="width:90px" disabled> بكسل</div>' +
          '<button class="syf-btn" id="ic-go">تحويل وتنزيل</button>' +
          '<div class="syf-note-list" id="ic-list"></div>' +
          '<div class="syf-note-hint">الدخل: PNG · JPG · WebP · GIF · BMP · ICO · AVIF · SVG · <b>PDF</b> (كل صفحة تصير صورة بدقّة ' + PDF_IN_DPI + ' DPI — للتحكّم بالدقّة استخدم تبويب «PDF ⇄ صور»). الخرج كما بالأعلى. التحويل محلي بالكامل — لا يُرفع أي ملف.</div>' +
          '<div class="syf-note-hint">⚠️ HEIC/HEIF و TIFF لا يفكّهما المتصفّح <b>قراءةً</b> (التصدير إلى TIFF مدعوم). AVIF يُقرأ ولا يُكتب. GIF: إطار واحد فقط (لا حركة).</div>' +
        '</div>'
      );
      body.appendChild(ui);
      var fmt = 'png', icoSel = 'multi';
      var qrow = ui.querySelector('#ic-qrow'), qIn = ui.querySelector('#ic-q'), qv = ui.querySelector('#ic-qv');
      var icoRow = ui.querySelector('#ic-icorow'), pdfRow = ui.querySelector('#ic-pdfrow');
      var mergeIn = ui.querySelector('#ic-merge'), a4In = ui.querySelector('#ic-a4');
      var mwOn = ui.querySelector('#ic-mwon'), mw = ui.querySelector('#ic-mw');
      var list = ui.querySelector('#ic-list'), filesIn = ui.querySelector('#ic-files'), goBtn = ui.querySelector('#ic-go');
      wireCount(filesIn, ui.querySelector('#ic-count'), ui.querySelector('#ic-warn'));
      filesIn.addEventListener('change', function () { list.innerHTML = ''; });
      mwOn.addEventListener('change', function () { mw.disabled = !mwOn.checked; });

      ui.querySelector('#ic-fmt').addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        fmt = b.dataset.f;
        this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        qrow.style.display = (fmt === 'jpeg' || fmt === 'webp' || fmt === 'pdf') ? '' : 'none';
        icoRow.style.display = fmt === 'ico' ? '' : 'none';
        pdfRow.style.display = fmt === 'pdf' ? '' : 'none';
      });
      ui.querySelector('#ic-ico').addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        icoSel = b.dataset.s;
        this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
      qIn.addEventListener('input', function () { qv.textContent = qIn.value + '%'; });

      goBtn.addEventListener('click', async function () {
        var files = filesIn.files;
        if (!files || !files.length) { filesIn.focus(); return; }
        if (goBtn.disabled) return;
        list.innerHTML = '';
        var q = kit.clampInt(qIn.value, 40, 100, 90) / 100;
        var maxDim = mwOn.checked ? kit.clampInt(mw.value, 16, 20000, 0) : 0;
        var icoSizes = icoSel === 'multi' ? [16, 32, 48, 256] : [parseInt(icoSel, 10)];
        var mergePdf = fmt === 'pdf' && mergeIn.checked;
        var pdfOpts = a4In.checked ? { fit: 'a4' } : null;
        /* merged pages go straight into the writer and their canvas is freed — the
           list of every canvas held to the end was a known gap left by v0.139.2 */
        var results = [], writer = mergePdf ? window.SYFS_PDF.createWriter(pdfOpts) : null, sources = 0, row = null;
        await withBusy(goBtn, async function () {
          var tally = await forEachSource(
            files,
            { dpi: PDF_IN_DPI },
            async function (canvas, base) {
              canvas = capDim(canvas, maxDim);
              sources++;
              if (writer) { await writer.addAsync(canvas, q); canvas.width = canvas.height = 0; return; }
              if (fmt === 'pdf') {
                results.push({ name: base + '.pdf', blob: canvasToPdfBlob(canvas, q, pdfOpts) });
              } else {
                var out = await kit.encodeAs(canvas, fmt, q, { icoSizes: icoSizes });
                results.push({ name: base + '.' + out.ext, blob: out.blob });
              }
            },
            function (f, i) {
              /* one msgid with placeholders, never three glued pieces — "Converting
                 {0}/{1}…" puts its numbers where English wants them (§6.99/7) */
              goBtn.textContent = SYFS.t('جارٍ التحويل {0}/{1}…', i + 1, files.length);
              row = noteRow(list, f.name);
              /* i18n-dyn: the user's own file name */
              row.querySelector('.t').textContent = f.name;
            },
            function (e, f) {
              if (!row) return;
              row.querySelector('.t').textContent = f.name + ' — ' + ((e && e.message) || SYFS.t('تعذّرت المعالجة'));
              row.querySelector('b').textContent = '✗';
            }
          );
          if (writer && writer.count()) {
            goBtn.textContent = SYFS.t('بناء ملف PDF…');
            results.push({ name: 'merged-' + stamp() + '.pdf', blob: writer.finish() });
          }
          markPending(list);
          /* ⚠️ Two WHOLE sentences, not one glued from four pieces. Concatenation put
             «اكتمل:» · «ملف ناتج من» · «مصدر» · «· فشل» into the dictionary as four
             keys that can never meet in English word order (§6.99/7). */
          noteRow(list, tally.failed
            ? SYFS.t('اكتمل: {0} ملف ناتج من {1} مصدر · فشل {2}', results.length, sources, tally.failed)
            : SYFS.t('اكتمل: {0} ملف ناتج من {1} مصدر', results.length, sources), !tally.failed);
          noteCapped(list, tally.capped);
          await deliver(results, 'converted', false);
        });
      });
  }

  /* ===== PDF ⇄ images ===== */
  function mountPdfImages(body) {
      var kit = SYFS.imgkit;
      var ui = h(
        '<div class="syf-form">' +
          '<div class="syf-seg" id="pi-mode"><button data-m="topng" class="on">PDF → صور</button><button data-m="topdf">صور → PDF</button></div>' +

          '<div id="pi-topng">' +
            '<input type="file" id="pi-pdf" accept="application/pdf,.pdf" class="syf-in" style="padding:6px">' +
            '<label>الصفحات</label>' +
            '<input class="syf-in" id="pi-pages" placeholder="اتركه فارغاً = كل الصفحات · أو مثل: 1-3,7,10-12">' +
            '<label>الدقّة</label>' +
            '<div class="syf-seg" id="pi-dpi"><button data-d="72">72</button><button data-d="110">110</button><button data-d="150" class="on">150</button><button data-d="300">300 DPI</button></div>' +
            '<label>صيغة الخرج</label>' +
            '<div class="syf-seg" id="pi-fmt"><button data-f="png" class="on">PNG</button><button data-f="jpeg">JPG</button><button data-f="webp">WebP</button></div>' +
            '<div class="syf-row" id="pi-qrow" style="display:none"><label style="margin:0">الجودة <b id="pi-qv">90%</b></label><input type="range" id="pi-q" min="40" max="100" value="90" style="flex:1"></div>' +
            '<button class="syf-btn" id="pi-go1">استخراج الصور</button>' +
            '<div class="syf-note-hint">صفحة واحدة → ملف صورة · أكثر → ملف ZIP. دقّة 300 DPI تعطي صوراً كبيرة جداً للمستندات الطويلة.</div>' +
          '</div>' +

          '<div id="pi-topdf" style="display:none">' +
            '<input type="file" id="pi-imgs" accept="' + ACCEPT_IN + '" multiple class="syf-in" style="padding:6px">' +
            '<div class="syf-note-hint" id="pi-count" style="display:none"></div>' +
            '<div class="syf-note-warn" id="pi-warn" style="display:none">⚠️ أكثر من 100 صورة — قد يتباطأ الجهاز.</div>' +
            '<label>مقاس الصفحة</label>' +
            '<div class="syf-seg" id="pi-fit"><button data-t="img" class="on">مقاس الصورة</button><button data-t="a4">ملاءمة A4</button></div>' +
            '<div class="syf-row"><label style="margin:0">الجودة <b id="pi-qv2">92%</b></label><input type="range" id="pi-q2" min="40" max="100" value="92" style="flex:1"></div>' +
            '<button class="syf-btn" id="pi-go2">إنشاء PDF واحد</button>' +
            '<div class="syf-note-hint">كل صورة = صفحة، بترتيب اختيارها. يقبل أيضاً ملفات PDF (تُدمج صفحاتها).</div>' +
          '</div>' +

          '<div class="syf-note-list" id="pi-list"></div>' +
          '<div class="syf-note-hint">المعالجة محلية بالكامل — لا يُرفع الملف. قد يفشل محرّك PDF على مواقع ذات سياسة أمان صارمة؛ جرّبه على تبويب فارغ أو في وضع العمل.</div>' +
        '</div>'
      );
      body.appendChild(ui);
      var list = ui.querySelector('#pi-list');
      var paneA = ui.querySelector('#pi-topng'), paneB = ui.querySelector('#pi-topdf');
      var dpi = 150, ofmt = 'png', fit = 'img';
      var qIn = ui.querySelector('#pi-q'), qv = ui.querySelector('#pi-qv');
      var q2In = ui.querySelector('#pi-q2'), qv2 = ui.querySelector('#pi-qv2');
      wireCount(ui.querySelector('#pi-imgs'), ui.querySelector('#pi-count'), ui.querySelector('#pi-warn'));

      ui.querySelector('#pi-mode').addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        var toPng = b.dataset.m === 'topng';
        paneA.style.display = toPng ? '' : 'none';        /* inline style — safe to clear with '' */
        paneB.style.display = toPng ? 'none' : '';
        list.innerHTML = '';
      });
      ui.querySelector('#pi-dpi').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; dpi = parseInt(b.dataset.d, 10); this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); });
      ui.querySelector('#pi-fmt').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; ofmt = b.dataset.f; this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); ui.querySelector('#pi-qrow').style.display = ofmt === 'png' ? 'none' : ''; });
      ui.querySelector('#pi-fit').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; fit = b.dataset.t; this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); });
      qIn.addEventListener('input', function () { qv.textContent = qIn.value + '%'; });
      q2In.addEventListener('input', function () { qv2.textContent = q2In.value + '%'; });

      /* --- PDF → images --- */
      ui.querySelector('#pi-go1').addEventListener('click', async function () {
        var btn = this;
        var f = ui.querySelector('#pi-pdf').files && ui.querySelector('#pi-pdf').files[0];
        if (!f) { ui.querySelector('#pi-pdf').focus(); return; }
        if (btn.disabled) return;
        list.innerHTML = '';
        var q = kit.clampInt(qIn.value, 40, 100, 90) / 100;
        var status = noteRow(list, SYFS.t('{0} — قراءة…', f.name));
        await withBusy(btn, async function () { try {
          btn.textContent = SYFS.t('تحميل محرّك PDF…');
          var pdfjs = await loadPdfjs();
          var doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
          var pages = parsePages(ui.querySelector('#pi-pages').value, doc.numPages);
          if (!pages) {
            status.querySelector('.t').textContent = SYFS.t('{0} — نطاق صفحات غير صالح (المسموح: أرقام وفواصل وشُرَط، ضمن ١..{1})', f.name, doc.numPages);
            status.querySelector('b').textContent = '✗';
            try { doc.destroy(); } catch (e2) { /* ignore */ }
            return;
          }
          var results = [], capped = 0;
          for (var i = 0; i < pages.length; i++) {
            btn.textContent = SYFS.t('صفحة {0}/{1}…', i + 1, pages.length);
            status.querySelector('.t').textContent = SYFS.t('{0} — صفحة {1} ({2}/{3})', f.name, pages[i], i + 1, pages.length);
            var cv = await renderPdfPage(doc, pages[i], dpi);
            if (cv.syfsCapped) capped++;
            var out = await kit.encodeAs(cv, ofmt, q, {});
            cv.width = cv.height = 0;                      /* the encoded blob is all we keep */
            results.push({ name: safeBase(f.name) + '-p' + pad3(pages[i]) + '.' + out.ext, blob: out.blob });
            await sleep(0);
          }
          try { doc.destroy(); } catch (e3) { /* ignore */ }
          var total = results.reduce(function (s, r) { return s + r.blob.size; }, 0);
          status.querySelector('.t').textContent = SYFS.t('{0} — {1} صفحة · {2}', f.name, results.length, fmtSize(total));
          status.querySelector('b').textContent = '✓';
          noteCapped(list, capped);
          await deliver(results, safeBase(f.name) + '-pages', results.length > 1);
        } catch (e) {
          status.querySelector('.t').textContent = SYFS.t('{0} — تعذّر: {1} (قد يكون الملف محمياً بكلمة مرور أو الصفحة بسياسة أمان صارمة)', f.name, (e && e.message) || SYFS.t('خطأ'));
          status.querySelector('b').textContent = '✗';
        } });
      });

      /* --- images → one PDF --- */
      ui.querySelector('#pi-go2').addEventListener('click', async function () {
        var btn = this;
        var files = ui.querySelector('#pi-imgs').files;
        if (!files || !files.length) { ui.querySelector('#pi-imgs').focus(); return; }
        if (btn.disabled) return;
        list.innerHTML = '';
        var q = kit.clampInt(q2In.value, 40, 100, 92) / 100;
        var opts = fit === 'a4' ? { fit: 'a4' } : null;
        /* each page is encoded into the writer and its canvas freed as it arrives —
           the old list of every canvas (≈33MB each at 12MP) was the v0.139.2 gap */
        var writer = window.SYFS_PDF.createWriter(opts), row = null;
        await withBusy(btn, async function () {
          var tally = await forEachSource(
            files,
            { dpi: PDF_IN_DPI },
            async function (canvas) { await writer.addAsync(canvas, q); canvas.width = canvas.height = 0; },
            function (f, i) {
              btn.textContent = SYFS.t('قراءة {0}/{1}…', i + 1, files.length);
              row = noteRow(list, f.name);
            },
            function (e, f) {
              if (!row) return;
              row.querySelector('.t').textContent = SYFS.t('{0} — {1}', f.name, (e && e.message) || SYFS.t('تعذّرت القراءة'));
              row.querySelector('b').textContent = '✗';
            }
          );
          var pages = writer.count();
          if (!pages) { noteRow(list, SYFS.t('لا توجد صور صالحة'), false); return; }
          btn.textContent = SYFS.t('بناء PDF…');
          var blob = writer.finish();
          markPending(list);
          /* whole sentences — the old line glued «صفحة ·» + «· فشل» and never translated */
          noteRow(list, tally.failed
            ? SYFS.t('{0} صفحة · {1} · فشل {2}', pages, fmtSize(blob.size), tally.failed)
            : SYFS.t('{0} صفحة · {1}', pages, fmtSize(blob.size)), !tally.failed);
          noteCapped(list, tally.capped);
          dlBlob(blob, 'images-' + stamp() + '.pdf');
        });
      });
  }

  /* ===== whiteboard: blank canvas — freehand + shapes + text ===== */
  SYFS.tools.push({
    id: 'whiteboard', name: 'السبّورة (وايت بورد)', cat: 'docs',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7.5 12.5l2-2 2 2 4-4"/></svg>',
    mount: function (body) {
      try { body.parentElement.style.width = '560px'; } catch (e) {}
      var ui = h(
        '<div class="syf-form">' +
          '<div class="syf-seg" id="wb-tools">' +
            '<button data-t="pen" class="on">قلم</button><button data-t="line">خط</button><button data-t="rect">مستطيل</button>' +
            '<button data-t="ellipse">دائرة</button><button data-t="arrow">سهم</button><button data-t="text">نص</button><button data-t="erase">ممحاة</button>' +
          '</div>' +
          '<div class="syf-row">' +
            '<input type="color" id="wb-color" value="#e11d48" title="اللون" style="width:42px;height:30px;border:none;background:none;padding:0;cursor:pointer">' +
            '<input type="range" id="wb-size" min="2" max="30" value="4" title="السماكة" style="flex:1">' +
            '<label class="syf-ck" style="white-space:nowrap"><input type="checkbox" id="wb-fill"> تعبئة</label>' +
            '<button class="syf-mini" id="wb-undo" title="تراجع">↩</button>' +
            '<button class="syf-mini" id="wb-clear" title="مسح الكل">🗑</button>' +
          '</div>' +
          '<div class="syf-row" id="wb-textrow" style="display:none"><input class="syf-in" id="wb-text" placeholder="اكتب النص ثم انقر موضعه على السبّورة"></div>' +
          '<canvas id="wb-cv" style="width:100%;background:#fff;border:1px solid #e5e9f2;border-radius:8px;cursor:crosshair;touch-action:none;display:block"></canvas>' +
          '<div class="syf-row"><button class="syf-btn" id="wb-png" style="flex:1">تنزيل PNG</button><button class="syf-mini" id="wb-jpg">JPG</button><button class="syf-mini" id="wb-pdf">PDF</button></div>' +
        '</div>'
      );
      body.appendChild(ui);

      var W = 1280, Hh = 800;
      var disp = ui.querySelector('#wb-cv'), dx = disp.getContext('2d');
      var base = document.createElement('canvas'), bx = base.getContext('2d');
      var colorIn = ui.querySelector('#wb-color'), sizeIn = ui.querySelector('#wb-size'), fillIn = ui.querySelector('#wb-fill');
      var textRow = ui.querySelector('#wb-textrow'), textIn = ui.querySelector('#wb-text');
      var tool = 'pen', drawing = false, sx = 0, sy = 0, hist = [];

      base.width = W; base.height = Hh; disp.width = W; disp.height = Hh;
      bx.fillStyle = '#fff'; bx.fillRect(0, 0, W, Hh);
      function blit() { dx.clearRect(0, 0, W, Hh); dx.drawImage(base, 0, 0); }
      function commit() { bx.clearRect(0, 0, W, Hh); bx.drawImage(disp, 0, 0); }
      function pushHist() { hist.push(base.toDataURL('image/png')); if (hist.length > 15) hist.shift(); }
      function viewScale() { var r = disp.getBoundingClientRect(); return Math.max(1, disp.width / Math.max(1, r.width)); }
      function setStroke(g) { g.strokeStyle = colorIn.value; g.fillStyle = colorIn.value; g.lineWidth = +sizeIn.value * viewScale(); g.lineCap = 'round'; g.lineJoin = 'round'; }
      function pos(e) { var r = disp.getBoundingClientRect(); return { x: (e.clientX - r.left) * disp.width / r.width, y: (e.clientY - r.top) * disp.height / r.height }; }
      function drawArrow(g, x1, y1, x2, y2) {
        var a = Math.atan2(y2 - y1, x2 - x1), L = Math.max(14, g.lineWidth * 3.5);
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2);
        g.moveTo(x2, y2); g.lineTo(x2 - L * Math.cos(a - 0.45), y2 - L * Math.sin(a - 0.45));
        g.moveTo(x2, y2); g.lineTo(x2 - L * Math.cos(a + 0.45), y2 - L * Math.sin(a + 0.45));
        g.stroke();
      }
      function drawEllipse(g, x1, y1, x2, y2) {
        g.beginPath(); g.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, 2 * Math.PI);
        if (fillIn.checked) g.fill(); g.stroke();
      }
      blit();

      ui.querySelector('#wb-tools').addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        tool = b.dataset.t;
        this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        textRow.style.display = tool === 'text' ? '' : 'none';
        disp.style.cursor = tool === 'text' ? 'text' : 'crosshair';
      });

      disp.addEventListener('pointerdown', function (e) {
        e.preventDefault(); disp.setPointerCapture(e.pointerId);
        var p = pos(e); sx = p.x; sy = p.y;
        if (tool === 'text') {
          var t = (textIn.value || '').trim(); if (!t) { textIn.focus(); return; }
          pushHist();
          bx.fillStyle = colorIn.value;
          bx.font = '700 ' + Math.round(+sizeIn.value * 6 * viewScale()) + 'px Tajawal, system-ui, sans-serif';
          bx.textBaseline = 'middle';
          bx.fillText(t, p.x, p.y);
          blit();
          return;
        }
        drawing = true;
        if (tool === 'pen' || tool === 'erase') { pushHist(); setStroke(dx); if (tool === 'erase') dx.strokeStyle = '#fff'; dx.beginPath(); dx.moveTo(p.x, p.y); }
      });
      disp.addEventListener('pointermove', function (e) {
        if (!drawing) return;
        var p = pos(e);
        if (tool === 'pen' || tool === 'erase') { dx.lineTo(p.x, p.y); dx.stroke(); return; }
        blit(); setStroke(dx);
        if (tool === 'line') { dx.beginPath(); dx.moveTo(sx, sy); dx.lineTo(p.x, p.y); dx.stroke(); }
        else if (tool === 'rect') {
          var rx = Math.min(sx, p.x), ry = Math.min(sy, p.y), rw = Math.abs(p.x - sx), rh = Math.abs(p.y - sy);
          if (fillIn.checked) dx.fillRect(rx, ry, rw, rh);
          dx.strokeRect(rx, ry, rw, rh);
        }
        else if (tool === 'ellipse') { drawEllipse(dx, sx, sy, p.x, p.y); }
        else if (tool === 'arrow') { drawArrow(dx, sx, sy, p.x, p.y); }
      });
      disp.addEventListener('pointerup', function () {
        if (!drawing) return;
        drawing = false;
        if (tool !== 'pen' && tool !== 'erase') pushHist();
        commit();
      });

      ui.querySelector('#wb-undo').addEventListener('click', function () {
        var u = hist.pop(); if (!u) return;
        loadImg(u).then(function (im) { bx.clearRect(0, 0, W, Hh); bx.drawImage(im, 0, 0); blit(); });
      });
      ui.querySelector('#wb-clear').addEventListener('click', function () { pushHist(); bx.fillStyle = '#fff'; bx.fillRect(0, 0, W, Hh); blit(); });
      ui.querySelector('#wb-png').addEventListener('click', function () { dl(base.toDataURL('image/png'), 'whiteboard-' + stamp() + '.png'); });
      ui.querySelector('#wb-jpg').addEventListener('click', function () { dl(base.toDataURL('image/jpeg', 0.92), 'whiteboard-' + stamp() + '.jpg'); });
      ui.querySelector('#wb-pdf').addEventListener('click', function () { dlBlob(canvasToPdfBlob(base, 0.95), 'whiteboard-' + stamp() + '.pdf'); });
    }
  });

  /* Resolve a format choice ('keep'|'webp'|'jpeg'|'png') + file into {type, ext}. */
  function resolveFmt(sel, file) {
    if (sel === 'keep') {
      var t = (file && file.type) || '';
      if (t === 'image/png') return { type: 'image/png', ext: 'png' };
      if (t === 'image/webp') return { type: 'image/webp', ext: 'webp' };
      return { type: 'image/jpeg', ext: 'jpg' };
    }
    if (sel === 'png') return { type: 'image/png', ext: 'png' };
    if (sel === 'webp') return { type: 'image/webp', ext: 'webp' };
    return { type: 'image/jpeg', ext: 'jpg' };
  }

  /* ===== Image compressor v2 — batch + target-size ===== */
  function mountImgCompress(body) {
      var kit = SYFS.imgkit;
      var ui = h(
        '<div class="syf-form">' +
          '<input type="file" id="cz-f" accept="image/*" multiple class="syf-in" style="padding:6px">' +
          '<div class="syf-note-hint" id="cz-count" style="display:none"></div>' +
          '<div class="syf-note-warn" id="cz-warn" style="display:none">⚠️ أكثر من 100 صورة — قد يتباطأ الجهاز أو يتهنّج على الأجهزة الضعيفة. يُفضَّل دفعات ≤100.</div>' +
          '<div class="syf-seg" id="cz-mode"><button data-m="quality" class="on">جودة يدوية</button><button data-m="target">حجم مستهدف</button></div>' +
          '<div class="syf-row" id="cz-qrow"><label style="margin:0">الجودة <b id="cz-qv">80%</b></label><input type="range" id="cz-q" min="40" max="98" value="80" style="flex:1"></div>' +
          '<div id="cz-trow" style="display:none"><div class="syf-row"><label style="margin:0">أقصى حجم</label><input type="number" id="cz-t" class="syf-in" value="200" style="width:90px"> ك.ب</div><div class="syf-seg" id="cz-tp"><button data-kb="100">100</button><button data-kb="200" class="on">200</button><button data-kb="500">500</button><button data-kb="1024">1MB</button></div></div>' +
          '<label>الصيغة</label>' +
          '<div class="syf-seg" id="cz-fmt"><button data-f="webp" class="on">WebP</button><button data-f="jpeg">JPG</button><button data-f="png">PNG</button></div>' +
          '<div class="syf-row"><label class="syf-ck"><input type="checkbox" id="cz-mwon"> <span>أقصى بُعد</span></label><input type="number" id="cz-mw" class="syf-in" value="1920" style="width:90px" disabled> بكسل <button class="syf-mini" id="cz-1920">مناسب للمشاركة</button></div>' +
          '<button class="syf-btn" id="cz-go">ضغط وتنزيل</button>' +
          '<img id="cz-prev" alt="" style="max-width:100%;border-radius:10px;border:1px solid var(--line);display:none">' +
          '<div class="syf-note-list" id="cz-list"></div>' +
          '<div class="syf-note-hint">WebP يعطي أصغر حجم بنفس الجودة. الضغط محلي بالكامل. للحجم المستهدف يُخفَّض البُعد تلقائياً إن لم تكفِ الجودة.</div>' +
        '</div>'
      );
      body.appendChild(ui);
      var mode = 'quality', fmt = 'webp';
      var q = ui.querySelector('#cz-q'), qv = ui.querySelector('#cz-qv'), tKB = ui.querySelector('#cz-t');
      var mwOn = ui.querySelector('#cz-mwon'), mw = ui.querySelector('#cz-mw'), list = ui.querySelector('#cz-list');
      var prev = ui.querySelector('#cz-prev'), goBtn = ui.querySelector('#cz-go'), filesIn = ui.querySelector('#cz-f');
      wireCount(filesIn, ui.querySelector('#cz-count'), ui.querySelector('#cz-warn'));

      ui.querySelector('#cz-mode').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; mode = b.dataset.m; this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); ui.querySelector('#cz-qrow').style.display = mode === 'quality' ? '' : 'none'; ui.querySelector('#cz-trow').style.display = mode === 'target' ? '' : 'none'; });
      ui.querySelector('#cz-fmt').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; fmt = b.dataset.f; this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); });
      ui.querySelector('#cz-tp').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; tKB.value = b.dataset.kb; this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); });
      q.addEventListener('input', function () { qv.textContent = q.value + '%'; });
      mwOn.addEventListener('change', function () { mw.disabled = !mwOn.checked; });
      ui.querySelector('#cz-1920').addEventListener('click', function () { mwOn.checked = true; mw.disabled = false; mw.value = 1920; });

      goBtn.addEventListener('click', async function () {
        var files = filesIn.files; if (!files || !files.length) { filesIn.focus(); return; }
        list.innerHTML = ''; prev.style.display = 'none';
        var maxDim = mwOn.checked ? kit.clampInt(mw.value, 16, 20000, 0) : 0;
        var target = kit.clampInt(tKB.value, 10, 20000, 200) * 1024;
        var quality = kit.clampInt(q.value, 40, 98, 80) / 100;
        var first = true;
        var results = await runFiles(files, goBtn, list, async function (f) {
          var bmp = await kit.decode(f);
          var cv = kit.resize(bmp, maxDim ? { longest: maxDim } : {});
          bmp.close();
          var meta = resolveFmt(fmt, f), blob;
          if (mode === 'target') blob = (await kit.encodeToTarget(cv, meta.type, target)).blob;
          else blob = await kit.encode(cv, meta.type, quality);
          if (first && blob) { first = false; if (prev._u) URL.revokeObjectURL(prev._u); prev._u = URL.createObjectURL(blob); prev.src = prev._u; prev.style.display = ''; }
          return { name: safeBase(f.name) + '-min.' + meta.ext, blob: blob, capped: !!cv.syfsCapped };
        });
        await deliver(results, 'compressed', files.length > 1);
      });
  }

  /* ===== Image resizer — batch ===== */
  function mountImgResize(body) {
      var kit = SYFS.imgkit;
      var ui = h(
        '<div class="syf-form">' +
          '<input type="file" id="rz-f" accept="image/*" multiple class="syf-in" style="padding:6px">' +
          '<div class="syf-note-hint" id="rz-count" style="display:none"></div>' +
          '<div class="syf-note-warn" id="rz-warn" style="display:none">⚠️ أكثر من 100 صورة — قد يتهنّج الجهاز على الأجهزة الضعيفة. يُفضَّل دفعات ≤100.</div>' +
          '<label>البُعد</label>' +
          '<div class="syf-seg" id="rz-mode"><button data-m="longest" class="on">أطول ضلع</button><button data-m="width">العرض</button><button data-m="height">الارتفاع</button><button data-m="percent">نسبة %</button></div>' +
          '<div class="syf-row"><input type="number" id="rz-v" class="syf-in" value="1920" style="width:100px"> <span id="rz-unit">بكسل</span></div>' +
          '<label class="syf-ck"><input type="checkbox" id="rz-up"> <span>السماح بالتكبير (افتراضياً لا يُكبّر)</span></label>' +
          '<label>الصيغة</label>' +
          '<div class="syf-seg" id="rz-fmt"><button data-f="keep" class="on">الأصل</button><button data-f="webp">WebP</button><button data-f="jpeg">JPG</button><button data-f="png">PNG</button></div>' +
          '<div class="syf-row" id="rz-qrow" style="display:none"><label style="margin:0">الجودة <b id="rz-qv">85%</b></label><input type="range" id="rz-q" min="40" max="98" value="85" style="flex:1"></div>' +
          '<button class="syf-btn" id="rz-go">تغيير الحجم وتنزيل</button>' +
          '<div class="syf-note-list" id="rz-list"></div>' +
          '<div class="syf-note-hint">تُحفظ نسبة الأبعاد. المعالجة محلية بالكامل.</div>' +
        '</div>'
      );
      body.appendChild(ui);
      var mode = 'longest', fmt = 'keep';
      var v = ui.querySelector('#rz-v'), unit = ui.querySelector('#rz-unit'), up = ui.querySelector('#rz-up');
      var q = ui.querySelector('#rz-q'), qv = ui.querySelector('#rz-qv'), list = ui.querySelector('#rz-list');
      var goBtn = ui.querySelector('#rz-go'), filesIn = ui.querySelector('#rz-f');
      wireCount(filesIn, ui.querySelector('#rz-count'), ui.querySelector('#rz-warn'));

      ui.querySelector('#rz-mode').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; mode = b.dataset.m; this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); unit.textContent = mode === 'percent' ? '%' : SYFS.t('بكسل'); if (mode === 'percent' && +v.value > 100) v.value = 100; });
      ui.querySelector('#rz-fmt').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; fmt = b.dataset.f; this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); ui.querySelector('#rz-qrow').style.display = fmt === 'png' ? 'none' : ''; });
      q.addEventListener('input', function () { qv.textContent = q.value + '%'; });

      goBtn.addEventListener('click', async function () {
        var files = filesIn.files; if (!files || !files.length) { filesIn.focus(); return; }
        list.innerHTML = '';
        var val = kit.clampInt(v.value, 1, mode === 'percent' ? 1000 : 20000, mode === 'percent' ? 100 : 1920);
        var quality = kit.clampInt(q.value, 40, 98, 85) / 100;
        var opts = { allowUpscale: up.checked };
        if (mode === 'longest') opts.longest = val; else if (mode === 'width') opts.maxW = val; else if (mode === 'height') opts.maxH = val; else opts.percent = val;
        var results = await runFiles(files, goBtn, list, async function (f) {
          var bmp = await kit.decode(f);
          var cv = kit.resize(bmp, opts);
          bmp.close();
          var meta = resolveFmt(fmt, f);
          var blob = await kit.encode(cv, meta.type, quality);
          return { name: safeBase(f.name) + '-' + cv.width + 'x' + cv.height + '.' + meta.ext, blob: blob, capped: !!cv.syfsCapped };
        });
        await deliver(results, 'resized', files.length > 1);
      });
  }

  /* ===== Batch processor — resize + convert + compress in one pass ===== */
  SYFS.tools.push({
    id: 'imgbatch', name: 'معالج الصور المجمّع', cat: 'media',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>',
    mount: function (body) {
      var kit = SYFS.imgkit;
      var ui = h(
        '<div class="syf-form">' +
          '<input type="file" id="bp-f" accept="image/*" multiple class="syf-in" style="padding:6px">' +
          '<div class="syf-note-hint" id="bp-count" style="display:none"></div>' +
          '<div class="syf-note-warn" id="bp-warn" style="display:none">⚠️ أكثر من 100 صورة — قد يتهنّج الجهاز على الأجهزة الضعيفة. يُفضَّل دفعات ≤100.</div>' +
          '<label>① البُعد</label>' +
          '<div class="syf-seg" id="bp-dim"><button data-d="none" class="on">بدون تغيير</button><button data-d="longest">أطول ضلع</button><button data-d="percent">نسبة %</button></div>' +
          '<div class="syf-row" id="bp-dimrow" style="display:none"><input type="number" id="bp-dv" class="syf-in" value="1920" style="width:100px"> <span id="bp-dunit">بكسل</span></div>' +
          '<label>② الصيغة</label>' +
          '<div class="syf-seg" id="bp-fmt"><button data-f="keep" class="on">الأصل</button><button data-f="webp">WebP</button><button data-f="jpeg">JPG</button><button data-f="png">PNG</button></div>' +
          '<label>③ الضغط</label>' +
          '<div class="syf-seg" id="bp-cmode"><button data-m="quality" class="on">جودة</button><button data-m="target">حجم مستهدف</button></div>' +
          '<div class="syf-row" id="bp-qrow"><label style="margin:0">الجودة <b id="bp-qv">80%</b></label><input type="range" id="bp-q" min="40" max="98" value="80" style="flex:1"></div>' +
          '<div class="syf-row" id="bp-trow" style="display:none"><label style="margin:0">أقصى حجم</label><input type="number" id="bp-t" class="syf-in" value="300" style="width:90px"> ك.ب لكل صورة</div>' +
          '<button class="syf-btn" id="bp-go">نفّذ على الكل</button>' +
          '<div class="syf-out" id="bp-stats" style="display:none"><div><span>الإجمالي قبل</span><b id="bp-before">—</b></div><div><span>الإجمالي بعد</span><b id="bp-after">—</b></div><div><span>التوفير</span><b id="bp-save">—</b></div></div>' +
          '<div class="syf-note-list" id="bp-list"></div>' +
          '<div class="syf-note-hint">ينفّذ التصغير ثم التحويل ثم الضغط لكل صورة، ويُنزّلها ملف ZIP واحد. محلي بالكامل.</div>' +
        '</div>'
      );
      body.appendChild(ui);
      var dim = 'none', fmt = 'keep', cmode = 'quality';
      var dv = ui.querySelector('#bp-dv'), dunit = ui.querySelector('#bp-dunit');
      var q = ui.querySelector('#bp-q'), qv = ui.querySelector('#bp-qv'), tKB = ui.querySelector('#bp-t');
      var list = ui.querySelector('#bp-list'), goBtn = ui.querySelector('#bp-go'), filesIn = ui.querySelector('#bp-f');
      var stats = ui.querySelector('#bp-stats'), beforeEl = ui.querySelector('#bp-before'), afterEl = ui.querySelector('#bp-after'), saveEl = ui.querySelector('#bp-save');
      wireCount(filesIn, ui.querySelector('#bp-count'), ui.querySelector('#bp-warn'));

      // Show the combined input size as soon as files are picked (before/after totals).
      filesIn.addEventListener('change', function () {
        var files = filesIn.files, total = 0;
        for (var i = 0; files && i < files.length; i++) total += files[i].size;
        if (files && files.length) {
          stats.style.display = ''; beforeEl.textContent = fmtSize(total);
          afterEl.textContent = '—'; saveEl.textContent = '—';
        } else { stats.style.display = 'none'; }
      });

      ui.querySelector('#bp-dim').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; dim = b.dataset.d; this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); ui.querySelector('#bp-dimrow').style.display = dim === 'none' ? 'none' : ''; dunit.textContent = dim === 'percent' ? '%' : SYFS.t('بكسل'); });
      ui.querySelector('#bp-fmt').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; fmt = b.dataset.f; this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); });
      ui.querySelector('#bp-cmode').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; cmode = b.dataset.m; this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); ui.querySelector('#bp-qrow').style.display = cmode === 'quality' ? '' : 'none'; ui.querySelector('#bp-trow').style.display = cmode === 'target' ? '' : 'none'; });
      q.addEventListener('input', function () { qv.textContent = q.value + '%'; });

      goBtn.addEventListener('click', async function () {
        var files = filesIn.files; if (!files || !files.length) { filesIn.focus(); return; }
        list.innerHTML = '';
        var dval = kit.clampInt(dv.value, 1, dim === 'percent' ? 1000 : 20000, dim === 'percent' ? 100 : 1920);
        var quality = kit.clampInt(q.value, 40, 98, 80) / 100;
        var target = kit.clampInt(tKB.value, 10, 20000, 300) * 1024;
        var inTotal = 0; for (var k = 0; k < files.length; k++) inTotal += files[k].size;
        stats.style.display = ''; beforeEl.textContent = fmtSize(inTotal); afterEl.textContent = '…'; saveEl.textContent = '…';
        var results = await runFiles(files, goBtn, list, async function (f) {
          var bmp = await kit.decode(f);
          var opts = {};
          if (dim === 'longest') opts.longest = dval; else if (dim === 'percent') opts.percent = dval;
          var cv = kit.resize(bmp, opts);
          bmp.close();
          var meta = resolveFmt(fmt, f), blob;
          if (cmode === 'target') blob = (await kit.encodeToTarget(cv, meta.type, target)).blob;
          else blob = await kit.encode(cv, meta.type, quality);
          return { name: safeBase(f.name) + '.' + meta.ext, blob: blob, capped: !!cv.syfsCapped };
        });
        var outTotal = results.reduce(function (s, r) { return s + (r && r.blob ? r.blob.size : 0); }, 0);
        var pct = inTotal ? Math.round((1 - outTotal / inTotal) * 100) : 0;
        beforeEl.textContent = fmtSize(inTotal);
        afterEl.textContent = fmtSize(outTotal);
        saveEl.textContent = (pct >= 0 ? '−' : '+') + Math.abs(pct) + '%';
        await deliver(results, 'batch', true);
      });
    }
  });

  /* ===== PDF compressor (lazy pdf.js — rasterizes pages to JPEG) ===== */
  var pdfjsMod = null;
  async function loadPdfjs() {
    if (pdfjsMod) return pdfjsMod;
    var src = chrome.runtime.getURL('lib/pdfjs/pdf.min.mjs');
    var mod = await import(src);
    try { mod.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdfjs/pdf.worker.min.mjs'); } catch (e) { /* ignore */ }
    pdfjsMod = mod;
    return mod;
  }

  /* ===== pdf-lib — merge / split / extract WITHOUT rasterising (v0.115.0) =====
   * ⚠️ TWO PDF ENGINES ON PURPOSE, and they do opposite jobs — do not "unify" them.
   *   pdf.js  RENDERS a page to pixels. It is what compression needs and it is the
   *           only one of the two that can, but it destroys text on the way through.
   *   pdf-lib COPIES page objects between documents. It is the only way merge, split
   *           and extract keep selectable text, real fonts, links and bookmarks.
   * Rasterising a contract to split it is a loss the user cannot undo and would not
   * have asked for, which is why the dependency was worth taking here and is NOT worth
   * taking for compression (pdf.js already does that job).
   *
   * ⚠️ The FORK, not the original. `pdf-lib@1.17.1` is MIT and clean but its last
   * release is 2021 — it fails §18's "maintained within ~12 months". `@cantoo/pdf-lib`
   * is the maintained fork (2.9.1, same MIT, same API) and it passes the same gates:
   * `grep -cE 'eval\(|new Function\(' lib/pdflib/pdf-lib.esm.min.js` is **0**, and so
   * is every network primitive (fetch / XHR / sendBeacon / WebSocket). ⛔ Re-run both
   * greps before any upgrade — MV3 extension_pages CSP does not accept 'unsafe-eval',
   * so a build that grows an eval() cannot be installed at all. */
  var pdflibMod = null;
  async function loadPdflib() {
    if (pdflibMod) return pdflibMod;
    pdflibMod = await import(chrome.runtime.getURL('lib/pdflib/pdf-lib.esm.min.js'));
    return pdflibMod;
  }
  /* «1-3, 7, 12-» → [0,1,2,6,11,…] — ZERO-BASED indices for pdf-lib's copyPages().
   *
   * ⚠️ DELIBERATELY NOT `parsePages` (media.js:944). That one exists for the pdf.js
   * tools and answers a different contract: it returns ONE-BASED page numbers, treats
   * empty as «every page», and drops an out-of-range number silently. Naming this one
   * the same shadowed it for the whole IIFE — `function` declarations hoist, so the
   * later definition won at BOTH of the older one's call sites and «PDF ⇄ صور» started
   * handing back the wrong pages with no error. Caught by tools/pdfrange-test.js.
   *
   * ⛔ Rejects rather than guesses (§4.1): «1-99» on a ten-page file is a typo, and
   * quietly clamping it returns a file that is not what was asked for. Null on anything
   * unparseable, and the caller says so. The typed order is preserved, not sorted —
   * «5,1» means the user wants page 5 first. */
  function parsePageIdx(spec, total) {
    var out = [], seen = {}, parts = String(spec || '').split(/[,،]/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (!p) continue;
      var m = /^(\d+)\s*(?:[-–]\s*(\d+)?)?$/.exec(p);
      if (!m) return null;
      var a = parseInt(m[1], 10);
      var b = m[2] ? parseInt(m[2], 10) : (/[-–]/.test(p) ? total : a);
      if (!a || a < 1 || b < a || b > total) return null;
      for (var n = a; n <= b; n++) { if (!seen[n]) { seen[n] = 1; out.push(n - 1); } }
    }
    return out.length ? out : null;
  }
  function mountPdfMerge(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<label>اختر ملفّين أو أكثر — يُدمجان بترتيب اختيارك</label>' +
        '<input type="file" id="pm-f" accept="application/pdf,.pdf" multiple class="syf-in" style="padding:6px">' +
        '<div class="syf-note-list" id="pm-list"></div>' +
        '<button class="syf-btn" id="pm-go">دمج وتنزيل</button>' +
        '<div class="syf-note-hint">النصّ والخطوط والروابط تبقى كما هي — لا تحويل إلى صور. المعالجة محلية بالكامل.</div>' +
        '<div class="syf-empty" id="pm-st" style="display:none"></div>' +
      '</div>'));
    var fIn = body.querySelector('#pm-f'), listEl = body.querySelector('#pm-list'),
        goB = body.querySelector('#pm-go'), st = body.querySelector('#pm-st');
    var files = [];
    function say(t) { st.style.display = ''; st.textContent = t; }
    function render() {
      listEl.textContent = '';
      files.forEach(function (f, i) {
        var r = h('<div class="syf-note-row"><span class="t"></span><button class="u">▲</button><button class="x">✕</button></div>');
        /* i18n-dyn: the user's own file name */
        r.querySelector('.t').textContent = (i + 1) + '. ' + f.name + ' — ' + fmtSize(f.size);
        r.querySelector('.u').disabled = i === 0;
        r.querySelector('.u').addEventListener('click', function () { var t = files[i - 1]; files[i - 1] = files[i]; files[i] = t; render(); });
        r.querySelector('.x').addEventListener('click', function () { files.splice(i, 1); render(); });
        listEl.appendChild(r);
      });
      if (!files.length) listEl.appendChild(h('<div class="syf-empty">لم تختر ملفات بعد.</div>'));
    }
    fIn.addEventListener('change', function () {
      Array.prototype.forEach.call(fIn.files || [], function (f) { files.push(f); });
      fIn.value = ''; render();
    });
    render();
    goB.addEventListener('click', async function () {
      if (files.length < 2) { say(SYFS.t('اختر ملفّين على الأقل.')); return; }
      await withBusy(goB, async function () { try {
        goB.textContent = SYFS.t('تحميل محرّك PDF…');
        var PDFLib = await loadPdflib();
        var out = await PDFLib.PDFDocument.create();
        for (var i = 0; i < files.length; i++) {
          goB.textContent = SYFS.t('دمج {0}/{1}…', i + 1, files.length);
          var src = await PDFLib.PDFDocument.load(await files[i].arrayBuffer(), { ignoreEncryption: true });
          var pages = await out.copyPages(src, src.getPageIndices());
          pages.forEach(function (p) { out.addPage(p); });
          await sleep(0);
        }
        var bytes = await out.save();
        var blob = new Blob([bytes], { type: 'application/pdf' });
        dlBlob(blob, 'merged.pdf');
        say(SYFS.t('تمّ ✓ — {0} صفحة · {1}', out.getPageCount(), fmtSize(blob.size)));
      } catch (e) {
        say(SYFS.t('تعذّر الدمج: {0} (قد يكون أحد الملفات محمياً بكلمة مرور)', (e && e.message) || SYFS.t('خطأ')));
      } });
    });
  }
  function mountPdfSplit(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<input type="file" id="ps-f" accept="application/pdf,.pdf" class="syf-in" style="padding:6px">' +
        '<div class="syf-note-hint" id="ps-info"></div>' +
        '<div class="syf-seg" id="ps-mode"><button class="on" data-m="pick">صفحات محدّدة</button><button data-m="each">كل صفحة ملفاً</button></div>' +
        '<div data-psview="pick"><label>الصفحات</label><input class="syf-in" id="ps-r" placeholder="مثال: 1-3, 7, 12-" dir="ltr"></div>' +
        '<button class="syf-btn" id="ps-go">استخراج وتنزيل</button>' +
        '<div class="syf-note-hint">النصّ والخطوط والروابط تبقى كما هي. «كل صفحة ملفاً» يُنزّل ZIP.</div>' +
        '<div class="syf-empty" id="ps-st" style="display:none"></div>' +
      '</div>'));
    var fIn = body.querySelector('#ps-f'), info = body.querySelector('#ps-info'), rIn = body.querySelector('#ps-r'),
        goB = body.querySelector('#ps-go'), st = body.querySelector('#ps-st'), mode = 'pick', total = 0;
    function say(t) { st.style.display = ''; st.textContent = t; }
    body.querySelector('#ps-mode').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      mode = b.dataset.m;
      body.querySelectorAll('[data-psview]').forEach(function (v) { v.style.display = v.getAttribute('data-psview') === mode ? '' : 'none'; });
    });
    fIn.addEventListener('change', async function () {
      total = 0; info.textContent = '';
      var f = fIn.files && fIn.files[0]; if (!f) return;
      try {
        var PDFLib = await loadPdflib();
        var doc = await PDFLib.PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
        total = doc.getPageCount();
        info.textContent = SYFS.t('{0} صفحة.', total);
      } catch (e) { info.textContent = SYFS.t('تعذّرت قراءة الملف.'); }
    });
    goB.addEventListener('click', async function () {
      var f = fIn.files && fIn.files[0];
      if (!f) { fIn.focus(); return; }
      await withBusy(goB, async function () { try {
        var PDFLib = await loadPdflib();
        var src = await PDFLib.PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
        total = src.getPageCount();
        if (mode === 'each') {
          /* SYFS.imgkit.zipWrite is the project's own writer — it takes [{name, blob}]
             and RETURNS A BLOB (async). It deflates only when that actually shrinks the
             entry, which for a PDF it usually will not, and that check is already inside
             it — so there is nothing to pass or tune here. */
          var entries = [];
          for (var i = 0; i < total; i++) {
            goB.textContent = SYFS.t('صفحة {0}/{1}…', i + 1, total);
            var one = await PDFLib.PDFDocument.create();
            var cp = await one.copyPages(src, [i]);
            one.addPage(cp[0]);
            entries.push({
              name: safeBase(f.name) + '-' + (i + 1) + '.pdf',
              blob: new Blob([await one.save()], { type: 'application/pdf' })
            });
            await sleep(0);
          }
          var zip = await SYFS.imgkit.zipWrite(entries);
          dlBlob(zip, safeBase(f.name) + '-pages.zip');
          say(SYFS.t('تمّ ✓ — {0} ملفاً في ZIP', total));
        } else {
          var idx = parsePageIdx(rIn.value, total);
          /* ⛔ reject, never clamp: «1-99» on a 10-page file is a typo, and quietly
             returning ten pages hands back a file that is not what was asked for (§4.1) */
          if (!idx) { say(SYFS.t('نطاق غير صالح. اكتب مثل 1-3, 7, 12- ضمن {0} صفحة.', total)); return; }
          var out = await PDFLib.PDFDocument.create();
          var pages = await out.copyPages(src, idx);
          pages.forEach(function (p) { out.addPage(p); });
          var bytes = await out.save();
          var blob = new Blob([bytes], { type: 'application/pdf' });
          dlBlob(blob, safeBase(f.name) + '-pages.pdf');
          say(SYFS.t('تمّ ✓ — {0} صفحة · {1}', idx.length, fmtSize(blob.size)));
        }
      } catch (e) {
        say(SYFS.t('تعذّر: {0} (قد يكون الملف محمياً بكلمة مرور)', (e && e.message) || SYFS.t('خطأ')));
      } });
    });
  }
  function mountPdfRotate(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<input type="file" id="pr-f" accept="application/pdf,.pdf" class="syf-in" style="padding:6px">' +
        '<label>الزاوية</label>' +
        '<div class="syf-seg" id="pr-a"><button class="on" data-a="90">90° يميناً</button><button data-a="180">180°</button><button data-a="270">90° يساراً</button></div>' +
        '<label>الصفحات (اتركه فارغاً للكل)</label>' +
        '<input class="syf-in" id="pr-r" placeholder="مثال: 1-3, 7" dir="ltr">' +
        '<button class="syf-btn" id="pr-go">تدوير وتنزيل</button>' +
        '<div class="syf-empty" id="pr-st" style="display:none"></div>' +
      '</div>'));
    var fIn = body.querySelector('#pr-f'), rIn = body.querySelector('#pr-r'),
        goB = body.querySelector('#pr-go'), st = body.querySelector('#pr-st'), ang = 90;
    function say(t) { st.style.display = ''; st.textContent = t; }
    body.querySelector('#pr-a').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      ang = parseInt(b.dataset.a, 10);
      this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
    });
    goB.addEventListener('click', async function () {
      var f = fIn.files && fIn.files[0]; if (!f) { fIn.focus(); return; }
      await withBusy(goB, async function () { try {
        var PDFLib = await loadPdflib();
        var doc = await PDFLib.PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
        var total = doc.getPageCount();
        var idx = rIn.value.trim() ? parsePageIdx(rIn.value, total) : doc.getPageIndices();
        if (!idx) { say(SYFS.t('نطاق غير صالح. اكتب مثل 1-3, 7, 12- ضمن {0} صفحة.', total)); return; }
        idx.forEach(function (i) {
          var pg = doc.getPage(i);
          /* ⚠️ ADD to the existing rotation, never set it: a page that already carries
             /Rotate 90 in the file would otherwise be reset rather than turned. */
          pg.setRotation(PDFLib.degrees((pg.getRotation().angle + ang) % 360));
        });
        var bytes = await doc.save();
        var blob = new Blob([bytes], { type: 'application/pdf' });
        dlBlob(blob, safeBase(f.name) + '-rotated.pdf');
        say(SYFS.t('تمّ ✓ — {0} صفحة · {1}', idx.length, fmtSize(blob.size)));
      } catch (e) {
        say(SYFS.t('تعذّر: {0} (قد يكون الملف محمياً بكلمة مرور)', (e && e.message) || SYFS.t('خطأ')));
      } });
    });
  }

  /* ===== sign · number · watermark (v0.118.0) — pdf-lib again, so the text stays text =====
   * Signatures and watermarks are IMAGES drawn onto the page (PNG with alpha, from a
   * canvas): that is what lets an Arabic watermark work at all — pdf-lib's standard
   * fonts carry no Arabic glyphs, and embedding a shaped Arabic font is a project of
   * its own. Page numbers are Latin digits through Helvetica for the same reason, and
   * the panel says so. ⛔ Password protection is outside pdf-lib — never promised here. */
  var PDF_CORNERS = { br: 'أسفل يمين', bl: 'أسفل يسار', tr: 'أعلى يمين', tl: 'أعلى يسار', bc: 'أسفل وسط', tc: 'أعلى وسط' };
  function pdfPlace(corner, pw, ph, w, hh, margin) {
    var x = corner.charAt(1) === 'l' ? margin : corner.charAt(1) === 'c' ? (pw - w) / 2 : pw - w - margin;
    var y = corner.charAt(0) === 't' ? ph - hh - margin : margin;
    return { x: x, y: y };
  }
  function pdfPagesFor(spec, total) { return String(spec || '').trim() ? parsePageIdx(spec, total) : [total - 1]; }
  async function pdfEmbed(PDFLib, doc, blob) {
    var bytes = await blob.arrayBuffer();
    return blob.type === 'image/jpeg' ? doc.embedJpg(bytes) : doc.embedPng(bytes);
  }
  function pngOf(canvas) { return new Promise(function (r) { canvas.toBlob(r, 'image/png'); }); }
  function cornerSeg(id, def) {
    return '<div class="syf-seg syf-seg-wrap" id="' + id + '">' + Object.keys(PDF_CORNERS).map(function (k) {
      return '<button data-c="' + k + '"' + (k === def ? ' class="on"' : '') + '>' + PDF_CORNERS[k] + '</button>';
    }).join('') + '</div>';
  }
  function segWire(el, attr, set) {
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      set(b.dataset[attr]);
      el.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
    });
  }
  function mountPdfSign(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<input type="file" id="pg-f" accept="application/pdf,.pdf" class="syf-in" style="padding:6px">' +
        '<div class="syf-note-hint" id="pg-info"></div>' +
        '<div class="syf-seg" id="pg-src"><button class="on" data-s="draw">ارسم التوقيع</button><button data-s="img">صورة توقيع</button></div>' +
        '<div data-pgv="draw"><canvas id="pg-cv" width="360" height="140" style="width:100%;border:1px dashed var(--line);border-radius:8px;background:#fff;touch-action:none;cursor:crosshair"></canvas>' +
          '<div class="syf-row"><button class="syf-mini" id="pg-clear">مسح</button><span class="syf-note-hint">ارسم بالماوس أو بالإصبع</span></div></div>' +
        '<div data-pgv="img" style="display:none"><input type="file" id="pg-img" accept="image/png,image/jpeg" class="syf-in" style="padding:6px"><div class="syf-note-hint">PNG بخلفية شفّافة هو الأنسب.</div></div>' +
        '<label>الموضع</label>' + cornerSeg('pg-pos', 'br') +
        '<div class="syf-row"><div style="flex:1"><label>العرض (% من الصفحة)</label><input type="number" class="syf-in" id="pg-w" value="25" min="5" max="90"></div>' +
        '<div style="flex:1"><label>الصفحات (فارغ = الأخيرة)</label><input class="syf-in" id="pg-r" placeholder="مثال: 1, 3-" dir="ltr"></div></div>' +
        '<button class="syf-btn" id="pg-go">توقيع وتنزيل</button>' +
        '<div class="syf-note-hint">التوقيع يُرسم كصورة فوق الصفحة والنصّ يبقى نصّاً. محلّي بالكامل — لا يُرفع الملفّ. ليس توقيعاً رقمياً مُعتمَداً ولا تشفيراً.</div>' +
        '<div class="syf-empty" id="pg-st" style="display:none"></div>' +
      '</div>'));
    var fIn = body.querySelector('#pg-f'), info = body.querySelector('#pg-info'), cv = body.querySelector('#pg-cv'), imgIn = body.querySelector('#pg-img'),
        wIn = body.querySelector('#pg-w'), rIn = body.querySelector('#pg-r'), goB = body.querySelector('#pg-go'), st = body.querySelector('#pg-st');
    var src = 'draw', corner = 'br', drawn = false, total = 0;
    function say(t) { st.style.display = ''; st.textContent = t; }
    segWire(body.querySelector('#pg-src'), 's', function (v) { src = v; body.querySelectorAll('[data-pgv]').forEach(function (x) { x.style.display = x.getAttribute('data-pgv') === v ? '' : 'none'; }); });
    segWire(body.querySelector('#pg-pos'), 'c', function (v) { corner = v; });
    /* the pad: pointer events, so mouse / pen / finger all draw; the canvas keeps its
       own scale (CSS width 100% vs 360 attribute) — map through the bounding box */
    var ctx = cv.getContext('2d'), down = false;
    ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    function pt(e) { var r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; }
    cv.addEventListener('pointerdown', function (e) { down = true; drawn = true; var p = pt(e); ctx.beginPath(); ctx.moveTo(p[0], p[1]); cv.setPointerCapture(e.pointerId); e.preventDefault(); });
    cv.addEventListener('pointermove', function (e) { if (!down) return; var p = pt(e); ctx.lineTo(p[0], p[1]); ctx.stroke(); });
    cv.addEventListener('pointerup', function () { down = false; });
    cv.addEventListener('pointercancel', function () { down = false; });
    body.querySelector('#pg-clear').addEventListener('click', function () { ctx.clearRect(0, 0, cv.width, cv.height); drawn = false; });
    fIn.addEventListener('change', async function () {
      total = 0; info.textContent = '';
      var f = fIn.files && fIn.files[0]; if (!f) return;
      try { var PDFLib = await loadPdflib(); total = (await PDFLib.PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true })).getPageCount(); info.textContent = SYFS.t('{0} صفحة.', total); }
      catch (e) { info.textContent = SYFS.t('تعذّرت قراءة الملف.'); }
    });
    goB.addEventListener('click', async function () {
      var f = fIn.files && fIn.files[0]; if (!f) { fIn.focus(); return; }
      if (src === 'draw' && !drawn) { say(SYFS.t('ارسم التوقيع أولاً.')); return; }
      if (src !== 'draw' && !(imgIn.files && imgIn.files[0])) { imgIn.focus(); return; }
      /* the pad is read INSIDE the lock — awaiting it first let a double click sign twice */
      await withBusy(goB, async function () { try {
        var blob = src === 'draw' ? await pngOf(cv) : imgIn.files[0];
        var PDFLib = await loadPdflib();
        var doc = await PDFLib.PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
        total = doc.getPageCount();
        var idx = pdfPagesFor(rIn.value, total);
        if (!idx) { say(SYFS.t('نطاق غير صالح. اكتب مثل 1-3, 7, 12- ضمن {0} صفحة.', total)); return; }
        var img = await pdfEmbed(PDFLib, doc, blob);
        var pct = Math.min(90, Math.max(5, parseInt(wIn.value, 10) || 25)) / 100;
        idx.forEach(function (i) {
          var pg = doc.getPage(i), sz = pg.getSize();
          var w = sz.width * pct, hh = w * img.height / img.width, p = pdfPlace(corner, sz.width, sz.height, w, hh, 24);
          pg.drawImage(img, { x: p.x, y: p.y, width: w, height: hh });
        });
        var out = new Blob([await doc.save()], { type: 'application/pdf' });
        dlBlob(out, safeBase(f.name) + '-signed.pdf');
        say(SYFS.t('تمّ ✓ — {0} صفحة · {1}', idx.length, fmtSize(out.size)));
      } catch (e) {
        say(SYFS.t('تعذّر: {0} (قد يكون الملف محمياً بكلمة مرور)', (e && e.message) || SYFS.t('خطأ')));
      } });
    });
  }
  function mountPdfNumber(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<input type="file" id="pn-f" accept="application/pdf,.pdf" class="syf-in" style="padding:6px">' +
        '<label>الموضع</label>' + cornerSeg('pn-pos', 'bc') +
        '<label>الصيغة</label><div class="syf-seg" id="pn-fmt"><button class="on" data-f="n">1</button><button data-f="nt">1 / 12</button><button data-f="p">Page 1</button></div>' +
        '<div class="syf-row"><div style="flex:1"><label>يبدأ من</label><input type="number" class="syf-in" id="pn-start" value="1" min="0"></div>' +
        '<div style="flex:1"><label>حجم الخطّ</label><input type="number" class="syf-in" id="pn-size" value="11" min="6" max="36"></div>' +
        '<div style="flex:1"><label>تخطَّ أول</label><input type="number" class="syf-in" id="pn-skip" value="0" min="0"></div></div>' +
        '<button class="syf-btn" id="pn-go">ترقيم وتنزيل</button>' +
        '<div class="syf-note-hint">أرقام لاتينية (0-9) بخطّ Helvetica المضمّن في PDF — الأرقام العربية-الهندية تحتاج تضمين خطّ عربي وهو خارج هذه الأداة. النصّ الأصلي يبقى كما هو.</div>' +
        '<div class="syf-empty" id="pn-st" style="display:none"></div>' +
      '</div>'));
    var fIn = body.querySelector('#pn-f'), goB = body.querySelector('#pn-go'), st = body.querySelector('#pn-st'), corner = 'bc', fmt = 'n';
    function say(t) { st.style.display = ''; st.textContent = t; }
    segWire(body.querySelector('#pn-pos'), 'c', function (v) { corner = v; });
    segWire(body.querySelector('#pn-fmt'), 'f', function (v) { fmt = v; });
    goB.addEventListener('click', async function () {
      var f = fIn.files && fIn.files[0]; if (!f) { fIn.focus(); return; }
      await withBusy(goB, async function () { try {
        var PDFLib = await loadPdflib();
        var doc = await PDFLib.PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
        var font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
        var total = doc.getPageCount(), start = parseInt(body.querySelector('#pn-start').value, 10) || 0,
            size = Math.min(36, Math.max(6, parseInt(body.querySelector('#pn-size').value, 10) || 11)),
            skip = Math.max(0, parseInt(body.querySelector('#pn-skip').value, 10) || 0), done = 0;
        var numbered = total - skip;
        for (var i = skip; i < total; i++) {
          var n = start + (i - skip);
          var label = fmt === 'nt' ? n + ' / ' + (start + numbered - 1) : fmt === 'p' ? 'Page ' + n : String(n);
          var pg = doc.getPage(i), sz = pg.getSize(), w = font.widthOfTextAtSize(label, size), p = pdfPlace(corner, sz.width, sz.height, w, size, 24);
          pg.drawText(label, { x: p.x, y: p.y, size: size, font: font, color: PDFLib.rgb(0.2, 0.2, 0.2) });
          done++;
        }
        var out = new Blob([await doc.save()], { type: 'application/pdf' });
        dlBlob(out, safeBase(f.name) + '-numbered.pdf');
        say(SYFS.t('تمّ ✓ — {0} صفحة · {1}', done, fmtSize(out.size)));
      } catch (e) {
        say(SYFS.t('تعذّر: {0} (قد يكون الملف محمياً بكلمة مرور)', (e && e.message) || SYFS.t('خطأ')));
      } });
    });
  }
  function mountPdfWatermark(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<input type="file" id="pw-f" accept="application/pdf,.pdf" class="syf-in" style="padding:6px">' +
        '<div class="syf-seg" id="pw-src"><button class="on" data-s="text">نصّ</button><button data-s="img">صورة / شعار</button></div>' +
        '<div data-pwv="text"><input class="syf-in" id="pw-t" placeholder="مثال: سرّي · مسودّة · نسخة للمراجعة" value="سرّي"></div>' +
        '<div data-pwv="img" style="display:none"><input type="file" id="pw-img" accept="image/png,image/jpeg" class="syf-in" style="padding:6px"></div>' +
        '<div class="syf-row"><div style="flex:1"><label>الشفافية %</label><input type="number" class="syf-in" id="pw-o" value="18" min="3" max="100"></div>' +
        '<div style="flex:1"><label>العرض (% من الصفحة)</label><input type="number" class="syf-in" id="pw-w" value="70" min="10" max="100"></div>' +
        '<div style="flex:1"><label>الدوران</label><select class="syf-in" id="pw-a"><option value="45">45°</option><option value="30">30°</option><option value="0">0°</option><option value="-45">−45°</option></select></div></div>' +
        '<label>الصفحات (فارغ = الكلّ)</label><input class="syf-in" id="pw-r" placeholder="مثال: 1-3, 7" dir="ltr">' +
        '<button class="syf-btn" id="pw-go">وضع العلامة وتنزيل</button>' +
        '<div class="syf-note-hint">النصّ يُرسم صورةً فوق الصفحة (لذلك تعمل العربية)، ونصّ المستند الأصلي يبقى نصّاً قابلاً للتحديد. محلّي بالكامل.</div>' +
        '<div class="syf-empty" id="pw-st" style="display:none"></div>' +
      '</div>'));
    var fIn = body.querySelector('#pw-f'), tIn = body.querySelector('#pw-t'), imgIn = body.querySelector('#pw-img'), goB = body.querySelector('#pw-go'), st = body.querySelector('#pw-st'), src = 'text';
    tIn.maxLength = 80;
    function say(t) { st.style.display = ''; st.textContent = t; }
    segWire(body.querySelector('#pw-src'), 's', function (v) { src = v; body.querySelectorAll('[data-pwv]').forEach(function (x) { x.style.display = x.getAttribute('data-pwv') === v ? '' : 'none'; }); });
    /* render the text on a transparent canvas — the only way an Arabic watermark exists in a PDF without a shaped font */
    function textPng(text) {
      var m = document.createElement('canvas').getContext('2d');
      m.font = 'bold 96px system-ui, "Segoe UI", Tahoma, sans-serif';
      var w = Math.ceil(m.measureText(text).width) + 40;
      var c = document.createElement('canvas'); c.width = Math.max(40, w); c.height = 130;
      var g = c.getContext('2d');
      g.font = m.font; g.fillStyle = '#000'; g.textBaseline = 'middle'; g.textAlign = 'center';
      g.fillText(text, c.width / 2, c.height / 2);                          /* fillText — user text never meets markup */
      return pngOf(c);
    }
    goB.addEventListener('click', async function () {
      var f = fIn.files && fIn.files[0]; if (!f) { fIn.focus(); return; }
      var text = tIn.value.trim();
      if (src === 'text' && !text) { tIn.focus(); return; }
      if (src !== 'text' && !(imgIn.files && imgIn.files[0])) { imgIn.focus(); return; }
      /* rendered INSIDE the lock — awaiting it first let a double click stamp twice */
      await withBusy(goB, async function () { try {
        var blob = src === 'text' ? await textPng(text) : imgIn.files[0];
        var PDFLib = await loadPdflib();
        var doc = await PDFLib.PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
        var total = doc.getPageCount();
        var idx = body.querySelector('#pw-r').value.trim() ? parsePageIdx(body.querySelector('#pw-r').value, total) : doc.getPageIndices();
        if (!idx) { say(SYFS.t('نطاق غير صالح. اكتب مثل 1-3, 7, 12- ضمن {0} صفحة.', total)); return; }
        var img = await pdfEmbed(PDFLib, doc, blob);
        var op = Math.min(100, Math.max(3, parseInt(body.querySelector('#pw-o').value, 10) || 18)) / 100;
        var pct = Math.min(100, Math.max(10, parseInt(body.querySelector('#pw-w').value, 10) || 70)) / 100;
        var ang = parseInt(body.querySelector('#pw-a').value, 10) || 0, rad = ang * Math.PI / 180;
        idx.forEach(function (i) {
          var pg = doc.getPage(i), sz = pg.getSize();
          var w = sz.width * pct, hh = w * img.height / img.width;
          /* pdf-lib rotates about the image's bottom-left corner: solve for the corner
             that puts the rotated image's CENTRE on the page centre */
          var cx = sz.width / 2, cy = sz.height / 2;
          var x = cx - (w / 2) * Math.cos(rad) + (hh / 2) * Math.sin(rad);
          var y = cy - (w / 2) * Math.sin(rad) - (hh / 2) * Math.cos(rad);
          pg.drawImage(img, { x: x, y: y, width: w, height: hh, opacity: op, rotate: PDFLib.degrees(ang) });
        });
        var out = new Blob([await doc.save()], { type: 'application/pdf' });
        dlBlob(out, safeBase(f.name) + '-watermarked.pdf');
        say(SYFS.t('تمّ ✓ — {0} صفحة · {1}', idx.length, fmtSize(out.size)));
      } catch (e) {
        say(SYFS.t('تعذّر: {0} (قد يكون الملف محمياً بكلمة مرور)', (e && e.message) || SYFS.t('خطأ')));
      } });
    });
  }

  function mountPdfCompress(body) {
      var ui = h(
        '<div class="syf-form">' +
          '<input type="file" id="pc-f" accept="application/pdf,.pdf" class="syf-in" style="padding:6px">' +
          '<label>الجودة</label>' +
          '<div class="syf-seg" id="pc-q"><button data-q="0.55">منخفضة (أصغر)</button><button data-q="0.72" class="on">متوسطة</button><button data-q="0.85">عالية</button></div>' +
          '<label>دقة الصفحة</label>' +
          '<div class="syf-seg" id="pc-dpi"><button data-d="72">72</button><button data-d="110" class="on">110</button><button data-d="150">150 DPI</button></div>' +
          '<div class="syf-note-warn">⚠️ الناتج يحوّل صفحات PDF إلى صور — النص لن يكون قابلاً للتحديد أو البحث. الأنسب للمستندات الممسوحة ضوئياً.</div>' +
          '<button class="syf-btn" id="pc-go">ضغط وتنزيل</button>' +
          '<div class="syf-note-list" id="pc-list"></div>' +
          '<div class="syf-note-hint">المعالجة محلية بالكامل — لا يُرفع الملف. قد لا يعمل محرّك PDF على مواقع ذات سياسة أمان صارمة؛ جرّبه على تبويب جديد فارغ.</div>' +
        '</div>'
      );
      body.appendChild(ui);
      var q = 0.72, dpi = 110, list = ui.querySelector('#pc-list'), goBtn = ui.querySelector('#pc-go'), filesIn = ui.querySelector('#pc-f');
      ui.querySelector('#pc-q').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; q = parseFloat(b.dataset.q); this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); });
      ui.querySelector('#pc-dpi').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; dpi = parseInt(b.dataset.d, 10); this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); });

      goBtn.addEventListener('click', async function () {
        var f = filesIn.files && filesIn.files[0]; if (!f) { filesIn.focus(); return; }
        if (goBtn.disabled) return;
        list.innerHTML = '';
        var statusRow = noteRow(list, SYFS.t('{0} — قراءة…', f.name));
        var pdf = null;
        await withBusy(goBtn, async function () { try {
          goBtn.textContent = SYFS.t('تحميل محرّك PDF…');
          var pdfjs = await loadPdfjs();
          var buf = await f.arrayBuffer();
          pdf = await pdfjs.getDocument({ data: buf }).promise;
          /* ⚠️ each page goes into the writer the moment it is drawn and its canvas is
             released, and it keeps its REAL size in points (v0.139.2). Keeping every
             canvas to the end held ~4.7MB × pages (a 400-page scan ≈ 1.9GB — the tab
             died), and «1 pixel = 1 point» printed a 110-DPI A4 at 153%. Since
             v0.139.5 the JPEG is a Blob from toBlob, not a base64 copy on the heap. */
          var scale = dpi / 72, writer = window.SYFS_PDF.createWriter(null), capped = 0;
          for (var p = 1; p <= pdf.numPages; p++) {
            goBtn.textContent = SYFS.t('معالجة صفحة {0}/{1}…', p, pdf.numPages);
            statusRow.querySelector('.t').textContent = SYFS.t('{0} — صفحة {1}/{2}', f.name, p, pdf.numPages);
            var page = await pdf.getPage(p);
            var pt = page.getViewport({ scale: 1 });
            var cv = await renderPage(page, scale);
            if (cv.syfsCapped) capped++;
            await writer.addAsync(cv, q, pt.width, pt.height);
            cv.width = cv.height = 0;
            try { page.cleanup(); } catch (e) { /* ignore */ }
            await sleep(0);
          }
          var blob = writer.finish();
          noteCapped(list, capped);
          /* i18n-dyn: the user's own file name and its byte counts */
          statusRow.querySelector('.t').textContent = f.name + ' — ' + fmtSize(f.size) + ' ← ' + fmtSize(blob.size);
          var pct = f.size ? Math.round((1 - blob.size / f.size) * 100) : 0;
          statusRow.querySelector('b').textContent = (pct >= 0 ? '−' : '+') + Math.abs(pct) + '%';
          dlBlob(blob, safeBase(f.name) + '-compressed.pdf');
        } catch (e) {
          statusRow.querySelector('.t').textContent = SYFS.t('{0} — تعذّر: {1} (قد تكون الصفحة محميّة بسياسة أمان صارمة أو الملف محمي بكلمة مرور)', f.name, (e && e.message) || SYFS.t('خطأ'));
          statusRow.querySelector('b').textContent = '✗';
        } finally {
          /* the document and its pdf.js worker leaked on every run until v0.139.2 */
          if (pdf) { try { pdf.destroy(); } catch (e4) { /* ignore */ } }
        } });
      });
  }

  /* «إلى Word» (v0.146.0) — the «PDF إلى Word» tool folded in as a tab, so every PDF job
     lives in one tool. The conversion itself stays in the Word editor page
     (word.html#pdf): it needs the page-width editor and the docx writer, and a file
     picked in this content-script window cannot be handed to an extension page. */
  function mountPdfWord(body) {
    var ui = h(
      '<div class="syf-form">' +
        '<div class="syf-note-hint">يحوّل ملف PDF نصّياً إلى مستند Word قابل للتحرير: النصّ والعناوين والقوائم، مع فاصل صفحة بين الصفحات (حتى 300 صفحة).</div>' +
        '<button class="syf-btn" id="pw-go">افتح محوّل PDF إلى Word</button>' +
        '<div class="syf-note-warn">⚠️ الجداول والصور والأعمدة المتعدّدة لا تُنقل؛ والملف المصوَّر (بلا طبقة نصّ) يُرفض — استخدم «استخراج نصّ من صورة» أولاً.</div>' +
      '</div>'
    );
    body.appendChild(ui);
    ui.querySelector('#pw-go').addEventListener('click', function () {
      try {
        chrome.runtime.sendMessage({ type: 'SYFS_OPEN_WORD', pdf: true }, function () { void chrome.runtime.lastError; });
      } catch (e) { /* ignore */ }
    });
  }

  /* ⛔ The id stays `pdfcompress`. The tool grew from one job to four, but an id is a
     user's shortcut and their place in a stored order — and «ضغط» is still the tab this
     opens on, so nobody who knew where it was has to find it again. */
  SYFS.tools.push({
    id: 'pdfcompress', name: 'أدوات PDF', cat: 'docs',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 17v-4h1.5a1.5 1.5 0 0 1 0 3H8"/><path d="M13 13v4h1.5a2 2 0 0 0 0-4z"/></svg>',
    mount: function (body) {
      SYFS.tabs(body, [
        { label: 'ضغط', build: mountPdfCompress },
        /* the same panel as «محرر الصور والمحوّل» — its ids are looked up inside its own
           tree, so both windows can be open at once */
        { label: 'PDF ⇄ صور', build: mountPdfImages },
        { label: 'دمج', build: mountPdfMerge },
        { label: 'تقسيم واستخراج', build: mountPdfSplit },
        { label: 'تدوير', build: mountPdfRotate },
        { label: 'توقيع', build: mountPdfSign },
        { label: 'ترقيم', build: mountPdfNumber },
        { label: 'علامة مائية', build: mountPdfWatermark },
        { label: 'إلى Word', build: mountPdfWord }
      ]);
    }
  });

  /* v0.166.0 — the three capture routines «الاستوديو» (src/studio.js) runs for its
     «التقاط» group, each → a canvas, and the two entry points the floating bar
     (src/capbar.js) calls. The panels above run the same routines, so a capture fixed
     here is fixed everywhere. */
  SYFS._media = {
    regionCanvas: function () { return runRegionCapture(function () {}, true).then(function (o) { return o ? o.canvas : null; }); },
    visibleCanvas: visibleCanvas, fullCanvas: function () { return fullPageCanvas().then(function (o) { return o.canvas; }); },
    quickShot: quickShot, toEditor: toEditor
  };
}());
