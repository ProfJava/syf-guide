/* SYF — «مفاتيح المساعد الذكي»: إدخال اعتمادات المزوّد على صفحة الإضافة (v0.104.0).
 *
 * ⛔ سبب وجود هذه الصفحة أمنيّ لا تنظيميّ. حتى v0.103.0 كانت لوحة ⚙ للمساعد تُبنى داخل
 * الشريط، والشريط يعيش في `attachShadow({mode:'open'})` على **صفحة الموقع الذي تتصفّحه**
 * ⇒ أي سكربت في تلك الصفحة يقرأ:
 *     document.getElementById('syfs-host').shadowRoot.querySelector('.cfg-key').value
 * وحتى نقرةٌ مصطنعة منه تفتح اللوحة وتملأ الحقل بالمفتاح المحفوظ. أُثبِت عملياً.
 * `type="password"` يخفي البكسل لا القيمة، و`mode:'closed'` ليس علاجاً (الصفحة تلتقط الجذر
 * بترقيع `attachShadow` قبل حقننا). العلاج الوحيد: **ألّا يوجد الاعتماد في تلك الصفحة أصلاً**
 * — نفس القرار المكتوب في `src/vault-launch.js` منذ البداية: «لا تلمس الأسرارُ سياقَ الصفحة».
 *
 * الجدول واحد: `SYFS.ai.PROVIDERS` المُعرَّف في `src/ai-chat.js` (تحمّله هذه الصفحة) —
 * نسخة ثانية من أسماء الحقول والتلميحات كانت ستنحرف عن الأولى بعد إصدارين.
 */
