import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startDesignDemoSite } from '../tests/integration/design-demo-site.mjs';
import { runPerfCommand } from '../src/cli/perf.js';
import { compareRuns } from '../src/compare/runs.js';
import { serve } from '../src/server/serve.js';

// Explicit developer demo. All eight navigations use one anonymous local page.
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === '--port' && /^\d+$/.test(args[1]) && Number(args[1]) <= 65535)) throw new Error('Usage: npm run demo:perf -- [--port 4185]');
const root = resolve(fileURLToPath(new URL('../.test-kit/perf-demo/', import.meta.url)), String(Date.now()));
await mkdir(root, { recursive: true });
const site = await startDesignDemoSite();
let result;
try {
  const configPath = join(root, 'test-kit.config.json');
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, sides: { local: { origin: site.origin } },
    targets: [{ id: 'home', title: 'Example homepage', kind: 'page', path: '/' }],
    viewports: [{ id: 'desktop', width: 1280, height: 900 }], runsRoot: 'runs' }));
  const options = { configPath, side: 'local', targetIds: ['home'], runs: 3, formFactor: 'desktop', chromePath: chromium.executablePath() };
  console.log('Local performance demo: two sets of one discarded warmup and three measured audits.');
  const a = await runPerfCommand({ ...options, label: 'Before update' });
  site.setVariant('after');
  const b = await runPerfCommand({ ...options, label: 'After update' });
  if (a.output.state !== 'complete' || b.output.state !== 'complete') throw new Error('Performance demo is incomplete. Inspect its local run manifests.');
  result = await compareRuns({ runsRoot: join(root, 'runs'), runA: a.output.id, runB: b.output.id, outputDir: join(root, 'report'), kind: 'update' });
} finally { await site.close(); }
const server = await serve({ reportPath: result.reportPath, port: args.length ? Number(args[1]) : 4185 });
console.log(`Performance demo: ${server.origin}/\nReport: ${result.reportPath}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
