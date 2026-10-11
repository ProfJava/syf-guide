/* SYF — developer tools (dev category).
 * Local, offline, MV3-safe tools (no eval, no network, no new permission).
 * Five registered tools; two are tabbed wrappers (via SYFS.tabs) that group the
 * original single-purpose builders verbatim — every original feature preserved:
 *   devformat  · منسّقات ومحوّلات → tabs: JSON · CSV⇄JSON · مصغّر/منسّق (CSS+JS)
 *   devencode  · ترميز وتشفير    → tabs: Base64/URL · Hash+HMAC · فكّ JWT
 *   devcolor   · Screen colour eyedropper (EyeDropper API) → HEX/RGB/HSL
 *   devinspect · Element picker → selector + size + key computed styles
 *   devviewport· Open this page at a device-sized window (responsive preview)
 *
 * Security: every user/page-derived value is written via textContent/value only
 * (never innerHTML). crypto.subtle + EyeDropper need a secure context (HTTPS) —
 * missing → clear message, no silent fail. Loaded BEFORE src/rail.js. Available
 * in BOTH editions (not in build.js PRIVATE_ONLY). */
(function () {
  window.SYFS = window.SYFS || {};

  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    /* the template's own text IS the msgid — translate the built tree rather than
       splitting the markup (see src/i18n.js). Free in the default language. */
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }
  function copy(text) { try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (e) {} }
  function bufToHex(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }
  /* UTF-8-safe base64 */
  function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64decode(str) { return decodeURIComponent(escape(atob(str))); }
  /* user input: also takes base64url (- _), missing '=' padding and line breaks */
  function b64decodeLoose(str) {
    var s = String(str).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return b64decode(s);
  }
  function b64urlToJson(seg) { return b64decodeLoose(seg); }

  /* ---- CSS minify / beautify (string-aware; keeps calc() & combinator spaces) ---- */
  function minifyCss(src) {
    /* string-aware: whitespace trimmed around structural punctuation ({};,:) INLINE so
     * spaces inside CSS strings are never touched. +,-,>,~ spaces kept (calc/combinators). */
    var out = '', i = 0, n = src.length, inStr = null, PUNCT = '{};,:';
    while (i < n) {
      var c = src[i];
      if (inStr) { out += c; if (c === '\\') { out += src[i + 1] || ''; i += 2; continue; } if (c === inStr) inStr = null; i++; continue; }
      if (c === '"' || c === "'") { inStr = c; out += c; i++; continue; }
      if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
      if (/\s/.test(c)) { var j = i; while (j < n && /\s/.test(src[j])) j++; out += ' '; i = j; continue; }
      if (PUNCT.indexOf(c) >= 0) {
        if (out.charAt(out.length - 1) === ' ') out = out.slice(0, -1);
        if (c === '}' && out.charAt(out.length - 1) === ';') out = out.slice(0, -1); /* drop last ; before } */
        out += c; i++;
        while (i < n && /\s/.test(src[i])) i++; /* skip whitespace after punctuation */
        continue;
      }
      out += c; i++;
    }
    return out.trim();
  }
  function beautifyCss(src) {
    var s = minifyCss(src), out = '', i = 0, n = s.length, inStr = null, stack = [], sel = '';
    function pad() { return '  '.repeat(stack.length); }
    function rule() { return stack[stack.length - 1] === 'rule'; }
    while (i < n) {
      var c = s[i];
      if (inStr) { out += c; if (c === '\\') { out += s[i + 1] || ''; i += 2; continue; } if (c === inStr) inStr = null; i++; continue; }
      if (c === '"' || c === "'") { inStr = c; out += c; sel += c; i++; continue; }
      if (c === '{') {
        var kind = /^@(media|supports|document|container|layer|keyframes)\b/i.test(sel.trim()) ? 'atrule' : 'rule';
        out = out.replace(/\s+$/, '') + ' {'; stack.push(kind); out += '\n' + pad(); sel = ''; i++; continue;
      }
      if (c === '}') { stack.pop(); out = out.replace(/\s+$/, '') + '\n' + pad() + '}\n' + pad(); sel = ''; i++; continue; }
      if (c === ';') { out = out.replace(/\s+$/, '') + ';\n' + pad(); sel = ''; i++; continue; }
      if (c === ':' && rule() && s[i + 1] !== ':' && s[i - 1] !== ':') { out += ': '; i++; continue; }
      out += c; sel += c; i++;
    }
    return out.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim() + '\n';
  }

  /* ---- JS: regex-literal context detector (is `/` a regex start after `out`?) ---- */
  function regexAllowed(out) {
    var k = out.length - 1;
    while (k >= 0 && /\s/.test(out[k])) k--;
    if (k < 0) return true;
    var ch = out[k];
    if ('(,=:[!&|?{};+-*%^~<>'.indexOf(ch) >= 0) return true;
    if (/[A-Za-z0-9_$]/.test(ch)) {
      var s = k; while (s >= 0 && /[A-Za-z0-9_$]/.test(out[s])) s--;
      return /^(return|typeof|instanceof|in|of|do|else|void|delete|new|yield|throw|case|await)$/.test(out.slice(s + 1, k + 1));
    }
    return false;
  }
  /* copy a string/template literal starting at quote src[i]; returns [text, nextIndex] */
  function copyString(src, i) {
    var q = src[i], out = q; i++;
    while (i < src.length) { var c = src[i]; out += c; if (c === '\\') { out += src[i + 1] || ''; i += 2; continue; } if (c === q) { i++; break; } i++; }
    return [out, i];
  }
  function copyRegex(src, i) {
    var out = '/', inClass = false; i++;
    while (i < src.length) { var c = src[i]; out += c; if (c === '\\') { out += src[i + 1] || ''; i += 2; continue; } if (c === '[') inClass = true; else if (c === ']') inClass = false; else if (c === '/' && !inClass) { i++; break; } else if (c === '\n') { break; } i++; }
    while (i < src.length && /[a-z]/i.test(src[i])) { out += src[i]; i++; } /* flags */
    return [out, i];
  }
  /* ---- JS minify: strip comments, collapse normal-mode whitespace. Keeps newlines
   * (ASI-safe). Strings / templates / regex preserved verbatim. NOT a full minifier. ---- */
  function minifyJs(src) {
    var out = '', i = 0, n = src.length;
    while (i < n) {
      var c = src[i], d = src[i + 1];
      if (c === '"' || c === "'" || c === '`') { var r = copyString(src, i); out += r[0]; i = r[1]; continue; }
      if (c === '/' && d === '/') { i += 2; while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
      if (c === '/' && regexAllowed(out)) { var g = copyRegex(src, i); out += g[0]; i = g[1]; continue; }
      if (/\s/.test(c)) { var hasNl = false, j = i; while (j < n && /\s/.test(src[j])) { if (src[j] === '\n') hasNl = true; j++; } out += hasNl ? '\n' : ' '; i = j; continue; }
      out += c; i++;
    }
    return out.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{2,}/g, '\n').trim();
  }
  /* ---- JS beautify: basic brace/indent re-format (string+regex aware). Best-effort. ---- */
  function beautifyJs(src) {
    var s = minifyJs(src), out = '', i = 0, n = s.length, ind = 0, paren = 0;
    function pad() { return '  '.repeat(Math.max(0, ind)); }
    while (i < n) {
      var c = s[i];
      if (c === '"' || c === "'" || c === '`') { var r = copyString(s, i); out += r[0]; i = r[1]; continue; }
      if (c === '/' && regexAllowed(out)) { var g = copyRegex(s, i); out += g[0]; i = g[1]; continue; }
      if (c === '\n') { i++; continue; }
      if (c === '(') { paren++; out += c; i++; continue; }
      if (c === ')') { paren = Math.max(0, paren - 1); out += c; i++; continue; }
      if (c === '{') { ind++; out = out.replace(/[ \t]+$/, '') + '{\n' + pad(); i++; continue; }
      if (c === '}') { ind = Math.max(0, ind - 1); out = out.replace(/\s+$/, '') + '\n' + pad() + '}'; var nx = s[i + 1]; if (nx && ') ,;.'.indexOf(nx) < 0) out += '\n' + pad(); i++; continue; }
      if (c === ';') { if (paren > 0) { out += '; '; } else { out = out.replace(/[ \t]+$/, '') + ';\n' + pad(); } i++; continue; }
      out += c; i++;
    }
    return out.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim() + '\n';
  }

  /* ---- CSV ⇄ JSON (RFC4180-ish: quoted fields, "" escape, CRLF) ---- */
  function parseCsv(text) {
    var rows = [], row = [], field = '', i = 0, n = text.length, inQ = false;
    while (i < n) {
      var c = text[i];
      if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; } field += c; i++; continue; }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; i++; continue; }
      field += c; i++;
    }
    row.push(field); rows.push(row);
    if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
    return rows;
  }
  function csvToJson(text) {
    var rows = parseCsv(text.replace(/^﻿/, '').trim());
    if (!rows.length) return '[]';
    var head = rows[0], out = [];
    /* defineProperty, not o[k] = v: a "__proto__" header would set the prototype and vanish */
    for (var r = 1; r < rows.length; r++) {
      var o = {};
      for (var c = 0; c < head.length; c++) Object.defineProperty(o, head[c], { value: rows[r][c] !== undefined ? rows[r][c] : '', enumerable: true, writable: true, configurable: true });
      out.push(o);
    }
    return JSON.stringify(out, null, 2);
  }
  function jsonToCsv(text) {
    var data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error('يجب أن يكون JSON مصفوفة (array).');
    if (!data.length) return '';
    /* ⛔ CSV injection: a text cell starting with = + - @ tab CR runs as a formula in Excel —
       prefix ' (plain numbers like -5 are left alone) */
    function esc(v) {
      v = (v === null || v === undefined) ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      if (/^[=+\-@\t\r]/.test(v) && !/^[+-]?\d+(\.\d+)?$/.test(v)) v = "'" + v;
      return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }
    if (Array.isArray(data[0])) return data.map(function (row) { return (row || []).map(esc).join(','); }).join('\n');
    if (data[0] && typeof data[0] === 'object') {
      var keys = []; data.forEach(function (o) { Object.keys(o || {}).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
      var lines = [keys.map(esc).join(',')];
      data.forEach(function (o) { lines.push(keys.map(function (k) { return esc(o ? o[k] : ''); }).join(',')); });
      return lines.join('\n');
    }
    return data.map(esc).join('\n');
  }

  SYFS.cats = SYFS.cats || {};
  SYFS.cats.dev = { label: 'مطوّرين', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6l-5 6 5 6"/><path d="M16 6l5 6-5 6"/></svg>' };

  SYFS.tools = SYFS.tools || [];

  /* ===== Merged-tool builders — each reused verbatim as both a standalone
   * mount(body) and a SYFS.tabs build(panel) (identical signature). ===== */
  var ICON_JSON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H7a2 2 0 00-2 2v4a2 2 0 01-2 2 2 2 0 012 2v4a2 2 0 002 2h1"/><path d="M16 3h1a2 2 0 012 2v4a2 2 0 002 2 2 2 0 00-2 2v4a2 2 0 01-2 2h-1"/></svg>';
  /* integer literals JSON.parse will round (beyond 2^53: tweet/snowflake ids…) — string-aware scan */
  function jsonBigNums(src) {
    var out = [], i = 0, n = src.length, m, re = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    while (i < n) {
      var c = src.charAt(i);
      if (c === '"') { i++; while (i < n && src.charAt(i) !== '"') i += src.charAt(i) === '\\' ? 2 : 1; i++; continue; }
      if (c === '-' || (c >= '0' && c <= '9')) {
        re.lastIndex = i; m = re.exec(src);
        if (!m) { i++; continue; }
        var tok = m[0];
        if (/^-?\d+$/.test(tok) && !Number.isSafeInteger(Number(tok)) && out.indexOf(tok) < 0) out.push(tok);
        i += tok.length; continue;
      }
      i++;
    }
    return out;
  }
  function mountJson(body) {
      body.appendChild(h(
        '<div class="syf-form">' +
          '<textarea class="syf-in" id="j-in" rows="5" placeholder=\'{"key":"value"}\' style="direction:ltr;font-family:ui-monospace,monospace"></textarea>' +
          '<div class="syf-row"><button class="syf-btn" id="j-fmt">تنسيق</button><button class="syf-mini" id="j-min">تصغير</button><button class="syf-mini" id="j-copy">نسخ</button></div>' +
          '<div class="syf-empty" id="j-st" style="display:none"></div>' +
          '<pre class="syf-out" id="j-out" style="display:none;direction:ltr;text-align:left;white-space:pre;overflow:auto;max-height:300px;font-family:ui-monospace,monospace;font-size:12px"></pre>' +
        '</div>'));
      var inp = body.querySelector('#j-in'), out = body.querySelector('#j-out'), st = body.querySelector('#j-st');
      function show(msg, ok) { st.style.display = ''; st.textContent = msg; st.style.color = ok ? '' : '#c0392b'; }
      function run(indent) {
        var raw = inp.value.trim();
        if (!raw) { out.style.display = 'none'; show(SYFS.t('الصق JSON أولاً.'), false); return; }
        try {
          var obj = JSON.parse(raw);
          out.textContent = JSON.stringify(obj, null, indent);
          out.style.display = '';
          var big = jsonBigNums(raw);
          if (big.length) show(SYFS.t('صالح ✓ — لكن {0} رقماً أكبر من 2^53 تغيّر في الناتج (مثل {1}). اجعلها نصوصاً "…" لتبقى كما هي.', big.length, big[0]), false);
          else show(SYFS.t('صالح ✓'), true);
        } catch (e) {
          out.style.display = 'none';
          show(SYFS.t('JSON غير صالح: {0}', e.message), false);
        }
      }
      body.querySelector('#j-fmt').addEventListener('click', function () { run(2); });
      body.querySelector('#j-min').addEventListener('click', function () { run(0); });
      body.querySelector('#j-copy').addEventListener('click', function () { if (out.textContent) copy(out.textContent); });
  }

  /* ===== JWT decoder ===== */
  function mountJwt(body) {
      body.appendChild(h(
        '<div class="syf-form">' +
          '<textarea class="syf-in" id="w-in" rows="4" placeholder="eyJhbGciOi…" style="direction:ltr;font-family:ui-monospace,monospace"></textarea>' +
          '<button class="syf-btn" id="w-go">فكّ التوكن</button>' +
          '<div class="syf-empty" id="w-st" style="display:none"></div>' +
          '<div id="w-res" style="display:none">' +
            '<div class="syf-note-hint">Header</div><pre class="syf-out" id="w-head" style="direction:ltr;text-align:left;white-space:pre;overflow:auto;font-family:ui-monospace,monospace;font-size:12px"></pre>' +
            '<div class="syf-note-hint">Payload</div><pre class="syf-out" id="w-pay" style="direction:ltr;text-align:left;white-space:pre;overflow:auto;font-family:ui-monospace,monospace;font-size:12px"></pre>' +
            '<div class="syf-note-hint" id="w-times"></div>' +
            '<div class="syf-out" style="grid-template-columns:1fr"><div><span>حالة الانتهاء</span><b id="w-exp">—</b></div></div>' +
            '<div class="syf-pw-out" style="margin-top:6px"><input class="syf-in" id="w-key" placeholder="مفتاح HS256/384/512 للتحقّق من التوقيع"><button class="syf-mini" id="w-verify">تحقّق</button></div>' +
            '<div class="syf-empty" id="w-vst" style="display:none"></div>' +
          '</div>' +
          '<div class="syf-note-hint">فكّ محلي — التوكن والمفتاح لا يُخزَّنان ولا يغادران التبويب. التحقّق من التوقيع متاح لخوارزميات HMAC (HS*) فقط عبر crypto.subtle؛ RS/ES تحتاج المفتاح العامّ وليست هنا.</div>' +
        '</div>'));
      var inp = body.querySelector('#w-in'), st = body.querySelector('#w-st'), res = body.querySelector('#w-res');
      var expEl = body.querySelector('#w-exp'), vst = body.querySelector('#w-vst');
      var cur = null;                                       /* {parts, head, pay} of the decoded token */
      function show(msg) { st.style.display = ''; st.textContent = msg; res.style.display = 'none'; cur = null; }
      function fmtTime(sec) { try { return new Date(sec * 1000).toLocaleString('ar'); } catch (e) { return String(sec); } }
      function dur(s) {
        s = Math.abs(Math.round(s));
        var d = Math.floor(s / 86400), hh = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
        return (d ? d + 'd ' : '') + (hh < 10 ? '0' : '') + hh + ':' + (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
      }
      /* the countdown ticks while the panel is open; a token that expires while you
         look at it should say so without another click */
      function tick() {
        if (!cur) return;
        var pay = cur.pay, now = Date.now() / 1000;
        if (pay.nbf && now < pay.nbf) { expEl.textContent = SYFS.t('لم يبدأ بعد — يبدأ خلال {0}', dur(pay.nbf - now)); expEl.style.color = '#d98c1f'; return; }
        if (!pay.exp) { expEl.textContent = SYFS.t('بلا تاريخ انتهاء (exp)'); expEl.style.color = ''; return; }
        if (now >= pay.exp) { expEl.textContent = SYFS.t('منتهٍ منذ {0}', dur(now - pay.exp)); expEl.style.color = '#d4423a'; }
        else { expEl.textContent = SYFS.t('سارٍ — ينتهي خلال {0}', dur(pay.exp - now)); expEl.style.color = pay.exp - now < 300 ? '#d98c1f' : '#2e8b57'; }
      }
      var iv = setInterval(function () { if (!body.isConnected) { clearInterval(iv); return; } tick(); }, 1000);
      body.querySelector('#w-go').addEventListener('click', function () {
        var tok = inp.value.trim().replace(/^Bearer\s+/i, '');
        var parts = tok.split('.');
        if (parts.length < 2) { show(SYFS.t('ليس توكن JWT صالحاً (يجب 3 أجزاء مفصولة بنقطة).')); return; }
        try {
          var head = JSON.parse(b64urlToJson(parts[0]));
          var pay = JSON.parse(b64urlToJson(parts[1]));
          body.querySelector('#w-head').textContent = JSON.stringify(head, null, 2);
          body.querySelector('#w-pay').textContent = JSON.stringify(pay, null, 2);
          var lines = [];
          if (pay.iat) lines.push('iat (صدر): ' + fmtTime(pay.iat));
          if (pay.nbf) lines.push('nbf (يبدأ): ' + fmtTime(pay.nbf));
          if (pay.exp) lines.push('exp (ينتهي): ' + fmtTime(pay.exp) + (pay.exp * 1000 < Date.now() ? ' — منتهٍ ⚠️' : ' — سارٍ ✓'));
          body.querySelector('#w-times').textContent = lines.join('  ·  ');
          vst.style.display = 'none';
          cur = { tok: tok, parts: parts, head: head, pay: pay };
          st.style.display = 'none'; res.style.display = '';
          tick();
        } catch (e) { show(SYFS.t('تعذّر فكّ التوكن: {0}', e.message)); }
      });
      body.querySelector('#w-verify').addEventListener('click', function () {
        /* the token in the box is the one checked — editing it after «فكّ» used to verify
           the PREVIOUS token and report its signature as this one's (v0.139.3) */
        if (!cur || cur.tok !== inp.value.trim().replace(/^Bearer\s+/i, '')) body.querySelector('#w-go').click();
        if (!cur) return;
        var key = body.querySelector('#w-key').value;
        function vshow(msg, color) { vst.style.display = ''; vst.textContent = msg; vst.style.color = color || ''; }
        if (!key) { vshow(SYFS.t('أدخل المفتاح السرّي أولاً.'), '#c0392b'); return; }
        if (cur.parts.length < 3 || !cur.parts[2]) { vshow(SYFS.t('التوكن بلا توقيع.'), '#c0392b'); return; }
        var alg = String(cur.head.alg || ''), m = /^HS(256|384|512)$/.exec(alg);
        if (!m) { vshow(SYFS.t('الخوارزمية {0} ليست HMAC — التحقّق هنا لـHS256/384/512 فقط.', alg || '?'), '#c0392b'); return; }
        if (!(window.crypto && crypto.subtle)) { vshow(SYFS.t('crypto.subtle غير متاح (يحتاج HTTPS/سياق آمن).'), '#c0392b'); return; }
        var enc = new TextEncoder(), data = enc.encode(cur.parts[0] + '.' + cur.parts[1]);
        crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-' + m[1] }, false, ['sign'])
          .then(function (k) { return crypto.subtle.sign('HMAC', k, data); })
          .then(function (buf) {
            var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
            var sig = btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            var given = cur.parts[2].replace(/=+$/, '');
            /* constant-time compare is moot here (the key is the user's own), but never
               leak WHICH byte differed either — a boolean is all the panel says */
            var ok = sig.length === given.length && sig.split('').every(function (ch, i) { return ch === given[i]; });
            vshow(ok ? SYFS.t('التوقيع صحيح ✓ ({0})', alg) : SYFS.t('التوقيع لا يطابق هذا المفتاح ✗'), ok ? '#2e8b57' : '#d4423a');
          })
          .catch(function (e) { vshow(SYFS.t('خطأ: {0}', e.message), '#c0392b'); });
      });
  }

  /* ===== Hash + HMAC ===== */
  function mountHash(body) {
      body.appendChild(h(
        '<div class="syf-form">' +
          '<textarea class="syf-in" id="hs-in" rows="3" placeholder="النص المراد حسابه"></textarea>' +
          '<select class="syf-in" id="hs-alg"><option value="SHA-256">SHA-256</option><option value="SHA-1">SHA-1</option><option value="SHA-384">SHA-384</option><option value="SHA-512">SHA-512</option></select>' +
          '<input class="syf-in" id="hs-key" placeholder="مفتاح HMAC (اختياري — اتركه فارغاً لبصمة عادية)" style="direction:ltr">' +
          '<button class="syf-btn" id="hs-go">احسب</button>' +
          '<div class="syf-pw-out"><input type="text" class="syf-in" id="hs-out" readonly><button class="syf-mini" id="hs-copy">نسخ</button></div>' +
          '<div class="syf-empty" id="hs-st" style="display:none"></div>' +
        '</div>'));
      var out = body.querySelector('#hs-out'), st = body.querySelector('#hs-st');
      function show(msg) { st.style.display = ''; st.textContent = msg; }
      body.querySelector('#hs-copy').addEventListener('click', function () { if (out.value) copy(out.value); });
      body.querySelector('#hs-go').addEventListener('click', function () {
        if (!(window.crypto && crypto.subtle)) { show(SYFS.t('crypto.subtle غير متاح (يحتاج HTTPS/سياق آمن).')); return; }
        var msg = body.querySelector('#hs-in').value, alg = body.querySelector('#hs-alg').value, key = body.querySelector('#hs-key').value;
        var enc = new TextEncoder();
        st.style.display = 'none'; out.value = '…';
        var p;
        if (key) {
          p = crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: alg }, false, ['sign'])
            .then(function (k) { return crypto.subtle.sign('HMAC', k, enc.encode(msg)); });
        } else {
          p = crypto.subtle.digest(alg, enc.encode(msg));
        }
        p.then(function (buf) { out.value = bufToHex(buf); }).catch(function (e) { out.value = ''; show(SYFS.t('خطأ: {0}', e.message)); });
      });
  }

  /* ===== Base64 / URL encode-decode ===== */
  var ICON_BASE64 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h6M20 7V4h-6M4 17v3h6M20 17v3h-6"/><path d="M8 12h8"/></svg>';
  function mountBase64(body) {
      body.appendChild(h(
        '<div class="syf-form">' +
          '<div class="syf-seg" id="b-mode"><button class="on" data-m="b64">Base64</button><button data-m="url">URL</button></div>' +
          '<textarea class="syf-in" id="b-in" rows="4" placeholder="النص أو القيمة" style="direction:ltr;font-family:ui-monospace,monospace"></textarea>' +
          '<div class="syf-row"><button class="syf-btn" id="b-enc">ترميز →</button><button class="syf-btn" id="b-dec">← فكّ</button><button class="syf-mini" id="b-copy">نسخ</button></div>' +
          '<textarea class="syf-in" id="b-out" rows="4" readonly style="direction:ltr;font-family:ui-monospace,monospace"></textarea>' +
          '<div class="syf-empty" id="b-st" style="display:none"></div>' +
        '</div>'));
      var mode = 'b64', inp = body.querySelector('#b-in'), out = body.querySelector('#b-out'), st = body.querySelector('#b-st');
      var seg = body.querySelector('#b-mode');
      function show(msg) { st.style.display = ''; st.textContent = msg; }
      seg.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        mode = b.dataset.m;
        seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
      body.querySelector('#b-enc').addEventListener('click', function () {
        st.style.display = 'none';
        try { out.value = mode === 'b64' ? b64encode(inp.value) : encodeURIComponent(inp.value); }
        catch (e) { out.value = ''; show(SYFS.t('تعذّر الترميز: {0}', e.message)); }
      });
      body.querySelector('#b-dec').addEventListener('click', function () {
        st.style.display = 'none';
        try { out.value = mode === 'b64' ? b64decodeLoose(inp.value) : decodeURIComponent(inp.value.trim()); }
        catch (e) { out.value = ''; show(SYFS.t('مدخل غير صالح للفكّ.')); }
      });
      body.querySelector('#b-copy').addEventListener('click', function () { if (out.value) copy(out.value); });
  }

  /* ===== Text diff (v0.113.0) =====
   * Line-level LCS. Written out rather than pulled in: a diff library is the classic
   * dependency you take for forty lines of dynamic programming, and this one has to
   * run inside a content script on somebody else's page.
   *
   * ⛔ EVERY line of both inputs is user text and is written with textContent — the
   * whole point of a diff view is that it shows you markup, so `innerHTML` here would
   * execute exactly the payload the user pasted in to LOOK at.
   * ⚠️ The O(n·m) table is why there is a cap: 4000 lines a side is a 16M-cell table,
   * which is where a content script starts freezing the host page. It is announced. */
  var DIFF_CAP = 4000;
  function lcsOps(a, b) {
    /* table[i][j] = LCS length of a[i:] and b[j:] — built from the end so the walk
       forward emits operations in reading order */
    var n = a.length, m = b.length, i, j;
    var tbl = new Array(n + 1);
    for (i = 0; i <= n; i++) tbl[i] = new Int32Array(m + 1);
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        tbl[i][j] = a[i] === b[j] ? tbl[i + 1][j + 1] + 1 : Math.max(tbl[i + 1][j], tbl[i][j + 1]);
      }
    }
    var ops = [];
    i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { ops.push(['=', a[i], i + 1, j + 1]); i++; j++; }
      else if (tbl[i + 1][j] >= tbl[i][j + 1]) { ops.push(['-', a[i], i + 1, 0]); i++; }
      else { ops.push(['+', b[j], 0, j + 1]); j++; }
    }
    while (i < n) { ops.push(['-', a[i], i + 1, 0]); i++; }
    while (j < m) { ops.push(['+', b[j], 0, j + 1]); j++; }
    return ops;
  }
  function mountDiff(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<label>النصّ الأصلي</label>' +
        '<textarea class="syf-in" id="df-a" rows="5" placeholder="الصق النصّ الأول…" spellcheck="false" style="direction:ltr;font-family:ui-monospace,monospace"></textarea>' +
        '<label>النصّ المُعدَّل</label>' +
        '<textarea class="syf-in" id="df-b" rows="5" placeholder="الصق النصّ الثاني…" spellcheck="false" style="direction:ltr;font-family:ui-monospace,monospace"></textarea>' +
        '<div class="syf-row">' +
          '<button class="syf-btn" id="df-go" style="flex:1">قارِن</button>' +
          '<button class="syf-mini" id="df-swap">⇄ بدّل</button>' +
          '<button class="syf-mini" id="df-copy">نسخ الفرق</button>' +
        '</div>' +
        '<label class="syf-ck"><input type="checkbox" id="df-ws" checked> <span>تجاهل الفراغات في أول السطر وآخره</span></label>' +
        '<div class="syf-out" id="df-sum" style="display:none"><div><span>مضاف</span><b id="df-add">0</b></div><div><span>محذوف</span><b id="df-del">0</b></div><div><span>بلا تغيير</span><b id="df-same">0</b></div></div>' +
        '<div id="df-out" style="max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:10px;display:none"></div>' +
      '</div>'));
    var A = body.querySelector('#df-a'), B = body.querySelector('#df-b'), outEl = body.querySelector('#df-out'),
        sum = body.querySelector('#df-sum'), wsBox = body.querySelector('#df-ws');
    var lastText = '';

    function split(s) {
      var lines = String(s).replace(/\r\n?/g, '\n').split('\n');
      return lines.length > DIFF_CAP ? { lines: lines.slice(0, DIFF_CAP), capped: lines.length } : { lines: lines, capped: 0 };
    }
    function row(sign, text, ln) {
      var r = document.createElement('div');
      r.style.cssText = 'display:flex;gap:8px;padding:2px 8px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;direction:ltr;text-align:left;white-space:pre-wrap;word-break:break-word;' +
        (sign === '+' ? 'background:rgba(34,160,90,.14)' : sign === '-' ? 'background:rgba(220,60,60,.14)' : '');
      var g = document.createElement('span');
      g.style.cssText = 'flex:0 0 3.6em;opacity:.55;user-select:none;text-align:right';
      g.textContent = (ln || '') + ' ' + sign;
      var tx = document.createElement('span');
      tx.style.cssText = 'flex:1';
      tx.textContent = text;                      /* ⛔ user text — never innerHTML */
      r.appendChild(g); r.appendChild(tx);
      return r;
    }
    function run() {
      var ra = split(A.value), rb = split(B.value);
      var la = ra.lines, lb = rb.lines;
      if (wsBox.checked) { la = la.map(function (s) { return s.trim(); }); lb = lb.map(function (s) { return s.trim(); }); }
      var ops = lcsOps(la, lb);
      var add = 0, del = 0, same = 0, parts = [];
      outEl.textContent = '';
      ops.forEach(function (o) {
        if (o[0] === '+') { add++; parts.push('+ ' + o[1]); }
        else if (o[0] === '-') { del++; parts.push('- ' + o[1]); }
        else { same++; parts.push('  ' + o[1]); }
        outEl.appendChild(row(o[0], o[1], o[0] === '+' ? o[3] : o[2]));
      });
      if (ra.capped || rb.capped) {
        /* ⚠️ a cap that is not printed reads as "these files are identical past line
           4000", which is a claim we did not check (§5.19/7) */
        var note = document.createElement('div');
        note.className = 'syf-note-hint';
        note.style.cssText = 'padding:6px 8px';
        note.textContent = SYFS.t('قُورن أول {0} سطر فقط من كل نصّ.', DIFF_CAP);
        outEl.insertBefore(note, outEl.firstChild);
      }
      body.querySelector('#df-add').textContent = add;
      body.querySelector('#df-del').textContent = del;
      body.querySelector('#df-same').textContent = same;
      sum.style.display = ''; outEl.style.display = '';
      lastText = parts.join('\n');
    }
    body.querySelector('#df-go').addEventListener('click', run);
    body.querySelector('#df-swap').addEventListener('click', function () { var v = A.value; A.value = B.value; B.value = v; if (outEl.style.display !== 'none') run(); });
    body.querySelector('#df-copy').addEventListener('click', function () { if (lastText) copy(lastText); });
    wsBox.addEventListener('change', function () { if (outEl.style.display !== 'none') run(); });
  }

  /* ===== SQL formatter + JSON ⇄ SQL (v0.118.0) =====
   * A character tokenizer, not a regex: keywords inside string literals ('WHERE were you')
   * and inside comments must never be touched — the same lesson as §6.103/1. */
  var SQL_NL = /^(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|OFFSET|UNION ALL|UNION|INSERT INTO|VALUES|UPDATE|SET|DELETE FROM|DELETE|LEFT OUTER JOIN|RIGHT OUTER JOIN|FULL OUTER JOIN|LEFT JOIN|RIGHT JOIN|INNER JOIN|CROSS JOIN|JOIN|ON|AND|OR|CREATE TABLE|ALTER TABLE|DROP TABLE|WITH|RETURNING)$/i;
  var SQL_INDENT = /^(AND|OR|ON)$/i;
  function sqlTokens(src) {
    var out = [], i = 0, n = src.length;
    while (i < n) {
      var c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '-' && src[i + 1] === '-') { var e = src.indexOf('\n', i); if (e < 0) e = n; out.push({ t: 'comment', v: src.slice(i, e) }); i = e; continue; }
      if (c === '/' && src[i + 1] === '*') { var e2 = src.indexOf('*/', i + 2); e2 = e2 < 0 ? n : e2 + 2; out.push({ t: 'comment', v: src.slice(i, e2) }); i = e2; continue; }
      if (c === "'" || c === '"' || c === '`') { var j = i + 1; while (j < n) { if (src[j] === c) { if (src[j + 1] === c) { j += 2; continue; } break; } if (src[j] === '\\') j++; j++; } out.push({ t: 'str', v: src.slice(i, j + 1) }); i = j + 1; continue; }
      if (/[A-Za-z_@#$]/.test(c)) { var k = i; while (k < n && /[\w$@#.]/.test(src[k])) k++; out.push({ t: 'word', v: src.slice(i, k) }); i = k; continue; }
      if (/\d/.test(c)) { var d = i; while (d < n && /[\d.eE]/.test(src[d])) d++; out.push({ t: 'num', v: src.slice(i, d) }); i = d; continue; }
      if (c === '(' || c === ')' || c === ',' || c === ';') { out.push({ t: c, v: c }); i++; continue; }
      var o = i; while (o < n && /[^\s\w'"`(),;]/.test(src[o])) o++; if (o === i) o++;
      out.push({ t: 'op', v: src.slice(i, o) }); i = o;
    }
    /* fuse two-word keywords so they break as one */
    var fused = [];
    for (var q = 0; q < out.length; q++) {
      var a = out[q], b = out[q + 1], c2 = out[q + 2];
      if (a.t === 'word' && b && b.t === 'word') {
        var two = (a.v + ' ' + b.v).toUpperCase(), three = c2 && c2.t === 'word' ? (two + ' ' + c2.v).toUpperCase() : '';
        if (three && SQL_NL.test(three)) { fused.push({ t: 'kw', v: three }); q += 2; continue; }
        if (SQL_NL.test(two)) { fused.push({ t: 'kw', v: two }); q++; continue; }
      }
      if (a.t === 'word' && SQL_NL.test(a.v)) { fused.push({ t: 'kw', v: a.v.toUpperCase() }); continue; }
      fused.push(a);
    }
    return fused;
  }
  function formatSql(src) {
    var toks = sqlTokens(src), out = '', depth = 0, lineStart = true;
    function nl() { out = out.replace(/[ \t]+$/, '') + '\n' + '  '.repeat(depth); lineStart = true; }
    function put(s) { if (!lineStart && !/^[,);]$/.test(s) && !/\($/.test(out) && !/^\.|^::/.test(s)) out += ' '; out += s; lineStart = false; }
    toks.forEach(function (tk, i) {
      if (tk.t === 'kw') {
        if (SQL_INDENT.test(tk.v)) { depth++; nl(); put(tk.v); depth--; return; }
        if (i && !lineStart) nl();
        put(tk.v);
        return;
      }
      if (tk.t === '(') { put('('); depth++; var nx = toks[i + 1]; if (nx && nx.t === 'kw' && nx.v === 'SELECT') nl(); return; }
      if (tk.t === ')') { depth = Math.max(0, depth - 1); var pv = toks[i - 1]; if ((pv && pv.t === 'kw') || /\n\s*$/.test(out)) nl(); out += ')'; lineStart = false; return; }
      if (tk.t === ',') { out += ','; nl(); return; }
      if (tk.t === ';') { out += ';'; depth = 0; nl(); nl(); return; }
      if (tk.t === 'word' && /^(AS|IN|IS|NOT|NULL|LIKE|BETWEEN|EXISTS|DISTINCT|CASE|WHEN|THEN|ELSE|END|ASC|DESC|USING|INTO|DEFAULT|PRIMARY|KEY|REFERENCES|CONSTRAINT|IF|COUNT|SUM|AVG|MIN|MAX|COALESCE|CAST)$/i.test(tk.v)) { put(tk.v.toUpperCase()); return; }
      put(tk.v);
    });
    return out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim() + '\n';
  }
  function sqlLit(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'object') v = JSON.stringify(v);
    return "'" + String(v).replace(/'/g, "''").replace(/\\/g, '\\\\') + "'";
  }
  function sqlIdent(s) { return '`' + String(s).replace(/`/g, '``') + '`'; }
  function jsonRows(text) {
    var v = JSON.parse(text);
    if (!Array.isArray(v)) v = [v];
    v = v.filter(function (r) { return r && typeof r === 'object' && !Array.isArray(r); });
    if (!v.length) throw new Error(SYFS.t('يلزم كائن أو مصفوفة كائنات.'));
    var cols = [];
    v.forEach(function (r) { Object.keys(r).forEach(function (k) { if (cols.indexOf(k) < 0) cols.push(k); }); });
    return { rows: v, cols: cols };
  }
  function jsonToInsert(text, table) {
    var d = jsonRows(text), lines = [];
    var CHUNK = 100;
    for (var i = 0; i < d.rows.length; i += CHUNK) {
      var vals = d.rows.slice(i, i + CHUNK).map(function (r) { return '  (' + d.cols.map(function (c) { return sqlLit(r[c]); }).join(', ') + ')'; });
      lines.push('INSERT INTO ' + sqlIdent(table) + ' (' + d.cols.map(sqlIdent).join(', ') + ') VALUES\n' + vals.join(',\n') + ';');
    }
    return lines.join('\n\n') + '\n';
  }
  function sqlType(values) {
    var t = null;
    for (var i = 0; i < values.length; i++) {
      var v = values[i]; if (v === null || v === undefined) continue;
      var k = typeof v === 'boolean' ? 'BOOLEAN' : typeof v === 'number' ? (Number.isInteger(v) ? (Math.abs(v) > 2147483647 ? 'BIGINT' : 'INT') : 'DECIMAL(18,4)')
        : typeof v === 'object' ? 'JSON' : (/^\d{4}-\d{2}-\d{2}(T|\s|$)/.test(v) ? (v.length > 10 ? 'DATETIME' : 'DATE') : (v.length > 255 ? 'TEXT' : 'VARCHAR(255)'));
      if (!t) t = k;
      else if (t !== k) {
        if ((t === 'INT' && k === 'BIGINT') || (t === 'BIGINT' && k === 'INT')) t = 'BIGINT';
        else if (/INT|DECIMAL/.test(t) && /INT|DECIMAL/.test(k)) t = 'DECIMAL(18,4)';
        else if (t === 'DATE' && k === 'DATETIME' || t === 'DATETIME' && k === 'DATE') t = 'DATETIME';
        else if (t === 'VARCHAR(255)' && k === 'TEXT' || t === 'TEXT' && k === 'VARCHAR(255)') t = 'TEXT';
        else t = 'TEXT';
      }
    }
    return t || 'VARCHAR(255)';
  }
  function jsonToCreate(text, table) {
    var d = jsonRows(text);
    var defs = d.cols.map(function (c) {
      var vals = d.rows.map(function (r) { return r[c]; });
      var nullable = vals.some(function (v) { return v === null || v === undefined; });
      /* a primary key is NOT NULL by definition — an `id` with nulls in the data stays a plain column */
      return '  ' + sqlIdent(c) + ' ' + sqlType(vals) + (nullable ? ' NULL' : ' NOT NULL') + (c === 'id' && !nullable ? ' PRIMARY KEY' : '');
    });
    return 'CREATE TABLE ' + sqlIdent(table) + ' (\n' + defs.join(',\n') + '\n);\n';
  }
  function mountSql(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<textarea class="syf-in" id="sq-in" rows="6" placeholder="استعلام SQL، أو JSON (مصفوفة كائنات) للتحويل إلى INSERT / CREATE TABLE" spellcheck="false" style="direction:ltr;font-family:ui-monospace,monospace"></textarea>' +
        '<div class="syf-row"><input class="syf-in" id="sq-tbl" value="my_table" placeholder="اسم الجدول" style="width:130px;direction:ltr;font-family:ui-monospace,monospace"><button class="syf-btn" id="sq-fmt" style="flex:1">تنسيق SQL</button></div>' +
        '<div class="syf-row"><button class="syf-btn" id="sq-ins">JSON → INSERT</button><button class="syf-btn" id="sq-crt">JSON → CREATE TABLE</button><button class="syf-mini" id="sq-copy">نسخ</button></div>' +
        '<div class="syf-empty" id="sq-st" style="display:none"></div>' +
        '<textarea class="syf-in" id="sq-out" rows="9" readonly spellcheck="false" style="direction:ltr;font-family:ui-monospace,monospace"></textarea>' +
        '<div class="syf-note-hint">المنسّق مُرمِّز محارف: الكلمات المفتاحية داخل النصوص والتعليقات لا تُمسّ. الأنواع في CREATE TABLE مستنتَجة من العيّنة (INT / DECIMAL / BOOLEAN / DATE / DATETIME / VARCHAR / TEXT / JSON) — راجعها.</div>' +
      '</div>'));
    var inp = body.querySelector('#sq-in'), out = body.querySelector('#sq-out'), st = body.querySelector('#sq-st');
    function show(msg, ok) { st.style.display = ''; st.textContent = msg; st.style.color = ok ? '' : '#c0392b'; }
    function table() { var v = body.querySelector('#sq-tbl').value.trim(); return /^[A-Za-z_][\w.]*$/.test(v) ? v : 'my_table'; }
    function run(fn, label) {
      var src = inp.value; if (!src.trim()) { show(SYFS.t('الصق شيئاً أولاً.'), false); return; }
      try { out.value = fn(src, table()); show(label + ' ✓', true); } catch (e) { out.value = ''; show(SYFS.t('خطأ: {0}', e.message), false); }
    }
    body.querySelector('#sq-fmt').addEventListener('click', function () { run(formatSql, SYFS.t('تنسيق')); });
    body.querySelector('#sq-ins').addEventListener('click', function () { run(jsonToInsert, 'INSERT'); });
    body.querySelector('#sq-crt').addEventListener('click', function () { run(jsonToCreate, 'CREATE TABLE'); });
    body.querySelector('#sq-copy').addEventListener('click', function () { if (out.value) copy(out.value); });
  }

  /* ===== SVG minifier (v0.118.0) =====
   * ⛔ The SVG never enters the DOM: parsed by DOMParser as XML (an inert document, no
   * script execution, no resource loads), edited there, serialized back. The preview is
   * an <img> from a blob — the one place a browser renders SVG with scripts disabled. */
  var SVG_EDITOR_NS = /^(inkscape|sodipodi|illustrator|sketch|figma|serif|xml:space|i:|a:|x:|adobe)/i;
  function svgMinify(src, precision) {
    var doc = new DOMParser().parseFromString(src, 'image/svg+xml');
    var err = doc.getElementsByTagName('parsererror')[0];
    if (err) throw new Error(SYFS.t('SVG غير صالح: {0}', (err.textContent || '').split('\n')[0].slice(0, 120)));
    var root = doc.documentElement;
    if (!root || root.localName !== 'svg') throw new Error(SYFS.t('الجذر ليس عنصر svg.'));
    var removedEls = 0, removedAttrs = 0;
    /* comments, processing instructions, editor metadata */
    function walk(node) {
      var kids = Array.prototype.slice.call(node.childNodes);
      kids.forEach(function (k) {
        if (k.nodeType === 8 || k.nodeType === 7) { k.remove(); return; }
        if (k.nodeType === 3) { if (!k.nodeValue.trim() && !(node.localName === 'text' || node.localName === 'tspan')) k.remove(); else if (node.localName !== 'text' && node.localName !== 'tspan' && node.localName !== 'style') k.nodeValue = k.nodeValue.trim(); return; }
        if (k.nodeType !== 1) return;
        var ln = k.localName, pre = k.prefix || '';
        if (ln === 'metadata' || (pre && SVG_EDITOR_NS.test(pre + ':')) || (ln === 'desc' && !k.textContent.trim()) || (ln === 'title' && !k.textContent.trim())) { k.remove(); removedEls++; return; }
        Array.prototype.slice.call(k.attributes).forEach(function (a) {
          var nm = a.name;
          if (SVG_EDITOR_NS.test(nm) || nm.indexOf('data-') === 0 || (nm.indexOf('xmlns:') === 0 && SVG_EDITOR_NS.test(nm.slice(6)))) { k.removeAttribute(nm); removedAttrs++; return; }
          if (/^(d|points|viewBox|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|transform|stroke-width|opacity|fill-opacity|stroke-opacity|stroke-dasharray)$/.test(nm)) {
            var v = a.value.replace(/-?\d*\.\d+(?:e-?\d+)?/g, function (num) { var f = parseFloat(num); return String(+f.toFixed(precision)); }).replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim();
            if (nm === 'd') v = v.replace(/\s*([MLHVCSQTAZmlhvcsqtaz])\s*/g, '$1').replace(/ -/g, '-');
            if (v !== a.value) k.setAttribute(nm, v);
          }
          if (a.value === '' && nm !== 'd') { k.removeAttribute(nm); removedAttrs++; }
        });
        walk(k);
        if (ln === 'defs' && !k.childNodes.length) { k.remove(); removedEls++; }
      });
    }
    walk(root);
    Array.prototype.slice.call(root.attributes).forEach(function (a) { if (SVG_EDITOR_NS.test(a.name) || (a.name.indexOf('xmlns:') === 0 && SVG_EDITOR_NS.test(a.name.slice(6))) || a.name === 'version' || a.name === 'baseProfile' || a.name === 'xml:space') { root.removeAttribute(a.name); removedAttrs++; } });
    var out = new XMLSerializer().serializeToString(root).replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ');
    return { svg: out, els: removedEls, attrs: removedAttrs };
  }
  function mountSvg(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<textarea class="syf-in" id="sv-in" rows="6" placeholder="الصق كود SVG…" spellcheck="false" style="direction:ltr;font-family:ui-monospace,monospace"></textarea>' +
        '<div class="syf-row"><label class="syf-ck" style="white-space:nowrap">الدقّة <select class="syf-in" id="sv-prec" style="width:64px"><option value="1">1</option><option value="2" selected>2</option><option value="3">3</option></select></label><button class="syf-btn" id="sv-go" style="flex:1">صغّر</button><button class="syf-mini" id="sv-copy">نسخ</button></div>' +
        '<div class="syf-empty" id="sv-st" style="display:none"></div>' +
        '<div id="sv-prev" style="display:none;display:flex;gap:8px;align-items:center;justify-content:center;background:repeating-conic-gradient(#e8e8e8 0 25%,#fff 0 50%) 0 0/16px 16px;border-radius:8px;padding:8px;min-height:64px"></div>' +
        '<textarea class="syf-in" id="sv-out" rows="7" readonly spellcheck="false" style="direction:ltr;font-family:ui-monospace,monospace"></textarea>' +
        '<div class="syf-note-hint">يحذف التعليقات وبيانات المحرّر (Inkscape/Illustrator/Sketch/Figma) والفراغات ويقرّب الأرقام. المعالجة على مستند XML خامل — الكود لا يدخل الصفحة أبداً، والمعاينة صورة من blob.</div>' +
      '</div>'));
    var inp = body.querySelector('#sv-in'), out = body.querySelector('#sv-out'), st = body.querySelector('#sv-st'), prev = body.querySelector('#sv-prev');
    var lastUrl = null;
    function show(msg, ok) { st.style.display = ''; st.textContent = msg; st.style.color = ok ? '' : '#c0392b'; }
    body.querySelector('#sv-go').addEventListener('click', function () {
      var src = inp.value; if (!src.trim()) { show(SYFS.t('الصق كود SVG أولاً.'), false); return; }
      try {
        var r = svgMinify(src, parseInt(body.querySelector('#sv-prec').value, 10) || 2);
        out.value = r.svg;
        var b = new Blob([src]).size, a = new Blob([r.svg]).size;
        show(SYFS.t('{0} → {1} (وفّر {2}%) · حُذف {3} عنصر و{4} سمة', b + ' B', a + ' B', Math.max(0, Math.round((1 - a / b) * 100)), r.els, r.attrs), true);
        prev.textContent = '';
        if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
        lastUrl = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' }));
        var im = document.createElement('img'); im.alt = ''; im.style.cssText = 'max-width:100%;max-height:140px'; im.src = lastUrl;
        prev.appendChild(im); prev.style.display = 'flex';
      } catch (e) { out.value = ''; prev.style.display = 'none'; show(e.message, false); }
    });
    body.querySelector('#sv-copy').addEventListener('click', function () { if (out.value) copy(out.value); });
    var guard = setInterval(function () { if (!body.isConnected) { clearInterval(guard); if (lastUrl) URL.revokeObjectURL(lastUrl); } }, 1000);
  }

  /* ===== Merged wrapper 1: JSON + CSV⇄JSON + minify/beautify + diff + SQL + SVG ===== */
  SYFS.tools.push({
    id: 'devformat', name: 'منسّقات ومحوّلات', cat: 'dev', icon: ICON_JSON,
    mount: function (body) {
      SYFS.tabs(body, [
        { label: 'JSON', build: mountJson },
        { label: 'CSV ⇄ JSON', build: mountCsv },
        { label: 'مصغّر/منسّق', build: mountCode },
        { label: 'مقارنة نصّين', build: mountDiff },
        { label: 'SQL', build: mountSql },
        { label: 'SVG', build: mountSvg }
      ]);
    }
  });

  /* ===== ضغط وتنسيق الكود (v0.121.0) — file in, minified / beautified + highlighted out =====
   * The «مصغّر/منسّق» tab above takes pasted text and gives plain text back. This is
   * the file-shaped version of the same engines (minifyCss/beautifyCss/minifyJs/
   * beautifyJs — nothing new is trusted): drop or pick a .css/.js/.json, or paste,
   * → one button minifies, the other formats — and the result is shown COLOURED
   * (own tokeniser below, built with createElement/textContent — no innerHTML on
   * user code) with line numbers, byte + gzip sizes (CompressionStream, local) and
   * a download named after the input (app.css → app.min.css and back).
   * Highlighting is capped at 400 KB of output: beyond that the text is shown plain
   * — a page of 200k spans freezes the tab and colours nothing the eye can use. */
  var ICON_CODEMIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 001 1h4"/><path d="M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2z"/><path d="m9 13-2 2 2 2"/><path d="m15 13 2 2-2 2"/></svg>';
  var HL_MAX = 400 * 1024;
  var JS_KW = /^(async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|with|yield|get|set)$/;
  var JS_LIT = /^(true|false|null|undefined|NaN|Infinity)$/;

  /* tokens: [cls, text] — cls is a suffix of .syf-hl-* in rail.css ('' = plain) */
  function tokJs(src, json) {
    var t = [], i = 0, n = src.length, plain = '';
    function flush() { if (plain) { t.push(['', plain]); plain = ''; } }
    while (i < n) {
      var c = src[i], d = src[i + 1];
      if (c === '"' || c === "'" || c === '`') {
        flush(); var r = copyString(src, i);
        /* JSON: a string followed by ':' is a key */
        var k = r[1]; while (k < n && (src[k] === ' ' || src[k] === '\t')) k++;
        t.push([json && src[k] === ':' ? 'k' : 's', r[0]]); i = r[1]; continue;
      }
      if (!json && c === '/' && d === '/') { flush(); var e = src.indexOf('\n', i); if (e < 0) e = n; t.push(['c', src.slice(i, e)]); i = e; continue; }
      if (!json && c === '/' && d === '*') { flush(); var e2 = src.indexOf('*/', i + 2); e2 = e2 < 0 ? n : e2 + 2; t.push(['c', src.slice(i, e2)]); i = e2; continue; }
      if (!json && c === '/' && regexAllowed(src.slice(Math.max(0, i - 40), i))) { flush(); var g = copyRegex(src, i); t.push(['r', g[0]]); i = g[1]; continue; }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(d || ''))) {
        flush(); var j = i + 1; while (j < n && /[0-9a-fA-FxXoObB_.eE+-]/.test(src[j]) && !(/[+-]/.test(src[j]) && !/[eE]/.test(src[j - 1]))) j++;
        t.push(['n', src.slice(i, j)]); i = j; continue;
      }
      if (/[A-Za-z_$]/.test(c)) {
        flush(); var m = i + 1; while (m < n && /[A-Za-z0-9_$]/.test(src[m])) m++;
        var w = src.slice(i, m), cls = '';
        if (JS_LIT.test(w)) cls = 'n'; else if (!json && JS_KW.test(w)) cls = 'kw';
        else if (!json) { var p = m; while (p < n && src[p] === ' ') p++; if (src[p] === '(') cls = 'f'; }
        t.push([cls, w]); i = m; continue;
      }
      if ('{}[]();,.:=+-*/%<>!&|?^~'.indexOf(c) >= 0) { flush(); t.push(['p', c]); i++; continue; }
      plain += c; i++;
    }
    flush();
    return t;
  }
  function tokCss(src) {
    var t = [], i = 0, n = src.length, depth = 0, inDecl = false, buf = '';
    function push(cls) { if (buf) { t.push([cls, buf]); buf = ''; } }
    while (i < n) {
      var c = src[i];
      if (c === '/' && src[i + 1] === '*') { push(inDecl ? 'v' : 'sel'); var e = src.indexOf('*/', i + 2); e = e < 0 ? n : e + 2; t.push(['c', src.slice(i, e)]); i = e; continue; }
      if (c === '"' || c === "'") { push(inDecl ? 'v' : 'sel'); var r = copyString(src, i); t.push(['s', r[0]]); i = r[1]; continue; }
      if (c === '{') { push(buf.trim().charAt(0) === '@' ? 'at' : 'sel'); t.push(['p', c]); depth++; inDecl = true; i++; continue; }
      if (c === '}') { push(inDecl ? 'v' : 'sel'); t.push(['p', c]); depth = Math.max(0, depth - 1); inDecl = depth > 0; i++; continue; }
      if (c === ';') { push(inDecl ? 'v' : 'at'); t.push(['p', c]); i++; continue; }
      if (c === ':' && inDecl) {
        /* property : value — but only the first ':' of a declaration; a nested block
           ({ inside @media) resets via '{' */
        var pre = buf; if (/^\s*[-\w]+\s*$/.test(pre)) { push('pr'); t.push(['p', c]); buf = ''; i++;
          var v = ''; while (i < n && src[i] !== ';' && src[i] !== '}' && src[i] !== '{' && !(src[i] === '/' && src[i + 1] === '*')) {
            if (src[i] === '"' || src[i] === "'") { if (v) { t.push(['v', v]); v = ''; } var q = copyString(src, i); t.push(['s', q[0]]); i = q[1]; continue; }
            v += src[i]; i++;
          }
          /* numbers / colours / !important inside the value get their own colour */
          var re = /(#[0-9a-fA-F]{3,8}\b|-?\d*\.?\d+(?:%|[a-zA-Z]+)?|!important)/g, last = 0, mm;
          while ((mm = re.exec(v))) { if (mm.index > last) t.push(['v', v.slice(last, mm.index)]); t.push([mm[0] === '!important' ? 'kw' : 'n', mm[0]]); last = mm.index + mm[0].length; }
          if (last < v.length) t.push(['v', v.slice(last)]);
          continue; }
      }
      buf += c; i++;
    }
    push(inDecl ? 'v' : 'sel');
    return t;
  }

  /* render tokens as lines: <div class="l"> per line so CSS counters number them */
  function renderHl(pre, tokens) {
    pre.textContent = '';
    var frag = document.createDocumentFragment();
    var line = document.createElement('div'); line.className = 'l';
    tokens.forEach(function (tk) {
      var parts = tk[1].split('\n');
      parts.forEach(function (part, idx) {
        if (idx) { frag.appendChild(line); line = document.createElement('div'); line.className = 'l'; }
        if (!part) return;
        if (tk[0]) { var sp = document.createElement('span'); sp.className = 'syf-hl-' + tk[0]; sp.textContent = part; line.appendChild(sp); }
        else line.appendChild(document.createTextNode(part));
      });
    });
    frag.appendChild(line);
    pre.appendChild(frag);
  }
  function gzipSize(text) {
    try {
      if (typeof CompressionStream !== 'function') return Promise.resolve(-1);
      var stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
      return new Response(stream).arrayBuffer().then(function (b) { return b.byteLength; }).catch(function () { return -1; });
    } catch (e) { return Promise.resolve(-1); }
  }
  function utf8Len(s) { try { return new Blob([s]).size; } catch (e) { return s.length; } }
  function fmtKb(n) { return n < 1024 ? n + ' B' : (n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB'); }
  function guessLang(text, name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    if (m) { var x = m[1].toLowerCase(); if (x === 'css') return 'css'; if (x === 'json') return 'json'; if (/^(m?js|cjs|jsx)$/.test(x)) return 'js'; }
    var s = text.replace(/^﻿/, '').trim();
    if (/^[\[{]/.test(s)) { try { JSON.parse(s); return 'json'; } catch (e) {} }
    if (/^(@[a-z-]+|[.#a-zA-Z*:\[][^{;]*\{)/.test(s) && !/\b(function|=>|var |let |const |return )\b/.test(s.slice(0, 2000))) return 'css';
    return 'js';
  }

  SYFS.tools.push({
    id: 'codemin', name: 'ضغط وتنسيق الكود', cat: 'dev', icon: ICON_CODEMIN,
    mount: function (body) {
      body.appendChild(h(
        '<div class="syf-form">' +
          '<div class="syf-seg" id="cm-lang"><button class="on" data-l="auto">تلقائي</button><button data-l="css">CSS</button><button data-l="js">JS</button><button data-l="json">JSON</button></div>' +
          '<div class="syf-row"><label class="syf-mini" style="cursor:pointer">📄 اختر ملفاً<input type="file" id="cm-f" accept=".css,.js,.mjs,.cjs,.json,text/css,text/javascript,application/json" style="display:none"></label><span class="syf-note-hint syf-mono" id="cm-fn" style="flex:1;margin:0"></span></div>' +
          '<textarea class="syf-in syf-mono" id="cm-in" rows="7" placeholder="الصق الكود هنا أو أفلت ملف .css / .js / .json"></textarea>' +
          '<div class="syf-row"><button class="syf-btn" id="cm-min" style="flex:1">🗜 تصغير</button><button class="syf-btn" id="cm-beau" style="flex:1">✨ تنسيق وتلوين</button></div>' +
          '<div class="syf-empty" id="cm-st" style="display:none"></div>' +
          '<div class="syf-out" id="cm-stats" style="display:none;grid-template-columns:1fr 1fr 1fr 1fr">' +
            '<div><span>قبل</span><b id="cm-b1">—</b></div><div><span>بعد</span><b id="cm-b2">—</b></div>' +
            '<div><span>بعد gzip</span><b id="cm-gz">—</b></div><div><span>التوفير</span><b id="cm-sv">—</b></div>' +
          '</div>' +
          '<div class="syf-row" id="cm-acts" style="display:none"><button class="syf-mini" id="cm-copy">نسخ</button><button class="syf-mini" id="cm-dl">⬇ تنزيل</button><button class="syf-mini" id="cm-swap">⇄ الناتج إلى المدخل</button><label class="syf-ck" style="margin:0 auto 0 0"><input type="checkbox" id="cm-wrap" checked> <span>لفّ الأسطر</span></label></div>' +
          '<pre class="syf-pre syf-hl" id="cm-out" style="display:none;max-height:440px"></pre>' +
          '<div class="syf-note-hint">تصغير CSS يحذف التعليقات والمسافات ويُبقي المسافات داخل النصوص وcalc(). تصغير JS «آمن»: يحذف التعليقات ويضغط المسافات مع الحفاظ على الأسطر (ASI) — ليس مصغّراً كاملاً كـterser، فجرّب الناتج. كل شيء يجري في تبويبك، لا يُرفع شيء.</div>' +
        '</div>'));
      var $ = function (id) { return body.querySelector('#cm-' + id); };
      var inp = $('in'), out = $('out'), st = $('st'), seg = $('lang'), fnEl = $('fn'), stats = $('stats'), acts = $('acts');
      var lang = 'auto', fileName = '', outText = '', outLang = 'js', outKind = '';
      function show(msg, ok) { st.style.display = ''; st.textContent = msg; st.style.color = ok ? '' : '#c0392b'; }
      seg.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; lang = b.dataset.l; seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); });

      function readFile(file) {
        if (!file) return;
        if (file.size > 5 * 1048576) { show(SYFS.t('الملف أكبر من 5 MB.'), false); return; }
        file.text().then(function (txt) {
          inp.value = txt; fileName = file.name;
          /* i18n-dyn: the file's own name and size — data, not a label */
          fnEl.textContent = file.name + ' · ' + fmtKb(file.size);
          show(SYFS.t('حُمّل {0} — اختر تصغير أو تنسيق', file.name), true);
        }).catch(function () { show(SYFS.t('تعذّرت قراءة الملف.'), false); });
      }
      $('f').addEventListener('change', function () { readFile(this.files && this.files[0]); this.value = ''; });
      inp.addEventListener('dragover', function (e) { e.preventDefault(); inp.classList.add('drag'); });
      inp.addEventListener('dragleave', function () { inp.classList.remove('drag'); });
      inp.addEventListener('drop', function (e) { e.preventDefault(); inp.classList.remove('drag'); readFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });
      inp.addEventListener('input', function () { if (fileName) { fileName = ''; fnEl.textContent = ''; } });

      function run(kind) {
        var src = inp.value;
        if (!src.trim()) { show(SYFS.t('الصق كوداً أو اختر ملفاً أولاً.'), false); return; }
        var L = lang === 'auto' ? guessLang(src, fileName) : lang;
        var res;
        try {
          if (L === 'json') { var o = JSON.parse(src.replace(/^﻿/, '')); res = kind === 'min' ? JSON.stringify(o) : JSON.stringify(o, null, 2) + '\n'; }
          else if (L === 'css') res = kind === 'min' ? minifyCss(src) : beautifyCss(src);
          else res = kind === 'min' ? minifyJs(src) : beautifyJs(src);
        } catch (e) { show(SYFS.t('خطأ: {0}', e.message), false); return; }
        outText = res; outLang = L; outKind = kind;
        var b1 = utf8Len(src), b2 = utf8Len(res);
        $('b1').textContent = fmtKb(b1); $('b2').textContent = fmtKb(b2);
        $('sv').textContent = b1 ? (b2 <= b1 ? '−' : '+') + Math.abs(Math.round((1 - b2 / b1) * 100)) + '%' : '—';
        $('gz').textContent = '…';
        stats.style.display = ''; acts.style.display = ''; out.style.display = '';
        gzipSize(res).then(function (g) { $('gz').textContent = g < 0 ? '—' : fmtKb(g); });
        if (res.length <= HL_MAX) renderHl(out, L === 'css' ? tokCss(res) : tokJs(res, L === 'json'));
        else { out.textContent = res; }
        var big = L === 'json' ? jsonBigNums(src) : [];
        show(SYFS.t(kind === 'min' ? 'صُغّر ({0}) ✓' : 'نُسّق ({0}) ✓', L.toUpperCase()) + (res.length > HL_MAX ? ' — ' + SYFS.t('الناتج كبير فعُرض بلا تلوين') : '') +
          (big.length ? ' — ' + SYFS.t('{0} رقماً أكبر من 2^53 تغيّر (مثل {1})', big.length, big[0]) : ''), !big.length);
      }
      $('min').addEventListener('click', function () { run('min'); });
      $('beau').addEventListener('click', function () { run('beau'); });
      $('copy').addEventListener('click', function () { if (outText) { copy(outText); show(SYFS.t('نُسخ ✓'), true); } });
      $('swap').addEventListener('click', function () { if (outText) { inp.value = outText; fileName = ''; fnEl.textContent = ''; show(SYFS.t('نُقل الناتج إلى المدخل'), true); } });
      $('wrap').addEventListener('change', function () { out.style.whiteSpace = this.checked ? 'pre-wrap' : 'pre'; });
      $('dl').addEventListener('click', function () {
        if (!outText) return;
        var ext = outLang === 'json' ? 'json' : outLang;
        var base = (fileName ? fileName.replace(/\.[^.]+$/, '') : 'code').replace(/\.min$/i, '').replace(/[^\w.\-؀-ۿ]+/g, '_').slice(0, 60) || 'code';
        var name = base + (outKind === 'min' ? '.min.' : '.') + ext;
        var blob = new Blob([outText], { type: 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = name; a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        show(SYFS.t('نُزّل {0}', name), true);
      });
    }
  });

  /* ===== Merged wrapper 2: Base64/URL + Hash/HMAC + JWT ===== */
  SYFS.tools.push({
    id: 'devencode', name: 'ترميز وتشفير', cat: 'dev', icon: ICON_BASE64,
    mount: function (body) {
      SYFS.tabs(body, [
        { label: 'Base64/URL', build: mountBase64 },
        { label: 'Hash/HMAC', build: mountHash },
        { label: 'JWT', build: mountJwt }
      ]);
    }
  });

  /* ===== Fake Arabic test data (v0.114.0) =====
   * The point of this tool is the two fields a name list cannot fake: a national ID and
   * an IBAN. Both carry CHECKSUMS, so a random string of the right length is rejected by
   * the very form you are trying to test — which is exactly when a tester reaches for a
   * real one off a colleague's desk. These are structurally valid and issued to nobody.
   *
   * ⛔ NEVER present these as real, and never remove the notice: a screen full of
   * plausible IDs with no label is a screen someone will paste into a real system.
   * ⚠️ `crypto.getRandomValues` and not Math.random — not for secrecy, but so two people
   * generating a batch at the same second do not get the same rows. */
  /* i18n-skip-start: generated CONTENT typed into a form under test — output, not
     interface. Translating an invented surname would just invent a different one.
     Same rule and same reason as RND_* in src/extras.js. */
  var FD_FIRST = ['أحمد', 'محمد', 'سارة', 'فاطمة', 'عمر', 'خالد', 'نورة', 'ريم', 'يوسف', 'ليان', 'عبدالله', 'هند', 'سلمان', 'مريم', 'بدر', 'جواهر'];
  var FD_SLUG  = ['ahmed', 'mohammed', 'sara', 'fatima', 'omar', 'khaled', 'noura', 'reem', 'yousef', 'layan', 'abdullah', 'hind', 'salman', 'maryam', 'badr', 'jawaher'];
  var FD_LAST  = ['الغامدي', 'العتيبي', 'القحطاني', 'الحربي', 'الدوسري', 'الشمري', 'المطيري', 'الزهراني', 'السبيعي', 'البقمي'];
  var FD_CITY  = ['الرياض', 'جدة', 'الدمام', 'مكة', 'المدينة', 'الطائف', 'أبها', 'تبوك', 'الخبر', 'بريدة'];
  var FD_JOB   = ['مطوّر برمجيات', 'مدير مشاريع', 'مصمّم جرافيك', 'محاسب', 'مهندس شبكات', 'مسوّق رقمي', 'أخصائي موارد بشرية'];
  var FD_CO    = ['شركة النخبة', 'مؤسسة الرواد', 'مجموعة الأفق', 'شركة المدى', 'دار الابتكار', 'شركة البيان'];
  var FD_DOM   = ['example.com', 'test.com', 'demo.org', 'sample.net'];
  /* i18n-skip-end */
  function fdRand(n) { var a = new Uint32Array(n); crypto.getRandomValues(a); return a; }
  function fdInt(lo, hi) { return lo + (fdRand(1)[0] % (hi - lo + 1)); }
  function fdPick(a) { return a[fdInt(0, a.length - 1)]; }
  function fdDigits(n) { var s = '', r = fdRand(n); for (var i = 0; i < n; i++) s += (r[i] % 10); return s; }

  /* Saudi national ID — 10 digits, leading 1 (citizen) or 2 (resident), last digit a
     Luhn check over the first nine with the ODD 1-indexed positions doubled. */
  function saudiId(lead) {
    var base = String(lead) + fdDigits(8), sum = 0;
    for (var i = 0; i < 9; i++) {
      var d = +base[i];
      if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
    }
    return base + ((10 - (sum % 10)) % 10);
  }
  /* IBAN — ISO 13616 mod-97-10. The two check digits are 98 minus (rearranged number
     mod 97), and the number is longer than Number can hold, so the modulo is taken
     digit by digit. ⛔ Do not "simplify" this to parseInt: a 24-character IBAN is far
     past 2^53 and the check digits come out silently wrong. */
  function ibanCheck(country, bban) {
    var re = bban + country + '00', num = '';
    for (var i = 0; i < re.length; i++) {
      var c = re[i];
      num += (c >= '0' && c <= '9') ? c : String(c.charCodeAt(0) - 55);   /* A=10 … Z=35 */
    }
    var rem = 0;
    for (var j = 0; j < num.length; j++) rem = (rem * 10 + (+num[j])) % 97;
    var chk = 98 - rem;
    return country + (chk < 10 ? '0' + chk : chk) + bban;
  }
  function fdRow() {
    var i = fdInt(0, FD_FIRST.length - 1), n = fdInt(1, 9999);
    var first = FD_FIRST[i], last = fdPick(FD_LAST), slug = FD_SLUG[i] || 'user';
    /* the mobile matches the shape src/phones-core.js accepts for SA — 9 national digits
       beginning with 5, written with the trunk zero — so a row generated here survives
       the extension's OWN formatter. ⛔ Do not narrow this to a hand-picked list of
       operator prefixes: phones-core checks the leading 5 and nothing more, and a
       generator stricter than the validator invents a rule neither of them holds. */
    return {
      name: first + ' ' + last,
      id: saudiId(fdInt(0, 1) ? 1 : 2),
      phone: '05' + fdDigits(8),
      email: slug + n + '@' + fdPick(FD_DOM),
      iban: ibanCheck('SA', fdDigits(2) + fdDigits(18)),
      city: fdPick(FD_CITY),
      job: fdPick(FD_JOB),
      company: fdPick(FD_CO),
      birth: fdInt(1975, 2005) + '-' + ('0' + fdInt(1, 12)).slice(-2) + '-' + ('0' + fdInt(1, 28)).slice(-2)
    };
  }
  var FD_COLS = [['name', 'الاسم'], ['id', 'رقم الهوية'], ['phone', 'الجوال'], ['email', 'البريد'],
                 ['iban', 'الآيبان'], ['city', 'المدينة'], ['job', 'الوظيفة'], ['company', 'جهة العمل'], ['birth', 'تاريخ الميلاد']];
  SYFS.tools.push({
    id: 'devfake', name: 'بيانات وهمية للاختبار', cat: 'dev',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M9 9v11"/><path d="M12 13h6M12 16.5h4"/></svg>',
    mount: function (body) {
      body.appendChild(h(
        '<div class="syf-form">' +
          '<div class="syf-row"><label style="flex:1">عدد السجلات</label><input type="number" class="syf-in" id="fd-n" value="5" min="1" max="200" style="flex:0 0 90px"></div>' +
          '<button class="syf-btn" id="fd-go">🎲 توليد</button>' +
          '<div class="syf-note-warn">⚠️ بيانات مُختلَقة بالكامل — بنيتها صالحة (خانة تحقّق الهوية ورقم الآيبان محسوبان) لكنها لا تخصّ أحداً ولا تُصدرها أي جهة. للاختبار فقط.</div>' +
          '<div class="syf-row"><button class="syf-mini" id="fd-csv">نسخ CSV</button><button class="syf-mini" id="fd-json">نسخ JSON</button></div>' +
          '<div id="fd-out" style="max-height:300px;overflow:auto"></div>' +
        '</div>'));
      var outEl = body.querySelector('#fd-out'), rows = [];
      function render() {
        outEl.textContent = '';
        rows.forEach(function (r) {
          var card = document.createElement('div');
          card.style.cssText = 'border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin-bottom:8px';
          FD_COLS.forEach(function (c) {
            var line = document.createElement('div');
            line.style.cssText = 'display:flex;gap:8px;font-size:12.5px;line-height:1.7;cursor:pointer';
            var k = document.createElement('span');
            k.style.cssText = 'flex:0 0 6.5em;opacity:.6';
            k.textContent = SYFS.t(c[1]);
            var v = document.createElement('b');
            v.style.cssText = 'flex:1;font-weight:600';
            if (c[0] === 'id' || c[0] === 'phone' || c[0] === 'iban' || c[0] === 'email' || c[0] === 'birth') {
              v.style.direction = 'ltr'; v.style.unicodeBidi = 'isolate'; v.style.textAlign = 'start';
            }
            /* the generated record is CONTENT: an invented surname "translated" is just a
               different invented surname (same rule as RND_* in src/extras.js). The label
               beside it is translated; the value never is. And it is textContent, always. */
            v.textContent = r[c[0]];   /* i18n-dyn: generated sample data, not a label */
            line.title = SYFS.t('اضغط للنسخ');
            line.addEventListener('click', function () { copy(r[c[0]]); });
            line.appendChild(k); line.appendChild(v);
            card.appendChild(line);
          });
          outEl.appendChild(card);
        });
      }
      function gen() {
        var n = Math.max(1, Math.min(200, parseInt(body.querySelector('#fd-n').value, 10) || 5));
        rows = []; for (var i = 0; i < n; i++) rows.push(fdRow());
        render();
      }
      /* ⛔ CSV injection guard — the IBAN starts with letters but a name could begin
         with '=' one day, and this text is pasted straight into Excel by definition
         (§5.13/3). Prefix anything Excel would treat as a formula. */
      function csvSafe(s) { return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; }
      function csv() {
        var head = FD_COLS.map(function (c) { return c[0]; }).join(',');
        return head + '\n' + rows.map(function (r) {
          return FD_COLS.map(function (c) { return '"' + csvSafe(String(r[c[0]])).replace(/"/g, '""') + '"'; }).join(',');
        }).join('\n');
      }
      body.querySelector('#fd-go').addEventListener('click', gen);
      body.querySelector('#fd-csv').addEventListener('click', function () { if (rows.length) copy(csv()); });
      body.querySelector('#fd-json').addEventListener('click', function () { if (rows.length) copy(JSON.stringify(rows, null, 2)); });
      gen();
    }
  });

  /* ===== 5) Colour eyedropper (tab 1 of «ملتقط الألوان»; tab 2 = WCAG contrast) ===== */
  var ICON_COLOR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a10 10 0 1 1 10-10c0 2-1.5 3-3 3h-2a2.5 2.5 0 0 0-1.8 4.2A2 2 0 0 1 13.7 22z"/><circle cx="7.5" cy="10.5" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16.5" cy="10.5" r="1.2"/></svg>';
  function mountPicker(body) {
      body.appendChild(h(
        '<div class="syf-form">' +
          '<button class="syf-btn" id="c-go">🎯 التقط لوناً من الشاشة</button>' +
          '<button class="syf-mini" id="c-pal">🎨 استخرج ألوان هذه الصفحة</button>' +
          '<div id="c-palout"></div>' +
          '<div class="syf-empty" id="c-st" style="display:none"></div>' +
          '<div id="c-card" style="display:none">' +
            '<div id="c-sw" style="height:56px;border-radius:10px;border:1px solid rgba(0,0,0,.15)"></div>' +
            '<div class="syf-pw-out"><input class="syf-in" id="c-hex" readonly><button class="syf-mini" data-t="hex">نسخ</button></div>' +
            '<div class="syf-pw-out"><input class="syf-in" id="c-rgb" readonly><button class="syf-mini" data-t="rgb">نسخ</button></div>' +
            '<div class="syf-pw-out"><input class="syf-in" id="c-hsl" readonly><button class="syf-mini" data-t="hsl">نسخ</button></div>' +
            '<div class="syf-note-hint" style="margin-top:8px">درجات متناسقة (اضغط أي لون لنسخه):</div>' +
            '<div id="c-harm"></div>' +
          '</div>' +
          '<div class="syf-note-list" id="c-hist"></div>' +
        '</div>'));
      var st = body.querySelector('#c-st'), card = body.querySelector('#c-card'), hist = body.querySelector('#c-hist');
      function show(msg) { st.style.display = ''; st.textContent = msg; }
      function hexToRgb(hex) { var n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
      function rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b), hh = 0, s = 0, l = (mx + mn) / 2;
        if (mx !== mn) {
          var d = mx - mn;
          s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
          if (mx === r) hh = (g - b) / d + (g < b ? 6 : 0);
          else if (mx === g) hh = (b - r) / d + 2;
          else hh = (r - g) / d + 4;
          hh /= 6;
        }
        return [Math.round(hh * 360), Math.round(s * 100), Math.round(l * 100)];
      }
      function hslToRgb(H, S, L) {
        H /= 360; S /= 100; L /= 100;
        if (S === 0) { var v = Math.round(L * 255); return [v, v, v]; }
        function hue(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }
        var q = L < 0.5 ? L * (1 + S) : L + S - L * S, p = 2 * L - q;
        return [Math.round(hue(p, q, H + 1 / 3) * 255), Math.round(hue(p, q, H) * 255), Math.round(hue(p, q, H - 1 / 3) * 255)];
      }
      function rgbToHex(rgb) { return '#' + rgb.map(function (x) { var s = Math.max(0, Math.min(255, x)).toString(16); return s.length < 2 ? '0' + s : s; }).join(''); }
      function hslToHex(H, S, L) { return rgbToHex(hslToRgb(H, S, L)); }
      function nh(x) { x %= 360; return x < 0 ? x + 360 : x; }
      function nl(x) { return Math.max(6, Math.min(94, x)); }
      function swatchRow(label, hexes) {
        var wrap = document.createElement('div'); wrap.style.cssText = 'margin-top:8px';
        var lab = document.createElement('div'); lab.className = 'syf-note-hint'; lab.style.cssText = 'margin:0 0 4px'; lab.textContent = label; wrap.appendChild(lab);
        var strip = document.createElement('div'); strip.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
        hexes.forEach(function (hx) {
          var b = document.createElement('button');
          b.type = 'button'; b.title = SYFS.t('{0} — اضغط للنسخ', hx);
          b.style.cssText = 'width:34px;height:34px;border-radius:8px;border:1px solid rgba(0,0,0,.15);cursor:pointer;padding:0;background:' + hx;
          b.addEventListener('click', function () { copy(hx); });
          strip.appendChild(b);
        });
        wrap.appendChild(strip); return wrap;
      }
      function renderHarmonies(hex) {
        var rgb = hexToRgb(hex), hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]), H = hsl[0], S = hsl[1], L = hsl[2];
        var harm = body.querySelector('#c-harm'); harm.textContent = '';
        harm.appendChild(swatchRow('تدرّجات (فاتح ↔ غامق)', [nl(L + 32), nl(L + 16), L, nl(L - 16), nl(L - 32)].map(function (x) { return hslToHex(H, S, x); })));
        harm.appendChild(swatchRow('متجاورة', [hslToHex(nh(H - 30), S, L), hex, hslToHex(nh(H + 30), S, L)]));
        harm.appendChild(swatchRow('متتامّة', [hex, hslToHex(nh(H + 180), S, L)]));
        harm.appendChild(swatchRow('ثلاثية', [hex, hslToHex(nh(H + 120), S, L), hslToHex(nh(H + 240), S, L)]));
        harm.appendChild(swatchRow('متتامّة منقسمة', [hex, hslToHex(nh(H + 150), S, L), hslToHex(nh(H + 210), S, L)]));
      }
      function render(hex) {
        var rgb = hexToRgb(hex), hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
        body.querySelector('#c-sw').style.background = hex;
        body.querySelector('#c-hex').value = hex;
        body.querySelector('#c-rgb').value = 'rgb(' + rgb.join(', ') + ')';
        body.querySelector('#c-hsl').value = 'hsl(' + hsl[0] + ', ' + hsl[1] + '%, ' + hsl[2] + '%)';
        card.style.display = '';
        renderHarmonies(hex);
        var row = h('<div class="syf-note-row"><span class="t"></span><button class="syf-mini">نسخ</button></div>');
        row.querySelector('.t').textContent = hex;
        row.querySelector('.t').style.cssText = 'direction:ltr';
        var dot = document.createElement('span');
        dot.style.cssText = 'display:inline-block;width:14px;height:14px;border-radius:3px;margin-inline-start:6px;vertical-align:middle;background:' + hex;
        row.querySelector('.t').appendChild(dot);
        row.querySelector('button').addEventListener('click', function () { copy(hex); });
        hist.insertBefore(row, hist.firstChild);
      }
      card.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-t]'); if (!b) return;
        copy(body.querySelector('#c-' + b.dataset.t).value);
      });
      body.querySelector('#c-go').addEventListener('click', function () {
        if (!window.EyeDropper) { show(SYFS.t('المتصفّح لا يدعم EyeDropper (يحتاج Chrome حديث + HTTPS).')); return; }
        st.style.display = 'none';
        try {
          new EyeDropper().open().then(function (r) { render(r.sRGBHex); copy(r.sRGBHex); show(SYFS.t('نُسِخ {0} للحافظة ✓', r.sRGBHex)); }).catch(function () {});
        } catch (e) { show(SYFS.t('تعذّر فتح الملتقط: {0}', e.message)); }
      });

      /* ===== page palette (v0.111.0) =====
       * Picking one pixel answers «what colour is that»; a designer opening this tool
       * on a live site is usually asking «what palette is this site», and that question
       * has a cheaper and more exact answer than any pixel: the COMPUTED STYLES. No
       * canvas, no screenshot, no permission — and the values come back as the site's
       * own authored colours rather than whatever the compositor blended on screen.
       *
       * ⛔ Our own rail is excluded. Reporting SYF's teal as one of the site's colours
       * would be the tool measuring itself.
       * ⚠️ The element cap is ANNOUNCED, never silent (§5.19/7): a truncated palette
       * that claims to be complete is worse than one that says where it stopped. */
      var EL_CAP = 4000;
      function parseCol(s) {
        var m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/.exec(s || '');
        if (!m) return null;
        if (m[4] !== undefined && parseFloat(m[4]) < 0.12) return null;   /* effectively invisible */
        return rgbToHex([Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])]);
      }
      function collectPalette() {
        var host = document.getElementById('syfs-host');
        var all = document.querySelectorAll('*');
        var n = Math.min(all.length, EL_CAP), tally = Object.create(null), seen = 0;
        var PROPS = ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'borderInlineStartColor', 'borderInlineEndColor', 'fill', 'stroke'];
        for (var i = 0; i < n; i++) {
          var el = all[i];
          if (host && (el === host || host.contains(el))) continue;
          var cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.12) continue;
          seen++;
          for (var p = 0; p < PROPS.length; p++) {
            var hx = parseCol(cs[PROPS[p]]);
            /* a border colour only counts when there IS a border: browsers report
               `currentColor` on every element whether or not one is drawn, so counting
               it blind makes the body text colour look like the most common border */
            if (hx && PROPS[p].indexOf('border') === 0 && parseFloat(cs[PROPS[p].replace('Color', 'Width')]) === 0) continue;
            if (hx) tally[hx] = (tally[hx] || 0) + 1;
          }
        }
        var out = Object.keys(tally).map(function (k) { return [k, tally[k]]; });
        out.sort(function (a, b) { return b[1] - a[1]; });
        return { colors: out, scanned: seen, total: all.length, capped: all.length > EL_CAP };
      }
      body.querySelector('#c-pal').addEventListener('click', function () {
        var out = body.querySelector('#c-palout');
        out.textContent = '';
        st.style.display = 'none';
        var r = collectPalette();
        if (!r.colors.length) { show(SYFS.t('لم يُعثر على ألوان في هذه الصفحة.')); return; }
        var top = r.colors.slice(0, 24);
        var lab = document.createElement('div');
        lab.className = 'syf-note-hint'; lab.style.cssText = 'margin:10px 0 4px';
        lab.textContent = r.capped
          ? SYFS.t('أكثر {0} لوناً استعمالاً — فُحص أول {1} عنصر من {2} (اضغط أي لون).', top.length, EL_CAP, r.total)
          : SYFS.t('أكثر {0} لوناً استعمالاً في {1} عنصراً (اضغط أي لون).', top.length, r.scanned);
        out.appendChild(lab);
        var strip = document.createElement('div');
        strip.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
        top.forEach(function (c) {
          var b = document.createElement('button');
          b.type = 'button';
          b.title = SYFS.t('{0} — {1} مرّة · اضغط للنسخ', c[0], c[1]);
          b.style.cssText = 'width:34px;height:34px;border-radius:8px;border:1px solid rgba(128,128,128,.35);cursor:pointer;padding:0;background:' + c[0];
          b.addEventListener('click', function () { render(c[0]); copy(c[0]); show(SYFS.t('نُسِخ {0} للحافظة ✓', c[0])); });
          strip.appendChild(b);
        });
        out.appendChild(strip);
      });
  }

  /* ===== WCAG contrast checker (v0.118.0) =====
   * Two colours → ratio, AA/AAA for normal and large text, and the NEAREST passing
   * colour: the foreground's lightness is walked away from the background one step at
   * a time until 4.5:1 holds. «Open this by 8% and it passes» is the difference between
   * a report and a fix. Pure maths; nothing leaves the panel. */
  function cHexToRgb(hex) { var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim()); if (!m) return null; var s = m[1]; if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]; var n = parseInt(s, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function cRgbToHex(rgb) { return '#' + rgb.map(function (x) { var s = Math.max(0, Math.min(255, Math.round(x))).toString(16); return s.length < 2 ? '0' + s : s; }).join(''); }
  function cLum(rgb) { var a = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; }
  function cRatio(a, b) { var l1 = cLum(a), l2 = cLum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
  function cRgbToHsl(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), hh = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) { var d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); if (mx === r) hh = (g - b) / d + (g < b ? 6 : 0); else if (mx === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4; hh /= 6; }
    return [hh * 360, s * 100, l * 100];
  }
  function cHslToRgb(H, S, L) {
    H /= 360; S /= 100; L /= 100;
    if (S === 0) { var v = L * 255; return [v, v, v]; }
    function hue(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }
    var q = L < 0.5 ? L * (1 + S) : L + S - L * S, p = 2 * L - q;
    return [hue(p, q, H + 1 / 3) * 255, hue(p, q, H) * 255, hue(p, q, H - 1 / 3) * 255];
  }
  /* nearest passing foreground: same hue and saturation, lightness pushed away from the
     background until `target` holds (or the end of the scale) */
  function cSuggest(fg, bg, target) {
    var hsl = cRgbToHsl(fg), dir = cLum(fg) >= cLum(bg) ? 1 : -1, L = hsl[2];
    for (var step = 0; step <= 100; step++) {
      var l1 = L + dir * step, l2 = L - dir * step;
      if (l1 >= 0 && l1 <= 100) { var c1 = cHslToRgb(hsl[0], hsl[1], l1); if (cRatio(c1, bg) >= target) return cRgbToHex(c1); }
      if (l2 >= 0 && l2 <= 100) { var c2 = cHslToRgb(hsl[0], hsl[1], l2); if (cRatio(c2, bg) >= target) return cRgbToHex(c2); }
    }
    return null;
  }
  function mountContrast(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<div class="syf-row"><label class="syf-ck" style="flex:1;gap:6px"><input type="color" id="ct-fg" value="#457364" style="width:34px;height:30px;border:none;padding:0;background:none"><input class="syf-in" id="ct-fgx" value="#457364" placeholder="النصّ" style="direction:ltr;font-family:ui-monospace,monospace"></label>' +
        '<label class="syf-ck" style="flex:1;gap:6px"><input type="color" id="ct-bg" value="#ffffff" style="width:34px;height:30px;border:none;padding:0;background:none"><input class="syf-in" id="ct-bgx" value="#ffffff" placeholder="الخلفية" style="direction:ltr;font-family:ui-monospace,monospace"></label></div>' +
        '<div id="ct-sample" style="border-radius:10px;padding:14px;border:1px solid rgba(0,0,0,.12)"><div style="font-size:14px">نصّ عادي — The quick brown fox 0123</div><div style="font-size:24px;font-weight:700;margin-top:4px">نصّ كبير — Large text</div></div>' +
        '<div class="syf-out" style="grid-template-columns:1fr 1fr"><div><span>النسبة</span><b id="ct-ratio">—</b></div><div><span>الحكم</span><b id="ct-verdict">—</b></div></div>' +
        '<div class="syf-note-list" id="ct-rows"></div>' +
        '<div id="ct-sug" style="display:none"><div class="syf-note-hint">أقرب لون نصّ يجتاز AA (4.5:1) بنفس الصبغة:</div><div class="syf-pw-out"><input class="syf-in" id="ct-sugx" readonly><button class="syf-mini" id="ct-sugcopy">نسخ</button><button class="syf-mini" id="ct-suguse">استعمله</button></div></div>' +
        '<div class="syf-note-hint">WCAG 2.x: النصّ العادي يحتاج 4.5:1 (AA) و7:1 (AAA)؛ الكبير (≥24px أو ≥18.66px عريض) 3:1 و4.5:1. الأيقونات وعناصر الواجهة 3:1.</div>' +
      '</div>'));
    var fg = body.querySelector('#ct-fg'), bg = body.querySelector('#ct-bg'), fgx = body.querySelector('#ct-fgx'), bgx = body.querySelector('#ct-bgx');
    var rows = body.querySelector('#ct-rows'), sug = body.querySelector('#ct-sug'), sugx = body.querySelector('#ct-sugx');
    function line(label, ok) { var r = h('<div class="syf-note-row"><span class="t"></span><b></b></div>'); r.querySelector('.t').textContent = label; var b = r.querySelector('b'); b.textContent = ok ? '✓' : '✗'; b.style.color = ok ? '#2e8b57' : '#d4423a'; rows.appendChild(r); }
    function update() {
      var a = cHexToRgb(fgx.value), b = cHexToRgb(bgx.value);
      if (!a || !b) return;
      fg.value = cRgbToHex(a); bg.value = cRgbToHex(b);
      var s = body.querySelector('#ct-sample'); s.style.color = fg.value; s.style.background = bg.value;
      var r = cRatio(a, b);
      body.querySelector('#ct-ratio').textContent = r.toFixed(2) + ':1';
      var v = body.querySelector('#ct-verdict');
      v.textContent = r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? SYFS.t('كبير فقط') : SYFS.t('يرسب');
      v.style.color = r >= 4.5 ? '#2e8b57' : r >= 3 ? '#d98c1f' : '#d4423a';
      rows.textContent = '';
      line(SYFS.t('نصّ عادي AA (4.5:1)'), r >= 4.5); line(SYFS.t('نصّ عادي AAA (7:1)'), r >= 7);
      line(SYFS.t('نصّ كبير AA (3:1)'), r >= 3); line(SYFS.t('نصّ كبير AAA (4.5:1)'), r >= 4.5);
      if (r < 4.5) { var sg = cSuggest(a, b, 4.5); if (sg) { sugx.value = sg + '  (' + cRatio(cHexToRgb(sg), b).toFixed(2) + ':1)'; sugx.dataset.hex = sg; sug.style.display = ''; } else sug.style.display = 'none'; }
      else sug.style.display = 'none';
    }
    fg.addEventListener('input', function () { fgx.value = fg.value; update(); });
    bg.addEventListener('input', function () { bgx.value = bg.value; update(); });
    fgx.addEventListener('input', update); bgx.addEventListener('input', update);
    body.querySelector('#ct-sugcopy').addEventListener('click', function () { if (sugx.dataset.hex) copy(sugx.dataset.hex); });
    body.querySelector('#ct-suguse').addEventListener('click', function () { if (sugx.dataset.hex) { fgx.value = sugx.dataset.hex; update(); } });
    update();
  }

  SYFS.tools.push({
    id: 'devcolor', name: 'ملتقط الألوان', cat: 'dev', icon: ICON_COLOR,
    mount: function (body) {
      SYFS.tabs(body, [
        { label: 'الملتقط', build: mountPicker },
        { label: 'تباين WCAG', build: mountContrast }
      ]);
    }
  });

  /* ===== 6) Element inspector ===== */
  SYFS.tools.push({
    id: 'devinspect', name: 'فاحص العناصر', cat: 'dev',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3H4a1 1 0 0 0-1 1v1M9 3h2M15 3h1a1 1 0 0 1 1 1v1M3 9v2M3 15v1a1 1 0 0 0 1 1h1M9 17h2"/><path d="m13 13 8 3-3.5 1.5L16 21z"/></svg>',
    mount: function (body) {
      body.appendChild(h(
        '<div class="syf-form">' +
          '<button class="syf-btn" id="i-go">🎯 ابدأ اختيار عنصر</button>' +
          '<div class="syf-note-hint">مرّر فوق الصفحة ثم انقر عنصراً. Esc للإلغاء. يتجاهل واجهة الإضافة.</div>' +
          '<div id="i-res" style="display:none">' +
            '<div class="syf-pw-out"><input class="syf-in" id="i-sel" readonly style="direction:ltr"><button class="syf-mini" id="i-copy">نسخ</button></div>' +
            '<div class="syf-note-hint">محدّد ثابت (للاختبارات الآلية):</div>' +
            '<div class="syf-pw-out"><input class="syf-in" id="i-stable" readonly style="direction:ltr"><button class="syf-mini" id="i-scopy">نسخ</button></div>' +
            '<pre class="syf-out" id="i-info" style="direction:ltr;text-align:left;white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px"></pre>' +
            '<div class="syf-note-hint">CSS حيّ — عدّل وطبّق (في الذاكرة، يزول بالتحديث):</div>' +
            '<textarea class="syf-in" id="i-css" rows="5" spellcheck="false" style="direction:ltr;font-family:ui-monospace,monospace;font-size:12px"></textarea>' +
            '<div class="syf-row"><button class="syf-btn" id="i-apply" style="flex:1">طبّق</button><button class="syf-mini" id="i-reset">استرجع الأصل</button></div>' +
            '<div class="syf-empty" id="i-cst" style="display:none"></div>' +
          '</div>' +
        '</div>'));
      var host = document.getElementById('syfs-host');
      var box = null, active = false, watchdog = null;
      var res = body.querySelector('#i-res'), info = body.querySelector('#i-info'), selEl = body.querySelector('#i-sel');
      var picked = null, pickedCss = '';                  /* the element and its ORIGINAL inline style */
      var cssIn = body.querySelector('#i-css'), cst = body.querySelector('#i-cst'), stableEl = body.querySelector('#i-stable');

      /* ---- stable selector (v0.118.0) ----
       * DevTools' «Copy selector» gives `div:nth-child(7) > div > span` — it breaks on
       * the next deploy. A test wants the hooks a human would pick: a test id, a name,
       * a label, a real id, an href — and a class only when it does not look generated
       * (hashes, CSS-in-JS prefixes). Each candidate must match exactly ONE element. */
      function uniq(sel) { try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; } }
      function goodId(id) { return id && !/\d{3,}|^[a-f0-9]{8,}$|^(ember|react|radix|mui|headlessui|:|__)/i.test(id) && /^[A-Za-z_][\w-]*$/.test(id); }
      function goodClass(c) { return c && /^[A-Za-z_][\w-]*$/.test(c) && !/\d{3,}|^(css|sc|jss|emotion|_|svelte|ng-|is-|has-)/i.test(c) && !/[A-Za-z]{2,}[0-9a-f]{5,}$/.test(c) && c.length < 40; }
      function attrSel(el, tag) {
        var A = ['data-testid', 'data-test', 'data-cy', 'data-qa', 'data-test-id', 'name', 'aria-label', 'placeholder', 'for', 'role'];
        for (var i = 0; i < A.length; i++) {
          var v = el.getAttribute(A[i]);
          if (v && v.length < 80) { var s = (i < 5 ? '' : tag) + '[' + A[i] + '="' + CSS.escape(v) + '"]'; if (uniq(s)) return s; }
        }
        if (tag === 'a' && el.getAttribute('href')) { var hs = 'a[href="' + CSS.escape(el.getAttribute('href')) + '"]'; if (uniq(hs)) return hs; }
        return null;
      }
      function stableFor(el) {
        var tag = el.tagName.toLowerCase();
        if (goodId(el.id) && uniq('#' + CSS.escape(el.id))) return '#' + CSS.escape(el.id);
        var a = attrSel(el, tag); if (a) return a;
        var cls = Array.prototype.filter.call(el.classList || [], goodClass).slice(0, 3);
        for (var k = 1; k <= cls.length; k++) { var s = tag + '.' + cls.slice(0, k).map(CSS.escape).join('.'); if (uniq(s)) return s; }
        /* climb to a stable ancestor and descend with the cheapest unique path */
        var anc = el.parentElement, depth = 0;
        while (anc && anc !== document.body && depth < 6) {
          var base = null;
          if (goodId(anc.id) && uniq('#' + CSS.escape(anc.id))) base = '#' + CSS.escape(anc.id);
          else base = attrSel(anc, anc.tagName.toLowerCase());
          if (!base) { var ac = Array.prototype.filter.call(anc.classList || [], goodClass)[0]; if (ac) { var t2 = anc.tagName.toLowerCase() + '.' + CSS.escape(ac); if (uniq(t2)) base = t2; } }
          if (base) {
            var tail = tag + (cls.length ? '.' + CSS.escape(cls[0]) : '');
            var s2 = base + ' ' + tail; if (uniq(s2)) return s2;
            var same = Array.prototype.filter.call(el.parentElement.children, function (c) { return c.tagName === el.tagName; });
            var s3 = base + ' ' + tag + ':nth-of-type(' + (same.indexOf(el) + 1) + ')'; if (uniq(s3)) return s3;
          }
          anc = anc.parentElement; depth++;
        }
        return selectorFor(el);                            /* the structural one — honest fallback */
      }
      function cssSnapshot(el) {
        var cs = getComputedStyle(el);
        return ['color', 'background-color', 'font-size', 'font-weight', 'padding', 'margin', 'display', 'border-radius'].map(function (p) { return p + ': ' + cs.getPropertyValue(p) + ';'; }).join('\n');
      }
      body.querySelector('#i-apply').addEventListener('click', function () {
        if (!picked || !picked.isConnected) { cst.style.display = ''; cst.textContent = SYFS.t('اختر عنصراً أولاً.'); return; }
        var n = 0, bad = 0;
        cssIn.value.split(/;|\n/).forEach(function (decl) {
          var i = decl.indexOf(':'); if (i <= 0) return;
          var prop = decl.slice(0, i).trim().toLowerCase(), val = decl.slice(i + 1).trim();
          if (!/^[a-z-]+$/.test(prop) || !val) { bad++; return; }
          /* the element's own inline style — the page's stylesheets are never touched */
          picked.style.setProperty(prop, val.replace(/!important$/i, '').trim(), /!important$/i.test(val) ? 'important' : '');
          if (picked.style.getPropertyValue(prop)) n++; else bad++;
        });
        cst.style.display = ''; cst.textContent = bad ? SYFS.t('طُبّقت {0} خاصية، ورُفضت {1} (اسم أو قيمة غير صالحة).', n, bad) : SYFS.t('طُبّقت {0} خاصية ✓', n);
      });
      body.querySelector('#i-reset').addEventListener('click', function () {
        if (!picked || !picked.isConnected) return;
        picked.style.cssText = pickedCss; cssIn.value = cssSnapshot(picked);
        cst.style.display = ''; cst.textContent = SYFS.t('أُعيد النمط الأصلي.');
      });
      body.querySelector('#i-scopy').addEventListener('click', function () { if (stableEl.value) copy(stableEl.value); });

      function ensureBox() {
        if (box) return;
        box = document.createElement('div');
        box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;background:rgba(69,115,100,.22);border:1px solid #457364;border-radius:2px;transition:all .04s;display:none';
        (document.body || document.documentElement).appendChild(box);
      }
      function isOurs(el) { return el === host || (host && host.contains(el)) || el === box; }
      /* CSS.escape everywhere: ids/classes like "1col", "w-1/2", "a:b" are legal in HTML but
         not as bare selectors (Tailwind) — unescaped, the copied selector throws */
      function selectorFor(el) {
        if (el.id) return '#' + CSS.escape(el.id);
        var parts = [], cur = el, depth = 0;
        while (cur && cur.nodeType === 1 && depth < 4) {
          var s = cur.tagName.toLowerCase();
          if (cur.classList && cur.classList.length) s += '.' + Array.prototype.slice.call(cur.classList).slice(0, 2).map(CSS.escape).join('.');
          var parent = cur.parentElement;
          if (parent) {
            var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === cur.tagName; });
            if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
          }
          parts.unshift(s);
          if (cur.id) { parts[0] = '#' + CSS.escape(cur.id); break; }
          cur = parent; depth++;
        }
        return parts.join(' > ');
      }
      function onMove(e) {
        if (!active) return;
        var el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || isOurs(el)) { box.style.display = 'none'; return; }
        var r = el.getBoundingClientRect();
        ensureBox();
        box.style.display = '';
        box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
        box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
      }
      function onClick(e) {
        if (!active) return;
        var el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || isOurs(el)) return;                   /* null: outside the viewport / a closed iframe */
        e.preventDefault(); e.stopPropagation();
        pick(el);
        stop();
      }
      /* the page must not see the press that picks: menus open and drags start on mousedown,
         before the click ever arrives */
      var SWALLOW = ['mousedown', 'mouseup', 'pointerdown', 'pointerup'];
      function onSwallow(e) {
        if (!active) return;
        var el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || isOurs(el)) return;
        e.preventDefault(); e.stopPropagation();
      }
      function onKey(e) { if (e.key === 'Escape') stop(); }
      function pick(el) {
        var cs = getComputedStyle(el), r = el.getBoundingClientRect();
        selEl.value = selectorFor(el);
        var lines = [
          '<' + el.tagName.toLowerCase() + '>' + (el.id ? ' #' + el.id : '') + (el.className && typeof el.className === 'string' ? ' .' + el.className.trim().split(/\s+/).join('.') : ''),
          'الحجم: ' + Math.round(r.width) + ' × ' + Math.round(r.height) + ' px',
          'color: ' + cs.color,
          'background: ' + cs.backgroundColor,
          'font: ' + cs.fontSize + ' / ' + cs.lineHeight + '  ' + cs.fontFamily,
          'font-weight: ' + cs.fontWeight,
          'padding: ' + cs.padding,
          'margin: ' + cs.margin,
          'display: ' + cs.display + '  ·  position: ' + cs.position
        ];
        info.textContent = lines.join('\n');
        picked = el; pickedCss = el.style.cssText;
        stableEl.value = stableFor(el);
        cssIn.value = cssSnapshot(el);
        cst.style.display = 'none';
        res.style.display = '';
      }
      function start() {
        if (active) return;
        active = true; ensureBox();
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKey, true);
        SWALLOW.forEach(function (t) { document.addEventListener(t, onSwallow, true); });
        watchdog = setInterval(function () { if (!body.isConnected) stop(); }, 400);
        body.querySelector('#i-go').textContent = SYFS.t('… يجري الاختيار (Esc للإلغاء)');
      }
      function stop() {
        active = false;
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKey, true);
        SWALLOW.forEach(function (t) { document.removeEventListener(t, onSwallow, true); });
        if (watchdog) { clearInterval(watchdog); watchdog = null; }
        if (box) { box.remove(); box = null; }
        var btn = body.querySelector('#i-go'); if (btn) btn.textContent = SYFS.t('🎯 ابدأ اختيار عنصر');
      }
      body.querySelector('#i-go').addEventListener('click', start);
      body.querySelector('#i-copy').addEventListener('click', function () { if (selEl.value) copy(selEl.value); });
    }
  });

  /* ===== Code minifier / beautifier (CSS + JS) ===== */
  function mountCode(body) {
      body.appendChild(h(
        '<div class="syf-form">' +
          '<div class="syf-seg" id="k-lang"><button class="on" data-l="css">CSS</button><button data-l="js">JS</button></div>' +
          '<textarea class="syf-in" id="k-in" rows="5" placeholder="الصق كود CSS أو JS" style="direction:ltr;font-family:ui-monospace,monospace"></textarea>' +
          '<div class="syf-row"><button class="syf-btn" id="k-min">تصغير</button><button class="syf-btn" id="k-beau">تنسيق/تجميل</button><button class="syf-mini" id="k-copy">نسخ</button></div>' +
          '<div class="syf-empty" id="k-st" style="display:none"></div>' +
          '<textarea class="syf-in" id="k-out" rows="6" readonly style="direction:ltr;font-family:ui-monospace,monospace"></textarea>' +
          '<div class="syf-note-hint">تصغير JS «آمن» (يحذف التعليقات ويضغط المسافات مع الحفاظ على الأسطر لتفادي كسر ASI) — ليس مصغّراً كاملاً. جرّب الناتج قبل الاعتماد.</div>' +
        '</div>'));
      var lang = 'css', out = body.querySelector('#k-out'), st = body.querySelector('#k-st'), seg = body.querySelector('#k-lang');
      function show(msg, ok) { st.style.display = ''; st.textContent = msg; st.style.color = ok ? '' : '#c0392b'; }
      seg.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; lang = b.dataset.l; seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); });
      function run(fn, label) {
        var src = body.querySelector('#k-in').value;
        if (!src.trim()) { show(SYFS.t('الصق كوداً أولاً.'), false); return; }
        try { out.value = fn(src); var before = src.length, after = out.value.length; show(SYFS.t('{0} ✓  ({1} → {2} حرف)', label, before, after), true); }
        catch (e) { out.value = ''; show(SYFS.t('خطأ: {0}', e.message), false); }
      }
      body.querySelector('#k-min').addEventListener('click', function () { run(lang === 'css' ? minifyCss : minifyJs, 'تصغير'); });
      body.querySelector('#k-beau').addEventListener('click', function () { run(lang === 'css' ? beautifyCss : beautifyJs, 'تنسيق'); });
      body.querySelector('#k-copy').addEventListener('click', function () { if (out.value) copy(out.value); });
  }

  /* ===== CSV ⇄ JSON ===== */
  function mountCsv(body) {
      body.appendChild(h(
        '<div class="syf-form">' +
          '<textarea class="syf-in" id="v-in" rows="5" placeholder="الصق CSV (أول سطر = الرؤوس) أو JSON (مصفوفة كائنات)" style="direction:ltr;font-family:ui-monospace,monospace"></textarea>' +
          '<div class="syf-row"><button class="syf-btn" id="v-c2j">CSV → JSON</button><button class="syf-btn" id="v-j2c">JSON → CSV</button><button class="syf-mini" id="v-copy">نسخ</button></div>' +
          '<div class="syf-empty" id="v-st" style="display:none"></div>' +
          '<textarea class="syf-in" id="v-out" rows="6" readonly style="direction:ltr;font-family:ui-monospace,monospace"></textarea>' +
        '</div>'));
      var out = body.querySelector('#v-out'), st = body.querySelector('#v-st');
      function show(msg, ok) { st.style.display = ''; st.textContent = msg; st.style.color = ok ? '' : '#c0392b'; }
      function run(fn, label) {
        var src = body.querySelector('#v-in').value;
        if (!src.trim()) { show(SYFS.t('الصق بيانات أولاً.'), false); return; }
        try { out.value = fn(src); show(label + ' ✓', true); }
        catch (e) { out.value = ''; show(SYFS.t('خطأ: {0}', e.message), false); }
      }
      body.querySelector('#v-c2j').addEventListener('click', function () { run(csvToJson, 'CSV → JSON'); });
      body.querySelector('#v-j2c').addEventListener('click', function () { run(jsonToCsv, 'JSON → CSV'); });
      body.querySelector('#v-copy').addEventListener('click', function () { if (out.value) copy(out.value); });
  }

  /* ===== Device preview — open this page in a device-sized window ===== */
  SYFS.tools.push({
    id: 'devviewport', name: 'معاينة الأجهزة', cat: 'dev',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="14" height="10" rx="1"/><rect x="17" y="7" width="5" height="10" rx="1"/><path d="M6 18h6"/></svg>',
    mount: function (body) {
      var DEVICES = [
        { k: 'mobile', name: '📱 جوال', w: 375, h: 667 },
        { k: 'mobilel', name: '📱 جوال كبير', w: 414, h: 896 },
        { k: 'tablet', name: '📲 تابلت', w: 768, h: 1024 },
        { k: 'laptop', name: '💻 لابتوب', w: 1366, h: 768 },
        { k: 'desktop', name: '🖥️ كمبيوتر', w: 1280, h: 800 }
      ];
      var btns = DEVICES.map(function (d) { return '<button class="syf-mini" data-k="' + d.k + '">' + d.name + '<br><small>' + d.w + '×' + d.h + '</small></button>'; }).join('');
      var ui = h(
        '<div class="syf-form">' +
          '<div class="syf-out" style="grid-template-columns:1fr 1fr"><div><span>عرض النافذة الحالية</span><b id="vp-now">—</b></div><div><span>الفئة</span><b id="vp-bucket">—</b></div></div>' +
          '<label>افتح هذه الصفحة بمقاس جهاز</label>' +
          '<div class="syf-seg" id="vp-dev" style="flex-wrap:wrap;gap:6px">' + btns + '</div>' +
          '<div class="syf-row"><input type="number" id="vp-w" class="syf-in" placeholder="العرض" style="width:80px" value="390"> × <input type="number" id="vp-h" class="syf-in" placeholder="الارتفاع" style="width:80px" value="844"> <label class="syf-ck" style="white-space:nowrap"><input type="checkbox" id="vp-rot"> تدوير</label></div>' +
          '<button class="syf-btn" id="vp-open">فتح بالمقاس المخصّص</button>' +
          '<div class="syf-note-hint">يفتح نافذة منبثقة بعرض الجهاز فيتفاعل تصميم الموقع المتجاوب (breakpoints). ملاحظة: هو معاينة عرض (width) — لا يزيّف نوع الجهاز (User-Agent). لمحاكاة كاملة استخدم DevTools (F12 → Toggle device).</div>' +
        '</div>'
      );
      body.appendChild(ui);

      function bucket(w) { return w < 480 ? 'جوال' : w < 768 ? 'جوال كبير' : w < 1024 ? 'تابلت' : w < 1440 ? 'لابتوب' : 'كمبيوتر'; }
      function refresh() {
        ui.querySelector('#vp-now').textContent = window.innerWidth + '×' + window.innerHeight + ' · DPR ' + (window.devicePixelRatio || 1);
        ui.querySelector('#vp-bucket').textContent = bucket(window.innerWidth);
      }
      refresh();
      function openAt(w, hh, rot) {
        if (rot) { var t = w; w = hh; hh = t; }
        w = Math.max(200, Math.min(3000, w | 0)); hh = Math.max(200, Math.min(2000, hh | 0));
        try {
          window.open(location.href, '_blank', 'popup=yes,width=' + w + ',height=' + hh + ',noopener');
        } catch (e) { /* ignore */ }
      }
      ui.querySelector('#vp-dev').addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        var d = DEVICES.filter(function (x) { return x.k === b.dataset.k; })[0];
        if (d) openAt(d.w, d.h, ui.querySelector('#vp-rot').checked);
      });
      ui.querySelector('#vp-open').addEventListener('click', function () {
        openAt(parseInt(ui.querySelector('#vp-w').value, 10) || 390, parseInt(ui.querySelector('#vp-h').value, 10) || 844, ui.querySelector('#vp-rot').checked);
      });
    }
  });
}());
