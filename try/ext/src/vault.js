/* SYF — password vault (runs on the extension page vault.html, NOT a
 * content script — isolated from every web page). Secrets are encrypted at rest
 * with AES-GCM; the key is derived from the master password via PBKDF2-SHA256
 * (600k iterations) and lives only in memory while unlocked. Nothing is stored
 * in plaintext, nothing is transmitted, no autofill — copy/paste only. */
(function () {
  'use strict';

  var PBKDF2_ITERS = 600000;
  var AUTOLOCK_MS = 5 * 60 * 1000;      // lock after 5 min idle
  var HIDDEN_LOCK_MS = 45000;           // …and 45 s after the tab is hidden (v0.177: was instant)
  var CLIP_CLEAR_MS = 20000;            // clipboard wipe
  var BLOB = 'vault_blob';
  var THEME_KEY = 'syfs_slides_theme';  // the guide's and help page's key: one choice, every page

  var key = null;                       // CryptoKey while unlocked (memory only)
  var vault = null;                     // { entries: [...] } while unlocked
  var editingId = null;
  var idleTimer = null, hiddenTimer = null;
  var curView = '';
  /* the `ct` this tab last read or wrote. Anything else in storage was written by another
     tab (or a restore), and a save must build on THAT copy, never on our memory of it */
  var lastCt = null;
  var deriving = false;                 // a PBKDF2 run (unlock/setup/import/master) is in flight

  var enc = new TextEncoder(), dec = new TextDecoder();
  function $(id) { return document.getElementById(id); }
  function t() { return SYFS.t.apply(null, arguments); }
  function show(view) {
    ['setup', 'unlock', 'vault', 'edit', 'import', 'master', 'dup'].forEach(function (v) { $('view-' + v).classList.add('hide'); });
    $('view-' + view).classList.remove('hide');
    curView = view;
  }
  function toast(msg) {
    var el = $('toast'); el.textContent = msg; el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 2600);
  }
  function abToB64(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function b64ToU8(s) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

  function storageGet(k) { return new Promise(function (res) { chrome.storage.local.get([k], function (r) { res(r ? r[k] : undefined); }); }); }
  function storageSet(k, v) { return new Promise(function (res) { var o = {}; o[k] = v; chrome.storage.local.set(o, function () { res(); }); }); }

  async function deriveKey(password, salt) {
    var base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }
  /* decrypt a stored/exported blob; throws on a wrong key, a tampered ct or a bad shape */
  async function openBlob(blob, k) {
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(blob.iv) }, k, b64ToU8(blob.ct));
    var v = JSON.parse(dec.decode(pt));
    if (!v || !Array.isArray(v.entries)) throw new Error('shape');
    return v;
  }
  async function sealBlob(v, k, salt) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, enc.encode(JSON.stringify(v)));
    return { v: 1, salt: Array.from(salt), iv: Array.from(iv), ct: abToB64(ct) };
  }
  /* one writer at a time across every vault tab (Web Locks share the extension origin);
     without the API the re-read below still narrows the window to one storage round trip */
  function exclusive(fn) {
    if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) return navigator.locks.request('syf-vault-write', fn);
    return fn();
  }
  /* key + vault are snapshotted before the first await: a lock() mid-save nulls both, and
     encrypting `null` (or with a null key) would throw or write an empty vault.
     ⚠️ v0.177: two unlocked tabs used to overwrite each other — tab B sealed ITS memory over
     an entry tab A had just added. A save is now a CHANGE (`mutate`) applied to the copy in
     storage: if another tab wrote since we last read, that copy is decrypted and the change
     lands on it. A blob our key cannot open (the master password changed elsewhere) throws. */
  async function encryptVault(mutate) {
    var k = key, v = vault;
    if (!k || !v) throw new Error('locked');
    return exclusive(async function () {
      var blob = await storageGet(BLOB);
      if (!blob || !blob.salt) throw new Error('gone');
      if (blob.ct && blob.ct !== lastCt) v = await openBlob(blob, k);
      if (mutate) mutate(v);
      var next = await sealBlob(v, k, blob.salt);
      lastCt = next.ct;                 /* before the write: our own onChanged must read as ours */
      await storageSet(BLOB, next);
      if (key === k) vault = v;
    });
  }
  function writeFailed(e) {
    if (e && e.message === 'locked') return;
    toast(t('تعذّر الحفظ — تغيّرت الحافظة من تبويب آخر. افتحها من جديد.'));
    lock();
  }

  // ---- idle auto-lock ----
  function bumpIdle() {
    if (!key) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(lock, AUTOLOCK_MS);
  }
  ['click', 'keydown', 'mousemove'].forEach(function (ev) { window.addEventListener(ev, bumpIdle, { passive: true }); });
  /* hidden ⇒ lock after a short grace, not at once: copying the user name and then the
     password for one site meant two trips to another tab and two 600k-round unlocks.
     A derivation still running when the tab is hidden is abandoned outright — it must not
     open the vault behind the user's back. Back in view: cancel the lock, retry a wipe. */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
      if (clipText !== null && !clipTimer) wipeIfOurs();
      return;
    }
    if (deriving) gen++;
    if (key && !hiddenTimer) hiddenTimer = setTimeout(function () { hiddenTimer = null; if (document.hidden) lock(); }, HIDDEN_LOCK_MS);
  });
  window.addEventListener('beforeunload', function () { key = null; vault = null; });

  /* lock generation: every async path (PBKDF2 takes ~1 s) captures it and gives up if a
     lock() happened meanwhile — else an unlock finishing after the tab was hidden re-opened
     the vault, and a save finishing after a lock showed the list over the lock screen */
  var gen = 0;
  function lock() {
    gen++;
    key = null; vault = null; editingId = null; importData = null;
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
    ['un-p', 'im-p', 'mp-old', 'mp-new', 'mp-new2'].forEach(function (id) { $(id).value = ''; });
    $('un-err').textContent = '';
    show('unlock'); $('un-p').focus();
  }

  // ---- setup ----
  async function doSetup() {
    var p1 = $('su-p1').value, p2 = $('su-p2').value, err = $('su-err');
    err.textContent = '';
    /* the master key guards every saved password and the blob sits in storage.local
       where an offline guesser can try it at leisure — 6 was too few (v0.139.3). Only a
       NEW vault is held to it: unlocking never checks length, so older vaults still open. */
    if (p1.length < 10) { err.textContent = t('كلمة المرور قصيرة (10 أحرف على الأقل).'); return; }
    if (p1 !== p2) { err.textContent = t('الكلمتان غير متطابقتين.'); return; }
    var g = gen;
    var salt = crypto.getRandomValues(new Uint8Array(16));
    deriving = true;
    var k;
    try { k = await deriveKey(p1, salt); } finally { deriving = false; }
    if (g !== gen) return;                       /* page hidden while deriving — nothing written yet */
    /* another tab may have created (or restored) a vault while this one sat on «create» —
       never seal an empty vault over it. Sealed before the write: no empty placeholder
       blob ever reaches storage (another tab would read it as «the vault was removed»). */
    var existing = await storageGet(BLOB);
    if (existing && existing.ct) { bootView(); return; }
    var v0 = { entries: [] }, first = await sealBlob(v0, k, salt);
    lastCt = first.ct;
    await storageSet(BLOB, first);
    $('su-p1').value = ''; $('su-p2').value = '';
    if (g !== gen) return;
    key = k; vault = v0;
    openVault();
  }

  // ---- unlock ----
  async function doUnlock() {
    var pw = $('un-p').value, err = $('un-err'); err.textContent = '';
    if (!pw) return;
    var g = gen;
    var blob = await storageGet(BLOB);
    if (g !== gen) return;
    if (!blob || !blob.ct) { show('setup'); return; }
    deriving = true;
    try {
      var k = await deriveKey(pw, new Uint8Array(blob.salt));
      var v = await openBlob(blob, k);
      if (g !== gen) return;                     /* locked while deriving: stay locked */
      vault = v; key = k; lastCt = blob.ct;
      $('un-p').value = '';
      openVault();
    } catch (e) {
      if (g === gen) err.textContent = t('كلمة المرور غير صحيحة.');
    } finally { deriving = false; }
  }

  function openVault() { show('vault'); renderList(); bumpIdle(); }

  /* another tab (or a restore) wrote the vault: take its copy instead of keeping a stale one
     to save over later. A blob our key cannot open means the master password changed there. */
  function onBlobChanged(nv) {
    if (nv && nv.ct && nv.ct === lastCt) return;              /* our own write */
    if (!key) { if (!deriving && (curView === 'setup' || curView === 'unlock')) bootView(); return; }
    if (!nv || !nv.ct) { lock(); return; }                    /* the vault was removed */
    var k = key, g = gen;
    openBlob(nv, k).then(function (v) {
      if (g !== gen || key !== k) return;
      vault = v; lastCt = nv.ct;
      if (curView === 'vault') renderList();
    }, function () {
      if (g !== gen) return;
      lock(); toast(t('تغيّرت كلمة المرور الرئيسية من تبويب آخر — افتح بالكلمة الجديدة.'));
    });
  }
  try {
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area === 'local' && ch && ch[BLOB]) onBlobChanged(ch[BLOB].newValue);
    });
  } catch (e) { /* no storage events — the re-read inside encryptVault still guards a save */ }

  // ---- list ----
  function renderList() {
    var q = ($('v-search').value || '').trim().toLowerCase();
    var list = $('v-list'); list.textContent = '';
    var items = vault.entries.slice().sort(function (a, b) { return (a.title || '').localeCompare(b.title || '', 'ar'); });
    if (q) items = items.filter(function (e) { return (e.title || '').toLowerCase().indexOf(q) >= 0 || (e.username || '').toLowerCase().indexOf(q) >= 0; });
    if (!items.length) { var em = document.createElement('div'); em.className = 'empty'; em.textContent = vault.entries.length ? t('لا نتائج.') : t('لا مدخلات بعد — أضف أول واحد.'); list.appendChild(em); return; }
    items.forEach(function (e) { list.appendChild(entryEl(e)); });
  }
  function entryEl(e) {
    var wrap = document.createElement('div'); wrap.className = 'entry';
    var ti = document.createElement('div'); ti.className = 'title'; ti.textContent = e.title || t('(بلا عنوان)');
    var u = document.createElement('div'); u.className = 'u'; u.textContent = e.username || '';
    var pwRow = document.createElement('div'); pwRow.className = 'row'; pwRow.style.marginTop = '4px';
    var pw = document.createElement('span'); pw.className = 'pw'; pw.textContent = '••••••••';
    var revealed = false;
    var eye = mkBtn(t('👁 إظهار'), 'sec');
    eye.setAttribute('aria-pressed', 'false');
    eye.addEventListener('click', function () {
      revealed = !revealed; pw.textContent = revealed ? (e.password || '') : '••••••••';
      eye.textContent = revealed ? t('🙈 إخفاء') : t('👁 إظهار');
      eye.setAttribute('aria-pressed', String(revealed));
    });
    var copyU = mkBtn(t('نسخ المستخدم'), 'sec');
    copyU.addEventListener('click', function () { copyClip(e.username || '', t('اسم المستخدم')); });
    var copyP = mkBtn(t('نسخ كلمة السر'));
    copyP.addEventListener('click', function () { copyClip(e.password || '', t('كلمة السر')); });
    var edit = mkBtn(t('تعديل'), 'sec');
    edit.addEventListener('click', function () { openEditor(e.id); });
    pwRow.append(pw, eye);
    var acts = document.createElement('div'); acts.className = 'row acts'; acts.append(copyP, copyU, edit);
    wrap.append(ti, u, pwRow);
    var when = ago(e.updated);
    if (when) { var w = document.createElement('div'); w.className = 'when'; w.textContent = t('آخر تعديل: {0}', when); wrap.appendChild(w); }
    wrap.appendChild(acts);
    if (e.note) { var n = document.createElement('div'); n.className = 'hint'; n.textContent = e.note; wrap.appendChild(n); }
    return wrap;
  }
  function mkBtn(txt, cls) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn mini' + (cls ? ' ' + cls : ''); b.textContent = txt; return b; }
  /* `updated` is a timestamp since v0.177 — before it was 4 random hex chars, which said
     nothing. Those old markers are simply not shown. The locale follows the UI language. */
  function ago(ms) {
    if (typeof ms !== 'number' || !isFinite(ms) || !(typeof Intl !== 'undefined' && Intl.RelativeTimeFormat)) return '';
    var loc = (SYFS.i18n && SYFS.i18n.locale) ? SYFS.i18n.locale() : 'ar-EG';
    var s = Math.round((ms - Date.now()) / 1000);
    var steps = [[60, 'second'], [3600, 'minute', 60], [86400, 'hour', 3600], [2592000, 'day', 86400], [31536000, 'month', 2592000], [Infinity, 'year', 31536000]];
    var rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' });
    for (var i = 0; i < steps.length; i++) if (Math.abs(s) < steps[i][0]) return rtf.format(Math.round(s / (steps[i][2] || 1)), steps[i][1]);
    return '';
  }

  /* ⚠️ المسح كان غير مشروط ومتعدّداً: كل نسخة تُسلّح مؤقّتاً يكتب '' بعد ٢٠ ثانية **مهما كان
   * على الحافظة حينها**. فمن ينسخ رابطاً أو فقرة بعد كلمة السرّ يجدهما ممحوّين، ومؤقّت نسخةٍ
   * قديمة يبتلع نسخةً أحدث منه. الآن مؤقّت واحد مسلَّح (الجديد يُلغي سابقه)، والمسح يقرأ
   * الحافظة أوّلاً ولا يمحو إلّا إن كانت ما زالت تحمل ما كتبناه نحن.
   * ⚠️ وقراءة الحافظة قد تُرفض هنا (لا تفعيل مستخدم بعد ٢٠ ثانية، ولا صلاحية `clipboardRead`)
   * ⇒ نسقط إلى «النسخة الأحدث وحدها تسلّح المسح»: أضيق ضرراً من الأعمى المتعدّد، وأصدق من
   * ترك كلمة السرّ على الحافظة إلى الأبد.
   * ⚠️ v0.177 — الحالة الشائعة كانت تفشل بصمت: بعد النسخ ينتقل المستخدم إلى الموقع ليلصق،
   * فتصير هذه الصفحة مخفية وتُرفض الكتابة. الآن: (١) يُطلب المسح من العامل (`SYFS_CLIP_WIPE`)
   * فيمحو ولو أُغلقت الصفحة؛ (٢) صفحة مخفية لا تحاول، وتُعيد المحاولة حين تعود ظاهرة؛
   * (٣) الرسالة تقول الحقيقة: «إن بقيت هذه الصفحة ظاهرة» حين لا يردّ العامل بالقبول. */
  var clipTimer = 0, clipText = null;
  function copyClip(text, label) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(function () {
      if (clipTimer) clearTimeout(clipTimer);
      clipText = text;
      clipTimer = setTimeout(function () { clipTimer = 0; wipeIfOurs(); }, CLIP_CLEAR_MS);
      askWorkerWipe(function (byWorker) {
        toast(byWorker ? t('نُسخ {0} — يُمحى بعد 20 ثانية', label)
                       : t('نُسخ {0} — يُمحى بعد 20 ثانية إن بقيت هذه الصفحة ظاهرة', label));
      });
    }).catch(function () { toast(t('تعذّر النسخ')); });
  }
  function wipeIfOurs() {
    var text = clipText;
    if (text === null || document.hidden) return;             /* hidden: writing is refused — retried on return */
    clipText = null;
    function wipe() { navigator.clipboard.writeText('').catch(function () {}); }
    var read = null;
    try { read = navigator.clipboard.readText ? navigator.clipboard.readText() : null; } catch (err) { read = null; }
    if (!read) { wipe(); return; }
    read.then(function (cur) { if (cur === text) wipe(); }, wipe);
  }
  /* the worker owns a wipe that outlives this tab; it answers {ok:true} when it took it */
  function askWorkerWipe(cb) {
    var done = false;
    function fin(v) { if (!done) { done = true; cb(v); } }
    try {
      chrome.runtime.sendMessage({ type: 'SYFS_CLIP_WIPE', ms: CLIP_CLEAR_MS }, function (r) { void chrome.runtime.lastError; fin(!!(r && r.ok === true)); });
      setTimeout(function () { fin(false); }, 600);
    } catch (e) { fin(false); }
  }

  // ---- editor ----
  function openEditor(id) {
    editingId = id || null;
    var e = id ? vault.entries.filter(function (x) { return x.id === id; })[0] : null;
    $('ed-title').textContent = e ? t('تعديل مدخل') : t('مدخل جديد');
    $('ed-t').value = e ? (e.title || '') : '';
    $('ed-u').value = e ? (e.username || '') : '';
    $('ed-p').value = e ? (e.password || '') : '';
    $('ed-n').value = e ? (e.note || '') : '';
    $('ed-del').classList.toggle('hide', !e);
    disarmDel();
    show('edit'); $('ed-t').focus();
  }
  async function saveEntry() {
    var ti = $('ed-t').value.trim();
    if (!vault) return;
    if (!ti) { $('ed-t').focus(); return; }
    var entry = { title: ti, username: $('ed-u').value, password: $('ed-p').value, note: $('ed-n').value.trim(), updated: Date.now() };
    var id = editingId || genId();
    var g = gen;
    /* applied to the CURRENT stored copy — an entry deleted in another tab meanwhile is
       re-added with its id rather than the edit vanishing */
    try {
      await encryptVault(function (v) {
        var e = v.entries.filter(function (x) { return x.id === id; })[0];
        if (!e) { e = { id: id }; v.entries.push(e); }
        e.title = entry.title; e.username = entry.username; e.password = entry.password; e.note = entry.note; e.updated = entry.updated;
      });
    } catch (err) { writeFailed(err); return; }
    if (g !== gen) return;
    toast(t('حُفظ')); openVault();
  }
  /* two presses, like the rail's reset: a wrong click used to erase a password for good */
  var delArmed = 0;
  function disarmDel() { if (delArmed) clearTimeout(delArmed); delArmed = 0; $('ed-del').textContent = t('حذف'); }
  function deleteClick() {
    if (!delArmed) { delArmed = setTimeout(disarmDel, 4000); $('ed-del').textContent = t('⚠ اضغط مرة أخرى للحذف'); return; }
    disarmDel(); deleteEntry();
  }
  async function deleteEntry() {
    if (!editingId || !vault) return;
    var id = editingId, g = gen;
    try { await encryptVault(function (v) { v.entries = v.entries.filter(function (x) { return x.id !== id; }); }); } catch (e) { writeFailed(e); return; }
    if (g !== gen) return;
    toast(t('حُذف')); openVault();
  }
  function genId() { var u = crypto.getRandomValues(new Uint8Array(8)); return Array.from(u).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }

  /* one character of EVERY class first (a site that demands a digit or a symbol gets one),
     the rest from the whole set, then an unbiased Fisher–Yates shuffle so the guaranteed
     four do not sit at the front */
  function genPassword() {
    var sets = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*-_=+';
    var classes = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].map(function (re) { return sets.split('').filter(function (c) { return re.test(c); }).join(''); });
    var chars = (classes.map(function (c) { return randomFrom(c, 1); }).join('') + randomFrom(sets, 20 - classes.length)).split('');
    for (var i = chars.length - 1; i > 0; i--) { var j = randIndex(i + 1), x = chars[i]; chars[i] = chars[j]; chars[j] = x; }
    $('ed-p').value = chars.join('');
  }
  /* rejection sampling: `byte % n` favours the first 256 % n characters */
  function randomFrom(sets, len) {
    var n = sets.length, limit = 256 - (256 % n), out = '';
    while (out.length < len) {
      var rnd = crypto.getRandomValues(new Uint8Array(len * 2));
      for (var i = 0; i < rnd.length && out.length < len; i++) if (rnd[i] < limit) out += sets[rnd[i] % n];
    }
    return out;
  }
  function randIndex(n) {                       /* n ≤ 256, same rejection rule */
    var limit = 256 - (256 % n), b = new Uint8Array(1);
    do { crypto.getRandomValues(b); } while (b[0] >= limit);
    return b[0] % n;
  }

  // ---- encrypted export / import ----
  /* The export IS the stored blob — already AES-GCM under the master password — wrapped
     with a format tag. Nothing is decrypted to write it, so it can travel like any file. */
  async function doExport() {
    var blob = await storageGet(BLOB);
    if (!blob || !blob.ct) return;
    var out = { format: 'syf-vault', v: 1, salt: blob.salt, iv: blob.iv, ct: blob.ct };
    var url = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
    var a = document.createElement('a'); a.href = url; a.download = 'syf-vault-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    toast(t('صُدّرت نسخة مشفّرة — لا تُفتح إلا بكلمة المرور الرئيسية.'));
  }
  /* a file is hostile input: exact shape, byte arrays, base64 text, a size cap */
  function validBlob(o) {
    function bytes(a, n) { return Array.isArray(a) && a.length === n && a.every(function (x) { return x === (x & 255); }); }
    return !!(o && typeof o === 'object' && o.format === 'syf-vault' && o.v === 1 && bytes(o.salt, 16) && bytes(o.iv, 12) &&
      typeof o.ct === 'string' && o.ct.length > 0 && o.ct.length < 16 * 1024 * 1024 && /^[A-Za-z0-9+/]+=*$/.test(o.ct));
  }
  /* entries of a decrypted copy into `cur`: unknown ids are added, a known id is replaced
     only when the incoming copy is NEWER — importing an old backup never rolls back an edit */
  function mergeEntries(cur, incoming) {
    var added = 0, updated = 0;
    function str(x) { return typeof x === 'string' ? x : ''; }
    function stamp(x) { return typeof x === 'number' && isFinite(x) ? x : 0; }
    (Array.isArray(incoming) ? incoming : []).forEach(function (inc) {
      if (!inc || typeof inc !== 'object' || !str(inc.title)) return;
      var id = /^[0-9a-f]{4,32}$/.test(str(inc.id)) ? inc.id : genId();
      var clean = { id: id, title: str(inc.title), username: str(inc.username), password: str(inc.password), note: str(inc.note), updated: stamp(inc.updated) || Date.now() };
      var ex = cur.entries.filter(function (x) { return x.id === id; })[0];
      if (!ex) { cur.entries.push(clean); added++; return; }
      if (stamp(clean.updated) > stamp(ex.updated)) { Object.keys(clean).forEach(function (k) { ex[k] = clean[k]; }); updated++; }
    });
    return { added: added, updated: updated };
  }
  var importData = null, importFrom = '';
  function pickImport(from) { importFrom = from; $('v-file').value = ''; $('v-file').click(); }
  function onImportFile() {
    var f = $('v-file').files && $('v-file').files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var o = null;
      try { o = JSON.parse(rd.result); } catch (e) { o = null; }
      if (!validBlob(o)) { toast(t('ليس ملف نسخة مشفّرة من الحافظة.')); return; }
      importData = { salt: o.salt, iv: o.iv, ct: o.ct };
      $('im-file').textContent = f.name;      /* i18n-dyn: the user's file name, data not a label */
      $('im-how').classList.toggle('hide', importFrom !== 'vault');
      $('im-err').textContent = ''; $('im-p').value = '';
      show('import'); $('im-p').focus();
    };
    rd.readAsText(f);
  }
  function cancelImport() { importData = null; $('im-p').value = ''; if (key) openVault(); else bootView(); }
  async function doImport() {
    var pw = $('im-p').value, err = $('im-err'), data = importData; err.textContent = '';
    if (!pw || !data) return;
    var g = gen, k, v;
    deriving = true;
    try {
      k = await deriveKey(pw, new Uint8Array(data.salt));
      v = await openBlob(data, k);
    } catch (e) {
      if (g === gen) err.textContent = t('كلمة المرور غير صحيحة لهذه النسخة، أو الملف تالف.');
      return;
    } finally { deriving = false; }
    if (g !== gen) return;
    $('im-p').value = '';
    if (importFrom !== 'vault') {
      /* first run: the copy BECOMES the vault, and its password the master password */
      var existing = await storageGet(BLOB);
      if (g !== gen) return;
      if (existing && existing.ct) { err.textContent = t('توجد حافظة على هذا الجهاز — افتحها ثم استورد إليها.'); return; }
      var restored = { v: 1, salt: data.salt, iv: data.iv, ct: data.ct };
      lastCt = restored.ct;
      await storageSet(BLOB, restored);
      if (g !== gen) return;
      key = k; vault = v; importData = null;
      openVault(); toast(t('استُعيدت الحافظة ✓ — كلمة المرور الرئيسية هي كلمة النسخة.'));
      return;
    }
    var r = { added: 0, updated: 0 };
    try { await encryptVault(function (cur) { r = mergeEntries(cur, v.entries); }); } catch (e) { writeFailed(e); return; }
    if (g !== gen) return;
    importData = null;
    openVault(); toast(t('استُورد: {0} جديد · {1} مُحدَّث', String(r.added), String(r.updated)));
  }

  // ---- change the master password ----
  function openMaster() { ['mp-old', 'mp-new', 'mp-new2'].forEach(function (id) { $(id).value = ''; }); $('mp-err').textContent = ''; show('master'); $('mp-old').focus(); }
  async function doMaster() {
    var o = $('mp-old').value, p1 = $('mp-new').value, p2 = $('mp-new2').value, err = $('mp-err');
    err.textContent = '';
    if (!key || !o) return;
    if (p1.length < 10) { err.textContent = t('كلمة المرور قصيرة (10 أحرف على الأقل).'); return; }
    if (p1 !== p2) { err.textContent = t('الكلمتان غير متطابقتين.'); return; }
    var g = gen;
    deriving = true;
    try {
      /* under the write lock, from the STORED copy: the current password is proven by
         decrypting it, and nothing another tab saved is lost in the re-encryption */
      await exclusive(async function () {
        var blob = await storageGet(BLOB);
        var v;
        try { v = await openBlob(blob, await deriveKey(o, new Uint8Array(blob.salt))); } catch (e) { throw new Error('wrong'); }
        var salt = crypto.getRandomValues(new Uint8Array(16));
        var k = await deriveKey(p1, salt);
        if (g !== gen) throw new Error('locked');
        var next = await sealBlob(v, k, salt);
        lastCt = next.ct;
        await storageSet(BLOB, next);
        key = k; vault = v;
      });
    } catch (e) {
      if (g === gen) err.textContent = e.message === 'wrong' ? t('كلمة المرور الحالية غير صحيحة.') : t('تعذّر تغيير كلمة المرور.');
      return;
    } finally { deriving = false; }
    ['mp-old', 'mp-new', 'mp-new2'].forEach(function (id) { $(id).value = ''; });
    if (g !== gen) return;
    openVault(); toast(t('غُيّرت كلمة المرور الرئيسية ✓'));
  }

  // ---- light / dark ----
  /* a per-viewer convenience on an extension page: localStorage, read synchronously */
  function themeInit() {
    var rootEl = document.documentElement, btn = $('v-theme');
    if (!rootEl || !rootEl.setAttribute) return;
    try { var saved = localStorage.getItem(THEME_KEY); if (saved === 'dark' || saved === 'light') rootEl.setAttribute('data-theme', saved); } catch (e) { /* light */ }
    function paint() {
      var dark = rootEl.getAttribute('data-theme') === 'dark', label = dark ? t('الوضع الفاتح') : t('الوضع الداكن');
      btn.textContent = dark ? '☀' : '☾';
      btn.setAttribute('aria-label', label); btn.title = label;
    }
    btn.addEventListener('click', function () {
      var next = rootEl.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      rootEl.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* not remembered */ }
      paint();
    });
    paint();
  }

  // ---- one vault tab ----
  /* A second vault.html (another click on the rail tool, a second window) asks over a
     BroadcastChannel whether one is already open. If so it brings that one forward and
     closes itself — tabs.getCurrent/update/remove on our OWN tab need no `tabs`
     permission. Two tabs opened in the same instant can both stay; the re-read in
     encryptVault is what keeps them from overwriting each other in that case. */
  var chan = null, primary = false;
  function focusSelf() {
    try {
      chrome.tabs.getCurrent(function (tab) {
        if (chrome.runtime.lastError || !tab) return;
        chrome.tabs.update(tab.id, { active: true }, function () { void chrome.runtime.lastError; });
        if (chrome.windows) chrome.windows.update(tab.windowId, { focused: true }, function () { void chrome.runtime.lastError; });
      });
    } catch (e) { /* no tabs API here */ }
  }
  function closeSelf() {
    try { chrome.tabs.getCurrent(function (tab) { if (!chrome.runtime.lastError && tab) chrome.tabs.remove(tab.id, function () { void chrome.runtime.lastError; }); }); } catch (e) {}
  }
  function claimTab(cb) {
    try { chan = new BroadcastChannel('syf-vault'); } catch (e) { chan = null; }
    if (!chan) { primary = true; cb(); return; }
    var other = false;
    chan.onmessage = function (ev) {
      var m = ev && ev.data;
      if (!m || typeof m.t !== 'string') return;
      if (m.t === 'here') other = true;
      else if (m.t === 'who' && primary) chan.postMessage({ t: 'here' });
      else if (m.t === 'focus' && primary) focusSelf();
    };
    chan.postMessage({ t: 'who' });
    setTimeout(function () {
      if (!other) { primary = true; cb(); return; }
      show('dup');
      chan.postMessage({ t: 'focus' });
      closeSelf();
    }, 250);
  }

  function bootView() {
    storageGet(BLOB).then(function (blob) {
      if (key) return;
      if (blob && blob.ct) { show('unlock'); $('un-p').focus(); }
      else { show('setup'); $('su-p1').focus(); }
    });
  }

  // ---- wire up ----
  $('su-go').addEventListener('click', doSetup);
  $('su-restore').addEventListener('click', function () { pickImport('setup'); });
  $('un-go').addEventListener('click', doUnlock);
  $('un-p').addEventListener('keydown', function (e) { if (e.key === 'Enter') doUnlock(); });
  $('su-p2').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSetup(); });
  $('v-add').addEventListener('click', function () { openEditor(null); });
  $('v-lock').addEventListener('click', lock);
  $('v-export').addEventListener('click', doExport);
  $('v-import').addEventListener('click', function () { pickImport('vault'); });
  $('v-master').addEventListener('click', openMaster);
  $('v-file').addEventListener('change', onImportFile);
  $('v-search').addEventListener('input', renderList);
  $('ed-save').addEventListener('click', saveEntry);
  $('ed-del').addEventListener('click', deleteClick);
  $('ed-cancel').addEventListener('click', openVault);
  $('ed-gen').addEventListener('click', genPassword);
  $('im-go').addEventListener('click', doImport);
  $('im-p').addEventListener('keydown', function (e) { if (e.key === 'Enter') doImport(); });
  $('im-cancel').addEventListener('click', cancelImport);
  $('mp-go').addEventListener('click', doMaster);
  $('mp-new2').addEventListener('keydown', function (e) { if (e.key === 'Enter') doMaster(); });
  $('mp-cancel').addEventListener('click', openVault);
  $('dup-go').addEventListener('click', function () { if (chan) chan.postMessage({ t: 'focus' }); });

  // ---- boot ----
  themeInit();
  claimTab(bootView);
})();
