import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanHistory, renderHistory, renderRunFeedback } from '../../src/history/index.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'test-kit-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test('history retains incomplete runs and unreadable metadata', async t => {
  const root = await fixture(t);
  for (const id of ['run-a', 'run-b']) await mkdir(join(root, 'runs', id), { recursive: true });
  await writeFile(join(root, 'runs/run-a/run.json'), JSON.stringify({ state: 'partial', label: 'before' }));
  await writeFile(join(root, 'runs/run-b/run.json'), '{');
  const data = await scanHistory(root);
  assert.equal(data.runs[0].id, 'run-b');
  assert.equal(data.runs[0].error, 'Unreadable metadata');
  assert.equal(data.runs[1].value.state, 'partial');
  assert.deepEqual(data.reports, []);
});
test('history refuses metadata symlinks outside the store', async t => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await mkdir(join(root, 'runs/run-a'), { recursive: true });
  await writeFile(join(outside, 'secret.json'), JSON.stringify({ label: 'secret' }));
  await symlink(join(outside, 'secret.json'), join(root, 'runs/run-a/run.json'));
  assert.equal((await scanHistory(root)).runs[0].error, 'Unreadable metadata');
});
test('history escapes metadata and accepts malformed display fields', () => {
  const html = renderHistory({ runs: [{ id: 'run-a', value: { label: '<script>alert(1)</script>', settings: { targets: {}, artifacts: {} } } }], reports: [{ id: 'pair-a', value: { meta: { title: '<img src=x>' }, findings: [] } }] });
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img src=x&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('/report/pair-a'));
});

test('standalone feedback escapes findings, bounds output, and retains absent feedback', () => {
  const run = { state: 'partial', label: '<img src=x>' };
  const absent = renderRunFeedback({ id: 'run-a', run });
  assert.ok(absent.includes('Capture state: partial'));
  assert.ok(absent.includes('No standalone check feedback stored.'));
  assert.ok(absent.includes('&lt;img src=x&gt;'));
  const feedback = { state: 'incomplete', findingCount: 25, findings: Array.from({ length: 25 }, (_, i) => ({ targetId: 'example', message: '<script>' + i })) };
  const html = renderRunFeedback({ id: 'run-a', run, feedback });
  assert.equal((html.match(/<li>/g) || []).length, 20);
  assert.ok(html.includes('Omitted: 5'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;19'));
});
