/* SYF — «يوتيوب+»: isolated engine on *.youtube.com (document_start).
 *
 * This file owns the EXPERIENCE (speed, audio, loop, autoplay, hiding). It has
 * nothing to do with ad blocking — that is src/yt-guard.js + src/yt-engine.js,
 * and the two projects are deliberately kept apart:
 *
 *   • Storage namespaces never overlap: this file reads/writes `ytp_*` ONLY and
 *     must never touch a `yt_*` key. A bug in playback speed cannot take the ad
 *     blocker down with it, and switching the blocker off must not silently drop
 *     the user's speed/quality preferences.
 *   • It never touches ytInitialPlayerResponse / streamingData / playabilityStatus.
 *     Rewriting those is what produced the permanent black screen (see
 *     .claude/context.md decision #3) — which is also why "disable 60fps" is NOT
 *     implemented here and must not be added: the only way to do it is to delete
 *     entries from adaptiveFormats.
 *
 * Two cross-file frictions are handled here, not there:
 *   1. yt-guard fast-forwards ads at 16x and then resets playbackRate to 1 when the
 *      ad ends (restorePlayback). That reset would wipe a 1.5x default a moment
 *      after we applied it. So we re-apply on the exact edge where `ad-showing`
 *      leaves #movie_player, via a class MutationObserver — and we never fight the
 *      rate WHILE an ad is on screen, or we would slow the skip back down.
 *   2. Nothing here ever pauses a video the watchdog is measuring: `no-autoplay`
 *      pauses, and a paused video is explicitly not a wedge (yt-guard checks
 *      !paused), so it cannot trigger a spurious reload.
 *
 * Privacy: no fetch, no permission of its own, DOM + Web Audio only. Video titles,
 * channel names and page text are never read. The video id stays in memory for the
 * length of one page view — it is never written to chrome.storage (that would be a
 * watch history) and not even to sessionStorage. */
