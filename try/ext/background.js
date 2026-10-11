/* SYF — MV3 service worker.
 * - Toolbar icon click → toggle the rail on the active tab.
 * - SYFS_FETCH relay: content scripts can't do cross-origin fetch in MV3, so the
 *   service worker (which holds host_permissions) fetches and returns the body. */

/* ===== one queue per key (v0.140.0) =====
 * Every read-modify-write of a stored value that two entry points can reach at once
 * (an alarm and a click, two tabs, a message and onInstalled) runs through here, so
 * the second one reads what the first one wrote. `fn` runs after the previous job on
 * the same key settles, whether it resolved or threw; a failure is returned to its
 * own caller only and never blocks the queue.
 * ⛔ Never call serialize(k) from inside a job already queued on k — it waits on itself. */
const SERIAL_TAILS = new Map();
function serialize(key, fn) {
  const prev = SERIAL_TAILS.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  SERIAL_TAILS.set(key, tail);
  tail.then(() => { if (SERIAL_TAILS.get(key) === tail) SERIAL_TAILS.delete(key); });
  return run;
}

/* ===== who may send what (v0.140.0) =====
 * Content scripts run inside web pages, and a hostile page that compromises one (or a
 * bug in one) can post any message it likes. Extension pages (side.html, app.html,
 * offscreen.html, …) are ours. Every SYFS_* type the worker handles is listed in
 * MSG_POLICY — 'any' (content scripts and pages), 'page' (extension pages only), or
 * an object giving the class per `op` — and enforced ONCE, in onMsg() below, which
 * every handler registers through, so a new handler cannot forget it. tools/worker-sender-test.js fails when a
 * handled type is missing from the table.
 * Classes: 'page' — sender.url on this extension's origin (a tab or not: app.html in
 * its own window has a tab); 'content' — any other url or a tab; 'worker' — neither
 * (not a real sender; internal/test calls), treated like a page. */
const MSG_POLICY = {
  SYFS_FETCH: 'any', SYFS_AI: 'any', SYFS_LOAD_DOCVIEW: 'any', SYFS_LOAD_TOOLS: 'any',
  SYFS_NOTIFY: 'any', SYFS_CLIP: 'any', SYFS_ITHKAR: 'any', SYFS_AZKAR: 'any',
  SYFS_OCC: 'any', SYFS_CAL: 'any', SYFS_QURAN: 'any', SYFS_ACT: 'any',
  SYFS_OPEN_APP: 'any', SYFS_OPEN_VAULT: 'any', SYFS_OPEN_KIDS: 'any', SYFS_OPEN_HIFZ: 'any', SYFS_OPEN_AIKEYS: 'any', SYFS_OPEN_SHEET: 'any',
  SYFS_OPEN_PHONES: 'any', SYFS_OPEN_STATUS: 'any', SYFS_OPEN_OCR: 'any', SYFS_OPEN_VIDEO: 'any',
  SYFS_OPEN_WORD: 'any', SYFS_OPEN_SLIDES: 'any', SYFS_OPEN_MAIL: 'any', SYFS_EDIT_OPEN: 'any',
  SYFS_DOWNLOAD: 'any', SYFS_SC_RESOLVE: 'any', SYFS_POPUP: 'any', SYFS_SIDE: 'any',
  SYFS_ZOOM: 'any', SYFS_FRAME: 'any', SYFS_UA: 'any', SYFS_COOKIES: 'any',
  SYFS_LOAD_QR: 'any', SYFS_LOAD_XLSX: 'any', SYFS_SESSIONS: 'any', SYFS_CLEAN: 'any', SYFS_CAPTURE: 'any',
  SYFS_TABS: 'any', SYFS_DNR: 'any', SYFS_LOCK_GUARD: 'any', SYFS_MEET: 'any',
  /* the rail on a web page sends both: the tool id / sizes are re-validated in the handler */
  SYFS_OPEN_TOOLPAGE: 'any', SYFS_SPEED: 'any',
  /* the offscreen document's playback reports — a page faking them could close it */
  SYFS_CLIPSTATE: 'page', SYFS_QSTATE: 'page',
  /* screenshots the active tab of ANY window — app.html only, never a web page */
  SYFS_APP_CAPTURE: 'page',
  /* 'arm' strips XFO/CSP for a host: only side.html, after its lock gate. 'open' is a
     click in the page. */
  SYFS_PANEL: { arm: 'page', off: 'page', '*': 'any' }
};
function senderClass(sender) {
  if (!sender) return 'worker';
  if (sender.id && chrome.runtime.id && sender.id !== chrome.runtime.id) return 'foreign';
  const base = chrome.runtime.getURL('');
  if (typeof sender.url === 'string' && sender.url) return sender.url.indexOf(base) === 0 ? 'page' : 'content';
  if (typeof sender.origin === 'string' && sender.origin && base.indexOf(sender.origin + '/') === 0) return 'page';
  if (sender.tab || sender.origin) return 'content';
  return 'worker';
}
function senderAllowed(msg, sender) {
  if (!msg || typeof msg.type !== 'string') return true;          /* not ours — every handler ignores it */
  const cls = senderClass(sender);
  if (cls === 'foreign') return false;
  let rule = MSG_POLICY[msg.type];
  if (rule && typeof rule === 'object') rule = rule[String(msg.op)] || rule['*'];
  if (!rule || rule === 'any') return true;                          /* unlisted: the test is the gate */
  return cls === 'page' || cls === 'worker';
}
/* ⛔ the ONLY way a handler is registered: onMsg(fn), never
   chrome.runtime.onMessage.addListener directly (the test fails on a raw one). Not a
   monkeypatch of the event object — whether Chrome lets that be reassigned is not
   something to find out by the policy silently switching off. */
function onMsg(fn) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!senderAllowed(msg, sender)) {
      try { sendResponse({ ok: false, error: 'forbidden-sender' }); } catch (e) { /* already answered */ }
      return false;
    }
    return fn(msg, sender, sendResponse);
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try { await chrome.tabs.sendMessage(tab.id, { type: 'SYFS_TOGGLE' }); }
  catch (e) { /* no content script here (chrome://, web store, …) */ }
});

const ALLOWED = [
  'https://open.er-api.com/',
  'https://api.mymemory.translated.net/',
  'https://speed.cloudflare.com/',
  'https://appps.net/',                 // PROF (بروف) AI assistant — SAM AI backend
  'https://api.alquran.cloud/',         // الورد اليومي — Quran mushaf pages (cached locally after first load)
  // مشغّل القرآن — the reciter/surah CATALOGUE only (v0.82.0). This is the ninth
  // host, added by an explicit decision, not by drift: no other free service
  // publishes anything close to 241 reciters, and the alternative was to fetch it
  // from the offscreen page, which holds host_permissions and would have bypassed
  // this list entirely — routing around the rule rather than following it.
  // The AUDIO never comes through here: it is played by an <audio> element in the
  // offscreen document, straight from the server the catalogue names.
  'https://mp3quran.net/',
  // المساعد الذكي — bring-your-own-key direct providers (fixed, known hosts only).
  // The user pastes their OWN API key in the assistant's ⚙; no key is shipped.
  'https://api.anthropic.com/',         // Claude (Anthropic)
  'https://api.openai.com/',            // ChatGPT (OpenAI)
  'https://generativelanguage.googleapis.com/'  // Gemini (Google)
];
/* AUDIO hosts are NOT in this list and never were: a recitation is played by an
 * <audio> element, not relayed through here (see the مشغّل القرآن note above). The
 * recorded adhkar of v0.127.0 follow the same road — their hosts are declared in
 * CLIP_HOSTS, which is the one gate every clip URL passes. Keeping them out of
 * ALLOWED is deliberate: a page could otherwise relay-fetch audio through us for no
 * reason any tool has. */

/* v0.139.4: the relay takes the methods its callers use and nothing else, sends a
 * string body of bounded size, and never buffers more than FETCH_MAX_BYTES of reply —
 * a host on the list serving (or being made to serve) a huge body must not balloon the
 * worker. Callers today: GETs everywhere, one 1MB POST (speed test upload). */
const FETCH_METHODS = ['GET', 'HEAD', 'POST'];
const FETCH_MAX_BYTES = 16 * 1024 * 1024;
const FETCH_MAX_BODY = 2 * 1024 * 1024;

/* Reads a Response as text, refusing past `cap` bytes (declared or actually streamed). */
async function fetchTextCapped(r, cap) {
  const len = +(r.headers.get('content-length') || 0);
  if (len > cap) { try { r.body && r.body.cancel(); } catch (e) { /* already closed */ } throw new Error('too-large'); }
  if (!r.body || !r.body.getReader) {
    const t = await r.text();
    if (t.length > cap) throw new Error('too-large');
    return t;
  }
  const reader = r.body.getReader(), parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.byteLength;
    if (got > cap) { try { reader.cancel(); } catch (e) { /* ignore */ } throw new Error('too-large'); }
    parts.push(value);
  }
  const all = new Uint8Array(got);
  let off = 0;
  for (const p of parts) { all.set(p, off); off += p.byteLength; }
  return new TextDecoder().decode(all);
}

onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_FETCH') return;
  const url = String(msg.url || '');
  if (!ALLOWED.some((p) => url.startsWith(p))) { sendResponse({ ok: false, error: 'blocked' }); return; }

  const method = String(msg.method || 'GET').toUpperCase();
  if (FETCH_METHODS.indexOf(method) < 0) { sendResponse({ ok: false, error: 'bad-method' }); return; }
  const opts = { method };
  /* a user's explicit «refresh» must reach the server, not the HTTP cache — one value only */
  if (msg.cache === 'no-cache') opts.cache = 'no-cache';
  if (msg.headers && typeof msg.headers === 'object') {
    const hd = {};
    for (const k of Object.keys(msg.headers)) if (typeof msg.headers[k] === 'string') hd[k] = msg.headers[k];
    opts.headers = hd;
  }
  // Only methods with a body carry one (GET/HEAD must not).
  if (msg.body != null && method !== 'GET' && method !== 'HEAD') {
    if (typeof msg.body !== 'string' || msg.body.length > FETCH_MAX_BODY) { sendResponse({ ok: false, error: 'bad-body' }); return; }
    opts.body = msg.body;
  }

  fetch(url, opts)
    .then(async (r) => {
      const ct = r.headers.get('content-type') || '';
      const body = msg.as === 'bytes' ? r.headers.get('content-length') || '' : await fetchTextCapped(r, FETCH_MAX_BYTES);
      sendResponse({ ok: r.ok, status: r.status, body, ct });
    })
    .catch((e) => sendResponse({ ok: false, error: String(e && e.message === 'too-large' ? 'too-large' : e) }));
  return true; // async sendResponse
});

/* ===== المساعد الذكي: المفتاح لا يغادر العامل (v0.104.1) =====
 * §5.10 منعت وجود الاعتماد في الصفحة المضيفة؛ وهذا يُكمل الخطّ إلى آخره: المفتاح لم
 * يعد يُقرأ في سكربت المحتوى أصلاً. `SYFS.ai.callProvider` هناك صار غلافاً يرسل
 * الموجّه والتاريخ، والعامل هو من يقرأ المفتاح ويبني الرأس ويجلب.
 * القراءةُ في العالم المعزول آمنةٌ اليوم (§5.10/4) — لكنّ باگاً واحداً يكتب `cfg` في
 * DOM يُعيد النتيجة الحرِجة رقم ١، **ولا يستطيع أن يكتب ما لا يملك**. دفاعٌ في العمق،
 * لا سدّ ثغرة قائمة.
 * ⛔ لا URL يأتي من المُرسِل — يُبنى هنا من ثوابت ثمّ يُفحص على `ALLOWED` نفسها، فتبقى
 *    قائمة المضيفين مصدراً واحداً ولا يفتح هذا الباب مضيفاً جديداً.
 * ⛔ الردّ جسدُ المزوّد وحده — لا مفتاح ولا رأس يعود إلى الصفحة.
 * ⚠️ مفتاح Gemini في رأس `x-goog-api-key` لا في الاستعلام: العنوان يظهر في رسائل
 *    الخطأ وسجلّات الشبكة، والرأس لا يظهر. */
const AI_PROVIDERS = ['prof', 'claude', 'openai', 'gemini'];
const AI_MODEL_RE = /^[A-Za-z0-9][\w.:-]{0,79}$/;
const AI_MAX_TURNS = 60;
const AI_MAX_CHARS = 24000;

/* رفضٌ لا تصحيح (§4.1): تاريخٌ مشوّه يعني خللاً عندنا، لا مُدخلاً يُنظَّف ويُمرَّر. */
function aiHistory(v) {
  if (!Array.isArray(v) || !v.length || v.length > AI_MAX_TURNS) return null;
  const out = [];
  let total = 0;
  for (const m of v) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return null;
    if (typeof m.content !== 'string' || !m.content || m.content.length > AI_MAX_CHARS) return null;
    total += m.content.length;
    if (total > AI_MAX_CHARS * 2) return null;
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

/* نفس قاعدة PROF المكتوبة في `src/ai-keys.js`: https + المضيف `appps.net` **بالضبط**،
   بلا استعلام ولا جزء. تُفحص عند الكتابة هناك **وعند الاستعمال هنا** — الكتابة وحدها لا
   تحرس ما وضعه استيرادٌ أو نسخةٌ أقدم (§5.11/2، §5.11/4). القيمة تبني عنواناً يُرسَل إليه مفتاح.
   ⚠️ المضيف بالضبط لا «تحته»: `ALLOWED` تحمل `https://appps.net/` وحدها، فنطاقٌ فرعيّ كان
   يعبر فحص اللوحة ثمّ يُحجب عند الجلب — لوحةٌ تَعِد بما يرفضه المُرحِّل. المصدر واحد. */
function aiProfUrl(base, token) {
  let u;
  try { u = new URL(String(base || '')); } catch (e) { return ''; }
  if (u.protocol !== 'https:' || u.hostname !== 'appps.net') return '';
  if (u.search || u.hash) return '';
  return u.origin + u.pathname.replace(/\/+$/, '') + '/chat/' + encodeURIComponent(token);
}

async function aiRequest(msg) {
  const p = msg.provider;
  if (AI_PROVIDERS.indexOf(p) < 0) return { ok: false, error: 'bad-provider' };
  const history = aiHistory(msg.history);
  if (!history) return { ok: false, error: 'bad-request' };
  if (typeof msg.sys !== 'string' || !msg.sys || msg.sys.length > AI_MAX_CHARS) return { ok: false, error: 'bad-request' };
  const sys = msg.sys;

  const st = await chrome.storage.local.get(['sam_api_base', 'sam_bot_token', 'sam_app_key', 'ai_' + p + '_key']);
  const str = (v) => (typeof v === 'string' ? v : '');
  let url, headers, body;
  if (p === 'prof') {
    const token = str(st.sam_bot_token), key = str(st.sam_app_key);
    const sid = /^[\w-]{1,64}$/.test(String(msg.sid || '')) ? String(msg.sid) : '';
    if (!token || !key) return { ok: false, error: 'no-key' };
    if (!sid) return { ok: false, error: 'bad-request' };
    url = aiProfUrl(st.sam_api_base, token);
    if (!url) return { ok: false, error: 'bad-base' };
    headers = { 'Content-Type': 'application/json', 'X-Sam-App-Key': key };
    body = JSON.stringify({ message: history[history.length - 1].content, session_id: sid });
  } else {
    const key = str(st['ai_' + p + '_key']);
    if (!key) return { ok: false, error: 'no-key' };
    const model = AI_MODEL_RE.test(String(msg.model || '')) ? String(msg.model) : '';
    if (!model) return { ok: false, error: 'bad-model' };
    if (p === 'claude') {
      url = 'https://api.anthropic.com/v1/messages';
      /* الرأس `anthropic-dangerous-direct-browser-access` يبقى: النداء ما زال من
         سياق متصفّح (عامل الإضافة)، وبدونه ترفض Anthropic الطلب. */
      headers = { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
      body = JSON.stringify({ model: model, max_tokens: 1024, system: sys, messages: history });
    } else if (p === 'openai') {
      url = 'https://api.openai.com/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };
      body = JSON.stringify({ model: model, messages: [{ role: 'system', content: sys }].concat(history) });
    } else {
      url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
      headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
      body = JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents: history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
      });
    }
  }
  if (!ALLOWED.some((a) => url.startsWith(a))) return { ok: false, error: 'blocked' };
  try {
    const r = await fetch(url, { method: 'POST', headers: headers, body: body });
    return { ok: r.ok, status: r.status, body: await r.text() };
  } catch (e) { return { ok: false, error: 'net' }; }
}

onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_AI') return;
  /* «هل هناك مفتاح؟» جوابٌ منطقيّ — اللوحة تحتاج أن تعرف، ولا تحتاج أن تحمل القيمة. */
  if (msg.op === 'ready') {
    const p = AI_PROVIDERS.indexOf(msg.provider) >= 0 ? msg.provider : '';
    if (!p) { sendResponse({ ok: true, ready: false }); return true; }
    const need = p === 'prof' ? ['sam_api_base', 'sam_bot_token', 'sam_app_key'] : ['ai_' + p + '_key'];
    chrome.storage.local.get(need).then((st) => {
      sendResponse({ ok: true, ready: need.every((k) => typeof st[k] === 'string' && st[k] !== '') });
    });
    return true;
  }
  if (msg.op === 'call') { aiRequest(msg).then(sendResponse); return true; }
  sendResponse({ ok: false, error: 'bad-op' });
  return true;
});

/* ===== تحميل الأدوات عند الطلب — lazy tool injection =====
 * The rail bootstrap (storage/registry/tools/rail) is injected on every page via
 * the manifest, but the heavy tool BODIES are NOT — they are injected here the
 * first time the user actually opens the rail's tools (src/rail.js → ensureTools
 * → SYFS_LOAD_TOOLS). This keeps pages where the rail is never used nearly free.
 *
 * Security: the file list is a fixed in-extension whitelist (no page input), each
 * file is injected into the SENDER's own tab only (never a tab id from the page),
 * into the default ISOLATED world (no MAIN world, no remote code). Order mirrors
 * the old manifest load order (imgkit before media, etc.).
 *
 * v0.139.5 — ONE executeScript for the whole list (it runs `files` in order), not
 * one round-trip per file. The public build physically omits the private-only file
 * (src/downloader.js), which fails a batch as a whole: on a failed batch the loader
 * falls back to one file at a time, and a file that fails while its neighbours load
 * is remembered as absent (`LAZY_MISSING`), so the next page goes back to one call.
 * If EVERY file fails it is the page (chrome://, the store…), not the package, and
 * nothing is remembered.
 *
 * The four `*-body.js` files (v0.139.5) are the tool bodies split out of the eager
 * bootstrap (tools2 / islam2 / occasions / quran): their eager halves stay in the
 * manifest for what must run at page load, and set `SYFS._t2/_islam/_occ/_quran`
 * for the body to read. They go FIRST so the tools land in SYFS.tools in the same
 * relative order as before the split. */
const LAZY_TOOL_FILES = [
  'src/tools2-body.js', 'src/islam2-body.js', 'src/occasions-body.js', 'src/quran-body.js',
  'src/imgkit.js', 'lib/canvas-pdf.js', 'src/calc.js', 'src/money.js', 'src/ai-chat.js', 'src/shield.js',
  'src/ytplus.js',
  'src/bgrm.js', 'src/media.js', 'src/extras.js', 'src/techdetect.js',
  'src/perfaudit.js', 'src/dev.js', 'src/dev2.js', 'src/docview.js', 'src/vault-launch.js', 'src/sheet-launch.js', 'src/word-launch.js',
  'src/slides-launch.js', 'src/mail-launch.js', 'src/phones-launch.js', 'src/status-launch.js', 'src/frames-launch.js',
  'src/ocr-launch.js', 'src/calendar.js', 'src/tools3.js', 'src/studio.js'
];
const LAZY_MISSING = new Set();            /* files this package does not ship (per worker life) */
async function lazyInject(tabId) {
  const list = LAZY_TOOL_FILES.filter((f) => !LAZY_MISSING.has(f));
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: list });
    return { injected: list.length, failed: [], batch: true };
  } catch (e) { /* one file is missing, or the page refuses scripts — find out which */ }
  let injected = 0;
  const failed = [];
  for (const file of list) {
    try {
      await chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: [file] });
      injected++;
    } catch (e) {
      failed.push(file);
    }
  }
  if (injected) failed.forEach((f) => LAZY_MISSING.add(f));
  return { injected, failed, batch: false };
}

/* ===== عارض MD ومنسّق JSON — حقن عند الطلب =====
 * src/docdetect.js (in the manifest bootstrap) fires this the moment a tab turns
 * out to be a RAW .md or .json document, so the viewer formats it without the
 * user touching the rail. Same rules as LAZY_TOOL_FILES: one fixed file from
 * inside the package, into the SENDER's own tab, isolated world. The message
 * carries no data from the page — there is nothing here for a page to steer. */
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_LOAD_DOCVIEW') return;
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null || tabId < 0) { sendResponse({ ok: false }); return; }
  chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ['src/docview.js'] })
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));
  return true; // async sendResponse
});
/* ⚠️ الحقن الثاني يضاعف كل أداة. ملفّات LAZY_TOOL_FILES تدفع في `SYFS.tools` بلا
 * حارس، فحقنٌ ثانٍ في نفس الصفحة يُنتج ١٠٩ مدخلاً لـ٧٧ معرّفاً — والشريط يرسم كل
 * أداة مرّتين. الذاكرة هنا في العامل لا في الصفحة (سكربت المحتوى يموت مع أي تنقّل
 * ولا يستطيع أن يحرس نفسه عبر إعادة الحقن)، والمعرّف يسقط عند إغلاق التبويب وعند
 * بدء تنقّل جديد: صفحة جديدة شجرةٌ جديدة، فتلزمها حقنة جديدة. */
/* ⚠️ الخريطة تُخزّن **معرّف المستند** لا مجرّد التبويب (مراجعة 2026-09-19). `tabs.onUpdated` يحمل
   `url` عند تغيّر العنوان فقط — **إعادة التحميل (F5) والتنقّل إلى نفس العنوان لا يحملانه**،
   فكان العامل يردّ `already:true` على مستندٍ جديدٍ لم يُحقَن، والشريط يعلّم `toolsLoaded`
   ويرسم تصنيفات «المستندات» و«الصور» فارغةً ثم يُسقطها من الشريط أصلاً. مقيس على نسخة
   مثبَّتة: تحديث الصفحة خلال عمر العامل ⇒ docs/dev تختفي والصور تعرض أداة واحدة.
   المستند يولّد معرّفاً عشوائياً عند تحميل `src/rail.js` ويرسله؛ معرّفٌ مختلف = شجرة جديدة. */
const TOOLS_INJECTED = new Map();          /* tabId → docId */
const DOC_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
chrome.tabs.onRemoved.addListener((tabId) => { TOOLS_INJECTED.delete(tabId); });
/* نفس سبب `frameDrop` أدناه: `status === 'loading'` تُطلَق مع تحميل أي إطار داخلي في
   الصفحة، فكانت تمسح علامة صفحةٍ حيّة سكربتُها قائم. تغيّر الـURL وحده يعني شجرةً جديدة. */
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info && info.url) TOOLS_INJECTED.delete(tabId); });
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_LOAD_TOOLS') return;
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null || tabId < 0) { sendResponse({ ok: false, error: 'no-tab' }); return; }
  /* معرّف بلا شكل صالح يُعامَل كمستند مجهول: يُحقَن ولا يُذكَر — الحقن الزائد أهون من شريط فارغ */
  const docId = DOC_ID_RE.test(String(msg.doc || '')) ? String(msg.doc) : '';
  if (docId && TOOLS_INJECTED.get(tabId) === docId) { sendResponse({ ok: true, injected: 0, failed: [], already: true }); return; }
  (async () => {
    /* تُعلَّم قبل الحقن لا بعده: نداءان متزامنان من نفس الصفحة كافيان للمضاعفة */
    if (docId) TOOLS_INJECTED.set(tabId, docId); else TOOLS_INJECTED.delete(tabId);
    sendResponse(Object.assign({ ok: true }, await lazyInject(tabId)));
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

/* ===== الحزمة الإسلامية — جدولة الأذكار وتنبيه الصلاة (alarms + notifications) =====
 * Settings live in the `ithkar` storage key (written by src/islam2.js and, since
 * v0.122.0, by the prayer-times tool in src/tools2.js), all OFF by default. Prayer
 * calc is a worker copy of the Umm al-Qura math in src/tools2.js and reads the same
 * `prayer_city` key. Everything offline.
 *
 * v0.122.0 — أهداف الأذكار: morning/evening adhkar are no longer one «don't forget»
 * notification but a SEQUENCE the worker walks: the current dhikr is pushed (rail
 * toast, else a notification with a button), the next one appears only after the
 * user ticks «✓ قرأته», and the current one is re-pushed every `goalEvery` minutes
 * until the window closes (fajr→dhuhr, asr→isha) or the list is done. State lives
 * in `azkar_goal` and the worker is its ONLY writer (the panel sends ops) — two
 * writers racing on «which dhikr am I on» would show the same dhikr twice.
 * The lists come from src/azkar-data.js (built-in + the user's `azkar_custom`).
 *
 * v0.123.0 — the sequence is the ALERT, not a checklist: the athkar tool went back to
 * the plain counting list it had before v0.122.0, and closing the goal notification
 * (✕, «لاحقاً», or the notification centre retiring it) re-arms the SAME dhikr a few
 * minutes later. Only «✓ قرأته» advances, so nothing is skipped by looking away. */
importScripts('src/azkar-data.js');

/* [lat, lng, IANA zone] — ⚠️ a ZONE, not a fixed offset (v0.139.1). Cairo was `2` and
   Egypt has observed DST again since 2023, so every Cairo time and pre-adhan alert was
   an hour early from late April to late October. The offset is derived per DATE by
   `ikTzOff`. Same table as `cities` in src/tools2.js — keep both in step. */
const IK_CITIES = {
  'الأحساء': [25.383, 49.586, 'Asia/Riyadh'], 'الرياض': [24.713, 46.675, 'Asia/Riyadh'], 'مكة': [21.389, 39.857, 'Asia/Riyadh'],
  'المدينة': [24.524, 39.597, 'Asia/Riyadh'], 'جدة': [21.543, 39.173, 'Asia/Riyadh'], 'الدمام': [26.420, 50.088, 'Asia/Riyadh'],
  'القاهرة': [30.044, 31.236, 'Africa/Cairo'], 'الخرطوم': [15.500, 32.559, 'Africa/Khartoum']
};
/* the calculation method per city — a SEPARATE table so IK_CITIES stays byte-equal to
   the panel's `cities` (a test compares them). Egypt and Sudan follow the Egyptian
   General Authority of Survey (fajr 19.5° · isha 17.5°), not Umm al-Qura: a Cairo user
   heard the adhan minutes off the mosque next door. Missing ⇒ Umm al-Qura. */
const IK_METHOD = { 'القاهرة': 'egypt', 'الخرطوم': 'egypt' };
/* `prayer_city` is a stored string an import can set to anything — «constructor» used to
   return Object() here, every time came out NaN, and no adhan was ever scheduled */
function ikCity(city) {
  const k = Object.prototype.hasOwnProperty.call(IK_CITIES, city) ? city : 'الأحساء';
  return IK_CITIES[k].concat([IK_METHOD[k] || 'umq']);
}
/* UTC offset in hours of `zone` on `date`'s calendar day (noon, clear of any DST switch
   at 00:00–03:00). A number passes through. Unknown zone / no Intl support ⇒ null. */
function ikTzOff(zone, date) {
  if (typeof zone === 'number') return zone;
  try {
    const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    const p = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(noon);
    const m = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec((p.find((x) => x.type === 'timeZoneName') || {}).value || '');
    if (!m) return null;
    return m[1] ? (m[1] === '-' ? -1 : 1) * (+m[2] + (+m[3] || 0) / 60) : 0;
  } catch (e) { return null; }
}
const IK_PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
/* Every switch of «إعدادات التنبيهات» ships ON (the user's call), except
   `goalTts`: a recitation that starts by itself is the one alert that cannot be quiet.
   Defaults fill MISSING keys only (ikNorm merges over them) — a value the user saved,
   on or off, is never touched. */
const IK_DEFAULTS = {
  azkarOn: true, azkarSec: 1800, azkarToast: true, azkarNotif: true,
  prayerOn: true, prayerBefore: 10, prayerWhich: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true },
  /* v0.152.0 — sound: a chime with the pre-adhan alert, the adhan itself at the prayer
     time. Both ride on prayerOn (the master switch) and each can be turned off alone. */
  prayerBeep: true, adhanSound: true,
  /* v0.167.0 — صلاة الضحى (سنة مؤكدة): its own switch, independent of prayerOn — it
     is not one of the five and has no adhan. Fires `duhaAfter` minutes after sunrise. */
  duhaOn: true, duhaAfter: 20,
  /* v0.168.0 — قيام الليل: its own switch too. qiyamAt picks the hour: the last third
     of the night (default), its middle, or an hour after العشاء. */
  qiyamOn: true, qiyamAt: 'third',
  /* v0.175.0 — تنبيه الوضوء: its own switch, one lead time PER PRAYER (fajr often wants
     longer), the same prayers as the adhan rows, and its own mute on the existing chime. */
  wuduOn: true, wuduBefore: { fajr: 20, dhuhr: 20, asr: 20, maghrib: 20, isha: 20 }, wuduBeep: true,
  sabahOn: true, sabahMode: 'fajr', sabahAt: '07:00',
  masaaOn: true, masaaMode: 'asr', masaaAt: '17:00',
  goalEvery: 5, goalTts: false
};
/* the settings object, whitelisted ON READ (§5.11): «استيراد» writes any JSON, and
   every field below ends in an alarm time, a prayer key or a notification */
function ikNorm(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  const s = Object.assign({}, IK_DEFAULTS, r);
  const int = (v, lo, hi, d) => { v = parseInt(v, 10); return (v >= lo && v <= hi) ? v : d; };
  /* v0.176.0 — the periodic dhikr's interval is SECONDS (30s … 4h). 30s is the floor
     chrome.alarms keeps; an older build stored whole minutes in azkarEvery, which
     still counts when azkarSec is missing */
  s.azkarSec = int(r.azkarSec, 30, 14400, 0) || int(r.azkarEvery, 1, 240, 30) * 60;
  delete s.azkarEvery;
  s.prayerBefore = int(s.prayerBefore, 1, 120, 10);
  s.duhaAfter = int(s.duhaAfter, 15, 180, 20);
  if (['third', 'half', 'isha'].indexOf(s.qiyamAt) < 0) s.qiyamAt = 'third';
  const w = (r.prayerWhich && typeof r.prayerWhich === 'object') ? r.prayerWhich : {};
  s.prayerWhich = {};
  for (const k of IK_PRAYERS) s.prayerWhich[k] = (w[k] === undefined) ? true : !!w[k];
  /* a bare number (an older or hand-written import) is spread to all five */
  const wb = r.wuduBefore;
  s.wuduBefore = {};
  for (const k of IK_PRAYERS) s.wuduBefore[k] = int((wb && typeof wb === 'object') ? wb[k] : wb, 1, 120, 20);
  s.sabahMode = s.sabahMode === 'clock' ? 'clock' : 'fajr';
  s.masaaMode = s.masaaMode === 'clock' ? 'clock' : 'asr';
  s.sabahAt = /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.sabahAt) ? s.sabahAt : '07:00';
  s.masaaAt = /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.masaaAt) ? s.masaaAt : '17:00';
  s.goalEvery = [0, 1, 3, 5, 10, 15, 30, 60].indexOf(+s.goalEvery) >= 0 ? +s.goalEvery : 5;
  for (const k of ['azkarOn', 'azkarToast', 'azkarNotif', 'prayerOn', 'prayerBeep', 'adhanSound', 'duhaOn', 'qiyamOn', 'wuduOn', 'wuduBeep', 'sabahOn', 'masaaOn', 'goalTts']) s[k] = !!s[k];
  return s;
}

