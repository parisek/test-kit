// Pure. No DOM, no file system, no axe-core import (R4.4).
// It turns an axe-core result into a stored `a11y` artifact, and the artifact into findings.
// Axe impact maps to severity: minor is info, moderate is warning, serious and critical are error (R7.2).
export const IMPACT_SEVERITY = Object.freeze({ minor: 'info', moderate: 'warning', serious: 'error', critical: 'error' });
// Chosen safety bounds, not measured numbers.
export const LIMITS = Object.freeze({ nodes: 500, reviewNodes: 5, reviewEscaped: 600, count: 1e9, html: 300, selector: 300, text: 300, rules: 200, targetDepth: 5, targetParts: 50 });
// Axe sets help URLs on this host only.
const HELP_HOST = 'dequeuniversity.com';
const STATUSES = ['complete', 'missing', 'failed'];
const COUNTS = ['passes', 'violations', 'incomplete', 'inapplicable'];
const isPlain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const isText = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max;
const isString = (value, max) => typeof value === 'string' && value.length <= max;
const cut = (value, max) => (value.length > max ? `${value.slice(0, max - 3)}...` : value);
const reasonText = value => { try { return cut(String(value ?? 'unknown'), LIMITS.text); } catch { return 'unknown'; } };
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
// An axe selector path can nest for frames and shadow roots. This flatten is iterative, with a depth cap and a part cap.
function selectorOf(target) {
  const parts = [];
  const stack = [{ items: list(target, 'target'), index: 0 }];
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (top.index >= top.items.length) { stack.pop(); continue; }
    const item = top.items[top.index++];
    if (typeof item === 'string') {
      parts.push(item);
      if (parts.length > LIMITS.targetParts) throw new Error('A node target is too long.');
    } else if (Array.isArray(item)) {
      if (stack.length >= LIMITS.targetDepth) throw new Error('A node target is nested too deep.');
      stack.push({ items: list(item, 'target'), index: 0 });
    } else throw new Error('A node target has a part that is not text.');
  }
  return parts.join(' ');
}
// Returns the normalized help URL, or null. Only https on the axe help host, with no credentials, port or whitespace.
export const normalizeUrl = value => {
  if (typeof value !== 'string' || value.length > 500 || /\s/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === '' && url.hostname === HELP_HOST ? url.href : null;
  } catch { return null; }
};
export const safeUrl = value => normalizeUrl(value) !== null;
const count = (value, name) => list(value, name).length;
const escapedLength = value => JSON.stringify(value).length - 2;
// Cuts a text to `max` characters, then until its JSON-escaped form fits `maxEscaped` (control characters grow to 6 characters).
function cutEscaped(value, max, maxEscaped) {
  let out = cut(value, max);
  while (escapedLength(out) > maxEscaped) out = cut(out, Math.max(4, Math.floor(out.length * 0.8)));
  return out;
}
const safeCount = value => Number.isSafeInteger(value) && value >= 0 && value <= LIMITS.count;

function reduceRules(rules, name, state, kind) {
  const all = list(rules, name);
  if (all.length > LIMITS.rules) throw new Error(`${name} has more than ${LIMITS.rules} rules.`);
  const review = kind === 'incomplete';
  return all.map(rule => {
    if (!isPlain(rule)) throw new Error(`${name} has a rule that is not an object.`);
    const { id, impact, help, helpUrl, nodes } = rule; // one read of each field
    if (!isText(id, 100)) throw new Error(`${name} has a rule with no id.`);
    if (!review && (typeof impact !== 'string' || !Object.hasOwn(IMPACT_SEVERITY, impact))) throw new Error(`Rule ${id} has an unknown impact.`);
    if (review && impact !== null && impact !== undefined && !isString(impact, 20)) throw new Error(`Rule ${id} has an unusable impact.`);
    const kept = [];
    const found = list(nodes, `Rule ${id} nodes`);
    let omitted = 0;
    for (const node of found) {
      if (!isPlain(node)) throw new Error(`Rule ${id} has a node that is not an object.`);
      const { target, html } = node;
      if (!isString(html, 1e6)) throw new Error(`Rule ${id} has a node with no html text.`);
      const selector = selectorOf(target);
      const limit = review ? LIMITS.reviewEscaped : LIMITS.html * 6;
      const item = () => ({ selector: cutEscaped(selector, LIMITS.selector, review ? LIMITS.reviewEscaped : limit), html: cutEscaped(html, LIMITS.html, limit) });
      if (review) { if (kept.length < LIMITS.reviewNodes) kept.push(item()); continue; }
      if (state.budget <= 0) { omitted += 1; state.omitted += 1; continue; }
      state.budget -= 1;
      kept.push(item());
    }
    const url = normalizeUrl(helpUrl);
    return { id, impact: typeof impact === 'string' ? impact : null, help: isString(help, 1e5) ? cut(help, LIMITS.text) : '', helpUrl: url, nodeCount: found.length, omitted: review ? 0 : omitted, nodes: kept };
  });
}

