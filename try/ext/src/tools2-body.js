/* SYF — the tool BODIES of src/tools2.js, injected on demand (v0.139.5).
 *
 * Split out of src/tools2.js so the eager content-script bundle stops parsing them on
 * every page. background.js → LAZY_TOOL_FILES injects this file the first time the user
 * opens the rail's tools (src/rail.js → ensureTools); extension pages (app/word/…) load it
 * with a <script> right after its eager half.
 *
 * ⛔ Everything that must run at PAGE LOAD stays in src/tools2.js (listeners, boots,
 *    the APIs other files call). This file only REGISTERS tools; nothing here may run
 *    before a tool is mounted. The helpers it shares with the eager half come from
 *    `SYFS._t2`, set there — the aliases below are read once, so a helper must never
 *    be REASSIGNED in the eager half (tools/perf-split-test.js checks the contract). */
(function () {
  window.SYFS = window.SYFS || {};
  var P = SYFS._t2 || {};
  var store = P.store, bgFetch = P.bgFetch, h = P.h, beep = P.beep, notify = P.notify, every = P.every, pad = P.pad, tzOff = P.tzOff, cityNow = P.cityNow, prayerTimes = P.prayerTimes;

  /* ===== World clock: any IANA zone (v0.140.0, specs/small-upgrades.md) =====
   * A stored entry is EITHER one of the Arabic city keys below (what v0.139 and earlier
   * saved — kept as is, no migration) OR an IANA zone string. Storage is written by the
   * settings import (any JSON), so an entry is used only after wcZoneOf() vouches for it;
   * anything else is dropped in silence. */
  var WC_MAX=20, WC_SUGGEST=8;
  var WC_CITIES={'الرياض':'Asia/Riyadh','القاهرة':'Africa/Cairo','الخرطوم':'Africa/Khartoum','مكة':'Asia/Riyadh','دبي':'Asia/Dubai','مانيلا':'Asia/Manila','لندن':'Europe/London','إسطنبول':'Europe/Istanbul','نيويورك':'America/New_York','طوكيو':'Asia/Tokyo'};
  var WC_FALLBACK=['UTC','Europe/Berlin','Europe/Paris','Europe/Madrid','Europe/Rome','Europe/Moscow','Asia/Kolkata','Asia/Karachi','Asia/Shanghai','Asia/Singapore','Asia/Jakarta','Asia/Kuala_Lumpur','Asia/Amman','Asia/Baghdad','Asia/Kuwait','Asia/Qatar','Asia/Bahrain','Asia/Muscat','Africa/Casablanca','Africa/Tunis','Africa/Algiers','America/Chicago','America/Los_Angeles','America/Toronto','America/Sao_Paulo','Australia/Sydney'];
  function wcOwn(c){ return Object.prototype.hasOwnProperty.call(WC_CITIES,c); }
  function wcZoneOk(z){ if(typeof z!=='string'||!z||z.length>64||!/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/.test(z)) return false; try{ new Intl.DateTimeFormat('en-US',{timeZone:z}); return true; }catch(e){ return false; } }
  function wcZoneOf(c){ if(typeof c!=='string') return null; if(wcOwn(c)) return WC_CITIES[c]; return wcZoneOk(c)?c:null; }
  function wcClean(v){ if(!Array.isArray(v)) return null; var out=[]; v.forEach(function(c){ if(wcZoneOf(c)&&out.indexOf(c)<0&&out.length<WC_MAX) out.push(c); }); return out; }
  function wcLabel(c){ return wcOwn(c) ? SYFS.t(c) : String(c).split('/').pop().replace(/_/g,' '); }
  function wcAllZones(){ var a; try{ a=Intl.supportedValuesOf('timeZone'); }catch(e){ a=null; } if(!Array.isArray(a)||!a.length) a=WC_FALLBACK.slice(); else a=a.slice(); if(a.indexOf('UTC')<0) a.unshift('UTC'); return a; }
  /* hours → «UTC+5:30» / «UTC−4» / «UTC» */
  function wcUtc(hrs){ if(hrs===null||hrs===undefined||isNaN(hrs)) return ''; if(!hrs) return 'UTC'; return 'UTC'+wcHrs(hrs); }
  function wcHrs(hrs){ var s=hrs<0?'−':'+', a=Math.abs(hrs), hh=Math.floor(a+1e-9), mm=Math.round((a-hh)*60); return s+hh+(mm?':'+(mm<10?'0':'')+mm:''); }
  /* up to WC_SUGGEST matches: the Arabic cities first (by their Arabic key, their
     translated name or their zone), then every IANA zone whose name contains the query.
     A zone already offered through an Arabic city is not offered twice. */
  function wcSearch(q, all){
    q=String(q||'').trim().toLowerCase().replace(/[\s_]+/g,' '); if(!q) return [];
    var res=[], seen={};
    Object.keys(WC_CITIES).forEach(function(c){ if(res.length>=WC_SUGGEST) return; var z=WC_CITIES[c]; var hay=(c+' '+SYFS.t(c)+' '+z).toLowerCase().replace(/[\s_]+/g,' '); if(hay.indexOf(q)>=0&&!seen[z]){ seen[z]=1; res.push({k:c,z:z}); } });
    var starts=[], rest=[];
    (all||[]).forEach(function(z){ if(seen[z]) return; var n=z.toLowerCase().replace(/_/g,' '), city=n.split('/').pop(); if(city.indexOf(q)===0) starts.push(z); else if(n.indexOf(q)>=0) rest.push(z); });
    starts.concat(rest).forEach(function(z){ if(res.length<WC_SUGGEST){ seen[z]=1; res.push({k:z,z:z}); } });
    return res;
  }
  /* ===== Translation: the free path's budget, shown BEFORE the send (v0.140.0) =====
   * n chars, cut into `parts` chunks by mmChunks; over = the free service would refuse. */
  function trBudget(n, parts, maxLen, maxChunks, free){ var limit=maxLen*maxChunks; return {n:n, parts:parts, limit:limit, over:!!free&&(n>limit||parts>maxChunks)}; }

  /* ===== QR generator: pure helpers (phase-2 review; tools/qr-speed-test.js lifts them) ===== */
  function qrEsc(s){ return String(s).replace(/([\\;,:"])/g,'\\$1'); }   /* Wi-Fi payload specials */
  /* `H:true` marks a HIDDEN network: it is not in the phone's scan list, so the phone
     only probes for it when the code says so — without the flag the scan finds nothing. */
  function qrWifi(ssid, enc, pass, hidden){
    var s=String(ssid||'').trim(); if(!s) return '';
    var hid=hidden?'H:true;':'';
    return enc==='nopass'?('WIFI:T:nopass;S:'+qrEsc(s)+';'+hid+';'):('WIFI:T:'+enc+';S:'+qrEsc(s)+';P:'+qrEsc(pass||'')+';'+hid+';');
  }
  function qrLum(hex){ var v=[1,3,5].map(function(i){ var c=parseInt(hex.slice(i,i+2),16)/255; return c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4); }); return .2126*v[0]+.7152*v[1]+.0722*v[2]; }
  /* the dots against what they will ACTUALLY sit on: the chosen background, or — when it
     is transparent — the surface the user says the code goes on (a white page and a dark
     slide are two different codes). inv = lighter dots than surface. */
  function qrContrast(col, bg, under){ var a=qrLum(col), b=qrLum(bg==='transparent'?under:bg); return {inv:a>b, ratio:(b+.05)/(a+.05)}; }

  /* ===== Connection speed: pure helpers ===== */
  function spMedian(a){ var v=(a||[]).filter(function(x){ return typeof x==='number'&&isFinite(x); }).sort(function(x,y){ return x-y; }); if(!v.length) return null; var m=v.length>>1; return v.length%2?v[m]:(v[m-1]+v[m])/2; }
  function spMbps(bytes, ms){ return (bytes>0&&ms>0)?bytes*8/1e3/ms:null; }
  /* one figure from several transfers: the median of those long enough to mean something
     (≥250ms — a 100KB burst finishes inside the TCP ramp and reads slow); all of them
     when none is. */
  function spRate(samples){
    var ok=(samples||[]).filter(function(s){ return s&&s.ms>0&&s.bytes>0; });
    var long=ok.filter(function(s){ return s.ms>=250; });
    return spMedian((long.length?long:ok).map(function(s){ return spMbps(s.bytes,s.ms); }));
  }
  /* the stored history is taken field by field — storage is writable by the settings import */
  var SP_HIST_MAX=5;
  function spHistClean(v){
    if(!Array.isArray(v)) return [];
    var out=[];
    v.forEach(function(r){
      if(out.length>=SP_HIST_MAX||!r||typeof r!=='object'||!(r.at>0)) return;
      var o={at:+r.at};
      ['ping','dl','ul'].forEach(function(k){ o[k]=(typeof r[k]==='number'&&isFinite(r[k])&&r[k]>=0&&r[k]<1e6)?r[k]:null; });
      out.push(o);
    });
    return out;
  }

  var more = [
    /* ===== Currency converter (API) — v0.129.0: a BOARD, not one pair =====
     * «اختر عملة وشوف قيمتها بأكثر من عملة»: one amount in one base currency, read at
     * once in every currency the user watches. The old panel was a single from→to
     * pair, so comparing three currencies meant changing the dropdown three times and
     * remembering the numbers in between.
     * ⛔ Currency CODES are data, never interface text: they key `rates[…]`, so they
     * live in `value`/`data-c` and are written with textContent — a translated «USD»
     * would silently return nothing (the same trap as §6.97/4). */
    {
      id:'currency', name:'العملات', cat:'calc',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="M17 6.5a4 4 0 0 0-4-2.5h-2a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-2a4 4 0 0 1-4-2.5"/></svg>',
      mount:function(body){
        /* the names are interface text; the codes beside them are not */
        var NAMES={SAR:'ريال سعودي',USD:'دولار أمريكي',EUR:'يورو',EGP:'جنيه مصري',AED:'درهم إماراتي',GBP:'جنيه إسترليني',KWD:'دينار كويتي',QAR:'ريال قطري',BHD:'دينار بحريني',OMR:'ريال عماني',JOD:'دينار أردني',SDG:'جنيه سوداني',TRY:'ليرة تركية',JPY:'ين ياباني',CNY:'يوان صيني',INR:'روبية هندية',PKR:'روبية باكستانية',PHP:'بيزو فلبيني',CAD:'دولار كندي',AUD:'دولار أسترالي',CHF:'فرنك سويسري',MAD:'درهم مغربي',TND:'دينار تونسي',DZD:'دينار جزائري',IQD:'دينار عراقي',LBP:'ليرة لبنانية',YER:'ريال يمني',SYP:'ليرة سورية',LYD:'دينار ليبي',MYR:'رينغيت ماليزي',IDR:'روبية إندونيسية',RUB:'روبل روسي',SEK:'كرونة سويدية',NOK:'كرونة نرويجية',ZAR:'راند جنوب أفريقي',BRL:'ريال برازيلي',KRW:'وون كوري',SGD:'دولار سنغافوري',THB:'بات تايلندي',NGN:'نيرة نيجيرية',KES:'شلن كيني'};
        var DEF_BASE='SAR', DEF_WATCH=['USD','EUR','EGP','AED','GBP','KWD','TRY'];
        var base=DEF_BASE, watch=DEF_WATCH.slice(), rates={}, cachedAt=0, ratesFor=null;

        body.appendChild(h(
          '<div class="syf-form">'+
            '<div class="syf-row" style="gap:6px">'+
              '<input type="number" class="syf-in" id="cu-amt" value="100" step="any" style="flex:1" title="المبلغ">'+
              '<select class="syf-in" id="cu-base" style="width:118px" title="العملة الأساس"></select>'+
            '</div>'+
            '<div class="syf-note-list" id="cu-board" style="max-height:230px;overflow-y:auto"></div>'+
            '<div class="syf-row" style="align-items:center;gap:6px">'+
              '<span class="syf-note-hint" id="cu-st" style="margin:0;flex:1"></span>'+
              '<button class="syf-mini ico" id="cu-ref" title="تحديث الأسعار" aria-label="تحديث الأسعار"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg></button>'+
              '<button class="syf-mini" id="cu-pick">العملات المعروضة</button>'+
            '</div>'+
            '<div id="cu-picker" style="display:none;width:100%">'+
              '<input type="search" class="syf-in" id="cu-q" placeholder="ابحث عن عملة…" style="width:100%">'+
              '<div class="syf-note-list" id="cu-all" style="max-height:200px;overflow-y:auto"></div>'+
            '</div>'+
          '</div>'
        ));
        var q=function(s){return body.querySelector(s);};
        var amt=q('#cu-amt'), baseSel=q('#cu-base'), board=q('#cu-board'), st=q('#cu-st'),
            picker=q('#cu-picker'), allBox=q('#cu-all'), search=q('#cu-q');

        function known(){
          /* every code the API answered with, plus the ones we ship — so the picker is
             full after the first fetch and still usable before it */
          var seen={}, out=[];
          /* keys come from the API / a settings import and end up in `value="…"` —
             only a 3-letter ISO code may pass */
          Object.keys(rates).concat(Object.keys(NAMES)).concat(watch).concat([base]).forEach(function(c){
            if(/^[A-Z]{3}$/.test(c) && !seen[c]){ seen[c]=1; out.push(c); }
          });
          return out.sort();
        }
        function label(c){ return NAMES[c] ? SYFS.t(NAMES[c]) : c; }
        /* 2 decimals for money, more only when the number is small enough to need them */
        function money(v){
          var abs=Math.abs(v);
          var dec = abs>=1000?0 : abs>=1?2 : abs>=0.01?4:6;
          try{ return new Intl.NumberFormat(SYFS.i18n.locale()+'-u-nu-latn',{minimumFractionDigits:dec,maximumFractionDigits:dec}).format(v); }
          catch(e){ return String(Math.round(v*1e6)/1e6); }
        }
        function fillBase(){
          var cur=base; baseSel.innerHTML='';
          known().forEach(function(c){
            /* i18n-skip-start: an ISO code keys `rates[…]` — it is data in `value` */
            var o=h('<option value="'+c+'"></option>');
            /* i18n-skip-end */
            o.textContent=c+' — '+label(c);
            baseSel.appendChild(o);
          });
          baseSel.value=cur;
        }
        function renderBoard(){
          var a=parseFloat(amt.value)||0;
          board.innerHTML='';
          if(!watch.length){ board.appendChild(h('<div class="syf-empty">اختر العملات التي تريد عرضها</div>')); return; }
          watch.forEach(function(c){
            var row=h('<div class="syf-note-row" style="cursor:pointer;align-items:center;gap:8px" title="اجعلها العملة الأساس">'+
                        '<span class="t" style="display:flex;flex-direction:column;gap:2px;flex:1"><b style="font-size:13px"></b><span class="syf-note-hint" style="margin:0"></span></span>'+
                        '<b style="font-size:15px;color:var(--pri);white-space:nowrap"></b></div>');
            row.dataset.c=c;
            var r=rates[c];
            row.querySelector('.t b').textContent=label(c);
            /* i18n-dyn: «١ USD = ٣٫٧٥ SAR» — codes are data, the number is formatted */
            row.querySelector('.t .syf-note-hint').textContent = r ? ('1 '+base+' = '+money(r)+' '+c) : SYFS.t('لا يوجد سعر لهذه العملة');
            row.querySelector(':scope > b').textContent = r ? (money(a*r)+' '+c) : '—';
            row.addEventListener('click',function(){ setBase(c); });
            board.appendChild(row);
          });
        }
        function renderPicker(){
          var term=(search.value||'').trim().toLowerCase();
          allBox.innerHTML='';
          known().forEach(function(c){
            if(term && c.toLowerCase().indexOf(term)<0 && label(c).indexOf(term)<0) return;
            var row=h('<label class="syf-note-row" style="cursor:pointer;align-items:center;gap:8px"><input type="checkbox"><span class="t" style="flex:1"></span></label>');
            var cb=row.querySelector('input');
            cb.checked = watch.indexOf(c)>=0;
            cb.addEventListener('change',function(){
              var i=watch.indexOf(c);
              if(cb.checked){ if(i<0) watch.push(c); } else if(i>=0) watch.splice(i,1);
              store.set('fx_watch',watch); renderBoard();
            });
            row.querySelector('.t').textContent=c+' — '+label(c);
            allBox.appendChild(row);
          });
        }
        function setBase(c){
          if(c===base) return;
          /* the new base leaves the board and the old one joins it — otherwise picking
             a currency makes the row you clicked read «1 USD = 1 USD» */
          var i=watch.indexOf(c); if(i>=0) watch.splice(i,1);
          if(watch.indexOf(base)<0) watch.unshift(base);
          base=c; store.set('fx_base',base); store.set('fx_watch',watch);
          fillBase(); ensure();
        }

        function fxDate(unix){ try{ return new Date(unix*1000).toLocaleDateString(SYFS.i18n.locale(),{year:'numeric',month:'short',day:'numeric'}); }catch(e){ return ''; } }
        /* ⚠️ v0.113.0 — a cached rate must SAY it is cached: a stale exchange rate shown
           as current is a lie the user acts on with money. Every path names the rate. */
        function sayCached(){ st.textContent = cachedAt ? SYFS.t('⚠ سعر مخزَّن من {0} — تعذّر التحديث.', fxDate(cachedAt)) : SYFS.t('تعذّر جلب الأسعار'); }
        /* `fresh` = the ⟳ button: skip the browser's HTTP cache so «refresh» is a real ask */
        function load(b, fresh){
          if(!cachedAt||fresh) st.textContent=SYFS.t('جارٍ التحميل…');
          return bgFetch('https://open.er-api.com/v6/latest/'+encodeURIComponent(b), fresh?{cache:'no-cache'}:null).then(function(r){
            if(!r||!r.ok){ sayCached(); return; }
            try{
              var j=JSON.parse(r.body);
              if(!j.rates){ sayCached(); return; }
              if(b!==base) return;                        /* a late answer for a base we left */
              rates=j.rates; ratesFor=b; cachedAt=j.time_last_update_unix||0;
              store.set('fx_'+b,{t:cachedAt,rates:rates});
              st.textContent=SYFS.t('آخر تحديث: {0}',(j.time_last_update_utc||'').slice(0,16));
              fillBase(); renderBoard(); if(picker.style.display!=='none') renderPicker();
            }catch(e){ sayCached(); }
          });
        }
        function ensure(){
          var b=base;
          if(ratesFor===b){ renderBoard(); return; }
          store.get('fx_'+b,null).then(function(c){
            if(b!==base) return;
            if(c&&c.rates){
              rates=c.rates; ratesFor=b; cachedAt=c.t||0; renderBoard();
              /* the cached figure shows at once WITH its date, then load() replaces it —
                 a number with no date beside it reads as "now" */
              if(cachedAt) st.textContent=SYFS.t('سعر {0} — يُحدَّث الآن…', fxDate(cachedAt));
            } else { cachedAt=0; rates={}; ratesFor=null; renderBoard(); }
            load(b);
          });
        }

        amt.addEventListener('input',renderBoard);
        baseSel.addEventListener('change',function(){ setBase(baseSel.value); });
        q('#cu-pick').addEventListener('click',function(){
          var open=picker.style.display==='none';
          picker.style.display=open?'block':'none';
          if(open) renderPicker();
        });
        search.addEventListener('input',renderPicker);
        /* disabled while the ask is out — a second click would only race the first */
        var refBtn=q('#cu-ref');
        refBtn.addEventListener('click',function(){
          if(refBtn.disabled) return;
          refBtn.disabled=true;
          load(base,true).then(function(){ refBtn.disabled=false; },function(){ refBtn.disabled=false; sayCached(); });
        });

        Promise.all([store.get('fx_base',null),store.get('fx_watch',null)]).then(function(v){
          if(typeof v[0]==='string'&&/^[A-Z]{3}$/.test(v[0])) base=v[0];
          if(Array.isArray(v[1])) watch=v[1].filter(function(c){return typeof c==='string'&&/^[A-Z]{3}$/.test(c);}).slice(0,40);
          fillBase(); renderBoard(); ensure();
        });
      }
    },

    /* ===== Timer (presets + pause + looping two-tone alarm — faithful to portal) ===== */
    {
      id:'timer', name:'المؤقّت', cat:'time',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12M6 21h12"/><path d="M8 3v3.5c0 2.2 4 3.3 4 5.5s-4 3.3-4 5.5V21"/><path d="M16 3v3.5c0 2.2-4 3.3-4 5.5s4 3.3 4 5.5V21"/></svg>',
      mount:function(body){
        body.appendChild(h('<div class="syf-form"><div class="syf-timer-disp" id="t-disp">05:00</div><div class="syf-row syf-timer-presets" id="t-presets"><button class="syf-mini" data-sec="60">1د</button><button class="syf-mini" data-sec="180">3د</button><button class="syf-mini" data-sec="300">5د</button><button class="syf-mini" data-sec="600">10د</button><button class="syf-mini" data-sec="900">15د</button><button class="syf-mini" data-sec="1500">25د</button></div><div class="syf-row" style="justify-content:center"><input type="number" class="syf-in" id="t-min" value="5" min="0" style="width:62px"> : <input type="number" class="syf-in" id="t-sec" value="0" min="0" max="59" style="width:62px"></div><div class="syf-row"><button class="syf-btn" id="t-start">بدء</button><button class="syf-mini" id="t-pause">إيقاف مؤقت</button><button class="syf-mini" id="t-reset">تصفير</button><button class="syf-mini" id="t-stop" style="display:none">إيقاف الصوت</button></div></div>'));
        var disp=body.querySelector('#t-disp'),minI=body.querySelector('#t-min'),secI=body.querySelector('#t-sec');
        var startB=body.querySelector('#t-start'),stopB=body.querySelector('#t-stop');
        var remain=0,handle=null,running=false,ac=null,osc=null,gain=null,alarmIv=null,alarmSafety=null;
        function fmt(s){var m=Math.floor(s/60),x=s%60;return pad(m)+':'+pad(x);}
        function show(){disp.textContent=fmt(remain);}
        function startAlarm(){ stopAlarm(); try{ ac=new (window.AudioContext||window.webkitAudioContext)(); if(ac.resume)ac.resume(); osc=ac.createOscillator();gain=ac.createGain();osc.connect(gain);gain.connect(ac.destination);osc.type='sine';osc.frequency.value=880;gain.gain.value=0.0001;osc.start();var on=false;alarmIv=setInterval(function(){on=!on;gain.gain.setValueAtTime(on?0.25:0.0001,ac.currentTime);if(on)osc.frequency.setValueAtTime(osc.frequency.value===880?988:880,ac.currentTime);},320);}catch(e){} stopB.style.display='';alarmSafety=setTimeout(stopAlarm,90000); }
        function stopAlarm(){ if(alarmIv){clearInterval(alarmIv);alarmIv=null;} if(alarmSafety){clearTimeout(alarmSafety);alarmSafety=null;} try{if(osc)osc.stop();}catch(e){} try{if(ac)ac.close();}catch(e){} osc=null;gain=null;ac=null;stopB.style.display='none'; }
        /* ⚠️ the count is a DEADLINE on the wall clock, not `remain--` per tick (v0.139.2).
           Chrome throttles a hidden tab's timers to once a minute after five minutes (and
           stops them in a frozen tab), so a 25-minute timer counted by ticks could ring
           hours late. Now a late tick only repaints late; the time left is always
           deadline − now, and returning to the tab repaints at once. */
        var deadline=0;
        function left(){ return Math.max(0,Math.ceil((deadline-Date.now())/1000)); }
        function tick(){ remain=left();show(); if(remain<=0){clearInterval(handle);handle=null;running=false;deadline=0;disp.classList.add('done');startAlarm();notify(SYFS.t('انتهى المؤقّت'),'SYF');} }
        function onVis(){ if(!body.isConnected){document.removeEventListener('visibilitychange',onVis);return;} if(running&&!document.hidden)tick(); }
        document.addEventListener('visibilitychange',onVis);
        /* ⛔ v0.139.0 — «بدء» used to read the fields ONLY when `remain` had run out.
           `remain` is seeded to 5:00 at mount, so it never had: you typed 2:30, or
           pressed «25د», pressed «بدء» — and got five minutes. The number you set was
           visible in the field the whole time, which is what made it a bug rather than
           a quirk: nothing on screen disagreed with you.
           The fix is to treat the fields as the source of truth WHILE the timer is
           idle: editing them (or picking a preset) sets `remain` and repaints the face,
           so «بدء» starts what the face shows. A paused timer is deliberately left
           alone — there «بدء» means resume, and re-reading the fields would throw the
           remainder away. */
        function fromFields(){ return (parseInt(minI.value,10)||0)*60+(parseInt(secI.value,10)||0); }
        function syncIdle(){ if(running||handle) return; remain=fromFields(); disp.classList.remove('done'); show(); }
        minI.addEventListener('input',syncIdle); secI.addEventListener('input',syncIdle);
        body.querySelector('#t-presets').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;var s=parseInt(b.getAttribute('data-sec'),10);minI.value=Math.floor(s/60);secI.value=s%60;syncIdle();});
        startB.addEventListener('click',function(){ stopAlarm(); if(running)return; if(remain<=0)remain=fromFields(); if(remain<=0)return; disp.classList.remove('done');show();running=true;deadline=Date.now()+remain*1000;handle=setInterval(function(){if(!body.isConnected){clearInterval(handle);stopAlarm();document.removeEventListener('visibilitychange',onVis);return;}tick();},1000); });
        body.querySelector('#t-pause').addEventListener('click',function(){ if(handle){remain=left();clearInterval(handle);handle=null;running=false;deadline=0;show();} });
        body.querySelector('#t-reset').addEventListener('click',function(){ stopAlarm(); if(handle){clearInterval(handle);handle=null;}running=false;deadline=0;remain=0;disp.classList.remove('done');disp.textContent='00:00'; });
        stopB.addEventListener('click',stopAlarm);
        remain=fromFields();show();
      }
    },

    /* ===== Stopwatch + Pomodoro (two views via seg — faithful to portal) ===== */
    {
      id:'stopwatch', name:'ساعة إيقاف', cat:'time',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 13l3-2"/><path d="M9 2h6"/></svg>',
      mount:function(body){
        body.appendChild(h('<div class="syf-form"><div class="syf-seg" id="sw-seg"><button class="active" data-seg="sw">ساعة إيقاف</button><button data-seg="pomo">بومودورو</button></div><div data-swview="sw"><div class="syf-timer-disp" id="sw-disp">00:00<small>.00</small></div><div class="syf-row"><button class="syf-btn" id="sw-start">ابدأ</button><button class="syf-mini" id="sw-lap">لفّة</button><button class="syf-mini" id="sw-reset">تصفير</button></div><div class="syf-note-list" id="sw-laps"></div></div><div data-swview="pomo" style="display:none"><div class="syf-pomo-phase focus" id="pm-phase">تركيز</div><div class="syf-timer-disp" id="pm-disp">25:00</div><div class="syf-note-hint" id="pm-info"></div><div class="syf-row" style="justify-content:center">تركيز <input type="number" class="syf-in" id="pm-focus" value="25" min="1" style="width:58px"> راحة <input type="number" class="syf-in" id="pm-break" value="5" min="1" style="width:58px"></div><div class="syf-row"><button class="syf-btn" id="pm-start">ابدأ</button><button class="syf-mini" id="pm-pause">إيقاف مؤقت</button><button class="syf-mini" id="pm-reset">تصفير</button></div></div></div>'));
        body.querySelector('#sw-seg').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;this.querySelectorAll('button').forEach(function(x){x.classList.toggle('active',x===b);});var s=b.getAttribute('data-seg');body.querySelectorAll('[data-swview]').forEach(function(v){v.style.display=v.getAttribute('data-swview')===s?'':'none';});});
        /* Stopwatch */
        (function(){
          var disp=body.querySelector('#sw-disp'),laps=body.querySelector('#sw-laps');
          var start=body.querySelector('#sw-start'),lapB=body.querySelector('#sw-lap'),reset=body.querySelector('#sw-reset');
          var running=false,base=0,elapsed=0,raf=null,lapN=0;
          function fmt(ms){var t=Math.floor(ms),cs=Math.floor((t%1000)/10),s=Math.floor(t/1000)%60,m=Math.floor(t/60000)%60,hh=Math.floor(t/3600000);return (hh?pad(hh)+':':'')+pad(m)+':'+pad(s)+'<small>.'+pad(cs)+'</small>';}
          function show(){disp.innerHTML=fmt(elapsed);}
          function loop(){if(!body.isConnected){running=false;return;}elapsed=Date.now()-base;show();if(running)raf=requestAnimationFrame(loop);}
          start.addEventListener('click',function(){ if(running){running=false;if(raf)cancelAnimationFrame(raf);elapsed=Date.now()-base;show();start.textContent=SYFS.t('متابعة');} else {running=true;base=Date.now()-elapsed;start.textContent=SYFS.t('إيقاف مؤقت');loop();} });
          lapB.addEventListener('click',function(){ if(!elapsed)return;lapN++;laps.insertBefore(h('<div class="syf-note-row"><span class="t"><span>لفة</span> '+lapN+'</span><b dir="ltr">'+disp.textContent+'</b></div>'),laps.firstChild); });
          reset.addEventListener('click',function(){running=false;if(raf)cancelAnimationFrame(raf);elapsed=0;lapN=0;laps.innerHTML='';start.textContent=SYFS.t('ابدأ');show();});
          show();
        }());
        /* Pomodoro */
        (function(){
          var disp=body.querySelector('#pm-disp'),phase=body.querySelector('#pm-phase'),info=body.querySelector('#pm-info');
          var fI=body.querySelector('#pm-focus'),bI=body.querySelector('#pm-break');
          var sBtn=body.querySelector('#pm-start'),pBtn=body.querySelector('#pm-pause'),rBtn=body.querySelector('#pm-reset');
          var remain=25*60,onBreak=false,handle=null,running=false,cycles=0;
          function fmt(s){var m=Math.floor(s/60),x=s%60;return pad(m)+':'+pad(x);}
          function show(){disp.textContent=fmt(remain);}
          function setPhase(){phase.textContent=onBreak?SYFS.t('راحة'):SYFS.t('تركيز');phase.className='syf-pomo-phase '+(onBreak?'break':'focus');}
          /* same wall-clock deadline as the timer above (v0.139.2) — a throttled tick
             repaints late, it no longer counts late */
          var deadline=0;
          function left(){ return Math.max(0,Math.ceil((deadline-Date.now())/1000)); }
          function tick(){ remain=left();show(); if(remain<=0){ beep(500,880); if(!onBreak){cycles++;onBreak=true;remain=(parseInt(bI.value,10)||5)*60;notify(SYFS.t('انتهى وقت التركيز — خذ راحة'),'SYF');} else {onBreak=false;remain=(parseInt(fI.value,10)||25)*60;notify(SYFS.t('انتهت الراحة — ابدأ التركيز'),'SYF');} deadline=Date.now()+remain*1000; setPhase();show();info.textContent=SYFS.t('جلسات مكتملة: {0}',cycles); } }
          function onVis(){ if(!body.isConnected){document.removeEventListener('visibilitychange',onVis);return;} if(running&&!document.hidden)tick(); }
          document.addEventListener('visibilitychange',onVis);
          sBtn.addEventListener('click',function(){ if(running)return; if(remain<=0)remain=(parseInt(fI.value,10)||25)*60; running=true; deadline=Date.now()+remain*1000; handle=setInterval(function(){if(!body.isConnected){clearInterval(handle);document.removeEventListener('visibilitychange',onVis);return;}tick();},1000); });
          pBtn.addEventListener('click',function(){if(handle){remain=left();clearInterval(handle);handle=null;running=false;deadline=0;show();}});
          rBtn.addEventListener('click',function(){if(handle){clearInterval(handle);handle=null;}running=false;deadline=0;onBreak=false;remain=(parseInt(fI.value,10)||25)*60;cycles=0;info.textContent='';setPhase();show();});
          fI.addEventListener('change',function(){if(!running&&!onBreak){remain=(parseInt(fI.value,10)||25)*60;show();}});
          setPhase();show();
        }());
      }
    },

    /* ===== Scheduled alarm ===== */
    {
      id:'alarm', name:'تنبيه مجدول', cat:'time',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>',
      mount:function(body){
        /* ⚠️ The hint is the honest half of shipping a THIRD notifier (v0.100.0).
           This one polls on a setInterval inside the window, so it dies with it;
           the calendar's reminders are armed in the worker and do not. Saying which
           is which costs a line — leaving the user to discover it costs a missed
           appointment. One msgid, no inline <b> to split the sentence (§6.102/3). */
        body.appendChild(h('<div class="syf-form"><input class="syf-in" id="al-txt" placeholder="عنوان التنبيه"><input type="time" class="syf-in" id="al-time"><button class="syf-btn" id="al-add">إضافة</button><div class="syf-note-list" id="al-list"></div><div class="syf-note-hint">يعمل هذا التنبيه ما دامت النافذة مفتوحة. للمواعيد المرتبطة بتاريخ استخدم «التقويم والمهام» — يصلك تنبيهها والصفحة مغلقة.</div></div>'));
        var txt=body.querySelector('#al-txt'),time=body.querySelector('#al-time'),list=body.querySelector('#al-list');var items=[];
        /* ⚠️ الوقت يُملأ نصّاً في قالب ثابت ولا يُلصَق في القالب نفسه: `a.time` يأتي
           من التخزين الذي تكتبه ميزة «استيراد» في الإعدادات — وهي تقبل أي كائن JSON
           ⇒ القيمة تأتي من التخزين الذي يكتبه الاستيراد ⇒ نصّ لا markup. */
        function render(){ list.innerHTML=''; if(!items.length){list.appendChild(h('<div class="syf-empty">لا تنبيهات.</div>'));return;} items.forEach(function(a,i){var r=h('<div class="syf-note-row"><span class="t"></span><button class="x">✕</button></div>');var tEl=r.querySelector('.t');tEl.textContent=(a.time||'')+' — ';tEl.appendChild(document.createTextNode(a.txt||SYFS.t('تنبيه')));r.querySelector('.x').addEventListener('click',function(){items.splice(i,1);save();});list.appendChild(r);}); }
        function save(){items.sort(function(a,b){return a.time<b.time?-1:1});store.set('alarms',items);render();}
        body.querySelector('#al-add').addEventListener('click',function(){if(!time.value)return;items.push({txt:txt.value.trim(),time:time.value,fired:''});txt.value='';save();});
        store.get('alarms',[]).then(function(v){items=Array.isArray(v)?v:[];render();});
        every(body,10000,function(){var now=new Date(),hm=pad(now.getHours())+':'+pad(now.getMinutes()),day=now.toDateString();items.forEach(function(a){if(a.time===hm&&a.fired!==day){a.fired=day;store.set('alarms',items);notify(a.txt||SYFS.t('تنبيه'),'SYF');var n=0,iv=setInterval(function(){beep(300,n%2?660:990);if(++n>20)clearInterval(iv);},500);}});});
      }
    },

    /* ===== Reminders (presets w/ rotating adhkar + custom interval/daily — faithful to portal) ===== */
    {
      id:'reminders', name:'تذكيرات', cat:'time',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>',
      mount:function(body){
        var ADHKAR=['سبحان الله وبحمده، سبحان الله العظيم','لا إله إلا الله وحده لا شريك له','أستغفر الله وأتوب إليه','اللهم صلِّ وسلّم على نبينا محمد','لا حول ولا قوة إلا بالله','حسبي الله ونعم الوكيل','سبحان الله والحمد لله ولا إله إلا الله والله أكبر'];
        var PRESETS=[{k:'a',n:'أذكار',def:30,fn:function(){return ['تذكير بالذكر',ADHKAR[Math.floor(Math.random()*ADHKAR.length)]];}},{k:'w',n:'شرب الماء',def:60,fn:function(){return ['تذكير بشرب الماء','خذ رشفة ماء 💧'];}},{k:'m',n:'الحركة والوقوف',def:45,fn:function(){return ['تذكير بالحركة','قف وتحرّك قليلاً 🚶'];}}];
        var html='<div class="syf-form">';
        PRESETS.forEach(function(p){html+='<div class="syf-rem-row"><label class="syf-ck"><input type="checkbox" data-k="'+p.k+'"> '+p.n+'</label><input type="number" class="syf-in" style="width:64px" data-min="'+p.k+'" value="'+p.def+'" min="1"> د</div>';});
        html+='<hr style="border:none;border-top:1px solid var(--line);width:100%"><div class="syf-row"><input class="syf-in" id="rm-txt" placeholder="تذكير مخصّص…"><select class="syf-in" id="rm-mode" style="width:92px"><option value="interval">كل فترة</option><option value="daily">يومياً</option></select></div><div class="syf-row"><input type="number" class="syf-in" id="rm-every" value="30" min="1" style="width:78px"> د <input type="time" class="syf-in" id="rm-at" value="09:00" style="display:none"><button class="syf-btn" id="rm-add">إضافة</button></div><div class="syf-note-list" id="rm-list"></div></div>';
        body.appendChild(h(html));
        var custom=[],lastFire={},dailyFired={};
        var txt=body.querySelector('#rm-txt'),modeS=body.querySelector('#rm-mode'),everyIn=body.querySelector('#rm-every'),atIn=body.querySelector('#rm-at'),listEl=body.querySelector('#rm-list');
        function askPerm(){ try{ if(window.Notification&&Notification.permission==='default')Notification.requestPermission(); }catch(e){} }
        function persist(){ var o={c:custom}; PRESETS.forEach(function(p){var c=body.querySelector('[data-k="'+p.k+'"]'),m=body.querySelector('[data-min="'+p.k+'"]');o[p.k]={on:c.checked,min:parseInt(m.value,10)||p.def};}); store.set('reminders',o); }
        function renderList(){ listEl.innerHTML=''; custom.forEach(function(r){ var row=h('<div class="syf-rem-row"><span class="nm"></span><span class="syf-note-hint"></span><label class="syf-ck"><input type="checkbox" '+(r.on?'checked':'')+'></label><button class="x">✕</button></div>'); row.querySelector('.nm').textContent=r.text; row.querySelector('.syf-note-hint').textContent=(r.mode==='daily')?SYFS.t('يومياً {0}',r.at):SYFS.t('كل {0} د',r.every); row.querySelector('input').addEventListener('change',function(){r.on=this.checked;if(r.on)askPerm();persist();}); row.querySelector('.x').addEventListener('click',function(){custom=custom.filter(function(x){return x.id!==r.id;});delete lastFire[r.id];persist();renderList();}); listEl.appendChild(row); }); }
        modeS.addEventListener('change',function(){var daily=modeS.value==='daily';everyIn.style.display=daily?'none':'';atIn.style.display=daily?'':'none';});
        body.querySelector('#rm-add').addEventListener('click',function(){var t=(txt.value||'').trim().slice(0,80);if(!t){txt.focus();return;}var r={id:'r'+Date.now()+Math.floor(Math.random()*1000),text:t,mode:modeS.value,every:parseInt(everyIn.value,10)||30,at:atIn.value||'09:00',on:true};custom.push(r);persist();renderList();askPerm();txt.value='';});
        PRESETS.forEach(function(p){var c=body.querySelector('[data-k="'+p.k+'"]'),m=body.querySelector('[data-min="'+p.k+'"]');c.addEventListener('change',function(){if(c.checked)askPerm();persist();});m.addEventListener('change',persist);});
        store.get('reminders',null).then(function(v){ if(v){ PRESETS.forEach(function(p){var c=body.querySelector('[data-k="'+p.k+'"]'),m=body.querySelector('[data-min="'+p.k+'"]');if(v[p.k]){c.checked=!!v[p.k].on;m.value=v[p.k].min||p.def;}}); custom=Array.isArray(v.c)?v.c:[]; } renderList(); });
        every(body,15000,function(){
          var now=Date.now(),nd=new Date(),hm=pad(nd.getHours())+':'+pad(nd.getMinutes()),today=nd.toDateString();
          PRESETS.forEach(function(p){var c=body.querySelector('[data-k="'+p.k+'"]');if(!c.checked){delete lastFire[p.k];return;}if(lastFire[p.k]===undefined){lastFire[p.k]=now;return;}var m=body.querySelector('[data-min="'+p.k+'"]'),ms=(parseInt(m.value,10)||p.def)*60000;if(now-lastFire[p.k]>=ms){lastFire[p.k]=now;var msg=p.fn();notify(msg[0],msg[1]);}});
          custom.forEach(function(r){ if(!r.on){return;} if(r.mode==='interval'){ if(lastFire[r.id]===undefined){lastFire[r.id]=now;return;} var ms=(parseInt(r.every,10)||30)*60000; if(now-lastFire[r.id]>=ms){lastFire[r.id]=now;notify(SYFS.t('تذكير'),r.text);} } else { if(r.at===hm&&dailyFired[r.id]!==today){dailyFired[r.id]=today;notify(SYFS.t('تذكير'),r.text);} } });
        });
      }
    },

    /* ===== World clock ===== */
    {
      id:'worldclock', name:'الساعة العالمية', cat:'time',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
      mount:function(body){
        /* v0.140.0 — a search box over every IANA zone replaces the ten-city dropdown.
           The suggestion carries its KEY in a closure, never in translated text (the
           `value` trap of §6.103/4 that the old <select> had to guard against). */
        body.appendChild(h('<div class="syf-form"><input class="syf-in" id="wc-q" type="search" autocomplete="off" placeholder="ابحث عن مدينة أو منطقة زمنية…"><div class="syf-wc-sug" id="wc-sug"></div><div class="syf-note-hint" id="wc-msg" style="display:none"></div><div class="syf-note-list" id="wc-list"></div></div>'));
        var qIn=body.querySelector('#wc-q'),sug=body.querySelector('#wc-sug'),msg=body.querySelector('#wc-msg'),list=body.querySelector('#wc-list'),all=null;
        var picked=['الرياض','القاهرة','لندن'];
        function say(t){msg.style.display=t?'':'none';msg.textContent=t||'';}
        function add(k){if(picked.indexOf(k)>=0){say(SYFS.t('موجودة في القائمة.'));return;}if(picked.length>=WC_MAX){say(SYFS.t('الحدّ {0} ساعة — احذف واحدة أولاً.',WC_MAX));return;}picked.push(k);store.set('worldclock',picked);qIn.value='';suggest();say('');render();}
        function suggest(){sug.textContent='';var q=qIn.value;if(!q.trim()){return;}if(!all)all=wcAllZones();var r=wcSearch(q,all);if(!r.length){var e=document.createElement('div');e.className='syf-note-hint';e.textContent=SYFS.t('لا نتائج.');sug.appendChild(e);return;}r.forEach(function(it){var b=document.createElement('button');b.type='button';var s=document.createElement('span');s.textContent=wcLabel(it.k);var sm=document.createElement('small');sm.textContent=(it.k===it.z?'':it.z+' · ')+wcUtc(tzOff(it.z,new Date()));b.appendChild(s);b.appendChild(sm);b.addEventListener('click',function(){add(it.k);qIn.focus();});sug.appendChild(b);});}
        qIn.addEventListener('input',function(){say('');suggest();});
        qIn.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();var b=sug.querySelector('button');if(b)b.click();}});
        /* ⚠️ الرسم المتزامن أدناه يسبق وصول التخزين. الإسناد بلا `render()` كان يترك
           القائمة الافتراضية معروضة ولا شيء يُعيد رسمها حتى يُضيف المستخدم مدينة أو
           يحذفها ⇒ مدنه المحفوظة تبدو ضائعة. الرسم يقع حين تصل القيمة. */
        store.get('worldclock',null).then(function(v){var c=wcClean(v);if(c&&c.length)picked=c;render();});
        /* `-u-nu-latn` stays on the Arabic locale: these are clock digits read at a
           glance next to a Latin time zone, and Arabic-Indic numerals here read as a
           font fault (§6.100/5). The LOCALE still follows the language — it decides
           «ص/م» vs «AM/PM». */
        function fmt(z){try{return new Intl.DateTimeFormat(SYFS.i18n.locale()+'-u-nu-latn',{timeZone:z,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}).format(new Date());}catch(e){return '--';}}
        /* ⚠️ اسم المدينة والمنطقة يُملآن بعد بناء قالب ثابت، لا داخل نصّ القالب:
           `c` عنصر من مصفوفة `worldclock` المخزَّنة، والقيمة تأتي من التخزين الذي
           يكتبه الاستيراد (يقبل أي كائن JSON) ⇒ نصّ لا markup. */
        /* each row: name · time · its distance from THIS device («+2 س»), then ✕ */
        function render(){list.innerHTML='';var now=new Date(),mine=-now.getTimezoneOffset()/60;picked.forEach(function(c,i){var z=wcZoneOf(c);if(!z)return;var r=h('<div class="syf-note-row"><span class="t"></span><span class="syf-wc-d"></span><b class="syf-wc-t"></b><button class="x">✕</button></div>');r.querySelector('.t').textContent=wcLabel(c);/* i18n-dyn: wcLabel() translates an Arabic city key itself; an IANA zone is a proper name */var off=tzOff(z,now),d=off===null?0:Math.round((off-mine)*60)/60;r.querySelector('.syf-wc-d').textContent=d?SYFS.t('{0} ساعة',wcHrs(d)):'';r.querySelector('.syf-wc-t').dataset.z=z;r.querySelector('.x').addEventListener('click',function(){picked.splice(i,1);store.set('worldclock',picked);say('');render();});list.appendChild(r);});}
        render(); every(body,1000,function(){body.querySelectorAll('.syf-wc-t').forEach(function(b){b.textContent=fmt(b.dataset.z);});});
      }
    },

    /* ===== Prayer times (offline — Umm al-Qura; Egyptian authority for Cairo/Khartoum) ===== */
    {
      id:'prayer', name:'مواقيت الصلاة', cat:'islam',
      /* The user's own mosque, from New Icons/mosque_4.svg — the PATH is verbatim;
         only the window onto it moved. As authored it filled 66% × 85% of its 512
         box (17% dead margin on each side), which would have rendered it visibly
         smaller than every stroke-drawn icon beside it. Cropping the viewBox to a
         square that hugs the ink gives 73% × 94%: the height now matches the islam
         crescent's 93.5%, and the width stays narrower because a mosque IS narrower
         than a moon — stretching it would distort it.
         Done here rather than with a CSS size exception on purpose: the viewBox
         travels WITH the icon, so it is right at all three places a tool icon is
         drawn (shelf chip, workspace tab, command palette) instead of at whichever
         one an exception happened to name. */
      icon:'<svg viewBox="25 7 462 462" fill="currentColor"><g transform="translate(0,512) scale(0.1,-0.1)"><path fill-rule="evenodd" d="M2485 4854 c-38 -30 -140 -98 -225 -151 -363 -227 -509 -333 -646 -471 -149 -149 -244 -322 -275 -497 -26 -150 1 -323 65 -418 l24 -35 -70 -4 c-64 -3 -73 -7 -99 -36 -29 -32 -29 -34 -29 -152 l0 -120 -37 0 c-30 0 -89 -24 -105 -42 -2 -2 -5 -464 -8 -1028 l-5 -1025 -73 -5 c-68 -5 -76 -8 -103 -38 -29 -32 -29 -34 -29 -152 l0 -120 400 0 400 0 0 571 c0 438 -3 575 -13 592 -22 39 -15 240 11 322 60 193 195 333 562 585 91 62 202 140 248 172 l82 60 68 -50 c37 -27 139 -97 227 -157 213 -144 313 -222 415 -325 96 -97 144 -171 178 -274 32 -97 40 -233 18 -308 -14 -49 -16 -128 -16 -622 l0 -566 400 0 400 0 0 120 c0 118 0 120 -29 152 -27 30 -35 33 -103 38 l-73 5 -5 1025 c-3 564 -6 1026 -8 1028 -16 18 -75 42 -104 42 l-38 0 0 120 c0 118 0 120 -29 152 -26 29 -35 33 -99 36 l-70 4 24 35 c55 81 68 138 69 288 0 120 -3 151 -23 215 -94 298 -293 502 -805 822 -212 132 -371 239 -382 258 -9 15 -14 12 -90 -46z"/></g></svg>',
      mount:function(body){
        /* [lat, lng, IANA zone] — same table as IK_CITIES in background.js; keep both in step */
        var cities={'الأحساء':[25.383,49.586,'Asia/Riyadh'],'الرياض':[24.713,46.675,'Asia/Riyadh'],'مكة':[21.389,39.857,'Asia/Riyadh'],'المدينة':[24.524,39.597,'Asia/Riyadh'],'جدة':[21.543,39.173,'Asia/Riyadh'],'الدمام':[26.420,50.088,'Asia/Riyadh'],'القاهرة':[30.044,31.236,'Africa/Cairo'],'الخرطوم':[15.500,32.559,'Africa/Khartoum']};
        /* v0.178.1 — two tabs at the user's request: «المواقيت» (city + times + the row
           switches) and «الإعدادات» (the shared alert settings that used to sit under the
           list). Both panes are built once and toggled, same pattern as the hijri tool. */
        body.appendChild(h('<div class="syf-seg" id="pr-tabs" role="tablist" style="margin-bottom:8px"><button type="button" role="tab" id="pr-t-times" aria-controls="pr-p-times" data-p="times">🕌 المواقيت</button><button type="button" role="tab" id="pr-t-set" aria-controls="pr-p-set" data-p="set">⚙️ الإعدادات</button></div>'));
        var paneT=h('<div id="pr-p-times" role="tabpanel" aria-labelledby="pr-t-times" data-prpane="times"><div class="syf-form"><select class="syf-in" id="pr-city" aria-label="المدينة"></select><div class="syf-note-list" id="pr-list"></div><div class="syf-note-hint" id="pr-st" style="margin:0" aria-live="polite"></div></div></div>');
        var paneS=h('<div id="pr-p-set" role="tabpanel" aria-labelledby="pr-t-set" data-prpane="set" hidden></div>');
        body.appendChild(paneT);body.appendChild(paneS);
        var prSt=paneT.querySelector('#pr-st');
        (function(){var seg=body.querySelector('#pr-tabs'),tabs=Array.prototype.slice.call(seg.querySelectorAll('[role="tab"]'));
          function tab(k,focus){tabs.forEach(function(b){var on=b.dataset.p===k;b.classList.toggle('on',on);b.setAttribute('aria-selected',on?'true':'false');b.tabIndex=on?0:-1;if(on&&focus)b.focus();});
            paneT.hidden=k!=='times';paneS.hidden=k!=='set';}
          seg.addEventListener('click',function(e){var b=e.target.closest('[role="tab"]');if(b)tab(b.dataset.p);});
          seg.addEventListener('keydown',function(e){var i=tabs.indexOf(e.target),n=tabs.length,j=-1;if(i<0)return;
            if(e.key==='ArrowRight'||e.key==='ArrowLeft')j=(i+(((e.key==='ArrowLeft')===(SYFS.i18n.dir()==='rtl'))?1:n-1))%n;else if(e.key==='Home')j=0;else if(e.key==='End')j=n-1;
            if(j>=0){e.preventDefault();tab(tabs[j].dataset.p,true);}});
          tab('times');})();
        /* ⚠️ The explicit `value` is load-bearing, not tidiness. An <option> with no
           value attribute takes its value from its TEXT — and tree() translates text
           while deliberately leaving `value` alone (src/i18n.js). In English the option
           read "Al-Ahsa", `sel.value` returned it, `cities[sel.value]` was undefined and
           render() threw: the prayer list came up EMPTY and nothing said why. The key
           stays Arabic on both sides of the lookup and of storage. */
        /* the calculation method per city — a SEPARATE table so `cities` stays byte-equal to
           the worker's IK_CITIES (a test compares them); same as IK_METHOD there. Egypt and
           Sudan follow the Egyptian General Authority of Survey, not Umm al-Qura. */
        var methods={'القاهرة':'egypt','الخرطوم':'egypt'};
        /* `prayer_city` is a stored string an import can set to anything: «constructor»
           passed `cities[c]`, the select fell to '' and every render threw */
        function cityKey(c){return Object.prototype.hasOwnProperty.call(cities,c)?c:'الأحساء';}
        var sel=body.querySelector('#pr-city'),list=body.querySelector('#pr-list');Object.keys(cities).forEach(function(c){sel.appendChild(h('<option value="'+c+'">'+c+'</option>'));});
        /* i18n-skip-start: a storage key and a `cities` index, not interface text —
           it is displayed through the <option> above, which IS translated. */
        store.get('prayer_city','الأحساء').then(function(c){sel.value=cityKey(c);render();});
        /* i18n-skip-end */
        var names=['الفجر','الشروق','الضحى','الظهر','العصر','المغرب','العشاء','قيام الليل'],rows=[];
        /* The rows are built ONCE and updated in place. render() runs every minute and after
           every save (storage.onChanged → fill), and rebuilding the list removed the switch a
           keyboard user had just pressed: focus fell to <body>, Tab started over. */
        function build(){names.forEach(function(n,i){var k=KEYS[i];var r=h('<div class="syf-note-row"><span class="t">'+n+(k==='duha'||k==='qiyam'?' <small class="syf-sunnah" style="font-size:10px;font-weight:800;padding:1px 6px;border-radius:999px;color:#9a6700;background:rgba(240,180,41,.18);white-space:nowrap">سنة مؤكدة</small>':'')+'</span><b></b>'+(k?'<button type="button" class="syf-sw" role="switch" aria-checked="false" data-p="'+k+'"></button>':'<span class="syf-sw-gap"></span>')+'</div>');
          /* v0.175.0 — the wudu time under its prayer, shown while that reminder is on for it */
          var wu=document.createElement('small');wu.className='syf-wu-t';wu.style.cssText='margin-inline-start:6px;font-size:10.5px;font-weight:700;color:var(--pri);white-space:nowrap';wu.title=SYFS.t('وقت الوضوء');wu.hidden=true;r.querySelector('.t').appendChild(wu);
          /* v0.153.0 — the alert switch sits on the prayer's own row (الشروق is not a prayer: no switch).
             v0.167.0 — الضحى (سنة مؤكدة) has one too, but it drives its own `duhaOn`, not the
             five-prayer master switch: it has no adhan and its time is sunrise + duhaAfter. */
          var sw=r.querySelector('.syf-sw');if(sw){sw.setAttribute('aria-label',SYFS.t('تنبيه صلاة {0}',SYFS.t(n)));sw.addEventListener('click',function(){flip(k);});}
          var rk=RAK[k];if(rk){var line=document.createElement('span');line.className='syf-rak';line.style.cssText='display:flex;flex-wrap:wrap;gap:4px;margin-top:4px';
            rk.forEach(function(c){var e=document.createElement('small');e.textContent=SYFS.t(c[0],c[1]);e.title=SYFS.t(RAK_TIP[c[2]]);e.style.cssText=RAK_CSS[c[2]];line.appendChild(e);});
            r.querySelector('.t').appendChild(line);}
          list.appendChild(r);rows.push({r:r,b:r.querySelector('b'),wu:wu,sw:sw,k:k});});}
        /* times are shown for the CITY's day on the CITY's clock (cityNow, Intl in its zone),
           so «next» is judged on it too — a device in New York at 20:00 looking at Riyadh had
           no row highlighted and showed yesterday's times. Between midnight and الفجر, and
           after the day's last row, the next prayer is الفجر. aria-current says which. */
        function render(){var k0=cityKey(sel.value),c=cities[k0],m=methods[k0]||'umq',cn=cityNow(c[2],new Date()),d=cn.day,off=tzOff(c[2],d);if(off===null)off=-d.getTimezoneOffset()/60;var t=prayerTimes(d,c[0],c[1],off,m);var duha=Math.min(t._raw.sunrise+(ik?ik.duhaAfter:20)/60,t._raw.dhuhr-10/60);var raw=[t._raw.fajr,t._raw.sunrise,duha,t._raw.dhuhr,t._raw.asr,t._raw.maghrib,t._raw.isha,qiyamH(t._raw,prayerTimes(new Date(d.getFullYear(),d.getMonth(),d.getDate()+1,12),c[0],c[1],off,m)._raw,ik?ik.qiyamAt:'third')];var nextI=0;for(var i=0;i<raw.length;i++){if(raw[i]>cn.h){nextI=i;break;}}
          if(!rows.length)build();
          rows.forEach(function(o,i){var k=o.k;o.b.textContent=t._fmt(raw[i]);
            var wOn=!!(ik&&ik.wuduOn&&ik.wuduBefore[k]&&SYFS.ithkar.wuduFor(ik,k));o.wu.hidden=!wOn;if(wOn)o.wu.textContent='💧 '+t._fmt(raw[i]-ik.wuduBefore[k]/60);
            if(o.sw)o.sw.setAttribute('aria-checked',String(k==='duha'?!!(ik&&ik.duhaOn):k==='qiyam'?!!(ik&&ik.qiyamOn):!!(ik&&ik.prayerOn&&ik.prayerWhich[k])));
            o.r.classList.toggle('syf-next',i===nextI);if(i===nextI)o.r.setAttribute('aria-current','time');else o.r.removeAttribute('aria-current');});}
        /* v0.168.0 — قيام الليل, same rule as the worker's ikQiyamH (background.js): the
           night runs from المغرب to tomorrow's الفجر; never before العشاء + 30 min. */
        function qiyamH(t,tn,mode){var night=(tn.fajr+24)-t.maghrib;var x=mode==='half'?t.maghrib+night/2:mode==='isha'?t.isha+1:t.maghrib+night*2/3;return Math.max(x,t.isha+0.5);}
        var KEYS=['fajr','','duha','dhuhr','asr','maghrib','isha','qiyam'],ik=null,flip=function(){};
        /* v0.168.0 — rak'ahs per prayer: [msgid, count, kind] — kind 0 = سنة غير مؤكدة (v0.169.1: none shown —
           the user asked to drop the non-emphasised «قبلها» of العصر/المغرب/العشاء),
           1 = سنة مؤكدة (الرواتب: 2 قبل الفجر · 4 قبل الظهر و2 بعده · 2 بعد المغرب · 2 بعد العشاء), 2 = الفرض */
        var RAK={fajr:[['قبلها {0}','2',1],['الفرض {0}','2',2]],
          duha:[['ركعتان فأكثر','',1]],
          dhuhr:[['قبلها {0}','4',1],['الفرض {0}','4',2],['بعدها {0}','2',1]],
          asr:[['الفرض {0}','4',2]],
          maghrib:[['الفرض {0}','3',2],['بعدها {0}','2',1]],
          isha:[['الفرض {0}','4',2],['بعدها {0}','2',1]],
          qiyam:[['مثنى مثنى','',1],['يُختم بالوتر','',1]]};
        var RAK_TIP=['سنة غير مؤكدة','سنة مؤكدة','فريضة'];
        var RAK_BASE='font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px;white-space:nowrap;line-height:1.6;';
        var RAK_CSS=[RAK_BASE+'border:1px dashed var(--line);opacity:.8',
          RAK_BASE+'border:1px solid #2f9e66;color:#2f9e66;background:rgba(47,158,102,.10)',
          RAK_BASE+'border:1px solid var(--line);background:var(--line);font-weight:800'];
        /* v0.169.1 — the full hadith of the 12 rawatib, as a green notice under the list. */
        (function(){var lg=document.createElement('div');lg.setAttribute('role','note');
          lg.style.cssText='margin:6px 0 0;padding:8px 10px;border:1px solid #2f9e66;border-radius:10px;background:rgba(47,158,102,.10);color:#2f9e66;font-size:12px;line-height:1.9';
          lg.textContent=SYFS.t('قال ﷺ: «مَن ثابَرَ على ثِنتَيْ عشرةَ ركعةً من السُّنّة بنى اللهُ له بيتاً في الجنّة: أربعِ ركعاتٍ قبلَ الظُّهر، وركعتين بعدها، وركعتين بعدَ المغرب، وركعتين بعدَ العشاء، وركعتين قبلَ الفجر» — رواه الترمذي (414) وصحّحه الألباني');list.after(lg);})();
        sel.addEventListener('change',function(){store.set('prayer_city',sel.value);render();if(SYFS.ithkar)SYFS.ithkar.save({});/* the worker's alarm is city-bound */});
        every(body,60000,render);

        /* ===== تنبيه قبل الصلاة (v0.122.0) =====
         * The `ithkar` keys (prayerOn · prayerBefore · prayerWhich · wudu* · duha* ·
         * qiyam* · the sounds), reached from the tool where the user is already LOOKING
         * at the times. v0.178.x — the only home of the prayer settings: the standalone
         * «إعدادات التنبيهات» tool is gone (its athkar half is the athkar tool's
         * «الإعدادات» tab). One save path — SYFS.ithkar.save (src/islam2.js, loaded after
         * this file but long before any mount) — a merge, so the athkar fields are never
         * touched, and this panel re-fills from storage.onChanged when the athkar tool saves.
         * v0.153.0 — which prayers alert = the switch on each prayer's ROW above; this
         * block keeps only the settings they share. Every change saves on the spot. */
        var nb=h('<div class="syf-form">'+
          '<div class="syf-note-hint" style="margin:0;font-weight:700;color:var(--ink)">⚙️ إعدادات التنبيه</div>'+
          '<div class="syf-row" style="align-items:center"><label style="margin:0" for="pn-bf">التنبيه قبل الأذان بـ</label><input type="number" class="syf-in" id="pn-bf" min="1" max="120" style="width:70px;text-align:center"><span class="syf-note-hint" style="margin:0">دقيقة</span></div>'+
          '<div class="syf-ikc" style="gap:6px"><div class="syf-ikc-h"><span>💧 تنبيه الوضوء قبل الأذان بـ (دقيقة)</span><input type="checkbox" id="pn-wu" aria-label="تنبيه الوضوء"></div><div id="pn-wul" style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px"></div><div class="syf-row" style="align-items:center"><label class="syf-ck" style="flex:1"><input type="checkbox" id="pn-wub"> <span>🔔 صوت تنبيه الوضوء</span></label><button class="syf-mini" type="button" data-snd="beep" title="استماع لصوت تنبيه الوضوء" aria-label="استماع لصوت تنبيه الوضوء">▶</button></div></div>'+
          '<div class="syf-row" style="align-items:center"><label style="margin:0" for="pn-dh">☀️ تنبيه الضحى بعد الشروق بـ</label><input type="number" class="syf-in" id="pn-dh" min="15" max="180" style="width:70px;text-align:center"><span class="syf-note-hint" style="margin:0">دقيقة</span></div>'+
          '<div class="syf-row" style="align-items:center"><label style="margin:0" for="pn-qy">🌙 تنبيه قيام الليل</label><select class="syf-in" id="pn-qy" style="flex:1"><option value="third">الثلث الأخير من الليل (الأفضل)</option><option value="half">منتصف الليل</option><option value="isha">بعد العشاء بساعة</option></select></div>'+
          '<div class="syf-row" style="align-items:center"><label class="syf-ck" style="flex:1"><input type="checkbox" id="pn-beep"> <span>🔔 صوت تنبيه قبل الأذان</span></label><button class="syf-mini" type="button" data-snd="beep" title="استماع لصوت التنبيه قبل الأذان" aria-label="استماع لصوت التنبيه قبل الأذان">▶</button></div>'+
          '<div class="syf-row" style="align-items:center"><label class="syf-ck" style="flex:1"><input type="checkbox" id="pn-adh"> <span>📢 صوت الأذان عند دخول الوقت</span></label><button class="syf-mini" type="button" data-snd="adhan" title="استماع للأذان" aria-label="استماع للأذان">▶</button><button class="syf-mini" type="button" data-snd="stop" title="إيقاف الأذان" aria-label="إيقاف الأذان">⏹</button></div>'+
          '<div class="syf-note-hint" id="pn-st" style="margin:0" aria-live="polite"></div>'+
        '</div>');
        paneS.appendChild(nb);
        var IK=SYFS.ithkar;
        var pnBf=nb.querySelector('#pn-bf'),pnSt=nb.querySelector('#pn-st'),pnBeep=nb.querySelector('#pn-beep'),pnAdh=nb.querySelector('#pn-adh'),pnDh=nb.querySelector('#pn-dh'),pnQy=nb.querySelector('#pn-qy');
        if(!IK){pnSt.textContent=prSt.textContent=SYFS.t('أداة التنبيهات غير محمّلة — أعد تحميل الصفحة.');}
        else{
          var pnWu=nb.querySelector('#pn-wu'),pnWul=nb.querySelector('#pn-wul'),pnWub=nb.querySelector('#pn-wub');
          IK.PRAYERS.forEach(function(p){var l=h('<label style="display:flex;flex-direction:column;align-items:center;gap:3px;margin:0;font-size:11px"><span></span><input type="number" class="syf-in" min="1" max="120" style="width:100%;min-width:0;padding:5px 2px;text-align:center"></label>');l.querySelector('span').textContent=SYFS.t(p[1]);/* i18n-dyn: a prayer name from PRAYERS */var i=l.querySelector('input');i.dataset.p=p[0];i.setAttribute('aria-label',SYFS.t('دقائق الوضوء قبل {0}',SYFS.t(p[1])));pnWul.appendChild(l);});
          var fillW=function(s){pnWu.checked=s.wuduOn;pnWub.checked=s.wuduBeep;pnWub.disabled=!s.wuduOn;pnWul.querySelectorAll('input').forEach(function(i){var on=IK.wuduFor(s,i.dataset.p);if(document.activeElement!==i)i.value=String(s.wuduBefore[i.dataset.p]);i.disabled=!s.wuduOn||!on;i.parentNode.style.opacity=on?'':'.55';i.parentNode.title=on?'':SYFS.t('مطفأة في الأذان — فعّلها من صفوف المواقيت');});};
          /* a typed minute count, clamped to the field's own min..max — not left to ikNorm,
             which REJECTS an out-of-range value to the default: «150» was saved as 10 under
             «حُفظ ✓». Empty or garbage keeps the saved value `d`. The correction leads the
             status line (`note`, the same msgid the removed ithkar tool used). */
          var clampMin=function(el,d,notes){var lo=+el.min,hi=+el.max,raw=parseInt(el.value,10),v=isFinite(raw)?Math.min(hi,Math.max(lo,raw)):d;el.value=String(v);if(v!==raw)notes.push(SYFS.t('المدى المسموح {0}–{1} دقيقة، فحُفظ {2}',lo,hi,v));return v;};
          var lead=function(notes){return notes.length?notes.join(' · ')+' · ':'';};
          var saidW=function(r,notes){if(!pnSt.isConnected)return;pnSt.textContent=lead(notes||[])+(r&&r.ok?(r.wudu?SYFS.t('حُفظ ✓ — {0}',r.wudu):(pnWu.checked?SYFS.t('حُفظ ✓'):SYFS.t('تنبيه الوضوء مطفأ'))):SYFS.t('حُفظ محلياً، وتعذّر تفعيل الجدولة'));};
          pnWu.addEventListener('change',function(){IK.save({wuduOn:pnWu.checked}).then(function(r){saidW(r);});});
          /* v0.178.x — the wudu chime, moved here from the removed «إعدادات التنبيهات» tool */
          pnWub.addEventListener('change',function(){IK.save({wuduBeep:pnWub.checked}).then(function(r){saidW(r);});});
          pnWul.addEventListener('change',function(){var wb={},notes=[];pnWul.querySelectorAll('input').forEach(function(i){wb[i.dataset.p]=clampMin(i,ik?ik.wuduBefore[i.dataset.p]:20,notes);});IK.save({wuduBefore:wb}).then(function(r){saidW(r,notes);});});
          var fill=function(s){ik=IK.norm(s);fillW(ik);pnBf.value=String(ik.prayerBefore);pnBeep.checked=ik.prayerBeep;pnAdh.checked=ik.adhanSound;pnDh.value=String(ik.duhaAfter);pnQy.value=ik.qiyamAt;render();};
          var said=function(r,notes,el){el=el||pnSt;if(!el.isConnected)return;el.textContent=lead(notes||[])+(r&&r.ok?(ik&&ik.prayerOn?(r.next?SYFS.t('حُفظ ✓ — {0}',r.next):SYFS.t('حُفظ ✓')):SYFS.t('التنبيه مطفأ')):SYFS.t('حُفظ محلياً، وتعذّر تفعيل الجدولة'));};
          /* a row switch. While the alert is OFF the stored per-prayer ticks are all
             "true" (the default), so the first switch turned on means THAT prayer only;
             the last one turned off turns the alert off. */
          flip=function(k){
            var s=ik||IK.norm(null),w={};
            if(k==='duha'){IK.save({duhaOn:!s.duhaOn}).then(function(r){prSt.textContent=r&&r.ok?(!s.duhaOn?SYFS.t('حُفظ ✓ — تنبيه الضحى مفعّل'):SYFS.t('تنبيه الضحى مطفأ')):SYFS.t('حُفظ محلياً، وتعذّر تفعيل الجدولة');});return;}
            if(k==='qiyam'){IK.save({qiyamOn:!s.qiyamOn}).then(function(r){prSt.textContent=r&&r.ok?(!s.qiyamOn?SYFS.t('حُفظ ✓ — تنبيه قيام الليل مفعّل'):SYFS.t('تنبيه قيام الليل مطفأ')):SYFS.t('حُفظ محلياً، وتعذّر تفعيل الجدولة');});return;}
            IK.PRAYERS.forEach(function(p){w[p[0]]=s.prayerOn?!!s.prayerWhich[p[0]]:false;});
            w[k]=!w[k];
            var any=IK.PRAYERS.some(function(p){return w[p[0]];});
            IK.save({prayerOn:any,prayerWhich:w}).then(function(r){said(r,null,prSt);});
          };
          var saveOpts=function(){var notes=[];IK.save({prayerBefore:clampMin(pnBf,ik?ik.prayerBefore:10,notes),prayerBeep:pnBeep.checked,adhanSound:pnAdh.checked,duhaAfter:clampMin(pnDh,ik?ik.duhaAfter:20,notes),qiyamAt:pnQy.value}).then(function(r){said(r,notes);});};
          pnBf.addEventListener('change',saveOpts);pnDh.addEventListener('change',saveOpts);pnQy.addEventListener('change',saveOpts);pnBeep.addEventListener('change',saveOpts);pnAdh.addEventListener('change',saveOpts);
          nb.querySelectorAll('[data-snd]').forEach(function(b){b.addEventListener('click',function(){try{chrome.runtime.sendMessage({type:'SYFS_ITHKAR',op:'sound',kind:b.dataset.snd},function(){void chrome.runtime.lastError;});}catch(e){}});});
          store.get('ithkar',null).then(fill);
          /* ONE listener per mounted panel, and it leaves with the panel (same rule as onStore
             in src/islam2-body.js): the old one only went quiet when `nb` was detached and
             stayed registered for the life of the page, holding the whole closed panel. */
          try{var onIk=function(ch,area){if(!nb.isConnected){chrome.storage.onChanged.removeListener(onIk);return;}if(area==='local'&&ch.ithkar)fill(ch.ithkar.newValue);};chrome.storage.onChanged.addListener(onIk);}catch(e){}
        }
      }
    },

    /* ===== Hijri <-> Gregorian ===== */
    {
      id:'hijri', name:'هجري ⇄ ميلادي', cat:'islam',
      /* Two opposing arrows, not the calendar-with-crescent this used to be. At
       * 16px an icon is read by its silhouette, and the old one collided twice on
       * the same shelf: with the occasions calendar, and with the crescent that is
       * now the category button itself. This tool is a converter; arrows say that
       * and match nothing else here. Solid to sit with the other new glyphs. */
      icon:'<svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M2 4.4 L15 4.4 L15 1.5 L22.4 6.0 L15 10.5 L15 7.6 L2 7.6 Z M22 16.4 L9 16.4 L9 13.5 L1.6 18.0 L9 22.5 L9 19.6 L22 19.6 Z"/></svg>',
      /* v0.113.0 stacked three blocks (two conversions + a date calculator) in one tall
         column. Split into TABS at the user's request (v0.176.x): «تحويل» keeps both
         conversions together — they answer the same question in opposite directions —
         and the calculator's two modes, which were a second segmented row INSIDE the
         panel, become tabs of their own. The panes are built once and toggled, so a
         date typed in one tab is still there after a look at another. The Umm al-Qura
         caveat sits under the tabs because every tab prints a Hijri date. */
      mount:function(body){
        body.appendChild(h('<div class="syf-form">'
          +'<div class="syf-seg" id="hj-tabs" role="tablist"><button type="button" role="tab" id="hj-t-conv" aria-controls="hj-p-conv" data-p="conv">تحويل التاريخ</button><button type="button" role="tab" id="hj-t-diff" aria-controls="hj-p-diff" data-p="diff">الفرق بين تاريخين</button><button type="button" role="tab" id="hj-t-add" aria-controls="hj-p-add" data-p="add">إضافة/طرح</button></div>'
          +'<div id="hj-p-conv" role="tabpanel" aria-labelledby="hj-t-conv" data-pane="conv" style="display:flex;flex-direction:column;gap:8px;width:100%"><label for="hj-g">ميلادي → هجري</label><input type="date" class="syf-in" id="hj-g"><div class="syf-out" id="hj-go" style="grid-template-columns:1fr"></div><hr style="border:none;border-top:1px solid var(--line);width:100%"><label for="hj-y">هجري → ميلادي (سنة/شهر/يوم)</label><div class="syf-row"><input type="number" class="syf-in" id="hj-y" min="1" max="9999" step="1"><input type="number" class="syf-in" id="hj-m" min="1" max="12" step="1"><input type="number" class="syf-in" id="hj-d" min="1" max="30" step="1"></div><div class="syf-out" id="hj-ho" style="grid-template-columns:1fr"></div></div>'
          +'<div id="hj-p-diff" role="tabpanel" aria-labelledby="hj-t-diff" data-pane="diff" style="display:none;flex-direction:column;gap:8px;width:100%"><div class="syf-row"><input type="date" class="syf-in" id="dc-a"><input type="date" class="syf-in" id="dc-b"></div><div class="syf-out" id="dc-od" style="grid-template-columns:1fr"></div></div>'
          +'<div id="hj-p-add" role="tabpanel" aria-labelledby="hj-t-add" data-pane="add" style="display:none;flex-direction:column;gap:8px;width:100%"><input type="date" class="syf-in" id="dc-base"><div class="syf-row"><input type="number" class="syf-in" id="dc-n" value="30" step="1"><select class="syf-in" id="dc-unit"><option value="d">يوماً</option><option value="w">أسبوعاً</option><option value="m">شهراً</option><option value="y">سنة</option></select></div><div class="syf-out" id="dc-oa" style="grid-template-columns:1fr"></div></div>'
          +'<div class="syf-note-hint">حسب تقويم أم القرى — قد يختلف يوماً عن رؤية الهلال في بلدك.</div>'
          +'</div>'));
        var months=['محرّم','صفر','ربيع الأول','ربيع الآخر','جمادى الأولى','جمادى الآخرة','رجب','شعبان','رمضان','شوال','ذو القعدة','ذو الحجة'];
        function gToH(d){try{var f=new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn',{day:'numeric',month:'numeric',year:'numeric'}).formatToParts(d);var o={};f.forEach(function(p){o[p.type]=p.value;});return {y:+o.year,m:+o.month,d:+o.day};}catch(e){return null;}}
        /* a printable Hijri date: before 1 محرّم 1هـ Intl answers year 0 or below */
        function hOk(hh){ return !!(hh&&hh.y>=1); }
        /* ⚠️ v0.139.3: `valueAsDate=new Date()` wrote the UTC day (yesterday in Riyadh
           00–03) and reading it back gave UTC midnight (yesterday west of Greenwich).
           The field is a LOCAL day string both ways; a date is built at local noon. */
        function todayISO(){ var d=new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
        var g=body.querySelector('#hj-g');g.value=todayISO();
        /* The rest of the extension prints LATIN digits next to inputs that already show
           them (prayer times, the clock); this tool printed ٢٧ beside an input reading 27.
           -u-nu-latn on the locale, never a character swap on the output (§6.101/6) —
           month and weekday names still follow the interface language.
           ⛔ useGrouping:false — a Hijri year is a label, not a quantity, and 1446 must
           never come out as "1,446". */
        function loc(){ return SYFS.i18n.locale()+'-u-nu-latn'; }
        function num(n){try{return Number(n).toLocaleString(loc(),{useGrouping:false});}catch(e){return String(n);}}
        function hText(hh){ return num(hh.d)+' '+SYFS.t(months[hh.m-1])+' '+num(hh.y); }
        function showG(){var box=body.querySelector('#hj-go');var d=localDate(g.value)||localDate(todayISO());d.setHours(12);var hh=gToH(d);box.textContent='';box.appendChild(orow('هجري',hOk(hh)?hText(hh):SYFS.t('قبل بداية التقويم الهجري')));}
        g.addEventListener('change',showG);
        /* Hijri → the local-noon Date of that day, or null when the day does not exist
           (30 of a 29-day month). The old walk stopped after 1200 steps wherever it was
           and printed that day as the answer. Jump by the estimated gap, then check the
           few days around it for an EXACT match — no match means no such day. */
        function hToDate(ty,tm,td){
          if(!(ty>=1&&ty<=9999&&tm>=1&&tm<=12&&td>=1&&td<=30)||ty%1||tm%1||td%1) return null;
          var at=function(o){return new Date(622,6,19+o,12);};
          var off=Math.round((ty-1)*354.367+(tm-1)*29.53+td-1);
          for(var i=0;i<30;i++){var hh=gToH(at(off));if(!hh)return null;var diff=Math.round((hh.y-ty)*354.367+(hh.m-tm)*29.53+(hh.d-td));if(Math.abs(diff)<3)break;off-=diff;}
          for(var k=-6;k<=6;k++){var x=gToH(at(off+k));if(x&&x.y===ty&&x.m===tm&&x.d===td)return at(off+k);}
          return null;
        }
        function hToG(){var ty=+body.querySelector('#hj-y').value,tm=+body.querySelector('#hj-m').value,td=+body.querySelector('#hj-d').value;var box=body.querySelector('#hj-ho');var d=hToDate(ty,tm,td);box.textContent='';if(!d){box.appendChild(orow('ميلادي',SYFS.t('لا يوجد هذا اليوم في التقويم الهجري (أم القرى) — راجع اليوم والشهر.')));return;}box.appendChild(orow('ميلادي',fmtDate(d)));}
        /* the Hijri fields open on TODAY — a hard-coded 1446 aged a year every year */
        var hNow=gToH(localDate(todayISO()));
        if(hOk(hNow)){ body.querySelector('#hj-y').value=hNow.y; body.querySelector('#hj-m').value=hNow.m; body.querySelector('#hj-d').value=hNow.d; }
        ['#hj-y','#hj-m','#hj-d'].forEach(function(s){body.querySelector(s).addEventListener('change',hToG);});

        /* ---- date calculator (v0.113.0) ----
         * ⚠️ Whole-day arithmetic ONLY, and deliberately on LOCAL date parts. `new
         * Date(input.value)` parses "2026-08-27" as UTC midnight, so east of Greenwich
         * every result lands a day early — the same trap §5.9/4 names for the calendar's
         * day keys. Building from the y/m/d fields keeps the day the one on the screen.
         * ⛔ No hours anywhere here: a DST boundary makes a "day" 23 or 25 hours, and
         * dividing a millisecond span by 86400000 across one gives x.96 days. */
        /* ⚠️ `new Date(y, m, d)` and `Date.UTC` read years 0–99 as 1900–1999, so 0050-01-01
           came out as 1950 with no warning. Every date built from a typed year goes
           through setFullYear, which takes the year as written. */
        function mkDate(y,m,d){ var x=new Date(2000,0,1); x.setFullYear(y,m,d); return x; }
        function localDate(v){ var p=String(v||'').split('-'); return (p.length===3&&p[0]) ? mkDate(+p[0],+p[1]-1,+p[2]) : null; }
        function utcDay(d){ var x=new Date(0); x.setUTCFullYear(d.getFullYear(),d.getMonth(),d.getDate()); return x.getTime(); }
        function dayCount(a,b){ return Math.round((utcDay(b)-utcDay(a))/86400000); }
        function monthLen(y,m){ return mkDate(y,m+1,0).getDate(); }
        function fmtDate(d){ try{ return d.toLocaleDateString(loc(),{weekday:'long',year:'numeric',month:'long',day:'numeric'}); }catch(e){ return String(d); } }
        function orow(label,val){ var r=document.createElement('div'); var s=document.createElement('span'); s.textContent=SYFS.t(label); var b=document.createElement('b'); b.textContent=val; r.appendChild(s); r.appendChild(b); return r; }
        var dcA=body.querySelector('#dc-a'),dcB=body.querySelector('#dc-b'),dcBase=body.querySelector('#dc-base'),
            dcN=body.querySelector('#dc-n'),dcUnit=body.querySelector('#dc-unit'),dcOd=body.querySelector('#dc-od'),dcOa=body.querySelector('#dc-oa');
        dcA.value=dcB.value=dcBase.value=todayISO();
        function diffRun(){
          dcOd.textContent='';
          var a=localDate(dcA.value),b=localDate(dcB.value);
          if(!a||!b){ dcOd.appendChild(orow('النتيجة','—')); return; }
          var days=dayCount(a,b),abs=Math.abs(days);
          /* the Gregorian "years and months" split is calendar-aware, not days/365 */
          var lo=days<0?b:a, hi=days<0?a:b;
          var y=hi.getFullYear()-lo.getFullYear(), m=hi.getMonth()-lo.getMonth(), d=hi.getDate()-lo.getDate();
          if(d<0){ m--; d+=monthLen(hi.getFullYear(),hi.getMonth()-1); }
          if(m<0){ y--; m+=12; }
          dcOd.appendChild(orow('عدد الأيام', num(abs)));
          dcOd.appendChild(orow('بالتفصيل', SYFS.t('{0} سنة · {1} شهراً · {2} يوماً', num(y), num(m), num(d))));
          dcOd.appendChild(orow('عدد الأسابيع', num(Math.floor(abs/7)) + ' + ' + num(abs%7)));
          dcOd.appendChild(orow('بالتقويم الهجري', SYFS.t('{0} سنة تقريباً', num(Math.round(abs/354.367*10)/10))));
          if(days<0) dcOd.appendChild(orow('ملاحظة', SYFS.t('التاريخ الثاني قبل الأول.')));
        }
        /* the date inputs hold years 1–9999; a result outside them is not a date this
           tool can show, and 99999999 years used to print «Invalid Date» and «NaN» */
        function addRun(){
          dcOa.textContent='';
          var base=localDate(dcBase.value); if(!base){ dcOa.appendChild(orow('النتيجة','—')); return; }
          var n=Number(dcN.value); if(dcN.value===''||!isFinite(n)) n=0;
          n=Math.trunc(n);
          var r=mkDate(base.getFullYear(),base.getMonth(),base.getDate());
          if(dcUnit.value==='d') r.setDate(r.getDate()+n);
          else if(dcUnit.value==='w') r.setDate(r.getDate()+n*7);
          /* ⚠️ setMonth clamps: 31 Jan + 1 month is 3 March, not 28 February. Pin the
             day back to the end of the target month so "in a month" stays in a month. */
          else if(dcUnit.value==='m'){ var dd=r.getDate(); r.setDate(1); r.setMonth(r.getMonth()+n); r.setDate(Math.min(dd,monthLen(r.getFullYear(),r.getMonth()))); }
          else { var dy=r.getDate(); r.setDate(1); r.setFullYear(r.getFullYear()+n); r.setDate(Math.min(dy,monthLen(r.getFullYear(),r.getMonth()))); }
          if(isNaN(r.getTime())||r.getFullYear()<1||r.getFullYear()>9999){
            dcOa.appendChild(orow('النتيجة', SYFS.t('النتيجة خارج المدى المدعوم (من سنة 1 إلى 9999) — صغّر العدد.')));
            return;
          }
          dcOa.appendChild(orow('التاريخ الناتج', fmtDate(r)));
          var rh=gToH(r); if(hOk(rh)) dcOa.appendChild(orow('هجري', hText(rh)));
          dcOa.appendChild(orow('عدد الأيام من اليوم', num(dayCount(new Date(),r))));
        }
        [dcA,dcB].forEach(function(el){ el.addEventListener('input',diffRun); el.addEventListener('change',diffRun); });
        [dcBase,dcN].forEach(function(el){ el.addEventListener('input',addRun); el.addEventListener('change',addRun); });
        dcUnit.addEventListener('change',addRun);
        showG(); hToG(); diffRun(); addRun();

        /* the tab strip: aria-selected, one Tab stop (roving tabindex), arrow keys */
        var seg=body.querySelector('#hj-tabs'), tabs=Array.prototype.slice.call(seg.querySelectorAll('[role="tab"]'));
        function tab(k,focus){
          tabs.forEach(function(b){ var on=b.dataset.p===k; b.classList.toggle('on',on); b.setAttribute('aria-selected',on?'true':'false'); b.tabIndex=on?0:-1; if(on&&focus) b.focus(); });
          body.querySelectorAll('[data-pane]').forEach(function(p){ p.style.display=p.getAttribute('data-pane')===k?'flex':'none'; });
        }
        seg.addEventListener('click',function(e){ var b=e.target.closest('[role="tab"]'); if(b) tab(b.dataset.p); });
        seg.addEventListener('keydown',function(e){
          var i=tabs.indexOf(e.target), n=tabs.length, j=-1;
          if(i<0) return;
          /* «next» is the reading direction: leftwards in RTL */
          if(e.key==='ArrowRight'||e.key==='ArrowLeft') j=(i+(((e.key==='ArrowLeft')===(SYFS.i18n.dir()==='rtl'))?1:n-1))%n;
          else if(e.key==='Home') j=0;
          else if(e.key==='End') j=n-1;
          if(j<0) return;
          e.preventDefault(); tab(tabs[j].dataset.p,true);
        });
        tab('conv');
      }
    },

    /* The tasbih counter lived here until v0.80.0 — removed at the user's request.
     * Its stored key ('tasbih') is left alone rather than deleted on upgrade: it is
     * a few bytes of dead data, and wiping a count someone accumulated is not a
     * side effect an icon-and-tool removal should carry. */

    /* ===== Clipboard history (v0.114.0) =====
     * ⛔ EXPLICIT CAPTURE ONLY — there is no `copy` listener anywhere in this tool, and
     * there must never be one. A clipboard history that fills itself is a tool that
     * reads every password, every card number and every private message its owner ever
     * copies, on every site, forever — and stores them in plain text. The version that
     * is worth having is the one you press a button to add to.
     * ⛔ Nothing is captured on panel open either: the read happens inside the click
     * handler because `navigator.clipboard.readText()` requires a user gesture, and
     * that requirement is the feature, not an obstacle.
     * ⚠️ The entries ARE plain text in chrome.storage.local. The panel says so, the cap
     * is 50, and «امسح الكل» is one two-click press away. */
    {
      id:'clipboard', name:'تاريخ الحافظة', cat:'note', beta:true,
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M8 11h8M8 15h5"/></svg>',
      mount:function(body){
        var CAP=50, MAXLEN=4000;
        body.appendChild(h('<div class="syf-form">'+
          '<button class="syf-btn" id="cb-grab">📋 التقط ما في الحافظة الآن</button>'+
          '<div class="syf-note-hint">لا يُلتقط شيء تلقائياً — لا يعمل هذا إلا حين تضغط الزرّ. النصوص تُحفظ على جهازك كما هي (بلا تشفير)، فلا تحفظ هنا ما لا تحبّ أن يُقرأ.</div>'+
          '<input class="syf-in" id="cb-q" placeholder="بحث…">'+
          '<div class="syf-note-list" id="cb-list"></div>'+
          '<div class="syf-row"><button class="syf-mini" id="cb-clear">مسح الكل</button></div>'+
        '</div>'));
        var list=body.querySelector('#cb-list'),q=body.querySelector('#cb-q'),grab=body.querySelector('#cb-grab');
        var items=[];
        function save(){ store.set('clip_history',items); render(); }
        function when(ts){ try{ return new Date(ts).toLocaleString(SYFS.i18n.locale(),{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }catch(e){ return ''; } }
        function render(){
          var needle=(q.value||'').trim().toLowerCase();
          list.textContent='';
          var shown=items.filter(function(it){ return !needle || it.t.toLowerCase().indexOf(needle)>=0; });
          if(!shown.length){ list.appendChild(h('<div class="syf-empty">لا شيء محفوظ بعد. انسخ نصاً ثم اضغط الزرّ أعلاه.</div>')); return; }
          shown.forEach(function(it){
            var r=h('<div class="syf-note-row"><span class="t" style="cursor:pointer"></span><button class="c">نسخ</button><button class="x">✕</button></div>');
            /* ⛔ user text — textContent, never innerHTML */
            var one=it.t.replace(/\s+/g,' ').trim();
            r.querySelector('.t').textContent=(one.length>72?one.slice(0,72)+'…':one)+' · '+when(it.at);
            r.querySelector('.t').title=it.t.slice(0,300);
            function put(){ try{ navigator.clipboard && navigator.clipboard.writeText(it.t); }catch(e){} }
            r.querySelector('.t').addEventListener('click',put);
            r.querySelector('.c').addEventListener('click',put);
            r.querySelector('.x').addEventListener('click',function(){ var i=items.indexOf(it); if(i>=0){items.splice(i,1);save();} });
            list.appendChild(r);
          });
        }
        grab.addEventListener('click',function(){
          if(!navigator.clipboard||!navigator.clipboard.readText){ grab.textContent=SYFS.t('المتصفّح لا يسمح بقراءة الحافظة هنا.'); return; }
          navigator.clipboard.readText().then(function(txt){
            txt=String(txt||'');
            /* ⚠️ cut, do not reject — a paste one character over the limit should lose the
               character, not the paste (§5.9/12). And an empty clipboard is not an error. */
            if(!txt.trim()){ grab.textContent=SYFS.t('الحافظة فارغة.'); setTimeout(function(){ if(grab.isConnected) grab.textContent=SYFS.t('📋 التقط ما في الحافظة الآن'); },1800); return; }
            txt=txt.slice(0,MAXLEN);
            items=items.filter(function(x){ return x.t!==txt; });          /* re-copying moves it to the top */
            items.unshift({ t:txt, at:Date.now() });
            if(items.length>CAP) items.length=CAP;
            save();
            grab.textContent=SYFS.t('أُضيف ✓');
            setTimeout(function(){ if(grab.isConnected) grab.textContent=SYFS.t('📋 التقط ما في الحافظة الآن'); },1200);
          }).catch(function(){
            grab.textContent=SYFS.t('لم يُسمح بقراءة الحافظة — اسمح بها من قفل العنوان في المتصفّح.');
          });
        });
        q.addEventListener('input',render);
        /* two-click confirm, never confirm() — same rule as the checklist (§v0.111.0) */
        var clr=body.querySelector('#cb-clear'),clrArmed=false,clrT=null;
        function clrRest(){ clrArmed=false; clr.textContent=SYFS.t('مسح الكل'); clr.classList.remove('danger'); }
        clr.addEventListener('click',function(){
          if(!items.length) return;
          if(!clrArmed){ clrArmed=true; clr.textContent=SYFS.t('⚠ اضغط للتأكيد'); clr.classList.add('danger'); clrT=setTimeout(clrRest,4000); return; }
          clearTimeout(clrT); clrRest(); items=[]; save();
        });
        store.get('clip_history',[]).then(function(v){
          /* ⛔ whitelist on read: an imported settings file is a second way into this key */
          items=(Array.isArray(v)?v:[]).filter(function(x){ return x&&typeof x.t==='string'; })
                                       .map(function(x){ return { t:x.t.slice(0,MAXLEN), at:(typeof x.at==='number'?x.at:0) }; })
                                       .slice(0,CAP);
          render();
        });
      }
    },

    /* ===== Checklist ===== */
    {
      id:'checklist', name:'قائمة المهام', cat:'note',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l2 2 3-3M4 12l2 2 3-3M4 18l2 2 3-3M13 6h7M13 12h7M13 18h7"/></svg>',
      mount:function(body){
        body.appendChild(h('<div class="syf-form"><div class="syf-row"><input class="syf-in" id="cl-in" placeholder="نقطة جديدة…"><button class="syf-btn" id="cl-add">+</button></div><div class="syf-note-hint" id="cl-count"></div><div class="syf-note-list" id="cl-list"></div><div class="syf-row"><button class="syf-mini" id="cl-cd">مسح المنجز</button><button class="syf-mini" id="cl-ca">مسح الكل</button></div></div>'));
        var inp=body.querySelector('#cl-in'),list=body.querySelector('#cl-list'),count=body.querySelector('#cl-count');var items=[];
        function render(){ list.innerHTML=''; if(!items.length){list.appendChild(h('<div class="syf-empty">لا نقاط بعد. أضف نقطة.</div>'));count.textContent='';} var done=0; items.forEach(function(it,i){ if(it.done)done++; var r=h('<div class="syf-note-row'+(it.done?' done':'')+'"><input type="checkbox" '+(it.done?'checked':'')+'><span class="t'+(it.done?' done':'')+'"></span><button class="x">✕</button></div>'); r.querySelector('.t').textContent=it.t; r.querySelector('input').addEventListener('change',function(){it.done=this.checked;save();}); r.querySelector('.x').addEventListener('click',function(){items.splice(i,1);save();}); list.appendChild(r); }); if(items.length)count.textContent='('+done+'/'+items.length+')'; }
        function save(){store.set('checklist',items);render();}
        function add(){var v=inp.value.trim();if(!v)return;items.push({t:v,done:false});inp.value='';save();}
        body.querySelector('#cl-add').addEventListener('click',add);inp.addEventListener('keydown',function(e){if(e.key==='Enter')add();});
        body.querySelector('#cl-cd').addEventListener('click',function(){items=items.filter(function(i){return !i.done;});save();});
        /* ⛔ two-click confirm, NOT confirm(). This runs in a content script over
           somebody else's page: a browser dialog there BLOCKS the whole tab and every
           listener in it, and it wears the host site's origin in its title bar — a
           destructive prompt that looks like the site asked it. The pattern is the
           project's own (rail.js «إعادة تعيين», ai-keys.js). (v0.111.0) */
        var caB=body.querySelector('#cl-ca'),caArmed=false,caT=null;
        function caRest(){caArmed=false;caB.textContent=SYFS.t('مسح الكل');caB.classList.remove('danger');}
        caB.addEventListener('click',function(){
          if(!items.length)return;
          if(!caArmed){caArmed=true;caB.textContent=SYFS.t('⚠ اضغط للتأكيد');caB.classList.add('danger');caT=setTimeout(caRest,4000);return;}
          clearTimeout(caT);caRest();items=[];save();
        });
        store.get('checklist',[]).then(function(v){items=(Array.isArray(v)?v:[]).map(function(o){return {t:o.t||o.text||'',done:!!o.done};});render();});
      }
    },

    /* Sticky notes merged into the "ملاحظات" tool (pin button → SYFS.addSticky). */

    /* ===== Translation =====
     * v0.113.0 — the user's OWN provider first, MyMemory as the fallback.
     *
     * Two problems with the old shape, and the second is the serious one:
     *   1. MyMemory is a free service with a low daily cap and weak Arabic. The user
     *      often already has a Claude/GPT/Gemini/PROF key configured, which is better
     *      at this than the free endpoint by a wide margin.
     *   2. ⚠️ It sent whatever the user typed to a third party ON A BUTTON PRESS, with
     *      no gate and without naming the destination — while src/mail.js, using the
     *      SAME plumbing, has a full consent gate that names the provider first. Two
     *      tools in one extension cannot answer the same privacy question differently.
     *
     * ⛔ There is still exactly ONE HTTP path to a provider (SYFS.ai → the worker). This
     * adds no host and no key handling: `SYFS.ai.callProvider` is reused verbatim, the
     * key is never read on this page, and the prompt is built here in one auditable
     * place. The consent answer is per-destination (`tr_consent_ai` / `tr_consent_mm`)
     * — agreeing to send text to your own provider is not agreeing to send it to a
     * public web service. */
    {
      id:'translate', name:'الترجمة', cat:'note',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h7"/><path d="M9 3v2c0 4.4-2.2 8-5 8"/><path d="M5 9c0 2.1 3 3.9 6.7 4"/><path d="M12 20l4-9 4 9"/><path d="M19.1 18h-6.2"/></svg>',
      mount:function(body){
        var L={'عربي':'ar','إنجليزي':'en','فرنسي':'fr','تركي':'tr','أردو':'ur','إسباني':'es'};
        var LNAME={ar:'العربية',en:'الإنجليزية',fr:'الفرنسية',tr:'التركية',ur:'الأردية',es:'الإسبانية'};
        body.appendChild(h(
          '<div class="syf-form">'+
            '<div class="syf-row"><select class="syf-in" id="tr-f"></select><button class="syf-mini" id="tr-sw" type="button">⇄</button><select class="syf-in" id="tr-t"></select></div>'+
            '<textarea class="syf-in" id="tr-in" rows="3" placeholder="النص…"></textarea>'+
            '<div class="syf-note-hint syf-tr-cnt" id="tr-cnt"></div>'+
            '<button class="syf-btn" id="tr-go">ترجمة</button>'+
            '<div class="syf-empty" id="tr-gate" style="display:none"></div>'+
            '<textarea class="syf-in" id="tr-out" rows="3" readonly></textarea>'+
            '<div class="syf-note-hint" id="tr-via"></div>'+
          '</div>'));
        var f=body.querySelector('#tr-f'),t=body.querySelector('#tr-t'),out=body.querySelector('#tr-out'),
            gate=body.querySelector('#tr-gate'),via=body.querySelector('#tr-via'),goB=body.querySelector('#tr-go');
        /* ⛔ explicit `value` on every option (§6.103/4) */
        Object.keys(L).forEach(function(k){
          [f,t].forEach(function(sel){ var o=document.createElement('option'); o.value=L[k]; o.textContent=SYFS.t(k); sel.appendChild(o); });
        });
        t.selectedIndex=1;

        function AI(){ return (window.SYFS && SYFS.ai) || null; }

        /* the payload that leaves the device, assembled in ONE place so it is auditable:
           the text and the two language names. Nothing about the page, the site or the
           user travels with it. */
        function prompt(q){
          return 'Translate the following text from ' + LNAME[f.value] + ' to ' + LNAME[t.value] +
                 '. Reply with the translation ONLY — no preamble, no notes, no quotes.\n\n' + q;
        }

        /* consent gate — names the destination BEFORE the first send, and remembers the
           answer per destination. Two clicks in the panel, never a browser dialog. */
        function ensureConsent(key, who){
          return store.get(key,false).then(function(ok){
            if (ok) return true;
            gate.textContent='';
            gate.style.display='';
            var line=document.createElement('div');
            line.textContent=SYFS.t('سيُرسَل النصّ الذي كتبته إلى {0} للترجمة. لا يُرسَل شيء آخر.', who);
            var row=document.createElement('div'); row.className='syf-row'; row.style.marginTop='8px';
            var yes=h('<button class="syf-btn">موافق، ترجِم</button>'), no=h('<button class="syf-mini">إلغاء</button>');
            row.appendChild(yes); row.appendChild(no);
            gate.appendChild(line); gate.appendChild(row);
            return new Promise(function(res){
              yes.addEventListener('click',function(){ gate.style.display='none'; store.set(key,true); res(true); });
              no.addEventListener('click',function(){ gate.style.display='none'; res(false); });
            });
          });
        }

        /* ⚠️ v0.139.3 — MyMemory answers its errors IN the translation field, with HTTP
           200: «MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS…» or «QUERY
           LENGTH LIMIT EXCEEDED» was pasted into the output as if it were the text. It
           also refuses a query over 500 characters, so a paragraph is sent as sentence-
           sized chunks, one after another, and put back together. */
        var MM_MAX=480, MM_CHUNKS=20;
        function mmParse(raw){
          var j; try{ j=JSON.parse(raw); }catch(e){ return {err:'svc'}; }
          var txt=j&&j.responseData&&j.responseData.translatedText, st=+(j&&j.responseStatus);
          if(typeof txt!=='string'||!txt.trim()) return {err:'svc'};
          if(/MYMEMORY WARNING/i.test(txt)||st===429) return {err:'quota'};
          if((st&&st!==200)||/QUERY LENGTH LIMIT|INVALID LANGUAGE PAIR|INVALID (SOURCE|TARGET) LANGUAGE|SELECT TWO DISTINCT LANGUAGES/i.test(txt)) return {err:'svc'};
          return {text:txt};
        }
        function mmChunks(q){
          var parts=String(q).replace(/([.!?؟。\n]+)/g,'$1\u0000').split('\u0000'), out=[], cur='';
          parts.forEach(function(p){
            while(p.length>MM_MAX){
              var cut=p.lastIndexOf(' ',MM_MAX); if(cut<MM_MAX/2) cut=MM_MAX;
              if(cur){ out.push(cur); cur=''; }
              out.push(p.slice(0,cut)); p=p.slice(cut);
            }
            if(cur && (cur+p).length>MM_MAX){ out.push(cur); cur=p; } else cur+=p;
          });
          if(cur) out.push(cur);
          return out;
        }
        function viaMyMemory(q){
          var parts=mmChunks(q), acc='', i=0;
          if(parts.length>MM_CHUNKS) return Promise.resolve({err:'long'});
          function next(){
            if(i>=parts.length) return {text:acc.trim()};
            var c=parts[i++], s=c.trim(); if(!s) return next();
            return bgFetch('https://api.mymemory.translated.net/get?q='+encodeURIComponent(s)+'&langpair='+f.value+'|'+t.value)
              .then(function(r){
                if(!r||!r.ok) return {err:'net'};
                var p=mmParse(r.body); if(p.err) return p;
                acc+=p.text+(/\n\s*$/.test(c)?'\n':' ');
                return next();
              });
          }
          return Promise.resolve().then(next);
        }
        /* v0.140.0 — ⇄ swaps the two languages and moves the translation into the input
           (a round trip in one click). The list has no «auto» entry, so the button is
           never disabled for it. The counter shows the free service's budget only when
           no provider of the user's own is set: with one, there is no 9,600 cap. */
        var inp=body.querySelector('#tr-in'),cnt=body.querySelector('#tr-cnt'),sw=body.querySelector('#tr-sw'),free=true;
        sw.title=SYFS.t('اعكس الاتجاه'); sw.setAttribute('aria-label',sw.title);
        sw.addEventListener('click',function(){
          var a=f.value; f.value=t.value; t.value=a;
          var o=out.value.trim(); if(o&&o!=='…'){ inp.value=o; out.value=''; via.textContent=''; }
          count();
        });
        function count(){
          var q=inp.value.trim(), b=trBudget(q.length, q?mmChunks(q).length:0, MM_MAX, MM_CHUNKS, free);
          var nf=b.n.toLocaleString('en-US');
          cnt.textContent = !free ? SYFS.t('{0} محرفاً', nf)
            : b.parts>1 ? SYFS.t('{0} / {1} — يُرسَل على {2} أجزاء', nf, b.limit.toLocaleString('en-US'), b.parts)
            : SYFS.t('{0} / {1}', nf, b.limit.toLocaleString('en-US'));
          cnt.classList.toggle('over', b.over);
          if(b.over){ cnt.textContent+=' · '+SYFS.t('أطول من حدّ الخدمة المجانية — قسّمه.'); }
          goB.disabled=b.over;
          return b;
        }
        inp.addEventListener('input',count);
        (function(){ var ai=AI(); if(!ai){ count(); return; }
          ai.loadCfg().then(function(cfg){ free=!ai.configured(cfg); }).catch(function(){}).then(count); })();
        count();

        function mmError(code){
          if(code==='quota') return SYFS.t('انتهى الحدّ اليومي المجاني لخدمة MyMemory — حاول لاحقاً.');
          if(code==='long') return SYFS.t('النصّ أطول من حدّ الخدمة المجانية ({0} محرف تقريباً) — قسّمه.', MM_MAX*MM_CHUNKS);
          return SYFS.t('تعذّرت الترجمة');
        }

        goB.addEventListener('click',function(){
          var q=inp.value.trim();
          if(!q||count().over) return;
          if(f.value===t.value){ out.value=q; via.textContent=SYFS.t('اللغتان متطابقتان.'); return; }
          gate.style.display='none';
          goB.disabled=true; out.value='…'; via.textContent='';
          var ai=AI();
          var start = ai ? ai.loadCfg().then(function(cfg){ return ai.configured(cfg) ? cfg : null; }).catch(function(){ return null; })
                         : Promise.resolve(null);
          start.then(function(cfg){
            if (cfg) {
              return ensureConsent('tr_consent_ai', ai.label(cfg.provider)).then(function(ok){
                if(!ok){ out.value=''; return; }
                return ai.callProvider(cfg,[{role:'user',content:prompt(q)}],
                                       'You are a translation engine. Output only the translation.')
                  .then(function(res){
                    var ex=ai.extractReply(cfg.provider,res&&res.body);
                    if(ex.text){ out.value=ex.text.trim(); via.textContent=SYFS.t('تُرجم عبر {0}.', ai.label(cfg.provider)); return; }
                    /* the provider failed — fall through to the free service, but ASK first */
                    return freePath(q, ex.err);
                  });
              });
            }
            return freePath(q,'');
          }).catch(function(){ out.value=SYFS.t('تعذّرت الترجمة'); })
            .then(function(){ goB.disabled=false; });
        });

        function freePath(q, why){
          return ensureConsent('tr_consent_mm','MyMemory').then(function(ok){
            if(!ok){ out.value=''; return; }
            return viaMyMemory(q).then(function(res){
              var txt=res&&res.text;
              /* v0.137.1 — no upsell line here. The provenance stays (the text left the
                 device, the user is told where it went); the "add your own key" nudge is
                 gone: the 🤖 button says that already, and this panel is not an ad. */
              if(txt){ out.value=txt; via.textContent=why ? SYFS.t('تعذّر مزوّدك ({0}) — تُرجم عبر MyMemory (خدمة مجانية، جودتها أقلّ).', why)
                                                        : SYFS.t('تُرجم عبر {0}.', 'MyMemory'); }
              else { out.value=mmError(res&&res.err); }
            });
          });
        }
      }
    },

    /* ===== Voice & Text ===== */
    {
      id:'voice', name:'صوت ونص', cat:'note',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>',
      /* ⚠️ v0.111.0 — the language was hard-coded 'ar-SA' in BOTH the speaker and the
         listener, so an English panel spoke English text with an Arabic voice and
         transcribed English speech against an Arabic model (which returns Arabic
         letters, i.e. garbage, not an error). It is a SELECT now rather than a
         straight read of SYFS.i18n, for two reasons the UI language cannot answer:
         dictation language is a property of what you are about to SAY, not of the
         panel you are saying it into; and the voices actually installed on the
         machine are the real constraint — Chrome ships neither list to us, so the
         default is derived from the UI language and the user overrides it. */
      /* v0.138.0 — redesigned around the one control that matters. The old panel was a
         label, a select, a box and three same-sized buttons: nothing said which of them
         was the point, dictation showed NOTHING until you stopped talking
         (`interimResults:false`), the machine picked the voice for you — so Arabic could
         come out in an English voice — and there was no way to empty a box that only
         ever grows. Now: one big microphone that carries its own state, live text while
         you speak, a real voice picker, and speed/pitch behind ⚙ so the panel stays two
         controls deep. The layout is CSS (`.syf-vo-stage`/`.syf-vo-mic` in rail.css);
         nothing here positions anything. */
      mount:function(body){
        var MIC='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>';
        body.appendChild(h('<div class="syf-form">'+
          '<div class="syf-row"><select class="syf-in" id="vo-lang" aria-label="اللغة" style="flex:1"></select><button class="syf-mini" id="vo-cog" type="button" aria-expanded="false" title="خيارات النطق" aria-label="خيارات النطق"><svg class="syf-cog-i" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h8M16 6h4M4 12h4M12 12h8M4 18h11M19 18h1"/><circle cx="14" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg></button></div>'+
          '<div class="syf-vo-opts" id="vo-opts" hidden>'+
            '<label style="margin:0">الصوت الناطق</label><select class="syf-in" id="vo-voice"></select>'+
            '<div class="syf-row"><label style="margin:0">السرعة <b id="vo-rv" dir="ltr">1.0</b></label><input type="range" id="vo-rate" min="0.5" max="2" step="0.1" value="1" style="flex:1"></div>'+
            '<div class="syf-row"><label style="margin:0">النبرة <b id="vo-pv" dir="ltr">1.0</b></label><input type="range" id="vo-pitch" min="0.5" max="2" step="0.1" value="1" style="flex:1"></div>'+
          '</div>'+
          '<div class="syf-vo-stage">'+
            '<button class="syf-vo-mic" id="vo-mic" type="button" aria-pressed="false" title="إملاء">'+MIC+'</button>'+
            '<div class="syf-note-hint" id="vo-st"></div>'+
          '</div>'+
          '<textarea class="syf-in" id="vo-t" rows="4" placeholder="اكتب للنطق، أو اضغط الميكروفون للإملاء…"></textarea>'+
          '<div class="syf-row"><button class="syf-btn" id="vo-say">▶ نطق</button><button class="syf-mini" id="vo-stop">■ إيقاف</button><button class="syf-mini" id="vo-copy">نسخ</button><button class="syf-mini" id="vo-clear">مسح</button></div>'+
        '</div>'));
        var t=body.querySelector('#vo-t'),st=body.querySelector('#vo-st'),langSel=body.querySelector('#vo-lang');
        /* ⛔ every <option> gets an explicit `value`: tree() translates option TEXT, and an
           option without a value has its text AS its value ⇒ the lookup returns undefined
           in English and the tool silently speaks nothing (§6.103/4). */
        var LANGS=[['ar-SA','العربية'],['en-US','الإنجليزية (أمريكا)'],['en-GB','الإنجليزية (بريطانيا)'],['fr-FR','الفرنسية'],['tr-TR','التركية'],['ur-PK','الأردية'],['es-ES','الإسبانية'],['de-DE','الألمانية']];
        LANGS.forEach(function(L){var o=document.createElement('option');o.value=L[0];o.textContent=SYFS.t(L[1]);langSel.appendChild(o);});
        /* default follows the UI language, and the stored choice wins over it */
        var uiLang=(window.SYFS&&SYFS.i18n&&SYFS.i18n.get)?SYFS.i18n.get():'ar';
        langSel.value=uiLang==='en'?'en-US':'ar-SA';
        store.get('voice_lang','').then(function(v){
          /* whitelist on READ: the value reaches SpeechRecognition.lang, and an
             imported settings file is a second way into this key (§5.11/1) */
          for(var i=0;i<LANGS.length;i++){if(LANGS[i][0]===v){langSel.value=v;return;}}
        });
        /* a live dictation is handed over to the new language further down (⛔ not
           `rec=null` here: that orphaned the session's onend and left the mic "on") */
        langSel.addEventListener('change',function(){store.set('voice_lang',langSel.value);fillVoices();});

        /* ===== ⚙ — speed, pitch and the voice itself =====
           Folded away because they are set once and then forgotten; the panel is two
           controls deep until you ask for more. */
        var opts=body.querySelector('#vo-opts'),cog=body.querySelector('#vo-cog'),
            voiceSel=body.querySelector('#vo-voice'),
            rateIn=body.querySelector('#vo-rate'),pitchIn=body.querySelector('#vo-pitch'),
            rateV=body.querySelector('#vo-rv'),pitchV=body.querySelector('#vo-pv');
        cog.addEventListener('click',function(){
          var open=opts.hasAttribute('hidden');
          if(open)opts.removeAttribute('hidden');else opts.setAttribute('hidden','');
          cog.setAttribute('aria-expanded',open?'true':'false');
        });

        /* ⛔ REJECT, never clamp (§4.1). These two numbers reach the speech engine, and a
           settings import is a second way into the keys — a value outside the range the
           slider offers is not repaired into the nearest legal one, it is discarded and
           the default stands. */
        function num(v,lo,hi,dflt){ v=parseFloat(v); return (isFinite(v)&&v>=lo&&v<=hi)?v:dflt; }
        var rate=1,pitch=1,wantVoice='';
        function showNums(){ rateV.textContent=rate.toFixed(1); pitchV.textContent=pitch.toFixed(1); }
        showNums();
        rateIn.addEventListener('input',function(){ rate=num(rateIn.value,0.5,2,1); showNums(); store.set('voice_rate',rate); });
        pitchIn.addEventListener('input',function(){ pitch=num(pitchIn.value,0.5,2,1); showNums(); store.set('voice_pitch',pitch); });
        store.get('voice_rate',1).then(function(v){ rate=num(v,0.5,2,1); rateIn.value=rate; showNums(); });
        store.get('voice_pitch',1).then(function(v){ pitch=num(v,0.5,2,1); pitchIn.value=pitch; showNums(); });

        /* The voices actually installed on THIS machine, filtered to the chosen language.
           Chrome fills the list asynchronously — an empty first call is normal, not an
           error — so we also listen for `voiceschanged`, and that listener removes itself
           once the tool is gone (the window can be closed while the list is still cold). */
        function fillVoices(){
          var all=[]; try{ all=window.speechSynthesis?(speechSynthesis.getVoices()||[]):[]; }catch(err){ all=[]; }
          var base=String(langSel.value).split('-')[0].toLowerCase();
          var mine=all.filter(function(v){ return String(v.lang||'').replace('_','-').toLowerCase().indexOf(base)===0; });
          if(!mine.length) mine=all;
          voiceSel.textContent='';
          var d=document.createElement('option'); d.value='';
          /* i18n-dyn: the "let the system choose" row, rebuilt whenever the list changes */
          d.textContent=SYFS.t('صوت النظام الافتراضي'); voiceSel.appendChild(d);
          /* i18n-dyn: a voice's own name and BCP-47 tag — data from the OS, never a label */
          mine.forEach(function(v){ var o=document.createElement('option'); o.value=v.name; o.textContent=v.name+' · '+v.lang; voiceSel.appendChild(o); });
          /* whitelist on READ: the stored name is only ever matched against the list above
             and never handed to the engine as text (§5.11/1). No match ⇒ system default. */
          if(wantVoice){ for(var i=0;i<mine.length;i++){ if(mine[i].name===wantVoice){ voiceSel.value=wantVoice; return; } } }
        }
        function onVoices(){
          if(!body.isConnected){ try{ speechSynthesis.removeEventListener('voiceschanged',onVoices); }catch(err){} return; }
          fillVoices();
        }
        voiceSel.addEventListener('change',function(){ wantVoice=voiceSel.value; store.set('voice_name',wantVoice); });
        store.get('voice_name','').then(function(v){ wantVoice=typeof v==='string'?v:''; fillVoices(); });
        fillVoices();
        if(window.speechSynthesis&&speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged',onVoices);

        /* ===== speak ===== */
        function pickVoice(){
          if(!wantVoice) return null;
          var all=[]; try{ all=speechSynthesis.getVoices()||[]; }catch(err){ return null; }
          for(var i=0;i<all.length;i++) if(all[i].name===wantVoice) return all[i];
          return null;
        }
        body.querySelector('#vo-say').addEventListener('click',function(){
          if(!window.speechSynthesis){ st.textContent=SYFS.t('النطق غير مدعوم'); return; }
          var q=t.value.trim(); if(!q) return;
          var u=new SpeechSynthesisUtterance(t.value);
          u.lang=langSel.value; u.rate=rate; u.pitch=pitch;
          /* a voice object can go stale between getVoices() and here (the list is rebuilt
             when the OS adds or removes one). An exception inside a click listener is
             invisible to the caller — the button would just stop working — so a refused
             voice costs the default voice, never the press. */
          var v=pickVoice(); if(v){ try{ u.voice=v; }catch(err){} }
          u.onend=function(){ if(!listening) st.textContent=''; };
          u.onerror=u.onend;
          speechSynthesis.cancel(); st.textContent=SYFS.t('ينطق…'); speechSynthesis.speak(u);
        });
        body.querySelector('#vo-stop').addEventListener('click',function(){ if(window.speechSynthesis)speechSynthesis.cancel(); if(listening)stopDictation(); else st.textContent=''; });
        /* mid-dictation too: the pending guess goes with the text, and its final must not
           come back into the empty box */
        body.querySelector('#vo-clear').addEventListener('click',function(){ t.value=''; committed=''; interim=''; consumed=seen; t.focus(); });
        body.querySelector('#vo-copy').addEventListener('click',function(){
          var q=t.value; if(!q) return;
          navigator.clipboard.writeText(q).then(function(){ st.textContent=SYFS.t('نُسخ ✓'); },
                                                function(){ st.textContent=SYFS.t('تعذّر النسخ'); });
        });

        /* ===== dictate =====
           `interimResults` is ON now, which is the whole difference: you see the words as
           you say them. It also means the box holds two different things at once — what
           the engine has COMMITTED and what it is still guessing — so the guess is never
           appended, it is re-rendered after the committed text every time. `committed`
           starts as whatever you had typed, and re-syncs if you edit the box mid-sentence
           (your keystrokes win; the pending guess is dropped). */
        /* v0.144.0 — two faults from real use: «it stops suddenly» and «it deletes what it
           wrote». Both came from treating ONE recognition session as the whole dictation.
           1. ⛔ Chrome ends a session by itself — after a few seconds of silence (`no-speech`),
              on a network blip, and at about a minute even with `continuous`. The old
              `onend` switched the mic off. Now `listening` is the USER's intent, and a
              session that ends while it is still true is replaced by a new one (a short
              backoff; permission / device errors stop with a message; a long silence stops
              with a message too, so a forgotten mic does not listen forever).
           2. ⛔ The words you watch appear are the engine's GUESS (interim). A session that
              ended with a guess pending wrote `committed` back into the box — the guess
              vanished in front of you. The last guess is now KEPT. And typing while a guess
              was showing folded it into `committed`, after which its final version landed a
              second time; the pending results are now marked consumed instead.
           Each session numbers its results from 0 again, so finals are tracked per session
           (`fin`) and never re-appended. The box is only ever `committed + interim`. */
        var SR=window.SpeechRecognition||window.webkitSpeechRecognition,rec=null,committed='',interim='';
        var listening=false,consumed=0,seen=0,empty=0,restartT=0,stopMsg='',netErr=false;
        var MAX_EMPTY=6;                        /* ≈ a minute of silence, then stop and say so */
        function render(){ t.value=interim?join(committed,interim):committed; t.scrollTop=t.scrollHeight; }
        /* a space between two pieces unless one of them already carries it */
        function join(a,b){ return (a&&b&&!/\s$/.test(a)&&!/^\s/.test(b))?a+' '+b:a+b; }
        t.addEventListener('input',function(){
          if(!listening) return;
          /* your keystroke wins. An edit BEFORE the guess keeps the guess as a guess; an edit
             into it makes it yours, and its final version must not arrive a second time */
          if(interim&&t.value.slice(-interim.length)===interim){ committed=t.value.slice(0,t.value.length-interim.length); return; }
          committed=t.value; interim=''; consumed=seen;
        });
        var mic=body.querySelector('#vo-mic');
        function micState(on){
          mic.setAttribute('aria-pressed',on?'true':'false');
          mic.title=on?SYFS.t('أوقف الإملاء'):SYFS.t('إملاء');
        }
        function fatalMsg(c){
          if(c==='not-allowed') return SYFS.t('الميكروفون محجوب — اسمح به من أيقونة القفل في شريط العنوان ثم أعد المحاولة.');
          if(c==='service-not-allowed') return SYFS.t('خدمة الإملاء غير متاحة في هذا المتصفّح.');
          if(c==='audio-capture') return SYFS.t('لا يوجد ميكروفون يعمل على هذا الجهاز.');
          if(c==='language-not-supported') return SYFS.t('هذه اللغة غير مدعومة في الإملاء — اختر لغة أخرى.');
          return '';
        }
        /* the dictation is over (by you, an error, or the panel closing) */
        function finish(msg){
          listening=false; clearTimeout(restartT);
          if(interim){ committed=join(committed,interim); interim=''; render(); }
          micState(false); st.textContent=msg||'';
        }
        function session(){
          var r=new SR(), fin={};
          r.lang=langSel.value; r.continuous=true; r.interimResults=true;
          rec=r; consumed=0; seen=0;
          r.onresult=function(e){
            if(rec!==r) return;
            empty=0;
            var guess='';
            for(var i=e.resultIndex;i<e.results.length;i++){
              if(i<consumed) continue;
              var res=e.results[i];
              if(res.isFinal){ if(!fin[i]){ fin[i]=1; committed=join(committed,res[0].transcript); } }
              else guess=join(guess,res[0].transcript);
            }
            seen=e.results.length; interim=guess;
            if(netErr){ netErr=false; st.textContent=SYFS.t('يستمع…'); }
            render();
          };
          r.onerror=function(e){
            if(rec!==r) return;
            var c=e&&e.error, m=fatalMsg(c);
            if(m){ listening=false; stopMsg=m; }
            else if(c==='network'){ netErr=true; st.textContent=SYFS.t('انقطع الاتصال بخدمة الإملاء — أعيد المحاولة…'); }
          };
          r.onend=function(){
            if(rec!==r) return;
            rec=null;
            /* the guess the engine was still holding stays on the page */
            if(interim){ committed=join(committed,interim); interim=''; render(); }
            if(!listening||!body.isConnected){ finish(stopMsg); return; }
            empty++;
            if(empty>MAX_EMPTY){ finish(SYFS.t('توقّف الإملاء بعد صمت طويل — اضغط الميكروفون للمتابعة.')); return; }
            restartT=setTimeout(function(){ if(listening&&body.isConnected) begin(); }, Math.min(150*empty,1500));
          };
          return r;
        }
        function begin(){
          var r=session();
          try{ r.start(); if(!netErr) st.textContent=SYFS.t('يستمع…'); }
          catch(err){ rec=null; finish(SYFS.t('تعذّر بدء الإملاء.')); }
        }
        function stopDictation(){
          listening=false; clearTimeout(restartT);
          if(rec){ try{ rec.stop(); }catch(err){ rec=null; finish(); } }
          else finish();
        }
        mic.addEventListener('click',function(){
          if(!SR){ st.textContent=SYFS.t('الإملاء غير مدعوم'); return; }
          if(listening){ stopDictation(); return; }
          if(window.speechSynthesis) speechSynthesis.cancel();   /* never listen to ourselves */
          listening=true; empty=0; committed=t.value; interim=''; stopMsg=''; netErr=false;
          micState(true);
          /* v0.139.3: closing the panel used to leave the recognizer — and the browser's
             microphone indicator — running with nobody to stop it. One watch for the whole
             dictation (not per session) aborts it the moment the panel is gone. */
          var micGuard=setInterval(function(){
            if(listening&&body.isConnected) return;
            clearInterval(micGuard);
            if(body.isConnected) return;
            listening=false; clearTimeout(restartT);
            if(rec){ var r=rec; rec=null; try{ r.abort(); }catch(err){} }
          },1000);
          begin();
        });
        /* switching the language mid-dictation carries on in the new one: the session ends,
           and the restart reads the select again */
        langSel.addEventListener('change',function(){ if(listening&&rec){ empty=0; try{ rec.stop(); }catch(err){} } });
      }
    },

    /* Image compressor moved to src/media.js (imgcompress v2 — batch + target size,
     * shares SYFS.imgkit with the other image tools). */

    /* ===== QR generator — «مولّد QR» v2 (v0.171.0) =====
     * Approved look: option 1 of the rail-window proposals — the preview on top, five
     * side tabs «أيقونة فوق نص» (البيانات · الألوان · الأشكال · الشعار · التصدير).
     * The encoder grew with it (lib/qr.js: levels L/M/Q/H, versions 1–40, see
     * tools/qr-test.js); a logo in the middle switches the code to level H by itself,
     * which is what lets up to 30% of the square be covered and still read.
     * Kept from v0.113.0: the six payload kinds and their escaping, geolocation only on a
     * click. The DESIGN (colours, shapes, logo preset, export) is remembered under
     * `qr_design`; the DATA never is — a Wi-Fi password does not belong in storage. */
    {
      id:'qrgen', name:'مولّد QR', cat:'util',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M21 14v7h-7"/></svg>',
      mount:function(body){
        var SV='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
        var IC={
          data:SV+'<path d="M4 7h16M4 12h16M4 17h10"/></svg>',
          color:SV+'<path d="M12 3a9 9 0 1 0 0 18c1 0 2-1 1-2.5S13 16 15 16h2a4 4 0 0 0 4-4c0-5-4-9-9-9z"/><path d="M7.5 11h.01M10 7.5h.01M14.5 7.5h.01"/></svg>',
          shape:SV+'<rect x="4" y="4" width="7" height="7"/><circle cx="17.5" cy="7.5" r="3.5"/><path d="M4 20l3.5-6 3.5 6z"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
          logo:SV+'<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 16l5-5 4 4 3-3 4 4"/><path d="M15 9h.01"/></svg>',
          out:SV+'<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>'
        };
        /* logo glyphs as raw SVG path data: drawn through Path2D, so no <img> and nothing
           the host page's CSP could block */
        var GLYPH={
          wa:'M3 21l1.6-4.7A8.5 8.5 0 1 1 8 19.6L3 21zM9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .9c-1.2-.5-2.3-1.6-2.8-2.8l.9-1-1-2z',
          wifi:'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
          tel:'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
          mail:'M3 5h18v14H3zM3 6l9 7 9-7',
          link:'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1'
        };
        var TYPES=[['text','نص/رابط'],['wifi','واي‑فاي'],['tel','هاتف'],['sms','رسالة'],['geo','موقع'],['card','بطاقة']];
        function glyph(d){ return SV+'<path d="'+d+'"/></svg>'; }
        var TYPE_IC={ text:glyph(GLYPH.link), wifi:glyph(GLYPH.wifi), tel:glyph(GLYPH.tel),
          sms:glyph('M4 5h16v11H8l-4 4z'), geo:glyph('M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11zM12 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4z'),
          card:glyph('M3 5h18v14H3zM8 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM13 10h5M13 14h4') };
        var LOGO_IC={ none:glyph('M5 5l14 14M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'), wa:glyph(GLYPH.wa), wifi:glyph(GLYPH.wifi), tel:glyph(GLYPH.tel),
          mail:glyph(GLYPH.mail), link:glyph(GLYPH.link), up:glyph('M12 16V4M7 9l5-5 5 5M5 20h14') };
        /* one choice in a 3-column grid: the glyph, then its name */
        function gridBtn(label,ic,on,onClick){
          var b=h('<button type="button" class="syf-qr-gb" role="radio"><span class="syf-qr-gi" aria-hidden="true">'+ic+'</span><span class="syf-qr-gn"></span></button>');
          b.querySelector('.syf-qr-gn').textContent=SYFS.t(label);
          b.classList.toggle('on',!!on); b.setAttribute('aria-checked',on?'true':'false');
          b.addEventListener('click',function(){ onClick(b); });
          return b;
        }
        var DOTS=[['sq','مربّع'],['ci','دائرة'],['rd','مستدير'],['di','ماسة']];
        /* ⚠️ no diamond eye: a rotated finder breaks the 1:1:3:1:1 run a scanner looks
           for along its horizontal lines (specs/qr-studio.md §9) */
        var EYES=[['sq','مربّع'],['rd','ناعم'],['ci','دائرة']];
        var LOGOS=[['none','بلا'],['wa','واتساب'],['wifi','واي‑فاي'],['tel','هاتف'],['mail','بريد'],['link','رابط'],['up','صورتك']];
        var COLS=['#1d2430','#457364','#1d4ed8','#7c3aed','#b45309','#be123c'], BGS=['#ffffff','#f5efe4','#eef6f2','transparent'];
        /* what a transparent code will be placed on — the contrast check reads this */
        var UNDERS=['#ffffff','#f5efe4','#6b7280','#1d2430'];
        var HEX=/^#[0-9a-f]{6}$/i;
        var QD={col:'#1d2430',bg:'#ffffff',under:'#ffffff',dot:'sq',eye:'sq',logo:'none',lsz:22,fmt:'png',px:1024};
        var S={type:'text',f:{txt:'https://',ssid:'',pass:'',enc:'WPA',hid:false,tel:'',smsn:'',smst:'',lat:'',lon:'',cn:'',co:'',cp:'',ce:''},logoImg:null};
        /* the rail runs inside the host page; qrtool.html (an extension window) does not */
        var inPage=!SYFS.inExtPage();
        Object.keys(QD).forEach(function(k){ S[k]=QD[k]; });
        function ids(a){ return a.map(function(x){ return x[0]; }); }
        /* a stored design is taken field by field, each against its own whitelist —
           storage is writable by the settings import, so nothing in it is trusted */
        function takeDesign(v){
          if(!v||typeof v!=='object') return;
          if(HEX.test(v.col)) S.col=v.col;
          if(HEX.test(v.bg)||v.bg==='transparent') S.bg=v.bg;
          if(HEX.test(v.under)) S.under=v.under;
          if(ids(DOTS).indexOf(v.dot)>=0) S.dot=v.dot;
          if(ids(EYES).indexOf(v.eye)>=0) S.eye=v.eye;
          if(v.logo!=='up'&&ids(LOGOS).indexOf(v.logo)>=0) S.logo=v.logo;
          if(v.lsz>=12&&v.lsz<=30) S.lsz=Math.round(v.lsz);
          if(['png','svg','pdf'].indexOf(v.fmt)>=0) S.fmt=v.fmt;
          if([512,1024,2048,4096].indexOf(v.px)>=0) S.px=v.px;
        }
        function saveDesign(){ var o={}; Object.keys(QD).forEach(function(k){ o[k]=S[k]; }); if(o.logo==='up') o.logo='none'; store.set('qr_design',o); }

        /* ---------- payload (unchanged rules from v0.113.0) ---------- */
        /* ⛔ vCard uses CRLF and escapes its own specials — a comma or a semicolon in a
           name silently splits the field into two on the phone that scans it. */
        function vesc(s){ return String(s).replace(/([\\;,])/g,'\\$1').replace(/\r?\n/g,'\\n'); }
        function f(k){ return String(S.f[k]||'').trim(); }
        function payload(){
          var t=S.type;
          if(t==='wifi') return qrWifi(f('ssid'),S.f.enc,S.f.pass,S.f.hid);
          if(t==='tel'){ var n=f('tel'); return n?('tel:'+n.replace(/[^\d+]/g,'')):''; }
          if(t==='sms'){ var sn=f('smsn').replace(/[^\d+]/g,''); if(!sn) return ''; var sb=f('smst'); return 'SMSTO:'+sn+(sb?(':'+sb):''); }
          if(t==='geo'){ var la=parseFloat(f('lat')),lo=parseFloat(f('lon')); return (isFinite(la)&&isFinite(lo))?('geo:'+la+','+lo):''; }
          if(t==='card'){
            var nm=f('cn'); if(!nm) return '';
            var L=['BEGIN:VCARD','VERSION:3.0','N:'+vesc(nm),'FN:'+vesc(nm)];
            if(f('co')) L.push('ORG:'+vesc(f('co')));
            if(f('cp')) L.push('TEL;TYPE=CELL:'+f('cp').replace(/[^\d+]/g,''));
            if(f('ce')) L.push('EMAIL:'+vesc(f('ce')));
            L.push('END:VCARD');
            return L.join('\r\n');
          }
          var x=f('txt'); return x==='https://'?'':x;
        }

        /* ---------- drawing: one geometry for canvas and SVG ---------- */
        var Q=4;   /* quiet zone, modules */
        function logoN(qr){ if(S.logo==='none'||(S.logo==='up'&&!S.logoImg)) return 0; var n=Math.round(qr.size*S.lsz/100); return n%2===qr.size%2?n:n+1; }
        function inLogo(qr,r,c,n){ var lo=(qr.size-n)/2; return n>0&&r>=lo-.5&&r<lo+n-.5&&c>=lo-.5&&c<lo+n-.5; }
        function isEye(sz,r,c){ return (r<7&&c<7)||(r<7&&c>=sz-7)||(r>=sz-7&&c<7); }
        function rr(ctx,x,y,w,h,r){ ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
        function eyeRadii(k){ return k==='ci'?[3.5,2.5,1.5]:k==='rd'?[2,1.3,.8]:[0,0,0]; }
        function paint(ctx,qr,W,forceBg){
          var n=qr.size+Q*2, m=W/n, bg=S.bg==='transparent'?(forceBg||null):S.bg, ln=logoN(qr);
          ctx.clearRect(0,0,W,W);
          if(bg){ ctx.fillStyle=bg; ctx.fillRect(0,0,W,W); }
          ctx.fillStyle=S.col;
          ctx.beginPath();
          for(var r=0;r<qr.size;r++) for(var c=0;c<qr.size;c++){
            if(!qr.modules[r][c]||isEye(qr.size,r,c)||inLogo(qr,r,c,ln)) continue;
            var x=(c+Q)*m, y=(r+Q)*m;
            if(S.dot==='ci'){ ctx.moveTo(x+m*.95,y+m/2); ctx.arc(x+m/2,y+m/2,m*.45,0,Math.PI*2); }
            else if(S.dot==='rd') rr(ctx,x+m*.04,y+m*.04,m*.92,m*.92,m*.32);
            else if(S.dot==='di'){ var k=m*.68; ctx.moveTo(x+m/2,y+m/2-k); ctx.lineTo(x+m/2+k,y+m/2); ctx.lineTo(x+m/2,y+m/2+k); ctx.lineTo(x+m/2-k,y+m/2); ctx.closePath(); }   /* .68 not .5: neighbours overlap, or the module centre a scanner samples falls on a gap */
            else ctx.rect(x-.25,y-.25,m+.5,m+.5);   /* a hair of overlap: no seams between squares */
          }
          ctx.fill();
          var R=eyeRadii(S.eye);
          [[0,0],[0,qr.size-7],[qr.size-7,0]].forEach(function(p){
            var x=(p[1]+Q)*m, y=(p[0]+Q)*m;
            ctx.beginPath(); rr(ctx,x,y,7*m,7*m,R[0]*m); rr(ctx,x+m,y+m,5*m,5*m,R[1]*m); ctx.fill('evenodd');
            ctx.beginPath(); rr(ctx,x+2*m,y+2*m,3*m,3*m,R[2]*m); ctx.fill();
          });
          if(ln){
            var lo=((qr.size-ln)/2+Q)*m, side=ln*m;
            ctx.fillStyle=bg||'#ffffff'; ctx.beginPath(); rr(ctx,lo,lo,side,side,side*.22); ctx.fill();
            drawLogo(ctx,lo+side*.1,lo+side*.1,side*.8);
          }
        }
        function drawLogo(ctx,x,y,s){
          if(S.logo==='up'&&S.logoImg){
            var im=S.logoImg, k=Math.min(s/im.width,s/im.height), w=im.width*k, hh=im.height*k;
            ctx.drawImage(im,x+(s-w)/2,y+(s-hh)/2,w,hh); return;
          }
          if(!GLYPH[S.logo]) return;
          ctx.save();
          ctx.fillStyle=S.logo==='wa'?'#25d366':S.col; ctx.beginPath(); ctx.arc(x+s/2,y+s/2,s/2,0,Math.PI*2); ctx.fill();
          ctx.translate(x+s*.2,y+s*.2); ctx.scale(s*.6/24,s*.6/24);
          ctx.strokeStyle='#ffffff'; ctx.lineWidth=2.2; ctx.lineCap='round'; ctx.lineJoin='round';
          ctx.stroke(new Path2D(GLYPH[S.logo]));
          ctx.restore();
        }
        /* SVG: module units in the viewBox, so it is exact at any print size. Colours are
           whitelisted hex; the only raster is the logo, re-encoded to PNG (a user's SVG
           logo never travels into this file as markup — no script, no external ref). */
        function toSvg(qr){
          var n=qr.size+Q*2, ln=logoN(qr), out=[], d='';
          function rp(x,y,w,h,r){ if(!r) return 'M'+x+' '+y+'h'+w+'v'+h+'h'+(-w)+'z';
            return 'M'+(x+r)+' '+y+'h'+(w-2*r)+'a'+r+' '+r+' 0 0 1 '+r+' '+r+'v'+(h-2*r)+'a'+r+' '+r+' 0 0 1 '+(-r)+' '+r+'h'+(2*r-w)+'a'+r+' '+r+' 0 0 1 '+(-r)+' '+(-r)+'v'+(2*r-h)+'a'+r+' '+r+' 0 0 1 '+r+' '+(-r)+'z'; }
          for(var r=0;r<qr.size;r++) for(var c=0;c<qr.size;c++){
            if(!qr.modules[r][c]||isEye(qr.size,r,c)||inLogo(qr,r,c,ln)) continue;
            var x=c+Q, y=r+Q;
            if(S.dot==='ci') d+='M'+(x+.05)+' '+(y+.5)+'a.45 .45 0 1 0 .9 0a.45 .45 0 1 0-.9 0z';
            else if(S.dot==='rd') d+=rp(+(x+.04).toFixed(2),+(y+.04).toFixed(2),.92,.92,.3);
            else if(S.dot==='di') d+='M'+(x+.5)+' '+(y-.18)+'l.68 .68-.68 .68-.68-.68z';
            else d+='M'+x+' '+y+'h1v1h-1z';
          }
          var R=eyeRadii(S.eye), e='', p='';
          [[0,0],[0,qr.size-7],[qr.size-7,0]].forEach(function(q){ var x=q[1]+Q, y=q[0]+Q; e+=rp(x,y,7,7,R[0])+rp(x+1,y+1,5,5,R[1]); p+=rp(x+2,y+2,3,3,R[2]); });
          out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+n+' '+n+'" width="'+S.px+'" height="'+S.px+'" shape-rendering="geometricPrecision">');
          if(S.bg!=='transparent') out.push('<rect width="'+n+'" height="'+n+'" fill="'+S.bg+'"/>');
          out.push('<path fill="'+S.col+'" d="'+d+'"/><path fill="'+S.col+'" fill-rule="evenodd" d="'+e+'"/><path fill="'+S.col+'" d="'+p+'"/>');
          if(ln){
            var lo=(qr.size-ln)/2+Q, cv=document.createElement('canvas'); cv.width=cv.height=256;
            drawLogo(cv.getContext('2d'),0,0,256);
            out.push('<rect x="'+lo+'" y="'+lo+'" width="'+ln+'" height="'+ln+'" rx="'+(ln*.22)+'" fill="'+(S.bg==='transparent'?'#ffffff':S.bg)+'"/>');
            out.push('<image x="'+(lo+ln*.1)+'" y="'+(lo+ln*.1)+'" width="'+(ln*.8)+'" height="'+(ln*.8)+'" href="'+cv.toDataURL('image/png')+'"/>');
          }
          out.push('</svg>');
          return out.join('');
        }

        /* ---------- readability: contrast + orientation ---------- */
        /* ⚠️ transparent was measured against white until the phase-2 review: dark dots
           exported transparent and dropped on a dark slide read «✓ جاهز» and scanned as
           nothing. Now it is measured against S.under, and a transparent code always
           carries a reminder — the PNG does not remember what it was meant to sit on. */
        function check(){
          var c=qrContrast(S.col,S.bg,S.under), tr=S.bg==='transparent';
          if(c.inv) return {msg:tr?SYFS.t('النقاط أفتح من الخلفية التي سيوضع عليها — كثير من الكاميرات لا تقرأ الألوان المعكوسة.'):SYFS.t('ألوان معكوسة (نقاط فاتحة على خلفية داكنة) — كثير من الكاميرات لا تقرؤها.')};
          if(c.ratio<4) return {msg:tr?SYFS.t('تباين ضعيف ({0}:1) مع الخلفية التي سيوضع عليها — اجعل النقاط أغمق أو ضعه على سطح أفتح.',c.ratio.toFixed(1)):SYFS.t('تباين ضعيف ({0}:1) — اجعل النقاط أغمق أو الخلفية أفتح.',c.ratio.toFixed(1))};
          if(tr) return {soft:true,msg:SYFS.t('خلفية شفّافة: يُقرأ الرمز فوق سطح فاتح كالذي اخترته فقط — لا تضعه على صورة أو شريحة داكنة.')};
          return null;
        }

        /* ---------- layout: preview on top, five icon tabs beside ---------- */
        var tabs=[
          {label:'البيانات',ic:IC.data,build:buildData},
          {label:'الألوان',ic:IC.color,build:buildColors},
          {label:'الأشكال',ic:IC.shape,build:buildShapes},
          {label:'الشعار',ic:IC.logo,build:buildLogo},
          {label:'التصدير',ic:IC.out,build:buildExport}
        ];
        var pv=h('<div class="syf-qr-pv"><canvas width="336" height="336" aria-label="معاينة رمز QR" role="img"></canvas><div class="syf-qr-st" aria-live="polite"></div>'+
          '<div class="syf-row"><button class="syf-btn" type="button" data-dl>تنزيل</button><button class="syf-mini" type="button" data-copy>نسخ صورة</button></div></div>');
        var cv=pv.querySelector('canvas'), st=pv.querySelector('.syf-qr-st'), dlB=pv.querySelector('[data-dl]');
        var T=SYFS.tabs(body,tabs,0);
        body.insertBefore(pv,T.bar.nextSibling);   /* column 2, above the panel, kept across tabs */

        var cur=null;
        function draw(){
          var data=payload();
          dlB.textContent=SYFS.t('تنزيل {0}',S.fmt.toUpperCase());
          if(!data){ cur=null; cv.getContext('2d').clearRect(0,0,cv.width,cv.height); st.className='syf-qr-st'; st.textContent=SYFS.t('أدخل البيانات في تبويب «البيانات».'); dlB.disabled=true; return; }
          var ec=(S.logo!=='none'&&(S.logo!=='up'||S.logoImg))?'H':'M';
          var qr=SYFS.qr.generate(data,{ec:ec});
          if(!qr){ cur=null; cv.getContext('2d').clearRect(0,0,cv.width,cv.height); st.className='syf-qr-st warn';
            st.textContent=SYFS.t('البيانات طويلة جداً ({0} بايت) — اختصرها أو أزل الشعار.',new TextEncoder().encode(data).length); dlB.disabled=true; return; }
          cur=qr; dlB.disabled=false;
          /* the preview shows a transparent code ON the surface it is meant for */
          paint(cv.getContext('2d'),qr,cv.width,S.bg==='transparent'?S.under:null);
          var w=check(), ready='✓ '+SYFS.t('جاهز · إصدار {0} · تصحيح {1} · {2} بايت',qr.version,qr.ec,new TextEncoder().encode(data).length);
          st.className='syf-qr-st '+(w?'warn':'ok');
          st.textContent=!w?ready:w.soft?(ready+' — ⚠️ '+w.msg):('⚠️ '+w.msg);
        }
        function set(k,v){ S[k]=v; saveDesign(); draw(); }
        function pick(group,btn){ group.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on',x===btn); if(x.hasAttribute('aria-checked')) x.setAttribute('aria-checked',x===btn?'true':'false'); }); }

        function buildData(p){
          /* 3 per row, glyph beside the name (v0.171.0 — a wrapped segmented strip read as
             one long sentence of words) */
          var seg=h('<div class="syf-qr-grid" role="radiogroup"></div>');
          TYPES.forEach(function(t){ seg.appendChild(gridBtn(t[1],TYPE_IC[t[0]],S.type===t[0],function(b){ S.type=t[0]; pick(seg,b); fields(); draw(); })); });
          var box=h('<div class="syf-form" style="margin-top:9px"></div>');
          p.appendChild(seg); p.appendChild(box);
          function inp(k,ph,ltr,type){ var i=h('<input class="syf-in">'); i.placeholder=SYFS.t(ph); if(ltr) i.dir='ltr'; if(type) i.type=type; i.value=S.f[k];
            i.addEventListener('input',function(){ S.f[k]=i.value; draw(); }); box.appendChild(i); return i; }
          /* ⚠️ a password or a contact card typed into the rail is typed into the host
             page's DOM (an open shadow root its scripts can read). Said BEFORE the first
             field, with the way out: the same generator in an extension window. */
          function pageWarn(){
            if(!inPage) return;
            var wn=h('<div class="syf-note-hint" role="note" style="display:flex;flex-direction:column;align-items:flex-start;gap:6px;border:1px solid var(--line);border-inline-start:3px solid var(--pri);border-radius:9px;padding:8px 10px;background:var(--soft);color:var(--ink)"><span></span><button class="syf-mini" type="button">فتح في نافذة مستقلة</button></div>');
            wn.querySelector('span').textContent=SYFS.t('تكتب هنا داخل صفحة {0} وسكربتاتها تستطيع قراءة الحقول. لكلمة مرور أو بيانات شخصية افتح المولّد في نافذة الإضافة.',location.hostname||location.protocol);
            var ob=wn.querySelector('button');
            ob.addEventListener('click',function(){ ob.disabled=true; SYFS.openToolPage('qrgen',function(ok){ ob.disabled=false; if(!ok) wn.querySelector('span').textContent=SYFS.t('تعذّر فتح النافذة المستقلة — افتح «وضع العمل» واستعمل المولّد من هناك.'); }); });
            box.appendChild(wn);
          }
          function fields(){
            box.textContent='';
            var t=S.type;
            if(t==='text') inp('txt','نص أو رابط…',false);
            if(t==='wifi'){ pageWarn(); inp('ssid','اسم الشبكة (SSID)'); inp('pass','كلمة المرور',false,'password');
              var enc=h('<select class="syf-in"><option value="WPA">WPA/WPA2</option><option value="WEP">WEP</option><option value="nopass">بدون كلمة مرور</option></select>');
              enc.value=S.f.enc; enc.addEventListener('change',function(){ S.f.enc=enc.value; draw(); }); box.appendChild(enc);
              var hid=h('<label class="syf-ck"><input type="checkbox"> <span>شبكة مخفية (لا يظهر اسمها في قائمة الشبكات)</span></label>'), hc=hid.querySelector('input');
              hc.checked=!!S.f.hid; hc.addEventListener('change',function(){ S.f.hid=hc.checked; draw(); }); box.appendChild(hid); }
            if(t==='tel') inp('tel','+9665xxxxxxxx',true);
            if(t==='sms'){ inp('smsn','+9665xxxxxxxx',true); inp('smst','نص الرسالة'); }
            if(t==='geo'){
              var row=h('<div class="syf-row"></div>'); box.appendChild(row);
              var la=inp('lat','خط العرض',true), lo=inp('lon','خط الطول',true); row.appendChild(la); row.appendChild(lo);
              var here=h('<button class="syf-mini" type="button">📍 موقعي الحالي</button>'); box.appendChild(here);
              /* ⛔ geolocation is only ever read on an explicit click, never on panel open —
                 the browser's own permission prompt is the gate and it must follow a gesture.
                 ⚠️ In the rail that prompt is asked FOR THE HOST SITE, which keeps the grant
                 and may read the location later on its own: the first click only says so,
                 a second click within 6s asks. In the extension window the grant is ours. */
              var armedAt=0;
              here.addEventListener('click',function(){
                if(!navigator.geolocation){ st.textContent=SYFS.t('تحديد الموقع غير مدعوم.'); return; }
                if(inPage&&Date.now()-armedAt>6000){
                  armedAt=Date.now(); st.className='syf-qr-st warn';
                  st.textContent='⚠️ '+SYFS.t('سيطلب المتصفح الإذن باسم {0} ويبقى الإذن لذلك الموقع. اضغط «موقعي الحالي» مرة أخرى للمتابعة، أو اكتب الإحداثيات بنفسك.',location.hostname||location.protocol);
                  return;
                }
                armedAt=0;
                st.textContent=SYFS.t('يحدّد الموقع…');
                navigator.geolocation.getCurrentPosition(function(pos){
                  S.f.lat=la.value=pos.coords.latitude.toFixed(6); S.f.lon=lo.value=pos.coords.longitude.toFixed(6); draw();
                },function(){ st.textContent=SYFS.t('تعذّر تحديد الموقع (رُفض الإذن أو لا إشارة).'); });
              });
            }
            if(t==='card'){ pageWarn(); inp('cn','الاسم'); inp('co','جهة العمل'); inp('cp','الهاتف',true); inp('ce','البريد',true); }
          }
          fields();
        }
        function swatches(p,title,list,key,after){
          var hd=h('<div class="syf-qr-h"></div>'); hd.textContent=SYFS.t(title); p.appendChild(hd);
          var row=h('<div class="syf-qr-sws"></div>'); p.appendChild(row);
          function chose(c){ set(key,c); if(after) after(); }
          list.forEach(function(c){
            var b=h('<button type="button" class="syf-qr-sw"></button>');
            if(c==='transparent'){ b.classList.add('tr'); b.title=SYFS.t('شفّافة'); } else { b.style.background=c; b.title=c; }
            b.setAttribute('aria-label',b.title); b.classList.toggle('on',S[key]===c);
            b.addEventListener('click',function(){ pick(row,b); chose(c); }); row.appendChild(b);
          });
          var ci=h('<input type="color">'); ci.value=HEX.test(S[key])?S[key]:'#ffffff'; ci.title=SYFS.t('لون مخصّص'); ci.setAttribute('aria-label',ci.title);
          ci.addEventListener('input',function(){ if(!HEX.test(ci.value)) return; pick(row,null); chose(ci.value.toLowerCase()); });
          row.appendChild(ci);
          return [hd,row];
        }
        function buildColors(p){
          var box=h('<div class="syf-form"></div>'); p.appendChild(box);
          swatches(box,'لون النقاط',COLS,'col');
          var under;
          function syncUnder(){ var on=S.bg==='transparent'; under.forEach(function(el){ el.style.display=on?'':'none'; }); }
          swatches(box,'الخلفية',BGS,'bg',function(){ syncUnder(); });
          /* shown only with a transparent background: the surface the code will sit on */
          under=swatches(box,'سيوضع الرمز الشفّاف فوق',UNDERS,'under');
          syncUnder();
          box.appendChild(h('<div class="syf-note-hint">النقاط الغامقة على خلفية فاتحة تُقرأ أسرع — المولّد ينبّهك إن ضعف التباين.</div>'));
        }
        function mini(kind,val){
          var c=document.createElement('canvas'); c.width=c.height=60; var x=c.getContext('2d'), keep={dot:S.dot,eye:S.eye,col:S.col};
          S.col='#1d2430';
          if(kind==='dot'){ S.dot=val; var fake={size:5,modules:[[1,0,1,1,0],[1,1,0,1,1],[0,1,1,0,1],[1,0,1,1,1],[1,1,0,1,0]].map(function(r){ return r.map(Boolean); })};
            /* draw the 5×5 sample with no quiet zone and no eyes */
            var m=12; x.fillStyle=S.col; x.beginPath();
            fake.modules.forEach(function(row,r){ row.forEach(function(on,cc){ if(!on) return; var X=cc*m, Y=r*m;
              if(val==='ci'){ x.moveTo(X+m*.95,Y+m/2); x.arc(X+m/2,Y+m/2,m*.45,0,Math.PI*2); } else if(val==='rd') rr(x,X+.5,Y+.5,m-1,m-1,m*.32);
              else if(val==='di'){ x.moveTo(X+m/2,Y); x.lineTo(X+m,Y+m/2); x.lineTo(X+m/2,Y+m); x.lineTo(X,Y+m/2); x.closePath(); } else x.rect(X,Y,m,m); }); });
            x.fill();
          } else { S.eye=val; var R=eyeRadii(val), m2=60/7; x.fillStyle=S.col;
            x.beginPath(); rr(x,0,0,60,60,R[0]*m2); rr(x,m2,m2,5*m2,5*m2,R[1]*m2); x.fill('evenodd'); x.beginPath(); rr(x,2*m2,2*m2,3*m2,3*m2,R[2]*m2); x.fill(); }
          S.dot=keep.dot; S.eye=keep.eye; S.col=keep.col;
          return c;
        }
        function options(p,title,list,key){
          p.appendChild(h('<div class="syf-qr-h"></div>')).textContent=SYFS.t(title);
          var g=h('<div class="syf-qr-opts"></div>'); p.appendChild(g);
          list.forEach(function(o){
            var b=h('<button type="button" class="syf-qr-opt"></button>'); b.appendChild(mini(key,o[0]));
            var s=document.createElement('span'); s.textContent=SYFS.t(o[1]); b.appendChild(s);
            b.classList.toggle('on',S[key]===o[0]); b.addEventListener('click',function(){ pick(g,b); set(key,o[0]); }); g.appendChild(b);
          });
        }
        function buildShapes(p){
          var box=h('<div class="syf-form"></div>'); p.appendChild(box);
          options(box,'شكل النقاط',DOTS,'dot');
          options(box,'شكل العيون (الزوايا)',EYES,'eye');
        }
        function buildLogo(p){
          var box=h('<div class="syf-form"></div>'); p.appendChild(box);
          box.appendChild(h('<div class="syf-qr-h"></div>')).textContent=SYFS.t('شعار في الوسط');
          var g=h('<div class="syf-qr-grid" role="radiogroup"></div>'); box.appendChild(g);
          var file=h('<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden>'); box.appendChild(file);
          var note=h('<div class="syf-note-hint"></div>');
          LOGOS.forEach(function(o){
            g.appendChild(gridBtn(o[1],LOGO_IC[o[0]],S.logo===o[0],function(b){ if(o[0]==='up'){ file.click(); return; } pick(g,b); set('logo',o[0]); }));
          });
          /* an uploaded logo is untrusted: type checked, 5MB cap, decoded by
             createImageBitmap (an SVG is rasterised, never inserted as markup) */
          file.addEventListener('change',function(){
            var fl=file.files&&file.files[0]; file.value='';
            if(!fl) return;
            if(!/^image\/(png|jpeg|webp|svg\+xml)$/.test(fl.type)||fl.size>5*1024*1024){ note.textContent=SYFS.t('اختر صورة PNG أو JPG أو WebP أو SVG حتى 5 م.ب.'); return; }
            createImageBitmap(fl).then(function(bmp){ S.logoImg=bmp; pick(g,g.lastChild); S.logo='up'; draw(); note.textContent=SYFS.t('شعارك مستخدم — لا يُحفظ بعد إغلاق النافذة.'); },
              function(){ note.textContent=SYFS.t('تعذّر قراءة الصورة.'); });
          });
          var rg=h('<label class="syf-qr-range"><span><span>الحجم</span><b></b></span><input type="range" min="12" max="30" step="1"></label>');
          var ri=rg.querySelector('input'), rb=rg.querySelector('b'); ri.value=S.lsz; rb.textContent=S.lsz+'%';
          ri.addEventListener('input',function(){ rb.textContent=ri.value+'%'; set('lsz',+ri.value); });
          box.appendChild(rg);
          box.appendChild(h('<div class="syf-note-hint">مع الشعار يرتفع تصحيح الأخطاء إلى H تلقائياً، فيبقى الرمز مقروءاً.</div>'));
          box.appendChild(note);
        }
        function buildExport(p){
          var box=h('<div class="syf-form"></div>'); p.appendChild(box);
          box.appendChild(h('<div class="syf-qr-h"></div>')).textContent=SYFS.t('الصيغة');
          var fs=h('<div class="syf-seg" role="radiogroup"></div>'); box.appendChild(fs);
          [['png','PNG'],['svg','SVG'],['pdf','PDF']].forEach(function(o){
            if(o[0]==='pdf'&&!window.SYFS_PDF) return;
            var b=h('<button type="button"></button>'); b.textContent=o[1]; /* i18n-dyn: a file-format name (PNG/SVG/PDF), the same in every language */ b.classList.toggle('on',S.fmt===o[0]);
            b.addEventListener('click',function(){ pick(fs,b); set('fmt',o[0]); }); fs.appendChild(b);
          });
          box.appendChild(h('<div class="syf-qr-h"></div>')).textContent=SYFS.t('المقاس');
          var ss=h('<div class="syf-seg" role="radiogroup"></div>'); box.appendChild(ss);
          [512,1024,2048,4096].forEach(function(v){
            var b=h('<button type="button"></button>'); b.textContent=String(v); b.classList.toggle('on',S.px===v);
            b.addEventListener('click',function(){ pick(ss,b); set('px',v); }); ss.appendChild(b);
          });
          box.appendChild(h('<div class="syf-note-hint">SVG متّجه يُكبَّر بلا حدود — الأنسب للطباعة. PNG بالخلفية الشفّافة يحفظ الشفافية.</div>'));
        }

        /* ---------- export ---------- */
        function save(blob,ext){
          var u=URL.createObjectURL(blob), a=document.createElement('a');
          a.href=u; a.download='qr-'+S.type+'-'+Date.now().toString(36)+'.'+ext; a.click();
          setTimeout(function(){ URL.revokeObjectURL(u); },20000);
        }
        function raster(forceBg){ var c=document.createElement('canvas'); c.width=c.height=S.px; paint(c.getContext('2d'),cur,S.px,forceBg); return c; }
        dlB.addEventListener('click',function(){
          if(!cur) return;
          if(S.fmt==='svg'){ save(new Blob([toSvg(cur)],{type:'image/svg+xml'}),'svg'); return; }
          if(S.fmt==='pdf'&&window.SYFS_PDF){ save(SYFS_PDF.canvasesToPdfBlob([raster('#ffffff')],.95),'pdf'); return; }
          raster().toBlob(function(b){ if(b) save(b,'png'); },'image/png');
        });
        pv.querySelector('[data-copy]').addEventListener('click',function(){
          if(!cur) return;
          raster().toBlob(function(b){
            if(!b||!window.ClipboardItem){ st.textContent=SYFS.t('النسخ غير متاح هنا — استخدم التنزيل.'); return; }
            navigator.clipboard.write([new ClipboardItem({'image/png':b})]).then(function(){ st.className='syf-qr-st ok'; st.textContent='✓ '+SYFS.t('نُسخت الصورة إلى الحافظة.'); },
              function(){ st.textContent=SYFS.t('النسخ غير متاح هنا — استخدم التنزيل.'); });
          },'image/png');
        });

        draw();
        store.get('qr_design',null).then(function(v){ if(!body.isConnected) return; takeDesign(v); draw(); });
      }
    },

    /* ===== Internet speed (approx, via background) ===== */
    {
      /* ⚠️ v0.112.0 — RENAMED, id kept. «سرعة الإنترنت» collided three ways: the id
         `speed` sits next to the whole speedlite/speedembed/speedfreeze/speedfetch/
         speedtabs family in search and in the chord picker, and the Arabic name sits
         next to «فحص سرعة الموقع» in the dev category — three different things wearing
         one word. `قياس الاتصال` says which of the three it is.
         ⛔ The id stays `speed`: renaming it would cost every user their shortcut and
         their place in a stored tool_order, and the collision was never in the id the
         user sees — it is in the one THEY read. */
      id:'speed', name:'قياس الاتصال (سرعة الإنترنت)', cat:'util',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.5a16 16 0 0 1 20 0"/><path d="M5 12a11 11 0 0 1 14 0"/><path d="M8.5 15.5a6 6 0 0 1 7 0"/><path d="M12 19h.01"/></svg>',
      /* Upload added in v0.112.0. It needs NO new host and NO relay change: `ALLOWED`
         already carries speed.cloudflare.com, and SYFS_FETCH already forwards a method
         and a body (it just had no caller that used them). The payload is generated
         here and is 1MB of one repeated character — nothing about this machine or this
         page travels with it. */
      /* ⚠️ Phase-2 review — three things the old single shot got wrong:
         1. OFFLINE showed a ping. bgFetch never rejects (storage.js turns every failure
            into {ok:false}) and the first reply was never checked, so a dead line read
            «4 ms». Every reply is checked now; no answer = «تعذّر», never a number.
         2. The RELAY was timed. SYFS_FETCH reads the whole body, decodes it to text and
            posts it back over runtime messaging; on a fast line that overhead IS the
            measurement. The clock now runs where the bytes land: in the worker
            (SYFS_SPEED returns numbers only), or here on an extension page, where fetch
            is ours and the host's CSP is not in the way. The relay is only the fallback
            for a worker without SYFS_SPEED, and is labelled as such.
         3. ONE sample, no warm-up. Now: ping = median of 4 after a warm-up; download and
            upload = growing sizes, median of the transfers long enough to count (spRate).
         The last SP_HIST_MAX results are kept (numbers + time only) for comparison. */
      mount:function(body){
        body.appendChild(h('<div class="syf-form"><button class="syf-btn" type="button" id="sp-go">اختبار</button>'+
          '<progress id="sp-pr" max="100" value="0" style="width:100%;display:none"></progress>'+
          '<div class="syf-note-hint" id="sp-st" role="status" aria-live="polite"></div>'+
          '<div class="syf-out" id="sp-out"><div><span>زمن الاستجابة</span><b id="sp-ping">—</b></div><div><span>التنزيل</span><b id="sp-dl">—</b></div><div><span>الرفع</span><b id="sp-ul">—</b></div></div>'+
          '<label>آخر القياسات</label><div class="syf-note-list" id="sp-hist"></div>'+
          '<div class="syf-note-hint">عبر Cloudflare: عدّة محاولات بأحجام متزايدة ويُعرض الوسيط. تقدير جيّد، لا يُغني عن اختبار سرعة كامل.</div></div>'));
        var ping=body.querySelector('#sp-ping'),dlB=body.querySelector('#sp-dl'),ulB=body.querySelector('#sp-ul'),goB=body.querySelector('#sp-go'),
            pr=body.querySelector('#sp-pr'),stE=body.querySelector('#sp-st'),out=body.querySelector('#sp-out'),histE=body.querySelector('#sp-hist');
        var SP='https://speed.cloudflare.com/';
        var DL={worker:[1e5,1e6,1e7,2.5e7],relay:[1e5,1e6,5e6]}, UL={worker:[1e5,1e6,5e6,1e7],relay:[1e5,1e6,2e6]};   /* the relay caps a body at 2MB */
        var how=SYFS.inExtPage()?'direct':'worker', hist=[];
        function fmtMs(v){ return v==null?SYFS.t('تعذّر'):Math.round(v)+' ms'; }
        function fmtMb(v){ return v==null?SYFS.t('تعذّر'):(v<10?v.toFixed(1):Math.round(v))+' Mbps'; }
        function renderHist(){
          histE.textContent='';
          if(!hist.length){ histE.appendChild(h('<div class="syf-empty">لا قياسات سابقة.</div>')); return; }
          hist.forEach(function(r){
            var row=h('<div class="syf-note-row"><span class="t" style="flex:1;font-size:11.5px"></span><b style="font-size:12px" dir="ltr"></b></div>');
            row.querySelector('.t').textContent=new Date(r.at).toLocaleString(SYFS.i18n&&SYFS.i18n.locale?SYFS.i18n.locale():undefined,{dateStyle:'short',timeStyle:'short'});
            row.querySelector('b').textContent=fmtMs(r.ping)+' · ↓ '+fmtMb(r.dl)+' · ↑ '+fmtMb(r.ul);
            histE.appendChild(row);
          });
        }
        /* ---- one transfer → {ok, ms, bytes} (ms = time from the first byte to the last) ---- */
        function direct(op,bytes){
          var t0=performance.now();
          if(op==='up') return fetch(SP+'__up',{method:'POST',body:new Blob([new Uint8Array(bytes)]),cache:'no-store'})
            .then(function(r){ return r.arrayBuffer().then(function(){ return {ok:r.ok,ms:performance.now()-t0,bytes:bytes}; }); });
          return fetch(SP+'__down?bytes='+bytes,{cache:'no-store'}).then(function(r){
            var t1=performance.now();
            if(op==='ping'){ if(r.body) r.body.cancel(); return {ok:r.ok,ms:t1-t0}; }
            return r.arrayBuffer().then(function(b){ return {ok:r.ok,ms:performance.now()-t1,bytes:b.byteLength}; });
          });
        }
        function viaWorker(op,bytes){
          return new Promise(function(res){
            var done=false; function fin(r){ if(!done){ done=true; res(r); } }
            /* null = no SYFS_SPEED handler in this worker → the caller drops to the relay */
            try{ chrome.runtime.sendMessage({type:'SYFS_SPEED',op:op,bytes:bytes},function(r){ void chrome.runtime.lastError; fin(r&&typeof r==='object'?r:null); }); }catch(e){ fin(null); }
            setTimeout(function(){ fin({ok:false,error:'timeout'}); },45000);
          });
        }
        function viaRelay(op,bytes){
          var t0=performance.now();
          if(op==='up'){ var payload=new Array(bytes+1).join('a');
            return bgFetch(SP+'__up',{method:'POST',body:payload}).then(function(r){ return {ok:!!r.ok,ms:performance.now()-t0,bytes:bytes}; }); }
          return bgFetch(SP+'__down?bytes='+bytes,{cache:'no-cache'}).then(function(r){ return {ok:!!r.ok,ms:performance.now()-t0,bytes:bytes}; });
        }
        function probe(op,bytes){
          if(how==='direct') return direct(op,bytes).catch(function(){ return {ok:false}; });
          if(how==='relay') return viaRelay(op,bytes);
          return viaWorker(op,bytes).then(function(r){ if(r) return r; how='relay'; return viaRelay(op,bytes); });
        }
        /* run fn over the list in order; `stop` ends a phase once a transfer takes 2s */
        function series(list,fn){ var res=[]; return list.reduce(function(p,x,i){ return p.then(function(stop){ if(stop) return true; return fn(x,i).then(function(r){ res.push(r); return !!(r&&r.ok&&r.ms>2000); }); }); },Promise.resolve(false)).then(function(){ return res; }); }
        var PINGS=5;
        /* the size lists follow `how`, which can drop to the relay during the first ping */
        function sizes(k){ return (k==='d'?DL:UL)[how==='relay'?'relay':'worker']; }
        function step(n,label){ var total=PINGS+sizes('d').length+sizes('u').length; pr.value=Math.round(n/total*100);
          stE.textContent=SYFS.t('جارٍ القياس — {0} ({1}/{2})',SYFS.t(label),Math.min(n+1,total),total); }
        function fail(msg){ ping.textContent=dlB.textContent=ulB.textContent=SYFS.t('تعذّر'); stE.textContent=msg; }
        goB.addEventListener('click',function(){
          goB.disabled=true; goB.textContent=SYFS.t('جارٍ القياس…'); out.setAttribute('aria-busy','true'); pr.style.display=''; pr.value=0;
          ping.textContent=dlB.textContent=ulB.textContent='…';
          var R={at:Date.now(),ping:null,dl:null,ul:null};
          var finish=function(){ goB.disabled=false; goB.textContent=SYFS.t('اختبار'); out.removeAttribute('aria-busy'); pr.style.display='none'; };
          if(navigator.onLine===false){ fail(SYFS.t('لا اتصال بالإنترنت.')); finish(); return; }
          series(new Array(PINGS).fill(0),function(x,i){ step(i,'زمن الاستجابة'); return probe('ping',0); }).then(function(ps){
            var good=ps.slice(1).filter(function(r){ return r&&r.ok; }).map(function(r){ return r.ms; });   /* the first one warms the connection up */
            if(!good.length&&!(ps[0]&&ps[0].ok)) return Promise.reject('offline');
            R.ping=spMedian(good.length?good:[ps[0].ms]); ping.textContent=fmtMs(R.ping);
            return series(sizes('d'),function(b,i){ step(PINGS+i,'التنزيل'); return probe('down',b); });
          }).then(function(ds){
            R.dl=spRate(ds.filter(function(r){ return r&&r.ok; })); dlB.textContent=fmtMb(R.dl);
            return series(sizes('u'),function(b,i){ step(PINGS+sizes('d').length+i,'الرفع'); return probe('up',b); });
          }).then(function(us){
            R.ul=spRate(us.filter(function(r){ return r&&r.ok; })); ulB.textContent=fmtMb(R.ul);
            stE.textContent=SYFS.t('انتهى القياس: الاستجابة {0} · التنزيل {1} · الرفع {2}.',fmtMs(R.ping),fmtMb(R.dl),fmtMb(R.ul))+(how==='relay'?' '+SYFS.t('(تقدير تقريبي عبر مُرحِّل الإضافة — قد يكون أقل من الحقيقي.)'):'');
            hist=spHistClean([R].concat(hist)); store.set('speed_hist',hist); renderHist();
          }).catch(function(){ fail(SYFS.t('تعذّر الوصول إلى خادم القياس — تحقّق من الاتصال.')); }).then(finish);
        });
        renderHist();
        store.get('speed_hist',[]).then(function(v){ if(!body.isConnected) return; hist=spHistClean(v); renderHist(); });
      }
    },

    /* Screenshot merged into the "لقطة شاشة" tabbed tool (visible + full page) in src/media.js. */

    /* ===== Screen recording (getDisplayMedia + MediaRecorder → WebM) ===== */
    {
      id:'screenrec', name:'تسجيل الشاشة', cat:'media',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
      /* ⚠️ v0.111.0 — a live «٠٠:٤٧ · ١٢٫٣ ميجابايت» readout. Without it a recording
         says nothing about how long it has run or how big it has grown, so stopping
         it is guesswork and the first hint of a 2GB file is the download.
         **`rec.start(1000)` is the whole mechanism**: with no timeslice MediaRecorder
         fires `ondataavailable` exactly ONCE, at stop — so `chunks` is empty for the
         entire recording and there is no size to report. A one-second slice changes
         nothing about the output (the blob concatenates identically) and is what
         makes the number exist at all. */
      mount:function(body){
        body.appendChild(h('<div class="syf-form"><div class="syf-row"><button class="syf-btn" id="sr-go">بدء التسجيل</button><button class="syf-mini" id="sr-stop" style="display:none">إيقاف</button></div><label class="syf-ck"><input type="checkbox" id="sr-mic"> تسجيل الميكروفون</label><div class="syf-out" id="sr-live" style="display:none"><div><span>المدّة</span><b id="sr-dur">00:00</b></div><div><span>الحجم</span><b id="sr-size">—</b></div></div><div class="syf-note-hint" id="sr-st">يسجّل نافذة/شاشة تختارها (WebM).</div><video id="sr-prev" controls style="max-width:100%;border-radius:10px;display:none"></video><a id="sr-dl" class="syf-mini" style="display:none;text-align:center;text-decoration:none">تنزيل الفيديو</a></div>'));
        var st=body.querySelector('#sr-st'),prev=body.querySelector('#sr-prev'),dl=body.querySelector('#sr-dl'),goB=body.querySelector('#sr-go'),stopB=body.querySelector('#sr-stop'),mic=body.querySelector('#sr-mic');
        var live=body.querySelector('#sr-live'),durB=body.querySelector('#sr-dur'),sizeB=body.querySelector('#sr-size');
        var rec=null,chunks=[],stream=null,micStream=null,mixAC=null,url=null,t0=0,tick=null;
        /* ⚠️ v0.139.3: MediaRecorder records the FIRST audio track only. With tab/system
           audio shared, the mic track added after it was dropped without a word. Both
           now go through one AudioContext into a single track. */
        function recStream(disp,ms){
          var da=disp.getAudioTracks(), ma=ms?ms.getAudioTracks():[], v=disp.getVideoTracks();
          if(!ma.length) return disp;
          if(!da.length) return new MediaStream(v.concat(ma));
          try{
            mixAC=new (window.AudioContext||window.webkitAudioContext)();
            var dst=mixAC.createMediaStreamDestination();
            mixAC.createMediaStreamSource(new MediaStream(da)).connect(dst);
            mixAC.createMediaStreamSource(new MediaStream(ma)).connect(dst);
            return new MediaStream(v.concat(dst.stream.getAudioTracks()));
          }catch(e){ return disp; }
        }
        function release(){
          [stream,micStream].forEach(function(s){ if(s) s.getTracks().forEach(function(t){t.stop();}); });
          micStream=null;
          if(mixAC){ try{ mixAC.close(); }catch(e){} mixAC=null; }
        }
        /* ⛔ latin digits and a latin-decimal size — this is a meter read at a glance
           beside a 00:00 clock, the same call as the rail chip (§6.9/12). */
        function mb(bytes){ return (bytes/1048576).toFixed(1)+' MB'; }
        function bytes(){ var n=0; for(var i=0;i<chunks.length;i++) n+=chunks[i].size; return n; }
        function paint(){ var s=Math.floor((performance.now()-t0)/1000); durB.textContent=pad(Math.floor(s/60))+':'+pad(s%60); sizeB.textContent=chunks.length?mb(bytes()):'—'; }
        function stopTick(){ if(tick){clearInterval(tick);tick=null;} }
        function finish(){ stopTick(); body.removeAttribute('data-syfs-live'); var blob=new Blob(chunks,{type:'video/webm'}); if(url)URL.revokeObjectURL(url); url=URL.createObjectURL(blob); prev.src=url;prev.style.display='';dl.href=url;dl.download='screen-recording.webm';dl.style.display='';
          durB.textContent=pad(Math.floor(Math.floor((performance.now()-t0)/1000)/60))+':'+pad(Math.floor((performance.now()-t0)/1000)%60); sizeB.textContent=mb(blob.size);
          st.textContent=SYFS.t('انتهى التسجيل ✓'); release(); goB.style.display='';stopB.style.display='none'; }
        goB.addEventListener('click',function(){
          if(!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia){st.textContent=SYFS.t('غير مدعوم.');return;}
          navigator.mediaDevices.getDisplayMedia({video:true,audio:true}).then(function(s){
            stream=s;
            function start(){ chunks=[]; var rs=recStream(stream,micStream); try{rec=new MediaRecorder(rs,{mimeType:'video/webm'});}catch(e){rec=new MediaRecorder(rs);} rec.ondataavailable=function(e){if(e.data&&e.data.size)chunks.push(e.data);}; rec.onstop=finish; stream.getVideoTracks()[0].addEventListener('ended',function(){if(rec&&rec.state!=='inactive')rec.stop();}); rec.start(1000); body.setAttribute('data-syfs-live','rec');
              t0=performance.now(); live.style.display=''; prev.style.display='none'; dl.style.display='none';
              /* every() clears itself when the panel is closed (§6/المؤقّتات) — a
                 recording that outlives its window must not keep painting into it */
              stopTick(); tick=every(body,500,paint);
              goB.style.display='none';stopB.style.display='';st.textContent=SYFS.t('يسجّل… (أوقف من هنا أو من شريط المشاركة)'); }
            if(mic.checked&&navigator.mediaDevices.getUserMedia){ navigator.mediaDevices.getUserMedia({audio:true}).then(function(a){micStream=a;start();}).catch(start); } else start();
          }).catch(function(){st.textContent=SYFS.t('أُلغي.');});
        });
        stopB.addEventListener('click',function(){if(rec&&rec.state!=='inactive')rec.stop();});
      }
    }
  ];

  /* ---- merge related tools into one tabbed window (reuses each member's mount verbatim) ---- */
  function mergeGroup(list, spec) {
    var byId = {}; list.forEach(function (t) { byId[t.id] = t; });
    var tabs = spec.members.map(function (m) { var t = byId[m.id]; return t && t.mount ? { label: m.label, build: t.mount } : null; }).filter(Boolean);
    var merged = { id: spec.id, name: spec.name, cat: spec.cat, icon: spec.icon, mount: function (body) { SYFS.tabs(body, tabs); } };
    var drop = {}; spec.members.forEach(function (m) { drop[m.id] = 1; });
    var out = [], inserted = false;
    list.forEach(function (t) { if (drop[t.id]) { if (!inserted) { out.push(merged); inserted = true; } } else { out.push(t); } });
    return out;
  }
  more = mergeGroup(more, { id: 'timer', name: 'مؤقّت وإيقاف', cat: 'time',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12M6 21h12"/><path d="M8 3v3.5c0 2.2 4 3.3 4 5.5s-4 3.3-4 5.5V21"/><path d="M16 3v3.5c0 2.2-4 3.3-4 5.5s4 3.3 4 5.5V21"/></svg>',
    members: [{ id: 'timer', label: 'المؤقّت' }, { id: 'stopwatch', label: 'ساعة إيقاف / بومودورو' }] });
  /* ⚠️ The icon moved off a calendar body in v0.100.0 and it is not decoration. The
     new `calendar` tool sits in THIS category, and at 16px an icon is read by its
     silhouette — two calendars side by side on one shelf read as the same tool
     listed twice (the collision that already cost `hijri` its icon). This tool is a
     scheduled alarm and a set of reminders; a bell with a clock is what it is. */
  more = mergeGroup(more, { id: 'alerts', name: 'تنبيهات ومواعيد', cat: 'time',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.2 9.8a5.7 5.7 0 0 0-11.4 0c0 6.2-2.6 8-2.6 8h16.6s-2.6-1.8-2.6-8"/><path d="M13.6 20.6a2 2 0 0 1-3.2 0"/><circle cx="18.6" cy="5.4" r="3.6"/><path d="M18.6 3.9v1.7l1.2.7"/></svg>',
    members: [{ id: 'alarm', label: 'تنبيه مجدول' }, { id: 'reminders', label: 'تذكيرات' }] });

  SYFS.tools.push.apply(SYFS.tools, more);
}());
