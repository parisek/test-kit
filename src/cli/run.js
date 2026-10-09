export const COMMANDS = Object.fromEntries(['capture', 'diff', 'summary', 'serve', 'query'].map(name => [name, {}]));
const HELP = `test-kit: testing and comparison tool for sites
Usage: test-kit <command> [options]
  capture --side ID [--config FILE] [--label TEXT] [--artifacts screenshot,html,status]
  diff RUN_A RUN_B --output DIRECTORY [--config FILE] [--kind KIND]
  summary REPORT [--max-targets N] [--filter FILTER] [--target ID]
  query REPORT --target ID --viewport ID --artifact html|status [--max-lines N]
  serve REPORT [--port N]
  -h, --help     Show this help.
  -v, --version  Show the version.
`;
const FLAGS = { capture: ['config', 'side', 'label', 'artifacts'], diff: ['config', 'output', 'kind'], summary: ['max-targets', 'filter', 'target'], serve: ['port'], query: ['target', 'viewport', 'artifact', 'max-lines'] };
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
    const value = args[++index];
    if (value == null || value.startsWith('--') || value === '') throw new Error(`Missing value: ${argument}`);
    options[name] = value;
  }
  const expected = { capture: 0, diff: 2, summary: 1, serve: 1, query: 1 }[command];
  if (positions.length !== expected) throw new Error(`${command} requires ${expected} positional arguments`);
  if (command === 'capture' && !options.side) throw new Error('capture requires --side');
  if (command === 'diff' && !options.output) throw new Error('diff requires --output');
  if (command === 'query' && (!options.target || !options.viewport || !['html', 'status'].includes(options.artifact))) throw new Error('query requires --target, --viewport, and --artifact html|status');
  if (options.artifacts && options.artifacts.split(',').some(kind => !['screenshot', 'html', 'status'].includes(kind))) throw new Error('Unknown capture artifact');
  if (options['max-lines']) options.maxLines = integer(options['max-lines'], '--max-lines', 1, 100);
  if (options.kind && !['convergence', 'self-baseline', 'update', 'migration', 'deploy', 'adhoc'].includes(options.kind)) throw new Error('Unknown pair kind');
  if (options.filter && !['all', 'match', 'explained', 'unexplained', 'oracle', 'incomplete', 'availability'].includes(options.filter)) throw new Error('Unknown summary filter');
  if (options['max-targets']) options.maxTargets = integer(options['max-targets'], '--max-targets', 1, 1000);
  if (options.port) options.port = integer(options.port, '--port', 0, 65535);
  return { command, positions, options };
}
async function dispatch({ command, positions, options }) {
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
    const result = await compareRuns({ runsRoot: loaded.runsRoot, runA: positions[0], runB: positions[1], outputDir: resolve(loaded.configDir, options.output), kind: options.kind ?? 'update' });
    return { output: { reportPath: result.reportPath }, exitCode: 0 };
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
