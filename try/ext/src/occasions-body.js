/* SYF — the tool BODIES of src/occasions.js, injected on demand (v0.139.5).
 *
 * Split out of src/occasions.js so the eager content-script bundle stops parsing them on
 * every page. background.js → LAZY_TOOL_FILES injects this file the first time the user
 * opens the rail's tools (src/rail.js → ensureTools); extension pages (app/word/…) load it
 * with a <script> right after its eager half.
 *
 * ⛔ Everything that must run at PAGE LOAD stays in src/occasions.js (listeners, boots,
 *    the APIs other files call). This file only REGISTERS tools; nothing here may run
 *    before a tool is mounted. The helpers it shares with the eager half come from
 *    `SYFS._occ`, set there — the aliases below are read once, so a helper must never
 *    be REASSIGNED in the eager half (tools/perf-split-test.js checks the contract). */
(function () {
  window.SYFS = window.SYFS || {};
  var P = SYFS._occ || {};
  var store = P.store, h = P.h, send = P.send, OCC_DEFS = P.OCC_DEFS, OCC_DEFAULTS = P.OCC_DEFAULTS, occSettings = P.occSettings, occHijri = P.occHijri, occScan = P.occScan, occRuns = P.occRuns, occDef = P.occDef, TYPE_LABEL = P.TYPE_LABEL, occHijriT = P.occHijriT, AR = P.AR, gregText = P.gregText, whenText = P.whenText, daysText = P.daysText;

  SYFS.tools = SYFS.tools || [];
  SYFS.tools.push({
    id: 'occasions', name: 'المناسبات والأيام الفاضلة', cat: 'islam',
    /* Solid calendar with the page and the star knocked out of it by
     * fill-rule="evenodd" — one path, no strokes. The stroked version read as a
     * grey smudge at the 16px the shelf actually renders: hairlines are the first
     * thing to vanish when a glyph is scaled down, and this icon's whole job is to
     * be recognised at that size. Fills 87.5% x 87.5% of its box, so no crop. */
    icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M4.5 1.5 L19.5 1.5 C21.157 1.5 22.5 2.843 22.5 4.5 L22.5 19.5 C22.5 21.157 21.157 22.5 19.5 22.5 L4.5 22.5 C2.843 22.5 1.5 21.157 1.5 19.5 L1.5 4.5 C1.5 2.843 2.843 1.5 4.5 1.5 Z M5 8 L19 8 C19.828 8 20.5 8.672 20.5 9.5 L20.5 19 C20.5 19.828 19.828 20.5 19 20.5 L5 20.5 C4.172 20.5 3.5 19.828 3.5 19 L3.5 9.5 C3.5 8.672 4.172 8 5 8 Z M8 3.75 C8.414 3.75 8.75 4.086 8.75 4.5 L8.75 6 C8.75 6.414 8.414 6.75 8 6.75 C7.586 6.75 7.25 6.414 7.25 6 L7.25 4.5 C7.25 4.086 7.586 3.75 8 3.75 Z M16 3.75 C16.414 3.75 16.75 4.086 16.75 4.5 L16.75 6 C16.75 6.414 16.414 6.75 16 6.75 C15.586 6.75 15.25 6.414 15.25 6 L15.25 4.5 C15.25 4.086 15.586 3.75 16 3.75 Z M12 9.85 L13.12 12.71 L16.18 12.89 L13.81 14.84 L14.59 17.81 L12 16.15 L9.41 17.81 L10.19 14.84 L7.82 12.89 L10.88 12.71 Z"/></svg>',
    /* Two panes behind a top strip (v0.124.0): the tool opens on **المناسبات** — the
     * calendar people actually came for — and everything that is a setting (the bell,
     * the lead time, the calendar calibration, which occasions ring) moved behind
     * **الإعدادات**. One 320px window used to stack all of it in a single column, so
     * the next occasion was above eighteen rows of form and the save button was a
     * scroll away from the checkbox it saves. The panes are built once and toggled,
     * not rebuilt — there is no timer here, and `cur` stays the one source of truth. */
    mount: function (body) {
      var ui = h(
        '<div class="syf-form">' +
          '<div class="syf-seg" id="oc-seg" role="tablist"><button type="button" role="tab" id="oc-tab-list" aria-controls="oc-pane-list" data-p="list">🗓 المناسبات</button><button type="button" role="tab" id="oc-tab-set" aria-controls="oc-pane-set" data-p="set">⚙️ الإعدادات</button></div>' +
          '<div id="oc-pane-list" role="tabpanel" aria-labelledby="oc-tab-list" style="display:flex;flex-direction:column;gap:8px;width:100%">' +
            '<div class="syf-row"><b style="flex:1">القادم خلال ٦٠ يوماً</b><span class="syf-note-hint" id="oc-today"></span></div>' +
            '<div class="syf-note-list" id="oc-list"></div>' +
            '<div class="syf-note-hint" id="oc-bell" style="margin:0"></div>' +
          '</div>' +
          '<div id="oc-pane-set" role="tabpanel" aria-labelledby="oc-tab-set" style="display:none;flex-direction:column;gap:8px;width:100%">' +
            '<label class="syf-ck"><input type="checkbox" id="oc-on"> <span>تذكيرني بالمناسبات المفعّلة</span></label>' +
            '<div class="syf-row"><label for="oc-lead" style="margin:0">قبلها بـ</label><select class="syf-in" id="oc-lead"><option value="0">يوم المناسبة</option><option value="1">يوم واحد</option><option value="2">يومين</option><option value="3">٣ أيام</option><option value="7">أسبوع</option></select><label for="oc-at" style="margin:0">الساعة</label><input type="time" class="syf-in" id="oc-at" style="width:110px"></div>' +
            '<div class="syf-note-hint" id="oc-lead-hint" style="display:none">في «يوم المناسبة» يصلك التذكير في اليوم نفسه، والصباح أنسب لأيام الصيام — ولتذكير قبل السحور اختر «يوم واحد».</div>' +
            '<div class="syf-row"><label for="oc-off" style="margin:0">معايرة التقويم</label><select class="syf-in" id="oc-off"><option value="-1">يوم قبل</option><option value="0">أم القرى (افتراضي)</option><option value="1">يوم بعد</option></select></div>' +
            '<div class="syf-note-hint">الحساب فَلَكي (أم القرى) وقد يخالف الرؤية المحلية بيوم — المعايرة تنقل كل التواريخ معاً.</div>' +
            '<b style="align-self:flex-start">أي المناسبات تنبّهك؟</b>' +
            /* fourteen picks would push «حفظ وتفعيل» off the bottom of a 320px window,
               and a save button you have to hunt for is a save button people forget */
            '<div class="syf-note-list" id="oc-keys" style="max-height:240px;overflow-y:auto"></div>' +
            '<div class="syf-row"><button type="button" class="syf-btn" id="oc-save" style="flex:1">حفظ وتفعيل</button><button type="button" class="syf-mini" id="oc-test">تجربة</button></div>' +
            '<div class="syf-empty" id="oc-st" role="status" aria-live="polite" style="display:none"></div>' +
          '</div>' +
        '</div>'
      );
      body.appendChild(ui);
      var q = function (s) { return ui.querySelector(s); };
      var listEl = q('#oc-list'), keysEl = q('#oc-keys'), stEl = q('#oc-st');
      var seg = q('#oc-seg'), panes = { list: q('#oc-pane-list'), set: q('#oc-pane-set') };
      var cur = Object.assign({}, OCC_DEFAULTS);
      function show(t) { stEl.style.display = ''; stEl.textContent = t; }

      /* a real tab list: aria-selected for the reader, one Tab stop (roving tabindex)
         and the arrow keys between the two — the class alone told a screen reader nothing */
      var tabBtns = Array.prototype.slice.call(seg.querySelectorAll('[role="tab"]'));
      function tab(k, focus) {
        tabBtns.forEach(function (b) {
          var on = b.dataset.p === k;
          b.classList.toggle('on', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
          b.tabIndex = on ? 0 : -1;
          if (on && focus) b.focus();
        });
        Object.keys(panes).forEach(function (p) { panes[p].style.display = p === k ? 'flex' : 'none'; });
      }
      seg.addEventListener('click', function (e) { var b = e.target.closest('[role="tab"]'); if (b) tab(b.dataset.p); });
      seg.addEventListener('keydown', function (e) {
        var i = tabBtns.indexOf(e.target), n = tabBtns.length, j = -1;
        if (i < 0) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          /* «next» is the reading direction: leftwards in RTL */
          var fwd = (e.key === 'ArrowLeft') === (SYFS.i18n.dir() === 'rtl');
          j = (i + (fwd ? 1 : n - 1)) % n;
        } else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = n - 1;
        if (j < 0) return;
        e.preventDefault();
        tab(tabBtns[j].dataset.p, true);
      });
      tab('list');

      /* The upcoming list shows EVERY occasion, not just the enabled ones: it is a
       * calendar first and a notifier second, and hiding عرفة because its bell is
       * off would be hiding the thing the user opened the tool to see. */
      function renderList() {
        var runs = occRuns(occScan(Date.now(), 60, cur.offset, null));
        listEl.textContent = '';
        var today = occHijri(new Date(), cur.offset);
        q('#oc-today').textContent = today ? SYFS.t('اليوم: {0}', occHijriT(today)) : SYFS.t('تعذّر قراءة التقويم الهجري');
        /* the settings tab is one click away, so this line says whether the bell is
           on at all — otherwise a silent tool looks broken from the calendar tab */
        var nOn = 0;
        OCC_DEFS.forEach(function (d) { if (cur.keys[d.key]) nOn++; });
        q('#oc-bell').textContent = cur.on
          ? SYFS.t('🔔 التنبيه مفعّل لـ{0} مناسبة — غيّرها من «الإعدادات».', AR(nOn))
          : SYFS.t('🔕 التنبيه مطفأ — فعّله من تبويب «الإعدادات».');
        if (!runs.length) { listEl.appendChild(h('<div class="syf-empty">لا مناسبات في هذه المدة.</div>')); return; }
        /* at most three of any one occasion — أيام البيض alone would fill the list */
        var seen = {};
        runs.forEach(function (r) {
          seen[r.key] = (seen[r.key] || 0) + 1;
          if (seen[r.key] > 3) return;
          var def = occDef(r.key); if (!def) return;
          var row = h('<div class="syf-occ-row"><span class="syf-occ-b"></span>' +
                      '<div class="syf-occ-t"><b></b><span class="syf-occ-d"></span></div>' +
                      '<span class="syf-occ-w"></span></div>');
          row.dataset.t = def.type;
          row.querySelector('.syf-occ-b').textContent = SYFS.t(TYPE_LABEL[def.type] || '');
          row.querySelector('b').textContent = SYFS.t(def.name) + (r.days > 1 ? daysText(r.days) : '');
          row.querySelector('.syf-occ-d').textContent = occHijriT(r.hj) + ' · ' + gregText(r.ts);
          row.querySelector('.syf-occ-w').textContent = whenText(r.ts);
          /* a ring on the occasions that actually notify — the calendar shows all of
             them, the bell marks the ones the user chose */
          if (cur.on && cur.keys[r.key]) { row.querySelector('.syf-occ-w').textContent += ' 🔔'; }
          listEl.appendChild(row);
        });
      }

      function renderKeys() {
        keysEl.textContent = '';
        OCC_DEFS.forEach(function (d) {
          var row = h('<label class="syf-occ-row syf-occ-pick"><input type="checkbox">' +
                      '<div class="syf-occ-t"><b></b><span class="syf-occ-d"></span></div></label>');
          row.dataset.t = d.type;
          var cb = row.querySelector('input');
          cb.checked = !!cur.keys[d.key];
          cb.addEventListener('change', function () { cur.keys[d.key] = cb.checked; });
          row.querySelector('b').textContent = SYFS.t(d.name);
          row.querySelector('.syf-occ-d').textContent = SYFS.t(d.hint);
          keysEl.appendChild(row);
        });
      }

      store.get('occasions', null).then(function (raw) {
        cur = occSettings(raw);
        q('#oc-on').checked = cur.on;
        q('#oc-lead').value = String(cur.lead);
        q('#oc-at').value = cur.at;
        q('#oc-off').value = String(cur.offset);
        leadHint();
        renderKeys(); renderList();
      });

      q('#oc-off').addEventListener('change', function () {
        cur.offset = parseInt(q('#oc-off').value, 10) || 0;
        renderList();
      });

      /* «يوم المناسبة» at the default 20:00 rang after the fast it announced had ended
         (after Maghrib on عرفة). Picking it while the hour is still the default moves
         the hour to the morning, and back again — an hour the user chose is left alone. */
      var AT_EVE = OCC_DEFAULTS.at, AT_MORNING = '07:00';
      function leadHint() { q('#oc-lead-hint').style.display = q('#oc-lead').value === '0' ? '' : 'none'; }
      q('#oc-lead').addEventListener('change', function () {
        var at = q('#oc-at');
        if (q('#oc-lead').value === '0' && at.value === AT_EVE) at.value = AT_MORNING;
        else if (q('#oc-lead').value !== '0' && at.value === AT_MORNING) at.value = AT_EVE;
        leadHint();
      });

      /* the form as it stands, validated — what «حفظ» stores and what «تجربة» rehearses */
      function formSettings() {
        return occSettings({
          on: q('#oc-on').checked,
          lead: parseInt(q('#oc-lead').value, 10),
          at: q('#oc-at').value,
          offset: parseInt(q('#oc-off').value, 10),
          keys: cur.keys
        });
      }

      q('#oc-save').addEventListener('click', function () {
        var s = formSettings();
        cur = s;
        store.set('occasions', s).then(function () {
          send('SYFS_OCC', { op: 'apply' }).then(function (r) {
            show(r.ok ? (SYFS.t('حُفظ وفُعّل ✅') + (r.next ? ' — ' + r.next : '')) : SYFS.t('حُفظ محلياً، وتعذّر تفعيل الجدولة'));
            renderList();
          });
        });
      });

      /* ONE rehearsal, built by the worker exactly as the real reminder is (system
         notification + its toast). The panel used to add a toast of its own computed
         from unsaved choices, so the page showed two — sometimes contradicting each
         other. The form's current (unsaved) settings travel with the request so the
         rehearsal matches what «حفظ» would schedule. */
      q('#oc-test').addEventListener('click', function () {
        send('SYFS_OCC', { op: 'test', s: formSettings() }).then(function (r) {
          show(r.ok ? SYFS.t('أُرسل إشعار تجربة — هكذا سيصلك التذكير.') : SYFS.t('تعذّر إرسال التجربة.'));
        });
      });
    }
  });
}());
