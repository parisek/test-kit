import { builtinChecks } from '../checks/index.js';
import { parseIdList } from '../capture/selection.js';
import { CAPTURE_ARTIFACTS } from '../config/normalize.js';
import { PAIR_KINDS } from '../report/model.js';
export const COMMANDS = Object.fromEntries(['capture', 'diff', 'summary', 'serve', 'query', 'record-known', 'record-allowed', 'perf', 'run', 'before', 'after', 'report', 'history', 'import'].map(name => [name, {}]));
const HELP = `test-kit: testing and comparison tool for sites
Usage: test-kit <command> [options]
  run|before|after [--config FILE] [--side ID] [--target ID,ID|--path PATH] [--selector CSS] [--viewport ID] [--suite all|visual|content|behavior] [--checks ID,ID] [--contracts NAME,NAME] [--store PATH] [--ddev]
  after [--allowlist FILE]   Also read the allowlist from FILE. The default is test-kit.allowlist.json beside the config.
  report [--config FILE] [--store PATH] [--run ID] [--port N|--export DIR]
  history [--config FILE] [--store PATH] [--port N|--export DIR|--publish DIR]
  history --prune [--keep N] [--yes] [--config FILE] [--store PATH]   List the runs it would remove. With --yes, remove the oldest runs beyond --keep (default 20) for each side.
  capture --side ID [--config FILE] [--label TEXT] [--artifacts screenshot,html,status,content,behavior,layout] [--target ID,ID] [--viewport ID,ID] [--packs] [--retries 0..2] [--keep-existing]
  import --side ID [--config FILE] [--label TEXT] [--target ID,ID] [--viewport ID,ID]
  diff RUN_A RUN_B --output DIRECTORY [--config FILE] [--kind KIND] [--checks ID,ID] [--target ID,ID] [--viewport ID,ID] [--allowlist FILE]
  summary REPORT [--max-targets N] [--filter FILTER] [--target ID]
  query REPORT --target ID [--viewport ID] --artifact html|status|content|behavior|layout|lighthouse|lint|a11y [--max-lines N]
  record-known REPORT --config FILE --target ID --viewport ID --artifact screenshot|html|status|content --cause ID --reason TEXT
  record-allowed REPORT --target ID --check ID [--viewport ID] [--fingerprint HASH] --reason TEXT --owner TEXT [--expires YYYY-MM-DD] [--config FILE] [--allowlist FILE]
  perf --side ID [--targets ID,ID|--path PATH] [--ddev] [--store PATH] [--config FILE] [--runs 3..5] [--form-factor desktop|mobile] [--throttling simulated|devtools|provided] [--budget METRIC=VALUE] [--consent] [--allow-high-load] [--fail-on-budget]
  serve REPORT [--port N]
  -h, --help     Show this help.
  -v, --version  Show the version.
`;
const FLAGS = { perf: ['ddev', 'store', 'path', 'config', 'side', 'targets', 'label', 'runs', 'form-factor', 'throttling', 'budget', 'consent', 'allow-high-load', 'fail-on-budget'], capture: ['config', 'side', 'label', 'artifacts', 'packs'], diff: ['config', 'output', 'kind', 'checks', 'fail-on-budget'], summary: ['max-targets', 'filter', 'target'], serve: ['port'], query: ['target', 'viewport', 'artifact', 'max-lines'], 'record-known': ['config', 'target', 'viewport', 'artifact', 'cause', 'reason'],
  'record-allowed': ['config', 'target', 'check', 'viewport', 'fingerprint', 'reason', 'owner', 'expires', 'allowlist'] };
