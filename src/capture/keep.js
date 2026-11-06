// R5.13: keep-existing references. This file holds the pure rules: which stored capture may stand for a cell,
// and what the new entry is. It reads no file system. Stored data is untrusted, so every field is checked.
import { settingsHash } from '../config/settings.js';
import { sanitizeDropped } from '../report/dropped.js';
import { REFERENCE_KEPT, sanitizeWarnings, withWarning } from '../report/warnings.js';

// A run ID is `createRunId`: an ISO time with `:` and `.` replaced by `-`, the process ID and a git SHA.
const RUN_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-\d{1,10}-[a-f0-9]{7,40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const KINDS = ['html', 'status', 'content'];
const PROVENANCE_KEYS = ['tool', 'version', 'browserVersion', 'settingsHash'];

// Equal as stored data, whatever the key order. A missing value never equals anything.
const same = (a, b) => a !== undefined && b !== undefined && settingsHash(a) === settingsHash(b);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const count = value => Number.isSafeInteger(value) && value >= 0;

// The `kept` field of a stored capture: exactly `runId` (a valid run ID) and `at` (an ISO time), else null.
export function sanitizeKept(value) {
  if (!plain(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('runId') || !keys.includes('at')) return null;
  if (typeof value.runId !== 'string' || !RUN_ID.test(value.runId)) return null;
  if (typeof value.at !== 'string' || !ISO.test(value.at) || Number.isNaN(Date.parse(value.at)) || new Date(value.at).toISOString() !== value.at) return null;
  return { runId: value.runId, at: value.at };
}

// The files a cell stores, as relative paths, for the artifacts a run selects. Built from IDs only.
export function expectedFiles(targetId, viewportId, requested) {
  const files = {};
  if (requested.includes('screenshot')) files.screenshot = `screenshots/${targetId}/${viewportId}.png`;
  if (requested.includes('html')) files.html = `html/${targetId}/${viewportId}.txt`;
  if (requested.includes('status')) files.status = `status/${targetId}/${viewportId}.json`;
  if (requested.includes('content')) { files.content = `content/${targetId}/${viewportId}.json.gz`; files.contentBody = `content/${targetId}/${viewportId}.body.html.gz`; }
  return files;
}

// Rules 1, 2, 6 and 7 of ADR 0009, on the whole source run. Returns null when the run may supply cells,
// otherwise the name of the first rule that fails. `current` is { side, declaration, settingsHash, tools }.
export function runProblem(source, current) {
  if (!plain(source) || !plain(source.settings) || !plain(source.settings.sides)) return 'run';
  if (!sanitizeKept({ runId: source.id, at: source.at })) return 'run';
  if (source.state !== 'complete') return 'state';
  if (source.side !== current.side) return 'side';
  if (current.declaration?.remote !== true || source.settings.sides[current.side]?.remote !== true) return 'remote';
  if (!same(source.settings.sides[current.side], current.declaration)) return 'declaration';
  if (source.settingsHash !== current.settingsHash) return 'settings';
  for (const name of ['playwright', 'chromium']) {
    const mine = current.tools.find(tool => tool.name === name && !tool.artifact);
    const theirs = Array.isArray(source.tools) ? source.tools.find(tool => tool?.name === name && !tool.artifact) : undefined;
    if (!mine || !theirs || mine.version !== theirs.version || mine.settingsHash !== theirs.settingsHash) return 'tools';
  }
  return null;
}

// Rules 3, 4 and 5 of ADR 0009, on one stored entry. `cell` is { target, viewport, requested, provenance, recipe, settleHash }.
// `provenance` maps each requested non-screenshot kind to what a fresh capture of this target would record.
// Returns null when the entry may stand for the cell, otherwise the name of the failing rule.
export function entryProblem(entry, source, cell) {
  const { target, viewport, requested, provenance, recipe, settleHash } = cell;
  if (requested.includes('behavior')) return 'behavior';
  if (!Array.isArray(source.settings.targets) || !same(source.settings.targets.find(item => item?.id === target.id), target)) return 'target';
  if (!plain(entry) || entry.targetId !== target.id || entry.viewportId !== viewport.id || entry.state !== 'captured') return 'entry';
  if (!same(entry.recipe, recipe) || entry.settleHash !== settleHash || entry.scopeHash !== settingsHash(recipe.scope)) return 'recipe';
  const files = expectedFiles(target.id, viewport.id, requested);
  if (requested.includes('screenshot')) {
    if (entry.path !== files.screenshot || !Number.isSafeInteger(entry.width) || entry.width < 1 || !Number.isSafeInteger(entry.height) || entry.height < 1
      || entry.deviceScaleFactor !== viewport.deviceScaleFactor) return 'entry';
  } else if (entry.path !== undefined) return 'artifacts';
  if (!Number.isSafeInteger(entry.statusCode) || !text(entry.finalPath, 2048)) return 'entry';
  const stored = plain(entry.artifacts) ? entry.artifacts : {};
  const wanted = requested.filter(kind => kind !== 'screenshot');
  if (Object.keys(stored).length !== wanted.length || wanted.some(kind => !Object.hasOwn(stored, kind))) return 'artifacts';
  for (const kind of wanted) {
    const index = stored[kind];
    if (!KINDS.includes(kind) || !plain(index) || index.kind !== kind || index.state !== 'captured') return 'artifacts';
    if (PROVENANCE_KEYS.some(key => index[key] !== provenance[kind]?.[key])) return 'provenance';
    if (index.path !== files[kind] || !count(index.bytes)) return 'artifacts';
    if (kind === 'content' && (index.bodyPath !== files.contentBody || !count(index.bodyBytes))) return 'artifacts';
    if (kind === 'html' && !text(index.contentType, 200)) return 'artifacts';
  }
  return null;
}

// The relative paths to copy for a cell, in order.
export function filesToCopy(entry, requested) {
  const files = expectedFiles(entry.targetId, entry.viewportId, requested);
  return Object.values(files);
}

// The new entry for a cell. Only known keys are copied. `recipe`, `settleHash` and `scopeHash` stay as stored,
// and `kept` and its warning enter no hash. A source entry that is itself kept keeps its own provenance,
// so `at` is always the time of the measurement.
export function keptEntry(entry, source) {
  const origin = sanitizeKept(entry.kept) ?? { runId: source.id, at: source.at };
  const kept = sanitizeKept(origin);
  if (!kept) throw new Error('Source run has no valid identity.');
  const artifacts = {};
  for (const [kind, index] of Object.entries(entry.artifacts ?? {})) {
    const { kind: k, tool, version, browserVersion, settingsHash: hash, contentType, state, path, bodyPath, bodyBytes, bytes } = index;
    artifacts[kind] = { kind: k, tool, version, browserVersion, settingsHash: hash, ...(contentType !== undefined ? { contentType } : {}), state, path, ...(bodyPath !== undefined ? { bodyPath, bodyBytes } : {}), bytes };
  }
  const dropped = sanitizeDropped(entry.dropped);
  return withWarning({
    targetId: entry.targetId, viewportId: entry.viewportId, settleHash: entry.settleHash, state: 'captured',
    ...(entry.path !== undefined ? { path: entry.path } : {}), statusCode: entry.statusCode, finalPath: entry.finalPath,
    ...(entry.path !== undefined ? { width: entry.width, height: entry.height, deviceScaleFactor: entry.deviceScaleFactor } : {}),
    scopeHash: entry.scopeHash, recipe: entry.recipe, artifacts,
    ...(dropped.length ? { dropped, ...(count(entry.droppedOmitted) && entry.droppedOmitted > 0 ? { droppedOmitted: entry.droppedOmitted } : {}) } : {}),
    ...(sanitizeWarnings(entry.warnings).length ? { warnings: sanitizeWarnings(entry.warnings) } : {}),
    kept,
  }, { code: REFERENCE_KEPT, count: 1 });
}

// The number of kept cells in a run, for the `kept` count of the stdout line.
export const keptCount = run => (run?.captures ?? []).filter(capture => sanitizeKept(capture?.kept) !== null).length;
