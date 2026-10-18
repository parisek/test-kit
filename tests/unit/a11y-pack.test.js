import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveChecks, runChecks } from '../../src/packs/index.js';
import { safeUrl } from '../../src/packs/a11y/axe.js';
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
  assert.deepEqual(reduceAxeResults(raw()).counts, { passes: 1, violations: 4, incomplete: 0, inapplicable: 1 });
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

const base = (extra = {}) => ({ testEngine: { version: '4.14.0' }, violations: [], incomplete: [], passes: [{ id: 'p' }], inapplicable: [], ...extra });
const URL_OK = 'https://dequeuniversity.com/rules/axe/4.14/x';
const rule = (extra = {}) => ({ id: 'image-alt', impact: 'critical', help: 'h', helpUrl: URL_OK, nodes: [{ target: ['#a'], html: '<img>' }], ...extra });

test('a clean result is complete with no finding', () => {
  const result = run(reduceAxeResults(base()));
  assert.equal(result.state, 'complete');
  assert.deepEqual(result.findings, []);
});

test('a run in which no rule ran is failed, never complete (R8.7)', () => {
  const artifact = reduceAxeResults(base({ passes: [] }));
  assert.equal(artifact.status, 'failed');
  assert.match(artifact.reason, /No axe rule ran/);
  assert.equal(run(artifact).state, 'failed');
  assert.equal(reduceAxeResults(base({ passes: [], inapplicable: [{ id: 'x' }] })).status, 'complete');
  // A hand-made complete artifact with zero counts also fails.
  const stored = { ...reduceAxeResults(base()), counts: { passes: 0, violations: 0, incomplete: 0, inapplicable: 0 } };
  assert.equal(run(stored).state, 'failed');
});

test('html and selector are capped, and help URLs are restricted', () => {
  const data = raw();
  data.violations[0].nodes[0].html = `<img alt="${'x'.repeat(2000)}">`;
  const artifact = reduceAxeResults(data);
  assert.equal(artifact.violations[0].nodes[0].html.length, LIMITS.html);
  for (const bad of ['javascript:alert(1)', 'http://dequeuniversity.com/x', 'https://user:pw@dequeuniversity.com/x', 'https://example.com/x', 'https://dequeuniversity.com.example.net/x', 42, undefined]) {
    assert.equal(reduceAxeResults(base({ violations: [rule({ helpUrl: bad })] })).violations[0].helpUrl, null, String(bad));
  }
  assert.equal(safeUrl(URL_OK), true);
});

test('too many violation nodes are counted, and the check reports missing, never complete (R8.7)', () => {
  const nodes = Array.from({ length: LIMITS.nodes + 3 }, (_, index) => ({ target: [`#n${index}`], html: '<img>' }));
  const artifact = reduceAxeResults(base({ violations: [rule({ nodes })] }));
  assert.equal(artifact.omittedNodes, 3);
  assert.equal(artifact.violations[0].nodes.length, LIMITS.nodes);
  const result = run(artifact);
  assert.equal(result.state, 'missing');
  assert.equal(result.checks['a11y-axe'].state, 'missing');
});

