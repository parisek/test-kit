import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { normalizeConfig } from './normalize.js';

export { normalizeConfig } from './normalize.js';
export { captureSettings, designSettings, settingsHash } from './settings.js';

// `baseDir` is for a runtime copy of the configuration that sits in the store (#312).
// Relative paths in the copy still resolve from the directory of the real configuration file.
export async function loadConfig(path, { baseDir } = {}) {
  const configPath = resolve(path);
  const configDir = baseDir ? resolve(baseDir) : dirname(configPath);
  const config = normalizeConfig(JSON.parse(await readFile(configPath, 'utf8')));
  return { config, configPath, configDir, runsRoot: resolve(configDir, config.runsRoot) };
}
