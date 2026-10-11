/* SYF — «الحماية»: ad, YouTube, Facebook & tracker blocker UI. Four tabs:
 *   كل المواقع · يوتيوب · فيسبوك · التتبّع
 *
 * The blocking itself happens in the browser's network layer via the static DNR
 * rulesets (rules/ads.json, tracking.json, fingerprint.json, pixels.json). Every
 * checkbox here maps to a REAL ruleset or a real content-script toggle — none is
 * decorative. Content scripts have no declarativeNetRequest access, so ruleset
 * toggles and the per-site allowlist go through SYFS_DNR messages to the worker.
 *
 * YouTube is not a checkbox but a MODE, because the three behaviours differ in
 * kind, not degree (see src/yt-guard.js):
 *   off  — vanilla YouTube
 *   safe — skip the ad in the player (a short muted flash)
 *   full — prune the ad out of the player response (no ad at all); the worker
 *          registers src/yt-engine.js only in this mode
 * These are also rungs: when YouTube's enforcement notice fires, yt-guard.js steps
 * down ONE rung (full → safe → safe-without-cosmetic → off) and writes the reason to
 * yt_last, so the mode shown here can change without the user touching it. That is
 * why the panel explains yt_cosmetic when the ladder turned it off (#yt-cos-note).
 *
 * Facebook gets its own tab for the opposite reason: nothing about it is network
 * blocking AT ALL. Facebook serves ads first-party, so no ruleset can touch them
 * (see src/fb-adblock.js) — every switch here is a DOM hider. It is also the one
 * tab with a real counter: the DNR count is deliberately NOT mirrored anywhere
 * (see counterNote below), but a DOM hider counts its own work, so `fb_hidden`
 * costs no permission and carries no history.
 *
 * Lazy-injected by background.js (LAZY_TOOL_FILES) before src/rail.js reads
 * SYFS.tools / SYFS.cats. */
