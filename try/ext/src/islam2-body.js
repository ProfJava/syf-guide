/* SYF — the tool BODIES of src/islam2.js, injected on demand (v0.139.5).
 *
 * Split out of src/islam2.js so the eager content-script bundle stops parsing them on
 * every page. background.js → LAZY_TOOL_FILES injects this file the first time the user
 * opens the rail's tools (src/rail.js → ensureTools); extension pages (app/word/…) load it
 * with a <script> right after its eager half.
 *
 * ⛔ Everything that must run at PAGE LOAD stays in src/islam2.js (listeners, boots,
 *    the APIs other files call). This file only REGISTERS tools; nothing here may run
 *    before a tool is mounted. The helpers it shares with the eager half come from
 *    `SYFS._islam`, set there — the aliases below are read once, so a helper must never
 *    be REASSIGNED in the eager half (tools/perf-split-test.js checks the contract). */
(function () {
  window.SYFS = window.SYFS || {};
  var P = SYFS._islam || {};
  var store = P.store, bgFetch = P.bgFetch, wirdGet = P.wirdGet, wirdSet = P.wirdSet, h = P.h, send = P.send, showToast = P.showToast, AYAT = P.AYAT, AZ = P.AZ, AZKAR = P.AZKAR, azLists = P.azLists, PRAYERS = P.PRAYERS, ikNorm = P.ikNorm, azPlay = P.azPlay, clockStr = P.clockStr, QURAN_PAGES = P.QURAN_PAGES;

  /* ===== الأذكار › «الإعدادات» (v0.178.x — was the «الأذكار» tab of the standalone
   * «إعدادات التنبيهات» tool, id `ithkar`, removed at the user's request: «اجعل الإعدادات
   * مع التولز الخاص به»). The athkar goals, the periodic dhikr and the dhikr voice live
   * in the athkar tool now; the prayer half went to the prayer tool's «⚙️ الإعدادات» tab
   * (src/tools2-body.js). The STORAGE did not move: same `ithkar` key, same shape, same
   * worker. Every control saves ON THE SPOT through SYFS.ithkar.save (read → merge →
   * norm → write → apply), so a field the other tool owns is never overwritten, and the
   * tab re-fills from storage.onChanged when the prayer tool saves. */
  /* `note` — a correction the panel made to what was typed (a clamped number, a prayer
     list that was empty) — leads the line, so «حُفظ ✓» never hides that the saved value
     is not the typed one */
  function ikSaid(st) {
    return function (r, note) {
      if (!st.isConnected) return;
      st.textContent = (note ? note + ' · ' : '') + (r && r.ok ? (r.next ? SYFS.t('حُفظ ✓ — {0}', r.next) : SYFS.t('حُفظ ✓')) : SYFS.t('حُفظ محلياً، وتعذّر تفعيل الجدولة'));
    };
  }
  /* ONE storage.onChanged listener per mounted panel, and it leaves with the panel.
     SYFS.tabs replaces the tab's node on every switch, and a listener that only went
     quiet (`!ui.isConnected → return`) stayed registered for the life of the page,
     holding its detached tree: ten switches, ten listeners woken by every write. */
  function onStore(ui, fn) {
    try {
      chrome.storage.onChanged.addListener(function on(ch, area) {
        if (!ui.isConnected) { chrome.storage.onChanged.removeListener(on); return; }
        if (area === 'local') fn(ch);
      });
    } catch (e) {}
  }
  /* fills the tab now and again whenever `ithkar` changes (this tab or the prayer tool) */
  function ikFollow(ui, fill, also) {
    store.get('ithkar', null).then(function (s) { if (ui.isConnected) fill(ikNorm(s)); });
    onStore(ui, function (ch) {
      if (ch.ithkar) fill(ikNorm(ch.ithkar.newValue));
      if (also) also(ch);
    });
  }
  function mountAzkarSet(panel) {
    var ui = h(
      '<div class="syf-form">' +
        '<div class="syf-ikc">' +
          '<div class="syf-ikc-h"><span>أهداف الأذكار</span></div>' +
          '<div class="syf-note-hint" style="margin:0">يظهر الذكر الأول في وقته ويعود حتى تضغط «✓ قرأته»، وعندها يأتي الذي بعده.</div>' +
          '<div class="syf-row syf-ikc-r"><label class="syf-ck" style="flex:1"><input type="checkbox" id="ik-sb"> <span>أذكار الصباح</span></label><select class="syf-in" id="ik-sbm" style="width:118px" aria-label="موعد أذكار الصباح"><option value="fajr">بعد الفجر</option><option value="clock">ساعة محددة</option></select><input type="time" class="syf-in" id="ik-sbt" style="width:100px" aria-label="ساعة أذكار الصباح"></div>' +
          '<div class="syf-row syf-ikc-r"><label class="syf-ck" style="flex:1"><input type="checkbox" id="ik-ms"> <span>أذكار المساء</span></label><select class="syf-in" id="ik-msm" style="width:118px" aria-label="موعد أذكار المساء"><option value="asr">بعد العصر</option><option value="clock">ساعة محددة</option></select><input type="time" class="syf-in" id="ik-mst" style="width:100px" aria-label="ساعة أذكار المساء"></div>' +
          '<div class="syf-note-hint" id="ik-late" style="margin:0" hidden>النافذة التي تبدأ بعد الساعة 20:00 تنتهي عند منتصف الليل.</div>' +
          '<div class="syf-row" style="align-items:center"><label style="margin:0;flex:1" for="ik-ge">يعود التنبيه بالذكر نفسه كل</label><select class="syf-in" id="ik-ge" style="width:118px"><option value="1">دقيقة</option><option value="3">3 دقائق</option><option value="5">5 دقائق</option><option value="10">10 دقائق</option><option value="15">15 دقيقة</option><option value="30">30 دقيقة</option><option value="60">ساعة</option><option value="0">بلا تكرار</option></select></div>' +
          '<label class="syf-ck"><input type="checkbox" id="ik-tts"> <span>🔊 تشغيل الذكر صوتياً عند ظهوره</span></label>' +
          '<div class="syf-note-hint" style="margin:0">بصوت الشيخ حامد الدريهم (حصن المسلم). يُحمَّل المقطع أول مرة ثم يُحفظ محلياً فيعمل بلا إنترنت، وأذكارك الخاصة تُقرأ بصوت المتصفّح.</div>' +
          '<div id="ik-gs" style="display:flex;flex-direction:column;gap:4px;width:100%"></div>' +
        '</div>' +
        '<div class="syf-ikc">' +
          '<div class="syf-ikc-h"><span>أذكار دورية</span><input type="checkbox" id="ik-az" aria-label="أذكار دورية على الشاشة"></div>' +
          '<div class="syf-row" style="align-items:center"><label style="margin:0;flex:1" for="ik-evn">ذكر على الشاشة كل</label><input type="number" class="syf-in" id="ik-evn" min="1" max="14400" step="1" inputmode="numeric" style="width:78px"><select class="syf-in" id="ik-evu" style="width:96px" aria-label="وحدة المدّة"><option value="1">ثانية</option><option value="60">دقيقة</option></select></div>' +
          '<div class="syf-note-hint" id="ik-evh" style="margin:0">أقلّ مدّة 30 ثانية وأكثرها 4 ساعات — 30 ثانية هي أقصر مدّة يسمح بها Chrome للتنبيهات المتكرّرة.</div>' +
          '<div class="syf-row"><label class="syf-ck" style="flex:1"><input type="checkbox" id="ik-toast"> <span>توست فوق الصفحة</span></label><label class="syf-ck" style="flex:1"><input type="checkbox" id="ik-notif"> <span>إشعار نظام</span></label></div>' +
          '<div class="syf-row"><button class="syf-mini" id="ik-test" type="button">تجربة</button></div>' +
        '</div>' +
        '<div class="syf-note-hint" id="ik-st" style="margin:0" aria-live="polite"></div>' +
      '</div>'
    );
    panel.appendChild(ui);
    var q = function (s) { return ui.querySelector(s); };
    var said = ikSaid(q('#ik-st'));
    function save(p) { return SYFS.ithkar.save(p).then(said); }
    /* a «ساعة محددة» window is 4 hours, so one opening after 20:00 would run past
       midnight — where the day's goal starts over. Said beside the field, not discovered
       at 00:01 as a sequence that stopped without a word. */
    function lateClock(sel, inp) {
      var m = /^(\d{1,2}):(\d{2})$/.exec(inp.value || '');
      return sel.value === 'clock' && !!m && (+m[1] * 60 + +m[2]) > 20 * 60;
    }
    function modeSync() {
      q('#ik-sbt').style.display = q('#ik-sbm').value === 'clock' ? '' : 'none';
      q('#ik-mst').style.display = q('#ik-msm').value === 'clock' ? '' : 'none';
      q('#ik-late').hidden = !(lateClock(q('#ik-sbm'), q('#ik-sbt')) || lateClock(q('#ik-msm'), q('#ik-mst')));
    }
    function fill(s) {
      q('#ik-sb').checked = s.sabahOn; q('#ik-sbm').value = s.sabahMode; q('#ik-sbt').value = s.sabahAt;
      q('#ik-ms').checked = s.masaaOn; q('#ik-msm').value = s.masaaMode; q('#ik-mst').value = s.masaaAt;
      q('#ik-ge').value = String(s.goalEvery); q('#ik-tts').checked = s.goalTts;
      q('#ik-az').checked = s.azkarOn; fillEvery(s.azkarSec);
      q('#ik-toast').checked = s.azkarToast; q('#ik-notif').checked = s.azkarNotif;
      modeSync();
    }
    /* the periodic interval is stored in seconds; shown in minutes when it is whole ones */
    function fillEvery(sec) {
      var m = sec % 60 === 0;
      q('#ik-evn').value = String(m ? sec / 60 : sec); q('#ik-evu').value = m ? '60' : '1';
    }
    /* clamped here, not left to ikNorm: an out-of-range value there falls back to 30 min,
       and «10 ثوانٍ» turning into half an hour reads like the field ignored the user */
    function everySec() {
      var n = parseInt(q('#ik-evn').value, 10);
      if (!(n > 0)) return null;
      return Math.min(14400, Math.max(30, n * parseInt(q('#ik-evu').value, 10)));
    }
    /* each control → the one field it owns; ikNorm (inside save) rejects a bad value */
    var MAP = {
      'ik-sb': function (el) { return { sabahOn: el.checked }; },
      'ik-sbm': function (el) { return { sabahMode: el.value }; },
      'ik-sbt': function (el) { return el.value ? { sabahAt: el.value } : null; },
      'ik-ms': function (el) { return { masaaOn: el.checked }; },
      'ik-msm': function (el) { return { masaaMode: el.value }; },
      'ik-mst': function (el) { return el.value ? { masaaAt: el.value } : null; },
      'ik-ge': function (el) { return { goalEvery: parseInt(el.value, 10) }; },
      'ik-tts': function (el) { return { goalTts: el.checked }; },
      'ik-az': function (el) { return { azkarOn: el.checked }; },
      'ik-evn': function () { var v = everySec(); if (v) fillEvery(v); return v ? { azkarSec: v } : null; },
      'ik-evu': function () { var v = everySec(); if (v) fillEvery(v); return v ? { azkarSec: v } : null; },
      'ik-toast': function (el) { return { azkarToast: el.checked }; },
      'ik-notif': function (el) { return { azkarNotif: el.checked }; }
    };
    Object.keys(MAP).forEach(function (id) {
      var el = q('#' + id);
      el.addEventListener('change', function () {
        modeSync();
        var p = MAP[id](el);
        if (p) save(p);
      });
    });

    /* where today's sequence stands — the goal lives in the worker, so this panel
       asks rather than counts, and «تصفير» is the only way back to the first dhikr */
    var gs = q('#ik-gs');
    function gstat() {
      send('SYFS_AZKAR', { op: 'status' }).then(function (r) {
        if (!r || !r.ok || !ui.isConnected) return;
        gs.innerHTML = '';
        [['s', SYFS.t('🌅 أذكار الصباح')], ['m', SYFS.t('🌙 أذكار المساء')]].forEach(function (p) {
          if (!r.on[p[0]]) return;
          var g = r.goal[p[0]], t = r.total[p[0]], w = r.win[p[0]];
          var row = h('<div class="syf-row" style="align-items:center;gap:6px"><span class="syf-note-hint" style="margin:0;flex:1"></span><button class="syf-mini" type="button">تصفير</button></div>');
          row.querySelector('span').textContent = p[1] + ': ' + SYFS.t('{0} من {1}', Math.min(g.i, t), t) +
            (g.done ? ' ✓' : (g.missed ? ' — ' + SYFS.t('فات وقتها') : ' · ' + SYFS.t('النافذة: {0} → {1}', clockStr(w.start), clockStr(w.end)))) +
            (g.streak ? ' · ' + SYFS.t('سلسلة {0} يوم 🔥', g.streak) : '');
          row.querySelector('button').addEventListener('click', function () { send('SYFS_AZKAR', { op: 'reset', kind: p[0] }).then(gstat); });
          gs.appendChild(row);
        });
      });
    }
    ikFollow(ui, function (s) { fill(s); gstat(); }, function (ch) { if (ch.azkar_goal || ch.azkar_custom) gstat(); });
    gstat();
    q('#ik-test').addEventListener('click', function () {
      send('SYFS_ITHKAR', { op: 'test' });
      showToast(SYFS.t('تجربة 🔔'), AZKAR[0]);
    });
  }

  /* Each original mount body is preserved verbatim as a named function, wired into tabs below. */

  /* آية اليوم */
  function mountAyah(body) {
    var ui = h(
      '<div class="syf-form">' +
        '<div class="syf-out" style="grid-template-columns:1fr"><div><span id="ay-ref"></span><b id="ay-txt" style="font-size:16px;line-height:1.9"></b></div></div>' +
        '<div class="syf-row"><button class="syf-mini" id="ay-copy">📋 نسخ</button><button class="syf-mini" id="ay-next">🔄 آية أخرى</button></div>' +
      '</div>'
    );
    body.appendChild(ui);
    var txt = ui.querySelector('#ay-txt'), ref = ui.querySelector('#ay-ref');
    var d0 = new Date(); d0.setHours(0, 0, 0, 0);          /* local midnight → same ayah all local day */
    var idx = Math.floor(d0.getTime() / 86400000) % AYAT.length;
    /* i18n-dyn: revelation and its citation — content, not interface (§6.97/2) */
    function render() { txt.textContent = '﴿' + AYAT[idx][0] + '﴾'; ref.textContent = AYAT[idx][1]; }
    ui.querySelector('#ay-next').addEventListener('click', function () { idx = (idx + 1 + Math.floor(Math.random() * (AYAT.length - 1))) % AYAT.length; render(); });
    ui.querySelector('#ay-copy').addEventListener('click', function () {
      try { navigator.clipboard.writeText('﴿' + AYAT[idx][0] + '﴾ — ' + AYAT[idx][1]); } catch (e) {}
    });
    render();
  }

  /* أذكار الصباح والمساء — a free reading list: every dhikr is written out in full,
   * tap it to count a repetition, it ticks at its number. Nothing is locked and nothing
   * has to be answered here — the SEQUENCE belongs to the alert (v0.123.0).
   * v0.124.0 brings the alert's progress back as a MARK only: a dhikr confirmed with
   * «✓ قرأته» in the notification shows 🔔✓ here, and the one the alert is standing on
   * is highlighted, so the list and the reminders tell the same story. The list is
   * built-in + `azkar_custom`, the same one the alerts walk. */
  function mountSabah(body) {
    var ui = h(
      '<div class="syf-form">' +
        '<div class="syf-seg" id="sm-seg"><button type="button" data-k="s" aria-pressed="false">🌅 الصباح</button><button type="button" data-k="m" aria-pressed="false">🌙 المساء</button></div>' +
        '<div class="syf-note-hint">انقر الذكر لعدّ تكراره — يكتمل عند بلوغ العدد. وما تؤكّد قراءته من التنبيه يُعلَّم 🔔✓.</div>' +
        '<div class="syf-note-list" id="sm-list"></div>' +
        '<button class="syf-mini" id="sm-reset" type="button">إعادة تصفير</button>' +
      '</div>'
    );
    body.appendChild(ui);
    var seg = ui.querySelector('#sm-seg'), list = ui.querySelector('#sm-list');
    /* morning or evening by the day's PRAYER TIMES, from the worker's status (the same
       math the alerts use): an open window decides, else before today's Asr = morning.
       The fixed 15:00 is only the guess drawn until the worker answers — in a Riyadh
       winter Asr is ~14:50, so it opened the morning list inside the evening's time.
       A side the user picked by hand is never switched under them. */
    var mode = new Date().getHours() < 15 ? 's' : 'm', picked = false, guessed = false;
    var counts = {}, lists = { s: AZ.SABAH, m: AZ.MASAA }, goal = { s: null, m: null };
    function items() { return lists[mode]; }
    /* the tally, the done mark and the spoken name of ONE row — counting repaints its row
       in place, so the row keeping keyboard focus is the one just counted */
    function paint(r, it, i) {
      var n = counts[mode + i] || 0, g = goal[mode];
      var heard = !!g && i < g.i;                      /* confirmed in the notification */
      var done = n >= it[1] || heard;
      var t = r.querySelector('.t');
      /* i18n-dyn: a tally */
      r.querySelector('b').textContent = done ? (heard ? '🔔✓' : '✓') : n + '/' + it[1];
      t.classList.toggle('done', done);
      /* i18n-dyn: the dhikr itself (content), then the repetitions left */
      t.setAttribute('aria-label', it[0] + ' — ' + (done ? SYFS.t('اكتمل') : SYFS.t('بقي {0} من {1}', it[1] - n, it[1])));
    }
    function render() {
      seg.querySelectorAll('button').forEach(function (b) {
        var on = b.dataset.k === mode;
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      list.innerHTML = '';
      var g = goal[mode];
      /* the dhikr the alert is waiting on — only while the window is actually running */
      var at = g && g.started && !g.done && !g.missed ? g.i : -1;
      items().forEach(function (it, i) {
        /* the text is the counter: a focusable button (Enter / Space count), not a
           click-only <div> — the 🔊 beside it stays its own button, never nested in one */
        var r = h('<div class="syf-note-row" style="cursor:pointer"><span class="t" role="button" tabindex="0" style="line-height:1.8"></span>' +
                  '<button class="syf-mini" type="button" title="استماع بصوت الشيخ" aria-label="استماع بصوت الشيخ" style="padding:2px 6px">🔊</button><b aria-hidden="true"></b></div>');
        /* i18n-dyn: the dhikr itself — content */
        r.querySelector('.t').textContent = it[0];
        /* the 🔊 is the row's own button: it must not count a repetition too */
        r.querySelector('button').addEventListener('click', function (e) { e.stopPropagation(); azPlay(mode, i, it[0]); });
        if (g && i < g.i) r.title = SYFS.t('أكّدت قراءته في التنبيه');
        else if (i === at) { r.classList.add('syf-next'); r.title = SYFS.t('التنبيه واقف عند هذا الذكر'); }
        paint(r, it, i);
        function tap() { counts[mode + i] = Math.min((counts[mode + i] || 0) + 1, it[1]); paint(r, it, i); }
        r.addEventListener('click', tap);
        r.querySelector('.t').addEventListener('keydown', function (e) {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();                            /* Space would scroll the panel */
          tap();
        });
        list.appendChild(r);
      });
    }
    seg.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; mode = b.dataset.k; picked = true; render(); });
    /* the tap counter is this screen's own — the alert's marks are cleared from
       this tool's «الإعدادات» tab («تصفير»), where the day's progress lives */
    ui.querySelector('#sm-reset').addEventListener('click', function () { counts = {}; render(); });
    /* the user's own adhkar land at the end of the list, as they do in the alerts */
    function reload() { azLists().then(function (L) { if (ui.isConnected) { lists = { s: L.s, m: L.m }; render(); } }); }
    function gload() {
      send('SYFS_AZKAR', { op: 'status' }).then(function (r) {
        if (!r || !r.ok || !ui.isConnected) return;
        goal = { s: r.on.s ? r.goal.s : null, m: r.on.m ? r.goal.m : null };
        if (!picked && !guessed) { guessed = true; mode = azAutoMode(r, Date.now(), mode); }
        render();
      });
    }
    onStore(ui, function (ch) {
      if (ch.azkar_custom) { counts = {}; reload(); }
      if (ch.azkar_goal || ch.ithkar) gload();
    });
    render();
    reload();
    gload();
  }
  /* pure — which list fits NOW, from a SYFS_AZKAR status reply: a window that is open
     wins (the user's «ساعة محددة» included), else today's Asr splits the day; `fallback`
     when the reply carries neither */
  function azAutoMode(r, now, fallback) {
    var w = (r && r.win) || {};
    if (w.m && w.m.open) return 'm';
    if (w.s && w.s.open) return 's';
    var asr = (r && Array.isArray(r.pt) ? r.pt : []).filter(function (p) { return p && p.k === 'asr' && isFinite(p.at); })[0];
    return asr ? (now >= asr.at ? 'm' : 's') : fallback;
  }

  /* أذكاري — the user's own adhkar (v0.122.0). Three lists: general (the periodic
   * reminder), morning and evening (the goals). Stored in `azkar_custom`, appended
   * after the built-in ones everywhere they are shown. Filtered on read AND on write
   * through the same normCustom (§5.11) — import writes any JSON. */
  /* the empty state is a notice, not a grey line: an icon, what is missing, and the one
     step that fills it. Tokens only (--pri-rgb / --ink / --mut), logical properties —
     it follows the theme and the reading direction like the panel around it. */
  var CZ_EMPTY_IC = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"/><path d="M12 8v8M8 12h8"/></svg>';
  function mountCustom(body) {
    var ui = h(
      '<div class="syf-form">' +
        '<div class="syf-seg" id="cz-seg"><button type="button" data-k="gen" aria-pressed="false">أذكار عامة</button><button type="button" data-k="s" aria-pressed="false">🌅 الصباح</button><button type="button" data-k="m" aria-pressed="false">🌙 المساء</button></div>' +
        '<textarea class="syf-in" id="cz-txt" rows="2" placeholder="اكتب الذكر هنا…" aria-label="نص الذكر" style="resize:vertical;line-height:1.7"></textarea>' +
        '<div class="syf-row" style="align-items:center"><label style="margin:0" id="cz-nl" for="cz-n">عدد التكرار</label><input type="number" class="syf-in" id="cz-n" min="1" max="1000" value="1" style="width:70px;text-align:center"><span style="flex:1"></span><button class="syf-btn" id="cz-add" type="button">➕ إضافة</button></div>' +
        '<div class="syf-note-hint" id="cz-hint" style="margin:0" aria-live="polite"></div>' +
        '<div class="syf-note-list" id="cz-list"></div>' +
      '</div>'
    );
    body.appendChild(ui);
    var q = function (s) { return ui.querySelector(s); };
    var seg = q('#cz-seg'), list = q('#cz-list'), txt = q('#cz-txt'), nIn = q('#cz-n'), hint = q('#cz-hint');
    txt.maxLength = AZ.MAX_LEN;                       /* a property, not an attribute (§5.9/8) */
    var kind = 'gen', cur = AZ.normCustom(null);
    /* ⚠️ read → change → write — never a write of the copy this panel loaded. Open in
       two tabs, each saved ITS list and erased what the other had added. The change is
       applied to the list read just now, and a delete names its item (text + count),
       not an index the other tab may have shifted. `fn` returns a message to refuse. */
    function edit(fn) {
      return store.get('azkar_custom', null).then(function (v) {
        cur = AZ.normCustom(v);
        var refused = fn(cur);
        if (refused) { render(); hint.textContent = refused; return; }
        cur = AZ.normCustom(cur);
        return store.set('azkar_custom', cur).then(render);
      });
    }
    function render() {
      if (!ui.isConnected) return;
      seg.querySelectorAll('button').forEach(function (b) {
        var on = b.dataset.k === kind;
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      var withN = kind !== 'gen';
      q('#cz-nl').style.display = withN ? '' : 'none'; nIn.style.display = withN ? '' : 'none';
      hint.textContent = '';
      list.innerHTML = '';
      if (!cur[kind].length) {
        list.appendChild(h(
          '<div class="syf-cz-empty" role="note" style="display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:var(--syfs-rad, 10px);border:1px solid rgba(var(--pri-rgb), .3);background:rgba(var(--pri-rgb), .08);color:var(--ink);text-align:start;line-height:1.7">' +
            '<span aria-hidden="true" style="flex:none;display:flex;color:var(--pri)">' + CZ_EMPTY_IC + '</span>' +
            '<div style="display:flex;flex-direction:column;gap:2px;min-width:0"><b style="font-size:13px">لم تُضِف شيئاً بعد</b>' +
            '<span style="font-size:12px;color:var(--mut)">اكتب ذكراً في الحقل أعلاه ثم اضغط «إضافة».</span></div>' +
          '</div>'));
        return;
      }
      var k = kind;
      cur[k].forEach(function (it) {
        var r = h('<div class="syf-note-row"><span class="t" style="line-height:1.8;unicode-bidi:plaintext"></span><b></b><button class="x" type="button" title="حذف" aria-label="حذف">✕</button></div>');
        r.querySelector('.t').textContent = withN ? it[0] : it;     /* i18n-dyn: the user's own text */
        r.querySelector('b').textContent = withN && it[1] > 1 ? '×' + it[1] : '';
        var id = JSON.stringify(it);
        r.querySelector('.x').addEventListener('click', function () {
          edit(function (L) {
            var j = L[k].map(function (x) { return JSON.stringify(x); }).indexOf(id);
            if (j >= 0) L[k].splice(j, 1);
          });
        });
        list.appendChild(r);
      });
    }
    seg.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; kind = b.dataset.k; render(); });
    q('#cz-add').addEventListener('click', function () {
      var t = AZ.cleanText(txt.value);
      if (!t) { txt.focus(); return; }
      var k = kind, item = k === 'gen' ? t : [t, AZ.cleanN(nIn.value)];
      edit(function (L) {
        if (L[k].length >= AZ.MAX_ITEMS) return SYFS.t('الحدّ {0} ذكراً لكل قائمة.', AZ.MAX_ITEMS);
        L[k].push(item);
        txt.value = ''; nIn.value = '1';
      });
    });
    /* the other tab's edits land here as they happen */
    onStore(ui, function (ch) { if (ch.azkar_custom) { cur = AZ.normCustom(ch.azkar_custom.newValue); render(); } });
    store.get('azkar_custom', null).then(function (v) { cur = AZ.normCustom(v); render(); });
  }

  /* the wird's reciter — محمد صديق المنشاوي (المرتل), an edition of api.alquran.cloud.
     ⛔ Not `ar.minshawimujawwad`: the catalogue lists it but the CDN answers 403 for
     every ayah of it, which would be a play button that does nothing. */
  var WIRD_RECITER = 'ar.minshawi';
  /* The wird's own glyphs (v0.128.0). Stroked 24×24 like every icon on the rail —
   * the panel used ◀ ▶ 🔊 ⏹ 📖, five typefaces' worth of shapes at five weights, and
   * the arrows pointed the wrong way in Arabic. ⛔ Directional ones are drawn LTR and
   * carry `.syf-flip`; the CSS mirrors them in RTL (rail.css), so «السابقة» points
   * right where Arabic starts. A glyph a font may not have is not an icon. */
  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var ICO = {
    prev:  SVG + '<path d="M15 5l-7 7 7 7"/></svg>',
    next:  SVG + '<path d="M9 5l7 7-7 7"/></svg>',
    speak: SVG + '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
    stop:  SVG + '<rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',
    book:  SVG + '<path d="M4 4.8A2.8 2.8 0 0 1 6.8 2H20v15.5H6.8A2.8 2.8 0 0 0 4 20.3z"/><path d="M8 6.5h7M8 10h5"/></svg>'
  };
  /* ⚠️ Arabic-Indic digits are part of the Arabic text, not of the number — «page ٣٤٥»
     reads as a broken font in an English interface, not as a translation. Same rule as
     src/help.js › ar() (§6.100/5). */
  function toArNum(n) {
    if (SYFS.i18n.get() !== 'ar') return String(n);
    return String(n).replace(/[0-9]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[+d]; });
  }
  function wLocalDay(ms) { var d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  /* `wird_quran` as stored, whitelisted ON READ (§5.11) — «استيراد» writes any JSON:
     page:"abc" drew «NaN%», daily:0 filled the bar at «0/0» and handed out the streak
     on the first «قرأت». A value out of its range falls to the default, not the edge. */
  function wirdNorm(v) {
    var r = (v && typeof v === 'object') ? v : {}, day = /^\d{4}-\d{2}-\d{2}$/;
    function int(x, lo, hi, d) { x = Number(x); return (Number.isInteger(x) && x >= lo && x <= hi) ? x : d; }
    return {
      page: int(r.page, 1, QURAN_PAGES, 1), dayKey: day.test(r.dayKey) ? r.dayKey : '',
      readToday: int(r.readToday, 0, 1e6, 0), daily: int(r.daily, 1, 60, 4),
      streak: int(r.streak, 0, 1e6, 0), lastDone: day.test(r.lastDone) ? r.lastDone : '',
      khatmat: int(r.khatmat, 0, 1e6, 0), tafsir: r.tafsir === true
    };
  }

  /* ===== the recitation outlives its panel =====
   * The sheikh recites in the offscreen document, so closing the wird window does not
   * stop him — and the panel used to forget he was reciting: reopened, it showed ▶ and
   * the only way to stop was to start again. The state lives HERE, once per tab; a
   * mounted panel attaches to it, and with no panel on screen a toast keeps «⏹ إيقاف
   * التلاوة» in reach. ONE runtime listener for the tab, added at the first mount (it
   * used to be one more per opening, never removed). */
  var recit = null;            /* { page, n, away } while a page is being recited */
  var recitUi = null;          /* the mounted panel: { ui, at(i), end() } */
  var recitToast = null;       /* close() of the «still reciting» toast */
  var clipWired = false;
  function recitEnd() {
    recit = null;
    if (recitToast) { recitToast(); recitToast = null; }
    if (recitUi && recitUi.ui.isConnected) recitUi.end();
  }
  function recitStop() { send('SYFS_CLIP', { op: 'stop' }); recitEnd(); }
  function recitAway() {
    if (recit.away) return;
    recit.away = true;
    recitToast = showToast(SYFS.t('📖 تلاوة الورد مستمرة'), SYFS.t('صفحة {0} / {1}', toArNum(recit.page), toArNum(QURAN_PAGES)), {
      timeout: 0,
      actions: [
        { label: '⏹ إيقاف التلاوة', primary: true, onClick: function () { recitToast = null; recitStop(); } },
        { label: 'إخفاء', onClick: function () { recitToast = null; } }
      ]
    });
  }
  /* pure — what a SYFS_CLIP_AT means to the page being recited: 'end', 'skip' (another
     clip on the shared channel — the pre-adhan chime, the adhan, a dhikr — whose first
     item used to drag the highlight to ayah 1), or 'at' */
  function clipAtKind(m, r) {
    if (!r) return 'skip';
    if (m.i < 0) return 'end';
    return (m.n | 0) === r.n ? 'at' : 'skip';
  }
  function wireClip() {
    if (clipWired) return;
    clipWired = true;
    try {
      chrome.runtime.onMessage.addListener(function (m) {
        if (!m || m.type !== 'SYFS_CLIP_AT') return;
        var k = clipAtKind(m, recit);
        if (k === 'end') recitEnd();
        else if (k === 'at') { if (recitUi && recitUi.ui.isConnected) recitUi.at(m.i | 0); else recitAway(); }
      });
    } catch (e) {}
  }
  function mountWird(body) {
    var ui = h(
      '<div class="syf-form">' +
        '<div class="syf-row" style="justify-content:space-between;align-items:center;gap:6px">' +
          '<b id="wq-head" style="color:var(--pri);font-size:13px"></b>' +
          '<span class="syf-note-hint" id="wq-juz" style="margin:0"></span>' +
        '</div>' +
        '<div class="syf-quran" id="wq-txt" dir="rtl">…</div>' +
        '<div class="syf-quran-msg" id="wq-msg"></div>' +
        /* ONE toolbar instead of four stacked rows (v0.128.0): navigation, the page
           box, the recitation and the tafsir toggle read as one strip of controls,
           and «قرأت» keeps the only filled button on the panel — it is the only
           action that changes the wird. */
        '<div class="syf-row" style="align-items:center;gap:6px;width:100%">' +
          '<button class="syf-mini ico syf-flip" id="wq-prev" title="الصفحة السابقة" aria-label="الصفحة السابقة">' + ICO.prev + '</button>' +
          '<input type="number" class="syf-in" id="wq-jump" min="1" max="604" style="width:58px;text-align:center;padding:7px 4px" title="اذهب لصفحة" aria-label="اذهب لصفحة">' +
          '<button class="syf-mini ico" id="wq-play" title="استماع للصفحة بصوت المنشاوي" aria-label="استماع للصفحة بصوت المنشاوي">' + ICO.speak + '</button>' +
          '<button class="syf-mini ico" id="wq-stop" title="إيقاف التلاوة" aria-label="إيقاف التلاوة" style="display:none">' + ICO.stop + '</button>' +
          '<button class="syf-mini ico" id="wq-taf" title="التفسير الميسّر (مجمع الملك فهد)" aria-label="التفسير الميسّر (مجمع الملك فهد)" aria-pressed="false">' + ICO.book + '</button>' +
          '<span style="flex:1"></span>' +
          '<button class="syf-btn syf-flip" id="wq-next" title="التالية — تُحتسب ضمن ورد اليوم" style="display:flex;align-items:center;gap:5px"><span>قرأت</span>' + ICO.next + '</button>' +
        '</div>' +
        '<div class="syf-quran-bar" title="تقدّم ورد اليوم"><span id="wq-fill"></span></div>' +
        '<div class="syf-out" style="width:100%">' +
          '<div><span>ورد اليوم</span><b id="wq-today">0/0</b></div>' +
          /* the target sits INSIDE the box it is the target of — it used to be a lone
             row at the bottom, three rows away from the number it governs */
          '<div><span>صفحات/يوم</span><input type="number" class="syf-in" id="wq-daily" min="1" max="60" aria-label="صفحات/يوم" style="width:100%;padding:2px 6px;font-size:15px;font-weight:700;color:var(--pri);text-align:center;height:22px"></div>' +
          '<div><span>التقدّم بالمصحف</span><b id="wq-prog">0%</b></div>' +
          '<div><span>الختمات · السلسلة 🔥</span><b><span id="wq-khat">0</span> · <span id="wq-streak">0</span></b></div>' +
        '</div>' +
      '</div>'
    );
    body.appendChild(ui);
    var txt = ui.querySelector('#wq-txt'), head = ui.querySelector('#wq-head'), juzEl = ui.querySelector('#wq-juz'),
        jump = ui.querySelector('#wq-jump'), dailyIn = ui.querySelector('#wq-daily'), msg = ui.querySelector('#wq-msg'),
        tafBtn = ui.querySelector('#wq-taf');
    var st = null;
    function today() { return wLocalDay(Date.now()); }
    /* ⚠️ «أمس» يوم تقويمي محلّي لا ٨٦٤٠٠٠٠٠ مِلّي ثانية. في يوم التوقيت الصيفي المُنتهي (٢٥ ساعة)
     * يقع الطرح داخل **اليوم نفسه** فتنقطع السلسلة رغم القراءة أمس، وفي يوم البدء (٢٣ ساعة)
     * يقفز فوق أمس. البناء من `new Date(y, m, d - 1)` يترك الحساب للتقويم فيصحّ في الحالتين.
     * ⛔ ولا `toISOString()` هنا — ذاك UTC ويزيح اليوم (نفس قاعدة §5.9/4). */
    function yesterday() { var n = new Date(); return wLocalDay(new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1).getTime()); }
    function save() { return store.set('wird_quran', st); }
    function rollover() { var t = today(); if (st.dayKey !== t) { st.dayKey = t; st.readToday = 0; } }
    /* ⚠️ every change is read → change → write. `st` used to be read once at opening and
       written back whole: the wird open in two tabs, the older one's «قرأت» wrote its
       morning copy over the newer progress — the page and today's count went back, and
       the streak could break. The change now applies to what storage holds right now. */
    function mutate(fn) {
      return store.get('wird_quran', null).then(function (v) {
        st = wirdNorm(v); rollover(); fn(); renderMeta();
        return save();
      });
    }
    function award() { if (st.readToday >= st.daily && st.lastDone !== today()) { st.streak = (st.lastDone === yesterday()) ? st.streak + 1 : 1; st.lastDone = today(); return true; } return false; }

    function renderMeta() {
      jump.value = st.page; dailyIn.value = st.daily; tafBtn.setAttribute('aria-pressed', st.tafsir ? 'true' : 'false');
      ui.querySelector('#wq-today').textContent = Math.min(st.readToday, st.daily) + '/' + st.daily;
      ui.querySelector('#wq-prog').textContent = Math.round(st.page / QURAN_PAGES * 100) + '%';
      ui.querySelector('#wq-khat').textContent = st.khatmat;
      ui.querySelector('#wq-streak').textContent = st.streak;
      ui.querySelector('#wq-fill').style.width = Math.min(100, Math.round(st.readToday / st.daily * 100)) + '%';
    }
    /* ⚠️ الترويسة تُبنى من `n` المجلوبة لا من `st.page`: هما شيئان مختلفان لحظة وصول ردّ متأخّر،
     * وبناؤها من الحالة كان يرسم نصّ صفحة تحت رقم صفحة أخرى — عطلٌ يُقرأ خطأً في المصحف نفسه. */
    function renderPage(n, data, tafsir) {
      txt.textContent = '';
      head.textContent = SYFS.t('صفحة {0} / {1}', toArNum(n), toArNum(QURAN_PAGES));
      juzEl.textContent = data.juz ? SYFS.t('الجزء {0}', toArNum(data.juz)) : '';
      var curSurah = null;
      data.ayahs.forEach(function (a, i) {
        if (a.s !== curSurah) { curSurah = a.s; var hd = document.createElement('div'); hd.className = 'syf-quran-surah'; hd.textContent = a.s; txt.appendChild(hd); }
        if (tafsir) {
          /* one block per ayah: verse then its simplified tafsir */
          var blk = document.createElement('div'); blk.className = 'syf-quran-blk';
          var ay = document.createElement('div'); ay.className = 'syf-quran-ayah'; ay.textContent = a.t + ' ';
          var num = document.createElement('span'); num.className = 'syf-quran-num'; num.textContent = '﴿' + toArNum(a.n) + '﴾'; ay.appendChild(num);
          blk.appendChild(ay);
          var tf = document.createElement('div'); tf.className = 'syf-quran-tafsir'; tf.textContent = tafsir[i] || '';
          blk.appendChild(tf); txt.appendChild(blk);
        } else {
          var sp = document.createElement('span'); sp.className = 'syf-quran-ayah'; sp.textContent = a.t + ' ';
          var num2 = document.createElement('span'); num2.className = 'syf-quran-num'; num2.textContent = '﴿' + toArNum(a.n) + '﴾ ';
          sp.appendChild(num2); txt.appendChild(sp);
        }
      });
      txt.scrollTop = 0;
      /* the recitation highlights what it is reciting, so the node order is the ayah
         order — the same order the audio list is built in */
      ayahNodes = Array.prototype.slice.call(txt.querySelectorAll('.syf-quran-ayah'));
      shownPage = n;
    }
    /* التفسير الميسّر (مجمع الملك فهد) — same trusted API, per-page cached in qt_<n> */
    function getTafsir(n, cb) {
      wirdGet('qt_' + n).then(function (cache) {
        if (cache && cache.length) { cb(cache); return; }
        if (!bgFetch) { cb(null); return; }
        bgFetch('https://api.alquran.cloud/v1/page/' + n + '/ar.muyassar').then(function (r) {
          if (!r || !r.ok) { cb(null); return; }
          try {
            var j = JSON.parse(r.body), arr = (j.data && j.data.ayahs) || [];
            var taf = arr.map(function (a) { return a.text || ''; });
            if (taf.length) wirdSet('qt_' + n, taf);
            cb(taf.length ? taf : null);
          } catch (e) { cb(null); }
        });
      });
    }
    function showErr(n) {
      txt.textContent = '';
      var m = document.createElement('div'); m.className = 'syf-note-hint';
      m.textContent = SYFS.t('تعذّر تحميل صفحة القرآن. تحتاج اتصالاً بالإنترنت أول مرة لكل صفحة، ثم تُحفظ للقراءة دون اتصال.');
      txt.appendChild(m);
      var rb = document.createElement('button'); rb.className = 'syf-mini'; rb.style.marginTop = '8px';
      rb.textContent = SYFS.t('إعادة المحاولة'); rb.addEventListener('click', function () { loadPage(n, true); }); txt.appendChild(rb);
    }
    /* ⚠️ لا إلغاء لطلب جارٍ (الـrelay بلا abort)، فمن يضغط «التالية» مرّتين بسرعة يترك ردّاً
     * طائراً لصفحة غادرها. يصل متأخّراً بعد ردّ الصفحة الحالية **فيرسم فوقها**. الحلّ عدّاد
     * تصاعدي: كل ردّ يحمل رقم طلبه، وما ليس الأحدث يُسقَط عند كل نقطة عودة غير متزامنة
     * (التخزين، الجلب، والتفسير) — لا عند واحدة منها فقط. */
    var reqSeq = 0;
    function loadPage(n, force) {
      n = Math.min(QURAN_PAGES, Math.max(1, n | 0));
      var req = ++reqSeq;
      head.textContent = SYFS.t('صفحة {0} / {1}', toArNum(n), toArNum(QURAN_PAGES)); juzEl.textContent = '';
      txt.textContent = ''; var ld = document.createElement('div'); ld.className = 'syf-note-hint'; ld.textContent = SYFS.t('جارٍ التحميل…'); txt.appendChild(ld);
      /* render the page, adding tafsir underneath each ayah when the toggle is on */
      function finish(data) {
        if (req !== reqSeq) return;
        if (st.tafsir) getTafsir(n, function (taf) { if (req !== reqSeq) return; renderPage(n, data, taf); if (!taf) flash(SYFS.t('تعذّر تحميل التفسير — يحتاج اتصالاً أول مرة')); });
        else renderPage(n, data);
      }
      wirdGet('qp_' + n).then(function (cache) {
        if (req !== reqSeq) return;
        if (cache && cache.ayahs && cache.ayahs.length && !force) { finish(cache); return; }
        if (!bgFetch) { if (cache && cache.ayahs) finish(cache); else showErr(n); return; }
        bgFetch('https://api.alquran.cloud/v1/page/' + n + '/quran-uthmani').then(function (r) {
          if (req !== reqSeq) return;
          if (!r || !r.ok) { if (cache && cache.ayahs) finish(cache); else showErr(n); return; }
          try {
            var j = JSON.parse(r.body), arr = (j.data && j.data.ayahs) || [];
            if (!arr.length) { if (cache && cache.ayahs) finish(cache); else showErr(n); return; }
            var data = { juz: arr[0].juz, ayahs: arr.map(function (a) { return { t: a.text, n: a.numberInSurah, s: (a.surah && a.surah.name) || '' }; }) };
            wirdSet('qp_' + n, data); finish(data);
          } catch (e) { if (cache && cache.ayahs) finish(cache); else showErr(n); }
        });
      });
    }
    function flash(txtStr) { msg.textContent = txtStr; if (flash._t) clearTimeout(flash._t); flash._t = setTimeout(function () { if (msg.isConnected) msg.textContent = ''; }, 4000); }

    /* ===== تلاوة الصفحة — محمد صديق المنشاوي (v0.127.0) =====
     * Verse by verse, from the SAME host the page text comes from: api.alquran.cloud
     * names one mp3 per ayah on cdn.islamic.network, so the recitation follows the
     * mushaf exactly and the panel can highlight the ayah being recited. The audio is
     * played by the offscreen document (§5.30) — the sound survives navigation, and a
     * strict page's media-src cannot silence it. Nothing is bundled: the urls are a
     * per-page list, cached in `qa_<n>` like the text beside it. */
    var ayahNodes = [], shownPage = 0;
    var playBtn = ui.querySelector('#wq-play'), stopBtn = ui.querySelector('#wq-stop');
    function showStop(on) { playBtn.style.display = on ? 'none' : ''; stopBtn.style.display = on ? '' : 'none'; }
    function mark(i) {
      ayahNodes.forEach(function (el, j) { el.classList.toggle('syf-quran-at', j === i); });
      var at = ayahNodes[i];
      if (at && at.scrollIntoView) { try { at.scrollIntoView({ block: 'center' }); } catch (e) {} }
    }
    function audioList(n, cb) {
      wirdGet('qa_' + n).then(function (cache) {
        if (cache && cache.length) { cb(cache); return; }
        if (!bgFetch) { cb(null); return; }
        bgFetch('https://api.alquran.cloud/v1/page/' + n + '/' + WIRD_RECITER).then(function (r) {
          if (!r || !r.ok) { cb(null); return; }
          try {
            var j = JSON.parse(r.body), arr = (j.data && j.data.ayahs) || [];
            /* only the CDN's own https urls are kept — the worker refuses the rest
               anyway, and a list half of which is silence is worse than none */
            var urls = arr.map(function (a) { return String(a.audio || ''); })
                          .filter(function (u) { return u.indexOf('https://cdn.islamic.network/quran/audio/') === 0; });
            if (urls.length) wirdSet('qa_' + n, urls);
            cb(urls.length ? urls : null);
          } catch (e) { cb(null); }
        });
      });
    }
    playBtn.addEventListener('click', function () {
      if (!st) return;                                    /* same race as the buttons below */
      var n = st.page;
      playBtn.disabled = true;
      audioList(n, function (urls) {
        playBtn.disabled = false;
        if (!urls) { flash(SYFS.t('تعذّر تحميل التلاوة — تحتاج اتصالاً أول مرة لكل صفحة.')); return; }
        if (n !== st.page) return;                        /* the page moved while we fetched */
        recit = { page: n, n: urls.length, away: false };
        showStop(true);
        send('SYFS_CLIP', { op: 'play', urls: urls }).then(function (r) {
          if (!r || !r.ok) { recitStop(); flash(SYFS.t('تعذّر تشغيل التلاوة.')); return; }
          if (recit && r.n > 0) recit.n = r.n;            /* the worker's own count of what it queued */
        });
      });
    });
    stopBtn.addEventListener('click', recitStop);
    /* this panel is now the one the recitation reports to — and if the sheikh is still
       reciting from an earlier opening, the panel opens on ⏹, not on ▶ */
    wireClip();
    recitUi = {
      ui: ui,
      at: function (i) { if (recit && recit.page === shownPage) mark(i); },
      end: function () { mark(-1); showStop(false); }
    };
    if (recit) {
      recit.away = false;
      if (recitToast) { recitToast(); recitToast = null; }
      showStop(true);
    }

    /* leaving the page stops its recitation — otherwise the sheikh keeps reciting a
       page that is no longer on screen, and the highlight lands on the wrong ayahs */
    function goto(step) {
      if (recit) recitStop();
      mutate(function () { st.page = Math.min(QURAN_PAGES, Math.max(1, step(st.page))); }).then(function () { loadPage(st.page); });
    }
    function readNext() {
      if (recit) recitStop();
      mutate(function () {
        if (st.page >= QURAN_PAGES) { st.page = 1; st.khatmat++; flash(SYFS.t('🎉 أتممت ختمة كاملة! تقبّل الله.')); } else st.page++;
        st.readToday++;
        if (award()) flash(SYFS.t('أحسنت! أكملت ورد اليوم 🔥 سلسلة {0} يوم', toArNum(st.streak)));
      }).then(function () { loadPage(st.page); });
    }

    /* ⛔ v0.139.0 — `st` does not exist until the store answers (a promise, below),
       but the buttons are live the moment the panel is drawn. Every handler here
       dereferenced it, so a press landing in that window threw
       «Cannot read properties of null» and did nothing — no error the user can see,
       just a button that ignored them once. The gap is small (storage answers in a
       millisecond or two) and exactly the size of an impatient click on a slow tab.
       `ready()` makes the press a no-op instead of a throw; the state is never half
       applied, and the second press — after the panel has its state — works. */
    function ready(fn) { return function (e) { if (!st) return; fn(e); }; }
    ui.querySelector('#wq-prev').addEventListener('click', ready(function () { goto(function (p) { return p - 1; }); }));
    ui.querySelector('#wq-next').addEventListener('click', ready(readNext));
    jump.addEventListener('change', ready(function () { var n = parseInt(jump.value, 10) || 1; goto(function () { return n; }); }));
    dailyIn.addEventListener('change', ready(function () { var d = Math.min(60, Math.max(1, parseInt(dailyIn.value, 10) || 4)); mutate(function () { st.daily = d; }); }));
    tafBtn.addEventListener('click', ready(function () { mutate(function () { st.tafsir = !st.tafsir; }).then(function () { loadPage(st.page); }); }));

    /* another tab's progress lands here as it happens — the page it moved to, today's
       count — instead of waiting to be overwritten by this tab's older copy */
    onStore(ui, function (ch) {
      if (!ch.wird_quran || !st) return;
      var nv = wirdNorm(ch.wird_quran.newValue), moved = nv.page !== st.page || nv.tafsir !== st.tafsir;
      st = nv; renderMeta();
      if (moved) { if (recit) recitStop(); loadPage(st.page); }
    });
    store.get('wird_quran', null).then(function (v) {
      st = wirdNorm(v);
      rollover(); save(); renderMeta(); loadPage(st.page);
    });
  }

  SYFS.tools.push({
    id: 'athkar', name: 'الأذكار', cat: 'islam',
    /* The user's own praying figure, from New Icons/praying_1.svg — path AND
       viewBox verbatim. Unlike the mosque, this glyph already fills 92.4% × 93.6%
       of its 512 box, so cropping it would have bought 0.7% and cost a number
       nobody can later explain. The measurement is the reason there is no crop
       here, not an oversight. */
    icon: '<svg viewBox="0 0 512 512" fill="currentColor"><g transform="translate(0,512) scale(0.1,-0.1)"><path fill-rule="evenodd" d="M1450 4914 c-121 -32 -261 -119 -332 -206 -131 -161 -173 -314 -166 -598 4 -146 8 -174 31 -240 49 -138 147 -255 297 -355 38 -26 70 -50 70 -53 0 -4 -13 -56 -28 -116 l-28 -109 -82 -22 c-294 -78 -521 -310 -592 -605 -19 -80 -20 -117 -20 -602 0 -565 2 -585 60 -736 16 -42 52 -111 79 -153 51 -78 164 -198 213 -227 15 -9 28 -20 28 -23 0 -4 -96 -9 -212 -11 -200 -3 -216 -4 -256 -26 -54 -29 -115 -84 -142 -128 -29 -45 -150 -410 -150 -450 0 -19 8 -38 21 -50 21 -19 73 -19 2319 -19 2246 0 2298 0 2319 19 14 13 21 31 21 57 0 73 49 69 -822 69 l-778 0 55 67 c104 126 146 245 146 414 0 201 -51 330 -181 460 -81 80 -160 127 -260 154 -43 12 -722 85 -786 85 -11 0 -14 25 -14 134 l0 134 58 32 c42 24 148 123 400 374 188 187 345 351 349 364 3 12 0 36 -7 52 -12 29 -10 32 79 128 124 135 155 212 131 329 -17 78 -40 121 -93 170 -65 60 -143 78 -210 49 -18 -8 -90 -73 -161 -145 l-130 -130 -44 6 -44 6 -184 -184 c-101 -100 -185 -181 -187 -179 -2 3 -14 33 -27 68 -12 34 -49 102 -81 151 -74 113 -157 190 -297 277 -2 2 9 57 25 123 l28 121 47 16 c118 39 227 139 286 262 31 65 35 85 44 200 11 153 2 472 -17 563 -44 216 -246 427 -461 483 -77 20 -239 20 -314 0z m273 -139 c72 -19 130 -47 185 -92 47 -38 128 -140 119 -149 -3 -3 -212 -59 -464 -124 -386 -99 -459 -115 -462 -102 -2 9 2 41 9 72 38 172 168 320 335 378 100 35 188 41 278 17z m372 -437 c4 -29 5 -168 3 -308 -3 -248 -4 -256 -28 -305 -53 -107 -171 -186 -311 -208 -103 -16 -181 0 -304 63 -246 125 -360 280 -353 481 l3 83 470 122 c259 67 480 122 492 123 19 1 22 -6 28 -51z m-530 -953 c33 -8 79 -15 103 -15 23 0 42 -3 42 -7 -1 -5 -11 -48 -23 -98 l-22 -90 -62 1 c-64 1 -149 20 -159 36 -9 14 37 188 50 188 6 -1 38 -7 71 -15z m1545 -298 c14 -22 20 -50 20 -88 0 -64 -12 -84 -124 -204 l-65 -70 -86 85 -85 86 129 128 129 127 32 -16 c17 -9 40 -30 50 -48z m-1685 -27 c46 -18 87 -24 180 -28 135 -5 148 -10 242 -84 105 -83 188 -209 232 -352 l22 -70 -47 -47 -47 -48 -218 210 c-185 177 -222 209 -247 209 -34 0 -72 -38 -72 -74 -1 -15 76 -97 251 -268 219 -216 256 -248 283 -248 27 0 67 36 321 290 l290 290 140 -140 139 -139 -274 -276 c-296 -297 -358 -351 -448 -386 -120 -46 -281 -35 -392 28 -25 14 -173 153 -335 314 -159 158 -301 292 -315 297 -56 21 -113 -34 -91 -89 5 -13 143 -157 307 -319 257 -255 309 -301 369 -332 100 -52 182 -71 298 -72 l97 0 0 -142 c0 -166 7 -190 59 -204 20 -5 212 -26 426 -46 424 -39 467 -48 563 -111 129 -86 202 -234 202 -413 0 -215 -132 -399 -331 -461 -58 -18 -108 -19 -1070 -19 -555 0 -1009 3 -1009 7 0 4 28 92 62 195 l63 188 837 0 837 0 20 26 c24 31 27 62 7 90 -14 18 -36 19 -713 24 -678 6 -700 6 -776 28 -219 61 -410 227 -492 430 -53 131 -56 175 -53 723 l3 504 27 80 c37 109 90 193 169 273 80 80 156 128 264 165 92 32 131 31 220 -3z m-505 -2347 c0 -4 -28 -92 -62 -195 l-63 -188 -202 0 c-112 0 -203 3 -203 8 0 4 21 70 47 147 52 152 88 204 155 224 39 11 328 14 328 4z"/></g></svg>',
    mount: function (body) {
      SYFS.tabs(body, [
        { label: 'الصباح/المساء', build: mountSabah },
        { label: 'أذكاري', build: mountCustom },
        { label: 'آية اليوم', build: mountAyah },
        /* v0.178.x — the athkar half of the removed «إعدادات التنبيهات» tool */
        { label: 'الإعدادات', build: mountAzkarSet }
      ]);
    }
  });

  /* ===== الورد اليومي — its own tool (v0.98.0) =====
   * It was the middle tab of «أذكار وورد». Splitting it is not cosmetic: the wird is
   * a DAILY OBLIGATION the user opens to record progress against, and a tool that is
   * reached in two clicks through a sibling's tab is one that gets skipped. It also
   * had the odd shape of a tab that owns storage (`wird_quran`) and a rollover clock
   * while its neighbours own neither.
   *
   * ⚠️ mountWird() is reused VERBATIM — same signature, same storage key, same state.
   * Anyone mid-way through their wird keeps their page; nothing migrates, because
   * nothing about the data changed. Only the door did. */
  SYFS.tools.push({
    id: 'wird', name: 'الورد اليومي', cat: 'islam',
    /* A bookmark, solid, to sit with the other v0.83.0 glyphs. ⛔ Not an open book —
       that silhouette is already the Quran player's, and at 16px the silhouette is
       the whole icon. A ribbon says "where you stopped", which is what this is. */
    icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M5.5 2 L18.5 2 C19.05 2 19.5 2.45 19.5 3 L19.5 21.3 C19.5 22.05 18.66 22.5 18.04 22.08 L12 18 L5.96 22.08 C5.34 22.5 4.5 22.05 4.5 21.3 L4.5 3 C4.5 2.45 4.95 2 5.5 2 Z"/></svg>',
    mount: mountWird
  });
}());
