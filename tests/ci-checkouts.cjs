const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../scripts/ci-checkouts.cjs'), 'utf8');
const sha = 'a'.repeat(40);
for (const caller of ['imageprivacy-tools', 'toolkitbox-home', 'tools-json-toolbox']) {
  for (const ref of ['refs/heads/main', 'refs/pull/123/merge']) {
    const commands = [];
    vm.runInNewContext(source, {
      __dirname: '/workspace/imageprivacy-tools/scripts',
      process: { env: { CALLER_REPOSITORY: `HaozaiGo/${caller}`, CALLER_SHA: sha, CALLER_REF: ref } },
      require(name) {
        if (name === 'node:path') return path;
        if (name === 'node:fs') return { existsSync: () => false, mkdirSync() {} };
        if (name === 'node:child_process') return { execFileSync(command, args, options) {
          assert.equal(command, 'git'); commands.push({ args: Array.from(args), cwd: options.cwd });
        } };
        throw Error(name);
      }
    });
    const checkouts = commands.filter(command => command.args[0] === 'checkout');
    assert.equal(checkouts.length, 9);
    const callerPath = caller.replace(/^tools-/, '');
    for (const command of checkouts) {
      assert.deepEqual(command.args, ['checkout', '--detach', command.cwd.endsWith('/' + callerPath) ? sha : 'FETCH_HEAD']);
    }
    const callerFetch = commands.filter(command => command.args[0] === 'fetch' && command.args.includes(sha));
    assert.equal(callerFetch.length, caller === 'imageprivacy-tools' ? 0 : 1);
  }
}
console.log('PASS: reusable CI checks exact caller commits, including PR merge revisions');
