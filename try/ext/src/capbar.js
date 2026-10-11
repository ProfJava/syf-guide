/* SYF — «شريط الالتقاط العائم» (v0.165.0): design ل of plans/media-studio.html.
 *
 * A small pill at the bottom (or top) of the page: منطقة · المرئي · كاملة · «المحرّر |
 * نسخ» (where a shot goes — cap_after, v0.169.0) · تسجيل · 🎙 · الاستوديو · ✕. Ctrl+Alt+R shows and hides it (a shipped default, like Ctrl+Alt+W —
 * the user's own binding for `capbar` wins, and clearing it keeps it cleared).
 * «إظهاره تلقائياً في كل صفحة» lives in the studio's settings (capbar_auto).
 *
 * EAGER, unlike everything else in «الصور»: a tool's default hotkey is only seen
 * once the tool is in SYFS.tools (rail.js idForCombo), and the lazy files are not
 * there until something asks for them. So this file is small and the heavy work is
 * borrowed on click: SYFS.ensureTools() injects media.js / studio.js first.
 *
 * Its own shadow host, not the rail's: the bar must work with the rail folded or
 * switched off, and the host is marked data-syfs-shot-hide so every capture path
 * (runRegionCapture, visibleCanvas, fullPageCanvas) takes it out of the picture.
 *
 * The screen recorder is its OWN (getDisplayMedia + MediaRecorder): the panel
 * recorder (tools2-body.js screenrec) belongs to a window that can be closed, and a
 * recording started from a bar must outlive every window. Nothing leaves the
 * device — the file is downloaded when the recording stops. */
