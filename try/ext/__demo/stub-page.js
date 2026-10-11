/* tools/web-demo/stub-page.js — DEV/SITE ONLY (never shipped in the extension).
 * chrome.* for every DOCUMENT of the public demo: the try page (where the content
 * bundle runs, as on any website) and the extension's own pages (kids.html, app.html…),
 * which the site build copies and loads with this file first.
 * - storage.* → localStorage of the site's origin, keys `syf_demo:<area>:<key>`, so every
 *   demo page shares one store and nothing reaches a server.
 * - runtime.sendMessage / onMessage → the background SharedWorker (stub-worker.js).
 * - the worker asks pages to inject files, open a page, show a note, download a file.
 * window.SYF_DEMO.hooks (set by the try page) shows those in the demo's own UI; an
 * extension page shown inside the try page hands them to its parent. */
'use strict';
(function () {
  var W = window;
  var me = document.currentScript;
  var BASE = new URL('../', me.src).href;                     /* …/try/ext/ */
  var PREFIX = 'syf_demo:';
  var href = location.href.split('#')[0];
  var kind = href.indexOf(BASE) === 0 ? (/\/offscreen\.html/.test(href) ? 'offscreen' : 'page') : 'tab';
  var TAB = Math.floor(Math.random() * 1e9) + 1;
  var seq = 1, pending = {}, lastErr = null;

  function ev() {
    var ls = [];
    return {
      addListener: function (f) { if (ls.indexOf(f) < 0) ls.push(f); },
      removeListener: function (f) { var i = ls.indexOf(f); if (i >= 0) ls.splice(i, 1); },
      hasListener: function (f) { return ls.indexOf(f) >= 0; },
      _fire: function () { var a = arguments; ls.slice().forEach(function (f) { try { f.apply(null, a); } catch (e) { console.error(e); } }); },
      _ls: ls
    };
  }
  function cbp(p, cb) {
    if (typeof cb !== 'function') return p;
    p.then(function (v) { cb(v); }, function (e) {
      lastErr = { message: String(e && e.message || e) };
      try { cb(); } finally { lastErr = null; }
    });
    return undefined;
  }
  function lastArgCb(args) { return typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null; }

  /* ---------- worker ---------- */
  var port;
  try {
    if (typeof SharedWorker === 'function') { var sw = new SharedWorker(BASE + 'demo-bg.js', { name: 'syf-demo' }); port = sw.port; }
    else port = new Worker(BASE + 'demo-bg.js');
  } catch (e) { port = { postMessage: function () {}, start: function () {} }; console.error('[syf-demo] worker', e); }
  function post(o) { try { port.postMessage(o); } catch (e) { /* closed */ } }
  function ask(o) {
    return new Promise(function (res, rej) { var id = seq++; o.id = id; pending[id] = { res: res, rej: rej }; post(o); });
  }

  /* ---------- storage ---------- */
  function sk(area, k) { return PREFIX + area + ':' + k; }
  function rd(area, k) { var v = localStorage.getItem(sk(area, k)); if (v == null) return undefined; try { return JSON.parse(v); } catch (e) { return undefined; } }
  function keysOf(area) {
    var out = [], pre = PREFIX + area + ':';
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(pre) === 0) out.push(k.slice(pre.length)); }
    return out;
  }
  var onChanged = ev(), areaEv = {};
  function fireChanged(area, changes) {
    if (!Object.keys(changes).length) return;
    setTimeout(function () {
      onChanged._fire(changes, area);
      if (areaEv[area]) areaEv[area]._fire(changes);
    }, 0);
  }
  /* the one place a write happens — a page's own call or the worker's, same path */
  function stOp(area, op, arg) {
    if (op === 'get') {
      var out = {};
      if (arg == null) keysOf(area).forEach(function (k) { out[k] = rd(area, k); });
      else if (typeof arg === 'string') { var v = rd(area, arg); if (v !== undefined) out[arg] = v; }
      else if (Array.isArray(arg)) arg.forEach(function (k) { var v2 = rd(area, k); if (v2 !== undefined) out[k] = v2; });
      else Object.keys(arg).forEach(function (k) { var v3 = rd(area, k); out[k] = v3 === undefined ? arg[k] : v3; });
      return out;
    }
    var ch = {};
    if (op === 'set') {
      Object.keys(arg || {}).forEach(function (k) {
        var old = rd(area, k), nv = arg[k];
        if (nv === undefined) return;
        var s = JSON.stringify(nv);
        localStorage.setItem(sk(area, k), s);                 /* throws on quota → caller's lastError */
        ch[k] = { oldValue: old, newValue: JSON.parse(s) };
        if (old === undefined) delete ch[k].oldValue;
      });
    } else if (op === 'remove' || op === 'clear') {
      (op === 'clear' ? keysOf(area) : [].concat(arg)).forEach(function (k) {
        var old = rd(area, k); if (old === undefined) return;
        localStorage.removeItem(sk(area, k)); ch[k] = { oldValue: old };
      });
    }
    fireChanged(area, ch);
    if (Object.keys(ch).length) post({ k: 'chg', area: area, changes: ch });
    return undefined;
  }
  /* writes from OTHER demo documents (same origin) arrive as `storage` events */
  W.addEventListener('storage', function (e) {
    if (!e.key || e.key.indexOf(PREFIX) !== 0) {
      if (e.key === null) fireChanged('local', {});
      return;
    }
    var rest = e.key.slice(PREFIX.length), i = rest.indexOf(':');
    var area = rest.slice(0, i), k = rest.slice(i + 1), c = {};
    try { if (e.oldValue != null) c.oldValue = JSON.parse(e.oldValue); if (e.newValue != null) c.newValue = JSON.parse(e.newValue); } catch (x) { return; }
    var ch = {}; ch[k] = c; fireChanged(area, ch);
  });
  function area(name) {
    areaEv[name] = ev();
    function op(o, arg, cb) {
      var pr;
      try { pr = Promise.resolve(stOp(name, o, arg)); } catch (e) { pr = Promise.reject(e); }
      return cbp(pr, cb);
    }
    return {
      get: function (k, cb) { if (typeof k === 'function') { cb = k; k = null; } return op('get', k === undefined ? null : k, cb); },
      set: function (o, cb) { return op('set', o, cb); },
      remove: function (k, cb) { return op('remove', k, cb); },
      clear: function (cb) { return op('clear', null, cb); },
      getBytesInUse: function () { return cbp(Promise.resolve(0), lastArgCb(arguments)); },
      setAccessLevel: function () { return Promise.resolve(); },
      onChanged: areaEv[name]
    };
  }

  /* ---------- messaging ---------- */
  var onMessage = ev();
  function dispatch(msg, sender) {
    return new Promise(function (res) {
      var done = false, open = false;
      function reply(v) { if (!done) { done = true; res({ resp: v }); } }
      onMessage._ls.slice().forEach(function (f) {
        try { var r = f(msg, sender, reply); if (r === true) open = true; else if (r && typeof r.then === 'function') { open = true; r.then(reply, function () { reply(undefined); }); } }
        catch (e) { console.error(e); }
      });
      if (!done && !open) { done = true; res({ none: true }); }
    });
  }
  function api(path) {
    return function () {
      var args = [].slice.call(arguments), cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
      var pr = ask({ k: 'api', path: path, args: args }).then(function (d) { if (d.err) throw new Error(d.err); return d.resp; });
      return cbp(pr, cb);
    };
  }

  /* ---------- requests from the worker ---------- */
  function hooks() {
    var h = W.SYF_DEMO && W.SYF_DEMO.hooks;
    if (h) return h;
    try { if (W.parent !== W && W.parent.SYF_DEMO && W.parent.SYF_DEMO.hooks) return W.parent.SYF_DEMO.hooks; } catch (e) { /* not ours */ }
    return null;
  }
  function inject(files) {
    return files.reduce(function (acc, f) {
      return acc.then(function () {
        return new Promise(function (res, rej) {
          var s = document.createElement('script');
          s.src = new URL(f, BASE).href;
          s.onload = function () { res(); };
          s.onerror = function () { rej(new Error('Could not load file: ' + f)); };
          (document.body || document.documentElement).appendChild(s);
        });
      });
    }, Promise.resolve());
  }
  port.onmessage = function (e) {
    var d = e.data || {}, h;
    if (d.k === 'st') {
      var r;
      try { r = { k: 'st-res', id: d.id, data: stOp(d.area, d.op, d.arg) }; } catch (x) { r = { k: 'st-res', id: d.id, err: String(x && x.message || x) }; }
      post(r); return;
    }
    if (d.k === 'tmsg') { dispatch(d.msg, d.sender).then(function (r2) { post({ k: 'res', id: d.id, resp: r2.resp, none: !!r2.none }); }); return; }
    if (d.k === 'exec') { inject(d.files).then(function () { post({ k: 'exec-res', id: d.id }); }, function (x) { post({ k: 'exec-res', id: d.id, err: String(x.message) }); }); return; }
    if (d.k === 'chg') { fireChanged(d.area, d.changes); return; }
    if (d.k === 'open') { h = hooks(); if (h && h.open) h.open(d.url); else W.open(d.url, '_blank', 'noopener'); return; }
    if (d.k === 'note') { h = hooks(); if (h && h.note) h.note(d.title, d.text); return; }
    if (d.k === 'blocked') { h = hooks(); if (h && h.blocked) h.blocked(d.api); return; }
    if (d.k === 'offscreen') { h = hooks(); if (h && h.offscreen) h.offscreen(d.url); return; }
    if (d.k === 'offscreen-close') { h = hooks(); if (h && h.offscreenClose) h.offscreenClose(); return; }
    if (d.k === 'dl') {
      var a = document.createElement('a'); a.href = d.url; a.download = String(d.name || '').split('/').pop(); a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove(); return;
    }
    var w = pending[d.id];
    if (!w) return;
    delete pending[d.id];
    w.res(d);
  };
  if (port.start) port.start();
  post({ k: 'hello', tab: TAB, url: href, kind: kind });
  W.addEventListener('focus', function () { post({ k: 'focus' }); });
  W.addEventListener('pointerdown', function () { post({ k: 'focus' }); }, true);
  W.addEventListener('pagehide', function () { post({ k: 'bye' }); });

  var xhr = new XMLHttpRequest(); xhr.open('GET', BASE + 'manifest.json', false); xhr.send();
  var MANIFEST = JSON.parse(xhr.responseText);

  W.chrome = {
    runtime: {
      id: 'syf-demo',
      getURL: function (p) { return BASE + String(p || '').replace(/^\//, ''); },
      getManifest: function () { return MANIFEST; },
      get lastError() { return lastErr; },
      onMessage: onMessage, onInstalled: ev(), onStartup: ev(), onConnect: ev(),
      sendMessage: function (msg, cb) {
        if (typeof msg === 'string') { msg = cb; cb = arguments[2]; }       /* (extensionId, msg, cb) */
        var pr = ask({ k: 'msg', msg: msg }).then(function (d) {
          if (d.err) throw new Error(d.err);
          if (d.none) throw new Error('Could not establish connection. Receiving end does not exist.');
          return d.resp;
        });
        return cbp(pr, typeof cb === 'function' ? cb : null);
      },
      openOptionsPage: function () {}
    },
    storage: { local: area('local'), sync: area('sync'), session: area('session'), onChanged: onChanged },
    tabs: {
      TAB_ID_NONE: -1,
      getCurrent: api('tabs.getCurrent'), create: api('tabs.create'), update: api('tabs.update'), remove: api('tabs.remove'),
      query: api('tabs.query'), get: api('tabs.get'), sendMessage: api('tabs.sendMessage'),
      setZoom: api('tabs.setZoom'), getZoom: api('tabs.getZoom'), captureVisibleTab: api('tabs.captureVisibleTab'),
      onUpdated: ev(), onRemoved: ev(), onActivated: ev()
    },
    windows: { WINDOW_ID_CURRENT: -2, getCurrent: api('windows.getCurrent'), update: api('windows.update'), create: api('windows.create'), get: api('windows.get') },
    scripting: { registerContentScripts: api('scripting.registerContentScripts'), executeScript: api('scripting.executeScript') },
    sidePanel: { open: api('sidePanel.open') },
    action: { getBadgeText: api('action.getBadgeText') },
    i18n: { getUILanguage: function () { return navigator.language || 'ar'; }, getMessage: function () { return ''; } }
  };
  W.SYF_DEMO = W.SYF_DEMO || {};
  W.SYF_DEMO.base = BASE;
  W.SYF_DEMO.reset = function () {
    for (var i = localStorage.length - 1; i >= 0; i--) { var k = localStorage.key(i); if (k && k.indexOf(PREFIX) === 0) localStorage.removeItem(k); }
  };
}());
