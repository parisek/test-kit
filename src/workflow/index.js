import { mkdir, readFile, writeFile, rename, rm, lstat, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadBehaviorSource } from '../behavior/source.js';
import { normalizeConfig } from '../config/index.js';
import { selectConfig } from './selection.js';
import { allowlistPath, readAllowlist } from '../allowlist/file.js';
import { DEFAULT_STORE, DEFAULT_RUNS_ROOT, ensureStoreIgnore, assertOutsideInputs } from '../config/store.js';
export { selectConfig } from './selection.js';
const execute = promisify(execFile);
const NO_BASELINE = 'No baseline in the store. Run before again, then run after.';
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
  const store = options.store ?? DEFAULT_STORE;
  if (typeof store !== 'string' || store.startsWith('/') || /[\\\x00-\x1f]/.test(store) || store.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('The store must be a plain relative path.');
  const path = resolve(configDir, store);
  // R12.6: a store inside `inputs/` of the default store would write into the project files.
  assertOutsideInputs(path, [resolve(configDir, DEFAULT_STORE)], '--store');
  return path;
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
  await ensureStoreIgnore(storePath);
  return await realpath(storePath);
}
// Inside the DDEV web container, `ddev` prints a notice instead of JSON.
export function parseDdevDescription(stdout) {
  try { return JSON.parse(stdout); }
  catch { throw new Error('ddev describe returned no JSON. Run --ddev on the host, not inside the DDEV container.'); }
}

