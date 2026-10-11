/* SYF — video.html: the three modes that WRITE a media file.
 *   · فصل الصوت   — the sound, on its own
 *   · قصّ الفيديو  — a piece of the clip
 *   · تحويل الصيغة — the whole clip, re-encoded
 *
 * TWO ENGINES SINCE v0.117.0, and which one runs is a property of the FILE:
 *
 *   · STREAM COPY (src/mp4copy.js, mp4box) — MP4/MOV only. The encoded samples are
 *     copied across untouched: seconds instead of minutes, and the picture is
 *     bit-for-bit the picture that went in. The cost is that a copy cannot start
 *     mid-GOP, so the cut snaps back to the nearest keyframe and the panel says which
 *     time it actually used.
 *   · RE-ENCODE (MediaRecorder) — everything else, and the fallback. It plays the clip
 *     and records the playback: REAL TIME, and the output is a new, softer encode.
 *
 * ⛔ THE FALLBACK IS NOT AUTOMATIC. A failed copy switches the control to «re-encode»
 * and stops; it does not quietly start a job that takes minutes and produces a
 * different kind of file than the one that was asked for. Same rule as the container
 * refusal below: name the change, let the user press the button again.
 *
 * ⛔ Still no ffmpeg, and «تحويل الصيغة» is untouched — a convert is a re-encode by
 * definition, so a muxer buys it nothing.
 *
 * The sound has three routes: M4A is the copy (exact, instant, MP4 only), WAV decodes
 * far faster than real time, and Opus is the small one that does sit through the clip. */
