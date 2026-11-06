import { lstat, readdir, readFile, realpath, rm, mkdir } from 'node:fs/promises';
import { join, relative, isAbsolute, resolve, sep } from 'node:path';
import { validId } from './valid-id.js';
import { loadHistoryEvidence } from './index.js';
import { VIEWER_MARKER, MARKER_BODY } from '../export/store-viewer.js';

// `history --prune` removes old runs on request (R12.5, #161). It deletes only with `yes`, only inside `<store>/runs/`.
// Every check fails closed: when the command cannot prove a run is safe to remove, the run stays.

export const DEFAULT_KEEP = 20;
export const MAX_KEEP = 100000;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const inside = (parent, child) => {
  const offset = relative(parent, child);
  return offset !== '' && offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset);
};

/** Validate `--keep`. Pure. */
export function parseKeep(value = DEFAULT_KEEP) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_KEEP) throw new Error(`--keep must be 1..${MAX_KEEP}`);
  return value;
}

/**
 * Decide which runs to remove (R12.5). Pure: no file system.
 * `runs`: `{ id, side, at }` with `side` a string and `at` a time in ms, or `null` when unreadable.
 * `referenced`: a Map of run id to the reason that protects it.
 * Order: the run's own recorded time, newest first, ties by id descending. The newest `keep` runs of each side stay.
 * A run with no readable side or time stays and uses no slot. A referenced run stays.
 * @returns {{ remove: object[], skipped: Array<{id: string, reason: string}>, keptCount: number }} `remove` is oldest first.
 */
export function planPrune({ runs, keep, referenced = new Map() }) {
  parseKeep(keep);
  const skipped = [];
  const sides = new Map();
  for (const run of runs) {
    if (typeof run.side !== 'string' || !run.side || !Number.isFinite(run.at)) { skipped.push({ id: run.id, reason: run.reason ?? 'no readable time or side' }); continue; }
    if (!sides.has(run.side)) sides.set(run.side, []);
    sides.get(run.side).push(run);
  }
  const remove = [];
  let keptCount = 0;
  for (const list of sides.values()) {
    list.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    list.forEach((run, position) => {
      if (position < keep) { keptCount += 1; return; }
      if (referenced.has(run.id)) { skipped.push({ id: run.id, reason: referenced.get(run.id) }); return; }
      remove.push(run);
    });
  }
  remove.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  skipped.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { remove, skipped, keptCount };
}

/**
 * Collect the run ids that the store refers to (R12.5). Pure: takes parsed JSON.
 * Throws when a document has a shape the command cannot read, so an unknown reference never hides.
 */
export function collectReferences({ reports = [], state = null }) {
  const referenced = new Map();
  const add = (id, reason) => { if (typeof id === 'string' && !referenced.has(id)) referenced.set(id, reason); };
  for (const { id, value } of reports) {
    if (!isObject(value)) throw new Error(`Report ${id} is not readable. Nothing was removed.`);
    const reason = `named by report ${id}`;
    if (isObject(value.pair)) { add(value.pair.aRunId, reason); add(value.pair.bRunId, reason); }
    if (isObject(value.subject)) add(value.subject.runId, reason);
    if (Array.isArray(value.runs)) for (const run of value.runs) if (isObject(run)) add(run.id, reason);
  }
  if (state !== null) {
    if (!isObject(state) || !isObject(state.profiles)) throw new Error('The workflow state is not readable. Nothing was removed.');
    for (const profile of Object.values(state.profiles)) if (isObject(profile)) add(profile.before, 'baseline in the workflow state');
  }
  return referenced;
}

/** The store path below the configuration directory must hold no symbolic link (the rule of `ensureStore`). Read only. */
export async function assertPlainStorePath(configDir, storePath) {
  const offset = relative(configDir, storePath);
  if (!offset || offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) throw new Error('The store must be a subdirectory of the configuration directory.');
  let current = configDir;
  for (const part of offset.split(sep)) {
    current = join(current, part);
    let info;
    try { info = await lstat(current); } catch (error) { if (error.code === 'ENOENT') throw new Error(`There is no store at ${storePath}. Nothing was removed.`); throw error; }
    if (info.isSymbolicLink()) throw new Error('The workflow store must not use symbolic links.');
    if (!info.isDirectory()) throw new Error(`${current} is not a directory.`);
  }
}