// Reduces one axe-core result. It never throws: a malformed result gives a `failed` artifact (R8.7).
// It reads each caller field once. It keeps at most LIMITS.nodes violation nodes and counts the rest.
export function reduceAxeResults(raw) {
  try {
    if (!isPlain(raw)) throw new Error('The axe result must be an object.');
    const { violations, incomplete, passes, inapplicable, testEngine } = raw; // one read of each field
    const version = isPlain(testEngine) && isText(testEngine.version, 40) ? testEngine.version : null;
    if (!version) throw new Error('The axe result has no engine version.');
    const state = { budget: LIMITS.nodes, omitted: 0 };
    const reducedViolations = reduceRules(violations, 'violations', state, 'violations');
    const reducedIncomplete = reduceRules(incomplete, 'incomplete', state, 'incomplete');
    const counts = { passes: count(passes, 'passes'), violations: reducedViolations.length, incomplete: reducedIncomplete.length, inapplicable: count(inapplicable, 'inapplicable') };
    // A run in which no rule ran is not a pass (R8.7). Typical cause: tags that match no rule.
    if (counts.passes + counts.violations + counts.incomplete + counts.inapplicable === 0) throw new Error('No axe rule ran.');
    return { tool: 'axe-core', version, status: 'complete', counts, violations: reducedViolations, incomplete: reducedIncomplete, omittedNodes: state.omitted };
  } catch (error) {
    return gapArtifact('failed', error?.message ?? error);
  }
}

// The artifact for a run that did not give a usable result. `missing` means axe did not run. `failed` means it ran and broke.
export const gapArtifact = (status, reason) => {
  if (status !== 'missing' && status !== 'failed') throw new Error('A gap artifact is missing or failed.');
  return { tool: 'axe-core', status, reason: reasonText(reason) };
};

// Re-validates one stored rule. The stored file is untrusted data, so the check does not trust the reducer.
// For a violation rule: nodeCount equals retained nodes plus omitted nodes. For an incomplete rule: nodeCount is at least the retained nodes.
function storedRules(rules, name, review) {
  const all = list(rules, name);
  if (all.length > LIMITS.rules) throw new Error(`${name} has too many rules.`);
  return all.map(rule => {
    if (!isPlain(rule)) throw new Error(`${name} has a rule that is not an object.`);
    const { id, impact, help, helpUrl, nodeCount, omitted, nodes } = rule; // one read of each field
    if (!isText(id, 100)) throw new Error(`${name} has a rule with no id.`);
    if (!isString(help, LIMITS.text)) throw new Error(`Rule ${id} needs a help text.`);
    if (helpUrl !== null && (typeof helpUrl !== 'string' || normalizeUrl(helpUrl) !== helpUrl)) throw new Error(`Rule ${id} has an unusable help URL.`);
    if (!review && (typeof impact !== 'string' || !Object.hasOwn(IMPACT_SEVERITY, impact))) throw new Error(`Rule ${id} has an unknown impact.`);
    if (review && impact !== null && !isString(impact, 20)) throw new Error(`Rule ${id} has an unusable impact.`);
    if (!safeCount(nodeCount) || !safeCount(omitted)) throw new Error(`Rule ${id} needs nodeCount and omitted as safe counts.`);
    const kept = list(nodes, `Rule ${id} nodes`);
    if (kept.length > LIMITS.nodes || (review && kept.length > LIMITS.reviewNodes)) throw new Error(`Rule ${id} has too many nodes.`);
    const stored = kept.map(node => {
      if (!isPlain(node)) throw new Error(`Rule ${id} has a node that is not an object.`);
      const { selector, html } = node;
      const max = review ? LIMITS.reviewEscaped : LIMITS.html * 6;
      if (!isString(selector, LIMITS.selector) || !isString(html, LIMITS.html) || escapedLength(selector) > max || escapedLength(html) > max) throw new Error(`Rule ${id} has a node with unusable selector or html.`);
      return { selector, html };
    });
    if (review) { if (omitted !== 0 || nodeCount < stored.length) throw new Error(`Rule ${id} has inconsistent counts.`); } else if (nodeCount !== stored.length + omitted) throw new Error(`Rule ${id} has inconsistent counts: nodeCount is not retained nodes plus omitted.`);
    return { id, impact, help, helpUrl, nodeCount, omitted, nodes: stored };
  });
}

