// Pure. Runs a plan over one stored artifact. It fails closed (R8.7, R4.4).
import { isResolvedPlan } from './layers.js';
import { snapshotInput, deepFreeze } from './snapshot.js';
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
  if (typeof evidence.state === 'string' && !OPEN_STATES.includes(evidence.state) && OPEN_STATES.includes(evidence.state.trim().toLowerCase())) throw new Error("Evidence state must be exactly 'incomplete' or 'unknown'.");
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
  const then = returned === null || returned === undefined ? undefined : returned.then; // one read
  if (typeof then === 'function') { then.call(returned, undefined, () => {}); throw new Error('A check must be synchronous.'); }
  if (!Array.isArray(returned)) throw new Error('A check must return a list of findings.');
  const length = returned.length; // one read
  if (length > MAX_FINDINGS) throw new Error('A check must return a list of findings.');
  const items = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(returned, index)) throw new Error('A finding list has a hole.');
    items.push(returned[index]); // one read of each element
  }
  // One clone reads every getter of every finding once. Only the clone is validated and stored.
  return structuredClone(items).map(item => normalizeFinding(item, id, input, context));
}

// The one function that turns untrusted check output into trusted data.
// The caller runs it inside the try of that one check.
function sanitize(check, layer, snapshot, input) {
  const items = normalizeResult(check.check(snapshot.value, snapshot.context), check.id, input, snapshot.context);
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
  // One frozen snapshot of the value and the context, shared by all checks. The loop never reads the caller's objects again.
  let snap;
  try {
    snap = snapshotInput(inputValue, context);
  } catch (error) {
    const why = `The input cannot be used, so no check ran: ${describe(error)}`;
    for (const entry of plan.checks) if (entry.check.applies.artifacts.includes(artifact)) checks[entry.check.id] = state('failed', entry, why);
    return { state: 'failed', findings, checks, overrides: applied };
  }
  const value = snap.value;
  const snapshot = snap.context;
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
    try { result = sanitize(check, layer, snap, artifactInput); } catch (error) {
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
