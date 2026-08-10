/* === Watermark Tool - App Logic === */

document.addEventListener('DOMContentLoaded', () => {
  initUpload();
  initPositionButtons();
  initExportFormat();
});

let sourceImage = null;
let imageLoaded = false;
let zoom = 1;
let currentPos = 'center';

/* ---- Upload ---- */
function initUpload() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFile(e.dataTransfer.files[0]);
  });
}

function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('❌ 请选择图片文件');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      sourceImage = img;
      imageLoaded = true;
      document.getElementById('upload-section').style.display = 'none';
      document.getElementById('editor-section').style.display = 'block';
      document.getElementById('img-info').textContent = `${img.naturalWidth} × ${img.naturalHeight} · ${file.name}`;
      fitView();
      renderWatermark();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/* ---- Position Buttons ---- */
function initPositionButtons() {
  document.querySelectorAll('.pos-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pos-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPos = btn.dataset.pos;
      renderWatermark();
    });
  });
}

/* ---- Export Format ---- */
function initExportFormat() {
  const fmt = document.getElementById('export-format');
  const quality = document.getElementById('export-quality');
  fmt.addEventListener('change', () => {
    quality.style.display = fmt.value === 'image/jpeg' ? 'inline-block' : 'none';
  });
}

/* ---- Zoom ---- */
function zoomIn() { zoom = Math.min(3, zoom + 0.25); applyZoom(); }
function zoomOut() { zoom = Math.max(0.25, zoom - 0.25); applyZoom(); }
function fitView() {
  if (!sourceImage) return;
  const container = document.querySelector('.canvas-container');
  const cw = container.clientWidth - 20;
  const ch = container.clientHeight - 20;
  const iw = sourceImage.naturalWidth;
  const ih = sourceImage.naturalHeight;
  zoom = Math.min(cw / iw, ch / ih, 1);
  applyZoom();
}
function applyZoom() {
  document.getElementById('zoom-level').textContent = Math.round(zoom * 100) + '%';
  renderWatermark();
}

/* ======== Main Render ======== */
function renderWatermark() {
  if (!sourceImage) return;

  const canvas = document.getElementById('preview-canvas');
  const ctx = canvas.getContext('2d');
  const iw = sourceImage.naturalWidth;
  const ih = sourceImage.naturalHeight;

  canvas.width = iw;
  canvas.height = ih;

  // Clear and draw source
  ctx.clearRect(0, 0, iw, ih);
  ctx.drawImage(sourceImage, 0, 0, iw, ih);

  // Watermark config
  const text = document.getElementById('wm-text').value || ' ';
  const font = document.getElementById('wm-font').value;
  const size = parseInt(document.getElementById('wm-size').value);
  const opacity = parseFloat(document.getElementById('wm-opacity').value);
  const color = document.getElementById('wm-color').value;
  const bold = document.getElementById('wm-bold').checked;
  const italic = document.getElementById('wm-italic').checked;
  const rotation = parseInt(document.getElementById('wm-rotation').value);
  const margin = parseInt(document.getElementById('wm-margin').value);
  const tiled = document.getElementById('wm-tiled').checked;
  const shadowEnabled = document.getElementById('wm-shadow-enable').checked;
  const shadowColor = document.getElementById('wm-shadow').value;

  if (!text.trim()) return;

  ctx.globalAlpha = opacity;

  const fontStyle = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${font}`;
  ctx.font = fontStyle;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  // Shadow
  if (shadowEnabled) {
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
  }

  const textWidth = ctx.measureText(text).width;

  // Calculate position
  const centerX = iw / 2;
  const centerY = ih / 2;

  if (tiled) {
    // Tiled watermark
    const spacingX = textWidth + margin * 2;
    const spacingY = size * 3 + margin * 2;
    const rotRad = rotation * Math.PI / 180;

    for (let x = -spacingX; x < iw + spacingX; x += spacingX) {
      for (let y = -spacingY; y < ih + spacingY; y += spacingY) {
        ctx.save();
        ctx.translate(x + spacingX / 2, y + spacingY / 2);
        ctx.rotate(rotRad);
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
    }
  } else {
    // Single position
    let posX, posY;

    switch (currentPos) {
      case 'top-left': posX = margin + textWidth / 2; posY = margin + size / 2; break;
      case 'top-center': posX = centerX; posY = margin + size / 2; break;
      case 'top-right': posX = iw - margin - textWidth / 2; posY = margin + size / 2; break;
      case 'center-left': posX = margin + textWidth / 2; posY = centerY; break;
      case 'center': posX = centerX; posY = centerY; break;
      case 'center-right': posX = iw - margin - textWidth / 2; posY = centerY; break;
      case 'bottom-left': posX = margin + textWidth / 2; posY = ih - margin - size / 2; break;
      case 'bottom-center': posX = centerX; posY = ih - margin - size / 2; break;
      case 'bottom-right': posX = iw - margin - textWidth / 2; posY = ih - margin - size / 2; break;
    }

    const rotRad = rotation * Math.PI / 180;

    ctx.save();
    ctx.translate(posX, posY);
    ctx.rotate(rotRad);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  ctx.globalAlpha = 1;
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Apply zoom via CSS
  canvas.style.width = (iw * zoom) + 'px';
  canvas.style.height = (ih * zoom) + 'px';
}

/* ---- Download ---- */
function downloadImage() {
  const canvas = document.getElementById('preview-canvas');
  const fmt = document.getElementById('export-format').value;
  const quality = parseFloat(document.getElementById('export-quality').value);
  const dataUrl = canvas.toDataURL(fmt, fmt === 'image/jpeg' ? quality : undefined);

  const ext = fmt === 'image/png' ? 'png' : 'jpg';
  const link = document.createElement('a');
  link.download = `watermarked.${ext}`;
  link.href = dataUrl;
  link.click();
  showToast('✅ 已下载');
}

/* ---- Label Updates ---- */
function updateSizeLabel() {
  document.getElementById('wm-size-label').textContent = document.getElementById('wm-size').value + 'px';
}
function updateOpacityLabel() {
  document.getElementById('wm-opacity-label').textContent = Math.round(parseFloat(document.getElementById('wm-opacity').value) * 100) + '%';
}
function updateRotationLabel() {
  document.getElementById('wm-rotation-label').textContent = document.getElementById('wm-rotation').value + '°';
}
function updateMarginLabel() {
  document.getElementById('wm-margin-label').textContent = document.getElementById('wm-margin').value + 'px';
}

/* ---- Utilities ---- */
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 2000);
}
