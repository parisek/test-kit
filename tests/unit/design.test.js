import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { normalizeConfig, settingsHash } from '../../src/config/index.js';
import { screenshotScope, settleRecipe } from '../../src/config/settings.js';
import { designPathProblem, designRootProblem } from '../../src/design/paths.js';
import { readPngSize, expectedWidth, widthProblem, designProvenance, sha256 } from '../../src/design/png.js';
import { isDesignRun, designPairProblem } from '../../src/design/compare.js';
import { readDesignFile, importDesign } from '../../src/design/import.js';
import { comparisonState, compareRuns } from '../../src/compare/runs.js';
import { summarizeReport } from '../../src/query/summary.js';
import { parseCommand } from '../../src/cli/run.js';
import { capture } from '../../src/capture/index.js';
import { planPerfCommand } from '../../src/perf/plan.js';

function png(width, height, [r, g, b]) {
  const image = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) { image.data[i * 4] = r; image.data[i * 4 + 1] = g; image.data[i * 4 + 2] = b; image.data[i * 4 + 3] = 255; }
  return PNG.sync.write(image);
}
const designConfig = () => ({ schemaVersion: 1,
  sides: { design: { kind: 'design', provider: 'files', root: 'design-refs' }, local: { origin: 'http://localhost:8080' } },
  targets: [
    { id: 'hero', kind: 'component', path: '/hero', design: { desktop: 'hero/desktop.png', mobile: 'hero/mobile.png' } },
    { id: 'card', kind: 'component', path: '/card', design: { desktop: 'card/desktop.png' } },
  ],
  viewports: [{ id: 'desktop', width: 40, height: 30 }, { id: 'mobile', width: 20, height: 30 }], runsRoot: 'runs' });

test('design paths: a plain relative PNG path passes, every other form fails (R8.15)', () => {
  for (const ok of ['a.png', 'hero/desktop-1280.png', 'a_b/c.d/e-f.png', 'x/.png'.replace('/.', '/a.')]) assert.equal(designPathProblem(ok), null, ok);
  const bad = ['', '/etc/a.png', '../a.png', 'a/../b.png', 'a/./b.png', 'a//b.png', './a.png', 'a\\b.png', 'C:/a.png', 'a.PNG', 'a.jpg', 'a.png ', 'a\u0000.png', 'a/b/', '.hidden.png', `${'a/'.repeat(200)}a.png`, 7, null, undefined, {}];
  for (const value of bad) assert.notEqual(designPathProblem(value), null, JSON.stringify(value));
});

test('design root: a plain relative directory (R8.15)', () => {
  for (const ok of ['design-refs', 'a/b', 'a.b']) assert.equal(designRootProblem(ok), null);
  for (const bad of ['', '/abs', '../x', 'a/../b', '.', 'a//b', 'a\\b', 5]) assert.notEqual(designRootProblem(bad), null, String(bad));
});

test('config: a design side and a design map normalize, and the result is frozen (R8.15)', () => {
  const config = normalizeConfig(designConfig());
  assert.deepEqual(config.sides.design, { kind: 'design', provider: 'files', root: 'design-refs' });
  assert.deepEqual(config.targets[0].design, { desktop: 'hero/desktop.png', mobile: 'hero/mobile.png' });
  assert.throws(() => { config.targets[0].design.desktop = 'x.png'; }, TypeError);
});

test('config: a design side has no origin and no browser keys, and only a known provider (R8.15)', () => {
  const side = extra => ({ ...designConfig(), sides: { design: { kind: 'design', provider: 'files', root: 'refs', ...extra }, local: { origin: 'http://localhost:8080' } } });
  assert.throws(() => normalizeConfig(side({ origin: 'http://localhost:8080' })), /origin is unsupported/);
  assert.throws(() => normalizeConfig(side({ remote: true })), /remote is unsupported/);
  assert.throws(() => normalizeConfig(side({ provider: 'other' })), /provider must be "files", "figma" or "claude-design"/);
  assert.throws(() => normalizeConfig(side({ provider: undefined })), /provider must be "files", "figma" or "claude-design"/);
  assert.throws(() => normalizeConfig(side({ root: undefined })), /root/);
  assert.throws(() => normalizeConfig(side({ root: '../outside' })), /root must be a plain relative path/);
  assert.throws(() => normalizeConfig(side({ root: '/abs' })), /root must be a plain relative path/);
  assert.throws(() => normalizeConfig(side({ kind: 'browser' })), /kind must be "design"/);
});

