import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeReport } from '../../src/query/summary.js';

const report = () => ({ schemaVersion: 2, meta: { matchBelow: 3, viewports: [{ id: 'desktop' }] }, runs: [{ id: 'a' }, { id: 'b' }], pair: { kind: 'update', aRunId: 'a', bRunId: 'b' }, causes: [], findings: [], entries: [], rules: {} });
const entry = (id, state = 'complete', availability = { a: 'ok', b: 'ok' }) => ({ id, viewports: [{ id: 'desktop', state, ratio: state === 'complete' ? 0 : null, availability }] });

test('summary bounds evidence while retaining full counts', () => {
	const data = report();
	data.entries = [entry('one'), entry('two'), entry('three', 'failed')];
	const summary = summarizeReport(data, { maxTargets: 1 });
	assert.equal(summary.counts.total, 3);
	assert.equal(summary.states.failed, 1);
	assert.equal(summary.targets.length, 1);
	assert.equal(summary.omitted, 2);
	assert.equal(summary.verdict, 'incomplete');
});

test('matching pixels do not hide HTTP failure', () => {
	const data = report(); data.entries = [entry('error-page', 'complete', { a: 'ok', b: 'http-error' })];
	const summary = summarizeReport(data);
	assert.equal(summary.counts.match, 1);
	assert.equal(summary.verdict, 'availability-problems');
	assert.equal(summary.availabilityCount, 1);
});

test('shared classification, filters and omitted unexplained counts agree', () => {
	const data = report(); data.entries = [entry('one'), entry('two')];
	data.findings = data.entries.map(({ id }) => ({ id, targetId: id, viewportId: 'desktop', artifact: 'screenshot' }));
	const summary = summarizeReport(data, { maxTargets: 1, filter: 'unexplained' });
	assert.equal(summary.counts.unexplained, 2);
	assert.deepEqual(summary.unexplainedTargets, ['one']);
	assert.equal(summary.unexplainedOmitted, 1);
	assert.equal(summary.omitted, 1);
	assert.equal(summarizeReport(data, { target: 'two' }).targets[0].id, 'two');
});

test('summary validates bounds and query selectors', () => {
	for (const maxTargets of [0, -1, 1.5, Infinity, 1001]) assert.throws(() => summarizeReport(report(), { maxTargets }));
	assert.throws(() => summarizeReport(report(), { filter: 'anything' }));
	assert.throws(() => summarizeReport(report(), { target: 'missing' }));
});

test('normal twenty-target output remains below estimated 5 kB', () => {
	const data = report(); data.entries = Array.from({ length: 20 }, (_, index) => entry(`page-${index}`));
	assert.ok(Buffer.byteLength(JSON.stringify(summarizeReport(data))) < 5000);
});

test('absent availability remains unknown', () => {
	const data = report(); data.entries = [entry('unknown', 'complete', {})];
	const summary = summarizeReport(data);
	assert.equal(summary.verdict, 'availability-problems');
	assert.equal(summary.targets[0].availability.length, 2);
});
