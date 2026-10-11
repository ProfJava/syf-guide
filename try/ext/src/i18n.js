/* SYF — i18n engine.  (spec: specs/i18n-language-switch.md)
 *
 * The msgid IS the Arabic source string (spec, decision two). Three consequences,
 * because they are the whole reason the model was chosen:
 *   · A missing entry returns the msgid, so the interface degrades to ARABIC —
 *     never to a blank, never to a raw key. A half-finished translation ships.
 *   · A tool's own `name` field is already a msgid. The 41 tool definitions are not
 *     touched at all; only the places that RENDER a name wrap it in t().
 *   · There is no key table to drift out of date, so nothing can silently rot.
 *
 * WHY THE DICTIONARY IS FETCHED, AND WHY THAT IS NOT A RACE
 * Only two kinds of user-visible text are evaluated at FILE LOAD time — tool names
 * and category labels — and neither is read until something renders. Everything else
 * lives inside mount(), which runs on a click. rail.js already waits on a Promise.all
 * of stored preferences before it builds anything, so the dictionary joins that wait
 * and costs no extra wall clock. The alternative (a synchronous dictionary in the
 * manifest) would make every Arabic user — the default — parse an English table they
 * will never read, on every page they visit.
 *
 * It is JSON, not JS, on purpose: a dictionary is DATA. Shipped as a script it would
 * be one more thing that executes on every page for no reason.
 *
 * chrome.i18n is deliberately unused: it reads the BROWSER's language and cannot be
 * switched from inside an extension, which is the one thing this feature is for.
 * _locales/ still owns the store listing (Chrome reads that, we do not). */
