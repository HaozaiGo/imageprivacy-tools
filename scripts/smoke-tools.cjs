// Default: isolated Chrome and loopback-only ephemeral servers.
// --codecs: bounded HEIC/PNG/ZIP checks with real CDN dependencies.
// --online: target public app origins instead of starting local servers.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const playwrightPath = process.env.PLAYWRIGHT_PATH || path.dirname(require.resolve('playwright'));
const { chromium } = require(playwrightPath);
const { expect } = require(path.join(playwrightPath, 'test'));
const appsRoot = process.env.SMOKE_APPS_ROOT || path.resolve(__dirname, '../apps');
const online = process.argv.includes('--online');
const codecsOnly = process.argv.includes('--codecs');
const allowCodecs = online || codecsOnly || process.env.SMOKE_ONLINE === '1';
const artifacts = process.env.SMOKE_ARTIFACTS || (codecsOnly ? '/tmp/imageprivacy-codec-smoke' : '/tmp/imageprivacy-app-smoke');
const apps = process.env.SMOKE_APPS ? process.env.SMOKE_APPS.split(',') : codecsOnly ? ['convert', 'compress'] : ['convert', 'compress', 'redact', 'resize', 'exif', 'watermark'];
const results = [];
const resources = [];
// Exact dependency URLs observed in the app HTML, not a wildcard CDN allowlist.
const codecUrls = new Set([
  'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js',
  'https://cdn.jsdelivr.net/npm/pica@10.0.3/dist/pica.min.js',
  'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js',
  'https://cdn.jsdelivr.net/npm/upng-js@2.1.0/UPNG.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.2/dist/jszip.min.js'
]);
const heicProvenance = {
  repository: 'https://github.com/alexcorvi/heic2any',
  commit: '3428539e643e112323a5b8a2c77c6402cb1372f6',
  path: 'demo/1.heic',
  url: 'https://raw.githubusercontent.com/alexcorvi/heic2any/3428539e643e112323a5b8a2c77c6402cb1372f6/demo/1.heic',
  sha256: '645877c52c5c656e2004b38f9520e717bbc6670541a56c098b9b7f78de496e8f',
  gitBlobSha: 'b03ec00982e0d1877a5360402cf62755a60e43cc',
  bytes: 41389,
  width: 1440, height: 960,
  dimensionsVerifiedWith: 'macOS sips -g pixelWidth -g pixelHeight -g format'
};

async function networkPolicy(context, origin, label) {
  const blocked = new WeakSet();
  context.on('requestfailed', request => resources.push({ label, event: 'failed', url: request.url(), error: request.failure()?.errorText, expectedBlocked: blocked.has(request) }));
  context.on('response', response => resources.push({ label, event: 'response', url: response.url(), status: response.status() }));
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    const analytics = url.pathname.startsWith('/_vercel/');
    const allowed = !analytics && (url.origin === origin || ['blob:', 'data:'].includes(url.protocol) || (allowCodecs && codecUrls.has(url.href)));
    resources.push({ label, event: allowed ? 'allowed' : 'blocked', url: url.href, method: request.method() });
    if (allowed) return route.continue();
    blocked.add(request);
    return route.abort('blockedbyclient');
  });
}

