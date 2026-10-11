/* SYF — window sizing engine (v0.132.0).
 * ONE implementation of «drag the corner to resize», shared by the page rail
 * (src/rail.js) and app mode (src/app.js), for tool windows and frame windows
 * alike. It replaces four near-identical copies of the same fourteen lines —
 * and the same four bugs.
 *
 * ===== what was wrong, precisely =====
 * The old code, in all four copies:
 *     win.style.width  = min(max(260, sw + dx), window.innerWidth  - 16);
 *     body.style.height= min(max(120, sh + dy), window.innerHeight - 70);
 *
 *  1. THE CLAMP IGNORED WHERE THE WINDOW IS. The ceiling is the viewport, but
 *     the window grows from its LEFT/TOP edge, which is wherever it was dragged.
 *     A window parked at x=900 on a 1000px screen could legally be set to
 *     984px wide — 884px of it off-screen, taking the grip with it. Once the
 *     grip is past the edge there is no handle left to pull back with, and the
 *     window cannot be made smaller again by any means the UI offers. That is
 *     the reported «لا يعمل بشكل صحيح»: not a wrong number, an unrecoverable one.
 *  2. `mousemove` ON `document` DIES OVER AN IFRAME. The site-viewer window is
 *     an iframe; so is any page embed the pointer crosses mid-drag. The events
 *     go to the frame's document, not ours, and the resize silently stops
 *     following the pointer while the button is still held.
 *  3. NO TOUCH, NO PEN, NO KEYBOARD. `mousedown` only. On a touchscreen the
 *     grip was decoration, and resizing was unreachable without a mouse at all.
 *  4. A SHRINKING BROWSER WINDOW STRANDED TOOL WINDOWS. Nothing re-clamped on
 *     viewport resize, so half a window could end up outside the screen with,
 *     again, the grip on the wrong side of the edge.
 *
 * ===== the rules this file keeps =====
 *  · The grip is ALWAYS reachable. Every size we write leaves the window's
 *    bottom-right corner inside the viewport. This is the invariant; everything
 *    else is detail.
 *  · Width is written on the FRAME, height on the BODY. That split is not ours
 *    to change here — the body owns `overflow:auto`, so a height on the frame
 *    would scroll the head away with the content. One function writes both.
 *  · Geometry is read with getBoundingClientRect(), never offsetLeft/offsetTop.
 *    These windows are `position:fixed` inside a shadow root; a positioned
 *    ancestor would silently change what offsetLeft means, and the rect is
 *    viewport-relative exactly like the `left`/`top` we write back.
 *  · Nothing here touches chrome.storage. The caller passes `onChange`, because
 *    the rail and app mode persist under different keys.
 *
 * No eval, no network, no page-content access. */
