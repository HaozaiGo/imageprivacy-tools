/* === EXIF Remover - App Logic === */

document.addEventListener('DOMContentLoaded', () => {
  initUpload();
  initSectionTabs();
});

let currentFile = null;
let currentBuffer = null;
let currentExif = null;

/* ---- Upload ---- */
function initUpload() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFile(e.dataTransfer.files[0]);
  });
}

function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('❌ 请选择图片文件');
    return;
  }

  currentFile = file;

  // Show preview
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = document.getElementById('preview-img');
    img.src = e.target.result;
    img.onload = () => {
      // Read EXIF
      readFileData(file);
    };
  };
  reader.readAsDataURL(file);

  document.getElementById('result-area').style.display = 'flex';
}

function readFileData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    currentBuffer = e.target.result;

    // Update basic info
    updateBasicInfo(file);

    // Try to parse EXIF
    if (file.type === 'image/jpeg') {
      currentExif = parseEXIF(currentBuffer);
      renderExif(currentExif);
    } else {
      currentExif = null;
      renderExif(null, file.type);
    }
  };
  reader.readAsArrayBuffer(file);
}

function updateBasicInfo(file) {
  const img = document.getElementById('preview-img');
  
  // File info bar
  const infoBar = document.getElementById('file-info');
  const imgSize = img.naturalWidth && img.naturalHeight ? `${img.naturalWidth} × ${img.naturalHeight}` : '?';
  infoBar.innerHTML = `
    <span>📄 ${escapeHtml(file.name)}</span>
    <span>📦 ${formatBytes(file.size)}</span>
    <span>📐 ${imgSize} px</span>
    <span>🏷️ ${file.type || '未知'}</span>
  `;

  // Basic info panel
  const basic = document.getElementById('basic-data');
  basic.innerHTML = `
    <div class="exif-item"><span class="exif-tag">文件名</span><span class="exif-value">${escapeHtml(file.name)}</span></div>
    <div class="exif-item"><span class="exif-tag">文件大小</span><span class="exif-value">${formatBytes(file.size)}</span></div>
    <div class="exif-item"><span class="exif-tag">尺寸</span><span class="exif-value">${img.naturalWidth} × ${img.naturalHeight} px</span></div>
    <div class="exif-item"><span class="exif-tag">文件类型</span><span class="exif-value">${file.type || '未知'}</span></div>
    <div class="exif-item"><span class="exif-tag">上次修改</span><span class="exif-value">${new Date(file.lastModified).toLocaleString('zh-CN')}</span></div>
  `;
}

function renderExif(exif, fileType) {
  const container = document.getElementById('exif-data');

  if (fileType && fileType !== 'image/jpeg') {
    container.innerHTML = `<div class="exif-warning">ℹ️ ${fileType} 格式通常不包含 EXIF 元数据。EXIF 数据主要存在于 JPEG 格式的照片中。</div>`;
    return;
  }

  if (!exif) {
    container.innerHTML = '<div class="exif-warning">⚠️ 未找到 EXIF 数据。这张图片可能不包含元数据。</div>';
    return;
  }

  // Prioritize display order
  const priority = ['相机厂商','相机型号','拍摄日期','数字化日期','修改时间','软件',
    '曝光时间','光圈值','焦距','ISO','闪光灯','测光模式','曝光补偿','曝光程序',
    '色彩空间','图片宽度','图片高度','X分辨率','Y分辨率',
    '北纬/南纬','纬度','东经/西经','经度','高度','地标'];

  let html = '';
  const shown = new Set();

  // Priority items first
  for (const key of priority) {
    if (exif[key]) {
      html += `<div class="exif-item"><span class="exif-tag">${escapeHtml(key)}</span><span class="exif-value">${escapeHtml(exif[key])}</span></div>`;
      shown.add(key);
    }
  }

  // Remaining items
  for (const [key, val] of Object.entries(exif)) {
    if (!shown.has(key)) {
      html += `<div class="exif-item"><span class="exif-tag">${escapeHtml(key)}</span><span class="exif-value">${escapeHtml(val)}</span></div>`;
    }
  }

  // GPS warning
  if (exif['纬度'] || exif['经度']) {
    html = `<div class="exif-warning">⚠️ 此图片包含 GPS 位置信息！</div>` + html;
  }

  container.innerHTML = html;
}

/* ---- Section Tabs ---- */
function initSectionTabs() {
  document.querySelectorAll('.section-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.section-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('exif-section').style.display = tab.dataset.section === 'exif' ? 'block' : 'none';
      document.getElementById('basic-section').style.display = tab.dataset.section === 'basic' ? 'block' : 'none';
    });
  });
}

/* ---- Strip EXIF ---- */
function stripExif() {
  const img = document.getElementById('preview-img');
  if (!img.src || !currentFile) {
    showToast('❌ 请先选择图片');
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  
  // Draw image - this naturally strips all metadata
  ctx.drawImage(img, 0, 0);
  
  // Determine output format
  let mimeType = currentFile.type;
  let ext = currentFile.name.split('.').pop().toLowerCase();
  let quality = 0.92;

  // PNG - lossless
  if (mimeType === 'image/png' || ext === 'png') {
    mimeType = 'image/png';
  } else if (mimeType === 'image/webp' || ext === 'webp') {
    mimeType = 'image/webp';
  } else if (mimeType === 'image/gif' || ext === 'gif') {
    // GIF - re-encode as PNG since canvas can't export GIF
    mimeType = 'image/png';
    ext = 'png';
  } else {
    mimeType = 'image/jpeg';
    ext = 'jpg';
  }

  // Export
  const dataUrl = canvas.toDataURL(mimeType, quality);
  
  // Calculate size difference
  const originalSize = currentFile.size;
  // Approximate size from data URL
  const base64Data = dataUrl.split(',')[1];
  const newSize = Math.round(base64Data.length * 0.75); // approximate

  // Download
  const link = document.createElement('a');
  const baseName = currentFile.name.replace(/\.[^.]+$/, '');
  link.download = `${baseName}_clean.${ext}`;
  link.href = dataUrl;
  link.click();

  // Show result
  const stripResult = document.getElementById('strip-result');
  const saved = originalSize - newSize;
  const pct = ((1 - newSize / originalSize) * 100).toFixed(1);
  const savedStr = saved > 0 ? `节省 ${formatBytes(saved)} (${pct}%)` : `略微增大 ${Math.abs(pct)}%`;
  stripResult.innerHTML = `
    ✅ 已清除 EXIF<br>
    <span style="font-size:.75rem;color:var(--text-dim)">
      原文件 ${formatBytes(originalSize)} → ${formatBytes(newSize)} · ${savedStr}
    </span>`;
}

/* ---- Utilities ---- */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 2000);
}
