/* SYF — nine new shelf tools (v0.118.0), one file, all local:
 *   qrread    · قارئ QR وباركود     (util)   → jsQR (lib/jsqr/, injected on first use); result is text, never opened
 *   cookiemgr · مدير الكوكيز        (shield) → list / edit / delete ONE cookie of this site, via the worker
 *   sessions  · جلسات التبويبات     (util)   → save the open tabs by name, restore all or one
 *   ziptool   · أرشيف ZIP           (docs)   → open / browse / extract, or build one — SYFS.imgkit.zipRead/zipWrite
 *   textdiff  · فرق نصّين           (note)   → line + word level, RTL-safe, for people who are not developers
 *   readsave  · احفظ المقال         (note)   → extract the article → Markdown / print / notes
 *   datediff  · الفرق بين تاريخين   (time)   → whole days, working days, holidays, Hijri of both ends
 *   timelog   · سجلّ وقت المهام     (time)   → start/stop on a task (calendar tasks offered), weekly report
 *   exif      · بيانات الصورة (EXIF)(media)  → SHOW what a photo carries (GPS!) then export a clean copy
 *
 * Rules kept from the rest of the project: every user/page/file value reaches the DOM
 * through textContent or value only; nothing here has a network call; the worker
 * derives the site from sender.tab (cookies) and the window from sender.tab (sessions),
 * never from a parameter the panel sends. The pure functions (exifParse, domToMd,
 * diffWords, workDays, tlReport) are what tools/tools3-test.js lifts.
 * Loaded lazily (LAZY_TOOL_FILES) BEFORE src/rail.js. Both editions. */
