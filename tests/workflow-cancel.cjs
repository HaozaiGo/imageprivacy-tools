const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { expect } = require('playwright/test');

// Run directly: node tests/workflow-cancel.cjs. No server, network, or artifacts.
// The sender is a controllable editor; the receiver uses the real Redact loader.
const root = path.resolve(__dirname, '..');
const sourceOrigin = 'https://resize.imageprivacy.org';
const targetOrigin = 'https://redact.imageprivacy.org';
const sourceHtml = `<!doctype html><html lang="en"><main>
  <div id="editor"><button id="download">Download</button></div>
  </main><script src="/workflow.js"></script><script>
  window.ImagePrivacyEditor = { load: async () => true, exportImage: () => window.__export() };
  </script><script src="/workflow-adapter.js"></script></html>`;
const failed = /Could not transfer/;
const cancelled = /Transfer cancelled/;
const status = page => page.locator('.ip-transfer-status');
let browser;

async function setup({ delayDecode = false, holdReceiver = false } = {}) {
  const context = await browser.newContext();
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  context.on('request', request => {
    if (request.method() !== 'GET') errors.push(`Unexpected ${request.method()} request`);
  });
  let releaseReceiver;
  const receiverGate = new Promise(resolve => { releaseReceiver = resolve; });
  await context.addInitScript(({ delayDecode }) => {
    const open = window.open.bind(window);
    window.open = (...args) => {
      window.__token = new URLSearchParams(new URL(args[0], location.href).hash.slice(1)).get('ip-transfer');
      return (window.__child = open(...args));
    };
    window.__messages = [];
    window.addEventListener('message', event => {
      window.__messages.push({
        type: event.data?.type, token: event.data?.token, origin: event.origin,
        sourceIsOpener: event.source === window.opener, sourceIsNull: event.source === null
      });
    });
    window.__loads = [];
    let editor;
    Object.defineProperty(window, 'ImagePrivacyEditor', {
      configurable: true,
      get: () => editor,
      set(value) {
        const load = value.load;
        value.load = async (file, options) => {
          const record = { name: file.name, signal: options?.signal, settled: false };
          window.__loads.push(record);
          try { return await load(file, options); }
          finally { record.settled = true; }
        };
        editor = value;
      }
    });
    // Gate one actual decode, not the adapter call, so abort reaches the loader.
    const decode = HTMLImageElement.prototype.decode;
    let first = delayDecode;
    HTMLImageElement.prototype.decode = async function (...args) {
      let gated = false;
      if (first) {
        first = false;
        gated = true;
        window.__decodeStarted = true;
        await new Promise(resolve => { window.__releaseDecode = resolve; });
      }
      try { return await decode.apply(this, args); }
      finally { if (gated) window.__decodeSettled = true; }
    };
    const timeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, ms, ...args) => {
      if (ms === 45000) window.__expireTransfer = callback;
      return timeout(callback, ms, ...args);
    };
  }, { delayDecode });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['blob:', 'data:'].includes(url.protocol)) return route.continue();
    if (![sourceOrigin, targetOrigin].includes(url.origin)) return route.abort('blockedbyclient');
    if (url.origin === sourceOrigin && url.pathname === '/') {
      return route.fulfill({ contentType: 'text/html', body: sourceHtml });
    }
    if (holdReceiver && url.origin === targetOrigin && url.pathname === '/workflow-adapter.js') {
      await receiverGate;
    }
    const pathname = decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : '');
    const shared = ['/workflow.js', '/workflow-adapter.js', '/workflow.css'].includes(pathname);
    const directory = path.join(root, shared ? 'shared' : 'apps/redact');
    const filename = path.resolve(directory, '.' + pathname);
    if (!filename.startsWith(directory + path.sep)) return route.fulfill({ status: 403 });
    try {
      const body = await fs.readFile(filename);
      const contentType = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[path.extname(filename)] || 'application/octet-stream';
      return route.fulfill({ body, contentType });
    } catch (_) { return route.fulfill({ status: 404, body: 'Missing test asset' }); }
  });
  const source = await context.newPage();
  await source.goto(sourceOrigin);
  await source.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 40; canvas.height = 24;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ef4444'; ctx.fillRect(0, 0, 40, 24);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    window.__file = new File([blob], 'transferred.png', { type: 'image/png' });
    window.__export = () => window.__file;
  });
  return {
    source, releaseReceiver,
    async close() {
      releaseReceiver();
      await context.close();
      assert.deepEqual(errors, [], 'Unexpected browser errors');
    }
  };
}

async function start(source, manual = false) {
  const popup = source.waitForEvent('popup');
  if (manual) {
    await source.evaluate(target => {
      window.open(`${target}/#ip-transfer=${crypto.randomUUID()}&from=resize`);
    }, targetOrigin);
  } else {
    await source.selectOption('#ip-next-tool', 'redact');
    await source.click('#ip-continue');
  }
  const child = await popup;
  await child.waitForFunction(() => !!window.ImagePrivacyEditor);
  return child;
}

