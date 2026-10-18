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
const str = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;

function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]); }
  return value;
}
const frozenCopy = value => (value === undefined || value === null ? value : deepFreeze(structuredClone(value)));

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
  const json = JSON.stringify(evidence);
  if (typeof json !== 'string' || json.length > MAX_EVIDENCE) throw new Error('A finding has unusable or oversized evidence.');
  return deepFreeze({ targetId, ...(viewportId !== undefined ? { viewportId } : {}), artifact, checkId, severity, message, evidence: JSON.parse(json) });
}

function normalizeResult(result, id, input, context) {
  if (typeof result?.then === 'function') { result.then(undefined, () => {}); throw new Error('A check must be synchronous.'); }
  if (!Array.isArray(result) || result.length > MAX_FINDINGS) throw new Error('A check must return a list of findings.');
  const out = [];
  for (let index = 0; index < result.length; index += 1) {
    if (!Object.hasOwn(result, index)) throw new Error('A finding list has a hole.');
    out.push(normalizeFinding(result[index], id, input, context));
  }
  return out;
}

export function runChecks(plan, input, context = {}) {
  if (!isResolvedPlan(plan)) throw new Error('Invalid check plan. Build it with resolveChecks.');
  if (!input || typeof input.artifact !== 'string' || input.artifact === '') throw new Error('Invalid check input.');
  const value = frozenCopy(input.value);
  const frozenContext = Object.freeze({ ...context, before: frozenCopy(context.before) });
  const artifactInput = { artifact: input.artifact, value };
  const facts = { targetId: context.targetId, artifact: input.artifact, kind: context.kind };
  const findings = [];
  const checks = {};
  const applied = [];
  for (const entry of plan.checks) {
    const { check, layer } = entry;
    if (!check.applies.artifacts.includes(input.artifact)) continue;
    let gap = null;
    if (check.applies.components) {
      if (!Array.isArray(context.components)) gap = 'A component check needs context.components.';
      else if (!check.applies.components.some(name => context.components.includes(name))) continue;
    }
    if (!gap && (value === undefined || value === null)) gap = 'The check has no input.';
    else if (!gap && check.basis === 'relative' && (context.before === undefined || context.before === null)) gap = 'A relative check needs a prior artifact in context.before.';
    const override = plan.overrides.find(item => item.checkId === check.id && inScope(item.scope, facts));
    if (override) {
      applied.push(override);
      const why = `Switched off by a ${override.layer} override. Reason: ${override.reason} Owner: ${override.owner}.`;
      checks[check.id] = state('missing', entry, gap ? `${gap} Also: ${why}` : why);
      continue;
    }
    if (gap) { checks[check.id] = state('missing', entry, gap); continue; }
    let tagged;
    try { tagged = normalizeResult(check.check(value, frozenContext), check.id, artifactInput, frozenContext).map(item => Object.freeze({ ...item, layer })); } catch (error) {
      checks[check.id] = state('failed', entry, `The check failed: ${String(error?.message ?? error).slice(0, 200)}`);
      continue;
    }
    findings.push(...tagged);
    const open = tagged.some(item => OPEN_STATES.includes(item.evidence.state));
    checks[check.id] = open ? state('missing', entry, 'The check reports incomplete or unknown evidence.') : state('complete', entry);
  }
  const states = Object.values(checks).map(item => item.state);
  const overall = states.includes('failed') ? 'failed' : states.length === 0 || states.includes('missing') ? 'missing' : 'complete';
  return { state: overall, findings, checks, overrides: applied };
}
