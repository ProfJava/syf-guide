/* SYF — remaining tools (offline + API-via-background). Pushed into SYFS.tools.
 * Intervals self-clear when the tool window is removed (guard on body.isConnected). */
(function () {
  window.SYFS = window.SYFS || {};
  var store = SYFS.store, bgFetch = SYFS.bgFetch;
  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    /* the template's own text IS the msgid — translate the built tree rather than
       splitting the markup (see src/i18n.js). Free in the default language. */
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }
  function beep(dur, freq) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
      var o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination); o.type = 'sine'; o.frequency.value = freq || 880; g.gain.value = .12; o.start();
      setTimeout(function () { o.stop(); ac.close(); }, dur || 200);
    } catch (e) {}
  }
  function notify(title, body) {
    try {
      if (!window.Notification) return;
      if (Notification.permission === 'granted') new Notification(title, { body: body });
      else if (Notification.permission !== 'denied') Notification.requestPermission().then(function (p) { if (p === 'granted') new Notification(title, { body: body }); });
    } catch (e) {}
  }
  function every(body, ms, fn) { var iv = setInterval(function () { if (!body.isConnected) { clearInterval(iv); return; } fn(); }, ms); fn(); return iv; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  Object.assign(SYFS.cats, {
    time:  { label: 'الوقت',    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9.5V13l2.5 1.5"/><path d="m4.5 4.5 2.5 2M19.5 4.5 17 6.5"/></svg>' },
    /* A SOLID glyph among stroke-drawn siblings, on purpose — it is the user's own
     * artwork, imported verbatim from New Icons/crescent.svg. Its 512 viewBox is
     * kept as authored rather than refitted to 24: the CSS sizes the <svg> box, so
     * the viewBox only ever decides the internal scale, and rewriting the path to
     * 24 units would be a transcription risk for zero visual gain. */
    islam: { label: 'إسلامية',  icon: '<svg viewBox="0 0 512 512" fill="currentColor"><g transform="translate(0,512) scale(0.1,-0.1)"><path fill-rule="evenodd" d="M1985 4765 c-243 -72 -449 -166 -640 -293 -346 -230 -599 -518 -780 -887 -111 -226 -173 -423 -211 -665 -26 -161 -26 -519 0 -680 62 -399 225 -769 473 -1078 565 -704 1511 -1005 2376 -756 249 72 507 198 719 354 122 90 315 273 405 385 198 246 349 539 428 828 15 54 25 101 22 103 -2 2 -17 -15 -32 -38 -170 -258 -480 -521 -788 -668 -536 -255 -1141 -250 -1674 14 -552 274 -930 762 -1059 1368 -35 168 -45 475 -20 648 62 420 256 806 562 1114 78 78 230 207 304 258 35 24 11 22 -85 -7z M2858 4451 c-120 -39 -226 -133 -281 -249 -26 -56 -32 -82 -35 -160 -5 -116 15 -198 68 -280 155 -240 484 -283 695 -91 50 46 102 115 94 124 -2 2 -29 -3 -59 -11 -75 -19 -136 -18 -213 6 -130 40 -220 128 -259 254 -40 132 0 281 104 379 l50 47 -53 -1 c-30 0 -80 -8 -111 -18z M2910 3260 l0 -180 85 0 85 0 0 180 0 180 -85 0 -85 0 0 -180z M2895 2956 c-128 -31 -242 -124 -297 -241 -26 -57 -49 -145 -37 -145 3 0 47 11 100 24 245 62 532 55 737 -18 l44 -16 -7 43 c-3 23 -22 75 -41 114 -91 188 -299 288 -499 239z M2830 2453 c-361 -58 -668 -270 -844 -581 l-35 -62 77 -62 c220 -175 483 -298 767 -358 130 -27 411 -38 551 -20 134 16 299 59 428 111 119 47 304 146 319 170 14 22 -38 151 -103 256 -169 275 -446 468 -765 534 -84 18 -318 25 -395 12z"/></g></svg>' }
    /* 'نصوص' (text) merged into the 'ملاحظات ونصوص' (note) category — translate/voice now cat 'note'. */
  });

  /* ---------- degree trig helpers (for prayer times) ---------- */
  var D = Math.PI / 180;
  function dsin(x){return Math.sin(x*D);} function dcos(x){return Math.cos(x*D);} function dtan(x){return Math.tan(x*D);}
  function dasin(x){return Math.asin(x)/D;} function dacos(x){return Math.acos(x)/D;} function datan2(y,x){return Math.atan2(y,x)/D;} function dacot(x){return Math.atan(1/x)/D;}
  function fixh(a){a=a-24*Math.floor(a/24);return a<0?a+24:a;}
  function julian(y,m,d){ if(m<=2){y-=1;m+=12;} var a=Math.floor(y/100),b=2-a+Math.floor(a/4); return Math.floor(365.25*(y+4716))+Math.floor(30.6001*(m+1))+d+b-1524.5; }
  function sunPos(jd){ var dd=jd-2451545,g=fixDeg(357.529+0.98560028*dd),q=fixDeg(280.459+0.98564736*dd),L=fixDeg(q+1.915*dsin(g)+0.020*dsin(2*g)),e=23.439-0.00000036*dd,decl=dasin(dsin(e)*dsin(L)),RA=fixDeg(datan2(dcos(e)*dsin(L),dcos(L)))/15,EqT=q/15-RA; return {decl:decl,EqT:EqT}; }
  function fixDeg(a){a=a-360*Math.floor(a/360);return a<0?a+360:a;}
  /* UTC offset in hours of an IANA `zone` on `date`'s day (noon, clear of a DST switch).
     ⚠️ Cities carry a ZONE, not a fixed offset (v0.139.1): Cairo was `2` and Egypt has
     observed DST again since 2023, so its times were an hour early all summer. Same
     helper as `ikTzOff` in background.js. Unknown zone ⇒ null. */
  function tzOff(zone, date) {
    if (typeof zone === 'number') return zone;
    try {
      var noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
      var p = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(noon);
      var tn = ''; p.forEach(function (x) { if (x.type === 'timeZoneName') tn = x.value; });
      var m = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(tn);
      if (!m) return null;
      return m[1] ? (m[1] === '-' ? -1 : 1) * (+m[2] + (+m[3] || 0) / 60) : 0;
    } catch (e) { return null; }
  }
  /* The city's own calendar day (at device-local noon, the shape prayerTimes reads) and
     its clock hour, both through Intl in the city's zone. The device clock was used
     before: a device in New York at 20:00 looking at Riyadh had now = 27, no row was
     «next», and the times printed were for the device's day — yesterday in Riyadh.
     Unknown zone ⇒ the device clock (tzOff falls back the same way). */
  function cityNow(zone, now) {
    try {
      var o = {};
      new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
        .formatToParts(now).forEach(function (p) { o[p.type] = parseInt(p.value, 10); });
      if (o.year > 0) return { day: new Date(o.year, o.month - 1, o.day, 12), h: o.hour + o.minute / 60 + o.second / 3600 };
    } catch (e) {}
    return { day: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12), h: now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600 };
  }
  /* the Umm al-Qura month of a civil day (9 = رمضان), or 0 when Intl has no such
     calendar — same helper as `ikHijriMonth` in background.js. Not SYFS._occ.occHijri:
     mail/sheet/slides/word load this file and the prayer tool without occasions.js. */
  var hijriFmt = null;
  function hijriMonth(date) {
    try {
      if (!hijriFmt) hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { month: 'numeric' });
      var m = 0;
      hijriFmt.formatToParts(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)).forEach(function (p) { if (p.type === 'month') m = parseInt(p.value, 10) || 0; });
      return m;
    } catch (e) { return 0; }
  }
  /* `method`: 'umq' (Umm al-Qura — fajr 18.5°, isha a fixed 90 min after maghrib and 120
     in رمضان, as the official calendar prints it) or 'egypt' (Egyptian General Authority
     of Survey — fajr 19.5°, isha 17.5°). Same rule as `ikPrayerTimes` in background.js. */
  function prayerTimes(date, lat, lng, tz, method) {
    var jd = julian(date.getFullYear(), date.getMonth() + 1, date.getDate()) - lng / (15 * 24);
    var sp = sunPos(jd), decl = sp.decl, eqt = sp.EqT;
    var dhuhr = fixh(12 + tz - lng / 15 - eqt);
    /* NaN, not a garbage angle, when the sun never reaches `alpha` that day (acos of |c| > 1) */
    function ang(alpha) { var c = (-dsin(alpha) - dsin(decl) * dsin(lat)) / (dcos(decl) * dcos(lat)); return (c >= -1 && c <= 1) ? dacos(c) / 15 : NaN; }
    function asrAng() { var alt = -dacot(1 + dtan(Math.abs(lat - decl))); return ang(alt); }
    var sunrise = dhuhr - ang(0.833), maghrib = dhuhr + ang(0.833), asr = dhuhr + asrAng();
    /* high-latitude rule (angle-based, as PrayTimes.js): above ~48° in summer the sun never
       sinks to 18°, and the row read «NaN». Then the twilight is that angle's share of the night. */
    var night = 24 - (maghrib - sunrise);
    function twi(a, sign) { var x = ang(a); return isFinite(x) ? dhuhr + sign * x : (sign < 0 ? sunrise - night * a / 60 : maghrib + night * a / 60); }
    var egypt = method === 'egypt';
    var fajr = twi(egypt ? 19.5 : 18.5, -1);
    var isha = egypt ? twi(17.5, 1) : maghrib + (hijriMonth(date) === 9 ? 2 : 1.5);
    /* AM/PM comes from the panel's locale, not a literal 'ص'/'م' — 'ص' is also the msgid
       of the surah Sad, so the dictionary could never have translated it.
       Rounded EXACTLY as the worker's notification text: `ikWhen` rounds the hours to ms,
       `ikClockOf` rounds ms to the nearest minute. The old `floor(t + 30 s)` fell a minute
       short on a half-minute tie, so the panel said 2:25 and the alert 2:26. */
    function fmt(t){ var m=Math.round(Math.round(fixh(t)*3600000)/60000)%1440,hh=Math.floor(m/60),mm=m%60,H=hh%12||12;
      try{ return new Date(2000,0,1,hh,mm).toLocaleTimeString(SYFS.i18n.locale()+'-u-nu-latn',{hour:'numeric',minute:'2-digit',hour12:true}); }
      catch(e){ return hh<12 ? SYFS.t('{0}:{1} صباحاً',H,pad(mm)) : SYFS.t('{0}:{1} مساءً',H,pad(mm)); } }
    return { 'الفجر':fajr, 'الشروق':sunrise, 'الظهر':dhuhr, 'العصر':asr, 'المغرب':maghrib, 'العشاء':isha, _fmt:fmt, _raw:{fajr:fajr,sunrise:sunrise,dhuhr:dhuhr,asr:asr,maghrib:maghrib,isha:isha} };
  }

  /* ---------- Sticky notes module (mounted into the shadow overlay, not a window) ---------- */
  var STICKY_COLORS = ['#fff7b0', '#ffd1dc', '#cfe8ff', '#c9f7d4', '#ffe0b3', '#e6d9ff'];
  var stickyNotes = [];
  function stickySave() { store.set('sticky_notes', stickyNotes); }
  function suid() { return 's' + Date.now() + Math.floor(Math.random() * 1000); }
  function buildSticky(n) {
    var el = h('<div class="syfs-sticky"><div class="syfs-sticky-head"><div class="syfs-sticky-colors"></div><button class="syfs-sticky-x" title="حذف">&times;</button></div><textarea placeholder="اكتب…"></textarea></div>');
    el.style.background = n.color; el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
    var cols = el.querySelector('.syfs-sticky-colors');
    STICKY_COLORS.forEach(function (c) { var sp = document.createElement('span'); sp.style.background = c; sp.addEventListener('click', function () { n.color = c; el.style.background = c; stickySave(); }); cols.appendChild(sp); });
    var ta = el.querySelector('textarea'); ta.value = n.text || ''; ta.addEventListener('input', function () { n.text = ta.value; stickySave(); });
    el.querySelector('.syfs-sticky-x').addEventListener('click', function () { stickyNotes = stickyNotes.filter(function (z) { return z.id !== n.id; }); stickySave(); el.remove(); });
    var head = el.querySelector('.syfs-sticky-head'), drag = false, sx = 0, sy = 0, ox = 0, oy = 0;
    head.addEventListener('pointerdown', function (e) { if (e.target.closest('.syfs-sticky-colors') || e.target.closest('.syfs-sticky-x')) return; drag = true; ox = el.offsetLeft; oy = el.offsetTop; sx = e.clientX; sy = e.clientY; el.style.zIndex = SYFS.topZ(); try { head.setPointerCapture(e.pointerId); } catch (_) {} });
    head.addEventListener('pointermove', function (e) { if (!drag) return; el.style.left = Math.max(0, Math.min(window.innerWidth - 60, ox + e.clientX - sx)) + 'px'; el.style.top = Math.max(0, Math.min(window.innerHeight - 30, oy + e.clientY - sy)) + 'px'; });
    function end(e) { if (!drag) return; drag = false; n.x = el.offsetLeft; n.y = el.offsetTop; stickySave(); try { head.releasePointerCapture(e.pointerId); } catch (_) {} }
    head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
    SYFS.mountEl(el);
  }
  function addSticky(initialText) { var k = stickyNotes.length; var n = { id: suid(), text: (typeof initialText === 'string' ? initialText : ''), color: STICKY_COLORS[k % 6], x: Math.round(window.innerWidth / 2 - 106 + (k % 5) * 18), y: Math.round(120 + (k % 5) * 18) }; stickyNotes.push(n); stickySave(); buildSticky(n); }
  /* sticky is no longer a standalone tool — it's reachable from the "ملاحظات" tool's
   * pin button (SYFS.addSticky) and restored on load via the shared boot hook. */
  SYFS.addSticky = addSticky;
  SYFS.boots = SYFS.boots || [];
  SYFS.boots.push(function () { store.get('sticky_notes', []).then(function (v) { stickyNotes = Array.isArray(v) ? v : []; stickyNotes.forEach(buildSticky); }); });

  /* ---------- Quick links: social / communication shortcuts (employee) ---------- */
  SYFS.cats.links = { label: 'روابط', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1"/></svg>' };
  function openUrl(u){ try{ window.open(u,'_blank','noopener'); }catch(e){} }
  function badge(c,t,fs){ return '<svg viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="'+c+'"/><text x="12" y="16.5" font-size="'+(fs||12)+'" font-family="Arial,Helvetica,sans-serif" font-weight="bold" fill="#fff" text-anchor="middle">'+t+'</text></svg>'; }
  function lnk(id,name,url,icon,cat){ return { id:'lnk-'+id, name:name, cat:cat||'links', icon:icon, action:function(){ openUrl(url); } }; }
  var LINKS = [
    lnk('gmail','Gmail','https://mail.google.com/', badge('#EA4335','M')),
    lnk('outlook','Outlook','https://outlook.office.com/mail/', badge('#0078D4','O')),
    /* ⛔ `lnk-whatsapp` was deleted in v0.112.0. It opened web.whatsapp.com in a tab and
       sat DIRECTLY beside `waweb`, which opens the same site in an in-page frame — two
       adjacent icons on one shelf for one destination, and the difference between them
       is invisible from the icons. `waweb` is the one kept: it is the behaviour you
       cannot get from a bookmark. Do not re-add this line. */
    lnk('teams','Microsoft Teams','https://teams.microsoft.com/', badge('#6264A7','T')),
    lnk('facebook','Facebook','https://www.facebook.com/', badge('#1877F2','f')),
    lnk('youtube','YouTube','https://www.youtube.com/', badge('#FF0000','▶',10)),
    lnk('drive','Google Drive','https://drive.google.com/', badge('#1FA463','D')),
    lnk('calendar','Google Calendar','https://calendar.google.com/', badge('#4285F4','C')),
    lnk('telegram','Telegram','https://web.telegram.org/', badge('#229ED9','✈',11)),
    lnk('linkedin','LinkedIn','https://www.linkedin.com/', badge('#0A66C2','in',9)),
    lnk('x','X (Twitter)','https://x.com/', badge('#111111','X')),
    lnk('google','بحث Google','https://www.google.com/', badge('#4285F4','G')),
    /* custom links manager — add any other site */
    {
      id:'lnk-custom', name:'روابط مخصّصة', cat:'links',
      icon: badge('#5b6b7d','+',16),
      mount:function(body){
        body.appendChild(h('<div class="syf-form"><div class="syf-row"><input class="syf-in" id="lc-n" placeholder="الاسم"><input class="syf-in" id="lc-u" placeholder="https://"></div><button class="syf-btn" id="lc-add">إضافة رابط</button><div class="syf-note-list" id="lc-list"></div></div>'));
        var n=body.querySelector('#lc-n'),u=body.querySelector('#lc-u'),list=body.querySelector('#lc-list');var items=[];
        function safeUrl(x){ x=(x||'').trim(); if(!x)return ''; if(/^https?:\/\//i.test(x))return x; if(/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(x))return 'https://'+x; return ''; } /* reject javascript: etc. */
        /* ⛔ الفحص عند القراءة أيضاً لا عند الكتابة وحدها: `safeUrl` يحرس الحقل، لكن
           `custom_links` يصل التخزين بطريق ثانٍ — «استيراد» الإعدادات يقبل أي كائن
           JSON ⇒ عنوان `javascript:`/`data:` مدسوس يبلغ `window.open` بلا أن يمرّ
           بالحقل قطّ. قائمة بيضاء ترفض ولا تنظّف: حذف محرف تحكّم من
           `java<TAB>script:` يعيد رابطاً عاملاً (§5.8/3). */
        function openStored(x){ if(/^https?:\/\//i.test(String(x||'')))openUrl(x); }
        function render(){ list.innerHTML=''; if(!items.length){list.appendChild(h('<div class="syf-empty">لا روابط مخصّصة بعد.</div>'));} items.forEach(function(it,i){ var r=h('<div class="syf-note-row"><span class="t" style="cursor:pointer;color:var(--pri)"></span><button class="x">✕</button></div>'); r.querySelector('.t').textContent=it.n||it.u; r.querySelector('.t').addEventListener('click',function(){openStored(it.u);}); r.querySelector('.x').addEventListener('click',function(){items.splice(i,1);save();}); list.appendChild(r); }); }
        function save(){store.set('custom_links',items);render();}
        body.querySelector('#lc-add').addEventListener('click',function(){var url=safeUrl(u.value);if(!url){u.focus();return;}items.push({n:n.value.trim().slice(0,40),u:url});n.value='';u.value='';save();});
        u.addEventListener('keydown',function(e){if(e.key==='Enter')body.querySelector('#lc-add').click();});
        store.get('custom_links',[]).then(function(v){items=Array.isArray(v)?v:[];render();});
        /* ⚠️ لهذا المفتاح محرّران مستقلّان (هذه اللوحة ولوحة إعدادات الشريط)، وكلٌّ
           يُعيد كتابة المصفوفة كاملة من نسخة قُرئت مرّة واحدة عند الفتح ⇒ من يكتب
           ثانياً يمحو تعديل الأول بصمت. `chrome.storage.onChanged` مسار المزامنة
           الواحد (نفس نموذج §5.9/2)، ويُفكّ المستمع حين تُنزع اللوحة — نفس حارس
           `body.isConnected` في every(). */
        try{ var onLinksChanged=function(ch,area){ if(area!=='local'||!ch||!ch.custom_links)return; if(!body.isConnected){try{chrome.storage.onChanged.removeListener(onLinksChanged);}catch(e){} return;} var v=ch.custom_links.newValue; items=Array.isArray(v)?v:[]; render(); }; chrome.storage.onChanged.addListener(onLinksChanged); }catch(e){}
      }
    }
  ];
  SYFS.tools.push.apply(SYFS.tools, LINKS);

  /* ---------- AI sites (v0.148.0) — the «المساعد الذكي» category, after `sam-ai` ----------
     The AI button stopped being a lone launcher and became a category: the built-in
     assistant first, then one-click links to the AI sites people use most. Plain links
     (same `lnk-` shape as above) — nothing is read from or sent to these sites. */
  var AI_LINKS = [
    lnk('claude','Claude','https://claude.ai/', badge('#D97757','C'), 'ai'),
    lnk('gemini','Gemini','https://gemini.google.com/', badge('#4285F4','✦',13), 'ai'),
    lnk('chatgpt','ChatGPT','https://chatgpt.com/', badge('#10A37F','GPT',8), 'ai'),
    lnk('higgsfield','Higgsfield','https://higgsfield.ai/', badge('#1C1C1C','H'), 'ai'),
    lnk('kimi','Kimi','https://www.kimi.com/', badge('#27272A','K'), 'ai'),
    lnk('deepseek','DeepSeek','https://chat.deepseek.com/', badge('#4D6BFE','D'), 'ai'),
    lnk('perplexity','Perplexity','https://www.perplexity.ai/', badge('#20808D','P'), 'ai'),
    lnk('copilot','Microsoft Copilot','https://copilot.microsoft.com/', badge('#0F6CBD','Co',10), 'ai'),
    lnk('grok','Grok','https://grok.com/', badge('#000000','Gk',10), 'ai'),
    lnk('qwen','Qwen','https://chat.qwen.ai/', badge('#615CED','Q'), 'ai'),
    lnk('mistral','Le Chat (Mistral)','https://chat.mistral.ai/', badge('#FA520F','M'), 'ai'),
    lnk('notebooklm','NotebookLM','https://notebooklm.google.com/', badge('#3C4043','NB',9), 'ai')
  ];
  SYFS.tools.push.apply(SYFS.tools, AI_LINKS);

  /* ===== a tool in its own extension window (phase-2 review) =====
   * The rail lives INSIDE the host page: a field typed there sits in that page's DOM,
   * and a camera or location prompt asked from there is asked FOR that site — which
   * keeps the grant afterwards. qrtool.html#<id> runs the same tool on the extension's
   * own origin. The worker opens it (SYFS_OPEN_TOOLPAGE re-checks the id against its own
   * list); cb(false) when it could not, and the caller then warns before going on in
   * place. Shared by qrgen (src/tools2-body.js) and qrread (src/tools3.js). */
  var TOOL_PAGES = ['qrgen', 'qrread', 'qrcam'];   /* qrcam = the reader, camera started */
  SYFS.inExtPage = function () { return location.protocol === 'chrome-extension:'; };
  SYFS.openToolPage = function (id, cb) {
    var done = false;
    function fin(ok) { if (done) return; done = true; cb(ok); }
    if (TOOL_PAGES.indexOf(id) < 0) { fin(false); return; }
    try { chrome.runtime.sendMessage({ type: 'SYFS_OPEN_TOOLPAGE', tool: id }, function (r) { void chrome.runtime.lastError; fin(!!(r && r.ok)); }); } catch (e) { fin(false); }
    setTimeout(function () { fin(false); }, 4000);
  };

  /* the helpers src/tools2-body.js (the lazy tool bodies, v0.139.5) reads back — see its header */
  SYFS._t2 = { store: store, bgFetch: bgFetch, h: h, beep: beep, notify: notify, every: every, pad: pad, tzOff: tzOff, cityNow: cityNow, prayerTimes: prayerTimes };
}());
