/* tools/web-demo/stub-worker.js — DEV/SITE ONLY (never shipped in the extension).
 * chrome.* for background.js when the public site runs it in a SharedWorker (or a plain
 * Worker where SharedWorker is missing). Every open page of the demo is one "tab": it
 * connects a port, and this file routes between background.js and those ports.
 *
 * Storage lives in the PAGES (localStorage, one origin), so a write from here is
 * forwarded to a live port and comes back through the same onChanged path as a write
 * from a page. Capabilities no website has (cookies, browsingData, DNR, captureVisibleTab,
 * offscreen in the real sense…) answer like a quiet success and tell the page, which
 * shows «تعمل بعد التثبيت» — the demo never pretends they ran.
 * Protocol (page ⇄ worker), all plain objects:
 *   page→worker  hello{tab,url,kind} · msg{id,msg} · res{id,resp,none} · st-res{id,data,err}
 *                chg{area,changes} · api{id,path,args} · exec-res{id,err} · bye
 *   worker→page  res{id,resp,none,err} · tmsg{id,msg,sender} · st{id,area,op,arg} · chg{area,changes}
 *                exec{id,files} · open{url} · note{title,text} · blocked{api} · dl{url,name} */
'use strict';
(function () {
  var G = self;
  var BASE = new URL('./', G.location.href).href;            /* the ext/ folder */
  var ports = [];                                             /* {port, tab, url, kind, t} */
  var seq = 1, pending = {}, lastErr = null;

  function ev() {
    var ls = [];
    return {
      addListener: function (f) { if (ls.indexOf(f) < 0) ls.push(f); },
      removeListener: function (f) { var i = ls.indexOf(f); if (i >= 0) ls.splice(i, 1); },
      hasListener: function (f) { return ls.indexOf(f) >= 0; },
      _fire: function () { var a = arguments; ls.slice().forEach(function (f) { try { f.apply(null, a); } catch (e) { G.console.error(e); } }); },
      _ls: ls
    };
  }
  /* promise + optional callback, with runtime.lastError set while the callback runs */
  function cbp(p, cb) {
    if (typeof cb !== 'function') return p;
    p.then(function (v) { cb(v); }, function (e) {
      lastErr = { message: String(e && e.message || e) };
      try { cb(); } finally { lastErr = null; }
    });
    return undefined;
  }
  function lastArgCb(args) { return typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null; }

  function post(p, o) { try { p.port.postMessage(o); } catch (e) { /* page gone */ } }
  function ask(p, o) {
    return new Promise(function (res, rej) {
      var id = seq++; o.id = id; pending[id] = { res: res, rej: rej, p: p }; post(p, o);
    });
  }
  function livePort(kindNot) {
    for (var i = ports.length - 1; i >= 0; i--) if (ports[i].kind !== kindNot) return ports[i];
    return ports[ports.length - 1] || null;
  }
  function byTab(id) { for (var i = 0; i < ports.length; i++) if (ports[i].tab === id) return ports[i]; return null; }
  function tabObj(p) {
    return { id: p.tab, url: p.url, windowId: 1, index: ports.indexOf(p), active: p === activePort(), status: 'complete', title: '', incognito: false };
  }
  function activePort() {
    var best = null;
    ports.forEach(function (p) { if (p.kind !== 'offscreen' && (!best || p.t > best.t)) best = p; });
    return best;
  }
  function blocked(api) {
    var p = activePort(); if (p) post(p, { k: 'blocked', api: api });
  }

  /* ---------- storage: forwarded to a page ---------- */
  var onChanged = ev();
  function area(name) {
    function op(o, arg, cb) {
      var p = livePort('offscreen');
      var pr = p ? ask(p, { k: 'st', area: name, op: o, arg: arg }) : Promise.resolve(o === 'get' ? {} : undefined);
      return cbp(pr, cb);
    }
    return {
      get: function (k, cb) { if (typeof k === 'function') { cb = k; k = null; } return op('get', k === undefined ? null : k, cb); },
      set: function (o, cb) { return op('set', o, cb); },
      remove: function (k, cb) { return op('remove', k, cb); },
      clear: function (cb) { return op('clear', null, cb); },
      getBytesInUse: function (k, cb) { return cbp(Promise.resolve(0), lastArgCb(arguments)); },
      setAccessLevel: function () { return Promise.resolve(); },
      onChanged: ev()
    };
  }

  /* ---------- runtime messaging ---------- */
  var onMessage = ev();
  /* run the listeners like Chrome: first sendResponse wins; `true` keeps the channel open */
  function dispatch(listeners, msg, sender) {
    return new Promise(function (res) {
      var done = false, open = false;
      function reply(v) { if (!done) { done = true; res({ resp: v }); } }
      listeners.slice().forEach(function (f) {
        try { var r = f(msg, sender, reply); if (r === true) open = true; else if (r && typeof r.then === 'function') { open = true; r.then(reply, function () { reply(undefined); }); } }
        catch (e) { G.console.error(e); }
      });
      if (!done && !open) { done = true; res({ none: true }); }
    });
  }
  function senderOf(p) {
    var s = { id: chrome.runtime.id, url: p.url, origin: new URL(p.url).origin };
    if (p.kind !== 'offscreen') { s.tab = tabObj(p); s.frameId = 0; s.documentId = 'demo-' + p.tab; }
    return s;
  }
  /* a page's runtime.sendMessage: the worker's listeners, then the other extension pages */
  function fromPage(p, msg) {
    return dispatch(onMessage._ls, msg, senderOf(p)).then(function (r) {
      if (!r.none) return r;
      var others = ports.filter(function (q) { return q !== p && q.kind !== 'tab'; });
      return others.reduce(function (acc, q) {
        return acc.then(function (got) { return got.none ? ask(q, { k: 'tmsg', msg: msg, sender: senderOf(p) }) : got; });
      }, Promise.resolve({ none: true }));
    });
  }

  function exec(details) {
    var t = details && details.target, p = t && byTab(t.tabId);
    if (!p) return Promise.reject(new Error('No tab with id: ' + (t && t.tabId)));
    if (details.files) return ask(p, { k: 'exec', files: details.files }).then(function () { return [{ frameId: 0, result: null }]; });
    /* `func` cannot cross a postMessage boundary, and the site's CSP has no eval —
       the few callers (tab saver probes) treat a rejection as «not available here» */
    return Promise.reject(new Error('demo: scripting.func is not available on the website'));
  }

  /* ---------- alarms (real timers while the demo is open) ---------- */
  var alarms = {}, onAlarm = ev();
  function alarmCreate(name, info) {
    if (typeof name === 'object') { info = name; name = ''; }
    name = name || ''; info = info || {};
    alarmClear(name);
    var now = Date.now();
    var when = info.when || now + (info.delayInMinutes != null ? info.delayInMinutes : info.periodInMinutes || 0) * 60000;
    var a = { name: name, scheduledTime: when, periodInMinutes: info.periodInMinutes };
    a.h = setTimeout(function fire() {
      onAlarm._fire({ name: a.name, scheduledTime: a.scheduledTime, periodInMinutes: a.periodInMinutes });
      if (a.periodInMinutes) { a.scheduledTime = Date.now() + a.periodInMinutes * 60000; a.h = setTimeout(fire, a.periodInMinutes * 60000); }
      else delete alarms[name];
    }, Math.max(0, Math.min(when - now, 2147483000)));
    alarms[name] = a;
    return Promise.resolve();
  }
  function alarmClear(name) {
    var a = alarms[name || '']; if (!a) return false;
    clearTimeout(a.h); delete alarms[name || '']; return true;
  }
  function alarmPub(a) { return a && { name: a.name, scheduledTime: a.scheduledTime, periodInMinutes: a.periodInMinutes }; }

  function ok(v) { return function () { return cbp(Promise.resolve(v), lastArgCb(arguments)); }; }
  function deny(api, v) { return function () { blocked(api); return cbp(Promise.resolve(v), lastArgCb(arguments)); }; }

  var xhr = new XMLHttpRequest(); xhr.open('GET', BASE + 'manifest.json', false); xhr.send();
  var MANIFEST = JSON.parse(xhr.responseText);
  var offscreenOpen = false;

  var chrome = G.chrome = {
    runtime: {
      id: 'syf-demo',
      getURL: function (p) { return BASE + String(p || '').replace(/^\//, ''); },
      getManifest: function () { return MANIFEST; },
      get lastError() { return lastErr; },
      onMessage: onMessage, onInstalled: ev(), onStartup: ev(), onSuspend: ev(), onConnect: ev(),
      sendMessage: function (msg, cb) {
        var pages = ports.filter(function (q) { return q.kind !== 'tab'; });
        var pr = pages.reduce(function (acc, q) {
          return acc.then(function (got) { return got.none ? ask(q, { k: 'tmsg', msg: msg, sender: { id: chrome.runtime.id } }) : got; });
        }, Promise.resolve({ none: true })).then(function (r) {
          if (r.none) throw new Error('Could not establish connection. Receiving end does not exist.');
          return r.resp;
        });
        return cbp(pr, typeof cb === 'function' ? cb : null);
      },
      getContexts: function () {
        return Promise.resolve(ports.map(function (p) { return { contextType: p.kind === 'offscreen' ? 'OFFSCREEN_DOCUMENT' : 'TAB', documentUrl: p.url, tabId: p.tab }; }));
      },
      setUninstallURL: ok(), reload: ok(), openOptionsPage: ok()
    },
    storage: { local: area('local'), sync: area('sync'), session: area('session'), managed: area('managed'), onChanged: onChanged },
    tabs: {
      TAB_ID_NONE: -1,
      query: function (q) {
        q = q || {};
        var list = ports.filter(function (p) { return p.kind !== 'offscreen'; }).map(tabObj);
        if (q.active) list = list.filter(function (t) { return t.active; });
        if (q.url) list = list.filter(function (t) { return [].concat(q.url).some(function (u) { return t.url.indexOf(u.replace(/\*.*$/, '')) === 0; }); });
        return cbp(Promise.resolve(list), lastArgCb(arguments));
      },
      get: function (id) { var p = byTab(id); return cbp(p ? Promise.resolve(tabObj(p)) : Promise.reject(new Error('No tab with id: ' + id)), lastArgCb(arguments)); },
      sendMessage: function (id, msg) {
        var p = byTab(id);
        var pr = (p ? ask(p, { k: 'tmsg', msg: msg, sender: { id: chrome.runtime.id } }) : Promise.resolve({ none: true })).then(function (r) {
          if (r.none) throw new Error('Could not establish connection. Receiving end does not exist.');
          return r.resp;
        });
        return cbp(pr, lastArgCb(arguments));
      },
      create: function (o) {
        var url = String(o && o.url || ''), p = activePort();
        if (p) post(p, { k: 'open', url: url });
        return cbp(Promise.resolve({ id: -1, url: url, windowId: 1, active: true }), lastArgCb(arguments));
      },
      update: function (id, o) {
        if (typeof id === 'object') { o = id; id = null; }
        var p = id == null ? activePort() : byTab(id);
        if (p && o && o.url) post(p, { k: 'open', url: o.url });
        return cbp(Promise.resolve(p ? tabObj(p) : undefined), lastArgCb(arguments));
      },
      remove: deny('tabs.remove'), discard: deny('tabs.discard'), reload: ok(),
      getZoom: ok(1), setZoom: deny('tabs.setZoom'), getCurrent: ok(undefined),
      captureVisibleTab: function () { blocked('tabs.captureVisibleTab'); return cbp(Promise.reject(new Error('demo: screen capture needs the installed extension')), lastArgCb(arguments)); },
      onUpdated: ev(), onRemoved: ev(), onActivated: ev(), onCreated: ev(), onReplaced: ev()
    },
    windows: {
      WINDOW_ID_CURRENT: -2,
      get: ok({ id: 1, focused: true, state: 'normal', type: 'normal' }),
      getCurrent: ok({ id: 1, focused: true, state: 'normal', type: 'normal' }),
      getLastFocused: ok({ id: 1, focused: true, state: 'normal', type: 'normal' }),
      getAll: ok([{ id: 1, focused: true, state: 'normal', type: 'normal' }]),
      create: function (o) { var p = activePort(); if (p && o && o.url) post(p, { k: 'open', url: [].concat(o.url)[0] }); return cbp(Promise.resolve({ id: 2, tabs: [] }), lastArgCb(arguments)); },
      update: ok({ id: 1 }), remove: ok(),
      onRemoved: ev(), onBoundsChanged: ev(), onFocusChanged: ev()
    },
    scripting: {
      executeScript: function (d) { return cbp(exec(d), lastArgCb(arguments)); },
      insertCSS: ok(), removeCSS: ok(),
      registerContentScripts: ok(), unregisterContentScripts: ok(), getRegisteredContentScripts: ok([]), updateContentScripts: ok()
    },
    alarms: {
      create: function (n, i) { return alarmCreate(n, i); },
      clear: function (n, cb) { return cbp(Promise.resolve(alarmClear(n)), typeof n === 'function' ? n : cb); },
      clearAll: function (cb) { Object.keys(alarms).forEach(alarmClear); return cbp(Promise.resolve(true), cb); },
      get: function (n, cb) { if (typeof n === 'function') { cb = n; n = ''; } return cbp(Promise.resolve(alarmPub(alarms[n || ''])), cb); },
      getAll: function (cb) { return cbp(Promise.resolve(Object.keys(alarms).map(function (k) { return alarmPub(alarms[k]); })), cb); },
      onAlarm: onAlarm
    },
    notifications: {
      create: function (id, o) {
        if (typeof id === 'object') { o = id; id = 'n' + (seq++); }
        id = id || 'n' + (seq++);
        var p = activePort(); if (p && o) post(p, { k: 'note', title: String(o.title || ''), text: String(o.message || '') });
        return cbp(Promise.resolve(id), lastArgCb(arguments));
      },
      clear: ok(true), update: ok(true), getAll: ok({}),
      onClicked: ev(), onButtonClicked: ev(), onClosed: ev()
    },
    offscreen: {
      Reason: { AUDIO_PLAYBACK: 'AUDIO_PLAYBACK', BLOBS: 'BLOBS', DOM_PARSER: 'DOM_PARSER' },
      /* the offscreen page becomes a hidden iframe of the active demo page */
      createDocument: function (o) {
        var p = activePort();
        if (!p) return Promise.reject(new Error('no page'));
        offscreenOpen = true;
        post(p, { k: 'offscreen', url: chrome.runtime.getURL(o.url) });
        return new Promise(function (res) {
          var n = 0;
          (function wait() { if (ports.some(function (q) { return q.kind === 'offscreen'; }) || n++ > 50) res(); else setTimeout(wait, 100); }());
        });
      },
      hasDocument: function () { return Promise.resolve(offscreenOpen && ports.some(function (q) { return q.kind === 'offscreen'; })); },
      closeDocument: function () { offscreenOpen = false; ports.forEach(function (q) { if (q.kind !== 'offscreen') post(q, { k: 'offscreen-close' }); }); return Promise.resolve(); }
    },
    downloads: {
      download: function (o) { var p = activePort(); if (p && o) post(p, { k: 'dl', url: o.url, name: o.filename || '' }); return cbp(Promise.resolve(1), lastArgCb(arguments)); },
      onChanged: ev()
    },
    action: {
      onClicked: ev(), setBadgeText: ok(), setBadgeBackgroundColor: ok(), getBadgeText: ok(''),
      setIcon: ok(), setTitle: ok(), setPopup: ok()
    },
    sidePanel: { open: deny('sidePanel.open'), setOptions: ok(), setPanelBehavior: ok() },
    declarativeNetRequest: {
      updateSessionRules: deny('declarativeNetRequest'), updateDynamicRules: deny('declarativeNetRequest'),
      updateEnabledRulesets: deny('declarativeNetRequest'), getSessionRules: ok([]), getDynamicRules: ok([]),
      getEnabledRulesets: ok([]), setExtensionActionOptions: ok(), isRegexSupported: ok({ isSupported: true })
    },
    cookies: { getAll: deny('cookies', []), get: ok(null), remove: deny('cookies', null), set: deny('cookies', null), onChanged: ev() },
    browsingData: { remove: deny('browsingData'), removeCache: deny('browsingData'), removeCookies: deny('browsingData') },
    contextMenus: { create: ok(), removeAll: ok(), update: ok(), onClicked: ev() },
    commands: { onCommand: ev(), getAll: ok([]) },
    permissions: { contains: ok(true), request: ok(false), getAll: ok({ permissions: [], origins: [] }) },
    i18n: { getUILanguage: function () { return G.navigator.language || 'ar'; }, getMessage: function () { return ''; } }
  };

  /* ---------- ports ---------- */
  function attach(port) {
    var me = { port: port, tab: 0, url: '', kind: 'tab', t: Date.now() };
    port.onmessage = function (e) {
      var d = e.data || {};
      if (d.k === 'hello') {
        me.tab = d.tab; me.url = d.url; me.kind = d.kind; me.t = Date.now();
        if (ports.indexOf(me) < 0) ports.push(me);
        if (!booted) boot();
        return;
      }
      if (d.k === 'focus') { me.t = Date.now(); return; }
      if (d.k === 'bye') {
        var i = ports.indexOf(me); if (i >= 0) ports.splice(i, 1);
        if (me.kind === 'offscreen') offscreenOpen = false;
        else chrome.tabs.onRemoved._fire(me.tab, { windowId: 1, isWindowClosing: false });
        return;
      }
      if (d.k === 'msg') {
        fromPage(me, d.msg).then(function (r) { post(me, { k: 'res', id: d.id, resp: r.resp, none: !!r.none }); },
          function (err) { post(me, { k: 'res', id: d.id, err: String(err && err.message || err) }); });
        return;
      }
      if (d.k === 'chg') { onChanged._fire(d.changes, d.area); var a = chrome.storage[d.area]; if (a && a.onChanged) a.onChanged._fire(d.changes); return; }
      if (d.k === 'api') {
        var parts = String(d.path).split('.'), obj = chrome[parts[0]], fn = obj && obj[parts[1]];
        if (typeof fn !== 'function' || !/^(tabs|windows|sidePanel|action|scripting|downloads|alarms|notifications)$/.test(parts[0])) {
          post(me, { k: 'res', id: d.id, err: 'demo: ' + d.path + ' unavailable' }); return;
        }
        var args = (d.args || []).slice();
        if (parts[0] === 'tabs' && parts[1] === 'getCurrent') { post(me, { k: 'res', id: d.id, resp: me.kind === 'offscreen' ? undefined : tabObj(me) }); return; }
        Promise.resolve(fn.apply(obj, args)).then(function (v) { post(me, { k: 'res', id: d.id, resp: v }); },
          function (err) { post(me, { k: 'res', id: d.id, err: String(err && err.message || err) }); });
        return;
      }
      /* answers to our own questions */
      var w = pending[d.id];
      if (!w) return;
      delete pending[d.id];
      if (d.k === 'res') w.res(d);
      else if (d.err) w.rej(new Error(d.err));
      else w.res(d.data);
    };
    if (port.start) port.start();
  }

  var booted = false;
  function boot() {
    booted = true;
    /* a worker that just started is a browser that just started — never «install»,
       which opens the welcome tab on top of the demo */
    setTimeout(function () { chrome.runtime.onStartup._fire(); }, 0);
  }

  if ('onconnect' in G) G.onconnect = function (e) { attach(e.ports[0]); };
  else attach(G);                                            /* dedicated Worker fallback */
}());
