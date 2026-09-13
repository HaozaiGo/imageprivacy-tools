/* === EXIF Remover - App Logic === */

const isZh = document.documentElement.lang.toLowerCase().startsWith('zh');
const copy = {
  chooseImage: isZh ? '请选择图片文件' : 'Please choose an image file',
  chooseFirst: isZh ? '请先选择图片' : 'Choose an image first',
  unknown: isZh ? '未知' : 'Unknown',
  fileName: isZh ? '文件名' : 'File name',
  fileSize: isZh ? '文件大小' : 'File size',
  dimensions: isZh ? '尺寸' : 'Dimensions',
  fileType: isZh ? '文件类型' : 'File type',
  modified: isZh ? '上次修改' : 'Last modified',
  noExif: isZh ? '未找到可读取的 EXIF 数据。这张图片可能不包含 EXIF。' : 'No readable EXIF data was found. This image may not contain EXIF metadata.',
  nonJpeg: isZh ? '此格式不由当前解析器读取 EXIF。导出后仍会创建新的图片副本。' : 'The current parser does not inspect EXIF in this format. Export still creates a newly encoded image copy.',
  gpsWarning: isZh ? '此图片包含 GPS 位置信息！' : 'This image contains GPS location data.',
  exportFailed: isZh ? '浏览器无法导出这张图片' : 'The browser could not export this image',
  cleaned: isZh ? '已导出清理后的副本' : 'Cleaned copy exported',
  original: isZh ? '原文件' : 'Original',
  saved: isZh ? '减小' : 'smaller',
  larger: isZh ? '增大' : 'larger',
  reportCopied: isZh ? '隐私报告已复制' : 'Privacy report copied',
  copyFailed: isZh ? '无法复制报告' : 'Could not copy report',
  localProcessing: isZh ? '处理位置' : 'Processing location',
  localValue: isZh ? '此浏览器（未上传）' : 'This browser (no upload)',
  sourceFields: isZh ? '原图 EXIF 字段' : 'Source EXIF fields',
  gpsDetected: isZh ? '检测到 GPS' : 'GPS detected',
  yes: isZh ? '是' : 'Yes',
  no: isZh ? '否' : 'No',
  notInspected: isZh ? '当前格式未检查' : 'Not inspected for this format',
  outputCheck: isZh ? '导出后 EXIF 检查' : 'Post-export EXIF check',
  noReadableExif: isZh ? '未发现可读取字段' : 'No readable fields found',
  fieldsRemain: isZh ? '仍有字段，需要复查' : 'Fields remain; review needed',
  outputFormat: isZh ? '输出格式' : 'Output format',
  outputSize: isZh ? '输出大小' : 'Output size',
  reportNote: isZh
    ? '此报告验证浏览器内的重新编码结果和当前解析器可读取的 JPEG EXIF。它不会检查画面中的人脸、地址、屏幕文字，也不能证明所有厂商私有元数据都已移除。分享前请再次检查导出文件。'
    : 'This report verifies the browser re-encoding result and JPEG EXIF readable by this parser. It does not inspect faces, addresses, screen text, or prove that every proprietary metadata block is absent. Review the exported file before sharing.'
};

const englishExifLabels = {
  '相机厂商': 'Camera maker', '相机型号': 'Camera model', '拍摄方向': 'Orientation',
  '拍摄日期': 'Date taken', '数字化日期': 'Digitized date', '修改时间': 'Modified date',
  '软件': 'Software', '曝光时间': 'Exposure time', '光圈值': 'F-number', '焦距': 'Focal length',
  '闪光灯': 'Flash', '测光模式': 'Metering mode', '曝光补偿': 'Exposure bias',
  '曝光程序': 'Exposure program', '色彩空间': 'Color space', '图片宽度': 'Image width',
  '图片高度': 'Image height', 'X分辨率': 'X resolution', 'Y分辨率': 'Y resolution',
  '北纬/南纬': 'Latitude reference', '纬度': 'Latitude', '东经/西经': 'Longitude reference',
  '经度': 'Longitude', '高度': 'Altitude', '地标': 'Location destination', '制造商备注': 'Maker note',
  '用户备注': 'User comment', 'GPS版本': 'GPS version', '时间戳': 'GPS timestamp'
};

