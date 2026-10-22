# Local editor dependencies

- Cropper.js **1.6.2**: unmodified `dist/cropper.min.js`, `dist/cropper.min.css`, and MIT license from `https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/`.
- Lucide Static **0.468.0**: unmodified `icons/{crop,rotate-ccw,rotate-cw,flip-horizontal-2,flip-vertical-2,undo-2}.svg` and license from `https://cdn.jsdelivr.net/npm/lucide-static@0.468.0/`.

All runtime resources are served locally, without a CDN or image upload.

Primary API reference: https://raw.githubusercontent.com/fengyuanchen/cropperjs/v1.6.2/README.md
Lucide reference: https://lucide.dev/guide/lucide

The editor uses Cropper's documented `crop`, `clear`, `setAspectRatio`,
`getData`, `setData`, `rotate`, `scaleX/Y`, and `getCroppedCanvas` APIs.
Native image decoding handles EXIF orientation before Cropper initializes.

## Integration

`window.ImagePrivacyEditor.load(file, { signal } = {})` resolves to `true`
when ready and `false` for failed/superseded/aborted loads. Starting a load
immediately invalidates the previous image and all pending exports. Abort
listeners are removed on completion; aborting an old request cannot clear a newer
manual upload. Cancellation resolves promptly even during a pending decode.

`window.ImagePrivacyEditor.exportImage()` resolves to a named `File` with
the selected format, quality and dimensions. It rejects when no image is ready,
dimensions are invalid, encoding fails, or the image/edits change during encoding
(`AbortError`). Download uses the same function.
