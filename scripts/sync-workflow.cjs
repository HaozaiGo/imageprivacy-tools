const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const check = process.argv.includes('--check');
for (const file of ['workflow.js', 'workflow.css', 'workflow-adapter.js']) {
  const source = fs.readFileSync(path.join(root, 'shared', file));
  for (const app of ['redact', 'resize', 'compress']) {
    const target = path.join(root, 'apps', app, file);
    if (check) {
      if (!fs.existsSync(target) || !source.equals(fs.readFileSync(target))) throw new Error(`Out-of-date workflow asset: ${target}`);
    } else fs.writeFileSync(target, source);
  }
}
console.log(check ? 'Workflow assets match source.' : 'Workflow assets synchronized.');
