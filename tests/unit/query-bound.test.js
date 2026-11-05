import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeReport } from '../../src/query/summary.js';
import { queryArtifact } from '../../src/query/artifact.js';
import { OUTPUT_BYTE_LIMIT } from '../../src/query/bound.js';
import { CHECK_VERSION } from '../../src/checks/index.js';
import { title as headingTitle } from '../../src/checks/builtin/heading-outline.js';

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
	assert.deepEqual(Object.keys(summary.pair), ['kind', 'aRunId', 'aRunIdTruncated', 'bRunId']);
	assert.equal(summary.pair.aRunId.length, 200);
	assert.ok(bytes(summary) < 5000);
});

test('summary marks a cut run id of the pair and of the subject (R11.2, owner decision on #274)', () => {
	const data = pairReport();
	data.pair.aRunId = big(300, 'a'); data.pair.bRunId = big(300, 'b');
	data.runs = [{ id: data.pair.aRunId }, { id: data.pair.bRunId }];
	const { pair } = summarizeReport(data);
	assert.equal(pair.aRunIdTruncated, true);
	assert.equal(pair.bRunIdTruncated, true);
	assert.ok(pair.aRunId.endsWith('\u2026') && pair.bRunId.endsWith('\u2026'));
	const single = subjectReport(lint());
	single.subject.runId = big(300, 'r'); single.runs = [{ id: single.subject.runId }];
	const { subject } = summarizeReport(single);
	assert.equal(subject.runIdTruncated, true);
	assert.equal(subject.runId.length, 200);
	assert.ok(subject.runId.endsWith('\u2026'));
	// A short run id carries no mark and no flag.
	const short = summarizeReport(pairReport());
	assert.deepEqual(Object.keys(short.pair), ['kind', 'aRunId', 'bRunId']);
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

// The diff paths. A sidecar is validated by its own schema, so these values pass it and still reach the limit.
const prov = { tool: 'example', version: '1', settingsHash: 'sha256:x' };
const diffIndex = (ext) => ({ state: 'complete', a: { ...prov, src: ext === 'txt' ? 'a/x.txt' : 'a/x.json' }, b: { ...prov, src: ext === 'txt' ? 'b/x.txt' : 'b/x.json' }, diff: { ...prov, src: 'diff/x.json', changed: true } });
async function askDiff(artifact, diff, { maxLines, rules } = {}) {
	const dir = await mkdtemp(join(tmpdir(), 'query-bound-'));
	try {
		const report = JSON.parse(await readFile(new URL('../fixtures/agent-interface/report.json', import.meta.url), 'utf8'));
		report.pair.key = 'sha256:' + 'a'.repeat(64);
		report.entries[2].viewports[0].artifacts = { [artifact]: diffIndex(artifact === 'html' ? 'txt' : 'json') };
		if (rules) report.rules = rules;
		await mkdir(join(dir, 'diff'));
		await writeFile(join(dir, 'diff/x.json'), JSON.stringify(diff));
		await writeFile(join(dir, 'report.json'), JSON.stringify(report));
		return await queryArtifact(join(dir, 'report.json'), { target: 'three', viewport: 'desktop', artifact, maxLines });
	} finally { await rm(dir, { recursive: true, force: true }); }
}
const hostileStatus = () => {
	const redirects = Array.from({ length: 20 }, (_, index) => `/${index}${big(1990)}`);
	const side = { statusCode: 200, finalPath: '/', redirects, assets: { requests: 1, failed: 0, httpErrors: 0 } };
	return { changed: true, a: side, b: side };
};

test('query cuts a status difference and keeps part of it (R11.2)', async () => {
	const out = await askDiff('status', hostileStatus());
	assert.ok(bytes(out) <= OUTPUT_BYTE_LIMIT, `${bytes(out)} bytes`);
	assert.ok(out.diff, 'the difference stays');
	for (const key of ['a', 'b']) {
		assert.ok(out.diff[key].redirects.length > 0 && out.diff[key].redirects.length < 20);
		assert.equal(out.diff[key].redirects.length + out.diff[key].redirectsOmitted, 20);
	}
});

test('query cuts an html difference and counts the lines (R11.2)', async () => {
	const lines = Array.from({ length: 100 }, (_, index) => ({ kind: 'added', line: index + 1, text: big(2000), truncated: false }));
	const out = await askDiff('html', { changed: true, method: 'prefix-suffix-replacement', removedLines: 0, addedLines: 100, displayedLines: 100, omittedLines: 0, lines }, { maxLines: 100 });
	assert.ok(bytes(out) <= OUTPUT_BYTE_LIMIT, `${bytes(out)} bytes`);
	assert.ok(out.diff.lines.length > 0 && out.diff.lines.length < 100);
	assert.equal(out.diff.displayedLines, out.diff.lines.length);
	assert.equal(out.diff.lines.length + out.diff.omittedLines, 100);
});

test('query cuts a behavior difference and counts the steps (R11.2)', async () => {
	const steps = Array.from({ length: 100 }, (_, index) => ({ id: `step-${index}`, title: big(2000), state: 'changed' }));
	const out = await askDiff('behavior', { state: 'complete', changed: true, steps }, { maxLines: 100 });
	assert.ok(bytes(out) <= OUTPUT_BYTE_LIMIT, `${bytes(out)} bytes`);
	assert.ok(out.diff.steps.length > 0 && out.diff.steps.length < 100);
	assert.equal(out.diff.steps.length + out.diff.stepsOmitted, 100);
});

test('query cuts a content difference and counts the findings (R11.2)', async () => {
	const findings = Array.from({ length: 50 }, (_, index) => ({ artifact: 'content', checkId: 'heading-outline', severity: 'warning', message: big(2000), evidence: { state: 'known', index } }));
	const side = { state: 'failed', findings, omitted: 0 };
	const detail = { schemaVersion: 1, checkVersion: CHECK_VERSION, changed: true, incomplete: false, checks: [{ id: 'heading-outline', title: headingTitle, a: side, b: side }], findings };
	const out = await askDiff('content', detail, { maxLines: 100 });
	assert.ok(bytes(out) <= OUTPUT_BYTE_LIMIT, `${bytes(out)} bytes`);
	assert.ok(out.diff.findings.length > 0 && out.diff.findings.length < 50);
	assert.equal(out.diff.findings.length + out.diff.findingsOmitted, 50);
	const cut = out.diff.checks[0];
	assert.ok(cut.b.findings.length < 50);
	assert.equal(cut.b.findings.length + cut.b.omitted, 50);
});

test('query cuts the rules last (R11.2)', async () => {
	const rules = { 'rule-1': { text: 'x', evidence: 'x', applies: {}, operation: { kind: 'literal-pair', a: 'one', b: 'two', maxOccurrences: 1 } } };
	const out = await askDiff('status', hostileStatus(), { rules });
	assert.equal(out.rules.length, 1, 'a small rules list survives while the redirects are cut');
	assert.equal(out.rulesOmitted, 0);
});

test('query drops an oversize scalar difference before it cuts the rules (R11.2)', async () => {
	const rules = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`rule-${index}`, { text: 'x', evidence: 'x', applies: {}, operation: { kind: 'literal-pair', a: 'one', b: 'two', maxOccurrences: 1 } }]));
	// The behavior validator returns unknown keys, so a scalar in the sidecar reaches the answer.
	const out = await askDiff('behavior', { state: 'complete', changed: true, steps: [], payload: big(100_000) }, { rules });
	assert.ok(bytes(out) <= OUTPUT_BYTE_LIMIT, `${bytes(out)} bytes`);
	assert.equal(out.diff, undefined);
	assert.equal(out.diffOmitted, true);
	assert.equal(out.rules.length, 5);
	assert.equal(out.rulesOmitted, 0);
});

test('a cut target id ends with an ellipsis and carries a flag (R11.2)', () => {
	const data = pairReport();
	data.entries = [entry(big(300))];
	const summary = summarizeReport(data);
	assert.equal(summary.targets[0].id.length, 200);
	assert.ok(summary.targets[0].id.endsWith('…'));
	assert.equal(summary.targets[0].idTruncated, true);
	data.entries = [entry('short')];
	assert.equal('idTruncated' in summarizeReport(data).targets[0], false);
});
