// Explicit browser regression checks for local, read-only capture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { capture } from '../../src/capture/index.js';

let submissions = 0;
let sockets = 0;
const server = createServer((request, response) => {
  if (request.method === 'POST') submissions++;
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
  assert.equal(result.run.captures.find(row => row.targetId === 'socket').state, 'captured');
  assert.equal(submissions, 0);
  assert.equal(sockets, 0);
  console.log('Capture guards pass: assets, frames, popups, redirects, submissions, sockets, font deadline.');
} finally {
  await rm(directory, { recursive: true, force: true });
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
