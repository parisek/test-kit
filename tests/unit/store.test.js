import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, stat, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_STORE, LEGACY_STORE, DEFAULT_RUNS_ROOT, legacyStoreNotice } from '../../src/config/store.js';
import { normalizeConfig } from '../../src/config/index.js';
import { resolveStore } from '../../src/workflow/index.js';

const base = { schemaVersion: 1, sides: { local: { origin: 'http://127.0.0.1:1' } }, targets: [{ id: 'home', title: 'Home', kind: 'page', path: '/' }], viewports: [{ id: 'desktop', width: 1280, height: 900 }] };

test('the default store and the runsRoot default are test-kit (R12.1, #312)', () => {
  assert.equal(DEFAULT_STORE, 'test-kit');
  assert.equal(LEGACY_STORE, '.test-kit');
  assert.equal(DEFAULT_RUNS_ROOT, 'test-kit/runs');
  assert.equal(normalizeConfig(base).runsRoot, 'test-kit/runs');
  assert.equal(resolveStore({ config: '/p/test-kit.config.json' }), '/p/test-kit');
});

test('an explicit runsRoot or store keeps working, including the old name', () => {
  assert.equal(normalizeConfig({ ...base, runsRoot: '.test-kit/runs' }).runsRoot, '.test-kit/runs');
  assert.equal(resolveStore({ config: '/p/test-kit.config.json', store: '.test-kit' }), '/p/.test-kit');
});

async function project(t) {
  const dir = await mkdtemp(join(tmpdir(), 'test-kit-legacy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('the legacy notice names the old folder once and never touches it', async t => {
  const dir = await project(t);
  const old = join(dir, '.test-kit');
  await mkdir(join(old, 'runs'), { recursive: true });
  await writeFile(join(old, 'state.json'), '{}');
  const past = new Date('2020-01-01T00:00:00Z');
  await utimes(old, past, past);
  const before = { entries: (await readdir(old)).sort(), mtime: (await stat(old)).mtimeMs };
  const notice = await legacyStoreNotice(dir, { explicit: false });
  assert.match(notice, /\.test-kit\/ is no longer used/);
  assert.match(notice, /Delete \.test-kit\//);
  assert.ok(!notice.includes('\n'));
  assert.deepEqual({ entries: (await readdir(old)).sort(), mtime: (await stat(old)).mtimeMs }, before);
});

test('no notice for an explicit store, a missing folder, or a file', async t => {
  const dir = await project(t);
  assert.equal(await legacyStoreNotice(dir, { explicit: false }), null);
  await mkdir(join(dir, '.test-kit'));
  assert.equal(await legacyStoreNotice(dir, { explicit: true }), null);
  const other = await project(t);
  await writeFile(join(other, '.test-kit'), 'x');
  assert.equal(await legacyStoreNotice(other, { explicit: false }), null);
});

test('a fresh store gets a .gitignore with * and an existing one stays untouched', async t => {
  const { ensureStore } = await import('../../src/workflow/index.js');
  const { readFile } = await import('node:fs/promises');
  const dir = await project(t);
  const config = join(dir, 'test-kit.config.json');
  const store = await ensureStore({ config });
  assert.equal(await readFile(join(store, '.gitignore'), 'utf8'), '*\n');
  await writeFile(join(store, '.gitignore'), 'custom\n');
  await ensureStore({ config });
  assert.equal(await readFile(join(store, '.gitignore'), 'utf8'), 'custom\n');
  assert.deepEqual((await readdir(store)).filter(name => name.endsWith('.tmp')), []);
});
