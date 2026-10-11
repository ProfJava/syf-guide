/* SYF — dock appearance engine (shared by the page rail + the app-mode dock).
 *
 * One small, dependency-free module that both surfaces use so the floating menu
 * and the workspace dock look and behave identically:
 *   - hover effects (a macOS-style magnifier + several CSS effects to pick from)
 *   - icon size (four presets)
 *   - opacity
 *   - edge-peek (icons tuck to the edge and expand on approach — saves screen space)
 *
 * All four preferences live in chrome.storage.local under one set of keys, so a
 * change made in the rail's settings instantly applies to the app dock and vice
 * versa. Nothing here reads page content or talks to the network — it only reads
 * its own settings and sets CSS variables / per-item transforms. */
(function () {
  'use strict';
  var SYFS = window.SYFS || (window.SYFS = {});
  if (SYFS.dockfx) return;                       // shared singleton across bootstrap files
  var FX = SYFS.dockfx = {};

  /* [value, arabic label] — the menus in the rail manager + the app settings build
   * their chips straight from these, so adding an effect/size is a one-line change. */
  FX.EFFECTS = [
    ['magnify', 'تكبير Mac'], ['scale', 'تكبير'], ['lift', 'ارتفاع'],
    ['glow', 'توهّج'], ['jelly', 'ارتداد'], ['none', 'بدون']
  ];
  /* ⛔ v0.107.0 — the four size PRESETS (صغير/متوسط/كبير/ضخم) are GONE, and must not
   * come back as presets. They could not be ordered on screen, which made them worse
   * than useless: the rail shrinks itself to fit the viewport (rail.js `fitRail`), so
   * a preset large enough to overflow rendered at «the largest size that fits» — the
   * SAME pixel size for كبير and ضخم — while a preset small enough to fit rendered at
   * its own full size. On a laptop with every category shown that put «صغير» (38px,
   * fits) ABOVE «متوسط» (46px, clamped and then rested at 85% of the fit). Four steps
   * that are not monotonic are not a control; the user could only see that something
   * was wrong, never what. One continuous number replaces them. */
  FX.SCALE = { min: 100, max: 220, step: 5 };     /* percent; 100% = the smallest icon */
  /* stored preset → percent, so an upgrading user keeps roughly the size they had.
   * Read-only migration: nothing writes `dock_size` any more. */
  FX.LEGACY_SIZE = { sm: 100, md: 120, lg: 145, xl: 175 };
  /* how a category's tools are laid out once it opens:
   *   icons — the compact strip of round icons (name appears in a hover tooltip)
   *   list  — a column of rows, each row an icon with its name beside it */
  FX.LABELS = [['icons', 'أيقونات فقط'], ['list', 'أيقونة + اسم']];
  /* ⚠️ v0.105.0 — two defaults changed, and both are answers to what a FIRST run
   * looks like rather than to what looks best in a screenshot:
   *   effect: 'lift' — the magnifier moves its neighbours, which is the one hover
   *     effect that can make you miss what you aimed at. It is still one click away
   *     for anyone who wants it; it is no longer what an installer meets first.
   *   labels: 'list' — «أيقونات فقط» hides every tool's NAME behind a hover, on a
   *     bar whose whole difficulty is remembering which category holds what.
   * A stored value always wins over both — this only decides a fresh install. */
  FX.DEFAULTS = { effect: 'lift', scale: 120, opacity: 1, peek: false, labels: 'list' };

  function clampOpacity(v) { v = Number(v); return (v >= 0.3 && v <= 1) ? v : 1; }
  function oneOf(v, list, def) { for (var i = 0; i < list.length; i++) if (list[i][0] === v) return v; return def; }
  /* reject, don't repair (§4.1): a value outside the range is not clamped into it — a
   * hand-edited 4000 becomes the default, not a 220px icon. `null` means "not mine". */
  function okScale(v) {
    v = Number(v);
    return (isFinite(v) && v >= FX.SCALE.min && v <= FX.SCALE.max) ? Math.round(v) : null;
  }
  /* hasOwnProperty, not `LEGACY_SIZE[v]`: the stored string is user-writable and
   * `dock_size: "constructor"` would otherwise hand back a function */
  function legacyScale(v) {
    return Object.prototype.hasOwnProperty.call(FX.LEGACY_SIZE, v) ? FX.LEGACY_SIZE[v] : null;
  }

  /* read the four prefs (with validation) and hand them to cb */
  FX.load = function (cb) {
    try {
      chrome.storage.local.get(
        { dock_effect: FX.DEFAULTS.effect, dock_scale: 0, dock_size: '', dock_opacity: FX.DEFAULTS.opacity, dock_peek: FX.DEFAULTS.peek, dock_labels: FX.DEFAULTS.labels },
        function (r) {
          if (chrome.runtime && chrome.runtime.lastError) { cb(Object.assign({}, FX.DEFAULTS)); return; }
          cb({
            effect: oneOf(r.dock_effect, FX.EFFECTS, FX.DEFAULTS.effect),
            /* the new key wins; the old preset is only consulted when there is no new
               key at all, so a migrated user is migrated exactly once */
            scale: okScale(r.dock_scale) || legacyScale(r.dock_size) || FX.DEFAULTS.scale,
            opacity: clampOpacity(r.dock_opacity),
            peek: !!r.dock_peek,
            labels: oneOf(r.dock_labels, FX.LABELS, FX.DEFAULTS.labels)
          });
        }
      );
    } catch (e) { cb(Object.assign({}, FX.DEFAULTS)); }
  };
  FX.save = function (patch) { try { chrome.storage.local.set(patch); } catch (e) {} };
  /* live-sync: fire cb(prefs) whenever any of the four keys changes (from either surface) */
  FX.onChange = function (cb) {
    try {
      chrome.storage.onChanged.addListener(function (ch, area) {
        if (area !== 'local') return;
        if (ch.dock_effect || ch.dock_scale || ch.dock_size || ch.dock_opacity || ch.dock_peek || ch.dock_labels) FX.load(cb);
      });
    } catch (e) {}
  };

  /* ---- macOS-style magnifier ------------------------------------------------
   * Scales each item by its distance from the pointer along one axis, and (when
   * spreading is on) pushes neighbours apart so magnified icons never overlap —
   * exactly what the real Dock does. Two details make it feel right, unlike a
   * naive version:
   *   1. Rest geometry is cached (transforms switched off for the read) and all math
   *      runs off that cache — measuring the *transformed* rect each frame feeds the
   *      scale back into itself and makes it jitter. The cache is re-taken whenever
   *      the strip's own box changes, so it can't go stale behind a layout change.
   *      Hidden items (0x0) are excluded: they aren't part of the strip's geometry.
   *   2. While the pointer is over the strip a `mag-live` class kills the CSS
   *      transform-transition, so scale tracks the cursor 1:1 (crisp, not floaty);
   *      on leave the class is removed first, so icons ease back to rest.
   * The caller supplies:
   *   opts.items()   -> live NodeList/array of the elements to scale
   *   opts.axis()    -> 'x' or 'y' (the strip's main axis)
   *   opts.enabled() -> whether the magnify effect is currently selected
   *   opts.max       -> peak scale at the cursor (default 1.6)
   *   opts.influence -> px radius of the effect (default 130)
   *   opts.spread    -> push neighbours apart to avoid overlap (default true)
   * Each item gets `--mag` (scale) and `--shift` (px translate along the axis);
   * the surface CSS applies transform: translate(var(--shift)) scale(var(--mag)). */
  var EDGE = 4;                                    /* px kept between a magnified block and the screen edge */
  FX.attachMagnify = function (container, opts) {
    var raf = 0, px = 0, py = 0, inside = false, rest = null, live = false;
    var max = opts.max || 1.6, inf = opts.influence || 130;
    var spread = opts.spread !== false;
    var liveClass = opts.liveClass || 'mag-live';

    /* The strip's own layout box. Child transforms never change it (transform doesn't
     * reflow), so this is a cheap probe for "did the geometry really change?" — peek
     * toggled, size preset changed, strip repositioned, a category shown/hidden. When
     * it moves, the cached rest geometry is stale and must be taken again. */
    function geomSig() {
      var r = container.getBoundingClientRect();
      return Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + ',' + Math.round(r.height);
    }

    /* Snapshot untransformed centres + sizes.
     *   - Transforms are switched off inline for the read, so a live magnification (or
     *     a rect caught mid-transition) can never feed back into its own geometry.
     *   - Items that aren't rendered (display:none -> 0x0 rect) are SKIPPED. Keeping
     *     them would poison `gap` — with the peek eye visible and everything else
     *     hidden, gap became -(eye centre) and `--shift` blew up to ~2000px, throwing
     *     the one button the user still needs clean off the screen. */
    function measure() {
      var items = opts.items(), i, r;
      if (!items || !items.length) { rest = null; return; }
      for (i = 0; i < items.length; i++) {
        items[i].style.setProperty('transition', 'none', 'important');
        items[i].style.setProperty('transform', 'none', 'important');
      }
      var horiz = opts.axis() === 'x', arr = [];
      for (i = 0; i < items.length; i++) {
        r = items[i].getBoundingClientRect();
        if (!r.width || !r.height) continue;                                 // display:none — not part of the strip
        if (getComputedStyle(items[i]).visibility === 'hidden') continue;    // keeps its slot, but must not be magnified/spread
        arr.push({ el: items[i], c: horiz ? r.left + r.width / 2 : r.top + r.height / 2, size: horiz ? r.width : r.height });
      }
      for (i = 0; i < items.length; i++) {
        items[i].style.removeProperty('transform');
        items[i].style.removeProperty('transition');
      }
      /* SPATIAL order, not DOM order. The spread below lays the strip out by
       * walking arr and treating each entry as the next one along the axis, and
       * the gap is read off the first pair — both are lies the moment CSS
       * `order` moves a button (the rail does exactly that on top/bottom, where
       * the two ends trade places). Sorting by measured centre is a no-op when
       * the two agree, which is every other case. */
      arr.sort(function (a, b) { return a.c - b.c; });
      var gap = arr.length > 1 ? (arr[1].c - arr[0].c) - arr[1].size : 0;   // resting visual gap
      rest = { horiz: horiz, gap: gap, items: arr, count: items.length, sig: geomSig() };
    }
    function clearVars() {
      var items = opts.items(); if (!items) return;
      for (var i = 0; i < items.length; i++) { items[i].style.setProperty('--mag', '1'); items[i].style.setProperty('--shift', '0px'); }
    }
    function stop() { if (live) { live = false; container.classList.remove(liveClass); clearVars(); } }

    function frame() {
      raf = 0;
      if (!opts.enabled() || !inside) { stop(); return; }
      /* re-measure whenever the cache can't be trusted: never taken, an item was
       * added/removed, or the strip's own box moved/resized (peek toggle, size preset,
       * reposition, a hidden category coming back) */
      if (!rest || opts.items().length !== rest.count || geomSig() !== rest.sig) { clearVars(); measure(); }
      if (!rest || !rest.items.length) return;
      if (!live) { live = true; container.classList.add(liveClass); }

      var arr = rest.items, n = arr.length, ptr = rest.horiz ? px : py, i, d, t;
      var scales = new Array(n);
      for (i = 0; i < n; i++) {
        d = Math.abs(ptr - arr[i].c);
        if (d < inf) { t = d / inf; scales[i] = 1 + (max - 1) * (0.5 + 0.5 * Math.cos(Math.PI * t)); }   // raised-cosine falloff
        else scales[i] = 1;
      }
      if (spread && n > 1) {
        /* lay items out at their scaled sizes, keeping the resting gap */
        var centres = new Array(n); centres[0] = 0;
        for (i = 1; i < n; i++) centres[i] = centres[i - 1] + arr[i - 1].size * scales[i - 1] / 2 + rest.gap + arr[i].size * scales[i] / 2;
        /* ⚠️ THE BLOCK IS ANCHORED AT THE POINTER, never re-centred on its own midpoint.
           Re-centring split the growth evenly between the two ends, so the items near
           an end moved OUTWARD by about half of it — and they did so the instant the
           pointer touched the strip, from 130px away. What you were reaching for slid
           away as you approached. Measured (tools/magnify-test.js, a 14-button md rail):
           the last button — the ⚙ gear — sat 33px past its painted position at every
           approach distance, so the pointer landed on empty glass and the settings
           window could not be opened at all while «تكبير الماك» was on.
           Anchoring at the pointer makes the thing under the cursor the one thing that
           CANNOT move, which is also what the real Dock does. Interpolated between the
           two neighbouring items instead of snapped to the nearest, or the whole strip
           would jump each time the cursor crossed the midpoint between two icons. */
        var off;
        if (ptr <= arr[0].c) off = arr[0].c - centres[0];
        else if (ptr >= arr[n - 1].c) off = arr[n - 1].c - centres[n - 1];
        else {
          var k = 0;
          while (k < n - 2 && arr[k + 1].c < ptr) k++;
          var span = arr[k + 1].c - arr[k].c;
          var f = span > 0 ? (ptr - arr[k].c) / span : 0;
          off = ptr - (centres[k] + f * (centres[k + 1] - centres[k]));
        }
        /* …and never past the screen edge. The anchor holds the near end still, but the
           far end still grows, and a rail already shrunk to fit the viewport (rail.js
           fitRail) has no room to give. Clamping can only move items TOWARD the pointer,
           so it cannot re-introduce the chase it is sitting under. */
        var lo = centres[0] + off - arr[0].size * scales[0] / 2;
        var hi = centres[n - 1] + off + arr[n - 1].size * scales[n - 1] / 2;
        var room = rest.horiz ? window.innerWidth : window.innerHeight;
        if (lo < EDGE) off += EDGE - lo;
        else if (hi > room - EDGE) off -= hi - (room - EDGE);
        for (i = 0; i < n; i++) {
          arr[i].el.style.setProperty('--mag', scales[i].toFixed(3));
          arr[i].el.style.setProperty('--shift', ((centres[i] + off) - arr[i].c).toFixed(1) + 'px');
        }
      } else {
        for (i = 0; i < n; i++) { arr[i].el.style.setProperty('--mag', scales[i].toFixed(3)); arr[i].el.style.setProperty('--shift', '0px'); }
      }
    }
    function sched() { if (!raf) raf = requestAnimationFrame(frame); }

    container.addEventListener('pointerenter', function () { if (opts.enabled()) { rest = null; measure(); } });
    container.addEventListener('pointermove', function (e) { inside = true; px = e.clientX; py = e.clientY; if (!rest && opts.enabled()) measure(); sched(); });
    container.addEventListener('pointerleave', function () { inside = false; rest = null; sched(); });
    return { refresh: function () { rest = null; sched(); } };
  };

  /* ---- edge-peek ------------------------------------------------------------
   * Tucks the strip to the edge and expands it when the pointer approaches.
   * JS-driven (not CSS :hover) so it can't flicker: it toggles `peek-open` on a
   * wrapper from the *absolute pointer position* vs a fixed edge line, with
   * hysteresis (once open it stays open while the pointer is anywhere near the
   * expanded rect or a menu is open). The moving element never decides its own
   * hover state, so there is no expand→un-hover→collapse loop.
   *   opts.wrap()    -> element to toggle the open class on
   *   opts.rail()    -> the element that slides (for its live rect)
   *   opts.edge()    -> 'right'|'left'|'top'|'bottom' for a screen-edge strip,
   *                     or falsy for a free-floating dock (proximity to its rect)
   *   opts.enabled() -> peek currently on
   *   opts.busy()    -> keep open (a category/flyout is open)
   *   opts.trigger   -> px band that opens it (default 48)
   *   opts.pad       -> px slack kept around the open rect (default 60) */
  FX.attachPeek = function (opts) {
    var cls = opts.openClass || 'peek-open';
    var TRIG = opts.trigger || 48, PAD = opts.pad || 60;
    function within(r, x, y, m) { return x >= r.left - m && x <= r.right + m && y >= r.top - m && y <= r.bottom + m; }
    function edgeDist(edge, x, y) {
      if (edge === 'right') return window.innerWidth - x;
      if (edge === 'left') return x;
      if (edge === 'top') return y;
      if (edge === 'bottom') return window.innerHeight - y;
      return Infinity;
    }
    function set(open) { var w = opts.wrap(); if (w) w.classList.toggle(cls, open); }
    function onMove(e) {
      var w = opts.wrap(); if (!w) return;
      if (!opts.enabled()) { if (w.classList.contains(cls)) set(false); return; }
      var rail = opts.rail && opts.rail(); if (!rail) return;
      var r = rail.getBoundingClientRect(), x = e.clientX, y = e.clientY;
      if (w.classList.contains(cls)) {                 // already open — decide whether to collapse
        if ((opts.busy && opts.busy()) || within(r, x, y, PAD)) return;
        set(false); return;
      }
      var edge = opts.edge && opts.edge(), hit;         // collapsed — decide whether to open
      if (edge) {
        var cross = (edge === 'right' || edge === 'left') ? (y >= r.top - PAD && y <= r.bottom + PAD) : (x >= r.left - PAD && x <= r.right + PAD);
        hit = cross && edgeDist(edge, x, y) <= TRIG;
      } else hit = within(r, x, y, TRIG);
      if (hit) set(true);
    }
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('mouseleave', function () { if (!(opts.busy && opts.busy())) set(false); });
    return { open: function () { set(true); }, close: function () { set(false); } };
  };
}());
