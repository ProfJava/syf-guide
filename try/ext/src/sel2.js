/* SYF — «سلكت ٢»: a searchable dropdown dressed over every native <select> (v0.142.0).
 *
 * ⛔ The native <select> stays the source of truth. It is hidden, never replaced: every
 *    tool keeps reading `sel.value` / `selectedIndex` / `options` and listening for
 *    `change` exactly as before, so not one of the ~50 call sites had to change. A pick
 *    here writes the native value and fires `input` + `change` on it (bubbling).
 * ⛔ Only OUR surfaces: the rail's shadow root (rail.js calls attach) and extension pages
 *    (self-bound below). A host page's own <select> is never touched — restyling someone
 *    else's site is not a default (same argument as fontkit's page font, §5.7).
 * - Programmatic writes (`sel.value = x` in a tool) have no event, so the two setters
 *   are shadowed on the INSTANCE and repaint the button; options rebuilt or a select
 *   hidden/disabled later are caught by a MutationObserver per select.
 * - The list is appended to the nearest `.syfs-wrap` (or the page body), position:fixed,
 *   so a tool window's `overflow` never clips it.
 * - One key `ui_select2` (default ON). OFF undresses every select live, no reload.
 * - Skipped: `multiple`, `size > 1`, and anything under `data-sel2="off"`. */
