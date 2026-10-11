/* SYF Studio Lab — «مستندات ونصوص»: PDF ⇄ صور (pdf.js + canvas-pdf) · استخراج النص (Tesseract).
 * Both engines are files of the package, loaded only when the page is opened; the three
 * Tesseract paths are pinned to lib/ so nothing is ever fetched from a CDN. */
(function () {
  'use strict';
  var SL = window.SL, I = SL.icon;
  var url = function (p) { return new URL(p, location.href).href; };

  var pdfjs = null;
  function loadPdfjs() {
    if (pdfjs) return pdfjs;
    pdfjs = import(url('lib/pdfjs/pdf.min.mjs')).then(function (m) { m.GlobalWorkerOptions.workerSrc = url('lib/pdfjs/pdf.worker.min.mjs'); return m; });
    pdfjs.catch(function () { pdfjs = null; });
    return pdfjs;
  }
  var tess = null;
  function loadTesseract() {
    if (tess) return tess;
    tess = new Promise(function (res, rej) {
      if (window.Tesseract) return res(window.Tesseract);
      var s = document.createElement('script'); s.src = url('lib/tesseract/tesseract.min.js');
      s.onload = function () { res(window.Tesseract); }; s.onerror = rej; document.head.appendChild(s);
    });
    tess.catch(function () { tess = null; });
    return tess;
  }

  /* ================= PDF ⇄ صور ================= */
  function pdfTool(body) {
    var mode = SL.LS.get('pdf_mode', 'toimg');
    var head = SL.seg([['toimg', 'PDF ← صور (استخراج الصفحات)', 'image'], ['topdf', 'صور ← PDF (إنشاء ملف)', 'pdf']], mode, function (v) { mode = v; SL.LS.set('pdf_mode', v); paint(); });
    body.appendChild(head);
    var host = SL.h('<div style="margin-top:16px"></div>'); body.appendChild(host);
    function paint() { host.textContent = ''; if (mode === 'toimg') toImages(host); else toPdf(host); }
    paint();
  }

  function toImages(host) {
    var o = Object.assign({ dpi: 150, fmt: 'png', q: 90 }, SL.LS.get('pdf_ti', {}));
    var save = function () { SL.LS.set('pdf_ti', o); };
    var grid = SL.h('<div class="grid2"><div class="stack" data-l></div><div class="card stack" data-r></div></div>'); host.appendChild(grid);
    var L = grid.querySelector('[data-l]'), R = grid.querySelector('[data-r]');
    var doc = null, name = '', pages = [], picked = new Set();
    L.appendChild(SL.dropzone({ accept: 'application/pdf,.pdf', icon: 'pdf', title: 'اسحب ملف PDF أو انقر للاختيار', hint: 'تُعرض الصفحات مصغّرة — اختر ما تريد وحمّله صوراً',
      filter: function (f) { return /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name); }, onFiles: function (fs) { open(fs[0]); } }));
    var thumbs = SL.h('<div class="card" hidden><h3>' + I('pdf', 's') + '<span data-t></span></h3><div class="row" style="margin-bottom:10px" data-sel></div><div class="swatches" data-grid style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))"></div></div>');
    L.appendChild(thumbs);
    R.appendChild(SL.h('<h3>' + I('settings', 's') + 'إعدادات الاستخراج</h3>'));
    R.appendChild(SL.slider('الدقّة', 72, 300, 6, o.dpi, ' DPI', function (v) { o.dpi = v; save(); }));
    R.appendChild(SL.seg([['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']], o.fmt, function (v) { o.fmt = v; save(); }));
    R.appendChild(SL.slider('الجودة', 40, 100, 1, o.q, '٪', function (v) { o.q = v; save(); }));
    var prog = SL.h('<div class="progress" hidden><i></i></div>'); R.appendChild(prog);
    var go = SL.button('استخراج الصفحات المختارة', 'download', 'pri block', extract); R.appendChild(go);
    R.appendChild(SL.h('<div class="note">صفحة واحدة تُنزَّل ملفاً، وأكثر تُجمع في ZIP.</div>'));

    function open(f) {
      name = SL.base(f.name);
      loadPdfjs().then(function (m) { return f.arrayBuffer().then(function (b) { return m.getDocument({ data: b }).promise; }); }).then(function (d) {
        doc = d; pages = []; picked = new Set(); for (var i = 1; i <= d.numPages; i++) { pages.push(i); picked.add(i); }
        thumbs.hidden = false; thumbs.querySelector('[data-t]').textContent = SL.t('{0} · {1} صفحة', f.name, d.numPages);
        var sel = thumbs.querySelector('[data-sel]'); sel.textContent = '';
        sel.appendChild(SL.button('تحديد الكل', 'check', 'sm', function () { pages.forEach(function (p) { picked.add(p); }); mark(); }));
        sel.appendChild(SL.button('إلغاء التحديد', 'close', 'sm', function () { picked.clear(); mark(); }));
        var g = thumbs.querySelector('[data-grid]'); g.textContent = '';
        pages.forEach(function (p) {
          var b = SL.h('<button type="button" class="swatch" style="padding:0"><canvas style="width:100%;display:block;background:#fff"></canvas><span></span></button>');
          b.querySelector('span').textContent = SL.t('صفحة {0}', p); b.dataset.p = p;
          b.addEventListener('click', function () { if (picked.has(p)) picked.delete(p); else picked.add(p); mark(); });
          b.addEventListener('dblclick', function () { render(p, 2).then(function (c) { SL.setDoc(c, name + '-p' + p + '.png'); SL.open('editor'); }); });
          g.appendChild(b);
          render(p, 0.3).then(function (c) { var t = b.querySelector('canvas'); t.width = c.width; t.height = c.height; t.getContext('2d').drawImage(c, 0, 0); });
        });
        mark();
      }).catch(function () { SL.toast('تعذّر فتح الملف — قد يكون محمياً بكلمة مرور أو تالفاً', 'close', true); });
    }
    function mark() {
      [].forEach.call(thumbs.querySelectorAll('[data-p]'), function (b) { var on = picked.has(Number(b.dataset.p)); b.style.borderColor = on ? 'var(--acc)' : ''; b.style.opacity = on ? 1 : .5; });
      go.querySelector('.lbl').textContent = SL.t('استخراج {0} صفحة', picked.size);
    }
    function render(p, scale) {
      return doc.getPage(p).then(function (pg) {
        var vp = pg.getViewport({ scale: scale }), c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        return pg.render({ canvasContext: g, viewport: vp }).promise.then(function () { return c; });
      });
    }
    async function extract() {
      if (!doc || !picked.size) { SL.toast('افتح ملف PDF واختر صفحة', 'pdf', true); return; }
      go.disabled = true; prog.hidden = false;
      var list = pages.filter(function (p) { return picked.has(p); }), out = [];
      for (var i = 0; i < list.length; i++) {
        prog.firstChild.style.width = Math.round(i / list.length * 100) + '%';
        var c = await render(list[i], o.dpi / 72);
        var b = await SL.toBlob(c, 'image/' + o.fmt, o.q / 100);
        out.push({ name: name + '-' + String(list[i]).padStart(3, '0') + '.' + (o.fmt === 'jpeg' ? 'jpg' : o.fmt), blob: b });
      }
      prog.firstChild.style.width = '100%';
      if (out.length === 1) SL.download(out[0].blob, out[0].name);
      else SL.download(await SYFS.imgkit.zipWrite(out), name + '-pages.zip');
      SL.toast(SL.t('استُخرجت {0} صفحة', out.length), 'check');
      go.disabled = false; setTimeout(function () { prog.hidden = true; }, 500);
    }
  }

  function toPdf(host) {
    var o = Object.assign({ a4: true, q: 88, margin: 24 }, SL.LS.get('pdf_tp', {}));
    var save = function () { SL.LS.set('pdf_tp', o); };
    var items = [];
    var grid = SL.h('<div class="grid2"><div class="stack" data-l></div><div class="card stack" data-r></div></div>'); host.appendChild(grid);
    var L = grid.querySelector('[data-l]'), R = grid.querySelector('[data-r]');
    L.appendChild(SL.dropzone({ multiple: true, title: 'اسحب الصور التي تريدها في الملف', hint: 'تُرتَّب صفحاتها بالأسهم — صفحة لكل صورة',
      onFiles: function (fs) { Promise.all(fs.map(function (f) { return SL.fileToCanvas(f).then(function (c) { return { c: c, n: f.name }; }); })).then(function (a) { items = items.concat(a); paint(); }); } }));
    var list = SL.h('<div class="list"></div>'); L.appendChild(list);
    R.appendChild(SL.h('<h3>' + I('pdf', 's') + 'إعدادات الملف</h3>'));
    var a4 = SL.h('<label class="check"><input type="checkbox" class="sw"><span>صفحات A4 (الصورة داخل هوامش)</span></label>'); a4.querySelector('input').checked = o.a4;
    a4.querySelector('input').addEventListener('change', function (e) { o.a4 = e.target.checked; save(); }); R.appendChild(a4);
    R.appendChild(SL.slider('الهامش', 0, 72, 2, o.margin, 'pt', function (v) { o.margin = v; save(); }));
    R.appendChild(SL.slider('الجودة', 40, 100, 1, o.q, '٪', function (v) { o.q = v; save(); }));
    if (SL.doc()) R.appendChild(SL.button('إضافة الصورة المفتوحة', 'image', 'sm', function () { var d = SL.doc(); items.push({ c: d.canvas, n: d.name }); paint(); }));
    R.appendChild(SL.button('إنشاء PDF', 'pdf', 'pri block', function () {
      if (!items.length) { SL.toast('أضف صورة على الأقل', 'image', true); return; }
      var blob = SYFS_PDF.canvasesToPdfBlob(items.map(function (x) { return x.c; }), o.q / 100, o.a4 ? { fit: 'a4', margin: o.margin } : undefined);
      SL.download(blob, 'images-' + SL.stamp() + '.pdf'); SL.toast(SL.t('حُفظ PDF · {0} صفحة · {1}', items.length, SL.fmtBytes(blob.size)), 'check');
    }));
    function paint() {
      list.textContent = '';
      items.forEach(function (it, i) {
        var row = SL.h('<div class="fileitem"><img alt=""><div class="meta"><b></b><span></span></div><span class="row"></span></div>');
        row.querySelector('img').src = it.c.toDataURL('image/jpeg', .4);
        row.querySelector('b').textContent = (i + 1) + '. ' + it.n; row.querySelector('.meta span').textContent = SL.dims(it.c.width, it.c.height);
        var r = row.querySelector('.row');
        [['up', 'لأعلى', -1], ['down', 'لأسفل', 1]].forEach(function (a) { var b = SL.button('', a[0], 'sm icon ghost tiponly', function () { var j = i + a[2]; if (j < 0 || j >= items.length) return; var t = items[i]; items[i] = items[j]; items[j] = t; paint(); }); b.dataset.tip = SL.t(a[1]); r.appendChild(b); });
        var del = SL.button('', 'trash', 'sm icon ghost tiponly', function () { items.splice(i, 1); paint(); }); del.dataset.tip = SL.t('حذف'); r.appendChild(del);
        list.appendChild(row);
      });
    }
  }

  /* ================= استخراج النص ================= */
  function ocrTool(body) {
    var o = Object.assign({ lang: 'ara+eng' }, SL.LS.get('ocr', {}));
    var src = null, worker = null, busy = false;
    var grid = SL.h('<div class="grid2"><div class="stack" data-l></div><div class="card stack" data-r></div></div>'); body.appendChild(grid);
    var L = grid.querySelector('[data-l]'), R = grid.querySelector('[data-r]');
    var dz = SL.dropzone({ title: 'اسحب صورة فيها نص', hint: 'لقطة شاشة، صورة مستند، فاتورة… — تُقرأ على جهازك بلا إنترنت', icon: 'ocr', onFiles: function (fs) { SL.fileToCanvas(fs[0]).then(set); } });
    L.appendChild(dz);
    var pv = SL.h('<div class="preview checker" hidden><canvas></canvas></div>'); L.appendChild(pv);
    R.appendChild(SL.h('<h3>' + I('ocr', 's') + 'لغة النص</h3>'));
    R.appendChild(SL.seg([['ara', 'العربية'], ['eng', 'English'], ['ara+eng', 'الاثنتان']], o.lang, function (v) { o.lang = v; SL.LS.set('ocr', o); if (worker) { worker.terminate(); worker = null; } }));
    var prog = SL.h('<div class="progress"><i></i></div>'), st = SL.h('<div class="note">جاهز</div>');
    var go = SL.button('استخراج النص', 'sparkles', 'pri block', run);
    var out = SL.h('<textarea class="in" rows="12" placeholder="سيظهر النص هنا…"></textarea>');
    var row = SL.h('<div class="row"></div>');
    row.appendChild(SL.button('نسخ', 'copy', 'sm', function () { navigator.clipboard.writeText(out.value).then(function () { SL.toast('نُسخ النص', 'check'); }); }));
    row.appendChild(SL.button('تنزيل .txt', 'download', 'sm', function () { SL.download(new Blob([out.value], { type: 'text/plain;charset=utf-8' }), 'text-' + SL.stamp() + '.txt'); }));
    [prog, st, go, out, row].forEach(function (e) { R.appendChild(e); });
    function set(c) { src = c; pv.hidden = false; var v = pv.querySelector('canvas'); v.width = c.width; v.height = c.height; v.getContext('2d').drawImage(c, 0, 0); }
    if (SL.doc()) set(SL.doc().canvas);
    var un = SL.onDoc(function (d) { set(d.canvas); });
    async function run() {
      if (!src) { SL.toast('أضف صورة أولاً', 'image', true); return; }
      if (busy) return; busy = true; go.disabled = true; st.textContent = SL.t('يحمّل المحرّك…');
      try {
        var T = await loadTesseract();
        if (!worker) worker = await T.createWorker(o.lang, 1, {
          workerPath: url('lib/tesseract/worker.min.js'), corePath: url('lib/tesseract/tesseract-core-simd-lstm.js'), langPath: url('lib/tesseract/lang'),
          gzip: true, workerBlobURL: false, cacheMethod: 'none',
          logger: function (p) { if (typeof p.progress === 'number') prog.firstChild.style.width = Math.round(p.progress * 100) + '%'; var sm = p.status && ({ 'recognizing text': 'يقرأ النص…', 'loading language traineddata': 'يحمّل اللغة…', 'initializing api': 'يجهّز…' })[p.status]; if (sm) st.textContent = SL.t(sm); }
        });
        var t0 = Date.now(), res = await worker.recognize(src);
        out.value = (res && res.data && res.data.text) || '';
        st.textContent = out.value.trim() ? SL.t('تمّ في {0} ثانية · {1} كلمة', ((Date.now() - t0) / 1000).toFixed(1), out.value.trim().split(/\s+/).length) : SL.t('لم يُعثر على نصّ');
      } catch (e) { st.textContent = SL.t('تعذّر تشغيل المحرّك — جرّب صورة أخرى'); }
      busy = false; go.disabled = false;
    }
    return function () { un(); if (worker) worker.terminate(); };
  }

  SL.tools.push(
    { id: 'pdf', group: 'docs', label: 'PDF ⇄ صور', icon: 'pdf', desc: 'استخرج صفحات PDF صوراً بالدقّة التي تريد، أو اجمع صورك في ملف PDF.', mount: pdfTool },
    { id: 'ocr', group: 'docs', label: 'استخراج النص', icon: 'ocr', desc: 'اقرأ النص العربي والإنجليزي من صورة — على جهازك، بلا رفع.', mount: ocrTool }
  );
}());
