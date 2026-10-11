/* SYF — status maker, the pure core (no DOM, no canvas, no chrome.*).
 *
 * Everything here is arithmetic over text and boxes, which is exactly the part that
 * is worth testing and the part a browser makes expensive to test. The UI layer
 * (src/status.js) owns the canvas and passes in a `measure(size, text) -> px` closure
 * built from `ctx.measureText`; nothing in this file knows what a canvas is.
 *
 * `module.exports` at the bottom is for `tools/status-test.js` (node) — the file is
 * loaded as a plain <script> on the page, so the guard has to be a typeof check.
 *
 * ⚠️ The user's own text NEVER leaves this file as markup. It is measured, split and
 * handed back as an array of strings that the UI writes with `fillText`. There is no
 * path from here into innerHTML, and there must never be one. */
(function () {
  'use strict';
  var CORE = {};

  /* ===== output sizes =====
   * `safeTop`/`safeBottom` are the fractions of the height that the TARGET APP covers
   * with its own interface — the sender's name and the timestamp at the top, the reply
   * field at the bottom. Text centred on the raw canvas lands under them and is read
   * as "cropped" by everyone who opens the status.
   * ⚠️ They are approximations of someone else's UI, deliberately generous, and the UI
   * says so. They are not a promise about a particular phone. */
  CORE.PRESETS = [
    { id: 'wa',   ar: 'حالة واتساب',  w: 1080, h: 1920, safeTop: 0.13, safeBottom: 0.15 },
    { id: 'story', ar: 'ستوري فيسبوك', w: 1080, h: 1920, safeTop: 0.14, safeBottom: 0.20 },
    { id: 'post', ar: 'منشور عريض',   w: 1200, h: 630,  safeTop: 0.07, safeBottom: 0.07 },
    { id: 'sq',   ar: 'مربّع',         w: 1080, h: 1080, safeTop: 0.08, safeBottom: 0.08 }
  ];
  /* two stops each: a gradient is one decision, and a three-stop picker is three */
  CORE.PALETTES = [
    { id: 'emerald', ar: 'زمرّدي', from: '#1f4d3f', to: '#8fd0b4' },
    { id: 'night',   ar: 'ليلي',  from: '#0b0f14', to: '#2b3440' },
    { id: 'violet',  ar: 'بنفسجي', from: '#3b2a55', to: '#b39ddb' },
    { id: 'ocean',   ar: 'محيط',  from: '#123b52', to: '#84c1dd' },
    { id: 'sunset',  ar: 'غروب',  from: '#5c2f2f', to: '#e3a08a' },
    { id: 'rose',    ar: 'وردي',  from: '#5b1f3a', to: '#e8a0bf' },
    { id: 'forest',  ar: 'غابة',  from: '#14301f', to: '#6fa86a' },
    { id: 'sand',    ar: 'رملي',  from: '#f7f3e8', to: '#d9c9a3' }
  ];
  CORE.BGKINDS = ['gradient', 'solid', 'image'];
  CORE.ALIGNS = ['center', 'start', 'end'];
  CORE.WEIGHTS = [400, 700];          /* ⚠️ the bundled families ship 400 and 700 ONLY
                                         (src/fontkit.js) — a 900 here would be the
                                         browser faking a weight, which on an Arabic
                                         naskh face looks like a printing fault */
  CORE.EFFECTS = ['none', 'shadow', 'outline', 'plate'];

  CORE.DEFAULTS = {
    preset: 'wa', bg: 'gradient', palette: 'emerald', solid: '#14301f',
    angle: 150, font: 'tajawal', weight: 700, align: 'center', effect: 'shadow',
    ink: 'auto', lineHeight: 1.55, pad: 0.09, scrim: 0.35, blur: 0, safe: true, size: 0
  };

  function has(list, v) { for (var i = 0; i < list.length; i++) if (list[i] === v) return true; return false; }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  CORE.preset = function (id) { return byId(CORE.PRESETS, id) || CORE.PRESETS[0]; };
  CORE.palette = function (id) { return byId(CORE.PALETTES, id) || CORE.PALETTES[0]; };

  /* a hex colour, or null. Whitelist: exactly #rgb or #rrggbb, nothing else — this
     value is written into a canvas fillStyle and read back as a colour, so a string
     that is not a colour must be REJECTED rather than passed through (§4.1). */
  CORE.hex = function (v) {
    var s = String(v || '').trim();
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return null;
    if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return s.toLowerCase();
  };
  function num(v, lo, hi, def) { v = Number(v); return (isFinite(v) && v >= lo && v <= hi) ? v : def; }

  /* stored preferences → a usable state. Every field is checked against its own
     whitelist and falls back to the DOCUMENTED default, never to a neighbour. */
  CORE.mergeOptions = function (stored) {
    var d = CORE.DEFAULTS, s = (stored && typeof stored === 'object') ? stored : {};
    return {
      preset: byId(CORE.PRESETS, s.preset) ? s.preset : d.preset,
      bg: has(CORE.BGKINDS, s.bg) ? s.bg : d.bg,
      palette: byId(CORE.PALETTES, s.palette) ? s.palette : d.palette,
      solid: CORE.hex(s.solid) || d.solid,
      angle: num(s.angle, 0, 360, d.angle),
      font: typeof s.font === 'string' ? s.font.slice(0, 40) : d.font,   /* fontkit validates it */
      weight: has(CORE.WEIGHTS, Number(s.weight)) ? Number(s.weight) : d.weight,
      align: has(CORE.ALIGNS, s.align) ? s.align : d.align,
      effect: has(CORE.EFFECTS, s.effect) ? s.effect : d.effect,
      ink: (s.ink === 'light' || s.ink === 'dark' || s.ink === 'auto') ? s.ink : d.ink,
      lineHeight: num(s.lineHeight, 1.1, 2.4, d.lineHeight),
      pad: num(s.pad, 0.03, 0.2, d.pad),
      scrim: num(s.scrim, 0, 0.85, d.scrim),
      blur: num(s.blur, 0, 24, d.blur),
      safe: s.safe === undefined ? d.safe : !!s.safe,
      size: num(s.size, 0, 400, d.size)          /* 0 = auto-fit */
    };
  };

  /* ===== the box the text is allowed to live in =====
   * The safe fractions come off the TOP and BOTTOM only: the apps do not cover the
   * sides, and narrowing the width for symmetry would cost line length for nothing. */
  CORE.safeBox = function (preset, opts) {
    var p = typeof preset === 'string' ? CORE.preset(preset) : preset;
    var o = opts || {};
    var pad = num(o.pad, 0.03, 0.2, CORE.DEFAULTS.pad) * p.w;
    var top = o.safe === false ? 0 : p.safeTop, bot = o.safe === false ? 0 : p.safeBottom;
    return {
      x: pad,
      y: p.h * top + pad,
      w: p.w - pad * 2,
      h: p.h * (1 - top - bot) - pad * 2
    };
  };

  /* ===== wrapping =====
   * Greedy, per paragraph, and it never drops a character:
   *   - an explicit newline always breaks (a poem is two lines because it was typed
   *     as two lines, whatever the width says);
   *   - a word longer than the whole line is split BY CHARACTER rather than allowed
   *     to overflow — a URL or a long compound is the normal case here, and the
   *     alternative is text running off the image;
   *   - `measure` is the caller's, so Arabic shaping is measured by the same engine
   *     that will paint it.  */
  CORE.wrapLines = function (measure, text, maxW) {
    var out = [], paras = String(text === undefined || text === null ? '' : text).split('\n');
    for (var p = 0; p < paras.length; p++) {
      var words = paras[p].split(/\s+/).filter(function (w) { return w.length; });
      if (!words.length) { out.push(''); continue; }
      var line = '';
      for (var i = 0; i < words.length; i++) {
        var w = words[i], next = line ? line + ' ' + w : w;
        if (measure(next) <= maxW || !line) {
          /* a single word that cannot fit alone: break it by character */
          if (!line && measure(w) > maxW) {
            var chunk = '';
            for (var c = 0; c < w.length; c++) {
              if (chunk && measure(chunk + w[c]) > maxW) { out.push(chunk); chunk = ''; }
              chunk += w[c];
            }
            line = chunk;
            continue;
          }
          line = next;
        } else { out.push(line); line = w; }
      }
      out.push(line);
    }
    return out;
  };

  /* ===== auto-fit =====
   * Binary search for the largest size whose wrapped block fits the box in BOTH
   * directions. It is a search rather than a formula because wrapping is not a
   * continuous function of the size: one pixel more can add a whole line.
   * `measure(size, text)` must return the width of `text` at that size. */
  CORE.MIN_SIZE = 12;
  CORE.fitSize = function (measure, text, box, opts) {
    var o = opts || {}, lh = num(o.lineHeight, 1.1, 2.4, CORE.DEFAULTS.lineHeight);
    var hi = Math.max(CORE.MIN_SIZE, Math.floor(box.h));
    var lo = CORE.MIN_SIZE, best = CORE.MIN_SIZE;
    var fits = function (size) {
      var lines = CORE.wrapLines(function (s) { return measure(size, s); }, text, box.w);
      if (lines.length * size * lh > box.h) return false;
      for (var i = 0; i < lines.length; i++) if (measure(size, lines[i]) > box.w) return false;
      return true;
    };
    if (!String(text || '').trim()) return Math.min(hi, 96);
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (fits(mid)) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
  };

  /* size + wrapped lines + the vertical offset that centres the block in the box */
  CORE.layout = function (measure, text, box, opts) {
    var o = opts || {};
    var lh = num(o.lineHeight, 1.1, 2.4, CORE.DEFAULTS.lineHeight);
    var size = num(o.size, 1, 400, 0) || CORE.fitSize(measure, text, box, o);
    var lines = CORE.wrapLines(function (s) { return measure(size, s); }, text, box.w);
    var blockH = lines.length * size * lh;
    return { size: size, lines: lines, lineH: size * lh, blockH: blockH, top: box.y + (box.h - blockH) / 2 };
  };

  /* ===== ink =====
   * Relative luminance (WCAG), so «auto» picks the ink by CONTRAST rather than by a
   * guess about which palette is "dark". A gradient is judged by its midpoint. */
  CORE.luminance = function (hex) {
    var s = CORE.hex(hex) || '#000000';
    var ch = [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)].map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  CORE.mix = function (a, b, t) {
    var A = CORE.hex(a) || '#000000', B = CORE.hex(b) || '#ffffff', out = '#';
    for (var i = 1; i < 7; i += 2) {
      var v = Math.round(parseInt(A.substr(i, 2), 16) * (1 - t) + parseInt(B.substr(i, 2), 16) * t);
      out += ('0' + v.toString(16)).slice(-2);
    }
    return out;
  };
  /* the effective background colour of a state, for the ink decision */
  CORE.bgColour = function (opts) {
    var o = opts || {};
    if (o.bg === 'solid') return CORE.hex(o.solid) || CORE.DEFAULTS.solid;
    if (o.bg === 'image') return CORE.mix('#000000', '#ffffff', Math.max(0, 1 - num(o.scrim, 0, 0.85, 0.35) - 0.25));
    var p = CORE.palette(o.palette);
    return CORE.mix(p.from, p.to, 0.5);
  };
  CORE.pickInk = function (opts) {
    var o = opts || {};
    if (o.ink === 'light') return '#ffffff';
    if (o.ink === 'dark') return '#101418';
    return CORE.luminance(CORE.bgColour(o)) > 0.42 ? '#101418' : '#ffffff';
  };

  /* ===== the download name =====
   * Built from the user's own first words so a folder of statuses is readable, and
   * whitelisted down to letters/digits/dash — a name reaches the filesystem, so
   * slashes, dots, colons and control characters cannot be spelled at all. */
  CORE.fileName = function (text, ext) {
    var base = String(text || '').split('\n')[0]
      .replace(/[^0-9A-Za-z؀-ۿ ]/g, ' ')
      .replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join('-').slice(0, 48);
    return (base || 'status') + '.' + (ext === 'jpg' ? 'jpg' : 'png');
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
  if (typeof window !== 'undefined') {
    window.SYFS = window.SYFS || {};
    window.SYFS.statusCore = CORE;
  }
}());
