// Pure. No DOM, no file system, no axe-core import (R4.4).
// It turns an axe-core result into a stored `a11y` artifact, and the artifact into findings.
// Axe impact maps to severity: minor is info, moderate is warning, serious and critical are error (R7.2).
export const IMPACT_SEVERITY = Object.freeze({ minor: 'info', moderate: 'warning', serious: 'error', critical: 'error' });
// Chosen safety bounds, not measured numbers.
export const LIMITS = Object.freeze({ nodes: 500, html: 300, selector: 300, text: 300, rules: 200 });
const STATUSES = ['complete', 'missing', 'failed'];
const isPlain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const isText = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max;
const cut = (value, max) => (typeof value === 'string' ? (value.length > max ? `${value.slice(0, max - 3)}...` : value) : '');
const list = (value, name) => {
  if (!Array.isArray(value)) throw new Error(`${name} must be a list.`);
  const length = value.length; // one read
  const out = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new Error(`${name} has a hole at index ${index}.`);
    out.push(value[index]);
  }
  return out;
};
// An axe selector path can nest for frames and shadow roots. Join it with a space.
const selectorOf = target => (Array.isArray(target) ? target.flat(Infinity).filter(part => typeof part === 'string').join(' ') : '');
const safeUrl = value => {
  if (typeof value !== 'string' || value.length > 500) return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};

// Reduces one axe-core result. A malformed result throws, so the caller records a failed run.
// It reads each caller field once. It keeps at most LIMITS.nodes nodes and counts the rest.
export function reduceAxeResults(raw) {
  if (!isPlain(raw)) throw new Error('The axe result must be an object.');
  const { violations, incomplete, testEngine } = raw; // one read of each field
  const version = isPlain(testEngine) && isText(testEngine.version, 40) ? testEngine.version : null;
  if (!version) throw new Error('The axe result has no engine version.');
  let budget = LIMITS.nodes;
  let omitted = 0;
  const reduce = (rules, name) => {
    const all = list(rules, name);
    if (all.length > LIMITS.rules) throw new Error(`${name} has too many rules.`);
    return all.map(rule => {
      if (!isPlain(rule)) throw new Error(`${name} has a rule that is not an object.`);
      const { id, impact, help, helpUrl, nodes } = rule;
      if (!isText(id, 100)) throw new Error(`${name} has a rule with no id.`);
      const kept = [];
      for (const node of list(nodes, `Rule ${id} nodes`)) {
        if (!isPlain(node)) throw new Error(`Rule ${id} has a node that is not an object.`);
        if (budget <= 0) { omitted += 1; continue; }
        budget -= 1;
        const { target, html } = node;
        kept.push({ selector: cut(selectorOf(target), LIMITS.selector), html: cut(html, LIMITS.html) });
      }
      return { id, impact: typeof impact === 'string' ? impact : null, help: cut(help, LIMITS.text), helpUrl: safeUrl(helpUrl) ? helpUrl : null, nodes: kept };
    });
  };
  const artifact = { tool: 'axe-core', version, status: 'complete', violations: reduce(violations, 'violations'), incomplete: reduce(incomplete, 'incomplete'), omittedNodes: omitted };
  return artifact;
}

// The artifact for a run that did not give a usable result. `missing` means axe did not run. `failed` means it ran and broke.
export const gapArtifact = (status, reason) => {
  if (status !== 'missing' && status !== 'failed') throw new Error('A gap artifact is missing or failed.');
  return { tool: 'axe-core', status, reason: cut(String(reason ?? 'unknown'), LIMITS.text) };
};

function nodeFindings(rule, node, severity, open) {
  const evidence = { ruleId: rule.id, impact: rule.impact, selector: node.selector, html: node.html, helpUrl: rule.helpUrl, ...(open ? { state: 'incomplete' } : {}) };
  const prefix = open ? `${rule.id} needs review` : rule.id;
  return { severity, message: `${prefix}: ${rule.help || 'No description.'}`.slice(0, 1000), evidence };
}

// The check function. It takes the stored `a11y` artifact and returns findings.
// A `missing` artifact gives one open finding, so the check state is missing (R8.7).
// A `failed` or malformed artifact throws, so the check state is failed (R8.7).
export function axeFindings(value) {
  if (!isPlain(value)) throw new Error('The a11y artifact must be an object.');
  const { tool, status, reason, violations, incomplete, omittedNodes } = value; // one read of each field
  if (tool !== 'axe-core') throw new Error('The a11y artifact is not from axe-core.');
  if (!STATUSES.includes(status)) throw new Error('The a11y artifact has an unknown status.');
  if (status === 'failed') throw new Error(`The axe run failed: ${cut(String(reason ?? 'no reason given'), LIMITS.text)}`);
  if (status === 'missing') {
    return [{ severity: 'info', message: 'The axe run did not happen, so accessibility is not checked.', evidence: { state: 'incomplete', reason: cut(String(reason ?? 'unknown'), LIMITS.text) } }];
  }
  const out = [];
  for (const rule of list(violations, 'violations')) {
    if (!isPlain(rule)) throw new Error('A violation must be an object.');
    const severity = IMPACT_SEVERITY[rule.impact];
    if (!severity) throw new Error(`Rule ${String(rule.id)} has an unknown impact.`); // fail closed
    for (const node of list(rule.nodes, `Rule ${rule.id} nodes`)) out.push(nodeFindings(rule, node, severity, false));
  }
  // An axe "incomplete" rule is a result that axe could not decide. It is not a pass.
  for (const rule of list(incomplete, 'incomplete')) {
    if (!isPlain(rule)) throw new Error('An incomplete rule must be an object.');
    for (const node of list(rule.nodes, `Rule ${rule.id} nodes`)) out.push(nodeFindings(rule, node, 'info', true));
  }
  if (!Number.isInteger(omittedNodes) || omittedNodes < 0) throw new Error('The a11y artifact needs omittedNodes.');
  if (omittedNodes > 0) out.push({ severity: 'info', message: `${omittedNodes} nodes were left out of the artifact, so the list is not complete.`, evidence: { state: 'incomplete', omittedNodes } });
  return out;
}
