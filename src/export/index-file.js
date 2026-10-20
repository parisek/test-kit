import { validId } from '../history/index.js';

// Pure writer for the publish `index.json` (R10.13). No file system, no DOM (R4.4).
// Input: the result of `scanHistory`, a clock value, and the report ids whose evidence is unavailable.

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => (typeof value === 'string' ? value : null);

function isoOrNull(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.toISOString() !== value ? null : value;
}

function hashOrNull(value) {
  return typeof value === 'string' && value.startsWith('sha256:') ? value : null;
}

// Newest first, `null` last, ties by id descending. Plain `>` comparison, not `localeCompare`.
function compare(a, b) {
  if (a.createdAt !== b.createdAt) {
    if (a.createdAt === null) return 1;
    if (b.createdAt === null) return -1;
    return a.createdAt > b.createdAt ? -1 : 1;
  }
  if (a.id === b.id) return 0;
  return a.id > b.id ? -1 : 1;
}

function clockIso(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error('The clock value is not a valid time.');
  return date.toISOString();
}

/**
 * Build the `index.json` object of a publish directory (R10.13).
 * @param {{ runs?: Array<{id: string, value?: object, error?: string}>, reports?: Array<{id: string, value?: object, error?: string}> }} history result of `scanHistory`
 * @param {{ now: Date|number|string, unavailableReportIds?: Iterable<string> }} options `now` is the clock; `unavailableReportIds` names readable reports whose evidence is missing or oversized
 * @returns {{ schemaVersion: 1, generatedAt: string, reports: object[], runs: object[] }}
 */
export function buildPublishIndex(history, { now, unavailableReportIds = [] } = {}) {
  const generatedAt = clockIso(now);
  const unavailable = new Set(unavailableReportIds);
  const scanned = list => (Array.isArray(list) ? list : []).filter(entry => isObject(entry) && validId(entry.id));

  const runHashes = new Map();
  const runs = scanned(history?.runs).map(({ id, value }) => {
    if (!isObject(value)) return { id, createdAt: null, settingsHash: null, path: null };
    const settingsHash = hashOrNull(value.settingsHash);
    runHashes.set(id, settingsHash);
    return { id, createdAt: isoOrNull(value.at), settingsHash, path: `runs/${id}/run.json` };
  });

  const runHash = runId => (validId(runId) ? runHashes.get(runId) ?? null : null);

  const reports = scanned(history?.reports).map(({ id, value }) => {
    if (!isObject(value)) return { id, kind: null, createdAt: null, settingsHash: null, path: null, targets: null };
    let kind = null;
    let settingsHash = null;
    if (isObject(value.pair)) {
      kind = text(value.pair.kind);
      const a = runHash(value.pair.aRunId);
      const b = runHash(value.pair.bRunId);
      settingsHash = a !== null && a === b ? a : null;
    } else if (isObject(value.subject)) {
      kind = text(value.subject.kind);
      settingsHash = runHash(value.subject.runId);
    }
    return {
      id,
      kind,
      createdAt: isoOrNull(isObject(value.meta) ? value.meta.generated : undefined),
      settingsHash,
      path: unavailable.has(id) ? null : `reports/${id}/report.json`,
      targets: Array.isArray(value.entries) ? value.entries.length : null,
    };
  });

  return { schemaVersion: 1, generatedAt, reports: reports.sort(compare), runs: runs.sort(compare) };
}
