(function () {
  'use strict';
  const zh = document.documentElement.lang.startsWith('zh');
  const $ = id => document.getElementById(id);
  const canvas = $('canvas'), ctx = canvas.getContext('2d');
  const file = $('file'), meta = $('meta'), download = $('download');
  let image = null, rects = [], draft = null, pointer = null, revision = 0;
  meta.setAttribute('role', 'status');
  canvas.style.touchAction = 'none';
  download.disabled = true;

  async function load(file, { signal } = {}) {
    if (!file || signal?.aborted) return false;
    const request = ++revision;
    let resolveAbort;
    const aborted = new Promise(resolve => { resolveAbort = resolve; });
    const abort = () => {
      if (request === revision) {
        revision++;
        cancel();
        image = null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        download.disabled = true;
        meta.textContent = '';
      }
      resolveAbort(false);
    };
    signal?.addEventListener('abort', abort, { once: true });
    cancel();
    image = null;
    rects = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    download.disabled = true;
    $('editor').style.display = 'grid';
    meta.textContent = zh ? '正在加载图片...' : 'Loading image...';
    const url = URL.createObjectURL(file);
    try {
      const candidate = new Image();
      candidate.src = url;
      if (!await Promise.race([candidate.decode().then(() => true), aborted])) return false;
      if (request !== revision) return false;
      image = candidate;
      const scale = Math.min(1, 1200 / image.naturalWidth, 1200 / image.naturalHeight);
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      meta.textContent = zh
        ? `原图 ${image.naturalWidth} x ${image.naturalHeight}，正在编辑 ${canvas.width} x ${canvas.height} 副本`
        : `Original ${image.naturalWidth} x ${image.naturalHeight}; editing ${canvas.width} x ${canvas.height} copy`;
      download.disabled = false;
      draw();
      return true;
    } catch (_) {
      if (request === revision) meta.textContent = zh ? '这个文件无法在浏览器中解码。' : 'This file could not be decoded in the browser.';
      return false;
    } finally {
      signal?.removeEventListener('abort', abort);
      URL.revokeObjectURL(url);
    }
  }

  function applyRect(rect) {
    const x = Math.floor(Math.min(rect.x, rect.x + rect.w));
    const y = Math.floor(Math.min(rect.y, rect.y + rect.h));
    const w = Math.ceil(Math.max(rect.x, rect.x + rect.w)) - x;
    const h = Math.ceil(Math.max(rect.y, rect.y + rect.h)) - y;
    if (!w || !h) return;
    if (rect.mode === 'solid') {
      ctx.fillStyle = '#020617';
      ctx.fillRect(x, y, w, h);
    } else {
      // Filter a separate snapshot, then replace the selected pixels. Compositing
      // over the source would retain sharp opaque details in transparent images.
      const filtered = document.createElement('canvas');
      const blur = rect.mode === 'blur';
      filtered.width = blur ? w : Math.max(1, Math.ceil(w / rect.strength));
      filtered.height = blur ? h : Math.max(1, Math.ceil(h / rect.strength));
      const filterCtx = filtered.getContext('2d');
      if (blur) {
        filterCtx.filter = `blur(${rect.strength}px)`;
        filterCtx.drawImage(canvas, -x, -y);
      } else {
        filterCtx.drawImage(canvas, x, y, w, h, 0, 0, filtered.width, filtered.height);
      }
      ctx.save();
      ctx.clearRect(x, y, w, h);
      ctx.imageSmoothingEnabled = blur;
      ctx.drawImage(filtered, 0, 0, filtered.width, filtered.height, x, y, w, h);
      ctx.restore();
    }
  }

  function draw() {
    if (!image) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    rects.forEach(applyRect);
    if (draft) applyRect(draft);
  }

  function pos(event) {
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * canvas.width / bounds.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * canvas.height / bounds.height))
    };
  }

  function cancel() {
    const id = pointer;
    pointer = null;
    draft = null;
    if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    draw();
  }

  function commitDraft() {
    if (!draft) return;
    if (draft && Math.abs(draft.w) > 0 && Math.abs(draft.h) > 0) rects.push(draft);
    cancel();
  }

  canvas.addEventListener('pointerdown', event => {
    if (!image || pointer !== null || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    pointer = event.pointerId;
    const p = pos(event);
    draft = { x: p.x, y: p.y, w: 0, h: 0, mode: $('mode').value, strength: +$('strength').value };
    canvas.setPointerCapture(pointer);
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer || !draft) return;
    const p = pos(event);
    draft.w = p.x - draft.x;
    draft.h = p.y - draft.y;
    draw();
  });
  canvas.addEventListener('pointerup', event => {
    if (event.pointerId !== pointer || !draft) return;
    const p = pos(event);
    draft.w = p.x - draft.x;
    draft.h = p.y - draft.y;
    commitDraft();
  });
  canvas.addEventListener('pointercancel', event => { if (event.pointerId === pointer) cancel(); });
  canvas.addEventListener('lostpointercapture', event => { if (event.pointerId === pointer) cancel(); });
  file.onchange = () => { load(file.files[0]); file.value = ''; };
  const drop = document.querySelector('.drop');
  drop.addEventListener('dragover', event => event.preventDefault());
  drop.addEventListener('drop', event => { event.preventDefault(); load(event.dataTransfer.files[0]); });
  $('undo').onclick = () => { cancel(); rects.pop(); draw(); };
  $('clear').onclick = () => { cancel(); rects = []; draw(); };
  async function exportImage() {
    if (!image || download.disabled) throw new Error('Image is not ready');
    commitDraft();
    const request = revision;
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob || request !== revision) throw new Error('Image changed or could not be exported');
    return new File([blob], 'redacted-image.png', { type: 'image/png' });
  }
  download.onclick = async () => {
    if (!image || download.disabled) return;
    const request = revision;
    const output = exportImage();
    download.disabled = true;
    try {
      const blob = await output;
      if (request !== revision) return;
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.download = blob.name;
      anchor.href = url;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (_) {
      if (request === revision) meta.textContent = zh ? '无法导出图片，请尝试更小的图片。' : 'Could not export this image. Try a smaller image.';
    } finally {
      if (request === revision) download.disabled = !image;
    }
  };
  window.ImagePrivacyEditor = { load, exportImage };
  file.disabled = false;
}());
