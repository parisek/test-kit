// Pure configuration and scope checks (R4.4, R8.4, R8.5).
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
export const isHash = value => typeof value === 'string' && HASH.test(value);
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
function fail() { throw new Error('Invalid evidenced comparison policy.'); }
function keys(value, allowed) { if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(); }

export function normalizeScope(input) {
  const value = input === undefined ? {} : input;
  keys(value, ['pairs', 'artifacts', 'kinds', 'targets']);
  return Object.fromEntries(Object.entries(value).map(([axis, values]) => {
    if (!Array.isArray(values) || values.length > 50 || new Set(values).size !== values.length || values.some(value => !text(value, 200))) fail();
    if (axis === 'pairs' && values.some(value => !isHash(value))) fail();
    if (axis === 'artifacts' && values.some(value => !['screenshot', 'html', 'status'].includes(value))) fail();
    if (axis === 'kinds' && values.some(value => !['convergence', 'self-baseline', 'update', 'migration', 'deploy', 'adhoc'].includes(value))) fail();
    if (axis === 'targets' && values.some(value => !ID.test(value))) fail();
    return [axis, [...values]];
  }));
}
export function normalizeRules(input = {}) {
  if (!plain(input) || Object.keys(input).length > 50) fail();
  return Object.fromEntries(Object.entries(input).map(([id, rule]) => {
    if (!ID.test(id)) fail();
    keys(rule, ['text', 'evidence', 'applies', 'operation']);
    if (!text(rule.text, 500) || !text(rule.evidence, 1000)) fail();
    const applies = normalizeScope(rule.applies);
    keys(rule.operation, ['kind', 'a', 'b', 'maxOccurrences']);
    const operation = rule.operation;
    if (operation.kind !== 'literal-pair' || !text(operation.a, 2000) || !text(operation.b, 2000)
      || operation.a.includes('[[test-kit-rule:') || operation.b.includes('[[test-kit-rule:')
      || !Number.isInteger(operation.maxOccurrences) || operation.maxOccurrences < 1 || operation.maxOccurrences > 20) fail();
    return [id, { text: rule.text, evidence: rule.evidence, applies, operation: { ...operation } }];
  }));
}
export function ruleApplies(rule, context) {
  if (!plain(rule) || !text(rule.evidence, 1000)) return false;
  let scope;
  try { scope = normalizeScope(rule.applies); } catch { return false; }
  const map = { pairs: context.pairKey, artifacts: context.artifact, kinds: context.kind, targets: context.targetId };
  for (const [axis, values] of Object.entries(scope)) {
    if (!Object.hasOwn(map, axis) || !Array.isArray(values) || values.some(value => typeof value !== 'string')
      || !values.includes(map[axis])) return false;
  }
  return true;
}
export function normalizeKnown(input = {}) {
  if (!plain(input) || Object.keys(input).length > 100) fail();
  return Object.fromEntries(Object.entries(input).map(([pair, records]) => {
    if (!isHash(pair) || !Array.isArray(records) || records.length > 100) fail();
    const fingerprints = new Set();
    return [pair, records.map(record => {
      keys(record, ['target', 'viewport', 'artifact', 'cause', 'reason', 'fingerprint', 'evidence']);
      if (![record.target, record.viewport, record.cause].every(value => typeof value === 'string' && ID.test(value))
        || !['screenshot', 'html'].includes(record.artifact) || !text(record.reason, 1000)
        || !isHash(record.fingerprint)) fail();
      if (fingerprints.has(record.fingerprint)) fail();
      fingerprints.add(record.fingerprint);
      keys(record.evidence, ['rawA', 'rawB', 'bindingHash', 'policyHash']);
      if (!Object.values(record.evidence).every(isHash) || Object.keys(record.evidence).length !== 4) fail();
      return { ...record, evidence: { ...record.evidence } };
    })];
  }));
}
