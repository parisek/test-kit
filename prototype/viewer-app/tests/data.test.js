import test from 'node:test';
import assert from 'node:assert/strict';
import { load, sample } from './helpers.js';
import { adaptReport, ReportError, validate, loadReport } from '../js/data.js';
import { cellClass } from '../js/classify.js';

test('a version 2 report keeps its runs, pair and findings', () => {
	const report = sample();
	assert.equal(report.schemaVersion, 2);
	assert.equal(report.legacy, false);
	assert.equal(report.pair.kind, 'production-local');
	assert.ok(report.findings.length > 0);
});

test('a report without schemaVersion is read as version 1 and nothing is dropped', () => {
	const v1 = load('report.v1.json');
	const report = adaptReport(v1);
	assert.equal(report.legacy, true);
	assert.equal(report.entries.length, v1.entries.length);
	assert.equal(report.entries[0].viewports[0].shots.diff, v1.entries[0].viewports[0].shots.diff);
	assert.equal(report.meta.matchBelow, 3);
	assert.deepEqual(report.findings, []);
});

test('version 1: judge oracle survives and is never coloured by ratio', () => {
	const report = adaptReport(load('report.v1.json'));
	const pricing = report.entries.find((entry) => entry.id === 'pricing');
	assert.equal(pricing.judge, 'oracle');
	assert.equal(cellClass(report, pricing, 'mobile-390'), 'oracle');
});

test('version 1: the compass threshold is 3 percent, an unexplained ratio above it', () => {
	const report = adaptReport(load('report.v1.json'));
	const hero = report.entries.find((entry) => entry.id === 'hero');
	assert.equal(cellClass(report, hero, 'mobile-390'), 'match');
	const home = report.entries.find((entry) => entry.id === 'home');
	assert.equal(cellClass(report, home, 'mobile-390'), 'unexplained');
});

test('version 1: console errors become a behavior artifact', () => {
	const report = adaptReport(load('report.v1.json'));
	assert.equal(report.entries.find((entry) => entry.id === 'home').artifacts.behavior.rows.length, 1);
});

test('a newer schema is refused with a message', () => {
	assert.throws(() => adaptReport({ schemaVersion: 99 }), (error) => error instanceof ReportError && /schemaVersion 99/.test(error.message));
});

test('a finding that points at an unknown target or cause is reported', () => {
	const bad = load('report.json');
	bad.findings.push({ id: 'x', targetId: 'nope', causeId: 'nope', artifact: 'html' });
	assert.throws(() => adaptReport(bad), (error) => error instanceof ReportError && error.problems.length === 2);
});

test('validate flags a duplicate target id and an unknown viewport', () => {
	const report = sample();
	report.entries.push({ ...report.entries[0] });
	report.entries[1].viewports[0].id = 'ghost-1';
	const problems = validate(report);
	assert.ok(problems.some((problem) => /stejné id/.test(problem)));
	assert.ok(problems.some((problem) => /ghost-1/.test(problem)));
});

test('loadReport turns a network failure and a bad status into a ReportError', async () => {
	await assert.rejects(loadReport('x.json', async () => { throw new Error('offline'); }), ReportError);
	await assert.rejects(loadReport('x.json', async () => ({ ok: false, status: 404 })), /HTTP 404/);
	await assert.rejects(loadReport('x.json', async () => ({ ok: true, json: async () => { throw new Error('bad'); } })), /JSON/);
});
