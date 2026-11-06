// Browser check for `thirdParty` on a local side (R3.10, issue #252).
// A local page embeds a frame and an image from another origin. Without the key the capture fails.
// With "drop" it succeeds, records the aborted requests in `dropped`, and the other origin gets no request.
// A top-level redirect to the other origin and a POST still fail.
// A loopback host counts as local, so the other origin uses a non-loopback address of this machine.
// A machine without one skips the check.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, networkInterfaces } from 'node:os';
import { capture } from '../../src/capture/index.js';

const ADDRESS = Object.values(networkInterfaces()).flat().find(item => item && item.family === 'IPv4' && !item.internal)?.address;
if (!ADDRESS) { console.log('thirdParty check skipped: no non-loopback IPv4 address.'); process.exit(0); }

const hits = [];
const other = createServer((request, response) => { hits.push(request.url); response.setHeader('Content-Type', 'text/html'); response.end('<p>other</p>'); });
await new Promise(resolve => other.listen(0, '0.0.0.0', resolve));
const otherOrigin = `http://${ADDRESS}:${other.address().port}`;
const local = createServer((request, response) => {
  if (request.url === '/jump') { response.writeHead(302, { Location: `${otherOrigin}/jump` }); response.end(); return; }
  const bodies = {
    '/': '',
    '/embed': `<iframe src="${otherOrigin}/frame" width="100" height="50"></iframe><img src="${otherOrigin}/a.png" width="10" height="10">`,
    '/post': `<script>fetch('${otherOrigin}/post', { method: 'POST', body: 'x' }).catch(() => {})</script>`,
  };
  response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><body><h1>Example site</h1>${bodies[request.url] ?? ''}</body>`);
});
await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
const directory = await mkdtemp(join(tmpdir(), 'test-kit-third-party-'));
try {
  const targets = ['home', 'embed', 'post', 'jump'].map(id => ({ id, kind: 'page', title: id, path: id === 'home' ? '/' : `/${id}` }));
  const base = { schemaVersion: 1, targets, viewports: [{ id: 'desktop', width: 400, height: 300 }], artifacts: ['screenshot', 'status'], checks: [], runsRoot: 'runs', screenshot: { timeoutMs: 5000 } };
  const run = async thirdParty => {
    const configPath = join(directory, `config-${thirdParty ?? 'none'}.json`);
    await writeFile(configPath, JSON.stringify({ ...base, sides: { local: { origin: `http://127.0.0.1:${local.address().port}`, settle: { waitMs: 100 }, ...(thirdParty ? { thirdParty } : {}) } } }));
    const { run: result } = await capture({ configPath, side: 'local' });
    return { row: id => result.captures.find(item => item.targetId === id), result };
  };
  const plain = await run(null);
  assert.equal(plain.row('embed').state, 'failed', 'a local side blocks a third-party embed by default');
  assert.equal(plain.row('embed').error.code, 'LOCAL_NAVIGATION_REQUIRED');
  const block = await run('block');
  assert.equal(block.row('embed').state, 'failed');
  const dropped = await run('drop');
  assert.equal(dropped.row('home').state, 'captured');
  assert.equal(dropped.row('embed').state, 'captured', JSON.stringify(dropped.row('embed')));
  const types = (dropped.row('embed').dropped ?? []).map(item => `${item.resourceType} ${item.origin}`).sort();
  assert.deepEqual(types, [`document ${otherOrigin}`, `image ${otherOrigin}`], `the aborted requests are recorded: ${types}`);
  assert.equal(dropped.row('home').dropped, undefined, 'a page without an aborted request adds no record');
  assert.equal(dropped.row('post').state, 'failed', 'a write to another origin still fails the capture');
  assert.equal(dropped.row('jump').state, 'failed', 'a redirect to another origin still fails the capture');
  assert.equal(hits.length, 0, `the other origin receives no request: ${hits}`);
  assert.equal(dropped.result.captureSettings.thirdParty, 'drop');
  assert.notEqual(dropped.result.settingsHash, plain.result.settingsHash);
  console.log('thirdParty passes: a local side drops a third-party frame and image, records them, and still fails a write and a redirect.');
} finally {
  await rm(directory, { recursive: true, force: true });
  await new Promise(resolve => { local.close(resolve); local.closeAllConnections(); });
  await new Promise(resolve => { other.close(resolve); other.closeAllConnections(); });
}
process.exit(0);
