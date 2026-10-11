/* SYF — offline tool registry.
 * Each tool: { id, name, cat, icon(svg), mount(body) }.
 * mount() builds the tool UI inside `body` and wires its logic. All offline,
 * persistence via SYFS.store (chrome.storage). No eval, no external requests.
 *
 * i18n-via: cell   — the word counter's result cells translate their own label. */
(function () {
  window.SYFS = window.SYFS || {};
  var store = SYFS.store;

  /* ---- tiny DOM helper ---- */
  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    /* the template's own text IS the msgid — translate the built tree rather than
       splitting the markup (see src/i18n.js). Free in the default language. */
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }

  /* ---- password generator core (v0.177) ---- */
  /* unbiased integer in [0, n): rejection on 32-bit draws — `x % n` favours the low values */
  function pwInt(n) {
    var lim = 4294967296 - (4294967296 % n), b = new Uint32Array(1);
    do { crypto.getRandomValues(b); } while (b[0] >= lim);
    return b[0] % n;
  }
  /* one character of EVERY selected class first — a site that demands a digit gets one;
     before this, 8 chars over all four classes had no digit ≈37% of the time — the rest
     from the whole pool, then a Fisher–Yates shuffle so the guaranteed ones are not first */
  function pwMake(classes, n) {
    var pool = classes.join(''), out = [];
    classes.forEach(function (c) { out.push(c[pwInt(c.length)]); });
    while (out.length < n) out.push(pool[pwInt(pool.length)]);
    for (var i = out.length - 1; i > 0; i--) { var j = pwInt(i + 1), x = out[i]; out[i] = out[j]; out[j] = x; }
    return out.join('');
  }
  /* Clear a copied password after 20 s, as the vault does. The worker can do it whatever
     tab has focus (SYFS_CLIP_WIPE answers {ok:true}); without it this page tries — only
     while it still has focus (a page in the background may not write the clipboard) and
     only if nothing was copied here since, so a newer copy is never erased. `cb(byWorker)`
     lets the caller say which promise it can keep. */
  var pwWipeT = 0;
  function pwCopied() { if (pwWipeT) { clearTimeout(pwWipeT); pwWipeT = 0; } }
  function pwWipeLater(cb) {
    pwCopied();
    document.addEventListener('copy', pwCopied, true);
    document.addEventListener('cut', pwCopied, true);
    pwWipeT = setTimeout(function () {
      pwWipeT = 0;
      if (document.hasFocus() && navigator.clipboard) navigator.clipboard.writeText('').catch(function () {});
    }, 20000);
    var done = false;
    function fin(v) { if (!done) { done = true; cb(v); } }
    try {
      chrome.runtime.sendMessage({ type: 'SYFS_CLIP_WIPE', ms: 20000 }, function (r) { void chrome.runtime.lastError; fin(!!(r && r.ok === true)); });
      setTimeout(function () { fin(false); }, 600);
    } catch (e) { fin(false); }
  }

  /* ---- shared tabbed-tool wrapper ----
   * Merge related tools into ONE window: pass tabs [{label, build(panel)}].
   * build(panel) has the same signature as a tool's mount(body): it builds its
   * UI inside the fresh panel and scopes queries to it. Only one tab is mounted
   * at a time (the panel NODE is replaced on switch → any setInterval self-clears
   * via its body.isConnected guard). labels are set via textContent (no HTML injection).
   * `start` (optional, default 0) opens on that tab — used when a tool re-mounts
   * itself after a state change and must not throw the user back to tab 1.
   * v0.171.0 — an item may carry `ic` (the tool's OWN constant <svg> markup, never
   * user data): when every item has one, the rail becomes «أيقونة فوق نص» — the glyph
   * in a chip over its name, the active chip lit with the accent (.syf-tabs-ic).
   * Returns {bar, show} so a tool can keep its own rows beside the panel.
   * v0.173.0 — EVERY rail is «أيقونة فوق نص»: an item without `ic` takes its glyph from
   * TAB_IC by its label (the Arabic msgid), and a label not in the table gets a plain
   * dot — so a new tab never falls back to the old text-only look. */
  function C(x, y, r) { return 'M' + (x - r) + ' ' + y + 'a' + r + ' ' + r + ' 0 1 0 ' + 2 * r + ' 0a' + r + ' ' + r + ' 0 1 0 ' + (-2 * r) + ' 0'; }
  var G = {
    percent: 'M19 5L5 19' + C(7, 7, 2.5) + C(17, 17, 2.5),
    tag: 'M3 12V4h8l9 9-8 8zM7.5 7.5h.01',
    trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
    coins: C(9, 9, 6) + 'M15.6 10.2a6 6 0 1 1-5.4 5.4M9 6.5v5M7 9h4',
    overtime: C(12, 13, 8) + 'M12 9v4l2.5 1.5M12 2v3M9 2h6',
    bars: 'M4 20V11M10 20V5M16 20v-6M2 20h20',
    compound: 'M3 20h18M5 16l4-4 3 3 6-7M14 8h4v4',
    wallet: 'M3 7a2 2 0 0 1 2-2h12v4M3 7v11a2 2 0 0 0 2 2h14V9H5a2 2 0 0 1-2-2zM16 14.5h.01',
    receipt: 'M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21zM9 8h6M9 12h6M9 16h3',
    late: C(12, 13, 8) + 'M12 9v4l2 2M5 3L2 6M19 3l3 3',
    building: 'M4 21V5l8-3v19M12 9h8v12M3 21h18M8 7h.01M8 11h.01M8 15h.01M16 13h.01M16 17h.01',
    briefcase: 'M3 8h18v12H3zM8 8V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3M3 13h18',
    braces: 'M8 4H7a2 2 0 0 0-2 2v4l-2 2 2 2v4a2 2 0 0 0 2 2h1M16 4h1a2 2 0 0 1 2 2v4l2 2-2 2v4a2 2 0 0 1-2 2h-1',
    table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14',
    lines: 'M4 7h16M7 12h10M10 17h4',
    diff: 'M8 4H4v16h4M16 4h4v16h-4M12 3v18',
    db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    pen: 'M12 19l7-7 3 3-7 7zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18zM2 2l7.6 7.6' + C(11, 11, 2),
    code: 'M8 6l-6 6 6 6M16 6l6 6-6 6M14 4l-4 16',
    hash: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
    key: C(7.5, 15.5, 4.5) + 'M10.7 12.3L21 2M16 7l3 3M19 4l2 2',
    dropper: 'M2 22l1-1h3l9-9M3 21v-3l9-9M15 6l3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4z',
    contrast: C(12, 12, 9) + 'M12 3v18M12 7h4M12 11h5M12 15h4',
    access: C(12, 4.5, 1.5) + 'M5 8l7 1 7-1M12 9v5l-3 7M12 14l3 7',
    link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
    send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
    headers: 'M3 5h18v14H3zM3 9h18M7 13h6M7 16h4',
    terminal: 'M4 17l6-6-6-6M12 19h8',
    swap: 'M4 7h13l-3-3M20 17H7l3 3',
    envfile: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h4',
    moon: 'M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z',
    maximize: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
    sun: C(12, 12, 4) + 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',
    book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM20 17v4H6.5a2.5 2.5 0 0 1 0-5',
    region: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3',
    monitor: 'M3 5h18v11H3zM8 20h8M12 16v4',
    fullpage: 'M6 2.5h12v19H6zM9 7h6M9 11h6M9 15h4',
    edit: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
    pdfimg: 'M6 3h9l4 4v14H6zM14 3v5h5M9 17l2-3 2 2 2-3',
    compress: 'M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5',
    resize: 'M4 14v6h6M20 10V4h-6M4 20l7-7M20 4l-7 7',
    person: C(12, 7, 4) + 'M5 21c0-4 3-7 7-7s7 3 7 7',
    merge: 'M6 3v6l6 6v6M18 3v6l-6 6',
    scissors: C(6, 6, 3) + C(6, 18, 3) + 'M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12',
    rotate: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
    sign: 'M3 17c3 0 4-6 6-6s1 5 3 5 2-3 4-3 2 2 5 2M3 21h18',
    numbers: 'M10 6h11M10 12h11M10 18h11M4 4h1v5M4 9h2M6 19H4c0-1 2-2 2-3s-1-1.5-2-1',
    drop: 'M12 3l6 8a6.5 6.5 0 1 1-12 0z',
    word: 'M6 3h9l4 4v14H6zM14 3v5h5M8.5 12l1.5 5 2-4 2 4 1.5-5',
    search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14M20 20l-4-4',
    pulse: 'M3 12h4l3-8 4 16 3-8h4',
    layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
    globe: C(12, 12, 9) + 'M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
    youtube: 'M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM10 9l5 3-5 3z',
    facebook: 'M15 3h-3a4 4 0 0 0-4 4v3H5v4h3v7h4v-7h3l1-4h-4V7a1 1 0 0 1 1-1h3z',
    eyeoff: 'M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.6 6.6C3.9 8.4 2 12 2 12s4 6 10 6a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
    unzip: 'M4 4h16v4H4zM5 8v12h14V8M12 11v6M9 14l3 3 3-3',
    zip: 'M4 4h16v4H4zM5 8v12h14V8M12 17v-6M9 14l3-3 3 3',
    play: C(12, 12, 9) + 'M10 8l6 4-6 4z',
    palette: 'M12 3a9 9 0 1 0 0 18c1 0 2-1 1-2.5S13 16 15 16h2a4 4 0 0 0 4-4c0-5-4-9-9-9zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01',
    puzzle: 'M4 7h3a2 2 0 1 1 4 0h3v3a2 2 0 1 1 0 4v3h-3a2 2 0 1 0-4 0H4v-3a2 2 0 1 0 0-4z',
    timer: C(12, 13, 8) + 'M12 9v4M9 2h6M12 2v3',
    stopwatch: C(12, 13, 8) + 'M12 13l3-3M10 2h4M19 6l1.5-1.5',
    bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
    checklist: 'M10 6h11M10 12h11M10 18h11M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17',
    ruler: 'M3 15l12-12 6 6-12 12zM7 11l2 2M10 8l2 2M13 5l2 2',
    weight: 'M6 8h12l3 13H3zM9 8a3 3 0 1 1 6 0',
    thermo: 'M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0zM12 9v7',
    area: 'M4 4h16v16H4zM4 9h5V4M15 20v-5h5',
    beaker: 'M9 3h6M10 3v6L4 19a1.5 1.5 0 0 0 1.3 2h13.4A1.5 1.5 0 0 0 20 19L14 9V3M7 14h10',
    gauge: 'M12 14l4-4M3.3 17a9 9 0 1 1 17.4 0',
    hourglass: 'M6 2h12M6 22h12M7 2v4l5 6-5 6v4M17 2v4l-5 6 5 6v4',
    chip: 'M7 7h10v10H7zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4',
    pressure: 'M12 3v4M5.6 5.6l2.8 2.8M3 12h4M18.4 5.6l-2.8 2.8M21 12h-4' + C(12, 15, 4),
    bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
    angle: 'M4 20L18 4M4 20h16M11 20a8 8 0 0 0-2.3-5.7',
    dot: C(12, 12, 3)
  };
  var TAB_IC = {
    'النسبة': 'percent', 'الخصم': 'tag', 'هامش الربح': 'trend', 'العمولة': 'coins', 'أوفر تايم': 'overtime',
    'عائد استثمار': 'bars', 'عائد مركّب': 'compound', 'الراتب': 'wallet',
    'الضريبة': 'receipt', 'غرامة تأخير': 'late', 'ضريبة الشركات': 'building', 'نهاية الخدمة': 'briefcase',
    'JSON': 'braces', 'CSV ⇄ JSON': 'table', 'مصغّر/منسّق': 'lines', 'مقارنة نصّين': 'diff', 'SQL': 'db', 'SVG': 'pen',
    'Base64/URL': 'code', 'Hash/HMAC': 'hash', 'JWT': 'key', 'الملتقط': 'dropper', 'تباين WCAG': 'contrast',
    'الوصولية': 'access', 'الروابط': 'link', 'CSP': 'shield', 'مُرسِل طلبات': 'send', 'User-Agent وترويسات': 'headers',
    'cURL ⇄ fetch': 'terminal', 'YAML ⇄ JSON': 'swap', '.env ⇄ JSON': 'envfile',
    'ليلي وقراءة': 'moon', 'الحجم وملء الشاشة': 'maximize',
    'الصباح/المساء': 'sun', 'أذكاري': 'heart', 'آية اليوم': 'book', 'الإعدادات': 'bell',
    'تحديد منطقة': 'region', 'المنطقة المرئية': 'monitor', 'الصفحة كاملة': 'fullpage',
    'تحرير': 'edit', 'تحويل صيغة': 'swap', 'PDF ⇄ صور': 'pdfimg', 'ضغط': 'compress', 'تغيير الحجم': 'resize', 'حذف الخلفية': 'person',
    'دمج': 'merge', 'تقسيم واستخراج': 'scissors', 'تدوير': 'rotate', 'توقيع': 'sign', 'ترقيم': 'numbers', 'علامة مائية': 'drop', 'إلى Word': 'word',
    'الفحص': 'search', 'Web Vitals حيّ': 'pulse', 'الموارد': 'layers',
    'كل المواقع': 'globe', 'يوتيوب': 'youtube', 'فيسبوك': 'facebook', 'التتبّع': 'eyeoff',
    'فكّ الأرشيف': 'unzip', 'إنشاء أرشيف': 'zip',
    'التشغيل': 'play', 'الإخفاء': 'eyeoff', 'المظهر': 'palette', 'إضافات': 'puzzle',
    'الطول': 'ruler', 'الوزن': 'weight', 'الحرارة': 'thermo', 'المساحة': 'area', 'الحجم': 'beaker', 'السرعة': 'gauge',
    'الزمن': 'hourglass', 'البيانات': 'chip', 'الضغط': 'pressure', 'الطاقة': 'bolt', 'الزاوية': 'angle',
    'المؤقّت': 'timer', 'ساعة إيقاف / بومودورو': 'stopwatch', 'تنبيه مجدول': 'bell', 'تذكيرات': 'checklist'
  };
  function tabIc(label) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + G[TAB_IC[label] || 'dot'] + '"/></svg>';
  }
  SYFS.tabIc = tabIc;
  /* v0.173.1 — the rail scrolls on its own, as tall as the window body shows. The body
     is the scroll box (max-height 70vh, or the height a resize/maximise gives it) and
     the rail is sticky inside it; capping the rail at the body's inner height keeps
     every tab reachable without scrolling the tool away. Re-measured on every size
     change of the body — drag, maximise, a tab that grows the panel. */
  function fitRail(bar, box) {
    function fit() {
      if (!bar.isConnected) { if (ro) ro.disconnect(); return; }
      var cs = getComputedStyle(box);
      var inner = box.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
      bar.style.maxHeight = inner > 120 ? inner + 'px' : '';
    }
    var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(box);
    fit();
  }
  /* keep the lit tab inside the rail's own scroll — never scrollIntoView, which would
     also scroll the page the window floats over */
  function revealTab(bar, b) {
    var top = b.getBoundingClientRect().top - bar.getBoundingClientRect().top + bar.scrollTop, bot = top + b.offsetHeight;
    if (top < bar.scrollTop) bar.scrollTop = top - 4;
    else if (bot > bar.scrollTop + bar.clientHeight) bar.scrollTop = bot - bar.clientHeight + 4;
  }
  SYFS.fitRail = fitRail;
  SYFS.tabs = function (container, items, start) {
    items.forEach(function (it) { if (!(typeof it.ic === 'string' && /^<svg[\s>]/.test(it.ic))) it.ic = tabIc(it.label); });
    var withIc = items.length > 0;
    var bar = h('<div class="syf-tabs' + (withIc ? ' syf-tabs-ic' : '') + '" role="tablist" aria-orientation="vertical"></div>');
    var panel = null;
    container.appendChild(bar);
    fitRail(bar, container);
    var btns = [];
    function show(i) {
      btns.forEach(function (b, j) { b.classList.toggle('on', j === i); b.setAttribute('aria-selected', j === i ? 'true' : 'false'); });
      if (btns[i]) revealTab(bar, btns[i]);
      /* ⚠️ العقدة تُستبدل ولا تُفرَّغ. `panel.textContent = ''` يُبقي العقدة نفسها
         متّصلة بالمستند، فحارس `if (!body.isConnected) clearInterval(...)` في
         every() لا يقع أبداً على التبويبة المغادرة ويبقى مؤقّتها حيّاً: ثلاث
         تنقّلات في «تنبيهات ومواعيد» تركت أربعة مستطلعين ⇒ أربعة إشعارات وأربع
         حلقات صفير متداخلة لتنبيه واحد، ومستطلع ميّت يرمي كل ١٥ ثانية على
         الصفحة المضيفة. الشريط لا يُمَسّ — الاستبدال للوح وحده. */
      if (panel) panel.remove();
      panel = h('<div class="syf-tabpanel"></div>');
      container.appendChild(panel);
      try { items[i].build(panel); } catch (e) {}
    }
    items.forEach(function (it, i) {
      var b = h('<button class="syf-tab" type="button" role="tab"></button>');
      /* ⚠️ ONE line, every merged tool: this bar is the tab strip of the calculators,
         the tax tool, the image editor, YouTube+ … Untranslated it left the whole
         second row of every one of them Arabic in an English panel (v0.99.0). */
      if (withIc) {
        var ic = h('<span class="syf-tab-ic" aria-hidden="true">' + it.ic + '</span>');
        var nm = document.createElement('span'); nm.className = 'syf-tab-nm'; nm.textContent = SYFS.t(it.label);
        b.appendChild(ic); b.appendChild(nm);
      } else b.textContent = SYFS.t(it.label);
      b.addEventListener('click', function () { show(i); });
      bar.appendChild(b); btns.push(b);
    });
    /* arrows move along the rail (it is vertical: ↑/↓; ←/→ too, for a horizontal one) */
    bar.addEventListener('keydown', function (e) {
      var d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      /* e.target, not document.activeElement: inside the rail's shadow root the
         document only ever sees the host element */
      var cur = btns.indexOf(e.target && e.target.closest ? e.target.closest('.syf-tab') : null);
      if (!d || cur < 0) return;
      e.preventDefault();
      var j = (cur + d + btns.length) % btns.length; show(j); btns[j].focus();
    });
    if (items.length) show(Math.min(Math.max(start | 0, 0), items.length - 1));
    return { bar: bar, show: show };
  };

  /* ---- safe arithmetic evaluator (shunting-yard, no eval) ---- */
  function evalExpr(expr) {
    var tokens = expr.match(/(\d+\.?\d*|\.\d+|[+\-*/()%])/g);
    if (!tokens) return '';
    var out = [], ops = [];
    /* `u` = unary minus: its own operator, binding tighter than * / % and right-
       associative. The old trick (push 0, then treat "-" as binary) let a pending * or /
       pop first: 2*-3 gave -3, 5--3 gave 2, 8/-2 gave Error — wrong answers, no warning. */
    var prec = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, 'u': 3 };
    var prev = null;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (/^[\d.]/.test(t)) {
        if (prev === 'num') return 'Error'; /* "1.2.3" tokenises as 1.2 · .3 — two numbers, no operator */
        out.push(parseFloat(t)); prev = 'num';
      }
      else if (t === '(') { ops.push(t); prev = '('; }
      else if (t === ')') { while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()); ops.pop(); prev = 'num'; }
      else if (t === '-' && (prev === null || prev === 'op' || prev === '(')) { ops.push('u'); prev = 'op'; }
      else {
        while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[t]) out.push(ops.pop());
        ops.push(t); prev = 'op';
      }
    }
    while (ops.length) out.push(ops.pop());
    var st = [];
    for (var j = 0; j < out.length; j++) {
      var x = out[j];
      if (typeof x === 'number') st.push(x);
      else if (x === 'u') {
        if (!st.length) return 'Error';
        st.push(-st.pop());
      }
      else {
        var b = st.pop(), a = st.pop();
        if (a === undefined || b === undefined) return 'Error';
        if (x === '+') st.push(a + b); else if (x === '-') st.push(a - b);
        else if (x === '*') st.push(a * b); else if (x === '%') st.push(a % b);
        else if (x === '/') st.push(b === 0 ? NaN : a / b);
      }
    }
    var r = st.pop();
    if (r === undefined || isNaN(r)) return 'Error';
    return (Math.round(r * 1e10) / 1e10).toString();
  }

  /* ---- calculator keyboard + history (v0.140.0, specs/small-upgrades.md) ----
   * calcKey: a keydown → the token its button would add, a command ('=', '⌫', 'C',
   * 'copy'), or null = not ours (the key goes on to the page untouched). Arabic-Indic
   * digits and the Arabic decimal separator are accepted: «٣+٤» is 7. */
  var CALC_HIST_MAX = 20, CALC_HIST_LEN = 64;
  function calcKey(e) {
    if (!e || typeof e.key !== 'string') return null;
    if (e.ctrlKey || e.metaKey) return (!e.altKey && (e.key === 'c' || e.key === 'C')) ? 'copy' : null;
    if (e.altKey) return null;
    var k = e.key, d = '٠١٢٣٤٥٦٧٨٩'.indexOf(k);
    if (d >= 0) return String(d);
    if (k === '٫') return '.';
    if (k === '×') return '*';
    if (k === '÷') return '/';
    if (/^[0-9.+\-*/%()]$/.test(k)) return k;
    if (k === 'Enter' || k === '=') return '=';
    if (k === 'Backspace') return '⌫';
    if (k === 'Escape') return 'C';
    return null;
  }
  /* history entries are {e, r} strings, newest first. A result that is an error, or an
     "expression" that is just its own number (pressing = on 5), is not history. */
  function calcHistPush(list, e, r) {
    e = String(e || '').slice(0, CALC_HIST_LEN); r = String(r == null ? '' : r).slice(0, CALC_HIST_LEN);
    if (!e || !r || r === 'Error' || r === 'NaN' || e === r) return list;
    return [{ e: e, r: r }].concat(list || []).slice(0, CALC_HIST_MAX);
  }
  /* storage is written by import too (any JSON) ⇒ keep only well-formed rows */
  function calcHistClean(v) {
    if (!Array.isArray(v)) return [];
    return v.filter(function (x) {
      return x && typeof x.e === 'string' && typeof x.r === 'string' && x.e && x.r &&
             x.e.length <= CALC_HIST_LEN && x.r.length <= CALC_HIST_LEN;
    }).slice(0, CALC_HIST_MAX).map(function (x) { return { e: x.e, r: x.r }; });
  }

  /* Preserve any tools already registered by earlier (document_start) content
   * scripts — e.g. src/display.js pushes its dark/reading tool before this runs.
   * Reassigning with `=` here would silently clobber them. */
  SYFS.tools = (SYFS.tools || []).concat([
    /* ===== Calculator ===== */
    {
      id: 'calc', name: 'حاسبة', cat: 'calc',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7.5h8"/><path d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01"/><path d="M16 15v3"/></svg>',
      mount: function (body) {
        /* v0.140.0 — the box takes focus (tabindex) so the keyboard works; the last 20
           results sit under it. v0.145.0 — ⌫ left the key grid for the screen: an icon
           beside the picture one, on the number's side, shown only while there is input. */
        /* copy / picture: two icons INSIDE the screen, at the end opposite the number (the
           screen is always ltr, so the number is on the left and they sit on the right).
           Not .syf-key: the key grid (and its test) counts .syf-key. */
        /* each button carries its icon AND the ✓ / ✕ it flashes; CSS shows one by class */
        var IC_ST = '<svg class="st st-ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' +
          '<svg class="st st-err" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
        var IC_COPY = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>' + IC_ST;
        var IC_SHOT = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>' + IC_ST;
        var IC_BK = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z"/><path d="M12.5 9.5l5 5M17.5 9.5l-5 5"/></svg>';
        /* the row is ltr like the screen, so the order reads the same in both languages:
           ⌫ first (nearest the number), then the picture, then copy at the edge */
        body.appendChild(h('<div class="syf-calc" tabindex="0"><div class="syf-calc-scrw"><input class="syf-calc-scr" readonly tabindex="-1" value="0">' +
          '<div class="syf-calc-act"><button class="syf-calc-ic syf-calc-bk" type="button" data-act="bk" title="حذف محرف" aria-label="حذف محرف">' + IC_BK + '</button>' +
          '<button class="syf-calc-ic" type="button" data-act="shot" title="نسخ النتيجة كصورة" aria-label="نسخ النتيجة كصورة">' + IC_SHOT + '</button>' +
          '<button class="syf-calc-ic" type="button" data-act="copy" title="نسخ النتيجة" aria-label="نسخ النتيجة">' + IC_COPY + '</button></div></div>' +
          '<div class="syf-calc-keys"></div>' +
          '<div class="syf-calc-hhead" style="display:none"><span>السجلّ</span><button class="syf-mini" type="button">مسح السجلّ</button></div>' +
          '<div class="syf-note-list syf-calc-hist"></div></div>'));
        var box = body.querySelector('.syf-calc'), scr = body.querySelector('.syf-calc-scr'), keys = body.querySelector('.syf-calc-keys');
        var hHead = body.querySelector('.syf-calc-hhead'), histEl = body.querySelector('.syf-calc-hist');
        var act = body.querySelector('.syf-calc-act');
        var rows = ['C', '(', ')', '/', '7', '8', '9', '*', '4', '5', '6', '-', '1', '2', '3', '+', '0', '.', '%', '='];
        var cur = '', hist = [], last = { e: '', r: '' };
        var scrw = body.querySelector('.syf-calc-scrw');
        /* ⌫ is there only while there is something to delete (CSS reads .bk-on) */
        function setScr() { scr.value = cur || '0'; if (cur) scrw.classList.add('bk-on'); else scrw.classList.remove('bk-on'); }
        function copyScr() { try { return navigator.clipboard.writeText(scr.value); } catch (x) { return Promise.reject(x); } }
        /* a PNG of what the screen shows, put on the CLIPBOARD (not downloaded) — ready to
           paste into a chat or a document. The sum that produced it rides along only while
           the screen still shows that result (type another key and it is just the screen).
           The blob goes in as a promise so the click's user activation still covers write(). */
        function shotScr() {
          var r = scr.value, e = (last.r && r === last.r) ? last.e + ' =' : '';
          var cs = getComputedStyle(scr), font = getComputedStyle(box).fontFamily || 'sans-serif';
          var k = 2, pad = 24, c = document.createElement('canvas'), g = c.getContext('2d');
          g.font = '700 32px ' + font; var wr = g.measureText(r).width;
          g.font = '500 16px ' + font; var we = e ? g.measureText(e).width : 0;
          var w = Math.ceil(Math.max(wr, we, 160) + pad * 2), ht = e ? 108 : 80;
          c.width = w * k; c.height = ht * k; g.scale(k, k);
          g.fillStyle = cs.backgroundColor; g.fillRect(0, 0, w, ht);
          g.textAlign = 'left'; g.direction = 'ltr'; g.textBaseline = 'alphabetic';
          if (e) { g.fillStyle = cs.color; g.globalAlpha = 0.6; g.font = '500 16px ' + font; g.fillText(e, pad, 36); g.globalAlpha = 1; }
          g.fillStyle = cs.color; g.font = '700 32px ' + font; g.fillText(r, pad, e ? 80 : 52);
          var png = new Promise(function (res, rej) { c.toBlob(function (b) { if (b) res(b); else rej(new Error('toBlob')); }, 'image/png'); });
          return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        }
        /* the icon turns into ✓ / ✕ for a moment and the tooltip says what happened */
        function flash(b, ok, msg) {
          var tip = b.title;
          b.classList.add(ok ? 'ok' : 'err'); b.title = SYFS.t(msg); b.disabled = true;
          setTimeout(function () { b.classList.remove('ok'); b.classList.remove('err'); b.title = tip; b.disabled = false; }, 1200);
        }
        function run(b, job, done) {
          var p; try { p = job(); } catch (x) { p = Promise.reject(x); }
          p.then(function () { flash(b, true, done); }, function () { flash(b, false, 'تعذّر النسخ'); });
          refocus();
        }
        var actBtns = act.querySelectorAll('button');
        actBtns[0].addEventListener('click', function () { press('⌫'); refocus(); });
        actBtns[1].addEventListener('click', function () { run(actBtns[1], shotScr, 'نُسخت الصورة ✓'); });
        actBtns[2].addEventListener('click', function () { run(actBtns[2], copyScr, 'نُسخ ✓'); });
        function refocus() { try { box.focus({ preventScroll: true }); } catch (e) {} }
        /* rows are built with textContent — the expression comes from storage, which the
           settings import can write */
        function renderHist() {
          histEl.textContent = '';
          hHead.style.display = hist.length ? '' : 'none';
          hist.forEach(function (it) {
            var r = h('<div class="syf-note-row syf-calc-hrow"><span class="t"></span><b></b></div>');
            r.querySelector('.t').textContent = it.e + ' =';
            r.querySelector('b').textContent = it.r;
            r.addEventListener('click', function () { cur = it.r; setScr(); refocus(); });
            histEl.appendChild(r);
          });
        }
        function press(k) {
          if (k === 'C') { cur = ''; }
          else if (k === '⌫') { cur = cur.slice(0, -1); }
          else if (k === '=') {
            var e = cur, r = evalExpr(cur);
            cur = (r === 'Error' || r === 'NaN') ? '' : r;
            if (r === 'Error') { scr.value = SYFS.t('خطأ'); scrw.classList.remove('bk-on'); return; }
            last = { e: e, r: r };
            var next = calcHistPush(hist, e, r);
            if (next !== hist) { hist = next; store.set('calc_hist', hist); renderHist(); }
            if (!cur) { scrw.classList.remove('bk-on'); return; }
          }
          else { cur += k; }
          setScr();
        }
        rows.forEach(function (k) {
          /* the class is written [*\/…], never [/*…]: a literal «/*» inside a regex opens a
             "comment" for tools/i18n-extract.js, which then skipped every msgid up to the
             next «*\/» (a label written after it was invisible to it) */
          var b = h('<button type="button" class="syf-key' + (/[*\/\-+=%()]/.test(k) ? ' op' : '') + (k === 'C' ? ' clr' : '') + (k === '=' ? ' eq' : '') + '">' + k + '</button>');
          b.addEventListener('click', function () { press(k); refocus(); });
          keys.appendChild(b);
        });
        hHead.querySelector('button').addEventListener('click', function () { hist = []; store.set('calc_hist', hist); renderHist(); refocus(); });
        /* ⛔ a key we handle stops HERE: the rail's hotkeys and the page's own shortcuts
           listen on document, and «7» or Backspace reaching them while you type a sum
           would fire a tool or navigate back. Keys we don't handle pass untouched. */
        function ours(e) { return !hHead.contains(e.target) && !act.contains(e.target) && calcKey(e); }
        box.addEventListener('keydown', function (e) {
          var k = ours(e);
          if (!k) return;
          e.preventDefault(); e.stopPropagation();
          if (k === 'copy') { copyScr().catch(function () {}); return; }
          press(k);
        });
        ['keyup', 'keypress'].forEach(function (t) { box.addEventListener(t, function (e) { if (ours(e)) e.stopPropagation(); }); });
        store.get('calc_hist', []).then(function (v) { hist = calcHistClean(v); renderHist(); });
        setScr();
        setTimeout(refocus, 0);
      }
    },

    /* VAT calculator merged into the "حاسبة الضرائب" tabbed tool (src/calc.js). */

    /* ===== Unit converter — v0.130.0: eleven families, two-way, with a board =====
     * It was three families, one direction (the result box was readonly) and no way to
     * see anything but the one pair you had selected. Now: every family the tool can
     * do is a tab, EITHER box can be typed in (the other follows), ⇄ swaps them, and
     * a board under them reads the same quantity in every unit of the family at once.
     * ⛔ The KEY of a unit and of a family is data, not interface text: families key
     * `SETS`, units key the ratio table, so both live in `data-k` / `value` and never
     * in a translated label (§6.97/4 — read the key off the text and the converter
     * returns 0 for everything, in silence). */
    {
      id: 'units', name: 'محوّل الوحدات', cat: 'calc',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5L8.5 3 21 15.5 15.5 21z"/><path d="M8 6l1.6 1.6M11 9l1.6 1.6M14 12l1.6 1.6"/></svg>',
      mount: function (body) {
        /* [symbol, [arabic name, ratio to the family's base unit]] — the base unit is
           whichever has ratio 1. Temperature is not a ratio and is handled apart. */
        var SETS = {
          'الطول':   { m: ['متر', 1], km: ['كيلومتر', 1000], cm: ['سنتيمتر', 0.01], mm: ['مليمتر', 0.001], mile: ['ميل', 1609.344], yd: ['ياردة', 0.9144], ft: ['قدم', 0.3048], in: ['بوصة', 0.0254], nmi: ['ميل بحري', 1852] },
          'الوزن':   { kg: ['كيلوغرام', 1], g: ['غرام', 0.001], mg: ['مليغرام', 1e-6], ton: ['طن', 1000], lb: ['رطل', 0.45359237], oz: ['أونصة', 0.028349523], st: ['ستون', 6.35029318] },
          'الحرارة': { '°C': ['سيليزية', 'C'], '°F': ['فهرنهايت', 'F'], K: ['كلفن', 'K'] },
          'المساحة': { 'm²': ['متر مربع', 1], 'km²': ['كيلومتر مربع', 1e6], 'cm²': ['سنتيمتر مربع', 1e-4], ha: ['هكتار', 10000], acre: ['فدّان إنجليزي', 4046.8564], 'ft²': ['قدم مربع', 0.09290304], 'mi²': ['ميل مربع', 2589988.11] },
          'الحجم':   { L: ['لتر', 1], mL: ['مليلتر', 0.001], 'm³': ['متر مكعب', 1000], 'cm³': ['سنتيمتر مكعب', 0.001], gal: ['غالون أمريكي', 3.785411784], qt: ['كوارت', 0.946352946], cup: ['كوب', 0.2365882365], 'ft³': ['قدم مكعب', 28.316846592] },
          'السرعة':  { 'km/h': ['كم/س', 1], 'm/s': ['م/ث', 3.6], mph: ['ميل/س', 1.609344], kn: ['عقدة', 1.852], 'ft/s': ['قدم/ث', 1.09728] },
          'الزمن':   { s: ['ثانية', 1], min: ['دقيقة', 60], h: ['ساعة', 3600], d: ['يوم', 86400], wk: ['أسبوع', 604800], mo: ['شهر (٣٠ يوماً)', 2592000], yr: ['سنة (٣٦٥ يوماً)', 31536000] },
          'البيانات': { MB: ['ميغابايت', 1], B: ['بايت', 1 / 1048576], KB: ['كيلوبايت', 1 / 1024], GB: ['غيغابايت', 1024], TB: ['تيرابايت', 1048576], bit: ['بت', 1 / 8388608] },
          'الضغط':   { bar: ['بار', 1], Pa: ['باسكال', 1e-5], kPa: ['كيلوباسكال', 0.01], atm: ['جوّ', 1.01325], psi: ['رطل/بوصة²', 0.0689475729], mmHg: ['مم زئبق', 0.001333224] },
          'الطاقة':  { kcal: ['كيلوسعرة', 1], J: ['جول', 1 / 4184], kJ: ['كيلوجول', 1000 / 4184], cal: ['سعرة', 0.001], Wh: ['واط·ساعة', 3600 / 4184], kWh: ['كيلوواط·ساعة', 3600000 / 4184] },
          'الزاوية': { '°': ['درجة', 1], rad: ['راديان', 57.2957795131], grad: ['غراد', 0.9], '′': ['دقيقة قوسية', 1 / 60] }
        };
        /* v0.137.0 — the family picker is a SIDE rail, not a wrapping pill grid.
           Eleven families in a `.syf-seg-wrap` took six rows of the panel (they were
           three when the wrap rule was written) and pushed the two inputs, the ⇄ and
           the board below the fold in a window this narrow. It is the same rail every
           merged tool has carried since v0.119.0 — `.syf-tabs` + `.syf-tabpanel`,
           direct children of the window body — so rail.css's `:has()` grid lays it out
           and NOTHING here positions anything. The floor that keeps the panel usable
           lives with the rail, in src/winsize.js, not in this tool. */
        body.appendChild(h('<div class="syf-tabs syf-tabs-ic" id="u-cat" role="tablist" aria-orientation="vertical"></div>'));
        body.appendChild(h(
          '<div class="syf-tabpanel"><div class="syf-form">' +
            '<div class="syf-row" style="gap:6px"><input type="number" class="syf-in" id="u-val" value="1" step="any" style="flex:1"><select class="syf-in" id="u-from" style="width:116px"></select></div>' +
            '<div class="syf-row" style="justify-content:center;align-items:center;gap:8px">' +
              '<span class="syf-eq" style="margin:0">=</span>' +
              '<button class="syf-mini ico" id="u-swap" title="عكس الاتجاه" aria-label="عكس الاتجاه"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v14M7 4L4 7.5M7 4l3 3.5"/><path d="M17 20V6M17 20l3-3.5M17 20l-3-3.5"/></svg></button>' +
            '</div>' +
            '<div class="syf-row" style="gap:6px"><input type="number" class="syf-in" id="u-res" step="any" style="flex:1"><select class="syf-in" id="u-to" style="width:116px"></select></div>' +
            '<div class="syf-note-list" id="u-board" style="max-height:190px;overflow-y:auto"></div>' +
          '</div></div>'
        ));
        var q = function (s) { return body.querySelector(s); };
        SYFS.fitRail(q('#u-cat'), body);
        var cat = q('#u-cat'), val = q('#u-val'), from = q('#u-from'), to = q('#u-to'), res = q('#u-res'), board = q('#u-board');
        var kind = Object.keys(SETS)[0];
        function units() { return SETS[kind]; }
        function name(u) { return SYFS.t(units()[u][0]); }

        function mark() { cat.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.k === kind); b.setAttribute('aria-selected', b.dataset.k === kind); }); }
        Object.keys(SETS).forEach(function (k) {
          /* v0.173.0 — «أيقونة فوق نص», like every SYFS.tabs rail (glyph from TAB_IC) */
          var b = h('<button class="syf-tab" type="button" role="tab"><span class="syf-tab-ic" aria-hidden="true">' + tabIc(k) + '</span><span class="syf-tab-nm"></span></button>');
          b.dataset.k = k;
          /* i18n-dyn: the family name, translated through the dictionary */
          b.querySelector(".syf-tab-nm").textContent = SYFS.t(k);
          b.addEventListener('click', function () { kind = k; mark(); fillUnits(); calc(); });
          cat.appendChild(b);
        });
        mark();

        function opt(sel, u) {
          /* i18n-skip-start: the symbol keys the ratio table — data, in `value` */
          var o = h('<option value="' + u.replace(/"/g, '') + '"></option>');
          /* i18n-skip-end */
          o.textContent = u + ' — ' + name(u);
          sel.appendChild(o);
        }
        function fillUnits() {
          var u = Object.keys(units());
          from.innerHTML = ''; to.innerHTML = '';
          u.forEach(function (x) { opt(from, x); opt(to, x); });
          from.selectedIndex = 0;
          to.selectedIndex = Math.min(1, u.length - 1);
        }
        function temp(v, f, t) { var c = f === 'C' ? v : f === 'F' ? (v - 32) * 5 / 9 : v - 273.15; return t === 'C' ? c : t === 'F' ? c * 9 / 5 + 32 : c + 273.15; }
        /* i18n-skip-start: a key into `SETS`, not interface text — translating this
           comparison sends every temperature through the linear ratio path and returns
           silent nonsense (§6.97/4). */
        function isTemp() { return kind === 'الحرارة'; }
        /* i18n-skip-end */
        function conv(v, f, t) {
          var s = units();
          if (!s[f] || !s[t]) return 0;
          return isTemp() ? temp(v, s[f][1], s[t][1]) : v * s[f][1] / s[t][1];
        }
        /* enough digits to stay true without printing 0.30480000000000002 */
        function fmt(v) {
          if (!isFinite(v)) return '';
          var r = Math.abs(v) >= 1e15 ? v : parseFloat(v.toPrecision(12));
          return String(Math.abs(r) < 1e-9 && r !== 0 ? v.toExponential(4) : r);
        }
        function renderBoard(v, f) {
          board.innerHTML = '';
          Object.keys(units()).forEach(function (u) {
            var row = h('<div class="syf-note-row" style="cursor:pointer;align-items:center;gap:8px" title="اجعلها وحدة النتيجة">' +
                        '<span class="t" style="flex:1"></span><b style="color:var(--pri);white-space:nowrap"></b></div>');
            row.querySelector('.t').textContent = name(u);
            /* i18n-dyn: a number and its unit symbol */
            row.querySelector('b').textContent = fmt(conv(v, f, u)) + ' ' + u;
            if (u === to.value) row.classList.add('syf-next');
            row.addEventListener('click', function () { to.value = u; calc(); });
            board.appendChild(row);
          });
        }
        /* BOTH boxes are live (v0.130.0): whichever you type in is the source, the
           other follows. `res` is no longer readonly — that was the whole complaint. */
        function calc(srcIsRes) {
          if (srcIsRes) val.value = fmt(conv(parseFloat(res.value) || 0, to.value, from.value));
          else res.value = fmt(conv(parseFloat(val.value) || 0, from.value, to.value));
          renderBoard(parseFloat(val.value) || 0, from.value);
        }
        val.addEventListener('input', function () { calc(false); });
        res.addEventListener('input', function () { calc(true); });
        from.addEventListener('change', function () { calc(false); });
        to.addEventListener('change', function () { calc(false); });
        q('#u-swap').addEventListener('click', function () {
          var a = from.value, b = to.value, v = res.value;
          from.value = b; to.value = a; val.value = v; calc(false);
        });
        fillUnits(); calc(false);
      }
    },

    /* ===== Password generator ===== */
    /* ⛔ v0.177 — the password is NOT written into this panel. The rail is an open shadow
       root on someone else's page (§5.10/1): whatever sits in #p-out, any script there reads
       through document.getElementById('syfs-host').shadowRoot. It lives in this content
       script's memory (the isolated world — the page cannot reach it, §5.10/4); the field
       shows one dot per character, and «نسخ» copies from memory. To SEE a password, generate
       it inside the vault, an extension page no site can read. */
    {
      id: 'password', name: 'مولّد كلمات المرور', cat: 'util',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.85 12.15L19 4"/><path d="M18 5l2 2"/><path d="M15 8l2 2"/></svg>',
      mount: function (body) {
        body.appendChild(h(
          '<div class="syf-form"><div class="syf-pw-out"><input type="text" class="syf-in" id="p-out" readonly aria-label="كلمة السر المولّدة (مخفية)"><button class="syf-mini" id="p-copy">نسخ</button></div>' +
          '<div class="syf-note-hint" id="p-st" role="status" aria-live="polite"></div>' +
          '<label for="p-range">الطول: <b id="p-len">16</b></label><input type="range" min="12" max="40" value="16" id="p-range">' +
          '<label class="syf-ck"><input type="checkbox" id="p-up" checked> أحرف كبيرة</label>' +
          '<label class="syf-ck"><input type="checkbox" id="p-low" checked> أحرف صغيرة</label>' +
          '<label class="syf-ck"><input type="checkbox" id="p-num" checked> أرقام</label>' +
          '<label class="syf-ck"><input type="checkbox" id="p-sym" checked> رموز</label>' +
          '<button class="syf-btn" id="p-gen">توليد</button>' +
          '<div id="p-bar" style="height:6px;border-radius:99px;background:var(--line);overflow:hidden"><div id="p-fill" style="height:100%;width:0;transition:width .18s"></div></div>' +
          '<div class="syf-note-hint" id="p-str"></div>' +
          '<div class="syf-note-hint">لا تُعرَض كلمة السر هنا: الموقع المفتوح يستطيع قراءة ما يُكتب في الشريط. انسخها والصقها، أو ولّدها داخل الحافظة لتراها.</div>' +
          '<button class="syf-mini" id="p-vault">🔒 افتح الحافظة لحفظها</button>' +
          '</div>'));
        var out = body.querySelector('#p-out'), range = body.querySelector('#p-range'), lenL = body.querySelector('#p-len');
        var fill = body.querySelector('#p-fill'), strEl = body.querySelector('#p-str'), stEl = body.querySelector('#p-st');
        var sets = { up: 'ABCDEFGHJKLMNPQRSTUVWXYZ', low: 'abcdefghijkmnpqrstuvwxyz', num: '23456789', sym: '!@#$%^&*-_=+?' };
        var secret = '';                                   /* isolated-world memory only — never DOM */
        /* Strength is stated as ENTROPY, not as a five-word adjective: length × log2(pool)
           is the whole truth for a random password, and it is the one number that makes
           the length slider mean something on screen. A word like «قوية» would be the
           tool grading its own output. */
        function bits(poolSize, n) { return poolSize > 1 ? Math.round(n * Math.log2(poolSize)) : 0; }
        function classesNow() {
          return ['up', 'low', 'num', 'sym'].filter(function (k) { return body.querySelector('#p-' + k).checked; })
                                             .map(function (k) { return sets[k]; });
        }
        function paintStrength(pool, n) {
          var b = bits(pool.length, n);
          /* 60 bits ≈ the point below which an offline attacker wins on commodity
             hardware; 100 is where the bar is full. Both are stated, not implied. */
          var pct = Math.max(4, Math.min(100, Math.round(b / 100 * 100)));
          var col = b < 45 ? '#dc2626' : b < 60 ? '#d97706' : b < 80 ? '#65a30d' : '#16a34a';
          fill.style.width = pct + '%'; fill.style.background = col;
          strEl.textContent = !pool.length ? SYFS.t('اختر نوع محارف واحداً على الأقل.')
            : b < 60 ? SYFS.t('⚠ ضعيفة: {0} بت فقط — زد الطول أو أنواع المحارف.', b)
            : SYFS.t('{0} بت من العشوائية · مجموعة من {1} محرفاً', b, pool.length);
        }
        function gen() {
          var cls = classesNow(), pool = cls.join('');
          stEl.textContent = '';
          if (!pool) { secret = ''; out.value = ''; paintStrength('', 0); return; }
          var n = parseInt(range.value, 10);
          secret = pwMake(cls, n);
          out.value = '•'.repeat(secret.length);
          paintStrength(pool, n);
        }
        range.addEventListener('input', function () { lenL.textContent = range.value; gen(); });
        ['up', 'low', 'num', 'sym'].forEach(function (k) { body.querySelector('#p-' + k).addEventListener('change', gen); });
        body.querySelector('#p-gen').addEventListener('click', gen);
        body.querySelector('#p-copy').addEventListener('click', function () {
          if (!secret || !navigator.clipboard) return;
          var s = secret;
          navigator.clipboard.writeText(s).then(function () {
            pwWipeLater(function (byWorker) {
              stEl.textContent = byWorker ? SYFS.t('نُسخت ✓ — تُمحى من الحافظة بعد 20 ثانية')
                                          : SYFS.t('نُسخت ✓ — تُمحى بعد 20 ثانية إن بقيت في هذه الصفحة');
            });
          }, function () { stEl.textContent = SYFS.t('تعذّر النسخ'); });
        });
        /* ⛔ THE PASSWORD IS NOT SENT TO THE VAULT — this button only OPENS it, and the
           user pastes. The vault runs on an extension page precisely so that secrets
           never travel through a web page's context (§5.10), and piping a generated
           password from this content script into it would hand the credential exactly
           the journey that page exists to avoid. «Copy, then paste» is one more action
           and one less path. */
        body.querySelector('#p-vault').addEventListener('click', function () {
          try { chrome.runtime.sendMessage({ type: 'SYFS_OPEN_VAULT' }, function () { void chrome.runtime.lastError; }); } catch (e) {}
        });
        gen();
      }
    },

    /* ===== Notes ===== */
    {
      id: 'notes', name: 'ملاحظات', cat: 'note',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9l6-6V5a2 2 0 0 0-2-2z"/><path d="M14 21v-5a1 1 0 0 1 1-1h5"/></svg>',
      mount: function (body) {
        body.appendChild(h(
          '<div class="syf-notes"><input class="syf-in" id="n-title" placeholder="العنوان"><textarea class="syf-in" id="n-body" rows="4" placeholder="اكتب ملاحظتك…"></textarea>' +
          '<div class="syf-row"><button class="syf-btn" id="n-save">حفظ</button><button class="syf-mini" id="n-new">جديد</button><button class="syf-mini" id="n-pin" title="لصق كملاحظة عائمة على الصفحة">📌 لصق على الشاشة</button></div>' +
          '<div class="syf-note-list" id="n-list"></div></div>'));
        var title = body.querySelector('#n-title'), txt = body.querySelector('#n-body'), list = body.querySelector('#n-list');
        /* v0.139.3: `editing` is the note's id, not its row index — deleting a row
           while another is open used to save the edit over a different note. Every
           write re-reads the list first, and an outside write (the reader's «save to
           notes», a second tab) re-renders this panel instead of being overwritten. */
        var notes = [], editing = null;
        function nid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
        function withIds(v) {
          var arr = (Array.isArray(v) ? v : []).filter(function (n) { return n && typeof n === 'object'; }), added = false;
          arr.forEach(function (n) { if (!n.id) { n.id = nid(); added = true; } });
          return { list: arr, added: added };
        }
        function at(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return i; return -1; }
        function update(fn) {
          return store.get('notes', []).then(function (v) {
            var r = withIds(v); fn(r.list); notes = r.list;
            return store.set('notes', notes);
          }).then(render);
        }
        function render() {
          list.innerHTML = '';
          if (!notes.length) { list.appendChild(h('<div class="syf-empty">لا ملاحظات بعد.</div>')); return; }
          notes.forEach(function (note) {
            var row = h('<div class="syf-note-row"><span class="t"></span><button class="x" title="حذف">✕</button></div>');
            row.querySelector('.t').textContent = note.title || String(note.body || '').slice(0, 30) || SYFS.t('بدون عنوان');
            row.querySelector('.t').addEventListener('click', function () { editing = note.id; title.value = note.title || ''; txt.value = note.body || ''; });
            row.querySelector('.x').addEventListener('click', function () {
              if (editing === note.id) editing = null;
              update(function (arr) { var i = at(arr, note.id); if (i >= 0) arr.splice(i, 1); });
            });
            list.appendChild(row);
          });
        }
        body.querySelector('#n-save').addEventListener('click', function () {
          var n = { title: title.value.trim(), body: txt.value.trim() };
          if (!n.title && !n.body) return;
          var id = editing; editing = null;
          title.value = ''; txt.value = '';
          /* a note deleted elsewhere while open comes back as a new one — never lost */
          update(function (arr) {
            var i = id ? at(arr, id) : -1;
            if (i >= 0) { n.id = id; arr[i] = n; } else { n.id = nid(); arr.unshift(n); }
          });
        });
        body.querySelector('#n-new').addEventListener('click', function () { editing = null; title.value = ''; txt.value = ''; });
        body.querySelector('#n-pin').addEventListener('click', function () { if (SYFS.addSticky) SYFS.addSticky(txt.value); });
        function onStore(ch, area) {
          if (!body.isConnected) { chrome.storage.onChanged.removeListener(onStore); return; }
          if (area === 'local' && ch.notes) { notes = withIds(ch.notes.newValue).list; render(); }
        }
        try { chrome.storage.onChanged.addListener(onStore); } catch (e) {}
        store.get('notes', []).then(function (v) {
          var r = withIds(v); notes = r.list; render();
          if (r.added) store.set('notes', notes);          /* ids must survive a re-read */
        });
      }
    },

    /* ===== Word & character counter ===== */
    {
      id: 'counter', name: 'عدّاد الكلمات', cat: 'note',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h9M4 12h6M4 17h9"/><path d="M16 17V9l3 4 3-4v8"/></svg>',
      mount: function (body) {
        body.appendChild(h('<div class="syf-form"><textarea class="syf-in" id="c-txt" rows="5" placeholder="الصق النص هنا…"></textarea><div class="syf-out" id="c-out"></div></div>'));
        var txt = body.querySelector('#c-txt'), out = body.querySelector('#c-out');
        function upd() {
          var t = txt.value, words = (t.trim().match(/\S+/g) || []).length, chars = t.length, noSp = t.replace(/\s/g, '').length;
          var lines = t ? t.split(/\n/).length : 0, sents = (t.match(/[.!?؟।]+/g) || []).length, read = Math.ceil(words / 200);
          /* `innerHTML =` bypasses h(), so it bypasses tree() — six labels that the
             dictionary already held and nothing ever asked for (§6.101) */
          function cell(label, n) { return '<div><span>' + SYFS.t(label) + '</span><b>' + n + '</b></div>'; }
          out.innerHTML = cell('كلمات', words) + cell('أحرف', chars) +
            cell('بلا مسافات', noSp) + cell('أسطر', lines) +
            cell('جُمل', sents) + cell('دقائق قراءة', read);
        }
        txt.addEventListener('input', upd); upd();
      }
    }
  ]);

  /* ===== window chrome glyphs (v0.77.0) =====
   * These were TYPOGRAPHIC CHARACTERS — ✕ ★ ⛶ ▁ ⟳ ⤢ — while every other glyph in
   * the product is a stroked SVG at stroke-width 2 with round caps and joins.
   * That is the same mismatch the icon pass removed everywhere else, and here it
   * was worse than a mismatch: ⛶ (U+26F6) has no glyph in most Windows Arabic
   * fonts and rendered as a tofu box, and ▁ is a drawing character whose baseline
   * shifts per font — on a page that sets its own font, the window controls were
   * whatever that page happened to have.
   * Defined once here because rail.js (content script) and app.js (extension
   * pages) both draw the same window and must not drift apart.
   * `max`, `rest` and `min` all draw their RESULT rather than an instruction:
   * one window · two windows · what is left of one. */
  /* ===== الأدوات العريضة — tools that do not fit 320px (v0.139.0) =====
   * app.js has known this list since App Mode existed; the RAIL did not, so the
   * same tool opened at a usable 640px in the workspace and at 320px on a page.
   * «محرر الصور» was the clearest case: its body laid out at 430px inside a 320px
   * window whose CSS clips — the file picker and half the toolbar were not
   * narrow, they were GONE, with no scrollbar to hint that anything was missing.
   * The fact lives here, in the eager bundle both sides load, so there is one
   * list rather than two that agree until someone edits one of them.
   * ⚠️ It is a DEFAULT, not a rule: a size the user saved for a tool still wins
   * (rail.js reads `win_<id>` first), and the grip can take it anywhere. */
  SYFS.WIDE_TOOLS = {
    imgedit: 1, whiteboard: 1, imgbatch: 1, pdfcompress: 1,
    athkar: 1, wird: 1, 'sam-ai': 1, screenshot: 1, regionshot: 1, notepad: 1, money: 1
    /* not `studio` (v0.166.0): its mount sizes the window itself, wider than this 560 */
  };

  SYFS.winIcons = (function () {
    var S = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
    return {
      close: S + '<path d="M6 6l12 12M18 6 6 18"/></svg>',
      /* outline star; .syfs-win-star.on fills it — one glyph, two states */
      star:  S + '<path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z"/></svg>',
      max:   S + '<rect x="3.75" y="3.75" width="16.5" height="16.5" rx="3"/></svg>',
      rest:  S + '<rect x="3.5" y="8.5" width="12" height="11" rx="2.5"/><path d="M8 5.5h8.5A4 4 0 0 1 20.5 9.5V16"/></svg>',
      /* The window reduced to the strip it docks into. It replaces an
         arrow-landing-on-a-line, which was a defect and not a matter of taste:
         that is the universal DOWNLOAD glyph and this extension ships a real
         downloader (videodl). The button was lying about itself. */
      min:   S + '<rect x="4" y="14.5" width="16" height="5.5" rx="2"/></svg>',
      reload: S + '<path d="M20 11.5A8 8 0 1 1 17.5 6"/><path d="M20.5 3.5V8H16"/></svg>',
      camera: S + '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
      check: S + '<path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
      /* v0.149.0 — «?» on a window head: this tool's page in the usage guide */
      help:  S + '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.8"/><path d="M12 17.2h.01"/></svg>',
      popout: S + '<path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
      gear:  S + '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>'
    };
  }());

  /* ---- 📷 on a window head: shoot THAT window and put the PNG on the clipboard ----
   * One path for the rail's windows (rail.js) and the workspace's (app.js). The worker
   * shoots the sender's visible tab (SYFS_CAPTURE — no parameters, own tab only) and the
   * window's rectangle is cut out of it: real pixels, exactly what is on screen.
   * - The capture's scale is MEASURED (image width ÷ viewport width), not assumed from
   *   devicePixelRatio — page zoom makes the two differ.
   * - The data URL is decoded by hand into a Blob + createImageBitmap, never an <img>:
   *   an <img> in a content script loads under the HOST page's CSP, and a site with a
   *   strict img-src would refuse our own screenshot (same reason as §5.7/1).
   * - The blob goes into ClipboardItem as a PROMISE so the click's user activation still
   *   covers write() after the round trip to the worker.
   * - Nothing is downloaded or stored. */
  /* ---- «?» on a window head (v0.149.0): open the usage guide at THIS tool's slide ----
   * v0.150.0 — the gallery (guide.html) is gone; the guide is the slide deck, the same
   * one published as syf-guide. guide-slides(-en).html (web-accessible) open on
   * `#tool-<id>` (guide-slides.js byId). The language is a whitelist (`=== 'en'`)
   * because it picks a resource path; the id is encoded, never trusted raw. */
  SYFS.openToolGuide = function (id) {
    var page = (SYFS.i18n && SYFS.i18n.get && SYFS.i18n.get() === 'en') ? 'guide-slides-en.html' : 'guide-slides.html';
    try { window.open(chrome.runtime.getURL(page) + '#tool-' + encodeURIComponent(String(id || '')), '_blank', 'noopener'); } catch (e) { /* ignore */ }
  };

  function dataUrlBlob(u) {
    var i = u.indexOf(','), bin = atob(u.slice(i + 1)), n = bin.length, a = new Uint8Array(n);
    for (var k = 0; k < n; k++) a[k] = bin.charCodeAt(k);
    return new Blob([a], { type: 'image/png' });
  }
  SYFS.shotWin = function (win) {
    win.classList.add('syfs-shooting');         /* no hover tint on the button in the shot */
    var r = win.getBoundingClientRect();
    /* Chrome allows ~2 captureVisibleTab calls a second: a quick second 📷 (or one right
       after the full-page shot) is refused with a quota error — wait once and retry,
       the same pacing fullshot uses */
    function capture(cb, again) {
      chrome.runtime.sendMessage({ type: 'SYFS_CAPTURE' }, function (resp) {
        var le = chrome.runtime.lastError;
        if (!again && !le && resp && !resp.ok && /MAX_CAPTURE|quota|per second/i.test(resp.error || '')) {
          setTimeout(function () { capture(cb, true); }, 600); return;
        }
        cb(le, resp);
      });
    }
    var png = new Promise(function (res, rej) {
      capture(function (le, resp) {
        win.classList.remove('syfs-shooting');
        if (le || !resp || !resp.ok || !resp.url) { rej(new Error((resp && resp.error) || 'capture')); return; }
        createImageBitmap(dataUrlBlob(resp.url)).then(function (bmp) {
          var s = bmp.width / window.innerWidth;
          /* only the part of the window inside the viewport exists in the capture */
          var x0 = Math.max(0, r.left), y0 = Math.max(0, r.top);
          var x1 = Math.min(window.innerWidth, r.right), y1 = Math.min(window.innerHeight, r.bottom);
          if (x1 <= x0 || y1 <= y0) { rej(new Error('offscreen')); return; }
          var c = document.createElement('canvas');
          c.width = Math.round((x1 - x0) * s); c.height = Math.round((y1 - y0) * s);
          c.getContext('2d').drawImage(bmp, x0 * s, y0 * s, c.width, c.height, 0, 0, c.width, c.height);
          if (bmp.close) bmp.close();
          c.toBlob(function (b) { if (b) res(b); else rej(new Error('toBlob')); }, 'image/png');
        }, rej);
      });
    });
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  };
  /* the button's click: shoot, then ✓ (or ✕) on the button for a moment */
  SYFS.shotWinClick = function (win, btn) {
    var WI = SYFS.winIcons, tip = btn.title;
    btn.disabled = true;
    var p; try { p = SYFS.shotWin(win); } catch (e) { p = Promise.reject(e); }
    p.then(function () { return true; }, function () { return false; }).then(function (ok) {
      btn.innerHTML = ok ? WI.check : WI.close;
      btn.classList.add(ok ? 'ok' : 'err');
      btn.title = ok ? SYFS.t('نُسخت الصورة ✓') : SYFS.t('تعذّر التصوير');
      setTimeout(function () {
        btn.innerHTML = WI.camera; btn.classList.remove('ok'); btn.classList.remove('err');
        btn.title = tip; btn.disabled = false;
      }, 1300);
    });
  };

  /* A tool's OWN control, hung in the window head beside the window's controls.
   * A tool that wants one (the assistant's settings gear) would otherwise have to
   * reach up out of its body and edit the head itself — every tool inventing its
   * own idea of where the head is and what a control looks like. This is the one
   * way in, so the head's markup stays the window's business.
   * It appends, i.e. lands at the far end FROM the close button — a tool control
   * must never sit where a misclick costs you the window.
   * Returns null when there is no head (a tool mounted outside a window): callers
   * MUST handle that and keep their control reachable some other way, or the
   * setting silently disappears on that surface. */
  SYFS.winAction = function (body, opts) {
    var win = (body && body.closest) ? body.closest('.syfs-win') : null;
    var acts = win && win.querySelector('.syfs-win-actions');
    if (!acts || !opts) return null;
    var b = document.createElement('button');
    b.className = 'syfs-win-ctrl' + (opts.cls ? ' ' + opts.cls : '');
    b.title = opts.title || '';
    b.setAttribute('aria-label', opts.title || '');
    b.innerHTML = opts.icon || '';        /* internal, trusted SVG string — never user text */
    if (opts.onClick) b.addEventListener('click', function (e) { e.stopPropagation(); opts.onClick(b); });
    acts.appendChild(b);
    return b;
  };

  /* Category metadata (icon + label) for the rail grouping. */
  SYFS.cats = {
    calc: { label: 'حاسبات', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8"/><path d="M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8"/></svg>' },
    /* A pen writing over two lines of text — it has to cover BOTH halves of the
       name. The old serif «T» was the typographer's glyph for a typeface, said
       nothing about notes, and at 20px collapsed into three bare strokes.
       Deliberately not a notepad: the `notes` tool inside this very category
       already wears one, and a category must not copy one of its members. */
    note: { label: 'ملاحظات ونصوص', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5h11M4 11.5h7"/><path d="m19.3 9.3-8.6 8.6-3.7 1 1-3.7 8.6-8.6a1.9 1.9 0 0 1 2.7 2.7z"/></svg>' },
    /* A TOOLBOX, not a wrench (v0.77.0, replacing the user's own wrench path from
       v0.76.3 at his request in the design lab). The reason is scope: a wrench is
       ONE tool, and this category is nine unrelated ones — password, QR, speed,
       reading mode, YouTube+, autofill, the vault. A box that holds tools says
       "assorted"; a wrench says "repair", which none of these do. It also stops
       colliding with the settings/manager gear, which is the other spanner-shaped
       thing on the same bar. */
    util: { label: 'أدوات', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M8 9V6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3"/><path d="M3 13.5h18"/><path d="M10.5 13.5v2h3v-2"/></svg>' }
  };
}());
