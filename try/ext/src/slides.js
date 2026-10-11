/* SYF — PowerPoint viewer/editor (slides.html).
 *
 * Opens a .pptx, shows every slide, lets you edit its text, add/delete/reorder
 * slides, then writes a fresh .pptx back out. No library: a .pptx is a ZIP of XML,
 * and imgkit.js owns both halves (zipWrite + zipRead, the latter added with the
 * Word tool). Same reasoning as word.js — every candidate reader either fails MV3's
 * CSP or would hand us an HTML string built from the file's own bytes.
 *
 * ⚠️ THE ONE LIMIT THE USER MUST KNOW, AND WE SAY IT UP FRONT:
 * we read the TEXT and the IMAGES, not the DESIGN. The slide master, layouts,
 * theme fonts, gradients, SmartArt, charts, animations and transitions are NOT
 * preserved; the export rebuilds clean slides. This is a text/content editor for
 * decks, not a fidelity-preserving PowerPoint clone.
 *
 * SECURITY:
 *   1. Slide text is HOSTILE — textContent only, never innerHTML with file data.
 *   2. Embedded images are whitelisted to raster types. An .svg is never rendered
 *      (script container), and an external image target is never fetched.
 *   3. The deck is never persisted (no storage/IndexedDB/network) — tab memory
 *      only, with a beforeunload warning. */
