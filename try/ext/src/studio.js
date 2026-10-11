/* SYF — «الاستوديو» host (v0.166.0): the studio page (studio.html) in a rail window.
 *
 * Design هـ + د from plans/media-studio.html, rebuilt: the tools are no longer the old
 * panels mounted side by side (v0.165.0) — they are the studio page, every image tool
 * plus the layered editor, framed here. Two ways to show it, ONE switch:
 *   هـ «نافذة عائمة»  a large floating window (drag, resize, minimise as any tool)
 *   د  «ملء الشاشة»   the same window maximised over the page (.syfs-max)
 * The switch is labelled in the studio's own top bar and the window head's ⤢ is the
 * same switch — both end in toggling .syfs-max, and a MutationObserver reports the
 * state back to the frame, so the two can never disagree. The choice is remembered
 * (`studio_mode`, whitelisted on read).
 *
 * THE BRIDGE. The frame posts commands only ({syfsStudio:1, cmd}); this side accepts a
 * message only when it comes from THIS frame's window AND the extension's origin — a
 * page script can post to us, but it cannot be our iframe. The image goes the other way
 * through the worker: it is staged in chrome.storage.session (SYFS_EDIT_OPEN, stage:true)
 * and only its key crosses into the frame, which reads and deletes it (studio/app.js).
 *
 * Lazy: loaded by the worker after media.js (background.js LAZY_TOOL_FILES) — the
 * capture routines it runs for the studio's «التقاط» group live there (SYFS._media). */
