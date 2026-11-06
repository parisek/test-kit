import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareRuns } from '../../src/compare/runs.js';
import { summarizeReport } from '../../src/query/summary.js';
import { settingsHash } from '../../src/config/settings.js';
import { run as runCli, dispatch } from '../../src/cli/run.js';
import { captureWarnings, warningFields, sanitizeWarnings, warningsForRow, warningTotals, warningLine, WARNING_COUNT_LIMIT } from '../../src/report/warnings.js';

const CODE = 'LAZY_IMAGES_NOT_SWEPT';
const sink = () => ({ text: '', write(chunk) { this.text += chunk; } });

test('a capture warns only when lazyImages is off and an unloaded lazy image exists (R5.11)', () => {
  assert.deepEqual(captureWarnings({ lazyImages: false, unloaded: 3 }), [{ code: CODE, count: 3 }]);
  assert.deepEqual(captureWarnings({ lazyImages: undefined, unloaded: 1 }), [{ code: CODE, count: 1 }]);
  assert.deepEqual(captureWarnings({ lazyImages: true, unloaded: 3 }), []);
  for (const unloaded of [0, -1, 1.5, NaN, '3', null, undefined]) assert.deepEqual(captureWarnings({ lazyImages: false, unloaded }), []);
});

test('the count is capped at 1000 (R5.11)', () => {
  assert.deepEqual(captureWarnings({ lazyImages: false, unloaded: 1000 }), [{ code: CODE, count: 1000 }]);
  assert.deepEqual(captureWarnings({ lazyImages: false, unloaded: 99999 }), [{ code: CODE, count: WARNING_COUNT_LIMIT }]);
});

test('no warning adds no field to the capture result (R5.11)', () => {
  assert.deepEqual(warningFields([]), {});
  assert.deepEqual(warningFields([{ code: CODE, count: 2 }]), { warnings: [{ code: CODE, count: 2 }] });
});

