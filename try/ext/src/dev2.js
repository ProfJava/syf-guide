/* SYF — developer tools, second file (dev category, v0.118.0).
 * Five more tools, all local and MV3-safe (no eval, no new permission, nothing stored):
 *   devpage    · فحوص الصفحة       → tabs: الوصولية · الروابط · CSP
 *   devnet     · طلبات وترويسات    → tabs: مُرسِل طلبات (page origin ONLY) · User-Agent وترويسات (DNR session rule, worker-owned)
 *   devconvert · محوّلات المطوّرين → tabs: cURL ⇄ fetch/axios · YAML ⇄ JSON · .env ⇄ JSON
 *   devregex   · مختبر Regex       → runs in a Worker with a timeout (ReDoS guard)
 *   devlogs    · محلّل السجلّات     → nginx/Apache access logs, parsed in chunks
 *
 * Why a second file and not more of src/dev.js: that file is already the biggest tool
 * file after media.js, and tools/fakedata-test.js lifts functions out of it by name —
 * every addition there is a chance to shadow one. The pure parsers here (yamlParse,
 * yamlEmit, envParse, envEmit, curlParse, logParse) are lifted by tools/dev2-test.js.
 *
 * Security: every user/page-derived value is written via textContent/value only. The
 * request sender and the link checker fetch from the PAGE'S OWN ORIGIN ONLY — sending
 * to any other host would turn the extension into a proxy, which the nine-host relay
 * rule (§5.26/1) exists to prevent. Loaded BEFORE src/rail.js, lazily. Both editions. */
