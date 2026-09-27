/* guide-slides.js — the illustrated guide as slides, v0.140.2.
 *
 * Reads the SAME data as guide.html: guide-data.js (text), guide-img/ (screenshots),
 * guide-meta.js (real icons + shortcuts, GENERATED from the shipped tools by
 * tools/guide-meta-build.js) and guide-settings.js (what every setting does). The
 * page's own <html lang> picks the language (guide-slides.html = ar, -en = en).
 *
 * Deck: cover (every tool's icon in orbit) · contents (every category + tool) · per category a divider + one slide per
 * tool · the plain link shortcuts share one slide · then the settings chapter.
 *
 * ⛔ No innerHTML: text goes in with textContent. Icons are SVG strings from our own
 * source (guide-meta.js); they are parsed as XML with DOMParser and imported, so a
 * malformed or hostile string can never become script or HTML markup. */
(function () {
  'use strict';

  var LANG = document.documentElement.lang === 'en' ? 'en' : 'ar';
  var AR = LANG === 'ar';
  var RTL = document.documentElement.dir === 'rtl';

  var UI = AR ? {
    title: 'دليل الاستخدام', kick: 'SYF SHORTCUTS · صندوق أدوات المتصفّح',
    sub: 'كل ما تحتاجه أثناء التصفّح، في شريط واحد على حافة الشاشة. تعرّف على كل أداة وأيقونتها واختصار فتحها وخطوات استعمالها، ثم اضبط الإضافة على ذوقك بشرح واضح لكل إعداد.',
    tools: 'أداة', cats: 'فئة', sets: 'شاشة إعدادات', go: 'ابدأ الجولة',
    hint: 'الأسهم أو المسافة للتنقّل · F ملء الشاشة · انقر أي أيقونة لتذهب إليها',
    count: '{0} أداة', noshot: 'تفتح في شاشتها الخاصّة — لا نافذة عائمة تُصوَّر.',
    shorts: 'اختصارات سريعة', shortsSub: 'روابط تفتح موقعًا بضغطة — بلا نافذة ولا إعداد.',
    cover: 'الغلاف', open: 'افتحها من لوحة المفاتيح', catKeys: 'افتح الفئة من لوحة المفاتيح',
    chord: 'اضغط {0} ثم {1} ثم {2} — الحروف تظهر على الشاشة بعد {0}، وتعمل بلوحة المفاتيح العربية أيضًا.',
    catChord: 'اضغط {0} ثم {1} لتظهر أدوات الفئة بحروفها.',
    fixed: 'اختصار ثابت يعمل في أي صفحة ما دمت لا تكتب داخل حقل.',
    off: '⚠️ مخفيّة في التثبيت الجديد — أظهرها من ⚙ ← 🧩 الأدوات فيعمل اختصارها.',
    none: 'لا اختصار افتراضيًا — عيّن واحدًا من ⚙ ← ⌨ المفاتيح.',
    iconIs: 'أيقونتها في الشريط', inCat: 'في فئة', rail: 'الشريط',
    setTitle: 'الإعدادات', setSub: 'كل إعداد في الإضافة وماذا يفعل بالضبط.',
    setHow: 'أين تجد الإعدادات؟', where: 'المكان:', pinHint: 'كل رقم على الصورة يقابل شرحه هنا',
    slide: 'شريحة', light: 'الوضع الفاتح', dark: 'الوضع الداكن',
    toc: 'الفهرس', tocSub: 'كل الفئات والأدوات في مكان واحد — انقر أيّ سطر لتذهب إلى شريحته، والرقم بجانبه هو رقم الشريحة.'
  } : {
    title: 'User guide', kick: 'SYF SHORTCUTS · YOUR BROWSER TOOLBOX',
    sub: 'Everything you need while browsing, in one bar at the edge of the screen. Meet every tool, its icon, the shortcut that opens it and the steps to use it — then tune the extension with a clear explanation of every setting.',
    tools: 'tools', cats: 'categories', sets: 'settings screens', go: 'Start the tour',
    hint: 'Arrows or Space to move · F for full screen · click any icon to jump to it',
    count: '{0} tools', noshot: 'Opens in its own screen — no floating window to picture.',
    shorts: 'Quick shortcuts', shortsSub: 'Links that open a site in one press — no window, no setup.',
    cover: 'Cover', open: 'Open it from the keyboard', catKeys: 'Open the category from the keyboard',
    chord: 'Press {0}, then {1}, then {2} — the letters appear on screen after {0}, and work on an Arabic layout too.',
    catChord: 'Press {0}, then {1}, to see the category\'s tools with their letters.',
    fixed: 'A fixed shortcut that works on any page while you are not typing in a field.',
    off: '⚠️ Hidden on a fresh install — show it from ⚙ → 🧩 Tools and its shortcut works.',
    none: 'No default shortcut — assign one from ⚙ → ⌨ Keys.',
    iconIs: 'Its icon on the rail', inCat: 'in', rail: 'Rail',
    setTitle: 'Settings', setSub: 'Every setting in the extension and exactly what it does.',
    setHow: 'Where are the settings?', where: 'Where:', pinHint: 'Each number on the picture matches its explanation here',
    slide: 'slide', light: 'Light mode', dark: 'Dark mode',
    toc: 'Contents', tocSub: 'Every category and tool in one place — click any line to jump to its slide; the number beside it is the slide number.'
  };
  function fmt(s) { var a = arguments; return s.replace(/\{(\d)\}/g, function (m, i) { return a[+i + 1]; }); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  var parser = new DOMParser();
  function icon(svg, cls) {
    var box = el('span', 'ic' + (cls ? ' ' + cls : ''));
    box.setAttribute('aria-hidden', 'true');
    if (svg) {
      /* the rail inserts these as HTML, where <svg> needs no namespace; as XML it does,
         or the element parses into the null namespace and never paints */
      if (!/^<svg[^>]*\sxmlns=/.test(svg)) svg = svg.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
      var doc = parser.parseFromString(svg, 'image/svg+xml');
      var root = doc.documentElement;
      if (root && root.nodeName === 'svg' && !doc.getElementsByTagName('parsererror').length) box.appendChild(document.importNode(root, true));
    }
    return box;
  }

  var CATS = window.SYF_GUIDE_CATS, TOOLS = window.SYF_GUIDE;
  var META = window.SYF_GUIDE_META || { leader: 'Alt+K', cats: {}, tools: {} };
  var SETS = window.SYF_GUIDE_SETTINGS || [];
  var stage = document.getElementById('s-stage');
  var jump = document.getElementById('s-jump');
  var deck = [];                    /* { el, id, cat } in show order */
  var byId = {};                    /* hash id → deck index (tools on a shared slide included) */
  var catName = {};
  CATS.forEach(function (c) { catName[c.id] = c[LANG]; });
  function tm(id) { return META.tools[id] || {}; }

  function slide(cls, id, cat, label) {
    var s = el('section', 's-slide ' + cls);
    s.dataset.cat = cat || 'settings';
    s.setAttribute('role', 'group');
    s.setAttribute('aria-roledescription', UI.slide);
    s.setAttribute('aria-label', label);
    stage.appendChild(s);
    byId[id] = deck.length;
    deck.push({ el: s, id: id, cat: cat });
    return s;
  }
  function wash(s, svg) {
    var bg = el('div', 's-bg');
    if (svg) bg.appendChild(icon(svg, 's-mark'));
    s.appendChild(bg);
    var inner = el('div', 's-in');
    s.appendChild(inner);
    return inner;
  }
  function rise(node, d) { node.classList.add('s-rise'); node.style.setProperty('--d', d); return node; }
  function jumpTo(id) { return function () { if (byId[id] != null) go(byId[id]); }; }

  /* keycaps: 'Alt+K' + ['i','q'] → [Alt] + [K] → [I] → [Q] */
  function combo(parts) {
    var row = el('div', 's-combo'), k = 0;
    parts.forEach(function (p, pi) {
      if (pi) row.appendChild(el('i', null, '→'));
      p.split('+').forEach(function (key, ki) {
        if (ki) row.appendChild(el('i', null, '+'));
        var c = el('kbd', null, key.length === 1 ? key.toUpperCase() : key);
        c.style.setProperty('--k', k++);
        row.appendChild(c);
      });
    });
    return row;
  }
  function keysCard(m, catKey) {
    var box = el('div', 's-keys');
    var h = el('div', 's-keys-h', '⌨ ' + UI.open);
    box.appendChild(h);
    if (m.chord) {
      box.appendChild(combo([META.leader, m.chord[0], m.chord[1]]));
      box.appendChild(el('p', null, fmt(UI.chord, META.leader, m.chord[0].toUpperCase(), m.chord[1].toUpperCase())));
      if (m.off) box.appendChild(el('p', 'warn', UI.off));
    } else if (m.hotkey) {
      box.appendChild(combo([m.hotkey]));
      box.appendChild(el('p', null, UI.fixed));
    } else {
      box.appendChild(el('p', null, UI.none));
    }
    return box;
  }

  /* ================= cover ================= */
  var cover = slide('s-cover', 'cover', null, UI.cover);
  delete cover.dataset.cat;
  /* the icon wall: ten tilted rows, each a different stride through the tool list so
     neighbouring rows never line up; the list is appended twice for a seamless loop */
  var wall = el('div', 's-wall');
  for (var r = 0; r < 10; r++) {
    var row = el('div', 's-row' + (r % 2 ? ' rev' : ''));
    row.style.setProperty('--t', (70 + r * 9) + 's');
    var picks = [];
    /* one copy must outrun the widest screen, or the end of a loop shows a gap:
       ~1.5 viewports of tiles (92px each), never fewer than 18 */
    var per = Math.max(18, Math.ceil(Math.max(window.innerWidth, 1280) * 1.5 / 92));
    for (var k = 0; k < per; k++) picks.push(TOOLS[(r * 15 + k * 7) % TOOLS.length]);
    picks.concat(picks).forEach(function (t, n) {
      var b = el('button', 's-cell');
      b.type = 'button'; b.title = t[LANG].n;
      /* the second copy is decoration only — one tab stop per tool is enough */
      if (n >= picks.length) { b.tabIndex = -1; b.setAttribute('aria-hidden', 'true'); }
      else b.setAttribute('aria-label', t[LANG].n);
      b.appendChild(icon(tm(t.id).icon));
      b.addEventListener('click', jumpTo('tool-' + t.id));
      row.appendChild(b);
    });
    wall.appendChild(row);
  }
  cover.appendChild(wall);
  cover.appendChild(el('div', 's-vig'));
  var hero = el('div', 's-hero'), hin = el('div', 's-hero-in');
  hin.appendChild(el('div', 's-kick', UI.kick));
  hin.appendChild(el('h1', null, UI.title));
  hin.appendChild(el('p', null, UI.sub));
  var goBtn = el('button', 's-go', UI.go + (RTL ? '  ←' : '  →'));
  goBtn.type = 'button';
  goBtn.addEventListener('click', function () { go(1); });
  hin.appendChild(goBtn);
  var stats = el('div', 's-stats');
  [[TOOLS.length, UI.tools], [CATS.length, UI.cats], [SETS.length, UI.sets]].forEach(function (x) {
    var sp = el('span'); sp.appendChild(el('b', null, String(x[0]))); sp.appendChild(document.createTextNode(x[1])); stats.appendChild(sp);
  });
  hin.appendChild(stats);
  hin.appendChild(el('div', 's-hint', UI.hint));
  hero.appendChild(hin);
  cover.appendChild(hero);
  var og = el('option', null, UI.cover); og.value = 'cover'; jump.appendChild(og);

  /* contents (v0.140.12): every category with its tools, like a book's index. The slide
     numbers are filled in once the whole deck exists (tocNums), because the slides
     they point to are built after this one. */
  var tocNums = [];
  var toc = slide('s-toc', 'toc', null, UI.toc);
  delete toc.dataset.cat;
  var tin = wash(toc, null);
  var th = el('div', 's-list-h');
  var tIc = el('span', 's-emoji', '☰');
  tIc.setAttribute('aria-hidden', 'true');
  th.appendChild(tIc);
  th.appendChild(el('h2', null, UI.toc));
  tin.appendChild(rise(th, 0));
  tin.appendChild(rise(el('p', 's-what', UI.tocSub), 1));
  var tcols = el('div', 's-toc-cols');
  function tocRow(parent, cls, ic, label, id) {
    var b = el('button', cls);
    b.type = 'button';
    b.title = label;               /* a long name is cut with … — the tooltip keeps it whole */
    parent.appendChild(b);
    if (ic) b.appendChild(ic);
    b.appendChild(el('span', 's-toc-n', label));
    b.appendChild(el('i', 's-toc-dots'));
    var num = el('b', 's-toc-p');
    b.appendChild(num);
    tocNums.push([num, id]);
    b.addEventListener('click', jumpTo(id));
    return b;
  }
  var tn = 0;
  CATS.forEach(function (cat) {
    var mine = TOOLS.filter(function (t) { return t.cat === cat.id; });
    if (!mine.length) return;
    var box = el('div', 's-toc-cat');
    box.style.setProperty('--i', tn++);
    tocRow(box, 's-toc-h', icon((META.cats[cat.id] || {}).icon), cat[LANG] + ' · ' + mine.length, 'cat-' + cat.id);
    /* the plain links share ONE slide, so they share one line here too */
    var bareT = [];
    mine.forEach(function (t) {
      if (!t.img && !(t[LANG].s && t[LANG].s.length)) { bareT.push(t[LANG].n); return; }
      tocRow(box, 's-toc-t', icon(tm(t.id).icon), t[LANG].n, 'tool-' + t.id);
    });
    if (bareT.length) {
      var lr = tocRow(box, 's-toc-t', el('span', 'ic s-toc-emo', '🔗'), UI.shorts + ' · ' + bareT.length, 'cat-' + cat.id + '-links');
      lr.title = bareT.join(' · ');
    }
    tcols.appendChild(box);
  });
  if (SETS.length) {
    var sbox = el('div', 's-toc-cat');
    sbox.style.setProperty('--i', tn);
    var gIc = el('span', 'ic s-toc-emo', '⚙');
    tocRow(sbox, 's-toc-h', gIc, UI.setTitle + ' · ' + SETS.length, 'settings');
    SETS.forEach(function (g) { tocRow(sbox, 's-toc-t', el('span', 'ic s-toc-emo', g.icon), g[LANG].n, 'set-' + g.id); });
    tcols.appendChild(sbox);
  }
  tin.appendChild(tcols);
  var ot = el('option', null, UI.toc); ot.value = 'toc'; jump.appendChild(ot);

  /* ================= categories and tools ================= */
  CATS.forEach(function (cat) {
    var mine = TOOLS.filter(function (t) { return t.cat === cat.id; });
    if (!mine.length) return;
    var cm = META.cats[cat.id] || {};

    /* divider */
    var dv = slide('s-div', 'cat-' + cat.id, cat.id, cat[LANG]);
    var din = wash(dv, cm.icon);
    rise(din.appendChild(icon(cm.icon, 's-big')), 0);
    rise(din.appendChild(el('h2', null, cat[LANG])), 1);
    rise(din.appendChild(el('p', 's-sub', fmt(UI.count, mine.length))), 2);
    if (cm.key) {
      var ck = rise(el('div', 's-keys'), 3);
      ck.style.maxWidth = '520px'; ck.style.margin = '6px auto 20px';
      ck.appendChild(el('div', 's-keys-h', '⌨ ' + UI.catKeys));
      ck.appendChild(combo([META.leader, cm.key]));
      ck.appendChild(el('p', null, fmt(UI.catChord, META.leader, cm.key.toUpperCase())));
      din.appendChild(ck);
    }
    var grid = el('div', 's-grid');
    mine.forEach(function (t, i) {
      var b = el('button');
      b.type = 'button'; b.style.setProperty('--i', i);
      b.appendChild(icon(tm(t.id).icon));
      b.appendChild(el('span', null, t[LANG].n));
      b.addEventListener('click', jumpTo('tool-' + t.id));
      grid.appendChild(b);
    });
    din.appendChild(grid);

    var grp = el('optgroup'); grp.label = cat[LANG];
    var o = el('option', null, '— ' + cat[LANG]); o.value = 'cat-' + cat.id; grp.appendChild(o);

    var bare = [];
    mine.forEach(function (t) {
      var d = t[LANG], m = tm(t.id);
      if (!t.img && !(d.s && d.s.length)) { bare.push(t); return; }

      var s = slide('', 'tool-' + t.id, cat.id, d.n);
      var inner = wash(s, m.icon);
      var wrap = el('div', 's-tool');

      var shot = el('div', 's-shot');
      if (t.img) {
        var img = document.createElement('img');
        img.src = 'guide-img/' + t.id + '.png';
        img.alt = d.n;
        img.decoding = 'async';
        img.loading = 'lazy';
        shot.appendChild(img);
      } else {
        var solo = el('div', 's-solo');
        solo.appendChild(icon(m.icon, 's-tile'));
        solo.appendChild(el('span', null, UI.noshot));
        shot.appendChild(solo);
      }
      wrap.appendChild(rise(shot, 0));

      var tx = el('div', 's-text');
      var crumb = el('div', 's-crumb');
      crumb.appendChild(icon(cm.icon));
      crumb.appendChild(document.createTextNode(UI.rail + ' › '));
      crumb.appendChild(el('b', null, cat[LANG]));
      crumb.appendChild(document.createTextNode(' › ' + d.n));
      tx.appendChild(rise(crumb, 1));
      var head = el('div', 's-head');
      var tile = icon(m.icon, 's-tile');
      tile.title = UI.iconIs;
      head.appendChild(tile);
      var hh = el('div');
      hh.appendChild(el('h2', null, d.n));
      hh.appendChild(el('span', 's-tag', '↖ ' + UI.iconIs + ' — ' + UI.inCat + ' «' + cat[LANG] + '»'));
      head.appendChild(hh);
      tx.appendChild(rise(head, 2));
      tx.appendChild(rise(el('p', 's-what', d.w), 3));
      if (d.s && d.s.length) {
        var ol = el('ol', 's-steps');
        d.s.forEach(function (st) { ol.appendChild(el('li', null, st)); });
        tx.appendChild(rise(ol, 4));
      }
      tx.appendChild(rise(keysCard(m), 5));
      wrap.appendChild(tx);
      inner.appendChild(wrap);

      var op = el('option', null, d.n); op.value = 'tool-' + t.id; grp.appendChild(op);
    });

    if (bare.length) {
      var ls = slide('', 'cat-' + cat.id + '-links', cat.id, cat[LANG] + ' · ' + UI.shorts);
      var lin = wash(ls, cm.icon);
      var lh = el('div', 's-list-h');
      lh.appendChild(icon(cm.icon, 's-tile'));
      lh.appendChild(el('h2', null, UI.shorts));
      lin.appendChild(rise(lh, 0));
      lin.appendChild(rise(el('p', 's-what', UI.shortsSub), 1));
      var cards = el('div', 's-cards');
      bare.forEach(function (t, i) {
        var c = el('div', 's-card');
        c.style.setProperty('--i', i);
        var h3 = el('h3');
        h3.appendChild(icon(tm(t.id).icon));
        h3.appendChild(document.createTextNode(t[LANG].n));
        c.appendChild(h3);
        c.appendChild(el('p', null, t[LANG].w));
        var mm = tm(t.id);
        if (mm.chord) c.appendChild(el('small', null, META.leader + ' → ' + mm.chord[0].toUpperCase() + ' → ' + mm.chord[1].toUpperCase()));
        else if (mm.hotkey) c.appendChild(el('small', null, mm.hotkey));
        cards.appendChild(c);
        byId['tool-' + t.id] = deck.length - 1;
      });
      lin.appendChild(cards);
      var ol2 = el('option', null, UI.shorts); ol2.value = 'cat-' + cat.id + '-links'; grp.appendChild(ol2);
    }
    jump.appendChild(grp);
  });

  /* ================= settings chapter ================= */
  /* a settings screen: its picture with a numbered pin on every setting, and the same
     numbers on the explanations beside it. Pointing at either one lights up the other. */
  function setShot(inner, g) {
    var wrap = el('div', 's-tool s-set');
    var shot = el('div', 's-shot');
    var box = el('div', 's-pinbox');
    var img = document.createElement('img');
    img.src = g.img;
    img.alt = g[LANG].n;
    img.decoding = 'async';
    img.loading = 'lazy';
    box.appendChild(img);
    var pins = [], rows = [];
    g.items.forEach(function (it, i) {
      if (!it.pin) return;
      var p = el('span', it.pin[2] ? 's-pin s-pin-e' : 's-pin', String(i + 1));
      p.style.left = it.pin[0] + '%';
      p.style.top = it.pin[1] + '%';
      p.style.setProperty('--i', i);
      p.setAttribute('aria-hidden', 'true');
      box.appendChild(p);
      pins[i] = p;
    });
    shot.appendChild(box);
    wrap.appendChild(rise(shot, 0));

    var tx = el('div', 's-text');
    var head = el('div', 's-head');
    var tile = el('span', 's-tile s-emo', g.icon);
    tile.setAttribute('aria-hidden', 'true');
    head.appendChild(tile);
    var hh = el('div');
    hh.appendChild(el('h2', null, g[LANG].n));
    hh.appendChild(el('span', 's-tag', UI.pinHint));
    head.appendChild(hh);
    tx.appendChild(rise(head, 1));
    var wh = el('div', 's-where');
    wh.appendChild(el('b', null, UI.where));
    wh.appendChild(document.createTextNode(' ' + g[LANG].where));
    tx.appendChild(rise(wh, 2));
    var ol = el('ol', 's-steps s-setlist');
    g.items.forEach(function (it, i) {
      var li = el('li');
      li.value = i + 1;
      if (!it.pin) li.className = 'nopin';
      li.appendChild(el('b', null, it[LANG][0]));
      li.appendChild(el('span', null, it[LANG][1]));
      li.style.setProperty('--d', 3 + i);
      li.classList.add('s-rise');
      rows[i] = li;
      ol.appendChild(li);
    });
    tx.appendChild(ol);
    wrap.appendChild(tx);
    inner.appendChild(wrap);

    function hot(i, on) {
      if (pins[i]) pins[i].classList.toggle('hot', on);
      if (rows[i]) rows[i].classList.toggle('hot', on);
    }
    rows.forEach(function (li, i) {
      li.addEventListener('mouseenter', function () { hot(i, true); });
      li.addEventListener('mouseleave', function () { hot(i, false); });
    });
    pins.forEach(function (p, i) {
      if (!p) return;
      p.addEventListener('mouseenter', function () { hot(i, true); });
      p.addEventListener('mouseleave', function () { hot(i, false); });
    });
  }

  if (SETS.length) {
    var gs = el('optgroup'); gs.label = UI.setTitle;
    var sd = slide('s-div', 'settings', 'settings', UI.setTitle);
    var sdi = wash(sd, null);
    var gear = rise(el('div', 's-big'), 0);
    gear.style.fontSize = 'clamp(44px, 7vmin, 64px)'; gear.style.padding = '0'; gear.style.display = 'grid'; gear.style.placeItems = 'center';
    gear.textContent = '⚙';
    sdi.appendChild(gear);
    sdi.appendChild(rise(el('h2', null, UI.setTitle), 1));
    sdi.appendChild(rise(el('p', 's-sub', UI.setSub), 2));
    var sg = el('div', 's-grid');
    SETS.forEach(function (g, i) {
      var b = el('button');
      b.type = 'button'; b.style.setProperty('--i', i);
      var e = el('span', 'ic', g.icon); e.style.fontSize = '20px'; e.style.display = 'grid'; e.style.placeItems = 'center'; e.style.padding = '0';
      b.appendChild(e);
      b.appendChild(el('span', null, g[LANG].n));
      b.addEventListener('click', jumpTo('set-' + g.id));
      sg.appendChild(b);
    });
    sdi.appendChild(sg);
    var so = el('option', null, '— ' + UI.setTitle); so.value = 'settings'; gs.appendChild(so);

    SETS.forEach(function (g) {
      var s = slide('', 'set-' + g.id, 'settings', g[LANG].n);
      var inner = wash(s, null);
      if (g.img) { setShot(inner, g); var op0 = el('option', null, g.icon + ' ' + g[LANG].n); op0.value = 'set-' + g.id; gs.appendChild(op0); return; }
      var lh = el('div', 's-list-h');
      lh.appendChild(el('span', 's-emoji', g.icon));
      lh.appendChild(el('h2', null, g[LANG].n));
      inner.appendChild(rise(lh, 0));
      var wh = el('div', 's-where');
      wh.appendChild(el('b', null, UI.where));
      wh.appendChild(document.createTextNode(' ' + g[LANG].where));
      inner.appendChild(rise(wh, 1));
      var cards = el('div', 's-cards');
      g.items.forEach(function (it, i) {
        var c = el('div', 's-card');
        c.style.setProperty('--i', i);
        c.appendChild(el('h3', null, it[LANG][0]));
        c.appendChild(el('p', null, it[LANG][1]));
        cards.appendChild(c);
      });
      inner.appendChild(cards);
      var op = el('option', null, g.icon + ' ' + g[LANG].n); op.value = 'set-' + g.id; gs.appendChild(op);
    });
    jump.appendChild(gs);
  }

  /* ================= navigation ================= */
  tocNums.forEach(function (x) { if (byId[x[1]] != null) x[0].textContent = String(byId[x[1]] + 1); });

  var cur = -1;
  var pos = document.getElementById('s-pos');
  var bar = document.getElementById('s-bar-i');
  var prev = document.getElementById('s-prev');
  var next = document.getElementById('s-next');
  var foot = document.querySelector('.s-foot');

  function go(i) {
    i = Math.max(0, Math.min(deck.length - 1, i));
    if (i === cur) return;
    if (cur >= 0) deck[cur].el.classList.remove('on');
    cur = i;
    var s = deck[i];
    s.el.classList.add('on');
    var sc = s.el.querySelector('.s-in'); if (sc) sc.scrollTop = 0;
    pos.textContent = (i + 1) + ' / ' + deck.length;
    bar.style.width = ((i + 1) / deck.length * 100) + '%';
    if (s.el.dataset.cat) foot.dataset.cat = s.el.dataset.cat; else delete foot.dataset.cat;
    prev.disabled = i === 0;
    next.disabled = i === deck.length - 1;
    jump.value = s.id;
    if (jump.value !== s.id) jump.selectedIndex = -1;
    if (history.replaceState) history.replaceState(null, '', '#' + s.id);
  }

  prev.addEventListener('click', function () { go(cur - 1); });
  next.addEventListener('click', function () { go(cur + 1); });
  jump.addEventListener('change', function () { if (byId[jump.value] != null) go(byId[jump.value]); });

  document.getElementById('s-print').addEventListener('click', function () { window.print(); });
  document.getElementById('s-full').addEventListener('click', toggleFull);
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  }

  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target && /^(SELECT|INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    var fwd = RTL ? 'ArrowLeft' : 'ArrowRight', back = RTL ? 'ArrowRight' : 'ArrowLeft';
    var k = e.key;
    if (k === fwd || k === 'PageDown' || k === ' ' || k === 'ArrowDown') { e.preventDefault(); go(cur + 1); }
    else if (k === back || k === 'PageUp' || k === 'ArrowUp') { e.preventDefault(); go(cur - 1); }
    else if (k === 'Home') { e.preventDefault(); go(0); }
    else if (k === 'End') { e.preventDefault(); go(deck.length - 1); }
    else if (k === 'f' || k === 'F') toggleFull();
  });

  /* swipe on touch screens: a horizontal drag of 50px+ turns the page */
  var sx = null, sy = 0;
  stage.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', function (e) {
    if (sx == null) return;
    var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    go(cur + ((RTL ? dx > 0 : dx < 0) ? 1 : -1));
  });

  /* ----- theme: light by default, toggle remembered per viewer ----- */
  var root = document.documentElement;
  var themeBtn = document.getElementById('s-theme');
  function isDark() { return root.getAttribute('data-theme') === 'dark'; }
  function paintTheme() {
    var d = isDark();
    themeBtn.textContent = d ? '☀' : '☾';
    themeBtn.setAttribute('aria-label', d ? UI.light : UI.dark);
    themeBtn.title = d ? UI.light : UI.dark;
  }
  try { var saved = localStorage.getItem('syfs_slides_theme'); if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved); } catch (e) {}
  themeBtn.addEventListener('click', function () {
    var d = !isDark();
    root.setAttribute('data-theme', d ? 'dark' : 'light');
    try { localStorage.setItem('syfs_slides_theme', d ? 'dark' : 'light'); } catch (e) {}
    paintTheme();
  });
  paintTheme();

  var start = byId[location.hash.slice(1)];
  go(typeof start === 'number' ? start : 0);
}());
