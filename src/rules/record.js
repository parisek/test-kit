import { gunzipSync } from 'node:zlib';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { normalizeConfig } from '../config/normalize.js';
import { adaptReport } from '../report/model.js';
import { readSidecar } from '../artifacts/compare.js';
import { evidenceBinding, policyHash, comparatorIndex } from './evidence.js';
export async function recordKnown({ reportPath, configPath, target, viewport, artifact, cause, reason }) {
  if (typeof cause !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(cause ?? '') || typeof reason !== 'string'
    || !reason.trim() || reason.length > 1000 || /[\x00-\x1f\x7f]/.test(reason)) throw new Error('Cause and reason must be bounded evidence text.');
  const file = resolve(configPath), original = await readSidecar(dirname(file), file.split('/').at(-1), 16_000_000);
  if (original.length > 16_000_000) throw new Error('Configuration exceeds the size limit.');
  const config = normalizeConfig(JSON.parse(original));
  const reportFile = resolve(reportPath);
  const report = adaptReport(JSON.parse(await readSidecar(dirname(reportFile), reportFile.split('/').at(-1), 16_000_000)));
  const entry = report.entries.find(entry => entry.id === target), row = entry?.viewports.find(row => row.id === viewport);
  const finding = report.findings.find(finding => finding.targetId === target && finding.viewportId === viewport && finding.artifact === artifact);
  if (!entry || entry.judge === 'oracle' || !row
    || (row.artifacts?.[artifact]?.state ?? row.state) !== 'complete' || !finding) throw new Error('Record one complete non-oracle finding.');
  if (report.meta.comparisonPolicyHash !== policyHash(config.rules)) throw new Error('Comparison policy changed. Compare again before recording.');
  const contentPolicy = { checks: config.checks ?? [], expectedLanguage: config.content?.expectedLanguage ?? null };
  const expected = comparatorIndex(artifact, config.rules, contentPolicy), diff = row.artifacts?.[artifact]?.diff;
  if (!diff || Object.keys(expected).some(key => diff[key] !== expected[key])) throw new Error('Comparator provenance changed. Compare again.');
  const binding = await evidenceBinding({ runsRoot: resolve(dirname(file), config.runsRoot),
    aRunId: report.pair.aRunId, bRunId: report.pair.bRunId, targetId: target, viewportId: viewport, artifact, rules: config.rules, contentPolicy });
  if (binding.fingerprint !== finding.evidenceFingerprint || binding.pairKey !== report.pair.key
    || binding.sources.some((src, index) => src !== row.artifacts?.[artifact]?.[index ? 'b' : 'a']?.src)) throw new Error('Stored evidence changed or does not belong to this finding. Compare again.');
  // Verify the report's raw copies too. Caller-supplied fingerprints are not proof.
  const { byteHash } = await import('./evidence.js');
  for (const [index, src] of binding.sources.entries()) {
    const bytes = await readSidecar(dirname(reportFile), src, artifact !== 'screenshot' ? 2 * 1024 * 1024 : 80_000_000);
    let matches;
    if (artifact === 'content') {
      const runId = index ? report.pair.bRunId : report.pair.aRunId;
      const storedPath = src.slice(('runs/' + runId + '/').length) + '.gz';
      const compressed = await readSidecar(resolve(dirname(file), config.runsRoot), runId + '/' + storedPath);
      matches = byteHash(compressed) === binding.evidence[index ? 'rawB' : 'rawA'] && bytes.equals(gunzipSync(compressed, { maxOutputLength: 2 * 1024 * 1024 }));
    } else matches = byteHash(bytes) === binding.evidence[index ? 'rawB' : 'rawA'];
    if (!matches) throw new Error('Report evidence differs from its stored run.');
  }
  const records = config.known_diffs[binding.pairKey] ?? [];
  if (records.some(record => record.fingerprint === binding.fingerprint)) throw new Error('This exact evidence is already recorded.');
  const updated = normalizeConfig({ ...config, known_diffs: { ...config.known_diffs, [binding.pairKey]: [...records, {
    target, viewport, artifact, cause, reason, fingerprint: binding.fingerprint, evidence: binding.evidence,
  }] } });
  await commitConfig(file, original, updated);
  return { pairKey: binding.pairKey, fingerprint: binding.fingerprint,
    next: 'Compare the same runs into a new output directory. Existing reports are unchanged.' };
}

export async function commitConfig(file, original, updated) {
  const temporary = file + '.test-kit-' + process.pid + '-' + Date.now() + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(updated, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    if (!(await readSidecar(dirname(file), file.split('/').at(-1), 16_000_000)).equals(original)) throw new Error('Configuration changed during recording. No update is written.');
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => {}); }
}
