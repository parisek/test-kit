import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportHistory } from '../../src/export/history.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'test-kit-history-export-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const local = join(root, 'local');
  await mkdir(join(local, 'runs/run-a'), { recursive: true });
  await writeFile(join(local, 'runs/run-a/run.json'), JSON.stringify({ label: '<unsafe>', state: 'partial', at: '2026-01-01' }));
  await writeFile(join(local, 'runs/run-a/feedback.json'), JSON.stringify({ state: 'incomplete', findingCount: 1, findings: [{ message: '<script>bad</script>' }] }));
  return { root, local, outputDir: join(root, 'export') };
}

test('history snapshot has relative feedback links and escaped partial-run metadata', async t => {
  const options = await fixture(t);
  const result = await exportHistory(options);
  assert.equal(result.runCount, 1);
  assert.equal(result.reportCount, 0);
  const index = await readFile(join(options.outputDir, 'index.html'), 'utf8');
  const detail = await readFile(join(options.outputDir, 'runs/run-a/index.html'), 'utf8');
  assert.ok(index.includes('href="runs/run-a/index.html"'));
  assert.ok(index.includes('static snapshot'));
  assert.ok(index.includes('&lt;unsafe&gt;'));
  assert.ok(detail.includes('href="../../index.html"'));
  assert.ok(detail.includes('Capture state: partial'));
  assert.ok(detail.includes('&lt;script&gt;'));
  assert.ok(!detail.includes('<script>'));
  assert.ok(await readFile(join(options.local, 'runs/run-a/run.json')));
});

test('history export does not overwrite an existing destination or write inside its store', async t => {
  const options = await fixture(t);
  await mkdir(options.outputDir);
  await writeFile(join(options.outputDir, 'keep'), 'keep');
  await assert.rejects(exportHistory(options), /already exists/);
  assert.equal(await readFile(join(options.outputDir, 'keep'), 'utf8'), 'keep');
  await assert.rejects(exportHistory({ ...options, outputDir: join(options.local, 'export') }), /outside/);
});

test('history export rejects a destination parent symlink into the source', async t => {
  const options = await fixture(t);
  await symlink(options.local, join(options.root, 'alias'));
  await assert.rejects(exportHistory({ ...options, outputDir: join(options.root, 'alias/export') }), /outside/);
  assert.deepEqual(await readdir(options.local), ['runs']);
});

test('unreadable history entries have no broken link and no escaped metadata is exported', async t => {
  const options = await fixture(t);
  await mkdir(join(options.local, 'runs/run-b'));
  await writeFile(join(options.root, 'outside.json'), JSON.stringify({ label: 'private outside label' }));
  await symlink(join(options.root, 'outside.json'), join(options.local, 'runs/run-b/run.json'));
  await exportHistory(options);
  const html = await readFile(join(options.outputDir, 'index.html'), 'utf8');
  assert.ok(html.includes('Unreadable metadata'));
  assert.ok(!html.includes('runs/run-b/index.html'));
  assert.ok(!html.includes('private outside label'));
});

test('history links a self-contained report and leaves unrelated source files out', async t => {
  const options = await fixture(t);
  const reportRoot = join(options.local, 'reports/pair-a');
  await mkdir(reportRoot, { recursive: true });
  await writeFile(join(reportRoot, 'report.json'), JSON.stringify({ schemaVersion: 2, meta: { title: 'Example comparison', viewports: [], matchBelow: 3 }, runs: [{ id: 'a' }, { id: 'b' }], pair: { kind: 'update', aRunId: 'a', bRunId: 'b' }, entries: [], findings: [], causes: [], rules: {} }));
  await writeFile(join(reportRoot, 'unrelated.txt'), 'unrelated');
  const result = await exportHistory(options);
  assert.equal(result.reportCount, 1);
  const html = await readFile(join(options.outputDir, 'index.html'), 'utf8');
  assert.ok(html.includes('href="reports/pair-a/index.html"'));
  const files = await readdir(join(options.outputDir, 'reports/pair-a'));
  assert.ok(files.includes('index.html'));
  assert.ok(files.includes('report.json'));
  assert.ok(!files.includes('unrelated.txt'));
});
