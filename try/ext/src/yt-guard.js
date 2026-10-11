/* SYF — YouTube guard: isolated content script (document_start).
 * Companion to src/yt-engine.js (MAIN world, pruning). Owns four things:
 *
 *   1) The gate. Mirrors the effective mode onto <html data-syfs-yt> so the engine
 *      — which cannot read chrome.storage — has a synchronous kill switch.
 *        off  → YouTube is left 100% vanilla.
 *        safe → skip layer only (mute + fast-forward + click Skip). An ad flashes.
 *        full → engine prunes the ad out of the player response; the skip layer
 *               stays armed underneath as a fallback for anything that slips past.
 *
 *   2) The skip layer. NEVER seeks the ad to its end (v.currentTime = v.duration).
 *      That forced seek left the media element in an ended/black state and the
 *      hand-off to the real video failed — the permanent black screen. Muting and
 *      raising playbackRate lets the player run its OWN ad→content transition, so
 *      it cannot wedge. The ad and the content share one <video>, so the user's
 *      muted state is remembered and restored — nothing else would.
 *
 *   3) The watchdog — new in v0.61, and the reason full mode is safe to ship.
 *      Previously a wedged player stayed wedged forever: nothing detected it and
 *      nothing recovered. Now, if the user is trying to play (not paused) and the
 *      video has loaded literally nothing (readyState 0, currentTime 0) for 6s, we
 *      reload the page ONCE with pruning disabled for that video id — so it plays
 *      in safe mode instead of showing a black rectangle. Strictly one reload per
 *      video id (the flag lives in sessionStorage, which survives the reload), so a
 *      reload loop is impossible. After 3 wedges the mode self-demotes to `safe`.
 *
 *   4) Standing down — a LADDER, not a cliff (v0.70). If YouTube's "Ad blockers
 *      violate our Terms" notice renders we step down exactly ONE rung and tell the
 *      user, instead of switching everything off. The rungs, quietest last:
 *        full            prune + skip + cosmetic
 *        safe            skip + cosmetic        — blocks no request at all
 *        safe, no cosmetic   skip only          — the quietest thing we have
 *        off             vanilla
 *      safe cannot be what YouTube detected (it blocks nothing — rules/youtube.json
 *      is an ALLOW rule, so YouTube is exempt from every blocklist), which is why
 *      dropping straight from full to off gave up the skip layer for nothing. The
 *      cosmetic CSS *is* detectable via getComputedStyle, so it is its own rung.
 *      The NOTICE STAYS VISIBLE. Deleting it does not bring the stream back —
 *      YouTube already refused it — so removing the dialog only uncovers a dead
 *      player with no explanation. Never re-add a killer here.
 *      A demoted setting only takes effect on the next page load (the prune engine
 *      is registered at page load by the worker), so a demotion offers a reload —
 *      capped at ONE per video id per tab session. See demote()/doReload().
 *
 * Reads no video or account content and transmits nothing — DOM + CSS only. The
 * video id never leaves sessionStorage (in storage.local it would be a watch log). */
