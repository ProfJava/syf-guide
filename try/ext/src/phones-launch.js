/* SYF — rail launcher for the phone number formatter. The tool itself runs on a
 * dedicated extension page (phones.html) for the same two reasons sheet.js does:
 * a review table needs far more width than a 430px rail window, and keeping
 * SheetJS off every web page means the library is only ever parsed when someone
 * actually opens a workbook.
 *
 * `action` (not `mount`) → it opens the page on click and can carry a keyboard
 * shortcut (rail.js runHotkey calls t.action()). Loaded lazily with the other
 * tool bodies. */
(function () {
  window.SYFS = window.SYFS || {};

  SYFS.tools = SYFS.tools || [];
  /* ⚠️ push, never concat — rail.js holds the array reference from load time, so a
     reassignment makes the tool invisible to the whole bar (§5.12/7). */
  SYFS.tools.push({
    /* cat moved 'docs' → 'note' in v0.112.0. It takes a file in and gives a file out,
       which is why it landed under المستندات — but so does every tool in that category,
       and none of the others is a TEXT normaliser. What this does to a column of phone
       numbers is what «عدّاد الكلمات» and «الترجمة» do to text, so it belongs beside
       them. The id is untouched, so a stored order and any bound shortcut survive. */
    id: 'phones', name: 'منسّق أرقام الجوال', cat: 'note',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M10.5 18.5h3"/><path d="M9 7.5h6"/></svg>',
    action: function () {
      try {
        chrome.runtime.sendMessage({ type: 'SYFS_OPEN_PHONES' }, function () { void chrome.runtime.lastError; });
      } catch (e) { /* ignore */ }
    }
  });
}());
