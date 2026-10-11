/* SYF — MP4 stream copy (mp4box.js). Cutting a clip WITHOUT re-encoding it.
 *
 * WHAT IT BUYS. The MediaRecorder path in src/videdit.js plays the clip and records the
 * playback: a two-minute trim takes two minutes and the output is a new encode, softer
 * than the original. This path copies the encoded samples across untouched: seconds
 * instead of minutes, and the picture is bit-for-bit the picture that went in.
 *
 * WHAT IT COSTS, said on screen and not discovered:
 *   · MP4/MOV only. A copy needs a muxer that understands the container; WebM does not
 *     go through here and keeps the old path.
 *   · THE CUT SNAPS BACK TO A KEYFRAME. A copy cannot start mid-GOP — the frames before
 *     the next keyframe are stored as differences from frames we would be dropping. So
 *     the start moves EARLIER, by up to a keyframe interval, and the panel reports the
 *     time it actually used. ⛔ Do not "fix" this by starting at the requested sample:
 *     that produces a file that opens, plays, and shows a smear until the next keyframe.
 *
 * ⛔ THE OUTPUT IS RE-PARSED BEFORE IT IS HANDED OVER. Remuxing writes a container by
 * hand; a wrong table produces a file that looks fine (right size, right name, no error)
 * and plays as garbage — the classic silent failure. `verify()` re-reads what we just
 * wrote and checks the track and sample counts against what we put in, and the caller
 * falls back to the re-encode path when it does not agree. A stream copy is an
 * optimisation, so it is allowed to decline; it is not allowed to be wrong.
 *
 * The pure part — which samples are in the range — is `pickRange`, and it is where an
 * off-by-one hides without throwing, so it is lifted out and tested on its own
 * (tools/mp4copy-test.js). No network, no storage, no worker: the file is read in the
 * tab that picked it and the bytes never leave it. */
