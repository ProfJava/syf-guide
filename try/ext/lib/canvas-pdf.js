/* SYF — canvas → PDF, with no external library.
 *
 * PDF supports JPEG natively via /DCTDecode, so a page is just the JPEG bytes wrapped
 * in an XObject. That keeps this CSP-safe (no eval, no wasm) and tiny.
 *
 * Shared by src/media.js (content script, image suite) and src/editor.js (the pro
 * editor page). Exposes window.SYFS_PDF — do not fork this file. */
(function () {
  /* Flatten a canvas on white (JPEG has no alpha) and return its JPEG bytes. */
  function flatten(canvas) {
    var w = canvas.width, h = canvas.height;
    var flat = document.createElement('canvas'); flat.width = w; flat.height = h;
    var fg = flat.getContext('2d'); fg.fillStyle = '#fff'; fg.fillRect(0, 0, w, h); fg.drawImage(canvas, 0, 0);
    return flat;
  }
  function canvasJpegBytes(canvas, q) {
    var w = canvas.width, h = canvas.height, flat = flatten(canvas);
    var durl = flat.toDataURL('image/jpeg', q || 0.92);
    flat.width = flat.height = 0;
    var bin = atob(durl.slice(durl.indexOf(',') + 1));
    var jpg = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) jpg[i] = bin.charCodeAt(i);
    return { bytes: jpg, w: w, h: h };
  }
  /* The async twin (v0.139.5): toBlob hands the JPEG back as a Blob, so a page never
     exists as a base64 string (1.33× its size) plus a byte copy on the JS heap, and the
     Blob itself can live outside it. Falls back to the sync path where toBlob is missing. */
  function canvasJpegBlob(canvas, q) {
    var w = canvas.width, h = canvas.height;
    if (typeof canvas.toBlob !== 'function') return Promise.resolve(canvasJpegBytes(canvas, q));
    var flat = flatten(canvas);
    return new Promise(function (res, rej) {
      flat.toBlob(function (b) {
        flat.width = flat.height = 0;
        if (!b) { rej(new Error('jpeg-encode')); return; }
        res({ blob: b, w: w, h: h });
      }, 'image/jpeg', q || 0.92);
    });
  }

  /* A4 in PostScript points (72 pt = 1 inch). */
  var A4 = { w: 595, h: 842 };
  /* the largest page side PDF readers accept (Acrobat's limit, 200 inches) */
  var MAX_PT = 14400;

  /* A page encoded ahead of time — lets a caller drop each canvas as soon as it is
     drawn (a 400-page scan kept ~2GB of canvases alive until the end) and carry the
     page's REAL size in points (ptW/ptH), independent of the pixels it was drawn at. */
  function encodePage(canvas, q, ptW, ptH) {
    var j = canvasJpegBytes(canvas, q);
    if (ptW > 0 && ptH > 0) { j.ptW = ptW; j.ptH = ptH; }
    return j;
  }
  function encodePageAsync(canvas, q, ptW, ptH) {
    return canvasJpegBlob(canvas, q).then(function (j) {
      if (ptW > 0 && ptH > 0) { j.ptW = ptW; j.ptH = ptH; }
      return j;
    });
  }

  /* Work out the page box and where the image sits on it.
   * fit 'a4'  → fixed A4 page (auto-rotated to landscape for a wide image), the
   *             image scaled to fit inside `margin` and centred.
   * otherwise → the page is the given size in points (ptW/ptH) — else 1 pixel =
   *             1 point — clamped to MAX_PT. ⚠️ Until v0.139.2 a page rendered at
   *             110/150 DPI came back 1.53×/2.08× its size (an A4 contract printed at
   *             153% and cut off), and a full-page screenshot could pass 14400pt. */
  function layout(iw, ih, opts, ptW, ptH) {
    if (!opts || opts.fit !== 'a4') {
      var pw0 = ptW > 0 ? ptW : iw, ph0 = ptH > 0 ? ptH : ih;
      var k = Math.min(1, MAX_PT / pw0, MAX_PT / ph0);
      return { pw: pw0 * k, ph: ph0 * k, x: 0, y: 0, w: pw0 * k, h: ph0 * k };
    }
    var margin = typeof opts.margin === 'number' ? opts.margin : 24;
    var land = iw > ih;
    var pw = land ? A4.h : A4.w, ph = land ? A4.w : A4.h;
    var availW = Math.max(1, pw - margin * 2), availH = Math.max(1, ph - margin * 2);
    var s = Math.min(availW / iw, availH / ih);
    var w = iw * s, h = ih * s;
    return { pw: pw, ph: ph, x: (pw - w) / 2, y: (ph - h) / 2, w: w, h: h };
  }

  /* An incremental PDF writer (v0.139.5). Each page is written the moment it is
   * added, so a caller can draw a page, add it, and free the canvas before drawing
   * the next; nothing but the encoded JPEGs (Blobs where possible) is kept.
   * opts: { fit: 'a4'|undefined, margin: pt } — default keeps the page at the
   * image's own size, so every aspect ratio is preserved.
   *   w.add(canvasOrPage, q)                  sync; page = encodePage() output
   *   w.addAsync(canvas, q, ptW?, ptH?)       async; toBlob, no base64 on the heap
   *   w.count() · w.finish() → Blob
   * Object layout: 1=Catalog, 2=Pages (written LAST, once /Count is known — xref
   * offsets make object order free), then per page i (0-based):
   *   page = 3+i*3, content = 4+i*3, image = 5+i*3. */
  function createWriter(opts) {
    var enc = new TextEncoder(), parts = [], pos = 0, off = [], n = 0, done = false;
    function put(s) { var b = enc.encode(s); parts.push(b); pos += b.length; }
    function num(x) { return (Math.round(x * 100) / 100).toString(); }
    function writePage(pg) {
      if (done) throw new Error('pdf-finished');
      var data = pg.blob || pg.bytes, len = pg.blob ? pg.blob.size : pg.bytes.length;
      var L = layout(pg.w, pg.h, opts, pg.ptW, pg.ptH);
      var pageObj = 3 + n * 3, contentObj = pageObj + 1, imgObj = pageObj + 2;
      off[pageObj] = pos;
      put(pageObj + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(L.pw) + ' ' + num(L.ph) + '] /Resources << /XObject << /Im0 ' + imgObj + ' 0 R >> >> /Contents ' + contentObj + ' 0 R >>\nendobj\n');
      var content = 'q ' + num(L.w) + ' 0 0 ' + num(L.h) + ' ' + num(L.x) + ' ' + num(L.y) + ' cm /Im0 Do Q';
      off[contentObj] = pos;
      put(contentObj + ' 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\n');
      off[imgObj] = pos;
      put(imgObj + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + pg.w + ' /Height ' + pg.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + len + ' >>\nstream\n');
      parts.push(data); pos += len;
      put('\nendstream\nendobj\n');
      n++;
    }
    put('%PDF-1.3\n');
    off[1] = pos; put('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    return {
      add: function (src, q) { writePage((src && (src.bytes || src.blob)) ? src : canvasJpegBytes(src, q)); },
      addAsync: function (canvas, q, ptW, ptH) { return encodePageAsync(canvas, q, ptW, ptH).then(writePage); },
      count: function () { return n; },
      finish: function () {
        if (done) throw new Error('pdf-finished');
        done = true;
        var kids = [];
        for (var i = 0; i < n; i++) kids.push((3 + i * 3) + ' 0 R');
        off[2] = pos; put('2 0 obj\n<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>\nendobj\n');
        var count = 2 + n * 3;
        var xref = pos, s = 'xref\n0 ' + (count + 1) + '\n0000000000 65535 f \n';
        for (var k = 1; k <= count; k++) s += ('0000000000' + off[k]).slice(-10) + ' 00000 n \n';
        put(s);
        put('trailer\n<< /Size ' + (count + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
        var blob = new Blob(parts, { type: 'application/pdf' });
        parts = null;
        return blob;
      }
    };
  }

  /* Build a multi-page PDF in one call; each item is a canvas or an encodePage() page
     ({bytes, w, h, ptW?, ptH?}), used as-is. Kept for callers that already hold
     every page (the editor's single canvas) — new code should use createWriter. */
  function canvasesToPdfBlob(canvases, q, opts) {
    var w = createWriter(opts);
    for (var p = 0; p < canvases.length; p++) w.add(canvases[p], q);
    return w.finish();
  }

  window.SYFS_PDF = {
    A4: A4,
    MAX_PT: MAX_PT,
    layout: layout,
    canvasJpegBytes: canvasJpegBytes,
    canvasJpegBlob: canvasJpegBlob,
    encodePage: encodePage,
    encodePageAsync: encodePageAsync,
    createWriter: createWriter,
    canvasesToPdfBlob: canvasesToPdfBlob,
    canvasToPdfBlob: function (canvas, q, opts) { return canvasesToPdfBlob([canvas], q, opts); }
  };
}());
