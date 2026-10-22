const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const apps = ['home', 'redact', 'resize', 'compress', 'convert', 'exif', 'watermark'];
const root = path.resolve(__dirname, '../apps');

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const first = pathname.split('/')[1];
      const app = apps.includes(first) ? first : 'home';
      const prefix = apps.includes(first) ? `/${app}` : '';
      const relative = pathname.slice(prefix.length) || '/';
      const appRoot = path.join(root, app);
      let file = path.resolve(appRoot, '.' + relative);
      if (!file.startsWith(appRoot + path.sep) && file !== appRoot) { res.writeHead(403).end(); return; }
      if ((await fs.stat(file)).isDirectory()) {
        if (!pathname.endsWith('/')) { res.writeHead(302, { Location: pathname + '/' }).end(); return; }
        file = path.join(file, 'index.html');
      }
      let body = await fs.readFile(file);
      const ext = path.extname(file);
      if (ext === '.html') {
        // Mirror independent app roots under local paths without changing production URLs.
        body = body.toString().replace(/(href|src)="\/(?!\/)([^"]*)"/g, (_, attr, value) => `${attr}="${prefix}/${value}"`)
          .replace(/href="https:\/\/(?:www\.)?(?:(redact|resize|compress|convert|exif|watermark)\.)?imageprivacy\.org\/([^"]*)"/g,
            (_, tool, value) => `href="${tool ? '/' + tool : ''}/${value}"`);
      }
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain', '.xml': 'application/xml' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
    } catch (_) { res.writeHead(404).end('Not found'); }
  });
}
module.exports = { createServer };
if (require.main === module) {
  const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 4174;
  const server = createServer();
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`ImagePrivacy: http://127.0.0.1:${server.address().port}/`));
}
