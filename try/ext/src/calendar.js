/* SYF — التقويم والمهام (calendar).  spec: specs/calendar-tasks.md
 *
 * A month grid whose key is THE DAY, and under it the three things a day holds:
 * ordered work, a free note, and reminders that fire at a time.
 *
 * WHY A NEW TOOL AND NOT A TAB IN «تنبيهات ومواعيد»
 * `alarm` and `reminders` both run on a setInterval INSIDE their tool window
 * (`every()` in tools2.js) — they die the moment the window closes. A reminder set
 * for next Tuesday has to outlive the tab it was typed in, so this tool's scheduling
 * lives in the worker (`syfs_cal`, background.js) and is a copy of the occasions
 * scheduler, not a new mechanism.
 *
 * The panel NEVER schedules anything. It writes `cal_days`; the worker watches that
 * key through chrome.storage.onChanged and re-arms itself. One arming path, and it
 * works identically from the rail and from all five extension pages that host the
 * dock — a message the panel must remember to send is a message the sixth surface
 * forgets. */
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

  /* ===== keys, caps ===== */
  var DAYS_KEY = 'cal_days', PREFS_KEY = 'cal_prefs';
  /* Clipped, never rejected in silence: a paste that is one character over should
     lose the character, not the paste.
     ⚠️ Every cap is set as a PROPERTY (`el.maxLength = …`) and never interpolated
     into the markup. `maxlength="' + CAP + '"` ends the string literal in the middle
     of an attribute, so the extractor no longer sees valid HTML and lifts the broken
     fragment — `<input class="syf-in tk-x" placeholder="عمل جديد…" maxlength="` —
     into the dictionary as a msgid that can never be translated and can never go
     away. Same family as splitting a sentence with an inline <b> (§6.102/3): the
     runtime is fine, the TOOLING is what breaks. */
  var CAP_TITLE = 80, CAP_TASK = 160, CAP_NOTE = 4000;
  var CAP_TASKS = 200, CAP_EVENTS = 50, CAP_DAYS = 2000;

  /* Six spelled-out msgids instead of one «قبل {0} دقيقة»: Arabic pluralises 3–10
     («٥ دقائق») differently from 11+ («١٥ دقيقة»), so a single template with a
     placeholder can only be right for some of its own options. */
  var LEADS = [[0, 'في وقته'], [5, 'قبل ٥ دقائق'], [15, 'قبل ١٥ دقيقة'],
               [30, 'قبل نصف ساعة'], [60, 'قبل ساعة'], [1440, 'قبل يوم']];
  var WEEK0S = [['auto', 'تلقائي حسب اللغة'], ['6', 'السبت'], ['0', 'الأحد'], ['1', 'الاثنين']];

  /* ===== state ===== */
  var days = {}, prefs = { week0: 'auto', hijri: false, at: '09:00' };
  var loaded = false, lastSaved = '', repaint = null;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* ⚠️ LOCAL date key — never toISOString(). That string is UTC, so east of
     Greenwich every evening after 21:00 «today» would key to TOMORROW and a
     reminder typed tonight would be filed on the wrong day. */
  function dkey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function keyDate(k) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
  }
  function uid() { return 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }
  function loc() { return (SYFS.i18n && SYFS.i18n.locale) ? SYFS.i18n.locale() : 'ar-EG'; }
  function rtl() { return (SYFS.i18n && SYFS.i18n.dir) ? SYFS.i18n.dir() === 'rtl' : true; }
  /* ⛔ useGrouping:false — a day and a year are labels, not quantities: «٢٠٢٦» must
     never print as «٢٬٠٢٦» (same rule as the Hijri year in tools2.js). */
  function num(n) { try { return Number(n).toLocaleString(loc(), { useGrouping: false }); } catch (e) { return String(n); } }

  /* ===== storage ===== */
  function day(k, make) {
    var d = days[k];
    if (!d && make) d = days[k] = { n: '', t: [], e: [] };
    return d || null;
  }
  function isEmpty(d) {
    return !d || (!String(d.n || '').trim() && !(d.t || []).length && !(d.e || []).length);
  }
  function save() {
    /* An empty day must leave no trace — otherwise the map grows by one key for
       every day the user ever CLICKED, and the grid's "has something" dot starts
       lying. */
    Object.keys(days).forEach(function (k) { if (isEmpty(days[k])) delete days[k]; });
    var keys = Object.keys(days);
    if (keys.length > CAP_DAYS) {
      keys.sort();                                  /* the key sorts as the date does */
      keys.slice(0, keys.length - CAP_DAYS).forEach(function (k) { delete days[k]; });
    }
    lastSaved = stamp(days);
    store.set(DAYS_KEY, days);
  }
  function savePrefs() { store.set(PREFS_KEY, prefs); }
  function stamp(o) { try { return JSON.stringify(o); } catch (e) { return ''; } }

  function loadAll() {
    return Promise.all([store.get(DAYS_KEY, null), store.get(PREFS_KEY, null)]).then(function (r) {
      var d = r[0];
      days = (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
      lastSaved = stamp(days);
      var p = (r[1] && typeof r[1] === 'object') ? r[1] : {};
      prefs.week0 = (p.week0 === 6 || p.week0 === 0 || p.week0 === 1) ? p.week0 : 'auto';
      prefs.hijri = !!p.hijri;
      prefs.at = /^([01]\d|2[0-3]):([0-5]\d)$/.test(p.at) ? p.at : '09:00';
      loaded = true;
    });
  }

  /* The worker writes `cal_days` too — it stamps `f` on a reminder the moment it
     fires. Without this the open panel would still hold the pre-fire copy and its
     next save would put `f` back to 0, so the same reminder would fire again on
     every re-arm. The stamp comparison is what keeps our OWN writes from
     round-tripping back through here mid-typing. */
  try {
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area !== 'local' || !ch) return;
      if (ch[DAYS_KEY]) {
        var v = ch[DAYS_KEY].newValue;
        var s = stamp(v);
        if (s !== lastSaved) {
          days = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
          lastSaved = s;
          if (repaint) { try { repaint(); } catch (e) {} }
        }
      }
      if (ch[PREFS_KEY] && ch[PREFS_KEY].newValue && typeof ch[PREFS_KEY].newValue === 'object') {
        var p = ch[PREFS_KEY].newValue;
        prefs.week0 = (p.week0 === 6 || p.week0 === 0 || p.week0 === 1) ? p.week0 : 'auto';
        prefs.hijri = !!p.hijri;
        prefs.at = /^([01]\d|2[0-3]):([0-5]\d)$/.test(p.at) ? p.at : '09:00';
        if (repaint) { try { repaint(); } catch (e) {} }
      }
    });
  } catch (e) {}

  /* ===== calendar maths & locale formatting =====
     Everything below comes out of Intl, not out of i18n/en.json: a month name and a
     digit set are LOCALE OUTPUT and the dictionary cannot reach them (§6.101/6). */
  function week0() {
    if (prefs.week0 === 6 || prefs.week0 === 0 || prefs.week0 === 1) return prefs.week0;
    /* derived, never stored on first use — stored, it would stay wrong forever the
       moment the user switches language */
    return loc().indexOf('ar') === 0 ? 6 : 0;       /* السبت | Sunday */
  }
  /* 'short' when it fits the column, 'narrow' when it does not — MEASURED, not
     chosen per language. ar-EG has no abbreviated weekday in CLDR («الثلاثاء» is
     what 'short' returns), while en-GB's "Tue" is exactly what a calendar wants.
     One rule answers both, and it keeps answering if a third language arrives. */
  function wdNames() {
    function build(style) {
      var f = new Intl.DateTimeFormat(loc(), { weekday: style }), a = [], i;
      /* 2024-01-07 is a Sunday, so day 7+w always has weekday w */
      for (i = 0; i < 7; i++) a.push(f.format(new Date(2024, 0, 7 + ((week0() + i) % 7))));
      return a;
    }
    try {
      var out = build('short');
      for (var i = 0; i < 7; i++) if (out[i].length > 3) return build('narrow');
      return out;
    } catch (e) { return ['', '', '', '', '', '', '']; }
  }
  var hjF = null, hjFull = null, hjLoc = '';
  function hjFmts() {
    if (hjLoc === loc() && hjF) return;
    hjLoc = loc();
    /* umm al-qura, the same calendar src/tools2.js already converts with */
    hjF = new Intl.DateTimeFormat(hjLoc + '-u-ca-islamic-umalqura', { day: 'numeric' });
    hjFull = new Intl.DateTimeFormat(hjLoc + '-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function hijriDay(d) { try { hjFmts(); return hjF.format(d); } catch (e) { return ''; } }
  function hijriFull(d) { try { hjFmts(); return hjFull.format(d); } catch (e) { return ''; } }
  function fullDate(d) {
    try { return d.toLocaleDateString(loc(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (e) { return dkey(d); }
  }
  function monthTitle(d) {
    try { return new Intl.DateTimeFormat(loc(), { month: 'long', year: 'numeric' }).format(d); }
    catch (e) { return dkey(d); }
  }
  function fmtTime(hm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hm || '');
    if (!m) return '';
    try { return new Intl.DateTimeFormat(loc(), { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, +m[1], +m[2])); }
    catch (e) { return hm; }
  }
  function evTime(ev) { return (ev && ev.at) ? ev.at : prefs.at; }
  function byTime(a, b) { return evTime(a) < evTime(b) ? -1 : (evTime(a) > evTime(b) ? 1 : 0); }

  /* the row the dragged one should land BEFORE (null → append) */
  function afterBy(box, sel, y) {
    var best = null, bestD = -Infinity;
    box.querySelectorAll(sel).forEach(function (el) {
      var r = el.getBoundingClientRect(), d = y - r.top - r.height / 2;
      if (d < 0 && d > bestD) { bestD = d; best = el; }
    });
    return best;
  }

  /* ===== the panel ===== */
  function mountCal(body) {
    var now = new Date();
    var view = new Date(now.getFullYear(), now.getMonth(), 1);
    var sel = dkey(now);

    body.appendChild(h(
      '<div class="syf-cal">' +
        '<div class="syf-cal-head">' +
          '<button class="syf-cal-nav prev" type="button" title="الشهر السابق"></button>' +
          '<span class="syf-cal-title"></span>' +
          '<button class="syf-cal-nav next" type="button" title="الشهر التالي"></button>' +
          '<button class="syf-mini syf-cal-today" type="button">اليوم</button>' +
        '</div>' +
        '<div class="syf-cal-wd"></div>' +
        /* no tabindex on the grid itself: the cells carry a ROVING one (below), so
           the month is a single tab stop, not forty-two */
        '<div class="syf-cal-grid" role="grid"></div>' +
        '<div class="syf-cal-day"></div>' +
        '<div class="syf-cal-set"></div>' +
      '</div>'));

    var titleEl = body.querySelector('.syf-cal-title');
    var wdEl = body.querySelector('.syf-cal-wd');
    var grid = body.querySelector('.syf-cal-grid');
    var dayEl = body.querySelector('.syf-cal-day');
    var setEl = body.querySelector('.syf-cal-set');

    /* The chevron is a picture of a DIRECTION, and «previous» sits on the reading
       side: leading edge left in English, right in Arabic. The flex row already
       reverses the buttons' order with the direction — only the glyph has to be
       told, because a glyph does not mirror itself. */
    body.querySelector('.prev').textContent = rtl() ? '›' : '‹';   /* i18n-dyn: a chevron follows the layout, not the language */
    body.querySelector('.next').textContent = rtl() ? '‹' : '›';   /* i18n-dyn: a chevron follows the layout, not the language */

    function go(n) {
      view = new Date(view.getFullYear(), view.getMonth() + n, 1);
      renderGrid();
    }
    body.querySelector('.prev').addEventListener('click', function () { go(-1); });
    body.querySelector('.next').addEventListener('click', function () { go(1); });
    body.querySelector('.syf-cal-today').addEventListener('click', function () { pick(dkey(new Date())); });

    /* ---- grid ---- */
    function dotsFor(rec, box) {
      box.textContent = '';
      if (!rec) return;
      if ((rec.t || []).length) box.appendChild(h('<i class="dt"></i>'));
      if (String(rec.n || '').trim()) box.appendChild(h('<i class="dn"></i>'));
      if ((rec.e || []).length) box.appendChild(h('<i class="de"></i>'));
    }
    function paintDots(k) {
      /* the key is /\d{4}-\d{2}-\d{2}/ by construction — nothing here can be a selector */
      var cell = grid.querySelector('.syf-cal-d[data-k="' + k + '"]');
      if (cell) dotsFor(days[k], cell.querySelector('.dots'));
    }
    function renderGrid() {
      titleEl.textContent = monthTitle(view);       /* i18n-dyn: Intl month name — locale output (§6.101/6) */
      wdEl.textContent = '';
      wdNames().forEach(function (n) {
        var s = document.createElement('span');
        s.textContent = n;                          /* i18n-dyn: Intl weekday name — locale output (§6.101/6) */
        wdEl.appendChild(s);
      });
      var first = new Date(view.getFullYear(), view.getMonth(), 1);
      var shift = (first.getDay() - week0() + 7) % 7;
      var todayK = dkey(new Date());
      grid.textContent = '';
      /* ⚠️ 42 cells ALWAYS. A month that fits in five rows and one that needs six
         would otherwise change the panel's height, and the day pane below would
         jump under the pointer on every month step. */
      for (var i = 0; i < 42; i++) {
        var d = new Date(first.getFullYear(), first.getMonth(), 1 - shift + i);
        var k = dkey(d);
        var cell = h('<button class="syf-cal-d" type="button"><span class="n"></span><span class="hj"></span><span class="dots"></span></button>');
        cell.dataset.k = k;
        cell.querySelector('.n').textContent = num(d.getDate());
        if (prefs.hijri) cell.querySelector('.hj').textContent = hijriDay(d);
        if (d.getMonth() !== view.getMonth()) cell.classList.add('out');
        if (k === todayK) cell.classList.add('today');
        if (k === sel) cell.classList.add('on');
        /* roving tabindex: only the selected day is reachable by Tab, the rest by
           the arrow keys — the standard grid contract, and the alternative is
           forty-two stops between the month and the day pane below it */
        cell.tabIndex = (k === sel) ? 0 : -1;
        cell.setAttribute('aria-label', fullDate(d));
        if (k === sel) cell.setAttribute('aria-selected', 'true');
        dotsFor(days[k], cell.querySelector('.dots'));
        cell.addEventListener('click', function () { pick(this.dataset.k); });
        grid.appendChild(cell);
      }
    }
    function pick(k) {
      sel = k;
      var d = keyDate(k);
      if (d.getMonth() !== view.getMonth() || d.getFullYear() !== view.getFullYear()) {
        view = new Date(d.getFullYear(), d.getMonth(), 1);
        renderGrid();
      } else {
        grid.querySelectorAll('.syf-cal-d').forEach(function (c) {
          var is = c.dataset.k === sel;
          c.classList.toggle('on', is);
          c.tabIndex = is ? 0 : -1;                 /* the roving stop moves with the selection */
          if (is) c.setAttribute('aria-selected', 'true'); else c.removeAttribute('aria-selected');
        });
      }
      renderDay();
    }
    /* Arrow keys, and `e.key` is right here where §5.6/11 demands `e.code` for
       letters: an arrow reports the same `key` on every keyboard layout, and it is
       the ARROW the user pressed, not the position. */
    grid.addEventListener('keydown', function (e) {
      var step = 0;
      if (e.key === 'ArrowUp') step = -7;
      else if (e.key === 'ArrowDown') step = 7;
      else if (e.key === 'ArrowLeft') step = rtl() ? 1 : -1;
      else if (e.key === 'ArrowRight') step = rtl() ? -1 : 1;
      else return;
      e.preventDefault();
      var d = keyDate(sel); d.setDate(d.getDate() + step);
      pick(dkey(d));
      var c = grid.querySelector('.syf-cal-d.on'); if (c) c.focus();
    });

    /* ---- the day ---- */
    function renderDay() {
      var d = keyDate(sel);
      dayEl.textContent = '';
      var head = h('<div class="syf-cal-dhead"><b></b><span></span></div>');
      head.querySelector('b').textContent = fullDate(d);            /* i18n-dyn: Intl date — locale output */
      if (prefs.hijri) head.querySelector('span').textContent = hijriFull(d);  /* i18n-dyn: Intl date — locale output */
      dayEl.appendChild(head);
      dayEl.appendChild(tasksSec(sel));
      dayEl.appendChild(noteSec(sel));
      dayEl.appendChild(evSec(sel));
    }

    /* ---- tasks: the ORDER is the feature ---- */
    function tasksSec(k) {
      var sec = h(
        '<div class="syf-cal-sec"><div class="syf-cal-sech"><b>الأعمال</b><span class="c"></span></div>' +
        '<div class="syf-cal-list"></div>' +
        '<div class="syf-row"><input class="syf-in tk-x" placeholder="عمل جديد…"><button class="syf-mini tk-add" type="button">إضافة</button></div>' +
        '<div class="syf-note-hint">اسحب ⋮⋮ للترتيب — أو Alt + سهم أعلى/أسفل على الصفّ.</div></div>');
      var list = sec.querySelector('.syf-cal-list'), cnt = sec.querySelector('.c');
      var addI = sec.querySelector('.tk-x');
      addI.maxLength = CAP_TASK;
      var arr = (day(k) || {}).t || [];
      var dragRow = null;

      function commit() { save(); paintDots(k); paint(); }
      function paint() {
        list.textContent = '';
        var open = arr.filter(function (t) { return !t.d; }).length;
        cnt.textContent = arr.length ? (num(open) + ' / ' + num(arr.length)) : '';
        if (!arr.length) { list.appendChild(h('<div class="syf-empty">لا أعمال لهذا اليوم.</div>')); return; }
        arr.forEach(function (t) {
          var row = h('<div class="syf-cal-task" tabindex="0">' +
            '<span class="syf-grip" title="اسحب لإعادة الترتيب"><svg class="syf-grip-i" viewBox="0 0 12 18" aria-hidden="true"><circle cx="3.5" cy="3.5" r="1.6"/><circle cx="8.5" cy="3.5" r="1.6"/><circle cx="3.5" cy="9" r="1.6"/><circle cx="8.5" cy="9" r="1.6"/><circle cx="3.5" cy="14.5" r="1.6"/><circle cx="8.5" cy="14.5" r="1.6"/></svg></span>' +
            '<input type="checkbox" class="ck">' +
            '<input class="tx">' +
            '<button class="x" type="button" title="حذف">✕</button></div>');
          row.dataset.i = t.i;
          row.classList.toggle('done', !!t.d);
          var ck = row.querySelector('.ck'), tx = row.querySelector('.tx');
          tx.maxLength = CAP_TASK;
          ck.checked = !!t.d;
          tx.value = t.x || '';                     /* user data — `value` is never translated (§6.103/7) */
          ck.addEventListener('change', function () { t.d = ck.checked; row.classList.toggle('done', t.d); save(); cnt.textContent = num(arr.filter(function (z) { return !z.d; }).length) + ' / ' + num(arr.length); });
          var tmr = null;
          tx.addEventListener('input', function () {
            clearTimeout(tmr);
            tmr = setTimeout(function () { t.x = tx.value.slice(0, CAP_TASK); save(); paintDots(k); }, 400);
          });
          row.querySelector('.x').addEventListener('click', function () {
            var j = arr.indexOf(t); if (j >= 0) arr.splice(j, 1);
            commit();
          });
          /* Alt + ↑/↓ reorders without a mouse — dragging alone would put the one
             feature this tool was asked for out of reach of the keyboard (§16). */
          row.addEventListener('keydown', function (e) {
            if (!e.altKey) return;
            var dir = e.key === 'ArrowUp' ? -1 : (e.key === 'ArrowDown' ? 1 : 0);
            if (!dir) return;
            e.preventDefault(); e.stopPropagation();
            var j = arr.indexOf(t), n = j + dir;
            if (j < 0 || n < 0 || n >= arr.length) return;
            arr.splice(n, 0, arr.splice(j, 1)[0]);
            save(); paint();
            var rows = list.querySelectorAll('.syf-cal-task');
            if (rows[n]) rows[n].focus();
          });
          /* draggable is armed by the GRIP only: with it always on, a drag begun
             inside the text field would tear the row out instead of selecting text */
          row.querySelector('.syf-grip').addEventListener('pointerdown', function () { row.draggable = true; });
          row.addEventListener('dragstart', function (e) {
            dragRow = row; row.classList.add('dragging');
            try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.i); } catch (x) {}
          });
          row.addEventListener('dragend', function () {
            row.classList.remove('dragging'); row.draggable = false;
            if (dragRow === row) {
              var ids = [];
              list.querySelectorAll('.syf-cal-task').forEach(function (r) { ids.push(r.dataset.i); });
              arr.sort(function (a, b) { return ids.indexOf(a.i) - ids.indexOf(b.i); });
              save();
            }
            dragRow = null;
          });
          list.appendChild(row);
        });
      }
      /* once, on the LIST — paint() empties its children, it does not replace it */
      list.addEventListener('dragover', function (e) {
        if (!dragRow || dragRow.parentNode !== list) return;
        e.preventDefault();
        var after = afterBy(list, '.syf-cal-task:not(.dragging)', e.clientY);
        if (after == null) list.appendChild(dragRow); else list.insertBefore(dragRow, after);
      });

      function add() {
        var v = String(addI.value || '').trim().slice(0, CAP_TASK);
        if (!v) { addI.focus(); return; }
        var rec = day(k, true);
        if (rec.t.length >= CAP_TASKS) return;
        rec.t.push({ i: uid(), x: v, d: false });
        arr = rec.t; addI.value = '';
        commit();
      }
      sec.querySelector('.tk-add').addEventListener('click', add);
      addI.addEventListener('keydown', function (e) { if (e.key === 'Enter') add(); });
      paint();
      return sec;
    }

    /* ---- the note ---- */
    function noteSec(k) {
      var sec = h('<div class="syf-cal-sec"><div class="syf-cal-sech"><b>ملاحظة اليوم</b></div>' +
        '<textarea class="syf-in syf-cal-note" rows="3" placeholder="اكتب ملاحظة على هذا اليوم…"></textarea></div>');
      var ta = sec.querySelector('textarea');
      ta.maxLength = CAP_NOTE;
      ta.value = (day(k) || {}).n || '';            /* user data; tree() skips <textarea> for exactly this reason */
      var tmr = null;
      ta.addEventListener('input', function () {
        clearTimeout(tmr);
        tmr = setTimeout(function () {
          day(k, true).n = ta.value.slice(0, CAP_NOTE);
          save(); paintDots(k);
        }, 400);
      });
      return sec;
    }

    /* ---- reminders ---- */
    function evSec(k) {
      var sec = h(
        '<div class="syf-cal-sec"><div class="syf-cal-sech"><b>التنبيهات</b></div>' +
        '<div class="syf-cal-list ev"></div>' +
        '<div class="syf-row"><input class="syf-in ev-x" placeholder="عنوان التنبيه"><input type="time" class="syf-in ev-at"></div>' +
        '<div class="syf-row"><select class="syf-in ev-lead"></select><button class="syf-mini ev-add" type="button">إضافة تنبيه</button></div>' +
        '<div class="syf-note-hint">يصلك التنبيه والصفحة مغلقة — لكن لا يصل والمتصفّح مغلق تماماً.</div></div>');
      var list = sec.querySelector('.ev'), leadS = sec.querySelector('.ev-lead');
      var xI = sec.querySelector('.ev-x'), atI = sec.querySelector('.ev-at');
      xI.maxLength = CAP_TITLE;
      var arr = (day(k) || {}).e || [];

      /* ⚠️ explicit `value` on every option, always (§6.103/4): an option without one
         takes its value from its TEXT, and tree() translates text. */
      LEADS.forEach(function (l) {
        var o = h('<option value="' + l[0] + '"></option>');
        o.textContent = SYFS.t(l[1]);               /* table-driven label — the class §6.103/7 exists for */
        leadS.appendChild(o);
      });

      function paint() {
        list.textContent = '';
        if (!arr.length) { list.appendChild(h('<div class="syf-empty">لا تنبيهات لهذا اليوم.</div>')); return; }
        arr.forEach(function (ev) {
          var row = h('<div class="syf-cal-ev"><button class="bell" type="button" title="تشغيل/إيقاف التنبيه">🔔</button>' +
            '<span class="tm"></span><span class="tx"></span><span class="ld"></span><button class="x" type="button" title="حذف">✕</button></div>');
          row.classList.toggle('off', !ev.on);
          row.querySelector('.tm').textContent = fmtTime(evTime(ev));   /* i18n-dyn: Intl time — locale output */
          /* ⛔ the user's own words — never t(), never wt(). A reminder titled «حفظ»
             must not come back as "Save". */
          row.querySelector('.tx').textContent = ev.x || '';
          var lead = leadLabel(ev.lead);
          if (lead) row.querySelector('.ld').textContent = lead;
          row.querySelector('.bell').addEventListener('click', function () {
            ev.on = !ev.on;
            if (ev.on) ev.f = 0;                    /* switching it back on re-arms it */
            save(); paint();
          });
          row.querySelector('.x').addEventListener('click', function () {
            var j = arr.indexOf(ev); if (j >= 0) arr.splice(j, 1);
            save(); paintDots(k); paint();
          });
          list.appendChild(row);
        });
      }
      function leadLabel(m) {
        for (var i = 0; i < LEADS.length; i++) if (LEADS[i][0] === (m | 0)) return (m | 0) ? SYFS.t(LEADS[i][1]) : '';
        return '';
      }
      function add() {
        var v = String(xI.value || '').trim().slice(0, CAP_TITLE);
        if (!v) { xI.focus(); return; }
        var rec = day(k, true);
        if (rec.e.length >= CAP_EVENTS) return;
        rec.e.push({ i: uid(), x: v, at: /^([01]\d|2[0-3]):([0-5]\d)$/.test(atI.value) ? atI.value : '', lead: parseInt(leadS.value, 10) || 0, on: true, f: 0 });
        rec.e.sort(byTime);
        arr = rec.e; xI.value = '';
        save(); paintDots(k); paint();
      }
      sec.querySelector('.ev-add').addEventListener('click', add);
      xI.addEventListener('keydown', function (e) { if (e.key === 'Enter') add(); });
      paint();
      return sec;
    }

    /* ---- settings ---- */
    function renderSet() {
      setEl.textContent = '';
      var box = h('<div class="syf-cal-sec set"><div class="syf-cal-sech"><b>الإعدادات</b></div>' +
        '<div class="syf-row"><label class="syf-cal-lb">بداية الأسبوع</label><select class="syf-in pf-w"></select></div>' +
        '<div class="syf-row"><label class="syf-cal-lb">ساعة تنبيه اليوم كلّه</label><input type="time" class="syf-in pf-at"></div>' +
        '<label class="syf-ck"><input type="checkbox" class="pf-hj"> إظهار التاريخ الهجري</label>' +
        '<button class="syf-mini pf-test" type="button">جرّب الإشعار</button></div>');
      var wSel = box.querySelector('.pf-w');
      WEEK0S.forEach(function (w) {
        var o = h('<option value="' + w[0] + '"></option>');
        o.textContent = SYFS.t(w[1]);               /* table-driven label (§6.103/7) */
        wSel.appendChild(o);
      });
      wSel.value = String(prefs.week0);
      wSel.addEventListener('change', function () {
        prefs.week0 = wSel.value === 'auto' ? 'auto' : (parseInt(wSel.value, 10) | 0);
        savePrefs(); renderGrid();
      });
      var atI = box.querySelector('.pf-at');
      atI.value = prefs.at;
      atI.addEventListener('change', function () {
        if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(atI.value)) { prefs.at = atI.value; savePrefs(); renderDay(); }
        else atI.value = prefs.at;
      });
      var hj = box.querySelector('.pf-hj');
      hj.checked = !!prefs.hijri;
      hj.addEventListener('change', function () { prefs.hijri = hj.checked; savePrefs(); renderGrid(); renderDay(); });
      box.querySelector('.pf-test').addEventListener('click', function () {
        try { chrome.runtime.sendMessage({ type: 'SYFS_CAL', op: 'test' }, function () { void chrome.runtime.lastError; }); } catch (e) {}
      });
      setEl.appendChild(box);
    }

    repaint = function () {
      if (!body.isConnected) { repaint = null; return; }
      renderGrid(); renderDay(); renderSet();
    };
    renderGrid(); renderDay(); renderSet();
  }

  /* ===== registration =====
   * ⛔ `push` لا `SYFS.tools = (…).concat([…])` (v0.104.0). هذا كان الملفّ الوحيد في
   * المشروع الذي **يعيد إسناد** المصفوفة، و`src/rail.js` يمسك مرجعها في سطره التاسع
   * (`var tools = SYFS.tools || []`) ⇒ المصفوفة الجديدة لا يراها الشريط أبداً:
   * «التقويم والمهام» غائبة عن رفّ «الوقت» وعن لوحة البحث وعن قائمة الإظهار/الإخفاء وعن
   * منتقي الاختصارات — بينما هي موجودة في `SYFS.tools` فلا يبدو شيء معطوباً. قِيس حيّاً.
   * (تظهر في «وضع العمل» وحده لأن `src/app.js` يقرأ المصفوفة بعد تحميل هذا الملفّ.) */
  SYFS.tools = SYFS.tools || [];
  SYFS.tools.push({
    id: 'calendar', name: 'التقويم والمهام', cat: 'time',
    /* A calendar body with agenda dots. `alerts` used to wear a calendar too, and at
       16px two calendar silhouettes in ONE category read as the same tool twice —
       so it moved to a bell (src/tools2.js), which is what it actually is. */
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M7.5 14h.01M12 14h.01M16.5 14h.01M7.5 17.5h.01M12 17.5h.01"/></svg>',
    mount: function (body) {
      if (loaded) { mountCal(body); return; }
      loadAll().then(function () { if (body.isConnected) mountCal(body); });
    }
  });
}());
