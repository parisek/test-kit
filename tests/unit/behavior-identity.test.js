import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runBehavior, BEHAVIOR_VERSION } from '../../src/behavior/index.js';
import { validateBehaviorSnapshot } from '../../src/behavior/snapshot.js';
import { validateContracts, withOrigin } from '../../src/behavior/contracts.js';
import { compareBehaviorArtifact } from '../../src/behavior/compare-artifact.js';
import { validateReport } from '../../src/report/model.js';
import { summarizeRunFeedback } from '../../src/workflow/feedback.js';

// Behavior identity (ADR 0004, question 1; owner decision of 2026-11-04). All names are example-site names.
const page = { on() {}, off() {}, evaluate: async () => [], screenshot: async ({ path }) => writeFile(path, 'png'), context: () => ({ close: async () => {} }) };
// `menu-2` is both a contract and the second instance of `menu`. A step id alone cannot tell them apart.
const menu = { name: 'menu', detect: async () => [1, 2], run: async () => ({ open: true }), runScoping: async () => ({ isolated: true }) };
const menuTwo = { name: 'menu-2', detect: async () => [1], run: async () => ({ ok: true }) };
const run = (directory, contracts, extra = {}) => runBehavior({ page, contracts, projectName: 'desktop-1280', artifactDir: directory, relativeDir: 'behavior/home/desktop', ...extra });
const fresh = () => mkdtemp(join(tmpdir(), 'behavior-identity-'));

test('every step names its contract, and a step id never has to be parsed', async () => {
	const dir = await fresh();
	try {
		const result = await run(dir, [withOrigin(menu), withOrigin(menuTwo)]);
		assert.equal(BEHAVIOR_VERSION, '2');
		assert.equal(result.version, '2');
		assert.deepEqual(result.steps.map(step => [step.id, step.contract]), [
			['menu-detect', 'menu'], ['menu-1', 'menu'], ['menu-2', 'menu'], ['menu-scoping', 'menu'], ['menu-2-detect', 'menu-2'], ['menu-2-1', 'menu-2'],
		]);
		assert.deepEqual(result.settings.contracts.map(item => [item.name, item.origin]), [['menu', 'project'], ['menu-2', 'project']]);
		assert.equal(validateBehaviorSnapshot(JSON.parse(await readFile(join(dir, 'results.json')))).steps.length, 6);
	} finally { await rm(dir, { recursive: true }); }
});

test('skipped and incompatible contracts also carry their name', async () => {
	const dir = await fresh();
	try {
		const bound = { ...menuTwo, name: 'slider', library: { package: 'example-library', majors: [3] } };
		const other = { ...menu, name: 'footer', projects: ['mobile-390'] };
		const empty = { name: 'empty', detect: async () => [], run: async () => null };
		const result = await run(dir, [bound, other, empty]);
		assert.deepEqual(result.steps.map(step => [step.id, step.contract, step.state]), [['slider', 'slider', 'incompatible'], ['footer', 'footer', 'skipped'], ['empty-detect', 'empty', 'complete'], ['empty', 'empty', 'skipped']]);
		assert.deepEqual(result.settings.contracts.map(item => item.origin), ['project', 'project', 'project']);
	} finally { await rm(dir, { recursive: true }); }
});

test('the registry sets the origin, and a contract cannot claim another one', () => {
	assert.equal(withOrigin({ ...menu, origin: 'package' }).origin, 'project');
	assert.equal(withOrigin(menu, 'component').origin, 'component');
	assert.throws(() => validateContracts([{ ...menu, origin: 'vendor' }]), /origin/);
	assert.doesNotThrow(() => validateContracts([{ ...menu, origin: 'package' }, { ...menuTwo, origin: 'component' }]));
});

test('a snapshot of version 2 needs a contract on each step, and version 1 stays readable', async () => {
	const dir = await fresh();
	try {
		const result = JSON.parse(JSON.stringify(await run(dir, [menu])));
		result.steps[0].contract = 'unknown';
		assert.throws(() => validateBehaviorSnapshot(result), /contract/);
		delete result.steps[0].contract;
		assert.throws(() => validateBehaviorSnapshot(result), /contract/);
		const settings = { projectName: 'desktop-1280', contracts: [{ name: 'menu' }] };
		const old = { tool: 'test-kit-behavior', version: '1', settings, settingsHash: createHash('sha256').update(JSON.stringify(settings)).digest('hex'), state: 'complete', steps: [{ id: 'menu-1', title: 'menu', state: 'complete' }] };
		assert.equal(validateBehaviorSnapshot(old), old);
	} finally { await rm(dir, { recursive: true }); }
});

async function pair(change) {
	const root = await mkdtemp(join(tmpdir(), 'behavior-pair-'));
	const settings = { sides: { reference: { settle: {} }, test: { settle: {} } }, viewports: [{ id: 'desktop' }], targets: [{ id: 'home' }] };
	const runs = [];
	for (const [id, side, tweak] of [['run-a', 'reference', false], ['run-b', 'test', true]]) {
		const directory = join(root, 'runs', id, 'behavior', 'home', 'desktop');
		await mkdir(directory, { recursive: true });
		const contracts = [menu, menuTwo].map(contract => ({ ...contract, run: async () => ({ open: tweak ? change : true }) }));
		const result = await runBehavior({ page, contracts: contracts.map(contract => withOrigin(contract)), projectName: 'desktop-1280', artifactDir: directory, relativeDir: 'behavior/home/desktop' });
		const capture = { targetId: 'home', viewportId: 'desktop', artifacts: { behavior: { kind: 'behavior', state: 'captured', tool: result.tool, version: result.version, settingsHash: result.settingsHash, browserVersion: 'x', path: 'behavior/home/desktop/results.json' } } };
		runs.push({ id, side, settings, captures: [capture] });
	}
	return { root, a: runs[0], b: runs[1] };
}

