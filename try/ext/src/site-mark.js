/* SYF — «installed» mark for the extension's own website (specs/web-demo-site.md §8).
 * Runs ONLY on https://profjava.github.io/syf-guide/* (manifest). Writes the installed
 * version on <html> so the site can show «Installed ✓» instead of the install button.
 * Reads nothing from the page and sends nothing anywhere. */
(function () {
  try { document.documentElement.setAttribute('data-syf-installed', chrome.runtime.getManifest().version); } catch (e) { /* page gone */ }
}());
