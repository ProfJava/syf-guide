/* SYF — Word document editor (word.html).
 *
 * Opens a .docx, shows it in a full Word-like editor (CKEditor 5), writes a fresh
 * .docx back out. The .docx read/write engine is OURS — a .docx is a ZIP of XML and
 * imgkit.js owns both halves of a ZIP (zipWrite/zipRead). CKEditor is ONLY the
 * editing surface; it never touches the file bytes.
 *
 * WHY OUR OWN DOCX ENGINE (not mammoth/docx libs) — mammoth builds functions from
 * strings in 7 places, which MV3's extension_pages CSP refuses outright, and it would
 * hand us an HTML *string* built from the file's own bytes. We parse the XML
 * ourselves so file data only ever reaches the page as textContent on nodes we made.
 *
 * WHY CKEDITOR IS SAFE ON THE EDITING SIDE — it parses clipboard/HTML into a
 * restricted model (no <script>, no event handlers, no arbitrary tags survive). Its
 * verified GPL build carries zero `eval(` / `new Function(` (the one `Function(...)`
 * in the bundle is a short-circuited global-probe that never runs). So rich paste
 * from Word/Docs is allowed — a UX win the old contenteditable had to forbid.
 *
 * THE BRIDGE — CKEditor edits its own content. `#doc` is an off-screen MIRROR:
 *   import: our reader builds nodes in #doc -> editor.setData(#doc.innerHTML)
 *   export: #doc.innerHTML = editor.getData() -> normalise CKEditor figures ->
 *           the unchanged writer serialises #doc into .docx / html / txt / print.
 * The whole XML engine below still reads and writes exactly one element: #doc.
 *
 * SECURITY — the rules that still matter:
 *   1. The .docx is HOSTILE. Every piece of its text lands via textContent on an
 *      element we built; there is no innerHTML with file data anywhere.
 *   2. Embedded images render only if their extension is whitelisted
 *      (png/jpeg/gif/webp/bmp). No SVG — an SVG is a script container. Imported
 *      images become data: URLs (from our own whitelisted bytes) so they survive the
 *      editor round-trip; inserted images use CKEditor's Base64 adapter (also data:).
 *   3. editor.getData() is the editor's OWN sanitised serialisation, not file bytes.
 *   4. The file is never persisted (no storage/IndexedDB/localStorage, no network).
 *      Closing the tab drops it, with a beforeunload warning. These documents are
 *      contracts and HR letters. */
