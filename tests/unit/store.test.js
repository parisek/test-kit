import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, rm, utimes, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_STORE, LEGACY_STORE, DEFAULT_RUNS_ROOT, legacyStoreNotice, ensureDefaultRunsIgnore, ensureStoreIgnore } from '../../src/config/store.js';
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

test('the CLI prints the legacy notice once, and not for an explicit store or runsRoot', async t => {
  const { run } = await import('../../src/cli/run.js');
  const dir = await project(t);
  const config = join(dir, 'test-kit.config.json');
  await writeFile(config, JSON.stringify(base));
  await mkdir(join(dir, '.test-kit', 'runs'), { recursive: true });
  const past = new Date('2020-01-01T00:00:00Z');
  await utimes(join(dir, '.test-kit'), past, past);
  const before = (await stat(join(dir, '.test-kit'))).mtimeMs;
  const call = async argv => { const err = []; await run(argv, { out: { write() {} }, err: { write: v => err.push(v) } }, '0', async () => ({ output: {}, exitCode: 0 })); return err; };
  assert.equal((await call(['before', '--config', config])).filter(line => /no longer used/.test(line)).length, 1);
  assert.equal((await call(['history', '--config', config, '--store', '.test-kit'])).length, 0);
  assert.equal((await call(['before', '--config', config, '--store', 'other'])).length, 0);
  await writeFile(config, JSON.stringify({ ...base, runsRoot: '.test-kit/runs' }));
  assert.equal((await call(['capture', '--side', 'local', '--config', config])).length, 0);
  assert.equal((await stat(join(dir, '.test-kit'))).mtimeMs, before);
  assert.deepEqual(await readdir(join(dir, '.test-kit')), ['runs']);
});

test('a low-level command writes the store .gitignore for the default runsRoot only (capture, import, perf)', async t => {
  const { readFile, access } = await import('node:fs/promises');
  const dir = await project(t);
  // The call sits where a low-level command has just run mkdir -p on its runsRoot.
  await mkdir(join(dir, DEFAULT_RUNS_ROOT), { recursive: true });
  assert.equal(await ensureDefaultRunsIgnore(dir, DEFAULT_RUNS_ROOT), true);
  assert.equal(await readFile(join(dir, DEFAULT_STORE, '.gitignore'), 'utf8'), '*\n');
  await writeFile(join(dir, DEFAULT_STORE, '.gitignore'), 'custom\n');
  assert.equal(await ensureDefaultRunsIgnore(dir, join(dir, DEFAULT_RUNS_ROOT)), false);
  assert.equal(await readFile(join(dir, DEFAULT_STORE, '.gitignore'), 'utf8'), 'custom\n');
  await mkdir(join(dir, 'tests/visual/runs'), { recursive: true });
  assert.equal(await ensureDefaultRunsIgnore(dir, 'tests/visual/runs'), false);
  await assert.rejects(access(join(dir, 'tests/visual/.gitignore')));
  await assert.rejects(access(join(dir, 'tests/visual/runs/.gitignore')));
});

test('importDesign with the default runsRoot creates the store .gitignore; an explicit runsRoot does not', async t => {
  const { readFile, access } = await import('node:fs/promises');
  const { importDesign } = await import('../../src/design/import.js');
  const dir = await project(t);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await mkdir(join(dir, 'design'));
  await writeFile(join(dir, 'design/home.png'), png);
  const config = join(dir, 'design.config.json');
  const design = { schemaVersion: 1, sides: { figma: { kind: 'design', provider: 'files', root: 'design' } }, targets: [{ id: 'home', kind: 'page', path: '/', design: { mobile: 'home.png' } }], viewports: [{ id: 'mobile', width: 1, height: 1 }], artifacts: ['screenshot'], checks: [] };
  await writeFile(config, JSON.stringify(design));
  await importDesign({ configPath: config, side: 'figma' });
  assert.equal(await readFile(join(dir, DEFAULT_STORE, '.gitignore'), 'utf8'), '*\n');
  assert.ok((await readdir(join(dir, DEFAULT_RUNS_ROOT))).length === 1);
  await writeFile(config, JSON.stringify({ ...design, runsRoot: 'out/runs' }));
  await importDesign({ configPath: config, side: 'figma' });
  await assert.rejects(access(join(dir, 'out/.gitignore')));
  await assert.rejects(access(join(dir, 'out/runs/.gitignore')));
});

