const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const toolkitFlag = process.argv.indexOf('--toolkit-root');
const sites = ['home', 'exif', 'watermark', 'redact', 'resize', 'compress', 'convert'].map(app => ({
  root: path.join(root, 'apps', app), origin: `https://${app === 'home' ? '' : app + '.'}imageprivacy.org`,
  policy: 'https://imageprivacy.org', anchor: 'choices'
}));
if (toolkitFlag >= 0) {
  const workspace = path.resolve(process.argv[toolkitFlag + 1]);
  for (const [app, sub] of [['toolkitbox-home', ''], ['json-toolbox', 'json'], ['base64-tool', 'base64'], ['uuid-generator', 'uuid'], ['color-tool', 'color'], ['regex-tester', 'regex'], ['diff-checker', 'diff'], ['url-checker', 'url'], ['ssl-checker', 'ssl']]) {
    sites.push({ root: path.join(workspace, app), origin: `https://${sub ? sub + '.' : ''}toolkitbox.org`, policy: 'https://toolkitbox.org', anchor: 'privacy-choices' });
  }
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
async function serve(route) {
  const url = new URL(route.request().url());
  const site = sites.find(s => s.origin === url.origin);
  if (!site || url.pathname.startsWith('/_vercel/')) return route.abort();
  const file = path.resolve(site.root, '.' + decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : ''));
  if (!file.startsWith(site.root + path.sep)) return route.fulfill({ status: 403 });
  try { return await route.fulfill({ status: 200, contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) }); }
  catch { return route.fulfill({ status: 404, body: 'Not found' }); }
}

// Verify modified clicks and keyboard activation without depending on browser popup behavior.
for (const source of new Set(sites.map(site => fs.readFileSync(path.join(site.root, 'privacy-controls.js'), 'utf8')))) {
  let listener;
  const status = { textContent: '' };
  const document = { documentElement: { lang: 'en' }, addEventListener: (_, cb) => { listener = cb; }, querySelector: () => status };
  const window = { addEventListener() {} };
  vm.runInNewContext(source, { window, document });
  let calls = 0;
  window.googlefc = { showRevocationMessage() { calls++; } };
  for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
    listener({ target: { closest: () => ({}) }, button: 0, [modifier]: true, preventDefault() { assert.fail('Modified navigation intercepted'); } });
  }
  listener({ target: { closest: () => ({}) }, button: 1, preventDefault() { assert.fail('Middle click intercepted'); } });
  assert.equal(calls, 0);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  let documents = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', serve);
    const page = await context.newPage();
    for (const site of sites) {
      const urls = await page.evaluate(xml => {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        if (doc.querySelector('parsererror')) throw Error('Invalid sitemap');
        return [...doc.querySelectorAll('url > loc')].map(el => el.textContent.trim());
      }, fs.readFileSync(path.join(site.root, 'sitemap.xml'), 'utf8'));
      for (const url of urls) {
        const html = fs.readFileSync(path.join(site.root, new URL(url).pathname, 'index.html'), 'utf8');
        const result = await page.evaluate(html => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const links = [...doc.querySelectorAll('[data-privacy-settings]')];
          return { script: !!doc.querySelector('script[src="/privacy-controls.js"][defer]'),
            links: links.map(el => ({ href: el.getAttribute('href'), hidden: el.hasAttribute('hidden'), text: el.textContent.trim() })) };
        }, html);
        assert(result.script, `${url}: missing adapter`);
        assert(result.links.length, `${url}: missing privacy control`);
        for (const link of result.links) {
          assert(!link.hidden && link.text, `${url}: inaccessible privacy control`);
          const zh = new URL(url).pathname.startsWith('/zh/');
          assert.equal(new URL(link.href, url).href, `${site.policy}/${zh ? 'zh/' : ''}privacy/#${site.anchor}`, `${url}: wrong-language fallback`);
        }
        documents++;
      }
      for (const lang of ['en', 'zh']) {
        const url = site.origin + (lang === 'zh' ? '/zh/' : '/');
        const fallback = `${site.policy}/${lang === 'zh' ? 'zh/' : ''}privacy/#${site.anchor}`;
        for (const mode of ['absent', 'late-provider', 'throwing-provider', 'delayed-queue', 'stalled-queue']) {
          await page.goto(url, { waitUntil: 'load' });
          if (mode !== 'absent') await page.evaluate(mode => {
            window.privacyTestCalls = 0;
            window.googlefc = { callbackQueue: { push(entry) {
              if (mode === 'stalled-queue') return;
              if (mode === 'delayed-queue') setTimeout(entry.CONSENT_DATA_READY, 200);
              else entry.CONSENT_DATA_READY();
            } }, showRevocationMessage() {
              if (mode === 'throwing-provider') throw Error('Provider unavailable');
              window.privacyTestCalls++;
            } };
          }, mode);
          const control = page.locator('[data-privacy-settings]').first();
          assert(await control.isVisible(), `${url}: control hidden`);
          await control.focus();
          await page.keyboard.press('Enter');
          if (mode === 'late-provider' || mode === 'delayed-queue') {
            await page.waitForFunction(() => window.privacyTestCalls === 1);
            assert.equal(page.url(), url, 'Provider opened on wrong origin');
          } else {
            await page.waitForURL(fallback);
            assert(await page.locator('a[href="https://myadcenter.google.com/"]').isVisible());
            await page.locator('[data-privacy-settings]').first().click();
            assert.match(await page.locator('[data-privacy-status]').textContent(), lang === 'zh' ? /未更改/ : /No consent choice/);
          }
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${url}: overflow`);
          results.push({ url, mode, passed: true });
        }
      }
    }
    await page.screenshot({ path: '/tmp/privacy-fallback-mobile.png', fullPage: true });
    const noJS = await browser.newContext({ javaScriptEnabled: false });
    await noJS.route('**/*', serve);
    const noJSPage = await noJS.newPage();
    for (const site of sites) for (const lang of ['en', 'zh']) {
      const url = site.origin + (lang === 'zh' ? '/zh/' : '/');
      await noJSPage.goto(url);
      await noJSPage.locator('[data-privacy-settings]').first().click();
      await noJSPage.waitForURL(`${site.policy}/${lang === 'zh' ? 'zh/' : ''}privacy/#${site.anchor}`);
      results.push({ url, mode: 'no-javascript', passed: true });
    }
    const report = { testedAt: new Date().toISOString(), documents, browserCases: results.length, results,
      exclusions: 'Live advertising and real CMP publication/region behavior. Provider is mocked; no consent changes are made.' };
    fs.writeFileSync('/tmp/two-sites-privacy-tests.json', JSON.stringify(report, null, 2));
    console.log(`PASS: ${documents} documents, ${results.length} privacy browser cases`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
