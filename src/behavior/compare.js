// Pure A/B alignment. Missing and incompatible evidence never becomes a match.
export function compareBehavior(a, b) {
  if (!a || !b) return { state: 'missing', steps: [] };
  if (a.settingsHash !== b.settingsHash || a.version !== b.version) return { state: 'incompatible', steps: [] };
  const byA = new Map(a.steps.map(step => [step.id, step]));
  const byB = new Map(b.steps.map(step => [step.id, step]));
  const ids = [...new Set([...byA.keys(), ...byB.keys()])];
  return { state: a.state === 'missing' || b.state === 'missing' ? 'missing' : a.state === 'complete' && b.state === 'complete' ? 'complete' : 'failed', steps: ids.map(id => {
    const resultA = byA.get(id) ?? null, resultB = byB.get(id) ?? null;
    const failed = [resultA, resultB].some(result => result?.state === 'failed' || result?.state === 'incompatible');
    const same = resultA && resultB && resultA.state === resultB.state && JSON.stringify(resultA.result ?? null) === JSON.stringify(resultB.result ?? null);
    return { id, title: resultB?.title ?? resultA?.title, state: failed ? 'failed' : same ? 'same' : 'changed', resultA, resultB };
  }) };
}

export function validateBehaviorComparison(value) {
  if (!value || !['complete', 'failed', 'missing', 'incompatible'].includes(value.state) || typeof value.changed !== 'boolean' || !Array.isArray(value.steps) || value.steps.length > 3000) throw new Error('Invalid behavior comparison.');
  const safePath = path => typeof path === 'string' && path.length <= 2000 && /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..');
  for (const trace of [value.traceA, value.traceB]) if (trace != null && (!safePath(trace) || !trace.endsWith('.zip'))) throw new Error('Unsafe behavior trace.');
  const ids = new Set();
  for (const step of value.steps) {
    if (!step || typeof step.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(step.id) || typeof step.title !== 'string' || step.title.length > 2000 || !['same', 'changed', 'failed'].includes(step.state)) throw new Error('Invalid behavior comparison step.');
    if (ids.has(step.id)) throw new Error('Duplicate behavior step.');
    ids.add(step.id);
    if (step.state === 'same' && (!step.resultA || !step.resultB || step.resultA.state !== step.resultB.state || ['failed', 'incompatible'].includes(step.resultA.state) || JSON.stringify(step.resultA.result ?? null) !== JSON.stringify(step.resultB.result ?? null))) throw new Error('Invalid matching behavior step.');
    if (value.state === 'complete' && step.state === 'failed') throw new Error('Failed behavior must remain incomplete.');
    for (const result of [step.resultA, step.resultB]) if (result != null) {
      if (!['complete', 'failed', 'skipped', 'incompatible'].includes(result.state)) throw new Error('Invalid behavior result.');
      if (result.evidence?.screenshot != null && (!safePath(result.evidence.screenshot) || !result.evidence.screenshot.endsWith('.png'))) throw new Error('Unsafe behavior screenshot.');
      for (const key of ['console', 'network', 'dataLayer']) if (result.evidence?.[key] != null && (!Array.isArray(result.evidence[key]) || result.evidence[key].length > 100)) throw new Error('Invalid behavior events.');
      if (result.error != null && (typeof result.error !== 'string' || result.error.length > 2000)) throw new Error('Invalid behavior error.');
    }
  }
  if (JSON.stringify(value).length > 2 * 1024 * 1024) throw new Error('Behavior comparison exceeds its limit.');
  return value;
}
