/* SYF — المناسبات والأيام الفاضلة (occasions).
 * أيام البيض · الاثنين والخميس · عاشوراء · عرفة · ست من شوّال · رمضان … محسوبة من
 * التقويم الهجري (أم القرى) **محلياً بالكامل**: لا شبكة، لا مفاتيح، لا صلاحيات جديدة.
 * Scheduling lives in the worker (chrome.alarms + notifications) exactly as the
 * `ithkar` reminders do; this file renders the tool and writes the `occasions` key.
 * Loaded BEFORE src/rail.js. */
(function () {
  window.SYFS = window.SYFS || {};
  var store = SYFS.store;

  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    /* the template's own text IS the msgid — translate the built tree rather than
       splitting the markup (see src/i18n.js). Free in the default language. */
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }
  function send(type, extra) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(Object.assign({ type: type }, extra || {}), function (r) {
          if (chrome.runtime.lastError || !r) { resolve({ ok: false }); return; }
          resolve(r);
        });
      } catch (e) { resolve({ ok: false }); }
    });
  }

  /* <<< OCC-ENGINE >>> */
  /* The Hijri calendar and everything computed FROM it. This block is duplicated
   * VERBATIM in background.js: the worker schedules the reminders and cannot import
   * from a content script, and the prayer math already sets that precedent
   * (`ikPrayerTimes` is a worker copy of the same function in src/tools2.js). A
   * check asserts the two copies stay byte-identical — the same guarantee
   * DEFAULT_TOOL_ORDER has. Keep it free of `window.`, `document.` and `chrome.`:
   * one of its two homes is a service worker with none of them. */
  var OCC_DAY = 86400000;
  var OCC_MONTHS = ['محرّم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة',
                    'رجب', 'شعبان', 'رمضان', 'شوّال', 'ذو القعدة', 'ذو الحجة'];
  /* type: fast = يُستحبّ صومه · season = موسم فاضل · warn = نُهي عن صومه */
  var OCC_DEFS = [
    { key: 'white',    name: 'أيام البيض',        type: 'fast',   hint: '١٣ و١٤ و١٥ من كل شهر' },
    { key: 'monthu',   name: 'الاثنين والخميس',    type: 'fast',   hint: 'صوم أسبوعي' },
    { key: 'tasua',    name: 'تاسوعاء',           type: 'fast',   hint: '٩ محرّم' },
    { key: 'ashura',   name: 'عاشوراء',           type: 'fast',   hint: '١٠ محرّم' },
    { key: 'ashr',     name: 'العشر من ذي الحجة',  type: 'season', hint: '١–٩ ذو الحجة' },
    { key: 'arafah',   name: 'يوم عرفة',          type: 'fast',   hint: '٩ ذو الحجة — لغير الحاجّ' },
    { key: 'shawwal6', name: 'ست من شوّال',        type: 'fast',   hint: '٢–٧ شوّال (ويجوز صومها في الشهر كله)' },
    { key: 'ramadan',  name: 'دخول رمضان',        type: 'season', hint: '١ رمضان' },
    { key: 'last10',   name: 'العشر الأواخر',      type: 'season', hint: '٢١ رمضان فما بعد' },
    { key: 'shaban',   name: 'شعبان',             type: 'season', hint: 'الإكثار من الصوم' },
    { key: 'sacred',   name: 'شهر حرام',          type: 'season', hint: 'محرّم · رجب · ذو القعدة · ذو الحجة' },
    { key: 'eidfitr',  name: 'عيد الفطر',         type: 'warn',   hint: 'لا يُصام' },
    { key: 'eidadha',  name: 'عيد الأضحى',        type: 'warn',   hint: 'لا يُصام' },
    { key: 'tashreeq', name: 'أيام التشريق',      type: 'warn',   hint: '١١–١٣ ذو الحجة — لا تُصام' }
  ];
  /* The bell is ON by default (user decision, 2026-10-09): every occasion rings except the two month-long seasons (شعبان · الأشهر
   * الحرم) — the user's choice of defaults. These fill MISSING keys only: occSettings
   * keeps any boolean already stored, so a saved choice is never overridden. */
  var OCC_DEFAULTS = {
    on: true, lead: 1, at: '20:00', offset: 0,
    keys: {
      white: true, monthu: true, tasua: true, ashura: true, ashr: true, arafah: true,
      shawwal6: true, ramadan: true, last10: true, shaban: false, sacred: false,
      eidfitr: true, eidadha: true, tashreeq: true
    }
  };

  /* Every stored field is re-checked here rather than trusted: storage is shared
   * with an export/import feature, so a hand-edited file is a real input path.
   * Out-of-range values are REJECTED back to the default, never clamped-and-kept —
   * a silently "corrected" 99-day lead is a reminder the user never asked for. */
  function occSettings(raw) {
    var s = Object.assign({}, OCC_DEFAULTS, raw && typeof raw === 'object' ? raw : {});
    s.on = !!s.on;
    s.lead = (typeof s.lead === 'number' && s.lead >= 0 && s.lead <= 7) ? Math.round(s.lead) : OCC_DEFAULTS.lead;
    s.offset = (s.offset === -1 || s.offset === 0 || s.offset === 1) ? s.offset : 0;
    s.at = /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.at) ? s.at : OCC_DEFAULTS.at;
    var keys = {}, raws = (raw && typeof raw.keys === 'object' && raw.keys) || {};
    OCC_DEFS.forEach(function (d) {                       /* whitelist: only known keys survive */
      keys[d.key] = (typeof raws[d.key] === 'boolean') ? raws[d.key] : OCC_DEFAULTS.keys[d.key];
    });
    s.keys = keys;
    return s;
  }

  /* ⚠️ A formatter pins the time zone it was BUILT in, while `new Date(y, m, d)` is
   * local midnight in the zone the device has NOW. After a zone change (travel) the
   * cached one read the new midnight in the old zone — the Hijri date a day off until
   * the page reloaded. So the zone is re-read (at most once a second: a scan calls
   * this 400 times) and the formatter rebuilt when it moved. */
  var occFmt = null, occFmtTz = '', occFmtAt = 0;
  function occFormatter() {
    var now = Date.now();
    if (occFmt !== null && now - occFmtAt < 1000) return occFmt;
    occFmtAt = now;
    var tz = '';
    try { tz = new Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    if (occFmt !== null && tz === occFmtTz) return occFmt;
    occFmtTz = tz;
    try {
      occFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn',
        { year: 'numeric', month: 'numeric', day: 'numeric' });
    } catch (e) { occFmt = false; }
    return occFmt;
  }
  function occHijri(date, offset) {
    var fmt = occFormatter();
    if (!fmt) return null;
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + (offset || 0));
    var o = {};
    try {
      fmt.formatToParts(d).forEach(function (p) {
        if (p.type === 'year' || p.type === 'month' || p.type === 'day') o[p.type] = parseInt(p.value, 10);
      });
    } catch (e) { return null; }
    if (!(o.year > 0 && o.month >= 1 && o.month <= 12 && o.day >= 1 && o.day <= 30)) return null;
    return { y: o.year, m: o.month, d: o.day };
  }

  /* Which occasions fall on one Hijri day. `wd` is the Gregorian weekday
   * (0 = الأحد), because الاثنين والخميس is a weekday rule, not a calendar one. */
  function occKeysFor(hj, wd) {
    var out = [], m = hj.m, d = hj.d;
    /* ١٣ ذو الحجة is a Tashreeq day. The white-day rule must not claim a day the
     * warn rule forbids — the two would contradict each other in the same row. */
    /* And neither voluntary fast is announced inside رمضان: the whole month is an
     * obligatory fast, so «يُستحبّ صومه» there is wrong and only adds noise. */
    if ((d === 13 || d === 14 || d === 15) && m !== 9 && !(m === 12 && d === 13)) out.push('white');
    /* …nor may the weekly fast: a Monday/Thursday on an Eid or Tashreeq day is not fasted. */
    var noFast = m === 9 || (m === 10 && d === 1) || (m === 12 && d >= 10 && d <= 13);
    if ((wd === 1 || wd === 4) && !noFast) out.push('monthu');
    if (m === 1 && d === 9) out.push('tasua');
    if (m === 1 && d === 10) out.push('ashura');
    if (m === 12 && d >= 1 && d <= 9) out.push('ashr');
    if (m === 12 && d === 9) out.push('arafah');
    if (m === 10 && d >= 2 && d <= 7) out.push('shawwal6');
    if (m === 9 && d === 1) out.push('ramadan');
    if (m === 9 && d >= 21) out.push('last10');
    if (m === 8 && d === 1) out.push('shaban');
    if ((m === 1 || m === 7 || m === 11 || m === 12) && d === 1) out.push('sacred');
    if (m === 10 && d === 1) out.push('eidfitr');
    if (m === 12 && d === 10) out.push('eidadha');
    if (m === 12 && d >= 11 && d <= 13) out.push('tashreeq');
    return out;
  }

  function occScan(fromMs, days, offset, keys) {
    var out = [], base = new Date(fromMs);
    for (var i = 0; i < days; i++) {
      /* setDate arithmetic, NOT `+ i * OCC_DAY`: adding 86400000ms across a DST
       * boundary lands at 23:00 of the same day, and the Hijri date would repeat. */
      var day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      var hj = occHijri(day, offset);
      if (!hj) break;
      var ks = occKeysFor(hj, day.getDay());
      for (var j = 0; j < ks.length; j++) {
        if (!keys || keys[ks[j]]) out.push({ key: ks[j], ts: day.getTime(), hj: hj });
      }
    }
    return out;
  }

  /* Collapse consecutive days of the SAME occasion into one run. Nine notifications
   * for the nine days of ذي الحجة is not a reminder, it is a nuisance — so a run is
   * also the unit the worker schedules against, not the day. */
  function occRuns(list) {
    var by = {}, out = [];
    list.forEach(function (e) { (by[e.key] = by[e.key] || []).push(e); });
    Object.keys(by).forEach(function (k) {
      var arr = by[k].sort(function (a, b) { return a.ts - b.ts; }), run = null;
      arr.forEach(function (e) {
        /* one day apart, with an hour of slack so a DST day (23h or 25h) still joins */
        if (run && (e.ts - run.end) <= OCC_DAY + 3600000) { run.end = e.ts; run.days++; run.endHj = e.hj; return; }
        run = { key: k, ts: e.ts, end: e.ts, days: 1, hj: e.hj, endHj: e.hj };
        out.push(run);
      });
    });
    return out.sort(function (a, b) { return a.ts - b.ts; });
  }

  /* The next moment a reminder should fire: `lead` days before a run starts, at the
   * chosen wall-clock time. Returns null when nothing is enabled or nothing is due.
   * `runs` holds EVERY run that fires at that same moment (`run` is its first): two
   * occasions on one day — رمضان on a Monday with الاثنين والخميس on — used to keep the
   * first and lose the second, because the re-arm after firing skipped every run
   * whose moment had just passed. One alarm, one notification naming all of them.
   * The scan starts YESTERDAY: a season already under way then starts in the past
   * and is not re-announced as «today» on every browser start (lead 0 used to
   * repeat العشر الأواخر daily). */
  function occNextFire(s, nowMs) {
    var t = new Date(nowMs);
    var runs = occRuns(occScan(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1).getTime(), 401, s.offset, s.keys));
    var hm = /^(\d{1,2}):(\d{2})$/.exec(s.at) || [];
    var hh = hm.length ? +hm[1] : 20, mi = hm.length ? +hm[2] : 0;
    var best = null;
    for (var i = 0; i < runs.length; i++) {
      var d = new Date(runs[i].ts);
      var fire = new Date(d.getFullYear(), d.getMonth(), d.getDate() - s.lead, hh, mi, 0, 0).getTime();
      if (fire <= nowMs + 5000) continue;
      if (!best) best = { at: fire, run: runs[i], runs: [runs[i]] };
      else if (fire === best.at) best.runs.push(runs[i]);
      else break;                         /* runs are sorted by start, so fire only grows */
    }
    return best;
  }

  /* True once the LAST day of a stored run ({ts, days}) is before today — a reminder
   * delivered late (the device slept through it) must not announce «اليوم» for an
   * occasion that is already over. */
  function occRunEnded(n, nowMs) {
    var t = new Date(nowMs), e = new Date(n.ts);
    var last = new Date(e.getFullYear(), e.getMonth(), e.getDate() + Math.max(1, n.days || 1) - 1).getTime();
    return last < new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  }

  function occDef(key) {
    for (var i = 0; i < OCC_DEFS.length; i++) if (OCC_DEFS[i].key === key) return OCC_DEFS[i];
    return null;
  }
  function occHijriText(hj) { return hj ? (hj.d + ' ' + OCC_MONTHS[hj.m - 1] + ' ' + hj.y + 'هـ') : ''; }
  /* <<< /OCC-ENGINE >>> */

  var TYPE_LABEL = { fast: 'صوم', season: 'موسم', warn: 'لا يُصام' };

  /* ⛔ The Hijri text ABOVE this line is inside the sealed engine and must stay
     byte-identical to background.js. The translated form is therefore built out here
     from the raw {d,m,y}, never by editing the sealed copy and never by re-parsing a
     string we just composed (§6.99/6). The template reproduces the engine's own
     composition exactly, so the Arabic does not move a byte. */
  function occHijriT(hj) {
    return hj ? SYFS.t('{0} {1} {2}هـ', hj.d, SYFS.t(OCC_MONTHS[hj.m - 1] || ''), hj.y) : '';
  }

  /* ⚠️ `ar-EG` was hard-coded, so an English interface still got Arabic-Indic digits
     and Arabic month names — the dictionary never sees a locale, so no amount of
     translation could reach these. The locale follows the interface language. */
  function locale() { return SYFS.i18n.get() === 'en' ? 'en-GB' : 'ar-EG'; }
  var AR = function (n) { try { return Number(n).toLocaleString(locale()); } catch (e) { return String(n); } };
  function gregText(ts) {
    try { return new Date(ts).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' }); }
    catch (e) { return new Date(ts).toDateString(); }
  }
  function daysUntil(ts) {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((ts - t.getTime()) / OCC_DAY);
  }
  /* Arabic counts the noun by the number: «يومين» for 2, «أيام» for 3–10, «يوماً» from
     11 — «بعد ٥ يوم» was wrong for every count it ever printed. One msgid per form,
     so the English side is free to say "in 5 days" for all of them. */
  function whenText(ts) {
    var n = daysUntil(ts);
    if (n <= 0) return SYFS.t('اليوم');
    if (n === 1) return SYFS.t('غداً');
    if (n === 2) return SYFS.t('بعد يومين');
    if (n <= 10) return SYFS.t('بعد {0} أيام', AR(n));
    return SYFS.t('بعد {0} يوماً', AR(n));
  }
  /* the length of a run, in the same three forms — «(يومان)» · «(٦ أيام)» · «(١١ يوماً)».
     ⚠️ The space stays OUTSIDE the msgid: the dictionary stores trimmed keys, and
     ' ({0} أيام)' with its space never matched — English printed the Arabic (§6.101/5). */
  function daysText(n) {
    if (n === 2) return ' ' + SYFS.t('(يومان)');
    if (n <= 10) return ' ' + SYFS.t('({0} أيام)', AR(n));
    return ' ' + SYFS.t('({0} يوماً)', AR(n));
  }

  /* ===== a read-only window onto the sealed engine (v0.101.0) =====
   * The rail's clock card wants two facts this file already computes — today's
   * Hijri date and the occasions that fall on it — and it must NOT recompute them:
   * a second copy of `occKeysFor` is a second answer the day the rules change.
   *
   * ⛔ Declared OUT HERE, below `<<< /OCC-ENGINE >>>`, on purpose. The engine block
   * is byte-identical to its copy in background.js, which is a service worker with
   * no `window` — a single `SYFS.` line inside those markers breaks both the worker
   * and the check that keeps the two copies honest.
   *
   * `occasions.js` is in the manifest bootstrap and loads BEFORE `src/rail.js`, so
   * the card can read this synchronously; the calibration offset is the caller's to
   * pass, because it lives in storage and this file is not the one holding it. */
  SYFS.occ = {
    /* the whitelist-and-reject validator, so a caller reading the raw key gets the
       same rejection of a hand-edited value that this tool's own panel gets */
    settings: occSettings,
    hijri: occHijri,
    hijriText: occHijriT,
    /* one Hijri month, translated — the rail's chip has room for «رمضان» and not for
       the whole «١٤ رمضان ١٤٤٨هـ` that `hijriText` composes. ⛔ It is served from the
       sealed table, never re-parsed out of that string (§6.99/6). */
    monthName: function (m) { return SYFS.t(OCC_MONTHS[m - 1] || ''); },
    /* {hj, list} for one day — `list` is already translated for the interface, so a
       caller writes it to the DOM without knowing this file's dictionary keys */
    today: function (date, offset) {
      var d = (date instanceof Date) ? date : new Date();
      var hj = occHijri(d, (offset === -1 || offset === 1) ? offset : 0);
      if (!hj) return { hj: null, list: [] };
      var list = [];
      occKeysFor(hj, d.getDay()).forEach(function (k) {
        var def = occDef(k);
        if (def) list.push({ key: k, name: SYFS.t(def.name), type: def.type, label: SYFS.t(TYPE_LABEL[def.type] || '') });
      });
      return { hj: hj, list: list };
    },
    /* the first occasion AFTER today (today's own are `today().list`), translated, or
       null. الاثنين والخميس is skipped: it is never more than three days away, so it
       would hide every occasion worth announcing. Stops at the first hit, but a scan
       is still too many Intl calls for a 1s repaint — the caller caches it per day. */
    next: function (date, offset) {
      var d = (date instanceof Date) ? date : new Date();
      var off = (offset === -1 || offset === 1) ? offset : 0;
      for (var i = 1; i <= 400; i++) {
        var day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
        var hj = occHijri(day, off);
        if (!hj) return null;
        var ks = occKeysFor(hj, day.getDay());
        for (var j = 0; j < ks.length; j++) {
          var def = ks[j] === 'monthu' ? null : occDef(ks[j]);
          if (def) return { key: ks[j], name: SYFS.t(def.name), type: def.type, when: whenText(day.getTime()) };
        }
      }
      return null;
    }
  };

  /* the helpers src/occasions-body.js (the lazy tool bodies, v0.139.5) reads back — see its header */
  SYFS._occ = { store: store, h: h, send: send, OCC_DEFS: OCC_DEFS, OCC_DEFAULTS: OCC_DEFAULTS, occSettings: occSettings, occHijri: occHijri, occScan: occScan, occRuns: occRuns, occNextFire: occNextFire, occDef: occDef, TYPE_LABEL: TYPE_LABEL, occHijriT: occHijriT, AR: AR, gregText: gregText, whenText: whenText, daysText: daysText };
}());
