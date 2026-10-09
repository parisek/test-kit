// Explicit browser integration check. npm test does not discover this file.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startExampleSite } from './example-site-server.mjs';
import { capture } from '../../src/capture/index.js';
import { compareRuns } from '../../src/compare/runs.js';
import { summarizeReport } from '../../src/query/summary.js';
import { serve } from '../../src/server/serve.js';

const directory = await mkdtemp(join(tmpdir(), 'test-kit-pipeline-'));
const sites = [];
let viewer;
try {
  sites.push(await startExampleSite(), await startExampleSite({ variant: 'changed' }));
  const configPath = join(directory, 'config.json');
  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    sides: { a: { origin: sites[0].origin }, b: { origin: sites[1].origin } },
    targets: ['unchanged', 'changed', 'redirect', 'delayed-asset', 'motion', 'status/500'].map((path, index) => ({ id: `target-${index}`, kind: 'page', title: path, path: `/${path}` })),
    viewports: [{ id: 'desktop', width: 800, height: 600 }],
    artifacts: ['screenshot'], checks: [], runsRoot: 'runs',
  }));
  const a = await capture({ configPath, side: 'a' });
  const repeat = await capture({ configPath, side: 'a' });
  const b = await capture({ configPath, side: 'b' });
  assert.ok(a.run.captures.every(row => row.state === 'captured'), JSON.stringify(a.run.captures));
  const same = await compareRuns({ runsRoot: join(directory, 'runs'), runA: a.run.id, runB: repeat.run.id, outputDir: join(directory, 'same') });
  assert.equal(summarizeReport(same.report).counts.unexplained, 0);
  const changed = await compareRuns({ runsRoot: join(directory, 'runs'), runA: a.run.id, runB: b.run.id, outputDir: join(directory, 'changed') });
  const summary = summarizeReport(changed.report, { maxTargets: 2 });
  assert.equal(summary.counts.unexplained, 1);
  assert.equal(summary.availabilityCount, 1);
  assert.equal(summary.omitted, 4);
  assert.ok(Buffer.byteLength(JSON.stringify(summarizeReport(changed.report))) < 5000);
  assert.equal(JSON.parse(await readFile(a.manifestPath, 'utf8')).id, a.run.id);
  viewer = await serve({ reportPath: changed.reportPath });
  assert.equal((await fetch(`${viewer.origin}/report.json`)).status, 200);
  assert.equal((await fetch(`${viewer.origin}/package.json`)).status, 404);
  assert.equal((await fetch(`${viewer.origin}/report.json`, { method: 'POST' })).status, 405);
  console.log(JSON.stringify({ same: summarizeReport(same.report).counts, changed: summary.counts, summaryBytes: Buffer.byteLength(JSON.stringify(summarizeReport(changed.report))) }));
} finally {
  if (viewer) await viewer.close();
  await Promise.all(sites.map(site => site.close()));
  await rm(directory, { recursive: true, force: true });
}
