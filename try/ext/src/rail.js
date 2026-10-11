/* SYF — content script.
 * Builds a Shadow-DOM-isolated floating rail + draggable tool windows over any page.
 * Styles never leak to/from the host page (closed-ish shadow root + scoped CSS). */
(function () {
  /* the «try it» site runs its own copy of this rail (specs/web-demo-site.md §7): an
     installed copy steps aside there, so the visitor sees one bar and the demo's data
     never mixes with theirs. manifest exclude_matches covers the site's address; this
     covers any other address it is served from. The demo's copy has SYF_DEMO (set by
     its chrome.* stub) — the installed one, in its isolated world, never does. */
  if (!window.SYF_DEMO && document.querySelector('meta[name="syf-demo"]')) return;
  if (window.__SYFS_INJECTED) return;          // guard against double injection
  window.__SYFS_INJECTED = true;

  var SYFS = window.SYFS || {};
  var store = SYFS.store, tools = SYFS.tools || [], cats = SYFS.cats || {};
  var root, host, zTop = 10, openCats = {}, openWins = {}, frameSeq = 0, frameOpen = 0;
  /* lazy tool loading: only the bootstrap (storage/registry/tools/rail) is injected
   * on every page; the heavy tool bodies are injected on first use (ensureTools). */
  var toolsLoaded = false, toolsLoading = false, pendingCbs = [];
  /* هويّة هذا المستند عند العامل (مراجعة 2026-09-19): يحفظها مع رقم التبويب، فمستندٌ جديد في نفس
     التبويب (F5، تنقّل إلى نفس العنوان) يُحقَن من جديد بدل أن يُجاب بـ`already`. */
  var DOC_ID = (function () {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }());

  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    /* the template's own text IS the msgid — translate the built tree rather than
       splitting the markup (see src/i18n.js). Free in the default language. */
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }

  /* ---------- one flyout tool button (the single builder for all three callers) ----------
   * Markup is identical in both display modes (dock_labels): the name lives in its own
   * span that CSS shows in «list» mode and hides in «icons» mode, where the JS tooltip
   * below shows it instead. The name is ALWAYS written with textContent / setAttribute —
   * custom links carry a user-supplied name, so it must never reach an HTML string.
   * The icon is an internal, trusted SVG constant. */
  function toolBtn(name, iconHtml) {
    var b = h('<button class="syfs-tool-btn"><span class="syfs-tb-ic"></span><span class="syfs-tb-nm"></span></button>');
    b.querySelector('.syfs-tb-ic').innerHTML = iconHtml || '';
    b.querySelector('.syfs-tb-nm').textContent = name;
    b.dataset.tip = name;
    b.setAttribute('aria-label', name);
    return b;
  }

  /* ---------- favorites (star a tool → quick-access category at the top) ---------- */
  var favs = [];
  function toolById(id) { for (var i = 0; i < tools.length; i++) if (tools[i].id === id) return tools[i]; return null; }

  /* EVERY path that opens a tool goes through here — the shelf, the palette, a
     hotkey, the favourites, the activity panel itself. One choke point is what
     makes "opened this session" true rather than approximately true; five copies
     of `if (t.action) …` were also five places to forget. */
  function runTool(t) { if (!t) return; noteUse(t.id); if (t.action) t.action(); else openWindow(t); }
  /* fire-and-forget: the worker remembers, the page never waits. lastError is read
     so a missing worker (extension reloading) does not log an unchecked error. */
  function noteUse(id) {
    try {
      chrome.runtime.sendMessage({ type: 'SYFS_ACT', op: 'note', id: id }, function () { void chrome.runtime.lastError; });
    } catch (e) {}
  }
  function isFav(id) { return favs.indexOf(id) >= 0; }
  /* The favourites button now opens the shared shelf like any other category, so
     this only decides whether the button exists at all — and refreshes the panel
     if the user stars something while it is open. */
  function renderFav() {
    if (!root) return;
    var favCat = root.querySelector('.syfs-favcat');
    if (!favCat) return;
    favCat.style.display = favs.length ? '' : 'none';
    updateFoldCount();
    if (!favs.length && openCatKey === '__fav') { closeShelf(); return; }
    if (openCatKey === '__fav') openShelf('__fav', 'المفضلة', catItems('__fav', favs.map(toolById).filter(Boolean)), favCat);
  }
  function refreshStars() { if (root) root.querySelectorAll('.syfs-win-star, .syf-mg-fav').forEach(function (b) { b.classList.toggle('on', isFav(b.dataset.id)); }); }
  function toggleFav(id) { var i = favs.indexOf(id); if (i >= 0) favs.splice(i, 1); else favs.push(id); store.set('favorites', favs); renderFav(); refreshStars(); }

  /* ---------- custom in-page keyboard shortcuts (tool id → combo) ---------- */
  var hotkeys = {}; /* { toolId: "Ctrl+Alt+KeyC" } */ var hkListening = false;
  var MODNAMES = { Alt: 1, Control: 1, Shift: 1, Meta: 1 };
  /* build a canonical, layout-independent combo from a KeyboardEvent; needs a non-Shift modifier */
  function comboFromEvent(e) {
    if (MODNAMES[e.key]) return null;
    if (!(e.ctrlKey || e.altKey || e.metaKey)) return null; /* require Ctrl/Alt/Meta so plain typing is never hijacked */
    var p = [];
    if (e.ctrlKey) p.push('Ctrl');
    if (e.altKey) p.push('Alt');
    if (e.shiftKey) p.push('Shift');
    if (e.metaKey) p.push('Meta');
    p.push(e.code || e.key);
    return p.join('+');
  }
  function comboLabel(c) { return c.replace(/Key([A-Z])/g, '$1').replace(/Digit(\d)/g, '$1').replace(/\+/g, ' + '); }
  /* A tool may DECLARE a default combo (`hotkey: 'Ctrl+Alt+KeyW'`). It is the binding the
     tool ships with, and nothing more: the user's own entry for that id always wins,
     and removing it stores `false` so the default stays gone. Kept for a handful of
     one-keystroke actions (open WhatsApp, toggle its blur) — NOT a flat scheme for
     every tool; the leader chord below is that (§6.104/1). Derived, never copied into
     `hotkeys`, so a shipped default can change without a migration. */
  function hkUser(id) { return hotkeys.hasOwnProperty(id); }
  function hkOf(id) {
    if (hkUser(id)) return typeof hotkeys[id] === 'string' ? hotkeys[id] : null;
    var t = toolById(id);
    return (t && typeof t.hotkey === 'string') ? t.hotkey : null;
  }
  function idForCombo(combo) {
    for (var id in hotkeys) if (hotkeys.hasOwnProperty(id) && hotkeys[id] === combo) return id;
    for (var i = 0; i < tools.length; i++) if (tools[i].hotkey === combo && !hkUser(tools[i].id)) return tools[i].id;
    return null;
  }
  function runHotkey(combo) {
    var id = idForCombo(combo); if (!id) return false;
    var t = toolById(id);
    if (!t) {
      /* a hotkey targeting a not-yet-injected tool: load, then open it */
      if (!toolsLoaded) { ensureTools(function () { runTool(toolById(id)); }); return true; }
      return false;
    }
    runTool(t);
    return true;
  }
  function setHotkey(id, combo) {
    /* one combo per tool; a combo already used by another tool is moved to this one */
    var owner = idForCombo(combo); if (owner && owner !== id) unbind(owner);
    hotkeys[id] = combo; store.set('hotkeys', hotkeys);
  }
  /* a tool with a shipped default is silenced with `false`, not deleted — deleting
     would bring the default straight back */
  function unbind(id) { var t = toolById(id); if (t && t.hotkey) hotkeys[id] = false; else delete hotkeys[id]; }
  function clearHotkey(id) { unbind(id); store.set('hotkeys', hotkeys); }
  function installHotkeys() {
    if (hkListening) return; hkListening = true;
    document.addEventListener('keydown', function (e) {
      if (hkRecording) return; /* recording UI consumes the event itself */
      var path = e.composedPath ? e.composedPath() : [e.target];
      var real = path[0] || e.target;
      var tag = (real && real.tagName || '').toLowerCase();
      if (real && (real.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select')) {
        /* ⚠️ v0.140.9 — typing is left alone, EXCEPT a tool that declares
           `hotkeyAnywhere`: the WhatsApp/Messenger blur is a privacy key, and on
           those sites the caret lives in the message box — WhatsApp moves focus there
           on the first keystroke, so Ctrl+Alt+B turned the blur ON (focus still on the
           page) and the second Ctrl+Alt+B, now inside the box, was swallowed and could
           never turn it OFF. preventDefault also stops macOS typing «∫» into the chat. */
        var fc = comboFromEvent(e), fid = fc && idForCombo(fc), ft = fid && toolById(fid);
        if (ft && ft.hotkeyAnywhere) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) runTool(ft); }
        return;
      }
      /* an armed chord owns the next keystroke — before the modifier test below,
         because the second and third keys of a chord are PLAIN letters */
      if (chordEl && chordEl.classList.contains('on')) { chordKey(e); return; }
      /* ⌘K / Ctrl+K opens the palette — the chip under the magnifier promises it,
         and a promised shortcut that does nothing is worse than none. Claimed
         before the user's own bindings so it cannot be shadowed by accident. */
      /* ⚠️ …but it is ALSO «insert link» in Google Docs, the switcher in Slack and Notion,
         and the command bar on GitHub — a combination every second web app owns. So it
         obeys the same master switch as the leader (`hk_defaults`) and stands down while
         the rail is hidden: a bar the user switched off must not keep a key from the
         page (مراجعة 2026-09-19). The chip under the magnifier still says ⌘K, which stays true
         whenever the bar is on screen. */
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.code === 'KeyK')
          && hkDefaults && host && host.style.display !== 'none') {
        e.preventDefault(); e.stopPropagation();
        ensureTools(function () { openPalette(); });
        return;
      }
      var combo = comboFromEvent(e); if (!combo) return;
      /* a held combo auto-repeats: a toggle (blur, the bar) flipped on every repeat and
         landed on whatever the last one left — swallow the repeats of OUR combos only */
      if (e.repeat && (idForCombo(combo) || combo === HK_LEADER)) { e.preventDefault(); e.stopPropagation(); return; }
      /* an OFF rail (never built) keeps exactly one key: the one that turns it back on */
      if (!railBuilt) {
        if (idForCombo(combo) === 'railtoggle') { e.preventDefault(); e.stopPropagation(); setEnabled(true); }
        return;
      }
      /* the user's own binding is checked FIRST: someone who deliberately put a tool
         on Ctrl+Alt+K meant it, and the built-in leader must not shadow their choice */
      if (runHotkey(combo)) { e.preventDefault(); e.stopPropagation(); return; }
      /* the sheet is drawn inside the (hidden) host — an armed chord nobody can see would
         eat the next keystrokes for HK_HOLD ms with nothing on screen to explain it */
      if (hkDefaults && combo === HK_LEADER && host && host.style.display !== 'none') {
        e.preventDefault(); e.stopPropagation();
        /* the sheet names every tool, so the bodies have to exist to be named */
        if (!toolsLoaded) ensureTools(function () { chordReset(); chordOpen(); }); else chordOpen();
      }
    }, true);
  }
  var hkRecording = false;
  /* ⛔ مسجّل الاختصارات يضع مستمعاً **بالتقاط** على `document` أول سطرين فيه
     `preventDefault` + `stopPropagation` لكل مفتاح. حتى v0.103.0 كان لا يُنزَع إلا من
     داخل نفسه (Esc أو توليفة صالحة) ⇒ إغلاق نافذة الإعدادات وهو مسلَّح — أو تبديل اللغة
     الذي يزيل كل النوافذ — يترك الصفحة كلها بلا لوحة مفاتيح: بحث الموقع وحقل الدخول
     وصندوق المحادثة كلها ميتة بلا أي أثر على الشاشة، ولا علاج إلا إعادة تحميل التبويب.
     ⇒ مالكٌ واحد: من يُسلّح يسجّل ناقض تسليحه هنا، وكل مسار يزيل اللوحة ينادي `hkDisarm`. */
  var hkCancel = null;
  function hkDisarm() { var f = hkCancel; hkCancel = null; if (f) { try { f(); } catch (e) {} } }

  /* ===== a default shortcut for EVERY tool: one leader, then two keys (v0.99.0) ====
   * The custom bindings above are one combo per tool and the user assigns them by
   * hand. This is the other half: every tool reachable from the keyboard on a fresh
   * install, without the user configuring anything.
   *
   * ⚠️ IT CANNOT BE ONE COMBO PER TOOL. There are ~80 tools and about 30 usable
   * `Alt+<letter>` combinations, so a flat scheme runs out after a third of them and
   * spends that third fighting the page: Alt+letter is a live shortcut on Gmail, on
   * Docs, on every editor. A LEADER solves both at once — exactly one combination is
   * taken from the web, and everything after it is a plain letter that only this
   * extension is listening for.
   *
   * The two levels are the rail's own shape (category, then tool), not an invented
   * encoding: `Ctrl+Alt+K i q` is «islam → quran», and the sheet that appears after the
   * leader is the same list the rail would have shown. That is also the answer to
   * discoverability, which is what usually kills chord schemes — nobody memorises
   * eighty bindings, and nobody has to.
   *
   * ⚠️ Keys come from `event.code`, never `event.key` (§5.6/11): on an Arabic layout
   * `key` is «ق» and every binding in this file would be unreachable — the exact bug
   * class the YouTube+ panel already documents.
   *
   * The assignment is DERIVED, never stored: first free letter of the id, then any
   * free letter, then a digit. Storing it would freeze today's tool list into a file
   * that outlives it, and a stored map is one more thing to migrate on every split
   * like athkar/wird. The cost is that adding a tool can shift a letter — which is
   * why the sheet is always on screen while the chord is open. */
  var HK_LEADER = 'Ctrl+Alt+KeyK';        /* the only combination this scheme takes from the page */
  var HK_HOLD = 4000;                /* an abandoned chord must not stay armed */
  var hkDefaults = true;             /* `hk_defaults` — the master switch the user asked for */
  var chordCache = null, chordEl = null, chordCat = null, chordT = 0;

  function chordChar(e) {
    var c = e.code || '';
    if (/^Key[A-Z]$/.test(c)) return c.slice(3).toLowerCase();
    if (/^Digit[0-9]$/.test(c)) return c.slice(5);
    return '';
  }
  /* first free letter of the id, then any free letter, then a digit */
  function chordPick(id, used) {
    var src = String(id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    var pool = src + 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (var i = 0; i < pool.length; i++) if (!used[pool[i]]) return pool[i];
    return '';
  }
  function chordCats() {
    var byCat = {};
    tools.forEach(function (t) { if (isHidden(t.id) || t.noRail) return; (byCat[t.cat] = byCat[t.cat] || []).push(t); });
    var known = ORDER.concat(Object.keys(cats), Object.keys(byCat));
    var list = known.filter(function (v, i, a) {
      return a.indexOf(v) === i && !isCatHidden(v) && byCat[v] && byCat[v].length;
    });
    list.sort(function (a, b) { return catRank(a) - catRank(b); });
    return list;
  }
  function chordMap() {
    if (chordCache) return chordCache;
    var used = {}, out = [];
    chordCats().forEach(function (ck) {
      var k = chordPick(ck, used); if (!k) return;
      used[k] = 1;
      var tused = {}, items = [];
      catTools(ck).forEach(function (t) {
        /* ⚠️ strip the `lnk-` namespace first. It is an id prefix, not a word: left in,
           the whole Links category spells itself out of "l", "n", "k" and Gmail ends up
           on L. A derived letter is only worth having when it is the letter the user
           would have guessed. */
        var tk = chordPick(t.id.replace(/^lnk-/, ''), tused); if (!tk) return;
        tused[tk] = 1; items.push({ key: tk, id: t.id, name: t.name });
      });
      if (items.length) out.push({ key: k, cat: ck, label: (cats[ck] || {}).label || ck, items: items });
    });
    chordCache = out;
    return out;
  }
  /* the tool list grows when the lazy bodies land and changes when a tool is hidden */
  function chordReset() { chordCache = null; if (chordEl) chordClose(); }

  function chordClose() {
    clearTimeout(chordT); chordT = 0; chordCat = null;
    if (chordEl) chordEl.classList.remove('on');
  }
  function chordArm() { clearTimeout(chordT); chordT = setTimeout(chordClose, HK_HOLD); }
  function chordFlash() { if (chordEl) { chordEl.classList.remove('bad'); void chordEl.offsetWidth; chordEl.classList.add('bad'); } }

  function chordRender() {
    var w = root && root.querySelector('.syfs-wrap'); if (!w) return;
    if (!chordEl || !chordEl.isConnected) {
      chordEl = h('<div class="syfs-chord" role="dialog" aria-modal="false">'
        + '<div class="syfs-chord-head"><span class="syfs-chord-title"></span>'
        + '<span class="syfs-chord-esc"></span></div><div class="syfs-chord-grid"></div></div>');
      w.appendChild(chordEl);
    }
    var grid = chordEl.querySelector('.syfs-chord-grid');
    grid.textContent = '';
    var rows = chordCat
      ? chordCat.items.map(function (it) { return [it.key, SYFS.t(it.name)]; })
      : chordMap().map(function (g) { return [g.key, SYFS.t(g.label)]; });
    chordEl.querySelector('.syfs-chord-title').textContent = chordCat
      ? SYFS.t('اختر أداة من «{0}»', SYFS.t(chordCat.label))
      : SYFS.t('اختر تصنيفاً');
    chordEl.querySelector('.syfs-chord-esc').textContent = SYFS.t('Esc للإلغاء');
    rows.forEach(function (r) {
      var row = h('<div class="syfs-chord-row"><kbd></kbd><span></span></div>');
      row.querySelector('kbd').textContent = r[0].toUpperCase();   /* i18n-dyn: a keycap */
      row.querySelector('span').textContent = r[1];                /* i18n-dyn: translated above */
      grid.appendChild(row);
    });
    chordEl.classList.add('on');
    chordArm();
  }
  /* opened by the leader, and by the «show them» button in the keyboard tab */
  function chordOpen() { chordCat = null; chordRender(); }

  function chordKey(e) {
    if (MODNAMES[e.key]) return;                     /* a modifier alone is not an answer */
    if (e.key === 'Escape' || e.key === 'Tab') { chordClose(); e.preventDefault(); e.stopPropagation(); return; }
    e.preventDefault(); e.stopPropagation();         /* armed means armed — the page sees nothing */
    var k = chordChar(e), hit = null;
    if (!k) { chordFlash(); chordArm(); return; }
    if (chordCat) {
      chordCat.items.forEach(function (it) { if (it.key === k) hit = it; });
      if (!hit) { chordFlash(); chordArm(); return; }
      var id = hit.id;
      chordClose();
      var t = toolById(id);
      if (t) runTool(t); else ensureTools(function () { var t2 = toolById(id); if (t2) runTool(t2); });
      return;
    }
    chordMap().forEach(function (g) { if (g.key === k) hit = g; });
    if (!hit) { chordFlash(); chordArm(); return; }
    chordCat = hit; chordRender();
  }

  /* ---------- show/hide tools + categories + custom link shortcuts + order ---------- */
  var hidden = [], customLinks = [], hiddenCats = [], catOrder = [], dragCat = null, toolOrder = {};
  /* the bar folded into its badge (`dock_folded`). Restored on every page load,
     so a user who tucked the rail away does not meet it again on the next site. */
  var railFolded = false;
  /* within-category tool order: { cat: [toolId, …] }. Tools not listed keep their
   * declaration order (rank 1000, stable sort). */
  /* A stored order (the user dragged rows in the manager) wins outright; with none,
   * fall back to the shipped default for that category. DEFAULT_TOOL_ORDER is
   * declared further down with ORDER — both are only ever read at build time. */
  function toolRank(ck, id) { var o = toolOrder[ck] || DEFAULT_TOOL_ORDER[ck]; if (!o) return 1000; var i = o.indexOf(id); return i < 0 ? 1000 : i; }
  function sortByOrder(list, ck) { list.sort(function (a, b) { return toolRank(ck, a.id) - toolRank(ck, b.id); }); return list; }
  function moveTool(ck, id, dir) {
    var list = tools.filter(function (t) { return t.cat === ck; }); sortByOrder(list, ck);
    var ids = list.map(function (t) { return t.id; }), i = ids.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return false;
    ids.splice(j, 0, ids.splice(i, 1)[0]);
    toolOrder[ck] = ids; store.set('tool_order', toolOrder); rebuildRail(); return true;
  }
  /* persist an explicit id order for a category (used by drag-and-drop in the manager) */
  function setToolOrder(ck, ids) { if (!ids || !ids.length) return; toolOrder[ck] = ids; store.set('tool_order', toolOrder); rebuildRail(); }
  function isHidden(id) { return hidden.indexOf(id) >= 0; }
  function setHidden(id, hide) { var i = hidden.indexOf(id); if (hide && i < 0) hidden.push(id); else if (!hide && i >= 0) hidden.splice(i, 1); store.set('hidden_tools', hidden); rebuildRail(); }
  function isCatHidden(ck) { return hiddenCats.indexOf(ck) >= 0; }
  function setCatHidden(ck, hide) { var i = hiddenCats.indexOf(ck); if (hide && i < 0) hiddenCats.push(ck); else if (!hide && i >= 0) hiddenCats.splice(i, 1); store.set('hidden_cats', hiddenCats); rebuildRail(); }
  function catRank(ck) { var i = catOrder.indexOf(ck); if (i >= 0) return i; var j = ORDER.indexOf(ck); return 1000 + (j < 0 ? 500 : j); }
  function reorderCats(dragK, targetK) {
    var r = root.querySelector('.syfs-rail'); if (!r) return;
    var order = Array.prototype.slice.call(r.querySelectorAll('.syfs-cat[data-cat]')).map(function (c) { return c.dataset.cat; }).filter(function (c) { return c && c !== '__fav'; });
    var from = order.indexOf(dragK), to = order.indexOf(targetK);
    if (from < 0 || to < 0 || from === to) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    catOrder = order.concat(catOrder.filter(function (c) { return order.indexOf(c) < 0; }));
    store.set('cat_order', catOrder); rebuildRail();
  }
  /* persist an explicit category order (used by drag-and-drop of accordion headers in the manager) */
  function setCatOrder(keys) {
    if (!keys || !keys.length) return;
    catOrder = keys.concat(catOrder.filter(function (c) { return keys.indexOf(c) < 0; }));
    store.set('cat_order', catOrder); rebuildRail();
  }
  /* Switching language rebuilds everything that carries a label. Open tool windows
     are CLOSED rather than left alone: mount() builds a body once and there is no
     re-render hook, so a window kept open would go on showing the old language —
     a panel contradicting the setting that was just changed. */
  function setLang(v, reopen) {
    var next = SYFS.i18n.valid(v);
    /* choosing the language you already have is still an answer — the question
       was «is this right?», and «yes» closes it exactly as «no» does */
    langAnswered();
    if (next === SYFS.i18n.get()) { markLang(); return; }
    store.set(SYFS.i18n.KEY, next);
    SYFS.i18n.apply(next).then(function () {
      hkDisarm();                 /* كل النوافذ ستُزال أدناه — بما فيها لوحة مسجّل مسلَّح */
      Object.keys(openWins).forEach(function (id) {
        var w = openWins[id];
        delete openWins[id];
        if (w) w.remove();
      });
      markDir();
      rebuildRail();          /* also re-marks the dot and re-wires everything */
      /* the settings panel is where this is normally changed, so it is reopened
         to land the user back where they were — but the first-run card is NOT
         that place, and reopening a panel nobody opened would be a jump scare */
      if (reopen !== false) openManager();
    });
  }

  /* ---------- first-run language card (v0.90.0) -----------------------------
   * The language was GUESSED from the browser at install (background.js), and a
   * guess has to be answerable — this is the answer.
   *
   * ⚠️ Deliberately BILINGUAL and deliberately NOT translated: its whole job is
   * to be readable when the guess was WRONG, so it must not depend on the guess
   * being right. Every string is written with textContent AFTER the node is
   * built, which is what keeps SYFS.i18n.tree() (running inside h()) away from
   * it — a template literal here would be a msgid and would flip to one language.
   *
   * Shown once. Any explicit choice anywhere clears the flag, including one made
   * in the settings panel before the card was ever seen. */
  var langAsk = false, langAskEl = null, langWatch = false;

  function langAnswered() {
    if (!langAsk) return;
    langAsk = false;
    store.set(SYFS.i18n.ASK_KEY, false);
    hideLangAsk();
  }
  function hideLangAsk() { if (langAskEl) { langAskEl.remove(); langAskEl = null; } }

  function askLang(w) {
    if (!w || langAskEl) return;
    var cur = SYFS.i18n.get();
    var box = h('<div class="syfs-langask" role="dialog"></div>');
    /* i18n-skip-start: ⛔ this card is BILINGUAL BY DESIGN and must never be translated
       (§6.96/5). Its whole job is to be read when the guess is WRONG, so it cannot
       depend on the guess being right — that is also why every string below is written
       with textContent/setAttribute AFTER the node exists rather than inside an h()
       template, where it would be a msgid like any other. */
    /* set here, not in the template above: tree() translates `aria-label`, and a
       label written into the markup would be a msgid like any other — the day it
       gets a translation, the screen reader stops hearing both languages too. */
    box.setAttribute('aria-label', 'اللغة — Language');
    var ttl = h('<div class="syfs-la-t"></div>');
    ttl.textContent = 'اللغة — Language';
    var msg = h('<div class="syfs-la-m"></div>');
    msg.appendChild(document.createTextNode('اخترنا لغة الواجهة من لغة متصفّحك. غيّرها الآن أو أبقِها كما هي.'));
    msg.appendChild(document.createElement('br'));
    msg.appendChild(document.createTextNode('We picked the interface language from your browser. Change it now, or keep it.'));
    var row = h('<div class="syfs-la-r"></div>');
    [['ar', 'العربية'], ['en', 'English']].forEach(function (l) {
      var b = h('<button class="syfs-pos-opt"></button>');
      b.textContent = l[1];                       /* i18n-dyn: a language names itself */
      if (l[0] === cur) b.classList.add('on');    /* which one the guess landed on */
      b.addEventListener('click', function () { setLang(l[0], false); });
      row.appendChild(b);
    });
    var keep = h('<button class="syfs-pos-opt syfs-la-keep"></button>');
    keep.textContent = 'إبقاء — Keep';
    /* i18n-skip-end */
    keep.addEventListener('click', function () { langAnswered(); });
    row.appendChild(keep);
    box.appendChild(ttl); box.appendChild(msg); box.appendChild(row);
    w.appendChild(box);
    langAskEl = box;
    /* another tab may answer first — the question is one question, not one per
       page, so a card left standing there would collect a second answer. */
    if (!langWatch) {
      langWatch = true;
      try {
        chrome.storage.onChanged.addListener(function (ch, area) {
          if (area !== 'local' || !ch || !ch[SYFS.i18n.ASK_KEY]) return;
          if (ch[SYFS.i18n.ASK_KEY].newValue === false) { langAsk = false; hideLangAsk(); }
        });
      } catch (e) {}
    }
  }
  /* which language button reads as chosen */
  function markLang() {
    if (!root) return;
    var cur = SYFS.i18n.get();
    root.querySelectorAll('.syfs-pos-opt[data-lang]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-lang') === cur);
    });
  }
  /* one writer for the whole surface: the attribute (for the browser's own bidi) and
     the custom property (for the rules that have to re-assert it inside the rail) */
  function markDir(w) {
    w = w || (root && root.querySelector('.syfs-wrap'));
    if (!w) return;
    var d = SYFS.i18n.dir();
    w.setAttribute('dir', d);
    w.style.setProperty('--syfs-dir', d);
  }
  function safeUrl(x) { x = (x || '').trim(); if (!x) return ''; if (/^https?:\/\//i.test(x)) return x; if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(x)) return 'https://' + x; return ''; }
  function rgbStr(hex) { hex = hex.replace('#', ''); return parseInt(hex.slice(0, 2), 16) + ',' + parseInt(hex.slice(2, 4), 16) + ',' + parseInt(hex.slice(4, 6), 16); }
  function rebuildRail() {
    /* the rail is off (enabled:false) and was never built — a tool opened by id
       (SYFS.openToolById) still loads the toolbox, and there is no rail to redraw */
    if (!root) return;
    var w = root.querySelector('.syfs-wrap'); var old = w.querySelector('.syfs-rail'); if (old) old.remove();
    hideTip();   /* the hovered button is gone with the old rail */
    closeShelf();  /* …and so is the shelf it was anchored to */
    buildRail(w); markPos(); markTheme(); renderFav();
    fitRail();     /* showing or hiding a category changes how long the rail is */
    chordReset();  /* …and it changes which letters are free */
  }

  /* Inject the heavy tool bodies once, the first time the user opens the rail's
   * tools. Runs `cb(ok)` when ready (immediately if already loaded). The worker
   * pushes each tool into the existing SYFS.tools array, so `tools` sees them. */
  function ensureTools(cb) {
    if (toolsLoaded) { if (cb) { try { cb(true); } catch (e) {} } return; }
    if (cb) pendingCbs.push(cb);
    if (toolsLoading) return;
    toolsLoading = true;
    try {
      chrome.runtime.sendMessage({ type: 'SYFS_LOAD_TOOLS', doc: DOC_ID }, function (resp) {
        void chrome.runtime.lastError;
        toolsLoading = false;
        var ok = !!(resp && resp.ok);
        if (ok) { toolsLoaded = true; bootTools(); rebuildRail(); }
        var cbs = pendingCbs; pendingCbs = [];
        cbs.forEach(function (f) { try { f(ok); } catch (e) {} });
      });
    } catch (e) { toolsLoading = false; }
  }

  /* ---------- build the shadow host ---------- */
  function buildHost() {
    host = document.createElement('div');
    host.id = 'syfs-host';
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
    (document.body || document.documentElement).appendChild(host);
    root = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    fetch(chrome.runtime.getURL('rail.css')).then(function (r) { return r.text(); }).then(function (css) { style.textContent = css; });
    root.appendChild(style);
    /* v0.154.0 — every button built in here gets its icon (src/btnkit.js) */
    if (SYFS.btnkit) SYFS.btnkit.watch(root);

    var wrap = h('<div class="syfs-wrap" dir="rtl" data-glass="on"></div>');
    /* Direction is a property of the LANGUAGE, so it is set from one place and read
       by CSS through --syfs-dir. The rail's own `direction: ltr` stays literal: that
       one is a layout MECHANISM (it keeps flex axes physical), not reading order. */
    markDir(wrap);
    root.appendChild(wrap);
    return wrap;
  }

  /* ---------- rail position (right / left / top / bottom) ---------- */
  /* `[data-p]`, not every .syfs-pos-opt: the language buttons reuse that class for
     its looks and carry data-lang instead. Unscoped, this would clear their mark on
     every position change — two settings sharing one selector. */
  function markPos(w) { w = w || root.querySelector('.syfs-wrap'); root.querySelectorAll('.syfs-pos-opt[data-p]').forEach(function (b) { b.classList.toggle('on', b.dataset.p === w.dataset.pos); }); }
  /* the axis the rail is measured along flips with the edge, so the fit does too:
     a run that overflows a 800px-tall window fits a 1900px-wide one comfortably */
  function setPos(p) { var w = root.querySelector('.syfs-wrap'); w.dataset.pos = p; markPos(w); store.set('pos', p); restagger(); fitRail(); }
  /* ⛔ «إخفاء كل الأدوات والنوافذ» (`peek`) was REMOVED in v0.105.0 — do not bring it
     back. It hid the whole toolbox behind a stored switch read on every page load, so
     the way out of it was always one CSS rule away from being unreachable: it had
     already stranded users twice (v0.71.1 hid the window holding its own off switch,
     v0.104.0 hid it again through the other half of the same rule). The extension's
     own action button toggles the rail per page and cannot lock anyone out, and the
     rail folds from its own badge — both are reversible from where they are used. */

  /* ---------- rail (categories -> tools + position control) ---------- */
  /* 'uae' merged into calc, 'text' merged into note, 'ai' a category again since v0.148.0.
   * v0.77.0 — the USER's own order, exported from the ordering lab and applied
   * verbatim. It is the DEFAULT only: `catRank` still puts a stored `cat_order`
   * first, so anyone who has already dragged their icons keeps their arrangement.
   * 'ai' was a standalone rail button from v0.77.0 to v0.147.0; now the last category. */
  /* ⚡ v0.112.0 — `perf` inserted directly after `shield`. It is where the five speed
     tools went when they left 🛡 (see the header of src/speed.js), and it sits next to
     the category it came out of because that is where the hand already goes looking.
     ⚠️ A stored `cat_order` still wins, so an existing user finds it at the END of their
     own arrangement, at rank 1000 — and rewriting their stored order to "fix" that is
     not ours to do (§5/35). */
  /* v0.148.0 — 'ai' back as a category (sam-ai + AI sites), last: where its lone button stood */
  var ORDER = ['islam', 'calc', 'note', 'docs', 'time', 'media', 'util', 'shield', 'perf', 'links', 'dev', 'ai'];
  /* …and the order INSIDE each category, from the same export. Same rule: a
   * stored `tool_order[cat]` wins, so this only decides a fresh install. A tool
   * the plan never named (a new one, or a custom link) sorts after the named ones
   * rather than vanishing — `toolRank` returns 1000 for anything unlisted. */
  var DEFAULT_TOOL_ORDER = {
    /* ⚠️ v0.98.0 — the user's own order, and it reads as a day: recitation first, then
       the five prayers, then the morning/evening athkar, then the wird, then what is
       coming up. v0.178.x — the `ithkar` settings tool is gone: its settings live in
       the tools they belong to (prayer · athkar); a stored order naming it is harmless
       (toolRank only looks ids up). `wird` is new here (split out of
       `athkar`); an id this list never named would sort to the end at rank 1000. */
    islam:   ['quran', 'qradio', 'prayer', 'athkar', 'wird', 'hifz', 'kids', 'occasions', 'hijri'],
    calc:    ['calc', 'finance', 'money', 'tax', 'units', 'currency'],
    note:    ['notes', 'notepad', 'clipboard', 'textdiff', 'readsave', 'counter', 'checklist', 'translate', 'voice', 'phones'],
    docs:    ['docedit', 'sheetview', 'slidesedit', 'mailwriter', 'mdview', 'pdfcompress', 'ziptool', 'ocr', 'whiteboard'],
    /* `calendar` leads (v0.100.0): it is the only one of the four you open to ask a
       question rather than to set something running. Fresh installs only — a user
       with a stored `tool_order` gets it at the end (rank 1000), and rewriting their
       stored order to "fix" that is not ours to do (§5/35). */
    time:    ['calendar', 'datediff', 'timelog', 'timer', 'alerts', 'worldclock'],
    /* v0.165.0 — «الاستوديو» + its floating bar lead; the video tools follow, then the
       image tools the studio replaced (hidden by `studio_v1`, still in the manager) */
    media:   ['studio', 'capbar', 'regionshot', 'screenrec', 'status', 'frames', 'vtrim', 'vaudio', 'vconv', 'videodl', 'screenshot', 'imgedit', 'imgbatch', 'exif'],
    util:    ['display', 'password', 'qrgen', 'qrread', 'speed', 'watch', 'sessions', 'ytplus', 'formfill', 'vault', 'appmode'],
    shield:  ['adblock', 'sitecleaner', 'cookiemgr', 'waprivacy', 'msprivacy'],
    perf:    ['speedlite', 'speedembed', 'speedfreeze', 'speedfetch', 'speedtabs'],
    links:   ['siteviewer', 'waweb', 'lnk-google', 'lnk-custom', 'lnk-gmail', 'lnk-outlook', 'lnk-teams',
              'lnk-facebook', 'lnk-youtube', 'lnk-drive', 'lnk-calendar', 'lnk-telegram', 'lnk-linkedin', 'lnk-x'],
    dev:     ['techdetect', 'perfaudit', 'devpage', 'devformat', 'codemin', 'devencode', 'devconvert', 'devregex', 'devlogs', 'devnet', 'devfake', 'devcolor', 'devinspect', 'devviewport'],
    ai:      ['sam-ai', 'lnk-claude', 'lnk-gemini', 'lnk-chatgpt', 'lnk-higgsfield', 'lnk-kimi', 'lnk-deepseek',
              'lnk-perplexity', 'lnk-copilot', 'lnk-grok', 'lnk-qwen', 'lnk-mistral', 'lnk-notebooklm']
  };

  /* ===== the shelf: ONE panel, anchored under whichever icon opened it =====
   * It replaces the per-category flyout strips (v0.77.0). Those grew sideways out
   * of each circle as a row of pills sized to their own text, which produces a
   * staircase — the single thing that made the old rail look broken. One titled
   * panel with a GRID of equal cells is the fix, and it also means a category's
   * tools can never run off the edge of the screen: the panel is clamped. */
  var shelfEl = null, openCatKey = null, openCatEl = null, shelfRaf = 0;
  function closeShelf() {
    if (shelfEl) { shelfEl.classList.remove('on', 'in'); }
    if (root) root.querySelectorAll('.syfs-cat.open').forEach(function (c) { c.classList.remove('open'); });
    openCatKey = null; openCatEl = null;
  }
  /* Line the panel up with the icon that opened it, then keep it on screen. The
   * tick (--cx/--cy) is measured AFTER the clamp, so it keeps pointing at the
   * real icon even when the panel had to slide away from it. */
  function placeShelf(catEl) {
    if (!shelfEl || !catEl || !root) return;
    var rail = root.querySelector('.syfs-rail'); if (!rail) return;
    var w = root.querySelector('.syfs-wrap'), pos = (w && w.dataset.pos) || 'right';
    var r = rail.getBoundingClientRect(), b = catEl.getBoundingClientRect();
    /* offsetWidth/Height, not the rect: the shelf rests at scale(.97) while
       closed and a transformed rect would measure it 3% small every time. */
    var sw = shelfEl.offsetWidth, sh = shelfEl.offsetHeight;
    if (pos === 'right' || pos === 'left') {
      var top = Math.max(8, Math.min((b.top + b.height / 2) - sh / 2, window.innerHeight - sh - 8));
      shelfEl.style.setProperty('--sy', Math.round(top - r.top) + 'px');
      shelfEl.style.setProperty('--cy', Math.round((b.top + b.height / 2) - top) + 'px');
    } else {
      var left = Math.max(8, Math.min((b.left + b.width / 2) - sw / 2, window.innerWidth - sw - 8));
      shelfEl.style.setProperty('--sx', Math.round(left - r.left) + 'px');
      shelfEl.style.setProperty('--cx', Math.round((b.left + b.width / 2) - left) + 'px');
    }
  }
  /* `items` is a list of { name, icon, run } — categories, favourites and custom
   * links all reduce to the same three fields, so the shelf has one code path. */
  function openShelf(key, label, items, catEl) {
    if (!shelfEl || !root) return;
    var grid = shelfEl.querySelector('.syfs-flyout');
    grid.innerHTML = '';
    items.forEach(function (it, i) {
      var tb = toolBtn(it.name, it.icon);
      if (it.beta) { tb.classList.add('beta'); tb.dataset.tip = it.name + ' — ' + SYFS.t('تجريبي'); }
      tb.style.setProperty('--i', String(i));
      tb.addEventListener('click', function (e) { e.stopPropagation(); it.run(); });
      grid.appendChild(tb);
    });
    if (!items.length) grid.appendChild(h('<div class="syfs-shelf-empty">…</div>'));
    shelfEl.querySelector('.syfs-shelf-title').textContent = label;
    shelfEl.querySelector('.syfs-shelf-count').textContent = items.length ? String(items.length) : '';
    root.querySelectorAll('.syfs-cat.open').forEach(function (c) { c.classList.remove('open'); });
    if (catEl) catEl.classList.add('open');
    openCatKey = key; openCatEl = catEl;
    shelfEl.classList.remove('in');
    placeShelf(catEl);
    shelfEl.classList.add('on');
    /* two frames: the tools' from-state has to be PAINTED before `.in` removes it,
       or the browser folds both into one style pass and the stagger never runs */
    cancelAnimationFrame(shelfRaf);
    shelfRaf = requestAnimationFrame(function () {
      shelfRaf = requestAnimationFrame(function () { if (shelfEl) shelfEl.classList.add('in'); });
    });
  }
  function toggleShelf(key, label, items, catEl) {
    if (openCatKey === key) { closeShelf(); return; }
    openShelf(key, label, items, catEl);
  }
  /* a category's tools, as shelf items */
  function catItems(ck, list) {
    var items = (list || []).filter(function (t) { return !t.noRail; }).map(function (t) {
      return { name: SYFS.t(t.name), icon: t.icon, beta: !!t.beta, run: function () { runTool(t); } };
    });
    /* ⚠️ الفحص عند القراءة لا عند الكتابة وحدها: التخزين مشترك مع «استيراد» الذي يكتب أي
       JSON، فرابطٌ مخزَّن بمخطّط `javascript:` كان يصل `window.open` كما هو. الرابط الشاذّ
       يُسقَط ولا «يُنظَّف» — ولا يُعرض صفّاً معطوباً. */
    if (ck === 'links') customLinks.forEach(function (cl) {
      var u = safeLink(cl && cl.u);
      if (!u) return;
      items.push({ name: String((cl && cl.n) || u), icon: LINK_ICON,
        run: function () { try { window.open(u, '_blank', 'noopener'); } catch (e) {} } });
    });
    return items;
  }
  var LINK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15l6-6M10.5 6l1-1a4 4 0 015.5 5.5l-1 1M13.5 18l-1 1a4 4 0 01-5.5-5.5l1-1"/></svg>';

  /* ===== the fold: the whole run collapses into the badge ===== */
  var foldClipT = null;
  function isFolded() { var r = root && root.querySelector('.syfs-rail'); return !!(r && r.classList.contains('folded')); }
  function setFolded(on, instant) {
    var rail = root && root.querySelector('.syfs-rail'); if (!rail) return;
    var run = rail.querySelector('.syfs-run'), badge = rail.querySelector('.syfs-fold');
    clearTimeout(foldClipT);
    /* An instant set is a RESTORE, not a fold: nothing was on screen to travel,
       so the cascade must not play on page load. */
    if (instant) rail.classList.add('syfs-noanim');
    rail.classList.toggle('folded', on);
    if (badge) { badge.setAttribute('aria-expanded', String(!on)); badge.title = on ? SYFS.t('فتح الشريط') : SYFS.t('طيّ الشريط'); }
    if (run) run.style.overflow = 'hidden';
    if (on) closeShelf();
    if (instant) {
      void rail.offsetWidth;   /* flush, or both class changes coalesce and it animates anyway */
      rail.classList.remove('syfs-noanim');
      if (!on && run) run.style.overflow = 'visible';
      if (!on) fitRail();      /* the run is back at full length — re-measure it */
      return;
    }
    if (on) return;
    fitRail();
    /* The run must clip WHILE it folds and must NOT clip once open: the hover lift
       and the tooltip both leave the run's box, and CSS cannot clip one axis and
       free the other. The window is the whole cascade — the last icon to arrive
       starts ~13 × 22ms late — so the clip is held 640ms. */
    foldClipT = setTimeout(function () { if (run) run.style.overflow = 'visible'; }, 640);
  }
  /* every run child carries its DISTANCE FROM THE BADGE. The badge trails the run
     everywhere today, so this is the DOM order — but it is read through CSS
     `order` rather than assumed, because `order` is exactly the thing that would
     move the badge without moving a single node, and the failure would be silent:
     a cascade that unrolls from the wrong end still animates. */
  /* What the badge is holding while the strip is away. It counts what is actually
     ON the bar, so the hidden favourites button never inflates it — a badge that
     promises eleven icons and unrolls ten is a badge that lies. */
  function updateFoldCount() {
    if (!root) return;
    var cnt = root.querySelector('.syfs-fold-cnt'); if (!cnt) return;
    var n = 0;
    root.querySelectorAll('.syfs-run .syfs-cat').forEach(function (c) { if (c.style.display !== 'none') n++; });
    cnt.textContent = String(n);
  }
  function cssOrder(el) { var v = parseInt(getComputedStyle(el).order, 10); return v || 0; }
  /* the children in PAINT order: `order` first, DOM position to break ties — which
     is exactly how flexbox itself resolves them */
  function paintOrder(el) {
    return Array.prototype.slice.call(el.children)
      .map(function (c, k) { return { el: c, k: k, o: cssOrder(c) }; })
      .sort(function (a, b) { return (a.o - b.o) || (a.k - b.k); })
      .map(function (s) { return s.el; });
  }
  function staggerRun(run) {
    var seq = paintOrder(run), last = seq.length - 1;
    /* does the badge LEAD the bar (top/bottom) or trail it (left/right)? Ask the
       stylesheet — a second copy of that rule here is a second thing to forget. */
    var bar = run.parentNode, fold = bar && bar.querySelector ? bar.querySelector('.syfs-fold') : null;
    var leads = !!(fold && cssOrder(fold) < cssOrder(run));
    run.style.setProperty('--n', String(last < 0 ? 0 : last));
    seq.forEach(function (el, v) { el.style.setProperty('--i', String(leads ? v : last - v)); });
  }
  /* `order` is computed, so it is only known once the rail is in the document AND
     the position is settled — every place that moves `data-pos` must re-index. */
  function restagger() { var run = root && root.querySelector('.syfs-run'); if (run) staggerRun(run); }

  /* ===== the bar clock (v0.98.0) =============================================
   * The only thing on the rail that is not a button, and that is the design: it
   * answers a question instead of doing something. It lives INSIDE the run so that
   * folding takes it away with everything else — folding means "give me my page
   * back", and a clock left floating over the site would be the one part that
   * refused.
   *
   * ⛔ NO SECONDS. A second hand is a guaranteed repaint every second in every open
   * tab and buys nothing on a bar you glance at. The tick runs at 1s but only WRITES
   * when the rendered string actually changes, and returns immediately while the tab
   * is hidden — an idle background tab costs one string compare a second.
   *
   * ⚠️ THERE IS NO "AUTO" FOR 12/24, on purpose. Leaving `hour12` unset means the
   * locale decides, and the two locales disagree: en-GB renders 15:42 while ar-EG
   * renders ٣:٤٢ م. That is two different answers to a question the user answers
   * once. The default is 12-hour in BOTH languages and the toggle is the only other
   * state — a third option that behaves identically to the first is not a choice,
   * it is a setting that lies.
   *
   * ⚠️ THE DIGITS ARE LATIN IN BOTH LANGUAGES (v0.101.0). Until v0.100.0 they came
   * from the locale untouched — Arabic-Indic «٣:٤٢» in Arabic — which is correct
   * typography and the wrong call for THIS chip: it is glanced at, not read, and
   * every other number the bar shows (the fold badge, the Quran timer, the أدوات
   * counters) is already Latin. One surface, one digit set.
   *
   * ⛔ It is done with `-u-nu-latn` ON THE LOCALE and never by transliterating the
   * formatter's output. The month name, the «ص/م» and the separator are still locale
   * output and still translate themselves (§6.101/6); a manual digit swap would have
   * to parse a string Intl just composed, which is the v0.98.0 regex bug again. */
  var clockEl = null, clockTick = 0, clockOn = true, clock24 = false, clockLast = '';
  function clockLoc() {
    var l = SYFS.i18n.locale();
    return l.indexOf('-u-') >= 0 ? l : l + '-u-nu-latn';
  }

  /* ===== the chip's three preferences (v0.102.0) =====================
   * WHAT it looks like · WHAT it shows · HOW the date reads. They are three keys and
   * not one "theme", because they answer three different questions and a user who
   * wants the calendar look does not thereby want the Hijri date.
   *
   * ⛔ Every list here is a WHITELIST read through `clkPick`, never the stored string
   * trusted as-is: these values land in `dataset` (a CSS selector) and in a branch
   * that picks a formatter, and storage is shared with an export/import feature, so a
   * hand-edited file is a real input path. An unknown value falls back to the default
   * — it is never "corrected" into something adjacent (§4.1).
   *
   * ⚠️ The label is the SECOND element and reaches the DOM through `SYFS.t()` at the
   * call site, never straight from the table — a table in one file and a write in
   * another is exactly the pair that shipped an all-Arabic appearance tab in v0.99.0
   * (§6.103/7). */
  var CLK_STYLES = [['bold', 'بارز'], ['stack', 'مركّب'], ['accent', 'بلون الهوية'],
                    ['plain', 'بلا خلفية'], ['cal', 'نتيجة'], ['led', 'رقمي']];
  var CLK_SHOWS  = [['both', 'وقت وتاريخ'], ['time', 'الوقت فقط'], ['date', 'التاريخ فقط']];
  var CLK_DATES  = [['dm', 'يوم وشهر'], ['hj', 'هجري'], ['wd', 'اسم اليوم']];
  /* ⚠️ `bold` is the default from v0.103.0, and `stack` — what shipped as the default
     in v0.98.0–v0.102.0 — stays in the list rather than being replaced. The two differ
     only in the SECOND line's weight and a hairline above it, so the change is a
     legibility fix rather than a new look, and anybody who prefers the old chip finds
     it by name instead of discovering their setting was taken away. A stored 'stack'
     is still a stored preference and still wins over this default. */
  var clockStyle = 'bold', clockShow = 'both', clockDate = 'dm';
  /* the occasions tool's ±1-day calibration, read at boot and refreshed by the
     storage listener below — the Hijri chip and the card must never disagree */
  var clockOffset = 0;
  function clkPick(list, v, def) {
    for (var i = 0; i < list.length; i++) if (list[i][0] === v) return v;
    return def;
  }

  /* ===== القيم المخزَّنة الأخرى: نفس انضباط `clkPick` (v0.104.0) =====
   * كان الانضباط على مفاتيح الساعة وحدها، وجاراتها في **نفس `Promise.all`** تُقرأ كما جاءت.
   * والمصدر ليس افتراضياً: «استيراد» يقبل أي JSON كائن ويكتبه كما هو ⇒ ملفٌّ تالف أو
   * مُعدَّل بيد يكفي. المقيس فعلياً:
   *   `{"tool_order":{"islam":3}}` ⇒ `o.indexOf is not a function` و**صفر أزرار على كل
   *   صفحة** (الشريط لا يُبنى، فلا لوحة يُفتح منها التصفير)، و`pos:"nowhere"` ⇒ شريط
   *   بارتفاع صفر. كلاهما يعود مع كل إقلاع لأن القيمة مخزَّنة.
   * المجهول يسقط إلى الافتراضي ولا يُصحَّح إلى جاره (§4.1). */
  /* القوائم البيضاء ومرشّح الاعتمادات في `SYFS.prefs` (`src/storage.js`) — مصدر واحد
     يستعمله هذا الملفّ وصفحة المساعدة معاً (§5.11/3). */
  var POS_VALUES = SYFS.prefs.POS_VALUES;
  var pickOne = SYFS.prefs.pickOne;
  var cleanOrderMap = SYFS.prefs.cleanOrderMap;
  /* روابط المستخدم تنتهي في `window.open` ⇒ قائمة بيضاء للمخطّط، رفضٌ لا تنظيف:
     حذف محرف تحكّم من `java\tscript:` يعيد رابطاً عاملاً (نفس قاعدة `safeUrl` في docview). */
  function safeLink(u) {
    var s = String(u || '').trim();
    return /^https?:\/\//i.test(s) ? s : '';
  }

  /* THREE LINES, one fact each (v0.101.0): the time · the day number · the month.
   *
   * v0.99.0 gave the face its own line and packed «ص/م + الثلاثاء + ١١ أغسطس» onto the
   * second one, which put four things on a line 8px tall — the point where a date
   * stops being read and starts being a texture. Now the second line is the day
   * NUMBER alone, big enough to be the second thing you actually read, and the month
   * is the third. The weekday leaves the chip entirely: it has no Arabic abbreviation
   * (CLDR returns «الثلاثاء» for `weekday:'short'`), and the hover card that came with
   * this version is a better home for it than a tooltip ever was.
   *
   * `formatToParts` rather than a regex over the formatted string: the separator, the
   * digit set and the position of the day period all move with the locale, and the
   * v0.98.0 regex (`/([ap])\.?\s*m\.?/i`) only ever knew about English. */
  function clockParts() {
    var d = new Date(), loc = clockLoc(), ar = SYFS.i18n.locale().indexOf('ar') === 0;
    var o = { t: '', m: '', w: '', d: '', mo: '', full: '' };
    try {
      /* 2-digit hour only in 24h: "09:05" reads as a clock, "9:05" reads as 12h */
      new Intl.DateTimeFormat(loc, { hour: clock24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: !clock24 })
        .formatToParts(d).forEach(function (p) {
          if (p.type === 'dayPeriod') { o.m = p.value; return; }
          /* the literal between hour and minute belongs to the face; the one before the
             day period is the space that used to drag AM/PM onto the same line */
          if (p.type === 'literal') { if (/^[\s ]*$/.test(p.value)) return; if (o.m) return; }
          o.t += p.value;
        });
      o.t = o.t.trim();
      if (!ar && o.m) o.m = o.m.replace(/\./g, '').toUpperCase();   /* en-GB writes "pm" */
    } catch (e) {
      o.t = d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    }
    try {
      o.d = d.toLocaleDateString(loc, { day: 'numeric' });
      o.mo = d.toLocaleDateString(loc, { month: 'short' }).replace(/[،,]\s*$/, '');
      /* the weekday is always carried in the LONG form — the card prints it in full,
         and CLDR has no abbreviated Arabic weekday to prefer anyway */
      o.w = d.toLocaleDateString(loc, { weekday: 'long' }).replace(/[،,]\s*$/, '');
      o.full = d.toLocaleDateString(loc, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      /* ⛔ the Hijri chip reads the SEALED engine (§6.99/6) at the user's calibration,
         never a second conversion of its own — the chip and the card must agree on
         what day it is, and two converters are two answers waiting to differ */
      if (clockDate === 'hj' && SYFS.occ && SYFS.occ.hijri) {
        var hj = SYFS.occ.hijri(d, clockOffset);
        if (hj) { o.d = String(hj.d); o.mo = SYFS.occ.monthName(hj.m); }   /* i18n-dyn: SYFS.occ translates it */
      } else if (clockDate === 'wd') {
        o.mo = o.w;   /* the month line carries the weekday instead — same slot, same clip rules */
      }
    } catch (e) { /* a locale Intl cannot build leaves the date blank, never the time */ }
    return o;
  }

  /* what the chip's own click does depends on what the chip is SHOWING. A click that
     toggles 12/24 on a chip with no time on it is a control that does nothing you can
     see, which reads as broken — so in date-only mode the same click cycles the date
     format instead. Both are "change how this chip reads"; the card's last line always
     says which one is armed, so it is never a guess. */
  function clkActionMsg() {
    return clockShow === 'date' ? 'اضغط لتغيير شكل التاريخ' : 'اضغط لتبديل صيغة ١٢ / ٢٤ ساعة';
  }
  function paintClock() {
    if (!clockEl) return;
    var p = clockParts();
    var key = [p.t, p.m, p.d, p.mo, clockStyle, clockShow, clockDate, clock24].join('|');
    if (key === clockLast) return;
    clockLast = key;
    /* textContent, never markup: this is formatter output, not a template.
       i18n-dyn: Intl already rendered these in the interface locale (§6.101/6) */
    clockEl.querySelector('.syfs-clk-t').textContent = p.t;
    clockEl.querySelector('.syfs-clk-m').textContent = p.m;      /* i18n-dyn: ditto */
    clockEl.querySelector('.syfs-clk-dd').textContent = p.d;     /* i18n-dyn: ditto */
    clockEl.querySelector('.syfs-clk-mo').textContent = p.mo;    /* i18n-dyn: ditto */
    /* the look and the two content switches are CSS state, so the stylesheet owns
       every layout consequence and JS never measures or positions a line */
    clockEl.dataset.style = clockStyle;
    clockEl.dataset.show = clockShow;
    clockEl.dataset.date = clockDate;
    /* the face's measured ceiling differs with the meridiem, and that is a SETTING —
       the chip's shape may follow the toggle, never the language (rail.css) */
    clockEl.classList.toggle('h12', !clock24);
    /* ⛔ NO `title`. The hover card IS the long form now, and a native tooltip fires
       on the same gesture at a higher layer — it would paint over the card it made
       redundant. The label is what a screen reader gets instead. */
    clockEl.setAttribute('aria-label', (p.full ? p.full + ' — ' : '') + SYFS.t(clkActionMsg()));
  }
  /* one place that re-reads the chip AND the card, so a preference can never land on
     one of the two surfaces that show the same fact */
  function repaintClock() { clockLast = ''; paintClock(); ckLast = ''; ckPaint(); }
  function setClockPref(key, val) {
    if (key === 'style') clockStyle = val;
    else if (key === 'show') clockShow = val;
    else if (key === 'date') clockDate = val;
    store.set('rail_clock_' + key, val);
    repaintClock();
    /* the chip's footprint changes with all three — one line instead of three is a
       shorter rail, and the fit factor was measured against the old length */
    fitRail();
  }

  function startClock() {
    if (clockTick) return;
    clockTick = setInterval(function () {
      if (!clockEl) { clearInterval(clockTick); clockTick = 0; return; }
      if (document.hidden) return;      /* a hidden tab has nobody reading the clock */
      paintClock(); ckPaint();
    }, 1000);
    /* coming back to a tab that slept through a minute change must not show the old
       minute until the next tick lands */
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { paintClock(); ckPaint(); } });
  }

  function buildClock() {
    var el = h('<div class="syfs-clock" role="button" tabindex="0">'
      + '<span class="syfs-clk-face"><span class="syfs-clk-t"></span><span class="syfs-clk-m"></span></span>'
      + '<span class="syfs-clk-dd"></span><span class="syfs-clk-mo"></span></div>');
    /* ⚠️ stopPropagation is mandatory on anything clickable in the rail — `document`
       carries "click outside ⇒ close the shelf" and without it this toggle would shut
       an open shelf as a side effect (§6.9/10). */
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      if (clockShow === 'date') {
        /* cycle, not a menu: three values and the chip itself is the preview, so a
           second panel to choose between them would cost more than it explains */
        var i = 0;
        for (var j = 0; j < CLK_DATES.length; j++) if (CLK_DATES[j][0] === clockDate) i = j;
        setClockPref('date', CLK_DATES[(i + 1) % CLK_DATES.length][0]);
        return;
      }
      clock24 = !clock24;
      store.set('rail_clock_24', clock24);
      /* the card shows the same face, so it must not keep the old format on screen
         beside a chip that has already changed */
      repaintClock();
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
    });
    return el;
  }

  /* ===== the clock's hover card (v0.101.0, spec: specs/clock-card.md) =====
   *
   * The chip answers "what time is it". Everything ELSE about today — the weekday,
   * the full Gregorian date, the Hijri date, whether today is one of the أيام
   * الفاضلة, what is on the calendar — has nowhere to live in a column one icon
   * wide. v0.99.0 put the full date in a `title`, which is a place text goes to be
   * forgotten: no structure, no second line, and it cannot hold a list at all.
   *
   * It is the SAME object as `SYFS.qmini` and `.syfs-cmini` — same material, same
   * anchoring, same 220ms grace, same 170ms intent delay — because it hangs off the
   * same strip under the same gesture. A third look would read as a third product.
   *
   * ⛔ It never fetches. The Hijri date and the occasions come from the sealed engine
   * in `src/occasions.js` (bootstrap-loaded, so it is there before this file runs),
   * and the day's reminders come from `cal_days` — the SAME key the calendar tool
   * writes and the worker arms itself from. No message, no network, no new permission.
   *
   * Reminder text is USER DATA: `textContent` only, never `h()` and never innerHTML. */
  var ckEl = null, ckIn = false, ckHideT = 0, ckOpenT = 0, ckHeld = null, ckLast = '';
  var ckDays = null, ckDaysT = 0;
  var ckNext = { day: '', val: null };                 /* SYFS.occ.next, once per day + offset */
  var CK_ROWS = 6;                                     /* a card, not a task list */

  function ckBuild(wrap) {
    ckEl = h('<div class="syfs-ckmini" role="group" aria-label="اليوم">'
      + '<div class="syfs-ck-head"><span class="syfs-ck-t"></span><span class="syfs-ck-m"></span>'
      + '<span class="syfs-ck-w"></span></div>'
      /* v0.155.0 — the athkar of this window are not read yet: first thing under the time */
      + '<div class="syfs-ck-az" style="display:none"><div class="syfs-ck-az-t"></div><div class="syfs-ck-az-s"></div>'
      + '<div class="syfs-ck-az-b"><button type="button" class="syfs-ck-az-go">اقرأها الآن</button>'
      + '<button type="button" class="syfs-ck-az-ok">✓ قرأتها</button></div></div>'
      + '<div class="syfs-ck-rows"></div>'
      + '<div class="syfs-ck-sec syfs-ck-occ"></div>'
      + '<div class="syfs-ck-sec syfs-ck-cal"></div>'
      /* ⛔ left EMPTY in the template on purpose — the hint names the action the chip's
         own click is armed with, and that depends on what the chip is showing, so it
         is written in ckPaint and never baked in as a msgid that is right half the time */
      + '<div class="syfs-ck-hint"></div></div>');
    wrap.appendChild(ckEl);
    /* the card is part of the hover target: leaving the chip INTO the card must not
       close the thing you were reaching for */
    ckEl.addEventListener('mouseenter', function () { ckIn = true; clearTimeout(ckHideT); });
    ckEl.addEventListener('mouseleave', function () { ckIn = false; ckSchedHide(); });
    var az = ckEl.querySelector('.syfs-ck-az');
    ckEl.querySelector('.syfs-ck-az-go').addEventListener('click', function (e) {
      e.stopPropagation(); ckHide();
      if (SYFS.openToolById) SYFS.openToolById('athkar');
    });
    /* the worker is the only writer of `azkar_goal` (§5.29/1) — the card sends an op */
    ckEl.querySelector('.syfs-ck-az-ok').addEventListener('click', function (e) {
      e.stopPropagation();
      var k = az.dataset.k === 'm' ? 'm' : 's';
      try {
        chrome.runtime.sendMessage({ type: 'SYFS_AZKAR', op: 'finish', kind: k }, function () {
          void chrome.runtime.lastError; ikAsk(true);
        });
      } catch (err) {}
    });
  }
  function ckHide() {
    clearTimeout(ckHideT); clearTimeout(ckOpenT);
    ckIn = false; ckHeld = null; ckLast = '';
    if (ckEl) { ckEl.classList.remove('on'); ckEl.style.left = '-9999px'; }
  }
  function ckSchedHide() {
    clearTimeout(ckHideT);
    ckHideT = setTimeout(function () { if (!ckIn) ckHide(); }, 220);
  }
  function ckPlace() {
    if (!ckEl || !ckHeld || !ckHeld.isConnected) return;
    var w = ckEl.parentNode, pos = (w && w.dataset && w.dataset.pos) || 'right';
    var r = ckHeld.getBoundingClientRect(), pw = ckEl.offsetWidth, ph = ckEl.offsetHeight, x, y;
    if (pos === 'top' || pos === 'bottom') {
      x = r.left + r.width / 2 - pw / 2;
      y = (pos === 'top') ? r.bottom + 10 : r.top - ph - 10;
    } else {
      y = r.top + r.height / 2 - ph / 2;
      x = (pos === 'right') ? r.left - pw - 10 : r.right + 10;
    }
    ckEl.style.left = Math.min(Math.max(6, x), Math.max(6, window.innerWidth - pw - 6)) + 'px';
    ckEl.style.top = Math.min(Math.max(6, y), Math.max(6, window.innerHeight - ph - 6)) + 'px';
  }
  /* ⚠️ LOCAL date key, never toISOString() — the same trap `src/calendar.js` documents:
     that string is UTC, so east of Greenwich every evening after 21:00 «today» would
     read TOMORROW's reminders. */
  function ckKey(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  /* `cal_days` is shared with an export/import feature, so a hand-edited file is a
     real input path: every field is type-checked and a bad row is DROPPED, never
     patched into something plausible. */
  function ckToday(map) {
    var out = { ev: [], task: [], more: 0 };
    var rec = map && typeof map === 'object' ? map[ckKey(new Date())] : null;
    if (!rec || typeof rec !== 'object') return out;
    if (Array.isArray(rec.e)) {
      rec.e.forEach(function (e) {
        if (!e || typeof e !== 'object' || typeof e.x !== 'string' || !e.x.trim()) return;
        out.ev.push({ x: e.x.trim(), at: /^([01]\d|2[0-3]):([0-5]\d)$/.test(e.at) ? e.at : '', on: e.on !== false });
      });
      out.ev.sort(function (a, b) { return (a.at || '99:99').localeCompare(b.at || '99:99'); });
    }
    if (Array.isArray(rec.t)) {
      rec.t.forEach(function (t) {
        if (!t || typeof t !== 'object' || typeof t.x !== 'string' || !t.x.trim()) return;
        if (t.d === true) return;                      /* a finished task is not a reminder */
        out.task.push({ x: t.x.trim() });
      });
    }
    var n = out.ev.length + out.task.length;
    if (n > CK_ROWS) {
      out.more = n - CK_ROWS;
      /* events first: one of them fires at a time, and a task does not */
      out.ev = out.ev.slice(0, CK_ROWS);
      out.task = out.task.slice(0, Math.max(0, CK_ROWS - out.ev.length));
    }
    return out;
  }
  function ckRow(label, value) {
    var r = h('<div class="syfs-ck-row"><span class="syfs-ck-k"></span><span class="syfs-ck-v"></span></div>');
    r.querySelector('.syfs-ck-k').textContent = label;   /* i18n-dyn: translated by the caller */
    r.querySelector('.syfs-ck-v').textContent = value;   /* i18n-dyn: Intl / engine output (§6.101/6) */
    return r;
  }
  /* «الصلاة القادمة» is the card's one live countdown, so it gets its own panel, not a
     row: the prayer's name and time large, the time left as a pill, and a bar of how
     far the day has come from the previous prayer to this one. `.soon` in the last
     quarter hour. Before الفجر there is no previous prayer today ⇒ no bar. */
  function ckPrayer(ik, now) {
    var el = h('<div class="syfs-ck-pr"><div class="syfs-ck-pr-top"><span class="syfs-ck-pr-k"></span>' +
               '<span class="syfs-ck-pr-left"></span></div><div class="syfs-ck-pr-main">' +
               '<b class="syfs-ck-pr-n"></b><span class="syfs-ck-pr-t"></span></div>' +
               '<div class="syfs-ck-pr-bar"><i></i></div></div>');
    var left = ik.next.at - now;
    el.querySelector('.syfs-ck-pr-k').textContent = SYFS.t('الصلاة القادمة');
    el.querySelector('.syfs-ck-pr-left').textContent = SYFS.t('بعد {0}', ikLeft(left));
    el.querySelector('.syfs-ck-pr-n').textContent = SYFS.t(IK_NAMES[ik.next.k]);
    el.querySelector('.syfs-ck-pr-t').textContent = ikFmt(ik.next.at);   /* i18n-dyn: Intl output */
    el.classList.toggle('soon', left <= 15 * 60000);
    var bar = el.querySelector('.syfs-ck-pr-bar');
    if (ik.prev && ik.next.at > ik.prev.at) {
      var f = Math.min(1, Math.max(0, (now - ik.prev.at) / (ik.next.at - ik.prev.at)));
      bar.firstChild.style.width = Math.round(f * 100) + '%';
    } else bar.style.display = 'none';
    return el;
  }
  function ckSection(sec, title, items, cls) {
    sec.textContent = '';
    if (!items.length) { sec.style.display = 'none'; return; }
    sec.style.display = '';
    var head = h('<div class="syfs-ck-gh"></div>');
    head.textContent = title;                            /* i18n-dyn: translated by the caller */
    sec.appendChild(head);
    items.forEach(function (it) {
      var b = h('<div class="syfs-ck-b"><span class="syfs-ck-dot"></span><span class="syfs-ck-nm"></span>'
        + '<span class="syfs-ck-tag"></span></div>');
      if (cls) b.classList.add(cls);
      if (it.type) b.setAttribute('data-t', it.type);
      /* ⛔ textContent — `it.name` is a reminder the user typed */
      b.querySelector('.syfs-ck-nm').textContent = it.name;   /* i18n-dyn: user data, or already translated by SYFS.occ (§6.103/7) */
      var tag = b.querySelector('.syfs-ck-tag');
      if (it.tag) tag.textContent = it.tag; else tag.remove();  /* i18n-dyn: ditto */
      sec.appendChild(b);
    });
  }
  /* ===== الصلاة القادمة + تنبيه الأذكار (v0.155.0) =====
   * The worker owns the prayer math and the athkar goal (§5.29/1); the rail asks it for
   * ONE snapshot — today's prayer instants + tomorrow's fajr, the two athkar windows,
   * whether each is done — and derives everything else from the clock. It asks again
   * only when the snapshot goes stale (a new day) or a key it depends on is written.
   * The snapshot ends in a sum, a selector and a label ⇒ every field is checked on
   * arrival and a bad one dropped.
   * The bar turns amber in the last IK_WARN of a window whose athkar are not read yet —
   * the morning ones before the evening window, and the other way round. */
  var ikSnap = null, ikAsked = 0, ikBarEl = null;
  var IK_WARN = 30 * 60000;
  var IK_NAMES = { fajr: 'الفجر', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };
  function ikNum(v) { return (typeof v === 'number' && isFinite(v)) ? v : NaN; }
  function ikClean(r) {
    if (!r || !r.ok || !Array.isArray(r.pt) || !r.win || !r.goal) return null;
    var out = { day: typeof r.day === 'string' ? r.day : '', pt: [], win: {}, done: {} };
    r.pt.forEach(function (p) {
      if (p && Object.prototype.hasOwnProperty.call(IK_NAMES, p.k) && !isNaN(ikNum(p.at))) out.pt.push({ k: p.k, at: p.at });
    });
    ['s', 'm'].forEach(function (k) {
      var w = r.win[k] || {};
      out.win[k] = { start: ikNum(w.start), end: ikNum(w.end) };
      out.done[k] = !!(r.goal[k] && r.goal[k].done);
    });
    return out;
  }
  function ikAsk(force) {
    var now = Date.now();
    if (!force && now - ikAsked < 60000) return;          /* at most once a minute */
    ikAsked = now;
    try {
      chrome.runtime.sendMessage({ type: 'SYFS_AZKAR', op: 'status' }, function (r) {
        void chrome.runtime.lastError;
        var s = ikClean(r);
        if (!s) return;
        ikSnap = s; ckLast = ''; ikBar(); ckPaint();
      });
    } catch (e) { /* orphaned script after an update — nothing to show */ }
  }
  function ikState() {
    if (!ikSnap) return null;
    var now = Date.now(), st = { next: null, prev: null, due: null };
    for (var i = 0; i < ikSnap.pt.length; i++) {
      if (ikSnap.pt[i].at > now) { st.next = ikSnap.pt[i]; st.prev = ikSnap.pt[i - 1] || null; break; }
    }
    ['s', 'm'].forEach(function (k) {
      var w = ikSnap.win[k];
      if (now >= w.start && now < w.end && !ikSnap.done[k]) st.due = { k: k, left: w.end - now };
    });
    return st;
  }
  function ikBar() {
    if (!ikBarEl) return;
    var st = ikState(), k = (st && st.due && st.due.left <= IK_WARN) ? st.due.k : '';
    ikBarEl.classList.toggle('syfs-bar-warn', !!k);
    if (k) ikBarEl.setAttribute('data-ikk', k); else ikBarEl.removeAttribute('data-ikk');
  }
  function ikTick() {
    if (!ikBarEl || !ikBarEl.isConnected || document.hidden) return;
    if (!ikSnap || ikSnap.day !== ckKey(new Date())) ikAsk(false);
    ikBar();
  }
  setInterval(ikTick, 20000);
  document.addEventListener('visibilitychange', ikTick);
  function ikFmt(ms) {
    try { return new Intl.DateTimeFormat(clockLoc(), { hour: 'numeric', minute: '2-digit', hour12: !clock24 }).format(new Date(ms)); }
    catch (e) { return ''; }
  }
  function ikLeft(ms) {
    var m = Math.max(1, Math.ceil(ms / 60000)), hh = Math.floor(m / 60);
    m = m % 60;
    if (!hh) return SYFS.t('{0} دقيقة', m);
    return m ? SYFS.t('{0} ساعة و{1} دقيقة', hh, m) : SYFS.t('{0} ساعة', hh);
  }
  function ckAzkar(st) {
    var az = ckEl.querySelector('.syfs-ck-az');
    if (!st || !st.due) { az.style.display = 'none'; return; }
    az.style.display = '';
    az.dataset.k = st.due.k;
    az.classList.toggle('late', st.due.left <= IK_WARN);
    az.querySelector('.syfs-ck-az-t').textContent = st.due.k === 's'
      ? SYFS.t('🌅 لم تقرأ أذكار الصباح بعد') : SYFS.t('🌙 لم تقرأ أذكار المساء بعد');
    az.querySelector('.syfs-ck-az-s').textContent = SYFS.t('ينتهي وقتها بعد {0}', ikLeft(st.due.left));
  }

  /* one repaint, driven by the same 1s tick as the chip and written only when the
     rendered text actually changed — an open card costs one string compare a second */
  function ckPaint() {
    if (!ckEl || !ckHeld || !ckEl.classList.contains('on')) return;
    var p = clockParts();
    var occ = (SYFS.occ && SYFS.occ.today) ? SYFS.occ.today(new Date(), clockOffset) : { hj: null, list: [] };
    var hijri = (occ.hj && SYFS.occ.hijriText) ? SYFS.occ.hijriText(occ.hj) : '';
    var cal = ckToday(ckDays);
    var nk = ckKey(new Date()) + ':' + clockOffset;
    if (ckNext.day !== nk && SYFS.occ && SYFS.occ.next) ckNext = { day: nk, val: SYFS.occ.next(new Date(), clockOffset) };
    var nx = ckNext.val;
    if (!ikSnap) ikAsk(false);
    var ik = ikState(), now = Date.now();
    var key = [p.t, p.m, p.w, p.full, hijri, clockShow, nx ? nx.key + nx.when : '',
               ik && ik.next ? ik.next.k + Math.ceil((ik.next.at - now) / 60000) : '',
               ik && ik.due ? ik.due.k + Math.ceil(ik.due.left / 60000) : '',
               occ.list.map(function (o) { return o.key; }).join(','),
               cal.ev.map(function (e) { return e.at + e.x; }).join('|'),
               cal.task.map(function (t) { return t.x; }).join('|'), cal.more].join('~');
    if (key === ckLast) return;
    ckLast = key;

    ckEl.querySelector('.syfs-ck-t').textContent = p.t;    /* i18n-dyn: Intl output (§6.101/6) */
    ckEl.querySelector('.syfs-ck-m').textContent = p.m;    /* i18n-dyn: ditto */
    ckEl.querySelector('.syfs-ck-w').textContent = p.w;    /* i18n-dyn: ditto */

    var rows = ckEl.querySelector('.syfs-ck-rows');
    rows.textContent = '';
    if (p.full) rows.appendChild(ckRow(SYFS.t('ميلادي'), p.full));
    if (hijri) rows.appendChild(ckRow(SYFS.t('هجري'), hijri));
    if (ik && ik.next) rows.appendChild(ckPrayer(ik, now));
    if (nx) {
      var no = ckRow(SYFS.t('المناسبة القادمة'), nx.name + ' · ' + nx.when);
      no.classList.add('syfs-ck-wrap');
      rows.appendChild(no);
    }
    ckAzkar(ik);

    ckSection(ckEl.querySelector('.syfs-ck-occ'), SYFS.t('مناسبات اليوم'),
      occ.list.map(function (o) { return { name: o.name, tag: o.label, type: o.type }; }), 'occ');

    var list = cal.ev.map(function (e) {
      return { name: e.x, tag: e.at, type: e.on ? 'ev' : 'off' };
    }).concat(cal.task.map(function (t) { return { name: t.x, tag: '', type: 'task' }; }));
    if (cal.more) list.push({ name: SYFS.t('و{0} غيرها', cal.more), tag: '', type: 'more' });
    ckSection(ckEl.querySelector('.syfs-ck-cal'), SYFS.t('تذكيرات اليوم'), list, 'cal');
    /* names the action the chip's click is armed with right now (see clkActionMsg) */
    ckEl.querySelector('.syfs-ck-hint').textContent = SYFS.t(clkActionMsg());

    ckPlace();
  }
  /* the TTL below is a floor, not the freshness contract: the calendar tool and the
     worker both write `cal_days`, and a reminder added a moment ago must be in the
     next card — so the cache is INVALIDATED by the write, not waited out. Registered
     once, outside any rebuild, because the listener outlives every rail node. */
  try {
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area !== 'local' || !ch) return;
      if (ch.cal_days || ch.occasions) { ckDaysT = 0; ckLast = ''; }
      /* the prayer / athkar snapshot depends on these three — a tick ✓ in the toast must
         turn the amber bar back at once, in every tab */
      if (ch.ithkar || ch.azkar_goal || ch.prayer_city) ikAsk(true);
      if (ch.occasions && SYFS.occ && SYFS.occ.settings) {
        clockOffset = SYFS.occ.settings(ch.occasions.newValue).offset;
        clockLast = '';
      }
      /* the panel lives in ONE tab and the chip lives in all of them — without this a
         style chosen here would look ignored everywhere else until a reload. Same
         whitelist on the way in: a storage event is not a trusted value either. */
      if (ch.rail_clock_style) clockStyle = clkPick(CLK_STYLES, ch.rail_clock_style.newValue, 'bold');
      if (ch.rail_clock_show) clockShow = clkPick(CLK_SHOWS, ch.rail_clock_show.newValue, 'both');
      if (ch.rail_clock_date) clockDate = clkPick(CLK_DATES, ch.rail_clock_date.newValue, 'dm');
      if (ch.rail_clock_24) clock24 = !!ch.rail_clock_24.newValue;
      /* window-button look: chosen in one tab, applied to the open windows of all */
      if (ch.winbtn && root) {
        var wbw = root.querySelector('.syfs-wrap');
        if (wbw) { wbw.dataset.winbtn = pickOne(SYFS.prefs.WINBTN_VALUES, ch.winbtn.newValue, SYFS.prefs.WINBTN_DEFAULT); markTheme(); }
      }
      if (SYFS.btnkit && ch[SYFS.btnkit.KEY] && root) {
        var glw = root.querySelector('.syfs-wrap');
        if (glw) { SYFS.btnkit.mark(glw, ch[SYFS.btnkit.KEY].newValue); markTheme(); }
      }
      if (ch.rail_clock_style || ch.rail_clock_show || ch.rail_clock_date || ch.rail_clock_24 || ch.occasions) {
        repaintClock(); fitRail();
      }
      /* `rail_clock` (إظهار الرقاقة أصلاً) كان المفتاح الوحيد من عائلة الساعة خارج هذا
         المستمع ⇒ إطفاؤها في تبويب يتركها ظاهرة في البقيّة حتى إعادة التحميل. وهي بنيةٌ
         لا حالة رسم، فالبناء كاملاً لا `repaintClock`. */
      if (ch.rail_clock) { clockOn = ch.rail_clock.newValue !== false; rebuildRail(); }
      /* «روابط مخصّصة» لها محرّران (اللوحة هنا وأداة الروابط) وكلٌّ يكتب المصفوفة كاملة من
         نسخته ⇒ من يكتب ثانياً كان يمحو تعديل الأول بصمت. المتابعة تجعل النسختين واحدة. */
      if (ch.custom_links) {
        customLinks = Array.isArray(ch.custom_links.newValue) ? ch.custom_links.newValue : [];
        rebuildRail();
      }
    });
  } catch (e) { /* no storage events on a surface without them — the TTL still holds */ }
  /* `cal_days` is read on hover, and at most once a minute: the card is opened by a
     gesture, not polled, and a reminder typed in another tab does not need to reach
     this one inside the same second. */
  function ckLoad() {
    var now = Date.now();
    if (ckDays && (now - ckDaysT) < 60000) return Promise.resolve();
    return Promise.all([store.get('cal_days', null), store.get('occasions', null)]).then(function (r) {
      ckDays = (r[0] && typeof r[0] === 'object' && !Array.isArray(r[0])) ? r[0] : {};
      ckDaysT = Date.now();
      /* the calibration is the occasions tool's setting, and its validator is the one
         that owns it — reading the raw value here would be a second opinion */
      var off = (SYFS.occ && SYFS.occ.settings) ? SYFS.occ.settings(r[1]).offset : 0;
      /* ONE offset for the chip and the card: a Hijri chip reading 14 beside a card
         reading 15 is worse than either being wrong on its own */
      if (off !== clockOffset) { clockOffset = off; clockLast = ''; paintClock(); }
    });
  }
  function ckOpen(chip, wrap) {
    if (!ckEl || !ckEl.isConnected) ckBuild(wrap);
    ckHeld = chip;
    clearTimeout(ckHideT);
    /* the two dates always exist, so unlike the activity panel this card can commit
       to opening before the storage read lands — it fills in, it does not appear */
    ckEl.classList.add('on');
    ckLast = ''; ckPaint();
    ckLoad().then(function () {
      if (ckHeld !== chip) return;                       /* pointer moved on while we waited */
      ckLast = ''; ckPaint();
    });
  }
  /* delegated on the rail like wireTips: mouseenter does not bubble, and re-entering
     the same chip (crossing an inner span counts) must restart nothing */
  function wireClockCard(rail, wrap) {
    rail.addEventListener('mouseover', function (e) {
      /* the shelf is open and this card is fixed at a HIGHER layer, so it would paint
         over the tools the click just asked for — the same call the activity panel makes */
      if (openCatKey) { ckHide(); return; }
      var c = e.target && e.target.closest && e.target.closest('.syfs-clock');
      if (c) {
        if (c === ckHeld) { clearTimeout(ckHideT); return; }
        clearTimeout(ckOpenT); clearTimeout(ckHideT);
        /* the same intent delay the activity panel uses: sweeping the pointer past
           the chip on the way to an icon must not flash a card */
        ckOpenT = setTimeout(function () { ckOpen(c, wrap); }, 170);
        return;
      }
      if (ckHeld && !ckIn) ckSchedHide();
    });
    rail.addEventListener('mouseout', function (e) {
      var c = e.target && e.target.closest && e.target.closest('.syfs-clock');
      if (!c || c.contains(e.relatedTarget)) return;
      clearTimeout(ckOpenT);
      if (c === ckHeld) ckSchedHide();
    });
    rail.addEventListener('mouseleave', ckSchedHide);
    /* CAPTURE, not bubble — every button in this bar stops propagation, so a bubble
       listener here would never run (§6.9/10). Clicking the CHIP is the 12/24 toggle
       and must leave the card up; clicking anything else opens a shelf, and the card
       has to be gone before it draws. */
    rail.addEventListener('click', function (e) {
      var c = e.target && e.target.closest && e.target.closest('.syfs-clock');
      if (!c) { clearTimeout(ckOpenT); ckHide(); }
    }, true);
  }

  function buildRail(wrap) {
    var rail = h('<div class="syfs-rail"></div>');
    shelfEl = h('<div class="syfs-shelf"><div class="syfs-shelf-head"><span class="syfs-shelf-title"></span><span class="syfs-shelf-count"></span></div><div class="syfs-flyout"></div></div>');
    var bar = h('<div class="syfs-bar"></div>');
    ikBarEl = bar;
    setTimeout(ikTick, 0);            /* once the bar is in the document */
    var run = h('<div class="syfs-run"></div>');
    openCatKey = null; openCatEl = null;

    /* وضع العمل — dedicated rail button: opens every (standalone) tool in a
     * separate app.html tab. The worker (SYFS_OPEN_APP) opens or re-activates it. */
    var appCat = h('<div class="syfs-cat syfs-appcat"><button class="syfs-cat-btn alt syfs-appbtn" title="وضع العمل — كل الأدوات في شاشة مستقلة"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></button></div>');
    appCat.querySelector('.syfs-appbtn').addEventListener('click', function (e) {
      e.stopPropagation(); closeShelf();
      if (SYFS.openApp) SYFS.openApp();
    });

    /* favorites category (hidden until something is starred) — it opens the same
       shelf every other category does, so a starred tool is reached exactly the
       way an unstarred one is */
    var favCat = h('<div class="syfs-cat syfs-favcat" data-cat="__fav" style="display:none"><button class="syfs-cat-btn alt syfs-favbtn" title="المفضلة"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17.3 5.8 20.9l1.6-6.8L2.2 8.9l6.9-.6z"/></svg></button></div>');
    favCat.querySelector('.syfs-favbtn').addEventListener('click', function (e) {
      e.stopPropagation();
      toggleShelf('__fav', 'المفضلة', catItems('__fav', favs.map(toolById).filter(Boolean)), favCat);
      /* a starred tool may live in a lazy file: the first open injects the bodies, then
         re-opens the shelf on the rebuilt rail — same pattern as the category buttons.
         (Until v0.139.2 this was done at BOOT for anyone with a single favourite, which
         injected all LAZY_TOOL_FILES into every page they visited.) */
      if (!toolsLoaded && openCatKey === '__fav') ensureTools(function () {
        var c = root.querySelector('.syfs-favcat');
        if (c) openShelf('__fav', 'المفضلة', catItems('__fav', favs.map(toolById).filter(Boolean)), c);
      });
    });

    /* ----- the bar's HEAD, exactly as the lab lays it out -----
     * المفضّلة · وضع العمل  ‖  التصنيفات  ‖  البحث · الإعدادات · المساعد  [الطيّ]
     * The chrome buttons carry `.alt` — graphite, not accent — so the bar has two
     * materials and the categories keep the accent to themselves. */
    /* the clock opens the head group — first thing read on a vertical rail, and on a
       flat one it lands at the reading start because the run is mirrored (§6.9/8) */
    if (clockOn) {
      clockEl = buildClock();
      clockLast = '';
      run.appendChild(clockEl);
      run.appendChild(h('<div class="syfs-sep"></div>'));
      paintClock();
      startClock();
    } else { clockEl = null; }

    run.appendChild(favCat);
    run.appendChild(appCat);
    run.appendChild(h('<div class="syfs-sep"></div>'));

    /* ----- main category icons (draggable to reorder; hidden categories skipped) ----- */
    var byCat = {};
    tools.forEach(function (t) { if (isHidden(t.id)) return; (byCat[t.cat] = byCat[t.cat] || []).push(t); });
    Object.keys(byCat).forEach(function (ck) { sortByOrder(byCat[ck], ck); });

    var known = ORDER.concat(Object.keys(cats), Object.keys(byCat));
    var visCats = known.filter(function (v, i, a) {
      if (a.indexOf(v) !== i || isCatHidden(v)) return false;
      if (byCat[v] && byCat[v].length) return true;   /* has loaded tools */
      return !toolsLoaded && !!cats[v];                /* known category, tools not injected yet */
    });
    visCats.sort(function (a, b) { return catRank(a) - catRank(b); });
    visCats.forEach(function (ck) {
      var meta = cats[ck] || { label: ck, icon: '' };
      var cat = h('<div class="syfs-cat" data-cat="' + ck + '" draggable="true"></div>');
      var btn = h('<button class="syfs-cat-btn">' + meta.icon + '</button>');
      btn.title = SYFS.t(meta.label);   /* an attribute, not string-built HTML: a label is text */      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleShelf(ck, SYFS.t(meta.label), catItems(ck, byCat[ck] || []), cat);
        /* first time any category is opened → inject the tool bodies, then re-open
           this one (rebuildRail replaces the DOM under us) */
        if (!toolsLoaded && openCatKey === ck) ensureTools(function () {
          var c = root.querySelector('.syfs-cat[data-cat="' + ck + '"]');
          if (!c) return;
          var list = tools.filter(function (t) { return t.cat === ck && !isHidden(t.id); });
          sortByOrder(list, ck);
          openShelf(ck, SYFS.t(meta.label), catItems(ck, list), c);
        });
      });
      /* drag-and-drop reordering of the main icons */
      cat.addEventListener('dragstart', function (e) { dragCat = ck; cat.classList.add('syfs-dragging'); closeShelf(); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ck); } catch (er) {} });
      cat.addEventListener('dragend', function () { dragCat = null; cat.classList.remove('syfs-dragging'); rail.querySelectorAll('.syfs-dragover').forEach(function (c) { c.classList.remove('syfs-dragover'); }); });
      cat.addEventListener('dragover', function (e) { if (dragCat && dragCat !== ck) { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (er) {} cat.classList.add('syfs-dragover'); } });
      cat.addEventListener('dragleave', function () { cat.classList.remove('syfs-dragover'); });
      cat.addEventListener('drop', function (e) { e.preventDefault(); cat.classList.remove('syfs-dragover'); if (dragCat && dragCat !== ck) reorderCats(dragCat, ck); });
      cat.appendChild(btn);
      run.appendChild(cat);
    });

    /* v0.148.0 — the lone AI button that used to sit here (it opened `sam-ai`) is now
     * the «المساعد الذكي» CATEGORY above: `sam-ai` first, then the AI site links
     * (src/tools2.js). It is last in ORDER, so it still closes the category group. */

    /* ===== the bar's TAIL: search, then settings, then the badge =====
     * Position, colours/style and the usage guide moved OFF the rail — they now
     * live inside the manager window (openManager → «الإعدادات»). */
    run.appendChild(h('<div class="syfs-sep"></div>'));

    /* Search every tool by name. The bar shows eleven categories; the palette is
     * how you reach a tool whose category you cannot remember, and ⌘K is the
     * shortcut every product with a palette uses. The chip under the magnifier
     * says so, because a shortcut nobody is told about does not exist. */
    var searchCat = h('<div class="syfs-cat syfs-searchcat"><button class="syfs-cat-btn alt syfs-searchbtn" title="بحث في كل الأدوات"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg><span class="syfs-kbd-chip"></span></button></div>');
    searchCat.querySelector('.syfs-kbd-chip').textContent = (navigator.platform || '').indexOf('Mac') >= 0 ? '⌘K' : '^K';
    searchCat.querySelector('.syfs-searchbtn').addEventListener('click', function (e) { e.stopPropagation(); closeShelf(); ensureTools(function () { openPalette(); }); });
    run.appendChild(searchCat);

    /* settings + manage shortcuts (custom links + show/hide + reorder + position/colours/guide).
     * A cog, not the three sliders it used to wear: sliders read as "adjust a
     * value", and this opens a whole settings window. It is also the glyph the
     * user picked in the lab. */
    var mgCat = h('<div class="syfs-cat"><button class="syfs-cat-btn alt syfs-mgbtn" title="الإعدادات"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg></button></div>');
    mgCat.querySelector('.syfs-mgbtn').addEventListener('click', function (e) { e.stopPropagation(); closeShelf(); ensureTools(function () { openManager(); }); });
    run.appendChild(mgCat);

    /* ----- the fold badge: OUTSIDE the run, so folding cannot take it with it.
     * It is appended LAST, which puts it at the bottom of a vertical rail; on
     * top/bottom the stylesheet pulls it to the other end along with the bar's
     * own controls, so it always sits beside them. ----- */
    var fold = h('<button class="syfs-fold" title="طيّ الشريط" aria-expanded="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 6 5 5 5-5"/><path d="m7 13 5 5 5-5"/></svg><span class="syfs-fold-cnt"></span></button>');
    fold.addEventListener('click', function (e) {
      e.stopPropagation();
      railFolded = !rail.classList.contains('folded');
      setFolded(railFolded); store.set('dock_folded', railFolded);
    });
    bar.appendChild(run); bar.appendChild(fold);
    rail.appendChild(shelfEl); rail.appendChild(bar);
    updateFoldCount();

    wrap.appendChild(rail);
    /* AFTER the rail is in the document — staggerRun reads computed `order`, and a
       detached subtree has none, which would silently index every position as if
       the badge trailed the bar. */
    staggerRun(run);
    attachRailMagnify(rail);
    wireTips(rail);
    /* the Quran mini-player owns itself; the rail only says which icon to watch.
       Wired per rebuild, like wireTips — the rail DOM is replaced, not patched, so
       the button it was tracking has just been thrown away and it must let go. */
    if (SYFS.qmini) { SYFS.qmini.hide(); SYFS.qmini.wire(rail, wrap); }
    /* same contract for the activity panel: the button it was tracking has just
       been thrown away, so it lets go before it is pointed at the new one */
    actHide();
    wireActivity(rail, wrap);
    /* and the clock card, for the same reason: `rebuildRail()` replaces the node, so
       the chip it was anchored to has just been thrown away */
    ckHide();
    wireClockCard(rail, wrap);
    markActive();
    /* restore the folded state without performing it — see setFolded's `instant` */
    setFolded(!!railFolded, true);
    return rail;
  }

  /* ---------- command palette: every tool by name (⌘K / Ctrl+K) ----------------
   * The bar shows categories, not tools. That is the right density for a strip
   * over someone else's page, but it means a tool whose category you cannot
   * remember costs you a hunt. This is the way past it: type three letters, hit
   * Enter. It reuses the window chrome, so it inherits the glass head and the
   * cascade rather than being a second kind of surface.
   * Names come from the registry and are internal constants, but custom links
   * carry a USER-supplied name — everything goes in through textContent. */
  function openPalette() {
    if (openWins.__palette) { focusWin(openWins.__palette); var q0 = openWins.__palette.querySelector('.syfs-pal-in'); if (q0) { q0.value = ''; q0.focus(); } return; }
    var win = h('<div class="syfs-win syfs-shut" style="width:320px"><div class="syfs-win-head">'
      + '<span class="syfs-win-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg></span>'
      + '<span class="syfs-win-title">بحث في كل الأدوات</span>'
      /* ⚙ beside ✕, in the standard cluster (`row-reverse`, so close keeps the outer
         corner and the gear sits inboard of it). The search window is the one surface
         you reach for when you cannot find something, which is also when you want the
         settings — and it does not depend on hitting a 46px circle on the rail. */
      + '<div class="syfs-win-actions">'
      + '<button class="syfs-win-x" title="إغلاق">' + (SYFS.winIcons || {}).close + '</button>'
      + '<button class="syfs-win-ctrl syfs-pal-set" title="الإعدادات">' + (SYFS.winIcons || {}).gear + '</button>'
      + '</div></div>'
      + '<div class="syfs-win-body"><div class="syf-form">'
      + '<input class="syf-in syfs-pal-in" type="text" placeholder="اكتب اسم الأداة…">'
      + '<div class="syf-note-list syfs-pal-list"></div></div></div></div>');
    root.querySelector('.syfs-wrap').appendChild(win);
    openWins.__palette = win;
    var input = win.querySelector('.syfs-pal-in'), list = win.querySelector('.syfs-pal-list');
    win.querySelector('.syfs-pal-set').addEventListener('click', function (e) {
      e.stopPropagation();                       /* the head is the drag handle */
      openManager();
    });

    function run(t) {
      close();
      runTool(t);
    }
    function render() {
      var q = (input.value || '').trim().toLowerCase();
      list.innerHTML = '';
      var hits = tools.filter(function (t) {
        if (isHidden(t.id) || isCatHidden(t.cat)) return false;
        if (typeof t.mount !== 'function' && typeof t.action !== 'function') return false;
        /* search both languages: the user may know a tool by either name */
        return !q || (t.name || '').toLowerCase().indexOf(q) >= 0 || SYFS.t(t.name).toLowerCase().indexOf(q) >= 0;
      }).slice(0, 40);
      if (!hits.length) { list.appendChild(h('<div class="syf-empty">لا نتائج.</div>')); return; }
      hits.forEach(function (t, i) {
        var row = h('<button class="syfs-pal-row' + (i === 0 ? ' on' : '') + '"><span class="ic"></span><span class="nm"></span><span class="cat"></span></button>');
        row.querySelector('.ic').innerHTML = t.icon || '';
        row.querySelector('.nm').textContent = SYFS.t(t.name);
        row.querySelector('.cat').textContent = (cats[t.cat] && SYFS.t(cats[t.cat].label)) || '';
        row.addEventListener('click', function (e) { e.stopPropagation(); run(t); });
        list.appendChild(row);
      });
    }
    /* ↑/↓ move the highlight, Enter takes it, Esc closes — a palette you have to
       reach for the mouse to finish is not a palette. */
    input.addEventListener('keydown', function (e) {
      var rows = Array.prototype.slice.call(list.querySelectorAll('.syfs-pal-row'));
      var i = rows.map(function (r) { return r.classList.contains('on'); }).indexOf(true);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!rows.length) return;
        var j = Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
        rows.forEach(function (r, k) { r.classList.toggle('on', k === j); });
        rows[j].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault(); if (rows[i < 0 ? 0 : i]) rows[i < 0 ? 0 : i].click();
      } else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    input.addEventListener('input', render);
    function close() { delete openWins.__palette; hideWin(win, function () { win.remove(); }); }
    win.querySelector('.syfs-win-x').addEventListener('click', close);
    win.addEventListener('mousedown', function () { focusWin(win); });

    render();
    focusWin(win);
    place(win, Math.max(20, Math.round(window.innerWidth / 2 - 160)), 90);
    makeDraggable(win, '__palette');
    indexRows(win.querySelector('.syfs-win-body'));
    showWin(win);
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 30);
  }

  /* ---------- manage shortcuts window (add custom links + show/hide tools) ---------- */
  function openManager() {
    if (openWins.__manage) { focusWin(openWins.__manage); return; }
    /* Wider than a tool window on purpose: this one carries four tabs, an accordion
       of every category, and rows that pair a name with a handle, a star, a hotkey
       and a checkbox. At 300px those rows wrapped. The cap keeps it on a narrow
       screen, where `place()` would otherwise clamp it against the edge.
       v0.159.1 — `syfs-mgwin` gives it a FIXED frame (rail.css): the side menu runs
       the full height and only the section beside it scrolls, so switching sections
       no longer grows and shrinks the window, and the narrow layout follows the
       window's own width (container query), not the browser's. */
    var win = h('<div class="syfs-win syfs-shut syfs-mgwin"><div class="syfs-win-head">'
      + '<span class="syfs-win-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h8M16 6h4M4 12h4M12 12h8M4 18h11M19 18h1"/><circle cx="14" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg></span>'
      + '<span class="syfs-win-title">الإعدادات</span>'
      + '<button class="syfs-win-x" title="إغلاق">' + (SYFS.winIcons || {}).close + '</button></div><div class="syfs-win-body"></div><div class="syfs-win-grip" title="تغيير الحجم"></div></div>');
    root.querySelector('.syfs-wrap').appendChild(win); openWins.__manage = win;
    var body = win.querySelector('.syfs-win-body');

    var add = h('<div class="syf-form"><label>إضافة اختصار مخصّص (يظهر في فئة روابط)</label><div class="syf-row"><input class="syf-in" id="mg-n" placeholder="الاسم"><input class="syf-in" id="mg-u" placeholder="https://"></div><button class="syf-btn" id="mg-add">إضافة</button><div class="syf-note-list" id="mg-cl"></div></div>');
    var clList = add.querySelector('#mg-cl'), nIn = add.querySelector('#mg-n'), uIn = add.querySelector('#mg-u');
    var toolSync = null;   /* set with the «الأدوات» sub-items below */
    function renderCL() {
      clList.innerHTML = '';
      if (!customLinks.length) { clList.appendChild(h('<div class="syf-empty">لا روابط مخصّصة بعد.</div>')); }
      customLinks.forEach(function (cl, i) {
        var r = h('<div class="syf-note-row"><span class="t"></span><button class="x">✕</button></div>');
        r.querySelector('.t').textContent = cl.n || cl.u;
        r.querySelector('.x').addEventListener('click', function () { customLinks.splice(i, 1); store.set('custom_links', customLinks); renderCL(); rebuildRail(); });
        clList.appendChild(r);
      });
      if (toolSync) toolSync();   /* the «روابط مخصّصة» count in the side menu */
    }
    add.querySelector('#mg-add').addEventListener('click', function () {
      var u = safeUrl(uIn.value); if (!u) { uIn.focus(); return; }
      customLinks.push({ n: nIn.value.trim().slice(0, 40), u: u }); store.set('custom_links', customLinks);
      nIn.value = ''; uIn.value = ''; renderCL(); rebuildRail();
    });
    renderCL();

    var sec = h('<div class="syf-form" style="margin-top:8px"><div class="syf-mg-hint">انقر عنوان التصنيف لفتحه، أو اسحبه من ⋮⋮ لترتيب التصنيفات. أزِل علامة التصنيف لإخفائه كاملاً، أو علامة الأداة لإخفائها. اسحب صفّ الأداة من ⋮⋮ لترتيبها داخل التصنيف. ★ للمفضلة، ولوحة المفاتيح لتعيين اختصار.</div></div>');
    var listBox = h('<div class="syf-mg-list"></div>'); sec.appendChild(listBox);
    var accOpen = {}, dragEl = null, dragCard = null; /* open accordions + current drag row / drag category card */
    function afterBy(container, sel, y) {
      var els = container.querySelectorAll(sel), closest = null, closestOff = -Infinity;
      for (var i = 0; i < els.length; i++) {
        var box = els[i].getBoundingClientRect(), off = y - box.top - box.height / 2;
        if (off < 0 && off > closestOff) { closestOff = off; closest = els[i]; }
      }
      return closest;
    }
    /* reorder whole category cards when a header is dragged over the list */
    listBox.addEventListener('dragover', function (e) {
      if (!dragCard) return;
      e.preventDefault();
      var after = afterBy(listBox, '.syf-acc:not(.card-dragging)', e.clientY);
      if (after == null) listBox.appendChild(dragCard); else listBox.insertBefore(dragCard, after);
    });
    function renderHideList() {
      listBox.innerHTML = '';
      var grouped = {}; tools.forEach(function (t) { if (t.noRail) return; (grouped[t.cat] = grouped[t.cat] || []).push(t); });
      Object.keys(grouped).forEach(function (ck) { sortByOrder(grouped[ck], ck); });
      var catKeys = ORDER.concat(Object.keys(grouped)).filter(function (v, i, a) { return a.indexOf(v) === i && grouped[v]; });
      catKeys.sort(function (a, b) { return catRank(a) - catRank(b); }); /* match the rail order */
      catKeys.forEach(function (ck) {
        var meta = cats[ck] || { label: ck }, list = grouped[ck];
        var acc = h('<div class="syf-acc' + (accOpen[ck] ? ' open' : '') + (isCatHidden(ck) ? ' cat-off' : '') + '" data-cat="' + ck + '"></div>');
        var head = h('<div class="syf-acc-head" draggable="true"><span class="syf-grip syf-acc-grip" title="اسحب لترتيب التصنيفات"><svg class="syf-grip-i" viewBox="0 0 12 18" aria-hidden="true"><circle cx="3.5" cy="3.5" r="1.6"/><circle cx="8.5" cy="3.5" r="1.6"/><circle cx="3.5" cy="9" r="1.6"/><circle cx="8.5" cy="9" r="1.6"/><circle cx="3.5" cy="14.5" r="1.6"/><circle cx="8.5" cy="14.5" r="1.6"/></svg></span><span class="syf-acc-caret" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9.5l6 6 6-6"/></svg></span><input type="checkbox" class="syf-acc-ck"' + (isCatHidden(ck) ? '' : ' checked') + ' title="إظهار/إخفاء التصنيف"><span class="syf-acc-title"></span><span class="syf-acc-badge"></span></div>');
        head.querySelector('.syf-acc-title').textContent = SYFS.t(meta.label);
        var badge = head.querySelector('.syf-acc-badge');
        function paintBadge() { badge.textContent = list.filter(function (x) { return !isHidden(x.id); }).length + '/' + list.length; }
        paintBadge();
        var catCk = head.querySelector('.syf-acc-ck');
        catCk.addEventListener('click', function (e) { e.stopPropagation(); });
        catCk.addEventListener('change', function () { setCatHidden(ck, !this.checked); acc.classList.toggle('cat-off', !this.checked); });
        head.querySelector('.syf-acc-grip').addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); });
        head.addEventListener('click', function () { accOpen[ck] = !accOpen[ck]; acc.classList.toggle('open', accOpen[ck]); });
        head.addEventListener('dragstart', function (e) {
          dragCard = acc; acc.classList.add('card-dragging');
          try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'cat:' + ck); } catch (x) {}
        });
        head.addEventListener('dragend', function () {
          acc.classList.remove('card-dragging');
          if (dragCard === acc) {
            var keys = []; listBox.querySelectorAll('.syf-acc').forEach(function (c) { keys.push(c.getAttribute('data-cat')); });
            setCatOrder(keys);
          }
          dragCard = null;
        });
        acc.appendChild(head);

        var bodyEl = h('<div class="syf-acc-body"></div>');
        list.forEach(function (t) {
          var rowEl = h('<div class="syf-mg-row" draggable="true" data-id="' + t.id + '"><span class="syf-grip" title="اسحب لإعادة الترتيب"><svg class="syf-grip-i" viewBox="0 0 12 18" aria-hidden="true"><circle cx="3.5" cy="3.5" r="1.6"/><circle cx="8.5" cy="3.5" r="1.6"/><circle cx="3.5" cy="9" r="1.6"/><circle cx="8.5" cy="9" r="1.6"/><circle cx="3.5" cy="14.5" r="1.6"/><circle cx="8.5" cy="14.5" r="1.6"/></svg></span><input type="checkbox" class="syf-mg-ck"' + (isHidden(t.id) ? '' : ' checked') + '><span class="nm"></span><button type="button" class="syf-mg-hk' + (hotkeys[t.id] ? ' on' : '') + '" title="تعيين اختصار لوحة مفاتيح"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6.5" width="19" height="11" rx="2.2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01"/><line x1="9" y1="14" x2="15" y2="14"/></svg></button><button type="button" class="syf-mg-fav' + (isFav(t.id) ? ' on' : '') + '" data-id="' + t.id + '" title="إضافة للمفضلة">' + (SYFS.winIcons || {}).star + '</button></div>');
          rowEl.querySelector('.nm').textContent = SYFS.t(t.name);
          rowEl.querySelector('.syf-mg-ck').addEventListener('change', function () { setHidden(t.id, !this.checked); paintBadge(); });
          rowEl.querySelector('.syf-grip').addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); });
          var favBtn = rowEl.querySelector('.syf-mg-fav');
          favBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleFav(t.id); favBtn.classList.toggle('on', isFav(t.id)); });
          var hkBtn = rowEl.querySelector('.syf-mg-hk');
          function paintHk() {
            var c = hkOf(t.id);
            hkBtn.classList.toggle('on', !!c);
            hkBtn.title = c ? SYFS.t('اختصار: {0} — انقر للتغيير · Esc إلغاء · Delete حذف', comboLabel(c)) : SYFS.t('تعيين اختصار لوحة مفاتيح');
          }
          paintHk();
          hkBtn.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            if (hkRecording) return;
            hkRecording = true; hkBtn.classList.remove('warn'); hkBtn.classList.add('rec');
            function onKey(ev) {
              ev.preventDefault(); ev.stopPropagation();
              if (ev.key === 'Escape') { doneHk(); return; }
              if (ev.key === 'Backspace' || ev.key === 'Delete') { clearHotkey(t.id); doneHk(); return; }
              if (MODNAMES[ev.key]) return; /* wait for the real key */
              var combo = comboFromEvent(ev);
              if (!combo) { hkBtn.classList.add('warn'); return; }
              setHotkey(t.id, combo); doneHk();
            }
            function doneHk() {
              hkCancel = null;
              hkRecording = false; document.removeEventListener('keydown', onKey, true);
              hkBtn.classList.remove('rec', 'warn');
              paintHk(); if (typeof renderHk === 'function') renderHk();
            }
            hkDisarm();                 /* تسليح ثانٍ لا يترك الأول حيّاً */
            hkCancel = doneHk;
            document.addEventListener('keydown', onKey, true);
          });
          rowEl.addEventListener('dragstart', function (e) {
            dragEl = rowEl; rowEl.classList.add('dragging');
            try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); } catch (x) {}
          });
          rowEl.addEventListener('dragend', function () {
            rowEl.classList.remove('dragging');
            if (dragEl === rowEl) {
              var ids = []; bodyEl.querySelectorAll('.syf-mg-row').forEach(function (r) { ids.push(r.getAttribute('data-id')); });
              setToolOrder(ck, ids);
            }
            dragEl = null;
          });
          bodyEl.appendChild(rowEl);
        });
        bodyEl.addEventListener('dragover', function (e) {
          if (!dragEl || dragEl.parentNode !== bodyEl) return; /* only same-category reordering */
          e.preventDefault(); e.stopPropagation(); /* don't let the category-card handler also react */
          var after = afterBy(bodyEl, '.syf-mg-row:not(.dragging)', e.clientY);
          if (after == null) bodyEl.appendChild(dragEl); else bodyEl.insertBefore(dragEl, after);
        });
        acc.appendChild(bodyEl);
        listBox.appendChild(acc);
      });
    }
    renderHideList();

    /* v0.160.0 — «الأدوات» carries two jobs that were stacked in one scroll: the
       category/tool list and the custom-link form. v0.161.1: they are sub-items of
       «الأدوات» in the side menu, drawn exactly like the groups of «المظهر»
       (.syf-side-tab: icon · name · the value in force) — one kind of sub-item.
       The key lives in data-k, never in the (translated) label (§6.103/4). */
    var TOOL_IC = {
      list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
      links: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></svg>'
    };
    var toolNav = h('<div class="syf-side-nav" role="tablist"></div>');
    var toolBox = h('<div class="syf-mg-inner"></div>');
    var toolPanes = { list: sec, links: add }, toolCur = 'list', toolTabsEl = {};
    sec.style.marginTop = '0'; add.style.marginTop = '0';
    toolBox.appendChild(sec); toolBox.appendChild(add);
    [['list', 'الاختصارات'], ['links', 'روابط مخصّصة']].forEach(function (d) {
      var b = h('<button class="syf-side-tab" type="button" role="tab" aria-selected="false" data-ic="' + d[0] + '"><span class="syf-side-ic" aria-hidden="true">' + TOOL_IC[d[0]] + '</span><span class="syf-side-nm"></span><span class="syf-side-vl"></span></button>');
      b.querySelector('.syf-side-nm').textContent = SYFS.t(d[1]);
      b.addEventListener('click', function () { toolShow(d[0]); });
      toolNav.appendChild(b); toolTabsEl[d[0]] = b;
    });
    /* the values: tools shown / tools on the bar, and how many custom links exist.
       Numbers only — they read the same in both languages. */
    toolSync = function () {
      var all = tools.filter(function (t) { return !t.noRail; });
      var shown = all.filter(function (t) { return !isHidden(t.id) && !isCatHidden(t.cat); }).length;
      toolTabsEl.list.querySelector('.syf-side-vl').textContent = shown + '/' + all.length;
      toolTabsEl.links.querySelector('.syf-side-vl').textContent = String(customLinks.length);
    };
    function toolShow(k) {
      toolCur = k;
      Object.keys(toolTabsEl).forEach(function (p) {
        toolTabsEl[p].classList.toggle('on', p === k); toolTabsEl[p].setAttribute('aria-selected', p === k ? 'true' : 'false');
      });
      Object.keys(toolPanes).forEach(function (p) { toolPanes[p].style.display = p === k ? 'flex' : 'none'; });
      if (mgTitleSync) mgTitleSync();
    }
    listBox.addEventListener('change', function () { toolSync(); });
    toolShow('list'); toolSync();

    /* ===== settings: grouped tabs (sub-items of «المظهر» in the manager's side rail since v0.158.0), not one forty-control scroll (v0.106.0) =====
     * This tab was a single flat run: language, position, colour, button style, font,
     * a local-font field, two page-font paragraphs, hover effect, icon size, list mode,
     * opacity, edge-peek, then eight clock rows — twenty-odd controls separated by
     * nothing but a 6px margin, with five explanatory paragraphs mixed in at the same
     * weight as the controls they explain. Whatever you came for was below the fold and
     * looked like everything else on the way down.
     *
     * v0.105.0 grouped them into four accordion cards, which fixed the wall but kept a
     * moving map: opening the third group pushes the fourth head down past the fold, so
     * the thing you navigate by is redrawn by the act of navigating, and the other three
     * values are only readable while every group is shut.
     *
     * Same controls, same order, same grouping by the QUESTION each answers — now behind
     * a fixed side rail (rail.css `.syf-side`). Four names that never move, each carrying
     * its own current value, and one panel beside them. The manager window already tabs
     * its four sections at the top, so this is that same idea one level in, turned on its
     * side because the labels are phrases rather than words.
     * ⚠️ Every control below appends to a GROUP body. A new setting appended to `setSec`
     * itself would land under the whole side layout, outside all four panes. */
    var setSec = h('<div class="syf-form" style="margin-top:10px"></div>');
    var setSide = h('<div class="syf-side"></div>');
    var setNav = h('<div class="syf-side-nav" role="tablist"></div>');
    var setPanes = h('<div class="syf-side-panes"></div>');
    /* the group list is NOT in this panel: it sits in the manager's side rail, under the
       «المظهر» entry, as that entry's sub-items (see mgDefs below) — one tree, one side */
    setSide.appendChild(setPanes); setSec.appendChild(setSide);
    var setGroups = [], setTabs = [], setBodies = [], setCur = 0, mgTitleSync = null;
    function setShow(i) {
      setCur = i;
      setTabs.forEach(function (b, j) { b.classList.toggle('on', j === i); b.setAttribute('aria-selected', j === i ? 'true' : 'false'); });
      /* `flex`, not `block`: the pane is a `syf-form`, and that is where the 9px gap
         between a label and its row comes from */
      setBodies.forEach(function (p, j) { p.style.display = j === i ? 'flex' : 'none'; });
      if (mgTitleSync) mgTitleSync();   /* the pane's heading names the open group */
    }
    /* `sum` returns the tab's current-value line — call it AFTER the control it reads has
       been built, which is why sync() is deferred and setSync() runs once at the end. */
    function setGrp(title, sum, ic) {
      var i = setTabs.length;
      var b = h('<button class="syf-side-tab" type="button" role="tab" aria-selected="false" data-ic="' + ic + '"><span class="syf-side-ic" aria-hidden="true">' + (SET_IC[ic] || '') + '</span><span class="syf-side-nm"></span><span class="syf-side-vl"></span></button>');
      b.querySelector('.syf-side-nm').textContent = SYFS.t(title);
      var val = b.querySelector('.syf-side-vl');
      var body = h('<div class="syf-side-pane syf-form" role="tabpanel"></div>');
      b.addEventListener('click', function () { setShow(i); });
      setNav.appendChild(b); setPanes.appendChild(body);
      setTabs.push(b); setBodies.push(body);
      setGroups.push(function () { val.textContent = sum(); });
      return body;
    }
    function setSync() { setGroups.forEach(function (f) { f(); }); }
    /* one setting = one `.syf-set` row: its label, its control, its hint — and a hairline
       above the next row (rail.css). Rows are the only spacing a pane has. */
    function setRow(pane) { var r = h('<div class="syf-set"></div>'); pane.appendChild(r); return r; }
    var SET_IC = {
      globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
      bar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16M18 8.5v.01M18 12v.01M18 15.5v.01"/></svg>',
      palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-1.3-1.1-1.6-1.1-2.8 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.4 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/></svg>',
      type: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5h16v2M9 19h6M12 5v14"/></svg>',
      clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
    };
    /* the summaries read the SAME state the controls write, never a copy of it */
    function posLabel() {
      var w = root.querySelector('.syfs-wrap'), p = (w && w.dataset.pos) || 'right';
      return SYFS.t({ right: 'يمين', left: 'يسار', top: 'أعلى', bottom: 'أسفل' }[p] || 'يمين');
    }
    function fxLabel(list, v, def) {
      for (var i = 0; i < list.length; i++) if (list[i][0] === v) return SYFS.t(list[i][1]);
      return SYFS.t(def);
    }

    /* ----- v0.157.0: five groups (v0.158.0: sub-items of «المظهر» in the side rail) -----
     * Grouped by what each setting CHANGES: the whole UI (عام), the bar (الشريط), the
     * colour and the buttons, the type, the clock. The three are created here, up front,
     * so the strip's order is decided in one place; fonts and the clock follow below.
     * Language first: it is the only setting that renames every other label here. */
    /* v0.161.0 — «عام» is no longer a group of «المظهر» but its own section, first in
       the side menu, with the settings backup under it (see mgDefs). Same box, same
       rows; it just is not one of setGrp's tabs any more. */
    var gGen = h('<div class="syf-side-pane syf-form" style="display:flex"></div>');
    var gBar = setGrp('الشريط', function () {
      return posLabel() + (szIn ? ' · ' + szIn.value + '%' : '');
    }, 'bar');
    var gLook = setGrp('الاستايل', function () {
      var w = root.querySelector('.syfs-wrap');
      return fxLabel(SYFS.STYLES, (w && w.dataset.cstyle) || 'solid', 'صلب');
    }, 'palette');

    var langR = setRow(gGen);
    langR.appendChild(h('<label>اللغة — Language</label>'));
    var langRow = h('<div class="syf-row" style="flex-wrap:wrap"></div>');
    [['ar', 'العربية'], ['en', 'English']].forEach(function (l) {
      var b = h('<button class="syfs-pos-opt" data-lang="' + l[0] + '"></button>');
      b.textContent = l[1];                       /* i18n-dyn: a language names itself */
      b.addEventListener('click', function () { setLang(l[0]); });
      langRow.appendChild(b);
    });
    langR.appendChild(langRow);
    langR.appendChild(h('<div class="syf-note-hint">العربية هي الافتراضي. تغيير اللغة يقلب اتجاه الواجهة ويغلق النوافذ المفتوحة.</div>'));
    /* «سلكت ٢» (src/sel2.js) — ON by default; the checkbox is its only switch and the
       change applies live on every surface through storage.onChanged. It changes every
       list of every tool, which is why it is «عام» and not a colour. */
    if (SYFS.sel2) {
      var s2R = setRow(gGen);
      var s2Row = h('<label class="syf-ck"><input type="checkbox"><span>قوائم منسدلة محسّنة (سلكت ٢) مع بحث داخل الخيارات</span></label>');
      var s2Ck = s2Row.querySelector('input');
      store.get(SYFS.sel2.KEY, true).then(function (v) { s2Ck.checked = v !== false; });
      s2Ck.addEventListener('change', function () { store.set(SYFS.sel2.KEY, s2Ck.checked); });
      s2R.appendChild(s2Row);
      s2R.appendChild(h('<div class="syf-mg-hint">تعمل على قوائم الأدوات وصفحات الإضافة فقط، ولا تغيّر قوائم المواقع التي تتصفّحها.</div>'));
    }

    var posR = setRow(gBar);
    posR.appendChild(h('<label>موضع الشريط</label>'));
    var posRow = h('<div class="syf-row" style="flex-wrap:wrap"></div>');
    [['right', 'يمين'], ['left', 'يسار'], ['top', 'أعلى'], ['bottom', 'أسفل']].forEach(function (p) {
      var b = h('<button class="syfs-pos-opt" data-p="' + p[0] + '"></button>');
      b.textContent = SYFS.t(p[1]);
      b.addEventListener('click', function () { setPos(p[0]); setSync(); });
      posRow.appendChild(b);
    });
    posR.appendChild(posRow);

    /* colour and the button material. Typefaces have their own tab: colour and type
       are two questions. */
    var accR = setRow(gLook);
    accR.appendChild(h('<label>اللون</label>'));
    var accRow = h('<div class="syfs-acc-row"></div>');
    SYFS.ACCENTS.forEach(function (a) {
      var sw = h('<button class="syfs-acc" data-rgb="' + rgbStr(a[0]) + '" title="' + a[1] + '" style="background:' + a[0] + '"></button>');
      sw.addEventListener('click', function () { SYFS.applyAccent(root.querySelector('.syfs-wrap'), a[0]); store.set('accent', a[0]); markTheme(); });
      accRow.appendChild(sw);
    });
    accR.appendChild(accRow);
    /* any colour: the native picker plus a hex field. Both write the same `accent` key, and
       only a value passing ACCENT_RE is stored — it ends up in style properties. The picker
       paints live while dragging and stores once, on `change`. */
    var cusRow = h('<div class="syfs-acc-cus"><label class="syfs-acc-pk" title="اختر أي لون"><input type="color" class="syfs-acc-in" value="#457364" aria-label="لون مخصّص"><span>لون مخصّص</span></label>' +
      '<input class="syf-in syfs-acc-hex" dir="ltr" spellcheck="false" placeholder="#457364" aria-label="رمز اللون"></div>');
    var cusPick = cusRow.querySelector('.syfs-acc-in'), cusHex = cusRow.querySelector('.syfs-acc-hex');
    cusHex.maxLength = 7;
    function setAccent(v, save) {
      if (!SYFS.ACCENT_RE.test(v)) return false;
      v = v.toLowerCase();
      SYFS.applyAccent(root.querySelector('.syfs-wrap'), v);
      if (save) store.set('accent', v);
      markTheme();
      return true;
    }
    cusPick.addEventListener('input', function () { setAccent(cusPick.value, false); });
    cusPick.addEventListener('change', function () { setAccent(cusPick.value, true); });
    cusHex.addEventListener('input', function () {
      var v = cusHex.value.trim(); if (v && v.charAt(0) !== '#') v = '#' + v;
      /* half-typed codes are not errors yet — only a full-length one that fails is */
      cusHex.classList.toggle('syf-bad', !setAccent(v, true) && v.length >= 7);
    });
    /* leaving the field drops a bad code and shows the colour actually in use (the picker
       always holds it — markTheme keeps it in step) */
    cusHex.addEventListener('blur', function () { cusHex.classList.remove('syf-bad'); cusHex.value = cusPick.value; });
    accR.appendChild(cusRow);
    var styR = setRow(gLook);
    styR.appendChild(h('<label>نمط الأزرار</label>'));
    var styRow = h('<div class="syfs-sty-row"></div>');
    SYFS.STYLES.forEach(function (s) {
      var b = h('<button class="syfs-sty" data-s="' + s[0] + '"></button>');
      b.textContent = SYFS.t(s[1]);
      b.addEventListener('click', function () { var w = root.querySelector('.syfs-wrap'); w.dataset.cstyle = s[0]; store.set('cstyle', s[0]); markTheme(); setSync(); });
      styRow.appendChild(b);
    });
    styR.appendChild(styRow);
    /* v0.151.0 — the window-head cluster: today's look, the same with the two groups
       (window · tool) split by a hairline, or macOS traffic lights. Stored as
       `winbtn`; applyTheme() puts it on the wrap as data-winbtn and rail.css does the rest. */
    var wbR = setRow(gLook);
    wbR.appendChild(h('<label>شكل أزرار النافذة</label>'));
    var wbRow = h('<div class="syfs-sty-row"></div>');
    [['sep', 'مع فاصل'], ['classic', 'بدون فاصل'], ['mac', 'إشارات ماك']].forEach(function (s) {
      var b = h('<button class="syfs-sty syfs-wb" data-wb="' + s[0] + '"></button>');
      b.textContent = SYFS.t(s[1]);
      b.addEventListener('click', function () { var w = root.querySelector('.syfs-wrap'); w.dataset.winbtn = s[0]; store.set('winbtn', s[0]); markTheme(); });
      wbRow.appendChild(b);
    });
    wbR.appendChild(wbRow);
    /* v0.159.0 — the look of this window's own side menu (layoutNav, with the menu
       below). Stored as `mgr_nav`; «أيقونات + عمود» is the default. */
    var navR = setRow(gLook);
    navR.appendChild(h('<label>شكل القائمة الجانبية</label>'));
    var navRow = h('<div class="syfs-sty-row"></div>');
    [['strip', 'أيقونات + عمود'], ['flat', 'قائمة بعناوين'], ['brand', 'لوحة ملوّنة']].forEach(function (s) {
      var b = h('<button class="syfs-sty syfs-nav-opt" data-nav="' + s[0] + '"></button>');
      b.textContent = SYFS.t(s[1]);
      b.addEventListener('click', function () { store.set('mgr_nav', s[0]); layoutNav(s[0]); });
      navRow.appendChild(b);
    });
    navR.appendChild(navRow);
    /* v0.154.0 — the glass look of every button and switch + the button icons
       (controls.css · src/btnkit.js). ON by default; off = each button's own look. */
    if (SYFS.btnkit) {
      var glRow = h('<label class="syf-ck"><input type="checkbox" class="syfs-glass-ck"><span>الشكل الزجاجي للأزرار مع الأيقونات</span></label>');
      var glCk = glRow.querySelector('input');
      glCk.addEventListener('change', function () {
        SYFS.btnkit.mark(root.querySelector('.syfs-wrap'), glCk.checked);
        store.set(SYFS.btnkit.KEY, glCk.checked);
      });
      setRow(gLook).appendChild(glRow);
    }

    /* ----- group 3: UI font (src/fontkit.js) — bundled OFL families + any font on the
     * device. Applies to the rail, the tool windows, the workspace dock and every
     * standalone extension page, because they all read the same --syfs-font variable. */
    if (SYFS.fontkit) {
      var FK = SYFS.fontkit;
      /* the tab's value line names the font in force — a local one by its own name, so
         «مخصّص» never stands in for something the user typed themselves */
      var gFont = setGrp('الخطوط', function () {
        var on = fnRow && fnRow.querySelector('.syfs-fn.on');
        if (on) return on.textContent;
        return locIn && locIn.value ? locIn.value : SYFS.t('خط النظام');
      }, 'type');
      var fR = setRow(gFont);
      fR.appendChild(h('<label>خط الواجهة</label>'));
      var fnRow = h('<div class="syfs-fn-row"></div>');
      /* the system option first, then one preview chip per bundled family */
      var sysB = h('<button class="syfs-fn" data-f=""></button>');
      sysB.textContent = SYFS.t('خط النظام');
      fnRow.appendChild(sysB);
      FK.FAMILIES.forEach(function (f) {
        var b = h('<button class="syfs-fn" data-f="' + f[0] + '"></button>');
        /* f[2] is the Arabic name and is also its own msgid — en.json maps it to the
           Latin one (تجوّل → Tajawal), so the chip names the family the reader knows. */
        b.textContent = SYFS.t(f[2]);
        b.style.fontFamily = FK.stackFor(f[0]);   /* the chip previews itself */
        FK.load(f[0]);                            /* …so pull its bytes in now */
        fnRow.appendChild(b);
      });
      fR.appendChild(fnRow);

      /* any typeface installed on this machine — name typed by the user, filtered by
       * whitelist in fontkit.cleanLocal before it ever reaches a style property */
      var locWrap = h('<div class="syf-row"></div>');
      var locIn = h('<input class="syf-in" placeholder="أو اكتب اسم خط مثبّت على جهازك">');
      var locB = h('<button class="syf-mini">تطبيق</button>');
      locWrap.appendChild(locIn); locWrap.appendChild(locB);
      fR.appendChild(locWrap);
      fR.appendChild(h('<div class="syf-mg-hint">الخطوط المرفقة مضمّنة داخل الإضافة (رخصة OFL) وتعمل بلا إنترنت — لا يُرسَل أي طلب لخوادم جوجل. الخط المكتوب يدوياً يظهر فقط إن كان مثبّتاً على هذا الجهاز.</div>'));

      /* the same font on the sites themselves (v0.99.0) — OFF by default, because it
         restyles someone else's page and that is not a default anyone should inherit */
      var pgRow = h('<label class="syf-ck"><input type="checkbox"><span>طبّق الخط أيضاً على المواقع التي أتصفّحها</span></label>');
      var pgCk = pgRow.querySelector('input');
      FK.getPage(function (v) { pgCk.checked = !!v; });
      pgCk.addEventListener('change', function () { FK.setPage(pgCk.checked); });
      var pR = setRow(gFont);
      pR.appendChild(pgRow);
      /* ⚠️ no <b> anywhere in this sentence: an inline tag splits one text node into
         three msgids that can never be reassembled in English word order (§6.102/3) */
      pR.appendChild(h('<div class="syf-mg-hint">يغيّر خط محتوى الصفحات فقط. ⚠️ واجهة كروم نفسها (التبويبات وشريط العنوان والقوائم) لا تستطيع أي إضافة تغيير خطّها. الأيقونات والشيفرة البرمجية تُترك بخطّها الأصلي، وإلّا ظهرت الأيقونات مربّعات فارغة.</div>'));

      function markFont(v) {
        var isLocal = v && v.indexOf('local:') === 0;
        fnRow.querySelectorAll('.syfs-fn').forEach(function (b) { b.classList.toggle('on', !isLocal && b.dataset.f === v); });
        locIn.value = isLocal ? v.slice(6) : '';
        locWrap.classList.toggle('on', !!isLocal);
        setSync();                              /* the tab's value line names this font */
      }
      fnRow.querySelectorAll('.syfs-fn').forEach(function (b) {
        b.addEventListener('click', function () { FK.set(b.dataset.f); markFont(b.dataset.f); });
      });
      function applyLocal() {
        var n = FK.cleanLocal(locIn.value);
        if (!n) { locIn.value = ''; return; }
        locIn.value = n;                       /* show exactly what will be used */
        FK.set('local:' + n); markFont('local:' + n);
      }
      locB.addEventListener('click', applyLocal);
      locIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') applyLocal(); });
      FK.get(markFont);
    }

    /* ----- group 4: the bar itself — size, opacity, hover effect, tool display,
     * edge-peek. Shared with the app-mode dock (src/dockfx.js): any change here
     * applies to both. Ordered by how often it is touched, size first. */
    if (SYFS.dockfx) {
      /* the value line names the SIZE now, not the hover effect: size is what this tab
         is opened for, and it is the one setting whose result the user may not be able
         to reach on screen (see the cap hint below) */

      /* ⛔ one slider, not four presets — see the tombstone in src/dockfx.js. 100% is
         the smallest icon (38px) and the bar grows from there. */
      var szR = setRow(gBar);
      szR.appendChild(h('<label>حجم الأيقونات</label>'));
      var szRow = h('<div class="syfs-op-row"></div>');
      var SC = SYFS.dockfx.SCALE;
      var szIn = h('<input type="range" min="' + SC.min + '" max="' + SC.max + '" step="' + SC.step + '">');
      var szVal = h('<span class="syfs-op-val"></span>');
      szRow.appendChild(szIn); szRow.appendChild(szVal);
      szR.appendChild(szRow);
      var szHint = h('<div class="syf-mg-hint"></div>');
      szR.appendChild(szHint);
      /* Runs on every input AND after every applyDockPrefs (via `dockApplied`), because
         the cap is only known after the rail has measured itself against the viewport.
         Saying «you asked for 180%, the screen gives 140%» is the whole point: without
         it, the slider past that point looks broken rather than full. */
      function szSync() {
        szVal.textContent = szIn.value + '%';
        var got = Math.round((+szIn.value) * fitCap());
        szHint.textContent = got < (+szIn.value)
          ? SYFS.t('المعروض الآن {0}% — لا تتّسع الشاشة لأكثر من ذلك بكل التصنيفات الظاهرة. أخفِ تصنيفاً من تبويب «الأدوات» أو اطوِ الشريط لتكسب مساحة.', String(got))
          : SYFS.t('100% = أصغر حجم. يسري على الشريط العائم ودوك مساحة العمل معاً.');
        setSync();
      }
      szIn.addEventListener('input', function () { SYFS.dockfx.save({ dock_scale: +szIn.value }); szSync(); });
      dockApplied = szSync;

      var opR = setRow(gBar);
      opR.appendChild(h('<label>الشفافية</label>'));
      var opRow = h('<div class="syfs-op-row"></div>');
      var opIn = h('<input type="range" min="35" max="100" step="5">');
      var opVal = h('<span class="syfs-op-val"></span>');
      opRow.appendChild(opIn); opRow.appendChild(opVal);
      opR.appendChild(opRow);
      opIn.addEventListener('input', function () { opVal.textContent = opIn.value + '%'; SYFS.dockfx.save({ dock_opacity: (+opIn.value) / 100 }); });

      /* «مثل الماك» is gone from this label: it named ONE of the six options, and the
         one that is no longer the default at that — a heading that describes a single
         item in the list it heads reads as a recommendation. */
      var fxR = setRow(gBar);
      fxR.appendChild(h('<label>تأثير التمرير</label>'));
      var fxRow = h('<div class="syfs-fx-row"></div>');
      SYFS.dockfx.EFFECTS.forEach(function (e) {
        var b = h('<button class="syfs-fx" data-fx="' + e[0] + '"></button>'); b.textContent = SYFS.t(e[1]);
        b.addEventListener('click', function () { SYFS.dockfx.save({ dock_effect: e[0] }); fxRow.querySelectorAll('.syfs-fx').forEach(function (x) { x.classList.toggle('on', x === b); }); });
        fxRow.appendChild(b);
      });
      fxR.appendChild(fxRow);

      var lbR = setRow(gBar);
      lbR.appendChild(h('<label>عرض أدوات التصنيف</label>'));
      var lbRow = h('<div class="syfs-fx-row"></div>');
      SYFS.dockfx.LABELS.forEach(function (l) {
        var b = h('<button class="syfs-fx" data-lb="' + l[0] + '"></button>'); b.textContent = SYFS.t(l[1]);
        b.addEventListener('click', function () { SYFS.dockfx.save({ dock_labels: l[0] }); lbRow.querySelectorAll('.syfs-fx').forEach(function (x) { x.classList.toggle('on', x === b); }); });
        lbRow.appendChild(b);
      });
      lbR.appendChild(lbRow);
      lbR.appendChild(h('<div class="syf-mg-hint">«أيقونة + اسم» (الافتراضي) = قائمة عمودية بالأسماء · «أيقونات فقط» = شريط مضغوط والاسم يظهر عند الوقوف على الأيقونة.</div>'));

      /* edge-peek: the rail tucks against the screen EDGE and comes back when the
         pointer approaches. Not to be confused with the removed «إخفاء كل الأدوات» —
         this one is undone by moving the mouse, which is why it survived. */
      var edgeCk = h('<label class="syf-ck"><input type="checkbox"> إخفاء عند الحافة — تظهر عند الاقتراب (توفّر مساحة الشاشة)</label>');
      edgeCk.querySelector('input').addEventListener('change', function () { SYFS.dockfx.save({ dock_peek: this.checked }); });
      setRow(gBar).appendChild(edgeCk);

      /* ----- group 4: the clock -----
       * ⚠️ Both controls call rebuildRail(), and only the first one needs to: turning
       * the clock off removes a node. The format toggle repaints in place — it is here
       * as the SAME control the chip itself is, so the two can never disagree. */
      var gClock = setGrp('الوقت', function () { return SYFS.t(clockOn ? 'ظاهر' : 'مخفي'); }, 'clock');
      var clkCk = h('<label class="syf-ck"><input type="checkbox"> عرض الوقت والتاريخ على الشريط</label>');
      clkCk.querySelector('input').checked = clockOn;
      /* Four rows, and they are FOUR because they answer four questions: how it looks ·
         what it holds · how the time reads · how the date reads. Rolling them into one
         "theme" list would mean the calendar look also decides you want the Hijri date.
         Every row is the same segmented control the appearance tab already uses, and
         every one writes through `setClockPref` so the chip, the card and the rail's
         own fit are updated by one path. */
      var clkBox = h('<div></div>');       /* everything below the checkbox hides with it */
      function clkSeg(label, list, current, key) {
        var set = setRow(clkBox);
        set.appendChild(h('<label>' + label + '</label>'));
        var row = h('<div class="syfs-fx-row"></div>');
        list.forEach(function (o) {
          var b = h('<button class="syfs-fx"></button>');
          b.textContent = SYFS.t(o[1]);    /* i18n-dyn: the label is translated HERE, at the write (§6.103/7) */
          b.classList.toggle('on', current() === o[0]);
          b.addEventListener('click', function () {
            row.querySelectorAll('.syfs-fx').forEach(function (x) { x.classList.toggle('on', x === b); });
            setClockPref(key, o[0]);
          });
          row.appendChild(b);
        });
        set.appendChild(row);
        return row;
      }
      clkSeg('الشكل', CLK_STYLES, function () { return clockStyle; }, 'style');
      var showRow = clkSeg('ماذا يُعرض', CLK_SHOWS, function () { return clockShow; }, 'show');
      var c24R = setRow(clkBox);
      c24R.appendChild(h('<label>صيغة الوقت</label>'));
      var clkRow = h('<div class="syfs-fx-row"></div>');
      [[false, '١٢ ساعة'], [true, '٢٤ ساعة']].forEach(function (o) {
        var b = h('<button class="syfs-fx"></button>');
        b.textContent = SYFS.t(o[1]);
        b.classList.toggle('on', clock24 === o[0]);
        b.addEventListener('click', function () {
          clock24 = o[0]; store.set('rail_clock_24', clock24);
          clkRow.querySelectorAll('.syfs-fx').forEach(function (x) { x.classList.toggle('on', x === b); });
          repaintClock();                  /* the card shows the same face (§6.9/12) */
        });
        clkRow.appendChild(b);
      });
      c24R.appendChild(clkRow);
      var dateRow = clkSeg('صيغة التاريخ', CLK_DATES, function () { return clockDate; }, 'date');
      /* a row that governs something the chip is not showing is a control that appears
         to do nothing — so each format row follows its own half of «ماذا يُعرض» */
      function clkSync() {
        /* the whole row goes — label, control and the hairline above it */
        clkRow.parentNode.style.display = clockShow === 'date' ? 'none' : '';
        dateRow.parentNode.style.display = clockShow === 'time' ? 'none' : '';
      }
      showRow.addEventListener('click', clkSync);
      clkSync();
      clkCk.querySelector('input').addEventListener('change', function () {
        clockOn = this.checked; store.set('rail_clock', clockOn);
        clkBox.style.display = clockOn ? '' : 'none';
        setSync();
        rebuildRail();
      });
      clkBox.style.display = clockOn ? '' : 'none';
      var ckR = setRow(gClock);
      ckR.appendChild(clkCk);
      gClock.appendChild(clkBox);
      ckR.appendChild(h('<div class="syf-mg-hint">الضغط على الساعة في الشريط يبدّل الصيغة مباشرةً (وصيغة التاريخ إن كان التاريخ وحده معروضاً)، والوقوف عليها يفتح بطاقة اليوم: الميلادي والهجري ومناسبات اليوم وتذكيراته. الأرقام لاتينية في اللغتين، وأسماء الشهور والأيام تتبع لغة الواجهة.</div>'));

      SYFS.dockfx.load(function (p) {
        fxRow.querySelectorAll('.syfs-fx').forEach(function (b) { b.classList.toggle('on', b.dataset.fx === p.effect); });
        lbRow.querySelectorAll('.syfs-fx').forEach(function (b) { b.classList.toggle('on', b.dataset.lb === (p.labels || SYFS.dockfx.DEFAULTS.labels)); });
        szIn.value = p.scale; szSync();               /* also refreshes the cap hint */
        opIn.value = Math.round((p.opacity != null ? p.opacity : 1) * 100); opVal.textContent = opIn.value + '%';
        edgeCk.querySelector('input').checked = !!p.peek;
        setSync();                                   /* the tabs name the values just read */
      });
    }
    setSync();
    setShow(0);      /* one pane is always open — a side rail with nothing beside it reads as broken */

    /* ===== keyboard shortcuts: pick a tool + record a combo → open it from any page ===== */
    var hkSec = h('<div class="syf-form" style="margin-top:10px"><label style="font-weight:800;color:var(--pri);border-bottom:1px solid var(--line);padding-bottom:4px;margin-bottom:2px">اختصارات لوحة المفاتيح</label><div class="syf-mg-hint">اختر أداة ثم سجّل توليفة (استخدم Alt/Ctrl مع حرف). تعمل فوق أي صفحة عندما لا تكتب في حقل.</div></div>');
    var hkRow = h('<div class="syf-row"></div>');
    var hkSel = h('<select class="syf-in" id="hk-sel"></select>');
    tools.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); }).forEach(function (t) {
      var op = document.createElement('option'); op.value = t.id; op.textContent = SYFS.t(t.name); hkSel.appendChild(op);
    });
    var hkRec = h('<button class="syf-btn" id="hk-rec">⌨ سجّل توليفة</button>');
    hkRow.appendChild(hkSel); hkRow.appendChild(hkRec); hkSec.appendChild(hkRow);
    var hkList = h('<div class="syf-note-list" id="hk-list"></div>'); hkSec.appendChild(hkList);
    function renderHk() {
      hkList.innerHTML = '';
      /* the user's rows first (in the order they were made), then the shipped defaults
         the user has not touched — each is one row, and a default is marked as such */
      var ids = Object.keys(hotkeys).filter(function (id) { return !!hkOf(id); });
      tools.forEach(function (t) { if (!hkUser(t.id) && hkOf(t.id)) ids.push(t.id); });
      if (!ids.length) { hkList.appendChild(h('<div class="syf-empty">لا اختصارات بعد.</div>')); return; }
      ids.forEach(function (id) {
        var t = toolById(id); if (!t) return;
        var row = h('<div class="syf-note-row"><span class="t"></span><kbd class="syf-kbd"></kbd><button class="x" title="حذف">✕</button></div>');
        row.querySelector('.t').textContent = SYFS.t(t.name) + (hkUser(id) ? '' : ' — ' + SYFS.t('افتراضي'));
        row.querySelector('.syf-kbd').textContent = comboLabel(hkOf(id));
        row.querySelector('.x').addEventListener('click', function () { clearHotkey(id); renderHk(); });
        hkList.appendChild(row);
      });
    }
    hkRec.addEventListener('click', function () {
      if (hkRecording) return;
      hkRecording = true; hkRec.textContent = SYFS.t('… اضغط التوليفة الآن (Esc للإلغاء)');
      function onKey(e) {
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') { finish(); return; }
        if (MODNAMES[e.key]) return; /* wait for the real key */
        var combo = comboFromEvent(e);
        if (!combo) { hkRec.textContent = SYFS.t('⚠ استخدم Alt/Ctrl مع حرف — أعد المحاولة'); return; }
        setHotkey(hkSel.value, combo); finish(); renderHk();
      }
      function finish() { hkCancel = null; hkRecording = false; document.removeEventListener('keydown', onKey, true); hkRec.textContent = SYFS.t('⌨ سجّل توليفة'); }
      hkDisarm();
      hkCancel = finish;
      document.addEventListener('keydown', onKey, true);
    });
    renderHk();

    /* ----- the built-in chords (v0.99.0) -------------------------------------
     * The switch is here rather than beside the recorder because it governs a
     * different thing: the recorder makes ONE binding, this turns eighty on or off. */
    hkSec.appendChild(h('<label style="margin-top:10px">الاختصارات الافتراضية لكل الأدوات</label>'));
    var hkDefRow = h('<label class="syf-ck"><input type="checkbox"><span>فعّل الاختصارات الافتراضية (Ctrl+Alt+K ثم حرف التصنيف ثم حرف الأداة)</span></label>');
    var hkDefCk = hkDefRow.querySelector('input');
    hkDefCk.checked = hkDefaults;
    hkDefCk.addEventListener('change', function () {
      hkDefaults = hkDefCk.checked;
      store.set('hk_defaults', hkDefaults);
      if (!hkDefaults) chordClose();
      hkShowB.disabled = !hkDefaults;
    });
    hkSec.appendChild(hkDefRow);
    hkSec.appendChild(h('<div class="syf-mg-hint">اضغط Ctrl+Alt+K فتظهر قائمة التصنيفات بحروفها، ثم حرف التصنيف فتظهر أدواته. الحروف مشتقّة من الأدوات الظاهرة عندك، فالقائمة على الشاشة هي المرجع — لا شيء يُحفظ ولا شيء تحفظه أنت. اختصاراتك اليدوية فوق لها الأسبقية دائماً، وإطفاء هذا الخيار يترك Ctrl+Alt+K للصفحة.</div>'));
    var hkShowB = h('<button class="syf-mini">⌨ اعرض قائمة الاختصارات الافتراضية</button>');
    hkShowB.disabled = !hkDefaults;
    hkShowB.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!toolsLoaded) ensureTools(function () { chordReset(); chordOpen(); }); else chordOpen();
    });
    hkSec.appendChild(hkShowB);

    var helpBtn = h('<button class="syf-mini" style="margin-top:10px">📖 دليل الاستخدام — كل الاختصارات</button>');
    /* ⚠️ Two guide pages, not one translated page (§6.100) — so the button has to pick.
       `=== 'en'` is a whitelist rather than a comparison: this value builds a resource
       path. The rail already knows the language, so nothing is read here. */
    helpBtn.addEventListener('click', function () {
      var page = (SYFS.i18n.get() === 'en') ? 'help-en.html' : 'help.html';
      try { window.open(chrome.runtime.getURL(page), '_blank'); } catch (e) {}
    });
    hkSec.appendChild(helpBtn);

    /* ===== backup: export / import / reset all extension settings ===== */
    var bkSec = h('<div class="syf-form" style="margin-top:14px"><label style="font-weight:800;color:var(--pri);border-bottom:1px solid var(--line);padding-bottom:4px;margin-bottom:2px">النسخ الاحتياطي</label><div class="syf-mg-hint">صدّر كل إعداداتك وبياناتك (المفضلة، الترتيب، الروابط، الملاحظات، الاختصارات…) إلى ملف، أو استعِدها على جهاز آخر، أو أعد التعيين بالكامل.</div></div>');
    var bkRow = h('<div class="syf-row" style="flex-wrap:wrap"></div>');
    var expB = h('<button class="syf-mini">⬇ تصدير</button>');
    var impB = h('<button class="syf-mini">⬆ استيراد</button>');
    var rstB = h('<button class="syf-mini">↺ إعادة تعيين</button>');
    var bkFile = h('<input type="file" accept="application/json,.json" style="display:none">');
    bkRow.appendChild(expB); bkRow.appendChild(impB); bkRow.appendChild(rstB);
    bkSec.appendChild(bkRow); bkSec.appendChild(bkFile);
    var bkMsg = h('<div class="syf-note-hint" style="margin-top:6px"></div>'); bkSec.appendChild(bkMsg);
    function bkNote(t) { bkMsg.textContent = t; }
    expB.addEventListener('click', function () {
      try {
        chrome.storage.local.get(null, function (all) {
          if (chrome.runtime.lastError) { bkNote(SYFS.t('تعذّر التصدير.')); return; }
          try {
            /* ⛔ ملفٌّ اسمه «إعدادات» يُشارَك ويُرفع للسحابة كأنه تفضيلات — وحتى v0.103.0
               كان يحمل مفاتيح مزوّدي الذكاء الاصطناعي نصّاً صريحاً وكتلة الخزنة المشفّرة
               وبصمة قفل واتساب وملحه. الاعتماد لا يسافر مع التفضيلات: يُرشَّح هنا، ويقول
               النصّ للمستخدم كم أُسقط بدل أن يكتشفه لاحقاً. الخزنة تُنقَل بتصديرها هي. */
            var ex = SYFS.prefs.exportable(all), out = ex.out, dropped = ex.dropped;
            var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a'); a.href = url; a.download = 'syf-tools-settings.json';
            (document.body || document.documentElement).appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
            bkNote(dropped ? SYFS.t('تم التصدير إلى syf-tools-settings.json — بلا المفاتيح والخزنة ({0} عنصراً حسّاساً لم يُكتب).', String(dropped))
                           : SYFS.t('تم التصدير إلى ملف syf-tools-settings.json'));
          } catch (e) { bkNote(SYFS.t('تعذّر التصدير: {0}', (e && e.message) || '')); }
        });
      } catch (e) { bkNote(SYFS.t('تعذّر الوصول للتخزين.')); }
    });
    impB.addEventListener('click', function () { bkFile.value = ''; bkFile.click(); });
    bkFile.addEventListener('change', function () {
      var f = bkFile.files && bkFile.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var obj = JSON.parse(rd.result);
          if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('صيغة غير صالحة');
          /* ⛔ هذا هو الباب الذي يدخل منه كل ما تحرسه القوائم البيضاء أدناه. حتى v0.103.0
             كان أي كائن JSON يُكتب كما هو ⇒ `{"tool_order":{"islam":3}}` في ملفٍّ تالف
             يقتل الشريط على **كل صفحة** بلا واجهة يُفتح منها التصفير. القراءة تحرس نفسها
             الآن، والكتابة تحرس معها: دفاعان لأن الأول وحده يترك القيمة السامّة في التخزين.
             والاعتمادات لا تُستورَد أصلاً — التصدير لم يعد يكتبها (SECRET_KEYS). */
          var im = SYFS.prefs.cleanImport(obj, SYFS.STYLES.map(function (x) { return x[0]; }));
          var clean = im.clean, skipped = im.skipped;
          chrome.storage.local.set(clean, function () {
            if (chrome.runtime.lastError) { bkNote(SYFS.t('تعذّر الاستيراد.')); return; }
            bkNote(skipped ? SYFS.t('تم الاستيراد ✓ — أُسقط {0} مفتاحاً غير صالح أو حسّاس. أعد تحميل الصفحة.', String(skipped))
                           : SYFS.t('تم الاستيراد بنجاح ✓ — أعد تحميل الصفحة لتطبيق كل شيء.'));
          });
        } catch (e) { bkNote(SYFS.t('ملف غير صالح: {0}', (e && e.message) || '')); }
      };
      rd.readAsText(f);
    });
    /* two-click confirm instead of a blocking confirm() dialog */
    var rstArmed = false, rstT = null;
    rstB.addEventListener('click', function () {
      if (!rstArmed) {
        rstArmed = true; rstB.textContent = SYFS.t('⚠ اضغط للتأكيد'); rstB.classList.add('danger');
        bkNote(SYFS.t('تُمحى كل الإعدادات والبيانات المحفوظة (الملاحظات والتقويم وغيرها). حافظة كلمات المرور ومفاتيح المساعد والأقفال تبقى.'));
        rstT = setTimeout(function () { rstArmed = false; rstB.textContent = SYFS.t('↺ إعادة تعيين'); rstB.classList.remove('danger'); bkNote(''); }, 4000);
        return;
      }
      clearTimeout(rstT); rstArmed = false; rstB.textContent = SYFS.t('↺ إعادة تعيين'); rstB.classList.remove('danger');
      /* ⛔ v0.177 — this was `storage.local.clear()`: the vault blob went with the theme and
         the hotkeys, and every saved password was gone for good behind a button labelled
         «settings». The credentials SECRET_KEYS already keeps out of export/import
         (vault_*, the AI keys, the lock hashes, saved sessions) are kept here too. */
      try {
        chrome.storage.local.get(null, function (all) {
          if (chrome.runtime.lastError || !SYFS.prefs) { bkNote(SYFS.t('تعذّر.')); return; }
          chrome.storage.local.remove(resetKeys(all), function () {
            bkNote(chrome.runtime.lastError ? SYFS.t('تعذّر.') : SYFS.t('أُعيد تعيين الإعدادات — الحافظة والمفاتيح والأقفال لم تُمسّ. أعد تحميل الصفحة.'));
          });
        });
      } catch (e) { bkNote(SYFS.t('تعذّر.')); }
    });
    /* ===== «من أنا» — the author card (v0.134.0): accent cover, photo, name, bio, link rows.
       The Latin spelling and the job line are gone on purpose: the name already says who this
       is, and a role naming an employer ages out of a card nobody edits. ===== */
    var abSec = h('<div class="syf-form syf-about" style="margin-top:10px">'
      + '<div class="syf-about-cover"></div>'
      + '<div class="syf-about-body">'
      + '<img class="syf-about-photo" alt="" width="64" height="64">'
      + '<div class="syf-about-name">سعد الفضالي</div>'
      + '<div class="syf-about-bio">أبني أدوات تختصر العمل اليومي على المتصفّح — وهذه الإضافة واحدة منها. كل شيء يعمل على جهازك، ولا يغادره إلا ما تطلبه أنت.</div>'
      + '<div class="syf-about-links"></div></div></div>');
    /* the photo ships in the package (icons/author.jpg, web_accessible) — an extension
       URL, never a hotlink: the host page's CSP and a CDN URL that expires would both
       leave a broken image in the card */
    var abImg = abSec.querySelector('.syf-about-photo');
    try { abImg.src = chrome.runtime.getURL('icons/author.jpg'); } catch (e) {}
    abImg.addEventListener('error', function () { abImg.remove(); });
    var abLinks = abSec.querySelector('.syf-about-links');
    /* i18n-dyn: brand names and handles, no translation.
       `h` (the handle) is written with textContent like `t` — a profile id is user-facing text
       that ends up in the DOM, and the rule is the same for it as for everything else. */
    [
      { t: 'LinkedIn', h: '@saadfadaly', u: 'https://www.linkedin.com/in/saadfadaly/', c: '#0a66c2',
        i: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.5 8.5v10h-3v-10zM5 4a1.75 1.75 0 1 1 0 3.5A1.75 1.75 0 0 1 5 4zm4.5 4.5h2.9v1.4c.5-.9 1.6-1.7 3.3-1.7 3.3 0 3.8 2.1 3.8 4.9v5.4h-3v-4.8c0-1.2 0-2.6-1.6-2.6s-1.9 1.2-1.9 2.5v4.9h-3z"/></svg>' }
    ].forEach(function (l) {
      var a = h('<a class="syf-about-link" target="_blank" rel="noopener noreferrer"><span class="ic">' + l.i + '</span><span class="t"></span><span class="h"></span></a>');
      a.href = l.u; a.style.setProperty('--brand', l.c);
      a.querySelector('.t').textContent = l.t;
      a.querySelector('.h').textContent = l.h || '';
      abLinks.appendChild(a);
    });

    /* ===== «قادم» — the roadmap (v0.176.x) =====================================
     * ▶ TO ADD A POINT: one line in ROADMAP below. `tool` groups the rows (in the order
     *   tools first appear), `title` + `desc` are the row, `status` (optional) a chip
     *   from ROADMAP_STATUS. Arabic is the source text; each new string needs its line
     *   in i18n/en.json like every other msgid.
     * Everything is written with textContent — this list is data, never markup. */
    var ROADMAP_STATUS = { planned: 'مخطَّط', building: 'قيد التطوير' };
    var ROADMAP = [
      { tool: 'الورد اليومي', title: 'المصحف كاملاً داخل الأداة', desc: 'تصفّح صفحات المصحف كلها داخل الورد، صفحةً صفحة كما في المصحف المطبوع.', status: 'planned' },
      { tool: 'الورد اليومي', title: 'التحكم في تكرار الآيات', desc: 'تكرار آية أو مقطع عدداً تختاره — للحفظ والمراجعة.', status: 'planned' },
      { tool: 'الورد اليومي', title: 'اختيار الشيخ القارئ', desc: 'استمع إلى وردك بصوت القارئ الذي تفضّله.', status: 'planned' },
      { tool: 'الورد اليومي', title: 'مميزات أخرى قادمة', desc: 'علامات مرجعية لمواضع القراءة، وتفسير مختصر للآيات، وغيرها.', status: 'planned' },
      { tool: 'الحاسبة', title: 'الحاسبة المتقدمة', desc: 'حاسبة علمية بالدوال والأقواس والذاكرة، وتحويل الوحدات.', status: 'planned' },
      { tool: 'أدوات جديدة', title: 'تحويل النص إلى صوت بشري', desc: 'اكتب أي نص واستمع إليه بصوت بشري طبيعي، واحفظه ملفاً صوتياً.', status: 'planned' },
      { tool: 'تطبيقات أخرى', title: 'تطبيق أندرويد', desc: 'تطبيق للجوال بنفس أدوات الإضافة.', status: 'planned' },
      { tool: 'تطبيقات أخرى', title: 'موقع الإضافة: جرّبها دون تثبيت', desc: 'تجربة كاملة للإضافة من المتصفح دون إضافتها إلى كروم، ومعها دليل الاستخدام. والإضافة المثبّتة لا تعمل داخل الموقع حتى لا تتداخل مع التجربة.', status: 'planned' }
    ];
    var soonSec = h('<div class="syf-form" style="margin-top:10px"><div class="syf-mg-hint">أفكار نعمل عليها للإصدارات القادمة — لا مواعيد ملزمة، وقد يتغيّر ترتيبها.</div></div>');
    var soonGroups = {};
    ROADMAP.forEach(function (it) {
      var grp = soonGroups[it.tool];
      if (!grp) {
        var head = h('<h3 style="margin:6px 0 0;font-size:12.5px;font-weight:800;color:var(--pri);border-bottom:1px solid var(--line);padding-bottom:4px"></h3>');
        head.textContent = SYFS.t(it.tool);
        grp = soonGroups[it.tool] = h('<ul class="syf-note-list" style="list-style:none;margin:4px 0 0;padding:0"></ul>');
        soonSec.appendChild(head); soonSec.appendChild(grp);
      }
      var row = h('<li class="syf-occ-row" data-t="fast"><div class="syf-occ-t"><b></b><span class="syf-occ-d"></span></div></li>');
      row.querySelector('b').textContent = SYFS.t(it.title);
      row.querySelector('.syf-occ-d').textContent = SYFS.t(it.desc);
      if (ROADMAP_STATUS[it.status]) {
        var chip = h('<span class="syf-occ-b"></span>');
        chip.textContent = SYFS.t(ROADMAP_STATUS[it.status]);
        row.appendChild(chip);
      }
      grp.appendChild(row);
    });

    /* ===== the manager's side menu (v0.159.0) — three looks over ONE set of buttons =====
     * «strip» (default): a narrow brand-coloured column of section icons, and beside it a
     *   light column with the groups of the open section (only «المظهر» has groups).
     * «flat»: no nesting — small grey headings, each item an icon tile; «المظهر»'s own
     *   entry gives way to its five groups under the heading of the same name.
     * «brand»: one brand-coloured panel, the open section a white card, the groups on a
     *   dotted line under «المظهر».
     * layoutNav() only re-parents the same buttons, so every click handler survives a
     * switch. The look is picked in «الاستايل» and saved as `mgr_nav`. */
    /* v0.162.0 — the icon set of the chosen «مربّعات» strip: gear · wrench · brush ·
       keyboard · person (settings-strip-options.html, set B) */
    var MG_IC = {
      gen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
      tools: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/></svg>',
      look: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 14.5 3 21"/><path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L13 13.8l-4-4z"/><path d="M9 9.8c-2 .2-3.5 1.7-3.5 3.7 0 1.4-.5 2.3-1.5 3 3 1 7.5 0 8.4-3.3"/></svg>',
      keys: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7.5 14h9"/></svg>',
      about: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
      /* «قادم» — a flag on a pole: a destination ahead */
      soon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>'
    };
    var mgTabBar = h('<div class="syf-tabs syf-mg-tabs"></div>');
    var mgDefs = [
      /* v0.161.0 — «عام» first: language + the settings backup («النسخ» is gone as
         a section of its own) */
      { id: 'gen', label: 'عام', els: [gGen, bkSec] },
      /* `cur` = the sub-item now open in that section (for the pane's heading) */
      { id: 'tools', label: 'الأدوات', els: [toolBox], sub: toolNav, cur: function () { return toolTabsEl[toolCur]; } },
      { id: 'look', label: 'المظهر', els: [setSec], sub: setNav, cur: function () { return setTabs[setCur]; } },
      { id: 'keys', label: 'المفاتيح', els: [hkSec] },
      { id: 'about', label: 'من أنا', els: [abSec] },
      { id: 'soon', label: 'قادم', els: [soonSec] }
    ];
    var mgPanels = [], mgBtns = [], mgCur = 0;
    /* the section's own scroller and its heading (v0.159.1): icon + name, and for a
       group of «المظهر» the group's name with «· المظهر» after it — as in the design */
    var mgPane = h('<div class="syf-mg-pane"></div>');
    var mgTitle = h('<div class="syf-mg-pt"><span class="syf-mg-pt-ic" aria-hidden="true"></span><span class="syf-mg-pt-nm"></span><small class="syf-mg-pt-up"></small></div>');
    mgPane.appendChild(mgTitle);
    mgTitleSync = function () {
      var d = mgDefs[mgCur], tab = d.cur ? d.cur() : null;
      /* i18n-dyn: constant SVG icon markup, no text — copied from the sub-item itself */
      mgTitle.querySelector('.syf-mg-pt-ic').innerHTML = tab ? tab.querySelector('.syf-side-ic').innerHTML : MG_IC[d.id];
      mgTitle.querySelector('.syf-mg-pt-nm').textContent = tab ? tab.querySelector('.syf-side-nm').textContent : SYFS.t(d.label);
      mgTitle.querySelector('.syf-mg-pt-up').textContent = tab ? '· ' + SYFS.t(d.label) : '';
    };
    function mgShow(i) {
      mgCur = i;
      /* aria-current names the open section for a screen reader — the class alone is paint */
      mgBtns.forEach(function (b, j) { b.classList.toggle('on', j === i); if (j === i) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
      mgPanels.forEach(function (p, j) { p.style.display = j === i ? 'block' : 'none'; });
      /* a sub-item is only «current» while its section is the one shown; in the
         strip look the column shows the open section's sub-items and its name */
      mgTabBar.classList.toggle('syf-mg-subon', !!mgDefs[i].sub);
      mgDefs.forEach(function (d, j) { if (d.sub) d.sub.classList.toggle('syf-sub-off', j !== i); });
      if (mgDefs[i].sub) mgCol.querySelector('.syf-mg-col-t').textContent = SYFS.t(mgDefs[i].label);
      if (mgDefs[i].id === 'tools' && toolSync) toolSync();
      mgTitleSync();
      mgPane.scrollTop = 0;
    }
    mgDefs.forEach(function (d, i) {
      var pan = h('<div class="syf-tabpanel"></div>');
      d.els.forEach(function (el, k) { if (k === 0) el.style.marginTop = '0'; pan.appendChild(el); });
      mgPanels.push(pan);
      var b = h('<button class="syf-tab" type="button" data-mg="' + d.id + '"><span class="syf-mg-ic" aria-hidden="true">' + MG_IC[d.id] + '</span><span class="syf-mg-nm"></span></button>');
      b.querySelector('.syf-mg-nm').textContent = SYFS.t(d.label);
      b.title = SYFS.t(d.label);
      b.addEventListener('click', function () { mgShow(i); });
      mgBtns.push(b);
      /* picking a group also opens its section (the group button's own click has run) */
      if (d.sub) d.sub.addEventListener('click', function () { mgShow(i); });
    });
    var mgHeads = [h('<div class="syf-mg-h">الاختصارات</div>'), h('<div class="syf-mg-h">المظهر</div>'), h('<div class="syf-mg-h">أخرى</div>')];
    var mgStrip = h('<div class="syf-mg-strip"></div>');
    var mgCol = h('<div class="syf-mg-col"><div class="syf-mg-col-t">المظهر</div></div>');
    function layoutNav(v) {
      if (['strip', 'flat', 'brand'].indexOf(v) < 0) v = 'strip';
      mgTabBar.textContent = '';
      mgTabBar.setAttribute('data-nav', v);
      if (v === 'strip') {
        mgBtns.forEach(function (b) { mgStrip.appendChild(b); });
        mgDefs.forEach(function (d) { if (d.sub) mgCol.appendChild(d.sub); });
        mgTabBar.appendChild(mgStrip); mgTabBar.appendChild(mgCol);
      } else if (v === 'flat') {
        /* a section with sub-items gives way to them under its heading */
        [mgBtns[0], mgHeads[0], toolNav, mgBtns[3], mgHeads[1], setNav, mgHeads[2], mgBtns[4], mgBtns[5]].forEach(function (el) { mgTabBar.appendChild(el); });
      } else {
        mgBtns.forEach(function (b, i) { mgTabBar.appendChild(b); if (mgDefs[i].sub) mgTabBar.appendChild(mgDefs[i].sub); });
      }
      root.querySelectorAll('.syfs-nav-opt').forEach(function (b) { b.classList.toggle('on', b.dataset.nav === v); });
    }
    layoutNav('strip');
    store.get('mgr_nav', 'strip').then(layoutNav);
    body.appendChild(mgTabBar);
    mgPanels.forEach(function (p) { mgPane.appendChild(p); });
    body.appendChild(mgPane);
    mgShow(0);
    markPos(); markTheme(); markLang();

    win.querySelector('.syfs-win-x').addEventListener('click', function () {
      hkDisarm();                 /* اللوحة تختفي ⇒ لا يبقى مسجّل مسلَّح يبتلع مفاتيح الصفحة */
      dockApplied = null;         /* …ولا يبقى fitRail يكتب في حقول نافذة مُزالة */
      delete openWins.__manage;
      hideWin(win, function () { win.remove(); });
    });
    win.addEventListener('mousedown', function () { focusWin(win); });
    /* the manager is a window like any other — it opened pinned to the right edge,
       which is the same complaint the tool windows had */
    /* resizable like every window, and — the part that was missing — re-clamped by
       winsize when the browser window shrinks, so it can never be left off-screen.
       `__mgr`, not `__manage`: sizes saved under the old key were the heights of
       whichever section happened to be open, and must not come back.
       No «fit»: the frame is fixed on purpose, there is no natural size to fit to. */
    var mgSize = SYFS.winsize ? SYFS.winsize.attach(win, { minW: 360, minH: 320, canFit: false, onChange: function () { savePos('__mgr', win); } }) : null;
    focusWin(win); centreWin(win); makeDraggable(win, '__mgr');
    store.get('win___mgr', null).then(function (p) {
      if (!mgSize || !win.isConnected || !(p && typeof p === 'object' && p.w > 0 && p.h > 0)) return;
      mgSize.set(p.w, p.h); centreWin(win);
    });
    /* Until the user resizes it, the size is CSS (min(680px, screen) × min(600px,
       screen)) and follows the browser both ways; winsize only takes over a size
       someone chose. What CSS cannot do is keep the window's POSITION on screen
       when the browser shrinks — that is this listener, gone with the window. */
    function mgKeep() {
      if (!win.isConnected) { window.removeEventListener('resize', mgKeep); return; }
      if (win.classList.contains('syfs-max') || win.classList.contains('syfs-min')) return;
      var x = Math.max(8, Math.min(win.offsetLeft, window.innerWidth - win.offsetWidth - 8));
      var y = Math.max(8, Math.min(win.offsetTop, window.innerHeight - win.offsetHeight - 8));
      win.style.left = x + 'px'; win.style.top = y + 'px';
    }
    window.addEventListener('resize', mgKeep);
    indexRows(body); showWin(win);
  }

  /* ---------- THE CASCADE: a window grows out of its head, and back into it ----
   * Ported from the bar's fold (v0.77.0). There the badge stays put and the strip
   * unrolls out of it; here the HEAD stays put and the panel unrolls out of it
   * downward, row by row. Every row carries its DISTANCE FROM THE HEAD in --i and
   * the body carries the largest of them in --n; rail.css does the rest.
   * Shared verbatim with src/app.js — the same window on two surfaces. */
  var WI = SYFS.winIcons || {};
  var SHUT_MS = 440;   /* rows (90+300) and frame (180+220) both land under this */
  function indexRows(body) {
    /* Nearly every tool builds ONE .syf-form and puts its fields in it; a few
       build straight into the body. Index whichever actually holds the rows. */
    var host = (body.children.length === 1 && body.firstElementChild
                && body.firstElementChild.classList.contains('syf-form')) ? body.firstElementChild : body;
    var rows = [];
    Array.prototype.forEach.call(host.children, function (el) {
      /* a list or a results grid is a CONTAINER of rows, not a row: cascading the
         container would drop six prayer times in as one block */
      if (el.classList.contains('syf-note-list') || el.classList.contains('syf-out')) {
        Array.prototype.forEach.call(el.children, function (r) { rows.push(r); });
      } else rows.push(el);
    });
    /* Cap it. A calculator keypad or a 300-row list would otherwise stagger for
       seconds; past this point rows simply arrive with the frame, which is the
       right trade — the cascade is an entrance, not a loading bar. */
    if (rows.length > 22) rows = rows.slice(0, 22);
    body.style.setProperty('--n', String(Math.max(rows.length - 1, 0)));
    rows.forEach(function (r, k) { r.classList.add('syfs-win-row'); r.style.setProperty('--i', String(k)); });
  }
  function showWin(win) {
    clearTimeout(win._shutT);
    win.style.display = '';
    /* Flush the layout before dropping the class. Without it the browser
       coalesces both changes into one style pass, has no starting value to
       animate from, and the window simply appears. */
    void win.offsetWidth;
    win.classList.remove('syfs-shut');
  }
  function hideWin(win, done) {
    clearTimeout(win._shutT);
    win.classList.add('syfs-shut');
    /* remove from the DOM only AFTER the movement — a display/remove switch
       cannot be transitioned, so doing it now would leave nothing to move */
    win._shutT = setTimeout(function () { try { if (done) done(); } catch (e) {} }, SHUT_MS);
  }

  /* ---------- draggable tool windows ---------- */
  /* v0.147.0 — a tool flagged `beta` has known problems: a «تجريبي» chip after the title
     and a note above the tool's own UI (prepended after mount, so no tool code changes) */
  function markBeta(win, body) {
    var chip = h('<span class="syfs-win-beta">تجريبي</span>');
    var title = win.querySelector('.syfs-win-title');
    title.parentNode.insertBefore(chip, title.nextSibling);
    body.insertBefore(h('<div class="syf-note-warn syfs-beta-note" role="note">🧪 نسخة تجريبية — قد تواجه بعض المشاكل في هذه الأداة، ونعمل على إصلاحها.</div>'), body.firstChild);
  }
  function openWindow(tool) {
    if (openWins[tool.id]) { focusWin(openWins[tool.id]); return; }
    var win = h('<div class="syfs-win syfs-shut"><div class="syfs-win-head">'
      + '<span class="syfs-win-ic"></span><span class="syfs-win-title"></span>'
      + '<span class="syfs-win-actions">'
      + '<button class="syfs-win-x" title="إغلاق">' + WI.close + '</button>'
      + '<button class="syfs-win-star' + (isFav(tool.id) ? ' on' : '') + '" data-id="' + tool.id + '" title="إضافة للمفضلة">' + WI.star + '</button>'
      + '<button class="syfs-win-ctrl syfs-win-help" title="شرح الأداة — دليل الاستخدام">' + WI.help + '</button>'
      + '<button class="syfs-win-ctrl syfs-win-shot" title="تصوير الأداة ونسخ الصورة">' + WI.camera + '</button>'
      + '<button class="syfs-win-ctrl syfs-win-max" title="تكبير لكامل الصفحة">' + WI.max + '</button>'
      + '<button class="syfs-win-ctrl syfs-win-min" title="تصغير للأسفل">' + WI.min + '</button>'
      + '</span></div><div class="syfs-win-body"></div><div class="syfs-win-grip" title="تغيير الحجم"></div></div>');
    /* the name goes in as TEXT, never as markup */
    win.querySelector('.syfs-win-title').textContent = SYFS.t(tool.name);
    /* the tool's own glyph, the same one on its bar button — three open windows
       are otherwise three copies of the same 13px of truncatable text */
    if (tool.icon) win.querySelector('.syfs-win-ic').innerHTML = tool.icon;
    root.querySelector('.syfs-wrap').appendChild(win);
    openWins[tool.id] = win;
    markActive();

    var body = win.querySelector('.syfs-win-body');
    try { tool.mount(body); } catch (e) { body.textContent = SYFS.t('خطأ في تحميل الأداة'); }
    if (tool.beta) markBeta(win, body);
    indexRows(body);

    win.querySelector('.syfs-win-star').addEventListener('click', function (e) { e.stopPropagation(); toggleFav(tool.id); });
    win.querySelector('.syfs-win-help').addEventListener('click', function (e) { e.stopPropagation(); SYFS.openToolGuide(tool.id); });
    var shotBtn = win.querySelector('.syfs-win-shot');
    shotBtn.addEventListener('click', function (e) { e.stopPropagation(); SYFS.shotWinClick(win, shotBtn); });
    win.querySelector('.syfs-win-x').addEventListener('click', function () {
      /* free the id immediately so re-opening during the close animation builds a
         fresh window instead of focusing the dying one */
      delete openWins[tool.id];
      markActive();
      hideWin(win, function () { win.remove(); });
    });
    var maxBtn = win.querySelector('.syfs-win-max');
    function setIcon(b, k) { b.innerHTML = WI[k] || ''; }
    win.querySelector('.syfs-win-min').addEventListener('click', function (e) {
      e.stopPropagation(); win.classList.remove('syfs-max'); setIcon(maxBtn, 'max'); win.classList.toggle('syfs-min');
    });
    maxBtn.addEventListener('click', function (e) {
      e.stopPropagation(); win.classList.remove('syfs-min'); var m = win.classList.toggle('syfs-max'); setIcon(maxBtn, m ? 'rest' : 'max');
      maxBtn.title = m ? SYFS.t('استعادة الحجم') : SYFS.t('تكبير لكامل الصفحة');
      if (m) { body.style.height = ''; body.style.maxHeight = ''; }   /* let the maximize CSS fill; drop any resized inline size */
      focusWin(win);
    });
    /* double-click a minimized (docked-at-bottom) window to bring it back up */
    win.querySelector('.syfs-win-head').addEventListener('dblclick', function (e) {
      if (e.target.closest('button')) return;
      if (win.classList.contains('syfs-min')) { win.classList.remove('syfs-min'); focusWin(win); }
    });
    win.addEventListener('mousedown', function () { focusWin(win); });
    focusWin(win);

    /* SIZE is restored, POSITION is always the centre (v0.87.0). It used to open
       where it was last dragged, and failing that in a cascade inward from the right
       edge — which on a narrow screen put it under the rail, and on a wide one in the
       corner nobody is looking at. A window that has just appeared is looked for in
       the middle of the screen. The two halves of the saved record are not the same
       kind of thing: a size is chosen deliberately and once, a position is where it
       happened to be parked. (`savePos` still writes x/y; nothing reads them, so
       putting the old behaviour back is one line.)
       The window opens only once it is WHERE it belongs — showing it first and
       moving it after would animate an entrance in the wrong corner and then
       teleport. */
    store.get('win_' + tool.id, null).then(function (p) {
      /* v0.139.0 — a first open of a tool that cannot fit 320px. The list is the
         one app.js uses (SYFS.WIDE_TOOLS); without it «محرر الصور» opened with its
         own toolbar clipped away by .syfs-win's overflow:hidden. Capped to the
         viewport so a narrow screen never gets a window it cannot reach. */
      if (!(p && typeof p === 'object' && p.w) && SYFS.WIDE_TOOLS && SYFS.WIDE_TOOLS[tool.id]) {
        win.style.width = Math.min(560, Math.max(320, window.innerWidth - 16)) + 'px';
      }
      if (p && typeof p === 'object') {
        /* the floor comes from src/winsize.js, not from a literal repeated here: a
           window whose tool has since grown a side tab rail needs more than 260px,
           and its saved size predates the rail (v0.137.0). */
        var mw = SYFS.winsize ? SYFS.winsize.minW(win, 260) : 260;
        if (p.w) win.style.width = Math.min(Math.max(mw, p.w), window.innerWidth - 16) + 'px';
        if (p.h) { body.style.maxHeight = 'none'; body.style.height = Math.min(Math.max(120, p.h), window.innerHeight - 70) + 'px'; }
      }
      centreWin(win);
      showWin(win);
    });
    makeDraggable(win, tool.id);
    addResize(win, tool.id);
  }

  function focusWin(win) { win.style.zIndex = ++zTop; }
  function place(win, x, y) {
    x = Math.min(Math.max(0, x), window.innerWidth - 80);
    y = Math.min(Math.max(0, y), window.innerHeight - 40);
    win.style.left = x + 'px'; win.style.top = y + 'px';
  }
  /* Centred — with a small diagonal step for each window already open, because two
     windows sharing one pixel-perfect position look like ONE window, and whoever
     just opened the second would think nothing happened. The step wraps every 5 so
     a long session cannot walk a window off the screen; `place` clamps it anyway.
     Measured, not assumed: the size was set a line earlier and a `syfs-shut` window
     still reports its layout box (the entrance is a transform, which layout ignores).
     Sat slightly above the true centre — optical centre reads as centre, and it
     leaves the head clear of a page's own sticky bottom bars. */
  function centreWin(win) {
    var w = win.offsetWidth || 340, hgt = win.offsetHeight || 260;
    var n = Object.keys(openWins).length - 1; if (n < 0) n = 0;
    var step = (n % 5) * 26;
    place(win, Math.round((window.innerWidth - w) / 2) + step,
               Math.max(12, Math.round((window.innerHeight - hgt) / 2) - 24) + step);
  }
  /* ⚠️ المستمعان يُركَّبان داخل `mousedown` ويُنزَعان في `mouseup` — نفس ما يفعله
     `addResize` أسفله بالضبط. حتى v0.103.0 كانا يُسجَّلان على `document` عند إنشاء **كل
     نافذة** ولا يُنزَعان أبداً، ومغلَّفاهما يمسكان النافذة ⇒ قائمة المستمعين وشجر النوافذ
     المُزالة تكبر بلا حدّ طوال عمر الصفحة (والصفحة قد تعمّر يوماً كاملاً). */
  function makeDraggable(win, id) {
    var head = win.querySelector('.syfs-win-head');
    head.addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) return;                 /* let head buttons (x/star/reload/open) work */
      var ox = e.clientX - win.offsetLeft, oy = e.clientY - win.offsetTop;
      e.preventDefault();
      function mv(ev) { place(win, ev.clientX - ox, ev.clientY - oy); }
      function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); savePos(id, win); }
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
  }
  /* persist a window's position + size (skip while maximized / minimized) */
  function savePos(id, win) {
    if (!id || win.classList.contains('syfs-max') || win.classList.contains('syfs-min')) return;
    var body = win.querySelector('.syfs-win-body');
    store.set('win_' + id, { x: win.offsetLeft, y: win.offsetTop, w: win.offsetWidth, h: body ? body.offsetHeight : 0 });
  }
  /* Resize lives in src/winsize.js (v0.132.0) — one engine for the rail's tool
     windows, the rail's frame windows and both of app mode's. The fourteen lines
     that used to sit here were one of four copies, and carried four bugs: a clamp
     that ignored where the window WAS (so a window near the right edge could be
     grown until its own grip was off-screen and could never be shrunk again), a
     `mousemove` on `document` that stops following the pointer over an iframe, no
     touch/keyboard support at all, and nothing re-clamping when the browser window
     shrank. Double-clicking the grip now fits the window to its content, and
     double-clicking it again puts the old size back. */
  function addResize(win, id) {
    if (!SYFS.winsize) return;
    SYFS.winsize.attach(win, {
      minW: 260, minH: 120,
      onChange: function () { savePos(id, win); }
    });
  }

  /* ---------- show / hide (toolbar icon) ---------- */
  /* an OFF rail was never built (v0.139.5): switching it on builds it.
     v0.177 — `enabled` is a stored switch, so hiding here hides it in every open tab too
     (the storage listener in railWatchOn) instead of only on pages opened later. `pageOnly`
     is the hint's «this page only»: the stored switch goes back ON and this page stays
     hidden — the storage event that write fires here is ignored while it is set. */
  var pageOnly = false;
  function setEnabled(on) {
    pageOnly = false;
    store.set('enabled', on);
    if (!host) { if (on) init(true); return; }
    showRail(on, true);
  }
  /* `mine`: this tab asked (the hint offers its choices); another tab's write only follows */
  function showRail(on, mine) {
    var was = host.style.display !== 'none';
    host.style.display = on ? '' : 'none';
    if (on) { railHintClose(); return; }
    if (!was) return;
    var live = settleLive();
    if (mine || live) railHint(live, mine);
  }
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === 'SYFS_TOGGLE') setEnabled(!host || host.style.display === 'none');
  });
  /* What keeps running behind a hidden bar (v0.177). A live camera/microphone stream in a
     tool window (the QR reader) is stopped and its window closed: a camera on with no stop
     button anywhere on screen is the one thing hiding must never leave behind. Work that
     marks itself `data-syfs-live` inside its window (a screen recording, a page watch) is
     deliberate background work — hiding the bar to record without it is a real use — so it
     keeps running and is COUNTED, and the hint stays up as its indicator. */
  function settleLive() {
    var kept = 0;
    Object.keys(openWins).forEach(function (id) {
      var w = openWins[id], cam = false;
      if (!w || !w.querySelectorAll) return;
      w.querySelectorAll('video,audio').forEach(function (m) {
        var s = m.srcObject;
        if (!s || typeof s.getTracks !== 'function') return;
        s.getTracks().forEach(function (tr) { if (tr.readyState === 'live') { cam = true; tr.stop(); } });
      });
      if (cam) { var x = w.querySelector('.syfs-win-x'); if (x) x.click(); return; }
      if (w.querySelector('[data-syfs-live]')) kept++;
    });
    return kept;
  }
  /* The hint lives OUTSIDE #syfs-host — the host is exactly what was just hidden. Its own
     small open shadow root carries its own tokens; it holds no data, only our labels. */
  var railHintEl = null, railHintT = 0;
  var RAIL_HINT_CSS =
    ':host{--syfs-hint-bg:#1f2a27;--syfs-hint-ink:#fff;--syfs-hint-mut:#c9d6d1;--syfs-hint-pri:#457364;--syfs-hint-on-pri:#fff;--syfs-hint-line:rgba(255,255,255,.22);--syfs-hint-shadow:rgba(0,0,0,.28)}' +
    '@media (prefers-color-scheme:dark){:host{--syfs-hint-bg:#e7ece9;--syfs-hint-ink:#14100c;--syfs-hint-mut:#33403a;--syfs-hint-line:rgba(0,0,0,.18)}}' +
    '.box{pointer-events:auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;max-width:min(92vw,560px);padding:10px 14px;border-radius:14px;' +
    'background:var(--syfs-hint-bg);color:var(--syfs-hint-ink);box-shadow:0 8px 24px var(--syfs-hint-shadow);font:13px/1.5 var(--syfs-font,system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif)}' +
    '.txt{display:flex;flex-direction:column;flex:1 1 200px}.sub{color:var(--syfs-hint-mut)}' +
    'button{font:inherit;cursor:pointer;border-radius:9px;padding:5px 11px;border:1px solid var(--syfs-hint-line);background:transparent;color:inherit}' +
    'button.pri{background:var(--syfs-hint-pri);border-color:var(--syfs-hint-pri);color:var(--syfs-hint-on-pri)}' +
    'button:focus-visible{outline:2px solid var(--syfs-hint-pri);outline-offset:2px}';
  function railHintClose() {
    if (railHintT) { clearTimeout(railHintT); railHintT = 0; }
    if (railHintEl) { railHintEl.remove(); railHintEl = null; }
  }
  function railHint(live, mine) {
    railHintClose();
    var combo = hkOf('railtoggle');
    var hostEl = document.createElement('div');
    hostEl.id = 'syfs-railhint';
    hostEl.style.cssText = 'all:initial;position:fixed;left:0;right:0;bottom:18px;z-index:2147483646;display:flex;justify-content:center;pointer-events:none;';
    var sr = hostEl.attachShadow({ mode: 'open' });
    var st = document.createElement('style'); st.textContent = RAIL_HINT_CSS; sr.appendChild(st);
    var box = document.createElement('div'); box.className = 'box';
    box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    box.dir = SYFS.i18n ? SYFS.i18n.dir() : 'rtl';
    var txt = document.createElement('div'); txt.className = 'txt';
    var b = document.createElement('b');
    b.textContent = live ? SYFS.t('الشريط مخفي — {0} أداة ما زالت تعمل', String(live)) : SYFS.t('أُخفي الشريط');
    var sub = document.createElement('span'); sub.className = 'sub';
    sub.textContent = combo ? SYFS.t('اضغط {0} لإظهاره', comboLabel(combo)) : SYFS.t('أظهره من أيقونة الإضافة في شريط المتصفّح');
    txt.appendChild(b); txt.appendChild(sub); box.appendChild(txt);
    function btn(label, cls, fn) {
      var x = document.createElement('button'); x.type = 'button'; x.textContent = label;
      if (cls) x.className = cls;
      x.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
      box.appendChild(x);
    }
    btn(SYFS.t('إظهار'), 'pri', function () { setEnabled(true); });
    if (mine) btn(SYFS.t('إخفاء في هذه الصفحة فقط'), '', function () {
      pageOnly = true;
      store.set('enabled', true);              /* every other tab — and every new page — keeps its bar */
      sub.textContent = SYFS.t('مخفي في هذه الصفحة فقط');
      box.querySelectorAll('button').forEach(function (x) { if (!x.classList.contains('pri')) x.remove(); });
      if (!live) railHintT = setTimeout(railHintClose, 2500);
    });
    sr.appendChild(box);
    (document.body || document.documentElement).appendChild(hostEl);
    railHintEl = hostEl;
    /* with work still running it stays — it IS the indicator; otherwise it steps aside */
    if (!live) railHintT = setTimeout(railHintClose, 6000);
  }

  /* ===== two one-keystroke actions on the rail itself (shipped defaults, see hkOf) ====
     Registered as tools so the keyboard tab can rebind or remove them like any other.
     `noRail` because the bar cannot hold a button that hides the bar, and the
     hotkey listener keeps running while the host is hidden — that is what makes
     Ctrl+Alt+H a toggle and not a trap (§5.15: nothing here hides the control that
     undoes it). Alt+letter, not Ctrl+Shift+…: those belong to Chrome. */
  /* v0.177 — Ctrl+Alt+Q also reaches what lives OUTSIDE the tool windows: the reading-mode
     overlay and the page watcher's element picker sit on the page itself, and a «closed
     everything» toast over a still-open reader was a lie. Each owner registers its own
     teardown (returns true when it closed something) — never a copy of it here. Push-only,
     like SYFS.tools (§5.12/7). The tool ids closed last are kept for «reopen». */
  var closeAllHooks = [], lastClosed = [];
  SYFS.onCloseAll = function (fn) { if (typeof fn === 'function') closeAllHooks.push(fn); };
  function closeAllWindows() {
    var n = 0, ids = [];
    Object.keys(openWins).forEach(function (id) {
      var w = openWins[id], x = w && w.querySelector('.syfs-win-x');
      if (x) { x.click(); n++; if (id.indexOf('__') !== 0) ids.push(id); }   /* each window's own teardown */
    });
    closeAllHooks.forEach(function (fn) { try { if (fn()) n++; } catch (e) {} });
    closeShelf(); chordClose();
    lastClosed = ids;
    return n;
  }
  function reopenClosed() {
    var ids = lastClosed; lastClosed = [];
    ensureTools(function () { ids.forEach(function (id) { var t = toolById(id); if (t) runTool(t); }); });
  }
  /* settings reset keeps every credential SECRET_KEYS names (src/storage.js) */
  function resetKeys(all) {
    var keep = SYFS.prefs.SECRET_KEYS;
    return Object.keys(all || {}).filter(function (k) { return !keep.test(k); });
  }
  tools.push({
    id: 'railtoggle',
    name: 'إخفاء/إظهار الشريط العائم',
    cat: 'util',
    noRail: true,
    hotkey: 'Ctrl+Alt+KeyH',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/></svg>',
    action: function () { setEnabled(!host || host.style.display === 'none'); }
  });
  tools.push({
    id: 'closeall',
    name: 'إغلاق كل الأدوات المفتوحة',
    cat: 'util',
    noRail: true,
    hotkey: 'Ctrl+Alt+KeyQ',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
    action: function () {
      var n = closeAllWindows();
      if (!SYFS.toast) return;
      /* «0 نافذة» said nothing; with nothing open the key still answers, briefly */
      if (!n) { SYFS.toast(SYFS.t('لا أدوات مفتوحة'), '', { timeout: 1500 }); return; }
      SYFS.toast(SYFS.t('أُغلقت الأدوات المفتوحة'), SYFS.t('{0} نافذة', n), lastClosed.length
        ? { timeout: 6000, actions: [{ label: '↺ إعادة فتح ما أُغلق', onClick: reopenClosed }] }
        : { timeout: 2000 });
    }
  });

  /* the «إخفاء عند الحافة» switch from the settings, on a key (v0.179.0) — the same
     `dock_peek` flag, so the checkbox and every open tab follow (dockfx onChanged) */
  tools.push({
    id: 'edgepeek',
    name: 'إخفاء الشريط عند الحافة',
    cat: 'util',
    noRail: true,
    hotkey: 'Ctrl+Alt+KeyE',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M10 12h-4M8 10l-2 2 2 2"/></svg>',
    action: function () {
      store.get('dock_peek', false).then(function (v) {
        var on = !v;
        SYFS.dockfx.save({ dock_peek: on });
        if (SYFS.toast) SYFS.toast(SYFS.t(on ? 'إخفاء عند الحافة: مفعّل' : 'إخفاء عند الحافة: متوقّف'), '', { timeout: 1800 });
      });
    }
  });

  /* ---------- init ---------- */
  /* helpers exposed to tools that mount their own floating UI (e.g. sticky notes) */
  SYFS.mountEl = function (el) { if (root) root.querySelector('.syfs-wrap').appendChild(el); };
  SYFS.topZ = function () { return ++zTop; };
  /* open another tool programmatically (e.g. fullshot → «فتح في المحرر») */
  SYFS.openToolById = function (id) { ensureTools(function () { runTool(toolById(id)); }); };
  /* load the lazy bodies, then call back — the eager capture bar (src/capbar.js) needs
     media.js / studio.js for a job that is not "open a tool" */
  SYFS.ensureTools = function (cb) { ensureTools(cb); };

  /* Ask the worker to strip X-Frame-Options / CSP so third-party sites can be
   * framed — but ONLY for the host(s) the user is actually viewing, on THIS tab
   * (session rule). Ref-counted per host: the host page's own unrelated
   * sub-frames (login, payment, ads) keep their framing/CSP protection intact. */
  var frameHostCounts = {};
  function frameHostOf(u) { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; } }
  /* `cb` runs once the worker has answered (or failed) — the caller that is about to
     START a frame navigation waits on it, see openFrame. */
  function frameApply(cb) {
    var domains = Object.keys(frameHostCounts).filter(function (d) { return frameHostCounts[d] > 0; });
    var done = false;
    function fin() { if (done) return; done = true; if (cb) { try { cb(); } catch (e) {} } }
    try {
      chrome.runtime.sendMessage({ type: 'SYFS_FRAME', op: domains.length ? 'set' : 'off', domains: domains }, function () { void chrome.runtime.lastError; fin(); });
    } catch (e) { fin(); }
    /* a worker that never answers must not leave the viewer blank forever */
    if (cb) setTimeout(fin, 1500);
  }
  /* open a URL in a real browser window snapped to the screen edge, and shrink this
   * window into the rest (v0.135.0). For sites an iframe cannot host: the framed copy is
   * a THIRD-PARTY context — its storage and service worker are partitioned away from the
   * ordinary tab — while this is a first-class top-level origin, so a logged-in session
   * (WhatsApp Web, and anything else that keeps one) behaves exactly as in a tab.
   * Screen metrics travel from here; the worker owns the window itself. */
  SYFS.openSide = function (url, opts) {
    url = safeUrl(url); if (!url) return false;
    opts = opts || {};
    try {
      chrome.runtime.sendMessage({
        type: 'SYFS_SIDE', url: url, side: opts.side, w: opts.w, shrink: opts.shrink !== false,
        metrics: { left: screen.availLeft || 0, top: screen.availTop || 0,
                   width: screen.availWidth, height: screen.availHeight }
      }, function () { void chrome.runtime.lastError; });
      return true;
    } catch (e) { return false; }
  };

  /* open a site in CHROME'S OWN side panel (v0.136.0) — same window, and the page shrinks
   * beside it. This is the split the user asked for; a separate window, however tightly it
   * hugs the screen edge, is still a second window.
   * `chrome.sidePanel.open()` wants a user gesture, and a gesture does not always survive
   * the hop through a message. So the failure is handled rather than hidden: on
   * `needs-gesture` (or an old Chrome with no side panel) it falls back to the docked
   * window, which always works. Call it from a real click, never from a timer. */
  SYFS.openPanel = function (url, opts) {
    url = safeUrl(url); if (!url) return false;
    opts = opts || {};
    try {
      chrome.runtime.sendMessage({ type: 'SYFS_PANEL', op: 'open', url: url }, function (r) {
        void chrome.runtime.lastError;
        if (r && r.ok) return;
        if (opts.fallback === false) return;
        SYFS.openSide(url, opts);
      });
      return true;
    } catch (e) { return opts.fallback === false ? false : SYFS.openSide(url, opts); }
  };

  /* open any URL inside a draggable, resizable in-page window (iframe).
   * Many can coexist. The iframe is sandboxed (no allow-top-navigation) so a
   * framed site can never hijack the host tab. Some sites still refuse to be
   * framed (their own JS) — the ⤢ button opens them in a separate window. */
  SYFS.openFrame = function (title, url, opts) {
    url = safeUrl(url); if (!url || !root) return null;
    opts = opts || {};
    var fHost = frameHostOf(url);
    var vw = window.innerWidth, vh = window.innerHeight;
    var w = Math.min(Math.max(opts.w || 520, 300), Math.max(320, vw - 36));
    var hgt = Math.min(Math.max(opts.h || 660, 260), Math.max(300, vh - 40));
    var id = '__frame' + (++frameSeq), seq = frameSeq;
    var win = h('<div class="syfs-win syfs-frame-win"></div>');
    win.style.width = w + 'px';
    var head = h('<div class="syfs-win-head">'
      + '<span class="syfs-win-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3.5 9h17M3.5 15h17"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/></svg></span>'
      + '<span class="syfs-win-title"></span><span class="syfs-fr-actions">'
      + '<button class="syfs-fr-btn syfs-fr-reload" title="تحديث">' + WI.reload + '</button>'
      + '<button class="syfs-fr-btn syfs-fr-open" title="فتح في نافذة منفصلة">' + WI.popout + '</button>'
      + '<button class="syfs-win-x" title="إغلاق">' + WI.close + '</button></span></div>');
    head.querySelector('.syfs-win-title').textContent = title || SYFS.t('عارض');
    var frbody = h('<div class="syfs-win-body syfs-frame-body"></div>');
    frbody.style.height = hgt + 'px';
    var frame = document.createElement('iframe');
    frame.className = 'syfs-frame';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('allow', 'clipboard-write; fullscreen');
    /* ⚠️ `frame.src` is NOT set here (مراجعة 2026-09-19). It used to be, and the node was appended
       a few lines down — which STARTS the navigation — while the worker was only asked
       to strip X-Frame-Options / CSP for this host afterwards (`frameApply`). On a fast
       or cached response the headers arrived before the session rule existed, the
       browser refused the frame, and the viewer showed the «blocked» card; the ↻ button
       then worked, because by then the rule was in place. «Works the second time» is
       the signature of that race. The navigation now waits for the worker's answer. */
    var hint = h('<div class="syfs-frame-hint">لو ظهرت فارغة، الموقع يمنع العرض المضمّن — اضغط ⤢ لفتحه في نافذة منفصلة.</div>');
    /* ⚠️ v0.113.0 — a WATCHDOG, not a detector, and the difference is worth writing down.
     * A cross-origin frame that Chrome refuses to render still fires `load` (on its own
     * error page), and every property that would tell the two apart — contentDocument,
     * location.href — throws identically for a frame that loaded PERFECTLY. There is no
     * in-page test that separates «blocked» from «fine»; claiming one would be a check
     * that reports success for both. What IS observable is a frame that never loads at
     * all, so that is exactly what this measures, and the card says so in those words.
     * The bottom hint stays for the blocked-but-loaded case it was written for. */
    var stall = h('<div class="syfs-frame-stall" style="position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:20px;text-align:center;background:var(--bg);"></div>');
    var stallTxt = document.createElement('div');
    stallTxt.className = 'syf-note-hint';
    stallTxt.textContent = SYFS.t('لم تُحمّل الصفحة داخل الإطار. بعض المواقع ترفض العرض المضمّن، وبعضها بطيء فحسب.');
    var stallRow = h('<div class="syf-row" style="justify-content:center"></div>');
    var stallOpen = h('<button class="syf-btn">⤢ افتحه في نافذة منفصلة</button>');
    var stallRetry = h('<button class="syf-mini">↻ أعد المحاولة</button>');
    stallRow.appendChild(stallOpen); stallRow.appendChild(stallRetry);
    stall.appendChild(stallTxt); stall.appendChild(stallRow);
    var stallT = null;
    function armStall() {
      if (stallT) clearTimeout(stallT);
      stall.style.display = 'none';
      stallT = setTimeout(function () { if (win.isConnected) stall.style.display = 'flex'; }, 8000);
    }
    frame.addEventListener('load', function () { if (stallT) { clearTimeout(stallT); stallT = null; } stall.style.display = 'none'; });
    frbody.style.position = 'relative';
    frbody.appendChild(frame); frbody.appendChild(stall); frbody.appendChild(hint);
    var grip = h('<div class="syfs-frame-grip" title="تغيير الحجم"></div>');
    win.appendChild(head); win.appendChild(frbody); win.appendChild(grip);
    root.querySelector('.syfs-wrap').appendChild(win);

    frameOpen++;
    function navigate() { if (!win.__closed) { armStall(); frame.src = url; } }
    if (fHost) { frameHostCounts[fHost] = (frameHostCounts[fHost] || 0) + 1; frameApply(navigate); }
    else navigate();
    function close() {
      if (win.__closed) return; win.__closed = true; win.remove();
      /* the watchdog outlives the node it paints into unless it is cleared here */
      if (stallT) { clearTimeout(stallT); stallT = null; }
      frameOpen = Math.max(0, frameOpen - 1);
      if (fHost && frameHostCounts[fHost]) { if (--frameHostCounts[fHost] <= 0) delete frameHostCounts[fHost]; frameApply(); }
    }

    function popOut() {
      try { chrome.runtime.sendMessage({ type: 'SYFS_POPUP', url: url, w: Math.round(w), h: Math.round(hgt) }, function () { void chrome.runtime.lastError; }); } catch (er) {}
    }
    head.querySelector('.syfs-fr-reload').addEventListener('click', function (e) { e.stopPropagation(); armStall(); frame.src = url; });
    head.querySelector('.syfs-fr-open').addEventListener('click', function (e) { e.stopPropagation(); popOut(); });
    stallOpen.addEventListener('click', function (e) { e.stopPropagation(); popOut(); });
    stallRetry.addEventListener('click', function (e) { e.stopPropagation(); armStall(); frame.src = url; });
    head.querySelector('.syfs-win-x').addEventListener('click', function (e) { e.stopPropagation(); close(); });
    win.addEventListener('mousedown', function () { focusWin(win); });
    focusWin(win);
    place(win, Math.max(12, (vw - w) / 2 - (seq % 5) * 24), Math.max(12, 66 + (seq % 5) * 24));
    makeDraggable(win, null);

    /* `canFit: false` — the body is a cross-origin iframe. There is nothing here
       we are permitted to measure, and a «fit to content» that silently fitted to
       the iframe's own 100%-height box would be a lie dressed as a feature. The
       drag fixes (pointer capture over the frame, edge-aware clamp, touch,
       keyboard) all apply, and they matter MOST here: this is the one window
       whose content eats the pointer mid-drag. */
    if (SYFS.winsize) SYFS.winsize.attach(win, { grip: grip, body: frbody, minW: 300, minH: 220, canFit: false });
    return win;
  };

  /* ===== a rail switched OFF is not BUILT (v0.139.5) =====
   * Until v0.139.4 the whole bar — host, shadow root, rail.css fetch, every button, the
   * clock timer, the sticky notes — was built on every page and then hidden with
   * `display:none` when `enabled` was false. Now `enabled` joins the first read (one
   * storage call with the rest, src/storage.js batches them) and an OFF rail builds
   * nothing. It is built the moment it is switched on: the toolbar button
   * (SYFS_TOGGLE), the settings page, or another tab writing `enabled: true`.
   * ⛔ Nothing may assume `host`/`root` exist before `railBuilt` — setEnabled() and the
   *    toggle listener check it. */
  var railBuilt = false, railWatch = false;
  function railWatchOn() {
    if (railWatch) return; railWatch = true;
    try {
      chrome.storage.onChanged.addListener(function (ch, area) {
        if (area !== 'local' || !ch || !ch.enabled) return;
        if (ch.enabled.newValue !== false && !railBuilt) init(true);
        else if (host && !pageOnly) showRail(ch.enabled.newValue !== false, false);   /* another tab's Ctrl+Alt+H (v0.177) */
      });
    } catch (e) {}
  }
  function init(force) {
    if (!tools.length || railBuilt) return;
    /* The language joins the wait that was already happening — it costs no extra wall
       clock, and buildRail must not run before it: tool names would paint in Arabic
       and repaint a frame later. The dictionary is fetched only when it is needed
       (apply() short-circuits on 'ar'), so the default language downloads nothing. */
    /* ⚠️ v0.112.0 — eleven of the twelve canned quick links start HIDDEN. They open a
       URL in a tab, which is what a bookmark does, and fifteen cells made 🔗 the longest
       shelf on the bar — longer than any shelf of actual tools. They are hidden, NOT
       deleted: the manager's 🔗 section still lists every one and a checkbox brings it
       back, and because a STORED `hidden_tools` wins over this default, nobody who has
       already touched the list sees any change at all. Only a fresh install does.
       `lnk-google` survives because it is the one that is not a destination — it is a
       search box you reach without a new tab. */
    var LINKS_HIDDEN_DEFAULT = ['lnk-gmail', 'lnk-outlook', 'lnk-teams', 'lnk-facebook', 'lnk-youtube',
                                'lnk-drive', 'lnk-calendar', 'lnk-telegram', 'lnk-linkedin', 'lnk-x'];
    Promise.all([store.get('hidden_tools', LINKS_HIDDEN_DEFAULT), store.get('custom_links', []), store.get('hidden_cats', ['ai', 'dev']), store.get('cat_order', []), store.get('tool_order', {}), store.get('dock_folded', false),
                 store.get(SYFS.i18n.KEY, SYFS.i18n.DEFAULT).then(function (l) { return SYFS.i18n.apply(l); }),
                 /* the clock joins the wait rather than landing after it: it is part of
                    the bar's first paint, and a chip that appears a frame late reads as
                    a glitch on a bar that is otherwise built in one go */
                 store.get('rail_clock', true), store.get('rail_clock_24', false),
                 store.get('rail_clock_style', 'bold'), store.get('rail_clock_show', 'both'),
                 store.get('rail_clock_date', 'dm'),
                 /* the Hijri chip needs the occasions tool's calibration BEFORE its
                    first paint — landing after it would print one day and correct
                    itself a frame later, which reads as the date being unreliable */
                 store.get('occasions', null),
                 /* r[13] — last, so no index above moves. `force`: switched on just now */
                 force ? true : store.get('enabled', true)]).then(function (r) {
      /* ⚠️ these indices track the array above ONE FOR ONE. `peek` used to sit at
         r[4]; removing it shifted everything after it, which is exactly the kind of
         edit that silently feeds the clock a date format. Count before you change. */
      /* ⚠️ v0.140.10 — an OFF rail still listens for its own toggle. v0.139.5 stopped
         building the host for an OFF rail and, with it, stopped installing the key
         listener: after one Ctrl+Alt+H every later page had no Ctrl+Alt+H to bring the bar back
         and no Ctrl+Alt+K — only the toolbar icon, which nothing on screen points to.
         While unbuilt the listener answers the railtoggle combo and nothing else. */
      if (r[13] === false) {
        railWatchOn();
        store.get('hotkeys', {}).then(function (v) { hotkeys = (v && typeof v === 'object') ? v : {}; installHotkeys(); });
        return;
      }
      if (railBuilt) return;                    /* the toggle and a storage event both asked */
      railBuilt = true;
      railWatchOn();                            /* a built bar follows the other tabs' show/hide too */
      var wrap = buildHost();
      wrap.dataset.pos = 'right';
      if (SYFS.sel2) SYFS.sel2.attach(root);     /* «سلكت ٢» dresses every tool's <select> */
      /* a click anywhere else closes the shelf — it is a panel over someone else's
         page, and it must never be something the user has to dismiss deliberately */
      document.addEventListener('click', function () { closeShelf(); });
      /* the shelf is measured against the viewport, so a resize invalidates it */
      window.addEventListener('resize', function () { if (openCatEl) placeShelf(openCatEl); fitSoon(); });
      clockOn = r[7] !== false;
      clock24 = !!r[8];
      /* ⛔ whitelisted, never trusted: these strings become a CSS selector and a
         formatter branch, and storage is shared with export/import (§4.1) */
      clockStyle = clkPick(CLK_STYLES, r[9], 'bold');
      clockShow = clkPick(CLK_SHOWS, r[10], 'both');
      clockDate = clkPick(CLK_DATES, r[11], 'dm');
      clockOffset = (SYFS.occ && SYFS.occ.settings) ? SYFS.occ.settings(r[12]).offset : 0;
      hidden = Array.isArray(r[0]) ? r[0] : [];
      customLinks = Array.isArray(r[1]) ? r[1] : [];
      hiddenCats = Array.isArray(r[2]) ? r[2] : [];
      catOrder = Array.isArray(r[3]) ? r[3] : [];
      /* ⚠️ الخريطة كانت تُفحص ككائن فقط، وعضوٌ غير مصفوفة يرمي داخل `toolRank`
         (`o.indexOf is not a function`) **قبل بناء أي زرّ** — قِيس: صفر أزرار على كل صفحة. */
      toolOrder = cleanOrderMap(r[4]);
      railFolded = !!r[5];
      buildRail(wrap);
      /* v0.165.0, once per profile: the image/video tools now live inside «الاستوديو»,
         so their own cells leave the bar. HIDDEN, not removed — the manager still lists
         each one, a checkbox brings it back, its hotkey and favourite keep working. */
      /* v0.166.0: the studio became the image studio (studio.html) — the video tools,
         the screen recorder and the status maker are NOT in it, so `studio_v2` gives
         back the cells v1 took (only where v1 ran), and v1 now hides the image tools
         alone. Two flags, so a profile that already ran v1 is not hidden twice. */
      Promise.all([store.get('studio_v1', false), store.get('studio_v2', false)]).then(function (r) {
        var changed = false;
        if (!r[0]) {
          ['screenshot', 'imgedit', 'imgbatch', 'exif']
            .forEach(function (id) { if (hidden.indexOf(id) < 0) hidden.push(id); });
          store.set('studio_v1', true); changed = true;
        } else if (!r[1]) {
          ['screenrec', 'status', 'frames', 'vtrim', 'vaudio', 'vconv', 'videodl']
            .forEach(function (id) { var i = hidden.indexOf(id); if (i >= 0) hidden.splice(i, 1); });
          changed = true;
        }
        if (!r[1]) store.set('studio_v2', true);
        if (changed) { store.set('hidden_tools', hidden); rebuildRail(); }
      });
      /* the rail is built at the default position and the stored one lands after —
         re-index, or a saved top/bottom would keep the vertical bar's cascade */
      /* قيمة مجهولة هنا لا ترمي بل تُخرِج الشريط من كل قواعد الأوضاع ⇒ شريط بارتفاع صفر
         (قِيس: `pos:"nowhere"` ⇒ 2056×0). قائمة بيضاء كمفاتيح الساعة، لا `|| 'right'`. */
      store.get('pos', 'right').then(function (p) { wrap.dataset.pos = pickOne(POS_VALUES, p, 'right'); markPos(wrap); restagger(); fitRail(); });
      applyTheme(wrap);
      if (SYFS.dockfx) { SYFS.dockfx.load(applyDockPrefs); SYFS.dockfx.onChange(applyDockPrefs); }
      if (SYFS.fontkit) {
        var af = function (v) { SYFS.fontkit.applyTo(wrap, v); }; SYFS.fontkit.get(af); SYFS.fontkit.onChange(af);
        /* the page sheet is a CONTENT-SCRIPT job: this is the only surface where a
           host page exists to restyle (fontkit's own tail binds extension pages) */
        SYFS.fontkit.bindPage();
      }
      /* AFTER the rail is built, not inside the wait above: the card is an extra
         read that nothing renders from, and blocking the first paint on it would
         make every later page pay for a question asked once. */
      store.get(SYFS.i18n.ASK_KEY, false).then(function (v) { if (v) { langAsk = true; askLang(wrap); } });
      /* ⛔ no ensureTools() here (v0.139.2). Both lines used to inject every lazy file on
         EVERY page for anyone with one favourite or one edited shortcut (the `false`
         marker of a removed default counted too) — the lazy design undone for most real
         users. The ★ shelf loads on first open, and runHotkey() loads before running a
         tool it cannot find: favourites and hotkeys are ids, not tool objects. */
      store.get('favorites', []).then(function (v) { favs = Array.isArray(v) ? v : []; renderFav(); });
      store.get('hotkeys', {}).then(function (v) { hotkeys = (v && typeof v === 'object') ? v : {}; installHotkeys(); });
      /* ⚠️ default ON: the whole point was "shortcuts for every tool without setting
         them up". It costs the page exactly one combination (Ctrl+Alt+K) and the switch in
         the keyboard tab gives it back. */
      store.get('hk_defaults', true).then(function (v) { hkDefaults = v !== false; });
      /* inside the build, not before it: a boot hook paints INTO the rail's root
         (the sticky notes do) — an OFF rail has none, and runs none */
      bootTools();
      /* boot hooks from tools that were merged away but still need startup work (e.g. sticky restore) */
      (SYFS.boots || []).forEach(function (fn) { try { fn(); } catch (e) {} });
    });
  }
  /* ⚠️ يُنادى مرّتين: هنا عند الإقلاع، و**بعد الحقن الكسول** — كل أداة مؤجَّلة تصل بعد
     `init()` كانت تفوّت خطّافها إلى الأبد. أثرها المقيس: جامع الأخطاء في «تدقيق الأداء»
     (`window.__syfsErr`) لا يُثبَّت أبداً فقسم الأخطاء فارغ دائماً وهو يبدو «لا أخطاء».
     `_booted` يجعلها مرّة واحدة لكل أداة مهما تكرّر النداء. */
  function bootTools() {
    tools.forEach(function (t) {
      if (!t.boot || t._booted) return;
      t._booted = 1;
      try { t.boot(); } catch (e) {}
    });
  }

  /* ---------- dock appearance: magnify / effect / size / opacity / edge-peek ----------
   * All four settings are shared with the app-mode dock (src/dockfx.js, storage keys
   * dock_effect/size/opacity/peek), so changing them here updates that dock too. */
  var SIZE_BASE = 38;      /* px at 100% — the old «صغير», now the bottom of the slider */
  /* pre-load values only — applyDockPrefs overwrites both from dockfx.DEFAULTS */
  var dockFx = 'lift', dockPeek = false, peekWired = false, dockLabels = 'list';
  /* set by the settings panel; called after every applyDockPrefs so the slider's hint
     reflects the size that was actually APPLIED, not the one that was asked for */
  var dockApplied = null;

  /* ===== fit to the screen (v0.99.0) ==========================================
   * With every category shown, a vertical rail is ~20 boxes deep. On a laptop at the
   * large icon preset that is taller than the viewport, and the ends simply left the
   * screen: the rail is `top:50%; translateY(-50%)`, so it overflows off BOTH edges
   * at once and the first and last categories become unreachable — with no scrollbar
   * and nothing on screen saying anything is missing.
   *
   * So the rail measures itself and shrinks to fit, and grows back as you approach.
   *
   * ⛔ v0.107.0 — THE IDLE SHRINK IS GONE, and must not come back. Until now the rail
   * rested at 85% of the fitting size so that hovering it had somewhere to grow into.
   * That flourish cost the size setting its meaning: the rendered size of a clamped
   * rail is (room ÷ its natural length) — a number that does NOT depend on the size the
   * user picked — and multiplying it by 0.85 pushed it below the largest preset that
   * still fit unclamped. So «متوسط» came out SMALLER than «صغير», and «كبير» and «ضخم»
   * came out identical to each other. The setting was reporting the viewport, not the
   * choice. Resting at the fit exactly makes the rendered size `min(chosen, what fits)`,
   * which is monotonic — bigger input, never smaller output — and the size slider says
   * so out loud when the cap is what you are seeing.
   *
   * FIT_MIN is a floor, not a target: below ~55% a 38px icon is 21px of glyph and the
   * categories stop being distinguishable. A rail that cannot fit even at the floor
   * overflows — that is the honest outcome, and it takes an extreme window to reach. */
  var FIT_MIN = 0.55;
  var fitFull = 1, fitT = 0;

  function fitApply(w, v) { w.style.setProperty('--syfs-fit', String(Math.round(v * 1000) / 1000)); }

  function fitRail() {
    var w = root && root.querySelector('.syfs-wrap'); if (!w) return;
    var rail = w.querySelector('.syfs-rail'); if (!rail) return;
    /* a folded rail is one badge long and would measure as "fits" — the run comes back
       at full length, so the answer would be stale the moment it does. setFolded()
       re-runs this on the way open. */
    if (rail.classList.contains('folded')) return;
    var pos = w.dataset.pos || 'right', vert = pos === 'right' || pos === 'left';
    /* probe at full size with transitions off: the measurement must not be visible */
    rail.classList.add('syfs-noanim');
    fitApply(w, 1);
    var r = rail.getBoundingClientRect();
    var natural = vert ? r.height : r.width;
    var room = (vert ? window.innerHeight : window.innerWidth) - 24;   /* the 12px inset, both ends */
    fitFull = (!natural || natural <= room) ? 1 : Math.max(FIT_MIN, room / natural);
    fitApply(w, fitFull);
    void rail.offsetWidth;                 /* flush, or probe and result coalesce into one animated step */
    rail.classList.remove('syfs-noanim');
    /* the settings slider says «الشاشة لا تتّسع لأكثر من X%» off this number, and it is
       only known after the measurement above — so the panel is told, not polled */
    if (dockApplied) { try { dockApplied(); } catch (e) {} }
  }
  /* what the screen allows, as a fraction of the chosen size (1 = nothing was clamped) */
  function fitCap() { return fitFull; }

  /* resize fires in bursts while a window is dragged; one measurement per settle */
  function fitSoon() { clearTimeout(fitT); fitT = setTimeout(fitRail, 120); }
  function applyDockPrefs(p) {
    var w = root && root.querySelector('.syfs-wrap'); if (!w || !p) return;
    /* the fallbacks come from dockfx's own DEFAULTS, so a changed default is changed
       in ONE place — three copies of the word 'magnify' is three chances to disagree */
    dockFx = p.effect || SYFS.dockfx.DEFAULTS.effect;
    dockPeek = !!p.peek;
    dockLabels = p.labels || SYFS.dockfx.DEFAULTS.labels;
    w.dataset.fx = dockFx;
    w.dataset.labels = dockLabels;
    w.style.setProperty('--syfs-cat-base', Math.round(SIZE_BASE * (p.scale || SYFS.dockfx.DEFAULTS.scale) / 100) + 'px');
    w.style.setProperty('--syfs-dock-op', p.opacity != null ? p.opacity : 1);
    fitRail();                                        /* a bigger preset may no longer fit */
    w.classList.toggle('syfs-edgepeek', dockPeek);
    if (!dockPeek) w.classList.remove('peek-open');   /* don't leave the rail stuck off-screen */
    if (dockLabels === 'list') hideTip();             /* names are on screen now — no tooltip */
    /* the shelf's grid changes shape with the labels mode, so a panel that is
       already open has to be re-measured against the icon it belongs to */
    if (openCatEl) placeShelf(openCatEl);
    wireRailPeek();
  }

  /* ---------- hover tooltip for the icon-only mode ----------------------------
   * A single fixed-position bubble parked on the wrap, NOT a ::after on the button:
   * the flyout is `overflow:hidden` (that clip is what animates it open), so any
   * pseudo-element tooltip would be cut off at the strip edge. Positioning is
   * measured from the button's own rect, so it follows the rail through all four
   * positions and through the magnifier's scaling.
   * Shown only in «icons» mode — in «list» mode the name is already visible. */
  var tipEl = null, tipBtn = null;
  function hideTip() { if (tipEl) { tipEl.classList.remove('on'); tipEl.style.left = '-9999px'; } tipBtn = null; }
  function showTip(btn) {
    var w = root && root.querySelector('.syfs-wrap'); if (!w || dockLabels !== 'icons') return;
    var name = btn.dataset.tip; if (!name) return;
    if (!tipEl) { tipEl = h('<div class="syfs-tip" role="tooltip"></div>'); w.appendChild(tipEl); }
    tipBtn = btn;
    tipEl.textContent = name;                       /* user-supplied for custom links → text only */
    tipEl.classList.add('on');
    /* measure after the text is in, then clamp inside the viewport */
    var r = btn.getBoundingClientRect(), tw = tipEl.offsetWidth, th = tipEl.offsetHeight, pos = w.dataset.pos || 'right', x, y;
    if (pos === 'top' || pos === 'bottom') {
      x = r.left + r.width / 2 - tw / 2;
      y = pos === 'top' ? r.bottom + 9 : r.top - th - 9;
    } else {
      y = r.top + r.height / 2 - th / 2;
      x = pos === 'right' ? r.left - tw - 9 : r.right + 9;
    }
    tipEl.style.left = Math.min(Math.max(6, x), Math.max(6, window.innerWidth - tw - 6)) + 'px';
    tipEl.style.top = Math.min(Math.max(6, y), Math.max(6, window.innerHeight - th - 6)) + 'px';
  }
  /* delegated on the rail: mouseenter doesn't bubble, so mouseover/mouseout are used
   * and re-entry into the same button is ignored (no flicker while the icon scales) */
  function wireTips(rail) {
    rail.addEventListener('mouseover', function (e) {
      var b = e.target && e.target.closest && e.target.closest('.syfs-tool-btn');
      if (b && b !== tipBtn) showTip(b); else if (!b && tipBtn) hideTip();
    });
    rail.addEventListener('mouseout', function (e) {
      var b = e.target && e.target.closest && e.target.closest('.syfs-tool-btn');
      if (b && b === tipBtn && !b.contains(e.relatedTarget)) hideTip();
    });
    rail.addEventListener('mouseleave', hideTip);
    rail.addEventListener('click', hideTip);        /* the flyout closes — the bubble must go with it */
  }
  /* ===== لوحة نشاط التصنيف — the category activity panel (v0.86.0) =============
   * Hovering ANY category shows, as small blocks, the tools inside it that are
   * running now or that were opened this session. It is a shortcut past the shelf
   * for the thing you were just doing: a category holds up to thirteen tools, and
   * the two you actually touched today are somewhere among them.
   *
   * Two zones, because they answer different questions:
   *   يعمل الآن   — a window open in THIS tab (it may be minimised or buried)
   *   هذه الجلسة — opened since the browser started, in ANY tab (from the worker)
   * A block does the right thing either way: it raises the open window if there is
   * one, and opens the tool if there is not, so you aim at the name, not the state.
   *
   * It never appears over a category with nothing in either zone. A panel that
   * says "nothing here" on thirteen icons is a panel you spend the day dodging —
   * and that silence is also the signal: if it opened, something is there.
   *
   * Zero background polling: one message per hover, nothing while idle, and the
   * panel is dropped the moment the pointer leaves. On إسلامية while a recitation
   * is live it stands down and lets SYFS.qmini take the hover — two panels off one
   * icon is noise, and a transport beats a list when the act is "pause this". Both
   * read that decision from the SAME worker reply, so there is no race between them
   * and no third state where both or neither shows. */
  var actEl = null, actBtn = null, actPend = null, actNone = null, actIn = false, actHideT = 0, actOpenT = 0;
  function actBuild(wrap) {
    actEl = h('<div class="syfs-cmini" role="group"><div class="syfs-cm-head"><span class="syfs-cm-title"></span></div>'
      + '<div class="syfs-cm-body"></div></div>');
    wrap.appendChild(actEl);
    /* the panel is part of the hover target: leaving the button INTO the panel must
       not close the thing you were reaching for */
    actEl.addEventListener('mouseenter', function () { actIn = true; clearTimeout(actHideT); });
    actEl.addEventListener('mouseleave', function () { actIn = false; actSchedHide(); });
  }
  function actHide() {
    clearTimeout(actHideT); clearTimeout(actOpenT);
    actIn = false; actBtn = null; actPend = null; actNone = null;
    if (actEl) { actEl.classList.remove('on'); actEl.style.left = '-9999px'; }
  }
  function actSchedHide() {
    clearTimeout(actHideT);
    /* a grace period, because the gap between the button and the panel is real
       pixels and crossing it fires mouseout */
    actHideT = setTimeout(function () { if (!actIn) actHide(); }, 220);
  }
  /* measured from the button's own rect, like the tooltip and the Quran mini —
     follows the bar through all four edge positions and the magnifier's scaling */
  function actPlace() {
    if (!actEl || !actBtn || !actBtn.isConnected) return;
    var w = actEl.parentNode, pos = (w && w.dataset && w.dataset.pos) || 'right';
    var r = actBtn.getBoundingClientRect(), pw = actEl.offsetWidth, ph = actEl.offsetHeight, x, y;
    if (pos === 'top' || pos === 'bottom') {
      x = r.left + r.width / 2 - pw / 2;
      y = (pos === 'top') ? r.bottom + 10 : r.top - ph - 10;
    } else {
      y = r.top + r.height / 2 - ph / 2;
      x = (pos === 'right') ? r.left - pw - 10 : r.right + 10;
    }
    actEl.style.left = Math.min(Math.max(6, x), Math.max(6, window.innerWidth - pw - 6)) + 'px';
    actEl.style.top = Math.min(Math.max(6, y), Math.max(6, window.innerHeight - ph - 6)) + 'px';
  }
  /* a category's tools read LIVE, not captured when the rail was built: the bodies
     are injected lazily, so the list can be empty at build time and full by hover */
  function catTools(ck) {
    var a = tools.filter(function (t) { return t.cat === ck && !isHidden(t.id) && !t.noRail; });
    sortByOrder(a, ck);
    return a;
  }
  function actRow(t, live) {
    var b = h('<button class="syfs-cm-b" type="button"><span class="syfs-cm-ic"></span>'
      + '<span class="syfs-cm-nm"></span></button>');
    /* the icon is an internal SVG constant; the NAME is text, always — same rule
       as toolBtn, which the custom links made non-negotiable */
    b.querySelector('.syfs-cm-ic').innerHTML = t.icon || '';
    b.querySelector('.syfs-cm-nm').textContent = SYFS.t(t.name);
    b.setAttribute('aria-label', SYFS.t(t.name));
    if (live) b.classList.add('live');
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      var w = openWins[t.id];
      actHide();
      /* an open window may be minimised at the bottom or buried under three others,
         so "go to it" has to undo both, not just raise the z-index */
      if (w) { w.classList.remove('syfs-min'); focusWin(w); return; }
      runTool(t);
    });
    return b;
  }
  /* returns false when there is nothing worth showing — the caller then leaves the
     panel closed rather than opening an empty one */
  function actFill(label, list, used) {
    var live = [], sess = [];
    list.forEach(function (t) {
      if (openWins[t.id]) live.push(t);
      else if (used.indexOf(t.id) >= 0) sess.push(t);
    });
    if (!live.length && !sess.length) return false;
    /* the worker hands the ids back newest-first; keep that order — "what I was
       just doing" is the whole question this panel answers */
    sess.sort(function (a, b) { return used.indexOf(a.id) - used.indexOf(b.id); });
    var body = actEl.querySelector('.syfs-cm-body');
    body.textContent = '';
    actEl.querySelector('.syfs-cm-title').textContent = label;
    function group(name, arr, isLive) {
      if (!arr.length) return;
      var g = h('<div class="syfs-cm-g"><span class="syfs-cm-gh"></span></div>');
      g.querySelector('.syfs-cm-gh').textContent = name;
      arr.forEach(function (t) { g.appendChild(actRow(t, isLive)); });
      body.appendChild(g);
    }
    group('يعمل الآن', live, true);
    group('هذه الجلسة', sess, false);
    return true;
  }
  function actOpen(btn, wrap, ck, label) {
    if (!actEl || !actEl.isConnected) actBuild(wrap);
    actBtn = btn;
    clearTimeout(actHideT);
    var list = catTools(ck);
    try {
      chrome.runtime.sendMessage({ type: 'SYFS_ACT', op: 'list' }, function (r) {
        void chrome.runtime.lastError;
        if (actBtn !== btn) return;                     /* pointer moved on while we waited */
        /* an answer of "nothing to show" is remembered against THIS button until the
           pointer leaves it — otherwise every twitch over an empty category crosses
           into the inner SVG, fires mouseover again, and asks the worker once more */
        if (ck === 'islam' && r && r.q && r.q.live) { actBtn = null; actNone = btn; return; }   /* the transport owns this hover */
        var used = (r && r.ok && Array.isArray(r.used)) ? r.used.map(function (e) { return e.id; }) : [];
        if (!actFill(label, list, used)) { actBtn = null; actNone = btn; return; }
        actEl.classList.add('on');
        actPlace();
      });
    } catch (e) { actBtn = null; }
  }
  /* delegated on the rail like wireTips: mouseenter does not bubble, and re-entering
     the same button (the pointer crossing the inner SVG counts) must restart nothing */
  function wireActivity(rail, wrap) {
    rail.addEventListener('mouseover', function (e) {
      /* the shelf IS the full list; this panel is a shortcut past it. While one is
         open the panel is pure noise — and worse, it is fixed at a higher layer, so
         it would paint over the tools the click just asked for. */
      if (openCatKey) { actHide(); return; }
      var b = e.target && e.target.closest && e.target.closest('.syfs-cat-btn');
      var cat = b && b.parentNode, ck = (cat && cat.getAttribute) ? cat.getAttribute('data-cat') : null;
      /* real categories only: __fav is a view of other categories, and the bar's own
         controls (search / settings / app mode) carry no data-cat at all */
      if (b && ck && ck.charAt(0) !== '_') {
        if (b === actBtn || b === actPend || b === actNone) return;
        if (actBtn && actBtn !== b) actHide();
        clearTimeout(actOpenT); clearTimeout(actHideT);
        actPend = b;
        var meta = cats[ck] || { label: ck };
        /* an intent delay: sweeping the pointer down thirteen icons must not strobe
           thirteen panels on the way to the one you meant */
        actOpenT = setTimeout(function () { actPend = null; actOpen(b, wrap, ck, SYFS.t(meta.label)); }, 170);
        return;
      }
      if (actBtn && !actIn) actSchedHide();
    });
    rail.addEventListener('mouseout', function (e) {
      var b = e.target && e.target.closest && e.target.closest('.syfs-cat-btn');
      if (!b || b.contains(e.relatedTarget)) return;     /* crossing the inner SVG is not leaving */
      if (b === actPend) { clearTimeout(actOpenT); actPend = null; }
      if (b === actNone) actNone = null;                 /* ask again next time it is hovered */
      if (b === actBtn) actSchedHide();
    });
    /* Clicking opens the shelf — the panel and the shelf off one icon is noise.
       CAPTURE, not bubble: every button in this bar stops propagation (it has to,
       or the document-level handler would close the shelf in the same click), so a
       bubble listener here never runs. On the bubble phase the pending 170ms open
       survived the click and the panel drew itself over the shelf a moment later. */
    rail.addEventListener('click', actHide, true);
  }
  /* A category with a live window wears a dot. The panel tells you WHAT is running,
     but only once you hover; the dot tells you WHERE without being asked, which is
     the half of the question you have while looking at the bar. Local knowledge
     only (this tab's own windows) — it costs no message and can never go stale. */
  function markActive() {
    if (!root) return;
    var live = {};
    Object.keys(openWins).forEach(function (id) { var t = toolById(id); if (t) live[t.cat] = 1; });
    root.querySelectorAll('.syfs-cat[data-cat]').forEach(function (c) {
      c.classList.toggle('syfs-live', !!live[c.getAttribute('data-cat')]);
    });
  }

  /* wire the macOS magnifier onto a freshly-built rail (re-called on every rebuild) */
  function attachRailMagnify(rail) {
    if (!SYFS.dockfx || !rail) return;
    SYFS.dockfx.attachMagnify(rail, {
      items: function () { return rail.querySelectorAll('.syfs-cat-btn'); },
      axis: function () { var w = root.querySelector('.syfs-wrap'); var p = w && w.dataset.pos; return (p === 'top' || p === 'bottom') ? 'x' : 'y'; },
      enabled: function () { return dockFx === 'magnify'; },
      max: 1.6, influence: 130, spread: true
    });
  }
  /* JS proximity edge-peek (flicker-free) — wired once; reads state live each move */
  function wireRailPeek() {
    if (peekWired || !SYFS.dockfx || !SYFS.dockfx.attachPeek) return;
    peekWired = true;
    SYFS.dockfx.attachPeek({
      wrap: function () { return root.querySelector('.syfs-wrap'); },
      rail: function () { return root.querySelector('.syfs-rail'); },
      edge: function () { var w = root.querySelector('.syfs-wrap'); return (w && w.dataset.pos) || 'right'; },
      enabled: function () { return dockPeek; },
      busy: function () { return !!root.querySelector('.syfs-cat.open'); }
    });
  }

  /* ---------- color theme (accent + button style) ---------- */
  SYFS.ACCENTS = [
    ['#457364', 'تركوازي'], ['#2563eb', 'أزرق'], ['#7c3aed', 'بنفسجي'], ['#059669', 'أخضر'],
    ['#ea580c', 'برتقالي'], ['#db2777', 'وردي'], ['#0891b2', 'سماوي'], ['#475569', 'رمادي'],
    ['#dc2626', 'أحمر'], ['#9f1239', 'عنابي'], ['#c026d3', 'فوشيا'], ['#4f46e5', 'نيلي'],
    ['#1e3a8a', 'كحلي'], ['#0d9488', 'أزرق مخضر'], ['#4d7c0f', 'زيتي'], ['#65a30d', 'ليموني'],
    ['#d97706', 'كهرماني'], ['#92400e', 'بني'], ['#f43f5e', 'مرجاني'], ['#1f2937', 'فحمي']
  ];
  /* the one shape an accent may have — stored, imported or typed into the custom field */
  SYFS.ACCENT_RE = /^#[0-9a-f]{6}$/i;
  SYFS.STYLES = [['solid', 'صلب'], ['glass', 'زجاجي'], ['frost', 'ثلجي'], ['liquid', 'زجاج سائل'], ['outline', 'محدّد'], ['dark', 'داكن'], ['contrast', 'واضح'], ['neon', 'نيون'], ['gradient', 'متدرّج'], ['tonal', 'هادئ'], ['neu', 'ناعم بارز'], ['key3d', 'مجسّم'], ['round', 'دائري'], ['minimal', 'بسيط'], ['gold', 'ذهبي']];
  /* قيمة مخزَّنة ليست hex تُنتج `rgb(NaN,NaN,NaN)` — يرفضه محلّل CSS بصمت فيبقى الشريط
     بلا لون هوية بلا سبب ظاهر. الرفض هنا إلى الافتراضي، لا تمرير NaN. */
  function hexRgb(h) {
    if (!SYFS.ACCENT_RE.test(String(h || ''))) return [69, 115, 100];
    h = String(h).replace('#', '');
    var t = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    return t.every(function (v) { return isFinite(v); }) ? t : [69, 115, 100];
  }
  SYFS.applyAccent = function (wrap, hex) {
    var t = hexRgb(hex), d = t.map(function (v) { return Math.max(0, Math.round(v * 0.72)); });
    /* the lit face of the category buttons' 160deg gradient */
    var l = t.map(function (v) { return Math.min(255, Math.round(v * 1.32)); });
    wrap.style.setProperty('--pri', 'rgb(' + t.join(',') + ')');
    wrap.style.setProperty('--pri2', 'rgb(' + l.join(',') + ')');
    wrap.style.setProperty('--pri-d', 'rgb(' + d.join(',') + ')');
    wrap.style.setProperty('--pri-rgb', t.join(','));
    /* the glass window head tints with rgba(), which needs the components on their
       own — a `rgb(…)` string cannot be given an alpha. Without this the head would
       silently fall back to the default green whenever the accent is customised. */
    wrap.style.setProperty('--pri-d-rgb', d.join(','));
  };
  function applyTheme(wrap) {
    store.get('accent', '#457364').then(function (a) { SYFS.applyAccent(wrap, a || '#457364'); markTheme(); });
    /* نفس السبب: القيمة تصير جزءاً من مُحدِّد CSS، والمجهول يترك الأزرار بلا نمط. */
    store.get('cstyle', 'solid').then(function (s) {
      wrap.dataset.cstyle = pickOne(SYFS.STYLES.map(function (x) { return x[0]; }), s, 'solid');
      markTheme();
    });
    /* «الشكل الزجاجي» — default ON; the wrap is born with data-glass="on" so the
       first paint already has it, and only a stored `false` turns it off */
    if (SYFS.btnkit) store.get(SYFS.btnkit.KEY, true).then(function (v) { SYFS.btnkit.mark(wrap, v); markTheme(); });
    store.get('winbtn', SYFS.prefs.WINBTN_DEFAULT).then(function (s) {
      wrap.dataset.winbtn = pickOne(SYFS.prefs.WINBTN_VALUES, s, SYFS.prefs.WINBTN_DEFAULT);
      markTheme();
    });
  }
  function markTheme() {
    var w = root.querySelector('.syfs-wrap'); if (!w) return;
    var a = w.style.getPropertyValue('--pri-rgb');
    var preset = false;
    root.querySelectorAll('.syfs-acc').forEach(function (b) { var on = b.dataset.rgb === a; if (on) preset = true; b.classList.toggle('on', on); });
    var hex = a ? '#' + a.split(',').map(function (n) { return ('0' + (+n).toString(16)).slice(-2); }).join('') : '';
    root.querySelectorAll('.syfs-acc-cus').forEach(function (c) {
      c.classList.toggle('on', !!a && !preset);
      var p = c.querySelector('.syfs-acc-in'), x = c.querySelector('.syfs-acc-hex');
      if (SYFS.ACCENT_RE.test(hex)) {
        if (p && p.value !== hex) p.value = hex;
        /* not while the user is typing into it — that would rewrite their keystrokes */
        if (x && x !== root.activeElement) x.value = hex;
      }
    });
    root.querySelectorAll('.syfs-sty[data-s]').forEach(function (b) { b.classList.toggle('on', b.dataset.s === w.dataset.cstyle); });
    root.querySelectorAll('.syfs-glass-ck').forEach(function (c) { c.checked = w.dataset.glass !== 'off'; });
    root.querySelectorAll('.syfs-wb').forEach(function (b) { b.classList.toggle('on', b.dataset.wb === (w.dataset.winbtn || SYFS.prefs.WINBTN_DEFAULT)); });
  }
  /* ⚠️ a wrapper, not `init` itself: the event object would arrive as `force` */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); }); else init();
}());
