/* SYF — qrtool.html: ONE QR tool on the extension's own origin (phase-2 review).
 *
 * The fragment picks the tool against a fixed list — `#qrgen`, `#qrread`, `#qrcam`
 * (the reader with its camera started, since the user's click that opened this window
 * WAS «📷 الكاميرا»). Nothing else from the URL is read. The tool is the shipped one
 * (src/tools2-body.js / src/tools3.js); it notices it is on an extension page through
 * SYFS.inExtPage() and drops the «this site would get the permission» warnings,
 * because here it would not.
 *
 * Theme: light by default, a visible toggle, the choice remembered per browser
 * (localStorage — a per-viewer convenience; a failure only means it is not remembered).
 * Accent: the user's stored `accent`, the same rule as the rail (#rrggbb or nothing). */
(function () {
  var PAGES = { qrgen: 'qrgen', qrread: 'qrread', qrcam: 'qrread' };
  var THEME_KEY = 'syf-qrtool-theme';
  var root = document.documentElement, wrap = document.getElementById('qt-root'), body = document.getElementById('qt-body');
  var themeB = document.getElementById('qt-theme');

  function t(s) { return (window.SYFS && SYFS.t) ? SYFS.t.apply(null, arguments) : s; }
  function paintTheme(dark) {
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    themeB.setAttribute('aria-pressed', dark ? 'true' : 'false');
    themeB.textContent = dark ? t('الوضع الفاتح') : t('الوضع الداكن');
  }
  var dark = false;
  try { dark = localStorage.getItem(THEME_KEY) === 'dark'; } catch (e) { dark = false; }
  paintTheme(dark);
  themeB.addEventListener('click', function () {
    dark = !dark; paintTheme(dark);
    try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch (e) { /* not remembered — still switched */ }
  });

  function applyAccent(hex) {
    if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    var c = [1, 3, 5].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); });
    var d = c.map(function (v) { return Math.round(v * 0.72); });
    wrap.style.setProperty('--pri', 'rgb(' + c.join(',') + ')');
    wrap.style.setProperty('--pri-rgb', c.join(','));
    wrap.style.setProperty('--pri-d', 'rgb(' + d.join(',') + ')');
    wrap.style.setProperty('--pri-d-rgb', d.join(','));
  }

  function mount() {
    var key = String(location.hash || '').replace(/^#/, '');
    var id = Object.prototype.hasOwnProperty.call(PAGES, key) ? PAGES[key] : null;
    var tool = null;
    (window.SYFS && SYFS.tools || []).forEach(function (x) { if (x && x.id === id) tool = x; });
    wrap.setAttribute('dir', SYFS.i18n ? SYFS.i18n.dir() : 'rtl');
    themeB.textContent = dark ? t('الوضع الفاتح') : t('الوضع الداكن');
    if (!tool || typeof tool.mount !== 'function') {
      var p = document.createElement('p'); p.className = 'qt-err'; p.textContent = t('أداة غير معروفة.');
      body.appendChild(p); return;
    }
    document.getElementById('qt-title').textContent = t(tool.name);
    document.title = t(tool.name) + ' — SYF';
    /* the tool's own constant glyph, never URL or user data */
    document.getElementById('qt-ic').innerHTML = tool.icon || '';
    tool.mount(body);
    if (key === 'qrcam') { var cam = body.querySelector('#qr-cam'); if (cam) cam.click(); }
  }

  try { if (SYFS.store) SYFS.store.get('accent', '').then(applyAccent); } catch (e) {}
  /* the stored language first, so every string the tool builds is in it from the start */
  var started = false;
  function go() { if (started) return; started = true; mount(); }
  try {
    chrome.storage.local.get({ ui_lang: 'ar' }, function (r) {
      var l = (r && r.ui_lang === 'en') ? 'en' : 'ar';
      SYFS.i18n.apply(l).then(go, go);
    });
  } catch (e) { go(); }
  setTimeout(go, 1500);   /* a storage that never answers must not leave an empty window */
}());