document.addEventListener('DOMContentLoaded', () => {
  initUpload();
  initSectionTabs();
  document.getElementById('copy-report').addEventListener('click', copyPrivacyReport);
});

let currentFile = null;
let currentBuffer = null;
let currentExif = null;
let currentReportText = '';

function initUpload() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (event) => handleFile(event.target.files[0]));
  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragover');
    handleFile(event.dataTransfer.files[0]);
  });
}

function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast(copy.chooseImage);
    return;
  }
  currentFile = file;
  currentReportText = '';
  document.getElementById('privacy-report').hidden = true;
  document.getElementById('strip-result').textContent = '';
  const reader = new FileReader();
  reader.onload = (event) => {
    const img = document.getElementById('preview-img');
    img.src = event.target.result;
    img.onload = () => readFileData(file);
  };
  reader.readAsDataURL(file);
  document.getElementById('result-area').style.display = 'flex';
}

function readFileData(file) {
  const reader = new FileReader();
  reader.onload = (event) => {
    currentBuffer = event.target.result;
    updateBasicInfo(file);
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
  const imgSize = img.naturalWidth && img.naturalHeight ? `${img.naturalWidth} x ${img.naturalHeight}` : '?';
  document.getElementById('file-info').innerHTML = `
    <span>${escapeHtml(file.name)}</span><span>${formatBytes(file.size)}</span>
    <span>${imgSize} px</span><span>${escapeHtml(file.type || copy.unknown)}</span>`;
  document.getElementById('basic-data').innerHTML = `
    ${detailRow(copy.fileName, file.name)}${detailRow(copy.fileSize, formatBytes(file.size))}
    ${detailRow(copy.dimensions, `${img.naturalWidth} x ${img.naturalHeight} px`)}
    ${detailRow(copy.fileType, file.type || copy.unknown)}
    ${detailRow(copy.modified, new Date(file.lastModified).toLocaleString(isZh ? 'zh-CN' : 'en-US'))}`;
}

function detailRow(label, value) {
  return `<div class="exif-item"><span class="exif-tag">${escapeHtml(label)}</span><span class="exif-value">${escapeHtml(value)}</span></div>`;
}

function renderExif(exif, fileType) {
  const container = document.getElementById('exif-data');
  if (fileType && fileType !== 'image/jpeg') {
    container.innerHTML = `<div class="exif-warning">${escapeHtml(fileType)}: ${copy.nonJpeg}</div>`;
    return;
  }
  if (!exif) {
    container.innerHTML = `<div class="exif-warning">${copy.noExif}</div>`;
    return;
  }
  const priority = ['相机厂商','相机型号','拍摄日期','数字化日期','修改时间','软件',
    '曝光时间','光圈值','焦距','ISO','闪光灯','测光模式','曝光补偿','曝光程序',
    '色彩空间','图片宽度','图片高度','X分辨率','Y分辨率',
    '北纬/南纬','纬度','东经/西经','经度','高度','地标'];
  let html = '';
  const shown = new Set();
  for (const key of priority) {
    if (exif[key]) {
      html += detailRow(localizeExifLabel(key), exif[key]);
      shown.add(key);
    }
  }
  for (const [key, value] of Object.entries(exif)) {
    if (!shown.has(key)) html += detailRow(localizeExifLabel(key), value);
  }
  if (hasGps(exif)) html = `<div class="exif-warning">${copy.gpsWarning}</div>${html}`;
  container.innerHTML = html;
}

function localizeExifLabel(key) {
  return isZh ? key : (englishExifLabels[key] || key);
}

function hasGps(exif) {
  return Boolean(exif && (exif['纬度'] || exif['经度']));
}

function initSectionTabs() {
  document.querySelectorAll('.section-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.section-tab').forEach((item) => item.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('exif-section').style.display = tab.dataset.section === 'exif' ? 'block' : 'none';
      document.getElementById('basic-section').style.display = tab.dataset.section === 'basic' ? 'block' : 'none';
    });
  });
}

