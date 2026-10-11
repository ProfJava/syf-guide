/* SYF — rail launcher for OCR. The engine itself runs on a dedicated extension page
 * (ocr.html) and not in a rail window, and that is not a size decision: a Web Worker
 * created from a content script is created in the HOST page's context, so the host's
 * CSP decides whether it may run at all — on a strict site it would not, silently.
 * See the header of ocr.html.
 *
 * `action` (not `mount`) → the tool opens the page directly on click and can carry a
 * keyboard shortcut (rail.js runHotkey calls t.action()). Loaded lazily with the other
 * tool bodies, so the 2.9MB engine is never parsed by a page that does not ask for it.
 *
 * cat 'docs' and not 'media': the input is an image but the ANSWER is a document — the
 * same reading that put the whiteboard here (§5, v0.111.0). It also lands on the less
 * crowded shelf, which is the merge rule read forwards. */
(function () {
  window.SYFS = window.SYFS || {};

  SYFS.tools = SYFS.tools || [];
  SYFS.tools.push({
    id: 'ocr', name: 'استخراج نصّ من صورة', cat: 'docs', beta: true,
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M7 9h10"/><path d="M7 13h7"/></svg>',
    action: function () {
      try {
        chrome.runtime.sendMessage({ type: 'SYFS_OPEN_OCR' }, function () { void chrome.runtime.lastError; });
      } catch (e) { /* ignore */ }
    }
  });
}());