(function () {
  window.SYFS = window.SYFS || {};
  SYFS.tools = SYFS.tools || [];
  var store = SYFS.store;

  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var I = {
    bar: SVG + '<rect x="2" y="14" width="20" height="7" rx="3.5"/><circle cx="7" cy="17.5" r="1"/><path d="M11 17.5h7"/><path d="M8 3h8l1.5 2.5H20a1 1 0 0 1 1 1V10M3 10V6.5a1 1 0 0 1 1-1h2.5z"/></svg>',
    region: SVG + '<path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"/><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"/></svg>',
    visible: SVG + '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 8h20"/></svg>',
    full: SVG + '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 13h8M9 17h8"/></svg>',
    rec: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5" fill="currentColor"/></svg>',
    mic: SVG + '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/></svg>',
    studio: SVG + '<rect x="2.5" y="5" width="19" height="14" rx="3"/><circle cx="12" cy="12" r="3.2"/></svg>',
    edit: SVG + '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    copy: SVG + '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    pause: SVG + '<path d="M9 5v14M15 5v14"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" fill="currentColor"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>',
    close: SVG + '<path d="M18 6L6 18M6 6l12 12"/></svg>'
  };

  /* colours are tokens on :host and flip with the OS theme — the pill sits on someone
     else's page, so it cannot borrow the rail's light/dark switch */
  var CSS =
    ':host{--cb-bg:#151b26;--cb-ink:#f3f5f9;--cb-mut:#9aa4b6;--cb-hov:#ffffff1f;--cb-on:#3d7a66;--cb-rec:#e5484d}' +
    '.b{display:flex;align-items:center;gap:2px;padding:5px;border-radius:999px;background:var(--cb-bg);color:var(--cb-ink);' +
      'font:600 12.5px system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 10px 30px #0006,0 0 0 1px #ffffff14;user-select:none}' +
    'button{display:flex;align-items:center;gap:6px;height:34px;padding:0 11px;border:0;border-radius:999px;background:transparent;' +
      'color:inherit;font:inherit;cursor:pointer;white-space:nowrap}' +
    'button:hover{background:var(--cb-hov)}' +
    'button:focus-visible{outline:2px solid var(--cb-on);outline-offset:1px}' +
    'button.ic{padding:0;width:34px;justify-content:center}' +
    'button:disabled{opacity:.4;cursor:default;background:transparent}' +
    'button.on{background:var(--cb-on)}' +
    'button.rec{color:var(--cb-rec)}' +
    'button.rec span{color:var(--cb-ink)}' +
    'svg{width:16px;height:16px;flex:none}' +
    '.sep{width:1px;height:20px;background:#ffffff26;margin:0 3px}' +
    '.seg{display:flex;gap:2px;padding:2px;border-radius:999px;background:#ffffff12}' +
    '.seg button{height:30px;padding:0 9px}' +
    '.live{display:flex;align-items:center;gap:7px;padding:0 10px 0 6px;font-variant-numeric:tabular-nums}' +
    '.dot{width:9px;height:9px;border-radius:50%;background:var(--cb-rec);animation:p 1.2s infinite}' +
    '.paused .dot{animation:none;opacity:.45}' +
    '@keyframes p{50%{opacity:.25}}' +
    '.msg{padding:0 10px;color:var(--cb-mut)}' +
    '[hidden]{display:none!important}' +
    '@media (prefers-reduced-motion: reduce){.dot{animation:none}}';

  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function stamp() { var d = new Date(); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()); }
  var POS = ['bottom', 'top'], AFTER = ['editor', 'copy'];

  var host = null, ui = null, pos = 'bottom', mic = false, after = 'editor';

  function place() {
    if (!host) return;
    host.style.top = pos === 'top' ? '14px' : '';
    host.style.bottom = pos === 'top' ? '' : '18px';
  }
  function build() {
    host = document.createElement('div');
    host.id = 'syfs-capbar';
    host.setAttribute('data-syfs-shot-hide', '');
    host.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);z-index:2147483645;'
      + 'direction:' + ((SYFS.i18n && SYFS.i18n.dir()) || 'rtl');
    var sr = host.attachShadow({ mode: 'open' });
    var st = document.createElement('style'); st.textContent = CSS; sr.appendChild(st);
    ui = h('<div class="b" role="toolbar" aria-label="شريط الالتقاط العائم">'
      + '<button data-a="region" title="التقاط منطقة تحدّدها"><span>منطقة</span></button>'
      + '<button data-a="visible" title="التقاط ما يظهر على الشاشة"><span>المرئي</span></button>'
      + '<button data-a="full" title="تصوير الصفحة كاملة"><span>كاملة</span></button>'
      + '<div class="seg" role="radiogroup" aria-label="بعد الالتقاط">'
      +   '<button data-a="after-editor" role="radio" title="بعد الالتقاط: فتح الصورة في المحرّر"><span>المحرّر</span></button>'
      +   '<button data-a="after-copy" role="radio" title="بعد الالتقاط: نسخ الصورة للحافظة"><span>نسخ</span></button>'
      + '</div>'
      + '<span class="sep"></span>'
      + '<button data-a="rec" class="rec" title="تسجيل الشاشة"><span>تسجيل</span></button>'
      + '<div class="live" hidden><i class="dot"></i><b class="clock">00:00</b></div>'
      + '<button data-a="pause" class="ic" title="إيقاف مؤقّت" hidden></button>'
      + '<button data-a="stop" title="إنهاء التسجيل وحفظه" hidden><span>إنهاء</span></button>'
      + '<button data-a="mic" class="ic" title="تسجيل الميكروفون مع الفيديو"></button>'
      + '<span class="msg" hidden></span>'
      + '<span class="sep"></span>'
      + '<button data-a="studio" class="ic" title="الاستوديو"></button>'
      + '<button data-a="hide" class="ic" title="إخفاء الشريط"></button>'
      + '</div>');
    /* glyphs go in after the tree is translated: internal SVG strings, never page text */
    [['region', 'region'], ['visible', 'visible'], ['full', 'full'], ['after-editor', 'edit'], ['after-copy', 'copy'],
     ['rec', 'rec'], ['pause', 'pause'], ['stop', 'stop'], ['mic', 'mic'], ['studio', 'studio'], ['hide', 'close']].forEach(function (p) {
      var b = ui.querySelector('[data-a="' + p[0] + '"]');
      b.insertAdjacentHTML('afterbegin', I[p[1]]);
      b.setAttribute('aria-label', b.title);
    });
    ui.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('button[data-a]');
      if (b) act(b.getAttribute('data-a'));
    });
    sr.appendChild(ui);
    document.documentElement.appendChild(host);
    paintMic(); paintAfter(); place();
  }
  function $(a) { return ui.querySelector('[data-a="' + a + '"]'); }
  function paintAfter() {
    if (!ui) return;
    AFTER.forEach(function (v) {
      var b = $('after-' + v); b.classList.toggle('on', after === v); b.setAttribute('aria-checked', after === v ? 'true' : 'false');
    });
  }
  function paintMic() {
    if (!ui) return;
    var b = $('mic'); b.classList.toggle('on', mic); b.setAttribute('aria-pressed', mic ? 'true' : 'false');
  }
  var msgTimer = 0;
  function say(text) {
    var m = ui.querySelector('.msg');
    m.textContent = text; m.hidden = !text;
    clearTimeout(msgTimer); if (text) msgTimer = setTimeout(function () { m.hidden = true; }, 3500);
  }

  function show() { if (!host) build(); host.style.display = ''; }
  function hide() { if (host && !recording()) host.style.display = 'none'; }
  function shown() { return !!(host && host.style.display !== 'none'); }
  function toggle() { if (shown()) hide(); else show(); }

  /* the lazy half (media.js, studio.js) is injected by rail.js; on a page where the
     rail could not load them there is nothing to borrow — say so instead of nothing */
  function withTools(fn) {
    if (!SYFS.ensureTools) { say(SYFS.t('تعذّر تحميل الأدوات')); return; }
    SYFS.ensureTools(function (ok) { if (ok === false) say(SYFS.t('تعذّر تحميل الأدوات')); else fn(); });
  }
  function act(a) {
    /* the three captures go where «المحرّر | نسخ» says (media.js quickShot, v0.169.0) */
    if (a === 'region' || a === 'visible' || a === 'full') {
      withTools(function () { if (SYFS._media && SYFS._media.quickShot) SYFS._media.quickShot(a); });
      return;
    }
    if (a === 'after-editor' || a === 'after-copy') { after = a.slice(6); paintAfter(); store.set('cap_after', after); return; }
    if (a === 'studio') { if (SYFS.openToolById) SYFS.openToolById('studio'); return; }
    if (a === 'mic') { mic = !mic; paintMic(); store.set('capbar_mic', mic); return; }
    if (a === 'rec') { startRec(); return; }
    if (a === 'pause') { pauseRec(); return; }
    if (a === 'stop') { stopRec(); return; }
    if (a === 'hide') hide();
  }

  /* ---- recorder ---- */
  var rec = null, chunks = [], disp = null, micS = null, mixAC = null, t0 = 0, pausedAt = 0, pausedMs = 0, tick = 0;
  function recording() { return !!(rec && rec.state !== 'inactive'); }
  function release() {
    [disp, micS].forEach(function (s) { if (s) s.getTracks().forEach(function (t) { t.stop(); }); });
    disp = micS = null;
    if (mixAC) { try { mixAC.close(); } catch (e) {} mixAC = null; }
  }
  /* MediaRecorder keeps the FIRST audio track only — tab audio + mic are mixed into
     one (the v0.139.3 lesson from screenrec) */
  function recStream() {
    var da = disp.getAudioTracks(), ma = micS ? micS.getAudioTracks() : [], v = disp.getVideoTracks();
    if (!ma.length) return disp;
    if (!da.length) return new MediaStream(v.concat(ma));
    try {
      mixAC = new (window.AudioContext || window.webkitAudioContext)();
      var dst = mixAC.createMediaStreamDestination();
      mixAC.createMediaStreamSource(new MediaStream(da)).connect(dst);
      mixAC.createMediaStreamSource(new MediaStream(ma)).connect(dst);
      return new MediaStream(v.concat(dst.stream.getAudioTracks()));
    } catch (e) { return disp; }
  }
  function elapsed() { return (pausedAt || performance.now()) - t0 - pausedMs; }
  function paintClock() { var s = Math.floor(elapsed() / 1000); ui.querySelector('.clock').textContent = pad(Math.floor(s / 60)) + ':' + pad(s % 60); }
  function recUI(on) {
    $('rec').hidden = on; $('mic').hidden = on;
    ui.querySelector('.live').hidden = !on; $('pause').hidden = !on; $('stop').hidden = !on;
    ['region', 'visible', 'full'].forEach(function (a) { $(a).disabled = on; });
  }
  function paintPause() {
    var p = rec && rec.state === 'paused', b = $('pause');
    b.innerHTML = p ? I.play : I.pause;                       /* internal SVG strings */
    b.title = p ? SYFS.t('متابعة التسجيل') : SYFS.t('إيقاف مؤقّت'); b.setAttribute('aria-label', b.title);
    ui.querySelector('.live').classList.toggle('paused', !!p);
  }
  function startRec() {
    if (recording()) return;
    if (!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) { say(SYFS.t('غير مدعوم في هذا المتصفّح.')); return; }
    /* ⚠️ getDisplayMedia straight from the click — it needs the user's gesture */
    navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).then(function (s) {
      disp = s;
      var go = function () {
        var rs = recStream();
        try { rec = new MediaRecorder(rs, { mimeType: 'video/webm' }); } catch (e) { rec = new MediaRecorder(rs); }
        chunks = [];
        rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        rec.onstop = finish;
        /* «إيقاف المشاركة» in Chrome's own strip ends the recording the same way */
        disp.getVideoTracks()[0].addEventListener('ended', function () { if (recording()) rec.stop(); });
        rec.start(1000);
        t0 = performance.now(); pausedAt = 0; pausedMs = 0;
        recUI(true); paintPause(); paintClock();
        clearInterval(tick); tick = setInterval(paintClock, 500);
      };
      if (mic && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (a) { micS = a; go(); }).catch(go);
      } else go();
    }).catch(function () { say(SYFS.t('أُلغي.')); });
  }
  function pauseRec() {
    if (!recording()) return;
    if (rec.state === 'paused') { rec.resume(); pausedMs += performance.now() - pausedAt; pausedAt = 0; }
    else { rec.pause(); pausedAt = performance.now(); }
    paintPause(); paintClock();
  }
  function stopRec() { if (recording()) rec.stop(); }
  function finish() {
    clearInterval(tick); tick = 0;
    var blob = new Blob(chunks, { type: 'video/webm' });
    chunks = []; rec = null; release();
    recUI(false);
    if (!blob.size) { say(SYFS.t('لم يُسجَّل شيء.')); return; }
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'screen-recording-' + stamp() + '.webm'; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    say(SYFS.t('حُفظ التسجيل ✓'));
  }

  SYFS.capbar = { show: show, hide: hide, toggle: toggle };

  SYFS.tools.push({
    id: 'capbar', name: 'شريط الالتقاط العائم', cat: 'media',
    icon: I.bar,
    hotkey: 'Ctrl+Alt+KeyR',
    action: toggle
  });

  /* ⛔ every stored value is whitelisted before it reaches a style or a branch —
     storage is shared with settings import (§4.1) */
  try {
    Promise.all([store.get('capbar_auto', false), store.get('capbar_pos', 'bottom'), store.get('capbar_mic', false), store.get('enabled', true),
      store.get('cap_after', 'editor')]).then(function (r) {
      pos = POS.indexOf(r[1]) >= 0 ? r[1] : 'bottom';
      mic = r[2] === true;
      after = AFTER.indexOf(r[4]) >= 0 ? r[4] : 'editor'; paintAfter();
      if (r[0] === true && r[3] !== false) show();
    });
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area !== 'local') return;
      if (ch.capbar_pos) { pos = POS.indexOf(ch.capbar_pos.newValue) >= 0 ? ch.capbar_pos.newValue : 'bottom'; place(); }
      if (ch.capbar_mic) { mic = ch.capbar_mic.newValue === true; paintMic(); }
      if (ch.cap_after) { after = AFTER.indexOf(ch.cap_after.newValue) >= 0 ? ch.cap_after.newValue : 'editor'; paintAfter(); }
    });
  } catch (e) { /* no extension context (a harness page) */ }
}());
