/* SYF — self-contained QR encoder (offline, no eval, no network, no deps).
 * Independent implementation of ISO/IEC 18004: byte mode (UTF-8), EC levels L/M/Q/H,
 * versions 1–40 (v0.171.0; up to 2953 bytes at L). Before that: level M, v1–7, 122 bytes
 * — and generate(text) with no options still produces exactly those matrices.
 * Exposes SYFS.qr.generate() and SYFS.qr.toCanvas().
 */
(function () {
  window.SYFS = window.SYFS || {};

  /* ---- GF(256), primitive poly 0x11d ---- */
  var EXP = new Array(512), LOG = new Array(256);
  (function () { var x = 1; for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  function rsGen(deg) { var p = [1]; for (var i = 0; i < deg; i++) { var np = new Array(p.length + 1); for (var k = 0; k < np.length; k++) np[k] = 0; for (var j = 0; j < p.length; j++) { np[j] ^= gmul(p[j], 1); np[j + 1] ^= gmul(p[j], EXP[i]); } p = np; } return p; }
  function rsEnc(data, ecLen) {
    var gen = rsGen(ecLen), res = new Array(ecLen);
    for (var i = 0; i < ecLen; i++) res[i] = 0;
    for (i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift(); res.push(0);
      if (factor !== 0) for (var j = 0; j < ecLen; j++) res[j] ^= gmul(gen[j + 1], factor);
    }
    return res;
  }

  /* ---- versions 1–40 × levels L/M/Q/H (v0.171.0) ----
   * ISO/IEC 18004 Table 9, as two numbers per (level, version): EC codewords per block
   * and the number of blocks. Everything else is DERIVED — total codewords from the
   * count of raw data modules, then short/long block sizes from the total — so there
   * is no 160-row table to mistype. The M rows for v1–7 are exactly the old hand table
   * ({10,1} {16,1} {26,1} {18,2} {24,2} {16,4} {18,4}); tools/qr-test.js decodes every
   * (version, level) with jsQR to prove the rest. */
  var LEVELS = ['L', 'M', 'Q', 'H'];
  var FMT_BITS = { L: 1, M: 0, Q: 3, H: 2 };   /* the format word's 2-bit level field */
  var ECC = {
    L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  };
  var BLOCKS = {
    L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  };
  /* modules left for data + EC once every function pattern is placed */
  function rawModules(v) {
    var r = (16 * v + 128) * v + 64;
    if (v >= 2) { var na = Math.floor(v / 7) + 2; r -= (25 * na - 10) * na - 55; if (v >= 7) r -= 36; }
    return r;
  }
  /* {ec, g:[[blocks, dataCodewords/block], …]} — short blocks first, as the standard orders them */
  function layout(v, ec) {
    var total = Math.floor(rawModules(v) / 8), nb = BLOCKS[ec][v - 1], e = ECC[ec][v - 1];
    var longN = total % nb, shortN = nb - longN, shortD = Math.floor(total / nb) - e;
    var g = [[shortN, shortD]]; if (longN) g.push([longN, shortD + 1]);
    return { ec: e, g: g };
  }
  function alignPos(v) {
    if (v === 1) return [];
    var n = Math.floor(v / 7) + 2, step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2, out = [6];
    for (var p = v * 4 + 10; out.length < n; p -= step) out.splice(1, 0, p);
    return out;
  }
  function totalData(v, ec) { var t = 0; layout(v, ec || 'M').g.forEach(function (grp) { t += grp[0] * grp[1]; }); return t; }
  /* byte-mode payload bits: mode(4) + count(8 for v1–9, 16 from v10) + 8 per byte */
  function needBits(n, v) { return 4 + (v < 10 ? 8 : 16) + 8 * n; }

  function bchDigit(d) { var n = 0; while (d !== 0) { n++; d >>>= 1; } return n; }
  function bchType(data) { var d = data << 10; while (bchDigit(d) - bchDigit(0x537) >= 0) d ^= 0x537 << (bchDigit(d) - bchDigit(0x537)); return ((data << 10) | d) ^ 0x5412; }
  function bchVer(data) { var d = data << 12; while (bchDigit(d) - bchDigit(0x1f25) >= 0) d ^= 0x1f25 << (bchDigit(d) - bchDigit(0x1f25)); return (data << 12) | d; }

  function maskFn(id, r, c) {
    switch (id) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return (r * c) % 2 + (r * c) % 3 === 0;
      case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
      case 7: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
    }
    return false;
  }

  /* ---- build full codeword stream (data + interleaved EC) ---- */
  function buildData(bytes, v, ec) {
    var L = layout(v, ec), dc = totalData(v, ec), bits = [];
    function push(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); }
    push(0x4, 4);                              // byte mode
    push(bytes.length, v < 10 ? 8 : 16);       // count: 8 bits for v1–9, 16 from v10
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);
    var cap = dc * 8;
    for (i = 0; i < 4 && bits.length < cap; i++) bits.push(0);  // terminator
    while (bits.length % 8) bits.push(0);
    var cw = [];
    for (i = 0; i < bits.length; i += 8) { var b = 0; for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; cw.push(b); }
    var pad = 0xEC; while (cw.length < dc) { cw.push(pad); pad = pad === 0xEC ? 0x11 : 0xEC; }
    /* split into blocks, compute EC */
    var blocks = [], idx = 0, ecLen = L.ec;
    L.g.forEach(function (grp) { for (var b = 0; b < grp[0]; b++) { var d = cw.slice(idx, idx + grp[1]); idx += grp[1]; blocks.push({ d: d, e: rsEnc(d, ecLen) }); } });
    /* interleave */
    var out = [], maxD = 0;
    blocks.forEach(function (bl) { if (bl.d.length > maxD) maxD = bl.d.length; });
    for (i = 0; i < maxD; i++) blocks.forEach(function (bl) { if (i < bl.d.length) out.push(bl.d[i]); });
    for (i = 0; i < ecLen; i++) blocks.forEach(function (bl) { out.push(bl.e[i]); });
    var ob = [];
    out.forEach(function (byte) { for (var k = 7; k >= 0; k--) ob.push((byte >> k) & 1); });
    return ob;
  }

  function placeFinder(m, f, size, row, col) {
    for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
      var rr = row + r, cc = col + c; if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      f[rr][cc] = true;
      m[rr][cc] = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6)) || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
    }
  }

  /* generate(text [, {ec:'L'|'M'|'Q'|'H', minVersion:1–40, mask:0–7}])
   * Defaults are the old behaviour: level M, the smallest version that fits, the mask
   * with the lowest penalty — so for anything that fitted before (≤122 bytes) the
   * matrix is identical bit for bit. Returns null only past v40 at that level. */
  function generate(text, opts) {
    opts = opts || {};
    var ec = LEVELS.indexOf(opts.ec) >= 0 ? opts.ec : 'M';
    var bytes = Array.prototype.slice.call(new TextEncoder().encode(text));
    var v = -1, minV = Math.min(40, Math.max(1, (opts.minVersion | 0) || 1));
    for (var t = minV; t <= 40; t++) { if (needBits(bytes.length, t) <= totalData(t, ec) * 8) { v = t; break; } }
    if (v < 0) return null;   // too long even for v40 at this level

    var size = 17 + 4 * v;
    var m = [], f = [];
    for (var i = 0; i < size; i++) { m[i] = []; f[i] = []; for (var j = 0; j < size; j++) { m[i][j] = false; f[i][j] = false; } }

    placeFinder(m, f, size, 0, 0); placeFinder(m, f, size, size - 7, 0); placeFinder(m, f, size, 0, size - 7);
    /* timing */
    for (i = 8; i < size - 8; i++) { m[6][i] = (i % 2 === 0); f[6][i] = true; m[i][6] = (i % 2 === 0); f[i][6] = true; }
    /* dark module */
    m[size - 8][8] = true; f[size - 8][8] = true;
    /* alignment */
    var ap = alignPos(v);
    ap.forEach(function (cr) {
      ap.forEach(function (cc) {
        if ((cr <= 8 && cc <= 8) || (cr <= 8 && cc >= size - 9) || (cr >= size - 9 && cc <= 8)) return;
        for (var r = -2; r <= 2; r++) for (var c = -2; c <= 2; c++) { f[cr + r][cc + c] = true; m[cr + r][cc + c] = (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)); }
      });
    });
    /* reserve format-info + version-info modules */
    for (i = 0; i <= 8; i++) { if (i !== 6) { f[8][i] = true; f[i][8] = true; } }
    for (i = 0; i < 8; i++) { f[8][size - 1 - i] = true; f[size - 1 - i][8] = true; }
    if (v >= 7) for (i = 0; i < 18; i++) { f[Math.floor(i / 3)][i % 3 + size - 11] = true; f[i % 3 + size - 11][Math.floor(i / 3)] = true; }

    /* place data zigzag */
    var bits = buildData(bytes, v, ec), idx = 0, up = true;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        var row = up ? (size - 1 - vert) : vert;
        for (var cc2 = 0; cc2 < 2; cc2++) {
          var col = right - cc2;
          if (f[row][col]) continue;
          m[row][col] = idx < bits.length ? !!bits[idx++] : false;
        }
      }
      up = !up;
    }

    /* choose best mask by penalty */
    function penalty(mat) {
      var s = 0, n = size, r, c, k;
      for (r = 0; r < n; r++) { var run = 1; for (c = 1; c < n; c++) { if (mat[r][c] === mat[r][c - 1]) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1; } }
      for (c = 0; c < n; c++) { run = 1; for (r = 1; r < n; r++) { if (mat[r][c] === mat[r - 1][c]) { run++; if (run === 5) s += 3; else if (run > 5) s++; } else run = 1; } }
      for (r = 0; r < n - 1; r++) for (c = 0; c < n - 1; c++) { var x = mat[r][c]; if (x === mat[r][c + 1] && x === mat[r + 1][c] && x === mat[r + 1][c + 1]) s += 3; }
      var pat = [true, false, true, true, true, false, true, false, false, false, false];
      function match(arr, off) { for (var z = 0; z < 11; z++) if (arr[off + z] !== pat[z]) return false; return true; }
      function matchR(arr, off) { for (var z = 0; z < 11; z++) if (arr[off + z] !== pat[10 - z]) return false; return true; }
      for (r = 0; r < n; r++) for (c = 0; c <= n - 11; c++) { if (match(mat[r], c) || matchR(mat[r], c)) s += 40; }
      for (c = 0; c < n; c++) { var colArr = []; for (r = 0; r < n; r++) colArr.push(mat[r][c]); for (r = 0; r <= n - 11; r++) if (match(colArr, r) || matchR(colArr, r)) s += 40; }
      var dark = 0; for (r = 0; r < n; r++) for (c = 0; c < n; c++) if (mat[r][c]) dark++;
      var pct = dark * 100 / (n * n); s += Math.floor(Math.abs(pct - 50) / 5) * 10;
      return s;
    }
    var best = 0, bestScore = Infinity, bestMat = null;
    var fixed = (opts.mask === +opts.mask && opts.mask >= 0 && opts.mask <= 7) ? opts.mask : -1;
    for (var mk = 0; mk < 8; mk++) {
      if (fixed >= 0 && mk !== fixed) continue;
      var mat = [];
      for (r = 0; r < size; r++) { mat[r] = []; for (c = 0; c < size; c++) mat[r][c] = f[r][c] ? m[r][c] : (m[r][c] !== maskFn(mk, r, c)); }
      var sc = penalty(mat);
      if (sc < bestScore) { bestScore = sc; best = mk; bestMat = mat; }
    }
    m = bestMat;

    /* write format info: 2-bit level + 3-bit mask */
    var fmt = bchType((FMT_BITS[ec] << 3) | best);
    for (i = 0; i < 15; i++) {
      var bit = ((fmt >> i) & 1) === 1;
      if (i < 6) m[i][8] = bit; else if (i < 8) m[i + 1][8] = bit; else m[size - 15 + i][8] = bit;
      if (i < 8) m[8][size - 1 - i] = bit; else if (i < 9) m[8][15 - i] = bit; else m[8][14 - i] = bit;
    }
    m[size - 8][8] = true;
    /* version info (v7) */
    if (v >= 7) { var vb = bchVer(v); for (i = 0; i < 18; i++) { var b2 = ((vb >> i) & 1) === 1; m[Math.floor(i / 3)][i % 3 + size - 11] = b2; m[i % 3 + size - 11][Math.floor(i / 3)] = b2; } }

    return { size: size, modules: m, version: v, ec: ec, mask: best };
  }

  /* render a generated matrix to a canvas (quiet zone = 4 modules) */
  function toCanvas(qr, scale) {
    scale = scale || 6; var q = 4, dim = (qr.size + q * 2) * scale;
    var cv = document.createElement('canvas'); cv.width = dim; cv.height = dim;
    var ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, dim, dim); ctx.fillStyle = '#1d2430';
    for (var r = 0; r < qr.size; r++) for (var c = 0; c < qr.size; c++) if (qr.modules[r][c]) ctx.fillRect((c + q) * scale, (r + q) * scale, scale, scale);
    return cv;
  }

  SYFS.qr = { generate: generate, toCanvas: toCanvas };
}());
