/* SYF — المصروفات والإيرادات (money, v0.174.0). One tool, six tabs, all local:
 *   إضافة · السجل · التقرير · الميزانية · إكسيل · الإعدادات
 *
 * Data lives in storage key `money` =
 *   { v:1, cur, rates:{CODE:rate}, bud:{catId:cents}, budAll, cats:[{id,n,ty,c}], tx:[{id,ty,a,cat,d,note,fc?,fa?,fr?}] }
 *   a   — the amount in CENTS (a whole number) in the DEFAULT currency `cur`: 0.1 + 0.2
 *         never reaches a total, and every total is in one currency.
 *   fc/fa/fr — an entry made in another currency keeps what was paid: the ISO code, the
 *         amount in its cents, and the rate used (1 fc = fr cur). a = round(fa × fr), fixed
 *         at entry time: a later rate never rewrites what an expense cost that day.
 *   rates — the last rate used per foreign currency (prefills the next entry).
 *   bud   — monthly limit per EXPENSE category, budAll the overall monthly limit (cents).
 *   d   — the LOCAL day 'YYYY-MM-DD' (never toISOString(), §5.9/4).
 *   ty  — 'out' (expense) | 'in' (income).
 * Everything read back from storage or from an imported file goes through clean()/
 * importAoa() first: an import or a settings restore could have written anything.
 *
 * Excel: SheetJS (lib/sheetjs, already in the package, zero eval) is loaded on the
 * first export/import only — a <script> tag on extension pages, SYFS_LOAD_XLSX (the
 * worker injects the packaged file into THIS tab) on web pages, the jsQR model.
 * Every file/note value reaches the DOM through textContent or value only.
 * The pure functions are exported on SYFS.money for tools/money-test.js. */
