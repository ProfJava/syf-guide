/* SYF — Facebook ad hider: isolated content script (facebook.com only).
 * Hides "Sponsored" / «ممول» posts Facebook injects into the News Feed, the
 * sponsored blocks in the right rail, and (opt-in) "Suggested for you" posts.
 *
 * Why this is cosmetic, not network blocking: Facebook serves ads FIRST-PARTY —
 * from the same origin as the feed itself — so declarativeNetRequest / the ad
 * ruleset cannot touch them (blocking facebook.com would delete the whole page).
 * The only lever is the DOM.
 *
 * Facebook obfuscates the "Sponsored" label with TWO tricks at once, and beating
 * only one of them is worth nothing (v0.71.0 fixes both — v0.69/v0.70 shipped
 * broken because it half-beat one):
 *   1. DECOY letters, interleaved with the real ones and hidden from view. Today
 *      they sit at `position:absolute; top:3em` inside an overflow:hidden box.
 *      We used to look for `left/top <= -9999` — parseFloat("3em") is 3, so every
 *      decoy sailed through. We now compare RECTS against the label's own box, so
 *      any clipping trick is caught without parsing CSS units.
 *   2. SCRAMBLED order: the real letters sit in a flex container and are laid out
 *      by CSS `order`, so DOM order reads "roodpneSs" while the screen reads
 *      "Sponsored". A single rev() cannot undo an arbitrary permutation — we sort
 *      each flex container's children by computed `order` instead.
 * So we reconstruct the label's *rendered* text and require an EXACT match against
 * the keyword list. A post that merely mentions sponsorship is untouched.
 *
 * Reads NO post content and transmits nothing — pure local DOM. The only thing
 * that leaves this script is `fb_hidden`, a bare integer: no ids, no links, no
 * text, so it can never become a browsing history. Toggled by `fb_adblock` plus
 * the three per-kind keys (shield tool → «فيسبوك» tab) and paused by the shared
 * per-site allowlist (`shield_allow`), like src/gmail-adblock.js.
 *
 * Honest limit: Facebook rewrites its markup constantly, so this is an arms race
 * and may need periodic updates. Targeting the *mechanism* (clipping + order)
 * rather than today's class names is what buys it some shelf life. A newly-loaded
 * sponsored post can flash for a frame before the sweep hides it (there is no
 * stable static selector to pre-hide with, the way the Gmail hider has). */
