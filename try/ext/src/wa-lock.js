/* SYF — «قفل واتساب» / «قفل ماسنجر»: password lock screen for web.whatsapp.com and
 * (v0.119.0) www.messenger.com. Separate document_start content script (registered
 * ONLY for those two hosts in the manifest) so the opaque overlay covers the page
 * BEFORE any chat content can paint. Companion of src/wa-privacy.js (the rail tools
 * that set the password + options via chrome.storage — one tool per site).
 *
 * The two locks share nothing but this code: each host reads ITS OWN keys
 * ('wa_lock' / 'ms_lock'), so a password set for WhatsApp never opens Messenger and
 * removing one leaves the other armed. The Messenger lock also runs on
 * www/web.facebook.com but ONLY while the path is /messages: the feed is never
 * hidden, and because facebook.com moves feed ⇄ /messages without a load, a lock
 * that fires off-path is *deferred* (`relock`) and applied the moment /messages is
 * entered (path watched by popstate + a 500ms poll).
 * ⚠️ Known gap: the floating chat windows on the facebook.com feed are NOT hidden —
 * they have no stable selector, and hiding the whole feed is what this design
 * refuses. Their desktop notifications ARE masked while the lock is on (below).
 *
 * Security model (stated in the tool UI too): this is a *viewing deterrent*,
 * not encryption — anyone who controls the machine can disable the extension.
 * The password itself is never stored: only PBKDF2-SHA256(200k, 16B salt)
 * hex digest + salt live in chrome.storage.local.
 * Runs standalone: storage.js (SYFS.store) is NOT loaded at document_start. */
