/* SYF — stealth ad blocker: isolated content script (document_start).
 * Three layers on top of the network blocking (declarativeNetRequest):
 *   1) Cosmetic filtering — a <style> that collapses leftover ad containers so
 *      no empty boxes remain. Curated, network-slot-focused selectors (not bare
 *      `.ad` bait, so script detectors that measure a bait element still see it).
 *   2) Anti-adblock JS defeat — via adblock-main.js in the MAIN world, gated by
 *      the data-syfs-ab attribute we set here, neutralizes JS detectors.
 *   3) Anti-wall — removes "disable your ad blocker" / "allow ads" force walls
 *      (incl. vendor recovery walls like Admiral whose class names are random),
 *      restores scrolling and strips imposed blur / scroll-lock.
 * Reads nothing from the page and transmits nothing — CSS + DOM cleanup only.
 * Respects the per-site allowlist and the three toggles in the shield tool. */
(function () {
  'use strict';

  var host = (location.hostname || '').toLowerCase().replace(/^www\./, '');
  var htmlEl = document.documentElement;
  /* مراجعة 2026-09-19 — this file now runs in every frame (manifest `all_frames: true`) for ONE
     reason: adblock-main.js runs in every frame and reads its on/off from the attribute
     set here, and a frame nobody wrote to is now OFF (see its `active()`). A sub-frame
     gets the gate and nothing else — no cosmetic sheet, no wall sweep, no observer:
     those belong to the page the user is looking at, and a hundred ad iframes each
     sweeping their own DOM is exactly the cost `all_frames:false` was avoiding. */
  var IS_TOP = (function () { try { return window.top === window; } catch (e) { return false; } }());

  /* Built-in allowlist: code-sandbox / live-preview sites (codepen & friends).
   * They render user code in their own frames; the cosmetic CSS + anti-wall sweep
   * (and the MAIN-world stubs, gated by the data-syfs-ab attr we set below) must
   * never touch them or the editor/preview can come up blank. Third-party ad
   * DOMAINS are still blocked by declarativeNetRequest, same as any blocklist. */
  var SANDBOX_HOSTS = /(^|\.)(codepen\.io|cdpn\.io|codepenassets\.com|jsfiddle\.net|codesandbox\.io|csb\.app|stackblitz\.com|stackblitz\.io|jsbin\.com|glitch\.me|plnkr\.co|replit\.com|repl\.co)$/;
  var isSandbox = SANDBOX_HOSTS.test(host);

  var COSMETIC_CSS =
    'ins.adsbygoogle,.adsbygoogle,' +
    '[id^="google_ads_"],[id^="div-gpt-ad"],[id^="gpt-"],' +
    'iframe[id^="google_ads_"],iframe[src*="doubleclick.net"],iframe[src*="googlesyndication.com"],' +
    'iframe[src*="adnxs.com"],iframe[src*="amazon-adsystem.com"],iframe[src*="/ads/"],' +
    '[data-ad-slot],[data-ad-client],[data-ad-unit],' +
    '.advertisement,.ad-container,.ad-wrapper,.ad-wrap,.ad-slot,.ad-unit,.ad-banner,' +
    '.banner-ad,.ad-placeholder,.ads-container,.adsbox,.adslot,.ad-block,' +
    '[class*="sponsored-ad"],[aria-label="advertisement" i],[aria-label="Advertisement" i]' +
    '{display:none!important;min-height:0!important;height:0!important;}';

  var styleEl = null;
  function ensureStyle() {
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'syfs-cosmetic'; styleEl.textContent = COSMETIC_CSS; }
    if (!styleEl.isConnected) htmlEl.appendChild(styleEl);
  }
  function removeStyle() { if (styleEl && styleEl.isConnected) styleEl.remove(); }

  /* ---- anti-adblock wall / overlay remover ----
   * NEVER on YouTube. Its "Ad blockers violate YouTube's Terms of Service" dialog
   * matches AB_WORDS, but removing it does not restore playback — YouTube already
   * refused the stream before rendering it, so the sweep would leave a black player
   * and no explanation. YouTube is owned by yt-guard.js, which stands the blocker
   * down and leaves the notice visible on purpose. */

  /* Intent phrases, not the bare noun "ad / إعلان": a news site prints "إعلان" in
   * every ad label, so matching that alone would nuke real content. We require an
   * adblock-directed phrase (block / disable / allow / whitelist + ad, en or ar).
   * Arabic covers both spellings — with / without the ال article, hamza (إ) vs
   * bare alef (ا): the kooora / Admiral wall says «مانع اعلانات» + «السماح بالإعلانات»,
   * which the old `مانع\s*الإعلان` (ال + hamza required) never matched. */
  /* ⚠️ word boundaries on the English side (v0.139.2): without them `disable.{0,20}ad`
     matched «Disable autoplay · Re·ad·ing list», `allow.{0,15}ads?` «Allow cookies?
     Re·ad more», and `ad\s?block` «Downlo·ad block·ed» — and a big fixed element with
     such text (often an app's own root) was removed. `\b` is ASCII-only in JS, so the
     Arabic alternatives below are unchanged. */
  var AB_WORDS = new RegExp(
    '(' +
      '\\bad[\\s-]?block(er|ers|ing)?\\b|\\bublock\\b|' +
      '\\b(disable|turn\\s?off|pause)\\b.{0,20}\\bad(s|\\s?block(er)?)?\\b|\\ballow\\b.{0,15}\\bads\\b|' +
      '\\bwhitelist\\b.{0,25}\\b(site|ads?)\\b|\\bremove\\b.{0,15}\\bad\\s?block|' +
      /* i18n-skip-start: regex source matched against the HOST PAGE's wording */
      'مانع\\s*(ال)?[إا]علان|حاجب\\s*(ال)?[إا]علان|' +
      'السماح\\s*(بال)?[إا]علان|(عطّ?ل|أوقف|إيقاف|فعّ?ل).{0,15}[إا]علان|' +
      'القائمة\\s*البيضاء|أضف.{0,15}الموقع' +
      /* i18n-skip-end */
    ')', 'i'
  );

  /* Recovery-vendor signature: Admiral, Blockthrough, AdShield & co. randomize
   * their class names, but the overlay always links / images back to the vendor.
   * ⚠️ العلامة نطاق المزوّد كاملاً لا كلمة «admiral» أينما وقعت: التوقيع القديم كان
   * يطابق أي رابط/صنف/معرّف فيه هذه الحروف، فيقتلع أثاث الصفحة على موقع شركة
   * Admiral للتأمين — اسمٌ مشروع لا علاقة له بالمزوّد (نفس سبب حذف admiral.com من
   * rules/ads.json). ولم تعد العلامة تتخطّى فحص الحجم/الطبقة: تتخطّى فحص النصّ
   * وحده، لأن نصّ جدار المزوّد يتبدّل ولا يُضمن أن تعرفه AB_WORDS. */
  var VENDOR_SEL = 'a[href*="getadmiral.com" i],img[src*="getadmiral.com" i],' +
    'a[href*="blockthrough.com" i],img[src*="blockthrough.com" i],' +
    'a[href*="adshield.io" i],img[src*="adshield.io" i]';

  var IS_YOUTUBE = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(host);
  var obs = null;

  function hasVendorMark(el) {
    try { return !!el.querySelector(VENDOR_SEL); } catch (e) { return false; }
  }

  function looksLikeWall(el) {
    if (IS_YOUTUBE) return false;
    if (!el || el.nodeType !== 1) return false;
    if (el.id === 'syfs-host' || el.id === 'syfs-cosmetic' || el.id === 'syfs-unlock') return false;
    var cs;
    try { cs = getComputedStyle(el); } catch (e) { return false; }
    if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
    var r = el.getBoundingClientRect();
    var big = r.width >= innerWidth * 0.6 && r.height >= innerHeight * 0.5;
    var z = parseInt(cs.zIndex, 10) || 0;
    if (!big && z < 1000) return false;
    /* العلامة تمرّ من نفس بوّابة الحجم/الطبقة أعلاه — شارةٌ صغيرة تحمل رابط المزوّد
       ليست جداراً، والقفز فوق البوّابة هو ما كان يقتلع عناصر مشروعة. */
    var full = el.textContent || '';
    /* a wall is a notice, not the page: an element holding most of the document's text
       is the app itself (SPA roots are often fixed/absolute and full-size).
       Measured lazily — only once a candidate passes the cheap gates above; reading
       the whole body's text on every 200ms batch cost more than the sweep itself. */
    if (pageTextLen < 0) measurePage();
    if (pageTextLen > 2000 && full.length > pageTextLen * 0.5) return false;
    return AB_WORDS.test(full.slice(0, 800)) || hasVendorMark(el);
  }
  var pageTextLen = 0;
  function measurePage() { try { pageTextLen = ((document.body && document.body.textContent) || '').length; } catch (e) { pageTextLen = 0; } }

  /* scroll-lock class names walls put on <body> instead of inline overflow */
  var LOCK_CLASSES = ['modal-open', 'no-scroll', 'noscroll', 'no_scroll',
    'stop-scrolling', 'overflow-hidden', 'ovh', 'scroll-lock', 'is-locked', 'fixed-body'];

  function unlockScroll() {
    htmlEl.classList.add('syfs-ab-unlock');
    if (!document.getElementById('syfs-unlock')) {
      var s = document.createElement('style'); s.id = 'syfs-unlock';
      /* stylesheet !important beats the page's non-important inline overflow:hidden */
      s.textContent = 'html.syfs-ab-unlock,html.syfs-ab-unlock body{' +
        'overflow:auto!important;overflow-y:auto!important;' +
        'position:static!important;filter:none!important;height:auto!important;}';
      htmlEl.appendChild(s);
    }
    try {
      var b = document.body;
      if (b) LOCK_CLASSES.forEach(function (c) { b.classList.remove(c); });
    } catch (e) {}
  }

  function bodyScrollLocked() {
    try {
      var b = document.body;
      if (!b) return false;
      if (getComputedStyle(htmlEl).overflow === 'hidden') return true;
      if (getComputedStyle(b).overflow === 'hidden') return true;
      for (var i = 0; i < LOCK_CLASSES.length; i++) if (b.classList.contains(LOCK_CLASSES[i])) return true;
    } catch (e) {}
    return false;
  }

  var WALL_SEL = 'div,section,aside,dialog,ins';
  var wallSeen = false;              /* a wall was removed on THIS page */
  function sweepNodes(list) {
    var removedAny = false;
    pageTextLen = -1;                /* stale from the last sweep — re-read on demand */
    for (var i = 0; i < list.length; i++) {
      if (list[i].isConnected && looksLikeWall(list[i])) {
        try { list[i].remove(); removedAny = true; } catch (e) {}
      }
    }
    if (removedAny) wallSeen = true;
    /* ⛔ unlock ONLY on a page where a wall was actually removed (v0.139.2). It used to
       fire whenever html/body had overflow:hidden — which Gmail, Docs, Slack, Figma,
       WhatsApp Web and most dashboards set BY DESIGN — and forcing them to
       `overflow:auto; height:auto; position:static` collapsed their layout. Admiral
       re-locking after the overlay is gone is still covered: once a wall was seen here,
       a later lock is undone too. */
    if (wallSeen && (removedAny || bodyScrollLocked())) unlockScroll();
  }
  function sweep(root) {
    var scope = (root && root.querySelectorAll) ? root : document;
    sweepNodes(scope.querySelectorAll(WALL_SEL));
  }

  function startObserver() {
    if (obs || IS_YOUTUBE) return;   /* see looksLikeWall(): YouTube is yt-guard.js's */
    /* ⚠️ only what was ADDED is examined (v0.139.2) — a whole-document querySelectorAll
       with getComputedStyle + getBoundingClientRect per node, five times a second on any
       live page, forced style and layout constantly. A wall arrives as an added node
       (or inside one); the eager full sweeps below catch the ones already there. */
    var pending = null;
    obs = new MutationObserver(function (recs) {
      if (!pending) {
        pending = [];
        setTimeout(function () {
          var batch = pending; pending = null;
          var list = [];
          batch.forEach(function (n) {
            if (!n.isConnected) return;
            if (n.matches && n.matches(WALL_SEL)) list.push(n);
            try { Array.prototype.push.apply(list, n.querySelectorAll(WALL_SEL)); } catch (e) {}
          });
          if (list.length) sweepNodes(list);
          else if (wallSeen && bodyScrollLocked()) unlockScroll();
        }, 200);
      }
      for (var i = 0; i < recs.length; i++) {
        var added = recs[i].addedNodes;
        for (var j = 0; j < added.length; j++) if (added[j].nodeType === 1) pending.push(added[j]);
      }
    });
    try { obs.observe(htmlEl, { childList: true, subtree: true }); } catch (e) {}
    /* a few eager whole-page sweeps for walls already in the DOM (or un-hidden by a class
       flip, which the childList observer does not see). v0.139.3: three, not five, and
       each waits for an idle moment so it never lands inside the page's own work. */
    [0, 1500, 6000].forEach(function (t) {
      setTimeout(function () {
        var run = function () { if (obs) sweep(document.body || document); };
        if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1000 }); else run();
      }, t);
    });
  }
  /* switching anti-wall off takes back what it wrote — a class and a sheet that kept
     forcing overflow on the page after the feature was «off» */
  function stopObserver() {
    if (obs) { obs.disconnect(); obs = null; }
    try { htmlEl.classList.remove('syfs-ab-unlock'); } catch (e) {}
    var s = document.getElementById('syfs-unlock');
    if (s) s.remove();
  }

  /* ---- apply settings ---- */
  var settings = { cosmetic: true, stealth: true, antiwall: true, allow: [] };
  /* v0.139.4: an exception covers its subdomains, as the DNR rule it mirrors does
     (requestDomains matches subdomains). Exact match let news.example.com keep the
     cosmetic/stealth layers on a site whose network blocking the user had lifted. */
  function allowHas(list, h) {
    return list.some(function (d) { return typeof d === 'string' && d && (h === d || h.slice(-d.length - 1) === '.' + d); });
  }

  function apply() {
    var allowlisted = isSandbox || allowHas(settings.allow, host);
    // stealth layer — MAIN-world JS-detector gate (adblock-main.js reads this attr).
    // First, and in every frame: it is the only line a sub-frame runs.
    htmlEl.setAttribute('data-syfs-ab', (settings.stealth && !allowlisted) ? 'on' : 'off');
    if (!IS_TOP) return;
    // cosmetic layer
    if (settings.cosmetic && !allowlisted) ensureStyle(); else removeStyle();
    // anti-wall layer — DOM overlay remover + scroll unlock
    if (settings.antiwall && !allowlisted) startObserver(); else stopObserver();
  }

  function load() {
    try {
      chrome.storage.local.get(
        /* all three default OFF (v0.87.0) — they are the ad blocker's own layers, and
           the blocker is opt-in now. Leaving cosmetic hiding on would keep ad slots
           collapsing with nothing being blocked, which reads as "it is still on". */
        { shield_cosmetic: false, shield_stealth: false, shield_antiwall: false, shield_allow: [] },
        function (r) {
          settings.cosmetic = r.shield_cosmetic !== false;
          settings.stealth = r.shield_stealth !== false;
          settings.antiwall = r.shield_antiwall !== false;
          settings.allow = Array.isArray(r.shield_allow) ? r.shield_allow : [];
          apply();
        }
      );
    } catch (e) { apply(); }
  }

  // ⛔ No eager `ensureStyle()` before the read (مراجعة 2026-09-19). It dated from when the
  // cosmetic layer was on by default; since v0.87.0 it is opt-in, so the eager sheet
  // was collapsing `.ad-container` / `[aria-label="advertisement"]` on EVERY page for
  // EVERY user for the few ms until storage answered, then un-collapsing them — a
  // layout jump on each load, for a feature the user never turned on. A user who did
  // turn it on trades those same few ms for an ad-box flash, which is the right side
  // of that trade: nothing shows for a moment vs. content jumps for everyone.
  load();

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (changes.shield_cosmetic || changes.shield_stealth || changes.shield_antiwall || changes.shield_allow) load();
    });
  } catch (e) { /* ignore */ }

  // keep our styles attached through aggressive SPA rewrites (top frame only — a
  // sub-frame never gets a sheet, so there is nothing to keep attached)
  if (IS_TOP) new MutationObserver(function () {
    var allowlisted = isSandbox || allowHas(settings.allow, host);
    if (settings.cosmetic && !allowlisted && styleEl && !styleEl.isConnected) htmlEl.appendChild(styleEl);
  }).observe(htmlEl, { childList: true });
})();