(function () {
  window.SYFS = window.SYFS || {};
  SYFS.tools = SYFS.tools || [];

  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }
  function t() { return SYFS.t ? SYFS.t.apply(null, arguments) : arguments[0]; }
  function copy(text) { try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (e) {} }
  function every(body, ms, fn) { var iv = setInterval(function () { if (!body.isConnected) { clearInterval(iv); return; } fn(); }, ms); fn(); return iv; }
  var MONO = 'direction:ltr;text-align:left;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px';
  var PRE = 'white-space:pre-wrap;word-break:break-word;overflow:auto;max-height:300px;' + MONO;
  function fmtBytes(n) { if (!n) return '0'; return n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'); }
  function ourHost() { return document.getElementById('syfs-host'); }
  function isOurs(el) { var host = ourHost(); return !!host && (el === host || host.contains(el)); }
  function status(el, msg, bad) { el.style.display = ''; el.textContent = msg; el.style.color = bad ? '#c0392b' : ''; }
  function row(label, value, warn) {
    var r = h('<div class="syf-note-row"><span class="t"></span><b></b></div>');
    r.querySelector('.t').textContent = label;
    var b = r.querySelector('b'); b.textContent = value; if (warn) b.style.color = '#d4423a';
    return r;
  }
  function head(text) { var e = h('<div class="syf-mg-cat"><span></span></div>'); e.querySelector('span').textContent = text; return e; }
  function flash(el) { if (SYFS.flashEl) SYFS.flashEl(el); }
  function visible(el) {
    if (!el.getClientRects || !el.getClientRects().length) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.05;
  }

  /* ======================================================================
   * 1) فحوص الصفحة — accessibility · links · CSP
   * ==================================================================== */

  /* ---- colour maths shared by the a11y tab (contrast) ---- */
  function parseRgb(s) {
    var m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/.exec(s || '');
    if (!m) return null;
    return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  }
  function lum(rgb) {
    var a = rgb.slice(0, 3).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  function ratio(fg, bg) { var l1 = lum(fg), l2 = lum(bg); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
  /* the background a text sits on: walk up until something opaque is painted */
  function effectiveBg(el) {
    var cur = el, acc = null;
    while (cur && cur.nodeType === 1) {
      var c = parseRgb(getComputedStyle(cur).backgroundColor);
      if (c && c[3] > 0) {
        if (!acc) acc = c;
        else { var a = acc[3]; acc = [acc[0] * a + c[0] * (1 - a), acc[1] * a + c[1] * (1 - a), acc[2] * a + c[2] * (1 - a), Math.min(1, a + c[3] * (1 - a))]; }
        if (acc[3] >= 0.99) return acc;
      }
      cur = cur.parentElement;
    }
    var w = [255, 255, 255, 1];
    if (!acc) return w;
    var k = acc[3];
    return [acc[0] * k + 255 * (1 - k), acc[1] * k + 255 * (1 - k), acc[2] * k + 255 * (1 - k), 1];
  }

  var A11Y_CAP = 2500;
  function a11yScan() {
    var findings = [];   /* {key, label, els:[], hint} */
    function add(key, label, el, hint) {
      var f = findings.filter(function (x) { return x.key === key; })[0];
      if (!f) { f = { key: key, label: label, els: [], hint: hint }; findings.push(f); }
      if (f.els.length < 200) f.els.push(el);
    }
    var all = document.querySelectorAll('body *'), n = Math.min(all.length, A11Y_CAP), i, el;
    var lastH = 0, h1s = 0, textSeen = 0;
    for (i = 0; i < n; i++) {
      el = all[i];
      if (isOurs(el)) continue;
      var tag = el.tagName.toLowerCase();
      if (tag === 'img') {
        if (!el.hasAttribute('alt') && visible(el)) add('img-alt', 'صور بلا بديل نصّي (alt)', el, 'أضف alt يصف الصورة، أو alt="" إن كانت زخرفية.');
      } else if (/^h[1-6]$/.test(tag)) {
        var lvl = +tag.charAt(1);
        if (lvl === 1) h1s++;
        if (lastH && lvl > lastH + 1) add('h-skip', 'قفز في ترتيب العناوين', el, 'العنوان يقفز مستوى (مثلاً h2 → h4). التسلسل يجب أن يكون متدرّجاً.');
        lastH = lvl;
      } else if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        var type = (el.getAttribute('type') || 'text').toLowerCase();
        if (type !== 'hidden' && type !== 'submit' && type !== 'button' && type !== 'reset' && type !== 'image' && visible(el)) {
          var labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || el.closest('label') ||
            (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'));
          if (!labelled) add('no-label', 'حقول بلا تسمية', el, 'اربط «label for» أو أضف aria-label — قارئ الشاشة يقرأ الحقل بلا اسم.');
        }
      } else if (tag === 'a') {
        if (el.hasAttribute('href') && visible(el)) {
          var name = (el.textContent || '').trim() || el.getAttribute('aria-label') || el.getAttribute('title') || (el.querySelector('img[alt]') && el.querySelector('img[alt]').alt);
          if (!name) add('a-name', 'روابط بلا اسم مقروء', el, 'رابط من أيقونة وحدها يحتاج aria-label أو نصّاً.');
        }
      } else if (tag === 'button') {
        if (visible(el) && !((el.textContent || '').trim() || el.getAttribute('aria-label') || el.getAttribute('title') || (el.querySelector('img[alt]') && el.querySelector('img[alt]').alt)))
          add('btn-name', 'أزرار بلا اسم مقروء', el, 'زرّ من أيقونة وحدها يحتاج aria-label.');
      } else if (tag === 'iframe') {
        if (!el.getAttribute('title')) add('iframe-title', 'إطارات بلا title', el, 'كل iframe يحتاج title يصف محتواه.');
      }
      var ti = el.getAttribute('tabindex');
      if (ti && +ti > 0) add('tabindex', 'tabindex موجب', el, 'tabindex أكبر من صفر يكسر ترتيب التنقّل الطبيعي بالكيبورد. استعمل 0 أو -1.');
      /* contrast — sample text-bearing leaf-ish elements only */
      if (textSeen < 1200 && visible(el)) {
        var hasText = false;
        for (var c = el.firstChild; c; c = c.nextSibling) { if (c.nodeType === 3 && c.nodeValue.trim().length > 1) { hasText = true; break; } }
        if (hasText) {
          textSeen++;
          var cs = getComputedStyle(el), fg = parseRgb(cs.color);
          if (fg && fg[3] > 0.1) {
            var bg = effectiveBg(el), r = ratio(fg, bg);
            var size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
            var large = size >= 24 || (size >= 18.66 && bold);
            if (r < (large ? 3 : 4.5)) add('contrast', 'تباين ضعيف (أقلّ من AA)', el, 'النسبة المطلوبة 4.5:1 للنصّ العادي و3:1 للكبير. جرّب «تباين WCAG» في ملتقط الألوان لاقتراح لون.');
          }
        }
      }
    }
    if (h1s === 0) add('no-h1', 'لا يوجد h1 في الصفحة', document.body, 'صفحة بلا h1 هي صفحة بلا عنوان رئيسي لقارئ الشاشة.');
    if (h1s > 1) add('many-h1', 'أكثر من h1 واحد', document.body, 'عادةً h1 واحد لكل صفحة.');
    if (!document.documentElement.getAttribute('lang')) add('no-lang', 'الجذر html بلا سمة lang', document.documentElement, 'أضف lang="ar" (أو لغة الصفحة) — يحدّد نطق قارئ الشاشة.');
    var vp = document.querySelector('meta[name="viewport"]');
    if (vp && /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(vp.getAttribute('content') || '')) add('no-zoom', 'التكبير ممنوع في viewport', vp, 'user-scalable=no يمنع ضعاف البصر من التكبير. احذفه.');
    return { findings: findings, scanned: n, total: all.length, capped: all.length > A11Y_CAP };
  }

  function mountA11y(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<button class="syf-btn" id="ay-go">♿ افحص وصولية هذه الصفحة</button>' +
        '<div class="syf-empty" id="ay-st" style="display:none"></div>' +
        '<div id="ay-out"></div>' +
        '<div class="syf-note-hint">فحص محلّي بقراءة DOM فقط: صور بلا alt · ترتيب العناوين · حقول بلا تسمية · روابط وأزرار بلا اسم · تباين النصّ · tabindex · lang · التكبير. انقر أي نتيجة لإبراز العنصر في الصفحة.</div>' +
      '</div>'));
    var st = body.querySelector('#ay-st'), out = body.querySelector('#ay-out');
    body.querySelector('#ay-go').addEventListener('click', function () {
      out.textContent = '';
      var r = a11yScan();
      var total = r.findings.reduce(function (s, f) { return s + f.els.length; }, 0);
      status(st, r.capped ? t('{0} ملاحظة — فُحص أول {1} عنصر من {2}.', total, A11Y_CAP, r.total) : (total ? t('{0} ملاحظة في {1} عنصراً.', total, r.scanned) : t('لا ملاحظات ✓ — فُحص {0} عنصراً.', r.scanned)), false);
      r.findings.forEach(function (f) {
        var sec = h('<div style="margin-top:8px"><div class="syf-mg-cat"><span></span><b style="margin-inline-start:auto;font-size:12px"></b></div><div class="syf-note-hint"></div><div class="syf-note-list"></div></div>');
        sec.querySelector('span').textContent = t(f.label);            /* i18n-dyn: labels are msgids passed through t() */
        sec.querySelector('b').textContent = f.els.length;
        sec.querySelector('.syf-note-hint').textContent = t(f.hint);   /* i18n-dyn: hints are msgids passed through t() */
        var list = sec.querySelector('.syf-note-list');
        f.els.slice(0, 12).forEach(function (el) {
          var desc = '<' + el.tagName.toLowerCase() + '>' + (el.id ? '#' + el.id : '') + ' ' + ((el.textContent || el.getAttribute('src') || el.getAttribute('href') || '').trim().replace(/\s+/g, ' ').slice(0, 60));
          var rr = row(desc, '⌖');
          rr.querySelector('.t').classList.add('syf-ltr-tok');
          rr.style.cursor = 'pointer';
          rr.addEventListener('click', function () { flash(el); });
          list.appendChild(rr);
        });
        if (f.els.length > 12) { var more = h('<div class="syf-empty"></div>'); more.textContent = t('… و{0} أخرى', f.els.length - 12); list.appendChild(more); }
        out.appendChild(sec);
      });
    });
  }

  /* ---- link checker: same origin only, batched, with a stop button ---- */
  var LINK_CAP = 300, LINK_BATCH = 4, LINK_TIMEOUT = 8000;
  function mountLinks(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<div class="syf-row"><button class="syf-btn" id="lk-go" style="flex:1">🔗 افحص روابط الصفحة</button><button class="syf-mini" id="lk-stop" disabled>إيقاف</button></div>' +
        '<div class="syf-out" id="lk-sum" style="display:none;grid-template-columns:1fr 1fr 1fr 1fr"><div><span>فُحص</span><b id="lk-n">0</b></div><div><span>مكسور</span><b id="lk-bad">0</b></div><div><span>تحويل</span><b id="lk-redir">0</b></div><div><span>بطيء</span><b id="lk-slow">0</b></div></div>' +
        '<div class="syf-empty" id="lk-st" style="display:none"></div>' +
        '<div class="syf-note-list" id="lk-out"></div>' +
        '<div class="syf-note-hint">يفحص روابط نفس الأصل فقط (من سياق الصفحة، بجلستك — فيعمل على localhost وخلف تسجيل الدخول). الروابط الخارجية تُعدّ ولا تُفحص: طلبٌ إليها من هنا يجعل الإضافة وسيطاً. «بطيء» = أكثر من ثانيتين.</div>' +
      '</div>'));
    var st = body.querySelector('#lk-st'), out = body.querySelector('#lk-out'), sum = body.querySelector('#lk-sum');
    var goBtn = body.querySelector('#lk-go'), stopBtn = body.querySelector('#lk-stop');
    var running = false, ctrl = null;
    function collect() {
      var seen = Object.create(null), same = [], ext = 0;
      document.querySelectorAll('a[href]').forEach(function (a) {
        if (isOurs(a)) return;
        var u; try { u = new URL(a.getAttribute('href'), location.href); } catch (e) { return; }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
        u.hash = '';
        if (u.origin !== location.origin) { ext++; return; }
        if (seen[u.href]) return; seen[u.href] = 1;
        same.push({ url: u.href, el: a });
      });
      return { same: same, ext: ext };
    }
    function check(item) {
      var t0 = performance.now();
      /* ⚠️ one controller PER LINK, chained to the run's (v0.139.2). The timeout used to
         abort the run-wide controller, so one slow link at #5 aborted every request in
         flight and every later one: ~300 links reported «timeout». «إيقاف» still stops
         them all through the chain. */
      var ac = new AbortController(), run = ctrl;
      var onStop = function () { try { ac.abort(); } catch (e) {} };
      if (run) { if (run.signal.aborted) onStop(); else run.signal.addEventListener('abort', onStop); }
      var timer = setTimeout(onStop, LINK_TIMEOUT);
      function unhook() { clearTimeout(timer); if (run) run.signal.removeEventListener('abort', onStop); }
      function done(res) { unhook(); return { status: res.status, type: res.type, ms: performance.now() - t0 }; }
      return fetch(item.url, { method: 'HEAD', redirect: 'manual', signal: ac.signal, cache: 'no-store' })
        .then(function (res) {
          if (res.status === 405 || res.status === 501) return fetch(item.url, { method: 'GET', redirect: 'manual', signal: ac.signal, cache: 'no-store' }).then(done);
          return done(res);
        })
        .catch(function (e) { unhook(); return { status: 0, type: 'error', ms: performance.now() - t0, err: e && e.name }; });
    }
    function finish(msg) { running = false; goBtn.disabled = false; stopBtn.disabled = true; if (msg) status(st, msg); }
    goBtn.addEventListener('click', function () {
      if (running) return;
      var c = collect();
      out.textContent = ''; sum.style.display = '';
      ['n', 'bad', 'redir', 'slow'].forEach(function (k) { body.querySelector('#lk-' + k).textContent = '0'; });
      if (!c.same.length) { status(st, t('لا روابط من نفس الأصل في هذه الصفحة ({0} رابط خارجي).', c.ext)); return; }
      var list = c.same.slice(0, LINK_CAP);
      status(st, list.length < c.same.length ? t('يُفحص أول {0} رابط من {1} (+{2} خارجي)…', LINK_CAP, c.same.length, c.ext) : t('يُفحص {0} رابط (+{1} خارجي لا يُفحص)…', list.length, c.ext));
      running = true; goBtn.disabled = true; stopBtn.disabled = false;
      ctrl = new AbortController();
      var i = 0, n = 0, bad = 0, redir = 0, slow = 0;
      function report(item, r) {
        n++;
        var isBad = r.status >= 400 || r.status === 0 && r.type === 'error';
        var isRedir = r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400);
        var isSlow = r.ms > 2000;
        if (isBad) bad++; if (isRedir) redir++; if (isSlow) slow++;
        body.querySelector('#lk-n').textContent = n; body.querySelector('#lk-bad').textContent = bad;
        body.querySelector('#lk-redir').textContent = redir; body.querySelector('#lk-slow').textContent = slow;
        if (!isBad && !isRedir && !isSlow) return;
        var label = isBad ? (r.status ? String(r.status) : (r.err === 'AbortError' ? t('مهلة') : t('فشل'))) : (isRedir ? (r.status ? String(r.status) : t('تحويل')) : Math.round(r.ms) + ' ms');
        var rr = row(item.url.replace(location.origin, '') || '/', label, isBad);
        rr.querySelector('.t').classList.add('syf-ltr-tok');
        rr.style.cursor = 'pointer';
        rr.addEventListener('click', function () { flash(item.el); });
        out.appendChild(rr);
      }
      function next() {
        if (!running) return;
        if (i >= list.length) { finish(t('اكتمل: {0} رابط · {1} مكسور · {2} تحويل · {3} بطيء.', n, bad, redir, slow)); return; }
        var batch = list.slice(i, i + LINK_BATCH); i += LINK_BATCH;
        Promise.all(batch.map(function (it) { return check(it).then(function (r) { if (running) report(it, r); }); })).then(function () {
          if (body.isConnected) setTimeout(next, 0); else running = false;
        });
      }
      next();
    });
    stopBtn.addEventListener('click', function () { if (!running) return; running = false; try { ctrl.abort(); } catch (e) {} finish(t('أُوقف الفحص.')); });
  }

  /* ---- CSP violation monitor ----
   * `securitypolicyviolation` is a DOM event: the isolated world hears it. The event
   * carries `originalPolicy` — the REAL enforced policy, header or meta — which is the
   * only way a content script ever sees a header CSP. Recording starts when this file
   * is injected (the tool's boot hook), so the panel says so. */
  var CSP_LOG = [], CSP_CAP = 200, cspPolicy = '';
  function cspBoot() {
    if (cspBoot.done) return; cspBoot.done = true;
    try {
      document.addEventListener('securitypolicyviolation', function (e) {
        try {
          if (!cspPolicy && e.originalPolicy) cspPolicy = String(e.originalPolicy).slice(0, 4000);
          if (CSP_LOG.length >= CSP_CAP) return;
          CSP_LOG.push({
            at: Date.now(), uri: String(e.blockedURI || '').slice(0, 300), dir: String(e.effectiveDirective || e.violatedDirective || '').slice(0, 80),
            disp: e.disposition || 'enforce', src: e.sourceFile ? String(e.sourceFile).split('/').pop().slice(0, 80) + (e.lineNumber ? ':' + e.lineNumber : '') : ''
          });
        } catch (x) {}
      }, true);
    } catch (e) {}
  }
  function mountCsp(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<div class="syf-out" style="grid-template-columns:1fr 1fr"><div><span>انتهاكات مُلتقَطة</span><b id="cp-n">0</b></div><div><span>وضع السياسة</span><b id="cp-mode">—</b></div></div>' +
        '<div class="syf-row"><button class="syf-mini" id="cp-refresh">تحديث</button><button class="syf-mini" id="cp-clear">مسح</button><button class="syf-mini" id="cp-copy">نسخ السياسة</button></div>' +
        '<div class="syf-note-hint" id="cp-src"></div>' +
        '<pre class="syf-out syf-pre" id="cp-pol" style="display:block;max-height:160px"></pre>' +
        '<div class="syf-note-list" id="cp-out"></div>' +
        '<div class="syf-note-hint">تُلتقط أحداث securitypolicyviolation من لحظة تحميل أدوات الشريط في هذه الصفحة — لالتقاط انتهاكات التحميل الأولى: افتح الشريط ثم أعد تحميل الصفحة. السياسة المعروضة هي ما يبلّغه المتصفّح في الحدث أو ما تُصرّح به &lt;meta&gt; — ترويسة CSP لا تُقرأ مباشرةً بلا صلاحية تصحيح.</div>' +
      '</div>'));
    var out = body.querySelector('#cp-out'), pol = body.querySelector('#cp-pol');
    function metaPolicy() {
      var m = document.querySelector('meta[http-equiv="Content-Security-Policy" i]');
      return m ? (m.getAttribute('content') || '') : '';
    }
    function render() {
      body.querySelector('#cp-n').textContent = CSP_LOG.length;
      var meta = metaPolicy(), p = cspPolicy || meta;
      body.querySelector('#cp-src').textContent = cspPolicy ? t('السياسة من حدث انتهاك (الترويسة الفعلية أو meta).') : (meta ? t('السياسة من وسم meta في الصفحة (لا انتهاك بعد).') : t('لا سياسة معروفة بعد: لا وسم meta ولا انتهاك مُلتقَط.'));
      pol.textContent = p ? p.split(';').map(function (s) { return s.trim(); }).filter(Boolean).join(';\n') : '—';
      var ro = CSP_LOG.some(function (v) { return v.disp === 'report'; }), en = CSP_LOG.some(function (v) { return v.disp === 'enforce'; });
      body.querySelector('#cp-mode').textContent = en && ro ? t('فرض + تبليغ') : en ? t('فرض') : ro ? t('تبليغ فقط') : '—';
      out.textContent = '';
      CSP_LOG.slice().reverse().slice(0, 60).forEach(function (v) {
        var rr = row((v.uri || 'inline') + (v.src ? '  ←  ' + v.src : ''), v.dir, v.disp === 'enforce');
        rr.querySelector('.t').classList.add('syf-ltr-tok'); rr.querySelector('.t').style.fontSize = '11px';
        rr.querySelector('b').classList.add('syf-ltr-tok'); rr.querySelector('b').style.fontSize = '11px';
        out.appendChild(rr);
      });
      if (!CSP_LOG.length) { var e = h('<div class="syf-empty">لا انتهاكات مُلتقَطة حتى الآن.</div>'); out.appendChild(e); }
    }
    body.querySelector('#cp-refresh').addEventListener('click', render);
    body.querySelector('#cp-clear').addEventListener('click', function () { CSP_LOG.length = 0; render(); });
    body.querySelector('#cp-copy').addEventListener('click', function () { if (pol.textContent && pol.textContent !== '—') copy(pol.textContent); });
    every(body, 2000, render);
  }

  SYFS.tools.push({
    id: 'devpage', name: 'فحوص الصفحة', cat: 'dev',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="m8 14 2 2 4-4"/></svg>',
    boot: cspBoot,
    mount: function (body) {
      SYFS.tabs(body, [
        { label: 'الوصولية', build: mountA11y },
        { label: 'الروابط', build: mountLinks },
        { label: 'CSP', build: mountCsp }
      ]);
    }
  });

  /* ======================================================================
   * 2) طلبات وترويسات — request sender (page origin only) · UA/header override
   * ==================================================================== */
  var HDR_NAME = /^[A-Za-z0-9-]{1,64}$/;
  function parseHeaders(text) {
    var out = [], bad = [];
    String(text || '').split('\n').forEach(function (line) {
      line = line.trim(); if (!line) return;
      var i = line.indexOf(':');
      var name = i > 0 ? line.slice(0, i).trim() : '', val = i > 0 ? line.slice(i + 1).trim() : '';
      if (!HDR_NAME.test(name)) { bad.push(line.slice(0, 40)); return; }
      out.push([name, val.slice(0, 2048)]);
    });
    return { headers: out, bad: bad };
  }
  function hasCredential(headers) {
    return headers.some(function (hd) { return /^(authorization|cookie|proxy-authorization|x-api-key)$/i.test(hd[0]); });
  }

  function mountReq(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<div class="syf-row"><select class="syf-in" id="rq-m" style="width:110px;direction:ltr"><option value="GET">GET</option><option value="POST">POST</option><option value="PUT">PUT</option><option value="PATCH">PATCH</option><option value="DELETE">DELETE</option><option value="HEAD">HEAD</option><option value="OPTIONS">OPTIONS</option></select>' +
        '<input class="syf-in" id="rq-u" placeholder="/api/… (مسار على نفس الأصل)" style="flex:1;direction:ltr"></div>' +
        '<textarea class="syf-in syf-mono" id="rq-h" rows="3" placeholder="ترويسات — سطر لكل واحدة: Content-Type: application/json"></textarea>' +
        '<textarea class="syf-in syf-mono" id="rq-b" rows="4" placeholder="الجسم (لغير GET/HEAD)"></textarea>' +
        '<div class="syf-row"><button class="syf-btn" id="rq-go" style="flex:1">إرسال</button><button class="syf-mini" id="rq-curl">نسخ كـcURL</button></div>' +
        '<div class="syf-empty" id="rq-st" style="display:none"></div>' +
        '<div id="rq-res" style="display:none">' +
          '<div class="syf-out" style="grid-template-columns:1fr 1fr 1fr"><div><span>الحالة</span><b id="rq-code">—</b></div><div><span>الزمن</span><b id="rq-ms">—</b></div><div><span>الحجم</span><b id="rq-sz">—</b></div></div>' +
          '<div class="syf-note-hint">ترويسات الاستجابة</div><pre class="syf-out syf-pre" id="rq-rh" style="display:block;max-height:140px"></pre>' +
          '<div class="syf-row"><div class="syf-note-hint" style="flex:1">الجسم</div><button class="syf-mini" id="rq-copy">نسخ</button></div><pre class="syf-out syf-pre" id="rq-rb" style="display:block"></pre>' +
        '</div>' +
        '<div class="syf-note-hint">يُرسَل من أصل هذه الصفحة بجلستها وكوكيزها — لاختبار API وأنت مسجّل الدخول. عنوان على مضيف آخر يُرفض: الإضافة ليست وسيطاً (§5.26). لا يُحفظ شيء ممّا تكتبه.</div>' +
      '</div>'));
    var st = body.querySelector('#rq-st'), res = body.querySelector('#rq-res');
    var pageOrigin = location.origin;
    function resolveUrl(raw) {
      raw = String(raw || '').trim();
      if (!raw) return { err: t('اكتب مساراً أو عنواناً.') };
      var u; try { u = new URL(raw, location.href); } catch (e) { return { err: t('عنوان غير صالح.') }; }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return { err: t('http/https فقط.') };
      if (u.origin !== pageOrigin) return { err: t('مضيف آخر ({0}) — يُسمح بأصل الصفحة فقط: {1}', u.host, pageOrigin) };
      return { url: u.href };
    }
    function build() {
      var r = resolveUrl(body.querySelector('#rq-u').value);
      if (r.err) return r;
      var ph = parseHeaders(body.querySelector('#rq-h').value);
      if (ph.bad.length) return { err: t('ترويسة غير صالحة: {0}', ph.bad[0]) };
      var m = body.querySelector('#rq-m').value, b = body.querySelector('#rq-b').value;
      return { url: r.url, method: m, headers: ph.headers, body: (m === 'GET' || m === 'HEAD') ? null : b };
    }
    body.querySelector('#rq-curl').addEventListener('click', function () {
      var q = build(); if (q.err) { status(st, q.err, true); return; }
      var parts = [curlVerb(q.method)];
      q.headers.forEach(function (hd) { parts.push("-H '" + (hd[0] + ': ' + hd[1]).replace(/'/g, "'\\''") + "'"); });
      if (q.body) parts.push("--data-raw '" + q.body.replace(/'/g, "'\\''") + "'");
      parts.push("'" + q.url + "'");
      copy(parts.join(' \\\n  ')); status(st, t('نُسِخ أمر cURL ✓'));
    });
    body.querySelector('#rq-copy').addEventListener('click', function () { var v = body.querySelector('#rq-rb').textContent; if (v) copy(v); });
    body.querySelector('#rq-go').addEventListener('click', function () {
      var q = build(); if (q.err) { status(st, q.err, true); return; }
      if (hasCredential(q.headers)) status(st, t('تنبيه: الطلب يحمل ترويسة اعتماد — تُرسَل إلى أصل الصفحة فقط ولا تُخزَّن.'));
      else status(st, t('جارٍ الإرسال…'));
      res.style.display = 'none';
      var hdr = {}; q.headers.forEach(function (hd) { hdr[hd[0]] = hd[1]; });
      var t0 = performance.now(), ac = new AbortController(), timer = setTimeout(function () { ac.abort(); }, 30000);
      var init = { method: q.method, headers: hdr, credentials: 'same-origin', signal: ac.signal, cache: 'no-store' };
      if (q.body) init.body = q.body;
      fetch(q.url, init).then(function (r) {
        var ms = Math.round(performance.now() - t0);
        var lines = []; r.headers.forEach(function (v, k) { lines.push(k + ': ' + v); });
        var ct = r.headers.get('content-type') || '';
        return r.text().then(function (txt) {
          clearTimeout(timer);
          body.querySelector('#rq-code').textContent = r.status + (r.statusText ? ' ' + r.statusText : '');
          body.querySelector('#rq-code').style.color = r.status >= 400 ? '#d4423a' : '';
          body.querySelector('#rq-ms').textContent = ms + ' ms';
          body.querySelector('#rq-sz').textContent = fmtBytes(new Blob([txt]).size);
          body.querySelector('#rq-rh').textContent = lines.join('\n') || '—';
          var shown = txt.length > 200000 ? txt.slice(0, 200000) + '\n… (' + t('قُصّ العرض') + ')' : txt;
          if (/json/i.test(ct)) { try { shown = JSON.stringify(JSON.parse(txt), null, 2); } catch (e) {} }
          body.querySelector('#rq-rb').textContent = shown || '—';
          res.style.display = '';
          status(st, t('تمّ ✓'));
        });
      }).catch(function (e) { clearTimeout(timer); status(st, e && e.name === 'AbortError' ? t('انتهت المهلة (30 ث).') : t('فشل الطلب: {0}', (e && e.message) || ''), true); });
    });
  }

  /* ---- User-Agent / header override for THIS tab (DNR session rule in the worker) ---- */
  /* i18n-skip-start: User-Agent strings are protocol values, not interface text */
  var UA_PRESETS = [
    ['', ''],
    ['iphone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'],
    ['android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'],
    ['ipad', 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'],
    ['googlebot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/126.0.0.0 Safari/537.36'],
    ['bingbot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/126.0.0.0 Safari/537.36'],
    ['firefox', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0'],
    ['safari', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'],
    ['custom', '']
  ];
  /* i18n-skip-end */
  function uaMsg(payload, cb) {
    var done = false;
    function fin(r) { if (done) return; done = true; cb(r || { ok: false }); }
    try { chrome.runtime.sendMessage(Object.assign({ type: 'SYFS_UA' }, payload), function (r) { void chrome.runtime.lastError; fin(r); }); } catch (e) { fin(); }
    setTimeout(function () { fin({ ok: false, timeout: true }); }, 2500);
  }
  function mountUa(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<div class="syf-out" style="grid-template-columns:1fr"><div><span>الحالة في هذا التبويب</span><b id="ua-state">…</b></div></div>' +
        '<label>User-Agent</label>' +
        '<select class="syf-in" id="ua-preset" disabled>' +
          '<option value="">— بلا تغيير —</option><option value="iphone">iPhone (Safari)</option><option value="android">Android (Chrome)</option><option value="ipad">iPad (Safari)</option>' +
          '<option value="googlebot">Googlebot</option><option value="bingbot">Bingbot</option><option value="firefox">Firefox (Windows)</option><option value="safari">Safari (Mac)</option><option value="custom">مخصّص…</option>' +
        '</select>' +
        '<textarea class="syf-in syf-mono" id="ua-custom" rows="2" placeholder="User-Agent مخصّص" style="display:none"></textarea>' +
        '<label>ترويسات إضافية (حتى 5 — سطر لكل واحدة)</label>' +
        '<textarea class="syf-in syf-mono" id="ua-h" rows="3" placeholder="X-Test: 1&#10;Accept-Language: en" disabled></textarea>' +
        '<div class="syf-row"><button class="syf-btn" id="ua-apply" style="flex:1" disabled>تطبيق على هذا التبويب</button><button class="syf-mini" id="ua-off" disabled>إيقاف</button></div>' +
        '<div class="syf-empty" id="ua-st" style="display:none"></div>' +
        '<div class="syf-note-hint">قاعدة declarativeNetRequest لهذا التبويب وحده، عمرها في العامل (تسقط بإغلاق التبويب أو بزرّ الإيقاف) وشارة UA على أيقونة الإضافة ما دامت فعّالة. تغيّر الترويسة فقط — navigator.userAgent في JS لا يتغيّر. حدّث الصفحة بعد التطبيق. لا تُقبل ترويسات الاعتماد (Authorization/Cookie): تُرسَل لكل مضيف يطلبه التبويب.</div>' +
      '</div>'));
    var st = body.querySelector('#ua-st'), state = body.querySelector('#ua-state');
    var preset = body.querySelector('#ua-preset'), custom = body.querySelector('#ua-custom'), hdrs = body.querySelector('#ua-h');
    var apply = body.querySelector('#ua-apply'), off = body.querySelector('#ua-off');
    function enable(on) { [preset, hdrs, apply].forEach(function (x) { x.disabled = !on; }); }
    function showState(r) {
      if (!r || !r.ok) { state.textContent = t('تعذّرت قراءة الحالة'); enable(false); return; }
      enable(true);
      if (r.active) {
        state.textContent = t('فعّال — {0} ترويسة', r.count);
        state.style.color = '#d4423a'; off.disabled = false;
      } else { state.textContent = t('غير فعّال'); state.style.color = ''; off.disabled = true; }
    }
    preset.addEventListener('change', function () { custom.style.display = preset.value === 'custom' ? '' : 'none'; });
    uaMsg({ op: 'get' }, showState);
    apply.addEventListener('click', function () {
      var ua = '';
      if (preset.value === 'custom') ua = custom.value.trim();
      else { var p = UA_PRESETS.filter(function (x) { return x[0] === preset.value; })[0]; ua = p ? p[1] : ''; }
      var ph = parseHeaders(hdrs.value);
      if (ph.bad.length) { status(st, t('ترويسة غير صالحة: {0}', ph.bad[0]), true); return; }
      if (ph.headers.length > 5) { status(st, t('خمس ترويسات كحدّ أقصى.'), true); return; }
      if (hasCredential(ph.headers)) { status(st, t('ترويسات الاعتماد مرفوضة هنا — استعمل «مُرسِل طلبات» لأصل الصفحة.'), true); return; }
      if (!ua && !ph.headers.length) { status(st, t('اختر User-Agent أو أضف ترويسة.'), true); return; }
      var list = ph.headers.slice(); if (ua) list.unshift(['User-Agent', ua]);
      status(st, t('جارٍ التطبيق…'));
      uaMsg({ op: 'set', headers: list }, function (r) {
        if (!r || !r.ok) { status(st, r && r.error === 'bad-header' ? t('العامل رفض ترويسة.') : t('تعذّر التطبيق — حدّث الصفحة وحاول مجدداً.'), true); return; }
        status(st, t('طُبّق ✓ — حدّث الصفحة ليسري على تحميلها.'));
        showState({ ok: true, active: true, count: r.count });
      });
    });
    off.addEventListener('click', function () {
      uaMsg({ op: 'off' }, function (r) {
        if (!r || !r.ok) { status(st, t('تعذّر الإيقاف.'), true); return; }
        status(st, t('أُوقف ✓')); showState({ ok: true, active: false });
      });
    });
  }

  SYFS.tools.push({
    id: 'devnet', name: 'طلبات وترويسات', cat: 'dev',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16"/><path d="m14 6 6 6-6 6"/><path d="M4 5h5M4 19h5"/></svg>',
    mount: function (body) {
      SYFS.tabs(body, [
        { label: 'مُرسِل طلبات', build: mountReq },
        { label: 'User-Agent وترويسات', build: mountUa }
      ]);
    }
  });

  /* ======================================================================
   * 3) محوّلات المطوّرين — cURL ⇄ fetch/axios · YAML ⇄ JSON · .env ⇄ JSON
   * ==================================================================== */

  /* ---- shell-ish tokenizer: '…', "…", \-escapes, \<newline> continuation ---- */
  function shellSplit(s) {
    var out = [], cur = '', has = false, i = 0, n = s.length, q = null;
    while (i < n) {
      var c = s[i];
      if (q === "'") { if (c === "'") q = null; else cur += c; i++; continue; }
      if (q === '"') {
        if (c === '\\' && i + 1 < n && '"\\$`\n'.indexOf(s[i + 1]) >= 0) { if (s[i + 1] !== '\n') cur += s[i + 1]; i += 2; continue; }
        if (c === '"') q = null; else cur += c; i++; continue;
      }
      if (c === '\\') { if (s[i + 1] === '\n') { i += 2; continue; } cur += s[i + 1] || ''; i += 2; has = true; continue; }
      if (c === "'" || c === '"') { q = c; has = true; i++; continue; }
      if (/\s/.test(c)) { if (has || cur) { out.push(cur); cur = ''; has = false; } i++; continue; }
      cur += c; has = true; i++;
    }
    if (has || cur) out.push(cur);
    return out;
  }
  function curlParse(cmd) {
    var tok = shellSplit(String(cmd).trim());
    if (tok[0] === 'curl') tok.shift();
    var r = { url: '', method: '', headers: [], data: [], form: [], user: '', get: false, notes: [] };
    var FLAG_ARG = { '-X': 1, '--request': 1, '-H': 1, '--header': 1, '-d': 1, '--data': 1, '--data-raw': 1, '--data-binary': 1, '--data-urlencode': 1, '--data-ascii': 1, '-F': 1, '--form': 1, '-u': 1, '--user': 1, '--url': 1, '-b': 1, '--cookie': 1, '-A': 1, '--user-agent': 1, '-e': 1, '--referer': 1, '-o': 1, '--output': 1, '-x': 1, '--proxy': 1, '--connect-timeout': 1, '-m': 1, '--max-time': 1, '--cacert': 1, '-T': 1, '--upload-file': 1 };
    for (var i = 0; i < tok.length; i++) {
      var a = tok[i], v = null;
      if (a.charAt(0) === '-' && a.charAt(1) !== '-' && a.length > 2 && FLAG_ARG['-' + a.charAt(1)]) { v = a.slice(2); a = '-' + a.charAt(1); }
      else if (a.indexOf('--') === 0 && a.indexOf('=') > 0) { v = a.slice(a.indexOf('=') + 1); a = a.slice(0, a.indexOf('=')); }
      else if (FLAG_ARG[a]) { v = tok[++i]; if (v === undefined) v = ''; }
      switch (a) {
        case '-X': case '--request': r.method = v.toUpperCase(); break;
        case '-H': case '--header': { var k = v.indexOf(':'); if (k > 0) r.headers.push([v.slice(0, k).trim(), v.slice(k + 1).trim()]); break; }
        case '-d': case '--data': case '--data-raw': case '--data-binary': case '--data-ascii': r.data.push(v.charAt(0) === '@' && a !== '--data-raw' ? '' : v); if (v.charAt(0) === '@' && a !== '--data-raw') r.notes.push('data-file'); break;
        case '--data-urlencode': { var eq = v.indexOf('='); r.data.push(eq > 0 ? v.slice(0, eq) + '=' + encodeURIComponent(v.slice(eq + 1)) : encodeURIComponent(v)); break; }
        case '-F': case '--form': { var e2 = v.indexOf('='); r.form.push([v.slice(0, e2), v.slice(e2 + 1)]); break; }
        case '-u': case '--user': r.user = v; break;
        case '--url': r.url = v; break;
        case '-b': case '--cookie': r.headers.push(['Cookie', v]); break;
        case '-A': case '--user-agent': r.headers.push(['User-Agent', v]); break;
        case '-e': case '--referer': r.headers.push(['Referer', v]); break;
        case '-G': case '--get': r.get = true; break;
        case '-I': case '--head': r.method = 'HEAD'; break;
        case '--compressed': case '-k': case '--insecure': case '-L': case '--location': case '-s': case '--silent': case '-S': case '-v': case '--verbose': case '-i': case '--include': break;
        default:
          if (v !== null) break;                       /* consumed flag with an argument we ignore */
          if (a.charAt(0) === '-') { r.notes.push('flag:' + a); break; }
          if (!r.url) r.url = a;
      }
    }
    if (r.user) r.headers.push(['Authorization', 'Basic ' + (function () { try { return btoa(unescape(encodeURIComponent(r.user))); } catch (e) { return ''; } }())]);
    if (r.get && r.data.length) { r.url += (r.url.indexOf('?') >= 0 ? '&' : '?') + r.data.join('&'); r.data = []; }
    if (!r.method) r.method = (r.data.length || r.form.length) ? 'POST' : 'GET';
    /* fetch/axios throw on a body with GET/HEAD (curl -I -d …) — drop it, and say so */
    if ((r.method === 'GET' || r.method === 'HEAD') && (r.data.length || r.form.length)) { r.data = []; r.form = []; r.notes.push('body-dropped'); }
    if (r.data.length && !r.headers.some(function (x) { return x[0].toLowerCase() === 'content-type'; }) && !r.form.length) r.headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
    r.body = r.data.join('&');
    return r;
  }
  function jsStr(s) { return JSON.stringify(String(s)); }
  /* `curl -X HEAD` waits for a body that never comes (hangs until timeout) — HEAD is -I */
  function curlVerb(method) { return method === 'HEAD' ? 'curl -I' : 'curl -X ' + method; }
  function curlToFetch(r) {
    var lines = [], hasH = r.headers.length, hasB = r.body || r.form.length;
    if (r.form.length) {
      lines.push('const form = new FormData();');
      r.form.forEach(function (f) { lines.push('form.append(' + jsStr(f[0]) + ', ' + (f[1].charAt(0) === '@' ? '/* file: ' + f[1].slice(1) + ' */ fileInput.files[0]' : jsStr(f[1])) + ');'); });
    }
    lines.push('const res = await fetch(' + jsStr(r.url) + ', {');
    lines.push('  method: ' + jsStr(r.method) + (hasH || hasB ? ',' : ''));
    if (hasH) {
      lines.push('  headers: {');
      r.headers.forEach(function (x, i) { lines.push('    ' + jsStr(x[0]) + ': ' + jsStr(x[1]) + (i < r.headers.length - 1 ? ',' : '')); });
      lines.push('  }' + (hasB ? ',' : ''));
    }
    if (r.form.length) lines.push('  body: form');
    else if (r.body) {
      var isJson = r.headers.some(function (x) { return /json/i.test(x[1]) && x[0].toLowerCase() === 'content-type'; });
      var b = r.body; if (isJson) { try { b = 'JSON.stringify(' + JSON.stringify(JSON.parse(r.body), null, 2).replace(/\n/g, '\n  ') + ')'; } catch (e) { b = jsStr(r.body); } } else b = jsStr(r.body);
      lines.push('  body: ' + b);
    }
    lines.push('});');
    if (r.method === 'HEAD') { lines.push('const headers = Object.fromEntries(res.headers);   // HEAD: no body'); return lines.join('\n'); }
    lines.push('const data = await res.' + (r.headers.some(function (x) { return x[0].toLowerCase() === 'accept' && /json/i.test(x[1]); }) ? 'json' : 'text') + '();');
    return lines.join('\n');
  }
  function curlToAxios(r) {
    var lines = ['const res = await axios({'];
    lines.push('  method: ' + jsStr(r.method.toLowerCase()) + ',');
    lines.push('  url: ' + jsStr(r.url) + (r.headers.length || r.body || r.form.length ? ',' : ''));
    if (r.headers.length) {
      lines.push('  headers: {');
      r.headers.forEach(function (x, i) { lines.push('    ' + jsStr(x[0]) + ': ' + jsStr(x[1]) + (i < r.headers.length - 1 ? ',' : '')); });
      lines.push('  }' + (r.body || r.form.length ? ',' : ''));
    }
    if (r.form.length) { lines.push('  data: (() => { const f = new FormData();'); r.form.forEach(function (f) { lines.push('    f.append(' + jsStr(f[0]) + ', ' + jsStr(f[1]) + ');'); }); lines.push('    return f; })()'); }
    else if (r.body) {
      var b = jsStr(r.body); try { if (r.headers.some(function (x) { return /json/i.test(x[1]); })) b = JSON.stringify(JSON.parse(r.body), null, 2).replace(/\n/g, '\n  '); } catch (e) {}
      lines.push('  data: ' + b);
    }
    lines.push('});');
    return lines.join('\n');
  }
  /* fetch/axios → curl: a tolerant reader, not a JS parser (no eval here, ever) */
  function jsToCurl(src) {
    var s = String(src);
    var Q = '[\x27\x22\x60]';
    var url = (new RegExp('(?:fetch\\s*\\(|url\\s*:)\\s*(' + Q + ')([^\x27\x22\x60]+)\\1').exec(s) || [])[2] || '';
    if (!url) throw new Error(t('لم أجد عنوان URL في الكود.'));
    var method = ((new RegExp('method\\s*:\\s*' + Q + '([A-Za-z]+)' + Q).exec(s) || [])[1] || 'GET').toUpperCase();
    var parts = [curlVerb(method)];
    var hm = /headers\s*:\s*\{([\s\S]*?)\}/.exec(s);
    if (hm) {
      var re = new RegExp('(' + Q + '?)([A-Za-z0-9-]+)\\1\\s*:\\s*(' + Q + ')((?:\\\\.|(?!\\3)[^\\\\])*)\\3', 'g'), m;
      while ((m = re.exec(hm[1]))) parts.push("-H '" + (m[2] + ': ' + m[4]).replace(/'/g, "'\\''") + "'");
    }
    var bm = new RegExp('(?:body|data)\\s*:\\s*(JSON\\.stringify\\s*\\(\\s*([\\s\\S]*?)\\s*\\)|(' + Q + ')((?:\\\\.|(?!\\3)[^\\\\])*)\\3)').exec(s);
    if (bm) {
      var bodyTxt = bm[4] !== undefined ? bm[4] : bm[2].replace(/(\w+)\s*:/g, '"$1":').replace(/\x27/g, '"');
      parts.push("--data-raw '" + bodyTxt.replace(/'/g, "'\\''") + "'");
    }
    parts.push("'" + url + "'");
    return parts.join(' \\\n  ');
  }
  function mountCurl(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<textarea class="syf-in syf-mono" id="cu-in" rows="6" placeholder="curl -X POST https://… -H &quot;Content-Type: application/json&quot; -d &#39;{…}&#39;" spellcheck="false"></textarea>' +
        '<div class="syf-row"><button class="syf-btn" id="cu-fetch">→ fetch</button><button class="syf-btn" id="cu-axios">→ axios</button><button class="syf-btn" id="cu-back">→ cURL</button><button class="syf-mini" id="cu-copy">نسخ</button></div>' +
        '<div class="syf-empty" id="cu-st" style="display:none"></div>' +
        '<textarea class="syf-in syf-mono" id="cu-out" rows="9" readonly spellcheck="false"></textarea>' +
        '<div class="syf-note-hint">تحويل نصّي صرف — صفر شبكة، ولا يُخزَّن شيء. «→ cURL» يقرأ كود fetch/axios قراءةً تقريبية (بلا تنفيذ).</div>' +
      '</div>'));
    var inp = body.querySelector('#cu-in'), out = body.querySelector('#cu-out'), st = body.querySelector('#cu-st');
    function warn(r) {
      var w = [];
      if (r.headers.some(function (x) { return /^(authorization|cookie|x-api-key)$/i.test(x[0]); })) w.push(t('يحمل اعتماداً (Authorization/Cookie) — لا يُخزَّن هنا، ولا تلصقه في مواقع تحويل.'));
      r.notes.forEach(function (n) { if (n === 'data-file') w.push(t('@ملف في -d تُرك فارغاً.')); else if (n === 'body-dropped') w.push(t('GET/HEAD لا يحمل جسماً في fetch/axios — أُسقطت البيانات.')); else if (n.indexOf('flag:') === 0) w.push(t('راية تُجوهلت: {0}', n.slice(5))); });
      if (w.length) status(st, w.join(' · ')); else status(st, t('تمّ ✓'));
    }
    function run(fn) {
      var src = inp.value.trim(); if (!src) { status(st, t('الصق أمر cURL أولاً.'), true); return; }
      try { var r = curlParse(src); if (!r.url) throw new Error(t('لم أجد عنوان URL.')); out.value = fn(r); warn(r); }
      catch (e) { out.value = ''; status(st, e.message, true); }
    }
    body.querySelector('#cu-fetch').addEventListener('click', function () { run(curlToFetch); });
    body.querySelector('#cu-axios').addEventListener('click', function () { run(curlToAxios); });
    body.querySelector('#cu-back').addEventListener('click', function () {
      var src = inp.value.trim(); if (!src) { status(st, t('الصق كود fetch أو axios أولاً.'), true); return; }
      try { out.value = jsToCurl(src); status(st, t('تمّ ✓ (قراءة تقريبية)')); } catch (e) { out.value = ''; status(st, e.message, true); }
    });
    body.querySelector('#cu-copy').addEventListener('click', function () { if (out.value) copy(out.value); });
  }

  /* ---- YAML subset: block maps/sequences, nesting, flow [..]/{..}, quoted and plain
   * scalars, | and > block scalars, comments, one document. Written here instead of
   * shipping js-yaml (a dependency needs its own approval and an eval audit, §6);
   * anchors/aliases/tags/multi-doc are REJECTED with a message, never guessed. ---- */
  function yamlStripComment(s) {
    var q = null;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (q) { if (c === '\\' && q === '"') { i++; continue; } if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).replace(/\s+$/, '');
    }
    return s.replace(/\s+$/, '');
  }
  function yamlScalar(v) {
    v = v.trim();
    if (v === '' || v === '~' || v === 'null' || v === 'Null' || v === 'NULL') return null;
    if (v === 'true' || v === 'True' || v === 'TRUE') return true;
    if (v === 'false' || v === 'False' || v === 'FALSE') return false;
    if (/^[-+]?(0|[1-9]\d*)$/.test(v)) return parseInt(v, 10);
    if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(v)) return parseFloat(v);
    if (/^0x[0-9a-fA-F]+$/.test(v)) return parseInt(v, 16);
    if (/^0o[0-7]+$/.test(v)) return parseInt(v.slice(2), 8);
    if (v === '.inf' || v === '.Inf') return Infinity;
    if (v === '-.inf') return -Infinity;
    if (v.charAt(0) === '"') { try { return JSON.parse(v); } catch (e) { throw new Error('bad "…"'); } }
    if (v.charAt(0) === "'") { if (v.charAt(v.length - 1) !== "'") throw new Error("bad '…'"); return v.slice(1, -1).replace(/''/g, "'"); }
    if (v.charAt(0) === '[' || v.charAt(0) === '{') return yamlFlow(v);
    if (v.charAt(0) === '&' || v.charAt(0) === '*' || v.charAt(0) === '!') throw new Error('anchors/aliases/tags');
    return v;
  }
  function yamlFlow(s) {
    var i = 0;
    function ws() { while (i < s.length && /\s/.test(s[i])) i++; }
    function scalarUntil(stops) {
      var start = i, q = null;
      if (s[i] === '"' || s[i] === "'") { q = s[i]; i++; while (i < s.length) { if (q === '"' && s[i] === '\\') { i += 2; continue; } if (s[i] === q) { i++; break; } i++; } return yamlScalar(s.slice(start, i)); }
      while (i < s.length && stops.indexOf(s[i]) < 0) i++;
      return yamlScalar(s.slice(start, i));
    }
    function value() {
      ws();
      if (s[i] === '[') {
        i++; var arr = [];
        for (;;) { ws(); if (s[i] === ']') { i++; return arr; } if (i >= s.length) throw new Error('flow'); arr.push(value()); ws(); if (s[i] === ',') i++; else if (s[i] !== ']') throw new Error('flow'); }
      }
      if (s[i] === '{') {
        i++; var obj = {};
        for (;;) {
          ws(); if (s[i] === '}') { i++; return obj; } if (i >= s.length) throw new Error('flow');
          var k = scalarUntil(':,}'); ws(); if (s[i] === ':') { i++; obj[String(k)] = value(); } else obj[String(k)] = null;
          ws(); if (s[i] === ',') i++; else if (s[i] !== '}') throw new Error('flow');
        }
      }
      return scalarUntil(',]}');
    }
    var v = value(); ws();
    if (i < s.length) throw new Error('flow');
    return v;
  }
  var YAML_KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'\[\]{}#&*!|>][^:#]*?)\s*:(?:\s+|$)/;
  function yamlParse(src) {
    var lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    var rows = [], docs = 0;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      if (/^---(\s|$)/.test(raw)) { if (rows.length || ++docs > 1) throw new Error(t('أكثر من مستند (---) — يُحوَّل الأول فقط: احذف الباقي.')); continue; }
      if (/^\.\.\.\s*$/.test(raw)) break;
      if (/^\s*(#|$)/.test(raw)) continue;
      var ind = raw.match(/^ */)[0].length;
      if (/^\t/.test(raw.slice(ind))) throw new Error(t('سطر {0}: TAB في البداية — YAML يستعمل المسافات.', i + 1));
      rows.push({ ind: ind, text: yamlStripComment(raw.slice(ind)), n: i });
    }
    var pos = 0;
    function err(msg, r) { throw new Error(t('سطر {0}: {1}', (r ? r.n : (rows[pos] ? rows[pos].n : lines.length - 1)) + 1, msg)); }
    function blockScalar(r, marker) {
      var fold = marker.charAt(0) === '>', chomp = marker.indexOf('-') > 0 ? 'strip' : (marker.indexOf('+') > 0 ? 'keep' : 'clip');
      var acc = [], k = r.n + 1, base = -1;
      while (k < lines.length) {
        var L = lines[k];
        if (L.trim() === '') { acc.push(''); k++; continue; }
        var ind = L.match(/^ */)[0].length;
        if (ind <= r.ind) break;
        if (base < 0) base = ind;
        acc.push(L.slice(base));
        k++;
      }
      /* drop rows consumed by the scalar */
      while (rows[pos] && rows[pos].n < k) pos++;
      while (acc.length && acc[acc.length - 1] === '') { if (chomp === 'keep') break; acc.pop(); }
      var text = fold ? acc.reduce(function (o, l, idx) { if (idx === 0) return l; if (l === '') return o + '\n'; if (acc[idx - 1] === '') return o + l; return o + ' ' + l; }, '') : acc.join('\n');
      return chomp === 'strip' ? text : text + '\n';
    }
    function isSeqItem(text) { return text === '-' || text.indexOf('- ') === 0; }
    function parseValueAfter(r, v) {
      if (v === '' ) {
        var nx = rows[pos];
        if (nx && nx.ind > r.ind) return parseNode();
        if (nx && nx.ind === r.ind && isSeqItem(nx.text) && !isSeqItem(r.text)) return parseSeq(r.ind);
        return null;
      }
      if (/^[|>][-+]?\d*$/.test(v)) return blockScalar(r, v);
      try { return yamlScalar(v); } catch (e) { err(e.message === 'anchors/aliases/tags' ? t('المراسي والأسماء المستعارة والوسوم غير مدعومة') : t('قيمة غير مفهومة: {0}', v.slice(0, 30)), r); }
    }
    function parseSeq(ind) {
      var arr = [];
      while (pos < rows.length && rows[pos].ind === ind && isSeqItem(rows[pos].text)) {
        var r = rows[pos], rest = r.text.slice(1).trim();
        if (!rest) { pos++; var nx = rows[pos]; arr.push(nx && nx.ind > ind ? parseNode() : null); continue; }
        if (isSeqItem(rest)) { rows[pos] = { ind: ind + 2, text: rest, n: r.n }; arr.push(parseSeq(ind + 2)); continue; }
        if (YAML_KEY.test(rest)) { rows[pos] = { ind: ind + 2, text: rest, n: r.n }; arr.push(parseMap(ind + 2)); continue; }
        pos++; arr.push(parseValueAfter({ ind: ind, n: r.n, text: rest }, rest));
      }
      return arr;
    }
    function parseMap(ind) {
      var obj = {};
      while (pos < rows.length && rows[pos].ind === ind) {
        var r = rows[pos], m = YAML_KEY.exec(r.text);
        if (!m) { if (isSeqItem(r.text)) break; err(t('توقّعت «مفتاح: قيمة»'), r); }
        var key = m[1]; if (/^["']/.test(key)) key = String(yamlScalar(key));
        var v = r.text.slice(m[0].length).trim();
        pos++;
        obj[key] = parseValueAfter(r, v);
      }
      return obj;
    }
    function parseNode() {
      var r = rows[pos]; if (!r) return null;
      if (isSeqItem(r.text)) return parseSeq(r.ind);
      if (YAML_KEY.test(r.text)) return parseMap(r.ind);
      pos++;
      return parseValueAfter(r, r.text);
    }
    if (!rows.length) return null;
    var v = parseNode();
    if (pos < rows.length) err(t('نصّ غير متوقّع (تحقّق من المسافات البادئة)'), rows[pos]);
    return v;
  }
  function yamlNeedsQuote(s) {
    return s === '' || /^[\s\-?:,\[\]{}#&*!|>'"%@`]/.test(s) || /\s$/.test(s) || /: |\s#/.test(s) || /[\n\t]/.test(s) ||
      /^(true|false|null|~|yes|no|on|off|True|False|Null|Yes|No|On|Off|TRUE|FALSE|NULL|YES|NO|ON|OFF)$/.test(s) || /^[-+]?(\d[\d_]*\.?\d*([eE][-+]?\d+)?|\.\d+|0x[0-9a-fA-F]+|0o[0-7]+|\.inf|\.nan)$/i.test(s);
  }
  function yamlEmit(v, ind) {
    ind = ind || '';
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean' || typeof v === 'number') return isFinite(v) ? String(v) : (v > 0 ? '.inf' : v < 0 ? '-.inf' : '.nan');
    if (typeof v === 'string') {
      if (v.indexOf('\n') >= 0 && !/[\r\t]/.test(v) && !/^\s|\s$/.test(v.replace(/\n+$/, ''))) {
        var body = v.replace(/\n$/, ''), keep = /\n$/.test(v) ? '' : '-';
        return '|' + keep + '\n' + body.split('\n').map(function (l) { return l ? ind + '  ' + l : ''; }).join('\n');
      }
      return yamlNeedsQuote(v) ? JSON.stringify(v) : v;
    }
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return v.map(function (x) {
        var inner = yamlEmit(x, ind + '  ');
        if (x && typeof x === 'object' && (Array.isArray(x) ? x.length : Object.keys(x).length)) return ind + '- ' + inner.replace(/^\s+/, '');
        return ind + '- ' + inner;
      }).join('\n');
    }
    var keys = Object.keys(v);
    if (!keys.length) return '{}';
    return keys.map(function (k) {
      var x = v[k], kk = yamlNeedsQuote(k) ? JSON.stringify(k) : k;
      if (x && typeof x === 'object' && (Array.isArray(x) ? x.length : Object.keys(x).length)) return ind + kk + ':\n' + yamlEmit(x, Array.isArray(x) ? ind : ind + '  ');
      return ind + kk + ': ' + yamlEmit(x, ind);
    }).join('\n');
  }
  function mountYaml(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<textarea class="syf-in syf-mono" id="ya-in" rows="7" placeholder="YAML أو JSON" spellcheck="false"></textarea>' +
        '<div class="syf-row"><button class="syf-btn" id="ya-2j">YAML → JSON</button><button class="syf-btn" id="ya-2y">JSON → YAML</button><button class="syf-mini" id="ya-copy">نسخ</button></div>' +
        '<div class="syf-empty" id="ya-st" style="display:none"></div>' +
        '<textarea class="syf-in syf-mono" id="ya-out" rows="9" readonly spellcheck="false"></textarea>' +
        '<div class="syf-note-hint">محلّل YAML مكتوب داخل الإضافة (بلا مكتبة): خرائط وقوائم وتداخل وصيغ تدفّق وكتل | و&gt; والتعليقات. المراسي (&amp;/*) والوسوم (!) وتعدّد المستندات تُرفض بوضوح. التعليقات تسقط عند المرور بـJSON — JSON لا يحملها.</div>' +
      '</div>'));
    var inp = body.querySelector('#ya-in'), out = body.querySelector('#ya-out'), st = body.querySelector('#ya-st');
    body.querySelector('#ya-2j').addEventListener('click', function () {
      var s = inp.value; if (!s.trim()) { status(st, t('الصق YAML أولاً.'), true); return; }
      try { out.value = JSON.stringify(yamlParse(s), null, 2); status(st, t('تمّ ✓')); } catch (e) { out.value = ''; status(st, e.message, true); }
    });
    body.querySelector('#ya-2y').addEventListener('click', function () {
      var s = inp.value; if (!s.trim()) { status(st, t('الصق JSON أولاً.'), true); return; }
      try { out.value = yamlEmit(JSON.parse(s), '') + '\n'; status(st, t('تمّ ✓')); } catch (e) { out.value = ''; status(st, t('JSON غير صالح: {0}', e.message), true); }
    });
    body.querySelector('#ya-copy').addEventListener('click', function () { if (out.value) copy(out.value); });
  }

  /* ---- .env ⇄ JSON ---- */
  function envParse(src) {
    var out = {}, order = [], lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === '#') continue;
      if (line.indexOf('export ') === 0) line = line.slice(7).trim();
      var eq = line.indexOf('=');
      if (eq <= 0) throw new Error(t('سطر {0}: توقّعت KEY=value', i + 1));
      var key = line.slice(0, eq).trim(), val = line.slice(eq + 1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) throw new Error(t('سطر {0}: اسم متغيّر غير صالح: {1}', i + 1, key.slice(0, 30)));
      if (val.charAt(0) === '"') {
        /* a double-quoted value may span lines until its closing quote */
        while (!/^"(?:[^"\\]|\\[\s\S])*"/.test(val) && i + 1 < lines.length) { i++; val += '\n' + lines[i]; }
        var j = 1, s = '';
        while (j < val.length && val[j] !== '"') { if (val[j] === '\\' && j + 1 < val.length) { var e = val[j + 1]; s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e; j += 2; continue; } s += val[j]; j++; }
        val = s;
      } else if (val.charAt(0) === "'") {
        var k = val.indexOf("'", 1); val = k > 0 ? val.slice(1, k) : val.slice(1);
      } else {
        var hash = val.search(/\s#/); if (hash >= 0) val = val.slice(0, hash).trim();
      }
      if (!(key in out)) order.push(key);
      out[key] = val;
    }
    return { values: out, order: order };
  }
  function envEmit(obj) {
    return Object.keys(obj).map(function (k) {
      var v = obj[k]; v = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      if (/[\s#"'\\$`]/.test(v) || v === '' || /\n/.test(v)) v = '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
      return k + '=' + v;
    }).join('\n');
  }
  function mountEnv(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<textarea class="syf-in syf-mono" id="en-in" rows="7" placeholder="DB_HOST=localhost&#10;DB_PASS=&quot;s3cr3t # not a comment&quot;" spellcheck="false"></textarea>' +
        '<div class="syf-row"><button class="syf-btn" id="en-2j">.env → JSON</button><button class="syf-btn" id="en-2e">JSON → .env</button><button class="syf-mini" id="en-copy">نسخ</button></div>' +
        '<div class="syf-empty" id="en-st" style="display:none"></div>' +
        '<textarea class="syf-in syf-mono" id="en-out" rows="8" readonly spellcheck="false"></textarea>' +
        '<div class="syf-note-hint">⚠️ ملفّ .env يحمل أسراراً — هذا التحويل محلّي بالكامل، ولا يُرسَل ولا يُخزَّن حرف. القيم كلّها نصوص (JSON → .env يحوّل الكائنات إلى نصّ JSON).</div>' +
      '</div>'));
    var inp = body.querySelector('#en-in'), out = body.querySelector('#en-out'), st = body.querySelector('#en-st');
    body.querySelector('#en-2j').addEventListener('click', function () {
      var s = inp.value; if (!s.trim()) { status(st, t('الصق .env أولاً.'), true); return; }
      try { var r = envParse(s); var o = {}; r.order.forEach(function (k) { o[k] = r.values[k]; }); out.value = JSON.stringify(o, null, 2); status(st, t('{0} متغيّراً ✓', r.order.length)); } catch (e) { out.value = ''; status(st, e.message, true); }
    });
    body.querySelector('#en-2e').addEventListener('click', function () {
      var s = inp.value; if (!s.trim()) { status(st, t('الصق JSON أولاً.'), true); return; }
      try { var o2 = JSON.parse(s); if (!o2 || typeof o2 !== 'object' || Array.isArray(o2)) throw new Error(t('يلزم كائن JSON من مفاتيح وقيم.')); out.value = envEmit(o2) + '\n'; status(st, t('تمّ ✓')); } catch (e) { out.value = ''; status(st, e.message, true); }
    });
    body.querySelector('#en-copy').addEventListener('click', function () { if (out.value) copy(out.value); });
  }

  SYFS.tools.push({
    id: 'devconvert', name: 'محوّلات المطوّرين', cat: 'dev',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h11l-3-3"/><path d="M20 17H9l3 3"/><path d="M4 12h5M15 12h5"/></svg>',
    mount: function (body) {
      SYFS.tabs(body, [
        { label: 'cURL ⇄ fetch', build: mountCurl },
        { label: 'YAML ⇄ JSON', build: mountYaml },
        { label: '.env ⇄ JSON', build: mountEnv }
      ]);
    }
  });

  /* ======================================================================
   * 4) مختبر Regex — runs in a Worker with a timeout
   * A catastrophic pattern ((a+)+$ on 30 a's) never returns; on the main thread
   * that is a frozen tab with no way to press "stop". The Worker is the only
   * interruptible place to run a RegExp without eval. On a host page the Worker is
   * built from a blob (subject to the SITE's CSP: some sites forbid it); on an
   * extension page from src/regex-worker.js (MV3 CSP forbids blob workers there).
   * Neither available ⇒ main thread with a hard input cap, and the panel SAYS so.
   * ==================================================================== */
  var RX_TIMEOUT = 3000, RX_MAX_MATCHES = 500;
  var rxWorkerSrc = null;    /* fetched once from the package */
  function rxWorker(cb) {
    if (location.protocol === 'chrome-extension:') { try { cb(new Worker(chrome.runtime.getURL('src/regex-worker.js'))); } catch (e) { cb(null); } return; }
    function fromSrc(src) { try { var b = new Blob([src], { type: 'text/javascript' }); var u = URL.createObjectURL(b); var w = new Worker(u); URL.revokeObjectURL(u); cb(w); } catch (e) { cb(null); } }
    if (rxWorkerSrc) { fromSrc(rxWorkerSrc); return; }
    try {
      fetch(chrome.runtime.getURL('src/regex-worker.js')).then(function (r) { return r.text(); }).then(function (s) { rxWorkerSrc = s; fromSrc(s); }).catch(function () { cb(null); });
    } catch (e) { cb(null); }
  }
  /* ⛔ no main-thread fallback (v0.139.2). There was one, with a 1000-character cap —
     and a cap does not stop catastrophic backtracking: (a+)+$ over 30 «a» and a «b»
     never returns, on the host page's thread, with nothing that can stop it. So a site
     whose CSP blocks blob: workers got a frozen tab from the tool that promises to stop
     ReDoS. No Worker ⇒ no run: the panel says so and offers app mode (an extension
     page, where the worker is loaded from the package). */
  /* regex escape → explanation; the values are msgids read back through t() */
  var RX_ESC = { d: 'رقم', D: 'غير رقم', w: 'حرف أو رقم أو _', W: 'غير حرف/رقم', s: 'فراغ', S: 'غير فراغ', b: 'حدّ كلمة', B: 'ليس حدّ كلمة', n: 'سطر جديد', t: 'تاب', r: 'رجوع', '.': 'نقطة حرفية', '\\': 'شرطة خلفية' };
  function rxExplain(p) {
    var out = [], i = 0, n = p.length, depth = 0;
    function pad() { return '  '.repeat(depth); }
    function quant(i0) {
      var q = '', c = p[i0];
      if (c === '*' || c === '+' || c === '?') q = c;
      else if (c === '{') { var e = p.indexOf('}', i0); if (e > 0 && /^\{\d+(,\d*)?\}$/.test(p.slice(i0, e + 1))) q = p.slice(i0, e + 1); }
      if (!q) return null;
      var lazy = p[i0 + q.length] === '?';
      var desc = q === '*' ? t('صفر أو أكثر') : q === '+' ? t('مرّة أو أكثر') : q === '?' ? t('اختياري') : (function () { var mm = /\{(\d+)(?:,(\d*))?\}/.exec(q); return mm[2] === undefined ? t('{0} مرّة بالضبط', mm[1]) : mm[2] === '' ? t('{0} مرّة أو أكثر', mm[1]) : t('من {0} إلى {1} مرّة', mm[1], mm[2]); }());
      return { len: q.length + (lazy ? 1 : 0), text: desc + (lazy ? ' — ' + t('كسول (أقلّ ما يمكن)') : '') };
    }
    function push(atom, desc) {
      var q = quant(i);
      out.push(pad() + atom + '  →  ' + desc + (q ? ' · ' + q.text : ''));
      if (q) i += q.len;
    }
    while (i < n) {
      var c = p[i];
      if (c === '\\') {
        var e = p[i + 1] || ''; i += 2;
        if (RX_ESC[e]) push('\\' + e, t(RX_ESC[e]));                     /* i18n-dyn: table of msgids passed through t() */
        else if (/\d/.test(e)) push('\\' + e, t('إشارة إلى المجموعة {0}', e));
        else if (e === 'k') { var kk = /^<([^>]+)>/.exec(p.slice(i)); if (kk) { i += kk[0].length; push('\\k<' + kk[1] + '>', t('إشارة إلى المجموعة المسمّاة {0}', kk[1])); } }
        else if (e === 'u' || e === 'x') { var hx = /^(\{[0-9a-fA-F]+\}|[0-9a-fA-F]{2,4})/.exec(p.slice(i)); if (hx) { i += hx[0].length; push('\\' + e + hx[0], t('محرف بالرمز {0}', hx[0])); } else push('\\' + e, t('محرف حرفي «{0}»', e)); }
        else push('\\' + e, t('محرف حرفي «{0}»', e));
        continue;
      }
      if (c === '^') { i++; push('^', t('بداية النصّ (أو السطر مع m)')); continue; }
      if (c === '$') { i++; push('$', t('نهاية النصّ (أو السطر مع m)')); continue; }
      if (c === '.') { i++; push('.', t('أي محرف عدا السطر الجديد (أي محرف مع s)')); continue; }
      if (c === '|') { i++; out.push(pad() + '|  →  ' + t('أو')); continue; }
      if (c === '[') {
        var j = i + 1, neg = p[j] === '^'; if (neg) j++;
        if (p[j] === ']') j++;
        while (j < n && p[j] !== ']') { if (p[j] === '\\') j++; j++; }
        var cls = p.slice(i, j + 1); i = j + 1;
        push(cls, (neg ? t('أي محرف ليس من: ') : t('محرف واحد من: ')) + cls.slice(neg ? 2 : 1, -1));
        continue;
      }
      if (c === '(') {
        var kind = t('مجموعة التقاط'), skip = 1;
        if (p[i + 1] === '?') {
          if (p[i + 2] === ':') { kind = t('مجموعة بلا التقاط'); skip = 3; }
          else if (p[i + 2] === '=') { kind = t('استباق إيجابي (يليه)'); skip = 3; }
          else if (p[i + 2] === '!') { kind = t('استباق سلبي (لا يليه)'); skip = 3; }
          else if (p[i + 2] === '<' && p[i + 3] === '=') { kind = t('استرجاع إيجابي (يسبقه)'); skip = 4; }
          else if (p[i + 2] === '<' && p[i + 3] === '!') { kind = t('استرجاع سلبي (لا يسبقه)'); skip = 4; }
          else if (p[i + 2] === '<') { var nm = /^<([^>]+)>/.exec(p.slice(i + 2)); if (nm) { kind = t('مجموعة مسمّاة «{0}»', nm[1]); skip = 2 + nm[0].length; } }
        }
        out.push(pad() + '(  →  ' + kind); depth++; i += skip; continue;
      }
      if (c === ')') { depth = Math.max(0, depth - 1); i++; var q2 = quant(i); out.push(pad() + ')  →  ' + t('نهاية المجموعة') + (q2 ? ' · ' + q2.text : '')); if (q2) i += q2.len; continue; }
      /* literal run */
      var j2 = i; while (j2 < n && '\\^$.|[()*+?{'.indexOf(p[j2]) < 0) j2++;
      if (j2 === i) { i++; push(c, t('محرف حرفي «{0}»', c)); continue; }
      /* a quantifier binds the LAST char of the run only */
      var run = p.slice(i, j2), nextIsQ = j2 < n && '*+?{'.indexOf(p[j2]) >= 0;
      if (nextIsQ && run.length > 1) { out.push(pad() + run.slice(0, -1) + '  →  ' + t('نصّ حرفي')); i = j2 - 1; push(run.slice(-1), t('محرف حرفي «{0}»', run.slice(-1))); }
      else { i = j2; push(run, t('نصّ حرفي')); }
    }
    return out.join('\n');
  }
  SYFS.tools.push({
    id: 'devregex', name: 'مختبر Regex', cat: 'dev',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3v8"/><path d="m13.5 5 7 4"/><path d="m13.5 9 7-4"/><rect x="3" y="15" width="6" height="6" rx="1"/></svg>',
    mount: function (body) {
      body.appendChild(h(
        '<div class="syf-form">' +
          '<div class="syf-row"><input class="syf-in syf-mono" id="rx-p" placeholder="النمط — مثل ([a-z]+)@([a-z]+)" spellcheck="false" style="flex:1"><input class="syf-in syf-mono" id="rx-f" value="g" placeholder="gimsuy" spellcheck="false" style="width:70px"></div>' +
          '<textarea class="syf-in syf-mono" id="rx-t" rows="5" placeholder="النصّ المُختبَر" spellcheck="false"></textarea>' +
          '<input class="syf-in syf-mono" id="rx-r" placeholder="استبدال تجريبي (اختياري) — $1 و $<name> مدعومان" spellcheck="false">' +
          '<div class="syf-row"><button class="syf-btn" id="rx-go" style="flex:1">اختبر</button><button class="syf-mini" id="rx-ex">اشرح النمط</button><button class="syf-mini" id="rx-copy">نسخ الناتج</button></div>' +
          '<div class="syf-empty" id="rx-st" style="display:none"></div>' +
          '<pre class="syf-out syf-pre" id="rx-out" style="display:none"></pre>' +
          '<div class="syf-note-hint" id="rx-mode"></div>' +
          '<button class="syf-mini" id="rx-app" style="display:none">افتح وضع العمل</button>' +
        '</div>'));
      var st = body.querySelector('#rx-st'), out = body.querySelector('#rx-out'), mode = body.querySelector('#rx-mode');
      var appB = body.querySelector('#rx-app');
      appB.addEventListener('click', function () {
        if (SYFS.openApp) SYFS.openApp();
      });
      var P = body.querySelector('#rx-p'), F = body.querySelector('#rx-f'), T = body.querySelector('#rx-t'), R = body.querySelector('#rx-r');
      var worker = null, workerOk = null, timer = null, lastOut = '';
      function setMode() {
        mode.textContent = workerOk === false ? t('هذا الموقع يمنع تشغيل الأنماط بأمان (CSP) — افتح المختبر في «وضع العمل».')
          : t('يعمل في Web Worker بمهلة {0} ثوانٍ — نمط كارثي يُوقَف بدل أن يجمّد التبويب.', RX_TIMEOUT / 1000);
        appB.style.display = workerOk === false && location.protocol !== 'chrome-extension:' ? '' : 'none';
      }
      function job() {
        var flags = F.value.replace(/[^gimsuyd]/g, ''); F.value = flags;
        return { pattern: P.value, flags: flags, text: T.value, replace: R.value ? R.value : null };
      }
      function render(res) {
        if (!res.ok) { out.style.display = 'none'; status(st, t('نمط غير صالح: {0}', res.error || ''), true); return; }
        var lines = [];
        res.matches.forEach(function (m, k) {
          var l = '#' + (k + 1) + ' @' + m.i + '  ' + JSON.stringify(m.s);
          if (m.g && m.g.length) l += '\n    ' + m.g.map(function (g, gi) { return '$' + (gi + 1) + ' = ' + (g === undefined ? 'undefined' : JSON.stringify(g)); }).join('\n    ');
          if (m.n) l += '\n    ' + Object.keys(m.n).map(function (k2) { return '$<' + k2 + '> = ' + JSON.stringify(m.n[k2]); }).join('\n    ');
          lines.push(l);
        });
        if (res.replaced !== null && res.replaced !== undefined) lines.push('\n— ' + t('بعد الاستبدال') + ' —\n' + res.replaced);
        lastOut = lines.join('\n');
        out.textContent = lastOut || '—'; out.style.display = '';
        status(st, res.matches.length >= RX_MAX_MATCHES ? t('{0}+ تطابق (عُرض أول {0})', RX_MAX_MATCHES) : t('{0} تطابق', res.matches.length));
      }
      function refuse() {
        workerOk = false; setMode();
        out.style.display = 'none';
        status(st, t('هذا الموقع يمنع تشغيل الأنماط بأمان (CSP) — افتح المختبر في «وضع العمل».'), true);
      }
      function run() {
        var j = job();
        if (!j.pattern) { status(st, t('اكتب نمطاً أولاً.'), true); return; }
        /* the syntax check is safe on any thread: compiling never backtracks */
        try { new RegExp(j.pattern, j.flags); } catch (e) { render({ ok: false, error: e.message }); return; }
        status(st, t('جارٍ التشغيل…'));
        rxWorker(function (w) {
          if (!w) { refuse(); return; }
          workerOk = true; setMode();
          if (worker) { try { worker.terminate(); } catch (e) {} }
          worker = w;
          clearTimeout(timer);
          timer = setTimeout(function () { try { worker.terminate(); } catch (e) {} worker = null; out.style.display = 'none'; status(st, t('انتهت المهلة ({0} ث) — النمط كارثي على الأرجح (ReDoS). أُوقف.', RX_TIMEOUT / 1000), true); }, RX_TIMEOUT);
          w.onmessage = function (ev) { clearTimeout(timer); render(ev.data || { ok: false }); try { w.terminate(); } catch (e) {} if (worker === w) worker = null; };
          w.onerror = function () { clearTimeout(timer); try { w.terminate(); } catch (e) {} if (worker === w) worker = null; refuse(); };
          w.postMessage(Object.assign({ max: RX_MAX_MATCHES }, j));
        });
      }
      body.querySelector('#rx-go').addEventListener('click', run);
      body.querySelector('#rx-ex').addEventListener('click', function () {
        if (!P.value) { status(st, t('اكتب نمطاً أولاً.'), true); return; }
        try { new RegExp(P.value, F.value.replace(/[^gimsuyd]/g, '')); } catch (e) { status(st, t('نمط غير صالح: {0}', e.message), true); return; }
        lastOut = rxExplain(P.value); out.textContent = lastOut; out.style.display = ''; status(st, t('شرح النمط:'));
      });
      body.querySelector('#rx-copy').addEventListener('click', function () { if (lastOut) copy(lastOut); });
      /* a closed panel must not leave a Worker (or its timeout) running */
      var guard = setInterval(function () { if (!body.isConnected) { clearInterval(guard); clearTimeout(timer); if (worker) { try { worker.terminate(); } catch (e) {} worker = null; } } }, 500);
      setMode();
    }
  });

  /* ======================================================================
   * 5) محلّل السجلّات — nginx / Apache access logs (combined & common)
   * The usual path is to upload the log to an analyser — and it carries the IPs of
   * real users. Here it never leaves the tab: pasted or picked as a file, parsed in
   * chunks so a 50MB file does not freeze the page, and nothing is stored.
   * ==================================================================== */
  var LOG_RE = /^(\S+) \S+ (\S+) \[([^\]]+)\] "(?:([A-Z]+) (\S+)(?: [^"]*)?|[^"]*)" (\d{3}) (\d+|-)(?: "([^"]*)" "([^"]*)")?/;
  var LOG_CHUNK = 4000;
  function logParseLine(line) {
    var m = LOG_RE.exec(line); if (!m) return null;
    var tm = /^(\d+)\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2})/.exec(m[3]);
    /* the hour key is SORTED as text — so the month is its number, not its name
       (2024-Apr < 2024-Jan alphabetically put April before January; v0.139.3) */
    var mo = tm ? 'JanFebMarAprMayJunJulAugSepOctNovDec'.indexOf(tm[2].charAt(0).toUpperCase() + tm[2].slice(1).toLowerCase()) / 3 + 1 : 0;
    if (tm && (mo < 1 || mo % 1)) tm = null;
    return { ip: m[1], user: m[2], hour: tm ? tm[3] + '-' + (mo < 10 ? '0' : '') + mo + '-' + ('0' + tm[1]).slice(-2) + ' ' + tm[4] + ':00' : '', method: m[4] || '', path: m[5] || '', status: +m[6], bytes: m[7] === '-' ? 0 : +m[7], ref: m[8] || '', ua: m[9] || '' };
  }
  function logStats() {
    var s = { lines: 0, parsed: 0, bytes: 0, status: Object.create(null), paths: Object.create(null), ips: Object.create(null), uas: Object.create(null), hours: Object.create(null), errPaths: Object.create(null), firstHour: '', lastHour: '' };
    s.add = function (line) {
      s.lines++;
      var r = logParseLine(line); if (!r) return;
      s.parsed++; s.bytes += r.bytes;
      var cls = Math.floor(r.status / 100) + 'xx';
      s.status[cls] = (s.status[cls] || 0) + 1;
      var p = r.path.split('?')[0];
      s.paths[p] = (s.paths[p] || 0) + 1;
      s.ips[r.ip] = (s.ips[r.ip] || 0) + 1;
      var ua = r.ua.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || '-';
      s.uas[ua] = (s.uas[ua] || 0) + 1;
      if (r.hour) {
        var hh = s.hours[r.hour] || (s.hours[r.hour] = { n: 0, e: 0 });
        hh.n++; if (r.status >= 400) hh.e++;
        if (!s.firstHour) s.firstHour = r.hour; s.lastHour = r.hour;
      }
      if (r.status >= 400) s.errPaths[r.status + ' ' + p] = (s.errPaths[r.status + ' ' + p] || 0) + 1;
    };
    return s;
  }
  function top(map, n) { return Object.keys(map).map(function (k) { return [k, map[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, n); }
  SYFS.tools.push({
    id: 'devlogs', name: 'محلّل السجلّات', cat: 'dev',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
    mount: function (body) {
      body.appendChild(h(
        '<div class="syf-form">' +
          '<textarea class="syf-in syf-mono" id="lg-in" rows="6" placeholder="الصق سطور access.log (nginx / Apache combined أو common)…" spellcheck="false"></textarea>' +
          '<div class="syf-row"><label class="syf-mini" style="cursor:pointer">📄 أو اختر ملفّاً<input type="file" id="lg-file" accept=".log,.txt,text/plain" style="display:none"></label><button class="syf-btn" id="lg-go" style="flex:1">حلّل</button><button class="syf-mini" id="lg-stop" disabled>إيقاف</button></div>' +
          '<div class="syf-empty" id="lg-st" style="display:none"></div>' +
          '<div id="lg-out"></div>' +
          '<div class="syf-note-hint">تحليل محلّي بالكامل — السجلّ يحمل عناوين IP لمستخدمين حقيقيين ولا يغادر هذا التبويب ولا يُخزَّن. الملفّ الكبير يُقرأ على دفعات.</div>' +
        '</div>'));
      var st = body.querySelector('#lg-st'), out = body.querySelector('#lg-out'), inp = body.querySelector('#lg-in');
      var goBtn = body.querySelector('#lg-go'), stopBtn = body.querySelector('#lg-stop'), fileIn = body.querySelector('#lg-file');
      var running = false, fileText = null;
      fileIn.addEventListener('change', function () {
        var f = fileIn.files && fileIn.files[0]; if (!f) return;
        if (f.size > 200 * 1048576) { status(st, t('الملفّ أكبر من 200MB.'), true); return; }
        var fr = new FileReader();
        /* i18n-dyn: f.name is the user's file name, not a label */
        fr.onload = function () { fileText = String(fr.result || ''); inp.value = ''; inp.placeholder = f.name + ' — ' + fmtBytes(f.size); status(st, t('حُمّل {0} ({1}) — اضغط «حلّل».', f.name, fmtBytes(f.size))); };
        fr.onerror = function () { status(st, t('تعذّرت قراءة الملفّ.'), true); };
        fr.readAsText(f);
      });
      inp.addEventListener('input', function () { if (inp.value) fileText = null; });
      function section(title, pairs, unit) {
        var sec = document.createElement('div'); sec.appendChild(head(title));
        pairs.forEach(function (p) { var r = row(p[0], unit ? p[1] + ' ' + unit : String(p[1])); r.querySelector('.t').classList.add('syf-ltr-tok'); r.querySelector('.t').style.fontSize = '12px'; sec.appendChild(r); });
        if (!pairs.length) sec.appendChild(h('<div class="syf-empty">—</div>'));
        out.appendChild(sec);
      }
      function render(s) {
        out.textContent = '';
        var g = h('<div class="syf-out" style="grid-template-columns:1fr 1fr 1fr"><div><span>سطور</span><b id="lg-n"></b></div><div><span>مفهومة</span><b id="lg-p"></b></div><div><span>حجم الاستجابات</span><b id="lg-b"></b></div></div>');
        g.querySelector('#lg-n').textContent = s.lines; g.querySelector('#lg-p').textContent = s.parsed; g.querySelector('#lg-b').textContent = fmtBytes(s.bytes);
        out.appendChild(g);
        if (s.firstHour) { var span = h('<div class="syf-note-hint syf-ltr-tok"></div>'); span.textContent = s.firstHour + '  →  ' + s.lastHour; out.appendChild(span); }
        section(t('الحالات'), top(s.status, 6).map(function (p) { return [p[0], p[1] + ' (' + Math.round(p[1] * 100 / (s.parsed || 1)) + '%)']; }));
        section(t('أعلى المسارات'), top(s.paths, 10));
        section(t('أخطاء 4xx/5xx حسب المسار'), top(s.errPaths, 10));
        section(t('أعلى عناوين IP'), top(s.ips, 10));
        section(t('أعلى المتصفّحات (UA)'), top(s.uas, 6));
        /* error timeline: one text bar per hour */
        var hours = Object.keys(s.hours).sort();
        if (hours.length) {
          var sec = document.createElement('div'); sec.appendChild(head(t('خطّ زمني (طلبات · أخطاء لكل ساعة)')));
          var mx = hours.reduce(function (m, k) { return Math.max(m, s.hours[k].n); }, 1);
          var pre = document.createElement('pre'); pre.style.cssText = PRE + ';margin:0;background:var(--soft);border-radius:8px;padding:8px;font-size:11px';
          pre.textContent = hours.slice(-48).map(function (k) { var v = s.hours[k]; var bar = '█'.repeat(Math.max(1, Math.round(v.n * 24 / mx))); return k.slice(5) + '  ' + bar + '  ' + v.n + (v.e ? '  ⚠ ' + v.e : ''); }).join('\n');
          sec.appendChild(pre); out.appendChild(sec);
        }
      }
      goBtn.addEventListener('click', function () {
        if (running) return;
        var text = fileText !== null ? fileText : inp.value;
        if (!text.trim()) { status(st, t('الصق سطور السجلّ أو اختر ملفّاً.'), true); return; }
        var lines = text.split('\n'), i = 0, s = logStats();
        running = true; goBtn.disabled = true; stopBtn.disabled = false; out.textContent = '';
        function step() {
          if (!running || !body.isConnected) { running = false; goBtn.disabled = false; stopBtn.disabled = true; return; }
          var end = Math.min(lines.length, i + LOG_CHUNK);
          for (; i < end; i++) { var L = lines[i]; if (L) s.add(L); }
          if (i < lines.length) { status(st, t('جارٍ التحليل… {0} من {1} سطر', i, lines.length)); setTimeout(step, 0); return; }
          running = false; goBtn.disabled = false; stopBtn.disabled = true;
          status(st, s.parsed ? t('اكتمل: {0} سطر، فُهم منها {1}.', s.lines, s.parsed) : t('لم يُفهم أي سطر — الصيغة المدعومة: nginx/Apache access log (combined أو common).'), !s.parsed);
          if (s.parsed) render(s);
        }
        step();
      });
      stopBtn.addEventListener('click', function () { running = false; status(st, t('أُوقف.')); });
    }
  });
}());
