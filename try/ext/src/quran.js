/* SYF — مشغّل القرآن.
 * ٢٤١ قارئاً برواياتهم من mp3quran.net، واختيار السورة، وتلاوة **لا تتوقّف** بتغيير
 * الصفحة أو التبويب.
 *
 * This file is only the CONTROL SURFACE. It owns no audio: every command goes to
 * the worker (SYFS_QURAN), which drives an <audio> living in offscreen.html. That
 * split is not tidiness — an <audio> injected by a content script obeys the HOST
 * PAGE's media-src CSP, so on a strict site the recitation would simply never
 * start; and a window that owned the audio would silence it the moment it closed.
 *
 * The catalogue is fetched through the worker relay and cached for 7 days, so the
 * reciter list opens instantly and still works with no network after the first
 * time. Everything the API returns is treated as untrusted: names are rendered
 * with textContent, and the server base is re-validated in the worker before a
 * single byte is requested. Loaded BEFORE src/rail.js.
 *
 * v0.84.0 — rebuilt as a PLAYER instead of a form (specs/quran-player-v2.md):
 * a now-playing card with a real seek bar over three tabs (قرّاء · سور · مفضّلة).
 * Every transport control is an SVG: the typographic ⏮ ⏭ ⏹ this used to use are
 * the same tofu trap as the ⛶ we pulled out of the window head — those codepoints
 * have no glyph in the Arabic font stacks Windows ships. */