/* degree-trig prayer calc — Umm al-Qura (copy of src/tools2.js prayerTimes) */
const ikD = Math.PI / 180;
const ikSin = (x) => Math.sin(x * ikD), ikCos = (x) => Math.cos(x * ikD), ikTan = (x) => Math.tan(x * ikD);
const ikAsin = (x) => Math.asin(x) / ikD, ikAcos = (x) => Math.acos(x) / ikD;
const ikAtan2 = (y, x) => Math.atan2(y, x) / ikD, ikAcot = (x) => Math.atan(1 / x) / ikD;
const ikFixH = (a) => { a = a - 24 * Math.floor(a / 24); return a < 0 ? a + 24 : a; };
const ikFixDeg = (a) => { a = a - 360 * Math.floor(a / 360); return a < 0 ? a + 360 : a; };
function ikJulian(y, m, d) { if (m <= 2) { y -= 1; m += 12; } const a = Math.floor(y / 100), b = 2 - a + Math.floor(a / 4); return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5; }
function ikSun(jd) { const dd = jd - 2451545, g = ikFixDeg(357.529 + 0.98560028 * dd), q = ikFixDeg(280.459 + 0.98564736 * dd), L = ikFixDeg(q + 1.915 * ikSin(g) + 0.020 * ikSin(2 * g)), e = 23.439 - 0.00000036 * dd, decl = ikAsin(ikSin(e) * ikSin(L)), RA = ikFixDeg(ikAtan2(ikCos(e) * ikSin(L), ikCos(L))) / 15; return { decl, EqT: q / 15 - RA }; }
/* `zone` = IANA name (or a numeric offset). ⚠️ The hours returned are on the DEVICE's
   clock, not the city's: every caller turns them into an instant with `ikWhen`, which
   counts from the device's local midnight. Computing in the city's zone and handing
   those hours to `ikWhen` fired alerts early/late by the zone difference whenever the
   device and the chosen city disagree. The panel (src/tools2.js) shows city time. */
/* the Umm al-Qura month of a civil day (9 = رمضان), or 0 when Intl has no such calendar */
let IK_HFMT = null;
function ikHijriMonth(date) {
  try {
    if (!IK_HFMT) IK_HFMT = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { month: 'numeric' });
    const p = IK_HFMT.formatToParts(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)).find((x) => x.type === 'month');
    return p ? parseInt(p.value, 10) || 0 : 0;
  } catch (e) { return 0; }
}
/* `method`: 'umq' (Umm al-Qura — fajr 18.5°, isha a fixed 90 min after maghrib and 120
   in رمضان, as the official calendar prints it) or 'egypt' (fajr 19.5°, isha 17.5°). */
function ikPrayerTimes(date, lat, lng, zone, method) {
  const localOff = -new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).getTimezoneOffset() / 60;
  let tz = ikTzOff(zone, date);
  if (tz === null) tz = localOff;
  const jd = ikJulian(date.getFullYear(), date.getMonth() + 1, date.getDate()) - lng / (15 * 24);
  const sp = ikSun(jd), decl = sp.decl, eqt = sp.EqT;
  const dhuhr = ikFixH(12 + tz - lng / 15 - eqt) + (localOff - tz);
  /* NaN, not a garbage angle, when the sun never reaches `alpha` that day */
  const ang = (alpha) => { const c = (-ikSin(alpha) - ikSin(decl) * ikSin(lat)) / (ikCos(decl) * ikCos(lat)); return (c >= -1 && c <= 1) ? ikAcos(c) / 15 : NaN; };
  const asrAng = () => { const alt = -ikAcot(1 + ikTan(Math.abs(lat - decl))); return ang(alt); };
  const sunrise = dhuhr - ang(0.833), maghrib = dhuhr + ang(0.833);   /* sunrise: v0.167.0 — for الضحى */
  /* high-latitude rule (angle-based, as PrayTimes.js): above ~48° in summer the sun
     never sinks to 18°, acos has no answer, and NaN > now is false forever — every
     alarm would go silent. Then the twilight is that angle's share of the night. */
  const night = 24 - (maghrib - sunrise);
  const twi = (a, sign) => { const h = ang(a); return isFinite(h) ? dhuhr + sign * h : (sign < 0 ? sunrise - night * a / 60 : maghrib + night * a / 60); };
  const egypt = method === 'egypt';
  const fajr = twi(egypt ? 19.5 : 18.5, -1), asr = dhuhr + asrAng();
  const isha = egypt ? twi(17.5, 1) : maghrib + (ikHijriMonth(date) === 9 ? 2 : 1.5);
  return { fajr, sunrise, dhuhr, asr, maghrib, isha };
}
/* hours on the device's WALL clock → an instant. ⚠️ Built by the Date constructor, not
   by adding ms to midnight: on a DST day (23 or 25 hours long) «midnight + 12.9h» lands
   an hour off the 12:53 the prayer maths meant — every alert of the day an hour late
   (Cairo, 24 Apr 2026). The constructor normalises overflowing ms on the local clock. */
function ikWhen(date, hFloat) { return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, Math.round(hFloat * 3600000)).getTime(); }
/* «today, then tomorrow» — ⚠️ built from the CALENDAR date, never by adding 86400000ms:
   on the 25-hour DST day the addition lands on the same date, today is scanned twice
   and tomorrow never (same rule as `occScan`). */
function ikDay(add) { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate() + (add || 0)); }
function ikDayKey(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function ikClockOn(day, hhmm, dflt) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  let hh = m ? +m[1] : dflt, mm = m ? +m[2] : 0;
  if (!(hh >= 0 && hh <= 23)) hh = dflt;                 // reject wrap-around like 25:00
  if (!(mm >= 0 && mm <= 59)) mm = 0;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm, 0, 0).getTime();
}
async function ikGetSettings() {
  const r = await chrome.storage.local.get({ ithkar: null, prayer_city: 'الأحساء' });
  return { s: ikNorm(r.ithkar), city: r.prayer_city };
}
async function ikLists() {
  const r = await chrome.storage.local.get({ azkar_custom: null });
  return SYFS_AZKAR.lists(r.azkar_custom);
}
/* ===== worker-side i18n (v0.93.0) ==========================================
 * A SECOND READER of i18n/<lang>.json, not a second dictionary. src/i18n.js is a
 * content script and this is another world — it cannot be imported, which is the
 * same reason the prayer maths and the occasions engine are duplicated here.
 *
 * The msgid model is identical (§6.97): the Arabic source string IS the key, so a
 * miss returns the key and a notification degrades to ARABIC rather than to a raw
 * identifier or to nothing. That matters more here than anywhere: a notification
 * is fired at someone who is not looking at the extension.
 *
 * ⚠️ 'ui_lang' is spelled out rather than imported — §6.96/8, and a test pins the
 * three copies together. The value is whitelisted on the way in for the same reason
 * src/i18n.js whitelists it: it builds a resource path.
 *
 * The worker is torn down constantly, so the table is re-read on the cold start
 * that follows. That is one read of a packaged file, never a network call, and it
 * happens on the alarm that was going to wake the worker anyway. */
let WT_DICT = null, WT_LOAD = null, WT_LANG = 'ar';
function wtLoad() {
  if (WT_LOAD) return WT_LOAD;
  WT_LOAD = (async () => {
    let l = 'ar';
    try {
      const r = await chrome.storage.local.get({ ui_lang: 'ar' });
      l = (r && r.ui_lang === 'en') ? 'en' : 'ar';      /* whitelist, not sanitise */
    } catch (e) {}
    WT_LANG = l;
    if (l === 'ar') { WT_DICT = {}; return; }
    try {
      const res = await fetch(chrome.runtime.getURL('i18n/' + l + '.json'));
      const j = await res.json();
      /* a dictionary is a flat string→string map; anything else is discarded whole
         rather than half-trusted — same rule as src/i18n.js */
      WT_DICT = (j && typeof j === 'object' && !Array.isArray(j)) ? j : {};
    } catch (e) { WT_DICT = {}; }
  })();
  return WT_LOAD;
}
/* the worker can outlive a language change by hours — a cached table would keep
   answering in the language the user just left */
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch && ch.ui_lang) { WT_LOAD = null; WT_DICT = null; }
});
/* The CLDR locale, and it is a property of the language exactly as it is in
   src/i18n.js — the one thing the dictionary CANNOT fix. A month name or a digit
   set comes out of Intl, and `toLocaleDateString('ar-EG')` written literally would
   ship Arabic-Indic digits into an English notification with i18n/en.json complete
   (§6.101/6). Every date the worker formats reads its locale from here. */
function wtLocale() { return WT_LANG === 'en' ? 'en-GB' : 'ar-EG'; }
/* wt(msgid) · wt(msgid, a, b) → {0}/{1} filled in.
   ⚠️ Placeholders, never concatenation: word order differs between the languages,
   and a sentence glued together in Arabic order can only be right in Arabic. */
function wt(id) {
  let s = (WT_DICT && typeof WT_DICT[id] === 'string' && WT_DICT[id]) ? WT_DICT[id] : id;
  if (arguments.length > 1) {
    const a = arguments;
    s = s.replace(/\{(\d+)\}/g, (m, i) => (a[(+i) + 1] === undefined ? m : String(a[(+i) + 1])));
  }
  return s;
}

function ikNotify(title, message, id, buttons) {
  try {
    const o = { type: 'basic', iconUrl: 'icons/icon128.png', title, message };
    if (buttons) { o.buttons = buttons; o.requireInteraction = true; }
    if (id) chrome.notifications.create(id, o); else chrome.notifications.create(o);
  } catch (e) {}
}

/* SYFS_NOTIFY — a content-script tool asking for one browser notification (v0.115.0).
 * Today the only caller is the page-change watcher.
 * ⛔ BOTH STRINGS ARE UNTRUSTED and are treated as such: they arrive from a content
 *    script that shares a world with nothing, but they are BUILT from page-derived text
 *    (a document title), so they are cut to length and coerced to string here rather
 *    than trusted to have been cut at the other end. A notification is chrome UI drawn
 *    outside any page; text that reaches it must never be able to run long enough to
 *    push the real content off, or to carry anything but text.
 * ⛔ No URL, no click action, no body content — a notification that can be given a link
 *    by a page is a phishing surface. */
onMsg((msg) => {
  if (!msg || msg.type !== 'SYFS_NOTIFY') return;
  ikNotify(String(msg.title || '').slice(0, 80), String(msg.message || '').slice(0, 160));
  /* no sendResponse and no `return true`: the caller wants the notification, not an
     answer, and holding the channel open for a reply nobody reads leaks a port */
});
/* `stop` (v0.164.2) — a toast that stays up with a «⏹» button, for a sound the user
   may want to cut short. Only 'adhan' is understood by the page. */
function ikToast(title, text, stop) {
  const msg = { type: 'SYFS_TOAST', title, text };
  if (stop) msg.stop = stop;
  chrome.tabs.query({ active: true }, (tabs) => {
    (tabs || []).forEach((t) => {
      if (t.id == null) return;
      try { chrome.tabs.sendMessage(t.id, msg).catch(() => {}); } catch (e) {}
    });
  });
}
/* ⚠️ Two rules collide here and the source is what gives way (§6.97/7). The whole
   clock reading has to be ONE msgid, because that is the only way AM/PM can land on
   the correct side of the digits in English. But «ص»/«م» are a single Arabic letter
   each, under the extractor's two-letter floor — a msgid built from them is never
   extracted, is therefore never reported as untranslated, and would have shipped an
   Arabic marker inside an English notification with every gate passing. So the
   markers are spelled out. It is better Arabic in a notification anyway. */
function ikClock(c) {
  if (!c) return '';
  return c.am ? wt('{0}:{1} صباحاً', c.hh, c.mm) : wt('{0}:{1} مساءً', c.hh, c.mm);
}
/* rounded to the nearest minute, as the panel's clock rounds — 04:31:40 is «4:32» on
   both, not 4:32 in the tool and 4:31 in the notification */
function ikClockOf(ms) { const dt = new Date(Math.round(ms / 60000) * 60000); return { hh: dt.getHours() % 12 || 12, mm: String(dt.getMinutes()).padStart(2, '0'), am: dt.getHours() < 12 }; }
const IK_NAMES = { fajr: 'الفجر', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };
/* v0.167.0 — صلاة الضحى: one alarm at sunrise + duhaAfter, today or tomorrow. Its
   time ends shortly before الظهر, so a setting that would land after dhuhr − 10 min
   is pulled back to it rather than announcing a prayer whose time has gone. */
async function ikScheduleDuha(s, c) {
  await chrome.alarms.clear('syfs_duha');
  if (!s.duhaOn) return;
  const now = Date.now();
  for (let add = 0; add < 2; add++) {
    const day = ikDay(add);
    const t = ikPrayerTimes(day, c[0], c[1], c[2], c[3]);
    const at = Math.min(ikWhen(day, t.sunrise) + s.duhaAfter * 60000, ikWhen(day, t.dhuhr) - 10 * 60000);
    if (at > now + 5000) { chrome.alarms.create('syfs_duha', { when: at }); return; }
  }
}
/* v0.168.0 — قيام الليل. The night of `day` runs from its المغرب to the NEXT day's
   الفجر, so at 1 a.m. the hour still ahead belongs to yesterday's night: the scan starts
   one day back. Never earlier than half an hour after العشاء. */
function ikQiyamH(t, tn, mode) {
  const night = (tn.fajr + 24) - t.maghrib;
  const h = mode === 'half' ? t.maghrib + night / 2 : mode === 'isha' ? t.isha + 1 : t.maghrib + night * 2 / 3;
  return Math.max(h, t.isha + 0.5);
}
async function ikScheduleQiyam(s, c) {
  await chrome.alarms.clear('syfs_qiyam');
  if (!s.qiyamOn) return;
  const now = Date.now();
  for (let add = -1; add < 2; add++) {
    const day = ikDay(add);
    const t = ikPrayerTimes(day, c[0], c[1], c[2], c[3]), tn = ikPrayerTimes(ikDay(add + 1), c[0], c[1], c[2], c[3]);
    const at = ikWhen(day, ikQiyamH(t, tn, s.qiyamAt));
    if (at > now + 5000) { chrome.alarms.create('syfs_qiyam', { when: at }); return; }
  }
}
/* v0.175.0 — the wudu reminder follows the adhan's prayers. While the adhan alert is
   OFF its per-prayer rows read as all-off, so «same prayers» then means all five: the
   user switched on the wudu reminder alone and expects it to do something. */
function ikWuduFor(s, k) { return s.prayerOn ? !!s.prayerWhich[k] : true; }
/* the pre-alert and the wudu reminder landing on the same minute for the same prayer
   would be two notifications saying the same thing — the wudu one carries the adhan
   time already, so it wins */
function ikWuduCovers(s, k) { return s.wuduOn && ikWuduFor(s, k) && s.wuduBefore[k] === s.prayerBefore; }
let ikWuduNext = null;            /* the panel's status line after a save */
async function ikScheduleWudu(s, c) {
  await chrome.alarms.clear('syfs_wudu');
  ikWuduNext = null;
  if (!s.wuduOn) return;
  const now = Date.now();
  /* earliest, not first: lead times differ per prayer, so isha − 120 min can come
     before maghrib − 5 min */
  let best = null;
  for (let add = 0; add < 2; add++) {
    const day = ikDay(add);
    const t = ikPrayerTimes(day, c[0], c[1], c[2], c[3]);
    for (const k of IK_PRAYERS) {
      if (!ikWuduFor(s, k)) continue;
      const adhan = ikWhen(day, t[k]);
      const at = adhan - s.wuduBefore[k] * 60000;
      if (at > now + 5000 && (!best || at < best.at)) best = { k, at, adhan };
    }
  }
  if (!best) return;
  /* raw reading stored, rendered when shown — same rule as syfs_next_prayer */
  await chrome.storage.local.set({ syfs_next_wudu: { name: IK_NAMES[best.k], clock: ikClockOf(best.adhan), before: s.wuduBefore[best.k] } });
  chrome.alarms.create('syfs_wudu', { when: best.at });
  ikWuduNext = wt('الوضوء التالي: {0} {1}', wt(IK_NAMES[best.k]), ikClock(ikClockOf(best.at)));
}
async function ikSchedulePrayer() {
  const { s, city } = await ikGetSettings();
  await wtLoad();                 /* the return value is shown in the panel */
  await chrome.alarms.clear('syfs_prayer');
  await chrome.alarms.clear('syfs_adhan');
  const c = ikCity(city);
  await ikScheduleDuha(s, c);
  await ikScheduleQiyam(s, c);
  await ikScheduleWudu(s, c);
  if (!s.prayerOn) return null;
  const now = Date.now();
  /* two alarms, walked in one pass: the next pre-alert and (v0.152.0) the next adhan.
     They are NOT the same prayer once the pre-alert has fired — the adhan it announced
     is still ahead while the next pre-alert already belongs to the prayer after it. */
  let next = null, adhanSet = !s.adhanSound;
  for (let add = 0; add < 2; add++) {                       // today, then tomorrow
    const day = ikDay(add);
    const t = ikPrayerTimes(day, c[0], c[1], c[2], c[3]);
    for (const k of IK_PRAYERS) {
      if (!s.prayerWhich[k]) continue;                        /* v0.122.0: per-prayer opt-out */
      const adhan = ikWhen(day, t[k]);
      if (!adhanSet && adhan > now + 5000) {
        adhanSet = true;
        await chrome.storage.local.set({ syfs_next_adhan: { name: IK_NAMES[k] } });
        chrome.alarms.create('syfs_adhan', { when: adhan });
      }
      if (next) { if (adhanSet) return next; continue; }
      const fireAt = adhan - s.prayerBefore * 60000;
      if (fireAt > now + 5000 && !ikWuduCovers(s, k)) {
        /* ⚠️ what is STORED is the raw reading, never the rendered one. The alarm
           can fire hours after it was scheduled and the language may have changed in
           between — a stored string would put an Arabic clock beside an English
           prayer name in the same notification. Same rule as `name`, which has always
           been kept as its msgid and translated at the moment it is shown. */
        const clock = ikClockOf(adhan);
        await chrome.storage.local.set({ syfs_next_prayer: { name: IK_NAMES[k], clock, before: s.prayerBefore } });
        chrome.alarms.create('syfs_prayer', { when: fireAt });
        next = wt('التالي: {0} {1}', wt(IK_NAMES[k]), ikClock(clock));
        if (adhanSet) return next;
      }
    }
  }
  return next;
}
/* the bundled sounds, by NAME — the file never comes from a message */
const IK_SOUNDS = { beep: 'pre-adhan.wav', adhan: 'adhan.mp3' };
/* The ALERT channel (#syf-alert in offscreen.html) — its own element, because the one
   clip channel used to be shared: a pre-adhan chime replaced the wird's ayah queue
   (the panel jumped to ayah 1 and stopped), and the goal's dhikr recitation cut the
   maghrib adhan mid-phrase. The Quran player and the clip queue are DUCKED under an
   alert and come back after it. `pri` ranks alerts among themselves: one arriving
   while a higher one sounds is dropped by the page — nothing interrupts the adhan. */
const IK_PRI = { dhikr: 1, beep: 2, adhan: 3 };
const IK_SOUND_GAP = 3000;
let ikSoundLast = 0;
async function ikAlertClip(url, pri) {
  const u = String(url || '');
  if (!CLIP_HOSTS.some((p) => u.startsWith(p)) && !u.startsWith(chrome.runtime.getURL('sounds/'))) return false;
  await qEnsure();                                  /* the Quran player's offscreen document */
  const r = await qSend('clip', { urls: [u], vol: 1, ch: 'alert', pri });
  return !!(r && r.ok !== false && !r.skipped);
}
async function ikSound(kind) {
  if (!Object.prototype.hasOwnProperty.call(IK_SOUNDS, kind)) return false;
  return ikAlertClip(chrome.runtime.getURL('sounds/' + IK_SOUNDS[kind]), IK_PRI[kind]);
}
async function ikSoundStop() {
  try { if (await chrome.offscreen.hasDocument()) await qSend('clipstop', { ch: 'alert' }); } catch (e) {}
}
/* v0.164.2 — the adhan is «on air» from its alarm until its clip ends or is stopped.
   On macOS the notification's button sits behind «Options» and the banner leaves the
   screen, so the page toast carries a «⏹» too — and both have to go when the adhan
   does. The flag is in storage.session: the worker may sleep through a 4-minute
   adhan and wake on its `clipend` with every variable gone. */
const IK_ADHAN_ON = 'syfs_adhan_on';
async function ikAdhanDone() {
  let on = false;
  try { on = !!(await chrome.storage.session.get({ [IK_ADHAN_ON]: false }))[IK_ADHAN_ON]; } catch (e) {}
  if (!on) return;
  try { await chrome.storage.session.set({ [IK_ADHAN_ON]: false }); } catch (e) {}
  try { chrome.notifications.clear('syfs-adhan'); } catch (e) {}
  chrome.tabs.query({}).then((tabs) => {
    for (const t of tabs) {
      if (t.id == null) continue;
      chrome.tabs.sendMessage(t.id, { type: 'SYFS_TOAST_CLOSE', tag: 'adhan' }).catch(() => {});
    }
  }).catch(() => {});
}
async function ikAdhanStop() { await ikSoundStop(); await ikAdhanDone(); }

/* ===== أهداف الأذكار (v0.122.0) ===== */
const IK_GAP = 10;               /* minutes after the adhan — the prayer comes first */
const IK_CLOCK_SPAN = 4;         /* hours a clock-mode window stays open */
const IK_GOAL_KEY = 'azkar_goal';
function ikWindow(kind, day, s, c) {
  const t = ikPrayerTimes(day, c[0], c[1], c[2], c[3]);
  if (kind === 's') {
    if (s.sabahMode === 'clock') { const st = ikClockOn(day, s.sabahAt, 7); return { start: st, end: st + IK_CLOCK_SPAN * 3600000 }; }
    return { start: ikWhen(day, t.fajr) + IK_GAP * 60000, end: ikWhen(day, t.dhuhr) };
  }
  if (s.masaaMode === 'clock') { const st = ikClockOn(day, s.masaaAt, 17); return { start: st, end: st + IK_CLOCK_SPAN * 3600000 }; }
  return { start: ikWhen(day, t.asr) + IK_GAP * 60000, end: ikWhen(day, t.isha) };
}
const IK_GOAL_BLANK = () => ({ i: 0, started: false, done: false, missed: false, streak: 0, last: '' });
/* the goal state, rolled over to today on every read — the worker is the only writer */
async function ikGoal() {
  const r = await chrome.storage.local.get({ [IK_GOAL_KEY]: null });
  const raw = (r[IK_GOAL_KEY] && typeof r[IK_GOAL_KEY] === 'object') ? r[IK_GOAL_KEY] : {};
  const g = { day: ikDayKey(), s: IK_GOAL_BLANK(), m: IK_GOAL_BLANK() };
  for (const k of ['s', 'm']) {
    const x = (raw[k] && typeof raw[k] === 'object') ? raw[k] : {};
    g[k].streak = (x.streak >= 0 && x.streak < 100000) ? (x.streak | 0) : 0;
    g[k].last = (typeof x.last === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.last)) ? x.last : '';
    if (raw.day === g.day) {
      g[k].i = (x.i >= 0 && x.i < 1000) ? (x.i | 0) : 0;
      g[k].started = !!x.started; g[k].done = !!x.done; g[k].missed = !!x.missed;
    }
  }
  return g;
}
function ikGoalSave(g) { return chrome.storage.local.set({ [IK_GOAL_KEY]: g }); }
/* every writer of the goal goes through one queue: «✓» tapped on the toast and on the
   notification, or a check landing while the re-reminder alarm runs, would otherwise
   each save its own copy and lose the other's step or streak. The *Now bodies never
   call one another, so nothing waits on itself. */
const ikGoalStart = (kind, force) => serialize('ik_goal', () => ikGoalStartNow(kind, force));
const ikGoalCheck = (kind) => serialize('ik_goal', () => ikGoalCheckNow(kind));
const ikGoalCheckAt = (kind, i) => serialize('ik_goal', () => ikGoalCheckNow(kind, i));   /* «✓» naming its dhikr */
const ikGoalReset = (kind) => serialize('ik_goal', () => ikGoalResetNow(kind));
const ikGoalTick = (kind) => serialize('ik_goal', () => ikGoalTickNow(kind));
const ikGoalFinish = (kind) => serialize('ik_goal', () => ikGoalFinishNow(kind));
function ikYesterdayKey() { return ikDayKey(ikDay(-1)); }
const ikGoalTitle = (kind) => kind === 's' ? '🌅 ' + wt('أذكار الصباح') : '🌙 ' + wt('أذكار المساء');
const ikGoalNotif = (kind) => 'syfs-azkar-' + kind;
/* both re-reminders of one kind: the periodic one and the one-shot re-arm a dismissal
   schedules. Anything that ends or rewinds the sequence clears BOTH — a leftover
   one-shot would push a dhikr the user already ticked. */
async function ikGoalClearAlarms(kind) {
  await chrome.alarms.clear('syfs_goal_' + kind);
  await chrome.alarms.clear('syfs_goalr_' + kind);
}
/* which dhikr was last PUSHED, per kind ({s, m}; -1 = none outstanding). A «✓» that
   names no dhikr (an older toast, the notification button) is honoured only while a
   push is outstanding and is consumed by it — a stray or repeated check finds -1 and
   moves nothing. In storage.session: the click can come minutes after the worker slept. */
const IK_GOAL_ASK = 'syfs_goal_ask';
async function ikGoalAskOf(kind) {
  try {
    const v = (await chrome.storage.session.get({ [IK_GOAL_ASK]: null }))[IK_GOAL_ASK];
    return (v && Number.isInteger(v[kind])) ? v[kind] : -1;
  } catch (e) { return -1; }
}
async function ikGoalAskSet(kind, i) {
  try {
    const v = (await chrome.storage.session.get({ [IK_GOAL_ASK]: null }))[IK_GOAL_ASK];
    const o = (v && typeof v === 'object') ? { s: v.s, m: v.m } : {};
    o[kind] = i;
    await chrome.storage.session.set({ [IK_GOAL_ASK]: o });
  } catch (e) {}
}
/* taking the notification down OURSELVES also fires notifications.onClosed, and that
   listener re-arms the dhikr (below). The kind is parked here for the one close that
   follows, so «✓» and «إعادة التصفير» don't schedule a reminder for a dhikr that is
   already answered. */
const IK_GOAL_HIDDEN = new Set();
function ikGoalHide(kind) {
  IK_GOAL_HIDDEN.add(kind);
  try {
    /* nothing on screen → no onClosed → the flag would sit there and swallow the next
       real dismissal, so it is dropped again unless a notification really went away */
    chrome.notifications.clear(ikGoalNotif(kind), (was) => { if (!was) IK_GOAL_HIDDEN.delete(kind); });
  } catch (e) { IK_GOAL_HIDDEN.delete(kind); }
}