(function () {
  'use strict';
  var SYFS = window.SYFS || (window.SYFS = {});
  var P = SYFS.videoPage, VK = SYFS.videokit;
  if (!P || !VK) return;
  /* i18n-via: T — T IS SYFS.t (via src/video-page.js); every Arabic literal below
     reaches the DOM through it (§6.103) */
  var T = P.T, $ = P.$, ltr = P.ltr;

  /* Is this a file the copier can read at all? The name is a hint and the parser is the
     answer, but the hint is what keeps a 700MB WebM from being read into memory only to
     be refused. */
  function canCopy() {
    var f = P.file();
    return !!(SYFS.mp4copy && f && SYFS.mp4copy.likely(f.name, f.type));
  }
  /* a job started on file generation `g` finished after another file was opened: its
     output belongs to a clip that is gone (and a recorder on the closed element made
     BLACK frames) — drop it, never «تم ✓» (v0.139.3) */
  function stale(g) { return g !== P.gen(); }

  /* ===================== 1. فصل الصوت ===================== */
  var A = { fmt: 'wav', job: null };
  P.register({
    id: 'audio', label: 'فصل الصوت', panel: 'vp-audio',
    init: function () {
      audioChips();
      $('va-run').addEventListener('click', run);
      $('va-stop').addEventListener('click', function () { if (A.job) A.job.cancel(); });
    },
    onFile: function () { audioChips(); estimate(); },
    onLeave: function () { if (A.job) { A.job.cancel(); A.job = null; } }
  });

  /* The list depends on the FILE: M4A exists only where the sound can be copied, and a
     chip that is present and then refuses is worse than one that was never offered. */
  function audioChips() {
    var copy = canCopy();
    var items = copy
      ? [['m4a', 'M4A — نسخ بلا ترميز'], ['wav', 'WAV — أسرع'], ['opus', 'Opus — أصغر']]
      : [['wav', 'WAV — أسرع'], ['opus', 'Opus — أصغر']];
    if (copy) { if (A.fmt !== 'wav' && A.fmt !== 'opus') A.fmt = 'm4a'; }
    else if (A.fmt === 'm4a') A.fmt = 'wav';
    P.chips($('va-fmt'), items, function () { return A.fmt; },
      function (v) { A.fmt = v; estimate(); });
  }

  function estimate() {
    var v = P.video(); if (!v) return;
    if (A.fmt === 'm4a') {
      $('va-est').textContent = T('M4A — نسخة من مسار الصوت الأصلي بلا إعادة ترميز: أسرع الطرق وأدقّها، وحجمه حجم الصوت داخل الملفّ نفسه.');
      return;
    }
    var wav = Math.round(v.duration * 44100 * 2 * 2);      /* int16 stereo */
    $('va-est').textContent = A.fmt === 'wav'
      ? T('WAV تقريباً {0} — يُستخرج أسرع من زمن المقطع، بلا إعادة ترميز للصوت.', ltr(VK.fmtBytes(wav)))
      : T('Opus تقريباً {0} — أصغر بكثير، لكنه يُسجَّل بزمن المقطع نفسه ({1}).',
          ltr(VK.fmtBytes(v.duration * 8000)), ltr(VK.fmtTime(v.duration)));
  }
  function busyA(on) {
    $('va-run').hidden = on; $('va-stop').hidden = !on;
    $('va-prog').hidden = !on;
  }
  function run() {
    var v = P.video(), f = P.file();
    if (!v || !f) return;
    busyA(true);
    $('va-bar').style.width = '0%';
    $('va-note').textContent = T('يعمل…');
    var g = P.gen();
    if (A.fmt === 'm4a') runM4a(f, g);
    else if (A.fmt === 'wav') runWav(v, f, g);
    else runOpus(v, f, g);
  }
  function dropA() { busyA(false); $('va-note').textContent = ''; }
  /* The copy: the audio track lifted out of the container as it is. No decode, no
     encode, no playback — so there is no progress to report beyond «done». */
  function runM4a(f, g) {
    $('va-bar').style.width = '35%';
    f.arrayBuffer().then(function (buf) { return SYFS.mp4copy.audio(buf); }).then(function (r) {
      if (stale(g)) { dropA(); return; }
      $('va-bar').style.width = '100%';
      busyA(false);
      P.download(new Blob([r.buffer], { type: 'audio/mp4' }), VK.baseName(f.name) + '.m4a');
      $('va-note').textContent = T('تم ✓ — {0} · نُسخ بلا إعادة ترميز', ltr(VK.fmtBytes(r.buffer.byteLength)));
      P.toast(T('تم التنزيل ✓'));
    }).catch(function (e) {
      busyA(false);
      $('va-note').textContent = '';
      if (stale(g)) return;
      /* ⛔ no silent switch to WAV: the format was picked for a reason (§5.19/2). Say
         what happened and leave the next move to the person who pressed the button. */
      P.toast(e && e.message === 'no-audio-track'
        ? T('لا مسار صوت في هذا الملفّ.')
        : T('تعذّر نسخ الصوت من هذا الملفّ — جرّب WAV أو Opus.'));
    });
  }
  function runWav(v, f, g) {
    /* decodeAudioData wants the WHOLE file in memory as PCM, which is ~10MB a minute.
       The number is shown before the click; past a point it is simply refused, because
       a browser tab that runs out of memory takes the user's work with it. */
    if (v.duration > 45 * 60) {
      busyA(false);
      P.toast(T('المقطع أطول من ٤٥ دقيقة — اختر Opus بدل WAV.'));
      return;
    }
    VK.decodeAudio(f).then(function (audio) {
      if (stale(g)) { dropA(); return; }
      var chans = [];
      for (var c = 0; c < audio.numberOfChannels; c++) chans.push(audio.getChannelData(c));
      if (!chans.length) throw new Error('no-audio-track');
      var bytes = VK.wavBytes(chans, audio.sampleRate);
      P.download(new Blob([bytes], { type: 'audio/wav' }), VK.baseName(f.name) + '.wav');
      busyA(false);
      $('va-note').textContent = T('تم ✓ — {0} · {1} قناة · {2}Hz',
        ltr(VK.fmtBytes(bytes.length)), ltr(audio.numberOfChannels), ltr(audio.sampleRate));
      P.toast(T('تم التنزيل ✓'));
    }).catch(function (e) {
      busyA(false);
      $('va-note').textContent = '';
      if (stale(g)) return;
      P.toast(e && e.message === 'no-audio-track'
        ? T('لا مسار صوت في هذا الملفّ.')
        : T('تعذّر فكّ الصوت — قد يكون الترميز غير مدعوم في كروم.'));
    });
  }
  function runOpus(v, f, g) {
    var mime = VK.pickRecMime('audio');
    if (!mime) { busyA(false); P.toast(T('متصفّحك لا يدعم تسجيل هذه الصيغة.')); return; }
    /* an audio-only recording is the same machinery as a video one, minus the canvas */
    var track = VK.audioTrack(v.el);
    if (!track) { busyA(false); P.toast(T('لا مسار صوت في هذا الملفّ.')); return; }
    var stream = new MediaStream([track]);
    var rec = new MediaRecorder(stream, { mimeType: mime });
    var chunks = [], stopped = false;
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      try { v.el.pause(); } catch (e) { /* ignore */ }
      v.el.muted = true;
      clearInterval(tick);
      busyA(false);
      if (stale(g)) { $('va-note').textContent = ''; return; }
      var blob = new Blob(chunks, { type: mime });
      P.download(blob, VK.baseName(f.name) + '.' + (/ogg/.test(mime) ? 'ogg' : 'webm'));
      $('va-note').textContent = T('تم ✓ — {0}', ltr(VK.fmtBytes(blob.size)));
      P.toast(T('تم التنزيل ✓'));
    };
    A.job = { cancel: function () { if (!stopped) { stopped = true; try { rec.stop(); } catch (e) { /* ignore */ } } } };
    var tick = setInterval(function () {
      var p = Math.min(1, v.el.currentTime / (v.duration || 1));
      $('va-bar').style.width = Math.round(p * 100) + '%';
      if (v.el.ended || v.el.currentTime >= v.duration - 0.05) A.job.cancel();
    }, 250);
    VK.seek(v.el, 0).then(function () {
      v.el.muted = false;                 /* the graph gets the sound, the speakers do not */
      rec.start();
      var pr = v.el.play();
      if (pr && pr.catch) pr.catch(function () { /* the interval still ends it */ });
    }).catch(function () {
      /* a seek that never lands (VK.seek times out) left the recorder unstarted: its
         onstop never fires, so without this the panel sat on «يعمل…» for good */
      stopped = true; A.job = null;
      clearInterval(tick);
      busyA(false);
      $('va-note').textContent = '';
      if (!stale(g)) P.toast(T('تعذّر الانتقال داخل المقطع — قد يكون الملفّ تالفاً.'));
    });
  }

  /* ===================== 2 & 3. القصّ والتحويل =====================
   * One engine, two screens: a trim is a convert with a range, and a convert is a trim
   * of the whole clip. Sharing the code is also what keeps their progress, their
   * cancel and their «what you will get» line identical. */
  function encoder(cfg) {
    var S = { start: 0, end: 0, mute: false, fmt: 'webm', scale: 1, fps: 30, job: null, mode: 'enc' };

    /* MP4 recording exists in most current Chrome builds and in none of the old ones.
       ⛔ Do NOT silently fall back to WebM: the user picked a container because
       something downstream needs that container, and a file with the wrong one inside
       is a worse outcome than a refusal that names the reason. */
    function fitsMime() { return VK.pickRecMime(S.fmt); }
    function out() {
      var v = P.video();
      return { w: Math.round(v.width * S.scale), h: Math.round(v.height * S.scale) };
    }
    function refresh() {
      var v = P.video(); if (!v) return;
      var o = out(), len = Math.max(0, S.end - S.start);
      if (S.mode === 'copy') {
        /* ⚠️ the keyframe rule is stated BEFORE the click, not discovered after it:
           the output can start earlier than the handle was dragged to */
        $(cfg.est).textContent = T('الناتج: نسخة من المقطع الأصلي بلا إعادة ترميز · {0} · بثوانٍ. ⚠️ يبدأ من أقرب لقطة مفتاحية قبل نقطة البدء، فقد يبدأ أبكر ممّا اخترت.',
          ltr(VK.fmtTime(len)));
      } else {
        $(cfg.est).textContent = T('الناتج: {0} · {1} · يستغرق {2} تقريباً (يُعاد ترميزه بزمن التشغيل)',
          ltr(o.w + '×' + o.h), ltr(VK.fmtTime(len)), ltr(VK.fmtTime(len)));
      }
      if (cfg.onRefresh) cfg.onRefresh(S);
    }
    function busy(on) {
      $(cfg.run).hidden = on; $(cfg.stop).hidden = !on;
      $(cfg.prog).hidden = !on;
      if (cfg.onBusy) cfg.onBusy(on);
    }
    /* the stream copy: read the bytes, pick the samples, write a container. Nothing is
       played and nothing is encoded, so there is no meaningful progress between «went»
       and «came back». */
    function runCopy() {
      var f = P.file(), g = P.gen();
      busy(true);
      $(cfg.bar).style.width = '35%';
      $(cfg.note).textContent = T('ينسخ بلا إعادة ترميز…');
      f.arrayBuffer().then(function (buf) {
        return SYFS.mp4copy.trim(buf, S.start, S.end);
      }).then(function (r) {
        if (stale(g)) { busy(false); $(cfg.note).textContent = ''; return; }
        $(cfg.bar).style.width = '100%';
        busy(false);
        P.download(new Blob([r.buffer], { type: 'video/mp4' }), VK.baseName(f.name) + cfg.suffix + '.mp4');
        $(cfg.note).textContent = r.snapped
          ? T('تم ✓ — {0} · بدأ من {1} (أقرب لقطة مفتاحية)', ltr(VK.fmtBytes(r.buffer.byteLength)), ltr(VK.fmtTime(r.start)))
          : T('تم ✓ — {0} · بلا إعادة ترميز', ltr(VK.fmtBytes(r.buffer.byteLength)));
        P.toast(T('تم التنزيل ✓'));
      }).catch(function () {
        /* ⛔ NOT an automatic fallback. Re-encoding takes minutes and produces a
           different kind of file; starting it because a copy failed would be answering
           a question nobody asked. The control moves, the reason is written, and the
           second press is the user's. */
        busy(false);
        if (stale(g)) { $(cfg.note).textContent = ''; return; }
        $(cfg.bar).style.width = '0%';
        S.mode = 'enc';
        if (cfg.onFallback) cfg.onFallback();
        refresh();
        $(cfg.note).textContent = T('تعذّر النسخ بلا ترميز على هذا الملفّ — بُدِّل الوضع إلى «إعادة ترميز». اضغط مرّة أخرى لتنفيذه.');
        P.toast(T('تعذّر النسخ بلا ترميز'));
      });
    }

    function run() {
      var v = P.video(), f = P.file();
      if (!v || !f) return;
      if (S.mode === 'copy') { runCopy(); return; }
      var mime = fitsMime();
      if (!mime) {
        P.toast(S.fmt === 'mp4'
          ? T('نسخة كروم لديك لا تسجّل MP4 — اختر WebM.')
          : T('متصفّحك لا يدعم تسجيل هذه الصيغة.'));
        return;
      }
      var o = out(), g = P.gen();
      busy(true);
      $(cfg.bar).style.width = '0%';
      $(cfg.note).textContent = T('يعمل… لا تُغلق التبويب ولا تنتقل عنه.');
      S.job = VK.recordRange(v, {
        start: S.start, end: S.end, width: o.w, height: o.h, fps: S.fps,
        mime: mime, audio: !S.mute,
        onProgress: function (p) { $(cfg.bar).style.width = Math.round(p * 100) + '%'; }
      });
      S.job.done.then(function (blob) {
        busy(false); S.job = null;
        if (stale(g)) { $(cfg.note).textContent = ''; return; }
        P.download(blob, VK.baseName(f.name) + cfg.suffix + '.' + VK.recExt(mime));
        $(cfg.note).textContent = T('تم ✓ — {0}', ltr(VK.fmtBytes(blob.size)));
        P.toast(T('تم التنزيل ✓'));
      }).catch(function (e) {
        busy(false); S.job = null;
        $(cfg.note).textContent = '';
        if (stale(g)) return;
        P.toast(e && e.message === 'no-encoder'
          ? T('متصفّحك لا يدعم تسجيل هذه الصيغة.')
          : T('تعذّر إنشاء الملفّ.'));
      });
    }
    return { S: S, refresh: refresh, run: run, busy: busy,
      stop: function () { if (S.job) { S.job.cancel(); } } };
  }

  /* ---- القصّ ---- */
  var trim = encoder({
    est: 'vt-est', run: 'vt-run', stop: 'vt-stop', prog: 'vt-prog', bar: 'vt-bar',
    note: 'vt-note', suffix: '-cut',
    onFallback: function () { modeChips(); },
    /* the preview plays THE element the export records: a preview still running (its
       pause timer firing mid-export stalls the recorder) or pressed during one (a seek
       under the recorder) corrupts the output — stop it and lock it out (v0.139.3) */
    onBusy: function (on) {
      $('vt-preview').disabled = on;
      if (on) stopPreview();
    },
    onRefresh: function (S) {
      /* the container and the mute switch belong to the encoder; a copy takes the
         file's own container and its own tracks, so the controls that would lie are
         hidden rather than left there doing nothing */
      var enc = S.mode !== 'copy';
      $('vt-encopts').hidden = !enc;
    }
  });
  /* MP4 in, MP4 out — so the choice only exists for a file the copier can read, and it
     is the DEFAULT there, because it is faster and lossless and the person who wanted a
     re-encode can still ask for one. */
  function modeChips() {
    var items = canCopy()
      ? [['copy', 'نسخ بلا ترميز — بثوانٍ'], ['enc', 'إعادة ترميز']]
      : [['enc', 'إعادة ترميز']];
    P.chips($('vt-mode'), items, function () { return trim.S.mode; },
      function (v) { trim.S.mode = v; trim.refresh(); });
    /* the "MP4 only" line answers «why is the fast option missing», so it belongs on a
       file that is missing it — not on an empty panel with nothing loaded yet */
    $('vt-mode-hint').hidden = canCopy() || !P.file();
  }
  P.register({
    id: 'trim', label: 'قصّ الفيديو', panel: 'vp-trim',
    init: function () {
      modeChips();
      P.chips($('vt-fmt'), [['webm', 'WebM'], ['mp4', 'MP4']],
        function () { return trim.S.fmt; }, function (v) { trim.S.fmt = v; trim.refresh(); });
      $('vt-mute').addEventListener('change', function () { trim.S.mute = this.checked; });
      $('vt-start').addEventListener('input', function () {
        trim.S.start = Math.min(Number(this.value), trim.S.end - 0.5);
        syncTrim();
      });
      $('vt-end').addEventListener('input', function () {
        trim.S.end = Math.max(Number(this.value), trim.S.start + 0.5);
        syncTrim();
      });
      $('vt-run').addEventListener('click', trim.run);
      $('vt-stop').addEventListener('click', trim.stop);
      $('vt-preview').addEventListener('click', preview);
    },
    onFile: function (v) {
      trim.S.start = 0; trim.S.end = v.duration;
      trim.S.mode = canCopy() ? 'copy' : 'enc';
      modeChips();
      $('vt-start').max = $('vt-end').max = String(Math.floor(v.duration));
      $('vt-start').value = '0'; $('vt-end').value = String(Math.ceil(v.duration));
      syncTrim();
    },
    /* The preview shows THE element the engine will record — one decoder, and what you
       watch is literally what will be encoded. It is borrowed from the off-screen stage
       while this panel is open and put back on the way out, because a panel hidden with
       `hidden` is display:none, and a video in a display:none subtree stops painting —
       which would leave the frame grabber drawing a blank canvas. */
    onShow: function () { var v = P.video(); if (v) $('vt-frame').appendChild(v.el); },
    onLeave: function () { trim.stop(); stopPreview(); P.stage(); }
  });
  function syncTrim() {
    $('vt-start-v').textContent = VK.fmtTime(trim.S.start);   /* i18n-dyn: a timecode */
    $('vt-end-v').textContent = VK.fmtTime(trim.S.end);
    $('vt-len').textContent = VK.fmtTime(Math.max(0, trim.S.end - trim.S.start));
    trim.refresh();
  }
  var prevTimer = 0, prevSeq = 0;
  function stopPreview() {
    clearTimeout(prevTimer);
    prevSeq++;                           /* a seek still in flight must not start playing */
    var v = P.video();
    if (v) { try { v.el.pause(); } catch (e) { /* ignore */ } }
  }
  function preview() {
    var v = P.video(); if (!v || trim.S.job) return;
    clearTimeout(prevTimer);
    var seq = ++prevSeq;
    VK.seek(v.el, trim.S.start).then(function () {
      if (seq !== prevSeq || trim.S.job) return;
      v.el.muted = true;                 /* a preview is for the picture; the export is
                                            where the sound matters */
      var pr = v.el.play();
      if (pr && pr.catch) pr.catch(function () { /* ignore */ });
      prevTimer = setTimeout(function () { try { v.el.pause(); } catch (e) { /* ignore */ } },
        Math.max(300, (trim.S.end - trim.S.start) * 1000));
    }).catch(function () { /* the seek timed out — nothing is playing, nothing to undo */ });
  }

  /* ---- تحويل الصيغة ---- */
  var conv = encoder({
    est: 'vc-est', run: 'vc-run', stop: 'vc-stop', prog: 'vc-prog', bar: 'vc-bar',
    note: 'vc-note', suffix: '-converted'
  });
  P.register({
    id: 'convert', label: 'تحويل الصيغة', panel: 'vp-convert',
    init: function () {
      P.chips($('vc-fmt'), [['webm', 'WebM · VP9'], ['mp4', 'MP4 · H.264']],
        function () { return conv.S.fmt; }, function (v) { conv.S.fmt = v; conv.refresh(); });
      P.chips($('vc-scale'), [[1, 'كما هي'], [0.75, '٧٥٪'], [0.5, 'النصف'], [0.25, 'الرُّبع']],
        function () { return conv.S.scale; }, function (v) { conv.S.scale = Number(v); conv.refresh(); });
      P.chips($('vc-fps'), [[24, '24'], [30, '30'], [60, '60']],
        function () { return conv.S.fps; }, function (v) { conv.S.fps = Number(v); conv.refresh(); });
      $('vc-mute').addEventListener('change', function () { conv.S.mute = this.checked; });
      $('vc-run').addEventListener('click', conv.run);
      $('vc-stop').addEventListener('click', conv.stop);
    },
    onFile: function (v) { conv.S.start = 0; conv.S.end = v.duration; conv.refresh(); },
    onLeave: function () { conv.stop(); }
  });
}());
