import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeConfig } from '../../src/config/normalize.js';
import { captureSettings, settingsHash, settleRecipe } from '../../src/config/settings.js';
import { entryProblem } from '../../src/capture/keep.js';
import { compareLayoutArtifact, designPairState } from '../../src/layout/compare-artifact.js';
import { validateLayoutComparison, compareLayout, boundComparison, MAX_COMPARISON_BYTES, MAX_DIFFERENCES } from '../../src/layout/compare.js';
import { readSidecar } from '../../src/artifacts/compare.js';
import { MAX_RESPONSE_BYTES } from '../../src/artifacts/response.js';
import { queryArtifact } from '../../src/query/artifact.js';
import { normaliseRecord, LAYOUT_VERSION } from '../../src/layout/record.js';
import { layoutTotals } from '../../src/report/layout.js';
import { parseCommand } from '../../src/cli/run.js';

const base = (changes = {}) => ({ schemaVersion: 1, sides: { local: { origin: 'http://127.0.0.1:8080' } },
  targets: [{ id: 'home', kind: 'page', path: '/' }], viewports: [{ id: 'phone', width: 400, height: 800 }], ...changes });

test('config: layout is opt-in, needs no other key, and a declaration enters no hash (R5.1, R6.14)', () => {
  const plain = normalizeConfig(base());
  assert.deepEqual(plain.artifacts, ['screenshot'], 'The default set stays screenshot only.');
  assert.equal(Object.hasOwn(plain, 'layout'), false, 'A config without the key gains no key.');
  assert.equal(Object.hasOwn(plain.targets[0], 'layout'), false);
  const parts = { parts: [{ id: 'title', selector: 'h1' }, { id: 'card', selector: '.card', repeat: true }] };
  const declared = normalizeConfig(base({ targets: [{ id: 'home', kind: 'page', path: '/', layout: parts }], layout: { aliases: { '--space-4': '--spacing-4' } } }));
  assert.deepEqual(declared.targets[0].layout, parts);
  assert.deepEqual(declared.layout, { aliases: { '--space-4': '--spacing-4' } });
  assert.equal(settingsHash(captureSettings(declared, 'local')), settingsHash(captureSettings(plain, 'local')), 'Parts and aliases change no capture settings hash.');
  assert.deepEqual(normalizeConfig(base({ artifacts: ['screenshot', 'html', 'status', 'content', 'behavior', 'layout'], behavior: { source: 'contracts' } })).artifacts.length, 6);
  for (const changes of [
    { targets: [{ id: 'home', kind: 'page', path: '/', layout: { parts: [] } }] },
    { targets: [{ id: 'home', kind: 'page', path: '/', layout: { parts: [{ id: 'a', selector: 'a' }, { id: 'a', selector: 'b' }] } }] },
    { layout: { aliases: { x: '--y' } } }, { layout: { tolerance: 2 } }, { artifacts: ['layout', 'layout'] }, { artifacts: ['geometry'] },
  ]) assert.throws(() => normalizeConfig(base(changes)), /Invalid configuration/, JSON.stringify(changes));
  assert.deepEqual(parseCommand(['capture', '--side', 'local', '--artifacts', 'screenshot,layout']).options.artifacts, 'screenshot,layout');
  assert.throws(() => parseCommand(['capture', '--side', 'local', '--artifacts', 'screenshot,geometry']), /Unknown capture artifact/);
  assert.equal(parseCommand(['query', 'report.json', '--target', 'home', '--viewport', 'phone', '--artifact', 'layout']).options.artifact, 'layout');
  assert.throws(() => parseCommand(['record-known', 'report.json', '--config', 'c.json', '--target', 'home', '--viewport', 'phone', '--artifact', 'layout', '--cause', 'x', '--reason', 'y']), /record-known requires/);
});

test('keep-existing never copies a cell that selects the layout artifact (R5.13)', () => {
  const target = { id: 'home', kind: 'page', title: 'home', path: '/', layout: { parts: [{ id: 'title', selector: 'h1' }] } };
  const recipe = { version: 1, scope: { selector: null, box: 'border' }, settle: {} };
  const provenance = { layout: { tool: 'test-kit-layout', version: LAYOUT_VERSION, browserVersion: '1', settingsHash: 'sha256:x' } };
  const entry = { targetId: 'home', viewportId: 'phone', state: 'captured', statusCode: 200, finalPath: '/', settleHash: settingsHash({}), scopeHash: settingsHash(recipe.scope), recipe,
    artifacts: { layout: { kind: 'layout', ...provenance.layout, state: 'captured', path: 'layout/home/phone.json', bytes: 10 } } };
  const source = { settings: { targets: [target] } };
  assert.equal(entryProblem(entry, source, { target, viewport: { id: 'phone' }, requested: ['layout'], provenance, recipe, settleHash: settingsHash({}) }), 'artifacts');
});

