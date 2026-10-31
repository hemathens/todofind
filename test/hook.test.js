import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAddedLines, getStagedResults } from '../src/staged.js';
import { installHook, removeHook, MARKER } from '../src/hook.js';
import { isGitRepo } from '../src/git.js';

const BIN = fileURLToPath(new URL('../bin/todofind.js', import.meta.url));

function git(cwd, args, env = {}) {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'dev@example.com',
      GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'dev@example.com',
      ...env,
    },
  });
}

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'todofind-hook-'));
  git(dir, ['init', '-q']);
  return dir;
}

test('parseAddedLines returns added lines with new line numbers', () => {
  const diff = [
    'diff --git a/a.js b/a.js',
    '--- a/a.js',
    '+++ b/a.js',
    '@@ -1,0 +2,2 @@',
    '+// FIXME: one',
    '+++ not a header, just added text',
    '@@ -9 +11 @@',
    '-old',
    '+// BUG: two',
  ].join('\n');
  assert.deepEqual(parseAddedLines(diff), [
    { line: 2, text: '// FIXME: one' },
    { line: 3, text: '++ not a header, just added text' },
    { line: 11, text: '// BUG: two' },
  ]);
});

test('staged scan reports only newly added lines that are staged', async () => {
  const dir = repo();
  writeFileSync(path.join(dir, 'a.js'), '// FIXME: already there\nconst x = 1;\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'base']);

  writeFileSync(path.join(dir, 'a.js'), '// FIXME: already there\nconst x = 1;\n// FIXME: brand new\n');
  writeFileSync(path.join(dir, 'b.js'), '// BUG: new file\n');
  git(dir, ['add', 'a.js', 'b.js']);
  writeFileSync(path.join(dir, 'c.js'), '// FIXME: never staged\n');

  const { results } = await getStagedResults(dir, { tags: ['FIXME', 'BUG'] });
  assert.deepEqual(
    results.map((r) => `${r.file}:${r.line}:${r.tag}`).sort(),
    ['a.js:3:FIXME', 'b.js:1:BUG']
  );
});

test('install, update, refuse to overwrite foreign hooks, force, remove', async () => {
  const dir = repo();
  const hook = path.join(dir, '.git', 'hooks', 'pre-commit');

  const first = await installHook(dir, { tags: ['FIXME'], version: '9.9.9' });
  assert.equal(first.updated, false);
  const text = readFileSync(hook, 'utf8');
  assert.ok(text.includes(MARKER) && text.includes('--tags FIXME') && text.includes('todofind@9.9.9'));
  assert.ok(!text.includes('\r'), 'hook must use LF line endings');

  assert.equal((await installHook(dir, { tags: ['BUG'], version: '9.9.9' })).updated, true);
  assert.ok(readFileSync(hook, 'utf8').includes('--tags BUG'));

  writeFileSync(hook, '#!/bin/sh\necho mine\n');
  await assert.rejects(installHook(dir, { tags: ['BUG'], version: '1.0.0' }), /not created by todofind/);

  const forced = await installHook(dir, { tags: ['BUG'], version: '1.0.0', force: true });
  assert.equal(forced.backedUp, true);
  assert.equal(readFileSync(`${hook}.backup`, 'utf8'), '#!/bin/sh\necho mine\n');

  const removed = await removeHook(dir);
  assert.equal(removed.restored, true);
  assert.equal(readFileSync(hook, 'utf8'), '#!/bin/sh\necho mine\n');
  await assert.rejects(removeHook(dir), /left alone/);
});

test('installing outside a git repo gives a clear error', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'todofind-nogit-'));
  // Some machines have a stray repo above the temp folder (e.g. in the home directory).
  // Never install a hook into somebody's real repo: skip instead.
  if (await isGitRepo(dir)) return t.skip('temp folder is inside a git repository');
  await assert.rejects(installHook(dir, {}), /not a git repository/);
});

// Real `git commit` calls through the installed hook (needs sh, so skipped on Windows).
test('hook blocks a commit that adds FIXME, allows TODO, honours --no-verify', { skip: process.platform === 'win32' }, async () => {
  const dir = repo();
  const shim = mkdtempSync(path.join(tmpdir(), 'todofind-shim-'));
  writeFileSync(path.join(shim, 'todofind'), `#!/bin/sh\nexec node "${BIN}" "$@"\n`);
  chmodSync(path.join(shim, 'todofind'), 0o755);
  const env = { PATH: `${shim}${path.delimiter}${process.env.PATH}` };

  await installHook(dir, { tags: ['FIXME', 'XXX', 'BUG'], version: '1.0.0' });

  writeFileSync(path.join(dir, 'a.js'), '// TODO: fine to commit\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'ok'], env); // must not throw

  writeFileSync(path.join(dir, 'a.js'), '// TODO: fine to commit\n// FIXME: not fine\n');
  git(dir, ['add', '.']);
  assert.throws(() => git(dir, ['commit', '-q', '-m', 'blocked'], env), (e) => {
    assert.match(String(e.stderr), /commit blocked/);
    return true;
  });

  git(dir, ['commit', '-q', '--no-verify', '-m', 'forced'], env); // bypass works
  assert.ok(existsSync(path.join(dir, '.git', 'hooks', 'pre-commit')));
});