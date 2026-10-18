// Pure. Runs a plan over one stored artifact. It fails closed (R8.7, R4.4).
const OPEN_STATES = ['incomplete', 'unknown'];
const inScope = (scope, facts) => Object.entries(scope).every(([key, values]) => {
  const fact = { targets: facts.targetId, artifacts: facts.artifact, kinds: facts.kind }[key];
  return typeof fact === 'string' && values.includes(fact);
});
const state = (state, entry, diagnostic) => ({ state, layer: entry.layer, packId: entry.packId, ...(diagnostic ? { diagnostic } : {}) });

function validFindings(result, id) {
  if (!Array.isArray(result) || result.length > 1000) return false;
  return result.every(item => item && typeof item === 'object' && !Array.isArray(item) && typeof item.message === 'string' && (item.checkId === undefined || item.checkId === id) && (item.severity === undefined || typeof item.severity === 'string'));
}

export function runChecks(plan, input, context = {}) {
  if (!plan || !Array.isArray(plan.checks) || !Array.isArray(plan.overrides)) throw new Error('Invalid check plan.');
  if (!input || typeof input.artifact !== 'string' || input.artifact === '') throw new Error('Invalid check input.');
  const facts = { targetId: context.targetId, artifact: input.artifact, kind: context.kind };
  const components = Array.isArray(context.components) ? context.components : [];
  const findings = [];
  const checks = {};
  const applied = [];
  for (const entry of plan.checks) {
    const { check, layer } = entry;
    if (!check.applies.artifacts.includes(input.artifact)) continue;
    if (check.applies.components && !check.applies.components.some(name => components.includes(name))) continue;
    const override = plan.overrides.find(item => item.checkId === check.id && inScope(item.scope, facts));
    if (override) {
      applied.push(override);
      checks[check.id] = state('missing', entry, `Switched off by a ${override.layer} override. Reason: ${override.reason} Owner: ${override.owner}.`);
      continue;
    }
    if (input.value === undefined || input.value === null) { checks[check.id] = state('missing', entry, 'The check has no input.'); continue; }
    if (check.basis === 'relative' && (context.before === undefined || context.before === null)) { checks[check.id] = state('missing', entry, 'A relative check needs a prior artifact in context.before.'); continue; }
    let result;
    try { result = check.check(input.value, { ...context }); } catch (error) {
      checks[check.id] = state('failed', entry, `The check threw: ${String(error?.message ?? error).slice(0, 200)}`);
      continue;
    }
    if (typeof result?.then === 'function') result.then(undefined, () => {}); // a check is sync; drop a late rejection
    if (!validFindings(result, check.id)) { checks[check.id] = state('failed', entry, 'The check returned a result that is not a list of findings.'); continue; }
    const tagged = result.map(item => ({ ...item, checkId: check.id, layer }));
    findings.push(...tagged);
    const open = tagged.some(item => OPEN_STATES.includes(item.evidence?.state));
    checks[check.id] = open ? state('missing', entry, 'The check reports incomplete or unknown evidence.') : state('complete', entry);
  }
  const states = Object.values(checks).map(item => item.state);
  const overall = states.includes('failed') ? 'failed' : states.length === 0 || states.includes('missing') ? 'missing' : 'complete';
  return { state: overall, findings, checks, overrides: applied };
}
