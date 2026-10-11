/* SYF — «التحفيظ» page (hifz.html, v0.182.0). The decisions — what is new today, what is
 * due, how a rating moves a segment — are all in src/hifz-core.js; this file draws them
 * and talks to storage and the worker.
 *
 * The recitation is sent to the worker as SYFS_CLIP with a plan (reps / loops / gap / rate
 * — «محرك الآيات», v0.180.0): it checks every URL against CLIP_HOSTS and the offscreen
 * document plays it, broadcasting SYFS_CLIPSTATE, which this page hears directly.
 *
 * ⛔ The Quran text comes from data/quran-uthmani.json (tools/quran-data-build.js, hash
 * pinned by tools/hifz-data-test.js) and is only ever written with textContent, inside
 * translate="no". */
(function () {
  'use strict';
  var SYFS = window.SYFS = window.SYFS || {};
  var $ = function (id) { return document.getElementById(id); };
  if (!$('v-today') || !SYFS.hifzCore) return;

  var H = SYFS.hifzCore, store = SYFS.store;
  /* i18n-via: T, tf — T IS SYFS.t (with a fallback before i18n.js answers); tf fills
     {placeholders} AFTER the lookup, so each msgid stays one whole sentence */
  var T = function (s) { return SYFS.t ? SYFS.t(s) : s; };
  function tf(id, map) { var s = T(id); Object.keys(map).forEach(function (k) { s = s.split('{' + k + '}').join(map[k]); }); return s; }

  var AUDIO = 'https://cdn.islamic.network/quran/audio/128/';      /* = CLIP_HOSTS in background.js */
  var EDITIONS = { minshawi: 'ar.minshawi', husary: 'ar.husary' };
  var D = null, LENS = null, plan = H.cleanPlan(null), log = H.cleanLog(null, []), ui = { theme: 'light' };
  var today = H.ymd(new Date());
  var target = null;            /* the session's range: { s, a0, a1, isNew } */
  var sess = null, level = 0;
  var quiz = null;              /* { items: [{range, part}], k, j, marks: [] , res: {ok,mid,bad} } */

  function lang() { return (SYFS.i18n && SYFS.i18n.get()) || 'ar'; }
  function fmt(n) { try { return Number(n).toLocaleString(SYFS.i18n.locale()); } catch (e) { return String(n); } }
  function ar(n) { return Number(n).toLocaleString('ar-EG'); }     /* ayah markers: the mushaf's digits */
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function sur(n) { return D.s[n - 1]; }
  function sname(n) { return lang() === 'en' ? sur(n).en : sur(n).ar; }
  function label(r) { return sname(r.s) + ' ' + fmt(r.a0 + 1) + (r.a1 > r.a0 ? '–' + fmt(r.a1 + 1) : ''); }
  function count(r) { return r.a1 - r.a0 + 1; }
  function ayahs(k) { return tf(k === 1 ? 'آية واحدة' : (k <= 10 ? '{n} آيات' : '{n} آية'), { n: fmt(k) }); }
  function saveLog() { return store.set('hifz_log', log); }
  function savePlan() { return store.set('hifz_plan', plan); }

  /* ===================== اليوم ===================== */
  function streakNow() { return (log.streak.last === today || log.streak.last === H.addDays(today, -1)) ? log.streak.n : 0; }
  function paintHead() { $('h-streak').textContent = '🔥 ' + tf('{n} يوماً', { n: fmt(streakNow()) }); }
  function mastery() {
    var rated = log.segs.filter(function (g) { return g.ease && g.last && H.diffDays(g.last, today) <= 7; });
    if (!rated.length) return '—';
    var ok = rated.filter(function (g) { return g.ease === 'ok'; }).length;
    return fmt(Math.round(ok * 100 / rated.length)) + '٪';
  }
  function rangeRow(r, onListen) {
    var li = el('li');
    li.appendChild(el('span', 'rg', label(r))).setAttribute('translate', 'no');
    var b = el('button', 'btn sm', T('استمع')); b.type = 'button';
    b.addEventListener('click', function () { onListen(r); });
    li.appendChild(b);
    return li;
  }
  var TODAY = null;
  function paintToday() {
    var st = H.stats(plan, log, LENS);
    $('k-ay').textContent = fmt(st.ayahs); $('k-su').textContent = fmt(st.surahs);
    $('k-st').textContent = fmt(streakNow()); $('k-ok').textContent = mastery();
    var pc = st.ayahs * 100 / st.total;
    $('k-pct').textContent = fmt(Math.round(pc * 10) / 10) + '٪';
    $('k-bar').style.width = pc.toFixed(2) + '%';
    paintHead();

    var t = TODAY = H.todayPlan(plan, log, LENS, today);
    var go = $('t-new-go');
    if (t.fresh) {
      $('t-new').textContent = label(t.fresh);
      $('t-new-sub').textContent = t.freshDone ? T('✓ حفظت مقطع اليوم — راجعه متى شئت') : ayahs(count(t.fresh));
      go.textContent = (t.freshDone ? T('راجع مقطع اليوم') : T('ابدأ الحفظ')); go.disabled = false;
    } else {
      $('t-new').textContent = '';
      $('t-new-sub').textContent = (t.memoDay ? T('أتممت حفظ المصحف كاملاً — بارك الله فيك.') : T('اليوم للمراجعة فقط، بلا حفظ جديد.'));
      go.disabled = true; go.textContent = T('ابدأ الحفظ');
    }
    var nu = $('t-near'); nu.textContent = '';
    t.near.forEach(function (x) { nu.appendChild(rangeRow(x.g, function (r) { openSession(r, false); })); });
    $('t-near-empty').hidden = t.near.length > 0;
    $('t-near-go').disabled = !t.near.length;
    $('t-near-go').textContent = (t.nearDone ? T('✓ راجعت — أعد الاختبار') : T('راجع واختبر'));
    var fu = $('t-far'); fu.textContent = '';
    t.far.forEach(function (r) { fu.appendChild(rangeRow(r, function (x) { openSession(x, false); })); });
    $('t-far-empty').hidden = t.far.length > 0;
    $('t-far-go').disabled = !t.far.length;
    $('t-far-go').textContent = (t.farDone ? T('✓ راجعت — أعد الاختبار') : T('ابدأ المراجعة'));
    $('t-far-sub').textContent = t.far.length ? tf('{n} في دورة من {c} أيام', { n: ayahs(t.far.reduce(function (a, r) { return a + count(r); }, 0)), c: fmt(plan.cycle) }) : '';
  }
  $('t-new-go').addEventListener('click', function () { if (TODAY && TODAY.fresh) openSession(TODAY.fresh, !TODAY.freshDone); });
  $('t-near-go').addEventListener('click', function () { if (TODAY) startQuiz(TODAY.near.map(function (x) { return { range: x.g, part: 'near' }; }), T('مراجعة قريبة')); });
  $('t-far-go').addEventListener('click', function () { if (TODAY) startQuiz(TODAY.far.map(function (r) { return { range: r, part: 'far' }; }), T('مراجعة بعيدة')); });

  /* ===================== جلسة الحفظ ===================== */
  function openSession(r, isNew) {
    stopAudio();
    target = { s: r.s, a0: r.a0, a1: r.a1, isNew: !!isNew };
    paintSession();
    show('sess');
  }
  function paintSession() {
    var box = $('s-text'); box.textContent = '';
    $('s-reciter').value = plan.reciter; $('s-reps').value = String(plan.reps);
    $('s-loops').value = String(plan.loops); $('s-gap').value = String(plan.gap);
    if (!target) {
      $('s-title').textContent = '';
      box.appendChild(el('p', 'muted', T('اختر مقطعاً من تبويب «اليوم».'))).setAttribute('translate', 'yes');
      $('s-play').disabled = true; $('s-learned').hidden = true; $('s-learned-ok').hidden = true;
      return;
    }
    $('s-play').disabled = false;
    $('s-title').textContent = label(target);
    var sr = sur(target.s);
    if (target.a0 === 0 && sr.n !== 1 && sr.n !== 9) { var b = el('div', 'basmala', D.basmala); b.dataset.i = '-1'; box.appendChild(b); }
    for (var i = target.a0; i <= target.a1; i++) {
      var a = el('span', 'ayah'); a.dataset.i = String(i);
      H.words(sr.a[i]).forEach(function (w, wi) { a.appendChild(word(w, wi)); a.appendChild(document.createTextNode(' ')); });
      box.appendChild(a);
      box.appendChild(el('span', 'num', '﴿' + ar(i + 1) + '﴾'));
      box.appendChild(document.createTextNode(' '));
    }
    var learnedToday = log.segs.some(function (g) { return g.s === target.s && g.a0 === target.a0 && g.a1 === target.a1 && g.learned === today && !g.old; });
    $('s-learned').hidden = !target.isNew || learnedToday;
    $('s-learned-ok').hidden = !(target.isNew && learnedToday);
  }
  /* one word at the current hiding level: 0 whole · 1 first letter · 2 every other word
     hidden · 3 all hidden. A hidden word is still the word (textContent), only painted
     transparent — tapping it shows it. */
  function word(w, wi) {
    var span = el('span', 'w');
    var hide = level === 3 || (level === 2 && wi % 2 === 1);
    if (level === 1) {
      var c = H.firstCluster(w);
      span.className = 'w hint'; span.dataset.w = w;
      span.appendChild(document.createTextNode(c.rest ? c.head + '\u200D' : c.head));   /* ZWJ keeps the letter's joining form */
      if (c.rest) { var rest = el('span', 'rest'); rest.style.width = Math.min(3, 0.35 * c.rest) + 'em'; span.appendChild(rest); }
    } else {
      span.textContent = w;
      if (hide) span.className = 'w hid';
    }
    if (span.className !== 'w') { span.tabIndex = 0; span.setAttribute('role', 'button'); span.setAttribute('aria-label', T('المح الكلمة')); }
    return span;
  }
  function peek(e) {
    var w = e.target.closest('.w.hid, .w.hint'); if (!w) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    var txt = w.dataset.w || w.textContent; w.className = 'w peek'; w.textContent = txt;
    w.removeAttribute('role'); w.removeAttribute('tabindex'); w.removeAttribute('aria-label');
  }
  $('s-text').addEventListener('click', peek); $('s-text').addEventListener('keydown', peek);
  $('s-lvl').addEventListener('input', function () { level = +this.value; paintSession(); });
  [['s-reciter', 'reciter', String], ['s-reps', 'reps', Number], ['s-loops', 'loops', Number], ['s-gap', 'gap', Number]].forEach(function (x) {
    $(x[0]).addEventListener('change', function () {
      var next = {}; Object.keys(plan).forEach(function (k) { next[k] = plan[k]; });
      next[x[1]] = x[2](this.value);
      plan = H.cleanPlan(next); savePlan();
      if (sess) startAudio();
    });
  });
  $('s-learned').addEventListener('click', function () {
    if (!target) return;
    H.learn(log, target, today); saveLog();
    paintSession(); paintToday(); paintMap();
  });

  /* ---------- the recitation ---------- */
  function send(msg) {
    return new Promise(function (res) {
      try { chrome.runtime.sendMessage(msg, function (r) { void chrome.runtime.lastError; res(r || null); }); }
      catch (e) { res(null); }
    });
  }
  function light(i) {
    Array.prototype.forEach.call($('s-text').querySelectorAll('[data-i]'), function (e) { e.classList.toggle('on', +e.dataset.i === i); });
    var hit = $('s-text').querySelector('.on');
    if (hit && hit.scrollIntoView) hit.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function startAudio() {
    if (!target) return;
    var sr = sur(target.s), ed = EDITIONS[plan.reciter];
    var basm = target.a0 === 0 && sr.n !== 1 && sr.n !== 9;
    var urls = basm ? [AUDIO + ed + '/1.mp3'] : [];
    for (var i = target.a0; i <= target.a1; i++) urls.push(AUDIO + ed + '/' + (sr.g + i) + '.mp3');
    var p = sess = { n: urls.length, basm: basm, from: target.a0 };
    $('s-play').hidden = true; $('s-stop').hidden = false; $('s-now').textContent = T('جارٍ التحميل…');
    send({ type: 'SYFS_CLIP', op: 'play', urls: urls, reps: plan.reps, loops: plan.loops, gap: plan.gap }).then(function (r) {
      if (sess !== p) return;
      if (!r || !r.ok) { endAudio(); $('s-now').textContent = T('تعذّر تشغيل التلاوة — تحقّق من الاتصال بالإنترنت.'); }
    });
  }
  function endAudio() { sess = null; $('s-play').hidden = false; $('s-stop').hidden = true; $('s-now').textContent = ''; light(-2); }
  function stopAudio() { if (sess) send({ type: 'SYFS_CLIP', op: 'stop' }); endAudio(); }
  $('s-play').addEventListener('click', startAudio);
  $('s-stop').addEventListener('click', stopAudio);
  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== 'SYFS_CLIPSTATE' || !sess) return;
    if (msg.evt === 'clipend') { endAudio(); return; }
    if (msg.evt !== 'clip' && msg.evt !== 'gap') return;
    if ((msg.n | 0) !== sess.n) { endAudio(); return; }          /* another surface took the channel */
    var i = msg.i | 0, a = sess.basm ? (i === 0 ? -1 : sess.from + i - 1) : sess.from + i;
    light(a);
    var what = a < 0 ? T('البسملة') : tf('الآية {n}', { n: fmt(a + 1) });
    var parts = [what, tf('المرة {a} من {b}', { a: fmt((msg.r | 0) + 1), b: fmt(plan.reps) })];
    if (plan.loops > 1) parts.push(tf('الجولة {a} من {b}', { a: fmt((msg.l | 0) + 1), b: fmt(plan.loops) }));
    parts.push(T(msg.evt === 'gap' ? 'ردّد الآن' : 'استمع'));
    $('s-now').textContent = parts.join(' · ');
  });
  window.addEventListener('pagehide', function () { if (sess) send({ type: 'SYFS_CLIP', op: 'stop' }); });

  /* ===================== اختبر نفسك ===================== */
  function startQuiz(items, title) {
    stopAudio();
    quiz = { items: items, k: 0, j: items.length ? items[0].range.a0 : 0, marks: [], res: { ok: 0, mid: 0, bad: 0 }, title: title };
    show('test');
    paintQuiz();
  }
  function paintQuiz() {
    var box = $('q-box'), has = quiz && quiz.k < quiz.items.length;
    $('q-empty').hidden = !!quiz;
    $('q-title').textContent = quiz ? quiz.title : '';
    box.hidden = !has; $('q-show').hidden = !has; $('q-rate').hidden = true;
    $('q-done').hidden = !quiz || has;
    $('q-at').textContent = ''; $('q-at').hidden = true;
    if (!quiz) return;
    if (!has) { summary(); return; }
    var it = quiz.items[quiz.k], r = it.range;
    $('q-at').hidden = false;
    $('q-at').textContent = label(r) + ' · ' + tf('الآية {a} من {b}', { a: fmt(quiz.j - r.a0 + 1), b: fmt(count(r)) });
    var ws = H.words(sur(r.s).a[quiz.j]);
    box.textContent = '';
    var p = el('div');
    p.appendChild(document.createTextNode(ws.slice(0, 2).join(' ') + ' '));
    p.appendChild(el('span', 'gone', '…'));
    box.appendChild(p);
    $('q-show').focus();
  }
  $('q-show').addEventListener('click', function () {
    var it = quiz.items[quiz.k];
    var box = $('q-box'); box.textContent = '';
    box.appendChild(el('div', '', sur(it.range.s).a[quiz.j]));
    this.hidden = true; $('q-rate').hidden = false;
    $('q-rate').querySelector('button').focus();
  });
  document.querySelectorAll('[data-r]').forEach(function (b) {
    b.addEventListener('click', function () {
      var it = quiz.items[quiz.k], e = b.dataset.r;
      quiz.marks.push(e); quiz.res[e]++;
      if (quiz.j < it.range.a1) { quiz.j++; paintQuiz(); return; }
      /* the segment's rating is its worst ayah */
      H.rate(log, it.range, H.worst(quiz.marks), today, it.part); saveLog();
      quiz.k++; quiz.marks = [];
      if (quiz.k < quiz.items.length) quiz.j = quiz.items[quiz.k].range.a0;
      paintQuiz(); paintToday(); paintMap();
    });
  });
  function summary() {
    var d = $('q-done'); d.textContent = '';
    d.appendChild(el('h3', '', T('انتهى الاختبار')));
    d.appendChild(el('p', '', tf('أتقنت {a} · تردّدت {b} · نسيت {c}', { a: fmt(quiz.res.ok), b: fmt(quiz.res.mid), c: fmt(quiz.res.bad) })));
    d.appendChild(el('p', 'muted', T(quiz.res.bad ? 'ما نسيته يعود في مراجعة الغد.' : (quiz.res.mid ? 'ما تردّدت فيه يعود بعد 3 أيام.' : 'ممتاز — كل مقطع يبقى في دورته.'))));
    var b = el('button', 'btn primary', T('العودة إلى «اليوم»')); b.type = 'button';
    b.addEventListener('click', function () { show('today'); });
    d.appendChild(b);
  }

  /* ===================== خريطتي ===================== */
  function paintMap() {
    var g = $('m-grid'); g.textContent = '';
    H.mapStatus(plan, log, LENS, today).forEach(function (x, i) {
      var c = el('div', 'cell' + (x.st ? ' ' + x.st : ''));
      var nm = el('span', '', sur(i + 1).ar); nm.setAttribute('translate', 'no');
      c.appendChild(nm);
      c.appendChild(el('small', '', x.st === 'm' ? ayahs(x.n) : (x.k ? fmt(x.k) + ' / ' + fmt(x.n) : ayahs(x.n))));
      c.title = sname(i + 1);
      g.appendChild(c);
    });
  }

  /* ===================== الخطة ===================== */
  var DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var DAY_ORDER = [6, 0, 1, 2, 3, 4, 5];            /* the week as it is read here: Saturday first */
  function paintPlan() {
    $('p-welcome').hidden = plan.started;
    $('p-dir').value = plan.dir; $('p-daily').value = String(plan.daily);
    $('p-cycle').value = String(plan.cycle); $('p-remind').value = plan.remind;
    var dd = $('p-days'); dd.textContent = '';
    DAY_ORDER.forEach(function (i) {
      var l = el('label'), cb = el('input'); cb.type = 'checkbox'; cb.checked = plan.days[i]; cb.dataset.day = String(i);
      l.appendChild(cb); l.appendChild(document.createTextNode(T(DAY_NAMES[i]))); dd.appendChild(l);
    });
    var mm = $('p-memo'); mm.textContent = '';
    D.s.forEach(function (sr) {
      var l = el('label'), cb = el('input'); cb.type = 'checkbox'; cb.checked = !!plan.memo[sr.n]; cb.dataset.s = String(sr.n);
      l.appendChild(cb); l.appendChild(document.createTextNode(sr.ar)); l.title = sr.en; mm.appendChild(l);
      cb.addEventListener('change', paintEstimate);
    });
    $('p-save').textContent = (plan.started ? T('حفظ الخطة') : T('ابدأ الخطة'));
    $('p-err').hidden = true;
    paintEstimate();
  }
  function formPlan() {
    var days = [false, false, false, false, false, false, false];
    $('p-days').querySelectorAll('input').forEach(function (cb) { days[+cb.dataset.day] = cb.checked; });
    var memo = {};
    $('p-memo').querySelectorAll('input').forEach(function (cb) { if (cb.checked) memo[cb.dataset.s] = true; });
    return { started: true, dir: $('p-dir').value, daily: +$('p-daily').value, cycle: +$('p-cycle').value, days: days, remind: $('p-remind').value,
      reciter: plan.reciter, reps: plan.reps, loops: plan.loops, gap: plan.gap, memo: memo, _days: days };
  }
  function paintEstimate() {
    var f = formPlan(), p = H.cleanPlan(f);
    if (f._days.indexOf(true) < 0) { $('p-est').textContent = T('اختر يوماً واحداً على الأقل للحفظ الجديد.'); return; }
    var left = H.daysLeft(p, log, LENS);
    $('p-est').textContent = left > 0 ? tf('بهذه الخطة تُتم المصحف في نحو {n} يوماً.', { n: fmt(left) }) : T('كل المصحف محفوظ في هذه الخطة.');
  }
  ['p-dir', 'p-daily', 'p-days'].forEach(function (id) { $(id).addEventListener('change', paintEstimate); });
  $('p-memo-amma').addEventListener('click', function () { $('p-memo').querySelectorAll('input').forEach(function (cb) { var n = +cb.dataset.s; cb.checked = n >= 78; }); paintEstimate(); });
  $('p-memo-none').addEventListener('click', function () { $('p-memo').querySelectorAll('input').forEach(function (cb) { cb.checked = false; }); paintEstimate(); });
  $('p-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = formPlan();
    if (f._days.indexOf(true) < 0) { var er = $('p-err'); er.textContent = T('اختر يوماً واحداً على الأقل للحفظ الجديد.'); er.hidden = false; return; }
    if (f.remind && !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.remind)) f.remind = '';
    plan = H.cleanPlan(f);
    savePlan().then(function () { paintAll(); show('today'); });
  });

  /* ===================== views, theme, start ===================== */
  function show(v) {
    ['today', 'sess', 'test', 'map', 'plan'].forEach(function (x) { $('v-' + x).hidden = x !== v; });
    document.querySelectorAll('[data-v]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.v === v)); });
    if (v !== 'sess') stopAudio();
    if (v === 'sess' && !target && TODAY) {
      if (TODAY.fresh) target = { s: TODAY.fresh.s, a0: TODAY.fresh.a0, a1: TODAY.fresh.a1, isNew: !TODAY.freshDone };
      else if (TODAY.near.length) target = { s: TODAY.near[0].g.s, a0: TODAY.near[0].g.a0, a1: TODAY.near[0].g.a1, isNew: false };
      paintSession();
    }
    if (v === 'test') paintQuiz();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[data-v]').forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.v); }); });
  function paintTheme() {
    document.documentElement.setAttribute('data-theme', ui.theme);
    $('h-theme').setAttribute('aria-pressed', String(ui.theme === 'dark'));
  }
  /* inside the rail's window (?host=win): offer the full tab, same page, same storage */
  if (/[?&]host=win(&|$)/.test(location.search)) {
    document.documentElement.classList.add('in-win');
    $('h-tab').hidden = false;
    $('h-tab').addEventListener('click', function () { try { chrome.runtime.sendMessage({ type: 'SYFS_OPEN_HIFZ' }, function () { void chrome.runtime.lastError; }); } catch (e) {} });
  }
  $('h-theme').addEventListener('click', function () { ui.theme = ui.theme === 'dark' ? 'light' : 'dark'; paintTheme(); store.set('hifz_ui', ui); });
  function paintAll() { paintToday(); paintMap(); paintPlan(); paintSession(); }
  /* a page left open past midnight moves to the new day when it is looked at again */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !D) return;
    var now = H.ymd(new Date());
    if (now !== today) { today = now; paintAll(); }
  });

  paintTheme();
  Promise.all([
    fetch(chrome.runtime.getURL('data/quran-uthmani.json')).then(function (r) { return r.json(); }),
    store.get('hifz_plan', null), store.get('hifz_log', null), store.get('hifz_ui', null), store.get('ui_lang', 'ar')
  ]).then(function (v) {
    D = v[0];
    if (!D || !Array.isArray(D.s) || D.s.length !== 114) throw new Error('bad data');
    LENS = H.lensOf(D);
    plan = H.cleanPlan(v[1]); log = H.cleanLog(v[2], LENS);
    ui = { theme: v[3] && v[3].theme === 'dark' ? 'dark' : 'light' };
    paintTheme();
    return SYFS.i18n ? SYFS.i18n.apply(v[4]) : null;
  }).then(function () {
    paintAll();
    show(plan.started ? 'today' : 'plan');
    if (SYFS.i18n) SYFS.i18n.onChange(paintAll);
  }).catch(function () {
    var t = $('v-today'); t.textContent = '';
    t.appendChild(el('p', 'err', T('تعذّر تحميل المصحف — أعد فتح الصفحة.')));
  });
}());
