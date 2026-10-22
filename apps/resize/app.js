(function () {
  'use strict';
  const zh = document.documentElement.lang.startsWith('zh');
  const $ = id => document.getElementById(id);
  const t = (en, cn) => zh ? cn : en;
  const file = $('file'), preview = $('preview'), meta = $('meta'), download = $('download');
  const width = $('width'), height = $('height'), quality = $('quality'), format = $('format');
  const labels = {
    crop: t('Crop', '裁剪'),
    left: t('Rotate left 90 degrees', '向左旋转 90 度'),
    right: t('Rotate right 90 degrees', '向右旋转 90 度'),
    horizontal: t('Flip horizontal', '水平翻转'),
    vertical: t('Flip vertical', '垂直翻转'),
    reset: t('Reset edits', '重置编辑')
  };
  const toolbar = document.createElement('fieldset');
  toolbar.className = 'edit-toolbar';
  toolbar.setAttribute('aria-label', t('Image editing', '图片编辑'));
  toolbar.innerHTML = [
    ['crop-toggle', 'crop', labels.crop, true],
    ['rotate-left', 'rotate-ccw', labels.left],
    ['rotate-right', 'rotate-cw', labels.right],
    ['flip-horizontal', 'flip-horizontal-2', labels.horizontal],
    ['flip-vertical', 'flip-vertical-2', labels.vertical],
    ['reset-edits', 'undo-2', labels.reset]
  ].map(([id, icon, label, toggle]) => '<button type="button" class="icon-button" id="' + id + '" data-icon="' + icon + '" aria-label="' + label + '" title="' + label + '"' + (toggle ? ' aria-pressed="false" aria-controls="crop-controls"' : '') + '><span class="tool-tip" aria-hidden="true">' + label + '</span></button>').join('');
  const stage = document.createElement('div');
  stage.className = 'image-stage';
  stage.id = 'crop-stage';
  stage.tabIndex = 0;
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-label', t('Image crop selection', '图片裁剪选区'));
  stage.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight');
  preview.before(toolbar, stage);
  stage.append(preview);
  preview.alt = t('Selected image', '所选图片');
  const cropControls = document.createElement('fieldset');
  cropControls.id = 'crop-controls';
  cropControls.className = 'crop-controls';
  cropControls.hidden = true;
  cropControls.innerHTML = '<legend>' + labels.crop + '</legend>' +
    '<label for="crop-aspect">' + t('Aspect ratio', '裁剪比例') + '</label>' +
    '<select id="crop-aspect"><option value="free">' + t('Free', '自由') + '</option><option value="original">' + t('Original', '原始比例') + '</option><option value="1">1:1</option><option value="1.3333333333333333">4:3</option><option value="1.7777777777777777">16:9</option></select>' +
    '<div class="row"><div><label for="crop-x">' + t('Left (px)', '左侧（像素）') + '</label><input id="crop-x" type="number" min="0" step="1"></div><div><label for="crop-y">' + t('Top (px)', '顶部（像素）') + '</label><input id="crop-y" type="number" min="0" step="1"></div></div>' +
    '<div class="row"><div><label for="crop-width">' + t('Crop width (px)', '裁剪宽度（像素）') + '</label><input id="crop-width" type="number" min="1" step="1"></div><div><label for="crop-height">' + t('Crop height (px)', '裁剪高度（像素）') + '</label><input id="crop-height" type="number" min="1" step="1"></div></div>' +
    '<p id="crop-status" class="crop-status" role="status"></p>';
  document.querySelector('.controls').prepend(cropControls);

  let image = null, name = 'image', ratio = 1, revision = 0, loadRevision = 0, previewUrl = '';
  let cropper = null, ready = false, cropping = false, cancelReady = null, signature = '', shape = '';
  const cropInputs = ['x', 'y', 'width', 'height'];
  const abort = () => new DOMException('The image or edits changed during this operation.', 'AbortError');
  const dimensionsError = () => new Error(t('Use whole-number dimensions from 1 to 16384, with at most 40 million pixels.', '尺寸须为 1 至 16384 的整数，总像素不得超过 4000 万。'));
  meta.setAttribute('role', 'status');
  download.disabled = true;
  toolbar.disabled = true;
  for (const input of [width, height]) { input.max = '16384'; input.step = '1'; }

  function fullSize() {
    const rotated = Math.abs(cropper.getImageData().rotate || 0) % 180 === 90;
    return { width: rotated ? image.naturalHeight : image.naturalWidth, height: rotated ? image.naturalWidth : image.naturalHeight };
  }

  function syncSelection() {
    if (!ready) return;
    const data = cropper.getData(), size = cropping ? data : fullSize();
    const w = Math.max(1, Math.round(size.width)), h = Math.max(1, Math.round(size.height));
    const nextSignature = JSON.stringify([cropping, ...['x', 'y', 'width', 'height', 'rotate', 'scaleX', 'scaleY'].map(key => Math.round((data[key] || 0) * 1000) / 1000)]);
    if (signature !== nextSignature) { revision++; signature = nextSignature; }
    // Moving the selection or reflecting it must not discard a custom export size.
    if (shape !== w + 'x' + h) {
      width.value = w;
      height.value = h;
      shape = w + 'x' + h;
    }
    ratio = size.width / size.height;
    if (cropping) {
      for (const key of cropInputs) $('crop-' + key).value = Math.round(data[key]);
      const bounds = fullSize();
      $('crop-x').max = bounds.width - 1;
      $('crop-y').max = bounds.height - 1;
      $('crop-width').max = bounds.width;
      $('crop-height').max = bounds.height;
      $('crop-status').textContent = w + ' x ' + h + ' px';
    }
  }

  function cropRatio() {
    const value = $('crop-aspect').value;
    return value === 'free' ? NaN : value === 'original' ? image.naturalWidth / image.naturalHeight : Number(value);
  }

  function setCropping(value) {
    cropping = value;
    $('crop-toggle').setAttribute('aria-pressed', String(value));
    cropControls.hidden = !value;
    cropper.setDragMode(value ? 'crop' : 'none');
    if (value) { cropper.setAspectRatio(cropRatio()); cropper.crop(); }
    else cropper.clear();
    syncSelection();
  }

  async function load(source, { signal } = {}) {
    if (!source) return false;
    const request = ++loadRevision;
    revision++;
    ready = false;
    image = null;
    download.disabled = true;
    toolbar.disabled = true;
    cropControls.disabled = true;
    if (cancelReady) { cancelReady(); cancelReady = null; }
    if (cropper) { cropper.destroy(); cropper = null; }
    preview.removeAttribute('src');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    cropping = false;
    signature = shape = '';
    $('crop-toggle').setAttribute('aria-pressed', 'false');
    cropControls.hidden = true;
    $('crop-aspect').value = 'free';
    $('editor').style.display = 'grid';
    meta.textContent = t('Loading image...', '正在加载图片...');
    let url = '';
    let resolveAbort;
    const aborted = new Promise(resolve => { resolveAbort = resolve; });
    const onAbort = () => {
      // An old bridge request must never clear a later manual upload.
      if (request === loadRevision) {
        loadRevision++;
        revision++;
        ready = false;
        image = null;
        toolbar.disabled = cropControls.disabled = download.disabled = true;
        if (cancelReady) { cancelReady(); cancelReady = null; }
        if (cropper) { cropper.destroy(); cropper = null; }
        preview.removeAttribute('src');
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = '';
        meta.textContent = t('Image loading cancelled.', '已取消加载图片。');
      }
      resolveAbort(false);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      if (signal?.aborted) { onAbort(); return false; }
      url = URL.createObjectURL(source);
      const candidate = new Image();
      candidate.src = url;
      if (!await Promise.race([candidate.decode().then(() => true), aborted])) return false;
      if (request !== loadRevision) return false;
      image = candidate;
      name = source.name.replace(/\.[^.]+$/, '') || 'image';
      previewUrl = url;
      preview.src = url;
      let gestureSelection = null;
      await new Promise(resolve => {
        cancelReady = resolve;
        cropper = new Cropper(preview, {
          viewMode: 1, autoCrop: false, autoCropArea: 1, dragMode: 'none',
          movable: false, zoomable: false, toggleDragModeOnDblclick: false,
          // Native decode already honors EXIF orientation; do not rotate it twice.
          checkOrientation: false, checkCrossOrigin: false,
          minContainerWidth: 0, minContainerHeight: 0,
          ready: resolve,
          cropstart: () => {
            if (ready && request === loadRevision) gestureSelection = cropper.getData();
          },
          cropend: () => {
            if (!ready || request !== loadRevision || !cropping) return;
            const data = cropper.getData();
            // A tap outside the crop starts a zero-area box; retain the last valid crop.
            if (data.width < 1 || data.height < 1) {
              cropper.setData(gestureSelection?.width >= 1 && gestureSelection?.height >= 1
                ? gestureSelection : { x: 0, y: 0, ...fullSize() });
            }
            gestureSelection = null;
            syncSelection();
          },
          crop: () => { if (request === loadRevision) syncSelection(); }
        });
      });
      if (request !== loadRevision) return false;
      cancelReady = null;
      ready = true;
      syncSelection();
      meta.textContent = t('Original', '原图') + ': ' + image.naturalWidth + ' x ' + image.naturalHeight;
      toolbar.disabled = cropControls.disabled = download.disabled = false;
      return true;
    } catch (_) {
      if (request === loadRevision) {
        image = null;
        ready = false;
        if (cropper) { cropper.destroy(); cropper = null; }
        preview.removeAttribute('src');
        previewUrl = '';
        meta.textContent = t('This file could not be decoded in the browser.', '这个文件无法在浏览器中解码。');
      }
      return false;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (url && url !== previewUrl) URL.revokeObjectURL(url);
    }
  }

  file.onchange = () => { load(file.files[0]); file.value = ''; };
  const drop = document.querySelector('.drop');
  drop.addEventListener('dragover', event => event.preventDefault());
  drop.addEventListener('drop', event => { event.preventDefault(); load(event.dataTransfer.files[0]); });
  width.oninput = () => { revision++; if ($('lock').checked && +width.value > 0) height.value = Math.max(1, Math.round(+width.value / ratio)); };
  height.oninput = () => { revision++; if ($('lock').checked && +height.value > 0) width.value = Math.max(1, Math.round(+height.value * ratio)); };
  $('lock').onchange = () => { revision++; if ($('lock').checked) width.oninput(); };
  quality.oninput = () => { revision++; $('q').textContent = quality.value + '%'; };
  format.onchange = () => { revision++; quality.disabled = format.value === 'image/png'; };
  $('crop-toggle').onclick = () => { if (ready) setCropping(!cropping); };
  $('crop-aspect').onchange = () => { if (ready) { cropper.setAspectRatio(cropRatio()); syncSelection(); } };
  for (const key of cropInputs) {
    $('crop-' + key).onchange = () => {
      if (!ready || !cropping) return;
      const value = Number($('crop-' + key).value);
      if (Number.isFinite(value) && value >= (key === 'x' || key === 'y' ? 0 : 1)) {
        const data = { [key]: value }, aspect = cropRatio();
        if (Number.isFinite(aspect) && key === 'height') data.width = value * aspect;
        cropper.setData(data);
      }
      syncSelection();
    };
  }
  stage.addEventListener('keydown', event => {
    if (!ready || !cropping || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const data = cropper.getData(), step = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowLeft') data.x -= step;
    if (event.key === 'ArrowRight') data.x += step;
    if (event.key === 'ArrowUp') data.y -= step;
    if (event.key === 'ArrowDown') data.y += step;
    cropper.setData(data);
  });
  function rotate(degrees) {
    if (!ready) return;
    const selection = cropper.getData(), bounds = fullSize();
    ready = false;
    if (cropping) cropper.clear();
    cropper.rotate(degrees);
    const container = cropper.getContainerData(), size = fullSize();
    const scale = Math.min(container.width / size.width, container.height / size.height);
    // A quarter turn must fit the entire image, including on a narrow touch viewport.
    cropper.setCanvasData({
      width: size.width * scale, height: size.height * scale,
      left: (container.width - size.width * scale) / 2,
      top: (container.height - size.height * scale) / 2
    });
    if (cropping) {
      const data = {
        x: degrees > 0 ? bounds.height - selection.y - selection.height : selection.y,
        y: degrees > 0 ? selection.x : bounds.width - selection.x - selection.width,
        width: selection.height, height: selection.width
      };
      if (Math.abs(cropRatio() - data.width / data.height) > .001) $('crop-aspect').value = 'free';
      cropper.setAspectRatio(cropRatio());
      cropper.crop();
      cropper.setData(data);
    }
    ready = true;
    syncSelection();
  }
  $('rotate-left').onclick = () => rotate(-90);
  $('rotate-right').onclick = () => rotate(90);
  function flip(horizontal) {
    if (!ready) return;
    const data = cropper.getImageData(), selection = cropper.getData(), bounds = fullSize();
    ready = false;
    // Cropper scales before rotating. Swap axes for screen-relative quarter turns.
    const quarterTurn = Math.abs(data.rotate || 0) % 180 === 90;
    if (horizontal !== quarterTurn) cropper.scaleX(-(data.scaleX ?? 1));
    else cropper.scaleY(-(data.scaleY ?? 1));
    if (cropping) cropper.setData(horizontal
      ? { x: bounds.width - selection.x - selection.width }
      : { y: bounds.height - selection.y - selection.height });
    ready = true;
    syncSelection();
  }
  $('flip-horizontal').onclick = () => flip(true);
  $('flip-vertical').onclick = () => flip(false);
  $('reset-edits').onclick = () => {
    if (!ready) return;
    cropping = false;
    shape = '';
    $('crop-aspect').value = 'free';
    cropper.setAspectRatio(NaN);
    cropper.reset();
    setCropping(false);
  };

  async function exportImage() {
    if (!image || !ready) throw new Error(t('Choose an image first.', '请先选择图片。'));
    const w = Number(width.value), h = Number(height.value);
    if (![w, h].every(value => Number.isInteger(value) && value >= 1 && value <= 16384) || w * h > 40000000) throw dimensionsError();
    const request = revision, filename = name, type = format.value;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    if (type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
    const data = cropper.getImageData();
    const unchanged = !cropping && !(data.rotate % 360) && (data.scaleX ?? 1) === 1 && (data.scaleY ?? 1) === 1;
    // Cropper preserves its selection ratio. The final draw also supports unlocked resizing.
    const source = unchanged ? image : cropper.getCroppedCanvas({ width: w, height: h, maxWidth: 16384, maxHeight: 16384, imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });
    if (!source || !source.width || !source.height) throw new Error('Empty crop');
    ctx.drawImage(source, 0, 0, w, h);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, type, +quality.value / 100));
    if (request !== revision) throw abort();
    if (!blob || blob.type !== type) throw new Error(t('Could not export this format. Try PNG or smaller dimensions.', '无法导出所选格式，请尝试 PNG 或更小的尺寸。'));
    return new File([blob], filename + '-' + w + 'x' + h + '.' + type.split('/')[1].replace('jpeg', 'jpg'), { type });
  }

  download.onclick = async () => {
    if (!ready || download.disabled) return;
    const request = loadRevision;
    download.disabled = true;
    try {
      const output = await exportImage();
      const url = URL.createObjectURL(output), anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = output.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) {
      if (request === loadRevision && error.name !== 'AbortError') meta.textContent = error.message;
    } finally {
      if (request === loadRevision) download.disabled = !ready;
    }
  };
  window.ImagePrivacyEditor = { load, exportImage };
  format.onchange();
  file.disabled = false;
}());
