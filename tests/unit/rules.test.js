import { comparatorDescriptor } from '../../src/rules/comparator.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRules, normalizeKnown, ruleApplies } from '../../src/rules/model.js';
import { normalizeHtml } from '../../src/rules/normalize.js';
import { findingIsExplained } from '../../src/rules/classify.js';
import { pairKey, policyHash } from '../../src/rules/evidence.js';
const hash = 'sha256:' + 'a'.repeat(64);
const context = { pairKey: hash, kind: 'migration', targetId: 'home', artifact: 'html' };
const rule = (applies = {}) => ({ text: 'Expected token', evidence: 'Observed local response values', applies,
  operation: { kind: 'literal-pair', a: 'token-a', b: 'token-b', maxOccurrences: 1 } });
test('scope is an intersection; omitted axes are unlimited and empty axes match none', () => {
  const rules = normalizeRules({ token: rule({ pairs: [hash], kinds: ['migration'], targets: ['home'], artifacts: ['html'] }) });
  assert.equal(ruleApplies(rules.token, context), true);
  for (const [key, value] of Object.entries({ pairKey: 'other', kind: 'update', targetId: 'other', artifact: 'screenshot' })) assert.equal(ruleApplies(rules.token, { ...context, [key]: value }), false);
  assert.equal(ruleApplies(rule({ targets: [] }), context), false);
  for (const applies of [null, { unsupported: [] }, { kinds: ['bogus'] }, { pairs: ['not-hash'] }, { targets: Array(51).fill('home') }]) assert.equal(ruleApplies(rule(applies), context), false);
  assert.throws(() => normalizeRules({ token: { ...rule(), evidence: '' } }), /Invalid/);
  assert.throws(() => normalizeRules({ token: { ...rule(), operation: { ...rule().operation, a: '' } } }), /Invalid/);
});
test('literal rules preserve full evidence, multiplicity, tokens, overlaps and limits', () => {
  const rules = normalizeRules({ token: rule() });
  assert.deepEqual(normalizeHtml('token-a', 'token-b', rules, context).fired, [{ id: 'token', occurrences: 1 }]);
  for (const [a, b] of [['token-a token-a', 'token-b'], ['missing', 'token-b'], ['token-a [[test-kit-rule:token]]', 'token-b']]) {
    const result = normalizeHtml(a, b, rules, context); assert.equal(result.a, a); assert.equal(result.b, b); assert.equal(result.fired.length, 0); assert.ok(result.diagnostics.length);
  }
  const overlap = normalizeRules({ token: rule(), second: rule() });
  assert.equal(normalizeHtml('token-a', 'token-b', overlap, context).fired.length, 1);
  const outside = normalizeHtml('token-a', 'token-b', normalizeRules({ token: rule({ kinds: ['update'] }) }), context);
  assert.equal(outside.a, 'token-a'); assert.equal(outside.fired.length, 0);
});
test('exact pair and ordered policy hashes cannot be confused', () => {
  assert.notEqual(pairKey('a-b', 'c'), pairKey('a', 'b-c'));
  assert.notEqual(pairKey('a', 'b'), pairKey('b', 'a'));
  assert.notEqual(policyHash({ first: rule(), second: rule() }), policyHash({ second: rule(), first: rule() }));
});
test('scoped causes cannot use stale fingerprints, reversed runs or malformed records', () => {
  const finding = { targetId: 'home', viewportId: 'wide', artifact: 'html', causeId: 'known', evidenceFingerprint: hash,
    acceptance: { aRunId: 'a', bRunId: 'b', pairKey: hash, fingerprint: hash, targetId: 'home', viewportId: 'wide', artifact: 'html' } };
  finding.acceptance.policyHash = hash;
  const report = { meta: { comparisonPolicyHash: hash }, pair: { key: hash, kind: 'migration', aRunId: 'a', bRunId: 'b' }, causes: [{ id: 'known', known: true, acceptance: 'recorded-evidence' }],
    known_diffs: { [hash]: [{ target: 'home', viewport: 'wide', artifact: 'html', cause: 'known', fingerprint: hash, evidence: { policyHash: hash } }] }, rules: {} };
  assert.equal(findingIsExplained(report, finding), true);
  assert.equal(findingIsExplained(report, { ...finding, evidenceFingerprint: 'sha256:' + 'b'.repeat(64) }), false);
  assert.equal(findingIsExplained({ ...report, pair: { ...report.pair, aRunId: 'b', bRunId: 'a' } }, finding), false);
  for (const records of [null, {}, [null]]) assert.equal(findingIsExplained({ ...report, known_diffs: { [hash]: records } }, finding), false);
  report.causes[0].acceptance = 'normalization'; report.rules = normalizeRules({ token: rule({ targets: ['other'] }) });
  assert.equal(findingIsExplained(report, { ...finding, acceptance: { ...finding.acceptance, ruleIds: ['token'] } }), false);
  for (const acceptance of [null, undefined, 'bogus']) { report.causes[0].acceptance = acceptance; assert.equal(findingIsExplained(report, finding), false); }
});
test('known records reject coerced identifiers and duplicate fingerprints', () => {
  const record = { target: 'home', viewport: 'wide', artifact: 'html', cause: 'known', reason: 'Observed change', fingerprint: hash,
    evidence: { rawA: hash, rawB: hash, bindingHash: hash, policyHash: hash } };
  assert.throws(() => normalizeKnown({ [hash]: [{ ...record, target: undefined }] }), /Invalid/);
  assert.throws(() => normalizeKnown({ [hash]: [record, record] }), /Invalid/);
});

test('normalization acceptance requires the complete consistent artifact audit', () => {
  const finding = { targetId: 'home', viewportId: 'wide', artifact: 'html', causeId: 'known', evidenceFingerprint: hash,
    acceptance: { aRunId: 'a', bRunId: 'b', pairKey: hash, fingerprint: hash, targetId: 'home', viewportId: 'wide', artifact: 'html', policyHash: hash, ruleIds: ['token'] } };
  const diff = { rawChanged: true, changed: false, policyHash: hash, firedRuleIds: ['token'] };
  const report = { meta: { comparisonPolicyHash: hash }, pair: { key: hash, kind: 'migration', aRunId: 'a', bRunId: 'b' }, causes: [{ id: 'known', known: true, acceptance: 'normalization' }], rules: normalizeRules({ token: rule() }), entries: [{ id: 'home', viewports: [{ id: 'wide', artifacts: { html: { diff } } }] }] };
  assert.equal(findingIsExplained(report, finding), true);
  for (const patch of [{ changed: true }, { rawChanged: false }, { firedRuleIds: [] }, { policyHash: 'sha256:' + 'b'.repeat(64) }]) {
    Object.assign(diff, patch); assert.equal(findingIsExplained(report, finding), false);
    Object.assign(diff, { rawChanged: true, changed: false, policyHash: hash, firedRuleIds: ['token'] });
  }
  for (const ruleIds of [{ length: 1 }, null, ['constructor'], [null]]) assert.equal(findingIsExplained(report, { ...finding, acceptance: { ...finding.acceptance, ruleIds } }), false);
});

test('comparison binding describes tool and normalization pipeline versions', () => {
  const html = comparatorDescriptor('html', {});
  assert.equal(html.pipelineVersion, 1); assert.equal(html.normalizer.version, 1);
  assert.equal(html.normalizer.mode, 'original-literal-spans');
  assert.equal(comparatorDescriptor('screenshot').version, '8.0.0');
  assert.notDeepEqual(html, { ...html, pipelineVersion: 2 });
});
