import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

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
