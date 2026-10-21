(function () {
  'use strict';
  const zh = document.documentElement.lang.startsWith('zh');
  const $ = id => document.getElementById(id);
  const file = $('file'), preview = $('preview'), meta = $('meta'), download = $('download');
  const width = $('width'), height = $('height'), quality = $('quality'), format = $('format');
  let image = null, name = 'image', ratio = 1, revision = 0, previewUrl = '';
  meta.setAttribute('role', 'status');
  download.disabled = true;
  for (const input of [width, height]) { input.max = '16384'; input.step = '1'; }

  async function load(file) {
    if (!file) return;
    const request = ++revision;
    image = null;
    download.disabled = true;
    preview.removeAttribute('src');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    $('editor').style.display = 'grid';
    meta.textContent = zh ? '正在加载图片...' : 'Loading image...';
    const url = URL.createObjectURL(file);
    try {
      const candidate = new Image();
      candidate.src = url;
      await candidate.decode();
      if (request !== revision) return;
      image = candidate;
      name = file.name.replace(/\.[^.]+$/, '') || 'image';
      ratio = image.naturalWidth / image.naturalHeight;
      width.value = image.naturalWidth;
      height.value = image.naturalHeight;
      previewUrl = url;
      preview.src = url;
      meta.textContent = `${zh ? '原图' : 'Original'}: ${width.value} x ${height.value}`;
      download.disabled = false;
    } catch (_) {
      if (request === revision) meta.textContent = zh ? '这个文件无法在浏览器中解码。' : 'This file could not be decoded in the browser.';
    } finally {
      if (url !== previewUrl) URL.revokeObjectURL(url);
    }
  }

  file.onchange = () => { load(file.files[0]); file.value = ''; };
  const drop = document.querySelector('.drop');
  drop.addEventListener('dragover', event => event.preventDefault());
  drop.addEventListener('drop', event => { event.preventDefault(); load(event.dataTransfer.files[0]); });
  width.oninput = () => { if ($('lock').checked && +width.value > 0) height.value = Math.max(1, Math.round(+width.value / ratio)); };
  height.oninput = () => { if ($('lock').checked && +height.value > 0) width.value = Math.max(1, Math.round(+height.value * ratio)); };
  $('lock').onchange = () => { if ($('lock').checked) width.oninput(); };
  quality.oninput = () => { $('q').textContent = quality.value + '%'; };
  format.onchange = () => { quality.disabled = format.value === 'image/png'; };
  download.onclick = async () => {
    if (!image || download.disabled) return;
    const w = Number(width.value), h = Number(height.value);
    if (![w, h].every(value => Number.isInteger(value) && value >= 1 && value <= 16384) || w * h > 40000000) {
      meta.textContent = zh ? '尺寸须为 1 至 16384 的整数，总像素不得超过 4000 万。' : 'Use whole-number dimensions from 1 to 16384, with at most 40 million pixels.';
      return;
    }
    const request = revision, filename = name, type = format.value;
    download.disabled = true;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(image, 0, 0, w, h);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, type, +quality.value / 100));
      if (request !== revision) return;
      if (!blob || blob.type !== type) throw new Error('encode');
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${filename}-${w}x${h}.${type.split('/')[1].replace('jpeg', 'jpg')}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (_) {
      if (request === revision) meta.textContent = zh ? '无法导出所选格式，请尝试 PNG 或更小的尺寸。' : 'Could not export this format. Try PNG or smaller dimensions.';
    } finally {
      if (request === revision) download.disabled = !image;
    }
  };
  file.disabled = false;
}());
