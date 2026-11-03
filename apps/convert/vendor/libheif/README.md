# libheif-js 1.23.5

Unmodified `libheif-wasm/libheif-bundle.js` and its combined upstream LICENSE,
extracted from the pinned npm package. Loaded only by the conversion worker
after a HEIC/HEIF selection, never by ordinary image conversions.

- Package: https://registry.npmjs.org/libheif-js/-/libheif-js-1.23.5.tgz
- Package SHA-512 (base64): `umXZPthnWZtF3iG/5mQG+AZ2V6i0UeYpo3z2CkggTEgL8dKmIIwJT6TDuAMuabXa1yTW8uJ1ZAgR+CxNTklYYw==`
- Bundle SHA-256: `074b2b55ef3de477ba9f794ca381f3f0324c1cba8c91b4af07395f39c22d54cc`
- Wrapper source/build instructions: https://github.com/catdad-experiments/libheif-js/tree/d8ec4bc3bc5bf8055975577bccbbc7e1d7313c2d
- Native library and codec source/build: https://github.com/catdad-experiments/libheif-emscripten/tree/v1.23.5 (selected by the wrapper's `scripts/install.js`).
- License: LGPL-3.0; see `LICENSE` for libheif and bundled codec notices.

The worker imports this separate, replaceable library. No modifications have
been made to the library. App code is in `../../convert-worker.js`.
