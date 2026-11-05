import test from 'node:test';
import assert from 'node:assert/strict';
import { noFixtureIds, noFixtureLine, headerLine } from '../../src/report/scope.js';
import { summarizeReport } from '../../src/query/summary.js';

// #290: the components a styleguide run skipped as "no fixture" join the scope line. Same count in viewer and summary.
const runs = [{ id: 'a', noFixture: ['hero', 'zeta', 'bad id', 7] }, { id: 'b', noFixture: ['hero', 'alpha'] }];

test('noFixtureIds counts each valid ID once over both runs and ignores bad entries', () => {
	assert.deepEqual(noFixtureIds({ runs }), ['alpha', 'hero', 'zeta']);
	assert.deepEqual(noFixtureIds({ runs: [{ id: 'a' }, { id: 'b', noFixture: 'hero' }] }), []);
	assert.deepEqual(noFixtureIds({}), []);
	assert.deepEqual(noFixtureIds(null), []);
});
test('noFixtureLine gives one sentence, singular and plural, and nothing for an empty list', () => {
	assert.equal(noFixtureLine(['a', 'b', 'c']), 'Not compared: 3 components have no fixture.');
	assert.equal(noFixtureLine(['a']), 'Not compared: 1 component has no fixture.');
	assert.equal(noFixtureLine([]), '');
});
test('headerLine joins the scope sentence and the no-fixture sentence, and is null with neither', () => {
	assert.equal(headerLine({ runs: [{ id: 'a' }] }), null);
	assert.equal(headerLine({ runs }), 'Not compared: 3 components have no fixture.');
	const scoped = { meta: { scope: { a: null, b: null, filter: null }, skipped: 2, viewports: [{ id: 'phone' }] }, entries: [{ id: 'home', viewports: [{ id: 'phone' }] }], runs: [{ id: 'a', noFixture: ['x'] }] };
	assert.equal(headerLine(scoped), 'Scope: 1 target, 1 viewport compared. 2 cells skipped. Not compared: 1 component has no fixture.');
});
test('the count of the line equals the count of summary', () => {
	const report = { schemaVersion: 2, meta: { title: 't', generated: null, viewports: [{ id: 'phone', width: 400 }], matchBelow: 3, noiseFloor: null }, pair: { kind: 'update', aRunId: 'a', bRunId: 'b' }, runs, entries: [], findings: [], causes: [], rules: {} };
	assert.equal(summarizeReport(report).noFixture.count, noFixtureIds(report).length);
});
