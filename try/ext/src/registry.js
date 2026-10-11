/* SYF — eager category registry (lazy-load bootstrap).
 * Loaded at document_idle AFTER tools.js/tools2.js (which build SYFS.cats) and
 * BEFORE rail.js. Its only job: declare the category metadata (label + icon) for
 * categories whose tool bodies are LAZY-injected on demand (src/media.js,
 * src/dev.js, src/shield.js, src/ai-chat.js, src/calc.js). Without this, those
 * category buttons could not render on the rail until their (deferred) file is
 * injected — this lets the rail show every category button immediately while the
 * heavy tool code loads only when the user first opens the rail's tools.
 *
 * These same objects are re-set (identically) by each lazy file when it loads, so
 * this file is purely additive and never conflicts. */
(function () {
  window.SYFS = window.SYFS || {};
  SYFS.cats = SYFS.cats || {};

  /* mirror of the cat metadata that lives in each lazy tool file */
  var LAZY_CATS = {
    /* «المستندات» (v0.77.0) is the one category with NO owning file: its seven
       tools are spread over five lazy files (word-launch, sheet-launch,
       slides-launch, mail-launch, docview) plus media.js, and none of them has
       any more right to define the category than the others. So this is its only
       definition — do not "mirror" it into a tool file.
       A page with a second page behind it: the plural is the whole point of the
       name, and no single member of the category wears a stack. */
    docs:   { label: 'المستندات',      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6l4 4v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M15 3v4h4"/><path d="M5 7v12a2 2 0 0 0 2 2h9"/></svg>' },
    media:  { label: 'الصور',          icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="15" height="15" rx="2"/><circle cx="7.5" cy="7.5" r="1.3"/><path d="M18 13.5l-4-4-8 8"/><path d="M18 8h1a2 2 0 012 2v9a2 2 0 01-2 2h-9a2 2 0 01-2-2v-1"/></svg>' },
    dev:    { label: 'مطوّرين',         icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6l-5 6 5 6"/><path d="M16 6l5 6-5 6"/></svg>' },
    shield: { label: 'الحماية',         icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M9.3 12l1.9 1.9 3.5-3.8"/></svg>' },
    /* v0.148.0 — 'ai' is a category again: `sam-ai` (lazy, src/ai-chat.js) + the AI site
       links (eager, src/tools2.js). Mirror of src/ai-chat.js SYFS.cats.ai.
       'uae' was merged into calc's tax tool and stays removed. */
    ai:     { label: 'المساعد الذكي',  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 01-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1121 11.5z"/><path d="M9 10v1M15 10v1"/><path d="M9.5 14.3c1.5 1 3.5 1 5 0"/></svg>' }
  };
  Object.keys(LAZY_CATS).forEach(function (k) { if (!SYFS.cats[k]) SYFS.cats[k] = LAZY_CATS[k]; });

  /* ids of the lazy categories, so rail.js can show their buttons (empty until
   * the tool bodies are injected on first use) */
  SYFS.LAZY_CATS = Object.keys(LAZY_CATS);

  /* ===== وضع العمل — the one opener =====
   * Every way into the workspace calls this: the rail button, the `appmode` hotkey,
   * the regex lab's fallback and the workspace dock's «نافذة مستقلّة» (mode 'window').
   * The worker focuses the workspace that is already open instead of making a copy.
   * A worker that does not answer (the extension was updated and this page still runs
   * the old content script) used to fail with nothing on screen at all — now it says
   * what to do. Resolves true once the workspace is open or focused. */
  SYFS.openApp = function (mode) {
    return new Promise(function (resolve) {
      function fail() {
        if (SYFS.toast) SYFS.toast(SYFS.t('وضع العمل'), SYFS.t('تعذّر فتح وضع العمل — أعد تحميل الصفحة ثم حاول مجدداً.'), { timeout: 5000 });
        resolve(false);
      }
      try {
        chrome.runtime.sendMessage({ type: 'SYFS_OPEN_APP', mode: mode === 'window' ? 'window' : 'tab' }, function (r) {
          if (chrome.runtime.lastError || !r || !r.ok) { fail(); return; }
          resolve(true);
        });
      } catch (e) { fail(); }
    });
  };

  /* ===== وضع العمل — App Mode entry (registered as a tool so the existing
   * keyboard-shortcut machinery can bind a combo to it). `action` asks the
   * worker to open app.html in its own tab. `noRail: true` keeps it OUT of the
   * rail's category flyouts and the manager's show/hide list (it has its own
   * dedicated rail button), but it still appears in the shortcut picker. It is
   * eager (here, not lazy) so a hotkey works without injecting the tool bodies. */
  SYFS.tools = SYFS.tools || [];
  SYFS.tools.push({
    id: 'appmode',
    name: 'وضع العمل (كل الأدوات في شاشة مستقلة)',
    cat: 'util',
    noRail: true,
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    action: function () { SYFS.openApp(); }
  });

  /* ===== «املأ الفورم» by keyboard (user decision 2026-10: a sixth shipped default) =====
   * The form-fill tool lives in src/extras.js, which is LAZY — a lazy file may not declare
   * a default hotkey (tools/lazy-test.js): idForCombo() only sees tools already in
   * SYFS.tools. So the combo sits on this eager stub, which injects the bodies on the
   * first press and then runs SYFS.formfillQuick() (saved profile, else test data; a
   * toast with the count and «تراجع»; never submits, never fills passwords).
   * hotkeyAnywhere: the caret is usually IN the form when you want it filled. */
  SYFS.tools.push({
    id: 'formfillnow',
    name: 'ملء الفورم بلمسة (بيانات تجريبية أو بروفايلك)',
    cat: 'util',
    noRail: true,
    hotkey: 'Ctrl+Alt+KeyF',
    hotkeyAnywhere: true,
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h5"/><path d="M13 20l1-3.5 4.5-4.5 2.5 2.5-4.5 4.5z"/></svg>',
    action: function () {
      if (!SYFS.ensureTools) return;
      SYFS.ensureTools(function (ok) {
        if (ok !== false && SYFS.formfillQuick) { SYFS.formfillQuick(); return; }
        if (SYFS.toast) SYFS.toast(SYFS.t('الملء التلقائي للفورمات'), SYFS.t('تعذّر تحميل الأدوات'), { timeout: 3000 });
      });
    }
  });
}());
