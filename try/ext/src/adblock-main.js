/* SYF — stealth ad blocker: MAIN-world detector neutralizer.
 * Runs at document_start in the PAGE's own JS world (world:"MAIN") so it can
 * define the globals anti-adblock detectors look for. All stubs are benign —
 * they only make a detector believe ads loaded normally; nothing is collected
 * or transmitted. Gated live by the <html data-syfs-ab> attribute that the
 * isolated content script (adblock-stealth.js) sets from the user's settings,
 * so turning the feature off (or allowlisting a site) disables the stubs even
 * though this script already ran. */
(function () {
  'use strict';

  // Code-sandbox / live-preview sites (codepen & friends) render user code inside
  // their own iframes served from a separate origin (e.g. cdpn.io). The MAIN-world
  // stubs must NOT run there — a defined window.adsbygoogle / canRunAds getter can
  // clash with the pen's own scripts and blank the preview. This runs in EVERY frame
  // (all_frames), so keying on location.hostname stands the stubs down inside those
  // preview frames too. Third-party ad DOMAINS stay blocked by declarativeNetRequest
  // exactly like a normal blocklist — only the anti-adblock cosmetics are skipped.
  var SANDBOX_HOSTS = /(^|\.)(codepen\.io|cdpn\.io|codepenassets\.com|jsfiddle\.net|codesandbox\.io|csb\.app|stackblitz\.com|stackblitz\.io|jsbin\.com|glitch\.me|plnkr\.co|replit\.com|repl\.co)$/;
  function isSandbox() {
    try { return SANDBOX_HOSTS.test((location.hostname || '').toLowerCase()); }
    catch (e) { return false; }
  }

  // ⚠️ A MISSING attribute means OFF (مراجعة 2026-09-19). The stealth layer has been opt-in since
  // v0.87.0, but this gate still read "missing ⇒ on" from the days it was on by default.
  // Two consequences, both on users who never enabled anything: every sub-frame (this
  // file runs in all frames, the isolated script that sets the attribute did not) had
  // the stubs live for its whole life, and the top frame had them live from
  // document_start until storage answered — so an inline `adsbygoogle.push()` that ran
  // before that answer was swallowed and the slot never rendered. A blocker that is
  // off must leave no trace at all; only an explicit "on" arms anything here.
  function active() {
    try {
      if (isSandbox()) return false;                 // never interfere with code-sandbox previews
      return document.documentElement.getAttribute('data-syfs-ab') === 'on';
    } catch (e) { return false; }
  }

  function define(name, value) {
    try {
      // طبقة مطفأة يجب ألّا تترك أثراً — والجدار الذي يظهر لمن لم يُفعّل المانع عطلٌ نحن سببه.
      // كتابة الصفحة تُحفظ في الإغلاق وتُعاد كما هي عند الإطفاء؛ ابتلاعها يجعل الصفحة
      // تقرأ undefined من قيمة كتبتها بنفسها فيصدّق كاشفها أن هناك مانعاً.
      var shadow;
      Object.defineProperty(window, name, {
        configurable: true,
        get: function () { return active() ? value : shadow; },
        set: function (v) { shadow = v; }
      });
    } catch (e) { try { window[name] = value; } catch (e2) { /* ignore */ } }
  }

  // Common "ads are fine" signals.
  define('canRunAds', true);
  define('canShowAds', true);
  define('isAdBlockActive', false);
  try {
    // نفس القاعدة: قيمة الصفحة تُحفظ وتُعاد عند الإطفاء (سكربت AdSense نفسه يكتب هنا).
    var adStatus;
    Object.defineProperty(window, 'google_ad_status', {
      configurable: true,
      get: function () { return active() ? 1 : adStatus; },
      set: function (v) { adStatus = v; }
    });
  } catch (e) {}

  // adsbygoogle: a harmless array-like whose push() is a no-op so AdSense loader
  // code doesn't throw and detectors see it "present".
  try {
    if (!Array.isArray(window.adsbygoogle)) {
      var fake = [];
      fake.loaded = true;
      fake.push = function () { return active() ? 0 : Array.prototype.push.apply(this, arguments); };
      Object.defineProperty(window, 'adsbygoogle', { configurable: true, writable: true, value: fake });
    }
  } catch (e) {}

  // Neutralize the popular BlockAdBlock / FuckAdBlock / DetectAdBlock family:
  // provide a constructor whose "detected" path never fires and whose
  // "not-detected" callbacks run instead.
  function FakeAdBlockDetector() {
    var noop = function () { return this; };
    var self = {
      onDetected: noop,
      onNotDetected: function (cb) { if (active() && typeof cb === 'function') { try { cb(); } catch (e) {} } return this; },
      on: function (detected, cb) { if (active() && !detected && typeof cb === 'function') { try { cb(); } catch (e) {} } return this; },
      emitEvent: noop,
      check: noop,
      setOption: noop,
      options: {}
    };
    return self;
  }
  ['FuckAdBlock', 'BlockAdBlock', 'DetectAdBlock', 'AdBlockDetector'].forEach(function (name) {
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: function () { return active() ? FakeAdBlockDetector : window['__real_' + name]; },
        set: function (v) { window['__real_' + name] = v; }
      });
    } catch (e) {}
  });
  // Some libs expose a ready-made instance.
  ['fuckAdBlock', 'blockAdBlock'].forEach(function (name) {
    try {
      // ونفسها هنا: المكتبة تُسند نسختها الحقيقية إلى هذا الاسم، فابتلاعها يترك
      // الصفحة بلا كائن كتبته للتوّ حتى ونحن مطفأون (الإغلاق مستقلّ لكل اسم).
      var real;
      Object.defineProperty(window, name, {
        configurable: true,
        get: function () { return active() ? FakeAdBlockDetector() : real; },
        set: function (v) { real = v; }
      });
    } catch (e) {}
  });
})();