(function () {
  'use strict';

  var htmlEl = document.documentElement;
  var SITE_KEY = 'facebook.com';
  var HOST = (location.hostname || '').toLowerCase().replace(/^www\./, '');
  /* an exception covers its subdomains, like the DNR rule it mirrors (v0.139.4) */
  function allowHas(list, h) {
    return list.some(function (d) { return typeof d === 'string' && d && (h === d || h.slice(-d.length - 1) === '.' + d); });
  }

  function uniq(a) { return a.filter(function (v, i) { return v && a.indexOf(v) === i; }); }

  /* keyword lists, normalized (see norm). Kept precise — only the actual label
   * words — because we require an EXACT rendered-text match.
   * i18n-skip-start: FACEBOOK's labels, not ours. Translating one would mean
   * looking for a word Facebook never writes, and the hider would silently stop
   * finding anything — a failure that looks exactly like "no ads today". */
  var KW_AD  = uniq(['sponsored', 'ممول', 'مموّل', 'مُموَّل'].map(norm));
  /* «مقترح لك» is NOT an ad — it is content Facebook suggests. It gets its own
   * list and its own opt-in toggle, off by default: hiding a user's content
   * without being asked is not ad blocking. */
  var KW_SUG = uniq(['suggestedforyou', 'suggested', 'مقترحلك', 'مقترحةلك', 'مقترح'].map(norm));
  /* i18n-skip-end */

  /* lowercase · strip Arabic tashkeel + tatweel · keep only letters (latin +
   * Arabic). Drops spaces, digits, middots, emoji — so "Sponsored · 🌐" → "sponsored". */
  function norm(s) {
    return (s || '').toLowerCase()
      .replace(/[ً-ْـٰ]/g, '')
      .replace(/[^a-zء-ي]/g, '');
  }
  function rev(s) { return s.split('').reverse().join(''); }
  /* Cheap prefilter before the costly rendered-text reconstruction: does `hay` hold
   * every letter of `needle`, counting duplicates? ORDER-INDEPENDENT on purpose — the
   * `order` trick scrambles the DOM sequence, so "sponsored" is NOT a subsequence of
   * the raw DOM text (this is the bug that made v0.69/v0.70 miss scrambled labels).
   * A multiset-subset test still rejects the vast majority of nodes, and renderedText
   * does the exact confirmation on whatever slips through. */
  function bagHas(needle, hay) {
    var need = {}, c, i;
    for (i = 0; i < needle.length; i++) { c = needle[i]; need[c] = (need[c] || 0) + 1; }
    var have = {};
    for (i = 0; i < hay.length; i++) { c = hay[i]; have[c] = (have[c] || 0) + 1; }
    for (c in need) { if ((have[c] || 0) < need[c]) return false; }
    return true;
  }

  function cs(n) { try { return getComputedStyle(n); } catch (e) { return null; } }

  /* Reconstruct the RENDERED text of an element — what the eye reads, not what the
   * DOM says. Defeats both obfuscation tricks (see file header). Called only on
   * prefiltered candidates, so the forced layout stays bounded. */
  function renderedText(root) {
    var box = null;
    try { box = root.getBoundingClientRect(); } catch (e) { box = null; }
    var boxUsable = !!box && (box.width > 0 || box.height > 0);

    /* Is `el` invisible to the eye, whatever trick hides it? We ask about the
     * RENDERED result, never the declaration, because Facebook keeps changing the
     * declaration: v0.69 looked for `left/top <= -9999`, then the decoys moved to
     * `top:3em`, then out of inline styles into randomised classes (urhKlDZ4…).
     * Computed styles and rects see through all three, and through the next one.
     *
     * Three questions, cheapest first:
     *   1. checkVisibility() — display:none, visibility, opacity, content-visibility
     *   2. zero box — a letter with no width or height paints NOTHING, so font-size:0,
     *      width:0 and transform:scale(0) are all decoys. (v0.71.0-rc kept these,
     *      which was exactly backwards.)
     *   3. clipped out of the label's own box — the overflow:hidden family
     *
     * When we cannot measure, we keep the letter: a missed decoy garbles the string
     * and fails the exact match, so we fail to HIDE — never a false hide. */
    function invisible(el) {
      if (typeof el.checkVisibility === 'function' &&
          !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return true;
      var r;
      try { r = el.getBoundingClientRect(); } catch (e) { return false; }
      if (!r.width || !r.height) return true;
      if (!boxUsable) return false;
      return r.right <= box.left || r.left >= box.right ||
             r.bottom <= box.top || r.top >= box.bottom;
    }

    /* a text node becomes an anonymous flex item, which always has order 0 */
    function ord(n) {
      if (n.nodeType !== 1) return 0;
      var st = cs(n);
      return (st && parseInt(st.order, 10)) || 0;
    }

    var out = '';
    (function rec(node) {
      var kids = [];
      for (var n = node.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3 || n.nodeType === 1) kids.push(n);
      }
      var pst = cs(node);
      if (pst && (pst.display === 'flex' || pst.display === 'inline-flex') && kids.length > 1) {
        /* stable sort by CSS order — ties keep DOM order, exactly as the flex spec
         * paints them. This is the step that turns "roodpneSs" into "Sponsored". */
        kids = kids.map(function (n, i) { return { n: n, i: i, o: ord(n) }; })
          .sort(function (a, b) { return (a.o - b.o) || (a.i - b.i); })
          .map(function (x) { return x.n; });
      }
      for (var k = 0; k < kids.length; k++) {
        var c = kids[k];
        if (c.nodeType === 3) { out += c.nodeValue; continue; }
        /* asked of EVERY element, not just positioned ones: a decoy no longer has to
         * be absolutely positioned to be hidden. */
        if (invisible(c)) continue;
        rec(c);
      }
    })(root);
    return out;
  }

  /* Is THIS one node a sponsored/suggested label? Its RENDERED text must be exactly
   * a keyword. rev() stays as a cheap safety net for the plain reversal trick.
   * Cheap prefilter (bagHas on raw text) gates the costly renderedText. */
  function isLabel(node, kws) {
    var raw = norm(node.textContent || '');
    if (!raw || raw.length > 40) return false;
    var maybe = false;
    for (var k = 0; k < kws.length; k++) { if (bagHas(kws[k], raw)) { maybe = true; break; } }
    if (!maybe) return false;
    var vt = norm(renderedText(node));
    return kws.indexOf(vt) >= 0 || kws.indexOf(rev(vt)) >= 0;
  }

  /* The container to hide, given a label found ANYWHERE inside it. We drive off the
   * label, not off role="article", because Facebook ships sponsored units with no
   * article role at all — e.g. the multi-ad "Sponsored" carousels whose header is a
   * plain <h3>. Walk out to the enclosing feed story (direct child of [role="feed"])
   * or right-rail block, so the whole card and its spacing go, never more.
   *
   * kind gates it: a rail hit obeys fb_sidebar, a feed/article hit obeys
   * fb_sponsored/fb_suggested. Returns null when the label sits in neither a feed nor
   * the rail (Marketplace, permalink chrome, …): hiding an unknown ancestor there
   * risks eating half the page, so we decline rather than guess. */
  function directChildOf(node, container) {
    var c = node;
    while (c && c.parentElement && c.parentElement !== container) c = c.parentElement;
    return (c && c.parentElement === container) ? c : null;
  }
  function containerOf(node) {
    var rail = node.closest('[data-pagelet="RightRail"]');
    if (rail) { var rc = directChildOf(node, rail); if (rc) return { el: rc, kind: 'rail' }; }
    var feed = node.closest('[role="feed"]');
    if (feed) { var fc = directChildOf(node, feed); if (fc) return { el: fc, kind: 'feed' }; }
    var art = node.closest('[role="article"]');
    if (art) return { el: art, kind: 'feed' };
    return null;
  }

  /* `gen` invalidates every "already decided" marker at once when settings change,
   * without walking the DOM to clear flags. */
  var gen = 0;
  var hiddenEls = [];
  var scanCount = new WeakMap();

  function hideNode(node) {
    if (!node || node.__syfsFbHidden) return;
    node.__syfsFbHidden = true;
    node.setAttribute('data-syfs-fbad', '1');
    node.style.setProperty('display', 'none', 'important');
    hiddenEls.push(node);
    /* count each post once per page load: a settings change unhides and re-hides
     * everything, and that must not inflate the number. */
    if (!node.__syfsFbCounted) { node.__syfsFbCounted = true; bump(); }
  }
  function unsweep() {
    hiddenEls.forEach(function (n) {
      n.style.removeProperty('display');
      n.removeAttribute('data-syfs-fbad');
      n.__syfsFbHidden = false;
    });
    hiddenEls = [];
    scanCount = new WeakMap();   /* else a retired candidate stays retired forever */
    gen++;
  }

  /* ---- counter: a bare integer, batched ---- */
  var pendingN = 0, flushT = null;
  function bump() {
    pendingN++;
    if (flushT) return;
    flushT = setTimeout(function () {
      flushT = null;
      var n = pendingN; pendingN = 0;
      if (!n) return;
      try {
        chrome.storage.local.get({ fb_hidden: 0 }, function (r) {
          chrome.storage.local.set({ fb_hidden: (r.fb_hidden || 0) + n });
        });
      } catch (e) { /* ignore */ }
    }, 1000);
  }

  /* ---- sweep ----
   * Label-driven: scan the small set of elements that can BE a label, decode each,
   * and hide the container it belongs to. We scan `a` (the obfuscated "Sponsored"
   * byline links) plus `h3, h4` (the plain "Sponsored" / "Suggested for you"
   * headers, incl. the multi-ad carousels that carry no article role). Scanning
   * every <span> would cost far more for nothing these headers don't already cover.
   *
   * `decided` is marked on the LABEL node, not the container — one container can
   * hold several candidate labels, and we must not re-decode a label we already
   * ruled on. A late-rendering label gets a few rescans before we retire it. */
  var LABEL_SEL = 'a, h3, h4';

  function decided(el) { return el.__syfsFbGen === gen || el.__syfsFbHidden; }
  function retire(el) {
    var c = (scanCount.get(el) || 0) + 1;
    scanCount.set(el, c);
    if (c >= 4) el.__syfsFbGen = gen;
  }

  function sweep() {
    if (!on) return;
    var wantAd = doSponsored || doSidebar;
    if (!wantAd && !doSuggested) return;
    var nodes = document.querySelectorAll(LABEL_SEL);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (decided(node)) continue;

      var isAd = wantAd && isLabel(node, KW_AD);
      var isSug = !isAd && doSuggested && isLabel(node, KW_SUG);
      if (!isAd && !isSug) { retire(node); continue; }

      var hit = containerOf(node);
      if (!hit) { node.__syfsFbGen = gen; continue; }   /* labelled but nowhere safe to hide */

      /* honor the per-kind toggles: a rail block needs fb_sidebar, a feed/article
       * ad needs fb_sponsored, a suggested post needs fb_suggested. */
      var allow = isSug ? doSuggested : (hit.kind === 'rail' ? doSidebar : doSponsored);
      if (allow) hideNode(hit.el);
      node.__syfsFbGen = gen;
    }
  }

  var obs = null;
  function startObs() {
    if (obs) return;
    var queued = false;
    obs = new MutationObserver(function () {
      if (queued) return; queued = true;
      setTimeout(function () { queued = false; sweep(); }, 200);
    });
    try { obs.observe(document.body || htmlEl, { childList: true, subtree: true }); } catch (e) {}
  }
  function stopObs() { if (obs) { obs.disconnect(); obs = null; } }

  /* ---- gate + apply ---- */
  var on = true;
  var doSponsored = true, doSidebar = true, doSuggested = false;

  function apply() {
    /* any settings change makes every past decision stale — drop them all, then
     * let the sweep re-decide under the new rules. */
    unsweep();
    if (on && (doSponsored || doSidebar || doSuggested)) { startObs(); sweep(); }
    else stopObs();
  }

  function load() {
    try {
      chrome.storage.local.get({
        fb_adblock: true, fb_sponsored: true, fb_sidebar: true, fb_suggested: false,
        shield_allow: []
      }, function (r) {
        var allow = Array.isArray(r.shield_allow) ? r.shield_allow : [];
        on = (r.fb_adblock !== false) && !allowHas(allow, SITE_KEY) && !allowHas(allow, HOST);
        doSponsored = (r.fb_sponsored !== false);
        doSidebar = (r.fb_sidebar !== false);
        doSuggested = (r.fb_suggested === true);   /* opt-in: not an ad */
        apply();
      });
    } catch (e) { on = true; apply(); }
  }

  load();

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      /* deliberately NOT fb_hidden — our own counter write must not re-enter load() */
      if (changes.fb_adblock || changes.fb_sponsored || changes.fb_sidebar ||
          changes.fb_suggested || changes.shield_allow) load();
    });
  } catch (e) { /* ignore */ }
})();
