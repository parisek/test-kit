import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adaptReport } from '../js/data.js';
import { normalizeRules, ruleApplies, firedRuleIds, rulesFor } from '../js/rules.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const pages = () => adaptReport(read('report.json'));
const components = () => adaptReport(read('report.components.json'));
const entry = (report, id) => report.entries.find((item) => item.id === id);
const ids = (list) => list.map((rule) => rule.id);

test('a bare string is a legacy rule that applies everywhere', () => {
	const rules = normalizeRules({ a: 'Text' });
	assert.deepEqual(rules.a, { text: 'Text', evidence: null, applies: {} });
	assert.equal(ruleApplies(rules.a, { pairKind: 'anything', targetKind: 'x', artifact: 'html', targetId: 'y' }), true);
});

test('an object rule keeps its scope and gets defaults', () => {
	const rules = normalizeRules({ a: { applies: { pairs: ['production-local'] } } });
	assert.equal(rules.a.text, '');
	assert.equal(rules.a.evidence, null);
	assert.deepEqual(rules.a.applies.pairs, ['production-local']);
});

test('every list that is present must contain the current value', () => {
	const rule = { applies: { pairs: ['production-local'], artifacts: ['html'], kinds: ['page'], targets: ['home'] } };
	const here = { pairKind: 'production-local', targetKind: 'page', artifact: 'html', targetId: 'home' };
	assert.equal(ruleApplies(rule, here), true);
	assert.equal(ruleApplies(rule, { ...here, pairKind: 'local-before-after' }), false);
	assert.equal(ruleApplies(rule, { ...here, artifact: 'status' }), false);
	assert.equal(ruleApplies(rule, { ...here, targetKind: 'component' }), false);
	assert.equal(ruleApplies(rule, { ...here, targetId: 'other' }), false);
});

test('firedRuleIds reads the noise and known keys of the artifact rows', () => {
	const report = pages();
	assert.deepEqual(firedRuleIds(entry(report, 'home'), 'html').sort(), ['asset-aggregation', 'avif-webp', 'reduced-motion', 'twig-debug']);
	assert.deepEqual(firedRuleIds(entry(report, 'zpravy'), 'html'), []);
});

test('used holds the rules that fired and are in scope, others the in-scope rules that did not fire', () => {
	const report = pages();
	const { used, others } = rulesFor(report, entry(report, 'kontakt'), 'production-local', 'html');
	assert.deepEqual(ids(used), ['form-token']);
	assert.deepEqual(ids(others), ['twig-debug', 'asset-aggregation', 'avif-webp']);
	assert.ok(used[0].evidence);
});

test('a rule outside its scope is in neither list, so the catalogue never shows whole', () => {
	const report = pages();
	const { used, others } = rulesFor(report, entry(report, 'kontakt'), 'local-before-after', 'html');
	assert.deepEqual(ids(used), ['form-token']);
	assert.deepEqual(others, []);
});

test('the artifact axis keeps html rules out of the status panel', () => {
	const report = pages();
	const { used, others } = rulesFor(report, entry(report, 'home'), 'production-local', 'status');
	assert.deepEqual(used, []);
	assert.deepEqual(ids(others), ['asset-aggregation']);
});

test('component level: a button shows no html rules, the slider shows its own', () => {
	const report = components();
	const button = rulesFor(report, entry(report, 'button'), 'reference-styleguide', 'html');
	assert.deepEqual(button, { used: [], others: [] });
	const slider = rulesFor(report, entry(report, 'slider'), 'reference-styleguide', 'html');
	assert.deepEqual(ids(slider.used), ['swiper-clones']);
	assert.deepEqual(slider.others, []);
});

test('component level: a page-only rule does not reach a component', () => {
	const report = components();
	assert.deepEqual(ids(rulesFor(report, entry(report, 'home'), 'reference-styleguide', 'html').used), ['live-asset-urls']);
	assert.deepEqual(rulesFor(report, entry(report, 'header'), 'reference-styleguide', 'html'), { used: [], others: [] });
});

test('a rule that names an unknown pair kind or artifact is reported by validate', () => {
	const bad = read('report.json');
	bad.rules['twig-debug'].applies.pairs = ['nonsense'];
	bad.rules['avif-webp'].applies.artifacts = ['audio'];
	assert.throws(() => adaptReport(bad), (error) => error.problems.some((p) => /nonsense/.test(p)) && error.problems.some((p) => /audio/.test(p)));
});