async function send(source, type = 'imageprivacy:file', oversized = false) {
  await source.evaluate(({ type, targetOrigin, oversized }) => {
    const file = oversized
      ? new File([new Uint8Array(30 * 1024 * 1024 + 1)], 'oversized.png', { type: 'image/png' })
      : window.__file;
    window.__child.postMessage({ type, token: window.__token, file }, targetOrigin);
  }, { type, targetOrigin, oversized });
}

async function localFile(page, drop = false) {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 12; canvas.height = 8;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#22c55e'; ctx.fillRect(0, 0, 12, 8);
    return canvas.toDataURL().split(',')[1];
  });
  if (drop) {
    await page.evaluate(base64 => {
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'local.png', { type: 'image/png' }));
      document.querySelector('.drop').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, base64);
  } else {
    await page.setInputFiles('#file', { name: 'local.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
  }
  await expect(page.locator('#download')).toBeEnabled();
}

async function assertLocalSurvives(page) {
  assert.deepEqual(await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    return { width: canvas.width, height: canvas.height, pixel: [...canvas.getContext('2d').getImageData(0, 0, 1, 1).data] };
  }), { width: 12, height: 8, pixel: [34, 197, 94, 255] });
  await expect(page.locator('#download')).toBeEnabled();
}

async function finishDecode(page) {
  await page.evaluate(() => window.__releaseDecode());
  await page.waitForFunction(() => window.__decodeSettled && window.__loads[0]?.settled);
}

async function assertAborted(page) {
  assert.equal(await page.evaluate(() => window.__loads[0]?.signal?.aborted), true);
  assert.equal(await page.evaluate(() => window.opener === null), true);
  await expect.poll(() => page.evaluate(() => window.__loads[0]?.settled)).toBe(true);
  await finishDecode(page);
  await expect(page.locator('#download')).toBeDisabled();
  await expect(status(page)).toHaveText(failed);
}

const cases = [];
function test(name, options, run) { cases.push({ name, options, run }); }

for (const drop of [false, true]) {
  test(`local ${drop ? 'drop' : 'selection'} cancels deferred decode`, { delayDecode: true }, async ({ source }) => {
    const child = await start(source);
    await child.waitForFunction(() => window.__decodeStarted);
    await localFile(child, drop);
    await expect(status(child)).toHaveText(cancelled);
    assert.equal(await child.evaluate(() => window.__loads[0].signal.aborted), true);
    await expect.poll(() => child.evaluate(() => window.__loads[0].settled)).toBe(true);
    await finishDecode(child);
    await assertLocalSurvives(child);
    await expect(status(child)).toHaveText(cancelled);
    await expect(status(source)).toHaveText(failed);
  });
}

test('cancel before arrival rejects late file and deferred export', {}, async ({ source }) => {
  await source.evaluate(() => { window.__export = () => new Promise(resolve => { window.__releaseExport = () => resolve(window.__file); }); });
  const child = await start(source);
  await expect(status(child)).toHaveText('Receiving image...');
  await localFile(child);
  await expect(status(source)).toHaveText(failed);
  await source.evaluate(() => window.__releaseExport());
  await send(source);
  await child.waitForFunction(() => window.__messages.some(message => message.type === 'imageprivacy:file'));
  assert.equal(await child.evaluate(() => window.__loads.length), 0);
  await assertLocalSurvives(child);
  await expect(status(child)).toHaveText(cancelled);
});

test('only authenticated abort cancels deferred decode', { delayDecode: true }, async ({ source }) => {
  const child = await start(source);
  await child.waitForFunction(() => window.__decodeStarted);
  const token = await source.evaluate(() => window.__token);
  await child.evaluate(({ token, sourceOrigin }) => {
    const data = { type: 'imageprivacy:abort', token };
    for (const fields of [
      { data, source: opener, origin: 'https://attacker.example' },
      { data, source: window, origin: sourceOrigin },
      { data: { ...data, token: 'wrong' }, source: opener, origin: sourceOrigin }
    ]) window.dispatchEvent(new MessageEvent('message', fields));
  }, { token, sourceOrigin });
  assert.equal(await child.evaluate(() => window.__loads[0].signal.aborted), false);
  await send(source, 'imageprivacy:abort');
  await expect(status(child)).toHaveText(failed);
  await assertAborted(child);
  await expect(status(source)).toHaveText(failed);
});

