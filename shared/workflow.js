(function () {
  'use strict';
  const names = ['redact', 'resize', 'compress'];
  const local = ['127.0.0.1', 'localhost'].includes(location.hostname);
  const current = local ? location.pathname.split('/')[1] : names.find(name => location.origin === `https://${name}.imageprivacy.org`);
  if (!names.includes(current)) return;
  const zh = document.documentElement.lang.startsWith('zh');
  const labels = zh ? { redact: '打码', resize: '裁剪与尺寸', compress: '压缩' } : { redact: 'Redact', resize: 'Crop & resize', compress: 'Compress' };
  const copy = zh ? {
    next: '继续处理', file: '处理结果', action: '打开下一工具', working: '正在传递处理结果...',
    sent: '已在下一工具中打开处理结果。', received: '已接收处理后的图片。', receiving: '正在接收图片...',
    failed: '未能传递图片。请保留当前页面，下载结果后在下一工具中打开。',
    popup: '浏览器阻止了新标签页。请允许弹出窗口，或下载结果后手动打开。',
    limit: '传递结果须为 30 MB 以内的 PNG、JPEG 或 WebP。请下载后手动打开。',
    cancelled: '已取消接收，使用你新选择的图片。'
  } : {
    next: 'Continue editing', file: 'Result', action: 'Open next tool', working: 'Sending the edited result...',
    sent: 'The edited result is open in the next tool.', received: 'Edited image received.', receiving: 'Receiving image...',
    failed: 'Could not transfer the image. Keep this tab open, download the result, and open it in the next tool.',
    popup: 'The browser blocked the new tab. Allow pop-ups, or download and open the result manually.',
    limit: 'Transfer requires a PNG, JPEG, or WebP result up to 30 MB. Download and open it manually.',
    cancelled: 'Transfer cancelled; using your newly selected image.'
  };
  const base = name => new URL(local ? `/${name}/` : `https://${name}.imageprivacy.org/`, location.origin);
  const validFile = file => file instanceof File && file.size > 0 && file.size <= 30 * 1024 * 1024 && ['image/png', 'image/jpeg', 'image/webp'].includes(file.type);
  const notice = document.createElement('p');
  notice.className = 'ip-transfer-status';
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  const main = document.querySelector('main');
  main.prepend(notice);
  const notify = message => { notice.textContent = message; notice.hidden = !message; };

  let sending = false;
  function send(destination, exportImage) {
    if (sending || !names.includes(destination) || destination === current) return;
    const token = crypto.randomUUID();
    const url = base(destination);
    if (zh) url.pathname += 'zh/';
    url.hash = new URLSearchParams({ 'ip-transfer': token, from: current }).toString();
    // Open during the user gesture; no image bytes or filenames enter the URL.
    const child = window.open(url.href, '_blank');
    if (!child) { notify(copy.popup); return; }
    sending = true;
    notify(copy.working);
    let done = false, delivered = false, receiverReady = false, abortPending = false, exported = null;
    let timer, closedTimer;
    function dispose() {
      clearTimeout(timer);
      clearInterval(closedTimer);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('pagehide', onLeave);
    }
    function abortReceiver() {
      try { child.postMessage({ type: 'imageprivacy:abort', token }, url.origin); } catch (_) {}
    }
    function finish(message, success = false) {
      if (done) return;
      done = true;
      exported = null;
      sending = false;
      abortPending = !success;
      if (abortPending && receiverReady) abortReceiver();
      // An export can fail before the child loads. Keep only its authenticated
      // ready handshake alive until it can receive the terminal abort message.
      if (success || receiverReady || child.closed) dispose();
      notify(message);
    }
    function onLeave() { finish(''); dispose(); }
    async function onMessage(event) {
      const data = event.data;
      if (event.source !== child || event.origin !== url.origin || !data || data.token !== token) return;
      if (done) {
        if (abortPending && ['imageprivacy:ready', 'imageprivacy:ping'].includes(data.type)) { abortReceiver(); dispose(); }
        return;
      }
      if (data.type === 'imageprivacy:ping') {
        child.postMessage({ type: 'imageprivacy:pong', token }, url.origin);
        return;
      }
      if (data.type === 'imageprivacy:ready' && !delivered) {
        receiverReady = true;
        delivered = true;
        const result = await exported;
        if (done || !result) return;
        child.postMessage({ type: 'imageprivacy:file', token, file: result }, url.origin);
      } else if (data.type === 'imageprivacy:accepted' && delivered) {
        finish(copy.sent, true);
      } else if (data.type === 'imageprivacy:failed') {
        finish(copy.failed);
      }
    }
    window.addEventListener('message', onMessage);
    window.addEventListener('pagehide', onLeave, { once: true });
    timer = setTimeout(() => { finish(copy.failed); dispose(); }, 45000);
    closedTimer = setInterval(() => { if (child.closed) { finish(copy.failed); dispose(); } }, 1000);
    try {
      // Capture current edits now, not after the destination finishes loading.
      exported = Promise.resolve(exportImage()).then(file => {
        if (!validFile(file)) { finish(copy.limit); return null; }
        return file;
      }, () => { finish(copy.failed); return null; });
    } catch (_) { finish(copy.failed); }
  }

  function receive(load) {
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.has('ip-transfer')) return;
    const token = params.get('ip-transfer'), from = params.get('from');
    history.replaceState(null, '', location.pathname + location.search);
    const opener = window.opener;
    if (!opener || !names.includes(from) || from === current || !/^[a-f0-9-]{36}$/.test(token || '')) {
      notify(copy.failed);
      return;
    }
    const origin = base(from).origin;
    let done = false, accepted = false;
    const controller = new AbortController();
    let lastPong = Date.now();
    const post = type => { try { opener.postMessage({ type, token }, origin); } catch (_) {} };
    const ready = () => {
      // pagehide messages can be dropped during navigation. An authenticated
      // lease also catches an opener that navigates away without closing.
      if (opener.closed || Date.now() - lastPong > 8000) { finish(false, copy.failed); return; }
      post('imageprivacy:ping');
      if (!accepted && !done) post('imageprivacy:ready');
    };
    const timer = setTimeout(() => finish(false, copy.failed), 45000);
    const interval = setInterval(ready, 400);
    function finish(success, message) {
      if (done) return;
      done = true;
      if (!success) controller.abort();
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('pagehide', onLeave);
      document.removeEventListener('change', onUserFile, true);
      document.removeEventListener('drop', onUserFile, true);
      post(success ? 'imageprivacy:accepted' : 'imageprivacy:failed');
      window.opener = null;
      notify(message);
    }
    function onLeave() { finish(false, ''); }
    function onUserFile(event) {
      if (event.target.matches?.('input[type="file"]') || event.dataTransfer?.files.length) finish(false, copy.cancelled);
    }
    async function onMessage(event) {
      const data = event.data;
      if (done || event.source !== opener || event.origin !== origin || !data || data.token !== token) return;
      if (data.type === 'imageprivacy:pong') { lastPong = Date.now(); return; }
      if (data.type === 'imageprivacy:abort') { finish(false, copy.failed); return; }
      if (accepted || data.type !== 'imageprivacy:file') return;
      if (!validFile(data.file)) { finish(false, copy.limit); return; }
      accepted = true;
      try {
        const loaded = await load(data.file, { signal: controller.signal });
        finish(loaded === true, loaded === true ? copy.received : copy.failed);
      } catch (_) { finish(false, copy.failed); }
    }
    notify(copy.receiving);
    window.addEventListener('message', onMessage);
    window.addEventListener('pagehide', onLeave, { once: true });
    document.addEventListener('change', onUserFile, true);
    document.addEventListener('drop', onUserFile, true);
    ready();
  }

  function mount(editor) {
    receive(editor.load);
    const bar = document.createElement('div');
    bar.className = 'ip-workflow';
    bar.hidden = true;
    const resultLabel = document.createElement('label');
    resultLabel.textContent = copy.file;
    const result = document.createElement('select');
    result.id = 'ip-result';
    resultLabel.append(result);
    const label = document.createElement('label');
    label.textContent = copy.next;
    const select = document.createElement('select');
    select.id = 'ip-next-tool';
    for (const name of names.filter(name => name !== current)) select.add(new Option(labels[name], name));
    select.value = current === 'redact' ? 'resize' : 'compress';
    if (!select.value) select.selectedIndex = 0;
    label.append(select);
    const button = document.createElement('button');
    button.id = 'ip-continue';
    button.type = 'button';
    button.textContent = copy.action;
    bar.append(resultLabel, label, button);
    const parent = document.getElementById('workspace') || document.getElementById('editor');
    parent.after(bar);
    function refresh() {
      if (editor.outputs) {
        const selected = result.value;
        result.replaceChildren();
        for (const item of editor.outputs()) result.add(new Option(item.name, String(item.id)));
        if ([...result.options].some(option => option.value === selected)) result.value = selected;
        bar.hidden = result.options.length === 0;
        resultLabel.hidden = false;
        button.disabled = document.getElementById('compress-all').disabled;
      } else {
        const download = document.getElementById('download');
        bar.hidden = getComputedStyle(parent).display === 'none';
        button.disabled = download.disabled;
        resultLabel.hidden = true;
      }
    }
    button.addEventListener('click', () => {
      if (button.disabled) return;
      send(select.value, () => editor.outputs ? editor.outputs().find(item => String(item.id) === result.value)?.file : editor.exportImage());
    });
    document.addEventListener('imageprivacy:change', refresh);
    const observer = new MutationObserver(refresh);
    observer.observe(parent, { attributes: true, subtree: true, attributeFilter: ['disabled', 'hidden', 'style'] });
    refresh();
  }
  window.ImagePrivacyWorkflow = { mount };
}());
