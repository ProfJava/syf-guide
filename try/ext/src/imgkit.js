/* SYF — imgkit: shared local image engine for the image tools.
 * decode (EXIF-aware) → resize (high quality) → encode with an optional binary
 * search to hit a target file size, plus a dependency-free ZIP writer
 * (CompressionStream 'deflate-raw') for downloading a batch as one file.
 *
 * Native canvas encoders cover PNG/JPEG/WebP. BMP, ICO, GIF and TIFF are written
 * here by hand (no library — MV3 forbids remote code and we ship no bundler).
 * Everything runs on local canvases; no image ever leaves the device. */
(function () {
  window.SYFS = window.SYFS || {};

  var MIN_DIM = 320;                 // don't shrink below this when chasing a target size
  var MIN_Q = 0.4;                   // lowest JPEG/WebP quality the search will try
  var SVG_DEFAULT = 1024;            // longest side used for an SVG with no intrinsic size

  /* the largest canvas we ever ask for (v0.139.3). Past Chrome's limits (≈268M px of
     area) a canvas is created silently EMPTY — toBlob hands back null and the user
     downloads nothing, or getImageData throws RangeError. A huge SVG or a 1000% resize
     reached it; the size is now scaled down (aspect kept) before the canvas exists. */
  var MAX_SIDE = 16384;
  var MAX_AREA = 16384 * 16384;

  function clampInt(v, lo, hi, dflt) {
    v = parseInt(v, 10);
    if (!isFinite(v)) return dflt;
    return Math.max(lo, Math.min(hi, v));
  }
  /* {w, h} scaled DOWN (never up) to fit MAX_SIDE and MAX_AREA; `capped` says it moved.
     ⛔ The ONE canvas cap: media.js (PDF page rendering, the converter, the batch
     tools) calls SYFS.imgkit.fitCanvas too — never a second copy of these limits. */
  function fitCanvas(w, h) {
    w = Math.max(1, Math.round(w) || 1); h = Math.max(1, Math.round(h) || 1);
    var s = Math.min(1, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_AREA / (w * h)));
    if (s >= 1) return { w: w, h: h, capped: false };
    return { w: Math.max(1, Math.floor(w * s)), h: Math.max(1, Math.floor(h * s)), capped: true };
  }

  /* Decode a File/Blob into an ImageBitmap, honouring embedded EXIF orientation
   * (this is what the old compressor got wrong — phone photos came out rotated). */
  function decode(file) {
    return createImageBitmap(file, { imageOrientation: 'from-image' });
  }

  /* ---- decodeAny: every input format the browser can actually read ----
   * createImageBitmap handles PNG/JPEG/WebP/GIF(first frame)/BMP/ICO/AVIF.
   * SVG is the exception (Chrome rejects it) → render it through an <img>.
   * HEIC/HEIF/TIFF have no browser decoder at all — say so instead of failing
   * with a blank "encode error". Returns a drawable (ImageBitmap or canvas);
   * pass it to release() when done. */
  function isSvg(file) {
    return ((file && file.type) === 'image/svg+xml') || /\.svg$/i.test((file && file.name) || '');
  }
  function undecodableReason(file) {
    var n = ((file && file.name) || '').toLowerCase(), t = ((file && file.type) || '').toLowerCase();
    if (/\.hei[cf]$/.test(n) || t.indexOf('heic') >= 0 || t.indexOf('heif') >= 0) {
      return 'صيغة HEIC/HEIF لا يفكّها المتصفّح — حوّلها من الجوّال إلى JPG أولاً';
    }
    if (/\.tiff?$/.test(n) || t.indexOf('tiff') >= 0) {
      return 'صيغة TIFF لا يفكّها المتصفّح (التصدير إليها مدعوم، لا القراءة منها)';
    }
    return 'صيغة غير مدعومة أو ملف تالف';
  }
  /* Read an SVG's intrinsic size from its markup (regex, not DOM — we never
   * parse or attach untrusted SVG; it is only ever drawn inside an <img>).
   * width/height wins; else the viewBox ratio; else a square of `longest`.
   * A vector has no true pixel size, so an SVG smaller than 256px is rendered
   * up to `longest` — converting a 24px icon to a 24px PNG is never useful. */
  function svgSize(text, longest) {
    var w = 0, hh = 0;
    var mw = /<svg[^>]*?\swidth\s*=\s*["']?\s*([\d.]+)\s*(px)?["']?/i.exec(text);
    var mh = /<svg[^>]*?\sheight\s*=\s*["']?\s*([\d.]+)\s*(px)?["']?/i.exec(text);
    if (mw) w = parseFloat(mw[1]);
    if (mh) hh = parseFloat(mh[1]);
    if (!(w > 0 && hh > 0)) {
      var vb = /<svg[^>]*?\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
      if (vb) { w = parseFloat(vb[1]); hh = parseFloat(vb[2]); }
    }
    if (!(w > 0 && hh > 0)) return { w: longest, h: longest };
    var big = Math.max(w, hh), s = big < 256 ? longest / big : 1;
    var f = fitCanvas(w * s, hh * s);
    return { w: f.w, h: f.h };
  }
  async function decodeSvg(file, longest) {
    var text = await file.text();
    var size = svgSize(text, longest || SVG_DEFAULT);
    var url = URL.createObjectURL(file);
    try {
      var img = await new Promise(function (res, rej) {
        var im = new Image();
        im.onload = function () { res(im); };
        im.onerror = function () { rej(new Error('svg')); };
        im.src = url;                       /* <img> never executes script inside an SVG */
      });
      var cv = document.createElement('canvas');
      cv.width = size.w; cv.height = size.h;
      var g = cv.getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, size.w, size.h);
      return cv;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function decodeAny(file, opts) {
    opts = opts || {};
    if (isSvg(file)) return decodeSvg(file, opts.svgLongest);
    try {
      return await decode(file);
    } catch (e) {
      throw new Error(undecodableReason(file));
    }
  }
  /* Free a drawable returned by decodeAny (ImageBitmap needs it, a canvas doesn't). */
  function release(drawable) {
    if (drawable && typeof drawable.close === 'function') drawable.close();
  }

  /* Draw a bitmap onto a fresh canvas at the requested size.
   * opts: { maxW, maxH, longest, percent, allowUpscale } — first one present wins.
   * Aspect ratio is always preserved. Returns the canvas. */
  function resize(bmp, opts) {
    opts = opts || {};
    var w = bmp.width, hh = bmp.height, scale = 1;
    if (opts.percent) {
      scale = opts.percent / 100;
    } else if (opts.longest) {
      scale = opts.longest / Math.max(w, hh);
    } else if (opts.maxW && opts.maxH) {
      scale = Math.min(opts.maxW / w, opts.maxH / hh);
    } else if (opts.maxW) {
      scale = opts.maxW / w;
    } else if (opts.maxH) {
      scale = opts.maxH / hh;
    }
    if (!opts.allowUpscale && scale > 1) scale = 1;
    if (!isFinite(scale) || scale <= 0) scale = 1;
    var fit = fitCanvas(w * scale, hh * scale), nw = fit.w, nh = fit.h;
    var cv = document.createElement('canvas');
    cv.width = nw; cv.height = nh;
    if (fit.capped) cv.syfsCapped = true;      /* callers may say the size was reduced */
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, nw, nh);
    return cv;
  }

  /* Encode a canvas to a Blob. JPEG/PDF-bound get a white matte (no alpha). */
  function encode(canvas, fmt, q) {
    var type = fmt.indexOf('/') > 0 ? fmt : 'image/' + fmt;
    var src = canvas;
    if (type === 'image/jpeg') {
      src = document.createElement('canvas'); src.width = canvas.width; src.height = canvas.height;
      var g = src.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, src.width, src.height); g.drawImage(canvas, 0, 0);
    }
    return new Promise(function (res) {
      src.toBlob(function (b) { res(b); }, type, type === 'image/png' ? undefined : q);
    });
  }

  /* Encode aiming for <= targetBytes. Binary-search quality first; if even MIN_Q
   * overshoots, shrink dimensions 85% at a time (down to MIN_DIM) and retry.
   * PNG is lossless — for PNG we only shrink dimensions. Returns {blob, quality, canvas}. */
  async function encodeToTarget(canvas, fmt, targetBytes) {
    var type = fmt.indexOf('/') > 0 ? fmt : 'image/' + fmt;
    var work = canvas;
    for (var attempt = 0; attempt < 8; attempt++) {
      if (type === 'image/png') {
        var pb = await encode(work, type);
        if (pb.size <= targetBytes || Math.max(work.width, work.height) <= MIN_DIM) return { blob: pb, quality: null, canvas: work };
      } else {
        var lo = MIN_Q, hi = 0.98, best = null, bestQ = MIN_Q;
        for (var i = 0; i < 7; i++) {
          var mid = (lo + hi) / 2;
          var b = await encode(work, type, mid);
          if (b.size <= targetBytes) { best = b; bestQ = mid; lo = mid; } else { hi = mid; }
        }
        if (best) return { blob: best, quality: bestQ, canvas: work };
        // even MIN_Q too big → check MIN_Q output, keep it if we can't shrink further
        var minB = await encode(work, type, MIN_Q);
        if (Math.max(work.width, work.height) <= MIN_DIM) return { blob: minB, quality: MIN_Q, canvas: work };
      }
      // shrink and retry
      var nw = Math.max(MIN_DIM, Math.round(work.width * 0.85));
      var scale = nw / work.width;
      var shrunk = document.createElement('canvas');
      shrunk.width = nw; shrunk.height = Math.max(1, Math.round(work.height * scale));
      var sg = shrunk.getContext('2d'); sg.imageSmoothingEnabled = true; sg.imageSmoothingQuality = 'high';
      sg.drawImage(work, 0, 0, shrunk.width, shrunk.height);
      work = shrunk;
    }
    var fb = await encode(work, type, type === 'image/png' ? undefined : MIN_Q);
    return { blob: fb, quality: type === 'image/png' ? null : MIN_Q, canvas: work };
  }

  /* ================= hand-written encoders (BMP · ICO · TIFF · GIF) =================
   * canvas.toBlob only speaks PNG/JPEG/WebP. These four are written byte by byte
   * so the converter can output them without pulling in a library. */

  /* Flatten to opaque RGB on a white matte — for formats with no alpha channel. */
  function flatten(canvas) {
    var cv = document.createElement('canvas');
    cv.width = canvas.width; cv.height = canvas.height;
    var g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(canvas, 0, 0);
    return g.getImageData(0, 0, cv.width, cv.height);
  }
  function pixels(canvas) {
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  }

  /* ---- BMP: 24-bit BI_RGB, bottom-up, rows padded to 4 bytes ----
   * bmpBytes takes an ImageData-shaped { data, width, height } so it can be
   * unit-tested without a canvas; encodeBmp is the canvas-facing wrapper. */
  function bmpBytes(im) {
    var w = im.width, hh = im.height, d = im.data;
    var rowSize = (w * 3 + 3) & ~3;                  // each row padded to a 4-byte boundary
    var pixSize = rowSize * hh, fileSize = 54 + pixSize;
    var buf = new ArrayBuffer(fileSize), v = new DataView(buf), u8 = new Uint8Array(buf);
    v.setUint8(0, 0x42); v.setUint8(1, 0x4D);        // "BM"
    v.setUint32(2, fileSize, true);
    v.setUint32(10, 54, true);                       // pixel data offset
    v.setUint32(14, 40, true);                       // BITMAPINFOHEADER size
    v.setInt32(18, w, true); v.setInt32(22, hh, true);
    v.setUint16(26, 1, true); v.setUint16(28, 24, true);
    v.setUint32(34, pixSize, true);
    v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);   // 72 DPI
    for (var y = 0; y < hh; y++) {
      var src = (hh - 1 - y) * w * 4;                // BMP rows run bottom-up
      var dst = 54 + y * rowSize;
      for (var x = 0; x < w; x++) {
        u8[dst++] = d[src + 2]; u8[dst++] = d[src + 1]; u8[dst++] = d[src];  // BGR
        src += 4;
      }
    }
    return u8;
  }
  function encodeBmp(canvas) {
    return new Blob([bmpBytes(flatten(canvas))], { type: 'image/bmp' });
  }

  /* ---- ICO: a container of PNG images (Vista+ style — no BMP masks needed) ---- */
  var ICO_SIZES = [16, 32, 48, 64, 128, 256];
  async function encodeIco(canvas, sizes) {
    sizes = (sizes && sizes.length ? sizes : [16, 32, 48, 256])
      .map(function (s) { return clampInt(s, 16, 256, 32); })
      .filter(function (s, i, a) { return a.indexOf(s) === i; })
      .sort(function (a, b) { return a - b; });
    var pngs = [];
    for (var i = 0; i < sizes.length; i++) {
      var s = sizes[i];
      var cv = document.createElement('canvas'); cv.width = s; cv.height = s;
      var g = cv.getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      /* letterbox into a square so a non-square source is not distorted */
      var sc = Math.min(s / canvas.width, s / canvas.height);
      var dw = Math.max(1, Math.round(canvas.width * sc)), dh = Math.max(1, Math.round(canvas.height * sc));
      g.drawImage(canvas, Math.round((s - dw) / 2), Math.round((s - dh) / 2), dw, dh);
      var blob = await new Promise(function (res) { cv.toBlob(res, 'image/png'); });
      pngs.push({ size: s, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    var n = pngs.length, headerLen = 6 + n * 16, offset = headerLen;
    var head = new ArrayBuffer(headerLen), v = new DataView(head);
    v.setUint16(0, 0, true); v.setUint16(2, 1, true); v.setUint16(4, n, true);   // reserved, type=icon, count
    for (var k = 0; k < n; k++) {
      var e = 6 + k * 16, sz = pngs[k].size;
      v.setUint8(e, sz === 256 ? 0 : sz);            // 0 means 256 in the ICO spec
      v.setUint8(e + 1, sz === 256 ? 0 : sz);
      v.setUint8(e + 2, 0); v.setUint8(e + 3, 0);    // palette count, reserved
      v.setUint16(e + 4, 1, true);                   // color planes
      v.setUint16(e + 6, 32, true);                  // bits per pixel
      v.setUint32(e + 8, pngs[k].bytes.length, true);
      v.setUint32(e + 12, offset, true);
      offset += pngs[k].bytes.length;
    }
    return new Blob([head].concat(pngs.map(function (p) { return p.bytes; })), { type: 'image/x-icon' });
  }

  /* ---- TIFF: baseline, uncompressed RGB, single strip, little-endian ---- */
  function tiffBytes(im) {
    var w = im.width, hh = im.height, d = im.data;
    var TAGS = 13, dataLen = w * hh * 3;
    var ifdLen = 2 + TAGS * 12 + 4;
    var bitsOff = 8 + ifdLen;                        // BitsPerSample needs 6 bytes out of line
    /* X/YResolution are REQUIRED in a baseline RGB TIFF (v0.139.4); strict readers
       (and print pipelines) reject or guess without them. RATIONAL = 8 bytes, out of line. */
    var xresOff = bitsOff + 6, yresOff = xresOff + 8;
    var pixOff = yresOff + 8;
    var buf = new ArrayBuffer(pixOff + dataLen), v = new DataView(buf), u8 = new Uint8Array(buf);
    v.setUint16(0, 0x4949, true);                    // "II" little-endian
    v.setUint16(2, 42, true);
    v.setUint32(4, 8, true);                         // first IFD offset
    v.setUint16(8, TAGS, true);
    var p = 10;
    function tag(id, type, count, value) {           // type 3=SHORT 4=LONG 5=RATIONAL (offset)
      v.setUint16(p, id, true); v.setUint16(p + 2, type, true); v.setUint32(p + 4, count, true);
      if (type === 3 && count === 1) { v.setUint16(p + 8, value, true); v.setUint16(p + 10, 0, true); }
      else v.setUint32(p + 8, value, true);
      p += 12;
    }
    tag(256, 4, 1, w);            // ImageWidth
    tag(257, 4, 1, hh);           // ImageLength
    tag(258, 3, 3, bitsOff);      // BitsPerSample → [8,8,8] out of line
    tag(259, 3, 1, 1);            // Compression = none
    tag(262, 3, 1, 2);            // PhotometricInterpretation = RGB
    tag(273, 4, 1, pixOff);       // StripOffsets
    tag(277, 3, 1, 3);            // SamplesPerPixel
    tag(278, 4, 1, hh);           // RowsPerStrip = whole image
    tag(279, 4, 1, dataLen);      // StripByteCounts
    tag(282, 5, 1, xresOff);      // XResolution → 72/1 out of line
    tag(283, 5, 1, yresOff);      // YResolution → 72/1 out of line
    tag(284, 3, 1, 1);            // PlanarConfiguration = chunky
    tag(296, 3, 1, 2);            // ResolutionUnit = inch
    v.setUint32(p, 0, true);                         // no next IFD
    v.setUint16(bitsOff, 8, true); v.setUint16(bitsOff + 2, 8, true); v.setUint16(bitsOff + 4, 8, true);
    v.setUint32(xresOff, 72, true); v.setUint32(xresOff + 4, 1, true);
    v.setUint32(yresOff, 72, true); v.setUint32(yresOff + 4, 1, true);
    var dst = pixOff;
    for (var i = 0; i < w * hh; i++) {
      u8[dst++] = d[i * 4]; u8[dst++] = d[i * 4 + 1]; u8[dst++] = d[i * 4 + 2];
    }
    return u8;
  }
  function encodeTiff(canvas) {
    return new Blob([tiffBytes(flatten(canvas))], { type: 'image/tiff' });
  }

  /* ---- GIF: median-cut palette + LZW, single frame ----
   * Colours are histogrammed at 5 bits per channel (32768 bins) so median-cut
   * runs over occupied bins, not over every pixel — a 12MP photo stays fast. */
  function medianCut(bins, maxColors) {
    var boxes = [bins];
    while (boxes.length < maxColors) {
      var pick = -1, bestVol = 0;
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        if (b.length < 2) continue;
        var vol = boxRange(b).vol;
        if (vol > bestVol) { bestVol = vol; pick = i; }
      }
      if (pick < 0 || bestVol === 0) break;
      var box = boxes[pick], r = boxRange(box);
      box.sort(function (a, b2) { return a[r.ch] - b2[r.ch]; });
      var total = 0, m;
      for (m = 0; m < box.length; m++) total += box[m][3];
      var half = total / 2, acc = 0, cut = 1;
      for (m = 0; m < box.length - 1; m++) {
        acc += box[m][3];
        if (acc >= half) { cut = m + 1; break; }
        cut = m + 2;
      }
      if (cut < 1) cut = 1;
      if (cut > box.length - 1) cut = box.length - 1;
      boxes.splice(pick, 1, box.slice(0, cut), box.slice(cut));
    }
    return boxes.map(function (box) {                // weighted average colour per box
      var sr = 0, sg = 0, sb = 0, n = 0;
      for (var i = 0; i < box.length; i++) {
        var c = box[i], w = c[3];
        sr += c[0] * w; sg += c[1] * w; sb += c[2] * w; n += w;
      }
      return [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
    });
  }
  function boxRange(box) {
    var lo = [255, 255, 255], hi = [0, 0, 0];
    for (var i = 0; i < box.length; i++) {
      for (var c = 0; c < 3; c++) {
        if (box[i][c] < lo[c]) lo[c] = box[i][c];
        if (box[i][c] > hi[c]) hi[c] = box[i][c];
      }
    }
    var ch = 0, best = -1;
    for (var k = 0; k < 3; k++) { var d = hi[k] - lo[k]; if (d > best) { best = d; ch = k; } }
    return { ch: ch, vol: best * box.length };
  }
  /* Build a palette + an index per pixel. Fully transparent pixels get index 0
   * when the source has alpha (GIF supports one transparent colour, not alpha). */
  function quantize(imgData, maxColors) {
    var d = imgData.data, n = imgData.width * imgData.height;
    var hasAlpha = false;
    for (var i = 0; i < n; i++) { if (d[i * 4 + 3] < 128) { hasAlpha = true; break; } }
    var slots = Math.max(2, Math.min(256, maxColors) - (hasAlpha ? 1 : 0));
    var counts = new Int32Array(32768), sums = new Float64Array(32768 * 3);
    for (i = 0; i < n; i++) {
      if (d[i * 4 + 3] < 128) continue;
      var r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      var bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      counts[bin]++;
      sums[bin * 3] += r; sums[bin * 3 + 1] += g; sums[bin * 3 + 2] += b;
    }
    var bins = [];
    for (bin = 0; bin < 32768; bin++) {
      if (!counts[bin]) continue;
      var c = counts[bin];
      bins.push([sums[bin * 3] / c, sums[bin * 3 + 1] / c, sums[bin * 3 + 2] / c, c]);
    }
    var palette = bins.length ? medianCut(bins, slots) : [[0, 0, 0]];
    var transparent = -1;
    if (hasAlpha) { palette.unshift([0, 0, 0]); transparent = 0; }
    var cache = new Int16Array(32768).fill(-1);
    var idx = new Uint8Array(n);
    for (i = 0; i < n; i++) {
      if (d[i * 4 + 3] < 128) { idx[i] = 0; continue; }
      var rr = d[i * 4], gg = d[i * 4 + 1], bb = d[i * 4 + 2];
      var key = ((rr >> 3) << 10) | ((gg >> 3) << 5) | (bb >> 3);
      var hit = cache[key];
      if (hit < 0) {
        var bestD = Infinity, bestI = transparent >= 0 ? 1 : 0;
        for (var p = transparent >= 0 ? 1 : 0; p < palette.length; p++) {
          var dr = rr - palette[p][0], dg = gg - palette[p][1], db = bb - palette[p][2];
          var dist = dr * dr + dg * dg + db * db;
          if (dist < bestD) { bestD = dist; bestI = p; }
        }
        hit = bestI; cache[key] = hit;
      }
      idx[i] = hit;
    }
    return { palette: palette, indices: idx, transparent: transparent };
  }
  /* GIF LZW (variable code width, 12-bit ceiling, clear on table full). */
  function lzw(indices, minCodeSize) {
    var out = [], cur = 0, curShift = 0;
    var clearCode = 1 << minCodeSize, eoiCode = clearCode + 1;
    var codeSize = minCodeSize + 1, next = eoiCode + 1;
    var table = new Map();
    function emit(code) {
      cur |= code << curShift; curShift += codeSize;
      while (curShift >= 8) { out.push(cur & 0xFF); cur >>= 8; curShift -= 8; }
    }
    emit(clearCode);
    var prefix = indices[0];
    for (var i = 1; i < indices.length; i++) {
      var k = indices[i], key = (prefix << 8) | k, hit = table.get(key);
      if (hit !== undefined) { prefix = hit; continue; }
      emit(prefix);
      if (next === 4096) {
        emit(clearCode);
        table.clear(); next = eoiCode + 1; codeSize = minCodeSize + 1;
      } else {
        if (next >= (1 << codeSize)) codeSize++;
        table.set(key, next++);
      }
      prefix = k;
    }
    emit(prefix);
    emit(eoiCode);
    if (curShift > 0) out.push(cur & 0xFF);
    return out;
  }
  function gifBytes(im, opts) {
    opts = opts || {};
    var w = im.width, hh = im.height;
    var q = quantize(im, clampInt(opts.colors, 2, 256, 256));
    var pal = q.palette;
    var bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, pal.length))));   // 1..8
    var gctSize = 1 << bits;
    var bytes = [];
    function b(x) { bytes.push(x & 0xFF); }
    function b16(x) { b(x); b(x >> 8); }
    'GIF89a'.split('').forEach(function (ch) { b(ch.charCodeAt(0)); });
    b16(w); b16(hh);
    b(0x80 | ((bits - 1) << 4) | (bits - 1));      // GCT present, colour resolution, GCT size
    b(0); b(0);                                     // background index, pixel aspect ratio
    for (var i = 0; i < gctSize; i++) {
      var c = pal[i] || [0, 0, 0];
      b(c[0]); b(c[1]); b(c[2]);
    }
    if (q.transparent >= 0) {                       // graphic control ext: one transparent index
      b(0x21); b(0xF9); b(4); b(0x01); b16(0); b(q.transparent); b(0);
    }
    b(0x2C); b16(0); b16(0); b16(w); b16(hh); b(0); // image descriptor, no local table
    var minCode = Math.max(2, bits);
    b(minCode);
    var data = lzw(q.indices, minCode);
    for (var o = 0; o < data.length; o += 255) {    // LZW stream in <=255-byte sub-blocks
      var chunk = data.slice(o, o + 255);
      b(chunk.length);
      for (var j = 0; j < chunk.length; j++) b(chunk[j]);
    }
    b(0);                                           // block terminator
    b(0x3B);                                        // trailer
    return new Uint8Array(bytes);
  }
  function encodeGif(canvas, opts) {
    return new Blob([gifBytes(pixels(canvas), opts)], { type: 'image/gif' });
  }

  /* ---- one dispatcher for every output format the converter offers ---- */
  var EXT = { png: 'png', jpeg: 'jpg', webp: 'webp', bmp: 'bmp', ico: 'ico', gif: 'gif', tiff: 'tif' };
  async function encodeAs(canvas, fmt, q, opts) {
    opts = opts || {};
    var blob;
    if (fmt === 'bmp') blob = encodeBmp(canvas);
    else if (fmt === 'tiff') blob = encodeTiff(canvas);
    else if (fmt === 'gif') blob = encodeGif(canvas, opts);
    else if (fmt === 'ico') blob = await encodeIco(canvas, opts.icoSizes);
    else blob = await encode(canvas, 'image/' + fmt, q);
    if (!blob) throw new Error('encode');
    return { blob: blob, ext: EXT[fmt] || fmt };
  }

  /* ---- minimal ZIP writer (store or deflate-raw via CompressionStream) ----
   * files: [{ name, blob }]. Returns a Blob (application/zip). No compression
   * library — uses the browser's native deflate. Local files stay local. */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  async function deflateRaw(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    var cs = new CompressionStream('deflate-raw');
    var stream = new Blob([u8]).stream().pipeThrough(cs);
    var buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }
  async function zipWrite(files) {
    var enc = new TextEncoder();
    var chunks = [], central = [], offset = 0;
    function u16(n) { return new Uint8Array([n & 255, (n >>> 8) & 255]); }
    function u32(n) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }
    function push(list, arr) { list.push(arr); return arr.length; }

    for (var i = 0; i < files.length; i++) {
      var nameBytes = enc.encode(files[i].name);
      var raw = new Uint8Array(await files[i].blob.arrayBuffer());
      var crc = crc32(raw);
      var comp = await deflateRaw(raw);
      var method = 0, data = raw;
      if (comp && comp.length < raw.length) { method = 8; data = comp; }
      var local = 0;
      local += push(chunks, u32(0x04034b50));
      local += push(chunks, u16(20));               // version needed
      local += push(chunks, u16(0x0800));           // flags: bit 11 = UTF-8 filename
      local += push(chunks, u16(method));
      local += push(chunks, u16(0));                // mod time
      local += push(chunks, u16(0x21));             // mod date (1980-01-01)
      local += push(chunks, u32(crc));
      local += push(chunks, u32(data.length));      // compressed size
      local += push(chunks, u32(raw.length));       // uncompressed size
      local += push(chunks, u16(nameBytes.length));
      local += push(chunks, u16(0));                // extra len
      local += push(chunks, nameBytes);
      local += push(chunks, data);

      var cen = [];
      push(cen, u32(0x02014b50));
      push(cen, u16(20)); push(cen, u16(20)); push(cen, u16(0x0800));
      push(cen, u16(method)); push(cen, u16(0)); push(cen, u16(0x21));
      push(cen, u32(crc)); push(cen, u32(data.length)); push(cen, u32(raw.length));
      push(cen, u16(nameBytes.length)); push(cen, u16(0)); push(cen, u16(0));
      push(cen, u16(0)); push(cen, u16(0)); push(cen, u32(0));
      push(cen, u32(offset));
      push(cen, nameBytes);
      central.push({ parts: cen });
      offset += local;
    }

    var centralStart = offset, centralParts = [], centralSize = 0;
    central.forEach(function (c) { c.parts.forEach(function (p) { centralParts.push(p); centralSize += p.length; }); });
    var end = [];
    push(end, u32(0x06054b50)); push(end, u16(0)); push(end, u16(0));
    push(end, u16(files.length)); push(end, u16(files.length));
    push(end, u32(centralSize)); push(end, u32(centralStart)); push(end, u16(0));

    return new Blob(chunks.concat(centralParts, end), { type: 'application/zip' });
  }

  /* ---- minimal ZIP reader (the mirror of zipWrite) ----
   * docx / pptx / xlsx are all ZIPs of XML, so this is what lets the Office tools
   * read a file without shipping a library. Inflates with the browser's native
   * DecompressionStream. Returns { name: Uint8Array }.
   *
   * A .docx is an UNTRUSTED archive. Three guards, all deliberate:
   *   - ZIP BOMB: a 1MB file can inflate to gigabytes. Total inflated bytes and the
   *     entry count are both capped, and we stop the moment either is crossed.
   *   - PATH TRAVERSAL: entry names are keys in a plain object here (we never write
   *     to disk), but `..`, absolute paths and backslashes are still refused — the
   *     next caller might not be so careful.
   *   - The central directory is the source of truth (not the local headers), which
   *     is what every real unzipper does. */
  var ZIP_MAX_ENTRIES = 5000;
  var ZIP_MAX_TOTAL = 200 * 1024 * 1024;
  /* ⚠️ الحجم المُعلَن في الفهرس المركزي **ادّعاء المُرسِل** لا قياساً: أرشيف يكتب `rawSize`
   * صغيراً يمرّ من سقف الانتفاخ ثمّ يفكّ ضغطه إلى جيجابايتات. فالميزانية تُقاس على البايتات
   * التي **يُنتجها** فكّ الضغط فعلاً، والبثّ يُقطع **في منتصفه** لحظة تجاوزها — لا بعد اكتمال
   * المخزن المؤقّت، وإلّا التهم المدخل الواحد الذاكرة قبل أن نصل إلى فحصه. */
  async function inflateRaw(u8, budget) {
    if (typeof DecompressionStream === 'undefined') throw new Error('inflate-unsupported');
    if (budget === undefined) budget = ZIP_MAX_TOTAL;
    var ds = new DecompressionStream('deflate-raw');
    var rd = new Blob([u8]).stream().pipeThrough(ds).getReader();
    var parts = [], got = 0, r;
    for (;;) {
      r = await rd.read();
      if (r.done) break;
      got += r.value.length;
      if (got > budget) { rd.cancel().catch(function () {}); throw new Error('zip-too-big'); }
      parts.push(r.value);
    }
    var res = new Uint8Array(got), at = 0;
    for (var i = 0; i < parts.length; i++) { res.set(parts[i], at); at += parts[i].length; }
    return res;
  }
  function safeEntryName(name) {
    if (!name || name.length > 512) return null;
    if (name.indexOf('\\') >= 0) return null;
    if (name.charAt(0) === '/') return null;
    var parts = name.split('/');
    for (var i = 0; i < parts.length; i++) if (parts[i] === '..') return null;
    return name;
  }
  async function zipRead(input) {
    var buf = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
    var b = new Uint8Array(buf), dv = new DataView(buf);
    /* End of central directory: scan back from the tail (the comment can follow it) */
    var eocd = -1, min = Math.max(0, b.length - 66000);
    for (var i = b.length - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not-a-zip');
    var count = dv.getUint16(eocd + 10, true);
    var cdOff = dv.getUint32(eocd + 16, true);
    if (count > ZIP_MAX_ENTRIES) throw new Error('too-many-entries');

    /* `total` هو المُعلَن و`real` هو المُنتَج. الأوّل بوّابة أولى رخيصة تردّ الأرشيف الصادق
     * الضخم بلا فكّ ضغط أصلاً، والثاني هو السقف الحقيقي لأن المُعلَن يكذب (انظر `inflateRaw`). */
    var out = Object.create(null), total = 0, real = 0, p = cdOff;
    for (var n = 0; n < count; n++) {
      if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var compSize = dv.getUint32(p + 20, true);
      var rawSize = dv.getUint32(p + 24, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var cmtLen = dv.getUint16(p + 32, true);
      var localOff = dv.getUint32(p + 42, true);
      var name = new TextDecoder('utf-8').decode(b.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + cmtLen;

      var safe = safeEntryName(name);
      if (!safe || safe.charAt(safe.length - 1) === '/') continue;      /* skip dirs + refused names */
      total += rawSize;
      if (total > ZIP_MAX_TOTAL) throw new Error('zip-too-big');

      /* the local header's own name/extra lengths decide where the data starts */
      if (localOff + 30 > b.length || dv.getUint32(localOff, true) !== 0x04034b50) continue;
      var lNameLen = dv.getUint16(localOff + 26, true);
      var lExtraLen = dv.getUint16(localOff + 28, true);
      var start = localOff + 30 + lNameLen + lExtraLen;
      var data = b.subarray(start, start + compSize);
      if (method === 0) {
        real += data.length;
        if (real > ZIP_MAX_TOTAL) throw new Error('zip-too-big');
        out[safe] = data.slice();
      } else if (method === 8) {
        var inf = await inflateRaw(data, ZIP_MAX_TOTAL - real);   /* ما بقي من الميزانية، لا السقف كاملاً */
        real += inf.length;
        out[safe] = inf;
      }
      /* any other method (bzip2, lzma…) is simply absent — Office never emits them */
    }
    return out;
  }

  SYFS.imgkit = {
    MIN_DIM: MIN_DIM,
    MAX_SIDE: MAX_SIDE,
    MAX_AREA: MAX_AREA,
    ICO_SIZES: ICO_SIZES,
    clampInt: clampInt,
    fitCanvas: fitCanvas,
    decode: decode,
    decodeAny: decodeAny,
    release: release,
    svgSize: svgSize,
    undecodableReason: undecodableReason,
    resize: resize,
    encode: encode,
    encodeAs: encodeAs,
    encodeBmp: encodeBmp,
    encodeIco: encodeIco,
    encodeGif: encodeGif,
    encodeTiff: encodeTiff,
    bmpBytes: bmpBytes,
    tiffBytes: tiffBytes,
    gifBytes: gifBytes,
    quantize: quantize,
    lzw: lzw,
    encodeToTarget: encodeToTarget,
    zipWrite: zipWrite,
    zipRead: zipRead,
    safeEntryName: safeEntryName
  };
})();