test('warnings stay outside every hash (R5.11)', () => {
  const settle = { waitMs: 0, lazyImages: false };
  const before = settingsHash(settle);
  const capture = { settleHash: before, ...warningFields(captureWarnings({ lazyImages: false, unloaded: 5 })) };
  assert.equal(capture.settleHash, before);
  assert.equal(settingsHash(settle), before);
  const source = readFileSync(new URL('../../src/capture/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /settingsHash\([^)]*warnings/);
});

test('a reader keeps a valid stored list (R5.11)', () => {
  assert.deepEqual(sanitizeWarnings([{ code: CODE, count: 7 }, { code: 'OTHER_1', count: 1000 }]), [{ code: CODE, count: 7 }, { code: 'OTHER_1', count: 1000 }]);
});

test('a reader ignores a bad stored value as a whole and never throws (R5.11)', () => {
  const ok = { code: CODE, count: 2 };
  const bad = [
    undefined, null, 'x', 5, {}, [], { code: CODE, count: 2 },
    [null], ['x'], [[]], [ok, null], [ok, { code: CODE, count: 3 }],
    [{ code: CODE }], [{ count: 2 }], [{ ...ok, extra: 1 }], [{ ...ok, __proto__: { x: 1 } }],
    [{ code: CODE, count: 0 }], [{ code: CODE, count: -1 }], [{ code: CODE, count: 1001 }], [{ code: CODE, count: 1.5 }],
    [{ code: CODE, count: '2' }], [{ code: CODE, count: NaN }], [{ code: CODE, count: Infinity }], [{ code: CODE, count: Number.MAX_SAFE_INTEGER + 2 }],
    [{ code: 'lower', count: 1 }], [{ code: '', count: 1 }], [{ code: 'A'.repeat(65), count: 1 }], [{ code: 'A B', count: 1 }],
    [{ code: 'A\nB', count: 1 }], [{ code: '<img src=x>', count: 1 }], [{ code: 5, count: 1 }], [{ code: null, count: 1 }],
    Array.from({ length: 11 }, (_, index) => ({ code: `CODE_${index}`, count: 1 })),
  ];
  for (const value of bad) assert.deepEqual(sanitizeWarnings(value), [], JSON.stringify(value));
  const cyclic = []; cyclic.push(cyclic);
  assert.deepEqual(sanitizeWarnings(cyclic), []);
  assert.deepEqual(sanitizeWarnings(Object.create(null)), []);
  assert.deepEqual(sanitizeWarnings([Object.assign(Object.create(null), ok)]), []);
});

test('warningsForRow reads each side on its own and returns null for none (R5.11)', () => {
  const ok = { code: CODE, count: 2 };
  assert.equal(warningsForRow({ state: 'captured' }, undefined), null);
  assert.equal(warningsForRow({ warnings: 'x' }, { warnings: [{ code: CODE, count: 0 }] }), null);
  assert.deepEqual(warningsForRow({ warnings: [ok] }, { warnings: 'x' }), { a: [ok], b: [] });
  assert.deepEqual(warningsForRow(undefined, { warnings: [ok] }), { a: [], b: [ok] });
});

const report = () => ({ schemaVersion: 2, meta: { matchBelow: 3, viewports: [{ id: 'desktop' }] }, runs: [{ id: 'a' }, { id: 'b' }], pair: { kind: 'update', aRunId: 'a', bRunId: 'b' }, causes: [], findings: [], entries: [] });
const row = warnings => ({ id: 'desktop', state: 'complete', ratio: 0, availability: { a: 'ok', b: 'ok' }, ...(warnings === undefined ? {} : { warnings }) });

test('summary counts warnings by code and leaves the verdict alone (R5.11)', () => {
  const data = report();
  data.entries = [
    { id: 'home', viewports: [row({ a: [{ code: CODE, count: 3 }], b: [{ code: CODE, count: 4 }] })] },
    { id: 'about', viewports: [row({ a: [{ code: CODE, count: 2 }], b: [] })] },
    { id: 'plain', viewports: [row()] },
  ];
  const summary = summarizeReport(data);
  assert.deepEqual(summary.captureWarnings, [{ code: CODE, cells: 3, count: 9 }]);
  assert.equal(summary.captureWarningsOmitted, 0);
  assert.equal(summary.verdict, 'match');
  assert.deepEqual(summarizeReport(data, { target: 'about' }).captureWarnings, [{ code: CODE, cells: 1, count: 2 }]);
  assert.equal(Object.hasOwn(summarizeReport(data, { target: 'plain' }), 'captureWarnings'), false);
});

test('summary skips a bad warning record in a report and adds no key (R5.11)', () => {
  const data = report();
  data.entries = [{ id: 'home', viewports: [row({ a: [{ code: CODE, count: -1 }], b: 'x' })] }, { id: 'about', viewports: [row('x')] }, { id: 'more', viewports: [row(null)] }];
  assert.equal(Object.hasOwn(summarizeReport(data), 'captureWarnings'), false);
  assert.deepEqual(warningTotals(data), []);
});

test('summary bounds the code list and reports the cut (R5.11)', () => {
  const data = report();
  data.entries = [{ id: 'home', viewports: [row({ a: ['CODE_A', 'CODE_B', 'CODE_C'].map(code => ({ code, count: 1 })), b: [] })] }];
  const summary = summarizeReport(data, { maxTargets: 2 });
  assert.equal(summary.captureWarnings.length, 2);
  assert.equal(summary.captureWarningsOmitted, 1);
});

test('the capture line is one stderr line, only for the lazy-image code (R5.11)', () => {
  assert.equal(warningLine({ captures: [{ state: 'captured' }] }), null);
  assert.equal(warningLine({ captures: [{ warnings: [{ code: 'OTHER', count: 2 }] }, { warnings: 'x' }] }), null);
  const line = warningLine({ captures: [{ warnings: [{ code: CODE, count: 2 }] }, { warnings: [{ code: CODE, count: 5 }] }, { warnings: [{ code: CODE, count: 0 }] }] });
  assert.match(line, /^Warning LAZY_IMAGES_NOT_SWEPT: 2 captures hold lazy images that did not load \(7 in all\)\. Set settle\.lazyImages to true to load them\.$/);
  assert.doesNotMatch(line, /\n/);
  assert.match(warningLine({ captures: [{ warnings: [{ code: CODE, count: 1 }] }] }), /1 capture holds/);
});

test('the capture command prints the JSON line on stdout and the warning on stderr (R5.11)', async () => {
  const capture = async () => ({ run: { id: 'run-1', state: 'complete', captures: [{ warnings: [{ code: CODE, count: 2 }] }] }, manifestPath: 'runs/run-1/run.json' });
  const out = sink();
  const err = sink();
  const code = await runCli(['capture', '--side', 'local'], { out, err }, '0.1.0', parsed => dispatch(parsed, { capture }));
  assert.equal(code, 0);
  assert.equal(out.text.trim().split('\n').length, 1);
  assert.equal(JSON.parse(out.text).id, 'run-1');
  assert.doesNotMatch(out.text, /Warning/);
  assert.match(err.text, /Warning LAZY_IMAGES_NOT_SWEPT: 1 capture holds/);
  assert.equal(err.text.split('\n').filter(line => line.startsWith('Warning ')).length, 1);
});

// compareRuns loads pngjs and pixelmatch. The plain unit job installs no dependency, so it skips this test.
const hasImageTools = await Promise.all([import('pngjs'), import('pixelmatch')]).then(() => true, () => false);
test('compareRuns copies the warnings of both runs into the row and ignores a bad stored value (R5.11)', { skip: !hasImageTools && 'pngjs or pixelmatch is not installed' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'tk-warnings-'));
  try {
    const run = (id, side, capture) => ({ schemaVersion: 2, id, side, label: id, state: 'partial', settingsHash: 'sha256:' + 'a'.repeat(64),
      settings: { artifacts: ['screenshot'], targets: [{ id: 'home', kind: 'page', title: 'home', path: '/' }], viewports: [{ id: 'desktop', width: 10, height: 10, deviceScaleFactor: 1 }],
        sides: { [side]: { origin: 'https://example.com', settle: {} } } },
      tools: [{ name: 'playwright', version: '1', settingsHash: 'sha256:' + 'a'.repeat(64) }],
      captures: [{ targetId: 'home', viewportId: 'desktop', state: 'failed', artifacts: {}, error: { code: 'X', message: 'x' }, ...capture }] });
    let count = 0;
    const compare = async (aCapture, bCapture) => {
      for (const item of [run('run-a', 'production', aCapture), run('run-b', 'local', bCapture)]) {
        await mkdir(join(root, 'runs', item.id), { recursive: true });
        await writeFile(join(root, 'runs', item.id, 'run.json'), JSON.stringify(item));
      }
      return (await compareRuns({ runsRoot: join(root, 'runs'), runA: 'run-a', runB: 'run-b', outputDir: join(root, `out-${count += 1}`) })).report;
    };
    const good = await compare({ warnings: [{ code: CODE, count: 4 }] }, {});
    assert.deepEqual(good.entries[0].viewports[0].warnings, { a: [{ code: CODE, count: 4 }], b: [] });
    assert.deepEqual(summarizeReport(good).captureWarnings, [{ code: CODE, cells: 1, count: 4 }]);
    for (const value of ['x', [{ code: CODE, count: 1001 }], [{ code: CODE, count: 1, extra: true }], { code: CODE, count: 1 }, [null]]) {
      const ignored = await compare({ warnings: value }, { warnings: value });
      assert.equal(Object.hasOwn(ignored.entries[0].viewports[0], 'warnings'), false, JSON.stringify(value));
      assert.equal(Object.hasOwn(summarizeReport(ignored), 'captureWarnings'), false);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