(function () {
  window.SYFS = window.SYFS || {};

  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    /* the template's own text IS the msgid — translate the built tree rather than
       splitting the markup (see src/i18n.js). Free in the default language. */
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }

  /* ===== SYFS_DNR transport =================================================
   * ⚠️ KEEP THIS BLOCK IDENTICAL to its twin (src/shield.js ⇄ src/speed.js): a test
   * compares the two byte for byte, so this header must read the same in both.
   *
   * Failure has three different cures and one message cannot carry all three:
   *   'dead'      the content script is orphaned — the extension was reloaded or
   *               updated under a page that was already open. Only reloading the
   *               PAGE fixes that; retrying is guaranteed to fail forever.
   *   'asleep'    MV3 tore the worker down mid-await (status alone does two), so
   *               the channel closed with no reply. Asking again wakes it, and the
   *               user should never have to see this one at all.
   *   'internal'  the worker answered {ok:false}: the channel worked perfectly and
   *               reloading the page changes nothing.
   * chrome.runtime.lastError.message is the ONLY place that difference is written.
   * It is read here, mapped to one of the three, and dropped — never shown (it is
   * Chrome's English) and never stored. */
  var DNR_WAIT = 4000;
  function dnrOnce(op, extra) {
    return new Promise(function (resolve) {
      var done = false;
      function settle(v) { if (done) return; done = true; resolve(v); }
      /* a callback that is never invoked must not leave the panel frozen on its
         pre-render state — a promise that never settles has no error to show */
      setTimeout(function () { settle({ ok: false, error: 'asleep' }); }, DNR_WAIT);
      try {
        chrome.runtime.sendMessage(Object.assign({ type: 'SYFS_DNR', op: op }, extra || {}), function (res) {
          var le = chrome.runtime.lastError;
          if (le) { settle({ ok: false, error: /invalidated|Receiving end/i.test(le.message || '') ? 'dead' : 'asleep' }); return; }
          settle(res || { ok: false, error: 'asleep' });
        });
      } catch (e) { settle({ ok: false, error: 'dead' }); }   /* sendMessage itself throws only when the context is gone */
    });
  }
  /* One silent retry, and ONLY for the cause a retry can cure. Safe for writes as
     well as reads: every SYFS_DNR op sets an ABSOLUTE value (enable/disable a
     ruleset, add/remove a domain) — never an increment — so a duplicate that lands
     late changes nothing. */
  function dnr(op, extra) {
    return dnrOnce(op, extra).then(function (r) {
      return (r && (r.ok || r.error !== 'asleep')) ? r : dnrOnce(op, extra);
    });
  }
  var DNR_MSG = {
    dead: 'أُعيد تحميل الإضافة — حدّث هذه الصفحة (F5) ليعود الاتصال.',
    asleep: 'خدمة الحجب لا تستجيب. جرّب مرّة أخرى.',
    internal: 'خطأ داخلي في خدمة الحجب — لم يُطبَّق التغيير.'
  };
  /* the failure block: says which of the three happened, and offers a retry only
     when a retry can possibly work */
  function dnrFail(r, again) {
    var kind = (r && DNR_MSG[r.error]) ? r.error : 'internal';
    var box = h('<div class="syf-empty syf-dnr-fail"></div>');
    box.textContent = SYFS.t(DNR_MSG[kind]);
    if (kind !== 'dead' && again) {
      var b = h('<button class="syf-btn" style="margin-top:8px">أعد المحاولة</button>');
      b.addEventListener('click', function () { again(); });
      box.appendChild(b);
    }
    return box;
  }
  /* a control that failed must SAY so — reverting it silently reads as a UI glitch */
  function failNote(anchor) {
    var f = function (r) { clearFail(anchor); anchor.appendChild(dnrFail(r, null)); };
    f.clear = function () { clearFail(anchor); };   /* the next success takes the message away */
    return f;
  }
  function clearFail(anchor) {
    var p = anchor.querySelector('.syf-dnr-fail'); if (p) p.remove();
  }
  /* ===== end SYFS_DNR transport ============================================= */

  /* extension pages (app mode) have no real site to exempt */
  var HOST = /^https?:$/.test(location.protocol) ? (location.hostname || '').toLowerCase().replace(/^www\./, '') : '';
  var YT = 'youtube.com';

  /* bind a checkbox to a chrome.storage key (content-script toggles) */
  function bindStore(ck, key, dflt) {
    SYFS.store.get(key, dflt).then(function (v) { ck.checked = (v !== false); });
    ck.addEventListener('change', function () { SYFS.store.set(key, ck.checked); });
  }
  /* Bind a checkbox to a DNR ruleset (network toggles). This one fires and does NOT
     re-render, so it has to police itself: a failed write used to leave the box
     visually flipped with nothing said — the panel claiming a rule that is not
     loaded, which is worse than an error. */
  function bindRuleset(ck, ruleset, status, onFail) {
    ck.checked = !!status[ruleset];
    ck.addEventListener('change', function () {
      var want = ck.checked;
      ck.disabled = true;
      dnr('toggle', { ruleset: ruleset, on: want }).then(function (r) {
        ck.disabled = false;
        if (r && r.ok) { if (onFail) onFail.clear(); return; }
        ck.checked = !want;                        /* a switch that did not switch must not look switched */
        if (onFail) onFail(r);
      });
    });
  }

  /* The blocked-request count is shown ON THE TOOLBAR ICON, per tab — Chrome keeps
   * it for us (setExtensionActionOptions in background.js). It is deliberately not
   * mirrored into this panel: chrome.action.getBadgeText() returns a PLACEHOLDER,
   * not the real number, unless the extension holds declarativeNetRequestFeedback —
   * and that permission hands us the matched-request log, i.e. the user's browsing
   * history. A number in a panel is not worth that. */
  function counterNote() {
    return h('<div class="syf-out" style="grid-template-columns:1fr"><div><span>عدّاد المحجوب</span><b>على أيقونة الإضافة — لكل تبويب</b></div></div>');
  }

  /* ---- shared: the per-site allowlist ---- */
  function allowlistUI(panel, status, refresh) {
    var wrap = h(
      '<div>' +
        '<label>الموقع الحالي</label>' +
        '<button class="syf-btn" id="sh-site" style="display:none"></button>' +
        '<div class="syf-empty" id="sh-nohost" style="display:none">لا يمكن الاستثناء في هذه الصفحة.</div>' +
        '<label>مواقع مستثناة (الحجب معطّل فيها)</label>' +
        '<div class="syf-note-list" id="sh-list"></div>' +
      '</div>'
    );
    panel.appendChild(wrap);

    var siteBtn = wrap.querySelector('#sh-site');
    var noHost = wrap.querySelector('#sh-nohost');
    var list = wrap.querySelector('#sh-list');
    var allowed = Array.isArray(status.allowed) ? status.allowed : [];

    if (!HOST) { noHost.style.display = ''; } else {
      siteBtn.style.display = '';
      var on = allowed.indexOf(HOST) >= 0;
      siteBtn.textContent = on ? SYFS.t('▶ إعادة تفعيل الحجب في: {0}', HOST) : SYFS.t('⏸ استثناء هذا الموقع: {0}', HOST);
      siteBtn.addEventListener('click', function () {
        /* a failed write followed by a successful re-read shows an UNCHANGED list,
           which reads as "the button does nothing" — say what happened instead */
        dnr('allow', { domain: HOST, on: allowed.indexOf(HOST) < 0 }).then(function (r) {
          if (r && r.ok) { refresh(); return; }
          failNote(wrap)(r);
        });
      });
    }

    if (!allowed.length) {
      list.appendChild(h('<div class="syf-empty">لا مواقع مستثناة.</div>'));
    } else {
      allowed.forEach(function (d) {
        var row = h('<div class="syf-note-row"><span class="t"></span><button class="x" title="إزالة الاستثناء">✕</button></div>');
        row.querySelector('.t').textContent = d;          /* textContent — no HTML injection */
        row.querySelector('.x').addEventListener('click', function () {
          dnr('allow', { domain: d, on: false }).then(function (r) {
            if (r && r.ok) { refresh(); return; }
            failNote(wrap)(r);
          });
        });
        list.appendChild(row);
      });
    }
  }

  /* ---- tab 1: all sites ---- */
  function buildSites(panel, status, refresh) {
    var root = h(
      '<div class="syf-form">' +
        '<label class="syf-ck"><input type="checkbox" id="sh-ads"> <span>منع الإعلانات (حجب شبكي)</span></label>' +
        '<label class="syf-ck"><input type="checkbox" id="sh-cos"> <span>إخفاء مساحات الإعلانات الفارغة</span></label>' +
        '<label class="syf-ck"><input type="checkbox" id="sh-stl"> <span>منع كشف المانع (تحييد كواشف الجافاسكربت)</span></label>' +
        '<label class="syf-ck"><input type="checkbox" id="sh-aw"> <span>تخطّي جدران «عطّل مانع الإعلانات» (Admiral وأمثالها)</span></label>' +
        '<label class="syf-ck"><input type="checkbox" id="sh-gm"> <span>إخفاء إعلانات جيميل (صفوف «إعلان» في الوارد)</span></label>' +
      '</div>'
    );
    panel.appendChild(root);

    var fail = failNote(root);
    bindRuleset(root.querySelector('#sh-ads'), 'ads', status, fail);
    /* OFF by default (v0.87.0) — ad blocking is opt-in; these three are its layers
       and must agree with it. Must match src/adblock-stealth.js, which is what
       actually reads the keys; a panel that shows a default the engine does not
       hold is a panel that lies. */
    bindStore(root.querySelector('#sh-cos'), 'shield_cosmetic', false);
    bindStore(root.querySelector('#sh-stl'), 'shield_stealth', false);
    bindStore(root.querySelector('#sh-aw'), 'shield_antiwall', false);
    bindStore(root.querySelector('#sh-gm'), 'gmail_adblock', true);
    /* Facebook lives in its own tab — a mirror switch here would put the same
     * state in two places, which is how a panel starts lying to its user. */
    root.appendChild(counterNote());

    allowlistUI(root, status, refresh);
    root.appendChild(h('<div class="syf-note-hint">أعد تحميل الصفحة بعد أي تغيير ليسري المفعول. إن تعطّل شيء في موقع، استثنه.</div>'));
  }

  /* ---- tab 2: YouTube ---- */
  var MODES = [
    { key: 'off',  label: 'مطفأ' },
    { key: 'safe', label: 'آمن (تخطّي)' },
    { key: 'full', label: 'كامل (كشط)' }
  ];
  var MODE_HINT = {
    off:  'يوتيوب بلا أي تعديل.',
    safe: 'الإعلان يُحمَّل ثم يُكتم ويُسرَّع ويُتخطّى — تظهر ومضة قصيرة. لا يُحجب أي طلب، فلا يمكن أن يكون هذا الوضع سبب كشف يوتيوب. صفر خطر على التشغيل.',
    full: 'الإعلان يُحذف من استجابة المشغّل قبل أن يراه — لا ومضة إطلاقاً. إن تعلّق التشغيل، يعيد الحارس تحميل الصفحة مرّة واحدة بلا كشط. وإن كشف يوتيوب المانع، ينزل الوضع تلقائياً إلى «آمن».'
  };

  function buildYouTube(panel, status, refresh) {
    var root = h(
      '<div class="syf-form">' +
        '<label>وضع منع إعلانات يوتيوب</label>' +
        '<div class="syf-seg" id="yt-seg"></div>' +
        '<div class="syf-note-hint" id="yt-hint"></div>' +
        '<label class="syf-ck"><input type="checkbox" id="yt-cos"> <span>إخفاء إعلانات القائمة والبانرات</span></label>' +
        '<div class="syf-note-hint" id="yt-cos-note" style="display:none">أطفأته <b>الإضافة تلقائياً</b> (لا أنت): إخفاء المساحات يمكن كشفه، فهو آخر درجة نتنازل عنها قبل الإيقاف. أعِد تفعيله متى شئت.</div>' +
        '<label class="syf-ck"><input type="checkbox" id="yt-sh"> <span>تخطّي إعلانات شورتس</span></label>' +
        '<label class="syf-ck" id="yt-cl-wrap"><input type="checkbox" id="yt-cl"> <span>التحميل النظيف (يحمّل الفيديو أولاً ثم يفعّل التخطّي)</span></label>' +
        '<label class="syf-ck"><input type="checkbox" id="yt-ar"> <span>إعادة تحميل الصفحة تلقائياً عند التنازل</span></label>' +
        '<label>الحالة</label>' +
        '<div class="syf-note-row"><span class="t" id="yt-last">—</span></div>' +
        '<button class="syf-btn" id="yt-allow"></button>' +
        '<div class="syf-note-hint">إن كشف يوتيوب المانع، <b>ننزل درجة واحدة</b> نحو محرّك أهدأ (كامل ← آمن ← آمن بلا إخفاء ← مطفأ) ونُنبّهك، بدل الإيقاف الكامل دفعةً واحدة. <b>رسالة يوتيوب تبقى ظاهرة</b>: إخفاؤها لا يُعيد التشغيل، بل يترك شاشة سوداء بلا تفسير. إعادة التحميل <b>مرّة واحدة لكل فيديو</b> — لا حلقة تحميل.</div>' +
      '</div>'
    );
    panel.appendChild(root);

    var seg = root.querySelector('#yt-seg');
    var hint = root.querySelector('#yt-hint');
    var clWrap = root.querySelector('#yt-cl-wrap');
    var cosNote = root.querySelector('#yt-cos-note');
    var btns = [];
    var mode = 'full';

    function paint() {
      btns.forEach(function (b, i) { b.classList.toggle('on', MODES[i].key === mode); });
      hint.textContent = SYFS.t(MODE_HINT[mode]);
      clWrap.style.display = (mode === 'safe') ? '' : 'none';   /* clean-load only applies to the skip layer */
    }
    MODES.forEach(function (m) {
      var b = h('<button type="button"></button>');
      b.textContent = SYFS.t(m.label);
      b.addEventListener('click', function () {
        mode = m.key;
        /* A manual mode change is a fresh start — clear BOTH auto-demotion counters.
         * yt_wedges (playback wedges) and yt_detects (YouTube caught us) are separate
         * mechanisms; leaving either armed would let one more event instantly undo
         * the mode the user just picked. */
        SYFS.store.set('yt_wedges', 0);
        SYFS.store.set('yt_detects', 0);
        SYFS.store.set('yt_demoted_from', '');
        SYFS.store.set('yt_last', '');
        SYFS.store.set('yt_mode', mode);
        paint();
        root.querySelector('#yt-last').textContent = '—';
        cosNote.style.display = 'none';
      });
      seg.appendChild(b); btns.push(b);
    });

    SYFS.store.get('yt_mode', 'full').then(function (v) {
      mode = (v === 'off' || v === 'safe') ? v : 'full';
      paint();
    });
    SYFS.store.get('yt_last', '').then(function (v) {
      if (v) root.querySelector('#yt-last').textContent = v;   /* textContent — no injection */
    });
    /* Explain an auto-disabled cosmetic toggle: an unexplained unchecked box the
     * user never touched reads as a bug in our own settings panel. */
    SYFS.store.get('yt_demoted_from', '').then(function (v) {
      if (v === 'safe+cos') cosNote.style.display = '';
    });

    bindStore(root.querySelector('#yt-cos'), 'yt_cosmetic', true);
    bindStore(root.querySelector('#yt-sh'), 'yt_shorts', true);
    bindStore(root.querySelector('#yt-cl'), 'yt_clean_load', true);
    bindStore(root.querySelector('#yt-ar'), 'yt_auto_reload', false);

    var allowed = Array.isArray(status.allowed) ? status.allowed : [];
    var ytBtn = root.querySelector('#yt-allow');
    var ytOff = allowed.indexOf(YT) >= 0;
    ytBtn.textContent = ytOff ? SYFS.t('▶ إعادة تفعيل المنع في يوتيوب') : SYFS.t('⏸ استثناء يوتيوب كلّياً');
    ytBtn.addEventListener('click', function () {
      dnr('allow', { domain: YT, on: !ytOff }).then(refresh);
    });
  }

  /* ---- tab 3: Facebook ---- */
  var FB = 'facebook.com';

  function buildFacebook(panel, status, refresh) {
    var root = h(
      '<div class="syf-form">' +
        '<label class="syf-ck"><input type="checkbox" id="fb-on"> <span>مانع إعلانات فيسبوك</span></label>' +
        '<div class="syf-note-hint">فيسبوك يقدّم إعلاناته من <b>نفس أصل الصفحة</b> — فلا تستطيع طبقة الشبكة لمسها (حجب فيسبوك = حذف الموقع كلّه). لذلك كل مفتاح هنا <b>إخفاء في الصفحة</b>، لا حجب.</div>' +
        '<label class="syf-ck"><input type="checkbox" id="fb-sp"> <span>منشورات «ممول» في الصفحة الرئيسية</span></label>' +
        '<label class="syf-ck"><input type="checkbox" id="fb-sb"> <span>إعلانات العمود الجانبي</span></label>' +
        '<label class="syf-ck"><input type="checkbox" id="fb-sg"> <span>منشورات «مقترح لك» <b>— ليست إعلانات</b></span></label>' +
        '<div class="syf-note-hint">«مقترح لك» محتوى يقترحه فيسبوك، لا إعلان مدفوع. إخفاؤه قرارك أنت، لا قرارنا — لذلك يبقى <b>مطفأً</b> حتى تطلبه.</div>' +
        '<label>الحالة</label>' +
        '<div class="syf-out" style="grid-template-columns:1fr"><div><span>منشورات أُخفيت</span><b id="fb-n">0</b></div></div>' +
        '<button class="syf-btn" id="fb-reset">صفّر العدّاد</button>' +
        '<button class="syf-btn" id="fb-allow"></button>' +
        '<div class="syf-note-hint">فيسبوك يغيّر ترميزه باستمرار — سباق تسلّح، قد يحتاج تحديثاً دورياً. وقد <b>يومض</b> المنشور الممول إطاراً قبل اختفائه: لا يوجد محدّد ثابت نُخفيه به قبل ظهوره. العدّاد <b>رقم مجرّد</b> — لا نقرأ ولا نحفظ ولا نرسل محتوى أي منشور.</div>' +
      '</div>'
    );
    panel.appendChild(root);

    bindStore(root.querySelector('#fb-on'), 'fb_adblock', true);
    bindStore(root.querySelector('#fb-sp'), 'fb_sponsored', true);
    bindStore(root.querySelector('#fb-sb'), 'fb_sidebar', true);
    bindStore(root.querySelector('#fb-sg'), 'fb_suggested', false);

    var nEl = root.querySelector('#fb-n');
    SYFS.store.get('fb_hidden', 0).then(function (v) { nEl.textContent = String(v || 0); });
    root.querySelector('#fb-reset').addEventListener('click', function () {
      SYFS.store.set('fb_hidden', 0);
      nEl.textContent = '0';
    });

    var allowed = Array.isArray(status.allowed) ? status.allowed : [];
    var fbBtn = root.querySelector('#fb-allow');
    var fbOff = allowed.indexOf(FB) >= 0;
    fbBtn.textContent = fbOff ? SYFS.t('▶ إعادة تفعيل المنع في فيسبوك') : SYFS.t('⏸ استثناء فيسبوك كلّياً');
    fbBtn.addEventListener('click', function () {
      dnr('allow', { domain: FB, on: !fbOff }).then(refresh);
    });
  }

  /* ---- tab 4: tracking ---- */
  function buildTracking(panel, status) {
    var root = h(
      '<div class="syf-form">' +
        '<label class="syf-ck"><input type="checkbox" id="sh-trk"> <span>منع أدوات التحليلات</span></label>' +
        '<label class="syf-ck"><input type="checkbox" id="sh-fp"> <span>منع بصمة المتصفّح وتسجيل الجلسة</span></label>' +
        '<label class="syf-ck"><input type="checkbox" id="sh-px"> <span>منع بكسلات التتبّع ونبضات الإشارة</span></label>' +
        '<div class="syf-note-hint">كل مفتاح = قائمة حجب منفصلة في طبقة الشبكة. أدوات مكافحة الاحتيال البنكية (ThreatMetrix وأمثالها) <b>ليست</b> في القوائم عمداً — حجبها يعطّل تسجيل الدخول للبنوك.</div>' +
      '</div>'
    );
    panel.appendChild(root);

    var fail = failNote(root);
    bindRuleset(root.querySelector('#sh-trk'), 'tracking', status, fail);
    bindRuleset(root.querySelector('#sh-fp'), 'fingerprint', status, fail);
    bindRuleset(root.querySelector('#sh-px'), 'pixels', status, fail);
    root.appendChild(counterNote());
  }

  /* ---- registration ---- */
  SYFS.cats = SYFS.cats || {};
  SYFS.cats.shield = {
    label: 'الحماية',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M9.3 12l1.9 1.9 3.5-3.8"/></svg>'
  };

  SYFS.tools = SYFS.tools || [];
  SYFS.tools.push({
    id: 'adblock',
    name: 'مانع الإعلانات والتتبّع',
    cat: 'shield',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M5.7 5.7l12.6 12.6"/></svg>',
    mount: function (body) {
      /* One status round-trip feeds all four tabs. A change to the allowlist must
       * re-mount them all (it is shown in three of them), so the rebuild carries the
       * tab index with it — otherwise excluding YouTube from the YouTube tab would
       * dump the user back on tab 1. */
      function render(active) {
        dnr('status').then(function (s) {
          body.textContent = '';
          if (!s.ok) {
            /* re-render the SAME tab, not tab 1 — a failed refresh is not a reason
               to move the user somewhere they were not */
            body.appendChild(dnrFail(s, function () { render(active); }));
            return;
          }
          SYFS.tabs(body, [
            { label: 'كل المواقع', build: function (p) { buildSites(p, s, function () { render(0); }); } },
            { label: 'يوتيوب',     build: function (p) { buildYouTube(p, s, function () { render(1); }); } },
            { label: 'فيسبوك',     build: function (p) { buildFacebook(p, s, function () { render(2); }); } },
            { label: 'التتبّع',    build: function (p) { buildTracking(p, s); } }
          ], active);
        });
      }
      render(0);
    }
  });
}());