(function () {
  'use strict';

  var MAX_BYTES = 20 * 1024 * 1024;
  var IK = (window.SYFS && window.SYFS.imgkit) || null;

  /* Namespaces. Word writes them on every element; we match on the URI, never on a
     prefix — the prefix is the file's choice and can be anything. */
  var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  var PKG_R = 'http://schemas.openxmlformats.org/package/2006/relationships';

  var IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
  var EMU_PER_PX = 9525;
  var MAX_IMG_PX = 620;                                /* page text width at 96dpi */

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  ['open', 'file', 'doc', 'editor', 'drop', 'stage', 'stats', 'dirty', 'toast',
   'exp-docx', 'exp-pdf', 'exp-html', 'exp-txt', 'fname', 'start', 'drop-h'].forEach(function (id) {
    el[id.replace(/-(\w)/g, function (m, c) { return c.toUpperCase(); })] = $(id);
  });

  var fileName = 'document.docx';
  var fromPdf = false;                                  /* export is a fresh .docx, not "-edited" */
  var dirty = false;

  function toast(msg, bad) {
    el.toast.textContent = msg;
    el.toast.classList.toggle('bad', !!bad);
    el.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.classList.remove('show'); }, bad ? 5200 : 2400);
  }
  function markDirty() {
    dirty = true;
    el.dirty.textContent = SYFS.t('● غير مصدَّر');
  }
  function baseName(n) { return String(n || 'document').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'document'; }
  function extOf(n) { var m = /\.([a-z0-9]+)$/i.exec(String(n || '')); return m ? m[1].toLowerCase() : ''; }

  /* ===================== XML helpers (pure — exported for tests) ===================== */
  /* Every string that goes into the XML we WRITE passes through here. A cell of text
     containing `</w:t>` would otherwise close the tag and let the user's own typing
     restructure the document. */
  /* XML 1.0 forbids C0 controls (bar TAB/LF/CR), U+FFFE/U+FFFF and unpaired
     surrogates — escaping does not make them legal. One of them (U+000B arrives with
     a pasted Shift+Enter) and Word opens the file with «needs repair» (v0.139.3) */
  var XML_BAD = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
  function xmlEsc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(XML_BAD, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function emu(px) { return Math.max(1, Math.round(px * EMU_PER_PX)); }
  function mimeOfExt(ext) { return IMG_MIME[String(ext || '').toLowerCase()] || null; }

  /* Uint8Array -> base64 (chunked to stay under the argument-count limit of btoa). */
  function b64(bytes) {
    var bin = '', chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  /* ===================== READ: .docx -> the editor ===================== */
  function td(bytes) { return bytes ? new TextDecoder('utf-8').decode(bytes) : ''; }
  function parseXml(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('bad-xml');
    return doc;
  }
  function kids(node, ns, name) {
    var out = [];
    for (var i = 0; i < node.childNodes.length; i++) {
      var c = node.childNodes[i];
      if (c.nodeType === 1 && c.namespaceURI === ns && c.localName === name) out.push(c);
    }
    return out;
  }
  function firstDesc(node, ns, name) {
    var list = node.getElementsByTagNameNS(ns, name);
    return list.length ? list[0] : null;
  }
  function wVal(parent, name) {
    var e = parent ? firstDesc(parent, W, name) : null;
    return e ? e.getAttributeNS(W, 'val') : null;
  }
  function wOn(rPr, name) {                            /* <w:b/> is on; <w:b w:val="0"/> is off */
    if (!rPr) return false;
    var e = kids(rPr, W, name)[0];
    if (!e) return false;
    var v = e.getAttributeNS(W, 'val');
    return !(v === '0' || v === 'false');
  }

  /* rId -> target path, from word/_rels/document.xml.rels */
  function parseRels(xmlText) {
    var map = Object.create(null);
    if (!xmlText) return map;
    var doc = parseXml(xmlText);
    var rels = doc.getElementsByTagNameNS(PKG_R, 'Relationship');
    for (var i = 0; i < rels.length; i++) {
      var id = rels[i].getAttribute('Id'), t = rels[i].getAttribute('Target');
      if (!id || !t) continue;
      if (rels[i].getAttribute('TargetMode') === 'External') continue;   /* remote image: never fetched */
      map[id] = t.replace(/^\/+/, '').replace(/^\.\.\//, '');
      if (map[id].indexOf('word/') !== 0) map[id] = 'word/' + map[id];
    }
    return map;
  }
  /* numId -> true when that list is NUMBERED (w:numFmt != bullet) */
  function parseNumbering(xmlText) {
    var ordered = Object.create(null);
    if (!xmlText) return ordered;
    var doc = parseXml(xmlText);
    var absFmt = Object.create(null);
    var abs = doc.getElementsByTagNameNS(W, 'abstractNum');
    for (var i = 0; i < abs.length; i++) {
      var aid = abs[i].getAttributeNS(W, 'abstractNumId');
      var lvl = kids(abs[i], W, 'lvl')[0];
      var fmt = lvl ? wVal(lvl, 'numFmt') : null;
      absFmt[aid] = fmt && fmt !== 'bullet' && fmt !== 'none';
    }
    var nums = doc.getElementsByTagNameNS(W, 'num');
    for (var j = 0; j < nums.length; j++) {
      var nid = nums[j].getAttributeNS(W, 'numId');
      var ref = firstDesc(nums[j], W, 'abstractNumId');
      var aref = ref ? ref.getAttributeNS(W, 'val') : null;
      ordered[nid] = !!absFmt[aref];
    }
    return ordered;
  }

  /* An embedded image becomes a data: URL — but only if its extension is one we
     trust. An .svg (or anything unknown) is dropped, not rendered: SVG executes.
     data: (not blob:) so the image survives serialise -> editor.setData round-trips. */
  function mediaUrl(zip, path) {
    var bytes = zip[path];
    if (!bytes) return null;
    var mime = mimeOfExt(extOf(path));
    if (!mime) return null;
    return 'data:' + mime + ';base64,' + b64(bytes);
  }

  /* one <w:p> -> a block element (p / h1-h3 / li). Text ONLY via textContent. */
  function paraEl(p, ctx) {
    var pPr = kids(p, W, 'pPr')[0];
    var style = pPr ? wVal(pPr, 'pStyle') : null;
    var jc = pPr ? wVal(pPr, 'jc') : null;
    var numPr = pPr ? kids(pPr, W, 'numPr')[0] : null;
    var numId = numPr ? wVal(numPr, 'numId') : null;

    var tag = 'p';
    if (style) {
      var m = /^Heading([1-9])$/i.exec(style);
      if (m) tag = 'h' + Math.min(3, parseInt(m[1], 10));
      else if (/^Title$/i.test(style)) tag = 'h1';
    }
    if (numId) tag = 'li';

    var node = document.createElement(tag);
    if (jc === 'center') node.style.textAlign = 'center';
    else if (jc === 'left') node.style.textAlign = 'left';
    else if (jc === 'right') node.style.textAlign = 'right';
    else if (jc === 'both') node.style.textAlign = 'justify';

    var runs = p.getElementsByTagNameNS(W, 'r');
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i];
      var rPr = kids(r, W, 'rPr')[0];
      /* image inside this run? */
      var blip = firstDesc(r, A, 'blip');
      if (blip) {
        var rid = blip.getAttributeNS(R, 'embed');
        var target = rid ? ctx.rels[rid] : null;
        var url = target ? mediaUrl(ctx.zip, target) : null;
        if (url) {
          var img = document.createElement('img');
          img.src = url;                                /* data: from our own whitelisted bytes */
          img.alt = '';
          node.appendChild(img);
        }
        continue;
      }
      var texts = kids(r, W, 't');
      var brs = kids(r, W, 'br');
      var txt = '';
      for (var t = 0; t < texts.length; t++) txt += texts[t].textContent;
      if (kids(r, W, 'tab').length) txt = '\t' + txt;
      if (!txt && brs.length) { node.appendChild(document.createElement('br')); continue; }
      if (!txt) continue;

      var leaf = document.createTextNode(txt);          /* ⚠️ text node — never HTML */
      var wrap = leaf;
      if (wOn(rPr, 'b')) { var b = document.createElement('strong'); b.appendChild(wrap); wrap = b; }
      if (wOn(rPr, 'i')) { var it = document.createElement('em'); it.appendChild(wrap); wrap = it; }
      if (rPr && kids(rPr, W, 'u')[0]) { var u = document.createElement('u'); u.appendChild(wrap); wrap = u; }
      node.appendChild(wrap);
      for (var k = 0; k < brs.length; k++) node.appendChild(document.createElement('br'));
    }
    if (!node.childNodes.length) node.appendChild(document.createElement('br'));   /* keep empty paragraphs */
    node.dataset.num = numId || '';
    return node;
  }

  function tableEl(tbl, ctx) {
    var table = document.createElement('table');
    var tbody = document.createElement('tbody');
    kids(tbl, W, 'tr').forEach(function (tr) {
      var row = document.createElement('tr');
      kids(tr, W, 'tc').forEach(function (tc) {
        var cell = document.createElement('td');
        kids(tc, W, 'p').forEach(function (p) { cell.appendChild(paraEl(p, ctx)); });
        if (!cell.childNodes.length) cell.appendChild(document.createElement('p'));
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    return table;
  }

  /* Consecutive <li>s that share a numId are one list. Word has no <ul> — the list
     is implied by numPr, so we have to rebuild the grouping ourselves. */
  function groupLists(blocks, ordered) {
    var out = [], i = 0;
    while (i < blocks.length) {
      var b = blocks[i];
      var num = b.nodeType === 1 && b.tagName === 'LI' ? b.dataset.num : '';
      if (!num) { out.push(b); i++; continue; }
      var list = document.createElement(ordered[num] ? 'ol' : 'ul');
      while (i < blocks.length && blocks[i].tagName === 'LI' && blocks[i].dataset.num === num) {
        delete blocks[i].dataset.num;
        list.appendChild(blocks[i]);
        i++;
      }
      out.push(list);
    }
    return out;
  }

  async function readFile(file) {
    if (!file) return;
    if (extOf(file.name) === 'doc') {
      toast(SYFS.t('صيغة .doc القديمة (Word 97-2003) غير مدعومة — لا يوجد قارئ لها في المتصفّح. احفظ الملف كـ .docx ثم أعد المحاولة.'), true);
      return;
    }
    if (extOf(file.name) === 'pdf') { await readPdf(file); return; }
    if (extOf(file.name) !== 'docx') { toast(SYFS.t('اختر ملف .docx أو PDF'), true); return; }
    if (file.size > MAX_BYTES) { toast(SYFS.t('الملف أكبر من 20 م.ب.'), true); return; }
    if (!IK || !IK.zipRead) { toast(SYFS.t('محرّك الملفات غير محمَّل.'), true); return; }

    try {
      var zip = await IK.zipRead(file);
      var docXml = td(zip['word/document.xml']);
      if (!docXml) throw new Error('no-document');
      var ctx = { zip: zip, rels: parseRels(td(zip['word/_rels/document.xml.rels'])) };
      var ordered = parseNumbering(td(zip['word/numbering.xml']));
      var doc = parseXml(docXml);
      var body = doc.getElementsByTagNameNS(W, 'body')[0];
      if (!body) throw new Error('no-body');

      var blocks = [];
      for (var i = 0; i < body.childNodes.length; i++) {
        var n = body.childNodes[i];
        if (n.nodeType !== 1 || n.namespaceURI !== W) continue;
        if (n.localName === 'p') blocks.push(paraEl(n, ctx));
        else if (n.localName === 'tbl') blocks.push(tableEl(n, ctx));
      }
      var grouped = groupLists(blocks, ordered);

      el.doc.textContent = '';                          /* clear — our own markup only */
      grouped.forEach(function (b) { el.doc.appendChild(b); });
      if (!grouped.length) el.doc.appendChild(document.createElement('p'));

      fileName = file.name; fromPdf = false;
      /* i18n-dyn: the user's own file name */
      el.fname.textContent = file.name;
      pushEditor(el.doc.innerHTML);                     /* our nodes -> the editor */
      show();
      dirty = false; el.dirty.textContent = '';
      toast(SYFS.t('فُتح المستند ✓'));
    } catch (e) {
      /* generic on purpose — no stack, no paths */
      toast(SYFS.t('تعذّرت قراءة الملف. تأكّد أنه .docx سليم غير محمي بكلمة مرور.'), true);
    }
  }

  /* ===================== READ: PDF -> editable document (v0.119.0) =====================
   * "PDF to Word" is this page opening a PDF: pdf.js gives us the text runs with their
   * positions, we rebuild lines → paragraphs → headings from geometry alone, and the
   * result lands in the same #doc mirror the .docx import fills — so the existing
   * writer, printer and editor need no PDF knowledge at all.
   *
   * Text only, by design and said in the UI: no tables, no images, no multi-column
   * reflow (columns interleave), and a scanned PDF (no text layer) is refused with a
   * pointer to the OCR tool rather than "converted" into an empty document.
   *
   * ⛔ Every string from the file reaches the DOM through createTextNode/textContent —
   * a PDF's text layer is as adversarial as any file content (§5.8/1).
   * pdf.js is the lazily-imported copy in lib/pdfjs (same one media.js uses); the worker
   * is pinned to the bundled file — no CDN, nothing leaves the tab. */
  var pdfjsMod = null;
  async function loadPdfjs() {
    if (pdfjsMod) return pdfjsMod;
    var mod = await import(chrome.runtime.getURL('lib/pdfjs/pdf.min.mjs'));
    try { mod.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdfjs/pdf.worker.min.mjs'); } catch (e) { /* ignore */ }
    pdfjsMod = mod;
    return mod;
  }
  var AR_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
  var LAT_RE = /[A-Za-zÀ-ɏ]/g;
  function rtlText(s) { return ((s.match(AR_RE) || []).length) >= ((s.match(LAT_RE) || []).length); }
  /* one page's text runs -> [{ text, sz, rtl, x0, x1, y, bold }] lines, top to bottom */
  function pdfLines(tc) {
    var lines = [];
    for (var i = 0; i < tc.items.length; i++) {
      var it = tc.items[i];
      if (typeof it.str !== 'string' || !it.str.trim()) continue;
      var t = it.transform || [1, 0, 0, 1, 0, 0];
      var sz = Math.hypot(t[2], t[3]) || Math.abs(it.height) || 10;
      var x = t[4], y = t[5], w = Math.abs(it.width) || 0;
      var ln = null;
      /* same line = same baseline (within a bit less than half the font size); only
         the last few lines are candidates, so a rotated caption cannot swallow the page */
      for (var k = lines.length - 1; k >= 0 && k >= lines.length - 8; k--) {
        if (Math.abs(lines[k].y - y) <= Math.max(lines[k].sz, sz) * 0.45) { ln = lines[k]; break; }
      }
      if (!ln) { ln = { y: y, sz: sz, items: [] }; lines.push(ln); }
      ln.items.push({ x: x, w: w, sz: sz, str: it.str, bold: /bold|black|heavy|semibold/i.test(String(it.fontName || '')) });
      if (sz > ln.sz) ln.sz = sz;
    }
    lines.sort(function (a, b) { return b.y - a.y; });               /* PDF y grows upward */
    return lines.map(function (ln) {
      var raw = ln.items.map(function (p) { return p.str; }).join(' ');
      var rtl = rtlText(raw);
      /* reading order is visual order: left→right for LTR lines, right→left for RTL —
         pdf.js already hands each run in logical order, we only order the runs */
      ln.items.sort(function (a, b) { return rtl ? (b.x + b.w) - (a.x + a.w) : a.x - b.x; });
      var out = '', bold = 0;
      for (var j = 0; j < ln.items.length; j++) {
        var p = ln.items[j], s = p.str;
        if (j) {
          var q = ln.items[j - 1];
          var gap = rtl ? q.x - (p.x + p.w) : p.x - (q.x + q.w);
          var glued = /\s$/.test(out) || /^\s/.test(s);
          if (!glued && gap > p.sz * 0.12) out += ' ';
        }
        out += s;
        if (p.bold) bold += s.length;
      }
      var x0 = Math.min.apply(null, ln.items.map(function (p) { return p.x; }));
      var x1 = Math.max.apply(null, ln.items.map(function (p) { return p.x + p.w; }));
      out = out.replace(/\s+/g, ' ').trim();
      return { text: out, sz: ln.sz, rtl: rtl, x0: x0, x1: x1, y: ln.y, bold: bold >= out.length * 0.6 && out.length > 0 };
    }).filter(function (l) { return l.text; });
  }
  /* character-weighted median font size = the body text size */
  function pdfBodySize(lines) {
    var buckets = {}, best = 0, bestN = -1;
    lines.forEach(function (l) { var k = Math.round(l.sz * 2) / 2; buckets[k] = (buckets[k] || 0) + l.text.length; });
    Object.keys(buckets).forEach(function (k) { if (buckets[k] > bestN) { bestN = buckets[k]; best = +k; } });
    return best || 11;
  }
  var BULLET_RE = /^[•‣◦⁃∙·▪●■–—\-\*]\s+/;
  /* lines -> block nodes appended to `root`; geometry only, no innerHTML */
  function pdfBlocks(lines, pageW, root) {
    var body = pdfBodySize(lines);
    var paras = [], cur = null;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i], prev = cur && cur.lines[cur.lines.length - 1];
      var big = l.sz >= body * 1.22;
      var bullet = BULLET_RE.test(l.text);
      var fresh = !prev || bullet || big !== cur.big || Math.abs(l.sz - prev.sz) > body * 0.15 ||
        (prev.y - l.y) > Math.max(prev.sz, l.sz) * 1.55 || l.rtl !== prev.rtl ||
        /[.:؟!؛?]$/.test(prev.text) && (l.x0 - cur.x0) > body * 1.2 && !l.rtl ||
        /[.:؟!؛?]$/.test(prev.text) && (cur.x1 - l.x1) > body * 1.2 && l.rtl;
      if (fresh) { cur = { lines: [], big: big, rtl: l.rtl, x0: l.x0, x1: l.x1, sz: l.sz, bullet: bullet, bold: true }; paras.push(cur); }
      cur.lines.push(l);
      cur.x0 = Math.min(cur.x0, l.x0); cur.x1 = Math.max(cur.x1, l.x1);
      if (!l.bold) cur.bold = false;
    }
    var list = null;
    paras.forEach(function (p) {
      var text = p.lines.map(function (l) { return l.text; }).join(' ');
      var tag = 'p';
      if (p.big && p.lines.length <= 2 && text.length <= 140) tag = p.sz >= body * 1.6 ? 'h1' : 'h2';
      else if (p.bold && p.lines.length === 1 && text.length <= 90 && !p.bullet) tag = 'h3';
      if (p.bullet) {
        if (!list) { list = document.createElement('ul'); root.appendChild(list); }
        var li = document.createElement('li');
        li.textContent = text.replace(BULLET_RE, '');
        if (!p.rtl) li.setAttribute('dir', 'ltr');
        list.appendChild(li);
        return;
      }
      list = null;
      var n = document.createElement(tag);
      n.textContent = text;
      /* centred: the block hugs the page middle and is clearly narrower than the page */
      var mid = (p.x0 + p.x1) / 2, w = p.x1 - p.x0;
      if (pageW && w < pageW * 0.8 && Math.abs(mid - pageW / 2) < pageW * 0.04 && p.lines.length <= 3) n.style.textAlign = 'center';
      else if (!p.rtl) { n.style.textAlign = 'left'; n.setAttribute('dir', 'ltr'); }
      root.appendChild(n);
    });
  }
  var PDF_MAX_PAGES = 300;
  async function readPdf(file) {
    if (file.size > MAX_BYTES) { toast(SYFS.t('الملف أكبر من 20 م.ب.'), true); return; }
    toast(SYFS.t('…جارٍ تحويل PDF'));
    var pdf = null;
    try {
      var pdfjs = await loadPdfjs();
      pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
      var n = Math.min(pdf.numPages, PDF_MAX_PAGES);
      var frag = document.createDocumentFragment();
      var chars = 0;
      for (var i = 1; i <= n; i++) {
        var page = await pdf.getPage(i);
        var tc = await page.getTextContent();
        var lines = pdfLines(tc);
        chars += lines.reduce(function (a, l) { return a + l.text.length; }, 0);
        if (i > 1) {                                        /* a real page break between pages */
          var br = document.createElement('div');
          br.className = 'page-break';
          frag.appendChild(br);
        }
        var vp = page.getViewport({ scale: 1 });
        pdfBlocks(lines, vp.width, frag);
        page.cleanup();
      }
      if (chars < 20) {
        /* no text layer: a scan. Say what it is and where to go instead of "converting" it */
        toast(SYFS.t('هذا الملف صور بلا طبقة نصّ (مستند مصوَّر). استخرج نصّه بأداة «استخراج نصّ من صورة» أولاً.'), true);
        return;
      }
      el.doc.textContent = '';                              /* clear — our own markup only */
      el.doc.appendChild(frag);
      fileName = baseName(file.name) + '.docx';
      fromPdf = true;
      /* i18n-dyn: the user's own file name */
      el.fname.textContent = file.name;
      pushEditor(el.doc.innerHTML);                         /* our nodes -> the editor */
      show();
      markDirty();                                          /* nothing exported yet */
      toast(pdf.numPages > n
        ? SYFS.t('حُوِّلت أول {0} صفحة من {1} ✓ — راجع التنسيق ثم صدّر docx', n, pdf.numPages)
        : SYFS.t('حُوِّل PDF ✓ ({0} صفحة) — راجع التنسيق ثم صدّر docx', n));
    } catch (e) {
      /* generic on purpose — no stack, no paths */
      toast(SYFS.t('تعذّرت قراءة PDF. تأكّد أنه ملف سليم غير محمي بكلمة مرور.'), true);
    } finally {
      try { if (pdf) await pdf.destroy(); } catch (e) { /* ignore */ }
    }
  }

  /* ===================== WRITE: the editor -> .docx =====================
   * Serialises the document we RENDER (the #doc mirror), not the file we read — so
   * what you see is exactly what Word gets. Complex Word features we never rendered
   * (headers, footnotes, track changes, text boxes) are therefore not written back
   * either; the tool says so up front. */
  function runXml(text, fmt, rtl) {
    var pr = '';
    if (fmt.b) pr += '<w:b/><w:bCs/>';
    if (fmt.i) pr += '<w:i/><w:iCs/>';
    if (fmt.link) pr += '<w:color w:val="0563C1"/>';   /* rPr child order matters: color before u */
    if (fmt.u || fmt.link) pr += '<w:u w:val="single"/>';
    if (rtl) pr += '<w:rtl/>';
    var parts = String(text).split('\n');
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      if (i) out += '<w:r>' + (pr ? '<w:rPr>' + pr + '</w:rPr>' : '') + '<w:br/></w:r>';
      if (!parts[i]) continue;
      out += '<w:r>' + (pr ? '<w:rPr>' + pr + '</w:rPr>' : '') +
        '<w:t xml:space="preserve">' + xmlEsc(parts[i]) + '</w:t></w:r>';
    }
    return out;
  }
  /* Only real, click-safe protocols become hyperlinks; anything else (javascript:,
     data:, …) is written as plain text so a document can't smuggle a script URL. */
  function safeHref(href) {
    var h = String(href || '').trim();
    return /^(https?:|mailto:|tel:)/i.test(h) ? h : null;
  }
  /* register an external hyperlink target -> its relationship id (rId201+) */
  function linkRid(media, href) {
    if (media.links.byUrl[href]) return media.links.byUrl[href];
    var rid = 'rId' + (200 + (++media.links.n));
    media.links.byUrl[href] = rid;
    media.links.list.push({ rid: rid, href: href });
    return rid;
  }
  /* walk the inline content of a block, carrying bold/italic/underline down */
  function inlineXml(node, fmt, media) {
    var out = '';
    for (var i = 0; i < node.childNodes.length; i++) {
      var c = node.childNodes[i];
      if (c.nodeType === 3) { out += runXml(c.nodeValue, fmt, true); continue; }
      if (c.nodeType !== 1) continue;
      var tag = c.tagName;
      if (tag === 'BR') { out += '<w:r><w:br/></w:r>'; continue; }
      if (tag === 'IMG') { out += imgXml(c, media); continue; }
      if (tag === 'A') {
        var href = safeHref(c.getAttribute('href'));
        if (href) {                                     /* real link -> w:hyperlink */
          out += '<w:hyperlink r:id="' + linkRid(media, href) + '">' +
            inlineXml(c, { b: fmt.b, i: fmt.i, u: fmt.u, link: true }, media) + '</w:hyperlink>';
          continue;
        }                                               /* unsafe/relative -> fall through as text */
      }
      var next = {
        b: fmt.b || tag === 'B' || tag === 'STRONG',
        i: fmt.i || tag === 'I' || tag === 'EM',
        u: fmt.u || tag === 'U',
        link: fmt.link
      };
      out += inlineXml(c, next, media);
    }
    return out;
  }
  function imgXml(img, media) {
    var rec = media.byUrl[img.src];
    if (!rec) return '';
    var w = Math.min(img.naturalWidth || img.width || 320, MAX_IMG_PX);
    var scale = (img.naturalWidth && w) ? w / img.naturalWidth : 1;
    var h = Math.max(1, Math.round((img.naturalHeight || img.height || 200) * scale));
    var cx = emu(w), cy = emu(h);
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + rec.n + '" name="Picture ' + rec.n + '"/>' +
      '<a:graphic xmlns:a="' + A + '"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:nvPicPr><pic:cNvPr id="' + rec.n + '" name="Picture ' + rec.n + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rec.rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }
  var JC = { center: 'center', left: 'left', right: 'right', justify: 'both' };
  function pPrXml(node, opts) {
    var pr = '<w:bidi/>';                               /* the document is Arabic-first: RTL paragraphs */
    if (opts.style) pr += '<w:pStyle w:val="' + opts.style + '"/>';
    if (opts.numId) pr += '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + opts.numId + '"/></w:numPr>';
    var al = node.style && node.style.textAlign;
    if (al && JC[al]) pr += '<w:jc w:val="' + JC[al] + '"/>';
    return '<w:pPr>' + pr + '</w:pPr>';
  }
  function blockXml(node, media) {
    if (node.nodeType === 3) {
      var t = node.nodeValue;
      return t && t.trim() ? '<w:p><w:pPr><w:bidi/></w:pPr>' + runXml(t, {}, true) + '</w:p>' : '';
    }
    if (node.nodeType !== 1) return '';
    var tag = node.tagName;
    /* CKEditor page break: <div class="page-break">…</div> -> a real Word page break */
    if (node.classList && node.classList.contains('page-break')) {
      return '<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>';
    }
    /* CKEditor to-do list: <ul class="todo-list"> — not a bullet list; render ☑/☐ */
    if ((tag === 'UL' || tag === 'OL') && node.classList && node.classList.contains('todo-list')) {
      return todoListXml(node, media);
    }
    if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
      return '<w:p>' + pPrXml(node, { style: 'Heading' + tag.charAt(1) }) + inlineXml(node, {}, media) + '</w:p>';
    }
    if (tag === 'UL' || tag === 'OL') {
      var numId = tag === 'OL' ? '2' : '1';
      var out = '';
      for (var i = 0; i < node.childNodes.length; i++) {
        var li = node.childNodes[i];
        if (li.nodeType !== 1 || li.tagName !== 'LI') continue;
        out += '<w:p>' + pPrXml(li, { numId: numId }) + inlineXml(li, {}, media) + '</w:p>';
      }
      return out;
    }
    if (tag === 'TABLE') return tableXml(node, media);
    if (tag === 'DIV' || tag === 'P' || tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'PRE') {
      return '<w:p>' + pPrXml(node, {}) + inlineXml(node, {}, media) + '</w:p>';
    }
    /* an unexpected wrapper: keep its content rather than dropping the text */
    var inner = '';
    for (var j = 0; j < node.childNodes.length; j++) inner += blockXml(node.childNodes[j], media);
    return inner || ('<w:p>' + pPrXml(node, {}) + inlineXml(node, {}, media) + '</w:p>');
  }
  function tableXml(table, media) {
    var rows = table.querySelectorAll('tr');
    var maxCells = 1;
    for (var i = 0; i < rows.length; i++) maxCells = Math.max(maxCells, rows[i].children.length);
    var grid = '';
    for (var g = 0; g < maxCells; g++) grid += '<w:gridCol w:w="' + Math.floor(9360 / maxCells) + '"/>';
    var out = '<w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="0" w:type="auto"/>' +
      '<w:tblBorders>' +
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (s) {
        return '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="999999"/>';
      }).join('') +
      '</w:tblBorders></w:tblPr><w:tblGrid>' + grid + '</w:tblGrid>';
    for (var r = 0; r < rows.length; r++) {
      out += '<w:tr>';
      var cells = rows[r].children;
      for (var c = 0; c < cells.length; c++) {
        var body = '';
        for (var k = 0; k < cells[c].childNodes.length; k++) body += blockXml(cells[c].childNodes[k], media);
        if (!body) body = '<w:p><w:pPr><w:bidi/></w:pPr></w:p>';
        out += '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>' + body + '</w:tc>';
      }
      out += '</w:tr>';
    }
    return out + '</w:tbl>';
  }

  /* CKEditor to-do list -> paragraphs prefixed with ☑ (done) / ☐ (open). Word has no
     simple inline checkbox, so the box is a plain glyph; the text keeps its markup. */
  function todoListXml(ul, media) {
    var out = '';
    var items = ul.children;
    for (var i = 0; i < items.length; i++) {
      var li = items[i];
      if (li.tagName !== 'LI') continue;
      var box = li.querySelector('input[type="checkbox"], input');
      var checked = box ? box.checked : false;
      var desc = li.querySelector('.todo-list__label__description') || li;
      var mark = '<w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">' + (checked ? '☑' : '☐') + ' </w:t></w:r>';
      out += '<w:p><w:pPr><w:bidi/></w:pPr>' + mark + inlineXml(desc, {}, media) + '</w:p>';
    }
    return out;
  }

  /* collect the images actually in the document, as bytes + a relationship id */
  async function collectMedia() {
    var imgs = el.doc.querySelectorAll('img');
    var media = {
      byUrl: Object.create(null), files: [], types: Object.create(null),
      links: { byUrl: Object.create(null), list: [], n: 0 }   /* filled during the body walk */
    };
    var n = 0;
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].src;
      if (media.byUrl[src]) continue;
      if (!/^blob:|^data:image\//.test(src)) continue;   /* never fetch a remote URL from a document */
      try {
        var blob = await (await fetch(src)).blob();
        var ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpeg');
        if (!mimeOfExt(ext)) continue;
        n++;
        var name = 'media/image' + n + '.' + ext;
        media.byUrl[src] = { n: n, rid: 'rId' + (100 + n), path: 'word/' + name, ext: ext };
        media.files.push({ name: 'word/' + name, blob: blob });
        media.types[ext] = blob.type;
      } catch (e) { /* an image we cannot read is simply not embedded */ }
    }
    return media;
  }

  function contentTypesXml(media) {
    var defs = '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>';
    Object.keys(media.types).forEach(function (ext) {
      defs += '<Default Extension="' + xmlEsc(ext) + '" ContentType="' + xmlEsc(media.types[ext]) + '"/>';
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + defs +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
      '</Types>';
  }
  function docRelsXml(media) {
    var rels = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>';
    Object.keys(media.byUrl).forEach(function (u) {
      var m = media.byUrl[u];
      rels += '<Relationship Id="' + m.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + m.n + '.' + m.ext + '"/>';
    });
    (media.links ? media.links.list : []).forEach(function (l) {   /* external hyperlinks */
      rels += '<Relationship Id="' + l.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' + xmlEsc(l.href) + '" TargetMode="External"/>';
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="' + PKG_R + '">' + rels + '</Relationships>';
  }
  function stylesXml() {
    function heading(n, sz) {
      return '<w:style w:type="paragraph" w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/>' +
        '<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="' + (n - 1) + '"/><w:bidi/></w:pPr>' +
        '<w:rPr><w:b/><w:bCs/><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr></w:style>';
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="' + W + '">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:cs="Arial"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:bidi/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      heading(1, 40) + heading(2, 32) + heading(3, 28) +
      '</w:styles>';
  }
  function numberingXml() {
    function lvl(fmt, text) {
      return '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="' + fmt + '"/>' +
        '<w:lvlText w:val="' + text + '"/><w:lvlJc w:val="right"/>' +
        '<w:pPr><w:ind w:right="720" w:hanging="360"/></w:pPr></w:lvl>';
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:numbering xmlns:w="' + W + '">' +
      '<w:abstractNum w:abstractNumId="1">' + lvl('bullet', '•') + '</w:abstractNum>' +
      '<w:abstractNum w:abstractNumId="2">' + lvl('decimal', '%1.') + '</w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' +
      '<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>' +
      '</w:numbering>';
  }
  function documentXml(bodyXml) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="' + W + '" xmlns:r="' + R + '" xmlns:a="' + A + '"' +
      ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
      '<w:body>' + bodyXml +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/><w:bidi/></w:sectPr>' +
      '</w:body></w:document>';
  }
  function ROOT_RELS() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="' + PKG_R + '">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>';
  }
  function xmlBlob(s) { return new Blob([s], { type: 'application/xml' }); }

  /* Builds the whole package. Kept separate from the download so the tests can read
     the bytes back with zipRead and prove the export really is a .docx. */
  async function docxBlob() {
    var media = await collectMedia();
    var body = '';
    for (var i = 0; i < el.doc.childNodes.length; i++) body += blockXml(el.doc.childNodes[i], media);
    if (!body) body = '<w:p><w:pPr><w:bidi/></w:pPr></w:p>';

    var files = [
      { name: '[Content_Types].xml', blob: xmlBlob(contentTypesXml(media)) },
      { name: '_rels/.rels', blob: xmlBlob(ROOT_RELS()) },
      { name: 'word/document.xml', blob: xmlBlob(documentXml(body)) },
      { name: 'word/_rels/document.xml.rels', blob: xmlBlob(docRelsXml(media)) },
      { name: 'word/styles.xml', blob: xmlBlob(stylesXml()) },
      { name: 'word/numbering.xml', blob: xmlBlob(numberingXml()) }
    ].concat(media.files);
    return IK.zipWrite(files);
  }
  async function exportDocx() {
    try {
      await syncMirror();
      var zip = await docxBlob();
      dl(new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
        baseName(fileName) + (fromPdf ? '.docx' : '-edited.docx'));
      dirty = false; el.dirty.textContent = '';
      toast(SYFS.t('صُدِّر ملف docx'));
    } catch (e) {
      toast(SYFS.t('تعذّر التصدير.'), true);
    }
  }
  function dl(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  async function exportHtml() {
    await syncMirror();
    /* the mirror holds the editor's own sanitised serialisation — safe to write out */
    var html = '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>' +
      xmlEsc(baseName(fileName)) + '</title><body style="font-family:system-ui;max-width:800px;margin:auto">' +
      el.doc.innerHTML + '</body></html>';
    dl(new Blob([html], { type: 'text/html;charset=utf-8' }), baseName(fileName) + '.html');
    toast(SYFS.t('صُدِّر HTML'));
  }
  async function exportTxt() {
    await syncMirror();
    var lines = [];
    Array.prototype.forEach.call(el.doc.children, function (b) { lines.push(b.innerText || b.textContent || ''); });
    dl(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/plain;charset=utf-8' }), baseName(fileName) + '.txt');
    toast(SYFS.t('صُدِّر نصّ'));
  }
  async function exportPdf() {
    await syncMirror();                                 /* paint the paper mirror, then print it */
    window.print();
  }

  /* ===================== CKEditor <-> #doc mirror bridge ===================== */
  var editor = null;
  var pendingHtml = null;

  /* Turn CKEditor's serialised HTML into the shape the .docx writer expects:
     unwrap <figure class="table"> and <figure class="image"> back to bare
     <table>/<img>. Runs on the off-screen mirror only. */
  function normalizeCk(root) {
    Array.prototype.forEach.call(root.querySelectorAll('figure.table'), function (f) {
      var t = f.querySelector('table');
      if (t) f.replaceWith(t); else f.remove();
    });
    Array.prototype.forEach.call(root.querySelectorAll('figure.image, figure.image-inline'), function (f) {
      var img = f.querySelector('img');
      var cap = f.querySelector('figcaption');
      var p = document.createElement('p');
      if (img) { img.removeAttribute('class'); img.removeAttribute('style'); p.appendChild(img); }
      f.replaceWith(p);
      if (cap && cap.textContent.trim()) {
        var pc = document.createElement('p');
        pc.textContent = cap.textContent;               /* caption text only */
        p.after(pc);
      }
    });
  }
  /* wait for (data:) images to decode so imgXml reads a real naturalWidth */
  function decodeImgs(root) {
    var imgs = Array.prototype.slice.call(root.querySelectorAll('img'));
    return Promise.all(imgs.map(function (im) {
      if (im.complete && im.naturalWidth) return Promise.resolve();
      return (im.decode ? im.decode() : Promise.resolve()).catch(function () {});
    }));
  }
  /* editor -> #doc mirror (called right before every export/print) */
  async function syncMirror() {
    if (editor) el.doc.innerHTML = editor.getData();    /* editor's own clean output */
    normalizeCk(el.doc);
    await decodeImgs(el.doc);
  }
  /* #doc html -> editor (called right after every import) */
  function pushEditor(html) {
    if (!editor) { pendingHtml = html; return; }
    editor.setData(html);
  }

  function initEditor() {
    var C = window.CKEDITOR;
    if (!C || !C.ClassicEditor) { toast(SYFS.t('محرّك التحرير لم يُحمّل.'), true); return; }
    C.ClassicEditor.create(el.editor, {
      licenseKey: 'GPL',
      language: 'ar',
      placeholder: 'ابدأ الكتابة هنا… أو افتح ملف ‎.docx',
      /* filter(Boolean): if a future CKEditor build drops one of these exports, a
         single undefined entry would otherwise make create() throw and kill the
         whole editor. Drop the missing one, keep the rest, warn in the console. */
      plugins: [
        C.Essentials, C.Autoformat, C.Paragraph, C.Heading,
        C.Bold, C.Italic, C.Underline, C.Strikethrough, C.Subscript, C.Superscript, C.Code,
        C.FontFamily, C.FontSize, C.FontColor, C.FontBackgroundColor,
        C.Alignment, C.Highlight,
        C.List, C.ListProperties, C.TodoList,
        C.Indent, C.IndentBlock,
        C.Link, C.AutoLink,
        C.BlockQuote, C.CodeBlock,
        C.HorizontalLine, C.PageBreak, C.RemoveFormat,
        C.FindAndReplace, C.SpecialCharacters, C.SpecialCharactersEssentials,
        C.Table, C.TableToolbar, C.TableProperties, C.TableCellProperties, C.TableColumnResize, C.TableCaption,
        C.Image, C.ImageToolbar, C.ImageCaption, C.ImageStyle, C.ImageResize, C.ImageInsert, C.ImageUpload, C.AutoImage, C.Base64UploadAdapter,
        C.PasteFromOffice, C.WordCount, C.TextTransformation
      ].filter(Boolean),
      toolbar: {
        items: [
          'undo', 'redo', '|',
          'heading', '|',
          'fontFamily', 'fontSize', '|',
          'bold', 'italic', 'underline', 'strikethrough', '|',
          'fontColor', 'fontBackgroundColor', 'highlight', '|',
          'alignment', '|',
          'bulletedList', 'numberedList', 'todoList', '|',
          'outdent', 'indent', '|',
          'link', 'blockQuote', 'insertTable', 'insertImage', '|',
          'horizontalLine', 'pageBreak', 'specialCharacters', '|',
          'removeFormat', 'findAndReplace'
        ],
        shouldNotGroupWhenFull: true
      },
      heading: {
        options: [
          { model: 'paragraph', title: 'فقرة عادية', class: 'ck-heading_paragraph' },
          { model: 'heading1', view: 'h1', title: 'عنوان 1', class: 'ck-heading_heading1' },
          { model: 'heading2', view: 'h2', title: 'عنوان 2', class: 'ck-heading_heading2' },
          { model: 'heading3', view: 'h3', title: 'عنوان 3', class: 'ck-heading_heading3' }
        ]
      },
      fontFamily: { supportAllValues: true },
      fontSize: { options: [9, 10, 11, 12, 'default', 14, 16, 18, 20, 24, 28, 36, 48], supportAllValues: true },
      link: { defaultProtocol: 'https://', addTargetToExternalLinks: true },
      image: {
        toolbar: ['imageStyle:inline', 'imageStyle:block', 'imageStyle:side', '|', 'toggleImageCaption', 'imageTextAlternative', '|', 'resizeImage']
      },
      table: {
        contentToolbar: ['tableColumn', 'tableRow', 'mergeTableCells', 'tableProperties', 'tableCellProperties']
      }
    }).then(function (ed) {
      editor = ed;
      ed.model.document.on('change:data', markDirty);
      try {
        var wc = ed.plugins.get('WordCount');
        wc.on('update', function (e, s) {
          el.stats.textContent = SYFS.t('{0} كلمة · {1} حرف', s.words, s.characters);
        });
      } catch (e) { /* WordCount optional */ }
      if (pendingHtml != null) { ed.setData(pendingHtml); pendingHtml = null; }
    }).catch(function (err) {
      toast(SYFS.t('تعذّر تشغيل المحرّر. أعد تحميل الصفحة.'), true);
      try { console.error('[SYF word] CKEditor init failed:', err); } catch (e) {}
    });
  }

  function show() {
    el.drop.classList.add('hide');
    el.stage.classList.remove('hide');
    if (editor) editor.editing.view.focus();
  }

  /* ===================== wiring ===================== */
  el.open.addEventListener('click', function () { el.file.click(); });
  el.file.addEventListener('change', function () { readFile(el.file.files && el.file.files[0]); });
  el.start.addEventListener('click', function () { show(); });

  function inTool(e) { return !!(e.target && e.target.closest && e.target.closest('.syfs-wrap')); }
  ['dragenter', 'dragover'].forEach(function (t) {
    document.addEventListener(t, function (e) { if (inTool(e)) return; e.preventDefault(); el.drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    document.addEventListener(t, function (e) { el.drop.classList.remove('over'); if (!inTool(e)) e.preventDefault(); });
  });
  /* A stray drop must not silently replace an unexported document (v0.139.4): with
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
    toast(SYFS.t('في المستند تعديلات غير مصدَّرة — أفلت الملف مرّة ثانية لاستبداله، أو صدّر أولاً.'), true);
    return false;
  }
  document.addEventListener('drop', function (e) {
    if (inTool(e)) return;
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && dropReplaces(f)) readFile(f);
  });

  el.expDocx.addEventListener('click', exportDocx);
  el.expHtml.addEventListener('click', exportHtml);
  el.expTxt.addEventListener('click', exportTxt);
  el.expPdf.addEventListener('click', exportPdf);

  window.addEventListener('beforeunload', function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  /* Opened as the «PDF إلى Word» tool (word.html#pdf — same fragment convention as
     video.html#frames, so app.js can embed it too): the picker asks for a PDF and the
     drop card says what will happen. Nothing else changes — it is the same editor, and
     a .docx dropped here still opens. */
  if (/(^|[#&])pdf\b/.test(location.hash || '')) {
    el.file.accept = '.pdf';
    /* i18n-via: T — this runs at load, BEFORE src/i18n.js (script order): T falls back
       to the msgid, and the page pass (tree(document.body)) translates the node like
       any static markup once the dictionary lands. */
    var T = function (s) { return (window.SYFS && SYFS.t) ? SYFS.t(s) : s; };
    if (el.dropH) el.dropH.textContent = T('أفلت ملف PDF هنا أو اضغط «فتح ملف» — يُحوَّل إلى مستند Word قابل للتحرير');
    el.drop.classList.add('pdf');
  }

  initEditor();

  /* the helpers the node tests drive (harmless in the page — these are the very
     functions the buttons call; readFile/docxBlob let a test do the full
     open -> edit -> export -> reopen loop against a real DOM). collectMedia and
     docxBlob read #doc directly, so a test can build #doc and export with no editor. */
  window.SYFS_WORD = {
    xmlEsc: xmlEsc, emu: emu, mimeOfExt: mimeOfExt, baseName: baseName, extOf: extOf, b64: b64,
    runXml: runXml, blockXml: blockXml, documentXml: documentXml, numberingXml: numberingXml,
    contentTypesXml: contentTypesXml, normalizeCk: normalizeCk, readFile: readFile, docxBlob: docxBlob
  };
}());
