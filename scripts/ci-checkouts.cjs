const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const repos = {
  'toolkitbox-home': 'toolkitbox-home', 'json-toolbox': 'tools-json-toolbox',
  'base64-tool': 'tools-base64-tool', 'uuid-generator': 'tools-uuid-generator',
  'color-tool': 'tools-color-tool', 'regex-tester': 'tools-regex-tester',
  'diff-checker': 'tools-diff-checker', 'url-checker': 'tools-url-checker', 'ssl-checker': 'tools-ssl-checker'
};
const caller = process.env.CALLER_REPOSITORY;
if (!['HaozaiGo/imageprivacy-tools', ...Object.values(repos).map(repo => `HaozaiGo/${repo}`)].includes(caller)) throw Error('Unknown workflow caller');
for (const [directory, repository] of Object.entries(repos)) {
  const target = path.join(root, directory);
  if (fs.existsSync(target)) throw Error(`Refusing to replace existing checkout: ${target}`);
  const git = args => execFileSync('git', args, { cwd: target, stdio: 'inherit', timeout: 120000 });
  fs.mkdirSync(target);
  git(['init', '--quiet']);
  git(['remote', 'add', 'origin', `https://github.com/HaozaiGo/${repository}.git`]);
  const isCaller = caller === `HaozaiGo/${repository}`;
  const sha = process.env.CALLER_SHA;
  const ref = isCaller ? process.env.CALLER_REF : 'refs/heads/main';
  if (!/^refs\/(heads|pull)\/[\w/.-]+$/.test(ref) || (isCaller && !/^[a-f0-9]{40}$/.test(sha))) throw Error('Invalid workflow revision');
  git(['fetch', '--depth=1', 'origin', ref]);
  // Never test main in place of the caller's PR merge commit or pushed commit.
  if (isCaller) git(['fetch', '--depth=1', 'origin', sha]);
  git(['checkout', '--detach', isCaller ? sha : 'FETCH_HEAD']);
}
