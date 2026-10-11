/* SYF — the one door the rail does not own (v0.98.0).
 *
 * `options_ui.page` is help.html and CHROME opens it itself: from chrome://extensions,
 * from the puzzle-piece menu, from the extension's own context menu. That request never
 * passes through us, so an English reader lands on the ARABIC guide and reasonably
 * concludes the translation is broken (§6.100/9 stated this limit; this file closes it).
 * The rail's 📖 already picks the right twin — it is the only entrance that did.
 *
 * ⚠️ Loaded in <head> of help.html ONLY, and it is the ONLY script there. help-en.html
 * must never carry it: the two pages would forward to each other forever.
 *
 * `?stay=1` is what keeps the toggle alive. The "الدليل بالعربية" link on help-en.html
 * carries it; without it that button would bounce straight back to English and read as
 * dead. It is a NAVIGATION marker, not a preference — nothing stores it, and reloading
 * without it forwards again, which is correct: `ui_lang` is still English.
 *
 * The gate attribute hides the body for as long as the answer takes, because a flash of
 * Arabic prose followed by an English page is exactly the fault we are fixing. It has a
 * hard 400ms failsafe: chrome.storage answering late must cost a flash, never a blank
 * page.  ⛔ Do not move the reveal into the storage callback alone. */
(function () {
  'use strict';
  var root = document.documentElement;
  if (/[?&]stay=1/.test(location.search)) return;

  var shown = false;
  function show() {
    if (shown) return;
    shown = true;
    root.removeAttribute('data-lang-gate');
  }
  root.setAttribute('data-lang-gate', '');
  var failsafe = setTimeout(show, 400);

  /* ⚠️ v0.139.0 — more than one Arabic page has an English twin: help.html and
     guide-slides.html (the gallery guide.html was removed in v0.150.0). The destination is derived from THIS page's own file name rather than
     written here, so adding a third twin needs no edit and cannot be forgotten.
     ⛔ It is still a WHITELIST, not a derivation from anything the page could supply:
     the name is matched against a fixed table, and an unknown page simply shows
     itself. A `location.replace` built from an arbitrary string is a navigation the
     user did not ask for (§6.102/7). */
  var TWIN = { 'help.html': 'help-en.html', 'guide-slides.html': 'guide-slides-en.html' };
  var here = location.pathname.split('/').pop();
  var twin = TWIN[here];
  if (!twin) { clearTimeout(failsafe); show(); return; }

  try {
    /* whitelisted, not sanitised: the value picks a page to navigate to (§6.102/7) */
    chrome.storage.local.get({ ui_lang: 'ar' }, function (r) {
      clearTimeout(failsafe);
      if (r && r.ui_lang === 'en') { location.replace(twin); return; }
      show();
    });
  } catch (e) { clearTimeout(failsafe); show(); }
}());
