import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { normalizeConfig } from './normalize.js';

export { normalizeConfig } from './normalize.js';
export { captureSettings, settingsHash } from './settings.js';

export async function loadConfig(path) {
  const configPath = resolve(path);
  const configDir = dirname(configPath);
  const config = normalizeConfig(JSON.parse(await readFile(configPath, 'utf8')));
  return { config, configPath, configDir, runsRoot: resolve(configDir, config.runsRoot) };
}
