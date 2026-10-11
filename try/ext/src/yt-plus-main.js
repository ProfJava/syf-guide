/* SYF — «يوتيوب+»: MAIN-world quality setter.
 *
 * ⚠️ NOT a manifest content script. background.js registers it with
 * chrome.scripting.registerContentScripts ONLY while a real (non-auto) quality is
 * selected, and unregisters it otherwise — so a user who never touches quality
 * never gets a MAIN-world script on youtube.com at all. Same pattern as
 * src/yt-engine.js, for a different reason: that one must exist to prune, this one
 * must exist to reach the player object.
 *
 * Why MAIN at all: setPlaybackQualityRange lives on the page's own #movie_player
 * object. Content scripts share the DOM but not the JS heap, so from the isolated
 * world the element has no such method. There is no way around this short of
 * clicking through YouTube's settings menu, which is visible, slow and far more
 * fragile.
 *
 * ⛔ THE HARD LINE: this file touches the PLAYER API and nothing else. It must
 * never read, wrap or rewrite ytInitialPlayerResponse, streamingData or
 * playabilityStatus — an inconsistently rewritten player response is the documented
 * cause of the permanent black screen (.claude/context.md decision #3). That is
 * also why "disable 60fps" is not here and must not be added: it cannot be done
 * through the player API, only by deleting adaptiveFormats entries.
 *
 * Input trust: the requested quality arrives from the isolated world via an
 * attribute on <html> and a CustomEvent. Both are readable AND forgeable by the
 * page, so both are validated against a fixed whitelist. Worst case for a hostile
 * page forging them: it changes the resolution of its own video. */
(function () {
  'use strict';

  if (window.__syfsYtpMain) return;
  window.__syfsYtpMain = true;

  /* value → YouTube's own quality label */
  var MAP = {
    '144': 'tiny', '240': 'small', '360': 'medium', '480': 'large',
    '720': 'hd720', '1080': 'hd1080', '1440': 'hd1440', '2160': 'hd2160'
  };
  /* ascending, so "the best one that is not above what was asked" is an index compare */
  var ORDER = ['tiny', 'small', 'medium', 'large', 'hd720', 'hd1080', 'hd1440', 'hd2160', 'highres'];

  var want = '';          /* '' = auto → do nothing at all */
  var lastCall = 0;

  function valid(q) { return typeof q === 'string' && Object.prototype.hasOwnProperty.call(MAP, q); }

  function readAttr() {
    var q;
    try { q = document.documentElement.getAttribute('data-syfs-ytq'); } catch (e) { return; }
    want = valid(q) ? q : '';
  }

  function player() {
    var p = document.getElementById('movie_player');
    if (p && typeof p.setPlaybackQualityRange === 'function') return p;
    return null;
  }

  /* Pick the highest AVAILABLE level that is not above the request. Asking for a
   * level the video does not have makes the player fall back to auto, which is the
   * opposite of what a user picking 480p on a slow line wants. If nothing at or
   * below the request exists, we leave the player alone rather than force it up. */
  function target(p) {
    var label = MAP[want];
    var avail = [];
    try { if (typeof p.getAvailableQualityLevels === 'function') avail = p.getAvailableQualityLevels() || []; } catch (e) {}
    if (!avail.length || avail.indexOf(label) >= 0) return label;
    var wi = ORDER.indexOf(label), best = '', bi = -1;
    for (var i = 0; i < avail.length; i++) {
      var ai = ORDER.indexOf(avail[i]);
      if (ai >= 0 && ai <= wi && ai > bi) { bi = ai; best = avail[i]; }
    }
    return best;
  }

  function apply() {
    if (!want) return;
    var p = player();
    if (!p) return;
    var t = target(p);
    if (!t) return;
    var cur = '';
    try { if (typeof p.getPlaybackQuality === 'function') cur = p.getPlaybackQuality(); } catch (e) {}
    if (cur === t) return;
    /* Each call can restart the media pipeline. A cooldown keeps a stubborn player
     * (one that reports a different quality than it accepted) from being hammered
     * into a rebuffering loop. */
    var now = Date.now();
    if (now - lastCall < 1500) return;
    lastCall = now;
    try { p.setPlaybackQualityRange(t, t); } catch (e) {}
  }

  /* live updates from src/yt-plus.js (same page, isolated world) */
  document.addEventListener('syfs-ytp-quality', function (e) {
    var q = e && e.detail && e.detail.q;
    want = valid(q) ? q : '';
    lastCall = 0;
    apply();
  }, { passive: true });

  document.addEventListener('yt-navigate-finish', function () {
    readAttr();
    lastCall = 0;
    poll();
  }, { passive: true });

  /* Bounded settle poll: the player object appears well after document_start and
   * re-reads its formats on every video. 20 ticks per navigation, then silent. */
  var left = 0, timer = 0;
  function poll() {
    left = 20;
    if (timer) return;
    timer = setInterval(function () {
      readAttr();
      apply();
      if (--left <= 0) { clearInterval(timer); timer = 0; }
    }, 1000);
  }

  readAttr();
  poll();
}());