test('a .gitignore that appears while the store ignore is written is never replaced (#312)', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'test-kit-ignore-race-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = join(dir, '.gitignore');
  // The first lstat reports "missing"; a project file appears right after it.
  const fs = { lstat: async path => { const error = await lstat(path).then(() => null, e => e); await writeFile(target, 'project policy\n'); if (error) throw error; return lstat(path); } };
  assert.equal(await ensureStoreIgnore(dir, { fs }), false);
  assert.equal(await readFile(target, 'utf8'), 'project policy\n');
  assert.deepEqual((await readdir(dir)).filter(name => name.endsWith('.tmp')), []);
});

test('the store viewer refresh, history --publish and history --prune leave inputs/ unchanged (R12.1, #352)', async t => {
  const { STORE_INPUTS } = await import('../../src/config/store.js');
  const { refreshStoreViewer } = await import('../../src/export/store-viewer.js');
  const { publishHistory } = await import('../../src/export/publish.js');
  const { pruneHistory } = await import('../../src/history/prune.js');
  assert.equal(STORE_INPUTS, 'inputs');
  const dir = await mkdtemp(join(tmpdir(), 'test-kit-reserved-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = join(dir, DEFAULT_STORE);
  const inputs = join(store, STORE_INPUTS);
  await mkdir(join(inputs, 'design'), { recursive: true });
  await writeFile(join(inputs, 'design', 'home.png'), 'supplied image');
  await writeFile(join(inputs, 'index.json'), 'a project file with a viewer file name');
  await mkdir(join(store, 'reports'), { recursive: true });
  for (const [id, at] of [['run-old', '2026-01-01T00:00:00Z'], ['run-new', '2026-02-01T00:00:00Z']]) {
    await mkdir(join(store, 'runs', id), { recursive: true });
    await writeFile(join(store, 'runs', id, 'run.json'), JSON.stringify({ id, side: 'local', at, state: 'complete', captures: [] }));
  }
  const past = new Date('2020-01-01T00:00:00Z');
  for (const path of ['design/home.png', 'index.json', 'design', '.']) await utimes(join(inputs, path), past, past);
  const snapshot = async () => {
    const rows = [];
    for (const path of ['.', 'design', 'design/home.png', 'index.json']) {
      const info = await lstat(join(inputs, path));
      rows.push([path, info.mtimeMs, info.isFile() ? await readFile(join(inputs, path), 'utf8') : (await readdir(join(inputs, path))).sort().join(',')]);
    }
    return rows;
  };
  const seeded = await snapshot();
  const viewer = await refreshStoreViewer({ store });
  assert.deepEqual(viewer.warnings, [], 'A viewer file name under inputs/ does not make the store foreign.');
  assert.deepEqual(await snapshot(), seeded);
  assert.ok(!(await readFile(join(store, 'index.json'), 'utf8')).includes(STORE_INPUTS));
  const published = await publishHistory({ local: store, dir: join(dir, 'published'), cwd: dir, home: tmpdir() });
  assert.ok(!(await readdir(published.dir)).includes(STORE_INPUTS));
  assert.deepEqual(await snapshot(), seeded);
  const pruned = await pruneHistory({ local: store, keep: 1, yes: true });
  assert.deepEqual(pruned.output.removed, ['run-old']);
  assert.deepEqual(await snapshot(), seeded);
  assert.deepEqual((await readdir(store)).filter(name => name === STORE_INPUTS), [STORE_INPUTS]);
});
