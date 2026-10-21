const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

// Exercise public documents without requesting or clicking live advertisements.
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const online = args.includes('--online');
const repo = path.resolve(__dirname, '..');
const workspace = option('--toolkit-root', null);
const reportPath = path.resolve(option('--report', '/tmp/imageprivacy-site-audit.json'));
const publisher = 'pub-5333037258750046';
const sites = ['home', 'exif', 'watermark', 'redact', 'resize', 'compress', 'convert'].map(name => ({
  name: `imageprivacy-${name}`, root: path.join(repo, 'apps', name),
  origin: `https://${name === 'home' ? '' : `${name}.`}imageprivacy.org`
}));
if (workspace) {
  for (const [name, subdomain] of [['toolkitbox-home', ''], ['json-toolbox', 'json'], ['base64-tool', 'base64'], ['uuid-generator', 'uuid'], ['color-tool', 'color'], ['regex-tester', 'regex'], ['diff-checker', 'diff'], ['url-checker', 'url'], ['ssl-checker', 'ssl']]) {
    sites.push({ name, root: path.join(path.resolve(workspace), name), origin: `https://${subdomain ? `${subdomain}.` : ''}toolkitbox.org` });
  }
}
const byOrigin = new Map(sites.map(site => [site.origin, site]));
const report = { startedAt: new Date().toISOString(), mode: online ? 'production' : 'local',
  scope: sites.map(s => s.origin), adRequestsBlocked: true, pages: [], endpoints: [], redirects: [], issues: [] };
const issue = (url, type, detail) => report.issues.push({ url, type, detail });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm' };
const normalize = value => value.length > 1 ? value.replace(/\/$/, '') : value;

