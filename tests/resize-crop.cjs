// Run: node tests/resize-crop.cjs. Real Chrome, local resources, no external network.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const playwrightPath = process.env.PLAYWRIGHT_PATH || path.dirname(require.resolve('playwright'));
const { chromium } = require(playwrightPath);
const { expect } = require(path.join(playwrightPath, 'test'));
const root = path.resolve(__dirname, '../apps/resize');
const artifacts = process.env.RESIZE_ARTIFACTS || '/tmp/imageprivacy-resize-crop';
const colors = { red: [255, 0, 0, 255], green: [0, 255, 0, 255], blue: [0, 0, 255, 255], yellow: [255, 255, 0, 255] };

async function exportPixels(page) {
  return page.evaluate(async () => {
    const file = await window.ImagePrivacyEditor.exportImage();
    if (!(file instanceof File)) throw new Error('exportImage must return File');
    const image = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const samples = [[.25, .25], [.75, .25], [.25, .75], [.75, .75]].map(([x, y]) => Array.from(ctx.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data));
    const corner = Array.from(ctx.getImageData(0, 0, 1, 1).data);
    image.close();
    return { width: canvas.width, height: canvas.height, samples, corner, name: file.name, type: file.type };
  });
}

function check(output, width, height, samples) {
  assert.equal(output.width, width); assert.equal(output.height, height);
  if (samples) assert.deepEqual(output.samples, samples.map(color => colors[color]));
}

async function field(page, id, value) {
  await page.locator('#' + id).fill(String(value));
  await page.locator('#' + id).press('Tab');
}

async function cropRect(page, x, y, width, height) {
  if (await page.locator('#crop-toggle').getAttribute('aria-pressed') !== 'true') await page.locator('#crop-toggle').click();
  await page.selectOption('#crop-aspect', 'free');
  await field(page, 'crop-width', width);
  await field(page, 'crop-height', height);
  await field(page, 'crop-x', x);
  await field(page, 'crop-y', y);
}

async function loadHook(page, fixture) {
  return page.evaluate(async base64 => {
    const file = new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'hook.png', { type: 'image/png' });
    window.fixtureFile = file;
    return window.ImagePrivacyEditor.load(file);
  }, fixture.buffer.toString('base64'));
}

async function gesture(page, mobile) {
  const canvas = page.locator('.cropper-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  // The right half lies outside the initial left-quarter selection.
  const start = { x: box.x + box.width * .55, y: box.y + box.height * .1 };
  const end = { x: box.x + box.width * .9, y: box.y + box.height * .45 };
  if (mobile) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * i / 6, y: start.y + (end.y - start.y) * i / 6 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 }); await page.mouse.up();
  }
}