async function stripExif() {
  const img = document.getElementById('preview-img');
  if (!img.src || !currentFile) {
    showToast(copy.chooseFirst);
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  const blob = await canvasToBlob(canvas, outputMimeType(currentFile), 0.92);
  if (!blob) {
    showToast(copy.exportFailed);
    return;
  }
  const outputBuffer = await blob.arrayBuffer();
  const outputExif = blob.type === 'image/jpeg' ? parseEXIF(outputBuffer) : null;
  const baseName = currentFile.name.replace(/\.[^.]+$/, '');
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = `${baseName}_clean.${mimeExtension(blob.type)}`;
  link.href = objectUrl;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

  const delta = blob.size - currentFile.size;
  const percent = currentFile.size ? Math.abs(delta / currentFile.size * 100).toFixed(1) : '0.0';
  const changeText = delta <= 0 ? `${percent}% ${copy.saved}` : `${percent}% ${copy.larger}`;
  document.getElementById('strip-result').innerHTML = `
    <strong>${copy.cleaned}</strong><br>
    <span style="font-size:.75rem;color:var(--text-dim)">${copy.original} ${formatBytes(currentFile.size)} -> ${formatBytes(blob.size)} (${changeText})</span>`;
  renderPrivacyReport(blob, outputExif);
}

function outputMimeType(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (file.type === 'image/png' || extension === 'png') return 'image/png';
  if (file.type === 'image/webp' || extension === 'webp') return 'image/webp';
  if (file.type === 'image/gif' || extension === 'gif') return 'image/png';
  return 'image/jpeg';
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

function mimeExtension(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

function renderPrivacyReport(blob, outputExif) {
  const sourceInspectable = currentFile.type === 'image/jpeg';
  const sourceCount = sourceInspectable ? Object.keys(currentExif || {}).length : copy.notInspected;
  const gpsValue = sourceInspectable ? (hasGps(currentExif) ? copy.yes : copy.no) : copy.notInspected;
  const outputInspectable = blob.type === 'image/jpeg';
  const outputClean = outputInspectable && !outputExif;
  const outputValue = outputInspectable ? (outputClean ? copy.noReadableExif : copy.fieldsRemain) : copy.notInspected;
  const items = [
    [copy.localProcessing, copy.localValue, 'ok'],
    [copy.sourceFields, String(sourceCount), ''],
    [copy.gpsDetected, gpsValue, gpsValue === copy.yes ? 'warn' : ''],
    [copy.outputCheck, outputValue, outputClean ? 'ok' : ''],
    [copy.outputFormat, blob.type || copy.unknown, ''],
    [copy.outputSize, formatBytes(blob.size), '']
  ];
  document.getElementById('privacy-report-grid').innerHTML = items.map(([label, value, status]) => `
    <div class="report-item"><span class="report-label">${escapeHtml(label)}</span><span class="report-value ${status}">${escapeHtml(value)}</span></div>`).join('');
  document.getElementById('privacy-report-note').textContent = copy.reportNote;
  document.getElementById('privacy-report').hidden = false;
  currentReportText = items.map(([label, value]) => `${label}: ${value}`).join('\n') + `\n\n${copy.reportNote}`;
}

async function copyPrivacyReport() {
  if (!currentReportText) return;
  try {
    await navigator.clipboard.writeText(currentReportText);
    showToast(copy.reportCopied);
  } catch {
    showToast(copy.copyFailed);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value);
  return div.innerHTML;
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity .3s';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}
