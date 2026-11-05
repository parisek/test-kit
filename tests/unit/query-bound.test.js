import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeReport } from '../../src/query/summary.js';
import { queryArtifact } from '../../src/query/artifact.js';
import { OUTPUT_BYTE_LIMIT } from '../../src/query/bound.js';

// R11.2: every answer of summary and query stays under one byte limit, whatever a report file holds.
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const big = (length, char = 'x') => char.repeat(length);

const pairReport = () => ({ schemaVersion: 2, meta: { matchBelow: 3, viewports: [{ id: 'desktop' }] }, runs: [{ id: 'a' }, { id: 'b' }], pair: { kind: 'update', aRunId: 'a', bRunId: 'b' }, causes: [], findings: [], entries: [], rules: {} });
const entry = (id) => ({ id, viewports: [{ id: 'desktop', state: 'complete', ratio: 0, availability: { a: 'ok', b: 'ok' } }] });

test('summary copies only the documented keys of pair (R11.2)', () => {
	const data = pairReport();
	data.pair.extra = big(100_000);
	data.pair.aRunId = big(100_000);
	data.runs[0].id = data.pair.aRunId;
	const summary = summarizeReport(data);
	assert.deepEqual(Object.keys(summary.pair), ['kind', 'aRunId', 'bRunId']);
	assert.equal(summary.pair.aRunId.length, 200);
	assert.ok(bytes(summary) < 5000);
});

test('summary cuts a long target id (R11.2)', () => {
	const data = pairReport();
	data.entries = [entry(big(100_000))];
	data.findings = [{ id: 'f', targetId: data.entries[0].id, viewportId: 'desktop', artifact: 'screenshot' }];
	const summary = summarizeReport(data);
	assert.equal(summary.targets[0].id.length, 200);
	assert.equal(summary.unexplainedTargets[0].length, 200);
	assert.ok(bytes(summary) < OUTPUT_BYTE_LIMIT);
});

test('summary cuts the listed targets to the byte limit and counts them (R11.2)', () => {
	const data = pairReport();
	data.entries = Array.from({ length: 1000 }, (_, index) => entry(`${index}-${big(190)}`));
	data.findings = data.entries.map(({ id }) => ({ id, targetId: id, viewportId: 'desktop', artifact: 'screenshot' }));
	const summary = summarizeReport(data, { maxTargets: 1000 });
	assert.ok(bytes(summary) <= OUTPUT_BYTE_LIMIT, `${bytes(summary)} bytes`);
	assert.ok(summary.targets.length > 0 && summary.targets.length < 1000);
	assert.equal(summary.targets.length + summary.omitted, 1000);
	assert.equal(summary.unexplainedTargets.length + summary.unexplainedOmitted, 1000);
	assert.equal(summary.counts.total, 1000);
});

test('summary keeps the default bound of a normal report', () => {
	const data = pairReport();
	data.entries = Array.from({ length: 25 }, (_, index) => entry(`page-${index}`));
	const summary = summarizeReport(data);
	assert.equal(summary.targets.length, 20);
	assert.equal(summary.omitted, 5);
});

const lint = (extra = {}) => ({ state: 'complete', scope: { checks: ['eslint-no-console'] }, evidence: { tool: 'example', version: '1', settingsHash: 'sha256:x', src: 'runs/run-1/lint.json' }, result: { violations: false, checks: 1 }, ...extra });
const subjectReport = (index) => ({
	schemaVersion: 3, meta: { matchBelow: 3, viewports: [{ id: 'desktop' }] }, runs: [{ id: 'run-1' }], subject: { kind: 'single-run', runId: 'run-1' },
	checks: { 'eslint-no-console': { basis: 'absolute', layer: 'project', title: 'No console call' } }, overrides: [], causes: [], findings: [], rules: {},
	entries: [{ id: '@project', kind: 'project', title: 'Project', viewports: [], artifacts: { lint: index } }],
});

async function ask(report) {
	const dir = await mkdtemp(join(tmpdir(), 'query-bound-'));
	try {
		await writeFile(join(dir, 'report.json'), JSON.stringify(report));
		return await queryArtifact(join(dir, 'report.json'), { target: '@project', artifact: 'lint' });
	} finally { await rm(dir, { recursive: true, force: true }); }
}

test('query cuts the check names of scope to the byte limit and counts them (R11.2)', async () => {
	const checks = Array.from({ length: 500 }, (_, index) => `c${String(index).padStart(3, '0')}${big(124)}`);
	const report = subjectReport(lint({ scope: { checks } }));
	report.checks = Object.fromEntries(checks.map((id) => [id, { basis: 'absolute', layer: 'project', title: 'Check' }]));
	const out = await ask(report);
	assert.ok(bytes(out) <= OUTPUT_BYTE_LIMIT, `${bytes(out)} bytes`);
	assert.ok(out.scope.checks.length > 0 && out.scope.checks.length < 500);
	assert.equal(out.scope.checks.length + out.scope.checksOmitted, 500);
});

test('query keeps a normal scope whole', async () => {
	const out = await ask(subjectReport(lint()));
	assert.deepEqual(out.scope, { checks: ['eslint-no-console'] });
});

test('query cuts the rules of a report to the byte limit (R11.2)', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'query-bound-'));
	try {
		const report = JSON.parse(await readFile(new URL('../fixtures/agent-interface/report.json', import.meta.url), 'utf8'));
		report.pair.key = 'sha256:' + 'a'.repeat(64);
		report.entries[2].viewports[0].artifacts = { status: { state: 'failed', diagnostic: 'navigation failed', a: { src: 'a/status.json' }, b: { src: 'b/status.json' } } };
		report.rules = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`rule-${index}`, { text: big(500), evidence: big(1000), applies: {}, operation: { kind: 'literal-pair', a: 'one', b: 'two', maxOccurrences: 1 } }]));
		await writeFile(join(dir, 'report.json'), JSON.stringify(report));
		const out = await queryArtifact(join(dir, 'report.json'), { target: 'three', viewport: 'desktop', artifact: 'status' });
		assert.ok(bytes(out) <= OUTPUT_BYTE_LIMIT, `${bytes(out)} bytes`);
		assert.ok(out.rules.length > 0);
		assert.equal(out.rules.length + out.rulesOmitted, 50);
	} finally { await rm(dir, { recursive: true, force: true }); }
});
