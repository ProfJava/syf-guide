/* SYF — button kit (v0.154.0): the icon on every button, and the «الشكل الزجاجي» switch.
 *
 * ~320 buttons are built from HTML templates across 30 files, most of them a bare word
 * («نسخ», «مسح», «حفظ»). Editing every template would be churn in markup that h() and
 * the i18n tree walk both depend on, so the icon is added AFTER the button exists:
 * a MutationObserver sees each new button, reads its label and prepends an <svg> from
 * the table below. The label is never touched — an <svg> has no text, so every
 * script that reads or compares `.textContent` sees exactly what it saw before.
 *
 *  - A button that already has an icon (an <svg>, an <img>, a leading emoji) is left
 *    alone. A leading TEXT symbol (▶ ■ ⏹ ✕ ↻ …) is wrapped in .syf-bsym and replaced
 *    by the drawn icon while the glass look is on (controls.css hides one, shows the
 *    other) — the text node keeps its characters, only its parent changes.
 *  - A label that matches nothing gets nothing: a wrong icon is worse than none.
 *  - Scope: the rail's shadow root (rail.js calls watch(root)) and the extension's OWN
 *    pages. ⛔ Never the host page's document — a content script must not decorate a
 *    website's buttons.
 *
 * The look itself is CSS (controls.css, copied into rail.css), scoped to
 * [data-glass="on"]. This file sets that attribute on a page's <html>; the rail sets it
 * on its .syfs-wrap (rail.js → applyTheme). Key `glass_ui`, default ON. */
