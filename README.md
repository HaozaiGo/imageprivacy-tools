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
