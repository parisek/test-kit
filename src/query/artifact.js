import { ruleApplies, isHash } from '../rules/model.js';
import { comparisonDetail } from '../artifacts/schema.js';
import { dirname, basename, resolve } from 'node:path';
import { adaptReport } from '../report/model.js';
import { readSidecar } from '../artifacts/compare.js';

export async function queryArtifact(reportPath, { target, viewport, artifact, maxLines = 40 }) {
  if (!['html', 'status', 'content'].includes(artifact)) throw new Error('Artifact must be html, status, or content.');
  if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 100) throw new Error('maxLines must be 1..100.');
  const path = resolve(reportPath), root = dirname(path);
  const report = adaptReport(JSON.parse(await readSidecar(root, basename(path), 16_000_000)));
  const entry = report.entries.find(entry => entry.id === target);
  if (!entry) throw new Error('Unknown target.');
  const row = entry.viewports.find(row => row.id === viewport);
  if (!row) throw new Error('Unknown target viewport.');
  const index = row.artifacts?.[artifact];
  if (!index) throw new Error('Artifact is not requested.');
  const result = { target, viewport, artifact, state: index.state, diagnostic: typeof index.diagnostic === 'string' ? index.diagnostic.slice(0, 500) : null,
    pairKey: isHash(report.pair.key) ? report.pair.key : null,
    rules: Object.entries(report.rules ?? {}).filter(([, rule]) => ruleApplies(rule, { pairKey: report.pair.key, kind: report.pair.kind, targetId: target, artifact })).slice(0, 50).map(([id, rule]) => ({ id: id.slice(0, 64), text: typeof rule.text === 'string' ? rule.text.slice(0, 500) : '', evidence: rule.evidence.slice(0, 1000) })),
    rulesOmitted: Math.max(0, Object.entries(report.rules ?? {}).filter(([, rule]) => ruleApplies(rule, { pairKey: report.pair.key, kind: report.pair.kind, targetId: target, artifact })).length - 50),
    evidence: { a: index.a?.src ?? null, b: index.b?.src ?? null, normalizedA: index.normalizedA?.src ?? null, normalizedB: index.normalizedB?.src ?? null }, next: 'Open the same target and viewport in the viewer.' };
  if ((index.state === 'complete' || artifact === 'content') && index.diff?.src) {
    const detail = comparisonDetail(artifact, JSON.parse(await readSidecar(root, index.diff.src)));
    if (artifact === 'html') {
      if (!Array.isArray(detail.lines) || detail.lines.length > 100) throw new Error('Invalid HTML difference.');
      const rawWindow = detail.rawWindow ? { ...detail.rawWindow, lines: detail.rawWindow.lines.slice(0, maxLines),
        displayedLines: Math.min(detail.rawWindow.lines.length, maxLines), omittedLines: detail.rawWindow.omittedLines + Math.max(0, detail.rawWindow.lines.length - maxLines) } : undefined;
      result.diff = { ...detail, ...(rawWindow ? { rawWindow } : {}), lines: detail.lines.slice(0, maxLines),
        displayedLines: Math.min(detail.lines.length, maxLines), omittedLines: (detail.omittedLines ?? 0) + Math.max(0, detail.lines.length - maxLines) };
    } else if (artifact === 'content') {
      let remaining = maxLines;
      const boundedSide = side => { const findings = side.findings.slice(0, remaining); remaining -= findings.length; return { ...side, findings, omitted: side.omitted + side.findings.length - findings.length }; };
      result.diff = { ...detail, checks: detail.checks.map(check => ({ ...check, a: boundedSide(check.a), b: boundedSide(check.b) })), findings: detail.findings.slice(0, maxLines), findingsOmitted: Math.max(0, detail.findings.length - maxLines) };
    } else result.diff = detail;
  }
  return result;
}