(function () {
  'use strict';
  var SYFS = window.SYFS || (window.SYFS = {});
  var M = SYFS.mp4copy = SYFS.mp4copy || {};

  /* ISOBMFF only. The name is a hint, not the answer — probe() is the answer — but a
     cheap hint keeps a 700MB WebM from being read into memory just to be rejected. */
  M.LIKELY = ['mp4', 'm4v', 'mov', 'm4a'];
  M.likely = function (name, type) {
    var ext = String(name || '').toLowerCase().replace(/^.*\./, '');
    if (M.LIKELY.indexOf(ext) >= 0) return true;
    return /^(video|audio)\/(mp4|quicktime|x-m4v)/.test(String(type || ''));
  };

  /* ---- the pure part ----
   * `samples` is mp4box's own sample list: {cts, dts, duration, timescale, is_sync}.
   * Returns {from, to, start, end} in SAMPLE INDICES and SECONDS, or null when the
   * range holds nothing.
   *
   * `needSync` is true for video: the first kept sample must be a keyframe, so `from`
   * walks BACK to the last one at or before t0. For audio every sample stands alone,
   * so the window is taken as asked. */
  M.pickRange = function (samples, t0, t1, needSync) {
    if (!samples || !samples.length) return null;
    if (!(t1 > t0)) return null;
    var i, ts, from = -1, to = -1;
    function at(k) { return samples[k].cts / (samples[k].timescale || 1); }
    function end(k) { return (samples[k].cts + (samples[k].duration || 0)) / (samples[k].timescale || 1); }

    /* ⛔ the window has to touch the media at all. Without this the keyframe walk-back
       below happily answers «the last keyframe» for a range that starts after the clip
       ends, and a request for 5s–6s of a 1s clip comes back as its final GOP — a wrong
       answer that looks like a right one (§4.1: reject, never guess). */
    if (t0 >= end(samples.length - 1) - 1e-6) return null;

    if (needSync) {
      for (i = 0; i < samples.length; i++) {
        ts = at(i);
        if (ts > t0 + 1e-6) break;
        if (samples[i].is_sync) from = i;
      }
      /* no keyframe at or before the cut — the only honest start is the first one
         there IS, and the caller reports the time it landed on */
      if (from < 0) {
        for (i = 0; i < samples.length; i++) if (samples[i].is_sync) { from = i; break; }
      }
      if (from < 0) from = 0;                 /* no sync flags at all: copy from the top */
    } else {
      for (i = 0; i < samples.length; i++) {
        if (end(i) > t0 + 1e-6) { from = i; break; }
      }
      if (from < 0) return null;
    }

    for (i = from; i < samples.length; i++) {
      if (at(i) >= t1 - 1e-6) break;
      to = i;
    }
    if (to < from) return null;
    return { from: from, to: to, start: at(from), end: end(to) };
  };

  /* ---- the library ---- */
  var mod = null;
  M.load = function () {
    if (mod) return Promise.resolve(mod);
    return import(chrome.runtime.getURL('lib/mp4box/mp4box.all.mjs')).then(function (m) {
      mod = m; return m;
    });
  };

  /* ⚠️ ONE pass, and the extraction is armed inside `onReady` — not after `flush()`.
     mp4box delivers samples while it consumes the buffer, so options set once the
     buffer is already drained arm nothing and `onSamples` is never called: every track
     comes back EMPTY and the only symptom is an «empty range». Measured; do not
     re-order this into parse-then-extract because it reads more tidily.
     `withSamples`: false (tables only) · true (every track) · or a function
     (info) ⇒ [track ids] — arm ONLY those. Extracting the sound must not copy the
     whole video track into memory as well (a 1.4GB file held twice, v0.139.3). */
  function readAll(MP4, buf, withSamples) {
    var f = MP4.createFile();
    var info = null, failed = '', samples = {};
    f.onError = function (mo, msg) { failed = String(mo) + ': ' + String(msg); };
    f.onSamples = function (id, user, arr) {
      var a = samples[id] || (samples[id] = []);
      for (var i = 0; i < arr.length; i++) a.push(arr[i]);
    };
    f.onReady = function (i) {
      info = i;
      if (!withSamples) return;
      var only = typeof withSamples === 'function' ? withSamples(i) : null;
      (i.tracks || []).forEach(function (t) {
        if (only && only.indexOf(t.id) < 0) return;
        samples[t.id] = samples[t.id] || [];
        f.setExtractionOptions(t.id, null, { nbSamples: Math.max(1, t.nb_samples) });
      });
      f.start();
    };
    f.appendBuffer(MP4.MP4BoxBuffer.fromArrayBuffer(buf, 0));
    f.flush();
    if (!info) throw new Error(failed || 'not-mp4');
    return { file: f, info: info, samples: samples };
  }

  /* every child of the source sample entry — avcC / hvcC / esds / dOps / pasp / colr …
     THIS is the codec configuration, and it is the whole reason a copy decodes at all */
  function descBoxes(entry) {
    return (entry && entry.boxes) ? entry.boxes.slice() : [];
  }

  function trackOpts(entry, tk, len) {
    var o = {
      timescale: tk.timescale,
      media_duration: 0,
      duration: Math.round(len * 1000),
      language: tk.language || 'und',
      type: entry.type,
      description_boxes: descBoxes(entry)
    };
    if (entry.width) { o.width = entry.width; o.height = entry.height; o.hdlr = 'vide'; }
    else {
      o.hdlr = 'soun';
      o.channel_count = entry.channel_count || 2;
      o.samplesize = entry.samplesize || 16;
      o.samplerate = entry.samplerate || 44100;
    }
    return o;
  }

  /* ---- the copy ----
   * `want` is a list of {track, samples, from, to} already chosen. Returns an
   * ArrayBuffer, or throws. */
  function build(MP4, want, startSec, lenSec, brands) {
    var out = MP4.createFile();
    out.init({ timescale: 1000, duration: Math.round(lenSec * 1000), brands: brands && brands.length ? brands : ['isom', 'iso2', 'mp41'] });
    var wrote = [];
    want.forEach(function (w) {
      var first = w.samples[w.from];
      var entry = first.description;
      var opts = trackOpts(entry, w.track, lenSec);
      /* every track is rebased against the SAME wall-clock start, not against its own
         first sample — rebasing each track to its own zero drifts them apart */
      var off = Math.round(startSec * w.track.timescale);
      var media = 0;
      for (var i = w.from; i <= w.to; i++) media += (w.samples[i].duration || 0);
      opts.media_duration = media;
      var id = out.addTrack(opts);
      if (!id) throw new Error('addTrack-failed:' + entry.type);
      var n = 0;
      for (i = w.from; i <= w.to; i++) {
        var s = w.samples[i];
        out.addSample(id, s.data, {
          duration: s.duration,
          dts: Math.max(0, s.dts - off),
          cts: Math.max(0, s.cts - off),
          is_sync: !!s.is_sync
        });
        n++;
      }
      wrote.push({ type: entry.type, count: n });
    });
    var ds = out.getBuffer();
    var ab = (ds && ds.buffer) ? ds.buffer : ds;
    return { buffer: ab, wrote: wrote };
  }

  /* ⛔ the guard that makes a silent bad mux impossible to ship: read our own output
     back and count. A container written wrong parses as fewer tracks or fewer samples
     long before a human notices the picture is wrong. */
  function verify(MP4, ab, wrote) {
    var p;
    try { p = readAll(MP4, ab, false); } catch (e) { return false; }
    var tracks = p.info.tracks || [];
    if (tracks.length !== wrote.length) return false;
    for (var i = 0; i < wrote.length; i++) {
      if (tracks[i].nb_samples !== wrote[i].count) return false;
    }
    return true;
  }

  function pickTracks(info) {
    var v = [], a = [];
    (info.tracks || []).forEach(function (t) {
      if (t.video) v.push(t); else if (t.audio) a.push(t);
    });
    return { video: v, audio: a };
  }

  /* ---- trim: the range, both tracks, no re-encode ---- */
  M.trim = function (buf, t0, t1) {
    return M.load().then(function (MP4) {
      var p = readAll(MP4, buf, true);
      var tk = pickTracks(p.info);
      var all = tk.video.concat(tk.audio);
      if (!all.length) throw new Error('no-copyable-track');

      var loaded = all.map(function (t) {
        return { track: t, samples: p.samples[t.id] || [], video: tk.video.indexOf(t) >= 0 };
      }).filter(function (o) { return o.samples.length; });
      if (!loaded.length) throw new Error('no-samples');
      var ref = loaded[0];
      var r = M.pickRange(ref.samples, t0, t1, ref.video);
      if (!r) throw new Error('empty-range');
      var startSec = r.start;

      var want = [{ track: ref.track, samples: ref.samples, from: r.from, to: r.to }];
      for (var i = 1; i < loaded.length; i++) {
        var o = loaded[i];
        var ro = M.pickRange(o.samples, startSec, t1, false);
        if (ro) want.push({ track: o.track, samples: o.samples, from: ro.from, to: ro.to });
      }
      var lenSec = Math.max(0.001, r.end - startSec);
      var built = build(MP4, want, startSec, lenSec, p.info.brands);
      if (!verify(MP4, built.buffer, built.wrote)) throw new Error('verify-failed');
      return {
        buffer: built.buffer,
        start: startSec,          /* what was actually used — may be EARLIER than asked */
        end: r.end,
        snapped: startSec < t0 - 0.02,
        tracks: built.wrote
      };
    });
  };

  /* ---- audio: the sound track on its own, as .m4a, no re-encode ---- */
  M.audio = function (buf) {
    return M.load().then(function (MP4) {
      /* arm the FIRST audio track only — the one that is written below */
      var p = readAll(MP4, buf, function (info) {
        var a = pickTracks(info).audio;
        return a.length ? [a[0].id] : [];
      });
      var tk = pickTracks(p.info);
      if (!tk.audio.length) throw new Error('no-audio-track');
      var t = tk.audio[0];
      var samples = p.samples[t.id] || [];
      if (!samples.length) throw new Error('no-audio-track');
      var lenSec = (t.duration || 0) / (t.timescale || 1);
      var built = build(MP4, [{ track: t, samples: samples, from: 0, to: samples.length - 1 }],
        0, lenSec || 0.001, ['M4A ', 'isom', 'mp42']);
      if (!verify(MP4, built.buffer, built.wrote)) throw new Error('verify-failed');
      return { buffer: built.buffer, codec: t.codec, seconds: lenSec };
    });
  };
}());
