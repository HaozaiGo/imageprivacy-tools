const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', 'apps');
const untranslated = /EXIF Remover|EXIF Cleaner|Watermark Tool|Image Redactor|Image Resizer|Image Compressor|Image Converter|Read EXIF metadata|Upload and preview images/;

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const files = fs.readdirSync(root, { recursive: true }).filter(file =>
      file.includes('/zh/') && file.endsWith('.html') && !file.includes('/.vercel/'));
    for (const file of files) {
      const html = fs.readFileSync(path.join(root, file), 'utf8');
      assert(!untranslated.test(html), `${file}: untranslated tool copy`);
      const result = await page.evaluate(source => {
        const doc = new DOMParser().parseFromString(source, 'text/html');
        const wrongLinks = [...doc.querySelectorAll('a[href]')].filter(link => {
          const url = new URL(link.getAttribute('href'), 'https://imageprivacy.org/zh/');
          const tool = /^(exif|watermark|redact|resize|compress|convert)\.imageprivacy\.org$/.test(url.hostname);
          const languageSwitch = /^(English|EN)$/.test(link.textContent.trim());
          return tool && !url.pathname.startsWith('/zh/') && !languageSwitch;
        }).map(link => link.outerHTML);
        return { language: doc.documentElement.lang, wrongLinks,
          englishLabel: !!doc.querySelector('[aria-label="Language"]') };
      }, html);
      assert.equal(result.language, 'zh-CN', file);
      assert.deepEqual(result.wrongLinks, [], `${file}: tool link loses Chinese language`);
      assert.equal(result.englishLabel, false, `${file}: untranslated language label`);
    }
    console.log(`PASS: ${files.length} Chinese pages, tool names and language-preserving links`);
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
