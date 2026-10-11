/* SYF — Regex lab worker (src/dev2.js, «مختبر Regex»).
 * Runs ONE RegExp job off the main thread so a catastrophic pattern can be killed by
 * terminate() instead of freezing the tab. No eval: the RegExp constructor is not a
 * code evaluator. Served two ways (see rxWorker in src/dev2.js): as a file on extension
 * pages, and as a blob built from this same text on host pages — so this file must
 * stay self-contained (no importScripts, no chrome.*).
 * Contract: in {pattern, flags, text, replace|null, max} → out {ok, matches:[{i,s,g,n}], replaced} | {ok:false, error}.
 * ⛔ There is no main-thread fallback (removed v0.139.2): no Worker ⇒ the lab refuses. */
'use strict';
self.onmessage = function (ev) {
  var job = ev.data || {};
  try {
    var re = new RegExp(String(job.pattern), String(job.flags || ''));
    var text = String(job.text || ''), max = job.max > 0 ? job.max : 500, out = [], m;
    if (re.global) {
      while ((m = re.exec(text)) && out.length < max) {
        out.push({ i: m.index, s: m[0], g: m.slice(1), n: m.groups || null });
        if (!m[0]) re.lastIndex++;
      }
    } else {
      m = re.exec(text);
      if (m) out.push({ i: m.index, s: m[0], g: m.slice(1), n: m.groups || null });
    }
    var rep = (job.replace === null || job.replace === undefined) ? null : text.replace(re, String(job.replace));
    self.postMessage({ ok: true, matches: out, replaced: rep });
  } catch (e) {
    self.postMessage({ ok: false, error: String(e && e.message || e) });
  }
};