async function serve(site) {
  site.config = JSON.parse(await fs.readFile(path.join(site.root, 'vercel.json'), 'utf8'));
  if (online) return;
  site.server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
      const redirect = (site.config.redirects || []).find(rule => !rule.has && normalize(rule.source) === normalize(pathname));
      if (redirect) {
        res.writeHead(redirect.statusCode || (redirect.permanent ? 308 : 307), { Location: new URL(redirect.destination, site.local).href });
        res.end(); return;
      }
      let file = path.resolve(site.root, `.${pathname}`);
      if (file !== site.root && !file.startsWith(site.root + path.sep)) { res.writeHead(403); res.end(); return; }
      if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const content = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(content);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolve => site.server.listen(0, '127.0.0.1', resolve));
  site.local = `http://127.0.0.1:${site.server.address().port}`;
}
const targetUrl = url => {
  const parsed = new URL(url);
  const site = byOrigin.get(parsed.origin);
  return !online && site ? site.local + parsed.pathname + parsed.search : url;
};
async function get(url, manual = false) {
  const response = await fetch(targetUrl(url), { redirect: manual ? 'manual' : 'follow',
    signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } });
  return { status: response.status, url: response.url, location: response.headers.get('location'),
    type: response.headers.get('content-type') || '', text: await response.text() };
}
async function run() {
  let browser;
  try {
    for (const site of sites) await serve(site);
    browser = await chromium.launch(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH, headless: true }
      : { channel: 'chrome', headless: true });
    const parser = await browser.newPage();
    const parse = (text, type, base) => parser.evaluate(({ text, type, base }) => {
      const doc = new DOMParser().parseFromString(text, type);
      if (type === 'application/xml') {
        if (doc.querySelector('parsererror')) throw new Error('Invalid sitemap XML');
        return [...doc.querySelectorAll('loc')].map(n => n.textContent.trim());
      }
      const absolute = value => { try { return new URL(value, base).href; } catch { return null; } };
      const structuredErrors = [];
      for (const el of doc.querySelectorAll('script[type="application/ld+json"]')) {
        try { JSON.parse(el.textContent); } catch (e) { structuredErrors.push(e.message); }
      }
      return { title: doc.title.trim(), h1: [...doc.querySelectorAll('h1')].map(n => n.textContent.trim()),
        canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href'),
        lang: doc.documentElement.lang, robots: doc.querySelector('meta[name="robots"]')?.content || '',
        ids: [...doc.querySelectorAll('[id]')].map(n => n.id),
        publisher: doc.querySelector('meta[name="google-adsense-account"]')?.content || [...doc.querySelectorAll('script[src]')].map(n => n.getAttribute('src')).find(src => src.includes('adsbygoogle.js?client=ca-pub-5333037258750046')),
        description: doc.querySelector('meta[name="description"]')?.content,
        alternates: [...doc.querySelectorAll('link[hreflang]')].map(n => ({ lang: n.hreflang, href: n.getAttribute('href') })),
        links: [...doc.querySelectorAll('a[href]')].map(n => absolute(n.getAttribute('href'))).filter(Boolean),
        resources: [...doc.querySelectorAll('img[src],script[src],link[rel="stylesheet"][href]')].map(n => absolute(n.getAttribute('src') || n.getAttribute('href'))).filter(Boolean),
        structuredErrors };
    }, { text, type, base });
    const queue = new Set();
    for (const site of sites) {
      if (online && new URL(site.origin).hostname.split('.').length === 2) {
        const alias = site.origin.replace('https://', 'https://www.') + '/';
        try {
          const first = await get(alias, true);
          const final = await get(alias);
          report.endpoints.push({ url: alias, status: first.status, finalUrl: final.url, finalStatus: final.status });
          if (![301, 302, 307, 308].includes(first.status) || final.status !== 200 || final.url !== site.origin + '/') {
            issue(alias, 'www-canonical-redirect', { status: first.status, finalStatus: final.status, finalUrl: final.url });
          }
        } catch (error) { issue(alias, 'fetch-error', error.message); }
      }
      for (const endpoint of ['/sitemap.xml', '/robots.txt', '/ads.txt']) {
        const url = site.origin + endpoint;
        try {
          const result = await get(url, true);
          report.endpoints.push({ url, status: result.status });
          if (result.status !== 200) { issue(url, 'endpoint-status', result.status); continue; }
          if (endpoint === '/sitemap.xml') for (const location of await parse(result.text, 'application/xml', url)) {
            if (new URL(location).origin !== site.origin) issue(url, 'foreign-sitemap-url', location);
            else queue.add(location);
          }
          if (endpoint === '/ads.txt' && !result.text.split(/\r?\n/).some(line => new RegExp(`^google\\.com\\s*,\\s*${publisher}\\s*,\\s*DIRECT\\s*,\\s*f08c47fec0942fa0\\s*$`, 'i').test(line))) issue(url, 'ads-txt-record', 'Missing expected Google seller record');
          if (endpoint === '/robots.txt' && !result.text.includes(site.origin + '/sitemap.xml')) issue(url, 'robots-sitemap', 'Missing matching sitemap');
        } catch (error) { issue(url, 'fetch-error', error.message); }
      }
      const missingUrl = site.origin + '/__site-audit-page-that-does-not-exist__.html';
      const missing = await get(missingUrl);
      report.endpoints.push({ url: missingUrl, status: missing.status });
      if (missing.status !== 404) issue(missingUrl, 'soft-404', missing.status);
    }
    const sitemapUrls = new Set(queue);
    const documents = new Map();
    const checked = new Set();
    for (const url of queue) {
      if (queue.size > 500) throw new Error('Crawl exceeded 500 documents');
      try {
        const response = await get(url, true);
        if (response.status >= 300 && response.status < 400) {
          if (sitemapUrls.has(url)) issue(url, 'sitemap-redirect', response.location);
          if (!response.location) { issue(url, 'redirect-without-location', response.status); continue; }
          let destination = new URL(response.location, url);
          if (!online) { const localSite = sites.find(s => s.local === destination.origin); if (localSite) destination = new URL(destination.pathname + destination.search, localSite.origin); }
          if (byOrigin.has(destination.origin)) queue.add(destination.href);
          continue;
        }
        if (response.status !== 200) { issue(url, 'document-status', response.status); continue; }
        if (!response.type.includes('text/html')) continue;
        const data = await parse(response.text, 'text/html', url);
        documents.set(url, data);
        for (const field of ['title', 'description', 'canonical', 'lang', 'publisher']) if (!data[field]) issue(url, `missing-${field}`, field);
        if (data.h1.length !== 1 || !data.h1[0]) issue(url, 'h1', data.h1);
        if (data.canonical !== url) issue(url, 'canonical-mismatch', data.canonical);
        if (sitemapUrls.has(url) && /noindex/i.test(data.robots)) issue(url, 'indexed-noindex-page', data.robots);
        for (const error of data.structuredErrors) issue(url, 'invalid-jsonld', error);
        for (const link of data.links) {
          const target = new URL(link);
          target.hash = ''; target.search = '';
          if (byOrigin.has(target.origin) && (target.pathname.endsWith('/') || !path.extname(target.pathname) || target.pathname.endsWith('.html'))) queue.add(target.href);
        }
        for (const asset of data.resources) {
          const target = new URL(asset);
          if (!byOrigin.has(target.origin) || target.pathname.startsWith('/_vercel/') || checked.has(asset)) continue;
          checked.add(asset);
          const result = await get(asset);
          if (result.status !== 200) issue(url, 'broken-resource', `${asset}: ${result.status}`);
        }
      } catch (error) { issue(url, 'fetch-error', error.message); }
    }
    for (const [url, data] of documents) {
      const current = new URL(url);
      const englishPath = current.pathname.replace(/^\/zh\//, '/');
      for (const [language, pathname] of [['en', englishPath], ['zh-CN', '/zh' + englishPath]]) {
        const expected = current.origin + pathname;
        if (!data.alternates.some(a => a.lang === language && a.href === expected)) issue(url, 'missing-language-alternate', { language, expected });
      }
      for (const alternate of data.alternates) {
        const other = documents.get(alternate.href);
        if (byOrigin.has(new URL(alternate.href).origin) && !other) issue(url, 'unavailable-hreflang', alternate.href);
        if (other && !other.alternates.some(a => a.href === url)) issue(url, 'non-reciprocal-hreflang', alternate.href);
      }
      for (const link of data.links) {
        const target = new URL(link);
        if (!target.hash || target.hash === '#' || !byOrigin.has(target.origin)) continue;
        const id = decodeURIComponent(target.hash.slice(1));
        target.hash = ''; target.search = '';
        const linked = documents.get(target.href);
        if (linked && !linked.ids.includes(id)) issue(url, 'missing-anchor', link);
      }
    }
    for (const site of sites) {
      for (const rule of site.config.redirects || []) {
        if (rule.has || rule.source.includes('*') || rule.source.includes(':')) continue;
        const url = site.origin + rule.source;
        const result = await get(url, true);
        const expected = new URL(rule.destination, online ? site.origin : site.local).href;
        const canonicalTarget = new URL(rule.destination, site.origin);
        const fragment = decodeURIComponent(canonicalTarget.hash.slice(1));
        canonicalTarget.hash = '';
        const targetDocument = documents.get(canonicalTarget.href);
        if (fragment && (!targetDocument || !targetDocument.ids.includes(fragment))) issue(url, 'redirect-missing-anchor', rule.destination);
        report.redirects.push({ url, status: result.status, location: result.location });
        if (![301, 302, 307, 308].includes(result.status) || new URL(result.location || '/', targetUrl(url)).href !== expected) issue(url, 'redirect-mismatch', { expected, ...result, text: undefined });
      }
    }
    await parser.close();
    const urls = [...documents.keys()];
    let next = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (/googlesyndication|doubleclick|googleadservices|fundingchoicesmessages/.test(url.hostname) || url.pathname.startsWith('/_vercel/')) return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      while (next < urls.length) {
        const url = urls[next++];
        const entry = { url, title: documents.get(url).title, widths: [], errors: [] };
        try {
          pageErrors.length = 0;
          await page.goto(targetUrl(url), { waitUntil: 'load', timeout: 25000 });
          for (const width of [320, 390, 768, 1280]) {
            await page.setViewportSize({ width, height: 844 });
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
              brokenImages: [...document.images].filter(img => img.getAttribute('src') && img.complete && img.naturalWidth === 0).map(img => img.getAttribute('src')) }));
            entry.widths.push({ width, ...dimensions });
            if (dimensions.scroll > dimensions.client + 1) issue(url, 'horizontal-overflow', { width, ...dimensions });
            if (dimensions.brokenImages.length) issue(url, 'broken-browser-image', dimensions.brokenImages);
          }
          entry.errors = [...new Set(pageErrors)];
          for (const error of entry.errors) issue(url, 'javascript-error', error);
        } catch (error) { issue(url, 'browser-error', error.message); }
        report.pages.push(entry);
        if (report.pages.length % 20 === 0) console.log(`Browser checks: ${report.pages.length}/${urls.length}`);
      }
      await context.close();
    }));
  } finally {
    if (browser) await browser.close();
    for (const site of sites) if (site.server) await new Promise(resolve => site.server.close(resolve));
    report.completedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ mode: report.mode, pages: report.pages.length, endpoints: report.endpoints.length, redirects: report.redirects.length, issues: report.issues.length, report: reportPath }));
  for (const finding of report.issues) console.error(JSON.stringify(finding));
  if (report.issues.length) process.exitCode = 1;
}
run().catch(error => { console.error(error); process.exitCode = 1; });
