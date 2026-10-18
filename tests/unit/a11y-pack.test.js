import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveChecks, runChecks } from '../../src/packs/index.js';
import { a11yPack, reduceAxeResults, gapArtifact, axeFindings, IMPACT_SEVERITY, LIMITS } from '../../src/packs/a11y/index.js';

const raw = () => JSON.parse(readFileSync(new URL('../fixtures/a11y/axe-result.json', import.meta.url), 'utf8'));
const plan = () => resolveChecks({ available: [a11yPack], packs: ['a11y'] });
const run = (value, context = { targetId: 'example-site' }) => runChecks(plan(), { artifact: 'a11y', value }, context);

test('impact maps to severity', () => {
  assert.deepEqual(IMPACT_SEVERITY, { minor: 'info', moderate: 'warning', serious: 'error', critical: 'error' });
});

test('the pack is opt-in and has one absolute package check (G3, R5.1, R13.42)', () => {
  assert.equal(resolveChecks({ available: [a11yPack] }).checks.length, 0);
  const [entry] = plan().checks;
  assert.equal(entry.check.id, 'a11y-axe');
  assert.equal(entry.check.basis, 'absolute');
  assert.equal(entry.layer, 'package');
});

test('an axe result becomes one finding per node with layer, rule id and evidence', () => {
  const result = run(reduceAxeResults(raw()));
  assert.equal(result.state, 'complete');
  assert.equal(result.findings.length, 5);
  const [first] = result.findings;
  assert.equal(first.layer, 'package');
  assert.equal(first.checkId, 'a11y-axe');
  assert.equal(first.artifact, 'a11y');
  assert.equal(first.severity, 'error');
  assert.equal(first.evidence.ruleId, 'image-alt');
  assert.equal(first.evidence.impact, 'critical');
  assert.equal(first.evidence.selector, '.hero img');
  assert.equal(first.evidence.html, '<img src="hero.png">');
  assert.match(first.evidence.helpUrl, /^https:\/\/dequeuniversity\.com\//);
  assert.equal(first.message, 'image-alt: Images must have alternate text');
  assert.deepEqual(result.findings.map(f => f.severity), ['error', 'error', 'error', 'warning', 'info']);
  assert.equal(result.findings[1].evidence.selector, 'iframe.embed #frame-img');
});

test('a clean result is complete with no finding', () => {
  const result = run(reduceAxeResults({ testEngine: { version: '4.14.0' }, violations: [], incomplete: [] }));
  assert.equal(result.state, 'complete');
  assert.deepEqual(result.findings, []);
});

test('html and selector are capped, and a bad help URL is dropped', () => {
  const data = raw();
  data.violations[0].nodes[0].html = `<img alt="${'x'.repeat(2000)}">`;
  data.violations[0].helpUrl = 'javascript:alert(1)';
  const artifact = reduceAxeResults(data);
  assert.equal(artifact.violations[0].nodes[0].html.length, LIMITS.html);
  assert.equal(artifact.violations[0].helpUrl, null);
});

test('too many nodes are counted, and the check reports missing, never complete (R8.7)', () => {
  const data = { testEngine: { version: '4.14.0' }, incomplete: [], violations: [{ id: 'image-alt', impact: 'critical', help: 'h', helpUrl: 'https://example.com/x', nodes: Array.from({ length: LIMITS.nodes + 3 }, (_, index) => ({ target: [`#n${index}`], html: '<img>' })) }] };
  const artifact = reduceAxeResults(data);
  assert.equal(artifact.omittedNodes, 3);
  assert.equal(artifact.violations[0].nodes.length, LIMITS.nodes);
  const result = run(artifact);
  assert.equal(result.state, 'missing');
  assert.equal(result.checks['a11y-axe'].state, 'missing');
});

test('an axe incomplete rule is not a pass: the check is missing', () => {
  const data = raw();
  data.violations = [];
  data.incomplete = [{ id: 'color-contrast', impact: null, help: 'Contrast', helpUrl: 'https://example.com/c', nodes: [{ target: ['p.over-image'], html: '<p>x</p>' }] }];
  const result = run(reduceAxeResults(data));
  assert.equal(result.state, 'missing');
  assert.equal(result.findings[0].severity, 'info');
  assert.equal(result.findings[0].evidence.state, 'incomplete');
});

test('a missing axe run gives missing, a failed run gives failed (R8.7)', () => {
  const missing = run(gapArtifact('missing', 'axe-core is not installed.'));
  assert.equal(missing.state, 'missing');
  assert.equal(missing.findings[0].evidence.state, 'incomplete');
  const failed = run(gapArtifact('failed', 'boom'));
  assert.equal(failed.state, 'failed');
  assert.match(failed.checks['a11y-axe'].diagnostic, /axe run failed: boom/);
  assert.equal(run(undefined).state, 'missing');
  assert.equal(run(null).checks['a11y-axe'].state, 'missing');
});

test('a malformed artifact fails closed', () => {
  const good = reduceAxeResults(raw());
  const bad = [
    'text', [], { ...good, tool: 'other' }, { ...good, status: 'ok' }, { ...good, violations: 'x' }, { ...good, omittedNodes: -1 }, { ...good, omittedNodes: undefined },
    { ...good, violations: [{ id: 'x', impact: 'huge', nodes: [] }] },
    { ...good, violations: [{ id: 'x', impact: 'minor', nodes: [{}] , help: 'h'}, null] },
    { ...good, violations: [{ id: 'x', impact: 'minor', help: 'h' }] },
  ];
  for (const value of bad) assert.equal(run(value).state, 'failed', JSON.stringify(value).slice(0, 80));
  assert.equal(run(good).state, 'complete');
});

test('a result with no engine version or a non-object is rejected by the reducer', () => {
  for (const value of [null, 'x', {}, { testEngine: {}, violations: [], incomplete: [] }, { testEngine: { version: '4' }, violations: {}, incomplete: [] },
    { testEngine: { version: '4' }, violations: [{ impact: 'minor', nodes: [] }], incomplete: [] }]) assert.throws(() => reduceAxeResults(value));
  assert.throws(() => reduceAxeResults({ testEngine: { version: '4' }, violations: new Array(2), incomplete: [] }), /hole/);
});

test('the pure module does not import axe-core or a browser', () => {
  for (const file of ['axe.js', 'index.js']) {
    const source = readFileSync(new URL(`../../src/packs/a11y/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from 'axe-core|from '@playwright|from 'playwright|require\(/);
  }
  assert.equal(typeof axeFindings, 'function');
});
