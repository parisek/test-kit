import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeReport } from '../../src/query/summary.js';
import { queryArtifact } from '../../src/query/artifact.js';

// The agent interface (summary, query, report.json) follows the specification only (R11.6, vision principle 2).
// A viewer change must not alter this output. These tests pin it on fixtures.
const dir = new URL('../fixtures/agent-interface/', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
// Compare the serialized text, so the order of every key is pinned too (deepEqual ignores key order).
const text = name => readFileSync(new URL(name, dir), 'utf8');
const serialize = value => JSON.stringify(value, null, 2) + '\n';

test('summary output is pinned for a default call', () => {
	assert.equal(serialize(summarizeReport(read('report.json'))), text('summary-default.json'));
});

test('summary output is pinned for a filter and a bound', () => {
	assert.equal(serialize(summarizeReport(read('report.json'), { filter: 'unexplained', maxTargets: 1 })), text('summary-unexplained.json'));
});

test('summary keeps its top-level keys', () => {
	assert.deepEqual(Object.keys(summarizeReport(read('report.json'))), ['pair', 'verdict', 'counts', 'states', 'availabilityCount', 'targets', 'omitted', 'unexplainedTargets', 'unexplainedOmitted', 'availabilityProblems', 'availabilityOmitted', 'next']);
});

test('query output is pinned for an artifact without a difference file', async () => {
	const root = mkdtempSync(join(tmpdir(), 'tk-pin-'));
	try {
		const report = read('report.json');
		report.pair.key = 'sha256:' + 'a'.repeat(64);
		report.entries[2].viewports[0].artifacts = { status: { state: 'failed', diagnostic: 'navigation failed', a: { src: 'a/status.json' }, b: { src: 'b/status.json' } } };
		writeFileSync(join(root, 'report.json'), JSON.stringify(report));
		const result = await queryArtifact(join(root, 'report.json'), { target: 'three', viewport: 'desktop', artifact: 'status' });
		assert.equal(serialize(result), text('query-status.json'));
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('summary keeps its default bound of 20 targets', () => {
	const data = read('report.json');
	data.entries = Array.from({ length: 25 }, (_, index) => ({ id: `page-${index}`, kind: 'page', title: `page-${index}`, viewports: [{ id: 'desktop', state: 'complete', ratio: 0, availability: { a: 'ok', b: 'ok' } }] }));
	data.findings = [];
	const summary = summarizeReport(data);
	assert.equal(summary.counts.total, 25);
	assert.equal(summary.targets.length, 20);
	assert.equal(summary.omitted, 5);
});
