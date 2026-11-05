import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCommand, run } from '../../src/cli/run.js';
import { planPackRun, PAGE_PACK_IDS } from '../../src/packs/select.js';
import { runPagePacks } from '../../src/capture/packs.js';
import { comparePackArtifact, PACK_ARTIFACT_KINDS } from '../../src/compare/packs.js';
import { reduceAxeResults, gapArtifact } from '../../src/packs/a11y/axe.js';
import { validateReport } from '../../src/report/model.js';
import { capture } from '../../src/capture/index.js';

// `capture --packs` (R13.46). All data uses example-site.
const axe = () => reduceAxeResults(JSON.parse(readFileSync(new URL('../fixtures/a11y/axe-result.json', import.meta.url), 'utf8')));
const sink = () => ({ text: '', write(chunk) { this.text += chunk; } });

test('--packs is a flag of capture only and takes no value', () => {
  assert.equal(parseCommand(['capture', '--side', 'local', '--packs']).options.packs, true);
  assert.equal(parseCommand(['capture', '--packs', '--side', 'local']).options.side, 'local');
  assert.equal(parseCommand(['capture', '--side', 'local']).options.packs, undefined);
  assert.throws(() => parseCommand(['capture', '--side', 'local', '--packs', '--packs']), /Duplicate option/);
  assert.throws(() => parseCommand(['diff', 'a', 'b', '--output', 'r', '--packs']), /Unknown option/);
  assert.throws(() => parseCommand(['query', 'r.json', '--packs']), /Unknown option/);
});

test('the CLI passes packs only when the flag is set', async () => {
  const seen = [];
  const dispatch = async request => { seen.push(request.options.packs); return { output: {}, exitCode: 0 }; };
  await run(['capture', '--side', 'local'], { out: sink(), err: sink() }, '0.0.0', dispatch);
  await run(['capture', '--side', 'local', '--packs'], { out: sink(), err: sink() }, '0.0.0', dispatch);
  assert.deepEqual(seen, [undefined, true]);
  const help = sink();
  await run(['--help'], { out: help, err: sink() });
  assert.match(help.text, /capture --side ID .*\[--packs\]/);
});

test('--packs without a packs key is a clear error', () => {
  for (const selected of [undefined, [], null]) assert.throws(() => planPackRun(selected), /--packs needs a "packs" key/);
});

test('the plan keeps the selected IDs only and skips a pack with no page step', () => {
  assert.deepEqual(PAGE_PACK_IDS, ['a11y']);
  assert.deepEqual(planPackRun(['a11y']), { selected: ['a11y'], page: ['a11y'], skipped: [] });
  const mixed = planPackRun(['lint', 'a11y', 'swiper']);
  assert.deepEqual(mixed.page, ['a11y']);
  assert.deepEqual(mixed.skipped.map(item => item.id), ['lint', 'swiper']);
  assert.ok(mixed.skipped.every(item => item.diagnostic.length > 0));
  assert.deepEqual(planPackRun(['lint']).page, []);
  assert.throws(() => planPackRun(['nope']), /Unknown pack/);
});

