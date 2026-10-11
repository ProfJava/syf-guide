/* SYF — rail launcher for the password vault. The vault itself runs
 * on a dedicated extension page (vault.html), isolated from every web page;
 * this content-script tool only opens it (via the service worker, which has
 * tabs access). No secrets ever touch the page context. Loaded BEFORE rail.js. */
(function () {
  window.SYFS = window.SYFS || {};
  function h(html) {
    var t = document.createElement('template'); t.innerHTML = html.trim();
    var el = t.content.firstElementChild;
    /* the template's own text IS the msgid — translate the built tree rather than
       splitting the markup (see src/i18n.js). Free in the default language. */
    return (window.SYFS && SYFS.i18n) ? SYFS.i18n.tree(el) : el;
  }

  SYFS.tools = SYFS.tools || [];
  SYFS.tools.push({
    id: 'vault', name: 'حافظة الباسوردات', cat: 'util',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V8a5 5 0 0110 0v3"/><circle cx="12" cy="16" r="1"/></svg>',
    mount: function (body) {
      var ui = h(
        '<div class="syf-form">' +
          '<button class="syf-btn" id="vt-open">🔒 افتح الحافظة</button>' +
          '<div class="syf-note-hint">حافظة كلمات مرور محلية مشفّرة (AES-GCM بكلمة مرور رئيسية). تفتح في صفحة مستقلة معزولة عن المواقع — لا شبكة، لا مزامنة، لا ملء تلقائي. انسخ كلمة السر والصقها بنفسك.</div>' +
          '<div class="syf-empty" id="vt-err" style="display:none"></div>' +
        '</div>'
      );
      body.appendChild(ui);
      ui.querySelector('#vt-open').addEventListener('click', function () {
        try {
          chrome.runtime.sendMessage({ type: 'SYFS_OPEN_VAULT' }, function () {
            if (chrome.runtime.lastError) {
              var e = ui.querySelector('#vt-err'); e.style.display = ''; e.textContent = SYFS.t('تعذّر فتح الحافظة — أعد تحميل الصفحة.');
            }
          });
        } catch (e) { /* ignore */ }
      });
    }
  });
}());
