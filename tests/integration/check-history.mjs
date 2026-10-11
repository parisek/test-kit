import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHistory } from '../../src/history/index.js';

const cleanups = [];
const t = { after: cleanup => cleanups.push(cleanup) };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'test-kit-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
try {
  const root = await fixture(t);
  await mkdir(join(root, 'reports/pair-a'), { recursive: true });
  await writeFile(join(root, 'reports/pair-a/report.json'), JSON.stringify({ meta: { title: 'Example' }, entries: [], findings: [], causes: [], rules: {} }));
  const before = process.listenerCount('SIGINT');
  const history = await startHistory({ local: root });
  t.after(() => history.close());
  assert.equal(history.server.address().address, '127.0.0.1');
  const index = await fetch(history.origin);
  assert.equal(index.status, 200);
  const redirect = await fetch(history.origin + '/report/pair-a', { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  const viewerOrigin = redirect.headers.get('location');
  assert.equal((await fetch(viewerOrigin + 'report.json')).status, 200);
  assert.equal((await fetch(history.origin + '/', { method: 'POST' })).status, 405);
  assert.equal((await fetch(history.origin + '//outside')).status, 400);
  await history.close();
  assert.equal(process.listenerCount('SIGINT'), before);
  await assert.rejects(fetch(viewerOrigin));

} finally {
  for (const cleanup of cleanups.reverse()) await cleanup();
}
console.log('History loopback and viewer lifecycle checks pass.');
