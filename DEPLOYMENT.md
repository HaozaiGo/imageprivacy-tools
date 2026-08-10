# Deployment Notes

## Vercel Projects

Create or update one Vercel project per app, all connected to the same GitHub repository.

| Vercel Project | Root Directory | Domain |
| --- | --- | --- |
| `imageprivacy-home` | `apps/home` | `imageprivacy.org` |
| `imageprivacy-exif` | `apps/exif` | `exif.imageprivacy.org` |
| `imageprivacy-watermark` | `apps/watermark` | `watermark.imageprivacy.org` |
| `imageprivacy-redact` | `apps/redact` | `redact.imageprivacy.org` |
| `imageprivacy-resize` | `apps/resize` | `resize.imageprivacy.org` |
| `imageprivacy-compress` | `apps/compress` | `compress.imageprivacy.org` |
| `imageprivacy-convert` | `apps/convert` | `convert.imageprivacy.org` |

## SEO and GEO Requirements

Keep these files in each app root:

- `index.html`
- `robots.txt`
- `sitemap.xml`
- `ads.txt`
- `llms.txt`
- `vercel.json`

Keep these metadata patterns on every primary page:

- A self-referencing canonical URL
- A domain-specific sitemap URL in `robots.txt`
- `SoftwareApplication` JSON-LD for tool apps
- Clear links back to `https://imageprivacy.org/`
- Privacy and terms links where useful

## Why This Does Not Hurt SEO

Search engines and AI crawlers see the same public URLs and metadata as before. The repository layout is invisible to them. What matters is the deployed URL, HTML metadata, internal links, sitemap, robots file, and content quality.
