/* SYF — «بروف» (PROF) AI assistant tool.
 *
 * Display name is "بروف" (PROF). The user picks a provider and connects with
 * THEIR OWN credentials — nothing is shipped: no default endpoint, no default
 * token, no key. Supported providers:
 *   - prof   : the SAM AI backend (WordPress plugin) — user enters base + token + key.
 *   - claude : Anthropic  — POST https://api.anthropic.com/v1/messages
 *   - openai : ChatGPT    — POST https://api.openai.com/v1/chat/completions
 *   - gemini : Google     — POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *
 * All network goes through SYFS.bgFetch → the MV3 service worker (content scripts
 * can't do cross-origin fetch). The worker's ALLOWED list is limited to these four
 * fixed hosts. The user's API key lives only in chrome.storage.local (extension
 * scope), is sent only to its provider, and is NEVER logged or shown in the log.
 *
 * ⛔ ومنذ v0.104.0: **لا يُدخَل الاعتماد ولا يُعرَض في هذه اللوحة إطلاقاً.** ⚙ تفتح
 * `aikeys.html` — صفحة الإضافة نفسها. حتى v0.103.0 كان الحقل هنا، داخل shadow root
 * **مفتوح** على صفحة الموقع المُتصفَّح، فكان أي سكربت في تلك الصفحة يفتح اللوحة بنقرة
 * مصطنعة ويقرأ `.cfg-key.value`. المفتاح ما زال يُقرأ هنا ليُبنى به الطلب — وهذا في
 * العالم المعزول لا تصله الصفحة — لكنه **لا يهبط إلى DOM** بعد اليوم.
 *
 * Loaded BEFORE src/rail.js so SYFS.tools / SYFS.cats are populated when the rail
 * is built. Storage keys keep the sam_ prefix for PROF (server contract + any
 * already-saved settings); per-provider keys use ai_<provider>_*.
 */
