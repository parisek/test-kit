import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adaptReport, validate } from '../js/data.js';
import { composedIds, usedOn, summarize, targetClass, artifactClass, cellClass } from '../js/classify.js';
import { groupLabel } from '../js/labels.js';
import { traceCommand } from '../js/components/steps.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const report = adaptReport(read('report.components.json'));
const entry = (id) => report.entries.find((item) => item.id === id);

test('the component report is a version 2 report at component level with pages composed of components', () => {
	assert.equal(report.schemaVersion, 2);
	assert.equal(report.meta.sample, true);
	assert.equal(report.pair.kind, 'reference-styleguide');
	assert.equal(report.entries.filter((item) => item.kind === 'component').length, 14);
	assert.deepEqual(report.entries.filter((item) => item.kind === 'page').map((item) => item.id), ['home', 'contact']);
});

test('composedIds reads strings and objects, usedOn finds the pages that use a component', () => {
	assert.deepEqual(composedIds({ composedOf: ['a', { id: 'b' }, null] }), ['a', 'b']);
	assert.deepEqual(composedIds({}), []);
	assert.deepEqual(usedOn(report, 'header').map((item) => item.id), ['home', 'contact']);
	assert.deepEqual(usedOn(report, 'slider').map((item) => item.id), ['home']);
	assert.deepEqual(usedOn(report, 'pagination'), []);
});

test('a composedOf id that is no entry is reported for a version 2 report', () => {
	const bad = structuredClone(report);
	bad.entries.find((item) => item.id === 'home').composedOf.push('ghost');
	assert.ok(validate(bad).some((problem) => /ghost/.test(problem)));
});

test('a version 1 report may list components it never compared', () => {
	const v1 = { meta: { viewports: [{ id: 'desktop-1280' }] }, entries: [{ id: 'home', kind: 'page', composedOf: ['hero'], viewports: [{ id: 'desktop-1280', ratio: 1 }] }] };
	assert.doesNotThrow(() => adaptReport(v1));
});

test('groupLabel prefers the report, then the built-in languages, then the raw key', () => {
	assert.equal(groupLabel(report, 'basic'), 'Základní prvky');
	assert.equal(groupLabel({ meta: {} }, 'cs'), 'Čeština');
	assert.equal(groupLabel({ meta: { groups: { cs: 'Česky' } } }, 'cs'), 'Česky');
	assert.equal(groupLabel({}, 'blocks'), 'blocks');
});

test('component classes: font smoothing is explained, the tabs findings are not', () => {
	assert.equal(cellClass(report, entry('button'), 'desktop-1280'), 'explained');
	assert.equal(targetClass(report, entry('button')), 'explained');
	assert.equal(cellClass(report, entry('tabs'), 'notebook-1024'), 'unexplained');
	assert.equal(cellClass(report, entry('tabs'), 'mobile-390'), 'match');
	assert.equal(artifactClass(report, entry('tabs'), 'behavior'), 'unexplained');
	assert.equal(artifactClass(report, entry('slider'), 'html'), 'explained');
	const summary = summarize(report);
	assert.equal(summary.unexplainedCauses, 2);
	assert.equal(summary.cells.total, report.entries.length * report.meta.viewports.length);
});

test('marking both tabs causes known clears the component report', () => {
	assert.equal(summarize(report, new Set(['tabs-focus-ring', 'tabs-arrow-keys'])).cells.unexplained, 0);
});

test('behaviour steps: a failed step with a cause, recordings, and the trace command', () => {
	const tabs = entry('tabs').artifacts.behavior;
	assert.equal(tabs.steps.find((step) => step.status === 'failed').causeId, 'tabs-arrow-keys');
	assert.equal(tabs.recordings[0].kind, 'trace');
	assert.equal(traceCommand('tests/visual/runs/x/trace.zip'), 'npx playwright show-trace tests/visual/runs/x/trace.zip');
});

test('a step with an unknown status or evidence kind is reported by validate', () => {
	const bad = structuredClone(report);
	const steps = bad.entries.find((item) => item.id === 'tabs').artifacts.behavior.steps;
	steps[0].status = 'maybe';
	steps[1].evidence.push({ kind: 'smell', side: 'a' });
	const problems = validate(bad);
	assert.ok(problems.some((problem) => /maybe/.test(problem)));
	assert.ok(problems.some((problem) => /smell/.test(problem)));
});

test('the pages sample carries the six-step kontakt procedure and its two recordings', () => {
	const pages = adaptReport(read('report.json'));
	const behavior = pages.entries.find((item) => item.id === 'kontakt').artifacts.behavior;
	assert.equal(behavior.steps.length, 6);
	assert.deepEqual(behavior.steps.map((step) => step.status), ['same', 'same', 'same', 'same', 'changed', 'same']);
	assert.deepEqual(behavior.recordings.map((rec) => rec.kind), ['trace', 'video']);
});
