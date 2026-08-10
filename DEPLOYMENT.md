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

## Current Vercel Mapping

All seven Vercel projects are connected to the same GitHub repository:

```txt
HaozaiGo/imageprivacy-tools
```

Configured Root Directory values:

- `imageprivacy-home` -> `apps/home`
- `tools-exif-remover` -> `apps/exif`
- `tools-watermark-tool` -> `apps/watermark`
- `imageprivacy-redact` -> `apps/redact`
- `imageprivacy-resize` -> `apps/resize`
- `imageprivacy-compress` -> `apps/compress`
- `imageprivacy-convert` -> `apps/convert`

## Cloudflare DNS Records

Existing records already point to Vercel:

- `imageprivacy.org`
- `exif.imageprivacy.org`
- `watermark.imageprivacy.org`

Add these new records in Cloudflare:

| Type | Name | Target |
| --- | --- | --- |
| `CNAME` | `redact` | `cname.vercel-dns.com` |
| `CNAME` | `resize` | `cname.vercel-dns.com` |
| `CNAME` | `compress` | `cname.vercel-dns.com` |
| `CNAME` | `convert` | `cname.vercel-dns.com` |

If Cloudflare proxying causes validation trouble, set these records to DNS only until Vercel shows the domains as valid.

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
