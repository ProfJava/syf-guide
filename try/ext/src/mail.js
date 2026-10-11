/* SYF — email writer + language correction (mail.html).
 *
 * Compose an email (templates, tone, signature), then — ON AN EXPLICIT BUTTON —
 * have it proofread, rewritten, drafted, translated or summarised by the AI provider
 * the user already configured for «بروف» (src/ai-chat.js). There is no second HTTP
 * path and no second key: SYFS.ai.{loadCfg,callProvider,extractReply} is the same
 * plumbing, through the same worker relay, to the same four allowed hosts.
 *
 * PRIVACY — this tool is the one place in the extension where the user's own writing
 * can leave the device, so the rules are strict and stated in the UI:
 *   1. NOTHING is sent until the user presses an AI button. No autosave, no
 *      background call, no "helpful" pre-check.
 *   2. RECIPIENTS ARE NEVER SENT. Only the subject and the body go to the provider —
 *      To/Cc/Bcc are email addresses, they are personal data, and the model does not
 *      need them.
 *   3. The AI never silently replaces the user's text: every result is shown as a
 *      before/after diff and applied only when accepted.
 *   4. Drafts are NOT persisted by default (tab memory only). Saving one is an
 *      explicit button, and it can be deleted.
 *
 * SECURITY:
 *   - The model's reply is untrusted text: it is inserted with textContent /
 *     createTextNode, never innerHTML.
 *   - Paste is forced to plain text.
 *   - Every value in a mailto: / Gmail URL goes through encodeURIComponent, and only
 *     http(s) links can be inserted. */
