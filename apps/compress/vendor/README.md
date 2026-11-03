# Compressor browser dependencies

These unmodified files are extracted from the npm packages already used by this
app. No package versions changed. Each package's license is included alongside
its browser bundle. JPEG/PNG/WebP resizing, PNG encoding and ZIP downloads no
longer require a third-party CDN. HEIC is loaded from this directory on demand.

| Package | Version | Original package path | License file |
| --- | --- | --- | --- |
| pica | 10.0.3 | dist/pica.min.js | pica-LICENSE.txt |
| pako | 2.1.0 | dist/pako.min.js | pako-LICENSE.txt |
| upng-js | 2.1.0 | UPNG.js | upng-js-LICENSE.txt |
| jszip | 3.10.2 | dist/jszip.min.js | jszip-LICENSE.txt |
| heic2any | 0.0.4 | dist/heic2any.min.js | heic2any-LICENSE.txt |

Tarballs are from `https://registry.npmjs.org/<name>/-/<name>-<version>.tgz`.
Before extraction their SHA-512 values were checked against npm `dist.integrity`.
The optional AVIF encoder remains an explicitly selected, lazy CDN dependency;
this change does not claim AVIF works offline or vendor every optional codec.