test('config: target.design is checked (R8.15)', () => {
  const withMap = design => ({ ...designConfig(), targets: [{ id: 'hero', kind: 'component', path: '/hero', design }] });
  assert.throws(() => normalizeConfig(withMap({ desktop: '../a.png' })), /target\.design\.desktop must be a plain relative path/);
  assert.throws(() => normalizeConfig(withMap({ desktop: '/a.png' })), /target\.design\.desktop must be relative/);
  assert.throws(() => normalizeConfig(withMap({ desktop: 'a.jpg' })), /must end in "\.png"/);
  assert.throws(() => normalizeConfig(withMap({ tablet: 'a.png' })), /unknown viewport tablet/);
  assert.throws(() => normalizeConfig(withMap({})), /1\.\.20 entries/);
  assert.throws(() => normalizeConfig(withMap([])), /must be an object/);
  const browserOnly = { ...designConfig(), sides: { local: { origin: 'http://localhost:8080' } } };
  assert.throws(() => normalizeConfig(browserOnly), /needs a side of kind "design"/);
});

test('config: a design side needs no target path, and targetSource refuses it (R8.15)', () => {
  const config = { ...designConfig(), targets: [{ id: 'hero', kind: 'component', path: '/hero', design: { desktop: 'a.png' } }] };
  assert.ok(normalizeConfig(config));
  const noPath = { ...designConfig(), sides: { local: { origin: 'http://localhost:8080' }, design: { kind: 'design', provider: 'files', root: 'r' } }, targets: [{ id: 'hero', kind: 'component' }] };
  assert.throws(() => normalizeConfig(noPath), /has no path for local/);
  assert.throws(() => normalizeConfig({ ...designConfig(), targets: undefined, targetSource: { source: 'styleguide', side: 'design' } }), /must be a local side/);
});

test('config: a config without a design side is unchanged (R5.1)', () => {
  const browser = { schemaVersion: 1, sides: { local: { origin: 'http://localhost:8080' } }, targets: [{ id: 'home', kind: 'page', path: '/' }], viewports: [{ id: 'small', width: 10, height: 10 }] };
  const result = normalizeConfig(browser);
  assert.deepEqual(Object.keys(result.targets[0]), ['id', 'kind', 'title', 'path']);
  assert.deepEqual(Object.keys(result.sides.local), ['origin', 'settle']);
});

test('png: the size comes from the header, and a non-PNG or an oversize image fails', () => {
  assert.deepEqual(readPngSize(png(7, 5, [0, 0, 0])), { width: 7, height: 5 });
  assert.throws(() => readPngSize(Buffer.from('not a png file at all, but long enough to pass the length check')), /must be a PNG/);
  assert.throws(() => readPngSize(Buffer.alloc(10)), /must be a PNG/);
  const huge = png(4, 4, [0, 0, 0]);
  huge.writeUInt32BE(40000, 20);
  assert.throws(() => readPngSize(huge), /limit/);
});

test('size check: the width is the viewport width times the device scale, and both sizes are named (R8.15)', () => {
  assert.equal(expectedWidth({ width: 1280 }), 1280);
  assert.equal(expectedWidth({ width: 390, deviceScaleFactor: 2 }), 780);
  assert.equal(widthProblem({ id: 'd', width: 1280, deviceScaleFactor: 1 }, 1280), null);
  const text = widthProblem({ id: 'mobile-390', width: 390, deviceScaleFactor: 2 }, 390);
  assert.match(text, /390 px wide/);
  assert.match(text, /needs 780 px/);
  assert.match(text, /mobile-390/);
});

