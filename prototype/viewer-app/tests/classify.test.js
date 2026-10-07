import test from 'node:test';
import assert from 'node:assert/strict';
import { sample, target } from './helpers.js';
import { filterTargets, cellClass, artifactClass, targetClass, worst, summarize, targetsOfCause, viewportsOfCause, worstRatio } from '../js/classify.js';

const report = sample();

test('a ratio below matchBelow is a match', () => {
	assert.equal(cellClass(report, target(report, 'zpravy'), 'desktop-1280'), 'match');
});

test('a ratio above the threshold with only known causes is explained', () => {
	assert.equal(cellClass(report, target(report, 'kontakt'), 'desktop-1280'), 'explained');
});

test('a ratio above the threshold with an unknown cause is unexplained', () => {
	assert.equal(cellClass(report, target(report, 'blog'), 'mobile-390'), 'unexplained');
});

test('a finding with a viewport scopes to that viewport only', () => {
	assert.equal(cellClass(report, target(report, 'blog'), 'desktop-1280'), 'match');
});

test('a ratio above the threshold with no finding at all is unexplained', () => {
	const bare = structuredClone(report);
	bare.findings = bare.findings.filter((finding) => finding.targetId !== 'home');
	assert.equal(cellClass(bare, target(bare, 'home'), 'desktop-1280'), 'unexplained');
});

test('marking a cause known turns its cells explained', () => {
	const known = new Set(['article-1px']);
	assert.equal(cellClass(report, target(report, 'blog'), 'mobile-390', known), 'explained');
});

test('judge oracle is never coloured by ratio', () => {
	const oracle = structuredClone(report);
	target(oracle, 'home').judge = 'oracle';
	assert.equal(cellClass(oracle, target(oracle, 'home'), 'desktop-1280'), 'oracle');
});

test('a viewport with an error is unexplained', () => {
	const broken = structuredClone(report);
	target(broken, 'zpravy').viewports[0].error = 'Snímek se nepodařilo pořídit';
	assert.equal(cellClass(broken, target(broken, 'zpravy'), 'mobile-390'), 'unexplained');
});

test('an artifact without a finding is a match', () => {
	assert.equal(artifactClass(report, target(report, 'zpravy'), 'html'), 'match');
});

test('behavior with an unknown cause is unexplained', () => {
	assert.equal(artifactClass(report, target(report, 'kontakt'), 'behavior'), 'unexplained');
});

test('status findings do not decide the class of a target', () => {
	assert.equal(targetClass(report, target(report, 'zpravy')), 'match');
});

test('worst picks unexplained over explained over oracle over match', () => {
	assert.equal(worst(['match', 'explained', 'unexplained']), 'unexplained');
	assert.equal(worst(['match', 'oracle']), 'oracle');
	assert.equal(worst([]), 'match');
});

test('summarize counts every cell and updates when a cause becomes known', () => {
	const before = summarize(report);
	assert.equal(before.cells.total, report.entries.length * report.meta.viewports.length);
	assert.equal(before.cells.unexplained, 1);
	assert.equal(before.unexplainedCauses, 2);
	const after = summarize(report, new Set(['article-1px', 'redirect-escape']));
	assert.equal(after.cells.unexplained, 0);
	assert.equal(after.unexplainedCauses, 0);
});

test('targetsOfCause and viewportsOfCause derive from the findings', () => {
	assert.deepEqual(targetsOfCause(report, 'article-1px'), ['blog']);
	assert.deepEqual(viewportsOfCause(report, 'article-1px'), ['mobile-390']);
	assert.equal(viewportsOfCause(report, 'turnstile').length, report.meta.viewports.length);
});

test('worstRatio reads one viewport or all', () => {
	assert.equal(worstRatio(target(report, 'home')), 8.9);
	assert.equal(worstRatio(target(report, 'home'), 'mobile-390'), 6.1);
});

test('filterTargets lets through all, or one class', () => {
	assert.equal(filterTargets(report, 'all').length, report.entries.length);
	assert.ok(filterTargets(report, 'unexplained').every((entry) => ['blog', 'kontakt'].includes(entry.id)));
	assert.equal(filterTargets(report, 'unexplained', new Set(['article-1px', 'redirect-escape'])).length, 0);
});
