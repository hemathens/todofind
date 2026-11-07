import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpinner } from '../src/spinner.js';

const fakeStream = (isTTY) => {
  const out = [];
  return { isTTY, out, write: (s) => out.push(s) };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('writes nothing when the stream is not a terminal', async () => {
  const stream = fakeStream(false);
  const sp = createSpinner('working', { stream, delay: 0 }).start();
  await wait(60);
  sp.stop();
  assert.equal(stream.out.length, 0);
});

test('fast work never flashes a spinner (delay not reached)', async () => {
  const stream = fakeStream(true);
  const sp = createSpinner('working', { stream, delay: 200 }).start();
  sp.stop();
  await wait(250);
  assert.equal(stream.out.length, 0);
});

test('slow work shows frames, then clears the line and restores the cursor', async () => {
  const stream = fakeStream(true);
  const sp = createSpinner('working', { stream, delay: 0, frames: ['A', 'B'] }).start();
  await wait(120);
  sp.update('still working');
  await wait(100);
  sp.stop();
  const all = stream.out.join('');
  assert.match(all, /working/);
  assert.match(all, /still working/);
  assert.ok(all.includes('\x1b[?25l'), 'cursor hidden while spinning');
  assert.ok(stream.out.at(-1) === '\x1b[?25h', 'cursor restored last');
});

test('enabled: false disables it even on a terminal', async () => {
  const stream = fakeStream(true);
  createSpinner('x', { stream, enabled: false, delay: 0 }).start().stop();
  await wait(30);
  assert.equal(stream.out.length, 0);
});