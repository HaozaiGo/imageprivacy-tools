// Run: node tests/compress-target.cjs. Uses existing Playwright and the app's real pinned codecs.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const playwrightPath = process.env.PLAYWRIGHT_PATH || path.dirname(require.resolve('playwright'));
const { chromium } = require(playwrightPath);
const { expect } = require(path.join(playwrightPath, 'test'));
const root = path.resolve(__dirname, '../apps/compress');
const artifacts = process.env.COMPRESS_ARTIFACTS || '/tmp/imageprivacy-compress-target';
const results = [];

async function serve() {
  const server = http.createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const filename = path.resolve(root, '.' + pathname);
      if (!filename.startsWith(root + path.sep)) return res.writeHead(403).end();
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css' };
      res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' }).end(await fs.readFile(filename));
    } catch (_) { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function fixtures(page) {
  const generated = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 384;
    const ctx = canvas.getContext('2d');
    const pixels = ctx.createImageData(canvas.width, canvas.height);
    let seed = 123456;
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        pixels.data[i + c] = seed >>> 24;
      }
      pixels.data[i + 3] = i < 512 * 32 * 4 ? 0 : 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const png = canvas.toDataURL('image/png').split(',')[1];
    const jpeg = canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
    canvas.width = 32; canvas.height = 20;
    ctx.fillStyle = '#de2244'; ctx.fillRect(0, 0, 32, 20);
    const small = canvas.toDataURL('image/png').split(',')[1];
    return { png, jpeg, small };
  });
  return Object.fromEntries(Object.entries(generated).map(([key, data]) => [key, {
    name: key === 'jpeg' ? 'noise.jpg' : `${key}.png`,
    mimeType: key === 'jpeg' ? 'image/jpeg' : 'image/png', buffer: Buffer.from(data, 'base64')
  }]));
}

async function run(page) {
  await page.evaluate(() => { window.encodes = []; });
  await page.locator('#compress-all').click();
  await expect(page.locator('#compress-all')).toBeEnabled({ timeout: 90000 });
  await expect(page.locator('.item-status.error')).toHaveCount(0);
  await expect(page.locator('[data-action="download"]').first()).toBeEnabled();
  const attempts = await page.evaluate(() => window.encodes);
  assert(attempts.length > 0 && attempts.length <= 56, 'At most 8 encodes at each of 7 sizes');
  return attempts;
}

async function output(page, index = 0) {
  const result = await page.evaluate(async index => {
    const entry = window.ImagePrivacyEditor.outputs()[index];
    const file = entry.file;
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
    const corner = Array.from(ctx.getImageData(1, 1, 1, 1).data);
    bitmap.close();
    return { id: entry.id, name: entry.name, bytes: file.size, type: file.type, width: canvas.width, height: canvas.height, corner };
  }, index);
  await expect(page.locator('.item-result').nth(index)).toContainText(`${result.bytes} B`);
  await expect(page.locator('.item-result').nth(index)).toContainText(`${result.width} x ${result.height}`);
  return result;
}

async function choose(page, fixture, type) {
  if (await page.locator('#clear-all').isVisible()) await page.locator('#clear-all').click();
  await page.locator('#file').setInputFiles(fixture);
  await expect(page.locator('#compress-all')).toBeEnabled();
  await page.selectOption('#format', type);
  await page.selectOption('#target-preset', '');
  await page.locator('#auto-resize').uncheck();
}