/* ===== قناة الصوت المسجَّل (v0.127.0) =====
 * ⛔ A URL reaches an <audio> element only after it starts with one of these. The
 * check lives HERE, in the worker, for the same reason SYFS_FETCH's does: the
 * offscreen document holds host_permissions, so a clip URL that arrived from a page
 * and was passed on unchecked would be a fetch of anything, by us, on the user's
 * profile. Prefixes, not hostnames — «www.hisnmuslim.com.evil.tld» starts with the
 * host but not with the prefix. */
const CLIP_HOSTS = [
  'https://www.hisnmuslim.com/audio/',          // أذكار الصباح/المساء — حصن المسلم (حامد الدريهم)
  'https://cdn.islamic.network/quran/audio/'    // الورد اليومي — آية بآية (نفس مصدر api.alquran.cloud)
];
function ikClipUrl(kind, i) {
  const u = SYFS_AZKAR.audioUrl(kind, i);
  return (u && CLIP_HOSTS.some((p) => u.startsWith(p))) ? u : '';
}
/* محرك الآيات (v0.180.0): repeats and the silence to repeat in, clamped HERE — the
   offscreen page clamps again, it is the second lock. Anything malformed = the old
   plain queue (1 × each, once, no silence). */
function ikClipPlan(o) {
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : lo);
  o = o || {};
  const gap = (typeof o.gap === 'number' && o.gap >= 0 && o.gap <= 3) ? Math.round(o.gap * 100) / 100 : 0;
  const rate = (typeof o.rate === 'number' && o.rate >= 0.5 && o.rate <= 2) ? o.rate : 1;
  return { reps: int(o.reps, 1, 20), loops: int(o.loops, 1, 20), gap, rate };
}
async function ikClip(urls, plan) {
  const ok = (urls || []).map(String).filter((u) => CLIP_HOSTS.some((p) => u.startsWith(p)));
  if (!ok.length) return { ok: false, error: 'blocked' };
  await qEnsure();                                  /* the same offscreen document */
  const r = await qSend('clip', Object.assign({ urls: ok, vol: 1 }, ikClipPlan(plan)));
  return { ok: !!r, n: ok.length };
}
/* the offscreen document cannot reach a tab, and the panel that asked for the
   recitation wants to follow it ayah by ayah — so its progress is relayed here, to
   the active tabs only (the rail is mounted there; a background tab has nothing to
   highlight and would be woken for nothing). */
onMsg((msg) => {
  if (!msg || msg.type !== 'SYFS_CLIPSTATE') return;
  /* the adhan rides the alert channel — its end is the alert's end, not a wird's */
  if (msg.evt === 'alertend') ikAdhanDone().catch(() => {});
  /* the Quran was stopped while a clip played — its deferred close happens once BOTH
     channels are quiet (`busy` = the other one still sounds) */
  if ((msg.evt === 'clipend' || msg.evt === 'alertend') && !msg.busy && qCloseWhenIdle && !qLive.playing) {
    qCloseWhenIdle = false;
    chrome.offscreen.closeDocument().catch(() => {});
  }
  /* only the clip queue is followed by a panel; an alert is no ayah to highlight */
  if (msg.evt !== 'clip' && msg.evt !== 'clipend') return;   /* 'gap'/'clippause' are for extension pages, which hear them directly */
  chrome.tabs.query({ active: true }).then((tabs) => {
    for (const t of tabs) {
      if (t.id == null) continue;
      chrome.tabs.sendMessage(t.id, { type: 'SYFS_CLIP_AT', i: msg.i | 0, n: msg.n | 0, r: msg.r | 0, l: msg.l | 0 }).catch(() => {});
    }
  }).catch(() => {});
});
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_CLIP') return;
  (async () => {
    if (msg.op === 'stop') { await qEnsure(); await qSend('clipstop'); sendResponse({ ok: true }); return; }
    if (msg.op === 'pause' || msg.op === 'resume') {
      if (!(await chrome.offscreen.hasDocument())) { sendResponse({ ok: false }); return; }
      sendResponse(await qSend(msg.op === 'pause' ? 'clippause' : 'clipresume') || { ok: false });
      return;
    }
    sendResponse(await ikClip(Array.isArray(msg.urls) ? msg.urls : [msg.url], msg));
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

/* push the CURRENT dhikr: the rail's toast on an active tab (with its ✓ button),
   else a notification with the same button. Returns true when something was shown. */
async function ikGoalPush(kind) {
  const [{ s }, g, L] = await Promise.all([ikGetSettings(), ikGoal(), ikLists()]);
  const list = L[kind];
  const x = g[kind];
  if (x.done || x.i >= list.length) return false;
  await wtLoad();
  const item = list[x.i];
  /* v0.127.0 — the sheikh, not the robot: a built-in dhikr has a real recording, so
     the worker plays it through the offscreen document (which survives the tab the
     toast happens to land on). The page is told to SPEAK only when there is no
     recording (the user's own adhkar), or both would sound at once. */
  const url = s.goalTts ? ikClipUrl(kind, x.i) : '';
  if (url) ikAlertClip(url, IK_PRI.dhikr).catch(() => {});
  await ikGoalAskSet(kind, x.i);
  const payload ={ type: 'SYFS_AZKAR_ASK', kind, i: x.i, total: list.length, text: item[0], n: item[1], tts: s.goalTts && !url };
  let shown = false;
  try {
    const tabs = await chrome.tabs.query({ active: true });
    for (const t of tabs) {
      if (t.id == null) continue;
      try { const r = await chrome.tabs.sendMessage(t.id, payload); if (r && r.ok) shown = true; } catch (e) {}
    }
  } catch (e) {}
  if (shown) return true;
  /* the dhikr itself is CONTENT and stays Arabic in either language (§6.97/2) */
  ikNotify(ikGoalTitle(kind) + ' ' + (x.i + 1) + '/' + list.length,
    item[0] + (item[1] > 1 ? ' ×' + item[1] : ''),
    ikGoalNotif(kind), [{ title: '✓ ' + wt('قرأته') }, { title: wt('لاحقاً') }]);
  return true;
}
async function ikGoalStartNow(kind, force) {
  const [{ s, city }, g] = await Promise.all([ikGetSettings(), ikGoal()]);
  const x = g[kind];
  if (x.done) return false;
  if (!(kind === 's' ? s.sabahOn : s.masaaOn)) return false;          /* switched off */
  /* only inside today's window. The start alarm is delivered late when the laptop
     sleeps through it: lid closed at 4 a.m., opened at 8 p.m. ⇒ the morning list
     pushed at night, then «فاتك» a few minutes later. Tomorrow's start is the caller's. */
  const w = ikWindow(kind, ikDay(0), s, ikCity(city));
  if (Date.now() < w.start - 60000 || Date.now() >= w.end) return false;
  if (x.started && !force) return false;
  x.started = true; x.missed = false;
  await ikGoalSave(g);
  await ikGoalClearAlarms(kind);
  if (s.goalEvery > 0) chrome.alarms.create('syfs_goal_' + kind, { periodInMinutes: s.goalEvery, delayInMinutes: s.goalEvery });
  await ikGoalPush(kind);
  return true;
}
/* «✓ قرأته» — advance; the next dhikr is pushed at once, the last one closes the goal.
   `i` = the dhikr the toast showed. Every re-reminder used to leave one more toast on
   the page, and «✓» on each of five toasts for dhikr 1 marked five adhkar read. Now a
   check for any dhikr but the CURRENT one is ignored; one without `i` (an older page,
   the notification button) must match the outstanding push, and consumes it. */
async function ikGoalCheckNow(kind, i) {
  const [g, L] = await Promise.all([ikGoal(), ikLists()]);
  const x = g[kind], total = L[kind].length;
  if (x.done) { ikGoalHide(kind); return g; }
  if ((i === undefined ? await ikGoalAskOf(kind) : i) !== x.i) return g;
  await ikGoalAskSet(kind, -1);
  ikGoalHide(kind);
  x.i = Math.min(x.i + 1, total);
  x.started = true;
  if (x.i >= total) {
    x.done = true;
    const today = ikDayKey();
    if (x.last !== today) { x.streak = (x.last === ikYesterdayKey()) ? x.streak + 1 : 1; x.last = today; }
    await ikGoalSave(g);
    await ikGoalClearAlarms(kind);
    await wtLoad();
    ikNotify(ikGoalTitle(kind), wt('أتممت الأذكار ✓ — سلسلة {0} يوم 🔥', x.streak));
    ikToast(ikGoalTitle(kind), wt('أتممت الأذكار ✓ — سلسلة {0} يوم 🔥', x.streak));
    return g;
  }
  await ikGoalSave(g);
  await ikGoalPush(kind);
  return g;
}
/* v0.155.0 — «✓ قرأتها» on the clock card: the whole list at once (read from a book or
   by heart). The same completion as the last «✓ قرأته» — streak included — without the
   toast: the user is looking at the card that asked. */
async function ikGoalFinishNow(kind) {
  const [g, L] = await Promise.all([ikGoal(), ikLists()]);
  const x = g[kind];
  ikGoalHide(kind);
  if (x.done) return g;
  x.i = L[kind].length; x.started = true; x.done = true; x.missed = false;
  await ikGoalAskSet(kind, -1);
  const today = ikDayKey();
  if (x.last !== today) { x.streak = (x.last === ikYesterdayKey()) ? x.streak + 1 : 1; x.last = today; }
  await ikGoalSave(g);
  await ikGoalClearAlarms(kind);
  return g;
}
async function ikGoalResetNow(kind) {
  const g = await ikGoal();
  g[kind] = Object.assign(IK_GOAL_BLANK(), { streak: g[kind].streak, last: g[kind].last });
  await ikGoalAskSet(kind, -1);
  await ikGoalSave(g);
  await ikGoalClearAlarms(kind);
  ikGoalHide(kind);
  return g;
}
/* the re-reminder: same dhikr again while the window is open, «فاتك» once it closed */
async function ikGoalTickNow(kind) {
  const [{ s, city }, g, L] = await Promise.all([ikGetSettings(), ikGoal(), ikLists()]);
  const x = g[kind];
  const on = kind === 's' ? s.sabahOn : s.masaaOn;
  if (!on || x.done || !x.started) { await ikGoalClearAlarms(kind); return; }
  const c = ikCity(city);
  const w = ikWindow(kind, ikDay(0), s, c);
  if (Date.now() >= w.end) {
    x.missed = true;
    await ikGoalSave(g);
    await ikGoalClearAlarms(kind);
    ikGoalHide(kind);
    await wtLoad();
    const left = Math.max(0, L[kind].length - x.i);
    ikNotify(ikGoalTitle(kind), wt('انتهى وقت الأذكار — فاتك {0} من {1}', left, L[kind].length));
    return;
  }
  await ikGoalPush(kind);
}
/* a dismissal is not an answer (v0.123.0): closing the notification — the ✕, «لاحقاً»,
   or the notification centre retiring it — brings the SAME dhikr back one short
   interval later. Only «✓ قرأته» moves the sequence on. «بلا تكرار» (goalEvery 0) is
   the user saying they don't want that, so it is honoured here too. */
async function ikGoalRearm(kind) {
  const [{ s }, g] = await Promise.all([ikGetSettings(), ikGoal()]);
  const x = g[kind];
  if (!(kind === 's' ? s.sabahOn : s.masaaOn)) return;
  if (x.done || x.missed || !x.started || !s.goalEvery) return;
  chrome.alarms.create('syfs_goalr_' + kind, { delayInMinutes: Math.min(s.goalEvery, 5) });
}
/* today's window if it has not opened yet, else tomorrow's */
function ikNextStart(kind, s, c) {
  const now = Date.now();
  for (let add = 0; add < 2; add++) {
    const w = ikWindow(kind, ikDay(add), s, c);
    if (w.start > now + 5000) return w.start;
  }
  return null;
}
/* azkar_i comes from storage — an import or an old build can leave a string, a
   negative or a fraction there, and `x % n` then indexes nothing (NaN/negative). */
function ikAzkarIndex(v, n) {
  const i = Number.isSafeInteger(v) && v >= 0 ? v : 0;
  return i % n;
}
/* one at a time: a panel's «apply» and the storage listener below land together */
function ikApply() { return serialize('ik_apply', ikApplyNow); }
async function ikApplyNow() {
  const { s, city } = await ikGetSettings();
  const c = ikCity(city);
  await Promise.all(['syfs_sabah', 'syfs_masaa'].map((n) => chrome.alarms.clear(n)));
  /* an armed periodic alarm with the same interval is LEFT running: re-creating it on
     every save, every browser start and every storage change restarted the count, so
     with a 4-hour interval the dhikr could never arrive at all */
  let az = null;
  try { az = await chrome.alarms.get('syfs_azkar'); } catch (e) {}
  if (!s.azkarOn) await chrome.alarms.clear('syfs_azkar');
  else if (!az || az.periodInMinutes !== s.azkarSec / 60) chrome.alarms.create('syfs_azkar', { periodInMinutes: s.azkarSec / 60, delayInMinutes: s.azkarSec / 60 });
  const g = await ikGoal();
  for (const kind of ['s', 'm']) {
    const on = kind === 's' ? s.sabahOn : s.masaaOn;
    const alarm = kind === 's' ? 'syfs_sabah' : 'syfs_masaa';
    if (!on) { await chrome.alarms.clear('syfs_goal_' + kind); continue; }
    const next = ikNextStart(kind, s, c);
    if (next) chrome.alarms.create(alarm, { when: next });
    /* switched on in the middle of an open window → start now rather than tomorrow */
    const w = ikWindow(kind, ikDay(0), s, c);
    if (Date.now() >= w.start && Date.now() < w.end && !g[kind].started && !g[kind].done) ikGoalStart(kind).catch(() => {});
  }
  return ikSchedulePrayer();
}
/* v0.174.2 — an alarm that came due while the laptop slept (or Chrome was closed) is
   delivered the moment it wakes: the fajr adhan at 07:40 when the lid opens. A time-
   bound alert is only true AT its time, so past this grace it is dropped silently and
   just re-armed for the next one. `scheduledTime` is the instant it was meant for. */
const IK_LATE_MS = 3 * 60000;
const IK_TIMED = new Set(['syfs_prayer', 'syfs_adhan', 'syfs_duha', 'syfs_qiyam', 'syfs_wudu']);
function ikLate(a) {
  return IK_TIMED.has(a.name) && typeof a.scheduledTime === 'number' && Date.now() - a.scheduledTime > IK_LATE_MS;
}
chrome.alarms.onAlarm.addListener(async (a) => {
  if (!a || !a.name || a.name.indexOf('syfs_') !== 0) return;
  const { s, city } = await ikGetSettings();
  if (ikLate(a)) {
    if (a.name === 'syfs_duha') ikScheduleDuha(s, ikCity(city)).catch(() => {});
    else if (a.name === 'syfs_qiyam') ikScheduleQiyam(s, ikCity(city)).catch(() => {});
    else if (a.name === 'syfs_wudu') ikScheduleWudu(s, ikCity(city)).catch(() => {});
    else ikSchedulePrayer().catch(() => {});
    return;
  }
  /* before the first string is built, not after: on a cold worker the table is not
     loaded yet, and a notification that fires half a tick early is an Arabic one */
  await wtLoad();
  if (a.name === 'syfs_azkar') {
    if (!s.azkarOn) return;
    const L = await ikLists();
    if (!L.gen || !L.gen.length) return;
    const i = await serialize('azkar_i', async () => {
      const st = await chrome.storage.local.get({ azkar_i: 0 });
      const k = ikAzkarIndex(st.azkar_i, L.gen.length);
      await chrome.storage.local.set({ azkar_i: k + 1 });
      return k;
    });
    /* ⛔ the dhikr itself is CONTENT and stays Arabic in either language (§6.97/2) —
       only the label around it is interface */
    if (s.azkarNotif) ikNotify(wt('ذِكر') + ' 🕌', L.gen[i]);
    if (s.azkarToast) ikToast(wt('ذِكر'), L.gen[i]);
  } else if (a.name === 'syfs_prayer') {
    const st = await chrome.storage.local.get({ syfs_next_prayer: null });
    const p = st.syfs_next_prayer;
    if (p) {
      const at = ikClock(p.clock);
      ikNotify('🕌 ' + wt('اقترب وقت الصلاة'),
        wt('صلاة {0} بعد {1} دقائق ({2})', wt(p.name), p.before, at));
      ikToast('🕌 ' + wt('صلاة {0}', wt(p.name)),
        wt('الأذان {0} — بعد {1} دقائق', at, p.before));
      if (s.prayerBeep) ikSound('beep').catch(() => {});
    }
    ikSchedulePrayer();
  } else if (a.name === 'syfs_adhan') {
    /* v0.152.0 — the adhan at the prayer time. The notification carries the only
       way to silence it that does not need a page: «إيقاف الأذان». */
    const st = await chrome.storage.local.get({ syfs_next_adhan: null });
    const p = st.syfs_next_adhan;
    if (p && s.prayerOn && s.adhanSound) {
      ikNotify('🕌 ' + wt('حان الآن وقت صلاة {0}', wt(p.name)), wt('الأذان يُرفع الآن — اضغط هنا لإيقافه'),
        'syfs-adhan', [{ title: wt('إيقاف الأذان') }]);
      ikToast('🕌 ' + wt('حان الآن وقت صلاة {0}', wt(p.name)), wt('الأذان يُرفع الآن'), 'adhan');
      try { await chrome.storage.session.set({ [IK_ADHAN_ON]: true }); } catch (e) {}
      ikSound('adhan').catch(() => {});
    }
    ikSchedulePrayer();
  } else if (a.name === 'syfs_duha') {
    if (s.duhaOn) {
      ikNotify('☀️ ' + wt('حان وقت صلاة الضحى'), wt('سنة مؤكدة — ركعتان فأكثر، ووقتها حتى قُبيل الظهر'));
      ikToast('☀️ ' + wt('صلاة الضحى'), wt('سنة مؤكدة — ركعتان فأكثر، ووقتها حتى قُبيل الظهر'));
      if (s.prayerBeep) ikSound('beep').catch(() => {});
    }
    const { city } = await ikGetSettings();
    ikScheduleDuha(s, ikCity(city)).catch(() => {});
  } else if (a.name === 'syfs_qiyam') {
    if (s.qiyamOn) {
      ikNotify('🌙 ' + wt('حان وقت قيام الليل'), wt('سنة مؤكدة — مثنى مثنى، ويُختم بالوتر'));
      ikToast('🌙 ' + wt('قيام الليل'), wt('سنة مؤكدة — مثنى مثنى، ويُختم بالوتر'));
      if (s.prayerBeep) ikSound('beep').catch(() => {});
    }
    const { city } = await ikGetSettings();
    ikScheduleQiyam(s, ikCity(city)).catch(() => {});
  } else if (a.name === 'syfs_wudu') {
    const st = await chrome.storage.local.get({ syfs_next_wudu: null });
    const p = st.syfs_next_wudu;
    if (p && s.wuduOn) {
      const at = ikClock(p.clock);
      ikNotify('💧 ' + wt('حان وقت الوضوء'), wt('صلاة {0} بعد {1} دقيقة ({2}) — استعدّ للصلاة', wt(p.name), p.before, at));
      ikToast('💧 ' + wt('الوضوء — صلاة {0}', wt(p.name)), wt('الأذان {0} — بعد {1} دقيقة', at, p.before));
      if (s.wuduBeep) ikSound('beep').catch(() => {});
    }
    ikScheduleWudu(s, ikCity(city)).catch(() => {});
  } else if (a.name === 'syfs_sabah' || a.name === 'syfs_masaa') {
    const kind = a.name === 'syfs_sabah' ? 's' : 'm';
    if (kind === 's' ? s.sabahOn : s.masaaOn) await ikGoalStart(kind, true);
    ikApply().catch(() => {});                              /* tomorrow's start */
  } else if (/^syfs_goalr?_[sm]$/.test(a.name)) {
    await ikGoalTick(a.name.slice(-1));
  }
});
try {
  chrome.notifications.onButtonClicked.addListener((id, idx) => {
    if (id === 'syfs-adhan') { ikAdhanStop(); return; }
    const m = /^syfs-azkar-([sm])$/.exec(id || '');
    if (!m) return;
    if (idx === 0) ikGoalCheck(m[1]).catch(() => {});    /* it hides the notification itself */
    else chrome.notifications.clear(id);         /* «لاحقاً» — onClosed re-arms it */
  });
} catch (e) {}
/* a click on the adhan notification's body stops it too — on macOS the body is what
   the user can actually reach; the button hides behind «Options» */
try {
  chrome.notifications.onClicked.addListener((id) => { if (id === 'syfs-adhan') ikAdhanStop(); });
} catch (e) {}
try {
  chrome.notifications.onClosed.addListener((id, byUser) => {
    if (id === 'syfs-adhan') { if (byUser) ikAdhanStop(); return; }   /* dismissing it = «enough» */
    const m = /^syfs-azkar-([sm])$/.exec(id || '');
    if (!m) return;
    if (IK_GOAL_HIDDEN.delete(m[1])) return;     /* we took it down ourselves */
    ikGoalRearm(m[1]).catch(() => {});
  });
} catch (e) {}
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_ITHKAR') return;
  (async () => {
    /* «إشعار تجريبي» and not «تجربة»: that word is already a BUTTON elsewhere, and
       one msgid cannot carry two meanings (§6.97/6) — fixed at the source, as before */
    if (msg.op === 'test') { await wtLoad(); ikNotify(wt('إشعار تجريبي') + ' 🔔', SYFS_AZKAR.GEN[0]); sendResponse({ ok: true }); return; }
    if (msg.op === 'apply') { const next = await ikApply(); sendResponse({ ok: true, next: next || undefined, wudu: ikWuduNext || undefined }); return; }
    /* the panels' «▶» preview buttons. `kind` is a key of IK_SOUNDS, never a path. */
    if (msg.op === 'sound') {
      if (msg.kind === 'stop') { await ikAdhanStop(); sendResponse({ ok: true }); return; }
      const kind = String(msg.kind || '');
      if (!Object.prototype.hasOwnProperty.call(IK_SOUNDS, kind)) { sendResponse({ ok: false }); return; }
      /* the previews are rail panels — content scripts, so the op cannot be 'page'
         in MSG_POLICY without killing the ▶ buttons. A hijacked page could still loop
         the full adhan, so a web context gets one preview per IK_SOUND_GAP; ⏹ is free. */
      if (senderClass(sender) === 'content') {
        if (Date.now() - ikSoundLast < IK_SOUND_GAP) { sendResponse({ ok: false, error: 'busy' }); return; }
        ikSoundLast = Date.now();
      }
      sendResponse({ ok: await ikSound(kind) });
      return;
    }
    sendResponse({ ok: false, error: 'bad-op' });
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});
/* SYFS_AZKAR — the goal ops from the panel and from the toast's ✓ button.
   `kind` is whitelisted: it becomes an alarm name and a storage sub-key. */
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_AZKAR') return;
  (async () => {
    const kind = msg.kind === 'm' ? 'm' : 's';
    if (msg.op === 'status') {
      const [{ s, city }, g, L] = await Promise.all([ikGetSettings(), ikGoal(), ikLists()]);
      const c = ikCity(city);
      const now = Date.now();
      const win = {};
      for (const k of ['s', 'm']) { const w = ikWindow(k, ikDay(0), s, c); win[k] = { start: w.start, end: w.end, open: now >= w.start && now < w.end }; }
      /* v0.155.0 — today's five prayers + tomorrow's fajr as instants, for the clock
         card's «الصلاة القادمة»: the same math the alarms use, so the card can never
         name a different time than the alert that follows it */
      const t0 = ikPrayerTimes(ikDay(0), c[0], c[1], c[2], c[3]), t1 = ikPrayerTimes(ikDay(1), c[0], c[1], c[2], c[3]);
      const pt = IK_PRAYERS.map((k) => ({ k, at: ikWhen(ikDay(0), t0[k]) })).concat([{ k: 'fajr', at: ikWhen(ikDay(1), t1.fajr) }]);
      sendResponse({ ok: true, day: ikDayKey(), goal: g, total: { s: L.s.length, m: L.m.length }, win, pt, on: { s: s.sabahOn, m: s.masaaOn }, tts: s.goalTts });
      return;
    }
    if (msg.op === 'check') {
      /* `i` present ⇒ it must be an integer naming the current dhikr (-1 never does) */
      const i = msg.i === undefined ? undefined : (Number.isInteger(msg.i) ? msg.i : -1);
      sendResponse({ ok: true, goal: await ikGoalCheckAt(kind, i) });
      return;
    }
    if (msg.op === 'finish') { sendResponse({ ok: true, goal: await ikGoalFinish(kind) }); return; }
    if (msg.op === 'reset') { sendResponse({ ok: true, goal: await ikGoalReset(kind) }); return; }
    if (msg.op === 'start') { await ikGoalStart(kind, true); sendResponse({ ok: true, goal: await ikGoal() }); return; }
    sendResponse({ ok: false, error: 'bad-op' });
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});
chrome.runtime.onInstalled.addListener(() => { ikApply().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { ikApply().catch(() => {}); });
/* «استيراد» writes `ithkar` and `prayer_city` straight to storage and sends no apply —
   the imported alerts stayed unarmed until the next save or browser start. Storage is
   the one path every writer takes (the calendar's rule, §5.9/2). */
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch && (ch.ithkar || ch.prayer_city)) ikApply().catch(() => {});
});

/* ===== المناسبات والأيام الفاضلة — الجدولة (occasions) =====
 * Settings live in the `occasions` key (written by src/occasions.js), ON by
 * default. Fully offline: the Hijri calendar comes from Intl, nothing is fetched.
 * The engine below is a VERBATIM copy of the block in src/occasions.js — a check
 * asserts they stay identical. Do not edit one without the other. */
