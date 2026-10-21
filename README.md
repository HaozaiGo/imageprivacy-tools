# ImagePrivacy Tools

Monorepo for the ImagePrivacy tool network.

## Apps

| App | Root Directory | Production domain |
| --- | --- | --- |
| Home | `apps/home` | `https://imageprivacy.org/` |
| EXIF Remover | `apps/exif` | `https://exif.imageprivacy.org/` |
| Watermark Tool | `apps/watermark` | `https://watermark.imageprivacy.org/` |
| Image Redactor | `apps/redact` | `https://redact.imageprivacy.org/` |
| Image Resizer | `apps/resize` | `https://resize.imageprivacy.org/` |
| Image Compressor | `apps/compress` | `https://compress.imageprivacy.org/` |
| Image Converter | `apps/convert` | `https://convert.imageprivacy.org/` |

## Deployment Model

Use one GitHub repository and multiple Vercel projects. In Vercel, import this same repository once per app and set each project's Root Directory to the matching app directory above.

This keeps the source code in one repository while preserving separate production domains, canonical URLs, sitemaps, robots files, ads.txt files, and SoftwareApplication structured data for SEO and GEO.

## Local Check

```bash
npm run check
```

The check script verifies each app has the minimum SEO and deployment files needed for this static tool network.

## Browser and Crawl Checks

Install the development dependencies with `npm ci`. The audit uses installed
Google Chrome; set `CHROME_PATH` to another Chromium executable when needed.

```bash
npm run audit:local
npm run audit:online
```

The audit reads every app sitemap, follows links across the configured sites,
checks titles, canonical URLs, language alternates, JSON-LD, referenced assets,
robots.txt, ads.txt and redirects, then checks pages at 320, 390, 768 and 1280
pixels for overflow and JavaScript errors. Advertising and analytics requests
are blocked in browser checks so a test does not generate ad impressions.
This does not verify live ad placement or account-level consent settings.

To include ToolkitBox checkouts located beside this repository:

```bash
npm run audit:local -- --toolkit-root .. --report /tmp/two-site-local-audit.json
npm run audit:online -- --toolkit-root .. --report /tmp/two-site-online-audit.json
```

The report contains per-page results and fails the command when issues remain.
Passing these checks is evidence of technical readiness, not an AdSense approval
or a substitute for Google's content review.

## Functional Regression Checks

```bash
npm run test:tools
npm run test:codecs
SMOKE_ARTIFACTS=/tmp/imageprivacy-production-smoke npm run test:tools -- --online
SMOKE_ARTIFACTS=/tmp/imageprivacy-production-codecs npm run test:codecs -- --online
```

The tool smoke generates harmless fixtures and checks real downloaded files,
dimensions, pixel changes, invalid inputs, mobile touch gestures, bilingual
pages, and asynchronous replacement. The codec mode explicitly allows the
app's pinned CDN dependencies and fetches one hash-verified HEIC fixture from
the decoder's upstream repository. It also checks PNG output and ZIP integrity
using the installed `unzip` command. Ads remain blocked. Results, dependency
requests, synthetic downloads, and screenshots are written under `/tmp`.

For the sibling ToolkitBox repositories, the shared runner lives in
`json-toolbox/tests/toolkit-smoke.cjs`; use its `--help` command for dependency
paths and `--online` testing. SSL has its own mocked API and browser suite in
`ssl-checker/test`. See [the readiness review](docs/adsense-readiness-2026-10-20.md)
for verified scope and account-side checks that remain outside code tests.
