/* SYF — chat privacy tools: «خصوصية واتساب» (web.whatsapp.com) and, since v0.119.0,
 * «خصوصية ماسنجر» (messenger.com + facebook.com/messages). ONE engine, TWO sites, each
 * with its OWN tool, storage keys, selectors and lock — nothing is shared at run time
 * but the code. Replaces the old multi-site chatprivacy.js (removed in v0.33.0 by user
 * decision) with a focused clone of "Privacy Extension for WhatsApp Web":
 *   1. Screen lock — password overlay + auto-lock; the overlay itself lives in
 *      src/wa-lock.js (document_start, the two chat hosts only) so chats never paint
 *      before the lock. This file only manages its settings ('wa_lock' / 'ms_lock' in
 *      chrome.storage; PBKDF2-SHA256 hash — never the password).
 *   2. Selective blur with hover reveal — independent toggles per element kind
 *      (names, avatars, previews, messages, media, text input). CSS-first: one
 *      generated <style> + classes on <html>; reads NO content.
 *   3. One-keystroke actions registered as tools (`noRail`): `waopen` Ctrl+Alt+W opens
 *      web.whatsapp.com · `wablur` Ctrl+Alt+B toggles the WhatsApp blur — from ANY page,
 *      because the blur is a stored flag every tab of that site follows. Messenger gets
 *      the same two actions (`msopen` Ctrl+Alt+M / `msblur` Ctrl+Alt+N, shipped since
 *      v0.179.0 at the user's request). Ctrl+Shift+L (lock now) stays in src/wa-lock.js: it only means
 *      something on the chat tab itself.
 * Loaded BEFORE src/rail.js so SYFS.tools / SYFS.cats are populated. */