/* <<< OCC-ENGINE >>> */
  /* The Hijri calendar and everything computed FROM it. This block is duplicated
   * VERBATIM in background.js: the worker schedules the reminders and cannot import
   * from a content script, and the prayer math already sets that precedent
   * (`ikPrayerTimes` is a worker copy of the same function in src/tools2.js). A
   * check asserts the two copies stay byte-identical — the same guarantee
   * DEFAULT_TOOL_ORDER has. Keep it free of `window.`, `document.` and `chrome.`:
   * one of its two homes is a service worker with none of them. */
  var OCC_DAY = 86400000;
  var OCC_MONTHS = ['محرّم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة',
                    'رجب', 'شعبان', 'رمضان', 'شوّال', 'ذو القعدة', 'ذو الحجة'];
  /* type: fast = يُستحبّ صومه · season = موسم فاضل · warn = نُهي عن صومه */
  var OCC_DEFS = [
    { key: 'white',    name: 'أيام البيض',        type: 'fast',   hint: '١٣ و١٤ و١٥ من كل شهر' },
    { key: 'monthu',   name: 'الاثنين والخميس',    type: 'fast',   hint: 'صوم أسبوعي' },
    { key: 'tasua',    name: 'تاسوعاء',           type: 'fast',   hint: '٩ محرّم' },
    { key: 'ashura',   name: 'عاشوراء',           type: 'fast',   hint: '١٠ محرّم' },
    { key: 'ashr',     name: 'العشر من ذي الحجة',  type: 'season', hint: '١–٩ ذو الحجة' },
    { key: 'arafah',   name: 'يوم عرفة',          type: 'fast',   hint: '٩ ذو الحجة — لغير الحاجّ' },
    { key: 'shawwal6', name: 'ست من شوّال',        type: 'fast',   hint: '٢–٧ شوّال (ويجوز صومها في الشهر كله)' },
    { key: 'ramadan',  name: 'دخول رمضان',        type: 'season', hint: '١ رمضان' },
    { key: 'last10',   name: 'العشر الأواخر',      type: 'season', hint: '٢١ رمضان فما بعد' },
    { key: 'shaban',   name: 'شعبان',             type: 'season', hint: 'الإكثار من الصوم' },
    { key: 'sacred',   name: 'شهر حرام',          type: 'season', hint: 'محرّم · رجب · ذو القعدة · ذو الحجة' },
    { key: 'eidfitr',  name: 'عيد الفطر',         type: 'warn',   hint: 'لا يُصام' },
    { key: 'eidadha',  name: 'عيد الأضحى',        type: 'warn',   hint: 'لا يُصام' },
    { key: 'tashreeq', name: 'أيام التشريق',      type: 'warn',   hint: '١١–١٣ ذو الحجة — لا تُصام' }
  ];
  /* The bell is ON by default (user decision, 2026-10-09): every occasion rings except the two month-long seasons (شعبان · الأشهر
   * الحرم) — the user's choice of defaults. These fill MISSING keys only: occSettings
   * keeps any boolean already stored, so a saved choice is never overridden. */
  var OCC_DEFAULTS = {
    on: true, lead: 1, at: '20:00', offset: 0,
    keys: {
      white: true, monthu: true, tasua: true, ashura: true, ashr: true, arafah: true,
      shawwal6: true, ramadan: true, last10: true, shaban: false, sacred: false,
      eidfitr: true, eidadha: true, tashreeq: true
    }
  };

  /* Every stored field is re-checked here rather than trusted: storage is shared
   * with an export/import feature, so a hand-edited file is a real input path.
   * Out-of-range values are REJECTED back to the default, never clamped-and-kept —
   * a silently "corrected" 99-day lead is a reminder the user never asked for. */
  function occSettings(raw) {
    var s = Object.assign({}, OCC_DEFAULTS, raw && typeof raw === 'object' ? raw : {});
    s.on = !!s.on;
    s.lead = (typeof s.lead === 'number' && s.lead >= 0 && s.lead <= 7) ? Math.round(s.lead) : OCC_DEFAULTS.lead;
    s.offset = (s.offset === -1 || s.offset === 0 || s.offset === 1) ? s.offset : 0;
    s.at = /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.at) ? s.at : OCC_DEFAULTS.at;
    var keys = {}, raws = (raw && typeof raw.keys === 'object' && raw.keys) || {};
    OCC_DEFS.forEach(function (d) {                       /* whitelist: only known keys survive */
      keys[d.key] = (typeof raws[d.key] === 'boolean') ? raws[d.key] : OCC_DEFAULTS.keys[d.key];
    });
    s.keys = keys;
    return s;
  }

  /* ⚠️ A formatter pins the time zone it was BUILT in, while `new Date(y, m, d)` is
   * local midnight in the zone the device has NOW. After a zone change (travel) the
   * cached one read the new midnight in the old zone — the Hijri date a day off until
   * the page reloaded. So the zone is re-read (at most once a second: a scan calls
   * this 400 times) and the formatter rebuilt when it moved. */
  var occFmt = null, occFmtTz = '', occFmtAt = 0;
  function occFormatter() {
    var now = Date.now();
    if (occFmt !== null && now - occFmtAt < 1000) return occFmt;
    occFmtAt = now;
    var tz = '';
    try { tz = new Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    if (occFmt !== null && tz === occFmtTz) return occFmt;
    occFmtTz = tz;
    try {
      occFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn',
        { year: 'numeric', month: 'numeric', day: 'numeric' });
    } catch (e) { occFmt = false; }
    return occFmt;
  }
  function occHijri(date, offset) {
    var fmt = occFormatter();
    if (!fmt) return null;
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + (offset || 0));
    var o = {};
    try {
      fmt.formatToParts(d).forEach(function (p) {
        if (p.type === 'year' || p.type === 'month' || p.type === 'day') o[p.type] = parseInt(p.value, 10);
      });
    } catch (e) { return null; }
    if (!(o.year > 0 && o.month >= 1 && o.month <= 12 && o.day >= 1 && o.day <= 30)) return null;
    return { y: o.year, m: o.month, d: o.day };
  }

  /* Which occasions fall on one Hijri day. `wd` is the Gregorian weekday
   * (0 = الأحد), because الاثنين والخميس is a weekday rule, not a calendar one. */
  function occKeysFor(hj, wd) {
    var out = [], m = hj.m, d = hj.d;
    /* ١٣ ذو الحجة is a Tashreeq day. The white-day rule must not claim a day the
     * warn rule forbids — the two would contradict each other in the same row. */
    /* And neither voluntary fast is announced inside رمضان: the whole month is an
     * obligatory fast, so «يُستحبّ صومه» there is wrong and only adds noise. */
    if ((d === 13 || d === 14 || d === 15) && m !== 9 && !(m === 12 && d === 13)) out.push('white');
    /* …nor may the weekly fast: a Monday/Thursday on an Eid or Tashreeq day is not fasted. */
    var noFast = m === 9 || (m === 10 && d === 1) || (m === 12 && d >= 10 && d <= 13);
    if ((wd === 1 || wd === 4) && !noFast) out.push('monthu');
    if (m === 1 && d === 9) out.push('tasua');
    if (m === 1 && d === 10) out.push('ashura');
    if (m === 12 && d >= 1 && d <= 9) out.push('ashr');
    if (m === 12 && d === 9) out.push('arafah');
    if (m === 10 && d >= 2 && d <= 7) out.push('shawwal6');
    if (m === 9 && d === 1) out.push('ramadan');
    if (m === 9 && d >= 21) out.push('last10');
    if (m === 8 && d === 1) out.push('shaban');
    if ((m === 1 || m === 7 || m === 11 || m === 12) && d === 1) out.push('sacred');
    if (m === 10 && d === 1) out.push('eidfitr');
    if (m === 12 && d === 10) out.push('eidadha');
    if (m === 12 && d >= 11 && d <= 13) out.push('tashreeq');
    return out;
  }

  function occScan(fromMs, days, offset, keys) {
    var out = [], base = new Date(fromMs);
    for (var i = 0; i < days; i++) {
      /* setDate arithmetic, NOT `+ i * OCC_DAY`: adding 86400000ms across a DST
       * boundary lands at 23:00 of the same day, and the Hijri date would repeat. */
      var day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      var hj = occHijri(day, offset);
      if (!hj) break;
      var ks = occKeysFor(hj, day.getDay());
      for (var j = 0; j < ks.length; j++) {
        if (!keys || keys[ks[j]]) out.push({ key: ks[j], ts: day.getTime(), hj: hj });
      }
    }
    return out;
  }

  /* Collapse consecutive days of the SAME occasion into one run. Nine notifications
   * for the nine days of ذي الحجة is not a reminder, it is a nuisance — so a run is
   * also the unit the worker schedules against, not the day. */
  function occRuns(list) {
    var by = {}, out = [];
    list.forEach(function (e) { (by[e.key] = by[e.key] || []).push(e); });
    Object.keys(by).forEach(function (k) {
      var arr = by[k].sort(function (a, b) { return a.ts - b.ts; }), run = null;
      arr.forEach(function (e) {
        /* one day apart, with an hour of slack so a DST day (23h or 25h) still joins */
        if (run && (e.ts - run.end) <= OCC_DAY + 3600000) { run.end = e.ts; run.days++; run.endHj = e.hj; return; }
        run = { key: k, ts: e.ts, end: e.ts, days: 1, hj: e.hj, endHj: e.hj };
        out.push(run);
      });
    });
    return out.sort(function (a, b) { return a.ts - b.ts; });
  }

  /* The next moment a reminder should fire: `lead` days before a run starts, at the
   * chosen wall-clock time. Returns null when nothing is enabled or nothing is due.
   * `runs` holds EVERY run that fires at that same moment (`run` is its first): two
   * occasions on one day — رمضان on a Monday with الاثنين والخميس on — used to keep the
   * first and lose the second, because the re-arm after firing skipped every run
   * whose moment had just passed. One alarm, one notification naming all of them.
   * The scan starts YESTERDAY: a season already under way then starts in the past
   * and is not re-announced as «today» on every browser start (lead 0 used to
   * repeat العشر الأواخر daily). */
  function occNextFire(s, nowMs) {
    var t = new Date(nowMs);
    var runs = occRuns(occScan(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1).getTime(), 401, s.offset, s.keys));
    var hm = /^(\d{1,2}):(\d{2})$/.exec(s.at) || [];
    var hh = hm.length ? +hm[1] : 20, mi = hm.length ? +hm[2] : 0;
    var best = null;
    for (var i = 0; i < runs.length; i++) {
      var d = new Date(runs[i].ts);
      var fire = new Date(d.getFullYear(), d.getMonth(), d.getDate() - s.lead, hh, mi, 0, 0).getTime();
      if (fire <= nowMs + 5000) continue;
      if (!best) best = { at: fire, run: runs[i], runs: [runs[i]] };
      else if (fire === best.at) best.runs.push(runs[i]);
      else break;                         /* runs are sorted by start, so fire only grows */
    }
    return best;
  }

  /* True once the LAST day of a stored run ({ts, days}) is before today — a reminder
   * delivered late (the device slept through it) must not announce «اليوم» for an
   * occasion that is already over. */
  function occRunEnded(n, nowMs) {
    var t = new Date(nowMs), e = new Date(n.ts);
    var last = new Date(e.getFullYear(), e.getMonth(), e.getDate() + Math.max(1, n.days || 1) - 1).getTime();
    return last < new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  }

  function occDef(key) {
    for (var i = 0; i < OCC_DEFS.length; i++) if (OCC_DEFS[i].key === key) return OCC_DEFS[i];
    return null;
  }
  function occHijriText(hj) { return hj ? (hj.d + ' ' + OCC_MONTHS[hj.m - 1] + ' ' + hj.y + 'هـ') : ''; }
  /* <<< /OCC-ENGINE >>> */

async function occGet() {
  const r = await chrome.storage.local.get({ occasions: null });
  return occSettings(r.occasions);
}
/* the Arabic count needs its forms — «بعد ٢ يوم» / «بعد ٥ يوم» were wrong. Same
   three as the panel's whenText/daysText. n < 0 is a run already under way (an ended
   one is never announced) — it is not «اليوم». */
function occWhen(ts) {
  const t = new Date();
  const n = Math.round((ts - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / OCC_DAY);
  if (n < 0) return wt('جارية الآن');
  if (n === 0) return wt('اليوم');
  if (n === 1) return wt('غداً');
  if (n === 2) return wt('بعد يومين');
  return n <= 10 ? wt('بعد {0} أيام', n) : wt('بعد {0} يوماً', n);
}
function occDays(n) { return n === 2 ? wt('يومان') : (n <= 10 ? wt('{0} أيام', n) : wt('{0} يوماً', n)); }
/* The engine's own occHijriText is the LAST line inside the <<< OCC-ENGINE >>>
   markers and must stay byte-identical to src/occasions.js (a test enforces it), so
   the translated form is built out here from the raw {d,m,y} — not by editing the
   sealed copy, and not by re-parsing a string we just built.
   ⚠️ The format msgid reproduces the engine's own composition exactly, so with no
   dictionary the output is byte-for-byte what it has always been: Arabic does not
   move at all, and only English diverges. */
function occHijriT(hj) {
  return hj ? wt('{0} {1} {2}هـ', hj.d, wt(OCC_MONTHS[hj.m - 1] || ''), hj.y) : '';
}
/* the stored form of one run — raw, rendered when shown (§6.99/5) */
function occItem(r) {
  const def = occDef(r.key);
  return {
    name: def ? def.name : '', type: def ? def.type : 'season',
    /* `hijri` stays the engine's own Arabic string — the tool panel reads it and
       translates on its own side; `hj` is the raw date the worker rebuilds from */
    hijri: occHijriText(r.hj), hj: r.hj, ts: r.ts, days: r.days
  };
}
/* every writer of syfs_occ_next goes through one queue: the «done» stamp of a firing
   and a reschedule landing together would otherwise put the old, fired entry back */
function occApply() { return serialize('occ', occApplyNow); }
async function occApplyNow() {
  await chrome.alarms.clear('syfs_occ');
  await wtLoad();                 /* the return value is shown in the panel */
  const s = await occGet();
  const nx = s.on ? occNextFire(s, Date.now()) : null;
  if (!nx) { await chrome.storage.local.remove('syfs_occ_next'); return null; }
  /* EVERY run due at that moment (`runs`), the first one's fields alongside for the
     readers of the older one-run shape */
  const runs = nx.runs.map(occItem);
  await chrome.storage.local.set({ syfs_occ_next: Object.assign({}, runs[0], { at: nx.at, runs }) });
  chrome.alarms.create('syfs_occ', { when: nx.at });
  return runs.map((x) => wt(x.name)).join(' · ') + ' — ' + occWhen(runs[0].ts);
}
function occNotify(n) {
  /* the warn kinds are the opposite of a nudge: they are days one must NOT fast */
  const head = (n.type === 'warn' ? '⚠️ ' : '🗓 ') + wt(n.name);
  const body = (n.hj ? occHijriT(n.hj) : n.hijri) + ' · ' + occWhen(n.ts)
    + (n.days > 1 ? ' · ' + occDays(n.days) : '')
    + (n.type === 'warn' ? ' — ' + wt('لا يُصام') : (n.type === 'fast' ? ' — ' + wt('يُستحبّ صومه') : ''));
  ikNotify(head, body);
  ikToast(head, body);
}
/* Deliver the stored reminder ONCE — from its alarm, or from the next browser start
   when Chrome was closed at that minute (a missed alarm is not always replayed, and
   the start-up reschedule used to clear the one that was). Stamped `done` BEFORE it
   is shown, so the alarm and the start-up catch-up cannot both deliver it. A run that
   is already OVER is dropped: «يوم عرفة · اليوم — يُستحبّ صومه» on the morning of the
   Eid, after a laptop slept through Friday evening, is worse than silence. */
async function occFireNow() {
  const n = (await chrome.storage.local.get({ syfs_occ_next: null })).syfs_occ_next;
  if (!n || typeof n !== 'object' || n.done || !(n.at <= Date.now() + 60000)) return;
  await chrome.storage.local.set({ syfs_occ_next: Object.assign({}, n, { done: true }) });
  if (!(await occGet()).on) return;
  await wtLoad();                                  /* cold worker → table first */
  const runs = Array.isArray(n.runs) ? n.runs : [n];
  for (const r of runs) {
    if (!r || typeof r.name !== 'string' || typeof r.ts !== 'number') continue;
    if (!occRunEnded(r, Date.now())) occNotify(r);
  }
}
chrome.alarms.onAlarm.addListener(async (a) => {
  if (!a || a.name !== 'syfs_occ') return;
  try { await serialize('occ', occFireNow); } catch (e) {}
  occApply().catch(() => {});
});
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_OCC') return;
  (async () => {
    if (msg.op === 'test') {
      /* the panel sends its UNSAVED form so the rehearsal matches what «حفظ» will do;
         it is a message from a page, so it passes the same whitelist as storage */
      const s = (msg.s && typeof msg.s === 'object') ? occSettings(msg.s) : await occGet();
      await wtLoad();
      const nx = occNextFire(Object.assign({}, s, { on: true }), Date.now());
      if (nx) nx.runs.forEach((r) => occNotify(occItem(r)));
      else ikNotify('🗓 ' + wt('المناسبات'), wt('لا مناسبة مفعّلة قادمة'));
      sendResponse({ ok: true });
      return;
    }
    if (msg.op === 'apply') { const next = await occApply(); sendResponse({ ok: true, next: next || undefined }); return; }
    sendResponse({ ok: false, error: 'bad-op' });
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});
chrome.runtime.onInstalled.addListener(() => { occApply().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => {
  serialize('occ', occFireNow).catch(() => {}).then(() => occApply()).catch(() => {});
});
/* an imported settings file writes `occasions` directly and sends no apply */
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch && ch.occasions) occApply().catch(() => {});
});

/* ===== التقويم — جدولة تذكيرات الأيام (spec: specs/calendar-tasks.md) =====
 * The same shape as occApply above, and deliberately so: ONE rolling alarm to the
 * next due reminder, a mirror of it in storage so a cold worker can fire without
 * rescanning, and a re-arm after every firing.
 *
 * WHY THE PANEL SENDS NO MESSAGE. src/calendar.js writes `cal_days` and stops
 * there; this listens to storage instead. The tool runs on six surfaces (the
 * content script plus app/sheet/word/slides/mail.html) and an arming message is a
 * line each of them has to remember — storage.onChanged is one path that cannot be
 * forgotten by the sixth. It is also a worker wake-up event, so the worker does not
 * have to be alive when the user adds a reminder. */
const CAL_ALARM = 'syfs_cal', CAL_NEXT = 'syfs_cal_next';
const CAL_MISS_MS = 12 * 3600 * 1000;        /* how far back a catch-up looks */
let calBusy = false, calDirty = false;

function calPrefs(p) {
  p = (p && typeof p === 'object') ? p : {};
  return { at: /^([01]\d|2[0-3]):([0-5]\d)$/.test(p.at) ? p.at : '09:00' };
}
/* the instant a reminder should be shown: its day at its time (or the all-day
   hour), minus its lead. Local time throughout — the key is a LOCAL date. */
function calFireAt(key, ev, defAt) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  const t = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(ev.at || defAt);
  if (!d || !t) return 0;
  const lead = Math.max(0, Math.min(10080, parseInt(ev.lead, 10) || 0));
  return new Date(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], 0, 0).getTime() - lead * 60000;
}
function calScan(days, prefs) {
  const out = [];
  if (!days || typeof days !== 'object') return out;
  Object.keys(days).forEach((k) => {
    const rec = days[k];
    if (!rec || !Array.isArray(rec.e)) return;
    rec.e.forEach((ev) => {
      if (!ev || !ev.on || ev.f) return;
      const at = calFireAt(k, ev, prefs.at);
      /* the title is the USER's text: carried verbatim, never through wt() */
      if (at) out.push({ k, i: ev.i, x: String(ev.x || '').slice(0, 80), at, hm: ev.at || prefs.at });
    });
  });
  return out.sort((a, b) => a.at - b.at);
}
/* stamp the fired ones so they cannot come round again. Re-reads storage rather
   than trusting a copy: the panel may have saved an edit while the alarm slept. */
function calMarkFired(list) {
  if (!list.length) return Promise.resolve();
  return serialize('cal_days', () => calMarkFiredNow(list));
}
async function calMarkFiredNow(list) {
  const r = await chrome.storage.local.get({ cal_days: null });
  const days = (r.cal_days && typeof r.cal_days === 'object') ? r.cal_days : null;
  if (!days) return;
  let touched = false;
  list.forEach((n) => {
    const rec = days[n.k];
    if (!rec || !Array.isArray(rec.e)) return;
    rec.e.forEach((ev) => { if (ev && ev.i === n.i && !ev.f) { ev.f = 1; touched = true; } });
  });
  if (touched) await chrome.storage.local.set({ cal_days: days });
}
async function calApply() {
  /* marking a reminder fired WRITES cal_days, which wakes the same listener that
     called us — the flag collapses that into one more pass instead of a stack */
  if (calBusy) { calDirty = true; return; }
  calBusy = true;
  try {
    do {
      calDirty = false;
      await chrome.alarms.clear(CAL_ALARM);
      const r = await chrome.storage.local.get({ cal_days: null, cal_prefs: null });
      const list = calScan(r.cal_days, calPrefs(r.cal_prefs));
      const now = Date.now();
      const next = list.find((e) => e.at > now - 60000);   /* a minute of slack for a late wake-up */
      if (!next) { await chrome.storage.local.remove(CAL_NEXT); continue; }
      await chrome.storage.local.set({ [CAL_NEXT]: next });
      chrome.alarms.create(CAL_ALARM, { when: Math.max(next.at, now + 1000) });
    } while (calDirty);
  } finally { calBusy = false; }
}
function calNotify(n, missed) {
  /* ⛔ n.x is the user's own title — it is placed, never translated. Only the frame
     around it is a msgid. */
  const head = (missed ? '⏰ ' : '🗓 ') + (n.x || wt('تذكير'));
  const body = missed
    ? wt('فات موعده — {0}', calWhen(n))
    : calWhen(n);
  ikNotify(head, body);
  ikToast(head, body);
}
function calWhen(n) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(n.k || '');
  const t = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(n.hm || '');
  if (!d) return '';
  const when = new Date(+d[1], +d[2] - 1, +d[3], t ? +t[1] : 0, t ? +t[2] : 0);
  try {
    /* ⚠️ the date is LOCALE OUTPUT — the dictionary cannot reach a month name or a
       digit set (§6.101/6), so it is formatted, not translated */
    return new Intl.DateTimeFormat(wtLocale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(when)
      + (t ? ' · ' + new Intl.DateTimeFormat(wtLocale(), { hour: 'numeric', minute: '2-digit' }).format(when) : '');
  } catch (e) { return n.k; }
}
/* Chrome cannot fire an alarm while it is closed — no extension can, and silence
   here would read exactly like a broken reminder. So on startup anything that came
   due in the last 12 hours is delivered late and labelled late. Bounded: more than
   three becomes one line, because fifteen notifications at once is worse than the
   silence it replaces. */
async function calCatchUp() {
  await wtLoad();
  const r = await chrome.storage.local.get({ cal_days: null, cal_prefs: null });
  const now = Date.now();
  const due = calScan(r.cal_days, calPrefs(r.cal_prefs))
    .filter((e) => e.at <= now && e.at > now - CAL_MISS_MS);
  if (!due.length) return;
  await calMarkFired(due);
  if (due.length <= 3) due.forEach((e) => calNotify(e, true));
  else ikNotify('⏰ ' + wt('تذكيرات فائتة'), wt('{0} تذكيرات فاتت أثناء إغلاق المتصفّح', due.length));
}
chrome.alarms.onAlarm.addListener(async (a) => {
  if (!a || a.name !== CAL_ALARM) return;
  await wtLoad();                                   /* cold worker → table before the first string (§6.99/3) */
  const st = await chrome.storage.local.get({ [CAL_NEXT]: null });
  const n = st[CAL_NEXT];
  if (n) { await calMarkFired([n]); calNotify(n, false); }
  calApply().catch(() => {});
});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local' || !ch) return;
  if (ch.cal_days || ch.cal_prefs) calApply().catch(() => {});
});
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_CAL') return;
  (async () => {
    if (msg.op === 'test') {
      await wtLoad();
      const r = await chrome.storage.local.get({ cal_days: null, cal_prefs: null });
      const list = calScan(r.cal_days, calPrefs(r.cal_prefs));
      const now = Date.now();
      const next = list.find((e) => e.at > now);
      if (next) calNotify(next, false);
      else {
        const t = new Date();
        calNotify({ x: '', k: `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`, hm: '' }, false);
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg.op === 'apply') { await calApply(); sendResponse({ ok: true }); return; }
    sendResponse({ ok: false, error: 'bad-op' });
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});
chrome.runtime.onInstalled.addListener(() => { calApply().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { calCatchUp().then(() => calApply()).catch(() => {}); });

/* ===== مشغّل القرآن — the playback brain (offscreen.html is only its speaker) =====
 * Everything that decides anything lives here: which surah is loaded, what plays
 * next, whether a surah repeats. The offscreen document holds the <audio> and can
 * be torn down by the browser at any moment, so it must never be the only place a
 * piece of state exists. The catalogue (241 reciters) comes from mp3quran.net
 * through the SYFS_FETCH relay above; the audio itself does NOT — it is played
 * straight from the server the catalogue names. */

/* Reject, do not clean. A server base that is not plain https on mp3quran.net is
 * refused outright — this string arrives from a remote API, and the one thing it
 * must never be able to do is point the player somewhere else. */
function qSafeServer(base) {
  let u;
  try { u = new URL(String(base || '')); } catch (e) { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.hostname !== 'mp3quran.net' && !u.hostname.endsWith('.mp3quran.net')) return null;
  if (u.search || u.hash) return null;
  return u.origin + u.pathname.replace(/\/?$/, '/');
}
/* an INTEGER 1..114 — a range test alone let 2.5 through: «…/2.5.mp3» was loaded, 2.5
   stored, and «التالية» jumped to Al-Fatiha because indexOf(2.5) found nothing */
function qSurahOk(n) { return Number.isInteger(n) && n >= 1 && n <= 114; }
function qUrl(server, surah) {
  const n = Number(surah);
  if (!qSurahOk(n)) return null;                       // integer range, checked before use
  const s = qSafeServer(server);
  return s ? (s + String(n).padStart(3, '0') + '.mp3') : null;
}

/* `list` is the playlist — an ORDERED run of surah numbers — and `li` is where in
 * it we currently are, or -1 for "playing a loose surah, not the list". The pair
 * lives here rather than in the tool window for the same reason the audio does:
 * next/prev and end-of-surah are decided while the window is closed. */
const Q_DEFAULTS = { rid: 0, mid: 0, server: '', surah: 1, rate: 1, vol: 1, auto: true, repeat: false, rname: '', mname: '', avail: [], pos: 0, list: [], li: -1, radio: '', rdname: '', rdid: '' };
/* ===== إذاعة القرآن — live streams, two sources, two locks ======================
 * Built-in stations are REAL broadcasts (verified 2026-09-21), keyed by id: the
 * window asks for «sa», never for a URL — the same rule qSafeServer enforces for
 * surahs. The mp3quran radio catalogue (reciters on a loop, all on qurango.net)
 * is the other source, and those URLs DO arrive as strings from the window, so
 * they pass qSafeStream, which admits qurango.net alone — reject, never repair.
 * radiojar answers with a 302 to a tokened http:// edge; Chrome upgrades mixed-
 * content media to https and the edge serves it. A live stream has no duration,
 * so `radio` (the URL, '' = none) is what tells next/prev/seek/end-of-surah that
 * none of them apply. `rdname` is only carried so a reopened window can label
 * what is playing — painted with textContent, like rname. */
const Q_STATIONS = {
  sa: { url: 'https://stream.radiojar.com/0tpy1h0kxtzuv' },                 /* الرياض */
  eg: { url: 'https://stream.radiojar.com/8s5u5tpdtwzuv' },                 /* القاهرة */
  mk: { url: 'https://r7.tarat.com:8004/stream?type=http&nocache=114' }     /* الحرم المكي */
};
function qSafeStream(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch (e) { return null; }
  if (u.protocol !== 'https:' || u.search || u.hash || u.username || u.port) return null;
  if (u.hostname !== 'qurango.net' && !u.hostname.endsWith('.qurango.net')) return null;
  return u.origin + u.pathname;
}
/* Reciters the user asked to hide (v0.140.1) — the same list as HIDDEN in
 * src/quran.js, which drops them from the catalogue and the radio rows. Here it
 * covers what the window cannot: a stored surah/station from before the list,
 * and a message that names one anyway. */
function qHidden(s) {
  const n = String(s || '').replace(/[ً-ْٰـ\s]/g, '').replace(/ى/g, 'ي');
  return /مشاري|عفاسي|mishar|afas/i.test(n);
}
function qKnownStream(url) {
  return Object.keys(Q_STATIONS).some((k) => Q_STATIONS[k].url === url) || !!qSafeStream(url);
}
/* the window's request → {url, name} or null. An id wins over a url: a message
   carrying both is asking for the built-in station, whatever else it says. */
function qStreamOf(msg) {
  const name = String(msg.name || '').slice(0, 120);
  const id = String(msg.id || '');
  if (qHidden(name) || qHidden(msg.url)) return null;
  if (Object.prototype.hasOwnProperty.call(Q_STATIONS, id)) return { url: Q_STATIONS[id].url, name, id };
  const url = qSafeStream(msg.url);
  return url ? { url, name, id: '' } : null;
}
let qRadioRetry = 0;
/* A playlist longer than the mushaf is not a playlist, it is a bug or an attack.
 * Duplicates are refused too — one surah twice in a queue has no meaning here. */
const Q_LIST_MAX = 114;
function qCleanList(v) {
  if (!Array.isArray(v)) return [];
  const out = [], seen = new Set();
  for (const raw of v) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 114 || seen.has(n)) continue;
    seen.add(n); out.push(n);
    if (out.length >= Q_LIST_MAX) break;
  }
  return out;
}
/* Sleep timer. The minutes come from the tool window, so they are checked against
 * a WHITELIST here rather than range-clamped there: a player that accepts any
 * number from the page is a player whose alarm schedule the page decides. */
const Q_SLEEP_MIN = [15, 30, 45, 60];
const Q_SLEEP_ALARM = 'syfs_qsleep';
let qState = Object.assign({}, Q_DEFAULTS);
let qLive = { playing: false, pos: 0, dur: 0, buf: 0, loading: false, error: 0 };
let qCloseWhenIdle = false;   /* see qStopAll — a close deferred until the clip channel ends */
/* sleepAt = epoch ms the alarm fires · sleepEnd = stop when THIS surah finishes.
 * Deliberately NOT persisted: a timer that survives a browser restart would stop
 * a recitation the user started hours later, for a reason they cannot see. */
let qSleep = { at: 0, end: false };
let qLoaded = false, qMaking = null, qTick = 0;

async function qLoad() {
  if (qLoaded) return;
  const r = await chrome.storage.local.get({ quran: null });
  const v = r.quran;
  if (v && typeof v === 'object') {
    qState = Object.assign({}, Q_DEFAULTS, v);
    qState.surah = (qState.surah >= 1 && qState.surah <= 114) ? Math.round(qState.surah) : 1;
    qState.rate = (qState.rate >= 0.5 && qState.rate <= 2) ? qState.rate : 1;
    qState.vol = (qState.vol >= 0 && qState.vol <= 1) ? qState.vol : 1;
    qState.avail = Array.isArray(qState.avail) ? qState.avail.filter(qSurahOk) : [];
    /* storage is not trusted just because we wrote it: the playlist is re-cleaned
       on the way in, and an index that no longer addresses a row is dropped */
    qState.list = qCleanList(qState.list);
    qState.li = (Number.isInteger(qState.li) && qState.li >= 0 && qState.li < qState.list.length) ? qState.li : -1;
    qState.server = qSafeServer(qState.server) || '';   // a stored server is re-validated too
    /* a stored stream is re-checked against the same two locks as a fresh one */
    qState.radio = (typeof qState.radio === 'string' && qKnownStream(qState.radio)) ? qState.radio : '';
    qState.rdname = qState.radio ? String(qState.rdname || '').slice(0, 120) : '';
    qState.rdid = (qState.radio && Object.prototype.hasOwnProperty.call(Q_STATIONS, String(qState.rdid || ''))) ? String(qState.rdid) : '';
    /* a hidden reciter saved before the list existed is forgotten, not resumed */
    if (qHidden(qState.rname)) Object.assign(qState, { rid: 0, mid: 0, server: '', rname: '', mname: '', avail: [], pos: 0 });
    if (qState.radio && (qHidden(qState.rdname) || qHidden(qState.radio))) Object.assign(qState, { radio: '', rdname: '', rdid: '' });
  }
  qLive.pos = qState.pos || 0;
  /* The alarm outlives this worker — Chrome owns it, we only asked for it. So on
     a worker restart the countdown is read back from the alarm itself; otherwise
     the window would show no timer while one was still armed and about to fire.
     (`end` cannot be recovered: it is a flag, not an alarm, and it dies here.) */
  try {
    const al = await chrome.alarms.get(Q_SLEEP_ALARM);
    if (al && al.scheduledTime > Date.now()) qSleep.at = al.scheduledTime;
  } catch (e) {}
  qLoaded = true;
}
/* ...and a browser restart clears it outright. A sleep timer that survives the
   browser would stop a recitation started hours later, for a reason the user has
   no way to see — the timer is a "stop soon", not a standing instruction. */
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.clear(Q_SLEEP_ALARM).catch(() => {});
});
function qSave() { return chrome.storage.local.set({ quran: qState }).catch(() => {}); }

