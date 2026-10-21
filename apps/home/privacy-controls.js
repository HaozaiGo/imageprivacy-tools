(() => {
  const getLinks = () => document.querySelectorAll('[data-privacy-settings]');
  const refreshLinks = () => {
    const available = typeof window.googlefc?.showRevocationMessage === 'function';
    getLinks().forEach((link) => { link.hidden = !available; });
  };

  window.googlefc = window.googlefc || {};
  window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];
  window.googlefc.callbackQueue.push({
    CONSENT_API_READY: refreshLinks
  });
  refreshLinks();

  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element && event.target.closest('[data-privacy-settings]');
    if (!link) return;
    event.preventDefault();
    if (typeof window.googlefc.showRevocationMessage === 'function') {
      window.googlefc.showRevocationMessage();
    } else {
      refreshLinks();
      window.location.assign(document.documentElement.lang.startsWith('zh') ? '/zh/privacy/#choices' : '/privacy/#choices');
    }
  });
})();
