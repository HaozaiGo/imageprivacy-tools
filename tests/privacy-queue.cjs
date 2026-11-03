const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../shared/privacy-controls.js'), 'utf8');
for (const mode of ['immediate', 'delayed', 'expired', 'throwing', 'double-click', 'method-only', 'pagehide']) {
  let click, queued, timeout, pagehide, calls = 0, navigations = 0;
  const status = { textContent: '' };
  const provider = { showRevocationMessage() { if (mode === 'throwing') throw Error('blocked'); calls++; } };
  if (mode !== 'method-only') provider.callbackQueue = { push(entry) {
    queued = entry.CONSENT_DATA_READY;
    if (mode === 'immediate' || mode === 'throwing') queued();
  } };
  const document = { documentElement: { lang: 'en' }, addEventListener: (_, fn) => { click = fn; }, querySelector: () => status };
  vm.runInNewContext(source, { document, window: { addEventListener(_, fn) { pagehide = fn; }, googlefc: provider, location: { assign() { navigations++; } } },
    setTimeout(fn) { timeout = fn; return 1; }, clearTimeout() {} });
  const event = { target: { closest: () => ({ href: 'https://imageprivacy.org/privacy/#choices' }) }, button: 0, preventDefault() {} };
  assert.equal(calls, 0, 'No consent changes at initialization');
  click(event);
  if (mode === 'delayed') queued();
  if (mode === 'expired') { timeout(); queued(); }
  if (mode === 'pagehide') { pagehide(); queued(); timeout(); }
  if (mode === 'double-click') { click(event); queued(); }
  assert.equal(calls, ['immediate', 'delayed', 'double-click'].includes(mode) ? 1 : 0, mode);
  assert.equal(navigations, ['expired', 'throwing'].includes(mode) ? 1 : 0, mode);
}
console.log('PASS: privacy queue readiness, expiry, duplicate clicks, navigation, provider failure, unsupported direct calls');
