const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const check = process.argv.includes('--check');
const source = fs.readFileSync(path.join(root, 'shared/privacy-controls.js'));
for (const app of ['home', 'exif', 'watermark', 'redact', 'resize', 'compress', 'convert']) {
  const target = path.join(root, 'apps', app, 'privacy-controls.js');
  if (check) {
    if (!fs.existsSync(target) || !source.equals(fs.readFileSync(target))) throw new Error(`Out-of-date privacy asset: ${target}`);
  } else fs.writeFileSync(target, source);
}
console.log(check ? 'Privacy assets match source.' : 'Privacy assets synchronized.');
