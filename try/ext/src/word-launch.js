/* SYF — rail launcher for the Word document tool. The editor itself runs on a
 * dedicated extension page (word.html): a document needs a page-width canvas, not a
 * 430px rail window.
 *
 * `action` (not `mount`) → opens the page on click and can be bound to a keyboard
 * shortcut (rail.js runHotkey calls t.action()). Loaded lazily with the other tool
 * bodies. */
(function () {
  window.SYFS = window.SYFS || {};

  SYFS.tools = SYFS.tools || [];
  SYFS.tools.push({
    id: 'docedit', name: 'مستندات Word', cat: 'docs',
    /* a document carrying a W: two ruled lines said "a file", not "Word", and
       sheetview/pdfcompress sit next to it wearing the same page outline */
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m8.5 12 1.5 5 2-3.5 2 3.5 1.5-5"/></svg>',
    action: function () {
      try {
        chrome.runtime.sendMessage({ type: 'SYFS_OPEN_WORD' }, function () { void chrome.runtime.lastError; });
      } catch (e) { /* ignore */ }
    }
  });

  /* «PDF إلى Word» (v0.119.0) — the SAME page opened in PDF mode (word.html#pdf): the
     picker asks for a PDF, src/word.js rebuilds its text into the editor, and the
     existing docx writer exports it. v0.146.0: out of the rail — it is now the «إلى Word»
     tab of «أدوات PDF», so every PDF job sits in one tool. The entry stays (`noRail`) so
     a shortcut someone bound to `pdfword` keeps opening the converter. */
  SYFS.tools.push({
    id: 'pdfword', name: 'PDF إلى Word', cat: 'docs', noRail: true,
    /* page outline + an arrow into a W: "a file becoming Word" */
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M7 13h4m-1.5-1.5L11 13l-1.5 1.5"/><path d="m13 11.5 1 4.5 1.5-3 1.5 3 1-4.5"/></svg>',
    action: function () {
      try {
        chrome.runtime.sendMessage({ type: 'SYFS_OPEN_WORD', pdf: true }, function () { void chrome.runtime.lastError; });
      } catch (e) { /* ignore */ }
    }
  });
}());
