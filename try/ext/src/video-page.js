/* SYF — video.html: the page shell that the four video tools share.
 *
 * One file is opened ONCE and every mode works on it: pull stills out of it, take its
 * sound, cut a piece, re-encode it. Each mode registers itself here and is handed the
 * panel that already exists in the page; this file owns what they all need — the
 * picker, the drop zone, the file line, the tab bar, the toast, the download path — so
 * none of them carries a second copy of it.
 *
 * ⚠️ Every panel's markup lives in video.html, not in JS. That is not a style choice:
 * `data-syfs-i18n="page"` translates the page's static text (§6.102), and markup built
 * from JS strings would need every label to go through t() by hand — the same text,
 * twice as much code, and one more place to forget.
 *
 * ⛔ Nothing here (or in any mode) fetches or uploads: the file is opened from the
 * user's own File with a blob: URL and decoded by the tab. Closing it is the cleanup. */
(function () {
  'use strict';
  var SYFS = window.SYFS || (window.SYFS = {});
  var VK = SYFS.videokit;

  /* i18n-via: T — every Arabic string reaches the DOM through this (§6.103) */
  var T = function () { return SYFS.t ? SYFS.t.apply(null, arguments) : arguments[0]; };
  var $ = function (id) { return document.getElementById(id); };
  /* an LTR isolate: a number or a latin name inside an Arabic sentence is re-ordered
     with the paragraph otherwise — «1920×1080» reads «1080×1920» (§6.98/9) */
  var ltr = function (s) { return '⁦' + s + '⁩'; };

  var modes = [], current = -1, vid = null, srcFile = null;
  /* bumped every time a file is picked. A job captures it when it starts and drops its
     result if it changed — the old element is closed under it (src removed), so a
     recorder still running on it records BLACK and would otherwise report «تم ✓» */
  var gen = 0;

  var P = SYFS.videoPage = {
    T: T, $: $, ltr: ltr,
    video: function () { return vid; },
    file: function () { return srcFile; },
    gen: function () { return gen; },
    /* a mode is { id, label, panel: '<element id>', init(el), onFile(v), onLeave() } */
    register: function (mode) { modes.push(mode); },
    toast: toast,
    download: download,
    /* the same segmented control every panel uses */
    chips: function (host, items, get, set) {
      host.textContent = '';
      items.forEach(function (it) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'chip'; b.dataset.v = String(it[0]);
        b.textContent = T(it[1]);
        b.addEventListener('click', function () {
          set(it[0]);
          host.querySelectorAll('.chip').forEach(function (x) { x.classList.toggle('on', x === b); });
        });
        host.appendChild(b);
      });
      var v = String(get());
      host.querySelectorAll('.chip').forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); });
    },
    /* Park the video element back in the off-screen stage.
     * ⚠️ The stage is `position:fixed; left:-99999px`, NOT `display:none`: a media
     * element in a display:none subtree stops painting, and `drawImage` on it yields a
     * blank canvas — which would break the frame grabber and the recorder silently,
     * with an output that looks like a plain black video. */
    stage: function () { var v = vid; if (v && v.el) $('vp-stage').appendChild(v.el); },
    /* a range input with its readout, wired in one line */
    range: function (id, vid2, get, set, fmt) {
      var el = $(id), out = $(vid2);
      var show = function () { out.textContent = fmt(get()); };
      el.value = String(get()); show();
      el.addEventListener('input', function () { set(Number(el.value)); show(); });
      return show;
    }
  };

  var toastT = 0;
  function toast(msg) {
    var el = $('vp-toast');
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('on'); }, 3200);
  }
  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    /* a long revoke: a 300MB export can still be flushing to disk when a short one
       would already have been collected */
    setTimeout(function () { URL.revokeObjectURL(url); }, 20000);
  }

  /* ===== opening ===== */
  function openFile(file) {
    var why = VK.rejectReason(file);
    if (why) { toast(T(why, VK.ext(file && file.name).toUpperCase())); return; }
    var mine = ++gen;
    /* stop every running job BEFORE its element goes away (v0.139.3) */
    modes.forEach(function (m) { if (m.onLeave) { try { m.onLeave(); } catch (e) { /* ignore */ } } });
    if (vid) { vid.close(); vid = null; srcFile = null; }
    $('vp-open').textContent = T('يفتح…');
    VK.load(file).then(function (v) {
      /* a second pick while this one was still opening: the later one wins */
      if (mine !== gen) { v.close(); return; }
      vid = v; srcFile = file;
      $('vp-open').textContent = T('اختر ملفّاً آخر');
      $('vp-file').hidden = false;
      $('vp-file').textContent = T('{0} · {1} · {2} · {3}',
        file.name, ltr(v.width + '×' + v.height), ltr(VK.fmtTime(v.duration)), ltr(VK.fmtBytes(file.size)));
      $('vp-tabs').hidden = false;
      $('vp-panels').hidden = false;
      /* the element lives on the page from here on — see `stage` above for why it is
         parked off-screen rather than left detached or hidden */
      $('vp-stage').appendChild(v.el);
      /* one mode throwing must not take the page with it */
      modes.forEach(function (m) { if (m.onFile) { try { m.onFile(v); } catch (e) { /* ignore */ } } });
      var act = modes[current];
      if (act && act.onShow) { try { act.onShow(); } catch (e) { /* ignore */ } }
    }).catch(function (e) {
      if (mine !== gen) return;
      $('vp-open').textContent = T('اختر ملفّ فيديو');
      toast(e && e.message === 'timeout'
        ? T('لم يبدأ تشغيل الملفّ خلال ٢٠ ثانية — قد يكون تالفاً أو بترميز لا يفكّه كروم.')
        : T('تعذّر فتح الملفّ — قد تكون الصيغة غير مدعومة في كروم.'));
    });
  }

  /* ===== tabs ===== */
  function show(i) {
    if (!modes[i]) return;
    if (i !== current && modes[current] && modes[current].onLeave) {
      try { modes[current].onLeave(); } catch (e) { /* ignore */ }
    }
    current = i;
    modes.forEach(function (m, j) {
      m.__btn.classList.toggle('on', j === i);
      m.__panel.hidden = j !== i;
    });
    if (vid && modes[i].onShow) { try { modes[i].onShow(); } catch (e) { /* ignore */ } }
  }

  function boot() {
    var bar = $('vp-tabs');
    modes.forEach(function (m, i) {
      m.__panel = $(m.panel);
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'vtab';
      b.textContent = T(m.label);
      b.addEventListener('click', function () { show(i); });
      bar.appendChild(b);
      m.__btn = b;
      if (m.init) { try { m.init(m.__panel); } catch (e) { /* ignore */ } }
    });

    $('vp-input').addEventListener('change', function () { if (this.files && this.files[0]) openFile(this.files[0]); });
    $('vp-open').addEventListener('click', function () { $('vp-input').click(); });
    var drop = $('vp-dropzone');
    ['dragenter', 'dragover'].forEach(function (e) {
      drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (e) {
      drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (ev) {
      var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f) openFile(f);
    });

    /* the mode named in the URL fragment opens first — the rail has four entries and
       each one means a different screen (#frames, #audio, #trim, #convert) */
    var want = (location.hash || '').replace('#', ''), idx = 0;
    modes.forEach(function (m, i) { if (m.id === want) idx = i; });
    show(idx);
  }

  window.addEventListener('beforeunload', function () {
    modes.forEach(function (m) { if (m.onLeave) { try { m.onLeave(); } catch (e) { /* ignore */ } } });
    if (vid) vid.close();
  });

  function start() {
    var store = SYFS.storage;
    /* the language is applied BEFORE any control is built: a chip painted one frame
       early paints Arabic into an English page and is never repainted (§6.100/4) */
    if (store && SYFS.i18n && SYFS.i18n.apply) {
      store.get(SYFS.i18n.KEY, SYFS.i18n.DEFAULT)
        .then(function (l) { return SYFS.i18n.apply(l); })
        .then(boot, boot);
    } else boot();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}());
