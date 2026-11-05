import { ruleApplies, isHash } from '../rules/model.js';
import { comparisonDetail } from '../artifacts/schema.js';
import { dirname, basename, resolve } from 'node:path';
import { adaptReport } from '../report/model.js';
import { readSidecar } from '../artifacts/compare.js';
import { ABSOLUTE_ARTIFACTS } from '../report/catalog.js';
import { OUTPUT_BYTE_LIMIT, outputBytes, clip, markCut, wasCut, fitLists } from './bound.js';

const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// R11.2: the answer stays under one byte limit. Cut the lists first. Then drop the difference. A
// report that still does not fit is refused, and it does not reach the agent.
function bounded(result) {
  const lists = () => {
    const out = [], add = (owner, key, counter, last = false) => { if (owner && typeof owner === 'object') out.push({ owner, key, counter, last }); };
    add(result.scope, 'checks', 'checksOmitted', true); add(result, 'rules', 'rulesOmitted', true);
    const diff = result.diff;
    if (diff && typeof diff === 'object') {
      add(diff, 'lines', 'omittedLines'); add(diff.rawWindow, 'lines', 'omittedLines'); add(diff, 'findings', 'findingsOmitted'); add(diff, 'steps', 'stepsOmitted');
      add(diff.a, 'redirects', 'redirectsOmitted'); add(diff.b, 'redirects', 'redirectsOmitted');
      for (const check of Array.isArray(diff.checks) ? diff.checks : []) for (const side of [check?.a, check?.b]) add(side, 'findings', 'omitted');
    }
    return out;
  };
  if (fitLists(result, lists)) return result;
  if (result.diff) { delete result.diff; result.diffOmitted = true; result.next = 'Open the same target and viewport in the viewer. The difference exceeds the query byte limit.'; }
  if (outputBytes(result) > OUTPUT_BYTE_LIMIT) throw new Error('The answer exceeds the query byte limit. Open the report in the viewer.');
  return result;
}

export async function queryArtifact(reportPath, { target, viewport, artifact, maxLines = 40 }) {
  const absolute = ABSOLUTE_ARTIFACTS.includes(artifact);
  if (!['html', 'status', 'content', 'behavior', 'lighthouse', ...ABSOLUTE_ARTIFACTS].includes(artifact)) throw new Error('Artifact must be html, status, content, behavior, lighthouse, lint, or a11y.');
  if (viewport == null && !absolute) throw new Error('Artifact needs a viewport.');
  if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 100) throw new Error('maxLines must be 1..100.');
  const path = resolve(reportPath), root = dirname(path);
  const report = adaptReport(JSON.parse(await readSidecar(root, basename(path), 16_000_000)));
  const entry = report.entries.find(entry => entry.id === target);
  if (!entry) throw new Error('Unknown target.');
  // An absolute result sits at viewport scope or at target scope (R9.9).
  const row = viewport == null ? null : entry.viewports.find(row => row.id === viewport);
  if (viewport != null && !row) throw new Error('Unknown target viewport.');
  const index = (row ? row.artifacts : entry.artifacts)?.[artifact];
  if (!index) throw new Error('Artifact is not requested.');
  const pairContext = { pairKey: report.pair?.key, kind: report.pair?.kind ?? 'single-run', targetId: target, artifact };
  const result = { target: markCut(target), ...(wasCut(target) ? { targetTruncated: true } : {}), viewport: viewport == null ? viewport : markCut(viewport), ...(wasCut(viewport) ? { viewportTruncated: true } : {}), artifact, state: clip(index.state, 64), diagnostic: typeof index.diagnostic === 'string' ? index.diagnostic.slice(0, 500) : null,
    pairKey: isHash(report.pair?.key) ? report.pair.key : null,
    rules: Object.entries(report.rules ?? {}).filter(([, rule]) => ruleApplies(rule, pairContext)).slice(0, 50).map(([id, rule]) => ({ id: id.slice(0, 64), text: typeof rule.text === 'string' ? rule.text.slice(0, 500) : '', evidence: rule.evidence.slice(0, 1000) })),
    rulesOmitted: Math.max(0, Object.entries(report.rules ?? {}).filter(([, rule]) => ruleApplies(rule, pairContext)).length - 50),
    evidence: { a: index.a?.src ?? null, b: index.b?.src ?? null, normalizedA: index.normalizedA?.src ?? null, normalizedB: index.normalizedB?.src ?? null }, next: 'Open the same target and viewport in the viewer.' };
  if (absolute || report.subject) {
    // An absolute index has one piece of evidence and a bounded result. The sidecar format belongs to the pack that wrote it.
    result.evidence = { run: index.evidence?.src ?? null };
    // Copy the documented fields only. The validator checks these two and ignores other keys (untrusted data, R11.2).
    result.result = isPlain(index.result) ? { violations: index.result.violations === true, checks: Number.isSafeInteger(index.result.checks) ? index.result.checks : 0 } : null;
    result.scope = Array.isArray(index.scope?.checks) ? { checks: index.scope.checks.filter(id => typeof id === 'string').slice(0, 500).map(id => id.slice(0, 128)) } : null;
    result.next = 'Open the same target in the viewer.';
    return bounded(result);
  }
  if ((index.state === 'complete' || artifact === 'content' || artifact === 'behavior' || artifact === 'lighthouse') && index.diff?.src) {
    const detail = comparisonDetail(artifact, JSON.parse(await readSidecar(root, index.diff.src)));
    if (artifact === 'html') {
      if (!Array.isArray(detail.lines) || detail.lines.length > 100) throw new Error('Invalid HTML difference.');
      const rawWindow = detail.rawWindow ? { ...detail.rawWindow, lines: detail.rawWindow.lines.slice(0, maxLines),
        displayedLines: Math.min(detail.rawWindow.lines.length, maxLines), omittedLines: detail.rawWindow.omittedLines + Math.max(0, detail.rawWindow.lines.length - maxLines) } : undefined;
      result.diff = { ...detail, ...(rawWindow ? { rawWindow } : {}), lines: detail.lines.slice(0, maxLines),
        displayedLines: Math.min(detail.lines.length, maxLines), omittedLines: (detail.omittedLines ?? 0) + Math.max(0, detail.lines.length - maxLines) };
    } else if (artifact === 'lighthouse') {
      result.diff = { ...detail, findings: detail.findings.slice(0, maxLines), findingsOmitted: Math.max(0, detail.findings.length - maxLines) };
    } else if (artifact === 'behavior') {
      const steps = [];
      let bytes = 0;
      for (const step of detail.steps) {
        if (steps.length >= maxLines) break;
        const encoded = JSON.stringify(step);
        if (bytes + encoded.length > OUTPUT_BYTE_LIMIT) break;
        steps.push(step); bytes += encoded.length;
      }
      result.diff = { ...detail, steps, stepsOmitted: detail.steps.length - steps.length };
      if (!steps.length && detail.steps.length) result.next = 'Open the behavior sidecar in the viewer. The first step exceeds the query byte limit.';
    } else if (artifact === 'content') {
      let remaining = maxLines;
      const boundedSide = side => { const findings = side.findings.slice(0, remaining); remaining -= findings.length; return { ...side, findings, omitted: side.omitted + side.findings.length - findings.length }; };
      result.diff = { ...detail, checks: detail.checks.map(check => ({ ...check, a: boundedSide(check.a), b: boundedSide(check.b) })), findings: detail.findings.slice(0, maxLines), findingsOmitted: Math.max(0, detail.findings.length - maxLines) };
    } else result.diff = detail;
  }
  return bounded(result);
}
