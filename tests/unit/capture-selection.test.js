import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, unlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { parseIdList, recordSelection, validateSelection, cellSelected } from '../../src/capture/selection.js';
import { parseCommand } from '../../src/cli/run.js';
import { compareRuns } from '../../src/compare/runs.js';
import { summarizeReport } from '../../src/query/summary.js';
import { validateReport } from '../../src/report/model.js';
import { normalizeConfig } from '../../src/config/index.js';
import { captureSettings, contentSettings, responseSettings, settingsHash } from '../../src/config/settings.js';

const settings = {
  targets: [{ id: 'home', kind: 'page', path: '/' }, { id: 'about', kind: 'page', path: '/about' }, { id: 'blog', kind: 'page', path: '/blog' }],
  viewports: [{ id: 'mobile', width: 390, height: 800, deviceScaleFactor: 1 }, { id: 'desktop', width: 1280, height: 800, deviceScaleFactor: 1 }],
};

test('parseIdList accepts safe unique ids and rejects the rest', () => {
  assert.deepEqual(parseIdList('home,about', 'target'), ['home', 'about']);
  for (const bad of ['', 'a,,b', 'a,a', '-a', 'a b', 'a/b', 'x'.repeat(65)]) assert.throws(() => parseIdList(bad, 'target'), /Invalid target selection/);
});

test('recordSelection keeps configuration order, omits unselected axes, and checks ids', () => {
  assert.equal(recordSelection(settings, {}), null);
  assert.equal(recordSelection(settings, { targets: undefined, viewports: undefined }), null);
  assert.deepEqual(recordSelection(settings, { targets: ['blog', 'home'] }), { targets: ['home', 'blog'] });
  assert.deepEqual(recordSelection(settings, { targets: ['about'], viewports: ['desktop'] }), { targets: ['about'], viewports: ['desktop'] });
  assert.throws(() => recordSelection(settings, { targets: ['nope'] }), /Unknown target/);
  assert.throws(() => recordSelection(settings, { viewports: ['nope'] }), /Unknown viewport/);
  assert.throws(() => recordSelection(settings, { targets: [] }), /Invalid target selection/);
  assert.throws(() => recordSelection(settings, { targets: ['home', 'home'] }), /Invalid target selection/);
});

test('validateSelection rejects a bad record', () => {
  assert.deepEqual(validateSelection({ targets: ['home'] }, settings), { targets: ['home'] });
  for (const bad of [null, [], 'x', {}, { targets: [] }, { targets: ['home', 'home'] }, { targets: ['nope'] }, { targets: 'home' }, { viewports: ['home'] }, { other: ['home'] }, { targets: ['bad id'] },
    { targets: Array.from({ length: 1001 }, (_, index) => `t${index}`) }]) assert.throws(() => validateSelection(bad, settings), /Invalid stored selection/);
});

test('cellSelected treats no selection as every cell', () => {
  assert.equal(cellSelected(undefined, 'home', 'mobile'), true);
  assert.equal(cellSelected(null, 'home', 'mobile'), true);
  assert.equal(cellSelected({ targets: ['home'] }, 'home', 'desktop'), true);
  assert.equal(cellSelected({ targets: ['home'] }, 'about', 'desktop'), false);
  assert.equal(cellSelected({ viewports: ['mobile'] }, 'about', 'desktop'), false);
  assert.equal(cellSelected({ targets: ['home'], viewports: ['mobile'] }, 'home', 'mobile'), true);
});

test('a selection changes no settings hash for any artifact (screenshot, content, response)', () => {
  const config = normalizeConfig({ schemaVersion: 1, sides: { local: { origin: 'http://127.0.0.1:8080' } }, targets: settings.targets, viewports: settings.viewports, artifacts: ['screenshot', 'html', 'status', 'content'] });
  const before = structuredClone(config);
  const hashes = () => ({
    screenshot: settingsHash(captureSettings(config, 'local')), content: settingsHash(contentSettings(config, 'local', config.targets[0])),
    html: settingsHash(responseSettings(config, 'html')), status: settingsHash(responseSettings(config, 'status')),
  });
  const full = hashes();
  const selection = recordSelection(config, { targets: ['about'], viewports: ['desktop'] });
  assert.deepEqual(selection, { targets: ['about'], viewports: ['desktop'] });
  assert.deepEqual(config, before, 'recordSelection does not change the configuration');
  assert.deepEqual(hashes(), full);
});

test('capture and diff take --target and --viewport; the lists are checked at parse time', () => {
  const capture = parseCommand(['capture', '--side', 'local', '--target', 'home,about', '--viewport', 'mobile']);
  assert.equal(capture.options.target, 'home,about');
  assert.equal(capture.options.viewport, 'mobile');
  const diff = parseCommand(['diff', 'a', 'b', '--output', 'out', '--target', 'home']);
  assert.equal(diff.options.target, 'home');
  for (const command of [['capture', '--side', 'local'], ['diff', 'a', 'b', '--output', 'out']]) {
    assert.throws(() => parseCommand([...command, '--target', 'a,a']), /Invalid target selection/);
    assert.throws(() => parseCommand([...command, '--viewport', 'bad id']), /Invalid viewport selection/);
    assert.throws(() => parseCommand([...command, '--target', 'a', '--target', 'b']), /Duplicate option/);
  }
  assert.throws(() => parseCommand(['summary', 'report.json', '--viewport', 'mobile']), /Unknown option/);
});