async function runCase(browser, origin, fixture, zh, mobile) {
  const label = (zh ? 'zh' : 'en') + '-' + (mobile ? 'mobile' : 'desktop');
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [], localFailures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().startsWith(origin) && response.status() >= 400) localFailures.push(response.url()); });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin || ['blob:', 'data:'].includes(url.protocol) ? route.continue() : route.abort();
  });
  try {
    await page.goto(origin + (zh ? '/zh/' : '/'));
    await expect(page.locator('#file')).toBeEnabled();
    assert.equal(await loadHook(page, fixture), true);
    await page.selectOption('#format', 'image/png');
    await expect(page.locator('#quality')).toBeDisabled();
    check(await exportPixels(page), 120, 80, ['red', 'green', 'blue', 'yellow']);
    await field(page, 'width', 60);
    await expect(page.locator('#height')).toHaveValue('40');
    check(await exportPixels(page), 60, 40, ['red', 'green', 'blue', 'yellow']);
    await page.locator('#lock').uncheck();
    await field(page, 'height', 30);
    check(await exportPixels(page), 60, 30, ['red', 'green', 'blue', 'yellow']);
    await page.locator('#reset-edits').click();
    await page.locator('#lock').check();

    for (const [button, w, h, expected] of [
      ['rotate-right', 80, 120, ['blue', 'red', 'yellow', 'green']],
      ['rotate-left', 120, 80, ['red', 'green', 'blue', 'yellow']],
      ['rotate-left', 80, 120, ['green', 'yellow', 'red', 'blue']],
      ['rotate-right', 120, 80, ['red', 'green', 'blue', 'yellow']],
      ['flip-horizontal', 120, 80, ['green', 'red', 'yellow', 'blue']],
      ['flip-vertical', 120, 80, ['yellow', 'blue', 'green', 'red']]
    ]) {
      await page.locator('#' + button).click();
      try { check(await exportPixels(page), w, h, expected); }
      catch (error) {
        console.error(button, await page.locator('#preview').evaluate(node => node.cropper.getImageData()));
        throw error;
      }
    }
    await page.locator('#reset-edits').click();
    await page.locator('#rotate-right').click();
    await page.locator('#flip-horizontal').click();
    check(await exportPixels(page), 80, 120, ['red', 'blue', 'green', 'yellow']);
    await page.locator('#flip-vertical').click();
    check(await exportPixels(page), 80, 120, ['green', 'yellow', 'red', 'blue']);
    await page.locator('#reset-edits').click();

    // Accessible numeric controls are the alternative to pointer-only cropping.
    await cropRect(page, 0, 0, 60, 40);
    check(await exportPixels(page), 60, 40, ['red', 'red', 'red', 'red']);
    await field(page, 'width', 30);
    await expect(page.locator('#height')).toHaveValue('20');
    check(await exportPixels(page), 30, 20, ['red', 'red', 'red', 'red']);
    await field(page, 'crop-x', 60);
    check(await exportPixels(page), 30, 20, ['green', 'green', 'green', 'green']);
    await page.locator('#crop-stage').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#crop-x')).toHaveValue('59');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(page.locator('#crop-x')).toHaveValue('49');
    await page.locator('#crop-toggle').click();
    check(await exportPixels(page), 120, 80, ['red', 'green', 'blue', 'yellow']);
    await page.locator('#crop-toggle').click();
    for (const [preset, aspect] of [['original', 1.5], ['1', 1], ['1.3333333333333333', 4 / 3], ['1.7777777777777777', 16 / 9]]) {
      await page.selectOption('#crop-aspect', preset);
      const data = await page.locator('#preview').evaluate(node => node.cropper.getData());
      assert(Math.abs(data.width / data.height - aspect) < .001, preset + ' ratio');
      const output = await exportPixels(page);
      assert(Math.abs(output.width / output.height - aspect) < .06, preset + ' export ratio');
    }
    await page.selectOption('#crop-aspect', 'free');
    await cropRect(page, 0, 0, 30, 20);
    await gesture(page, mobile);
    const selected = await exportPixels(page);
    assert(selected.width < 60 && selected.height < 40);
    assert.deepEqual(selected.samples, ['green', 'green', 'green', 'green'].map(color => colors[color]));
    await page.locator('#crop-stage').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, label + '.png'), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
    for (const button of await page.locator('.icon-button').all()) {
      const box = await button.boundingBox();
      assert(box.width >= 44 && box.height >= 44);
      assert(await button.getAttribute('aria-label'));
    }
    if (mobile) {
      const beforeResize = await page.locator('#preview').evaluate(node => node.cropper.getData());
      await page.setViewportSize({ width: 320, height: 740 });
      await page.waitForTimeout(300); // Cropper debounces its documented responsive rebuild.
      const afterResize = await page.locator('#preview').evaluate(node => node.cropper.getData());
      for (const key of ['x', 'y', 'width', 'height']) assert(Math.abs(beforeResize[key] - afterResize[key]) < .5, 'Responsive crop preserves ' + key);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '320px layout');
      await page.screenshot({ path: path.join(artifacts, label + '-320.png'), fullPage: true });
    }

    await page.locator('#reset-edits').click();
    await page.locator('#rotate-right').click();
    await cropRect(page, 40, 0, 40, 60);
    check(await exportPixels(page), 40, 60, ['red', 'red', 'red', 'red']);
    await page.locator('#rotate-left').click();
    check(await exportPixels(page), 60, 40, ['red', 'red', 'red', 'red']);
    await page.locator('#flip-horizontal').click();
    check(await exportPixels(page), 60, 40, ['red', 'red', 'red', 'red']);
    await page.locator('#rotate-right').click();
    check(await exportPixels(page), 40, 60, ['red', 'red', 'red', 'red']);
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#download').click();
    const downloaded = await downloadEvent;
    assert.equal(downloaded.suggestedFilename(), 'hook-40x60.png');
    assert.equal(await downloaded.failure(), null);
    await downloaded.saveAs(path.join(artifacts, label + '-crop.png'));
    const png = await fs.readFile(path.join(artifacts, label + '-crop.png'));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 40);
    assert.equal(png.readUInt32BE(20), 60);

    await page.locator('#lock').uncheck();
    for (const [w, h] of [['0', '40'], ['1.5', '40'], ['16385', '40'], ['10000', '10000']]) {
      await field(page, 'width', w); await field(page, 'height', h);
      const result = await page.evaluate(() => window.ImagePrivacyEditor.exportImage().then(() => 'unexpected success', error => error.message));
      assert.match(result, /16384/);
    }
    await page.locator('#reset-edits').click();
    await page.selectOption('#format', 'image/webp');
    assert.equal((await exportPixels(page)).type, 'image/webp');
    await expect(page.locator('#quality')).toBeEnabled();
    await page.selectOption('#format', 'image/jpeg');
    assert.equal((await exportPixels(page)).type, 'image/jpeg');

    // Transparent canvas exports retain alpha in PNG and flatten to white in JPEG.
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 20;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'red'; ctx.fillRect(10, 5, 20, 10);
      const blob = await new Promise(resolve => canvas.toBlob(resolve));
      await window.ImagePrivacyEditor.load(new File([blob], 'transparent.png', { type: 'image/png' }));
    });
    await page.selectOption('#format', 'image/png');
    assert.equal((await exportPixels(page)).corner[3], 0);
    await page.locator('#rotate-right').click();
    assert.equal((await exportPixels(page)).corner[3], 0);
    await page.selectOption('#format', 'image/jpeg');
    assert((await exportPixels(page)).corner.slice(0, 3).every(value => value > 245));
    assert.equal(await page.evaluate(() => window.ImagePrivacyEditor.load(new File(['bad'], 'bad.png', { type: 'image/png' }))), false);
    await expect(page.locator('#download')).toBeDisabled();
    await expect(page.locator('#rotate-left')).toBeDisabled();
    assert.equal(await page.evaluate(() => window.ImagePrivacyEditor.exportImage().then(() => false, () => true)), true);
    assert.equal(await loadHook(page, fixture), true);
    assert.deepEqual(errors, []);
    assert.deepEqual(localFailures, []);
    console.log('PASS ' + label + ': pixels, transforms, crop presets, keyboard/touch, formats, dimensions, download, invalid file');
  } catch (error) {
    console.error(label, await page.locator('#preview').evaluate(node => ({ data: node.cropper?.getData(), canvas: node.cropper?.getCanvasData(), box: node.cropper?.getCropBoxData() })));
    await page.screenshot({ path: path.join(artifacts, label + '-failure.png'), fullPage: true });
    throw error;
  } finally { await context.close(); }
}

