// Explicit browser integration check. npm test does not discover this file.
// R4.5: a selected capture keeps the full lists, the same hashes, and records its selection.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startExampleSite } from './example-site-server.mjs';
import { capture } from '../../src/capture/index.js';
import { compareRuns } from '../../src/compare/runs.js';
import { summarizeReport } from '../../src/query/summary.js';

const directory = await mkdtemp(join(tmpdir(), 'test-kit-selection-'));
let site;
try {
  site = await startExampleSite();
  const configPath = join(directory, 'config.json');
  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    sides: { a: { origin: site.origin }, b: { origin: site.origin } },
    targets: ['unchanged', 'changed', 'motion'].map((path, index) => ({ id: `target-${index}`, kind: 'page', title: path, path: `/${path}` })),
    viewports: [{ id: 'mobile', width: 390, height: 700 }, { id: 'desktop', width: 800, height: 600 }],
    artifacts: ['screenshot', 'html', 'status', 'content'], checks: ['text-difference'], runsRoot: 'runs',
  }));
  const runsRoot = join(directory, 'runs');
  const full = await capture({ configPath, side: 'a' });
  const selected = await capture({ configPath, side: 'b', targets: ['target-1'], viewports: ['desktop'] });
  assert.equal(full.run.selection, undefined, 'a full run records no selection');
  assert.deepEqual(selected.run.selection, { targets: ['target-1'], viewports: ['desktop'] });
  assert.deepEqual(selected.run.captures.map(row => [row.targetId, row.viewportId, row.state]), [['target-1', 'desktop', 'captured']]);
  assert.equal(selected.run.state, 'complete');
  // The full lists stay in the settings, so every settings hash equals the hash of a full run.
  assert.deepEqual(selected.run.settings.targets, full.run.settings.targets);
  assert.deepEqual(selected.run.settings.viewports, full.run.settings.viewports);
  assert.equal(selected.run.settingsHash, full.run.settingsHash, 'screenshot settings hash');
  const toolHashes = run => run.tools.map(tool => [tool.name, tool.artifact ?? null, tool.settingsHash]);
  assert.deepEqual(toolHashes(selected.run), toolHashes(full.run), 'tool hashes for screenshot, response and content artifacts');
  const row = full.run.captures.find(item => item.targetId === 'target-1' && item.viewportId === 'desktop');
  const pick = run => run.captures[0].artifacts;
  for (const kind of ['html', 'status', 'content']) assert.equal(pick(selected.run)[kind].settingsHash, row.artifacts[kind].settingsHash, `${kind} artifact settings hash`);
  assert.equal(JSON.parse(await readFile(selected.manifestPath, 'utf8')).selection.targets[0], 'target-1');

  const pair = await compareRuns({ runsRoot, runA: full.run.id, runB: selected.run.id, outputDir: join(directory, 'pair') });
  assert.deepEqual(pair.report.entries.map(entry => [entry.id, entry.viewports.map(item => item.id)]), [['target-1', ['desktop']]]);
  assert.equal(pair.report.meta.skipped, 5);
  assert.equal(pair.report.entries[0].viewports[0].state, 'complete');
  assert.equal(summarizeReport(pair.report).counts.unexplained, 0);

  // A filter on a full pair keeps the same rows and records itself.
  const again = await capture({ configPath, side: 'b' });
  const filtered = await compareRuns({ runsRoot, runA: full.run.id, runB: again.run.id, outputDir: join(directory, 'filtered'), filter: { targets: ['target-1'], viewports: ['desktop'] } });
  assert.equal(filtered.report.meta.skipped, 5);
  assert.deepEqual(filtered.report.meta.scope.filter, { targets: ['target-1'], viewports: ['desktop'] });

  // An unknown id fails before a run directory exists.
  await assert.rejects(capture({ configPath, side: 'a', targets: ['nope'] }), /Unknown target/);
  await assert.rejects(capture({ configPath, side: 'a', viewports: ['nope'] }), /Unknown viewport/);
  console.log(JSON.stringify({ selected: selected.run.selection, skipped: pair.report.meta.skipped }));
} finally {
  if (site) await site.close();
  await rm(directory, { recursive: true, force: true });
}