async function cancellationChecks(page, fixture) {
  await page.locator('#clear-all').click();
  for (const rejectLate of [false, true]) {
    await page.evaluate(({ base64, rejectLate }) => {
      const native = window.createImageBitmap;
      window.abortResult = undefined;
      window.closedLateBitmap = false;
      window.cancelController = new AbortController();
      window.createImageBitmap = function (blob, ...args) {
        if (blob.name !== 'deferred-transfer.png') return native.call(this, blob, ...args);
        return new Promise((resolve, reject) => {
          window.releaseDecode = async () => {
            window.createImageBitmap = native;
            if (rejectLate) return reject(new Error('Delayed decode failure'));
            const bitmap = await native(blob, ...args);
            const close = bitmap.close.bind(bitmap);
            bitmap.close = () => { window.closedLateBitmap = true; close(); };
            resolve(bitmap);
          };
        });
      };
      const file = new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'deferred-transfer.png', { type: 'image/png' });
      ImagePrivacyEditor.load(file, { signal: window.cancelController.signal }).then(result => { window.abortResult = result; });
    }, { base64: fixture.buffer.toString('base64'), rejectLate });
    await expect.poll(() => page.evaluate(() => typeof window.releaseDecode)).toBe('function');
    if (!rejectLate) {
      await page.locator('#file').setInputFiles({ ...fixture, name: 'manual-survivor.png' });
      await expect(page.locator('.item[data-status="ready"] .item-name')).toHaveText('manual-survivor.png');
    }
    const manualUrl = await page.locator('.item[data-status="ready"] .compare-before').getAttribute('src');
    await page.evaluate(() => window.cancelController.abort());
    await expect.poll(() => page.evaluate(() => window.abortResult)).toBe(false);
    await expect(page.locator('.item-name')).toHaveText(['manual-survivor.png']);
    assert.equal(await page.locator('.compare-before').getAttribute('src'), manualUrl);
    await page.evaluate(async () => { await window.releaseDecode(); delete window.releaseDecode; });
    if (!rejectLate) await expect.poll(() => page.evaluate(() => window.closedLateBitmap)).toBe(true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    await expect(page.locator('.item-name')).toHaveText(['manual-survivor.png']);
    await expect(page.locator('.item-status.error')).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => ImagePrivacyEditor.outputs()), []);
  }
  const preAborted = await page.evaluate(() => {
    const controller = new AbortController(); controller.abort();
    return ImagePrivacyEditor.load(new File(['bad'], 'already-aborted.png', { type: 'image/png' }), { signal: controller.signal });
  });
  assert.equal(preAborted, false);
  await expect(page.locator('.item-name')).toHaveText(['manual-survivor.png']);

  // Abort at the ready render, after URL allocation but before load resolves.
  const cleanup = await page.evaluate(async base64 => {
    const controller = new AbortController();
    const revoke = URL.revokeObjectURL;
    const revoked = [];
    const manualUrl = document.querySelector('.compare-before').src;
    let transferUrl;
    URL.revokeObjectURL = url => { revoked.push(url); revoke.call(URL, url); };
    const cancelReady = () => {
      const item = Array.from(document.querySelectorAll('.item')).find(item => item.querySelector('.item-name').textContent === 'commit-abort.png');
      if (item?.dataset.status === 'ready') {
        transferUrl = item.querySelector('.compare-before').src;
        controller.abort();
      }
    };
    document.addEventListener('imageprivacy:change', cancelReady);
    try {
      const file = new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'commit-abort.png', { type: 'image/png' });
      const loaded = await ImagePrivacyEditor.load(file, { signal: controller.signal });
      return { loaded, revoked, transferUrl, manualUrl };
    } finally {
      document.removeEventListener('imageprivacy:change', cancelReady);
      URL.revokeObjectURL = revoke;
    }
  }, fixture.buffer.toString('base64'));
  assert.equal(cleanup.loaded, false);
  assert(cleanup.revoked.includes(cleanup.transferUrl), 'Cancelled transfer URL must be revoked');
  assert(!cleanup.revoked.includes(cleanup.manualUrl), 'Manual source URL must not be revoked');
  await expect(page.locator('.item-name')).toHaveText(['manual-survivor.png']);
  await page.locator('#clear-all').click();
}

