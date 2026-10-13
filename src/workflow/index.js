import { mkdir, readFile, writeFile, rename, rm, lstat, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadBehaviorSource } from '../behavior/source.js';
import { normalizeConfig } from '../config/index.js';
import { selectConfig } from './selection.js';
export { selectConfig } from './selection.js';
const execute = promisify(execFile);
const digest = value => createHash('sha256').update(value).digest('hex');
export function loopbackOrigin(description) {
  const value = description?.raw?.services?.web?.host_http_url;
  let url;
  try { url = new URL(value); } catch { throw new Error('DDEV must provide a direct HTTP origin.'); }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('DDEV must provide a loopback HTTP origin.');
  return url.origin;
}
async function json(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
}
async function save(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}
export function resolveStore(options = {}) {
  const configDir = dirname(resolve(options.config ?? 'test-kit.config.json'));
  const store = options.store ?? '.test-kit';
  if (typeof store !== 'string' || store.startsWith('/') || /[\\\x00-\x1f]/.test(store) || store.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('The store must be a plain relative path.');
  return resolve(configDir, store);
}
export async function ensureStore(options = {}) {
  const configDir = dirname(resolve(options.config ?? 'test-kit.config.json'));
  const storePath = resolveStore(options);
  const offset = relative(configDir, storePath);
  let current = configDir;
  for (const part of offset.split('/')) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('The workflow store must not use symbolic links.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(current, { recursive: true });
  }
  return await realpath(storePath);
}
export async function runWorkflow(command, options = {}, dependencies = {}) {
  if (!['run', 'before', 'after', 'report'].includes(command)) throw new Error('Unknown workflow command.');
  const configPath = resolve(options.config ?? 'test-kit.config.json');
  const configDir = dirname(configPath);
  const storePath = resolveStore(options);
  const offset = relative(configDir, storePath);
  if (!offset || offset.startsWith('..') || offset.startsWith('/') || /[\\\x00-\x1f]/.test(offset)) throw new Error('The store must be a subdirectory of the configuration directory.');
  await ensureStore(options);
  const statePath = join(storePath, 'state.json');
  if (command === 'report') {
    const state = await json(statePath, {});
    if (options.run && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(options.run)) throw new Error('Invalid report ID.');
    const report = options.run ? `reports/${options.run}/report.json` : state.report;
    if (!report || !/^reports\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\/report\.json$/.test(report)) throw new Error('No comparison report. Run after first.');
    {
      const canonical = await realpath(resolve(storePath, report));
      const boundary = relative(await realpath(storePath), canonical);
      if (!boundary || boundary.startsWith('..') || boundary.startsWith('/')) throw new Error('Report escapes the workflow store.');
    }
    if (options.export) {
      const exportReport = dependencies.exportReport ?? (await import('../export/report.js')).exportReport;
      const result = await exportReport({ reportPath: resolve(storePath, report), outputDir: resolve(configDir, options.export) });
      return { output: { ...result, reportPath: resolve(storePath, report), storePath }, exitCode: 0 };
    }
    const serve = dependencies.serve ?? (await import('../server/serve.js')).serve;
    const result = await serve({ reportPath: resolve(storePath, report), port: options.port ?? 0 });
    return { output: { url: result.origin, reportPath: resolve(storePath, report), storePath }, exitCode: 0 };
  }
  const lock = join(storePath, 'lock');
  try { await mkdir(lock); } catch (error) { if (error.code === 'EEXIST') throw new Error('A workflow already owns this store. Remove its lock only after the process stops.'); throw error; }
  const runtime = join(configDir, `.test-kit.runtime-${randomUUID()}.json`);
  try {
    let config = selectConfig(await json(configPath), options);
    const side = options.side ?? 'local';
    if (!config.sides[side]) throw new Error('Unknown side.');
    if (options.ddev && config.sides[side].remote === true) throw new Error('A remote side has no DDEV origin. Remove --ddev.');
    if (options.ddev) {
      const describe = dependencies.describe ?? (async () => JSON.parse((await execute('ddev', ['describe', '--json-output'], { cwd: configDir, timeout: 30000, maxBuffer: 2 * 1024 * 1024 })).stdout));
      config.sides[side].origin = loopbackOrigin(await describe());
    }
    config.runsRoot = `${offset.split('\\').join('/')}/runs`;
    config = normalizeConfig(config);
    const scope = digest(JSON.stringify({ side, config }));
    let sourceFingerprint = null;
    if (config.artifacts.includes('behavior')) {
      const source = await (dependencies.loadBehaviorSource ?? loadBehaviorSource)({ projectRoot: configDir, directory: config.behavior.source, lockfile: config.behavior.lockfile, enabled: config.behavior.enabled });
      sourceFingerprint = source.fingerprint;
    }
    let lockfile = '';
    try { lockfile = await readFile(join(configDir, 'package-lock.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const policy = digest(JSON.stringify({ config, side, sourceFingerprint }) + digest(lockfile));
    const state = await json(statePath, { schemaVersion: 1, profiles: {} });
    if (state.schemaVersion !== 1 || !state.profiles || Array.isArray(state.profiles)) throw new Error('Unsupported workflow state.');
    const profile = state.profiles[scope] ?? {};
    if (command === 'after' && (!profile.before || profile.policy !== policy)) throw new Error('Run before with this selection, configuration, contracts, lockfile, and origin.');
    await writeFile(runtime, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
    const capture = dependencies.capture ?? (await import('../capture/index.js')).capture;
    const result = await capture({ configPath: runtime, side, label: options.label ?? command });
    const run = result.run;
    const output = { id: run.id, state: run.state, manifestPath: result.manifestPath, storePath, scope };
    const exitCode = run.state === 'complete' ? 0 : 1;
    if (command === 'run') {
      const feedback = dependencies.summarizeRunFeedback ?? (await import('./feedback.js')).summarizeRunFeedback;
      output.feedback = await feedback(run, join(storePath, 'runs'));
    }
    if (command === 'before') {
      if (exitCode) return { output: { ...output, baselineUpdated: false }, exitCode };
      state.profiles[scope] = { before: run.id, policy };
      delete state.report;
    }
    if (command === 'after') {
      const compare = dependencies.compareRuns ?? (await import('../compare/runs.js')).compareRuns;
      const comparison = await compare({ runsRoot: join(storePath, 'runs'), runA: profile.before, runB: run.id, outputDir: join(storePath, 'reports', run.id), kind: 'update', rules: config.rules, known_diffs: config.known_diffs, contentChecks: config.checks, contentExpectedLanguage: config.content?.expectedLanguage });
      state.report = `reports/${run.id}/report.json`;
      output.reportPath = comparison.reportPath;
    }
    await save(statePath, state);
    return { output, exitCode };
  } finally { await rm(runtime, { force: true }); await rm(lock, { recursive: true, force: true }); }
}