const raw = { rect: { width: 100, height: 20 }, display: 'block', fontSize: '16px', lineHeight: '24px', fontWeight: '400', fontFamily: 'Arial', letterSpacing: 'normal',
  color: 'rgb(0, 0, 0)', backgroundColor: 'rgba(0, 0, 0, 0)', borderTopWidth: '0px', borderTopLeftRadius: '0px', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' };
const snapshot = (fontSize = '16px') => ({ schemaVersion: 1, version: LAYOUT_VERSION, source: 'computed-style', parts: [{ id: 'title', repeat: false, count: 1, records: [normaliseRecord({ ...raw, fontSize })] }] });

async function fixture(t, { designB = false, provider = 'files', settleA, partsB, fontSizeB = '16px', tamper = false, aliases } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'test-kit-layout-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parts = { parts: [{ id: 'title', selector: 'h1' }] };
  const index = { tool: 'test-kit-layout', version: LAYOUT_VERSION, browserVersion: '1', settingsHash: 'sha256:x' };
  const make = async (id, value, layout, kind) => {
    const bytes = Buffer.from(JSON.stringify(value));
    await mkdir(join(root, id, 'layout/home'), { recursive: true });
    await writeFile(join(root, id, 'layout/home/phone.json'), tamper && id === 'b' ? Buffer.concat([bytes, Buffer.from(' ')]) : bytes);
    const run = { id, side: 'local', settings: { sides: { local: kind === 'design' ? { kind: 'design', provider, root: 'x' } : { origin: 'http://127.0.0.1:1', settle: id === 'a' && settleA ? settleA : {} } },
      viewports: [{ id: 'phone', width: 400, height: 800 }], targets: [{ id: 'home', kind: 'page', path: '/', ...(layout ? { layout } : {}) }], ...(id === 'b' && aliases ? { layout: { aliases } } : {}) },
      captureSettings: { browser: { name: 'chromium' } } };
    const settle = kind === 'design' ? {} : settleRecipe(run.settings, 'local', run.settings.targets[0]);
    const capture = { targetId: 'home', viewportId: 'phone', state: 'captured', settleHash: settingsHash(settle),
      artifacts: { layout: { kind: 'layout', ...index, state: 'captured', path: 'layout/home/phone.json', bytes: bytes.length, sha256: 'sha256:' + createHash('sha256').update(bytes).digest('hex') } } };
    return { run, capture };
  };
  const a = await make('a', snapshot(), parts);
  const b = await make('b', snapshot(fontSizeB), partsB === undefined ? parts : partsB, designB ? 'design' : undefined);
  return compareLayoutArtifact({ a: a.run, b: b.run, ac: a.capture, bc: b.capture, runsRoot: root, output: join(root, 'out'), targetId: 'home', viewportId: 'phone' });
}

test('compare artifact: a difference is a relative finding with the check layout (R6.15)', async (t) => {
  const result = await fixture(t, { fontSizeB: '20px' });
  assert.equal(result.artifact.state, 'complete');
  assert.deepEqual(result.artifact.scope, { checks: ['layout'] });
  assert.deepEqual(result.artifact.diff.counts, { parts: 1, match: 0, differs: 1, missing: 0, count: 0, differences: 2 });
  assert.deepEqual(result.findings.map(item => [item.artifact, item.checkId, item.message]), [
    ['layout', 'layout', 'Layout part title type.size: A 16, B 20.'], ['layout', 'layout', 'Layout part title type.lineHeight: A 1.5, B 1.2.']]);
  assert.equal(result.findings.every(item => item.runId === undefined), true, 'A relative finding carries no run.');
  assert.equal(Object.hasOwn(result.artifact.diff, 'findingsOmitted'), false);
  const same = await fixture(t);
  assert.equal(same.artifact.diff.changed, false);
  assert.deepEqual(same.findings, []);
});

test('compare artifact: browser and claude-design sides, equal part shapes, and an untrusted file', async (t) => {
  const design = await fixture(t, { designB: true });
  assert.equal(design.artifact.state, 'missing', 'A files or figma design run holds raster images only.');
  assert.match(design.artifact.diagnostic, /browser sides and claude-design sides only/);
  // A claude-design run reads layout records. Its settle recipe does not decide compatibility (R8.15), so a site
  // with its own settle recipe still compares with it (#350 part C).
  const canvas = await fixture(t, { designB: true, provider: 'claude-design', settleA: { waitMs: 100 }, fontSizeB: '20px' });
  assert.equal(canvas.artifact.state, 'complete');
  assert.deepEqual(canvas.findings.map(item => item.message), ['Layout part title type.size: A 16, B 20.', 'Layout part title type.lineHeight: A 1.5, B 1.2.']);
  // A design pair binds the extractor (tool and version), not the settings hash or the browser version (R8.15).
  const entry = { state: 'captured', tool: 'test-kit-layout', version: LAYOUT_VERSION, settingsHash: 'sha256:a', browserVersion: '1' };
  assert.equal(designPairState(entry, { ...entry, settingsHash: 'sha256:b', browserVersion: '2' }), 'complete');
  assert.equal(designPairState(entry, { ...entry, version: '0.9.0' }), 'incompatible');
  assert.equal(designPairState(entry, { ...entry, tool: 'other' }), 'incompatible');
  assert.equal(designPairState(entry, { ...entry, browserVersion: '' }), 'incompatible');
  assert.equal(designPairState(entry, { ...entry, state: 'failed' }), 'failed');
  assert.equal(designPairState(entry, undefined), 'missing');
  const settled = await fixture(t, { settleA: { waitMs: 100 } });
  assert.equal(settled.artifact.state, 'incompatible', 'Two browser runs still bind the settle recipe.');
  const other = await fixture(t, { partsB: { parts: [{ id: 'heading', selector: 'h1' }] } });
  assert.equal(other.artifact.state, 'incompatible');
  assert.match(other.artifact.diagnostic, /part IDs or repeat flags/);
  const none = await fixture(t, { partsB: null });
  assert.equal(none.artifact.state, 'incompatible');
  const tampered = await fixture(t, { tamper: true });
  assert.equal(tampered.artifact.state, 'failed');
  assert.deepEqual(tampered.findings, []);
  const badAliases = await fixture(t, { aliases: { nope: 1 } });
  assert.equal(badAliases.artifact.state, 'failed');
});

test('the difference sidecar and the summary counts read untrusted data with bounds (R11.2, R11.6)', () => {
  const detail = boundComparison(compareLayout(snapshot(), snapshot('20px')));
  assert.equal(detail.differencesOmitted, 0);
  assert.deepEqual(validateLayoutComparison(JSON.parse(JSON.stringify(detail))), detail);
  for (const change of [{ changed: false }, { parts: [{ id: '../x', state: 'match' }] }, { counts: { ...detail.counts, differences: 9 } },
    { differencesOmitted: undefined }, { differencesOmitted: -1 }, { differencesOmitted: 1 }, { differencesOmitted: 'x' }, { differencesOmitted: MAX_DIFFERENCES + 1 },
    { differences: [{ ...detail.differences[0], property: 'x;y' }] }, { differences: [{ ...detail.differences[0], a: {} }] }, { differences: [{ ...detail.differences[0], tokenA: 'x' }] }])
    assert.throws(() => validateLayoutComparison({ ...detail, ...change }), JSON.stringify(change));
  const row = (counts, state = 'complete') => ({ id: 'phone', artifacts: { layout: { state, diff: { counts } } } });
  const report = { entries: [
    { id: 'home', viewports: [row({ differs: 1, missing: 0, count: 1, differences: 2 }), row({ differs: 0, missing: 1, count: 0, differences: 1 })] },
    { id: 'about', viewports: [row({ differs: 0, missing: 0, count: 0, differences: 0 }), row({ differs: 5, differences: 5 }, 'failed'), row({ differs: -1, differences: 'x' })] },
  ] };
  assert.deepEqual(layoutTotals(report), { cells: 2, differs: 1, missing: 1, count: 1, differences: 3 });
  assert.deepEqual(layoutTotals(report, 'about'), {});
  assert.deepEqual(layoutTotals({ entries: [] }), {});
});

test('compare artifact: at most 100 findings per cell, and the cut is counted (R6.15, R9.13)', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'test-kit-layout-cap-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const many = (fontSize) => ({ schemaVersion: 1, version: LAYOUT_VERSION, source: 'computed-style',
    parts: [{ id: 'item', repeat: true, count: 50, records: Array.from({ length: 50 }, () => normaliseRecord({ ...raw, fontSize })) }] });
  const parts = { parts: [{ id: 'item', selector: 'li', repeat: true }] };
  const make = async (id, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    await mkdir(join(root, id, 'layout/home'), { recursive: true });
    await writeFile(join(root, id, 'layout/home/phone.json'), bytes);
    const run = { id, side: 'local', settings: { sides: { local: { origin: 'http://127.0.0.1:1', settle: {} } }, viewports: [{ id: 'phone', width: 400, height: 800 }], targets: [{ id: 'home', kind: 'page', path: '/', layout: parts }] }, captureSettings: { browser: { name: 'chromium' } } };
    const capture = { targetId: 'home', viewportId: 'phone', state: 'captured', settleHash: settingsHash(settleRecipe(run.settings, 'local', run.settings.targets[0])),
      artifacts: { layout: { kind: 'layout', tool: 'test-kit-layout', version: LAYOUT_VERSION, browserVersion: '1', settingsHash: 'sha256:x', state: 'captured', path: 'layout/home/phone.json', bytes: bytes.length, sha256: 'sha256:' + createHash('sha256').update(bytes).digest('hex') } } };
    return { run, capture };
  };
  const a = await make('a', many('16px')), b = await make('b', many('20px'));
  const result = await compareLayoutArtifact({ a: a.run, b: b.run, ac: a.capture, bc: b.capture, runsRoot: root, output: join(root, 'out'), targetId: 'home', viewportId: 'phone' });
  assert.equal(result.artifact.diff.counts.differences, 100 + 0, 'Two properties differ on each of 50 items.');
  assert.equal(result.findings.length, 100);
  assert.equal(Object.hasOwn(result.artifact.diff, 'findingsOmitted'), false, 'Exactly 100 differences need no cut.');
  const c = await make('c', { ...many('20px'), parts: [{ ...many('20px').parts[0], records: many('20px').parts[0].records.map(record => ({ ...record, layout: { ...record.layout, padding: [4, 0, 0, 0] } })) }] });
  const cut = await compareLayoutArtifact({ a: a.run, b: c.run, ac: a.capture, bc: c.capture, runsRoot: root, output: join(root, 'out2'), targetId: 'home', viewportId: 'phone' });
  assert.equal(cut.artifact.diff.counts.differences, 150);
  assert.equal(cut.findings.length, 100);
  assert.equal(cut.artifact.diff.findingsOmitted, 50);
  assert.equal(cut.artifact.diff.differences.length, 50);
  assert.equal(cut.artifact.diff.differencesOmitted, 100);
});

