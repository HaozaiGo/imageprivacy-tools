(() => {
  // Reopen the provider on this origin; never store or imply a consent choice.
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('[data-privacy-settings]');
    if (!link || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const manager = window.googlefc;
    if (typeof manager?.showRevocationMessage === 'function') {
      try {
        manager.showRevocationMessage();
        event.preventDefault();
        return;
      } catch {
        // A blocked or failed provider must not break the ordinary policy link.
      }
    }
    const status = document.querySelector('[data-privacy-status]');
    if (status) {
      status.textContent = document.documentElement.lang.startsWith('zh')
        ? '此页面的同意管理器不可用，未更改任何同意选择。请使用下方的广告偏好、浏览器设置说明或联系链接。'
        : 'The consent manager is unavailable on this page. No consent choice has been changed. Use the advertising preferences, browser settings guidance, or contact link below.';
    }
  });
})();
