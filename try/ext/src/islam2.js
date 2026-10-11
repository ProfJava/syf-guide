/* SYF — الحزمة الإسلامية v2: تنبيهات (أذكار دورية + قبل الأذان +
 * صباح/مساء)، آية اليوم (أوفلاين)، أذكار الصباح والمساء كأهداف يومية متسلسلة (v0.122.0)،
 * أذكار المستخدم، الورد اليومي. The adhkar lists come from src/azkar-data.js (shared
 * with the worker); the goal state (`azkar_goal`) is owned by the worker.
 * Scheduling lives in the worker (chrome.alarms + notifications — settings in
 * the `ithkar` storage key, applied via SYFS_ITHKAR). This file holds the
 * SYFS.ithkar API (norm + save, shared by the prayer and athkar tools — the standalone
 * settings tool was removed in v0.178.x), the content tools, and the on-page toast.
 * Mostly offline; the الورد اليومي (daily wird) tool reads Quran mushaf pages from
 * api.alquran.cloud via the worker relay and caches each page locally (qp_<n>) so
 * a page loads offline after its first fetch. Loaded BEFORE src/rail.js. */
(function () {
  window.SYFS = window.SYFS || {};
  var store = SYFS.store, bgFetch = SYFS.bgFetch;

  /* ===== كاش الورد: سقفٌ لا يُتجاوَز (v0.139.3) =====
   * كل صفحة تُقرأ تُحفظ (نصّها qp_ وتفسيرها qt_ وقائمة تلاوتها qa_) ولا شيء كان يحذف
   * منها: قارئ ختمة كاملة بالتفسير يقترب من سقف storage.local (١٠ ميغابايت)، وعندها
   * تفشل **كل** كتابة أخرى في الإضافة بصمت — الإعدادات والملاحظات قبل الورد. فالكاش
   * الآن فهرسٌ (مفتاح ← [آخر استعمال، حجم]) يُطرد منه الأقدم استعمالاً حتى يعود
   * المجموع تحت WIRD_CACHE_CAP. الصفحة المطرودة تُجلب من جديد عند الحاجة، لا أكثر. */
  var WIRD_CACHE_CAP = 3 * 1024 * 1024;
  var WIRD_IDX = 'qcache_idx';
  var WIRD_KEY_RE = /^q[pta]_\d+$/;
  /* pure — which keys go, oldest use first, until the total fits the cap */
  function wirdEvict(idx, cap) {
    var keys = Object.keys(idx), total = 0;
    keys.forEach(function (k) { total += (idx[k] && idx[k][1]) || 0; });
    if (total <= cap) return [];
    keys.sort(function (a, b) { return ((idx[a] && idx[a][0]) || 0) - ((idx[b] && idx[b][0]) || 0); });
    var drop = [];
    for (var i = 0; i < keys.length && total > cap; i++) { total -= (idx[keys[i]] && idx[keys[i]][1]) || 0; drop.push(keys[i]); }
    return drop;
  }
  function wirdBytes(key, val) {
    try { return new TextEncoder().encode(key + JSON.stringify(val)).length; } catch (e) { return 0; }
  }
  /* one read-modify-write of the index at a time (per tab). The first run with no
     index adopts the pages cached before it existed, as the oldest. */
  var wirdTail = Promise.resolve();
  function wirdIdx(fn) {
    var run = wirdTail.then(function () {
      return new Promise(function (res) {
        chrome.storage.local.get([WIRD_IDX], function (r) {
          var idx = r && r[WIRD_IDX];
          if (idx && typeof idx === 'object' && !Array.isArray(idx)) { res(idx); return; }
          /* the key space is known (3 × QURAN_PAGES) — asked for by name, not by dumping the store */
          var names = [];
          for (var p = 1; p <= QURAN_PAGES; p++) names.push('qp_' + p, 'qt_' + p, 'qa_' + p);
          chrome.storage.local.get(names, function (all) {
            var built = {};
            Object.keys(all || {}).forEach(function (k) { if (WIRD_KEY_RE.test(k)) built[k] = [0, wirdBytes(k, all[k])]; });
            res(built);
          });
        });
      }).then(function (idx) {
        var drop = fn(idx) || [];
        return new Promise(function (res) {
          var o = {}; o[WIRD_IDX] = idx;
          chrome.storage.local.set(o, function () {
            if (drop.length) chrome.storage.local.remove(drop, function () { res(); }); else res();
          });
        });
      });
    });
    wirdTail = run.catch(function () {});
    return run;
  }
  /* A READ only refreshes recency, and recency only orders eviction — so one touch per
     key per WIRD_TOUCH_MS is plenty, and every touch waiting at that moment rides ONE
     index write. Until v0.176.x each cache hit rewrote the whole index (up to ~1800
     entries) — two or three times per page flip — and every write woke
     storage.onChanged in every open tab. */
  var WIRD_TOUCH_MS = 10 * 60 * 1000;
  var wirdTouched = {}, wirdPending = null;
  function wirdGet(key) {
    return store.get(key, null).then(function (v) {
      var now = Date.now();
      if (v && !(now - (wirdTouched[key] || 0) < WIRD_TOUCH_MS)) {
        wirdTouched[key] = now;
        var first = !wirdPending;
        wirdPending = wirdPending || {};
        wirdPending[key] = v;
        if (first) {
          wirdIdx(function (idx) {
            var p = wirdPending || {}; wirdPending = null;
            Object.keys(p).forEach(function (k) { if (idx[k]) idx[k][0] = Date.now(); else idx[k] = [Date.now(), wirdBytes(k, p[k])]; });
          }).catch(function () {});
        }
      }
      return v;
    });
  }
  function wirdSet(key, val) {
    return store.set(key, val).then(function () {
      return wirdIdx(function (idx) {
        idx[key] = [Date.now(), wirdBytes(key, val)];
        var drop = wirdEvict(idx, WIRD_CACHE_CAP).filter(function (k) { return k !== key; });
        drop.forEach(function (k) { delete idx[k]; });
        return drop;
      });
    }).catch(function () {});
  }

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

  /* ---------- on-page toast (fired by the worker via SYFS_TOAST) ---------- */
  /* The on-page toast — shared, exposed as SYFS.toast. It lives here for historical
   * reasons (the adhkar reminders were its first caller); other content scripts in
   * the same isolated world raise one by calling SYFS.toast directly — no round trip
   * through the worker (src/yt-guard.js does exactly that on a demotion).
   *   opts.actions — [{ label, onClick, primary }] → a button row.
   *   opts.timeout — ms until auto-close; 0 keeps it up until the user acts. Use 0
   *                  whenever the toast asks a question: closing it under the user
   *                  mid-decision loses the only offer they were given.
   * Returns close(), or null if the rail has not mounted yet (the caller must cope —
   * a toast is never the only record of what happened). */
  function showToast(title, text, opts) {
    if (!SYFS.mountEl) return null;
    opts = opts || {};
    /* role=status: a screen reader announces the reminder instead of leaving it as a
       silent box at the edge of the page */
    var el = h(
      '<div class="syfs-toast" role="status" aria-live="polite">' +
        '<div class="syfs-toast-body"><b></b><span></span><div class="syfs-toast-acts" hidden></div></div>' +
        '<button class="syfs-toast-x" type="button" title="إغلاق" aria-label="إغلاق">✕</button>' +
      '</div>'
    );
    el.querySelector('b').textContent = title || '';
    el.querySelector('span').textContent = text || '';

    var closed = false;
    function close() { if (closed) return; closed = true; el.classList.add('out'); setTimeout(function () { el.remove(); }, 250); }
    el.querySelector('.syfs-toast-x').addEventListener('click', close);

    var acts = Array.isArray(opts.actions) ? opts.actions : [];
    if (acts.length) {
      var row = el.querySelector('.syfs-toast-acts');
      row.hidden = false;
      acts.forEach(function (a) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'syfs-toast-act' + (a.primary ? ' pri' : '');
        b.textContent = a.label ? SYFS.t(a.label) : '';   /* textContent — no injection */
        b.addEventListener('click', function () {
          close();
          if (typeof a.onClick === 'function') { try { a.onClick(); } catch (e) {} }
        });
        row.appendChild(b);
      });
    }

    SYFS.mountEl(el);
    if (SYFS.topZ) el.style.zIndex = SYFS.topZ();
    var ms = (opts.timeout === undefined) ? 10000 : opts.timeout;
    if (ms > 0) setTimeout(close, ms);
    return close;
  }
  SYFS.toast = showToast;
  /* v0.164.2 — the adhan toast stays up with «⏹ إيقاف الأذان» until the adhan ends
     (the worker sends SYFS_TOAST_CLOSE) or the user acts. One per tab. */
  var adhanClose = null;
  function closeAdhan() { if (adhanClose) { adhanClose(); adhanClose = null; } }
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (!msg) return;
      if (msg.type === 'SYFS_TOAST_CLOSE' && msg.tag === 'adhan') { closeAdhan(); return; }
      if (msg.type !== 'SYFS_TOAST') return;
      if (msg.stop !== 'adhan') { showToast(msg.title, msg.text); return; }
      closeAdhan();
      adhanClose = showToast(msg.title, msg.text, {
        timeout: 0,
        actions: [{ label: 'إيقاف الأذان', primary: true, onClick: function () {
          adhanClose = null;
          send('SYFS_ITHKAR', { op: 'sound', kind: 'stop' });
        } }]
      });
    });
  } catch (e) {}

  /* ---------- data (fixed internal texts) ----------
   * i18n-skip-start: Qur'anic verses, their citations, and the adhkar. This is
   * the CONTENT the tool exists to show, not the interface around it — the spec
   * puts source texts out of scope, and rendering a Qur'anic verse as an English
   * paraphrase would be presenting an interpretation as the text itself. They
   * stay Arabic in every language, which is also how they are read. */
  var AYAT = [
    ['فاذكروني أذكركم واشكروا لي ولا تكفرون', 'البقرة 152'],
    ['وقل رب زدني علما', 'طه 114'],
    ['ألا بذكر الله تطمئن القلوب', 'الرعد 28'],
    ['فإن مع العسر يسرا · إن مع العسر يسرا', 'الشرح 5-6'],
    ['وما توفيقي إلا بالله عليه توكلت وإليه أنيب', 'هود 88'],
    ['ربنا آتنا في الدنيا حسنة وفي الآخرة حسنة وقنا عذاب النار', 'البقرة 201'],
    ['واصبر وما صبرك إلا بالله', 'النحل 127'],
    ['وإذا سألك عبادي عني فإني قريب', 'البقرة 186'],
    ['قل يا عبادي الذين أسرفوا على أنفسهم لا تقنطوا من رحمة الله', 'الزمر 53'],
    ['حسبنا الله ونعم الوكيل', 'آل عمران 173'],
    ['واستعينوا بالصبر والصلاة', 'البقرة 45'],
    ['إن الله مع الصابرين', 'البقرة 153'],
    ['ومن يتق الله يجعل له مخرجا', 'الطلاق 2'],
    ['ومن يتوكل على الله فهو حسبه', 'الطلاق 3'],
    ['وبشر الصابرين', 'البقرة 155'],
    ['ولذكر الله أكبر', 'العنكبوت 45'],
    ['رب اشرح لي صدري ويسر لي أمري', 'طه 25-26'],
    ['إنما أمره إذا أراد شيئا أن يقول له كن فيكون', 'يس 82'],
    ['وقل اعملوا فسيرى الله عملكم ورسوله والمؤمنون', 'التوبة 105'],
    ['إن الله لا يضيع أجر المحسنين', 'التوبة 120']
  ];

  /* i18n-skip-end */

  /* the adhkar: built-in lists from src/azkar-data.js + the user's own (`azkar_custom`) */
  var AZ = window.SYFS_AZKAR;
  var AZKAR = AZ.GEN;
  function azLists() { return store.get('azkar_custom', null).then(function (c) { return AZ.lists(c); }); }

  SYFS.tools = SYFS.tools || [];

  /* ===================== 1) تنبيهات الأذكار والصلاة (إعدادات) ===================== */
  /* mirror of the worker's IK_DEFAULTS / ikNorm — the panel must never show a value
     the worker would reject (§6.95/5), and `ithkar` is written from TWO panels (the
     prayer tool's «⚙️ الإعدادات» tab and the athkar tool's «الإعدادات» tab since v0.178.x),
     each merging over the same shape. Every alert switch is ON for a key never saved (user's decision) —
     except goalTts: a voice starting on its own is the one default nobody should meet
     unasked. A saved value always wins (ikNorm merges the stored object over these). */
  var ITHKAR_DEFAULTS = {
    azkarOn: true, azkarSec: 1800, azkarToast: true, azkarNotif: true,
    prayerOn: true, prayerBefore: 10, prayerWhich: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true },
    prayerBeep: true, adhanSound: true,
    duhaOn: true, duhaAfter: 20,
    qiyamOn: true, qiyamAt: 'third',
    wuduOn: true, wuduBefore: { fajr: 20, dhuhr: 20, asr: 20, maghrib: 20, isha: 20 }, wuduBeep: true,
    sabahOn: true, sabahMode: 'fajr', sabahAt: '07:00',
    masaaOn: true, masaaMode: 'asr', masaaAt: '17:00',
    goalEvery: 5, goalTts: false
  };
  var PRAYERS = [['fajr', 'الفجر'], ['dhuhr', 'الظهر'], ['asr', 'العصر'], ['maghrib', 'المغرب'], ['isha', 'العشاء']];
  function ikNorm(raw) {
    var r = (raw && typeof raw === 'object') ? raw : {};
    var s = Object.assign({}, ITHKAR_DEFAULTS, r);
    function int(v, lo, hi, d) { v = parseInt(v, 10); return (v >= lo && v <= hi) ? v : d; }
    /* seconds, 30 … 4h — same rule as the worker's ikNorm (azkarEvery = old minutes) */
    s.azkarSec = int(r.azkarSec, 30, 14400, 0) || int(r.azkarEvery, 1, 240, 30) * 60;
    delete s.azkarEvery;
    s.prayerBefore = int(s.prayerBefore, 1, 120, 10);
    s.duhaAfter = int(s.duhaAfter, 15, 180, 20);
    if (['third', 'half', 'isha'].indexOf(s.qiyamAt) < 0) s.qiyamAt = 'third';
    var w = (r.prayerWhich && typeof r.prayerWhich === 'object') ? r.prayerWhich : {};
    s.prayerWhich = {};
    PRAYERS.forEach(function (p) { s.prayerWhich[p[0]] = (w[p[0]] === undefined) ? true : !!w[p[0]]; });
    var wb = r.wuduBefore;
    s.wuduBefore = {};
    PRAYERS.forEach(function (p) { s.wuduBefore[p[0]] = int((wb && typeof wb === 'object') ? wb[p[0]] : wb, 1, 120, 20); });
    s.sabahMode = s.sabahMode === 'clock' ? 'clock' : 'fajr';
    s.masaaMode = s.masaaMode === 'clock' ? 'clock' : 'asr';
    s.sabahAt = /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.sabahAt) ? s.sabahAt : '07:00';
    s.masaaAt = /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.masaaAt) ? s.masaaAt : '17:00';
    s.goalEvery = [0, 1, 3, 5, 10, 15, 30, 60].indexOf(+s.goalEvery) >= 0 ? +s.goalEvery : 5;
    ['azkarOn', 'azkarToast', 'azkarNotif', 'prayerOn', 'prayerBeep', 'adhanSound', 'duhaOn', 'qiyamOn', 'wuduOn', 'wuduBeep', 'sabahOn', 'masaaOn', 'goalTts'].forEach(function (k) { s[k] = !!s[k]; });
    return s;
  }
  /* shared with the prayer-times tool (src/tools2-body.js — lazy, so it always mounts after this file) */
  /* same rule as the worker's ikWuduFor: the adhan's prayers, or all five while the adhan alert is off */
  function wuduFor(s, k) { return s.prayerOn ? !!s.prayerWhich[k] : true; }
  SYFS.ithkar = { norm: ikNorm, PRAYERS: PRAYERS, wuduFor: wuduFor,
    /* read → merge → write → arm. One path for both panels, so neither can save a
       shape the worker does not read. */
    save: function (patch) {
      return store.get('ithkar', null).then(function (cur) {
        var s = ikNorm(Object.assign({}, ikNorm(cur), patch));
        return store.set('ithkar', s).then(function () { return send('SYFS_ITHKAR', { op: 'apply' }); });
      });
    }
  };

  /* ===== الصوت (v0.122.0 نطق آلي · v0.127.0 صوت الشيخ) =====
   * A built-in dhikr is RECITED — one mp3 per dhikr from hisnmuslim.com, the official
   * site of حصن المسلم, in the voice of حامد بن محمد الدريهم. The file is played by the
   * offscreen document (worker-side, §5.30), never by an <audio> in the host page: a
   * strict site's media-src would block it, and the sound would stop at every
   * navigation. Web Speech stays as the FALLBACK for adhkar that have no recording —
   * the user's own — because it is local: no host, no request, nothing leaves the
   * machine. Quality is whatever Arabic voice the OS ships, which is exactly why the
   * recordings were worth a host. */
  var azVoice = null;
  function azPickVoice() {
    try {
      var vs = window.speechSynthesis.getVoices();
      azVoice = vs.filter(function (v) { return /^ar/i.test(v.lang); })[0] || null;
    } catch (e) {}
  }
  function speak(text) {
    try {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return false;
      if (!azVoice) azPickVoice();
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(String(text || ''));
      u.lang = 'ar-SA'; if (azVoice) u.voice = azVoice; u.rate = 0.9;
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }
  try { if (window.speechSynthesis) window.speechSynthesis.addEventListener('voiceschanged', azPickVoice); } catch (e) {}
  SYFS.azSpeak = speak;
  /* the one call every 🔊 makes: the recording when this dhikr has one, the device
     voice when it does not. `i` indexes the SAME list the worker walks, so a custom
     dhikr (past the built-in ones) simply has no url and is spoken. */
  function azPlay(kind, i, text) {
    var url = AZ.audioUrl(kind, i);
    if (!url) return speak(text);
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    send('SYFS_CLIP', { op: 'play', url: url });
    return true;
  }
  SYFS.azPlay = azPlay;

  /* ===== the goal toast (v0.122.0) =====
   * The worker pushes the CURRENT dhikr here (SYFS_AZKAR_ASK); the ✓ replies with a
   * `check` op and the worker pushes the next one. `ok:false` when the rail is not
   * mounted → the worker falls back to a notification with the same button.
   * Text and count arrive from the worker, which read them from storage — the user's
   * own adhkar are in there, so textContent only (the toast already does that). */
  function goalTitle(kind, i, total) {
    return (kind === 's' ? '🌅 ' + SYFS.t('أذكار الصباح') : '🌙 ' + SYFS.t('أذكار المساء')) + ' ' + i + '/' + total;
  }
  /* ONE goal toast per kind. The reminder re-pushes the SAME dhikr every `goalEvery`
     minutes, and each push used to stack another toast: away five minutes at «كل
     دقيقة» = five copies, and ✓ on each to clear them advanced the goal five adhkar,
     four of them unread. A push now replaces the previous toast of its kind (as the
     adhan toast does), and ✓ names the dhikr it answers (`i`) so the worker can refuse
     a stale answer from another tab or window. */
  var goalClose = { s: null, m: null };
  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || msg.type !== 'SYFS_AZKAR_ASK') return;
      var kind = msg.kind === 'm' ? 'm' : 's', i = msg.i | 0;
      var text = String(msg.text || '').slice(0, AZ.MAX_LEN), n = msg.n | 0;
      if (goalClose[kind]) { goalClose[kind](); goalClose[kind] = null; }
      var shown = showToast(goalTitle(kind, i + 1, msg.total | 0), text + (n > 1 ? ' ×' + n : ''), {
        timeout: 0,
        actions: [
          { label: '✓ قرأته', primary: true, onClick: function () { send('SYFS_AZKAR', { op: 'check', kind: kind, i: i }); } },
          { label: '🔊', onClick: function () { azPlay(kind, i, text); } },
          { label: 'لاحقاً' }
        ]
      });
      goalClose[kind] = shown;
      if (shown && msg.tts) speak(text);
      sendResponse({ ok: !!shown });
    });
  } catch (e) {}

  /* the clock reading of a window edge — the locale decides ص/م, the digits stay
     Latin next to Latin ones (same rule as the world clock) */
  function clockStr(ms) {
    try { return new Intl.DateTimeFormat(SYFS.i18n.locale() + '-u-nu-latn', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms)); } catch (e) { return ''; }
  }

  /* الورد اليومي — قراءة صفحة من المصحف (نص عثماني) مع تتبّع الختمة وسلسلة الأيام.
   * الصفحات تُجلب من api.alquran.cloud عبر الـrelay وتُخزَّن محلياً (qp_<n>) للقراءة دون اتصال بعد أول تحميل. */
  var QURAN_PAGES = 604;

  /* «مصحف الأطفال» (v0.181.0) and «التحفيظ» (v0.182.0) open in the rail's own window
     (v0.183.0): the extension page is framed (?host=win), the way «الاستوديو» frames
     studio.html. The frame is the extension's origin, so the site sees none of it — no
     text, no storage, no audio; the page's ↗ button still asks the worker for a full tab. */
  function framePage(body, page, title) {
    var win = body.closest ? body.closest('.syfs-win') : null;
    /* a roomy first size; a size the user saved later still wins (rail.js reads win_<id>) */
    if (win) win.style.width = Math.max(320, Math.min(980, window.innerWidth - 24)) + 'px';
    body.classList.add('syfs-page-host');
    var frame = document.createElement('iframe');
    frame.className = 'syfs-page-frame';
    frame.title = SYFS.t(title);
    frame.src = chrome.runtime.getURL(page) + '?host=win';
    body.appendChild(frame);
  }

  SYFS.tools = SYFS.tools || [];
  SYFS.tools.push({
    id: 'kids', name: 'مصحف الأطفال', cat: 'islam',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.5z"/><path d="M12 7v13"/><path d="M17 2.5l.7 1.5 1.6.2-1.2 1.1.3 1.6-1.4-.8-1.4.8.3-1.6-1.2-1.1 1.6-.2z"/></svg>',
    mount: function (body) { framePage(body, 'kids.html', 'مصحف الأطفال'); }
  });

  /* «التحفيظ» (v0.182.0) — framed like «مصحف الأطفال» above */
  SYFS.tools.push({
    id: 'hifz', name: 'التحفيظ', cat: 'islam',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.5z"/><path d="M12 7v13"/><path d="M15.5 12.5l1.5 1.5 3-3"/></svg>',
    mount: function (body) { framePage(body, 'hifz.html', 'التحفيظ'); }
  });

  /* the helpers src/islam2-body.js (the lazy tool bodies, v0.139.5) reads back — see its header */
  SYFS._islam = { store: store, bgFetch: bgFetch, wirdGet: wirdGet, wirdSet: wirdSet, h: h, send: send, showToast: showToast, AYAT: AYAT, AZ: AZ, AZKAR: AZKAR, azLists: azLists, PRAYERS: PRAYERS, ikNorm: ikNorm, azPlay: azPlay, clockStr: clockStr, QURAN_PAGES: QURAN_PAGES };
}());
