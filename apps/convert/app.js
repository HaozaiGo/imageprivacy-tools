(function () {
  'use strict';
  const base = new URL('.', document.currentScript.src);
  const zh = document.documentElement.lang.startsWith('zh');
  const $ = id => document.getElementById(id);
  const file = $('file'), preview = $('preview'), editor = $('editor');
  const format = $('format'), quality = $('quality'), meta = $('meta'), download = $('download');
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'btn'; cancel.id = 'cancel'; cancel.hidden = true;
  cancel.textContent = zh ? '取消处理' : 'Cancel processing';
  download.after(cancel);
  const limits = document.createElement('p');
  limits.className = 'hint';
  limits.textContent = zh ? '单张上限：30 MiB、2400 万像素，任一边不超过 8192 像素。' : 'Per image: 30 MiB, 24 megapixels, and at most 8192 pixels per side.';
  document.querySelector('.drop').after(limits);
  const messages = {
    size: zh ? '文件超过 30 MiB，请先使用较小的副本。' : 'File exceeds 30 MiB. Use a smaller copy.',
    pixels: zh ? '图片超过 2400 万像素或任一边超过 8192 像素，请使用较小的副本。' : 'Image exceeds 24 megapixels or 8192 pixels per side. Use a smaller copy.',
    unsupported: zh ? '请选择 HEIC、HEIF、JPEG、PNG、WebP 或 AVIF 图片。' : 'Choose a HEIC, HEIF, JPEG, PNG, WebP, or AVIF image.',
    browser: zh ? '此浏览器不支持后台图片处理，请使用较新版本的浏览器。' : 'This browser does not support background image processing. Use a recent browser.',
    decoder: zh ? 'HEIC 解码器加载失败，请重新选择图片以重试。' : 'The HEIC decoder could not load. Select the image again to retry.',
    decode: zh ? '这个文件无法在浏览器中解码，请尝试另一张图片。' : 'This file could not be decoded in the browser. Try another image.',
    timeout: zh ? '处理超时，已停止。请尝试更小的图片。' : 'Processing timed out and was stopped. Try a smaller image.',
    encode: zh ? '无法导出所选格式，请尝试 PNG 或更小的图片。' : 'Could not export this format. Try PNG or a smaller image.'
  };
  let worker = null, name = 'image', previewUrl = '', timer = null, ready = false;
  let dimensions = '';
  meta.setAttribute('role', 'status');
  meta.setAttribute('aria-live', 'polite');
  download.disabled = true;
  function busy(value) {
    cancel.hidden = !value;
    download.disabled = value || !ready;
    editor.setAttribute('aria-busy', String(value));
  }
  function stop() {
    clearTimeout(timer);
    worker?.terminate(); worker = null; ready = false;
    preview.removeAttribute('src');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    busy(false);
  }
  function fail(code) {
    stop();
    meta.textContent = messages[code] || messages.decode;
  }
  function deadline(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => fail('timeout'), ms);
  }
  function load(input) {
    if (!input) return;
    stop(); editor.style.display = 'grid';
    if (input.size > 30 * 1024 * 1024) return fail('size');
    if (!/\.(hei[cf]|jpe?g|png|webp|avif)$/i.test(input.name) && !/^image\/(hei[cf]|jpeg|png|webp|avif)$/i.test(input.type)) return fail('unsupported');
    if (!window.Worker || !window.OffscreenCanvas || !window.createImageBitmap) return fail('browser');
    name = input.name.replace(/\.[^.]+$/, '') || 'image';
    meta.textContent = zh ? '正在加载图片...' : 'Loading image...';
    busy(true);
    try {
      const current = new Worker(new URL('convert-worker.js', base));
      worker = current;
      current.onerror = event => { event.preventDefault(); if (worker === current) fail('decode'); };
      current.onmessage = ({ data }) => {
        // Ignore queued messages belonging to a replaced or terminated worker.
        if (worker !== current) return;
        if (data.type === 'progress') {
          meta.textContent = zh ? '正在本地解码 HEIC...' : 'Decoding HEIC locally...';
          return;
        }
        clearTimeout(timer);
        if (data.type === 'error') {
          if (ready && data.code === 'encode') { busy(false); meta.textContent = messages.encode; }
          else fail(data.code);
          return;
        }
        if (data.type === 'ready') {
          previewUrl = URL.createObjectURL(data.preview);
          preview.src = previewUrl;
          dimensions = `${zh ? '来源' : 'Source'}: ${data.width} x ${data.height}`;
          meta.textContent = dimensions;
          ready = true; busy(false);
        } else if (data.type === 'export') {
          const url = URL.createObjectURL(data.blob), anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `${name}.${data.blob.type.split('/')[1].replace('jpeg', 'jpg')}`;
          anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
          meta.textContent = dimensions;
          busy(false);
        }
      };
      deadline(45000);
      current.postMessage({ type: 'load', file: input });
    } catch { fail('browser'); }
  }
  cancel.onclick = () => {
    stop();
    meta.textContent = zh ? '已取消处理。请选择图片重新开始。' : 'Processing cancelled. Choose an image to start again.';
  };
  file.accept = '.heic,.heif,.jpg,.jpeg,.png,.webp,.avif,image/heic,image/heif,image/jpeg,image/png,image/webp,image/avif';
  file.addEventListener('change', () => { load(file.files[0]); file.value = ''; });
  const drop = document.querySelector('.drop');
  drop.addEventListener('dragover', event => event.preventDefault());
  drop.addEventListener('drop', event => { event.preventDefault(); load(event.dataTransfer.files[0]); });
  quality.oninput = () => { $('q').textContent = quality.value + '%'; };
  format.onchange = () => { quality.disabled = format.value === 'image/png'; };
  download.onclick = () => {
    if (!ready || download.disabled || !worker) return;
    busy(true);
    meta.textContent = zh ? '正在导出图片...' : 'Exporting image...';
    deadline(30000);
    worker.postMessage({ type: 'export', format: format.value, quality: +quality.value / 100, background: $('bg').value });
  };
  window.addEventListener('pagehide', stop);
  file.disabled = false;
}());
