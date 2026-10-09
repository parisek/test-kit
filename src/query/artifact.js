import { comparisonDetail } from '../artifacts/schema.js';
import { dirname, basename, resolve } from 'node:path';
import { adaptReport } from '../report/model.js';
import { readSidecar } from '../artifacts/compare.js';

export async function queryArtifact(reportPath, { target, viewport, artifact, maxLines = 40 }) {
  if (!['html', 'status'].includes(artifact)) throw new Error('Artifact must be html or status.');
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
    evidence: { a: index.a?.src ?? null, b: index.b?.src ?? null }, next: 'Open the same target and viewport in the viewer.' };
  if (index.state === 'complete' && index.diff?.src) {
    const detail = comparisonDetail(artifact, JSON.parse(await readSidecar(root, index.diff.src)));
    if (artifact === 'html') {
      if (!Array.isArray(detail.lines) || detail.lines.length > 100) throw new Error('Invalid HTML difference.');
      result.diff = { ...detail, lines: detail.lines.slice(0, maxLines),
        displayedLines: Math.min(detail.lines.length, maxLines), omittedLines: (detail.omittedLines ?? 0) + Math.max(0, detail.lines.length - maxLines) };
    } else result.diff = detail;
  }
  return result;
}