async function qEnsure() {
  /* one create at a time: two concurrent calls would race and the second throws */
  if (qMaking) return qMaking;
  qMaking = (async () => {
    try {
      if (await chrome.offscreen.hasDocument()) return true;
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'تشغيل تلاوة القرآن باستقلال عن الصفحة المفتوحة'
      });
      return true;
    } catch (e) {
      return (String(e).indexOf('Only a single offscreen') >= 0);   // already there
    } finally { qMaking = null; }
  })();
  return qMaking;
}
function qSend(op, extra) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(Object.assign({ target: 'syf-offscreen', op }, extra || {}), (r) => {
        void chrome.runtime.lastError;
        resolve(r || null);
      });
    } catch (e) { resolve(null); }
  });
}
/* `li` is the playlist row this playback came from, or -1/undefined for a loose
 * surah. It is what makes next/prev follow the queue instead of the mushaf. */
async function qPlay(surah, li, at) {
  await qLoad();
  const url = qUrl(qState.server, surah);
  if (!url) return { ok: false, error: 'no-source' };
  /* ⚠️ «استئناف»: نقطة العودة تُمرَّر مع أمر التحميل نفسه، لا كـseek بعده. هذه الدالة
     تصفّر `pos` وتحفظه، فأي قارئ للنقطة بعدها يقرأ صفراً — ولهذا يلتقطها المُنادي
     قبل النداء ويسلّمها هنا. و`seek` منفصل يسابق التحميل: عنصر بلا duration يبتلع
     أي currentTime، فتضيع النقطة وتبدأ التلاوة من ٠:٠٠ في كل مرّة. */
  const start = (typeof at === 'number' && isFinite(at) && at > 1) ? at : 0;
  qState.surah = Number(surah);
  qState.li = (Number.isInteger(li) && li >= 0 && li < qState.list.length) ? li : -1;
  qState.pos = start;
  qState.radio = ''; qState.rdname = ''; qState.rdid = '';
  qLive = { playing: true, pos: start, dur: 0, buf: 0, loading: true, error: 0 };
  qCloseWhenIdle = false;
  await qEnsure();
  await qSend('load', { url, rate: qState.rate, vol: qState.vol, start });
  qSave();
  return { ok: true };
}
/* The radio. Rate is pinned to 1: a live stream played at 1.5× drains its buffer
 * and stalls, and the stored rate stays the user's for the next surah. The surah
 * resume point (`pos`) is left alone too — switching to the radio and back must
 * land where the recitation stopped, not at 0:00. */
async function qRadio(url, name, id) {
  await qLoad();
  qState.radio = url; qState.rdname = name || ''; qState.rdid = id || '';
  qSleep.end = false;           /* «نهاية السورة» has no surah to end on a stream */
  qLive = { playing: true, pos: 0, dur: 0, buf: 0, loading: true, error: 0 };
  qCloseWhenIdle = false;
  await qEnsure();
  await qSend('load', { url, rate: 1, vol: qState.vol, live: true });   /* live ⇒ the stall watchdog */
  qSave();
  return { ok: true };
}
/* A stream that ENDS did not end — it dropped. Reconnect, a few times, with a
 * pause between; a surah that ends advances instead. Bounded, and reset by the
 * first `playing` event, so a dead edge gives up after three tries rather than
 * hammering it forever from a worker that nobody can see. */
async function qEnded() {
  await qLoad();
  if (!qState.radio) return qAdvance();
  if (qRadioRetry >= 3) { qLive.playing = false; qLive.error = 1; return { ok: false, error: 'radio-down' }; }
  const n = ++qRadioRetry;
  await new Promise((r) => setTimeout(r, 2500));
  /* stopped, or reconnected by hand, while we waited: nothing left to do */
  if (!qState.radio || qRadioRetry !== n) return { ok: true };
  return qRadio(qState.radio, qState.rdname, qState.rdid);
}

/* ---- sleep timer ---------------------------------------------------------
 * It lives here and not in the tool window for the same reason the audio does:
 * the window is closed most of the time this timer is running. */
async function qSleepSet(min, end) {
  await chrome.alarms.clear(Q_SLEEP_ALARM);
  qSleep = { at: 0, end: false };
  if (end) { qSleep.end = true; return; }
  if (!Q_SLEEP_MIN.includes(min)) return;                 /* whitelist, not a clamp */
  qSleep.at = Date.now() + min * 60000;
  chrome.alarms.create(Q_SLEEP_ALARM, { when: qSleep.at });
}
/* ⚠️ the offscreen document is shared: the clip channel (a dhikr, the wird's ayahs)
   plays on its own element there. Stopping the Quran used to close the document
   and cut the dhikr mid-word (v0.139.3). While a clip plays, only the Quran element
   stops; the document closes when the clip queue reports its end. */
async function qStopAll() {
  /* READ before writing: the sleep alarm wakes a cold worker whose qState is still
     Q_DEFAULTS, and the save below then wiped the reciter, server, playlist, rate and
     volume (the warning at SYFS_QSTATE, met from the other side) */
  await qLoad();
  qRadioRetry = 99;                 /* a reconnect in flight must not outlive the stop */
  const r = await qSend('stop');
  qLive = { playing: false, pos: 0, dur: 0, buf: 0, loading: false, error: 0 };
  /* «إيقاف تام» ends the radio too: left set, the Quran window stayed in radio mode
     (next/prev/rate disabled) and Space reconnected the stream instead of the surah */
  qState.pos = 0; qState.radio = ''; qState.rdname = ''; qState.rdid = ''; qSave();
  await chrome.alarms.clear(Q_SLEEP_ALARM);
  qSleep = { at: 0, end: false };
  if (r && r.clip) { qCloseWhenIdle = true; return; }
  qCloseWhenIdle = false;
  try { await chrome.offscreen.closeDocument(); } catch (e) {}
}
chrome.alarms.onAlarm.addListener((a) => {
  if (!a || a.name !== Q_SLEEP_ALARM) return;
  qStopAll().catch(() => {});
});
/* Where does «التالية» go? Two different answers, and which one applies is a
 * property of how the CURRENT surah started playing, not a mode the user sets:
 *   · started from the playlist (li >= 0) → the next ROW of the playlist;
 *   · started loose                       → the next surah of the mushaf.
 * Either way, a surah this reciter does not carry is SKIPPED rather than played
 * into a silent 404 — a partial moshaf is normal, not an error.
 * Returns {surah, li} or null at the edge (stop; never wrap). */
function qStep(dir) {
  const av = (qState.avail && qState.avail.length) ? qState.avail : null;
  const has = (n) => !av || av.indexOf(n) >= 0;
  if (qState.li >= 0 && qState.list.length) {
    for (let j = qState.li + dir; j >= 0 && j < qState.list.length; j += dir) {
      if (has(qState.list[j])) return { surah: qState.list[j], li: j };
    }
    return null;                                   // end of the queue
  }
  const list = av ? av.slice().sort((a, b) => a - b)
                  : Array.from({ length: 114 }, (_, i) => i + 1);
  const i = list.indexOf(qState.surah);
  if (i < 0) return { surah: list[0], li: -1 };
  const j = i + dir;
  return (j < 0 || j >= list.length) ? null : { surah: list[j], li: -1 };
}
async function qAdvance() {
  await qLoad();
  /* «نهاية السورة» outranks repeat AND auto: the user asked for this surah to be
     the last thing they hear, so it must not loop and must not step forward. */
  if (qSleep.end) { qSleep.end = false; qLive.playing = false; qState.pos = 0; qSave(); return { ok: true }; }
  /* repeat is per-surah and stays that way inside a playlist: someone repeating
     a surah wants THAT surah, and a queue does not change what they asked for */
  if (qState.repeat) return qPlay(qState.surah, qState.li);
  const n = qState.auto ? qStep(1) : null;
  /* stopping at the end (auto off, or the edge of the mushaf/queue — never wrap): the
     resume point goes back to 0:00. The `pause` that precedes `ended` had saved the
     full duration, and «استئناف» then loaded the surah only to end it at once. */
  if (!n) { qLive.playing = false; qState.pos = 0; qSave(); return { ok: true }; }
  return qPlay(n.surah, n.li);
}

onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_QSTATE') return;
  qLive.playing = !!msg.playing;
  qLive.pos = msg.pos || 0;
  qLive.dur = msg.dur || 0;
  qLive.buf = msg.buf || 0;
  qLive.loading = !!msg.loading;
  if (msg.evt === 'error') qLive.error = msg.code || 1; else if (msg.evt === 'playing') { qLive.error = 0; qRadioRetry = 0; }
  if (msg.evt === 'ended') { qEnded().catch(() => {}); return; }
  /* a broken stream reports `error`, not `ended` — same answer, same bound. Read
     before deciding (qLoad only READS, the warning below is about writing). */
  /* `stall` (offscreen's watchdog): a live stream that stopped moving with neither —
     Wi-Fi gone without the TCP close — used to spin «جارٍ الاتصال» forever */
  if (msg.evt === 'error' || msg.evt === 'stall') { qLoad().then(() => (qState.radio ? qEnded() : null)).catch(() => {}); return; }
  /* ⚠️ عاملٌ بارد لا يعرف شيئاً — وصفحة offscreen تعمّر أطول منه، فتصله نبضاتها
     و`qState` ما زال `Q_DEFAULTS`. كاتبٌ لم يقرأ هو الطريق الذي يُمحى به تفضيل
     المستخدم: حفظٌ هنا قبل `qLoad()` يمسح القارئ والخادم والقائمة، فتُجيب كل تشغيلة
     بعده بـ'no-source'. `qLive` وحده يُحدَّث — لقطة حيّة لا تفضيلاً محفوظاً. */
  if (!qLoaded || qState.radio) return;        /* a live stream has no resume point */
  /* the resume point is persisted on the events that matter and about once every
     ~15s of playback — writing storage on every timeupdate would be 4 writes/sec */
  if (msg.evt === 'pause' || msg.evt === 'loadedmetadata' || (msg.evt === 'timeupdate' && (++qTick % 60 === 0))) {
    /* a pause AT the end is the one before `ended` — no point to resume from */
    qState.pos = (qLive.dur && qLive.pos >= qLive.dur - 1) ? 0 : qLive.pos; qSave();
  }
});

onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_QURAN') return;
  (async () => {
    await qLoad();
    switch (msg.op) {
      case 'state':
        /* the sleep timer is reported as a REMAINING count, not as the absolute
           moment it fires: the window would otherwise have to trust its own clock
           to be the same as the worker's, and it is not always. */
        sendResponse({
          ok: true, s: qState, live: qLive,
          sleep: { left: qSleep.at ? Math.max(0, qSleep.at - Date.now()) : 0, end: qSleep.end }
        });
        return;
      case 'play': {
        const srv = qSafeServer(msg.server);
        if (!srv) { sendResponse({ ok: false, error: 'bad-server' }); return; }
        if (qHidden(msg.rname)) { sendResponse({ ok: false, error: 'hidden' }); return; }
        /* checked BEFORE the reciter fields change — a refused surah leaves no trace */
        const surah = Number(msg.surah);
        if (!qSurahOk(surah)) { sendResponse({ ok: false, error: 'bad-surah' }); return; }
        qState.server = srv;
        qState.rid = Number(msg.rid) || 0;
        qState.mid = Number(msg.mid) || 0;
        /* names are shown to the user by the TOOL via textContent; they are carried
           here only so a reopened window can label what is already playing */
        qState.rname = String(msg.rname || '').slice(0, 120);
        qState.mname = String(msg.mname || '').slice(0, 120);
        qState.avail = Array.isArray(msg.avail) ? msg.avail.map(Number).filter(qSurahOk) : [];
        sendResponse(await qPlay(surah, msg.li));
        return;
      }
      /* The playlist is REPLACED wholesale, never patched: reorder, delete and
         append are all "here is the new order", so there is one code path and no
         index arithmetic split across two processes. */
      case 'setlist': {
        qState.list = qCleanList(msg.list);
        /* keep pointing at the same SURAH after an edit, not the same row number —
           deleting a row above the current one would otherwise skip a surah */
        qState.li = (qState.li >= 0) ? qState.list.indexOf(qState.surah) : -1;
        qSave();
        sendResponse({ ok: true, s: qState });
        return;
      }
      case 'radio': {
        const st = qStreamOf(msg);
        if (!st) { sendResponse({ ok: false, error: 'bad-station' }); return; }
        qRadioRetry = 0;
        sendResponse(await qRadio(st.url, st.name, st.id));
        return;
      }
      /* no qEnsure() up front: before any reciter or station was chosen, Space created a
         silent AUDIO_PLAYBACK document for nothing. qRadio/qPlay create it when needed,
         and a 'state' query with no document simply gets no answer. */
      case 'toggle':
        if (qLive.playing) { await qSend('pause'); qLive.playing = false; }
        /* a paused live stream is stale audio: resuming means reconnecting, and
           «what plays on toggle» is whatever played LAST — the radio wins here
           only because it set the flag after the surah did */
        else if (qState.radio) { qRadioRetry = 0; await qRadio(qState.radio, qState.rdname, qState.rdid); }
        else if (qState.server) {
          /* nothing loaded in this offscreen document (it may have been torn down) →
             load the remembered surah and resume where it stopped */
          let at = qState.pos;                   /* تُلتقط قبل qPlay — هي من تصفّرها */
          if (qLive.dur && at >= qLive.dur - 2) at = 0;   /* a point at the very end is no resume */
          const r = await qSend('state');
          if (!r || !r.dur) { await qPlay(qState.surah, qState.li, at); }
          else { await qSend('play'); }
          qLive.playing = true;
        }
        sendResponse({ ok: true, live: qLive });
        return;
      case 'next': case 'prev': {
        if (qState.radio) { sendResponse({ ok: false, error: 'radio' }); return; }
        const n = qStep(msg.op === 'next' ? 1 : -1);
        if (!n) { sendResponse({ ok: false, error: 'edge' }); return; }
        sendResponse(await qPlay(n.surah, n.li));
        return;
      }
      case 'seek':
        await qSend('seek', { t: Number(msg.t) || 0 });
        sendResponse({ ok: true });
        return;
      case 'rate': {
        const r = Number(msg.r);
        if (!(r >= 0.5 && r <= 2)) { sendResponse({ ok: false, error: 'range' }); return; }
        qState.rate = r; qSave();
        if (!qState.radio) await qSend('rate', { r });   /* stored for the next surah; the stream stays at 1× */
        sendResponse({ ok: true });
        return;
      }
      case 'vol': {
        const v = Number(msg.v);
        if (!(v >= 0 && v <= 1)) { sendResponse({ ok: false, error: 'range' }); return; }
        qState.vol = v; qSave();
        /* no qEnsure(): with nothing playing there is no document to talk to, and
           creating one just to set a volume would spawn a silent audio host */
        await qSend('vol', { v });
        sendResponse({ ok: true });
        return;
      }
      case 'sleep':
        /* «نهاية السورة» on a live stream never fired, then stopped the first surah
           played later in the session for no visible reason */
        if (msg.end === true && qState.radio) { sendResponse({ ok: false, error: 'radio' }); return; }
        await qSleepSet(Number(msg.min) || 0, msg.end === true);
        sendResponse({ ok: true, sleep: { left: qSleep.at ? Math.max(0, qSleep.at - Date.now()) : 0, end: qSleep.end } });
        return;
      case 'set':
        if (typeof msg.auto === 'boolean') qState.auto = msg.auto;
        if (typeof msg.repeat === 'boolean') qState.repeat = msg.repeat;
        qSave();
        sendResponse({ ok: true, s: qState });
        return;
      case 'stop':
        await qStopAll();
        sendResponse({ ok: true });
        return;
      default:
        sendResponse({ ok: false, error: 'bad-op' });
    }
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});
/* ===== نشاط الجلسة — which tools have been opened since the browser started ====
 * The rail's category hover panel asks one question: which tools in THIS category
 * has the user reached for this session? The answer cannot live in the page — a
 * content script's memory dies on every navigation, and "this session" spans tabs
 * — so it lives here, in chrome.storage.session: memory-only, gone when Chrome
 * closes (which is exactly what "الجلسة" means), and invisible to content scripts
 * because we never call setAccessLevel(). Going through a message is the point,
 * not a detour around it.
 *
 * The worker holds no tool table, so it cannot know whether an id names a real
 * tool. It checks the SHAPE instead, and the rail then renders only the ids it can
 * find in its own registry — two whitelists, neither trusting the other's input.
 * Only tool ids are ever recorded: no URL, no page, no title, nothing about where
 * the user was when they opened it. */
const ACT_KEY = 'syfs_used';
const ACT_MAX = 60;
const ACT_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
async function actList() {
  try {
    const st = await chrome.storage.session.get({ [ACT_KEY]: [] });
    const v = st[ACT_KEY];
    if (!Array.isArray(v)) return [];
    /* cleaned again on the way OUT — something we wrote is not trusted for having
       been written by us, and a shape left over from an older build must not reach
       the page */
    return v.filter((e) => e && ACT_ID.test(String(e.id || ''))).slice(0, ACT_MAX);
  } catch (e) { return []; }
}
async function actNote(id) {
  const key = String(id || '');
  if (!ACT_ID.test(key)) return;
  /* two tools opened in two tabs at once: each would write its own list over the other's */
  await serialize('act', async () => {
    const prev = await actList();
    const out = [{ id: key, at: Date.now() }];
    for (const e of prev) if (e.id !== key && out.length < ACT_MAX) out.push(e);   /* newest first, one entry per tool */
    try { await chrome.storage.session.set({ [ACT_KEY]: out }); } catch (e) {}
  });
}
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_ACT') return;
  (async () => {
    if (msg.op === 'note') { await actNote(msg.id); sendResponse({ ok: true }); return; }
    /* the Quran's live flag rides along so ONE round trip tells the rail whether
       this hover belongs to the recitation transport instead of the block panel */
    sendResponse({
      ok: true, used: await actList(),
      q: { live: !!(qLive.playing || qLive.loading || qLive.dur > 0) }
    });
  })().catch(() => sendResponse({ ok: false }));
  return true; // async sendResponse
});

/* ===== first install: the interface language (v0.90.0) =====================
 * Two halves of one answer, and they only work together:
 *   · a GUESS from the browser, so someone whose Chrome is not Arabic is not met
 *     with an Arabic rail before they can find the setting that changes it, and
 *   · a QUESTION on first run (`askLang` in src/rail.js), because a guess nobody
 *     can correct is just a wrong default with extra steps.
 * v0.88.0 rejected the guess on its own, and for a reason that still stands: an
 * Arabic user whose Chrome happens to be English would get an English rail. It
 * is safe now only because the card that asks is bilingual and shows itself.
 *
 * ⚠️ The browser's language string NEVER becomes the stored value. It only picks
 * between the two literals below. `ui_lang` ends up in a `dir` attribute and in
 * an `i18n/<lang>.json` path, so nothing from outside may flow into it.
 *
 * ⚠️ The key names 'ui_lang' / 'ui_lang_ask' are also written in src/i18n.js and
 * src/rail.js — the worker cannot import them (different world). A test asserts
 * all three spell them the same; drift here would silently ask forever.
 *
 * Arabic wins if it appears ANYWHERE in the browser's languages: an Arabic
 * speaker running an English Chrome still lists `ar` among the languages they
 * read, while an English-only browser never lists it at all. The asymmetry is
 * the point — the audience is Arabic, so Arabic gets the benefit of the doubt. */
async function guessUiLang() {
  const seen = [];
  try { seen.push(String(chrome.i18n.getUILanguage() || '')); } catch (e) {}
  try {
    const list = await chrome.i18n.getAcceptLanguages();
    (list || []).forEach((l) => seen.push(String(l || '')));
  } catch (e) {}
  return seen.some((l) => /^ar(-|$)/i.test(l.trim())) ? 'ar' : 'en';
}

/* first install → guess the language, then open the onboarding + settings page */
chrome.runtime.onInstalled.addListener((details) => {
  if (!details || details.reason !== 'install') return;
  /* deliberately NOT on 'update': an existing user keeps the language they have
     and is never asked about it — a settings panel that reopens a question the
     user already answered is a settings panel that does not trust its own store. */
  (async () => {
    /* `install` also fires when the extension is added back over a profile that
       still holds its storage. A stored value is a decision, not a leftover. */
    const cur = await chrome.storage.local.get(['ui_lang']);
    const stored = (cur && typeof cur.ui_lang === 'string' && cur.ui_lang) ? cur.ui_lang : '';
    const lang = stored || await guessUiLang();
    if (!stored) await chrome.storage.local.set({ ui_lang: lang, ui_lang_ask: true });
    return lang;
  })().catch(() => '').then((lang) => {
    /* ⚠️ The guide is two pages, not one translated page (§6.100), so the FIRST thing a
       new user sees has to be picked here — and from the answer this listener already
       computed, not from a second storage read that could disagree with it.
       The tab now waits on that answer instead of opening in parallel: one storage
       read of latency against opening the Arabic guide for an English guess.
       `=== 'en'` is a whitelist, not a comparison — this value builds a resource path. */
    const page = (lang === 'en') ? 'help-en.html' : 'help.html';
    chrome.tabs.create({ url: chrome.runtime.getURL(page + '#start') }).catch(() => {});
  });
});

/* ===== وضع التطبيق — App Mode (app.html) =====
 * The rail button and the `appmode` hotkey tool (SYFS.openApp, src/registry.js) send
 * SYFS_OPEN_APP; the workspace dock's «نافذة مستقلّة» sends it with mode:'window'.
 * ONE workspace at a time: whatever is already open — the standalone popup window
 * first, then the tab — is focused instead of opening a copy. Each copy is a whole
 * second workspace with its own windows, and a double click used to make two (the
 * window was never deduplicated). The ids live in chrome.storage.session
 * (memory-only, worker-scoped — we never call setAccessLevel, so it stays hidden from
 * content scripts). No new permission: tabs.create/get/update and windows.create/update
 * need none, and we never read a tab URL (which would need "tabs"). */
/* queued: a double click must find the workspace the first click opened */
function openApp(mode) { return serialize('app_open', () => openAppNow(mode)); }
/* each resolves to the id when the remembered window/tab still exists, else null */
async function appFocusWin(id) {
  if (id == null) return null;
  try { await chrome.windows.update(id, { focused: true }); return id; } catch (e) { return null; }
}
async function appFocusTab(id) {
  if (id == null) return null;
  try {
    const t = await chrome.tabs.get(id);                 // rejects if the tab was closed
    await chrome.tabs.update(t.id, { active: true });
    try { await chrome.windows.update(t.windowId, { focused: true }); } catch (e) {}
    return t.id;
  } catch (e) { return null; }
}
async function openAppNow(mode) {
  const url = chrome.runtime.getURL('app.html');
  let st = { syfs_app_tab: null, syfs_app_win: null };
  try { st = await chrome.storage.session.get(st); } catch (e) {}
  const win = await appFocusWin(st.syfs_app_win);
  if (win != null) return { id: win, focused: true };
  if (mode === 'window') {
    /* type:'popup' → no tab strip / omnibox, so it reads like a separate desktop app */
    const w = await chrome.windows.create({ url, type: 'popup', width: 1180, height: 780, focused: true });
    try { await chrome.storage.session.set({ syfs_app_win: w.id }); } catch (e) {}
    return { id: w.id };
  }
  const tab = await appFocusTab(st.syfs_app_tab);
  if (tab != null) return { id: tab, focused: true };
  const t = await chrome.tabs.create({ url });
  try { await chrome.storage.session.set({ syfs_app_tab: t.id }); } catch (e) {}
  return { id: t.id };
}
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_OPEN_APP') return;
  openApp(msg.mode === 'window' ? 'window' : 'tab')
    .then((r) => sendResponse({ ok: true, id: r.id, focused: !!r.focused }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

/* ===== QR tools in their own extension window (qrtool.html, phase-2 review) =====
 * Camera / location / a typed Wi-Fi password then belong to the extension, not to the
 * site the rail floats over. The id is re-checked HERE against a fixed list — the
 * fragment is the only thing that varies and it never comes from the message as-is.
 * One window per tool: an open one is focused (ids in chrome.storage.session, the
 * same memory-only store as the App Mode window). qrtool.html is NOT web-accessible. */
const TOOL_PAGES = ['qrgen', 'qrread', 'qrcam'];
function openToolPage(tool) { return serialize('toolpage', () => openToolPageNow(tool)); }
async function openToolPageNow(tool) {
  let st = { syfs_tool_wins: {} };
  try { st = await chrome.storage.session.get(st); } catch (e) {}
  const wins = (st.syfs_tool_wins && typeof st.syfs_tool_wins === 'object') ? st.syfs_tool_wins : {};
  const had = await appFocusWin(Number.isInteger(wins[tool]) ? wins[tool] : null);
  if (had != null) return { id: had, focused: true };
  const w = await chrome.windows.create({ url: chrome.runtime.getURL('qrtool.html#' + tool), type: 'popup', width: 480, height: 760, focused: true });
  wins[tool] = w && w.id;
  try { await chrome.storage.session.set({ syfs_tool_wins: wins }); } catch (e) {}
  return { id: w && w.id };
}
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_OPEN_TOOLPAGE') return;
  const tool = typeof msg.tool === 'string' && TOOL_PAGES.indexOf(msg.tool) >= 0 ? msg.tool : null;
  if (!tool) { sendResponse({ ok: false, error: 'bad-tool' }); return; }
  openToolPage(tool)
    .then((r) => sendResponse({ ok: true, focused: !!r.focused }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

/* ===== قياس السرعة — timed where the bytes land (phase-2 review) =====
 * A content script's relay (SYFS_FETCH) times the page↔worker hop too; here the worker
 * times the transfer itself and answers NUMBERS only. The URL is FIXED (already in
 * ALLOWED) — nothing from the message reaches fetch() except a size, which is an
 * integer inside a per-op cap. One run at a time (a looping page gets 'busy'), every
 * transfer aborted after SPEED_TIMEOUT, a download never read past its asked size. */
const SPEED_URL = 'https://speed.cloudflare.com/';
const SPEED_CAP = { ping: 0, down: 25e6, up: 1e7 };
const SPEED_TIMEOUT = 30000;
let speedBusy = false;
const speedNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
async function speedRun(op, bytes) {
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), SPEED_TIMEOUT) : null;
  const sig = ac ? { signal: ac.signal } : {};
  try {
    const t0 = speedNow();
    if (op === 'up') {
      const r = await fetch(SPEED_URL + '__up', Object.assign({ method: 'POST', body: new Uint8Array(bytes), cache: 'no-store', credentials: 'omit' }, sig));
      try { await r.arrayBuffer(); } catch (e) {}
      return { ok: !!r.ok, ms: Math.round((speedNow() - t0) * 10) / 10, bytes };
    }
    const r = await fetch(SPEED_URL + '__down?bytes=' + (op === 'ping' ? 0 : bytes), Object.assign({ cache: 'no-store', credentials: 'omit' }, sig));
    const t1 = speedNow();
    if (op === 'ping') {
      try { if (r.body) r.body.cancel(); } catch (e) {}
      return { ok: !!r.ok, ms: Math.round((t1 - t0) * 10) / 10 };
    }
    let got = 0;
    if (r.body && r.body.getReader) {
      const rd = r.body.getReader();
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        got += value ? value.byteLength : 0;
        if (got >= bytes) { try { rd.cancel(); } catch (e) {} break; }
      }
    } else got = Math.min(bytes, (await r.arrayBuffer()).byteLength);
    return { ok: !!r.ok, ms: Math.round((speedNow() - t1) * 10) / 10, bytes: Math.min(got, bytes) };
  } finally { if (timer != null) clearTimeout(timer); }
}
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_SPEED') return;
  const op = msg.op;
  const bytes = Number(msg.bytes);
  const okArgs = Object.prototype.hasOwnProperty.call(SPEED_CAP, op) &&
    (op === 'ping' || (Number.isInteger(bytes) && bytes > 0 && bytes <= SPEED_CAP[op]));
  if (!okArgs) { sendResponse({ ok: false, error: 'bad-args' }); return; }
  if (speedBusy) { sendResponse({ ok: false, error: 'busy' }); return; }
  speedBusy = true;
  speedRun(op, op === 'ping' ? 0 : bytes)
    .then((r) => { speedBusy = false; sendResponse(r); }, () => { speedBusy = false; sendResponse({ ok: false, error: 'network' }); });
  return true; // async sendResponse
});

/* ===== تحميل الفيديو والصوت — Facebook / SoundCloud / generic =====
 * The content script (src/downloader.js) extracts media URLs from the current
 * page. Here we (a) start the download, and (b) resolve a SoundCloud stream
 * URL (needs a client_id from the JS bundle). YouTube is not handled anywhere.
 * For personal use with content the user has the right to save. */
// Open the password-vault extension page in its own tab (isolated from web
// pages). The vault UI + crypto live there, never in a content script.
/* ONE vault tab: the open one is focused (appFocusTab), queued so a double click finds
   the tab the first click opened — two unlocked vault tabs was how one overwrote the
   other (2026-10 audit). vault.html's own BroadcastChannel dedupe stays as the backstop. */
