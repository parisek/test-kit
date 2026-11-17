import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sizeMismatch, sizeMismatches } from '../../src/report/size.js';
import { summarizeReport } from '../../src/query/summary.js';

const size = (aw, ah, bw, bh) => ({ a: { width: aw, height: ah }, b: { width: bw, height: bh } });

test('the size signal names the axis and the largest change (R8.18, #390)', () => {
  // The case of #390: one side is a third shorter.
  assert.deepEqual(sizeMismatch(size(1600, 3627, 1600, 2437)), { axis: 'height', a: { width: 1600, height: 3627 }, b: { width: 1600, height: 2437 }, percent: 32.8 });
  assert.equal(sizeMismatch(size(800, 600, 400, 600)).axis, 'width');
  assert.equal(sizeMismatch(size(800, 600, 400, 600)).percent, 50);
  const both = sizeMismatch(size(800, 600, 790, 300));
  assert.equal(both.axis, 'both');
  assert.equal(both.percent, 50, 'the larger change of the two axes');
  assert.equal(sizeMismatch(size(10, 10, 10, 10)), null);
  // Report data is untrusted: an invalid size gives no signal.
  for (const bad of [null, {}, size(0, 10, 10, 10), size(1.5, 10, 10, 10), size(-1, 10, 10, 10), size('10', 10, 10, 10), size(100_001, 10, 10, 10)]) assert.equal(sizeMismatch(bad), null, JSON.stringify(bad));
});

test('the report lists the cells whose screenshots differ in size', () => {
  const row = (id, value) => ({ id, artifacts: { screenshot: { diff: { size: value } } } });
  const report = { entries: [
    { id: 'home', viewports: [row('desktop', size(1600, 3627, 1600, 2437)), row('mobile', size(400, 900, 400, 900))] },
    { id: 'card', viewports: [row('desktop', size(10, 10, 12, 10)), { id: 'mobile', artifacts: {} }] },
  ] };
  assert.deepEqual(sizeMismatches(report), [{ id: 'home', viewport: 'desktop', axis: 'height', percent: 32.8 }, { id: 'card', viewport: 'desktop', axis: 'width', percent: 16.7 }]);
  assert.deepEqual(sizeMismatches(report, 'card').map(item => item.id), ['card']);
  assert.deepEqual(sizeMismatches({}), []);
});

// compareRuns loads pngjs and pixelmatch. The plain unit job installs no dependency, so it skips this test.
const tools = await Promise.all([import('pngjs'), import('pixelmatch'), import('../../src/compare/runs.js'), import('../../src/config/index.js'), import('../../src/config/settings.js')]).catch(() => null);
test('compareRuns and summary surface a size change that the ratio hides (R8.18, #390)', { skip: !tools && 'pngjs or pixelmatch is not installed' }, async () => {
  const [{ PNG }, , { compareRuns }, { normalizeConfig, settingsHash }, { screenshotScope, settleRecipe }] = tools;
  const dir = await mkdtemp(join(tmpdir(), 'test-kit-size-'));
  try {
    const config = normalizeConfig({ schemaVersion: 1, sides: { local: { origin: 'http://localhost:8080' } },
      targets: [{ id: 'cards', kind: 'page', path: '/' }, { id: 'same', kind: 'page', path: '/same' }],
      viewports: [{ id: 'desktop', width: 40, height: 30 }], runsRoot: 'runs' });
    // White cards on a white page: the padded area of the shorter image matches.
    const png = (width, height) => { const image = new PNG({ width, height }); image.data.fill(255); return PNG.sync.write(image); };
    const fake = async (id, cardsHeight) => {
      const runDir = join(dir, 'runs', id);
      const captures = [];
      for (const [target, height] of [['cards', cardsHeight], ['same', 30]]) {
        const path = `screenshots/${target}/desktop.png`;
        await mkdir(join(runDir, 'screenshots', target), { recursive: true });
        await writeFile(join(runDir, path), png(40, height));
        const row = config.targets.find(item => item.id === target);
        captures.push({ targetId: target, viewportId: 'desktop', settleHash: settingsHash(settleRecipe(config, 'local', row)), scopeHash: settingsHash(screenshotScope(row, 'local')), state: 'captured', path, statusCode: 200, finalPath: '/', width: 40, height, deviceScaleFactor: 1, artifacts: {} });
      }
      await writeFile(join(runDir, 'run.json'), JSON.stringify({ schemaVersion: 2, id, side: 'local', label: id, at: '2026-11-17T10:00:00.000Z', state: 'complete', settings: config, settingsHash: 'sha256:abc',
        captureSettings: {}, tools: [{ name: 'playwright', version: '1.0.0', settingsHash: 'sha256:abc' }], captures }));
    };
    await fake('2026-11-17T10-00-00-000Z-1-aaaaaa1', 90);
    await fake('2026-11-17T10-00-00-000Z-1-bbbbbb1', 60);
    const { report, reportPath } = await compareRuns({ runsRoot: join(dir, 'runs'), runA: '2026-11-17T10-00-00-000Z-1-aaaaaa1', runB: '2026-11-17T10-00-00-000Z-1-bbbbbb1', outputDir: join(dir, 'report') });
    const cell = report.entries.find(entry => entry.id === 'cards').viewports[0];
    assert.equal(cell.ratio, 0, 'the ratio stays as it is: the padding matches');
    assert.deepEqual(cell.artifacts.screenshot.diff.sizeMismatch, { axis: 'height', a: { width: 40, height: 90 }, b: { width: 40, height: 60 }, percent: 33.3 });
    assert.equal(Object.hasOwn(report.entries.find(entry => entry.id === 'same').viewports[0].artifacts.screenshot.diff, 'sizeMismatch'), false);
    assert.ok(report.findings.some(finding => finding.targetId === 'cards' && finding.message === 'Screenshot dimensions differ.'), 'the finding and its message stay');
    const stored = JSON.parse(await readFile(reportPath, 'utf8'));
    const summary = summarizeReport(stored);
    assert.deepEqual(summary.sizeMismatches, [{ id: 'cards', viewport: 'desktop', axis: 'height', percent: 33.3 }]);
    assert.equal(summary.sizeMismatchesOmitted, 0);
    // A reader derives the signal from `diff.size` and never copies a stored value.
    stored.entries.find(entry => entry.id === 'same').viewports[0].artifacts.screenshot.diff.sizeMismatch = { axis: 'width', percent: 99 };
    assert.deepEqual(summarizeReport(stored).sizeMismatches.map(item => item.id), ['cards']);
    // Without a size change the key is absent, so the pinned output stays the same.
    stored.entries.find(entry => entry.id === 'cards').viewports[0].artifacts.screenshot.diff.size.b.height = 90;
    assert.equal(Object.hasOwn(summarizeReport(stored), 'sizeMismatches'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
