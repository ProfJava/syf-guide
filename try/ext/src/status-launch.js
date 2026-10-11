/* SYF — rail launcher for the status maker. The tool itself runs on its own extension
 * page (status.html): a 1080×1920 preview beside its controls needs far more room than
 * a 430px rail window, and an image editor that lived in the page would be redrawing a
 * canvas over someone else's site for no reason.
 *
 * `action` (not `mount`) → it opens the page on click and can carry a keyboard shortcut
 * (rail.js runHotkey calls t.action()). Loaded lazily with the other tool bodies. */
(function () {
  window.SYFS = window.SYFS || {};

  SYFS.tools = SYFS.tools || [];
  /* ⚠️ push, never concat — rail.js holds the array reference from load time, so a
     reassignment makes the tool invisible to the whole bar (§5.12/7). */
  SYFS.tools.push({
    id: 'status', name: 'صانع الحالات', cat: 'media', beta: true,
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="3"/><path d="M8.5 9h7"/><path d="M8.5 13h4.5"/></svg>',
    action: function () {
      try {
        chrome.runtime.sendMessage({ type: 'SYFS_OPEN_STATUS' }, function () { void chrome.runtime.lastError; });
      } catch (e) { /* ignore */ }
    }
  });
}());