(function () {
  window.SYFS = window.SYFS || {};
  var store = SYFS.store, bgFetch = SYFS.bgFetch;

  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    /* the template's own text IS the msgid — translate the built tree rather than
       splitting the markup (see src/i18n.js). Free in the default language. */
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }
  /* How far along a seek bar a pointer is, measured from the bar's own READING START
   * — its right edge in Arabic, its left edge in English. Both bars in this file used
   * `r.right - clientX` unconditionally, which in an English interface made dragging
   * rightwards seek BACKWARDS: not a cosmetic slip, a transport running in reverse.
   *
   * The direction is read off the element, not off the stored language, and that is
   * deliberate: the CSS resolves the same value for the fill, so one source of truth
   * means the paint and the drag cannot end up disagreeing about which edge is zero.
   * The cost is a style read per pointermove, next to a getBoundingClientRect that
   * already flushed layout on the same line. */
  function seekOffset(bar, r, clientX) {
    var rtl = true;
    try { rtl = getComputedStyle(bar).direction !== 'ltr'; } catch (e) {}
    return rtl ? (r.right - clientX) : (clientX - r.left);
  }

  function send(extra) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(Object.assign({ type: 'SYFS_QURAN' }, extra || {}), function (r) {
          if (chrome.runtime.lastError || !r) { resolve({ ok: false }); return; }
          resolve(r);
        });
      } catch (e) { resolve({ ok: false }); }
    });
  }

  /* The 114 names ship WITH the extension. The list has been fixed for fourteen
   * centuries, and a player whose surah dropdown is empty without a network is a
   * worse player. Only the reciter catalogue needs the wire. */
  var SURAHS = [
    'الفاتحة', 'البقرة', 'آل عمران', 'النساء', 'المائدة', 'الأنعام',
    'الأعراف', 'الأنفال', 'التوبة', 'يونس', 'هود', 'يوسف',
    'الرعد', 'إبراهيم', 'الحجر', 'النحل', 'الإسراء', 'الكهف',
    'مريم', 'طه', 'الأنبياء', 'الحج', 'المؤمنون', 'النور',
    'الفرقان', 'الشعراء', 'النمل', 'القصص', 'العنكبوت', 'الروم',
    'لقمان', 'السجدة', 'الأحزاب', 'سبأ', 'فاطر', 'يس',
    'الصافات', 'ص', 'الزمر', 'غافر', 'فصلت', 'الشورى',
    'الزخرف', 'الدّخان', 'الجاثية', 'الأحقاف', 'محمد', 'الفتح',
    'الحجرات', 'ق', 'الذاريات', 'الطور', 'النجم', 'القمر',
    'الرحمن', 'الواقعة', 'الحديد', 'المجادلة', 'الحشر', 'الممتحنة',
    'الصف', 'الجمعة', 'المنافقون', 'التغابن', 'الطلاق', 'التحريم',
    'الملك', 'القلم', 'الحاقة', 'المعارج', 'نوح', 'الجن',
    'المزمل', 'المدثر', 'القيامة', 'الإنسان', 'المرسلات', 'النبأ',
    'النازعات', 'عبس', 'التكوير', 'الإنفطار', 'المطففين', 'الإنشقاق',
    'البروج', 'الطارق', 'الأعلى', 'الغاشية', 'الفجر', 'البلد',
    'الشمس', 'الليل', 'الضحى', 'الشرح', 'التين', 'العلق',
    'القدر', 'البينة', 'الزلزلة', 'العاديات', 'القارعة', 'التكاثر',
    'العصر', 'الهمزة', 'الفيل', 'قريش', 'الماعون', 'الكوثر',
    'الكافرون', 'النصر', 'المسد', 'الإخلاص', 'الفلق', 'الناس'
  ];

  var CAT_KEY = 'quran_cat', CAT_TTL = 7 * 86400000;
  /* two favourite sets, one per thing that can be favourited. The PLAYLIST is not
     here: it drives next/prev, so it lives in the worker with the rest of the
     playback state (see `list`/`li` in background.js) and this file only mirrors it. */
  var FAV_KEY = 'quran_fav', SFAV_KEY = 'quran_sfav';
  var API = 'https://mp3quran.net/api/v3/reciters?language=ar';
  /* Reciters the user asked to hide (v0.140.1). Matched on the FOLDED name, so
     «مشاري راشد العفاسي» and «مشارى العفاسى» both go; the Latin forms cover a
     catalogue ever served in English. The same list guards the radio rows
     (quran-body.js) and the worker's stored state (qHidden in background.js). */
  var HIDDEN = /مشاري|عفاسي|mishar|afas/i;   /* a regex, not strings: these are not UI text */
  function hidden(name) { return HIDDEN.test(norm(name)); }
  function visible(list) { return list.filter(function (r) { return r && !hidden(r.name); }); }

  /* ---- icons -------------------------------------------------------------
   * Mirrored on purpose: the progress bar fills from the RIGHT, so «السابقة»
   * points right and «التالية» points left. A player whose bar runs one way and
   * whose arrows run the other is a player the user has to think about. */
  var IC = {
    play:  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.6 4.7v14.6c0 .82.9 1.32 1.6.9l11.5-7.3a1.05 1.05 0 0 0 0-1.8L9.2 3.8a1.05 1.05 0 0 0-1.6.9Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.8 3.8h3.4a1.1 1.1 0 0 1 1.1 1.1v14.2a1.1 1.1 0 0 1-1.1 1.1H6.8a1.1 1.1 0 0 1-1.1-1.1V4.9a1.1 1.1 0 0 1 1.1-1.1Zm7 0h3.4a1.1 1.1 0 0 1 1.1 1.1v14.2a1.1 1.1 0 0 1-1.1 1.1h-3.4a1.1 1.1 0 0 1-1.1-1.1V4.9a1.1 1.1 0 0 1 1.1-1.1Z"/></svg>',
    prev:  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.6 4.4h1.9a1.1 1.1 0 0 1 1.1 1.1v13a1.1 1.1 0 0 1-1.1 1.1h-1.9a1.1 1.1 0 0 1-1.1-1.1v-13a1.1 1.1 0 0 1 1.1-1.1ZM4.4 5.5v13c0 .87.97 1.4 1.7.92l9.7-6.5a1.1 1.1 0 0 0 0-1.84l-9.7-6.5A1.1 1.1 0 0 0 4.4 5.5Z"/></svg>',
    next:  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.4 4.4H4.5a1.1 1.1 0 0 0-1.1 1.1v13a1.1 1.1 0 0 0 1.1 1.1h1.9a1.1 1.1 0 0 0 1.1-1.1v-13a1.1 1.1 0 0 0-1.1-1.1Zm13.2 1.1v13c0 .87-.97 1.4-1.7.92l-9.7-6.5a1.1 1.1 0 0 1 0-1.84l9.7-6.5a1.1 1.1 0 0 1 1.7.92Z"/></svg>',
    stop:  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.6 4.8h10.8a1.8 1.8 0 0 1 1.8 1.8v10.8a1.8 1.8 0 0 1-1.8 1.8H6.6a1.8 1.8 0 0 1-1.8-1.8V6.6a1.8 1.8 0 0 1 1.8-1.8Z"/></svg>',
    /* a 300° arc, not a full ring: a spinner has to have a visible head or the
       rotation is invisible and the user reads it as a frozen circle */
    busy:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 3.4a8.6 8.6 0 1 0 8.6 8.6"/></svg>',
    fresh: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 4.6V1.4L7 6l5 4.6V7.4a4.6 4.6 0 1 1-4.55 5.3H4.9A7 7 0 1 0 12 4.6Z"/></svg>',
    vol:   '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.3 3.6 6.6 7.6H3.4a1.1 1.1 0 0 0-1.1 1.1v6.6a1.1 1.1 0 0 0 1.1 1.1h3.2l4.7 4a.9.9 0 0 0 1.5-.7V4.3a.9.9 0 0 0-1.5-.7Zm4.6 3.5-1.4 1.5a4.6 4.6 0 0 1 0 6.8l1.4 1.5a6.6 6.6 0 0 0 0-9.8Zm2.9-3-1.4 1.5a8.8 8.8 0 0 1 0 12.8l1.4 1.5a10.8 10.8 0 0 0 0-15.8Z"/></svg>',
    mute:  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.3 3.6 6.6 7.6H3.4a1.1 1.1 0 0 0-1.1 1.1v6.6a1.1 1.1 0 0 0 1.1 1.1h3.2l4.7 4a.9.9 0 0 0 1.5-.7V4.3a.9.9 0 0 0-1.5-.7Zm9.3 5.1-1.3-1.3-2.4 2.4-2.4-2.4-1.3 1.3 2.4 2.4-2.4 2.4 1.3 1.3 2.4-2.4 2.4 2.4 1.3-1.3-2.4-2.4Z"/></svg>',
    /* a solid ring knocked out with evenodd, then the hand drawn back inside it:
       three nested subpaths, so the innermost fills again */
    timer: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M12 1.9A10.1 10.1 0 1 0 12 22.1 10.1 10.1 0 0 0 12 1.9Zm0 2.3a7.8 7.8 0 1 1 0 15.6 7.8 7.8 0 0 1 0-15.6Zm-.85 2.1h1.7v5.75l3.75 2.2-.85 1.45-4.6-2.7Z"/></svg>',
    rep:   '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17 2.8 21.9 7 17 11.2V8.2H7.4A2.6 2.6 0 0 0 4.8 10.8v2.4H2.6v-2.4A4.8 4.8 0 0 1 7.4 6h9.6ZM7 21.2 2.1 17 7 12.8v3h9.6a2.6 2.6 0 0 0 2.6-2.6v-2.4h2.2v2.4a4.8 4.8 0 0 1-4.8 4.8H7Z"/></svg>',
    auto:  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2.6 5h11.6v2.2H2.6Zm0 5h11.6v2.2H2.6Zm0 5h8v2.2h-8Zm14 .9V8.3l5.4 3.8Z"/></svg>',
    star:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.4 2.62 5.3 5.86.85-4.24 4.13 1 5.83L12 16.76 6.76 19.5l1-5.83L3.52 9.55l5.86-.85Z"/></svg>',
    plus:  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.9 4.4h2.2v6.5h6.5v2.2h-6.5v6.5h-2.2v-6.5H4.4v-2.2h6.5Z"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4.4 10.9h15.2v2.2H4.4Z"/></svg>',
    up:    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 6.3 19.7 14l-1.6 1.6L12 9.5l-6.1 6.1L4.3 14Z"/></svg>',
    down:  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 17.7 4.3 10l1.6-1.6L12 14.5l6.1-6.1L19.7 10Z"/></svg>',
    /* three stacked rows with a play head — the queue, not a generic list */
    queue: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2.8 4.6h13v2.2h-13Zm0 4.9h13v2.2h-13Zm0 4.9h8.3v2.2H2.8Zm14.6-6.2 5.2 3.4-5.2 3.4Z"/></svg>',
    /* a set with a dial and a raised aerial — the broadcast, as opposed to a file */
    radio: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="m19.3 2.9.7 1.6L7.6 9.2H19a2.4 2.4 0 0 1 2.4 2.4v7A2.4 2.4 0 0 1 19 21H5a2.4 2.4 0 0 1-2.4-2.4v-7c0-1.05.67-1.94 1.6-2.27Zm-10.3 9.3a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4Zm0 2.1a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Zm5.4-1.6h5v2.1h-5Zm0 3.6h5v2.1h-5Z"/></svg>'
  };

  /* Shape the catalogue down to what the player uses, and DROP anything malformed
   * rather than carrying it forward — a reciter with no usable server is a row that
   * can only fail when tapped. */
  function shape(json) {
    var out = [];
    var arr = (json && Array.isArray(json.reciters)) ? json.reciters : [];
    arr.forEach(function (r) {
      var name = typeof r.name === 'string' ? r.name.trim() : '';
      if (!name || hidden(name)) return;
      var mos = [];
      (Array.isArray(r.moshaf) ? r.moshaf : []).forEach(function (m) {
        var server = typeof m.server === 'string' ? m.server : '';
        if (!/^https:\/\/([a-z0-9-]+\.)*mp3quran\.net\//i.test(server)) return;   /* reject, never repair */
        var list = String(m.surah_list || '').split(',')
          .map(function (n) { return parseInt(n, 10); })
          .filter(function (n) { return n >= 1 && n <= 114; });
        if (!list.length) return;
        mos.push({ id: Number(m.id) || 0, name: typeof m.name === 'string' ? m.name : '', server: server, list: list });
      });
      if (mos.length) out.push({ id: Number(r.id) || 0, name: name, moshaf: mos });
    });
    return out;
  }

  function loadCatalogue(force) {
    return store.get(CAT_KEY, null).then(function (c) {
      var fresh = c && typeof c === 'object' && Array.isArray(c.r) && c.r.length
        && typeof c.t === 'number' && (Date.now() - c.t) < CAT_TTL;
      if (fresh && !force) return visible(c.r);   /* a cache written before the list existed */
      return bgFetch(API).then(function (res) {
        if (!res || !res.ok || !res.body) throw new Error('fetch');
        var list = shape(JSON.parse(res.body));
        if (!list.length) throw new Error('empty');
        store.set(CAT_KEY, { t: Date.now(), r: list });
        return list;
      }).catch(function (e) {
        /* a stale cache beats an empty list: the catalogue barely changes, and the
           user opened this tool to listen, not to be told the network is down */
        if (c && Array.isArray(c.r) && c.r.length) return visible(c.r);
        throw e;
      });
    });
  }

  /* ---- search normalisation ----------------------------------------------
   * `indexOf` on the raw name is why «عبدالباسط» used to find nothing: the
   * catalogue spells it «عبد الباسط», and «احمد» never matched «أحمد». Folding
   * the hamza forms, ى/ي, ة/ه, and every space away makes both work, and it is
   * done ONLY here — nothing normalised ever reaches a URL or the worker. */
  function norm(s) {
    return String(s || '')
      /* ⚠️ the class below holds LITERAL combining marks, which have no width of
         their own and paint onto the bracket that precedes them — so it looks
         mangled in most editors and must not be "tidied". It is, in codepoints:
         [U+064B-U+0652] tashkeel · U+0670 dagger alef · U+0640 tatweel.
         Verify with `grep -n tashkeel src/quran.js | cat -v` before touching it. */
      .replace(/[ً-ْٰـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا')   /* أ إ آ ٱ → ا */
      .replace(/ى/g, 'ي')                       /* ى → ي */
      .replace(/ة/g, 'ه')                       /* ة → ه */
      .replace(/ؤ/g, 'و')                       /* ؤ → و */
      .replace(/ئ/g, 'ي')                       /* ئ → ي */
      .replace(/\s+/g, '');
  }
  /* ٣٦ and 36 are the same surah. Arabic-Indic digits are what an Arabic keyboard
     actually produces, so a number search that only accepts ASCII is half a feature. */
  function ascii(s) {
    return String(s || '').replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 1632); })
                          .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 1776); });
  }
  var SURAH_N = SURAHS.map(norm);
  /* The displayed name, and the one thing the whole list is navigated by.
     ⚠️ sName() for DISPLAY, sKey() for SEARCH, and they are not the same string:
     the search must keep matching the ARABIC name as well, because that is what
     a reader may still type — and because SURAH_N is built once at load time,
     before a language is even chosen. Matching only the displayed name would
     make the search deny that a surah is in a list it is plainly showing. */
  function sName(n) { return SYFS.t(SURAHS[n - 1] || ''); }
  /* A surah number is an INTEGER 1..114 and nothing else. The worker checks too, but
     a stored 2.5 or "3" is still state this page paints and sends back — a range test
     alone lets 2.5 through, and `indexOf` then fails on it silently (next = الفاتحة). */
  function okSurah(n) { return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 114; }
  /* The NAME a screen reader announces for a play/pause button: the one action this
     press will take. The title keeps saying both («تشغيل / إيقاف مؤقّت») for the mouse.
     Shared by the mini player and both windows, so the three cannot drift. */
  function playLabel(loading, playing) {
    return loading ? SYFS.t('جارٍ التحميل…') : (playing ? SYFS.t('إيقاف مؤقّت') : SYFS.t('تشغيل'));
  }
  function sKey(i) { return SURAH_N[i] + ' ' + norm(SYFS.t(SURAHS[i] || '')); }

  /* h:mm:ss past the hour — البقرة مرتّلة is about two hours, and the old m:ss
     printed that as «127:33», a number no one reads as a duration. */
  function hms(s) {
    s = Math.max(0, Math.floor(s || 0));
    var hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return hh ? (hh + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0'))
              : (mm + ':' + String(ss).padStart(2, '0'));
  }

  /* ===== المشغّل المصغّر على زرّ «إسلامية» ==================================
   * Hovering the category button while a recitation is running gets the transport
   * without opening anything. It exists because the common act by far is "pause
   * this" — and reaching pause used to mean opening a shelf, then a window, then
   * finding the button, by which time the thing you wanted to silence has been
   * playing for another four seconds.
   *
   * It appears ONLY while audio is actually loaded: a mini player over a silent
   * player is a control panel for nothing. That check costs one message per hover
   * — there is no background polling, and the 700ms poll starts only once the
   * panel is on screen and stops the moment it leaves.
   *
   * It lives here rather than in rail.js because everything it knows about is in
   * this file; the rail only tells it which button to watch. */
  SYFS.qmini = (function () {
    var el = null, iv = 0, hideT = 0, inside = false, held = null;
    var dur = 0, drag = null, vol = 1, preMute = 1;

    function qq(s) { return el.querySelector(s); }
    function ico(node, key, svg) {
      if (node.getAttribute('data-ic') === key) return;
      node.setAttribute('data-ic', key);
      node.textContent = '';
      node.appendChild(h(svg));
    }
    function build(wrap) {
      el = h('<div class="syfs-qmini" role="group" aria-label="مشغّل القرآن">' +
        '<div class="syfs-qm-top"><span class="syfs-qm-num"></span>' +
          '<div class="syfs-qm-meta"><b></b><span></span></div></div>' +
        '<div class="syfs-qm-bar" title="اسحب للتنقّل"><i class="syfs-qm-fill"></i></div>' +
        '<div class="syfs-qm-times"><span class="syfs-qm-p">0:00</span><span class="syfs-qm-d">0:00</span></div>' +
        '<div class="syfs-qm-tr">' +
          '<button class="syfs-qm-b syfs-qm-prev" type="button" title="السورة السابقة"></button>' +
          '<button class="syfs-qm-b syfs-qm-main syfs-qm-tg" type="button" title="تشغيل / إيقاف مؤقّت"></button>' +
          '<button class="syfs-qm-b syfs-qm-next" type="button" title="السورة التالية"></button>' +
          '<button class="syfs-qm-b syfs-qm-mute" type="button" title="كتم" aria-pressed="false"></button>' +
          '<button class="syfs-qm-b syfs-qm-stop" type="button" title="إيقاف تام"></button>' +
        '</div></div>');
      wrap.appendChild(el);
      ico(qq('.syfs-qm-prev'), 'prev', IC.prev);
      ico(qq('.syfs-qm-next'), 'next', IC.next);
      ico(qq('.syfs-qm-stop'), 'stop', IC.stop);
      ico(qq('.syfs-qm-tg'), 'play', IC.play);
      ico(qq('.syfs-qm-mute'), 'v', IC.vol);

      /* the panel is part of the hover target: leaving the button INTO the panel
         must not close the thing you were reaching for */
      el.addEventListener('mouseenter', function () { inside = true; clearTimeout(hideT); });
      el.addEventListener('mouseleave', function () { inside = false; scheduleHide(); });

      qq('.syfs-qm-tg').addEventListener('click', function () { send({ op: 'toggle' }).then(pull); });
      qq('.syfs-qm-prev').addEventListener('click', function () { send({ op: 'prev' }).then(pull); });
      qq('.syfs-qm-next').addEventListener('click', function () { send({ op: 'next' }).then(pull); });
      /* stop tears the audio down, so there is nothing left to control */
      qq('.syfs-qm-stop').addEventListener('click', function () { send({ op: 'stop' }).then(hide); });
      qq('.syfs-qm-mute').addEventListener('click', function () {
        var v = vol > 0 ? 0 : (preMute > 0 ? preMute : 1);
        if (vol > 0) preMute = vol;
        vol = v;
        ico(qq('.syfs-qm-mute'), v > 0 ? 'v' : 'm', v > 0 ? IC.vol : IC.mute);
        qq('.syfs-qm-mute').classList.toggle('on', v === 0);
        qq('.syfs-qm-mute').setAttribute('aria-pressed', String(v === 0));
        send({ op: 'vol', v: v });
      });

      var bar = qq('.syfs-qm-bar');
      function frac(ev) {
        var r = bar.getBoundingClientRect();
        if (!r.width) return 0;
        return Math.max(0, Math.min(1, seekOffset(bar, r, ev.clientX) / r.width));
      }
      bar.addEventListener('pointerdown', function (ev) {
        if (!dur) return;
        drag = frac(ev);
        try { bar.setPointerCapture(ev.pointerId); } catch (e) {}
        qq('.syfs-qm-fill').style.width = (drag * 100) + '%';
        qq('.syfs-qm-p').textContent = hms(drag * dur);
        ev.preventDefault();
      });
      bar.addEventListener('pointermove', function (ev) {
        if (drag === null) return;
        drag = frac(ev);
        qq('.syfs-qm-fill').style.width = (drag * 100) + '%';
        qq('.syfs-qm-p').textContent = hms(drag * dur);
      });
      bar.addEventListener('pointerup', function () {
        if (drag === null) return;
        var t = drag * dur; drag = null;
        send({ op: 'seek', t: t }).then(pull);
      });
      bar.addEventListener('pointercancel', function () { drag = null; });
    }

    function paint(r) {
      if (!r || !r.ok) { hide(); return; }
      var s = r.s, live = r.live || {};
      /* "running" is audio that EXISTS — playing or paused mid-surah. A remembered
         reciter with no loaded audio is not something to show a transport for. */
      if (!(live.playing || live.loading || live.dur > 0)) { hide(); return; }
      dur = live.dur || 0;
      var radio = !!s.radio;
      el.classList.toggle('radio', radio);
      if (radio) {
        ico(qq('.syfs-qm-num'), 'radio', IC.radio);
        /* i18n-dyn: the station's name, as the list spells it */
        qq('.syfs-qm-meta b').textContent = s.rdname || SYFS.t('إذاعة القرآن');
        qq('.syfs-qm-meta span').textContent = SYFS.t('بثّ مباشر');
      } else {
        /* the badge holds text again — drop the icon key or the next radio
           paint would see «already drawn» and leave the number in place */
        var n = okSurah(s.surah) ? s.surah : 0;
        qq('.syfs-qm-num').removeAttribute('data-ic');
        qq('.syfs-qm-num').textContent = n ? String(n) : '';
        qq('.syfs-qm-meta b').textContent = n ? sName(n) : '';
        /* the separator stays OUT of the msgid: t() looks keys up verbatim and the
           dictionary stores them trimmed, so ' · القائمة {0}' never matched and the
           word stayed Arabic in English. Same key and shape as the big player. */
        qq('.syfs-qm-meta span').textContent = (s.rname || '') + (s.li >= 0
          ? ' · ' + SYFS.t('القائمة {0}/{1}', s.li + 1, Array.isArray(s.list) ? s.list.length : s.li + 1) : '');
      }
      qq('.syfs-qm-prev').disabled = radio;
      qq('.syfs-qm-next').disabled = radio;
      ico(qq('.syfs-qm-tg'), live.loading ? 'busy' : (live.playing ? 'pause' : 'play'),
          live.loading ? IC.busy : (live.playing ? IC.pause : IC.play));
      qq('.syfs-qm-tg').classList.toggle('busy', !!live.loading);
      /* the title says both actions; the NAME a screen reader announces says the one
         this press will do */
      qq('.syfs-qm-tg').setAttribute('aria-label', playLabel(!!live.loading, !!live.playing));
      if (drag === null) {
        qq('.syfs-qm-fill').style.width = (dur ? Math.min(100, (live.pos / dur) * 100) : 0) + '%';
        qq('.syfs-qm-p').textContent = hms(live.pos);
      }
      qq('.syfs-qm-d').textContent = hms(dur);
      if (typeof s.vol === 'number') {
        vol = s.vol;
        ico(qq('.syfs-qm-mute'), vol > 0 ? 'v' : 'm', vol > 0 ? IC.vol : IC.mute);
        qq('.syfs-qm-mute').classList.toggle('on', vol === 0);
        qq('.syfs-qm-mute').setAttribute('aria-pressed', String(vol === 0));
      }
      place();
    }
    function pull() { return send({ op: 'state' }).then(paint); }

    /* measured from the button's own rect, like the rail's tooltip, so it follows
       the bar through all four edge positions and through the magnifier's scaling */
    function place() {
      if (!el || !held || !held.isConnected) return;
      var w = el.parentNode, pos = (w && w.dataset && w.dataset.pos) || 'right';
      var r = held.getBoundingClientRect(), pw = el.offsetWidth, ph = el.offsetHeight, x, y;
      if (pos === 'top' || pos === 'bottom') {
        x = r.left + r.width / 2 - pw / 2;
        y = (pos === 'top') ? r.bottom + 10 : r.top - ph - 10;
      } else {
        y = r.top + r.height / 2 - ph / 2;
        x = (pos === 'right') ? r.left - pw - 10 : r.right + 10;
      }
      el.style.left = Math.min(Math.max(6, x), Math.max(6, window.innerWidth - pw - 6)) + 'px';
      el.style.top = Math.min(Math.max(6, y), Math.max(6, window.innerHeight - ph - 6)) + 'px';
    }
    function hide() {
      clearInterval(iv); iv = 0;
      clearTimeout(hideT);
      inside = false; held = null; drag = null;
      if (el) { el.classList.remove('on'); el.style.left = '-9999px'; }
    }
    function scheduleHide() {
      clearTimeout(hideT);
      /* a grace period, because the gap between the button and the panel is real
         pixels and crossing it fires mouseout */
      hideT = setTimeout(function () { if (!inside) hide(); }, 220);
    }

    function open(btn, wrap) {
      if (!el || !el.isConnected) build(wrap);
      held = btn;
      clearTimeout(hideT);
      /* one round-trip decides whether this hover shows anything at all; the
         700ms poll starts only after we know there IS something to show */
      send({ op: 'state' }).then(function (r) {
        if (held !== btn) return;                       /* pointer moved on while we waited */
        if (!r || !r.ok) return;
        var live = r.live || {};
        if (!(live.playing || live.loading || live.dur > 0)) { held = null; return; }
        el.classList.add('on');
        paint(r);
        clearInterval(iv);
        iv = setInterval(function () {
          if (!el.isConnected || !held) { clearInterval(iv); iv = 0; return; }
          pull();
        }, 700);
      });
    }

    return {
      /* delegated exactly like the rail's own tooltip: mouseenter does not bubble,
         and re-entering the same button must not restart anything. */
      wire: function (rail, wrap) {
        if (!rail || !wrap) return;
        rail.addEventListener('mouseover', function (e) {
          /* رفٌّ مفتوح واللوحة مثبَّتة على طبقة أعلى ⇒ تُرسم فوق الأدوات التي طلبها
             النقر للتوّ — نفس وقفة بطاقة الساعة ولوحة النشاط. والعلامة تُقرأ من الـDOM
             (`.syfs-cat.open`، §6.9/5) لأن `openCatKey` يخصّ rail.js وحده. */
          if (rail.querySelector('.syfs-cat.open')) { hide(); return; }
          var b = e.target && e.target.closest && e.target.closest('.syfs-cat[data-cat="islam"] .syfs-cat-btn');
          if (b) { if (b !== held) open(b, wrap); return; }
          if (held && !inside) scheduleHide();
        });
        rail.addEventListener('mouseout', function (e) {
          var b = e.target && e.target.closest && e.target.closest('.syfs-cat[data-cat="islam"] .syfs-cat-btn');
          if (b && b === held && !b.contains(e.relatedTarget)) scheduleHide();
        });
        /* clicking the button opens the shelf; two panels off one icon is noise.
           بطور الالتقاط لا الصعود: كل زرّ في الشريط يستدعي stopPropagation (§6.9/10)
           فمستمعٌ مفوَّض هنا على الصعود لا يعمل قطّ — وهذا ما كان يترك اللوحة مرسومة
           فوق الرفّ الذي فتحته النقرة نفسها. */
        rail.addEventListener('click', hide, true);
      },
      hide: hide
    };
  }());

  /* the helpers src/quran-body.js (the lazy tool bodies, v0.139.5) reads back — see its header */
  SYFS._quran = { store: store, bgFetch: bgFetch, h: h, seekOffset: seekOffset, send: send, CAT_TTL: CAT_TTL, FAV_KEY: FAV_KEY, SFAV_KEY: SFAV_KEY, IC: IC, loadCatalogue: loadCatalogue, hidden: hidden, norm: norm, ascii: ascii, sName: sName, sKey: sKey, hms: hms, okSurah: okSurah, playLabel: playLabel };
}());