(function () {
  window.SYFS = window.SYFS || {};
  /* v0.179.0 — this file is ALSO injected (with storage.js) into every frame of the chat
     hosts: «افتح واتساب/ماسنجر» docks the site inside side.html's <iframe>, where the
     main bundle (all_frames:false) never ran — the toggle said «التمويه مفعّل ✓» and
     nothing blurred. On the top frame both entries load it; the first one wins. */
  if (SYFS.waPrivacyLoaded) return;
  SYFS.waPrivacyLoaded = true;
  var store = SYFS.store;
  var IN_FRAME = (function () { try { return window.top !== window; } catch (e) { return true; } }());
  var HOST = (location.hostname || '').toLowerCase();

  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    /* the template's own text IS the msgid — translate the built tree rather than
       splitting the markup (see src/i18n.js). Free in the default language. */
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }

  /* ---- shared PBKDF2 derivation (must match src/wa-lock.js) ---- */
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
  function randomSaltHex() {
    var b = new Uint8Array(16); crypto.getRandomValues(b); return bytesToHex(b.buffer);
  }

  /* ================= the two sites ================= */

  var BLUR_KEYS = ['names', 'avatars', 'preview', 'messages', 'media', 'input'];
  var BLUR_LABEL = {
    names: 'أسماء المستخدمين والمجموعات', avatars: 'الصور الشخصية', preview: 'معاينة آخر رسالة',
    messages: 'رسائل المحادثة المفتوحة', media: 'الوسائط (صور/فيديو)', input: 'خانة الكتابة'
  };

  var SITES = [
    {
      key: 'wa',                                   /* storage: wa_blur · wa_lock · wa_lock_cmd */
      cls: 'syfswa',                               /* html class + CSS variable prefix */
      hosts: /(^|\.)web\.whatsapp\.com$/,
      /* the blur applies on every page of the host */
      onPath: function () { return true; },
      url: 'https://web.whatsapp.com',
      lockHost: /^web\.whatsapp\.com$/,
      name: 'خصوصية واتساب', openName: 'افتح واتساب ويب', blurName: 'تبديل تمويه واتساب',
      openLabel: '💬 افتح واتساب ويب',
      scope: 'الأداة تعمل على web.whatsapp.com — الإعدادات هنا تُحفظ وتسري هناك.',
      lockNow: '🔒 اقفل واتساب الآن',
      saved: 'حُفظ — واتساب سيُقفل بهذه الكلمة ✓',
      keys: 'اختصارات من أي صفحة: <b>Ctrl+Alt+W</b> فتح واتساب ويب · <b>Ctrl+Alt+B</b> تبديل التمويه (تُغيَّر من تبويب «المفاتيح» في الإعدادات) · على واتساب: <b>Ctrl+Shift+L</b> قفل فوري.',
      ids: { tool: 'waprivacy', open: 'waopen', blur: 'wablur' },
      hotkeys: { open: 'Ctrl+Alt+KeyW', blur: 'Ctrl+Alt+KeyB' },
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 01-8.5 8.5 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8A8.5 8.5 0 0112.5 3 8.5 8.5 0 0121 11.5z"/><rect x="9.5" y="10" width="5" height="4.5" rx="1"/><path d="M10.5 10V8.8a1.5 1.5 0 013 0V10"/></svg>',
      openIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 01-8.5 8.5 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8A8.5 8.5 0 0112.5 3 8.5 8.5 0 0121 11.5z"/></svg>',
      /* layered selectors — newest first, older fallbacks kept; update here only */
      sel: {
        names:    ['#pane-side span[title]', '#main header span[title]'],
        avatars:  ['#pane-side img', '#main header img', 'img[src*="pps.whatsapp.net"]'],
        preview:  ['#pane-side [role="listitem"] [role="gridcell"]', '#pane-side [role="listitem"] span[dir]:not([title])'],
        messages: ['.message-in', '.message-out', '#main [data-pre-plain-text]', '#main .copyable-text .selectable-text'],
        media:    ['.message-in img', '.message-in video', '.message-out img', '.message-out video', '#main img[src^="blob"]'],
        input:    ['footer [contenteditable="true"]', 'footer .lexical-rich-text-input']
      }
    },
    {
      key: 'ms',                                   /* storage: ms_blur · ms_lock · ms_lock_cmd */
      cls: 'syfsms',
      hosts: /(^|\.)(messenger\.com|facebook\.com)$/,
      /* messenger.com everywhere; on facebook.com ONLY the /messages app — the feed is
         not a chat, and the small chat dock on other pages shares the feed's page */
      onPath: function () { return !/facebook\.com$/.test(HOST) || /^\/messages(\/|$)/.test(location.pathname); },
      url: 'https://www.messenger.com',
      /* the lock page (wa-lock.js) runs on messenger.com and on facebook.com/messages */
      lockHost: /^(www\.messenger\.com|(www|web)\.facebook\.com)$/,
      name: 'خصوصية ماسنجر', openName: 'افتح ماسنجر', blurName: 'تبديل تمويه ماسنجر',
      openLabel: '💬 افتح ماسنجر',
      scope: 'الأداة تعمل على messenger.com وعلى facebook.com/messages — الإعدادات هنا تُحفظ وتسري هناك.',
      lockNow: '🔒 اقفل ماسنجر الآن',
      saved: 'حُفظ — ماسنجر سيُقفل بهذه الكلمة ✓',
      keys: 'اختصارات من أي صفحة: <b>Ctrl+Alt+M</b> فتح ماسنجر · <b>Ctrl+Alt+N</b> تبديل التمويه (تُغيَّر من تبويب «المفاتيح» في الإعدادات). القفل يعمل على messenger.com وعلى facebook.com/messages (الصفحة الرئيسية لا تُقفل)؛ في المحادثات: <b>Ctrl+Shift+L</b> قفل فوري.',
      ids: { tool: 'msprivacy', open: 'msopen', blur: 'msblur' },
      hotkeys: { open: 'Ctrl+Alt+KeyM', blur: 'Ctrl+Alt+KeyN' },
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 8.5 0 0 0-9 8.5c0 2.6 1.2 4.9 3.1 6.5V21l2.9-1.6a9.7 9.7 0 0 0 3 .5 9 8.5 0 0 0 9-8.4A9 8.5 0 0 0 12 3z"/><rect x="9.5" y="10" width="5" height="4.5" rx="1"/><path d="M10.5 10V8.8a1.5 1.5 0 013 0V10"/></svg>',
      openIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 8.5 0 0 0-9 8.5c0 2.6 1.2 4.9 3.1 6.5V21l2.9-1.6a9.7 9.7 0 0 0 3 .5 9 8.5 0 0 0 9-8.4A9 8.5 0 0 0 12 3z"/><path d="m7 14 3.2-3.4 2.6 2 4.2-3.6"/></svg>',
      /* Messenger's class names are generated — only roles, hrefs and dir attributes are
         stable. The chat list is the `/t/…` links (messenger.com) or `/messages/t/…`
         (facebook.com); the open conversation is [role="main"]. Name and preview share
         one row, so «names» blurs the whole row text and «preview» the second line. */
      sel: {
        names:    ['a[role="link"][href*="/t/"] [dir="auto"]', '[role="main"] h1', '[role="main"] h2', '[role="main"] h3'],
        avatars:  ['a[role="link"][href*="/t/"] img', 'a[role="link"][href*="/t/"] svg', '[role="main"] h1 ~ * img', 'svg image', '[role="main"] img[alt][src*="fbcdn"]:not([src*="emoji"])'],
        preview:  ['a[role="link"][href*="/t/"] [dir="auto"] ~ * [dir="auto"]', 'a[role="link"][href*="/t/"] span[dir="auto"] > span[dir="auto"]'],
        messages: ['[role="main"] [role="row"] [dir="auto"]', '[role="main"] [role="gridcell"] [dir="auto"]', '[role="main"] [role="presentation"] [dir="auto"]'],
        media:    ['[role="main"] [role="row"] img', '[role="main"] [role="row"] video', '[role="main"] a[href*="attachment"] img', '[role="main"] video'],
        input:    ['[role="main"] [role="textbox"][contenteditable="true"]', '[role="textbox"][contenteditable="true"][aria-label]']
      }
    }
  ];

  /* ================= one engine per site ================= */

  function normBlur(raw) {
    var s = { on: false, px: 8, names: true, avatars: true, preview: true, messages: true, media: true, input: false };
    if (raw && typeof raw === 'object') {
      s.on = raw.on === true;
      var p = parseInt(raw.px, 10); s.px = (isFinite(p) && p >= 4 && p <= 20) ? p : 8;
      BLUR_KEYS.forEach(function (k) { if (k in raw) s[k] = raw[k] === true; });
    }
    return s;
  }

  function setup(S) {
    var IS_SITE = S.hosts.test(HOST);
    var BLUR_KEY = S.key + '_blur', LOCK_KEY = S.key + '_lock', CMD_KEY = S.key + '_lock_cmd';
    var ON = S.cls + '-on', PX = '--' + S.cls + '-px';
    var blur = normBlur(null);
    var blurStyle = null;

    function blurCss() {
      var text = [], media = [];
      BLUR_KEYS.forEach(function (k) {
        if (!blur[k]) return;
        var target = (k === 'media' || k === 'avatars') ? media : text;
        target.push.apply(target, S.sel[k]);
      });
      var css = [];
      if (text.length) {
        css.push('html.' + ON + ' :is(' + text.join(',') + '){filter:blur(var(' + PX + '))!important;transition:filter 120ms ease}');
        css.push('html.' + ON + ' :is(' + text.join(',') + '):hover,html.' + ON + ' :is(' + text.join(',') + '):focus-within{filter:none!important}');
      }
      if (media.length) {
        css.push('html.' + ON + ' :is(' + media.join(',') + '){filter:blur(calc(var(' + PX + ') * 1.5))!important;transition:filter 120ms ease}');
        css.push('html.' + ON + ' :is(' + media.join(',') + '):hover{filter:none!important}');
      }
      return css.join('\n');
    }

    function applyBlur() {
      if (!IS_SITE) return;
      var root = document.documentElement;
      var on = blur.on && S.onPath();
      if (!blurStyle) { blurStyle = document.createElement('style'); blurStyle.id = 'syfs-' + S.key + '-style'; }
      if (!blurStyle.isConnected) root.appendChild(blurStyle);
      root.classList.toggle(ON, on);
      root.style.setProperty(PX, blur.px + 'px');
      blurStyle.textContent = on ? blurCss() : '';
    }

    if (IS_SITE) {
      store.get(BLUR_KEY, null).then(function (raw) { blur = normBlur(raw); applyBlur(); });
      /* docked in the side panel there is no rail to hear the shortcut, and the caret
         lives in this frame's message box — so the frame listens for the blur combo
         itself (the user's binding from 'hotkeys', else the shipped default) */
      if (IN_FRAME) frameHotkey();
      try {
        chrome.storage.onChanged.addListener(function (ch, area) {
          if (area === 'local' && ch[BLUR_KEY]) { blur = normBlur(ch[BLUR_KEY].newValue); applyBlur(); }
        });
      } catch (e) {}
      new MutationObserver(function () { if (blurStyle && !blurStyle.isConnected) applyBlur(); })
        .observe(document.documentElement, { childList: true });
      /* a single-page app changes its path without a load: facebook.com moves between the
         feed and /messages in place, so the path gate is re-read on every URL change */
      var lastPath = location.pathname;
      window.addEventListener('popstate', applyBlur);
      setInterval(function () {
        if (location.pathname !== lastPath) { lastPath = location.pathname; applyBlur(); }
      }, 1000);
    }

    function frameHotkey() {
      var combo = S.hotkeys.blur || null;
      function readCombo(map) {
        var v = map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, S.ids.blur) ? map[S.ids.blur] : undefined;
        combo = v === undefined ? (S.hotkeys.blur || null) : (typeof v === 'string' ? v : null);
      }
      store.get('hotkeys', {}).then(readCombo);
      try {
        chrome.storage.onChanged.addListener(function (ch, area) {
          if (area === 'local' && ch.hotkeys) readCombo(ch.hotkeys.newValue);
        });
      } catch (e) {}
      document.addEventListener('keydown', function (e) {
        if (!combo || e.repeat || !(e.ctrlKey || e.altKey || e.metaKey)) return;
        var p = [];
        if (e.ctrlKey) p.push('Ctrl'); if (e.altKey) p.push('Alt'); if (e.shiftKey) p.push('Shift'); if (e.metaKey) p.push('Meta');
        p.push(e.code || e.key);
        if (p.join('+') !== combo) return;
        e.preventDefault(); e.stopPropagation();
        toggleBlur();
      }, true);
    }

    /* Flip the stored flag and say what happened. Reads the store first rather than
       trusting the in-memory copy: on another page nothing keeps `blur` in sync, and a
       toggle that flips a stale copy would turn the blur OFF when the user wanted it on.
       Persisting is what reaches the chat tab (storage.onChanged above). */
    /* ⚠️ chained, not fired side by side: two quick presses both read the store before
       either wrote it, flipped the SAME old value, and cancelled out into one toggle */
    var toggling = Promise.resolve();
    function toggleBlur() {
      toggling = toggling.then(function () { return store.get(BLUR_KEY, null); }).then(function (raw) {
        blur = normBlur(raw); blur.on = !blur.on;
        applyBlur();
        var on = blur.on;
        return store.set(BLUR_KEY, blur).then(function () {
          /* i18n-dyn: S.name is a msgid from the SITES table above, translated here */
          if (SYFS.toast && SYFS.t) SYFS.toast(SYFS.t(S.name), on ? SYFS.t('التمويه مفعّل ✓') : SYFS.t('التمويه متوقّف'), { timeout: 2500 });
        });
      }).catch(function () {});
    }

    /* ================= rail tools ================= */

    SYFS.tools = SYFS.tools || [];
    /* ⚠️ `hotkey` is a SHIPPED DEFAULT the user may rebind or remove (rail.js `hkOf`) —
       one pair per chat site; the leader chord covers every other tool (§6.104).
       Ctrl+Alt+letter (v0.179.0), never Ctrl+Shift+W/B: those are Chrome's own. */
    /* docked beside the page (v0.135.0), not a full tab that hides what you were reading —
       and a tab is what «افتح واتساب ويب» used to cost. Falls back to a tab where the dock
       is unavailable (the worker asleep on an old build, or a page with no rail). */
    function openHost() {
      if (window.SYFS && SYFS.openPanel && SYFS.openPanel(S.url)) return;
      if (window.SYFS && SYFS.openSide && SYFS.openSide(S.url)) return;
      window.open(S.url, '_blank');
    }
    var openTool = { id: S.ids.open, name: S.openName, cat: 'shield', noRail: true, icon: S.openIcon,
      action: openHost };
    if (S.hotkeys.open) openTool.hotkey = S.hotkeys.open;
    SYFS.tools.push(openTool);
    /* hotkeyAnywhere: the toggle must reach the page from inside the message box, where
       the caret sits on WhatsApp/Messenger (rail.js keydown, v0.140.9) */
    var blurTool = { id: S.ids.blur, name: S.blurName, cat: 'shield', noRail: true, hotkeyAnywhere: true,
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/></svg>',
      action: toggleBlur };
    if (S.hotkeys.blur) blurTool.hotkey = S.hotkeys.blur;
    SYFS.tools.push(blurTool);

    SYFS.tools.push({
      id: S.ids.tool,
      name: S.name,
      cat: 'shield',
      icon: S.icon,
      mount: function (body) {
        var blurRows = BLUR_KEYS.map(function (k) {
          return '<label class="syf-ck"><input type="checkbox" data-wb="' + k + '"> <span>' + BLUR_LABEL[k] + '</span></label>';
        }).join('');
        var root = h(
          '<div class="syf-form">' +
            (IS_SITE ? '' :
              '<button class="syf-btn" id="wp-open">' + S.openLabel + '</button>' +
              '<div class="syf-note-hint">' + S.scope + '</div>') +
            '<label>🔒 قفل الشاشة</label>' +
            '<div class="syf-out" style="grid-template-columns:1fr"><div><span>الحالة</span><b id="wp-lstate">—</b></div></div>' +
            '<input class="syf-in" type="password" id="wp-cur" placeholder="كلمة المرور الحالية (للتغيير/الإزالة)" style="display:none">' +
            '<input class="syf-in" type="password" id="wp-new" placeholder="كلمة مرور جديدة (4 أحرف فأكثر)">' +
            '<input class="syf-in" type="password" id="wp-new2" placeholder="تأكيد كلمة المرور">' +
            '<div class="syf-row">' +
              '<button class="syf-btn" id="wp-save" style="flex:1">حفظ القفل</button>' +
              '<button class="syf-btn syf-mini" id="wp-remove" style="display:none">إزالة</button>' +
            '</div>' +
            '<label class="syf-ck"><input type="checkbox" id="wp-hide" checked> <span>اقفل عند إخفاء التبويب/تبديل النافذة</span></label>' +
            '<label>اقفل بعد خمول</label>' +
            '<select class="syf-in" id="wp-idle">' +
              '<option value="0">معطّل</option><option value="1">دقيقة</option><option value="5">5 دقائق</option>' +
              '<option value="15">15 دقيقة</option><option value="30">30 دقيقة</option>' +
            '</select>' +
            '<button class="syf-btn" id="wp-locknow" style="display:none">' + S.lockNow + '</button>' +
            '<div class="syf-empty" id="wp-msg" style="display:none"></div>' +
            '<hr style="border:none;border-top:1px solid var(--line);margin:6px 0">' +
            '<label>🌫 التمويه (يظهر بمرور الماوس)</label>' +
            '<label class="syf-ck"><input type="checkbox" id="wp-on"> <span>تفعيل التمويه</span></label>' +
            '<div class="syf-row"><label style="margin:0">القوة <b id="wp-pxv">8px</b></label><input type="range" id="wp-px" min="4" max="20" value="8" style="flex:1"></div>' +
            '<div id="wp-els">' + blurRows + '</div>' +
            '<hr style="border:none;border-top:1px solid var(--line);margin:6px 0">' +
            '<label>🎥 حارس الاجتماعات</label>' +
            '<label class="syf-ck"><input type="checkbox" id="mg-on"> <span>عند فتح تبويب اجتماع أونلاين اقترح تفعيل الخصوصية</span></label>' +
            '<select class="syf-in" id="mg-mode">' +
              '<option value="ask">اسأل أولاً — رسالة داخل تبويب الاجتماع</option>' +
              '<option value="auto">فعّل تلقائياً بلا سؤال</option>' +
            '</select>' +
            '<label class="syf-ck"><input type="checkbox" id="mg-wa"> <span>تمويه واتساب</span></label>' +
            '<label class="syf-ck"><input type="checkbox" id="mg-ms"> <span>تمويه ماسنجر</span></label>' +
            '<label class="syf-ck"><input type="checkbox" id="mg-lock"> <span>واقفل الشاشة أيضاً (إن كان القفل مضبوطاً)</span></label>' +
            '<label class="syf-ck"><input type="checkbox" id="mg-restore"> <span>أعد الوضع السابق عند إغلاق آخر تبويب اجتماع</span></label>' +
            '<input class="syf-in" id="mg-hosts" placeholder="نطاقات إضافية مفصولة بفاصلة (مثل meet.example.com)">' +
            '<div class="syf-empty" id="mg-state" style="display:none"></div>' +
            '<div class="syf-note-hint">يُكتشف: Google Meet · Zoom · Teams · Webex · Whereby · Jitsi · Discord · Skype · GoToMeeting · BlueJeans. إعداد واحد مشترك بين أداتَي واتساب وماسنجر، ويُسأل مرة واحدة لكل اجتماع.</div>' +
            '<div class="syf-note-hint">' + S.keys + '<br>' +
            'القفل رادع للنظر وليس تشفيراً — من يملك الجهاز يمكنه تعطيل الإضافة. نسيان كلمة المرور = إزالة الإضافة وإعادة تثبيتها لإعادة الضبط. لا يُقرأ أي محتوى ولا يُرسل شيء.</div>' +
          '</div>'
        );
        body.appendChild(root);

        var lstate = root.querySelector('#wp-lstate'), msg = root.querySelector('#wp-msg');
        var cur = root.querySelector('#wp-cur'), nw = root.querySelector('#wp-new'), nw2 = root.querySelector('#wp-new2');
        var saveBtn = root.querySelector('#wp-save'), rmBtn = root.querySelector('#wp-remove'), lockBtn = root.querySelector('#wp-locknow');
        var hideCk = root.querySelector('#wp-hide'), idleSel = root.querySelector('#wp-idle');
        var openBtn = root.querySelector('#wp-open');
        var lockCfg = null;
        var IS_LOCK_HOST = S.lockHost.test(HOST) && S.onPath();

        function say(t, ok) { msg.style.display = ''; msg.textContent = t; msg.style.color = ok ? '' : '#d93025'; }
        function hasLock() { return !!(lockCfg && lockCfg.on && lockCfg.hash); }

        function renderLock() {
          lstate.textContent = hasLock() ? SYFS.t('مفعّل ✓') : SYFS.t('غير مضبوط');
          cur.style.display = hasLock() ? '' : 'none';
          rmBtn.style.display = hasLock() ? '' : 'none';
          lockBtn.style.display = hasLock() && IS_LOCK_HOST ? '' : 'none';
          saveBtn.textContent = hasLock() ? SYFS.t('تغيير كلمة المرور') : SYFS.t('حفظ القفل');
          hideCk.checked = !lockCfg || lockCfg.onHide !== false;
          idleSel.value = String(lockCfg && [0, 1, 5, 15, 30].indexOf(lockCfg.idleMin) >= 0 ? lockCfg.idleMin : 0);
        }
        function loadLock() {
          return store.get(LOCK_KEY, null).then(function (raw) { lockCfg = raw || null; renderLock(); });
        }
        function saveLockCfg(patch) {
          var base = lockCfg || { on: false, hash: '', salt: '', iters: 200000, onHide: true, idleMin: 0 };
          lockCfg = Object.assign({}, base, patch);
          return store.set(LOCK_KEY, lockCfg).then(renderLock);
        }
        function verifyCurrent() {
          if (!hasLock()) return Promise.resolve(true);
          if (!cur.value) { say(SYFS.t('أدخل كلمة المرور الحالية')); return Promise.resolve(false); }
          return waHash(cur.value, lockCfg.salt, lockCfg.iters).then(function (hex) {
            if (hex === lockCfg.hash) return true;
            say(SYFS.t('كلمة المرور الحالية خاطئة')); return false;
          });
        }

        saveBtn.addEventListener('click', function () {
          if (!crypto.subtle) { say(SYFS.t('افتح الأداة على صفحة https (مثل المحادثة نفسها) لضبط القفل')); return; }
          if (nw.value.length < 4) { say(SYFS.t('كلمة المرور 4 أحرف فأكثر')); return; }
          if (nw.value !== nw2.value) { say(SYFS.t('التأكيد غير مطابق')); return; }
          verifyCurrent().then(function (ok) {
            if (!ok) return;
            var salt = randomSaltHex();
            waHash(nw.value, salt, 200000).then(function (hex) {
              saveLockCfg({ on: true, hash: hex, salt: salt, iters: 200000 }).then(function () {
                cur.value = nw.value = nw2.value = '';
                /* i18n-dyn: S.saved is a msgid from the SITES table above */
                say(SYFS.t(S.saved), true);
              });
            });
          });
        });
        rmBtn.addEventListener('click', function () {
          verifyCurrent().then(function (ok) {
            if (!ok) return;
            saveLockCfg({ on: false, hash: '', salt: '' }).then(function () {
              cur.value = ''; say(SYFS.t('أُزيل القفل ✓'), true);
            });
          });
        });
        lockBtn.addEventListener('click', function () {
          store.set(CMD_KEY, { op: 'lock', t: Date.now() });
        });
        hideCk.addEventListener('change', function () { saveLockCfg({ onHide: hideCk.checked }); });
        idleSel.addEventListener('change', function () { saveLockCfg({ idleMin: parseInt(idleSel.value, 10) || 0 }); });
        if (openBtn) openBtn.addEventListener('click', openHost);

        /* ---- blur section ---- */
        var onCk = root.querySelector('#wp-on'), pxR = root.querySelector('#wp-px'), pxV = root.querySelector('#wp-pxv');
        function renderBlur(s) {
          onCk.checked = s.on; pxR.value = s.px; pxV.textContent = s.px + 'px';
          root.querySelectorAll('[data-wb]').forEach(function (cb) { cb.checked = s[cb.getAttribute('data-wb')]; });
        }
        function saveBlur() {
          blur.on = onCk.checked;
          blur.px = parseInt(pxR.value, 10) || 8;
          root.querySelectorAll('[data-wb]').forEach(function (cb) { blur[cb.getAttribute('data-wb')] = cb.checked; });
          applyBlur();
          store.set(BLUR_KEY, blur);
        }
        store.get(BLUR_KEY, null).then(function (raw) { blur = normBlur(raw); renderBlur(blur); });
        /* the panel follows a toggle made elsewhere (the shortcut, another tab, the meeting
           guard): a stale «تفعيل التمويه» box was written back by the next slider move
           and silently undid that toggle */
        try {
          chrome.storage.onChanged.addListener(function (ch, area) {
            if (area === 'local' && ch[BLUR_KEY] && root.isConnected) { blur = normBlur(ch[BLUR_KEY].newValue); renderBlur(blur); }
          });
        } catch (e) {}
        onCk.addEventListener('change', saveBlur);
        pxR.addEventListener('input', function () { pxV.textContent = pxR.value + 'px'; });
        pxR.addEventListener('change', saveBlur);
        root.querySelectorAll('[data-wb]').forEach(function (cb) { cb.addEventListener('change', saveBlur); });

        /* ---- meeting guard (one setting, shown in both chat tools) ---- */
        var mg = {};
        ['on', 'mode', 'wa', 'ms', 'lock', 'restore', 'hosts', 'state'].forEach(function (k) { mg[k] = root.querySelector('#mg-' + k); });
        function renderMeet(c) {
          mg.on.checked = c.on; mg.mode.value = c.mode;
          mg.wa.checked = c.wa; mg.ms.checked = c.ms; mg.lock.checked = c.lockToo; mg.restore.checked = c.restore;
          mg.hosts.value = c.hosts.join(', ');
        }
        function saveMeet() {
          var c = normMeet({
            on: mg.on.checked, mode: mg.mode.value, wa: mg.wa.checked, ms: mg.ms.checked,
            lockToo: mg.lock.checked, restore: mg.restore.checked, hosts: mg.hosts.value.split(/[\s,،]+/)
          });
          renderMeet(c);
          store.set(MEET_KEY, c);
        }
        store.get(MEET_KEY, null).then(function (raw) { renderMeet(normMeet(raw)); });
        ['on', 'mode', 'wa', 'ms', 'lock', 'restore', 'hosts'].forEach(function (k) { mg[k].addEventListener('change', saveMeet); });
        try {
          chrome.storage.onChanged.addListener(function (ch, area) {
            if (area === 'local' && ch[MEET_KEY] && root.isConnected) renderMeet(normMeet(ch[MEET_KEY].newValue));
          });
          /* is a meeting on right now? (the worker keeps the session record) */
          chrome.runtime.sendMessage({ type: 'SYFS_MEET', op: 'status' }, function (r) {
            if (chrome.runtime.lastError || !r || !r.ok || !r.tabs) return;
            mg.state.style.display = '';
            mg.state.textContent = r.applied
              ? SYFS.t('🎥 اجتماع جارٍ الآن ({0} تبويب) — الخصوصية مفعّلة بواسطة الحارس', r.tabs)
              : SYFS.t('🎥 اجتماع جارٍ الآن ({0} تبويب) — الحارس لم يفعّل الخصوصية', r.tabs);
          });
        } catch (e) {}

        loadLock();
      }
    });
  }

  /* ---- meeting guard: the shared setting + the question the worker sends ----
   * The worker (background.js «حارس الاجتماعات») watches tab URLs and, on the first
   * meeting tab of a session, asks THAT tab to show the question; the answer goes back
   * as SYFS_MEET {op}. The setting itself is one record, `meetguard`, edited from
   * either chat tool — the same normaliser as the worker's, so both sides agree on
   * what a half-written record means. */
  var MEET_KEY = 'meetguard';
  var MEET_DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/;
  function normMeet(raw) {
    var c = { on: true, mode: 'ask', wa: true, ms: true, lockToo: false, restore: true, hosts: [] };
    if (raw && typeof raw === 'object') {
      c.on = raw.on !== false;
      c.mode = raw.mode === 'auto' ? 'auto' : 'ask';
      c.wa = raw.wa !== false;
      c.ms = raw.ms !== false;
      c.lockToo = raw.lockToo === true;
      c.restore = raw.restore !== false;
      c.hosts = Array.isArray(raw.hosts)
        ? raw.hosts.map(function (x) { return String(x || '').trim().toLowerCase(); })
            .filter(function (x, i, a) { return MEET_DOMAIN_RE.test(x) && x.length <= 253 && a.indexOf(x) === i; }).slice(0, 20)
        : [];
    }
    return c;
  }
  try {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || (msg.type !== 'SYFS_MEET_ASK' && msg.type !== 'SYFS_MEET_AUTO')) return;
      if (!window.SYFS || typeof SYFS.toast !== 'function') { sendResponse({ ok: false }); return; }
      /* the name is one of the worker's own constants (or a host the user typed);
         it is still placed with textContent, never markup */
      var name = String(msg.name || '').slice(0, 60);
      var reply = function (op) { try { chrome.runtime.sendMessage({ type: 'SYFS_MEET', op: op }); } catch (e) {} };
      var shown;
      if (msg.type === 'SYFS_MEET_AUTO') {
        shown = SYFS.toast(SYFS.t('حارس الاجتماعات'), SYFS.t('اجتماع {0} — فُعّل تمويه واتساب وماسنجر تلقائياً', name), {
          actions: [{ label: 'تراجع', onClick: function () { reply('undo'); } }], timeout: 8000
        });
      } else {
        shown = SYFS.toast(SYFS.t('حارس الاجتماعات'), SYFS.t('تبويب {0} مفتوح — تفعيل خصوصية واتساب وماسنجر (تمويه المحادثات)؟', name), {
          actions: [
            { label: 'نعم، فعّل', primary: true, onClick: function () { reply('yes'); } },
            { label: 'لا', onClick: function () { reply('no'); } },
            { label: 'دائماً بلا سؤال', onClick: function () { reply('always'); } }
          ],
          timeout: 0
        });
      }
      sendResponse({ ok: !!shown });
    });
  } catch (e) {}

  SITES.forEach(setup);
}());
