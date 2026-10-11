/* SYF — «الاستوديو» › الإعدادات (v0.166.0): the floating capture bar and how the studio
 * opens. Written straight to chrome.storage.local under the keys their owners read —
 * src/capbar.js (capbar_auto / capbar_pos / capbar_mic), src/media.js (cap_after, v0.169.0)
 * and src/studio.js (studio_mode) —
 * both follow storage.onChanged, so a change here reaches every open tab at once.
 * Every value is whitelisted on the way in AND out, the same lists the owners use. */
(function () {
  'use strict';
  var SL = window.SL, I = SL.icon;
  if (!(window.chrome && chrome.storage && chrome.storage.local)) return;   /* outside the extension: nothing to set */

  var POS = ['bottom', 'top'], MODES = ['win', 'full'], AFTER = ['editor', 'copy'];
  function pick(list, v, d) { return list.indexOf(v) >= 0 ? v : d; }
  function put(k, v) { var o = {}; o[k] = v; chrome.storage.local.set(o); }

  function check(label, on, onChange) {
    var w = SL.h('<label class="check"><input type="checkbox" class="sw"><span></span></label>');
    w.querySelector('span').textContent = SL.t(label);
    var c = w.querySelector('input'); c.checked = !!on;
    c.addEventListener('change', function () { onChange(c.checked); });
    return w;
  }

  function mount(body) {
    var grid = SL.h('<div class="grid2"><div class="card stack" data-l></div><div class="card stack" data-r></div></div>');
    body.appendChild(grid);
    var L = grid.querySelector('[data-l]'), R = grid.querySelector('[data-r]');
    chrome.storage.local.get({ capbar_auto: false, capbar_pos: 'bottom', capbar_mic: false, cap_after: 'editor', studio_mode: 'win' }, function (s) {
      L.appendChild(SL.h('<h3>' + I('camera', 's') + 'شريط الالتقاط العائم</h3>'));
      L.appendChild(check('إظهاره تلقائياً في كل صفحة', s.capbar_auto === true, function (v) { put('capbar_auto', v); }));
      /* media.js quickShot reads cap_after on every capture; the bar has the same switch */
      L.appendChild(SL.h('<div class="field"><label>بعد الالتقاط</label></div>'));
      L.lastChild.appendChild(SL.seg([['editor', 'فتح المحرّر', 'brush'], ['copy', 'نسخ للحافظة', 'copy']], pick(AFTER, s.cap_after, 'editor'),
        function (v) { put('cap_after', pick(AFTER, v, 'editor')); }));
      L.appendChild(SL.h('<div class="field"><label>مكانه على الشاشة</label></div>'));
      L.lastChild.appendChild(SL.seg([['bottom', 'أسفل الصفحة', 'down'], ['top', 'أعلى الصفحة', 'up']], pick(POS, s.capbar_pos, 'bottom'),
        function (v) { put('capbar_pos', pick(POS, v, 'bottom')); }));
      L.appendChild(check('تسجيل الميكروفون مع الفيديو', s.capbar_mic === true, function (v) { put('capbar_mic', v); }));
      L.appendChild(SL.h('<div class="note">الاختصار Ctrl + Alt + R يُظهر الشريط ويخفيه — يُغيَّر من «اختصارات لوحة المفاتيح» في إعدادات الإضافة.</div>'));

      R.appendChild(SL.h('<h3>' + I('floatwin', 's') + 'طريقة فتح الاستوديو</h3>'));
      R.appendChild(SL.seg([['win', 'نافذة عائمة‖وضع الاستوديو', 'floatwin'], ['full', 'ملء الشاشة', 'maximize']], pick(MODES, s.studio_mode, 'win'),
        function (v) { put('studio_mode', pick(MODES, v, 'win')); }));
      R.appendChild(SL.h('<div class="note">تبدّل بينهما في أي وقت من الزرّ أعلى الاستوديو — ويُحفظ آخر اختيار.</div>'));
      R.appendChild(SL.h('<h3 style="margin-top:8px">' + I('theme', 's') + 'المظهر</h3>'));
      R.appendChild(SL.h('<div class="note">«لون الإضافة» يتبع اللون المختار في إعدادات الإضافة. باقي المظاهر من زرّ «المظهر» في الأعلى.</div>'));
    });
  }

  SL.tools.push({ id: 'settings', group: 'settings', label: 'الإعدادات', icon: 'settings', desc: 'شريط الالتقاط العائم وطريقة فتح الاستوديو.', mount: mount });
}());
