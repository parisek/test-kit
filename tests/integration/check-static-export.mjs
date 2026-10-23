// Explicit browser check for portable exports on a shared static origin.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { exportReport } from '../../src/export/report.js';
import { CHECK_VERSION } from '../../src/checks/index.js';
import { performanceSettings, performanceProvenance, summarizeSamples, comparePerformance } from '../../src/perf/model.js';

const root = await mkdtemp(join(tmpdir(), 'test-kit-static-viewer-'));
let server, browser;
try {
  const source = join(root, 'source');
  await mkdir(source);
  const png = new PNG({ width: 2, height: 2 }); png.data.fill(255);
  await writeFile(join(source, 'shot.png'), PNG.sync.write(png));
  const status = { statusCode: 200, finalPath: '/', redirects: [], assets: { requests: 1, failed: 0, httpErrors: 0 } };
  const settings = performanceSettings();
  const captured = { state: 'captured', settings, suspect: false, ...performanceProvenance(settings, '13.5.0', 'fixture-browser'), metrics: summarizeSamples([100, 110, 120].map(n => ({ lcp_ms: n, fcp_ms: n, tbt_ms: n, cls: 0, speed_index_ms: n })), 3) };
  const comparisons = {
    html: { changed: true, method: 'prefix-suffix-replacement', removedLines: 0, addedLines: 1, displayedLines: 1, omittedLines: 0, lines: [{ kind: 'added', line: 1, text: '<script>window.injected=true</script>', truncated: false }] },
    status: { changed: false, a: status, b: status },
    content: { schemaVersion: 1, checkVersion: CHECK_VERSION, changed: false, incomplete: false, checks: [], findings: [] },
    behavior: { state: 'complete', changed: false, steps: [] },
    lighthouse: { ...comparePerformance(captured, captured, { environmentA: 'local', environmentB: 'local' }), a: captured, b: captured },
  };
  const artifacts = { screenshot: { state: 'complete', a: { src: 'shot.png' }, b: { src: 'shot.png' }, diff: { src: 'shot.png', ratio: 0 } } };
  for (const [kind, data] of Object.entries(comparisons)) {
    await writeFile(join(source, kind + '.json'), JSON.stringify(data));
    const provenance = { tool: 'fixture', version: '1', settingsHash: 'fixture-settings' };
    const src = kind + '.json';
    artifacts[kind] = { state: 'complete', a: { src, ...provenance }, b: { src, ...provenance }, diff: { src, changed: data.changed ?? false, ...provenance } };
  }
  await writeFile(join(source, 'raw.txt'), '<script>window.injected=true</script>');
  await writeFile(join(source, 'audit.html'), '<script>window.injected=true</script>');
  await writeFile(join(source, 'audit.json'), '{}');
  artifacts.html.a.src = 'raw.txt';
  artifacts.html.b.src = 'raw.txt';
  artifacts.lighthouse.a.reports = [{ html: { src: 'audit.html' }, json: { src: 'audit.json' } }];
  const report = { schemaVersion: 2, meta: { title: 'Static export fixture', matchBelow: 3, viewports: [{ id: 'wide' }], noiseFloor: null }, pair: { kind: 'convergence', aRunId: 'a', bRunId: 'b' }, runs: [{ id: 'a' }, { id: 'b' }], entries: [{ id: 'example', title: 'Example page', kind: 'page', viewports: [{ id: 'wide', state: 'complete', artifacts }] }], findings: [], causes: [], rules: {} };
  const reportPath = join(source, 'report.json');
  await writeFile(reportPath, JSON.stringify(report));
  const outputDir = join(root, 'export');
  await exportReport({ reportPath, outputDir });
  const exported = JSON.parse(await readFile(join(outputDir, 'report.json'), 'utf8'));
  const exportedArtifacts = exported.entries[0].viewports[0].artifacts;
  let prefix = '/';
  const requests = [];
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    requests.push(path);
    if (!path.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const name = path.slice(prefix.length) || 'index.html';
    if (name.includes('..')) { response.writeHead(404).end(); return; }
    try {
      const bytes = await readFile(join(outputDir, name));
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.txt': 'text/plain' })[extname(name)] ?? 'application/octet-stream');
      response.end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  for (prefix of ['/', '/reports/example/pair/']) {
    requests.length = 0;
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + prefix);
    await page.locator('h1').filter({ hasText: 'Static export fixture' }).waitFor();
    await page.locator('[data-view=evidence]').click();
    await page.locator('img').first().waitFor();
    assert.equal(await page.locator('img').first().evaluate(image => image.complete && image.naturalWidth === 2), true);
    for (const title of ['HTML', 'Status', 'Content', 'Behavior', 'Lighthouse']) {
      await page.getByRole('navigation', { name: 'Evidence type' }).getByRole('button', { name: title, exact: true }).click();
      await page.waitForFunction(() => !document.body.textContent.includes('Loading evidence…'));
      assert.equal(await page.getByText(/Invalid .*comparison|Evidence request fails/).count(), 0, title);
    }
    const nativeHtml = exportedArtifacts.lighthouse.a.reports[0].html.src;
    assert.ok(await page.locator(`a[href$="${nativeHtml}"]`).count());
    for (const suffix of [exportedArtifacts.html.a.src, nativeHtml]) {
      const raw = await page.request.get(origin + prefix + suffix);
      assert.match(raw.headers()['content-type'], /text\/plain/);
      assert.match(await raw.text(), /<script>/);
    }
    for (const view of ['overview', 'findings', 'info', 'evidence']) await page.locator(`[data-view="${view}"]`).click();
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.deepEqual(errors, []);
    assert.ok(requests.includes(prefix + 'report.json'));
    assert.ok(requests.includes(prefix + exportedArtifacts.screenshot.a.src));
    for (const kind of Object.keys(comparisons)) assert.ok(requests.includes(prefix + exportedArtifacts[kind].diff.src), kind);
    assert.ok(requests.every(path => path.startsWith(prefix)), requests.join('\n'));
    await page.close();
  }
  console.log('Static exports load at root and deep prefixes. All evidence stays under its prefix.');
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
