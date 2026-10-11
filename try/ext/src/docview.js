/* SYF — Markdown viewer & JSON formatter.
 *
 * Two entry points, one file:
 *   1. Page takeover — a raw .md or .json document renders itself (the worker
 *      injects this file after src/docdetect.js spots one). Raw ⇄ formatted is
 *      one click and the original text is never thrown away.
 *   2. Rail tool `mdview` — paste Markdown or open a .md file and read it
 *      rendered, on any page. Registered when this file arrives as part of
 *      LAZY_TOOL_FILES.
 *
 * Security — this renders text the page controls, so nothing takes a shortcut:
 *   · The Markdown parser builds DOM NODES. Every piece of text goes in through
 *     textContent; no innerHTML anywhere in the render path. Raw HTML inside the
 *     Markdown source is shown as text, never parsed — a .md file from the web
 *     is untrusted input, not a template.
 *   · Link and image URLs pass a scheme WHITELIST (http, https, mailto, relative
 *     and in-page anchors). javascript:, data: and everything else are dropped,
 *     so a crafted document cannot turn a click into script execution.
 *   · The JSON tree prints keys and values with textContent for the same reason.
 *   · No network, no eval, no new permission. Everything is local to the tab.
 */
(function () {
  window.SYFS = window.SYFS || {};
  if (SYFS.docview) return;                       /* injected twice (detector + lazy batch) */

  var store = SYFS.store;
  var NS = 'syfdv';

  /* ===================== small helpers ===================== */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function on(node, ev, fn) { node.addEventListener(ev, fn); return node; }
  function copy(text) { try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (e) {} }

  /* URL scheme whitelist. Anything with a scheme we don't know is dropped rather
   * than "cleaned": a blacklist of javascript:/data: loses to the next encoding
   * trick, a whitelist does not. */
  function safeUrl(raw, allowMailto) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    /* Reject, never strip. "java\tscript:x" with the tab deleted is a working
     * javascript: URL again — a cleaner would hand the payload back. */
    if (!/^[\u0021-\u007E\u00A1-\uFFFF]+$/.test(s)) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (allowMailto && /^mailto:/i.test(s)) return s;
    if (/^[a-z][a-z0-9+.\-]*:/i.test(s)) return '';        /* any other scheme */
    return s;                                              /* #anchor, /path, ./rel */
  }

  /* ===================== Markdown → DOM ===================== */
  /* A pragmatic CommonMark subset: headings, fenced & indented code, blockquote,
   * ordered/unordered/task lists (nested), tables, hr, and the usual inline
   * marks. Deliberately NOT supported: raw HTML (escaped), footnotes, reference
   * links — a viewer that silently renders half a construct is worse than one
   * that shows it verbatim. */

  var INLINE_RE = new RegExp([
    '(`+)([\\s\\S]*?)\\1',                       /* 1,2  code span */
    '!\\[([^\\]]*)\\]\\(([^()\\s]+)[^)]*\\)',    /* 3,4  image */
    '\\[([^\\]]*)\\]\\(([^()\\s]+)[^)]*\\)',     /* 5,6  link */
    /* ⚠️ المرجع الخلفي رقمه عالميّ في التعبير كلّه لا داخل بديله: `\1` هنا كانت تعني
       شرطات الكود (المجموعة 1) لا المحدّد الذي التُقط للتوّ، ومرجعٌ لم يُلتقَط يطابق
       النصّ الفارغ ⇒ لا يُشترط محدّد إغلاق والجسم الكسول يبتلع محرفاً واحداً
       (`**bold**` كانت تُرسَم <strong>b</strong>old). كل بديل يشير إلى مجموعته هو. */
    '(\\*\\*|__)([\\s\\S]+?)\\7',                /* 7,8  strong */
    '(\\*|_)([^\\s][\\s\\S]*?)\\9',              /* 9,10 em */
    '~~([\\s\\S]+?)~~',                          /* 11   strike */
    '<((?:https?:\\/\\/|mailto:)[^>\\s]+)>',     /* 12   autolink */
    '(https?:\\/\\/[^\\s<>()\\[\\]"\'`]+)'       /* 13   bare url */
  ].join('|'), 'g');

  function linkNode(href, label) {
    var u = safeUrl(href, true);
    if (!u) return document.createTextNode(label);          /* blocked scheme → plain text */
    var a = el('a', null, label);
    a.href = u;
    a.rel = 'noopener noreferrer nofollow';
    if (/^https?:/i.test(u)) a.target = '_blank';
    return a;
  }

  function inlineFrag(text) {
    /* ⛔ a LOCAL copy, never the shared INLINE_RE: bold/em/link/strike recurse into
       inlineFrag, and the inner loop ends by resetting a shared regex's lastIndex to 0 —
       the outer loop then re-finds the same match forever (any **bold** froze the tab). */
    var re = new RegExp(INLINE_RE.source, 'g');
    var frag = document.createDocumentFragment(), last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      last = re.lastIndex;
      if (m[2] != null) {
        frag.appendChild(el('code', NS + '-code', m[2].replace(/^ | $/g, '')));
      } else if (m[4] != null) {
        var src = safeUrl(m[4], false);
        if (src) {
          var img = el('img'); img.src = src; img.alt = m[3] || ''; img.loading = 'lazy';
          frag.appendChild(img);
        } else {
          frag.appendChild(document.createTextNode(m[3] || ''));
        }
      } else if (m[6] != null) {
        var a = linkNode(m[6], '');
        /* i18n-dyn: the document's own link text — user content, never a msgid */
        if (a.nodeType === 1) a.appendChild(inlineFrag(m[5] || m[6])); else a.textContent = m[5] || m[6];
        frag.appendChild(a);
      } else if (m[8] != null) {
        var st = el('strong'); st.appendChild(inlineFrag(m[8])); frag.appendChild(st);
      } else if (m[10] != null) {
        var em = el('em'); em.appendChild(inlineFrag(m[10])); frag.appendChild(em);
      } else if (m[11] != null) {
        var dl = el('del'); dl.appendChild(inlineFrag(m[11])); frag.appendChild(dl);
      } else if (m[12] != null) {
        frag.appendChild(linkNode(m[12], m[12].replace(/^mailto:/i, '')));
      } else if (m[13] != null) {
        frag.appendChild(linkNode(m[13], m[13]));
      }
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }

  /* soft line breaks: "two spaces + newline" is an explicit <br>, a lone newline
   * is just a space (CommonMark) */
  function paraFrag(text) {
    var frag = document.createDocumentFragment();
    var parts = text.split(/  \n|\\\n/);
    parts.forEach(function (p, i) {
      if (i) frag.appendChild(el('br'));
      frag.appendChild(inlineFrag(p.replace(/\n/g, ' ')));
    });
    return frag;
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^0-9a-z؀-ۿ]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  }

  /* returns { node: <div>, toc: [{level, text, id}] } */
  function mdToDom(src) {
    var out = el('div', NS + '-md'), toc = [];
    var lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    var i = 0, seen = {};

    function listIndent(s) { var m = s.match(/^\s*/)[0]; return m.replace(/\t/g, '    ').length; }
    function bulletOf(s) { return s.match(/^\s*([-*+]|\d{1,9}[.)])\s+/); }

    /* one list level; consumes lines while they belong to it or deeper */
    function readList(baseIndent) {
      var first = bulletOf(lines[i]);
      var ordered = /\d/.test(first[1]);
      var list = el(ordered ? 'ol' : 'ul');
      if (ordered) {
        var start = parseInt(first[1], 10);
        if (start > 1) list.start = start;
      }
      while (i < lines.length) {
        var line = lines[i];
        if (!line.trim()) {                       /* blank line: keep going only if the list continues */
          var j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j >= lines.length || !bulletOf(lines[j]) || listIndent(lines[j]) < baseIndent) break;
          i = j; continue;
        }
        var b = bulletOf(line), ind = listIndent(line);
        if (!b || ind < baseIndent) break;
        if (ind > baseIndent + 1) {               /* deeper → nest under the last item */
          var nested = readList(ind);
          if (list.lastElementChild) list.lastElementChild.appendChild(nested); else list.appendChild(nested);
          continue;
        }
        if (/\d/.test(b[1]) !== ordered) break;   /* a different marker starts a new list */
        var li = el('li'), rest = line.slice(b[0].length);
        var task = rest.match(/^\[([ xX])\]\s+/);
        if (task) {
          li.className = NS + '-task';
          var box = el('input'); box.type = 'checkbox'; box.disabled = true;
          box.checked = task[1] !== ' ';
          li.appendChild(box);
          rest = rest.slice(task[0].length);
        }
        var text = [rest];
        i++;
        /* lazy continuation: indented, non-bullet lines belong to this item */
        while (i < lines.length && lines[i].trim() && !bulletOf(lines[i]) && listIndent(lines[i]) > baseIndent) {
          text.push(lines[i].trim()); i++;
        }
        li.appendChild(paraFrag(text.join('\n')));
        list.appendChild(li);
      }
      return list;
    }

    function readTable() {
      var head = lines[i].trim(), align = lines[i + 1].trim();
      var cells = function (row) {
        return row.replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); });
      };
      var aligns = cells(align).map(function (a) {
        if (/^:-+:$/.test(a)) return 'center';
        if (/^-+:$/.test(a)) return 'left';       /* the doc is RTL: ":-" reads as "end" */
        if (/^:-+$/.test(a)) return 'right';
        return '';
      });
      var table = el('table', NS + '-tbl'), thead = el('thead'), tr = el('tr');
      cells(head).forEach(function (c, n) {
        var th = el('th'); if (aligns[n]) th.style.textAlign = aligns[n];
        th.appendChild(inlineFrag(c)); tr.appendChild(th);
      });
      thead.appendChild(tr); table.appendChild(thead);
      var tbody = el('tbody');
      i += 2;
      while (i < lines.length && lines[i].indexOf('|') >= 0 && lines[i].trim()) {
        var r = el('tr');
        cells(lines[i].trim()).forEach(function (c, n) {
          var td = el('td'); if (aligns[n]) td.style.textAlign = aligns[n];
          td.appendChild(inlineFrag(c)); r.appendChild(td);
        });
        tbody.appendChild(r); i++;
      }
      table.appendChild(tbody);
      return table;
    }

    while (i < lines.length) {
      var line = lines[i];

      if (!line.trim()) { i++; continue; }

      /* fenced code */
      var fence = line.match(/^\s*(```+|~~~+)\s*([A-Za-z0-9_+\-#.]*)/);
      if (fence) {
        var mark = fence[1][0], buf = [];
        i++;
        while (i < lines.length && !new RegExp('^\\s*' + (mark === '`' ? '```' : '~~~')).test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        var pre = el('pre', NS + '-pre'), code = el('code', null, buf.join('\n'));
        if (fence[2]) {
          var tag = el('span', NS + '-lang', fence[2]);
          pre.appendChild(tag);
        }
        pre.appendChild(code);
        var cbtn = on(el('button', NS + '-copybtn', 'نسخ'), 'click', function (txt) {
          return function (e) { e.preventDefault(); copy(txt); e.target.textContent = SYFS.t('تم'); setTimeout(function () { e.target.textContent = SYFS.t('نسخ'); }, 1200); };
        }(buf.join('\n')));
        pre.appendChild(cbtn);
        out.appendChild(pre);
        continue;
      }

      /* indented code (4 spaces / tab) */
      if (/^(\t| {4})/.test(line)) {
        var ibuf = [];
        while (i < lines.length && (/^(\t| {4})/.test(lines[i]) || !lines[i].trim())) {
          ibuf.push(lines[i].replace(/^(\t| {4})/, '')); i++;
        }
        while (ibuf.length && !ibuf[ibuf.length - 1].trim()) ibuf.pop();
        var p2 = el('pre', NS + '-pre'); p2.appendChild(el('code', null, ibuf.join('\n')));
        out.appendChild(p2);
        continue;
      }

      /* setext heading (=== / ---) */
      if (i + 1 < lines.length && /^\s*(=+|-{2,})\s*$/.test(lines[i + 1]) && line.trim() && !bulletOf(line)) {
        var lvl = lines[i + 1].trim()[0] === '=' ? 1 : 2;
        out.appendChild(heading(lvl, line.trim()));
        i += 2; continue;
      }

      /* atx heading */
      var hm = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (hm) { out.appendChild(heading(hm[1].length, hm[2])); i++; continue; }

      /* hr */
      if (/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line)) { out.appendChild(el('hr')); i++; continue; }

      /* blockquote — collect the run, strip one level of "> ", recurse */
      if (/^\s{0,3}>/.test(line)) {
        var qbuf = [];
        while (i < lines.length && (/^\s{0,3}>/.test(lines[i]) || (lines[i].trim() && qbuf.length))) {
          qbuf.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i++;
        }
        var bq = el('blockquote', NS + '-quote');
        bq.appendChild(mdToDom(qbuf.join('\n')).node);
        out.appendChild(bq);
        continue;
      }

      /* table: header row + alignment row */
      if (line.indexOf('|') >= 0 && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
        out.appendChild(readTable());
        continue;
      }

      /* list */
      if (bulletOf(line)) { out.appendChild(readList(listIndent(line))); continue; }

      /* paragraph */
      var pbuf = [];
      while (i < lines.length && lines[i].trim() && !bulletOf(lines[i]) &&
             !/^\s{0,3}(#{1,6}\s|>|```|~~~)/.test(lines[i]) && !/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(lines[i])) {
        pbuf.push(lines[i]); i++;
      }
      if (!pbuf.length) { i++; continue; }
      var p = el('p');
      p.appendChild(paraFrag(pbuf.join('\n')));
      out.appendChild(p);
    }

    function heading(level, text) {
      var hEl = el('h' + level);
      hEl.appendChild(inlineFrag(text));
      var id = slug(hEl.textContent) || ('h' + toc.length);
      if (seen[id]) { seen[id]++; id = id + '-' + seen[id]; } else { seen[id] = 1; }
      hEl.id = id;
      toc.push({ level: level, text: hEl.textContent, id: id });
      return hEl;
    }

    return { node: out, toc: toc };
  }

  /* ===================== JSON → collapsible tree ===================== */
  var CHUNK = 100;                                 /* children rendered per "more" click */

  function typeOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }
  function preview(v) {
    var t = typeOf(v);
    if (t === 'array') return '[' + v.length + ']';
    if (t === 'object') return '{' + Object.keys(v).length + '}';
    return '';
  }

  function valueNode(v) {
    var t = typeOf(v);
    if (t === 'string') {
      var u = safeUrl(v, false);
      if (/^https?:\/\//i.test(u)) {
        var a = el('a', NS + '-jstr', JSON.stringify(v));
        a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow';
        return a;
      }
      return el('span', NS + '-jstr', JSON.stringify(v));
    }
    if (t === 'number') return el('span', NS + '-jnum', String(v));
    if (t === 'boolean') return el('span', NS + '-jbool', String(v));
    if (t === 'null') return el('span', NS + '-jnull', 'null');
    return el('span', NS + '-jpun', preview(v));
  }

  /* one row: [toggle] key: value  — children are built only when opened */
  function jsonRow(key, value, path, depth, openDepth) {
    var row = el('div', NS + '-jrow');
    var head = el('div', NS + '-jhead');
    var t = typeOf(value), branch = (t === 'object' || t === 'array');
    var kids = null, built = false, shown = 0;

    var tw = el('span', NS + '-jtw', branch ? '▾' : '');
    head.appendChild(tw);

    if (key != null) {
      head.appendChild(el('span', NS + '-jkey', typeof key === 'number' ? String(key) : JSON.stringify(key)));
      head.appendChild(el('span', NS + '-jpun', ': '));
    }
    if (branch) {
      var count = t === 'array' ? value.length : Object.keys(value).length;
      head.appendChild(el('span', NS + '-jbr', t === 'array' ? '[' : '{'));
      head.appendChild(el('span', NS + '-jcount', ' ' + count + ' ' + (t === 'array' ? 'عنصر' : 'مفتاح') + ' '));
      head.appendChild(el('span', NS + '-jbr', t === 'array' ? ']' : '}'));
    } else {
      head.appendChild(valueNode(value));
    }

    var tools = el('span', NS + '-jtools');
    tools.appendChild(on(el('button', NS + '-jbtn', 'المسار'), 'click', function (e) { e.stopPropagation(); copy(path); flash(e.target); }));
    tools.appendChild(on(el('button', NS + '-jbtn', 'القيمة'), 'click', function (e) {
      e.stopPropagation(); copy(typeof value === 'string' ? value : JSON.stringify(value, null, 2)); flash(e.target);
    }));
    head.appendChild(tools);
    row.appendChild(head);

    function flash(b) { var o = b.textContent; b.textContent = SYFS.t('تم'); setTimeout(function () { b.textContent = o; }, 1000); }

    function build() {
      if (built) return;
      built = true;
      kids = el('div', NS + '-jkids');
      row.appendChild(kids);
      more();
    }
    function more() {
      var keys = t === 'array' ? null : Object.keys(value);
      var total = t === 'array' ? value.length : keys.length;
      var end = Math.min(total, shown + CHUNK);
      for (var n = shown; n < end; n++) {
        var k = t === 'array' ? n : keys[n];
        var childPath = path + (t === 'array' ? '[' + n + ']' : (/^[A-Za-z_$][\w$]*$/.test(k) ? '.' + k : '[' + JSON.stringify(k) + ']'));
        kids.appendChild(jsonRow(k, value[k], childPath, depth + 1, openDepth));
      }
      shown = end;
      var old = kids.querySelector('.' + NS + '-jmore');
      if (old) old.remove();
      if (shown < total) {
        kids.appendChild(on(el('button', NS + '-jmore', 'عرض ' + Math.min(CHUNK, total - shown) + ' إضافية من ' + (total - shown)), 'click', function (e) {
          e.stopPropagation(); more();
        }));
      }
    }
    function setOpen(open) {
      if (!branch) return;
      if (open) { build(); row.classList.remove(NS + '-closed'); tw.textContent = '▾'; }
      else { row.classList.add(NS + '-closed'); tw.textContent = '▸'; }
    }
    if (branch) {
      on(head, 'click', function (e) {
        if (e.target.closest('button') || e.target.closest('a')) return;
        setOpen(row.classList.contains(NS + '-closed'));
      });
      setOpen(depth < openDepth);
      row.__syfSetOpen = setOpen;
    }
    return row;
  }

  function jsonTree(data, openDepth) {
    var wrap = el('div', NS + '-jtree');
    wrap.appendChild(jsonRow(null, data, '$', 0, openDepth == null ? 2 : openDepth));
    return wrap;
  }

  /* ===================== stylesheet ===================== */
  function css() {
    return [
      '.' + NS + '-app{--a:#457364;--a2:#325348;--ink:#16202b;--mut:#64748b;--bg:#fff;--soft:#f5f7fa;--line:#e4e9f0;',
      '  position:relative;z-index:1;background:var(--bg);color:var(--ink);min-height:100vh;',
      '  font-family:var(--syfs-font,"Segoe UI",system-ui,-apple-system,sans-serif);direction:rtl;text-align:right}',
      '.' + NS + '-bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:8px;flex-wrap:wrap;',
      '  padding:8px 14px;background:rgba(255,255,255,.92);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);',
      '  box-shadow:0 1px 0 var(--line),0 4px 14px rgba(15,23,42,.05)}',
      '.' + NS + '-brand{display:flex;align-items:center;gap:7px;font-weight:800;font-size:12.5px;color:var(--a)}',
      '.' + NS + '-brand b{background:var(--a);color:#fff;border-radius:7px;padding:2px 7px;font-size:11px}',
      '.' + NS + '-sp{flex:1}',
      '.' + NS + '-btn{border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:9px;',
      '  padding:5px 11px;font:inherit;font-size:12px;font-weight:700;cursor:pointer;transition:.14s}',
      '.' + NS + '-btn:hover{border-color:var(--a);color:var(--a)}',
      '.' + NS + '-btn.on{background:var(--a);border-color:var(--a);color:#fff}',
      '.' + NS + '-find{border:1px solid var(--line);border-radius:9px;padding:5px 10px;font:inherit;font-size:12px;min-width:150px}',
      '.' + NS + '-find:focus{outline:none;border-color:var(--a);box-shadow:0 0 0 3px rgba(69,115,100,.14)}',
      '.' + NS + '-wrap{display:grid;grid-template-columns:1fr;gap:0;max-width:1100px;margin:0 auto;padding:22px 20px 60px}',
      '.' + NS + '-wrap.has-toc{grid-template-columns:1fr 232px;gap:26px;max-width:1220px}',
      '.' + NS + '-toc{position:sticky;top:60px;align-self:start;max-height:80vh;overflow:auto;',
      '  border-inline-start:1px solid var(--line);padding-inline-start:12px;font-size:12.5px}',
      '.' + NS + '-toc a{display:block;color:var(--mut);text-decoration:none;padding:3px 0;line-height:1.5}',
      '.' + NS + '-toc a:hover{color:var(--a)}',
      '.' + NS + '-toc a.l3{padding-inline-start:12px;font-size:12px}',
      '.' + NS + '-toc a.l4,.' + NS + '-toc a.l5,.' + NS + '-toc a.l6{padding-inline-start:24px;font-size:11.5px}',
      '.' + NS + '-raw{white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;',
      '  font-size:12.5px;line-height:1.7;direction:ltr;text-align:left;padding:16px;background:var(--soft);border-radius:12px}',
      /* markdown body */
      '.' + NS + '-md{font-size:15px;line-height:1.95;word-wrap:break-word}',
      '.' + NS + '-md h1,.' + NS + '-md h2,.' + NS + '-md h3,.' + NS + '-md h4,.' + NS + '-md h5,.' + NS + '-md h6{',
      '  line-height:1.4;margin:1.6em 0 .6em;font-weight:800;color:#0f172a}',
      '.' + NS + '-md h1{font-size:1.9em;padding-bottom:.3em;box-shadow:inset 0 -1px 0 var(--line)}',
      '.' + NS + '-md h2{font-size:1.5em;padding-bottom:.28em;box-shadow:inset 0 -1px 0 var(--line)}',
      '.' + NS + '-md h3{font-size:1.25em}.' + NS + '-md h4{font-size:1.08em}',
      '.' + NS + '-md p{margin:0 0 1em}',
      '.' + NS + '-md a{color:var(--a);text-decoration:none;border-bottom:1px solid rgba(69,115,100,.32)}',
      '.' + NS + '-md a:hover{border-bottom-color:var(--a)}',
      '.' + NS + '-md img{max-width:100%;height:auto;border-radius:10px}',
      '.' + NS + '-md ul,.' + NS + '-md ol{margin:0 0 1em;padding-inline-start:1.6em}',
      '.' + NS + '-md li{margin:.25em 0}',
      '.' + NS + '-md li.' + NS + '-task{list-style:none;margin-inline-start:-1.4em}',
      '.' + NS + '-md li.' + NS + '-task input{margin-inline-end:7px;vertical-align:middle}',
      '.' + NS + '-code{background:var(--soft);border:1px solid var(--line);border-radius:6px;padding:.12em .38em;',
      '  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em;direction:ltr;display:inline-block}',
      '.' + NS + '-pre{position:relative;background:#0f172a;color:#e2e8f0;border-radius:12px;padding:14px 16px;',
      '  overflow-x:auto;direction:ltr;text-align:left;margin:0 0 1.1em}',
      '.' + NS + '-pre code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.8px;line-height:1.75;white-space:pre}',
      '.' + NS + '-lang{position:absolute;top:8px;left:12px;font-size:10.5px;font-weight:700;color:#64748b;letter-spacing:.4px;text-transform:uppercase}',
      '.' + NS + '-copybtn{position:absolute;top:7px;right:10px;border:1px solid #263244;background:#182131;color:#cbd5e1;',
      '  border-radius:7px;padding:3px 9px;font:inherit;font-size:11px;font-weight:700;cursor:pointer;opacity:0;transition:.14s}',
      '.' + NS + '-pre:hover .' + NS + '-copybtn{opacity:1}',
      '.' + NS + '-copybtn:hover{color:#fff;border-color:#3b4a63}',
      '.' + NS + '-quote{margin:0 0 1em;padding:.1em 1em;border-inline-start:4px solid rgba(69,115,100,.4);color:var(--mut)}',
      '.' + NS + '-tbl{border-collapse:collapse;margin:0 0 1.2em;display:block;overflow-x:auto;max-width:100%}',
      '.' + NS + '-tbl th,.' + NS + '-tbl td{border:1px solid var(--line);padding:7px 11px;font-size:13.5px}',
      '.' + NS + '-tbl th{background:var(--soft);font-weight:800}',
      '.' + NS + '-tbl tbody tr:nth-child(2n){background:#fafbfd}',
      '.' + NS + '-md hr{border:none;height:1px;background:var(--line);margin:1.8em 0}',
      /* json tree */
      '.' + NS + '-jtree{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.75;',
      '  direction:ltr;text-align:left}',
      '.' + NS + '-jkids{padding-inline-start:17px;border-inline-start:1px solid var(--line);margin-inline-start:5px}',
      '.' + NS + '-jrow.' + NS + '-closed>.' + NS + '-jkids{display:none}',
      '.' + NS + '-jhead{display:flex;align-items:center;gap:2px;border-radius:6px;padding:0 4px;white-space:nowrap}',
      '.' + NS + '-jhead:hover{background:var(--soft)}',
      '.' + NS + '-jtw{width:13px;flex:0 0 auto;color:var(--mut);cursor:pointer;user-select:none;font-size:11px}',
      '.' + NS + '-jkey{color:#7c3aed;font-weight:700}',
      '.' + NS + '-jstr{color:#0f766e;white-space:pre-wrap;word-break:break-word}',
      'a.' + NS + '-jstr{text-decoration:underline}',
      '.' + NS + '-jnum{color:#b45309}.' + NS + '-jbool{color:#be123c}.' + NS + '-jnull{color:var(--mut)}',
      '.' + NS + '-jpun,.' + NS + '-jbr{color:var(--mut)}',
      '.' + NS + '-jcount{color:#94a3b8;font-size:11.5px}',
      '.' + NS + '-jtools{display:none;gap:4px;margin-inline-start:8px}',
      '.' + NS + '-jhead:hover .' + NS + '-jtools{display:inline-flex}',
      '.' + NS + '-jbtn{border:1px solid var(--line);background:var(--bg);color:var(--mut);border-radius:6px;',
      '  padding:0 7px;font:inherit;font-size:10.5px;font-weight:700;cursor:pointer}',
      '.' + NS + '-jbtn:hover{color:var(--a);border-color:var(--a)}',
      '.' + NS + '-jmore{display:block;margin:3px 0;border:1px dashed var(--line);background:var(--bg);color:var(--mut);',
      '  border-radius:7px;padding:3px 10px;font:inherit;font-size:11.5px;font-weight:700;cursor:pointer}',
      '.' + NS + '-jmore:hover{color:var(--a);border-color:var(--a)}',
      '.' + NS + '-hit{background:#fde68a;border-radius:3px}',
      '.' + NS + '-err{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:10px;padding:12px 14px;font-size:13px}',
      '@media (prefers-color-scheme: dark){',
      '.' + NS + '-app{--ink:#e5e7eb;--mut:#94a3b8;--bg:#0f141b;--soft:#161e28;--line:#243040}',
      '.' + NS + '-bar{background:rgba(15,20,27,.92)}',
      '.' + NS + '-md h1,.' + NS + '-md h2,.' + NS + '-md h3,.' + NS + '-md h4{color:#f1f5f9}',
      '.' + NS + '-tbl tbody tr:nth-child(2n){background:#131b24}',
      '.' + NS + '-jkey{color:#c4b5fd}.' + NS + '-jstr{color:#5eead4}.' + NS + '-jnum{color:#fcd34d}.' + NS + '-jbool{color:#fda4af}',
      '.' + NS + '-hit{background:#78350f;color:#fff}}'
    ].join('');
  }
  function ensureCss(doc) {
    doc = doc || document;
    if (doc.getElementById(NS + '-css')) return;
    var s = doc.createElement('style');
    s.id = NS + '-css';
    s.textContent = css();
    (doc.head || doc.documentElement).appendChild(s);
  }

  /* ===================== page takeover ===================== */
  /* The raw text of a plain-text document is the single <pre> Chrome generates. */
  function rawText() {
    var b = document.body;
    if (!b) return null;
    var pres = b.querySelectorAll('pre');
    if (pres.length === 1 && b.children.length <= 2) return pres[0].textContent;
    if (!b.children.length) return b.textContent;
    return null;
  }

  function looksJson(txt) {
    var s = txt.trim();
    if (!s || s.length > 40e6) return false;
    var c = s[0];
    if (c !== '{' && c !== '[') return false;
    try { JSON.parse(s); return true; } catch (e) { return false; }
  }

  function pageKind(txt) {
    var ct = String(document.contentType || '').toLowerCase();
    var path = ''; try { path = new URL(location.href).pathname.toLowerCase(); } catch (e) {}
    if (/\.(md|markdown|mdown|mkd|mdx)$/.test(path) && ct.indexOf('html') < 0) return 'md';
    if (ct.indexOf('json') >= 0 && looksJson(txt)) return 'json';
    if (looksJson(txt)) return 'json';
    return '';
  }

  function buildBar(kind, state) {
    var bar = el('div', NS + '-bar');
    var brand = el('div', NS + '-brand');
    brand.appendChild(el('b', null, 'SYF'));
    brand.appendChild(el('span', null, kind === 'md' ? 'عارض Markdown' : 'منسّق JSON'));
    bar.appendChild(brand);

    var fmt = on(el('button', NS + '-btn on', 'منسَّق'), 'click', function () { state.show('fmt'); });
    var raw = on(el('button', NS + '-btn', 'النص الخام'), 'click', function () { state.show('raw'); });
    bar.appendChild(fmt); bar.appendChild(raw);
    state.tabs = { fmt: fmt, raw: raw };

    if (kind === 'json') {
      bar.appendChild(on(el('button', NS + '-btn', 'فتح الكل'), 'click', function () { state.openAll(true); }));
      bar.appendChild(on(el('button', NS + '-btn', 'طيّ الكل'), 'click', function () { state.openAll(false); }));
      var find = el('input', NS + '-find'); find.type = 'search'; find.placeholder = SYFS.t('بحث في المفاتيح والقيم…');
      on(find, 'input', function () { state.find(find.value); });
      bar.appendChild(find);
    }
    bar.appendChild(el('div', NS + '-sp'));
    bar.appendChild(on(el('button', NS + '-btn', 'نسخ'), 'click', function () { copy(state.text); }));
    bar.appendChild(on(el('button', NS + '-btn', 'إيقاف التنسيق التلقائي'), 'click', function (e) {
      store.set(kind === 'md' ? 'docview_md' : 'docview_json', false);
      e.target.textContent = SYFS.t('أُوقف — حدّث الصفحة');
    }));
    return bar;
  }

  function render(kind, text) {
    ensureCss();
    var app = el('div', NS + '-app');
    var state = { text: text };
    var bar = buildBar(kind, state);
    var wrap = el('div', NS + '-wrap');
    var rawBox = el('pre', NS + '-raw', text);
    rawBox.style.display = 'none';
    var main = el('div');

    state.show = function (which) {
      var isRaw = which === 'raw';
      rawBox.style.display = isRaw ? '' : 'none';
      main.style.display = isRaw ? 'none' : '';
      state.tabs.fmt.classList.toggle('on', !isRaw);
      state.tabs.raw.classList.toggle('on', isRaw);
    };

    if (kind === 'md') {
      var r = mdToDom(text);
      main.appendChild(r.node);
      wrap.appendChild(main);
      if (r.toc.filter(function (t) { return t.level <= 3; }).length >= 3) {
        wrap.classList.add('has-toc');
        var toc = el('nav', NS + '-toc');
        toc.appendChild(el('div', null, 'المحتويات'));
        r.toc.forEach(function (t) {
          var a = el('a', 'l' + t.level, t.text);
          a.href = '#' + t.id;
          toc.appendChild(a);
        });
        wrap.appendChild(toc);
      }
      /* i18n-dyn: the document's first heading — the tab is named after the file */
      document.title = (r.toc[0] && r.toc[0].text) || document.title;
    } else {
      var data;
      try { data = JSON.parse(text); }
      catch (e) {
        main.appendChild(el('div', NS + '-err', 'تعذّر تحليل JSON: ' + e.message));
        main.appendChild(el('pre', NS + '-raw', text));
        wrap.appendChild(main);
        state.openAll = function () {}; state.find = function () {};
        mount();
        return;
      }
      var tree = jsonTree(data, 2);
      main.appendChild(tree);
      wrap.appendChild(main);
      state.openAll = function (open) {
        /* opening everything on a huge document is the user's explicit ask, so
         * it is allowed — but it builds rows lazily, level by level, so the tab
         * stays responsive instead of freezing on one giant synchronous pass. */
        var pass = function (root) {
          var rows = root.querySelectorAll('.' + NS + '-jrow');
          var did = false;
          rows.forEach(function (row) {
            if (!row.__syfSetOpen) return;
            var closed = row.classList.contains(NS + '-closed');
            if (open === !closed) return;
            row.__syfSetOpen(open); did = true;
          });
          if (did && open) setTimeout(function () { pass(root); }, 0);
        };
        pass(tree);
      };
      state.find = function (q) {
        tree.querySelectorAll('.' + NS + '-hit').forEach(function (n) { n.classList.remove(NS + '-hit'); });
        var s = String(q || '').trim().toLowerCase();
        if (s.length < 2) return;
        state.openAll(true);
        setTimeout(function () {
          var n = 0;
          tree.querySelectorAll('.' + NS + '-jkey,.' + NS + '-jstr,.' + NS + '-jnum,.' + NS + '-jbool').forEach(function (node) {
            if (node.textContent.toLowerCase().indexOf(s) >= 0) { node.classList.add(NS + '-hit'); if (!n++) node.scrollIntoView({ block: 'center' }); }
          });
        }, 60);
      };
    }

    wrap.insertBefore(rawBox, wrap.firstChild);
    function mount() {
      app.appendChild(bar);
      app.appendChild(wrap);
      /* keep the original document — "النص الخام" and any page script that reads
       * it still work; we only stop showing it */
      Array.prototype.slice.call(document.body.children).forEach(function (c) { c.style.display = 'none'; });
      document.body.appendChild(app);
      document.body.style.margin = '0';
      document.body.style.background = 'transparent';
    }
    mount();
  }

  function autoRun() {
    if (window.__syfDocViewRan) return;
    var txt = rawText();
    if (txt == null) return;
    var kind = pageKind(txt);
    if (!kind) return;
    window.__syfDocViewRan = 1;
    store.get(kind === 'md' ? 'docview_md' : 'docview_json', true).then(function (on) {
      if (on === false) return;
      try { render(kind, txt); } catch (e) { /* a broken document must not blank the tab */ }
    });
  }

  /* ===================== rail tool ===================== */
  var MD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M6.5 15.5v-7l3 3.6 3-3.6v7"/><path d="M16.5 8.5v5m0 0 2-2m-2 2-2-2"/></svg>';

  SYFS.tools = SYFS.tools || [];
  SYFS.tools.push({
    id: 'mdview', name: 'عارض Markdown', cat: 'docs', icon: MD_ICON,
    mount: function (body) {
      ensureCss();
      var win = body.closest ? body.closest('.syfs-win') : null;
      if (win && !win.style.width) win.style.width = '520px';

      var bar = el('div', NS + '-tbar');
      bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
      var pick = el('input'); pick.type = 'file'; pick.accept = '.md,.markdown,.mdown,.mkd,.txt,text/markdown';
      pick.style.display = 'none';
      var bOpen = on(el('button', 'syf-mini', 'فتح ملف .md'), 'click', function () { pick.click(); });
      var bEdit = on(el('button', 'syf-mini', 'تحرير'), 'click', function () { show('src'); });
      var bView = on(el('button', 'syf-mini', 'عرض'), 'click', function () { paint(); show('out'); });
      /* v0.118.0 — «حيّ»: editor and preview side by side, the preview repainting as
         you type. The same parser, the same node-building rules (§5.8/1): nothing new
         touches innerHTML. Exports: .md (the text), HTML (our own serialised tree —
         no document text is ever parsed as markup), and print → the browser's PDF. */
      var bLive = on(el('button', 'syf-btn', 'حيّ'), 'click', function () { paint(); show('live'); });
      var bCopy = on(el('button', 'syf-mini', 'نسخ HTML'), 'click', function () { paint(); copy(out.innerHTML); });
      var bMd = on(el('button', 'syf-mini', '⬇ .md'), 'click', function () { dl(new Blob([src.value], { type: 'text/markdown;charset=utf-8' }), 'document.md'); });
      var bHtml = on(el('button', 'syf-mini', '⬇ HTML'), 'click', function () {
        paint();
        var page = '<!doctype html><html dir="' + dirNow() + '"><head><meta charset="utf-8"><title>Markdown</title><style>body{font:16px/1.7 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 20px}pre{overflow:auto;background:#f4f4f4;padding:10px;border-radius:6px}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}</style></head><body>' + inner.innerHTML + '</body></html>';
        dl(new Blob([page], { type: 'text/html;charset=utf-8' }), 'document.html');
      });
      var bPrint = on(el('button', 'syf-mini', '🖨 طباعة / PDF'), 'click', function () {
        paint();
        var w = window.open('', '_blank');
        if (!w) return;
        var d = w.document;
        d.title = 'Markdown'; d.documentElement.dir = dirNow();
        d.body.style.cssText = 'font:16px/1.7 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 20px;color:#111';
        d.body.appendChild(d.importNode(inner, true));
        setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 400);
      });
      [bOpen, bEdit, bView, bLive, bCopy, bMd, bHtml, bPrint, pick].forEach(function (b) { bar.appendChild(b); });
      function dirNow() { return (SYFS.i18n && SYFS.i18n.dir) ? SYFS.i18n.dir() : 'rtl'; }
      function dl(blob, name) { var u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(u); }, 5000); }

      var split = el('div'); split.style.cssText = 'display:flex;gap:8px;align-items:stretch;min-height:260px';
      var src = el('textarea', 'syf-in');
      src.rows = 9; src.placeholder = SYFS.t('الصق نص Markdown هنا، أو افتح ملف .md…');
      src.style.cssText = 'direction:ltr;text-align:left;font-family:ui-monospace,Menlo,monospace;font-size:12px;flex:1;min-width:0';
      var out = el('div', NS + '-app');
      out.style.cssText = 'min-height:0;padding:4px 2px;background:transparent;flex:1;min-width:0;overflow:auto';
      var inner = el('div'); out.appendChild(inner);
      out.style.display = 'none';
      split.appendChild(src); split.appendChild(out);

      var mode = 'src', tmr = 0;
      function show(which) {
        mode = which;
        src.style.display = which === 'out' ? 'none' : '';
        out.style.display = which === 'src' ? 'none' : '';
        split.style.flexDirection = which === 'live' ? 'row' : 'column';
        if (which === 'live' && win) win.style.width = '820px';
      }
      function paint() {
        inner.textContent = '';
        try { inner.appendChild(mdToDom(src.value).node); }
        catch (e) { inner.appendChild(el('div', NS + '-err', 'تعذّر عرض المستند')); }
      }
      on(pick, 'change', function () {
        var f = pick.files && pick.files[0];
        if (!f) return;
        var fr = new FileReader();
        fr.onload = function () { src.value = String(fr.result || ''); paint(); show(mode === 'live' ? 'live' : 'out'); };
        fr.readAsText(f);
      });
      on(src, 'input', function () {
        if (mode === 'src') return;
        clearTimeout(tmr); tmr = setTimeout(paint, mode === 'live' ? 150 : 0);
      });

      body.appendChild(bar); body.appendChild(split);
    }
  });

  /* ===================== exports ===================== */
  SYFS.docview = { md: mdToDom, jsonTree: jsonTree, render: render, css: ensureCss };
  SYFS.mdToDom = mdToDom;

  autoRun();
}());
