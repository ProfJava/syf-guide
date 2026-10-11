/* SYF — the tool BODIES of src/quran.js, injected on demand (v0.139.5).
 *
 * Split out of src/quran.js so the eager content-script bundle stops parsing them on
 * every page. background.js → LAZY_TOOL_FILES injects this file the first time the user
 * opens the rail's tools (src/rail.js → ensureTools); extension pages (app/word/…) load it
 * with a <script> right after its eager half.
 *
 * ⛔ Everything that must run at PAGE LOAD stays in src/quran.js (listeners, boots,
 *    the APIs other files call). This file only REGISTERS tools; nothing here may run
 *    before a tool is mounted. The helpers it shares with the eager half come from
 *    `SYFS._quran`, set there — the aliases below are read once, so a helper must never
 *    be REASSIGNED in the eager half (tools/perf-split-test.js checks the contract). */
(function () {
  window.SYFS = window.SYFS || {};
  var P = SYFS._quran || {};
  var store = P.store, bgFetch = P.bgFetch, h = P.h, seekOffset = P.seekOffset, send = P.send, CAT_TTL = P.CAT_TTL, FAV_KEY = P.FAV_KEY, SFAV_KEY = P.SFAV_KEY, IC = P.IC, loadCatalogue = P.loadCatalogue, hidden = P.hidden, norm = P.norm, ascii = P.ascii, sName = P.sName, sKey = P.sKey, hms = P.hms, okSurah = P.okSurah, playLabel = P.playLabel;

  SYFS.tools = SYFS.tools || [];
  SYFS.tools.push({
    id: 'quran', name: 'مشغّل القرآن', cat: 'islam',
    /* An open mushaf with the play triangle knocked out of it — the tool is both
     * a book and a player, and one shape says both. 91.7% x 81.7%: an open book is
     * inherently wide, the mirror of the mosque being inherently narrow, and the
     * ink is centred (9.2% clear top and bottom) so it does not look dropped. */
    icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M12 4.6 C10.1 3.0 7.4 2.2 4.4 2.2 C3.4 2.2 2.5 2.29 1.75 2.43 C1.31 2.52 1 2.9 1 3.35 L1 18.55 C1 19.15 1.5 19.6 2.06 19.5 C2.81 19.39 3.6 19.33 4.4 19.33 C7.3 19.33 9.9 20.15 11.5 21.55 C11.8 21.8 12.2 21.8 12.5 21.55 C14.1 20.15 16.7 19.33 19.6 19.33 C20.4 19.33 21.19 19.39 21.94 19.5 C22.5 19.6 23 19.15 23 18.55 L23 3.35 C23 2.9 22.69 2.52 22.25 2.43 C21.5 2.29 20.6 2.2 19.6 2.2 C16.6 2.2 13.9 3.0 12 4.6 Z M10.2 8.9 L16.0 12.0 L10.2 15.1 Z"/></svg>',
    mount: function (body) {
      /* every string below is written HERE — no remote value is ever interpolated
         into markup; names and numbers are set with textContent further down */
      var ui = h(
        /* tabindex on the root so the shortcuts have somewhere to land: keydown
           only reaches this subtree while focus is inside it, and the window was
           just opened by a click, so taking focus here is what the user meant */
        '<div class="syf-q" tabindex="-1">' +
          '<div class="syf-q-card idle" id="qr-card">' +
            '<div class="syf-q-head">' +
              '<span class="syf-q-num" id="qr-num">—</span>' +
              '<div class="syf-q-meta"><b id="qr-title">لم تبدأ التلاوة بعد</b><span id="qr-sub">اختر قارئاً ثم سورة</span></div>' +
              '<button class="syf-q-resume" id="qr-resume" type="button" style="display:none">استئناف</button>' +
            '</div>' +
            /* a real slider to assistive tech and to the keyboard: focusable, named, and
               its value re-written by paintBar(); the arrows are the root's nudge() */
            '<div class="syf-q-bar off" id="qr-bar" title="اسحب للتنقّل" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-disabled="true" aria-label="موضع التلاوة">' +
              '<i class="syf-q-buf" id="qr-buf"></i><i class="syf-q-fill" id="qr-fill"></i><i class="syf-q-knob" id="qr-knob"></i>' +
            '</div>' +
            '<div class="syf-q-times"><span id="qr-pos">0:00</span><span id="qr-dur">0:00</span></div>' +
            '<div class="syf-q-tr">' +
              '<button class="syf-q-tb" id="qr-prev" type="button" title="السورة السابقة">' + IC.prev + '</button>' +
              '<button class="syf-q-main" id="qr-toggle" type="button" title="تشغيل / إيقاف مؤقّت (مسافة)">' + IC.play + '</button>' +
              '<button class="syf-q-tb" id="qr-next" type="button" title="السورة التالية">' + IC.next + '</button>' +
              '<button class="syf-q-tb" id="qr-stop" type="button" title="إيقاف تام">' + IC.stop + '</button>' +
            '</div>' +
          '</div>' +

          '<div class="syf-q-sec">' +
            '<button class="syf-q-ib" id="qr-mute" type="button" title="كتم (M)" aria-pressed="false">' + IC.vol + '</button>' +
            '<input type="range" class="syf-q-vol" id="qr-vol" min="0" max="100" value="100" title="مستوى الصوت" aria-label="مستوى الصوت">' +
            '<select class="syf-q-rate" id="qr-rate" title="سرعة التلاوة" aria-label="سرعة التلاوة">' +
              '<option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option>' +
              '<option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="1.75">1.75×</option>' +
              '<option value="2">2×</option></select>' +
            '<button class="syf-q-ib syf-q-timer" id="qr-tm" type="button" title="مؤقّت النوم" aria-expanded="false" aria-controls="qr-sleep">' + IC.timer + '<b id="qr-tmv"></b></button>' +
            '<button class="syf-q-ib" id="qr-rep" type="button" title="تكرار السورة" aria-pressed="false">' + IC.rep + '</button>' +
            '<button class="syf-q-ib" id="qr-auto" type="button" title="الانتقال للتالية تلقائياً" aria-pressed="false">' + IC.auto + '</button>' +
          '</div>' +
          '<div class="syf-q-sleep" id="qr-sleep">' +
            '<button class="syf-q-chip" type="button" data-m="15">١٥ دقيقة</button>' +
            '<button class="syf-q-chip" type="button" data-m="30">٣٠ دقيقة</button>' +
            '<button class="syf-q-chip" type="button" data-m="45">٤٥ دقيقة</button>' +
            '<button class="syf-q-chip" type="button" data-m="60">٦٠ دقيقة</button>' +
            '<button class="syf-q-chip" type="button" data-m="end">نهاية السورة</button>' +
            '<button class="syf-q-chip" type="button" data-m="0">إلغاء</button>' +
          '</div>' +

          '<div class="syf-q-tabs" id="qr-tabs" role="tablist">' +
            '<button type="button" role="tab" aria-selected="true" aria-controls="qr-list" class="on" data-t="r">القرّاء</button>' +
            '<button type="button" role="tab" aria-selected="false" aria-controls="qr-list" data-t="s">السور</button>' +
            '<button type="button" role="tab" aria-selected="false" aria-controls="qr-list" data-t="f">المفضّلة</button>' +
            '<button type="button" role="tab" aria-selected="false" aria-controls="qr-list" data-t="p">القائمة</button>' +
          '</div>' +
          '<div class="syf-row" id="qr-frow">' +
            '<input class="syf-in" id="qr-find" placeholder="ابحث عن قارئ…" style="flex:1">' +
            '<button class="syf-q-ib" id="qr-refresh" type="button" title="تحديث قائمة القرّاء">' + IC.fresh + '</button>' +
          '</div>' +
          '<div class="syf-row" id="qr-prow" style="display:none">' +
            '<button class="syf-mini" id="qr-pplay" type="button" style="flex:1">تشغيل القائمة</button>' +
            '<button class="syf-mini danger" id="qr-pclear" type="button">إفراغ</button>' +
          '</div>' +
          '<div class="syf-row" id="qr-mrow" style="display:none">' +
            '<select class="syf-in" id="qr-moshaf" style="flex:1"></select>' +
          '</div>' +
          '<div class="syf-note-hint" id="qr-cnt">…جارٍ تحميل قائمة القرّاء</div>' +
          '<div class="syf-q-list" id="qr-list" role="tabpanel"></div>' +
          /* always in the tree (collapsed while empty, see rail.css): a live region that
             is display:none when its text arrives is a region nobody hears */
          '<div class="syf-empty" id="qr-st" role="status" aria-live="polite"></div>' +
          '<div class="syf-note-hint">التلاوة تستمر وأنت تتنقّل بين الصفحات والتبويبات — يوقفها زرّ الإيقاف وحده. مسافة = تشغيل، الأسهم = تنقّل وصوت.</div>' +
        '</div>'
      );
      body.appendChild(ui);
      var q = function (s) { return ui.querySelector(s); };
      var listEl = q('#qr-list'), stEl = q('#qr-st'), bar = q('#qr-bar');
      var cat = [], favs = [], sfavs = [], pick = null, tab = 'r', curSurah = 1;
      var plist = [], pli = -1;                    /* mirror of the worker's queue */
      var vol = 1, preMute = 1, drag = null;
      var lastDur = 0, lastBuf = 0, lastPos = 0, playing = false, onRadio = false;

      /* `err` marks a message that paint() raised from the worker's error flag, so
         paint() — and only paint() — takes it down again once the audio recovers.
         A hint the user caused («اختر قارئاً…») is not the worker's to clear. */
      function show(t, err) {
        stEl.textContent = t ? SYFS.t(t) : '';
        if (t && err) stEl.dataset.err = '1'; else delete stEl.dataset.err;
      }
      /* Keyed, because paint() runs every 700ms: re-inserting the same <svg> would
         restart the spinner's animation on every tick, so it would never appear to
         turn. The key is the only thing compared; the node is left alone. */
      function ico(el, key, svg) {
        if (el.getAttribute('data-ic') === key) return;
        el.setAttribute('data-ic', key);
        el.textContent = '';
        el.appendChild(h(svg));
      }
      /* inside a shadow root document.activeElement is the HOST, not the field —
         so the plain check would never match and paint() would fight the slider */
      function focused() {
        var root = ui.getRootNode ? ui.getRootNode() : null;
        return (root && root.activeElement) || document.activeElement;
      }

      /* ---- favourites -------------------------------------------------------
       * Ids only. Storing the NAME would put a remote string in a second place
       * and buy nothing: the name is looked up from the loaded catalogue anyway. */
      function isFav(id) { return favs.indexOf(id) >= 0; }
      function toggleFav(id) {
        var i = favs.indexOf(id);
        if (i >= 0) favs.splice(i, 1); else favs.push(id);
        store.set(FAV_KEY, favs);
        renderList();
      }
      /* surah favourites are a plain SET kept in surah order — a favourite is
         "I come back to this one", which has no order of its own. Order is what
         the playlist is for, and conflating the two would give the user two
         things that look identical and behave differently. */
      function isSFav(n) { return sfavs.indexOf(n) >= 0; }
      function toggleSFav(n) {
        var i = sfavs.indexOf(n);
        if (i >= 0) sfavs.splice(i, 1); else sfavs.push(n);
        sfavs.sort(function (a, b) { return a - b; });
        store.set(SFAV_KEY, sfavs);
        renderList();
      }

      /* ---- the playlist -------------------------------------------------------
       * The worker owns it; this sends whole orders and re-reads what came back.
       * Every mutation is "here is the new list", so there is exactly one path in
       * and no index arithmetic split across two processes. */
      function pushList(next) {
        return send({ op: 'setlist', list: next }).then(function (r) {
          if (r && r.ok && r.s) { plist = (r.s.list || []).slice(); pli = r.s.li; }
          renderList();
        });
      }
      function inList(n) { return plist.indexOf(n) >= 0; }
      function toggleList(n) {
        var next = plist.slice(), i = next.indexOf(n);
        if (i >= 0) next.splice(i, 1); else next.push(n);
        return pushList(next);
      }
      function moveList(i, d) {
        var j = i + d;
        if (j < 0 || j >= plist.length) return;
        var next = plist.slice(), t = next[i];
        next[i] = next[j]; next[j] = t;
        pushList(next);
      }
      /* true when the worker's copy has drifted from ours (it advances on its own
         as a surah ends), so paint() knows whether a re-render is owed */
      function syncList(s) {
        var a = (s.list || []).join(','), changed = (a !== plist.join(',')) || (s.li !== pli);
        plist = (s.list || []).slice();
        pli = (typeof s.li === 'number') ? s.li : -1;
        return changed;
      }

      function curM() {
        if (!pick) return null;
        var i = parseInt(q('#qr-moshaf').value, 10);
        return pick.moshaf[i >= 0 ? i : 0] || pick.moshaf[0];
      }
      function availSet() {
        var m = curM();
        return m ? m.list : null;                       /* null = no reciter picked yet */
      }

      /* ---- the three lists --------------------------------------------------- */
      function setTab(t) {
        tab = t;
        Array.prototype.forEach.call(q('#qr-tabs').children, function (b) {
          var on = b.getAttribute('data-t') === t;
          b.classList.toggle('on', on);
          b.setAttribute('aria-selected', String(on));
        });
        /* the search box serves BOTH lists — hiding it on the surah tab was the
           whole point of that tab (114 rows are not browsed by scrolling either).
           The queue is short and ORDERED, so searching it would be searching for
           a row you put there yourself: it gets the play/clear bar instead. */
        q('#qr-frow').style.display = (t === 'p') ? 'none' : '';
        q('#qr-prow').style.display = (t === 'p') ? '' : 'none';
        q('#qr-find').placeholder = (t === 's') ? SYFS.t('ابحث عن سورة بالاسم أو الرقم…') : SYFS.t('ابحث عن قارئ…');
        q('#qr-refresh').style.display = (t === 's') ? 'none' : '';
        q('#qr-mrow').style.display = (pick && pick.moshaf.length > 1) ? '' : 'none';
        renderList();
        listEl.scrollTop = 0;
      }
      /* Every render rebuilds the whole list, and starring a surah 60 rows down
         would otherwise throw the user back to الفاتحة. The scroll offset is
         restored around the rebuild; setTab resets it deliberately, since a new
         tab is a new list and should start at the top. */
      function renderList() {
        var top = listEl.scrollTop;
        if (tab === 's') renderSurahs();
        else if (tab === 'p') renderPlaylist();
        else if (tab === 'f') renderFavs();
        else renderReciters();
        if (top) listEl.scrollTop = top;
      }
      function groupHead(text) {
        var g = h('<div class="syf-q-gh"><b></b></div>');
        g.querySelector('b').textContent = SYFS.t(text);
        return g;
      }

      function reciterRow(r) {
        var row = h('<div class="syf-q-row"><button class="syf-q-star" type="button" title="مفضّلة"></button>' +
                    '<button class="syf-q-pick" type="button"><b></b><span></span></button></div>');
        var star = row.querySelector('.syf-q-star'), btn = row.querySelector('.syf-q-pick');
        ico(star, 'star', IC.star);
        if (isFav(r.id)) star.classList.add('on');
        star.setAttribute('aria-pressed', String(isFav(r.id)));
        /* i18n-dyn: a reciter's name, as the remote list spells it */
        btn.querySelector('b').textContent = r.name;                    /* remote string — textContent, always */
        btn.querySelector('span').textContent = r.moshaf.length > 1
          ? SYFS.t('{0} روايات · {1} سورة', r.moshaf.length, r.moshaf[0].list.length)
          : SYFS.t('{0} · {1} سورة', r.moshaf[0].name || SYFS.t('رواية'), r.moshaf[0].list.length);
        if (pick && pick.id === r.id) { row.classList.add('on'); btn.setAttribute('aria-current', 'true'); }
        star.addEventListener('click', function () { toggleFav(r.id); });
        btn.addEventListener('click', function () { choose(r, true); });
        return row;
      }

      function renderReciters() {
        var raw = q('#qr-find').value;
        var f = norm(raw);
        var rows = f ? cat.filter(function (r) { return norm(r.name).indexOf(f) >= 0; }) : cat;
        listEl.textContent = '';
        q('#qr-cnt').textContent = f ? SYFS.t('{0} من {1} قارئ', rows.length, cat.length)
                                     : SYFS.t('{0} قارئاً — اختر واحداً', cat.length);
        if (!rows.length) { listEl.appendChild(h('<div class="syf-empty">لا قارئ بهذا الاسم.</div>')); return; }
        rows.slice(0, 80).forEach(function (r) { listEl.appendChild(reciterRow(r)); });
        if (rows.length > 80) listEl.appendChild(h('<div class="syf-note-hint" style="text-align:center">…واصل الكتابة لتضييق النتائج</div>'));
      }

      /* ONE tab for both kinds of favourite, in two labelled groups. Two separate
         tabs would have cost a fifth tab in a 320px window to say "starred" twice. */
      function renderFavs() {
        var f = norm(q('#qr-find').value);
        var recs = cat.filter(function (r) { return isFav(r.id) && (!f || norm(r.name).indexOf(f) >= 0); });
        var surs = sfavs.filter(function (n) { return !f || sKey(n - 1).indexOf(f) >= 0; });
        listEl.textContent = '';
        q('#qr-cnt').textContent = (favs.length + sfavs.length)
          ? SYFS.t('{0} قارئ · {1} سورة', recs.length, surs.length)
          : '';
        if (!favs.length && !sfavs.length) {
          listEl.appendChild(h('<div class="syf-empty">لا مفضّلة بعد — اضغط النجمة بجوار أي قارئ أو سورة.</div>'));
          return;
        }
        if (recs.length) {
          listEl.appendChild(groupHead('قرّاء'));
          recs.slice(0, 80).forEach(function (r) { listEl.appendChild(reciterRow(r)); });
        }
        if (surs.length) {
          listEl.appendChild(groupHead('سور'));
          var av = availSet();
          surs.forEach(function (n) { listEl.appendChild(surahRow(n, !!(av && av.indexOf(n) < 0))); });
        }
        if (!recs.length && !surs.length) listEl.appendChild(h('<div class="syf-empty">لا مفضّلة بهذا الاسم.</div>'));
      }

      /* one surah row: star (favourite) · plus (queue) · the row itself.
         The two toggles sit on the leading edge exactly like the reciter star, so
         "the small round things on the right are toggles" holds across every list. */
      function surahRow(n, off) {
        var wrap = h('<div class="syf-q-row">' +
          '<button class="syf-q-star" type="button" title="مفضّلة"></button>' +
          '<button class="syf-q-add" type="button" title="أضف إلى القائمة"></button>' +
          '<button class="syf-q-srow" type="button"><i></i><b></b><em></em></button></div>');
        var star = wrap.querySelector('.syf-q-star'), add = wrap.querySelector('.syf-q-add');
        var row = wrap.querySelector('.syf-q-srow');
        ico(star, 'star', IC.star);
        if (isSFav(n)) star.classList.add('on');
        star.setAttribute('aria-pressed', String(isSFav(n)));
        var queued = inList(n);
        ico(add, queued ? 'minus' : 'plus', queued ? IC.minus : IC.plus);
        add.classList.toggle('on', queued);
        add.title = queued ? SYFS.t('أزل من القائمة') : SYFS.t('أضف إلى القائمة');
        row.querySelector('i').textContent = String(n);
        row.querySelector('b').textContent = sName(n);
        row.querySelector('em').textContent = off ? SYFS.t('غير متوفّرة') : '';
        if (off) { row.classList.add('off'); row.disabled = true; }
        if (n === curSurah) { wrap.classList.add('on'); row.setAttribute('aria-current', 'true'); }
        star.addEventListener('click', function () { toggleSFav(n); });
        add.addEventListener('click', function () { toggleList(n); });
        row.addEventListener('click', function () { play(n); });
        return wrap;
      }

      function renderSurahs() {
        var raw = ascii(q('#qr-find').value).trim();
        var f = norm(raw), num = /^\d{1,3}$/.test(raw);
        var av = availSet();
        listEl.textContent = '';
        var hits = [];
        for (var i = 0; i < 114; i++) {
          var n = i + 1;
          if (num) { if (String(n).indexOf(raw) !== 0) continue; }
          else if (f && sKey(i).indexOf(f) < 0) continue;
          hits.push(n);
        }
        q('#qr-cnt').textContent = pick
          ? SYFS.t('{0} سورة · {1} متوفّرة عند هذا القارئ', hits.length, av ? av.length : 114)
          : SYFS.t('{0} سورة — اختر قارئاً أولاً من تبويب «القرّاء»', hits.length);
        if (!hits.length) { listEl.appendChild(h('<div class="syf-empty">لا سورة بهذا الاسم أو الرقم.</div>')); return; }
        hits.forEach(function (n) { listEl.appendChild(surahRow(n, !!(av && av.indexOf(n) < 0))); });
      }

      /* The queue. Rows carry their own order controls rather than being dragged:
         drag-and-drop inside a 320px overlay on someone else's page fights the
         page's own pointer handling, and ↑/↓ is unambiguous on a touchpad. */
      function renderPlaylist() {
        var av = availSet();
        listEl.textContent = '';
        q('#qr-cnt').textContent = plist.length
          ? (SYFS.t('{0} سورة في القائمة', plist.length) + (pli >= 0 ? ' · ' + SYFS.t('تُشغَّل الآن') : ''))
          : '';
        q('#qr-pplay').disabled = !plist.length;
        q('#qr-pclear').disabled = !plist.length;
        if (!plist.length) {
          listEl.appendChild(h('<div class="syf-empty">القائمة فارغة — أضف سوراً بزرّ + من تبويب «السور».</div>'));
          return;
        }
        plist.forEach(function (n, i) {
          var off = !!(av && av.indexOf(n) < 0);
          var wrap = h('<div class="syf-q-row">' +
            '<button class="syf-q-mv" type="button" title="لأعلى"></button>' +
            '<button class="syf-q-mv" type="button" title="لأسفل"></button>' +
            '<button class="syf-q-add" type="button" title="أزل من القائمة"></button>' +
            '<button class="syf-q-srow" type="button"><i></i><b></b><em></em></button></div>');
          var btns = wrap.querySelectorAll('button');
          var up = btns[0], dn = btns[1], rm = btns[2], row = btns[3];
          ico(up, 'up', IC.up); ico(dn, 'down', IC.down); ico(rm, 'minus', IC.minus);
          up.disabled = (i === 0);
          dn.disabled = (i === plist.length - 1);
          row.querySelector('i').textContent = String(n);
          row.querySelector('b').textContent = sName(n);
          row.querySelector('em').textContent = off ? SYFS.t('غير متوفّرة') : '';
          if (off) row.classList.add('off');           /* NOT disabled: it is still removable, and tapping it says why */
          if (i === pli) { wrap.classList.add('on'); row.setAttribute('aria-current', 'true'); }
          up.addEventListener('click', function () { moveList(i, -1); });
          dn.addEventListener('click', function () { moveList(i, 1); });
          rm.addEventListener('click', function () { toggleList(n); });
          row.addEventListener('click', function () { play(n, i); });
          listEl.appendChild(wrap);
        });
      }

      /* ---- selection & playback --------------------------------------------- */
      function choose(r, fromTap) {
        pick = r;
        var sel = q('#qr-moshaf');
        sel.textContent = '';
        r.moshaf.forEach(function (m, i) {
          var o = document.createElement('option');
          o.value = String(i);
          o.textContent = SYFS.t('{0} — {1} سورة', m.name || SYFS.t('رواية'), m.list.length);   /* remote string */
          sel.appendChild(o);
        });
        q('#qr-mrow').style.display = (r.moshaf.length > 1) ? '' : 'none';
        show('');
        renderList();
        if (!fromTap) return;
        /* tapping a reciter WHILE something is playing means "same surah, this
           voice" — anything else would make the user re-pick the surah to do the
           one thing they obviously wanted. Otherwise: hand them the surah list. */
        if (playing) play(curSurah);
        else { q('#qr-find').value = ''; setTab('s'); }
      }

      /* `li` is the queue row this came from, or undefined for a loose surah — it
         is what tells the worker whether «التالية» follows the queue or the mushaf. */
      function play(n, li) {
        if (!pick) { show('اختر قارئاً من تبويب «القرّاء» أولاً'); setTab('r'); return; }
        var m = curM();
        n = n || curSurah;
        if (!okSurah(n)) return;                        /* an integer 1..114, or nothing is sent */
        if (m.list.indexOf(n) < 0) { show(SYFS.t('«{0}» غير متوفّرة عند هذا القارئ في هذه الرواية', sName(n))); return; }
        curSurah = n;
        show('');
        send({ op: 'play', rid: pick.id, mid: m.id, server: m.server, surah: n, li: li,
               rname: pick.name, mname: m.name, avail: m.list }).then(function (r) {
          if (!r.ok) show('تعذّر بدء التشغيل');
          return pull();
        });
        renderList();
      }
      /* «تشغيل القائمة» starts at the first row this reciter actually carries —
         starting at row 0 and failing would be the partial-moshaf 404 again. */
      function playList() {
        var av = availSet();
        for (var i = 0; i < plist.length; i++) {
          if (!av || av.indexOf(plist[i]) >= 0) { play(plist[i], i); return; }
        }
        show('لا سورة في القائمة متوفّرة عند هذا القارئ');
      }

      /* ---- the seek bar -----------------------------------------------------
       * The fill grows from the READING START and the drag is measured from the same
       * edge — see seekOffset. Both offsets are LOGICAL (`inset-inline-start`), which
       * is correct here and would be a bug inside .syfs-rail, where `direction: ltr`
       * is a layout mechanism rather than a reading order (rail.css line 34). */
      function frac(ev) {
        var r = bar.getBoundingClientRect();
        if (!r.width) return 0;
        return Math.max(0, Math.min(1, seekOffset(bar, r, ev.clientX) / r.width));
      }
      function paintBar(pos, dur, buf) {
        var p = dur ? Math.max(0, Math.min(1, pos / dur)) : 0;
        var b = dur ? Math.max(0, Math.min(1, buf / dur)) : 0;
        q('#qr-fill').style.width = (p * 100) + '%';
        q('#qr-buf').style.width = (b * 100) + '%';
        q('#qr-knob').style.insetInlineStart = (p * 100) + '%';
        q('#qr-pos').textContent = hms(pos);
        q('#qr-dur').textContent = hms(dur);
        bar.setAttribute('aria-valuemax', String(Math.round(dur || 0)));
        bar.setAttribute('aria-valuenow', String(Math.round(Math.min(pos || 0, dur || 0))));
        bar.setAttribute('aria-valuetext', SYFS.t('{0} من {1}', hms(pos), hms(dur)));
        bar.setAttribute('aria-disabled', String(!dur));
      }
      bar.addEventListener('pointerdown', function (ev) {
        if (!lastDur) return;
        drag = frac(ev);
        bar.classList.add('live');
        try { bar.setPointerCapture(ev.pointerId); } catch (e) {}
        paintBar(drag * lastDur, lastDur, lastBuf);
        ev.preventDefault();
      });
      bar.addEventListener('pointermove', function (ev) {
        if (drag === null) return;
        drag = frac(ev);
        paintBar(drag * lastDur, lastDur, lastBuf);
      });
      function endDrag() {
        if (drag === null) return;
        var t = drag * lastDur;
        drag = null;
        bar.classList.remove('live');
        send({ op: 'seek', t: t }).then(pull);
      }
      bar.addEventListener('pointerup', endDrag);
      bar.addEventListener('pointercancel', function () { drag = null; bar.classList.remove('live'); });

      function ltr() {
        try { return getComputedStyle(bar).direction === 'ltr'; } catch (e) { return false; }
      }
      function nudge(d) {
        if (!lastDur) return;
        send({ op: 'seek', t: Math.max(0, Math.min(lastDur, lastPos + d)) }).then(pull);
      }

      /* ---- volume ------------------------------------------------------------ */
      var volT = 0;
      function paintVol() {
        if (focused() !== q('#qr-vol')) q('#qr-vol').value = String(Math.round(vol * 100));
        ico(q('#qr-mute'), vol > 0 ? 'v' : 'm', vol > 0 ? IC.vol : IC.mute);
        q('#qr-mute').classList.toggle('on', vol === 0);
        q('#qr-mute').setAttribute('aria-pressed', String(vol === 0));
      }
      function setVol(v, quiet) {
        vol = Math.max(0, Math.min(1, Math.round(v * 100) / 100));
        paintVol();
        if (quiet) return;
        /* dragging a slider fires `input` per pixel; one message per pixel would be
           ~60 round-trips a second to the worker for a value only the last of which
           matters. The UI is already live — only the delivery is coalesced. */
        clearTimeout(volT);
        volT = setTimeout(function () { volT = 0; send({ op: 'vol', v: vol }); }, 80);
      }

      /* ---- state: the worker is the truth, this window only mirrors it ---- */
      function has0(s) { return !!(s.rname && okSurah(s.surah)); }
      /* one switch, two signals that must not drift: the class CSS draws, the state
         a screen reader announces */
      function press(el, on) { el.classList.toggle('on', on); el.setAttribute('aria-pressed', String(on)); }
      function paint(r) {
        if (!r || !r.ok) return;
        var s = r.s, live = r.live || {}, sl = r.sleep || {};
        playing = !!live.playing;
        lastDur = live.dur || 0;
        lastBuf = live.buf || 0;
        lastPos = live.pos || 0;

        /* the worker advances the queue on its own as each surah ends, so the
           mirror can go stale while nobody touched anything here */
        var moved = syncList(s);
        /* the highlight follows the surah too, not only the queue index: with the
           queue untouched, auto-advance still moves which row is «الآن» */
        if (has0(s) && s.surah !== curSurah) { curSurah = s.surah; moved = true; }
        if (moved && tab !== 'r') renderList();

        /* the radio (tool «إذاعة القرآن») shares this one <audio>, so while a
           station is on the card says so instead of showing a surah that is not
           playing. A third state: not idle, not a surah. Nothing positional
           applies — no bar, no times, no next, no rate — so each is switched
           off here rather than left to paint zeros. */
        onRadio = !!s.radio;
        var has = onRadio || has0(s);
        q('#qr-card').classList.toggle('idle', !has);
        q('#qr-card').classList.toggle('radio', onRadio);
        ui.classList.toggle('radio', onRadio);
        if (onRadio) {
          ico(q('#qr-num'), 'radio', IC.radio);
          /* i18n-dyn: the station's name, as the list spells it */
          q('#qr-title').textContent = s.rdname || SYFS.t('إذاعة القرآن');
          q('#qr-sub').textContent = SYFS.t('بثّ مباشر — من أداة «إذاعة القرآن»');
        } else {
          q('#qr-num').removeAttribute('data-ic');           /* see the mini player */
          q('#qr-num').textContent = has ? String(s.surah) : '—';
          q('#qr-title').textContent = has ? sName(s.surah) : SYFS.t('لم تبدأ التلاوة بعد');
          q('#qr-sub').textContent = has
            ? (s.rname + (s.mname ? (' · ' + s.mname) : '') + (s.li >= 0 ? ' · ' + SYFS.t('القائمة {0}/{1}', s.li + 1, plist.length) : ''))
            : SYFS.t('اختر قارئاً ثم سورة');
        }
        /* «استئناف» only when there IS something to resume and nothing is running:
           a remembered reciter plus a stored position and a silent player — or a
           silent radio, which «resumes» by reconnecting */
        q('#qr-resume').style.display = (onRadio ? (!playing && !live.loading) : (has && !playing && !live.dur && s.server)) ? '' : 'none';

        var tk = live.loading ? 'busy' : (playing ? 'pause' : 'play');
        ico(q('#qr-toggle'), tk, live.loading ? IC.busy : (playing ? IC.pause : IC.play));
        q('#qr-toggle').classList.toggle('busy', !!live.loading);
        q('#qr-toggle').setAttribute('aria-label', playLabel(!!live.loading, playing));
        bar.classList.toggle('off', !lastDur);
        if (drag === null) paintBar(lastPos, lastDur, lastBuf);
        q('#qr-stop').disabled = !has;
        q('#qr-prev').disabled = !has || onRadio;
        q('#qr-next').disabled = !has || onRadio;
        q('#qr-rate').disabled = onRadio;
        q('#qr-rep').disabled = onRadio;
        q('#qr-auto').disabled = onRadio;

        if (live.error) show(onRadio ? 'تعذّر الاتصال بالإذاعة — تحقّق من الاتصال ثم اضغط «استئناف»'
                                     : 'تعذّر تحميل التلاوة — تحقّق من الاتصال، أو جرّب رواية أخرى', true);
        else if (stEl.dataset.err) show('');            /* recovered: the error goes with the cause */
        press(q('#qr-rep'), !!s.repeat);
        press(q('#qr-auto'), !!s.auto);
        if (focused() !== q('#qr-rate')) q('#qr-rate').value = String(s.rate || 1);
        if (focused() !== q('#qr-vol') && !volT) {
          vol = (typeof s.vol === 'number') ? s.vol : 1;
          paintVol();
        }
        /* sleep timer: the worker sends what is LEFT, never an absolute moment */
        var on = !!(sl.left || sl.end);
        q('#qr-tm').classList.toggle('on', on);
        q('#qr-tmv').textContent = sl.end ? SYFS.t('السورة') : (sl.left ? hms(sl.left / 1000) : '');
      }
      function pull() { return send({ op: 'state' }).then(paint); }

      /* the same self-clearing interval the other live tools use: when the window is
         gone the element is detached, and the poll stops with it. It also SLOWS to
         2s when nothing is playing — a silent player has nothing to redraw 85 times
         a minute, and this runs on someone else's page. */
      var iv = null;
      function beat(ms) {
        if (iv) clearInterval(iv);
        iv = setInterval(function () {
          if (!body.isConnected) { clearInterval(iv); iv = null; return; }
          pull();
          var want = (playing || drag !== null) ? 700 : 2000;
          if (want !== ms) beat(want);
        }, ms);
      }
      beat(700);

      /* ---- wiring ------------------------------------------------------------ */
      q('#qr-find').addEventListener('input', renderList);
      q('#qr-tabs').addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-t]') : null;
        if (b) { q('#qr-find').value = ''; setTab(b.getAttribute('data-t')); }
      });
      q('#qr-moshaf').addEventListener('change', function () {
        renderList();
        if (playing) play(curSurah);
      });
      q('#qr-toggle').addEventListener('click', function () { send({ op: 'toggle' }).then(pull); });
      q('#qr-resume').addEventListener('click', function () { send({ op: 'toggle' }).then(pull); });
      q('#qr-next').addEventListener('click', function () { send({ op: 'next' }).then(pull); });
      q('#qr-prev').addEventListener('click', function () { send({ op: 'prev' }).then(pull); });
      q('#qr-stop').addEventListener('click', function () { send({ op: 'stop' }).then(pull); });
      q('#qr-rate').addEventListener('change', function () { send({ op: 'rate', r: parseFloat(q('#qr-rate').value) }).then(pull); });
      q('#qr-rep').addEventListener('click', function () {
        var on = !q('#qr-rep').classList.contains('on');
        press(q('#qr-rep'), on);
        send({ op: 'set', repeat: on });
      });
      q('#qr-auto').addEventListener('click', function () {
        var on = !q('#qr-auto').classList.contains('on');
        press(q('#qr-auto'), on);
        send({ op: 'set', auto: on });
      });
      q('#qr-vol').addEventListener('input', function () { setVol(parseInt(q('#qr-vol').value, 10) / 100); });
      q('#qr-mute').addEventListener('click', function () {
        if (vol > 0) { preMute = vol; setVol(0); } else { setVol(preMute > 0 ? preMute : 1); }
      });
      q('#qr-tm').addEventListener('click', function () {
        q('#qr-tm').setAttribute('aria-expanded', String(q('#qr-sleep').classList.toggle('open')));
      });
      q('#qr-sleep').addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-m]') : null;
        if (!b) return;
        var v = b.getAttribute('data-m');
        /* the minutes are re-checked against a whitelist IN THE WORKER; this is the
           convenience layer, not the guard */
        send(v === 'end' ? { op: 'sleep', end: true } : { op: 'sleep', min: parseInt(v, 10) || 0 }).then(pull);
        q('#qr-sleep').classList.remove('open');
        q('#qr-tm').setAttribute('aria-expanded', 'false');
      });
      q('#qr-pplay').addEventListener('click', playList);
      q('#qr-pclear').addEventListener('click', function () { pushList([]); });
      q('#qr-refresh').addEventListener('click', function () {
        q('#qr-cnt').textContent = SYFS.t('…جارٍ التحديث');
        loadCatalogue(true).then(function (list) { cat = list; renderList(); })
          .catch(function () { q('#qr-cnt').textContent = SYFS.t('تعذّر تحديث القائمة'); });
      });

      /* Keyboard. e.code, never e.key — on an Arabic layout e.key for M is «ة».
         Typing must stay typing, and Space on a focused button belongs to that
         button, so both cases bail out before anything is sent. */
      ui.addEventListener('keydown', function (e) {
        var t = e.target, tag = t && t.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        if (e.code === 'Space' && tag === 'BUTTON') return;
        switch (e.code) {
          case 'Space': e.preventDefault(); send({ op: 'toggle' }).then(pull); break;
          /* the bar fills from the READING START, so the arrow pointing away from it is
             forwards: «يسار» in Arabic, Right in English — read off the bar itself,
             like seekOffset(), so the keys and the drag agree on which edge is zero */
          case 'ArrowRight': e.preventDefault(); nudge(ltr() ? 10 : -10); break;
          case 'ArrowLeft': e.preventDefault(); nudge(ltr() ? -10 : 10); break;
          case 'ArrowUp': e.preventDefault(); setVol(vol + 0.05); break;
          case 'ArrowDown': e.preventDefault(); setVol(vol - 0.05); break;
          case 'KeyM': q('#qr-mute').click(); break;
          default: return;
        }
      });

      paintVol();
      /* preventScroll: focusing an overlay must never move someone else's page */
      try { ui.focus({ preventScroll: true }); } catch (e) {}
      /* ids only, and re-filtered on the way IN: storage is not a trusted source
         just because we wrote it — an integer list is all this key may ever be */
      Promise.all([store.get(FAV_KEY, []), store.get(SFAV_KEY, [])]).then(function (v) {
        favs = Array.isArray(v[0]) ? v[0].filter(function (n) {
          return typeof n === 'number' && isFinite(n) && n > 0 && n < 1e6 && n === Math.round(n);
        }).slice(0, 500) : [];
        /* surah ids have a hard, known range — anything outside 1..114 is not a
           surah, so it is dropped rather than clamped into one */
        sfavs = Array.isArray(v[1]) ? v[1].filter(function (n) {
          return typeof n === 'number' && n >= 1 && n <= 114 && n === Math.round(n);
        }) : [];
        sfavs = sfavs.filter(function (n, i) { return sfavs.indexOf(n) === i; })
                     .sort(function (a, b) { return a - b; });
        return loadCatalogue(false);
      }).then(function (list) {
        cat = list;
        renderList();
        return pull();
      }).then(function () {
        /* pre-select whatever is already playing, so reopening the window lands on it */
        return send({ op: 'state' }).then(function (r) {
          if (!r.ok) return;
          curSurah = okSurah(r.s.surah) ? r.s.surah : 1;
          syncList(r.s);
          if (typeof r.s.vol === 'number') setVol(r.s.vol, true);
          if (!r.s.rid) return;
          var found = cat.filter(function (x) { return x.id === r.s.rid; })[0];
          if (found) { choose(found, false); q('#qr-find').value = ''; }
        });
      }).catch(function () {
        q('#qr-cnt').textContent = '';
        listEl.textContent = '';
        listEl.appendChild(h('<div class="syf-empty">تعذّر جلب قائمة القرّاء. تحقّق من الاتصال.</div>'));
        var btn = h('<button class="syf-mini" style="margin:6px auto;display:block">إعادة المحاولة</button>');
        btn.addEventListener('click', function () {
          q('#qr-cnt').textContent = SYFS.t('…جارٍ المحاولة');
          loadCatalogue(true).then(function (list) { cat = list; renderList(); })
            .catch(function () { q('#qr-cnt').textContent = SYFS.t('ما زال التحميل متعذّراً'); });
        });
        listEl.appendChild(btn);
      });
    }
  });

  /* ===== إذاعة القرآن — live streams ==========================================
   * A second tool over the SAME worker and the same offscreen <audio>: tuning in
   * stops the recitation and playing a surah stops the station, and both windows
   * say which of the two is on. Two sources: three real broadcasts, built into
   * the worker and asked for BY ID (this file never says where a station is), and
   * mp3quran's radio catalogue — reciters on a loop, all on qurango.net — whose
   * URLs do travel to the worker and are refused there unless they are exactly
   * that (qSafeStream). Nothing here is seekable: a stream has no length. */
  var RADIO_API = 'https://mp3quran.net/api/v3/radios?language=ar';
  var RADIO_CAT_KEY = 'quran_radios', RADIO_FAV_KEY = 'qradio_fav';
  /* i18n-dyn: station names are proper nouns and stay Arabic in every language */
  var STATIONS = [
    { id: 'sa', name: 'إذاعة القرآن الكريم', sub: 'الرياض · السعودية' },
    { id: 'eg', name: 'إذاعة القرآن الكريم', sub: 'القاهرة · مصر' },
    { id: 'mk', name: 'إذاعة الحرم المكي', sub: 'المسجد الحرام · مكة المكرّمة' }
  ];
  /* the SAME lock the worker applies, applied first: a row that the worker would
     refuse is a row that can only fail when tapped, so it is not built at all */
  function shapeRadios(json) {
    var out = [], seen = {};
    var arr = (json && Array.isArray(json.radios)) ? json.radios : [];
    arr.forEach(function (r) {
      var name = typeof r.name === 'string' ? r.name.trim() : '';
      var url = typeof r.url === 'string' ? r.url.trim() : '';
      if (!name || !/^https:\/\/([a-z0-9-]+\.)*qurango\.net\/[A-Za-z0-9_\/.-]+$/.test(url)) return;
      if (hidden(name) || hidden(url)) return;                 /* hidden reciters (v0.140.1) */
      if (seen[url]) return;
      seen[url] = 1;
      out.push({ name: name, url: url });
    });
    return out;
  }
  function loadRadios(force) {
    return store.get(RADIO_CAT_KEY, null).then(function (c) {
      var fresh = c && typeof c === 'object' && Array.isArray(c.r) && c.r.length
        && typeof c.t === 'number' && (Date.now() - c.t) < CAT_TTL;
      if (fresh && !force) return shapeRadios({ radios: c.r });   /* re-filtered on the way OUT too */
      return bgFetch(RADIO_API).then(function (res) {
        if (!res || !res.ok || !res.body) throw new Error('fetch');
        var list = shapeRadios(JSON.parse(res.body));
        if (!list.length) throw new Error('empty');
        store.set(RADIO_CAT_KEY, { t: Date.now(), r: list });
        return list;
      }).catch(function (e) {
        if (c && Array.isArray(c.r) && c.r.length) return shapeRadios({ radios: c.r });
        throw e;
      });
    });
  }

  SYFS.tools.push({
    id: 'qradio', name: 'إذاعة القرآن', cat: 'islam',
    icon: IC.radio,
    mount: function (body) {
      var ui = h(
        '<div class="syf-q syf-qr" tabindex="-1">' +
          '<div class="syf-q-card idle radio" id="rd-card">' +
            '<div class="syf-q-head">' +
              '<span class="syf-q-num" id="rd-ic">' + IC.radio + '</span>' +
              '<div class="syf-q-meta"><b id="rd-title">لم يبدأ البثّ بعد</b><span id="rd-sub">اختر إذاعة من القائمة</span></div>' +
              '<i class="syf-q-live" id="rd-live"><em></em>مباشر</i>' +
            '</div>' +
            '<div class="syf-q-tr">' +
              '<button class="syf-q-main" id="rd-toggle" type="button" title="تشغيل / إيقاف مؤقّت (مسافة)">' + IC.play + '</button>' +
              '<button class="syf-q-tb" id="rd-stop" type="button" title="إيقاف تام">' + IC.stop + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="syf-q-sec">' +
            '<button class="syf-q-ib" id="rd-mute" type="button" title="كتم (M)" aria-pressed="false">' + IC.vol + '</button>' +
            '<input type="range" class="syf-q-vol" id="rd-vol" min="0" max="100" value="100" title="مستوى الصوت" aria-label="مستوى الصوت">' +
            '<button class="syf-q-ib syf-q-timer" id="rd-tm" type="button" title="مؤقّت النوم" aria-expanded="false" aria-controls="rd-sleep">' + IC.timer + '<b id="rd-tmv"></b></button>' +
          '</div>' +
          '<div class="syf-q-sleep" id="rd-sleep">' +
            '<button class="syf-q-chip" type="button" data-m="15">١٥ دقيقة</button>' +
            '<button class="syf-q-chip" type="button" data-m="30">٣٠ دقيقة</button>' +
            '<button class="syf-q-chip" type="button" data-m="45">٤٥ دقيقة</button>' +
            '<button class="syf-q-chip" type="button" data-m="60">٦٠ دقيقة</button>' +
            '<button class="syf-q-chip" type="button" data-m="0">إلغاء</button>' +
          '</div>' +
          '<div class="syf-row">' +
            '<input class="syf-in" id="rd-find" placeholder="ابحث عن إذاعة أو قارئ…" style="flex:1">' +
            '<button class="syf-q-ib" id="rd-refresh" type="button" title="تحديث قائمة الإذاعات">' + IC.fresh + '</button>' +
          '</div>' +
          '<div class="syf-note-hint" id="rd-cnt">…جارٍ تحميل قائمة الإذاعات</div>' +
          '<div class="syf-q-list" id="rd-list"></div>' +
          '<div class="syf-empty" id="rd-st" role="status" aria-live="polite"></div>' +
          '<div class="syf-note-hint">البثّ يستمر وأنت تتنقّل بين الصفحات — يوقفه زرّ الإيقاف وحده. تشغيل إذاعة يوقف التلاوة الجارية في مشغّل القرآن، والعكس.</div>' +
        '</div>'
      );
      body.appendChild(ui);
      var q = function (s) { return ui.querySelector(s); };
      var listEl = q('#rd-list'), stEl = q('#rd-st');
      var cat = [], favs = [], cur = { id: '', url: '' }, playing = false, onRadio = false;
      var vol = 1, preMute = 1, volT = 0;

      /* same contract as the player's: an `err` message is the worker's to take down */
      function show(t, err) {
        stEl.textContent = t ? SYFS.t(t) : '';
        if (t && err) stEl.dataset.err = '1'; else delete stEl.dataset.err;
      }
      function ico(el, key, svg) {
        if (el.getAttribute('data-ic') === key) return;
        el.setAttribute('data-ic', key);
        el.textContent = '';
        el.appendChild(h(svg));
      }
      function focused() {
        var root = ui.getRootNode ? ui.getRootNode() : null;
        return (root && root.activeElement) || document.activeElement;
      }
      /* a favourite is a KEY: «id:sa» for a built-in, the URL for a catalogue
         station — and both shapes are re-checked on the way in from storage */
      function keyOf(st) { return st.id ? ('id:' + st.id) : st.url; }
      function goodKey(k) { return /^id:[a-z]{2}$/.test(k) || /^https:\/\/([a-z0-9-]+\.)*qurango\.net\/[A-Za-z0-9_\/.-]+$/.test(k); }
      function isFav(st) { return favs.indexOf(keyOf(st)) >= 0; }
      function toggleFav(st) {
        var k = keyOf(st), i = favs.indexOf(k);
        if (i >= 0) favs.splice(i, 1); else favs.push(k);
        store.set(RADIO_FAV_KEY, favs);
        render();
      }
      function isCur(st) { return onRadio && (st.id ? cur.id === st.id : cur.url === st.url); }

      function tune(st) {
        show('');
        var m = { op: 'radio', name: SYFS.t(st.name) + (st.sub ? (' — ' + SYFS.t(st.sub)) : '') };
        if (st.id) m.id = st.id; else m.url = st.url;
        send(m).then(function (r) {
          if (!r.ok) show('تعذّر الاتصال بالإذاعة');
          return pull();
        });
      }
      function row(st) {
        var el = h('<div class="syf-q-row"><button class="syf-q-star" type="button" title="مفضّلة"></button>' +
                   '<button class="syf-q-pick" type="button"><b></b><span></span></button></div>');
        var star = el.querySelector('.syf-q-star'), btn = el.querySelector('.syf-q-pick');
        ico(star, 'star', IC.star);
        if (isFav(st)) star.classList.add('on');
        star.setAttribute('aria-pressed', String(isFav(st)));
        /* built-ins carry msgids (a proper noun may still have an English form);
           catalogue names pass through t() untouched — no entry, same string */
        btn.querySelector('b').textContent = SYFS.t(st.name);
        btn.querySelector('span').textContent = st.sub ? SYFS.t(st.sub) : SYFS.t('تلاوة متواصلة · mp3quran');
        if (isCur(st)) { el.classList.add('on'); btn.setAttribute('aria-current', 'true'); }
        star.addEventListener('click', function () { toggleFav(st); });
        btn.addEventListener('click', function () { tune(st); });
        return el;
      }
      function head(text) {
        var g = h('<div class="syf-q-gh"><b></b></div>');
        g.querySelector('b').textContent = SYFS.t(text);
        return g;
      }
      function render() {
        var top = listEl.scrollTop;
        var f = norm(q('#rd-find').value);
        var hit = function (st) { return !f || norm(st.name + ' ' + SYFS.t(st.name) + ' ' + (st.sub ? (st.sub + ' ' + SYFS.t(st.sub)) : '')).indexOf(f) >= 0; };
        var live = STATIONS.filter(hit), loops = cat.filter(hit);
        var fv = live.concat(loops).filter(isFav);
        listEl.textContent = '';
        q('#rd-cnt').textContent = f ? SYFS.t('{0} من {1} إذاعة', live.length + loops.length, STATIONS.length + cat.length)
                                     : SYFS.t('{0} إذاعة — اختر واحدة', STATIONS.length + cat.length);
        if (fv.length) { listEl.appendChild(head('المفضّلة')); fv.forEach(function (st) { listEl.appendChild(row(st)); }); }
        if (live.length) { listEl.appendChild(head('إذاعات مباشرة')); live.forEach(function (st) { listEl.appendChild(row(st)); }); }
        if (loops.length) {
          listEl.appendChild(head('إذاعات القرّاء'));
          loops.slice(0, 80).forEach(function (st) { listEl.appendChild(row(st)); });
          if (loops.length > 80) listEl.appendChild(h('<div class="syf-note-hint" style="text-align:center">…واصل الكتابة لتضييق النتائج</div>'));
        }
        if (!live.length && !loops.length) listEl.appendChild(h('<div class="syf-empty">لا إذاعة بهذا الاسم.</div>'));
        if (top) listEl.scrollTop = top;
      }

      /* ---- volume (same coalescing as the player) ---- */
      function paintVol() {
        if (focused() !== q('#rd-vol')) q('#rd-vol').value = String(Math.round(vol * 100));
        ico(q('#rd-mute'), vol > 0 ? 'v' : 'm', vol > 0 ? IC.vol : IC.mute);
        q('#rd-mute').classList.toggle('on', vol === 0);
        q('#rd-mute').setAttribute('aria-pressed', String(vol === 0));
      }
      function setVol(v, quiet) {
        vol = Math.max(0, Math.min(1, Math.round(v * 100) / 100));
        paintVol();
        if (quiet) return;
        clearTimeout(volT);
        volT = setTimeout(function () { volT = 0; send({ op: 'vol', v: vol }); }, 80);
      }

      /* ---- state: the worker is the truth ---- */
      function paint(r) {
        if (!r || !r.ok) return;
        var s = r.s, live = r.live || {}, sl = r.sleep || {};
        playing = !!live.playing;
        var was = onRadio, wasId = cur.id, wasUrl = cur.url;
        onRadio = !!s.radio;
        cur = { id: s.rdid || '', url: s.radio || '' };
        if (was !== onRadio || wasId !== cur.id || wasUrl !== cur.url) render();

        q('#rd-card').classList.toggle('idle', !onRadio);
        /* i18n-dyn: the station's name, as the list spells it */
        q('#rd-title').textContent = onRadio ? (s.rdname || SYFS.t('إذاعة القرآن')) : SYFS.t('لم يبدأ البثّ بعد');
        q('#rd-sub').textContent = onRadio
          ? (live.loading ? SYFS.t('…جارٍ الاتصال') : (playing ? SYFS.t('بثّ مباشر') : SYFS.t('متوقّف — اضغط تشغيل للعودة إلى البثّ')))
          : SYFS.t('اختر إذاعة من القائمة');
        q('#rd-live').classList.toggle('on', onRadio && playing && !live.loading);
        var tk = live.loading ? 'busy' : (playing ? 'pause' : 'play');
        ico(q('#rd-toggle'), tk, live.loading ? IC.busy : (playing ? IC.pause : IC.play));
        q('#rd-toggle').classList.toggle('busy', !!live.loading);
        q('#rd-toggle').setAttribute('aria-label', playLabel(!!live.loading, playing));
        /* a surah playing in the other window: this transport must not pause it
           by accident — the button is for the station, and there is none */
        q('#rd-toggle').disabled = !onRadio;
        q('#rd-stop').disabled = !onRadio;
        if (live.error && onRadio) show('تعذّر الاتصال بالإذاعة — تحقّق من الاتصال ثم اضغط تشغيل', true);
        else if (stEl.dataset.err) show('');            /* back on air, or stopped: the error is stale */
        if (focused() !== q('#rd-vol') && !volT) {
          vol = (typeof s.vol === 'number') ? s.vol : 1;
          paintVol();
        }
        var on = !!(sl.left || sl.end);
        q('#rd-tm').classList.toggle('on', on);
        q('#rd-tmv').textContent = sl.left ? hms(sl.left / 1000) : '';
      }
      function pull() { return send({ op: 'state' }).then(paint); }
      var iv = null;
      function beat(ms) {
        if (iv) clearInterval(iv);
        iv = setInterval(function () {
          if (!body.isConnected) { clearInterval(iv); iv = null; return; }
          pull();
          var want = playing ? 700 : 2000;
          if (want !== ms) beat(want);
        }, ms);
      }
      beat(700);

      /* ---- wiring ---- */
      q('#rd-find').addEventListener('input', render);
      q('#rd-toggle').addEventListener('click', function () { show(''); send({ op: 'toggle' }).then(pull); });
      q('#rd-stop').addEventListener('click', function () { send({ op: 'stop' }).then(pull); });
      q('#rd-vol').addEventListener('input', function () { setVol(parseInt(q('#rd-vol').value, 10) / 100); });
      q('#rd-mute').addEventListener('click', function () {
        if (vol > 0) { preMute = vol; setVol(0); } else { setVol(preMute > 0 ? preMute : 1); }
      });
      q('#rd-tm').addEventListener('click', function () {
        q('#rd-tm').setAttribute('aria-expanded', String(q('#rd-sleep').classList.toggle('open')));
      });
      q('#rd-sleep').addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-m]') : null;
        if (!b) return;
        send({ op: 'sleep', min: parseInt(b.getAttribute('data-m'), 10) || 0 }).then(pull);
        q('#rd-sleep').classList.remove('open');
        q('#rd-tm').setAttribute('aria-expanded', 'false');
      });
      q('#rd-refresh').addEventListener('click', function () {
        q('#rd-cnt').textContent = SYFS.t('…جارٍ التحديث');
        loadRadios(true).then(function (list) { cat = list; render(); })
          .catch(function () { q('#rd-cnt').textContent = SYFS.t('تعذّر تحديث القائمة'); });
      });
      ui.addEventListener('keydown', function (e) {
        var t = e.target, tag = t && t.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        if (e.code === 'Space' && tag === 'BUTTON') return;
        switch (e.code) {
          case 'Space': e.preventDefault(); if (onRadio) send({ op: 'toggle' }).then(pull); break;
          case 'ArrowUp': e.preventDefault(); setVol(vol + 0.05); break;
          case 'ArrowDown': e.preventDefault(); setVol(vol - 0.05); break;
          case 'KeyM': q('#rd-mute').click(); break;
          default: return;
        }
      });

      paintVol();
      try { ui.focus({ preventScroll: true }); } catch (e) {}
      store.get(RADIO_FAV_KEY, []).then(function (v) {
        favs = Array.isArray(v) ? v.filter(function (k) { return typeof k === 'string' && k.length < 200 && goodKey(k); }).slice(0, 200) : [];
        render();                                   /* the three built-ins need no network */
        return loadRadios(false);
      }).then(function (list) {
        cat = list;
        render();
        return pull();
      }).catch(function () {
        q('#rd-cnt').textContent = SYFS.t('تعذّر جلب إذاعات القرّاء — الإذاعات المباشرة متاحة');
        render();
        pull();
      });
    }
  });
}());
