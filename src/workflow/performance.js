import { readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureStore, loopbackOrigin, describeDdev, refreshViewerAfter } from './index.js';
import { selectConfig } from './selection.js';
import { runPerfCommand } from '../cli/perf.js';

export async function runProjectPerformance(options, budgets, dependencies = {}) {
  const { result, store } = await perform(options, budgets, dependencies);
  return refreshViewerAfter(result, dependencies, store);
}

async function perform(options, budgets, dependencies) {
  const configPath = resolve(options.config ?? 'test-kit.config.json');
  const directory = dirname(configPath);
  const store = await ensureStore(options);
  const config = selectConfig(JSON.parse(await readFile(configPath, 'utf8')), { path: options.path, suite: 'visual' });
  if (options.ddev) {
    config.sides[options.side].origin = loopbackOrigin(await describeDdev(directory));
  }
  // `ensureStore` returns the real store path. Compare it with the real configuration directory, so a path that
  // goes through a symbolic link (the macOS temp folder) still gives a plain relative runsRoot (#359, R12.1).
  config.runsRoot = relative(await realpath(directory), store).split('\\').join('/') + '/runs';
  const runtime = join(store, `.runtime-${randomUUID()}.json`);
  try {
    await writeFile(runtime, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
    return { store, result: await (dependencies.runPerfCommand ?? runPerfCommand)({ configPath: runtime, baseDir: directory, side: options.side, targetIds: options.path ? ['custom-page'] : options.targets.split(','), label: options.label, runs: options.runs, formFactor: options['form-factor'], throttling: options.throttling, budgets, consent: options.consent ?? false, allowHighLoad: options['allow-high-load'] ?? false, failOnBudget: options['fail-on-budget'] ?? false }) };
  } finally { await rm(runtime, { force: true }); }
}
