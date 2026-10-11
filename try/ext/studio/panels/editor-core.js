/* SYF Studio Lab — editor engine (no UI). A document of layers composited onto one canvas.
 *
 * Layer kinds
 *   raster — owns a canvas the size of the document; painted by brush/eraser/fill/gradient,
 *            moved by an (x, y) offset so a move never resamples pixels.
 *   text   — { text, font, size, color, weight, italic, align, lineH, x, y } drawn on composite:
 *            stays editable until rasterised.
 *   shape  — { kind: rect|ellipse|line|arrow, x1, y1, x2, y2, fill, stroke, sw, radius }.
 * Every layer: { id, name, kind, visible, opacity (0–1), blend, locked }.
 *
 * History: a snapshot AFTER each committed change (and one at load) — the last entry IS the
 * current state, so undo restores entry n-1. Raster canvases are cloned per snapshot, which
 * is why the depth is capped. */
(function () {
  'use strict';
  var SL = window.SL;

  var BLENDS = [
    ['source-over', 'عادي'], ['multiply', 'ضرب'], ['screen', 'شاشة'], ['overlay', 'تراكب'],
    ['darken', 'تغميق'], ['lighten', 'تفتيح'], ['color-dodge', 'مراوغة لونية'], ['color-burn', 'حرق لوني'],
    ['hard-light', 'ضوء قاسٍ'], ['soft-light', 'ضوء ناعم'], ['difference', 'فرق'], ['exclusion', 'استبعاد'],
    ['hue', 'تدرّج اللون'], ['saturation', 'تشبّع'], ['color', 'لون'], ['luminosity', 'سطوع']
  ];
  var MAX_HISTORY = 40, MAX_DIM = 8000;
  var uid = 1;

  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }
  function clone(c) { var n = mkCanvas(c.width, c.height); n.getContext('2d').drawImage(c, 0, 0); return n; }

  function Doc(w, h, fill) {
    this.w = w; this.h = h; this.layers = []; this.active = null; this.sel = null;
    this.history = []; this.hIndex = -1; this.listeners = [];
    var bg = this.addRaster(SL.t('الخلفية'));
    if (fill) { var g = bg.canvas.getContext('2d'); g.fillStyle = fill; g.fillRect(0, 0, w, h); }
    this.view = mkCanvas(w, h);
  }
  var D = Doc.prototype;

  D.on = function (f) { this.listeners.push(f); };
  D.emit = function (what) { var self = this; this.listeners.forEach(function (f) { f(what, self); }); };

  /* ---------- layers ---------- */
  D.base = function (name, kind) {
    return { id: uid++, name: name, kind: kind, visible: true, opacity: 1, blend: 'source-over', locked: false, x: 0, y: 0 };
  };
  D.insert = function (L, above) {
    var i = this.layers.indexOf(above || this.active);
    if (i < 0) this.layers.push(L); else this.layers.splice(i + 1, 0, L);
    this.active = L; return L;
  };
  D.addRaster = function (name, canvas) {
    var L = this.base(name || SL.t('طبقة {0}', this.layers.length + 1), 'raster');
    L.canvas = canvas || mkCanvas(this.w, this.h);
    return this.insert(L);
  };
  D.addText = function (props) {
    var L = this.base(props.text.split('\n')[0].slice(0, 24) || SL.t('نص'), 'text');
    L.p = Object.assign({ text: SL.t('نص'), font: 'IBM Plex Sans Arabic, system-ui, sans-serif', size: 64, color: '#ffffff', weight: 700, italic: false, align: 'center', lineH: 1.25, x: this.w / 2, y: this.h / 2, stroke: '', strokeW: 0, shadow: false }, props);
    return this.insert(L);
  };
  D.addShape = function (props) {
    var names = { rect: 'مستطيل', ellipse: 'شكل بيضاوي', line: 'خط', arrow: 'سهم' };
    var L = this.base(SL.t(names[props.kind] || 'شكل'), 'shape');
    L.p = Object.assign({ kind: 'rect', x1: 0, y1: 0, x2: 100, y2: 100, fill: '#3b9eff', stroke: '', sw: 4, radius: 0 }, props);
    return this.insert(L);
  };
  D.remove = function (L) {
    if (this.layers.length <= 1) return false;
    var i = this.layers.indexOf(L); if (i < 0) return false;
    this.layers.splice(i, 1);
    this.active = this.layers[Math.max(0, i - 1)];
    return true;
  };
  D.move = function (L, dir) {
    var i = this.layers.indexOf(L), j = i + dir;
    if (i < 0 || j < 0 || j >= this.layers.length) return false;
    this.layers.splice(i, 1); this.layers.splice(j, 0, L); return true;
  };
  D.duplicate = function (L) {
    var n = this.base(SL.t('{0} نسخة', L.name), L.kind);
    n.visible = L.visible; n.opacity = L.opacity; n.blend = L.blend; n.x = L.x; n.y = L.y;
    if (L.kind === 'raster') n.canvas = clone(L.canvas); else n.p = JSON.parse(JSON.stringify(L.p));
    return this.insert(n, L);
  };
  /* a text/shape layer as pixels — needed before painting on it or filtering it */
  D.rasterize = function (L) {
    if (L.kind === 'raster') return L;
    var c = mkCanvas(this.w, this.h); this.drawLayer(c.getContext('2d'), L, true);
    L.kind = 'raster'; L.canvas = c; L.x = 0; L.y = 0; delete L.p; return L;
  };
  D.mergeDown = function (L) {
    var i = this.layers.indexOf(L); if (i <= 0) return false;
    var below = this.rasterize(this.layers[i - 1]);
    var g = below.canvas.getContext('2d');
    /* the lower layer's own offset is baked first so both share the document origin */
    if (below.x || below.y) { var c = mkCanvas(this.w, this.h); c.getContext('2d').drawImage(below.canvas, below.x, below.y); below.canvas = c; below.x = below.y = 0; g = c.getContext('2d'); }
    g.save(); g.globalAlpha = L.opacity; g.globalCompositeOperation = L.blend; this.drawLayer(g, L, true); g.restore();
    this.layers.splice(i, 1); this.active = below; return true;
  };
  D.flatten = function () {
    var c = mkCanvas(this.w, this.h); this.composite(c.getContext('2d'));
    var L = this.base(SL.t('الخلفية'), 'raster'); L.canvas = c;
    this.layers = [L]; this.active = L;
  };

  /* ---------- drawing ---------- */
  D.textMetrics = function (L, g) {
    var p = L.p; g = g || this.view.getContext('2d');
    g.font = (p.italic ? 'italic ' : '') + p.weight + ' ' + p.size + 'px ' + p.font;
    var lines = String(p.text).split('\n'), lh = p.size * p.lineH, w = 0;
    lines.forEach(function (s) { w = Math.max(w, g.measureText(s).width); });
    var h = lh * lines.length;
    var x0 = p.align === 'center' ? p.x - w / 2 : (p.align === 'right' ? p.x - w : p.x);
    return { lines: lines, lh: lh, w: w, h: h, box: { x: x0, y: p.y - h / 2, w: w, h: h } };
  };
  D.bounds = function (L) {
    if (L.kind === 'text') return this.textMetrics(L).box;
    if (L.kind === 'shape') { var p = L.p; return { x: Math.min(p.x1, p.x2), y: Math.min(p.y1, p.y2), w: Math.abs(p.x2 - p.x1), h: Math.abs(p.y2 - p.y1) }; }
    return { x: L.x, y: L.y, w: L.canvas.width, h: L.canvas.height };
  };
  D.drawLayer = function (g, L, ignoreAlpha) {
    if (L.kind === 'raster') { g.drawImage(L.canvas, L.x, L.y); return; }
    var p = L.p;
    if (L.kind === 'text') {
      var m = this.textMetrics(L, g);
      g.textAlign = p.align === 'center' ? 'center' : (p.align === 'right' ? 'right' : 'left');
      g.textBaseline = 'middle'; g.direction = 'inherit';
      if (p.shadow) { g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = p.size * 0.18; g.shadowOffsetY = p.size * 0.06; }
      m.lines.forEach(function (s, i) {
        var y = p.y - m.h / 2 + m.lh * (i + 0.5);
        if (p.stroke && p.strokeW) { g.lineJoin = 'round'; g.strokeStyle = p.stroke; g.lineWidth = p.strokeW * 2; g.strokeText(s, p.x, y); }
        g.fillStyle = p.color; g.fillText(s, p.x, y);
      });
      g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
      return;
    }
    /* shape */
    var x = Math.min(p.x1, p.x2), y = Math.min(p.y1, p.y2), w = Math.abs(p.x2 - p.x1), h = Math.abs(p.y2 - p.y1);
    g.lineWidth = p.sw; g.strokeStyle = p.stroke || 'transparent'; g.fillStyle = p.fill || 'transparent';
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    if (p.kind === 'rect') {
      var r = Math.min(p.radius || 0, w / 2, h / 2);
      if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
      if (p.fill) g.fill(); if (p.stroke && p.sw) g.stroke();
    } else if (p.kind === 'ellipse') {
      g.ellipse(x + w / 2, y + h / 2, Math.max(.5, w / 2), Math.max(.5, h / 2), 0, 0, Math.PI * 2);
      if (p.fill) g.fill(); if (p.stroke && p.sw) g.stroke();
    } else {
      g.strokeStyle = p.stroke || p.fill || '#fff';
      g.moveTo(p.x1, p.y1); g.lineTo(p.x2, p.y2); g.stroke();
      if (p.kind === 'arrow') {
        var a = Math.atan2(p.y2 - p.y1, p.x2 - p.x1), head = Math.max(12, p.sw * 3.2);
        g.beginPath();
        g.moveTo(p.x2, p.y2);
        g.lineTo(p.x2 - head * Math.cos(a - .45), p.y2 - head * Math.sin(a - .45));
        g.lineTo(p.x2 - head * Math.cos(a + .45), p.y2 - head * Math.sin(a + .45));
        g.closePath(); g.fillStyle = g.strokeStyle; g.fill();
      }
    }
  };
  D.composite = function (g, opts) {
    g = g || this.view.getContext('2d');
    g.clearRect(0, 0, this.w, this.h);
    var self = this, live = opts && opts.live;
    this.layers.forEach(function (L) {
      if (!L.visible) return;
      g.save();
      g.globalAlpha = L.opacity;
      g.globalCompositeOperation = L.blend;
      /* a stroke in progress: the tool hands a working copy of the layer (base + stroke) */
      if (live && live.layer === L && live.canvas) g.drawImage(live.canvas, L.x, L.y);
      else self.drawLayer(g, L);
      g.restore();
    });
    return this.view;
  };
  /* the flattened image (for export / hand-off) */
  D.flat = function () { var c = mkCanvas(this.w, this.h); this.composite(c.getContext('2d')); return c; };

  /* ---------- selection ---------- */
  /* sel = { shape: 'rect'|'ellipse', x, y, w, h } in document pixels */
  D.selPath = function (g) {
    var s = this.sel; if (!s) return false;
    g.beginPath();
    if (s.shape === 'ellipse') g.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.max(.5, s.w / 2), Math.max(.5, s.h / 2), 0, 0, Math.PI * 2);
    else g.rect(s.x, s.y, s.w, s.h);
    return true;
  };
  D.clipToSel = function (g, L) {
    if (!this.sel) return;
    g.save(); g.translate(-(L ? L.x : 0), -(L ? L.y : 0)); this.selPath(g); g.restore(); g.clip();
  };
  D.selectAll = function () { this.sel = { shape: 'rect', x: 0, y: 0, w: this.w, h: this.h }; };

  /* ---------- whole-document ops ---------- */
  D.crop = function (r) {
    r = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
    this.layers.forEach(function (L) {
      if (L.kind === 'raster') {
        var c = mkCanvas(r.w, r.h); c.getContext('2d').drawImage(L.canvas, L.x - r.x, L.y - r.y); L.canvas = c; L.x = L.y = 0;
      } else if (L.kind === 'text') { L.p.x -= r.x; L.p.y -= r.y; }
      else { L.p.x1 -= r.x; L.p.x2 -= r.x; L.p.y1 -= r.y; L.p.y2 -= r.y; }
    });
    this.w = r.w; this.h = r.h; this.sel = null; this.view = mkCanvas(r.w, r.h);
  };
  D.canvasSize = function (w, h, ax, ay) {
    /* ax/ay ∈ {0, .5, 1}: where the old canvas sits in the new one */
    var dx = Math.round((w - this.w) * ax), dy = Math.round((h - this.h) * ay);
    this.crop({ x: -dx, y: -dy, w: w, h: h });
  };
  D.resize = function (w, h) {
    w = Math.max(1, Math.min(MAX_DIM, Math.round(w))); h = Math.max(1, Math.min(MAX_DIM, Math.round(h)));
    var kx = w / this.w, ky = h / this.h, self = this;
    this.layers.forEach(function (L) {
      if (L.kind === 'raster') {
        var c = mkCanvas(w, h), g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
        g.drawImage(L.canvas, L.x * kx, L.y * ky, L.canvas.width * kx, L.canvas.height * ky); L.canvas = c; L.x = L.y = 0;
      } else if (L.kind === 'text') { L.p.x *= kx; L.p.y *= ky; L.p.size *= Math.min(kx, ky); L.p.strokeW *= Math.min(kx, ky); }
      else { L.p.x1 *= kx; L.p.x2 *= kx; L.p.y1 *= ky; L.p.y2 *= ky; L.p.sw *= Math.min(kx, ky); }
    });
    this.w = w; this.h = h; this.sel = null; this.view = mkCanvas(w, h);
    void self;
  };
  D.rotate = function (deg) {
    var self = this, nw = deg % 180 ? this.h : this.w, nh = deg % 180 ? this.w : this.h;
    this.layers.forEach(function (L) {
      self.rasterize(L);
      var c = mkCanvas(nw, nh), g = c.getContext('2d');
      g.translate(nw / 2, nh / 2); g.rotate(deg * Math.PI / 180); g.drawImage(L.canvas, -self.w / 2 + L.x, -self.h / 2 + L.y);
      L.canvas = c; L.x = L.y = 0;
    });
    this.w = nw; this.h = nh; this.sel = null; this.view = mkCanvas(nw, nh);
  };
  D.flip = function (horiz) {
    var self = this;
    this.layers.forEach(function (L) {
      self.rasterize(L);
      var c = mkCanvas(self.w, self.h), g = c.getContext('2d');
      if (horiz) { g.translate(self.w, 0); g.scale(-1, 1); } else { g.translate(0, self.h); g.scale(1, -1); }
      g.drawImage(L.canvas, L.x, L.y); L.canvas = c; L.x = L.y = 0;
    });
  };

  /* ---------- pixel ops on the active raster layer (selection-aware) ---------- */
  /* apply(fn) runs fn(ctx, layer) on a copy, then keeps the copy only inside the selection */
  D.applyToLayer = function (L, fn) {
    this.rasterize(L);
    var out = mkCanvas(L.canvas.width, L.canvas.height), g = out.getContext('2d');
    fn(g, L.canvas, L);
    if (this.sel) {
      var merged = clone(L.canvas), mg = merged.getContext('2d');
      mg.save(); this.clipToSel(mg, L); mg.clearRect(0, 0, merged.width, merged.height); mg.drawImage(out, 0, 0); mg.restore();
      L.canvas = merged;
    } else L.canvas = out;
  };
  D.clearSel = function (L) {
    if (!this.sel) return false;
    this.rasterize(L);
    var g = L.canvas.getContext('2d'); g.save(); this.clipToSel(g, L); g.clearRect(0, 0, L.canvas.width, L.canvas.height); g.restore();
    return true;
  };
  D.fillSel = function (L, color) {
    this.rasterize(L);
    var g = L.canvas.getContext('2d'); g.save();
    if (this.sel) this.clipToSel(g, L);
    g.fillStyle = color; g.fillRect(0, 0, L.canvas.width, L.canvas.height); g.restore();
  };
  /* flood fill from a point (document coords) on the layer's own pixels */
  D.floodFill = function (L, dx, dy, color, tol) {
    this.rasterize(L);
    var cv = L.canvas, w = cv.width, h = cv.height, x0 = Math.floor(dx - L.x), y0 = Math.floor(dy - L.y);
    if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return false;
    var g = cv.getContext('2d'), img = g.getImageData(0, 0, w, h), d = img.data;
    var mask = null;
    if (this.sel) { var m = mkCanvas(w, h), mg = m.getContext('2d'); mg.fillStyle = '#000'; this.clipToSel(mg, L); mg.fillRect(0, 0, w, h); mask = mg.getImageData(0, 0, w, h).data; }
    var i0 = (y0 * w + x0) * 4, r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2], a0 = d[i0 + 3];
    var c = hex(color), t = (tol == null ? 32 : tol) * 4;
    var seen = new Uint8Array(w * h), stack = [x0, y0];
    function same(i) { return Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) + Math.abs(d[i + 3] - a0) <= t; }
    while (stack.length) {
      var y = stack.pop(), x = stack.pop();
      var lx = x; while (lx >= 0 && !seen[y * w + lx] && same((y * w + lx) * 4)) lx--;
      lx++;
      var up = false, dn = false;
      for (var xx = lx; xx < w; xx++) {
        var p = y * w + xx, i = p * 4;
        if (seen[p] || !same(i)) break;
        seen[p] = 1;
        if (!mask || mask[i + 3]) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; }
        if (y > 0) { var u = p - w; if (!seen[u] && same(u * 4)) { if (!up) { stack.push(xx, y - 1); up = true; } } else up = false; }
        if (y < h - 1) { var q = p + w; if (!seen[q] && same(q * 4)) { if (!dn) { stack.push(xx, y + 1); dn = true; } } else dn = false; }
      }
    }
    g.putImageData(img, 0, 0);
    return true;
  };
  D.pixelate = function (L, r, block) {
    this.rasterize(L);
    var x = Math.max(0, Math.floor(r.x - L.x)), y = Math.max(0, Math.floor(r.y - L.y));
    var w = Math.min(L.canvas.width - x, Math.ceil(r.w)), h = Math.min(L.canvas.height - y, Math.ceil(r.h));
    if (w < 2 || h < 2) return false;
    var b = Math.max(4, block | 0), sw = Math.max(1, Math.round(w / b)), sh = Math.max(1, Math.round(h / b));
    var t = mkCanvas(sw, sh), tg = t.getContext('2d'); tg.imageSmoothingEnabled = true; tg.drawImage(L.canvas, x, y, w, h, 0, 0, sw, sh);
    var g = L.canvas.getContext('2d'); g.save(); g.imageSmoothingEnabled = false; g.clearRect(x, y, w, h); g.drawImage(t, 0, 0, sw, sh, x, y, w, h); g.restore();
    return true;
  };
  D.sample = function (x, y) {
    var g = this.view.getContext('2d'), p = g.getImageData(Math.max(0, Math.min(this.w - 1, x | 0)), Math.max(0, Math.min(this.h - 1, y | 0)), 1, 1).data;
    return '#' + [p[0], p[1], p[2]].map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
  };
  D.selectionCanvas = function () {
    /* the merged pixels under the selection, cropped to its box */
    var s = this.sel, f = this.flat();
    if (!s) return f;
    var c = mkCanvas(s.w, s.h), g = c.getContext('2d');
    g.save(); g.translate(-s.x, -s.y); this.selPath(g); g.clip(); g.drawImage(f, 0, 0); g.restore();
    return c;
  };

  /* ---------- history ---------- */
  D.snapshot = function () {
    return {
      w: this.w, h: this.h, active: this.layers.indexOf(this.active),
      sel: this.sel ? Object.assign({}, this.sel) : null,
      layers: this.layers.map(function (L) {
        var o = Object.assign({}, L);
        if (L.kind === 'raster') o.canvas = clone(L.canvas); else o.p = JSON.parse(JSON.stringify(L.p));
        return o;
      })
    };
  };
  D.restore = function (s) {
    this.w = s.w; this.h = s.h; this.sel = s.sel ? Object.assign({}, s.sel) : null;
    this.layers = s.layers.map(function (o) { var L = Object.assign({}, o); if (o.kind === 'raster') L.canvas = clone(o.canvas); else L.p = JSON.parse(JSON.stringify(o.p)); return L; });
    this.active = this.layers[Math.max(0, Math.min(this.layers.length - 1, s.active))];
    if (this.view.width !== this.w || this.view.height !== this.h) this.view = mkCanvas(this.w, this.h);
  };
  D.commit = function (label, icon) {
    this.history = this.history.slice(0, this.hIndex + 1);
    this.history.push({ label: label, icon: icon || 'history', state: this.snapshot(), at: Date.now() });
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.hIndex = this.history.length - 1;
    this.emit('commit');
  };
  D.goto = function (i) {
    if (i < 0 || i >= this.history.length) return false;
    this.hIndex = i; this.restore(this.history[i].state); this.emit('history'); return true;
  };
  D.undo = function () { return this.goto(this.hIndex - 1); };
  D.redo = function () { return this.goto(this.hIndex + 1); };

  function hex(c) {
    var m = /^#?([0-9a-f]{6})$/i.exec(c || ''); if (!m) return [0, 0, 0];
    var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* ---------- adjustments (pure: src canvas → dst ctx) ---------- */
  var ADJ = {
    basic: { label: 'سطوع وتباين', icon: 'contrast', params: [['brightness', 'السطوع', -100, 100, 0], ['contrast', 'التباين', -100, 100, 0], ['exposure', 'التعريض', -100, 100, 0]],
      run: function (g, src, v) { g.filter = 'brightness(' + (100 + v.brightness + v.exposure * 0.6) + '%) contrast(' + (100 + v.contrast) + '%)'; g.drawImage(src, 0, 0); g.filter = 'none'; } },
    color: { label: 'التشبّع واللون', icon: 'palette', params: [['saturation', 'التشبّع', -100, 100, 0], ['hue', 'تدوير اللون', -180, 180, 0], ['vibrance', 'الحيوية', 0, 100, 0]],
      run: function (g, src, v) { g.filter = 'saturate(' + (100 + v.saturation + v.vibrance * 0.5) + '%) hue-rotate(' + v.hue + 'deg)'; g.drawImage(src, 0, 0); g.filter = 'none'; } },
    temp: { label: 'الحرارة واللمسة', icon: 'sun', params: [['temp', 'الحرارة', -100, 100, 0], ['tint', 'اللمسة (أخضر ⇄ أرجواني)', -100, 100, 0]],
      run: function (g, src, v) { pixelMap(g, src, function (d, i) { d[i] += v.temp * 0.6; d[i + 2] -= v.temp * 0.6; d[i + 1] -= v.tint * 0.5; }); } },
    blur: { label: 'تمويه', icon: 'blur', params: [['radius', 'نصف القطر', 0, 40, 4]],
      run: function (g, src, v) { g.filter = 'blur(' + v.radius + 'px)'; g.drawImage(src, 0, 0); g.filter = 'none'; } },
    sharpen: { label: 'زيادة الحدّة', icon: 'sharpen', params: [['amount', 'المقدار', 0, 100, 40]],
      run: function (g, src, v) { convolve(g, src, v.amount / 100); } },
    vignette: { label: 'تعتيم الحواف', icon: 'vignette', params: [['amount', 'المقدار', 0, 100, 45], ['size', 'الحجم', 10, 100, 60]],
      run: function (g, src, v) {
        g.drawImage(src, 0, 0);
        var w = src.width, h = src.height, r = Math.hypot(w, h) / 2;
        var gr = g.createRadialGradient(w / 2, h / 2, r * v.size / 100 * 0.6, w / 2, h / 2, r);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,' + v.amount / 100 + ')');
        g.globalCompositeOperation = 'source-atop'; g.fillStyle = gr; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over';
      } },
    noise: { label: 'حبيبات', icon: 'noise', params: [['amount', 'المقدار', 0, 100, 18]],
      run: function (g, src, v) { pixelMap(g, src, function (d, i) { var n = (Math.random() - .5) * v.amount * 2.2; d[i] += n; d[i + 1] += n; d[i + 2] += n; }); } },
    levels: { label: 'المستويات', icon: 'adjust', params: [['black', 'الأسود', 0, 120, 0], ['white', 'الأبيض', 135, 255, 255], ['gamma', 'الوسط (جاما ×100)', 30, 300, 100]],
      run: function (g, src, v) {
        var lut = new Uint8ClampedArray(256), gm = 100 / v.gamma;
        for (var i = 0; i < 256; i++) { var t = Math.min(1, Math.max(0, (i - v.black) / Math.max(1, v.white - v.black))); lut[i] = Math.round(255 * Math.pow(t, gm)); }
        pixelMap(g, src, function (d, k) { d[k] = lut[d[k]]; d[k + 1] = lut[d[k + 1]]; d[k + 2] = lut[d[k + 2]]; });
      } },
    posterize: { label: 'تقليل الألوان', icon: 'grid', params: [['levels', 'عدد المستويات', 2, 16, 5]],
      run: function (g, src, v) { var s = 255 / (v.levels - 1); pixelMap(g, src, function (d, i) { d[i] = Math.round(d[i] / s) * s; d[i + 1] = Math.round(d[i + 1] / s) * s; d[i + 2] = Math.round(d[i + 2] / s) * s; }); } }
  };
  var PRESETS = [
    ['none', 'الأصل', 'none'], ['vivid', 'حيوي', 'saturate(145%) contrast(110%)'], ['mono', 'أبيض وأسود', 'grayscale(100%) contrast(112%)'],
    ['sepia', 'عتيق', 'sepia(70%) contrast(95%) brightness(103%)'], ['cool', 'بارد', 'hue-rotate(-12deg) saturate(110%) brightness(102%)'],
    ['warm', 'دافئ', 'sepia(25%) saturate(130%) hue-rotate(-8deg)'], ['fade', 'باهت', 'contrast(82%) brightness(110%) saturate(80%)'],
    ['drama', 'درامي', 'contrast(140%) saturate(85%) brightness(92%)'], ['invert', 'عكس الألوان', 'invert(100%)'], ['noir', 'نوار', 'grayscale(100%) contrast(160%) brightness(85%)']
  ];
  function pixelMap(g, src, f) {
    g.drawImage(src, 0, 0);
    var img = g.getImageData(0, 0, src.width, src.height), d = img.data;
    for (var i = 0; i < d.length; i += 4) f(d, i);
    g.putImageData(img, 0, 0);
  }
  function convolve(g, src, amt) {
    g.drawImage(src, 0, 0);
    var w = src.width, h = src.height, img = g.getImageData(0, 0, w, h), s = img.data, o = new Uint8ClampedArray(s.length);
    var k = [0, -amt, 0, -amt, 1 + 4 * amt, -amt, 0, -amt, 0];
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 4;
      for (var c = 0; c < 3; c++) {
        var acc = 0, n = 0;
        for (var ky = -1; ky <= 1; ky++) for (var kx = -1; kx <= 1; kx++) {
          var xx = Math.min(w - 1, Math.max(0, x + kx)), yy = Math.min(h - 1, Math.max(0, y + ky));
          acc += s[(yy * w + xx) * 4 + c] * k[n++];
        }
        o[i + c] = acc;
      }
      o[i + 3] = s[i + 3];
    }
    img.data.set(o); g.putImageData(img, 0, 0);
  }

  SL.Editor = { Doc: Doc, BLENDS: BLENDS, ADJ: ADJ, PRESETS: PRESETS, mkCanvas: mkCanvas, clone: clone, hex: hex, MAX_DIM: MAX_DIM };
}());