export async function describeDdev(cwd) {
  const { stdout } = await execute('ddev', ['describe', '--json-output'], { cwd, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  return parseDdevDescription(stdout);
}

// Every command that writes the store refreshes the static viewer at its root (R10.16, #312).
// A failed refresh is a warning. It never changes the result or the exit code of the command.
export async function refreshViewerAfter(result, dependencies = {}, storePath = result.output?.storePath) {
  if (!storePath) return result;
  try {
    const refresh = dependencies.refreshStoreViewer ?? (await import('../export/store-viewer.js')).refreshStoreViewer;
    const viewer = await refresh({ store: storePath });
    return { ...result, stderr: [...(result.stderr ?? []), ...(viewer.warnings ?? [])] };
  } catch (error) {
    return { ...result, stderr: [...(result.stderr ?? []), `test-kit: warning: the store viewer was not refreshed (${error.message}).`] };
  }
}

// `capture`, `import` and plain `perf` refresh the viewer only when they wrote the default store (#312),
// the same condition as `ensureDefaultRunsIgnore`. An explicit `runsRoot` is the project's own folder.
// A failed refresh is a warning. It never changes the result or the exit code.
export async function refreshDefaultStoreViewer(result, configPath, dependencies = {}) {
  try {
    const { loadConfig } = await import('../config/index.js');
    const loaded = await loadConfig(configPath);
    const defaultRoot = resolve(loaded.configDir, DEFAULT_RUNS_ROOT);
    if (loaded.runsRoot !== defaultRoot) return result;
    return await refreshViewerAfter(result, dependencies, dirname(defaultRoot));
  } catch (error) {
    return { ...result, stderr: [...(result.stderr ?? []), `test-kit: warning: the store viewer was not refreshed (${error.message}).`] };
  }
}

// True when the path exists, false only when it is missing. A permission or I/O error is not "missing":
// it propagates, so `after` never tells the user to replace a baseline it merely could not read (#312).
async function present(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

// R3.11: the pair kind of `before` and `after` follows the pair of sides.
// The same local side gives `update`, the same remote side gives `deploy`. A changed side configuration needs a new `before`.
// A remote side against a local side gives `migration`. Any other pair of different sides gives `adhoc`.
export function pairKind({ before, after }) {
  if (!before.id || !Object.hasOwn(before, 'origin')) throw new Error('Run before again. The baseline names a side that the configuration no longer holds.');
  if (before.id === after.id) {
    if (before.digest !== after.digest) throw new Error('Run before with this selection, configuration, contracts, lockfile, and origin.');
    return before.remote === true ? 'deploy' : 'update';
  }
  if (before.remote === true && after.remote !== true) return 'migration';
  return 'adhoc';
}

const idsOf = rows => rows.map(row => row.id);
const within = (list, outer) => list.every(id => outer.includes(id));

// #386, R13.13: find a baseline whose selection holds every cell of the current selection.
// A candidate counts only when its recorded selection, built again from the current configuration, gives its own scope hash:
// then every shared setting, target and viewport is unchanged. Among several, the baseline with the fewest cells wins.
// A baseline with another policy (contracts, lockfile) does not count. Returns null when no baseline holds the cells.
// The caller then gives the usual message.
async function subsetBaseline({ state, current, options, build, policyOf }) {
  if (options.path || options.selector) return null;
  let best = null;
  for (const [key, profile] of Object.entries(state.profiles)) {
    if (!profile?.before || !profile.selection || typeof profile.selection !== 'object') continue;
    const { target, viewport } = profile.selection;
    if ((target !== undefined && typeof target !== 'string') || (viewport !== undefined && typeof viewport !== 'string')) continue;
    let candidate;
    try { candidate = await build({ target, viewport }); } catch { continue; }
    if (candidate.scope !== key) continue;
    const policy = policyOf(candidate.shared);
    if (policy !== profile.policy) continue;
    const viewports = idsOf(current.viewports);
    if (!within(viewports, idsOf(candidate.config.viewports))) continue;
    let targets;
    if (current.targetSource || candidate.config.targetSource) {
      // The catalogue is read at capture. Capture refuses a component that the baseline catalogue does not hold.
      const outer = candidate.config.targetSource?.include;
      targets = current.targetSource?.include;
      if (outer && (!targets || !within(targets, outer))) continue;
    } else {
      targets = idsOf(current.targets);
      if (!within(targets, idsOf(candidate.config.targets))) continue;
    }
    // The size of the candidate baseline. A catalogue without an include list counts as the largest.
    const cells = (candidate.config.targetSource ? candidate.config.targetSource.include?.length ?? Infinity : candidate.config.targets.length) * candidate.config.viewports.length;
    if (best && best.cells <= cells) continue;
    const allTargets = !targets || (!candidate.config.targetSource && targets.length === candidate.config.targets.length);
    const allViewports = viewports.length === candidate.config.viewports.length;
    const subset = { ...(allTargets ? {} : { targets }), ...(allViewports ? {} : { viewports }) };
    best = { cells, ...candidate, profile, policy, subset };
  }
  if (!best) return null;
  const { cells, ...found } = best;
  return found;
}

export async function runWorkflow(command, options = {}, dependencies = {}) {
  return refreshViewerAfter(await executeWorkflow(command, options, dependencies), dependencies);
}

async function executeWorkflow(command, options = {}, dependencies = {}) {
  if (!['run', 'before', 'after', 'report'].includes(command)) throw new Error('Unknown workflow command.');
  const configPath = resolve(options.config ?? 'test-kit.config.json');
  const configDir = dirname(configPath);
  const storePath = resolveStore(options);
  // R12.6: no output goes into `inputs/` of a store. The check runs before the store is written.
  if (command === 'report' && options.export) assertOutsideInputs(resolve(configDir, options.export), [resolve(configDir, DEFAULT_STORE), storePath], '--export');
  const offset = relative(configDir, storePath);
  if (!offset || offset.startsWith('..') || offset.startsWith('/') || /[\\\x00-\x1f]/.test(offset)) throw new Error('The store must be a subdirectory of the configuration directory.');
  const statePath = join(storePath, 'state.json');
  // A deleted store has no baseline. Say so before ensureStore re-creates it (#312).
  if (command === 'after' && !(await present(statePath))) throw new Error(NO_BASELINE);
  await ensureStore(options);
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
  // The runtime copy lives in the store, so the project root stays free of stray files (#312).
  const runtime = join(storePath, `.runtime-${randomUUID()}.json`);
  try {
    const input = await json(configPath);
    const side = options.side ?? 'local';
    let ddevOrigin;
    // Build the configuration of one selection. The scope holds the selection and the shared configuration, not the side (R13.13, #240).
    // `before` and `after` may name two sides. The side travels in the profile instead.
    const build = async selected => {
      const built = selectConfig(input, { ...options, ...selected });
      if (!built.sides[side]) throw new Error('Unknown side.');
      if (built.sides[side].kind === 'design') throw new Error('A design side holds images. Use import for it.');
      if (options.ddev && built.sides[side].remote === true) throw new Error('A remote side has no DDEV origin. Remove --ddev.');
      if (options.ddev) {
        const describe = dependencies.describe ?? (() => describeDdev(configDir));
        ddevOrigin ??= loopbackOrigin(await describe());
        built.sides[side].origin = ddevOrigin;
      }
      built.runsRoot = `${offset.split('\\').join('/')}/runs`;
      const normalized = normalizeConfig(built);
      const { sides: allSides, ...shared } = normalized;
      return { config: normalized, shared, sideDigest: digest(JSON.stringify(allSides[side])), scope: digest(JSON.stringify({ config: shared })) };
    };
    let { config, shared, sideDigest, scope } = await build({});
    let sourceFingerprint = null;
    if (config.artifacts.includes('behavior')) {
      const source = await (dependencies.loadBehaviorSource ?? loadBehaviorSource)({ projectRoot: configDir, directory: config.behavior.source, lockfile: config.behavior.lockfile, enabled: config.behavior.enabled });
      sourceFingerprint = source.fingerprint;
    }
    let lockfile = '';
    try { lockfile = await readFile(join(configDir, 'package-lock.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const policyOf = sharedConfig => digest(JSON.stringify({ config: sharedConfig, sourceFingerprint }) + digest(lockfile));
    let policy = policyOf(shared);
    const state = await json(statePath, { schemaVersion: 1, profiles: {} });
    if (state.schemaVersion !== 1 || !state.profiles || Array.isArray(state.profiles)) throw new Error('Unsupported workflow state.');
    let profile = state.profiles[scope] ?? {};
    if (command === 'after' && !profile.before && !Object.keys(state.profiles).length) throw new Error(NO_BASELINE);
    // R13.13, #386: `after` may select a subset of the cells of a baseline. It captures the baseline configuration
    // with a recorded selection (R4.5), so every settings hash equals the baseline hash. A cell outside the baseline stays an error.
    let subset = null;
    if (command === 'after' && !profile.before) {
      const found = await subsetBaseline({ state, current: config, options, build, policyOf });
      if (found) ({ config, shared, sideDigest, scope, profile, policy, subset } = found);
    }
    if (command === 'after' && (!profile.before || profile.policy !== policy)) throw new Error('Run before with this selection, configuration, contracts, lockfile, and origin.');
    // The pair of sides decides the report kind (R3.11). A changed side configuration stops before any capture runs.
    let kind = 'update';
    if (command === 'after') {
      kind = pairKind({ before: { id: profile.side, ...config.sides[profile.side], digest: profile.sideDigest }, after: { id: side, ...config.sides[side], digest: sideDigest } });
    }
    // Check the baseline before any capture runs. Any other ENOENT from compare passes through unchanged.
    if (command === 'after' && !(await present(join(storePath, 'runs', String(profile.before), 'run.json')))) throw new Error(`The baseline run ${profile.before} is gone from the store. Run before again, then run after.`);
    // R9.12: read the allowlist before any capture. A bad file stops `after` here and never falls back to an empty list.
    const allowlistEntries = command === 'after' ? (await readAllowlist(allowlistPath({ configPath, override: options.allowlist }))).entries : [];
    await writeFile(runtime, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
    const capture = dependencies.capture ?? (await import('../capture/index.js')).capture;
    const result = await capture({ configPath: runtime, baseDir: configDir, side, label: options.label ?? command, ...(subset ?? {}) });
    const run = result.run;
    const output = { id: run.id, state: run.state, manifestPath: result.manifestPath, storePath, scope, ...(subset ? { subset } : {}) };
    const exitCode = run.state === 'complete' ? 0 : 1;
    // R5.11: the same stderr line as `capture`. Stdout stays one JSON line.
    const { warningLine } = await import('../report/warnings.js');
    const line = warningLine(run);
    const warned = line ? { stderr: [line] } : {};
    if (command === 'run') {
      const feedback = dependencies.summarizeRunFeedback ?? (await import('./feedback.js')).summarizeRunFeedback;
      output.feedback = await feedback(run, join(storePath, 'runs'));
    }
    if (command === 'before') {
      if (exitCode) return { output: { ...output, baselineUpdated: false }, exitCode, ...warned };
      // The selection options let a later `after` find this baseline for a subset of its cells (#386).
      // A path or a selector builds its own target, so such a baseline serves only the same selection.
      const selection = options.path || options.selector ? null : { ...(options.target ? { target: options.target } : {}), ...(options.viewport ? { viewport: options.viewport } : {}) };
      state.profiles[scope] = { before: run.id, policy, side, sideDigest, ...(selection ? { selection } : {}) };
      delete state.report;
    }
    if (command === 'after') {
      const compare = dependencies.compareRuns ?? (await import('../compare/runs.js')).compareRuns;
      const comparison = await compare({ runsRoot: join(storePath, 'runs'), runA: profile.before, runB: run.id, outputDir: join(storePath, 'reports', run.id), kind, rules: config.rules, known_diffs: config.known_diffs, contentChecks: config.checks, contentExpectedLanguage: config.content?.expectedLanguage, allowlistEntries });
      state.report = `reports/${run.id}/report.json`;
      output.reportPath = comparison.reportPath;
    }
    await save(statePath, state);
    return { output, exitCode, ...warned };
  } finally { await rm(runtime, { force: true }); await rm(lock, { recursive: true, force: true }); }
}