function openVaultTab() { return serialize('vault_tab', openVaultTabNow); }
async function openVaultTabNow() {
  let st = { syfs_vault_tab: null };
  try { st = await chrome.storage.session.get(st); } catch (e) {}
  const had = await appFocusTab(st.syfs_vault_tab);
  if (had != null) return { id: had, focused: true };
  const t = await chrome.tabs.create({ url: chrome.runtime.getURL('vault.html') });
  try { await chrome.storage.session.set({ syfs_vault_tab: t.id }); } catch (e) {}
  return { id: t.id };
}
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_OPEN_VAULT') return;
  openVaultTab()
    .then((r) => sendResponse({ ok: true, focused: !!r.focused }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

/* «مصحف الأطفال» (v0.181.0): kids.html in ONE tab — a second click focuses it instead
   of opening a second page reciting over the first. Same pattern as the vault. */
function openKidsTab() { return serialize('kids_tab', openKidsTabNow); }
async function openKidsTabNow() {
  let st = { syfs_kids_tab: null };
  try { st = await chrome.storage.session.get(st); } catch (e) {}
  const had = await appFocusTab(st.syfs_kids_tab);
  if (had != null) return { id: had, focused: true };
  const t = await chrome.tabs.create({ url: chrome.runtime.getURL('kids.html') });
  try { await chrome.storage.session.set({ syfs_kids_tab: t.id }); } catch (e) {}
  return { id: t.id };
}
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_OPEN_KIDS') return;
  openKidsTab()
    .then((r) => sendResponse({ ok: true, focused: !!r.focused }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

/* «التحفيظ» (v0.182.0): hifz.html in ONE tab, like the kids' page and the vault */
function openHifzTab() { return serialize('hifz_tab', openHifzTabNow); }
async function openHifzTabNow() {
  let st = { syfs_hifz_tab: null };
  try { st = await chrome.storage.session.get(st); } catch (e) {}
  const had = await appFocusTab(st.syfs_hifz_tab);
  if (had != null) return { id: had, focused: true };
  const t = await chrome.tabs.create({ url: chrome.runtime.getURL('hifz.html') });
  try { await chrome.storage.session.set({ syfs_hifz_tab: t.id }); } catch (e) {}
  return { id: t.id };
}
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_OPEN_HIFZ') return;
  openHifzTab()
    .then((r) => sendResponse({ ok: true, focused: !!r.focused }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});
/* the daily reminder: one alarm at the plan's time, every day (review never takes a day
   off, even on a day with no new ayahs). Re-armed from the stored plan on start-up, on
   any change of the plan, and after it fires — never trusted to survive by itself. */
const HIFZ_ALARM = 'syfs_hifz';
function hifzNextAt(hhmm, now) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm || '');
  if (!m) return 0;
  const d = new Date(now);
  d.setHours(+m[1], +m[2], 0, 0);
  if (d.getTime() <= now + 1000) d.setDate(d.getDate() + 1);
  return d.getTime();
}
async function hifzArm() {
  let p = null;
  try { p = (await chrome.storage.local.get({ hifz_plan: null })).hifz_plan; } catch (e) {}
  const at = (p && p.started === true) ? hifzNextAt(p.remind, Date.now()) : 0;
  try { await chrome.alarms.clear(HIFZ_ALARM); } catch (e) {}
  if (at) chrome.alarms.create(HIFZ_ALARM, { when: at });
}
chrome.alarms.onAlarm.addListener((a) => {
  if (!a || a.name !== HIFZ_ALARM) return;
  wtLoad().then(() => {
    ikNotify(wt('التحفيظ'), wt('وقت الحفظ والمراجعة — افتح خطة اليوم.'), 'syfs-hifz');
  }).catch(() => {}).then(() => hifzArm()).catch(() => {});
});
try {
  chrome.notifications.onClicked.addListener((id) => {
    if (id !== 'syfs-hifz') return;
    chrome.notifications.clear(id);
    openHifzTab().catch(() => {});
  });
} catch (e) {}
chrome.runtime.onInstalled.addListener(() => { hifzArm().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { hifzArm().catch(() => {}); });
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.hifz_plan) hifzArm().catch(() => {}); });

// صفحة مفاتيح المساعد الذكي (aikeys.html) في تبويب مستقل — نفس نموذج الحافظة
// حرفياً: المفتاح لا يُلمَس من سكربت محتوى، وصفحة الإضافة وحدها تقرؤه وتكتبه.
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_OPEN_AIKEYS') return;
  chrome.tabs.create({ url: chrome.runtime.getURL('aikeys.html') })
    .then(() => sendResponse({ ok: true }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

// Open the Excel sheet tool (sheet.html) in its own tab. Same pattern as the
// vault: an extension page opened by URL needs no `tabs` permission and is NOT a
// web-accessible resource. The workbook is read there, in that tab's memory only.
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_OPEN_SHEET') return;
  chrome.tabs.create({ url: chrome.runtime.getURL('sheet.html') })
    .then(() => sendResponse({ ok: true }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

// Open the phone number formatter (phones.html) in its own tab — same pattern. The
// workbook is parsed there, in that tab's memory only; nothing is stored or uploaded.
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_OPEN_PHONES') return;
  chrome.tabs.create({ url: chrome.runtime.getURL('phones.html') })
    .then(() => sendResponse({ ok: true }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

// Open the status maker (status.html) in its own tab — same pattern again. The picked
// image is read in THAT tab with createImageBitmap and never leaves it; the worker only
// opens the page and is handed no data at all.
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_OPEN_STATUS') return;
  chrome.tabs.create({ url: chrome.runtime.getURL('status.html') })
    .then(() => sendResponse({ ok: true }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

// Open the OCR page (ocr.html) in its own tab. Same pattern: the image is picked and
// read in THAT tab, the Tesseract engine is a set of files inside the extension, and the
// worker is handed no data at all — it opens a page and stops.
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_OPEN_OCR') return;
  chrome.tabs.create({ url: chrome.runtime.getURL('ocr.html') })
    .then(() => sendResponse({ ok: true }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

// Open the video workshop (video.html) — «الفيديو ⇒ صور» today, its siblings later.
// The video is decoded in that tab by the browser's own decoder; the worker opens the
// page and nothing else. No data crosses this message in either direction.
const VIDEO_MODES = ['frames', 'audio', 'trim', 'convert'];
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_OPEN_VIDEO') return;
  // The mode decides which panel opens and it arrives from a content script, so it is
  // checked against a WHITELIST rather than appended: a fragment is not dangerous by
  // itself, but a value from a page must never reach a URL we build (§8).
  const mode = VIDEO_MODES.includes(msg.mode) ? msg.mode : 'frames';
  chrome.tabs.create({ url: chrome.runtime.getURL('video.html') + '#' + mode })
    .then(() => sendResponse({ ok: true }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

// Open the Word document tool (word.html) in its own tab — same pattern again. The
// .docx is parsed there, in that tab's memory only; nothing is stored or uploaded.
// `pdf: true` opens the same page as «PDF إلى Word» (word.html#pdf) — a fixed fragment
// chosen here, never a string from the message.
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_OPEN_WORD') return;
  chrome.tabs.create({ url: chrome.runtime.getURL('word.html') + (msg.pdf === true ? '#pdf' : '') })
    .then(() => sendResponse({ ok: true }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

// Open the PowerPoint tool (slides.html) in its own tab. Same pattern; the .pptx is
// parsed in that tab's memory only.
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_OPEN_SLIDES') return;
  chrome.tabs.create({ url: chrome.runtime.getURL('slides.html') })
    .then(() => sendResponse({ ok: true }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

// Open the email writer (mail.html). Its AI actions go through the SAME SYFS_FETCH
// relay and the SAME ALLOWED host list as the assistant — no new host, no new key.
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_OPEN_MAIL') return;
  chrome.tabs.create({ url: chrome.runtime.getURL('mail.html') })
    .then(() => sendResponse({ ok: true }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

/* Hand a captured/edited image to «الاستوديو» (studio.html — the pro editor since v0.166.0).
 *
 * chrome.storage.session is memory-only (never written to disk, cleared on browser
 * restart) and is NOT exposed to content scripts by default — we deliberately do not
 * call setAccessLevel(), so the image is readable only by extension pages. The content
 * script therefore posts the data URL here and the worker stages it under a random key;
 * studio.html reads that key once and removes it immediately.
 *
 * Quota is 10 MB. A long full-page screenshot can exceed that as a PNG data URL, so the
 * content script re-encodes to JPEG before sending when it is too large (see media.js). */
const EDIT_QUOTA = 9 * 1024 * 1024;   // keep headroom under the 10MB session quota
/* ⚠️ الصورة المرحَّلة كانت تُحذف من `boot()` في editor.html وحدها — ومن أغلق التبويب
 * قبل إقلاعه ترك ٩ ميغابايت في تخزين الجلسة بقيّة الجلسة، تحت سقف العشرة نفسه الذي
 * ستحتاجه اللقطة التالية. فللمفتاح الآن عمرٌ يملكه العامل: تاريخ انتهاء مخزَّن ومُنبّه
 * يكنس ما انقضى. ⛔ لا `setTimeout` — العامل يُهدَم بين الوضع والموعد فلا يستيقظ أحد،
 * والمُنبّه يملكه كروم ويعمّر تدميره. وحذف مفتاح قرأته الصفحة سلفاً بلا أثر. */
const EDIT_TTL_MIN = 5;
const EDIT_GC_ALARM = 'syfs_edit_gc';
const EDIT_EXP_KEY = 'syfs_edit_exp';
async function editExp() {
  const st = await chrome.storage.session.get({ [EDIT_EXP_KEY]: null });
  const v = st[EDIT_EXP_KEY];
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
}
/* ⚠️ الموعد يُضبط على **أقرب انتهاء**، ولا يُعاد إنشاؤه بلا داع: `alarms.create` باسم
   موجود **يُعيد ضبطه**، فوضعُ صورة ثانية عند الدقيقة الرابعة كان يؤجّل كنس الأولى من ٦
   إلى ١٠ — ووضعٌ متكرّر يؤجّل ٩ ميغابايت منتهية إلى ما لا نهاية، وهي بالضبط الحصّة التي
   وُجد هذا الكنس ليحميها. */
async function editArm(exp) {
  const times = Object.keys(exp).map((k) => exp[k]).filter((t) => typeof t === 'number');
  if (!times.length) { chrome.alarms.clear(EDIT_GC_ALARM); return; }
  const soonest = Math.min.apply(null, times);
  chrome.alarms.create(EDIT_GC_ALARM, { delayInMinutes: Math.max(0.5, (soonest - Date.now()) / 60000 + 0.1) });
}
/* ⚠️ سباق (v0.139.3): وضعان متزامنان يقرأ كلاهما جدول المواعيد نفسه ويكتب نسخته،
   فيضيع مفتاح أحدهما من الجدول وتبقى صورته ٩ ميغابايت بلا موعد يكنسها. ومثله كنسٌ
   يقرأ الجدول بين قراءة الوضع وكتابته. فكلّ قراءة-تعديل-كتابة للجدول تمرّ بطابور واحد،
   والموعد يُسجَّل **قبل** كتابة الصورة: صورةٌ بلا موعد لا تُولد إلا من عامل مات بين
   الخطوتين — والكنس يلتقطها أيضاً (مفتاح `syfs_edit_*` غير مسجَّل = يتيم). */
function editSerial(fn) { return serialize('edit_exp', fn); }
function editStage(key) {
  return editSerial(async () => {
    const exp = await editExp();
    exp[key] = Date.now() + EDIT_TTL_MIN * 60000;
    await chrome.storage.session.set({ [EDIT_EXP_KEY]: exp });
    await editArm(exp);
  });
}
async function editKeys() {
  const s = chrome.storage.session;
  const keys = typeof s.getKeys === 'function' ? await s.getKeys() : Object.keys(await s.get(null));
  return keys.filter((k) => /^syfs_edit_[0-9a-f-]{36}$/.test(k));   /* = the key studio/app.js accepts */
}
function editGc() {
  return editSerial(async () => {
    const exp = await editExp();
    const now = Date.now(), keep = {}, drop = [];
    Object.keys(exp).forEach((k) => { if (exp[k] > now) keep[k] = exp[k]; else drop.push(k); });
    try { (await editKeys()).forEach((k) => { if (!(k in keep) && drop.indexOf(k) < 0) drop.push(k); }); } catch (e) {}
    if (drop.length) await chrome.storage.session.remove(drop);
    await chrome.storage.session.set({ [EDIT_EXP_KEY]: keep });
    /* مفتاحٌ لم ينضج بعد ⇒ موعد ثانٍ عند وقته هو. الكنس لا يترك خلفه شيئاً يُنسى. */
    await editArm(keep);
  });
}
chrome.alarms.onAlarm.addListener((a) => {
  if (a && a.name === EDIT_GC_ALARM) editGc().catch(() => {});
});
/* v0.166.0 — the page is studio.html («الاستوديو»), which replaced the Konva editor.
   `stage: true` only stages and answers the key: the in-page studio (src/studio.js)
   hands it to its own frame instead of opening a tab. `tool` names the studio page to
   open on — whitelisted to the shape of a tool id, it only ever becomes a URL hash. */
const STUDIO_TOOL_RE = /^[a-z][a-z-]{1,19}$/;
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_EDIT_OPEN') return;
  const url = msg.dataUrl;
  if (typeof url !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(url)) {
    sendResponse({ ok: false, error: 'bad-image' }); return;
  }
  if (url.length > EDIT_QUOTA) { sendResponse({ ok: false, error: 'too-large' }); return; }
  const tool = typeof msg.tool === 'string' && STUDIO_TOOL_RE.test(msg.tool) ? msg.tool : 'editor';
  const key = 'syfs_edit_' + crypto.randomUUID();
  editStage(key)
    .then(() => chrome.storage.session.set({ [key]: url }))
    .then(() => {
      if (msg.stage === true) { sendResponse({ ok: true, key }); return; }
      return chrome.tabs.create({ url: chrome.runtime.getURL('studio.html') + '?k=' + encodeURIComponent(key) + '#' + tool })
        .then(() => sendResponse({ ok: true }));
    })
    .catch((e) => { chrome.storage.session.remove(key).catch(() => {}); sendResponse({ ok: false, error: String(e) }); });
  return true; // async sendResponse
});


/* ===== نوافذ منبثقة — WhatsApp Web / any-site viewer =====
 * windows.create needs no permission. Only http/https URLs are allowed and the
 * dimensions are clamped; everything else is rejected. */
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_POPUP') return;
  let u;
  try { u = new URL(String(msg.url || '')); } catch (e) { sendResponse({ ok: false, error: 'bad-url' }); return; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') { sendResponse({ ok: false, error: 'bad-scheme' }); return; }
  const w = Math.min(Math.max(parseInt(msg.w, 10) || 460, 280), 1600);
  const h = Math.min(Math.max(parseInt(msg.h, 10) || 780, 300), 1200);
  chrome.windows.create({ url: u.href, type: 'popup', width: w, height: h, focused: true })
    .then(() => sendResponse({ ok: true }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

/* ===== نافذة جنبيّة (side dock, v0.135.0) =====
 * ⛔ لماذا ليست `iframe` ولا لوحة `chrome.sidePanel`:
 *   · `web.whatsapp.com` يُرسل `x-frame-options: DENY` — يُسقَط بـDNR، لكنّ ذلك أوّل عائق لا آخره.
 *   · داخل أي إطار من أصل آخر يصير تخزين الموقع **مقسَّماً** (third-party storage partitioning):
 *     IndexedDB وعامل الخدمة اللذان تقوم عليهما جلسة واتساب يصيران نسخة منفصلة عن التبويب
 *     العادي ⇒ ربط QR جديد في كل مرة، وجلسة تُكسر مع أول تنظيف تخزين.
 *   · و`chrome.sidePanel` لا يعرض إلا **صفحات الإضافة** — فموقع طرفٍ ثالث فيها يعود `iframe`
 *     ويعود معه العائقان. (لهذا تعرض إضافة Claude تطبيقها هي في اللوحة، لا موقعاً غريباً.)
 * الحلّ: نافذة متصفّح حقيقية مستقلّة، ملتصقة بحافّة الشاشة بعرض ثابت، والنافذة المضيفة تُقلَّص
 * لتشغل الباقي. أصلٌ من الدرجة الأولى ⇒ الجلسة والعامل والتخزين كما لو فُتح في تبويب.
 * مقاسات الشاشة تأتي من الصفحة (`screen.avail*`) — لا صلاحية `system.display` جديدة.
 * الحدود التي يضبطها المستخدم بيده تُحفظ وتُستعمل في المرة التالية: تفضيلٌ يُبدى مرة ويُحترم. */
const SIDE_WINS = new Map();                       /* origin → windowId */
const SIDE_MIN = 320, SIDE_MAX = 900;
/* v0.139.4: the map is mirrored to storage.session. In memory only, a worker that slept
   between two clicks forgot the dock it opened: the second click opened a second window,
   and the user's hand-set bounds were no longer remembered. storage.session dies with the
   browser, exactly like the window ids it holds. */
let sideWinsReady = null;
function sideWinsLoad() {
  if (!sideWinsReady) {
    sideWinsReady = chrome.storage.session.get({ side_wins: {} }).then((st) => {
      const o = st && st.side_wins && typeof st.side_wins === 'object' ? st.side_wins : {};
      for (const k of Object.keys(o)) if (Number.isInteger(o[k]) && !SIDE_WINS.has(k)) SIDE_WINS.set(k, o[k]);
    }).catch(() => {});
  }
  return sideWinsReady;
}
function sideWinsSave() {
  const o = {};
  for (const [k, v] of SIDE_WINS) o[k] = v;
  return chrome.storage.session.set({ side_wins: o }).catch(() => {});
}

function sideClamp(n, lo, hi, dflt) {
  n = parseInt(n, 10);
  if (!isFinite(n)) return dflt;
  return Math.min(Math.max(n, lo), hi);
}

onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_SIDE') return;
  let u;
  try { u = new URL(String(msg.url || '')); } catch (e) { sendResponse({ ok: false, error: 'bad-url' }); return; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') { sendResponse({ ok: false, error: 'bad-scheme' }); return; }

  (async () => {
    /* already open? focus it — a second click must not litter the desktop with windows */
    await sideWinsLoad();
    const had = SIDE_WINS.get(u.origin);
    if (had != null) {
      try {
        await chrome.windows.update(had, { focused: true, drawAttention: true });
        sendResponse({ ok: true, focused: true });
        return;
      } catch (e) { SIDE_WINS.delete(u.origin); sideWinsSave(); }
    }

    const m = msg.metrics || {};
    const sx = sideClamp(m.left, -10000, 10000, 0);
    const sy = sideClamp(m.top, -10000, 10000, 0);
    const sw = sideClamp(m.width, 480, 20000, 1280);
    const sh = sideClamp(m.height, 360, 20000, 800);

    /* the user's own last RECT wins over any default we would compute. It is stored as
       absolute pixels, and which side it means is decided here — where the screen size is
       known — not in the bounds listener, which sees a window and no screen. */
    let saved = null;
    try { saved = (await chrome.storage.local.get('side_bounds')).side_bounds || null; } catch (e) {}
    const maxW = Math.min(SIDE_MAX, Math.max(SIDE_MIN, sw - 200));
    const w = saved && saved.w ? sideClamp(saved.w, SIDE_MIN, maxW, 460)
                               : sideClamp(msg.w || Math.round(sw * 0.34), SIDE_MIN, maxW, 460);
    const side = (msg.side === 'left' || msg.side === 'right') ? msg.side
               : (saved && isFinite(saved.left) ? (saved.left + w / 2 < sx + sw / 2 ? 'left' : 'right')
                                                : 'right');
    const left = side === 'left' ? sx : sx + sw - w;
    const top  = saved && isFinite(saved.top) ? sideClamp(saved.top, sy, sy + sh - 200, sy) : sy;
    const h    = saved && saved.h ? sideClamp(saved.h, 360, sh, sh) : sh;

    let win;
    try {
      win = await chrome.windows.create({
        url: u.href, type: 'popup', focused: true,
        left: Math.round(left), top: Math.round(top), width: Math.round(w), height: Math.round(h)
      });
    } catch (e) { sendResponse({ ok: false, error: String(e) }); return; }
    SIDE_WINS.set(u.origin, win.id);
    sideWinsSave();

    /* shrink the host window into the remaining half. A maximized window ignores
       left/width, so it is un-maximized first — and only the SENDER's own window is
       touched, never another one the page could name. */
    if (msg.shrink !== false && sender.tab && sender.tab.windowId != null) {
      try {
        const host = await chrome.windows.get(sender.tab.windowId);
        if (host.state === 'maximized' || host.state === 'fullscreen') {
          await chrome.windows.update(host.id, { state: 'normal' });
        }
        await chrome.windows.update(host.id, {
          left: Math.round(side === 'left' ? sx + w : sx), top: Math.round(sy),
          width: Math.round(sw - w), height: Math.round(sh)
        });
      } catch (e) { /* a host window we cannot move is not a reason to fail the dock */ }
    }
    sendResponse({ ok: true, id: win.id, side: side, w: Math.round(w) });
  })();
  return true;                                     /* async sendResponse */
});

/* ===== اللوحة الجانبية (chrome.sidePanel, v0.136.0) =====
 * ما طلبه المستخدم بالضبط: الموقع **داخل نفس النافذة** والصفحة تنكمش إلى جواره — وهو ما
 * تفعله لوحة كروم الجانبية، ولا تفعله نافذة منفصلة مهما التصقت بالحافّة.
 * لوحة كروم لا تعرض إلا صفحات الإضافة، فالموقع يعيش داخل `iframe` في `side.html`. ولهذا:
 *   · نُسقط `x-frame-options` و`content-security-policy` للمضيف المطلوب **بقاعدة جلسة تحيا
 *     مع اللوحة وحدها** (`op:'off'` عند `pagehide`). نُحاول أولاً حصرها بـ`initiatorDomains`
 *     على أصل الإضافة؛ فإن رفضها كروم سقطنا إلى قاعدة بلا هذا الشرط — والفرق يُبلَّغ في الردّ
 *     (`tight`) بدل أن يُخمَّن.
 *   · تقسيم تخزين الطرف الثالث يبقى قائماً، لكن مفتاحه هنا **أصل الإضافة** (المستند الأعلى في
 *     اللوحة) لا الموقع المتصفَّح: مفتاح واحد ثابت على كل المواقع ⇒ جلسة واحدة تبقى، لا ربط
 *     جديد مع كل صفحة كما يحدث في إطارٍ مزروع داخل صفحة الموقع.
 * `sidePanel.open()` يشترط إيماءة مستخدم؛ النداء آتٍ من نقرة في الصفحة عبر رسالة، وإن رفضه
 * كروم أعدنا `needs-gesture` فيلجأ النداء إلى النافذة الملتصقة بدل أن يفشل صامتاً. */
/* ===== معرّفات قواعد DNR: جدولٌ واحد، نطاقات لا تتقاطع (v0.139.2) =====
 * كانت المعرّفات تُختار في أربعة أماكن بلا جدول: اللوحة `9200` ثابتة بينما إطار العارض
 * `tabId + 1` ⇒ التبويب 9199 يمحو قاعدة اللوحة؛ واستثناء المانع `max + 1` ⇒ يقع على
 * معرّف الوضع الخفيف (910002) فيمحوه `applyLiteRules` ويعود الحظر بصمت.
 *   ديناميكية (تبقى):  استثناء المانع 1..RULE_ALLOW_MAX · الوضع الخفيف 910001–910003 (LITE_IDS)
 *   جلسة (تموت):       اللوحة PANEL_RULE · الإطار FRAME_RULE_BASE + tabId · UA UA_RULE_BASE + tabId
 * ⛔ أي عائلة قواعد جديدة تأخذ نطاقاً هنا — واختبار `tools/dnr-test.js` يفرض عدم التقاطع. */
const RULE_ALLOW_MAX = 899999;
const PANEL_RULE = 1;
const FRAME_RULE_BASE = 100000000;
const UA_RULE_BASE = 200000000;

async function panelArm(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!DNR_DOMAIN_RE.test(h) || h.length > 253) return { ok: false, error: 'bad-host' };
  const action = {
    type: 'modifyHeaders',
    responseHeaders: [
      { header: 'x-frame-options', operation: 'remove' },
      { header: 'content-security-policy', operation: 'remove' }
    ]
  };
  const base = { resourceTypes: ['sub_frame'], requestDomains: [h] };
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [PANEL_RULE],
      addRules: [{ id: PANEL_RULE, priority: 1, action, condition: Object.assign({ initiatorDomains: [chrome.runtime.id] }, base) }]
    });
    return { ok: true, tight: true };
  } catch (e) {
    /* older Chrome rejects an extension id as an initiator domain — take the wider rule
       rather than no panel, and say which one was taken. */
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [PANEL_RULE],
        addRules: [{ id: PANEL_RULE, priority: 1, action, condition: base }]
      });
      return { ok: true, tight: false };
    } catch (e2) { return { ok: false, error: String(e2) }; }
  }
}

onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_PANEL') return;
  (async () => {
    if (msg.op === 'off') {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [PANEL_RULE] }).catch(() => {});
      sendResponse({ ok: true });
      return;
    }
    if (msg.op === 'arm') { sendResponse(await panelArm(msg.host)); return; }

    /* op: 'open' — from a click in the page */
    let u;
    try { u = new URL(String(msg.url || 'https://web.whatsapp.com')); } catch (e) { sendResponse({ ok: false, error: 'bad-url' }); return; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') { sendResponse({ ok: false, error: 'bad-scheme' }); return; }
    if (!chrome.sidePanel) { sendResponse({ ok: false, error: 'no-sidepanel' }); return; }

    await chrome.storage.local.set({ panel_url: u.href }).catch(() => {});
    /* ⛔ the header rule is NOT armed here (v0.139.2). It was, before `open()` — and on
       `needs-gesture` nothing ever took it down: no side.html existed to send `off`, so
       XFO/CSP stayed stripped for that host for the rest of the session (§5.12/1).
       side.js arms it itself, and only after the lock gate has answered. */
    try {
      await chrome.sidePanel.setOptions({ path: 'side.html', enabled: true });
      const windowId = sender.tab && sender.tab.windowId;
      await chrome.sidePanel.open(windowId != null ? { windowId } : {});
      sendResponse({ ok: true });
    } catch (e) {
      /* the one failure the caller must handle itself: Chrome refused the open for lack of
         a user gesture. The dock window is the fallback, and only the caller knows the
         screen metrics it needs. */
      sendResponse({ ok: false, error: 'needs-gesture', detail: String(e) });
    }
  })();
  return true;                                     /* async sendResponse */
});

/* remember where the user PUT it — a rect they set by hand is the next default */
chrome.windows.onBoundsChanged.addListener(async (win) => {
  await sideWinsLoad();
  for (const [, id] of SIDE_WINS) {
    if (id !== win.id) continue;
    chrome.storage.local.set({
      side_bounds: { left: win.left, top: win.top, w: win.width, h: win.height }
    }).catch(() => {});
    break;
  }
});
chrome.windows.onRemoved.addListener(async (id) => {
  await sideWinsLoad();
  for (const [origin, wid] of SIDE_WINS) if (wid === id) { SIDE_WINS.delete(origin); sideWinsSave(); break; }
});

/* ===== «عرض سريع» — تكبير/تصغير الصفحة (native per-tab zoom) =====
 * The view tool (src/display.js) controls the tab's native zoom. Acts on the
 * SENDER's own tab only (sender.tab.id — never a page-supplied id). No extra
 * permission: chrome.tabs.getZoom/setZoom need none. Zoom is clamped [0.25, 3];
 * op 'reset' passes 0 to restore the tab's default. Fullscreen is handled in the
 * content script (needs a user gesture) and never reaches here. */
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_ZOOM') return;
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null || tabId < 0) { sendResponse({ ok: false, error: 'no-tab' }); return; }
  const MIN = 0.25, MAX = 3, STEP = 0.1;
  const clamp = (z) => Math.min(MAX, Math.max(MIN, Math.round(z * 100) / 100));
  (async () => {
    if (msg.op === 'reset') {
      await chrome.tabs.setZoom(tabId, 0);                 // 0 = tab default
      sendResponse({ ok: true, zoom: await chrome.tabs.getZoom(tabId) });
      return;
    }
    if (msg.op === 'get') { sendResponse({ ok: true, zoom: await chrome.tabs.getZoom(tabId) }); return; }
    if (msg.op === 'in' || msg.op === 'out') {
      const cur = await chrome.tabs.getZoom(tabId);
      const next = clamp(cur + (msg.op === 'in' ? STEP : -STEP));
      await chrome.tabs.setZoom(tabId, next);
      sendResponse({ ok: true, zoom: next });
      return;
    }
    if (msg.op === 'set') {
      const next = clamp(Number(msg.value) || 1);
      await chrome.tabs.setZoom(tabId, next);
      sendResponse({ ok: true, zoom: next });
      return;
    }
    sendResponse({ ok: false, error: 'bad-op' });
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

/* ===== عارض المواقع داخل الصفحة — allow third-party framing on the caller's tab =====
 * The content script (src/rail.js → SYFS.openFrame) shows sites inside an
 * iframe. Most sites block framing with X-Frame-Options / CSP frame-ancestors.
 * We strip only the two ENFORCING framing headers (X-Frame-Options and the
 * enforcing Content-Security-Policy) using a SESSION rule scoped to (a) the
 * caller's tab ONLY (condition.tabIds) AND (b) the specific host(s) the user is
 * actually viewing (condition.requestDomains, sent + ref-counted by the content
 * script). The host page's OWN sub-frames (login/payment/ads) are never touched,
 * so their framing + CSP protection stays intact. CSP-Report-Only is left alone
 * (it never blocks framing; removing it would only suppress the site's own
 * violation reporting). Nothing is persisted; no other tab is ever affected. */
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_FRAME') return;
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null || tabId < 0) { sendResponse({ ok: false, error: 'no-tab' }); return; }
  const ruleId = FRAME_RULE_BASE + tabId;      // unique per tab, in its own range (see RULE_ALLOW_MAX)
  (async () => {
    if (msg.op === 'set') {
      // Domains come from a content script — validate (whitelist regex + length
      // + count cap) before they ever reach a DNR condition.
      const domains = (Array.isArray(msg.domains) ? msg.domains : [])
        .map((d) => String(d || '').toLowerCase().replace(/^www\./, ''))
        .filter((d) => DNR_DOMAIN_RE.test(d) && d.length <= 253)
        .slice(0, 20);
      if (!domains.length) {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
        sendResponse({ ok: true, domains: 0 });
        return;
      }
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId],
        addRules: [{
          id: ruleId,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'x-frame-options', operation: 'remove' },
              { header: 'content-security-policy', operation: 'remove' }
            ]
          },
          condition: { resourceTypes: ['sub_frame'], tabIds: [tabId], requestDomains: domains }
        }]
      });
      sendResponse({ ok: true, domains: domains.length });
    } else if (msg.op === 'off') {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: 'bad-op' });
    }
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});
/* ⛔ الصفحة لا يُؤتمن على إعلان موتها. `op:'off'` يرسله سكربت المحتوى حين يغلق
 * المستخدم نافذة العارض — أمّا التنقّل والتحديث والإغلاق فتُهدم السكربت قبل أن يرسل
 * شيئاً، فتنجو القاعدة بقيّة الجلسة وتُصبح أي صفحة لاحقة في هذا التبويب قادرة على
 * تأطير تلك المضيفات بلا x-frame-options ولا CSP — أي إسقاط دفاعٍ لم يطلبه أحد.
 * ⇒ عمر القاعدة ملك العامل، و`op:'off'` يبقى قفلاً ثانياً لا القفل الوحيد. */
