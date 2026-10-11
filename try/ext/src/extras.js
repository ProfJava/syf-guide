/* SYF — extras: site cleaner (shield), form auto-fill (util),
 * WhatsApp Web + any-site popup windows (links).
 * Privileged work happens in the worker: SYFS_CLEAN (browsingData + cookies,
 * origin derived from sender.tab only) and SYFS_POPUP (windows.create popup,
 * http/https only). The fill profile lives in chrome.storage.local, never
 * includes passwords, and fills only on an explicit user act (the panel's «املأ»
 * or the fill hotkey) — it never submits a form.
 * Loaded BEFORE src/rail.js. */
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
  function send(type, extra) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(Object.assign({ type: type }, extra || {}), function (r) {
          if (chrome.runtime.lastError || !r) { resolve({ ok: false, error: 'no-response' }); return; }
          resolve(r);
        });
      } catch (e) { resolve({ ok: false, error: String(e) }); }
    });
  }

  SYFS.tools = SYFS.tools || [];

  /* ===================== 1) منظّف الموقع (فئة الحماية) ===================== */
  SYFS.tools.push({
    id: 'sitecleaner', name: 'منظّف الموقع (كوكيز + كاش)', cat: 'shield',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 3 7 7"/><path d="M12.5 5.5 18 11l-6 6H6l-2-2z"/><path d="M8 17v4M12 17v4M16 15v4"/></svg>',
    mount: function (body) {
      var host = (location.hostname || '').replace(/^www\./, '');
      var ui = h(
        '<div class="syf-form">' +
          '<label>الموقع الحالي</label>' +
          '<div class="syf-out" style="grid-template-columns:1fr"><div><span>سيُنظَّف</span><b id="cl-host"></b></div></div>' +
          '<label class="syf-ck"><input type="checkbox" id="cl-ck" checked> <span>الكوكيز (يسجّل خروجك من هذا الموقع)</span></label>' +
          '<label class="syf-ck"><input type="checkbox" id="cl-st" checked> <span>التخزين (localStorage · IndexedDB · Service Workers)</span></label>' +
          '<button class="syf-btn" id="cl-go">🧹 تنظيف هذا الموقع</button>' +
          '<div class="syf-empty" id="cl-res" style="display:none"></div>' +
          '<label>كاش المتصفح (HTTP) — لا يدعم موقعاً واحداً</label>' +
          '<button class="syf-mini" id="cl-cache">مسح كاش المتصفح كاملاً…</button>' +
          '<div class="syf-note-hint">أعد تحميل الصفحة بعد التنظيف. مسح الكاش الكامل يشمل كل المواقع (لا يحذف كوكيز ولا كلمات مرور).</div>' +
        '</div>'
      );
      body.appendChild(ui);
      ui.querySelector('#cl-host').textContent = host || SYFS.t('غير مدعوم في هذه الصفحة');
      var res = ui.querySelector('#cl-res');
      function show(t) { res.style.display = ''; res.textContent = t; }

      ui.querySelector('#cl-go').addEventListener('click', function () {
        var what = { cookies: ui.querySelector('#cl-ck').checked, storage: ui.querySelector('#cl-st').checked };
        if (!what.cookies && !what.storage) { show(SYFS.t('اختر ما يُنظَّف أولاً.')); return; }
        show(SYFS.t('جارٍ التنظيف…'));
        send('SYFS_CLEAN', { op: 'site', what: what }).then(function (r) {
          if (!r.ok) { show(SYFS.t('تعذّر التنظيف: {0}', r.error || '')); return; }
          /* ⚠️ Two whole sentences, not one sentence assembled around a branch. The old
             form glued four pieces (`تم ✅` · `— حُذفت` · `كوكيز` · `. أعد تحميل الصفحة.`)
             into the dictionary as keys that could never meet in English word order —
             and t() was never called on the result anyway, so all four were dead. */
          show(what.cookies
            ? SYFS.t('تم ✅ — حُذفت {0} كوكيز. أعد تحميل الصفحة.', r.cookies || 0)
            : SYFS.t('تم ✅. أعد تحميل الصفحة.'));
        });
      });

      /* full-browser cache wipe — two-click confirm */
      var cacheBtn = ui.querySelector('#cl-cache'), armed = false, armTimer = null;
      cacheBtn.addEventListener('click', function () {
        if (!armed) {
          armed = true;
          cacheBtn.textContent = SYFS.t('متأكد؟ اضغط مرة أخرى للمسح الكامل');
          clearTimeout(armTimer);
          armTimer = setTimeout(function () { armed = false; cacheBtn.textContent = SYFS.t('مسح كاش المتصفح كاملاً…'); }, 5000);
          return;
        }
        armed = false; clearTimeout(armTimer);
        cacheBtn.textContent = SYFS.t('مسح كاش المتصفح كاملاً…');
        show(SYFS.t('جارٍ مسح الكاش…'));
        send('SYFS_CLEAN', { op: 'cache-all' }).then(function (r) {
          show(r.ok ? SYFS.t('تم مسح كاش المتصفح ✅') : SYFS.t('تعذّر المسح: {0}', r.error || ''));
        });
      });
    }
  });

  /* ===================== 2) الملء التلقائي للفورمات (فئة أدوات) ===================== */
  /* How a field is recognised (v0.177 review): the most SPECIFIC evidence wins, in this
     order — the page's own `autocomplete` token, the input type, the field's name/id,
     and only then the human text around it (labels, aria, placeholder, nearby text).
     Inside each of the last two the LONGEST matching hint wins, not the first: «الرمز
     البريدي» holds «بريد», «email address» holds «address», and first-match put the
     e-mail into the postal-code box. Short generic hints («الأول», «الرمز») are gone —
     they matched «العنوان الأول» and «أدخل الرمز». */
  /* i18n-skip-start: these are matched against the HOST PAGE's own field text —
     translating one would be translating someone else's page, and the English
     column beside it already covers an English form. Keyed, not positional, so
     they cannot drift out of step with the labels below. */
  var AR_HINTS = {
    fullname: ['الاسم الكامل', 'الاسم بالكامل', 'اسمك', 'الاسم'],
    first:    ['الاسم الأول'],
    last:     ['اسم العائلة', 'العائلة', 'الاسم الأخير', 'اللقب'],
    email:    ['البريد الإلكتروني', 'بريد إلكتروني', 'بريدي الإلكتروني', 'بريد', 'ايميل', 'إيميل'],
    phone:    ['هاتف', 'جوال', 'موبايل', 'واتساب'],
    company:  ['شركة', 'المؤسسة', 'جهة العمل'],
    jobtitle: ['وظيف', 'المسمى', 'منصب'],
    address:  ['عنوان', 'الشارع', 'العنوان الأول', 'سطر العنوان'],
    city:     ['مدينة', 'المدينه'],
    country:  ['دولة', 'البلد'],
    zip:      ['الرمز البريدي', 'رمز بريدي', 'الترميز البريدي'],
    website:  ['موقعك', 'الموقع الإلكتروني']
  };
  /* a field that must NEVER get invented data: one-time codes, captchas, payment
     cards, search boxes. Matched on the normalised text (see norm()). */
  var FF_SKIP = /(^| )(otp|captcha|cvv|cvc)( |$)|one time|verification code|security code|card number|cc number|(^| )search( |$)|رمز التحقق|كود التحقق|رمز الامان|رقم البطاقه|(^| )(ال)?بحث( |$)/;
  var FF_USER = /user ?name|login|nickname|اسم المستخدم/;
  /* a checkbox that records a DECISION — terms, consent, marketing — is the user's to
     tick, never a test generator's */
  var FF_CONSENT = /agree|consent|terms|privacy|policy|subscribe|newsletter|marketing|opt ?in|remember|اوافق|موافق|الشروط|الخصوصيه|اشترك|الاشتراك|النشره|تذكرني/;
  /* i18n-skip-end */
  /* [id, label, English field-name hints]. The label IS interface text and is
     translated; the hints on either side are not. */
  var PROFILE_FIELDS = [
    ['fullname', 'الاسم الكامل',  ['full name', 'fullname', 'your name']],
    ['first',    'الاسم الأول',   ['given name', 'first name', 'firstname', 'fname', 'forename']],
    ['last',     'اسم العائلة',   ['family name', 'last name', 'lastname', 'lname', 'surname']],
    ['email',    'البريد الإلكتروني', ['email', 'e mail', 'email address']],
    ['phone',    'الهاتف',        ['telephone', 'phone', 'mobile', 'whatsapp']],
    ['company',  'الشركة',        ['organization', 'organisation', 'company', 'employer']],
    ['jobtitle', 'المسمى الوظيفي', ['organization title', 'job title', 'jobtitle', 'position', 'role']],
    ['address',  'العنوان',       ['street address', 'address line1', 'address line 1', 'address1', 'address', 'street']],
    /* «مدينتك» not «المدينة»: the msgid IS the string, and «المدينة» is already
       Madinah in the prayer-city list — one msgid cannot be both a form label and
       a proper noun. Renaming the label is the cheap side of that collision. */
    ['city',     'مدينتك',        ['address level2', 'city', 'town']],
    ['country',  'الدولة',        ['country name', 'country']],
    ['zip',      'الرمز البريدي', ['postal code', 'postal', 'postcode', 'post code', 'zip', 'zipcode', 'zip code']],
    ['website',  'الموقع الإلكتروني', ['url', 'website', 'web site', 'homepage', 'site']]
  ];
  /* the page's own autocomplete token is the best evidence there is (WHATWG names) */
  var FF_AC = {
    name: 'fullname', 'given-name': 'first', 'family-name': 'last', email: 'email',
    tel: 'phone', 'tel-national': 'phone', organization: 'company', 'organization-title': 'jobtitle',
    'street-address': 'address', 'address-line1': 'address', 'address-level2': 'city',
    country: 'country', 'country-name': 'country', 'postal-code': 'zip', url: 'website',
    username: 'user', 'one-time-code': 'skip', 'new-password': 'skip', 'current-password': 'skip',
    'cc-number': 'skip', 'cc-csc': 'skip'
  };
  /* lower-case, camelCase split, Arabic letter variants folded (أ/إ/آ→ا, ة→ه, ى→ي),
     diacritics and separators dropped — applied to the hints AND the field text, so
     «الأول» and «الاول», `firstName` and `first_name` meet on equal terms */
  function norm(s) {
    return String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
      .replace(/[ً-ْـ]/g, '')
      .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
      .replace(/[_\-.:[\]()*]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  var FF_HINTS = PROFILE_FIELDS.map(function (f) {
    return [f[0], f[2].concat(AR_HINTS[f[0]] || []).map(norm)];
  });
  function bestHint(txt) {
    var best = null, len = 0;
    if (!txt) return null;
    FF_HINTS.forEach(function (f) {
      f[1].forEach(function (hint) { if (hint.length > len && txt.indexOf(hint) >= 0) { best = f[0]; len = hint.length; } });
    });
    return best;
  }
  function bareName(t) { return /(^| )name( |$)/.test(t) && !/user|nick|file|last|first|host|company|domain|business/.test(t); }
  /* the words a person reads next to the field: its <label>s (for= AND wrapping —
     el.labels has both), aria-labelledby, aria-label, placeholder, title; and when the
     page gave none of those, the short text right before it */
  function humanText(el) {
    var doc = el.ownerDocument || document, t = [];
    try { Array.prototype.forEach.call(el.labels || [], function (l) { t.push(l.textContent); }); } catch (e) {}
    (el.getAttribute('aria-labelledby') || '').split(/\s+/).forEach(function (id) {
      var n = id && doc.getElementById(id); if (n) t.push(n.textContent);
    });
    t.push(el.getAttribute('aria-label') || '', el.getAttribute('placeholder') || '', el.getAttribute('title') || '');
    if (!t.join('').trim()) {
      var prev = el.previousElementSibling, par = el.parentElement;
      if (prev && (prev.textContent || '').length <= 80) t.push(prev.textContent);
      else if (par && par.querySelectorAll('input, textarea, select').length === 1 && (par.textContent || '').length <= 80) t.push(par.textContent);
    }
    return t.join(' ');
  }
  /* → a PROFILE_FIELDS id, 'user', 'skip' (never fill) or null (unrecognised) */
  function classify(el) {
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase().trim().split(/\s+/).pop();
    if (FF_AC[ac]) return FF_AC[ac];
    var type = (el.type || '').toLowerCase();
    if (type === 'email') return 'email';
    if (type === 'tel') return 'phone';
    if (type === 'url') return 'website';
    var attr = norm((el.getAttribute('name') || '') + ' ' + (el.id || '')), txt = norm(humanText(el)), all = attr + ' ' + txt;
    if (FF_SKIP.test(all)) return 'skip';
    if (FF_USER.test(all)) return 'user';
    return bestHint(attr) || bestHint(txt) || ((bareName(attr) || bareName(txt)) ? 'fullname' : null);
  }
  /* honeypots are hidden on purpose: display:none, zero size, parked off-screen,
     aria-hidden. A styled checkbox/radio is often an invisible input behind a visible
     label — that one counts as shown. */
  function shown(el) {
    if (el.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
    var win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.right <= 0 || r.bottom + (win.scrollY || 0) <= 0) return false;
    var cs = win.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
  }
  function choiceShown(el) {
    if (shown(el)) return true;
    try { return Array.prototype.some.call(el.labels || [], shown); } catch (e) { return false; }
  }
  function setVal(el, v) {
    var win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
    try {
      /* the prototype's own setter, from the field's own window: React and friends
         track `value` on the instance and ignore a plain assignment */
      var proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype
        : el.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype;
      var d = Object.getOwnPropertyDescriptor(proto, 'value');
      if (d && d.set) d.set.call(el, v); else el.value = v;
    } catch (e) { el.value = v; }
    fire(el);
  }
  function fire(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  /* ---- random test data (generated locally; never leaves the device) ---- */
  function ri(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
  function pick(a) { return a[ri(0, a.length - 1)]; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /* i18n-skip-start: sample data the tool TYPES INTO a form — output, not
     interface. The spec puts user content out of scope, and "translating" an
     invented company name would be inventing a different one. Two sets, picked by
     the PAGE's language: an English form gets English names. E-mail and web
     addresses use the reserved example.* domains (RFC 2606), so a test that does
     get sent mails nobody. */
  var RND = {
    ar: {
      first: ['أحمد', 'محمد', 'سارة', 'فاطمة', 'عمر', 'خالد', 'نورة', 'ريم', 'يوسف', 'ليان', 'عبدالله', 'هند', 'سلمان', 'مريم'],
      last: ['الغامدي', 'العتيبي', 'القحطاني', 'الحربي', 'الدوسري', 'الشمري', 'المطيري', 'الزهراني'],
      city: ['الرياض', 'جدة', 'الدمام', 'مكة', 'المدينة', 'الطائف', 'أبها', 'تبوك'],
      country: ['السعودية', 'مصر', 'الإمارات', 'الأردن', 'الكويت', 'قطر', 'عُمان', 'المغرب'],
      company: ['شركة النخبة', 'مؤسسة الرواد', 'مجموعة الأفق', 'شركة المدى', 'دار الابتكار'],
      job: ['مطوّر برمجيات', 'مدير مشاريع', 'مصمّم جرافيك', 'محاسب', 'مهندس شبكات', 'مسوّق رقمي'],
      street: ['شارع الملك فهد', 'شارع العليا', 'طريق الملك عبدالله', 'شارع التحلية'],
      lorem: 'نص تجريبي عشوائي لملء الحقل أثناء اختبار النموذج، يمكن تعديله لاحقاً.'
    },
    en: {
      first: ['James', 'Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Lucas', 'Mia', 'Adam', 'Sara', 'Omar', 'Lina'],
      last: ['Smith', 'Johnson', 'Brown', 'Taylor', 'Miller', 'Wilson', 'Davis', 'Clark'],
      city: ['London', 'Toronto', 'Austin', 'Dublin', 'Sydney', 'Denver', 'Boston', 'Leeds'],
      country: ['United States', 'Canada', 'United Kingdom', 'Ireland', 'Australia', 'New Zealand'],
      company: ['Acme Corp', 'Northwind Traders', 'Globex Ltd', 'Blue Harbor Labs', 'Summit Works'],
      job: ['Software Engineer', 'Project Manager', 'Graphic Designer', 'Accountant', 'Network Engineer', 'Marketing Specialist'],
      street: ['Main Street', 'Oak Avenue', 'Maple Road', 'Park Lane'],
      lorem: 'Sample text to fill this field while testing the form; edit it as needed.'
    }
  };
  var RND_SLUG = ['ahmed', 'mohammed', 'sara', 'fatima', 'omar', 'khaled', 'noura', 'reem', 'yousef', 'layan', 'abdullah', 'hind', 'salman', 'maryam'];
  var RND_DOM = ['example.com', 'example.org', 'example.net'];
  /* i18n-skip-end */
  function pageLang(doc) {
    doc = doc || document;
    var de = doc.documentElement, lang = ((de && de.getAttribute('lang')) || '').toLowerCase();
    if (lang) return lang.indexOf('ar') === 0 ? 'ar' : 'en';
    return ((de && de.getAttribute('dir')) === 'rtl' || /[؀-ۿ]/.test(doc.title || '')) ? 'ar' : 'en';
  }
  function randomProfile(lang) {
    var L = RND[lang] || RND.ar, i = ri(0, L.first.length - 1), n = ri(1, 9999);
    var first = L.first[i], last = pick(L.last);
    var slug = lang === 'en' ? first.toLowerCase() + '.' + last.toLowerCase() : (RND_SLUG[i] || 'user');
    return {
      first: first, last: last, fullname: first + ' ' + last,
      email: slug + n + '@' + pick(RND_DOM),
      /* the format each audience expects: a Saudi mobile, or a fictional US 555-01xx */
      phone: lang === 'en' ? '+1 202 555 01' + pad2(ri(0, 99)) : '05' + ri(10000000, 99999999),
      company: pick(L.company), jobtitle: pick(L.job),
      address: lang === 'en' ? ri(1, 200) + ' ' + pick(L.street) : pick(L.street) + ' ' + ri(1, 200),
      city: pick(L.city), country: pick(L.country),
      zip: '' + ri(10000, 99999),
      website: 'https://' + slug.replace(/\./g, '') + n + '.' + pick(RND_DOM),
      user: slug.replace(/\./g, '_') + n,
      lorem: L.lorem
    };
  }
  function randDate() { return ri(1975, 2005) + '-' + pad2(ri(1, 12)) + '-' + pad2(ri(1, 28)); }
  /* fill a non-text field (checkbox/radio/select/number/date/color…) with a random value.
   * returns true if it set something. radioSeen dedupes radio groups by name. */
  function fillSpecial(el, type, radioSeen, checks) {
    if (type === 'checkbox') {
      if (!checks || el.checked || FF_CONSENT.test(norm(humanText(el) + ' ' + (el.getAttribute('name') || '') + ' ' + (el.id || '')))) return false;
      el.checked = true;
    } else if (type === 'radio') {
      var nm = el.name || ('#' + (el.id || ''));
      if (radioSeen[nm]) return false;
      radioSeen[nm] = true;
      var grp = el.name ? el.ownerDocument.getElementsByName(el.name) : [el];
      for (var gi = 0; gi < grp.length; gi++) if (grp[gi].checked) return false;   /* keep real choice */
      el.checked = true;
    } else if (type === 'select') {
      if (el.selectedIndex > 0 && el.value) return false;                          /* keep real choice */
      var opts = Array.prototype.filter.call(el.options, function (o) { return !o.disabled && o.value !== ''; });
      if (!opts.length) return false;
      setVal(el, pick(opts).value); return true;
    } else if (type === 'number' || type === 'range') {
      if (type === 'number' && (el.value || '').trim()) return false;
      var mn = el.min !== '' ? Number(el.min) : 1, mx = el.max !== '' ? Number(el.max) : 100;
      if (isNaN(mn)) mn = 1;
      if (isNaN(mx) || mx <= mn) mx = mn + 99;
      setVal(el, String(ri(mn, mx))); return true;
    } else if (type === 'date') { setVal(el, randDate()); return true; }
    else if (type === 'month') { setVal(el, ri(1975, 2005) + '-' + pad2(ri(1, 12))); return true; }
    else if (type === 'week')  { setVal(el, ri(1975, 2005) + '-W' + pad2(ri(1, 52))); return true; }
    else if (type === 'time')  { setVal(el, pad2(ri(0, 23)) + ':' + pad2(ri(0, 59))); return true; }
    else if (type === 'datetime-local') { setVal(el, randDate() + 'T' + pad2(ri(0, 23)) + ':' + pad2(ri(0, 59))); return true; }
    else if (type === 'color') { setVal(el, '#' + ('00000' + ri(0, 0xffffff).toString(16)).slice(-6)); return true; }
    else return false;
    fire(el);
    return true;
  }
  var SPECIAL_TYPES = { checkbox: 1, radio: 1, select: 1, number: 1, range: 1, date: 1, month: 1, week: 1, time: 1, 'datetime-local': 1, color: 1 };
  /* the page plus every SAME-ORIGIN frame in it (two levels deep). A frame from
     another site cannot be read from here — it is counted so the message can say so
     instead of «no fields found». */
  function fillDocs() {
    var docs = [document], blocked = 0;
    for (var i = 0; i < docs.length && docs.length < 20; i++) {
      Array.prototype.forEach.call(docs[i].querySelectorAll('iframe, frame'), function (f) {
        var d = null;
        try { d = f.contentDocument; } catch (e) {}
        if (d && d.documentElement) { if (docs.indexOf(d) < 0) docs.push(d); } else if (/^https?:/i.test(f.getAttribute('src') || '')) blocked++;
      });
    }
    return { docs: docs, blocked: blocked };
  }
  /* What the fills since the last «تراجع» wrote, so it can take exactly that back. The
     panel and the hotkey share it. */
  var lastFill = null;
  /* profile mode: fill recognised empty fields from the profile.
   * rnd mode: also fills selects, numbers, dates, radios… and unrecognised fields;
   * checkboxes only when `checks` is on, and never a consent/subscribe box.
   * Passwords, files and hidden fields are never touched. Never submits anything. */
  function fillPage(profile, rnd, checks) {
    var SKIP_TYPES = { password: 1, hidden: 1, file: 1, submit: 1, button: 1, image: 1, reset: 1, search: 1 };
    var scan = fillDocs(), used = {}, radioSeen = {}, log = [];
    scan.docs.forEach(function (doc) {
      doc.querySelectorAll(rnd ? 'input, textarea, select' : 'input, textarea').forEach(function (el) {
        var type = el.tagName === 'SELECT' ? 'select' : (el.type || 'text').toLowerCase();
        if (SKIP_TYPES[type] || el.readOnly || el.disabled) return;
        if (el.closest('#syfs-host')) return;
        var before = { el: el, value: el.value, checked: el.checked };
        if (SPECIAL_TYPES[type]) {
          /* rnd only — a profile has no number, date or choice to give (it used to
             slip random numbers and months into profile fills) */
          if (!rnd) return;
          if (!((type === 'checkbox' || type === 'radio') ? choiceShown(el) : shown(el))) return;
          if (fillSpecial(el, type, radioSeen, checks)) { before.nv = el.value; before.nc = el.checked; log.push(before); }
          return;
        }
        if (!shown(el)) return;                                        /* invisible / honeypot */
        if ((el.value || '').trim()) return;                           /* keep user data */
        var match = classify(el), v = '';
        if (match === 'skip') return;
        if (match && (rnd || !used[match])) v = profile[match] || '';  /* profile mode fills each field once */
        if (!v && rnd) v = el.tagName === 'TEXTAREA' ? profile.lorem : profile.first + ' ' + ri(1, 999);   /* unrecognised → generic */
        if (!v) return;
        setVal(el, v);
        if (match) used[match] = true;
        before.nv = el.value; before.nc = el.checked; log.push(before);
      });
    });
    if (log.length) lastFill = (lastFill || []).concat(log);
    return { count: log.length, blocked: scan.blocked };
  }
  /* «تراجع»: empties what the tool filled — and ONLY a field that still holds the
     tool's value; anything the user typed over it since is theirs. */
  function undoFill() {
    var log = lastFill || [], n = 0;
    lastFill = null;
    log.forEach(function (r) {
      var el = r.el;
      if (!el.isConnected || el.value !== r.nv || el.checked !== r.nc) return;
      if (el.checked !== r.checked) { el.checked = r.checked; fire(el); }
      if (el.value !== r.value) setVal(el, r.value);
      n++;
    });
    return n;
  }
  function cleanProfile(p) {
    var out = {};
    if (!p || typeof p !== 'object') return out;
    PROFILE_FIELDS.forEach(function (f) { var v = typeof p[f[0]] === 'string' ? p[f[0]].trim().slice(0, 120) : ''; if (v) out[f[0]] = v; });
    return out;
  }
  function fillMsg(res, rnd) {
    if (res.count) return SYFS.t(rnd ? 'مُلئ {0} حقلاً ببيانات تجريبية ✅' : 'مُلئ {0} حقلاً من بروفايلك ✅', res.count);
    if (res.blocked) return SYFS.t('لم يُعثر على حقول فارغة هنا — النماذج داخل إطار من موقع آخر لا يمكن ملؤها.');
    return SYFS.t(rnd ? 'لا توجد حقول فارغة لملئها في هذه الصفحة.' : 'لم يُعثر على حقول مطابقة فارغة في هذه الصفحة.');
  }
  /* The keyboard path (Ctrl+Alt+F by default — the eager stub `formfillnow` in
     src/registry.js loads this file, then calls this). No panel: the saved profile
     when there is one, otherwise invented test data; a toast with the count and
     «تراجع». It reads the profile and never writes it. */
  function quickFill() {
    return Promise.all([store.get('fill_profile', {}), store.get('fill_checks', false)]).then(function (r) {
      var p = cleanProfile(r[0]), rnd = !Object.keys(p).length;
      var res = fillPage(rnd ? randomProfile(pageLang()) : p, rnd, r[1] === true);
      if (SYFS.toast) {
        SYFS.toast(SYFS.t('الملء التلقائي للفورمات'), fillMsg(res, rnd), res.count
          ? { timeout: 8000, actions: [{ label: 'تراجع', onClick: undoFill }] }
          : { timeout: 4000 });
      }
      return res;
    });
  }
  SYFS.formfillQuick = quickFill;
  /* for tools/formfill-test.js — the same functions the panel and the hotkey run */
  SYFS._formfill = { classify: classify, fillPage: fillPage, undoFill: undoFill, randomProfile: randomProfile, pageLang: pageLang, quickFill: quickFill };

  SYFS.tools.push({
    id: 'formfill', name: 'الملء التلقائي للفورمات', cat: 'util',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h5"/><path d="M13 20l1-3.5 4.5-4.5 2.5 2.5-4.5 4.5z"/></svg>',
    mount: function (body) {
      var ui = h('<div class="syf-form"><div class="syf-note-hint">يُحفظ البروفايل محلياً على جهازك فقط بزر «حفظ». لا تُملأ حقول كلمات المرور أبداً، وتُملأ الحقول <b>الفارغة</b> الظاهرة فقط. بلا بروفايل تُستعمل بيانات تجريبية. الاختصار الافتراضي للملء المباشر في أي صفحة: Ctrl+Alt+F.</div></div>');
      var inputs = {};
      for (var i = 0; i < PROFILE_FIELDS.length; i += 2) {
        var row = h('<div class="syf-row"></div>');
        [PROFILE_FIELDS[i], PROFILE_FIELDS[i + 1]].forEach(function (f) {
          if (!f) return;
          var inp = h('<input class="syf-in" placeholder="">');
          inp.placeholder = SYFS.t(f[1]);
          inp.setAttribute('aria-label', SYFS.t(f[1]));
          if (f[0] === 'email') inp.type = 'email';
          inputs[f[0]] = inp;
          row.appendChild(inp);
        });
        ui.appendChild(row);
      }
      var rndRow = h('<label class="syf-ck" style="cursor:pointer;user-select:none"><input type="checkbox" id="ff-rnd"> <span>🎲 بيانات عشوائية (يتجاهل البروفايل ويملأ كل الحقول الفارغة الظاهرة: نصوص، أرقام، تواريخ، قوائم)</span></label>');
      ui.appendChild(rndRow);
      var ckRow = h('<label class="syf-ck" style="cursor:pointer;user-select:none"><input type="checkbox" id="ff-checks"> <span>حدّد خانات الاختيار أيضاً في الوضع العشوائي (لا تُحدَّد أبداً خانات الموافقة والاشتراك)</span></label>');
      ui.appendChild(ckRow);
      var actions = h('<div class="syf-row"><button class="syf-btn" id="ff-fill" style="flex:1">⚡ املأ الفورم في هذه الصفحة</button><button class="syf-mini" id="ff-undo">تراجع</button><button class="syf-mini" id="ff-save">حفظ</button></div>');
      ui.appendChild(actions);
      var out = h('<div class="syf-empty" role="status" aria-live="polite" style="display:none"></div>');
      ui.appendChild(out);
      body.appendChild(ui);
      function show(t) { out.style.display = ''; out.textContent = t; }
      var rndBox = ui.querySelector('#ff-rnd'), ckBox = ui.querySelector('#ff-checks');
      var fillBtn = ui.querySelector('#ff-fill'), saveBtn = ui.querySelector('#ff-save'), undoBtn = ui.querySelector('#ff-undo');
      undoBtn.disabled = !lastFill;
      rndBox.addEventListener('change', function () {
        var on = rndBox.checked;
        Object.keys(inputs).forEach(function (k) { inputs[k].disabled = on; });
        saveBtn.disabled = on;
        fillBtn.textContent = on ? SYFS.t('🎲 املأ ببيانات عشوائية') : SYFS.t('⚡ املأ الفورم في هذه الصفحة');
      });
      ckBox.addEventListener('change', function () { store.set('fill_checks', ckBox.checked); });

      /* «املأ» waits for the saved profile: a click before it arrived used to fill from
         (and save) an empty form */
      fillBtn.disabled = true;
      Promise.all([store.get('fill_profile', {}), store.get('fill_checks', false)]).then(function (r) {
        var p = cleanProfile(r[0]);
        Object.keys(inputs).forEach(function (k) { inputs[k].value = p[k] || ''; });
        ckBox.checked = r[1] === true;
        fillBtn.disabled = false;
      });
      function collect() {
        var p = {};
        Object.keys(inputs).forEach(function (k) { var v = inputs[k].value.trim().slice(0, 120); if (v) p[k] = v; });
        return p;
      }
      saveBtn.addEventListener('click', function () { store.set('fill_profile', collect()); show(SYFS.t('حُفظ البروفايل ✅')); });
      /* «املأ» uses what is in the boxes NOW and saves nothing — saving is «حفظ»'s job */
      fillBtn.addEventListener('click', function () {
        var p = collect(), rnd = rndBox.checked || !Object.keys(p).length;
        var res = fillPage(rnd ? randomProfile(pageLang()) : p, rnd, ckBox.checked);
        undoBtn.disabled = !lastFill;
        show(fillMsg(res, rnd));
      });
      undoBtn.addEventListener('click', function () {
        var n = undoFill();
        undoBtn.disabled = true;
        show(n ? SYFS.t('أُفرغ {0} حقلاً ملأته الأداة.', n) : SYFS.t('لا شيء للتراجع عنه.'));
      });
    }
  });

  /* ===================== 3+4) نوافذ منبثقة: واتساب + عارض المواقع (فئة روابط) ===================== */
  function popup(url, w, hgt) { return send('SYFS_POPUP', { url: url, w: w, h: hgt }); }

  /* ===== Page-change watcher (v0.115.0) =====
   * ⚠️ THIS TAB ONLY, and that is a decision, not a first version.
   * The obvious build — «tell me when this page changes while I am not looking» —
   * needs the service worker to fetch an arbitrary URL on a timer, and the worker's
   * fetch relay is deliberately restricted to nine named hosts (§8). That list is the
   * thing that stops a compromised content script using the extension as a proxy, so
   * widening it for a convenience feature would trade a real security property for one.
   * Watching the page you already have open needs no host, no permission and no relay:
   * the content script can already see this document. It stops when the tab closes, and
   * the panel says so rather than letting anyone assume otherwise.
   *
   * ⛔ The page's text NEVER leaves the tab and is never stored. While a watch runs, the
   * last reading is held in memory only (to show WHAT changed) and dropped when it stops;
   * the browser notification carries the page title, never its content. */
  function watchHash(s) {
    /* FNV-1a — a fingerprint for "did this differ", not a checksum for anything
       adversarial. Fast enough to run over a whole document every few seconds. */
    var hv = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { hv ^= s.charCodeAt(i); hv = (hv + ((hv << 1) + (hv << 4) + (hv << 7) + (hv << 8) + (hv << 24))) >>> 0; }
    return hv >>> 0;
  }
  /* «ignore small changes»: clocks, counters, prices ticking, «5 minutes ago» — every
     run of digits (Latin and Arabic-Indic) reads the same, and relative-time phrases
     drop out */
  function calmText(s) {
    return s.replace(/(منذ|قبل)\s+[^\s:،,.]+(\s+(دقيقة|دقائق|ساعة|ساعات|ثانية|ثوان|يوم|أيام))?/g, ' ')
      .replace(/\b(just now|\S+\s+(seconds?|minutes?|hours?|days?)\s+ago)\b/gi, ' ')
      .replace(/[0-9٠-٩۰-۹]+/g, '#').replace(/\s+/g, ' ').trim();
  }
  /* …and ad slots are not read at all: skipped by tag (AdSense's <ins>, frames) and by
     an id/class that names an ad */
  var WT_AD = /(^|[\s_-])(ads?|advert\w*|sponsor\w*|banner|promo\w*|dfp)([\s_-]|$)/i;
  var WT_SKIP_TAG = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, IFRAME: 1, TEMPLATE: 1, INS: 1 };
  function quietText(root) {
    var out = [], w = document.createTreeWalker(root, 5 /* SHOW_ELEMENT | SHOW_TEXT */, {
      acceptNode: function (n) {
        if (n.nodeType === 3) return 1;
        if (WT_SKIP_TAG[n.tagName] || n.id === 'syfs-host' || WT_AD.test((n.id || '') + ' ' + (n.getAttribute('class') || ''))) return 2;   /* REJECT: skip the subtree */
        return 3;                                                                                                                          /* SKIP the element, read inside */
      }
    });
    for (var n = w.nextNode(); n; n = w.nextNode()) if (n.nodeType === 3) out.push(n.nodeValue);
    return calmText(out.join(' '));
  }
  /* WHAT changed, as the user would describe it: the words between the common start
     and the common end of the two readings, each side cut to a line */
  function changedBits(a, b) {
    var x = a.split(' '), y = b.split(' '), i = 0, j = 0;
    while (i < x.length && i < y.length && x[i] === y[i]) i++;
    while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
    function cut(arr) { var s = arr.join(' '); return s.length > 140 ? s.slice(0, 139) + '…' : s; }
    return { removed: cut(x.slice(i, x.length - j)), added: cut(y.slice(i, y.length - j)) };
  }
  /* A selector that names exactly ONE element: climbs to the nearest unique id (or to
     <body>) and pins every step with :nth-of-type — the third card's price is never
     «the first .price on the page». Checked against the document before it is used. */
  function stablePath(el) {
    var parts = [], node = el, doc = el.ownerDocument || document;
    while (node && node.nodeType === 1) {
      if (node.id && doc.querySelectorAll('#' + CSS.escape(node.id)).length === 1) { parts.unshift('#' + CSS.escape(node.id)); break; }
      var tag = node.tagName.toLowerCase();
      if (tag === 'body' || tag === 'html') { parts.unshift(tag); break; }
      var parent = node.parentElement, part = tag;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    var sel = parts.join(' > ');
    try { var m = doc.querySelectorAll(sel); return (m.length === 1 && m[0] === el) ? sel : ''; } catch (e) { return ''; }
  }
  SYFS._watch = { calmText: calmText, changedBits: changedBits, stablePath: stablePath };   /* tools/formfill-test.js */
  SYFS.tools.push({
    id: 'watch', name: 'مراقب تغيّر الصفحة', cat: 'util', beta: true,
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    mount: function (body) {
      var ui = h(
        '<div class="syf-form">' +
          '<label>ما الذي يُراقَب</label>' +
          '<div class="syf-seg" id="wt-scope"><button class="on" data-s="page">الصفحة كاملة</button><button data-s="pick">عنصر أختاره</button></div>' +
          '<div class="syf-note-hint" id="wt-sel" dir="auto">—</div>' +
          '<label for="wt-int">كل</label>' +
          '<select class="syf-in" id="wt-int"><option value="15">15 ثانية</option><option value="30" selected>30 ثانية</option><option value="60">دقيقة</option><option value="300">5 دقائق</option><option value="900">15 دقيقة</option></select>' +
          '<label class="syf-ck"><input type="checkbox" id="wt-small"> <span>تجاهل التغيّرات الصغيرة (الأرقام والأوقات والإعلانات)</span></label>' +
          '<label class="syf-ck"><input type="checkbox" id="wt-notify" checked> <span>أرسل إشعاراً من المتصفّح عند التغيّر</span></label>' +
          '<button class="syf-btn" id="wt-go">▶ ابدأ المراقبة</button>' +
          '<div class="syf-out" id="wt-out" role="status" aria-live="polite" style="grid-template-columns:1fr;display:none"></div>' +
          '<div class="syf-note-hint">⚠️ يعمل ما دام هذا التبويب مفتوحاً — يتوقّف بإغلاقه أو بالانتقال لصفحة أخرى. نصّ الصفحة لا يغادر التبويب ولا يُحفَظ.</div>' +
          '<div class="syf-note-hint">⏱ حين يكون التبويب في الخلفية قد يؤخّر المتصفح الفحص إلى مرة كل دقيقة، فالفواصل الأقصر تصدق والتبويب ظاهر فقط.</div>' +
        '</div>'
      );
      body.appendChild(ui);
      var scope = 'page', sel = '', selNode = null, iv = null, last = null, lastText = '', checks = 0, changes = 0, cancelPick = null;
      var selEl = ui.querySelector('#wt-sel'), out = ui.querySelector('#wt-out'), goB = ui.querySelector('#wt-go');
      var intSel = ui.querySelector('#wt-int'), smallBox = ui.querySelector('#wt-small');
      function line(label, val) { var r = document.createElement('div'); var s = document.createElement('span'); s.textContent = SYFS.t(label); var b = document.createElement('b'); b.textContent = val; b.dir = 'auto'; r.appendChild(s); r.appendChild(b); return r; }
      /* the element itself while it lives; the selector only when the page re-rendered
         it — and then only if the selector still names exactly one element */
      function target() {
        if (scope !== 'pick') return document.body;
        if (selNode && selNode.isConnected) return selNode;
        if (!sel) return null;
        var m = null;
        try { m = document.querySelectorAll(sel); } catch (e) {}
        selNode = (m && m.length === 1) ? m[0] : null;
        return selNode;
      }
      function reading() {
        var el = target();
        if (!el) return null;
        /* whitespace is collapsed before hashing: a re-render that only changes
           indentation is not a change the user asked to hear about */
        return smallBox.checked ? quietText(el) : (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      }
      function paint(msg, diff) {
        out.style.display = '';
        out.textContent = '';
        out.appendChild(line('الفحوصات', String(checks)));
        out.appendChild(line('التغيّرات', String(changes)));
        if (msg) out.appendChild(line('الحالة', msg));
        if (diff) {
          out.appendChild(line('قبل', diff.removed || '—'));
          out.appendChild(line('بعد', diff.added || '—'));
        }
      }
      function stop() {
        if (iv) { clearInterval(iv); iv = null; }
        last = null; lastText = '';
        ui.removeAttribute('data-syfs-live');
        goB.textContent = SYFS.t('▶ ابدأ المراقبة');
      }
      function endPick() { if (cancelPick) { cancelPick(); cancelPick = null; } }
      /* a fresh baseline — after a start, and after anything that changes what one
         reading means (the scope, «ignore small changes») */
      function baseline() {
        var t = reading();
        if (t === null) return false;
        lastText = t; last = watchHash(t);
        return true;
      }
      function tick() {
        if (!body.isConnected) { stop(); return; }          /* panel closed → stop (§6) */
        var t = reading();
        if (t === null) { stop(); paint(SYFS.t('العنصر لم يعد موجوداً — توقّفت المراقبة.')); return; }
        checks++;
        var cur = watchHash(t);
        if (last !== null && cur !== last) {
          changes++;
          paint(SYFS.t('تغيّرت الصفحة ✓'), changedBits(lastText, t));
          if (ui.querySelector('#wt-notify').checked) {
            /* the worker owns notifications; the message carries the page TITLE the user
               is already looking at — never its content */
            try { chrome.runtime.sendMessage({ type: 'SYFS_NOTIFY', title: SYFS.t('تغيّرت الصفحة'), message: (document.title || location.hostname).slice(0, 120) }, function () { void chrome.runtime.lastError; }); } catch (e) {}
          }
        } else if (changes === 0) { paint(''); }
        else { out.firstChild.querySelector('b').textContent = String(checks); }   /* keep the last «what changed» on screen */
        last = cur; lastText = t;
      }
      function start() {
        checks = 0; changes = 0;
        if (!baseline()) { paint(SYFS.t('العنصر لم يعد موجوداً — توقّفت المراقبة.')); return; }
        paint(SYFS.t('تُراقَب…'));
        goB.textContent = SYFS.t('■ إيقاف');
        ui.setAttribute('data-syfs-live', 'watch');   /* hiding the rail keeps it running + flags it */
        iv = setInterval(tick, parseInt(intSel.value, 10) * 1000);
      }
      ui.querySelector('#wt-scope').addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b || b.dataset.s === scope) return;
        this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        /* a running watch compared the new scope's reading with the old one's and
           «found» a change: changing what is watched ends the watch */
        var was = !!iv;
        endPick(); stop();
        scope = b.dataset.s; sel = ''; selNode = null;
        selEl.textContent = scope === 'pick' ? SYFS.t('اضغط «ابدأ» ثم انقر العنصر المطلوب.') : '—';
        if (was) paint(SYFS.t('أُوقفت — تغيّر نطاق المراقبة.'));
      });
      smallBox.addEventListener('change', function () { if (iv) baseline(); });
      intSel.addEventListener('change', function () {
        if (!iv) return;
        clearInterval(iv);
        iv = setInterval(tick, parseInt(intSel.value, 10) * 1000);
      });
      goB.addEventListener('click', function () {
        if (iv) { stop(); paint(SYFS.t('أُوقفت.')); return; }
        if (cancelPick) { endPick(); selEl.textContent = SYFS.t('أُلغي.'); return; }
        if (scope === 'pick' && !target()) {
          selEl.textContent = SYFS.t('انقر العنصر الآن… (Esc للإلغاء)');
          cancelPick = pickElement(function (el) {
            cancelPick = null;
            if (!el) { selEl.textContent = SYFS.t('أُلغي.'); return; }
            selNode = el; sel = stablePath(el);
            selEl.textContent = sel || el.tagName.toLowerCase();
            start();
          }, function () { return body.isConnected; });
          return;
        }
        start();
      });
    }
  });
  /* a one-shot element picker — hover to outline, click to choose, Esc to cancel.
     ⛔ it must ignore our own UI, or the first thing you can pick is the panel.
     ⛔ and it must die with the panel: `alive()` false → it tears itself down and lets
     the click through, instead of eating the next click on the page. Returns cancel(). */
  function pickElement(cb, alive) {
    var box = document.createElement('div'), gone = false;
    box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483000;border:2px solid #457364;background:rgba(69,115,100,.14);border-radius:3px;transition:all .05s';
    document.documentElement.appendChild(box);
    function ours(el) { var hostEl = document.getElementById('syfs-host'); return !!(hostEl && (el === hostEl || hostEl.contains(el))); }
    function teardown() {
      if (gone) return; gone = true;
      clearInterval(guard);
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
      box.remove();
    }
    function move(e) {
      if (!alive()) { teardown(); return; }
      var el = e.target;
      if (!el || ours(el)) { box.style.display = 'none'; return; }
      var r = el.getBoundingClientRect();
      box.style.display = ''; box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
      box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    }
    function click(e) {
      if (!alive()) { teardown(); return; }              /* the panel is gone: this click is the page's */
      if (ours(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      teardown(); cb(e.target);
    }
    function key(e) {
      if (!alive()) { teardown(); return; }
      if (e.key === 'Escape') { e.preventDefault(); teardown(); cb(null); }
    }
    var guard = setInterval(function () { if (!alive()) teardown(); }, 1000);   /* closed with no further input */
    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
    /* Ctrl+Alt+Q cancels a pick in progress; a no-op once this pick has ended */
    if (SYFS.onCloseAll) SYFS.onCloseAll(function () { if (gone) return false; teardown(); cb(null); return true; });
    return teardown;
  }

  SYFS.tools.push({
    id: 'waweb', name: 'واتساب ويب', cat: 'links',
    icon: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 004.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0012.04 2zm4.52 13.97c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.16 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.16 1.75 2.66 4.23 3.73.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z"/></svg>',
    /* ⛔ NOT an in-page frame any more (v0.135.0): web.whatsapp.com sends
       `x-frame-options: DENY`, and even with that stripped the framed copy is a third-party
       context whose IndexedDB and service worker — the whole of a WhatsApp session — are
       partitioned away from the tab's. It showed a blank or an endless loader. A docked
       window is a top-level origin, so the session is the real one. */
    action: function () {
      if (window.SYFS && SYFS.openPanel && SYFS.openPanel('https://web.whatsapp.com')) return;
      if (window.SYFS && SYFS.openSide && SYFS.openSide('https://web.whatsapp.com')) return;
      popup('https://web.whatsapp.com', 460, 800);
    }
  });

  SYFS.tools.push({
    id: 'siteviewer', name: 'عارض المواقع (داخل الصفحة)', cat: 'links',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M6 6.5h.01M8.5 6.5h.01"/><path d="M12.5 16.5L17 12"/><path d="M13.5 12H17v3.5"/></svg>',
    mount: function (body) {
      var SIZES = { s: [400, 640], m: [520, 780], l: [980, 720] };
      var ui = h(
        '<div class="syf-form">' +
          '<label>افتح أي موقع داخل نافذة في هذه الصفحة</label>' +
          '<input class="syf-in" id="sv-url" placeholder="https://example.com" dir="ltr">' +
          '<div class="syf-seg" id="sv-size"><button data-s="s">صغير</button><button data-s="m" class="on">وسط</button><button data-s="l">كبير</button></div>' +
          '<button class="syf-btn" id="sv-go">فتح داخل الصفحة</button>' +
          '<label>آخر المواقع</label>' +
          '<div class="syf-note-list" id="sv-recent"></div>' +
        '</div>'
      );
      body.appendChild(ui);
      var urlIn = ui.querySelector('#sv-url'), list = ui.querySelector('#sv-recent');
      var size = 'm', recent = [];

      function normUrl(x) {
        x = (x || '').trim();
        if (!x) return '';
        if (!/^https?:\/\//i.test(x)) { if (/^[\w.-]+\.[a-z]{2,}([\/?#]|$)/i.test(x)) x = 'https://' + x; else return ''; }
        try { var u = new URL(x); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : ''; } catch (e) { return ''; }
      }
      function renderRecent() {
        list.innerHTML = '';
        if (!recent.length) { list.appendChild(h('<div class="syf-empty">لا مواقع بعد.</div>')); return; }
        recent.forEach(function (u, i) {
          var r = h('<div class="syf-note-row"><span class="t" style="direction:ltr;text-align:left"></span><button class="x">✕</button></div>');
          r.querySelector('.t').textContent = u.replace(/^https?:\/\//, '').slice(0, 60);
          r.querySelector('.t').addEventListener('click', function () { open(u); });
          r.querySelector('.x').addEventListener('click', function () { recent.splice(i, 1); store.set('viewer_recent', recent); renderRecent(); });
          list.appendChild(r);
        });
      }
      function open(u) {
        var dims = SIZES[size] || SIZES.m;
        if (window.SYFS && SYFS.openFrame) SYFS.openFrame('عارض: ' + u.replace(/^https?:\/\//, '').slice(0, 40), u, { w: dims[0], h: dims[1] });
        else popup(u, dims[0], dims[1]);
        recent = [u].concat(recent.filter(function (x) { return x !== u; })).slice(0, 8);
        store.set('viewer_recent', recent);
        renderRecent();
      }

      ui.querySelector('#sv-size').addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        size = b.dataset.s; store.set('viewer_size', size);
        this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
      ui.querySelector('#sv-go').addEventListener('click', function () {
        var u = normUrl(urlIn.value);
        if (!u) { urlIn.focus(); return; }
        open(u);
      });
      urlIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') ui.querySelector('#sv-go').click(); });

      Promise.all([store.get('viewer_recent', []), store.get('viewer_size', 'm')]).then(function (r) {
        recent = Array.isArray(r[0]) ? r[0] : [];
        size = r[1] || 'm';
        ui.querySelectorAll('#sv-size button').forEach(function (b) { b.classList.toggle('on', b.dataset.s === size); });
        renderRecent();
      });
    }
  });
}());
