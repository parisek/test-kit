// Turns the stored pack artifact of run B into an absolute result of the v3 model (R9.9, R13.51).
// It reads the sidecar that `capture --packs` wrote, runs the pack checks over it and returns the artifact index and the findings.
// Only side B enters the report, as for the content checks (ADR 0004, "Open points", 1). A run with no pack artifact adds nothing (R5.1).
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { readSidecar } from '../artifacts/compare.js';
import { builtinPacks } from '../packs/builtin.js';
import { resolveChecks } from '../packs/layers.js';
import { runChecks } from '../packs/run.js';
import { absoluteFingerprints } from '../allowlist/fingerprint.js';

const MAX_BYTES = 2 * 1024 * 1024;
const PACK_OF_ARTIFACT = Object.freeze({ a11y: 'a11y' });
const STATE = Object.freeze({ complete: 'complete', missing: 'missing', failed: 'failed' });
const clean = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);

export const PACK_ARTIFACT_KINDS = Object.freeze(Object.keys(PACK_OF_ARTIFACT));

// Returns { artifact, findings, catalog } or null when run B stored no artifact of this kind.
export async function comparePackArtifact({ kind, b, bc, runsRoot, output, targetId, viewportId }) {
  const index = bc?.artifacts?.[kind];
  if (!index || !PACK_OF_ARTIFACT[kind]) return null;
  const plan = resolveChecks({ available: builtinPacks, packs: [PACK_OF_ARTIFACT[kind]] });
  // The selection comes from the plan of the stored artifact, never from the viewer (R8.7).
  const scope = { checks: plan.checks.map(entry => entry.check.id) };
  const catalog = Object.fromEntries(plan.checks.map(entry => [entry.check.id, { basis: entry.check.basis, layer: entry.layer, title: entry.check.title }]));
  const gap = (state, diagnostic) => ({ artifact: { state, diagnostic, scope }, findings: [], catalog });
  if (typeof index.path !== 'string') return gap('failed', index.error?.message ?? 'The pack stored no result.');
  let value;
  let evidence;
  try {
    const body = await readSidecar(join(runsRoot, b.id), index.path, MAX_BYTES);
    value = JSON.parse(body);
    const src = `runs/${b.id}/${index.path}`;
    await mkdir(dirname(join(output, src)), { recursive: true });
    await writeFile(join(output, src), body);
    evidence = { src, tool: index.tool, version: index.version, settingsHash: index.settingsHash };
  } catch {
    return gap('failed', 'The pack result is missing, invalid, or exceeds its limit.');
  }
  const result = runChecks(plan, { artifact: kind, value }, { targetId, viewportId });
  const state = STATE[result.state] ?? 'failed';
  const diagnostics = Object.values(result.checks).map(check => check.diagnostic).filter(Boolean);
  // R9.8: every absolute finding gets its fingerprint from the evidence of the check, which stays out of the report index.
  const prints = absoluteFingerprints(result.findings.map(finding => catalog[finding.checkId]?.basis === 'absolute'
    ? { checkId: finding.checkId, targetId, viewportId, artifact: kind, message: finding.message, evidence: finding.evidence } : null));
  const findings = result.findings.map((finding, number) => {
    const selector = finding.evidence?.selector;
    return {
      ...prints[number], id: `${kind}-${targetId}-${viewportId}-${finding.checkId}-${number}`, targetId, viewportId, artifact: kind, checkId: finding.checkId,
      layer: finding.layer, runId: b.id, severity: finding.severity, message: finding.message, evidence: finding.evidence,
      ...(clean(selector, 500) ? { location: { selector } } : {}),
    };
  });
  const artifact = state === 'complete'
    ? { state, scope, evidence, result: { violations: findings.some(item => item.evidence?.needsReview !== true && item.evidence?.truncated !== true), checks: Object.keys(result.checks).length } }
    : { state, scope, evidence, diagnostic: (diagnostics[0] ?? `The ${kind} pack did not complete.`).slice(0, 500) };
  return { artifact, findings, catalog };
}
