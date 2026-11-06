import * as nodeFs from 'node:fs/promises';
import { lstat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// One source for the default store directory (R12.1). The default moved from `.test-kit` to `test-kit` in 1.2.0.
export const DEFAULT_STORE = 'test-kit';
export const LEGACY_STORE = '.test-kit';
export const DEFAULT_RUNS_ROOT = `${DEFAULT_STORE}/runs`;

/**
 * One notice line when the default store is in use and an old `.test-kit/` sits beside the config.
 * It only calls `lstat`. It never reads, moves or deletes the old folder.
 * @param {string} configDir directory of the configuration file
 * @param {{ explicit: boolean, fs?: { lstat: Function } }} options `explicit` is true when `--store` or `runsRoot` is set
 * @returns {Promise<string|null>}
 */
export async function legacyStoreNotice(configDir, { explicit, fs = { lstat } } = {}) {
  if (explicit) return null;
  try {
    if (!(await fs.lstat(join(configDir, LEGACY_STORE))).isDirectory()) return null;
  } catch { return null; }
  return `test-kit: ${LEGACY_STORE}/ is no longer used. The default store is ${DEFAULT_STORE}/. Delete ${LEGACY_STORE}/ by hand.`;
}

/**
 * Write `<store>/.gitignore` with `*` when none exists, so git ignores the store even in a project that
 * forgot the ignore line. An existing file is never touched, also when one appears while this runs: the
 * content goes to a temp file, and `link` publishes it only if the name is still free (EEXIST means leave it).
 * Git-ignored is not deploy-excluded: the store holds page captures, so a deploy must exclude it too.
 * `fs` overrides single `node:fs/promises` functions (a test seam).
 * @returns {Promise<boolean>} true when this call wrote the file
 */
export async function ensureStoreIgnore(store, { fs: seam } = {}) {
  const fs = { ...nodeFs, ...seam };
  const target = join(store, '.gitignore');
  try { await fs.lstat(target); return false; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, '*\n', { flag: 'wx' });
    try { await fs.link(temporary, target); } catch (error) { if (error.code === 'EEXIST') return false; throw error; }
    return true;
  } finally { await fs.rm(temporary, { force: true }); }
}

/**
 * Low-level commands create `runsRoot` with `mkdir -p`. When `runsRoot` is the default, call this after the
 * mkdir so the store gets its `.gitignore` too. An explicit `runsRoot` is the project's own folder: leave it alone.
 * @returns {Promise<boolean>} true when a `.gitignore` was written
 */
export async function ensureDefaultRunsIgnore(configDir, runsRoot) {
  const defaultRoot = resolve(configDir, DEFAULT_RUNS_ROOT);
  if (resolve(configDir, runsRoot) !== defaultRoot) return false;
  return ensureStoreIgnore(dirname(defaultRoot));
}
