/* SYF — the offscreen audio host (مشغّل القرآن).
 * A dumb transport: it owns ONE <audio> element and does exactly what the worker
 * tells it. Every decision — which surah, what comes next, whether to repeat —
 * lives in background.js, because this document can be torn down by the browser
 * at any time and must never be the only place a piece of state exists.
 * It talks to nothing but the worker; it never fetches, never reads storage. */
(function () {
  var el = document.getElementById('syf-audio');
  /* the user's volume for the player. el.volume is DERIVED from it by mix() below —
     never saved from el.volume, which may be ducked at that moment (an 80% recitation
     stuck at 12% after a three-ayah queue, because the second clip saved the ducked
     value as «the original») */
  var elVol = 1;

  function post(extra) {
    try {
      chrome.runtime.sendMessage(Object.assign({ type: 'SYFS_QSTATE' }, extra || {}), function () {
        void chrome.runtime.lastError;                 /* the worker may be asleep — not an error */
      });
    } catch (e) {}
  }
  /* how far the browser has actually downloaded. The player draws this as a second
     layer behind the progress fill, which is the difference between "stalled" and
     "still buffering" being visible instead of guessed. Only the LAST range is
     reported: after a seek the earlier ranges are behind the playhead and would
     draw a bar that runs backwards. */
  function buffered() {
    try {
      var b = el.buffered;
      if (!b || !b.length) return 0;
      var end = b.end(b.length - 1);
      return isFinite(end) ? end : 0;
    } catch (e) { return 0; }        /* buffered throws INVALID_STATE with no source */
  }
  function snap(evt) {
    return {
      evt: evt,
      playing: !el.paused && !el.ended,
      pos: isFinite(el.currentTime) ? el.currentTime : 0,
      dur: isFinite(el.duration) ? el.duration : 0,
      buf: buffered(),
      rate: el.playbackRate,
      vol: elVol,
      loading: el.readyState < 2 && !el.paused
    };
  }

  /* نقطة الاستئناف تصل مع أمر التحميل وتُطبَّق لحظة جهوز البيانات الوصفية، لا كأمر
     seek منفصل بعده: عنصر ما زال بلا duration يبتلع أي currentTime بصمت، فيسابق
     الـseek التحميلَ ويضيع — وهو سبب عودة «استئناف» إلى ٠:٠٠ في كل مرّة. ومستمع
     واحد دائم بمتغيّر معلّق، لا مستمع جديد مع كل تحميل يبقى بعده حاملاً نقطة قديمة.
     ⚠️ يُسجَّل قبل مستمعي `post` أدناه حتى تحمل أوّل لقطة موضع الاستئناف لا الصفر. */
  var pendingStart = 0;
  el.addEventListener('loadedmetadata', function () {
    if (!pendingStart) return;
    var t = pendingStart; pendingStart = 0;
    try {
      if (isFinite(el.duration) && el.duration > 0) el.currentTime = Math.max(0, Math.min(t, el.duration));
    } catch (e) {}
  });

  ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'waiting', 'playing', 'progress'].forEach(function (e) {
    el.addEventListener(e, function () { post(snap(e)); });
  });
  el.addEventListener('error', function () {
    /* the element's own error code, not the URL: the URL is already known to the
       worker, and echoing it back would put a remote string on more paths than it
       needs to be on */
    post({ evt: 'error', code: (el.error && el.error.code) || 0, playing: false, pos: 0, dur: 0 });
  });

  /* A live stream that freezes with neither `error` nor `ended` (Wi-Fi gone, the TCP
     connection never closed) sat on «…جارٍ الاتصال» forever: the worker reconnects
     only on those two events. So, for a LIVE load only, the playhead is watched —
     15 s without moving while not paused is reported once as `stall`, which the
     worker treats like `ended` (its bounded reconnect). A generation number stops an
     old watch instead of clearTimeout: a newer load simply outlives it. */
  var watchGen = 0;
  function watch(live) {
    var g = ++watchGen, last = -1, still = 0;
    if (!live) return;
    (function tick() {
      setTimeout(function () {
        if (g !== watchGen) return;
        var t = el.currentTime;
        if (el.paused || t !== last) { still = 0; last = t; }
        else if ((still += 5) === 15) post(snap('stall'));       /* once per freeze */
        tick();
      }, 5000);
    }());
  }

  /* ===== قناة المقاطع القصيرة (v0.127.0) =====
   * A dhikr recited by a sheikh, an ayah — one short file at a time, on its own
   * element. Two departures from the doctrine above, both deliberate:
   *   1. This channel DOES fetch. A service worker cannot mint a blob: URL (MV3
   *      dropped URL.createObjectURL there), so the only place a cached recording can
   *      become playable is a document. The worker still decides WHAT plays; this
   *      decides nothing but where the bytes come from.
   *   2. It caches in IndexedDB, keyed by url. «بثّ ثم تخزين»: the stream starts at
   *      once from the network while the copy is written in the background, so the
   *      first play is not slower and every later one works offline.
   * A queue (`list`) plays items in order and reports the index, which is what lets
   * the wird highlight the ayah it is reciting. */
  var clip = document.getElementById('syf-clip');
  var queue = [], qi = -1, clipVol = 1;
  /* محرك الآيات (v0.180.0) — for memorising (التحفيظ) and the kids' «ردّد بعدي»:
     each item × `reps`, the whole list × `loops`, and after every play a silence of
     `gap` × that item's own length, for the listener to repeat it. The defaults
     (1, 1, 0) are the old queue exactly. `ri`/`li` count where we are; `gapT` is the
     pending silence, so a pause or a stop cancels it. */
  var reps = 1, loops = 1, gap = 0, ri = 0, li = 0, gapT = 0, inGap = false, held = false;
  /* the ALERT channel — the adhan, the pre-adhan chime, a goal dhikr. One element of
     its own, so an alert never replaces the wird's queue or the player's source;
     `alertPri` (0 = silent) ranks alerts: a lower one is refused while a higher one
     sounds, so nothing cuts the adhan. Missing element ⇒ the channel refuses. */
  var al = document.getElementById('syf-alert');
  var alertPri = 0;

  /* ducking is a FUNCTION of what is sounding, recomputed on every change — not a
     saved-then-restored value. An alert ducks the player and the clip queue; a clip
     ducks the player. A paused element keeps its own volume (nothing to duck), and
     its `play` event recomputes. */
  var DUCK = 0.12;
  function mix() {
    try {
      var over = alertPri > 0;
      el.volume = (!el.paused && (over || qi >= 0)) ? Math.min(elVol, DUCK) : elVol;
      clip.volume = (!clip.paused && over) ? Math.min(clipVol, DUCK) : clipVol;
    } catch (e) {}
  }
  el.addEventListener('play', mix);
  clip.addEventListener('play', mix);

  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('syfs-clips', 1);
      r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains('c')) r.result.createObjectStore('c'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function cacheGet(url) {
    return idb().then(function (db) {
      return new Promise(function (res) {
        var q = db.transaction('c', 'readonly').objectStore('c').get(url);
        q.onsuccess = function () { res(q.result || null); };
        q.onerror = function () { res(null); };
      });
    }).catch(function () { return null; });
  }
  function cachePut(url, blob) {
    /* a cap, not a policy: a runaway list of ayah files would fill the profile quietly */
    if (!blob || blob.size > 8 * 1024 * 1024) return;
    idb().then(function (db) {
      try { db.transaction('c', 'readwrite').objectStore('c').put(blob, url); } catch (e) {}
    }).catch(function () {});
  }
  function warm(url) {
    /* the copy for NEXT time — failures are silent, the stream is already playing */
    fetch(url).then(function (r) { return r.ok ? r.blob() : null; })
      .then(function (b) { if (b) cachePut(url, b); }).catch(function () {});
  }
  function clipPost(extra) {
    try {
      chrome.runtime.sendMessage(Object.assign({ type: 'SYFS_CLIPSTATE' }, extra || {}), function () { void chrome.runtime.lastError; });
    } catch (e) {}
  }
  /* one blob: URL alive per element — a 700-ayah queue kept every cached file pinned.
     `gen` drops a cache lookup that a newer item or a stop overtook: it would have put
     the OLD file back on the element after the new one. */
  var blobs = { clip: '', alert: '' }, gen = { clip: 0, alert: 0 };
  function revoke(k) { if (blobs[k]) { try { URL.revokeObjectURL(blobs[k]); } catch (e) {} blobs[k] = ''; } }
  function sound(k, elm, url, then) {
    /* cache first, network second — and the URL was checked by the worker, never
       interpolated into markup */
    var g = ++gen[k];
    elm.pause();
    revoke(k);
    return cacheGet(url).then(function (blob) {
      if (g !== gen[k]) return;
      if (blob) { blobs[k] = URL.createObjectURL(blob); elm.src = blobs[k]; } else elm.src = url;
      elm.play().catch(function () {});
      if (then) then();
      if (!blob && url.indexOf('https://') === 0) warm(url);   /* a bundled sound is already local */
    });
  }
  function clipAt(evt) { return { evt: evt, i: qi, n: queue.length, r: ri, rn: reps, l: li, ln: loops }; }
  function clipPlay(i) {
    qi = i;
    if (qi < 0 || qi >= queue.length) { clipStop(); return; }
    mix();
    sound('clip', clip, queue[qi], function () { clipPost(clipAt('clip')); });
  }
  function gapClear() { if (gapT) { clearTimeout(gapT); gapT = 0; } inGap = false; }
  /* what follows the item that just ended: the same item again, the next one, the
     list from the top, or the end. `failed` = the file is broken — repeating it
     would only fail again, so it is skipped whatever `reps` says. */
  function clipNext(failed) {
    gapClear();
    if (!failed && ri + 1 < reps) {
      ri++;
      try { clip.currentTime = 0; } catch (e) {}
      if (!held) clip.play().catch(function () {});
      clipPost(clipAt('clip'));
      return;
    }
    ri = 0;
    if (qi + 1 < queue.length) { clipPlay(qi + 1); return; }
    if (li + 1 < loops) { li++; clipPlay(0); return; }
    clipStop();
  }
  function clipEnded() {
    var d = isFinite(clip.duration) ? clip.duration : 0;
    var rate = clip.playbackRate || 1;
    /* capped: a broken duration must not leave the queue silent for an hour */
    var ms = gap > 0 ? Math.min(30000, Math.round(d * gap * 1000 / rate)) : 0;
    if (ms <= 0) { clipNext(false); return; }
    inGap = true;
    clipPost(Object.assign(clipAt('gap'), { ms: ms }));
    if (!held) gapT = setTimeout(function () { gapT = 0; clipNext(false); }, ms);
  }
  function clipStop() {
    gapClear(); held = false; ri = 0; li = 0;
    queue = []; qi = -1; gen.clip++;
    try { clip.pause(); clip.removeAttribute('src'); clip.load(); } catch (e) {}
    revoke('clip');
    mix();
    /* `busy`: the other channel still sounds — the worker must not close the document */
    clipPost({ evt: 'clipend', i: -1, n: 0, busy: alertPri > 0 });
  }
  clip.addEventListener('ended', clipEnded);
  clip.addEventListener('error', function () {
    /* a missing recording must not strand the queue on a silent element */
    if (qi >= 0) clipNext(true);
  });

  function alertPlay(url, pri) {
    alertPri = pri;
    mix();
    sound('alert', al, url, mix);
  }
  function alertStop() {
    alertPri = 0; gen.alert++;
    try { al.pause(); al.removeAttribute('src'); al.load(); } catch (e) {}
    revoke('alert');
    mix();
    clipPost({ evt: 'alertend', busy: qi >= 0 });
  }
  if (al) {
    al.addEventListener('ended', alertStop);
    al.addEventListener('error', alertStop);          /* a broken file must not hold the rank */
  }

  /* ⛔ orders come from the WORKER only (v0.139.2). This page holds <all_urls> host
     permission, and until now any content script could post `{target:'syf-offscreen',
     op:'clip', url}` straight here — past CLIP_HOSTS and qSafeServer, the gates the
     worker calls «the one gate» — and `warm()` would fetch any URL and store it.
     A content script's message always carries `sender.tab`; the worker's never does. */
  var CLIP_PREFIX = ['https://www.hisnmuslim.com/audio/', 'https://cdn.islamic.network/quran/audio/', /* = CLIP_HOSTS in background.js */
    chrome.runtime.getURL('sounds/')];   /* v0.152.0 — the bundled prayer-alert sounds (ikSound) */
  function fromWorker(sender) {
    return !!sender && !sender.tab && sender.id === chrome.runtime.id &&
      (!sender.url || sender.url.indexOf(chrome.runtime.getURL('')) === 0);
  }
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.target !== 'syf-offscreen') return;
    if (!fromWorker(sender)) return;
    if (msg.op === 'clip') {
      /* second lock, not the first: the worker already checked these prefixes */
      var urls = (msg.urls || []).map(String).filter(function (u) {
        return CLIP_PREFIX.some(function (p) { return u.indexOf(p) === 0; });
      });
      if (msg.ch === 'alert') {
        var pri = (msg.pri === 1 || msg.pri === 2 || msg.pri === 3) ? msg.pri : 1;
        if (!al || !urls.length) { sendResponse({ ok: false, n: 0 }); return true; }
        /* a lower alert while a higher one sounds is dropped, not queued: a dhikr
           recited four minutes late, after the adhan, answers nothing */
        if (alertPri > pri) { sendResponse({ ok: true, n: 0, skipped: true }); return true; }
        alertPlay(urls[0], pri);
        sendResponse({ ok: true, n: 1 });
        return true;
      }
      gapClear(); held = false; ri = 0; li = 0;
      queue = urls.slice(0, 700);
      /* second lock again: the worker clamps these too */
      reps = (Number.isInteger(msg.reps) && msg.reps >= 1 && msg.reps <= 20) ? msg.reps : 1;
      loops = (Number.isInteger(msg.loops) && msg.loops >= 1 && msg.loops <= 20) ? msg.loops : 1;
      gap = (typeof msg.gap === 'number' && msg.gap >= 0 && msg.gap <= 3) ? msg.gap : 0;
      if (msg.vol >= 0 && msg.vol <= 1) clipVol = msg.vol;
      clip.playbackRate = (msg.rate >= 0.5 && msg.rate <= 2) ? msg.rate : 1;
      if (queue.length) clipPlay(0); else clipStop();
      sendResponse({ ok: true, n: queue.length });
      return true;
    }
    /* pause holds the place — mid-ayah or mid-silence — and resume picks it up */
    if (msg.op === 'clippause') {
      if (qi >= 0 && !held) {
        held = true;
        if (gapT) { clearTimeout(gapT); gapT = 0; }
        try { clip.pause(); } catch (e) {}
        clipPost(clipAt('clippause'));
      }
      sendResponse({ ok: qi >= 0 });
      return true;
    }
    if (msg.op === 'clipresume') {
      if (qi >= 0 && held) {
        held = false;
        if (inGap) clipNext(false); else { clip.play().catch(function () {}); clipPost(clipAt('clip')); }
      }
      sendResponse({ ok: qi >= 0 });
      return true;
    }
    if (msg.op === 'clipstop') {
      if (msg.ch === 'alert') { if (al) alertStop(); } else clipStop();
      sendResponse({ ok: true });
      return true;
    }
    try {
      switch (msg.op) {
        case 'load':
          /* the worker has already checked this URL against the allowed audio hosts;
             it is set as a plain src, never interpolated into markup */
          el.src = String(msg.url || '');
          el.playbackRate = msg.rate || 1;
          if (msg.vol >= 0 && msg.vol <= 1) elVol = msg.vol;
          mix();
          el.currentTime = 0;
          /* العامل هو من يقرّر نقطة البدء — هنا تُحفظ حتى تجهز المدّة، والقرار يبقى هناك */
          pendingStart = (typeof msg.start === 'number' && isFinite(msg.start) && msg.start > 0) ? msg.start : 0;
          watch(msg.live === true);
          if (msg.autoplay !== false) {
            el.play().catch(function (e) {
              /* AbortError = a newer load or a stop overtook this one (two quick
                 «التالية», «إيقاف تام» while connecting). Not a broken source: reported
                 as one, the worker showed «تعذّر» and reconnected a stopped radio. */
              if (e && e.name === 'AbortError') return;
              post({ evt: 'error', code: 0, playing: false });
            });
          }
          break;
        case 'play':   el.play().catch(function () {}); break;
        case 'pause':  el.pause(); break;
        case 'stop':   watch(false); el.pause(); el.removeAttribute('src'); el.load(); break;
        case 'seek':   if (isFinite(msg.t) && isFinite(el.duration)) el.currentTime = Math.max(0, Math.min(msg.t, el.duration)); break;
        case 'rate':   if (msg.r >= 0.5 && msg.r <= 2) el.playbackRate = msg.r; break;
        /* the worker has already clamped this; the range check here is the second
           lock, not the first — this document must not be the thing that trusts.
           It sets the user's level; a duck in progress keeps applying on top of it. */
        case 'vol':    if (msg.v >= 0 && msg.v <= 1) { elVol = msg.v; mix(); } break;
        case 'state':  break;
      }
    } catch (e) {}
    /* `clip`: is another channel still speaking? The worker must not close this
       document under a dhikr or the adhan just because the Quran stopped */
    sendResponse(Object.assign(snap('reply'), { clip: qi >= 0 || alertPri > 0 }));
    return true;
  });

  post(snap('ready'));
}());
