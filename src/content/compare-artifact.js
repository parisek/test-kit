import { comparatorIndex } from '../rules/evidence.js';
import { gunzipSync } from 'node:zlib';
import { storedResponses as responses } from './responses.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { readSidecar } from '../artifacts/compare.js';
import { artifactState } from '../artifacts/state.js';
import { settingsHash } from '../config/settings.js';
import { validateContentSnapshot } from './snapshot.js';
import { compareContentSnapshots } from './compare.js';
import { CHECK_VERSION } from '../checks/index.js';

export async function compareContentArtifact({ a, b, ac, bc, runsRoot, output, targetId, viewportId, contentChecks, contentExpectedLanguage }) {
  const indexes = [ac?.artifacts?.content, bc?.artifacts?.content];
  const result = { kind: 'content', state: artifactState(...indexes), a: null, b: null, diff: null };
  const policy = run => ({ checks: contentChecks ?? run.settings.checks ?? [], expectedLanguage: contentExpectedLanguage ?? run.settings.content?.expectedLanguage ?? null });
  const viewport = run => run.settings.viewports.find(item => item.id === viewportId);
  if (result.state === 'complete' && (settingsHash(policy(a)) !== settingsHash(policy(b))
    || settingsHash(viewport(a)) !== settingsHash(viewport(b))
    || settingsHash(a.captureSettings?.browser ?? null) !== settingsHash(b.captureSettings?.browser ?? null))) result.state = 'incompatible';
  const snapshots = [];
  for (const [index, run, side] of [[indexes[0], a, 'a'], [indexes[1], b, 'b']]) {
    if (index?.state !== 'captured') { snapshots.push(null); continue; }
    try {
      const stored = await readSidecar(join(runsRoot, run.id), index.path);
      if (!index.path.endsWith('.json.gz')) throw new Error('Content storage compression is missing.');
      const body = gunzipSync(stored, { maxOutputLength: 2 * 1024 * 1024 });
      const snapshot = validateContentSnapshot(JSON.parse(body));
      const src = `runs/${run.id}/${index.path.slice(0, -3)}`;
      await mkdir(dirname(join(output, src)), { recursive: true }); await writeFile(join(output, src), body); snapshots.push(snapshot);
      result[side] = { kind: 'content', src, tool: index.tool, version: index.version, settingsHash: index.settingsHash, browserVersion: index.browserVersion, bytes: body.length };
    } catch { snapshots.push(null); result.state = 'failed'; result.diagnostic = 'Content snapshot is missing, invalid, or exceeds its limit.'; }
  }
  if (result.state === 'complete' && snapshots.every(Boolean)) {
    const checks = policy(b).checks;
    const detail = compareContentSnapshots(...snapshots, { checks, expectedLanguage: policy(b).expectedLanguage,
      targetId, viewportId, responsesA: responses(a, viewportId), responsesB: responses(b, viewportId) });
    const src = `diff/content/${targetId}/${viewportId}.json`;
    await mkdir(dirname(join(output, src)), { recursive: true }); await writeFile(join(output, src), JSON.stringify(detail));
    result.diff = { kind: 'content', src, tool: 'test-kit-content-checks', version: CHECK_VERSION,
      ...comparatorIndex('content', {}, policy(b)), changed: detail.changed, incomplete: detail.incomplete, checks: checks.length };
    if (detail.incomplete || !checks.length) { result.state = 'missing'; result.diagnostic = detail.incomplete ? 'Content checks have unknown or incomplete evidence.' : 'No content checks are selected.'; }
    return { artifact: result, findings: detail.findings };
  }
  result.diagnostic ??= result.state === 'incompatible' ? 'Content settings, extractor versions, or check policies differ.' : 'Requested content evidence is incomplete.';
  return { artifact: result, findings: [] };
}
