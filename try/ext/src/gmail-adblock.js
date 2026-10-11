/* SYF — Gmail ad hider: isolated content script (mail.google.com only).
 * Hides the "Sponsored" / "Ad" rows Gmail injects into the inbox list. Pure CSS +
 * DOM: a <style> using :has() plus a MutationObserver fallback for rows added
 * later or where :has isn't matched. Reads NO message content and transmits
 * nothing. Toggled by `gmail_adblock` (shield tool → «كل المواقع») and paused by
 * the shared per-site allowlist (shield_allow). */
(function () {
  'use strict';

  var htmlEl = document.documentElement;
  var host = (location.hostname || '').toLowerCase().replace(/^www\./, '');
  var SITE_KEY = 'mail.google.com';
  /* an exception covers its subdomains, like the DNR rule it mirrors (v0.139.4):
     allowing google.com lifts blocking on mail.google.com, so the CSS layer follows */
  function allowHas(list, h) {
    return list.some(function (d) { return typeof d === 'string' && d && (h === d || h.slice(-d.length - 1) === '.' + d); });
  }

  /* Ad rows carry the "Ad" badge (span.ast) and an "Ad info" control. */
  var AD_CSS =
    'tr.zA:has(.ast),' +
    'tr.zA:has([aria-label="Ad info" i]),' +
    'tr.zA:has([aria-label="Ad" i].ast)' +
    '{display:none!important;}';

  var styleEl = null;
  function ensureStyle() {
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'syfs-gmail-css'; styleEl.textContent = AD_CSS; }
    if (!styleEl.isConnected) (document.head || htmlEl).appendChild(styleEl);
  }
  function removeStyle() { if (styleEl && styleEl.isConnected) styleEl.remove(); }

  /* Fallback: mark a row hidden if it holds an "Ad"/"Sponsored" badge or the
   * "Ad info" affordance. Uses a data-attr so un-hiding on toggle is possible. */
  function isAdRow(tr) {
    if (tr.querySelector('[aria-label="Ad info" i]')) return true;
    var badge = tr.querySelector('.ast');
    if (badge) {
      var t = (badge.textContent || '').trim().toLowerCase();
      /* i18n-skip-start: GMAIL's own row label */
      if (t === 'ad' || t === 'sponsored' || t === 'إعلان') return true;
      /* i18n-skip-end */
    }
    return false;
  }
  function sweep() {
    if (!on) return;
    var rows = document.querySelectorAll('tr.zA:not([data-syfs-ad])');
    for (var i = 0; i < rows.length; i++) {
      if (isAdRow(rows[i])) { rows[i].setAttribute('data-syfs-ad', '1'); rows[i].style.display = 'none'; }
    }
  }
  function unsweep() {
    var rows = document.querySelectorAll('tr[data-syfs-ad]');
    for (var i = 0; i < rows.length; i++) { rows[i].style.display = ''; rows[i].removeAttribute('data-syfs-ad'); }
  }

  var obs = null;
  function startObs() {
    if (obs) return;
    var pending = false;
    obs = new MutationObserver(function () {
      if (pending) return; pending = true;
      setTimeout(function () { pending = false; sweep(); }, 150);
    });
    try { obs.observe(document.body || htmlEl, { childList: true, subtree: true }); } catch (e) {}
    sweep();
  }
  function stopObs() { if (obs) { obs.disconnect(); obs = null; } }

  /* ---- gate + apply ---- */
  var on = true;
  function apply() {
    if (on) { ensureStyle(); startObs(); }
    else { removeStyle(); stopObs(); unsweep(); }
  }

  function load() {
    try {
      chrome.storage.local.get({ gmail_adblock: true, shield_allow: [] }, function (r) {
        var allow = Array.isArray(r.shield_allow) ? r.shield_allow : [];
        /* Own key since v0.61. It used to ride on the YouTube toggle, so hiding a
         * "Sponsored" row in the inbox was hostage to a setting about video ads —
         * two unrelated things behind one switch. Default ON: this is CSS over the
         * inbox list, it cannot break playback the way the YouTube layer could. */
        on = (r.gmail_adblock !== false) && !allowHas(allow, SITE_KEY);
        apply();
      });
    } catch (e) { on = true; apply(); }
  }

  ensureStyle();   /* apply CSS immediately to avoid an ad-row flash, then reconcile */
  load();

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (changes.gmail_adblock || changes.shield_allow) load();
    });
  } catch (e) { /* ignore */ }
})();
