// Explicit browser integration check. npm test does not discover this file.
// R8.15 and R8.16: import supplied images as a design side, then diff against a captured run of the
// synthetic example site. It covers a matching image, a changed component, a missing viewport and a wrong size.
// The images are the captured pages themselves (so one matches exactly), changed or resized with pngjs.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { startExampleSite } from './example-site-server.mjs';
import { capture } from '../../src/capture/index.js';
import { importDesign } from '../../src/design/import.js';
import { compareRuns } from '../../src/compare/runs.js';
import { summarizeReport } from '../../src/query/summary.js';
import { run as cli } from '../../src/cli/run.js';

const directory = await mkdtemp(join(tmpdir(), 'test-kit-design-'));
let site;
try {
  site = await startExampleSite();
  const configPath = join(directory, 'config.json');
  const config = {
    schemaVersion: 1,
    sides: { site: { origin: site.origin }, design: { kind: 'design', provider: 'files', root: 'design-refs' } },
    targets: [
      { id: 'steady', kind: 'page', path: '/unchanged', design: { desktop: 'steady/desktop.png', mobile: 'steady/mobile.png' } },
      { id: 'moved', kind: 'page', path: '/changed', design: { desktop: 'moved/desktop.png' } },
    ],
    viewports: [{ id: 'mobile', width: 390, height: 700 }, { id: 'desktop', width: 800, height: 600 }],
    runsRoot: 'runs',
  };
  await writeFile(configPath, JSON.stringify(config));
  const captured = await capture({ configPath, side: 'site', label: 'browser' });
  assert.equal(captured.run.state, 'complete');
  const shot = async (target, viewport) => PNG.sync.read(await readFile(join(captured.runDir, `screenshots/${target}/${viewport}.png`)));
  const put = async (path, bytes) => { await mkdir(join(directory, 'design-refs', path, '..'), { recursive: true }); await writeFile(join(directory, 'design-refs', path), bytes); };

  // steady/desktop: the exact page. steady/mobile: the page with a red block. moved/desktop: 10 px too wide. moved/mobile: not mapped.
  await put('steady/desktop.png', await readFile(join(captured.runDir, 'screenshots/steady/desktop.png')));
  const changed = await shot('steady', 'mobile');
  for (let y = 10; y < 60; y++) for (let x = 10; x < 60; x++) { const i = (y * changed.width + x) * 4; changed.data[i] = 255; changed.data[i + 1] = 0; changed.data[i + 2] = 0; }
  await put('steady/mobile.png', PNG.sync.write(changed));
  const base = await shot('moved', 'desktop');
  const wide = new PNG({ width: base.width + 10, height: base.height });
  wide.data.fill(255);
  PNG.bitblt(base, wide, 0, 0, base.width, base.height, 0, 0);
  await put('moved/desktop.png', PNG.sync.write(wide));

  // The command prints one line of JSON and opens no browser.
  const lines = [];
  const code = await cli(['import', '--config', configPath, '--side', 'design', '--label', 'refs'], { out: { write: chunk => lines.push(chunk) }, err: { write: () => {} } });
  assert.equal(code, 0);
  const imported = JSON.parse(lines.join(''));
  assert.equal(imported.state, 'complete');
  assert.equal(imported.images, 3);
  const design = JSON.parse(await readFile(imported.manifestPath, 'utf8'));
  const first = design.captures.find(row => row.targetId === 'steady' && row.viewportId === 'desktop');
  assert.equal(first.design.provider, 'files');
  assert.equal(first.design.source, 'steady/desktop.png');
  assert.match(first.design.sha256, /^[0-9a-f]{64}$/);
  assert.equal(first.design.width, 800);
  assert.ok(Date.parse(first.design.importedAt));

  const runsRoot = join(directory, 'runs');
  const { report, reportPath } = await compareRuns({ runsRoot, runA: imported.id, runB: captured.run.id, outputDir: join(directory, 'report') });
  assert.equal(report.pair.kind, 'convergence');
  const cell = (target, viewport) => report.entries.find(entry => entry.id === target).viewports.find(row => row.id === viewport);
  assert.equal(cell('steady', 'desktop').state, 'complete');
  assert.equal(cell('steady', 'desktop').ratio, 0, 'A matching image has ratio 0.');
  assert.equal(report.findings.some(finding => finding.targetId === 'steady' && finding.viewportId === 'desktop'), false);
  assert.equal(cell('steady', 'mobile').state, 'complete');
  assert.ok(cell('steady', 'mobile').ratio > 0, 'A changed component has a ratio.');
  assert.ok(cell('steady', 'mobile').artifacts.screenshot.diff.regions.length > 0, 'The changed block shows as a region.');
  assert.ok(report.findings.some(finding => finding.targetId === 'steady' && finding.viewportId === 'mobile'));
  assert.equal(cell('moved', 'mobile').state, 'missing', 'A viewport with no mapped image is missing.');
  assert.equal(cell('moved', 'desktop').state, 'incompatible');
  assert.match(cell('moved', 'desktop').diagnostic, /810 px wide.*needs 800 px/);
  const summary = summarizeReport(JSON.parse(await readFile(reportPath, 'utf8')), { maxTargets: 20, filter: 'all' });
  assert.equal(summary.verdict, 'incomplete');
  assert.equal(summary.counts.match, 0);

  // A wrong path stops the import before a run exists.
  const bad = { ...config, targets: [{ id: 'steady', kind: 'page', path: '/unchanged', design: { desktop: 'steady/desktop.png' } }] };
  await writeFile(configPath, JSON.stringify(bad));
  assert.equal((await importDesign({ configPath, side: 'design' })).run.captures.length, 1);
  await writeFile(configPath, JSON.stringify({ ...bad, targets: [{ ...bad.targets[0], design: { desktop: '../config.png' } }] }));
  await assert.rejects(importDesign({ configPath, side: 'design' }), /plain relative path/);
  // capture refuses a design side.
  await writeFile(configPath, JSON.stringify(config));
  await assert.rejects(capture({ configPath, side: 'design' }), /design side/);
  console.log('design files check passed');
} finally {
  await site?.close();
  await rm(directory, { recursive: true, force: true });
}