(function () {
  'use strict';

  var MAX_BYTES = 50 * 1024 * 1024;                  /* decks carry images */
  var IK = (window.SYFS && window.SYFS.imgkit) || null;

  var P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  var A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  var R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var PKG_R = 'http://schemas.openxmlformats.org/package/2006/relationships';
  var REL_SLIDE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
  var REL_NOTES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';

  var IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

  /* 16:9 deck, in EMU (1 inch = 914400) */
  var SLIDE_W = 12192000, SLIDE_H = 6858000;
  var MARGIN = 685800;
  var TITLE_Y = 457200, TITLE_H = 1143000;
  var BODY_Y = 1828800, BODY_H = 4419600;
  var CONTENT_W = SLIDE_W - 2 * MARGIN;

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  ['open', 'file', 'drop', 'stage', 'strip', 'canvas', 'title', 'body', 'notes', 'stats',
   'dirty', 'toast', 'add', 'dup', 'del', 'img', 'img-file', 'present', 'exp-pptx',
   'exp-pdf', 'exp-png', 'fname', 'start', 'warn'].forEach(function (id) {
    el[id.replace(/-(\w)/g, function (m, c) { return c.toUpperCase(); })] = $(id);
  });

  /* slide = { title, blocks: [{type:'bullets', items:[str]} | {type:'image', url}], notes } */
  var deck = [];
  var cur = 0;
  var fileName = 'presentation.pptx';
  var dirty = false;
  var objectUrls = [];

  function toast(msg, bad) {
    el.toast.textContent = msg;
    el.toast.classList.toggle('bad', !!bad);
    el.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.classList.remove('show'); }, bad ? 5600 : 2400);
  }
  function markDirty() { dirty = true; el.dirty.textContent = SYFS.t('● غير مصدَّر'); }
  function extOf(n) { var m = /\.([a-z0-9]+)$/i.exec(String(n || '')); return m ? m[1].toLowerCase() : ''; }
  function baseName(n) { return String(n || 'presentation').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'presentation'; }
  function mimeOfExt(e) { return IMG_MIME[String(e || '').toLowerCase()] || null; }
  /* XML 1.0 forbids C0 controls (bar TAB/LF/CR), U+FFFE/U+FFFF and unpaired
     surrogates — escaping does not make them legal, and PowerPoint then refuses the
     file or offers to «repair» it (v0.139.3) */
  var XML_BAD = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
  function xmlEsc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(XML_BAD, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  /* ===================== READ ===================== */
  function td(b) { return b ? new TextDecoder('utf-8').decode(b) : ''; }
  function parseXml(text) {
    var d = new DOMParser().parseFromString(text, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('bad-xml');
    return d;
  }
  function kids(node, ns, name) {
    var out = [];
    for (var i = 0; i < node.childNodes.length; i++) {
      var c = node.childNodes[i];
      if (c.nodeType === 1 && c.namespaceURI === ns && c.localName === name) out.push(c);
    }
    return out;
  }
  /* rels of a part: { rId: { target, type } }, with the target resolved against the
     part's own folder. An External target is dropped — opening a deck must never
     make a network request. */
  function parseRels(xmlText, baseDir) {
    var map = Object.create(null);
    if (!xmlText) return map;
    var rels = parseXml(xmlText).getElementsByTagNameNS(PKG_R, 'Relationship');
    for (var i = 0; i < rels.length; i++) {
      var id = rels[i].getAttribute('Id');
      var t = rels[i].getAttribute('Target');
      var type = rels[i].getAttribute('Type');
      if (!id || !t) continue;
      if (rels[i].getAttribute('TargetMode') === 'External') continue;
      map[id] = { target: resolvePath(baseDir, t), type: type };
    }
    return map;
  }
  /* "../media/image1.png" relative to "ppt/slides" -> "ppt/media/image1.png" */
  function resolvePath(baseDir, target) {
    if (target.charAt(0) === '/') return target.replace(/^\/+/, '');
    var parts = (baseDir ? baseDir.split('/') : []);
    target.split('/').forEach(function (seg) {
      if (seg === '.' || seg === '') return;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    });
    return parts.join('/');
  }
  function mediaUrl(zip, path) {
    var bytes = zip[path];
    if (!bytes) return null;
    var mime = mimeOfExt(extOf(path));
    if (!mime) return null;                            /* .svg and friends: never rendered */
    var url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    objectUrls.push(url);
    return url;
  }
  /* all the text of one <a:p>, runs joined */
  function paraText(ap) {
    var ts = ap.getElementsByTagNameNS(A, 't');
    var s = '';
    for (var i = 0; i < ts.length; i++) s += ts[i].textContent;
    return s;
  }
  function shapeParas(sp) {
    var tx = sp.getElementsByTagNameNS(P, 'txBody')[0];
    if (!tx) return [];
    var out = [];
    kids(tx, A, 'p').forEach(function (ap) {
      var t = paraText(ap);
      out.push(t);                                     /* keep empty paragraphs: they are blank lines */
    });
    while (out.length && !out[out.length - 1].trim()) out.pop();
    return out;
  }
  function isTitle(sp) {
    var phs = sp.getElementsByTagNameNS(P, 'ph');
    for (var i = 0; i < phs.length; i++) {
      var t = phs[i].getAttribute('type');
      if (t === 'title' || t === 'ctrTitle') return true;
    }
    return false;
  }
  function readSlide(zip, path) {
    var xml = td(zip[path]);
    if (!xml) return null;
    var dir = path.split('/').slice(0, -1).join('/');
    var relPath = dir + '/_rels/' + path.split('/').pop() + '.rels';
    var rels = parseRels(td(zip[relPath]), dir);
    var doc = parseXml(xml);
    var tree = doc.getElementsByTagNameNS(P, 'spTree')[0];
    var slide = { title: '', blocks: [], notes: '' };
    if (!tree) return slide;

    for (var i = 0; i < tree.childNodes.length; i++) {
      var n = tree.childNodes[i];
      if (n.nodeType !== 1 || n.namespaceURI !== P) continue;
      if (n.localName === 'sp') {
        var lines = shapeParas(n);
        if (!lines.length) continue;
        if (isTitle(n) && !slide.title) { slide.title = lines.join(' ').trim(); continue; }
        slide.blocks.push({ type: 'bullets', items: lines });
      } else if (n.localName === 'pic') {
        var blip = n.getElementsByTagNameNS(A, 'blip')[0];
        var rid = blip ? blip.getAttributeNS(R, 'embed') : null;
        var rel = rid ? rels[rid] : null;
        var url = rel ? mediaUrl(zip, rel.target) : null;
        if (url) slide.blocks.push({ type: 'image', url: url });
      }
      /* p:graphicFrame (charts, SmartArt, tables) is deliberately skipped — see the
         header: we do not pretend to preserve a design we cannot rebuild. */
    }
    /* speaker notes */
    Object.keys(rels).forEach(function (rid) {
      if (rels[rid].type !== REL_NOTES) return;
      var nx = td(zip[rels[rid].target]);
      if (!nx) return;
      try {
        var nd = parseXml(nx);
        var sps = nd.getElementsByTagNameNS(P, 'sp');
        var txt = [];
        for (var j = 0; j < sps.length; j++) {
          if (isTitle(sps[j])) continue;
          var phs = sps[j].getElementsByTagNameNS(P, 'ph');
          var isBody = false;
          for (var k = 0; k < phs.length; k++) if (phs[k].getAttribute('type') === 'body') isBody = true;
          if (!isBody) continue;
          shapeParas(sps[j]).forEach(function (l) { txt.push(l); });
        }
        slide.notes = txt.join('\n').trim();
      } catch (e) { /* a broken notes part must not sink the deck */ }
    });
    return slide;
  }
  /* slide order comes from presentation.xml's sldIdLst, NOT from the file names —
     slide12.xml can legitimately be the second slide. */
  function slidePaths(zip) {
    var pres = td(zip['ppt/presentation.xml']);
    var rels = parseRels(td(zip['ppt/_rels/presentation.xml.rels']), 'ppt');
    if (!pres) return [];
    var doc = parseXml(pres);
    var ids = doc.getElementsByTagNameNS(P, 'sldId');
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      var rid = ids[i].getAttributeNS(R, 'id');
      var rel = rid ? rels[rid] : null;
      if (rel && rel.type === REL_SLIDE) out.push(rel.target);
    }
    return out;
  }

  async function readFile(file) {
    if (!file) return;
    if (extOf(file.name) === 'ppt') {
      toast(SYFS.t('صيغة .ppt القديمة (PowerPoint 97-2003) غير مدعومة — لا يوجد قارئ لها في المتصفّح. احفظ الملف كـ .pptx ثم أعد المحاولة.'), true);
      return;
    }
    if (extOf(file.name) !== 'pptx') { toast(SYFS.t('اختر ملف .pptx'), true); return; }
    if (file.size > MAX_BYTES) { toast(SYFS.t('الملف أكبر من 50 م.ب.'), true); return; }
    if (!IK || !IK.zipRead) { toast(SYFS.t('محرّك الملفات غير محمَّل.'), true); return; }

    try {
      var zip = await IK.zipRead(file);
      var paths = slidePaths(zip);
      if (!paths.length) throw new Error('no-slides');

      objectUrls.forEach(function (u) { URL.revokeObjectURL(u); });
      objectUrls = [];

      var out = [];
      paths.forEach(function (p) {
        var s = readSlide(zip, p);
        if (s) out.push(s);
      });
      if (!out.length) throw new Error('empty');

      deck = out;
      cur = 0;
      fileName = file.name;
      /* i18n-dyn: the user's own file name */
      el.fname.textContent = file.name;
      show();
      dirty = false; el.dirty.textContent = '';
      renderAll();
      toast(SYFS.t('فُتح العرض — {0} شريحة ✓', deck.length));
    } catch (e) {
      toast(SYFS.t('تعذّرت قراءة الملف. تأكّد أنه .pptx سليم غير محمي بكلمة مرور.'), true);
    }
  }

  /* ===================== the editor ===================== */
  function blank(kind) {
    if (kind === 'bullets') return { title: 'عنوان الشريحة', blocks: [{ type: 'bullets', items: ['النقطة الأولى', 'النقطة الثانية'] }], notes: '' };
    if (kind === 'title') return { title: 'عنوان العرض', blocks: [{ type: 'bullets', items: ['عنوان فرعي'] }], notes: '' };
    return { title: '', blocks: [{ type: 'bullets', items: [''] }], notes: '' };
  }
  /* pull the DOM back into the model — the canvas is the source of truth while a
     slide is on screen, so this runs before every switch, add, delete and export */
  function harvest() {
    var s = deck[cur];
    if (!s) return;
    s.title = (el.title.textContent || '').trim();
    s.notes = el.notes.value || '';
    var blocks = [];
    Array.prototype.forEach.call(el.body.children, function (node) {
      if (node.tagName === 'UL') {
        var items = [];
        Array.prototype.forEach.call(node.children, function (li) { items.push(li.textContent || ''); });
        while (items.length && !items[items.length - 1].trim()) items.pop();
        if (items.length) blocks.push({ type: 'bullets', items: items });
      } else if (node.tagName === 'FIGURE') {
        var img = node.querySelector('img');
        if (img) blocks.push({ type: 'image', url: img.src });
      }
    });
    if (!blocks.length) blocks.push({ type: 'bullets', items: [''] });
    s.blocks = blocks;
  }
  function renderCanvas() {
    var s = deck[cur];
    if (!s) return;
    el.title.textContent = s.title;                    /* ⚠️ textContent — slide text is file data */
    el.body.textContent = '';
    s.blocks.forEach(function (b) {
      if (b.type === 'bullets') {
        var ul = document.createElement('ul');
        ul.contentEditable = 'true';
        b.items.forEach(function (it) {
          var li = document.createElement('li');
          li.textContent = it;
          ul.appendChild(li);
        });
        el.body.appendChild(ul);
      } else if (b.type === 'image') {
        var fig = document.createElement('figure');
        var img = document.createElement('img');
        img.src = b.url;
        img.alt = '';
        var x = document.createElement('button');
        x.className = 'imgx';
        x.type = 'button';
        x.textContent = '✕';
        x.title = SYFS.t('حذف الصورة');
        x.addEventListener('click', function () { fig.remove(); harvest(); renderStrip(); markDirty(); });
        fig.appendChild(img);
        fig.appendChild(x);
        el.body.appendChild(fig);
      }
    });
    el.notes.value = s.notes || '';
    el.stats.textContent = SYFS.t('شريحة {0} من {1}', cur + 1, deck.length);
  }
  function renderStrip() {
    el.strip.textContent = '';
    deck.forEach(function (s, i) {
      var b = document.createElement('button');
      b.className = 'thumb' + (i === cur ? ' on' : '');
      b.type = 'button';
      b.draggable = true;
      b.dataset.i = String(i);

      var n = document.createElement('span');
      n.className = 'tn';
      n.textContent = String(i + 1);
      var t = document.createElement('span');
      t.className = 'tt';
      t.textContent = s.title || (s.blocks[0] && s.blocks[0].type === 'bullets' ? (s.blocks[0].items[0] || SYFS.t('بلا عنوان')) : SYFS.t('صورة'));
      var mark = document.createElement('span');
      mark.className = 'tm';
      mark.textContent = s.blocks.some(function (x) { return x.type === 'image'; }) ? '🖼' : '';

      b.appendChild(n); b.appendChild(t); b.appendChild(mark);
      b.addEventListener('click', function () { go(i); });
      b.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', String(i)); });
      b.addEventListener('dragover', function (e) { e.preventDefault(); });
      b.addEventListener('drop', function (e) {
        e.preventDefault(); e.stopPropagation();
        var from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (isNaN(from) || from === i) return;
        harvest();
        var moved = deck.splice(from, 1)[0];
        deck.splice(i, 0, moved);
        cur = i;
        markDirty(); renderAll();
      });
      el.strip.appendChild(b);
    });
  }
  function renderAll() { renderCanvas(); renderStrip(); }
  function go(i) {
    if (i < 0 || i >= deck.length || i === cur) return;
    harvest();
    cur = i;
    renderAll();
  }
  function addSlide(kind) {
    harvest();
    deck.splice(cur + 1, 0, blank(kind || 'bullets'));
    cur = cur + 1;
    markDirty(); renderAll();
  }
  function dupSlide() {
    harvest();
    var s = deck[cur];
    deck.splice(cur + 1, 0, {
      title: s.title,
      blocks: s.blocks.map(function (b) { return b.type === 'bullets' ? { type: 'bullets', items: b.items.slice() } : { type: 'image', url: b.url }; }),
      notes: s.notes
    });
    cur = cur + 1;
    markDirty(); renderAll();
  }
  function delSlide() {
    if (deck.length <= 1) { toast(SYFS.t('لا يمكن حذف الشريحة الوحيدة.'), true); return; }
    deck.splice(cur, 1);
    if (cur >= deck.length) cur = deck.length - 1;
    markDirty(); renderAll();
  }
  async function insertImage(file) {
    if (!file) return;
    if (!mimeOfExt(extOf(file.name))) { toast(SYFS.t('صيغة صورة غير مدعومة (png/jpg/gif/webp/bmp).'), true); return; }
    harvest();
    var url = URL.createObjectURL(file);
    objectUrls.push(url);
    deck[cur].blocks.push({ type: 'image', url: url });
    markDirty(); renderAll();
  }

  /* ===================== WRITE: the model -> .pptx =====================
   * A minimal but VALID package: content types, root rels, presentation + its rels,
   * one slide master, one layout, a theme, and a part per slide. PowerPoint refuses
   * a deck whose parts are not all declared, so every piece here is load-bearing. */
  function txBody(paras) {
    return '<p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>' + paras.join('') + '</p:txBody>';
  }
  function para(text, opts) {
    opts = opts || {};
    var pPr = '<a:pPr algn="r" rtl="1"' + (opts.marL ? ' marL="342900" indent="-342900"' : '') + '>' +
      (opts.bullet ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : '<a:buNone/>') + '</a:pPr>';
    var rPr = '<a:rPr lang="ar-SA" dirty="0"' + (opts.sz ? ' sz="' + opts.sz + '"' : '') + (opts.b ? ' b="1"' : '') + '/>';
    if (!String(text).length) return '<a:p>' + pPr + '<a:endParaRPr lang="ar-SA"/></a:p>';
    return '<a:p>' + pPr + '<a:r>' + rPr + '<a:t>' + xmlEsc(text) + '</a:t></a:r></a:p>';
  }
  function spXml(id, name, x, y, cx, cy, paras, ph) {
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + xmlEsc(name) + '"/>' +
      '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
      '<p:nvPr>' + (ph ? '<p:ph type="' + ph + '"/>' : '') + '</p:nvPr></p:nvSpPr>' +
      '<p:spPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
      txBody(paras) + '</p:sp>';
  }
  function picXml(id, rid, x, y, cx, cy) {
    return '<p:pic><p:nvPicPr><p:cNvPr id="' + id + '" name="Picture ' + id + '"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>' +
      '<p:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
      '<p:spPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
  }
  /* one slide: title on top, the text blocks stacked, the images laid out below */
  function slideXml(slide, media) {
    var shapes = '';
    var id = 2;
    if (slide.title) shapes += spXml(id++, 'Title', MARGIN, TITLE_Y, CONTENT_W, TITLE_H,
      [para(slide.title, { sz: 4000, b: true })], 'title');

    var textParas = [];
    slide.blocks.forEach(function (b) {
      if (b.type !== 'bullets') return;
      b.items.forEach(function (it) { textParas.push(para(it, { sz: 2400, bullet: !!it.trim(), marL: true })); });
    });
    var imgs = slide.blocks.filter(function (b) { return b.type === 'image' && media.byUrl[b.url]; });
    var textH = imgs.length ? Math.round(BODY_H * 0.45) : BODY_H;
    if (textParas.length) shapes += spXml(id++, 'Content', MARGIN, BODY_Y, CONTENT_W, textH, textParas, 'body');

    if (imgs.length) {
      var top = BODY_Y + (textParas.length ? textH + 137160 : 0);
      var avail = SLIDE_H - MARGIN - top;
      if (avail < 914400) avail = 914400;
      var cellW = Math.floor(CONTENT_W / imgs.length) - 91440;
      imgs.forEach(function (b, i) {
        var rec = media.byUrl[b.url];
        var ratio = rec.h && rec.w ? rec.h / rec.w : 0.6;
        var cx = cellW, cy = Math.round(cellW * ratio);
        if (cy > avail) { cy = avail; cx = Math.round(avail / ratio); }
        var x = MARGIN + i * (cellW + 91440) + Math.max(0, Math.floor((cellW - cx) / 2));
        shapes += picXml(id++, rec.rid, x, top, cx, cy);
      });
    }

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sld xmlns:a="' + A + '" xmlns:r="' + R + '" xmlns:p="' + P + '">' +
      '<p:cSld><p:spTree>' +
      '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
      '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
      shapes +
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  }
  function emptyTree() {
    return '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
      '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>' +
      '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';
  }
  function masterXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sldMaster xmlns:a="' + A + '" xmlns:r="' + R + '" xmlns:p="' + P + '">' +
      '<p:cSld>' + emptyTree() + '</p:cSld>' +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3"' +
      ' accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
      '</p:sldMaster>';
  }
  function layoutXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sldLayout xmlns:a="' + A + '" xmlns:r="' + R + '" xmlns:p="' + P + '" type="blank" preserve="1">' +
      '<p:cSld name="Blank">' + emptyTree() + '</p:cSld>' +
      '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
  }
  function themeXml() {
    function fills() {
      return '<a:fillStyleLst>' +
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>';
    }
    function lines() {
      var ln = '<a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
        '<a:prstDash val="solid"/></a:ln>';
      return '<a:lnStyleLst>' + ln + ln + ln + '</a:lnStyleLst>';
    }
    var clr = ['dk1:000000', 'lt1:FFFFFF', 'dk2:44546A', 'lt2:E7E6E6', 'accent1:457364', 'accent2:ED7D31',
      'accent3:A5A5A5', 'accent4:FFC000', 'accent5:5B9BD5', 'accent6:70AD47', 'hlink:0563C1', 'folHlink:954F72']
      .map(function (p2) {
        var k = p2.split(':')[0], v = p2.split(':')[1];
        var inner = (k === 'dk1' || k === 'lt1') ? '<a:sysClr val="' + (k === 'dk1' ? 'windowText' : 'window') + '" lastClr="' + v + '"/>' : '<a:srgbClr val="' + v + '"/>';
        return '<a:' + k + '>' + inner + '</a:' + k + '>';
      }).join('');
    var font = '<a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface="Arial"/>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<a:theme xmlns:a="' + A + '" name="SYF"><a:themeElements>' +
      '<a:clrScheme name="SYF">' + clr + '</a:clrScheme>' +
      '<a:fontScheme name="SYF"><a:majorFont>' + font + '</a:majorFont><a:minorFont>' + font + '</a:minorFont></a:fontScheme>' +
      '<a:fmtScheme name="SYF">' + fills() + lines() +
      '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>' +
      '<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
      fills().replace('fillStyleLst', 'bgFillStyleLst').replace('/a:fillStyleLst', '/a:bgFillStyleLst') +
      '</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
  }
  function presentationXml(n) {
    var ids = '';
    for (var i = 0; i < n; i++) ids += '<p:sldId id="' + (256 + i) + '" r:id="rId' + (2 + i) + '"/>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:presentation xmlns:a="' + A + '" xmlns:r="' + R + '" xmlns:p="' + P + '" rtl="1" saveSubsetFonts="1">' +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      '<p:sldIdLst>' + ids + '</p:sldIdLst>' +
      '<p:sldSz cx="' + SLIDE_W + '" cy="' + SLIDE_H + '"/>' +
      '<p:notesSz cx="' + SLIDE_H + '" cy="' + SLIDE_W + '"/>' +
      '</p:presentation>';
  }
  function presRelsXml(n) {
    var rels = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>';
    for (var i = 0; i < n; i++) {
      rels += '<Relationship Id="rId' + (2 + i) + '" Type="' + REL_SLIDE + '" Target="slides/slide' + (i + 1) + '.xml"/>';
    }
    rels += '<Relationship Id="rId' + (2 + n) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + PKG_R + '">' + rels + '</Relationships>';
  }
  function slideRelsXml(slide, media) {
    var rels = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>';
    slide.blocks.forEach(function (b) {
      if (b.type !== 'image') return;
      var rec = media.byUrl[b.url];
      if (!rec) return;
      rels += '<Relationship Id="' + rec.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/' + rec.file + '"/>';
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + PKG_R + '">' + rels + '</Relationships>';
  }
  function contentTypesXml(n, media) {
    var defs = '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>';
    Object.keys(media.types).forEach(function (ext) {
      defs += '<Default Extension="' + xmlEsc(ext) + '" ContentType="' + xmlEsc(media.types[ext]) + '"/>';
    });
    var ov = '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>';
    for (var i = 1; i <= n; i++) {
      ov += '<Override PartName="/ppt/slides/slide' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + defs + ov + '</Types>';
  }
  function rootRelsXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + PKG_R + '">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
      '</Relationships>';
  }
  function masterRelsXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + PKG_R + '">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>' +
      '</Relationships>';
  }
  function layoutRelsXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + PKG_R + '">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>' +
      '</Relationships>';
  }
  function xmlBlob(s) { return new Blob([s], { type: 'application/xml' }); }

  /* every image used by any slide: bytes + a per-slide relationship id + its size */
  async function collectMedia() {
    var media = { byUrl: Object.create(null), files: [], types: Object.create(null) };
    var n = 0;
    for (var i = 0; i < deck.length; i++) {
      for (var j = 0; j < deck[i].blocks.length; j++) {
        var b = deck[i].blocks[j];
        if (b.type !== 'image' || media.byUrl[b.url]) continue;
        if (!/^blob:|^data:image\//.test(b.url)) continue;      /* never fetch a remote URL */
        try {
          var blob = await (await fetch(b.url)).blob();
          var ext = (blob.type.split('/')[1] || 'png');
          if (!mimeOfExt(ext)) continue;
          n++;
          var dim = await imgSize(b.url);
          media.byUrl[b.url] = { rid: 'rId' + (100 + n), file: 'image' + n + '.' + ext, w: dim.w, h: dim.h };
          media.files.push({ name: 'ppt/media/image' + n + '.' + ext, blob: blob });
          media.types[ext] = blob.type;
        } catch (e) { /* unreadable image: simply not embedded */ }
      }
    }
    return media;
  }
  function imgSize(url) {
    return new Promise(function (res) {
      var im = new Image();
      im.onload = function () { res({ w: im.naturalWidth || 800, h: im.naturalHeight || 600 }); };
      im.onerror = function () { res({ w: 800, h: 600 }); };
      im.src = url;
    });
  }

  async function pptxBlob() {
    harvest();
    var media = await collectMedia();
    var files = [
      { name: '[Content_Types].xml', blob: xmlBlob(contentTypesXml(deck.length, media)) },
      { name: '_rels/.rels', blob: xmlBlob(rootRelsXml()) },
      { name: 'ppt/presentation.xml', blob: xmlBlob(presentationXml(deck.length)) },
      { name: 'ppt/_rels/presentation.xml.rels', blob: xmlBlob(presRelsXml(deck.length)) },
      { name: 'ppt/slideMasters/slideMaster1.xml', blob: xmlBlob(masterXml()) },
      { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', blob: xmlBlob(masterRelsXml()) },
      { name: 'ppt/slideLayouts/slideLayout1.xml', blob: xmlBlob(layoutXml()) },
      { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', blob: xmlBlob(layoutRelsXml()) },
      { name: 'ppt/theme/theme1.xml', blob: xmlBlob(themeXml()) }
    ];
    deck.forEach(function (s, i) {
      files.push({ name: 'ppt/slides/slide' + (i + 1) + '.xml', blob: xmlBlob(slideXml(s, media)) });
      files.push({ name: 'ppt/slides/_rels/slide' + (i + 1) + '.xml.rels', blob: xmlBlob(slideRelsXml(s, media)) });
    });
    media.files.forEach(function (f) { files.push(f); });
    return IK.zipWrite(files);
  }
  function dl(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  async function exportPptx() {
    try {
      var zip = await pptxBlob();
      dl(new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }),
        baseName(fileName) + '-edited.pptx');
      dirty = false; el.dirty.textContent = '';
      toast(SYFS.t('صُدِّر ملف pptx'));
    } catch (e) {
      toast(SYFS.t('تعذّر التصدير.'), true);
    }
  }

  /* PNG per slide: drawn on a canvas (1600x900) and zipped. Canvas shapes Arabic
     correctly, so the text comes out right without a font library. */
  function drawSlide(s) {
    var W = 1600, H = 900, M = 90;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#457364'; g.fillRect(0, 0, W, 10);
    g.direction = 'rtl';
    g.textAlign = 'right';
    g.textBaseline = 'top';
    var y = M;
    if (s.title) {
      g.fillStyle = '#1f2a27';
      g.font = '700 52px system-ui, Tahoma, sans-serif';
      wrap(g, s.title, W - M, y, W - 2 * M, 62);
      y += 62 * wrapLines(g, s.title, W - 2 * M) + 26;
    }
    g.font = '32px system-ui, Tahoma, sans-serif';
    g.fillStyle = '#2c3a35';
    s.blocks.forEach(function (b) {
      if (b.type !== 'bullets') return;
      b.items.forEach(function (it) {
        if (!it.trim()) { y += 20; return; }
        var lines = wrap(g, '• ' + it, W - M, y, W - 2 * M, 46);
        y += 46 * lines + 6;
      });
    });
    return { canvas: c, y: y };
  }
  function wrapLines(g, text, maxW) {
    var words = String(text).split(/\s+/), line = '', n = 1;
    words.forEach(function (w) {
      var t = line ? line + ' ' + w : w;
      if (g.measureText(t).width > maxW && line) { n++; line = w; } else line = t;
    });
    return n;
  }
  function wrap(g, text, x, y, maxW, lh) {
    var words = String(text).split(/\s+/), line = '', n = 0;
    words.forEach(function (w) {
      var t = line ? line + ' ' + w : w;
      if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y + n * lh); n++; line = w; }
      else line = t;
    });
    if (line) { g.fillText(line, x, y + n * lh); n++; }
    return n || 1;
  }
  async function exportPng() {
    try {
      harvest();
      var files = [];
      for (var i = 0; i < deck.length; i++) {
        var d = drawSlide(deck[i]);
        var blob = await new Promise(function (res) { d.canvas.toBlob(res, 'image/png'); });
        if (blob) files.push({ name: 'slide-' + (i + 1) + '.png', blob: blob });
      }
      if (!files.length) return;
      var zip = await IK.zipWrite(files);
      dl(zip, baseName(fileName) + '-slides.zip');
      toast(SYFS.t('صُدِّرت {0} صورة PNG', files.length));
    } catch (e) {
      toast(SYFS.t('تعذّر تصدير الصور.'), true);
    }
  }

  /* ===================== present mode ===================== */
  var presenting = false;
  function present() {
    harvest();
    presenting = true;
    document.body.classList.add('presenting');
    renderPresent();
    var s = document.documentElement;
    if (s.requestFullscreen) s.requestFullscreen().catch(function () {});
  }
  function endPresent() {
    presenting = false;
    document.body.classList.remove('presenting');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    renderAll();
  }
  function renderPresent() { renderCanvas(); renderStrip(); }
  document.addEventListener('keydown', function (e) {
    if (!presenting) return;
    if (e.key === 'Escape') { endPresent(); return; }
    if (e.key === 'ArrowLeft' || e.key === 'PageDown' || e.key === ' ') { step(1); e.preventDefault(); }
    if (e.key === 'ArrowRight' || e.key === 'PageUp') { step(-1); e.preventDefault(); }
  });
  function step(d) {                                   /* RTL: ← is forward */
    var i = cur + d;
    if (i < 0 || i >= deck.length) return;
    cur = i;
    renderPresent();
  }
  document.addEventListener('fullscreenchange', function () {
    if (presenting && !document.fullscreenElement) endPresent();
  });

  function show() {
    el.drop.classList.add('hide');
    el.stage.classList.remove('hide');
  }

  /* ===================== wiring ===================== */
  el.open.addEventListener('click', function () { el.file.click(); });
  el.file.addEventListener('change', function () { readFile(el.file.files && el.file.files[0]); });
  el.start.addEventListener('click', function () {
    deck = [blank('title')];
    cur = 0;
    show(); renderAll();
  });
  el.add.addEventListener('click', function () { addSlide('bullets'); });
  el.dup.addEventListener('click', dupSlide);
  el.del.addEventListener('click', delSlide);
  el.img.addEventListener('click', function () { el.imgFile.click(); });
  el.imgFile.addEventListener('change', function () { insertImage(el.imgFile.files && el.imgFile.files[0]); });
  el.present.addEventListener('click', present);
  el.expPptx.addEventListener('click', exportPptx);
  el.expPng.addEventListener('click', exportPng);
  el.expPdf.addEventListener('click', function () { harvest(); window.print(); });

  el.title.addEventListener('input', function () { markDirty(); });
  el.body.addEventListener('input', function () { markDirty(); });
  el.notes.addEventListener('input', function () { markDirty(); });
  /* paste is plain text — pasted HTML would carry arbitrary markup into a slide */
  [el.title, el.body].forEach(function (n) {
    n.addEventListener('paste', function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
  });

  function inTool(e) { return !!(e.target && e.target.closest && e.target.closest('.syfs-wrap')); }
  ['dragenter', 'dragover'].forEach(function (t) {
    document.addEventListener(t, function (e) { if (inTool(e)) return; e.preventDefault(); el.drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    document.addEventListener(t, function (e) { el.drop.classList.remove('over'); if (!inTool(e)) e.preventDefault(); });
  });
  /* ⚠️ الاستثناء القديم (`!== 'png' && !== 'jpg'`) كان يبتلع الصورة **بصمت**: المنطقة تُضيء ثم
   * لا يحدث شيء ولا تُعرض رسالة — وهو أسوأ من الرفض، لأن المستخدم يعيد المحاولة ظنّاً أنه أخطأ
   * التصويب. وقائمته ناقصة أصلاً (`.jpeg` تمرّ إلى `readFile` فتُرفض برسالة «اختر ملف .pptx»).
   * الآن: صورةٌ وعرضٌ مفتوح ⇒ تُدرَج بنفس مسار زرّ 🖼 (`insertImage` يحرس الصيغة والقائمة
   * البيضاء بنفسه)، وأي شيء آخر ⇒ `readFile` فيقول ما تقبله هذه المنطقة فعلاً. */
  document.addEventListener('drop', function (e) {
    if (inTool(e)) return;
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (deck.length && mimeOfExt(extOf(f.name))) { insertImage(f); return; }
    if (dropReplaces(f)) readFile(f);
  });
  /* A stray drop must not silently replace an unexported deck (v0.139.4): with
     changes pending, the first drop only warns; the same file dropped again within
     REPLACE_MS replaces it. The picker is a deliberate choice and is not gated. */
  var REPLACE_MS = 8000;
  var pendingDrop = null;
  function dropReplaces(f) {
    if (!dirty) return true;
    var now = Date.now();
    if (pendingDrop && pendingDrop.name === f.name && pendingDrop.size === f.size && now - pendingDrop.t < REPLACE_MS) {
      pendingDrop = null;
      return true;
    }
    pendingDrop = { name: f.name, size: f.size, t: now };
    toast(SYFS.t('في العرض تعديلات غير مصدَّرة — أفلت الملف مرّة ثانية لاستبداله، أو صدّر أولاً.'), true);
    return false;
  }

  window.addEventListener('beforeunload', function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  /* the helpers + the whole read/write loop, for the node tests */
  window.SYFS_SLIDES = {
    xmlEsc: xmlEsc, mimeOfExt: mimeOfExt, extOf: extOf, baseName: baseName,
    resolvePath: resolvePath, slideXml: slideXml, presentationXml: presentationXml,
    contentTypesXml: contentTypesXml, readFile: readFile, pptxBlob: pptxBlob,
    getDeck: function () { return deck; },
    setDeck: function (d) { deck = d; cur = 0; }
  };
}());
