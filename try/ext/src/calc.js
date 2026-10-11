/* SYF — finance calculators (Daftra-style). Offline, no eval.
 * Every calculator here is a TAB, not a tool: the file builds one array and then
 * merges it into exactly two entries pushed to SYFS.tools — «حاسبة مالية» and
 * «حاسبة الضرائب». All of them carry cat:'calc'; nothing in this file owns a
 * category of its own (the old 'uae' one is gone — see the tax block below).
 *
 * i18n-via: row
 *   Every result pane in this file is painted with `o.innerHTML = row(…) + row(…)`,
 *   which never passes through h() and therefore never meets tree(). row() translates
 *   its own label — one choke point instead of forty call sites — and this declaration
 *   is what tells tools/i18n-callsite.js so. */
(function () {
  window.SYFS = window.SYFS || {};
  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    /* the template's own text IS the msgid — translate the built tree rather than
       splitting the markup (see src/i18n.js). Free in the default language. */
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }
  function num(el) { return parseFloat(el.value) || 0; }
  function f(n) { if (!isFinite(n)) return '—'; return (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  /* ⚠️ The label is translated HERE, not at the forty call sites (§6.101).
     Every result in this file is painted with `o.innerHTML = row(…) + row(…)`, which
     never passes through h() and so never meets tree() — the dictionary was complete
     and every one of these lines still printed Arabic into an English panel. One choke
     point is also the only version of this fix that cannot rot: a calculator added
     next year gets it without being told.
     `val` is deliberately NOT translated — it is a formatted number from f(). */
  function row(label, val) {
    var s = (window.SYFS && SYFS.t) ? SYFS.t(label) : label;
    return '<div><span>' + s + '</span><b>' + val + '</b></div>';
  }
  function days(a, b) { var d1 = new Date(a), d2 = new Date(b); return (d2 - d1) / 86400000; }

  /* Unified VAT tab (KSA 15% / UAE 5% / Egypt 14% presets + a free rate) — replaces
   * the old standalone KSA & UAE VAT tools. «أخرى» carries no rate: it just hands the
   * field to the user, and the highlight follows whatever rate is actually typed, so
   * the chip row can never claim a country whose rate is no longer in the box. */
  function mountVat(body) {
    body.appendChild(h('<div class="syf-form"><div class="syf-seg syf-seg-wrap" id="vt-ctry"><button class="on" data-r="15">السعودية 15%</button><button data-r="5">الإمارات 5%</button><button data-r="14">مصر 14%</button><button data-custom="1">أخرى</button></div><label>المبلغ</label><input type="number" class="syf-in" id="vt-a" value="100" step="any"><label>النسبة %</label><input type="number" class="syf-in" id="vt-r" value="15" step="any"><div class="syf-seg" id="vt-mode"><button class="on" data-m="add">إضافة الضريبة</button><button data-m="ext">استخراجها</button></div><div class="syf-out" id="vt-o"></div></div>'));
    var a = body.querySelector('#vt-a'), r = body.querySelector('#vt-r'), o = body.querySelector('#vt-o'), mode = 'add';
    function c() { var am = num(a), rt = num(r) / 100, net, vat, tot; if (mode === 'add') { net = am; vat = am * rt; tot = am + vat; } else { net = am / (1 + rt); vat = am - net; tot = am; } o.innerHTML = row('الصافي', f(net)) + row('الضريبة', f(vat)) + row('الإجمالي', f(tot)); }
    /* highlight the preset whose rate matches the box; otherwise «أخرى» */
    function markCtry() {
      var cur = r.value.trim(), hit = null;
      body.querySelectorAll('#vt-ctry button').forEach(function (x) { if (x.dataset.r && parseFloat(x.dataset.r) === parseFloat(cur)) hit = x; });
      body.querySelectorAll('#vt-ctry button').forEach(function (x) { x.classList.toggle('on', hit ? x === hit : !!x.dataset.custom); });
    }
    body.querySelectorAll('#vt-ctry button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.custom) { body.querySelectorAll('#vt-ctry button').forEach(function (x) { x.classList.toggle('on', x === b); }); r.focus(); r.select(); return; }
        r.value = b.dataset.r; markCtry(); c();
      });
    });
    body.querySelectorAll('#vt-mode button').forEach(function (b) { b.addEventListener('click', function () { body.querySelectorAll('#vt-mode button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); mode = b.dataset.m; c(); }); });
    a.addEventListener('input', c); r.addEventListener('input', function () { markCtry(); c(); }); c();
  }

  var calcs = [
    /* ===== Discount ===== */
    {
      id:'discount', name:'حاسبة الخصم', cat:'calc',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 3h7a3 3 0 013 3v7L13.4 20.6a2 2 0 01-2.8 0L3.4 13.4a2 2 0 010-2.8z"/><path d="M16 8h.01"/><path d="M8.5 15.5l4-4"/></svg>',
      mount:function(body){
        body.appendChild(h('<div class="syf-form"><label>السعر قبل الخصم</label><input type="number" class="syf-in" id="d-b" value="100" step="any"><label>نسبة الخصم %</label><input type="number" class="syf-in" id="d-p" value="10" step="any"><div class="syf-out" id="d-o"></div></div>'));
        var b=body.querySelector('#d-b'),p=body.querySelector('#d-p'),o=body.querySelector('#d-o');
        function c(){var bp=num(b),pc=num(p),amt=bp*pc/100,after=bp-amt;o.innerHTML=row('قيمة الخصم',f(amt))+row('السعر بعد الخصم',f(after));}
        b.addEventListener('input',c);p.addEventListener('input',c);c();
      }
    },
    /* ===== Salary (KSA, GOSI) ===== */
    {
      id:'salary-ksa', name:'حاسبة الراتب', cat:'calc',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>',
      mount:function(body){
        body.appendChild(h('<div class="syf-form"><label>الراتب الأساسي</label><input type="number" class="syf-in" id="s-b" value="10000" step="any"><label>بدل السكن</label><input type="number" class="syf-in" id="s-h" value="0" step="any"><label>بدل النقل</label><input type="number" class="syf-in" id="s-t" value="0" step="any"><label>بدلات أخرى</label><input type="number" class="syf-in" id="s-o" value="0" step="any"><label>التأمينات (سنة الخدمة)</label><select class="syf-in" id="s-g"><option value="0">بدون</option><option value="0.0975">السنة 1 (9.75%)</option><option value="0.1025">السنة 2 (10.25%)</option><option value="0.1075">السنة 3 (10.75%)</option><option value="0.1125">السنة 4 (11.25%)</option><option value="0.1175">السنة 5+ (11.75%)</option></select><div class="syf-out" id="s-out"></div></div>'));
        var ids=['#s-b','#s-h','#s-t','#s-o','#s-g'].map(function(x){return body.querySelector(x);}),out=body.querySelector('#s-out');
        /* v0.139.3: GOSI is taken from basic+housing capped at 45,000 SAR a month —
           above that the deduction stops growing. */
        var GOSI_CAP=45000;
        function c(){var basic=num(ids[0]),hou=num(ids[1]),tr=num(ids[2]),ot=num(ids[3]),rate=parseFloat(ids[4].value)||0;var wage=Math.min(Math.max(basic+hou,0),GOSI_CAP);var gosi=wage*rate;var net=basic+hou+tr+ot-gosi;out.innerHTML=row('خصم التأمينات',f(gosi))+(rate&&basic+hou>GOSI_CAP?row('ملاحظة',SYFS.t('الأجر الخاضع للتأمينات محدود بـ {0} ريال',f(GOSI_CAP))):'')+row('صافي الراتب',f(net));}
        ids.forEach(function(e){e.addEventListener('input',c);e.addEventListener('change',c);});c();
      }
    },
    /* ===== Sales commission ===== */
    {
      id:'sales-commission', name:'عمولة المبيعات', cat:'calc',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>',
      mount:function(body){
        body.appendChild(h('<div class="syf-form"><label>المبلغ (المبيعات)</label><input type="number" class="syf-in" id="sc-a" value="10000" step="any"><label>نسبة العمولة %</label><input type="number" class="syf-in" id="sc-r" value="5" step="any"><div class="syf-seg" id="sc-seg"><button class="on" data-m="only">العمولة فقط</button><button data-m="add">إضافتها</button><button data-m="sub">خصمها</button></div><div class="syf-out" id="sc-o"></div></div>'));
        var a=body.querySelector('#sc-a'),r=body.querySelector('#sc-r'),o=body.querySelector('#sc-o'),mode='only';
        function c(){var am=num(a),com=am*num(r)/100,html=row('قيمة العمولة',f(com));if(mode==='add')html+=row('المبلغ شامل العمولة',f(am+com));if(mode==='sub')html+=row('المبلغ بعد الخصم',f(am-com));o.innerHTML=html;}
        body.querySelectorAll('#sc-seg button').forEach(function(btn){btn.addEventListener('click',function(){body.querySelectorAll('#sc-seg button').forEach(function(x){x.classList.remove('on');});btn.classList.add('on');mode=btn.dataset.m;c();});});
        a.addEventListener('input',c);r.addEventListener('input',c);c();
      }
    },
    /* ===== Profit margin ===== */
    {
      id:'profit-margin', name:'نسبة الربح', cat:'calc',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17.5 9 11l4 4 8-8"/><path d="M21 3v6h-6"/><circle cx="6" cy="7" r="2"/></svg>',
      mount:function(body){
        body.appendChild(h('<div class="syf-form"><label>سعر البيع</label><input type="number" class="syf-in" id="pm-s" value="150" step="any"><label>التكلفة</label><input type="number" class="syf-in" id="pm-c" value="100" step="any"><div class="syf-out" id="pm-o"></div></div>'));
        var s=body.querySelector('#pm-s'),c=body.querySelector('#pm-c'),o=body.querySelector('#pm-o');
        function calc(){var sp=num(s),co=num(c),gp=sp-co,margin=sp?gp/sp*100:0,markup=co?gp/co*100:0;o.innerHTML=row('الربح',f(gp))+row('هامش الربح %',f(margin)+'%')+row('نسبة الزيادة على التكلفة %',f(markup)+'%');}
        s.addEventListener('input',calc);c.addEventListener('input',calc);calc();
      }
    },
    /* ===== Compound return ===== */
    {
      id:'compound-return', name:'العائد المركّب', cat:'calc',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c4 0 5-10 9-10s5 6 9 6"/><path d="M3 21h18"/></svg>',
      mount:function(body){
        body.appendChild(h('<div class="syf-form"><label>المبلغ الأساسي</label><input type="number" class="syf-in" id="cr-p" value="10000" step="any"><label>نسبة العائد السنوي %</label><input type="number" class="syf-in" id="cr-r" value="8" step="any"><label>عدد السنوات</label><input type="number" class="syf-in" id="cr-y" value="5" step="any"><label>الادخار كل فترة</label><input type="number" class="syf-in" id="cr-c" value="0" step="any"><label>التكرار</label><select class="syf-in" id="cr-f"><option value="1">سنوياً</option><option value="12">شهرياً</option></select><div class="syf-out" id="cr-o"></div></div>'));
        var P=body.querySelector('#cr-p'),R=body.querySelector('#cr-r'),Y=body.querySelector('#cr-y'),C=body.querySelector('#cr-c'),F=body.querySelector('#cr-f'),o=body.querySelector('#cr-o');
        function calc(){var p=num(P),r=num(R)/100,y=num(Y),c=num(C),n=parseInt(F.value,10);var k=Math.pow(1+r/n,n*y);var fv=p*k+(r?c*((k-1)/(r/n)):c*n*y);var pt=p+c*n*y;o.innerHTML=row('رأس المال الأساسي',f(pt))+row('هامش الربح',f(fv-pt))+row('الرصيد النهائي',f(fv));}
        [P,R,Y,C,F].forEach(function(e){e.addEventListener('input',calc);e.addEventListener('change',calc);});calc();
      }
    },
    /* ===== Overtime ===== */
    {
      id:'overtime', name:'الأوفر تايم', cat:'calc',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M5 3L2 6M19 3l3 3"/></svg>',
      mount:function(body){
        body.appendChild(h('<div class="syf-form"><label>الراتب الإجمالي (شهري)</label><input type="number" class="syf-in" id="ot-s" value="8000" step="any"><label>ساعات العمل الشهرية</label><input type="number" class="syf-in" id="ot-m" value="160" step="any"><label>عدد الساعات الإضافية</label><input type="number" class="syf-in" id="ot-h" value="10" step="any"><label>المعامل</label><select class="syf-in" id="ot-x"><option value="1.5">×1.5</option><option value="2">×2</option></select><div class="syf-out" id="ot-o"></div></div>'));
        var S=body.querySelector('#ot-s'),M=body.querySelector('#ot-m'),H=body.querySelector('#ot-h'),X=body.querySelector('#ot-x'),o=body.querySelector('#ot-o');
        function calc(){var hr=num(M)?num(S)/num(M):0,oth=hr*parseFloat(X.value),pay=oth*num(H);o.innerHTML=row('أجر الساعة',f(hr))+row('أجر الساعة الإضافية',f(oth))+row('إجمالي الأوفر تايم',f(pay));}
        [S,M,H,X].forEach(function(e){e.addEventListener('input',calc);e.addEventListener('change',calc);});calc();
      }
    },
    /* ===== Percentage ===== */
    {
      id:'percentage', name:'النسبة المئوية', cat:'calc',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5L5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></svg>',
      mount:function(body){
        body.appendChild(h('<div class="syf-form"><div class="syf-seg" id="pc-seg"><button class="on" data-m="of">نسبة من عدد</button><button data-m="inc">زيادة</button><button data-m="dec">نقصان</button><button data-m="ratio">نسبة عدد من عدد</button></div><div class="syf-row"><input type="number" class="syf-in" id="pc-a" value="200" step="any"><span id="pc-mid">،</span><input type="number" class="syf-in" id="pc-b" value="15" step="any"></div><div class="syf-out" id="pc-o"></div></div>'));
        var a=body.querySelector('#pc-a'),b=body.querySelector('#pc-b'),mid=body.querySelector('#pc-mid'),o=body.querySelector('#pc-o'),mode='of';
        /* ⚠️ NOT a msgid: one Arabic character is below the extractor's two-letter floor,
           so t('،') would never be extracted, never reported, and would ship an Arabic
           comma into an English panel with every check green (§6.99/8). The `<span>` in
           the template above starts as «،» and is corrected here on first paint. */
        var SEP = (SYFS.i18n.get() === 'en') ? ',' : '،';
        /* ⚠️ These four labels are BUILT, so they must be built as one msgid with
           placeholders. Glued in source order (`'بعد زيادة ' + y + '%'`) they cannot
           match a dictionary key and cannot be reordered into English anyway — the
           §6.101/5 trap: a t() wrapped around the Arabic piece looks like a fix and
           is not. row() translates its label, so these arrive already resolved. */
        function calc(){var x=num(a),y=num(b),res,lbl;if(mode==='of'){res=x*y/100;lbl=SYFS.t('{0}% من {1}',y,x);}else if(mode==='inc'){res=x+x*y/100;lbl=SYFS.t('بعد زيادة {0}%',y);}else if(mode==='dec'){res=x-x*y/100;lbl=SYFS.t('بعد نقصان {0}%',y);}else{res=y?x/y*100:0;lbl=SYFS.t('نسبة {0} من {1}',x,y);mid.textContent=SYFS.t('من');}if(mode!=='ratio')mid.textContent=SEP;o.innerHTML=row(lbl,f(res)+(mode==='ratio'?'%':''));}
        body.querySelectorAll('#pc-seg button').forEach(function(btn){btn.addEventListener('click',function(){body.querySelectorAll('#pc-seg button').forEach(function(x){x.classList.remove('on');});btn.classList.add('on');mode=btn.dataset.m;calc();});});
        a.addEventListener('input',calc);b.addEventListener('input',calc);calc();
      }
    },
    /* ===== Investment ROI ===== */
    {
      id:'investment-roi', name:'العائد على الاستثمار', cat:'calc',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5M4 19h16"/><path d="M8 16l3-4 3 2 5-7"/><path d="M19 7h-3M19 7v3"/></svg>',
      mount:function(body){
        body.appendChild(h('<div class="syf-form"><label>مبلغ الاستثمار</label><input type="number" class="syf-in" id="roi-p" value="10000" step="any"><label>نسبة العائد السنوي %</label><input type="number" class="syf-in" id="roi-r" value="10" step="any"><label>عدد السنوات</label><input type="number" class="syf-in" id="roi-y" value="3" step="any"><label>الادخار كل فترة</label><input type="number" class="syf-in" id="roi-c" value="0" step="any"><label>التكرار</label><select class="syf-in" id="roi-f"><option value="1">سنوياً</option><option value="12">شهرياً</option></select><div class="syf-out" id="roi-o"></div></div>'));
        var P=body.querySelector('#roi-p'),R=body.querySelector('#roi-r'),Y=body.querySelector('#roi-y'),C=body.querySelector('#roi-c'),F=body.querySelector('#roi-f'),o=body.querySelector('#roi-o');
        function calc(){var p=num(P),r=num(R)/100,y=num(Y),c=num(C),n=parseInt(F.value,10);var k=Math.pow(1+r/n,n*y);var fv=p*k+(r?c*((k-1)/(r/n)):c*n*y);var pt=p+c*n*y;var roi=pt?(fv-pt)/pt*100:0;o.innerHTML=row('رأس المال الأساسي',f(pt))+row('هامش الربح',f(fv-pt))+row('الرصيد النهائي',f(fv))+row('العائد ROI %',f(roi)+'%');}
        [P,R,Y,C,F].forEach(function(e){e.addEventListener('input',calc);e.addEventListener('change',calc);});calc();
      }
    },

    /* ============ Tax tabs ============
     * ⚠️ These three are MEMBERS of the merged «حاسبة الضرائب» tool below — never
     * pushed to SYFS.tools on their own. `cat` is therefore decorative here, and it
     * says 'calc' (the owning tool's category) because the 'uae' it used to say was
     * a category that no longer exists in SYFS.cats: a value nothing renders today
     * but that any future pass over `t.cat` would read as real. (v0.111.0)
     *
     * The standalone `vat-uae` that used to lead this block was deleted in the same
     * pass: `mountVat` above replaced it with the four-country version, and nothing
     * had referenced the old id since. */
    /* ===== UAE VAT late-payment penalty ===== */
    {
      id:'vat-penalty-uae', name:'غرامة تأخير ضريبة القيمة المضافة', cat:'calc',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9l-8 14A2 2 0 004 21h16a2 2 0 001.7-3l-8-14a2 2 0 00-3.4 0z"/></svg>',
      mount:function(body){
        body.appendChild(h('<div class="syf-form"><label>قيمة الضريبة (AED)</label><input type="number" class="syf-in" id="vp-t" value="10000" step="any"><label>تاريخ الاستحقاق</label><input type="date" class="syf-in" id="vp-d"><label>تاريخ السداد</label><input type="date" class="syf-in" id="vp-p"><div class="syf-out" id="vp-o"></div><div class="syf-note-hint">وفق قرار مجلس الوزراء 49/2021: 2% فوراً + 4% شهرياً، بحد أقصى 300%.</div></div>'));
        var T=body.querySelector('#vp-t'),D=body.querySelector('#vp-d'),P=body.querySelector('#vp-p'),o=body.querySelector('#vp-o');
        function calc(){var tax=num(T);if(!D.value||!P.value){o.innerHTML=row('قيمة الغرامة','—');return;}var due=new Date(D.value),pay=new Date(P.value);var pen=0;if(pay>due){var months=0,d=new Date(due);while(true){d.setMonth(d.getMonth()+1);if(d<=pay)months++;else break;}pen=Math.min(0.02*tax+0.04*tax*months,3*tax);}o.innerHTML=row('قيمة الغرامة',f(pen))+row('إجمالي المستحق',f(tax+pen));}
        [T,D,P].forEach(function(e){e.addEventListener('input',calc);e.addEventListener('change',calc);});calc();
      }
    },
    /* ===== UAE corporate tax (9% above 375k) ===== */
    {
      id:'corporate-tax-uae', name:'ضريبة الشركات (الإمارات)', cat:'calc',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 10h.01M12 10h.01M15 10h.01M9 14h.01M12 14h.01M15 14h.01"/></svg>',
      mount:function(body){
        body.appendChild(h('<div class="syf-form"><label>الدخل الخاضع للضريبة (AED)</label><input type="number" class="syf-in" id="ct-i" value="500000" step="any"><div class="syf-out" id="ct-o"></div><div class="syf-note-hint">المرسوم 47/2022: 0% حتى 375,000 ثم 9% على ما يزيد.</div></div>'));
        var I=body.querySelector('#ct-i'),o=body.querySelector('#ct-o');
        function calc(){var inc=num(I),tax=Math.max(0,inc-375000)*0.09;o.innerHTML=row('ضريبة الشركات (9%)',f(tax))+row('صافي الدخل بعد الضريبة',f(inc-tax));}
        I.addEventListener('input',calc);calc();
      }
    },
    /* ===== UAE end-of-service gratuity ===== */
    {
      id:'eos-gratuity-uae', name:'مكافأة نهاية الخدمة (الإمارات)', cat:'calc',
      icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M5 21v-1a7 7 0 0114 0v1"/><path d="M17 5l1.5 1.5L21 4"/></svg>',
      mount:function(body){
        body.appendChild(h('<div class="syf-form"><label>آخر راتب أساسي (شهري)</label><input type="number" class="syf-in" id="eos-b" value="10000" step="any"><label>تاريخ الالتحاق</label><input type="date" class="syf-in" id="eos-s"><label>آخر يوم عمل</label><input type="date" class="syf-in" id="eos-e"><label>أيام إجازة بدون راتب</label><input type="number" class="syf-in" id="eos-u" value="0" step="any"><div class="syf-out" id="eos-o"></div><div class="syf-note-hint">قانون العمل 33/2021: 21 يوماً/سنة لأول 5 سنوات، 30 يوماً بعدها، بحدّ سنتين.</div></div>'));
        var B=body.querySelector('#eos-b'),S=body.querySelector('#eos-s'),E=body.querySelector('#eos-e'),U=body.querySelector('#eos-u'),o=body.querySelector('#eos-o');
        /* the VALUE side of row() is never translated (it is a number), so a value that
           carries a word — «3.5 سنة», «0 (أقل من سنة)» — is a whole msgid of its own */
        function calc(){var basic=num(B);if(!S.value||!E.value){o.innerHTML=row('إجمالي المكافأة','—');return;}var sd=days(S.value,E.value)-num(U),yrs=sd/365;if(yrs<1){o.innerHTML=row('مدة الخدمة',SYFS.t('{0} سنة',f(yrs)))+row('إجمالي المكافأة',SYFS.t('0 (أقل من سنة)'));return;}var daily=basic/30,first5=Math.min(yrs,5),beyond=Math.max(0,yrs-5);var g=first5*21*daily+beyond*30*daily;g=Math.min(g,24*basic);o.innerHTML=row('مدة الخدمة',SYFS.t('{0} سنة',f(yrs)))+row('مكافأة أول 5 سنوات',f(first5*21*daily))+row('السنوات الإضافية',f(beyond*30*daily))+row('إجمالي المكافأة',f(g));}
        [B,S,E,U].forEach(function(e){e.addEventListener('input',calc);e.addEventListener('change',calc);});calc();
      }
    }
  ];

  /* Merge the many single-formula calculators into two tabbed tools (reusing each
   * member's mount verbatim): a general "حاسبة مالية" and a "حاسبة الضرائب". */
  var byId = {}; calcs.forEach(function (t) { byId[t.id] = t; });
  function tab(id, label) { var t = byId[id]; return t && t.mount ? { label: label, build: t.mount } : null; }

  var finance = {
    id: 'finance', name: 'حاسبة مالية', cat: 'calc',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1"/><path d="M3 7.5V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M21 10v5h-4.5a2.5 2.5 0 0 1 0-5z"/></svg>',
    mount: function (body) {
      SYFS.tabs(body, [
        tab('percentage', 'النسبة'), tab('discount', 'الخصم'), tab('profit-margin', 'هامش الربح'),
        tab('sales-commission', 'العمولة'), tab('overtime', 'أوفر تايم'), tab('investment-roi', 'عائد استثمار'),
        tab('compound-return', 'عائد مركّب'), tab('salary-ksa', 'الراتب')
      ].filter(Boolean));
    }
  };

  var tax = {
    id: 'tax', name: 'حاسبة الضرائب', cat: 'calc',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-2.2-1.5L13.5 21 12 19.5 10.5 21 8.2 19.5 6 21z"/><path d="M9 9l6 6"/><circle cx="9.4" cy="9" r=".6" fill="currentColor"/><circle cx="14.6" cy="15" r=".6" fill="currentColor"/></svg>',
    mount: function (body) {
      SYFS.tabs(body, [
        { label: 'الضريبة', build: mountVat },
        tab('vat-penalty-uae', 'غرامة تأخير'), tab('corporate-tax-uae', 'ضريبة الشركات'), tab('eos-gratuity-uae', 'نهاية الخدمة')
      ].filter(Boolean));
    }
  };

  SYFS.tools.push(finance, tax);
}());
