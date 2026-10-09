import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
// Explicit local policy and recording check (R5.3, R8.2–R8.6).
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';
import { startExampleSite } from './example-site-server.mjs';
import { capture } from '../../src/capture/index.js';
import { compareRuns } from '../../src/compare/runs.js';
import { recordKnown, commitConfig } from '../../src/rules/record.js';
import { pairKey } from '../../src/rules/evidence.js';
import { loadConfig } from '../../src/config/index.js';
import { summarizeReport } from '../../src/query/summary.js';
import { queryArtifact } from '../../src/query/artifact.js';
import { serve } from '../../src/server/serve.js';
const directory = await mkdtemp(join(tmpdir(), 'test-kit-rules-'));
const sites = [];
let viewer, browser;
try {
  sites.push(await startExampleSite(), await startExampleSite({ variant: 'changed' }));
  const configPath = join(directory, 'config.json'), runsRoot = join(directory, 'runs');
  const config = { schemaVersion: 1, sides: { a: { origin: sites[0].origin }, b: { origin: sites[1].origin } },
    targets: [{ id: 'home', kind: 'page', path: '/changed' }], viewports: [{ id: 'wide', width: 640, height: 480 }],
    artifacts: ['html'], runsRoot: 'runs' };
  await writeFile(configPath, JSON.stringify(config));
  const a = await capture({ configPath, side: 'a' }), b = await capture({ configPath, side: 'b' });
  const compare = (name, policy = {}, pair = [a.run.id, b.run.id], kind = 'migration') =>
    compareRuns({ runsRoot, runA: pair[0], runB: pair[1], outputDir: join(directory, name), kind, rules: policy.rules, known_diffs: policy.known_diffs });
  const raw = await compare('raw');
  assert.equal(summarizeReport(raw.report).counts.unexplained, 1);
  const before = await readFile(join(a.runDir, a.run.captures[0].artifacts.html.path));
  const after = await readFile(join(b.runDir, b.run.captures[0].artifacts.html.path));
  // An explicit full literal response is bounded and audited. No wildcard operation exists.
  const key = pairKey(a.run.id, b.run.id);
  config.rules = { response: { text: 'Observed example response pair', evidence: 'Synthetic baseline and changed response bodies',
    applies: { pairs: [key], kinds: ['migration'], targets: ['home'], artifacts: ['html'] },
    operation: { kind: 'literal-pair', a: before.toString().replaceAll('\n', ''), b: after.toString().replaceAll('\n', ''), maxOccurrences: 1 } } };
  // Use observed single-line fragments. Preserve all other bytes.
  config.rules.response.operation.a = before.toString().split('\n').find(line => line.startsWith('<body'));
  config.rules.response.operation.b = after.toString().split('\n').find(line => line.startsWith('<body'));
  await writeFile(configPath, JSON.stringify(config));
  const policy = (await loadConfig(configPath)).config;
  const normalized = await compare('normalized', policy);
  assert.equal(normalized.report.findings.length, 1, 'Raw finding is retained.');
  assert.equal(summarizeReport(normalized.report).counts.explained, 1);
  assert.equal(summarizeReport(normalized.report).counts.match, 0);
  const row = normalized.report.entries[0].viewports[0];
  assert.equal(row.artifacts.html.diff.rawChanged, true);
  assert.equal(row.artifacts.html.diff.changed, false);
  assert.deepEqual(row.artifacts.html.diff.firedRuleIds, ['response']);
  const query = await queryArtifact(normalized.reportPath, { target: 'home', viewport: 'wide', artifact: 'html', maxLines: 1 });
  assert.equal(query.diff.normalization.fired.length, 1);
  assert.equal(query.diff.rawWindow.displayedLines, 1);
  assert.ok(query.diff.rawWindow.omittedLines > 0);
  assert.equal((await readFile(join(a.runDir, a.run.captures[0].artifacts.html.path))).equals(before), true);
  await writeFile(join(b.runDir, b.run.captures[0].artifacts.html.path), Buffer.concat([after, Buffer.from('<!-- residual change -->')]));
  const residual = await compare('residual', policy);
  assert.equal(summarizeReport(residual.report).counts.unexplained, 1);
  await writeFile(join(b.runDir, b.run.captures[0].artifacts.html.path), after);
  // A UTF-8 BOM is response content. A token rule cannot explain it.
  const rawAFile = join(a.runDir, a.run.captures[0].artifacts.html.path);
  await writeFile(rawAFile, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), before]));
  const bom = await compare('bom-residual', policy);
  assert.equal(bom.report.entries[0].viewports[0].artifacts.html.diff.changed, true);
  assert.equal(summarizeReport(bom.report).counts.unexplained, 1);
  assert.equal(summarizeReport(bom.report).counts.explained, 0);
  const bomQuery = await queryArtifact(bom.reportPath, { target: 'home', viewport: 'wide', artifact: 'html' });
  assert.ok(bomQuery.diff.lines.some(line => line.text.startsWith('\ufeff')));
  await writeFile(rawAFile, before);
  const outside = await compare('outside', policy, undefined, 'update');
  assert.equal(summarizeReport(outside.report).counts.unexplained, 1);
  const reversed = await compare('reversed', policy, [b.run.id, a.run.id]);
  assert.equal(summarizeReport(reversed.report).counts.unexplained, 1);
  // Record exact evidence under an empty normalization policy.
  config.rules = {};
  await writeFile(configPath, JSON.stringify(config));
  const unnormalized = await compare('record-source');
  const originalReport = await readFile(unnormalized.reportPath);
  const cli = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../../bin/cli.js', import.meta.url)), 'record-known', unnormalized.reportPath, '--config', configPath, '--target', 'home', '--viewport', 'wide', '--artifact', 'html', '--cause', 'expected', '--reason', 'Observed synthetic HTML change']);
  assert.equal(JSON.parse(cli.stdout).pairKey, key);
  assert.equal((await readFile(unnormalized.reportPath)).equals(originalReport), true);
  const known = await compare('known', (await loadConfig(configPath)).config);
  assert.equal(summarizeReport(known.report).counts.explained, 1);
  assert.equal(known.report.findings.length, 1);
  const knownReverse = await compare('known-reverse', (await loadConfig(configPath)).config, [b.run.id, a.run.id]);
  assert.equal(summarizeReport(knownReverse.report).counts.unexplained, 1);
  const currentConfig = await readFile(configPath);
  await assert.rejects(commitConfig(configPath, Buffer.from('stale original'), config), /changed/);
  assert.equal((await readFile(configPath)).equals(currentConfig), true);
  const mutatedReport = JSON.parse(originalReport);
  mutatedReport.findings[0].evidenceFingerprint = 'sha256:' + '0'.repeat(64);
  const mutatedPath = join(directory, 'record-source', 'mutated.json');
  await writeFile(mutatedPath, JSON.stringify(mutatedReport));
  await assert.rejects(recordKnown({ reportPath: mutatedPath, configPath, target: 'home', viewport: 'wide', artifact: 'html', cause: 'mutated', reason: 'Changed report' }), /changed|belong/);
  for (const field of ['tool', 'version', 'settingsHash']) {
    const mutated = JSON.parse(originalReport);
    mutated.entries[0].viewports[0].artifacts.html.diff[field] = 'tampered';
    await writeFile(mutatedPath, JSON.stringify(mutated));
    const unchanged = await readFile(configPath);
    await assert.rejects(recordKnown({ reportPath: mutatedPath, configPath, target: 'home', viewport: 'wide', artifact: 'html', cause: 'provenance', reason: 'Changed comparator' }), /provenance/);
    assert.ok((await readFile(configPath)).equals(unchanged));
  }
  const repeat = await capture({ configPath, side: 'b' });
  const newPair = await compare('new-pair', (await loadConfig(configPath)).config, [a.run.id, repeat.run.id]);
  assert.equal(summarizeReport(newPair.report).counts.unexplained, 1);
  // Same run IDs with altered raw bytes cannot reuse acceptance.
  const rawFile = join(b.runDir, b.run.captures[0].artifacts.html.path);
  await writeFile(rawFile, Buffer.concat([after, Buffer.from('<!-- new difference -->')]));
  const altered = await compare('altered', (await loadConfig(configPath)).config);
  assert.equal(summarizeReport(altered.report).counts.unexplained, 1);
  await assert.rejects(recordKnown({ reportPath: unnormalized.reportPath, configPath, target: 'home', viewport: 'wide', artifact: 'html', cause: 'changed', reason: 'Changed evidence' }), /changed|belong/);
  await writeFile(rawFile, after);
  // Policy changes cannot reuse acceptance or overwrite configuration on failure.
  const acceptedConfig = JSON.parse(await readFile(configPath));
  acceptedConfig.rules = policy.rules;
  await writeFile(configPath, JSON.stringify(acceptedConfig));
  const changedPolicyBytes = await readFile(configPath);
  await assert.rejects(recordKnown({ reportPath: unnormalized.reportPath, configPath, target: 'home', viewport: 'wide', artifact: 'html', cause: 'policy', reason: 'Changed policy' }), /policy|changed/);
  assert.ok((await readFile(configPath)).equals(changedPolicyBytes));
  acceptedConfig.rules = {}; acceptedConfig.artifacts = ['screenshot', 'html'];
  await writeFile(configPath, JSON.stringify(acceptedConfig));
  const mixedA = await capture({ configPath, side: 'a' }), mixedB = await capture({ configPath, side: 'b' });
  const mixedPair = [mixedA.run.id, mixedB.run.id];
  const mixedSource = await compare('mixed-source', {}, mixedPair);
  assert.deepEqual(new Set(mixedSource.report.findings.map(finding => finding.artifact)), new Set(['html', 'screenshot']));
  for (const artifact of ['html', 'screenshot']) await recordKnown({ reportPath: mixedSource.reportPath, configPath, target: 'home', viewport: 'wide', artifact, cause: 'expected-' + artifact, reason: 'Observed synthetic ' + artifact + ' difference' });
  const mixedKnown = await compare('mixed-known', (await loadConfig(configPath)).config, mixedPair);
  assert.equal(summarizeReport(mixedKnown.report).counts.explained, 1);
  assert.equal(new Set(mixedKnown.report.findings.map(finding => finding.causeId)).size, 2);
  viewer = await serve({ reportPath: normalized.reportPath });
  const response = await fetch(viewer.origin + '/' + row.artifacts.html.normalizedA.src);
  assert.match(response.headers.get('content-type'), /^text\/plain/);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(viewer.origin);
  await page.locator('#notice').filter({ hasText: 'Loaded' }).waitFor();
  await page.getByRole('button', { name: 'home · wide evidence' }).click();
  await page.getByText('Fired: response', { exact: false }).waitFor();
  const html = page.getByRole('region', { name: 'HTML line comparison' });
  await html.waitFor();
  assert.match(await html.textContent(), /Raw response changes are explained/);
  await html.getByRole('button', { name: 'Raw response', exact: true }).click();
  assert.equal(await html.getByRole('button', { name: 'Raw response', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.ok(await html.locator('code').count() > 0);
  await html.getByRole('button', { name: 'Normalized', exact: true }).click();
  assert.match(await html.textContent(), /No changed lines in this comparison/);
  assert.deepEqual(errors, []);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  console.log('Scoped normalization, exact recorded evidence, raw audit, bounded query, and safe viewer pass.');
} finally {
  if (browser) await browser.close();
  if (viewer) await viewer.close();
  await Promise.all(sites.map(site => site.close()));
  await rm(directory, { recursive: true, force: true });
}