test('provenance: provider, source, time, hash and size (R8.15)', () => {
  const bytes = png(3, 2, [9, 9, 9]);
  const entry = designProvenance({ source: 'hero/desktop.png', importedAt: '2026-11-05T10:00:00.000Z', bytes });
  assert.deepEqual(entry, { provider: 'files', source: 'hero/desktop.png', importedAt: '2026-11-05T10:00:00.000Z', sha256: sha256(bytes), width: 3, height: 2 });
  assert.match(entry.sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(sha256(png(3, 2, [9, 9, 8])), entry.sha256);
});

test('design pair: only the viewport and the image width decide, not the browser settings (R8.15)', () => {
  const viewports = [{ id: 'desktop', width: 40, height: 30, deviceScaleFactor: 1 }];
  const designRun = { side: 'design', settings: { sides: { design: { kind: 'design', provider: 'files', root: 'r' } }, viewports }, settingsHash: 'sha256:a', tools: [{ name: 'test-kit-design', version: '1', settingsHash: 'sha256:a' }] };
  const browserRun = { side: 'local', settings: { sides: { local: { origin: 'http://localhost' } }, viewports }, settingsHash: 'sha256:b', tools: [{ name: 'playwright', version: '1', settingsHash: 'sha256:b' }] };
  assert.equal(isDesignRun(designRun), true);
  assert.equal(isDesignRun(browserRun), false);
  const good = { targetId: 't', viewportId: 'desktop', state: 'captured', design: { width: 40 } };
  const shot = { targetId: 't', viewportId: 'desktop', state: 'captured' };
  assert.equal(comparisonState(good, shot, designRun, browserRun), 'complete');
  assert.equal(comparisonState(null, shot, designRun, browserRun), 'missing');
  assert.equal(comparisonState({ ...good, state: 'failed' }, shot, designRun, browserRun), 'failed');
  assert.equal(comparisonState({ ...good, design: { width: 41 } }, shot, designRun, browserRun), 'incompatible');
  assert.match(designPairProblem(designRun, browserRun, { ...good, design: { width: 41 } }, shot), /41 px wide.*needs 40 px/);
  const wider = { ...browserRun, settings: { ...browserRun.settings, viewports: [{ ...viewports[0], width: 50 }] } };
  assert.equal(comparisonState(good, shot, designRun, wider), 'incompatible');
  assert.match(designPairProblem(designRun, wider, good, shot), /Viewport desktop differs/);
});

async function project() {
  const dir = await mkdtemp(join(tmpdir(), 'test-kit-design-'));
  await mkdir(join(dir, 'design-refs/hero'), { recursive: true });
  await mkdir(join(dir, 'design-refs/card'), { recursive: true });
  return dir;
}

test('readDesignFile: reads a file under the root, refuses every escape (R8.15)', async () => {
  const dir = await project();
  try {
    const root = join(dir, 'design-refs');
    await writeFile(join(root, 'hero/desktop.png'), png(2, 2, [1, 2, 3]));
    assert.equal((await readDesignFile(root, 'hero/desktop.png')).length > 0, true);
    await writeFile(join(dir, 'outside.png'), png(2, 2, [1, 2, 3]));
    for (const source of ['../outside.png', '/etc/passwd', 'hero/../../outside.png', 'hero\\desktop.png']) await assert.rejects(readDesignFile(root, source), /Design path/);
    await symlink(join(dir, 'outside.png'), join(root, 'link.png'));
    await assert.rejects(readDesignFile(root, 'link.png'), /escapes its root/);
    await symlink(dir, join(root, 'linked-dir'));
    await assert.rejects(readDesignFile(root, 'linked-dir/outside.png'), /escapes its root/);
    await assert.rejects(readDesignFile(root, 'hero/missing.png'), /is missing/);
    await mkdir(join(root, 'dir.png'));
    await assert.rejects(readDesignFile(root, 'dir.png'), /not a regular file/);
    await assert.rejects(readDesignFile(join(dir, 'no-root'), 'a.png'), /root does not exist/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('import: writes an immutable run with provenance per image, and no run when a file fails (R8.15)', async () => {
  const dir = await project();
  try {
    const configPath = join(dir, 'config.json');
    await writeFile(configPath, JSON.stringify(designConfig()));
    await writeFile(join(dir, 'design-refs/hero/desktop.png'), png(40, 20, [1, 2, 3]));
    await writeFile(join(dir, 'design-refs/hero/mobile.png'), png(20, 20, [1, 2, 3]));
    await writeFile(join(dir, 'design-refs/card/desktop.png'), png(40, 20, [5, 5, 5]));
    const { run, runDir } = await importDesign({ configPath, side: 'design', label: 'refs' });
    assert.equal(run.state, 'complete');
    assert.equal(run.side, 'design');
    assert.equal(run.captures.length, 3);
    assert.deepEqual(run.settings.artifacts, ['screenshot']);
    assert.equal(run.settingsHash, settingsHash({ provider: 'files', viewports: run.settings.viewports }));
    const hero = run.captures.find(row => row.targetId === 'hero' && row.viewportId === 'desktop');
    const bytes = await readFile(join(runDir, hero.path));
    assert.equal(hero.design.sha256, sha256(bytes));
    assert.deepEqual({ ...hero.design, importedAt: undefined, sha256: undefined }, { provider: 'files', source: 'hero/desktop.png', importedAt: undefined, sha256: undefined, width: 40, height: 20 });
    assert.equal(hero.design.importedAt, run.at);
    assert.deepEqual(JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8')), JSON.parse(JSON.stringify(run)));
    assert.equal(run.captures.some(row => row.targetId === 'card' && row.viewportId === 'mobile'), false, 'An unmapped viewport has no capture.');

    // A selection imports only the selected cells and records them.
    const part = await importDesign({ configPath, side: 'design', targets: ['card'] });
    assert.deepEqual(part.run.selection, { targets: ['card'] });
    assert.equal(part.run.captures.length, 1);
    await assert.rejects(importDesign({ configPath, side: 'design', targets: ['card'], viewports: ['mobile'] }), /No design image to import/);

    // One bad file fails the import and leaves no new run directory.
    const before = (await readdir(join(dir, 'runs'))).length;
    await writeFile(join(dir, 'design-refs/card/desktop.png'), 'not a png, but long enough to look like a file to the length check');
    await assert.rejects(importDesign({ configPath, side: 'design' }), /must be a PNG file\. \(card\/desktop\.png\)/);
    assert.equal((await readdir(join(dir, 'runs'))).length, before);
    await rm(join(dir, 'design-refs/card/desktop.png'));
    await assert.rejects(importDesign({ configPath, side: 'design' }), /Design image is missing: card\/desktop\.png/);
    assert.equal((await readdir(join(dir, 'runs'))).length, before);
    await assert.rejects(importDesign({ configPath, side: 'local' }), /not a design side/);
    await assert.rejects(importDesign({ configPath, side: 'nope' }), /Unknown side/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// A captured run made by hand, so the test needs no browser. It has the shape that `capture` writes.
async function fakeCapture(dir, config, images) {
  const id = '2026-11-05T10-00-00-000Z-1-abcdef1';
  const runDir = join(dir, 'runs', id);
  const captures = [];
  for (const [target, viewport, [width, height, color]] of images) {
    const path = `screenshots/${target}/${viewport}.png`;
    await mkdir(join(runDir, `screenshots/${target}`), { recursive: true });
    await writeFile(join(runDir, path), png(width, height, color));
    const row = config.targets.find(item => item.id === target);
    captures.push({ targetId: target, viewportId: viewport, settleHash: settingsHash(settleRecipe(config, 'local', row)), scopeHash: settingsHash(screenshotScope(row, 'local')), state: 'captured', path, statusCode: 200, finalPath: '/', width, height, deviceScaleFactor: 1, artifacts: {} });
  }
  const run = { schemaVersion: 2, id, side: 'local', label: 'browser', at: '2026-11-05T10:00:00.000Z', state: 'complete', settings: config, settingsHash: 'sha256:abc',
    captureSettings: {}, tools: [{ name: 'playwright', version: '1.0.0', settingsHash: 'sha256:abc' }], captures };
  await writeFile(join(runDir, 'run.json'), JSON.stringify(run));
  return id;
}

test('diff: match, changed, missing viewport and wrong size read as set (R8.7, R8.15)', async () => {
  const dir = await project();
  try {
    const configPath = join(dir, 'config.json');
    const input = designConfig();
    input.targets.push({ id: 'tag', kind: 'component', path: '/tag', design: { desktop: 'tag/desktop.png' } });
    await mkdir(join(dir, 'design-refs/tag'), { recursive: true });
    await writeFile(configPath, JSON.stringify(input));
    // hero desktop: same image. hero mobile: 25 px wide, the viewport needs 20. card desktop: other colour. card mobile: no mapping.
    await writeFile(join(dir, 'design-refs/hero/desktop.png'), png(40, 20, [1, 2, 3]));
    await writeFile(join(dir, 'design-refs/hero/mobile.png'), png(25, 20, [1, 2, 3]));
    await writeFile(join(dir, 'design-refs/card/desktop.png'), png(40, 20, [200, 0, 0]));
    await writeFile(join(dir, 'design-refs/tag/desktop.png'), png(40, 20, [9, 9, 9]));
    const design = await importDesign({ configPath, side: 'design', label: 'refs' });
    const config = normalizeConfig(input);
    const id = await fakeCapture(dir, config, [
      ['hero', 'desktop', [40, 20, [1, 2, 3]]], ['hero', 'mobile', [20, 20, [1, 2, 3]]],
      ['card', 'desktop', [40, 20, [0, 0, 200]]], ['card', 'mobile', [20, 20, [0, 0, 200]]],
      ['tag', 'desktop', [40, 20, [9, 9, 9]]], ['tag', 'mobile', [20, 20, [9, 9, 9]]],
    ]);
    const outputDir = join(dir, 'report');
    const { report, reportPath } = await compareRuns({ runsRoot: join(dir, 'runs'), runA: design.run.id, runB: id, outputDir });
    assert.equal(report.pair.kind, 'convergence', 'A pair with a design run defaults to convergence.');
    const cell = (target, viewport) => report.entries.find(entry => entry.id === target).viewports.find(row => row.id === viewport);
    assert.equal(cell('hero', 'desktop').state, 'complete');
    assert.equal(cell('hero', 'desktop').ratio, 0);
    assert.equal(report.findings.some(finding => finding.targetId === 'hero' && finding.viewportId === 'desktop'), false, 'A matching image has no finding.');
    assert.equal(cell('hero', 'mobile').state, 'incompatible');
    assert.match(cell('hero', 'mobile').diagnostic, /25 px wide.*needs 20 px/);
    assert.equal(cell('card', 'desktop').state, 'complete');
    assert.ok(cell('card', 'desktop').ratio > 0);
    assert.ok(report.findings.some(finding => finding.targetId === 'card' && finding.viewportId === 'desktop' && finding.artifact === 'screenshot'));
    assert.ok(cell('card', 'desktop').artifacts.screenshot.diff.regions.length > 0, 'The report leads with regions.');
    assert.equal(cell('card', 'mobile').state, 'missing', 'A viewport with no mapped image is missing, never match.');
    assert.equal(cell('tag', 'mobile').state, 'missing');
    const summary = summarizeReport(JSON.parse(await readFile(reportPath, 'utf8')), { maxTargets: 20, filter: 'all' });
    assert.equal(summary.counts.match, 0, 'No target with a missing or incompatible cell reads match.');
    assert.equal(summary.verdict, 'incomplete');

    // The image must keep the hash recorded at import.
    await writeFile(join(design.runDir, 'screenshots/tag/desktop.png'), png(40, 20, [8, 8, 8]));
    const changed = await compareRuns({ runsRoot: join(dir, 'runs'), runA: design.run.id, runB: id, outputDir: join(dir, 'report2'), filter: { targets: ['tag'], viewports: ['desktop'] } });
    assert.equal(changed.report.entries[0].viewports[0].state, 'failed');
    assert.match(changed.report.entries[0].viewports[0].diagnostic, /changed after import/);

    // A kind the caller names is kept.
    const named = await compareRuns({ runsRoot: join(dir, 'runs'), runA: design.run.id, runB: id, outputDir: join(dir, 'report3'), kind: 'adhoc', filter: { targets: ['hero'], viewports: ['desktop'] } });
    assert.equal(named.report.pair.kind, 'adhoc');

    // R3.12: a drift pair is two imports of one design side. It holds no other pair, and a refused pair writes nothing.
    await writeFile(join(design.runDir, 'screenshots/tag/desktop.png'), png(40, 20, [9, 9, 9]));
    await new Promise(done => setTimeout(done, 5));
    const second = await importDesign({ configPath, side: 'design', label: 'refs 2' });
    const drift = await compareRuns({ runsRoot: join(dir, 'runs'), runA: design.run.id, runB: second.run.id, outputDir: join(dir, 'drift'), kind: 'drift' });
    assert.equal(drift.report.pair.kind, 'drift');
    const plain = await compareRuns({ runsRoot: join(dir, 'runs'), runA: design.run.id, runB: second.run.id, outputDir: join(dir, 'plain') });
    assert.equal(plain.report.pair.kind, 'convergence', 'Without --kind a pair of two design runs keeps the kind of R8.15.');
    await assert.rejects(compareRuns({ runsRoot: join(dir, 'runs'), runA: design.run.id, runB: id, outputDir: join(dir, 'not-drift'), kind: 'drift' }), /two design runs of the same design side/);
    await assert.rejects(readFile(join(dir, 'not-drift', 'report.json')));
    assert.equal(parseCommand(['diff', 'a', 'b', '--output', 'o', '--kind', 'drift']).options.kind, 'drift');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// R3.12: each refusal of a drift pair has its own case. A refused pair creates no output directory.
test('diff --kind drift refuses two design sides, a browser run and the reversed order (R3.12)', async () => {
  const dir = await project();
  try {
    const configPath = join(dir, 'config.json');
    const input = designConfig();
    input.sides.other = { kind: 'design', provider: 'files', root: 'design-refs' };
    await writeFile(configPath, JSON.stringify(input));
    await writeFile(join(dir, 'design-refs/hero/desktop.png'), png(40, 20, [1, 2, 3]));
    await writeFile(join(dir, 'design-refs/hero/mobile.png'), png(20, 20, [1, 2, 3]));
    await writeFile(join(dir, 'design-refs/card/desktop.png'), png(40, 20, [4, 5, 6]));
    const pause = () => new Promise(done => setTimeout(done, 5));
    const first = await importDesign({ configPath, side: 'design', label: 'first' });
    await pause();
    const later = await importDesign({ configPath, side: 'design', label: 'later' });
    await pause();
    const other = await importDesign({ configPath, side: 'other', label: 'other' });
    const browser = await fakeCapture(dir, normalizeConfig(input), [['hero', 'desktop', [40, 20, [1, 2, 3]]]]);
    const runsRoot = join(dir, 'runs');
    const refused = async (runA, runB, name, pattern) => {
      const outputDir = join(dir, name);
      await assert.rejects(compareRuns({ runsRoot, runA, runB, outputDir, kind: 'drift' }), pattern);
      await assert.rejects(readdir(outputDir), { code: 'ENOENT' }, `${name}: no output directory exists`);
    };
    const sides = /two design runs of the same design side/;
    await refused(first.run.id, other.run.id, 'two-sides', sides);
    await refused(first.run.id, browser, 'browser-b', sides);
    await refused(browser, first.run.id, 'browser-a', sides);
    // The reversed order names both runs and both times.
    const at = run => new Date(run.run.at).toISOString();
    const reversed = new RegExp(`earlier import as run A\\. Run A ${later.run.id} is from ${at(later).replace(/\./g, '\\.')} and run B ${first.run.id} is from ${at(first).replace(/\./g, '\\.')}`);
    await refused(later.run.id, first.run.id, 'reversed', reversed);
    // The same time is not an order. A run without a valid time has no order.
    const stored = join(runsRoot, later.run.id, 'run.json');
    const run = JSON.parse(await readFile(stored, 'utf8'));
    await writeFile(stored, JSON.stringify({ ...run, at: first.run.at }));
    await refused(first.run.id, later.run.id, 'same-time', /earlier import as run A/);
    await writeFile(stored, JSON.stringify({ ...run, at: 'not a time' }));
    await refused(first.run.id, later.run.id, 'no-time', new RegExp(`Run ${later.run.id} has no valid time`));
    // The right order passes.
    await writeFile(stored, JSON.stringify(run));
    const drift = await compareRuns({ runsRoot, runA: first.run.id, runB: later.run.id, outputDir: join(dir, 'drift'), kind: 'drift' });
    assert.equal(drift.report.pair.kind, 'drift');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('cli: import takes --side and the selection flags only (R8.15)', () => {
  assert.deepEqual(parseCommand(['import', '--side', 'design', '--target', 'hero', '--viewport', 'desktop']).options, { side: 'design', target: 'hero', viewport: 'desktop' });
  assert.throws(() => parseCommand(['import']), /import requires --side/);
  assert.throws(() => parseCommand(['import', '--side', 'design', '--artifacts', 'html']), /Unknown option/);
  assert.throws(() => parseCommand(['import', '--side', 'design', '--target', '../x']), /Invalid target selection/);
  assert.throws(() => parseCommand(['import', '--side', 'design', 'extra']), /positional/);
});

test('capture and perf refuse a design side with a clear message (R4.6)', async () => {
  const dir = await project();
  try {
    const configPath = join(dir, 'config.json');
    await writeFile(configPath, JSON.stringify(designConfig()));
    await assert.rejects(capture({ configPath, side: 'design' }), /design side\. Use import/);
    const page = { ...designConfig(), targets: [{ id: 'home', kind: 'page', path: '/' }] };
    assert.throws(() => planPerfCommand(normalizeConfig(page), { side: 'design', targetIds: ['home'] }), /needs a browser side/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
