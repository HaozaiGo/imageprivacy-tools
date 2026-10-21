(function () {
  'use strict';
  const zh = document.documentElement.lang.startsWith('zh');
  const $ = id => document.getElementById(id);
  const file = $('file'), preview = $('preview'), editor = $('editor');
  const format = $('format'), quality = $('quality'), meta = $('meta'), download = $('download');
  const failure = zh ? '这个文件无法在浏览器中解码。' : 'This file could not be decoded in the browser.';
  let image = null, name = 'image', previewUrl = '', revision = 0;
  meta.setAttribute('role', 'status');
  download.disabled = true;

  async function load(file) {
    if (!file) return;
    const request = ++revision;
    image = null;
    download.disabled = true;
    preview.removeAttribute('src');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    editor.style.display = 'grid';
    meta.textContent = zh ? '正在加载图片...' : 'Loading image...';
    let url = '';
    try {
      let source = file;
      if (/\.hei[cf]$/i.test(file.name) || /^image\/hei[cf]$/i.test(file.type)) {
        if (!window.heic2any) throw new Error(zh ? 'HEIC 解码器加载失败，请检查网络后重试。' : 'The HEIC decoder failed to load. Check your connection and try again.');
        meta.textContent = zh ? '正在本地解码 HEIC...' : 'Decoding HEIC locally...';
        const decoded = await window.heic2any({ blob: file, toType: 'image/png', quality: 1 });
        source = Array.isArray(decoded) ? decoded[0] : decoded;
      }
      if (request !== revision) return;
      url = URL.createObjectURL(source);
      const candidate = new Image();
      candidate.src = url;
      await candidate.decode();
      if (request !== revision) return;
      image = candidate;
      name = file.name.replace(/\.[^.]+$/, '') || 'image';
      previewUrl = url;
      preview.src = url;
      url = '';
      meta.textContent = `${zh ? '来源' : 'Source'}: ${image.naturalWidth} x ${image.naturalHeight}`;
      download.disabled = false;
    } catch (error) {
      if (request === revision) meta.textContent = error.message.includes('HEIC') ? error.message : failure;
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

  file.addEventListener('change', () => { load(file.files[0]); file.value = ''; });
  const drop = document.querySelector('.drop');
  drop.addEventListener('dragover', event => event.preventDefault());
  drop.addEventListener('drop', event => { event.preventDefault(); load(event.dataTransfer.files[0]); });
  quality.oninput = () => { $('q').textContent = quality.value + '%'; };
  format.onchange = () => { quality.disabled = format.value === 'image/png'; };
  download.onclick = async () => {
    if (!image || download.disabled) return;
    const request = revision, filename = name, type = format.value;
    download.disabled = true;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (type === 'image/jpeg') {
        ctx.fillStyle = $('bg').value;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(image, 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, type, +quality.value / 100));
      if (request !== revision) return;
      if (!blob || blob.type !== type) throw new Error('encode');
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${filename}.${type.split('/')[1].replace('jpeg', 'jpg')}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (_) {
      if (request === revision) meta.textContent = zh ? '无法导出所选格式，请尝试 PNG 或更小的图片。' : 'Could not export this format. Try PNG or a smaller image.';
    } finally {
      if (request === revision) download.disabled = !image;
    }
  };
}());
