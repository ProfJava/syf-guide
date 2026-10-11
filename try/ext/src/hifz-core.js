/* SYF — «التحفيظ» core (v0.182.0): the memorisation plan, pure — no DOM, no storage, no
 * clock of its own (every function is handed `today`). hifz.html uses it, and so does
 * tools/hifz-test.js, which runs this file as it ships.
 *
 * The model, as approved in the prototype (syf-tools-proto/hifz-kids/hifz.html):
 *   plan  — direction (from An-Nas up, or from al-Fatiha down), ayahs per day, the
 *           memorising weekdays, the far-review cycle, a reminder time, the listening
 *           settings, and what was memorised before starting (`memo`, whole surahs).
 *   log   — the segments memorised: { s, a0, a1, learned, last, ease, due, old }.
 *   today — 1. new: the next uncovered ayahs (a memorising day only);
 *           2. near: everything learned in the last 7 days, plus whatever a rating
 *              brought back (`due` ≤ today);
 *           3. far: all older material split into `cycle` equal parts, one part a day.
 *   rating — «أتقنت» keeps the segment in its cycle, «تردّدت» brings it back in 3
 *            days, «نسيت» tomorrow.
 * Dates are local calendar days as 'YYYY-MM-DD' strings. */
(function (root) {
  'use strict';
  var SYFS = root.SYFS = root.SYFS || {};

  var DAILY = [3, 5, 7, 10, 15], CYCLES = [7, 14, 30], REPS = [3, 5, 7, 10], LOOPS = [1, 3, 5], GAPS = [1, 2, 0];
  var NEAR_DAYS = 7;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /* ---------- dates ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, k) { var d = parse(s); d.setDate(d.getDate() + k); return ymd(d); }
  /* b − a in whole days; through UTC so a DST change never makes a day 23 hours long */
  function diffDays(a, b) {
    var x = parse(a), y = parse(b);
    return Math.round((Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) - Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / 864e5);
  }
  function weekday(s) { return parse(s).getDay(); }      /* 0 = Sunday … 6 = Saturday */

  /* ---------- cleaning what comes back from storage ---------- */
  function pick(list, v, d) { return list.indexOf(v) >= 0 ? v : d; }
  var DEFAULT_DAYS = [true, true, true, true, true, false, true];   /* every day but Friday: review only */
  function cleanPlan(o) {
    o = (o && typeof o === 'object') ? o : {};
    var days = Array.isArray(o.days) && o.days.length === 7 ? o.days.map(function (x) { return x === true; }) : DEFAULT_DAYS.slice();
    if (days.indexOf(true) < 0) days = DEFAULT_DAYS.slice();
    var memo = {};
    if (o.memo && typeof o.memo === 'object') {
      Object.keys(o.memo).forEach(function (k) { var n = +k; if (Number.isInteger(n) && n >= 1 && n <= 114 && o.memo[k] === true) memo[n] = true; });
    }
    return {
      started: o.started === true,
      dir: o.dir === 'fatiha' ? 'fatiha' : 'nas',
      daily: pick(DAILY, o.daily, 5),
      cycle: pick(CYCLES, o.cycle, 7),
      days: days,
      remind: (typeof o.remind === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.remind)) ? o.remind : '',
      reciter: o.reciter === 'husary' ? 'husary' : 'minshawi',
      reps: pick(REPS, o.reps, 5),
      loops: pick(LOOPS, o.loops, 3),
      gap: pick(GAPS, o.gap, 1),
      memo: memo
    };
  }
  function cleanSeg(x, lens) {
    if (!x || typeof x !== 'object') return null;
    var s = x.s, a0 = x.a0, a1 = x.a1;
    if (!Number.isInteger(s) || s < 1 || s > 114 || !Number.isInteger(a0) || !Number.isInteger(a1)) return null;
    if (a0 < 0 || a1 < a0 || a1 >= lens[s - 1]) return null;
    var d = function (v) { return typeof v === 'string' && DATE_RE.test(v) ? v : ''; };
    var learned = d(x.learned);
    if (!learned) return null;
    return { s: s, a0: a0, a1: a1, learned: learned, last: d(x.last), ease: pick(['ok', 'mid', 'bad'], x.ease, ''), due: d(x.due), old: x.old === true };
  }
  function cleanLog(o, lens) {
    o = (o && typeof o === 'object') ? o : {};
    var segs = Array.isArray(o.segs) ? o.segs.map(function (x) { return cleanSeg(x, lens); }).filter(Boolean).slice(0, 5000) : [];
    var st = o.streak && typeof o.streak === 'object' ? o.streak : {};
    var dn = o.done && typeof o.done === 'object' ? o.done : {};
    return {
      segs: segs,
      streak: { last: typeof st.last === 'string' && DATE_RE.test(st.last) ? st.last : '', n: Number.isInteger(st.n) && st.n > 0 ? st.n : 0 },
      done: { date: typeof dn.date === 'string' && DATE_RE.test(dn.date) ? dn.date : '', fresh: dn.fresh === true, near: dn.near === true, far: dn.far === true }
    };
  }

  /* ---------- coverage ---------- */
  function lensOf(D) { return D.s.map(function (x) { return x.a.length; }); }
  /* per surah, one flag per ayah: memorised before the plan, or in a segment */
  function coverage(plan, log, lens) {
    var cov = lens.map(function (n) { return new Uint8Array(n); });
    Object.keys(plan.memo).forEach(function (k) { cov[k - 1].fill(1); });
    log.segs.forEach(function (g) { for (var i = g.a0; i <= g.a1; i++) cov[g.s - 1][i] = 1; });
    return cov;
  }
  function order(dir) {
    var o = [];
    if (dir === 'fatiha') for (var i = 1; i <= 114; i++) o.push(i);
    else for (var j = 114; j >= 1; j--) o.push(j);
    return o;
  }
  /* the next `daily` uncovered ayahs, never across a surah boundary */
  function nextSeg(plan, log, lens) {
    var cov = coverage(plan, log, lens), ord = order(plan.dir);
    for (var k = 0; k < ord.length; k++) {
      var s = ord[k], c = cov[s - 1];
      for (var i = 0; i < c.length; i++) {
        if (c[i]) continue;
        var a1 = i;
        while (a1 + 1 < c.length && !c[a1 + 1] && a1 + 1 - i < plan.daily) a1++;
        return { s: s, a0: i, a1: a1 };
      }
    }
    return null;                                  /* the whole mushaf — مبارك */
  }

  /* ---------- today ---------- */
  function sameSeg(a, b) { return a.s === b.s && a.a0 === b.a0 && a.a1 === b.a1; }
  function dayIndex(today) { return diffDays('2026-01-01', today); }
  /* older material as ranges, mushaf order: whole memorised surahs and segments past the
     near window — minus what a rating has made due (that one is in «near») */
  function oldMaterial(plan, log, lens, today) {
    var cov = lens.map(function (n) { return new Uint8Array(n); });
    Object.keys(plan.memo).forEach(function (k) { cov[k - 1].fill(1); });
    log.segs.forEach(function (g) {
      if (g.old || diffDays(g.learned, today) > NEAR_DAYS) for (var i = g.a0; i <= g.a1; i++) cov[g.s - 1][i] = 1;
    });
    log.segs.forEach(function (g) { if (g.due && g.due <= today) for (var i = g.a0; i <= g.a1; i++) cov[g.s - 1][i] = 0; });
    var flat = [];
    for (var s = 1; s <= 114; s++) for (var i = 0; i < lens[s - 1]; i++) if (cov[s - 1][i]) flat.push([s, i]);
    return flat;
  }
  function toRanges(flat) {
    var out = [];
    flat.forEach(function (p) {
      var r = out[out.length - 1];
      if (r && r.s === p[0] && r.a1 === p[1] - 1) r.a1 = p[1];
      else out.push({ s: p[0], a0: p[1], a1: p[1] });
    });
    return out;
  }
  /* part `dayIndex mod cycle` of the old material, cut by ayah count */
  function farToday(plan, log, lens, today) {
    var flat = oldMaterial(plan, log, lens, today);
    if (!flat.length) return [];
    var parts = Math.min(plan.cycle, flat.length);
    var k = ((dayIndex(today) % parts) + parts) % parts;
    var from = Math.floor(flat.length * k / parts), to = Math.floor(flat.length * (k + 1) / parts);
    return toRanges(flat.slice(from, to));
  }
  function nearToday(log, today) {
    return log.segs.map(function (g, i) { return { g: g, i: i }; }).filter(function (x) {
      var g = x.g;
      if (g.learned === today && !g.old) return false;                   /* learned today: it IS today's new */
      return (!g.old && diffDays(g.learned, today) >= 1 && diffDays(g.learned, today) <= NEAR_DAYS) || (g.due && g.due <= today);
    });
  }
  function todayPlan(plan, log, lens, today) {
    var fresh = null, freshDone = false;
    var learnedToday = log.segs.filter(function (g) { return g.learned === today && !g.old; });
    if (learnedToday.length) { fresh = learnedToday[learnedToday.length - 1]; freshDone = true; }
    else if (plan.days[weekday(today)]) fresh = nextSeg(plan, log, lens);
    var done = log.done.date === today ? log.done : { fresh: false, near: false, far: false };
    return { fresh: fresh, freshDone: freshDone, memoDay: plan.days[weekday(today)], near: nearToday(log, today), far: farToday(plan, log, lens, today),
      nearDone: done.near, farDone: done.far };
  }

  /* ---------- changes (each returns the same log, mutated) ---------- */
  function touch(log, today, part) {
    if (log.done.date !== today) log.done = { date: today, fresh: false, near: false, far: false };
    if (part) log.done[part] = true;
    if (log.streak.last !== today) {
      log.streak.n = log.streak.last === addDays(today, -1) ? log.streak.n + 1 : 1;
      log.streak.last = today;
    }
    return log;
  }
  function learn(log, seg, today) {
    if (!log.segs.some(function (g) { return sameSeg(g, seg) && g.learned === today; })) {
      log.segs.push({ s: seg.s, a0: seg.a0, a1: seg.a1, learned: today, last: today, ease: '', due: '', old: false });
    }
    return touch(log, today, 'fresh');
  }
  var WORST = { ok: 0, mid: 1, bad: 2 };
  function worst(list) { return list.reduce(function (w, e) { return WORST[e] > WORST[w] ? e : w; }, 'ok'); }
  /* a rating lands on the exact segment if there is one; otherwise (a far-review range of
     surahs memorised before the plan) a segment is created for it, marked `old` */
  function rate(log, range, ease, today, part) {
    ease = pick(['ok', 'mid', 'bad'], ease, 'ok');
    var due = ease === 'bad' ? addDays(today, 1) : ease === 'mid' ? addDays(today, 3) : '';
    var hit = log.segs.filter(function (g) { return sameSeg(g, range); });
    if (!hit.length && ease !== 'ok') {
      var g = { s: range.s, a0: range.a0, a1: range.a1, learned: '2000-01-01', last: today, ease: ease, due: due, old: true };
      log.segs.push(g); hit = [g];
    }
    hit.forEach(function (g) { g.last = today; g.ease = ease; g.due = due; });
    return touch(log, today, part);
  }

  /* ---------- the map and the numbers ---------- */
  function mapStatus(plan, log, lens, today) {
    var cov = coverage(plan, log, lens);
    var weak = {};
    log.segs.forEach(function (g) { if (g.ease === 'bad' || (g.due && g.due <= today && g.ease !== 'ok')) weak[g.s] = true; });
    return lens.map(function (n, i) {
      var c = cov[i], k = 0;
      for (var j = 0; j < n; j++) k += c[j];
      var st = k === n ? 'm' : k ? 'p' : '';
      if (st && weak[i + 1]) st = 'w';
      return { st: st, k: k, n: n };
    });
  }
  function stats(plan, log, lens) {
    var cov = coverage(plan, log, lens), ay = 0, su = 0;
    cov.forEach(function (c) { var k = 0; for (var j = 0; j < c.length; j++) k += c[j]; ay += k; if (k === c.length) su++; });
    return { ayahs: ay, surahs: su, total: lens.reduce(function (a, b) { return a + b; }, 0) };
  }
  /* days left at this pace: uncovered ayahs ÷ daily, stretched by the weekdays off */
  function daysLeft(plan, log, lens) {
    var st = stats(plan, log, lens), left = st.total - st.ayahs;
    var perWeek = plan.days.filter(Boolean).length || 1;
    return Math.ceil(Math.ceil(left / plan.daily) * 7 / perWeek);
  }

  /* ---------- progressive hiding ---------- */
  function isLetter(c) { return (c >= 0x621 && c <= 0x64A) || (c >= 0x671 && c <= 0x6D3); }
  function isMark(c) { return (c >= 0x64B && c <= 0x65F) || c === 0x670 || (c >= 0x6D6 && c <= 0x6ED); }
  function hasLetter(w) { for (var i = 0; i < w.length; i++) if (isLetter(w.charCodeAt(i))) return true; return false; }
  /* words of an ayah — a pause sign (a token with no letter) stays with the word before it */
  function words(t) {
    var out = [];
    t.split(/\s+/).forEach(function (w) { if (!w) return; if (!hasLetter(w) && out.length) out[out.length - 1] += ' ' + w; else out.push(w); });
    return out;
  }
  /* the first letter with its marks, and how many letters are left after it */
  function firstCluster(w) {
    var i = 1;
    while (i < w.length && isMark(w.charCodeAt(i))) i++;
    var rest = 0;
    for (var j = i; j < w.length; j++) if (isLetter(w.charCodeAt(j))) rest++;
    return { head: w.slice(0, i), rest: rest };
  }

  SYFS.hifzCore = {
    DAILY: DAILY, CYCLES: CYCLES, REPS: REPS, LOOPS: LOOPS, GAPS: GAPS, NEAR_DAYS: NEAR_DAYS,
    ymd: ymd, addDays: addDays, diffDays: diffDays, weekday: weekday,
    cleanPlan: cleanPlan, cleanLog: cleanLog, lensOf: lensOf, coverage: coverage, order: order, nextSeg: nextSeg,
    todayPlan: todayPlan, farToday: farToday, toRanges: toRanges, learn: learn, rate: rate, worst: worst, touch: touch,
    mapStatus: mapStatus, stats: stats, daysLeft: daysLeft, words: words, firstCluster: firstCluster
  };
}(typeof window !== 'undefined' ? window : globalThis));
