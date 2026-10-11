/* SYF — rail launcher for the Excel sheet tool. The grid itself runs on a
 * dedicated extension page (sheet.html): a spreadsheet needs far more width than
 * a 430px rail window, and keeping SheetJS off every web page means the library
 * is only ever parsed when the user actually opens a workbook.
 *
 * `action` (not `mount`) → the tool opens the page directly on click and can be
 * bound to a keyboard shortcut (rail.js runHotkey calls t.action()). Loaded
 * lazily with the other tool bodies. */
(function () {
  window.SYFS = window.SYFS || {};

  SYFS.tools = SYFS.tools || [];
  SYFS.tools.push({
    id: 'sheetview', name: 'جداول الإكسيل', cat: 'docs',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>',
    action: function () {
      try {
        chrome.runtime.sendMessage({ type: 'SYFS_OPEN_SHEET' }, function () { void chrome.runtime.lastError; });
      } catch (e) { /* ignore */ }
    }
  });
}());
