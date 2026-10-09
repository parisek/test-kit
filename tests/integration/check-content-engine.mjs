// Explicit browser check. The default unit suite does not capture pages.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordKnown } from '../../src/rules/record.js';
import { normalizeKnown } from '../../src/rules/model.js';
import { capture } from '../../src/capture/index.js';
import { compareRuns } from '../../src/compare/runs.js';
import { queryArtifact } from '../../src/query/artifact.js';
import { serve } from '../../src/server/serve.js';
import { targetClass } from '../../src/report/classify.js';
const directory = await mkdtemp(join(tmpdir(), 'test-kit-content-'));
let variant = 'before', navigations = 0, viewer;
const site = createServer((request, response) => {
  navigations++;
  const broken = request.url === '/linked' && variant === 'after';
  response.writeHead(broken ? 404 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (request.url === '/linked') response.end('<!doctype html><html lang="en"><title>Linked page</title><body><h1>Linked page</h1></body></html>');
  else response.end(variant === 'before'
    ? '<!doctype html><html lang="en"><title>Example site</title><body><h1>Example site</h1><p>Before text</p><a href="/linked">Linked page</a></body></html>'
    : '<!doctype html><html lang="fr"><title> </title><body><h2>Example site</h2><h4>Skipped heading</h4><p>After text</p><img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"><a href="/linked">Linked page</a><a href="/unmeasured">Unknown link</a></body></html>');
});
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
try {
  const configPath = join(directory, 'config.json');
  const config = { schemaVersion: 1, sides: { local: { origin: `http://127.0.0.1:${site.address().port}` } },
    targets: [{ id: 'home', kind: 'page', path: '/' }, { id: 'linked', kind: 'page', path: '/linked' }],
    viewports: [{ id: 'wide', width: 640, height: 480 }], artifacts: ['content', 'status'],
    checks: ['heading-outline', 'lang', 'empty-alt', 'empty-title', 'internal-links', 'text-difference'], content: { expectedLanguage: 'en' }, runsRoot: 'runs' };
  await writeFile(configPath, JSON.stringify(config));
  const a = await capture({ configPath, side: 'local' }); variant = 'after';
  const b = await capture({ configPath, side: 'local' });
  assert.equal(navigations, 4, 'Content and status share each target navigation.');
  const beforeManifest = await readFile(a.manifestPath), afterManifest = await readFile(b.manifestPath);
  const contentPath = join(a.runDir, a.run.captures[0].artifacts.content.path);
  assert.ok(contentPath.endsWith('.json.gz'));
  const compressedSnapshot = await readFile(contentPath);
  assert.equal(compressedSnapshot.subarray(0, 2).toString('hex'), '1f8b');
  assert.equal(JSON.parse(gunzipSync(compressedSnapshot)).source, 'settled-dom');
  const result = await compareRuns({ runsRoot: join(directory, 'runs'), runA: a.run.id, runB: b.run.id, outputDir: join(directory, 'report') });
  const home = result.report.entries.find(entry => entry.id === 'home');
  assert.equal(home.viewports[0].artifacts.content.state, 'missing', 'An unmeasured internal link stays incomplete.');
  assert.equal(targetClass(result.report, home), 'unexplained', 'Known defects remain visible despite incomplete link evidence.');
  const query = await queryArtifact(result.reportPath, { target: 'home', viewport: 'wide', artifact: 'content', maxLines: 3 });
  assert.equal(query.diff.checks.find(check => check.id === 'internal-links').b.state, 'incomplete');
  assert.ok(query.diff.findingsOmitted > 0); assert.ok(query.diff.checks.reduce((sum, check) => sum + check.a.findings.length + check.b.findings.length, 0) <= 3);
  const detail = JSON.parse(await readFile(join(directory, 'report', home.viewports[0].artifacts.content.diff.src)));
  for (const id of ['heading-outline', 'lang', 'empty-alt', 'empty-title', 'internal-links', 'text-difference']) assert.ok(detail.findings.some(finding => finding.checkId === id), `${id} reads actual captured evidence.`);
  assert.ok(detail.checks.find(check => check.id === 'internal-links').b.findings.some(finding => finding.evidence.path === '/linked' && finding.evidence.statusCode === 404));
  const rerun = await compareRuns({ runsRoot: join(directory, 'runs'), runA: a.run.id, runB: b.run.id, outputDir: join(directory, 'rerun'), contentChecks: ['empty-title'] });
  assert.equal(rerun.report.entries[0].viewports[0].artifacts.content.state, 'complete');
  assert.equal(rerun.report.findings.length, 1); assert.equal(rerun.report.findings[0].checkId, 'empty-title');
  config.checks = ['empty-title'];
  await writeFile(configPath, JSON.stringify(config));
  await recordKnown({ reportPath: rerun.reportPath, configPath, target: 'home', viewport: 'wide', artifact: 'content', cause: 'planned-title-change', reason: 'The anonymous fixture intentionally changes its title.' });
  const acceptedConfig = JSON.parse(await readFile(configPath));
  normalizeKnown(acceptedConfig.known_diffs);
  const accepted = await compareRuns({ runsRoot: join(directory, 'runs'), runA: a.run.id, runB: b.run.id, outputDir: join(directory, 'accepted'), contentChecks: ['empty-title'], known_diffs: acceptedConfig.known_diffs });
  assert.equal(targetClass(accepted.report, accepted.report.entries[0]), 'explained');
  const otherPolicy = await compareRuns({ runsRoot: join(directory, 'runs'), runA: a.run.id, runB: b.run.id, outputDir: join(directory, 'other-policy'), contentChecks: ['empty-title', 'lang'], contentExpectedLanguage: 'en', known_diffs: acceptedConfig.known_diffs });
  assert.equal(targetClass(otherPolicy.report, otherPolicy.report.entries[0]), 'unexplained', 'A changed check policy cannot reuse acceptance.');
  assert.equal(navigations, 4, 'Adding a check does not capture again.');
  assert.deepEqual(await readFile(a.manifestPath), beforeManifest); assert.deepEqual(await readFile(b.manifestPath), afterManifest);
  viewer = await serve({ reportPath: result.reportPath, port: 0 });
  const response = await fetch(viewer.origin + '/' + home.viewports[0].artifacts.content.diff.src);
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal((await response.json()).schemaVersion, 1);
  await writeFile(contentPath, gzipSync(Buffer.alloc(2 * 1024 * 1024 + 1, 32)));
  const oversized = await compareRuns({ runsRoot: join(directory, 'runs'), runA: a.run.id, runB: b.run.id, outputDir: join(directory, 'oversized') });
  assert.equal(oversized.report.entries[0].viewports[0].artifacts.content.state, 'failed', 'Compressed snapshots cannot bypass the expanded size limit.');
  console.log('Content capture, stored checks, bounded query, local sidecars, and capture-free rerun pass.');
} finally {
  await viewer?.close(); site.closeAllConnections(); await new Promise(resolve => site.close(resolve)); await rm(directory, { recursive: true, force: true });
}