const frameDrop = (tabId) => {
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [FRAME_RULE_BASE + tabId] }).catch(() => {});
};
chrome.tabs.onRemoved.addListener((tabId) => { frameDrop(tabId); });
/* ⚠️ `changeInfo.url` لا `changeInfo.status === 'loading'`: حالة التحميل تخصّ التبويب كلّه
   فتُطلَق مع تنقّل **أي إطار داخلي** — والعارض نفسه إطار داخلي يُحمِّل إطاراته. بذلك كانت
   القاعدة تُنزع والعارض ما زال مفتوحاً، فيصير «يعمل مرّة ثم ينكسر». تغيّر الـURL حدثٌ
   للإطار الرئيسي وحده، وهو بالضبط الحدث الذي يُهلك سكربت المحتوى ونافذة العارض معه. */
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info && info.url) frameDrop(tabId); });

/* ===== User-Agent / request-header override for ONE tab (src/dev2.js «طلبات وترويسات») =====
 * A SESSION rule scoped to the sender's tab (condition.tabIds) that SETS request headers
 * — User-Agent from a preset, plus up to five test headers. Same rules as SYFS_FRAME:
 * · the tab is the SENDER's (never a page-supplied id);
 * · the rule's LIFETIME belongs to the worker (§5.12/1): dropped on tab close and by
 *   `op:'off'`. Unlike the frame rule it deliberately SURVIVES navigation — «browse this
 *   site as Googlebot» is the feature, and the page cannot be trusted to turn it off;
 * · header names and values are validated here, not just in the panel (§5.11/4), and
 *   credential-bearing names are refused outright: a header set by DNR goes to EVERY
 *   host the tab requests, so `Authorization` here would be a token leak by design;
 * · a visible badge («UA») on the toolbar icon for that tab while the rule is active —
 *   silently altered headers are the kind of fault that gets chased for hours.
 * Rule ids live in their own range (UA_RULE_BASE, in the one id table above
 * PANEL_RULE) so they can never collide with the frame rule. Nothing is persisted. */
const UA_HDR_NAME = /^[A-Za-z0-9-]{1,64}$/;
const UA_HDR_VALUE = /^[\x20-\x7E]{0,1024}$/;
const UA_HDR_FORBID = /^(authorization|proxy-authorization|cookie|cookie2|host|content-length|connection|transfer-encoding|upgrade|te|trailer|origin|referer|sec-.*|proxy-.*)$/i;
const uaBadge = (tabId, on) => {
  try {
    chrome.action.setBadgeText({ tabId, text: on ? 'UA' : '' }).catch(() => {});
    if (on) chrome.action.setBadgeBackgroundColor({ tabId, color: '#d4423a' }).catch(() => {});
  } catch (e) {}
};
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_UA') return;
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null || tabId < 0) { sendResponse({ ok: false, error: 'no-tab' }); return; }
  const ruleId = UA_RULE_BASE + tabId;
  (async () => {
    if (msg.op === 'get') {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      const r = rules.find((x) => x.id === ruleId);
      sendResponse({ ok: true, active: !!r, count: r ? r.action.requestHeaders.length : 0 });
      return;
    }
    if (msg.op === 'off') {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
      uaBadge(tabId, false);
      sendResponse({ ok: true });
      return;
    }
    if (msg.op !== 'set') { sendResponse({ ok: false, error: 'bad-op' }); return; }
    const list = Array.isArray(msg.headers) ? msg.headers.slice(0, 6) : [];
    const headers = [];
    for (const pair of list) {
      if (!Array.isArray(pair)) { sendResponse({ ok: false, error: 'bad-header' }); return; }
      const name = String(pair[0] || ''), value = String(pair[1] || '');
      if (!UA_HDR_NAME.test(name) || !UA_HDR_VALUE.test(value) || UA_HDR_FORBID.test(name)) { sendResponse({ ok: false, error: 'bad-header' }); return; }
      headers.push({ header: name.toLowerCase(), operation: 'set', value });
    }
    if (!headers.length) { sendResponse({ ok: false, error: 'bad-header' }); return; }
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId],
      addRules: [{
        id: ruleId,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: headers },
        condition: { tabIds: [tabId] }
      }]
    });
    uaBadge(tabId, true);
    sendResponse({ ok: true, count: headers.length });
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [UA_RULE_BASE + tabId] }).catch(() => {});
});

/* ===== مدير الكوكيز — list / set / remove ONE cookie of the sender's site (src/tools3.js) =====
 * The site is derived from sender.tab.url ONLY, exactly as SYFS_CLEAN does, and the
 * same domain-match keeps every other site's cookies out of reach: a cookie is listed,
 * written or removed only when its own domain domain-matches the tab's host. The panel
 * never passes a domain to look at — it passes the cookie it was shown, and the worker
 * re-checks that cookie's domain against the tab before touching it (§5.11/4).
 * Values are user/site data: they travel back to the panel and are written there with
 * textContent; nothing is stored here. */
const CK_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,256}$/;
const ckMatch = (host, domain) => {
  const d = String(domain || '').replace(/^\./, '').toLowerCase();
  return !!d && (host === d || host.endsWith('.' + d) || d.endsWith('.' + host));
};
const ckSite = (sender) => {
  try {
    const u = new URL(sender.tab && sender.tab.url ? sender.tab.url : '');
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return { host: u.hostname.toLowerCase(), url: u.origin + '/', https: u.protocol === 'https:' };
  } catch (e) { return null; }
};
const ckListFor = async (host) => {
  const parts = host.split('.');
  const base = parts.length >= 2 ? parts.slice(-2).join('.') : host;
  const all = await chrome.cookies.getAll({ domain: base });
  return all.filter((c) => ckMatch(host, c.domain)).map((c) => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path, storeId: c.storeId, hostOnly: !!c.hostOnly,
    secure: !!c.secure, httpOnly: !!c.httpOnly, session: !!c.session, sameSite: c.sameSite || 'unspecified',
    expires: c.expirationDate ? Math.round(c.expirationDate) : 0
  })).sort((a, b) => a.name.localeCompare(b.name));
};
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_COOKIES') return;
  const site = ckSite(sender);
  if (!site) { sendResponse({ ok: false, error: 'unsupported-page' }); return; }
  (async () => {
    if (msg.op === 'list') { sendResponse({ ok: true, host: site.host, cookies: await ckListFor(site.host) }); return; }
    if (msg.op === 'remove') {
      const c = msg.cookie || {};
      if (!CK_NAME.test(String(c.name || '')) || !ckMatch(site.host, c.domain)) { sendResponse({ ok: false, error: 'bad-cookie' }); return; }
      const d = String(c.domain).replace(/^\./, '');
      const path = /^\/[\x21-\x7E]*$/.test(String(c.path || '')) ? String(c.path) : '/';
      const removed = await chrome.cookies.remove({ url: (c.secure ? 'https://' : 'http://') + d + path, name: String(c.name), storeId: c.storeId || undefined });
      sendResponse({ ok: !!removed });
      return;
    }
    if (msg.op !== 'set') { sendResponse({ ok: false, error: 'bad-op' }); return; }
    const c = msg.cookie || {};
    const name = String(c.name || ''), value = String(c.value || '');
    /* a cookie value is octets minus control characters, whitespace, `"`, `,`, `;`, `\` */
    if (!CK_NAME.test(name) || value.length > 4096 || /[\x00-\x20\x7F";,\\]/.test(value)) { sendResponse({ ok: false, error: 'bad-cookie' }); return; }
    const details = { url: site.url, name, value, path: /^\/[\x21-\x7E]*$/.test(String(c.path || '')) ? String(c.path) : '/' };
    if (c.domain) {
      if (!ckMatch(site.host, c.domain)) { sendResponse({ ok: false, error: 'bad-cookie' }); return; }
      const d = String(c.domain).replace(/^\./, '');
      details.url = (site.https ? 'https://' : 'http://') + d + details.path;
      /* a host-only cookie is re-set WITHOUT `domain` — passing it would turn the
         cookie into a domain cookie, i.e. a different cookie than the one edited */
      if (!c.hostOnly) details.domain = String(c.domain);
    }
    if (c.secure && site.https) details.secure = true;
    if (c.httpOnly) details.httpOnly = true;
    if (c.sameSite === 'lax' || c.sameSite === 'strict' || c.sameSite === 'no_restriction') details.sameSite = c.sameSite;
    const exp = Number(c.expires);
    if (isFinite(exp) && exp > Date.now() / 1000) details.expirationDate = Math.round(exp);
    if (c.storeId) details.storeId = String(c.storeId);
    const set = await chrome.cookies.set(details);
    sendResponse({ ok: !!set });
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

/* ===== قارئ QR — inject the decoder into the SENDER's tab on demand (src/tools3.js) =====
 * lib/jsqr/jsQR.js is 257KB and is wanted by one tool, so it is not in LAZY_TOOL_FILES;
 * it is injected the first time «قارئ QR» is opened, into the sender's own tab only —
 * the SYFS_LOAD_DOCVIEW model (one fixed file from inside the package, nothing from the
 * message). Extension pages load it with a <script> tag themselves. */
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_LOAD_QR') return;
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null || tabId < 0) { sendResponse({ ok: false }); return; }
  chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ['lib/jsqr/jsQR.js'] })
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));
  return true; // async sendResponse
});

/* ===== المصروفات والإيرادات — inject SheetJS into the SENDER's tab on demand (src/money.js) =====
 * lib/sheetjs/xlsx.full.min.js is ~930KB (zero eval) and only the Excel export/import
 * of «المصروفات والإيرادات» wants it, so it is not in LAZY_TOOL_FILES: injected on the
 * first export or import, into the sender's own tab only — the SYFS_LOAD_QR model (one
 * fixed file from inside the package, nothing from the message). */
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_LOAD_XLSX') return;
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null || tabId < 0) { sendResponse({ ok: false }); return; }
  chrome.scripting.executeScript({ target: { tabId, allFrames: false }, files: ['lib/sheetjs/xlsx.full.min.js'] })
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));
  return true; // async sendResponse
});

/* ===== جلسات التبويبات — save / restore the tabs of the sender's window (src/tools3.js) =====
 * The list is read from the SENDER's window (sender.tab.windowId — or, when that is
 * not a normal browser window, the last focused normal one: «وضع العمل» in its own
 * popup window, or side.html with no tab, has no web tabs of its own) and stored in
 * storage.local under `tab_sessions` ON THE USER'S CLICK ONLY — never on a timer, never
 * on close: a list of the pages someone had open is browsing history, and the tool's
 * promise is that it exists only when asked for (same reasoning as §5.23/1).
 * Only http(s) URLs are saved and only http(s) URLs are opened back; the stored value
 * is re-validated on every read (§5.11/1) because an import could have written it. */
const SESS_KEY = 'tab_sessions';
const SESS_MAX = 40, SESS_TABS_MAX = 200, SESS_NAME_MAX = 60;
const sessUrlOk = (u) => { try { const x = new URL(String(u)); return (x.protocol === 'https:' || x.protocol === 'http:') && String(u).length <= 2048; } catch (e) { return false; } };
const sessClean = (raw) => {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !Array.isArray(s.tabs)) continue;
    const tabs = s.tabs.filter((t) => t && typeof t === 'object' && sessUrlOk(t.u))
      .map((t) => ({ u: String(t.u), t: String(t.t || '').slice(0, 200) })).slice(0, SESS_TABS_MAX);
    if (!tabs.length) continue;
    out.push({ id: s.id.slice(0, 32), name: String(s.name || '').slice(0, SESS_NAME_MAX), at: Number(s.at) || 0, tabs });
    if (out.length >= SESS_MAX) break;
  }
  return out;
};
const sessRead = async () => sessClean((await chrome.storage.local.get({ [SESS_KEY]: [] }))[SESS_KEY]);
/* the sender's own window unless it is KNOWN not to be a normal one (the standalone
   workspace popup), else — or with no tab at all — the last focused normal window */
const sessWindow = async (own) => {
  if (own != null) {
    let w = null;
    try { w = await chrome.windows.get(own); } catch (e) {}
    if (!w || w.type === 'normal') return own;
  }
  try { const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }); return w ? w.id : null; } catch (e) { return null; }
};
/* the http(s) tabs to save: sessWindow()'s choice, and — when an EXTENSION PAGE asked
   (App Mode in a tab of a window with no web tabs) and that window has none — the last
   focused normal window's. A content script always gets its own window, never another. */
const sessTabsOf = async (windowId) => windowId == null ? [] : (await chrome.tabs.query({ windowId })).filter((t) => sessUrlOk(t.url))
  .map((t) => ({ u: t.url, t: String(t.title || '').slice(0, 200) })).slice(0, SESS_TABS_MAX);
const sessTabs = async (sender, own) => {
  let windowId = await sessWindow(own);
  let tabs = await sessTabsOf(windowId);
  if (!tabs.length && senderClass(sender) === 'page') {
    let w = null;
    try { w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }); } catch (e) {}
    if (w && w.id != null && w.id !== windowId) { windowId = w.id; tabs = await sessTabsOf(windowId); }
  }
  return { windowId, tabs };
};
/* «تحميل كسول» — a background tab of a restored session is discarded as soon as its URL
   commits (discarding earlier leaves an about:blank). One listener, ids kept ≤ 60 s;
   a tab that is never discarded just loads. Nothing here touches SESS_KEY. */
const SESS_LAZY = new Map();
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!SESS_LAZY.has(tabId)) return;
  if (!(info && (info.url || (info.status === 'loading' && tab && sessUrlOk(tab.url))))) return;
  SESS_LAZY.delete(tabId);
  try { Promise.resolve(chrome.tabs.discard(tabId)).catch(() => {}); } catch (e) {}
});
const sessLazy = (tabId) => {
  const now = Date.now();
  for (const [id, at] of SESS_LAZY) if (now - at > 60000) SESS_LAZY.delete(id);
  SESS_LAZY.set(tabId, now);
};
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_SESSIONS') return;
  (async () => {
    if (msg.op === 'list') { sendResponse({ ok: true, sessions: await sessRead() }); return; }
    if (msg.op === 'save') {
      const { windowId, tabs } = await sessTabs(sender, sender.tab && sender.tab.windowId);
      if (windowId == null) { sendResponse({ ok: false, error: 'no-window' }); return; }
      if (!tabs.length) { sendResponse({ ok: false, error: 'no-tabs' }); return; }
      /* every write re-reads inside the queue: two windows saving at once keep both */
      const sess = await serialize('sessions', async () => {
        const list = await sessRead();
        const s = { id: 's' + Date.now().toString(36), name: String(msg.name || '').slice(0, SESS_NAME_MAX), at: Date.now(), tabs };
        list.unshift(s);
        await chrome.storage.local.set({ [SESS_KEY]: list.slice(0, SESS_MAX) });
        return s;
      });
      sendResponse({ ok: true, session: sess });
      return;
    }
    if (msg.op === 'delete' || msg.op === 'rename') {
      const found = await serialize('sessions', async () => {
        const list = await sessRead();
        const sess = list.find((s) => s.id === String(msg.id || ''));
        if (!sess) return false;
        if (msg.op === 'delete') await chrome.storage.local.set({ [SESS_KEY]: list.filter((s) => s !== sess) });
        else { sess.name = String(msg.name || '').slice(0, SESS_NAME_MAX); await chrome.storage.local.set({ [SESS_KEY]: list }); }
        return true;
      });
      sendResponse(found ? { ok: true } : { ok: false, error: 'not-found' });
      return;
    }
    if (msg.op === 'update') {
      /* «تحديث» — the same session (id + name) now holds this window's tabs. Only on a
         click; still the one-click-one-write rule of «no automatic save». */
      const { tabs } = await sessTabs(sender, sender.tab && sender.tab.windowId);
      if (!tabs.length) { sendResponse({ ok: false, error: 'no-tabs' }); return; }
      const sess = await serialize('sessions', async () => {
        const list = await sessRead();
        const s = list.find((x) => x.id === String(msg.id || ''));
        if (!s) return null;
        s.tabs = tabs; s.at = Date.now();
        await chrome.storage.local.set({ [SESS_KEY]: list });
        return s;
      });
      sendResponse(sess ? { ok: true, session: sess } : { ok: false, error: 'not-found' });
      return;
    }
    const list = await sessRead();
    const sess = list.find((s) => s.id === String(msg.id || ''));
    if (!sess) { sendResponse({ ok: false, error: 'not-found' }); return; }
    if (msg.op === 'open') {
      /* one tab (index given) or all — in the sender's window (the last normal one when
         the sender is a popup: a tab cannot be created in it), never active, so the
         click that asked for ten tabs does not lose the panel it came from */
      const idx = msg.index == null ? NaN : Number(msg.index);
      const one = Number.isInteger(idx) && idx >= 0;
      if (msg.index != null && !one) { sendResponse({ ok: false, error: 'bad-index' }); return; }
      const pick = (one ? [sess.tabs[idx]].filter(Boolean) : sess.tabs).filter((t) => sessUrlOk(t.u));
      const lazy = msg.lazy === true;
      /* «نافذة جديدة» (a big session, confirmed on the page): a new normal window with
         the first tab, the rest behind it — discarded once committed when lazy. The
         reply goes as soon as the window exists (the page gives up waiting at 4 s). */
      if (msg.newWindow === true && !one && pick.length) {
        const w = await chrome.windows.create({ url: pick[0].u, type: 'normal', focused: true });
        sendResponse({ ok: true, opened: pick.length, windowId: w && w.id });
        for (const t of pick.slice(1)) {
          try {
            const tab = await chrome.tabs.create({ url: t.u, active: false, windowId: w.id });
            if (lazy && tab && tab.id != null) sessLazy(tab.id);
          } catch (e) {}
        }
        return;
      }
      const windowId = await sessWindow(sender.tab && sender.tab.windowId);
      let n = 0;
      for (const t of pick) {
        try {
          const tab = await chrome.tabs.create({ url: t.u, active: false, windowId: windowId == null ? undefined : windowId });
          if (lazy && !one && tab && tab.id != null) sessLazy(tab.id);
          n++;
        } catch (e) {}
      }
      sendResponse({ ok: true, opened: n });
      return;
    }
    sendResponse({ ok: false, error: 'bad-op' });
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

/* ===== منظّف الموقع — cookies + site storage + full HTTP cache =====
 * The origin is derived from sender.tab.url ONLY (never from message params).
 * Per-site: browsingData with an origins filter for storage types, plus
 * chrome.cookies for parent-domain cookies (strict domain-match against the
 * tab's host, so no other site's cookies are ever touched). The HTTP cache
 * has no per-origin filter in Chrome — 'cache-all' wipes it globally. */
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_CLEAN') return;
  (async () => {
    if (msg.op === 'cache-all') {
      await chrome.browsingData.remove({ since: 0 }, { cache: true });
      sendResponse({ ok: true });
      return;
    }
    if (msg.op !== 'site') { sendResponse({ ok: false, error: 'bad-op' }); return; }
    let origin, host;
    try {
      const u = new URL(sender.tab && sender.tab.url ? sender.tab.url : '');
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('scheme');
      origin = u.origin; host = u.hostname.toLowerCase();
    } catch (e) { sendResponse({ ok: false, error: 'unsupported-page' }); return; }

    const what = msg.what || {};
    if (what.storage) {
      await chrome.browsingData.remove({ origins: [origin] }, {
        localStorage: true, indexedDB: true, serviceWorkers: true,
        cacheStorage: true, fileSystems: true, webSQL: true
      });
    }
    let removed = 0;
    if (what.cookies) {
      // query on the last-2-label suffix, then keep ONLY cookies whose own
      // domain domain-matches the current host (h === d || h ends with .d)
      const parts = host.split('.');
      const base = parts.length >= 2 ? parts.slice(-2).join('.') : host;
      const all = await chrome.cookies.getAll({ domain: base });
      for (const c of all) {
        const d = c.domain.replace(/^\./, '').toLowerCase();
        if (host !== d && !host.endsWith('.' + d) && !d.endsWith('.' + host)) continue;
        const url = (c.secure ? 'https://' : 'http://') + d + c.path;
        try { await chrome.cookies.remove({ url, name: c.name, storeId: c.storeId }); removed++; } catch (e) {}
      }
    }
    sendResponse({ ok: true, cookies: removed });
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

/* ===== «الصور» — full-page screenshot capture relay =====
 * The fullshot tool (src/media.js) scroll-captures the page: each slice is one
 * captureVisibleTab call (needs the <all_urls> host permission). Chrome caps it
 * at 2 calls/sec — the content script paces itself and retries once. No
 * parameters are accepted from the page; only the sender's own window is shot. */
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_CAPTURE') return;
  if (!sender.tab || sender.tab.id == null) { sendResponse({ ok: false, error: 'no-tab' }); return; }
  /* ⛔ captureVisibleTab shoots the window's ACTIVE tab, not the sender. A sender that is
     not the active tab (a background tab's timer, a 📷 fired as the user switched away)
     would receive a picture of whatever other page is in front — someone's mail, their
     bank. Refuse instead of shooting the wrong tab. */
  if (!sender.tab.active) { sendResponse({ ok: false, error: 'not-active' }); return; }
  chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' })
    .then((url) => sendResponse({ ok: true, url }))
    .catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

/* ===== App Mode capture — shoot the active REAL web tab, not this extension page.
 * app.html runs as its own tab/window, so SYFS_CAPTURE (which shoots the sender's
 * own tab) would just capture the workspace. Here the worker finds the active tab
 * of a normal browser window and captures IT. The page passes NO tab id; the
 * worker picks the target itself (http/https only — this also excludes the app
 * page and internal chrome:// pages). No new permission: captureVisibleTab uses
 * the existing <all_urls> host permission; the URL is only used to pick a real
 * page and to label the shot — never stored or logged. */
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_APP_CAPTURE') return;
  (async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, windowType: 'normal' });
      const t = (tabs || []).find((x) => /^https?:\/\//i.test(x.url || ''));
      if (!t) { sendResponse({ ok: false, error: 'no-tab' }); return; }
      const dataUrl = await chrome.tabs.captureVisibleTab(t.windowId, { format: 'png' });
      sendResponse({ ok: true, dataUrl, title: t.title || '' });
    } catch (e) { sendResponse({ ok: false, error: String(e) }); }
  })();
  return true; // async sendResponse
});

/* ===== «الحماية» — ad & tracker blocking (declarativeNetRequest) =====
 * Blocking runs in the browser's network layer via the static rulesets in
 * rules/ads.json + rules/tracking.json. Here: the native per-tab blocked
 * counter on the toolbar badge, and the SYFS_DNR control channel for the
 * shield tool (src/shield.js). */

/* syfs_youtube is deliberately NOT user-togglable here: it is a protective
 * ALLOW ruleset (rules/youtube.json) that stops the blocklists from blocking
 * YouTube's own ad/telemetry probes — blocking those is what triggers the "ad
 * blockers violate ToS" message. It must stay enabled whenever any blocking
 * ruleset is on, independent of the yt_mode setting (which controls the
 * content-script layer in src/yt-guard.js + src/yt-engine.js). */
const DNR_RULESETS = {
  ads: 'syfs_ads',
  tracking: 'syfs_tracking',
  fingerprint: 'syfs_fingerprint',
  pixels: 'syfs_pixels'
};
const DNR_STORE_KEY = {
  ads: 'shield_ads',
  tracking: 'shield_trk',
  fingerprint: 'shield_fp',
  pixels: 'shield_px'
};
const DNR_DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/;

/* ===== YouTube prune engine — dynamic registration =====
 * src/yt-engine.js is NOT a manifest content script. It is registered here only
 * while yt_mode === 'full' and youtube.com is not allowlisted, so its PRESENCE in
 * the page means "prune". That is the whole design: the engine runs at
 * document_start in the MAIN world and must decide whether to prune the player
 * response synchronously, but chrome.storage is async and resolves long after the
 * response has been parsed. Gating on storage is what made the previous engine
 * prune some page loads and not others — and an inconsistently pruned player is
 * exactly what wedged into the permanent black screen. Registration is the gate. */
const YT_ENGINE_ID = 'syfs-yt-engine';
const YT_ENGINE = {
  id: YT_ENGINE_ID,
  js: ['src/yt-engine.js'],
  matches: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  allFrames: true,
  persistAcrossSessions: true
};

async function syncYtEngine() {
  try {
    const st = await chrome.storage.local.get({ yt_mode: 'full', shield_allow: [] });
    const allow = Array.isArray(st.shield_allow) ? st.shield_allow : [];
    const paused = allow.includes('youtube.com') || allow.includes('youtube-nocookie.com');
    const want = st.yt_mode === 'full' && !paused;

    const live = await chrome.scripting.getRegisteredContentScripts({ ids: [YT_ENGINE_ID] });
    const have = live.length > 0;

    if (want && !have) await chrome.scripting.registerContentScripts([YT_ENGINE]);
    else if (!want && have) await chrome.scripting.unregisterContentScripts({ ids: [YT_ENGINE_ID] });
  } catch (e) { /* registration unsupported / already gone — the guard still gates itself */ }
}

chrome.runtime.onInstalled.addListener(() => { syncYtEngine().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { syncYtEngine().catch(() => {}); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.yt_mode || changes.shield_allow) syncYtEngine().catch(() => {});
});

/* ===== يوتيوب+ — MAIN-world quality setter, dynamic registration =====
 * src/yt-plus-main.js is NOT a manifest content script either, but for a plainer
 * reason than the prune engine above: setPlaybackQualityRange lives on the page's
 * own #movie_player object, which no isolated content script can reach. Registering
 * it only while a real quality is selected means a user who leaves quality on
 * "auto" — the default — never has a MAIN-world script on youtube.com at all.
 *
 * Deliberately separate from YT_ENGINE and gated on ytp_* keys only: the ad blocker
 * and the enhancer must be able to fail independently. This one is NOT gated on the
 * shield allowlist — excluding youtube.com from ad blocking says nothing about
 * whether the user still wants their chosen resolution. */
const YTP_MAIN_ID = 'syfs-ytp-main';
const YTP_QUALITIES = ['144', '240', '360', '480', '720', '1080', '1440', '2160'];
const YTP_MAIN = {
  id: YTP_MAIN_ID,
  js: ['src/yt-plus-main.js'],
  matches: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  allFrames: false,
  persistAcrossSessions: true
};

async function syncYtpMain() {
  try {
    const st = await chrome.storage.local.get({ ytp_on: true, ytp_quality: 'auto' });
    const want = st.ytp_on !== false && YTP_QUALITIES.includes(st.ytp_quality);

    const live = await chrome.scripting.getRegisteredContentScripts({ ids: [YTP_MAIN_ID] });
    const have = live.length > 0;

    if (want && !have) await chrome.scripting.registerContentScripts([YTP_MAIN]);
    else if (!want && have) await chrome.scripting.unregisterContentScripts({ ids: [YTP_MAIN_ID] });
  } catch (e) { /* unsupported / already gone — the script self-gates on the attribute */ }
}

chrome.runtime.onInstalled.addListener(() => { syncYtpMain().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { syncYtpMain().catch(() => {}); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.ytp_quality || changes.ytp_on) syncYtpMain().catch(() => {});
});

/* ===== «الوضع الخفيف» — Lite Mode (src/speed.js) =====
 * Blocks heavy resource types via DNR dynamic rules. Reserved ids
 * 910001-910003; priority 200 so shield's per-site allowAllRequests rules
 * (priority 100) do NOT bypass Lite Mode — it keeps its own allowlist
 * (lite_allowed → excludedInitiatorDomains). Dynamic rules persist across
 * browser restarts; storage is the source of truth, re-applied onInstalled. */
