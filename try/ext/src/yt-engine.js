/* SYF — YouTube ad engine: response pruning (MAIN world, document_start).
 *
 * NOT a manifest content script. background.js registers it via
 * chrome.scripting.registerContentScripts ONLY while yt_mode === 'full' and
 * youtube.com is not allowlisted. Its mere PRESENCE therefore means "prune" —
 * which is the whole point: a chrome.storage gate is asynchronous and resolves
 * long after the player response has already been parsed, so the old version
 * pruned some loads and not others. That inconsistency is what wedged the player.
 *
 * Two entry points cover every way a player response reaches the page:
 *   1) window.ytInitialPlayerResponse — the inline script on a cold page load.
 *      We install an accessor BEFORE it is assigned, so the value is pruned on
 *      its way in. If the inline script already ran (we lost the injection race)
 *      we prune the existing object in place instead. Either order works — that
 *      race is exactly what broke the previous attempt.
 *   2) fetch('/youtubei/v1/player') — every SPA navigation. It never touches the
 *      inline script at all, so pruning (1) alone left every in-page click ad-full.
 *
 * We delete ONLY the ad fields. streamingData and playabilityStatus are never
 * touched: editing those hands the player an inconsistent stream, which is the
 * documented cause of the permanent black screen (CHANGELOG v0.4x–v0.5x).
 *
 * No network blocking on YouTube (see rules/youtube.json): a blocked ad probe is
 * what triggers the "ad blockers violate our Terms" enforcement. Pruning acts on
 * the RESPONSE, so every request still succeeds and nothing is detected.
 *
 * Reads no video or account data and transmits nothing. */
(function () {
  'use strict';

  var AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];
  var API_RE = /\/youtubei\/v1\/(player|next|reel_item_watch|reel_watch_sequence)/;

  /* Live kill switch. yt-guard.js (isolated world) mirrors the effective mode onto
   * <html data-syfs-yt> so toggling the tool off stops us mid-session. Absent =
   * the guard has not read storage yet; we were only registered in full mode, so
   * prune — this is the default that makes the cold-load path deterministic. */
  function pruning() {
    try {
      var v = document.documentElement.getAttribute('data-syfs-yt');
      return v === null || v === 'full';
    } catch (e) { return true; }
  }

  /* The guard reloads a wedged video ONCE with pruning disabled and records that in
   * the page's own sessionStorage — readable synchronously here at document_start,
   * unlike chrome.storage. Same key as yt-guard.js: syfs_yt_noprune_<videoId>. */
  function videoId() {
    try {
      var q = /[?&]v=([\w-]{6,20})/.exec(location.search);
      if (q) return q[1];
      var p = /^\/(?:shorts|embed)\/([\w-]{6,20})/.exec(location.pathname);
      return p ? p[1] : '';
    } catch (e) { return ''; }
  }
  function standingDown() {
    var id = videoId();
    if (!id) return false;
    try { return sessionStorage.getItem('syfs_yt_noprune_' + id) === '1'; }
    catch (e) { return false; }   /* storage blocked (partitioned embed) → keep pruning */
  }

  var count = 0;
  function report() {
    try { document.documentElement.setAttribute('data-syfs-yt-pruned', String(count)); } catch (e) {}
  }

  /* mutates in place and returns the same object — callers can assign the result
   * unconditionally, pruned or not */
  function prune(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (!pruning() || standingDown()) return obj;
    var hit = false;
    for (var i = 0; i < AD_KEYS.length; i++) {
      if (Object.prototype.hasOwnProperty.call(obj, AD_KEYS[i])) { delete obj[AD_KEYS[i]]; hit = true; }
    }
    if (hit) { count++; report(); }
    return obj;
  }

  /* ---- 1) inline player response ---- */
  try {
    var stored;
    if (Object.prototype.hasOwnProperty.call(window, 'ytInitialPlayerResponse')) {
      stored = prune(window.ytInitialPlayerResponse);   /* lost the race — prune in place */
    }
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get: function () { return stored; },
      set: function (v) { stored = prune(v); }
    });
  } catch (e) { /* another extension owns the property — the fetch hook still covers us */ }

  /* ---- 2) SPA navigations ---- */
  try {
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = '';
      try { url = (typeof input === 'string') ? input : (input && input.url) || ''; } catch (e) {}
      var res = origFetch.apply(this, arguments);
      if (!API_RE.test(url)) return res;
      return res.then(function (r) {
        if (!r || !r.ok) return r;
        /* read the clone so the original body stays intact if anything below throws */
        return r.clone().json().then(function (data) {
          var before = count;
          prune(data);
          if (count === before) return r;            /* no ads in it — hand back the untouched response */
          return new Response(JSON.stringify(data), {
            status: r.status, statusText: r.statusText, headers: r.headers
          });
        }).catch(function () { return r; });         /* not JSON / already consumed → leave it alone */
      });
    };
  } catch (e) { /* ignore */ }

  report();
  try { console.log('%c[SYFS-YT]%c prune engine active', 'color:#457364;font-weight:bold', ''); } catch (e) {}
})();
