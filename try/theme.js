/* theme + language before first paint (a file, not inline: the page CSP has no 'unsafe-inline' scripts) */
(function () {
  var d = document.documentElement, t = null, l = null;
  try { t = localStorage.getItem('syf_site_theme'); l = localStorage.getItem('syf_site_lang'); } catch (e) { /* private mode */ }
  if (t === 'dark' || t === 'light') d.setAttribute('data-theme', t);
  if (/[?&]lang=en\b/.test(location.search)) l = 'en';
  else if (/[?&]lang=ar\b/.test(location.search)) l = 'ar';
  if (l === 'en') { d.setAttribute('lang', 'en'); d.setAttribute('dir', 'ltr'); }
}());