const workflowFlags = ['config', 'side', 'target', 'path', 'selector', 'viewport', 'suite', 'checks', 'contracts', 'label', 'store', 'ddev'];
for (const name of ['run', 'before', 'after']) FLAGS[name] = workflowFlags;
// R4.5: a separate line, so the FLAGS literal above stays easy to merge.
for (const name of ['capture', 'diff']) FLAGS[name] = [...FLAGS[name], 'target', 'viewport'];
// R5.13, R5.14: `capture` only. `run`, `before` and `after` do not pass the flags in 1.3 (ADR 0009, answer 8).
FLAGS.capture = [...FLAGS.capture, 'retries', 'keep-existing'];
// R9.12: `diff` and `after` write a report, so they take the path of the allowlist.
FLAGS.diff = [...FLAGS.diff, 'allowlist'];
FLAGS.after = [...workflowFlags, 'allowlist'];
FLAGS.import = ['config', 'side', 'label', 'target', 'viewport'];
FLAGS.report = ['config', 'store', 'run', 'port', 'export'];
FLAGS.history = ['config', 'store', 'port', 'export', 'publish', 'prune', 'keep', 'yes'];
function integer(value, name, min, max) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error(`${name} must be ${min}..${max}`);
  return Number(value);
}
export function parseCommand(argv) {
  const [command, ...args] = argv;
  if (!Object.hasOwn(COMMANDS, command)) throw new Error(`Unknown command: ${command}`);
  const options = {};
  const positions = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!argument.startsWith('-')) { positions.push(argument); continue; }
    const name = argument.slice(2);
    if (!argument.startsWith('--') || !FLAGS[command].includes(name)) throw new Error(`Unknown option: ${argument}`);
    if (Object.hasOwn(options, name)) throw new Error(`Duplicate option: ${argument}`);
    if (['consent', 'allow-high-load', 'fail-on-budget', 'ddev', 'packs', 'keep-existing', 'prune', 'yes'].includes(name)) { options[name] = true; continue; }
    const value = args[++index];
    if (value == null || value.startsWith('--') || value === '') throw new Error(`Missing value: ${argument}`);
    options[name] = value;
  }
  const expected = { capture: 0, diff: 2, summary: 1, serve: 1, query: 1, 'record-known': 1, 'record-allowed': 1, perf: 0, run: 0, before: 0, after: 0, report: 0, history: 0, import: 0 }[command];
  if (options.publish !== undefined && (options.export !== undefined || options.port !== undefined)) throw new Error('Use --publish alone. Do not combine it with --export or --port.');
  // R12.5: --prune deletes on request only. --keep and --yes mean nothing without it.
  if ((options.keep !== undefined || options.yes) && !options.prune) throw new Error('--keep and --yes need --prune.');
  if (options.prune && (options.publish !== undefined || options.export !== undefined || options.port !== undefined)) throw new Error('Use --prune alone. Do not combine it with --export, --port or --publish.');
  if (options.keep !== undefined) options.keep = integer(options.keep, '--keep', 1, 100000);
  if (options.export && options.port !== undefined) throw new Error('Use --export or --port.');
  if (positions.length !== expected) throw new Error(`${command} requires ${expected} positional arguments`);
  if (command === 'perf' && options.targets && options.path) throw new Error('Use --targets or --path.');
  if (command === 'perf' && (!options.side || (!options.targets && !options.path))) throw new Error('perf requires --side and --targets');
  if (options.runs) options.runs = integer(options.runs, '--runs', 3, 5);
  if (options.retries !== undefined) options.retries = integer(options.retries, '--retries', 0, 2);
  if (options['form-factor'] && !['desktop', 'mobile'].includes(options['form-factor'])) throw new Error('Unknown performance form factor');
  if (options.throttling && !['simulated', 'devtools', 'provided'].includes(options.throttling)) throw new Error('Unknown performance throttling');
  if (command === 'capture' && !options.side) throw new Error('capture requires --side');
  if (command === 'import' && !options.side) throw new Error('import requires --side');
  if (command === 'diff' && !options.output) throw new Error('diff requires --output');
  // An absolute result (lint, a11y) may sit at target scope, so --viewport is optional for it (R9.9).
  if (command === 'query' && (!options.target || (!options.viewport && !['lint', 'a11y'].includes(options.artifact)) || !['html', 'status', 'content', 'behavior', 'layout', 'lighthouse', 'lint', 'a11y'].includes(options.artifact))) throw new Error('query requires --target, --artifact html|status|content|behavior|layout|lighthouse|lint|a11y, and --viewport (optional for lint and a11y)');
  if (command === 'record-known' && (!options.config || !options.target || !options.viewport || !['screenshot', 'html', 'status', 'content'].includes(options.artifact) || !options.cause || !options.reason)) throw new Error('record-known requires config, target, viewport, artifact, cause, and reason');
  if (command === 'record-allowed' && (!options.target || !options.check || !options.reason || !options.owner)) throw new Error('record-allowed requires target, check, reason, and owner');
  // R4.5: `capture` and `diff` take lists of ids. The same parser as the workflow commands checks them.
  if (['capture', 'diff', 'import'].includes(command)) for (const name of ['target', 'viewport']) if (options[name]) parseIdList(options[name], name);
  if (options.artifacts && options.artifacts.split(',').some(kind => !CAPTURE_ARTIFACTS.includes(kind))) throw new Error('Unknown capture artifact');
  if (options.checks && !(options.checks === 'none' && ['run', 'before', 'after'].includes(command))) {
    const ids = options.checks.split(',');
    if (ids.length > 6 || new Set(ids).size !== ids.length || ids.some(id => !Object.hasOwn(builtinChecks, id))) throw new Error('Unknown or duplicate content check');
  }
  if (options['max-lines']) options.maxLines = integer(options['max-lines'], '--max-lines', 1, 100);
  if (options.kind && !PAIR_KINDS.includes(options.kind)) throw new Error('Unknown pair kind');
  if (options.filter && !['all', 'match', 'explained', 'unexplained', 'oracle', 'incomplete', 'availability'].includes(options.filter)) throw new Error('Unknown summary filter');
  if (options['max-targets']) options.maxTargets = integer(options['max-targets'], '--max-targets', 1, 1000);
  if (options.port) options.port = integer(options.port, '--port', 0, 65535);
  return { command, positions, options };
}
// capture, import and plain perf refresh the viewer when they wrote the default store (#312). diff writes only --output.
async function refreshLowLevel(result, options) {
  const { refreshDefaultStoreViewer } = await import('../workflow/index.js');
  return refreshDefaultStoreViewer(result, options.config ?? 'test-kit.config.json');
}
export async function dispatch({ command, positions, options }, dependencies = {}) {
  if (['run', 'before', 'after', 'report'].includes(command)) {
    const { runWorkflow } = await import('../workflow/index.js');
    return runWorkflow(command, options);
  }
  if (command === 'history' && options.prune) {
    // R12.5: read the store, remove only on --yes, and refresh the store viewer after a removal (R10.16).
    const { resolveStore, refreshViewerAfter } = await import('../workflow/index.js');
    const { pruneHistory, assertPlainStorePath } = await import('../history/prune.js');
    const { resolve, dirname } = await import('node:path');
    const store = resolveStore(options);
    await assertPlainStorePath(dirname(resolve(options.config ?? 'test-kit.config.json')), store);
    const result = await pruneHistory({ local: store, keep: options.keep, yes: options.yes === true });
    if (options.yes !== true || (!result.output.removed.length && !result.output.failed)) return result;
    return refreshViewerAfter(result, dependencies, result.output.store);
  }
  if (command === 'history' && options.publish !== undefined) {
    // Publish reads the store and writes nothing before its preflight passes (R10.12), so it does not call ensureStore.
    const { resolveStore } = await import('../workflow/index.js');
    const { publishHistory } = await import('../export/publish.js');
    const { resolve, dirname } = await import('node:path');
    const { DEFAULT_STORE, assertOutsideInputs } = await import('../config/store.js');
    const configDir = dirname(resolve(options.config ?? 'test-kit.config.json'));
    const local = resolveStore(options);
    const dir = resolve(configDir, options.publish);
    // R12.6: no output goes into `inputs/` of a store.
    assertOutsideInputs(dir, [resolve(configDir, DEFAULT_STORE), local], '--publish');
    const result = await publishHistory({ local, dir });
    return { output: { published: result.dir, reportCount: result.reportCount, runCount: result.runCount, unavailableReports: result.unavailable }, exitCode: 0, stderr: result.messages };
  }
  if (command === 'history') {
    const { ensureStore } = await import('../workflow/index.js');
    const { startHistory } = await import('../history/index.js');
    let outputDir;
    if (options.export) {
      // R12.6: no output goes into `inputs/` of a store. The check runs before the store is written.
      const { resolveStore } = await import('../workflow/index.js');
      const { resolve, dirname } = await import('node:path');
      const { DEFAULT_STORE, assertOutsideInputs } = await import('../config/store.js');
      const configDir = dirname(resolve(options.config ?? 'test-kit.config.json'));
      outputDir = resolve(configDir, options.export);
      assertOutsideInputs(outputDir, [resolve(configDir, DEFAULT_STORE), resolveStore(options)], '--export');
    }
    const local = await ensureStore(options);
    if (options.export) {
      const { exportHistory } = await import('../export/history.js');
      const result = await exportHistory({ local, outputDir });
      return { output: result, exitCode: 0 };
    }
    const result = await startHistory({ local, port: options.port ?? 0 });
    return { output: { url: result.origin, storePath: local }, exitCode: 0 };
  }
  if (command === 'perf') {
    const { runPerfCommand } = await import('./perf.js');
    const budgets = {};
    for (const item of options.budget?.split(',') ?? []) {
      const [metric, raw, extra] = item.split('=');
      if (extra !== undefined || !raw || Object.hasOwn(budgets, metric) || !Number.isFinite(Number(raw)) || Number(raw) < 0) throw new Error('Invalid performance budget');
      budgets[metric] = Number(raw);
    }
    if (options.ddev || options.store || options.path) {
      const { runProjectPerformance } = await import('../workflow/performance.js');
      return (dependencies.runProjectPerformance ?? runProjectPerformance)(options, budgets);
    }
    return refreshLowLevel(await (dependencies.runPerfCommand ?? runPerfCommand)({ configPath: options.config, side: options.side, targetIds: options.targets.split(','), label: options.label, runs: options.runs, formFactor: options['form-factor'], throttling: options.throttling, budgets, consent: options.consent ?? false, allowHighLoad: options['allow-high-load'] ?? false, failOnBudget: options['fail-on-budget'] ?? false }), options);
  }
  if (command === 'capture') {
    const capture = dependencies.capture ?? (await import('../capture/index.js')).capture;
    const result = await capture({ configPath: options.config ?? 'test-kit.config.json', side: options.side, label: options.label ?? '', artifacts: options.artifacts?.split(','), targets: options.target?.split(','), viewports: options.viewport?.split(','), packs: options.packs === true, retries: options.retries, keepExisting: options['keep-existing'] === true });
    // R13.51: the output names a pack that did not run. A skipped pack is never reported as run.
    const packs = result.run.packs ? { packs: result.run.packs } : {};
    // R5.11: one stderr line when a capture stored lazy images that did not load. Stdout stays one JSON line.
    const { captureWarningLines } = await import('../report/warnings.js');
    const lines = captureWarningLines(result.run);
    // R5.13: the count of kept captures appears only above zero.
    const { keptCount } = await import('../capture/keep.js');
    const kept = keptCount(result.run) ? { kept: keptCount(result.run) } : {};
    const refreshed = await refreshLowLevel({ output: { id: result.run.id, state: result.run.state, manifestPath: result.manifestPath, ...packs, ...kept }, exitCode: result.run.state === 'complete' ? 0 : 1 }, options);
    return lines.length ? { ...refreshed, stderr: [...(refreshed.stderr ?? []), ...lines] } : refreshed;
  }
  if (command === 'import') {
    // R4.6: `files` reads images from the side root. `figma` downloads them. `claude-design` renders artboards on a loopback server.
    const { importDesign } = await import('../design/import.js');
    const result = await importDesign({ configPath: options.config ?? 'test-kit.config.json', side: options.side, label: options.label ?? '', targets: options.target?.split(','), viewports: options.viewport?.split(',') });
    return refreshLowLevel({ output: { id: result.run.id, state: result.run.state, images: result.run.captures.length, manifestPath: result.manifestPath }, exitCode: 0 }, options);
  }
  if (command === 'diff') {
    const { loadConfig } = await import('../config/index.js');
    const { compareRuns } = await import('../compare/runs.js');
    const { resolve } = await import('node:path');
    const loaded = await loadConfig(options.config ?? 'test-kit.config.json');
    // R12.6: the comparison output never goes into `inputs/` of the default store.
    const { DEFAULT_STORE, assertOutsideInputs } = await import('../config/store.js');
    assertOutsideInputs(resolve(loaded.configDir, options.output), [resolve(loaded.configDir, DEFAULT_STORE)], '--output');
    // R9.12: read the allowlist before the comparison. A bad file fails the run before any report exists.
    const { allowlistPath, readAllowlist } = await import('../allowlist/file.js');
    const { entries: allowlistEntries } = await readAllowlist(allowlistPath({ configPath: options.config, override: options.allowlist }));
    const result = await compareRuns({ allowlistEntries, runsRoot: loaded.runsRoot, runA: positions[0], runB: positions[1], outputDir: resolve(loaded.configDir, options.output), kind: options.kind, rules: loaded.config.rules, known_diffs: loaded.config.known_diffs, contentChecks: options.checks?.split(','), contentExpectedLanguage: loaded.config.content?.expectedLanguage, failOnBudget: options['fail-on-budget'] ?? false, filter: options.target || options.viewport ? { targets: options.target?.split(','), viewports: options.viewport?.split(',') } : undefined });
    return { output: { reportPath: result.reportPath }, exitCode: result.exitCode ?? 0 };
  }
  if (command === 'summary') {
    const { open } = await import('node:fs/promises');
    const { summarizeReport } = await import('../query/summary.js');
    const handle = await open(positions[0], 'r');
    let bytes;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error('Report exceeds the size limit');
      const buffer = Buffer.alloc(info.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const result = await handle.read(buffer, length, buffer.length - length, null);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (length > info.size) throw new Error('Report changes during reading');
      bytes = buffer.subarray(0, length);
    } finally { await handle.close(); }
    return { output: summarizeReport(JSON.parse(bytes), { maxTargets: options.maxTargets ?? 20, filter: options.filter ?? 'all', target: options.target }), exitCode: 0 };
  }
  if (command === 'record-allowed') {
    const { recordAllowed } = await import('../allowlist/record.js');
    return { output: await recordAllowed({ reportPath: positions[0], target: options.target, check: options.check, viewport: options.viewport, fingerprint: options.fingerprint, reason: options.reason, owner: options.owner, expires: options.expires, configPath: options.config, allowlist: options.allowlist }), exitCode: 0 };
  }
  if (command === 'record-known') {
    const { recordKnown } = await import('../rules/record.js');
    return { output: await recordKnown({ reportPath: positions[0], configPath: options.config, target: options.target, viewport: options.viewport, artifact: options.artifact, cause: options.cause, reason: options.reason }), exitCode: 0 };
  }
  if (command === 'query') {
    const { queryArtifact } = await import('../query/artifact.js');
    return { output: await queryArtifact(positions[0], { target: options.target, viewport: options.viewport, artifact: options.artifact, maxLines: options.maxLines }), exitCode: 0 };
  }
  const { serve } = await import('../server/serve.js');
  const result = await serve({ reportPath: positions[0], port: options.port ?? 0 });
  return { output: { url: result.origin }, exitCode: 0 };
}
const STORE_COMMANDS = ['run', 'before', 'after', 'report', 'history'];
const RUNSROOT_COMMANDS = ['capture', 'import', 'diff'];
// One line per invocation when the default store is in use and an old `.test-kit/` sits beside the config (#312).
async function legacyNotice({ command, options }) {
  try {
    const usesStore = STORE_COMMANDS.includes(command) || (command === 'perf' && (options.ddev || options.store || options.path));
    if (!usesStore && !RUNSROOT_COMMANDS.includes(command) && command !== 'perf') return null;
    const { resolve, dirname } = await import('node:path');
    const { readFile } = await import('node:fs/promises');
    const { legacyStoreNotice } = await import('../config/store.js');
    const configPath = resolve(options.config ?? 'test-kit.config.json');
    let explicit = options.store !== undefined;
    if (!usesStore && !explicit) {
      try { explicit = Object.hasOwn(JSON.parse(await readFile(configPath, 'utf8')), 'runsRoot'); } catch { return null; }
    }
    return await legacyStoreNotice(dirname(configPath), { explicit });
  } catch { return null; }
}
// Unit tests inject dispatch. Dependencies load only for the selected command.
export async function run(argv, { out, err }, version = '0.0.0', execute = dispatch) {
  if (!argv.length || argv.length === 1 && ['-h', '--help'].includes(argv[0])) { out.write(HELP); return 0; }
  if (argv.length === 1 && ['-v', '--version'].includes(argv[0])) { out.write(`${version}\n`); return 0; }
  if (argv.length === 2 && Object.hasOwn(COMMANDS, argv[0]) && ['-h', '--help'].includes(argv[1])) { out.write(HELP); return 0; }
  try {
    const parsed = parseCommand(argv);
    const notice = await legacyNotice(parsed);
    if (notice) err.write(`${notice}\n`);
    const result = await execute(parsed);
    out.write(`${JSON.stringify(result.output)}\n`);
    for (const line of result.stderr ?? []) err.write(`${line}\n`);
    return result.exitCode;
  } catch (error) { err.write(`${error.message}\n`); return 1; }
}
