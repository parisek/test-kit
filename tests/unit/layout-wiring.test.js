import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeConfig } from '../../src/config/normalize.js';
import { captureSettings, settingsHash, settleRecipe } from '../../src/config/settings.js';
import { entryProblem } from '../../src/capture/keep.js';
import { compareLayoutArtifact } from '../../src/layout/compare-artifact.js';
import { validateLayoutComparison, compareLayout } from '../../src/layout/compare.js';
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

async function fixture(t, { designB = false, partsB, fontSizeB = '16px', tamper = false, aliases } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'test-kit-layout-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parts = { parts: [{ id: 'title', selector: 'h1' }] };
  const index = { tool: 'test-kit-layout', version: LAYOUT_VERSION, browserVersion: '1', settingsHash: 'sha256:x' };
  const make = async (id, value, layout, kind) => {
    const bytes = Buffer.from(JSON.stringify(value));
    await mkdir(join(root, id, 'layout/home'), { recursive: true });
    await writeFile(join(root, id, 'layout/home/phone.json'), tamper && id === 'b' ? Buffer.concat([bytes, Buffer.from(' ')]) : bytes);
    const run = { id, side: 'local', settings: { sides: { local: kind === 'design' ? { kind: 'design', provider: 'files', root: 'x' } : { origin: 'http://127.0.0.1:1', settle: {} } },
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
  const same = await fixture(t);
  assert.equal(same.artifact.diff.changed, false);
  assert.deepEqual(same.findings, []);
});

test('compare artifact: browser sides only, equal part shapes, and an untrusted file', async (t) => {
  const design = await fixture(t, { designB: true });
  assert.equal(design.artifact.state, 'missing');
  assert.match(design.artifact.diagnostic, /browser sides only/);
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
  const detail = compareLayout(snapshot(), snapshot('20px'));
  assert.deepEqual(validateLayoutComparison(JSON.parse(JSON.stringify(detail))), detail);
  for (const change of [{ changed: false }, { parts: [{ id: '../x', state: 'match' }] }, { counts: { ...detail.counts, differences: 9 } },
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