(function () {
  window.SYFS = window.SYFS || {};
  if (SYFS.btnkit) return;
  var KEY = 'glass_ui';
  var NS = 'http://www.w3.org/2000/svg';

  /* 24×24, stroke = currentColor — the same drawing rules as the rail's own icons */
  var P = {
    play: '<path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8z" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2.2" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="5" width="4.2" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
    volume: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    paste: '<rect x="8" y="2.5" width="8" height="4" rx="1"/><path d="M16 4.5h2a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
    eraser: '<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21"/><path d="M22 21H7M5 11l9 9"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    open: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    settings: '<path d="M4 6h8M16 6h4M4 12h4M12 12h8M4 18h11M19 18h1"/><circle cx="14" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    convert: '<path d="M7 16V4M3 8l4-4 4 4M17 8v12M21 16l-4 4-4-4"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16v5M16.5 18.5h5"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15v3M8 18h.01M12 18h.01"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.9-1"/>',
    swap: '<path d="m16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10a7 7 0 0 1-14 0M12 17v5"/>',
    next: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'
  };
  /* arrows that point «forward» — mirrored in RTL by controls.css */
  var DIR = { next: 1, back: 1, undo: 1 };

  /* a leading TEXT symbol → the icon it stands for */
  var SYM = { '▶': 'play', '►': 'play', '⏵': 'play', '■': 'stop', '⏹': 'stop', '⏸': 'pause', '✕': 'x', '✖': 'x', '×': 'x',
              '↻': 'refresh', '⟳': 'refresh', '＋': 'plus', '+': 'plus', '✓': 'check', '✔': 'check',
              '⬇': 'download', '↓': 'download', '⬆': 'upload', '↑': 'upload' };

  /* label → icon. ORDER MATTERS: the first rule that matches wins, so the narrower
     phrase comes first («إيقاف مؤقت» before «إيقاف», «فتح القفل» before «فتح»,
     «إعادة تسمية» before «إعادة»). Diacritics are removed first. An Arabic key of four
     letters or more is matched anywhere in the label; a key of three or fewer only as a
     whole word (with an optional و/ف/ال in front) — «أعد» inside «المساعد» or «صور»
     inside «تصوير» would otherwise hand those buttons the wrong icon. English keys are
     always whole words. */
  /* i18n-skip-start: match keys read from labels, never shown */
  var RULES = [
    ['pause', ['إيقاف مؤقت', 'ايقاف مؤقت'], ['pause']],
    ['unlock', ['فتح القفل', 'افتح القفل'], ['unlock']],
    ['stop', ['إيقاف', 'ايقاف', 'أوقف', 'اوقف'], ['stop']],
    ['volume', ['استماع', 'استمع'], ['listen']],
    ['mic', ['إملاء', 'املاء'], ['dictate', 'dictation']],
    ['play', ['نطق', 'انطق', 'تشغيل', 'شغل', 'ابدأ', 'بدء', 'تجربة', 'جرب'], ['play', 'speak', 'start', 'test', 'try']],
    ['copy', ['نسخ', 'انسخ'], ['copy']],
    ['paste', ['لصق', 'الصق'], ['paste']],
    ['trash', ['حذف', 'احذف'], ['delete', 'remove']],
    ['eraser', ['مسح', 'امسح', 'إفراغ', 'تفريغ'], ['clear', 'erase']],
    ['save', ['حفظ', 'احفظ'], ['save']],
    ['edit', ['إعادة تسمية', 'تعديل', 'عدل', 'تحرير', 'حرر'], ['edit', 'rename']],
    ['download', ['تصدير', 'صدر', 'تحميل', 'تنزيل', 'نزل', 'حمل'], ['export', 'download']],
    ['file', ['اختر ملف', 'اختيار ملف', 'اختر ملفات', 'تغيير الملف', 'غير الملف'], ['browse', 'file']],
    ['upload', ['استيراد', 'استورد', 'رفع', 'ارفع'], ['import', 'upload']],
    ['search', ['بحث', 'ابحث'], ['search', 'find']],
    ['plus', ['إضافة', 'اضافة', 'أضف', 'اضف', 'جديد'], ['add', 'new']],
    ['undo', ['تراجع'], ['undo']],
    ['refresh', ['تحديث', 'إعادة', 'اعادة', 'أعد', 'اعد', 'تصفير'], ['refresh', 'retry', 'reload', 'reset', 'redo']],
    ['settings', ['إعدادات', 'اعدادات'], ['settings', 'options']],
    ['x', ['إغلاق', 'اغلاق', 'أغلق', 'اغلق', 'إلغاء', 'الغاء'], ['close', 'cancel']],
    ['print', ['طباعة', 'اطبع'], ['print']],
    ['share', ['مشاركة', 'شارك'], ['share']],
    ['camera', ['تصوير', 'لقطة', 'التقط'], ['capture', 'screenshot']],
    ['image', ['صورة', 'صور'], ['image', 'photo']],
    ['convert', ['تحويل', 'حول'], ['convert']],
    ['sparkle', ['توليد', 'ولد', 'إنشاء', 'انشاء', 'أنشئ', 'انشئ'], ['generate', 'create']],
    ['calc', ['احسب', 'حساب'], ['calculate', 'compute']],
    ['send', ['إرسال', 'ارسال', 'أرسل', 'ارسل'], ['send']],
    ['link', ['رابط', 'الرابط'], ['link']],
    ['lock', ['قفل', 'أقفل', 'اقفل'], ['lock']],
    ['swap', ['تبديل', 'بدل'], ['swap']],
    ['eye', ['معاينة', 'عرض', 'اعرض', 'إظهار', 'اظهار'], ['preview', 'show', 'view']],
    ['next', ['التالي', 'التالية', 'انتقل', 'اذهب'], ['next', 'go']],
    ['back', ['السابق', 'السابقة', 'رجوع', 'ارجع'], ['back', 'previous', 'prev']],
    ['open', ['فتح', 'افتح'], ['open']],
    ['check', ['تأكيد', 'أكد', 'موافق', 'تطبيق', 'طبق', 'قرأته'], ['done', 'ok', 'confirm', 'apply']],
    ['bell', ['تنبيه', 'نبهني'], ['remind', 'alert']]
  ];
  var TASHKEEL = /[ً-ْٰـ]/g;
  /* one exact short Arabic word that would match inside longer ones as a substring */
  var WORD_AR = { 'تم': 'check' };
  /* i18n-skip-end */

  function pick(label) {
    var s = String(label || '').replace(TASHKEEL, '').trim();
    if (!s) return '';
    var words = s.toLowerCase().split(/[^a-z؀-ۿ]+/).filter(Boolean);
    for (var w = 0; w < words.length; w++) if (WORD_AR[words[w]]) return WORD_AR[words[w]];
    var has = function (k) {
      if (k.indexOf(' ') >= 0 || k.length > 3) return s.indexOf(k) >= 0;
      for (var x = 0; x < words.length; x++) {
        var wd = words[x];
        /* i18n-skip-start: Arabic prefixes, not text */
        if (wd === k || wd === 'و' + k || wd === 'ف' + k || wd === 'ال' + k || wd === 'وال' + k) return true;
        /* i18n-skip-end */
      }
      return false;
    };
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i];
      for (var a = 0; a < r[1].length; a++) if (has(r[1][a])) return r[0];
      for (var e = 0; e < r[2].length; e++) if (words.indexOf(r[2][e]) >= 0) return r[0];
    }
    return '';
  }

  function icon(name) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'syf-bi' + (DIR[name] ? ' syf-bi-dir' : ''));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    /* P holds constant strings written in this file — never a value from a page */
    svg.innerHTML = P[name];
    return svg;
  }

  var SEL = '.syf-btn, .syf-mini, button.btn';
  var EMOJI = /^\p{Extended_Pictographic}/u;

  function decorate(b) {
    if (!b || b.nodeType !== 1 || !b.matches || !b.matches(SEL)) return;
    if (b.querySelector('svg, img, .syf-bsym')) return;
    /* the first non-blank text node is where a leading symbol lives */
    var tn = null;
    for (var c = b.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3 && c.nodeValue.trim()) { tn = c; break; }
      if (c.nodeType === 1) break;          /* an element first (a <b>, a <span>) — no symbol hunt */
    }
    var text = (b.textContent || '').trim();
    var name = '';
    if (tn) {
      var v = tn.nodeValue, lead = /^\s*/.exec(v)[0].length, ch = v.charAt(lead);
      if (SYM[ch]) {
        name = SYM[ch];
        /* split the symbol (and the space after it) into its own node, then wrap it */
        var rest = v.slice(lead + 1).replace(/^\s+/, '');
        var sym = document.createElement('span');
        sym.className = 'syf-bsym';
        sym.textContent = ch + (rest ? ' ' : '');
        tn.nodeValue = rest;
        b.insertBefore(sym, tn);
      } else if (EMOJI.test(v.slice(lead))) {
        return;                             /* it already carries an icon */
      }
    }
    if (!name) name = pick(text) || pick(b.getAttribute('title')) || pick(b.getAttribute('aria-label'));
    if (!name || !P[name]) return;
    b.insertBefore(icon(name), b.firstChild);
  }

  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    decorate(node);
    if (node.querySelectorAll) node.querySelectorAll(SEL).forEach(decorate);
  }

  var watched = typeof WeakSet === 'function' ? new WeakSet() : null;
  /* root: a ShadowRoot or an element. Decorates what is there now and every button
     added or relabelled later (a script that sets `btn.textContent` wipes the icon —
     the childList mutation on the button puts it back). */
  function watch(root) {
    if (!root || (watched && watched.has(root))) return;
    if (watched) watched.add(root);
    if (root.nodeType === 1) decorate(root);
    if (root.querySelectorAll) root.querySelectorAll(SEL).forEach(decorate);
    try {
      new MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) {
          var m = list[i];
          var t = m.target && m.target.nodeType === 1 ? m.target : (m.target && m.target.parentElement);
          var btn = t && t.closest ? t.closest(SEL) : null;
          if (btn) decorate(btn);
          for (var j = 0; j < m.addedNodes.length; j++) scan(m.addedNodes[j]);
        }
      }).observe(root, { childList: true, subtree: true, characterData: true });
    } catch (e) {}
  }

  /* ---- the «glass» switch ---- */
  function on(v) { return v !== false; }          /* default ON: only an explicit false turns it off */
  function mark(el, v) { if (el && el.setAttribute) el.setAttribute('data-glass', on(v) ? 'on' : 'off'); }

  SYFS.btnkit = { KEY: KEY, watch: watch, decorate: decorate, pick: pick, mark: mark, on: on, ICONS: Object.keys(P) };

  /* the extension's own pages: <html> carries the flag, <body> is watched.
     ⛔ Not in a content script — that document belongs to the website. */
  if (location.protocol === 'chrome-extension:') {
    mark(document.documentElement, true);         /* no flash of the old look while storage answers */
    try {
      chrome.storage.local.get(KEY, function (r) { mark(document.documentElement, r && r[KEY]); });
      chrome.storage.onChanged.addListener(function (ch, area) {
        if (area === 'local' && ch[KEY]) mark(document.documentElement, ch[KEY].newValue);
      });
    } catch (e) {}
    var go = function () { if (document.body) watch(document.body); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
}());
