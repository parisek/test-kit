import * as nodeFs from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { historyEvidencePath, scanHistory } from '../history/index.js';
import { boundedRead } from '../server/files.js';
import { buildPublishIndex } from './index-file.js';
import { writeReportEvidence } from './report.js';

// Refresh a publish directory in place (R10.12). Steps S1 to S6 and the tables follow the specification.

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
export const MARKER = '.test-kit-publish';
export const MARKER_VALUE = Object.freeze({ tool: 'test-kit', kind: 'publish', schemaVersion: 1 });
const SUFFIX = Object.freeze({ lock: '.test-kit-lock', stage: '.test-kit-new', backup: '.test-kit-old' });
const NAME_MAX = 255;
const VIEWER_FILES = ['index.html', 'app.js', 'style.css'];
const OWNED = Object.freeze({ [MARKER]: 'file', 'index.json': 'file', 'index.html': 'file', 'app.js': 'file', 'style.css': 'file', runs: 'directory', reports: 'directory' });
const MAX_RUN_BYTES = 20 * 1024 * 1024;

const inside = (parent, child) => {
  const offset = relative(parent, child);
  return offset === '' || (offset !== '..' && !offset.startsWith('../') && !isAbsolute(offset));
};

async function lstatOrNull(fs, path) {
  try { return await fs.lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Resolve only the parent: the deepest existing ancestor, plus the missing segments. Read only.
async function resolvePath(fs, path) {
  const missing = [];
  let current = dirname(path);
  for (;;) {
    try {
      const real = await fs.realpath(current);
      if (!(await fs.stat(real)).isDirectory()) throw new Error(`Refused: ${current} is not a directory.`);
      return join(real, ...missing, basename(path));
    } catch (error) {
      if (error.code === 'ENOTDIR') throw new Error(`Refused: a part of ${current} is a file, not a directory.`);
      if (error.code !== 'ENOENT') throw error;
      if (dirname(current) === current) throw error;
      missing.unshift(basename(current));
      current = dirname(current);
    }
  }
}

// Resolve a path that may exist: fully when it exists, else its parent plus the missing leaf.
async function resolveFull(fs, path) {
  try { return await fs.realpath(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return resolvePath(fs, path);
}

/**
 * Text of the recovery action for one state of the table in R10.12 rule 5.
 * Pure. Returns `null` for the normal state (no lock, no stage, no backup).
 * @param {{ lock: boolean, stage: boolean, backup: boolean, dir: boolean }} state
 * @param {{ dir: string, lock: string, stage: string, backup: string }} paths
 */
export function recoveryAction({ lock, stage, backup, dir }, paths) {
  if (!lock && !stage && !backup) return null;
  const rest = (...items) => items.filter(Boolean).join(' and ');
  if (backup && !dir) {
    const then = stage ? `, then remove ${rest(paths.stage, lock && paths.lock)}` : lock ? `, then remove only the lock ${paths.lock}` : '';
    return `rename ${paths.backup} to ${paths.dir}${then}. The old content is only in the backup.`;
  }
  if (backup && !stage) {
    return lock
      ? `the swap finished and the new content is live; a cleanup stopped. Remove ${paths.backup} and ${paths.lock}.`
      : `remove ${paths.backup}.`;
  }
  if (backup) {
    return `compare ${paths.dir} and ${paths.backup} by hand; remove ${rest(paths.stage, lock && paths.lock)} afterwards; keep the one you want as ${paths.dir}. Never remove the backup first.`;
  }
  if (stage) {
    return `remove ${rest(paths.stage, lock && paths.lock)}.${dir ? ' The directory holds the old content.' : ' This was a first publish.'}`;
  }
  return `remove ${paths.lock}. ${dir ? 'The directory is complete (old or new content).' : 'Nothing was published yet.'}`;
}

function recoveryMessage(state, paths) {
  const lines = [`test-kit: a refresh left files beside ${paths.dir}. The command stops and deletes nothing.`];
  for (const key of ['lock', 'stage', 'backup']) if (state[key]) lines.push(`  ${key}: ${paths[key]}`);
  lines.push(`Action: ${recoveryAction(state, paths)}`);
  lines.push(state.lock
    ? 'Check first for a crashed refresh. Make sure no refresh runs before you remove the lock.'
    : 'Check first for a crashed refresh.');
  return lines.join('\n');
}

async function readState(fs, paths, { assumeLockAbsent = false } = {}) {
  const exists = async path => (await lstatOrNull(fs, path)) !== null;
  return {
    lock: assumeLockAbsent ? false : await exists(paths.lock),
    stage: await exists(paths.stage),
    backup: await exists(paths.backup),
    dir: await exists(paths.dir),
  };
}

// Preflight items 8 and 9. `dir` is a directory or missing.
async function checkContent(fs, dir) {
  let names;
  try { names = await fs.readdir(dir); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!names.length) return;
  const refuse = () => new Error(`Refused: ${dir} is not empty and has no valid ${MARKER} marker. Choose an empty or missing directory.`);
  const info = await lstatOrNull(fs, join(dir, MARKER));
  if (!info || !info.isFile() || info.size > 1024) throw refuse();
  let value;
  try { value = JSON.parse(await fs.readFile(join(dir, MARKER), 'utf8')); } catch { throw refuse(); }
  const keys = value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : null;
  if (!keys || keys.length !== 3 || Object.keys(MARKER_VALUE).some(key => value[key] !== MARKER_VALUE[key])) throw refuse();
  for (const name of [...names].sort()) {
    const type = OWNED[name];
    const entry = Object.hasOwn(OWNED, name) ? await lstatOrNull(fs, join(dir, name)) : null;
    const right = entry && (type === 'file' ? entry.isFile() : entry.isDirectory());
    if (!right) throw new Error(`Refused: ${join(dir, name)} is not an entry that test-kit publish owns. Remove it or choose another directory.`);
  }
}

// Preflight item 6: `target` is missing or a real directory. A link or a file is refused.
async function checkLeaf(fs, target) {
  const info = await lstatOrNull(fs, target);
  if (info && !info.isDirectory()) throw new Error(`Refused: ${target} is a ${info.isSymbolicLink() ? 'symbolic link' : 'file, not a directory'}.`);
  return info;
}

async function preflight({ fs, local, dir, cwd, home }) {
  // Item 2: pure string check, before any lstat.
  const leaf = basename(dir);
  for (const suffix of Object.values(SUFFIX)) {
    if (Buffer.byteLength(leaf + suffix, 'utf8') > NAME_MAX) throw new Error(`Refused: the name "${leaf}" is too long. A generated sibling would pass ${NAME_MAX} bytes.`);
  }
  // Item 3.
  const target = await resolvePath(fs, dir);
  const paths = { dir: target, lock: target + SUFFIX.lock, stage: target + SUFFIX.stage, backup: target + SUFFIX.backup };
  const parent = dirname(target);
  // Item 4. The store must exist, so a mistyped `--store` cannot replace a site with an empty one.
  const refuseStore = at => new Error(`Refused: the history store ${at} does not exist or is not a directory. Nothing was written.`);
  let store;
  try { store = await resolveFull(fs, local); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw refuseStore(local); throw error; }
  let storeIsDirectory = false;
  try { storeIsDirectory = (await fs.stat(store)).isDirectory(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!storeIsDirectory) throw refuseStore(store);
  for (const path of Object.values(paths)) {
    if (inside(store, path) || inside(path, store)) throw new Error(`Refused: ${path} is the history store, is inside it, or contains it. Choose a directory outside ${store}.`);
  }
  // Item 5.
  const real = async path => { try { return await fs.realpath(path); } catch { return path; } };
  const forbidden = [['the file system root', dirname(target) === target ? target : null], ['the home directory', await real(home)], ['the working directory', await real(cwd)]];
  for (const [name, path] of forbidden) if (path === target) throw new Error(`Refused: ${target} is ${name}.`);
  if (inside(target, await real(cwd))) throw new Error(`Refused: ${target} contains the working directory.`);
  const info = await lstatOrNull(fs, target);
  if (info?.isDirectory()) {
    const around = await fs.lstat(parent);
    if (info.dev !== around.dev) throw new Error(`Refused: ${target} is a mount point.`);
  }
  // Item 6.
  await checkLeaf(fs, target);
  // Item 7.
  const state = await readState(fs, paths);
  if (state.lock || state.stage || state.backup) throw new Error(recoveryMessage(state, paths));
  // Items 8 and 9.
  await checkContent(fs, target);
  return { paths, parent };
}

async function buildStage({ fs, local, paths, now, warnings }) {
  const stage = paths.stage;
  await fs.mkdir(stage);
  await fs.writeFile(join(stage, MARKER), `${JSON.stringify(MARKER_VALUE)}\n`, { flag: 'wx' });
  for (const name of VIEWER_FILES) await fs.writeFile(join(stage, name), await boundedRead(join(packageRoot, 'viewer', name)), { flag: 'wx' });
  await fs.mkdir(join(stage, 'runs'));
  await fs.mkdir(join(stage, 'reports'));
  const history = await scanHistory(local);
  let runCount = 0;
  for (const { id, value } of history.runs) {
    if (!value) continue;
    const bytes = await boundedRead(await historyEvidencePath(local, 'runs', id, 'run.json'), MAX_RUN_BYTES);
    await fs.mkdir(join(stage, 'runs', id));
    await fs.writeFile(join(stage, 'runs', id, 'run.json'), bytes, { flag: 'wx' });
    runCount += 1;
  }
  const unavailable = [];
  let reportCount = 0;
  for (const { id, value } of history.reports) {
    if (!value) continue;
    const targetDir = join(stage, 'reports', id);
    try {
      await writeReportEvidence({ reportPath: await historyEvidencePath(local, 'reports', id, 'report.json'), targetDir });
      reportCount += 1;
    } catch (error) {
      // Missing or oversized evidence, or a report that fails validation, is an expected state (R10.12 rule 1).
      // Any other error fails the refresh and names the report.
      if (error.code !== 'ENOENT' && error.code !== 'EFBIG' && error.code !== 'EINVALIDREPORT') {
        error.message = `report ${id}: ${error.message}`;
        throw error;
      }
      await fs.rm(targetDir, { recursive: true, force: true });
      unavailable.push(id);
      const why = error.code === 'EINVALIDREPORT' ? `fails validation (${error.message})` : `has missing or oversized evidence (${error.code})`;
      warnings.push(`test-kit: warning: report ${id} ${why}. It is listed without a path and nothing is copied.`);
    }
  }
  const index = buildPublishIndex(history, { now, unavailableReportIds: unavailable });
  await fs.writeFile(join(stage, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, { flag: 'wx' });
  return { runCount, reportCount, unavailable, index };
}

/**
 * Refresh the publish directory `dir` from the history store `local`.
 * @param {{ local: string, dir: string, now?: Date|number|string, cwd?: string, home?: string, fs?: object }} options
 *   `fs` overrides single `node:fs/promises` functions (a test seam).
 * @returns {Promise<{ dir: string, runCount: number, reportCount: number, unavailable: string[], warnings: string[], messages: string[] }>}
 */
export async function publishHistory({ local, dir, now = new Date(), cwd = process.cwd(), home = homedir(), fs: seam } = {}) {
  if (typeof local !== 'string' || !local || typeof dir !== 'string' || !dir) throw new Error('Publish needs a store and a directory.');
  const fs = { ...nodeFs, ...seam };
  const { paths, parent } = await preflight({ fs, local: resolve(local), dir: resolve(dir), cwd, home });
  await fs.mkdir(parent, { recursive: true });

  // S1: take the lock, then repeat the checks.
  try { await fs.mkdir(paths.lock); } catch (error) {
    if (error.code === 'EEXIST') {
      const state = await readState(fs, paths);
      // The other run can finish between the failed mkdir and this read. Then nothing is left to recover.
      if (!state.lock && !state.stage && !state.backup) throw new Error('A refresh was running and has finished. Run the command again.');
      throw new Error(recoveryMessage(state, paths));
    }
    throw error;
  }
  // The lock is ours only while it is the directory we created (device and inode).
  // Limit: the lock guards against concurrent runs of this command and against mistakes. A local process that can
  // write to the parent of DIR can swap the lock between mkdir and lstat, or reuse an inode. The command does not defend against it.
  const same = (info, other) => info && other && info.dev === other.dev && info.ino === other.ino;
  const lockInfo = await fs.lstat(paths.lock);
  // Returns null, or { replaced } when the lock stays. A replaced lock is never deleted.
  const release = async () => {
    try {
      const now = await lstatOrNull(fs, paths.lock);
      if (!now) return null;
      if (!same(now, lockInfo)) return { replaced: true };
      await fs.rm(paths.lock, { recursive: true, force: true });
      return null;
    } catch { return { replaced: false }; }
  };
  const kept = left => (left.replaced ? ' (the lock was replaced; left in place)' : '');
  // Items 6, 8 and 9 on DIR, and DIR is still the directory the S1 check saw.
  let identity = null;
  const verifyDir = async ({ record = false } = {}) => {
    const info = await checkLeaf(fs, paths.dir);
    await checkContent(fs, paths.dir);
    if (record) identity = info;
    else if (Boolean(info) !== Boolean(identity) || (info && !same(info, identity))) throw new Error(`Refused: ${paths.dir} changed while the command built the stage. Nothing was replaced.`);
    return info;
  };
  try {
    const state = await readState(fs, paths, { assumeLockAbsent: true });
    if (state.stage || state.backup) throw new Error(recoveryMessage(state, paths));
    await verifyDir({ record: true });
  } catch (error) {
    const left = await release();
    if (left) error.message += `\nThe command could not remove the lock ${paths.lock}${kept(left)}. The next run refuses until you remove it.`;
    throw error;
  }

  const warnings = [];
  // Remove the stage, release the lock, and fail with the cause. A leftover is named in the message.
  const fail = async error => {
    const left = [];
    try { await fs.rm(paths.stage, { recursive: true, force: true }); } catch { left.push(paths.stage); }
    const lock = await release();
    if (lock) left.push(paths.lock + kept(lock));
    if (left.length) error.message += `\nThe command could not remove: ${left.join(', ')}. The next run handles this state with the recovery table.`;
    throw error;
  };

  // S2: build the stage with the marker.
  let built;
  try { built = await buildStage({ fs, local: resolve(local), paths, now, warnings }); } catch (error) { await fail(error); }

  // S3: check DIR again immediately before the rename, then move the old content to the backup.
  // A change between this check and the rename stays possible. The command does not claim atomicity.
  let hasBackup = false;
  try {
    if (await verifyDir()) { await fs.rename(paths.dir, paths.backup); hasBackup = true; }
  } catch (error) { await fail(error); }

  // S4: move the stage to the directory.
  try { await fs.rename(paths.stage, paths.dir); } catch (error) {
    if (!hasBackup) await fail(error);
    try { await fs.rename(paths.backup, paths.dir); } catch (back) {
      error.message += `\nThe rename back failed (${back.message}). The old content is in the backup. The command keeps these paths:\n  lock: ${paths.lock}\n  stage: ${paths.stage}\n  backup: ${paths.backup}`;
      throw error;
    }
    await fail(error);
  }

  // S5: remove the backup. S6: remove the lock. The new content is live, so a failure only warns.
  if (hasBackup) {
    try { await fs.rm(paths.backup, { recursive: true, force: true }); } catch (error) {
      warnings.push(`test-kit: warning: the new content is live, but the backup ${paths.backup} remains (${error.message}). The next run refuses until you remove it.`);
    }
  }
  const lockLeft = await release();
  if (lockLeft) warnings.push(`test-kit: warning: the new content is live, but the lock ${paths.lock} remains${kept(lockLeft)}. The next run refuses until you remove it.`);

  return {
    dir: paths.dir,
    runCount: built.runCount,
    reportCount: built.reportCount,
    unavailable: built.unavailable,
    warnings,
    messages: [...warnings, `test-kit: published to ${paths.dir}; the directory contains captured pages.`],
  };
}
