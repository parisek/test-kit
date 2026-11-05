// Explicit local check (R6.13, #278). A browser runs. A difference in final status, final path
// or redirect chain is a finding, a known difference explains it, and an equal pair has no finding.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture } from '../../src/capture/index.js';
import { compareRuns } from '../../src/compare/runs.js';
import { loadConfig } from '../../src/config/index.js';
import { summarizeReport } from '../../src/query/summary.js';

const directory = await mkdtemp(join(tmpdir(), 'test-kit-status-'));
// Side A serves /page. Side B redirects /page to /page/ (301) and serves /page/.
let mode = 'plain';
const page = '<!doctype html><html><body><h1>Same visible page</h1></body></html>';
const site = createServer((request, response) => {
  if (mode === 'redirect' && request.url === '/page') { response.writeHead(301, { Location: '/page/' }); response.end(); return; }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(page);
});
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + site.address().port;
const cli = fileURLToPath(new URL('../../bin/cli.js', import.meta.url));
try {
  const configPath = join(directory, 'config.json'), runsRoot = join(directory, 'runs');
  const config = { schemaVersion: 1, sides: { local: { origin } }, targets: [{ id: 'home', kind: 'page', path: '/page' }],
    viewports: [{ id: 'wide', width: 640, height: 480 }], artifacts: ['screenshot', 'status'], runsRoot: 'runs' };
  await writeFile(configPath, JSON.stringify(config));
  const compare = (name, runA, runB, policy = {}) => compareRuns({ runsRoot, runA: runA.run.id, runB: runB.run.id, outputDir: join(directory, name), known_diffs: policy.known_diffs });
  const plainA = await capture({ configPath, side: 'local' });
  const plainB = await capture({ configPath, side: 'local' });
  mode = 'redirect';
  // The requested path is the same on both runs. The second run ends on /page/ after one redirect.
  const redirected = await capture({ configPath, side: 'local' });

  // 1. Equal status, path and chain: no finding, the class stays match.
  const equal = await compare('equal', plainA, plainB);
  assert.deepEqual(equal.report.findings, []);
  assert.equal(summarizeReport(equal.report).counts.match, 1);
  assert.equal(equal.report.entries[0].viewports[0].artifacts.status.diff.changed, false);
  // The report shape does not change: the status index keeps the same keys, and no finding exists.
  assert.deepEqual(Object.keys(equal.report.entries[0].viewports[0].artifacts.status.diff), ['kind', 'src', 'tool', 'version', 'settingsHash', 'changed']);

  // 2. A redirect on side B: both sides end with status 200, the path and the chain differ.
  const body = JSON.parse(await readFile(join(redirected.runDir, redirected.run.captures[0].artifacts.status.path)));
  assert.equal(body.statusCode, 200); assert.equal(body.finalPath, '/page/'); assert.deepEqual(body.redirects, ['/page']);
  const diff = await compare('redirect', plainA, redirected);
  assert.equal(diff.report.findings.length, 1);
  const [finding] = diff.report.findings;
  assert.equal(finding.artifact, 'status');
  assert.equal(finding.checkId, undefined);
  assert.match(finding.message, /final path A \/page, B \/page\//);
  assert.match(finding.message, /redirects A 0, B 1/);
  assert.doesNotMatch(finding.message, /status A/, 'The status code is equal.');
  const counts = summarizeReport(diff.report).counts;
  assert.equal(counts.unexplained, 1); assert.equal(counts.match, 0);
  const row = diff.report.entries[0].viewports[0];
  assert.equal(row.artifacts.status.diff.changed, true);

  // 3. record-known --artifact status records the intended redirect, and the next diff reads it as explained.
  const before = await readFile(diff.reportPath);
  const run = await promisify(execFile)(process.execPath, [cli, 'record-known', diff.reportPath, '--config', configPath, '--target', 'home', '--viewport', 'wide',
    '--artifact', 'status', '--cause', 'trailing-slash', '--reason', 'The new site ends every path with a slash']);
  assert.match(JSON.parse(run.stdout).fingerprint, /^sha256:/);
  assert.equal((await readFile(diff.reportPath)).equals(before), true, 'record-known does not rewrite the report.');
  const known = await compare('known', plainA, redirected, (await loadConfig(configPath)).config);
  assert.equal(known.report.findings.length, 1);
  assert.equal(known.report.findings[0].causeId, 'trailing-slash');
  const knownCounts = summarizeReport(known.report).counts;
  assert.equal(knownCounts.explained, 1); assert.equal(knownCounts.unexplained, 0);
  // The record binds this pair. The reversed pair is a new difference.
  const reversed = await compare('reversed', redirected, plainA, (await loadConfig(configPath)).config);
  assert.equal(summarizeReport(reversed.report).counts.unexplained, 1);
  console.log('Status difference finding, summary count, and record-known checks pass.');
} finally {
  site.close();
  await rm(directory, { recursive: true, force: true });
}
