/* SYF — «مصحف الأطفال» (kids.html, v0.181.0).
 * The Fatiha + Juz Amma for children: a grid of surahs, a reading screen where each ayah
 * is recited, lit, then followed by a silence the length of the ayah for the child to
 * repeat («ردّد بعدي»), stars per completed surah, and a parent's settings dialog.
 *
 * The recitation is NOT played here: it goes to the worker as SYFS_CLIP with a plan
 * (reps / loops / gap / rate — «محرك الآيات», v0.180.0), which checks the URLs against
 * CLIP_HOSTS and hands them to the offscreen document. Progress comes back as
 * SYFS_CLIPSTATE broadcasts, which an extension page hears directly.
 *
 * ⛔ The Quran text comes from data/quran-kids.json (built by tools/kids-data-build.js
 * from the Wird's own source, hash pinned by tools/kids-data-test.js) and is only ever
 * written with textContent, inside translate="no".
 *
 * The first block is pure (no DOM) and is what tools/kids-test.js runs. */
(function () {
  'use strict';
  window.SYFS = window.SYFS || {};

  /* ===================== pure core ===================== */
  /* per-ayah recordings on the same host and path as the Wird (CLIP_HOSTS) — no new service */
  var AUDIO = 'https://cdn.islamic.network/quran/audio/128/';
  var RECITERS = { minshawi: { ed: 'ar.minshawi', name: 'المنشاوي' }, husary: { ed: 'ar.husary', name: 'الحصري' } };
  var GAPS = [1, 2, 0.5, 0], RATES = [1, 0.85, 0.75], LOOPS = [1, 2, 3], REPS = [1, 3, 5];
  /* the page's looks (v0.184.0), chosen by the parent — kids.css carries one block per style */
  var STYLES = ['garden', 'sky', 'crayon', 'sea', 'manuscript'];
  var DEFAULTS = { reciter: 'minshawi', gap: 1, rate: 1, loops: 1, rep: 1, lock: false, theme: 'light', style: 'garden' };

  function pick(list, v, d) { return list.indexOf(v) >= 0 ? v : d; }
  /* everything read back from storage is whitelisted, never trusted for having been
     written by this page */
  function cleanSettings(o) {
    o = (o && typeof o === 'object') ? o : {};
    return {
      reciter: Object.prototype.hasOwnProperty.call(RECITERS, o.reciter) ? o.reciter : DEFAULTS.reciter,
      gap: pick(GAPS, o.gap, DEFAULTS.gap),
      rate: pick(RATES, o.rate, DEFAULTS.rate),
      loops: pick(LOOPS, o.loops, DEFAULTS.loops),
      rep: pick(REPS, o.rep, DEFAULTS.rep),
      lock: o.lock === true,
      theme: o.theme === 'dark' ? 'dark' : 'light',
      style: pick(STYLES, o.style, DEFAULTS.style)
    };
  }
  /* { "<surah>": 0..3 } for the surahs in the data only */
  function cleanProgress(o, nums) {
    var out = {};
    if (!o || typeof o !== 'object') return out;
    (nums || []).forEach(function (n) {
      /* own keys only — an inherited value is not progress the child made */
      var v = Object.prototype.hasOwnProperty.call(o, n) ? o[n] : undefined;
      if (Number.isInteger(v) && v >= 1 && v <= 3) out[n] = v;
    });
    return out;
  }
  function cleanPin(o) {
    return (o && typeof o.salt === 'string' && /^[0-9a-f]{32}$/.test(o.salt) &&
      typeof o.hash === 'string' && /^[0-9a-f]{64}$/.test(o.hash)) ? { salt: o.salt, hash: o.hash } : null;
  }
  /* the queue for one surah from ayah `from`: the basmala first when starting at the top
     of any surah but al-Fatiha (where it IS ayah 1) and at-Tawba. The source's per-ayah
     files do not carry it, so it is its own item — al-Fatiha 1:1, global ayah 1. */
  function plan(surah, from, s) {
    var ed = (RECITERS[s.reciter] || RECITERS.minshawi).ed;
    var basm = from === 0 && surah.n !== 1 && surah.n !== 9;
    var urls = basm ? [AUDIO + ed + '/1.mp3'] : [];
    for (var i = from; i < surah.a.length; i++) urls.push(AUDIO + ed + '/' + (surah.g + i) + '.mp3');
    return { n: urls.length, from: from, basm: basm, urls: urls };
  }
  /* queue index → ayah index in the surah (-1 = the basmala) */
  function ayahAt(p, i) { return p.basm ? (i === 0 ? -1 : p.from + i - 1) : p.from + i; }
  /* a star is earned by hearing the WHOLE surah from its first ayah through to the end
     of the last repeat — not by skipping ahead to the last ayah */
  function finished(p, last, s) {
    return !!p && !!last && p.from === 0 && last.i === p.n - 1 && last.r === s.rep - 1 && last.l === s.loops - 1;
  }
  function award(prog, n) { return Math.min(3, (prog[n] || 0) + 1); }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  /* the PIN is a child gate, not a secret: four digits never resist a determined adult.
     It is still stored salted and hashed, and kept out of the settings export
     (`kids_pin` is in SYFS.prefs.SECRET_KEYS). */
  function hashPin(pin, salt) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin)).then(hex);
  }
  function newSalt() { var b = new Uint8Array(16); crypto.getRandomValues(b); return hex(b.buffer); }

  SYFS.kids = { AUDIO: AUDIO, RECITERS: RECITERS, STYLES: STYLES, DEFAULTS: DEFAULTS, cleanSettings: cleanSettings, cleanProgress: cleanProgress,
    cleanPin: cleanPin, plan: plan, ayahAt: ayahAt, finished: finished, award: award, hashPin: hashPin, newSalt: newSalt };

  /* ===================== page ===================== */
  var $ = function (id) { return document.getElementById(id); };
  if (!$('k-grid')) return;                       /* the core alone (tests) */

  /* i18n-via: T, tf — T IS SYFS.t (with a fallback before i18n.js answers); tf is T with
     {placeholders} filled AFTER the lookup, so the msgid stays one whole sentence */
  var T = function (s) { return SYFS.t ? SYFS.t(s) : s; };
  var store = SYFS.store;
  var D = null, S = cleanSettings(null), P = {}, PIN = null;
  var cur = null, cursor = 0, sess = null, last = null, paused = false, ringRaf = 0;

  function lang() { return (SYFS.i18n && SYFS.i18n.get()) || 'ar'; }
  function fmt(n) { try { return Number(n).toLocaleString(SYFS.i18n.locale()); } catch (e) { return String(n); } }
  function ar(n) { return Number(n).toLocaleString('ar-EG'); }      /* ayah markers: always the mushaf's digits */
  function tf(id, map) { var s = T(id); Object.keys(map).forEach(function (k) { s = s.split('{' + k + '}').join(map[k]); }); return s; }
  /* ⚠️ the attribute, not the property: `hidden` is an HTMLElement property, and on an
     <svg> (the play/pause icons, the ring) assigning it only sets a JS expando */
  function vis(e, on) { if (on) e.removeAttribute('hidden'); else e.setAttribute('hidden', ''); }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function surahName(sr) { return lang() === 'en' ? sr.en : sr.ar; }
  function ayahCount(k) { return tf(k <= 10 ? '{n} آيات' : '{n} آية', { n: fmt(k) }); }
  function total() { var t = 0; Object.keys(P).forEach(function (k) { t += P[k]; }); return t; }
  function save() { return store.set('kids_settings', S); }

  /* ---------- the grid, the map, the totals ---------- */
  function stars(k) {
    var w = el('div', 'st');
    w.setAttribute('aria-label', tf('{n} من 3 نجوم', { n: fmt(k) }));
    for (var i = 0; i < 3; i++) { if (i < k) w.appendChild(el('b', '', '★')); else w.appendChild(document.createTextNode('★')); }
    return w;
  }
  function paintTotals() { $('k-tot').textContent = fmt(total()); $('k-tot2').textContent = fmt(total()); }
  function paintGrid() {
    var g = $('k-grid'); g.textContent = '';
    D.s.forEach(function (sr) {
      var k = P[sr.n] || 0;
      var b = el('button', 'k-card' + (k === 3 ? ' done' : '')); b.type = 'button';
      var nm = el('div', 'nm', sr.ar); nm.setAttribute('translate', 'no'); nm.lang = 'ar';
      b.appendChild(nm);
      if (lang() === 'en') b.appendChild(el('div', 'tr', sr.en));
      b.appendChild(el('div', 'n', ayahCount(sr.a.length)));
      b.appendChild(stars(k));
      b.setAttribute('aria-label', surahName(sr) + ' — ' + ayahCount(sr.a.length));
      b.addEventListener('click', function () { openSurah(sr); });
      g.appendChild(b);
    });
  }
  function paintMap() {
    var m = $('k-map'); m.textContent = '';
    var nextMarked = false;
    D.s.forEach(function (sr) {
      var k = P[sr.n] || 0, c = el('div', 'k-node' + (k ? ' s' + k : ''), sr.ar);
      c.setAttribute('translate', 'no');
      c.setAttribute('aria-label', surahName(sr) + ' — ' + tf('{n} من 3 نجوم', { n: fmt(k) }));
      if (!k && !nextMarked) { c.className += ' next'; nextMarked = true; }
      m.appendChild(c);
    });
  }

  /* ---------- the reading screen ---------- */
  function openSurah(sr) {
    stopAll();
    cur = sr; cursor = 0;
    $('k-title').textContent = (lang() === 'en' ? sr.en + ' · ' : '') + sr.ar;
    var box = $('k-text'); box.textContent = '';
    if (sr.n !== 1 && sr.n !== 9) { var b = el('div', 'basmala', D.basmala); b.dataset.i = '-1'; box.appendChild(b); }
    sr.a.forEach(function (t, i) {
      var a = el('span', 'ayah', t); a.dataset.i = String(i);
      a.addEventListener('click', function () { cursor = i; start(i); });
      box.appendChild(a);
      box.appendChild(el('span', 'num', '﴿' + ar(i + 1) + '﴾'));
      box.appendChild(document.createTextNode(' '));
    });
    paintWho(); paintReps(); light(-2); setPhase('idle');
    show('read');
  }
  function paintWho() { $('k-who').textContent = tf('الشيخ: {name}', { name: T(RECITERS[S.reciter].name) }); }
  function paintReps() {
    document.querySelectorAll('[data-rep]').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.dataset.rep === S.rep)); });
  }
  /* `on` = the ayah being recited (-1 basmala, -2 none); the cursor is marked when idle */
  function light(on) {
    var box = $('k-text');
    Array.prototype.forEach.call(box.querySelectorAll('[data-i]'), function (e) {
      var i = +e.dataset.i;
      e.classList.toggle('on', i === on);
      e.classList.toggle('cur', on === -2 && i === cursor);
    });
    var hit = box.querySelector('.on');
    if (hit && hit.scrollIntoView) hit.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function ring(ms) {
    cancelAnimationFrame(ringRaf);
    var fg = $('k-ring-fg'), t0 = performance.now();
    (function tick(now) {
      var f = Math.min(1, ((now || t0) - t0) / Math.max(1, ms));
      fg.style.strokeDashoffset = String(138.2 * f);
      if (f < 1) ringRaf = requestAnimationFrame(tick);
    }(t0));
  }
  function setPhase(ph, extra) {
    var pill = $('k-pill'), txt = {
      idle: 'اضغط ▶ لنبدأ', listen: '🎧 استمع…', turn: 'دورك! ردّد', paused: 'متوقّف مؤقتاً',
      err: 'تعذّر تشغيل التلاوة — تحقّق من الاتصال بالإنترنت.'
    }[ph];
    pill.className = 'k-pill ' + (ph === 'paused' ? 'idle' : ph);
    pill.textContent = T(txt);
    vis($('k-ring'), ph === 'turn');
    if (ph === 'turn') ring(extra || 0); else cancelAnimationFrame(ringRaf);
    var playing = ph === 'listen' || ph === 'turn';
    vis($('k-ico-play'), !playing); vis($('k-ico-pause'), playing);
    var lbl = T(playing ? 'إيقاف مؤقت' : 'تشغيل');
    $('k-play').setAttribute('aria-label', lbl); $('k-play').title = lbl;
    if (ph === 'idle' || ph === 'err') $('k-rep-at').hidden = true;
  }

  /* ---------- talking to the worker ---------- */
  function send(msg) {
    return new Promise(function (res) {
      try { chrome.runtime.sendMessage(msg, function (r) { void chrome.runtime.lastError; res(r || null); }); }
      catch (e) { res(null); }
    });
  }
  function start(from) {
    if (!cur) return;
    from = Math.max(0, Math.min(cur.a.length - 1, from | 0));
    cursor = from;
    var p = plan(cur, from, S);
    sess = p; last = null; paused = false;
    setPhase('listen'); light(ayahAt(p, 0));
    send({ type: 'SYFS_CLIP', op: 'play', urls: p.urls, reps: S.rep, loops: S.loops, gap: S.gap, rate: S.rate }).then(function (r) {
      if (sess !== p) return;
      if (!r || !r.ok) { sess = null; setPhase('err'); light(-2); }
    });
  }
  function endSession() { sess = null; last = null; paused = false; setPhase('idle'); light(-2); }
  function stopAll() { if (sess) send({ type: 'SYFS_CLIP', op: 'stop' }); endSession(); }

  /* the offscreen page broadcasts its clip state; only a queue of OUR length is ours —
     another surface (the Wird) starting its own queue ends this session quietly */
  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== 'SYFS_CLIPSTATE' || !sess) return;
    var i = msg.i | 0, n = msg.n | 0;
    if (msg.evt === 'clip' || msg.evt === 'gap' || msg.evt === 'clippause') {
      if (n !== sess.n) { endSession(); return; }
      last = { i: i, r: msg.r | 0, l: msg.l | 0 };
      var a = ayahAt(sess, i);
      if (a >= 0) cursor = a;
      light(a);
      if (S.rep > 1) { var at = $('k-rep-at'); at.hidden = false; at.textContent = tf('المرة {a} من {b}', { a: fmt(last.r + 1), b: fmt(S.rep) }); }
      if (msg.evt === 'clippause') { paused = true; setPhase('paused'); return; }
      paused = false;
      setPhase(msg.evt === 'gap' ? 'turn' : 'listen', Math.max(0, +msg.ms || 0));
      return;
    }
    if (msg.evt === 'clipend') {
      var done = finished(sess, last, S), sr = cur;
      endSession();
      if (done && sr) win(sr);
    }
  });

  function win(sr) {
    P[sr.n] = award(P, sr.n);
    store.set('kids_progress', P);
    paintTotals(); paintGrid(); paintMap();
    $('k-win-stars').textContent = '★★★'.slice(0, P[sr.n]) + '☆☆☆'.slice(0, 3 - P[sr.n]);
    $('k-win-p').textContent = tf('أكملت سورة {s}.', { s: surahName(sr) });
    openDlg('k-win', $('k-again'));
  }

  /* ---------- controls ---------- */
  $('k-play').addEventListener('click', function () {
    if (!sess) { start(cursor); return; }
    if (paused) { send({ type: 'SYFS_CLIP', op: 'resume' }); return; }
    send({ type: 'SYFS_CLIP', op: 'pause' });
  });
  $('k-stop').addEventListener('click', stopAll);
  function step(d) {
    if (!cur) return;
    var k = Math.max(0, Math.min(cur.a.length - 1, cursor + d));
    if (k === cursor && sess) return;
    cursor = k;
    if (sess) start(k); else light(-2);
  }
  $('k-next').addEventListener('click', function () { step(1); });
  $('k-prev').addEventListener('click', function () { step(-1); });
  document.querySelectorAll('[data-rep]').forEach(function (b) {
    b.addEventListener('click', function () {
      S.rep = cleanSettings({ rep: +b.dataset.rep }).rep; save(); paintReps();
      if (sess) start(cursor);                 /* a new count applies from the ayah being heard */
    });
  });
  $('k-back').addEventListener('click', function () { show('home'); });
  $('k-again').addEventListener('click', function () { closeDlg($('k-win')); if (cur) { cursor = 0; start(0); } });

  /* ---------- views ---------- */
  function show(v) {
    ['home', 'read', 'map'].forEach(function (x) { $('v-' + x).hidden = x !== v; });
    document.querySelectorAll('[data-v]').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.v === v || (v === 'read' && b.dataset.v === 'home')));
    });
    if (v !== 'read') stopAll();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[data-v]').forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.v); }); });

  /* ---------- dialogs ---------- */
  var lastFocus = null;
  function openDlg(id, focus) {
    lastFocus = document.activeElement;
    var d = $(id); d.hidden = false;
    (focus || d.querySelector('input, select, button')).focus();
  }
  function closeDlg(d) { d.hidden = true; paintTheme(); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { closeDlg(b.closest('.dlg')); }); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.dlg').forEach(function (d) { if (!d.hidden) closeDlg(d); });
  });

  /* ---------- the parent: PIN gate, then settings ---------- */
  var forgotQ = null;
  function openParent() {
    if (S.lock && PIN) {
      $('k-pin-in').value = ''; $('k-pin-err').hidden = true; $('k-forgot-box').hidden = true; forgotQ = null;
      openDlg('k-pin', $('k-pin-in'));
    } else openSettings();
  }
  $('k-parent-btn').addEventListener('click', openParent);
  $('k-parent-btn2').addEventListener('click', openParent);
  $('k-forgot').addEventListener('click', function () {
    /* an adult's question instead of the lost PIN — the answer clears the old PIN */
    var b = new Uint8Array(2); crypto.getRandomValues(b);
    forgotQ = { a: 6 + (b[0] % 4), b: 6 + (b[1] % 4) };
    $('k-forgot-q').textContent = tf('كم يساوي {a} × {b}؟', { a: fmt(forgotQ.a), b: fmt(forgotQ.b) });
    $('k-forgot-in').value = ''; $('k-forgot-box').hidden = false; $('k-forgot-in').focus();
  });
  $('k-pin-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (forgotQ && $('k-forgot-in').value !== '') {
      if (+$('k-forgot-in').value === forgotQ.a * forgotQ.b) {
        PIN = null; S.lock = false;
        Promise.all([store.set('kids_pin', null), save()]).then(function () { closeDlg($('k-pin')); openSettings(); });
      } else $('k-pin-err').hidden = false;
      return;
    }
    var pin = $('k-pin-in').value;
    if (!/^\d{4}$/.test(pin) || !PIN) { $('k-pin-err').hidden = false; return; }
    hashPin(pin, PIN.salt).then(function (h) {
      if (h === PIN.hash) { closeDlg($('k-pin')); openSettings(); } else $('k-pin-err').hidden = false;
    });
  });

  var resetArmed = false;
  function openSettings() {
    $('k-s-reciter').value = S.reciter; $('k-s-gap').value = String(S.gap);
    $('k-s-rate').value = String(S.rate); $('k-s-loops').value = String(S.loops);
    document.querySelectorAll('input[name="k-s-style"]').forEach(function (r) { r.checked = r.value === S.style; });
    $('k-s-lock').checked = S.lock; $('k-s-pin').value = ''; $('k-s-err').hidden = true;
    $('k-s-pin').placeholder = PIN ? T('اتركه فارغاً لإبقاء الرمز الحالي') : '••••';
    resetArmed = false; $('k-s-reset').textContent = T('مسح النجوم والبدء من جديد');
    openDlg('k-parent', $('k-s-reciter'));
  }
  $('k-s-reset').addEventListener('click', function () {
    /* two presses, no browser dialog — a modal would freeze the recitation page */
    if (!resetArmed) { resetArmed = true; this.textContent = T('اضغط مرة أخرى للتأكيد'); return; }
    P = {}; store.set('kids_progress', P); paintTotals(); paintGrid(); paintMap();
    resetArmed = false; this.textContent = T('تم المسح ✓');
  });
  /* picking a style previews it at once; «إلغاء» / Esc put the saved one back (closeDlg) */
  document.querySelectorAll('input[name="k-s-style"]').forEach(function (r) {
    r.addEventListener('change', function () { if (r.checked) document.documentElement.setAttribute('data-style', cleanSettings({ style: r.value }).style); });
  });
  function pickedStyle() { var r = document.querySelector('input[name="k-s-style"]:checked'); return r ? r.value : S.style; }
  $('k-parent-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var next = cleanSettings({
      reciter: $('k-s-reciter').value, gap: +$('k-s-gap').value, rate: +$('k-s-rate').value,
      loops: +$('k-s-loops').value, rep: S.rep, lock: $('k-s-lock').checked, theme: S.theme, style: pickedStyle()
    });
    var pin = $('k-s-pin').value, job = Promise.resolve();
    if (next.lock) {
      if (pin !== '' && !/^\d{4}$/.test(pin)) { $('k-s-err').hidden = false; return; }
      if (pin === '' && !PIN) { $('k-s-err').hidden = false; return; }
      if (pin !== '') {
        var salt = newSalt();
        job = hashPin(pin, salt).then(function (h) { PIN = { salt: salt, hash: h }; return store.set('kids_pin', PIN); });
      }
    } else if (PIN) { PIN = null; job = store.set('kids_pin', null); }
    var changed = next.reciter !== S.reciter || next.gap !== S.gap || next.rate !== S.rate || next.loops !== S.loops;
    S = next;
    job.then(save).then(function () {
      closeDlg($('k-parent'));
      paintWho();
      if (changed && sess) start(cursor);
    });
  });

  /* «قفل»: a page cannot stop a tab from closing; what it CAN do is ask first */
  window.addEventListener('beforeunload', function (e) { if (S.lock) { e.preventDefault(); e.returnValue = ''; } });
  /* closing the page stops its recitation — a child who closed the tab expects silence */
  window.addEventListener('pagehide', function () { if (sess) send({ type: 'SYFS_CLIP', op: 'stop' }); });

  /* ---------- theme ---------- */
  function paintTheme() {
    document.documentElement.setAttribute('data-theme', S.theme);
    document.documentElement.setAttribute('data-style', S.style);
    $('k-theme').setAttribute('aria-pressed', String(S.theme === 'dark'));
  }
  /* inside the rail's window (?host=win): offer the full tab, same page, same storage */
  if (/[?&]host=win(&|$)/.test(location.search)) {
    document.documentElement.classList.add('in-win');
    $('k-tab').hidden = false;
    $('k-tab').addEventListener('click', function () { try { chrome.runtime.sendMessage({ type: 'SYFS_OPEN_KIDS' }, function () { void chrome.runtime.lastError; }); } catch (e) {} });
  }
  $('k-theme').addEventListener('click', function () { S.theme = S.theme === 'dark' ? 'light' : 'dark'; paintTheme(); save(); });

  /* ---------- start ---------- */
  function load() {
    var data = fetch(chrome.runtime.getURL('data/quran-kids.json')).then(function (r) { return r.json(); });
    return Promise.all([data, store.get('kids_settings', null), store.get('kids_progress', null), store.get('kids_pin', null), store.get('ui_lang', 'ar')])
      .then(function (v) {
        D = v[0];
        if (!D || !Array.isArray(D.s) || typeof D.basmala !== 'string') throw new Error('bad data');
        S = cleanSettings(v[1]);
        P = cleanProgress(v[2], D.s.map(function (x) { return x.n; }));
        PIN = cleanPin(v[3]);
        if (S.lock && !PIN) S.lock = false;       /* a lock without a PIN would be a door with no key */
        return SYFS.i18n ? SYFS.i18n.apply(v[4]) : null;
      });
  }
  paintTheme();
  load().then(function () {
    paintTheme(); paintTotals(); paintGrid(); paintMap();
    if (SYFS.i18n) SYFS.i18n.onChange(function () { paintGrid(); paintMap(); paintTotals(); if (cur) { paintWho(); } });
  }).catch(function () {
    var g = $('k-grid'); g.textContent = '';
    g.appendChild(el('p', 'k-err', T('تعذّر تحميل السور — أعد فتح الصفحة.')));
  });
}());
