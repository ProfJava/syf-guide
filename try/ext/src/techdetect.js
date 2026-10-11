/* SYF — «كاشف تقنيات الموقع» (Wappalyzer-style, fully local).
 * Fingerprints the CURRENT page only, from signals already in the browser:
 *   - <meta generator>, script/link URLs, DOM ids/attributes, cookies  (isolated world)
 *   - JS globals (jQuery/React/Vue/…) via a one-shot MAIN-world inline probe
 *     that degrades silently when the page CSP blocks inline scripts
 *   - response headers (Server / X-Powered-By / CDN) via a HEAD fetch of the
 *     page's own URL (uses the existing <all_urls> host permission)
 * No external service, no new permission, nothing is uploaded.
 * Loaded BEFORE src/rail.js. */
(function () {
  window.SYFS = window.SYFS || {};
  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    /* the template's own text IS the msgid — translate the built tree rather than
       splitting the markup (see src/i18n.js). Free in the default language. */
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }

  var CAT_LABEL = {
    cms: 'المنصّة / نظام إدارة المحتوى',
    framework: 'أطر العمل (Frameworks)',
    backend: 'لغة / تقنية الخلفية',
    server: 'الخادم والاستضافة (CDN)',
    lib: 'المكتبات',
    analytics: 'التحليلات والتتبّع',
    ui: 'الواجهة والخطوط'
  };
  var CAT_ORDER = ['cms', 'framework', 'backend', 'server', 'lib', 'analytics', 'ui'];

  /* script/link URL substring → [category, name] */
  var SRC_SIGS = [
    [/wp-content|wp-includes/i, 'cms', 'WordPress'],
    [/cdn\.shopify\.com|shopify\.com\/s\//i, 'cms', 'Shopify'],
    [/parastorage\.com|static\.wixstatic\.com/i, 'cms', 'Wix'],
    [/static1?\.squarespace\.com/i, 'cms', 'Squarespace'],
    [/elementor/i, 'lib', 'Elementor'],
    [/_next\/static/i, 'framework', 'Next.js'],
    [/nuxt/i, 'framework', 'Nuxt.js'],
    [/react(?:-dom)?(?:\.min|\.production|@)/i, 'framework', 'React'],
    [/vue(?:\.min|\.runtime|\.global|@)/i, 'framework', 'Vue.js'],
    [/(?:@angular|angular(?:\.min)?\.js)/i, 'framework', 'Angular'],
    [/alpinejs|alpine(?:\.min)?\.js/i, 'framework', 'Alpine.js'],
    [/jquery[.\-/]/i, 'lib', 'jQuery'],
    [/bootstrap(?:\.bundle)?(?:\.min)?\.(?:js|css)/i, 'lib', 'Bootstrap'],
    [/gsap|TweenMax/i, 'lib', 'GSAP'],
    [/three(?:\.min)?\.js|three@/i, 'lib', 'Three.js'],
    [/\bd3(?:\.min)?\.js|d3\.v\d/i, 'lib', 'D3.js'],
    [/lodash/i, 'lib', 'Lodash'],
    [/underscore/i, 'lib', 'Underscore.js'],
    [/moment(?:\.min)?\.js/i, 'lib', 'Moment.js'],
    [/axios/i, 'lib', 'Axios'],
    [/swiper/i, 'lib', 'Swiper'],
    [/slick(?:\.min)?\.(?:js|css)/i, 'lib', 'Slick'],
    [/\baos(?:\.min)?\.(?:js|css)/i, 'lib', 'AOS'],
    [/owl\.carousel/i, 'lib', 'Owl Carousel'],
    [/popper(?:\.min)?\.js/i, 'lib', 'Popper.js'],
    [/cdnjs\.cloudflare\.com/i, 'lib', 'cdnjs'],
    [/cdn\.jsdelivr\.net/i, 'lib', 'jsDelivr'],
    [/unpkg\.com/i, 'lib', 'unpkg'],
    [/tailwind/i, 'ui', 'Tailwind CSS'],
    [/font-?awesome|fontawesome/i, 'ui', 'Font Awesome'],
    [/fonts\.googleapis\.com|fonts\.gstatic\.com/i, 'ui', 'Google Fonts'],
    [/googletagmanager\.com\/gtm\.js/i, 'analytics', 'Google Tag Manager'],
    [/googletagmanager\.com\/gtag\/js|google-analytics\.com\/(?:analytics|ga)\.js/i, 'analytics', 'Google Analytics'],
    [/connect\.facebook\.net\/[^ ]*(?:sdk|fbevents)/i, 'analytics', 'Facebook Pixel'],
    [/static\.hotjar\.com|hotjar/i, 'analytics', 'Hotjar'],
    [/cdn\.segment\.com/i, 'analytics', 'Segment'],
    [/cdn\.mxpnl\.com|mixpanel/i, 'analytics', 'Mixpanel'],
    [/mc\.yandex\.ru|metrika/i, 'analytics', 'Yandex Metrica'],
    [/matomo|piwik/i, 'analytics', 'Matomo'],
    [/clarity\.ms/i, 'analytics', 'Microsoft Clarity']
  ];

  /* document.cookie substring → [category, name] (HttpOnly cookies stay hidden) */
  var COOKIE_SIGS = [
    [/(?:^|;\s*)(?:wordpress_|wp-settings)/i, 'cms', 'WordPress'],
    [/(?:^|;\s*)woocommerce_/i, 'cms', 'WooCommerce'],
    [/(?:^|;\s*)PrestaShop/i, 'cms', 'PrestaShop'],
    [/(?:^|;\s*)_shopify_/i, 'cms', 'Shopify'],
    [/(?:^|;\s*)(?:laravel_session|XSRF-TOKEN)/i, 'backend', 'Laravel'],
    [/(?:^|;\s*)ci_session/i, 'backend', 'CodeIgniter'],
    [/(?:^|;\s*)PHPSESSID/i, 'backend', 'PHP'],
    [/(?:^|;\s*)(?:ASP\.NET_SessionId|\.AspNet)/i, 'backend', 'ASP.NET'],
    [/(?:^|;\s*)JSESSIONID/i, 'backend', 'Java (JSP/Servlet)'],
    [/(?:^|;\s*)csrftoken/i, 'backend', 'Django'],
    [/(?:^|;\s*)_ga(?:_|=)/i, 'analytics', 'Google Analytics'],
    [/(?:^|;\s*)_fbp=/i, 'analytics', 'Facebook Pixel']
  ];

  function detectMeta(add) {
    var gen = (document.querySelector('meta[name="generator"]') || {}).content || '';
    var sigs = [
      ['wordpress', 'cms', 'WordPress'], ['woocommerce', 'cms', 'WooCommerce'], ['joomla', 'cms', 'Joomla'],
      ['drupal', 'cms', 'Drupal'], ['shopify', 'cms', 'Shopify'], ['wix', 'cms', 'Wix'],
      ['squarespace', 'cms', 'Squarespace'], ['ghost', 'cms', 'Ghost'], ['typo3', 'cms', 'TYPO3'],
      ['prestashop', 'cms', 'PrestaShop'], ['blogger', 'cms', 'Blogger'],
      ['hugo', 'framework', 'Hugo'], ['gatsby', 'framework', 'Gatsby'], ['hexo', 'framework', 'Hexo'],
      ['jekyll', 'framework', 'Jekyll'], ['elementor', 'lib', 'Elementor']
    ];
    sigs.forEach(function (s) {
      if (new RegExp(s[0], 'i').test(gen)) {
        var v = (gen.match(new RegExp(s[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*([\\d.]+)', 'i')) || [])[1];
        add(s[1], s[2], { version: v, via: 'meta generator' });
      }
    });
    if (document.querySelector('meta[name="shopify-digital-wallet"]')) add('cms', 'Shopify', { via: 'meta' });
  }

  function detectDom(add) {
    function q(s) { try { return document.querySelector(s); } catch (e) { return null; } }
    if (q('#__next')) add('framework', 'Next.js', { via: '#__next' });
    if (q('#__nuxt') || q('#__layout')) add('framework', 'Nuxt.js', { via: '#__nuxt' });
    if (q('#___gatsby')) add('framework', 'Gatsby', { via: '#___gatsby' });
    var ng = q('[ng-version]'); if (ng) add('framework', 'Angular', { version: ng.getAttribute('ng-version'), via: 'ng-version' });
    if (q('[data-reactroot]')) add('framework', 'React', { via: 'data-reactroot' });
    if (q('[data-server-rendered]')) add('framework', 'Vue.js', { via: 'SSR' });
    if (q('[x-data]') || q('[x-cloak]')) add('framework', 'Alpine.js', { via: 'x-data' });
    if (q('[data-wf-page]') || q('html.w-mod-js')) add('cms', 'Webflow', { via: 'DOM' });
    if (q('.woocommerce') || q('body.woocommerce-page')) add('cms', 'WooCommerce', { via: 'DOM' });
    if (q('[class*="svelte-"]')) add('framework', 'Svelte', { via: 'class' });
  }

  function detectSrc(add) {
    var urls = [];
    document.querySelectorAll('script[src]').forEach(function (s) { urls.push(s.src); });
    document.querySelectorAll('link[href]').forEach(function (l) { urls.push(l.href); });
    var blob = urls.join(' ');
    SRC_SIGS.forEach(function (sig) { if (sig[0].test(blob)) add(sig[1], sig[2], { via: 'ملف' }); });
  }

  function detectCookies(add) {
    var ck = '';
    try { ck = document.cookie || ''; } catch (e) {}
    COOKIE_SIGS.forEach(function (sig) { if (sig[0].test(ck)) add(sig[1], sig[2], { via: 'كوكيز' }); });
  }

  function detectHeaders(headers, add) {
    function g(n) { return headers.get(n) || ''; }
    var server = g('server'), xpb = g('x-powered-by'), xgen = g('x-generator');
    if (/nginx/i.test(server)) add('server', 'Nginx', { version: (server.match(/nginx\/([\d.]+)/i) || [])[1], via: 'Server' });
    if (/apache/i.test(server)) add('server', 'Apache', { version: (server.match(/Apache\/([\d.]+)/i) || [])[1], via: 'Server' });
    if (/litespeed/i.test(server)) add('server', 'LiteSpeed', { via: 'Server' });
    if (/(?:^|\s)IIS|microsoft-iis/i.test(server)) add('server', 'Microsoft IIS', { version: (server.match(/IIS\/([\d.]+)/i) || [])[1], via: 'Server' });
    if (/openresty/i.test(server)) add('server', 'OpenResty', { via: 'Server' });
    if (/caddy/i.test(server)) add('server', 'Caddy', { via: 'Server' });
    if (/cloudflare/i.test(server) || g('cf-ray')) add('server', 'Cloudflare', { via: 'CDN' });
    if (/vercel/i.test(server) || g('x-vercel-id')) add('server', 'Vercel', { via: 'CDN' });
    if (/netlify/i.test(server)) add('server', 'Netlify', { via: 'CDN' });
    if (/varnish|fastly/i.test(g('x-served-by') + ' ' + g('via'))) add('server', 'Fastly / Varnish', { via: 'CDN' });
    if (/amazons3|awselb|amazon/i.test(server) || g('x-amz-cf-id')) add('server', 'AWS', { via: 'CDN' });
    if (/gws|google frontend/i.test(server)) add('server', 'Google', { via: 'Server' });
    if (/PHP/i.test(xpb)) add('backend', 'PHP', { version: (xpb.match(/PHP\/([\d.]+)/i) || [])[1], via: 'X-Powered-By' });
    if (/ASP\.NET/i.test(xpb) || g('x-aspnet-version')) add('backend', 'ASP.NET', { version: g('x-aspnet-version') || undefined, via: 'header' });
    if (/Express/i.test(xpb)) add('backend', 'Express', { via: 'X-Powered-By' });
    if (/Servlet|JSP/i.test(xpb)) add('backend', 'Java', { via: 'X-Powered-By' });
    if (/Phusion Passenger/i.test(xpb)) add('backend', 'Ruby (Passenger)', { via: 'X-Powered-By' });
    if (/Next\.js/i.test(xpb) || g('x-nextjs-cache') || g('x-nextjs-prerender')) add('framework', 'Next.js', { via: 'header' });
    if (/Drupal/i.test(xgen) || g('x-drupal-cache') || g('x-drupal-dynamic-cache')) add('cms', 'Drupal', { via: 'header' });
    if (g('x-shopify-stage')) add('cms', 'Shopify', { via: 'header' });
    if (/WP Engine/i.test(xpb + ' ' + server)) add('server', 'WP Engine', { via: 'header' });
  }

  /* runs in the page's MAIN world; writes JSON of detected globals into node #nid */
  function mainWorldProbe(nid) {
    try {
      var w = window, r = {};
      r.jquery = (w.jQuery && w.jQuery.fn && w.jQuery.fn.jquery) || (w.$ && w.$.fn && w.$.fn.jquery) || undefined;
      r.react = (w.React && w.React.version) || (w.__REACT_DEVTOOLS_GLOBAL_HOOK__ ? true : undefined);
      r.vue = (w.Vue && w.Vue.version) || (w.__VUE__ ? true : undefined);
      r.angular = (w.getAllAngularRootElements || w.ng ? true : undefined) || (w.angular && w.angular.version && w.angular.version.full);
      r.next = w.__NEXT_DATA__ ? true : undefined;
      r.nuxt = w.__NUXT__ ? true : undefined;
      r.gsap = (w.gsap && w.gsap.version) || (w.TweenMax ? true : undefined);
      r.three = (w.THREE && w.THREE.REVISION) ? ('r' + w.THREE.REVISION) : (w.THREE ? true : undefined);
      r.d3 = (w.d3 && w.d3.version) || undefined;
      r.lodash = (w._ && w._.VERSION && w._.chunk) ? w._.VERSION : undefined;
      r.moment = (w.moment && w.moment.version) || undefined;
      r.bootstrap = (w.bootstrap && (w.bootstrap.Tooltip || w.bootstrap.Modal)) ? true : undefined;
      r.swiper = w.Swiper ? true : undefined;
      r.gtag = w.gtag ? true : undefined;
      r.dataLayer = (w.dataLayer && w.dataLayer.push) ? true : undefined;
      r.gtm = w.google_tag_manager ? true : undefined;
      r.fbq = w.fbq ? true : undefined;
      r.hotjar = w.hj ? true : undefined;
      r.mixpanel = w.mixpanel ? true : undefined;
      r.clarity = w.clarity ? true : undefined;
      r.shopify = w.Shopify ? true : undefined;
      r.wix = (w.wixBiSession || w.wixPerformanceMeasurements) ? true : undefined;
      r.squarespace = (w.Squarespace || (w.Static && w.Static.SQUARESPACE_CONTEXT)) ? true : undefined;
      var n = document.getElementById(nid);
      if (n) n.textContent = JSON.stringify(r);
    } catch (e) {}
  }

  /* inject the probe; returns {} if the page CSP blocks inline scripts */
  function probeGlobals() {
    var out = {};
    try {
      var nid = 'syfs-tp-' + Math.random().toString(36).slice(2);
      var node = document.createElement('div'); node.id = nid; node.style.display = 'none';
      var root = document.documentElement;
      root.appendChild(node);
      var s = document.createElement('script');
      s.textContent = '(' + mainWorldProbe.toString() + ')(' + JSON.stringify(nid) + ');';
      root.appendChild(s);                    /* inline script executes synchronously here (if CSP allows) */
      s.remove();
      try { out = JSON.parse(node.textContent || '{}'); } catch (e) {}
      node.remove();
    } catch (e) {}
    return out;
  }
  function detectGlobals(g, add) {
    function ver(x) { return (x && x !== true) ? String(x) : ''; }
    if (g.jquery) add('lib', 'jQuery', { version: ver(g.jquery), via: 'JS' });
    if (g.react) add('framework', 'React', { version: ver(g.react), via: 'JS' });
    if (g.vue) add('framework', 'Vue.js', { version: ver(g.vue), via: 'JS' });
    if (g.angular) add('framework', 'Angular', { version: ver(g.angular), via: 'JS' });
    if (g.next) add('framework', 'Next.js', { via: 'JS' });
    if (g.nuxt) add('framework', 'Nuxt.js', { via: 'JS' });
    if (g.gsap) add('lib', 'GSAP', { version: ver(g.gsap), via: 'JS' });
    if (g.three) add('lib', 'Three.js', { version: ver(g.three), via: 'JS' });
    if (g.d3) add('lib', 'D3.js', { version: ver(g.d3), via: 'JS' });
    if (g.lodash) add('lib', 'Lodash', { version: ver(g.lodash), via: 'JS' });
    if (g.moment) add('lib', 'Moment.js', { version: ver(g.moment), via: 'JS' });
    if (g.bootstrap) add('lib', 'Bootstrap', { via: 'JS' });
    if (g.swiper) add('lib', 'Swiper', { via: 'JS' });
    if (g.gtag || g.dataLayer) add('analytics', 'Google Analytics', { via: 'JS' });
    if (g.gtm) add('analytics', 'Google Tag Manager', { via: 'JS' });
    if (g.fbq) add('analytics', 'Facebook Pixel', { via: 'JS' });
    if (g.hotjar) add('analytics', 'Hotjar', { via: 'JS' });
    if (g.mixpanel) add('analytics', 'Mixpanel', { via: 'JS' });
    if (g.clarity) add('analytics', 'Microsoft Clarity', { via: 'JS' });
    if (g.shopify) add('cms', 'Shopify', { via: 'JS' });
    if (g.wix) add('cms', 'Wix', { via: 'JS' });
    if (g.squarespace) add('cms', 'Squarespace', { via: 'JS' });
  }

  function fetchHeaders() {
    return new Promise(function (resolve) {
      if (!/^https?:$/.test(location.protocol)) { resolve(null); return; }
      var ctrl, to;
      try { ctrl = new AbortController(); to = setTimeout(function () { ctrl.abort(); }, 4000); } catch (e) {}
      /* ⛔ never re-request THIS url with the user's cookies (v0.139.3): the page may be a
         one-time link (magic login, password reset, e-mail verify, OAuth callback) and a
         second hit — even a HEAD — can spend it. The site root, cookieless, carries the
         same server/framework headers the detector reads. */
      fetch(location.origin + '/', { method: 'HEAD', credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: ctrl ? ctrl.signal : undefined })
        .then(function (res) { clearTimeout(to); resolve(res.headers); })
        .catch(function () { clearTimeout(to); resolve(null); });
    });
  }

  function mkAdd(map) {
    return function (cat, name, opts) {
      opts = opts || {};
      if (map[name]) {
        if (!map[name].version && opts.version) map[name].version = opts.version;
        if (!map[name].via && opts.via) map[name].via = opts.via;
        return;
      }
      map[name] = { cat: cat, version: opts.version || '', via: opts.via || '' };
    };
  }

  /* ---- used fonts / font-sizes / colours, from computed styles ---- */
  function normColor(c) {
    var m = /rgba?\(([^)]+)\)/i.exec(c || '');
    if (!m) return null;
    var p = m[1].split(',').map(function (x) { return parseFloat(x); });
    if (p.length >= 4 && p[3] === 0) return null;                 /* fully transparent */
    function hx(v) { v = Math.max(0, Math.min(255, Math.round(v || 0))); return ('0' + v.toString(16)).slice(-2); }
    return '#' + hx(p[0]) + hx(p[1]) + hx(p[2]);
  }
  function topN(map, k) {
    return Object.keys(map).map(function (x) { return { k: x, c: map[x] }; })
      .sort(function (a, b) { return b.c - a.c; }).slice(0, k);
  }
  function analyzeStyles() {
    var fonts = {}, sizes = {}, colors = {};
    var els = document.body ? document.body.querySelectorAll('*') : [];
    var n = Math.min(els.length, 4000);
    for (var i = 0; i < n; i++) {
      var el = els[i];
      if (el.id === 'syfs-host' || (el.closest && el.closest('#syfs-host'))) continue;
      var cs; try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      var hasText = false, cn = el.childNodes;
      for (var j = 0; cn && j < cn.length; j++) { if (cn[j].nodeType === 3 && cn[j].textContent.trim()) { hasText = true; break; } }
      if (hasText) {
        var ff = (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
        if (ff) fonts[ff] = (fonts[ff] || 0) + 1;
        if (cs.fontSize) sizes[cs.fontSize] = (sizes[cs.fontSize] || 0) + 1;
        var tc = normColor(cs.color); if (tc) colors[tc] = (colors[tc] || 0) + 1;
      }
      var bc = normColor(cs.backgroundColor); if (bc) colors[bc] = (colors[bc] || 0) + 1;
    }
    return { fonts: topN(fonts, 12), sizes: topN(sizes, 14), colors: topN(colors, 18) };
  }

  SYFS.tools = SYFS.tools || [];
  SYFS.tools.push({
    id: 'techdetect', name: 'كاشف تقنيات الموقع', cat: 'dev',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/></svg>',
    mount: function (body) {
      var host = (location.hostname || '').replace(/^www\./, '');
      var ui = h(
        '<div class="syf-form">' +
          '<div class="syf-out" style="grid-template-columns:1fr"><div><span>الموقع الحالي</span><b id="t9-host"></b></div></div>' +
          '<button class="syf-btn" id="t9-go">🔍 اكشف التقنيات المستخدمة</button>' +
          '<div class="syf-empty" id="t9-st" style="display:none"></div>' +
          '<div class="syf-note-list" id="t9-list"></div>' +
          '<div class="syf-note-hint">فحص محلي بالكامل لهذه الصفحة فقط (لا يُرفع شيء). قد تُخفي بعض المواقع تقنياتها. البصمات تقريبية.</div>' +
        '</div>'
      );
      body.appendChild(ui);
      ui.querySelector('#t9-host').textContent = host || SYFS.t('صفحة غير مدعومة');
      var st = ui.querySelector('#t9-st'), list = ui.querySelector('#t9-list');
      function show(t) { st.style.display = ''; st.textContent = t; }

      function catHead(t) { var head = h('<div class="syf-mg-cat"><span></span></div>'); head.querySelector('span').textContent = t; list.appendChild(head); }
      function renderStyles(s) {
        if (!s) return;
        if (s.fonts.length) {
          catHead('الخطوط المستخدمة');
          s.fonts.forEach(function (f) {
            var r = h('<div class="syf-note-row"><span class="t syf-ltr-tok"></span><b></b></div>');
            r.querySelector('.t').textContent = f.k; r.querySelector('b').textContent = f.c; r.querySelector('b').style.cssText = 'font-size:10px;color:var(--mut)';
            list.appendChild(r);
          });
        }
        if (s.sizes.length) {
          catHead('أحجام الخطوط');
          var srow = h('<div style="display:flex;flex-wrap:wrap;gap:5px;padding:2px 0"></div>');
          s.sizes.forEach(function (z) {
            var c = h('<span style="background:var(--soft);border-radius:6px;padding:3px 7px;font-size:11.5px;color:var(--ink);direction:ltr"></span>');
            c.textContent = z.k; c.title = SYFS.t('{0} عنصر', z.c); srow.appendChild(c);
          });
          list.appendChild(srow);
        }
        if (s.colors.length) {
          catHead('الألوان المستخدمة');
          var grid = h('<div style="display:flex;flex-wrap:wrap;gap:6px;padding:2px 0"></div>');
          s.colors.forEach(function (c) {
            var cell = h('<div style="display:flex;flex-direction:column;align-items:center;gap:2px;width:46px"><span class="sw" style="width:100%;height:26px;border-radius:6px;border:1px solid var(--line)"></span><span class="lb" style="font-size:9px;color:var(--mut);direction:ltr"></span></div>');
            cell.querySelector('.sw').style.background = c.k; cell.querySelector('.sw').title = c.k + ' — ' + c.c;
            cell.querySelector('.lb').textContent = c.k;
            grid.appendChild(cell);
          });
          list.appendChild(grid);
        }
      }
      function render(map, styles) {
        list.innerHTML = '';
        var names = Object.keys(map);
        show(names.length ? ('اكتُشفت ' + names.length + ' تقنية:') : 'لم تُكتشف تقنيات معروفة — لكن هذه الخطوط والألوان:');
        CAT_ORDER.forEach(function (cat) {
          var items = names.filter(function (n) { return map[n].cat === cat; });
          if (!items.length) return;
          catHead(CAT_LABEL[cat] || cat);
          items.forEach(function (n) {
            var it = map[n];
            var r = h('<div class="syf-note-row"><span class="t"></span><b></b></div>');
            r.querySelector('.t').textContent = n + (it.version ? ' ' + it.version : '');
            var b = r.querySelector('b'); b.textContent = it.via || ''; b.style.cssText = 'font-size:10px;color:var(--mut);font-weight:600';
            list.appendChild(r);
          });
        });
        renderStyles(styles);
      }

      ui.querySelector('#t9-go').addEventListener('click', function () {
        list.innerHTML = ''; show(SYFS.t('جارٍ الفحص…'));
        var map = {}, add = mkAdd(map);
        detectMeta(add); detectDom(add); detectSrc(add); detectCookies(add);
        detectGlobals(probeGlobals(), add);
        var styles = analyzeStyles();                   /* fonts / sizes / colours (computed once) */
        render(map, styles);                            /* instant DOM/JS result */
        fetchHeaders().then(function (headers) {        /* enrich with server/CDN/backend */
          if (headers) { detectHeaders(headers, add); render(map, styles); }
        });
      });
    }
  });
}());
