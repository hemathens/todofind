import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scan } from '../src/scanner.js';

const write = (dir, rel, text) => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), text);
};

function project({ git }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'todofind-ign-'));
  if (git) execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe' });
  write(dir, '.gitignore', 'secret.js\ngenerated/\n');
  write(dir, 'app.js', '// TODO: keep me\n');
  write(dir, 'secret.js', '// TODO: ignored by root rule\n');
  write(dir, 'generated/out.js', '// TODO: ignored folder\n');
  write(dir, 'lib/.gitignore', 'private.js\n');
  write(dir, 'lib/private.js', '// TODO: ignored by nested rule\n');
  write(dir, 'lib/public.js', '// TODO: keep me too\n');
  return dir;
}

const files = (r) => r.results.map((x) => x.file).sort();

test('inside a git repo: root and nested .gitignore are respected', async () => {
  assert.deepEqual(files(await scan(project({ git: true }))), ['app.js', 'lib/public.js']);
});

test('gitignore: false scans ignored files too', async () => {
  const out = files(await scan(project({ git: true }), { gitignore: false }));
  assert.ok(out.includes('secret.js') && out.includes('generated/out.js'));
});

test('outside git: root .gitignore is still respected', async () => {
  const out = files(await scan(project({ git: false })));
  assert.ok(out.includes('app.js') && out.includes('lib/public.js'));
  assert.ok(!out.includes('secret.js') && !out.includes('generated/out.js'));
});

test('tracked file deleted from disk does not crash the scan', async () => {
  const dir = project({ git: true });
  execFileSync('git', ['add', 'app.js'], { cwd: dir, stdio: 'pipe' });
  execFileSync('node', ['-e', "require('fs').unlinkSync('app.js')"], { cwd: dir });
  const out = files(await scan(dir));
  assert.ok(!out.includes('app.js'));
});