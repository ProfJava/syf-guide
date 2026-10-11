/* SYF — raw-document detector (Markdown / JSON).
 *
 * Runs on every page as part of the rail bootstrap, but does almost nothing:
 * it reads `document.contentType` and the URL, and on the ~0.1% of navigations
 * that are a RAW .md or .json document it asks the worker to inject the real
 * viewer (src/docview.js). Everything heavy — the Markdown parser, the JSON
 * tree, the stylesheet — lives in that file and is never fetched otherwise.
 *
 * Why a detector at all: src/docview.js is in LAZY_TOOL_FILES, but that batch is
 * only injected once the user opens the rail's tools. A JSON response the user
 * simply navigated to must format itself without any interaction.
 *
 * Security: the message carries no page data — the worker injects a fixed file
 * from inside the package into the sender's own tab (see background.js).
 */
(function () {
  if (window.top !== window) return;                 /* frames render nothing */
  if (window.__syfDocDetect) return;
  window.__syfDocDetect = 1;

  var ct = String(document.contentType || '').toLowerCase();
  var path = '';
  try { path = new URL(location.href).pathname.toLowerCase(); } catch (e) { return; }

  var isJson = ct.indexOf('json') >= 0;
  var isMd = /\.(md|markdown|mdown|mkd|mdx)$/.test(path);
  /* A .md served as text/plain is the common case; a .md served as text/html is
   * a real HTML page that merely ends in .md — leave that alone. */
  if (isMd && ct && ct.indexOf('html') >= 0) isMd = false;
  /* text/plain that is actually JSON (very common for API mocks and gists) is
   * confirmed by src/docview.js against the real body, not guessed here. */
  var maybeJson = !isJson && !isMd && (ct.indexOf('text/plain') === 0 || ct === '');

  if (!isJson && !isMd && !maybeJson) return;

  try {
    chrome.runtime.sendMessage({ type: 'SYFS_LOAD_DOCVIEW' }, function () {
      void chrome.runtime.lastError;                 /* worker asleep → nothing to do */
    });
  } catch (e) {}
}());