async function raceChecks(browser, origin, fixture) {
  const context = await browser.newContext();
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  try {
    await page.goto(origin);
    await expect(page.locator('#file')).toBeEnabled();
    await loadHook(page, fixture);
    await page.evaluate(() => {
      const original = HTMLImageElement.prototype.decode;
      let first = true;
      HTMLImageElement.prototype.decode = async function (...args) {
        const result = await original.apply(this, args);
        if (first) { first = false; await new Promise(resolve => { window.releaseDecode = resolve; }); }
        return result;
      };
      window.firstLoad = window.ImagePrivacyEditor.load(window.fixtureFile);
    });
    await page.waitForFunction(() => typeof window.releaseDecode === 'function');
    assert.equal(await page.evaluate(() => window.ImagePrivacyEditor.exportImage().then(() => false, () => true)), true);
    assert.equal(await page.evaluate(() => window.ImagePrivacyEditor.load(window.fixtureFile)), true);
    await page.evaluate(() => window.releaseDecode());
    assert.equal(await page.evaluate(() => window.firstLoad), false);

    for (const newerManualLoad of [false, true]) {
      await page.evaluate(() => {
        const original = HTMLImageElement.prototype.decode;
        let first = true;
        HTMLImageElement.prototype.decode = async function (...args) {
          const result = await original.apply(this, args);
          if (first) { first = false; await new Promise(resolve => { window.releaseCancelledDecode = resolve; }); }
          return result;
        };
        window.controller = new AbortController();
        window.cancelledLoad = window.ImagePrivacyEditor.load(window.fixtureFile, { signal: window.controller.signal });
      });
      await page.waitForFunction(() => typeof window.releaseCancelledDecode === 'function');
      if (newerManualLoad) assert.equal(await page.evaluate(() => window.ImagePrivacyEditor.load(window.fixtureFile)), true);
      await page.evaluate(() => window.controller.abort());
      assert.equal(await page.evaluate(() => window.cancelledLoad), false, 'Abort resolves before the decoder is released');
      if (newerManualLoad) await expect(page.locator('#download')).toBeEnabled();
      else {
        await expect(page.locator('#download')).toBeDisabled();
        assert.equal(await page.evaluate(() => window.ImagePrivacyEditor.exportImage().then(() => false, () => true)), true);
      }
      await page.evaluate(() => { window.releaseCancelledDecode(); delete window.releaseCancelledDecode; });
      if (!newerManualLoad) assert.equal(await page.evaluate(() => window.ImagePrivacyEditor.load(window.fixtureFile)), true);
      check(await exportPixels(page), 120, 80);
    }
    assert.equal(await page.evaluate(async () => {
      const controller = new AbortController();
      const loaded = await window.ImagePrivacyEditor.load(window.fixtureFile, { signal: controller.signal });
      controller.abort();
      return loaded && !document.getElementById('download').disabled;
    }), true, 'Completed load removes its abort listener');

    for (const replacement of [false, true]) {
      await page.evaluate(() => {
        const original = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
          HTMLCanvasElement.prototype.toBlob = original;
          return original.call(this, blob => { window.releaseEncode = () => callback(blob); }, ...args);
        };
        window.pendingExport = window.ImagePrivacyEditor.exportImage().then(() => 'unexpected success', error => error.name);
      });
      await page.waitForFunction(() => typeof window.releaseEncode === 'function');
      if (replacement) await page.evaluate(() => window.ImagePrivacyEditor.load(window.fixtureFile));
      else await page.locator('#flip-horizontal').click();
      await page.evaluate(() => { window.releaseEncode(); delete window.releaseEncode; });
      assert.equal(await page.evaluate(() => window.pendingExport), 'AbortError');
    }
    console.log('PASS races: deferred-decode cancellation, old signals preserve newer loads, listener cleanup, stale exports');
  } finally { await context.close(); }
}

async function main() {
  await fs.mkdir(artifacts, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const filename = path.resolve(root, '.' + pathname);
      if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      const body = await fs.readFile(filename);
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' }).end(body);
    } catch (_) { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch(process.env.CHROME_PATH ? { headless: true, executablePath: process.env.CHROME_PATH } : { headless: true, channel: 'chrome' });
    const page = await browser.newPage();
    const base64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80;
      const ctx = canvas.getContext('2d');
      for (const [color, x, y] of [['#ff0000', 0, 0], ['#00ff00', 60, 0], ['#0000ff', 0, 40], ['#ffff00', 60, 40]]) {
        ctx.fillStyle = color; ctx.fillRect(x, y, 60, 40);
      }
      return canvas.toDataURL().split(',')[1];
    });
    await page.close();
    const fixture = { name: 'quadrants.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
    for (const mobile of [false, true]) for (const zh of [false, true]) await runCase(browser, origin, fixture, zh, mobile);
    await raceChecks(browser, origin, fixture);
    console.log('All resize crop checks passed. Screenshots/downloads: ' + artifacts);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
