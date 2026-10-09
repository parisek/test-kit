import { builtinChecks } from '../checks/index.js';
export const COMMANDS = Object.fromEntries(['capture', 'diff', 'summary', 'serve', 'query', 'record-known', 'perf'].map(name => [name, {}]));
const HELP = `test-kit: testing and comparison tool for sites
Usage: test-kit <command> [options]
  capture --side ID [--config FILE] [--label TEXT] [--artifacts screenshot,html,status,content,behavior]
  diff RUN_A RUN_B --output DIRECTORY [--config FILE] [--kind KIND] [--checks ID,ID]
  summary REPORT [--max-targets N] [--filter FILTER] [--target ID]
  query REPORT --target ID --viewport ID --artifact html|status|content|behavior|lighthouse [--max-lines N]
  record-known REPORT --config FILE --target ID --viewport ID --artifact screenshot|html|content --cause ID --reason TEXT
  perf --side ID --targets ID,ID [--config FILE] [--runs 3..5] [--form-factor desktop|mobile] [--throttling simulated|devtools|provided] [--budget METRIC=VALUE] [--consent] [--allow-high-load] [--fail-on-budget]
  serve REPORT [--port N]
  -h, --help     Show this help.
  -v, --version  Show the version.
`;
const FLAGS = { perf: ['config', 'side', 'targets', 'label', 'runs', 'form-factor', 'throttling', 'budget', 'consent', 'allow-high-load', 'fail-on-budget'], capture: ['config', 'side', 'label', 'artifacts'], diff: ['config', 'output', 'kind', 'checks', 'fail-on-budget'], summary: ['max-targets', 'filter', 'target'], serve: ['port'], query: ['target', 'viewport', 'artifact', 'max-lines'], 'record-known': ['config', 'target', 'viewport', 'artifact', 'cause', 'reason'] };
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
    if (['consent', 'allow-high-load', 'fail-on-budget'].includes(name)) { options[name] = true; continue; }
    const value = args[++index];
    if (value == null || value.startsWith('--') || value === '') throw new Error(`Missing value: ${argument}`);
    options[name] = value;
  }
  const expected = { capture: 0, diff: 2, summary: 1, serve: 1, query: 1, 'record-known': 1, perf: 0 }[command];
  if (positions.length !== expected) throw new Error(`${command} requires ${expected} positional arguments`);
  if (command === 'perf' && (!options.side || !options.targets)) throw new Error('perf requires --side and --targets');
  if (options.runs) options.runs = integer(options.runs, '--runs', 3, 5);
  if (options['form-factor'] && !['desktop', 'mobile'].includes(options['form-factor'])) throw new Error('Unknown performance form factor');
  if (options.throttling && !['simulated', 'devtools', 'provided'].includes(options.throttling)) throw new Error('Unknown performance throttling');
  if (command === 'capture' && !options.side) throw new Error('capture requires --side');
  if (command === 'diff' && !options.output) throw new Error('diff requires --output');
  if (command === 'query' && (!options.target || !options.viewport || !['html', 'status', 'content', 'behavior', 'lighthouse'].includes(options.artifact))) throw new Error('query requires --target, --viewport, and --artifact html|status|content|behavior|lighthouse');
  if (command === 'record-known' && (!options.config || !options.target || !options.viewport || !['screenshot', 'html', 'content'].includes(options.artifact) || !options.cause || !options.reason)) throw new Error('record-known requires config, target, viewport, artifact, cause, and reason');
  if (options.artifacts && options.artifacts.split(',').some(kind => !['screenshot', 'html', 'status', 'content', 'behavior'].includes(kind))) throw new Error('Unknown capture artifact');
  if (options.checks) {
    const ids = options.checks.split(',');
    if (ids.length > 6 || new Set(ids).size !== ids.length || ids.some(id => !Object.hasOwn(builtinChecks, id))) throw new Error('Unknown or duplicate content check');
  }
  if (options['max-lines']) options.maxLines = integer(options['max-lines'], '--max-lines', 1, 100);
  if (options.kind && !['convergence', 'self-baseline', 'update', 'migration', 'deploy', 'adhoc'].includes(options.kind)) throw new Error('Unknown pair kind');
  if (options.filter && !['all', 'match', 'explained', 'unexplained', 'oracle', 'incomplete', 'availability'].includes(options.filter)) throw new Error('Unknown summary filter');
  if (options['max-targets']) options.maxTargets = integer(options['max-targets'], '--max-targets', 1, 1000);
  if (options.port) options.port = integer(options.port, '--port', 0, 65535);
  return { command, positions, options };
}
async function dispatch({ command, positions, options }) {
  if (command === 'perf') {
    const { runPerfCommand } = await import('./perf.js');
    const budgets = {};
    for (const item of options.budget?.split(',') ?? []) {
      const [metric, raw, extra] = item.split('=');
      if (extra !== undefined || !raw || Object.hasOwn(budgets, metric) || !Number.isFinite(Number(raw)) || Number(raw) < 0) throw new Error('Invalid performance budget');
      budgets[metric] = Number(raw);
    }
    return runPerfCommand({ configPath: options.config, side: options.side, targetIds: options.targets.split(','), label: options.label, runs: options.runs, formFactor: options['form-factor'], throttling: options.throttling, budgets, consent: options.consent ?? false, allowHighLoad: options['allow-high-load'] ?? false, failOnBudget: options['fail-on-budget'] ?? false });
  }
  if (command === 'capture') {
    const { capture } = await import('../capture/index.js');
    const result = await capture({ configPath: options.config ?? 'test-kit.config.json', side: options.side, label: options.label ?? '', artifacts: options.artifacts?.split(',') });
    return { output: { id: result.run.id, state: result.run.state, manifestPath: result.manifestPath }, exitCode: result.run.state === 'complete' ? 0 : 1 };
  }
  if (command === 'diff') {
    const { loadConfig } = await import('../config/index.js');
    const { compareRuns } = await import('../compare/runs.js');
    const { resolve } = await import('node:path');
    const loaded = await loadConfig(options.config ?? 'test-kit.config.json');
    const result = await compareRuns({ runsRoot: loaded.runsRoot, runA: positions[0], runB: positions[1], outputDir: resolve(loaded.configDir, options.output), kind: options.kind ?? 'update', rules: loaded.config.rules, known_diffs: loaded.config.known_diffs, contentChecks: options.checks?.split(','), contentExpectedLanguage: loaded.config.content?.expectedLanguage, failOnBudget: options['fail-on-budget'] ?? false });
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
// Unit tests inject dispatch. Dependencies load only for the selected command.
export async function run(argv, { out, err }, version = '0.0.0', execute = dispatch) {
  if (!argv.length || argv.length === 1 && ['-h', '--help'].includes(argv[0])) { out.write(HELP); return 0; }
  if (argv.length === 1 && ['-v', '--version'].includes(argv[0])) { out.write(`${version}\n`); return 0; }
  if (argv.length === 2 && Object.hasOwn(COMMANDS, argv[0]) && ['-h', '--help'].includes(argv[1])) { out.write(HELP); return 0; }
  try {
    const result = await execute(parseCommand(argv));
    out.write(`${JSON.stringify(result.output)}\n`);
    return result.exitCode;
  } catch (error) { err.write(`${error.message}\n`); return 1; }
}