test('the difference sidecar always fits the query read limit: 50 repeat parts of 50 records (R6.15, R9.13, R11.8)', async (t) => {
  assert.equal(MAX_COMPARISON_BYTES, MAX_RESPONSE_BYTES, 'The writer bound equals the default read limit.');
  const root = await mkdtemp(join(tmpdir(), 'test-kit-layout-bound-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  // Every property differs between the two sides, so each record gives one difference per property.
  const sideA = { rect: { width: 100, height: 20 }, display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', justifyContent: 'start', alignItems: 'start', rowGap: '1px', columnGap: '1px',
    paddingTop: '1px', paddingRight: '1px', paddingBottom: '1px', paddingLeft: '1px', fontFamily: 'Example Sans', fontSize: '16px', fontWeight: '400', lineHeight: '24px', letterSpacing: '0px',
    color: 'rgb(0, 0, 0)', backgroundColor: 'rgb(255, 255, 255)', borderTopWidth: '1px', borderTopColor: 'rgb(1, 1, 1)', borderTopLeftRadius: '1px' };
  const sideB = { rect: { width: 300, height: 90 }, display: 'inline-flex', flexDirection: 'row-reverse', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', rowGap: '9px', columnGap: '9px',
    paddingTop: '9px', paddingRight: '9px', paddingBottom: '9px', paddingLeft: '9px', fontFamily: 'Other Serif', fontSize: '40px', fontWeight: '700', lineHeight: '80px', letterSpacing: '4px',
    color: 'rgb(9, 9, 9)', backgroundColor: 'rgb(200, 200, 200)', borderTopWidth: '5px', borderTopColor: 'rgb(9, 1, 1)', borderTopLeftRadius: '9px' };
  const ids = Array.from({ length: 50 }, (_, index) => `repeat-part-${index}`);
  const file = values => ({ schemaVersion: 1, version: LAYOUT_VERSION, source: 'computed-style',
    parts: ids.map(id => ({ id, repeat: true, count: 50, records: Array.from({ length: 50 }, () => normaliseRecord(values)) })) });
  const parts = { parts: ids.map(id => ({ id, selector: `.${id}`, repeat: true })) };
  const make = async (id, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    await mkdir(join(root, id, 'layout/home'), { recursive: true });
    await writeFile(join(root, id, 'layout/home/phone.json'), bytes);
    const run = { id, side: 'local', settings: { sides: { local: { origin: 'http://127.0.0.1:1', settle: {} } }, viewports: [{ id: 'phone', width: 400, height: 800 }], targets: [{ id: 'home', kind: 'page', path: '/', layout: parts }] }, captureSettings: { browser: { name: 'chromium' } } };
    const capture = { targetId: 'home', viewportId: 'phone', state: 'captured', settleHash: settingsHash(settleRecipe(run.settings, 'local', run.settings.targets[0])),
      artifacts: { layout: { kind: 'layout', tool: 'test-kit-layout', version: LAYOUT_VERSION, browserVersion: '1', settingsHash: 'sha256:x', state: 'captured', path: 'layout/home/phone.json', bytes: bytes.length, sha256: 'sha256:' + createHash('sha256').update(bytes).digest('hex') } } };
    return { run, capture };
  };
  const a = await make('a', file(sideA)), b = await make('b', file(sideB));
  const output = join(root, 'out');
  const result = await compareLayoutArtifact({ a: a.run, b: b.run, ac: a.capture, bc: b.capture, runsRoot: root, output, targetId: 'home', viewportId: 'phone' });
  assert.equal(result.artifact.state, 'complete');
  const total = result.artifact.diff.counts.differences;
  assert.equal(total, 50 * 50 * 22, 'Each of the 2500 records differs in all 22 properties.');
  // The full list is several MiB. The sidecar keeps a prefix of it and counts the rest.
  assert.ok(JSON.stringify(compareLayout(file(sideA), file(sideB)).differences).length > 2 * MAX_COMPARISON_BYTES);
  const bytes = await readSidecar(output, result.artifact.diff.src);
  assert.ok(bytes.length <= MAX_RESPONSE_BYTES);
  const sidecar = validateLayoutComparison(JSON.parse(bytes));
  assert.equal(sidecar.counts.differences, total);
  assert.ok(sidecar.differencesOmitted > 0);
  assert.equal(sidecar.differences.length + sidecar.differencesOmitted, total);
  // The order is stable: the sidecar starts with the first differences of the index.
  assert.deepEqual(sidecar.differences.slice(0, 50), result.artifact.diff.differences);
  assert.equal(result.artifact.diff.differencesOmitted, total - 50, 'The index counts from the full list.');
  // `query` reads the sidecar with its default limit and reports both cuts.
  const report = { schemaVersion: 3, meta: { title: 'Layout bound', generated: null, viewports: [{ id: 'phone', width: 400 }], matchBelow: 3, noiseFloor: null },
    pair: { kind: 'update', aRunId: 'a', bRunId: 'b' }, runs: [{ id: 'a' }, { id: 'b' }],
    checks: { layout: { basis: 'relative', layer: 'package', title: 'Layout record difference' } },
    entries: [{ id: 'home', viewports: [{ id: 'phone', state: 'complete', ratio: 0, availability: { a: 'ok', b: 'ok' }, artifacts: { screenshot: { a: null, b: null, diff: null, state: 'complete' }, layout: result.artifact } }] }],
    findings: result.findings, causes: [], rules: {} };
  await writeFile(join(output, 'report.json'), JSON.stringify(report));
  const query = await queryArtifact(join(output, 'report.json'), { target: 'home', viewport: 'phone', artifact: 'layout', maxLines: 5 });
  assert.equal(query.diff.counts.differences, total);
  assert.equal(query.diff.differences.length, 5);
  assert.equal(query.diff.differencesOmitted, total - 5);
  assert.equal(query.diff.differencesOmitted, sidecar.differencesOmitted + sidecar.differences.length - 5);
  // A small bound cuts at the first difference that does not fit.
  const small = boundComparison(compareLayout(file(sideA), file(sideB)), 4096);
  assert.ok(Buffer.byteLength(JSON.stringify(small)) <= 4096);
  assert.equal(small.differences.length + small.differencesOmitted, total);
  assert.ok(Buffer.byteLength(JSON.stringify({ ...small, differences: compareLayout(file(sideA), file(sideB)).differences.slice(0, small.differences.length + 1) })) > 4096);
});
