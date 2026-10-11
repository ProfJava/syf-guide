/* SYF — the shared video engine (video.html and everything that will live on it).
 *
 * Phase 2 of the media workshop. The four video tools do the same thing in a different
 * order — open a file, read what is in it, choose, run, save — so the opening, the
 * validation, the timestamp maths, the ZIP writer and the save path live here once.
 *
 * ⛔ NO ffmpeg, and no library at all in this phase. Frame extraction is a <video>
 * element and a canvas: the browser already owns a hardware decoder, and asking it to
 * seek and hand us a frame is both the smallest and the fastest thing that works.
 * (Re-encoding — the converter, the audio split, the precise trim — needs WebCodecs
 * plus a container muxer, which is a dependency and therefore a decision. It is NOT
 * taken here; this file must stay dependency-free.)
 *
 * The pure half (timestamps, names, the ZIP bytes, CRC32, the sheet grid) has no DOM
 * and is exported for node — tools/frames-test.js builds a real archive with it and
 * asks `unzip -t` whether it is a real archive.
 *
 * PRIVACY, and it is structural rather than promised: the file is opened with
 * URL.createObjectURL and decoded by the tab. Nothing here fetches, uploads or stores
 * anything, and there is no code path that could — the only URL this file ever builds
 * is a blob: URL for a file the user just picked. */
