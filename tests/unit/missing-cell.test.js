import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { missingCellDiagnostic } from '../../src/compare/missing.js';

const A = { id: '2026-11-17T10-00-00-000Z-1-aaaaaa1' };
const B = { id: '2026-11-17T10-00-00-000Z-1-bbbbbb1' };

test('R8.19: the diagnostic names the run that lacks the cell', () => {
  assert.equal(missingCellDiagnostic({ targetId: 'news', viewportId: 'desktop', ac: undefined, bc: {}, a: A, b: B }), `Target news at desktop is not in run A (${A.id}). Capture that side again.`);
  assert.equal(missingCellDiagnostic({ targetId: 'news', viewportId: 'desktop', ac: {}, bc: undefined, a: A, b: B }), `Target news at desktop is not in run B (${B.id}). Capture that side again.`);
  assert.equal(missingCellDiagnostic({ targetId: 'news', viewportId: 'desktop', a: A, b: B }), `Target news at desktop is in neither run A (${A.id}) nor run B (${B.id}). Capture both sides again.`);
  assert.equal(missingCellDiagnostic({ targetId: 'news', viewportId: 'desktop', ac: {}, bc: {}, a: A, b: B }), null);
});

test('R8.19: an id of another shape is left out or named as unknown', () => {
  assert.equal(missingCellDiagnostic({ targetId: 'x\u001b[2J', viewportId: '../v', bc: {}, a: { id: 'a b\n' }, b: B }), 'Target unknown target at unknown viewport is not in run A. Capture that side again.');
  assert.equal(missingCellDiagnostic({ targetId: 'news', viewportId: 'desktop', bc: {}, a: undefined, b: B }), 'Target news at desktop is not in run A. Capture that side again.');
});

// compareRuns loads pngjs and pixelmatch. The plain unit job installs no dependency, so it skips this test.
const tools = await Promise.all([import('pngjs'), import('pixelmatch'), import('../../src/compare/runs.js'), import('../../src/config/index.js'), import('../../src/config/settings.js')]).catch(() => null);
test('compareRuns names the run that lacks a renamed target (R8.19, #412)', { skip: !tools && 'pngjs or pixelmatch is not installed' }, async () => {
  const [{ PNG }, , { compareRuns }, { normalizeConfig, settingsHash }, { screenshotScope, settleRecipe }] = tools;
  const dir = await mkdtemp(join(tmpdir(), 'test-kit-missing-'));
  try {
    const png = () => { const image = new PNG({ width: 20, height: 10 }); image.data.fill(255); return PNG.sync.write(image); };
    const fake = async (id, targetIds) => {
      const config = normalizeConfig({ schemaVersion: 1, sides: { local: { origin: 'http://localhost:8080' } },
        targets: targetIds.map((target) => ({ id: target, kind: 'page', path: `/${target}` })), viewports: [{ id: 'desktop', width: 20, height: 10 }], runsRoot: 'runs' });
      const runDir = join(dir, 'runs', id);
      const captures = [];
      for (const row of config.targets) {
        const path = `screenshots/${row.id}/desktop.png`;
        await mkdir(join(runDir, 'screenshots', row.id), { recursive: true });
        await writeFile(join(runDir, path), png());
        captures.push({ targetId: row.id, viewportId: 'desktop', settleHash: settingsHash(settleRecipe(config, 'local', row)), scopeHash: settingsHash(screenshotScope(row, 'local')), state: 'captured', path, statusCode: 200, finalPath: `/${row.id}`, width: 20, height: 10, deviceScaleFactor: 1, artifacts: {} });
      }
      await writeFile(join(runDir, 'run.json'), JSON.stringify({ schemaVersion: 2, id, side: 'local', label: id, at: '2026-11-17T10:00:00.000Z', state: 'complete', settings: config, settingsHash: 'sha256:abc',
        captureSettings: {}, tools: [{ name: 'playwright', version: '1.0.0', settingsHash: 'sha256:abc' }], captures }));
    };
    await fake(A.id, ['home', 'news']);
    await fake(B.id, ['home', 'blog']);
    const { report } = await compareRuns({ runsRoot: join(dir, 'runs'), runA: A.id, runB: B.id, outputDir: join(dir, 'report') });
    const cell = (id) => report.entries.find((entry) => entry.id === id).viewports[0];
    assert.equal(cell('news').diagnostic, `Target news at desktop is not in run B (${B.id}). Capture that side again.`);
    assert.equal(cell('blog').diagnostic, `Target blog at desktop is not in run A (${A.id}). Capture that side again.`);
    assert.equal(cell('home').diagnostic, undefined);
    assert.equal(cell('news').state, 'missing');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