async function plainDirectory(path) {
  try { const info = await lstat(path); return info.isDirectory() && !info.isSymbolicLink(); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function readJson(path, missing) {
  let text;
  try { text = await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return missing; throw error; }
  return JSON.parse(text);
}

async function assertStore(local) {
  const info = await lstat(local).catch(() => null);
  if (!info || info.isSymbolicLink() || !info.isDirectory()) throw new Error('The store must be a real directory. Nothing was removed.');
  const root = await realpath(local);
  const marker = await lstat(join(root, VIEWER_MARKER)).catch(() => null);
  if (!marker || !marker.isFile() || marker.size !== Buffer.byteLength(MARKER_BODY) || (await readFile(join(root, VIEWER_MARKER), 'utf8')) !== MARKER_BODY) {
    throw new Error(`${root} is not a test-kit store: the marker ${VIEWER_MARKER} is missing or foreign. Nothing was removed.`);
  }
  // runs/ may be absent (nothing to prune). reports/ must exist: absence is never read as "no references".
  if ((await plainDirectory(join(root, 'runs'))) === false) throw new Error('runs/ in the store must be a real directory, not a link or a file. Nothing was removed.');
  if (!(await plainDirectory(join(root, 'reports')))) throw new Error('reports/ in the store is missing or is not a real directory, so the references are unknown. Nothing was removed.');
  return root;
}

async function scanRuns(root) {
  let names;
  try { names = await readdir(join(root, 'runs')); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const runs = [];
  for (const id of names.sort()) {
    if (!validId(id)) { runs.push({ id, reason: 'not a safe run id' }); continue; }
    if (!(await plainDirectory(join(root, 'runs', id)))) { runs.push({ id, reason: 'not a real directory' }); continue; }
    try {
      const value = await loadHistoryEvidence(root, 'runs', id, 'run.json');
      if (value.id !== undefined && value.id !== id) { runs.push({ id, reason: 'run.json names another id' }); continue; }
      runs.push({ id, side: value.side, at: typeof value.at === 'string' ? Date.parse(value.at) : NaN });
    } catch { runs.push({ id, reason: 'run.json is not readable' }); }
  }
  return runs;
}

async function scanReports(root) {
  const names = await readdir(join(root, 'reports'));
  const reports = [];
  for (const id of names.sort()) {
    // Any entry that is not a safe-id real directory may hide a reference, so it stops the prune.
    if (!validId(id) || !(await plainDirectory(join(root, 'reports', id)))) throw new Error(`The entry reports/${id} is not a safe report folder, so its runs are unknown. Nothing was removed.`);
    // A report that cannot be read may name any run, so it stops the prune.
    try { reports.push({ id, value: await loadHistoryEvidence(root, 'reports', id, 'report.json') }); }
    catch { throw new Error(`Report ${id} is not readable, so its runs are unknown. Nothing was removed.`); }
  }
  return reports;
}

/**
 * Plan, and with `yes` remove, the oldest runs beyond `keep` for each side.
 * Without `yes` nothing is written, not even a lock.
 * A failed removal stops the command. The runs after it stay.
 * @returns {Promise<{ output: object, exitCode: number }>}
 */
export async function pruneHistory({ local, keep = DEFAULT_KEEP, yes = false } = {}) {
  parseKeep(keep);
  const root = await assertStore(local);
  // The workflow lock keeps a writer out while the command reads references and removes runs.
  let locked = false;
  if (yes) {
    try { await mkdir(join(root, 'lock')); locked = true; }
    catch (error) { if (error.code === 'EEXIST') throw new Error('A workflow already owns this store. Remove its lock only after the process stops. Nothing was removed.'); throw error; }
  }
  try {
    if (!yes && (await lstat(join(root, 'lock')).catch(() => null))) throw new Error('A workflow already owns this store. Nothing was removed.');
    const reports = await scanReports(root);
    const state = await readJson(join(root, 'state.json'), null).catch(() => { throw new Error('The workflow state is not readable. Nothing was removed.'); });
    const referenced = collectReferences({ reports, state });
    const plan = planPrune({ runs: await scanRuns(root), keep, referenced });
    const output = { store: root, keep, dryRun: !yes, wouldRemove: plan.remove.map(run => run.id), removed: [], failed: null, kept: plan.keptCount + plan.skipped.length, skipped: plan.skipped };
    if (!yes) return { output, exitCode: 0 };
    delete output.wouldRemove;
    const runsRoot = join(root, 'runs');
    for (const run of plan.remove) {
      const dir = join(runsRoot, run.id);
      try {
        // Check again right before the delete: still a real directory, and its real path is the expected one.
        if (!(await plainDirectory(dir)) || (await realpath(dir)) !== resolve(runsRoot, run.id) || !inside(runsRoot, dir)) throw new Error('not a real directory inside runs/');
        await rm(dir, { recursive: true });
        output.removed.push(run.id);
      } catch (error) { output.failed = { id: run.id, error: error.message }; break; }
    }
    output.kept = plan.remove.length - output.removed.length + plan.keptCount + plan.skipped.length;
    return { output, exitCode: output.failed ? 1 : 0 };
  } finally { if (locked) await rm(join(root, 'lock'), { recursive: true, force: true }); }
}
