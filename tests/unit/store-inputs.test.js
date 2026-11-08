import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { PNG } from 'pngjs';
import { DEFAULT_INPUTS, INPUTS_DIR, assertOutsideInputs, namesDefaultInputs } from '../../src/config/store.js';
import { normalizeConfig } from '../../src/config/index.js';
import { resolveStore, runWorkflow } from '../../src/workflow/index.js';
import { refreshStoreViewer } from '../../src/export/store-viewer.js';
import { importDesign, readDesignFile } from '../../src/design/import.js';
import { dispatch } from '../../src/cli/run.js';

// R12.6 (#352): `<store>/inputs/` holds project files. test-kit never writes, moves or deletes anything under it.

const baseConfig = { schemaVersion: 1, sides: { local: { origin: 'http://127.0.0.1:8000' } }, targets: [{ id: 'home', kind: 'page', path: '/' }], viewports: [{ id: 'desktop', width: 40, height: 30 }] };

function png(width, height) {
  const image = new PNG({ width, height });
  image.data.fill(200);
  return PNG.sync.write(image);
}

async function project(t, config = baseConfig) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'test-kit-inputs-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, 'test-kit.config.json');
  await writeFile(configPath, JSON.stringify(config));
  return { root, configPath, store: join(root, 'test-kit'), inputs: join(root, 'test-kit', INPUTS_DIR) };
}

// Project files that look like test-kit output, so a command that scanned or claimed them would show it.
async function seedInputs(inputs) {
  const files = {
    'crops/home-desktop.png': png(4, 4),
    'design/hero/desktop.png': png(40, 20),
    'index.html': '<p>project file</p>',
    'index.json': '{"project":true}',
    '.gitignore': '!keep\n',
    'runs/2026-01-01T00-00-00-000Z-1-abcdef1/run.json': '{"state":"complete"}',
    'reports/r1/report.json': '{}',
  };
  for (const [name, body] of Object.entries(files)) {
    await mkdir(join(inputs, name, '..'), { recursive: true });
    await writeFile(join(inputs, name), body);
  }
}

// Every path below `inputs/`, with its bytes and modification time.
async function snapshot(inputs) {
  const rows = [];
  const walk = async dir => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      const info = await stat(path);
      rows.push([relative(inputs, path), entry.isDirectory() ? 'dir' : (await readFile(path)).toString('base64'), info.mtimeMs]);
      if (entry.isDirectory()) await walk(path);
    }
  };
  await walk(inputs);
  return rows;
}

test('namesDefaultInputs matches the folder and its children only, in any case (R12.6)', () => {
  assert.equal(DEFAULT_INPUTS, 'test-kit/inputs');
  for (const value of ['test-kit/inputs', 'test-kit/inputs/runs', 'Test-Kit/Inputs/x', 'test-kit/INPUTS']) assert.equal(namesDefaultInputs(value), true, value);
  for (const value of ['test-kit', 'test-kit/runs', 'test-kit/inputs-old', 'test-kit/inputsx/runs', 'inputs', 'other/test-kit/inputs']) assert.equal(namesDefaultInputs(value), false, value);
});

test('assertOutsideInputs refuses the inputs folder of each named store and keeps its siblings (R12.6)', () => {
  const store = join(tmpdir(), 'p', 'test-kit');
  const other = join(tmpdir(), 'p', 'old-store');
  for (const path of [join(store, 'inputs'), join(store, 'inputs', 'export'), join(store, 'INPUTS', 'x'), join(other, 'inputs', 'site')]) {
    assert.throws(() => assertOutsideInputs(path, [store, other], '--export'), /--export must not be inside inputs\/ of the store/, path);
  }
  for (const path of [store, join(store, 'export'), join(store, 'inputs-old'), join(tmpdir(), 'p', 'site'), other]) assert.doesNotThrow(() => assertOutsideInputs(path, [store, other], '--export'), path);
});

test('config: runsRoot must not be inside test-kit/inputs (R12.6)', () => {
  for (const runsRoot of ['test-kit/inputs', 'test-kit/inputs/runs', 'test-kit/Inputs/runs']) {
    assert.throws(() => normalizeConfig({ ...baseConfig, runsRoot }), /runsRoot must not be inside test-kit\/inputs/, runsRoot);
  }
  assert.equal(normalizeConfig({ ...baseConfig, runsRoot: 'test-kit/inputs-old' }).runsRoot, 'test-kit/inputs-old');
  assert.equal(normalizeConfig(baseConfig).runsRoot, 'test-kit/runs');
});

