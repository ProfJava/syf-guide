/* SYF — «تسريع التصفح»: three tools in the shield category.
 *   speedlite   Lite Mode — block heavy resources (images/fonts/media) via DNR
 *               dynamic rules (ids 910001-910003, priority 200 so a shield
 *               per-site allowAllRequests rule at 100 does NOT bypass it —
 *               Lite Mode keeps its own independent allowlist).
 *   speedembed  Click-to-load — swap heavy third-party iframes (YouTube, Maps,
 *               Twitter…) for a lightweight placeholder until clicked.
 *   speedfreeze Motion freezer — pause CSS animations, stop media autoplay,
 *               freeze GIFs (first frame onto a canvas → data URL).
 *   speedfetch  Hover prefetch (instant.page style) — <link rel="prefetch">
 *               after ~80ms hover / on mousedown; same-origin, no query
 *               strings, action-word blacklist, 60/page cap, data-saver off.
 *   speedtabs   Tab memory saver — UI only; discarding runs in the worker
 *               (SYFS_TABS ops), which returns counts only (no URLs/titles).
 * The embed/freeze engines run on every page load when enabled (persisted in
 * chrome.storage.local, reacting live via storage.onChanged). Lite Mode rules
 * live in the network layer — managed by background.js via SYFS_DNR lite-* ops.
 * Loaded BEFORE src/rail.js so SYFS.tools / SYFS.cats are populated. */
