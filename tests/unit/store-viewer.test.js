import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshStoreViewer, VIEWER_FILES } from '../../src/export/store-viewer.js';
import { ensureStore } from '../../src/workflow/index.js';

const H1 = 'sha256:' + 'a'.repeat(64);
const NOW = new Date('2026-10-20T12:00:00.000Z');

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'test-kit-viewer-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = join(root, 'test-kit');
  await mkdir(store);
  const addRun = async (id, at = '2026-01-01T00:00:00.000Z') => {
    await mkdir(join(store, 'runs', id), { recursive: true });
    await writeFile(join(store, 'runs', id, 'run.json'), JSON.stringify({ at, settingsHash: H1, state: 'complete', settings: { targets: [{ id: 'home' }] } }));
  };
  const addReport = async (id, { evidence = 'shots/a.png' } = {}) => {
    const dir = join(store, 'reports', id);
    await mkdir(join(dir, 'shots'), { recursive: true });
    await writeFile(join(dir, 'report.json'), JSON.stringify({
      schemaVersion: 2, meta: { generated: '2026-01-03T00:00:00.000Z', matchBelow: 3, viewports: [{ id: 'mobile' }] },
      runs: [{ id: 'run-a' }, { id: 'run-b' }], pair: { kind: 'update', aRunId: 'run-a', bRunId: 'run-b' },
      entries: [{ id: 'home', viewports: [{ id: 'mobile', ratio: 0, state: 'complete', artifacts: { screenshot: { a: { src: evidence } } } }] }],
      causes: [], findings: [], rules: {},
    }));
    await writeFile(join(dir, evidence), Buffer.from('png-bytes'));
  };
  const index = async () => JSON.parse(await readFile(join(store, 'index.json'), 'utf8'));
  return { root, store, addRun, addReport, index };
}

test('the refresh writes the viewer files and an index that lists exactly the runs and reports', async t => {
  const f = await fixture(t);
  await f.addRun('run-a'); await f.addRun('run-b', '2026-01-02T00:00:00.000Z'); await f.addReport('rep-1');
  const result = await refreshStoreViewer({ store: f.store, now: NOW });
  for (const name of VIEWER_FILES) assert.ok((await stat(join(f.store, name))).isFile(), name);
  const index = await f.index();
  assert.deepEqual(index.runs.map(row => row.path).sort(), ['runs/run-a/run.json', 'runs/run-b/run.json']);
  assert.deepEqual(index.reports.map(row => row.path), ['reports/rep-1/report.json']);
  assert.deepEqual([result.runCount, result.reportCount], [2, 1]);
  assert.deepEqual((await readdir(f.store)).filter(name => name.endsWith('.tmp')), []);
});

test('an empty store gets a valid empty index', async t => {
  const f = await fixture(t);
  await refreshStoreViewer({ store: f.store, now: NOW });
  const index = await f.index();
  assert.equal(index.schemaVersion, 1);
  assert.deepEqual([index.runs, index.reports], [[], []]);
});

test('a report with raw HTML evidence is listed without a path and warns', async t => {
  const f = await fixture(t);
  await f.addReport('with-html');
  await f.addReport('good');
  const file = join(f.store, 'reports/with-html/report.json');
  const report = JSON.parse(await readFile(file, 'utf8'));
  report.entries[0].viewports[0].artifacts.lighthouse = { state: 'failed', a: { kind: 'lighthouse', reports: [{ json: { kind: 'lighthouse', src: 'lh.json' }, html: { kind: 'lighthouse', src: 'lh.html' } }] } };
  await writeFile(file, JSON.stringify(report));
  await writeFile(join(f.store, 'reports/with-html/lh.json'), '{}');
  await writeFile(join(f.store, 'reports/with-html/lh.html'), '<script>alert(1)</script>');
  const result = await refreshStoreViewer({ store: f.store, now: NOW });
  const rows = Object.fromEntries((await f.index()).reports.map(row => [row.id, row.path]));
  assert.equal(rows.good, 'reports/good/report.json');
  assert.equal(rows['with-html'], null);
  assert.deepEqual(result.unavailable, ['with-html']);
  assert.match(result.warnings[0], /active content/);
});

test('a symlink that leaves the report folder makes the report unavailable', async t => {
  const f = await fixture(t);
  await f.addReport('linked');
  await writeFile(join(f.root, 'outside.png'), 'secret');
  await rm(join(f.store, 'reports/linked/shots/a.png'));
  await symlink(join(f.root, 'outside.png'), join(f.store, 'reports/linked/shots/a.png'));
  const result = await refreshStoreViewer({ store: f.store, now: NOW });
  assert.deepEqual(result.unavailable, ['linked']);
  assert.equal((await f.index()).reports[0].path, null);
  assert.match(result.warnings[0], /linked/);
});

