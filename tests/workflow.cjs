const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const { createServer } = require('../scripts/dev-server.cjs');
const root = path.resolve(__dirname, '../apps');
const artifacts = process.env.WORKFLOW_ARTIFACTS || '/tmp/imageprivacy-workflow';
const online = process.argv.includes('--online');
const results = [];
let browser;

async function context(width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  const errors = [];
  ctx.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  ctx.on('request', request => { assert.equal(request.method(), 'GET', 'Image workflow must not send uploads'); });
  await ctx.addInitScript(() => {
    const open = window.open.bind(window);
    window.open = (...args) => (window.__child = open(...args));
    let editor;
    window.__imports = 0;
    Object.defineProperty(window, 'ImagePrivacyEditor', {
      configurable: true,
      get: () => editor,
      set(value) {
        const load = value.load;
        value.load = (...args) => { window.__imports++; return load(...args); };
        editor = value;
      }
    });
  });
  await ctx.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    const match = /^(redact|resize|compress)\.imageprivacy\.org$/.exec(url.hostname);
    if (!match) return route.abort('blockedbyclient');
    if (online) return route.continue();
    const appRoot = path.join(root, match[1]);
    const pathname = decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : '');
    const filename = path.resolve(appRoot, '.' + pathname);
    if (!filename.startsWith(appRoot + path.sep)) return route.fulfill({ status: 403 });
    try {
      const body = await fs.readFile(filename);
      const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(filename)] || 'application/octet-stream';
      return route.fulfill({ status: 200, contentType: type, body });
    } catch (_) { return route.fulfill({ status: 404, body: 'Missing test asset' }); }
  });
  return { ctx, errors };
}

async function fixture(page) {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 400; canvas.height = 240;
    const c = canvas.getContext('2d'); c.fillStyle = '#ffffff'; c.fillRect(0, 0, 400, 240);
    c.fillStyle = '#ef4444'; c.fillRect(100, 60, 160, 100);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return { name: 'private-source.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}
async function ready(page) { await expect(page.locator('#file')).toBeEnabled(); }
async function next(page, target) {
  await expect(page.locator('#ip-continue')).toBeEnabled();
  await page.selectOption('#ip-next-tool', target);
  const pending = page.waitForEvent('popup');
  await page.click('#ip-continue');
  const child = await pending;
  await expect(child.locator('.ip-transfer-status')).toHaveText(/Edited image received|已接收处理后的图片/);
  assert(!child.url().includes('#'), 'Transfer token must be removed after initialization');
  await expect(page.locator('.ip-transfer-status')).toHaveText(/open in the next tool|已在下一工具/);
  return child;
}
async function noOverflow(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow at ${page.url()}`);
}

async function chain(lang, width, localOrigin) {
  const { ctx, errors } = await context(width);
  const label = `${localOrigin ? 'local-path' : online ? 'production' : 'cross-origin'}-${lang}-${width}`;
  try {
    const page = await ctx.newPage();
    await page.goto(localOrigin ? `${localOrigin}/redact/${lang === 'zh' ? 'zh/' : ''}` : `https://redact.imageprivacy.org/${lang === 'zh' ? 'zh/' : ''}`);
    await ready(page);
    await page.setInputFiles('#file', await fixture(page));
    await expect(page.locator('#download')).toBeEnabled();
    await page.locator('#canvas').scrollIntoViewIfNeeded();
    const box = await page.locator('#canvas').boundingBox();
    await page.mouse.move(box.x + box.width * .2, box.y + box.height * .2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .7, box.y + box.height * .75);
    await page.mouse.up();
    await noOverflow(page);
    const resize = await next(page, 'resize');
    assert.equal(await resize.locator('html').getAttribute('lang'), lang === 'zh' ? 'zh-CN' : 'en');
    await expect(resize.locator('#width')).toHaveValue('400');
    await resize.fill('#width', '200');
    await expect(resize.locator('#height')).toHaveValue('120');
    await noOverflow(resize);
    await resize.screenshot({ path: path.join(artifacts, `${label}-resize.png`), fullPage: true });
    const compress = await next(resize, 'compress');
    assert.equal(await compress.locator('html').getAttribute('lang'), lang === 'zh' ? 'zh-CN' : 'en');
    await expect(compress.locator('.item-meta')).toContainText('200');
    await compress.selectOption('#format', 'image/jpeg');
    await compress.fill('#target', '200');
    await compress.click('#compress-all');
    await expect(compress.locator('[data-action="download"]')).toBeEnabled();
    const pending = compress.waitForEvent('download');
    await compress.click('[data-action="download"]');
    const downloaded = await pending;
    const output = path.join(artifacts, `${label}.jpg`);
    await downloaded.saveAs(output);
    const bytes = await fs.readFile(output);
    assert(bytes.length <= 200 * 1024);
    const pixel = await compress.evaluate(async b64 => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))]));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const c = canvas.getContext('2d'); c.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, height: bitmap.height, center: [...c.getImageData(80, 50, 1, 1).data] };
    }, bytes.toString('base64'));
    assert.equal(pixel.width, 200); assert.equal(pixel.height, 120);
    assert(pixel.center.slice(0, 3).every(value => value < 35), 'Redaction must survive the entire workflow');
    await noOverflow(compress);
    await compress.screenshot({ path: path.join(artifacts, `${label}-compress.png`), fullPage: true });
    assert.deepEqual(errors, []);
    results.push({ label, passed: true, bytes: bytes.length, pixel });
    console.log(`PASS ${label}`);
  } finally { await ctx.close(); }
}