(function () {
  window.SYFS = window.SYFS || {};
  SYFS.tools = SYFS.tools || [];
  var store = SYFS.store;

  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }
  function t() { return SYFS.t ? SYFS.t.apply(null, arguments) : arguments[0]; }
  function copy(text) { try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (e) {} }
  function every(body, ms, fn) { var iv = setInterval(function () { if (!body.isConnected) { clearInterval(iv); return; } fn(); }, ms); fn(); return iv; }
  function dlBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }
  function fmtBytes(n) { if (!n) return '0 B'; return n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'); }
  function safeBase(name) { return (String(name || '').replace(/\.[^.]+$/, '').replace(/[^\w؀-ۿ.-]+/g, '_').slice(0, 60)) || 'file'; }
  function status(el, msg, bad) { el.style.display = ''; el.textContent = msg; el.style.color = bad ? '#c0392b' : ''; }
  function row(label, value, warn) {
    var r = h('<div class="syf-note-row"><span class="t"></span><b></b></div>');
    r.querySelector('.t').textContent = label;
    var b = r.querySelector('b'); b.textContent = value; if (warn) b.style.color = '#d4423a';
    return r;
  }
  function loc() { return (SYFS.i18n && SYFS.i18n.locale) ? SYFS.i18n.locale() : 'ar-EG'; }
  function num(n) { try { return Number(n).toLocaleString(loc(), { useGrouping: false }); } catch (e) { return String(n); } }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* ⚠️ LOCAL date key — never toISOString() (§5.9/4) */
  function dkey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function localDate(v) { var p = String(v || '').split('-'); return (p.length === 3 && +p[0]) ? new Date(+p[0], +p[1] - 1, +p[2]) : null; }
  /* ⚠️ `valueAsDate = new Date()` writes the UTC day — in Riyadh that is yesterday from
     midnight to 3 am. An <input type=date> takes the LOCAL day as its string. */
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fmtDate(d) { try { return d.toLocaleDateString(loc(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); } catch (e) { return String(d); } }
  function fmtDT(ms) { try { return new Date(ms).toLocaleString(loc(), { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return String(new Date(ms)); } }
  function hms(ms) { var s = Math.max(0, Math.floor(ms / 1000)); return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); }
  function safeUrl(u) { try { var x = new URL(String(u), location.href); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : null; } catch (e) { return null; } }
  /* worker round-trip with a timeout: a callback that never comes must not freeze a panel (§6.95/4) */
  function ask(type, payload, cb) {
    var done = false;
    function fin(r) { if (done) return; done = true; cb(r || { ok: false }); }
    try { chrome.runtime.sendMessage(Object.assign({ type: type }, payload), function (r) { void chrome.runtime.lastError; fin(r); }); } catch (e) { fin(); }
    setTimeout(function () { fin({ ok: false, timeout: true }); }, 4000);
  }
  /* two-click delete: the first click arms the button, the second within 3s acts (no confirm()) */
  function armed(btn, label, fn) {
    var on = false, tm = 0;
    btn.addEventListener('click', function () {
      if (on) { clearTimeout(tm); on = false; btn.textContent = label; fn(); return; }
      on = true; btn.textContent = t('تأكيد؟');
      tm = setTimeout(function () { on = false; btn.textContent = label; }, 3000);
    });
  }

  /* ======================================================================
   * 1) مدير الكوكيز
   * ==================================================================== */
  function ckExpiry(c) {
    if (c.session || !c.expires) return t('جلسة');
    var ms = c.expires * 1000;
    if (ms < Date.now()) return t('منتهية');
    return fmtDT(ms);
  }
  function mountCookies(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<div class="syf-row"><span class="syf-note-hint" id="ck-host" style="flex:1"></span><button class="syf-mini" id="ck-ref">↻ تحديث</button><button class="syf-mini" id="ck-add">+ كوكي</button></div>' +
        '<input class="syf-in" id="ck-q" placeholder="تصفية بالاسم…">' +
        '<div class="syf-form" id="ck-ed" style="display:none;border:1px solid var(--line);border-radius:10px;padding:8px">' +
          '<label>الاسم</label><input class="syf-in syf-mono" id="ck-n">' +
          '<label>القيمة</label><textarea class="syf-in syf-mono" id="ck-v" rows="2"></textarea>' +
          '<div class="syf-row"><div style="flex:1"><label>المسار</label><input class="syf-in syf-mono" id="ck-p" value="/"></div>' +
          '<div style="flex:1"><label>الانتهاء (فارغ = جلسة)</label><input class="syf-in" id="ck-x" type="datetime-local"></div></div>' +
          '<div class="syf-row"><label class="syf-ck"><input type="checkbox" id="ck-sec"> <span>Secure</span></label>' +
          '<label class="syf-ck"><input type="checkbox" id="ck-ho"> <span>HttpOnly</span></label>' +
          '<select class="syf-in" id="ck-ss"><option value="unspecified">SameSite: —</option><option value="lax">Lax</option><option value="strict">Strict</option><option value="no_restriction">None</option></select></div>' +
          '<div class="syf-row"><button class="syf-btn" id="ck-save" style="flex:1">حفظ</button><button class="syf-mini" id="ck-cancel">إلغاء</button></div>' +
        '</div>' +
        '<div class="syf-note-list" id="ck-list"></div>' +
        '<div class="syf-empty" id="ck-st" style="display:none"></div>' +
        '<div class="syf-note-hint">كوكيز هذا الموقع فقط. «منظّف الموقع» يمسحها كلّها؛ هنا تحذف أو تعدّل واحدة — لاختبار انتهاء الجلسة بلا خروج من كل حساباتك. القيم لا تُخزَّن ولا تغادر الجهاز.</div>' +
      '</div>'));
    var hostEl = body.querySelector('#ck-host'), list = body.querySelector('#ck-list'), st = body.querySelector('#ck-st'),
        q = body.querySelector('#ck-q'), ed = body.querySelector('#ck-ed'),
        nIn = body.querySelector('#ck-n'), vIn = body.querySelector('#ck-v'), pIn = body.querySelector('#ck-p'), xIn = body.querySelector('#ck-x'),
        secIn = body.querySelector('#ck-sec'), hoIn = body.querySelector('#ck-ho'), ssIn = body.querySelector('#ck-ss');
    var cookies = [], editing = null;

    function openEd(c) {
      editing = c || null;
      nIn.value = c ? c.name : ''; nIn.readOnly = !!c;
      vIn.value = c ? c.value : '';
      pIn.value = c ? c.path : '/';
      secIn.checked = c ? c.secure : location.protocol === 'https:';
      hoIn.checked = c ? c.httpOnly : false;
      ssIn.value = c ? c.sameSite : 'unspecified';
      if (c && c.expires && !c.session) {
        var d = new Date(c.expires * 1000);
        xIn.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      } else xIn.value = '';
      ed.style.display = ''; (c ? vIn : nIn).focus();
    }
    function closeEd() { ed.style.display = 'none'; editing = null; }
    function render() {
      list.textContent = '';
      var f = q.value.trim().toLowerCase();
      var shown = cookies.filter(function (c) { return !f || c.name.toLowerCase().indexOf(f) >= 0; });
      if (!shown.length) { list.appendChild(h('<div class="syf-empty">لا كوكيز.</div>')); return; }
      shown.forEach(function (c) {
        var r = h('<div class="syf-note-row" style="flex-wrap:wrap"><b class="syf-mono" style="flex:1 1 100%"></b>' +
          '<span class="t syf-mono" style="flex:1 1 100%;font-size:11px;opacity:.85;word-break:break-all"></span>' +
          '<span class="t" style="flex:1;font-size:11px;opacity:.7"></span>' +
          '<button class="syf-mini e">تعديل</button><button class="syf-mini x">حذف</button></div>');
        /* i18n-dyn: a cookie name — site data */
        r.querySelector('b').textContent = c.name;
        var v = r.querySelector('.syf-mono.t');
        v.textContent = c.value.length > 120 ? c.value.slice(0, 120) + '…' : c.value;
        if (c.value.length > 120) { v.style.cursor = 'pointer'; v.title = t('انقر للعرض كاملاً'); v.addEventListener('click', function () { v.textContent = c.value; }); }
        var flags = [];
        if (c.secure) flags.push('Secure'); if (c.httpOnly) flags.push('HttpOnly'); if (c.sameSite && c.sameSite !== 'unspecified') flags.push('SameSite=' + c.sameSite);
        r.querySelectorAll('.t')[1].textContent = c.domain + c.path + ' · ' + ckExpiry(c) + (flags.length ? ' · ' + flags.join(' ') : '');
        r.querySelector('.e').addEventListener('click', function () { openEd(c); });
        armed(r.querySelector('.x'), t('حذف'), function () {
          ask('SYFS_COOKIES', { op: 'remove', cookie: c }, function (res) {
            if (!res.ok) { status(st, t('تعذّر الحذف.'), true); return; }
            load();
          });
        });
        list.appendChild(r);
      });
    }
    function load() {
      ask('SYFS_COOKIES', { op: 'list' }, function (res) {
        if (!res.ok) { status(st, res.error === 'unsupported-page' ? t('غير مدعوم في هذه الصفحة.') : t('تعذّرت قراءة الكوكيز.'), true); return; }
        st.style.display = 'none';
        hostEl.textContent = res.host + ' · ' + t('{0} كوكي', res.cookies.length);
        cookies = res.cookies; render();
      });
    }
    q.addEventListener('input', render);
    body.querySelector('#ck-ref').addEventListener('click', load);
    body.querySelector('#ck-add').addEventListener('click', function () { openEd(null); });
    body.querySelector('#ck-cancel').addEventListener('click', closeEd);
    body.querySelector('#ck-save').addEventListener('click', function () {
      var name = nIn.value.trim();
      if (!name) { nIn.focus(); return; }
      var c = { name: name, value: vIn.value, path: pIn.value.trim() || '/', secure: secIn.checked, httpOnly: hoIn.checked, sameSite: ssIn.value };
      if (editing) { c.domain = editing.domain; c.storeId = editing.storeId; c.hostOnly = editing.hostOnly; }
      if (xIn.value) { var d = new Date(xIn.value); if (!isNaN(d.getTime())) c.expires = Math.round(d.getTime() / 1000); }
      ask('SYFS_COOKIES', { op: 'set', cookie: c }, function (res) {
        if (!res.ok) { status(st, t('رُفضت الكوكي — الاسم أو القيمة تحمل محارف غير مسموحة، أو النطاق لا يخصّ هذا الموقع.'), true); return; }
        closeEd(); load();
      });
    });
    load();
  }

  /* ======================================================================
   * 2) جلسات التبويبات
   * ==================================================================== */
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  /* Phase-2 review. Above SESS_BIG tabs «فتح الكلّ» asks first and offers a NEW WINDOW
   * whose tabs load only when visited (the worker discards them, op 'open' + lazy) —
   * forty pages loading at once is the slowdown the user then blames on the browser.
   * The rename field: Enter/blur saves, Esc puts the old name back, an empty or unchanged
   * name is never sent. 'update' replaces a session's tabs with the current window's
   * instead of piling up «صباح الأحد (2)», «(3)»… The worker picks the window: the
   * sender's, or — from «وضع العمل» in its own popup window — the last normal one. */
  var SESS_BIG = 15;
  /* pure, for tools/sessions-test.js: the rename decision → null (nothing to send) or the name */
  function sessRename(oldName, typed) { var v = String(typed || '').trim().slice(0, 60); return (!v || v === String(oldName || '')) ? null : v; }
  function mountSessions(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<div class="syf-row"><input class="syf-in" id="ss-name" placeholder="اسم الجلسة (مثال: صباح الأحد)" aria-label="اسم الجلسة"><button class="syf-btn" id="ss-save">💾 احفظ التبويبات المفتوحة</button></div>' +
        '<div class="syf-note-list" id="ss-list"></div>' +
        '<div class="syf-empty" id="ss-st" role="status" aria-live="polite" style="display:none"></div>' +
        '<div class="syf-note-hint">تُحفظ تبويبات هذه النافذة (ومن «وضع العمل»: آخر نافذة عادية) بضغطة منك فقط — لا حفظ تلقائي. العناوين تبقى على هذا الجهاز ولا تدخل ملفّ تصدير الإعدادات. «تحديث» يستبدل تبويبات جلسة محفوظة بالمفتوحة الآن.</div>' +
      '</div>'));
    var nameIn = body.querySelector('#ss-name'), list = body.querySelector('#ss-list'), st = body.querySelector('#ss-st');
    nameIn.maxLength = 60;
    var sessions = [];
    function noTabsMsg() { return SYFS.inExtPage && SYFS.inExtPage() ? t('لا تبويبات ويب في آخر نافذة متصفّح عادية.') : t('لا تبويبات ويب مفتوحة في هذه النافذة.'); }
    function openAll(s, win) {
      ask('SYFS_SESSIONS', { op: 'open', id: s.id, newWindow: win, lazy: win }, function (res) {
        if (res.timeout) { status(st, t('أُرسل الطلب — فتح التبويبات قد يستغرق لحظات.')); return; }
        if (!res.ok) { status(st, t('تعذّر الفتح.'), true); return; }
        status(st, win ? t('فُتح {0} تبويباً في نافذة جديدة — يُحمَّل كلٌّ منها عند فتحه.', res.opened) : t('فُتح {0} تبويباً في الخلفية.', res.opened));
      });
    }
    function render() {
      list.textContent = '';
      if (!sessions.length) { list.appendChild(h('<div class="syf-empty">لا جلسات محفوظة بعد.</div>')); return; }
      sessions.forEach(function (s) {
        var r = h('<div class="syf-note-row" style="flex-wrap:wrap"><b style="flex:1"></b><span class="t" style="flex:0 0 auto;font-size:11px;opacity:.7"></span>' +
          '<div class="syf-row" style="flex:1 1 100%;flex-wrap:wrap"><button class="syf-mini o">فتح الكلّ</button><button class="syf-mini l" aria-expanded="false">▾ التبويبات</button><button class="syf-mini n">إعادة تسمية</button><button class="syf-mini u">تحديث</button><button class="syf-mini x">حذف</button></div>' +
          '<div class="syf-row cf" role="group" style="flex:1 1 100%;flex-wrap:wrap;display:none"><span class="t" style="flex:1 1 100%;font-size:12px"></span>' +
            '<button class="syf-mini w">نافذة جديدة (تحميل عند الفتح)</button><button class="syf-mini hr">افتحها هنا</button><button class="syf-mini c">إلغاء</button></div>' +
          '<div class="syf-note-list tabs" style="flex:1 1 100%;display:none"></div></div>');
        var nameB = r.querySelector('b');
        nameB.textContent = s.name || t('جلسة بلا اسم');
        r.querySelector('.t').textContent = t('{0} تبويباً', s.tabs.length) + ' · ' + fmtDT(s.at);
        var tabsEl = r.querySelector('.tabs'), cf = r.querySelector('.cf');
        cf.querySelector('.t').textContent = t('{0} تبويباً — فتحها كلّها دفعة واحدة يُثقل المتصفّح. كيف تفتحها؟', s.tabs.length);
        function closeCf() { cf.style.display = 'none'; r.querySelector('.o').focus(); }
        r.querySelector('.o').addEventListener('click', function () {
          if (s.tabs.length <= SESS_BIG) { openAll(s, false); return; }
          cf.style.display = ''; cf.querySelector('.w').focus();
        });
        cf.querySelector('.w').addEventListener('click', function () { cf.style.display = 'none'; openAll(s, true); });
        cf.querySelector('.hr').addEventListener('click', function () { cf.style.display = 'none'; openAll(s, false); });
        cf.querySelector('.c').addEventListener('click', closeCf);
        cf.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeCf(); } });
        var lB = r.querySelector('.l');
        lB.addEventListener('click', function () {
          if (tabsEl.style.display !== 'none') { tabsEl.style.display = 'none'; lB.setAttribute('aria-expanded', 'false'); return; }
          tabsEl.textContent = ''; tabsEl.style.display = ''; lB.setAttribute('aria-expanded', 'true');
          s.tabs.forEach(function (tb, i) {
            var tr = h('<div class="syf-note-row"><span class="t" style="flex:1;font-size:12px"></span><span class="t" style="font-size:11px;opacity:.6"></span><button class="syf-mini">فتح</button></div>');
            tr.querySelector('.t').textContent = tb.t || tb.u;             /* page titles — user data */
            tr.querySelectorAll('.t')[1].textContent = hostOf(tb.u);
            tr.querySelector('button').addEventListener('click', function () {
              ask('SYFS_SESSIONS', { op: 'open', id: s.id, index: i }, function (res) {
                status(st, res.ok && res.opened ? t('فُتح التبويب في الخلفية: {0}', hostOf(tb.u)) : t('تعذّر فتح التبويب.'), !(res.ok && res.opened));
              });
            });
            tabsEl.appendChild(tr);
          });
        });
        r.querySelector('.n').addEventListener('click', function () {
          if (nameB.querySelector('input')) return;
          var old = s.name || '', settled = false;
          var inp = document.createElement('input'); inp.className = 'syf-in'; inp.value = old; inp.maxLength = 60;
          inp.setAttribute('aria-label', t('اسم الجلسة'));
          nameB.textContent = ''; nameB.appendChild(inp); inp.focus(); inp.select();
          function restore() { nameB.textContent = old || t('جلسة بلا اسم'); }
          function finish(save) {
            if (settled) return; settled = true;
            var typed = inp.value, v = save ? sessRename(old, typed) : null;
            if (v === null) {
              restore();
              if (save && !typed.trim()) status(st, t('اسم الجلسة لا يكون فارغاً — بقي الاسم السابق.'), true);
              return;
            }
            ask('SYFS_SESSIONS', { op: 'rename', id: s.id, name: v }, function (res) {
              if (!res.ok) { restore(); status(st, t('تعذّرت إعادة التسمية.'), true); return; }
              load();
            });
          }
          inp.addEventListener('blur', function () { finish(true); });
          inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            /* stopPropagation: Esc here cancels the rename, it must not close the window */
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
          });
        });
        armed(r.querySelector('.u'), t('تحديث'), function () {
          ask('SYFS_SESSIONS', { op: 'update', id: s.id }, function (res) {
            if (!res.ok) { status(st, res.error === 'no-tabs' ? noTabsMsg() : t('تعذّر التحديث.'), true); return; }
            status(st, t('حُدّثت الجلسة: {0} تبويباً.', res.session && res.session.tabs ? res.session.tabs.length : 0)); load();
          });
        });
        armed(r.querySelector('.x'), t('حذف'), function () { ask('SYFS_SESSIONS', { op: 'delete', id: s.id }, load); });
        list.appendChild(r);
      });
    }
    function load() {
      ask('SYFS_SESSIONS', { op: 'list' }, function (res) {
        if (!res.ok) { status(st, t('تعذّرت قراءة الجلسات.'), true); return; }
        sessions = res.sessions; render();
      });
    }
    body.querySelector('#ss-save').addEventListener('click', function () {
      ask('SYFS_SESSIONS', { op: 'save', name: nameIn.value.trim() }, function (res) {
        if (!res.ok) { status(st, res.error === 'no-tabs' ? noTabsMsg() : t('تعذّر الحفظ.'), true); return; }
        nameIn.value = ''; status(st, t('حُفظت {0} تبويباً.', res.session.tabs.length)); load();
      });
    });
    load();
  }

  /* ======================================================================
   * 3) أرشيف ZIP — SYFS.imgkit.zipRead / zipWrite (shipped since the Word engine)
   * ==================================================================== */
  var ZIP_ERR = { 'not-a-zip': 'ليس ملفّ ZIP صالحاً.', 'zip-too-big': 'الأرشيف ينتفخ فوق 200 م.ب — رُفض.', 'too-many-entries': 'أكثر من 5000 مدخل — رُفض.', 'inflate-unsupported': 'المتصفّح لا يدعم فكّ الضغط.' };
  var TEXT_EXT = /\.(txt|md|csv|tsv|json|xml|html?|css|js|ts|yml|yaml|ini|log|env|sql|svg)$/i;
  function mountZipRead(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<input type="file" id="zr-f" accept=".zip,application/zip" class="syf-in" style="padding:6px">' +
        '<div class="syf-row"><input class="syf-in" id="zr-q" placeholder="تصفية…" style="flex:1"><button class="syf-mini" id="zr-all">⬇ تنزيل الكلّ</button></div>' +
        '<div class="syf-note-hint" id="zr-info"></div>' +
        '<div class="syf-note-list" id="zr-list" style="max-height:300px;overflow:auto"></div>' +
        '<textarea class="syf-in syf-mono" id="zr-view" rows="8" readonly style="display:none"></textarea>' +
        '<div class="syf-empty" id="zr-st" style="display:none"></div>' +
        '<div class="syf-note-hint">يُفكّ في الذاكرة محلّياً. الحدود: 200 م.ب بعد الفكّ و5000 مدخل، والمسارات المطلقة و«..» تُرفض.</div>' +
      '</div>'));
    var fIn = body.querySelector('#zr-f'), q = body.querySelector('#zr-q'), info = body.querySelector('#zr-info'),
        list = body.querySelector('#zr-list'), view = body.querySelector('#zr-view'), st = body.querySelector('#zr-st'), allB = body.querySelector('#zr-all');
    var entries = [];
    function render() {
      list.textContent = ''; view.style.display = 'none';
      var f = q.value.trim().toLowerCase();
      var shown = entries.filter(function (e) { return !f || e.name.toLowerCase().indexOf(f) >= 0; });
      if (!shown.length) { list.appendChild(h('<div class="syf-empty">لا مدخلات.</div>')); return; }
      shown.forEach(function (e) {
        var r = h('<div class="syf-note-row"><span class="t syf-mono" style="flex:1;font-size:12px;word-break:break-all"></span><span class="t" style="font-size:11px;opacity:.7"></span><button class="syf-mini v" style="display:none">عرض</button><button class="syf-mini d">⬇</button></div>');
        /* i18n-dyn: an archive entry's path — file data */
        r.querySelector('.t').textContent = e.name;
        r.querySelectorAll('.t')[1].textContent = fmtBytes(e.data.length);
        var vb = r.querySelector('.v');
        if (TEXT_EXT.test(e.name) && e.data.length <= 200 * 1024) {
          vb.style.display = '';
          vb.addEventListener('click', function () { view.value = new TextDecoder('utf-8').decode(e.data); view.style.display = ''; });
        }
        r.querySelector('.d').addEventListener('click', function () { dlBlob(new Blob([e.data]), e.name.split('/').pop()); });
        list.appendChild(r);
      });
    }
    fIn.addEventListener('change', async function () {
      var f = fIn.files && fIn.files[0]; if (!f) return;
      entries = []; render(); info.textContent = t('قراءة…'); st.style.display = 'none';
      try {
        var out = await SYFS.imgkit.zipRead(f);
        var total = 0;
        Object.keys(out).forEach(function (k) { entries.push({ name: k, data: out[k] }); total += out[k].length; });
        entries.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
        /* i18n-dyn: the user's own file name */
        info.textContent = f.name + ' — ' + t('{0} ملفاً · {1} بعد الفكّ', entries.length, fmtBytes(total));
        render();
      } catch (e) {
        info.textContent = '';
        /* i18n-dyn: ZIP_ERR values are msgids read through t() */
        status(st, t(ZIP_ERR[e && e.message] || 'تعذّرت قراءة الأرشيف.'), true);
      }
    });
    q.addEventListener('input', render);
    allB.addEventListener('click', async function () {
      if (!entries.length) return;
      for (var i = 0; i < entries.length; i++) {
        dlBlob(new Blob([entries[i].data]), entries[i].name.split('/').pop());
        await new Promise(function (r) { setTimeout(r, 350); });
      }
    });
  }
  function mountZipWrite(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<input type="file" id="zw-f" multiple class="syf-in" style="padding:6px">' +
        '<div class="syf-note-list" id="zw-list"></div>' +
        '<div class="syf-row"><input class="syf-in" id="zw-name" placeholder="اسم الأرشيف" value="archive"><button class="syf-btn" id="zw-go">إنشاء ZIP وتنزيل</button></div>' +
        '<div class="syf-empty" id="zw-st" style="display:none"></div>' +
      '</div>'));
    var fIn = body.querySelector('#zw-f'), list = body.querySelector('#zw-list'), nameIn = body.querySelector('#zw-name'),
        goB = body.querySelector('#zw-go'), st = body.querySelector('#zw-st');
    var files = [];
    function render() {
      list.textContent = '';
      if (!files.length) { list.appendChild(h('<div class="syf-empty">لم تختر ملفات بعد.</div>')); return; }
      var total = 0;
      files.forEach(function (f, i) {
        total += f.size;
        var r = h('<div class="syf-note-row"><span class="t" style="flex:1"></span><button class="x">✕</button></div>');
        /* i18n-dyn: the user's own file name */
        r.querySelector('.t').textContent = f.name + ' — ' + fmtBytes(f.size);
        r.querySelector('.x').addEventListener('click', function () { files.splice(i, 1); render(); });
        list.appendChild(r);
      });
      list.appendChild(row(t('المجموع'), t('{0} ملفاً · {1}', files.length, fmtBytes(total))));
    }
    fIn.addEventListener('change', function () {
      Array.prototype.forEach.call(fIn.files || [], function (f) { files.push(f); });
      fIn.value = ''; render();
    });
    render();
    goB.addEventListener('click', async function () {
      if (!files.length) { fIn.focus(); return; }
      if (goB.disabled) return;
      var orig = goB.textContent; goB.disabled = true; goB.textContent = t('ضغط…');
      try {
        var zip = await SYFS.imgkit.zipWrite(files.map(function (f) { return { name: f.name, blob: f }; }));
        dlBlob(zip, safeBase(nameIn.value || 'archive') + '.zip');
        status(st, t('تمّ ✓ — {0}', fmtBytes(zip.size)));
      } catch (e) { status(st, t('تعذّر الإنشاء.'), true); }
      finally { goB.disabled = false; goB.textContent = orig; }
    });
  }

  /* ======================================================================
   * 4) فرق نصّين — lines, then words inside a changed pair. RTL-safe (dir=auto).
   * ==================================================================== */
  var DIFF_CAP = 3000;
  function lcs(a, b) {
    var n = a.length, m = b.length, i, j, tbl = new Array(n + 1);
    for (i = 0; i <= n; i++) tbl[i] = new Int32Array(m + 1);
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) tbl[i][j] = a[i] === b[j] ? tbl[i + 1][j + 1] + 1 : Math.max(tbl[i + 1][j], tbl[i][j + 1]);
    var ops = []; i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { ops.push(['=', a[i]]); i++; j++; }
      else if (tbl[i + 1][j] >= tbl[i][j + 1]) { ops.push(['-', a[i]]); i++; }
      else { ops.push(['+', b[j]]); j++; }
    }
    while (i < n) ops.push(['-', a[i++]]);
    while (j < m) ops.push(['+', b[j++]]);
    return ops;
  }
  /* word-level ops for one changed line pair; tokens keep their whitespace so the
     line re-reads exactly. Capped: a 2000-token line is a paragraph, not a line. */
  function diffWords(a, b) {
    var ta = a.match(/\S+\s*|\s+/g) || [], tb = b.match(/\S+\s*|\s+/g) || [];
    if (ta.length > 2000 || tb.length > 2000) return null;
    return lcs(ta, tb);
  }
  function mountTextDiff(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<div class="syf-row" style="align-items:stretch"><textarea class="syf-in" id="td-a" rows="6" placeholder="النصّ الأصلي…" dir="auto" style="flex:1"></textarea><textarea class="syf-in" id="td-b" rows="6" placeholder="النصّ المُعدَّل…" dir="auto" style="flex:1"></textarea></div>' +
        '<div class="syf-row"><button class="syf-btn" id="td-go" style="flex:1">قارِن</button><button class="syf-mini" id="td-swap">⇄ بدّل</button><button class="syf-mini" id="td-copy">نسخ الناتج</button></div>' +
        '<label class="syf-ck"><input type="checkbox" id="td-ws" checked> <span>تجاهل الفراغات الزائدة وعلامات الترقيم الطرفية</span></label>' +
        '<div class="syf-out" id="td-sum" style="display:none;grid-template-columns:1fr 1fr 1fr"><div><span>أسطر مضافة</span><b id="td-add">0</b></div><div><span>أسطر محذوفة</span><b id="td-del">0</b></div><div><span>بلا تغيير</span><b id="td-same">0</b></div></div>' +
        '<div id="td-out" style="max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:10px;display:none;font-size:13px;line-height:1.7"></div>' +
        '<div class="syf-note-hint">محلّي بالكامل — عقود ونصوص داخلية لا تُلصق في مواقع مقارنة عامّة. الأحمر محذوف والأخضر مضاف، والكلمات المتغيّرة داخل السطر مظلَّلة.</div>' +
      '</div>'));
    var A = body.querySelector('#td-a'), B = body.querySelector('#td-b'), out = body.querySelector('#td-out'), sum = body.querySelector('#td-sum'), ws = body.querySelector('#td-ws');
    var lastText = '';
    function norm(s) { return ws.checked ? s.replace(/\s+/g, ' ').trim() : s; }
    function line(sign, spans) {
      var r = document.createElement('div');
      r.style.cssText = 'display:flex;gap:8px;padding:2px 8px;white-space:pre-wrap;word-break:break-word;' + (sign === '+' ? 'background:rgba(34,160,90,.12)' : sign === '-' ? 'background:rgba(220,60,60,.12)' : '');
      var g = document.createElement('span'); g.style.cssText = 'flex:0 0 1.2em;opacity:.55;user-select:none'; g.textContent = sign === '=' ? ' ' : sign;
      var tx = document.createElement('span'); tx.style.flex = '1'; tx.dir = 'auto';
      spans.forEach(function (p) {
        /* i18n-dyn: a diff token — the user's own text */
        var s = document.createElement('span'); s.textContent = p[1];          /* ⛔ user text — textContent only */
        if (p[0] === '+') s.style.cssText = 'background:rgba(34,160,90,.35);border-radius:3px';
        if (p[0] === '-') s.style.cssText = 'background:rgba(220,60,60,.35);border-radius:3px;text-decoration:line-through';
        tx.appendChild(s);
      });
      r.appendChild(g); r.appendChild(tx); return r;
    }
    function run() {
      var la = A.value.replace(/\r\n?/g, '\n').split('\n'), lb = B.value.replace(/\r\n?/g, '\n').split('\n');
      var capped = la.length > DIFF_CAP || lb.length > DIFF_CAP;
      la = la.slice(0, DIFF_CAP); lb = lb.slice(0, DIFF_CAP);
      var ka = la.map(norm), kb = lb.map(norm);
      var ops = lcs(ka, kb), ia = 0, ib = 0, add = 0, del = 0, same = 0, text = [];
      out.textContent = '';
      for (var i = 0; i < ops.length; i++) {
        var o = ops[i];
        if (o[0] === '=') { same++; text.push('  ' + la[ia]); out.appendChild(line('=', [['=', la[ia]]])); ia++; ib++; continue; }
        /* a «-» immediately followed by «+» is an edited line: show the words that moved */
        if (o[0] === '-' && ops[i + 1] && ops[i + 1][0] === '+') {
          var w = diffWords(la[ia], lb[ib]);
          del++; add++; text.push('- ' + la[ia], '+ ' + lb[ib]);
          if (w) {
            out.appendChild(line('-', w.filter(function (p) { return p[0] !== '+'; })));
            out.appendChild(line('+', w.filter(function (p) { return p[0] !== '-'; })));
          } else { out.appendChild(line('-', [['-', la[ia]]])); out.appendChild(line('+', [['+', lb[ib]]])); }
          ia++; ib++; i++; continue;
        }
        if (o[0] === '-') { del++; text.push('- ' + la[ia]); out.appendChild(line('-', [['-', la[ia]]])); ia++; }
        else { add++; text.push('+ ' + lb[ib]); out.appendChild(line('+', [['+', lb[ib]]])); ib++; }
      }
      if (capped) { var n = h('<div class="syf-note-hint" style="padding:6px 8px"></div>'); n.textContent = t('قُورن أول {0} سطر فقط من كل نصّ.', DIFF_CAP); out.appendChild(n); }
      body.querySelector('#td-add').textContent = add; body.querySelector('#td-del').textContent = del; body.querySelector('#td-same').textContent = same;
      sum.style.display = ''; out.style.display = ''; lastText = text.join('\n');
    }
    body.querySelector('#td-go').addEventListener('click', run);
    body.querySelector('#td-swap').addEventListener('click', function () { var v = A.value; A.value = B.value; B.value = v; if (out.style.display !== 'none') run(); });
    body.querySelector('#td-copy').addEventListener('click', function () { if (lastText) copy(lastText); });
  }

  /* ======================================================================
   * 5) احفظ المقال — extract → Markdown. Walks the LIVE node (so hidden blocks can
   *    be skipped) and emits text only; links/images only with an http(s) target.
   * ==================================================================== */
  var MD_SKIP = /^(script|style|noscript|iframe|svg|canvas|video|audio|button|form|input|select|textarea|nav|aside|footer|template|object|embed)$/;
  /* \x60 is the backtick — spelled as an escape so the i18n extractor's string scanner
     never sees a quote character inside a regex literal (§6.103/1 family) */
  function mdEsc(s) { return s.replace(/[\\\x60*_\[\]]/g, function (c) { return '\\' + c; }); }
  function hidden(el) { try { var cs = getComputedStyle(el); return cs.display === 'none' || cs.visibility === 'hidden'; } catch (e) { return false; } }
  function domToMd(root, opts) {
    opts = opts || {};
    var out = [];
    function inline(node) {
      var s = '';
      Array.prototype.forEach.call(node.childNodes, function (c) {
        if (c.nodeType === 3) { s += mdEsc(c.nodeValue.replace(/\s+/g, ' ')); return; }
        if (c.nodeType !== 1) return;
        var tag = c.tagName.toLowerCase();
        if (MD_SKIP.test(tag) || (opts.live && hidden(c))) return;
        if (tag === 'br') { s += '  \n'; return; }
        if (tag === 'img') { var src = safeUrl(c.getAttribute('src')); if (src) s += '![' + mdEsc(c.getAttribute('alt') || '') + '](' + src + ')'; return; }
        var inner = inline(c);
        if (!inner.trim()) { s += inner; return; }
        if (tag === 'strong' || tag === 'b') s += '**' + inner.trim() + '**';
        else if (tag === 'em' || tag === 'i') s += '_' + inner.trim() + '_';
        else if (tag === 'code') s += '`' + inner.replace(/`/g, '') + '`';
        else if (tag === 'a') { var href = safeUrl(c.getAttribute('href')); s += href ? '[' + inner.trim() + '](' + href + ')' : inner; }
        else s += inner;
      });
      return s;
    }
    /* one list → its lines (nested lists indent two spaces per level) */
    function listLines(listEl, depth) {
      var lines = [], n = 0, ind = new Array(depth + 1).join('  ');
      Array.prototype.forEach.call(listEl.children, function (li) {
        if (li.tagName.toLowerCase() !== 'li') return;
        n++;
        var own = '', subs = [];
        Array.prototype.forEach.call(li.childNodes, function (x) {
          if (x.nodeType === 1 && /^(ul|ol)$/i.test(x.tagName)) subs.push(x);
          else if (x.nodeType === 1 && !MD_SKIP.test(x.tagName.toLowerCase())) own += inline(x);
          else if (x.nodeType === 3) own += mdEsc(x.nodeValue.replace(/\s+/g, ' '));
        });
        lines.push(ind + (listEl.tagName.toLowerCase() === 'ol' ? n + '. ' : '- ') + own.trim());
        subs.forEach(function (s) { lines = lines.concat(listLines(s, depth + 1)); });
      });
      return lines;
    }
    /* every push is ONE block; blocks are joined by a blank line at the end */
    function block(node) {
      Array.prototype.forEach.call(node.childNodes, function (c) {
        if (c.nodeType === 3) { var tx = c.nodeValue.trim(); if (tx) out.push(mdEsc(tx.replace(/\s+/g, ' '))); return; }
        if (c.nodeType !== 1) return;
        var tag = c.tagName.toLowerCase();
        if (MD_SKIP.test(tag) || (opts.live && hidden(c))) return;
        var m = /^h([1-6])$/.exec(tag);
        if (m) { var ht = inline(c).trim(); if (ht) out.push(new Array(+m[1] + 1).join('#') + ' ' + ht); return; }
        if (tag === 'p') { var pt = inline(c).trim(); if (pt) out.push(pt); return; }
        if (tag === 'pre') { out.push('```\n' + c.textContent.replace(/```/g, '') + '\n```'); return; }
        if (tag === 'hr') { out.push('---'); return; }
        if (tag === 'blockquote') { var q = domToMd(c, opts).trim().split('\n').map(function (l) { return '> ' + l; }).join('\n'); if (q) out.push(q); return; }
        if (tag === 'ul' || tag === 'ol') { var ll = listLines(c, 0); if (ll.length) out.push(ll.join('\n')); return; }
        if (tag === 'table') {
          var rows = [];
          Array.prototype.forEach.call(c.querySelectorAll('tr'), function (tr) {
            rows.push(Array.prototype.map.call(tr.children, function (td) { return inline(td).trim().replace(/\|/g, '\\|'); }));
          });
          if (rows.length) {
            var w = Math.max.apply(null, rows.map(function (r) { return r.length; })), lines = [];
            rows.forEach(function (r, i) {
              while (r.length < w) r.push('');
              lines.push('| ' + r.join(' | ') + ' |');
              if (i === 0) lines.push('|' + new Array(w + 1).join(' --- |'));
            });
            out.push(lines.join('\n'));
          }
          return;
        }
        if (tag === 'img' || tag === 'a' || tag === 'span' || tag === 'strong' || tag === 'em' || tag === 'b' || tag === 'i' || tag === 'code') {
          var it = inline({ childNodes: [c] }).trim(); if (it) out.push(it); return;
        }
        block(c);
      });
    }
    block(root);
    return out.join('\n\n').trim() + '\n';
  }
  /* a print window: our own nodes only, styled through CSSOM (a <style> element would
     sit under the host page's CSP; element.style does not) */
  function printNodes(title, nodes) {
    var w = window.open('', '_blank');
    if (!w) return false;
    var d = w.document;
    d.title = title || '';
    d.documentElement.dir = (SYFS.i18n && SYFS.i18n.dir) ? SYFS.i18n.dir() : 'rtl';
    d.body.style.cssText = 'font:17px/1.8 Georgia,"Times New Roman",serif;max-width:760px;margin:24px auto;padding:0 24px;color:#111';
    var hd = d.createElement('h1'); hd.textContent = title || ''; hd.style.cssText = 'font-size:1.6em;line-height:1.3'; d.body.appendChild(hd);
    nodes.forEach(function (n) { d.body.appendChild(d.importNode(n, true)); });
    Array.prototype.forEach.call(d.body.querySelectorAll('img'), function (im) { im.style.maxWidth = '100%'; });
    setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 400);
    return true;
  }
  function cleanClone(src) {
    var clone = src.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,iframe,button,form,nav,aside,svg,canvas,video,audio,[role="navigation"]').forEach(function (n) { n.remove(); });
    clone.querySelectorAll('*').forEach(function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (a) {
        var k = a.name.toLowerCase();
        if (k.indexOf('on') === 0 || (k !== 'href' && k !== 'src' && k !== 'alt' && k !== 'title' && k !== 'colspan' && k !== 'rowspan')) n.removeAttribute(a.name);
      });
      if (n.tagName === 'A' && !safeUrl(n.getAttribute('href'))) n.removeAttribute('href');
      if (n.tagName === 'IMG' && !safeUrl(n.getAttribute('src'))) n.remove();
    });
    return clone;
  }
  function mountReadSave(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<button class="syf-btn" id="rs-go">📰 استخلاص المقال من هذه الصفحة</button>' +
        '<div id="rs-res" style="display:none">' +
          '<label>العنوان</label><input class="syf-in" id="rs-title">' +
          '<label>Markdown</label><textarea class="syf-in" id="rs-md" rows="10" dir="auto"></textarea>' +
          '<div class="syf-note-hint" id="rs-info"></div>' +
          '<div class="syf-row"><button class="syf-mini" id="rs-copy">نسخ</button><button class="syf-mini" id="rs-dl">⬇ .md</button><button class="syf-mini" id="rs-print">🖨 طباعة / PDF</button><button class="syf-btn" id="rs-note">حفظ في الملاحظات</button></div>' +
        '</div>' +
        '<div class="syf-empty" id="rs-st" style="display:none"></div>' +
        '<div class="syf-note-hint">وضع القراءة يعرض ولا يحفظ؛ هذا يستخلص المقال نفسه ويصدّره لتقرأه لاحقاً بلا إنترنت. محلّي بالكامل — لا تلخيص ولا إرسال لأي جهة.</div>' +
      '</div>'));
    var res = body.querySelector('#rs-res'), titleIn = body.querySelector('#rs-title'), md = body.querySelector('#rs-md'), info = body.querySelector('#rs-info'), st = body.querySelector('#rs-st');
    var article = null;
    body.querySelector('#rs-go').addEventListener('click', function () {
      article = SYFS.findArticle ? SYFS.findArticle() : null;
      if (!article) { status(st, t('تعذّر استخراج محتوى قابل للقراءة من هذه الصفحة.'), true); return; }
      st.style.display = 'none';
      titleIn.value = document.title || '';
      var text = domToMd(article, { live: true });
      md.value = text; res.style.display = '';
      var words = (text.match(/\S+/g) || []).length;
      info.textContent = t('{0} كلمة · ~{1} دقيقة قراءة', words, Math.max(1, Math.ceil(words / 200)));
    });
    body.querySelector('#rs-copy').addEventListener('click', function () { copy(md.value); });
    body.querySelector('#rs-dl').addEventListener('click', function () {
      var head = '# ' + titleIn.value.trim() + '\n\n' + (safeUrl(location.href) ? '[' + t('المصدر') + '](' + location.href.split('#')[0] + ')\n\n' : '');
      dlBlob(new Blob([head + md.value], { type: 'text/markdown;charset=utf-8' }), safeBase(titleIn.value || 'article') + '.md');
    });
    body.querySelector('#rs-print').addEventListener('click', function () {
      if (!article) return;
      if (!printNodes(titleIn.value, [cleanClone(article)])) status(st, t('المتصفّح منع فتح نافذة الطباعة.'), true);
    });
    body.querySelector('#rs-note').addEventListener('click', function () {
      store.get('notes', []).then(function (v) {
        var notes = Array.isArray(v) ? v : [];
        notes.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), title: titleIn.value.trim().slice(0, 200), body: md.value.slice(0, 200000) });
        return store.set('notes', notes);
      }).then(function () { status(st, t('حُفظ في «ملاحظات» ✓')); });
    });
  }

  /* ======================================================================
   * 6) الفرق بين تاريخين + أيام العمل
   * ==================================================================== */
  var WEEKENDS = { fs: [5, 6], ss: [6, 0], f: [5], s: [0] };
  /* Saudi official holidays by the Hijri/Gregorian calendar: Eid al-Fitr 1–3 Shawwal,
     Eid al-Adha 9–13 Dhu al-Hijjah, National Day 23 Sep, Founding Day 22 Feb. Announced
     as a list the user can switch off — actual decrees move by a day or two. */
  function holidayKey(d, hj) {
    if (d.getMonth() === 8 && d.getDate() === 23) return 'اليوم الوطني';
    if (d.getMonth() === 1 && d.getDate() === 22) return 'يوم التأسيس';
    if (hj) {
      if (hj.m === 10 && hj.d >= 1 && hj.d <= 3) return 'عيد الفطر';
      if (hj.m === 12 && hj.d >= 9 && hj.d <= 13) return 'عيد الأضحى';
    }
    return null;
  }
  function dayCount(a, b) { return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000); }
  /* walk a → b (exclusive of b), counting work days; hijriFn(date) → {y,m,d}|null */
  function workDays(a, b, weekend, holidays, hijriFn) {
    var sign = 1; if (b < a) { var x = a; a = b; b = x; sign = -1; }
    var n = dayCount(a, b), work = 0, we = 0, hol = 0, seen = {};
    for (var i = 0; i < n; i++) {
      var d = new Date(a.getFullYear(), a.getMonth(), a.getDate() + i);
      if (weekend.indexOf(d.getDay()) >= 0) { we++; continue; }
      var k = holidays ? holidayKey(d, hijriFn ? hijriFn(d) : null) : null;
      if (k) { hol++; seen[k] = 1; continue; }
      work++;
    }
    return { days: n * sign, work: work * sign, weekend: we, holidays: hol, names: Object.keys(seen) };
  }
  function addWorkDays(a, n, weekend, holidays, hijriFn) {
    var d = new Date(a.getFullYear(), a.getMonth(), a.getDate()), step = n < 0 ? -1 : 1, left = Math.abs(n), guard = 0;
    while (left > 0 && guard++ < 20000) {
      d.setDate(d.getDate() + step);
      if (weekend.indexOf(d.getDay()) >= 0) continue;
      if (holidays && holidayKey(d, hijriFn ? hijriFn(d) : null)) continue;
      left--;
    }
    return d;
  }
  /* calendar breakdown: the largest y, then m, such that a + y years + m months ≤ b,
     then the remaining days. Month steps clamp the day (31 Jan + 1 month = 29 Feb),
     which is what «a month later» means on a payslip — a borrow-and-carry on the
     three fields goes negative on exactly those dates. */
  function addMonths(d, n) {
    var x = new Date(d.getFullYear(), d.getMonth() + n, 1);
    x.setDate(Math.min(d.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
    return x;
  }
  function ymd(a, b) {
    if (b < a) { var x = a; a = b; b = x; }
    var y = 0, m = 0;
    while (addMonths(a, (y + 1) * 12) <= b) y++;
    while (addMonths(a, y * 12 + m + 1) <= b) m++;
    return { y: y, m: m, d: dayCount(addMonths(a, y * 12 + m), b) };
  }
  var HJ_MONTHS = ['محرّم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'];
  function mountDateDiff(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<div class="syf-seg" id="dd-mode"><button class="on" data-m="diff">الفرق بين تاريخين</button><button data-m="add">إضافة / طرح</button></div>' +
        '<div data-ddv="diff"><div class="syf-row"><div style="flex:1"><label>من</label><input type="date" class="syf-in" id="dd-a"></div><div style="flex:1"><label>إلى</label><input type="date" class="syf-in" id="dd-b"></div></div></div>' +
        '<div data-ddv="add" style="display:none"><label>التاريخ</label><input type="date" class="syf-in" id="dd-base"><div class="syf-row"><input type="number" class="syf-in" id="dd-n" value="30" step="1"><select class="syf-in" id="dd-unit"><option value="d">يوماً</option><option value="w">يوم عمل</option><option value="wk">أسبوعاً</option><option value="m">شهراً</option></select></div></div>' +
        '<div class="syf-row"><select class="syf-in" id="dd-we"><option value="fs">عطلة الأسبوع: الجمعة والسبت</option><option value="ss">السبت والأحد</option><option value="f">الجمعة فقط</option><option value="s">الأحد فقط</option></select></div>' +
        '<label class="syf-ck"><input type="checkbox" id="dd-hol" checked> <span>استثنِ العطل الرسمية (السعودية: العيدان · اليوم الوطني · يوم التأسيس)</span></label>' +
        '<div class="syf-out" id="dd-o" style="grid-template-columns:1fr 1fr"></div>' +
        '<div class="syf-note-hint">حساب بالأيام الكاملة على التاريخ المحلّي. الهجري بتقويم أم القرى مع معايرة «المناسبات». العطل الرسمية تقديرية بالتقويم — القرار الفعلي قد يزيد يوماً.</div>' +
      '</div>'));
    var A = body.querySelector('#dd-a'), B = body.querySelector('#dd-b'), base = body.querySelector('#dd-base'), N = body.querySelector('#dd-n'), U = body.querySelector('#dd-unit'),
        WE = body.querySelector('#dd-we'), HOL = body.querySelector('#dd-hol'), O = body.querySelector('#dd-o'), mode = 'diff', offset = 0;
    A.value = B.value = base.value = todayISO();
    store.get('occasions', null).then(function (raw) { if (SYFS.occ) offset = SYFS.occ.settings(raw).offset; run(); });
    function hj(d) { return SYFS.occ ? SYFS.occ.hijri(d, offset) : null; }
    function hjText(d) { var x = hj(d); return x ? num(x.d) + ' ' + t(HJ_MONTHS[x.m - 1]) + ' ' + num(x.y) : '—'; }
    function cell(label, val, wide) { var r = h('<div><span></span><b></b></div>'); r.querySelector('span').textContent = label; r.querySelector('b').textContent = val; if (wide) r.style.gridColumn = '1 / -1'; O.appendChild(r); }
    function run() {
      O.textContent = '';
      var we = WEEKENDS[WE.value] || WEEKENDS.fs;
      if (mode === 'diff') {
        var a = localDate(A.value), b = localDate(B.value);
        if (!a || !b) return;
        var r = workDays(a, b, we, HOL.checked, hj), p = ymd(a, b);
        cell(t('الأيام'), num(r.days));
        cell(t('أيام العمل'), num(r.work));
        cell(t('أسابيع'), t('{0} أسبوعاً و{1} يوماً', num(Math.floor(Math.abs(r.days) / 7)), num(Math.abs(r.days) % 7)));
        cell(t('سنة / شهر / يوم'), num(p.y) + ' / ' + num(p.m) + ' / ' + num(p.d));
        cell(t('عطل نهاية الأسبوع'), num(r.weekend));
        cell(t('عطل رسمية'), num(r.holidays) + (r.names.length ? ' (' + r.names.map(function (k) { return t(k); }).join('، ') + ')' : ''));
        cell(t('من — هجري'), hjText(a)); cell(t('إلى — هجري'), hjText(b));
      } else {
        var d0 = localDate(base.value), n = parseInt(N.value, 10) || 0, d;
        if (!d0) return;
        if (U.value === 'w') d = addWorkDays(d0, n, we, HOL.checked, hj);
        else if (U.value === 'wk') d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + n * 7);
        else if (U.value === 'm') d = addMonths(d0, n);   /* 31 Jan + 1 month = end of Feb, not 3 March */
        else d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + n);
        cell(t('النتيجة'), fmtDate(d), true);
        cell(t('هجري'), hjText(d));
        cell(t('أيام تقويمية'), num(dayCount(d0, d)));
      }
    }
    body.querySelector('#dd-mode').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      mode = b.dataset.m;
      this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      body.querySelectorAll('[data-ddv]').forEach(function (v) { v.style.display = v.getAttribute('data-ddv') === mode ? '' : 'none'; });
      run();
    });
    [A, B, base, N, U, WE, HOL].forEach(function (el) { el.addEventListener('change', run); el.addEventListener('input', run); });
    run();
  }

  /* ======================================================================
   * 7) سجلّ وقت المهام — `timelog` = { run: {x, s} | null, e: [{x, s, e}] }
   *    No interval outlives the panel: the running entry is a START TIMESTAMP in
   *    storage, so closing the tab loses nothing and there is nothing to «keep alive».
   * ==================================================================== */
  var TL_KEY = 'timelog', TL_MAX = 2000, TL_TASK_MAX = 120;
  function tlClean(raw) {
    var o = (raw && typeof raw === 'object') ? raw : {};
    var run = (o.run && typeof o.run === 'object' && typeof o.run.x === 'string' && isFinite(o.run.s)) ? { x: o.run.x.slice(0, TL_TASK_MAX), s: +o.run.s } : null;
    var e = Array.isArray(o.e) ? o.e.filter(function (x) { return x && typeof x.x === 'string' && isFinite(x.s) && isFinite(x.e) && x.e >= x.s; })
      .map(function (x) { return { x: x.x.slice(0, TL_TASK_MAX), s: +x.s, e: +x.e }; }).slice(-TL_MAX) : [];
    return { run: run, e: e };
  }
  /* per-task totals for entries touching [from, to) */
  function tlReport(entries, from, to) {
    var by = {}, total = 0;
    entries.forEach(function (x) {
      var s = Math.max(x.s, from), e = Math.min(x.e, to);
      if (e <= s) return;
      by[x.x] = (by[x.x] || 0) + (e - s); total += e - s;
    });
    var rows = Object.keys(by).map(function (k) { return { x: k, ms: by[k] }; }).sort(function (a, b) { return b.ms - a.ms; });
    return { rows: rows, total: total };
  }
  function mountTimeLog(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<div class="syf-row"><input class="syf-in" id="tl-x" list="tl-dl" placeholder="المهمّة…" style="flex:1"><datalist id="tl-dl"></datalist><button class="syf-btn" id="tl-go">▶ ابدأ</button></div>' +
        '<div class="syf-out" style="grid-template-columns:1fr 1fr"><div><span>الجارية</span><b id="tl-cur" class="syf-mono">00:00:00</b></div><div><span>اليوم</span><b id="tl-day" class="syf-mono">00:00:00</b></div></div>' +
        '<div class="syf-seg" id="tl-view"><button class="on" data-v="today">اليوم</button><button data-v="week">تقرير الأسبوع</button></div>' +
        '<div class="syf-note-list" id="tl-list"></div>' +
        '<div class="syf-row"><button class="syf-mini" id="tl-copy">نسخ التقرير</button><button class="syf-mini" id="tl-clear">مسح سجلّ الأسبوع</button></div>' +
        '<div class="syf-note-hint">المؤقّت وقت بدء مخزَّن لا عدّاد — أغلق التبويب وعُد، الوقت مستمرّ. أعمال اليوم من «التقويم والمهام» تُقترح في الحقل.</div>' +
      '</div>'));
    var X = body.querySelector('#tl-x'), go = body.querySelector('#tl-go'), cur = body.querySelector('#tl-cur'), dayEl = body.querySelector('#tl-day'),
        list = body.querySelector('#tl-list'), dl = body.querySelector('#tl-dl');
    X.maxLength = TL_TASK_MAX;
    var data = { run: null, e: [] }, view = 'today', lastReport = '';
    function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
    function save() { return store.set(TL_KEY, data); }
    function suggest() {
      dl.textContent = '';
      var names = {};
      store.get('cal_days', {}).then(function (days) {
        var today = (days && days[dkey(new Date())]) || {};
        (Array.isArray(today.t) ? today.t : []).forEach(function (tk) { if (tk && !tk.d && typeof tk.x === 'string' && tk.x.trim()) names[tk.x.trim()] = 1; });
        data.e.slice(-40).forEach(function (x) { names[x.x] = 1; });
        Object.keys(names).forEach(function (n) { var o = document.createElement('option'); o.value = n; dl.appendChild(o); });
      });
    }
    function paintRun() {
      var now = Date.now();
      cur.textContent = data.run ? hms(now - data.run.s) : '00:00:00';
      var ds = dayStart(new Date()), rep = tlReport(data.e.concat(data.run ? [{ x: data.run.x, s: data.run.s, e: now }] : []), ds, ds + 86400000);
      dayEl.textContent = hms(rep.total);
      go.textContent = data.run ? t('■ أوقف') : t('▶ ابدأ');
      if (data.run) X.value = data.run.x;
      X.readOnly = !!data.run;
    }
    function render() {
      list.textContent = '';
      var now = Date.now(), ds = dayStart(new Date());
      if (view === 'today') {
        var todays = data.e.filter(function (x) { return x.e > ds; });
        if (!todays.length) { list.appendChild(h('<div class="syf-empty">لا سجلّات اليوم.</div>')); lastReport = ''; return; }
        var lines = [];
        todays.slice().reverse().forEach(function (x) {
          var r = h('<div class="syf-note-row"><span class="t" style="flex:1"></span><b class="syf-mono"></b><button class="x" title="حذف">✕</button></div>');
          var tm = new Date(x.s).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }) + '–' + new Date(x.e).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' });
          r.querySelector('.t').textContent = x.x + ' · ' + tm;           /* task names — user data */
          r.querySelector('b').textContent = hms(x.e - x.s);
          r.querySelector('.x').addEventListener('click', function () { var i = data.e.indexOf(x); if (i >= 0) data.e.splice(i, 1); save().then(function () { render(); paintRun(); }); });
          list.appendChild(r);
          lines.push(x.x + '\t' + tm + '\t' + hms(x.e - x.s));
        });
        lastReport = lines.join('\n');
      } else {
        var from = ds - 6 * 86400000, rep = tlReport(data.e, from, now), lines2 = [t('تقرير الأسبوع') + ' ' + dkey(new Date(from)) + ' → ' + dkey(new Date())];
        if (!rep.rows.length) { list.appendChild(h('<div class="syf-empty">لا سجلّات في آخر سبعة أيام.</div>')); lastReport = ''; return; }
        rep.rows.forEach(function (r0) {
          var r = row(r0.x, hms(r0.ms) + ' · ' + Math.round(r0.ms / rep.total * 100) + '%');
          r.querySelector('b').className = 'syf-mono'; list.appendChild(r);
          lines2.push(r0.x + '\t' + hms(r0.ms));
        });
        list.appendChild(row(t('المجموع'), hms(rep.total)));
        lines2.push(t('المجموع') + '\t' + hms(rep.total));
        lastReport = lines2.join('\n');
      }
    }
    go.addEventListener('click', function () {
      if (data.run) {
        data.e.push({ x: data.run.x, s: data.run.s, e: Math.max(data.run.s + 1000, Date.now()) });
        if (data.e.length > TL_MAX) data.e.splice(0, data.e.length - TL_MAX);
        data.run = null; X.value = '';
      } else {
        var x = X.value.trim(); if (!x) { X.focus(); return; }
        data.run = { x: x, s: Date.now() };
      }
      save().then(function () { paintRun(); render(); suggest(); });
    });
    body.querySelector('#tl-view').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      view = b.dataset.v; this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); render();
    });
    body.querySelector('#tl-copy').addEventListener('click', function () { if (lastReport) copy(lastReport); });
    armed(body.querySelector('#tl-clear'), t('مسح سجلّ الأسبوع'), function () {
      var from = dayStart(new Date()) - 6 * 86400000;
      data.e = data.e.filter(function (x) { return x.e < from; });
      save().then(render);
    });
    store.get(TL_KEY, null).then(function (raw) { data = tlClean(raw); paintRun(); render(); suggest(); });
    try {
      chrome.storage.onChanged.addListener(function onCh(ch, area) {
        if (!body.isConnected) { chrome.storage.onChanged.removeListener(onCh); return; }
        if (area === 'local' && ch[TL_KEY]) { data = tlClean(ch[TL_KEY].newValue); paintRun(); render(); }
      });
    } catch (e) {}
    every(body, 1000, paintRun);
  }

  /* ======================================================================
   * 8) بيانات الصورة (EXIF) — a minimal TIFF/IFD reader: JPEG APP1, PNG eXIf, WebP EXIF.
   *    Shows what the file carries (GPS above all), then re-encodes through canvas —
   *    which drops every tag — for the clean copy. Nothing is uploaded or stored.
   * ==================================================================== */
  var EXIF_TAGS = {
    0x010F: 'الشركة المصنّعة', 0x0110: 'الجهاز', 0x0131: 'البرنامج', 0x0132: 'تاريخ التعديل', 0x013B: 'المصوّر', 0x8298: 'حقوق النشر',
    0x0112: 'الاتجاه', 0x9003: 'تاريخ الالتقاط', 0x9004: 'تاريخ الترقيم', 0xA002: 'العرض', 0xA003: 'الارتفاع', 0x829A: 'زمن التعريض',
    0x829D: 'فتحة العدسة', 0x8827: 'ISO', 0x920A: 'البعد البؤري', 0xA405: 'البعد البؤري (35مم)', 0x9209: 'الفلاش', 0xA433: 'صانع العدسة', 0xA434: 'العدسة',
    0x0001: 'GPS: جهة العرض', 0x0002: 'GPS: خطّ العرض', 0x0003: 'GPS: جهة الطول', 0x0004: 'GPS: خطّ الطول', 0x0006: 'GPS: الارتفاع', 0x001D: 'GPS: التاريخ', 0x0007: 'GPS: الوقت'
  };
  var EXIF_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  function exifFind(buf) {
    var b = new Uint8Array(buf), dv = new DataView(buf);
    if (b[0] === 0xFF && b[1] === 0xD8) {                                     /* JPEG: APP1 with «Exif\0\0» */
      var p = 2;
      while (p + 4 < b.length && b[p] === 0xFF) {
        var marker = b[p + 1], len = dv.getUint16(p + 2);
        if (marker === 0xE1 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) return p + 10;
        if (marker === 0xDA) break;
        p += 2 + len;
      }
      return -1;
    }
    if (b[0] === 0x89 && b[1] === 0x50) {                                     /* PNG: eXIf chunk */
      var q = 8;
      while (q + 8 < b.length) {
        var clen = dv.getUint32(q), type = String.fromCharCode(b[q + 4], b[q + 5], b[q + 6], b[q + 7]);
        if (type === 'eXIf') return q + 8;
        if (type === 'IEND') break;
        q += 12 + clen;
      }
      return -1;
    }
    if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {   /* WebP: EXIF chunk */
      var r = 12;
      while (r + 8 < b.length) {
        var t4 = String.fromCharCode(b[r], b[r + 1], b[r + 2], b[r + 3]), sz = dv.getUint32(r + 4, true);
        if (t4 === 'EXIF') return (b[r + 8] === 0x45 && b[r + 9] === 0x78) ? r + 14 : r + 8;
        r += 8 + sz + (sz & 1);
      }
    }
    return -1;
  }
  function exifParse(buf) {
    var res = { tags: [], gps: null, found: false };
    var tiff = exifFind(buf);
    if (tiff < 0 || tiff + 8 > buf.byteLength) return res;
    var dv = new DataView(buf), le = dv.getUint16(tiff) === 0x4949;
    if (dv.getUint16(tiff + 2, le) !== 42) return res;
    res.found = true;
    var raw = {}, gps = {};
    function str(off, n) { var s = ''; for (var i = 0; i < n; i++) { var c = dv.getUint8(off + i); if (!c) break; s += String.fromCharCode(c); } return s; }
    function readIfd(off, into, depth) {
      if (depth > 3 || off + 2 > buf.byteLength) return;
      var n = dv.getUint16(off, le);
      if (n > 500) return;
      for (var i = 0; i < n; i++) {
        var e = off + 2 + i * 12; if (e + 12 > buf.byteLength) break;
        var tag = dv.getUint16(e, le), type = dv.getUint16(e + 2, le), cnt = dv.getUint32(e + 4, le);
        var sz = (EXIF_SIZE[type] || 1) * cnt, vp = sz > 4 ? tiff + dv.getUint32(e + 8, le) : e + 8;
        if (vp + sz > buf.byteLength || cnt > 4096) continue;
        var v;
        if (type === 2) v = str(vp, cnt);
        else if (type === 3) { v = []; for (var k = 0; k < cnt; k++) v.push(dv.getUint16(vp + k * 2, le)); }
        else if (type === 4) { v = []; for (var k2 = 0; k2 < cnt; k2++) v.push(dv.getUint32(vp + k2 * 4, le)); }
        else if (type === 5 || type === 10) { v = []; for (var k3 = 0; k3 < cnt; k3++) { var a = type === 5 ? dv.getUint32(vp + k3 * 8, le) : dv.getInt32(vp + k3 * 8, le), bb = type === 5 ? dv.getUint32(vp + k3 * 8 + 4, le) : dv.getInt32(vp + k3 * 8 + 4, le); v.push(bb ? a / bb : 0); } }
        else continue;
        if (tag === 0x8769 && type === 4) { readIfd(tiff + v[0], raw, depth + 1); continue; }
        if (tag === 0x8825 && type === 4) { readIfd(tiff + v[0], gps, depth + 1); continue; }
        into[tag] = v;
      }
    }
    readIfd(tiff + dv.getUint32(tiff + 4, le), raw, 0);
    function fmt(tag, v) {
      if (typeof v === 'string') return v.trim();
      if (tag === 0x829A) return v[0] > 0 && v[0] < 1 ? '1/' + Math.round(1 / v[0]) + ' s' : v[0] + ' s';
      if (tag === 0x829D) return 'f/' + (Math.round(v[0] * 10) / 10);
      if (tag === 0x920A || tag === 0xA405) return (Math.round(v[0] * 10) / 10) + ' mm';
      if (tag === 0x9209) return (v[0] & 1) ? t('نعم') : t('لا');
      if (tag === 0x0007) return v.map(function (x) { return pad(Math.floor(x)); }).join(':');
      return v.map(function (x) { return Math.round(x * 1000) / 1000; }).join(', ');
    }
    Object.keys(raw).forEach(function (k) { k = +k; if (EXIF_TAGS[k]) res.tags.push({ tag: k, name: EXIF_TAGS[k], value: fmt(k, raw[k]) }); });
    function dms(v, ref) { if (!v || v.length < 3) return null; var x = v[0] + v[1] / 60 + v[2] / 3600; return (ref === 'S' || ref === 'W') ? -x : x; }
    var lat = dms(gps[0x0002], gps[0x0001]), lon = dms(gps[0x0004], gps[0x0003]);
    if (lat !== null && lon !== null) {
      res.gps = { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, alt: gps[0x0006] ? Math.round(gps[0x0006][0]) : null, date: gps[0x001D] || null };
    }
    return res;
  }
  function mountExif(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<input type="file" id="ex-f" accept="image/*" class="syf-in" style="padding:6px">' +
        '<div class="syf-note-hint" id="ex-info"></div>' +
        '<div class="syf-note-list" id="ex-list"></div>' +
        '<div class="syf-row"><button class="syf-btn" id="ex-clean" disabled style="flex:1">🧹 تنزيل نسخة نظيفة (بلا بيانات)</button><button class="syf-mini" id="ex-copy">نسخ</button></div>' +
        '<div class="syf-empty" id="ex-st" style="display:none"></div>' +
        '<div class="syf-note-hint">صورة الجوال تحمل إحداثيات مكان التقاطها والجهاز والوقت، وترحل مع كل مشاركة. النسخة النظيفة تُعاد بتشفيرها محلّياً فتسقط كل الوسوم — لا تُرفع ولا تُخزَّن.</div>' +
      '</div>'));
    var fIn = body.querySelector('#ex-f'), info = body.querySelector('#ex-info'), list = body.querySelector('#ex-list'), cleanB = body.querySelector('#ex-clean'), st = body.querySelector('#ex-st');
    var file = null, lastText = '';
    fIn.addEventListener('change', async function () {
      file = fIn.files && fIn.files[0]; list.textContent = ''; info.textContent = ''; st.style.display = 'none'; cleanB.disabled = true; lastText = '';
      if (!file) return;
      try {
        var res = exifParse(await file.slice(0, 2 * 1024 * 1024).arrayBuffer());
        /* i18n-dyn: the user's own file name */
        info.textContent = file.name + ' — ' + fmtBytes(file.size) + ' · ' + (res.found ? t('{0} وسماً', res.tags.length + (res.gps ? 1 : 0)) : t('لا بيانات EXIF'));
        var lines = [];
        if (res.gps) {
          var g = res.gps.lat + ', ' + res.gps.lon + (res.gps.alt !== null ? ' · ' + res.gps.alt + ' m' : '');
          list.appendChild(row(t('⚠️ موقع GPS'), g, true)); lines.push('GPS: ' + g);
        }
        res.tags.forEach(function (x) {
          /* i18n-dyn: EXIF_TAGS values are msgids read through t() */
          list.appendChild(row(t(x.name), x.value)); lines.push(x.name + ': ' + x.value);
        });
        if (!res.found) list.appendChild(h('<div class="syf-empty">الملفّ لا يحمل كتلة EXIF (أو صيغته غير مدعومة للقراءة: JPEG · PNG · WebP).</div>'));
        lastText = lines.join('\n');
        cleanB.disabled = false;
      } catch (e) { status(st, t('تعذّرت قراءة الملف.'), true); }
    });
    body.querySelector('#ex-copy').addEventListener('click', function () { if (lastText) copy(lastText); });
    cleanB.addEventListener('click', async function () {
      if (!file || cleanB.disabled) return;
      var orig = cleanB.textContent; cleanB.disabled = true; cleanB.textContent = t('إعادة الترميز…');
      try {
        var bmp = await createImageBitmap(file);                               /* orientation is applied by the browser */
        var cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
        cv.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
        var type = /^image\/(png|webp)$/.test(file.type) ? file.type : 'image/jpeg';
        var blob = await new Promise(function (r) { cv.toBlob(r, type, 0.92); });
        if (!blob) throw new Error('encode');
        dlBlob(blob, safeBase(file.name) + '-clean.' + (type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'));
        status(st, t('تمّ ✓ — {0} ← {1}', fmtBytes(file.size), fmtBytes(blob.size)));
      } catch (e) {
        status(st, (SYFS.imgkit && SYFS.imgkit.undecodableReason) ? t(SYFS.imgkit.undecodableReason(file) || 'تعذّر فكّ الصورة.') : t('تعذّر فكّ الصورة.'), true);
      } finally { cleanB.disabled = false; cleanB.textContent = orig; }
    });
  }

  /* ======================================================================
   * 9) قارئ QR وباركود — jsQR (Apache-2.0, lib/jsqr/, zero eval, zero network), loaded
   *    on first use: a <script> tag on extension pages, SYFS_LOAD_QR (worker injects
   *    the packaged file into THIS tab) on web pages. ⛔ The result is TEXT that is
   *    copied, never a link that opens — a QR on a poster is untrusted input.
   * ==================================================================== */
  /* Phase-2 review:
   * - PRODUCT BARCODES. jsQR reads QR only, so «قارئ QR وباركود» answered an EAN-13 with
   *   «لم يُعثر على رمز». Chrome's own BarcodeDetector (macOS, ChromeOS, Android — no
   *   new dependency) is asked first when the platform has it; jsQR stays the QR path
   *   everywhere else, and the panel SAYS when product barcodes are not available.
   * - SMALL CODES IN BIG SCREENSHOTS. A 150px code in a 3840px capture shrank to ~47px at
   *   QR_MAX and vanished. When the whole-image pass finds nothing, the image is read
   *   again in overlapping tiles at its own resolution (qrTiles); a small image is read
   *   again upscaled.
   * - THE CAMERA belongs to the extension. In the rail, getUserMedia asks FOR THE HOST
   *   SITE (which keeps «always allow») and the <video> sits in a shadow root that site
   *   can read. On a web page the camera opens qrtool.html#qrcam instead; in place only
   *   after an explicit second choice that names the site.
   * - Wi-Fi codes show the network and the password as two copyable rows, and every
   *   copy says whether it worked. */
  var QR_MAX = 1200, QR_TILE = 1000, QR_TILES_MAX = 40, QR_SMALL = 400;
  var BD_FORMATS = ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'codabar', 'itf', 'data_matrix', 'aztec', 'pdf417'];
  var BC_NAMES = { ean_13: 'EAN-13', ean_8: 'EAN-8', upc_a: 'UPC-A', upc_e: 'UPC-E', code_128: 'Code 128', code_39: 'Code 39', code_93: 'Code 93', codabar: 'Codabar', itf: 'ITF', data_matrix: 'Data Matrix', aztec: 'Aztec', pdf417: 'PDF417' };
  var bdP = null;
  /* Promise<BarcodeDetector|null>, asked once per page */
  function barcodeDetector() {
    if (bdP) return bdP;
    var BD = window.BarcodeDetector;
    bdP = (typeof BD === 'function' && typeof BD.getSupportedFormats === 'function')
      ? BD.getSupportedFormats().then(function (have) {
        var use = BD_FORMATS.filter(function (f) { return have.indexOf(f) >= 0; });
        return use.length ? new BD({ formats: use }) : null;
      }).catch(function () { return null; })
      : Promise.resolve(null);
    return bdP;
  }
  /* positions along one axis: tiles of `tile` with half-tile overlap, the last flush with the edge */
  function qrAxis(len, tile) { if (len <= tile) return [0]; var a = [], step = Math.round(tile / 2); for (var p = 0; p + tile < len; p += step) a.push(p); a.push(len - tile); return a; }
  /* overlapping tiles covering w×h; the tile grows until there are at most `max` of them.
     Every square of side ≤ tile/2 lies wholly inside at least one tile. */
  function qrTiles(w, hgt, tile, max) {
    tile = Math.max(1, Math.min(tile, Math.max(w, hgt)));
    var xs, ys;
    for (;;) { xs = qrAxis(w, tile); ys = qrAxis(hgt, tile); if (xs.length * ys.length <= max) break; tile = Math.round(tile * 1.25); }
    var out = [];
    ys.forEach(function (y) { xs.forEach(function (x) { out.push({ x: x, y: y, w: Math.min(tile, w - x), h: Math.min(tile, hgt - y) }); }); });
    return out;
  }
  /* WIFI:T:WPA;S:name;P:pass;H:true;;  → {ssid, pass, enc, hidden} | null. Backslash
     escapes \; \, \: \\ \" are honoured, so a «;» inside a password does not cut it. */
  function wifiParse(text) {
    var s = String(text || '');
    if (!/^WIFI:/i.test(s)) return null;
    var body = s.slice(5), out = {}, key = '', val = '', inKey = true;
    for (var i = 0; i < body.length; i++) {
      var c = body[i];
      if (c === '\\' && i + 1 < body.length) { i++; if (inKey) key += body[i]; else val += body[i]; continue; }
      if (inKey) { if (c === ':') inKey = false; else if (c === ';') key = ''; else key += c; continue; }
      if (c === ';') { out[key.toUpperCase()] = val; key = ''; val = ''; inKey = true; continue; }
      val += c;
    }
    if (!inKey && key) out[key.toUpperCase()] = val;
    if (!out.S) return null;
    var enc = String(out.T || '').toUpperCase();
    return { ssid: out.S, pass: (enc === 'NOPASS' || !enc) ? '' : (out.P || ''), enc: enc && enc !== 'NOPASS' ? enc : '', hidden: /^true$/i.test(out.H || '') };
  }
  /* what the decoded value is, for the line under the result */
  function qrKind(text, format) {
    if (!text) return '';
    var nm = BC_NAMES[format];
    if (nm && /^(ean_13|ean_8|upc_a|upc_e)$/.test(format)) return t('باركود منتج ({0}) — رقم السلعة.', nm);
    if (nm) return t('رمز {0}', nm);
    var u = safeUrl(text);
    if (u && /^https?:\/\//i.test(text.trim())) return t('رابط إلى {0} — لم يُفتح.', hostOf(u));
    if (/^WIFI:/i.test(text)) return t('إعدادات شبكة Wi-Fi');
    if (/^BEGIN:VCARD/i.test(text)) return t('بطاقة جهة اتصال');
    if (/^[0-9]{8,14}$/.test(text.trim())) return t('أرقام فقط — قد تكون رقم سلعة.');
    return t('نصّ — {0} محرفاً', text.length);
  }
  function ensureJsQR(cb) {
    if (window.jsQR) { cb(true); return; }
    if (location.protocol === 'chrome-extension:') {
      var s = document.createElement('script'); s.src = chrome.runtime.getURL('lib/jsqr/jsQR.js');
      s.onload = function () { cb(!!window.jsQR); }; s.onerror = function () { cb(false); };
      document.head.appendChild(s); return;
    }
    ask('SYFS_LOAD_QR', {}, function (r) { cb(!!(r.ok && window.jsQR)); });
  }
  /* decode one region of a drawable (bitmap / video frame) at scale k; null when nothing is found */
  function qrDecodeAt(src, sx, sy, sw, sh, k) {
    var cw = Math.max(1, Math.round(sw * k)), ch = Math.max(1, Math.round(sh * k));
    var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    var g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(src, sx, sy, sw, sh, 0, 0, cw, ch);
    var d = g.getImageData(0, 0, cw, ch);
    var r = window.jsQR(d.data, cw, ch, { inversionAttempts: 'attemptBoth' });
    return r && r.data ? r.data : null;
  }
  /* the whole drawable on a bounded canvas */
  function qrDecode(src, w, hgt) { return qrDecodeAt(src, 0, 0, w, hgt, Math.min(1, QR_MAX / Math.max(w, hgt))); }
  /* jsQR's second chances: tiles at full resolution for a big image, ×3 for a small one.
     Async between tiles so the «searching» line paints and the page stays responsive. */
  function qrDeep(bmp, onTiles) {
    var w = bmp.width, hgt = bmp.height, big = Math.max(w, hgt);
    if (big < QR_SMALL) return Promise.resolve(qrDecodeAt(bmp, 0, 0, w, hgt, 3));
    if (big <= QR_MAX) return Promise.resolve(null);
    var tiles = qrTiles(w, hgt, QR_TILE, QR_TILES_MAX);
    onTiles(tiles.length);
    return new Promise(function (res) {
      var i = 0;
      (function next() {
        if (i >= tiles.length) { res(null); return; }
        var r = tiles[i++], txt = qrDecodeAt(bmp, r.x, r.y, r.w, r.h, Math.min(1, QR_MAX / Math.max(r.w, r.h)));
        if (txt) { res(txt); return; }
        setTimeout(next, 0);
      })();
    });
  }
  /* write the clipboard and SAY so — a silent copy left the user guessing */
  function copyNote(text, st) {
    var p = null;
    try { p = navigator.clipboard && navigator.clipboard.writeText(text); } catch (e) { p = null; }
    if (!p) { status(st, t('تعذّر النسخ — حدّد النصّ وانسخه يدوياً.'), true); return; }
    p.then(function () { status(st, t('نُسخ ✓')); }, function () { status(st, t('تعذّر النسخ — حدّد النصّ وانسخه يدوياً.'), true); });
  }
  function mountQrRead(body) {
    body.appendChild(h(
      '<div class="syf-form">' +
        '<div class="syf-row"><input type="file" id="qr-f" accept="image/*" class="syf-in" aria-label="صورة فيها رمز" style="padding:6px;flex:1"><button class="syf-mini" id="qr-cam">📷 الكاميرا</button></div>' +
        '<div class="syf-row" id="qr-here" role="group" style="display:none;flex-wrap:wrap"><span class="syf-note-hint" style="flex:1 1 100%"></span><button class="syf-mini" id="qr-here-go">استعمل الكاميرا هنا</button></div>' +
        '<div class="syf-note-hint" id="qr-paste" tabindex="0" role="button" aria-label="الصق صورة هنا" style="border:1px dashed var(--line);border-radius:8px;padding:10px;text-align:center;cursor:text">أو انقر هنا ثم الصق صورة / لقطة شاشة (Ctrl+V)</div>' +
        '<video id="qr-v" playsinline muted style="display:none;width:100%;border-radius:8px;background:#000"></video>' +
        '<label for="qr-out">النتيجة</label><textarea class="syf-in" id="qr-out" rows="4" readonly dir="auto"></textarea>' +
        '<div class="syf-note-hint" id="qr-kind"></div>' +
        '<div class="syf-note-list" id="qr-wifi" style="display:none"></div>' +
        '<div class="syf-row"><button class="syf-btn" id="qr-copy" style="flex:1" disabled>نسخ النصّ</button></div>' +
        '<div class="syf-empty" id="qr-st" role="status" aria-live="polite" style="display:none"></div>' +
        '<div class="syf-note-hint" id="qr-bd"></div>' +
        '<div class="syf-note-hint">يُفكّ محلّياً. النتيجة نصّ يُنسخ ولا يُفتح تلقائياً — رمز على ملصق مُدخل لا يُؤتمن. الكاميرا تعمل في نافذة الإضافة فلا يحصل الموقع المفتوح على إذنها.</div>' +
      '</div>'));
    var fIn = body.querySelector('#qr-f'), camB = body.querySelector('#qr-cam'), paste = body.querySelector('#qr-paste'), vid = body.querySelector('#qr-v'),
        out = body.querySelector('#qr-out'), kind = body.querySelector('#qr-kind'), copyB = body.querySelector('#qr-copy'), st = body.querySelector('#qr-st'),
        wifiEl = body.querySelector('#qr-wifi'), hereEl = body.querySelector('#qr-here'), bdEl = body.querySelector('#qr-bd');
    var stream = null, scanIv = 0, camHere = SYFS.inExtPage ? SYFS.inExtPage() : false;
    barcodeDetector().then(function (det) {
      if (!det && body.isConnected) bdEl.textContent = t('باركود المنتجات (EAN/UPC) يحتاج دعم المتصفح على هذا النظام — هنا تُقرأ رموز QR فقط.');
    });
    function wifiRow(label, value) {
      var r = h('<div class="syf-note-row"><span class="t" style="flex:0 0 auto;font-size:12px"></span><b class="syf-mono" dir="auto" style="flex:1;word-break:break-all"></b><button class="syf-mini" type="button">نسخ</button></div>');
      r.querySelector('.t').textContent = t(label);
      r.querySelector('b').textContent = value;                       /* scanned data — text only */
      var cb = r.querySelector('button'); cb.setAttribute('aria-label', t('نسخ {0}', t(label)));
      cb.addEventListener('click', function () { copyNote(value, st); });
      wifiEl.appendChild(r);
    }
    function show(text, format) {
      out.value = text; copyB.disabled = !text;                       /* decoded text — value, never markup */
      kind.textContent = qrKind(text, format);
      wifiEl.textContent = ''; wifiEl.style.display = 'none';
      var w = text ? wifiParse(text) : null;
      if (!w) return;
      wifiRow('اسم الشبكة', w.ssid);
      if (w.pass) wifiRow('كلمة المرور', w.pass);
      kind.textContent = t('شبكة Wi-Fi · {0}', w.enc || t('بلا كلمة مرور')) + (w.hidden ? ' · ' + t('مخفية') : '');
      wifiEl.style.display = '';
    }
    function miss() { show(''); status(st, t('لم يُعثر على رمز في الصورة — جرّب صورة أوضح أو أقرب.'), true); }
    function fromBlob(blob) {
      st.style.display = 'none';
      createImageBitmap(blob).then(function (bmp) {
        function done(text, format) { bmp.close(); if (text) { st.style.display = 'none'; show(text, format); } else miss(); }
        return barcodeDetector().then(function (det) { return det ? det.detect(bmp).catch(function () { return []; }) : []; }).then(function (found) {
          var hit = (found || []).filter(function (b) { return b && b.rawValue; })[0];
          if (hit) { done(hit.rawValue, hit.format); return; }
          ensureJsQR(function (okLib) {
            if (!okLib) { bmp.close(); status(st, t('تعذّر تحميل قارئ QR.'), true); return; }
            var text = qrDecode(bmp, bmp.width, bmp.height);
            if (text) { done(text, 'qr_code'); return; }
            qrDeep(bmp, function (n) { status(st, t('يبحث عن رمز صغير في {0} جزءاً من الصورة…', n)); })
              .then(function (txt) { done(txt, 'qr_code'); });
          });
        });
      }).catch(function () { status(st, t('تعذّر فكّ الصورة.'), true); });
    }
    fIn.addEventListener('change', function () { var f = fIn.files && fIn.files[0]; if (f) fromBlob(f); });
    paste.addEventListener('click', function () { paste.focus(); });
    paste.addEventListener('paste', function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) { if (items[i].type.indexOf('image/') === 0) { e.preventDefault(); fromBlob(items[i].getAsFile()); return; } }
      status(st, t('الحافظة لا تحمل صورة.'), true);
    });
    function stopCam() {
      clearInterval(scanIv); scanIv = 0;
      if (stream) { stream.getTracks().forEach(function (tr) { tr.stop(); }); stream = null; }
      vid.style.display = 'none'; vid.srcObject = null; camB.textContent = t('📷 الكاميرا');
    }
    function startCam() {
      if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { status(st, t('الكاميرا غير متاحة في هذه الصفحة (تحتاج HTTPS).'), true); return; }
      hereEl.style.display = 'none';
      barcodeDetector().then(function (det) {
        ensureJsQR(function (okLib) {
          if (!okLib && !det) { status(st, t('تعذّر تحميل قارئ QR.'), true); return; }
          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (s) {
            if (!body.isConnected) { s.getTracks().forEach(function (tr) { tr.stop(); }); return; }
            stream = s; vid.srcObject = s; vid.style.display = ''; vid.play(); camB.textContent = t('■ إيقاف الكاميرا');
            var busy = false;
            scanIv = setInterval(function () {
              if (!body.isConnected) { stopCam(); return; }             /* the panel closed — release the camera */
              if (vid.readyState < 2 || busy) return;
              busy = true;
              (det ? det.detect(vid).catch(function () { return []; }) : Promise.resolve([])).then(function (found) {
                busy = false;
                if (!stream) return;
                var hit = (found || []).filter(function (b) { return b && b.rawValue; })[0];
                if (hit) { show(hit.rawValue, hit.format); stopCam(); return; }
                var text = okLib ? qrDecode(vid, vid.videoWidth, vid.videoHeight) : null;
                if (text) { show(text, 'qr_code'); stopCam(); }
              });
            }, 350);
          }).catch(function () { status(st, t('رُفض الوصول إلى الكاميرا.'), true); });
        });
      });
    }
    camB.addEventListener('click', function () {
      if (stream) { stopCam(); return; }
      if (camHere) { startCam(); return; }
      /* a web page: the scanner opens in the extension's own window (qrtool.html#qrcam) */
      camB.disabled = true;
      status(st, t('يفتح الماسح في نافذة الإضافة…'));
      SYFS.openToolPage('qrcam', function (ok) {
        camB.disabled = false;
        if (ok) { status(st, t('فُتح الماسح في نافذة مستقلة — الإذن للإضافة لا لهذا الموقع.')); return; }
        st.style.display = 'none';
        hereEl.querySelector('span').textContent = t('تعذّر فتح نافذة الإضافة. استعمال الكاميرا هنا يطلب الإذن باسم {0}، ويستطيع الموقع بعدها تشغيل الكاميرا بنفسه.', location.hostname || location.protocol);
        hereEl.style.display = '';
      });
    });
    hereEl.querySelector('#qr-here-go').addEventListener('click', function () { camHere = true; startCam(); });
    copyB.addEventListener('click', function () { if (out.value) copyNote(out.value, st); });
  }

  /* ======================================================================
   * registrations
   * ==================================================================== */
  var S = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  SYFS.tools.push({
    id: 'cookiemgr', name: 'مدير الكوكيز', cat: 'shield',
    icon: S + '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18 9 9 0 0 0 9-9 4 4 0 0 1-4-4 4 4 0 0 1-5-5z"/><circle cx="9" cy="10" r="1"/><circle cx="14" cy="15" r="1"/><circle cx="9" cy="15" r="1"/></svg>',
    mount: mountCookies
  });
  SYFS.tools.push({
    id: 'sessions', name: 'جلسات المتصفح', cat: 'util',
    icon: S + '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M8 5v4M13 5v4"/><path d="M9 14h6"/></svg>',
    mount: mountSessions
  });
  SYFS.tools.push({
    id: 'ziptool', name: 'أرشيف ZIP', cat: 'docs',
    icon: S + '<path d="M4 4h16v16H4z"/><path d="M10 4v2h2v2h-2v2h2v2h-2v2h2v2h-2v2"/></svg>',
    mount: function (body) { SYFS.tabs(body, [{ label: 'فكّ الأرشيف', build: mountZipRead }, { label: 'إنشاء أرشيف', build: mountZipWrite }]); }
  });
  SYFS.tools.push({
    id: 'textdiff', name: 'فرق نصّين', cat: 'note',
    icon: S + '<path d="M4 5h7M4 9h7M4 13h7M4 17h7"/><path d="M13 5h7M13 9h4M13 13h7M13 17h5"/><path d="M12 3v18"/></svg>',
    mount: mountTextDiff
  });
  SYFS.tools.push({
    id: 'readsave', name: 'احفظ المقال', cat: 'note', beta: true,
    icon: S + '<path d="M4 4h12l4 4v12H4z"/><path d="M8 4v5h7"/><path d="M8 14h8M8 17h5"/></svg>',
    mount: mountReadSave
  });
  SYFS.tools.push({
    id: 'datediff', name: 'الفرق بين تاريخين', cat: 'time',
    icon: S + '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 15h3l2 3 2-6 1 3h1"/></svg>',
    mount: mountDateDiff
  });
  SYFS.tools.push({
    id: 'timelog', name: 'سجلّ وقت المهام', cat: 'time',
    icon: S + '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M9 3h6"/><path d="M4 5l2 2M20 5l-2 2"/></svg>',
    mount: mountTimeLog
  });
  SYFS.tools.push({
    id: 'qrread', name: 'قارئ QR وباركود', cat: 'util',
    icon: S + '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/><path d="M7 7h.01M17 7h.01M7 17h.01"/></svg>',
    mount: mountQrRead
  });
  SYFS.tools.push({
    id: 'exif', name: 'بيانات الصورة (EXIF)', cat: 'media',
    icon: S + '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-6 6-2-2-5 5"/><path d="M17 4v3"/></svg>',
    mount: mountExif
  });

  /* ===== المفكّرة (notepad, v0.155.0) — tabs · formatting · save · download · undo =====
   * One key, `notepad`: { v:1, active, tabs:[{ id, title, html, draft? }] }. `html` is
   * what «حفظ» committed; `draft` is typing not saved yet, written quietly 1.5s after the
   * last keystroke so closing the window never loses a word — the tab keeps its «●»
   * until «حفظ» turns the draft into the text.
   * ⛔ The stored HTML is USER DATA and «استيراد» can write any string into it, so it
   *    never reaches the editor as-is: npClean() re-BUILDS it from a whitelist (tags,
   *    a few style properties with checked values, no attribute else — no link, no
   *    image, no handler), parsing with DOMParser, whose document runs nothing and
   *    loads nothing. The same cleaner guards paste and drop.
   * Undo is the tool's own snapshot stack per tab (switching tabs would wipe the
   * browser's), capped at NP_HIST steps. */
  var NP_KEY = 'notepad', NP_MAX_TABS = 20, NP_MAX_HTML = 200000, NP_HIST = 100;
  var NP_TAGS = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', DEL: 's', P: 'p', DIV: 'div',
    BR: 'br', H1: 'h1', H2: 'h2', H3: 'h3', UL: 'ul', OL: 'ol', LI: 'li', BLOCKQUOTE: 'blockquote', SPAN: 'span',
    FONT: 'span', PRE: 'pre', CODE: 'code', HR: 'hr', SUB: 'sub', SUP: 'sup', MARK: 'mark' };
  var NP_CSS = { 'color': 1, 'background-color': 1, 'text-align': 1, 'font-weight': 1, 'font-style': 1, 'text-decoration': 1, 'text-decoration-line': 1, 'font-size': 1 };
  /* a colour, a keyword, a size — never url(), never a second declaration */
  var NP_VAL = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\)|[a-z-]{1,24}|\d{1,3}(\.\d+)?(px|em|rem|%|pt))$/i;
  function npClean(html) {
    var doc;
    try { doc = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html'); } catch (e) { return document.createDocumentFragment(); }
    var out = document.createDocumentFragment();
    (function walk(src, dst, depth) {
      if (depth > 40) return;
      for (var n = src.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); continue; }
        if (n.nodeType !== 1) continue;
        var tag = NP_TAGS[n.tagName];
        if (!tag) {
          /* unknown wrapper: keep its text, drop the element (script/style: drop both) */
          if (!/^(SCRIPT|STYLE|TEMPLATE|IFRAME|OBJECT|EMBED|SVG|MATH|NOSCRIPT|TEXTAREA|SELECT|IMG|VIDEO|AUDIO|CANVAS)$/.test(n.tagName)) walk(n, dst, depth + 1);
          continue;
        }
        var el = document.createElement(tag), st = n.style;
        /* CSSOM, not a style attribute: a host page's style-src may refuse the attribute */
        if (st) {
          for (var i = 0; i < st.length; i++) {
            var p = st[i], v = st.getPropertyValue(p).trim();
            if (NP_CSS[p] && NP_VAL.test(v)) el.style.setProperty(p, v);
          }
        }
        var fc = n.tagName === 'FONT' ? n.getAttribute('color') : '';
        if (fc && NP_VAL.test(fc)) el.style.setProperty('color', fc);
        var al = n.getAttribute('align');
        if (al && /^(left|right|center|justify)$/i.test(al)) el.style.setProperty('text-align', al.toLowerCase());
        var dir = n.getAttribute('dir');
        if (dir && /^(rtl|ltr|auto)$/.test(dir)) el.setAttribute('dir', dir);
        walk(n, el, depth + 1);
        dst.appendChild(el);
      }
    })(doc.body, out, 0);
    return out;
  }
  function npHtml(frag) { var d = document.createElement('div'); d.appendChild(frag); return d.innerHTML; }
  function npId() { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  /* the stored object, whitelisted on read (§5.11) */
  function npNorm(raw) {
    var r = (raw && typeof raw === 'object') ? raw : {}, tabs = [];
    (Array.isArray(r.tabs) ? r.tabs : []).slice(0, NP_MAX_TABS).forEach(function (x) {
      if (!x || typeof x !== 'object') return;
      var id = (typeof x.id === 'string' && /^[a-z0-9]{1,24}$/i.test(x.id)) ? x.id : npId();
      tabs.push({
        id: id,
        title: typeof x.title === 'string' ? x.title.slice(0, 60) : '',
        html: typeof x.html === 'string' ? x.html.slice(0, NP_MAX_HTML) : '',
        draft: typeof x.draft === 'string' ? x.draft.slice(0, NP_MAX_HTML) : null
      });
    });
    if (!tabs.length) tabs.push({ id: npId(), title: '', html: '', draft: null });
    var active = tabs.some(function (x) { return x.id === r.active; }) ? r.active : tabs[0].id;
    return { v: 1, active: active, tabs: tabs };
  }

  function mountNotepad(body) {
    var I = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
    var ui = h(
      '<div class="syf-np">' +
        '<div class="syf-np-tabs" role="tablist" aria-label="تبويبات المفكّرة"></div>' +
        '<div class="syf-np-bar" role="toolbar" aria-label="تنسيق">' +
          '<button type="button" class="syf-np-b" data-c="bold" title="عريض (Ctrl+B)"><b>B</b></button>' +
          '<button type="button" class="syf-np-b" data-c="italic" title="مائل (Ctrl+I)"><i>I</i></button>' +
          '<button type="button" class="syf-np-b" data-c="underline" title="تسطير (Ctrl+U)"><u>U</u></button>' +
          '<button type="button" class="syf-np-b" data-c="strikeThrough" title="يتوسطه خط"><s>S</s></button>' +
          '<span class="syf-np-sep"></span>' +
          '<button type="button" class="syf-np-b" data-c="formatBlock" data-v="h2" title="عنوان">H</button>' +
          '<button type="button" class="syf-np-b" data-c="formatBlock" data-v="p" title="فقرة عادية">¶</button>' +
          '<button type="button" class="syf-np-b" data-c="insertUnorderedList" title="قائمة نقطية">' + I('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>') + '</button>' +
          '<button type="button" class="syf-np-b" data-c="insertOrderedList" title="قائمة مرقّمة">' + I('<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 5h1.5v4M4 9h3M4 15.5a1.5 1.5 0 0 1 3 0c0 1-3 2-3 3.5h3"/>') + '</button>' +
          '<span class="syf-np-sep"></span>' +
          '<button type="button" class="syf-np-b" data-c="justifyRight" title="محاذاة لليمين">' + I('<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>') + '</button>' +
          '<button type="button" class="syf-np-b" data-c="justifyCenter" title="توسيط">' + I('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>') + '</button>' +
          '<button type="button" class="syf-np-b" data-c="justifyLeft" title="محاذاة لليسار">' + I('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>') + '</button>' +
          '<span class="syf-np-sep"></span>' +
          '<label class="syf-np-b syf-np-col" title="لون النص"><span class="syf-np-a">A</span><input type="color" data-c="foreColor" value="#c0392b" aria-label="لون النص"></label>' +
          '<label class="syf-np-b syf-np-col" title="تظليل"><span class="syf-np-hl">' + I('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>') + '</span><input type="color" data-c="hiliteColor" value="#fff176" aria-label="تظليل"></label>' +
          '<button type="button" class="syf-np-b" data-c="removeFormat" title="إزالة التنسيق">' + I('<path d="M4 7V4h16v3M9 20h6M12 4v16"/><path d="m3 3 18 18"/>') + '</button>' +
        '</div>' +
        '<div class="syf-np-ed" contenteditable="true" role="textbox" aria-multiline="true" aria-label="نصّ الملاحظة" spellcheck="true"></div>' +
        '<div class="syf-np-foot">' +
          '<span class="syf-np-st" aria-live="polite"></span>' +
          '<button type="button" class="syf-mini" id="np-undo" title="تراجع (Ctrl+Z)">تراجع</button>' +
          '<button type="button" class="syf-mini" id="np-redo" title="إعادة (Ctrl+Y)">إعادة</button>' +
          '<span class="syf-np-dlw"><button type="button" class="syf-mini" id="np-dl" aria-haspopup="menu" aria-expanded="false">تحميل</button>' +
            '<span class="syf-np-menu" role="menu" hidden>' +
              '<button type="button" role="menuitem" data-f="html">صفحة HTML (بالتنسيق)</button>' +
              '<button type="button" role="menuitem" data-f="doc">مستند Word (.doc)</button>' +
              '<button type="button" role="menuitem" data-f="txt">نصّ عادي (.txt)</button>' +
            '</span></span>' +
          '<button type="button" class="syf-btn" id="np-save" title="حفظ (Ctrl+S)">حفظ</button>' +
        '</div>' +
      '</div>'
    );
    body.appendChild(ui);
    var q = function (s) { return ui.querySelector(s); };
    var tabsEl = q('.syf-np-tabs'), ed = q('.syf-np-ed'), stEl = q('.syf-np-st');
    var NP = null, hist = {}, draftT = 0, snapT = 0;

    function cur() { for (var i = 0; i < NP.tabs.length; i++) if (NP.tabs[i].id === NP.active) return NP.tabs[i]; return NP.tabs[0]; }
    function dirty(tb) { return tb.draft !== null && tb.draft !== tb.html; }
    function titleOf(tb, i) { return tb.title || t('ملاحظة {0}', i + 1); }
    function persist() { return store.set(NP_KEY, NP); }
    function words() { var s = (ed.innerText || '').trim(); return s ? s.split(/\s+/).length : 0; }
    function status() {
      stEl.textContent = t('الكلمات: {0}', words()) + ' · ' + (dirty(cur()) ? t('غير محفوظ') : t('محفوظ ✓'));
    }
    function H() { var id = NP.active; return hist[id] || (hist[id] = { u: [], r: [], last: null }); }
    /* a snapshot of the editor as it is now, taken BEFORE the next change lands */
    function snap() {
      var hh = H(), now = ed.innerHTML;
      if (hh.last === null) { hh.last = now; return; }
      if (now === hh.last) return;
      hh.u.push(hh.last); if (hh.u.length > NP_HIST) hh.u.shift();
      hh.r = []; hh.last = now;
    }
    function load(tb) {
      ed.textContent = '';
      ed.appendChild(npClean(tb.draft !== null ? tb.draft : tb.html));
      var hh = H(); if (hh.last === null) hh.last = ed.innerHTML;
      status();
    }
    function draw() {
      tabsEl.textContent = '';
      NP.tabs.forEach(function (tb, i) {
        var b = h('<div class="syf-np-tab" role="tab"><span class="syf-np-tt"></span><span class="syf-np-dot" aria-hidden="true">●</span>' +
          '<button type="button" class="syf-np-x" aria-label="إغلاق التبويب">×</button></div>');
        b.querySelector('.syf-np-tt').textContent = titleOf(tb, i);   /* i18n-dyn: the user's own tab title */
        b.setAttribute('aria-selected', String(tb.id === NP.active));
        b.tabIndex = tb.id === NP.active ? 0 : -1;
        b.classList.toggle('on', tb.id === NP.active);
        b.classList.toggle('dirty', dirty(tb));
        b.title = t('انقر مرّتين لإعادة التسمية');
        b.addEventListener('click', function (e) { if (!e.target.closest('.syf-np-x') && !e.target.closest('input')) pick(tb.id); });
        b.addEventListener('dblclick', function (e) { if (!e.target.closest('.syf-np-x')) rename(b, tb, i); });
        b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(tb.id); } if (e.key === 'F2') rename(b, tb, i); });
        var x = b.querySelector('.syf-np-x');
        x.addEventListener('click', function (e) { e.stopPropagation(); closeTab(tb, x); });
        tabsEl.appendChild(b);
      });
      var add = h('<button type="button" class="syf-np-add" title="تبويب جديد" aria-label="تبويب جديد">+</button>');
      add.disabled = NP.tabs.length >= NP_MAX_TABS;
      add.addEventListener('click', function () { flush(); var tb = { id: npId(), title: '', html: '', draft: null }; NP.tabs.push(tb); NP.active = tb.id; persist(); draw(); load(tb); ed.focus(); });
      tabsEl.appendChild(add);
    }
    function pick(id) { if (id === NP.active) return; flush(); NP.active = id; persist(); draw(); load(cur()); }
    function rename(b, tb, i) {
      var tt = b.querySelector('.syf-np-tt'), inp = document.createElement('input');
      inp.className = 'syf-np-ren'; inp.value = tb.title || titleOf(tb, i); inp.maxLength = 60;
      inp.setAttribute('aria-label', t('اسم التبويب'));
      tt.replaceWith(inp); inp.focus(); inp.select();
      var done = false;
      function end(keep) { if (done) return; done = true; if (keep) { tb.title = inp.value.trim().slice(0, 60); persist(); } draw(); }
      inp.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') end(true); if (e.key === 'Escape') end(false); });
      inp.addEventListener('blur', function () { end(true); });
    }
    /* two clicks, never confirm() (§5.23/4): the first arms the ×, the second closes */
    function closeTab(tb, x) {
      var empty = !(tb.draft || tb.html);
      if (!empty && !x.classList.contains('arm')) {
        x.classList.add('arm'); x.textContent = t('إغلاق؟');
        setTimeout(function () { if (x.isConnected) { x.classList.remove('arm'); x.textContent = '×'; } }, 3000);
        return;
      }
      var i = NP.tabs.indexOf(tb);
      NP.tabs.splice(i, 1); delete hist[tb.id];
      if (!NP.tabs.length) NP.tabs.push({ id: npId(), title: '', html: '', draft: null });
      if (NP.active === tb.id) NP.active = NP.tabs[Math.min(i, NP.tabs.length - 1)].id;
      persist(); draw(); load(cur());
    }
    /* the typing of the open tab → its draft (memory now, storage a moment later) */
    function flush() {
      if (!NP) return;
      clearTimeout(draftT);
      var tb = cur(), v = ed.innerHTML;
      if (v.length > NP_MAX_HTML) { stEl.textContent = t('الملاحظة أطول من الحدّ — احذف جزءًا منها'); return; }
      tb.draft = (v === tb.html) ? null : v;
      persist();
    }
    function changed() {
      clearTimeout(snapT); snapT = setTimeout(snap, 400);
      /* flushed even after the window closed: the editor node still holds the text */
      clearTimeout(draftT); draftT = setTimeout(function () { flush(); if (ui.isConnected) { draw(); status(); } }, 1500);
      var tb = cur(), was = dirty(tb);
      tb.draft = ed.innerHTML;
      if (dirty(tb) !== was) draw();
      status();
    }
    function save() {
      snap(); flush();
      var tb = cur();
      if (tb.draft !== null) { tb.html = tb.draft.slice(0, NP_MAX_HTML); tb.draft = null; }
      persist().then(function () { if (ui.isConnected) { draw(); status(); stEl.textContent = t('حُفظ ✓') + ' · ' + t('الكلمات: {0}', words()); } });
    }
    function undo() {
      snap(); var hh = H();
      if (!hh.u.length) return;
      hh.r.push(hh.last); hh.last = hh.u.pop();
      ed.textContent = ''; ed.appendChild(npClean(hh.last)); changed(); clearTimeout(snapT);
    }
    function redo() {
      var hh = H();
      if (!hh.r.length) return;
      hh.u.push(hh.last); hh.last = hh.r.pop();
      ed.textContent = ''; ed.appendChild(npClean(hh.last)); changed(); clearTimeout(snapT);
    }
    function cmd(c, v) {
      ed.focus(); snap();
      try { document.execCommand('styleWithCSS', false, true); document.execCommand(c, false, v); } catch (e) {}
      snap(); changed();
    }

    /* toolbar: mousedown keeps the selection in the editor */
    q('.syf-np-bar').addEventListener('mousedown', function (e) { if (e.target.closest('button')) e.preventDefault(); });
    q('.syf-np-bar').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-c]'); if (!b) return;
      cmd(b.dataset.c, b.dataset.v ? '<' + b.dataset.v + '>' : null);
    });
    ui.querySelectorAll('input[type="color"]').forEach(function (inp) {
      inp.addEventListener('input', function () { cmd(inp.dataset.c, inp.value); });
    });
    ed.addEventListener('input', changed);
    /* paste and drop: rebuilt through the same whitelist as a stored note */
    ed.addEventListener('paste', function (e) {
      var cd = e.clipboardData; if (!cd) return;
      e.preventDefault(); snap();
      var html = cd.getData('text/html'), txt = cd.getData('text/plain');
      try {
        if (html) document.execCommand('insertHTML', false, npHtml(npClean(html)));
        else document.execCommand('insertText', false, txt);
      } catch (err) {}
      changed();
    });
    ed.addEventListener('drop', function (e) {
      var txt = e.dataTransfer && e.dataTransfer.getData('text/plain');
      e.preventDefault();
      if (txt) { snap(); try { document.execCommand('insertText', false, txt); } catch (err) {} changed(); }
    });
    ed.addEventListener('keydown', function (e) {
      var k = (e.key || '').toLowerCase(), mod = e.ctrlKey || e.metaKey;
      e.stopPropagation();                         /* the page's own shortcuts stay out of the editor */
      if (!mod) return;
      if (k === 's') { e.preventDefault(); save(); }
      else if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    });
    q('#np-save').addEventListener('click', save);
    q('#np-undo').addEventListener('click', undo);
    q('#np-redo').addEventListener('click', redo);

    var dlBtn = q('#np-dl'), menu = q('.syf-np-menu');
    function menuOpen(on) { menu.hidden = !on; dlBtn.setAttribute('aria-expanded', String(on)); }
    dlBtn.addEventListener('click', function (e) { e.stopPropagation(); menuOpen(menu.hidden); });
    ui.addEventListener('click', function (e) { if (!e.target.closest('.syf-np-dlw')) menuOpen(false); });
    menu.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-f]'); if (!b) return;
      menuOpen(false); download(b.dataset.f);
    });
    function download(f) {
      var tb = cur(), i = NP.tabs.indexOf(tb), name = safeBase(titleOf(tb, i));
      if (f === 'txt') { dlBlob(new Blob([ed.innerText || ''], { type: 'text/plain;charset=utf-8' }), name + '.txt'); return; }
      /* a whole document built as nodes: the title is text, the body is the cleaned note */
      var d = document.implementation.createHTMLDocument('');
      d.documentElement.setAttribute('dir', SYFS.i18n && SYFS.i18n.dir ? SYFS.i18n.dir() : 'rtl');
      var meta = d.createElement('meta'); meta.setAttribute('charset', 'utf-8'); d.head.appendChild(meta);
      d.title = titleOf(tb, i);
      var css = d.createElement('style');
      css.textContent = 'body{font-family:Tahoma,Arial,sans-serif;line-height:1.7;max-width:800px;margin:24px auto;padding:0 16px}';
      d.head.appendChild(css);
      d.body.appendChild(d.importNode(npClean(ed.innerHTML), true));
      var src = '<!doctype html>\n' + d.documentElement.outerHTML;
      dlBlob(new Blob([src], { type: f === 'doc' ? 'application/msword' : 'text/html;charset=utf-8' }), name + (f === 'doc' ? '.doc' : '.html'));
    }

    store.get(NP_KEY, null).then(function (raw) {
      if (!ui.isConnected) return;
      NP = npNorm(raw);
      draw(); load(cur());
    });
    /* leaving the editor (another tab, the window's ✕) writes the draft at once */
    ed.addEventListener('blur', function () { if (NP) flush(); });
  }
  SYFS.tools.push({
    id: 'notepad', name: 'المفكّرة', cat: 'note',
    icon: S + '<path d="M3 7h18"/><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 11h10M7 15h6"/><path d="M8 3v4M13 3v4"/></svg>',
    mount: mountNotepad
  });

  /* pure bits for tools/tools3-test.js (harmless in the page) */
  SYFS.tools3 = { exifParse: exifParse, domToMd: domToMd, diffWords: diffWords, lcs: lcs, workDays: workDays, addWorkDays: addWorkDays, ymd: ymd, tlReport: tlReport, tlClean: tlClean, holidayKey: holidayKey, npClean: npClean, npNorm: npNorm, qrTiles: qrTiles, wifiParse: wifiParse, qrKind: qrKind, sessRename: sessRename };
})();