async function heicFixture() {
  let buffer;
  if (process.env.HEIC_FIXTURE) {
    buffer = await fs.readFile(process.env.HEIC_FIXTURE);
  } else {
    const response = await fetch(heicProvenance.url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
    assert(response.ok, `HEIC fixture fetch failed: HTTP ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
  }
  assert.equal(buffer.length, heicProvenance.bytes);
  assert.equal(createHash('sha256').update(buffer).digest('hex'), heicProvenance.sha256, 'HEIC fixture must match pinned upstream sample');
  assert.equal(buffer.toString('ascii', 4, 8), 'ftyp');
  await fs.writeFile(path.join(artifacts, 'upstream-demo-1.heic'), buffer);
  await fs.writeFile(path.join(artifacts, 'fixture-provenance.json'), JSON.stringify(heicProvenance, null, 2) + '\n');
  return { name: 'upstream-demo-1.heic', mimeType: 'image/heic', buffer };
}

async function serve(app) {
  const root = path.join(appsRoot, app);
  const server = http.createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const filename = path.resolve(root, '.' + pathname);
      if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      const body = await fs.readFile(filename);
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
      res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' }).end(body);
    } catch (_) { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function pixels(page, buffer, mimeType, points = []) {
  return page.evaluate(async ({ base64, mimeType, points }) => {
    const blob = new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: mimeType });
    const image = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const center = Array.from(ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data);
    const corner = Array.from(ctx.getImageData(1, 1, 1, 1).data);
    const samples = points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
    image.close();
    return { width: canvas.width, height: canvas.height, center, corner, samples };
  }, { base64: buffer.toString('base64'), mimeType, points });
}

async function download(page, selector, label, keyboard = false) {
  const pending = page.waitForEvent('download');
  if (keyboard) await page.keyboard.press('Enter');
  else await page.locator(selector).click();
  const item = await pending;
  assert.equal(await item.failure(), null);
  const filename = item.suggestedFilename();
  const destination = path.join(artifacts, `${label}-${filename}`);
  await item.saveAs(destination);
  const buffer = await fs.readFile(destination);
  assert(buffer.length > 20, 'Downloaded file must be nonempty');
  return { filename, buffer, destination };
}

async function drop(page, selector, fixture) {
  await page.locator(selector).evaluate((node, payload) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(payload.base64), c => c.charCodeAt(0))], payload.name, { type: payload.mimeType }));
    const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
    node.dispatchEvent(event);
    if (!event.defaultPrevented) throw new Error('Drop must prevent browser navigation');
  }, { name: fixture.name, mimeType: fixture.mimeType, base64: fixture.buffer.toString('base64') });
}

async function drawRectangle(page, mobile, cancel = false, edges = [.2, .2, .7, .7]) {
  await page.locator('#canvas').scrollIntoViewIfNeeded();
  const bounds = await page.locator('#canvas').boundingBox();
  const start = { x: bounds.x + bounds.width * edges[0], y: bounds.y + bounds.height * edges[1] };
  const end = { x: bounds.x + bounds.width * edges[2], y: bounds.y + bounds.height * edges[3] };
  if (mobile) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
    await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 }); await page.mouse.up();
  }
}

async function canvasCenter(page, selector = '#canvas') {
  return page.locator(selector).evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data));
}

async function redactorPrivacyChecks(page, mobile, fixtures, label) {
  await page.locator('#file').setInputFiles(fixtures.transparent);
  await expect(page.locator('#meta')).toContainText('100 x 100');
  await expect(page.locator('#download')).toBeEnabled();
  const points = [[50, 50], [30, 50], [50, 30], [5, 5]];
  const sampleCanvas = () => page.locator('#canvas').evaluate((canvas, points) => points.map(([x, y]) => Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data)), points);
  const original = await sampleCanvas();
  assert.deepEqual(original.slice(0, 3), [[0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255]]);
  for (const mode of ['solid', 'blur', 'pixelate']) {
    await page.selectOption('#mode', mode);
    // Reverse drag also checks normalized rectangle coordinates on mouse and touch.
    await drawRectangle(page, mobile, false, [.9, .9, .1, .1]);
    const preview = await sampleCanvas();
    for (const sample of preview.slice(0, 3)) {
      if (mode === 'solid') assert.deepEqual(sample, [2, 6, 23, 255]);
      else assert(sample[3] < 255, `${mode} must replace the original opaque center/edge pixels, not retain them underneath`);
    }
    assert.deepEqual(preview[3], original[3], 'Pixels outside the selection must not change');
    const output = await download(page, '#download', `${label}-transparent-${mode}`);
    assert.deepEqual((await pixels(page, output.buffer, 'image/png', points)).samples, preview, 'Downloaded RGBA must match the visible redaction');
    await page.locator('#undo').click();
    assert.deepEqual(await sampleCanvas(), original);
  }

  // Keep the pointer held while using actual Tab/Enter to activate Download.
  await page.selectOption('#mode', 'solid');
  await page.locator('#canvas').scrollIntoViewIfNeeded();
  const bounds = await page.locator('#canvas').boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .2, bounds.y + bounds.height * .2);
  await page.mouse.down();
  try {
    await page.mouse.move(bounds.x + bounds.width * .8, bounds.y + bounds.height * .8, { steps: 4 });
    assert.deepEqual(await canvasCenter(page), [2, 6, 23, 255]);
    for (let i = 0; i < 30 && await page.evaluate(() => document.activeElement.id) !== 'download'; i++) await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'download');
    const output = await download(page, '#download', `${label}-held-gesture-keyboard`, true);
    assert.deepEqual((await pixels(page, output.buffer, 'image/png')).center, [2, 6, 23, 255], 'Keyboard export must commit the visible draft');
  } finally { await page.mouse.up(); }
  assert.deepEqual(await canvasCenter(page), [2, 6, 23, 255]);
  await page.locator('#undo').click();
  assert.deepEqual(await sampleCanvas(), original, 'Draft commits once, not again on pointer release');

  // An overlapping effect must use the already-redacted snapshot, never the source.
  await drawRectangle(page, mobile, false, [.2, .2, .8, .8]);
  await page.selectOption('#mode', 'pixelate');
  await drawRectangle(page, mobile, false, [.4, .4, .6, .6]);
  assert.deepEqual(await canvasCenter(page), [2, 6, 23, 255]);
  const overlap = await download(page, '#download', `${label}-overlap`);
  assert.deepEqual((await pixels(page, overlap.buffer, 'image/png')).center, [2, 6, 23, 255]);
  await page.locator('#undo').click();
  assert.deepEqual(await canvasCenter(page), [2, 6, 23, 255]);
  await page.locator('#undo').click();
  assert.deepEqual(await sampleCanvas(), original);
}

async function runRaceCase(browser, app, origin, fixtures) {
  const label = `${app}-async-replacement`;
  const context = await browser.newContext({ acceptDownloads: true });
  await networkPolicy(context, origin, label);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin);
    // Hold exactly one genuine browser decode to reproduce out-of-order completion.
    await page.evaluate(compressor => {
      const target = compressor ? window : HTMLImageElement.prototype;
      const key = compressor ? 'createImageBitmap' : 'decode';
      const original = target[key];
      let first = true;
      target[key] = async function (...args) {
        if (!first) return original.apply(this, args);
        first = false;
        const value = await original.apply(this, args);
        await new Promise(resolve => { window.releaseDecode = resolve; });
        window.heldDecodeFinished = true;
        return value;
      };
    }, app === 'compress');
    const input = ['exif', 'watermark'].includes(app) ? '#file-input' : '#file';
    const ready = app === 'compress' ? '[data-action="download"]' : app === 'exif' ? '[onclick="stripExif()"]' : app === 'watermark' ? '[onclick="downloadImage()"]' : '#download';
    const first = app === 'compress' ? Array.from({ length: 19 }, (_, i) => ({ ...fixtures.png, name: `queued-${i}.png` })) : fixtures.png;
    await page.locator(input).setInputFiles(first);
    await page.waitForFunction(() => typeof window.releaseDecode === 'function');
    if (app === 'compress') {
      await page.locator(input).setInputFiles(Array.from({ length: 5 }, (_, i) => ({ ...fixtures.png, name: `extra-${i}.png` })));
      await expect(page.locator('.item')).toHaveCount(20);
      await expect(page.locator('#notice')).toContainText('20');
      await page.locator('#clear-all').click();
      await expect(page.locator('.item')).toHaveCount(0);
    }
    await page.locator(input).setInputFiles(fixtures.replacement);
    const metadata = app === 'compress' ? '.item-meta' : app === 'exif' ? '#file-info' : app === 'watermark' ? '#img-info' : '#meta';
    await expect(page.locator(metadata)).toContainText(/96\s*[x\u00d7]\s*64/);
    await page.evaluate(() => window.releaseDecode());
    await page.waitForFunction(() => window.heldDecodeFinished);
    if (app === 'compress') {
      await expect(page.locator('.item')).toHaveCount(1);
      await page.locator('#compress-all').click();
    }
    await expect(page.locator(ready)).toBeEnabled();
    const output = await download(page, ready, label);
    const result = await pixels(page, output.buffer, 'image/' + path.extname(output.filename).slice(1).replace('jpg', 'jpeg'));
    assert.equal(result.width, 96); assert.equal(result.height, 64);
    await expect(page.locator(metadata)).toContainText(/96\s*[x\u00d7]\s*64/);
    assert.deepEqual(errors, []);
    results.push({ label, status: 'pass' });
    console.log(`PASS ${label}: latest image wins${app === 'compress' ? ', queue capacity and clear-during-decode' : ''}`);
  } catch (error) {
    results.push({ label, status: 'fail', error: error.stack, pageErrors: errors });
    throw error;
  } finally { await context.close(); }
}

async function runCase(browser, app, origin, zh, mobile, fixtures) {
  const label = `${app}-${zh ? 'zh' : 'en'}-${mobile ? 'mobile' : 'desktop'}`;
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile, acceptDownloads: true });
  const errors = [];
  await networkPolicy(context, origin, label);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin + '/', { waitUntil: 'load' });
    if (zh) {
      await page.locator('nav a').filter({ hasText: /中文/ }).click();
      await expect(page).toHaveURL(origin + '/zh/');
    }
    assert.equal(await page.locator('html').getAttribute('lang'), zh ? 'zh-CN' : 'en');
    const input = app === 'exif' || app === 'watermark' ? '#file-input' : '#file';
    const dropzone = app === 'compress' ? '#dropzone' : app === 'exif' || app === 'watermark' ? '#drop-zone' : '.drop';
    const ready = app === 'compress' ? '[data-action="download"]' : app === 'exif' ? '[onclick="stripExif()"]' : app === 'watermark' ? '[onclick="downloadImage()"]' : '#download';
    const chooser = page.waitForEvent('filechooser');
    await page.locator(dropzone).click();
    await (await chooser).setFiles(fixtures.png);
    if (app === 'compress') {
      await expect(page.locator('#compress-all')).toBeEnabled();
      await page.selectOption('#format', 'image/webp');
      await page.locator('#compress-all').click();
    }
    await expect(page.locator(ready)).toBeVisible();
    await expect(page.locator(ready)).toBeEnabled();
    if (app === 'resize') {
      await page.fill('#width', '160');
      await expect(page.locator('#height')).toHaveValue('120');
      await page.selectOption('#format', 'image/png');
    }
    if (app === 'redact') {
      await drawRectangle(page, mobile);
      assert.deepEqual(await canvasCenter(page), [2, 6, 23, 255]);
      await page.locator('#undo').click();
      assert.deepEqual(await canvasCenter(page), [236, 50, 50, 255]);
      if (mobile) {
        await drawRectangle(page, true, true);
        assert.deepEqual(await canvasCenter(page), [236, 50, 50, 255], 'Cancelled gesture must not commit');
      }
      await drawRectangle(page, mobile);
    }
    if (app === 'watermark') await page.locator('#wm-text').fill('PRIVATE');
    const output = await download(page, ready, label);
    const decoded = await pixels(page, output.buffer, 'image/' + path.extname(output.filename).slice(1).replace('jpg', 'jpeg'));
    assert.equal(decoded.width, app === 'resize' ? 160 : 320);
    assert.equal(decoded.height, app === 'resize' ? 120 : 240);
    if (app === 'redact') assert.deepEqual(decoded.center, [2, 6, 23, 255], 'Downloaded PNG must contain flattened redaction');
    if (app === 'watermark') {
      const before = await page.locator('#preview-canvas').evaluate(canvas => canvas.toDataURL());
      await page.locator('#wm-text').fill('');
      const after = await page.locator('#preview-canvas').evaluate(canvas => canvas.toDataURL());
      assert.notEqual(before, after, 'Text must change rendered pixels');
      await page.locator('[onclick="zoomOut()"]').click();
      const blankWidth = await page.locator('#preview-canvas').evaluate(canvas => canvas.style.width);
      await page.locator('#wm-text').fill('PRIVATE');
      assert.equal(await page.locator('#preview-canvas').evaluate(canvas => canvas.style.width), blankWidth);
    }
    await page.screenshot({ path: path.join(artifacts, `${label}.png`), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal page overflow');

    // A corrupt image after a good one must not leave a stale, downloadable image.
    await page.locator(input).setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    if (app === 'compress') {
      await expect(page.locator('.item-status.error')).toContainText(zh ? '无法解码' : 'could not decode');
      await expect(page.locator('.item').last().locator('[data-action="download"]')).toBeDisabled();
      await page.locator('#clear-all').click();
    } else if (app === 'exif' || app === 'watermark') {
      await expect(page.locator('.toast').last()).toContainText(zh ? '无法在浏览器中解码' : 'could not be decoded');
      await expect(page.locator(ready)).not.toBeVisible();
    } else {
      await expect(page.locator('#meta')).toContainText(zh ? '无法在浏览器中解码' : 'could not be decoded');
      await expect(page.locator(ready)).toBeDisabled();
    }

    await page.locator(input).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
    if (app === 'compress') {
      await expect(page.locator('.item-status.error')).toContainText(zh ? '不支持' : 'not supported');
      await expect(page.locator('#compress-all')).toBeDisabled();
      await page.locator('#clear-all').click();
    } else if (app === 'exif' || app === 'watermark') {
      await expect(page.locator('.toast').last()).toContainText(zh ? '请选择图片文件' : 'Please choose an image file');
      await expect(page.locator(ready)).not.toBeVisible();
    } else {
      await expect(page.locator('#meta')).toContainText(zh ? '无法在浏览器中解码' : 'could not be decoded');
      await expect(page.locator(ready)).toBeDisabled();
    }

    await drop(page, dropzone, fixtures.png);
    if (app === 'compress') {
      await expect(page.locator('#compress-all')).toBeEnabled();
      await page.locator('#compress-all').click();
    }
    await expect(page.locator(ready)).toBeVisible();
    await expect(page.locator(ready)).toBeEnabled();
    if (app === 'redact') {
      await page.locator(input).setInputFiles(fixtures.pattern);
      await expect(page.locator(ready)).toBeEnabled();
      const original = await canvasCenter(page);
      for (const mode of ['blur', 'pixelate']) {
        await page.selectOption('#mode', mode);
        await drawRectangle(page, mobile);
        assert.notDeepEqual(await canvasCenter(page), original, `${mode} must change pixels`);
        const corner = await page.locator('#canvas').evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(1, 1, 1, 1).data));
        assert.deepEqual(corner, [255, 255, 255, 255], `${mode} must stay inside its rectangle`);
        await page.locator('#clear').click();
        assert.deepEqual(await canvasCenter(page), original);
      }
      await redactorPrivacyChecks(page, mobile, fixtures, label);
    }
    if (app === 'resize') {
      await page.locator('#lock').uncheck();
      await page.fill('#width', '0');
      await page.locator(ready).click();
      await expect(page.locator('#meta')).toContainText('16384');
      await page.fill('#width', '1.5');
      await page.locator(ready).click();
      await expect(page.locator('#meta')).toContainText('16384');
    }
    if (app === 'convert') {
      await page.selectOption('#format', 'image/jpeg');
      const jpeg = await download(page, ready, label + '-jpeg');
      assert.equal(jpeg.buffer[0], 255); assert.equal(jpeg.buffer[1], 216);
      const jpegPixels = await pixels(page, jpeg.buffer, 'image/jpeg');
      assert(jpegPixels.corner.slice(0, 3).every(value => value > 245), 'Transparent JPEG background must be white');
      await page.selectOption('#format', 'image/png');
      const png = await download(page, ready, label + '-png');
      assert.equal((await pixels(page, png.buffer, 'image/png')).corner[3], 0);
      if (!allowCodecs) {
        await page.locator(input).setInputFiles({ name: 'photo.heic', mimeType: 'image/heic', buffer: Buffer.from('heic') });
        await expect(page.locator('#meta')).toContainText(zh ? 'HEIC 解码器加载失败' : 'HEIC decoder failed to load');
        await expect(page.locator(ready)).toBeDisabled();
      }
    }
    if (app === 'exif') {
      await page.locator(input).setInputFiles(fixtures.jpeg);
      await expect(page.locator('#exif-data')).toContainText('Audit camera');
      await expect(page.locator('#exif-data')).toContainText('2026:10:20 12:34:56');
      await expect(page.locator('#exif-data')).toContainText(zh ? 'GPS 位置信息' : 'GPS location data');
      const clean = await download(page, ready, label + '-exif');
      assert.equal(clean.buffer.includes(Buffer.from('Audit camera')), false);
      await expect(page.locator('#privacy-report')).toBeVisible();
      await expect(page.locator('#privacy-report-grid')).toContainText(zh ? '未发现可读取字段' : 'No readable fields found');
      await page.locator(input).setInputFiles(fixtures.malformedExif);
      await expect(page.locator('#exif-data')).toContainText(zh ? '无法完整读取' : 'could not be fully read');
      const repaired = await download(page, ready, label + '-malformed-exif');
      assert.equal(repaired.buffer.includes(Buffer.from('Audit camera')), false);
      await expect(page.locator('#privacy-report-grid')).toContainText(zh ? '元数据无法完整检查' : 'Metadata could not be fully inspected');
    }
    if (zh) {
      await page.locator('nav a').filter({ hasText: /^(EN|English)$/ }).click();
      await expect(page).toHaveURL(origin + '/');
      assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    }
    assert.deepEqual(errors, [], 'No uncaught page errors');
    results.push({ label, status: 'pass', download: output.filename, dimensions: `${decoded.width}x${decoded.height}` });
    console.log(`PASS ${label}: selection, export/decode, invalid image, drop/recovery, routing, pixels`);
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, `${label}-failure.png`), fullPage: true });
    results.push({ label, status: 'fail', error: error.stack, pageErrors: errors });
    throw error;
  } finally { await context.close(); }
}

async function runCodecCase(browser, app, origin, zh, fixtures) {
  const label = `${app}-${zh ? 'zh' : 'en'}-cdn-codecs`;
  const context = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' });
  await networkPolicy(context, origin, label);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(45000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const evidence = { label, origin, status: 'pass', downloads: [] };
  try {
    await page.goto(origin + (zh ? '/zh/' : '/'), { waitUntil: 'load' });
    if (app === 'convert') {
      assert.equal(await page.evaluate(() => typeof window.heic2any), 'function', 'Real CDN HEIC decoder must load');
      await page.evaluate(() => {
        window.codecCalls = 0;
        const decode = window.heic2any;
        window.heic2any = function (...args) { window.codecCalls++; return decode.apply(this, args); };
      });
      const chooser = page.waitForEvent('filechooser');
      await page.locator('.drop').click();
      await (await chooser).setFiles(fixtures.heic);
      await expect(page.locator('#download')).toBeEnabled({ timeout: 45000 });
      await expect(page.locator('#meta')).toContainText('1440 x 960');
      assert.equal(await page.evaluate(() => window.codecCalls), 1);
      for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
        await page.selectOption('#format', type);
        const output = await download(page, '#download', label);
        const decoded = await pixels(page, output.buffer, type);
        assert.equal(decoded.width, heicProvenance.width);
        assert.equal(decoded.height, heicProvenance.height);
        assert.notDeepEqual(decoded.center, decoded.corner, 'HEIC output must have real image content');
        evidence.downloads.push({ filename: output.filename, bytes: output.buffer.length, ...decoded });
      }
      evidence.fixtureSha256 = heicProvenance.sha256;
      evidence.decoderCalls = await page.evaluate(() => window.codecCalls);
    } else if (app === 'compress') {
      const libraries = await page.evaluate(() => ({ upng: typeof window.UPNG?.encode, pako: typeof window.pako?.deflate, zip: typeof window.JSZip, pica: typeof window.pica }));
      assert.deepEqual(libraries, { upng: 'function', pako: 'function', zip: 'function', pica: 'function' });
      await page.evaluate(() => {
        window.codecCalls = { png: 0, zip: 0 };
        const encode = window.UPNG.encode, zip = window.JSZip.prototype.generateAsync;
        // UPNG keeps helpers on the encode function; preserve its properties.
        window.UPNG.encode = new Proxy(encode, { apply(target, receiver, args) { window.codecCalls.png++; return Reflect.apply(target, receiver, args); } });
        window.JSZip.prototype.generateAsync = function (...args) { window.codecCalls.zip++; return zip.apply(this, args); };
      });
      await page.locator('#file').setInputFiles([fixtures.png, { ...fixtures.replacement, name: fixtures.png.name }]);
      await expect(page.locator('.item-meta').nth(0)).toContainText('320 x 240');
      await expect(page.locator('.item-meta').nth(1)).toContainText('96 x 64');
      await page.selectOption('#format', 'image/png');
      await page.fill('#maxw', '160');
      await page.locator('#quality').focus();
      await page.keyboard.press('End');
      await page.locator('#compress-all').click();
      await expect(page.locator('[data-action="download"]').nth(1)).toBeEnabled({ timeout: 45000 });
      await expect(page.locator('.item-status.error')).toHaveCount(0);
      const individual = [];
      for (let i = 0; i < 2; i++) {
        const output = await download(page, `.item:nth-child(${i + 1}) [data-action="download"]`, `${label}-${i}`);
        assert.equal(output.buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        const decoded = await pixels(page, output.buffer, 'image/png');
        assert.equal(decoded.width, i === 0 ? 160 : 96);
        assert.equal(decoded.height, i === 0 ? 120 : 64);
        individual.push(output.buffer);
        evidence.downloads.push({ filename: output.filename, bytes: output.buffer.length, ...decoded });
      }
      const zip = await download(page, '#download-zip', label);
      const entries = await page.evaluate(async base64 => {
        const archive = await window.JSZip.loadAsync(base64, { base64: true, checkCRC32: true });
        const files = [];
        for (const entry of Object.values(archive.files)) {
          if (!entry.dir) files.push({ name: entry.name, base64: await entry.async('base64') });
        }
        return files;
      }, zip.buffer.toString('base64'));
      assert.deepEqual(entries.map(entry => entry.name), ['fixture-compressed.png', 'fixture-compressed-2.png']);
      for (let i = 0; i < entries.length; i++) assert.deepEqual(Buffer.from(entries[i].base64, 'base64'), individual[i], 'ZIP contents must match individual image downloads byte-for-byte');
      evidence.zipCheck = execFileSync('/usr/bin/unzip', ['-t', zip.destination], { encoding: 'utf8' }).trim();
      evidence.zipEntries = entries.map(entry => entry.name);
      evidence.codecCalls = await page.evaluate(() => window.codecCalls);
      assert.deepEqual(evidence.codecCalls, { png: 2, zip: 1 });
    } else {
      throw new Error('--codecs supports only convert and compress');
    }
    assert.deepEqual(errors, [], 'No uncaught codec errors');
    const dependencyFailures = resources.filter(item => item.label === label && codecUrls.has(item.url) && ((item.event === 'failed' && !item.expectedBlocked) || (item.event === 'response' && item.status >= 400)));
    assert.deepEqual(dependencyFailures, [], 'Required CDN resources must load successfully');
    await page.screenshot({ path: path.join(artifacts, `${label}.png`), fullPage: true });
    results.push(evidence);
    console.log(`PASS ${label}: ${app === 'convert' ? 'genuine HEIC to PNG/JPEG/WebP' : 'CDN PNG encode, resize, ZIP integrity and duplicate filenames'}`);
  } catch (error) {
    results.push({ ...evidence, status: 'fail', error: error.stack, pageErrors: errors });
    await page.screenshot({ path: path.join(artifacts, `${label}-failure.png`), fullPage: true }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

async function main() {
  await fs.mkdir(artifacts, { recursive: true });
  const browser = await chromium.launch(process.env.CHROME_PATH
    ? { headless: true, executablePath: process.env.CHROME_PATH }
    : { headless: true, channel: 'chrome' });
  try {
    const fixturePage = await browser.newPage();
    const generated = await fixturePage.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ec3232'; ctx.fillRect(20, 20, 300, 220);
      const images = { png: canvas.toDataURL('image/png').split(',')[1], jpeg: canvas.toDataURL('image/jpeg').split(',')[1] };
      canvas.width = 96; canvas.height = 64;
      ctx.fillStyle = '#20cc50'; ctx.fillRect(0, 0, 96, 64);
      images.replacement = canvas.toDataURL('image/png').split(',')[1];
      canvas.width = 320; canvas.height = 240;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 320, 240);
      ctx.fillStyle = '#000000';
      for (let x = 2; x < 320; x += 4) ctx.fillRect(x, 0, 2, 240);
      images.pattern = canvas.toDataURL('image/png').split(',')[1];
      canvas.width = 100; canvas.height = 100;
      ctx.fillStyle = '#000000';
      ctx.fillRect(50, 30, 1, 40); ctx.fillRect(30, 50, 40, 1);
      images.transparent = canvas.toDataURL('image/png').split(',')[1];
      return images;
    });
    await fixturePage.close();
    const jpeg = Buffer.from(generated.jpeg, 'base64');
    // Real APP1 with nested Exif/GPS directories, not just top-level metadata.
    const text = Buffer.from('Audit camera\0');
    const tiff = Buffer.alloc(192);
    tiff.write('II'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
    function entry(offset, tag, type, count, value) {
      tiff.writeUInt16LE(tag, offset); tiff.writeUInt16LE(type, offset + 2);
      tiff.writeUInt32LE(count, offset + 4); tiff.writeUInt32LE(value, offset + 8);
    }
    tiff.writeUInt16LE(3, 8);
    entry(10, 0x010f, 2, text.length, 50); text.copy(tiff, 50);
    entry(22, 0x8769, 4, 1, 64); entry(34, 0x8825, 4, 1, 82);
    tiff.writeUInt16LE(1, 64); entry(66, 0x9003, 2, 20, 124);
    tiff.write('2026:10:20 12:34:56\0', 124);
    tiff.writeUInt16LE(3, 82); entry(84, 1, 2, 2, 78);
    entry(96, 2, 5, 3, 144); entry(108, 4, 5, 3, 168);
    for (const [i, value] of [37, 30, 0, 122, 15, 0].entries()) {
      tiff.writeUInt32LE(value, 144 + i * 8); tiff.writeUInt32LE(1, 148 + i * 8);
    }
    const exif = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
    const marker = Buffer.alloc(4); marker[0] = 255; marker[1] = 225; marker.writeUInt16BE(exif.length + 2, 2);
    const fixtures = {
      png: { name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(generated.png, 'base64') },
      replacement: { name: 'latest.png', mimeType: 'image/png', buffer: Buffer.from(generated.replacement, 'base64') },
      pattern: { name: 'pattern.png', mimeType: 'image/png', buffer: Buffer.from(generated.pattern, 'base64') },
      transparent: { name: 'transparent-private.png', mimeType: 'image/png', buffer: Buffer.from(generated.transparent, 'base64') },
      jpeg: { name: 'camera.jpg', mimeType: 'image/jpeg', buffer: Buffer.concat([jpeg.subarray(0, 2), marker, exif, jpeg.subarray(2)]) }
    };
    const malformed = Buffer.from(fixtures.jpeg.buffer);
    malformed.writeUInt32LE(8, 2 + 4 + 6 + 30);
    fixtures.malformedExif = { name: 'malformed-exif.jpg', mimeType: 'image/jpeg', buffer: malformed };
    if (codecsOnly && apps.includes('convert')) fixtures.heic = await heicFixture();
    for (const fixture of Object.values(fixtures)) await fs.writeFile(path.join(artifacts, fixture.name), fixture.buffer);
    for (const app of apps) {
      const { server, origin } = online ? { server: null, origin: `https://${app}.imageprivacy.org` } : await serve(app);
      try {
        if (codecsOnly) {
          for (const zh of [false, true]) await runCodecCase(browser, app, origin, zh, fixtures);
        } else {
          for (const mobile of [false, true]) for (const zh of [false, true]) await runCase(browser, app, origin, zh, mobile, fixtures);
          await runRaceCase(browser, app, origin, fixtures);
        }
      } finally { if (server) await new Promise(resolve => server.close(resolve)); }
    }
  } finally {
    await browser.close();
    await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify(results, null, 2) + '\n');
    await fs.writeFile(path.join(artifacts, 'resources.json'), JSON.stringify(resources, null, 2) + '\n');
  }
  console.log(`${results.length} cases passed. Artifacts: ${artifacts}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
