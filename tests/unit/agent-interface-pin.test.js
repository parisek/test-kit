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

test('summary output is pinned for a default call', () => {
	assert.deepEqual(summarizeReport(read('report.json')), read('summary-default.json'));
});

test('summary output is pinned for a filter and a bound', () => {
	assert.deepEqual(summarizeReport(read('report.json'), { filter: 'unexplained', maxTargets: 1 }), read('summary-unexplained.json'));
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
		assert.deepEqual(result, {
			target: 'three', viewport: 'desktop', artifact: 'status', state: 'failed', diagnostic: 'navigation failed',
			pairKey: 'sha256:' + 'a'.repeat(64), rules: [], rulesOmitted: 0,
			evidence: { a: 'a/status.json', b: 'b/status.json', normalizedA: null, normalizedB: null },
			next: 'Open the same target and viewport in the viewer.'
		});
	} finally { rmSync(root, { recursive: true, force: true }); }
});
