import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDesignDemoSite } from '../tests/integration/design-demo-site.mjs';
import { capture } from '../src/capture/index.js';
import { compareRuns } from '../src/compare/runs.js';
import { recordKnown } from '../src/rules/record.js';
import { loadConfig } from '../src/config/index.js';
import { serve } from '../src/server/serve.js';
import { PROTOTYPE_MARKER } from '../frontend/src/prototypes/planned.js';
import { summarizeReport } from '../src/query/summary.js';

// Opt-in developer demo. Every image is captured from a local fixture.
export async function buildDemo({ outputRoot } = {}) {
  const root = resolve(outputRoot ?? fileURLToPath(new URL('../.test-kit/demo/', import.meta.url)), String(Date.now()));
  await mkdir(root, { recursive: true });
  const sites = [await startDesignDemoSite(), await startDesignDemoSite({ variant: 'after' })];
  try {
    const configPath = join(root, 'test-kit.config.json');
    const config = { schemaVersion: 1, sides: { before: { origin: sites[0].origin }, after: { origin: sites[1].origin } },
      targets: [{ id: 'home', title: 'Homepage', kind: 'page', path: '/' },
        { id: 'button', title: 'Primary button', kind: 'component', path: '/components/button', selector: '.primary-button' },
        { id: 'card', title: 'Pricing card', kind: 'component', path: '/components/card', selector: '.card' },
        { id: 'catalogue', title: 'Component catalogue', kind: 'page', path: '/catalogue' },
        { id: 'support', title: 'Support page', kind: 'page', path: '/support' }],
      viewports: [{ id: 'desktop', width: 1280, height: 900 }, { id: 'mobile', width: 390, height: 844 }],
      artifacts: ['screenshot', 'html', 'status', 'content'], checks: ['empty-title', 'lang', 'empty-alt', 'internal-links', 'text-difference'], content: { expectedLanguage: 'en' }, runsRoot: 'runs' };
    await writeFile(configPath, JSON.stringify(config, null, 2));
    const a = await capture({ configPath, side: 'before', label: 'Before update' });
    const b = await capture({ configPath, side: 'after', label: 'After update' });
    if ([a.run, b.run].some(run => run.captures.some(row => row.state !== 'captured' || ['html', 'status'].some(kind => row.artifacts?.[kind]?.state !== 'captured') || (!config.targets.find(target => target.id === row.targetId)?.selector && row.artifacts?.content?.state !== 'captured')))) throw new Error('Demo capture is incomplete.');
    const raw = await compareRuns({ runsRoot: join(root, 'runs'), runA: a.run.id, runB: b.run.id, outputDir: join(root, 'raw-report'), kind: 'adhoc' });
    for (const finding of raw.report.findings.filter(finding => finding.targetId === 'card' && ['screenshot', 'html'].includes(finding.artifact))) {
      await recordKnown({ reportPath: raw.reportPath, configPath, target: finding.targetId, viewport: finding.viewportId,
        artifact: finding.artifact, cause: 'planned-price-change', reason: 'The local fixture changes the plan price from 29 to 39. This is an explicit demo acceptance.' });
    }
    const loaded = await loadConfig(configPath);
    const result = await compareRuns({ runsRoot: loaded.runsRoot, runA: a.run.id, runB: b.run.id, outputDir: join(root, 'report'), kind: 'adhoc', known_diffs: loaded.config.known_diffs });
    result.report.meta.prototype = PROTOTYPE_MARKER;
    await writeFile(result.reportPath, JSON.stringify(result.report, null, 2));
    return { ...result, root, configPath, summary: summarizeReport(result.report) };
  } finally { await Promise.all(sites.map(site => site.close())); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && !(args.length === 2 && args[0] === '--port' && /^\d+$/.test(args[1]) && Number(args[1]) <= 65535)) throw new Error('Usage: npm run demo -- [--port 4183]');
    const result = await buildDemo();
    const server = await serve({ reportPath: result.reportPath, port: args.length ? Number(args[1]) : 4183 });
    console.log(`Demo: ${server.origin}/
Report: ${result.reportPath}
All targets use anonymous local fixtures. Stop with Ctrl+C.`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
