/* SYF — phone number formatter, UI layer (phones.html). Spec: specs/phone-formatter.md.
 *
 * The workbook is parsed here, in this tab, and never leaves it: no chrome.storage,
 * no IndexedDB, no localStorage, no network. Closing the tab drops it. That is
 * deliberate and it is the same rule sheet.js follows — these files hold people's
 * phone numbers, and a tool that quietly keeps a copy is a tool that leaks one.
 * The ONLY thing stored is the preference set (country, format, checkboxes) under
 * `phones_prefs` — no filename, no sample, no number.
 *
 * SECURITY — the two that matter here:
 *   1. Every cell value is a HOSTILE STRING. It reaches the screen through
 *      textContent alone; there is no innerHTML with file data anywhere in this
 *      file, and XLSX.utils.sheet_to_html (which builds raw markup) is never called.
 *   2. CSV export escapes formula-leading characters. ⚠️ Sharper here than in
 *      sheet.js: the DEFAULT output format starts with '+', so every formatted
 *      number is a potential payload — `+966…` opened in Excel is a formula. */
(function () {
  'use strict';

  var SYFS = window.SYFS || {};
  var store = SYFS.store;
  var Core = SYFS.phoneCore;
  /* i18n-via: T — T() IS SYFS.t, with a fallback for the case where i18n.js has not
     landed yet (this page can be opened directly by URL). Wrapping every call site
     in a second t() would say the same thing twice. */
  /* ⚠️ variadic, and it matters: a fixed (s, a, b) signature silently DROPPED the
     third argument, so the pager rendered a literal «{2}» on screen — the failure
     mode of a placeholder is a visible brace, not an exception. Caught in the
     browser. */
  var T = function () { return SYFS.t ? SYFS.t.apply(null, arguments) : arguments[0]; };

  var MAX_BYTES = 20 * 1024 * 1024;
  var MAX_ROWS = 200000;                             /* same guard as sheet.js — a small file can declare A1:XFD1048576 */
  /* Shrink !ref to the cells that hold a value (or a formula). Style-only cells don't count. */
  function tightRange(ws) {
    var maxR = -1, maxC = -1;
    for (var k in ws) {
      if (k.charAt(0) === '!' || !Object.prototype.hasOwnProperty.call(ws, k)) continue;
      var c = ws[k];
      if (!c || (c.v === undefined || c.v === null || c.v === '') && !c.f) continue;
      var a = window.XLSX.utils.decode_cell(k);
      if (a.r > maxR) maxR = a.r;
      if (a.c > maxC) maxC = a.c;
    }
    ws['!ref'] = maxR < 0 ? 'A1:A1' : window.XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    return ws;
  }
  var EXT_OK = ['xlsx', 'xls', 'csv'];
  var PAGE = 100;
  var PREFS_KEY = 'phones_prefs';
  var FILTERS = ['all', 'fixed', 'invalid', 'duplicate', 'foreign'];
  var WRITE_MODES = ['new', 'overwrite'];

  var el = {};
  var st = { file: '', book: null, rows: [], headers: [], data: [], col: -1, res: [], filter: 'all', q: '', page: 0 };

  function $(id) { return document.getElementById(id); }
  function cache() {
    ['drop', 'file', 'meta', 'name', 'rows', 'change', 'sheet', 'col', 'header',
     'card-set', 'card-rev', 'country', 'cc', 'len', 'arabic', 'foreign', 'dups', 'strict',
     'colname', 'statuscol', 'reset', 'stats', 'filters', 'search', 'body', 'none',
     'prev', 'next', 'page', 'validonly', 'dedupe', 'xlsx', 'csv', 'copy', 'toast'
    ].forEach(function (k) { el[k] = $('ph-' + k); });
  }

  /* ---------- small helpers ---------- */
  var toastT = 0;
  function toast(msg, bad) {
    el.toast.textContent = msg;                     /* textContent: msg may quote a filename */
    el.toast.classList.toggle('bad', !!bad);
    el.toast.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.toast.classList.remove('show'); }, bad ? 5200 : 3000);
  }
  /* A number cell must not come back as "9.66501e+11" or "5.0e2": ask for the
     integer form when the value is one, and let the core expand the rest. */
  function cellText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
    if (v instanceof Date) return v.toISOString();
    return String(v);
  }
  function debounce(fn, ms) {
    var t = 0;
    return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); };
  }
  function ext(name) { var p = String(name).toLowerCase().split('.'); return p.length > 1 ? p.pop() : ''; }
  function pickOne(list, v, def) { return list.indexOf(v) >= 0 ? v : def; }
  function radio(name) { var n = document.querySelector('input[name="' + name + '"]:checked'); return n ? n.value : ''; }
  function setRadio(name, v) {
    var n = document.querySelector('input[name="' + name + '"][value="' + String(v).replace(/[^a-z]/g, '') + '"]');
    if (n) n.checked = true;
  }
  function lengths(raw) {
    return String(raw || '').split(/[^0-9]+/).filter(Boolean).map(Number)
      .filter(function (n) { return n > 0 && n < 15; });
  }

  /* ---------- options + stored preferences ---------- */
  function options() {
    var code = el.cc.value.replace(/\D/g, '');
    var preset = Core.getCountry(code);
    return {
      countryCode: code,
      nsnLengths: lengths(el.len.value),
      mobilePrefixes: preset ? preset.mob : [],
      /* ⛔ whitelisted on the way out too — the radio value is DOM the page owns,
         but the core turns it into a rendering branch and «reject, don't repair»
         (§4.1) is cheaper to keep than to reason about */
      outputFormat: pickOne(Core.FORMATS, radio('ph-fmt'), 'plus'),
      convertArabicDigits: el.arabic.checked,
      strictMobile: el.strict.checked,
      keepForeign: el.foreign.checked,
      markDuplicates: el.dups.checked
    };
  }

  function savePrefs() {
    if (!store) return;
    store.set(PREFS_KEY, {
      country: el.country.value,
      code: el.cc.value,
      lengths: el.len.value,
      format: radio('ph-fmt'),
      write: radio('ph-write'),
      colName: el.colname.value,
      arabic: el.arabic.checked,
      foreign: el.foreign.checked,
      dups: el.dups.checked,
      strict: el.strict.checked,
      statusCol: el.statuscol.checked,
      validOnly: el.validonly.checked,
      dedupe: el.dedupe.checked
    });
  }

  /* ⚠️ every field is whitelisted or clamped on the way IN (§5.11/1): this object
     travels through the settings export/import, so "it is ours" is not true of it. */
  function applyPrefs(p) {
    if (!p || typeof p !== 'object') return;
    if (typeof p.country === 'string' && (p.country === '__custom' || Core.countryById(p.country))) el.country.value = p.country;
    if (p.code !== undefined) el.cc.value = String(p.code).replace(/\D/g, '').slice(0, 4);
    if (p.lengths !== undefined) el.len.value = lengths(p.lengths).join(',');
    if (typeof p.colName === 'string') el.colname.value = p.colName.slice(0, 60);
    setRadio('ph-fmt', pickOne(Core.FORMATS, p.format, 'plus'));
    setRadio('ph-write', pickOne(WRITE_MODES, p.write, 'new'));
    [['arabic', 'arabic'], ['foreign', 'foreign'], ['dups', 'dups'], ['strict', 'strict'],
     ['statusCol', 'statuscol'], ['validOnly', 'validonly'], ['dedupe', 'dedupe']].forEach(function (pair) {
      if (typeof p[pair[0]] === 'boolean') el[pair[1]].checked = p[pair[0]];
    });
  }

  function buildCountries() {
    var chosen = el.country.value || 'SA';
    el.country.textContent = '';
    Core.COUNTRIES.forEach(function (c) {
      var o = document.createElement('option');
      /* ⛔ an explicit value, always — an <option> without one has its TEXT as its
         value, and that text is translated at runtime, so every lookup keyed on it
         returns undefined in English (§6.103/4) */
      o.value = c.id;
      o.textContent = T(c.ar) + '  (+' + c.cc + ')';
      el.country.appendChild(o);
    });
    var custom = document.createElement('option');
    custom.value = '__custom';
    custom.textContent = T('كود مخصّص…');
    el.country.appendChild(custom);
    el.country.value = chosen;
    if (!el.country.value) el.country.value = 'SA';
  }
  function applyPreset() {
    var c = Core.countryById(el.country.value);
    if (!c) return;                                  /* '__custom' — leave what is typed */
    el.cc.value = c.cc;
    el.len.value = c.nsn.join(',');
  }

  /* ---------- reading the workbook ---------- */
  function readFile(file) {
    if (!file) return;
    if (EXT_OK.indexOf(ext(file.name)) < 0) { toast(T('نوع ملف غير مدعوم. استخدم xlsx أو xls أو csv.'), true); return; }
    if (file.size > MAX_BYTES) { toast(T('حجم الملف كبير ({0} ميجابايت). الحدّ الأقصى ٢٠ ميجابايت.', (file.size / 1048576).toFixed(1)), true); return; }

    var fr = new FileReader();
    fr.onerror = function () { toast(T('تعذّرت قراءة الملف. قد يكون تالفاً أو محمياً بكلمة مرور.'), true); };
    fr.onload = function (e) {
      var book;
      try {
        book = window.XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: false, cellStyles: false, sheetRows: MAX_ROWS + 1 });
      } catch (x) { toast(T('تعذّرت قراءة الملف. قد يكون تالفاً أو محمياً بكلمة مرور.'), true); return; }
      if (!book || !book.SheetNames.length) { toast(T('تعذّرت قراءة الملف. قد يكون تالفاً أو محمياً بكلمة مرور.'), true); return; }
      st.book = book;
      st.file = file.name;
      el.sheet.textContent = '';
      book.SheetNames.forEach(function (n) {
        var o = document.createElement('option');
        o.value = n;
        o.textContent = n;                           /* sheet name: user data, textContent only */
        el.sheet.appendChild(o);
      });
      loadSheet(book.SheetNames[0]);
    };
    fr.readAsArrayBuffer(file);
  }

  function loadSheet(name) {
    var sheet = st.book.Sheets[name];
    var rows = window.XLSX.utils.sheet_to_json(tightRange(sheet), { header: 1, raw: true, defval: '', blankrows: false });
    if (!rows.length) { toast(T('ورقة العمل المختارة لا تحتوي على صفوف.'), true); return; }
    if (rows.length > MAX_ROWS) { rows.length = MAX_ROWS; toast(T('الورقة «{0}» أطول من {1} صفّ — عُرض أول {1} فقط.', name, String(MAX_ROWS))); }
    st.rows = rows;
    el.sheet.value = name;
    buildColumns(true);
    el.name.textContent = st.file;                   /* filename: user data */
    el.rows.textContent = T('عدد الصفوف') + ': ' + st.data.length;
    el.meta.classList.remove('hide');
    el.drop.classList.add('hide');
    el['card-set'].classList.remove('hide');
    el['card-rev'].classList.remove('hide');
    run();
  }

  function buildColumns(auto) {
    var hasHead = el.header.checked;
    var width = st.rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    var headRow = hasHead ? st.rows[0] : [];

    st.headers = [];
    for (var i = 0; i < width; i++) {
      var label = hasHead ? cellText(headRow[i]).trim() : '';
      st.headers.push(label || window.XLSX.utils.encode_col(i));
    }
    st.data = hasHead ? st.rows.slice(1) : st.rows.slice(0);

    var prev = el.col.value;
    el.col.textContent = '';
    st.headers.forEach(function (label, i) {
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = window.XLSX.utils.encode_col(i) + ' — ' + label;   /* header: user data */
      el.col.appendChild(o);
    });

    st.col = (auto || prev === '' || Number(prev) >= width) ? detectColumn() : Number(prev);
    el.col.value = String(st.col);
  }

  function detectColumn() {
    var best = 0, bestScore = -1;
    st.headers.forEach(function (header, i) {
      var sample = st.data.slice(0, 60).map(function (r) { return cellText(r[i]); });
      var score = Core.scoreColumn(header, sample);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best;
  }

  function resetFile() {
    st.book = null; st.rows = []; st.data = []; st.res = []; st.page = 0;
    el.file.value = '';
    el.meta.classList.add('hide');
    el.drop.classList.remove('hide');
    el['card-set'].classList.add('hide');
    el['card-rev'].classList.add('hide');
  }

  /* ---------- the run ---------- */
  function run() {
    if (!st.data.length) return;
    st.col = Number(el.col.value) || 0;
    var values = st.data.map(function (r) { return cellText(r[st.col]); });
    st.res = Core.formatList(values, options());
    st.page = 0;
    paintStats();
    paintTable();
    savePrefs();
  }

  function counts() {
    var c = { total: st.res.length, ok: 0, fixed: 0, invalid: 0, foreign: 0, empty: 0, duplicate: 0 };
    st.res.forEach(function (it) {
      c[it.status] = (c[it.status] || 0) + 1;
      if (it.duplicate) c.duplicate++;
    });
    c.valid = c.ok + c.fixed + c.foreign;
    return c;
  }

  function paintStats() {
    var c = counts();
    var tiles = [
      ['الإجمالي', c.total, ''], ['صالحة', c.valid, 'ok'], ['تم تعديلها', c.fixed, ''],
      ['صحيحة أصلاً', c.ok, ''], ['غير صالحة', c.invalid, 'bad'], ['مكرّرة', c.duplicate, 'warn'],
      ['دولة أخرى', c.foreign, ''], ['فارغة', c.empty, '']
    ];
    el.stats.textContent = '';
    tiles.forEach(function (tile) {
      var box = document.createElement('div');
      box.className = 'stat ' + tile[2];
      var b = document.createElement('b');
      /* i18n-dyn: a count, not a label */
      b.textContent = String(tile[1]);
      var s = document.createElement('span');
      s.textContent = T(tile[0]);                    /* i18n-dyn: translated at the write */
      box.appendChild(b); box.appendChild(s);
      el.stats.appendChild(box);
    });
  }

  function passes(it) {
    switch (st.filter) {
      case 'fixed': return it.status === Core.STATUS.FIXED;
      case 'invalid': return it.status === Core.STATUS.INVALID || it.status === Core.STATUS.EMPTY;
      case 'duplicate': return !!it.duplicate;
      case 'foreign': return it.status === Core.STATUS.FOREIGN;
      default: return true;
    }
  }
  function filtered() {
    var needle = st.q.trim().toLowerCase();
    return st.res.map(function (it, i) { return { it: it, i: i }; })
      .filter(function (e) {
        if (!passes(e.it)) return false;
        if (!needle) return true;
        return (e.it.input + ' ' + e.it.output).toLowerCase().indexOf(needle) !== -1;
      });
  }

  var STATUS_AR = { ok: 'صحيح أصلاً', fixed: 'تم تنسيقه', invalid: 'غير صالح', empty: 'فارغ', foreign: 'دولة أخرى', duplicate: 'مكرّر' };
  var REASON_AR = { empty: 'خلية فارغة', 'no-digits': 'لا توجد أرقام', 'too-short': 'قصير جداً', unrecognized: 'الطول لا يطابق الدولة المختارة', 'not-mobile': 'ليس بادئة جوال', 'precision-lost': 'Excel قرّب الرقم (1.23E+11) — الخانات ضاعت؛ صدّر العمود كنص' };
  function statusLabel(it) { return T(STATUS_AR[it.duplicate ? 'duplicate' : it.status] || it.status); }

  function badge(it) {
    var key = it.duplicate ? 'duplicate' : it.status;
    var b = document.createElement('span');
    b.className = 'badge ' + key;
    b.textContent = statusLabel(it);                 /* i18n-dyn: a status name, translated here */
    if (REASON_AR[it.reason]) b.title = T(REASON_AR[it.reason]);
    return b;
  }

  function paintTable() {
    var rows = filtered();
    var pages = Math.max(1, Math.ceil(rows.length / PAGE));
    st.page = Math.min(st.page, pages - 1);
    var start = st.page * PAGE;
    var slice = rows.slice(start, start + PAGE);

    el.body.textContent = '';
    slice.forEach(function (e) {
      var it = e.it;
      var tr = document.createElement('tr');
      if (it.status === Core.STATUS.INVALID) tr.className = 'bad';
      else if (it.duplicate) tr.className = 'dup';

      var num = document.createElement('td');
      num.className = 'n';
      num.textContent = String(e.i + 1 + (el.header.checked ? 1 : 0));

      var orig = document.createElement('td');
      orig.className = 'n';
      orig.textContent = it.input;                   /* file data — textContent only */

      var made = document.createElement('td');
      made.className = 'n';
      made.textContent = (it.status === Core.STATUS.INVALID || it.status === Core.STATUS.EMPTY) ? '—' : it.output;

      var stt = document.createElement('td');
      stt.appendChild(badge(it));

      tr.appendChild(num); tr.appendChild(orig); tr.appendChild(made); tr.appendChild(stt);
      el.body.appendChild(tr);
    });

    el.none.classList.toggle('hide', rows.length > 0);
    el.page.textContent = rows.length
      ? T('عرض {0}–{1} من {2} صفّاً', String(start + 1), String(Math.min(start + PAGE, rows.length)), String(rows.length))
      : '';
    el.prev.disabled = st.page <= 0;
    el.next.disabled = st.page >= pages - 1;
  }

  /* ---------- export ---------- */
  function isValid(it) {
    return it.status === Core.STATUS.OK || it.status === Core.STATUS.FIXED || it.status === Core.STATUS.FOREIGN;
  }

  function exportRows() {
    var validOnly = el.validonly.checked, dedupe = el.dedupe.checked;
    var write = pickOne(WRITE_MODES, radio('ph-write'), 'new');
    var addStatus = el.statuscol.checked;
    var colName = el.colname.value.trim() || 'Formatted Phone';
    var col = st.col, out = [];

    if (el.header.checked) {
      var header = st.headers.slice(0);
      if (write === 'new') header.splice(col + 1, 0, colName);
      if (addStatus) header.push('Status');
      out.push(header);
    }

    st.data.forEach(function (row, i) {
      var it = st.res[i];
      if (!it) return;
      if (validOnly && !isValid(it)) return;
      if (dedupe && it.duplicate) return;

      var copy = [];
      for (var c = 0; c < st.headers.length; c++) copy.push(cellText(row[c]));
      var value = isValid(it) ? it.output : it.input;
      if (write === 'new') copy.splice(col + 1, 0, value); else copy[col] = value;
      if (addStatus) copy.push(statusLabel(it));
      out.push(copy);
    });
    return out;
  }

  function buildSheet(aoa) {
    var sheet = window.XLSX.utils.aoa_to_sheet(aoa);
    var width = aoa.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    var cols = [];
    for (var i = 0; i < width; i++) {
      var longest = aoa.reduce(function (m, r) { return Math.max(m, String(r[i] === undefined ? '' : r[i]).length); }, 8);
      cols.push({ wch: Math.min(40, longest + 2) });
    }
    sheet['!cols'] = cols;
    /* ⚠️ every string cell is forced to the text format. Without it Excel eats the
       leading '+' and the leading '00' — which is the entire output of this tool. */
    Object.keys(sheet).forEach(function (ref) {
      if (ref[0] !== '!' && sheet[ref].t === 's') sheet[ref].z = '@';
    });
    return sheet;
  }

  function baseName() {
    return (st.file || 'phones').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
  }
  function tooFew(aoa) {
    if (aoa.length > (el.header.checked ? 1 : 0)) return false;
    toast(T('لا توجد صفوف للتصدير بالخيارات الحالية.'), true);
    return true;
  }

  function exportXlsx() {
    var aoa = exportRows();
    if (tooFew(aoa)) return;
    var book = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(book, buildSheet(aoa), 'Formatted');
    var name = baseName() + '_formatted.xlsx';
    window.XLSX.writeFile(book, name, { compression: true });
    toast(T('تم تصدير الملف: {0}', name));
  }

  /* ⛔ CSV injection. A cell opening with = + - @ TAB or CR is executed by Excel
     when the file is opened — and this tool's DEFAULT output starts with '+', so
     the guard is not a corner case here, it is the main path. Prefix with a quote
     so the value is read as text. */
  function csvSafe(v) {
    var s = String(v === undefined || v === null ? '' : v);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }
  function exportCsv() {
    var aoa = exportRows();
    if (tooFew(aoa)) return;
    var safe = aoa.map(function (row) { return row.map(csvSafe); });
    var csv = window.XLSX.utils.sheet_to_csv(window.XLSX.utils.aoa_to_sheet(safe));
    var name = baseName() + '_formatted.csv';
    /* the BOM is what keeps Arabic readable when Excel opens the CSV */
    download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), name);
    toast(T('تم تصدير الملف: {0}', name));
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function copyNumbers() {
    var list = st.res.filter(function (it) {
      return it.output && isValid(it) && !(el.dedupe.checked && it.duplicate);
    }).map(function (it) { return it.output; });
    if (!list.length) { toast(T('لا توجد صفوف للتصدير بالخيارات الحالية.'), true); return; }
    var text = list.join('\n');
    var done = function () { toast(T('تم نسخ {0} رقماً إلى الحافظة.', String(list.length))); };
    var fail = function () { toast(T('فشل النسخ. المتصفّح منع الوصول إلى الحافظة.'), true); };
    try {
      navigator.clipboard.writeText(text).then(done).catch(fail);
    } catch (e) { fail(); }
  }

  /* ---------- wiring ---------- */
  function bind() {
    el.drop.addEventListener('click', function () { el.file.click(); });
    el.drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.file.click(); }
    });
    ['dragenter', 'dragover'].forEach(function (n) {
      el.drop.addEventListener(n, function (e) { e.preventDefault(); el.drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (n) {
      el.drop.addEventListener(n, function (e) { e.preventDefault(); el.drop.classList.remove('over'); });
    });
    el.drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files.length) readFile(e.dataTransfer.files[0]);
    });
    el.file.addEventListener('change', function (e) { readFile(e.target.files[0]); });
    el.change.addEventListener('click', resetFile);

    el.sheet.addEventListener('change', function () { loadSheet(el.sheet.value); });
    el.header.addEventListener('change', function () { buildColumns(false); run(); });
    el.col.addEventListener('change', run);

    el.country.addEventListener('change', function () { applyPreset(); run(); });
    [el.cc, el.len].forEach(function (node) {
      node.addEventListener('input', debounce(function () {
        var preset = Core.getCountry(el.cc.value.replace(/\D/g, ''));
        el.country.value = preset ? preset.id : '__custom';
        run();
      }, 350));
    });
    document.querySelectorAll('input[name="ph-fmt"], input[name="ph-write"]').forEach(function (n) {
      n.addEventListener('change', run);
    });
    ['arabic', 'foreign', 'dups', 'strict', 'statuscol', 'validonly', 'dedupe'].forEach(function (k) {
      el[k].addEventListener('change', run);
    });
    el.colname.addEventListener('input', debounce(savePrefs, 400));

    el.reset.addEventListener('click', function () {
      el.country.value = 'SA';
      applyPreset();
      setRadio('ph-fmt', 'plus');
      setRadio('ph-write', 'new');
      el.colname.value = 'Formatted Phone';
      el.arabic.checked = true; el.foreign.checked = true; el.dups.checked = true;
      el.strict.checked = false; el.statuscol.checked = false;
      el.validonly.checked = false; el.dedupe.checked = false;
      run();
      savePrefs();                                   /* also when no file is loaded yet */
    });

    el.filters.addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      st.filter = pickOne(FILTERS, b.getAttribute('data-f'), 'all');
      st.page = 0;
      el.filters.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('on', c === b); });
      paintTable();
    });
    el.search.addEventListener('input', debounce(function () {
      st.q = el.search.value; st.page = 0; paintTable();
    }, 250));
    el.prev.addEventListener('click', function () { st.page = Math.max(0, st.page - 1); paintTable(); });
    el.next.addEventListener('click', function () { st.page = st.page + 1; paintTable(); });

    el.xlsx.addEventListener('click', exportXlsx);
    el.csv.addEventListener('click', exportCsv);
    el.copy.addEventListener('click', copyNumbers);
  }

  /* ⚠️ the dictionary must land BEFORE the first paint: the country list and the
     status names are built from JS, and a list painted a frame early paints Arabic
     into an English page and is never repainted (§6.100/4). */
  function boot() {
    cache();
    bind();
    var ready = function () {
      buildCountries();
      applyPreset();
      if (!store) return;
      store.get(PREFS_KEY, null).then(function (p) { applyPrefs(p); });
    };
    if (store && SYFS.i18n && SYFS.i18n.apply) {
      store.get(SYFS.i18n.KEY, SYFS.i18n.DEFAULT)
        .then(function (l) { return SYFS.i18n.apply(l); })
        .then(ready, ready);
    } else ready();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());