// The check function. It takes the stored `a11y` artifact and returns findings.
// A `missing` artifact gives one open finding, so the check state is missing (R8.7).
// A `failed` or malformed artifact throws, so the check state is failed (R8.7).
// An axe `incomplete` rule gives one `warning` finding with `needsReview: true`.
// Cut evidence gives one `warning` finding with `truncated: true`. Neither opens the check (see README).
export function axeFindings(value) {
  if (!isPlain(value)) throw new Error('The a11y artifact must be an object.');
  const { tool, status, reason, version, counts, violations, incomplete, omittedNodes } = value; // one read of each field
  if (tool !== 'axe-core') throw new Error('The a11y artifact is not from axe-core.');
  if (!STATUSES.includes(status)) throw new Error('The a11y artifact has an unknown status.');
  if (status === 'failed') throw new Error(`The axe run failed: ${reasonText(reason ?? 'no reason given')}`);
  if (status === 'missing') {
    return [{ severity: 'info', message: 'The axe run did not happen, so accessibility is not checked.', evidence: { state: 'incomplete', reason: reasonText(reason) } }];
  }
  if (!isText(version, 40)) throw new Error('The a11y artifact needs the axe version.');
  if (!isPlain(counts) || COUNTS.some(key => !safeCount(counts[key]))) throw new Error('The a11y artifact needs rule counts as safe integers.');
  if (counts.passes + counts.violations + counts.incomplete + counts.inapplicable === 0) throw new Error('No axe rule ran.');
  if (!safeCount(omittedNodes)) throw new Error('The a11y artifact needs omittedNodes.');
  const bad = storedRules(violations, 'violations', false);
  const review = storedRules(incomplete, 'incomplete', true);
  if (counts.violations !== bad.length || counts.incomplete !== review.length) throw new Error('The rule counts do not match the stored rules.');
  if (bad.reduce((sum, rule) => sum + rule.omitted, 0) !== omittedNodes) throw new Error('omittedNodes does not match the omitted nodes of the rules.');
  if (bad.reduce((sum, rule) => sum + rule.nodes.length, 0) > LIMITS.nodes) throw new Error('The artifact keeps too many violation nodes.');
  const out = [];
  for (const rule of bad) {
    const severity = IMPACT_SEVERITY[rule.impact];
    const message = `${rule.id}: ${rule.help || 'No description.'}`;
    // Every violation rule gives at least one finding, even when it kept no node.
    const items = rule.nodes.length ? rule.nodes : [{ selector: '', html: '' }];
    for (const node of items) out.push({ severity, message, evidence: { ruleId: rule.id, impact: rule.impact, selector: node.selector, html: node.html, nodeCount: rule.nodeCount, helpUrl: rule.helpUrl } });
  }
  // An axe "incomplete" rule is a result that axe could not decide. It needs a human review. It is one finding for each rule, even with no node.
  for (const rule of review) {
    out.push({ severity: 'warning', message: `${rule.id} needs review: ${rule.help || 'No description.'}`, evidence: { ruleId: rule.id, needsReview: true, impact: rule.impact, nodeCount: rule.nodeCount, nodes: rule.nodes, helpUrl: rule.helpUrl } });
  }
  // Cut evidence never reads as a clean page: the kept violations stay, and one warning says the list is cut.
  if (omittedNodes > 0) out.push({ severity: 'warning', message: `${omittedNodes} violation nodes were left out of the artifact, so the list is not complete.`, evidence: { truncated: true, omittedNodes } });
  return out;
}