test('no pack runs without the flag, and only the selected IDs run with it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'test-kit-packs-'));
  try {
    const calls = [];
    const runners = { a11y: async (page, options) => { calls.push(['a11y', options.timeoutMs]); return axe(); }, lint: async () => { calls.push(['lint']); return {}; } };
    const base = { page: {}, runDir: dir, targetId: 'home', viewportId: 'wide', timeoutMs: 5000, settingsHash: 'sha256:x', browserVersion: '1', runners };
    assert.deepEqual(await runPagePacks({ ...base, ids: [] }), {});
    assert.deepEqual(calls, [], 'an empty selection runs nothing');
    const result = await runPagePacks({ ...base, ids: ['a11y'] });
    assert.deepEqual(calls, [['a11y', 5000]], 'a11y runs; lint does not');
    assert.deepEqual(Object.keys(result), ['a11y']);
    assert.equal(result.a11y.state, 'captured');
    assert.equal(result.a11y.path, 'a11y/home/wide.json');
    assert.equal(result.a11y.version.length > 0 && result.a11y.version !== 'unknown', true);
    assert.equal(JSON.parse(await readFile(join(dir, result.a11y.path), 'utf8')).status, 'complete');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a missing peer gives missing, a broken run gives failed, a throw gives failed with no sidecar (R8.7)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'test-kit-packs-'));
  try {
    const base = { page: {}, ids: ['a11y'], runDir: dir, targetId: 'home', viewportId: 'wide', timeoutMs: 5000, settingsHash: 'sha256:x', browserVersion: '1' };
    const missing = await runPagePacks({ ...base, runners: { a11y: async () => gapArtifact('missing', 'axe-core is not installed.') } });
    assert.equal(missing.a11y.state, 'failed');
    assert.equal(missing.a11y.error.code, 'PACK_MISSING');
    assert.match(missing.a11y.error.message, /axe-core is not installed/);
    assert.equal(JSON.parse(await readFile(join(dir, missing.a11y.path), 'utf8')).status, 'missing');
    const failed = await runPagePacks({ ...base, runners: { a11y: async () => gapArtifact('failed', 'axe did not finish.') } });
    assert.equal(failed.a11y.error.code, 'PACK_FAILED');
    const thrown = await runPagePacks({ ...base, viewportId: 'narrow', runners: { a11y: async () => { throw new Error('boom'); } } });
    assert.equal(thrown.a11y.state, 'failed');
    assert.equal(thrown.a11y.path, undefined);
    await assert.rejects(access(join(dir, 'a11y/home/narrow.json')));
    const bad = await runPagePacks({ ...base, viewportId: 'tiny', runners: { a11y: async () => null } });
    assert.equal(bad.a11y.error.code, 'PACK_FAILED');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// A stored run B with one capture. `artifacts` is the capture artifacts object.
async function storedRun(dir, artifacts, sidecar) {
  const b = { id: 'run-b' };
  if (sidecar) {
    await mkdir(join(dir, 'runs', 'run-b', 'a11y/home'), { recursive: true });
    await writeFile(join(dir, 'runs', 'run-b', 'a11y/home/wide.json'), JSON.stringify(sidecar));
  }
  await mkdir(join(dir, 'out'), { recursive: true });
  return { kind: 'a11y', b, bc: { artifacts }, runsRoot: join(dir, 'runs'), output: join(dir, 'out'), targetId: 'home', viewportId: 'wide' };
}
const index = extra => ({ kind: 'a11y', tool: 'axe-core', version: '4.14.0', settingsHash: 'sha256:x', browserVersion: '1', state: 'captured', path: 'a11y/home/wide.json', bytes: 1, ...extra });

test('a stored axe result becomes an absolute artifact and findings of the v3 model (R9.9)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'test-kit-packs-'));
  try {
    const input = await storedRun(dir, { a11y: index() }, axe());
    const { artifact, findings, catalog } = await comparePackArtifact(input);
    assert.equal(artifact.state, 'complete');
    assert.deepEqual(artifact.scope, { checks: ['a11y-axe'] });
    assert.deepEqual(artifact.evidence, { src: 'runs/run-b/a11y/home/wide.json', tool: 'axe-core', version: '4.14.0', settingsHash: 'sha256:x' });
    assert.equal(artifact.result.violations, true);
    assert.equal(artifact.result.checks, 1);
    assert.equal(artifact.a, undefined);
    assert.equal(artifact.diff, undefined);
    assert.deepEqual(catalog, { 'a11y-axe': { basis: 'absolute', layer: 'package', title: 'Accessibility (axe)' } });
    assert.ok(findings.length > 0);
    for (const finding of findings) {
      assert.equal(finding.artifact, 'a11y');
      assert.equal(finding.checkId, 'a11y-axe');
      assert.equal(finding.runId, 'run-b');
      assert.equal(finding.layer, 'package');
      assert.equal(finding.viewportId, 'wide');
    }
    assert.equal(JSON.parse(await readFile(join(dir, 'out/runs/run-b/a11y/home/wide.json'), 'utf8')).status, 'complete');
    // The index, the catalog and the findings form a valid report (R9.8).
    const report = { schemaVersion: 3, meta: { matchBelow: 3, viewports: [{ id: 'wide' }] }, runs: [{ id: 'run-a' }, { id: 'run-b' }],
      pair: { kind: 'update', aRunId: 'run-a', bRunId: 'run-b' }, checks: catalog,
      entries: [{ id: 'home', kind: 'page', title: 'Home', viewports: [{ id: 'wide', state: 'complete', artifacts: { a11y: artifact } }], artifacts: {} }],
      causes: [], findings, rules: {} };
    assert.deepEqual(validateReport(report), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a stored missing or failed result stays missing or failed in the report (R8.7)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'test-kit-packs-'));
  try {
    for (const [status, state] of [['missing', 'missing'], ['failed', 'failed']]) {
      const input = await storedRun(dir, { a11y: index({ state: 'failed', error: { code: 'PACK_FAILED', message: 'x' } }) }, gapArtifact(status, 'axe-core is not installed.'));
      const { artifact, findings } = await comparePackArtifact(input);
      assert.equal(artifact.state, state);
      assert.equal(artifact.result, undefined);
      // The pack reports a missing run as one open info finding. It never reports a clean page.
      assert.ok(findings.every(item => item.severity === 'info' && item.evidence.state === 'incomplete'));
      assert.equal(findings.length, status === 'missing' ? 1 : 0);
      assert.ok(artifact.diagnostic.length > 0);
      const report = { schemaVersion: 3, meta: { matchBelow: 3, viewports: [{ id: 'wide' }] }, runs: [{ id: 'run-a' }, { id: 'run-b' }],
        pair: { kind: 'update', aRunId: 'run-a', bRunId: 'run-b' }, checks: { 'a11y-axe': { basis: 'absolute', layer: 'package', title: 'Accessibility (axe)' } },
        entries: [{ id: 'home', kind: 'page', title: 'Home', viewports: [{ id: 'wide', state, artifacts: { a11y: artifact } }], artifacts: {} }],
        causes: [], findings, rules: {} };
      assert.deepEqual(validateReport(report), []);
    }
    const none = await comparePackArtifact(await storedRun(dir, { a11y: index({ path: undefined, error: { code: 'PACK_FAILED', message: 'boom' } }) }));
    assert.equal(none.artifact.state, 'failed');
    assert.equal(none.artifact.diagnostic, 'boom');
    const broken = await comparePackArtifact(await storedRun(dir, { a11y: index({ path: 'a11y/home/gone.json' }) }));
    assert.equal(broken.artifact.state, 'failed');
    const tampered = await comparePackArtifact(await storedRun(dir, { a11y: index() }, { status: 'complete', tool: 'axe-core', counts: 'x' }));
    assert.equal(tampered.artifact.state, 'failed');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a run with no pack artifact adds nothing to the report (R5.1)', async () => {
  assert.deepEqual(PACK_ARTIFACT_KINDS, ['a11y']);
  const dir = await mkdtemp(join(tmpdir(), 'test-kit-packs-'));
  try {
    assert.equal(await comparePackArtifact(await storedRun(dir, {})), null);
    assert.equal(await comparePackArtifact({ ...(await storedRun(dir, {})), bc: undefined }), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('capture --packs without a packs key stops before any run directory exists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'test-kit-packs-'));
  try {
    const configPath = join(dir, 'config.json');
    await writeFile(configPath, JSON.stringify({ schemaVersion: 1, sides: { local: { origin: 'http://127.0.0.1:9' } }, targets: [{ id: 'home', kind: 'page', path: '/' }],
      viewports: [{ id: 'wide', width: 500, height: 300 }], artifacts: ['screenshot'], runsRoot: 'runs' }));
    await assert.rejects(capture({ configPath, side: 'local', packs: true }), /--packs needs a "packs" key/);
    await assert.rejects(access(join(dir, 'runs')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
