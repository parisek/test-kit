// Pure. Runs a plan over one stored artifact. It fails closed (R8.7, R4.4).
import { isResolvedPlan } from './layers.js';
const OPEN_STATES = ['incomplete', 'unknown'];
const SEVERITIES = ['info', 'warning', 'error'];
const FINDING_KEYS = ['targetId', 'viewportId', 'artifact', 'checkId', 'severity', 'message', 'evidence'];
// Chosen safety bounds, not measured numbers.
const MAX_FINDINGS = 1000;
const MAX_MESSAGE = 1000;
const MAX_EVIDENCE = 10000;

const inScope = (scope, facts) => Object.entries(scope).every(([key, values]) => {
  const fact = { targets: facts.targetId, artifacts: facts.artifact, kinds: facts.kind }[key];
  return typeof fact === 'string' && values.includes(fact);
});
const state = (state, entry, diagnostic) => ({ state, layer: entry.layer, packId: entry.packId, ...(diagnostic ? { diagnostic } : {}) });
const isPlain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const describe = error => {
  try { return String(error?.message ?? error).slice(0, 200); } catch { return 'The check threw a value that cannot be read.'; }
};
const str = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max;

// Types that stay mutable after Object.freeze, or that freeze cannot cover.
const isByRef = value => value instanceof Map || value instanceof Set || value instanceof Date || value instanceof ArrayBuffer || ArrayBuffer.isView(value);
// Freezes plain data once. It returns true when the data holds a by-reference type, so each check needs its own copy.
function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  let byRef = isByRef(value);
  if (!byRef) Object.freeze(value);
  for (const key of byRef ? [] : Reflect.ownKeys(value)) byRef = deepFreeze(value[key], seen) || byRef;
  // A Map or Set holds entries that freeze does not reach. Walk them only to find nested by-reference types.
  if (value instanceof Map) for (const [k, v] of value) { deepFreeze(k, seen); deepFreeze(v, seen); }
  if (value instanceof Set) for (const v of value) deepFreeze(v, seen);
  return byRef;
}
const frozenCopy = value => {
  if (value === undefined || value === null) return { value, byRef: false };
  const copy = structuredClone(value);
  return { value: copy, byRef: deepFreeze(copy) };
};

// Copies one finding into a plain frozen object. It throws on any bad shape.
// All reads of untrusted properties happen here, inside the try of one check.
function normalizeFinding(item, id, input, context) {
  if (!isPlain(item)) throw new Error('A finding must be a plain object.');
  for (const key of Reflect.ownKeys(item)) if (!FINDING_KEYS.includes(key)) throw new Error('A finding has an unknown key.');
  const { targetId = context.targetId, viewportId = context.viewportId, artifact = input.artifact, checkId = id, severity, message, evidence } = item;
  if (!str(targetId, 200)) throw new Error('A finding needs a targetId.');
  if (viewportId !== undefined && !str(viewportId, 200)) throw new Error('A finding has an invalid viewportId.');
  if (artifact !== input.artifact || checkId !== id) throw new Error('A finding names another artifact or check.');
  if (!SEVERITIES.includes(severity)) throw new Error('A finding needs severity info, warning or error.');
  if (!str(message, MAX_MESSAGE)) throw new Error('A finding needs a message.');
  if (!isPlain(evidence)) throw new Error('A finding needs an evidence object.');
  // The caller's result was cloned once, so `evidence` is already our own copy.
  // The open marker is read from the stored copy. A `state` that is present but not a string is invalid.
  if (Object.hasOwn(evidence, 'state') && typeof evidence.state !== 'string') throw new Error('Evidence state must be a string.');
  const json = JSON.stringify(evidence);
  if (typeof json !== 'string' || json.length > MAX_EVIDENCE) throw new Error('A finding has unusable or oversized evidence.');
  const copy = JSON.parse(json);
  if (!isPlain(copy)) throw new Error('Evidence is not a plain object after copying.');
  if (Object.hasOwn(evidence, 'state') !== Object.hasOwn(copy, 'state')) throw new Error('Evidence state did not survive copying.');
  const finding = { targetId, ...(viewportId !== undefined ? { viewportId } : {}), artifact, checkId, severity, message, evidence: copy };
  deepFreeze(finding);
  return { open: OPEN_STATES.includes(copy.state), finding };
}

