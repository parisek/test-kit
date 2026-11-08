import * as nodeFs from 'node:fs/promises';
import { lstat } from 'node:fs/promises';
import { join, dirname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

// One source for the default store directory (R12.1). The default moved from `.test-kit` to `test-kit` in 1.2.0.
export const DEFAULT_STORE = 'test-kit';
export const LEGACY_STORE = '.test-kit';
export const DEFAULT_RUNS_ROOT = `${DEFAULT_STORE}/runs`;
// R12.6 (#352): the store reserves `inputs/` for files the project keeps there (crops, design images).
// test-kit never writes, moves or deletes anything under it, and no command may name it as an output.
export const INPUTS_DIR = 'inputs';
export const DEFAULT_INPUTS = `${DEFAULT_STORE}/${INPUTS_DIR}`;

/**
 * True when the plain relative path `value` is the default inputs folder or lies inside it. Pure (R4.4).
 * The compare ignores case, because the file systems of macOS and Windows do.
 */
export function namesDefaultInputs(value) {
  const lower = String(value).toLowerCase();
  return lower === DEFAULT_INPUTS || lower.startsWith(`${DEFAULT_INPUTS}/`);
}

/**
 * Throw when the absolute path `target` is `<store>/inputs` of one of `stores`, or lies inside it (R12.6).
 * The check is lexical and ignores case. It follows no link. It touches no file.
 */
export function assertOutsideInputs(target, stores, name) {
  const path = resolve(target).toLowerCase();
  for (const store of stores) {
    const inputs = resolve(store, INPUTS_DIR).toLowerCase();
    if (path === inputs || path.startsWith(inputs + sep)) throw new Error(`${name} must not be inside ${INPUTS_DIR}/ of the store. That folder holds project files, and test-kit never writes there.`);
  }
}

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
 * Write `<store>/.gitignore` with `*` when the store has none, so git ignores the store even in a project that
 * forgot the ignore line. An existing file is never touched, also when one appears while this runs.
 * Git-ignored is not deploy-excluded: the store holds page captures, so a deploy must exclude it too.
 * `fs` overrides single `node:fs/promises` functions (a test seam).
 * @returns {Promise<boolean>} true when this call wrote the file
 */
export async function ensureStoreIgnore(store, { fs } = {}) {
  return writeIfAbsent(join(store, '.gitignore'), '*\n', { fs });
}

/**
 * Write `content` to `target` only when the name is free, also when it becomes taken while this runs:
 * the content goes to a temp file, and `link` publishes it only if the name is still free (EEXIST means leave it).
 * @returns {Promise<boolean>} true when this call wrote the file
 */
export async function writeIfAbsent(target, content, { fs: seam } = {}) {
  const fs = { ...nodeFs, ...seam };
  try { await fs.lstat(target); return false; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, { flag: 'wx' });
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
