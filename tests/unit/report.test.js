import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptReport, validateReport } from '../../src/report/model.js';
import { cellClass, targetClass, summarize } from '../../src/report/classify.js';
import { relativePath, sameOriginUrl } from '../../src/report/safe.js';

const report = () => ({ schemaVersion: 2, meta: { matchBelow: 3, viewports: [{ id: 'mobile' }] }, runs: [{ id: 'a' }, { id: 'b' }], pair: { kind: 'update', aRunId: 'a', bRunId: 'b' }, entries: [{ id: 'home', viewports: [{ id: 'mobile', ratio: 0, state: 'complete' }] }], causes: [], findings: [], rules: {} });

test('incomplete measurement never becomes a match', () => {
	const data = report();
	data.entries[0].viewports[0].state = 'failed';
	assert.equal(cellClass(data, data.entries[0], 'mobile'), null);
	assert.equal(targetClass(data, data.entries[0]), null);
	assert.equal(summarize(data).counts.incomplete, 1);
});
test('explicit findings remain visible below the compass threshold', () => {
	const data = report();
	data.findings.push({ targetId: 'home', viewportId: 'mobile', artifact: 'screenshot', causeId: 'change' });
	assert.equal(targetClass(data, data.entries[0]), 'unexplained');
	data.causes.push({ id: 'change', known: true });
	assert.equal(targetClass(data, data.entries[0]), 'explained');
});
test('malformed and unknown references fail validation without throwing TypeError', () => {
	assert.throws(() => adaptReport({ schemaVersion: 9 }), /Invalid report/);
	const data = report(); data.entries.push(null);
	assert.ok(validateReport(data).length);
	data.entries.pop(); data.pair.aRunId = 'missing';
	assert.throws(() => adaptReport(data), /unknown run/);
});
test('version one adaptation retains raw and unknown fields', () => {
	const old = { meta: { viewports: [{ id: 'mobile' }] }, custom: { keep: true }, entries: [{ id: 'home', viewports: [{ id: 'mobile', ratio: 1 }] }] };
	const adapted = adaptReport(old);
	assert.equal(adapted.legacy, old);
	assert.deepEqual(adapted.custom, { keep: true });
	assert.equal(targetClass(adapted, adapted.entries[0]), 'match');
});
test('artifact paths and browser URLs reject escape and active schemes', () => {
	for (const value of ['../escape', '/etc/passwd', 'a/../b', '-option', 'a//b', 'a\\b']) assert.equal(relativePath(value), null);
	assert.equal(relativePath('runs/a/screenshot/home.png'), 'runs/a/screenshot/home.png');
	assert.equal(sameOriginUrl('javascript:alert(1)', 'http://localhost/'), null);
	assert.equal(sameOriginUrl('//example.com/a', 'http://localhost/'), null);
	assert.equal(sameOriginUrl('runs/a.png', 'http://localhost/'), 'http://localhost/runs/a.png');
});