test('findings carry the catalog key behavior.<contract>, and -detect and -scoping fold into the contract', async () => {
	const { root, a, b } = await pair(false);
	try {
		const output = join(root, 'out');
		await mkdir(output, { recursive: true });
		const { artifact, findings, catalog } = await compareBehaviorArtifact({ a, b, ac: a.captures[0], bc: b.captures[0], runsRoot: join(root, 'runs'), output, targetId: 'home', viewportId: 'desktop' });
		assert.equal(artifact.state, 'complete');
		assert.deepEqual(findings.map(finding => [finding.id.split('desktop-')[1], finding.checkId, finding.layer]), [
			['menu-1', 'behavior.menu', 'project'], ['menu-2', 'behavior.menu', 'project'], ['menu-2-1', 'behavior.menu-2', 'project'],
		]);
		assert.deepEqual(catalog, { 'behavior.menu': { basis: 'relative', layer: 'project', title: 'menu' }, 'behavior.menu-2': { basis: 'relative', layer: 'project', title: 'menu-2' } });
		assert.deepEqual(artifact.scope, { checks: ['behavior.menu', 'behavior.menu-2'] });
		assert.ok(!Object.keys(catalog).some(key => /(?:detect|scoping|-1)$/.test(key)), 'one entry for each contract, none for a step');
	} finally { await rm(root, { recursive: true }); }
});

test('scope.checks lists the contracts that apply to the project of the viewport', async () => {
	const { root, a, b } = await pair(false);
	try {
		for (const side of [a, b]) {
			const path = join(root, 'runs', side.id, 'behavior', 'home', 'desktop', 'results.json');
			const snapshot = JSON.parse(await readFile(path));
			snapshot.settings.contracts[1].projects = ['mobile-390'];
			snapshot.settingsHash = createHash('sha256').update(JSON.stringify(snapshot.settings)).digest('hex');
			await writeFile(path, JSON.stringify(snapshot));
			side.captures[0].artifacts.behavior.settingsHash = snapshot.settingsHash;
		}
		const output = join(root, 'out');
		await mkdir(output, { recursive: true });
		const { artifact, catalog } = await compareBehaviorArtifact({ a, b, ac: a.captures[0], bc: b.captures[0], runsRoot: join(root, 'runs'), output, targetId: 'home', viewportId: 'desktop' });
		assert.deepEqual(artifact.scope, { checks: ['behavior.menu'] });
		assert.deepEqual(Object.keys(catalog), ['behavior.menu', 'behavior.menu-2'], 'a finding is always catalogued, selected or not');
	} finally { await rm(root, { recursive: true }); }
});

test('a behavior artifact and its findings pass the version 3 validator', async () => {
	const { root, a, b } = await pair(false);
	try {
		const output = join(root, 'out');
		await mkdir(output, { recursive: true });
		const { artifact, findings, catalog } = await compareBehaviorArtifact({ a, b, ac: a.captures[0], bc: b.captures[0], runsRoot: join(root, 'runs'), output, targetId: 'home', viewportId: 'desktop' });
		const report = { schemaVersion: 3, meta: { matchBelow: 3, viewports: [{ id: 'desktop' }] }, runs: [{ id: 'run-a' }, { id: 'run-b' }], pair: { kind: 'update', aRunId: 'run-a', bRunId: 'run-b' }, checks: catalog,
			entries: [{ id: 'home', kind: 'page', viewports: [{ id: 'desktop', state: artifact.state, artifacts: { behavior: artifact } }], artifacts: {} }], causes: [], findings, rules: {} };
		assert.deepEqual(validateReport(report), []);
		report.findings[0].checkId = 'behavior.absent';
		assert.ok(validateReport(report).includes('A finding names a check that is not in the catalog.'));
	} finally { await rm(root, { recursive: true }); }
});

test('the feedback summary uses the contract name and the same catalog key', async () => {
	const { root, b } = await pair(false);
	try {
		const path = join(root, 'runs', 'run-b', 'behavior', 'home', 'desktop', 'results.json');
		const snapshot = JSON.parse(await readFile(path));
		snapshot.steps.find(step => step.id === 'menu-2').state = 'failed';
		snapshot.steps.find(step => step.id === 'menu-2').error = 'Not open.';
		snapshot.state = 'failed';
		await writeFile(path, JSON.stringify(snapshot));
		const run = { ...b, id: 'run-b', state: 'complete', settings: { ...b.settings, artifacts: ['behavior'], viewports: [{ id: 'desktop' }], targets: [{ id: 'home' }] } };
		const feedback = await summarizeRunFeedback(run, join(root, 'runs'), { persist: false });
		const item = feedback.findings.find(finding => finding.state === 'failed');
		assert.equal(item.contractId, 'menu', 'the contract name, not the step id menu-2');
		assert.equal(item.checkId, 'behavior.menu');
	} finally { await rm(root, { recursive: true }); }
});
