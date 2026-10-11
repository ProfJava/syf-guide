/* SYF — «العرض والقراءة»: force a dark theme on any site and a clean
 * reading mode. Runs at document_start so the saved dark theme applies with no
 * light flash, and registers a rail tool (picked up by src/rail.js at
 * document_idle — same isolated world, shared window.SYFS). Local only:
 * CSS + a reader overlay built from the page's own content; nothing leaves. */
(function () {
  window.SYFS = window.SYFS || {};

  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    /* the template's own text IS the msgid — translate the built tree rather than
       splitting the markup (see src/i18n.js). Free in the default language. */
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }

  var host = (location.hostname || '').toLowerCase().replace(/^www\./, '');
  var htmlEl = document.documentElement;

  /* ---- dark mode (filter-invert trick; media re-inverted so it looks normal) ----
     v0.139.3: a re-invert inside a re-invert is a NEGATIVE again — <picture><img>, an
     <img> in a background-image box, an <image> in an <svg>. So media is re-inverted
     only when no ancestor already was (:not(RE *)). Inline <svg> icons are NOT
     re-inverted: they are drawn in the text colour, which the page invert already
     flips — re-inverting put black icons on the now-dark page (they vanished). The
     SYF rail host is re-inverted whole: its shadow UI has its own light/dark theme.
     The reading overlay (#syfs-reader) too: it paints its own paper and has its own 🌙,
     so under a page invert its light paper came out dark and 🌙 made it light. It joins
     RE as well, so the pictures inside it are not flipped back into negatives. */
  var RE = 'picture,[style*="background-image"],[style*="background:url"],#syfs-reader';
  var MEDIA = ['img', 'video', 'picture', 'canvas', 'iframe', 'svg image', '[style*="background-image"]', '[style*="background:url"]'];
  var DARK_CSS =
    'html.syfs-dark{background:#0f0f0f!important;filter:invert(1) hue-rotate(180deg)!important;}' +
    MEDIA.map(function (s) { return 'html.syfs-dark ' + s + ':not(:is(' + RE + ') *)'; }).join(',') +
    ',html.syfs-dark #syfs-reader,html.syfs-dark #syfs-host{filter:invert(1) hue-rotate(180deg)!important;}';
  var darkStyle = null;
  function setDark(on) {
    if (on) {
      if (!darkStyle) { darkStyle = document.createElement('style'); darkStyle.id = 'syfs-dark-style'; darkStyle.textContent = DARK_CSS; }
      if (!darkStyle.isConnected) htmlEl.appendChild(darkStyle);
      htmlEl.classList.add('syfs-dark');
    } else {
      htmlEl.classList.remove('syfs-dark');
    }
  }
  function hostList(v) {
    return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }) : [];
  }
  /* add/remove one site in the stored list; `done(list)` gets the list as written */
  function saveHost(site, on, done) {
    try {
      chrome.storage.local.get({ syfs_dark_hosts: [] }, function (r) {
        var list = hostList(r.syfs_dark_hosts);
        var i = list.indexOf(site);
        if (on && i < 0) list.push(site); else if (!on && i >= 0) list.splice(i, 1);
        chrome.storage.local.set({ syfs_dark_hosts: list }, function () { if (done) done(list); });
      });
    } catch (e) { /* ignore */ }
  }
  var darkOn = false;
  try {
    chrome.storage.local.get({ syfs_dark_hosts: [] }, function (r) {
      darkOn = hostList(r.syfs_dark_hosts).indexOf(host) >= 0;
      if (darkOn) setDark(true);
    });
    /* the list is managed from any site's panel — a site removed there (or switched in
       another tab) follows here at once, not on the next reload */
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area !== 'local' || !ch.syfs_dark_hosts) return;
      var on = hostList(ch.syfs_dark_hosts.newValue).indexOf(host) >= 0;
      if (on !== darkOn) { darkOn = on; setDark(on); }
    });
  } catch (e) { /* ignore */ }

  /* ---- reading mode (session-only overlay built from the main article) ---- */
  var readerEl = null, readerSize = 19, readerBack = null, readerHooked = false;
  /* the containers an article can be — the same set the old per-node scan walked */
  var ART_TAGS = { ARTICLE: 1, MAIN: 1, SECTION: 1, DIV: 1 };
  function findArticle() {
    var cand = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]');
    if (cand && (cand.textContent || '').length > 200) return cand;
    /* ONE pass over the paragraphs. The old scan ran querySelectorAll('p') + innerText
       under every div, so each paragraph was measured once per ancestor with a layout
       each time (O(n²)) and a forum page froze the tab for seconds. Now each paragraph is
       measured once (textContent: no layout) and credits its parent in full and its
       grandparent by half — paragraphs wrapped one per <div> still meet in the
       grandparent, and the box that HOLDS the text beats the page wrapper around it. */
    var ps = document.getElementsByTagName('p');
    var idx = new Map(), nodes = [], score = [], count = [];
    function credit(el, v) {
      if (!el || !ART_TAGS[el.tagName]) return;
      var k = idx.get(el);
      if (k === undefined) { k = nodes.length; idx.set(el, k); nodes.push(el); score.push(0); count.push(0); }
      score[k] += v; count[k]++;
    }
    for (var i = 0; i < ps.length; i++) {
      var len = (ps[i].textContent || '').length, par = ps[i].parentElement;
      credit(par, len);
      if (par) credit(par.parentElement, len / 2);
    }
    var best = null, bestLen = 0;
    for (var j = 0; j < nodes.length; j++) {
      if (count[j] >= 2 && score[j] > bestLen) { bestLen = score[j]; best = nodes[j]; }
    }
    return best;
  }
  function buildReader() {
    var src = findArticle();
    var overlay = h('<div id="syfs-reader" role="dialog" aria-modal="true" tabindex="-1" style="position:fixed;inset:0;z-index:2147483647;overflow:auto;padding:0;outline:none;font-family:Georgia,\'Times New Roman\',serif;direction:'
      + (getComputedStyle(document.body).direction || 'ltr') + '"></div>');
    overlay.setAttribute('aria-label', SYFS.t('وضع القراءة'));
    var bar = h('<div style="position:sticky;top:0;display:flex;gap:8px;justify-content:flex-end;align-items:center;padding:10px 16px;border-bottom:1px solid #e5ddce;font-family:system-ui,sans-serif"></div>');
    function mkBtn(txt) { var b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.style.cssText = 'border:1px solid #cbb;background:#fff;color:#333;border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit'; return b; }
    var minus = mkBtn('A−'), plus = mkBtn('A+'), dark = mkBtn('🌙'), close = mkBtn(SYFS.t('✕ إغلاق'));
    minus.setAttribute('aria-label', SYFS.t('تصغير الخط'));
    plus.setAttribute('aria-label', SYFS.t('تكبير الخط'));
    dark.setAttribute('aria-label', SYFS.t('ورقة داكنة'));
    bar.append(minus, plus, dark, close);
    var article = document.createElement('div');
    article.style.cssText = 'max-width:720px;margin:0 auto;padding:32px 24px 80px;line-height:1.8;font-size:' + readerSize + 'px';
    var title = document.createElement('h1');
    title.textContent = document.title || '';
    title.style.cssText = 'font-size:1.7em;line-height:1.3;margin:0 0 24px';
    article.appendChild(title);
    if (src) {
      var clone = src.cloneNode(true);
      clone.querySelectorAll('script,style,noscript,iframe,button,form,nav,aside,[role="navigation"]').forEach(function (n) { n.remove(); });
      clone.querySelectorAll('*').forEach(function (n) { n.removeAttribute('class'); n.removeAttribute('style'); n.removeAttribute('id'); });
      article.appendChild(clone);
    } else {
      var p = document.createElement('p'); p.textContent = SYFS.t('تعذّر استخراج محتوى قابل للقراءة من هذه الصفحة.'); article.appendChild(p);
    }
    overlay.append(bar, article);
    function applySize() { article.style.fontSize = readerSize + 'px'; }
    minus.addEventListener('click', function () { readerSize = Math.max(13, readerSize - 1); applySize(); });
    plus.addEventListener('click', function () { readerSize = Math.min(30, readerSize + 1); applySize(); });
    /* the reader's own paper — independent of the page invert (re-inverted in DARK_CSS),
       and it opens dark on a site the user already darkened */
    function paper(isDark) {
      overlay.dataset.dark = isDark ? '1' : '0';
      overlay.style.background = isDark ? '#0f0f0f' : '#faf8f4';
      overlay.style.color = isDark ? '#e6e6e6' : '#1a1a1a';
      bar.style.background = isDark ? 'rgba(15,15,15,.95)' : 'rgba(250,248,244,.95)';
      dark.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    }
    paper(darkOn);
    dark.addEventListener('click', function () { paper(overlay.dataset.dark !== '1'); });
    close.addEventListener('click', closeReader);
    overlay.syfsClose = close;
    return overlay;
  }
  /* «احفظ المقال» (src/tools3.js) extracts the SAME node the reader shows — one heuristic,
     not two that disagree about what the article is */
  SYFS.findArticle = findArticle;
  /* a modal for the keyboard too: focus moves in on open, Esc closes, Tab cannot wander
     into the hidden page behind it, and focus goes back where it was on close */
  function readerKey(e) {
    if (!readerEl || e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    closeReader();
  }
  function readerFocus(e) {
    if (readerEl && !readerEl.contains(e.target)) readerEl.syfsClose.focus();
  }
  function openReader() {
    if (readerEl) return;
    /* Ctrl+Alt+Q («إغلاق كل الأدوات») reaches the reader too — hooked once, on first open */
    if (!readerHooked && typeof SYFS !== 'undefined' && SYFS.onCloseAll) {
      readerHooked = true;
      SYFS.onCloseAll(function () { if (!readerEl) return false; closeReader(); return true; });
    }
    readerBack = document.activeElement;
    readerEl = buildReader();
    document.documentElement.appendChild(readerEl);
    document.addEventListener('keydown', readerKey, true);
    document.addEventListener('focusin', readerFocus, true);
    readerEl.syfsClose.focus();
  }
  function closeReader() {
    if (!readerEl) return;
    document.removeEventListener('keydown', readerKey, true);
    document.removeEventListener('focusin', readerFocus, true);
    readerEl.remove(); readerEl = null;
    var back = readerBack; readerBack = null;
    if (back && back.isConnected && typeof back.focus === 'function') { try { back.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  /* ---- rail tool ----
   * v0.112.0 — `display` and `view` merged into one four-tab tool. Both change how the
   * page you are ON is displayed, both were a panel of two buttons, and side by side on
   * the shelf they read as one tool listed twice.
   *
   * ⛔ The merged tool KEEPS THE ID `display`. It is the older and by far the more used
   * of the two, so keeping its id means the majority lose neither their shortcut nor
   * their place in a stored `tool_order`; only `view` disappears. Never swap this to a
   * new id "because the tool is new" — the tool is not new, its panel grew tabs. */
  SYFS.tools = SYFS.tools || [];

  function mountDisplay(body) {
      var ui = h(
        '<div class="syf-form">' +
          '<button class="syf-btn" id="dp-dark"></button>' +
          '<div class="syf-note-hint">يفرض ثيماً داكناً على هذا الموقع (يُحفظ للموقع ويُطبَّق تلقائياً عند فتحه). قد يبدو غريباً في مواقع لها وضع ليلي خاص — أطفئه حينها.</div>' +
          '<label>المواقع المفعَّل عليها الوضع الليلي</label>' +
          '<div class="syf-note-list" id="dp-hosts"></div>' +
          '<hr style="border:none;border-top:1px solid var(--line);margin:6px 0">' +
          '<button class="syf-btn" id="dp-read">📖 وضع القراءة</button>' +
          '<div class="syf-note-hint">يعرض المقال الأساسي فقط بخط مريح، مع تكبير/تصغير الخط وتبديل داكن — بلا إعلانات ولا تشتيت. (للصفحة الحالية، لا يُحفظ.)</div>' +
        '</div>'
      );
      body.appendChild(ui);
      var darkBtn = ui.querySelector('#dp-dark'), hostsEl = ui.querySelector('#dp-hosts');
      function renderDark() { darkBtn.textContent = darkOn ? SYFS.t('☀️ إيقاف الوضع الليلي') : SYFS.t('🌙 تفعيل الوضع الليلي'); }
      /* every darkened site in one place — before this the only way to undo a site was to
         visit it again; a removed site goes light in its open tabs too (onChanged above) */
      function renderHosts(list) {
        hostsEl.textContent = '';
        if (!list.length) { hostsEl.appendChild(h('<div class="syf-empty">لا مواقع بعد.</div>')); return; }
        list.forEach(function (site) {
          var row = h('<div class="syf-note-row"><span class="t" style="cursor:default" dir="ltr"></span><button class="x" type="button">✕</button></div>');
          /* i18n-dyn: a host name */
          row.querySelector('.t').textContent = site || 'file://';
          row.querySelector('.x').setAttribute('aria-label', SYFS.t('إزالة {0}', site || 'file://'));
          row.querySelector('.x').addEventListener('click', function () {
            saveHost(site, false, function (l) {
              if (site === host) { darkOn = false; setDark(false); renderDark(); }
              renderHosts(l);
            });
          });
          hostsEl.appendChild(row);
        });
      }
      renderDark();
      try { chrome.storage.local.get({ syfs_dark_hosts: [] }, function (r) { renderHosts(hostList(r.syfs_dark_hosts)); }); } catch (e) { /* ignore */ }
      darkBtn.addEventListener('click', function () { darkOn = !darkOn; setDark(darkOn); saveHost(host, darkOn, renderHosts); renderDark(); });
      ui.querySelector('#dp-read').addEventListener('click', openReader);
    }

  /* ---- quick view: fullscreen + page zoom (in/out/reset) ----
   * Fullscreen uses the Fullscreen API on <html> (the button click is the user
   * gesture it requires). Zoom uses the browser's native per-tab zoom via the
   * service worker (chrome.tabs.setZoom — no extra permission, exactly like
   * Ctrl +/−) so it also covers fixed elements; nothing is persisted by us. */
  function zoomMsg(op, value, cb) {
    try {
      chrome.runtime.sendMessage({ type: 'SYFS_ZOOM', op: op, value: value }, function (r) {
        void chrome.runtime.lastError; if (cb) cb(r);
      });
    } catch (e) { if (cb) cb(null); }
  }
  var fsSync = null, fsHooked = false;
  function mountView(body) {
      var ui = h(
        '<div class="syf-form">' +
          '<button class="syf-btn" id="vw-fs"></button>' +
          '<div class="syf-note-hint">يعرض الصفحة بملء الشاشة (يخفي أشرطة المتصفّح). اضغط ثانيةً — أو Esc — للخروج.</div>' +
          '<hr style="border:none;border-top:1px solid var(--line);margin:6px 0">' +
          '<label>حجم الصفحة</label>' +
          '<div class="syf-row" style="align-items:center">' +
            '<button class="syf-btn" id="vw-out" style="flex:0 0 auto;min-width:44px">A−</button>' +
            '<div id="vw-pct" style="flex:1;text-align:center;font-weight:600">100%</div>' +
            '<button class="syf-btn" id="vw-in" style="flex:0 0 auto;min-width:44px">A+</button>' +
          '</div>' +
          '<button class="syf-btn" id="vw-reset">↺ حجم طبيعي (100%)</button>' +
          '<div class="syf-note-hint">تكبير/تصغير الصفحة مثل Ctrl و + / − — يشمل كامل المحتوى ويُحفظ للموقع في المتصفّح.</div>' +
        '</div>'
      );
      body.appendChild(ui);

      var fsBtn = ui.querySelector('#vw-fs'), pct = ui.querySelector('#vw-pct');
      function syncFs() { fsBtn.textContent = document.fullscreenElement ? SYFS.t('⤢ إنهاء ملء الشاشة') : SYFS.t('⛶ ملء الشاشة'); }
      syncFs();
      /* one document listener for the page's life, pointed at the newest panel — a
         listener per mount piled up when the tab was reopened without a fullscreen
         change in between to unhook the old ones */
      fsSync = function () { if (!fsBtn.isConnected) { fsSync = null; return; } syncFs(); };
      if (!fsHooked) { fsHooked = true; document.addEventListener('fullscreenchange', function () { if (fsSync) fsSync(); }); }
      fsBtn.addEventListener('click', function () {
        try {
          if (document.fullscreenElement) { if (document.exitFullscreen) document.exitFullscreen(); }
          else if (htmlEl.requestFullscreen) { var p = htmlEl.requestFullscreen(); if (p && p.catch) p.catch(function () {}); }
        } catch (e) {}
      });

      function showPct(r) { if (r && r.ok && typeof r.zoom === 'number') pct.textContent = Math.round(r.zoom * 100) + '%'; }
      zoomMsg('get', null, showPct);
      ui.querySelector('#vw-in').addEventListener('click', function () { zoomMsg('in', null, showPct); });
      ui.querySelector('#vw-out').addEventListener('click', function () { zoomMsg('out', null, showPct); });
      ui.querySelector('#vw-reset').addEventListener('click', function () { zoomMsg('reset', null, showPct); });
    }

  /* TWO tabs, not four. «الوضع الليلي» and «القراءة» are one button each: a tab per
     button turns a two-line panel into two clicks to reach either line. The split that
     means something is the one that was already there — what the SITE looks like vs.
     how big the WINDOW shows it. */
  SYFS.tools.push({
    id: 'display', name: 'العرض والقراءة', cat: 'util', beta: true,
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="15" r="3.5"/><circle cx="18" cy="15" r="3.5"/><path d="M9.5 15a2.5 2.5 0 0 1 5 0"/><path d="M2.5 12 5 7h4M21.5 12 19 7h-4"/></svg>',
    mount: function (body) {
      SYFS.tabs(body, [
        { label: 'ليلي وقراءة', build: mountDisplay },
        { label: 'الحجم وملء الشاشة', build: mountView }
      ]);
    }
  });

  // keep dark style attached through SPA rewrites
  new MutationObserver(function () { if (darkOn && darkStyle && !darkStyle.isConnected) htmlEl.appendChild(darkStyle); })
    .observe(htmlEl, { childList: true });
}());