for (const oversized of [false, true]) {
  test(`${oversized ? 'oversized export' : 'export rejection'} before receiver ready`, { holdReceiver: true }, async ({ source, releaseReceiver }) => {
    await source.evaluate(oversized => {
      window.__export = oversized
        ? () => new File([new Uint8Array(30 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })
        : () => Promise.reject(new Error('Expected export rejection'));
    }, oversized);
    const child = await start(source);
    await expect(status(source)).toHaveText(oversized ? /up to 30 MB/ : failed);
    assert.equal(await source.evaluate(() => window.__messages.some(message => message.type === 'imageprivacy:ready')), false);
    releaseReceiver();
    await expect(status(child)).toHaveText(failed);
    assert.equal(await child.evaluate(() => window.__loads.length), 0);
    assert.equal(await child.evaluate(() => window.opener === null), true);
    await expect(child.locator('#download')).toBeDisabled();
  });
}

test('receiver rejects oversized incoming file', {}, async ({ source }) => {
  const child = await start(source, true);
  await expect(status(child)).toHaveText('Receiving image...');
  await send(source, 'imageprivacy:file', true);
  await expect(status(child)).toHaveText(/up to 30 MB/);
  assert.equal(await child.evaluate(() => window.__loads.length), 0);
  assert.equal(await child.evaluate(() => window.opener === null), true);
});

test('pending abort handshake cannot cancel a newer transfer', { holdReceiver: true }, async ({ source, releaseReceiver }) => {
  await source.evaluate(() => { window.__export = () => Promise.reject(new Error('Expected export rejection')); });
  const previous = await start(source);
  await expect(status(source)).toHaveText(failed);
  await source.evaluate(() => { window.__export = () => window.__file; });
  const current = await start(source);
  releaseReceiver();
  await expect(status(previous)).toHaveText(failed);
  await expect(status(current)).toHaveText('Edited image received.');
  await expect(status(source)).toHaveText('The edited result is open in the next tool.');
  assert.equal(await previous.evaluate(() => window.__loads.length), 0);
  assert.equal(await current.evaluate(() => window.__loads.length), 1);
  assert.equal(await current.evaluate(() => window.opener === null), true);
});

for (const decoding of [false, true]) {
  test(`closed source cancels ${decoding ? 'deferred decode' : 'waiting receiver'}`, { delayDecode: decoding }, async ({ source }) => {
    // No sender workflow session: this specifically exercises opener.closed polling.
    const child = await start(source, true);
    await expect(status(child)).toHaveText('Receiving image...');
    if (decoding) {
      await send(source);
      await child.waitForFunction(() => window.__decodeStarted);
    }
    await source.close();
    await expect(status(child)).toHaveText(failed, { timeout: 3000 });
    assert.equal(await child.evaluate(() => window.opener === null), true);
    if (decoding) await assertAborted(child);
  });
}

for (const sender of [false, true]) {
  test(`${sender ? 'sender' : 'receiver'} timeout aborts deferred decode`, { delayDecode: true }, async ({ source }) => {
    const child = await start(source);
    await child.waitForFunction(() => window.__decodeStarted);
    await (sender ? source : child).evaluate(() => window.__expireTransfer());
    await expect(status(child)).toHaveText(failed);
    await assertAborted(child);
    await expect(status(source)).toHaveText(failed);
  });
}

test('source closing before readiness terminates receiver', { holdReceiver: true }, async ({ source, releaseReceiver }) => {
  const child = await start(source);
  await source.close();
  releaseReceiver();
  await expect(status(child)).toHaveText(failed, { timeout: 3000 });
  assert.equal(await child.evaluate(() => window.opener === null), true);
  assert.equal(await child.evaluate(() => window.__loads.length), 0);
});

test('source navigation before readiness terminates receiver', { holdReceiver: true }, async ({ source, releaseReceiver }) => {
  const child = await start(source);
  await source.goto('about:blank');
  releaseReceiver();
  await expect(status(child)).toHaveText(failed, { timeout: 11000 });
  assert.equal(await child.evaluate(() => window.opener === null), true);
});

test('source navigation during decode aborts receiver', { delayDecode: true }, async ({ source }) => {
  const child = await start(source);
  await child.waitForFunction(() => window.__decodeStarted);
  await source.goto('about:blank');
  try { await expect(status(child)).toHaveText(failed, { timeout: 11000 }); }
  catch (error) {
    const messages = await child.evaluate(() => window.__messages.map(({ token, ...message }) => message));
    error.stack += `\nReceiver messages: ${JSON.stringify(messages)}`;
    throw error;
  }
  await assertAborted(child);
});

(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  let failures = 0;
  try {
    for (const { name, options, run } of cases) {
      let session;
      try {
        session = await setup(options);
        await run(session);
        await session.close();
        session = null;
        console.log(`PASS ${name}`);
      } catch (error) {
        failures++;
        console.error(`FAIL ${name}\n${error.stack}`);
      } finally {
        if (session) await session.close().catch(error => console.error(error));
      }
    }
  } finally { await browser.close(); }
  console.log(`${cases.length - failures}/${cases.length} workflow cancellation regressions passed`);
  if (failures) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
