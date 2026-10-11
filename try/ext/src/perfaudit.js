/* SYF — «فحص سرعة الموقع» (local performance + errors audit).
 * Reads the browser's own Performance API for THIS page: navigation/paint
 * timing (TTFB, FCP, LCP, CLS, DOMContentLoaded, load), a per-type resource
 * breakdown, the slowest and heaviest requests (the usual slowness causes),
 * plus a heuristic diagnosis. Errors are collected by a MAIN-world hook
 * installed when the lazy tools first load on the page — NOT at page load, so
 * load-time errors are out of reach and the panel says so (v0.139.3) —
 * (window.onerror / unhandledrejection / console.error) and
 * broken <img> are found by DOM scan. Nothing is uploaded; no new permission.
 * Loaded BEFORE src/rail.js. */
(function () {
  window.SYFS = window.SYFS || {};
  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    /* the template's own text IS the msgid — translate the built tree rather than
       splitting the markup (see src/i18n.js). Free in the default language. */
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }

  function fmtBytes(n) {
    if (!n) return '0';
    return n > 1048576 ? (n / 1048576).toFixed(2) + ' م.ب' : (n > 1024 ? Math.round(n / 1024) + ' ك.ب' : n + ' ب');
  }
  function ms(n) { return (n == null || isNaN(n) || n <= 0) ? '—' : Math.round(n) + ' مي.ث'; }
  function shortUrl(u) {
    try { var url = new URL(u); var tail = (url.pathname.split('/').pop() || url.hostname); return (tail || url.hostname).slice(0, 42); }
    catch (e) { return String(u).replace(/^https?:\/\//, '').slice(0, 42); }
  }

  /* collect LCP / CLS from the buffered performance timeline */
  function observeBuffered(type, reduce, init) {
    return new Promise(function (resolve) {
      try {
        var v = init;
        var po = new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { v = reduce(v, e); }); });
        po.observe({ type: type, buffered: true });
        setTimeout(function () { try { po.disconnect(); } catch (e) {} resolve(v); }, 60);
      } catch (e) { resolve(init); }
    });
  }

  /* read the errors captured by the main-world hook (installed in boot) */
  function readErrors() {
    var out = [];
    try {
      var nid = 'syfs-err-' + Math.random().toString(36).slice(2);
      var node = document.createElement('div'); node.id = nid; node.style.display = 'none';
      var root = document.documentElement; root.appendChild(node);
      var s = document.createElement('script');
      s.textContent = '(function(){try{var n=document.getElementById(' + JSON.stringify(nid) + ');if(n)n.textContent=window.__syfsErr?JSON.stringify(window.__syfsErr.slice(-40)):"null";}catch(e){}})();';
      root.appendChild(s); s.remove();
      try { out = JSON.parse(node.textContent || 'null'); } catch (e) {}
      node.remove();
    } catch (e) {}
    return Array.isArray(out) ? out : null;   /* null = the collector never got in (page CSP) */
  }
  function brokenImages() {
    var out = [];
    try {
      document.querySelectorAll('img').forEach(function (im) {
        if (im.complete && im.naturalWidth === 0 && (im.currentSrc || im.src)) out.push(shortUrl(im.currentSrc || im.src));
      });
    } catch (e) {}
    return out.slice(0, 20);
  }

  function analyzeResources(res) {
    var KEYS = { script: 'سكربت (JS)', css: 'أنماط (CSS)', img: 'صور', font: 'خطوط', fetch: 'طلبات (XHR/Fetch)', other: 'أخرى' };
    var byType = {}, total = 0, all = [];
    res.forEach(function (r) {
      var t = r.initiatorType;
      var key = t === 'script' ? 'script'
        : (t === 'css' || (t === 'link' && /\.css(\?|$)/i.test(r.name))) ? 'css'
        : t === 'img' ? 'img'
        : (t === 'css' ? 'css' : (/\.(woff2?|ttf|otf|eot)(\?|$)/i.test(r.name) ? 'font'
        : (t === 'xmlhttprequest' || t === 'fetch') ? 'fetch' : 'other'));
      var sz = r.transferSize || r.encodedBodySize || 0;
      byType[key] = byType[key] || { n: 0, sz: 0 };
      byType[key].n++; byType[key].sz += sz; total += sz;
      all.push({ name: shortUrl(r.name), dur: r.duration, sz: sz, type: key });
    });
    var slow = all.slice().sort(function (a, b) { return b.dur - a.dur; }).slice(0, 6);
    var big = all.slice().sort(function (a, b) { return b.sz - a.sz; }).slice(0, 5);
    return { byType: byType, KEYS: KEYS, total: total, count: res.length, slow: slow, big: big };
  }

  function diagnose(m) {
    var tips = [];
    if (m.ttfb > 600) tips.push('استجابة الخادم بطيئة (TTFB ' + Math.round(m.ttfb) + ' مي.ث) — راجع الاستضافة/الباك-إند أو فعّل الكاش.');
    if (m.fcp > 2500) tips.push('أول رسم بطيء (FCP ' + Math.round(m.fcp) + ' مي.ث) — قلّل ما يحجب العرض في الأعلى.');
    if (m.lcp > 2500) tips.push('أكبر عنصر يظهر متأخراً (LCP ' + Math.round(m.lcp) + ' مي.ث) — حسّن صورة/عنصر البطل.');
    if (m.cls > 0.1) tips.push('إزاحة تخطيط عالية (CLS ' + m.cls.toFixed(2) + ') — حدّد أبعاد الصور/الإعلانات.');
    if (m.total > 3145728) tips.push('حجم الصفحة كبير (' + fmtBytes(m.total) + ') — اضغط الأصول.');
    if (m.count > 80) tips.push('عدد الطلبات كبير (' + m.count + ') — ادمج/قلّل الملفات.');
    if (m.img > 1572864) tips.push('الصور ثقيلة (' + fmtBytes(m.img) + ') — استخدم WebP/AVIF وأحجاماً مناسبة.');
    if (m.script > 1048576) tips.push('جافاسكربت كبير (' + fmtBytes(m.script) + ') — قسّمه وأجّل غير الحرج.');
    if (m.fonts > 4) tips.push('خطوط كثيرة (' + m.fonts + ' ملفات) — قلّلها واستخدم font-display.');
    if (!tips.length) tips.push('لا مشاكل واضحة في القياس الحالي 👍');
    return tips;
  }

  SYFS.tools = SYFS.tools || [];

  /* ---- highlight an element on the host page (shared with src/dev2.js) ----
   * Scrolls it into view and draws a fixed overlay box for a moment. Our own box, not
   * the element's outline: touching the page's styles — even for a second — is what
   * the inspector's rule «read, never write» is about. */
  SYFS.flashEl = function (el) {
    try {
      if (!el || !el.getBoundingClientRect) return;
      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
      setTimeout(function () {
        var r = el.getBoundingClientRect();
        var box = document.createElement('div');
        box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;box-sizing:border-box;border:2px solid #d4423a;background:rgba(212,66,58,.14);border-radius:3px;' +
          'left:' + r.left + 'px;top:' + r.top + 'px;width:' + Math.max(4, r.width) + 'px;height:' + Math.max(4, r.height) + 'px;transition:opacity .4s';
        (document.body || document.documentElement).appendChild(box);
        setTimeout(function () { box.style.opacity = '0'; }, 1200);
        setTimeout(function () { box.remove(); }, 1700);
      }, 120);
    } catch (e) {}
  };
  function every(body, ms, fn) { var iv = setInterval(function () { if (!body.isConnected) { clearInterval(iv); return; } fn(); }, ms); fn(); return iv; }

  /* ===== Web Vitals حيّ (v0.118.0) =====
   * The audit tab gives a verdict; this one names the ELEMENT: what painted last (LCP),
   * what jumped (CLS sources), what stalled an interaction (INP target). Observers stay
   * live while the panel is open so a late shift or a slow click shows up as it happens,
   * and disconnect when the panel node leaves the document. */
  var VIT = [
    /* i18n-dyn: thresholds table — the label column is translated at the write */
    ['lcp', 'أكبر رسم (LCP)', 2500, 4000, 'ms'],
    ['cls', 'إزاحة التخطيط (CLS)', 0.1, 0.25, ''],
    ['inp', 'استجابة التفاعل (INP)', 200, 500, 'ms'],
    ['ttfb', 'أول بايت (TTFB)', 800, 1800, 'ms']
  ];
  function describeEl(el) {
    if (!el || el.nodeType !== 1) return '';
    var s = '<' + el.tagName.toLowerCase() + '>' + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    var txt = (el.getAttribute && (el.getAttribute('src') || el.getAttribute('alt') || el.getAttribute('aria-label'))) || (el.textContent || '').trim();
    return s + (txt ? '  ' + txt.replace(/\s+/g, ' ').slice(0, 50) : '');
  }
  function mountVitals(body) {
    var ui = h(
      '<div class="syf-form">' +
        '<div id="pv-grid"></div>' +
        '<div class="syf-note-hint">قياس حيّ عبر PerformanceObserver لهذه الصفحة — يتحدّث ما دامت اللوحة مفتوحة. اضغط «⌖» لإبراز العنصر المسؤول. الحدود: أخضر جيّد · برتقالي يحتاج تحسيناً · أحمر ضعيف (حدود Google). INP يحتاج تفاعلاً فعلياً (نقرة/كتابة) بعد فتح اللوحة.</div>' +
      '</div>');
    body.appendChild(ui);
    var grid = ui.querySelector('#pv-grid');
    var st = { lcp: { v: 0, el: null }, cls: { v: 0, el: null, worst: 0 }, inp: { v: 0, el: null }, ttfb: { v: 0 } };
    var cards = {};
    VIT.forEach(function (d) {
      var c = h('<div class="syf-note-row" style="flex-wrap:wrap"><span class="t" style="flex:1 1 40%"></span><b class="v" style="font-size:15px"></b><button class="syf-mini x2" type="button">⌖</button><div class="e syf-ltr-tok" style="flex:1 1 100%;font-size:11px;opacity:.75"></div></div>');
      c.querySelector('.t').textContent = SYFS.t(d[1]);
      c.querySelector('.x2').style.display = 'none';
      c.querySelector('.x2').addEventListener('click', function () { if (st[d[0]].el) SYFS.flashEl(st[d[0]].el); });
      grid.appendChild(c); cards[d[0]] = c;
    });
    function paint() {
      VIT.forEach(function (d) {
        var k = d[0], s = st[k], c = cards[k], v = s.v;
        var b = c.querySelector('.v');
        b.textContent = k === 'cls' ? v.toFixed(3) : (v ? Math.round(v) + ' ms' : '—');
        b.style.color = !v && k !== 'cls' ? '' : (v <= d[2] ? '#2e8b57' : v <= d[3] ? '#d98c1f' : '#d4423a');
        var e = c.querySelector('.e'); e.textContent = describeEl(s.el);
        c.querySelector('.x2').style.display = s.el && s.el.isConnected ? '' : 'none';
      });
    }
    var obs = [];
    function watch(type, opts, fn) {
      try { var po = new PerformanceObserver(function (l) { l.getEntries().forEach(fn); paint(); }); po.observe(Object.assign({ type: type, buffered: true }, opts || {})); obs.push(po); } catch (e) {}
    }
    watch('largest-contentful-paint', null, function (e) { if (e.startTime >= st.lcp.v) { st.lcp.v = e.startTime; st.lcp.el = e.element || st.lcp.el; } });
    watch('layout-shift', null, function (e) {
      if (e.hadRecentInput) return;
      st.cls.v += e.value || 0;
      if ((e.value || 0) > st.cls.worst) { st.cls.worst = e.value; var src = e.sources && e.sources[0]; st.cls.el = src && src.node && src.node.nodeType === 1 ? src.node : st.cls.el; }
    });
    watch('event', { durationThreshold: 16 }, function (e) { if (e.interactionId && e.duration > st.inp.v) { st.inp.v = e.duration; st.inp.el = e.target && e.target.nodeType === 1 ? e.target : st.inp.el; } });
    try { var nav = performance.getEntriesByType('navigation')[0]; if (nav) st.ttfb.v = nav.responseStart || 0; } catch (e) {}
    paint();
    every(body, 1500, function () { if (!body.isConnected) { obs.forEach(function (o) { try { o.disconnect(); } catch (e) {} }); return; } paint(); });
  }

  /* ===== الموارد (v0.118.0) =====
   * performance.getEntriesByType('resource') carries all of this and nobody reads it:
   * per-type weight, the ten slowest requests, cache hits and third-party share. A
   * verdict without the breakdown is a verdict nothing can be fixed from. */
  function mountResources(body) {
    var ui = h(
      '<div class="syf-form">' +
        '<div class="syf-row"><button class="syf-btn" id="pr-go" style="flex:1">📦 حلّل موارد الصفحة</button><button class="syf-mini" id="pr-copy">نسخ</button></div>' +
        '<div class="syf-empty" id="pr-st" style="display:none"></div>' +
        '<div id="pr-out"></div>' +
        '<div class="syf-note-hint">حجم النقل (transferSize) — صفر مع حجم مفكوك يعني «من الكاش». الطرف الثالث = مضيف غير مضيف الصفحة. الموارد عبر الأصل بلا Timing-Allow-Origin تُبلّغ حجماً صفراً وزمناً كاملاً — قيد المتصفّح لا الأداة.</div>' +
      '</div>');
    body.appendChild(ui);
    var out = ui.querySelector('#pr-out'), st = ui.querySelector('#pr-st'), lastText = '';
    function head(t) { var e = h('<div class="syf-mg-cat"><span></span></div>'); e.querySelector('span').textContent = t; out.appendChild(e); }
    function kv(k, v, warn) {
      var r = h('<div class="syf-note-row"><span class="t"></span><b></b></div>');
      r.querySelector('.t').textContent = k; r.querySelector('.t').classList.add('syf-ltr-tok'); r.querySelector('.t').style.fontSize = '12px';
      var b = r.querySelector('b'); b.textContent = v; if (warn) b.style.color = '#d4423a';
      out.appendChild(r);
    }
    ui.querySelector('#pr-go').addEventListener('click', function () {
      out.textContent = '';
      var res = performance.getEntriesByType('resource') || [];
      if (!res.length) { st.style.display = ''; st.textContent = SYFS.t('لا موارد مسجَّلة (ربّما صُفّر المخزن أو الصفحة فارغة).'); return; }
      st.style.display = 'none';
      var ra = analyzeResources(res), lines = [];
      var cached = 0, opaque = 0, third = 0, thirdSz = 0, hosts = {};
      res.forEach(function (r) {
        if (r.transferSize === 0 && r.decodedBodySize > 0) cached++;
        else if (r.transferSize === 0 && r.decodedBodySize === 0 && r.duration > 0) opaque++;
        var hh = ''; try { hh = new URL(r.name).hostname; } catch (e) {}
        if (hh && hh !== location.hostname) { third++; thirdSz += r.transferSize || 0; hosts[hh] = (hosts[hh] || 0) + 1; }
      });
      head(SYFS.t('الحجم حسب النوع ({0} طلب · {1})', ra.count, fmtBytes(ra.total)));
      Object.keys(ra.KEYS).forEach(function (k) { var tt = ra.byType[k]; if (tt && tt.n) { kv(SYFS.t(ra.KEYS[k]), tt.n + ' · ' + fmtBytes(tt.sz), false); lines.push(ra.KEYS[k] + ': ' + tt.n + ' · ' + fmtBytes(tt.sz)); } });
      head(SYFS.t('الكاش والطرف الثالث'));
      kv(SYFS.t('من الكاش'), cached + ' / ' + res.length); lines.push('cache: ' + cached + '/' + res.length);
      if (opaque) kv(SYFS.t('عبر الأصل بلا حجم (Timing-Allow-Origin)'), String(opaque));
      kv(SYFS.t('طلبات طرف ثالث'), third + ' · ' + fmtBytes(thirdSz), third > 30);
      Object.keys(hosts).map(function (k) { return [k, hosts[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8).forEach(function (p) { kv(p[0], String(p[1])); lines.push(p[0] + ': ' + p[1]); });
      head(SYFS.t('أبطأ عشرة طلبات'));
      res.slice().sort(function (a, b) { return b.duration - a.duration; }).slice(0, 10).forEach(function (r) {
        var lbl = shortUrl(r.name) + (r.initiatorType ? '  [' + r.initiatorType + ']' : '');
        kv(lbl, ms(r.duration) + (r.transferSize ? ' · ' + fmtBytes(r.transferSize) : ''), r.duration > 1500);
        lines.push(Math.round(r.duration) + 'ms  ' + r.name);
      });
      head(SYFS.t('أثقل عشرة طلبات'));
      res.slice().sort(function (a, b) { return (b.transferSize || 0) - (a.transferSize || 0); }).slice(0, 10).forEach(function (r) {
        if (!r.transferSize) return;
        kv(shortUrl(r.name), fmtBytes(r.transferSize), r.transferSize > 512 * 1024);
        lines.push(fmtBytes(r.transferSize) + '  ' + r.name);
      });
      lastText = lines.join('\n');
    });
    ui.querySelector('#pr-copy').addEventListener('click', function () { if (lastText) { try { navigator.clipboard.writeText(lastText); } catch (e) {} } });
  }

  SYFS.tools.push({
    id: 'perfaudit', name: 'فحص سرعة الموقع', cat: 'dev',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 14l4-4"/><path d="M5.6 18.5A9 9 0 1118.4 18.5"/><circle cx="12" cy="14" r="1.6"/></svg>',
    mount: function (body) {
      SYFS.tabs(body, [
        { label: 'الفحص', build: mountAudit },
        { label: 'Web Vitals حيّ', build: mountVitals },
        { label: 'الموارد', build: mountResources }
      ]);
    },
    /* main-world error collector — installed once, before the user opens the tool */
    boot: function () {
      try {
        var code = '(function(){if(window.__syfsErr)return;window.__syfsErr=[];' +
          'function push(o){try{if(window.__syfsErr.length<100)window.__syfsErr.push(o);}catch(e){}}' +
          'window.addEventListener("error",function(e){try{if(e&&e.message)push({t:"js",m:String(e.message).slice(0,200)+(e.filename?" @ "+e.filename.split("/").pop()+":"+e.lineno:"")});else if(e&&e.target&&(e.target.src||e.target.href))push({t:"res",m:String(e.target.src||e.target.href).slice(0,160)});}catch(_){}},true);' +
          'window.addEventListener("unhandledrejection",function(e){try{var r=e&&e.reason;push({t:"promise",m:String((r&&r.message)||r||"promise rejection").slice(0,200)});}catch(_){}});' +
          'var _ce=console.error;console.error=function(){try{push({t:"console",m:Array.prototype.slice.call(arguments).map(String).join(" ").slice(0,200)});}catch(_){}return _ce.apply(console,arguments);};' +
          '})();';
        var s = document.createElement('script'); s.textContent = code;
        (document.documentElement).appendChild(s); s.remove();
      } catch (e) {}
    }
  });

  /* the original one-shot audit — tab 1, unchanged */
  function mountAudit(body) {
      var ui = h(
        '<div class="syf-form">' +
          '<button class="syf-btn" id="pa-go">⚡ افحص سرعة الصفحة</button>' +
          '<div class="syf-empty" id="pa-st" style="display:none"></div>' +
          '<div id="pa-out"></div>' +
          '<div class="syf-note-hint">قياس محلي من Performance API لهذه الصفحة فقط. الأخطاء تُلتقط من أوّل فتحٍ لأدوات SYF في هذه الصفحة لا قبله — أخطاء وقت التحميل تجدها في Console بأدوات المطوّر.</div>' +
        '</div>'
      );
      body.appendChild(ui);
      var st = ui.querySelector('#pa-st'), out = ui.querySelector('#pa-out');
      function show(t) { st.style.display = ''; st.textContent = t; }
      function head(t) { var e = h('<div class="syf-mg-cat"><span></span></div>'); e.querySelector('span').textContent = t; out.appendChild(e); }
      function kv(k, v, warn) {
        var r = h('<div class="syf-note-row"><span class="t"></span><b></b></div>');
        r.querySelector('.t').textContent = k;
        var b = r.querySelector('b'); b.textContent = v; if (warn) b.style.color = '#d4423a';
        out.appendChild(r);
      }

      ui.querySelector('#pa-go').addEventListener('click', function () {
        out.innerHTML = ''; show(SYFS.t('جارٍ القياس…'));
        Promise.all([
          observeBuffered('largest-contentful-paint', function (v, e) { return e.startTime; }, 0),
          observeBuffered('layout-shift', function (v, e) { return v + (e.hadRecentInput ? 0 : (e.value || 0)); }, 0)
        ]).then(function (lc) {
          var lcp = lc[0], cls = lc[1];
          var nav = (performance.getEntriesByType('navigation') || [])[0] || {};
          var paint = performance.getEntriesByType('paint') || [];
          var fcp = (paint.filter(function (p) { return p.name === 'first-contentful-paint'; })[0] || {}).startTime;
          var res = performance.getEntriesByType('resource') || [];
          var ra = analyzeResources(res);
          var ttfb = nav.responseStart || 0;
          var m = {
            ttfb: ttfb, fcp: fcp || 0, lcp: lcp || 0, cls: cls || 0, total: ra.total, count: ra.count,
            img: (ra.byType.img || {}).sz || 0, script: (ra.byType.script || {}).sz || 0, fonts: (ra.byType.font || {}).n || 0
          };
          show('اكتمل القياس ✅');

          head('⏱ زمن التحميل');
          kv('استجابة الخادم (TTFB)', ms(ttfb), ttfb > 600);
          kv('أول رسم محتوى (FCP)', ms(fcp), fcp > 2500);
          kv('أكبر عنصر (LCP)', ms(lcp), lcp > 2500);
          kv('إزاحة التخطيط (CLS)', (cls != null ? cls.toFixed(3) : '—'), cls > 0.1);
          kv('اكتمال DOM', ms(nav.domContentLoadedEventEnd));
          kv('اكتمال التحميل (Load)', ms(nav.loadEventEnd));

          head('📦 الموارد (' + ra.count + ' طلب · ' + fmtBytes(ra.total) + ')');
          Object.keys(ra.KEYS).forEach(function (k) {
            var t = ra.byType[k]; if (t && t.n) kv(ra.KEYS[k], t.n + ' · ' + fmtBytes(t.sz));
          });

          head('🐌 أبطأ الموارد (أسباب البطء)');
          ra.slow.forEach(function (r) { kv(r.name, ms(r.dur) + (r.sz ? ' · ' + fmtBytes(r.sz) : '')); });

          head('⚖ أثقل الموارد');
          ra.big.forEach(function (r) { kv(r.name, fmtBytes(r.sz)); });

          var errs = readErrors(), broken = brokenImages(), noHook = !errs;
          if (noHook) errs = [];
          head('🐞 الأخطاء (' + (errs.length + broken.length) + ')');
          if (noHook) kv('ملتقط الأخطاء ممنوع في هذه الصفحة (سياسة أمان الموقع) — راجع Console في أدوات المطوّر', '—', true);
          else if (!errs.length && !broken.length) { kv('لا أخطاء مُلتقَطة', '✓'); }
          /* «تحميل» alone is already a msgid meaning Download elsewhere; a badge on a
             failed asset is a different word in English (§6.97/6 — fix the source, do
             not invent a context). */
          var LBL = { js: 'JS', promise: 'Promise', console: 'Console', res: 'تحميل مورد' };
          errs.slice(0, 20).forEach(function (e) {
            var r = h('<div class="syf-note-row"><span class="t syf-ltr-tok" style="font-size:11px"></span><b></b></div>');
            /* e.m is the page's own error text — never translated, never trusted. */
            r.querySelector('.t').textContent = e.m; r.querySelector('b').textContent = LBL[e.t] ? SYFS.t(LBL[e.t]) : e.t; r.querySelector('b').style.color = '#d4423a';
            out.appendChild(r);
          });
          broken.forEach(function (u) {
            var r = h('<div class="syf-note-row"><span class="t syf-ltr-tok" style="font-size:11px"></span><b></b></div>');
            r.querySelector('.t').textContent = u; r.querySelector('b').textContent = SYFS.t('صورة'); r.querySelector('b').style.color = '#d4423a';
            out.appendChild(r);
          });

          head('💡 التشخيص والتوصيات');
          diagnose(m).forEach(function (t) {
            var r = h('<div class="syf-note-hint" style="padding:4px 2px"></div>'); r.textContent = '• ' + t; out.appendChild(r);
          });
        });
      });
  }
}());