// A comparison on disk: two runs with PNG captures. No browser.
function png(color) {
  const image = new PNG({ width: 4, height: 4 });
  for (let index = 0; index < image.data.length; index += 4) image.data.set([color, 0, 0, 255], index);
  return PNG.sync.write(image);
}
async function writeRun(root, id, { side, selection, drop = [], hash = 'sha256:' + 'a'.repeat(64), cells, colors = {}, targetList = settings.targets }) {
  const config = { schemaVersion: 1, sides: { a: { origin: 'http://127.0.0.1:1', settle: {} }, b: { origin: 'http://127.0.0.1:2', settle: {} } }, targets: targetList, viewports: settings.viewports, screenshot: { fullPage: true, timeoutMs: 30000 }, artifacts: ['screenshot'] };
  const captures = [];
  for (const target of cells ?? targetList.map(item => item.id)) for (const viewport of settings.viewports) {
    if (selection && !cellSelected(selection, target, viewport.id)) continue;
    if (drop.some(([t, v]) => t === target && v === viewport.id)) continue;
    const path = `screenshots/${target}/${viewport.id}.png`;
    await mkdir(join(root, id, 'screenshots', target), { recursive: true });
    await writeFile(join(root, id, path), png(colors[`${target}/${viewport.id}`] ?? 10));
    captures.push({ targetId: target, viewportId: viewport.id, state: 'captured', path, statusCode: 200, finalPath: '/' });
  }
  const run = { schemaVersion: 2, id, side, label: id, at: '2026-11-05T10:00:00.000Z', state: 'complete', settings: config, settingsHash: hash,
    tools: [{ name: 'playwright', version: '1', settingsHash: hash }], captures, ...(selection ? { selection } : {}) };
  await writeFile(join(root, id, 'run.json'), JSON.stringify(run));
  return run;
}
async function fixture(fn) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tk-selection-')));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const diff = (root, a, b, extra = {}) => compareRuns({ runsRoot: root, runA: a, runB: b, outputDir: join(root, `out-${a}-${b}-${Math.random().toString(36).slice(2)}`), ...extra });
const cells = report => report.entries.flatMap(entry => entry.viewports.map(row => `${entry.id}/${row.id}`));

test('a full run and a selected run compare only the selected cells and count the skipped ones', async () => fixture(async root => {
  await writeRun(root, 'full', { side: 'a' });
  await writeRun(root, 'part', { side: 'b', selection: { targets: ['about'] } });
  const { report } = await diff(root, 'full', 'part');
  assert.deepEqual(cells(report), ['about/mobile', 'about/desktop']);
  assert.ok(report.entries.every(entry => entry.viewports.every(row => row.state === 'complete')));
  assert.equal(report.meta.skipped, 4);
  assert.deepEqual(report.meta.scope, { a: null, b: { targets: ['about'] }, filter: null });
  assert.deepEqual(validateReport(report), []);
  assert.equal(summarizeReport(report).verdict, 'match');
  assert.equal(summarizeReport(report).skipped, 4);
}));

test('a viewport selection skips the other viewports', async () => fixture(async root => {
  await writeRun(root, 'full', { side: 'a' });
  await writeRun(root, 'part', { side: 'b', selection: { viewports: ['mobile'] } });
  const { report } = await diff(root, 'full', 'part');
  assert.deepEqual(cells(report), ['home/mobile', 'about/mobile', 'blog/mobile']);
  assert.deepEqual(report.meta.viewports.map(item => item.id), ['mobile']);
  assert.equal(report.meta.primaryViewport, 'mobile');
  assert.equal(report.meta.skipped, 3);
}));

test('two selections compare the cells that both runs select', async () => fixture(async root => {
  await writeRun(root, 'one', { side: 'a', selection: { targets: ['home', 'about'] } });
  await writeRun(root, 'two', { side: 'b', selection: { targets: ['about', 'blog'], viewports: ['desktop'] } });
  const { report } = await diff(root, 'one', 'two');
  assert.deepEqual(cells(report), ['about/desktop']);
  assert.equal(report.meta.skipped, 5);
  await writeRun(root, 'three', { side: 'b', selection: { targets: ['blog'] } });
  await assert.rejects(diff(root, 'one', 'three'), /no cell in common/);
}));