test('a write fault keeps the previous index.json and leaves no temp file', async t => {
  const f = await fixture(t);
  await f.addRun('run-a');
  await refreshStoreViewer({ store: f.store, now: NOW });
  const before = await readFile(join(f.store, 'index.json'), 'utf8');
  await f.addRun('run-b');
  const fs = { rename: async (from, to) => { if (to.endsWith('index.json')) throw new Error('disk full'); return rename(from, to); } };
  await assert.rejects(refreshStoreViewer({ store: f.store, now: NOW, fs }), /disk full/);
  assert.equal(await readFile(join(f.store, 'index.json'), 'utf8'), before);
  assert.deepEqual((await readdir(f.store)).filter(name => name.endsWith('.tmp')), []);
  const failing = { writeFile: async (path, ...rest) => { if (path.includes('.tmp')) throw new Error('no space'); return writeFile(path, ...rest); } };
  await assert.rejects(refreshStoreViewer({ store: f.store, now: NOW, fs: failing }), /no space/);
  assert.equal(await readFile(join(f.store, 'index.json'), 'utf8'), before);
});

test('viewer files are copied only when their bytes differ', async t => {
  const f = await fixture(t);
  await refreshStoreViewer({ store: f.store, now: NOW });
  const first = (await stat(join(f.store, 'app.js'))).mtimeMs;
  await new Promise(done => setTimeout(done, 20));
  await refreshStoreViewer({ store: f.store, now: NOW });
  assert.equal((await stat(join(f.store, 'app.js'))).mtimeMs, first);
  await writeFile(join(f.store, 'app.js'), 'stale');
  await refreshStoreViewer({ store: f.store, now: NOW });
  assert.notEqual(await readFile(join(f.store, 'app.js'), 'utf8'), 'stale');
});

test('two concurrent refreshes with a run added between still list every run', async t => {
  const f = await fixture(t);
  await f.addRun('run-a');
  let added = false;
  const fs = { rename: async (from, to) => { if (to.endsWith('index.json') && !added) { added = true; await f.addRun('run-late'); } return rename(from, to); } };
  await Promise.all([refreshStoreViewer({ store: f.store, now: NOW, fs }), refreshStoreViewer({ store: f.store, now: NOW })]);
  const index = await f.index();
  assert.deepEqual(index.runs.map(row => row.id).sort(), ['run-a', 'run-late']);
});

test('deleting the store and running again recreates the viewer, and .gitignore stays', async t => {
  const f = await fixture(t);
  const config = join(f.root, 'test-kit.config.json');
  const store = await ensureStore({ config });
  await refreshStoreViewer({ store, now: NOW });
  assert.equal(await readFile(join(store, '.gitignore'), 'utf8'), '*\n');
  await rm(store, { recursive: true });
  const again = await ensureStore({ config });
  await refreshStoreViewer({ store: again, now: NOW });
  for (const name of [...VIEWER_FILES, 'index.json', '.gitignore']) assert.ok((await stat(join(again, name))).isFile(), name);
});

test('history --publish with no DIR, or with the store as DIR, refreshes the store viewer; another DIR still publishes', async t => {
  const { run } = await import('../../src/cli/run.js');
  const f = await fixture(t);
  await f.addRun('run-a');
  const config = join(f.root, 'test-kit.config.json');
  await writeFile(config, '{}');
  const call = async argv => { const out = []; const err = []; const code = await run(argv, { out: { write: v => out.push(v) }, err: { write: v => err.push(v) } }); return { code, out: out.join(''), err: err.join('') }; };
  let result = await call(['history', '--config', config, '--publish']);
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.out).refreshed, f.store);
  assert.equal((await f.index()).runs.length, 1);
  await rm(join(f.store, 'index.json'));
  result = await call(['history', '--config', config, '--publish', 'test-kit']);
  assert.equal(result.code, 0);
  assert.ok((await stat(join(f.store, 'index.json'))).isFile());
  result = await call(['history', '--config', config, '--publish', 'test-kit/site']);
  assert.equal(result.code, 1);
  assert.match(result.err, /history store/);
  result = await call(['history', '--config', config, '--publish', 'site']);
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.out).published, join(f.root, 'site'));
});

test('a workflow command refreshes the viewer, and a failed refresh is only a warning', async t => {
  const { runWorkflow } = await import('../../src/workflow/index.js');
  const f = await fixture(t);
  const config = join(f.root, 'test-kit.config.json');
  await writeFile(config, JSON.stringify({ schemaVersion: 1, sides: { local: { origin: 'http://127.0.0.1:8000' } }, targets: [{ id: 'home', kind: 'page', path: '/' }], viewports: [{ id: 'desktop', width: 1280, height: 900 }] }));
  const capture = async () => { await f.addRun('run-a'); return { run: { id: 'run-a', state: 'complete' } }; };
  const result = await runWorkflow('run', { config }, { capture, summarizeRunFeedback: async () => ({}) });
  assert.equal(result.exitCode, 0);
  assert.deepEqual((await f.index()).runs.map(row => row.id), ['run-a']);
  const broken = await runWorkflow('run', { config }, { capture, summarizeRunFeedback: async () => ({}), refreshStoreViewer: async () => { throw new Error('boom'); } });
  assert.equal(broken.exitCode, 0);
  assert.match(broken.stderr.join(''), /not refreshed \(boom\)/);
});