(function () {
  window.SYFS = window.SYFS || {};
  var store = SYFS.store;

  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    /* the template's own text IS the msgid — translate the built tree rather than
       splitting the markup (see src/i18n.js). Free in the default language. */
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }

  /* Provider catalogue. These are GENERIC (public API shapes + model defaults) —
     NOT secrets and NOT tied to any account. No endpoint here talks to anyone
     until the user pastes their own key. */
  var PROVIDERS = {
    /* ⚠️ التلميح يسمّي المضيف المسموح صراحةً: `ALLOWED` في العامل تقصر بروف على
       `appps.net`، وطلبُ «عنوان موقعك» كان يَعِد بما يرفضه المُرحِّل ثم يفشل برسالة عامّة. */
    /* بلا `hint` وبلا placeholder في `aikeys.html` (v0.132.1): تلميح بروف كان يطبع عنوان
       الخادم ومسار الـAPI على الشاشة لكل من يفتح الصفحة — ومن يملك اعتماداً لبروف يعرف
       عنوانه سلفاً. الفحص في `src/ai-keys.js` باقٍ كما هو؛ الحذف عرضٌ لا تخفيف. */
    prof:   { label: 'بروف (PROF)',        needs: ['base', 'token', 'key'], keyLabel: 'مفتاحك (X-Sam-App-Key)' },
    claude: { label: 'Claude (Anthropic)', needs: ['key', 'model'], keyLabel: 'مفتاح Anthropic API', model: 'claude-3-5-sonnet-latest', hint: 'أنشئ مفتاحاً من console.anthropic.com ← API Keys.' },
    openai: { label: 'ChatGPT (OpenAI)',   needs: ['key', 'model'], keyLabel: 'مفتاح OpenAI API',    model: 'gpt-4o-mini',              hint: 'أنشئ مفتاحاً من platform.openai.com ← API keys.' },
    gemini: { label: 'Gemini (Google)',    needs: ['key', 'model'], keyLabel: 'مفتاح Google AI API', model: 'gemini-1.5-flash',         hint: 'أنشئ مفتاحاً من aistudio.google.com/apikey.' }
  };
  /* i18n-skip-start: a system prompt, written for the model, never on screen */
  var CHAT_SYSTEM = 'أنت «بروف»، مساعد ذكي عربي: مفيد، دقيق، وموجز. أجب بالعربية ما لم يُطلب غير ذلك.';
  /* i18n-skip-end */

  /* category for the rail — smiling chat bubble */
  SYFS.cats = SYFS.cats || {};
  SYFS.cats.ai = {
    label: 'المساعد الذكي',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 01-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1121 11.5z"/><path d="M9 10v1M15 10v1"/><path d="M9.5 14.3c1.5 1 3.5 1 5 0"/></svg>'
  };

  /* ⛔ لا مفتاح يُقرأ هنا — لا في هذا الملفّ ولا في أي سكربت محتوى (v0.104.1، §5.10/6).
     العامل يقرأ المفتاح ويبني الطلب؛ وما نحتاجه من الحالة سؤالٌ نعم/لا. */
  function aiMsg(m) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(m, function (res) {
          if (chrome.runtime.lastError || !res) { resolve({ ok: false, error: 'no-response' }); return; }
          resolve(res);
        });
      } catch (e) { resolve({ ok: false, error: 'no-response' }); }
    });
  }

  /* ---- config: what the user chose, never what he pasted ---- */
  async function loadCfg() {
    var provider = (await store.get('ai_provider', 'prof')) || 'prof';
    if (!PROVIDERS[provider]) provider = 'prof';
    var sid = await store.get('sam_session_id', '');
    if (!sid) { sid = 'syf-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36); store.set('sam_session_id', sid); }
    var c = { provider: provider, sid: sid };
    if (provider !== 'prof') c.model = (await store.get('ai_' + provider + '_model', '')) || PROVIDERS[provider].model;
    var st = await aiMsg({ type: 'SYFS_AI', op: 'ready', provider: provider });
    c.ready = !!(st && st.ready);
    return c;
  }
  /* العامل هو من يعرف: اللوحة لا تحمل القيمة لتحكم عليها بنفسها. */
  function configured(c) { return !!(c && c.ready); }

  /* ---- provider request + reply extraction ----
   * `sys` overrides the assistant's system prompt: the email tool reuses this exact
   * plumbing (same worker path, same allowed hosts) with a proofreading prompt
   * instead of a chat one. There is no second HTTP path in the extension.
   * الموجّه يُمرَّر صريحاً دائماً — نصٌّ لا سرّ فيه، وتمريره يُبقي `CHAT_SYSTEM` نسخة
   * واحدة في هذا الملفّ بدل ثانية في العامل (نفس درس `<<< OCC-ENGINE >>>`, §6.99/6). */
  function callProvider(c, history, sys) {
    return aiMsg({
      type: 'SYFS_AI', op: 'call',
      provider: c.provider, model: c.model || '', sid: c.sid || '',
      sys: sys || CHAT_SYSTEM, history: history
    });
  }
  function extractReply(provider, body) {
    var d; try { d = JSON.parse(body); } catch (e) { return { text: '', err: '' }; }
    if (d && d.error) return { text: '', err: (d.error.message || d.error.status || 'خطأ من المزوّد') };
    if (provider === 'claude') {
      var t = ''; if (Array.isArray(d.content)) d.content.forEach(function (b) { if (b && b.type === 'text') t += b.text; });
      return { text: t, err: '' };
    }
    if (provider === 'openai') {
      return { text: (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '', err: '' };
    }
    if (provider === 'gemini') {
      var cand = d.candidates && d.candidates[0], gx = '';
      if (cand && cand.content && Array.isArray(cand.content.parts)) cand.content.parts.forEach(function (p) { if (p && p.text) gx += p.text; });
      return { text: gx, err: '' };
    }
    /* prof */
    if (d && d.success === false) return { text: '', err: d.message || 'خطأ' };
    return { text: (d && (d.message || d.reply || d.answer)) || '', err: '' };
  }

  /* The provider plumbing, shared with the email tool (src/mail.js) so there is ONE
     path from a tool to a provider. Since v0.104.1 none of it holds a key: the worker
     reads the key, builds the headers and fetches; what crosses this boundary is the
     prompt, the history and a yes/no. Nothing here has a credential to leak. */
  SYFS.ai = {
    PROVIDERS: PROVIDERS,
    /* translates its own return value — it is a display helper and every caller
       (the picker here, the consent gate in mail.js) writes it straight to a screen */
    label: function (p) { var l = (PROVIDERS[p] || {}).label; return l ? SYFS.t(l) : p; },
    loadCfg: loadCfg,
    configured: configured,
    callProvider: callProvider,
    extractReply: extractReply
  };

  SYFS.tools = SYFS.tools || [];
  SYFS.tools.push({
    id: 'sam-ai',                       /* id kept — favorites/window positions reference it */
    name: 'مساعد بروف',
    cat: 'ai',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V5"/><circle cx="12" cy="3.5" r="1.3"/><path d="M9 12.5v1.2M15 12.5v1.2"/><path d="M9.5 16.2c1.6.9 3.4.9 5 0"/></svg>',
    mount: function (body) {
      var root = h(
        '<div class="sam-chat">' +
          '<div class="sam-chat-log"></div>' +
          '<div class="sam-chat-row">' +
            '<input class="sam-chat-in" placeholder="اكتب رسالتك…" autocomplete="off">' +
            '<button class="sam-chat-send" title="إرسال">➤</button>' +
          '</div>' +
        '</div>'
      );
      body.appendChild(root);

      var log      = root.querySelector('.sam-chat-log');
      var inp      = root.querySelector('.sam-chat-in');
      var sendBtn  = root.querySelector('.sam-chat-send');
      /* The settings gear belongs in the window HEAD, beside the window's own
         controls — it was a ⚙ CHARACTER floating at the end of the chat body,
         which is both a different optical size from every SVG control around it
         and a control sitting inside the content it configures.
         winAction returns null when there is no head (a surface that mounts the
         tool bare); the fallback keeps the settings reachable there rather than
         stranding them. */
      var gear = (SYFS.winAction && SYFS.winAction(body, {
        cls: 'sam-chat-gear', title: 'إعدادات المساعد', icon: (SYFS.winIcons && SYFS.winIcons.gear) || ''
      })) || root.appendChild(h('<button class="sam-chat-gear sam-chat-gear--inline" title="إعدادات المساعد">⚙</button>'));

      var history = [];   /* [{role:'user'|'assistant', content}] — in-memory session */

      function add(role, text) {
        var m = h('<div class="sam-msg sam-msg--' + role + '"></div>');
        m.textContent = text;                 /* user + model text via textContent — never innerHTML */
        log.appendChild(m);
        log.scrollTop = log.scrollHeight;
        return m;
      }

      /* ── الإعدادات: صفحة مستقلّة، لا لوحة هنا ──
         ⛔ لا تُعِد بناء حقول الاعتماد في هذا السطح مهما بدا أقرب للمستخدم — الشريط داخل
         صفحة الموقع، وكل ما في الـshadow root المفتوح مقروء لها. `aikeys.html` تعيش على
         أصل الإضافة، ونافذةٌ تُفتح مرّة عند التربيط ثمنٌ زهيد مقابل مفتاح لا يُسرَق. */
      function openKeys() {
        try {
          chrome.runtime.sendMessage({ type: 'SYFS_OPEN_AIKEYS' }, function () {
            if (chrome.runtime.lastError) add('err', SYFS.t('تعذّر فتح صفحة المفاتيح — أعد تحميل الصفحة.'));
          });
        } catch (e) { add('err', SYFS.t('تعذّر فتح صفحة المفاتيح — أعد تحميل الصفحة.')); }
      }
      gear.addEventListener('click', openKeys);

      /* ── send ── */
      /* busy is taken BEFORE the first await: set after loadCfg(), two quick Enters both
         passed the check and sent the question twice (billed twice) */
      var busy = false;
      async function send() {
        if (busy) return;
        var text = (inp.value || '').trim();
        if (!text) return;
        busy = true; sendBtn.disabled = true;
        try { await sendNow(text); }
        finally { busy = false; sendBtn.disabled = false; }
      }
      async function sendNow(text) {
        var c = await loadCfg();
        if (!configured(c)) { add('err', SYFS.t('أدخل بيانات التربيط من ⚙ أولاً (لا توجد بيانات افتراضية).')); openKeys(); return; }

        inp.value = '';
        add('me', text);
        history.push({ role: 'user', content: text });
        var typing = add('bot', '…');

        var res;
        try { res = await callProvider(c, history); } finally { typing.remove(); }

        if (!res || !res.ok) {
          history.pop();   /* drop the unanswered turn so context stays consistent */
          var emsg = 'تعذّر الاتصال بالمزوّد';
          var ex = extractReply(c.provider, res && res.body);
          if (ex.err) emsg = ex.err;
          add('err', emsg + (res && res.status ? ' (' + res.status + ')' : ''));
          return;
        }

        var out = extractReply(c.provider, res.body);
        if (out.err) { history.pop(); add('err', out.err); return; }
        if (!out.text) { history.pop(); add('err', SYFS.t('(لا رد)')); return; }
        history.push({ role: 'assistant', content: out.text });
        add('bot', out.text);
      }

      sendBtn.addEventListener('click', send);
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

      /* greeting */
      loadCfg().then(function (c) {
        /* ⚠️ The provider's name lands INSIDE the sentence, so this is one msgid with a
           placeholder, never `'…عبر ' + label + '. كيف…'` — glued pieces cannot meet in
           correct English word order, and t() would never be handed them anyway. */
        if (!configured(c)) add('bot', SYFS.t('مرحباً 👋 أنا «بروف». اضغط ⚙ لتفتح صفحة المفاتيح، واختر مزوّداً (بروف / Claude / ChatGPT / Gemini) وأدخل مفتاحك هناك — لا يُكتب المفتاح في صفحة تتصفّحها.'));
        else add('bot', SYFS.t('مرحباً 👋 أنا «بروف» عبر {0}. كيف أساعدك؟', PROVIDERS[c.provider].label));
      });
    }
  });
}());
