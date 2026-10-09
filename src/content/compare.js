import { builtinChecks, CHECK_VERSION, runContentChecks } from '../checks/index.js';
import { validateContentSnapshot } from './snapshot.js';
const MAX_FINDINGS = 50;
const MAX_BYTES = 2 * 1024 * 1024;
function side(findings) {
  const omitted = Math.max(0, findings.length - MAX_FINDINGS);
  const retained = findings.slice(0, MAX_FINDINGS);
  const incomplete = omitted > 0 || findings.some(item => ['unknown', 'incomplete'].includes(item.evidence?.state));
  return { state: incomplete ? 'incomplete' : findings.length ? 'failed' : 'passed', findings: retained, omitted };
}
export function compareContentSnapshots(before, after, options = {}) {
  const a = validateContentSnapshot(before), b = validateContentSnapshot(after);
  const ids = options.checks ?? [];
  runContentChecks(a, ids, options);
  const context = { targetId: options.targetId, viewportId: options.viewportId, expectedLanguage: options.expectedLanguage };
  const checks = ids.map(id => ({ id, title: builtinChecks[id].title,
    a: side(id === 'text-difference' ? [] : builtinChecks[id].check(a, { ...context, responses: options.responsesA })),
    b: side(builtinChecks[id].check(b, { ...context, responses: options.responsesB, before: a })) }));
  const result = { schemaVersion: 1, checkVersion: CHECK_VERSION, changed: false, incomplete: false, checks, findings: [] };
  const update = () => {
    result.findings = checks.flatMap(check => check.b.findings.filter(item => !['unknown', 'incomplete'].includes(item.evidence?.state)));
    result.changed = result.findings.length > 0;
    result.incomplete = checks.some(check => [check.a, check.b].some(side => side.state === 'incomplete'));
  };
  update();
  while (new TextEncoder().encode(JSON.stringify(result)).length > MAX_BYTES) {
    const candidate = checks.flatMap(check => [check.a, check.b]).sort((a, b) => b.findings.length - a.findings.length)[0];
    if (!candidate?.findings.length) throw new Error('Content comparison exceeds its limit.');
    candidate.findings.pop(); candidate.omitted++; candidate.state = 'incomplete'; update();
  }
  return validateContentComparison(result);
}
export function validateContentComparison(value) {
  const fail = () => { throw new Error('Invalid content comparison.'); };
  if (!value || value.schemaVersion !== 1 || value.checkVersion !== CHECK_VERSION || typeof value.changed !== 'boolean'
    || typeof value.incomplete !== 'boolean' || !Array.isArray(value.checks) || value.checks.length > 50
    || !Array.isArray(value.findings) || value.findings.length > 2500) fail();
  const finding = item => {
    if (!item || item.artifact !== 'content' || !Object.hasOwn(builtinChecks, item.checkId)
      || !['warning', 'info', 'error'].includes(item.severity) || typeof item.message !== 'string' || item.message.length > 2000
      || (item.targetId !== undefined && (typeof item.targetId !== 'string' || item.targetId.length > 2000))
      || (item.viewportId !== undefined && (typeof item.viewportId !== 'string' || item.viewportId.length > 2000))
      || !item.evidence || typeof item.evidence !== 'object' || Array.isArray(item.evidence)) fail();
    // JSON cloning removes prototypes. Evidence stays data, never markup.
    const bytes = JSON.stringify(item.evidence);
    if (bytes.length > 20000) fail();
    return { ...(item.targetId !== undefined ? { targetId: item.targetId } : {}), ...(item.viewportId !== undefined ? { viewportId: item.viewportId } : {}), artifact: 'content', checkId: item.checkId, severity: item.severity, message: item.message, evidence: JSON.parse(bytes) };
  };
  const seen = new Set();
  const checks = value.checks.map(check => {
    if (!check || !Object.hasOwn(builtinChecks, check.id) || seen.has(check.id) || check.title !== builtinChecks[check.id].title) fail();
    seen.add(check.id);
    const parseSide = side => {
      if (!side || !['passed', 'failed', 'incomplete'].includes(side.state) || !Array.isArray(side.findings) || side.findings.length > MAX_FINDINGS
        || !Number.isSafeInteger(side.omitted) || side.omitted < 0 || side.omitted > 1000000) fail();
      const findings = side.findings.map(finding);
      if (findings.some(item => item.checkId !== check.id)) fail();
      const incomplete = side.omitted > 0 || findings.some(item => ['unknown', 'incomplete'].includes(item.evidence.state));
      const expected = incomplete ? 'incomplete' : findings.length ? 'failed' : 'passed';
      if (side.state !== expected) fail();
      return { state: side.state, findings, omitted: side.omitted };
    };
    return { id: check.id, title: check.title, a: parseSide(check.a), b: parseSide(check.b) };
  });
  const findings = value.findings.map(finding);
  const expected = checks.flatMap(check => check.b.findings.filter(item => !['unknown', 'incomplete'].includes(item.evidence.state)));
  if (JSON.stringify(findings) !== JSON.stringify(expected) || value.changed !== (findings.length > 0)
    || value.incomplete !== checks.some(check => check.a.state === 'incomplete' || check.b.state === 'incomplete')) fail();
  const result = { schemaVersion: 1, checkVersion: CHECK_VERSION, changed: value.changed, incomplete: value.incomplete, checks, findings };
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_BYTES) fail();
  return result;
}