(function () {
  'use strict';

  var htmlEl = document.documentElement;
  var host = (location.hostname || '').toLowerCase().replace(/^www\./, '');
  /* v0.139.4: one family, both ways — the same rule the worker applies to the prune
     engine (syncYtEngine) and to the DNR exception (YT_FAMILY). Before, an embed on
     youtube-nocookie.com ignored a youtube.com exception while the engine honoured it. */
  var siteKeys = ['youtube.com', 'youtube-nocookie.com'];

  var WEDGE_MS = 6000;      /* "trying to play but nothing loaded" for this long = wedged */
  var MAX_WEDGES = 3;       /* …across distinct videos → demote the mode to safe */
  var FF = 16;              /* ad fast-forward rate */

  /* ---- state ---- */
  var mode = 'off';         /* off | safe | full — effective (allowlist applied) */
  var cosmetic = true, shorts = true, cleanLoad = true;
  var stoodDown = false;
  var prevMuted = null;     /* the user's own muted state, before we muted an ad */
  var wedgeAt = 0, recovering = false;

  /* One demotion per PAGE LOAD. Deliberately NOT reset by load(): writing the new
   * setting fires storage.onChanged → load(), and an SPA hop calls load() too — if
   * either re-armed us, the still-rendered notice would demote us again immediately
   * and walk full→safe→off in milliseconds. It resets only when this script re-runs
   * on a real page load, which is also the only moment a demoted setting can take
   * effect (the prune engine is registered per page load). */
  var demoted = false;

  /* ---- cosmetic ----
   * ytd-statement-banner-renderer is deliberately NOT hidden: that is where YouTube
   * renders its ad-blocker notice, and gagging the one message that explains why
   * playback stopped is worse than the odd site promo it also carries. */
  var AD_CSS =
    '#masthead-ad,ytd-ad-slot-renderer,ytd-in-feed-ad-layout-renderer,' +
    'ytd-promoted-video-renderer,ytd-promoted-sparkles-web-renderer,' +
    'ytd-display-ad-renderer,ytd-companion-slot-renderer,ytd-action-companion-ad-renderer,' +
    'ytd-video-masthead-ad-v3-renderer,ytd-video-masthead-ad-advertiser-info-renderer,' +
    '#player-ads,#panels ytd-ads-engagement-panel-content-renderer,' +
    '.ytp-ad-module,.ytp-ad-overlay-slot,.ytp-ad-image-overlay,.ytp-ad-overlay-container,' +
    'ytd-rich-item-renderer:has(ytd-ad-slot-renderer),' +
    'ytd-banner-promo-renderer' +
    '{display:none!important;}';

  var REMOVE_SEL = [
    'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer',
    'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
    'ytd-rich-section-renderer:has(ytd-ad-slot-renderer)',
    'ytd-promoted-video-renderer', 'ytd-promoted-sparkles-web-renderer',
    'ytd-display-ad-renderer', 'ytd-companion-slot-renderer',
    'ytd-action-companion-ad-renderer', 'ytd-banner-promo-renderer',
    'ytd-video-masthead-ad-v3-renderer', '#masthead-ad', '#player-ads'
  ];

  var styleEl = null;
  function ensureStyle() {
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'syfs-yt-css'; styleEl.textContent = AD_CSS; }
    if (!styleEl.isConnected) htmlEl.appendChild(styleEl);
  }
  function removeStyle() { if (styleEl && styleEl.isConnected) styleEl.remove(); }

  /* v0.139.3: ONE document walk for all selectors (was 13 per mutation burst). A
     selector list fails whole if any member is unsupported — then fall back to
     one query per selector so the rest still work. */
  var REMOVE_ALL = REMOVE_SEL.join(',');
  function adNodes() {
    try { return [document.querySelectorAll(REMOVE_ALL)]; } catch (e) { /* fall through */ }
    var out = [];
    for (var i = 0; i < REMOVE_SEL.length; i++) {
      try { out.push(document.querySelectorAll(REMOVE_SEL[i])); } catch (e) { /* skip */ }
    }
    return out;
  }
  function killAds() {
    if (!cosmetic) return;
    var lists = adNodes();
    for (var i = 0; i < lists.length; i++) {
      var nodes = lists[i];
      for (var j = 0; j < nodes.length; j++) {
        var n = nodes[j];
        var cell = n.closest ? (n.closest('ytd-rich-item-renderer') || n) : n;
        try { (cell || n).remove(); } catch (e) { try { n.style.display = 'none'; } catch (e2) {} }
      }
    }
  }

  /* ---- video helpers ---- */
  function currentVideo() { return document.querySelector('#movie_player video, video.html5-main-video'); }
  function isWatch() { return location.pathname.indexOf('/watch') === 0; }
  function videoId() {
    var q = /[?&]v=([\w-]{6,20})/.exec(location.search);
    if (q) return q[1];
    var p = /^\/(?:shorts|embed)\/([\w-]{6,20})/.exec(location.pathname);
    return p ? p[1] : '';
  }
  function restorePlayback() {
    var v = currentVideo();
    if (!v) return;
    try { if (v.playbackRate === FF) v.playbackRate = 1; } catch (e) {}
    if (prevMuted !== null) { try { v.muted = prevMuted; } catch (e) {} prevMuted = null; }
  }

  /* ---- skip layer ---- */
  function skip() {
    var player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (!player) return;
    var v = player.querySelector('video');
    if (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')) {
      if (v) {
        if (prevMuted === null) prevMuted = v.muted;
        v.muted = true;
        try { if (v.playbackRate !== FF) v.playbackRate = FF; } catch (e) {}
      }
      var s = document.querySelector('.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.ytp-ad-skip-button-container button');
      if (s) { try { s.click(); } catch (e) {} }
      var c = document.querySelector('.ytp-ad-overlay-close-button');
      if (c) { try { c.click(); } catch (e) {} }
    } else if (v) {
      restorePlayback();
    }
  }

  /* ---- Shorts: ad reels are injected into the sequence and marked is-ads-overlay;
   * the prune engine can't drop them (separate entries), so advance past them ---- */
  var lastShortSkip = 0;
  function activeReel() {
    var reels = document.querySelectorAll('ytd-reel-video-renderer');
    var cy = (window.innerHeight || 0) / 2;
    for (var i = 0; i < reels.length; i++) {
      var r; try { r = reels[i].getBoundingClientRect(); } catch (e) { continue; }
      if (r.height > 120 && r.top <= cy && r.bottom >= cy) return reels[i];
    }
    return null;
  }
  function skipShortsAd() {
    if (!shorts || location.pathname.indexOf('/shorts/') !== 0) return;
    var reel = activeReel();
    if (!reel || !reel.hasAttribute('is-ads-overlay')) return;
    var now = Date.now();
    if (now - lastShortSkip < 1200) return;      /* let the next reel settle */
    lastShortSkip = now;
    var down = document.querySelector('#navigation-button-down button, ytd-shorts #navigation-button-down button');
    if (down) { try { down.click(); return; } catch (e) {} }
    try {
      (document.body || htmlEl).dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true
      }));
    } catch (e) {}
  }

  /* ---- enforcement notice → stand down, leave it visible ---- */
  function enforcementShown() {
    return !!document.querySelector('ytd-enforcement-message-view-model, yt-playability-error-supported-renderers ytd-enforcement-message-view-model');
  }
  /* ---- reload discipline ----
   * THE hard guarantee: at most ONE reload per video id per tab session, no matter
   * how many times the notice fires or how many rungs we fall. sessionStorage is the
   * ledger because it survives the reload we are about to do and dies with the tab —
   * and because a video id in storage.local would be a watch history we have no
   * business keeping. We reload ONLY if the flag was written first: if we cannot
   * write it we cannot promise one-shot, so we do not reload at all. */
  function dtKey(id) { return 'syfs_yt_dt_' + id; }
  function reloadAllowed() {
    var id = videoId();
    if (!id) return false;                    /* home/channel page — no refused stream to retry */
    try { return sessionStorage.getItem(dtKey(id)) !== '1'; } catch (e) { return false; }
  }
  function markVideo() {
    var id = videoId();
    if (!id) return false;
    try { sessionStorage.setItem(dtKey(id), '1'); return true; } catch (e) { return false; }
  }
  function doReload() {
    if (!markVideo()) return;                 /* no ledger ⇒ no one-shot promise ⇒ no reload */
    location.reload();
  }

  /* ---- the toast ----
   * The rail mounts at document_idle and the notice renders well after that, so
   * SYFS.toast is normally there. Retry briefly anyway, and give up quietly if the
   * rail never mounted — yt_last (the shield tool's status line) is the durable
   * record; the toast is only the interruption. */
  function toast(title, msg, actions) {
    var tries = 0;
    (function attempt() {
      var S = window.SYFS;
      if (S && typeof S.toast === 'function' && S.toast(title, msg, { actions: actions, timeout: 0 })) return;
      if (++tries > 12) return;
      setTimeout(attempt, 250);
    })();
  }

  /* ---- detection → step down exactly one rung ---- */
  function onDetected() {
    if (demoted || mode === 'off') return;
    demoted = true;
    stoodDown = true;
    if (warmTimer) { clearInterval(warmTimer); warmTimer = null; }
    warmup = false;
    restorePlayback();

    /* the rung we were standing on — read BEFORE mode is cleared below */
    var rung = (mode === 'full') ? 'full' : (cosmetic ? 'safe+cos' : 'safe');

    /* Stop touching THIS page load immediately: YouTube already refused the stream,
     * so there is nothing left to skip, and the new setting only lands on reload. */
    mode = 'off';
    applyInactive();

    var patch = {}, title = 'كشف يوتيوب مانع الإعلانات', msg, undoPatch = null;

    if (rung === 'full') {
      patch.yt_mode = 'safe';
      patch.yt_demoted_from = 'full';
      patch.yt_last = 'كشف يوتيوب المانع — نزل الوضع من «كامل» إلى «آمن»';
      msg = 'انتقلنا إلى الوضع «الآمن»: يتخطّى الإعلان داخل المشغّل بلا حجب أي طلب.';
      undoPatch = { yt_mode: 'full' };
    } else if (rung === 'safe+cos') {
      patch.yt_cosmetic = false;
      patch.yt_demoted_from = 'safe+cos';
      patch.yt_last = 'كشف يوتيوب المانع — أُطفئ إخفاء مساحات الإعلانات (الوضع «آمن» المجرّد)';
      msg = 'أطفأنا إخفاء مساحات الإعلانات — الوضع «الآمن» بأهدأ صورة ممكنة.';
      undoPatch = { yt_cosmetic: true };
    } else {
      patch.yt_mode = 'off';
      patch.yt_demoted_from = 'safe';
      patch.yt_last = 'كشف يوتيوب المانع في كل الأوضاع — أُوقف المانع في يوتيوب';
      title = 'لم ينجح أي محرّك';
      msg = 'جرّبنا كل الأوضاع وما زال يوتيوب يكشف المانع — أوقفنا المانع في يوتيوب.';
      undoPatch = { yt_mode: 'safe' };
    }

    var canReload = (patch.yt_mode !== 'off') && reloadAllowed();
    msg += canReload
      ? ' يسري بعد إعادة تحميل الصفحة.'
      : ' رسالة يوتيوب تبقى ظاهرة كما هي — لا نخفيها لأن إخفاءها يترك مشغّلاً ميتاً بلا تفسير.';

    chrome.storage.local.get({ yt_detects: 0, yt_auto_reload: false }, function (r) {
      patch.yt_detects = (r.yt_detects || 0) + 1;
      chrome.storage.local.set(patch, function () {
        if (canReload && r.yt_auto_reload) { doReload(); return; }
        var actions = [];
        if (canReload) actions.push({ label: 'إعادة التحميل الآن', primary: true, onClick: doReload });
        actions.push({
          label: 'تراجع — أبقِ وضعي',
          /* The user owns the decision: restore the setting and burn the reload flag
           * so nothing auto-reloads this video later behind their back. Clear the
           * status line too — leaving "demoted to safe" next to a restored 'full'
           * would make our own panel lie about the live mode. */
          onClick: function () {
            markVideo();
            undoPatch.yt_demoted_from = '';
            undoPatch.yt_last = 'تراجعت عن التنازل — أُعيد الوضع كما كان';
            chrome.storage.local.set(undoPatch);
          }
        });
        toast(title, msg, actions);
      });
    });
  }

  /* ---- watchdog: the video is wedged → reload once without pruning ----
   * A wedged player looks like: the user is playing (not paused, not ended) yet the
   * element has loaded nothing at all (readyState 0) and never advanced past 0s.
   * A video the user simply hasn't started is paused → never triggers. YouTube's own
   * error screen (.ytp-error, e.g. "video unavailable") is not our doing → ignored. */
  function watch() {
    if (mode !== 'full' || !isWatch()) { wedgeAt = 0; return; }
    var v = currentVideo();
    if (!v || document.querySelector('.ytp-error')) { wedgeAt = 0; return; }
    var trying = !v.paused && !v.ended;
    var dead = v.readyState === 0 && v.currentTime === 0;
    if (!trying || !dead) { wedgeAt = 0; return; }
    if (!wedgeAt) { wedgeAt = Date.now(); return; }
    if (Date.now() - wedgeAt >= WEDGE_MS) recover();
  }

  function recover() {
    wedgeAt = 0;
    if (recovering) return;
    var id = videoId();
    if (!id) return;
    var key = 'syfs_yt_noprune_' + id;
    /* Already reloaded this video once and it STILL wedged → not the prune engine's
     * doing. Reloading again would loop forever, so leave the page alone. */
    try { if (sessionStorage.getItem(key) === '1') return; } catch (e) { return; }
    recovering = true;
    try { sessionStorage.setItem(key, '1'); } catch (e) { recovering = false; return; }
    chrome.storage.local.get({ yt_wedges: 0 }, function (r) {
      var n = (r.yt_wedges || 0) + 1;
      var patch = { yt_wedges: n, yt_last: 'تعليق في التشغيل — أُعيد تحميل الصفحة بلا كشط' };
      if (n >= MAX_WEDGES) {
        patch.yt_mode = 'safe';
        patch.yt_last = 'تعليق متكرّر — نُقل الوضع تلقائياً إلى «آمن»';
      }
      chrome.storage.local.set(patch, function () { location.reload(); });
    });
  }

  /* ---- ticking ---- */
  var timer = null, obs = null, pending = false, OBS_MS = 500;
  function tick() {
    if (mode === 'off') return;
    if (enforcementShown()) { onDetected(); return; }
    skip(); skipShortsAd(); killAds(); watch();
  }
  function startWatch() {
    if (timer == null) timer = setInterval(function () {
      if (mode === 'off') return;
      if (enforcementShown()) { onDetected(); return; }
      skip(); skipShortsAd(); watch();
    }, 300);
    /* v0.139.3: the observer only feeds killAds() — new ad nodes. Class flips (ad-showing
       on the player) are the 300ms interval's job above, so no attribute watching on
       the whole tree, and bursts coalesce into one sweep per OBS_MS. The CSS layer
       already hides the same nodes the instant they land; removal can wait. */
    if (!obs) {
      obs = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        setTimeout(function () { pending = false; tick(); }, OBS_MS);
      });
      try { obs.observe(htmlEl, { childList: true, subtree: true }); } catch (e) {}
    }
    tick();
  }
  function stopWatch() {
    if (timer != null) { clearInterval(timer); timer = null; }
    if (obs) { obs.disconnect(); obs = null; }
  }

  /* ---- apply ----
   * Clean-load (safe mode only): hold the video paused while the player builds, so it
   * is served exactly like an untouched page, then arm the skip layer. Full mode does
   * not need it — the ad is gone from the response before the player ever sees it. */
  var warmup = false, warmTimer = null, warmStart = 0;

  function videoReady() {
    var v = currentVideo();
    if (v && v.readyState >= 1) return true;
    var mp = document.getElementById('movie_player');
    return !!(mp && (mp.classList.contains('unstarted-mode') || mp.querySelector('.ytp-cued-thumbnail-overlay')));
  }
  function applyActive() {
    htmlEl.setAttribute('data-syfs-yt', mode);
    if (cosmetic) ensureStyle(); else removeStyle();
    startWatch();
  }
  function applyInactive() {
    htmlEl.setAttribute('data-syfs-yt', 'off');
    removeStyle();
    stopWatch();
  }
  function endWarmup() {
    if (warmTimer) { clearInterval(warmTimer); warmTimer = null; }
    if (!warmup) return;
    warmup = false;
    if (mode === 'off' || stoodDown) { applyInactive(); return; }
    applyActive();
  }
  function apply() {
    if (warmTimer) { clearInterval(warmTimer); warmTimer = null; }
    warmup = false;
    if (mode === 'off' || stoodDown) { applyInactive(); return; }
    if (mode === 'safe' && cleanLoad && isWatch()) {
      warmup = true;
      warmStart = Date.now();
      applyInactive();
      warmTimer = setInterval(function () {
        if (enforcementShown()) { onDetected(); return; }
        var v = currentVideo();
        if (v && !v.paused) { try { v.pause(); } catch (e) {} }
        if (videoReady() || (Date.now() - warmStart) > 8000) endWarmup();
      }, 200);
    } else {
      applyActive();
    }
  }

  function load() {
    stoodDown = demoted;      /* a demotion outlives every load() on this page load */
    recovering = false;
    wedgeAt = 0;
    try {
      chrome.storage.local.get({
        yt_mode: 'full', yt_cosmetic: true, yt_shorts: true, yt_clean_load: true, shield_allow: []
      }, function (r) {
        var allow = Array.isArray(r.shield_allow) ? r.shield_allow : [];
        var paused = siteKeys.some(function (k) { return allow.indexOf(k) >= 0; });
        var m = (r.yt_mode === 'safe' || r.yt_mode === 'off') ? r.yt_mode : 'full';
        mode = paused ? 'off' : m;
        /* Already demoted on this page load: the page still runs the OLD engine
         * (registration is per page load), so re-arming here would only hand the
         * still-rendered notice another rung to eat. The new mode starts fresh when
         * the script re-runs on the next real load. */
        if (demoted) mode = 'off';
        cosmetic = r.yt_cosmetic !== false;
        shorts = r.yt_shorts !== false;
        cleanLoad = r.yt_clean_load !== false;
        apply();
      });
    } catch (e) { mode = 'off'; apply(); }
  }

  load();

  /* SPA navigation — a new video gets a fresh attempt at everything */
  var lastPath = location.pathname + location.search;
  try { document.addEventListener('yt-navigate-finish', function () { lastPath = location.pathname + location.search; load(); }); } catch (e) {}
  setInterval(function () {
    var now = location.pathname + location.search;
    if (now !== lastPath) { lastPath = now; load(); }
  }, 800);

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (changes.yt_mode || changes.yt_cosmetic || changes.yt_shorts || changes.yt_clean_load || changes.shield_allow) load();
    });
  } catch (e) { /* ignore */ }

  /* keep the cosmetic style attached through YouTube's SPA rewrites */
  try {
    new MutationObserver(function () {
      if (mode !== 'off' && !warmup && !stoodDown && cosmetic && styleEl && !styleEl.isConnected) htmlEl.appendChild(styleEl);
    }).observe(htmlEl, { childList: true });
  } catch (e) { /* ignore */ }
})();
