import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareRuns } from '../../src/compare/runs.js';

// R8.17, #349 item 4: a target that answers 404 on purpose reads `ok` with `expectStatus: 404`.
// compareRuns loads pngjs and pixelmatch. The plain unit job installs no dependency, so it skips this test.
const hasImageTools = await Promise.all([import('pngjs'), import('pixelmatch')]).then(() => true, () => false);
test('compareRuns reads the expected status of a target as ok (R8.17)', { skip: !hasImageTools && 'pngjs or pixelmatch is not installed' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'tk-expect-status-'));
  try {
    const run = (id, expectStatus, statusCode) => ({ schemaVersion: 2, id, side: 'local', label: id, state: 'complete', settingsHash: 'sha256:' + 'a'.repeat(64),
      settings: { artifacts: ['status'], targets: [{ id: 'missing', kind: 'page', title: 'missing', path: '/missing', ...(expectStatus ? { expectStatus } : {}) }], viewports: [{ id: 'desktop', width: 10, height: 10, deviceScaleFactor: 1 }],
        sides: { local: { origin: 'http://127.0.0.1:8000', settle: {} } } },
      tools: [{ name: 'playwright', version: '1', settingsHash: 'sha256:' + 'a'.repeat(64) }],
      captures: [{ targetId: 'missing', viewportId: 'desktop', state: 'captured', statusCode, finalPath: '/missing', artifacts: {} }] });
    let count = 0;
    const compare = async (expectStatus, statusCode) => {
      for (const item of [run('run-a', expectStatus, statusCode), run('run-b', expectStatus, statusCode)]) {
        await mkdir(join(root, 'runs', item.id), { recursive: true });
        await writeFile(join(root, 'runs', item.id, 'run.json'), JSON.stringify(item));
      }
      return (await compareRuns({ runsRoot: join(root, 'runs'), runA: 'run-a', runB: 'run-b', outputDir: join(root, `out-${count += 1}`) })).report;
    };
    assert.deepEqual((await compare(undefined, 404)).entries[0].viewports[0].availability, { a: 'http-error', b: 'http-error' });
    assert.deepEqual((await compare(404, 404)).entries[0].viewports[0].availability, { a: 'ok', b: 'ok' });
    assert.deepEqual((await compare(404, 500)).entries[0].viewports[0].availability, { a: 'http-error', b: 'http-error' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
