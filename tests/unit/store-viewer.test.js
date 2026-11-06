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

test('a refresh that renames last with a stale scan does not leave a stale index.json', async t => {
  const f = await fixture(t);
  await f.addRun('run-a');
  let held = false;
  let finishedB;
  const fs = {
    rename: async (from, to) => {
      if (to.endsWith('index.json') && !held) {
        held = true;
        // A has scanned one run. B adds a second run and completes. Then A renames its stale index.
        await f.addRun('run-b');
        finishedB = await refreshStoreViewer({ store: f.store, now: NOW });
      }
      return rename(from, to);
    },
  };
  await refreshStoreViewer({ store: f.store, now: NOW, fs });
  assert.equal(finishedB.runCount, 2);
  assert.deepEqual((await f.index()).runs.map(row => row.id).sort(), ['run-a', 'run-b']);
});

test('a store that changes on every rescan: the last scan is written and a warning says it did not settle', async t => {
  const f = await fixture(t);
  await f.addRun('run-0');
  let count = 0;
  const fs = { rename: async (from, to) => { if (to.endsWith('index.json')) await f.addRun(`run-${++count}`); return rename(from, to); } };
  const result = await refreshStoreViewer({ store: f.store, now: NOW, fs });
  assert.match(result.warnings.join('\n'), /index\.json did not settle after 4 rounds/);
  // The file lists every run the last scan saw: the last write is of the last scan, not of the one before.
  const listed = (await f.index()).runs.map(row => row.id);
  assert.equal(listed.length, result.runCount);
  assert.ok(listed.length >= 5, listed.join());
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

test('a report command refreshes the viewer (#312)', async t => {
  const { runWorkflow } = await import('../../src/workflow/index.js');
  const f = await fixture(t);
  const config = join(f.root, 'test-kit.config.json');
  await writeFile(config, JSON.stringify({ schemaVersion: 1, sides: { local: { origin: 'http://127.0.0.1:8000' } }, targets: [{ id: 'home', kind: 'page', path: '/' }], viewports: [{ id: 'desktop', width: 1280, height: 900 }] }));
  await f.addRun('run-a'); await f.addReport('rep-1');
  const result = await runWorkflow('report', { config, run: 'rep-1' }, { serve: async () => ({ origin: 'http://127.0.0.1:4567' }) });
  assert.equal(result.exitCode, 0);
  const listing = await f.index();
  assert.deepEqual(listing.runs.map(row => row.id), ['run-a']);
  assert.deepEqual(listing.reports.map(row => row.id), ['rep-1']);
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function designProject(t, extra = {}) {
  const f = await fixture(t);
  await mkdir(join(f.root, 'design'));
  await writeFile(join(f.root, 'design/home.png'), PNG);
  const config = join(f.root, 'test-kit.config.json');
  await writeFile(config, JSON.stringify({ schemaVersion: 1, sides: { figma: { kind: 'design', provider: 'files', root: 'design' } }, targets: [{ id: 'home', kind: 'page', path: '/', design: { mobile: 'home.png' } }], viewports: [{ id: 'mobile', width: 1, height: 1 }], artifacts: ['screenshot'], checks: [], ...extra }));
  return { ...f, config };
}

test('import with the default runsRoot lists the new run in index.json; an explicit runsRoot writes no viewer files (#312)', async t => {
  const { dispatch } = await import('../../src/cli/run.js');
  const f = await designProject(t);
  const imported = await dispatch({ command: 'import', positions: [], options: { config: f.config, side: 'figma' } });
  assert.equal(imported.exitCode, 0);
  assert.deepEqual((await f.index()).runs.map(row => row.id), [imported.output.id]);
  for (const name of VIEWER_FILES) assert.ok((await stat(join(f.store, name))).isFile(), name);
  const own = await designProject(t, { runsRoot: 'out/runs' });
  await dispatch({ command: 'import', positions: [], options: { config: own.config, side: 'figma' } });
  assert.deepEqual(await readdir(join(own.root, 'out')), ['runs']);
  assert.deepEqual(await readdir(join(own.root, 'test-kit')), []);
});

test('capture and plain perf results refresh the viewer for the default runsRoot only, and a failed refresh is a warning (#312)', async t => {
  const { refreshDefaultStoreViewer } = await import('../../src/workflow/index.js');
  const f = await designProject(t);
  await f.addRun('run-a');
  const result = { output: { id: 'run-a' }, exitCode: 1 };
  const done = await refreshDefaultStoreViewer(result, f.config);
  assert.deepEqual(done.output, result.output);
  assert.equal(done.exitCode, 1);
  assert.deepEqual((await f.index()).runs.map(row => row.id), ['run-a']);
  const own = await designProject(t, { runsRoot: 'out/runs' });
  assert.deepEqual(await refreshDefaultStoreViewer(result, own.config), result);
  await assert.rejects(stat(join(own.root, 'test-kit', 'index.json')));
  const broken = await refreshDefaultStoreViewer(result, f.config, { refreshStoreViewer: async () => { throw new Error('boom'); } });
  assert.equal(broken.exitCode, 1);
  assert.deepEqual(broken.output, result.output);
  assert.match(broken.stderr.join(''), /not refreshed \(boom\)/);
});

test('a store with a foreign viewer file and no marker is left untouched; a store the viewer made keeps refreshing (#312)', async t => {
  const f = await fixture(t);
  await f.addRun('run-a');
  await writeFile(join(f.store, 'index.html'), 'foreign page');
  const result = await refreshStoreViewer({ store: f.store, now: NOW });
  assert.match(result.warnings.join(''), /store .* holds files the viewer did not write; the viewer was not written/);
  assert.equal(await readFile(join(f.store, 'index.html'), 'utf8'), 'foreign page');
  assert.deepEqual((await readdir(f.store)).sort(), ['index.html', 'runs']);
  await rm(join(f.store, 'index.html'));
  const first = await refreshStoreViewer({ store: f.store, now: NOW });
  assert.deepEqual(first.warnings, []);
  assert.deepEqual(JSON.parse(await readFile(join(f.store, '.test-kit-viewer'), 'utf8')), { tool: 'test-kit', kind: 'store-viewer', schemaVersion: 1 });
  await f.addRun('run-b', '2026-01-02T00:00:00.000Z');
  assert.deepEqual((await refreshStoreViewer({ store: f.store, now: NOW })).warnings, []);
  assert.deepEqual((await f.index()).runs.map(row => row.id).sort(), ['run-a', 'run-b']);
});

test('a foreign index.json alone also blocks the viewer, and deleting the store recreates marker and viewer (#312)', async t => {
  const f = await fixture(t);
  await writeFile(join(f.store, 'index.json'), '{"mine":true}');
  const blocked = await refreshStoreViewer({ store: f.store, now: NOW });
  assert.equal(blocked.warnings.length, 1);
  assert.equal(await readFile(join(f.store, 'index.json'), 'utf8'), '{"mine":true}');
  await rm(f.store, { recursive: true });
  await mkdir(f.store);
  await refreshStoreViewer({ store: f.store, now: NOW });
  for (const name of [...VIEWER_FILES, 'index.json', '.test-kit-viewer']) assert.ok((await stat(join(f.store, name))).isFile(), name);
});

test('only an exact, regular marker file proves ownership; any other marker blocks the write (#312)', async t => {
  for (const [label, make] of [
    ['empty', store => writeFile(join(store, '.test-kit-viewer'), '')],
    ['malformed', store => writeFile(join(store, '.test-kit-viewer'), '{not json')],
    ['wrong version', store => writeFile(join(store, '.test-kit-viewer'), JSON.stringify({ tool: 'test-kit', kind: 'store-viewer', schemaVersion: 2 }) + '\n')],
    ['directory', store => mkdir(join(store, '.test-kit-viewer'))],
    ['symlink', async store => { const real = join(store, '..', 'real-marker'); await writeFile(real, JSON.stringify({ tool: 'test-kit', kind: 'store-viewer', schemaVersion: 1 }) + '\n'); await symlink(real, join(store, '.test-kit-viewer')); }],
  ]) {
    const f = await fixture(t);
    await make(f.store);
    await writeFile(join(f.store, 'index.html'), 'project page');
    const result = await refreshStoreViewer({ store: f.store, now: NOW });
    assert.equal(await readFile(join(f.store, 'index.html'), 'utf8'), 'project page', label);
    assert.ok(result.warnings.some(line => /did not write/.test(line)), label);
  }
});