(function () {
  window.SYFS = window.SYFS || {};
  SYFS.tools = SYFS.tools || [];
  var store = SYFS.store, KEY = 'money', MAX_TX = 20000, MAX_IMPORT = 5000, MAX_FILE = 10 * 1048576, MAX_CENTS = 1e11;

  function h(html) {
    var tp = document.createElement('template'); tp.innerHTML = html.trim();
    var el = tp.content.firstElementChild;
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }
  function t() { return SYFS.t ? SYFS.t.apply(null, arguments) : arguments[0]; }
  function loc() { return (SYFS.i18n && SYFS.i18n.locale) ? SYFS.i18n.locale() : 'ar-EG'; }
  function dir() { return (SYFS.i18n && SYFS.i18n.dir) ? SYFS.i18n.dir() : 'rtl'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function dlBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }
  function ask(type, cb) {
    var done = false;
    function fin(r) { if (done) return; done = true; cb(r || { ok: false }); }
    try { chrome.runtime.sendMessage({ type: type }, function (r) { void chrome.runtime.lastError; fin(r); }); } catch (e) { fin(); }
    setTimeout(function () { fin({ ok: false, timeout: true }); }, 8000);
  }
  /* two-click delete: the first click arms the button, the second within 3s acts (no confirm()) */
  function armed(btn, label, fn) {
    var on = false, tm = 0;
    btn.addEventListener('click', function () {
      if (on) { clearTimeout(tm); on = false; btn.textContent = label; fn(); return; }
      on = true; btn.textContent = t('تأكيد؟');
      tm = setTimeout(function () { on = false; btn.textContent = label; }, 3000);
    });
  }

  /* ---------------- data ---------------- */
  var PALETTE = ['#d9822b', '#3b82c4', '#8b5cc6', '#457364', '#d0505a', '#c69a1d', '#2a9d8f', '#8a948f', '#1f8a5b', '#3fa37a', '#6cbf96', '#b5651d', '#5b7fd6', '#c2457a'];
  /* the default names are msgids: shown through t() while the user has not renamed them */
  var DEF_CATS = [
    { id: 'food', n: 'طعام', ty: 'out', c: '#d9822b' }, { id: 'transport', n: 'مواصلات', ty: 'out', c: '#3b82c4' },
    { id: 'bills', n: 'فواتير', ty: 'out', c: '#8b5cc6' }, { id: 'rent', n: 'إيجار', ty: 'out', c: '#457364' },
    { id: 'health', n: 'صحة', ty: 'out', c: '#d0505a' }, { id: 'shop', n: 'تسوق', ty: 'out', c: '#c69a1d' },
    { id: 'edu', n: 'تعليم', ty: 'out', c: '#2a9d8f' }, { id: 'other', n: 'أخرى', ty: 'out', c: '#8a948f' },
    { id: 'salary', n: 'راتب', ty: 'in', c: '#1f8a5b' }, { id: 'free', n: 'عمل حر', ty: 'in', c: '#3fa37a' },
    { id: 'other_in', n: 'دخل آخر', ty: 'in', c: '#6cbf96' }
  ];
  /* c = ISO code (stored), s = the short mark shown beside a total, n = the name in lists.
     s and n are msgids: the English dictionary maps «ج.م» to «EGP». */
  var CURS = [
    { c: 'EGP', s: 'ج.م', n: 'جنيه مصري' }, { c: 'SAR', s: 'ر.س', n: 'ريال سعودي' }, { c: 'AED', s: 'د.إ', n: 'درهم إماراتي' },
    { c: 'KWD', s: 'د.ك', n: 'دينار كويتي' }, { c: 'QAR', s: 'ر.ق', n: 'ريال قطري' }, { c: 'BHD', s: 'د.ب', n: 'دينار بحريني' },
    { c: 'OMR', s: 'ر.ع', n: 'ريال عماني' }, { c: 'JOD', s: 'د.أ', n: 'دينار أردني' }, { c: 'IQD', s: 'د.ع', n: 'دينار عراقي' },
    { c: 'MAD', s: 'د.م', n: 'درهم مغربي' }, { c: 'TND', s: 'د.ت', n: 'دينار تونسي' }, { c: 'DZD', s: 'د.ج', n: 'دينار جزائري' },
    { c: 'LYD', s: 'د.ل', n: 'دينار ليبي' }, { c: 'SDG', s: 'ج.س', n: 'جنيه سوداني' }, { c: 'TRY', s: '₺', n: 'ليرة تركية' },
    { c: 'USD', s: '$', n: 'دولار أمريكي' }, { c: 'EUR', s: '€', n: 'يورو' }, { c: 'GBP', s: '£', n: 'جنيه إسترليني' }
  ];
  var CUR_BY = {}; CURS.forEach(function (x) { CUR_BY[x.c] = x; });
  /* v0.174.0 builds before the multi-currency change stored the mark itself */
  var OLD_CUR = { 'ج.م': 'EGP', 'ر.س': 'SAR', 'د.إ': 'AED', 'د.ك': 'KWD', 'ر.ق': 'QAR', 'د.أ': 'JOD', 'د.ب': 'BHD', 'ر.ع': 'OMR', '$': 'USD', '€': 'EUR' };
  function curSym(c) { return CUR_BY[c] ? t(CUR_BY[c].s) : c; }
  function fresh() { return { v: 1, cur: 'EGP', rates: {}, bud: {}, budAll: 0, cats: DEF_CATS.map(function (c) { return Object.assign({}, c); }), tx: [] }; }
  function okRate(r) { r = +r; return isFinite(r) && r > 0 && r < 1e7 ? r : 0; }
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/, ID_RE = /^[A-Za-z0-9_-]{1,40}$/, HEX_RE = /^#[0-9a-fA-F]{6}$/;
  function str(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }
  /* whatever storage holds, return a well-formed book */
  function clean(raw) {
    var out = fresh();
    if (!raw || typeof raw !== 'object') return out;
    if (CUR_BY[raw.cur]) out.cur = raw.cur; else if (OLD_CUR[raw.cur]) out.cur = OLD_CUR[raw.cur];
    if (raw.rates && typeof raw.rates === 'object') Object.keys(raw.rates).forEach(function (k) {
      if (CUR_BY[k] && k !== out.cur && okRate(raw.rates[k])) out.rates[k] = okRate(raw.rates[k]);
    });
    var bA = Math.round(+raw.budAll); if (bA > 0 && bA <= MAX_CENTS) out.budAll = bA;
    if (Array.isArray(raw.cats) && raw.cats.length) {
      var seen = {}, cats = [];
      raw.cats.slice(0, 200).forEach(function (c) {
        if (!c || !ID_RE.test(c.id) || seen[c.id]) return;
        var n = str(c.n, 30); if (!n) return;
        seen[c.id] = 1;
        cats.push({ id: c.id, n: n, ty: c.ty === 'in' ? 'in' : 'out', c: HEX_RE.test(c.c) ? c.c : '#8a948f' });
      });
      /* the two fall-backs always exist: deleting a category moves its rows there */
      if (!seen.other) cats.push(Object.assign({}, DEF_CATS[7]));
      if (!seen.other_in) cats.push(Object.assign({}, DEF_CATS[10]));
      out.cats = cats;
    }
    var ids = {}; out.cats.forEach(function (c) { ids[c.id] = c.ty; });
    if (raw.bud && typeof raw.bud === 'object') Object.keys(raw.bud).forEach(function (k) {
      var v = Math.round(+raw.bud[k]); if (ids[k] === 'out' && v > 0 && v <= MAX_CENTS) out.bud[k] = v;
    });
    if (Array.isArray(raw.tx)) {
      raw.tx.slice(0, MAX_TX).forEach(function (r) {
        if (!r || !ID_RE.test(r.id)) return;
        var a = Math.round(+r.a);
        if (!(a > 0 && a <= MAX_CENTS) || !DAY_RE.test(r.d)) return;
        var ty = r.ty === 'in' ? 'in' : 'out';
        var cat = ids[r.cat] === ty ? r.cat : (ty === 'in' ? 'other_in' : 'other');
        var rec = { id: r.id, ty: ty, a: a, cat: cat, d: r.d, note: str(r.note, 140) };
        var fa = Math.round(+r.fa), fr = okRate(r.fr);
        if (CUR_BY[r.fc] && fa > 0 && fa <= MAX_CENTS && fr) { rec.fc = r.fc; rec.fa = fa; rec.fr = fr; }
        out.tx.push(rec);
      });
    }
    return out;
  }
  function uid() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  /* i18n-skip-start: digit tables and column-name aliases are LOOKUP KEYS read from a file, never shown */
  /* «1,250.5» «١٬٢٥٠٫٥» «EGP 300» «-40» ⇒ cents (signed), or NaN */
  function toCents(v) {
    if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) : NaN;
    var s = String(v == null ? '' : v)
      .replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); })
      .replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); })
      .replace(/٫/g, '.').replace(/[٬,\s]/g, '');
    /* «=1+1», «2*3», «10-4»: an expression is not an amount (stripping it to «11» would be a lie) */
    if (/[=*\/^]/.test(s) || /\d[+-]\d/.test(s)) return NaN;
    var neg = /^\(.*\)$/.test(s) || /^-|-$/.test(s.replace(/[^\d.-]/g, ''));
    s = s.replace(/[^\d.]/g, '');
    if (!s || (s.match(/\./g) || []).length > 1) return NaN;
    var n = Math.round(parseFloat(s) * 100);
    return isFinite(n) ? (neg ? -n : n) : NaN;
  }
  /* a cell from Excel or a CSV ⇒ 'YYYY-MM-DD' or '' */
  function toDay(v) {
    function ok(y, m, d) {
      var dt = new Date(y, m - 1, d);
      return (y > 1900 && y < 2200 && dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) ? ymd(dt) : '';
    }
    if (Object.prototype.toString.call(v) === '[object Date]') {
      if (isNaN(v)) return '';
      /* SheetJS builds a cell date at UTC midnight (+ a few seconds of float error):
         round to the nearest UTC day before reading it as a calendar date */
      var u = new Date(Math.round(v.getTime() / 864e5) * 864e5);
      return ok(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate());
    }
    if (typeof v === 'number') {
      if (v < 1 || v > 100000) return '';
      var e = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5);   /* Excel serial */
      return ok(e.getUTCFullYear(), e.getUTCMonth() + 1, e.getUTCDate());
    }
    var s = String(v == null ? '' : v).trim().replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); });
    var m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return ok(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (m) return ok(+m[3], +m[2], +m[1]);      /* day first: the Arab and European order */
    return '';
  }
  function monthOf(d) { return d.slice(0, 7); }
  function shiftMonth(m, k) { var y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + k; var d = new Date(y, mo, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function totals(list) { var i = 0, o = 0; list.forEach(function (r) { if (r.ty === 'in') i += r.a; else o += r.a; }); return { i: i, o: o, n: i - o }; }
  function inMonth(tx, m) { return tx.filter(function (r) { return monthOf(r.d) === m; }); }
  function byCat(list, ty) {
    var m = {}, n = {};
    list.forEach(function (r) { if (r.ty !== ty) return; m[r.cat] = (m[r.cat] || 0) + r.a; n[r.cat] = (n[r.cat] || 0) + 1; });
    return Object.keys(m).map(function (k) { return { cat: k, a: m[k], n: n[k] }; }).sort(function (a, b) { return b.a - a.a; });
  }
  function sortDesc(list) { return list.slice().sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : (a.id < b.id ? 1 : -1); }); }
  function sortAsc(list) { return sortDesc(list).reverse(); }
  function dupKey(r) { return r.d + '|' + r.ty + '|' + r.a + '|' + (r.note || '').toLowerCase(); }

  /* ---------------- import: rows of cells ⇒ transactions ---------------- */
  var ALIAS = {
    d: ['التاريخ', 'تاريخ', 'اليوم', 'date', 'day'],
    ty: ['النوع', 'نوع', 'type', 'kind'],
    cat: ['التصنيف', 'تصنيف', 'الفئة', 'البند', 'category', 'cat'],
    note: ['ملاحظة', 'ملاحظات', 'الوصف', 'البيان', 'note', 'notes', 'description', 'memo', 'details'],
    a: ['المبلغ', 'مبلغ', 'القيمة', 'amount', 'value', 'sum'],
    inc: ['إيراد', 'ايراد', 'الإيرادات', 'الايرادات', 'دخل', 'income', 'credit', 'in'],
    exp: ['مصروف', 'المصروفات', 'مصروفات', 'expense', 'expenses', 'debit', 'out'],
    fc: ['العملة الأصلية', 'العملة', 'currency', 'original currency'],
    fa: ['المبلغ الأصلي', 'original amount'],
    fr: ['سعر الصرف', 'rate', 'exchange rate']
  };
  /* i18n-skip-end */
  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/\s+/g, ' '); }
  function findHeader(aoa) {
    for (var r = 0; r < Math.min(aoa.length, 15); r++) {
      var row = aoa[r] || [], map = {};
      row.forEach(function (cell, ci) {
        var k = norm(cell); if (!k) return;
        Object.keys(ALIAS).forEach(function (f) {
          if (map[f] == null && ALIAS[f].some(function (a) { return norm(a) === k; })) map[f] = ci;
        });
      });
      if (map.d != null && (map.a != null || map.inc != null || map.exp != null)) return { row: r, map: map };
    }
    return null;
  }
  function tyOf(v) {
    var k = norm(v);
    if (!k) return '';
    if (/^(ايراد|دخل|income|in|credit|\+)/.test(k)) return 'in';
    if (/^(مصروف|مصاريف|expense|out|debit|-)/.test(k)) return 'out';
    return '';
  }
  /* aoa = sheet as an array of rows. book = the current data (read only).
     ⇒ { rows, newCats, dup, bad, header:false? } — nothing is written here */
  function importAoa(aoa, book) {
    var hd = findHeader(aoa || []);
    if (!hd) return { header: false, rows: [], newCats: [], dup: 0, bad: 0 };
    var M = hd.map, rows = [], newCats = [], bad = 0, dup = 0;
    var have = {}; book.tx.forEach(function (r) { have[dupKey(r)] = 1; });
    var catBy = {}; book.cats.forEach(function (c) { catBy[c.ty + '|' + norm(c.n)] = c.id; catBy[c.ty + '|' + norm(t(c.n))] = c.id; });
    var used = {}; book.cats.forEach(function (c) { used[c.id] = 1; });
    for (var r = hd.row + 1; r < aoa.length && rows.length < MAX_IMPORT; r++) {
      var row = aoa[r] || [];
      if (!row.some(function (c) { return String(c == null ? '' : c).trim(); })) continue;
      var d = toDay(row[M.d]);
      if (!d) { bad++; continue; }                         /* the total row, a title, a broken date */
      var ty = M.ty != null ? tyOf(row[M.ty]) : '', a = NaN;
      if (M.inc != null || M.exp != null) {
        var ci = M.inc != null ? toCents(row[M.inc]) : NaN, ce = M.exp != null ? toCents(row[M.exp]) : NaN;
        if (ci > 0) { a = ci; ty = ty || 'in'; } else if (ce > 0) { a = ce; ty = ty || 'out'; }
      }
      if (!(a > 0) && M.a != null) {
        a = toCents(row[M.a]);
        if (a < 0) { a = -a; ty = ty || 'out'; }
      }
      if (!(a > 0 && a <= MAX_CENTS)) { bad++; continue; }
      ty = ty || 'out';
      var cname = M.cat != null ? str(row[M.cat], 30) : '', cat = ty === 'in' ? 'other_in' : 'other';
      if (cname) {
        var key = ty + '|' + norm(cname);
        if (catBy[key]) cat = catBy[key];
        else {
          var id = 'c' + (Object.keys(used).length + newCats.length) + Math.random().toString(36).slice(2, 6);
          var nc = { id: id, n: cname, ty: ty, c: PALETTE[(book.cats.length + newCats.length) % PALETTE.length] };
          newCats.push(nc); catBy[key] = id; cat = id;
        }
      }
      var rec = { id: uid() + rows.length, ty: ty, a: a, cat: cat, d: d, note: M.note != null ? str(row[M.note], 140) : '' };
      if (M.fc != null && M.fa != null && M.fr != null) {
        var fc = str(row[M.fc], 3).toUpperCase(), fa = toCents(row[M.fa]), fr = okRate(row[M.fr]);
        if (CUR_BY[fc] && fc !== book.cur && fa > 0 && fa <= MAX_CENTS && fr) { rec.fc = fc; rec.fa = fa; rec.fr = fr; }
      }
      if (have[dupKey(rec)]) { dup++; rec.dup = true; }
      rows.push(rec);
    }
    return { header: true, rows: rows, newCats: newCats, dup: dup, bad: bad };
  }

  /* ---------------- export: the three sheets as arrays of rows ---------------- */
  function catName(book, id) { var c = book.cats.filter(function (x) { return x.id === id; })[0]; return c ? t(c.n) : ''; }
  function tyName(ty) { return ty === 'in' ? t('إيراد') : t('مصروف'); }
  function sheets(book, list) {
    var tx = [[t('التاريخ'), t('النوع'), t('التصنيف'), t('ملاحظة'), t('المبلغ'), t('الصافي'), t('العملة الأصلية'), t('المبلغ الأصلي'), t('سعر الصرف')]];
    sortAsc(list).forEach(function (r) {
      tx.push([r.d, tyName(r.ty), catName(book, r.cat), r.note, r.a / 100, (r.ty === 'in' ? 1 : -1) * r.a / 100,
        r.fc || '', r.fc ? r.fa / 100 : '', r.fc ? r.fr : '']);
    });
    var T = totals(list);
    tx.push([t('الإجمالي'), '', '', '', '', T.n / 100, '', '', '']);

    var months = {}; list.forEach(function (r) { var m = monthOf(r.d); (months[m] = months[m] || []).push(r); });
    var mon = [[t('الشهر'), t('الإيرادات'), t('المصروفات'), t('الصافي')]];
    Object.keys(months).sort().forEach(function (m) { var x = totals(months[m]); mon.push([m, x.i / 100, x.o / 100, x.n / 100]); });
    mon.push([t('الإجمالي'), T.i / 100, T.o / 100, T.n / 100]);

    var cat = [[t('التصنيف'), t('النوع'), t('المبلغ'), t('النسبة %'), t('عدد الحركات')]];
    ['out', 'in'].forEach(function (ty) {
      var all = ty === 'in' ? T.i : T.o;
      byCat(list, ty).forEach(function (x) { cat.push([catName(book, x.cat), tyName(ty), x.a / 100, all ? Math.round(x.a / all * 1000) / 10 : 0, x.n]); });
    });
    return { tx: tx, month: mon, cat: cat };
  }
  /* ⚠️ CSV INJECTION: Excel runs a CSV cell that starts with = + - @ (or tab / CR) as a
     formula. A note is user text and an imported note is a stranger's text: prefix it.
     (The .xlsx cells are written as string-typed cells, which Excel never evaluates.) */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(aoa) { return '﻿' + aoa.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'); }

  /* spent vs limit for one month: [{cat, lim, used}] for every limited category, plus the overall */
  function budStatus(book, m) {
    var spent = {}, all = 0;
    book.tx.forEach(function (r) { if (r.ty !== 'out' || monthOf(r.d) !== m) return; spent[r.cat] = (spent[r.cat] || 0) + r.a; all += r.a; });
    return {
      cats: Object.keys(book.bud).map(function (k) { return { cat: k, lim: book.bud[k], used: spent[k] || 0 }; }).sort(function (a, b) { return b.used / b.lim - a.used / a.lim; }),
      all: { lim: book.budAll, used: all }
    };
  }
  SYFS.money = { budStatus: budStatus, clean: clean, toCents: toCents, toDay: toDay, importAoa: importAoa, sheets: sheets, totals: totals, byCat: byCat, csvCell: csvCell, toCsv: toCsv, shiftMonth: shiftMonth, fresh: fresh };

  /* ---------------- SheetJS on demand ---------------- */
  function ensureXLSX(cb) {
    if (window.XLSX && window.XLSX.utils) { cb(true); return; }
    if (location.protocol === 'chrome-extension:') {
      var s = document.createElement('script'); s.src = chrome.runtime.getURL('lib/sheetjs/xlsx.full.min.js');
      s.onload = function () { cb(!!window.XLSX); }; s.onerror = function () { cb(false); };
      document.head.appendChild(s); return;
    }
    ask('SYFS_LOAD_XLSX', function (r) { cb(!!(r.ok && window.XLSX)); });
  }

  /* ---------------- view helpers ---------------- */
  var IC = {
    add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
    log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
    rep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/></svg>',
    xl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/></svg>',
    bud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></svg>',
    set: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8" r="1.3"/></svg>'
  };
  /* amounts in Latin digits whatever the language: in Arabic digits the thousands mark ٬
     and the decimal mark ٫ look alike at this size, and 12٬463٫25 misread is a money error */
  function money(c) {
    var v = c / 100;
    try { return v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); } catch (e) { return String(v); }
  }
  function monthLabel(m) {
    try { return new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1).toLocaleDateString(loc(), { month: 'long', year: 'numeric' }); } catch (e) { return m; }
  }
  function dayLabel(d) {
    try { return new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)).toLocaleDateString(loc(), { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { return d; }
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function amt(c, ty, signed) { var s = el('span', 'syf-mny-amt ' + (ty || '')); s.textContent = (signed ? (ty === 'in' ? '+' : '−') : '') + money(c); return s; }
  function kpis(list, cur) {
    var T = totals(list), box = h('<div class="syf-mny-kpis"><div class="k in"><small>الإيرادات</small><b></b></div><div class="k out"><small>المصروفات</small><b></b></div><div class="k net"><small>الصافي</small><b></b></div></div>');
    var b = box.querySelectorAll('b');
    b[0].textContent = money(T.i); b[1].textContent = money(T.o);
    b[2].textContent = (T.n < 0 ? '−' : '') + money(Math.abs(T.n)) + ' ' + curSym(cur);
    if (T.n < 0) box.querySelector('.net').classList.add('neg');
    return box;
  }
  function swatch(c, name) { var s = el('span', 'syf-mny-sw', (name || '?').charAt(0)); s.style.background = HEX_RE.test(c) ? c : '#8a948f'; return s; }
  function catSelect(book, ty, val) {
    var s = el('select', 'syf-in');
    book.cats.filter(function (c) { return c.ty === ty; }).forEach(function (c) {
      var o = el('option', null, t(c.n)); o.value = c.id; if (c.id === val) o.selected = true; s.appendChild(o);
    });
    return s;
  }
  function typeSeg(val, onPick) {
    var seg = h('<div class="syf-seg syf-mny-ty" role="group" aria-label="النوع"><button type="button" data-t="out">مصروف</button><button type="button" data-t="in">إيراد</button></div>');
    function mark(v) { seg.querySelectorAll('button').forEach(function (b) { var on = b.dataset.t === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }
    mark(val);
    seg.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; mark(b.dataset.t); onPick(b.dataset.t); });
    return seg;
  }
  function monthNav(m, onMove) {
    var nav = h('<div class="syf-mny-mon"><button type="button" class="syf-mny-nav" data-k="-1" aria-label="الشهر السابق"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg></button><b></b><button type="button" class="syf-mny-nav" data-k="1" aria-label="الشهر التالي"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button></div>');
    nav.querySelector('b').textContent = monthLabel(m);
    nav.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) onMove(+b.dataset.k); });
    return nav;
  }
  function msg(box, text, bad) { box.textContent = text; box.classList.toggle('bad', !!bad); box.hidden = !text; }

  /* ---------------- the tool ---------------- */
  function mount(body) {
    var book = fresh(), S = { month: monthOf(today()), ty: 'out', f: { m: monthOf(today()), ty: 'all', q: '' }, edit: '' };
    var wait = h('<div class="syf-empty">جارٍ التحميل…</div>');
    body.appendChild(wait);
    function save() { return store.set(KEY, book); }
    function cat(id) { return book.cats.filter(function (c) { return c.id === id; })[0] || { n: '?', c: '#8a948f', ty: 'out' }; }

    /* one transaction row (shared by «إضافة» and «السجل») */
    function txRow(r, withTools, repaint) {
      var c = cat(r.cat), row = el('div', 'syf-mny-tx');
      row.appendChild(swatch(c.c, t(c.n)));
      /* no note ⇒ the category IS the title: the sub-line then carries only the original
         currency (if any), never the category a second time */
      var mid = el('div', 'syf-mny-t'), sub = (r.note ? [t(c.n)] : []).concat(r.fc ? [money(r.fa) + ' ' + r.fc] : []).join(' · ');
      mid.appendChild(el('b', null, r.note || t(c.n)));
      if (sub) mid.appendChild(el('small', null, sub));
      row.appendChild(mid); row.appendChild(amt(r.a, r.ty, true));
      if (withTools) {
        var tools = h('<span class="syf-mny-rt"><button type="button" class="syf-mny-ib" data-a="e" title="تعديل" aria-label="تعديل">✎</button><button type="button" class="syf-mny-ib" data-a="x" title="حذف" aria-label="حذف">×</button></span>');
        tools.addEventListener('click', function (e) {
          var b = e.target.closest('button'); if (!b) return;
          if (b.dataset.a === 'e') { S.edit = r.id; repaint(); return; }
          var i = book.tx.indexOf(r); if (i < 0) return;
          var host = row.closest('.syf-tabpanel') || body;
          book.tx.splice(i, 1); save(); repaint(); undoBar(r, i, repaint, host);
        });
        row.appendChild(tools);
      }
      return row;
    }
    var undoEl = null;
    function undoBar(r, i, repaint, host) {
      if (undoEl) undoEl.remove();
      undoEl = h('<div class="syf-mny-undo" role="status"><span>حُذفت الحركة.</span><button type="button" class="syf-mini">تراجع</button></div>');
      var mine = undoEl;
      mine.querySelector('button').addEventListener('click', function () { book.tx.splice(Math.min(i, book.tx.length), 0, r); save(); mine.remove(); repaint(); });
      host.insertBefore(mine, host.firstChild);
      setTimeout(function () { mine.remove(); }, 7000);
    }
    /* the rate for 1 `fc` in the default currency: the last one used ⇒ the currency tool's
       cache (fx_<base>, either direction) ⇒ the network (same endpoint as «العملات», via
       the worker). The result says where it came from: a rate is never shown undated. */
    function getRate(fc, fresh) {
      var def = book.cur;
      if (!fresh && book.rates[fc]) return Promise.resolve({ r: book.rates[fc], src: 'last' });
      if (!fresh) {                                       /* an older entry in that currency */
        var prev = sortDesc(book.tx).filter(function (x) { return x.fc === fc; })[0];
        if (prev) return Promise.resolve({ r: prev.fr, src: 'last' });
      }
      function fromCache() {
        return store.get('fx_' + def, null).then(function (c) {
          if (c && c.rates && okRate(c.rates[fc])) return { r: 1 / c.rates[fc], src: 'cache', t: c.t };
          return store.get('fx_' + fc, null).then(function (c2) {
            return (c2 && c2.rates && okRate(c2.rates[def])) ? { r: +c2.rates[def], src: 'cache', t: c2.t } : null;
          });
        });
      }
      function fromNet() {
        if (!SYFS.bgFetch) return Promise.resolve(null);
        return SYFS.bgFetch('https://open.er-api.com/v6/latest/' + encodeURIComponent(fc), { cache: 'no-cache' }).then(function (res) {
          if (!res || !res.ok) return null;
          var j = JSON.parse(res.body);
          if (!j || !j.rates || !okRate(j.rates[def])) return null;
          store.set('fx_' + fc, { t: j.time_last_update_unix || 0, rates: j.rates });
          return { r: +j.rates[def], src: 'net', t: j.time_last_update_unix || 0 };
        }).catch(function () { return null; });
      }
      return (fresh ? fromNet() : fromCache().then(function (x) { return x || fromNet(); })).then(function (x) { return x || { r: 0, src: 'none' }; });
    }
    function rateNum(v) {
      var s2 = String(v == null ? '' : v).replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }).replace(/٫/g, '.').replace(/[٬,\s]/g, '');
      return /^\d*\.?\d+$/.test(s2) ? okRate(parseFloat(s2)) : 0;
    }
    /* amount + currency picker; a foreign currency opens the rate row. read() ⇒ the record fields */
    function amountField(cls, fc, fa, fr) {
      var box = h('<div class="syf-mny-amtbox"><div class="syf-mny-amtrow"><input class="syf-in ' + cls + '" inputmode="decimal" placeholder="0.00" data-f="a" autocomplete="off" aria-label="المبلغ"><select class="syf-in syf-mny-cur" aria-label="العملة"></select></div>' +
        '<div class="syf-mny-fx" hidden><span class="syf-mny-fxl"></span><input class="syf-in" inputmode="decimal" data-f="r" aria-label="سعر الصرف"><span class="syf-mny-fxd"></span><button type="button" class="syf-mini" data-a="rate">تحديث السعر</button><small class="syf-mny-conv"></small></div></div>');
      var A = box.querySelector('[data-f="a"]'), CS = box.querySelector('select'), FX = box.querySelector('.syf-mny-fx'), R = box.querySelector('[data-f="r"]'), CV = box.querySelector('.syf-mny-conv'), src = '';
      CURS.forEach(function (x) { var o = el('option', null, x.c === book.cur ? x.c + ' ★' : x.c); o.value = x.c; o.title = t(x.n); CS.appendChild(o); });
      CS.value = fc || book.cur;
      if (fa) A.value = String(fa / 100);
      function conv() {
        if (CS.value === book.cur) { CV.textContent = ''; return; }
        var c = toCents(A.value), r = rateNum(R.value);
        CV.textContent = (c > 0 && r) ? '= ' + money(Math.round(c * r)) + ' ' + curSym(book.cur) + (src ? ' · ' + src : '') : (r ? src : (src || t('اكتب سعر الصرف.')));
      }
      function said(x) {
        src = x.src === 'last' ? t('آخر سعر استخدمته') : x.src === 'net' ? t('سعر اليوم من الإنترنت') :
          x.src === 'cache' ? t('سعر مخزَّن من {0}', x.t ? new Date(x.t * 1000).toLocaleDateString(loc()) : '?') : t('تعذّر جلب السعر — اكتبه بنفسك.');
      }
      function pick(fresh) {
        var c = CS.value;
        FX.hidden = c === book.cur;
        if (c === book.cur) { conv(); return; }
        box.querySelector('.syf-mny-fxl').textContent = '1 ' + c + ' =';
        box.querySelector('.syf-mny-fxd').textContent = book.cur;
        if (!fresh && fr && c === fc) { R.value = String(fr); src = ''; conv(); return; }
        CV.textContent = t('جارٍ جلب السعر…');
        getRate(c, fresh).then(function (x) {
          if (CS.value !== c) return;
          if (x.r) R.value = String(Math.round(x.r * 1e6) / 1e6);
          said(x); conv();
        });
      }
      CS.addEventListener('change', function () { pick(false); });
      box.querySelector('[data-a="rate"]').addEventListener('click', function () { pick(true); });
      A.addEventListener('input', conv); R.addEventListener('input', function () { src = ''; conv(); });
      pick(false);
      return {
        el: box, input: A,
        reset: function () { A.value = ''; conv(); },
        read: function () {
          var c = toCents(A.value);
          if (!(c > 0 && c <= MAX_CENTS)) return { err: t('اكتب مبلغاً أكبر من صفر.'), at: A };
          if (CS.value === book.cur) return { a: c };
          var r = rateNum(R.value);
          if (!r) return { err: t('اكتب سعر الصرف.'), at: R };
          var a = Math.round(c * r);
          if (!(a > 0 && a <= MAX_CENTS)) return { err: t('اكتب مبلغاً أكبر من صفر.'), at: A };
          book.rates[CS.value] = r;
          return { a: a, fc: CS.value, fa: c, fr: r };
        }
      };
    }
    function setAmount(r, v) { r.a = v.a; if (v.fc) { r.fc = v.fc; r.fa = v.fa; r.fr = v.fr; } else { delete r.fc; delete r.fa; delete r.fr; } }
    /* after an expense: has its category (or the month) crossed 80% / 100% of its budget? */
    function budNote(r) {
      if (r.ty !== 'out') return null;
      var st = budStatus(book, monthOf(r.d)), hit = null;
      st.cats.forEach(function (x) { if (x.cat === r.cat) hit = { n: t(cat(x.cat).n), lim: x.lim, used: x.used }; });
      if (!hit && st.all.lim) hit = { n: t('الشهر'), lim: st.all.lim, used: st.all.used };
      if (!hit) return null;
      var pc = hit.used / hit.lim;
      if (pc >= 1) return { bad: true, text: t('تجاوزت ميزانية «{0}»: {1} من {2}.', hit.n, money(hit.used), money(hit.lim)) };
      if (pc >= 0.8) return { warn: true, text: t('وصلت إلى {0}% من ميزانية «{1}».', Math.round(pc * 100), hit.n) };
      return null;
    }
    function editor(r, repaint) {
      var f = h('<form class="syf-mny-edit"><div class="syf-mny-grid"><label class="syf-mny-wide">المبلغ<span data-f="amt"></span></label><label>التصنيف<span data-f="cat"></span></label><label>التاريخ<input class="syf-in" type="date" data-f="d"></label><label>ملاحظة<input class="syf-in" maxlength="140" data-f="note"></label></div><div class="syf-row"><button type="submit" class="syf-btn">حفظ</button><button type="button" class="syf-mini" data-a="c">إلغاء</button><span class="syf-mny-msg" hidden></span></div></form>');
      var AF = amountField('', r.fc, r.fc ? r.fa : r.a, r.fr), A = AF.input, D = f.querySelector('[data-f="d"]'), N = f.querySelector('[data-f="note"]'), sel = catSelect(book, r.ty, r.cat);
      f.querySelector('[data-f="amt"]').replaceWith(AF.el);
      f.querySelector('[data-f="cat"]').replaceWith(sel);
      D.value = r.d; N.value = r.note;
      f.querySelector('[data-a="c"]').addEventListener('click', function () { S.edit = ''; repaint(); });
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = AF.read();
        if (v.err) { msg(f.querySelector('.syf-mny-msg'), v.err, true); v.at.focus(); return; }
        if (!DAY_RE.test(D.value)) { msg(f.querySelector('.syf-mny-msg'), t('اختر تاريخاً صحيحاً.'), true); D.focus(); return; }
        setAmount(r, v); r.d = D.value; r.note = str(N.value, 140); r.cat = sel.value;
        S.edit = ''; save(); repaint();
      });
      setTimeout(function () { A.focus(); A.select(); }, 0);
      return f;
    }
    function dayList(list, box, withTools, repaint) {
      box.textContent = '';
      if (!list.length) { box.appendChild(h('<div class="syf-empty">لا توجد حركات بعد.</div>')); return; }
      var last = '';
      sortDesc(list).forEach(function (r) {
        if (r.d !== last) {
          last = r.d;
          var day = list.filter(function (x) { return x.d === r.d; }), dt = totals(day), dh = el('div', 'syf-mny-day');
          dh.appendChild(el('span', null, dayLabel(r.d)));
          /* a one-entry day: its total would only repeat the row under it */
          if (day.length > 1) dh.appendChild(amt(Math.abs(dt.n), dt.n < 0 ? 'out' : 'in', true));
          box.appendChild(dh);
        }
        box.appendChild(S.edit === r.id && withTools ? editor(r, repaint) : txRow(r, withTools, repaint));
      });
    }

    /* ---- tab 1: إضافة ---- */
    function tabAdd(p) {
      var top = el('div'), recent = el('div', 'syf-mny-list');
      var f = h('<form class="syf-mny-form" novalidate><div data-f="ty"></div><div class="syf-mny-grid"><label class="syf-mny-wide">المبلغ<span data-f="amt"></span></label><label>التصنيف<span data-f="cat"></span></label><label>التاريخ<input class="syf-in" type="date" data-f="d"></label><label class="syf-mny-wide">ملاحظة<input class="syf-in" maxlength="140" data-f="note" placeholder="مثال: غداء العمل"></label></div><div class="syf-row"><button type="submit" class="syf-btn syf-mny-go"></button><span class="syf-mny-msg" hidden role="status"></span></div></form>');
      var AF = amountField('syf-mny-big'), A = AF.input, D = f.querySelector('[data-f="d"]'), N = f.querySelector('[data-f="note"]'), M = f.querySelector('.syf-mny-msg'), go = f.querySelector('.syf-mny-go'), sel;
      f.querySelector('[data-f="amt"]').replaceWith(AF.el);
      D.value = today();
      function setTy(ty) {
        S.ty = ty;
        var ns = catSelect(book, ty, sel && sel.value);
        if (sel) sel.replaceWith(ns); else f.querySelector('[data-f="cat"]').replaceWith(ns);
        sel = ns;
        go.textContent = ty === 'in' ? t('إضافة الإيراد') : t('إضافة المصروف');
        f.classList.toggle('in', ty === 'in');
      }
      f.querySelector('[data-f="ty"]').replaceWith(typeSeg(S.ty, setTy));
      setTy(S.ty);
      function paint() {
        top.textContent = ''; top.appendChild(kpis(inMonth(book.tx, monthOf(today())), book.cur));
        var mine = sortDesc(book.tx).slice(0, 6);
        dayList(mine, recent, false);
      }
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = AF.read();
        if (v.err) { msg(M, v.err, true); v.at.focus(); return; }
        if (!DAY_RE.test(D.value)) { msg(M, t('اختر تاريخاً صحيحاً.'), true); D.focus(); return; }
        if (book.tx.length >= MAX_TX) { msg(M, t('وصل الدفتر إلى الحد الأقصى. صدّر القديم واحذفه.'), true); return; }
        var rec = { id: uid(), ty: S.ty, cat: sel.value, d: D.value, note: str(N.value, 140) };
        setAmount(rec, v); book.tx.push(rec);
        save(); paint();
        AF.reset(); N.value = ''; A.focus();
        var bn = budNote(rec);
        msg(M, (S.ty === 'in' ? t('أُضيف الإيراد.') : t('أُضيف المصروف.')) + (bn ? ' ' + bn.text : ''), bn && bn.bad);
        M.classList.toggle('warn', !!(bn && bn.warn));
      });
      p.appendChild(top); p.appendChild(f);
      p.appendChild(h('<h4 class="syf-mny-h">آخر الحركات</h4>')); p.appendChild(recent);
      paint();
      setTimeout(function () { A.focus(); }, 0);
    }

    /* ---- tab 2: السجل ---- */
    function tabLog(p) {
      var bar = h('<div class="syf-mny-filter"><select class="syf-in" data-f="m" aria-label="الشهر"></select><select class="syf-in" data-f="ty" aria-label="النوع"><option value="all">الكل</option><option value="out">مصروفات</option><option value="in">إيرادات</option></select><input class="syf-in" type="search" data-f="q" placeholder="بحث في الملاحظات والتصنيفات" aria-label="بحث"></div>');
      var ms = bar.querySelector('[data-f="m"]'), ts = bar.querySelector('[data-f="ty"]'), qs = bar.querySelector('[data-f="q"]');
      var months = {}; book.tx.forEach(function (r) { months[monthOf(r.d)] = 1; }); months[monthOf(today())] = 1;
      var oa = el('option', null, t('كل الأشهر')); oa.value = 'all'; ms.appendChild(oa);
      Object.keys(months).sort().reverse().forEach(function (m) { var o = el('option', null, monthLabel(m)); o.value = m; ms.appendChild(o); });
      ms.value = S.f.m; ts.value = S.f.ty; qs.value = S.f.q;
      var sum = el('div', 'syf-mny-foot'), list = el('div', 'syf-mny-list');
      function pick() {
        var q = norm(S.f.q);
        return book.tx.filter(function (r) {
          if (S.f.m !== 'all' && monthOf(r.d) !== S.f.m) return false;
          if (S.f.ty !== 'all' && r.ty !== S.f.ty) return false;
          return !q || norm(r.note).indexOf(q) > -1 || norm(t(cat(r.cat).n)).indexOf(q) > -1;
        });
      }
      function paint() {
        var l = pick(), T = totals(l);
        dayList(l, list, true, paint);
        sum.textContent = t('{0} حركة · إيرادات {1} · مصروفات {2}', l.length, money(T.i), money(T.o));
      }
      ms.addEventListener('change', function () { S.f.m = ms.value; paint(); });
      ts.addEventListener('change', function () { S.f.ty = ts.value; paint(); });
      qs.addEventListener('input', function () { S.f.q = qs.value; paint(); });
      p.appendChild(bar); p.appendChild(sum); p.appendChild(list);
      paint();
    }

    /* ---- tab 3: التقرير ---- */
    function donut(list) {
      var d = byCat(list, 'out'), tot = d.reduce(function (s, x) { return s + x.a; }, 0);
      var wrap = el('div', 'syf-mny-donut');
      if (!tot) { wrap.appendChild(h('<div class="syf-empty">لا مصروفات في هذا الشهر.</div>')); return wrap; }
      var R = 54, C = 2 * Math.PI * R, acc = 0, svg = '';
      d.forEach(function (x) {
        var f = x.a / tot, col = cat(x.cat).c;
        svg += '<circle r="' + R + '" cx="70" cy="70" fill="none" stroke="' + (HEX_RE.test(col) ? col : '#8a948f') + '" stroke-width="18" stroke-dasharray="' + (f * C).toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + (-acc * C).toFixed(2) + '" transform="rotate(-90 70 70)"/>';
        acc += f;
      });
      var fig = h('<div class="syf-mny-ring"><svg viewBox="0 0 140 140" role="img" aria-label="المصروفات حسب التصنيف">' + svg + '</svg><div class="c"><small>المصروفات</small><b></b></div></div>');
      fig.querySelector('b').textContent = money(tot);
      var leg = el('div', 'syf-mny-leg');
      d.forEach(function (x) {
        var c = cat(x.cat), r = el('div');
        var i = el('i'); i.style.background = HEX_RE.test(c.c) ? c.c : '#8a948f';
        r.appendChild(i); r.appendChild(el('span', null, t(c.n))); r.appendChild(amt(x.a)); r.appendChild(el('em', null, Math.round(x.a / tot * 100) + '%'));
        leg.appendChild(r);
      });
      wrap.appendChild(fig); wrap.appendChild(leg);
      return wrap;
    }
    function bars(m) {
      var data = [];
      for (var k = -5; k <= 0; k++) { var mm = shiftMonth(m, k), T = totals(inMonth(book.tx, mm)); data.push({ m: mm, i: T.i, o: T.o }); }
      var max = Math.max.apply(null, data.map(function (x) { return Math.max(x.i, x.o); })) || 1;
      var W = 300, H = 130, pb = 18, bw = 14, step = W / data.length, y = function (v) { return 4 + (H - pb - 4) * (1 - v / max); }, g = '';
      g += '<line x1="0" x2="' + W + '" y1="' + (H - pb) + '" y2="' + (H - pb) + '" stroke="currentColor" stroke-opacity=".15"/>';
      data.forEach(function (x, i) {
        var cx = i * step + step / 2, last = i === data.length - 1, op = last ? 1 : 0.55;
        g += '<rect x="' + (cx - bw - 1) + '" y="' + y(x.i) + '" width="' + bw + '" height="' + Math.max(0, H - pb - y(x.i)) + '" rx="3" fill="#1f8a5b" opacity="' + op + '"/>';
        g += '<rect x="' + (cx + 1) + '" y="' + y(x.o) + '" width="' + bw + '" height="' + Math.max(0, H - pb - y(x.o)) + '" rx="3" fill="#c2453b" opacity="' + op + '"/>';
      });
      var box = h('<div class="syf-mny-bars"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="الإيرادات والمصروفات آخر 6 أشهر">' + g + '</svg><div class="syf-mny-bx"></div><div class="syf-mny-key"><span class="in">إيرادات</span><span class="out">مصروفات</span></div></div>');
      var bx = box.querySelector('.syf-mny-bx');
      data.forEach(function (x, i) {
        var s = el('span', i === data.length - 1 ? 'on' : '');
        try { s.textContent = new Date(+x.m.slice(0, 4), +x.m.slice(5, 7) - 1, 1).toLocaleDateString(loc(), { month: 'short' }); } catch (e) { s.textContent = x.m.slice(5); }
        bx.appendChild(s);
      });
      return box;
    }
    function tabRep(p) {
      function paint() {
        p.textContent = '';
        var list = inMonth(book.tx, S.month);
        p.appendChild(monthNav(S.month, function (k) { S.month = shiftMonth(S.month, k); paint(); }));
        p.appendChild(kpis(list, book.cur));
        var c1 = h('<div class="syf-mny-card"><h4 class="syf-mny-h">المصروفات حسب التصنيف</h4></div>'); c1.appendChild(donut(list)); p.appendChild(c1);
        var c2 = h('<div class="syf-mny-card"><h4 class="syf-mny-h">آخر 6 أشهر</h4></div>'); c2.appendChild(bars(S.month)); p.appendChild(c2);
        var bs = budStatus(book, S.month);
        if (bs.cats.length || bs.all.lim) {
          var c4 = h('<div class="syf-mny-card"><h4 class="syf-mny-h">الميزانية</h4></div>');
          if (bs.all.lim) c4.appendChild(meterRow(t('كل المصروفات'), bs.all.used, bs.all.lim));
          bs.cats.forEach(function (x) { c4.appendChild(meterRow(t(cat(x.cat).n), x.used, x.lim, cat(x.cat).c)); });
          p.appendChild(c4);
        }
        var inc = byCat(list, 'in');
        if (inc.length) {
          var c3 = h('<div class="syf-mny-card"><h4 class="syf-mny-h">مصادر الدخل</h4><div class="syf-mny-leg"></div></div>'), lg = c3.querySelector('.syf-mny-leg');
          inc.forEach(function (x) { var c = cat(x.cat), r = el('div'), i = el('i'); i.style.background = c.c; r.appendChild(i); r.appendChild(el('span', null, t(c.n))); r.appendChild(amt(x.a, 'in')); r.appendChild(el('em', null, String(x.n))); lg.appendChild(r); });
          p.appendChild(c3);
        }
      }
      paint();
    }

    /* one «spent of limit» line: green under 80%, amber to 100%, red over */
    function meterRow(name, used, lim, col) {
      var pc = lim ? used / lim : 0, row = h('<div class="syf-mny-bl"><div class="syf-mny-blh"><span></span><small></small></div><div class="syf-mny-meter"><i></i></div></div>');
      var nm = row.querySelector('span'); nm.textContent = name;
      if (col) { var sw = el('i', 'syf-mny-dot'); sw.style.background = HEX_RE.test(col) ? col : '#8a948f'; nm.prepend(sw); }
      row.querySelector('small').textContent = t('{0} من {1}', money(used), money(lim)) + ' · ' + (pc > 1 ? t('تجاوز بـ {0}', money(used - lim)) : t('متبقٍ {0}', money(lim - used)));
      var bar = row.querySelector('.syf-mny-meter i');
      bar.style.width = Math.min(100, Math.round(pc * 100)) + '%';
      bar.className = pc > 1 ? 'over' : pc >= 0.8 ? 'hot' : '';
      return row;
    }
    /* ---- tab: الميزانية ---- */
    function tabBud(p) {
      function limInput(v, onSet) {
        var i = el('input', 'syf-in syf-mny-lim'); i.inputMode = 'decimal'; i.placeholder = t('بلا حد'); i.setAttribute('aria-label', t('الحد الشهري'));
        if (v) i.value = String(v / 100);
        i.addEventListener('change', function () {
          var c = i.value.trim() ? toCents(i.value) : 0;
          if (i.value.trim() && !(c > 0 && c <= MAX_CENTS)) { i.value = v ? String(v / 100) : ''; return; }
          v = c; onSet(c); save(); paint();
        });
        return i;
      }
      var view = el('div', 'syf-mny-budv');
      function paint() {
        view.textContent = '';
        var st = budStatus(book, S.month), used = {}; st.cats.forEach(function (x) { used[x.cat] = x.used; });
        var spent = {}; inMonth(book.tx, S.month).forEach(function (r) { if (r.ty === 'out') spent[r.cat] = (spent[r.cat] || 0) + r.a; });
        view.appendChild(monthNav(S.month, function (k) { S.month = shiftMonth(S.month, k); paint(); }));
        var all = h('<div class="syf-mny-card"><h4 class="syf-mny-h">الحد الشهري لكل المصروفات</h4><div class="syf-mny-limrow"></div></div>');
        all.querySelector('.syf-mny-limrow').appendChild(limInput(book.budAll, function (c) { book.budAll = c; }));
        all.querySelector('.syf-mny-limrow').appendChild(el('span', 'syf-mny-cur1', curSym(book.cur)));
        if (book.budAll) all.appendChild(meterRow(t('كل المصروفات'), st.all.used, book.budAll));
        view.appendChild(all);
        var cc = h('<div class="syf-mny-card"><h4 class="syf-mny-h">حد كل تصنيف</h4><p class="syf-mny-note">اترك الخانة فارغة لتصنيف بلا حد. يظهر تنبيه عند 80% وعند التجاوز.</p><div class="syf-mny-buds"></div></div>'), box = cc.querySelector('.syf-mny-buds');
        book.cats.filter(function (c) { return c.ty === 'out'; }).forEach(function (c) {
          var row = el('div', 'syf-mny-bud');
          var head = el('div', 'syf-mny-budh');
          head.appendChild(swatch(c.c, t(c.n))); head.appendChild(el('b', null, t(c.n)));
          head.appendChild(limInput(book.bud[c.id] || 0, function (v) { if (v) book.bud[c.id] = v; else delete book.bud[c.id]; }));
          row.appendChild(head);
          if (book.bud[c.id]) row.appendChild(meterRow('', spent[c.id] || 0, book.bud[c.id]));
          else if (spent[c.id]) row.appendChild(el('small', 'syf-mny-note', t('صُرف {0} هذا الشهر', money(spent[c.id]))));
          box.appendChild(row);
        });
        view.appendChild(cc);
      }
      p.appendChild(view);
      paint();
    }

    /* ---- tab 4: إكسيل (export + import) ---- */
    function range(kind, from, to) {
      var m = monthOf(today()), y = today().slice(0, 4);
      if (kind === 'month') return book.tx.filter(function (r) { return monthOf(r.d) === m; });
      if (kind === 'prev') { var pm = shiftMonth(m, -1); return book.tx.filter(function (r) { return monthOf(r.d) === pm; }); }
      if (kind === 'year') return book.tx.filter(function (r) { return r.d.slice(0, 4) === y; });
      if (kind === 'custom') return book.tx.filter(function (r) { return (!from || r.d >= from) && (!to || r.d <= to); });
      return book.tx.slice();
    }
    function fileName(kind, from, to) {
      var base = t('مصروفات-وإيرادات'), m = monthOf(today());
      var tag = kind === 'month' ? m : kind === 'prev' ? shiftMonth(m, -1) : kind === 'year' ? today().slice(0, 4) : kind === 'custom' ? (from || '…') + '_' + (to || '…') : t('الكل');
      return (base + '-' + tag).replace(/[\\/:*?"<>|]+/g, '-');
    }
    function writeXlsx(aoaSets, names, fmts, file) {
      var X = window.XLSX, wb = X.utils.book_new();
      aoaSets.forEach(function (aoa, k) {
        var ws = X.utils.aoa_to_sheet(aoa), ref = X.utils.decode_range(ws['!ref']);
        var fm = fmts[k] || {};
        for (var R = 1; R <= ref.e.r; R++) for (var C = 0; C <= ref.e.c; C++) {
          var cell = ws[X.utils.encode_cell({ r: R, c: C })];
          if (cell && cell.t === 'n' && fm[C]) cell.z = fm[C];
        }
        /* the date column of «الحركات» as real Excel dates */
        if (fm.date) for (var r = 1; r < aoa.length; r++) {
          var a = ws[X.utils.encode_cell({ r: r, c: 0 })];
          if (a && DAY_RE.test(a.v)) { var p = a.v.split('-'); ws[X.utils.encode_cell({ r: r, c: 0 })] = { t: 'n', v: (Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(1899, 11, 30)) / 864e5, z: 'yyyy-mm-dd' }; }
        }
        ws['!cols'] = aoa[0].map(function (_, c) {
          var w = 8; aoa.forEach(function (row) { w = Math.max(w, String(row[c] == null ? '' : row[c]).length + 2); });
          return { wch: Math.min(w, 48) };
        });
        X.utils.book_append_sheet(wb, ws, names[k].slice(0, 31));
      });
      wb.Workbook = { Views: [{ RTL: dir() === 'rtl' }] };
      X.writeFile(wb, file + '.xlsx', { compression: true });
    }
    var NUM = '#,##0.00', FMT = { tx: { date: 1, 4: NUM, 5: NUM, 7: NUM, 8: '0.0000' }, month: { 1: NUM, 2: NUM, 3: NUM }, cat: { 2: NUM, 3: '0.0' } };
    function tabXl(p) {
      var ex = h('<div class="syf-mny-card"><h4 class="syf-mny-h">تصدير إلى إكسيل</h4>' +
        '<label class="syf-mny-lbl">الفترة<select class="syf-in" data-f="k"><option value="month">هذا الشهر</option><option value="prev">الشهر الماضي</option><option value="year">هذه السنة</option><option value="all">كل الحركات</option><option value="custom">من تاريخ إلى تاريخ</option></select></label>' +
        '<div class="syf-mny-grid" data-f="cu" hidden><label>من<input class="syf-in" type="date" data-f="from"></label><label>إلى<input class="syf-in" type="date" data-f="to"></label></div>' +
        '<div class="syf-mny-checks"><label><input type="checkbox" data-s="tx" checked> الحركات</label><label><input type="checkbox" data-s="month" checked> ملخص شهري</label><label><input type="checkbox" data-s="cat" checked> حسب التصنيف</label></div>' +
        '<div class="syf-mny-note" data-f="cnt"></div>' +
        '<div class="syf-row"><button type="button" class="syf-btn syf-mny-xl" data-a="xlsx">تصدير ‎.xlsx</button><button type="button" class="syf-mini" data-a="csv">CSV</button></div><div class="syf-mny-msg" hidden role="status"></div></div>');
      var K = ex.querySelector('[data-f="k"]'), CU = ex.querySelector('[data-f="cu"]'), FR = ex.querySelector('[data-f="from"]'), TO = ex.querySelector('[data-f="to"]'), CNT = ex.querySelector('[data-f="cnt"]'), EM = ex.querySelector('.syf-mny-msg');
      FR.value = monthOf(today()) + '-01'; TO.value = today();
      function count() { CU.hidden = K.value !== 'custom'; var l = range(K.value, FR.value, TO.value); CNT.textContent = t('{0} حركة في هذه الفترة', l.length); return l; }
      [K, FR, TO].forEach(function (x) { x.addEventListener('change', count); });
      count();
      ex.querySelector('[data-a="csv"]').addEventListener('click', function () {
        var l = count(); if (!l.length) { msg(EM, t('لا حركات في هذه الفترة.'), true); return; }
        dlBlob(new Blob([toCsv(sheets(book, l).tx)], { type: 'text/csv;charset=utf-8' }), fileName(K.value, FR.value, TO.value) + '.csv');
        msg(EM, t('تم تنزيل الملف.'));
      });
      ex.querySelector('[data-a="xlsx"]').addEventListener('click', function () {
        var l = count(); if (!l.length) { msg(EM, t('لا حركات في هذه الفترة.'), true); return; }
        var pick = Array.prototype.filter.call(ex.querySelectorAll('[data-s]'), function (c) { return c.checked; }).map(function (c) { return c.dataset.s; });
        if (!pick.length) { msg(EM, t('اختر ورقة واحدة على الأقل.'), true); return; }
        msg(EM, t('جارٍ تجهيز الملف…'));
        ensureXLSX(function (ok) {
          if (!ok) { msg(EM, t('تعذّر تحميل مكتبة إكسيل في هذه الصفحة. جرّب من صفحة أخرى أو صدّر CSV.'), true); return; }
          var all = sheets(book, l), NAMES = { tx: t('الحركات'), month: t('ملخص شهري'), cat: t('حسب التصنيف') };
          var order = ['tx', 'month', 'cat'].filter(function (k) { return pick.indexOf(k) > -1; });
          try {
            writeXlsx(order.map(function (k) { return all[k]; }), order.map(function (k) { return NAMES[k]; }), order.map(function (k) { return FMT[k]; }), fileName(K.value, FR.value, TO.value));
            msg(EM, t('تم تنزيل الملف.'));
          } catch (e) { msg(EM, t('تعذّر إنشاء الملف.'), true); }
        });
      });

      var im = h('<div class="syf-mny-card"><h4 class="syf-mny-h">استيراد من إكسيل</h4>' +
        '<p class="syf-mny-note">ملف ‎.xlsx أو ‎.xls أو ‎.csv فيه عمود «التاريخ» وعمود «المبلغ» (أو عمودا «إيراد» و«مصروف»). الأعمدة الاختيارية: النوع، التصنيف، ملاحظة. الملف الذي تصدّره الأداة يُستورد كما هو.</p>' +
        '<div class="syf-row"><label class="syf-btn syf-mny-file">اختر ملفاً<input type="file" accept=".xlsx,.xls,.csv,.ods" hidden></label><button type="button" class="syf-mini" data-a="tpl">تنزيل نموذج</button></div>' +
        '<div class="syf-mny-msg" hidden role="status"></div><div class="syf-mny-prev" hidden></div></div>');
      var FI = im.querySelector('input[type="file"]'), IM = im.querySelector('.syf-mny-msg'), PV = im.querySelector('.syf-mny-prev');
      im.querySelector('[data-a="tpl"]').addEventListener('click', function () {
        var aoa = [[t('التاريخ'), t('النوع'), t('التصنيف'), t('ملاحظة'), t('المبلغ')], [today(), t('مصروف'), t('طعام'), t('مثال: غداء العمل'), 120], [today(), t('إيراد'), t('راتب'), '', 15000]];
        ensureXLSX(function (ok) {
          if (ok) { try { writeXlsx([aoa], [t('الحركات')], [{ date: 1, 4: NUM }], t('نموذج-استيراد')); return; } catch (e) {} }
          dlBlob(new Blob([toCsv(aoa)], { type: 'text/csv;charset=utf-8' }), t('نموذج-استيراد') + '.csv');
        });
      });
      FI.addEventListener('change', function () {
        var f = FI.files && FI.files[0]; FI.value = '';
        PV.hidden = true; PV.textContent = '';
        if (!f) return;
        if (f.size > MAX_FILE) { msg(IM, t('الملف أكبر من 10 ميجابايت.'), true); return; }
        msg(IM, t('جارٍ قراءة الملف…'));
        ensureXLSX(function (ok) {
          if (!ok) { msg(IM, t('تعذّر تحميل مكتبة إكسيل في هذه الصفحة. جرّب من صفحة أخرى أو صدّر CSV.'), true); return; }
          f.arrayBuffer().then(function (buf) {
            var X = window.XLSX, wb = X.read(new Uint8Array(buf), { type: 'array', cellDates: true, dense: false });
            /* the sheet named «الحركات» (or "Transactions") when there is one, else the first */
            var nm = wb.SheetNames.filter(function (n) { return norm(n) === norm(t('الحركات')) || norm(n) === norm('الحركات'); })[0] || wb.SheetNames[0];
            var aoa = X.utils.sheet_to_json(wb.Sheets[nm], { header: 1, raw: true, defval: '' });
            preview(importAoa(aoa, book));
          }).catch(function () { msg(IM, t('تعذّر قراءة الملف. تأكد أنه ملف إكسيل أو CSV سليم.'), true); });
        });
      });
      function preview(res) {
        if (!res.header) { msg(IM, t('لم أجد عمودي «التاريخ» و«المبلغ» في أول 15 سطراً.'), true); return; }
        if (!res.rows.length) { msg(IM, t('لا توجد حركات صالحة في الملف.'), true); return; }
        msg(IM, '');
        PV.hidden = false; PV.textContent = '';
        var T = totals(res.rows);
        PV.appendChild(el('div', 'syf-mny-note', t('وُجدت {0} حركة · إيرادات {1} · مصروفات {2}', res.rows.length, money(T.i), money(T.o))));
        if (res.bad) PV.appendChild(el('div', 'syf-mny-note', t('تُرك {0} سطر بلا تاريخ أو مبلغ صالح (مثل سطر الإجمالي).', res.bad)));
        if (res.newCats.length) PV.appendChild(el('div', 'syf-mny-note', t('تصنيفات جديدة ستُضاف: {0}', res.newCats.map(function (c) { return c.n; }).join('، '))));
        var tb = h('<div class="syf-mny-tbl"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>التصنيف</th><th>ملاحظة</th><th>المبلغ</th></tr></thead><tbody></tbody></table></div>'), body2 = tb.querySelector('tbody');
        var nc = {}; res.newCats.forEach(function (c) { nc[c.id] = c; });
        res.rows.slice(0, 8).forEach(function (r) {
          var tr = el('tr'); if (r.dup) tr.className = 'dup';
          [r.d, tyName(r.ty), nc[r.cat] ? nc[r.cat].n : t(cat(r.cat).n), r.note].forEach(function (v) { tr.appendChild(el('td', null, v)); });
          var td = el('td'); td.appendChild(amt(r.a, r.ty)); tr.appendChild(td); body2.appendChild(tr);
        });
        PV.appendChild(tb);
        if (res.rows.length > 8) PV.appendChild(el('div', 'syf-mny-note', t('و{0} حركة أخرى…', res.rows.length - 8)));
        var skip = null;
        if (res.dup) {
          var lab = h('<label class="syf-mny-checks"><input type="checkbox" checked> <span></span></label>');
          lab.querySelector('span').textContent = t('تخطّي {0} حركة موجودة عندك بالفعل', res.dup);
          skip = lab.querySelector('input'); PV.appendChild(lab);
        }
        var act = h('<div class="syf-row"><button type="button" class="syf-btn" data-a="go"></button><button type="button" class="syf-mini" data-a="no">إلغاء</button></div>');
        var go = act.querySelector('[data-a="go"]');
        function label() { var n = res.rows.filter(function (r) { return !(skip && skip.checked && r.dup); }).length; go.textContent = t('استيراد {0} حركة', n); go.disabled = !n; return n; }
        if (skip) skip.addEventListener('change', label);
        label();
        PV.appendChild(act);
        act.querySelector('[data-a="no"]').addEventListener('click', function () { PV.hidden = true; PV.textContent = ''; });
        go.addEventListener('click', function () {
          var rows = res.rows.filter(function (r) { return !(skip && skip.checked && r.dup); });
          if (book.tx.length + rows.length > MAX_TX) { msg(IM, t('وصل الدفتر إلى الحد الأقصى. صدّر القديم واحذفه.'), true); return; }
          var usedCats = {}; rows.forEach(function (r) { usedCats[r.cat] = 1; });
          res.newCats.forEach(function (c) { if (usedCats[c.id]) book.cats.push(c); });
          rows.forEach(function (r) { var x = Object.assign({}, r); delete x.dup; book.tx.push(x); });
          save(); PV.hidden = true; PV.textContent = '';
          msg(IM, t('تم استيراد {0} حركة.', rows.length));
          count();
        });
      }
      p.appendChild(ex); p.appendChild(im);
    }

    /* ---- tab 5: الإعدادات ---- */
    function tabSet(p) {
      var cur = h('<div class="syf-mny-card"><label class="syf-mny-lbl">العملة الافتراضية<select class="syf-in" data-f="cur"></select></label><p class="syf-mny-note">كل الإجماليات والتقارير والميزانية بهذه العملة. لإضافة مبلغ بعملة أخرى اخترها بجوار المبلغ، فيُحوَّل بسعر الصرف وتُحفظ القيمة الأصلية معه.</p><p class="syf-mny-note syf-mny-warn" hidden>تغيير العملة الافتراضية لا يحوّل المبالغ المسجّلة من قبل.</p></div>'), CS = cur.querySelector('select');
      CURS.forEach(function (c) { var o = el('option', null, t(c.n) + ' (' + c.c + ')'); o.value = c.c; CS.appendChild(o); });
      CS.value = book.cur;
      CS.addEventListener('change', function () {
        book.cur = CS.value; book.rates = {};            /* rates were against the old default */
        save(); cur.querySelector('.syf-mny-warn').hidden = !book.tx.length;
      });
      p.appendChild(cur);
      var cats = el('div');
      function paintCats() {
        cats.textContent = '';
        [['out', 'تصنيفات المصروفات'], ['in', 'تصنيفات الإيرادات']].forEach(function (g) {
          var card = h('<div class="syf-mny-card"><h4 class="syf-mny-h"></h4><div class="syf-mny-cats"></div><form class="syf-row syf-mny-addcat"><input class="syf-in" maxlength="30" placeholder="تصنيف جديد" aria-label="تصنيف جديد"><button type="submit" class="syf-mini">إضافة</button></form></div>');
          card.querySelector('h4').textContent = t(g[1]);
          var box = card.querySelector('.syf-mny-cats');
          book.cats.filter(function (c) { return c.ty === g[0]; }).forEach(function (c) {
            var n = book.tx.filter(function (r) { return r.cat === c.id; }).length;
            var row = h('<div class="syf-mny-cat"><input type="color" aria-label="اللون"><input class="syf-in" maxlength="30" aria-label="الاسم"><small></small><button type="button" class="syf-mny-ib" title="حذف" aria-label="حذف">×</button></div>');
            var col = row.querySelector('input[type="color"]'), nm = row.querySelector('.syf-in'), del = row.querySelector('button');
            col.value = c.c; nm.value = t(c.n);
            row.querySelector('small').textContent = t('{0} حركة', n);
            col.addEventListener('change', function () { if (HEX_RE.test(col.value)) { c.c = col.value; save(); } });
            nm.addEventListener('change', function () { var v = str(nm.value, 30); if (v) { c.n = v; save(); } else nm.value = t(c.n); });
            if (c.id === 'other' || c.id === 'other_in') del.hidden = true;
            else armed(del, '×', function () {
              var to = c.ty === 'in' ? 'other_in' : 'other';
              book.tx.forEach(function (r) { if (r.cat === c.id) r.cat = to; });
              book.cats.splice(book.cats.indexOf(c), 1); save(); paintCats();
            });
            box.appendChild(row);
          });
          card.querySelector('form').addEventListener('submit', function (e) {
            e.preventDefault();
            var inp = e.target.querySelector('input'), v = str(inp.value, 30); if (!v) return;
            if (book.cats.length >= 200) return;
            book.cats.push({ id: 'c' + Date.now().toString(36), n: v, ty: g[0], c: PALETTE[book.cats.length % PALETTE.length] });
            save(); paintCats();
          });
          cats.appendChild(card);
        });
      }
      paintCats();
      p.appendChild(cats);
      var bk = h('<div class="syf-mny-card"><h4 class="syf-mny-h">نسخة احتياطية</h4><div class="syf-row"><button type="button" class="syf-mini" data-a="save">حفظ نسخة JSON</button><label class="syf-mini syf-mny-file">استرجاع نسخة<input type="file" accept=".json,application/json" hidden></label><button type="button" class="syf-mini danger" data-a="wipe">مسح كل الحركات</button></div><div class="syf-mny-msg" hidden role="status"></div></div>');
      var BM = bk.querySelector('.syf-mny-msg'), BF = bk.querySelector('input[type="file"]');
      bk.querySelector('[data-a="save"]').addEventListener('click', function () {
        dlBlob(new Blob([JSON.stringify(book, null, 1)], { type: 'application/json' }), t('مصروفات-وإيرادات') + '-' + today() + '.json');
      });
      BF.addEventListener('change', function () {
        var f = BF.files && BF.files[0]; BF.value = ''; if (!f) return;
        if (f.size > MAX_FILE) { msg(BM, t('الملف أكبر من 10 ميجابايت.'), true); return; }
        f.text().then(function (s) {
          var raw = JSON.parse(s);
          if (!raw || raw.v !== 1 || !Array.isArray(raw.tx)) throw new Error('shape');
          book = clean(raw); save(); paintCats(); CS.value = book.cur;
          msg(BM, t('تم استرجاع {0} حركة.', book.tx.length));
        }).catch(function () { msg(BM, t('هذا الملف ليس نسخة احتياطية من هذه الأداة.'), true); });
      });
      armed(bk.querySelector('[data-a="wipe"]'), t('مسح كل الحركات'), function () {
        book.tx = []; save(); paintCats(); msg(BM, t('مُسحت كل الحركات.'));
      });
      p.appendChild(bk);
    }

    store.get(KEY, null).then(function (raw) {
      book = clean(raw);
      if (!body.isConnected) return;
      wait.remove();
      body.classList.add('syf-mny');
      SYFS.tabs(body, [
        { label: 'إضافة', ic: IC.add, build: tabAdd },
        { label: 'السجل', ic: IC.log, build: tabLog },
        { label: 'التقرير', ic: IC.rep, build: tabRep },
        { label: 'الميزانية', ic: IC.bud, build: tabBud },
        { label: 'إكسيل', ic: IC.xl, build: tabXl },
        { label: 'الإعدادات', ic: IC.set, build: tabSet }
      ]);
    });
  }

  SYFS.tools.push({
    id: 'money', name: 'المصروفات والإيرادات', cat: 'calc',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1V7z"/><path d="M4 7l11-3v3"/><path d="M14 12.5h6v3h-6z"/><path d="M8 11v5M6.5 14.5 8 16l1.5-1.5"/></svg>',
    mount: mount
  });
}());