async function guards() {
  const { ctx, errors } = await context();
  try {
    const source = await ctx.newPage();
    await source.goto('https://redact.imageprivacy.org/'); await ready(source);
    const input = await fixture(source);
    const token = '00000000-0000-4000-8000-000000000001';
    const pending = source.waitForEvent('popup');
    await source.evaluate(token => window.open(`https://resize.imageprivacy.org/#ip-transfer=${token}&from=redact`), token);
    const child = await pending;
    await expect(child.locator('.ip-transfer-status')).toHaveText('Receiving image...');
    await child.evaluate(({ token, base64 }) => {
      const file = new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'test.png', { type: 'image/png' });
      const data = { type: 'imageprivacy:file', token, file };
      window.dispatchEvent(new MessageEvent('message', { data, origin: 'https://attacker.example', source: window.opener }));
      window.dispatchEvent(new MessageEvent('message', { data, origin: 'https://redact.imageprivacy.org', source: window }));
      window.dispatchEvent(new MessageEvent('message', { data: { ...data, token: 'wrong' }, origin: 'https://redact.imageprivacy.org', source: window.opener }));
    }, { token, base64: input.buffer.toString('base64') });
    assert.equal(await child.evaluate(() => window.__imports), 0, 'Forged origin/window/token must not import');
    const deliver = () => source.evaluate(({ token, base64 }) => {
      const file = new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'test.png', { type: 'image/png' });
      window.__child.postMessage({ type: 'imageprivacy:file', token, file }, 'https://resize.imageprivacy.org');
    }, { token, base64: input.buffer.toString('base64') });
    await deliver();
    await expect(child.locator('.ip-transfer-status')).toHaveText('Edited image received.');
    await deliver();
    assert.equal(await child.evaluate(() => window.__imports), 1);
    assert.equal(await child.evaluate(() => window.opener), null);
    assert.equal(await child.evaluate(() => localStorage.length + sessionStorage.length), 0);
    await child.close();
    await source.setInputFiles('#file', input);
    await expect(source.locator('#download')).toBeEnabled();
    await source.evaluate(() => { window.open = () => null; });
    await source.click('#ip-continue');
    await expect(source.locator('.ip-transfer-status')).toContainText('blocked');
    await expect(source.locator('#download')).toBeEnabled();
    assert.deepEqual(errors, []);
    results.push({ label: 'origin-window-token-replay-storage-popup-guards', passed: true });
    console.log('PASS transfer guards');
  } finally { await ctx.close(); }
}

(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const server = createServer();
  try {
    await chain('en', 1280);
    await chain('zh', 390);
    await chain('en', 320);
    await guards();
    if (!online) {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      await chain('zh', 390, `http://127.0.0.1:${server.address().port}`);
    }
  } finally {
    await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify(results, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
