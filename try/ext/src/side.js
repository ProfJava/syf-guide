/* SYF — اللوحة الجانبية (v0.136.0): يقود `side.html` داخل لوحة كروم الجانبية.
 *
 * العقد مع العامل الخلفي:
 *   · `SYFS_PANEL {op:'arm', host}`  ⇒ قاعدة جلسة تُسقط `x-frame-options` و`content-security-policy`
 *     لذلك المضيف في الإطارات، وتُزال عند `op:'off'`. القاعدة تحيا ما دامت اللوحة مفتوحة فقط.
 *   · `SYFS_PANEL {op:'off'}`        ⇒ عند إغلاق اللوحة (`pagehide`)، فلا يبقى دفاعٌ مُسقطاً بعدها.
 *   · `SYFS_SIDE   {url}`            ⇒ «افتحه في نافذة» — المخرج حين يرفض الموقع الإطار رفضاً لا
 *     تُصلحه ترويسة (جافاسكربت الموقع نفسه، أو `COEP` لا يُسقط بقاعدة).
 *
 * ⚠️ الرابط يأتي من التخزين (`panel_url`) لا من `location.search`: صفحة اللوحة يفتحها كروم
 *    نفسه عند إعادة الفتح بلا معاملاتنا، فقراءة `?u=` كانت ستُفرغ اللوحة عشوائياً.
 * ⚠️ لا نقرأ محتوى الإطار ولا نلمسه — أصلٌ آخر، والامتداد لا يحقن فيه شيئاً هنا.
 */
