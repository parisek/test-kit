import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// These tests pin the calls that wire the default store into each command.
// A browser or Lighthouse run is replaced by a stub that fails or returns early.
async function project(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'test-kit-wiring-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = join(root, 'test-kit.config.json');
  await writeFile(config, JSON.stringify({ schemaVersion: 1, sides: { local: { origin: 'http://127.0.0.1:8000' } }, targets: [{ id: 'home', kind: 'page', path: '/' }], viewports: [{ id: 'desktop', width: 1280, height: 900 }] }));
  return { root, config, store: join(root, 'test-kit') };
}
const ignoreOf = store => readFile(join(store, '.gitignore'), 'utf8');

test('capture gives the default store a .gitignore before it launches the browser', async t => {
  const { capture } = await import('../../src/capture/index.js');
  const f = await project(t);
  const playwright = async () => ({ version: 'stub', chromium: { launch: async () => { throw new Error('no browser'); } } });
  await assert.rejects(capture({ configPath: f.config, side: 'local' }, { playwright }), /Capture stops before completion/);
  assert.equal(await ignoreOf(f.store), '*\n');
});

test('plain perf gives the default store a .gitignore before it measures', async t => {
  const { runPerfCommand } = await import('../../src/cli/perf.js');
  const f = await project(t);
  const runPerformance = async () => { throw new Error('no lighthouse run'); };
  const result = await runPerfCommand({ configPath: f.config, side: 'local', targetIds: ['home'] }, { runPerformance });
  assert.equal(result.exitCode, 1);
  assert.equal(await ignoreOf(f.store), '*\n');
});

test('dispatch refreshes the store viewer after capture and after plain perf', async t => {
  const { dispatch } = await import('../../src/cli/run.js');
  for (const [command, name] of [['capture', 'capture'], ['perf', 'runPerfCommand']]) {
    const f = await project(t);
    await mkdir(join(f.store, 'runs', 'run-a'), { recursive: true });
    await writeFile(join(f.store, 'runs', 'run-a', 'run.json'), JSON.stringify({ at: '2026-01-01T00:00:00.000Z', settingsHash: 'sha256:' + 'a'.repeat(64), state: 'complete', settings: { targets: [{ id: 'home' }] } }));
    const stub = name === 'capture'
      ? { capture: async () => ({ run: { id: 'run-a', state: 'complete' }, manifestPath: 'run.json' }) }
      : { runPerfCommand: async () => ({ output: { id: 'run-a' }, exitCode: 0 }) };
    const options = { config: f.config, side: 'local', targets: 'home' };
    const result = await dispatch({ command, positions: [], options }, stub);
    assert.equal(result.exitCode, 0, command);
    const listing = JSON.parse(await readFile(join(f.store, 'index.json'), 'utf8'));
    assert.deepEqual(listing.runs.map(row => row.id), ['run-a'], command);
  }
});

test('project perf refreshes the viewer of the store it wrote', async t => {
  const { runProjectPerformance } = await import('../../src/workflow/performance.js');
  const f = await project(t);
  const seen = [];
  const dependencies = {
    runPerfCommand: async () => ({ output: { id: 'run-a' }, exitCode: 0 }),
    refreshStoreViewer: async ({ store }) => { seen.push(store); return { warnings: [] }; },
  };
  const result = await runProjectPerformance({ config: f.config, side: 'local', store: 'out-store', targets: 'home' }, {}, dependencies);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(seen, [join(f.root, 'out-store')]);
});
