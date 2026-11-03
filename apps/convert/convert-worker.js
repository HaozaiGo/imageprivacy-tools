'use strict';
let canvas = null;
const MAX_BYTES = 30 * 1024 * 1024;
function checkDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw Error('decode');
  if (width > 8192 || height > 8192 || width * height > 24000000) throw Error('pixels');
}
async function load(file) {
  if (file.size > MAX_BYTES) throw Error('size');
  if (/\.hei[cf]$/i.test(file.name) || /^image\/hei[cf]$/i.test(file.type)) {
    self.postMessage({ type: 'progress' });
    let heif;
    try {
      importScripts('vendor/libheif/libheif-bundle.js');
      heif = await self.libheif();
    } catch { throw Error('decoder'); }
    const decoder = new heif.HeifDecoder();
    const images = decoder.decode(new Uint8Array(await file.arrayBuffer()));
    try {
      const image = images[0];
      if (!image) throw Error('decode');
      const width = image.get_width(), height = image.get_height();
      // Check HEIC dimensions before allocating or decoding the full RGBA plane.
      checkDimensions(width, height);
      canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      const pixels = await new Promise((resolve, reject) => image.display(
        ctx.createImageData(width, height), value => value ? resolve(value) : reject(Error('decode'))));
      ctx.putImageData(pixels, 0, 0);
    } finally { for (const image of images) image.free(); }
  } else {
    const { imageSize } = await import('./vendor/image-size/index.js');
    const header = imageSize(new Uint8Array(await file.arrayBuffer()));
    if (!['png', 'jpg', 'webp', 'heif', 'avif'].includes(header.type)) throw Error('unsupported');
    checkDimensions(header.width, header.height);
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      checkDimensions(bitmap.width, bitmap.height);
      canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
    } finally { bitmap.close(); }
  }
  const ratio = Math.min(1, 1600 / Math.max(canvas.width, canvas.height));
  const thumb = new OffscreenCanvas(Math.max(1, Math.round(canvas.width * ratio)), Math.max(1, Math.round(canvas.height * ratio)));
  thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
  const preview = await thumb.convertToBlob({ type: 'image/png' });
  self.postMessage({ type: 'ready', preview, width: canvas.width, height: canvas.height });
  thumb.width = thumb.height = 1;
}
async function exportImage({ format, quality, background }) {
  if (!canvas || !['image/jpeg', 'image/png', 'image/webp'].includes(format)) throw Error('encode');
  let output = canvas;
  try {
    if (format === 'image/jpeg') {
      output = new OffscreenCanvas(canvas.width, canvas.height);
      const ctx = output.getContext('2d');
      ctx.fillStyle = /^#[\da-f]{6}$/i.test(background) ? background : '#ffffff';
      ctx.fillRect(0, 0, output.width, output.height);
      ctx.drawImage(canvas, 0, 0);
    }
    const blob = await output.convertToBlob({ type: format, quality: Math.max(0.4, Math.min(1, quality)) });
    if (!blob.size || blob.type !== format) throw Error('encode');
    self.postMessage({ type: 'export', blob });
  } finally { if (output !== canvas) output.width = output.height = 1; }
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') await load(data.file);
    else if (data.type === 'export') await exportImage(data);
  } catch (error) {
    self.postMessage({ type: 'error', code: data.type === 'export' ? 'encode' : error.message });
  }
};
