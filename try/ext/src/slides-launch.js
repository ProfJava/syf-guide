/* SYF — rail launcher for the PowerPoint tool. The deck editor runs on its own
 * extension page (slides.html): a 16:9 slide needs the whole viewport.
 *
 * `action` (not `mount`) → opens the page on click and can be bound to a keyboard
 * shortcut (rail.js runHotkey calls t.action()). Loaded lazily with the other tool
 * bodies. */
(function () {
  window.SYFS = window.SYFS || {};

  SYFS.tools = SYFS.tools || [];
  SYFS.tools.push({
    id: 'slidesedit', name: 'عروض PowerPoint', cat: 'docs',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M6 7h8M6 11h5"/></svg>',
    action: function () {
      try {
        chrome.runtime.sendMessage({ type: 'SYFS_OPEN_SLIDES' }, function () { void chrome.runtime.lastError; });
      } catch (e) { /* ignore */ }
    }
  });
}());