(function () {
  window.SYFS = window.SYFS || {};
  SYFS.tools = SYFS.tools || [];
  var store = SYFS.store;

  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var ICON = SVG + '<rect x="2.5" y="5" width="19" height="14" rx="3"/><circle cx="12" cy="12" r="3.2"/><path d="M6.5 8.5h.01"/><path d="M16 2.5l-2 2.5M8 2.5l2 2.5"/></svg>';

  var MODES = ['win', 'full'];
  var KINDS = ['region', 'visible', 'full'];
  /* the studio page ids a caller may open on — the same set studio/panels register */
  var PAGES = ['editor', 'bg', 'convert', 'compress', 'resize', 'watermark', 'batch', 'collage', 'pdf', 'ocr', 'qrgen', 'qrread', 'exif', 'palette'];
  function pick(list, v, d) { return list.indexOf(v) >= 0 ? v : d; }
  var ORIGIN = '';
  try { ORIGIN = new URL(chrome.runtime.getURL('')).origin; } catch (e) {}

  var live = null;        /* { win, frame, ready, queue[] } while the window exists */
  var want = null;        /* { page, key } asked for before the window was mounted */

  function post(msg) {
    if (!live || !live.frame.contentWindow || !ORIGIN) return;
    msg.syfsStudio = 1;
    if (!live.ready) { live.queue.push(msg); return; }
    /* targetOrigin = the extension: the image key is never offered to a navigated frame */
    live.frame.contentWindow.postMessage(msg, ORIGIN);
  }

  /* canvas → worker stage → key → frame. Too big for the session quota: say so. */
  var MAX = 9 * 1024 * 1024;
  function stage(canvas, cb) {
    var url = canvas.toDataURL('image/png');
    if (url.length > MAX) url = canvas.toDataURL('image/jpeg', 0.92);
    if (url.length > MAX) { cb(null, 'toobig'); return; }
    try {
      chrome.runtime.sendMessage({ type: 'SYFS_EDIT_OPEN', dataUrl: url, stage: true }, function (r) {
        if (chrome.runtime.lastError || !r || !r.ok || typeof r.key !== 'string') { cb(null, 'failed'); return; }
        cb(r.key);
      });
    } catch (e) { cb(null, 'failed'); }
  }
  function deliver(canvas, page) {
    stage(canvas, function (key, err) {
      if (!key) { post({ cmd: 'note', code: err }); return; }
      if (live && live.win.isConnected) post({ cmd: 'load', k: key, tool: page });
      else { want = { page: page, key: key }; openStudio(); }
    });
  }

  /* the studio's «التقاط» group: shoot THIS page (the window hides itself — the capture
     routines hide #syfs-host — and comes back with the shot open in the editor) */
  var shooting = false;
  function captureFor(kind) {
    var M = SYFS._media;
    if (shooting || !M) return;
    var fn = { region: M.regionCanvas, visible: M.visibleCanvas, full: M.fullCanvas }[pick(KINDS, kind, '')];
    if (typeof fn !== 'function') return;
    shooting = true;
    Promise.resolve().then(fn).then(function (cv) {
      shooting = false;
      if (!cv) { post({ cmd: 'note', code: 'cancelled' }); return; }
      deliver(cv, 'editor');
    }, function () { shooting = false; post({ cmd: 'note', code: 'failed' }); });
  }

  function onMessage(e) {
    if (!live || e.source !== live.frame.contentWindow || e.origin !== ORIGIN) return;
    var d = e.data;
    if (!d || typeof d !== 'object' || d.syfsStudio !== 1) return;
    if (d.cmd === 'ready') {
      live.ready = true;
      var q = live.queue; live.queue = [];
      q.forEach(function (m) { live.frame.contentWindow.postMessage(m, ORIGIN); });
      post({ cmd: 'mode', mode: isFull() ? 'full' : 'win' });
    } else if (d.cmd === 'mode') setFull(d.mode === 'full');
    else if (d.cmd === 'capture') captureFor(d.kind);
    else if (d.cmd === 'close') { var x = live.win.querySelector('.syfs-win-x'); if (x) x.click(); }
  }

  function isFull() { return !!(live && live.win.classList.contains('syfs-max')); }
  function setFull(on) {
    if (!live || isFull() === on) return;
    var mb = live.win.querySelector('.syfs-win-max'); if (mb) mb.click();
  }

  function mount(body) {
    var win = body.closest ? body.closest('.syfs-win') : null;
    var w0 = want; want = null;
    /* a big first size — the studio is a workspace, not a panel. A size the user saved
       later still wins (rail.js reads win_studio after mount), and the grip goes anywhere. */
    if (win) win.style.width = Math.max(320, Math.min(1240, window.innerWidth - 24)) + 'px';
    body.classList.add('syf-st-host');            /* the height: rail.css, so ⤢ can take over */

    var frame = document.createElement('iframe');
    frame.className = 'syf-st-frame';
    frame.setAttribute('allow', 'clipboard-read; clipboard-write');
    frame.title = SYFS.t('الاستوديو');
    var page = w0 && pick(PAGES, w0.page, '') ? w0.page : '';
    frame.src = chrome.runtime.getURL('studio.html') + '?host=win' + (w0 && w0.key ? '&k=' + encodeURIComponent(w0.key) : '') + (page ? '#' + page : '');
    body.appendChild(frame);

    if (live) window.removeEventListener('message', onMessage);
    live = { win: win || body, frame: frame, ready: false, queue: [] };
    window.addEventListener('message', onMessage);

    if (win) {
      /* the head's ⤢ and the studio's switch are one control: report every change */
      var last = '';
      new MutationObserver(function () {
        if (!live || live.frame !== frame) return;
        var m = isFull() ? 'full' : 'win';
        if (m === last) return;            /* focus/shut classes change too — only the mode counts */
        last = m;
        post({ cmd: 'mode', mode: m });
        store.set('studio_mode', m);
      }).observe(win, { attributes: true, attributeFilter: ['class'] });
      store.get('studio_mode', 'win').then(function (m) {
        /* after openWindow has placed the window — maximising first would be undone by centreWin */
        if (pick(MODES, m, 'win') === 'full') setTimeout(function () { if (frame.isConnected) setFull(true); }, 150);
      });
    }
  }

  function openStudio() { if (SYFS.openToolById) SYFS.openToolById('studio'); }

  SYFS.studio = {
    /* open the studio, optionally on one of its pages */
    open: function (page) {
      page = pick(PAGES, page, '');
      if (live && live.win.isConnected) { openStudio(); return; }
      if (page) want = { page: page, key: '' };
      openStudio();
    },
    /* open the studio with this canvas as the open image — the capture toasts' ✏️ */
    openImage: function (canvas, page) { if (canvas) deliver(canvas, pick(PAGES, page, 'editor')); },
    /* shoot this page and open the shot — the floating bar's «الصفحة كاملة» */
    capture: function (kind) { captureFor(kind); }
  };

  SYFS.tools.push({ id: 'studio', name: 'الاستوديو', cat: 'media', icon: ICON, mount: mount });
}());
