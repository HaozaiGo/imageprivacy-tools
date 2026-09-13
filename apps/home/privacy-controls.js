(() => {
  const getLinks = () => document.querySelectorAll('[data-privacy-settings]');

  window.googlefc = window.googlefc || {};
  window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];
  window.googlefc.callbackQueue.push({
    CONSENT_API_READY: () => {
      getLinks().forEach((link) => {
        link.hidden = false;
      });
    }
  });

  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-privacy-settings]');
    if (!link) return;
    event.preventDefault();
    if (typeof window.googlefc.showRevocationMessage === 'function') {
      window.googlefc.showRevocationMessage();
    }
  });
})();
