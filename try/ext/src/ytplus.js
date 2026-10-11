/* SYF — «▶ يوتيوب+»: the tool panel. Two tabs: التشغيل · الإخفاء.
 *
 * Lazy-injected by background.js (LAZY_TOOL_FILES) like every other tool body.
 * Deliberately SEPARATE from the 🛡 tool: that one is security (ad/tracker
 * blocking), this one is experience. Merging them would tie a playback bug to the
 * ad blocker's demotion ladder and make switching the blocker off look like it also
 * dropped the user's speed and quality.
 *
 * Division of labour with the engine (src/yt-plus.js):
 *   • Every PERSISTENT setting is written to chrome.storage and nothing else. The
 *     engine reacts through storage.onChanged. Neither side can hold a stale copy
 *     of the truth, and the panel works identically on a page that has no engine.
 *   • Only genuinely LIVE actions (A/B points, the instant speed nudge) call
 *     SYFS.ytp — the engine's handle, published into the same isolated world. If it
 *     is absent (any page that is not YouTube) those controls are simply not built,
 *     rather than rendered dead.
 *
 * Off YouTube the panel still edits the defaults — they are global preferences that
 * take effect on the next YouTube page — with a banner saying exactly that. */
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

  /* self-clearing ticker — dies with the tool window (documented project pattern) */
  function every(body, ms, fn) {
    var iv = setInterval(function () { if (!body.isConnected) { clearInterval(iv); return; } fn(); }, ms);
    fn();
    return iv;
  }

  /* ---- the same whitelists the engine enforces. Duplicated on purpose: the panel
   * must not be able to offer a value the engine will reject and silently replace,
   * which would show the user a setting that is not in effect. ---- */
  var QUALITIES = [
    { v: 'auto', t: 'تلقائية (يوتيوب يقرّر)' },
    { v: '144', t: '144p' }, { v: '240', t: '240p' }, { v: '360', t: '360p' },
    { v: '480', t: '480p' }, { v: '720', t: '720p (HD)' }, { v: '1080', t: '1080p (Full HD)' },
    { v: '1440', t: '1440p (2K)' }, { v: '2160', t: '2160p (4K)' }
  ];
  var SPEED_MIN = 0.07, SPEED_MAX = 16;
  var GAIN_MAX = 5, GAIN_SAFE = 3, BASS_MAX = 15;
  var PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  var HOST = (location.hostname || '').toLowerCase();
  function onYouTube() { return /(^|\.)youtube(-nocookie)?\.com$/.test(HOST); }
  function eng() { return (window.SYFS && SYFS.ytp && SYFS.ytp.ready) ? SYFS.ytp : null; }

  function clamp(n, lo, hi, dflt) {
    var v = typeof n === 'number' ? n : parseFloat(n);
    if (!isFinite(v)) return dflt;
    return Math.min(hi, Math.max(lo, v));
  }
  function fmtTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  /* trims 1.50 → 1.5 and 1.00 → 1 without ever showing scientific notation */
  function fmtRate(n) { return String(Math.round(n * 100) / 100); }

  /* checkbox ⇄ storage key (all hide switches default OFF: a fresh install must not
   * change what YouTube looks like) */
  function bindCk(ck, key, dflt) {
    store.get(key, dflt).then(function (v) { ck.checked = (v === true); });
    ck.addEventListener('change', function () { store.set(key, ck.checked); });
  }

  function banner() {
    return h('<div class="syf-note-hint">أنت لست في يوتيوب الآن — الإعدادات تُحفظ وتسري تلقائياً عند فتح أي صفحة يوتيوب. أدوات اللحظة (تحديد مقطع A→B) تظهر داخل يوتيوب فقط.</div>');
  }

  /* ================= tab 1: التشغيل ================= */
  function buildPlayback(panel) {
    var root = h(
      '<div class="syf-form">' +
        '<label class="syf-ck"><input type="checkbox" id="yp-on"> <span><b>تشغيل يوتيوب+</b> — إطفاؤه يُعيد يوتيوب كما هو تماماً</span></label>' +

        '<label>سرعة التشغيل الافتراضية</label>' +
        '<div class="syf-seg" id="yp-pre" style="flex-wrap:wrap"></div>' +
        '<div class="syf-row">' +
          '<button class="syf-mini" id="yp-dn" type="button" title="أبطأ">−</button>' +
          '<input type="number" class="syf-in" id="yp-sp" step="0.05" style="text-align:center">' +
          '<button class="syf-mini" id="yp-up" type="button" title="أسرع">+</button>' +
        '</div>' +
        '<div class="syf-note-hint">المدى 0.07× → 16×. الـ16× هو سقف المتصفّح نفسه، لا سقفنا. السرعة 1× تعني «لا تتدخّل» — يبقى اختيار يوتيوب واختيارك اليدوي كما هما.</div>' +

        '<label>الجودة الافتراضية</label>' +
        '<select class="syf-in" id="yp-q"></select>' +
        '<div class="syf-note-hint">إن لم تتوفّر الجودة المطلوبة في الفيديو، يُختار أعلى جودة متاحة لا تتجاوزها.</div>' +

        '<label>مضخّم الصوت</label>' +
        '<div class="syf-row"><input type="range" id="yp-g" min="1" max="' + GAIN_MAX + '" step="0.1"><b id="yp-gv" style="min-width:46px;text-align:center">1×</b></div>' +
        '<label>تعزيز الباس</label>' +
        '<div class="syf-row"><input type="range" id="yp-b" min="0" max="' + BASS_MAX + '" step="1"><b id="yp-bv" style="min-width:46px;text-align:center">0</b></div>' +
        '<div class="syf-note-warn" id="yp-gw" style="display:none"></div>' +
        '<div class="syf-note-hint">التضخيم يعمل عبر معالج الصوت في المتصفّح. لا يبدأ إلا عند رفعه فوق 1× — وبعد أن يبدأ يبقى مسار الصوت عبره حتى تُغلق الصفحة.</div>' +

        '<label class="syf-ck"><input type="checkbox" id="yp-loop"> <span>تكرار الفيديو كاملاً</span></label>' +
        '<label class="syf-ck"><input type="checkbox" id="yp-nan"> <span>لا تنتقل تلقائياً للفيديو التالي</span></label>' +
        '<label class="syf-ck"><input type="checkbox" id="yp-nap"> <span>لا تشغّل الفيديو تلقائياً عند فتح الصفحة</span></label>' +
        '<div class="syf-note-hint">«لا تنتقل تلقائياً» يُطفئ مفتاح يوتيوب نفسه — يبقى مطفأً حتى لو أزلت الإضافة، ويمكنك إعادته من المشغّل.</div>' +
      '</div>'
    );
    panel.appendChild(root);
    if (!onYouTube()) panel.insertBefore(banner(), root);

    /* --- master --- (not bindCk: this is the one switch that defaults to ON, so it
     * reads `!== false` rather than `=== true`) */
    var onCk = root.querySelector('#yp-on');
    store.get('ytp_on', true).then(function (v) { onCk.checked = (v !== false); });
    onCk.addEventListener('change', function () { store.set('ytp_on', onCk.checked); });

    /* --- speed --- */
    var spIn = root.querySelector('#yp-sp');
    var preWrap = root.querySelector('#yp-pre');
    var preBtns = [];
    PRESETS.forEach(function (p) {
      var b = h('<button type="button"></button>');
      b.textContent = fmtRate(p) + '×';
      b.addEventListener('click', function () { setSpeed(p); });
      preWrap.appendChild(b); preBtns.push({ b: b, v: p });
    });

    function paintSpeed(v) {
      spIn.value = fmtRate(v);
      preBtns.forEach(function (o) { o.b.classList.toggle('on', Math.abs(o.v - v) < 0.001); });
    }
    function setSpeed(v) {
      var n = clamp(v, SPEED_MIN, SPEED_MAX, 1);
      paintSpeed(n);
      store.set('ytp_speed', n);
      var e = eng();
      /* Applied to the running video immediately; storage would reach the engine a
       * beat later and the delay reads as a dead button. */
      if (e && n !== 1) e.nudge(n);
    }
    store.get('ytp_speed', 1).then(function (v) { paintSpeed(clamp(v, SPEED_MIN, SPEED_MAX, 1)); });
    spIn.addEventListener('change', function () { setSpeed(spIn.value); });
    root.querySelector('#yp-up').addEventListener('click', function () { setSpeed(clamp(spIn.value, SPEED_MIN, SPEED_MAX, 1) + 0.25); });
    root.querySelector('#yp-dn').addEventListener('click', function () { setSpeed(clamp(spIn.value, SPEED_MIN, SPEED_MAX, 1) - 0.25); });

    /* --- quality --- */
    var qSel = root.querySelector('#yp-q');
    QUALITIES.forEach(function (q) {
      var o = document.createElement('option');
      o.value = q.v; o.textContent = q.t;
      qSel.appendChild(o);
    });
    store.get('ytp_quality', 'auto').then(function (v) {
      var ok = QUALITIES.some(function (q) { return q.v === v; });
      qSel.value = ok ? v : 'auto';
    });
    qSel.addEventListener('change', function () { store.set('ytp_quality', qSel.value); });

    /* --- audio --- */
    var gIn = root.querySelector('#yp-g'), gVal = root.querySelector('#yp-gv');
    var bIn = root.querySelector('#yp-b'), bVal = root.querySelector('#yp-bv');
    var gWarn = root.querySelector('#yp-gw');

    function paintGain(v) {
      gVal.textContent = fmtRate(v) + '×';
      if (v > GAIN_SAFE) {
        gWarn.textContent = SYFS.t('تحذير: فوق {0}× يبدأ تشويه الصوت وقد يؤذي السمع مع السمّاعات. هذه القيمة لا تُحفظ لجلسة جديدة — تعود إلى {1}× عند إعادة تحميل الصفحة.', GAIN_SAFE, GAIN_SAFE);
        gWarn.style.display = '';
      } else {
        gWarn.style.display = 'none';
      }
    }
    store.get('ytp_gain', 1).then(function (v) { var n = clamp(v, 1, GAIN_MAX, 1); gIn.value = n; paintGain(n); });
    store.get('ytp_bass', 0).then(function (v) { var n = clamp(v, 0, BASS_MAX, 0); bIn.value = n; bVal.textContent = String(n); });
    gIn.addEventListener('input', function () { paintGain(clamp(gIn.value, 1, GAIN_MAX, 1)); });
    gIn.addEventListener('change', function () { store.set('ytp_gain', clamp(gIn.value, 1, GAIN_MAX, 1)); });
    bIn.addEventListener('input', function () { bVal.textContent = String(clamp(bIn.value, 0, BASS_MAX, 0)); });
    bIn.addEventListener('change', function () { store.set('ytp_bass', clamp(bIn.value, 0, BASS_MAX, 0)); });

    /* --- toggles --- */
    bindCk(root.querySelector('#yp-loop'), 'ytp_loop', false);
    bindCk(root.querySelector('#yp-nan'), 'ytp_no_autonext', false);
    bindCk(root.querySelector('#yp-nap'), 'ytp_no_autoplay', false);

    /* --- live A→B — only where there is a player to read --- */
    if (eng()) buildAB(root);
  }

  /* A/B is a live scrubbing aid, not a preference: it is held in the engine's memory
   * for one video and never persisted — storing it would mean storing a video id. */
  function buildAB(root) {
    var ab = h(
      '<div>' +
        '<label>تكرار مقطع محدّد (A → B)</label>' +
        '<div class="syf-row">' +
          '<button class="syf-mini" id="yp-a" type="button">ضع A</button>' +
          '<button class="syf-mini" id="yp-b2" type="button">ضع B</button>' +
          '<button class="syf-mini danger" id="yp-abx" type="button">مسح</button>' +
        '</div>' +
        '<div class="syf-out" id="yp-abo"><div><span>A</span><b>—</b></div><div><span>B</span><b>—</b></div></div>' +
        '<div class="syf-note-hint" id="yp-abmsg"></div>' +
      '</div>'
    );
    root.appendChild(ab);

    var outs = ab.querySelectorAll('#yp-abo b');
    var msg = ab.querySelector('#yp-abmsg');
    var pendA = null;

    function paint() {
      var e = eng();
      var i = e ? e.info() : null;
      if (!i || !i.has) { outs[0].textContent = '—'; outs[1].textContent = '—'; msg.textContent = SYFS.t('لا يوجد فيديو مفتوح في هذه الصفحة.'); return; }
      outs[0].textContent = i.a !== null ? fmtTime(i.a) : (pendA !== null ? SYFS.t('{0} (بانتظار B)', fmtTime(pendA)) : '—');
      outs[1].textContent = i.b !== null ? fmtTime(i.b) : '—';
      if (i.a !== null) msg.textContent = SYFS.t('المقطع يتكرّر الآن.');
      else if (pendA !== null) msg.textContent = SYFS.t('حدّد نقطة النهاية B.');
      else msg.textContent = SYFS.t('شغّل الفيديو حتى بداية المقطع ثم اضغط «ضع A».');
    }

    ab.querySelector('#yp-a').addEventListener('click', function () {
      var e = eng(); if (!e) return;
      var i = e.info(); if (!i.has) return;
      pendA = i.time;
      e.clearAB();
      paint();
    });
    ab.querySelector('#yp-b2').addEventListener('click', function () {
      var e = eng(); if (!e) return;
      var i = e.info(); if (!i.has) return;
      if (pendA === null) { msg.textContent = SYFS.t('ضع نقطة البداية A أوّلاً.'); return; }
      if (!e.setAB(pendA, i.time)) { msg.textContent = SYFS.t('المقطع قصير جداً — اجعل الفرق بين A و B نصف ثانية على الأقلّ.'); return; }
      pendA = null;
      paint();
    });
    ab.querySelector('#yp-abx').addEventListener('click', function () {
      var e = eng(); if (e) e.clearAB();
      pendA = null;
      paint();
    });

    every(root, 1000, paint);
  }

  /* ================= tab 2: الإخفاء ================= */
  function buildHide(panel) {
    var root = h(
      '<div class="syf-form">' +
        '<label class="syf-ck"><input type="checkbox" id="yh-end"> <span>شاشات النهاية (المربّعات فوق آخر الفيديو)</span></label>' +
        '<label class="syf-ck"><input type="checkbox" id="yh-card"> <span>بطاقات المعلومات والاقتراحات داخل المشغّل</span></label>' +
        '<label class="syf-ck"><input type="checkbox" id="yh-rel"> <span>الفيديوهات ذات الصلة (العمود الجانبي)</span></label>' +
        '<label class="syf-ck"><input type="checkbox" id="yh-com"> <span>التعليقات</span></label>' +
        '<label class="syf-ck"><input type="checkbox" id="yh-chat"> <span>الدردشة المباشرة</span></label>' +
        '<label class="syf-ck"><input type="checkbox" id="yh-home"> <span>مقترحات الصفحة الرئيسية (تبقى صفحة بحث فقط)</span></label>' +

        '<label>شورتس (Shorts)</label>' +
        '<div class="syf-seg" id="yh-sh">' +
          '<button type="button" data-v="off">كما هي</button>' +
          '<button type="button" data-v="hide">إخفاؤها</button>' +
          '<button type="button" data-v="asvideo">كفيديو عادي</button>' +
        '</div>' +
        '<div class="syf-note-hint">«كفيديو عادي» يفتح رابط الشورت في مشغّل المشاهدة العادي — بمشغّل كامل وسرعة وجودة وتعليقات.</div>' +
        '<div class="syf-note-hint">كل مفتاح هنا إخفاء في الصفحة فقط، ويسري فوراً بلا إعادة تحميل. لا يُحجب أي طلب شبكي — منع الإعلانات شأن أداة 🛡 وحدها.</div>' +
      '</div>'
    );
    panel.appendChild(root);
    if (!onYouTube()) panel.insertBefore(banner(), root);

    bindCk(root.querySelector('#yh-end'), 'ytp_hide_endscreen', false);
    bindCk(root.querySelector('#yh-card'), 'ytp_hide_cards', false);
    bindCk(root.querySelector('#yh-rel'), 'ytp_hide_related', false);
    bindCk(root.querySelector('#yh-com'), 'ytp_hide_comments', false);
    bindCk(root.querySelector('#yh-chat'), 'ytp_hide_chat', false);
    bindCk(root.querySelector('#yh-home'), 'ytp_hide_home_feed', false);

    seg(root.querySelector('#yh-sh'), 'ytp_shorts', ['off', 'hide', 'asvideo'], 'off');
  }

  /* ================= tab 3: المظهر ================= */
  function buildLook(panel) {
    var root = h(
      '<div class="syf-form">' +
        '<label class="syf-ck"><input type="checkbox" id="yl-cin"> <span>وضع السينما — تعتيم كل ما حول المشغّل</span></label>' +
        '<div class="syf-row"><label style="margin:0;min-width:52px">التعتيم</label><input type="range" id="yl-dim" min="0" max="95" step="5"><b id="yl-dimv" style="min-width:46px;text-align:center">70%</b></div>' +

        '<label>حجم المشغّل</label>' +
        '<div class="syf-seg" id="yl-wide">' +
          '<button type="button" data-v="off">عادي</button>' +
          '<button type="button" data-v="wide">عريض</button>' +
          '<button type="button" data-v="fill">ملء النافذة</button>' +
        '</div>' +
        '<div class="syf-note-hint">«ملء النافذة» يملأ نافذة المتصفّح بلا الدخول في وضع ملء الشاشة — فيبقى شريط التبويبات ظاهراً.</div>' +

        '<label class="syf-ck"><input type="checkbox" id="yl-pin"> <span>ثبّت المشغّل في الزاوية عند التمرير لأسفل</span></label>' +
        '<div class="syf-note-hint">يُعطَّل تلقائياً أثناء «ملء النافذة» أو النافذة العائمة — ثلاثتها تتنازع موضع المشغّل.</div>' +

        '<label>فلاتر الصورة (على الفيديو وحده، لا على واجهة يوتيوب)</label>' +
        '<div class="syf-row"><label style="margin:0;min-width:52px">السطوع</label><input type="range" id="yl-br" min="50" max="200" step="5"><b id="yl-brv" style="min-width:46px;text-align:center">100%</b></div>' +
        '<div class="syf-row"><label style="margin:0;min-width:52px">التباين</label><input type="range" id="yl-co" min="50" max="200" step="5"><b id="yl-cov" style="min-width:46px;text-align:center">100%</b></div>' +
        '<div class="syf-row"><label style="margin:0;min-width:52px">التشبّع</label><input type="range" id="yl-sa" min="0" max="300" step="5"><b id="yl-sav" style="min-width:46px;text-align:center">100%</b></div>' +
        '<button class="syf-mini" id="yl-frst" type="button">تصفير الفلاتر</button>' +

        '<label class="syf-ck"><input type="checkbox" id="yl-blk"> <span>أسود صافٍ (OLED) بدل رمادي الوضع الداكن</span></label>' +
        '<div class="syf-note-hint">يعمل فقط إن كان الوضع الداكن مُفعَّلاً في يوتيوب نفسه — لا نُبدّل ثيم الموقع من تحت المستخدم.</div>' +

        '<label>لون التمييز (شريط التقدّم ومقبض الصوت)</label>' +
        '<div class="syf-row"><input type="color" id="yl-acc" class="syf-in" style="height:38px;padding:3px"><button class="syf-mini" id="yl-accx" type="button">بلا لون</button></div>' +
        '<div class="syf-note-hint">⛔ نسخة داكنة واحدة ولون واحد — لا «50+ ثيم». ما يُوعَد به يجب أن يُصان.</div>' +
      '</div>'
    );
    panel.appendChild(root);
    if (!onYouTube()) panel.insertBefore(banner(), root);

    function live() { var e = eng(); if (e) e.refresh(); }
    function prev(o) { var e = eng(); if (e) e.preview(o); }

    /* cinema */
    var cin = root.querySelector('#yl-cin');
    store.get('ytp_cinema', false).then(function (v) { cin.checked = (v === true); });
    cin.addEventListener('change', function () { store.set('ytp_cinema', cin.checked); live(); });

    var dim = root.querySelector('#yl-dim'), dimV = root.querySelector('#yl-dimv');
    store.get('ytp_cinema_dim', 70).then(function (v) { var n = clamp(v, 0, 95, 70); dim.value = n; dimV.textContent = n + '%'; });
    dim.addEventListener('input', function () {
      var n = clamp(dim.value, 0, 95, 70);
      dimV.textContent = n + '%';
      prev({ dim: n });                       /* the veil follows the slider as it moves */
    });
    dim.addEventListener('change', function () { store.set('ytp_cinema_dim', clamp(dim.value, 0, 95, 70)); });

    /* player size */
    seg(root.querySelector('#yl-wide'), 'ytp_wide', ['off', 'wide', 'fill'], 'off', live);

    var pin = root.querySelector('#yl-pin');
    store.get('ytp_pin', false).then(function (v) { pin.checked = (v === true); });
    pin.addEventListener('change', function () { store.set('ytp_pin', pin.checked); live(); });

    /* filters */
    var fl = [
      { el: root.querySelector('#yl-br'), out: root.querySelector('#yl-brv'), key: 'ytp_bright', lo: 50, hi: 200, d: 100, p: 'bright' },
      { el: root.querySelector('#yl-co'), out: root.querySelector('#yl-cov'), key: 'ytp_contrast', lo: 50, hi: 200, d: 100, p: 'contrast' },
      { el: root.querySelector('#yl-sa'), out: root.querySelector('#yl-sav'), key: 'ytp_sat', lo: 0, hi: 300, d: 100, p: 'sat' }
    ];
    fl.forEach(function (f) {
      store.get(f.key, f.d).then(function (v) { var n = clamp(v, f.lo, f.hi, f.d); f.el.value = n; f.out.textContent = n + '%'; });
      f.el.addEventListener('input', function () {
        var n = clamp(f.el.value, f.lo, f.hi, f.d);
        f.out.textContent = n + '%';
        var o = {}; o[f.p] = n; prev(o);
      });
      f.el.addEventListener('change', function () { store.set(f.key, clamp(f.el.value, f.lo, f.hi, f.d)); });
    });
    root.querySelector('#yl-frst').addEventListener('click', function () {
      fl.forEach(function (f) {
        f.el.value = f.d; f.out.textContent = f.d + '%';
        store.set(f.key, f.d);
      });
      prev({ bright: 100, contrast: 100, sat: 100 });
    });

    /* theme */
    var blk = root.querySelector('#yl-blk');
    store.get('ytp_theme', 'off').then(function (v) { blk.checked = (v === 'black'); });
    blk.addEventListener('change', function () { store.set('ytp_theme', blk.checked ? 'black' : 'off'); live(); });

    var acc = root.querySelector('#yl-acc');
    store.get('ytp_accent', '').then(function (v) { acc.value = /^#[0-9a-f]{6}$/i.test(v) ? v : '#457364'; });
    acc.addEventListener('change', function () {
      /* the engine re-parses and rebuilds this before it reaches any stylesheet */
      var v = String(acc.value || '');
      store.set('ytp_accent', /^#[0-9a-f]{6}$/i.test(v) ? v : '');
      live();
    });
    root.querySelector('#yl-accx').addEventListener('click', function () { store.set('ytp_accent', ''); live(); });
  }

  /* ================= tab 4: إضافات ================= */
  var ACT_LABEL = {
    speedUp: 'أسرع (+0.25)', speedDown: 'أبطأ (−0.25)', speedReset: 'إرجاع السرعة الافتراضية',
    shot: 'لقطة إطار', cinema: 'وضع السينما', pip: 'نافذة عائمة', wide: 'تدوير حجم المشغّل',
    abA: 'ضع نقطة A', abB: 'ضع نقطة B', abClear: 'مسح المقطع'
  };
  /* mirrors COMBO_RE in the engine — the panel must not be able to offer a combo the
   * engine will throw away, and a bare key would silently break YouTube's own keys */
  var COMBO_RE = /^(?:(?:alt|ctrl|shift|meta)\+){1,4}(?:Key[A-Z]|Digit[0-9]|F[1-9][0-2]?|Arrow(?:Up|Down|Left|Right)|Bracket(?:Left|Right)|Backslash|Semicolon|Quote|Comma|Period|Slash|Minus|Equal|Backquote|Space|Enter|Home|End|PageUp|PageDown)$/;
  var DEFAULT_KEYS = {
    speedUp: 'alt+ctrl+ArrowUp', speedDown: 'alt+ctrl+ArrowDown', speedReset: 'alt+ctrl+Digit0',
    shot: 'alt+ctrl+KeyS', cinema: 'alt+ctrl+KeyC', pip: 'alt+ctrl+KeyP', wide: 'alt+ctrl+KeyW',
    abA: 'alt+ctrl+BracketLeft', abB: 'alt+ctrl+BracketRight', abClear: 'alt+ctrl+Backslash'
  };
  /* التسليح واحد على مستوى الملفّ لا على مستوى الصفّ: المستمع على window وبطور
     الالتقاط، فصفٌّ ثانٍ يُسلَّح فوق الأول يبتلع كل ضغطة في الصفحة ويربط التركيبة
     نفسها بفعلين. ونافذة الأداة تُنزَع من الـDOM بلا حدث إغلاق، فمستمعٌ بقي مسلَّحاً
     بعد رحيلها يتيمٌ لا ينزعه أحد — يُنزَع بحارس `isConnected` نفسه الذي تحيا به
     مؤقّتات هذا الملف (انظر every أعلاه). */
  var armedKey = null;
  function disarmKey() {
    if (!armedKey) return;
    var f = armedKey; armedKey = null; f();
  }
  /* human-readable form of a stored combo — display only, never parsed back */
  function comboText(c) {
    return String(c || '')
      .replace('alt+', 'Alt+').replace('ctrl+', 'Ctrl+').replace('shift+', 'Shift+').replace('meta+', 'Cmd+')
      .replace(/Key([A-Z])/, '$1').replace(/Digit([0-9])/, '$1')
      .replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→')
      .replace('BracketLeft', '[').replace('BracketRight', ']').replace('Backslash', '\\');
  }
  /* the combo a keydown spells, or null while only a modifier is down. Recording Ctrl+Alt+S
     means pressing Alt FIRST, and that keydown (key 'Alt', code 'AltLeft', altKey true)
     used to be taken as the whole answer — 'alt+AltLeft', rejected before the letter
     ever arrived, so no Alt combo could be recorded at all. */
  var MOD_KEYS = { Alt: 1, AltGraph: 1, Control: 1, Shift: 1, Meta: 1, OS: 1 };
  function comboOf(ev) {
    if (MOD_KEYS[ev.key]) return null;
    var mods = '';
    if (ev.altKey) mods += 'alt+';
    if (ev.ctrlKey) mods += 'ctrl+';
    if (ev.shiftKey) mods += 'shift+';
    if (ev.metaKey) mods += 'meta+';
    return mods + (ev.code || '');
  }
  /* order- and case-free form, so ours ('alt+shift+KeyS') meets the bar's
     ('Shift+Alt+KeyS', src/rail.js comboFromEvent) */
  function comboKey(c) {
    var p = String(c || '').toLowerCase().split('+'), code = p.pop();
    return p.sort().join('+') + '|' + code;
  }
  /* the bar's own shortcuts as { combo, name }: the user's entry for a tool wins over the
     tool's shipped default, and `false` there means "unbound" (see hkOf in src/rail.js) */
  function railCombos(user) {
    var u = (user && typeof user === 'object') ? user : {};
    var out = [];
    (SYFS.tools || []).forEach(function (t) {
      var c = Object.prototype.hasOwnProperty.call(u, t.id) ? u[t.id] : t.hotkey;
      if (typeof c === 'string' && c) out.push({ combo: c, name: t.name });
    });
    return out;
  }
  /* the msgid of the OTHER command already on `combo`, or null. Two commands on one
     combo both fire on one keystroke, with nothing to say why. */
  function keyClash(action, combo, map, rail) {
    var k = comboKey(combo);
    for (var a in DEFAULT_KEYS) {
      if (a !== action && comboKey(map[a] || DEFAULT_KEYS[a]) === k) return ACT_LABEL[a];
    }
    for (var i = 0; i < rail.length; i++) if (comboKey(rail[i].combo) === k) return rail[i].name;
    return null;
  }

  function buildExtras(panel) {
    var root = h(
      '<div class="syf-form">' +
        '<label>اللحظة الحالية</label>' +
        '<div class="syf-row">' +
          '<button class="syf-mini" id="yx-shot" type="button">📸 احفظ لقطة</button>' +
          '<button class="syf-mini" id="yx-copy" type="button">نسخ اللقطة</button>' +
          '<button class="syf-mini" id="yx-pip" type="button">نافذة عائمة</button>' +
        '</div>' +
        '<div class="syf-note-hint" id="yx-msg">اللقطة بأبعاد الفيديو الأصلية لا بأبعاد العرض. لا تُحفظ عندنا ولا تُرسَل.</div>' +

        '<label>النافذة العائمة</label>' +
        '<label class="syf-ck"><input type="checkbox" id="yx-pipbtn"> <span>زرّ النافذة العائمة داخل مشغّل يوتيوب</span></label>' +
        '<div class="syf-note-hint">يظهر في شريط تحكّم الفيديو نفسه بجانب أزرار يوتيوب، فلا تحتاج فتح هذه اللوحة مع كل فيديو. ومفتاح Ctrl+Alt+P يعمل في الحالتين.</div>' +

        '<label>قائمة التشغيل</label>' +
        '<label class="syf-ck"><input type="checkbox" id="yx-rev"> <span>شغّلها بالعكس (ينتقل للسابق عند انتهاء الفيديو)</span></label>' +
        '<div class="syf-row">' +
          '<button class="syf-mini" id="yx-prev" type="button">◀ السابق</button>' +
          '<button class="syf-mini" id="yx-next" type="button">التالي ▶</button>' +
        '</div>' +
        '<div class="syf-note-hint">تفعيل العكس يُطفئ «التشغيل التلقائي للتالي» في يوتيوب — وإلّا سبقنا يوتيوب للأمام قبل أن نرجع للخلف.</div>' +

        '<label>عجلة الماوس فوق المشغّل</label>' +
        '<div class="syf-seg" id="yx-wh">' +
          '<button type="button" data-v="off">مطفأة</button>' +
          '<button type="button" data-v="vol">الصوت</button>' +
          '<button type="button" data-v="speed">السرعة</button>' +
          '<button type="button" data-v="seek">التقديم</button>' +
        '</div>' +
        '<div class="syf-note-hint">مطفأة افتراضياً — خطف عجلة التمرير بلا طلب سلوك عدائي.</div>' +

        '<label class="syf-ck"><input type="checkbox" id="yx-keys"> <span>اختصارات لوحة المفاتيح</span></label>' +
        '<div class="syf-note-hint">اضغط على أي زرّ أدناه ثم اضغط التركيبة الجديدة. <b>يجب أن تحوي Alt أو Ctrl أو Shift</b> — تركيبة بحرف مجرّد كانت ستكسر مفاتيح يوتيوب نفسها بلا تفسير. لا تعمل أثناء الكتابة في بحث أو تعليق.</div>' +
        '<div class="syf-note-list" id="yx-keylist"></div>' +
        '<button class="syf-mini" id="yx-keyrst" type="button">إرجاع الاختصارات الافتراضية</button>' +
      '</div>'
    );
    panel.appendChild(root);
    if (!onYouTube()) panel.insertBefore(banner(), root);

    var msg = root.querySelector('#yx-msg');
    function say(t, a, b) { msg.textContent = SYFS.t(t, a, b); }

    var SHOT_ERR = {
      'no-video': 'لا يوجد فيديو مفتوح في هذه الصفحة.',
      'not-ready': 'الفيديو لم يُحمّل إطاراً بعد — شغّله لحظة ثم أعد المحاولة.',
      draw: 'تعذّر قراءة الإطار من المشغّل.',
      encode: 'تعذّر ترميز الصورة.',
      tainted: 'المتصفّح منع قراءة الإطار من هذا الفيديو.',
      url: 'تعذّر تجهيز الملف.',
      'no-clipboard': 'متصفّحك لا يدعم نسخ الصور إلى الحافظة — استخدم «احفظ لقطة».',
      clipboard: 'تعذّر النسخ إلى الحافظة.'
    };
    function shotDone(r) {
      if (r.ok) say('تمّت — {0}×{1} بكسل.', r.w, r.h);
      else say(SHOT_ERR[r.err] || 'تعذّرت العملية.');
    }

    root.querySelector('#yx-shot').addEventListener('click', function () {
      var e = eng(); if (!e) { say('افتح فيديو يوتيوب أوّلاً.'); return; }
      e.shotSave(shotDone);
    });
    root.querySelector('#yx-copy').addEventListener('click', function () {
      var e = eng(); if (!e) { say('افتح فيديو يوتيوب أوّلاً.'); return; }
      e.shotCopy(shotDone);
    });
    root.querySelector('#yx-pip').addEventListener('click', function () {
      var e = eng(); if (!e) { say('افتح فيديو يوتيوب أوّلاً.'); return; }
      say(e.pip() ? 'تمّ تبديل النافذة العائمة.' : 'المتصفّح رفض النافذة العائمة لهذا الفيديو.');
    });

    /* default ON — the button is the answer to "four gestures per video", and an
       opt-in switch would put one of those gestures back (see yt-plus.js DEFAULTS) */
    var pipCk = root.querySelector('#yx-pipbtn');
    store.get('ytp_pipbtn', true).then(function (v) { pipCk.checked = (v !== false); });
    pipCk.addEventListener('change', function () { store.set('ytp_pipbtn', pipCk.checked); });

    var rev = root.querySelector('#yx-rev');
    store.get('ytp_reverse', false).then(function (v) { rev.checked = (v === true); });
    rev.addEventListener('change', function () {
      store.set('ytp_reverse', rev.checked);
      /* the engine turns YouTube's autonav off on its next scan; say so now */
      if (rev.checked) store.set('ytp_no_autonext', true);
    });
    root.querySelector('#yx-prev').addEventListener('click', function () {
      var e = eng();
      say(e && e.prev() ? 'انتقلنا للسابق.' : 'لا توجد قائمة تشغيل مفتوحة، أو هذا أوّل فيديو فيها.');
    });
    root.querySelector('#yx-next').addEventListener('click', function () {
      var e = eng();
      say(e && e.next() ? 'انتقلنا للتالي.' : 'لا توجد قائمة تشغيل مفتوحة، أو هذا آخر فيديو فيها.');
    });

    seg(root.querySelector('#yx-wh'), 'ytp_wheel', ['off', 'vol', 'speed', 'seek'], 'off');

    var keysCk = root.querySelector('#yx-keys');
    store.get('ytp_keys', true).then(function (v) { keysCk.checked = (v !== false); });
    keysCk.addEventListener('change', function () { store.set('ytp_keys', keysCk.checked); });

    /* --- per-action combo capture --- */
    var list = root.querySelector('#yx-keylist');
    var map = {};
    var rail = railCombos({});
    function paintKeys() {
      list.textContent = '';
      Object.keys(DEFAULT_KEYS).forEach(function (a) {
        var row = h('<div class="syf-note-row"><span class="t"></span><button class="syf-mini" type="button"></button></div>');
        row.querySelector('.t').textContent = ACT_LABEL[a] ? SYFS.t(ACT_LABEL[a]) : a;
        var btn = row.querySelector('button');
        var cur = map[a] || DEFAULT_KEYS[a];
        /* a combo saved before clashes were checked (or a bar shortcut set later) is
           flagged on its row rather than left to fire two commands silently */
        var other = keyClash(a, cur, map, rail);
        /* i18n-dyn: a key combination — Ctrl+Alt+KeyS reads the same in every language */
        btn.textContent = comboText(cur) + (other ? ' ⚠' : '');
        if (other) btn.title = SYFS.t('مستخدم في «{0}»', SYFS.t(other));
        btn.addEventListener('click', function () { capture(a, btn); });
        list.appendChild(row);
      });
    }
    function capture(action, btn) {
      disarmKey();                       /* تسليحٌ جديد ينزع القديم قبل أن يبدأ */
      btn.textContent = SYFS.t('اضغط التركيبة…');
      var onKey = function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        if (ev.key === 'Escape') { disarmKey(); paintKeys(); return; }
        var combo = comboOf(ev);
        if (combo === null) return;      /* a modifier alone — still waiting for its key */
        /* التركيبة المرفوضة تنزع التسليح أيضاً وتُبقي سبب الرفض ظاهراً على الزرّ —
           بقاؤه مسلَّحاً كان يبتلع كل ضغطة تالية في الصفحة بلا أن يطلب أحد ذلك. */
        if (!COMBO_RE.test(combo)) { disarmKey(); btn.textContent = SYFS.t('لا بدّ من Alt/Ctrl/Shift'); return; }
        var other = keyClash(action, combo, map, rail);
        if (other) { disarmKey(); btn.textContent = SYFS.t('مستخدم في «{0}»', SYFS.t(other)); return; }
        map[action] = combo;
        store.set('ytp_keys_map', map);
        disarmKey(); paintKeys();
      };
      /* النبضة تحيا مع التسليح وحده وتموت معه، وتنزعه إن رحلت اللوحة */
      var iv = setInterval(function () { if (!root.isConnected) disarmKey(); }, 1000);
      window.addEventListener('keydown', onKey, true);
      armedKey = function () { clearInterval(iv); window.removeEventListener('keydown', onKey, true); };
    }
    store.get('ytp_keys_map', null).then(function (v) {
      if (v && typeof v === 'object') {
        Object.keys(DEFAULT_KEYS).forEach(function (a) {
          if (typeof v[a] === 'string' && COMBO_RE.test(v[a])) map[a] = v[a];
        });
      }
      paintKeys();
    });
    store.get('hotkeys', {}).then(function (v) { rail = railCombos(v); paintKeys(); });
    root.querySelector('#yx-keyrst').addEventListener('click', function () {
      map = {};
      store.set('ytp_keys_map', null);
      paintKeys();
    });
  }

  /* shared segmented-control binder (used by three enums across two tabs) */
  function seg(el, key, values, dflt, after) {
    var btns = el.querySelectorAll('button');
    function paint(v) {
      for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].getAttribute('data-v') === v);
    }
    store.get(key, dflt).then(function (v) { paint(values.indexOf(v) >= 0 ? v : dflt); });
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var v = this.getAttribute('data-v');
        if (values.indexOf(v) < 0) return;
        paint(v);
        store.set(key, v);
        if (after) after();
      });
    }
  }

  /* ---- registration ---- */
  SYFS.tools = SYFS.tools || [];
  SYFS.tools.push({
    id: 'ytplus',
    name: 'يوتيوب+ (تحسين المشاهدة)',
    cat: 'util',
    beta: true,
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="M10.2 9.3l4.6 2.7-4.6 2.7z"/></svg>',
    mount: function (body) {
      SYFS.tabs(body, [
        { label: 'التشغيل', build: buildPlayback },
        { label: 'الإخفاء', build: buildHide },
        { label: 'المظهر', build: buildLook },
        { label: 'إضافات', build: buildExtras }
      ], 0);
    }
  });
}());