(function () {
  'use strict';
  var VK = {};

  /* ===== what can be opened =====
   * Chrome plays what Chrome plays. `.avi`, `.wmv`, `.flv` and usually `.mkv` are not
   * decodable by any extension, with or without a library, so they are refused BY NAME
   * with the reason — never with a generic failure after a long wait. */
  VK.MAX_BYTES = 1536 * 1024 * 1024;         /* 1.5 GB — past this a seek-per-frame run
                                                is slower than the user's patience */
  VK.KNOWN_BAD = ['avi', 'wmv', 'flv', 'mkv', 'rmvb', 'vob', 'mpg', 'mpeg', '3g2', 'divx'];

  VK.ext = function (name) {
    var m = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/);
    return m ? m[1] : '';
  };
  /* null = fine; otherwise a REASON, as a msgid the caller translates.
   *
   * ⚠️ `canPlayType` IS NOT A GATE, and using it as one was a real bug: Chrome answers
   * '' for `video/quicktime` and then plays the .mov perfectly, because the empty
   * string means «I cannot promise from the MIME type alone», not «no». A file the
   * browser could have opened was refused before it was ever tried. So the check here
   * is only what is KNOWN to be undecodable — a short list of container formats no
   * browser ships a demuxer for — plus the size. Everything else is handed to the
   * <video> element, and if that fails the failure names itself.
   * ⛔ Do not re-introduce a capability probe in front of the attempt. */
  VK.rejectReason = function (file) {
    if (!file) return 'اختر ملفّ فيديو.';
    if (file.size > VK.MAX_BYTES) return 'الملفّ أكبر من ١٫٥ جيجابايت — جرّب مقطعاً أقصر.';
    if (VK.KNOWN_BAD.indexOf(VK.ext(file.name)) >= 0) return 'صيغة {0} لا يفتحها كروم أصلاً، ولا تستطيع أي إضافة فكّها. حوّل الملفّ إلى MP4 أو WebM أوّلاً.';
    return null;
  };

  /* ===== timestamps — pure =====
   * Two modes, and the cap is a REPORTED fact rather than a silent truncation:
   *   every : one frame each `step` seconds across [start, end]
   *   count : `n` frames spread evenly across [start, end], ends included */
  VK.MAX_FRAMES = 500;
  VK.times = function (duration, opts) {
    var o = opts || {};
    var dur = Number(duration) || 0;
    var start = Math.max(0, Math.min(Number(o.start) || 0, dur));
    var end = Math.max(start, Math.min(o.end === undefined || o.end === null ? dur : Number(o.end), dur));
    /* never seek to the very last instant: many containers have nothing to show there
       and the seek either lands on the previous frame or never fires `seeked` */
    var last = Math.max(start, end - 0.04);
    var out = [], capped = false;
    if (o.mode === 'count') {
      var n = Math.max(1, Math.min(Math.round(Number(o.count) || 1), VK.MAX_FRAMES));
      if (Math.round(Number(o.count) || 1) > VK.MAX_FRAMES) capped = true;
      if (n === 1) out.push((start + last) / 2);
      else for (var i = 0; i < n; i++) out.push(start + (last - start) * (i / (n - 1)));
    } else {
      var step = Number(o.step);
      if (!isFinite(step) || step <= 0) step = 1;
      for (var t = start; t <= last + 1e-6; t += step) {
        if (out.length >= VK.MAX_FRAMES) { capped = true; break; }
        out.push(Math.min(t, last));
      }
      if (!out.length) out.push(start);
    }
    return { times: out, capped: capped };
  };

  /* ===== names and time formatting — pure ===== */
  VK.pad = function (n, w) { var s = String(Math.max(0, Math.floor(n))); while (s.length < w) s = '0' + s; return s; };
  /* mm:ss.d — LATIN digits in both languages: this is a timecode, not prose */
  VK.fmtTime = function (sec) {
    sec = Math.max(0, Number(sec) || 0);
    var m = Math.floor(sec / 60), s = sec - m * 60;
    if (m >= 60) return VK.pad(Math.floor(m / 60), 2) + ':' + VK.pad(m % 60, 2) + ':' + VK.pad(s, 2);
    return VK.pad(m, 2) + ':' + VK.pad(Math.floor(s), 2) + '.' + Math.floor((s % 1) * 10);
  };
  /* a frame's file name: index first so a file manager sorts them in playing order,
     timestamp second so a single frame is identifiable out of context. Whitelisted —
     these names go into a ZIP and then onto a filesystem. */
  VK.frameName = function (i, sec, ext) {
    var t = VK.fmtTime(sec).replace(/[:.]/g, '-');
    return 'frame-' + VK.pad(i + 1, 4) + '_' + t + '.' + (ext === 'png' ? 'png' : (ext === 'webp' ? 'webp' : 'jpg'));
  };
  /* the base name of the archive, from the video's own name */
  VK.baseName = function (name) {
    return String(name || '').replace(/\.[^.]+$/, '')
      .replace(/[^0-9A-Za-z؀-ۿ \-_]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 48) || 'video';
  };

  /* ===== the contact sheet grid — pure =====
   * `ceil(sqrt(n))` columns: the classic contact-sheet rule, i.e. a roughly square
   * COUNT of cells rather than a square sheet in pixels. Aiming for a square sheet is
   * the tempting version and it is wrong — with 16:9 cells it answers "9 frames" with
   * two columns and five rows, a tall strip nobody scans. Then the width cap wins if
   * the result would be too wide to open. */
  VK.sheetGrid = function (n, cellW, cellH, gap, maxWidth) {
    n = Math.max(1, Math.floor(n));
    gap = gap || 0;
    var cols = Math.ceil(Math.sqrt(n));
    if (maxWidth) {
      var fit = Math.floor((maxWidth - gap) / (cellW + gap));
      if (fit >= 1 && cols > fit) cols = fit;
    }
    var rows = Math.ceil(n / cols);
    return {
      cols: cols, rows: rows,
      w: cols * cellW + (cols + 1) * gap,
      h: rows * cellH + (rows + 1) * gap
    };
  };

  /* ===== ZIP (store only) — pure bytes =====
   * Images are already compressed; deflating them again buys ~1% for a dependency and
   * a second implementation of a format. Store-only ZIP is ~90 lines and every byte of
   * it is checkable — tools/frames-test.js writes one and runs `unzip -t` over it. */
  var CRC_T = null;
  function crcTable() {
    if (CRC_T) return CRC_T;
    CRC_T = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_T[n] = c >>> 0;
    }
    return CRC_T;
  }
  VK.crc32 = function (buf) {
    var t = crcTable(), c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  function utf8(str) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(str);
    var out = [], s = unescape(encodeURIComponent(str));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return new Uint8Array(out);
  }
  function w16(a, o, v) { a[o] = v & 0xFF; a[o + 1] = (v >>> 8) & 0xFF; }
  function w32(a, o, v) { a[o] = v & 0xFF; a[o + 1] = (v >>> 8) & 0xFF; a[o + 2] = (v >>> 16) & 0xFF; a[o + 3] = (v >>> 24) & 0xFF; }

  /* entries: [{ name, data: Uint8Array }] → one Uint8Array holding a valid archive */
  VK.zipBytes = function (entries) {
    var parts = [], central = [], offset = 0;
    entries.forEach(function (e) {
      var name = utf8(e.name), data = e.data, crc = VK.crc32(data);
      var lh = new Uint8Array(30 + name.length);
      w32(lh, 0, 0x04034b50);
      w16(lh, 4, 20);                 /* version needed */
      w16(lh, 6, 0x0800);             /* bit 11: the name is UTF-8 */
      w16(lh, 8, 0);                  /* method 0 = store */
      w16(lh, 10, 0); w16(lh, 12, 0); /* dos time/date — a fixed value, see below */
      w32(lh, 14, crc);
      w32(lh, 18, data.length); w32(lh, 22, data.length);
      w16(lh, 26, name.length); w16(lh, 28, 0);
      lh.set(name, 30);
      parts.push(lh, data);

      var ch = new Uint8Array(46 + name.length);
      w32(ch, 0, 0x02014b50);
      w16(ch, 4, 20); w16(ch, 6, 20);
      w16(ch, 8, 0x0800); w16(ch, 10, 0);
      w16(ch, 12, 0); w16(ch, 14, 0);
      w32(ch, 16, crc);
      w32(ch, 20, data.length); w32(ch, 24, data.length);
      w16(ch, 28, name.length); w16(ch, 30, 0); w16(ch, 32, 0);
      w16(ch, 34, 0); w16(ch, 36, 0); w32(ch, 38, 0);
      w32(ch, 42, offset);
      ch.set(name, 46);
      central.push(ch);
      offset += lh.length + data.length;
    });
    var cdSize = central.reduce(function (n, c) { return n + c.length; }, 0);
    var eocd = new Uint8Array(22);
    w32(eocd, 0, 0x06054b50);
    w16(eocd, 4, 0); w16(eocd, 6, 0);
    w16(eocd, 8, entries.length); w16(eocd, 10, entries.length);
    w32(eocd, 12, cdSize); w32(eocd, 16, offset);
    w16(eocd, 20, 0);
    var all = parts.concat(central, [eocd]);
    var total = all.reduce(function (n, p) { return n + p.length; }, 0);
    var out = new Uint8Array(total), at = 0;
    all.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  };
  /* ⚠️ the DOS timestamp above is deliberately zero: a real clock would make the same
     input produce a different archive every run, and «did the output change?» is a
     question worth being able to answer. Extractors show it as 1980-01-01. */

  /* ===== DOM side: open a file, seek it, grab frames ===== */
  VK.OPEN_TIMEOUT = 20000;

  /* A file recorded by a browser (MediaRecorder) or streamed to disk carries no
   * duration in its header, and the element reports Infinity. Seeking far past the end
   * makes the demuxer walk to the last cluster and report the real one — the standard
   * workaround, and the tool needs it because "how long is it" is the first question
   * every mode here asks. */
  function resolveDuration(v) {
    return new Promise(function (done) {
      if (isFinite(v.duration) && v.duration > 0) { done(v.duration); return; }
      var t = setTimeout(function () { cleanup(); done(v.duration); }, 4000);
      function cleanup() { clearTimeout(t); v.removeEventListener('durationchange', onChange); }
      function onChange() {
        if (!isFinite(v.duration)) return;
        cleanup();
        try { v.currentTime = 0; } catch (e) { /* ignore */ }
        done(v.duration);
      }
      v.addEventListener('durationchange', onChange);
      try { v.currentTime = 1e6; } catch (e) { cleanup(); done(v.duration); }
    });
  }

  VK.load = function (file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var v = document.createElement('video');
      v.preload = 'auto'; v.muted = true; v.playsInline = true;
      var done = false;
      var fail = function (why) {
        if (done) return;
        done = true; clearTimeout(timer);
        URL.revokeObjectURL(url);
        reject(new Error(why || 'decode'));
      };
      /* ⚠️ A media element that cannot load does NOT always fire `error`: a source the
         loader never finishes reading sits at readyState 0 with `stalled` and nothing
         else, forever. Without this timeout the tool shows «يفتح…» until the tab is
         closed — observed, not imagined, while testing this file. */
      var timer = setTimeout(function () { fail('timeout'); }, VK.OPEN_TIMEOUT);
      v.addEventListener('error', function () { fail('decode'); });
      v.addEventListener('loadedmetadata', function () {
        if (done) return;
        resolveDuration(v).then(function (dur) {
          if (done) return;
          done = true; clearTimeout(timer);
          resolve({
            el: v, url: url, width: v.videoWidth, height: v.videoHeight,
            duration: (isFinite(dur) && dur > 0) ? dur : 0,
            close: function () { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {} URL.revokeObjectURL(url); }
          });
        });
      });
      v.src = url;
    });
  };

  /* seek to `t` and resolve once the frame at that position is actually painted.
     `seeked` alone is not enough on some builds — one rVFC (or a rAF fallback) after it
     is what guarantees drawImage sees the new frame rather than the previous one. */
  VK.seek = function (v, t) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () { if (!settled) { settled = true; reject(new Error('seek-timeout')); } }, 8000);
      var after = function () {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (typeof v.requestVideoFrameCallback === 'function') v.requestVideoFrameCallback(function () { resolve(); });
        else requestAnimationFrame(function () { resolve(); });
      };
      v.addEventListener('seeked', after, { once: true });
      try { v.currentTime = t; } catch (e) { clearTimeout(timer); reject(e); }
    });
  };

  /* ===== encoding a range, without a muxer ==========================================
   * Phases 3–5 (audio out, trim, convert) all need to WRITE a media file, and WebCodecs
   * cannot: it hands back compressed frames and knows nothing about containers. The
   * usual answer is to bundle a muxer (mp4box.js, ~250KB) — a production dependency,
   * and therefore a decision that is not ours to take quietly.
   *
   * MediaRecorder muxes internally, so the whole job fits with no dependency at all.
   * The price is real and is stated in the UI rather than discovered by the user:
   *   · it runs in REAL TIME — a two-minute trim takes two minutes;
   *   · it RE-ENCODES — the output is a new encode, not a copy of the original stream.
   * A stream copy (seconds, no loss) is what a muxer would buy, and the trade is left
   * where it belongs: on the table, named, for the user to take or not. */
  VK.REC_MIMES = {
    mp4: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4'],
    webm: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'],
    audio: ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
  };
  /* the first candidate this browser will actually record, or '' — never a guess */
  VK.pickRecMime = function (kind) {
    var list = VK.REC_MIMES[kind] || [];
    if (typeof MediaRecorder !== 'function' || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < list.length; i++) if (MediaRecorder.isTypeSupported(list[i])) return list[i];
    return '';
  };
  VK.recExt = function (mime) { return /mp4/.test(mime) ? 'mp4' : (/ogg/.test(mime) ? 'ogg' : 'webm'); };

  /* The element's audio, as a track, WITHOUT playing it out loud.
   * ⚠️ `createMediaElementSource` may be called only ONCE per element — a second call
   * throws and the element goes silent for good — so the graph is cached on the element
   * itself. And the node is deliberately NOT connected to ctx.destination: connecting it
   * would play the clip aloud through the whole export. */
  VK.audioTrack = function (el) {
    try {
      if (!el.__syfAudio) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        var ctx = new AC();
        var src = ctx.createMediaElementSource(el);
        var dest = ctx.createMediaStreamDestination();
        src.connect(dest);
        el.__syfAudio = { ctx: ctx, dest: dest };
      }
      var a = el.__syfAudio;
      if (a.ctx.state === 'suspended') a.ctx.resume();
      return a.dest.stream.getAudioTracks()[0] || null;
    } catch (e) { return null; }
  };

  /* Record [start, end] of a loaded video into one Blob.
   *   opts: start, end, width, height, fps, mime, audio (bool), bitrate, onProgress(0..1)
   * Returns { done: Promise<Blob>, cancel() } — cancel KEEPS what was recorded so far,
   * because a user who stops a five-minute export at four minutes wants the four. */
  VK.recordRange = function (v, opts) {
    var o = opts || {};
    var el = v.el;
    var start = Math.max(0, Number(o.start) || 0);
    var end = Math.max(start + 0.05, Number(o.end) || v.duration || 0);
    var fps = Math.max(1, Math.min(Number(o.fps) || 30, 60));
    var w = Math.max(2, Math.round(o.width || v.width));
    var h = Math.max(2, Math.round(o.height || v.height));
    var cancelled = false, rec = null, stopTimer = 0;

    var done = new Promise(function (resolve, reject) {
      var mime = o.mime || VK.pickRecMime('webm');
      if (!mime) { reject(new Error('no-encoder')); return; }

      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var cx = cv.getContext('2d');
      var stream = cv.captureStream(fps);
      if (o.audio !== false) {
        var t = VK.audioTrack(el);
        if (t) { try { stream.addTrack(t); } catch (e) { /* video only, then */ } }
      }
      var conf = { mimeType: mime };
      if (o.bitrate) conf.videoBitsPerSecond = o.bitrate;
      try { rec = new MediaRecorder(stream, conf); }
      catch (e) { reject(new Error('no-encoder')); return; }

      var chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        try { el.pause(); } catch (e) { /* ignore */ }
        el.muted = true;
        stream.getVideoTracks().forEach(function (tr) { tr.stop(); });
        clearTimeout(stopTimer);
        resolve(new Blob(chunks, { type: mime }));
      };
      rec.onerror = function () { reject(new Error('record')); };

      /* the draw pump: one canvas paint per presented frame. requestVideoFrameCallback
         is the right hook — it fires when a NEW frame is on screen, so nothing is drawn
         twice and nothing is missed; rAF is the fallback and merely samples. */
      var pump = function () {
        if (cancelled) return;
        cx.drawImage(el, 0, 0, w, h);
        if (o.onProgress) o.onProgress(Math.min(1, Math.max(0, (el.currentTime - start) / (end - start))));
        if (el.currentTime >= end || el.ended) { finish(); return; }
        next();
      };
      var next = function () {
        if (typeof el.requestVideoFrameCallback === 'function') el.requestVideoFrameCallback(pump);
        else requestAnimationFrame(pump);
      };
      var finished = false;
      var finish = function () {
        if (finished) return;
        finished = true;
        try { if (rec.state !== 'inactive') rec.stop(); } catch (e) { /* ignore */ }
      };

      VK.seek(el, start).then(function () {
        el.muted = (o.audio === false);        /* the graph, not the speakers, gets the sound */
        rec.start();
        var p = el.play();
        if (p && p.catch) p.catch(function () { /* a blocked play still stops below */ });
        next();
        /* a belt for the case where the pump never runs (a tab in the background stops
           firing rVFC): stop at the wall-clock length of the range plus a margin */
        stopTimer = setTimeout(finish, (end - start) * 1000 + 4000);
      }).catch(function () { reject(new Error('seek')); });
    });

    return {
      done: done,
      cancel: function () {
        cancelled = true;
        try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) { /* ignore */ }
      }
    };
  };

  /* ===== audio out, the fast way =====
   * decodeAudioData is far faster than real time, so pulling the sound out of a file
   * does not have to sit through it. The cost is memory: PCM is ~10MB a minute in
   * stereo, so the caller is told the size before it commits. */
  VK.PCM_BYTES_PER_SEC = 44100 * 2 * 4;      /* float32 stereo, the decoder's own layout */
  VK.decodeAudio = function (file) {
    return file.arrayBuffer().then(function (buf) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('no-audio');
      var ctx = new AC();
      return ctx.decodeAudioData(buf).then(function (audio) {
        try { ctx.close(); } catch (e) { /* ignore */ }
        return audio;
      }, function () {
        try { ctx.close(); } catch (e) { /* ignore */ }
        throw new Error('decode-audio');
      });
    });
  };

  /* ===== WAV, written here rather than depended on =====
   * A RIFF/PCM header is 44 bytes and the body is interleaved int16. That is the whole
   * format — a library for it would be more code to audit than to write. Pure, so
   * tools/video-test.js checks the header field by field. */
  VK.wavBytes = function (channels, sampleRate) {
    var ch = Math.max(1, channels.length);
    var n = channels[0] ? channels[0].length : 0;
    var bytes = 44 + n * ch * 2;
    var out = new Uint8Array(bytes);
    var dv = new DataView(out.buffer);
    var ascii = function (off, s) { for (var i = 0; i < s.length; i++) out[off + i] = s.charCodeAt(i); };
    ascii(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); ascii(8, 'WAVE');
    ascii(12, 'fmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);                       /* PCM */
    dv.setUint16(22, ch, true);
    dv.setUint32(24, sampleRate, true);
    dv.setUint32(28, sampleRate * ch * 2, true);     /* byte rate */
    dv.setUint16(32, ch * 2, true);                  /* block align */
    dv.setUint16(34, 16, true);                      /* bits */
    ascii(36, 'data'); dv.setUint32(40, n * ch * 2, true);
    var at = 44;
    for (var i = 0; i < n; i++) {
      for (var c = 0; c < ch; c++) {
        var s = channels[c][i];
        /* clamp before scaling: a decoder can hand back values outside [-1,1] and
           wrapping them turns a loud passage into white noise */
        s = s > 1 ? 1 : (s < -1 ? -1 : s);
        dv.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        at += 2;
      }
    }
    return out;
  };

  VK.fmtBytes = function (n) {
    n = Number(n) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = VK;
  if (typeof window !== 'undefined') {
    window.SYFS = window.SYFS || {};
    window.SYFS.videokit = VK;
  }
}());
