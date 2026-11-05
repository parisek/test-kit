// `capture --packs` runs the a11y pack on the open page and the result reaches report.json v3 (R13.51).
// It skips when Playwright, Chromium or axe-core is missing.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const skip = reason => { console.log(`check-capture-packs skipped: ${reason}`); process.exit(0); };
const require = createRequire(import.meta.url);
try { require.resolve('axe-core/axe.min.js'); } catch { skip('axe-core is not installed.'); }
let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { skip('@playwright/test is not installed.'); }
try { await (await chromium.launch()).close(); } catch { skip('no Chromium browser is installed.'); }

const { capture } = await import('../../src/capture/index.js');
const { compareRuns } = await import('../../src/compare/runs.js');
const { queryArtifact } = await import('../../src/query/artifact.js');
const { summarizeReport } = await import('../../src/query/summary.js');

const html = await readFile(fileURLToPath(new URL('../fixtures/a11y/page.html', import.meta.url)), 'utf8');
const requests = [];
const site = createServer((request, response) => {
  requests.push(`${request.method} ${request.url}`);
  response.setHeader('Content-Type', 'text/html');
  response.end(html);
});
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${site.address().port}`;
const directory = await mkdtemp(join(tmpdir(), 'test-kit-capture-packs-'));
try {
  const configPath = join(directory, 'config.json');
  const config = { schemaVersion: 1, sides: { local: { origin } }, targets: [{ id: 'home', kind: 'page', path: '/' }],
    viewports: [{ id: 'wide', width: 500, height: 300 }], artifacts: ['screenshot'], runsRoot: 'runs', packs: ['a11y'] };
  await writeFile(configPath, JSON.stringify(config));

  // Without the flag nothing runs, although the config selects the pack (R5.1).
  const plain = await capture({ configPath, side: 'local' });
  assert.equal(plain.run.state, 'complete');
  assert.equal(plain.run.packs, undefined);
  assert.equal(plain.run.captures[0].artifacts.a11y, undefined);

  // With the flag the pack runs on the page capture has open. One navigation, no extra request.
  requests.length = 0;
  const withPacks = await capture({ configPath, side: 'local', packs: true });
  assert.equal(withPacks.run.state, 'complete');
  assert.equal(requests.length, 1, 'the pack adds no request');
  assert.deepEqual(withPacks.run.packs, { selected: ['a11y'], skipped: [] });
  const index = withPacks.run.captures[0].artifacts.a11y;
  assert.equal(index.state, 'captured');
  assert.equal(index.tool, 'axe-core');
  assert.equal(index.path, 'a11y/home/wide.json');
  // The selection is not a capture setting (R13.44): both runs share the settings hash and stay comparable.
  assert.equal(plain.run.settingsHash, withPacks.run.settingsHash);

  // The pack step cannot change the screenshot: the bytes are identical with and without --packs (R13.51).
  const shot = run => readFile(join(directory, 'runs', run.id, run.captures[0].path));
  assert.ok((await shot(plain.run)).equals(await shot(withPacks.run)), 'screenshot bytes are identical with and without --packs');

  const out = join(directory, 'report');
  const { report } = await compareRuns({ runsRoot: join(directory, 'runs'), runA: plain.run.id, runB: withPacks.run.id, outputDir: out });
  assert.equal(report.schemaVersion, 3);
  const row = report.entries[0].viewports[0];
  assert.equal(row.state, 'complete');
  assert.equal(row.artifacts.a11y.state, 'complete');
  assert.deepEqual(row.artifacts.a11y.scope, { checks: ['a11y-axe'] });
  assert.equal(row.artifacts.a11y.result.violations, true);
  assert.equal(row.artifacts.a11y.a, undefined);
  assert.deepEqual(report.checks['a11y-axe'], { basis: 'absolute', layer: 'package', title: 'Accessibility (axe)' });
  const ids = new Set(report.findings.filter(item => item.artifact === 'a11y').map(item => item.evidence.ruleId));
  assert.ok(ids.has('image-alt') && ids.has('link-name'));
  assert.ok(report.findings.filter(item => item.artifact === 'a11y').every(item => item.runId === withPacks.run.id && item.checkId === 'a11y-axe'));
  const queried = await queryArtifact(join(out, 'report.json'), { target: 'home', viewport: 'wide', artifact: 'a11y' });
  assert.equal(queried.evidence.run, `runs/${withPacks.run.id}/a11y/home/wide.json`);
  const summary = summarizeReport(JSON.parse(await readFile(join(out, 'report.json'), 'utf8')), { maxTargets: 5, filter: 'all' });
  assert.deepEqual(summary.unexplainedTargets, ['home'], 'summary counts the axe violations as unexplained');

  // A run without packs adds nothing to the report (R5.1).
  const same = await compareRuns({ runsRoot: join(directory, 'runs'), runA: withPacks.run.id, runB: plain.run.id, outputDir: join(directory, 'report-plain') });
  assert.equal(same.report.entries[0].viewports[0].artifacts.a11y, undefined);
  assert.equal(same.report.checks['a11y-axe'], undefined);
  console.log('check-capture-packs passed');
} finally {
  site.close();
  await rm(directory, { recursive: true, force: true });
}