(function () {
  'use strict';

  /* which chat is this tab? keys and title follow the host; unknown host ⇒ inert */
  var MS_PATH = /^\/messages(\/|$)/;
  var HOSTS = {
    'web.whatsapp.com': { key: 'wa', title: 'واتساب ويب مقفول' },
    'www.messenger.com': { key: 'ms', title: 'ماسنجر مقفول' },
    'www.facebook.com': { key: 'ms', title: 'ماسنجر مقفول', path: MS_PATH },
    'web.facebook.com': { key: 'ms', title: 'ماسنجر مقفول', path: MS_PATH }
  };
  var SITE = Object.prototype.hasOwnProperty.call(HOSTS, location.hostname) ? HOSTS[location.hostname] : null;
  if (!SITE) return;
  var LOCK_KEY = SITE.key + '_lock';
  var CMD_KEY = SITE.key + '_lock_cmd';
  var DEFAULTS = { on: false, hash: '', salt: '', iters: 200000, onHide: true, idleMin: 0 };

  var cfg = null;          /* current normalized config */
  var overlay = null, hideStyle = null, msgEl = null, inputEl = null;
  var locked = false, idleTimer = 0;
  var relock = false;      /* a lock requested off-path (facebook feed) — applied on entering /messages */

  function onPath() { return SITE.path ? SITE.path.test(location.pathname) : true; }

  function normalize(raw) {
    var c = { on: false, hash: '', salt: '', iters: 200000, onHide: true, idleMin: 0 };
    if (raw && typeof raw === 'object') {
      c.on = raw.on === true;
      c.hash = typeof raw.hash === 'string' ? raw.hash : '';
      c.salt = typeof raw.salt === 'string' ? raw.salt : '';
      var it = parseInt(raw.iters, 10); c.iters = (isFinite(it) && it >= 100000 && it <= 1000000) ? it : 200000;
      c.onHide = raw.onHide !== false;
      var m = parseInt(raw.idleMin, 10); c.idleMin = [0, 1, 5, 15, 30].indexOf(m) >= 0 ? m : 0;
    }
    return c;
  }
  function armed() { return !!(cfg && cfg.on && cfg.hash && cfg.salt); }

  /* ---- PBKDF2-SHA256 → hex (same derivation as the tool that set it) ---- */
  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function bytesToHex(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  }
  function waHash(pass, saltHex, iters) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits'])
      .then(function (key) {
        return crypto.subtle.deriveBits(
          { name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(saltHex), iterations: iters }, key, 256);
      })
      .then(bytesToHex);
  }

  /* ⛔ الترجمة هنا بحارس محلّي، و`SYFS.t` ممنوعة مباشرةً (v0.104.0).
   * هذا الملفّ يعمل عند `document_start` و`src/i18n.js` لا يُحقن قبل `document_idle` ⇒
   * نداء مباشر يرمي `TypeError` **بعد** `locked = true` وبعد حقن
   * `body{visibility:hidden}` وقبل إلحاق حقل كلمة المرور: صفحة سوداء بلا مدخل وسياج
   * مفاتيح يبتلع كل شيء، ولا مخرج داخل التبويب. الميزة لم تعمل قطّ حتى v0.103.0.
   * نفس الاستثناء المكتوب في §6.101/7 لـ`vault.js` و`editor.js` — صفحاتهما لا تحمّل
   * القاموس فاللفّ يرمي. والفقدان يُرجع المُعرّف أي العربية، وهي اللغة الافتراضية. */
  /* i18n-via: T, say — كلتاهما تمرّان النصّ على القاموس متى وُجد */
  function T(s) { return (window.SYFS && typeof SYFS.t === 'function') ? SYFS.t(s) : s; }
  /* القاموس قد يصل بعد أول قفل (نفس التبويب، قفلٌ لاحق بالخمول أو بـCtrl+Shift+L)،
     والطبقة تُبنى مرّة وتُعاد استخدامها ⇒ نحتفظ بالمُعرّفات ونعيد الطلاء عند كل قفل.
     ⚠️ الـmsgid **أوّل وسيط**: بوّابة موضع النداء تقرأ ما يسبق النصّ مباشرةً، ونصّ يجيء
     ثانياً لا تراه — والإعلان الذي لا يُفحَص إعلانٌ يكذب. */
  var texts = [];
  function say(msgid, el, prop) { texts.push([el, msgid, prop || 'textContent']); el[prop || 'textContent'] = T(msgid); }
  function retext() { for (var i = 0; i < texts.length; i++) texts[i][0][texts[i][2]] = T(texts[i][1]); }

  /* ---- keyboard fence: nothing reaches the page while locked ---- */
  function fence(e) {
    if (!locked) return;
    if (overlay && overlay.contains(e.target)) return;   /* overlay's own input works */
    e.stopImmediatePropagation();
    if (e.type === 'keydown') e.preventDefault();
  }
  ['keydown', 'keypress', 'keyup', 'paste'].forEach(function (t) {
    window.addEventListener(t, fence, true);
  });

  /* ---- system notifications while locked (v0.139.3) ----
   * The overlay hid the chat, but the site's own desktop notification still printed
   * the sender and the message on the screen the lock was meant to guard. The page's
   * Notification lives in the MAIN world, out of this script's reach, so the worker
   * wraps it there (SYFS_LOCK_GUARD → `lockNotifGuard` in background.js). The two
   * worlds share only the DOM: this attribute, when present, is the generic title the
   * wrapper shows INSTEAD of sender + text. Absent ⇒ notifications pass untouched.
   * ⚠️ Not covered: a push shown by the site's service worker while no tab is open. */
  var GUARD_ATTR = 'data-syfs-locked';
  var guardAsked = false;
  function guard(on) {
    var root = document.documentElement;
    if (!root) return;
    if (!on) { root.removeAttribute(GUARD_ATTR); return; }
    root.setAttribute(GUARD_ATTR, T('رسالة جديدة — افتح القفل لقراءتها'));
    if (guardAsked) return;
    guardAsked = true;
    try { chrome.runtime.sendMessage({ type: 'SYFS_LOCK_GUARD' }, function () { void chrome.runtime.lastError; }); } catch (e) {}
  }

  /* ---- overlay ---- */
  function lock() {
    if (locked || !armed()) return;
    guard(true);                                /* deferred or not, the lock is ON */
    if (!onPath()) { relock = true; return; }   /* feed: defer until /messages */
    relock = false;
    locked = true;
    clearTimeout(idleTimer);
    var root = document.documentElement;

    if (!hideStyle) {
      hideStyle = document.createElement('style');
      hideStyle.textContent = 'body{visibility:hidden!important}';   /* static string */
    }
    if (!hideStyle.isConnected) root.appendChild(hideStyle);

    /* ⛔ بناء الطبقة داخل try: أي رمية هنا كانت تترك `locked = true` وصفحةً مخفيّة بلا
       طبقة (أو بطبقة نصف مبنيّة يُلحقها المراقب أدناه). الفشل يجب أن يفتح الصفحة لا أن
       يحبس صاحبها فيها — قفلٌ رادع للنظر لا يستحقّ أن يصادر التبويب حين ينكسر. */
    try {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.dir = 'rtl';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0b141a;display:flex;' +
        'align-items:center;justify-content:center;font:15px/1.7 system-ui,sans-serif;color:#e9edef';
      var box = document.createElement('div');
      box.style.cssText = 'display:flex;flex-direction:column;gap:12px;align-items:center;max-width:320px;padding:24px;text-align:center';
      var ic = document.createElement('div');
      ic.textContent = '🔒'; ic.style.cssText = 'font-size:42px';
      var tt = document.createElement('div');
      /* i18n-dyn: SITE.title is one of the two msgids in HOSTS above */
      say(SITE.title, tt); tt.style.cssText = 'font-size:18px;font-weight:700';
      inputEl = document.createElement('input');
      inputEl.type = 'password'; say('كلمة المرور', inputEl, 'placeholder');
      inputEl.autocomplete = 'off'; inputEl.dir = 'ltr';
      inputEl.style.cssText = 'width:230px;padding:10px 12px;border-radius:8px;border:1px solid #33434e;' +
        'background:#202c33;color:#e9edef;font-size:15px;outline:none;text-align:center';
      var btn = document.createElement('button');
      say('فتح', btn); btn.type = 'button';
      btn.style.cssText = 'width:230px;padding:10px 12px;border-radius:8px;border:none;background:#457364;' +
        'color:#fff;font-size:15px;font-weight:700;cursor:pointer';
      msgEl = document.createElement('div');
      msgEl.style.cssText = 'min-height:20px;font-size:13px;color:#f28b82';
      var hint = document.createElement('div');
      say('SYF — قفل رادع للنظر (ليس تشفيراً). Ctrl+Shift+L للقفل الفوري.', hint);
      hint.style.cssText = 'font-size:11px;color:#8696a0';
      box.appendChild(ic); box.appendChild(tt); box.appendChild(inputEl);
      box.appendChild(btn); box.appendChild(msgEl); box.appendChild(hint);
      overlay.appendChild(box);

      function attempt() {
        var v = inputEl.value;
        if (!v) return;
        btn.disabled = true; msgEl.textContent = '';
        waHash(v, cfg.salt, cfg.iters).then(function (hex) {
          btn.disabled = false;
          if (hex === cfg.hash) { unlock(); return; }
          msgEl.textContent = T('كلمة مرور خاطئة');
          inputEl.value = ''; inputEl.focus();
        }).catch(function () { btn.disabled = false; msgEl.textContent = T('تعذّر التحقق — أعد المحاولة'); });
      }
      btn.addEventListener('click', attempt);
      inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') attempt(); });
    }
    retext();                                  /* القاموس قد يكون وصل بعد بناء الطبقة */
    if (!overlay.isConnected) root.appendChild(overlay);
    inputEl.value = ''; if (msgEl) msgEl.textContent = '';
    try { inputEl.focus(); } catch (e) {}
    } catch (e) {
      /* لم تكتمل الطبقة ⇒ لا نُبقي الصفحة مخفيّة بلا مدخل. نُرجع كل شيء ونترك القفل
         مطفأً في هذا التبويب: قفلٌ لا يعمل خيرٌ من تبويب لا يُفتح. */
      locked = false;
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlay = null; inputEl = null; msgEl = null; texts = [];
      if (hideStyle && hideStyle.parentNode) hideStyle.parentNode.removeChild(hideStyle);
      guard(false);
    }
  }

  function unlock() {
    locked = false; relock = false;
    guard(false);
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (hideStyle && hideStyle.parentNode) hideStyle.parentNode.removeChild(hideStyle);
    armIdle();
  }

  /* facebook.com is a SPA: entering /messages from the feed never reloads, so a
     deferred lock is applied here. Leaving /messages while locked is impossible
     (the overlay swallows input), so no unlock path is needed. */
  if (SITE.path) {
    var lastPath = location.pathname;
    var pathCheck = function () {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      if (relock && armed() && onPath()) lock();
    };
    window.addEventListener('popstate', pathCheck);
    setInterval(pathCheck, 500);
  }

  /* ---- auto-lock ---- */
  function armIdle() {
    clearTimeout(idleTimer);
    if (!armed() || locked || !cfg.idleMin) return;
    idleTimer = setTimeout(lock, cfg.idleMin * 60000);
  }
  ['pointerdown', 'pointermove', 'keydown', 'wheel'].forEach(function (t) {
    window.addEventListener(t, function () { if (!locked) armIdle(); }, { capture: true, passive: true });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && armed() && cfg.onHide) lock();
  });

  /* Ctrl+Shift+L — instant lock (listener runs before the fence removes it? fence
   * only swallows events while ALREADY locked, so this always sees the combo) */
  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
      if (armed() && !locked) { e.preventDefault(); lock(); }
    }
  }, true);

  /* keep overlay attached if the SPA rewrites <html> children */
  new MutationObserver(function () {
    if (!locked) return;
    var root = document.documentElement;
    if (overlay && !overlay.isConnected) root.appendChild(overlay);
    if (hideStyle && !hideStyle.isConnected) root.appendChild(hideStyle);
  }).observe(document.documentElement, { childList: true });

  /* ---- boot + live config ---- */
  try {
    chrome.storage.local.get(LOCK_KEY, function (st) {
      cfg = normalize(st && st[LOCK_KEY]);
      if (armed()) lock(); else armIdle();
    });
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area !== 'local') return;
      if (ch[LOCK_KEY]) {
        cfg = normalize(ch[LOCK_KEY].newValue);
        if (!armed() && (locked || relock)) unlock();   /* lock legitimately removed from the tool */
        armIdle();
      }
      if (ch[CMD_KEY] && ch[CMD_KEY].newValue && ch[CMD_KEY].newValue.op === 'lock') {
        if (armed()) lock();
      }
    });
  } catch (e) { /* not in extension context */ }
}());
