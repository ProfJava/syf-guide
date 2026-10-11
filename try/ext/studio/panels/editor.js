/* SYF Studio Lab — «المحرر الاحترافي»: a layered, Photoshop-style editor on editor-core.js.
 * Menu bar · tool options bar · tool column · canvas (zoom/pan) · Layers / Adjust / History.
 * Every control carries an icon AND a label; html[data-labels="icons"] collapses labels. */
(function () {
  'use strict';
  var SL = window.SL, I = SL.icon, E = SL.Editor;

  var TOOLS = [
    { id: 'move', label: 'تحريك', icon: 'move', key: 'V' },
    { id: 'marquee', label: 'تحديد', icon: 'select', key: 'M' },
    { id: 'crop', label: 'قصّ‖أداة القصّ في المحرّر', icon: 'crop', key: 'C' },
    '-',
    { id: 'brush', label: 'فرشاة', icon: 'brush', key: 'B' },
    { id: 'eraser', label: 'ممحاة', icon: 'eraser', key: 'E' },
    { id: 'fill', label: 'تعبئة', icon: 'fill', key: 'G' },
    { id: 'gradient', label: 'تدرّج', icon: 'gradient', key: 'D' },
    '-',
    { id: 'text', label: 'نص', icon: 'text', key: 'T' },
    { id: 'shape', label: 'شكل', icon: 'shape', key: 'U' },
    { id: 'redact', label: 'إخفاء', icon: 'blur', key: 'R' },
    { id: 'picker', label: 'قطّارة', icon: 'eyedrop', key: 'I' },
    '-',
    { id: 'hand', label: 'يد', icon: 'hand', key: 'H' },
    { id: 'zoom', label: 'تكبير', icon: 'zoom', key: 'Z' }
  ];
  var FONTS = [
    ['IBM Plex Sans Arabic, system-ui, sans-serif', 'IBM Plex عربي'], ['Tahoma, sans-serif', 'Tahoma'], ['Arial, sans-serif', 'Arial'],
    ['"Times New Roman", serif', 'Times'], ['Georgia, serif', 'Georgia'], ['"Courier New", monospace', 'Courier'],
    ['"Geeza Pro", "Damascus", sans-serif', 'Geeza'], ['"Baghdad", "Al Nile", sans-serif', 'Baghdad / Nile'], ['Impact, sans-serif', 'Impact']
  ];

  function mount(page) {
    var st = {
      doc: null, tool: SL.LS.get('ed_tool', 'brush'), fg: SL.LS.get('ed_fg', '#ff3b5c'), bg: '#ffffff',
      z: 1, ox: 0, oy: 0, space: false,
      o: Object.assign({
        brushSize: 24, brushHard: 70, brushOp: 100, eraseSize: 40, eraseHard: 80,
        selShape: 'rect', tol: 32, gradType: 'linear', gradMode: 'fgbg',
        shapeKind: 'rect', shapeFill: true, shapeStroke: false, shapeSW: 6, shapeR: 0,
        redactMode: 'pixel', redactBlock: 14, autoSel: true, cropRatio: 'free',
        font: FONTS[0][0], tsize: 72, tbold: true, titalic: false, talign: 'center', tstroke: false, tstrokeW: 4, tstrokeC: '#000000', tshadow: true
      }, SL.LS.get('ed_opts', {}))
    };
    function saveOpts() { SL.LS.set('ed_opts', st.o); SL.LS.set('ed_fg', st.fg); SL.LS.set('ed_tool', st.tool); }

    var root = SL.h('<div class="ed">'
      + '<div class="ed-menu" id="edmenu"></div>'
      + '<div class="ed-opts" id="edopts"></div>'
      + '<div class="ed-main"><div class="ed-tools" id="edtools"></div>'
      +   '<div class="ed-stage" id="stage"><div class="checkbg"></div><canvas class="ov"></canvas></div>'
      +   '<aside class="ed-side"><div class="tabs" id="tabs"></div><div class="pane" id="pane"></div></aside></div>'
      + '<div class="ed-status" id="status"></div></div>');
    page.appendChild(root);
    var stage = root.querySelector('#stage'), ov = stage.querySelector('.ov'), og = ov.getContext('2d');
    var checkbg = stage.querySelector('.checkbg');
    var docEl = null;

    /* ======================= menus ======================= */
    var menuDefs = [
      ['ملف‖قائمة المحرّر', 'file', function () { return [
        ['جديد…', 'plus', 'Ctrl+N', newDocDialog], ['فتح صورة…', 'open', 'Ctrl+O', openFile], ['فتح كطبقة…', 'layers', '', openAsLayer, !st.doc], '-',
        ['تصدير…', 'download', 'Ctrl+S', exportDialog, !st.doc], ['نسخ الصورة', 'copy', 'Ctrl+Shift+C', function () { SL.copyCanvas(st.doc.flat()); }, !st.doc],
        ['إرسال إلى أدوات الاستوديو', 'sparkles', '', sendToStudio, !st.doc]]; }],
      ['تعديل', 'editor', function () { return [
        ['تراجع', 'undo', 'Ctrl+Z', undo, !canUndo()], ['إعادة', 'redo', 'Ctrl+Shift+Z', redo, !canRedo()], '-',
        ['نسخ التحديد', 'copy', 'Ctrl+C', copySel, !st.doc], ['لصق كطبقة', 'paste', 'Ctrl+V', pasteFromClipboard, !st.doc], '-',
        ['مسح التحديد', 'trash', 'Delete', clearSel, !(st.doc && st.doc.sel)], ['تعبئة باللون الأمامي', 'fill', 'Alt+Del', fillFg, !st.doc]]; }],
      ['صورة‖قائمة المحرّر', 'image', function () { return [
        ['حجم الصورة…', 'resize', 'Ctrl+Alt+I', imageSizeDialog, !st.doc], ['حجم اللوحة…', 'canvas', 'Ctrl+Alt+C', canvasSizeDialog, !st.doc], '-',
        ['تدوير ٩٠° يميناً', 'rotate', '', function () { docOp(function (d) { d.rotate(90); }, 'تدوير', 'rotate'); }, !st.doc],
        ['تدوير ٩٠° يساراً', 'rotate', '', function () { docOp(function (d) { d.rotate(270); }, 'تدوير', 'rotate'); }, !st.doc],
        ['تدوير ١٨٠°', 'rotate', '', function () { docOp(function (d) { d.rotate(180); }, 'تدوير', 'rotate'); }, !st.doc],
        ['قلب أفقي', 'flipH', '', function () { docOp(function (d) { d.flip(true); }, 'قلب أفقي', 'flipH'); }, !st.doc],
        ['قلب عمودي', 'flipV', '', function () { docOp(function (d) { d.flip(false); }, 'قلب عمودي', 'flipV'); }, !st.doc], '-',
        ['قصّ إلى التحديد', 'crop', '', cropToSel, !(st.doc && st.doc.sel)], ['تسطيح الصورة', 'merge', '', function () { docOp(function (d) { d.flatten(); }, 'تسطيح', 'merge'); }, !st.doc]]; }],
      ['طبقة', 'layers', function () { var L = st.doc && st.doc.active; return [
        ['طبقة جديدة', 'plus', 'Ctrl+Shift+N', newLayer, !st.doc], ['نسخ الطبقة', 'duplicate', 'Ctrl+J', dupLayer, !L], ['حذف الطبقة', 'trash', '', delLayer, !(L && st.doc.layers.length > 1)], '-',
        ['دمج للأسفل', 'merge', 'Ctrl+E', mergeDown, !(L && st.doc.layers.indexOf(L) > 0)], ['تحويل إلى بكسلات', 'grid', '', rasterizeActive, !(L && L.kind !== 'raster')], '-',
        ['رفع الطبقة', 'up', 'Ctrl+]', function () { moveLayer(1); }, !L], ['خفض الطبقة', 'down', 'Ctrl+[', function () { moveLayer(-1); }, !L]]; }],
      ['تحديد', 'select', function () { return [
        ['تحديد الكل', 'select', 'Ctrl+A', selectAll, !st.doc], ['إلغاء التحديد', 'close', 'Ctrl+D', deselect, !(st.doc && st.doc.sel)]]; }],
      ['فلاتر', 'filter', function () { var list = Object.keys(E.ADJ).map(function (k) { return [E.ADJ[k].label + '…', E.ADJ[k].icon, '', function () { showTab('adjust'); openAdj(k); }, !st.doc]; });
        return list.concat(['-', ['فلاتر جاهزة', 'sparkles', '', function () { showTab('adjust'); }, !st.doc]]); }]
    ];
    var menu = root.querySelector('#edmenu'), openMenu = null;
    menuDefs.forEach(function (m) {
      var wrap = SL.h('<div class="m"><button type="button">' + I(m[1], 's') + '<span class="lbl"></span></button></div>');
      wrap.querySelector('.lbl').textContent = SL.t(m[0]);
      wrap.querySelector('button').addEventListener('click', function (e) { e.stopPropagation(); toggleMenu(wrap, m[2]); });
      wrap.querySelector('button').addEventListener('mouseenter', function () { if (openMenu && openMenu !== wrap) toggleMenu(wrap, m[2]); });
      menu.appendChild(wrap);
    });
    function toggleMenu(wrap, items) {
      closeMenus(); if (openMenu === wrap) { openMenu = null; return; }
      openMenu = wrap; wrap.classList.add('open');
      var dd = SL.h('<div class="dd" role="menu"></div>');
      items().forEach(function (it) {
        if (it === '-') { dd.appendChild(document.createElement('hr')); return; }
        var b = SL.h('<button type="button" role="menuitem">' + I(it[1], 's') + '<span></span><span class="k"></span></button>');
        b.children[1].textContent = SL.t(it[0]);
        /* i18n-dyn: a keyboard shortcut (Ctrl+Z), not a label */
        b.querySelector('.k').textContent = it[2] || '';
        b.disabled = !!it[4];
        b.addEventListener('click', function (e) { e.stopPropagation(); closeMenus(); openMenu = null; it[3](); });
        dd.appendChild(b);
      });
      wrap.appendChild(dd);
    }
    function closeMenus() { [].forEach.call(menu.querySelectorAll('.m'), function (w) { w.classList.remove('open'); var d = w.querySelector('.dd'); if (d) d.remove(); }); }
    var docClick = function () { closeMenus(); openMenu = null; };
    document.addEventListener('click', docClick);

    menu.appendChild(SL.h('<span class="sp"></span>'));
    var bUndo = actBtn('تراجع', 'undo', undo), bRedo = actBtn('إعادة', 'redo', redo);
    menu.appendChild(SL.h('<span class="sep"></span>'));
    actBtn('ملاءمة', 'fit', function () { fit(); });
    actBtn(SL.pct(100), 'zoom', function () { zoomTo(1); });
    menu.appendChild(SL.h('<span class="sep"></span>'));
    var bExport = actBtn('تصدير', 'download', exportDialog, true);
    function actBtn(label, icon, fn, pri) {
      var b = SL.h('<button type="button" class="act' + (pri ? ' btn pri sm' : '') + '">' + I(icon, 's') + '<span class="lbl"></span></button>');
      var tl = SL.t(label); b.querySelector('.lbl').textContent = tl; b.dataset.tip = tl; b.setAttribute('aria-label', tl); b.classList.add('tiponly');
      b.addEventListener('click', fn); menu.appendChild(b); return b;
    }

    /* ======================= tools column ======================= */
    var toolsEl = root.querySelector('#edtools');
    TOOLS.forEach(function (t) {
      if (t === '-') { toolsEl.appendChild(document.createElement('hr')); return; }
      var b = SL.h('<button type="button">' + I(t.icon) + '<span class="lbl"></span><span class="k"></span></button>');
      b.querySelector('.lbl').textContent = SL.t(t.label); b.querySelector('.k').textContent = t.key;
      b.dataset.tip = SL.t(t.label) + ' (' + t.key + ')'; b.dataset.tool = t.id; b.setAttribute('aria-label', SL.t(t.label));
      b.addEventListener('click', function () { setTool(t.id); });
      toolsEl.appendChild(b);
    });
    var colors = SL.h('<div class="colors"><input type="color" class="fg" title="اللون الأمامي"><input type="color" class="bg" title="لون الخلفية">'
      + '<button type="button" class="swap" title="تبديل (X)">' + I('swap') + '</button><button type="button" class="reset" title="الافتراضي">' + I('contrast') + '</button></div>');
    toolsEl.appendChild(colors);
    var fgIn = colors.querySelector('.fg'), bgIn = colors.querySelector('.bg');
    function paintColors() { fgIn.value = st.fg; bgIn.value = st.bg; }
    fgIn.addEventListener('input', function () { st.fg = fgIn.value; saveOpts(); syncFgToActive(); });
    bgIn.addEventListener('input', function () { st.bg = bgIn.value; });
    colors.querySelector('.swap').addEventListener('click', swapColors);
    colors.querySelector('.reset').addEventListener('click', function () { st.fg = '#000000'; st.bg = '#ffffff'; paintColors(); });
    function swapColors() { var t = st.fg; st.fg = st.bg; st.bg = t; paintColors(); saveOpts(); }
    paintColors();

    /* ======================= side panels ======================= */
    var tabs = root.querySelector('#tabs'), pane = root.querySelector('#pane'), tab = 'layers';
    [['layers', 'الطبقات', 'layers'], ['adjust', 'تعديلات', 'adjust'], ['history', 'السجلّ', 'history']].forEach(function (t) {
      var b = SL.h('<button type="button">' + I(t[2], 's') + '<span class="lbl"></span></button>');
      b.querySelector('.lbl').textContent = SL.t(t[1]); b.dataset.tab = t[0]; b.dataset.tip = SL.t(t[1]); b.classList.add('tiponly');
      b.addEventListener('click', function () { showTab(t[0]); });
      tabs.appendChild(b);
    });
    function showTab(t) { tab = t; [].forEach.call(tabs.children, function (b) { b.classList.toggle('on', b.dataset.tab === t); }); paintPane(); }

    function paintPane() {
      if (adj && tab !== 'adjust') cancelAdj();
      pane.textContent = '';
      if (!st.doc) { pane.appendChild(SL.h('<div class="empty">' + I('image', 'xl') + '<span>افتح صورة أو أنشئ مستنداً جديداً</span></div>')); return; }
      if (tab === 'layers') paintLayers(); else if (tab === 'adjust') paintAdjust(); else paintHistory();
    }

    function layerThumb(L) {
      var d = st.doc, c = E.mkCanvas(46, 34), g = c.getContext('2d'), k = Math.min(46 / d.w, 34 / d.h);
      c.width = Math.max(1, Math.round(d.w * k)); c.height = Math.max(1, Math.round(d.h * k));
      g.scale(k, k); d.drawLayer(g, L); return c;
    }
    function paintLayers() {
      var d = st.doc;
      var actions = SL.h('<div class="lacts"></div>');
      [['طبقة جديدة', 'plus', newLayer], ['نسخ', 'duplicate', dupLayer], ['رفع', 'up', function () { moveLayer(1); }], ['خفض', 'down', function () { moveLayer(-1); }],
       ['دمج للأسفل', 'merge', mergeDown], ['حذف', 'trash', delLayer]].forEach(function (a) {
        var b = SL.button('', a[1], 'sm icon tiponly', a[2]); b.dataset.tip = a[0]; b.setAttribute('aria-label', a[0]); actions.appendChild(b);
      });
      var list = SL.h('<div class="layers" role="listbox" aria-label="الطبقات"></div>');
      d.layers.slice().reverse().forEach(function (L) {
        var row = SL.h('<div class="layer" role="option"><button type="button" class="eye"></button><div class="th"></div><div class="nm"><span></span><small></small></div><span class="kind"></span></div>');
        row.classList.toggle('on', L === d.active); row.setAttribute('aria-selected', L === d.active);
        var eye = row.querySelector('.eye'); eye.innerHTML = I(L.visible ? 'eye' : 'eyeOff', 's'); eye.classList.toggle('off', !L.visible);
        eye.title = L.visible ? SL.t('إخفاء') : SL.t('إظهار');
        eye.addEventListener('click', function (e) { e.stopPropagation(); L.visible = !L.visible; commit(L.visible ? 'إظهار طبقة' : 'إخفاء طبقة', 'eye'); });
        row.querySelector('.th').appendChild(layerThumb(L));
        /* i18n-dyn: the layer's own name — user data, renamable */
        row.querySelector('.nm span').textContent = L.name;
        row.querySelector('.nm small').textContent = SL.t(({ raster: 'بكسلات', text: 'نص', shape: 'شكل' })[L.kind]) + (L.opacity < 1 ? ' · ' + SL.pct(L.opacity * 100) : '') + (L.blend !== 'source-over' ? ' · ' + blendName(L.blend) : '');
        row.querySelector('.kind').innerHTML = I(L.kind === 'text' ? 'text' : L.kind === 'shape' ? 'shape' : 'image', 's');
        row.addEventListener('click', function () { d.active = L; afterSelect(); });
        row.addEventListener('dblclick', function () {
          var nm = row.querySelector('.nm'), inp = SL.h('<input class="in rename">'); inp.value = L.name; nm.textContent = ''; nm.appendChild(inp); inp.focus(); inp.select();
          var done = function () { var v = inp.value.trim(); if (v && v !== L.name) { L.name = v.slice(0, 40); commit('إعادة تسمية', 'editor'); } else paintPane(); };
          inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = L.name; inp.blur(); } });
          inp.addEventListener('blur', done);
        });
        list.appendChild(row);
      });
      var L = d.active;
      var props = SL.h('<div class="sec"><h5>' + I('adjust', 's') + 'خصائص الطبقة</h5></div>');
      var op = SL.slider('الشفافية', 0, 100, 1, Math.round(L.opacity * 100), '٪', function (v) { L.opacity = v / 100; render(); });
      op.input.addEventListener('change', function () { commit('شفافية الطبقة', 'adjust'); });
      var blend = SL.h('<div class="field"><label>نمط المزج</label><select class="in"></select></div>');
      E.BLENDS.forEach(function (b) { var o = document.createElement('option'); o.value = b[0]; o.textContent = SL.t(b[1]); blend.querySelector('select').appendChild(o); });
      blend.querySelector('select').value = L.blend;
      blend.querySelector('select').addEventListener('change', function (e) { L.blend = e.target.value; commit('نمط المزج', 'layers'); });
      props.appendChild(op); props.appendChild(blend);
      pane.appendChild(actions); pane.appendChild(list); pane.appendChild(props);
    }
    function blendName(b) { var f = E.BLENDS.filter(function (x) { return x[0] === b; })[0]; return f ? f[1] : b; }

    /* ---- adjustments with live preview on the active layer ---- */
    var adj = null;   /* { key, layer, base (canvas), vals } */
    function paintAdjust() {
      if (adj) { paintAdjBox(); return; }
      var s1 = SL.h('<div class="sec"><h5>' + I('adjust', 's') + 'تعديلات — على الطبقة النشطة</h5><div class="adjs"></div></div>');
      Object.keys(E.ADJ).forEach(function (k) {
        var a = E.ADJ[k], b = SL.h('<button type="button">' + I(a.icon, 's') + '<span class="lbl"></span></button>');
        b.querySelector('.lbl').textContent = SL.t(a.label); b.dataset.tip = SL.t(a.label); b.classList.add('tiponly');
        b.addEventListener('click', function () { openAdj(k); });
        s1.querySelector('.adjs').appendChild(b);
      });
      var s2 = SL.h('<div class="sec"><h5>' + I('sparkles', 's') + 'فلاتر جاهزة</h5><div class="presets"></div></div>');
      var src = st.doc.active, thumb = E.mkCanvas(120, 80), tg = thumb.getContext('2d');
      var k = Math.max(120 / st.doc.w, 80 / st.doc.h); tg.scale(k, k);
      tg.translate((120 / k - st.doc.w) / 2, (80 / k - st.doc.h) / 2);
      st.doc.drawLayer(tg, src);
      E.PRESETS.forEach(function (p) {
        var b = SL.h('<button type="button"><canvas width="120" height="80"></canvas><span></span></button>');
        var g = b.querySelector('canvas').getContext('2d'); g.filter = p[2]; g.drawImage(thumb, 0, 0);
        b.querySelector('span').textContent = SL.t(p[1]);
        b.addEventListener('click', function () {
          if (p[0] === 'none') return;
          var L = st.doc.active; if (L.kind !== 'raster') { st.doc.rasterize(L); }
          st.doc.applyToLayer(L, function (cg, c) { cg.filter = p[2]; cg.drawImage(c, 0, 0); cg.filter = 'none'; });
          commit(SL.t('فلتر: {0}', SL.t(p[1])), 'sparkles');
        });
        s2.querySelector('.presets').appendChild(b);
      });
      pane.appendChild(s1); pane.appendChild(s2);
    }
    function openAdj(key) {
      if (!st.doc) return;
      if (adj) cancelAdj();
      var L = st.doc.active; st.doc.rasterize(L);
      adj = { key: key, layer: L, base: E.clone(L.canvas), vals: {} };
      E.ADJ[key].params.forEach(function (p) { adj.vals[p[0]] = p[4]; });
      if (tab !== 'adjust') { tab = 'adjust'; [].forEach.call(tabs.children, function (b) { b.classList.toggle('on', b.dataset.tab === 'adjust'); }); }
      pane.textContent = ''; paintAdjBox(); previewAdj();
    }
    function paintAdjBox() {
      var a = E.ADJ[adj.key];
      var box = SL.h('<div class="adjbox"><h4>' + I(a.icon, 's') + '<span></span></h4></div>');
      box.querySelector('span').textContent = st.doc.sel ? SL.t('{0} — داخل التحديد', SL.t(a.label)) : SL.t(a.label);
      a.params.forEach(function (p) {
        box.appendChild(SL.slider(p[1], p[2], p[3], 1, adj.vals[p[0]], '', function (v) { adj.vals[p[0]] = v; schedulePreview(); }));
      });
      var row = SL.h('<div class="row"></div>');
      row.appendChild(SL.button('تطبيق', 'check', 'pri sm', applyAdj));
      row.appendChild(SL.button('إلغاء', 'close', 'sm', function () { cancelAdj(); paintPane(); }));
      row.appendChild(SL.button('إعادة الضبط', 'undo', 'sm ghost', function () { E.ADJ[adj.key].params.forEach(function (p) { adj.vals[p[0]] = p[4]; }); pane.textContent = ''; paintAdjBox(); previewAdj(); }));
      box.appendChild(row);
      pane.appendChild(box);
    }
    var pvT = 0;
    function schedulePreview() { cancelAnimationFrame(pvT); pvT = requestAnimationFrame(previewAdj); }
    function previewAdj() {
      if (!adj) return;
      var L = adj.layer; L.canvas = E.clone(adj.base);
      st.doc.applyToLayer(L, function (g, c) { E.ADJ[adj.key].run(g, c, adj.vals); });
      render();
    }
    function applyAdj() { var a = E.ADJ[adj.key]; adj = null; commit(a.label, a.icon); }
    function cancelAdj() { if (!adj) return; adj.layer.canvas = adj.base; adj = null; render(); }

    function paintHistory() {
      var d = st.doc, list = SL.h('<div class="hist"></div>');
      d.history.forEach(function (h, i) {
        var b = SL.h('<button type="button">' + I(h.icon, 's') + '<span></span><small></small></button>');
        b.querySelector('span').textContent = SL.t(h.label);
        b.querySelector('small').textContent = new Date(h.at).toLocaleTimeString(SL.locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        b.classList.toggle('on', i === d.hIndex); b.classList.toggle('future', i > d.hIndex);
        b.addEventListener('click', function () { d.goto(i); });
        list.appendChild(b);
      });
      pane.appendChild(SL.h('<div class="sec"><h5>' + I('history', 's') + 'خطوات العمل — انقر خطوة للرجوع إليها</h5></div>'));
      pane.appendChild(list);
    }

    /* ======================= options bar ======================= */
    var optsEl = root.querySelector('#edopts');
    function optSlider(label, key, min, max, unit, after) {
      var w = SL.h('<label class="o"><span></span><input type="range"><span class="num"></span></label>');
      var r = w.querySelector('input'), n = w.querySelector('.num');
      w.querySelector('span').textContent = SL.t(label); r.min = min; r.max = max; r.value = st.o[key];
      var show = function () { n.textContent = r.value + (unit === '٪' ? SL.pctSign() : unit ? SL.t(unit) : ''); }; show();
      r.addEventListener('input', function () { st.o[key] = Number(r.value); show(); saveOpts(); if (after) after(); });
      return w;
    }
    function optSeg(key, items, after) { return SL.seg(items, st.o[key], function (v) { st.o[key] = v; saveOpts(); if (after) after(v); }); }
    function optCheck(label, key, after) {
      var w = SL.h('<label class="o check"><input type="checkbox" class="sw"><span></span></label>');
      w.querySelector('span').textContent = SL.t(label); var c = w.querySelector('input'); c.checked = !!st.o[key];
      c.addEventListener('change', function () { st.o[key] = c.checked; saveOpts(); if (after) after(); });
      return w;
    }
    function optColor(label, get, set) {
      var w = SL.h('<label class="o"><span></span><input type="color"></label>');
      w.querySelector('span').textContent = SL.t(label); var c = w.querySelector('input'); c.value = get();
      c.addEventListener('input', function () { set(c.value); });
      return w;
    }
    function optBtn(label, icon, fn, cls) { return SL.button(label, icon, 'sm collapsible ' + (cls || ''), fn); }

    function paintOpts() {
      optsEl.textContent = '';
      var t = TOOLS.filter(function (x) { return x.id === st.tool; })[0];
      optsEl.appendChild(SL.h('<span class="ti">' + I(t.icon, 's') + '<span></span></span>'));
      optsEl.lastChild.lastChild.textContent = SL.t(t.label);
      var add = function (el) { optsEl.appendChild(el); };
      var A = function () { return st.doc && st.doc.active; };
      switch (st.tool) {
        case 'move':
          add(optCheck('تحديد الطبقة تلقائياً', 'autoSel'));
          add(optBtn('توسيط أفقياً', 'fit', function () { alignActive('h'); }));
          add(optBtn('توسيط عمودياً', 'fit', function () { alignActive('v'); }));
          add(SL.h('<span class="note">اسحب مقابض الزوايا لتغيير الحجم · الأسهم للتحريك بدقّة</span>'));
          break;
        case 'marquee':
          add(optSeg('selShape', [['rect', 'مستطيل', 'rect'], ['ellipse', 'بيضاوي', 'ellipse']]));
          add(optBtn('تحديد الكل', 'select', selectAll));
          add(optBtn('إلغاء التحديد', 'close', deselect));
          add(optBtn('قصّ إلى التحديد', 'crop', cropToSel));
          add(optBtn('نسخ', 'copy', copySel));
          add(optBtn('مسح', 'trash', clearSel));
          break;
        case 'crop':
          add(optSeg('cropRatio', [['free', 'حرّ'], ['1', '1:1'], ['1.3333', '4:3'], ['1.5', '3:2'], ['1.7778', '16:9'], ['0.5625', '9:16'], ['0.8', '4:5']], function () { if (crop) { constrainCrop(); drawOverlay(); } }));
          add(optBtn('تطبيق القصّ', 'check', applyCrop, 'pri'));
          add(optBtn('إلغاء', 'close', function () { crop = st.doc ? { x: 0, y: 0, w: st.doc.w, h: st.doc.h } : null; drawOverlay(); }));
          break;
        case 'brush':
        case 'eraser':
          var er = st.tool === 'eraser';
          add(optSlider('الحجم', er ? 'eraseSize' : 'brushSize', 1, 400, 'px', drawOverlay));
          add(optSlider('الصلابة', er ? 'eraseHard' : 'brushHard', 0, 100, '٪'));
          if (!er) add(optSlider('الشفافية', 'brushOp', 1, 100, '٪'));
          if (!er) add(optColor('اللون', function () { return st.fg; }, function (v) { st.fg = v; paintColors(); saveOpts(); }));
          add(SL.h('<span class="note">[ و ] لتغيير الحجم</span>'));
          break;
        case 'fill':
          add(optSlider('التفاوت', 'tol', 0, 255, ''));
          add(optColor('اللون', function () { return st.fg; }, function (v) { st.fg = v; paintColors(); saveOpts(); }));
          add(optBtn('تعبئة التحديد كاملاً', 'fill', fillFg));
          break;
        case 'gradient':
          add(optSeg('gradType', [['linear', 'خطّي'], ['radial', 'دائري']]));
          add(optSeg('gradMode', [['fgbg', 'الأمامي ← الخلفية'], ['fgclear', 'الأمامي ← شفاف']]));
          add(SL.h('<span class="note">اسحب على اللوحة لرسم التدرّج</span>'));
          break;
        case 'text':
          var fs = SL.h('<label class="o"><span>الخط</span><select class="in"></select></label>');
          FONTS.forEach(function (f) { var o = document.createElement('option'); o.value = f[0]; o.textContent = SL.t(f[1]); fs.querySelector('select').appendChild(o); });
          fs.querySelector('select').value = st.o.font;
          fs.querySelector('select').addEventListener('change', function (e) { st.o.font = e.target.value; saveOpts(); textToActive('font', e.target.value); });
          add(fs);
          add(optSlider('الحجم', 'tsize', 8, 400, 'px', function () { textToActive('size', st.o.tsize); }));
          add(optCheck('عريض', 'tbold', function () { textToActive('weight', st.o.tbold ? 700 : 400); }));
          add(optCheck('مائل', 'titalic', function () { textToActive('italic', st.o.titalic); }));
          add(optSeg('talign', [['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']], function (v) { textToActive('align', v); }));
          add(optColor('اللون', function () { return st.fg; }, function (v) { st.fg = v; paintColors(); saveOpts(); textToActive('color', v); }));
          add(optCheck('حدّ', 'tstroke', function () { textToActive('strokeW', st.o.tstroke ? st.o.tstrokeW : 0); textToActive('stroke', st.o.tstrokeC); }));
          add(optColor('لون الحدّ', function () { return st.o.tstrokeC; }, function (v) { st.o.tstrokeC = v; saveOpts(); textToActive('stroke', v); }));
          add(optCheck('ظلّ', 'tshadow', function () { textToActive('shadow', st.o.tshadow); }));
          break;
        case 'shape':
          add(optSeg('shapeKind', [['rect', 'مستطيل', 'rect'], ['ellipse', 'بيضاوي', 'ellipse'], ['line', 'خط', 'line'], ['arrow', 'سهم', 'arrow']]));
          add(optCheck('تعبئة', 'shapeFill'));
          add(optCheck('حدّ', 'shapeStroke'));
          add(optSlider('سماكة', 'shapeSW', 1, 60, 'px'));
          add(optSlider('استدارة', 'shapeR', 0, 200, 'px'));
          add(SL.h('<span class="note">التعبئة = اللون الأمامي · الحدّ = لون الخلفية</span>'));
          break;
        case 'redact':
          add(optSeg('redactMode', [['pixel', 'بكسلة', 'grid'], ['blur', 'تمويه', 'blur'], ['box', 'مستطيل أسود', 'rect']]));
          add(optSlider('الشدّة', 'redactBlock', 4, 60, ''));
          add(SL.h('<span class="note">إخفاء نهائي للبيانات الحسّاسة — يُطبَّق على البكسلات نفسها</span>'));
          break;
        case 'picker':
          add(SL.h('<span class="note">انقر لأخذ اللون الأمامي · Alt + نقر للون الخلفية</span>'));
          add(optBtn('نسخ رمز اللون', 'copy', function () { navigator.clipboard.writeText(st.fg).then(function () { SL.toast(SL.t('نُسخ {0}', st.fg), 'check'); }); }));
          break;
        case 'hand':
          add(SL.h('<span class="note">اسحب لتحريك العرض · مسطرة المسافة تفعّل اليد مؤقتاً</span>'));
          add(optBtn('ملاءمة الشاشة', 'fit', fit));
          break;
        case 'zoom':
          add(optBtn('تكبير', 'zoom', function () { zoomBy(1.25); }));
          add(optBtn('تصغير', 'zoomOut', function () { zoomBy(0.8); }));
          add(optBtn(SL.pct(100), 'image', function () { zoomTo(1); }));
          add(optBtn('ملاءمة', 'fit', fit));
          break;
      }
      void A;
    }
    function textToActive(k, v) {
      var L = st.doc && st.doc.active; if (!L || L.kind !== 'text') return;
      L.p[k] = v; render(); debCommit('تنسيق النص', 'text');
    }
    function syncFgToActive() {
      var L = st.doc && st.doc.active; if (!L) return;
      if (L.kind === 'text') textToActive('color', st.fg);
    }
    var dcT = 0; function debCommit(label, icon) { clearTimeout(dcT); dcT = setTimeout(function () { commit(label, icon); }, 450); }

    /* ======================= view: zoom / pan ======================= */
    function stageSize() { return { w: stage.clientWidth, h: stage.clientHeight }; }
    function placeView() {
      if (!st.doc) return;
      var d = st.doc;
      if (docEl !== d.view) { if (docEl) docEl.remove(); docEl = d.view; docEl.className = 'doc'; stage.insertBefore(docEl, ov); }
      var t = 'translate(' + st.ox + 'px,' + st.oy + 'px) scale(' + st.z + ')';
      docEl.style.transform = t; docEl.classList.toggle('px', st.z >= 2);
      checkbg.style.left = st.ox + 'px'; checkbg.style.top = st.oy + 'px'; checkbg.style.width = d.w * st.z + 'px'; checkbg.style.height = d.h * st.z + 'px';
    }
    function fit() {
      if (!st.doc) return;
      var s = stageSize(), pad = 40;
      st.z = Math.min(1, (s.w - pad * 2) / st.doc.w, (s.h - pad * 2) / st.doc.h);
      if (!(st.z > 0)) st.z = 0.1;
      st.ox = (s.w - st.doc.w * st.z) / 2; st.oy = (s.h - st.doc.h * st.z) / 2;
      placeView(); drawOverlay(); paintStatus();
    }
    function zoomAt(nz, sx, sy) {
      nz = Math.max(0.02, Math.min(32, nz));
      var dx = (sx - st.ox) / st.z, dy = (sy - st.oy) / st.z;
      st.z = nz; st.ox = sx - dx * nz; st.oy = sy - dy * nz;
      placeView(); drawOverlay(); paintStatus();
    }
    function zoomBy(f) { var s = stageSize(); zoomAt(st.z * f, s.w / 2, s.h / 2); }
    function zoomTo(z) { var s = stageSize(); zoomAt(z, s.w / 2, s.h / 2); }
    function toDoc(e) { var r = stage.getBoundingClientRect(); return { x: (e.clientX - r.left - st.ox) / st.z, y: (e.clientY - r.top - st.oy) / st.z, sx: e.clientX - r.left, sy: e.clientY - r.top }; }

    var ro = new ResizeObserver(function () {
      var s = stageSize(), dpr = window.devicePixelRatio || 1;
      ov.width = Math.round(s.w * dpr); ov.height = Math.round(s.h * dpr); ov.style.width = s.w + 'px'; ov.style.height = s.h + 'px';
      if (st.doc && !st.fitted) { st.fitted = true; fit(); } else drawOverlay();
    });
    ro.observe(stage);

    stage.addEventListener('wheel', function (e) {
      if (!st.doc) return; e.preventDefault();
      var p = toDoc(e);
      if (e.ctrlKey || e.metaKey || st.tool === 'zoom') zoomAt(st.z * Math.exp(-e.deltaY * 0.0022), p.sx, p.sy);
      else { st.ox -= e.deltaX; st.oy -= e.deltaY; placeView(); drawOverlay(); }
    }, { passive: false });

    /* ======================= render ======================= */
    var live = null, rq = 0;
    function render() { cancelAnimationFrame(rq); rq = requestAnimationFrame(function () { if (!st.doc) return; st.doc.composite(null, { live: live }); placeView(); drawOverlay(); }); }
    var antsOff = 0, antsT = setInterval(function () { if (st.doc && st.doc.sel) { antsOff = (antsOff + 1) % 16; drawOverlay(); } }, 90);

    function drawOverlay() {
      var dpr = window.devicePixelRatio || 1;
      og.setTransform(1, 0, 0, 1, 0, 0); og.clearRect(0, 0, ov.width, ov.height);
      if (!st.doc) return;
      var d = st.doc, z = st.z;
      og.setTransform(dpr, 0, 0, dpr, 0, 0);
      var S = function (x, y) { return [st.ox + x * z, st.oy + y * z]; };
      /* selection ants */
      if (d.sel) {
        og.save(); og.translate(st.ox, st.oy); og.scale(z, z); d.selPath(og); og.restore();
        og.lineWidth = 1; og.setLineDash([5, 4]);
        og.strokeStyle = '#000'; og.lineDashOffset = -antsOff; og.stroke();
        og.strokeStyle = '#fff'; og.lineDashOffset = -antsOff + 4.5; og.stroke(); og.setLineDash([]);
      }
      /* active layer box + handles (move tool) */
      if (st.tool === 'move' && d.active && !drag) {
        var b = activeBox(); if (b) {
          var p0 = S(b.x, b.y);
          og.strokeStyle = cssVar('--acc'); og.lineWidth = 1.2; og.setLineDash([4, 3]); og.strokeRect(p0[0], p0[1], b.w * z, b.h * z); og.setLineDash([]);
          handles(b).forEach(function (h) { var q = S(h.x, h.y); og.fillStyle = '#fff'; og.strokeStyle = cssVar('--acc'); og.fillRect(q[0] - 4.5, q[1] - 4.5, 9, 9); og.strokeRect(q[0] - 4.5, q[1] - 4.5, 9, 9); });
        }
      }
      if (st.tool === 'move' && drag && drag.box) {
        var bb = drag.box, q0 = S(bb.x, bb.y); og.strokeStyle = cssVar('--acc'); og.lineWidth = 1.2; og.strokeRect(q0[0], q0[1], bb.w * z, bb.h * z);
      }
      /* crop */
      if (st.tool === 'crop' && crop) {
        var c0 = S(crop.x, crop.y), cw = crop.w * z, ch = crop.h * z, s = stageSize();
        og.fillStyle = 'rgba(0,0,0,.55)';
        og.beginPath(); og.rect(0, 0, s.w, s.h); og.rect(c0[0], c0[1], cw, ch); og.fill('evenodd');
        og.strokeStyle = '#fff'; og.lineWidth = 1.5; og.strokeRect(c0[0], c0[1], cw, ch);
        og.strokeStyle = 'rgba(255,255,255,.45)'; og.lineWidth = 1;
        for (var i = 1; i < 3; i++) { og.beginPath(); og.moveTo(c0[0] + cw * i / 3, c0[1]); og.lineTo(c0[0] + cw * i / 3, c0[1] + ch); og.moveTo(c0[0], c0[1] + ch * i / 3); og.lineTo(c0[0] + cw, c0[1] + ch * i / 3); og.stroke(); }
        handles(crop).forEach(function (h) { var q = S(h.x, h.y); og.fillStyle = '#fff'; og.fillRect(q[0] - 5, q[1] - 5, 10, 10); });
        og.fillStyle = 'rgba(0,0,0,.7)'; og.fillRect(c0[0], c0[1] - 24, 92, 20); og.fillStyle = '#fff'; og.font = '600 11px ui-monospace, monospace';
        og.fillText(Math.round(crop.w) + ' × ' + Math.round(crop.h), c0[0] + 6, c0[1] - 10);
      }
      /* previews while dragging */
      if (drag && drag.preview) drag.preview();
      /* brush cursor */
      if ((st.tool === 'brush' || st.tool === 'eraser') && hover) {
        var size = st.tool === 'eraser' ? st.o.eraseSize : st.o.brushSize, hp = S(hover.x, hover.y);
        og.beginPath(); og.arc(hp[0], hp[1], Math.max(1, size * z / 2), 0, Math.PI * 2);
        og.strokeStyle = 'rgba(0,0,0,.7)'; og.lineWidth = 2.5; og.stroke(); og.strokeStyle = '#fff'; og.lineWidth = 1; og.stroke();
      }
    }
    function cssVar(n) { return getComputedStyle(root).getPropertyValue(n).trim() || '#3b9eff'; }
    function handles(b) {
      return [{ k: 'nw', x: b.x, y: b.y }, { k: 'n', x: b.x + b.w / 2, y: b.y }, { k: 'ne', x: b.x + b.w, y: b.y }, { k: 'e', x: b.x + b.w, y: b.y + b.h / 2 },
              { k: 'se', x: b.x + b.w, y: b.y + b.h }, { k: 's', x: b.x + b.w / 2, y: b.y + b.h }, { k: 'sw', x: b.x, y: b.y + b.h }, { k: 'w', x: b.x, y: b.y + b.h / 2 }];
    }
    function hitHandle(b, p) {
      var r = 7 / st.z;
      return handles(b).filter(function (h) { return Math.abs(h.x - p.x) <= r && Math.abs(h.y - p.y) <= r; })[0] || null;
    }

    /* content box of the active layer (raster: trimmed to its opaque pixels, cached) */
    var boxCache = { key: '', box: null };
    function activeBox() {
      var L = st.doc.active; if (!L) return null;
      if (L.kind !== 'raster') return st.doc.bounds(L);
      var key = L.id + ':' + st.doc.hIndex + ':' + L.x + ':' + L.y;
      if (boxCache.key === key) return boxCache.box;
      var c = L.canvas, w = c.width, h = c.height, k = Math.min(1, 600 / Math.max(w, h));
      var t = E.mkCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))), tg = t.getContext('2d'); tg.drawImage(c, 0, 0, t.width, t.height);
      var dd = tg.getImageData(0, 0, t.width, t.height).data, x0 = t.width, y0 = t.height, x1 = -1, y1 = -1;
      for (var y = 0; y < t.height; y++) for (var x = 0; x < t.width; x++) if (dd[(y * t.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      var box = x1 < 0 ? null : { x: L.x + x0 / k, y: L.y + y0 / k, w: (x1 - x0 + 1) / k, h: (y1 - y0 + 1) / k };
      boxCache = { key: key, box: box }; return box;
    }

    /* ======================= pointer tools ======================= */
    var drag = null, hover = null, crop = null;
    stage.addEventListener('pointermove', function (e) {
      if (!st.doc) return;
      var p = toDoc(e); hover = p; paintStatus(p);
      if (drag && drag.move) { drag.move(p, e); return; }
      if (st.tool === 'brush' || st.tool === 'eraser') drawOverlay();
      stage.style.cursor = cursorFor(p);
    });
    stage.addEventListener('pointerleave', function () { hover = null; drawOverlay(); });
    stage.addEventListener('pointerdown', function (e) {
      if (!st.doc || e.button === 2) return;
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* synthetic / already released */ }
      var p = toDoc(e), tool = (st.space || e.button === 1) ? 'hand' : st.tool;
      var fn = DOWN[tool]; if (fn) drag = fn(p, e) || null;
      if (drag && drag.preview) drawOverlay();
    });
    stage.addEventListener('pointerup', function (e) {
      if (drag && drag.up) drag.up(toDoc(e), e);
      drag = null; drawOverlay();
    });
    function cursorFor(p) {
      if (st.space) return 'grab';
      switch (st.tool) {
        case 'hand': return 'grab';
        case 'zoom': return 'zoom-in';
        case 'move': var b = activeBox(), h = b && hitHandle(b, p); return h ? (h.k === 'n' || h.k === 's' ? 'ns-resize' : h.k === 'e' || h.k === 'w' ? 'ew-resize' : (h.k === 'nw' || h.k === 'se' ? 'nwse-resize' : 'nesw-resize')) : 'move';
        case 'brush': case 'eraser': return 'none';
        case 'text': return 'text';
        case 'picker': return 'copy';
        case 'crop': var hh = crop && hitHandle(crop, p); return hh ? 'crosshair' : 'crosshair';
        default: return 'crosshair';
      }
    }

    var DOWN = {
      hand: function (p) {
        var sx = p.sx, sy = p.sy, ox = st.ox, oy = st.oy; stage.style.cursor = 'grabbing';
        return { move: function (q) { st.ox = ox + q.sx - sx; st.oy = oy + q.sy - sy; placeView(); drawOverlay(); } };
      },
      zoom: function (p, e) { zoomAt(st.z * (e.altKey ? 0.8 : 1.25), p.sx, p.sy); },
      picker: function (p, e) {
        var pick = function (q) { var c = st.doc.sample(q.x, q.y); if (e.altKey) st.bg = c; else st.fg = c; paintColors(); saveOpts(); };
        pick(p); return { move: pick, up: function () { SL.toast(SL.t('اللون: {0}', e.altKey ? st.bg : st.fg), 'eyedrop'); } };
      },
      marquee: function (p, e) {
        var d = st.doc, s0 = d.sel;
        /* drag INSIDE an existing selection moves it */
        if (s0 && p.x >= s0.x && p.x <= s0.x + s0.w && p.y >= s0.y && p.y <= s0.y + s0.h) {
          var bx = s0.x, by = s0.y;
          return { move: function (q) { s0.x = bx + q.x - p.x; s0.y = by + q.y - p.y; drawOverlay(); }, up: function () { commit('تحريك التحديد', 'select'); } };
        }
        var moved = false;
        return {
          move: function (q, ev) {
            moved = true;
            var w = q.x - p.x, h = q.y - p.y;
            if (ev.shiftKey) { var m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
            d.sel = { shape: st.o.selShape, x: Math.min(p.x, p.x + w), y: Math.min(p.y, p.y + h), w: Math.abs(w), h: Math.abs(h) };
            drawOverlay();
          },
          up: function () { if (!moved || (d.sel && (d.sel.w < 2 || d.sel.h < 2))) { if (d.sel) { d.sel = null; commit('إلغاء التحديد', 'close'); } } else commit('تحديد', 'select'); void e; }
        };
      },
      move: function (p, e) {
        var d = st.doc, b = activeBox(), h = b && hitHandle(b, p);
        if (!h && st.o.autoSel) { var hit = hitLayer(p); if (hit && hit !== d.active) { d.active = hit; afterSelect(); b = activeBox(); } }
        var L = d.active; if (!L || L.locked) return;
        if (h && b) return scaleDrag(L, b, h, p, e);
        var start = snapshotPos(L), mv = false;
        return {
          move: function (q) { mv = true; setPos(L, start, q.x - p.x, q.y - p.y); boxCache.key = ''; render(); },
          up: function () { if (mv) commit('تحريك', 'move'); }
        };
      },
      crop: function (p) {
        if (!crop) crop = { x: 0, y: 0, w: st.doc.w, h: st.doc.h };
        var h = hitHandle(crop, p), c0 = Object.assign({}, crop);
        if (h) {
          return { move: function (q) {
            var x0 = c0.x, y0 = c0.y, x1 = c0.x + c0.w, y1 = c0.y + c0.h;
            if (/w/.test(h.k)) x0 = Math.min(q.x, x1 - 4); if (/e/.test(h.k)) x1 = Math.max(q.x, x0 + 4);
            if (/n/.test(h.k)) y0 = Math.min(q.y, y1 - 4); if (/s/.test(h.k)) y1 = Math.max(q.y, y0 + 4);
            crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; constrainCrop(h.k); drawOverlay();
          } };
        }
        if (p.x > crop.x && p.x < crop.x + crop.w && p.y > crop.y && p.y < crop.y + crop.h) {
          return { move: function (q) { crop.x = c0.x + q.x - p.x; crop.y = c0.y + q.y - p.y; drawOverlay(); } };
        }
        return { move: function (q) { crop = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.max(4, Math.abs(q.x - p.x)), h: Math.max(4, Math.abs(q.y - p.y)) }; constrainCrop('se'); drawOverlay(); } };
      },
      brush: function (p) { return paintStroke(p, false); },
      eraser: function (p) { return paintStroke(p, true); },
      fill: function (p) {
        var L = needRaster(); if (!L) return;
        if (st.doc.floodFill(L, p.x, p.y, st.fg, st.o.tol)) commit('تعبئة', 'fill');
      },
      gradient: function (p) {
        var q = p;
        return {
          preview: function () { var a = [st.ox + p.x * st.z, st.oy + p.y * st.z], b = [st.ox + q.x * st.z, st.oy + q.y * st.z]; og.strokeStyle = '#fff'; og.lineWidth = 2; og.beginPath(); og.moveTo(a[0], a[1]); og.lineTo(b[0], b[1]); og.stroke(); og.fillStyle = st.fg; og.beginPath(); og.arc(a[0], a[1], 5, 0, 7); og.fill(); },
          move: function (r) { q = r; drawOverlay(); },
          up: function () {
            if (Math.hypot(q.x - p.x, q.y - p.y) < 2) return;
            var L = needRaster(); if (!L) return;
            var g = L.canvas.getContext('2d'); g.save(); if (st.doc.sel) st.doc.clipToSel(g, L); g.translate(-L.x, -L.y);
            var gr = st.o.gradType === 'radial' ? g.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.hypot(q.x - p.x, q.y - p.y)) : g.createLinearGradient(p.x, p.y, q.x, q.y);
            gr.addColorStop(0, st.fg); gr.addColorStop(1, st.o.gradMode === 'fgclear' ? hexA(st.fg, 0) : st.bg);
            g.fillStyle = gr; g.fillRect(L.x, L.y, L.canvas.width, L.canvas.height); g.restore();
            commit('تدرّج', 'gradient');
          }
        };
      },
      shape: function (p) {
        var q = p, kind = st.o.shapeKind;
        var props = function () {
          return { kind: kind, x1: p.x, y1: p.y, x2: q.x, y2: q.y, fill: (kind === 'line' || kind === 'arrow') ? '' : (st.o.shapeFill ? st.fg : ''),
            stroke: (kind === 'line' || kind === 'arrow') ? st.fg : (st.o.shapeStroke ? st.bg : ''), sw: st.o.shapeSW, radius: st.o.shapeR };
        };
        return {
          preview: function () { og.save(); og.translate(st.ox, st.oy); og.scale(st.z, st.z); st.doc.drawLayer(og, { kind: 'shape', p: props() }); og.restore(); },
          move: function (r, ev) {
            q = r;
            if (ev.shiftKey && (kind === 'rect' || kind === 'ellipse')) { var m = Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y)); q = { x: p.x + Math.sign(q.x - p.x || 1) * m, y: p.y + Math.sign(q.y - p.y || 1) * m }; }
            drawOverlay();
          },
          up: function () {
            if (Math.hypot(q.x - p.x, q.y - p.y) < 3) return;
            var pp = props(); if (kind !== 'line' && kind !== 'arrow' && !pp.fill && !pp.stroke) pp.fill = st.fg;
            st.doc.addShape(pp); commit('شكل', 'shape');
          }
        };
      },
      redact: function (p) {
        var q = p;
        return {
          preview: function () { var a = [st.ox + Math.min(p.x, q.x) * st.z, st.oy + Math.min(p.y, q.y) * st.z]; og.strokeStyle = '#ff5c5c'; og.lineWidth = 2; og.setLineDash([6, 4]); og.strokeRect(a[0], a[1], Math.abs(q.x - p.x) * st.z, Math.abs(q.y - p.y) * st.z); og.setLineDash([]); },
          move: function (r) { q = r; drawOverlay(); },
          up: function () {
            var r = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) };
            if (r.w < 3 || r.h < 3) return;
            var L = needRaster(true); if (!L) return;
            if (st.o.redactMode === 'pixel') st.doc.pixelate(L, r, st.o.redactBlock);
            else {
              var g = L.canvas.getContext('2d'); g.save(); g.beginPath(); g.rect(r.x - L.x, r.y - L.y, r.w, r.h); g.clip();
              if (st.o.redactMode === 'box') { g.fillStyle = '#000'; g.fill(); }
              else { var t = E.clone(L.canvas); g.filter = 'blur(' + st.o.redactBlock + 'px)'; g.drawImage(t, 0, 0); g.filter = 'none'; }
              g.restore();
            }
            commit('إخفاء', 'blur');
          }
        };
      },
      text: function (p) {
        var hit = hitLayer(p, 'text');
        if (hit) { st.doc.active = hit; afterSelect(); editText(hit); return; }
        var L = st.doc.addText({ text: 'اكتب هنا', x: p.x, y: p.y, size: st.o.tsize, font: st.o.font, weight: st.o.tbold ? 700 : 400, italic: st.o.titalic, align: st.o.talign, color: st.fg,
          stroke: st.o.tstrokeC, strokeW: st.o.tstroke ? st.o.tstrokeW : 0, shadow: st.o.tshadow });
        commit('نص جديد', 'text'); editText(L, true);
      }
    };

    function hexA(c, a) { var v = E.hex(c); return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + a + ')'; }
    /* painting needs pixels. On a text/shape layer, a NEW pixel layer is made above it (the
       text stays editable) — Photoshop asks; making the layer is what nearly everyone picks.
       `onImage` (the hide tool) wants the pixels UNDER it instead: the nearest raster below. */
    function needRaster(onImage) {
      var d = st.doc, L = d.active; if (!L) return null;
      if (L.kind === 'raster') return L;
      if (onImage) {
        for (var i = d.layers.indexOf(L); i >= 0; i--) if (d.layers[i].kind === 'raster' && d.layers[i].visible) { d.active = d.layers[i]; return d.layers[i]; }
      }
      var n = d.addRaster(); SL.toast(SL.t('أُنشئت طبقة جديدة للرسم — طبقة «{0}» بقيت قابلة للتعديل', L.name), 'layers');
      return n;
    }
    function hitLayer(p, kind) {
      var d = st.doc;
      for (var i = d.layers.length - 1; i >= 0; i--) {
        var L = d.layers[i]; if (!L.visible || (kind && L.kind !== kind)) continue;
        if (L.kind === 'raster') {
          var x = Math.floor(p.x - L.x), y = Math.floor(p.y - L.y);
          if (x < 0 || y < 0 || x >= L.canvas.width || y >= L.canvas.height) continue;
          if (L.canvas.getContext('2d').getImageData(x, y, 1, 1).data[3] > 10) return L;
        } else { var b = d.bounds(L), pad = 6 / st.z; if (p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad) return L; }
      }
      return null;
    }
    function snapshotPos(L) { return L.kind === 'raster' ? { x: L.x, y: L.y } : JSON.parse(JSON.stringify(L.p)); }
    function setPos(L, s, dx, dy) {
      if (L.kind === 'raster') { L.x = Math.round(s.x + dx); L.y = Math.round(s.y + dy); }
      else if (L.kind === 'text') { L.p.x = s.x + dx; L.p.y = s.y + dy; }
      else { L.p.x1 = s.x1 + dx; L.p.x2 = s.x2 + dx; L.p.y1 = s.y1 + dy; L.p.y2 = s.y2 + dy; }
    }
    /* free transform by a handle: corners keep the aspect ratio, edges stretch one axis */
    function scaleDrag(L, b, h, p, e) {
      var s0 = snapshotPos(L), base = L.kind === 'raster' ? E.clone(L.canvas) : null, nb = b;
      var ax = /w/.test(h.k) ? b.x + b.w : (/e/.test(h.k) ? b.x : null), ay = /n/.test(h.k) ? b.y + b.h : (/s/.test(h.k) ? b.y : null);
      function box(q, keep) {
        var x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
        if (/w/.test(h.k)) x0 = q.x; if (/e/.test(h.k)) x1 = q.x; if (/n/.test(h.k)) y0 = q.y; if (/s/.test(h.k)) y1 = q.y;
        var w = Math.max(4, x1 - x0), hh = Math.max(4, y1 - y0);
        if (keep && ax !== null && ay !== null) { var k = Math.max(w / b.w, hh / b.h); w = b.w * k; hh = b.h * k; x0 = /w/.test(h.k) ? ax - w : ax; y0 = /n/.test(h.k) ? ay - hh : ay; }
        else { if (ax !== null && /w/.test(h.k)) x0 = ax - w; if (ay !== null && /n/.test(h.k)) y0 = ay - hh; if (ax === null) { x0 = b.x; w = b.w; } if (ay === null) { y0 = b.y; hh = b.h; } }
        return { x: x0, y: y0, w: w, h: hh };
      }
      function apply(nbx) {
        var kx = nbx.w / b.w, ky = nbx.h / b.h;
        if (L.kind === 'raster') {
          var c = E.mkCanvas(st.doc.w, st.doc.h), g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
          g.drawImage(base, b.x - s0.x, b.y - s0.y, b.w, b.h, nbx.x, nbx.y, nbx.w, nbx.h);
          L.canvas = c; L.x = 0; L.y = 0;
        } else if (L.kind === 'text') {
          L.p.size = Math.max(4, s0.size * Math.min(kx, ky)); L.p.strokeW = s0.strokeW * Math.min(kx, ky);
          L.p.x = s0.x + (nbx.x + nbx.w / 2) - (b.x + b.w / 2); L.p.y = s0.y + (nbx.y + nbx.h / 2) - (b.y + b.h / 2);
        } else {
          var mx = function (x) { return nbx.x + (x - b.x) * kx; }, my = function (y) { return nbx.y + (y - b.y) * ky; };
          L.p.x1 = mx(s0.x1); L.p.x2 = mx(s0.x2); L.p.y1 = my(s0.y1); L.p.y2 = my(s0.y2);
        }
      }
      return {
        box: nb,
        move: function (q, ev) { nb = box(q, !ev.shiftKey); this.box = nb; if (L.kind !== 'raster') { apply(nb); render(); } else drawOverlay(); },
        up: function () { if (nb !== b) { apply(nb); boxCache.key = ''; commit('تغيير الحجم', 'resize'); } }
      };
    }

    /* brush / eraser: stamps into a stroke canvas; the layer shows base + stroke while drawing */
    function paintStroke(p, erase) {
      var L = needRaster(); if (!L) return;
      var size = erase ? st.o.eraseSize : st.o.brushSize, hard = (erase ? st.o.eraseHard : st.o.brushHard) / 100;
      var alpha = erase ? 1 : st.o.brushOp / 100, color = st.fg;
      var base = L.canvas, w = base.width, h = base.height;
      var stroke = E.mkCanvas(w, h), sg = stroke.getContext('2d'), work = E.mkCanvas(w, h), wg = work.getContext('2d');
      if (st.doc.sel) { st.doc.clipToSel(sg, L); }
      var r = size / 2, stamp = E.mkCanvas(Math.ceil(size) + 2, Math.ceil(size) + 2), tg = stamp.getContext('2d');
      var cx = stamp.width / 2, gr = tg.createRadialGradient(cx, cx, 0, cx, cx, r);
      gr.addColorStop(0, erase ? '#000' : color); gr.addColorStop(Math.min(.99, hard), erase ? '#000' : color); gr.addColorStop(1, hexA(erase ? '#000000' : color, 0));
      tg.fillStyle = gr; tg.beginPath(); tg.arc(cx, cx, r, 0, Math.PI * 2); tg.fill();
      var last = null, spacing = Math.max(1, size * 0.12);
      function dab(x, y) { sg.drawImage(stamp, x - L.x - cx, y - L.y - cx); }
      function to(q) {
        if (!last) { dab(q.x, q.y); last = q; return; }
        var dx = q.x - last.x, dy = q.y - last.y, dist = Math.hypot(dx, dy); if (dist < spacing) return;
        var n = Math.floor(dist / spacing);
        for (var i = 1; i <= n; i++) dab(last.x + dx * i / n, last.y + dy * i / n);
        last = q;
      }
      function update() {
        wg.globalCompositeOperation = 'copy'; wg.globalAlpha = 1; wg.drawImage(base, 0, 0);
        wg.globalCompositeOperation = erase ? 'destination-out' : 'source-over'; wg.globalAlpha = alpha; wg.drawImage(stroke, 0, 0);
        wg.globalCompositeOperation = 'source-over'; wg.globalAlpha = 1;
        live = { layer: L, canvas: work }; render();
      }
      to(p); update();
      return {
        move: function (q, ev) {
          var list = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [];
          if (!list.length) list = [ev];
          list.forEach(function (ce) { to(toDoc(ce)); });
          update();
        },
        up: function () { L.canvas = E.clone(work); live = null; commit(erase ? 'ممحاة' : 'فرشاة', erase ? 'eraser' : 'brush'); }
      };
    }

    /* ---- crop helpers ---- */
    function constrainCrop(k) {
      var r = st.o.cropRatio; if (r === 'free' || !crop) return;
      var ratio = Number(r); if (!(ratio > 0)) return;
      var w = crop.w, h = crop.h;
      if (k === 'n' || k === 's') w = h * ratio; else h = w / ratio;
      if (k && /n/.test(k)) crop.y = crop.y + crop.h - h; if (k && /w/.test(k)) crop.x = crop.x + crop.w - w;
      crop.w = w; crop.h = h;
    }
    function applyCrop() {
      if (!st.doc || !crop) return;
      var r = { x: crop.x, y: crop.y, w: crop.w, h: crop.h };
      docOp(function (d) { d.crop(r); }, 'قصّ‖أداة القصّ في المحرّر', 'crop');
      crop = { x: 0, y: 0, w: st.doc.w, h: st.doc.h }; fit();
    }

    /* ---- inline text editor ---- */
    var tedit = null;
    function editText(L, fresh) {
      closeTextEdit();
      var b = st.doc.bounds(L);
      tedit = SL.h('<textarea class="tedit" spellcheck="false"></textarea>');
      tedit.value = L.p.text;
      tedit.style.left = Math.max(4, st.ox + b.x * st.z) + 'px';
      tedit.style.top = Math.max(4, st.oy + (b.y + b.h) * st.z + 8) + 'px';
      tedit.style.width = Math.max(200, b.w * st.z) + 'px';
      stage.appendChild(tedit); tedit.focus(); if (fresh) tedit.select();
      tedit.addEventListener('input', function () { L.p.text = tedit.value || ' '; L.name = (tedit.value.split('\n')[0] || 'نص').slice(0, 24); render(); });
      tedit.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); closeTextEdit(); }
      });
      tedit.addEventListener('blur', function () { setTimeout(closeTextEdit, 0); });
      tedit._layer = L; tedit._orig = L.p.text;
    }
    function closeTextEdit() {
      if (!tedit) return; var t = tedit; tedit = null;
      if (t._layer.p.text !== t._orig) commit('تحرير النص', 'text');
      t.remove();
    }

    /* ======================= commands ======================= */
    function commit(label, icon) { if (!st.doc) return; st.doc.commit(label, icon); }
    function canUndo() { return st.doc && st.doc.hIndex > 0; }
    function canRedo() { return st.doc && st.doc.hIndex < st.doc.history.length - 1; }
    function undo() { if (adj) cancelAdj(); if (canUndo()) st.doc.undo(); }
    function redo() { if (canRedo()) st.doc.redo(); }
    function docOp(fn, label, icon) { if (!st.doc) return; fn(st.doc); commit(label, icon); fit(); }
    function afterSelect() {
      boxCache.key = '';
      var L = st.doc.active;
      if (L && L.kind === 'text' && st.tool !== 'text' && st.tool !== 'move') setTool('move');
      paintPane(); drawOverlay();
    }
    function setTool(id) {
      closeTextEdit(); if (adj && id !== st.tool) { /* keep adjustments open */ }
      st.tool = id; saveOpts();
      [].forEach.call(toolsEl.querySelectorAll('button[data-tool]'), function (b) { b.classList.toggle('on', b.dataset.tool === id); b.setAttribute('aria-pressed', b.dataset.tool === id); });
      if (id === 'crop' && st.doc && !crop) crop = { x: 0, y: 0, w: st.doc.w, h: st.doc.h };
      paintOpts(); drawOverlay(); paintStatus();
    }
    function newLayer() { if (!st.doc) return; st.doc.addRaster(); commit('طبقة جديدة', 'plus'); }
    function dupLayer() { if (!st.doc) return; st.doc.duplicate(st.doc.active); commit('نسخ الطبقة', 'duplicate'); }
    function delLayer() { if (st.doc && st.doc.remove(st.doc.active)) commit('حذف الطبقة', 'trash'); }
    function mergeDown() { if (st.doc && st.doc.mergeDown(st.doc.active)) commit('دمج للأسفل', 'merge'); }
    function rasterizeActive() { if (!st.doc) return; st.doc.rasterize(st.doc.active); commit('تحويل إلى بكسلات', 'grid'); }
    function moveLayer(dir) { if (st.doc && st.doc.move(st.doc.active, dir)) commit(dir > 0 ? 'رفع الطبقة' : 'خفض الطبقة', dir > 0 ? 'up' : 'down'); }
    function selectAll() { if (!st.doc) return; st.doc.selectAll(); commit('تحديد الكل', 'select'); }
    function deselect() { if (st.doc && st.doc.sel) { st.doc.sel = null; commit('إلغاء التحديد', 'close'); } }
    function clearSel() { if (st.doc && st.doc.clearSel(st.doc.active)) commit('مسح', 'trash'); }
    function fillFg() { if (!st.doc) return; st.doc.fillSel(st.doc.active, st.fg); commit('تعبئة', 'fill'); }
    function cropToSel() { if (!st.doc || !st.doc.sel) return; var s = st.doc.sel; docOp(function (d) { d.crop(s); }, 'قصّ إلى التحديد', 'crop'); }
    function copySel() { if (st.doc) SL.copyCanvas(st.doc.selectionCanvas()); }
    function alignActive(axis) {
      var L = st.doc && st.doc.active, b = L && activeBox(); if (!b) return;
      var s = snapshotPos(L);
      setPos(L, s, axis === 'h' ? (st.doc.w - b.w) / 2 - b.x : 0, axis === 'v' ? (st.doc.h - b.h) / 2 - b.y : 0);
      commit('محاذاة', 'fit');
    }
    function addImageLayer(cv, name) {
      var d = st.doc, c = E.mkCanvas(d.w, d.h), k = Math.min(1, d.w / cv.width, d.h / cv.height);
      var w = cv.width * k, h = cv.height * k; c.getContext('2d').drawImage(cv, (d.w - w) / 2, (d.h - h) / 2, w, h);
      d.addRaster(SL.base(name || 'صورة').slice(0, 30), c); commit('إضافة صورة كطبقة', 'image');
    }
    function pasteFromClipboard() {
      if (!navigator.clipboard || !navigator.clipboard.read) { SL.toast('استخدم Ctrl+V للّصق', 'paste'); return; }
      navigator.clipboard.read().then(function (items) {
        for (var i = 0; i < items.length; i++) {
          var t = items[i].types.filter(function (x) { return x.indexOf('image/') === 0; })[0];
          if (t) return items[i].getType(t).then(function (b) { return SL.fileToCanvas(b); }).then(function (cv) { addImageLayer(cv, 'لصق'); });
        }
        SL.toast('لا توجد صورة في الحافظة', 'paste', true);
      }).catch(function () { SL.toast('استخدم Ctrl+V للّصق', 'paste'); });
    }
    function openFile() { SL.pickFiles('image/*').then(function (f) { if (f[0]) SL.fileToCanvas(f[0]).then(function (cv) { loadCanvas(cv, f[0].name); }); }); }
    function openAsLayer() { SL.pickFiles('image/*', true).then(function (fs) { fs.forEach(function (f) { SL.fileToCanvas(f).then(function (cv) { addImageLayer(cv, f.name); }); }); }); }
    var fromEditor = false;
    function sendToStudio() { fromEditor = true; SL.setDoc(st.doc.flat(), st.name.replace(/\.[^.]+$/, '') + '-edited.png'); fromEditor = false; SL.toast('أصبحت الصورة متاحة لكل أدوات الاستوديو', 'sparkles'); }

    function loadCanvas(cv, name) {
      var w = cv.width, h = cv.height, k = Math.min(1, E.MAX_DIM / Math.max(w, h));
      var d = new E.Doc(Math.round(w * k), Math.round(h * k));
      d.active.canvas.getContext('2d').drawImage(cv, 0, 0, d.w, d.h);
      setDoc(d, name || 'image.png');
    }
    function setDoc(d, name) {
      closeTextEdit(); adj = null; crop = null;
      st.doc = d; st.name = name; st.fitted = false;
      d.on(function (what) {
        if (what === 'commit' || what === 'history') { boxCache.key = ''; render(); paintPane(); paintStatus(); syncUndo(); }
      });
      d.commit('فتح', 'open');
      var empty = stage.querySelector('.empty-ed'); if (empty) empty.remove();
      checkbg.hidden = false;
      if (stage.clientWidth) { st.fitted = true; fit(); }
      render(); paintPane(); setTool(st.tool);
    }
    function syncUndo() { bUndo.disabled = !canUndo(); bRedo.disabled = !canRedo(); bExport.disabled = !st.doc; }

    /* ======================= dialogs ======================= */
    function modal(title, icon, body, okLabel) {
      return new Promise(function (res) {
        var back = SL.h('<div class="modal-back"><div class="modal" role="dialog" aria-modal="true"><h3>' + I(icon) + '<span></span></h3><div class="mb"></div><div class="row end"></div></div></div>');
        back.querySelector('h3 span').textContent = SL.t(title); back.querySelector('.mb').appendChild(body);
        var row = back.querySelector('.row');
        var close = function (v) { back.remove(); document.removeEventListener('keydown', key, true); res(v); };
        row.appendChild(SL.button('إلغاء', 'close', '', function () { close(false); }));
        row.appendChild(SL.button(okLabel || 'موافق', 'check', 'pri', function () { close(true); }));
        var key = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(false); } if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.stopPropagation(); e.preventDefault(); close(true); } };
        document.addEventListener('keydown', key, true);
        back.addEventListener('click', function (e) { if (e.target === back) close(false); });
        document.body.appendChild(back);
        var f = back.querySelector('input, select'); if (f) f.focus();
      });
    }
    function numField(label, v) { var f = SL.h('<div class="field"><label></label><input class="in num" type="number" min="1" max="8000"></div>'); f.querySelector('label').textContent = label; f.querySelector('input').value = v; return f; }

    function newDocDialog() {
      var body = SL.h('<div class="stack"><div class="presetrow"></div><div class="grid"></div><div class="field"><label>الخلفية</label></div></div>');
      var w = numField('العرض (px)', 1080), h = numField('الارتفاع (px)', 1080), bgMode = 'white';
      body.querySelector('.grid').appendChild(w); body.querySelector('.grid').appendChild(h);
      [['منشور مربع', 1080, 1080], ['منشور عمودي', 1080, 1350], ['ستوري', 1080, 1920], ['Full HD', 1920, 1080], ['صورة يوتيوب', 1280, 720], ['A4', 2480, 3508]].forEach(function (p) {
        body.querySelector('.presetrow').appendChild(SL.button(p[0], 'canvas', 'sm', function () { w.querySelector('input').value = p[1]; h.querySelector('input').value = p[2]; }));
      });
      body.querySelector('.field:last-child').appendChild(SL.seg([['white', 'أبيض'], ['transparent', 'شفّاف'], ['fg', 'اللون الأمامي']], bgMode, function (v) { bgMode = v; }));
      modal('مستند جديد', 'plus', body, 'إنشاء').then(function (ok) {
        if (!ok) return;
        var W = clampDim(w.querySelector('input').value), H = clampDim(h.querySelector('input').value);
        setDoc(new E.Doc(W, H, bgMode === 'white' ? '#ffffff' : bgMode === 'fg' ? st.fg : null), 'untitled-' + SL.stamp() + '.png');
      });
    }
    function clampDim(v) { return Math.max(1, Math.min(E.MAX_DIM, Math.round(Number(v) || 1))); }
    function imageSizeDialog() {
      var d = st.doc, lock = true, body = SL.h('<div class="stack"><div class="grid"></div><label class="check"><input type="checkbox" class="sw" checked><span>الحفاظ على النسبة</span></label><div class="presetrow"></div></div>');
      var w = numField('العرض (px)', d.w), h = numField('الارتفاع (px)', d.h), wi = w.querySelector('input'), hi = h.querySelector('input');
      body.querySelector('.grid').appendChild(w); body.querySelector('.grid').appendChild(h);
      body.querySelector('.sw').addEventListener('change', function (e) { lock = e.target.checked; });
      wi.addEventListener('input', function () { if (lock) hi.value = Math.round(wi.value * d.h / d.w); });
      hi.addEventListener('input', function () { if (lock) wi.value = Math.round(hi.value * d.w / d.h); });
      [25, 50, 75, 150, 200].forEach(function (p) { body.querySelector('.presetrow').appendChild(SL.button(SL.pct(p), '', 'sm', function () { wi.value = Math.round(d.w * p / 100); hi.value = Math.round(d.h * p / 100); })); });
      modal('حجم الصورة', 'resize', body, 'تطبيق').then(function (ok) { if (ok) docOp(function (dd) { dd.resize(clampDim(wi.value), clampDim(hi.value)); }, 'حجم الصورة', 'resize'); });
    }
    function canvasSizeDialog() {
      var d = st.doc, ax = .5, ay = .5, body = SL.h('<div class="stack"><div class="grid"></div><div class="field"><label>موضع الصورة</label><div class="anchor"></div></div></div>');
      var w = numField('العرض (px)', d.w), h = numField('الارتفاع (px)', d.h);
      body.querySelector('.grid').appendChild(w); body.querySelector('.grid').appendChild(h);
      var an = body.querySelector('.anchor');
      [0, .5, 1].forEach(function (yy) { [0, .5, 1].forEach(function (xx) {
        var b = SL.h('<button type="button"></button>'); b.classList.toggle('on', xx === .5 && yy === .5);
        b.addEventListener('click', function () { ax = xx; ay = yy; [].forEach.call(an.children, function (c) { c.classList.remove('on'); }); b.classList.add('on'); });
        an.appendChild(b);
      }); });
      modal('حجم اللوحة', 'canvas', body, 'تطبيق').then(function (ok) { if (ok) docOp(function (dd) { dd.canvasSize(clampDim(w.querySelector('input').value), clampDim(h.querySelector('input').value), ax, ay); }, 'حجم اللوحة', 'canvas'); });
    }
    function exportDialog() {
      if (!st.doc) return;
      var fmt = SL.LS.get('ed_exp', 'png'), q = 90, scale = 100;
      var body = SL.h('<div class="stack"><div class="field"><label>الصيغة</label></div><div class="qf"></div><div class="sf"></div><div class="saving" style="justify-content:space-between"><span>الحجم المتوقّع</span><b class="num">…</b></div></div>');
      body.querySelector('.field').appendChild(SL.seg([['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']], fmt, function (v) { fmt = v; qf.hidden = v === 'png'; est(); }));
      var qf = SL.slider('الجودة', 40, 100, 1, q, '٪', function (v) { q = v; est(); }); body.querySelector('.qf').appendChild(qf); qf.hidden = fmt === 'png';
      body.querySelector('.sf').appendChild(SL.slider('المقاس', 10, 200, 5, scale, '٪', function (v) { scale = v; est(); }));
      var out = body.querySelector('b'), eT = 0;
      function render2() {
        var f = st.doc.flat(); if (scale === 100) return f;
        var c = E.mkCanvas(f.width * scale / 100, f.height * scale / 100), g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(f, 0, 0, c.width, c.height); return c;
      }
      function flatFor(c) { if (fmt !== 'jpeg') return c; var o = E.mkCanvas(c.width, c.height), g = o.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, o.width, o.height); g.drawImage(c, 0, 0); return o; }
      function est() { clearTimeout(eT); out.textContent = '…'; eT = setTimeout(function () { var c = flatFor(render2()); SL.toBlob(c, 'image/' + fmt, q / 100).then(function (b) { out.textContent = SL.fmtBytes(b.size) + ' · ' + c.width + '×' + c.height; }); }, 250); }
      est();
      modal('تصدير الصورة', 'download', body, 'تنزيل').then(function (ok) {
        if (!ok) return; SL.LS.set('ed_exp', fmt);
        var c = flatFor(render2());
        SL.toBlob(c, 'image/' + fmt, q / 100).then(function (b) { SL.download(b, SL.base(st.name) + '.' + (fmt === 'jpeg' ? 'jpg' : fmt)); SL.toast(SL.t('حُفظت الصورة · {0}', SL.fmtBytes(b.size)), 'check'); });
      });
    }

    /* ======================= status bar ======================= */
    var statusEl = root.querySelector('#status');
    function paintStatus(p) {
      if (!st.doc) { statusEl.textContent = ''; return; }
      if (!statusEl.firstChild) {
        statusEl.appendChild(SL.h('<span><b data-s="size" class="num"></b></span>'));
        statusEl.appendChild(SL.h('<span data-s="pos" class="num"></span>'));
        statusEl.appendChild(SL.h('<span data-s="layer"></span>'));
        statusEl.appendChild(SL.h('<span class="sp"></span>'));
        var zb = SL.h('<span class="zoombox"><button type="button" data-z="out" title="تصغير">' + I('zoomOut') + '</button><b class="num" data-s="zoom"></b><button type="button" data-z="in" title="تكبير">' + I('zoom') + '</button><button type="button" data-z="fit" title="ملاءمة">' + I('fit') + '</button></span>');
        zb.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; if (b.dataset.z === 'in') zoomBy(1.25); else if (b.dataset.z === 'out') zoomBy(0.8); else fit(); });
        statusEl.appendChild(zb);
      }
      statusEl.querySelector('[data-s=size]').textContent = st.doc.w + ' × ' + st.doc.h + ' px';
      if (p) statusEl.querySelector('[data-s=pos]').textContent = 'X ' + Math.round(p.x) + ' · Y ' + Math.round(p.y);
      statusEl.querySelector('[data-s=layer]').textContent = SL.t('الطبقة: {0} · {1} طبقات', st.doc.active ? st.doc.active.name : '—', st.doc.layers.length);
      statusEl.querySelector('[data-s=zoom]').textContent = SL.pct(st.z * 100);
    }

    /* ======================= keyboard ======================= */
    function onKey(e) {
      if (!root.isConnected) return;
      var tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag) || document.querySelector('.modal-back')) return;
      var k = e.key, mod = e.ctrlKey || e.metaKey;
      if (k === ' ') { if (!st.space) { st.space = true; stage.style.cursor = 'grab'; } e.preventDefault(); return; }
      if (mod) {
        var lk = k.toLowerCase();
        if (lk === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
        else if ((lk === 'z' && e.shiftKey) || lk === 'y') { e.preventDefault(); redo(); }
        else if (lk === 'a') { e.preventDefault(); selectAll(); }
        else if (lk === 'd') { e.preventDefault(); deselect(); }
        else if (lk === 'j') { e.preventDefault(); dupLayer(); }
        else if (lk === 'e') { e.preventDefault(); mergeDown(); }
        else if (lk === 's') { e.preventDefault(); exportDialog(); }
        else if (lk === 'o') { e.preventDefault(); openFile(); }
        else if (lk === 'n' && e.shiftKey) { e.preventDefault(); newLayer(); }
        else if (lk === 'n') { e.preventDefault(); newDocDialog(); }
        else if (lk === 'c' && !e.shiftKey && st.doc) { e.preventDefault(); copySel(); }
        else if (lk === 'c' && e.shiftKey && st.doc) { e.preventDefault(); SL.copyCanvas(st.doc.flat()); }
        else if (k === '0') { e.preventDefault(); fit(); }
        else if (k === '1') { e.preventDefault(); zoomTo(1); }
        else if (k === '=' || k === '+') { e.preventDefault(); zoomBy(1.25); }
        else if (k === '-') { e.preventDefault(); zoomBy(0.8); }
        else if (k === ']') { e.preventDefault(); moveLayer(1); }
        else if (k === '[') { e.preventDefault(); moveLayer(-1); }
        return;
      }
      if (k === 'Delete' || k === 'Backspace') { if (e.altKey) fillFg(); else clearSel(); e.preventDefault(); return; }
      if (k === 'Enter' && st.tool === 'crop') { applyCrop(); return; }
      if (k === 'Escape') { if (st.tool === 'crop' && st.doc) { crop = { x: 0, y: 0, w: st.doc.w, h: st.doc.h }; drawOverlay(); } else deselect(); return; }
      if (k === '[' || k === ']') {
        var key = st.tool === 'eraser' ? 'eraseSize' : 'brushSize', f = k === ']' ? 1.2 : 1 / 1.2;
        st.o[key] = Math.max(1, Math.min(400, Math.round(st.o[key] * f + (k === ']' ? 1 : -1)))); saveOpts(); paintOpts(); drawOverlay(); return;
      }
      if (st.tool === 'move' && /^Arrow/.test(k) && st.doc && st.doc.active) {
        e.preventDefault(); var s = snapshotPos(st.doc.active), n = e.shiftKey ? 10 : 1;
        setPos(st.doc.active, s, k === 'ArrowLeft' ? -n : k === 'ArrowRight' ? n : 0, k === 'ArrowUp' ? -n : k === 'ArrowDown' ? n : 0);
        debCommit('تحريك', 'move'); boxCache.key = ''; render(); return;
      }
      if (k.toLowerCase() === 'x') { swapColors(); return; }
      var t = TOOLS.filter(function (x) { return x !== '-' && x.key.toLowerCase() === k.toLowerCase(); })[0];
      if (t) setTool(t.id);
    }
    function onKeyUp(e) { if (e.key === ' ') { st.space = false; stage.style.cursor = ''; } }
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKeyUp);

    /* paste = a new layer while a document is open (capture: the app would open a new doc) */
    function onPaste(e) {
      if (!st.doc || !root.isConnected) return;
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) if (items[i].type.indexOf('image/') === 0) {
        var f = items[i].getAsFile(); if (!f) continue;
        e.preventDefault(); e.stopImmediatePropagation();
        SL.fileToCanvas(f).then(function (cv) { addImageLayer(cv, 'لصق'); }); return;
      }
    }
    document.addEventListener('paste', onPaste, true);

    /* ======================= start ======================= */
    var unsub = SL.onDoc(function (d) { if (!fromEditor) loadCanvas(d.canvas, d.name); });
    var empty = SL.h('<div class="empty-ed"></div>');
    var dz = SL.dropzone({ title: 'افتح صورة للبدء', hint: 'اسحب صورة هنا أو انقر للاختيار · Ctrl+V للّصق · Ctrl+N لمستند جديد', icon: 'image',
      onFiles: function (fs) { SL.fileToCanvas(fs[0]).then(function (cv) { loadCanvas(cv, fs[0].name); }); } });
    var nd = SL.button('مستند جديد', 'plus', '', function (e) { e.stopPropagation(); newDocDialog(); });
    dz.appendChild(nd);
    empty.appendChild(dz); stage.appendChild(empty); checkbg.hidden = true;
    if (SL.doc()) loadCanvas(SL.doc().canvas, SL.doc().name);
    showTab('layers'); setTool(st.tool); syncUndo();

    return function () {
      clearInterval(antsT); ro.disconnect(); unsub();
      document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('paste', onPaste, true); document.removeEventListener('click', docClick);
    };
  }

  SL.tools.push({ id: 'editor', group: 'edit', label: 'المحرر الاحترافي', icon: 'editor', badge: 'Pro', full: true, mount: mount,
    desc: 'طبقات · فرش · تحديد · قصّ · نصوص · أشكال · فلاتر · سجلّ' });
}());