test('a selected cell without a capture stays missing and the verdict is incomplete (R8.7)', async () => fixture(async root => {
  await writeRun(root, 'full', { side: 'a' });
  await writeRun(root, 'part', { side: 'b', selection: { targets: ['about'] }, drop: [['about', 'desktop']] });
  const { report } = await diff(root, 'full', 'part');
  assert.deepEqual(report.entries[0].viewports.map(row => [row.id, row.state]), [['mobile', 'complete'], ['desktop', 'missing']]);
  const summary = summarizeReport(report);
  assert.equal(summary.verdict, 'incomplete');
  assert.ok(summary.counts.incomplete > 0);
}));

test('a run without a selection record is never a selection: old behavior stays', async () => fixture(async root => {
  await writeRun(root, 'full', { side: 'a' });
  // An old target-trimmed run: fewer captures, no record. The cells it lacks stay missing, not skipped.
  await writeRun(root, 'old', { side: 'b', cells: ['about'] });
  const { report } = await diff(root, 'full', 'old');
  assert.equal(cells(report).length, 6);
  assert.equal(report.entries.find(entry => entry.id === 'home').viewports[0].state, 'missing');
  assert.equal(report.entries.find(entry => entry.id === 'about').viewports[0].state, 'complete');
  assert.equal(report.meta.skipped, undefined);
  assert.equal(report.meta.scope, undefined);
  assert.equal(summarizeReport(report).verdict, 'incomplete');
}));

test('an old viewport-trimmed run keeps its different hash and stays incompatible', async () => fixture(async root => {
  await writeRun(root, 'full', { side: 'a' });
  await writeRun(root, 'trim', { side: 'b', hash: 'sha256:' + 'b'.repeat(64) });
  const { report } = await diff(root, 'full', 'trim');
  assert.ok(report.entries.every(entry => entry.viewports.every(row => row.state === 'incompatible')));
}));

test('a full pair adds no scope and no skipped count', async () => fixture(async root => {
  await writeRun(root, 'full', { side: 'a' });
  await writeRun(root, 'again', { side: 'b' });
  const { report } = await diff(root, 'full', 'again');
  assert.equal(Object.hasOwn(report.meta, 'scope'), false);
  assert.equal(Object.hasOwn(report.meta, 'skipped'), false);
  assert.equal(Object.hasOwn(summarizeReport(report), 'skipped'), false);
}));

test('diff --target and --viewport filter the pair and the report records the filter', async () => fixture(async root => {
  await writeRun(root, 'full', { side: 'a' });
  await writeRun(root, 'again', { side: 'b' });
  const { report } = await diff(root, 'full', 'again', { filter: { targets: ['blog', 'home'], viewports: ['desktop'] } });
  assert.deepEqual(cells(report), ['home/desktop', 'blog/desktop']);
  assert.equal(report.meta.skipped, 4);
  assert.deepEqual(report.meta.scope, { a: null, b: null, filter: { targets: ['home', 'blog'], viewports: ['desktop'] } });
  await assert.rejects(diff(root, 'full', 'again', { filter: { targets: ['nope'] } }), /Unknown target/);
  await assert.rejects(diff(root, 'full', 'again', { filter: { viewports: ['nope'] } }), /Unknown viewport/);
}));

test('a filter stacks on a recorded selection', async () => fixture(async root => {
  await writeRun(root, 'full', { side: 'a' });
  await writeRun(root, 'part', { side: 'b', selection: { targets: ['home', 'about'] } });
  const { report } = await diff(root, 'full', 'part', { filter: { targets: ['about', 'blog'] } });
  assert.deepEqual(cells(report), ['about/mobile', 'about/desktop']);
  assert.equal(report.meta.skipped, 4);
}));

test('readRun rejects a bad stored selection', async () => fixture(async root => {
  await writeRun(root, 'full', { side: 'a' });
  const base = await writeRun(root, 'part', { side: 'b', selection: { targets: ['about'] } });
  const rewrite = async change => writeFile(join(root, 'part', 'run.json'), JSON.stringify({ ...base, ...change }));
  for (const selection of [null, {}, { targets: [] }, { targets: ['about', 'about'] }, { targets: ['nope'] }, { viewports: ['home'] }, { extra: ['about'] }, 'about']) {
    await rewrite({ selection });
    await assert.rejects(diff(root, 'full', 'part'), /Invalid stored selection/, JSON.stringify(selection));
  }
  await rewrite({ selection: { targets: ['home'] } });
  await assert.rejects(diff(root, 'full', 'part'), /outside the stored selection/);
  await rewrite({ selection: { targets: ['about'] } });
  assert.equal((await diff(root, 'full', 'part')).report.meta.skipped, 4);
}));

test('a deleted selected capture file stays failed or missing, never match', async () => fixture(async root => {
  await writeRun(root, 'full', { side: 'a' });
  await writeRun(root, 'part', { side: 'b', selection: { targets: ['about'] } });
  await unlink(join(root, 'part', 'screenshots', 'about', 'mobile.png'));
  const { report } = await diff(root, 'full', 'part');
  assert.notEqual(report.entries[0].viewports[0].state, 'complete');
  assert.notEqual(summarizeReport(report).verdict, 'match');
  assert.ok(await readFile(join(root, 'part', 'run.json'), 'utf8'));
}));
