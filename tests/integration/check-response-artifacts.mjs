// Explicit local vertical-slice check. No browser runs in npm test.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { capture } from '../../src/capture/index.js';
import { compareRuns } from '../../src/compare/runs.js';
import { queryArtifact } from '../../src/query/artifact.js';
import { summarizeReport } from '../../src/query/summary.js';
import { serve } from '../../src/server/serve.js';

const directory = await mkdtemp(join(tmpdir(), 'test-kit-response-'));
let variant = 'before', navigations = 0, viewer, browser;
const site = createServer((request, response) => {
  if (request.url === '/large') {
    navigations++;
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.write('<!doctype html>'); response.end('x'.repeat(2 * 1024 * 1024)); return;
  }
  if (request.url === '/redirect') {
    navigations++; response.writeHead(302, { Location: '/page' }); response.end(); return;
  }
  navigations++;
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<!doctype html>\n<html><body><h1>Same visible page</h1>\n<!-- ' + variant + ' -->\n<script>document.body.dataset.executed="yes";</script>\n</body></html>');
});
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + site.address().port;
try {
  const configPath = join(directory, 'config.json');
  const config = { schemaVersion: 1, sides: { local: { origin } }, targets: [{ id: 'home', kind: 'page', path: '/page' }],
    viewports: [{ id: 'wide', width: 640, height: 480 }], runsRoot: 'runs' };
  await writeFile(configPath, JSON.stringify(config));
  const shot = await capture({ configPath, side: 'local' });
  const a = await capture({ configPath, side: 'local', artifacts: ['screenshot', 'html', 'status'] });
  variant = 'after';
  const b = await capture({ configPath, side: 'local', artifacts: ['screenshot', 'html', 'status'] });
  assert.equal(navigations, 3, 'One navigation feeds all artifacts.');
  assert.equal(shot.run.settingsHash, b.run.settingsHash, 'Opt-in response artifacts do not invalidate screenshots.');
  const raw = await readFile(join(a.runDir, a.run.captures[0].artifacts.html.path), 'utf8');
  assert.ok(raw.includes('<script>')); assert.ok(!raw.includes('data-executed'), 'HTML is response body, not DOM.');
  const result = await compareRuns({ runsRoot: join(directory, 'runs'), runA: a.run.id, runB: b.run.id, outputDir: join(directory, 'report') });
  assert.equal(result.report.entries[0].viewports[0].ratio, 0);
  assert.equal(result.report.findings[0].artifact, 'html');
  assert.equal(summarizeReport(result.report).counts.unexplained, 1);
  const query = await queryArtifact(result.reportPath, { target: 'home', viewport: 'wide', artifact: 'html', maxLines: 1 });
  assert.equal(query.diff.displayedLines, 1); assert.equal(query.diff.omittedLines, 1);
  await assert.rejects(queryArtifact(result.reportPath, { target: 'other', viewport: 'wide', artifact: 'html' }), /Unknown target/);
  await assert.rejects(queryArtifact(result.reportPath, { target: 'home', viewport: 'other', artifact: 'html' }), /viewport/);
  const mixed = await compareRuns({ runsRoot: join(directory, 'runs'), runA: shot.run.id, runB: b.run.id, outputDir: join(directory, 'mixed') });
  assert.equal(mixed.report.entries[0].viewports[0].ratio, 0);
  assert.equal(mixed.report.entries[0].viewports[0].state, 'missing');
  assert.equal(summarizeReport(mixed.report).counts.match, 0);
  const htmlOnly = await capture({ configPath, side: 'local', artifacts: ['html'] });
  const htmlMixed = await compareRuns({ runsRoot: join(directory, 'runs'), runA: htmlOnly.run.id, runB: b.run.id, outputDir: join(directory, 'html-mixed') });
  assert.equal(htmlMixed.report.entries[0].viewports[0].artifacts.screenshot.state, 'missing');
  assert.equal(htmlMixed.report.entries[0].viewports[0].artifacts.html.state, 'complete');
  const status = await capture({ configPath, side: 'local', artifacts: ['status'] });
  const statusRepeat = await capture({ configPath, side: 'local', artifacts: ['status'] });
  const statusReport = await compareRuns({ runsRoot: join(directory, 'runs'), runA: status.run.id, runB: statusRepeat.run.id, outputDir: join(directory, 'status') });
  assert.equal(summarizeReport(statusReport.report).verdict, 'no-comparable-evidence');
  const statusMixed = await compareRuns({ runsRoot: join(directory, 'runs'), runA: status.run.id, runB: shot.run.id, outputDir: join(directory, 'status-mixed') });
  assert.equal(statusMixed.report.entries[0].viewports[0].artifacts.screenshot.state, 'missing');
  config.targets[0].path = '/large';
  await writeFile(configPath, JSON.stringify(config));
  const large = await capture({ configPath, side: 'local', artifacts: ['html'] });
  assert.equal(large.run.state, 'partial');
  assert.equal(large.run.captures[0].artifacts.html.state, 'failed');
  config.targets[0].path = '/redirect';
  await writeFile(configPath, JSON.stringify(config));
  const redirected = await capture({ configPath, side: 'local', artifacts: ['status'] });
  const statusBody = JSON.parse(await readFile(join(redirected.runDir, redirected.run.captures[0].artifacts.status.path)));
  assert.deepEqual(statusBody.redirects, ['/redirect']); assert.equal(statusBody.finalPath, '/page');
  // Preserve HTML if a later screenshot settlement step fails.
  config.targets[0].path = '/page'; config.sides.local.settle = { selectors: ['.never-present'] }; config.screenshot = { timeoutMs: 1000 };
  await writeFile(configPath, JSON.stringify(config));
  const partial = await capture({ configPath, side: 'local', artifacts: ['screenshot', 'html'] });
  assert.equal(partial.run.captures[0].state, 'failed');
  assert.equal(partial.run.captures[0].artifacts.html.state, 'captured');
  viewer = await serve({ reportPath: result.reportPath });
  const htmlSrc = result.report.entries[0].viewports[0].artifacts.html.a.src;
  const served = await fetch(viewer.origin + '/' + htmlSrc);
  assert.match(served.headers.get('content-type'), /^text\/plain/);
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(viewer.origin + '/not-indexed.txt')).status, 404);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(viewer.origin);
  await page.locator('#notice').filter({ hasText: 'Loaded' }).waitFor();
  await page.getByRole('button', { name: 'home · wide evidence' }).click();
  await page.getByRole('button', { name: 'Load html comparison' }).click();
  await page.locator('pre').filter({ hasText: 'prefix-suffix-replacement' }).waitFor();
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.deepEqual(errors, []);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  console.log('HTML/status opt-in, same navigation, bounded query, compatibility, and safe viewer checks pass.');
} finally {
  if (browser) await browser.close();
  if (viewer) await viewer.close();
  await new Promise(resolve => { site.close(resolve); site.closeAllConnections(); });
  await rm(directory, { recursive: true, force: true });
}
