import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { readSidecar } from '../artifacts/compare.js';
import { artifactState } from '../artifacts/state.js';
import { relativePath } from '../report/safe.js';
import { settingsHash } from '../config/settings.js';
import { comparePerformance, validatePerformanceSnapshot, extractMetrics, METRICS } from './model.js';

const MAX_RAW_BYTES = 20 * 1024 * 1024;
const MAX_SUMMARY_BYTES = 2 * 1024 * 1024;
const identity = value => typeof value === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_-]{0,199}$/.test(value);

async function store(root, src, bytes) {
  if (!relativePath(src)) throw new Error('Unsafe performance output path.');
  await mkdir(dirname(join(root, src)), { recursive: true });
  await writeFile(join(root, src), bytes, { mode: 0o600 });
}

export async function comparePerformanceArtifact({ a, b, ac, bc, runsRoot, output, targetId, viewportId,
  environmentA = a?.side, environmentB = b?.side, budgets = {}, failOnBudget = false }) {
  if (![a?.id, b?.id, targetId, viewportId].every(identity)) throw new Error('Invalid performance comparison identity.');
  const indexes = [ac?.artifacts?.lighthouse, bc?.artifacts?.lighthouse];
  const result = { kind: 'lighthouse', state: artifactState(...indexes), a: null, b: null, diff: null };
  const snapshots = [];
  for (const [index, run, side] of [[indexes[0], a, 'a'], [indexes[1], b, 'b']]) {
    if (index?.state !== 'captured') { snapshots.push(null); continue; }
    try {
      const snapshot = validatePerformanceSnapshot(index.path
        ? JSON.parse(await readSidecar(join(runsRoot, run.id), index.path)) : index);
      if (snapshot.settingsHash !== index.settingsHash || snapshot.version !== index.version || snapshot.browserVersion !== index.browserVersion) {
        throw new Error('Performance index and snapshot provenance differ.');
      }
      const reports = [];
      for (const [number, report] of snapshot.reports.entries()) {
        if (!relativePath(report.json) || !relativePath(report.html) || !report.json.endsWith('.json') || !report.html.endsWith('.html')) {
          throw new Error('Unsafe performance report path.');
        }
        const json = await readSidecar(join(runsRoot, run.id), report.json, MAX_RAW_BYTES);
        const raw = JSON.parse(json);
        const measured = extractMetrics(raw);
        if (raw.lighthouseVersion !== snapshot.version || raw.environment?.hostUserAgent !== snapshot.browserVersion
          || Object.keys(METRICS).some(metric => measured[metric] !== snapshot.metrics[metric].samples[number])) {
          throw new Error('Raw performance report does not match its samples.');
        }
        const html = await readSidecar(join(runsRoot, run.id), report.html, MAX_RAW_BYTES);
        const jsonSrc = `runs/${run.id}/${report.json}`, htmlSrc = `runs/${run.id}/${report.html}`;
        await store(output, jsonSrc, json); await store(output, htmlSrc, html);
        reports.push({ json: { kind: 'lighthouse', src: jsonSrc, bytes: json.length },
          html: { kind: 'lighthouse', src: htmlSrc, bytes: html.length } });
      }
      const summary = { ...snapshot, reports };
      const bytes = Buffer.from(JSON.stringify(summary));
      if (bytes.length > MAX_SUMMARY_BYTES) throw new Error('Performance summary exceeds its limit.');
      const src = `summary/lighthouse/${targetId}/${viewportId}-${side}.json`;
      await store(output, src, bytes);
      result[side] = { kind: 'lighthouse', src, tool: snapshot.tool, version: snapshot.version,
        settingsHash: snapshot.settingsHash, browserVersion: snapshot.browserVersion, bytes: bytes.length, reports };
      snapshots.push(snapshot);
    } catch {
      snapshots.push(null); result.state = 'failed'; result.diagnostic = 'Performance evidence is missing, invalid, or exceeds its limit.';
    }
  }
  if (!snapshots.every(Boolean)) {
    result.diagnostic ??= 'Requested performance evidence is incomplete.';
    return { artifact: result, findings: [], exitCode: 0 };
  }
  const comparison = comparePerformance(...snapshots, { environmentA, environmentB, budgets, failOnBudget });
  const detail = { ...comparison, a: { settings: snapshots[0].settings, metrics: snapshots[0].metrics, suspect: snapshots[0].suspect },
    b: { settings: snapshots[1].settings, metrics: snapshots[1].metrics, suspect: snapshots[1].suspect } };
  const bytes = Buffer.from(JSON.stringify(detail));
  if (bytes.length > MAX_SUMMARY_BYTES) throw new Error('Performance comparison exceeds its limit.');
  const src = `diff/lighthouse/${targetId}/${viewportId}.json`;
  await store(output, src, bytes);
  result.state = comparison.compatible ? 'complete' : 'incompatible';
  if (!comparison.compatible) result.diagnostic = comparison.reason;
  result.diff = { kind: 'lighthouse', src, tool: 'test-kit-performance-compare', version: '1',
    settingsHash: settingsHash({ environmentA, environmentB, budgets, policy: 'observed-full-range-v1' }),
    compatible: comparison.compatible, changed: comparison.compatible && (Object.values(comparison.metrics).some(metric => metric.state !== 'within-noise') || comparison.findings.some(finding => finding.cause === 'performance-budget')),
    bytes: bytes.length };
  return { artifact: result, findings: comparison.findings.map(finding => ({ ...finding, targetId, viewportId })), exitCode: comparison.exitCode };
}