(function () {
  'use strict';
  var SYFS = window.SYFS || (window.SYFS = {});
  if (SYFS.winsize) return;                       /* shared singleton */

  /* how much viewport we refuse to give away on any side. 8px matches the
     margin `.syfs-win.syfs-max` leaves, so a maximised and a hand-resized
     window agree about where the screen ends. */
  var EDGE = 8;
  var HEAD_FALLBACK = 42;                          /* if the head has not laid out yet */
  var KEY_STEP = 16, KEY_STEP_BIG = 48;

  /* ===== the floor is a property of what is INSIDE the window (v0.137.0) =====
   * A body carrying the side tab rail (`.syf-tabs`, v0.119.0) spends ~90px on the
   * rail and 13px on the divider before the panel gets a single pixel. At the
   * normal 260px floor that leaves the tool itself ~130px — every row of it
   * clipped — and the CSS default for these windows has been 440px all along, so
   * the only way to reach that state is to drag the grip there or to carry a size
   * saved before the tool grew a rail. The floor is read at WRITE time, never
   * frozen at attach(): SYFS.tabs() builds the rail during mount(), and a tool
   * that re-mounts itself can gain or lose one after the window exists. */
  var TAB_MINW = 360;
  function railed(body) {
    try { return !!(body && body.querySelector(':scope > .syf-tabs:not(.syf-mg-tabs)')); }
    catch (err) { return false; }                  /* :scope is Chrome ≥ 27; never let a selector decide a size by throwing */
  }
  function floorW(body, base) {
    base = base || 260;
    return railed(body) ? Math.max(base, TAB_MINW) : base;
  }

  var live = [];                                   /* attached windows, pruned lazily */

  function clamp(v, lo, hi) { return hi < lo ? lo : (v < lo ? lo : (v > hi ? hi : v)); }

  /* Everything the window is that is NOT the body: the head, and the frame's own
     1px borders top and bottom. Measured rather than assumed — reading the head's
     height alone left the border out and every «fit to the bottom of the screen»
     overshot by exactly 2px (caught by the harness, test 7). Falls back to a
     head-only estimate while the body has no layout box yet. */
  function chromeH(e) {
    var wh = e.win.offsetHeight, bh = e.body.offsetHeight;
    if (wh && bh && wh > bh) return wh - bh;
    var h = e.win.querySelector('.syfs-win-head');
    return (h && h.offsetHeight) || HEAD_FALLBACK;
  }

  /* The room this window has RIGHT WHERE IT SITS — the whole point of the file.
     Measured from its own top-left corner to the far edge of the viewport. */
  /* the live floor for this window — see TAB_MINW above */
  function minW(e) { return floorW(e.body, e.baseMinW); }

  function room(e) {
    var r = e.win.getBoundingClientRect();
    return {
      x: r.left, y: r.top,
      w: Math.max(0, window.innerWidth - r.left - EDGE),
      h: Math.max(0, window.innerHeight - r.top - chromeH(e) - EDGE)
    };
  }

  /* THE single writer. Every size in this file goes through here, so the
     invariant is enforced in exactly one place. */
  function write(e, w, h) {
    var rm = room(e), mw = minW(e);
    /* A window pushed off the right/bottom edge has no room to be small in:
       rm.w could be below minW. Clamping to `max(min, …)` would then write a
       width that runs off-screen again, so we pull the WINDOW back instead and
       re-measure. Moving it is always recoverable; an unreachable grip is not. */
    if (rm.w < mw || rm.h < e.minH) {
      var nx = Math.max(EDGE, Math.min(rm.x, window.innerWidth - mw - EDGE));
      var ny = Math.max(EDGE, Math.min(rm.y, window.innerHeight - e.minH - chromeH(e) - EDGE));
      e.win.style.left = Math.round(nx) + 'px';
      e.win.style.top = Math.round(ny) + 'px';
      rm = room(e);
    }
    var fw = Math.round(clamp(w, mw, Math.max(mw, rm.w)));
    var fh = Math.round(clamp(h, e.minH, Math.max(e.minH, rm.h)));
    e.win.style.width = fw + 'px';
    e.body.style.maxHeight = 'none';               /* the CSS 70vh ceiling is the default, not a lock */
    e.body.style.height = fh + 'px';
    return { w: fw, h: fh };
  }

  /* current size as the two numbers `write` speaks */
  function sizeOf(e) {
    return { w: Math.round(e.win.getBoundingClientRect().width), h: Math.round(e.body.getBoundingClientRect().height) };
  }

  /* ===== fit to content (double-click the grip) =====
   * Measured, never guessed: the constraints come off, the browser lays the
   * tool out at its natural size, and we read it back. Two passes because the
   * two axes are not independent — the natural HEIGHT of wrapped content is
   * only knowable once the width is fixed. */
  function measure(e) {
    var win = e.win, body = e.body;
    var prev = { w: win.style.width, mw: win.style.maxWidth, h: body.style.height, mh: body.style.maxHeight };
    var rm = room(e), mw = minW(e);
    var out;
    try {
      win.style.width = 'auto';                    /* fixed + auto ⇒ shrink-to-fit */
      win.style.maxWidth = Math.max(mw, rm.w) + 'px';
      body.style.height = 'auto';
      body.style.maxHeight = 'none';
      void win.offsetWidth;                        /* flush: the reads below must see this layout */
      /* scrollWidth, not offsetWidth: shrink-to-fit stops at the available
         width, so a wide table inside would be reported as "fits" when it is
         actually overflowing. scrollWidth includes the body's padding. */
      var chrome = Math.max(0, win.offsetWidth - body.offsetWidth);   /* the frame's own borders */
      var w = Math.max(body.scrollWidth + chrome, win.offsetWidth);
      w = clamp(w, mw, Math.max(mw, rm.w));
      win.style.width = Math.round(w) + 'px';
      win.style.maxWidth = '';
      void win.offsetWidth;
      out = { w: Math.round(w), h: Math.round(body.scrollHeight) };
    } catch (err) {
      out = null;
    }
    /* put everything back; the caller decides what to write */
    win.style.width = prev.w; win.style.maxWidth = prev.mw;
    body.style.height = prev.h; body.style.maxHeight = prev.mh;
    return out;
  }

  /* double-click TOGGLES: fit, then back to the size you had. A shortcut that
     cannot be undone by repeating it is a trap, and «fit» is a guess about
     content the user may simply not like. */
  function fit(e) {
    var before = sizeOf(e);
    if (e.fitted && Math.abs(before.w - e.fitted.w) < 3 && Math.abs(before.h - e.fitted.h) < 3 && e.prior) {
      var back = e.prior;
      e.prior = null; e.fitted = null;
      write(e, back.w, back.h);
      if (e.onChange) e.onChange();
      return 'restored';
    }
    var nat = measure(e);
    if (!nat) return 'failed';
    e.prior = before;
    e.fitted = write(e, nat.w, nat.h);
    if (e.onChange) e.onChange();
    return 'fitted';
  }

  /* ===== the drag =====
   * Pointer events + setPointerCapture. The capture is what makes this survive
   * an iframe under the pointer (bug 2): once captured, every pointermove for
   * that pointer id is delivered to the grip whatever it is flying over, and
   * the browser releases it for us on pointerup, pointercancel, and if the node
   * is removed mid-drag. Touch and pen come along for free. */
  function startDrag(e, ev) {
    if (ev.button !== undefined && ev.button !== 0) return;   /* left / primary only */
    ev.preventDefault(); ev.stopPropagation();
    /* a maximised or minimised window has no free size to drag — and the CSS
       hides the grip in both states, so this is a guard, not a feature */
    e.win.classList.remove('syfs-max', 'syfs-min');
    var s = sizeOf(e), sx = ev.clientX, sy = ev.clientY;
    try { ev.target.setPointerCapture(ev.pointerId); } catch (err) {}
    e.win.classList.add('syfs-sizing');
    function mv(m) { write(e, s.w + (m.clientX - sx), s.h + (m.clientY - sy)); }
    function end() {
      e.grip.removeEventListener('pointermove', mv);
      e.grip.removeEventListener('pointerup', end);
      e.grip.removeEventListener('pointercancel', end);
      e.win.classList.remove('syfs-sizing');
      /* a hand-dragged size is a new baseline: the fit toggle must not send the
         window back to a size the user has since moved away from */
      e.prior = null; e.fitted = null;
      if (e.onChange) e.onChange();
    }
    e.grip.addEventListener('pointermove', mv);
    e.grip.addEventListener('pointerup', end);
    e.grip.addEventListener('pointercancel', end);
  }

  /* ===== keyboard =====
   * The grip is focusable, so resizing exists without a pointing device at all
   * (bug 3). Arrows resize, Shift+arrows resize fast, Enter/Space fits. */
  function onKey(e, ev) {
    var k = ev.key, step = ev.shiftKey ? KEY_STEP_BIG : KEY_STEP, s;
    if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
      if (e.canFit) { ev.preventDefault(); fit(e); }
      return;
    }
    if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ArrowUp' && k !== 'ArrowDown') return;
    ev.preventDefault();
    e.win.classList.remove('syfs-max', 'syfs-min');
    s = sizeOf(e);
    /* the arrow means the DIRECTION THE EDGE MOVES, in physical screen terms —
       the window grows to the right and downward whatever the text direction */
    write(e,
      s.w + (k === 'ArrowRight' ? step : k === 'ArrowLeft' ? -step : 0),
      s.h + (k === 'ArrowDown' ? step : k === 'ArrowUp' ? -step : 0));
    e.prior = null; e.fitted = null;
    if (e.onChange) e.onChange();
  }

  /* ===== public API ===== */
  /* attach(win, opts) — opts:
   *   body     the scrolling element whose height is the window's height
   *   grip     the handle (defaults to the window's own .syfs-win-grip / .syfs-frame-grip)
   *   minW/minH floors, in px
   *   canFit   false for frame windows: an iframe's content is cross-origin, so
   *            there is nothing we are allowed to measure and «fit» would be a lie
   *   onChange called after every committed change (the caller persists) */
  function attach(win, opts) {
    opts = opts || {};
    var grip = opts.grip || win.querySelector('.syfs-win-grip') || win.querySelector('.syfs-frame-grip');
    var body = opts.body || win.querySelector('.syfs-win-body') || win.querySelector('.syfs-frame-body');
    if (!grip || !body) return null;

    var e = {
      win: win, body: body, grip: grip,
      /* the surface's floor; the live one (minW) may be higher — see TAB_MINW */
      baseMinW: opts.minW || 260, minH: opts.minH || 120,
      canFit: opts.canFit !== false,
      onChange: opts.onChange || null,
      prior: null, fitted: null
    };

    grip.setAttribute('tabindex', '0');
    grip.setAttribute('role', 'button');
    /* both strings go through the dictionary: this runs on every page, in both
       languages, and a title is the only instruction this control ever gives. */
    var label = e.canFit
      ? 'تغيير الحجم — نقرة مزدوجة لملاءمة المحتوى'
      : 'تغيير الحجم';
    var t = (SYFS.t ? SYFS.t(label) : label);
    grip.setAttribute('title', t);
    grip.setAttribute('aria-label', t);

    grip.addEventListener('pointerdown', function (ev) { startDrag(e, ev); });
    grip.addEventListener('keydown', function (ev) { onKey(e, ev); });
    /* `dblclick` still fires for mouse/touch on top of the pointer handlers —
       the pointerdowns are captured but never cancel the click sequence. */
    if (e.canFit) {
      grip.addEventListener('dblclick', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        fit(e);
      });
    }

    live.push(e);
    return {
      fit: function () { return e.canFit ? fit(e) : 'unsupported'; },
      set: function (w, h) { return write(e, w, h); },
      size: function () { return sizeOf(e); },
      natural: function () { return measure(e); },
      detach: function () { var i = live.indexOf(e); if (i >= 0) live.splice(i, 1); }
    };
  }

  /* Re-clamp every live window against the new viewport (bug 4). Windows that
     have left the DOM are dropped here rather than needing a detach() call from
     four different teardown paths. */
  function clampAll() {
    for (var i = live.length - 1; i >= 0; i--) {
      var e = live[i];
      if (!e.win.isConnected) { live.splice(i, 1); continue; }
      if (e.win.classList.contains('syfs-max') || e.win.classList.contains('syfs-min')) continue;
      if (!e.win.style.width && !e.body.style.height) continue;   /* never resized: CSS still owns it */
      var s = sizeOf(e);
      write(e, s.w, s.h);
    }
  }

  var rt = 0;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(clampAll, 120);
  });

  /* The two places that write a SAVED width straight onto a window — src/rail.js
     and src/app.js, before the resize engine has ever run on it — ask here rather
     than hard-coding 260/280 again. One rule, three call sites; a size saved when
     the tool had no rail must not come back and crush the panel. */
  function minWOf(win, base) {
    return floorW(win && (win.querySelector('.syfs-win-body') || win.querySelector('.syfs-frame-body')), base);
  }

  SYFS.winsize = { attach: attach, clampAll: clampAll, EDGE: EDGE, minW: minWOf, TAB_MINW: TAB_MINW };
}());
