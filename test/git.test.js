import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scan, sortResults } from '../src/scanner.js';
import { resolveSince, annotate, filterSince } from '../src/git.js';

function git(cwd, args, date) {
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'dev@example.com',
      GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'dev@example.com',
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
    },
  });
}

// a.js: old TODO committed in 2020, a new FIXME committed now
function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'todofind-git-'));
  git(dir, ['init', '-q']);
  writeFileSync(path.join(dir, 'a.js'), '// TODO: old task\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'old'], '2020-01-01T12:00:00');
  appendFileSync(path.join(dir, 'a.js'), '// FIXME: new task\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'new']);
  return dir;
}

async function load(dir) {
  const { results, root } = await scan(dir);
  return annotate(results, root);
}

test('--since 30d keeps only recent lines', async () => {
  const dir = repo();
  const since = await resolveSince('30d', dir);
  const out = filterSince(await load(dir), since);
  assert.deepEqual(out.map((r) => r.tag), ['FIXME']);
  assert.equal(out[0].by, 'Dev');
});

test('--since with an old date keeps everything', async () => {
  const dir = repo();
  const since = await resolveSince('2019-01-01', dir);
  assert.equal(filterSince(await load(dir), since).length, 2);
});

test('--since with a git ref excludes that commit', async () => {
  const dir = repo();
  const since = await resolveSince('HEAD~1', dir);
  assert.deepEqual(filterSince(await load(dir), since).map((r) => r.tag), ['FIXME']);
});

test('uncommitted lines count as recent', async () => {
  const dir = repo();
  appendFileSync(path.join(dir, 'a.js'), '// BUG: not committed yet\n');
  const since = await resolveSince('1d', dir);
  const tags = filterSince(await load(dir), since).map((r) => r.tag);
  assert.deepEqual(tags.sort(), ['BUG', 'FIXME']);
});

test('invalid --since value throws a clear error', async () => {
  await assert.rejects(resolveSince('banana', repo()), /Could not understand/);
});

test('sort by tag puts urgent tags first', () => {
  const items = [
    { file: 'a.js', line: 1, tag: 'NOTE' },
    { file: 'a.js', line: 2, tag: 'TODO' },
    { file: 'b.js', line: 1, tag: 'FIXME' },
  ];
  assert.deepEqual(sortResults(items, 'tag').map((r) => r.tag), ['FIXME', 'TODO', 'NOTE']);
});

test('sort by date puts newest first', () => {
  const items = [
    { file: 'a.js', line: 1, tag: 'TODO', date: '2020-01-01T00:00:00.000Z' },
    { file: 'a.js', line: 2, tag: 'TODO', date: '2026-01-01T00:00:00.000Z' },
  ];
  assert.deepEqual(sortResults(items, 'date').map((r) => r.line), [2, 1]);
});