(function () {
  var store = (window.SYFS && SYFS.store) || null;
  var PROVIDERS = (window.SYFS && SYFS.ai && SYFS.ai.PROVIDERS) || {};

  /* المضيف الوحيد المسموح لـPROF في `ALLOWED` بالعامل الخلفي. اللوحة القديمة كانت تطلب
     «عنوان الـAPI لموقعك» بينما المُرحِّل يرفض كل ما عداه ⇒ وعدٌ لا يمكن الوفاء به، وفشلٌ
     برسالة عامة لا تقول السبب. نقولها هنا قبل الحفظ لا بعد أول رسالة تفشل. */
  var PROF_HOST = 'appps.net';

  /* i18n-via: T — تمرّ بالقاموس متى وُجد (الصفحة تحمّل `src/i18n.js` قبلها) */
  function T(s, a) { return (window.SYFS && SYFS.t) ? SYFS.t(s, a) : s; }
  function $(id) { return document.getElementById(id); }

  var selEl   = $('ak-provider');
  var baseEl  = $('ak-base');
  var tokenEl = $('ak-token');
  var modelEl = $('ak-model');
  var keyEl   = $('ak-key');
  var keyLbl  = $('ak-keylbl');
  var stateEl = $('ak-state');
  var hintEl  = $('ak-hint');
  var errEl   = $('ak-err');
  var toastEl = $('toast');

  var toastT = 0;
  function toast(msg) {
    toastEl.textContent = msg;                      /* نصّ مُترجَم جاهز، لا markup */
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }
  function fail(msg) { errEl.textContent = msg; errEl.classList.remove('hide'); }
  function clearFail() { errEl.textContent = ''; errEl.classList.add('hide'); }

  /* أسماء المفاتيح: PROF يحتفظ ببادئة `sam_` (عقد الخادم + إعدادات محفوظة سلفاً)،
     وبقيّة المزوّدين `ai_<provider>_*` — نفس ما يقرأه `loadCfg` في `ai-chat.js`. */
  function keyName(p)   { return p === 'prof' ? 'sam_app_key' : 'ai_' + p + '_key'; }
  function modelName(p) { return 'ai_' + p + '_model'; }

  function syncFields(p) {
    var meta = PROVIDERS[p] || {};
    document.querySelectorAll('.ak-f').forEach(function (f) {
      var forList = (f.getAttribute('data-for') || '').split(' ');
      f.style.display = forList.indexOf(p) >= 0 ? '' : 'none';
    });
    if (meta.keyLabel) keyLbl.textContent = T(meta.keyLabel);
    hintEl.textContent = meta.hint ? T(meta.hint) : '';
    modelEl.placeholder = meta.model || 'model';    /* i18n-dyn: مُعرّف موديل لا نثر */
  }

  /* ⛔ المفتاح المحفوظ **لا يُطبع في أي حقل**، حتى هنا. الصفحة آمنة، لكن قيمةً لا يحتاجها
     أحد على الشاشة هي قيمة تُلتقط بلقطة شاشة أو تُقرأ من فوق الكتف بلا سبب. الحالة تكفي:
     «محفوظ» أو «لا مفتاح»، والحقل الفارغ عند الحفظ يعني «أبقِ المحفوظ كما هو». */
  function fill(p) {
    clearFail();
    selEl.value = p;
    syncFields(p);
    keyEl.value = '';
    keyEl.type = 'password';
    $('ak-show').textContent = T('إظهار');
    var jobs = [store.get(keyName(p), '')];
    jobs.push(p === 'prof' ? store.get('sam_api_base', '') : store.get(modelName(p), ''));
    jobs.push(p === 'prof' ? store.get('sam_bot_token', '') : Promise.resolve(''));
    Promise.all(jobs).then(function (v) {
      stateEl.textContent = v[0] ? T('مفتاح محفوظ ✓ — اترك الحقل فارغاً لإبقائه، أو ألصق مفتاحاً جديداً ليحلّ محلّه.')
                                 : T('لا مفتاح محفوظ لهذا المزوّد.');
      /* the assistant token is a credential like the key (wipe() removes both): never printed
         back — only its last 4, as a placeholder; an empty field on save keeps it */
      if (p === 'prof') { baseEl.value = v[1] || ''; tokenEl.value = ''; tokenEl.placeholder = /* i18n-dyn: a masked credential, not a label */ v[2] ? '•••• ' + String(v[2]).slice(-4) : ''; }
      else { modelEl.value = v[1] || ''; }
    });
  }

  function save() {
    clearFail();
    var p = selEl.value;
    if (!PROVIDERS[p]) { fail(T('مزوّد غير معروف.')); return; }   /* قائمة بيضاء: يُرفض ولا يُصحَّح */
    var key = (keyEl.value || '').trim();

    if (p === 'prof') {
      var base = (baseEl.value || '').trim();
      var token = (tokenEl.value || '').trim();
      var u = null;
      try { u = new URL(base); } catch (e) { u = null; }
      /* رفض لا تنظيف (§4.1): العنوان ينتهي في نداء شبكة، ومضيفٌ خارج القائمة يرفضه العامل
         على أي حال — فالأصدق أن يُقال هنا بدل رسالة «تعذّر الاتصال» بعد أول سؤال. */
      /* ⚠️ المضيف بالضبط لا نطاقاً فرعيّاً: `ALLOWED` في العامل تحمل `https://appps.net/`
         وحدها، فقبولُ `sam.appps.net` هنا كان يحفظ عنواناً يُحجب عند أوّل سؤال — وهو
         بالضبط الوعد الذي وُجد هذا الفحص ليمنعه. */
      if (!u || u.protocol !== 'https:' || u.hostname !== PROF_HOST) {
        fail(T('عنوان الـ API يجب أن يكون https على {0} بالضبط — وهو المضيف الوحيد الذي يسمح به العامل لمزوّد بروف.', PROF_HOST));
        return;
      }
      /* empty = keep the saved token; required only when none is saved yet */
      store.get('sam_bot_token', '').then(function (saved) {
        if (!token && !saved) { fail(T('معرّف المساعد (token) مطلوب.')); return; }
        store.set('sam_api_base', base);
        if (token) store.set('sam_bot_token', token);
        tokenEl.value = '';
        commit(p, key);
      });
      return;
    }
    store.set(modelName(p), (modelEl.value || '').trim() || (PROVIDERS[p].model || ''));
    commit(p, key);
  }
  function commit(p, key) {
    store.set('ai_provider', p);
    if (key) store.set(keyName(p), key);
    /* حقل فارغ لا يمسح مفتاحاً — المسح فعلٌ مستقلّ بزرّه، وإلّا مسحه من فتح الصفحة وحفظ الموديل. */
    keyEl.value = '';
    toast(T('تم الحفظ ✓'));
    fill(p);
  }

  /* تأكيد بنقرتين بدل `confirm()` — نفس نمط «إعادة تعيين» في لوحة الشريط: حوار المتصفّح
     يجمّد الصفحة ويبدو غريباً على سطح الإضافة. */
  var delArmed = false, delT = 0;
  function wipe(btn) {
    var p = selEl.value;
    if (!delArmed) {
      delArmed = true;
      btn.textContent = T('⚠ اضغط للتأكيد');
      delT = setTimeout(function () { delArmed = false; btn.textContent = T('حذف المفتاح المحفوظ'); }, 4000);
      return;
    }
    clearTimeout(delT); delArmed = false; btn.textContent = T('حذف المفتاح المحفوظ');
    var keys = [keyName(p)];
    if (p === 'prof') keys.push('sam_bot_token');   /* المعرّف اعتمادٌ كالمفتاح، والعنوان ليس كذلك */
    try {
      chrome.storage.local.remove(keys, function () {
        void chrome.runtime.lastError;
        toast(T('حُذف المفتاح المحفوظ.'));
        fill(p);
      });
    } catch (e) { fail(T('تعذّر الحذف.')); }
  }

  function boot() {
    if (!store) { fail(T('تعذّر الوصول للتخزين.')); return; }
    selEl.addEventListener('change', function () { fill(selEl.value); });
    $('ak-save').addEventListener('click', save);
    $('ak-clear').addEventListener('click', function () { wipe(this); });
    $('ak-show').addEventListener('click', function () {
      var show = keyEl.type === 'password';
      keyEl.type = show ? 'text' : 'password';
      this.textContent = show ? T('إخفاء') : T('إظهار');
    });
    keyEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
    store.get('ai_provider', 'prof').then(function (p) { fill(PROVIDERS[p] ? p : 'prof'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());