const LITE_IDS = { img: 910001, font: 910002, media: 910003 };
const LITE_TYPES = { img: ['image'], font: ['font'], media: ['media'] };

/* ===== shield per-site allow rules (dynamic, range 1..RULE_ALLOW_MAX) ===== */
function dnrSerial(fn) { return serialize('dnr', fn); }
/* v0.139.4: an exception for YouTube covers its embed domain too. youtube-nocookie.com
   pages only ever live in a sub_frame of another site, so a main_frame rule for
   youtube.com never reached them — while the prune engine (syncYtEngine) and yt-guard
   already treat the two as one. The family's FIRST entry is the domain the rule is
   known by (status, mirror and the allow toggle read requestDomains[0]). */
const YT_FAMILY = ['youtube.com', 'youtube-nocookie.com'];
function allowRule(id, domain) {
  const yt = YT_FAMILY.includes(domain);
  return {
    id,
    priority: 100, // beats the priority-1 block rules
    action: { type: 'allowAllRequests' },
    condition: yt ? { requestDomains: [domain].concat(YT_FAMILY.filter((d) => d !== domain)), resourceTypes: ['main_frame', 'sub_frame'] }
                  : { requestDomains: [domain], resourceTypes: ['main_frame'] }
  };
}
/* rules made before v0.139.4 for a YouTube domain are re-issued in the family shape */
async function allowUpgradeYt() {
  const dnr = chrome.declarativeNetRequest;
  const dyn = await dnr.getDynamicRules();
  const old = dyn.filter((r) => r.action && r.action.type === 'allowAllRequests' &&
    YT_FAMILY.includes((r.condition.requestDomains || [])[0]) && (r.condition.requestDomains || []).length < YT_FAMILY.length);
  if (!old.length) return;
  await dnr.updateDynamicRules({
    removeRuleIds: old.map((r) => r.id),
    addRules: old.map((r) => allowRule(r.id, r.condition.requestDomains[0]))
  });
}
chrome.runtime.onInstalled.addListener(() => { dnrSerial(allowUpgradeYt).catch(() => {}); });
/* the lowest id in the allow range no rule holds — never `max + 1`, which walked
   straight onto the Lite ids once Lite was on (v0.139.2) */
function allowFreeId(rules) {
  const used = new Set(rules.map((r) => r.id));
  for (let id = 1; id <= RULE_ALLOW_MAX; id++) if (!used.has(id)) return id;
  throw new Error('allow-range-full');
}
/* Mirror the allowlist into storage so the cosmetic/stealth content scripts can
   honour per-site exceptions (they can't read DNR rules). DNR is the truth. */
async function shieldAllowMirror() {
  try {
    const after = await chrome.declarativeNetRequest.getDynamicRules();
    const allowedDomains = after
      .filter((r) => r.action && r.action.type === 'allowAllRequests')
      .map((r) => (r.condition.requestDomains || [])[0])
      .filter(Boolean);
    await chrome.storage.local.set({ shield_allow: allowedDomains });
  } catch (e) { /* ignore */ }
}

function applyLiteRules() { return dnrSerial(applyLiteRulesNow); }
async function applyLiteRulesNow() {
  /* ⚠️ migration (v0.139.2): an allow rule created while Lite was on could hold a Lite
     id (the old `max + 1`), and the removal below would silently delete the user's
     exception. Re-home any such rule into the allow range first. */
  const dyn = await chrome.declarativeNetRequest.getDynamicRules();
  const liteSet = new Set(Object.values(LITE_IDS));
  const squatters = dyn.filter((r) => liteSet.has(r.id) && r.action && r.action.type === 'allowAllRequests');
  if (squatters.length) {
    const keep = dyn.filter((r) => !liteSet.has(r.id));
    const moved = [];
    for (const r of squatters) {
      const d = (r.condition.requestDomains || [])[0];
      if (!d) continue;
      const id = allowFreeId(keep.concat(moved));
      moved.push(allowRule(id, d));
    }
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: squatters.map((r) => r.id), addRules: moved });
  }
  const st = await chrome.storage.local.get({ lite_img: false, lite_font: false, lite_media: false, lite_allowed: [] });
  const allowed = (Array.isArray(st.lite_allowed) ? st.lite_allowed : []).filter((d) => DNR_DOMAIN_RE.test(d));
  const addRules = [];
  ['img', 'font', 'media'].forEach((kind) => {
    if (!st['lite_' + kind]) return;
    const condition = { resourceTypes: LITE_TYPES[kind] };
    if (allowed.length) condition.excludedInitiatorDomains = allowed;
    addRules.push({ id: LITE_IDS[kind], priority: 200, action: { type: 'block' }, condition });
  });
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [LITE_IDS.img, LITE_IDS.font, LITE_IDS.media],
    addRules
  });
  if (squatters.length) await shieldAllowMirror();
}

chrome.runtime.onInstalled.addListener(() => { applyLiteRules().catch(() => {}); });

/* ===== «موفّر ذاكرة التبويبات» — tab memory saver (src/speed.js) =====
 * Discards idle background tabs (like Chrome's Memory Saver, finer control).
 * No new permissions: tabs.query()/tabs.discard() need no "tabs" permission,
 * and url/lastAccessed are visible thanks to the existing <all_urls> host
 * permission. A discarded tab stays in the tab strip and reloads on click. */

const TABSAVE_MINUTES = [5, 15, 30, 60, 120];
const TABSAVE_DEFAULTS = { tabsave_on: false, tabsave_min: 30, tabsave_pin: true, tabsave_audio: true };

/* pure — can this tab be discarded? now/threshold in ms; ignoreIdle for the
 * manual "discard now" button (all idle-eligibility rules except the clock) */
/* ⚠️ (v0.139.3) never, whatever the settings say: a meeting tab (a muted Meet call
 * makes no sound, so `audible` never saw it, and discarding it hangs up), a tab
 * whose own page asked not to be discarded (`autoDiscardable:false`), and a tab
 * that has sound right now while muted (`mutedInfo.muted` + audible). */
function tabsaveEligible(t, now, s, ignoreIdle, meetHosts) {
  if (!t || t.active || t.discarded) return false;
  if (t.autoDiscardable === false) return false;
  if (t.pinned && s.tabsave_pin) return false;
  if (t.audible && (s.tabsave_audio || (t.mutedInfo && t.mutedInfo.muted))) return false;
  const u = t.url || t.pendingUrl || '';
  if (!/^https?:/.test(u)) return false;
  if (meetName(u, meetHosts || [])) return false;
  if (ignoreIdle) return true;
  if (typeof t.lastAccessed !== 'number') return false;  /* unknown age → safe skip */
  return (now - t.lastAccessed) >= s.tabsave_min * 60000;
}

/* A half-written form dies with the discard (the reload brings back an empty one).
   Asked of the page itself, in the isolated world, reading values only — nothing
   leaves the tab but a yes/no. No answer (restricted page, hung tab) ⇒ busy: the
   memory saver is a convenience, a lost message is not. */
function tabsaveDirtyProbe() {
  try {
    const els = document.querySelectorAll('input, textarea, select');
    for (let i = 0; i < els.length && i < 3000; i++) {
      const el = els[i];
      if (el.disabled) continue;
      if (el.tagName === 'SELECT') {
        for (const o of el.options) { if (o.selected !== o.defaultSelected) return true; }
      } else if (el.type === 'checkbox' || el.type === 'radio') {
        if (el.checked !== el.defaultChecked) return true;
      } else if (el.type !== 'hidden' && el.value !== el.defaultValue) {
        return true;
      }
    }
    const a = document.activeElement;
    if (a && a.isContentEditable && (a.textContent || '').trim()) return true;
  } catch (e) {}
  return false;
}
async function tabsaveDirty(tabId) {
  try {
    const r = await Promise.race([
      chrome.scripting.executeScript({ target: { tabId, allFrames: false }, func: tabsaveDirtyProbe }),
      new Promise((res) => setTimeout(() => res(null), 1500))
    ]);
    if (!r || !r[0]) return true;
    return r[0].result !== false;
  } catch (e) { return true; }
}

async function tabsaveSweep(ignoreIdle) {
  const s = await chrome.storage.local.get(TABSAVE_DEFAULTS);
  if (!ignoreIdle && !s.tabsave_on) return 0;
  const hosts = (await meetCfg()).hosts;
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  let n = 0;
  for (const t of tabs) {
    if (!tabsaveEligible(t, now, s, !!ignoreIdle, hosts)) continue;
    if (await tabsaveDirty(t.id)) continue;
    try { await chrome.tabs.discard(t.id); n++; } catch (e) { /* tab gone/undiscardable */ }
  }
  return n;
}

async function tabsaveArm() {
  const s = await chrome.storage.local.get(TABSAVE_DEFAULTS);
  if (s.tabsave_on) chrome.alarms.create('syfs_tabsave', { periodInMinutes: 2 });
  else chrome.alarms.clear('syfs_tabsave');
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a && a.name === 'syfs_tabsave') tabsaveSweep(false).catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => { tabsaveArm().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { tabsaveArm().catch(() => {}); });

onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_TABS') return;
  (async () => {
    if (msg.op === 'status') {
      const s = await chrome.storage.local.get(TABSAVE_DEFAULTS);
      const hosts = (await meetCfg()).hosts;
      const tabs = await chrome.tabs.query({});
      const now = Date.now();
      /* counts only — no URLs/titles ever leave the worker */
      sendResponse({
        ok: true,
        on: !!s.tabsave_on, min: s.tabsave_min, pin: !!s.tabsave_pin, audio: !!s.tabsave_audio,
        total: tabs.length,
        discarded: tabs.filter((t) => t.discarded).length,
        eligible: tabs.filter((t) => tabsaveEligible(t, now, s, false, hosts)).length
      });

    } else if (msg.op === 'set') {
      const min = TABSAVE_MINUTES.indexOf(Number(msg.min)) >= 0 ? Number(msg.min) : 30;  /* whitelist */
      await chrome.storage.local.set({
        tabsave_on: !!msg.on, tabsave_min: min, tabsave_pin: !!msg.pin, tabsave_audio: !!msg.audio
      });
      await tabsaveArm();
      sendResponse({ ok: true });

    } else if (msg.op === 'discard-now') {
      const n = await tabsaveSweep(true);
      sendResponse({ ok: true, count: n });

    } else {
      sendResponse({ ok: false, error: 'bad-op' });
    }
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

// Per-tab blocked-request count on the toolbar icon (built-in DNR counter —
// no feedback permission, no browsing data read). Idempotent per worker wake.
try { chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true }); } catch (e) {}

// Static-ruleset enabled state resets to the manifest default on extension
// update — re-apply the user's saved choice.
chrome.runtime.onInstalled.addListener(async () => {
  try {
    /* Shield v2 (v0.61) one-time migration.
     * - yt_adblock (bool, default OFF) → yt_mode ('off'|'safe'|'full'). Everyone
     *   lands on 'full': the old default was OFF only because a wedged player had
     *   no way to recover, and src/yt-guard.js now reloads out of a wedge by itself.
     * - Gmail ad-hiding gets its own key; it used to ride on the YouTube toggle.
     * - The tracking blocklist was split three ways (analytics / fingerprint+session
     *   replay / pixels+beacons). All three default ON, so the domains that moved out
     *   of rules/tracking.json stay blocked and nobody silently loses protection. */
    const mig = await chrome.storage.local.get({ shield_v2_migrated: false });
    if (!mig.shield_v2_migrated) {
      await chrome.storage.local.set({
        shield_v2_migrated: true,
        yt_mode: 'full',
        yt_cosmetic: true,
        yt_shorts: true,
        yt_wedges: 0,
        yt_last: '',
        gmail_adblock: true,
        shield_fp: true,
        shield_px: true
      });
      await chrome.storage.local.remove(['yt_adblock', 'yt_optin_migrated']);
    }

    /* ⚠️ `shield_ads` defaults to FALSE (v0.87.0): ad blocking is opt-in. The other
     * three (tracking / fingerprint / pixels) are privacy blocking and keep their
     * on-by-default. Note the asymmetry below — `shield_ads === true` demands an
     * explicit yes, while `!== false` grants the others the benefit of an absent key.
     * A saved choice still wins in both directions: the toggle writes the key, so a
     * user who switched ad blocking ON keeps it on across this update. */
    const st = await chrome.storage.local.get({
      shield_ads: false, shield_trk: true, shield_fp: true, shield_px: true
    });
    /* syfs_youtube ALWAYS enabled (protective allow rule — see DNR_RULESETS note);
     * the four blocklists follow the user's saved on/off choice. Static rulesets
     * reset to their manifest default on every extension update, so this has to
     * re-apply the saved state each time. */
    const want = {
      syfs_ads: st.shield_ads === true,
      syfs_tracking: st.shield_trk !== false,
      syfs_fingerprint: st.shield_fp !== false,
      syfs_pixels: st.shield_px !== false
    };
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: ['syfs_youtube'].concat(Object.keys(want).filter((k) => want[k])),
      disableRulesetIds: Object.keys(want).filter((k) => !want[k])
    });
  } catch (e) {}
});

onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_DNR') return;
  const dnr = chrome.declarativeNetRequest;
  (async () => {
    if (msg.op === 'status') {
      const enabled = await dnr.getEnabledRulesets();
      const dyn = await dnr.getDynamicRules();
      const allowed = dyn
        .filter((r) => r.action && r.action.type === 'allowAllRequests')
        .map((r) => (r.condition.requestDomains || [])[0])
        .filter(Boolean);
      sendResponse({
        ok: true,
        ads: enabled.includes('syfs_ads'),
        tracking: enabled.includes('syfs_tracking'),
        fingerprint: enabled.includes('syfs_fingerprint'),
        pixels: enabled.includes('syfs_pixels'),
        youtube: enabled.includes('syfs_youtube'),
        allowed
      });

    } else if (msg.op === 'toggle') {
      const id = DNR_RULESETS[msg.ruleset];
      if (!id) { sendResponse({ ok: false, error: 'bad-ruleset' }); return; }
      await dnr.updateEnabledRulesets(msg.on ? { enableRulesetIds: [id] } : { disableRulesetIds: [id] });
      await chrome.storage.local.set({ [DNR_STORE_KEY[msg.ruleset]]: !!msg.on });
      sendResponse({ ok: true });

    } else if (msg.op === 'allow') {
      // validate before use — the domain comes from a content script
      const domain = String(msg.domain || '').toLowerCase().replace(/^www\./, '');
      if (!DNR_DOMAIN_RE.test(domain) || domain.length > 253) { sendResponse({ ok: false, error: 'bad-domain' }); return; }
      /* read-pick-write on the dynamic rules runs one at a time: two toggles at once
         read the same list and pick the same free id — the second throws */
      await dnrSerial(async () => {
        const dyn = await dnr.getDynamicRules();
        const existing = dyn.find((r) => r.action && r.action.type === 'allowAllRequests' && (r.condition.requestDomains || [])[0] === domain);
        if (msg.on && !existing) {
          await dnr.updateDynamicRules({ addRules: [allowRule(allowFreeId(dyn), domain)] });
        } else if (!msg.on && existing) {
          await dnr.updateDynamicRules({ removeRuleIds: [existing.id] });
        }
        await shieldAllowMirror();
      });
      sendResponse({ ok: true });

    } else if (msg.op === 'lite-status') {
      const st = await chrome.storage.local.get({ lite_img: false, lite_font: false, lite_media: false, lite_allowed: [] });
      sendResponse({
        ok: true, img: !!st.lite_img, font: !!st.lite_font, media: !!st.lite_media,
        allowed: Array.isArray(st.lite_allowed) ? st.lite_allowed : []
      });

    } else if (msg.op === 'lite-toggle') {
      // explicit whitelist — msg.kind comes from a content script
      if (msg.kind !== 'img' && msg.kind !== 'font' && msg.kind !== 'media') { sendResponse({ ok: false, error: 'bad-kind' }); return; }
      await chrome.storage.local.set({ ['lite_' + msg.kind]: !!msg.on });
      await applyLiteRules();
      sendResponse({ ok: true });

    } else if (msg.op === 'lite-allow') {
      // validate before use — the domain comes from a content script
      const domain = String(msg.domain || '').toLowerCase().replace(/^www\./, '');
      if (!DNR_DOMAIN_RE.test(domain) || domain.length > 253) { sendResponse({ ok: false, error: 'bad-domain' }); return; }
      /* two tabs toggling at once must not drop each other's domain */
      await serialize('lite_allowed', async () => {
        const st = await chrome.storage.local.get({ lite_allowed: [] });
        let list = Array.isArray(st.lite_allowed) ? st.lite_allowed : [];
        if (msg.on) { if (list.indexOf(domain) < 0) list = list.concat([domain]); }
        else { list = list.filter((d) => d !== domain); }
        await chrome.storage.local.set({ lite_allowed: list });
      });
      await applyLiteRules();
      sendResponse({ ok: true });

    } else {
      sendResponse({ ok: false, error: 'bad-op' });
    }
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});

/* ===== حارس الاجتماعات (v0.120.0) — src/wa-privacy.js (the two chat tools share one setting) =====
 * When a tab lands on an online-meeting site the user is about to share a screen or
 * a camera, and an unblurred WhatsApp/Messenger tab is the thing that leaks. The
 * worker is the only party that sees every tab, so it does the watching:
 *   tabs.onUpdated → meetName(url) → first meeting tab of a session → ONE question,
 *   asked inside the meeting tab (SYFS_MEET_ASK → the rail's toast) or, when that
 *   tab cannot show it, as a browser notification with two buttons.
 * «yes» sets wa_blur.on / ms_blur.on (the flags every chat tab already follows) and
 * remembers what they were; when the LAST meeting tab closes the flags go back.
 * The session record lives in chrome.storage.session: memory-only, survives the
 * worker being torn down, gone with the browser — a stale «asked» can never outlive
 * the meeting it belonged to.
 * Reads a URL's host + path only to classify it; nothing is stored about the page. */
const MEET_HOSTS = [
  [/(^|\.)meet\.google\.com$/, /^\/([a-z]{3}-[a-z]{4}-[a-z]{3}|new|lookup\/|_meet\/)/, 'Google Meet'],   /* a code, not the landing page */
  [/(^|\.)zoom\.us$/, /^\/(j|wc|s|w|my)\//, 'Zoom'],
  [/(^|\.)teams\.(microsoft|live)\.com$/, /./, 'Microsoft Teams'],
  [/(^|\.)webex\.com$/, /^\/(meet|join|webappng|wbxmjs)/, 'Webex'],
  [/^(www\.)?whereby\.com$/, /^\/[^/]+/, 'Whereby'],
  [/^meet\.jit\.si$/, /^\/./, 'Jitsi'],
  [/^discord\.com$/, /^\/channels\//, 'Discord'],
  [/^web\.skype\.com$/, /./, 'Skype'],
  [/(^|\.)gotomeeting\.com$/, /^\/(join|meeting)/, 'GoToMeeting'],
  [/(^|\.)bluejeans\.com$/, /./, 'BlueJeans']
];
const MEET_DEFAULTS = { on: true, mode: 'ask', wa: true, ms: true, lockToo: false, restore: true, hosts: [] };
const MEET_STATE_KEY = 'meet_state';
const MEET_NOTIF = 'syfs-meet';

function meetNorm(raw) {
  const c = Object.assign({}, MEET_DEFAULTS);
  if (raw && typeof raw === 'object') {
    c.on = raw.on !== false;
    c.mode = raw.mode === 'auto' ? 'auto' : 'ask';
    c.wa = raw.wa !== false;
    c.ms = raw.ms !== false;
    c.lockToo = raw.lockToo === true;
    c.restore = raw.restore !== false;
    /* user-added hosts: validated on the way in AND here — the panel is the only
       writer today, but a hand-edited settings import is not */
    c.hosts = Array.isArray(raw.hosts)
      ? raw.hosts.map((h) => String(h || '').toLowerCase()).filter((h) => DNR_DOMAIN_RE.test(h) && h.length <= 253).slice(0, 20)
      : [];
  }
  return c;
}
async function meetCfg() {
  const st = await chrome.storage.local.get({ meetguard: null });
  return meetNorm(st.meetguard);
}
function meetName(url, extra) {
  let u;
  try { u = new URL(String(url || '')); } catch (e) { return ''; }
  if (u.protocol !== 'https:') return '';
  const host = u.hostname.toLowerCase(), path = u.pathname || '/';
  for (const [h, p, name] of MEET_HOSTS) { if (h.test(host) && p.test(path)) return name; }
  for (const d of (extra || [])) { if (host === d || host.endsWith('.' + d)) return d; }
  return '';
}
async function meetState() {
  try {
    const st = await chrome.storage.session.get({ [MEET_STATE_KEY]: null });
    const s = st[MEET_STATE_KEY];
    if (s && typeof s === 'object' && Array.isArray(s.tabs)) return s;
  } catch (e) {}
  return { tabs: [], asked: false, applied: false, prev: null };
}
async function meetSetState(s) {
  try { await chrome.storage.session.set({ [MEET_STATE_KEY]: s }); } catch (e) {}
}
/* ⚠️ every read-modify-write of meet_state runs through this one queue. Opening a
   meeting fires onUpdated several times (url, then status) and a tab can close while
   the first is mid-await: two copies read the same state, each writes its own, and
   the last write wins — a tab dropped from `tabs`, or `prev` overwritten with the
   already-blurred flags so «restore» never un-blurs. Entry points only: nothing
   inside the queue calls meetSerial again (that would wait on itself). */
function meetSerial(fn) { return serialize('meet', fn); }

/* flip the flags on, remembering what they were */
async function meetApply(cfg) {
  const st = await chrome.storage.local.get({ wa_blur: null, ms_blur: null });
  const s = await meetState();
  if (!s.applied) {
    s.prev = { wa: !!(st.wa_blur && st.wa_blur.on), ms: !!(st.ms_blur && st.ms_blur.on) };
  }
  s.applied = true;
  const put = {};
  if (cfg.wa) put.wa_blur = Object.assign({}, st.wa_blur || {}, { on: true });
  if (cfg.ms) put.ms_blur = Object.assign({}, st.ms_blur || {}, { on: true });
  if (cfg.lockToo) {
    /* the lock page ignores the command unless a password is set — harmless otherwise */
    const t = Date.now();
    if (cfg.wa) put.wa_lock_cmd = { op: 'lock', t };
    if (cfg.ms) put.ms_lock_cmd = { op: 'lock', t };
  }
  await meetSetState(s);
  if (Object.keys(put).length) await chrome.storage.local.set(put);
}
/* put the flags back to what they were before the meeting */
async function meetRestore(s) {
  if (!s.applied || !s.prev) return;
  const cfg = await meetCfg();
  const st = await chrome.storage.local.get({ wa_blur: null, ms_blur: null });
  const put = {};
  if (cfg.wa) put.wa_blur = Object.assign({}, st.wa_blur || {}, { on: !!s.prev.wa });
  if (cfg.ms) put.ms_blur = Object.assign({}, st.ms_blur || {}, { on: !!s.prev.ms });
  await chrome.storage.local.set(put);
}
/* the last meeting tab is gone: restore (if asked to) and forget the session */
async function meetEnd() {
  const s = await meetState();
  if (s.applied && (await meetCfg()).restore) await meetRestore(s);
  await meetSetState({ tabs: [], asked: false, applied: false, prev: null });
}

/* the question — in the meeting tab when its rail is up, else a notification */
async function meetAsk(tabId, name, auto) {
  const type = auto ? 'SYFS_MEET_AUTO' : 'SYFS_MEET_ASK';
  for (let i = 0; i < 4; i++) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type, name });
      if (r && r.ok) return;
    } catch (e) {}
    await new Promise((res) => setTimeout(res, 1500));
  }
  if (auto) return;                      /* nothing to answer; the flags are already on */
  await wtLoad();
  try {
    chrome.notifications.create(MEET_NOTIF, {
      type: 'basic', iconUrl: 'icons/icon128.png', requireInteraction: true,
      title: wt('حارس الاجتماعات'),
      message: wt('تبويب {0} مفتوح — تفعيل خصوصية واتساب وماسنجر (تمويه المحادثات)؟', name),
      buttons: [{ title: wt('نعم، فعّل') }, { title: wt('لا') }]
    });
  } catch (e) {}
}
try {
  chrome.notifications.onButtonClicked.addListener((id, idx) => {
    if (id !== MEET_NOTIF) return;
    chrome.notifications.clear(id);
    if (idx === 0) meetSerial(() => meetCfg().then(meetApply)).catch(() => {});
  });
} catch (e) {}

async function meetEval(tabId, url) {
  /* the state change is queued; the question (up to ~6s of retries) is asked after,
     outside the queue, so it never holds up a tab closing */
  const ask = await meetSerial(async () => {
    const cfg = await meetCfg();
    const name = cfg.on ? meetName(url, cfg.hosts) : '';
    const s = await meetState();
    const had = s.tabs.indexOf(tabId) >= 0;
    if (name && !had) s.tabs.push(tabId);
    if (!name && had) s.tabs = s.tabs.filter((id) => id !== tabId);
    if (name && !had && !s.asked) {
      s.asked = true;
      await meetSetState(s);
      if (cfg.mode === 'auto') await meetApply(cfg);
      return { name, auto: cfg.mode === 'auto' };
    }
    await meetSetState(s);
    if (!s.tabs.length && (s.applied || s.asked)) await meetEnd();
    return null;
  });
  if (ask) await meetAsk(tabId, ask.name, ask.auto);
}
async function meetDrop(tabId) {
  const s = await meetState();
  if (s.tabs.indexOf(tabId) < 0) return;
  s.tabs = s.tabs.filter((id) => id !== tabId);
  await meetSetState(s);
  if (!s.tabs.length) await meetEnd();
}
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!info || (!info.url && info.status !== 'complete')) return;
  const url = info.url || (tab && tab.url) || '';
  if (!url) return;
  meetEval(tabId, url).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => { meetSerial(() => meetDrop(tabId)).catch(() => {}); });

/* ===== قفل واتساب/ماسنجر: إشعارات النظام أثناء القفل (v0.139.3, src/wa-lock.js) =====
 * The page's Notification is a MAIN-world object; wa-lock.js runs isolated and asks
 * for this wrapper once. Runs in the page, so it is self-contained and reads only the
 * DOM attribute the lock sets: present ⇒ the generic title replaces sender + text and
 * body/icon/image are dropped; absent ⇒ the call passes through unchanged. `tag` and
 * `data` survive (they are not displayed, and the site's click routing needs them). */
const LOCK_GUARD_HOSTS = ['web.whatsapp.com', 'www.messenger.com', 'www.facebook.com', 'web.facebook.com']; /* = wa-lock.js HOSTS */
function lockNotifGuard() {
  if (window.__syfsLockNG) return;
  window.__syfsLockNG = 1;
  const held = () => { const r = document.documentElement; return r ? r.getAttribute('data-syfs-locked') : null; };
  const mask = (title, opts) => {
    const g = held();
    if (!g) return [title, opts];
    const o = opts || {};
    return [g, { tag: o.tag, data: o.data, silent: !!o.silent }];
  };
  const N = window.Notification;
  if (typeof N === 'function') {
    const G = function Notification(title, opts) { const a = mask(title, opts); return new N(a[0], a[1]); };
    G.prototype = N.prototype;
    Object.defineProperty(G, 'permission', { get: () => N.permission });
    G.requestPermission = N.requestPermission.bind(N);
    try { Object.defineProperty(G, 'maxActions', { get: () => N.maxActions }); } catch (e) {}
    window.Notification = G;
  }
  const SR = window.ServiceWorkerRegistration;
  if (SR && SR.prototype && typeof SR.prototype.showNotification === 'function') {
    const show = SR.prototype.showNotification;
    SR.prototype.showNotification = function (title, opts) { const a = mask(title, opts); return show.call(this, a[0], a[1]); };
  }
}
onMsg((msg, sender) => {
  if (!msg || msg.type !== 'SYFS_LOCK_GUARD') return;
  const tab = sender && sender.tab;
  let host = '';
  try { host = new URL(sender.url || '').hostname; } catch (e) {}
  if (!tab || tab.id == null || LOCK_GUARD_HOSTS.indexOf(host) < 0) return;   /* the four lock hosts only */
  chrome.scripting.executeScript({
    target: { tabId: tab.id, frameIds: [sender.frameId || 0] },
    world: 'MAIN', injectImmediately: true, func: lockNotifGuard
  }).catch(() => {});
});

/* the answer from the toast in the meeting tab, and the panel's status line */
onMsg((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SYFS_MEET') return;
  (async () => {
    const op = String(msg.op || '');
    if (op === 'yes') {
      await meetSerial(async () => meetApply(await meetCfg()));
    } else if (op === 'always') {
      await meetSerial(async () => {
        const st = await chrome.storage.local.get({ meetguard: null });
        const cfg = meetNorm(st.meetguard); cfg.mode = 'auto';
        await chrome.storage.local.set({ meetguard: cfg });
        await meetApply(cfg);
      });
    } else if (op === 'undo') {
      /* «تراجع» on the auto toast: restore now, keep the session marked as asked */
      await meetSerial(async () => {
        const s = await meetState();
        await meetRestore(s);
        s.applied = false; s.prev = null;
        await meetSetState(s);
      });
    } else if (op === 'status') {
      const s = await meetState();
      sendResponse({ ok: true, tabs: s.tabs.length, applied: !!s.applied });
      return;
    } else if (op !== 'no') {
      sendResponse({ ok: false, error: 'bad-op' });
      return;
    }
    sendResponse({ ok: true });
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async sendResponse
});
