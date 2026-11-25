import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRun } from '../../src/compare/runs.js';

const HEAD = 'Run IDs are the directory names under runsRoot, not paths.';

test('a path in place of a run ID names what a run ID is (#415)', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'test-kit-run-id-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(readRun(root, 'test-kit/runs/before-1'), { message: `${HEAD} Got: test-kit/runs/before-1.` });
  await assert.rejects(readRun(root, 'runs/a'), { message: `${HEAD} Got: runs/a.` });
});

test('the value is printed only when it is a plain relative path (#415)', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'test-kit-run-id-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const value of ['/abs/run', '../run', 'a/../b', 'a b', '<img src=x>', 'a\nb', '', undefined, 5, `a/${'b'.repeat(300)}`]) {
    await assert.rejects(readRun(root, value), { message: HEAD }, JSON.stringify(value));
  }
});

test('a plain run ID still reads (#415)', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'test-kit-run-id-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(readRun(root, 'before-1'), (error) => !error.message.startsWith(HEAD));
});
