// Explicit browser regression checks for local, read-only capture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { capture } from '../../src/capture/index.js';
import { statusDetail } from '../../src/artifacts/schema.js';

let submissions = 0;
let sockets = 0;
const server = createServer((request, response) => {
  if (request.method === 'POST') submissions++;
  // #348: a canonical redirect that drops the port, as WordPress answers on the DDEV direct port.
  if (request.url === '/port-redirect') {
    response.writeHead(301, { Location: `http://127.0.0.1:${router.address().port}/port-redirect` }); response.end(); return;
  }
  if (request.url === '/external-redirect') {
    response.writeHead(302, { Location: 'https://example.invalid/' }); response.end(); return;
  }
  response.setHeader('Content-Type', 'text/html');
  const bodies = {
    '/asset': '<img src="https://example.invalid/a.png">',
    '/frame': '<iframe src="https://example.invalid/"></iframe>',
    '/popup': '<script>window.open("https://example.invalid/")</script>',
    '/post': '<script>fetch("/submit",{method:"POST"}).catch(()=>{})</script>',
    '/socket': '<script>new WebSocket(`ws://${location.host}/socket-stream`)</script>',
    '/timeout': '<script>document.fonts.load=()=>new Promise(()=>{});Object.defineProperty(document.fonts,"ready",{value:new Promise(()=>{})})</script>',
  };
  response.end(`<!doctype html><body><h1>Example site</h1>${bodies[request.url] ?? ''}</body>`);
});
// #348: the other server stands for the DDEV router. It answers its own 404 page.
let routerRequests = 0;
const router = createServer((_request, response) => { routerRequests++; response.writeHead(404, { 'Content-Type': 'text/html' }); response.end('<!doctype html><h1>404: No Route Found</h1>'); });
await new Promise(resolve => router.listen(0, '127.0.0.1', resolve));
server.on('upgrade', (_request, socket) => { sockets++; socket.destroy(); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const directory = await mkdtemp(join(tmpdir(), 'test-kit-guards-'));
try {
  const configPath = join(directory, 'config.json');
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1,
    sides: { local: { origin: `http://127.0.0.1:${server.address().port}`, settle: { waitMs: 150 } } },
    targets: ['asset', 'frame', 'popup', 'post', 'external-redirect', 'socket', 'timeout'].map(id => ({ id, kind: 'page', title: id, path: `/${id}` })),
    viewports: [{ id: 'desktop', width: 400, height: 300 }], artifacts: ['screenshot'], checks: [], runsRoot: 'runs', screenshot: { timeoutMs: 1500 },
  }));
  const result = await capture({ configPath, side: 'local' });
  for (const id of ['asset', 'frame', 'popup', 'post', 'external-redirect', 'timeout']) {
    assert.equal(result.run.captures.find(row => row.targetId === id).state, 'failed', `${id}: ${JSON.stringify(result.run.captures)}`);
  }
  // R3.7: the error names the first blocked request, and says which kind it was.
  const error = id => result.run.captures.find(row => row.targetId === id).error;
  for (const id of ['asset', 'frame', 'popup', 'post', 'external-redirect']) assert.equal(error(id).code, 'LOCAL_NAVIGATION_REQUIRED', id);
  assert.match(error('asset').message, /First blocked request: GET https:\/\/example\.invalid, image, subresource\.$/);
  assert.match(error('frame').message, /First blocked request: GET https:\/\/example\.invalid, document, frame navigation\.$/);
  assert.match(error('popup').message, /First blocked request: GET https:\/\/example\.invalid, document, top-level navigation\.$/);
  assert.match(error('post').message, /First blocked request: POST http:\/\/127\.0\.0\.1:\d+, (?:fetch|xhr), subresource\.$/);
  assert.match(error('external-redirect').message, /First blocked request: GET https:\/\/example\.invalid, document, top-level navigation, redirect target\.$/);
  for (const id of ['asset', 'frame', 'popup', 'post', 'external-redirect']) assert.doesNotMatch(error(id).message, /\/submit|\/a\.png/, `${id}: the message names no path`);
  assert.equal(result.run.captures.find(row => row.targetId === 'socket').state, 'captured');
  assert.equal(submissions, 0);
  assert.equal(sockets, 0);
  // #348: without --ddev a loopback redirect to another port is allowed (R3.10). The status sidecar names the final origin.
  const origin = `http://127.0.0.1:${server.address().port}`;
  const ddevConfig = join(directory, 'ddev.json');
  await writeFile(ddevConfig, JSON.stringify({ schemaVersion: 1, sides: { local: { origin, settle: { waitMs: 0 } } },
    targets: [{ id: 'port-redirect', kind: 'page', path: '/port-redirect' }, { id: 'external', kind: 'page', path: '/external-redirect' }, { id: 'home', kind: 'page', path: '/' }],
    viewports: [{ id: 'desktop', width: 400, height: 300 }], artifacts: ['status'], checks: [], runsRoot: 'runs-ddev' }));
  const open = await capture({ configPath: ddevConfig, side: 'local' });
  const followed = open.run.captures.find(row => row.targetId === 'port-redirect');
  assert.equal(followed.statusCode, 404);
  const sidecar = async (run, row) => statusDetail(JSON.parse(await readFile(join(directory, 'runs-ddev', run.id, row.artifacts.status.path), 'utf8')));
  assert.equal((await sidecar(open.run, followed)).finalOrigin, `http://127.0.0.1:${router.address().port}`);
  assert.equal(Object.hasOwn(await sidecar(open.run, open.run.captures.find(row => row.targetId === 'home')), 'finalOrigin'), false);
  assert.equal(routerRequests, 1);
  // #348, R13.13: with --ddev (originBound) the redirect fails the capture before the router gets a request.
  const bound = await capture({ configPath: ddevConfig, side: 'local', originBound: true });
  const stopped = bound.run.captures.find(row => row.targetId === 'port-redirect');
  assert.equal(stopped.state, 'failed');
  assert.equal(stopped.error.code, 'DDEV_REDIRECT_LEFT_ORIGIN');
  assert.match(stopped.error.message, new RegExp(`redirects from the DDEV origin to http://127\\.0\\.0\\.1:${router.address().port}\\.`));
  assert.equal(bound.run.captures.find(row => row.targetId === 'home').state, 'captured');
  // R3.7: a redirect that leaves the local environment keeps its own code, also with --ddev.
  assert.equal(bound.run.captures.find(row => row.targetId === 'external').error.code, 'LOCAL_NAVIGATION_REQUIRED');
  assert.equal(routerRequests, 1);
  console.log('Capture guards pass: assets, frames, popups, redirects, submissions, sockets, font deadline, DDEV origin redirect.');
} finally {
  await rm(directory, { recursive: true, force: true });
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await new Promise(resolve => { router.close(resolve); router.closeAllConnections(); });
}