async function testCase(browser, origin, files, zh, mobile) {
  const label = `${zh ? 'zh' : 'en'}-${mobile ? 'mobile' : 'desktop'}`;
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' });
  // Permit only this page and the exact dependencies already pinned in its HTML.
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const codecs = new Set(Array.from(html.matchAll(/<script defer src="(https:\/\/cdn\.jsdelivr\.net\/[^\"]+)"/g), match => match[1]));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin || codecs.has(url.href) || ['blob:', 'data:'].includes(url.protocol) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const evidence = { label };
  try {
    await page.goto(origin + (zh ? '/zh/' : '/'), { waitUntil: 'load' });
    await expect(page.locator('#file')).toBeEnabled();
    assert.deepEqual(await page.evaluate(() => [typeof UPNG.encode, typeof pako.deflate, typeof JSZip, typeof pica]), ['function', 'function', 'function', 'function']);
    await page.evaluate(() => {
      window.encodes = [];
      window.changeEvents = 0;
      document.addEventListener('imageprivacy:change', () => window.changeEvents++);
      const native = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        window.encodes.push({ type, quality, width: this.width, height: this.height });
        return native.call(this, callback, type, quality);
      };
      window.UPNG.encode = new Proxy(window.UPNG.encode, {
        apply(target, receiver, args) {
          window.encodes.push({ type: 'image/png', colors: args[3], width: args[1], height: args[2] });
          return Reflect.apply(target, receiver, args);
        }
      });
    });
    const met = zh ? '已达到目标' : 'Target met';
    const unmet = zh ? '未达到目标' : 'Target not met';
    await choose(page, files.jpeg, 'image/jpeg');
    await expect(page.locator('#auto-resize')).not.toBeChecked();
    assert.deepEqual(await page.evaluate(() => ImagePrivacyEditor.outputs()), [], 'Source is never exported');

    for (const [preset, bytes] of [['200', 200000], ['500', 500000], ['1000', 1000000]]) {
      await page.selectOption('#target-preset', preset);
      await expect(page.locator('#target')).toHaveValue(preset);
      await run(page);
      const actual = await output(page);
      assert(actual.bytes <= bytes);
      await expect(page.locator('.item-status')).toContainText(`${bytes} B`);
      await expect(page.locator('.item-status')).toContainText(met);
    }

    // Exact equality and one-byte-below boundary use real browser JPEG encodes.
    await page.selectOption('#target-preset', '');
    await run(page);
    const original = await output(page);
    await page.fill('#target', (original.bytes / 1000).toFixed(3));
    const exactAttempts = await run(page);
    assert.equal(exactAttempts.length, 1);
    assert.equal((await output(page)).bytes, original.bytes);
    await expect(page.locator('.item-status')).toContainText(met);
    await page.fill('#target', ((original.bytes - 1) / 1000).toFixed(3));
    await run(page);
    assert((await output(page)).bytes <= original.bytes - 1);
    await expect(page.locator('.item-status')).toContainText(met);

    const stable = await output(page);
    for (const invalid of ['0', '-1', '50000.001', '0.0001', '1.2345', '1e3']) {
      await page.fill('#target', invalid);
      await page.evaluate(() => { window.encodes = []; });
      await page.locator('#compress-all').click();
      await expect(page.locator('#target')).toHaveAttribute('aria-invalid', 'true');
      await expect(page.locator('#notice')).toContainText(zh ? '目标大小必须' : 'Target must');
      assert.equal(await page.evaluate(() => window.encodes.length), 0);
      assert.equal((await output(page)).bytes, stable.bytes, 'Invalid target must not overwrite the existing output');
      await expect(page.locator('#file')).toBeEnabled();
    }
    await page.fill('#target', '');
    await page.locator('#target').pressSequentially('e');
    assert.equal(await page.locator('#target').evaluate(input => input.validity.badInput), true);
    await page.locator('#compress-all').click();
    await expect(page.locator('#target')).toHaveAttribute('aria-invalid', 'true');

    // Same JPEG ceiling: dimensions stay put by default, then shrink only after opt-in.
    await page.fill('#target', '5');
    await run(page);
    const fixed = await output(page);
    assert.equal(fixed.width, 512); assert.equal(fixed.height, 384); assert(fixed.bytes > 5000);
    await expect(page.locator('.item-status.unmet')).toContainText(unmet);
    await expect(page.locator('.item-status')).not.toContainText(zh ? '压缩完成' : 'Compression complete');
    await page.locator('#auto-resize').check();
    await run(page);
    const resized = await output(page);
    assert(resized.bytes <= 5000 && resized.width < 512 && resized.height < 384);
    assert(resized.width >= 64 && resized.height >= 64);
    await expect(page.locator('.item-status')).toContainText(met);
    evidence.jpeg = resized;

    await page.fill('#target', '0.001');
    const impossibleAttempts = await run(page);
    const impossible = await output(page);
    assert(impossible.bytes > 1);
    assert(impossible.width >= 64 && impossible.height >= 64);
    assert(new Set(impossibleAttempts.map(a => `${a.width}x${a.height}`)).size <= 7);
    assert(impossibleAttempts.some(a => a.height === 64), 'Search must reach the dimension floor');
    await expect(page.locator('.item-status.unmet')).toContainText(unmet);
    await expect(page.locator('#summary')).toContainText(zh ? '1 张未达到目标' : '1 over target');
    evidence.impossible = { ...impossible, attempts: impossibleAttempts.length };
    await page.screenshot({ path: path.join(artifacts, `${label}-unmet.png`), fullPage: true });

    // Snapshot truth: UI edits cannot relabel a previous JPEG as a PNG or alter its byte ceiling.
    const beforeText = await page.locator('.item-result').textContent();
    await page.selectOption('#format', 'image/png');
    await page.selectOption('#target-preset', '500');
    assert.equal(await page.locator('.item-result').textContent(), beforeText);
    await expect(page.locator('.item-status')).toContainText(zh ? '设置已更改' : 'Settings changed');
    await expect(page.locator('.item-status')).toContainText(zh ? '上限 1 B' : 'limit 1 B');

    await choose(page, files.png, 'image/png');
    await page.locator('#quality').fill('95');
    await run(page);
    assert.equal((await output(page)).corner[3], 0, 'Lossless PNG preserves exact alpha');
    await page.locator('#quality').fill('75');
    await page.fill('#target', '4');
    await run(page);
    const fixedPng = await output(page);
    assert.equal(fixedPng.width, 512); assert(fixedPng.bytes > 4000);
    // UPNG's existing lossy palette quantization also quantizes alpha; allow at most 1% opacity.
    assert(fixedPng.corner[3] <= 2, 'Quantized PNG must not flatten transparency');
    await expect(page.locator('.item-status')).toContainText(unmet);
    await page.locator('#auto-resize').check();
    await run(page);
    const png = await output(page);
    assert(png.bytes <= 4000 && png.width < 512 && png.height >= 64);
    assert(png.corner[3] <= 2, 'Transparent PNG stays transparent through quantization and resizing');
    await expect(page.locator('.item-status')).toContainText(met);
    await expect(page.locator('.item-result')).toContainText(zh ? '色数上限' : 'Color limit');
    evidence.png = png;

    // JPEG flattening retains the chosen background across target attempts.
    await page.selectOption('#format', 'image/jpeg');
    await page.locator('#background').evaluate(input => { input.value = '#22cc66'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await run(page);
    const flattened = await output(page);
    assert(flattened.bytes <= 4000);
    assert.equal(flattened.corner[3], 255);
    assert(Math.abs(flattened.corner[0] - 34) < 25 && Math.abs(flattened.corner[1] - 204) < 25 && Math.abs(flattened.corner[2] - 102) < 25);
    await expect(page.locator('.item-result')).toContainText('#22cc66');

    await choose(page, files.small, 'image/jpeg');
    await page.fill('#target', '0.001');
    await page.locator('#auto-resize').check();
    const smallAttempts = await run(page);
    const small = await output(page);
    assert.equal(small.width, 32); assert.equal(small.height, 20);
    assert(smallAttempts.every(a => a.width === 32 && a.height === 20));
    await expect(page.locator('.item-status')).toContainText(unmet);

    // Batch adapter, comparison, individual download, and byte-for-byte ZIP integrity.
    await choose(page, [files.small, { ...files.small, name: files.small.name }], 'image/png');
    await page.fill('#maxw', '24');
    await page.locator('#quality').fill('95');
    await run(page);
    const exported = await page.evaluate(async () => Promise.all(ImagePrivacyEditor.outputs().map(async entry => ({ id: entry.id, name: entry.name, type: entry.file.type, bytes: Array.from(new Uint8Array(await entry.file.arrayBuffer())) }))));
    assert.equal(exported.length, 2); assert.notEqual(exported[0].id, exported[1].id);
    assert(exported.every(entry => /^compressed-\d+\.png$/.test(entry.name)), 'Transfer filenames must not include source names');
    await expect(page.locator('.item-result').first()).toContainText(zh ? '无损 PNG' : 'Lossless PNG');
    await expect(page.locator('.item-result').first()).toContainText('24 x 15');
    await page.locator('.compare-control').first().fill('25');
    assert.match(await page.locator('.compare-after').first().getAttribute('style'), /75%/);
    const originalLabel = await page.locator('.compare-label.before').first().boundingBox();
    const outputLabel = await page.locator('.compare-label.after').first().boundingBox();
    assert(outputLabel.x < originalLabel.x, 'Labels match the output-left, source-right comparison');
    const individualPending = page.waitForEvent('download');
    await page.locator('[data-action="download"]').first().click();
    const individual = await individualPending;
    assert.deepEqual(await fs.readFile(await individual.path()), Buffer.from(exported[0].bytes));
    const zipPending = page.waitForEvent('download');
    await page.locator('#download-zip').click();
    const zip = await zipPending;
    const zipBuffer = await fs.readFile(await zip.path());
    const entries = await page.evaluate(async data => {
      const archive = await JSZip.loadAsync(data, { base64: true, checkCRC32: true });
      return Promise.all(Object.values(archive.files).filter(entry => !entry.dir).map(async entry => ({ name: entry.name, bytes: Array.from(await entry.async('uint8array')) })));
    }, zipBuffer.toString('base64'));
    assert.deepEqual(entries.map(entry => entry.name), ['small-compressed.png', 'small-compressed-2.png']);
    entries.forEach((entry, i) => assert.deepEqual(entry.bytes, exported[i].bytes));
    await page.locator('[data-action="remove"]').first().click();
    assert.equal(await page.evaluate(() => ImagePrivacyEditor.outputs().length), 1);
    assert((await page.evaluate(() => window.changeEvents)) > 0);
    await page.screenshot({ path: path.join(artifacts, `${label}-batch.png`), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');

    await cancellationChecks(page, files.small);
    const loaded = await page.evaluate(async data => {
      const file = new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], 'transfer.png', { type: 'image/png' });
      return ImagePrivacyEditor.load(file);
    }, files.small.buffer.toString('base64'));
    assert.equal(loaded, true);
    assert.deepEqual(await page.evaluate(() => ImagePrivacyEditor.outputs()), []);
    assert.equal(await page.evaluate(() => ImagePrivacyEditor.load(new File(['bad'], 'bad.png', { type: 'image/png' }))), false);
    await page.locator('#clear-all').click();
    const fullQueue = await page.evaluate(async data => {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      const loaded = await Promise.all(Array.from({ length: 21 }, (_, i) => ImagePrivacyEditor.load(new File([bytes], `${i}.png`, { type: 'image/png' }))));
      return { accepted: loaded.filter(Boolean).length, count: document.querySelectorAll('.item').length };
    }, files.small.buffer.toString('base64'));
    assert.deepEqual(fullQueue, { accepted: 20, count: 20 });
    if (!zh && !mobile) {
      // Deliberately make an overshoot closer than every fitting candidate. Keep a valid JPEG payload.
      await choose(page, files.small, 'image/jpeg');
      await page.fill('#maxw', '1920');
      await page.locator('#quality').fill('75');
      await page.fill('#target', '1');
      await page.evaluate(() => {
        window.savedToBlob = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
          return window.savedToBlob.call(this, blob => {
            const bytes = quality > 0.7 ? 1200 : quality > 0.3 ? 1001 : 800;
            if (blob.size > bytes) throw new Error('Boundary fixture must fit inside padding');
            callback(new Blob([blob, new Uint8Array(bytes - blob.size)], { type }));
          }, type, quality);
        };
      });
      await run(page);
      assert.equal((await output(page)).bytes, 800, 'A 1-byte overshoot must lose to an observed 200-byte undershoot');
      await expect(page.locator('.item-status')).toContainText(met);
      await expect(page.locator('.item-result')).toContainText('30%');
      await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.savedToBlob; });

      // Gate a real encode to verify transfers cannot mutate a busy queue or export its source.
      await page.evaluate(() => {
        HTMLCanvasElement.prototype.toBlob = function (...args) {
          window.releaseEncode = () => window.savedToBlob.apply(this, args);
        };
      });
      await page.selectOption('#target-preset', '');
      await page.locator('#compress-all').click();
      await expect(page.locator('#compress-all')).toBeDisabled();
      await expect.poll(() => page.evaluate(() => typeof window.releaseEncode)).toBe('function');
      assert.equal(await page.evaluate(() => ImagePrivacyEditor.load(new File(['bad'], 'busy.png', { type: 'image/png' }))), false);
      assert.deepEqual(await page.evaluate(() => ImagePrivacyEditor.outputs()), []);
      await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.savedToBlob; window.releaseEncode(); });
      await expect(page.locator('#compress-all')).toBeEnabled();

      // Controlled slow-codec size oracle tests AVIF's budget, not AVIF bitstream correctness.
      await choose(page, files.jpeg, 'image/avif');
      await page.fill('#target', '1');
      await page.locator('#auto-resize').check();
      await context.route('https://cdn.jsdelivr.net/npm/@jsquash/avif@2.1.1/encode.js/+esm', route => route.fulfill({
        contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' },
        body: 'export default async function(image, options) { (window.avifCalls ||= []).push({ width: image.width, height: image.height, quality: options.quality }); return new Uint8Array(1200).buffer; }'
      }));
      await page.locator('#compress-all').click();
      await expect(page.locator('#compress-all')).toBeEnabled();
      await expect(page.locator('.item-status.unmet')).toContainText(unmet);
      const calls = await page.evaluate(() => window.avifCalls);
      assert.equal(calls.length, 16, 'AVIF must never exceed 16 encodes per image');
      assert.equal(new Set(calls.map(call => `${call.width}x${call.height}`)).size, 4);
      assert.equal(calls.at(-1).height, 64, 'Final AVIF dimension attempt reaches the minimum');
      evidence.avifBudget = calls.length;
    }
    assert.deepEqual(errors, []);
    results.push({ ...evidence, status: 'pass' });
    console.log(`PASS ${label}: exact targets, presets, invalid input, bounded resize, PNG alpha, JPEG background, settings snapshot, batch/ZIP, transfer`);
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, `${label}-failure.png`), fullPage: true });
    await fs.writeFile(path.join(artifacts, `${label}-failure.html`), await page.content());
    results.push({ ...evidence, status: 'fail', error: error.stack, errors });
    throw error;
  } finally { await context.close(); }
}

async function main() {
  await fs.mkdir(artifacts, { recursive: true });
  const { server, origin } = await serve();
  let browser;
  try {
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: 'chrome', headless: true });
    const page = await browser.newPage();
    const files = await fixtures(page);
    await page.close();
    for (const mobile of [false, true]) for (const zh of [false, true]) await testCase(browser, origin, files, zh, mobile);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  }
  console.log(`${results.length} cases passed. Artifacts: ${artifacts}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
