// Explicit browser regression checks for `capture --keep-existing` (R5.13, ADR 0009).
// A local server on loopback plays a deployed site: the side has `remote: true`, as R3.3 allows. Page hits are counted,
// so the check can prove that a kept cell sends no request.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { capture } from '../../src/capture/index.js';
import { compareRuns } from '../../src/compare/runs.js';

const hits = new Map();
const server = createServer((request, response) => {
  hits.set(request.url, (hits.get(request.url) ?? 0) + 1);
  if (request.url === '/bad') { request.socket.resetAndDestroy(); return; }
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><body><h1>Example site ${request.url}</h1></body>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const directory = await mkdtemp(join(tmpdir(), 'test-kit-keep-'));
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const configPath = join(directory, 'config.json');
  const page = (id, path = `/${id}`) => ({ id, kind: 'page', title: id, path });
  const write = (targets, side = {}, extra = {}) => writeFile(configPath, JSON.stringify({ schemaVersion: 1, targets, viewports: [{ id: 'desktop', width: 400, height: 300 }],
    artifacts: ['screenshot', 'status'], checks: [], runsRoot: 'runs', screenshot: { timeoutMs: 4000 }, ...extra,
    sides: { production: { origin, remote: true, settle: { waitMs: 50 }, ...side } } }));
  const row = (result, id) => result.run.captures.find(item => item.targetId === id);
  const total = () => [...hits.values()].reduce((sum, value) => sum + value, 0);
  const strip = ({ kept: _kept, warnings: _warnings, ...entry }) => entry;
  const home = page('home');
  const about = page('about');

  // A local side refuses the option, before any run directory exists.
  await write([home], { remote: false });
  await assert.rejects(capture({ configPath, side: 'production', keepExisting: true }), /needs a side with remote: true/);
  await assert.rejects(access(join(directory, 'runs')), 'no run directory exists');

  // An empty store gives a normal fresh run: no kept key, no warning.
  await write([home, about]);
  const first = await capture({ configPath, side: 'production', keepExisting: true });
  assert.equal(first.run.state, 'complete', JSON.stringify(first.run.captures));
  for (const entry of first.run.captures) { assert.equal(Object.hasOwn(entry, 'kept'), false); assert.equal(Object.hasOwn(entry, 'warnings'), false); }
  const base = total();

  // The second run keeps both cells: no request, a copied file, provenance, and the same recipe and hashes.
  const second = await capture({ configPath, side: 'production', keepExisting: true });
  assert.equal(total(), base, 'a kept cell sends no request');
  assert.equal(second.run.state, 'complete');
  assert.equal(second.run.settingsHash, first.run.settingsHash);
  for (const id of ['home', 'about']) {
    const kept = row(second, id);
    assert.deepEqual(kept.kept, { runId: first.run.id, at: first.run.at });
    assert.deepEqual(kept.warnings, [{ code: 'REFERENCE_KEPT', count: 1 }]);
    assert.deepEqual(strip(kept), strip(row(first, id)), id);
    assert.deepEqual(await readFile(join(second.runDir, kept.path)), await readFile(join(first.runDir, kept.path)));
  }

  // An A/A pair with a kept side is complete and matches.
  const { report } = await compareRuns({ runsRoot: join(directory, 'runs'), runA: first.run.id, runB: second.run.id, outputDir: join(directory, 'out') });
  const rows = report.entries.flatMap(entry => entry.viewports);
  assert.ok(rows.length === 2 && rows.every(item => item.state === 'complete' && item.ratio === 0), JSON.stringify(rows));
  assert.ok(rows.every(item => item.warnings?.b?.[0]?.code === 'REFERENCE_KEPT' && !item.warnings?.a?.length), 'the warning shows in the report row');

  // The new run is self-contained: it still reads after the source run is removed (R12.1).
  await rm(first.runDir, { recursive: true, force: true });
  await access(join(second.runDir, row(second, 'home').path));
  const third = await capture({ configPath, side: 'production', keepExisting: true });
  assert.equal(total(), base);
  assert.deepEqual(row(third, 'home').kept, { runId: first.run.id, at: first.run.at }, 'a chain keeps the first measurement and its time');
  assert.deepEqual(row(third, 'home').warnings, [{ code: 'REFERENCE_KEPT', count: 1 }]);

  // A new target is captured fresh, the others stay kept. The target list is outside the settings hash.
  const contact = page('contact');
  await write([home, about, contact]);
  const mixed = await capture({ configPath, side: 'production', keepExisting: true });
  assert.equal(hits.get('/contact'), 1);
  assert.equal(total(), base + 1);
  assert.equal(Object.hasOwn(row(mixed, 'contact'), 'kept'), false);
  assert.ok(row(mixed, 'home').kept && row(mixed, 'about').kept);
  assert.equal(mixed.run.state, 'complete');

  // Rule 3: a changed target path captures fresh.
  await write([home, page('about', '/about?x=1'), contact]);
  const moved = await capture({ configPath, side: 'production', keepExisting: true });
  assert.equal(hits.get('/about?x=1'), 1);
  assert.equal(Object.hasOwn(row(moved, 'about'), 'kept'), false);
  assert.ok(row(moved, 'home').kept);

  // Rule 1: a key outside the settings hash (userAgent) still blocks a keep.
  await write([home, about]);
  const before = total();
  const agent = await capture({ configPath, side: 'production', keepExisting: true });
  assert.ok(row(agent, 'home').kept, 'sanity: same declaration keeps');
  await write([home, about], { userAgent: 'Mozilla/5.0 example test-kit' });
  const changed = await capture({ configPath, side: 'production', keepExisting: true });
  assert.equal(changed.run.captures.some(entry => entry.kept), false);
  assert.equal(total() - before, 2);

  // Rule 6: a partial run supplies nothing. 'bad' resets, so the run is partial, and the keep run uses the older complete run.
  await write([home, page('bad')]);
  const partial = await capture({ configPath, side: 'production' });
  assert.equal(partial.run.state, 'partial');
  assert.equal(row(partial, 'home').state, 'captured');
  await write([home, about]);
  const afterPartial = await capture({ configPath, side: 'production', keepExisting: true });
  assert.ok(row(afterPartial, 'home').kept, 'the complete run of the same declaration supplies the cell');
  assert.notEqual(row(afterPartial, 'home').kept.runId, partial.run.id);

  // Rule 5: a stored recipe of another engine version makes every cell fresh.
  await write([home, about], {}, { screenshot: { timeoutMs: 4000 } });
  const runs = join(directory, 'runs');
  for (const name of await readdir(runs)) {
    const path = join(runs, name, 'run.json');
    const stored = JSON.parse(await readFile(path, 'utf8'));
    for (const entry of stored.captures) if (entry.recipe) entry.recipe.version += 1;
    await writeFile(path, JSON.stringify(stored));
  }
  const stale = await capture({ configPath, side: 'production', keepExisting: true });
  assert.equal(stale.run.captures.some(entry => entry.kept), false);

  // Without the flag nothing is kept and the entries carry no new key (R5.1).
  const plain = await capture({ configPath, side: 'production' });
  assert.equal(plain.run.captures.some(entry => Object.hasOwn(entry, 'kept') || Object.hasOwn(entry, 'warnings')), false);
  console.log('capture keep-existing: ok');
} finally {
  server.close();
  await rm(directory, { recursive: true, force: true });
}