(function () {
  window.SYFS = window.SYFS || {};

  var LANGS = ['ar', 'en'];
  var DEFAULT = 'ar';
  var lang = DEFAULT;
  /* ⚠️ DEFAULT is the fallback, not the policy on a fresh install. On a FRESH INSTALL the worker
     guesses from the browser's languages and stores the result (background.js
     › guessUiLang), then the rail asks the user to confirm it (`askLang`).
     v0.88.0 refused to guess at all — right on its own, wrong once there is a
     card that shows the guess and takes one click to overrule. This value is
     what applies when nothing is stored: an upgrade from before v0.90.0, a
     failed write, or a page that renders before the read comes back. */
  var dicts = {};                                  /* lang -> object (only ever fetched once) */
  var pending = {};                                /* lang -> Promise */
  var subs = [];

  /* A context separator for the rare msgid needing two translations: the same Arabic
     word in two roles (a noun vs a button). Everything after it is disambiguation for
     the translator and never reaches the screen. */
  var CTX = '‖';

  function bare(id) {
    var i = id.indexOf(CTX);
    return i < 0 ? id : id.slice(0, i);
  }

  /* t(msgid) → the current language's text, or the msgid itself.
     t(msgid, a, b) → the same with {0}/{1} filled in.
     ⚠️ Placeholders, never concatenation: word order differs between the languages,
     and a sentence glued together in source order can only be right in one of them.
     This must never throw — it runs inside every render path there is. */
  function t(id) {
    if (typeof id !== 'string') return '';
    var s = null;
    var d = (lang !== DEFAULT) ? dicts[lang] : null;
    if (d) {
      var v = d[id];
      if (typeof v === 'string' && v) s = v;
    }
    if (s === null) s = bare(id);
    if (arguments.length > 1) {
      var a = arguments;
      s = s.replace(/\{(\d+)\}/g, function (m, i) {
        var x = a[(+i) + 1];
        return x === undefined ? m : String(x);
      });
    }
    return s;
  }

  function valid(v) { return LANGS.indexOf(v) >= 0 ? v : DEFAULT; }

  /* Load a language's table. Resolves with the language actually in force — which is
     Arabic if the fetch failed, because a missing dictionary must degrade, not break.
     The path is built from the WHITELISTED value, never from the stored string. */
  function load(v) {
    var want = valid(String(v || ''));
    if (want === DEFAULT || dicts[want]) return Promise.resolve(want);
    if (pending[want]) return pending[want];
    pending[want] = fetch(chrome.runtime.getURL('i18n/' + want + '.json'))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        /* a dictionary is a flat string→string map; anything else is discarded whole
           rather than half-trusted */
        dicts[want] = (j && typeof j === 'object' && !Array.isArray(j)) ? j : {};
        return want;
      })
      .catch(function () { dicts[want] = {}; return want; });
    return pending[want];
  }

  /* A stored value is not trusted for having been stored by us: it ends up in a `dir`
     attribute and in a resource path, so it is whitelisted on the way in. */
  function set(v) {
    var next = valid(String(v || ''));
    if (next === lang) return false;
    lang = next;
    for (var i = 0; i < subs.length; i++) { try { subs[i](lang); } catch (e) {} }
    return true;
  }

  /* the one call every surface makes at startup: fetch if needed, then switch */
  function apply(v) {
    return load(v).then(function (l) { set(l); return l; });
  }

  /* ---- translating a BUILT tree -------------------------------------------
   * Most of this interface is written as HTML template literals handed to each
   * module's h(). Splitting ~500 of those by hand would mean editing markup in
   * 21 files to inject calls — a lot of churn and a lot of chances to break a tag.
   *
   * The msgid model makes that unnecessary: the text in those templates ALREADY is
   * the msgid, so the tree can be translated after it is built. h() calls this once
   * and every template in the file is covered, with the markup never touched.
   *
   * In the default language this returns on the first line, so Arabic — which is
   * every user until they choose otherwise — pays nothing at all.
   *
   * Only text nodes and four human-readable attributes are visited. `value` is
   * deliberately excluded: on an <input> it is data, and translating it would edit
   * what the user is about to submit. */
  var ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip'];
  /* ⚠️ Never descend into these. While tree() only ever ran on h()-built fragments it
     could not meet one; since v0.97.0 it also runs on a whole page <body>, where a
     <script>'s or <style>'s text is a CHILD TEXT NODE like any other. A CSS or JS
     body will not match a msgid today, but "does not match yet" is not a rule — and
     rewriting either would be silent and total. <textarea> is here for a different
     reason: its text is the user's DATA, the same reason `value` is excluded below. */
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1 };
  /* `translate="no"` (the HTML attribute browsers' own translators honour) closes a
     subtree too — the Quran text on kids.html (v0.181.0): an ayah must never be swapped
     for a dictionary entry, however unlikely a match is. */

  function swap(s) {
    /* preserve the surrounding whitespace: templates are indented, and a trimmed
       replacement would collapse the layout of anything relying on it */
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    if (!m || !m[2]) return null;
    var out = t(m[2]);
    return out === m[2] ? null : m[1] + out + m[3];
  }

  function tree(el) {
    if (lang === DEFAULT || !el || !dicts[lang]) return el;
    try {
      /* attributes on the root itself — createTreeWalker only visits descendants */
      var stack = [el];
      while (stack.length) {
        var n = stack.pop();
        if (n.nodeType === 1) {
          if (SKIP_TAGS[n.tagName] || n.getAttribute('translate') === 'no') continue;
          for (var i = 0; i < ATTRS.length; i++) {
            if (!n.hasAttribute(ATTRS[i])) continue;
            var v = swap(n.getAttribute(ATTRS[i]));
            if (v !== null) n.setAttribute(ATTRS[i], v);
          }
          for (var c = n.firstChild; c; c = c.nextSibling) stack.push(c);
        } else if (n.nodeType === 3) {
          var s = swap(n.nodeValue);
          if (s !== null) n.nodeValue = s;         /* a text node, never markup */
        }
      }
    } catch (e) { /* a half-translated tree still reads; a thrown one shows nothing */ }
    return el;
  }

  SYFS.t = t;
  SYFS.i18n = {
    tree: tree,
    KEY: 'ui_lang',
    /* true while the install-time guess is still UNCONFIRMED. Cleared by any
       explicit choice — the card's buttons and the settings panel alike, since
       both are the user answering the same question. */
    ASK_KEY: 'ui_lang_ask',
    LANGS: LANGS.slice(),
    DEFAULT: DEFAULT,
    get: function () { return lang; },
    set: set,
    apply: apply,
    load: load,
    valid: valid,
    /* the layout direction is a property of the LANGUAGE, not a separate setting —
       two switches for one fact is how a panel starts contradicting itself */
    dir: function (l) { return valid(l || lang) === 'ar' ? 'rtl' : 'ltr'; },
    /* ⚠️ The CLDR locale is a property of the language for the same reason, and it is
       the one thing the dictionary CANNOT fix: `toLocaleDateString('ar-EG')` written
       literally ships Arabic-Indic digits and Arabic month names into an English panel
       no matter how complete i18n/en.json is (§6.101/6). Every date, time and number
       formatter in the extension reads its locale from here. */
    locale: function (l) { return valid(l || lang) === 'ar' ? 'ar-EG' : 'en-GB'; },
    onChange: function (fn) { if (typeof fn === 'function') subs.push(fn); },
    /* true when a real translation exists. Used by the tests; deliberately NOT used
       by any rendering path — an interface that looked different for missing strings
       would hide exactly the gaps we want to see. */
    has: function (id) { var d = dicts[lang]; return !!(d && typeof d[id] === 'string' && d[id]); }
  };

  /* ---- standalone pages: translate the STATIC markup too (v0.97.0) -------------
   * Until now tree() only ever saw what h() built, so a page's own <body> — its
   * toolbar labels, its drop-zone copy, its privacy notes — stayed Arabic no matter
   * how full the dictionary was. Nothing was missing from i18n/en.json; nothing was
   * ever asking.
   *
   * ⛔ OPT-IN, and that is not caution for its own sake. help.html is prose broken by
   * <b> on purpose, and translating it one text node at a time is precisely the
   * failure that made it a second PAGE instead (§6.100). A page earns this attribute
   * only after its markup has been checked for sentences split mid-clause.
   *
   * Self-binding for the same reason src/fontkit.js is: an inline <script> calling
   * this would be blocked by the extension-page CSP, and every page would otherwise
   * repeat the same six lines. Content scripts are skipped — there `location` is the
   * HOST page and the rail drives its own shadow wrap. */
  function bindPage() {
    var root = document.documentElement;
    function paint(l) {
      /* ⚠️ Attribute AND property together: these pages hard-code dir="rtl" in their
         markup, and a CSS variable alone never reaches an attribute (§6.98/8). */
      root.setAttribute('lang', l);
      root.setAttribute('dir', SYFS.i18n.dir(l));
      root.style.setProperty('--syfs-dir', SYFS.i18n.dir(l));
      if (document.body) tree(document.body);
    }
    var stored = 'ar';
    try {
      chrome.storage.local.get({ ui_lang: 'ar' }, function (r) {
        /* whitelisted, not sanitised: it builds a resource path and a dir attribute */
        stored = (r && r.ui_lang === 'en') ? 'en' : 'ar';
        apply(stored).then(function (l) {
          if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { paint(l); });
          else paint(l);
        });
      });
    } catch (e) { /* no storage → the page stays Arabic, which is the fallback anyway */ }
  }
  try {
    if (location.protocol === 'chrome-extension:' &&
        document.documentElement.getAttribute('data-syfs-i18n') === 'page') bindPage();
  } catch (e) {}
}());
