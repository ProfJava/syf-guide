/* SYF — Excel sheet viewer/editor (sheet.html).
 *
 * Reads a workbook with SheetJS (bundled, Apache-2.0, CSP-safe: zero eval), shows
 * it as an editable HTML grid with search / hide / sort / add / delete, and writes
 * a fresh .xlsx or .csv back out.
 *
 * SECURITY — the two rules that matter here:
 *   1. Every cell value is a HOSTILE STRING. It is only ever put on screen via
 *      textContent. We never use innerHTML with file data and never call
 *      XLSX.utils.sheet_to_html (which builds raw markup) — a crafted .xlsx cell
 *      containing `<img src=x onerror=…>` must render as literal text.
 *   2. CSV export escapes formula-leading characters (= + - @ TAB CR), otherwise a
 *      cell the user typed as `=cmd|…` executes when the CSV is opened in Excel.
 *
 * The workbook lives in this tab's memory ONLY — no chrome.storage, no IndexedDB,
 * no localStorage, no network. Closing the tab drops it. That is deliberate: these
 * files hold payroll/HR data and must not persist behind the user's back. */
(function () {
  'use strict';

  var MAX_BYTES = 20 * 1024 * 1024;                 /* refuse absurd files up front */
  /* ⚠️ bytes are not the cost — the DECLARED range is (v0.139.2). A 30KB .xlsx with one
     whole column formatted declares A1:…1048576, and sheet_to_json with blankrows +
     defval built a million empty rows and hung the tab. SheetJS stops parsing at
     `sheetRows`, and tightRange() shrinks !ref to the cells that actually exist. */
  var MAX_ROWS = 200000;
  function tightRange(ws) {
    var maxR = -1, maxC = -1;
    for (var k in ws) {
      if (k.charAt(0) === '!' || !Object.prototype.hasOwnProperty.call(ws, k)) continue;
      var c = ws[k];
      if (!c || (c.v === undefined || c.v === null || c.v === '') && !c.f) continue;   /* style-only cell */
      var a = XLSX.utils.decode_cell(k);
      if (a.r > maxR) maxR = a.r;
      if (a.c > maxC) maxC = a.c;
    }
    ws['!ref'] = maxR < 0 ? 'A1:A1' : XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    return ws;
  }
  var ROW_H = 32;                                   /* must match --row-h in sheet.html */
  var OVERSCAN = 12;                                /* extra rows rendered above/below the viewport */
  var UNDO_MAX = 50;
  var EXT_OK = ['xlsx', 'xlsm', 'xls', 'xlsb', 'ods', 'csv', 'tsv'];

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  ['open', 'file', 'search', 'hits', 'cols-btn', 'cols-menu', 'showall', 'undo', 'hdr', 'visonly',
   'exp-xlsx', 'exp-csv', 'exp-json', 'tabs', 'drop', 'wrap', 'grid', 'head', 'body', 'foot', 'stats',
   'add-row', 'add-col', 'dirty', 'toast'].forEach(function (id) {
    el[id.replace(/-(\w)/g, function (m, c) { return c.toUpperCase(); })] = $(id);
  });

  /* ---------- state ---------- */
  var book = null;          /* { fileName, sheets: [sheet] } */
  var cur = 0;              /* active sheet index */
  var dirty = false;
  var query = '';
  var filtered = [];        /* data-row indices passing search + row-hiding */
  var searchTimer = 0, scrollRaf = 0;

  /* sheet = { name, header: [string], rows: [[cell]], hiddenCols: Set, hiddenRows: Set, undo: [] } */
  function sheet() { return book && book.sheets[cur]; }
  function cols() { return sheet() ? sheet().header.length : 0; }
  function visibleCols() {
    var s = sheet(), out = [];
    for (var c = 0; c < s.header.length; c++) if (!s.hiddenCols.has(c)) out.push(c);
    return out;
  }

  /* ---------- helpers ---------- */
  function toast(msg, bad) {
    el.toast.textContent = msg;                                    /* textContent: msg may quote a filename */
    el.toast.classList.toggle('bad', !!bad);
    el.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.classList.remove('show'); }, bad ? 5200 : 2400);
  }
  function colLetter(i) {                                          /* 0 -> A, 26 -> AA */
    var s = '';
    for (i = i + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  /* Display form of a raw cell. Dates come back as Date objects (cellDates:true). */
  function show(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return '';
      var t = v.getHours() || v.getMinutes() || v.getSeconds();
      var d = v.getFullYear() + '-' + pad2(v.getMonth() + 1) + '-' + pad2(v.getDate());
      return t ? d + ' ' + pad2(v.getHours()) + ':' + pad2(v.getMinutes()) : d;
    }
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v);
  }
  /* Turn edited text back into a value. Plain integers/decimals become numbers so
   * Excel treats them as numbers again; everything else stays a string. */
  function parseCell(text) {
    var t = text.trim();
    if (t === '') return '';
    if (/^-?\d{1,15}(\.\d+)?$/.test(t)) {
      var n = Number(t);
      if (isFinite(n) && String(n) === t.replace(/^\+/, '')) return n;
    }
    return text;
  }
  function extOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }
  function safeBase(name) {
    return (String(name || '').replace(/\.[^.]+$/, '').replace(/[^\w؀-ۿ.-]+/g, '_').slice(0, 60)) || 'sheet';
  }
  function dlBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }
  function markDirty() {
    dirty = true;
    el.dirty.innerHTML = '';
    var b = document.createElement('span');
    b.className = 'dot';
    b.textContent = SYFS.t('● تعديلات غير مصدَّرة');
    el.dirty.appendChild(b);
  }

  /* ---------- undo ---------- */
  function snapshot() {
    var s = sheet();
    s.undo.push({
      header: s.header.slice(),
      rows: s.rows.map(function (r) { return r.slice(); }),
      hiddenCols: new Set(s.hiddenCols),
      hiddenRows: new Set(s.hiddenRows)
    });
    if (s.undo.length > UNDO_MAX) s.undo.shift();
    el.undo.disabled = false;
  }
  function undo() {
    var s = sheet();
    var prev = s.undo.pop();
    if (!prev) return;
    s.header = prev.header; s.rows = prev.rows;
    s.hiddenCols = prev.hiddenCols; s.hiddenRows = prev.hiddenRows;
    el.undo.disabled = !s.undo.length;
    refilter(); renderHead(); renderCols(); render(); stats();
  }

  /* ---------- load ---------- */
  /* parse one file into { fileName, sheets } — shared by «فتح» and «مقارنة» (v0.118.0),
     so the second file is read under exactly the same rules as the first */
  function parseBook(f, done) {
    if (!f) return;
    if (EXT_OK.indexOf(extOf(f.name)) < 0) {
      toast(SYFS.t('صيغة غير مدعومة — المدعوم: {0}', EXT_OK.join(' · ')), true);
      return;
    }
    if (f.size > MAX_BYTES) {
      toast(SYFS.t('الملف أكبر من 20 م.ب — كبير جداً على المتصفّح'), true);
      return;
    }
    var ext = extOf(f.name);
    var fr = new FileReader();
    fr.onerror = function () { toast(SYFS.t('تعذّرت قراءة الملف'), true); };
    fr.onload = function () {
      var wb;
      try {
        if (ext === 'csv' || ext === 'tsv') {
          /* Hand text formats to SheetJS as a STRING we decoded ourselves.
           * Given raw bytes it guesses a codepage (Windows-1252) and mangles Arabic
           * into mojibake — `محمد` came back as `Ù…Ø­Ù…Ø¯`. TextDecoder('utf-8')
           * also strips a BOM, which is what Excel writes. */
          var text = new TextDecoder('utf-8').decode(new Uint8Array(fr.result));
          var opts = { type: 'string', cellDates: true, sheetRows: MAX_ROWS + 1 };
          if (ext === 'tsv') opts.FS = '\t';
          wb = XLSX.read(text, opts);
        } else {
          wb = XLSX.read(new Uint8Array(fr.result), { type: 'array', cellDates: true, sheetRows: MAX_ROWS + 1 });
        }
      } catch (e) {
        /* deliberately generic — never surface a library stack trace to the user */
        toast(SYFS.t('تعذّر فتح الملف — قد يكون تالفاً أو محمياً بكلمة مرور'), true);
        return;
      }
      var names = wb.SheetNames || [];
      if (!names.length) { toast(SYFS.t('الملف لا يحوي أي ورقة'), true); return; }
      var out = { fileName: f.name, sheets: [] }, cut = [];
      names.forEach(function (n) {
        var ws = tightRange(wb.Sheets[n]);
        /* `sheetRows` stopped the parser: the sheet is longer than we show — say so */
        if (XLSX.utils.decode_range(ws['!ref']).e.r >= MAX_ROWS) {
          var r = XLSX.utils.decode_range(ws['!ref']); r.e.r = MAX_ROWS - 1; ws['!ref'] = XLSX.utils.encode_range(r);
          cut.push(String(n));
        }
        /* header:1 = array of arrays; raw values (a formula yields its cached result) */
        var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
        out.sheets.push(buildSheet(String(n), aoa));
      });
      done(out);
      /* i18n-dyn: sheet names are the user's data */
      if (cut.length) toast(SYFS.t('الورقة «{0}» أطول من {1} صفّ — عُرض أول {1} فقط.', cut.join('، '), String(MAX_ROWS)), true);
    };
    fr.readAsArrayBuffer(f);
  }
  function readFile(f) {
    parseBook(f, function (b) {
      book = b;
      cur = 0; dirty = false; query = ''; el.search.value = ''; el.dirty.textContent = '';
      mount();
      toast(SYFS.t('فُتح: {0}', f.name));
    });
  }

  /* ===== compare (v0.118.0) =====
   * Row identity is the KEY column the user picks (an employee number, an invoice id);
   * columns are matched by header NAME, so a reordered column is not a change. Rows are
   * compared on their DISPLAY form (`show`) — that is what the user sees and what a
   * CSV round-trip would keep. Pure: returns { added, removed, changed, dupKeys }. */
  function diffSheets(a, b, keyA, keyB) {
    var colsB = Object.create(null);
    b.header.forEach(function (name, i) { if (!(name in colsB)) colsB[name] = i; });
    var pairs = [];                                             /* [nameOfCol, idxInA, idxInB] */
    a.header.forEach(function (name, i) { if (i !== keyA && name in colsB && colsB[name] !== keyB) pairs.push([name, i, colsB[name]]); });
    var mapB = Object.create(null), dup = 0;
    b.rows.forEach(function (r, i) { var k = show(r[keyB]).trim(); if (!k) return; if (k in mapB) dup++; else mapB[k] = i; });
    var added = [], removed = [], changed = [], seen = Object.create(null);
    a.rows.forEach(function (r, i) {
      var k = show(r[keyA]).trim(); if (!k) return;
      if (k in seen) { dup++; return; }
      seen[k] = 1;
      if (!(k in mapB)) { removed.push({ key: k, row: r }); return; }
      var rb = b.rows[mapB[k]], cells = [];
      pairs.forEach(function (p) {
        var va = show(r[p[1]]), vb = show(rb[p[2]]);
        if (va !== vb) cells.push({ col: p[0], from: va, to: vb });
      });
      if (cells.length) changed.push({ key: k, cells: cells });
    });
    Object.keys(mapB).forEach(function (k) { if (!(k in seen)) added.push({ key: k, row: b.rows[mapB[k]] }); });
    return { added: added, removed: removed, changed: changed, dupKeys: dup, pairs: pairs };
  }
  var cmpOther = null, cmpResult = null;
  var cmpEl = { panel: $('cmp-panel'), names: $('cmp-names'), key: $('cmp-key'), run: $('cmp-run'), csv: $('cmp-csv'), close: $('cmp-close'), sum: $('cmp-sum'), body: $('cmp-body') };
  function cmpOpen(other) {
    cmpOther = other; cmpResult = null;
    var s = sheet(), o = other.sheets[0];
    /* i18n-dyn: the two file names and a sheet name — file data */
    cmpEl.names.textContent = book.fileName + ' ⇄ ' + other.fileName + (other.sheets.length > 1 ? ' (' + o.name + ')' : '');   /* file names — textContent */
    cmpEl.key.innerHTML = '';
    s.header.forEach(function (name, i) {
      var op = document.createElement('option'); op.value = String(i); op.textContent = name;   /* header text is file data */
      cmpEl.key.appendChild(op);
    });
    cmpEl.sum.textContent = ''; cmpEl.body.textContent = ''; cmpEl.csv.disabled = true;
    cmpEl.panel.classList.remove('hide');
  }
  function cmpRun() {
    var s = sheet(), o = cmpOther && cmpOther.sheets[0];
    if (!o) return;
    var keyA = parseInt(cmpEl.key.value, 10) || 0;
    var keyB = o.header.indexOf(s.header[keyA]);
    if (keyB < 0) { toast(SYFS.t('العمود «{0}» غير موجود في الملفّ الآخر', s.header[keyA]), true); return; }
    var r = cmpResult = diffSheets(s, o, keyA, keyB);
    cmpEl.sum.innerHTML = '';
    [[SYFS.t('صفوف مضافة'), r.added.length], [SYFS.t('صفوف محذوفة'), r.removed.length], [SYFS.t('صفوف تغيّرت'), r.changed.length],
     [SYFS.t('أعمدة مقارَنة'), r.pairs.length], [SYFS.t('مفاتيح مكرّرة'), r.dupKeys]].forEach(function (p) {
      /* i18n-dyn: p[0] is already translated above; p[1] is a count */
      var sp = document.createElement('span'); sp.textContent = p[0] + ': '; var b = document.createElement('b'); b.textContent = String(p[1]); sp.appendChild(b); cmpEl.sum.appendChild(sp);
    });
    var bodyEl = cmpEl.body; bodyEl.textContent = '';
    function table(title, headers, rows, cls) {
      if (!rows.length) return;
      var h3 = document.createElement('h3'); h3.textContent = title + ' (' + rows.length + ')'; bodyEl.appendChild(h3);
      var tb = document.createElement('table'), tr = document.createElement('tr');
      headers.forEach(function (x) { var th = document.createElement('th'); th.textContent = x; tr.appendChild(th); });
      tb.appendChild(tr);
      rows.forEach(function (cells) {
        var row = document.createElement('tr'); if (cls) row.className = cls;
        cells.forEach(function (c) { var td = document.createElement('td'); td.textContent = c.v; if (c.chg) td.className = 'chg'; row.appendChild(td); });
        tb.appendChild(row);
      });
      bodyEl.appendChild(tb);
    }
    table(SYFS.t('تغيّرت'), [s.header[keyA], SYFS.t('العمود'), SYFS.t('قبل'), SYFS.t('بعد')],
      [].concat.apply([], r.changed.map(function (c) { return c.cells.map(function (x) { return [{ v: c.key }, { v: x.col }, { v: x.from }, { v: x.to, chg: true }]; }); })));
    table(SYFS.t('مضافة (في الملفّ الآخر فقط)'), o.header, r.added.map(function (x) { return x.row.map(function (v) { return { v: show(v) }; }); }), 'add');
    table(SYFS.t('محذوفة (في هذه الورقة فقط)'), s.header, r.removed.map(function (x) { return x.row.map(function (v) { return { v: show(v) }; }); }), 'del');
    if (!r.added.length && !r.removed.length && !r.changed.length) { var p = document.createElement('p'); p.textContent = SYFS.t('لا فروق على الأعمدة المشتركة.'); bodyEl.appendChild(p); }
    cmpEl.csv.disabled = false;
  }
  function cmpCsv() {
    var r = cmpResult; if (!r) return;
    var s = sheet(), keyA = parseInt(cmpEl.key.value, 10) || 0;
    var lines = [[SYFS.t('النوع'), s.header[keyA], SYFS.t('العمود'), SYFS.t('قبل'), SYFS.t('بعد')].map(csvSafe).join(',')];
    r.changed.forEach(function (c) { c.cells.forEach(function (x) { lines.push([SYFS.t('تغيّر'), c.key, x.col, x.from, x.to].map(csvSafe).join(',')); }); });
    r.added.forEach(function (x) { lines.push([SYFS.t('مضاف'), x.key, '', '', ''].map(csvSafe).join(',')); });
    r.removed.forEach(function (x) { lines.push([SYFS.t('محذوف'), x.key, '', '', ''].map(csvSafe).join(',')); });
    dlBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), safeBase(book.fileName) + '-diff.csv');
  }
  $('cmp').addEventListener('click', function () { $('cmp-file').click(); });
  $('cmp-file').addEventListener('change', function () {
    var f = $('cmp-file').files && $('cmp-file').files[0]; $('cmp-file').value = '';
    if (!f || !book) return;
    parseBook(f, cmpOpen);
  });
  cmpEl.run.addEventListener('click', cmpRun);
  cmpEl.csv.addEventListener('click', cmpCsv);
  cmpEl.close.addEventListener('click', function () { cmpEl.panel.classList.add('hide'); cmpOther = null; cmpResult = null; cmpEl.body.textContent = ''; });
  function buildSheet(name, aoa) {
    var width = 0;
    aoa.forEach(function (r) { if (r.length > width) width = r.length; });
    if (!width) width = 1;
    aoa.forEach(function (r) { while (r.length < width) r.push(''); });
    var s = {
      name: name,
      headerMode: true,
      header: [],
      rows: aoa,
      hiddenCols: new Set(),
      hiddenRows: new Set(),
      undo: []
    };
    applyHeaderMode(s);
    return s;
  }
  /* headerMode on  → row 1 becomes the column titles and leaves the data rows.
   * headerMode off → titles are A/B/C… and row 1 is data again. */
  function applyHeaderMode(s) {
    var width = s.header.length || (s.rows[0] ? s.rows[0].length : 1);
    if (s.headerMode && s.rows.length) {
      s.header = s.rows.shift().map(function (v, i) {
        var t = show(v).trim();
        return t || colLetter(i);
      });
    } else {
      s.header = [];
      for (var i = 0; i < width; i++) s.header.push(colLetter(i));
    }
  }
  function toggleHeaderMode(on) {
    var s = sheet();
    if (!s || s.headerMode === on) return;
    snapshot();
    if (on) {
      s.headerMode = true;
      applyHeaderMode(s);
    } else {
      /* put the titles back as a normal first data row */
      s.rows.unshift(s.header.slice());
      s.headerMode = false;
      applyHeaderMode(s);
    }
    refilter(); renderHead(); renderCols(); render(); stats();
  }

  /* ---------- filtering ---------- */
  function refilter() {
    var s = sheet();
    filtered = [];
    if (!s) return;
    var q = query.toLowerCase();
    for (var i = 0; i < s.rows.length; i++) {
      if (s.hiddenRows.has(i)) continue;
      if (!q) { filtered.push(i); continue; }
      var row = s.rows[i], hit = false;
      for (var c = 0; c < row.length; c++) {
        if (show(row[c]).toLowerCase().indexOf(q) >= 0) { hit = true; break; }
      }
      if (hit) filtered.push(i);
    }
    el.hits.textContent = q ? SYFS.t('{0} نتيجة', filtered.length) : '';
  }

  /* ---------- render ---------- */
  function renderHead() {
    var s = sheet();
    el.head.innerHTML = '';                                        /* our own markup only — no file data */
    var num = document.createElement('th');
    num.className = 'num';
    num.textContent = '#';
    el.head.appendChild(num);

    visibleCols().forEach(function (c) {
      var th = document.createElement('th');
      th.dataset.c = String(c);
      var box = document.createElement('div');
      box.className = 'th-in';

      var t = document.createElement('span');
      t.className = 'th-t';
      t.textContent = s.header[c];                                 /* textContent — header text is file data */
      t.title = SYFS.t('{0} — انقر مرّتين لإعادة التسمية', s.header[c]);
      t.addEventListener('dblclick', function () { renameCol(c); });
      box.appendChild(t);

      box.appendChild(icon('↕', 'فرز', function () { sortBy(c); }));
      box.appendChild(icon('👁', 'إخفاء العمود', function () { snapshot(); s.hiddenCols.add(c); renderHead(); renderCols(); render(); stats(); }));
      box.appendChild(icon('🗑', 'حذف العمود', function () { delCol(c); }));

      th.appendChild(box);
      el.head.appendChild(th);
    });
  }
  function icon(txt, title, fn) {
    var b = document.createElement('button');
    b.className = 'ic';
    b.type = 'button';
    b.textContent = txt;
    b.title = title;
    b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
    return b;
  }

  /* Virtualised body: only the rows inside the viewport (+ overscan) exist in the
   * DOM; two spacer rows stand in for everything above and below. A 20k-row file
   * would otherwise put 20k * ncols nodes on the page and freeze the tab. */
  function render() {
    var s = sheet();
    if (!s) return;
    /* render() يُستدعى من التمرير وتغيير الحجم، وهو يمسح الجسم كاملاً — فخليّة قيد
       الكتابة تُقتلع قبل أن يصلها focusout، فيضيع ما كتبه المستخدم ومعه المؤشّر.
       تُودَع أوّلاً بمسار الحفظ نفسه (commit) لا بمسار ثانٍ ينحرف عنه. */
    var ae = document.activeElement;
    var edit = (ae && ae.closest) ? ae.closest('td[contenteditable]') : null;
    if (edit && el.body.contains(edit)) commit(edit);
    var vc = visibleCols();
    var span = vc.length + 1;
    var total = filtered.length;
    var top = el.wrap.scrollTop;
    var viewport = el.wrap.clientHeight || 600;

    var start = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
    var end = Math.min(total, Math.ceil((top + viewport) / ROW_H) + OVERSCAN);

    el.body.innerHTML = '';                                        /* rebuilt from the model each frame */
    el.body.appendChild(spacer(start * ROW_H, span));

    for (var i = start; i < end; i++) {
      var r = filtered[i];
      el.body.appendChild(rowEl(s, r, vc));
    }
    el.body.appendChild(spacer(Math.max(0, total - end) * ROW_H, span));
  }
  function spacer(h, span) {
    var tr = document.createElement('tr');
    tr.className = 'spacer-row';
    var td = document.createElement('td');
    td.colSpan = span;
    td.style.height = h + 'px';
    tr.appendChild(td);
    return tr;
  }
  function rowEl(s, r, vc) {
    var tr = document.createElement('tr');
    tr.dataset.r = String(r);
    if (query) tr.className = 'hit';

    var num = document.createElement('td');
    num.className = 'num';
    var box = document.createElement('div');                          /* flex row — the buttons need reserved width */
    box.className = 'num-in';
    var n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(r + 1);
    box.appendChild(n);
    box.appendChild(icon('👁', 'إخفاء الصف', function () { snapshot(); s.hiddenRows.add(r); refilter(); render(); stats(); }));
    box.appendChild(icon('🗑', 'حذف الصف', function () { delRow(r); }));
    num.appendChild(box);
    tr.appendChild(num);

    vc.forEach(function (c) {
      var td = document.createElement('td');
      td.dataset.c = String(c);
      td.contentEditable = 'true';
      td.spellcheck = false;
      td.textContent = show(s.rows[r][c]);                          /* ⚠️ textContent ONLY — cell data is hostile */
      tr.appendChild(td);
    });
    return tr;
  }

  /* ---------- editing ---------- */
  function commit(td) {
    var s = sheet();
    var r = parseInt(td.parentElement.dataset.r, 10);
    var c = parseInt(td.dataset.c, 10);
    if (!isFinite(r) || !isFinite(c) || !s.rows[r]) return;
    var next = parseCell(td.textContent);
    if (show(s.rows[r][c]) === show(next)) return;                  /* no-op edit: don't dirty the undo stack */
    snapshot();
    s.rows[r][c] = next;
    markDirty();
  }
  el.body.addEventListener('focusout', function (e) {
    var td = e.target.closest && e.target.closest('td[contenteditable]');
    if (td) commit(td);
  });
  el.body.addEventListener('keydown', function (e) {
    var td = e.target.closest && e.target.closest('td[contenteditable]');
    if (!td) return;
    if (e.key === 'Enter') { e.preventDefault(); td.blur(); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      var s = sheet();
      var r = parseInt(td.parentElement.dataset.r, 10), c = parseInt(td.dataset.c, 10);
      td.textContent = show(s.rows[r][c]);                          /* restore, then leave */
      td.blur();
    }
  });
  /* Paste as plain text: a rich-text paste would otherwise inject markup into a
   * contentEditable cell. */
  el.body.addEventListener('paste', function (e) {
    var td = e.target.closest && e.target.closest('td[contenteditable]');
    if (!td) return;
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
    document.execCommand('insertText', false, text.replace(/[\r\n\t]+/g, ' '));
  });

  function renameCol(c) {
    var s = sheet();
    var name = window.prompt(SYFS.t('اسم العمود:'), s.header[c]);
    if (name === null) return;
    snapshot();
    s.header[c] = String(name).slice(0, 120) || colLetter(c);
    markDirty(); renderHead(); renderCols();
  }
  function delCol(c) {
    var s = sheet();
    if (s.header.length <= 1) { toast(SYFS.t('لا يمكن حذف العمود الأخير'), true); return; }
    if (!window.confirm(SYFS.t('حذف العمود «{0}» وكل بياناته؟', s.header[c]))) return;
    snapshot();
    s.header.splice(c, 1);
    s.rows.forEach(function (r) { r.splice(c, 1); });
    var moved = new Set();                                          /* indices after c shift down by one */
    s.hiddenCols.forEach(function (h) {
      if (h < c) moved.add(h);
      else if (h > c) moved.add(h - 1);
    });
    s.hiddenCols = moved;
    markDirty(); renderHead(); renderCols(); render(); stats();
  }
  function delRow(r) {
    var s = sheet();
    snapshot();
    s.rows.splice(r, 1);
    var moved = new Set();
    s.hiddenRows.forEach(function (h) {
      if (h < r) moved.add(h);
      else if (h > r) moved.add(h - 1);
    });
    s.hiddenRows = moved;
    markDirty(); refilter(); render(); stats();
  }
  function addRow() {
    var s = sheet();
    snapshot();
    var row = [];
    for (var c = 0; c < s.header.length; c++) row.push('');
    s.rows.push(row);
    markDirty(); refilter(); render(); stats();
    el.wrap.scrollTop = el.wrap.scrollHeight;
  }
  function addCol() {
    var s = sheet();
    snapshot();
    s.header.push(colLetter(s.header.length));
    s.rows.forEach(function (r) { r.push(''); });
    markDirty(); renderHead(); renderCols(); render(); stats();
  }
  /* Sort the data rows by one column. Numeric when every present value is numeric,
   * otherwise Arabic-aware string collation. Toggles asc/desc on repeat clicks. */
  function sortBy(c) {
    var s = sheet();
    snapshot();
    var dir = (s._sortCol === c && s._sortDir === 1) ? -1 : 1;
    var allNum = s.rows.every(function (r) {
      var v = r[c];
      return v === '' || v === null || v === undefined || typeof v === 'number' || v instanceof Date;
    });
    s.rows.sort(function (a, b) {
      var x = a[c], y = b[c];
      var xe = (x === '' || x === null || x === undefined), ye = (y === '' || y === null || y === undefined);
      if (xe && ye) return 0;
      if (xe) return 1;                                             /* empties always sink */
      if (ye) return -1;
      if (allNum) {
        var nx = x instanceof Date ? x.getTime() : Number(x);
        var ny = y instanceof Date ? y.getTime() : Number(y);
        return (nx - ny) * dir;
      }
      return show(x).localeCompare(show(y), 'ar') * dir;
    });
    s._sortCol = c; s._sortDir = dir;
    s.hiddenRows = new Set();                                       /* row indices are meaningless after a sort */
    markDirty(); refilter(); render(); stats();
    toast(SYFS.t('فُرز حسب «{0}»{1}', s.header[c], dir === 1 ? ' ↑' : ' ↓'));
  }

  /* ---------- columns dropdown ---------- */
  function renderCols() {
    var s = sheet();
    el.colsMenu.innerHTML = '';
    s.header.forEach(function (name, c) {
      var lab = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !s.hiddenCols.has(c);
      cb.addEventListener('change', function () {
        snapshot();
        if (cb.checked) s.hiddenCols.delete(c); else s.hiddenCols.add(c);
        renderHead(); render(); stats();
      });
      var t = document.createElement('span');
      t.textContent = name;                                         /* textContent — header text is file data */
      lab.appendChild(cb); lab.appendChild(t);
      el.colsMenu.appendChild(lab);
    });
  }

  /* ---------- tabs / stats ---------- */
  function renderTabs() {
    el.tabs.innerHTML = '';
    el.tabs.classList.toggle('hide', book.sheets.length < 2);
    book.sheets.forEach(function (s, i) {
      var b = document.createElement('button');
      b.className = 'tab' + (i === cur ? ' on' : '');
      /* i18n-dyn: a sheet name out of the workbook — file data */
      b.textContent = s.name;                                       /* textContent — sheet names are file data */
      b.addEventListener('click', function () {
        cur = i;
        el.hdr.checked = sheet().headerMode;
        el.undo.disabled = !sheet().undo.length;
        refilter(); renderTabs(); renderHead(); renderCols(); render(); stats();
        el.wrap.scrollTop = 0;
      });
      el.tabs.appendChild(b);
    });
  }
  function stats() {
    var s = sheet();
    var hc = s.hiddenCols.size, hr = s.hiddenRows.size;
    el.stats.textContent = SYFS.t('{0} صف · {1} عمود', s.rows.length, s.header.length) +
      (hc || hr ? SYFS.t(' · مخفي: {0} صف، {1} عمود', hr, hc) : '');
    el.showall.disabled = !(hc || hr);
  }

  /* ---------- export ---------- */
  function exportRows() {
    var s = sheet();
    var use = el.visonly.checked ? visibleCols() : s.header.map(function (_, i) { return i; });
    var rowIdx = el.visonly.checked ? filtered : s.rows.map(function (_, i) { return i; });
    var out = [use.map(function (c) { return s.header[c]; })];
    rowIdx.forEach(function (r) {
      out.push(use.map(function (c) { return s.rows[r][c]; }));
    });
    return out;
  }
  function exportXlsx() {
    var aoa = exportRows();
    var ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
    var wb = XLSX.utils.book_new();
    /* Excel rejects sheet names over 31 chars or containing : \ / ? * [ ] */
    var name = String(sheet().name).replace(/[:\\/?*[\]]/g, '_').slice(0, 31) || 'Sheet1';
    XLSX.utils.book_append_sheet(wb, ws, name);
    var buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    dlBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      safeBase(book.fileName) + '-edited.xlsx');
    dirty = false; el.dirty.textContent = '';
    toast(SYFS.t('صُدِّر ملف xlsx'));
  }
  /* CSV INJECTION: Excel/Sheets execute a cell that starts with = + - @ (or a tab /
   * carriage return that leads to one). Prefixing a single quote neutralises it.
   * The value the user sees is unchanged; only the file on disk is defused. */
  function csvSafe(v) {
    var t = show(v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    if (/["\n\r,]/.test(t)) t = '"' + t.replace(/"/g, '""') + '"';
    return t;
  }
  function exportCsv() {
    var lines = exportRows().map(function (r) { return r.map(csvSafe).join(','); });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });  /* BOM: Excel reads Arabic */
    dlBlob(blob, safeBase(book.fileName) + '-edited.csv');
    toast(SYFS.t('صُدِّر ملف CSV (المعادلات مُعطَّلة بعلامة اقتباس)'));
  }

  /* JSON export: one object per data row, keyed by the header. An empty or repeated
   * header would collapse two columns into one key and silently lose data, so it
   * falls back to the column letter and disambiguates the rest. */
  function jsonKeys(headers) {
    /* null prototype: with a plain {}, a column headed `constructor` / `toString` /
       `__proto__` would look "already used" (they live on Object.prototype) and get
       renamed to constructor_2 — a silent corruption of the user's header. */
    var used = Object.create(null), out = [];
    headers.forEach(function (hd, i) {
      var base = String(hd === null || hd === undefined ? '' : hd).trim() || colLetter(i);
      var k = base, n = 2;
      while (used[k]) k = base + '_' + (n++);
      used[k] = 1;
      out.push(k);
    });
    return out;
  }
  function jsonData() {
    var aoa = exportRows();
    var keys = jsonKeys(aoa[0]);
    return aoa.slice(1).map(function (r) {
      /* null prototype: a header literally named __proto__ must become a plain key,
         not rewrite the object's prototype. */
      var o = Object.create(null);
      keys.forEach(function (k, i) {
        var v = r[i];
        if (v === undefined) v = null;
        /* Dates go out exactly as the grid shows them (local, yyyy-mm-dd) — toISOString
           would shift the day across a timezone and quietly change payroll dates. */
        o[k] = (v instanceof Date) ? show(v) : v;
      });
      return o;
    });
  }
  function exportJson() {
    var blob = new Blob([JSON.stringify(jsonData(), null, 2)], { type: 'application/json;charset=utf-8' });
    dlBlob(blob, safeBase(book.fileName) + '-edited.json');
    toast(SYFS.t('صُدِّر ملف JSON'));
  }

  /* ---------- mount ---------- */
  function mount() {
    el.drop.classList.add('hide');
    el.wrap.classList.remove('hide');
    el.foot.classList.remove('hide');
    ['search', 'colsBtn', 'showall', 'hdr', 'visonly', 'expXlsx', 'expCsv', 'expJson'].forEach(function (k) { el[k].disabled = false; });
    $('cmp').disabled = false;
    el.hdr.checked = sheet().headerMode;
    el.undo.disabled = !sheet().undo.length;
    document.title = SYFS.t('{0} — جداول SYF', book.fileName);
    refilter(); renderTabs(); renderHead(); renderCols(); render(); stats();
    el.wrap.scrollTop = 0;
  }

  /* ---------- wiring ---------- */
  el.open.addEventListener('click', function () { el.file.click(); });
  el.file.addEventListener('change', function () { readFile(el.file.files && el.file.files[0]); });

  /* A drop inside a floating tool window (the .syfs-wrap overlay) belongs to that
     tool — e.g. dragging a PNG onto the image converter. Only drops on the sheet
     page itself are workbook drops. */
  function inTool(e) { return !!(e.target && e.target.closest && e.target.closest('.syfs-wrap')); }
  ['dragenter', 'dragover'].forEach(function (t) {
    document.addEventListener(t, function (e) { if (inTool(e)) return; e.preventDefault(); el.drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    document.addEventListener(t, function (e) { el.drop.classList.remove('over'); if (!inTool(e)) e.preventDefault(); });
  });
  /* A stray drop must not silently replace an unexported workbook (v0.139.4): with
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
    toast(SYFS.t('في الملف تعديلات غير مصدَّرة — أفلت الملف مرّة ثانية لاستبداله، أو صدّر أولاً.'), true);
    return false;
  }
  document.addEventListener('drop', function (e) {
    if (inTool(e)) return;
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && dropReplaces(f)) readFile(f);
  });

  el.search.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      query = el.search.value.trim();
      refilter(); render();
      el.wrap.scrollTop = 0;
    }, 150);
  });
  el.wrap.addEventListener('scroll', function () {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () { scrollRaf = 0; render(); });
  });
  window.addEventListener('resize', function () { if (book) render(); });

  el.colsBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    el.colsMenu.classList.toggle('hide');
  });
  document.addEventListener('click', function (e) {
    if (!el.colsMenu.contains(e.target)) el.colsMenu.classList.add('hide');
  });

  el.showall.addEventListener('click', function () {
    var s = sheet();
    if (!s.hiddenCols.size && !s.hiddenRows.size) return;
    snapshot();
    s.hiddenCols = new Set(); s.hiddenRows = new Set();
    refilter(); renderHead(); renderCols(); render(); stats();
  });
  el.undo.addEventListener('click', undo);
  el.hdr.addEventListener('change', function () { toggleHeaderMode(el.hdr.checked); });
  el.addRow.addEventListener('click', addRow);
  el.addCol.addEventListener('click', addCol);
  el.expXlsx.addEventListener('click', exportXlsx);
  el.expCsv.addEventListener('click', exportCsv);
  el.expJson.addEventListener('click', exportJson);

  /* The workbook is never persisted — warn before the tab takes it down with it. */
  window.addEventListener('beforeunload', function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  /* export the pure bits for node tests (harmless in the page) */
  window.SYFS_SHEET = {
    colLetter: colLetter, show: show, parseCell: parseCell, csvSafe: csvSafe, safeBase: safeBase, extOf: extOf,
    jsonKeys: jsonKeys, diffSheets: diffSheets
  };
}());