(function () {
  window.SYFS = window.SYFS || {};
  if (SYFS.sel2) return;

  var KEY = 'ui_select2', SEARCH_MIN = 8;
  var on = true, ready = false, roots = [], live = [];
  var open = null;                      /* { sel, btn, drop, items, act, close } */

  var CSS =
    '.syf-s2-native{display:none!important}' +
    /* :where() = zero specificity ⇒ a copied class such as .syf-in keeps its own look */
    ':where(.syf-s2-btn){font:inherit;color:inherit;background:var(--bg,Canvas);border:1px solid var(--line,#ccc);border-radius:8px;padding:6px 10px}' +
    '.syf-s2-btn{position:relative;display:inline-flex;align-items:center;min-width:0;cursor:pointer;text-align:start;padding-inline-end:28px!important;box-sizing:border-box}' +
    '.syf-s2-btn>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.syf-s2-btn::after{content:"";position:absolute;inset-inline-end:11px;top:50%;margin-top:-3px;border:4.5px solid transparent;border-top-color:currentColor;border-bottom:0;opacity:.6}' +
    '.syf-s2-btn[aria-expanded="true"]::after{transform:rotate(180deg)}' +
    '.syf-s2-btn:disabled{opacity:.55;cursor:default}' +
    '.syf-s2-btn:focus-visible{outline:2px solid var(--pri,#457364);outline-offset:1px}' +
    '.syf-s2-drop{position:fixed;z-index:2147483647;pointer-events:auto;box-sizing:border-box;display:flex;flex-direction:column;border:1px solid;border-radius:9px;box-shadow:0 10px 28px rgba(0,0,0,.22);overflow:hidden}' +
    '.syf-s2-q{margin:6px;padding:6px 9px;border:1px solid;border-color:inherit;border-radius:7px;font:inherit;color:inherit;background:transparent;outline:none}' +
    '.syf-s2-q:focus{border-color:var(--pri,#457364)}' +
    '.syf-s2-list{list-style:none;margin:0;padding:4px;overflow-y:auto;overscroll-behavior:contain}' +
    '.syf-s2-list li{padding:7px 10px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.syf-s2-list li.act{background:rgba(127,127,127,.16)}' +
    '.syf-s2-list li[aria-selected="true"]{font-weight:700;color:var(--pri,inherit)}' +
    '.syf-s2-list li[aria-disabled="true"]{opacity:.45;cursor:default}' +
    '.syf-s2-list li.grp{font-size:.82em;font-weight:700;opacity:.65;cursor:default;padding-top:9px}' +
    '.syf-s2-list li.none{opacity:.6;cursor:default}';

  var PROTO = window.HTMLSelectElement && HTMLSelectElement.prototype;
  var D_VAL = PROTO && Object.getOwnPropertyDescriptor(PROTO, 'value');
  var D_IDX = PROTO && Object.getOwnPropertyDescriptor(PROTO, 'selectedIndex');

  /* Arabic-aware match: tashkeel and tatweel out, the alef/yaa/taa-marbuta families folded
     — «مصر» finds «مِصْر», «اسكندرية» finds «الإسكندرية» */
  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/[ً-ٰٟـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
  }
  function t(s) { return (SYFS.t ? SYFS.t(s) : s); }

  /* ---------- dress / undress one select ---------- */
  function skip(sel) {
    return sel.multiple || sel.size > 1 || sel.classList.contains('syf-s2-native') ||
           (sel.closest && sel.closest('[data-sel2="off"]'));
  }
  function dress(sel) {
    if (skip(sel)) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.appendChild(document.createElement('span'));
    function paint() {
      if (!sel.isConnected) return;
      var cls = (sel.getAttribute('class') || '').replace(/\bsyf-s2-native\b/g, '').trim();
      btn.className = 'syf-s2-btn' + (cls ? ' ' + cls : '');
      btn.style.cssText = sel.style.cssText;         /* width / flex / display:none follow */
      btn.hidden = sel.hidden;
      btn.disabled = sel.disabled;
      ['title', 'aria-label'].forEach(function (a) {
        var v = sel.getAttribute(a); if (v) btn.setAttribute(a, v); else btn.removeAttribute(a);
      });
      var o = sel.options[sel.selectedIndex];
      btn.firstChild.textContent = o ? o.textContent : '';
      if (open && open.sel === sel) fill(open, open.q ? open.q.value : '');
    }
    /* the two setters, shadowed on this instance only; `delete` restores the prototype */
    if (D_VAL && D_IDX) {
      Object.defineProperty(sel, 'value', { configurable: true,
        get: function () { return D_VAL.get.call(sel); },
        set: function (v) { D_VAL.set.call(sel, v); paint(); } });
      Object.defineProperty(sel, 'selectedIndex', { configurable: true,
        get: function () { return D_IDX.get.call(sel); },
        set: function (v) { D_IDX.set.call(sel, v); paint(); } });
    }
    var mo = new MutationObserver(paint);
    mo.observe(sel, { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'disabled', 'title', 'aria-label'], childList: true, subtree: true, characterData: true });
    sel.addEventListener('change', paint);
    sel.classList.add('syf-s2-native');
    sel.parentNode.insertBefore(btn, sel.nextSibling);

    btn.addEventListener('click', function () { if (open && open.sel === sel) close(); else show(sel, btn); });
    btn.addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'Enter' || e.key === ' ' || (e.key === 'ArrowDown' && open && open.sel !== sel)) {
        e.preventDefault(); e.stopPropagation(); show(sel, btn);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        /* closed: arrows step the value in place, like a native select */
        e.preventDefault(); e.stopPropagation();
        step(sel, e.key === 'ArrowDown' ? 1 : -1);
      }
    });
    paint();
    live.push({ sel: sel, btn: btn, mo: mo, paint: paint });
  }
  function undressAll() {
    close();
    live.forEach(function (x) {
      x.mo.disconnect();
      x.sel.removeEventListener('change', x.paint);
      delete x.sel.value; delete x.sel.selectedIndex;
      x.sel.classList.remove('syf-s2-native');
      x.btn.remove();
    });
    live = [];
  }

  function pick(sel, i) {
    if (i === D_IDX.get.call(sel)) return;
    D_IDX.set.call(sel, i);
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function step(sel, d) {
    var i = D_IDX.get.call(sel), n = sel.options.length;
    for (var j = i + d; j >= 0 && j < n; j += d) { if (!sel.options[j].disabled) { pick(sel, j); return; } }
  }

  /* ---------- the open list ---------- */
  function fill(o, q) {
    var list = o.list, sel = o.sel, nq = norm(q).trim(), cur = D_IDX.get.call(sel), grp = null;
    list.textContent = ''; o.items = [];
    Array.prototype.forEach.call(sel.options, function (opt, i) {
      if (opt.hidden) return;
      if (nq && norm(opt.textContent).indexOf(nq) < 0) return;
      var g = opt.parentNode && opt.parentNode.tagName === 'OPTGROUP' ? opt.parentNode : null;
      if (g && g !== grp) {
        var gl = document.createElement('li'); gl.className = 'grp'; gl.setAttribute('role', 'presentation');
        gl.textContent = g.label;   /* i18n-dyn: copied from the tool's own <optgroup>, translated where it was built */
        list.appendChild(gl);
      }
      grp = g;
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.textContent = opt.textContent;
      li.setAttribute('aria-selected', i === cur ? 'true' : 'false');
      if (opt.disabled || (g && g.disabled)) li.setAttribute('aria-disabled', 'true');
      else {
        li.addEventListener('mousedown', function (e) { e.preventDefault(); });   /* keep focus in the search box */
        li.addEventListener('click', function () { pick(sel, i); close(true); });
        li.addEventListener('mousemove', function () { mark(o, o.items.indexOf(li)); });
        o.items.push(li); li._i = i;
      }
      list.appendChild(li);
    });
    if (!o.items.length) {
      var none = document.createElement('li'); none.className = 'none';
      none.textContent = t('لا نتائج'); list.appendChild(none);
    }
    var at = 0;
    o.items.forEach(function (li, k) { if (li._i === cur) at = k; });
    mark(o, nq ? 0 : at);
  }
  function mark(o, k) {
    if (!o.items.length) { o.act = -1; return; }
    k = Math.max(0, Math.min(o.items.length - 1, k));
    if (o.items[o.act]) o.items[o.act].classList.remove('act');
    o.act = k; o.items[k].classList.add('act');
    var li = o.items[k], l = o.list;
    if (li.offsetTop < l.scrollTop) l.scrollTop = li.offsetTop - 4;
    else if (li.offsetTop + li.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = li.offsetTop + li.offsetHeight - l.clientHeight + 4;
  }
  function place(o) {
    var r = o.btn.getBoundingClientRect(), vh = window.innerHeight, vw = window.innerWidth;
    var below = vh - r.bottom - 8, above = r.top - 8, up = below < 220 && above > below;
    var w = Math.min(Math.max(r.width, 180), vw - 16);
    var left = Math.min(Math.max(8, o.rtl ? r.right - w : r.left), vw - w - 8);
    o.drop.style.width = w + 'px';
    o.drop.style.left = left + 'px';
    o.drop.style.maxHeight = Math.max(140, Math.min(320, up ? above : below)) + 'px';
    if (up) { o.drop.style.top = ''; o.drop.style.bottom = (vh - r.top + 3) + 'px'; }
    else { o.drop.style.bottom = ''; o.drop.style.top = (r.bottom + 3) + 'px'; }
  }
  function show(sel, btn) {
    close();
    var cs = getComputedStyle(btn), bg = cs.backgroundColor;
    var drop = document.createElement('div');
    drop.className = 'syf-s2-drop';
    drop.dir = cs.direction;
    drop.style.font = cs.font;
    drop.style.color = cs.color;
    /* the list wears the button's own colours ⇒ right in every theme, on every page */
    drop.style.background = (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') ? 'var(--bg, Canvas)' : bg;
    drop.style.borderColor = cs.borderTopColor;
    var o = { sel: sel, btn: btn, drop: drop, items: [], act: -1, rtl: cs.direction === 'rtl', q: null };
    if (sel.options.length >= SEARCH_MIN) {
      o.q = document.createElement('input');
      o.q.className = 'syf-s2-q'; o.q.type = 'search';
      o.q.placeholder = t('ابحث…'); o.q.setAttribute('aria-label', t('ابحث في الخيارات'));
      o.q.addEventListener('input', function () { fill(o, o.q.value); });
      drop.appendChild(o.q);
    }
    o.list = document.createElement('ul');
    o.list.className = 'syf-s2-list'; o.list.setAttribute('role', 'listbox');
    drop.appendChild(o.list);
    (sel.closest('.syfs-wrap') || containerOf(sel)).appendChild(drop);
    open = o;
    btn.setAttribute('aria-expanded', 'true');
    fill(o, '');
    place(o);
    (o.q || drop).addEventListener('keydown', function (e) { keys(o, e); });
    if (o.q) o.q.focus({ preventScroll: true });
    else { drop.tabIndex = -1; drop.focus({ preventScroll: true }); }
  }
  function keys(o, e) {
    var k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') { mark(o, o.act + (k === 'ArrowDown' ? 1 : -1)); }
    else if (k === 'PageDown' || k === 'PageUp') { mark(o, o.act + (k === 'PageDown' ? 8 : -8)); }
    else if (k === 'Home' && !o.q) { mark(o, 0); }
    else if (k === 'End' && !o.q) { mark(o, o.items.length - 1); }
    else if (k === 'Enter') { if (o.items[o.act]) pick(o.sel, o.items[o.act]._i); close(true); }
    else if (k === 'Escape') { close(true); }
    else if (k === 'Tab') { close(); return; }
    else { e.stopPropagation(); return; }   /* typing in the box: not the rail's hotkeys */
    /* ⛔ a key we used stops here — Escape reaching the window would close the TOOL */
    e.preventDefault(); e.stopPropagation();
  }
  function close(refocus) {
    if (!open) return;
    var o = open; open = null;
    o.btn.setAttribute('aria-expanded', 'false');
    o.drop.remove();
    if (refocus) { try { o.btn.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
  }
  function outside(e) {
    if (!open) return;
    var path = e.composedPath ? e.composedPath() : [e.target];
    if (path.indexOf(open.drop) < 0 && path.indexOf(open.btn) < 0) close();
  }
  function reflow(e) {
    if (!open) return;
    /* the list's own scrolling is not a reason to shut it */
    if (e && e.type === 'scroll' && e.target && open.drop.contains && open.drop.contains(e.target)) return;
    if (!open.btn.isConnected) { close(); return; }
    /* a scroll or resize moves the list WITH its button; it shuts only once the button
       has left the screen (or was hidden) — closing on every scroll lost the list to the
       page's own smooth-scroll the moment it opened */
    var r = open.btn.getBoundingClientRect();
    if ((!r.width && !r.height) || r.bottom < 0 || r.top > window.innerHeight) { close(); return; }
    place(open);
  }

  /* ---------- roots ---------- */
  function containerOf(sel) {
    var r = sel.getRootNode ? sel.getRootNode() : document;
    if (r === document || !r.host) return document.body;
    return r.querySelector('.syfs-wrap') || r;
  }
  function scan(root) {
    if (!on) return;
    Array.prototype.forEach.call(root.querySelectorAll('select'), function (s) {
      if (!s.classList.contains('syf-s2-native')) dress(s);
    });
  }
  function attach(root) {
    if (roots.some(function (x) { return x.root === root; })) return;
    var style = document.createElement('style');
    style.textContent = CSS;
    (root === document ? (document.head || document.documentElement) : root).appendChild(style);
    var queued = false;
    var mo = new MutationObserver(function (recs) {
      if (queued || !on) return;
      for (var i = 0; i < recs.length; i++) {
        if (recs[i].addedNodes.length) {
          queued = true;
          /* ⛔ not requestAnimationFrame: Chrome parks rAF in a background or unfocused
             tab, so a tool opened there stayed native until the tab was looked at */
          setTimeout(function () { queued = false; scan(root); }, 0);
          return;
        }
      }
    });
    mo.observe(root === document ? document.documentElement : root, { childList: true, subtree: true });
    roots.push({ root: root, mo: mo });
    /* `scroll` is not composed: a tool body scrolling inside the shadow root never
       reaches window, so the root listens for itself */
    if (root !== document) root.addEventListener('scroll', reflow, true);
    if (ready) scan(root);
  }
  function setOn(v) {
    v = v !== false;
    if (v === on && ready) return;
    on = v; ready = true;
    if (on) roots.forEach(function (x) { scan(x.root); });
    else undressAll();
  }

  document.addEventListener('mousedown', outside, true);
  window.addEventListener('resize', reflow);
  window.addEventListener('scroll', reflow, true);
  window.addEventListener('blur', function () { close(); });

  try {
    chrome.storage.local.get(KEY, function (r) { setOn(!r || r[KEY] !== false); });
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area === 'local' && ch[KEY]) setOn(ch[KEY].newValue !== false);
    });
  } catch (e) { setOn(true); }

  SYFS.sel2 = { KEY: KEY, attach: attach, norm: norm };

  /* an extension page dresses itself — an inline <script> would be blocked by the
     page CSP (same reason as fontkit.bindRoot) */
  try {
    if (location.protocol === 'chrome-extension:') {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { attach(document); });
      else attach(document);
    }
  } catch (e) { /* ignore */ }
}());
