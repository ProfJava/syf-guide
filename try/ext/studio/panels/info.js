/* SYF Studio Lab — «معلومات» + QR:
 *   exif    · بيانات الصورة   — what the file carries (GPS first), and a clean copy without it
 *   palette · لوحة الألوان    — the dominant colours of an image, copyable as HEX/RGB/CSS
 *   qrread  · قارئ QR         — jsQR on an image, a paste or a screenshot
 *   qrgen   · صانع QR         — link / Wi-Fi / contact / text, colours, rounded dots, logo
 * The EXIF reader is the extension's own (src/tools3.js), lifted as-is. */
(function () {
  'use strict';
  var SL = window.SL, I = SL.icon;
  function pad(n) { return String(n).padStart(2, '0'); }

  /* ---------------- EXIF ---------------- */
  var EXIF_TAGS = {
    0x010F: 'الشركة المصنّعة', 0x0110: 'الجهاز', 0x0131: 'البرنامج', 0x0132: 'تاريخ التعديل', 0x013B: 'المصوّر', 0x8298: 'حقوق النشر',
    0x0112: 'الاتجاه', 0x9003: 'تاريخ الالتقاط', 0x9004: 'تاريخ الترقيم', 0xA002: 'عرض الصورة', 0xA003: 'ارتفاع الصورة', 0x829A: 'زمن التعريض',
    0x829D: 'فتحة العدسة', 0x8827: 'ISO', 0x920A: 'البعد البؤري', 0xA405: 'البعد البؤري (35مم)', 0x9209: 'الفلاش', 0xA433: 'صانع العدسة', 0xA434: 'العدسة'
  };
  var EXIF_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  function exifFind(buf) {
    var b = new Uint8Array(buf), dv = new DataView(buf);
    if (b[0] === 0xFF && b[1] === 0xD8) {
      var p = 2;
      while (p + 4 < b.length && b[p] === 0xFF) {
        var marker = b[p + 1], len = dv.getUint16(p + 2);
        if (marker === 0xE1 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) return p + 10;
        if (marker === 0xDA) break;
        p += 2 + len;
      }
      return -1;
    }
    if (b[0] === 0x89 && b[1] === 0x50) {
      var q = 8;
      while (q + 8 < b.length) {
        var clen = dv.getUint32(q), type = String.fromCharCode(b[q + 4], b[q + 5], b[q + 6], b[q + 7]);
        if (type === 'eXIf') return q + 8;
        if (type === 'IEND') break;
        q += 12 + clen;
      }
      return -1;
    }
    if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
      var r = 12;
      while (r + 8 < b.length) {
        var t4 = String.fromCharCode(b[r], b[r + 1], b[r + 2], b[r + 3]), sz = dv.getUint32(r + 4, true);
        if (t4 === 'EXIF') return (b[r + 8] === 0x45 && b[r + 9] === 0x78) ? r + 14 : r + 8;
        r += 8 + sz + (sz & 1);
      }
    }
    return -1;
  }
  function exifParse(buf) {
    var res = { tags: [], gps: null, found: false };
    var tiff = exifFind(buf);
    if (tiff < 0 || tiff + 8 > buf.byteLength) return res;
    var dv = new DataView(buf), le = dv.getUint16(tiff) === 0x4949;
    if (dv.getUint16(tiff + 2, le) !== 42) return res;
    res.found = true;
    var raw = {}, gps = {};
    function str(off, n) { var s = ''; for (var i = 0; i < n; i++) { var c = dv.getUint8(off + i); if (!c) break; s += String.fromCharCode(c); } return s; }
    function readIfd(off, into, depth) {
      if (depth > 3 || off + 2 > buf.byteLength) return;
      var n = dv.getUint16(off, le);
      if (n > 500) return;
      for (var i = 0; i < n; i++) {
        var e = off + 2 + i * 12; if (e + 12 > buf.byteLength) break;
        var tag = dv.getUint16(e, le), type = dv.getUint16(e + 2, le), cnt = dv.getUint32(e + 4, le);
        var sz = (EXIF_SIZE[type] || 1) * cnt, vp = sz > 4 ? tiff + dv.getUint32(e + 8, le) : e + 8;
        if (vp + sz > buf.byteLength || cnt > 4096) continue;
        var v;
        if (type === 2) v = str(vp, cnt);
        else if (type === 3) { v = []; for (var k = 0; k < cnt; k++) v.push(dv.getUint16(vp + k * 2, le)); }
        else if (type === 4) { v = []; for (var k2 = 0; k2 < cnt; k2++) v.push(dv.getUint32(vp + k2 * 4, le)); }
        else if (type === 5 || type === 10) { v = []; for (var k3 = 0; k3 < cnt; k3++) { var a = type === 5 ? dv.getUint32(vp + k3 * 8, le) : dv.getInt32(vp + k3 * 8, le), bb = type === 5 ? dv.getUint32(vp + k3 * 8 + 4, le) : dv.getInt32(vp + k3 * 8 + 4, le); v.push(bb ? a / bb : 0); } }
        else continue;
        if (tag === 0x8769 && type === 4) { readIfd(tiff + v[0], raw, depth + 1); continue; }
        if (tag === 0x8825 && type === 4) { readIfd(tiff + v[0], gps, depth + 1); continue; }
        into[tag] = v;
      }
    }
    readIfd(tiff + dv.getUint32(tiff + 4, le), raw, 0);
    function fmt(tag, v) {
      if (typeof v === 'string') return v.trim();
      if (tag === 0x829A) return v[0] > 0 && v[0] < 1 ? '1/' + Math.round(1 / v[0]) + ' s' : v[0] + ' s';
      if (tag === 0x829D) return 'f/' + (Math.round(v[0] * 10) / 10);
      if (tag === 0x920A || tag === 0xA405) return (Math.round(v[0] * 10) / 10) + ' mm';
      if (tag === 0x9209) return (v[0] & 1) ? SL.t('أُطلق الفلاش') : SL.t('بلا فلاش');
      return v.map(function (x) { return Math.round(x * 1000) / 1000; }).join(', ');
    }
    Object.keys(raw).forEach(function (k) { k = +k; if (EXIF_TAGS[k]) res.tags.push({ tag: k, name: SL.t(EXIF_TAGS[k]), value: fmt(k, raw[k]) }); });
    function dms(v, ref) { if (!v || v.length < 3) return null; var x = v[0] + v[1] / 60 + v[2] / 3600; return (ref === 'S' || ref === 'W') ? -x : x; }
    var lat = dms(gps[0x0002], gps[0x0001]), lon = dms(gps[0x0004], gps[0x0003]);
    if (lat !== null && lon !== null) res.gps = { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, alt: gps[0x0006] ? Math.round(gps[0x0006][0]) : null };
    return res;
  }

  function exifTool(body) {
    var grid = SL.h('<div class="grid2"><div class="stack" data-l></div><div class="stack" data-r></div></div>'); body.appendChild(grid);
    var L = grid.querySelector('[data-l]'), R = grid.querySelector('[data-r]'), file = null;
    L.appendChild(SL.dropzone({ title: 'اسحب صورة من الكاميرا أو الجوّال', hint: 'JPEG · PNG · WebP — نعرض ما تحمله من بيانات مخفية', icon: 'exif', onFiles: function (fs) { show(fs[0]); } }));
    var card = SL.h('<div class="card" hidden><h3>' + I('info', 's') + '<span data-t></span></h3><div data-gps></div><table class="kv"><tbody></tbody></table></div>'); L.appendChild(card);
    var side = SL.h('<div class="card stack"><h3>' + I('shield', 's') + 'الخصوصية</h3><div class="note">الصورة الملتقطة بالجوّال تحمل غالباً موقعك ونوع جهازك ووقت الالتقاط. «نسخة نظيفة» تعيد ترميز الصورة فتسقط كل هذه البيانات قبل أن تشاركها.</div></div>');
    var clean = SL.button('تنزيل نسخة نظيفة', 'shield', 'pri block', function () {
      if (!file) return;
      SL.fileToCanvas(file).then(function (c) { var t = /png/.test(file.type) ? 'image/png' : 'image/jpeg'; return SL.toBlob(c, t, .95).then(function (b) { SL.download(b, SL.base(file.name) + '-clean.' + (t === 'image/png' ? 'png' : 'jpg')); SL.toast(SL.t('حُفظت نسخة بلا بيانات · {0}', SL.fmtBytes(b.size)), 'check'); }); });
    });
    var copy = SL.button('نسخ البيانات', 'copy', 'block', function () { navigator.clipboard.writeText(lastText).then(function () { SL.toast('نُسخت', 'check'); }); });
    side.appendChild(clean); side.appendChild(copy); R.appendChild(side);
    var lastText = '';
    function show(f) {
      file = f; card.hidden = false;
      f.arrayBuffer().then(function (buf) {
        var r = exifParse(buf), tb = card.querySelector('tbody'), gp = card.querySelector('[data-gps]'); tb.textContent = ''; gp.textContent = '';
        card.querySelector('[data-t]').textContent = r.found ? SL.t('{0} · {1} · {2} وسماً', f.name, SL.fmtBytes(f.size), r.tags.length) : SL.t('{0} · {1} · لا بيانات EXIF', f.name, SL.fmtBytes(f.size));
        var lines = [];
        if (r.gps) {
          var w = SL.h('<div class="saving bad" style="margin-bottom:10px"><span>' + I('pin', 's') + ' الصورة تحمل موقعاً جغرافياً</span><b class="num"></b></div>');
          w.querySelector('b').textContent = r.gps.lat + ', ' + r.gps.lon + (r.gps.alt !== null ? ' · ' + r.gps.alt + ' m' : '');
          gp.appendChild(w); lines.push('GPS: ' + r.gps.lat + ', ' + r.gps.lon);
        }
        if (!r.found) tb.appendChild(SL.h('<tr><td colspan="2">لا توجد بيانات مخفية في هذه الصورة ✓</td></tr>'));
        r.tags.forEach(function (t) { var tr = SL.h('<tr><td></td><td></td></tr>'); /* i18n-dyn: translated when the parser builds the row (EXIF_TAGS → SL.t) */
          tr.children[0].textContent = t.name; tr.children[1].textContent = t.value; tb.appendChild(tr); lines.push(t.name + ': ' + t.value); });
        lastText = lines.join('\n');
      });
    }
  }

  /* ---------------- palette (median cut) ---------------- */
  function palette(canvas, n) {
    var k = Math.min(1, 160 / Math.max(canvas.width, canvas.height)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(canvas.width * k)); c.height = Math.max(1, Math.round(canvas.height * k));
    var g = c.getContext('2d'); g.drawImage(canvas, 0, 0, c.width, c.height);
    var d = g.getImageData(0, 0, c.width, c.height).data, px = [];
    for (var i = 0; i < d.length; i += 4) if (d[i + 3] > 128) px.push([d[i], d[i + 1], d[i + 2]]);
    var boxes = [px];
    while (boxes.length < n) {
      boxes.sort(function (a, b) { return b.length - a.length; });
      var b = boxes.shift(); if (!b || b.length < 2) { if (b) boxes.push(b); break; }
      var rng = [0, 1, 2].map(function (ch) { var mn = 255, mx = 0; b.forEach(function (p) { if (p[ch] < mn) mn = p[ch]; if (p[ch] > mx) mx = p[ch]; }); return mx - mn; });
      var ch = rng.indexOf(Math.max.apply(null, rng));
      b.sort(function (x, y) { return x[ch] - y[ch]; });
      boxes.push(b.slice(0, b.length >> 1), b.slice(b.length >> 1));
    }
    /* box averages → merge colours closer than ~6% → share of the image = pixels whose
       NEAREST colour it is (a median cut splits by count, so its boxes are all equal) */
    var cols = [];
    boxes.filter(function (b) { return b.length; }).forEach(function (b) {
      var s = [0, 0, 0]; b.forEach(function (p) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; });
      var rgb = s.map(function (v) { return Math.round(v / b.length); });
      if (!cols.some(function (c) { return dist(c.rgb, rgb) < 26 * 26 * 3; })) cols.push({ rgb: rgb, n: 0 });
    });
    px.forEach(function (p) { var best = 0, bd = Infinity; for (var i = 0; i < cols.length; i++) { var d2 = dist(cols[i].rgb, p); if (d2 < bd) { bd = d2; best = i; } } cols[best].n++; });
    return cols.filter(function (c) { return c.n; }).sort(function (a, b) { return b.n - a.n; });
  }
  function dist(a, b) { var r = a[0] - b[0], g = a[1] - b[1], bl = a[2] - b[2]; return r * r * 2 + g * g * 4 + bl * bl * 3;
  }
  function hex(rgb) { return '#' + rgb.map(function (v) { return v.toString(16).padStart(2, '0'); }).join(''); }
  function paletteTool(body) {
    var n = SL.LS.get('pal_n', 8), src = null;
    var grid = SL.h('<div class="grid2"><div class="stack" data-l></div><div class="card stack" data-r></div></div>'); body.appendChild(grid);
    var L = grid.querySelector('[data-l]'), R = grid.querySelector('[data-r]');
    L.appendChild(SL.dropzone({ title: 'اسحب صورة لاستخراج ألوانها', hint: 'الألوان الغالبة مرتّبة حسب حضورها', icon: 'palette', onFiles: function (fs) { SL.fileToCanvas(fs[0]).then(set); } }));
    var pv = SL.h('<div class="preview checker" hidden><canvas></canvas></div>'); L.appendChild(pv);
    var sw = SL.h('<div class="swatches"></div>');
    R.appendChild(SL.h('<h3>' + I('palette', 's') + 'الألوان</h3>'));
    R.appendChild(SL.seg([5, 8, 12, 16].map(function (k) { return [k, k.toLocaleString(SL.locale())]; }), n, function (v) { n = Number(v); SL.LS.set('pal_n', n); paint(); }));
    R.appendChild(sw);
    R.appendChild(SL.button('نسخ كمتغيّرات CSS', 'copy', 'block', function () { navigator.clipboard.writeText(last.map(function (c, i) { return '--color-' + (i + 1) + ': ' + hex(c.rgb) + ';'; }).join('\n')).then(function () { SL.toast('نُسخت', 'check'); }); }));
    R.appendChild(SL.button('تنزيل لوحة PNG', 'download', 'block', function () {
      var c = document.createElement('canvas'); c.width = last.length * 160; c.height = 220; var g = c.getContext('2d');
      last.forEach(function (p, i) { g.fillStyle = hex(p.rgb); g.fillRect(i * 160, 0, 160, 170); g.fillStyle = '#fff'; g.fillRect(i * 160, 170, 160, 50); g.fillStyle = '#111'; g.font = '600 20px ui-monospace, monospace'; g.fillText(hex(p.rgb), i * 160 + 18, 202); });
      SL.toBlob(c).then(function (b) { SL.download(b, 'palette-' + SL.stamp() + '.png'); });
    }));
    var last = [];
    function set(c) { src = c; pv.hidden = false; var v = pv.querySelector('canvas'); v.width = c.width; v.height = c.height; v.getContext('2d').drawImage(c, 0, 0); paint(); }
    function paint() {
      sw.textContent = ''; if (!src) { sw.appendChild(SL.h('<div class="note">أضف صورة.</div>')); return; }
      last = palette(src, n);
      var tot = last.reduce(function (a, p) { return a + p.n; }, 0);
      last.forEach(function (p) {
        var h = hex(p.rgb), b = SL.h('<button type="button" class="swatch"><i></i><span class="num"></span></button>');
        b.querySelector('i').style.background = h; b.querySelector('span').textContent = h + ' · ' + Math.round(p.n / tot * 100) + '%';
        b.addEventListener('click', function () { navigator.clipboard.writeText(h).then(function () { SL.toast(SL.t('نُسخ {0}', h), 'check'); }); });
        sw.appendChild(b);
      });
    }
    if (SL.doc()) set(SL.doc().canvas); else paint();
    return SL.onDoc(function (d) { set(d.canvas); });
  }

  /* ---------------- QR read ---------------- */
  function qrReadTool(body) {
    var grid = SL.h('<div class="grid2"><div class="stack" data-l></div><div class="card stack" data-r></div></div>'); body.appendChild(grid);
    var L = grid.querySelector('[data-l]'), R = grid.querySelector('[data-r]');
    L.appendChild(SL.dropzone({ title: 'اسحب صورة فيها رمز QR', hint: 'أو الصق لقطة شاشة بـ Ctrl+V', icon: 'scan', onFiles: function (fs) { SL.fileToCanvas(fs[0]).then(read); } }));
    var pv = SL.h('<div class="preview checker" hidden><canvas></canvas></div>'); L.appendChild(pv);
    R.appendChild(SL.h('<h3>' + I('qr', 's') + 'النتيجة</h3>'));
    var out = SL.h('<textarea class="in" rows="5" readonly placeholder="محتوى الرمز…"></textarea>'); R.appendChild(out);
    var acts = SL.h('<div class="row"></div>'); R.appendChild(acts);
    var note = SL.h('<div class="note"></div>'); R.appendChild(note);
    function read(c) {
      pv.hidden = false; var v = pv.querySelector('canvas'); v.width = c.width; v.height = c.height; var g = v.getContext('2d'); g.drawImage(c, 0, 0);
      var res = null, scales = [1, 0.5, 2];
      for (var i = 0; i < scales.length && !res; i++) {
        var w = Math.round(c.width * scales[i]), h = Math.round(c.height * scales[i]); if (w * h > 16e6 || w < 40) continue;
        var t = document.createElement('canvas'); t.width = w; t.height = h; t.getContext('2d').drawImage(c, 0, 0, w, h);
        res = window.jsQR(t.getContext('2d').getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
        if (res) { var k = 1 / scales[i], q = res.location; g.strokeStyle = '#22c55e'; g.lineWidth = Math.max(3, c.width / 200); g.beginPath();
          [q.topLeftCorner, q.topRightCorner, q.bottomRightCorner, q.bottomLeftCorner].forEach(function (p, j) { if (j) g.lineTo(p.x * k, p.y * k); else g.moveTo(p.x * k, p.y * k); }); g.closePath(); g.stroke(); }
      }
      acts.textContent = '';
      if (!res) { out.value = ''; note.textContent = SL.t('لم يُعثر على رمز — جرّب صورة أوضح أو أقرب.'); return; }
      out.value = res.data; note.textContent = SL.t('تمّت القراءة ✓');
      acts.appendChild(SL.button('نسخ', 'copy', 'sm', function () { navigator.clipboard.writeText(res.data).then(function () { SL.toast('نُسخ', 'check'); }); }));
      if (/^https?:\/\//i.test(res.data)) {
        acts.appendChild(SL.button('فتح الرابط', 'link', 'sm', function () { window.open(res.data, '_blank', 'noopener,noreferrer'); }));
        note.textContent = SL.t('رابط: تحقّق من العنوان قبل فتحه.');
      }
      if (/^WIFI:/i.test(res.data)) { var m = /S:([^;]*)/.exec(res.data), p = /P:([^;]*)/.exec(res.data); note.textContent = p ? SL.t('شبكة واي فاي: {0} · كلمة المرور: {1}', m ? m[1] : '', p[1]) : SL.t('شبكة واي فاي: {0}', m ? m[1] : ''); }
    }
    if (SL.doc()) read(SL.doc().canvas);
    return SL.onDoc(function (d) { read(d.canvas); });
  }

  /* ---------------- QR make ---------------- */
  function qrMakeTool(body) {
    var o = Object.assign({ kind: 'url', url: 'https://', ssid: '', pass: '', sec: 'WPA', name: '', phone: '', email: '', text: '', fg: '#111827', bg: '#ffffff', dots: 'square', size: 1024, logo: false }, SL.LS.get('qrg', {}));
    var save = function () { var c = Object.assign({}, o); delete c.pass; SL.LS.set('qrg', c); };
    var logo = null;
    var grid = SL.h('<div class="grid2"><div class="stack" data-l></div><div class="card stack" data-r></div></div>'); body.appendChild(grid);
    var L = grid.querySelector('[data-l]'), R = grid.querySelector('[data-r]');
    var pv = SL.h('<div class="preview checker" style="min-height:420px"><canvas style="max-width:min(100%,420px)"></canvas></div>'); L.appendChild(pv);
    var cv = pv.querySelector('canvas'), msg = SL.h('<div class="note"></div>'); L.appendChild(msg);
    R.appendChild(SL.h('<h3>' + I('qr', 's') + 'المحتوى</h3>'));
    R.appendChild(SL.seg([['url', 'رابط', 'link'], ['wifi', 'واي فاي', 'wifi'], ['contact', 'جهة اتصال', 'file'], ['text', 'نص', 'text']], o.kind, function (v) { o.kind = v; save(); form(); draw(); }));
    var fbox = SL.h('<div class="stack"></div>'); R.appendChild(fbox);
    R.appendChild(SL.h('<h3>' + I('palette', 's') + 'الشكل</h3>'));
    var cols = SL.h('<div class="row"><span class="note">الرمز</span><input type="color" data-k="fg"><span class="note">الخلفية</span><input type="color" data-k="bg"></div>');
    [].forEach.call(cols.querySelectorAll('input'), function (i) { i.value = o[i.dataset.k]; i.addEventListener('input', function () { o[i.dataset.k] = i.value; save(); draw(); }); });
    R.appendChild(cols);
    R.appendChild(SL.seg([['square', 'مربّعات'], ['round', 'نقاط'], ['soft', 'ناعمة']], o.dots, function (v) { o.dots = v; save(); draw(); }));
    R.appendChild(SL.button('شعار في الوسط', 'image', 'sm', function () { SL.pickFiles('image/*').then(function (f) { if (f[0]) SL.fileToCanvas(f[0]).then(function (c) { logo = c; draw(); }); }); }));
    R.appendChild(SL.seg([[512, '512'], [1024, '1024'], [2048, '2048']], o.size, function (v) { o.size = Number(v); save(); draw(); }));
    var dl = SL.h('<div class="row"></div>');
    dl.appendChild(SL.button('تنزيل PNG', 'download', 'pri', function () { SL.toBlob(cv).then(function (b) { SL.download(b, 'qr-' + SL.stamp() + '.png'); }); }));
    dl.appendChild(SL.button('نسخ', 'copy', '', function () { SL.copyCanvas(cv); }));
    dl.appendChild(SL.button('فتح في المحرر', 'editor', '', function () { SL.setDoc(SL.cloneCanvas(cv), 'qr.png'); SL.open('editor'); }));
    R.appendChild(dl);

    function inp(label, key, type, ph) {
      var f = SL.h('<div class="field"><label></label><input class="in"></div>'); f.querySelector('label').textContent = label;
      var i = f.querySelector('input'); i.type = type || 'text'; i.value = o[key] || ''; if (ph) i.placeholder = ph; if (type === 'url' || type === 'email' || type === 'tel') i.dir = 'ltr';
      i.addEventListener('input', function () { o[key] = i.value; save(); draw(); }); return f;
    }
    function form() {
      fbox.textContent = '';
      if (o.kind === 'url') fbox.appendChild(inp('الرابط', 'url', 'url', 'https://example.com'));
      else if (o.kind === 'wifi') { fbox.appendChild(inp('اسم الشبكة', 'ssid')); fbox.appendChild(inp('كلمة المرور', 'pass', 'password'));
        fbox.appendChild(SL.seg([['WPA', 'WPA/WPA2'], ['WEP', 'WEP'], ['nopass', 'مفتوحة']], o.sec, function (v) { o.sec = v; save(); draw(); })); }
      else if (o.kind === 'contact') { fbox.appendChild(inp('الاسم', 'name')); fbox.appendChild(inp('الجوّال', 'phone', 'tel')); fbox.appendChild(inp('البريد', 'email', 'email')); }
      else { var f = SL.h('<div class="field"><label>النص</label><textarea class="in" rows="4"></textarea></div>'); var t = f.querySelector('textarea'); t.value = o.text; t.addEventListener('input', function () { o.text = t.value; save(); draw(); }); fbox.appendChild(f); }
    }
    function esc(s) { return String(s || '').replace(/([\\;,:"])/g, '\\$1'); }
    function payload() {
      if (o.kind === 'url') return o.url;
      if (o.kind === 'wifi') return 'WIFI:T:' + o.sec + ';S:' + esc(o.ssid) + ';' + (o.sec === 'nopass' ? '' : 'P:' + esc(o.pass) + ';') + ';';
      if (o.kind === 'contact') return 'MECARD:N:' + esc(o.name) + ';TEL:' + esc(o.phone) + ';EMAIL:' + esc(o.email) + ';;';
      return o.text;
    }
    function draw() {
      var qr = SYFS.qr.generate(payload() || ' ');
      var g = cv.getContext('2d'); cv.width = cv.height = o.size;
      if (!qr) { g.fillStyle = o.bg; g.fillRect(0, 0, o.size, o.size); msg.textContent = SL.t('المحتوى أطول من {0} بايت — اختصره.', (122).toLocaleString(SL.locale())); return; }
      msg.textContent = SL.t('الإصدار {0} · {1} وحدة · تصحيح الأخطاء M', qr.version, SL.dims(qr.size, qr.size));
      var q = 4, cell = o.size / (qr.size + q * 2);
      g.fillStyle = o.bg; g.fillRect(0, 0, o.size, o.size); g.fillStyle = o.fg;
      function finder(r, c) { return (r < 7 && c < 7) || (r < 7 && c >= qr.size - 7) || (r >= qr.size - 7 && c < 7); }
      for (var r = 0; r < qr.size; r++) for (var c = 0; c < qr.size; c++) {
        if (!qr.modules[r][c] || finder(r, c)) continue;
        var x = (c + q) * cell, y = (r + q) * cell;
        if (o.dots === 'round') { g.beginPath(); g.arc(x + cell / 2, y + cell / 2, cell * 0.46, 0, 7); g.fill(); }
        else if (o.dots === 'soft') { g.beginPath(); if (g.roundRect) g.roundRect(x + .5, y + .5, cell - 1, cell - 1, cell * .3); else g.rect(x, y, cell, cell); g.fill(); }
        else g.fillRect(x, y, Math.ceil(cell), Math.ceil(cell));
      }
      [[0, 0], [0, qr.size - 7], [qr.size - 7, 0]].forEach(function (f) {
        var x = (f[1] + q) * cell, y = (f[0] + q) * cell, R2 = o.dots === 'square' ? 0 : cell * 1.6;
        g.beginPath(); rr(g, x, y, cell * 7, cell * 7, R2); rr(g, x + cell, y + cell, cell * 5, cell * 5, Math.max(0, R2 - cell * .6)); g.fill('evenodd');
        g.beginPath(); rr(g, x + cell * 2, y + cell * 2, cell * 3, cell * 3, R2 ? cell : 0); g.fill();
      });
      if (logo) {
        var lw = o.size * 0.2, lh = lw * logo.height / logo.width, lx = (o.size - lw) / 2, ly = (o.size - lh) / 2, pd = cell * .8;
        g.fillStyle = o.bg; g.beginPath(); rr(g, lx - pd, ly - pd, lw + pd * 2, lh + pd * 2, cell); g.fill(); g.drawImage(logo, lx, ly, lw, lh);
      }
    }
    function rr(g, x, y, w, h, r) { if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
    form(); draw();
  }

  SL.tools.push(
    { id: 'qrgen', group: 'make', label: 'صانع QR', icon: 'qr', desc: 'رابط · واي فاي · جهة اتصال · نص — بألوانك ونقاط مستديرة وشعار في الوسط.', mount: qrMakeTool },
    { id: 'qrread', group: 'info', label: 'قارئ QR', icon: 'scan', desc: 'اقرأ رمز QR من صورة أو لقطة شاشة.', mount: qrReadTool },
    { id: 'exif', group: 'info', label: 'بيانات الصورة', icon: 'exif', desc: 'الموقع والجهاز ووقت الالتقاط المخفية في الصورة — ونسخة نظيفة منها.', mount: exifTool },
    { id: 'palette', group: 'info', label: 'لوحة الألوان', icon: 'palette', desc: 'الألوان الغالبة في أي صورة، جاهزة للنسخ.', mount: paletteTool }
  );
}());
