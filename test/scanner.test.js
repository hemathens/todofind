import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scan } from '../src/scanner.js';
import { toTable, toMarkdown, toJson } from '../src/reporters.js';

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'todofind-'));
  writeFileSync(path.join(dir, 'a.js'), [
    'const x = 1;',
    '// TODO: refactor this',
    '/* FIXME(dev): broken on Windows */',
    'const s = "TODO inside a string";',
  ].join('\n'));
  writeFileSync(path.join(dir, 'b.py'), '# HACK temporary workaround\n');
  mkdirSync(path.join(dir, 'node_modules'));
  writeFileSync(path.join(dir, 'node_modules', 'x.js'), '// TODO ignored\n');
  writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 0x2f, 0x2f]));
  return dir;
}

test('finds tags in comments only', async () => {
  const { results } = await scan(fixture());
  assert.equal(results.length, 3);
  assert.deepEqual(results.map((r) => r.tag), ['TODO', 'FIXME', 'HACK']);
});

test('captures author and message', async () => {
  const { results } = await scan(fixture());
  const fixme = results.find((r) => r.tag === 'FIXME');
  assert.equal(fixme.author, 'dev');
  assert.equal(fixme.message, 'broken on Windows');
});

test('ignores node_modules and binary files', async () => {
  const { results } = await scan(fixture());
  assert.ok(!results.some((r) => r.file.includes('node_modules')));
});

test('custom tags filter', async () => {
  const { results } = await scan(fixture(), { tags: ['HACK'] });
  assert.equal(results.length, 1);
});

test('reporters produce expected output', async () => {
  const { results, filesScanned } = await scan(fixture());
  assert.match(toTable(results), /Location/);
  assert.match(toMarkdown(results, { filesScanned }), /# Todo Report/);
  assert.equal(JSON.parse(toJson(results, { filesScanned })).summary.total, 3);
});
