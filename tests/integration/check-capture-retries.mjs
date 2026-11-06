// Explicit browser regression checks for `capture --retries` (R5.14, ADR 0009).
// A local server resets the first connection of a page, then answers. Other pages answer 404, 503 or a challenge.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { capture } from '../../src/capture/index.js';

const hits = new Map();
const failures = { '/flaky': 1, '/flaky-twice': 2, '/always-reset': Infinity };
const server = createServer((request, response) => {
  const path = request.url;
  hits.set(path, (hits.get(path) ?? 0) + 1);
  if (hits.get(path) <= (failures[path] ?? 0)) { request.socket.resetAndDestroy(); return; }
  if (path === '/503') { response.writeHead(503, { 'Content-Type': 'text/html' }); response.end('<h1>Unavailable</h1>'); return; }
  if (path === '/404') { response.writeHead(404, { 'Content-Type': 'text/html' }); response.end('<h1>Missing</h1>'); return; }
  if (path === '/challenged') { response.writeHead(403, { 'cf-mitigated': 'challenge', 'Content-Type': 'text/html' }); response.end('<h1>Just a moment</h1>'); return; }
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><body><h1>Example site ${path}</h1></body>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const directory = await mkdtemp(join(tmpdir(), 'test-kit-retries-'));
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const target = id => ({ id, kind: 'page', title: id, path: `/${id}` });
  const configPath = join(directory, 'config.json');
  const write = async (ids, side) => writeFile(configPath, JSON.stringify({ schemaVersion: 1, targets: ids.map(target), viewports: [{ id: 'desktop', width: 400, height: 300 }],
    artifacts: ['screenshot', 'status'], checks: [], runsRoot: 'runs', screenshot: { timeoutMs: 4000 }, sides: { production: side ?? { origin, settle: { waitMs: 50 } } } }));
  const waits = [];
  const sleep = async ms => { waits.push(ms); };
  const reset = () => { hits.clear(); waits.length = 0; };
  const row = (result, id) => result.run.captures.find(item => item.targetId === id);

  // Default: no retry. One reset fails the cell. Nothing changes without the flag (R5.1).
  await write(['flaky']);
  let result = await capture({ configPath, side: 'production' }, { sleep });
  assert.equal(row(result, 'flaky').state, 'failed');
  assert.equal(hits.get('/flaky'), 1);
  assert.deepEqual(waits, []);
  assert.equal(result.run.state, 'partial');
  assert.doesNotMatch(row(result, 'flaky').error.message, /tried/);

  // One retry fixes one reset. The entry is captured, carries CAPTURE_RETRIED and the run is complete.
  reset();
  result = await capture({ configPath, side: 'production', retries: 1 }, { sleep });
  assert.equal(row(result, 'flaky').state, 'captured', JSON.stringify(result.run.captures));
  assert.deepEqual(row(result, 'flaky').warnings, [{ code: 'CAPTURE_RETRIED', count: 1 }]);
  assert.equal(hits.get('/flaky'), 2);
  assert.deepEqual(waits, [1000]);
  assert.equal(result.run.state, 'complete');
  const stored = JSON.parse(await readFile(result.manifestPath, 'utf8'));
  assert.equal(JSON.stringify(stored).includes('transient'), false);

  // The retry changes no hash and no recipe: the same page without a reset stores the same hashes.
  reset();
  hits.set('/flaky', 1);
  const plain = await capture({ configPath, side: 'production' }, { sleep });
  assert.equal(plain.run.settingsHash, result.run.settingsHash);
  const { warnings: _w, ...retried } = row(result, 'flaky');
  const { warnings: _x, ...first } = row(plain, 'flaky');
  assert.deepEqual({ recipe: retried.recipe, settleHash: retried.settleHash, scopeHash: retried.scopeHash }, { recipe: first.recipe, settleHash: first.settleHash, scopeHash: first.scopeHash });
  assert.equal(Object.hasOwn(row(plain, 'flaky'), 'warnings'), false);

  // Two resets need two retries and the waits are 1000 ms, then 2000 ms. One retry is not enough.
  reset();
  await write(['flaky-twice']);
  result = await capture({ configPath, side: 'production', retries: 1 }, { sleep });
  assert.equal(row(result, 'flaky-twice').state, 'failed');
  assert.match(row(result, 'flaky-twice').error.message, /The capture tried 2 times\.$/);
  assert.equal(result.run.state, 'partial');
  reset();
  result = await capture({ configPath, side: 'production', retries: 2 }, { sleep });
  assert.equal(row(result, 'flaky-twice').state, 'captured');
  assert.deepEqual(row(result, 'flaky-twice').warnings, [{ code: 'CAPTURE_RETRIED', count: 2 }]);
  assert.deepEqual(waits, [1000, 2000]);

  // A cell that fails on every attempt is stored failed, tells the attempts, and the run is partial.
  reset();
  await write(['always-reset']);
  result = await capture({ configPath, side: 'production', retries: 2 }, { sleep });
  assert.equal(row(result, 'always-reset').state, 'failed');
  assert.match(row(result, 'always-reset').error.message, /The capture tried 3 times\.$/);
  assert.equal(hits.get('/always-reset'), 3);
  assert.equal(result.run.state, 'partial');

  // A 503 and a 404 are page results. They are never retried: one request each.
  reset();
  await write(['503', '404']);
  result = await capture({ configPath, side: 'production', retries: 2 }, { sleep });
  assert.equal(hits.get('/503'), 1);
  assert.equal(hits.get('/404'), 1);
  assert.deepEqual(waits, []);
  assert.equal(row(result, '503').statusCode, 503);
  assert.equal(row(result, '404').statusCode, 404);
  for (const id of ['503', '404']) assert.equal(Object.hasOwn(row(result, id), 'warnings'), false);

  // A remote edge stop is never retried. Later cells stop with RUN_STOPPED and send nothing.
  reset();
  await write(['challenged', 'later'], { origin, remote: true, settle: { waitMs: 50 } });
  result = await capture({ configPath, side: 'production', retries: 2 }, { sleep });
  assert.equal(row(result, 'challenged').error.code, 'REMOTE_EDGE_STOP');
  assert.equal(row(result, 'later').error.code, 'RUN_STOPPED');
  assert.equal(hits.get('/challenged'), 1);
  assert.equal(hits.get('/later') ?? 0, 0);
  assert.deepEqual(waits, []);

  // A refused connection is never retried (ADR 0009, answer 6).
  const closed = createServer();
  await new Promise(resolve => closed.listen(0, '127.0.0.1', resolve));
  const refusedOrigin = `http://127.0.0.1:${closed.address().port}`;
  await new Promise(resolve => closed.close(resolve));
  reset();
  await write(['home'], { origin: refusedOrigin, settle: { waitMs: 50 } });
  result = await capture({ configPath, side: 'production', retries: 2 }, { sleep });
  assert.equal(row(result, 'home').state, 'failed');
  assert.doesNotMatch(row(result, 'home').error.message, /tried/);
  assert.deepEqual(waits, []);
  console.log('capture retries: ok');
} finally {
  server.close();
  await rm(directory, { recursive: true, force: true });
}