(function () {
  window.SYFS = window.SYFS || {};

  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    /* the template's own text IS the msgid — translate the built tree rather than
       splitting the markup (see src/i18n.js). Free in the default language. */
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }

  /* ===== SYFS_DNR transport =================================================
   * ⚠️ KEEP THIS BLOCK IDENTICAL to its twin (src/shield.js ⇄ src/speed.js): a test
   * compares the two byte for byte, so this header must read the same in both.
   *
   * Failure has three different cures and one message cannot carry all three:
   *   'dead'      the content script is orphaned — the extension was reloaded or
   *               updated under a page that was already open. Only reloading the
   *               PAGE fixes that; retrying is guaranteed to fail forever.
   *   'asleep'    MV3 tore the worker down mid-await (status alone does two), so
   *               the channel closed with no reply. Asking again wakes it, and the
   *               user should never have to see this one at all.
   *   'internal'  the worker answered {ok:false}: the channel worked perfectly and
   *               reloading the page changes nothing.
   * chrome.runtime.lastError.message is the ONLY place that difference is written.
   * It is read here, mapped to one of the three, and dropped — never shown (it is
   * Chrome's English) and never stored. */
  var DNR_WAIT = 4000;
  function dnrOnce(op, extra) {
    return new Promise(function (resolve) {
      var done = false;
      function settle(v) { if (done) return; done = true; resolve(v); }
      /* a callback that is never invoked must not leave the panel frozen on its
         pre-render state — a promise that never settles has no error to show */
      setTimeout(function () { settle({ ok: false, error: 'asleep' }); }, DNR_WAIT);
      try {
        chrome.runtime.sendMessage(Object.assign({ type: 'SYFS_DNR', op: op }, extra || {}), function (res) {
          var le = chrome.runtime.lastError;
          if (le) { settle({ ok: false, error: /invalidated|Receiving end/i.test(le.message || '') ? 'dead' : 'asleep' }); return; }
          settle(res || { ok: false, error: 'asleep' });
        });
      } catch (e) { settle({ ok: false, error: 'dead' }); }   /* sendMessage itself throws only when the context is gone */
    });
  }
  /* One silent retry, and ONLY for the cause a retry can cure. Safe for writes as
     well as reads: every SYFS_DNR op sets an ABSOLUTE value (enable/disable a
     ruleset, add/remove a domain) — never an increment — so a duplicate that lands
     late changes nothing. */
  function dnr(op, extra) {
    return dnrOnce(op, extra).then(function (r) {
      return (r && (r.ok || r.error !== 'asleep')) ? r : dnrOnce(op, extra);
    });
  }
  var DNR_MSG = {
    dead: 'أُعيد تحميل الإضافة — حدّث هذه الصفحة (F5) ليعود الاتصال.',
    asleep: 'خدمة الحجب لا تستجيب. جرّب مرّة أخرى.',
    internal: 'خطأ داخلي في خدمة الحجب — لم يُطبَّق التغيير.'
  };
  /* the failure block: says which of the three happened, and offers a retry only
     when a retry can possibly work */
  function dnrFail(r, again) {
    var kind = (r && DNR_MSG[r.error]) ? r.error : 'internal';
    var box = h('<div class="syf-empty syf-dnr-fail"></div>');
    box.textContent = SYFS.t(DNR_MSG[kind]);
    if (kind !== 'dead' && again) {
      var b = h('<button class="syf-btn" style="margin-top:8px">أعد المحاولة</button>');
      b.addEventListener('click', function () { again(); });
      box.appendChild(b);
    }
    return box;
  }
  /* a control that failed must SAY so — reverting it silently reads as a UI glitch */
  function failNote(anchor) {
    var f = function (r) { clearFail(anchor); anchor.appendChild(dnrFail(r, null)); };
    f.clear = function () { clearFail(anchor); };   /* the next success takes the message away */
    return f;
  }
  function clearFail(anchor) {
    var p = anchor.querySelector('.syf-dnr-fail'); if (p) p.remove();
  }
  /* ===== end SYFS_DNR transport ============================================= */

  /* ================= engine: click-to-load embeds ================= */

  /* fixed whitelist — only these hosts are ever swapped (no user input here) */
  var EMBED_SITES = [
    { host: 'youtube.com',         path: /^\/embed\//,  name: 'YouTube' },
    { host: 'youtube-nocookie.com', path: /^\/embed\//, name: 'YouTube' },
    { host: 'player.vimeo.com',    path: null,          name: 'Vimeo' },
    { host: 'google.com',          path: /^\/maps\/embed/, name: 'خرائط Google' },
    { host: 'platform.twitter.com', path: null,         name: 'X (تويتر)' },
    { host: 'facebook.com',        path: /^\/plugins\//, name: 'Facebook' },
    { host: 'instagram.com',       path: /\/embed/,     name: 'Instagram' },
    { host: 'tiktok.com',          path: /^\/embed/,    name: 'TikTok' },
    { host: 'open.spotify.com',    path: /^\/embed/,    name: 'Spotify' },
    { host: 'player.twitch.tv',    path: null,          name: 'Twitch' }
  ];

  var embedOn = false, embedObserver = null, placeholders = [];

  function embedSite(frame) {
    var src = frame.getAttribute('src') || '';
    if (!src) return null;
    var u; try { u = new URL(src, location.href); } catch (e) { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    var host = u.hostname.toLowerCase().replace(/^www\./, '');
    for (var i = 0; i < EMBED_SITES.length; i++) {
      var s = EMBED_SITES[i];
      if ((host === s.host || host.slice(-(s.host.length + 1)) === '.' + s.host) &&
          (!s.path || s.path.test(u.pathname))) return s;
    }
    return null;
  }

  function swapFrame(frame, site) {
    if (frame.__syfsSwapped || !frame.parentNode) return;
    frame.__syfsSwapped = true;
    var r = frame.getBoundingClientRect();
    var w = r.width > 40 ? r.width + 'px' : (frame.getAttribute('width') ? frame.getAttribute('width') + 'px' : '100%');
    var ht = r.height > 40 ? r.height + 'px' : (frame.getAttribute('height') ? frame.getAttribute('height') + 'px' : '');
    var ph = document.createElement('div');
    ph.__syfsFrame = frame;
    /* inline styles only — no CSS injected into the host page */
    ph.style.cssText = 'box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;' +
      'width:' + w + ';' + (ht ? 'height:' + ht + ';' : 'aspect-ratio:16/9;') +
      'max-width:100%;background:#1d222b;color:#dfe3ea;border:1px dashed #5b6b78;border-radius:10px;cursor:pointer;' +
      'font:13px/1.6 system-ui,sans-serif;text-align:center;padding:10px;'
      /* the placeholder is planted in the HOST page, outside .syfs-wrap, so the
         direction is written out rather than read from --syfs-dir (which has nothing
         to resolve against there and would pin it to rtl in an English interface) */
      + 'direction:' + ((window.SYFS && SYFS.i18n && SYFS.i18n.dir()) || 'rtl');
    var btn = document.createElement('div');
    btn.style.cssText = 'width:46px;height:46px;border-radius:50%;background:#457364;color:#fff;display:flex;align-items:center;justify-content:center;font-size:17px';
    btn.textContent = '▶';
    var cap = document.createElement('div');
    /* a placeholder, not `'محتوى ' + name + ' — …'`: glued in source order the
       sentence can only be right in one language (src/i18n.js), and the extractor
       cannot see a msgid that does not exist as one literal */
    cap.textContent = (window.SYFS && SYFS.t)
      ? SYFS.t('محتوى {0} — انقر للتحميل', site.name)
      : 'محتوى ' + site.name + ' — انقر للتحميل';   /* textContent — no HTML injection */
    ph.appendChild(btn); ph.appendChild(cap);
    ph.addEventListener('click', function () {
      /* ⛔ لا تُصفَّر __syfsSwapped هنا: المراقب ما زال موصولاً وسيرى إعادة الإدراج
         ويستدعي scanFrames عليها فوراً — والحارس هو ما يمنع المراقب من ابتلاع الإطار
         الذي أعاده المستخدم بنقرته (نائبٌ جديد يحلّ محلّه قبل أن يُرسم، فتبدو النقرة
         بلا أثر إلى الأبد). يُمسح في setEmbed(false) وحدها، وهي تفصل المراقب أوّلاً. */
      if (ph.parentNode) ph.parentNode.replaceChild(frame, ph);
      var i = placeholders.indexOf(ph); if (i >= 0) placeholders.splice(i, 1);
    }, { once: true });
    frame.parentNode.replaceChild(ph, frame);
    placeholders.push(ph);
  }

  function scanFrames(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.tagName === 'IFRAME') { var s0 = embedSite(root); if (s0) swapFrame(root, s0); return; }
    var frames = root.querySelectorAll('iframe[src]');
    for (var i = 0; i < frames.length; i++) {
      var s = embedSite(frames[i]);
      if (s) swapFrame(frames[i], s);
    }
  }

  function setEmbed(on) {
    on = !!on;
    if (on === embedOn) return;
    embedOn = on;
    if (on) {
      scanFrames(document.documentElement);
      embedObserver = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            if (added[j].nodeType === 1) scanFrames(added[j]);
          }
        }
      });
      embedObserver.observe(document.documentElement, { childList: true, subtree: true });
    } else {
      if (embedObserver) { embedObserver.disconnect(); embedObserver = null; }
      placeholders.slice().forEach(function (ph) {
        var f = ph.__syfsFrame;
        if (f) f.__syfsSwapped = false;
        if (ph.parentNode && f) ph.parentNode.replaceChild(f, ph);
      });
      placeholders = [];
    }
  }

  /* ================= engine: motion freezer ================= */

  /* static CSS string — never built from user input. Does not pierce our
   * shadow root (document-level styles don't apply inside shadow DOM).
   * v0.139.3: animations are FINISHED, not paused — `paused` froze a fade-in at its
   * first frame (opacity 0), so the content it revealed never appeared. A 0s run
   * lands on the end state (the site's own fill-mode decides what stays) and still
   * fires animationend, which some pages wait on before showing content. */
  var FREEZE_CSS = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;' +
    'transition-duration:0s!important;transition-delay:0s!important}';
  var animStyle = null;

  function setAnim(on) {
    if (on) {
      if (!animStyle) { animStyle = document.createElement('style'); animStyle.textContent = FREEZE_CSS; }
      if (!animStyle.parentNode) (document.head || document.documentElement).appendChild(animStyle);
    } else if (animStyle && animStyle.parentNode) {
      animStyle.parentNode.removeChild(animStyle);
    }
  }

  var autoplayOn = false, userActed = false;
  /* only a REAL gesture opens the gate: a page script can dispatch a synthetic
     pointerdown/keydown to unlock its own autoplay (isTrusted is false for those) */
  addEventListener('pointerdown', function (e) { if (e.isTrusted) userActed = true; }, true);
  addEventListener('keydown', function (e) { if (e.isTrusted) userActed = true; }, true);
  /* capture-phase: 'play' doesn't bubble, but capture at document sees it.
   * Only blocks playback started BEFORE any user interaction (= autoplay);
   * manual play always works (a click sets userActed first). */
  document.addEventListener('play', function (e) {
    if (!autoplayOn || userActed) return;
    var el = e.target;
    if (el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO')) { try { el.pause(); } catch (err) {} }
  }, true);

  /* ما نزعنا منه `autoplay` وحده يُعاد — نفس انضباط video.loop ومرشّحات CSS: لا نكتب
     خاصية لم نكن نحن من غيّرها، وإلّا شغّلنا تلقائياً ما لم يطلبه الموقع أصلاً. */
  var autoplayStripped = new WeakSet();

  function setAutoplay(on) {
    autoplayOn = !!on;
    var els = document.querySelectorAll('video,audio'), i, el;
    if (autoplayOn) {
      for (i = 0; i < els.length; i++) {
        el = els[i];
        try {
          if (el.autoplay) { el.autoplay = false; autoplayStripped.add(el); }
          if (!userActed && !el.paused) el.pause();
        } catch (e) {}
      }
      return;
    }
    /* الإطفاء كان يرفع البوّابة ولا يعيد السمة المنزوعة، فتبقى الصفحة بلا تشغيل تلقائي
       حتى تُحدَّث — وإعدادٌ لا يرجع بإطفائه يُقرأ عطلاً لا اختياراً. */
    for (i = 0; i < els.length; i++) {
      el = els[i];
      if (!autoplayStripped.has(el)) continue;
      try { el.autoplay = true; } catch (e) {}
      autoplayStripped.delete(el);
    }
  }

  var gifOn = false;

  function freezeGif(img) {
    if (img.__syfsGif) return;
    var src = img.currentSrc || img.src || '';
    if (!/\.gif([?#]|$)/i.test(src)) return;
    if (!img.complete || !img.naturalWidth) return;
    try {
      var c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      var frame = c.toDataURL('image/png');      /* throws on tainted (cross-origin) canvas */
      img.__syfsGif = src;
      if (img.srcset) { img.__syfsGifSet = img.srcset; img.srcset = ''; }
      img.src = frame;
    } catch (e) { /* cross-origin GIF — cannot freeze, leave as-is */ }
  }

  function setGif(on) {
    gifOn = !!on;
    var imgs = document.querySelectorAll('img'), i;
    if (gifOn) {
      for (i = 0; i < imgs.length; i++) freezeGif(imgs[i]);
    } else {
      for (i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if (!img.__syfsGif) continue;
        img.src = img.__syfsGif;
        if (img.__syfsGifSet) { img.srcset = img.__syfsGifSet; delete img.__syfsGifSet; }
        delete img.__syfsGif;
      }
    }
  }

  /* freeze GIFs that finish loading after enable ('load' captured at document) */
  document.addEventListener('load', function (e) {
    if (gifOn && e.target && e.target.tagName === 'IMG') freezeGif(e.target);
  }, true);

  /* ================= engine: hover prefetch (instant.page style) ================= */

  /* GET with site cookies → must never hit an action endpoint: same-origin
   * only, no query strings, and an action-word path blacklist. */
  var PF_SKIP_RE = /(logout|signout|sign-out|log-out|logoff|delete|remove|destroy|unsubscribe|cancel|checkout|cart|pay|purchase|order)/i;
  var PF_MAX = 60;

  /* pure — returns the normalized URL to prefetch, or null if ineligible */
  function prefetchUrl(href, baseHref) {
    if (!href) return null;
    var base; try { base = new URL(baseHref); } catch (e) { return null; }
    var u; try { u = new URL(href, baseHref); } catch (e) { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.origin !== base.origin) return null;      /* same-origin only */
    if (u.search) return null;                       /* query → may be an action */
    if (PF_SKIP_RE.test(u.pathname)) return null;
    var full = u.origin + u.pathname;                /* hash dropped */
    if (full === base.origin + base.pathname) return null;  /* same page */
    return full;
  }

  var pfOn = false, pfSeen = {}, pfCount = 0, pfTimer = 0;

  function pfAllowed() {
    var c = navigator.connection;
    if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return false;
    return true;
  }
  function pfInject(url) {
    if (!url || pfSeen[url] || pfCount >= PF_MAX || !pfAllowed()) return;
    pfSeen[url] = 1; pfCount++;
    var l = document.createElement('link');
    l.rel = 'prefetch'; l.href = url;
    (document.head || document.documentElement).appendChild(l);
  }
  function pfFromEvent(e) {
    var t = e.target;
    var a = t && t.closest ? t.closest('a[href]') : null;
    return a ? prefetchUrl(a.getAttribute('href'), location.href) : null;
  }
  function pfOver(e) { var url = pfFromEvent(e); if (!url) return; clearTimeout(pfTimer); pfTimer = setTimeout(function () { pfInject(url); }, 80); }
  function pfOut() { clearTimeout(pfTimer); }
  function pfNow(e) { pfInject(pfFromEvent(e)); }

  function setPrefetch(on) {
    on = !!on;
    if (on === pfOn) return;
    pfOn = on;
    if (on) {
      document.addEventListener('mouseover', pfOver, true);
      document.addEventListener('mouseout', pfOut, true);
      document.addEventListener('mousedown', pfNow, true);
      document.addEventListener('touchstart', pfNow, { capture: true, passive: true });
    } else {
      clearTimeout(pfTimer);
      document.removeEventListener('mouseover', pfOver, true);
      document.removeEventListener('mouseout', pfOut, true);
      document.removeEventListener('mousedown', pfNow, true);
      document.removeEventListener('touchstart', pfNow, { capture: true });
    }
  }

  /* ================= boot + live reaction ================= */

  /* page boosts are for web pages only — on app.html (light DOM, no shadow root)
   * «تجميد الحركة» would freeze the workspace UI itself. */
  if (location.protocol !== 'chrome-extension:') {
    SYFS.store.get('embed_lite', false).then(function (v) { if (v) setEmbed(true); });
    SYFS.store.get('freeze_anim', false).then(function (v) { if (v) setAnim(true); });
    SYFS.store.get('freeze_autoplay', false).then(function (v) { if (v) setAutoplay(true); });
    SYFS.store.get('freeze_gif', false).then(function (v) { if (v) setGif(true); });
    SYFS.store.get('prefetch_on', false).then(function (v) { if (v) setPrefetch(true); });

    try {
      chrome.storage.onChanged.addListener(function (ch, area) {
        if (area !== 'local') return;
        if (ch.embed_lite) setEmbed(!!ch.embed_lite.newValue);
        if (ch.freeze_anim) setAnim(!!ch.freeze_anim.newValue);
        if (ch.freeze_autoplay) setAutoplay(!!ch.freeze_autoplay.newValue);
        if (ch.freeze_gif) setGif(!!ch.freeze_gif.newValue);
        if (ch.prefetch_on) setPrefetch(!!ch.prefetch_on.newValue);
      });
    } catch (e) {}
  }

  /* ================= tools =================
   * ⚡ v0.112.0 — THESE FIVE LEFT 🛡 FOR A CATEGORY OF THEIR OWN.
   *
   * None of them protects anything: they trade fidelity for speed. That is the exact
   * argument that pulled «يوتيوب+» out of 🛡 in v0.72.0 («🛡 أمان، ويوتيوب+ تجربة»), and
   * leaving them there carried the same cost — turning the ad blocker off reads as
   * though it also turns the speed off. 🛡 is down to its three real members.
   *
   * ⛔ THEY ARE NOT MERGED INTO ONE TABBED TOOL, and the reason is worth keeping: the
   * audit proposed both the split and the merge, and doing both puts ONE tool on a
   * shelf of its own — a category button whose only job is to reveal a single icon,
   * which is a click that buys nothing. The merge would also retire five ids, and an
   * id that disappears takes its owner's keyboard shortcut with it. The split alone
   * gets the whole benefit (🛡 goes 8 → 3, and the names finally say what they are) at
   * zero cost to anyone. Merge only when the members are crowding a shelf that has
   * other things on it — here they ARE the shelf. */

  SYFS.tools = SYFS.tools || [];

  SYFS.cats = SYFS.cats || {};
  SYFS.cats.perf = { label: 'الأداء', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20a8 8 0 1 1 8-8"/><path d="M12 12l4.5-3.5"/><path d="M12 12h.01"/></svg>' };

  /* ---- speedlite — Lite Mode (DNR, via background) ---- */
  SYFS.tools.push({
    id: 'speedlite',
    name: 'الوضع الخفيف (تسريع)',
    cat: 'perf',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3L4 14h6l-1 7 9-11h-6z"/></svg>',
    mount: function (body) {
      var host = /^https?:$/.test(location.protocol) ? (location.hostname || '').toLowerCase().replace(/^www\./, '') : '';
      var root = h(
        '<div class="syf-form">' +
          '<label>حجب موارد ثقيلة — تصفّح أسرع على نت بطيء</label>' +
          '<label class="syf-ck"><input type="checkbox" id="lt-img"> <span>منع تحميل الصور</span></label>' +
          '<label class="syf-ck"><input type="checkbox" id="lt-font"> <span>منع الخطوط الخارجية</span></label>' +
          '<label class="syf-ck"><input type="checkbox" id="lt-media"> <span>منع الفيديو والصوت</span></label>' +
          '<label>الموقع الحالي</label>' +
          '<button class="syf-btn" id="lt-site" style="display:none"></button>' +
          '<div class="syf-empty" id="lt-nohost" style="display:none">لا يمكن الاستثناء في هذه الصفحة.</div>' +
          '<label>مواقع مستثناة (الوضع الخفيف معطّل فيها)</label>' +
          '<div class="syf-note-list" id="lt-list"></div>' +
          '<div class="syf-note-hint">أعد تحميل الصفحة بعد أي تغيير ليسري المفعول. الحجب مستقل عن استثناءات مانع الإعلانات.</div>' +
        '</div>'
      );
      body.appendChild(root);

      var cks = { img: root.querySelector('#lt-img'), font: root.querySelector('#lt-font'), media: root.querySelector('#lt-media') };
      var siteBtn = root.querySelector('#lt-site'), noHost = root.querySelector('#lt-nohost');
      var list = root.querySelector('#lt-list');
      var allowed = [];

      function renderSiteBtn() {
        if (!host) { noHost.style.display = ''; siteBtn.style.display = 'none'; return; }
        siteBtn.style.display = '';
        var on = allowed.indexOf(host) >= 0;
        siteBtn.textContent = on ? SYFS.t('▶ إعادة تفعيل الوضع الخفيف في: {0}', host) : SYFS.t('⏸ استثناء هذا الموقع: {0}', host);
      }
      function renderList() {
        list.innerHTML = '';
        if (!allowed.length) { list.appendChild(h('<div class="syf-empty">لا مواقع مستثناة.</div>')); return; }
        allowed.forEach(function (d) {
          var row = h('<div class="syf-note-row"><span class="t"></span><button class="x" title="إزالة الاستثناء">✕</button></div>');
          row.querySelector('.t').textContent = d;               /* textContent — no HTML injection */
          row.querySelector('.x').addEventListener('click', function () {
            dnr('lite-allow', { domain: d, on: false }).then(function (r) {
              if (!(r && r.ok)) fail(r);
              return refresh();
            });
          });
          list.appendChild(row);
        });
      }
      var fail = failNote(root);
      /* Unread state is not "off". Left enabled, the three boxes sit at their DOM
         default — unchecked — which is a CLAIM about the rules, not the absence of
         one: the panel would report Lite Mode off while its rules are live. */
      function setLive(on) {
        Object.keys(cks).forEach(function (k) { cks[k].disabled = !on; });
        siteBtn.disabled = !on;
      }
      function refresh() {
        return dnr('lite-status').then(function (s) {
          if (!s.ok) {
            setLive(false);
            list.textContent = '';
            list.appendChild(dnrFail(s, refresh));
            return;
          }
          setLive(true); fail.clear();
          cks.img.checked = !!s.img; cks.font.checked = !!s.font; cks.media.checked = !!s.media;
          allowed = Array.isArray(s.allowed) ? s.allowed : [];
          renderSiteBtn(); renderList();
        });
      }

      Object.keys(cks).forEach(function (kind) {
        cks[kind].addEventListener('change', function () {
          /* the write is reported on its own; refresh() then snaps the box back to
             whatever the worker actually holds — the panel never guesses */
          dnr('lite-toggle', { kind: kind, on: cks[kind].checked }).then(function (r) {
            if (!(r && r.ok)) fail(r);
            return refresh();
          });
        });
      });
      siteBtn.addEventListener('click', function () {
        if (!host) return;
        dnr('lite-allow', { domain: host, on: allowed.indexOf(host) < 0 }).then(function (r) {
          if (!(r && r.ok)) fail(r);
          return refresh();
        });
      });

      refresh();
    }
  });

  /* ---- speedembed — click-to-load embeds ---- */
  SYFS.tools.push({
    id: 'speedembed',
    name: 'تحميل بالنقر (embeds)',
    cat: 'perf',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 9l5 3-5 3z"/></svg>',
    mount: function (body) {
      var root = h(
        '<div class="syf-form">' +
          '<label class="syf-ck"><input type="checkbox" id="em-on"> <span>استبدال المحتوى المضمّن ببطاقة — يُحمَّل عند النقر</span></label>' +
          '<div class="syf-out" style="grid-template-columns:1fr"><div><span>يشمل</span><b>YouTube · Vimeo · خرائط Google · X · Facebook · Instagram · TikTok · Spotify · Twitch</b></div></div>' +
          '<div class="syf-note-hint">يوفّر بيانات وذاكرة ومعالجاً — الصفحات التي تحوي مقاطع مضمّنة تفتح أخف بكثير. يسري فوراً هنا وعلى كل الصفحات الجديدة.</div>' +
        '</div>'
      );
      body.appendChild(root);
      var ck = root.querySelector('#em-on');
      SYFS.store.get('embed_lite', false).then(function (v) { ck.checked = !!v; });
      ck.addEventListener('change', function () { SYFS.store.set('embed_lite', ck.checked); });
    }
  });

  /* ---- speedfreeze — motion freezer ---- */
  SYFS.tools.push({
    id: 'speedfreeze',
    name: 'مجمّد الحركة',
    cat: 'perf',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M4 6l16 12M20 6 4 18"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2M4.5 9.5l.5 3.4-3 1.6M19.5 14.5l-.5-3.4 3-1.6"/></svg>',
    mount: function (body) {
      var root = h(
        '<div class="syf-form">' +
          '<label>إيقاف الحراك المستمر — أقل استهلاكاً للمعالج والبطارية</label>' +
          '<label class="syf-ck"><input type="checkbox" id="fz-anim"> <span>تجميد حركات CSS (animations/transitions)</span></label>' +
          '<label class="syf-ck"><input type="checkbox" id="fz-auto"> <span>إيقاف التشغيل التلقائي للفيديو والصوت</span></label>' +
          '<label class="syf-ck"><input type="checkbox" id="fz-gif"> <span>تجميد صور GIF المتحركة</span></label>' +
          '<div class="syf-note-hint">يسري فوراً على هذه الصفحة وعلى كل الصفحات الجديدة. التشغيل اليدوي للفيديو يعمل دائماً. بعض صور GIF من نطاقات أخرى لا يمكن تجميدها.</div>' +
        '</div>'
      );
      body.appendChild(root);
      var pairs = [['fz-anim', 'freeze_anim'], ['fz-auto', 'freeze_autoplay'], ['fz-gif', 'freeze_gif']];
      pairs.forEach(function (p) {
        var ck = root.querySelector('#' + p[0]);
        SYFS.store.get(p[1], false).then(function (v) { ck.checked = !!v; });
        ck.addEventListener('change', function () { SYFS.store.set(p[1], ck.checked); });
      });
    }
  });

  /* ---- speedfetch — hover prefetch ---- */
  SYFS.tools.push({
    id: 'speedfetch',
    name: 'التحميل المسبق للروابط',
    cat: 'perf',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v9"/><path d="m8.5 9.5 3.5 3 3.5-3"/><path d="M4 15h4l1.5 3h5L16 15h4"/></svg>',
    mount: function (body) {
      var root = h(
        '<div class="syf-form">' +
          '<label class="syf-ck"><input type="checkbox" id="pf-on"> <span>تجهيز الرابط مسبقاً عند مرور الماوس — الفتح شبه فوري</span></label>' +
          '<div class="syf-out" style="grid-template-columns:1fr"><div><span>جُهّز في هذه الصفحة</span><b id="pf-cnt">0</b></div></div>' +
          '<div class="syf-note-hint">روابط نفس الموقع فقط، وتُتجاهل روابط الإجراءات (خروج/حذف/سلة…) والروابط ذات المعاملات (?). يتعطّل تلقائياً مع وضع توفير البيانات أو شبكة بطيئة جداً. حد 60 رابطاً لكل صفحة.</div>' +
        '</div>'
      );
      body.appendChild(root);
      var ck = root.querySelector('#pf-on'), cnt = root.querySelector('#pf-cnt');
      SYFS.store.get('prefetch_on', false).then(function (v) { ck.checked = !!v; });
      ck.addEventListener('change', function () { SYFS.store.set('prefetch_on', ck.checked); });
      cnt.textContent = String(pfCount);
      var iv = setInterval(function () {
        if (!body.isConnected) { clearInterval(iv); return; }
        cnt.textContent = String(pfCount);
      }, 800);
    }
  });

  /* ---- speedtabs — tab memory saver ----
   * ⚠️ This is the SYFS_DNR transport's model (§6.95), applied to SYFS_TABS. It is a
   * sibling and not a parameterisation on purpose: the block above must stay
   * byte-identical to its twin in src/shield.js, so it cannot grow a `type` argument
   * without editing a sealed block in two files to serve a third caller.
   *
   * What it fixes, which the one-line version had exactly: a single 'no-response'
   * for every cause (three cures, one message), no timeout (a callback that is never
   * invoked left the panel frozen with no error to show), and no retry for the one
   * cause a retry cures. */
  var TABS_WAIT = 4000;
  function tabsOnce(op, extra) {
    return new Promise(function (resolve) {
      var done = false;
      function settle(v) { if (done) return; done = true; resolve(v); }
      setTimeout(function () { settle({ ok: false, error: 'asleep' }); }, TABS_WAIT);
      try {
        chrome.runtime.sendMessage(Object.assign({ type: 'SYFS_TABS', op: op }, extra || {}), function (res) {
          var le = chrome.runtime.lastError;
          if (le) { settle({ ok: false, error: /invalidated|Receiving end/i.test(le.message || '') ? 'dead' : 'asleep' }); return; }
          settle(res || { ok: false, error: 'asleep' });
        });
      } catch (e) { settle({ ok: false, error: 'dead' }); }
    });
  }
  /* One silent retry, for 'asleep' only — and only for the ops that write an ABSOLUTE
     value (§6.95/3). `status` reads and `set` assigns the whole settings object, so a
     duplicate landing late changes nothing.
     ⛔ 'discard-now' is deliberately EXCLUDED. Discarding is idempotent in effect, but
     it is an action the user asked for by pressing a button that is still under their
     finger — a silent second attempt would report a different count for the same
     press, and "retry" is a decision that belongs to them here, not to us. */
  var TABS_ABSOLUTE = { status: 1, set: 1 };
  function tabsMsg(op, extra) {
    return tabsOnce(op, extra).then(function (r) {
      if (r && (r.ok || r.error !== 'asleep')) return r;
      return TABS_ABSOLUTE[op] ? tabsOnce(op, extra) : r;
    });
  }
  /* three causes, three cures — the same three the shield panel names. ⛔ The text of
     chrome.runtime.lastError is never one of them: it is Chrome's English and may
     carry internals (§6.95/2). */
  var TABS_MSG = {
    dead: 'أُعيد تحميل الإضافة — حدّث هذه الصفحة (F5) ليعود الاتصال.',
    asleep: 'خدمة التبويبات لا تستجيب. جرّب مرّة أخرى.',
    internal: 'خطأ داخلي في خدمة التبويبات — لم يُطبَّق التغيير.'
  };

  SYFS.tools.push({
    id: 'speedtabs',
    name: 'موفّر ذاكرة التبويبات',
    cat: 'perf',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V6a2 2 0 0 1 2-2h5l2 2h4"/><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8v12"/></svg>',
    mount: function (body) {
      var root = h(
        '<div class="syf-form">' +
          '<label class="syf-ck"><input type="checkbox" id="ts-on"> <span>تجميد التبويبات الخاملة تلقائياً</span></label>' +
          '<label>بعد خمول</label>' +
          '<select class="syf-in" id="ts-min">' +
            '<option value="5">5 دقائق</option><option value="15">15 دقيقة</option>' +
            '<option value="30" selected>30 دقيقة</option><option value="60">ساعة</option>' +
            '<option value="120">ساعتان</option>' +
          '</select>' +
          '<label class="syf-ck"><input type="checkbox" id="ts-pin" checked> <span>لا تجمّد التبويبات المثبّتة</span></label>' +
          '<label class="syf-ck"><input type="checkbox" id="ts-audio" checked> <span>لا تجمّد ما يشغّل صوتاً</span></label>' +
          '<button class="syf-btn" id="ts-now">🧊 جمّد التبويبات الخاملة الآن</button>' +
          '<div class="syf-out" id="ts-stats">' +
            '<div><span>مفتوحة</span><b id="ts-total">—</b></div>' +
            '<div><span>مجمّدة</span><b id="ts-disc">—</b></div>' +
            '<div><span>مؤهّلة للتجميد</span><b id="ts-elig">—</b></div>' +
          '</div>' +
          '<div class="syf-empty syf-dnr-fail" id="ts-fail" style="display:none"></div>' +
          '<div class="syf-note-hint">التبويب المجمّد يبقى في الشريط ويُعاد تحميله عند النقر عليه — يحرّر الذاكرة فوراً. ⚠️ نص لم يُحفظ في نموذج داخل تبويب مجمّد قد يضيع. التبويب النشط لا يُجمَّد أبداً.</div>' +
        '</div>'
      );
      body.appendChild(root);

      var on = root.querySelector('#ts-on'), min = root.querySelector('#ts-min');
      var pin = root.querySelector('#ts-pin'), audio = root.querySelector('#ts-audio');
      var nowBtn = root.querySelector('#ts-now');
      var fail = root.querySelector('#ts-fail');
      var elTotal = root.querySelector('#ts-total'), elDisc = root.querySelector('#ts-disc'), elElig = root.querySelector('#ts-elig');

      /* ⛔ §6.95/5 — a panel must never display state it has not read. An unchecked
         box left on its default is a CLAIM that the feature is off, not an absence of
         a claim, so the controls are disabled until the truth arrives. The counters
         say «؟» for the same reason; the controls could not, because a checkbox has
         no «؟» to show — only a disabled one. */
      var ctrls = [on, min, pin, audio, nowBtn];
      function setKnown(known) {
        ctrls.forEach(function (el) { el.disabled = !known; });
        root.classList.toggle('syf-unknown', !known);
      }
      setKnown(false);
      function refresh() {
        return tabsMsg('status').then(function (s) {
          if (!s || !s.ok) {
            /* ⚠️ NOT a msgid: a single Arabic character is below the extractor's
               two-letter floor, so `t('؟')` would never be extracted, never reported,
               and would ship an Arabic question mark into an English panel with every
               check green (§6.99/8). One character, decided where the language is. */
            var unknownMark = (SYFS.i18n.get() === 'en') ? '?' : '؟';
            elTotal.textContent = elDisc.textContent = elElig.textContent = unknownMark;
            setKnown(false);
            fail.textContent = SYFS.t(TABS_MSG[(s && TABS_MSG[s.error]) ? s.error : 'internal']);
            fail.style.display = '';
            return;
          }
          fail.style.display = 'none';
          on.checked = !!s.on; min.value = String(s.min);
          pin.checked = !!s.pin; audio.checked = !!s.audio;
          elTotal.textContent = String(s.total);
          elDisc.textContent = String(s.discarded);
          elElig.textContent = String(s.eligible);
          setKnown(true);
        });
      }
      /* a toggle that failed REVERTS and says so — silence reads as a UI glitch, and
         a control left in the position the user just put it is a lie about the state */
      function save() {
        return tabsMsg('set', { on: on.checked, min: Number(min.value), pin: pin.checked, audio: audio.checked })
          .then(refresh);
      }

      [on, min, pin, audio].forEach(function (el) { el.addEventListener('change', save); });
      nowBtn.addEventListener('click', function () {
        nowBtn.disabled = true;
        tabsMsg('discard-now').then(function (r) {
          nowBtn.disabled = false;
          /* one msgid with a placeholder, not three glued pieces — the count sits in a
             different place in each language */
          nowBtn.textContent = (r && r.ok)
            ? SYFS.t('🧊 جُمّد {0} تبويباً — جمّد مجدداً', r.count)
            : SYFS.t('🧊 تعذّر — أعد المحاولة');
          refresh();
        });
      });

      refresh();
      var iv = setInterval(function () {
        if (!body.isConnected) { clearInterval(iv); return; }
        refresh();
      }, 4000);
    }
  });

}());