(function () {
  'use strict';

  var store = window.SYFS && window.SYFS.store;
  var AI = function () { return window.SYFS && window.SYFS.ai; };

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  ['to', 'cc', 'bcc', 'subject', 'body', 'sig', 'sig-save', 'tpl', 'tpl-go', 'stats',
   'dirty', 'toast', 'ai-fix', 'ai-tone', 'tone', 'ai-draft', 'ai-translate', 'ai-sum',
   'ai-state', 'provider', 'diff', 'diff-body', 'diff-accept', 'diff-reject', 'diff-title',
   'send-gmail', 'send-mailto', 'copy', 'exp-eml', 'exp-txt', 'save-draft', 'drop-draft',
   'consent', 'consent-ok', 'consent-no', 'consent-who'].forEach(function (id) {
    el[id.replace(/-(\w)/g, function (m, c) { return c.toUpperCase(); })] = $(id);
  });

  var dirty = false;
  var pending = null;                 /* the diff currently on screen */

  function toast(msg, bad) {
    el.toast.textContent = msg;
    el.toast.classList.toggle('bad', !!bad);
    el.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.classList.remove('show'); }, bad ? 5600 : 2600);
  }
  function markDirty() { dirty = true; el.dirty.textContent = SYFS.t('● غير محفوظ'); stats(); }
  function stats() {
    var t = el.body.innerText || el.body.textContent || '';
    var w = t.trim() ? t.trim().split(/\s+/).length : 0;
    el.stats.textContent = SYFS.t('{0} كلمة', w);
  }
  function bodyText() { return (el.body.innerText || el.body.textContent || '').replace(/ /g, ' '); }
  /* replace the body with plain text — createTextNode, never innerHTML: this is where
     the model's reply lands, and a model can be prompt-injected into emitting HTML */
  function setBodyText(text) {
    el.body.textContent = '';
    String(text).split('\n').forEach(function (line) {
      var p = document.createElement('div');
      if (line) p.appendChild(document.createTextNode(line));
      else p.appendChild(document.createElement('br'));
      el.body.appendChild(p);
    });
    markDirty();
  }

  /* ===================== recipients ===================== */
  var EMAIL_RE = /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/;
  function splitEmails(s) {
    return String(s || '').split(/[,;\n]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function validEmail(e) { return EMAIL_RE.test(String(e || '').trim()); }
  function badEmails() {
    var bad = [];
    ['to', 'cc', 'bcc'].forEach(function (k) {
      splitEmails(el[k].value).forEach(function (e) { if (!validEmail(e)) bad.push(e); });
    });
    return bad;
  }

  /* ===================== templates =====================
   * i18n-skip-start: these are the MAIL the user sends, not the interface — and
   * the table already carries both languages (`_ar` / `_en`), so an English user
   * picks an English template rather than a translated Arabic one. Translating
   * them here would produce a third, worse copy of text that already exists. */
  var TEMPLATES = {
    meeting_ar: { subject: 'طلب اجتماع', body: 'السلام عليكم ورحمة الله،\n\nأرجو تحديد موعد اجتماع لمناقشة {الموضوع}.\nيناسبني يوم {اليوم} الساعة {الوقت}، وأنا مرن لأي وقت آخر يناسبكم.\n\nشاكراً لكم،' },
    followup_ar: { subject: 'متابعة', body: 'السلام عليكم،\n\nأتابع رسالتي السابقة بخصوص {الموضوع}. أقدّر لكم إفادتي بآخر المستجدات متى تيسّر.\n\nشكراً جزيلاً،' },
    apology_ar: { subject: 'اعتذار', body: 'السلام عليكم،\n\nأعتذر عن {السبب}. أتحمّل مسؤولية ذلك، وسأعمل على {الإجراء التصحيحي} خلال {المدة}.\n\nمع خالص التقدير،' },
    quote_ar: { subject: 'عرض سعر', body: 'السلام عليكم،\n\nتجدون أدناه عرض السعر المطلوب لـ{الخدمة}:\n- البند الأول: {السعر}\n- البند الثاني: {السعر}\n\nالعرض ساري حتى {التاريخ}.\n\nمع التحية،' },
    resign_ar: { subject: 'إشعار استقالة', body: 'السلام عليكم،\n\nأتقدّم إليكم باستقالتي من منصب {المنصب}، على أن يكون آخر يوم عمل لي {التاريخ}.\nأشكركم على الفرصة، وسأسلّم مهامي بشكل منظّم.\n\nمع التقدير،' },
    thanks_ar: { subject: 'شكر وتقدير', body: 'السلام عليكم،\n\nأشكركم على {السبب}. تعاونكم كان له أثر واضح في {النتيجة}.\n\nتحياتي،' },
    meeting_en: { subject: 'Meeting request', body: 'Hello,\n\nCould we schedule a meeting to discuss {topic}?\n{day} at {time} works for me, but I am flexible.\n\nBest regards,' },
    followup_en: { subject: 'Following up', body: 'Hello,\n\nI am following up on my previous email about {topic}. Any update when you get a chance?\n\nThank you,' },
    apology_en: { subject: 'Apology', body: 'Hello,\n\nI apologise for {reason}. I take responsibility, and I will {corrective action} by {date}.\n\nKind regards,' },
    intro_en: { subject: 'Introduction', body: 'Hello,\n\nMy name is {name} and I work at {company}. I am reaching out about {topic}.\n\nWould you be open to a short call?\n\nBest,' }
  };
  /* i18n-skip-end */
  function applyTemplate(key) {
    var t = TEMPLATES[key];
    if (!t) return;
    el.subject.value = t.subject;
    setBodyText(t.body + (el.sig.value ? '\n\n' + el.sig.value : ''));
    toast(SYFS.t('أُدرج القالب — عدّل ما بين الأقواس {}'));
  }

  /* ===================== the AI actions =====================
   * The button labels live out here because they are the only part of this block
   * a human reads; everything below the marker is written for the MODEL. */
  var ACT_TITLE = {
    fix: 'تصحيح الإملاء والقواعد',
    tone: 'إعادة الصياغة بنبرة مختلفة',
    draft: 'كتابة مسودة من النقاط',
    translate: 'الترجمة',
    sum: 'تلخيص + ردّ مقترح'
  };
  /* i18n-skip-start: prompts, not interface — they are instructions to the
     provider and never reach the screen. Translating them would put a second,
     drifting copy of the instruction in a file nobody reads while debugging. */
  var SYS = 'أنت محرّر لغوي محترف للبريد الإلكتروني. تعمل بالعربية والإنجليزية. ' +
    'أعد النصّ المطلوب فقط، بلا مقدّمات ولا شرح ولا علامات اقتباس ولا Markdown. ' +
    'حافظ على المعنى والأسماء والأرقام والتواريخ كما هي.';

  var ACTIONS = {
    fix: {
      title: 'تصحيح الإملاء والقواعد',
      prompt: function (o) {
        return 'صحّح الأخطاء الإملائية والنحوية وعلامات الترقيم في نصّ البريد التالي. ' +
          'لا تُعِد الصياغة ولا تغيّر الأسلوب ولا تضف أو تحذف معلومات — تصحيح فقط. ' +
          'أعد النصّ المصحّح فقط.\n\n---\n' + o.body;
      }
    },
    tone: {
      title: 'إعادة الصياغة بنبرة مختلفة',
      prompt: function (o) {
        return 'أعد صياغة نصّ البريد التالي بنبرة ' + o.tone + '، مع الحفاظ على كل المعلومات والأسماء والأرقام. ' +
          'أعد النصّ المُعاد صياغته فقط.\n\n---\n' + o.body;
      }
    },
    draft: {
      title: 'كتابة مسودة من النقاط',
      prompt: function (o) {
        return 'اكتب رسالة بريد إلكتروني كاملة ومهذّبة انطلاقاً من النقاط التالية. ' +
          'استخدم لغة النقاط نفسها (عربية أو إنجليزية). ابدأ بتحية واختم بخاتمة مناسبة. ' +
          'أعد نصّ الرسالة فقط.\n\n---\n' + o.body;
      }
    },
    translate: {
      title: 'الترجمة',
      prompt: function (o) {
        return 'ترجم بريد العمل التالي: إن كان بالعربية فترجمه إلى إنجليزية أعمال سليمة، وإن كان بالإنجليزية فترجمه إلى عربية فصيحة. ' +
          'حافظ على النبرة والتنسيق والأسماء. أعد الترجمة فقط.\n\n---\n' + o.body;
      }
    },
    sum: {
      title: 'تلخيص + ردّ مقترح',
      prompt: function (o) {
        return 'أمامك بريد وارد. اكتب:\nالملخّص:\n- (نقاط قصيرة)\n\nالردّ المقترح:\n(نصّ ردّ جاهز للإرسال)\n\n' +
          'لا تكتب أي شيء آخر.\n\n---\n' + o.body;
      }
    }
  };
  /* i18n-skip-end */

  /* the payload that leaves the device — assembled in ONE place so it is auditable:
     subject + body. Never To/Cc/Bcc. */
  function payload(action, opts) {
    var o = { body: bodyText(), tone: (opts && opts.tone) || '' };
    var subj = el.subject.value.trim();
    var p = ACTIONS[action].prompt(o);
    if (subj && action !== 'draft') p = 'موضوع الرسالة: ' + subj + '\n\n' + p;
    return p;
  }

  /* consent is per provider: agreeing to send mail to one company is not agreeing to send it
     to another. The old single flag (`mail_ai_consent`) did not say which provider it was
     given for, so it is not honoured — everyone is asked once more. */
  async function ensureConsent(provider) {
    var given = await store.get('mail_ai_consent_by', {});
    if (given && given[provider] === true) return true;
    /* i18n-dyn: SYFS.ai.label() translates its own return value (src/ai-chat.js) */
    el.consentWho.textContent = AI().label(provider);
    el.consent.classList.remove('hide');
    return new Promise(function (res) {
      function ok() {
        cleanup();
        store.get('mail_ai_consent_by', {}).then(function (m) {
          var next = {}; Object.keys(m || {}).forEach(function (k) { if (m[k] === true) next[k] = true; });
          next[provider] = true; store.set('mail_ai_consent_by', next);
        });
        res(true);
      }
      function no() { cleanup(); res(false); }
      function cleanup() {
        el.consent.classList.add('hide');
        el.consentOk.removeEventListener('click', ok);
        el.consentNo.removeEventListener('click', no);
      }
      el.consentOk.addEventListener('click', ok);
      el.consentNo.addEventListener('click', no);
    });
  }

  /* taken before the first await — set only after loadCfg()/consent, a double click sent
     the same mail to the provider twice */
  var aiRunning = false;
  async function runAi(action, opts) {
    if (aiRunning) return;
    var ai = AI();
    if (!ai) { toast(SYFS.t('محرّك المساعد غير محمَّل.'), true); return; }
    var text = bodyText().trim();
    if (!text) { toast(SYFS.t('اكتب نصّ الرسالة أولاً.'), true); return; }
    aiRunning = true;
    try { await runAiNow(ai, action, opts, text); } finally { aiRunning = false; }
  }
  async function runAiNow(ai, action, opts, text) {
    var cfg = await ai.loadCfg();
    if (!ai.configured(cfg)) {
      toast(SYFS.t('لا يوجد مفتاح. افتح «المساعد الذكي» من الشريط ← ⚙ واختر مزوّداً وأدخل مفتاحك.'), true);
      return;
    }
    if (!(await ensureConsent(cfg.provider))) { toast(SYFS.t('أُلغي الإرسال — لم يخرج نصّك من الجهاز.')); return; }

    setBusy(true, SYFS.t('{0} عبر {1}…', SYFS.t(ACT_TITLE[action]), ai.label(cfg.provider)));
    try {
      var res = await ai.callProvider(cfg, [{ role: 'user', content: payload(action, opts) }], SYS);
      if (!res || !res.ok) throw new Error('net');
      var out = ai.extractReply(cfg.provider, res.body);
      if (out.err) { toast(SYFS.t('المزوّد ردّ بخطأ: {0}', out.err), true); return; }
      var clean = String(out.text || '').trim();
      if (!clean) { toast(SYFS.t('لم يصل ردّ.'), true); return; }
      showDiff(SYFS.t(ACT_TITLE[action]), text, clean);
    } catch (e) {
      toast(SYFS.t('تعذّر الاتصال بالمزوّد.'), true);
    } finally {
      setBusy(false, '');
    }
  }
  function setBusy(on, msg) {
    el.aiState.textContent = msg || '';
    [el.aiFix, el.aiTone, el.aiDraft, el.aiTranslate, el.aiSum].forEach(function (b) { b.disabled = !!on; });
  }

  /* ===================== the diff (nothing is replaced silently) =====================
   * Word-level LCS. Each change becomes a chip the user can accept or reject on its
   * own; the final text is rebuilt from the decisions. */
  function words(s) { return String(s).split(/(\s+)/).filter(function (x) { return x !== ''; }); }
  function diffWords(aStr, bStr) {
    var a = words(aStr), b = words(bStr);
    var N = a.length, M = b.length;
    /* keep the O(N*M) table sane: a very long mail falls back to one whole-text change */
    if (N * M > 4000000) return [{ type: 'rep', a: aStr, b: bStr }];
    var dp = [];
    for (var i = 0; i <= N; i++) dp.push(new Uint32Array(M + 1));
    for (i = N - 1; i >= 0; i--) {
      for (var j = M - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var ops = [];
    function push(type, av, bv) {
      var last = ops[ops.length - 1];
      if (last && last.type === type) { last.a += av || ''; last.b += bv || ''; return; }
      ops.push({ type: type, a: av || '', b: bv || '' });
    }
    i = 0; j = 0;
    while (i < N && j < M) {
      if (a[i] === b[j]) { push('eq', a[i], a[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', a[i], ''); i++; }
      else { push('ins', '', b[j]); j++; }
    }
    while (i < N) { push('del', a[i], ''); i++; }
    while (j < M) { push('ins', '', b[j]); j++; }

    /* a delete immediately followed by an insert is really a replacement */
    var out = [];
    for (var k = 0; k < ops.length; k++) {
      if (ops[k].type === 'del' && ops[k + 1] && ops[k + 1].type === 'ins') {
        out.push({ type: 'rep', a: ops[k].a, b: ops[k + 1].b });
        k++;
      } else out.push(ops[k]);
    }
    return out;
  }
  function applyOps(ops, accepted) {
    var s = '';
    ops.forEach(function (op, i) {
      if (op.type === 'eq') { s += op.a; return; }
      var take = accepted[i] !== false;                 /* default: accepted */
      if (op.type === 'ins') { if (take) s += op.b; return; }
      if (op.type === 'del') { if (!take) s += op.a; return; }
      s += take ? op.b : op.a;                          /* rep */
    });
    return s;
  }
  function showDiff(title, before, after) {
    var ops = diffWords(before, after);
    var changes = ops.filter(function (o) { return o.type !== 'eq'; }).length;
    if (!changes) { toast(SYFS.t('لا تغييرات — النصّ سليم ✓')); return; }

    var accepted = {};
    pending = { ops: ops, accepted: accepted };

    el.diffTitle.textContent = SYFS.t('{0} — {1} تغيير', title, changes);
    el.diffBody.textContent = '';
    ops.forEach(function (op, i) {
      if (op.type === 'eq') {
        el.diffBody.appendChild(document.createTextNode(op.a));   /* ⚠️ text node — model output */
        return;
      }
      var span = document.createElement('span');
      span.className = 'chg ' + op.type;
      span.dataset.i = String(i);

      if (op.a) {
        var del = document.createElement('del');
        del.textContent = op.a;
        span.appendChild(del);
      }
      if (op.b) {
        var ins = document.createElement('ins');
        ins.textContent = op.b;
        span.appendChild(ins);
      }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chgx';
      btn.title = SYFS.t('ارفض هذا التغيير');
      btn.textContent = '✓';
      btn.addEventListener('click', function () {
        var on = accepted[i] !== false;
        accepted[i] = !on;
        btn.textContent = accepted[i] ? '✓' : '✗';
        btn.title = accepted[i] ? SYFS.t('ارفض هذا التغيير') : SYFS.t('اقبل هذا التغيير');
        span.classList.toggle('off', !accepted[i]);
      });
      span.appendChild(btn);
      el.diffBody.appendChild(span);
    });
    el.diff.classList.remove('hide');
  }
  function acceptDiff() {
    if (!pending) return;
    setBodyText(applyOps(pending.ops, pending.accepted));
    pending = null;
    el.diff.classList.add('hide');
    toast(SYFS.t('طُبِّقت التغييرات المقبولة'));
  }
  function rejectDiff() {
    pending = null;
    el.diff.classList.add('hide');
    toast(SYFS.t('رُفضت التغييرات — نصّك كما هو'));
  }

  /* ===================== sending (we never send: we hand off) ===================== */
  function gmailUrl(f) {
    var q = [];
    if (f.to) q.push('to=' + encodeURIComponent(f.to));
    if (f.cc) q.push('cc=' + encodeURIComponent(f.cc));
    if (f.bcc) q.push('bcc=' + encodeURIComponent(f.bcc));
    if (f.subject) q.push('su=' + encodeURIComponent(f.subject));
    if (f.body) q.push('body=' + encodeURIComponent(f.body));
    return 'https://mail.google.com/mail/?view=cm&fs=1&' + q.join('&');
  }
  /* ⚠️ الفاصلة بين المستلمين في `mailto:` **بنية لا محتوى**. RFC 6068 يقول إن `%2C` داخل عنوان
   * جزءٌ من العنوان نفسه، فترميز السلسلة المجموعة دفعةً واحدة يسلّم «أ،ب،ج» عنواناً واحداً
   * مشوّهاً ويفتح عميل البريد بلا مستلم صالح — والمستخدم يظنّ أنه أرسل للثلاثة. كل عنوان
   * يُرمَّز وحده والفاصلة تبقى حرفيّة. (⛔ لا يسري على `gmailUrl`: هناك الفاصلة قيمةُ وسيط
   * استعلام عادي، و`%2C` يفكّ إلى فاصلة سليمة.) */
  function encAddrs(s) {
    return String(s || '').split(',').map(function (a) { return encodeURIComponent(a); }).join(',');
  }
  function mailtoUrl(f) {
    var q = [];
    if (f.cc) q.push('cc=' + encAddrs(f.cc));
    if (f.bcc) q.push('bcc=' + encAddrs(f.bcc));
    if (f.subject) q.push('subject=' + encodeURIComponent(f.subject));
    if (f.body) q.push('body=' + encodeURIComponent(f.body));
    return 'mailto:' + encAddrs(f.to) + (q.length ? '?' + q.join('&') : '');
  }
  function fields() {
    return {
      to: splitEmails(el.to.value).join(','),
      cc: splitEmails(el.cc.value).join(','),
      bcc: splitEmails(el.bcc.value).join(','),
      subject: el.subject.value.trim(),
      body: bodyText()
    };
  }
  function b64(s) {
    /* btoa is byte-wise: UTF-8 first, or Arabic throws */
    var bytes = new TextEncoder().encode(s);
    var bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }
  function emlText(f) {
    var h = [];
    if (f.to) h.push('To: ' + f.to);
    if (f.cc) h.push('Cc: ' + f.cc);
    /* Bcc is deliberately NOT written into the .eml: it would be visible to anyone
       the file is forwarded to — that is exactly what "blind" means. */
    h.push('Subject: =?UTF-8?B?' + b64(f.subject) + '?=');
    h.push('MIME-Version: 1.0');
    h.push('Content-Type: text/plain; charset=UTF-8');
    h.push('Content-Transfer-Encoding: base64');
    return h.join('\r\n') + '\r\n\r\n' + b64(f.body).replace(/(.{76})/g, '$1\r\n');
  }
  function dl(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function guard() {
    var bad = badEmails();
    if (bad.length) { toast(SYFS.t('عنوان بريد غير صالح: {0}', bad[0]), true); return false; }
    return true;
  }

  /* ===================== drafts (opt-in only) =====================
   * A saved draft is never auto-loaded over what you are writing — the buttons
   * appear, and you decide. */
  function draftButtons(on) {
    el.dropDraft.classList.toggle('hide', !on);
    var lb = document.getElementById('load-draft');
    if (lb) lb.classList.toggle('hide', !on);
  }
  function saveDraft() {
    store.set('mail_draft', fields());
    dirty = false;
    el.dirty.textContent = '';
    toast(SYFS.t('حُفظت المسودة محلياً على جهازك'));
    draftButtons(true);
  }
  async function loadDraft() {
    var d = await store.get('mail_draft', null);
    if (!d || typeof d !== 'object') return;
    el.to.value = d.to || '';
    el.cc.value = d.cc || '';
    el.bcc.value = d.bcc || '';
    el.subject.value = d.subject || '';
    setBodyText(d.body || '');
    dirty = false;
    el.dirty.textContent = '';
    toast(SYFS.t('استُعيدت مسودتك المحفوظة'));
  }
  function dropDraft() {
    store.set('mail_draft', null);
    draftButtons(false);
    toast(SYFS.t('حُذفت المسودة المحفوظة'));
  }

  /* ===================== wiring ===================== */
  el.tplGo.addEventListener('click', function () { applyTemplate(el.tpl.value); });
  el.sigSave.addEventListener('click', function () {
    store.set('mail_signature', el.sig.value || '');
    toast(SYFS.t('حُفظ التوقيع'));
  });

  el.aiFix.addEventListener('click', function () { runAi('fix'); });
  el.aiTone.addEventListener('click', function () { runAi('tone', { tone: el.tone.value }); });
  el.aiDraft.addEventListener('click', function () { runAi('draft'); });
  el.aiTranslate.addEventListener('click', function () { runAi('translate'); });
  el.aiSum.addEventListener('click', function () { runAi('sum'); });
  el.diffAccept.addEventListener('click', acceptDiff);
  el.diffReject.addEventListener('click', rejectDiff);

  el.sendGmail.addEventListener('click', function () {
    if (!guard()) return;
    window.open(gmailUrl(fields()), '_blank', 'noopener');
  });
  el.sendMailto.addEventListener('click', function () {
    if (!guard()) return;
    window.location.href = mailtoUrl(fields());
  });
  el.copy.addEventListener('click', async function () {
    var f = fields();
    var text = (f.subject ? f.subject + '\n\n' : '') + f.body;
    try { await navigator.clipboard.writeText(text); toast(SYFS.t('نُسخ نصّ الرسالة')); }
    catch (e) { toast(SYFS.t('تعذّر النسخ.'), true); }
  });
  el.expEml.addEventListener('click', function () {
    if (!guard()) return;
    var f = fields();
    dl(new Blob([emlText(f)], { type: 'message/rfc822' }), (f.subject || 'email').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) + '.eml');
    toast(SYFS.t('صُدِّر ملف .eml (بلا حقل Bcc — لا يُكتب في الملف)'));
  });
  el.expTxt.addEventListener('click', function () {
    var f = fields();
    dl(new Blob(['﻿' + (f.subject ? f.subject + '\n\n' : '') + f.body], { type: 'text/plain;charset=utf-8' }), 'email.txt');
  });
  el.saveDraft.addEventListener('click', saveDraft);
  el.dropDraft.addEventListener('click', dropDraft);

  ['to', 'cc', 'bcc', 'subject'].forEach(function (k) { el[k].addEventListener('input', markDirty); });
  el.body.addEventListener('input', markDirty);
  /* paste is plain text: pasted HTML from a web page or another mail client would
     carry arbitrary markup into the message */
  el.body.addEventListener('paste', function (e) {
    e.preventDefault();
    var t = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, t);
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-cmd]'), function (b) {
    b.addEventListener('click', function () {
      el.body.focus();
      document.execCommand(b.dataset.cmd, false, null);
      markDirty();
    });
  });

  window.addEventListener('beforeunload', function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  var loadBtn = document.getElementById('load-draft');
  if (loadBtn) loadBtn.addEventListener('click', loadDraft);

  /* which provider will receive the text, said plainly, before anything is sent */
  (async function init() {
    if (!store) return;
    var sig = await store.get('mail_signature', '');
    el.sig.value = sig || '';
    draftButtons(!!(await store.get('mail_draft', null)));
    stats();

    var ai = AI();
    if (!ai) { el.provider.textContent = SYFS.t('محرّك المساعد غير محمَّل — أزرار الذكاء معطّلة.'); setBusy(true, ''); return; }
    var cfg = await ai.loadCfg();
    if (ai.configured(cfg)) {
      el.provider.textContent = SYFS.t('إجراءات الذكاء تُرسل الموضوع ونصّ الرسالة إلى: {0} — بضغطة منك فقط. عناوين المستلمين لا تُرسَل أبداً.', ai.label(cfg.provider));
    } else {
      /* no key: the tool is still a full email writer — only the AI buttons go dark */
      el.provider.textContent = SYFS.t('لا يوجد مفتاح ذكاء — الأداة تعمل ككاتب إيميلات كامل، وأزرار الذكاء معطّلة. اضبط مفتاحك من «المساعد الذكي» ← ⚙.');
      setBusy(true, '');
    }
  }());

  /* pure helpers for the node tests */
  window.SYFS_MAIL = {
    splitEmails: splitEmails, validEmail: validEmail,
    diffWords: diffWords, applyOps: applyOps,
    gmailUrl: gmailUrl, mailtoUrl: mailtoUrl, emlText: emlText, b64: b64,
    payload: payload, TEMPLATES: TEMPLATES, ACTIONS: ACTIONS
  };
}());
