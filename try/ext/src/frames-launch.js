/* SYF — rail launchers for the four video tools. They are four entries in the bar and
 * ONE page (video.html), opened on the mode the entry names: a shared file, a shared
 * engine, one decoder, one place to fix anything.
 *
 * Four entries rather than one «أدوات الفيديو», because the bar is where you go when you
 * already know what you want — «قصّ الفيديو» is findable and a generic name is not.
 *
 * `action` (not `mount`) → it opens the page on click and can carry a keyboard shortcut. */
(function () {
  window.SYFS = window.SYFS || {};
  SYFS.tools = SYFS.tools || [];

  var I_FRAMES = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="14" height="14" rx="2.5"/><path d="M16 10l6-3.5v11L16 14"/></svg>';
  var I_AUDIO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 8.5a5 5 0 010 7"/></svg>';
  var I_TRIM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5L20 18M8 16.5L20 6"/></svg>';
  var I_CONV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>';

  function open(mode) {
    return function () {
      try {
        chrome.runtime.sendMessage({ type: 'SYFS_OPEN_VIDEO', mode: mode }, function () { void chrome.runtime.lastError; });
      } catch (e) { /* ignore */ }
    };
  }

  /* ⚠️ push, never concat — rail.js holds the array reference from load time (§5.12/7). */
  SYFS.tools.push(
    { id: 'frames',  name: 'الفيديو ⇒ صور', cat: 'media', icon: I_FRAMES, action: open('frames') },
    { id: 'vaudio',  name: 'فصل الصوت',     cat: 'media', icon: I_AUDIO,  action: open('audio') },
    { id: 'vtrim',   name: 'قصّ الفيديو',    cat: 'media', icon: I_TRIM,   action: open('trim') },
    { id: 'vconv',   name: 'تحويل صيغة الفيديو', cat: 'media', icon: I_CONV, action: open('convert') }
  );
}());
