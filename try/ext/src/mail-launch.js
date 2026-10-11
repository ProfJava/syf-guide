/* SYF — rail launcher for the email writer. The composer runs on its own extension
 * page (mail.html): a full email with a diff view needs more than a rail window.
 *
 * `action` (not `mount`) → opens the page on click and can be bound to a keyboard
 * shortcut. Loaded lazily with the other tool bodies. */
(function () {
  window.SYFS = window.SYFS || {};

  SYFS.tools = SYFS.tools || [];
  SYFS.tools.push({
    id: 'mailwriter', name: 'محرّر الإيميلات', cat: 'docs',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>',
    action: function () {
      try {
        chrome.runtime.sendMessage({ type: 'SYFS_OPEN_MAIL' }, function () { void chrome.runtime.lastError; });
      } catch (e) { /* ignore */ }
    }
  });
}());