function normalizeResult(returned, id, input, context) {
  if (typeof returned?.then === 'function') { returned.then(undefined, () => {}); throw new Error('A check must be synchronous.'); }
  if (!Array.isArray(returned) || returned.length > MAX_FINDINGS) throw new Error('A check must return a list of findings.');
  // One clone of the whole result reads every getter, length and element once. Only the clone is validated and stored.
  const result = structuredClone(returned);
  if (result.length > MAX_FINDINGS) throw new Error('A check must return a list of findings.');
  const out = [];
  for (let index = 0; index < result.length; index += 1) {
    if (!Object.hasOwn(result, index)) throw new Error('A finding list has a hole.');
    out.push(normalizeFinding(result[index], id, input, context));
  }
  return out;
}

// The one function that turns untrusted check output into trusted data.
// The caller runs it inside the try of that one check.
function sanitize(check, layer, snapshotValue, input, snapshot) {
  // Frozen plain data is shared. A snapshot with a Map, Set, Date or buffer gives each check its own fresh copy.
  let value = snapshotValue.value;
  let context = snapshot.value;
  if (snapshotValue.byRef) { value = structuredClone(value); deepFreeze(value); }
  if (snapshot.byRef) { context = structuredClone(context); deepFreeze(context); }
  const items = normalizeResult(check.check(value, context), check.id, input, context);
  return { findings: items.map(item => Object.freeze({ ...item.finding, layer })), open: items.some(item => item.open) };
}

export function runChecks(plan, input, context = {}) {
  if (!isResolvedPlan(plan)) throw new Error('Invalid check plan. Build it with resolveChecks.');
  if (!input || typeof input !== 'object') throw new Error('Invalid check input.');
  const { artifact, value: inputValue } = input; // one read of each field
  if (typeof artifact !== 'string' || artifact === '') throw new Error('Invalid check input.');
  if (!isPlain(context)) throw new Error('Invalid check context.');
  const findings = [];
  const checks = {};
  const applied = [];
  // One snapshot of the stored value and the whole context. The loop never reads the caller's objects again.
  let valueSnap;
  let contextSnap;
  try {
    valueSnap = frozenCopy(inputValue);
    contextSnap = frozenCopy(context);
  } catch {
    for (const entry of plan.checks) if (entry.check.applies.artifacts.includes(artifact)) checks[entry.check.id] = state('failed', entry, 'The input or context cannot be copied, so no check ran.');
    return { state: 'failed', findings, checks, overrides: applied };
  }
  const value = valueSnap.value;
  const snapshot = contextSnap.value;
  const artifactInput = Object.freeze({ artifact });
  const facts = { targetId: snapshot.targetId, artifact, kind: snapshot.kind };
  for (const entry of plan.checks) {
    const { check, layer } = entry;
    if (!check.applies.artifacts.includes(artifact)) continue;
    let gap = null;
    if (check.applies.components) {
      if (!Array.isArray(snapshot.components)) gap = 'A component check needs context.components.';
      else if (!check.applies.components.some(name => snapshot.components.includes(name))) continue;
    }
    if (!gap && (value === undefined || value === null)) gap = 'The check has no input.';
    else if (!gap && check.basis === 'relative' && (snapshot.before === undefined || snapshot.before === null)) gap = 'A relative check needs a prior artifact in context.before.';
    const override = plan.overrides.find(item => item.checkId === check.id && inScope(item.scope, facts));
    if (override) {
      applied.push(override);
      const why = `Switched off by a ${override.layer} override. Reason: ${override.reason} Owner: ${override.owner}.`;
      checks[check.id] = state('missing', entry, gap ? `${gap} Also: ${why}` : why);
      continue;
    }
    if (gap) { checks[check.id] = state('missing', entry, gap); continue; }
    let result;
    try { result = sanitize(check, layer, valueSnap, artifactInput, contextSnap); } catch (error) {
      checks[check.id] = state('failed', entry, `The check failed: ${describe(error)}`);
      continue;
    }
    findings.push(...result.findings);
    checks[check.id] = result.open ? state('missing', entry, 'The check reports incomplete or unknown evidence.') : state('complete', entry);
  }
  const states = Object.values(checks).map(item => item.state);
  const overall = states.includes('failed') ? 'failed' : states.length === 0 || states.includes('missing') ? 'missing' : 'complete';
  return { state: overall, findings, checks, overrides: applied };
}