(function () {
  'use strict';

  if (window.__syfsYtpLoaded) return;
  window.__syfsYtpLoaded = true;

  var htmlEl = document.documentElement;

  /* ---- whitelists — every stored value is validated against these on the way IN.
   * A value outside its list is REPLACED BY THE DEFAULT, never "repaired": a
   * half-understood setting applied to the player is how you get a broken page you
   * cannot explain. ---- */
  var QUALITIES = ['auto', '144', '240', '360', '480', '720', '1080', '1440', '2160'];
  var SHORTS_MODES = ['off', 'hide', 'asvideo'];
  var WIDE_MODES = ['off', 'wide', 'fill'];
  var THEMES = ['off', 'black'];
  var WHEEL_MODES = ['off', 'vol', 'speed', 'seek'];

  var SPEED_MIN = 0.07, SPEED_MAX = 16;   /* 16 is Chrome's own ceiling for playbackRate */
  var GAIN_MAX = 5;                        /* deliberately not 10 — see GAIN_SAFE */
  var GAIN_SAFE = 3;                       /* above this, the value is not restored next session */
  var BASS_MAX = 15;                       /* dB, lowshelf */

  /* Every action a keyboard shortcut or the wheel can trigger. The panel offers
   * exactly this list, and a combo that does not name one of these is discarded. */
  var KEY_ACTIONS = ['speedUp', 'speedDown', 'speedReset', 'shot', 'cinema', 'pip', 'wide', 'abA', 'abB', 'abClear'];
  var DEFAULT_KEYS = {
    speedUp: 'alt+ctrl+ArrowUp', speedDown: 'alt+ctrl+ArrowDown', speedReset: 'alt+ctrl+Digit0',
    shot: 'alt+ctrl+KeyS', cinema: 'alt+ctrl+KeyC', pip: 'alt+ctrl+KeyP', wide: 'alt+ctrl+KeyW',
    abA: 'alt+ctrl+BracketLeft', abB: 'alt+ctrl+BracketRight', abClear: 'alt+ctrl+Backslash'
  };
  /* A combo MUST carry a modifier. Without that rule a user can bind `k` or `Space`
   * and silently break YouTube's own keys with no way to tell what happened. */
  var COMBO_RE = /^(?:(?:alt|ctrl|shift|meta)\+){1,4}(?:Key[A-Z]|Digit[0-9]|F[1-9][0-2]?|Arrow(?:Up|Down|Left|Right)|Bracket(?:Left|Right)|Backslash|Semicolon|Quote|Comma|Period|Slash|Minus|Equal|Backquote|Space|Enter|Home|End|PageUp|PageDown)$/;

  var DEFAULTS = {
    ytp_on: true,
    ytp_speed: 1,
    ytp_quality: 'auto',
    ytp_gain: 1,
    ytp_bass: 0,
    ytp_loop: false,
    ytp_no_autonext: false,
    ytp_no_autoplay: false,
    ytp_hide_endscreen: false,
    ytp_hide_cards: false,
    ytp_hide_related: false,
    ytp_hide_comments: false,
    ytp_hide_chat: false,
    ytp_hide_home_feed: false,
    ytp_shorts: 'off',
    /* ---- appearance (v0.73.0) ---- */
    ytp_cinema: false,
    ytp_cinema_dim: 70,
    ytp_wide: 'off',
    ytp_pin: false,
    ytp_bright: 100,
    ytp_contrast: 100,
    ytp_sat: 100,
    ytp_theme: 'off',
    ytp_accent: '',
    /* ---- extras (v0.73.0) ---- */
    ytp_reverse: false,
    /* The only feature in this file that is ON by default (v0.131.0). Every other
     * one is neutral so a fresh install changes nothing about YouTube — but this
     * button exists PRECISELY to remove the trip to the panel, and shipping it off
     * would make the user open that panel once per profile to get rid of it. It
     * adds one button beside YouTube's own and removes it again from the panel. */
    ytp_pipbtn: true,
    ytp_keys: true,
    ytp_keys_map: null,
    ytp_wheel: 'off'
  };

  var st = {};
  Object.keys(DEFAULTS).forEach(function (k) { st[k] = DEFAULTS[k]; });

  function num(v, lo, hi, dflt) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, n));
  }
  function bool(v) { return v === true; }
  function pick(v, list, dflt) { return list.indexOf(v) >= 0 ? v : dflt; }

  /* ---- selectors ----
   * ALL of YouTube's DOM contracts live here, in one constant, on purpose: they are
   * private class names that YouTube renames whenever it likes, and there is no
   * stable alternative. When one rots, the fix is one line in this object — and
   * because each key is an independent switch, a rotten selector disables ITS OWN
   * feature and nothing else. */
  var SEL = {
    endscreen: '.ytp-ce-element,.ytp-endscreen-content,.html5-endscreen,.ytp-ce-covering-overlay,.ytp-ce-element-shadow',
    cards: '.ytp-cards-teaser,.ytp-cards-button,.ytp-cards-teaser-box,.iv-drawer,.annotation,.ytp-suggested-action',
    /* #secondary is NOT used: live chat lives in the same column, and hiding a
     * conversation the user did not ask to hide is worse than leaving one shelf. */
    related: '#related,ytd-watch-next-secondary-results-renderer',
    comments: '#comments,ytd-comments#comments',
    chat: '#chat,#chat-container,ytd-live-chat-frame',
    home: 'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer',
    /* The player's own right-hand control group (settings · theater · fullscreen).
     * Our PiP button is planted at its head. If YouTube renames it, applyPipBtn
     * finds nothing and returns — the button disappears and NOTHING else changes. */
    rctl: '.ytp-right-controls',
    shorts: 'ytd-reel-shelf-renderer,ytd-rich-shelf-renderer[is-shorts],grid-shelf-view-model,' +
            'ytd-guide-entry-renderer:has(a[href^="/shorts"]),ytd-mini-guide-entry-renderer:has(a[href^="/shorts"]),' +
            'ytd-rich-item-renderer:has(a[href^="/shorts/"]),ytd-video-renderer:has(a[href^="/shorts/"])'
  };

  /* ---- appearance rule blocks (v0.73.0) ----
   * Fixed strings, chosen by a boolean or by an enum that was already validated
   * against its whitelist. Nothing the user typed is ever concatenated in here —
   * the one place a user value affects the sheet is the accent colour, and that is
   * REBUILT from three parsed integers rather than pasted (see accentCss). */
  var LOOK = {
    /* Cinema lifts the player above the dim veil. The veil itself is a separate
     * element (dimEl) because its opacity is a number, not a rule. */
    cinema: 'ytd-watch-flexy #player,ytd-watch-flexy #player-container-outer{position:relative!important;z-index:2147483001!important}',

    /* Wide: theater mode stretched to the window, and the normal-mode column
     * released from its max-width. */
    wide: 'ytd-watch-flexy[theater]:not([fullscreen]) #player-theater-container.ytd-watch-flexy{max-height:none!important;height:calc(100vh - 56px)!important}' +
          'ytd-watch-flexy:not([theater]):not([fullscreen]) #primary.ytd-watch-flexy{max-width:none!important}',

    /* Fill: the player covers the window WITHOUT entering fullscreen. YouTube's own
     * sizer writes width/height/left/top inline on the <video>, so the override has
     * to reach the element too — otherwise the frame sits small inside a black box. */
    fill: '#movie_player{position:fixed!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;z-index:2147483001!important;background:#000!important}' +
          '#movie_player video.html5-main-video{width:100%!important;height:100%!important;left:0!important;top:0!important;object-fit:contain!important}',

    /* Pin is armed by CSS but ACTIVATED by an attribute the scroll handler sets, so
     * the player only detaches once it has actually left the viewport. */
    pin: 'html[data-syfs-ytp-pinned] #movie_player{position:fixed!important;bottom:14px!important;right:14px!important;top:auto!important;left:auto!important;width:400px!important;height:225px!important;z-index:2147483001!important;box-shadow:0 8px 30px rgba(0,0,0,.5);border-radius:10px;overflow:hidden}' +
         'html[data-syfs-ytp-pinned] #movie_player video.html5-main-video{width:100%!important;height:100%!important;left:0!important;top:0!important;object-fit:contain!important}',

    /* A true-black variant of YouTube's own dark theme (OLED). It only overrides
     * YouTube's design tokens under html[dark] — it does NOT force dark mode on,
     * because flipping the site's theme from underneath the user is not ours to do. */
    black: 'html[dark]{--yt-spec-base-background:#000!important;--yt-spec-raised-background:#0a0a0a!important;' +
           '--yt-spec-menu-background:#0a0a0a!important;--yt-spec-general-background-a:#000!important;' +
           '--yt-spec-general-background-b:#000!important;--yt-spec-general-background-c:#050505!important}' +
           'html[dark] ytd-app,html[dark] #masthead-container{background:#000!important}'
  };

  /* The accent is the ONLY user-supplied value that reaches the stylesheet, so it is
   * not merely validated — it is discarded and rebuilt from the three integers the
   * pattern captured. Nothing the user typed survives into the rule text. */
  function accentCss() {
    var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(st.ytp_accent || '');
    if (!m) return '';
    var rgb = 'rgb(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ')';
    return '.ytp-play-progress,.ytp-scrubber-button,.ytp-swatch-background-color,' +
           '.ytp-volume-slider-handle::before,.ytp-volume-slider-handle::after' +
           '{background-color:' + rgb + '!important}';
  }

  /* ---- injected CSS ----
   * Built from BOOLEANS and validated ENUMS only (plus the rebuilt accent above). */
  var styleEl = null;
  function css() {
    var parts = [], out = '';
    if (st.ytp_hide_endscreen) parts.push(SEL.endscreen);
    if (st.ytp_hide_cards) parts.push(SEL.cards);
    if (st.ytp_hide_related) parts.push(SEL.related);
    if (st.ytp_hide_comments) parts.push(SEL.comments);
    if (st.ytp_hide_chat) parts.push(SEL.chat);
    if (st.ytp_hide_home_feed) parts.push(SEL.home);
    if (st.ytp_shorts === 'hide') parts.push(SEL.shorts);
    if (parts.length) out += parts.join(',') + '{display:none!important;}';

    if (st.ytp_cinema && isWatch()) out += LOOK.cinema;
    if (isWatch()) {
      /* `wide` only stretches layout CONTAINERS, so it coexists with pin happily.
       * `fill` is the one that fixes #movie_player to the viewport, and two rules
       * fixing the same element to different coordinates would fight — so fill and
       * pin are the only genuinely exclusive pair, and fill wins. */
      if (st.ytp_wide === 'wide') out += LOOK.wide;
      else if (st.ytp_wide === 'fill') out += LOOK.fill;
      if (st.ytp_pin && st.ytp_wide !== 'fill') out += LOOK.pin;
    }
    if (st.ytp_theme === 'black') out += LOOK.black;
    out += accentCss();
    return out;
  }
  function applyCss() {
    var text = st.ytp_on ? css() : '';
    if (!text) { if (styleEl && styleEl.isConnected) styleEl.remove(); return; }
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'syfs-ytp-css'; }
    if (styleEl.textContent !== text) styleEl.textContent = text;
    if (!styleEl.isConnected) htmlEl.appendChild(styleEl);
  }

  /* ---- player helpers ---- */
  function player() { return document.getElementById('movie_player') || document.querySelector('.html5-video-player'); }
  function video() { return document.querySelector('#movie_player video, video.html5-main-video'); }
  function isWatch() { return location.pathname.indexOf('/watch') === 0; }
  function adOn() {
    var p = player();
    return !!p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'));
  }
  function videoId() {
    var q = /[?&]v=([\w-]{6,20})/.exec(location.search);
    if (q) return q[1];
    var p = /^\/(?:shorts|embed)\/([\w-]{6,20})/.exec(location.pathname);
    return p ? p[1] : '';
  }

  /* ---- playback speed ----
   * Applied only when it differs from 1: at 1 we stay out of the way entirely, so
   * YouTube's own remembered speed and the user's manual menu choice both survive. */
  function applySpeed() {
    if (!st.ytp_on || st.ytp_speed === 1) return;
    if (adOn()) return;                       /* let yt-guard's 16x skip do its job */
    var v = video();
    if (!v) return;
    try { if (v.playbackRate !== st.ytp_speed) v.playbackRate = st.ytp_speed; } catch (e) {}
  }

  /* ---- quality ----
   * The player API is not reachable from this world, so the value is mirrored onto
   * <html> for src/yt-plus-main.js, which the worker registers into the MAIN world
   * only while a real quality is selected. The attribute is the initial handshake
   * (readable synchronously at document_start); the event carries later changes. */
  function pushQuality() {
    var q = st.ytp_on ? st.ytp_quality : 'auto';
    try {
      if (q === 'auto') htmlEl.removeAttribute('data-syfs-ytq');
      else htmlEl.setAttribute('data-syfs-ytq', q);
    } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('syfs-ytp-quality', { detail: { q: q } })); } catch (e) {}
  }

  /* ---- audio boost ----
   * createMediaElementSource is IRREVERSIBLE: once an element is routed through a
   * graph, its audio never goes back to the browser's direct path for the life of
   * the page. A broken graph therefore means TOTAL SILENCE, not "no boost". Hence:
   *   • the AudioContext is not created at all until the user asks for >1x or bass,
   *   • an element is bound at most once (a second call on the same element throws),
   *   • returning to 1x leaves the graph in place at unity gain — transparent,
   *   • any failure is swallowed and we simply never touch the audio again. */
  var actx = null, gainNode = null, bassNode = null;
  var bound = (typeof WeakSet === 'function') ? new WeakSet() : null;
  var audioDead = false;

  function audioWanted() { return st.ytp_on && (st.ytp_gain > 1 || st.ytp_bass > 0); }

  function ensureAudio() {
    if (audioDead) return false;
    var v = video();
    if (!v) return false;
    if (bound && bound.has(v)) return !!gainNode;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { audioDead = true; return false; }
    try {
      if (!actx) actx = new Ctx();
      var src = actx.createMediaElementSource(v);
      bassNode = actx.createBiquadFilter();
      bassNode.type = 'lowshelf';
      bassNode.frequency.value = 200;
      bassNode.gain.value = 0;
      gainNode = actx.createGain();
      gainNode.gain.value = 1;
      /* a limiter LAST in the chain. A video mastered near full scale, boosted 3× with
         +15 dB of bass, goes far past 1.0 and the output hard-clips — loud crackle, not
         loud sound. A fast, steep compressor just under 0 dBFS turns those peaks down
         instead of squaring them off; below the threshold it does nothing, so 1× stays
         transparent (rule 4: the graph is never torn down). */
      var limiter = actx.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.1;
      src.connect(bassNode);
      bassNode.connect(gainNode);
      gainNode.connect(limiter);
      limiter.connect(actx.destination);
      if (bound) bound.add(v);
      armResume();
      return true;
    } catch (e) {
      /* Element already routed elsewhere, or the context was refused. Leaving the
       * flag set means we never try again on this page — retrying is how you end up
       * with a half-built graph and no sound at all. */
      audioDead = true;
      return false;
    }
  }

  /* Autoplay policy can start the context suspended; it may only resume inside a
   * user gesture. Listeners are one-shot and passive. */
  var resumeArmed = false;
  function armResume() {
    if (resumeArmed || !actx) return;
    resumeArmed = true;
    var go = function () {
      try { if (actx && actx.state === 'suspended') actx.resume(); } catch (e) {}
    };
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
      document.addEventListener(ev, go, { passive: true });
    });
    go();
  }

  function applyAudio() {
    if (!audioWanted()) {
      if (gainNode) { try { gainNode.gain.value = 1; } catch (e) {} }
      if (bassNode) { try { bassNode.gain.value = 0; } catch (e) {} }
      return;
    }
    if (!ensureAudio()) return;
    try { gainNode.gain.value = st.ytp_gain; } catch (e) {}
    try { bassNode.gain.value = st.ytp_bass; } catch (e) {}
    try { if (actx && actx.state === 'suspended') actx.resume(); } catch (e) {}
  }

  /* ---- loop + A→B ----
   * A/B lives in memory only, for the length of one video: it is a scrubbing aid,
   * not a preference, and persisting it would mean persisting a video id. */
  var abA = null, abB = null;
  var loopOwned = false;   /* did WE set video.loop? */

  /* Never write `loop = false` unless we are the ones who wrote `true`: YouTube has
   * its own "Loop" item in the player's context menu, and clearing a flag the user
   * set there would look like the extension randomly cancelling their choice. */
  function applyLoop() {
    var v = video();
    if (!v) return;
    var want = st.ytp_on && st.ytp_loop && abA === null;
    if (!want && !loopOwned) return;
    try { if (v.loop !== want) v.loop = want; } catch (e) {}
    loopOwned = want;
  }

  function onTimeUpdate() {
    if (!st.ytp_on || abA === null || abB === null) return;
    var v = video();
    if (!v) return;
    try { if (v.currentTime >= abB) v.currentTime = abA; } catch (e) {}
  }

  /* ---- autoplay ----
   * "Do not start on open" arms once per navigation and pauses the FIRST play only,
   * so the user's own press of play is never fought. */
  var pauseArmed = false;
  function onPlay() {
    if (!st.ytp_on || !st.ytp_no_autoplay || !pauseArmed) return;
    pauseArmed = false;
    if (adOn()) return;
    var v = video();
    if (!v) return;
    try { v.pause(); } catch (e) {}
  }

  /* "Do not roll into the next video" flips YouTube's OWN autoplay switch, which is
   * visible to the user and survives us being uninstalled — deliberately preferred
   * over silently cancelling the countdown from the outside. */
  function applyAutoNext(force) {
    if (!st.ytp_on || (!st.ytp_no_autonext && !force)) return;
    var btn = document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
    if (!btn) return;
    try { btn.click(); } catch (e) {}
  }

  /* ================= appearance (v0.73.0) ================= */

  /* Cinema veil. Its opacity is a NUMBER, so it cannot live in the rule text with
   * the rest — it is an element whose style is assigned a clamped float.
   * pointer-events:none so the dimmed page stays fully clickable underneath. */
  var dimEl = null;
  function applyCinema() {
    var want = st.ytp_on && st.ytp_cinema && isWatch();
    if (!want) { if (dimEl && dimEl.isConnected) dimEl.remove(); return; }
    if (!dimEl) {
      dimEl = document.createElement('div');
      dimEl.id = 'syfs-ytp-dim';
      dimEl.style.position = 'fixed';
      dimEl.style.top = dimEl.style.left = dimEl.style.right = dimEl.style.bottom = '0';
      dimEl.style.pointerEvents = 'none';
      /* below the SYF rail (2147483646) so the toolbox is never dimmed by us */
      dimEl.style.zIndex = '2147483000';
    }
    dimEl.style.background = 'rgba(0,0,0,' + (num(st.ytp_cinema_dim, 0, 95, 70) / 100) + ')';
    if (!dimEl.isConnected && document.body) document.body.appendChild(dimEl);
  }

  /* Filters go on the element inline rather than into the stylesheet: it keeps the
   * numbers out of the rule text, and it is trivially reversible. Same discipline as
   * video.loop — we only clear what we set. */
  var filterOwned = false;
  function filterStr() {
    var b = num(st.ytp_bright, 50, 200, 100), c = num(st.ytp_contrast, 50, 200, 100), s = num(st.ytp_sat, 0, 300, 100);
    if (b === 100 && c === 100 && s === 100) return '';
    return 'brightness(' + (b / 100) + ') contrast(' + (c / 100) + ') saturate(' + (s / 100) + ')';
  }
  function applyFilters() {
    var v = video();
    if (!v) return;
    var f = st.ytp_on ? filterStr() : '';
    if (!f && !filterOwned) return;
    try { v.style.filter = f; } catch (e) { return; }
    filterOwned = !!f;
  }

  /* Pin: the player detaches only once it has actually scrolled out of view. The
   * decision is an attribute on <html>; the geometry is in LOOK.pin. Suppressed
   * while filling the window or while the video is in Picture-in-Picture, because
   * all three want to own the player's position. */
  function applyPin() {
    var on = false;
    if (st.ytp_on && st.ytp_pin && isWatch() && st.ytp_wide !== 'fill' && !document.pictureInPictureElement) {
      var host = document.querySelector('ytd-watch-flexy #player') || player();
      if (host) {
        var r;
        try { r = host.getBoundingClientRect(); } catch (e) { r = null; }
        if (r && r.bottom < 80) on = true;
      }
    }
    try {
      if (on) htmlEl.setAttribute('data-syfs-ytp-pinned', '1');
      else htmlEl.removeAttribute('data-syfs-ytp-pinned');
    } catch (e) {}
  }

  /* ---- on-screen readout for wheel / shortcut changes ----
   * Text is set with textContent and every message is built from internal literals
   * plus a number. Nothing from the page is echoed back into it. */
  var osdEl = null, osdTimer = 0;
  function osd(text) {
    var p = player();
    if (!p) return;
    if (!osdEl) {
      osdEl = document.createElement('div');
      osdEl.id = 'syfs-ytp-osd';
      osdEl.style.cssText = 'position:absolute;top:14px;left:14px;padding:6px 12px;border-radius:8px;' +
        'background:rgba(0,0,0,.75);color:#fff;font:600 15px/1.2 system-ui,sans-serif;' +
        'z-index:2147483002;pointer-events:none;direction:ltr';
    }
    osdEl.textContent = text;
    if (osdEl.parentNode !== p) { try { p.appendChild(osdEl); } catch (e) { return; } }
    osdEl.style.display = 'block';
    if (osdTimer) clearTimeout(osdTimer);
    osdTimer = setTimeout(function () { if (osdEl) osdEl.style.display = 'none'; }, 900); // eslint-disable-line
  }

  /* ================= extras (v0.73.0) ================= */

  /* Frame grab at the video's OWN resolution, not the displayed size. The canvas is
   * not tainted: YouTube's media is a same-origin MSE blob. If a future change ever
   * taints it, toBlob throws SecurityError and we say so rather than saving a blank
   * image. The blob URL is revoked and the frame is never stored anywhere. */
  function shot(cb) {
    var v = video();
    if (!v) return cb({ ok: false, err: 'no-video' });
    var w = v.videoWidth | 0, h = v.videoHeight | 0;
    if (!w || !h) return cb({ ok: false, err: 'not-ready' });
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    try { c.getContext('2d').drawImage(v, 0, 0, w, h); }
    catch (e) { return cb({ ok: false, err: 'draw' }); }
    try {
      c.toBlob(function (blob) {
        if (!blob) return cb({ ok: false, err: 'encode' });
        cb({ ok: true, blob: blob, w: w, h: h });
      }, 'image/png');
    } catch (e) { cb({ ok: false, err: 'tainted' }); }
  }

  function shotName() {
    var v = video(), t = v ? Math.floor(v.currentTime || 0) : 0;
    var mm = Math.floor(t / 60), ss = t % 60;
    var id = videoId();
    return 'youtube' + (id ? '-' + id : '') + '-' + mm + 'm' + (ss < 10 ? '0' : '') + ss + 's.png';
  }

  /* Saved through an <a download> + blob URL — deliberately NOT chrome.downloads,
   * which is stripped from the public build. */
  function shotSave(cb) {
    shot(function (r) {
      if (!r.ok) return cb(r);
      var url;
      try { url = URL.createObjectURL(r.blob); } catch (e) { return cb({ ok: false, err: 'url' }); }
      try {
        var a = document.createElement('a');
        a.href = url; a.download = shotName();
        a.style.display = 'none';
        (document.body || htmlEl).appendChild(a);
        a.click();
        a.remove();
      } catch (e) { /* fall through — the URL is revoked either way */ }
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 4000); // eslint-disable-line
      cb({ ok: true, w: r.w, h: r.h });
    });
  }

  function shotCopy(cb) {
    shot(function (r) {
      if (!r.ok) return cb(r);
      if (!navigator.clipboard || typeof ClipboardItem === 'undefined' || !navigator.clipboard.write) {
        return cb({ ok: false, err: 'no-clipboard' });
      }
      try {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': r.blob })])
          .then(function () { cb({ ok: true, w: r.w, h: r.h }); })
          .catch(function () { cb({ ok: false, err: 'clipboard' }); });
      } catch (e) { cb({ ok: false, err: 'clipboard' }); }
    });
  }

  /* Native Picture-in-Picture. YouTube marks its own <video> disablePictureInPicture
   * to steer users into its miniplayer; we clear that attribute because the user
   * explicitly asked for a floating window. Costs no permission. */
  function pip() {
    var v = video();
    if (!v) return false;
    try {
      if (document.pictureInPictureElement) { document.exitPictureInPicture(); return true; }
      if (!document.pictureInPictureEnabled) return false;
      try { v.removeAttribute('disablepictureinpicture'); v.disablePictureInPicture = false; } catch (e) {}
      v.requestPictureInPicture().catch(function () {});
      return true;
    } catch (e) { return false; }
  }

  /* ---- the PiP button inside YouTube's own control bar (v0.131.0) ----
   * Until now the floating window was reachable only through the rail: open the
   * rail → open «يوتيوب+» → «إضافات» → click. Four gestures, on every single video,
   * for one action — which is exactly the complaint that produced this block.
   * The button is planted at the head of YouTube's right-hand control group because
   * that strip is the one place on a watch page that is always over the video,
   * already has 48px targets, and fades with the controls. We add a node beside
   * YouTube's buttons; we never touch, reorder or restyle theirs.
   *
   * The label goes through T() so it follows the extension's language. The icon is
   * built with createElementNS — no innerHTML anywhere in the host page, not even
   * for a constant of ours (§8: nothing this file writes into YouTube's DOM is
   * parsed as markup, so no future edit can turn it into an injection). */
  function T(s) {
    /* i18n-via: T — src/i18n.js lands at document_idle in this same isolated world,
       long before a click; before then the Arabic source text is the fallback. */
    try { return (window.SYFS && typeof SYFS.t === 'function') ? SYFS.t(s) : s; } catch (e) { return s; }
  }

  var SVGNS = 'http://www.w3.org/2000/svg';
  function pipIcon() {
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 36 36');
    svg.setAttribute('height', '100%');
    svg.setAttribute('width', '100%');
    svg.setAttribute('aria-hidden', 'true');
    var frame = document.createElementNS(SVGNS, 'rect');
    frame.setAttribute('x', '7'); frame.setAttribute('y', '9.5');
    frame.setAttribute('width', '22'); frame.setAttribute('height', '17');
    frame.setAttribute('rx', '2');
    frame.setAttribute('fill', 'none');
    frame.setAttribute('stroke', '#fff');
    frame.setAttribute('stroke-width', '2');
    var win = document.createElementNS(SVGNS, 'rect');
    win.setAttribute('x', '17.5'); win.setAttribute('y', '17');
    win.setAttribute('width', '10'); win.setAttribute('height', '8');
    win.setAttribute('rx', '1.5');
    win.setAttribute('fill', '#fff');
    svg.appendChild(frame); svg.appendChild(win);
    return svg;
  }

  var pipEl = null;
  function pipLabel() {
    return document.pictureInPictureElement
      ? T('إغلاق النافذة العائمة')
      : T('نافذة عائمة (PiP)');
  }
  function syncPipBtn() {
    if (!pipEl) return;
    var on = !!document.pictureInPictureElement;
    var label = pipLabel();
    pipEl.setAttribute('aria-pressed', on ? 'true' : 'false');
    pipEl.setAttribute('aria-label', label);
    pipEl.setAttribute('title', label);
    pipEl.style.opacity = on ? '1' : '';
  }
  function buildPipBtn() {
    var b = document.createElement('button');
    b.id = 'syfs-ytp-pipbtn';
    /* YouTube's own button class — size, hover and the control-bar fade come with
     * it. A button that does not match its neighbours reads as a broken page. */
    b.className = 'ytp-button';
    b.type = 'button';
    b.appendChild(pipIcon());
    b.addEventListener('click', function (e) {
      /* The control strip turns a stray click into play/pause, and YouTube listens
       * on the bubble — so the event stops here. */
      e.preventDefault();
      e.stopPropagation();
      if (!pip()) osd('✕');
      /* the real state arrives on enter/leavepictureinpicture; this is only for the
         case where the browser refused and no event will ever come */
      setTimeout(syncPipBtn, 300); // eslint-disable-line
    });
    return b;
  }
  function applyPipBtn() {
    var want = st.ytp_on && st.ytp_pipbtn && !!video() && !!document.pictureInPictureEnabled;
    if (!want) {
      if (pipEl && pipEl.parentNode) { try { pipEl.parentNode.removeChild(pipEl); } catch (e) {} }
      return;
    }
    var bar = document.querySelector(SEL.rctl);
    if (!bar) return;
    if (!pipEl) pipEl = buildPipBtn();
    if (pipEl.parentNode !== bar) {
      try { bar.insertBefore(pipEl, bar.firstChild); } catch (e) { return; }
    }
    syncPipBtn();
  }

  /* ---- reverse playlist ----
   * Walks the playlist panel backwards. Only ever acts on a real playlist page, and
   * only by clicking a link that is already on the page — no URL is constructed. */
  function playlistStep(back) {
    if (!/[?&]list=/.test(location.search)) return false;
    var items = document.querySelectorAll('ytd-playlist-panel-video-renderer');
    if (!items.length) return false;
    var idx = -1;
    for (var i = 0; i < items.length; i++) {
      if (items[i].hasAttribute('selected') || items[i].getAttribute('aria-selected') === 'true') { idx = i; break; }
    }
    if (idx < 0) return false;
    var next = back ? idx - 1 : idx + 1;
    if (next < 0 || next >= items.length) return false;
    var a = items[next].querySelector('a#wc-endpoint, a#thumbnail, a');
    if (!a) return false;
    try { a.click(); } catch (e) { return false; }
    return true;
  }

  function onEnded() {
    if (!st.ytp_on || !st.ytp_reverse) return;
    playlistStep(true);
  }

  /* ---- keyboard shortcuts ----
   * Combos are built from event.code, not event.key: `key` changes with the layout,
   * so an Arabic keyboard would silently lose every letter binding. */
  function comboOf(e) {
    if (!e.code) return '';
    var mods = '';
    if (e.altKey) mods += 'alt+';
    if (e.ctrlKey) mods += 'ctrl+';
    if (e.shiftKey) mods += 'shift+';
    if (e.metaKey) mods += 'meta+';
    if (!mods) return '';                    /* a bare key is never ours — see COMBO_RE */
    return mods + e.code;
  }

  function keyMap() {
    var m = {}, src = st.ytp_keys_map || {};
    for (var i = 0; i < KEY_ACTIONS.length; i++) {
      var a = KEY_ACTIONS[i];
      var c = typeof src[a] === 'string' && COMBO_RE.test(src[a]) ? src[a] : DEFAULT_KEYS[a];
      m[c] = a;                               /* last writer wins on a duplicate combo */
    }
    return m;
  }

  function bumpSpeed(delta) {
    var v = video();
    if (!v) return;
    var r = num((v.playbackRate || 1) + delta, SPEED_MIN, SPEED_MAX, 1);
    try { v.playbackRate = r; } catch (e) { return; }
    osd(Math.round(r * 100) / 100 + 'x');
  }

  function runAction(a) {
    var v = video();
    if (a === 'speedUp') return bumpSpeed(0.25);
    if (a === 'speedDown') return bumpSpeed(-0.25);
    if (a === 'speedReset') { if (v) { try { v.playbackRate = st.ytp_speed; } catch (e) {} osd(st.ytp_speed + 'x'); } return; }
    if (a === 'shot') { shotSave(function (r) { osd(r.ok ? '📸' : '✕'); }); return; }
    if (a === 'cinema') { st.ytp_cinema = !st.ytp_cinema; save('ytp_cinema', st.ytp_cinema); applyCinema(); applyCss(); return; }
    if (a === 'pip') { pip(); return; }
    if (a === 'wide') {
      var order = ['off', 'wide', 'fill'];
      st.ytp_wide = order[(order.indexOf(st.ytp_wide) + 1) % 3];
      save('ytp_wide', st.ytp_wide); applyCss(); osd(st.ytp_wide);
      return;
    }
    if (a === 'abA') { if (v) { abA = v.currentTime; abB = null; osd('A'); } return; }
    if (a === 'abB') { if (v && abA !== null) { api.setAB(abA, v.currentTime); osd('A→B'); } return; }
    if (a === 'abClear') { abA = abB = null; applyLoop(); osd('—'); return; }
  }

  function save(k, v) {
    var o = {}; o[k] = v;
    try { chrome.storage.local.set(o); } catch (e) {}
  }

  /* Capture phase so we get the key before YouTube's own handler, but we only ever
   * swallow an event we actually claimed. Typing is never intercepted: any editable
   * target — including one inside a shadow root, which is why composedPath is used —
   * passes straight through, and so does anything inside the SYF rail itself. */
  function editableTarget(e) {
    var path = (typeof e.composedPath === 'function') ? e.composedPath() : [e.target];
    for (var i = 0; i < path.length; i++) {
      var n = path[i];
      if (!n || n.nodeType !== 1) continue;
      if (n.id === 'syfs-host') return true;             /* our own panel */
      if (n.isContentEditable) return true;
      var tag = n.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    }
    return false;
  }

  function onKey(e) {
    if (!st.ytp_on || !st.ytp_keys) return;
    if (e.repeat || editableTarget(e)) return;
    var combo = comboOf(e);
    if (!combo) return;
    var a = keyMap()[combo];
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    runAction(a);
  }

  /* ---- mouse wheel over the player ----
   * OFF by default. Hijacking the wheel is hostile unless it was asked for: the page
   * stops scrolling where the user expects it to. preventDefault only fires on an
   * event we actually consumed. */
  var wheelOn = null;
  function onWheel(e) {
    if (!st.ytp_on || st.ytp_wheel === 'off') return;
    var v = video();
    if (!v) return;
    var dir = e.deltaY < 0 ? 1 : -1;
    if (st.ytp_wheel === 'vol') {
      var vol = Math.min(1, Math.max(0, (v.volume || 0) + dir * 0.05));
      try { v.volume = vol; if (vol > 0) v.muted = false; } catch (err) { return; }
      osd(Math.round(vol * 100) + '%');
    } else if (st.ytp_wheel === 'speed') {
      bumpSpeed(dir * 0.25);
    } else if (st.ytp_wheel === 'seek') {
      if (!isFinite(v.duration)) return;
      try { v.currentTime = num(v.currentTime + dir * 5, 0, v.duration, 0); } catch (err) { return; }
      osd((dir > 0 ? '+' : '−') + '5s');
    } else { return; }
    e.preventDefault();
  }
  function wireWheel() {
    var p = player();
    if (!p || p === wheelOn) return;
    wheelOn = p;
    try { p.addEventListener('wheel', onWheel, { passive: false }); } catch (e) { wheelOn = null; }
  }

  /* ---- Shorts as a normal video ----
   * The id is extracted from our OWN location by a strict pattern and the
   * destination is built from a fixed literal — the page never supplies a URL.
   * replace() rather than assign() so Back does not bounce into the loop. */
  function shortsRedirect() {
    if (!st.ytp_on || st.ytp_shorts !== 'asvideo') return false;
    var m = /^\/shorts\/([\w-]{6,20})\/?$/.exec(location.pathname);
    if (!m) return false;
    try { location.replace('https://www.youtube.com/watch?v=' + m[1]); } catch (e) { return false; }
    return true;
  }

  /* ---- element wiring — once per <video>, YouTube reuses one across SPA hops ---- */
  var wired = (typeof WeakSet === 'function') ? new WeakSet() : null;
  function wireVideo() {
    var v = video();
    if (!v || (wired && wired.has(v))) return;
    if (wired) wired.add(v);
    v.addEventListener('loadedmetadata', function () { applySpeed(); applyLoop(); }, { passive: true });
    v.addEventListener('ratechange', function () {
      /* Someone (YouTube's menu, or yt-guard restoring after an ad) moved the rate.
       * Re-assert only when we are NOT on an ad and the value drifted back to 1 —
       * any other value is the user choosing, and we leave it alone. */
      if (st.ytp_speed !== 1 && !adOn()) {
        var vv = video();
        try { if (vv && vv.playbackRate === 1) vv.playbackRate = st.ytp_speed; } catch (e) {}
      }
    }, { passive: true });
    v.addEventListener('timeupdate', onTimeUpdate, { passive: true });
    v.addEventListener('play', onPlay, { passive: true });
    v.addEventListener('ended', onEnded, { passive: true });
    v.addEventListener('enterpictureinpicture', function () { applyPin(); syncPipBtn(); }, { passive: true });
    v.addEventListener('leavepictureinpicture', function () { applyPin(); syncPipBtn(); }, { passive: true });
    /* The element can be created — and can start playing — before we ever see it,
     * so the 'play' listener alone would miss a cold autoplay. Treat "already
     * playing, barely started" as the play we were waiting for. */
    if (!v.paused && v.currentTime < 3) onPlay();
    applySpeed(); applyLoop(); applyAudio();
  }

  /* Watch #movie_player's class list: the moment `ad-showing` leaves, yt-guard has
   * just reset playbackRate to 1 and our default must go back on. */
  var adObs = null, watchedPlayer = null;
  function watchAdClass() {
    var p = player();
    if (!p || p === watchedPlayer) return;
    watchedPlayer = p;
    if (adObs) { try { adObs.disconnect(); } catch (e) {} }
    try {
      adObs = new MutationObserver(function () { if (!adOn()) { applySpeed(); applyAudio(); } });
      adObs.observe(p, { attributes: true, attributeFilter: ['class'] });
    } catch (e) { adObs = null; }
  }

  /* ---- page-level scan, throttled ---- */
  var scanTimer = 0;
  function scan() {
    wireVideo();
    watchAdClass();
    wireWheel();
    applySpeed();
    applyLoop();
    applyAudio();
    applyAutoNext();
    reconcileReverse();
    applyCinema();
    applyFilters();
    applyPin();
    applyPipBtn();
  }
  function scanSoon() {
    if (scanTimer) return;
    scanTimer = setTimeout(function () { scanTimer = 0; scan(); }, 250);
  }

  /* A bounded settle poll. YouTube builds the player asynchronously and does not
   * always fire a navigation event we can hear (a cold /watch load, a Shorts→watch
   * hop, a slow hydration). 20 one-second ticks covers that without leaving a timer
   * running for the life of the tab; each navigation re-arms it. */
  var pollLeft = 0, pollTimer = 0;
  function poll() {
    pollLeft = 20;                 /* re-arm, do not stack a second interval */
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      scan();
      if (--pollLeft <= 0) { clearInterval(pollTimer); pollTimer = 0; }
    }, 1000);
  }

  /* ---- SPA navigation ---- */
  function onNavigate() {
    abA = abB = null;
    pauseArmed = !!st.ytp_no_autoplay;
    watchedPlayer = null;
    if (shortsRedirect()) return;
    applyCss();
    pushQuality();
    scan();
    poll();
  }
  document.addEventListener('yt-navigate-finish', onNavigate, { passive: true });
  document.addEventListener('yt-page-data-updated', scanSoon, { passive: true });
  document.addEventListener('keydown', onKey, true);
  /* Pin is a scroll decision, so it needs the scroll — throttled to one frame. */
  var pinRaf = 0;
  window.addEventListener('scroll', function () {
    if (pinRaf) return;
    pinRaf = requestAnimationFrame(function () { pinRaf = 0; applyPin(); });
  }, { passive: true });

  /* ---- settings ---- */
  function adopt(raw) {
    st.ytp_on = raw.ytp_on !== false;
    st.ytp_speed = num(raw.ytp_speed, SPEED_MIN, SPEED_MAX, 1);
    st.ytp_quality = pick(raw.ytp_quality, QUALITIES, 'auto');
    st.ytp_gain = num(raw.ytp_gain, 1, GAIN_MAX, 1);
    st.ytp_bass = num(raw.ytp_bass, 0, BASS_MAX, 0);
    st.ytp_loop = bool(raw.ytp_loop);
    st.ytp_no_autonext = bool(raw.ytp_no_autonext);
    st.ytp_no_autoplay = bool(raw.ytp_no_autoplay);
    st.ytp_hide_endscreen = bool(raw.ytp_hide_endscreen);
    st.ytp_hide_cards = bool(raw.ytp_hide_cards);
    st.ytp_hide_related = bool(raw.ytp_hide_related);
    st.ytp_hide_comments = bool(raw.ytp_hide_comments);
    st.ytp_hide_chat = bool(raw.ytp_hide_chat);
    st.ytp_hide_home_feed = bool(raw.ytp_hide_home_feed);
    st.ytp_shorts = pick(raw.ytp_shorts, SHORTS_MODES, 'off');
    /* appearance */
    st.ytp_cinema = bool(raw.ytp_cinema);
    st.ytp_cinema_dim = num(raw.ytp_cinema_dim, 0, 95, 70);
    st.ytp_wide = pick(raw.ytp_wide, WIDE_MODES, 'off');
    st.ytp_pin = bool(raw.ytp_pin);
    st.ytp_bright = num(raw.ytp_bright, 50, 200, 100);
    st.ytp_contrast = num(raw.ytp_contrast, 50, 200, 100);
    st.ytp_sat = num(raw.ytp_sat, 0, 300, 100);
    st.ytp_theme = pick(raw.ytp_theme, THEMES, 'off');
    /* the accent is stored only if it is a full 6-digit hex; anything else becomes
     * "no accent" rather than a guessed colour */
    st.ytp_accent = (typeof raw.ytp_accent === 'string' && /^#[0-9a-f]{6}$/i.test(raw.ytp_accent)) ? raw.ytp_accent : '';
    /* extras */
    st.ytp_reverse = bool(raw.ytp_reverse);
    st.ytp_pipbtn = raw.ytp_pipbtn !== false;      /* on unless explicitly turned off */
    st.ytp_keys = raw.ytp_keys !== false;
    st.ytp_keys_map = (raw.ytp_keys_map && typeof raw.ytp_keys_map === 'object') ? raw.ytp_keys_map : null;
    st.ytp_wheel = pick(raw.ytp_wheel, WHEEL_MODES, 'off');
  }

  function load(first) {
    try {
      chrome.storage.local.get(DEFAULTS, function (raw) {
        if (chrome.runtime.lastError || !raw) return;
        adopt(raw);
        /* Session cap on the boost: a value above GAIN_SAFE is not carried into a
         * new page. Forgetting a 5x setting and putting headphones on the next day
         * is a real way to hurt someone; the write-back keeps the panel honest
         * instead of showing a number the engine is not using. */
        if (first && st.ytp_gain > GAIN_SAFE) {
          st.ytp_gain = GAIN_SAFE;
          try { chrome.storage.local.set({ ytp_gain: GAIN_SAFE }); } catch (e) {}
        }
        if (first) pauseArmed = !!st.ytp_no_autoplay;
        if (shortsRedirect()) return;
        applyCss();
        pushQuality();
        scan();
        if (first) poll();
      });
    } catch (e) {}
  }

  /* Reverse-playlist and YouTube's autoplay-next are mutually exclusive by nature:
   * if autonav is armed, YouTube jumps forward on `ended` before we can step back.
   * Rather than race it we turn its switch off, and the panel says we did. */
  function reconcileReverse() {
    if (st.ytp_on && st.ytp_reverse) applyAutoNext(true);
  }

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      var touched = false;
      for (var k in changes) { if (k.indexOf('ytp_') === 0) { touched = true; break; } }
      if (touched) load(false);
    });
  } catch (e) {}

  /* ---- API for the tool panel (src/ytplus.js) ----
   * Same isolated world, so this is a direct handle — no messaging. Exposes live
   * READINGS only; every persistent setting goes through chrome.storage so the
   * panel and the engine can never disagree about what is in effect. */
  window.SYFS = window.SYFS || {};
  var api = {
    ready: true,
    has: function () { return !!video(); },
    info: function () {
      var v = video();
      return {
        has: !!v,
        watch: isWatch(),
        playlist: /[?&]list=/.test(location.search),
        pip: !!document.pictureInPictureElement,
        time: v ? v.currentTime : 0,
        duration: v && isFinite(v.duration) ? v.duration : 0,
        rate: v ? v.playbackRate : 1,
        ad: adOn(),
        a: abA,
        b: abB,
        audio: !!gainNode,
        audioDead: audioDead
      };
    },
    /* A/B is clamped to the media's own timeline and ordered — a reversed or
     * out-of-range pair would strand the player outside the video. */
    setAB: function (a, b) {
      var v = video();
      if (!v || !isFinite(v.duration) || v.duration <= 0) return false;
      var lo = num(a, 0, v.duration, 0), hi = num(b, 0, v.duration, v.duration);
      if (hi - lo < 0.5) return false;
      abA = lo; abB = hi;
      applyLoop();
      try { if (v.currentTime < lo || v.currentTime > hi) v.currentTime = lo; } catch (e) {}
      return true;
    },
    clearAB: function () { abA = abB = null; applyLoop(); return true; },
    seek: function (t) {
      var v = video();
      if (!v || !isFinite(v.duration)) return false;
      try { v.currentTime = num(t, 0, v.duration, 0); } catch (e) { return false; }
      return true;
    },
    /* live nudge — persisted by the panel, applied here immediately */
    nudge: function (rate) {
      var v = video();
      if (!v) return false;
      try { v.playbackRate = num(rate, SPEED_MIN, SPEED_MAX, 1); } catch (e) { return false; }
      return true;
    },
    /* ---- v0.73.0 live actions. All are user-gesture driven from the panel, which
     * matters for two of them: the clipboard write and requestPictureInPicture both
     * require transient activation, and the panel click is that activation. ---- */
    shotSave: shotSave,
    shotCopy: shotCopy,
    pip: pip,
    prev: function () { return playlistStep(true); },
    next: function () { return playlistStep(false); },
    /* re-apply the look immediately after the panel writes a setting, so a slider
     * moves the picture as it is dragged instead of a beat later via storage */
    refresh: function () { applyCss(); applyCinema(); applyFilters(); applyPin(); },
    preview: function (o) {
      if (!o) return;
      if (typeof o.bright === 'number') st.ytp_bright = num(o.bright, 50, 200, 100);
      if (typeof o.contrast === 'number') st.ytp_contrast = num(o.contrast, 50, 200, 100);
      if (typeof o.sat === 'number') st.ytp_sat = num(o.sat, 0, 300, 100);
      if (typeof o.dim === 'number') st.ytp_cinema_dim = num(o.dim, 0, 95, 70);
      applyFilters(); applyCinema();
    },
    keyDefaults: DEFAULT_KEYS,
    keyActions: KEY_ACTIONS,
    validCombo: function (c) { return typeof c === 'string' && COMBO_RE.test(c); },
    limits: { speedMin: SPEED_MIN, speedMax: SPEED_MAX, gainMax: GAIN_MAX, gainSafe: GAIN_SAFE, bassMax: BASS_MAX }
  };
  window.SYFS.ytp = api;

  load(true);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanSoon, { once: true, passive: true });
  }
  window.addEventListener('load', scanSoon, { once: true, passive: true });
}());