test('an axe incomplete rule is a warning to review; the check stays complete and keeps real violations', () => {
  const nodes = Array.from({ length: 9 }, (_, index) => ({ target: [`.n${index}`], html: '<p>x</p>' }));
  const data = base({ violations: [rule()], incomplete: [rule({ id: 'color-contrast', impact: null, nodes }), rule({ id: 'aria-valid-attr-value', impact: null, nodes: [] })] });
  const result = run(reduceAxeResults(data));
  assert.equal(result.state, 'complete');
  assert.equal(result.findings.length, 3);
  assert.equal(result.findings[0].severity, 'error');
  const [, contrast, empty] = result.findings;
  assert.equal(contrast.severity, 'warning');
  assert.equal(contrast.evidence.needsReview, true);
  assert.equal(contrast.evidence.ruleId, 'color-contrast');
  assert.equal(contrast.evidence.nodeCount, 9);
  assert.equal(contrast.evidence.nodes.length, LIMITS.reviewNodes);
  assert.equal('state' in contrast.evidence, false);
  assert.equal(empty.evidence.ruleId, 'aria-valid-attr-value');
  assert.deepEqual(empty.evidence.nodes, []);
  assert.equal(empty.evidence.nodeCount, 0);
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

test('a stored artifact is re-validated and fails closed', () => {
  const good = reduceAxeResults(raw());
  const node = (extra) => ({ selector: '#a', html: '<i>', ...extra });
  const sv = (extra = {}) => ({ id: 'x', impact: 'minor', help: 'h', helpUrl: null, nodeCount: 1, nodes: [node()], ...extra });
  const bad = [
    'text', [], { ...good, tool: 'other' }, { ...good, status: 'ok' }, { ...good, violations: 'x' }, { ...good, omittedNodes: -1 }, { ...good, omittedNodes: undefined },
    { ...good, version: undefined }, { ...good, counts: undefined }, { ...good, counts: { ...good.counts, passes: -1 } },
    { ...good, violations: [sv({ impact: 'huge' })] },
    { ...good, violations: [sv({ impact: 'constructor' })] },
    { ...good, violations: [sv({ impact: 'hasOwnProperty' })] },
    { ...good, violations: [sv(), null] },
    { ...good, violations: [sv({ nodes: undefined })] },
    { ...good, violations: [sv({ nodes: [node({ selector: { a: 1 } })] })] },
    { ...good, violations: [sv({ nodes: [node({ html: 5 })] })] },
    { ...good, violations: [sv({ nodes: [node({ html: 'x'.repeat(LIMITS.html + 1) })] })] },
    { ...good, violations: [sv({ helpUrl: 'https://example.com/x' })] },
    { ...good, violations: [sv({ help: { toString: 'x' } })] },
    { ...good, violations: [sv({ id: {} })] },
    { ...good, violations: [sv({ nodeCount: 'many' })] },
    { ...good, incomplete: [sv({ impact: 5 })] },
  ];
  for (const value of bad) assert.equal(run(value).state, 'failed', JSON.stringify(value).slice(0, 100));
  assert.match(run({ ...good, violations: [sv({ impact: 'constructor' })] }).checks['a11y-axe'].diagnostic, /unknown impact/);
  assert.equal(run(good).state, 'complete');
});

test('the reducer never throws: bad input gives a failed artifact', () => {
  const deep = []; let cursor = deep;
  for (let index = 0; index < 100000; index += 1) { const next = []; cursor.push(next); cursor = next; }
  const wide = Array.from({ length: LIMITS.targetParts + 1 }, () => 'a');
  const many = Array.from({ length: LIMITS.rules + 1 }, (_, index) => rule({ id: `r${index}` }));
  const cases = [null, 'x', {}, { testEngine: {} }, base({ violations: {} }), base({ violations: [{ impact: 'minor', nodes: [] }] }),
    base({ violations: new Array(2) }), base({ violations: [rule({ nodes: undefined })] }), base({ violations: [rule({ nodes: [{ target: deep, html: 'x' }] })] }),
    base({ violations: [rule({ nodes: [{ target: wide, html: 'x' }] })] }), base({ violations: [rule({ nodes: [{ target: [5], html: 'x' }] })] }),
    base({ violations: [rule({ nodes: [{ target: ['a'], html: {} }] })] }), base({ violations: many }), base({ inapplicable: undefined }), base({ passes: 'x' })];
  for (const [index, value] of cases.entries()) {
    const artifact = reduceAxeResults(value);
    assert.equal(artifact.status, 'failed', `case ${index}`);
    assert.equal(typeof artifact.reason, 'string');
  }
  assert.match(reduceAxeResults(base({ violations: many })).reason, /more than 200 rules/);
});

test('a nested frame target is joined with a space', () => {
  const artifact = reduceAxeResults(base({ violations: [rule({ nodes: [{ target: ['iframe', ['#a', ['.b']]], html: 'x' }] })] }));
  assert.equal(artifact.violations[0].nodes[0].selector, 'iframe #a .b');
});

test('the pure module does not import axe-core or a browser', () => {
  for (const file of ['axe.js', 'index.js']) {
    const source = readFileSync(new URL(`../../src/packs/a11y/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from 'axe-core|from '@playwright|from 'playwright|require\(/);
  }
  assert.equal(typeof axeFindings, 'function');
});