test('--store must not be inside test-kit/inputs (R12.6)', () => {
  const config = join(tmpdir(), 'p', 'test-kit.config.json');
  for (const store of ['test-kit/inputs', 'test-kit/inputs/store']) assert.throws(() => resolveStore({ config, store }), /The store must not be inside inputs\//, store);
  assert.equal(resolveStore({ config, store: 'test-kit-other' }), join(tmpdir(), 'p', 'test-kit-other'));
});

test('a file under test-kit/inputs survives run, before, after, report, history and every viewer refresh (R12.6)', async t => {
  const f = await project(t);
  await seedInputs(f.inputs);
  const before = await snapshot(f.inputs);
  let count = 0;
  const dependencies = {
    summarizeRunFeedback: async () => ({ state: 'complete' }),
    capture: async input => {
      const id = `2026-01-0${++count}T00-00-00-000Z-1-abcdef1`;
      await mkdir(join(f.store, 'runs', id), { recursive: true });
      await writeFile(join(f.store, 'runs', id, 'run.json'), JSON.stringify({ at: `2026-01-0${count}T00:00:00.000Z`, side: input.side, settingsHash: 'sha256:' + 'a'.repeat(64), state: 'complete', settings: { targets: [{ id: 'home' }] } }));
      return { run: { id, state: 'complete' }, manifestPath: join(f.store, 'runs', id, 'run.json') };
    },
    compareRuns: async input => {
      await mkdir(input.outputDir, { recursive: true });
      const report = { schemaVersion: 2, meta: { generated: '2026-01-03T00:00:00.000Z', matchBelow: 3, viewports: [{ id: 'desktop' }] }, runs: [{ id: input.runA }, { id: input.runB }], pair: { kind: input.kind, aRunId: input.runA, bRunId: input.runB }, entries: [{ id: 'home', viewports: [{ id: 'desktop', ratio: 0, state: 'complete', artifacts: {} }] }], causes: [], findings: [], rules: {} };
      await writeFile(join(input.outputDir, 'report.json'), JSON.stringify(report));
      return { reportPath: join(input.outputDir, 'report.json') };
    },
    serve: async () => ({ origin: 'http://127.0.0.1:1' }),
    exportReport: async input => ({ outputPath: input.outputDir, files: [] }),
  };
  const options = { config: f.configPath };
  for (const command of ['run', 'before', 'after', 'report']) {
    const result = await runWorkflow(command, options, dependencies);
    assert.equal(result.exitCode, 0, command);
    assert.equal((result.stderr ?? []).some(line => /viewer was not/.test(line)), false, `${command}: ${result.stderr}`);
  }
  // The store viewer lists the runs and reports of the store only. The look-alike files under inputs/ stay out.
  const index = JSON.parse(await readFile(join(f.store, 'index.json'), 'utf8'));
  assert.equal(index.runs.length, 3);
  assert.equal(index.reports.length, 1);
  assert.equal(JSON.stringify(index).includes(INPUTS_DIR), false);
  assert.deepEqual((await refreshStoreViewer({ store: f.store })).warnings ?? [], []);

  const published = await dispatch({ command: 'history', positions: [], options: { config: f.configPath, publish: 'site' } });
  assert.equal(published.output.reportCount, 1);
  assert.equal((await readdir(join(f.root, 'site'))).includes(INPUTS_DIR), false);
  const pruned = await dispatch({ command: 'history', positions: [], options: { config: f.configPath, prune: true, keep: 1, yes: true } });
  assert.equal(pruned.exitCode ?? 0, 0);

  assert.deepEqual(await snapshot(f.inputs), before);
});

test('dispatch refuses --export, --publish and --output inside inputs/ before it writes anything (R12.6)', async t => {
  const f = await project(t);
  const cases = [
    ['history', [], { export: 'test-kit/inputs/export' }, /--export must not be inside inputs\//],
    ['history', [], { publish: 'test-kit/inputs/site' }, /--publish must not be inside inputs\//],
    ['report', [], { export: 'test-kit/Inputs/r' }, /--export must not be inside inputs\//],
    ['diff', ['a', 'b'], { output: 'test-kit/inputs/diff' }, /--output must not be inside inputs\//],
    ['history', [], { store: 'old-store', export: 'old-store/inputs/x' }, /--export must not be inside inputs\//],
  ];
  for (const [command, positions, extra, pattern] of cases) {
    await assert.rejects(dispatch({ command, positions, options: { config: f.configPath, ...extra } }), pattern, `${command} ${JSON.stringify(extra)}`);
  }
  assert.deepEqual(await readdir(f.root), ['test-kit.config.json']);
});

test('import reads a files side whose root is under test-kit/inputs and keeps the escape checks (R5.5, R12.6)', async t => {
  const config = { ...baseConfig,
    sides: { design: { kind: 'design', provider: 'files', root: 'test-kit/inputs/design' }, local: { origin: 'http://127.0.0.1:8000' } },
    targets: [{ id: 'hero', kind: 'component', path: '/hero', design: { desktop: 'hero/desktop.png' } }] };
  const f = await project(t, config);
  await seedInputs(f.inputs);
  const before = await snapshot(f.inputs);
  const { run, runDir } = await importDesign({ configPath: f.configPath, side: 'design' });
  assert.equal(run.state, 'complete');
  assert.equal(run.captures.length, 1);
  assert.equal(relative(f.store, runDir).split('/')[0], 'runs');
  assert.deepEqual(await snapshot(f.inputs), before);

  const root = join(f.inputs, 'design');
  await writeFile(join(f.root, 'outside.png'), png(40, 20));
  await assert.rejects(readDesignFile(root, '../../../outside.png'), /Design path/);
  await symlink(join(f.root, 'outside.png'), join(root, 'link.png'));
  await assert.rejects(readDesignFile(root, 'link.png'), /escapes its root/);
  await symlink(f.store, join(root, 'store'));
  await assert.rejects(readDesignFile(root, 'store/inputs/crops/home-desktop.png'), /escapes its root/);
});
