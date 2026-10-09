import { mkdir, writeFile, rename, readFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { loadConfig, settingsHash } from '../config/index.js';
import { createRunId, ddevMatchesOrigin } from '../capture/helpers.js';
import { runPerformance, evaluateBudgets } from '../perf/index.js';

import { planPerfCommand } from '../perf/plan.js';
export { planPerfCommand } from '../perf/plan.js';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);


async function writeManifest(path, run) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function verifyDdev(directory, origin) {
  if (!new URL(origin).hostname.endsWith('.ddev.site')) return;
  let current = directory;
  while (true) {
    try { await access(join(current, '.ddev')); break; } catch { /* Find the nearest checkout. */ }
    const parent = dirname(current);
    if (parent === current) throw new Error('A DDEV performance origin requires a .ddev checkout.');
    current = parent;
  }
  let description;
  try {
    const { stdout } = await execute('ddev', ['describe', '--json-output'], { cwd: current, timeout: 30000 });
    description = JSON.parse(stdout);
  } catch { throw new Error('Cannot verify the DDEV project for performance.'); }
  if (!ddevMatchesOrigin(description, origin)) throw new Error('The nearest DDEV checkout does not serve the performance origin.');
  try { await execute('ddev', ['mutagen', 'sync'], { cwd: current, timeout: 60000 }); }
  catch { throw new Error('DDEV synchronization fails. Fix it before performance capture.'); }
}

async function gitSha(directory) {
  try {
    const { stdout } = await execute('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: directory, timeout: 10000 });
    if (/^[a-f0-9]{7,40}$/.test(stdout.trim())) return stdout.trim();
  } catch { /* A project can have no Git checkout. */ }
  return '0000000';
}

export async function runPerfCommand(options = {}) {
  const loaded = await loadConfig(options.configPath ?? 'test-kit.config.json');
  const plan = planPerfCommand(loaded.config, options);
  for (const flag of ['consent', 'allowHighLoad', 'failOnBudget']) {
    if (options[flag] !== undefined && typeof options[flag] !== 'boolean') throw new Error(`Performance ${flag} must be boolean.`);
  }
  await verifyDdev(loaded.configDir, loaded.config.sides[options.side].origin);
  let version;
  try { version = JSON.parse(await readFile(require.resolve('lighthouse/package.json'), 'utf8')).version; }
  catch { throw new Error('Install the optional lighthouse peer before performance capture.'); }
  const at = new Date();
  const id = createRunId(at, process.pid, await gitSha(loaded.configDir));
  await mkdir(loaded.runsRoot, { recursive: true });
  const runDir = join(loaded.runsRoot, id);
  await mkdir(runDir);
  const manifestPath = join(runDir, 'run.json');
  const captureSettings = { performance: plan.settings, viewports: [plan.viewport],
    browser: { name: 'chromium', headless: true, networkPolicy: plan.settings.networkPolicy } };
  const hash = settingsHash(captureSettings);
  const run = { schemaVersion: 2, id, side: options.side, label: options.label ?? '', at: at.toISOString(), state: 'partial',
    settings: plan.settingsConfig, captureSettings, settingsHash: hash,
    tools: [{ name: 'lighthouse', version, settingsHash: hash, artifact: 'lighthouse' }], captures: [],
    performance: { cost: plan.cost, budgets: { ...(options.budgets ?? {}) }, findings: [] } };
  await writeManifest(manifestPath, run);
  let findings = [];
  let budgetExit = 0;
  try {
    const measured = await runPerformance({ targets: plan.urls, runDir,
      settings: { runs: options.runs, formFactor: options.formFactor, throttling: options.throttling },
      consent: options.consent ?? false, allowHighLoad: options.allowHighLoad ?? false, chromePath: options.chromePath });
    for (const { targetId, artifact } of measured.results) {
      run.captures.push({ targetId, viewportId: plan.viewport.id, state: artifact.state,
        ...(artifact.error ? { error: artifact.error } : {}), artifacts: { lighthouse: artifact } });
      const budget = evaluateBudgets(artifact, options.budgets, { failOnBudget: options.failOnBudget ?? false });
      budgetExit ||= budget.exitCode;
      findings.push(...budget.findings.map(finding => ({ ...finding, targetId, viewportId: plan.viewport.id })));
    }
    run.tools = [...new Map(measured.results.map(({ artifact }) => [artifact.settingsHash, {
      name: artifact.tool, version: artifact.version, settingsHash: artifact.settingsHash, browserVersion: artifact.browserVersion, artifact: 'lighthouse' }])).values()];
    if (run.captures.length === plan.targets.length && run.captures.every(capture => capture.state === 'captured')) run.state = 'complete';
  } catch (error) {
    run.error = { code: 'PERFORMANCE_COMMAND_FAILED', message: error.message };
    run.captures = plan.targets.map(target => ({ targetId: target.id, viewportId: plan.viewport.id, state: 'failed', error: run.error,
      artifacts: { lighthouse: { kind: 'lighthouse', state: 'failed', tool: 'lighthouse', version, settingsHash: hash, browserVersion: 'unknown', error: run.error } } }));
  }
  run.performance.findings = findings;
  await writeManifest(manifestPath, run);
  return { output: { id, state: run.state, manifestPath, cost: plan.cost, findings, ...(run.error ? { error: run.error } : {}) },
    exitCode: run.state !== 'complete' ? 1 : budgetExit };
}
