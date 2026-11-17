import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, cp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { chromium } from '@playwright/test';
import { comparePerformanceArtifact } from '../../src/perf/compare-artifact.js';
import { compareRuns } from '../../src/compare/runs.js';
import { queryArtifact } from '../../src/query/artifact.js';
import { serve } from '../../src/server/serve.js';
import { targetClass } from '../../src/report/classify.js';
import { runPerfCommand } from '../../src/cli/perf.js';
import { runPerformance } from '../../src/perf/index.js';

let partialObserved = false;
let unselectedRequests = 0;
let blockedWrites = 0;
const fixture = http.createServer(async (req, res) => {
  if (req.url === '/unused') unselectedRequests++;
  if (req.url.startsWith('/analytics/')) blockedWrites++;
  try {
    for (const id of await readdir(join(root, 'runs'))) {
      const manifest = JSON.parse(await readFile(join(root, 'runs', id, 'run.json'), 'utf8'));
      if (manifest.state === 'partial' && !manifest.captures.length) partialObserved = true;
    }
  } catch { /* The standalone command has not started yet. */ }
  if (req.url === '/redirect') { res.writeHead(302, { location: 'https://example.com/' }); res.end(); return; }
  res.setHeader('content-type', 'text/html');
  // R6.17: a subresource that leaves the origin is blocked and listed; the page still measures.
  if (req.url === '/blocked-page') { res.end('<!doctype html><html><head><title>Example site</title><script src="/redirect"></script><link rel="stylesheet" href="https://fonts.example.com/a.css"></head><body><h1>Example site</h1></body></html>'); return; }
  // R6.17: a write to the own origin fails the target. The page navigation must end on the own origin.
  if (req.url === '/write-page') { res.end('<!doctype html><html><head><title>Example site</title></head><body><h1>Example site</h1><script>fetch("/track", { method: "POST", body: "x" })</script></body></html>'); return; }
  if (req.url === '/moved-page') { res.writeHead(302, { location: `http://localhost:${fixture.address().port}/` }); res.end(); return; }
  if (req.url === '/path-blocked-page') { res.end('<!doctype html><html><head><title>Example site</title></head><body><h1>Example site</h1><script>fetch("/analytics/hit"); fetch("/analytics/post", { method: "POST", body: "x" })</script></body></html>'); return; }
  res.end('<!doctype html><html lang="en"><head><title>Example site</title><meta name="viewport" content="width=device-width"></head><body><h1>Example site</h1><p>Local performance fixture.</p></body></html>');
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${fixture.address().port}`;
const chromePath = process.env.TEST_KIT_CHROME_PATH || chromium.executablePath();
const root = await mkdtemp(join(tmpdir(), 'test-kit-perf-'));
try {
  const configPath = join(root, 'config.json');
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, sides: { local: { origin } },
    targets: [{ id: 'example-site', kind: 'page', path: '/' }, { id: 'unused', kind: 'page', path: '/unused' }],
    viewports: [{ id: 'desktop', width: 1280, height: 900 }], runsRoot: 'runs' }));
  const command = await runPerfCommand({ configPath, side: 'local', label: 'Local performance fixture', targetIds: ['example-site'],
    chromePath, allowHighLoad: true });
  assert.equal(command.exitCode, 0, JSON.stringify(command.output));
  const run = JSON.parse(await readFile(command.output.manifestPath, 'utf8'));
  const runDir = dirname(command.output.manifestPath);
  const artifact = run.captures[0].artifacts.lighthouse;
  assert.equal(run.state, 'complete');
  assert.equal(run.settings.targets.length, 1);
  assert.deepEqual(run.performance.budgets, {});
  assert.deepEqual(run.performance.findings, []);
  assert.deepEqual(run.settings.artifacts, ['lighthouse']);
  assert.equal(run.captures[0].viewportId, 'desktop');
  assert.equal(run.tools[0].settingsHash, artifact.settingsHash);
  assert.equal(run.tools[0].version, artifact.version);
  assert.equal(partialObserved, true);
  assert.equal(unselectedRequests, 0);
  if (artifact.state !== 'captured' && artifact.reports?.[0]) {
    const raw = JSON.parse(await readFile(join(runDir, artifact.reports[0].json), 'utf8'));
    console.log(JSON.stringify({ metric: raw.audits['largest-contentful-paint'], warnings: raw.runWarnings, runtimeError: raw.runtimeError }));
  }
  assert.equal(artifact.state, 'captured', JSON.stringify(artifact.error));
  assert.equal(artifact.reports.length, 3);
  assert.equal(artifact.metrics.lcp_ms.samples.length, 3);
  for (const report of artifact.reports) {
    const raw = JSON.parse(await readFile(join(runDir, report.json), 'utf8'));
    assert.equal(raw.lighthouseVersion, artifact.version);
    assert.doesNotMatch(raw.configSettings.emulatedUserAgent, /Mobile|Android/);
    assert.match(await readFile(join(runDir, report.html), 'utf8'), /Lighthouse/);
  }
  // Replay the stored measurement on both sides to test the filesystem adapter.
  // This is A/A evidence validation, not a claim of a second measured capture.
  await cp(runDir, join(root, 'runs', 'run-b'), { recursive: true });
  const replay = { ...structuredClone(run), id: 'run-b' };
  // R6.17: the blocked list of a side reaches the comparison detail and the query. A malformed group is left out.
  replay.captures[0].artifacts.lighthouse.blocked = [{ resourceType: 'script', origin: 'https://cdn.example.net', count: 2 }, { resourceType: 'script', origin: 'file:///etc', count: 1 }];
  await writeFile(join(root, 'runs', 'run-b', 'run.json'), JSON.stringify(replay));
  const compared = await compareRuns({ runsRoot: join(root, 'runs'), runA: run.id, runB: 'run-b', outputDir: join(root, 'command-pair'), kind: 'adhoc' });
  assert.equal(compared.exitCode, 0);
  const entry = compared.report.entries[0];
  assert.equal(entry.viewports[0].artifacts.lighthouse.state, artifact.suspect ? 'incompatible' : 'complete');
  assert.equal(targetClass(compared.report, entry), artifact.suspect ? null : 'match');
  const queried = await queryArtifact(compared.reportPath, { target: 'example-site', viewport: 'desktop', artifact: 'lighthouse' });
  assert.deepEqual(queried.diff.a.metrics, artifact.metrics);
  assert.equal(queried.diff.compatible, !artifact.suspect);
  assert.deepEqual(queried.diff.b.blocked, [{ resourceType: 'script', origin: 'https://cdn.example.net', count: 2 }]);
  assert.equal(queried.diff.b.blockedOmitted, 1);
  assert.equal(Object.hasOwn(queried.diff.a, 'blocked'), false);
  const viewer = await serve({ reportPath: compared.reportPath });
  try {
    const html = entry.viewports[0].artifacts.lighthouse.a.reports[0].html.src;
    const response = await fetch(`${viewer.origin}/${html}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/plain/);
    assert.match(response.headers.get('content-disposition'), /^attachment$/);
    assert.equal(await response.text(), await readFile(join(dirname(compared.reportPath), html), 'utf8'), 'The original HTML bytes remain unchanged.');
    assert.doesNotMatch(JSON.stringify(compared.report), /fullPageScreenshot|largest-contentful-paint/);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(viewer.origin);
      await page.locator('[data-view=evidence]').click();
      await page.getByRole('button', { name: 'Lighthouse', exact: true }).click();
      await page.locator('[aria-label="Measured performance comparison"]').waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Performance lab', exact: true }).isVisible(), true);
      const downloadEvent = page.waitForEvent('download');
      await page.getByRole('link', { name: 'A audit 1 · Original Lighthouse HTML', exact: true }).click();
      const download = await downloadEvent;
      assert.equal(download.suggestedFilename(), 'lighthouse-a-1.html');
      assert.equal(await readFile(await download.path(), 'utf8'), await readFile(join(dirname(compared.reportPath), html), 'utf8'));
      assert.equal(await page.getByRole('heading', { name: 'Largest contentful paint', exact: true }).isVisible(), true);
      for (const width of [390, 860, 1100, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Performance evidence overflows at ${width}`);
      }
      assert.deepEqual(errors, [], 'Real performance evidence must load without Node crypto in the browser.');
    } finally { await browser.close(); }
  } finally { await viewer.close(); }
  const changedOrigin = structuredClone(replay);
  changedOrigin.settings.sides.local.origin = `http://localhost:${fixture.address().port}`;
  await writeFile(join(root, 'runs', 'run-b', 'run.json'), JSON.stringify(changedOrigin));
  const originPair = await compareRuns({ runsRoot: join(root, 'runs'), runA: run.id, runB: 'run-b', outputDir: join(root, 'origin-pair') });
  assert.equal(originPair.report.entries[0].viewports[0].artifacts.lighthouse.state, 'incompatible');
  assert.match(originPair.report.entries[0].viewports[0].artifacts.lighthouse.diagnostic, /Different environments/);
  await writeFile(join(root, 'runs', 'run-b', 'run.json'), JSON.stringify(replay));
  if (!artifact.suspect) {
    replay.performance.budgets = { lcp_ms: 0 };
    await writeFile(join(root, 'runs', 'run-b', 'run.json'), JSON.stringify(replay));
    const budget = await compareRuns({ runsRoot: join(root, 'runs'), runA: run.id, runB: 'run-b', outputDir: join(root, 'budget-default') });
    assert.equal(budget.exitCode, 0);
    assert.equal(targetClass(budget.report, budget.report.entries[0]), 'unexplained');
    assert.equal(budget.report.entries[0].viewports[0].artifacts.lighthouse.diff.changed, true);
    const strict = await compareRuns({ runsRoot: join(root, 'runs'), runA: run.id, runB: 'run-b', outputDir: join(root, 'budget-strict'), failOnBudget: true });
    assert.equal(strict.exitCode, 1);
  }
  const options = { a: { id: run.id, side: 'local' }, b: { id: 'run-b', side: 'local' },
    ac: { artifacts: { lighthouse: artifact } }, bc: { artifacts: { lighthouse: artifact } },
    runsRoot: join(root, 'runs'), output: join(root, 'pair'), targetId: 'example-site', viewportId: 'desktop' };
  const pair = await comparePerformanceArtifact(options);
  assert.equal(pair.artifact.state, artifact.suspect ? 'incompatible' : 'complete');
  const detail = JSON.parse(await readFile(join(options.output, pair.artifact.diff.src), 'utf8'));
  assert.deepEqual(detail.a.metrics, artifact.metrics);
  assert.equal(pair.findings.length, 0);
  assert.doesNotMatch(JSON.stringify(detail), /lighthouseVersion|audits|fullPageScreenshot/);
  const otherEnvironment = await comparePerformanceArtifact({ ...options, output: join(root, 'other-pair'), environmentB: 'other' });
  assert.equal(otherEnvironment.artifact.state, 'incompatible');
  assert.match(otherEnvironment.artifact.diagnostic, /Different environments/);
  const rawPath = join(root, 'runs', 'run-b', artifact.reports[0].json);
  const raw = JSON.parse(await readFile(rawPath, 'utf8'));
  raw.audits['largest-contentful-paint'].numericValue += 1;
  await writeFile(rawPath, JSON.stringify(raw));
  const altered = await comparePerformanceArtifact({ ...options, output: join(root, 'altered-pair') });
  assert.equal(altered.artifact.state, 'failed');
  assert.equal(altered.artifact.diff, null);
  // R6.16, R6.17: request isolation without a proxy (#383).
  const isolated = await runPerformance({ chromePath, allowHighLoad: true, consent: true, runDir: join(root, 'isolated-run'),
    network: { origin, blockPaths: ['/analytics/*'] },
    targets: [{ id: 'blocked-page', url: `${origin}/blocked-page` }, { id: 'write-page', url: `${origin}/write-page` },
      { id: 'moved-page', url: `${origin}/moved-page` }, { id: 'path-blocked-page', url: `${origin}/path-blocked-page` }] });
  const byId = Object.fromEntries(isolated.results.map(result => [result.targetId, result.artifact]));
  assert.equal(byId['blocked-page'].state, 'captured', JSON.stringify(byId['blocked-page'].error));
  assert.deepEqual(byId['blocked-page'].blocked.map(group => [group.resourceType, group.origin, group.count]).sort(),
    [['script', 'https://example.com', 3], ['stylesheet', 'https://fonts.example.com', 3]]);
  assert.equal(byId['write-page'].state, 'failed');
  assert.match(byId['write-page'].error.message, /POST fetch request to http:\/\/127\.0\.0\.1/);
  assert.equal(byId['moved-page'].state, 'failed');
  // The other host does not resolve, so Chrome shows an error page and the target fails.
  assert.match(byId['moved-page'].error.message, /Lighthouse failed/);
  assert.equal(byId['path-blocked-page'].state, 'captured', JSON.stringify(byId['path-blocked-page'].error));
  // A POST to a block path is blocked too: it never reaches the server and does not fail the target.
  assert.deepEqual(byId['path-blocked-page'].blocked, [{ resourceType: 'fetch', origin, count: 6 }]);
  assert.equal(blockedWrites, 0);
  assert.deepEqual(isolated.settings.networkPolicy, { version: 'host-allowlist-v1', blockPaths: ['/analytics/*'] });
  // R6.16: a local HTTPS origin with a self-signed certificate measures. Only that certificate is accepted.
  const certificates = await mkdtemp(join(tmpdir(), 'test-kit-perf-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(certificates, 'key.pem'), '-out', join(certificates, 'cert.pem'),
    '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  const secure = https.createServer({ key: await readFile(join(certificates, 'key.pem')), cert: await readFile(join(certificates, 'cert.pem')) }, (req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><html lang="en"><head><title>Example site</title></head><body><h1>Example site</h1><img src="https://example.com/a.png" alt=""></body></html>');
  });
  await new Promise(resolve => secure.listen(0, '127.0.0.1', resolve));
  try {
    const secureOrigin = `https://localhost:${secure.address().port}`;
    const measured = await runPerformance({ chromePath, allowHighLoad: true, runDir: join(root, 'https-run'),
      targets: [{ id: 'example-site', url: `${secureOrigin}/` }] });
    assert.equal(measured.results[0].artifact.state, 'captured', JSON.stringify(measured.results[0].artifact.error));
    assert.deepEqual(measured.results[0].artifact.blocked, [{ resourceType: 'image', origin: 'https://example.com', count: 3 }]);
  } finally {
    secure.closeAllConnections(); await new Promise(resolve => secure.close(resolve));
    await rm(certificates, { recursive: true, force: true });
  }
  console.log('Host isolation, blocked-request evidence, write and redirect failures, local HTTPS, three real desktop Lighthouse audits, immutable CLI manifests and pair evidence validation pass.');
} finally {
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  await rm(root, { recursive: true, force: true });
}
