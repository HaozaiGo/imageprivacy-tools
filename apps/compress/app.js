(function () {
  "use strict";

  const isZh = document.documentElement.lang.toLowerCase().startsWith("zh");
  const copy = isZh ? {
    loading: "正在读取图片...",
    decodingHeic: "正在本地解码 HEIC...",
    ready: "等待压缩",
    processing: "正在压缩...",
    complete: "压缩完成",
    failed: "处理失败",
    unsupported: "不支持这个文件格式。",
    tooLarge: "单张图片不能超过 30 MB。",
    tooMany: "一次最多处理 20 张图片。",
    decoderMissing: "HEIC 解码器加载失败，请检查网络后重试。",
    decodeFailed: "浏览器无法解码这张图片。",
    encoderMissing: "压缩组件加载失败，请刷新页面后重试。",
    avifLoading: "正在加载本地 AVIF 编码器...",
    targetClosest: "已采用最接近目标大小的结果",
    original: "原图",
    compressed: "压缩后",
    output: "输出",
    smaller: "减小",
    larger: "增大",
    download: "下载",
    remove: "移除",
    filesReady: "张图片等待处理",
    totalSaved: "总体积减少",
    totalIncreased: "总体积增加",
    zipPreparing: "正在创建 ZIP...",
    zipReady: "ZIP 已准备完成",
    noOutput: "请先完成至少一张图片的压缩。",
    transparentJpeg: "透明区域将使用所选 JPEG 背景色。"
  } : {
    loading: "Reading image...",
    decodingHeic: "Decoding HEIC locally...",
    ready: "Ready to compress",
    processing: "Compressing...",
    complete: "Compression complete",
    failed: "Processing failed",
    unsupported: "This file format is not supported.",
    tooLarge: "Each image must be 30 MB or smaller.",
    tooMany: "You can process up to 20 images at a time.",
    decoderMissing: "The HEIC decoder failed to load. Check your connection and try again.",
    decodeFailed: "The browser could not decode this image.",
    encoderMissing: "A compression component failed to load. Refresh the page and try again.",
    avifLoading: "Loading the local AVIF encoder...",
    targetClosest: "Closest result to the target size",
    original: "Original",
    compressed: "Compressed",
    output: "Output",
    smaller: "smaller",
    larger: "larger",
    download: "Download",
    remove: "Remove",
    filesReady: "images ready",
    totalSaved: "Total size reduced",
    totalIncreased: "Total size increased",
    zipPreparing: "Creating ZIP...",
    zipReady: "ZIP is ready",
    noOutput: "Compress at least one image first.",
    transparentJpeg: "Transparent areas use the selected JPEG background."
  };

  const MAX_FILES = 20;
  const MAX_BYTES = 30 * 1024 * 1024;
  const ACCEPTED = /\.(jpe?g|png|webp|avif|heic|heif)$/i;
  const AVIF_MODULE = "https://cdn.jsdelivr.net/npm/@jsquash/avif@2.1.1/encode.js/+esm";
  const state = { items: [], busy: false, nextId: 1, avifEncoder: null };

  const elements = {
    file: document.getElementById("file"),
    dropzone: document.getElementById("dropzone"),
    workspace: document.getElementById("workspace"),
    format: document.getElementById("format"),
    quality: document.getElementById("quality"),
    qualityOutput: document.getElementById("q"),
    maxWidth: document.getElementById("maxw"),
    target: document.getElementById("target"),
    background: document.getElementById("background"),
    backgroundField: document.getElementById("background-field"),
    compressAll: document.getElementById("compress-all"),
    downloadZip: document.getElementById("download-zip"),
    clearAll: document.getElementById("clear-all"),
    queue: document.getElementById("queue"),
    notice: document.getElementById("notice"),
    summary: document.getElementById("summary")
  };

  function isHeic(file) {
    return /\.hei[cf]$/i.test(file.name) || /^image\/hei[cf]$/i.test(file.type);
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function baseName(name) {
    return name.replace(/\.[^.]+$/, "") || "image";
  }

  function outputExtension(type) {
    return { "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png", "image/avif": "avif" }[type];
  }

  function setNotice(message) {
    elements.notice.textContent = message || "";
  }

  function setBusy(value) {
    state.busy = value;
    elements.compressAll.disabled = value || !state.items.some(item => item.status !== "loading");
    elements.clearAll.disabled = value;
    elements.file.disabled = value;
    elements.downloadZip.disabled = value;
  }

  async function prepareSource(file) {
    if (!isHeic(file)) return file;
    if (!window.heic2any) throw new Error(copy.decoderMissing);
    const decoded = await window.heic2any({ blob: file, toType: "image/png", quality: 1 });
    return Array.isArray(decoded) ? decoded[0] : decoded;
  }

  async function getDimensions(blob) {
    if ("createImageBitmap" in window) {
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    }
    const url = URL.createObjectURL(blob);
    try {
      const image = await loadImage(url);
      return { width: image.naturalWidth, height: image.naturalHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(copy.decodeFailed));
      image.src = url;
    });
  }

  async function addFiles(fileList) {
    setNotice("");
    const available = MAX_FILES - state.items.length;
    const incoming = Array.from(fileList);
    if (incoming.length > available) setNotice(copy.tooMany);

    for (const file of incoming.slice(0, available)) {
      const item = {
        id: state.nextId++,
        file,
        sourceBlob: null,
        sourceUrl: "",
        outputBlob: null,
        outputUrl: "",
        outputName: "",
        width: 0,
        height: 0,
        outputWidth: 0,
        outputHeight: 0,
        status: "loading",
        statusText: isHeic(file) ? copy.decodingHeic : copy.loading,
        error: "",
        targetUsed: false
      };
      state.items.push(item);
      render();

      if (!ACCEPTED.test(file.name) && !/^image\/(jpeg|png|webp|avif|heic|heif)$/i.test(file.type)) {
        item.status = "error";
        item.error = copy.unsupported;
        render();
        continue;
      }
      if (file.size > MAX_BYTES) {
        item.status = "error";
        item.error = copy.tooLarge;
        render();
        continue;
      }

      try {
        item.sourceBlob = await prepareSource(file);
        const dimensions = await getDimensions(item.sourceBlob);
        item.width = dimensions.width;
        item.height = dimensions.height;
        item.sourceUrl = URL.createObjectURL(item.sourceBlob);
        item.status = "ready";
        item.statusText = copy.ready;
      } catch (error) {
        item.status = "error";
        item.error = error.message || copy.decodeFailed;
      }
      render();
    }
    elements.file.value = "";
  }

  async function decodeSource(blob) {
    if ("createImageBitmap" in window) {
      return createImageBitmap(blob, { imageOrientation: "from-image" });
    }
    const url = URL.createObjectURL(blob);
    try {
      return await loadImage(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function buildCanvas(item, maxWidth) {
    const source = await decodeSource(item.sourceBlob);
    const sourceWidth = source.width || source.naturalWidth;
    const sourceHeight = source.height || source.naturalHeight;
    const scale = Math.min(1, maxWidth / sourceWidth);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    try {
      if (scale < 1 && window.pica) {
        try {
          await window.pica().resize(source, canvas, { quality: 3, alpha: true });
        } catch (_) {
          canvas.getContext("2d").drawImage(source, 0, 0, width, height);
        }
      } else {
        canvas.getContext("2d").drawImage(source, 0, 0, width, height);
      }
    } finally {
      if (typeof source.close === "function") source.close();
    }
    return canvas;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(copy.failed)), type, quality / 100);
    });
  }

  function jpegCanvas(canvas) {
    const output = document.createElement("canvas");
    output.width = canvas.width;
    output.height = canvas.height;
    const context = output.getContext("2d");
    context.fillStyle = elements.background.value;
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(canvas, 0, 0);
    return output;
  }

  async function encodePng(canvas, quality) {
    if (!window.UPNG || !window.pako) throw new Error(copy.encoderMissing);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const colors = quality >= 94 ? 0 : Math.max(16, Math.min(256, Math.round(16 + ((quality - 30) / 64) * 240)));
    const buffer = window.UPNG.encode([imageData.data.buffer], canvas.width, canvas.height, colors);
    return new Blob([buffer], { type: "image/png" });
  }

  async function getAvifEncoder() {
    if (!state.avifEncoder) {
      setNotice(copy.avifLoading);
      state.avifEncoder = import(AVIF_MODULE).then(module => module.default).catch(error => {
        state.avifEncoder = null;
        throw error;
      });
    }
    return state.avifEncoder;
  }

  async function encodeAvif(canvas, quality) {
    const encode = await getAvifEncoder();
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const buffer = await encode(imageData, { quality, qualityAlpha: quality, speed: 7 });
    return new Blob([buffer], { type: "image/avif" });
  }

  async function encodeCanvas(canvas, type, quality) {
    if (type === "image/png") return encodePng(canvas, quality);
    if (type === "image/avif") return encodeAvif(canvas, quality);
    if (type === "image/jpeg") return canvasToBlob(jpegCanvas(canvas), type, quality);
    return canvasToBlob(canvas, type, quality);
  }

  async function encodeForTarget(canvas, type, selectedQuality, targetBytes) {
    let quality = selectedQuality;
    let blob = await encodeCanvas(canvas, type, quality);
    if (!targetBytes || blob.size <= targetBytes) return { blob, quality, targetUsed: false };

    let low = 15;
    let high = Math.max(15, selectedQuality - 1);
    let closest = { blob, quality, distance: Math.abs(blob.size - targetBytes) };
    for (let attempt = 0; attempt < 5 && low <= high; attempt++) {
      quality = Math.round((low + high) / 2);
      const candidate = await encodeCanvas(canvas, type, quality);
      const distance = Math.abs(candidate.size - targetBytes);
      if (distance < closest.distance) closest = { blob: candidate, quality, distance };
      if (candidate.size > targetBytes) high = quality - 1;
      else low = quality + 1;
    }
    return { blob: closest.blob, quality: closest.quality, targetUsed: true };
  }

  async function processItem(item, settings) {
    item.status = "processing";
    item.statusText = copy.processing;
    item.error = "";
    if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
    item.outputUrl = "";
    item.outputBlob = null;
    render();

    try {
      const canvas = await buildCanvas(item, settings.maxWidth);
      const encoded = await encodeForTarget(canvas, settings.type, settings.quality, settings.targetBytes);
      item.outputBlob = encoded.blob;
      item.outputUrl = URL.createObjectURL(encoded.blob);
      item.outputName = `${baseName(item.file.name)}-compressed.${outputExtension(settings.type)}`;
      item.outputWidth = canvas.width;
      item.outputHeight = canvas.height;
      item.outputQuality = encoded.quality;
      item.targetUsed = encoded.targetUsed;
      item.status = "complete";
      item.statusText = encoded.targetUsed ? `${copy.complete} · ${copy.targetClosest}` : copy.complete;
    } catch (error) {
      item.status = "error";
      item.error = error.message || copy.failed;
    }
    render();
  }

  function currentSettings() {
    const width = Math.max(1, Math.min(16000, Number(elements.maxWidth.value) || 1920));
    const targetKb = Math.max(0, Math.min(50000, Number(elements.target.value) || 0));
    elements.maxWidth.value = width;
    if (targetKb) elements.target.value = targetKb;
    return {
      type: elements.format.value,
      quality: Number(elements.quality.value),
      maxWidth: width,
      targetBytes: targetKb ? targetKb * 1024 : 0
    };
  }

  async function compressAll() {
    if (state.busy) return;
    const processable = state.items.filter(item => item.sourceBlob);
    if (!processable.length) {
      setNotice(copy.noOutput);
      return;
    }
    setNotice("");
    setBusy(true);
    const settings = currentSettings();
    for (const item of processable) {
      await processItem(item, settings);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    if (settings.type === "image/jpeg" && processable.some(item => /png|webp|avif|hei[cf]/i.test(item.file.type + item.file.name))) {
      setNotice(copy.transparentJpeg);
    } else if (elements.notice.textContent === copy.avifLoading) {
      setNotice("");
    }
    setBusy(false);
    render();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function downloadZip() {
    const completed = state.items.filter(item => item.outputBlob);
    if (!completed.length) {
      setNotice(copy.noOutput);
      return;
    }
    if (!window.JSZip) {
      setNotice(copy.encoderMissing);
      return;
    }
    setBusy(true);
    setNotice(copy.zipPreparing);
    try {
      const zip = new window.JSZip();
      const names = new Set();
      for (const item of completed) {
        let name = item.outputName;
        let suffix = 2;
        while (names.has(name)) {
          const extension = outputExtension(item.outputBlob.type);
          name = `${baseName(item.file.name)}-compressed-${suffix++}.${extension}`;
        }
        names.add(name);
        zip.file(name, item.outputBlob);
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
      downloadBlob(blob, "imageprivacy-compressed-images.zip");
      setNotice(copy.zipReady);
    } catch (_) {
      setNotice(copy.failed);
    } finally {
      setBusy(false);
    }
  }

  function removeItem(id) {
    if (state.busy) return;
    const index = state.items.findIndex(item => item.id === id);
    if (index < 0) return;
    const [item] = state.items.splice(index, 1);
    if (item.sourceUrl) URL.revokeObjectURL(item.sourceUrl);
    if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
    render();
  }

  function clearAll() {
    if (state.busy) return;
    for (const item of state.items) {
      if (item.sourceUrl) URL.revokeObjectURL(item.sourceUrl);
      if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
    }
    state.items = [];
    setNotice("");
    render();
  }

  function resultText(item) {
    if (!item.outputBlob) return "";
    const difference = 1 - item.outputBlob.size / item.file.size;
    const direction = difference >= 0 ? copy.smaller : copy.larger;
    return `${copy.output}: ${formatBytes(item.outputBlob.size)} · ${Math.abs(difference * 100).toFixed(1)}% ${direction} · ${item.outputWidth} x ${item.outputHeight}`;
  }

  function createItemElement(item) {
    const article = document.createElement("article");
    article.className = "item";
    article.dataset.id = item.id;
    article.innerHTML = `
      <div class="item-head"><strong class="item-name"></strong><button class="remove" type="button" data-action="remove" title="${copy.remove}" aria-label="${copy.remove}">&times;</button></div>
      <div class="compare"><img class="compare-before" alt=""><img class="compare-after" alt=""><span class="compare-label before">${copy.original}</span><span class="compare-label after">${copy.compressed}</span><input class="compare-control" type="range" min="0" max="100" value="50" aria-label="${copy.original} / ${copy.compressed}"></div>
      <div class="item-body"><p class="item-meta"></p><p class="item-result"></p><p class="item-status"></p><div class="item-actions"><button class="item-button" type="button" data-action="download" disabled>${copy.download}</button></div></div>`;
    article.querySelector(".item-name").textContent = item.file.name;
    const compare = article.querySelector(".compare");
    if (item.width && item.height) compare.style.aspectRatio = `${item.width} / ${item.height}`;
    const before = article.querySelector(".compare-before");
    const after = article.querySelector(".compare-after");
    if (item.sourceUrl) before.src = item.sourceUrl;
    if (item.outputUrl) {
      after.src = item.outputUrl;
      compare.classList.add("has-output");
    }
    article.querySelector(".item-meta").textContent = item.width ? `${item.width} x ${item.height} · ${formatBytes(item.file.size)}` : formatBytes(item.file.size);
    article.querySelector(".item-result").textContent = resultText(item);
    const status = article.querySelector(".item-status");
    status.textContent = item.error || item.statusText;
    if (item.status === "error") status.classList.add("error");
    article.querySelector('[data-action="download"]').disabled = !item.outputBlob || state.busy;
    article.querySelector('[data-action="remove"]').disabled = state.busy;
    return article;
  }

  function renderSummary() {
    const completed = state.items.filter(item => item.outputBlob);
    if (!completed.length) {
      elements.summary.textContent = state.items.length ? `${state.items.length} ${copy.filesReady}` : "";
      elements.downloadZip.hidden = true;
      return;
    }
    const original = completed.reduce((sum, item) => sum + item.file.size, 0);
    const output = completed.reduce((sum, item) => sum + item.outputBlob.size, 0);
    const difference = (1 - output / original) * 100;
    const summaryLabel = difference >= 0 ? copy.totalSaved : copy.totalIncreased;
    elements.summary.textContent = `${summaryLabel}: ${formatBytes(original)} -> ${formatBytes(output)} (${Math.abs(difference).toFixed(1)}%)`;
    elements.downloadZip.hidden = completed.length < 2;
    elements.downloadZip.textContent = isZh ? `下载 ZIP（${completed.length}）` : `Download ZIP (${completed.length})`;
  }

  function render() {
    elements.workspace.hidden = state.items.length === 0;
    elements.queue.replaceChildren(...state.items.map(createItemElement));
    renderSummary();
    elements.compressAll.disabled = state.busy || !state.items.some(item => item.sourceBlob);
    elements.backgroundField.hidden = elements.format.value !== "image/jpeg";
  }

  elements.file.addEventListener("change", event => addFiles(event.target.files));
  elements.dropzone.addEventListener("dragover", event => {
    event.preventDefault();
    elements.dropzone.classList.add("is-dragging");
  });
  elements.dropzone.addEventListener("dragleave", () => elements.dropzone.classList.remove("is-dragging"));
  elements.dropzone.addEventListener("drop", event => {
    event.preventDefault();
    elements.dropzone.classList.remove("is-dragging");
    if (!state.busy) addFiles(event.dataTransfer.files);
  });
  elements.quality.addEventListener("input", () => {
    elements.qualityOutput.value = `${elements.quality.value}%`;
  });
  elements.format.addEventListener("change", render);
  elements.compressAll.addEventListener("click", compressAll);
  elements.downloadZip.addEventListener("click", downloadZip);
  elements.clearAll.addEventListener("click", clearAll);
  elements.queue.addEventListener("input", event => {
    if (!event.target.classList.contains("compare-control")) return;
    event.target.closest(".compare").querySelector(".compare-after").style.clipPath = `inset(0 ${100 - event.target.value}% 0 0)`;
  });
  elements.queue.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const item = state.items.find(candidate => candidate.id === Number(button.closest(".item").dataset.id));
    if (!item) return;
    if (button.dataset.action === "remove") removeItem(item.id);
    if (button.dataset.action === "download" && item.outputBlob) downloadBlob(item.outputBlob, item.outputName);
  });
  window.addEventListener("beforeunload", () => {
    for (const item of state.items) {
      if (item.sourceUrl) URL.revokeObjectURL(item.sourceUrl);
      if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
    }
  });

  render();
}());
