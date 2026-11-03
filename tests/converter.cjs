const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const root = path.resolve(__dirname, '../apps/convert');
const workerCode = fs.readFileSync(path.join(root, 'convert-worker.js'), 'utf8');
const checks = {};
vm.runInNewContext(workerCode + '\nself.checkDimensions = checkDimensions;', { self: checks });
checks.checkDimensions(6000, 4000);
checks.checkDimensions(8192, 1);
for (const dimensions of [[6001, 4000], [8193, 1], [0, 5], [1.2, 4]]) {
  assert.throws(() => checks.checkDimensions(...dimensions));
}
const vendor = fs.readFileSync(path.join(root, 'vendor/libheif/libheif-bundle.js'));
assert.equal(createHash('sha256').update(vendor).digest('hex'), '074b2b55ef3de477ba9f794ca381f3f0324c1cba8c91b4af07395f39c22d54cc');
let mode = 'real', decoderRequests = 0, releaseDecoder;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const filename = path.resolve(root, '.' + url.pathname + (url.pathname.endsWith('/') ? 'index.html' : ''));
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    if (url.pathname.endsWith('libheif-bundle.js')) {
      decoderRequests++;
      if (mode === 'decoder-fail') { res.writeHead(503).end(); return; }
      if (mode === 'decoder-delay') await new Promise(resolve => { releaseDecoder = resolve; });
    }
    let body = fs.readFileSync(filename);
    if (url.pathname.endsWith('convert-worker.js')) {
      if (mode === 'hang') body = 'self.onmessage = () => {};';
      if (mode === 'export-hang') body = workerCode.replace("else if (data.type === 'export') await exportImage(data);", "else if (data.type === 'export') await new Promise(() => {});");
    }
    res.writeHead(200, { 'Content-Type': filename.endsWith('.html') ? 'text/html' : 'text/javascript' }).end(body);
  } catch { res.writeHead(404).end(); }
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const zh of [false, true]) {
      const context = await browser.newContext({ acceptDownloads: true, viewport: { width: zh ? 320 : 1280, height: 900 } });
      await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await context.addInitScript(() => {
        const WorkerBase = window.Worker;
        window.createdWorkers = 0; window.stoppedWorkers = 0;
        window.Worker = class extends WorkerBase {
          constructor(...args) { super(...args); window.createdWorkers++; }
          terminate() { window.stoppedWorkers++; return super.terminate(); }
        };
        const timeout = window.setTimeout;
        window.fastDeadline = false;
        window.setTimeout = (fn, ms, ...args) => timeout(fn, window.fastDeadline && [45000, 30000].includes(ms) ? 250 : ms, ...args);
      });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      let downloads = 0; page.on('download', () => downloads++);
      const before = decoderRequests;
      await page.goto(origin + (zh ? '/zh/' : '/'));
      await expect(page.locator('#file')).toBeEnabled();
      assert.equal(decoderRequests, before, 'HEIC is not loaded on navigation');
      async function png(width, height) {
        const data = await page.evaluate(([w, h]) => {
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const ctx = c.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(10, 10, 20, 20);
          const value = c.toDataURL('image/png').split(',')[1]; c.width = c.height = 1; return value;
        }, [width, height]);
        return { name: 'sample.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
      }
      const small = await png(80, 60);
      const upload = input => page.locator('#file').setInputFiles(input);
      async function recover() {
        mode = 'real'; await upload(small); await expect(page.locator('#download')).toBeEnabled();
        await expect(page.locator('#meta')).toContainText('80 x 60');
      }
      await recover();
      assert.equal(decoderRequests, before, 'PNG never loads HEIC decoder');
      for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
        await page.selectOption('#format', type);
        const pending = page.waitForEvent('download'); await page.click('#download');
        const output = await pending, bytes = fs.readFileSync(await output.path());
        const value = await page.evaluate(async ({ encoded, type }) => {
          const b = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
          const image = await createImageBitmap(new Blob([b], { type }));
          const c = new OffscreenCanvas(image.width, image.height); const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0);
          const result = { width: image.width, height: image.height, corner: [...ctx.getImageData(0, 0, 1, 1).data] }; image.close(); return result;
        }, { encoded: bytes.toString('base64'), type });
        assert.equal(value.width, 80); assert.equal(value.height, 60);
        if (type === 'image/jpeg') assert(value.corner.every(n => n > 245));
        else assert.equal(value.corner[3], 0);
      }
      const workers = await page.evaluate(() => window.createdWorkers);
      await upload({ name: 'large.heic', mimeType: 'image/heic', buffer: Buffer.alloc(30 * 1024 * 1024 + 1) });
      await expect(page.locator('#meta')).toContainText('30 MiB');
      assert.equal(await page.evaluate(() => window.createdWorkers), workers, 'Byte limit precedes worker allocation');
      await upload(await png(5000, 5000));
      await expect(page.locator('#meta')).toContainText(zh ? '2400 万像素' : '24 megapixels');
      await expect(page.locator('#download')).toBeDisabled();
      // Tiny compressed input with an enormous declared raster must be rejected
      // from its header, before any browser pixel decode or canvas allocation.
      const oversizedHeader = Buffer.from(small.buffer);
      oversizedHeader.writeUInt32BE(100000, 16); oversizedHeader.writeUInt32BE(100000, 20);
      await upload({ ...small, buffer: oversizedHeader });
      await expect(page.locator('#meta')).toContainText(zh ? '2400 万像素' : '24 megapixels');
      await recover();
      await upload({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('invalid') });
      await expect(page.locator('#meta')).toContainText(zh ? '无法在浏览器中解码' : 'could not be decoded');
      await recover();
      const heic = { name: 'photo.HEIC', mimeType: '', buffer: Buffer.from('invalid') };
      mode = 'decoder-fail'; await upload(heic);
      await expect(page.locator('#meta')).toContainText(zh ? 'HEIC 解码器加载失败' : 'HEIC decoder could not load');
      await recover();
      mode = 'decoder-delay'; await upload(heic);
      await expect.poll(() => typeof releaseDecoder).toBe('function');
      const stopped = await page.evaluate(() => window.stoppedWorkers);
      await page.click('#cancel');
      assert.equal(await page.evaluate(() => window.stoppedWorkers), stopped + 1);
      await expect(page.locator('#meta')).toContainText(zh ? '已取消' : 'cancelled');
      await recover(); releaseDecoder(); releaseDecoder = undefined;
      await expect(page.locator('#meta')).toContainText('80 x 60');
      mode = 'hang'; await upload(small); await recover();
      await page.evaluate(() => { window.fastDeadline = true; });
      mode = 'hang'; await upload(small);
      await expect(page.locator('#meta')).toContainText(zh ? '处理超时' : 'timed out');
      await page.evaluate(() => { window.fastDeadline = false; }); await recover();
      mode = 'export-hang'; await upload(small); await expect(page.locator('#download')).toBeEnabled();
      const previousDownloads = downloads;
      await page.click('#download'); await page.click('#cancel');
      assert.equal(downloads, previousDownloads, 'Cancelled export must not download');
      await recover();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/converter-${zh ? 'zh-mobile' : 'en-desktop'}.png`, fullPage: true });
      await context.close();
      console.log(`PASS converter ${zh ? 'zh 320px' : 'en 1280px'}: exports, lazy decoder, byte/pixel limits, failures, cancel, replacement, timeout, recovery`);
    }
  } finally { releaseDecoder?.(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; server.closeAllConnections(); server.close(); });