(function () {
  var store = (window.SYFS && SYFS.store) || null;
  /* i18n-via: T — passes its argument to the dictionary whenever it is loaded */
  function T(s, a) { return (window.SYFS && SYFS.t) ? SYFS.t(s, a) : s; }
  function $(id) { return document.getElementById(id); }

  /* i18n-dyn: أسماء منصّات، لا تُترجَم */
  var SITES = [
    { t: 'WhatsApp',  u: 'https://web.whatsapp.com' },
    { t: 'Messenger', u: 'https://www.messenger.com' },
    { t: 'Telegram',  u: 'https://web.telegram.org' },
    { t: 'Gmail',     u: 'https://mail.google.com' },
    { t: 'ChatGPT',   u: 'https://chatgpt.com' }
  ];

  var frame = $('sp-frame'), hostEl = $('sp-host'), note = $('sp-note'), noteT = $('sp-note-t');
  var picker = $('sp-picker'), urlRow = $('sp-urlrow'), urlIn = $('sp-input');
  var current = '', stallT = 0, loaded = false;

  function bg(type, extra) {
    try { chrome.runtime.sendMessage(Object.assign({ type: type }, extra || {}), function () { void chrome.runtime.lastError; }); } catch (e) {}
  }
  function safe(raw) {
    var u;
    try { u = new URL(String(raw || '')); } catch (e) { return null; }
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u : null;
  }

  function showNote(msg) { noteT.textContent = msg; note.classList.add('show'); }
  function hideNote() { note.classList.remove('show'); }

  /* ===== قفل واتساب/ماسنجر داخل اللوحة (v0.139.1) =====
   * ⛔ `wa-lock.js` سكربت محتوى للإطار الرئيسي (`all_frames:false`) والموقع هنا **إطار داخلي**،
   * فحتى v0.139.0 كانت اللوحة تعرض واتساب مفتوحاً والقفل مسلّح — تجاوزٌ بلا أدوات مطوّر.
   * البوّابة هنا لا في الإطار: صفحة اللوحة صفحة إضافة، فلا يطلب الإطارُ الموقعَ أصلاً قبل
   * كلمة المرور (لا قاعدة DNR ولا `src`) — لا سباق مع رسم الموقع، ولا اعتماد على حقن
   * سكربت في إطارٍ داخل صفحة إضافة. نفس المفاتيح ونفس الاشتقاق (PBKDF2-SHA256) في
   * `wa-lock.js`. رادعٌ للنظر كالأصل، لا تشفير. */
  var LOCKS = {
    'web.whatsapp.com': { key: 'wa_lock', title: 'واتساب ويب مقفول' },
    'www.messenger.com': { key: 'ms_lock', title: 'ماسنجر مقفول' },
    /* the panel cannot see the frame's path, so all of facebook.com is gated — the
       messenger dock and /messages are one click away from any page there */
    'www.facebook.com': { key: 'ms_lock', title: 'ماسنجر مقفول' },
    'web.facebook.com': { key: 'ms_lock', title: 'ماسنجر مقفول' }
  };
  var opened = {};                 /* lock key ⇒ unlocked for THIS panel session only */
  var gateCfg = null, gateKey = '', gateUrl = '';
  var lockEl = $('sp-lock'), lockT = $('sp-lock-t'), lockIn = $('sp-lock-in'), lockGo = $('sp-lock-go'), lockMsg = $('sp-lock-msg');
  lockIn.placeholder = T('كلمة المرور');

  /* same whitelist as normalize() in wa-lock.js: an imported value must not choose
     the iteration count, and a half-written config is «not armed», never «armed» */
  function lockCfg(raw) {
    if (!raw || typeof raw !== 'object' || raw.on !== true) return null;
    if (typeof raw.hash !== 'string' || !/^[0-9a-f]{64}$/.test(raw.hash)) return null;
    if (typeof raw.salt !== 'string' || !/^([0-9a-f]{2})+$/.test(raw.salt)) return null;
    var it = parseInt(raw.iters, 10);
    return { hash: raw.hash, salt: raw.salt, iters: (isFinite(it) && it >= 100000 && it <= 1000000) ? it : 200000, onHide: raw.onHide !== false };
  }
  function lockOf(u) { return Object.prototype.hasOwnProperty.call(LOCKS, u.hostname) ? LOCKS[u.hostname] : null; }
  function readLock(key) {
    return new Promise(function (res) {
      try { chrome.storage.local.get(key, function (r) { void chrome.runtime.lastError; res(lockCfg(r && r[key])); }); }
      catch (e) { res(null); }
    });
  }
  function pbkdf2Hex(pass, saltHex, iters) {
    var salt = new Uint8Array(saltHex.length / 2);
    for (var i = 0; i < salt.length; i++) salt[i] = parseInt(saltHex.substr(i * 2, 2), 16);
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits'])
      .then(function (k) { return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iters }, k, 256); })
      .then(function (buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; });
  }
  function showGate(u, lk, cfg) {
    gateCfg = cfg; gateKey = lk.key; gateUrl = u.href;
    /* nothing of the site may stay on screen behind the gate */
    clearTimeout(stallT); hideNote();
    frame.removeAttribute('src');
    try { frame.contentWindow && frame.contentWindow.location.replace('about:blank'); } catch (e) { frame.src = 'about:blank'; }
    bg('SYFS_PANEL', { op: 'off' });
    lockT.textContent = T(lk.title);            /* i18n-dyn: one of the two msgids in LOCKS */
    lockMsg.textContent = '';
    lockIn.value = '';
    lockEl.classList.add('show');
    try { lockIn.focus(); } catch (e) {}
  }
  function tryUnlock() {
    var v = lockIn.value;
    if (!v || !gateCfg) return;
    lockGo.disabled = true; lockMsg.textContent = '';
    pbkdf2Hex(v, gateCfg.salt, gateCfg.iters).then(function (hex) {
      lockGo.disabled = false;
      if (hex !== gateCfg.hash) { lockMsg.textContent = T('كلمة مرور خاطئة'); lockIn.value = ''; lockIn.focus(); return; }
      opened[gateKey] = true;
      lockEl.classList.remove('show');
      lockIn.value = '';
      proceed(safe(gateUrl));
    }).catch(function () { lockGo.disabled = false; lockMsg.textContent = T('تعذّر التحقق — أعد المحاولة'); });
  }
  lockGo.addEventListener('click', tryUnlock);
  lockIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryUnlock(); });
  /* relock the way the page lock does: hiding the panel (onHide), or «اقفل الآن» from
     the rail tool (`<key>_cmd`). A lock removed in the tool opens the gate. */
  function relock(key) {
    var u = safe(current), lk = u && lockOf(u);
    if (!lk || lk.key !== key) { opened[key] = false; return; }
    readLock(key).then(function (cfg) { opened[key] = false; if (cfg) showGate(u, lk, cfg); });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'hidden') return;
    Object.keys(opened).forEach(function (k) {
      if (!opened[k]) return;
      readLock(k).then(function (cfg) { if (cfg && cfg.onHide) relock(k); });
    });
  });
  try {
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area !== 'local') return;
      ['wa_lock', 'ms_lock'].forEach(function (k) {
        var cmd = ch[k + '_cmd'];
        if (cmd && cmd.newValue && cmd.newValue.op === 'lock') relock(k);
        if (ch[k] && gateKey === k && lockEl.classList.contains('show') && !lockCfg(ch[k].newValue)) {
          lockEl.classList.remove('show'); proceed(safe(gateUrl));
        }
      });
    });
  } catch (e) {}

  function load(raw) {
    var u = safe(raw);
    if (!u) return;
    current = u.href;
    hostEl.textContent = u.host;                                  /* i18n-dyn: مضيف، لا نثر */
    if (store) store.set('panel_url', current);
    paintPicker();
    lockEl.classList.remove('show');
    var lk = lockOf(u);
    if (!lk || opened[lk.key]) { proceed(u); return; }
    /* ⛔ no request to the site until the lock answers — the frame stays blank meanwhile */
    frame.removeAttribute('src');
    readLock(lk.key).then(function (cfg) {
      if (current !== u.href) return;                            /* the user moved on */
      if (cfg) showGate(u, lk, cfg); else proceed(u);
    });
  }

  function proceed(u) {
    if (!u || current !== u.href) return;
    loaded = false;
    hideNote();
    /* arm the header strip BEFORE the request goes out — a rule added after the load
       has nothing left to strip, and the frame is already refused. */
    /* ⚠️ the frame waits for the worker's ANSWER, not a fixed 60ms (v0.139.2): on a
       cold worker the rule landed after the response headers, the frame was refused,
       and it «worked the second time» — the bug rail.js openFrame fixed long ago.
       A worker that never answers still loads the frame after 1.5s. */
    var armedFor = current, go = function () { if (current === armedFor && !frame.getAttribute('src')) frame.src = current; };
    frame.removeAttribute('src');
    var armT = setTimeout(go, 1500);
    try {
      chrome.runtime.sendMessage({ type: 'SYFS_PANEL', op: 'arm', host: u.hostname }, function () {
        void chrome.runtime.lastError; clearTimeout(armT); go();
      });
    } catch (e) { clearTimeout(armT); go(); }
    clearTimeout(stallT);
    /* a refused frame fires `load` on an empty document, so a timer is the only honest
       signal: nothing painted by now means it did not come. */
    stallT = setTimeout(function () {
      if (!loaded) showNote(T('الموقع لم يفتح داخل اللوحة — قد يكون يرفض العرض في إطار.'));
    }, 9000);
    paintPicker();
  }

  frame.addEventListener('load', function () {
    /* a cross-origin frame tells us nothing but «something arrived» — enough to stop the
       stall timer from accusing a site that did load. */
    loaded = true;
    clearTimeout(stallT);
  });

  function paintPicker() {
    picker.innerHTML = '';
    SITES.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = s.t;
      if (current.indexOf(s.u) === 0) b.className = 'on';
      b.addEventListener('click', function () { load(s.u); });
      picker.appendChild(b);
    });
  }

  $('sp-reload').addEventListener('click', function () { if (current) load(current); });
  $('sp-pop').addEventListener('click', function () { if (current) bg('SYFS_SIDE', { url: current, shrink: false }); });
  $('sp-note-pop').addEventListener('click', function () { if (current) bg('SYFS_SIDE', { url: current, shrink: false }); });
  $('sp-note-retry').addEventListener('click', function () { if (current) load(current); });
  $('sp-url').addEventListener('click', function () {
    urlRow.classList.toggle('show');
    if (urlRow.classList.contains('show')) { urlIn.value = current; urlIn.focus(); urlIn.select(); }
  });
  function go() {
    var v = (urlIn.value || '').trim();
    if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
    if (!safe(v)) { urlIn.focus(); return; }                      /* رفض لا تصحيح (§4.1) */
    urlRow.classList.remove('show');
    load(v);
  }
  $('sp-go').addEventListener('click', go);
  urlIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });

  /* the strip must not outlive the panel */
  window.addEventListener('pagehide', function () { bg('SYFS_PANEL', { op: 'off' }); });

  if (store) {
    store.get('panel_url', 'https://web.whatsapp.com').then(function (v) { load(v || 'https://web.whatsapp.com'); });
  } else {
    load('https://web.whatsapp.com');
  }
}());
