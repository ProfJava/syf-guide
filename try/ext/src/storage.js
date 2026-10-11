/* SYF — tiny promise wrapper around chrome.storage.local.
 * Extension-scoped persistence (NOT the host page's localStorage). */
(function () {
  window.SYFS = window.SYFS || {};

  /* ===== one storage call per tick, not one per key (v0.139.5) =====
   * Page load asked chrome.storage for ~25 keys one at a time (the rail's first read
   * alone is 14, speed.js adds 5) — each a separate IPC round-trip to the browser.
   * `get()` now queues and a microtask sends ONE `get([...keys])` for everything asked
   * in the same synchronous run. Same contract per call (value, or the fallback).
   * ⛔ ORDER is kept: `set()` flushes the queue first, so a get issued before a set
   *    still reads the value from before it — exactly as when each get went out at once. */
  let pend = null;
  function flush() {
    const batch = pend; pend = null;
    if (!batch) return;
    const keys = [];
    batch.forEach((q) => { if (keys.indexOf(q.key) < 0) keys.push(q.key); });
    const answer = (res) => batch.forEach((q) => {
      const v = res && Object.prototype.hasOwnProperty.call(res, q.key) ? res[q.key] : undefined;
      q.resolve(v === undefined ? q.fallback : v);
    });
    try { chrome.storage.local.get(keys, answer); } catch (e) { answer(null); }
  }

  SYFS.store = {
    get(key, fallback) {
      return new Promise((resolve) => {
        if (!pend) { pend = []; Promise.resolve().then(flush); }
        pend.push({ key: key, fallback: fallback, resolve: resolve });
      });
    },
    set(key, value) {
      flush();
      return new Promise((resolve) => {
        try { chrome.storage.local.set({ [key]: value }, () => resolve()); }
        catch (e) { resolve(); }
      });
    }
  };

  /* ===== ملفّ الإعدادات: سياسة واحدة لبابين (v0.139.1) =====
   * «تصدير/استيراد» له بابان: لوحة إدارة الشريط (`rail.js`) وصفحة المساعدة (`help.js`).
   * حتى v0.139.0 كانت التصفية في الأوّل وحده، فكان الثاني يصدّر مفاتيح المزوّدين وكتلة
   * الخزنة وبصمة القفل نصّاً صريحاً، ويستورد أي JSON كما هو. ⛔ لا تُكرَّر هذه القواعد في
   * بابٍ ثالث — يستدعي `SYFS.prefs` (§5.11/3). المجهول يسقط إلى الافتراضي (§4.1). */
  var POS_VALUES = ['right', 'left', 'top', 'bottom'];
  /* شكل أزرار رأس النافذة (v0.151.0): الحالي · الحالي مع فاصل بين المجموعتين (الافتراضي) · إشارات ماك */
  var WINBTN_VALUES = ['classic', 'sep', 'mac'], WINBTN_DEFAULT = 'sep';
  function pickOne(list, v, def) { return list.indexOf(v) >= 0 ? v : def; }
  /* `tool_order` خريطة: كل قيمة يجب أن تكون مصفوفة معرّفات — نُسقط العضو الشاذّ وحده. */
  function cleanOrderMap(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    var out = {};
    Object.keys(v).forEach(function (k) { if (Array.isArray(v[k])) out[k] = v[k]; });
    return out;
  }
  /* ⛔ اعتمادات لا تسافر مع التفضيلات: مفاتيح المزوّدين · معرّف بروف · كتلة الخزنة · بصمة
     قفل واتساب وماسنجر. و`tab_sessions` ليست اعتماداً لكنها قائمة صفحات كانت مفتوحة —
     سجلّ تصفّح يبقى على هذا الجهاز. */
  var SECRET_KEYS = /^(ai_[a-z0-9]+_key|sam_app_key|sam_bot_token|vault_|wa_lock$|ms_lock$|tab_sessions$|kids_pin$)/;
  var ARRAY_KEYS = ['hidden_tools', 'hidden_cats', 'cat_order', 'custom_links'];

  SYFS.prefs = {
    POS_VALUES: POS_VALUES,
    WINBTN_VALUES: WINBTN_VALUES,
    WINBTN_DEFAULT: WINBTN_DEFAULT,
    SECRET_KEYS: SECRET_KEYS,
    pickOne: pickOne,
    cleanOrderMap: cleanOrderMap,
    /* all = نتيجة `storage.local.get(null)` ⇒ { out, dropped } */
    exportable: function (all) {
      var out = {}, dropped = 0;
      Object.keys(all || {}).forEach(function (k) {
        if (SECRET_KEYS.test(k)) { dropped++; return; }
        out[k] = all[k];
      });
      return { out: out, dropped: dropped };
    },
    /* obj = JSON مستورد (مُتحقَّق أنه كائن) · styles = معرّفات أشكال الشريط إن عُرفت.
       صفحة المساعدة لا تحمّل `rail.js` فلا تعرفها: تقبل عندها معرّفاً بصيغة آمنة، والشريط
       يُمرّره بقائمته البيضاء عند القراءة على أي حال. ⇒ { clean, skipped } */
    cleanImport: function (obj, styles) {
      var clean = {}, skipped = 0;
      Object.keys(obj).forEach(function (k) {
        var v = obj[k];
        if (SECRET_KEYS.test(k)) { skipped++; return; }
        if (k === 'tool_order') { v = cleanOrderMap(v); }
        else if (k === 'pos') { v = pickOne(POS_VALUES, v, 'right'); }
        else if (k === 'winbtn') { v = pickOne(WINBTN_VALUES, v, WINBTN_DEFAULT); }
        /* any colour is allowed now, so the shape is the whole check — it lands in style properties */
        else if (k === 'accent' && (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v))) { skipped++; return; }
        else if (k === 'cstyle') {
          if (styles) v = pickOne(styles, v, 'solid');
          else if (typeof v !== 'string' || !/^[a-z][a-z0-9-]{0,23}$/.test(v)) { skipped++; return; }
        } else if (ARRAY_KEYS.indexOf(k) >= 0 && !Array.isArray(v)) { skipped++; return; }
        clean[k] = v;
      });
      return { clean: clean, skipped: skipped };
    }
  };

  /* Cross-origin fetch via the service worker (MV3 content scripts can't do it directly). */
  SYFS.bgFetch = function (url, opts) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(Object.assign({ type: 'SYFS_FETCH', url: url }, opts || {}), (res) => {
          if (chrome.runtime.lastError || !res) { resolve({ ok: false, error: 'no-response' }); return; }
          resolve(res);
        });
      } catch (e) { resolve({ ok: false, error: String(e) }); }
    });
  };
}());
