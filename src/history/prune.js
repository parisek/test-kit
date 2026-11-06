import { lstat, readdir, readFile, realpath, rm, mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
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
  const bad = what => { throw new Error(`${what} has a shape the command cannot read, so its references are unknown. Nothing was removed.`); };
  // An absent key is fine. A present key of the wrong shape stops the command.
  const add = (container, key, reason, what) => {
    if (!Object.hasOwn(container, key)) return;
    if (typeof container[key] !== 'string') bad(what);
    if (!referenced.has(container[key])) referenced.set(container[key], reason);
  };
  for (const { id, value } of reports) {
    if (!isObject(value)) throw new Error(`Report ${id} is not readable. Nothing was removed.`);
    const reason = `named by report ${id}`;
    const where = `Report ${id}`;
    // A valid report names its runs (R9.7). One with no run reference protects nothing, so it stops the command.
    if (!['pair', 'subject', 'runs'].some(key => Object.hasOwn(value, key))) bad(`${where} (no pair, subject or runs)`);
    if (Object.hasOwn(value, 'pair')) {
      if (!isObject(value.pair)) bad(`${where} (pair)`);
      add(value.pair, 'aRunId', reason, `${where} (pair.aRunId)`); add(value.pair, 'bRunId', reason, `${where} (pair.bRunId)`);
    }
    if (Object.hasOwn(value, 'subject')) {
      if (!isObject(value.subject)) bad(`${where} (subject)`);
      add(value.subject, 'runId', reason, `${where} (subject.runId)`);
    }
    if (Object.hasOwn(value, 'runs')) {
      if (!Array.isArray(value.runs)) bad(`${where} (runs)`);
      for (const run of value.runs) { if (!isObject(run)) bad(`${where} (a runs element)`); add(run, 'id', reason, `${where} (runs[].id)`); }
    }
  }
  if (state !== null) {
    if (!isObject(state) || !isObject(state.profiles)) throw new Error('The workflow state is not readable. Nothing was removed.');
    for (const profile of Object.values(state.profiles)) {
      if (!isObject(profile)) bad('The workflow state (a profile)');
      add(profile, 'before', 'baseline in the workflow state', 'The workflow state (profile.before)');
    }
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

export const MAX_WALK = 100000;
// True when every entry of the tree has the device number of `dev`. lstat only, no link followed, bounded.
async function sameDevice(dir, dev, statFn, limit = MAX_WALK) {
  const queue = [dir];
  let count = 0;
  while (queue.length) {
    const current = queue.pop();
    const info = await statFn(current);
    if (info.dev !== dev) return false;
    if (++count > limit) return false;
    if (info.isDirectory() && !info.isSymbolicLink()) for (const name of await readdir(current)) queue.push(join(current, name));
  }
  return true;
}

/**
 * Plan, and with `yes` remove, the oldest runs beyond `keep` for each side.
 * Without `yes` nothing is written, not even a lock.
 * A failed removal stops the command. The runs after it stay.
 * @returns {Promise<{ output: object, exitCode: number }>}
 */
export async function pruneHistory({ local, keep = DEFAULT_KEEP, yes = false, beforeRelease, lstatSeam, walkLimit = MAX_WALK } = {}) {
  const statFn = lstatSeam ?? lstat;
  parseKeep(keep);
  const root = await assertStore(local);
  // The workflow lock keeps a writer out while the command reads references and removes runs.
  // The lock holds a file `owner` with a random token. The release removes the lock only while it is still ours.
  const token = randomUUID();
  const lockPath = join(root, 'lock');
  let locked = false;
  if (yes) {
    try { await mkdir(lockPath); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('A workflow already owns this store. Remove its lock only after the process stops. Nothing was removed.'); throw error; }
    locked = true;
    try { await writeFile(join(lockPath, 'owner'), token, { flag: 'wx' }); }
    catch (error) { await rmdir(lockPath).catch(() => {}); throw error; }
  }
  const release = async () => {
    if (!locked) return null;
    try {
      const info = await lstat(lockPath);
      if (info.isDirectory() && !info.isSymbolicLink() && (await readFile(join(lockPath, 'owner'), 'utf8')) === token) {
        await unlink(join(lockPath, 'owner'));
        await rmdir(lockPath);
        return null;
      }
    } catch { /* fall through to the warning */ }
    return `test-kit: warning: the lock ${lockPath} is no longer the one this command made. It was left in place.`;
  };
  let result;
  try {
    if (!yes && (await lstat(join(root, 'lock')).catch(() => null))) throw new Error('A workflow already owns this store. Nothing was removed.');
    const reports = await scanReports(root);
    const state = await readJson(join(root, 'state.json'), null).catch(() => { throw new Error('The workflow state is not readable. Nothing was removed.'); });
    const referenced = collectReferences({ reports, state });
    const plan = planPrune({ runs: await scanRuns(root), keep, referenced });
    const output = { store: root, keep, dryRun: !yes, wouldRemove: plan.remove.map(run => run.id), removed: [], failed: null, kept: plan.keptCount + plan.skipped.length, skipped: plan.skipped };
    if (!yes) { result = { output, exitCode: 0 }; return result; }
    delete output.wouldRemove;
    const runsRoot = join(root, 'runs');
    // No runs/ (or nothing to remove) means no device read.
    const runsDev = plan.remove.length ? (await lstat(runsRoot)).dev : null;
    const refused = [];
    for (const run of plan.remove) {
      const dir = join(runsRoot, run.id);
      try {
        // Check again right before the delete: still a real directory, and its real path is the expected one.
        if (!(await plainDirectory(dir)) || (await realpath(dir)) !== resolve(runsRoot, run.id) || !inside(runsRoot, dir)) throw new Error('not a real directory inside runs/');
        // A mount point inside the run would let the recursive delete reach another file system. Walk first, link-safe.
        if (!(await sameDevice(dir, runsDev, statFn, walkLimit))) { refused.push({ id: run.id, reason: 'different filesystem, or too many entries to check' }); continue; }
        await rm(dir, { recursive: true });
        output.removed.push(run.id);
      } catch (error) { output.failed = { id: run.id, error: error.message }; break; }
    }
    output.skipped = [...output.skipped, ...refused];
    output.kept = plan.remove.length - output.removed.length + plan.keptCount + plan.skipped.length;
    result = { output, exitCode: output.failed ? 1 : 0 };
    return result;
  } finally {
    if (beforeRelease) await beforeRelease(lockPath); // test seam
    const warning = await release();
    if (warning && result) result.stderr = [warning];
  }
}
