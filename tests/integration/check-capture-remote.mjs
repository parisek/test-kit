// Explicit browser regression checks for a remote side: read-only capture of its own origin.
// The server listens on loopback. `remote: true` makes the side behave as a deployed site:
// only its own origin is allowed, a request to any other origin is dropped.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { capture } from '../../src/capture/index.js';

let submissions = 0;
const server = createServer((request, response) => {
  if (request.method === 'POST') submissions++;
  if (request.url === '/external-redirect') {
    response.writeHead(302, { Location: 'https://example.invalid/' }); response.end(); return;
  }
  response.setHeader('Content-Type', 'text/html');
  const bodies = {
    '/script': '<script src="https://example.invalid/tag.js"></script>',
    '/beacon': '<script>fetch("https://example.invalid/b",{method:"POST"}).catch(()=>{})</script>',
    '/frame': '<iframe src="https://example.invalid/"></iframe>',
    '/post': '<script>fetch("/submit",{method:"POST"}).catch(()=>{})</script>',
    '/popup': '<script>window.open("https://example.invalid/")</script>',
  };
  response.end(`<!doctype html><body><h1>Example site</h1>${bodies[request.url] ?? ''}</body>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const directory = await mkdtemp(join(tmpdir(), 'test-kit-remote-'));
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const targets = ['home', 'script', 'frame', 'post', 'beacon', 'external-redirect', 'popup'].map(id => ({ id, kind: 'page', title: id, path: id === 'home' ? '/' : `/${id}` }));
  const base = { schemaVersion: 1, targets, viewports: [{ id: 'desktop', width: 400, height: 300 }],
    artifacts: ['screenshot', 'status'], checks: [], runsRoot: 'runs', screenshot: { timeoutMs: 2500 } };
  const configPath = join(directory, 'config.json');
  await writeFile(configPath, JSON.stringify({ ...base, sides: { production: { origin, remote: true, settle: { waitMs: 100 } } } }));
  const remote = await capture({ configPath, side: 'production' });
  const state = id => remote.run.captures.find(row => row.targetId === id).state;
  for (const id of ['home', 'script', 'frame']) assert.equal(state(id), 'captured', `${id}: ${JSON.stringify(remote.run.captures)}`);
  for (const id of ['post', 'beacon', 'external-redirect', 'popup']) assert.equal(state(id), 'failed', `${id}: ${JSON.stringify(remote.run.captures)}`);
  assert.equal(remote.run.settings.sides.production.remote, true);
  assert.equal(submissions, 0);

  // The same page on a local side still fails: a request that leaves the local environment blocks the capture.
  await writeFile(configPath, JSON.stringify({ ...base, sides: { local: { origin, settle: { waitMs: 100 } } } }));
  const local = await capture({ configPath, side: 'local' });
  for (const id of ['script', 'frame']) assert.equal(local.run.captures.find(row => row.targetId === id).state, 'failed', id);
  // A remote side verifies certificates. A local side ignores them for self-signed DDEV certificates.
  const key = join(directory, 'key.pem');
  const cert = join(directory, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  const secure = createSecureServer({ key: readFileSync(key), cert: readFileSync(cert) }, (_request, response) => {
    response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><body><h1>Example site</h1>');
  });
  await new Promise(resolve => secure.listen(0, '127.0.0.1', resolve));
  try {
    const secureOrigin = `https://127.0.0.1:${secure.address().port}`;
    const tls = { ...base, targets: [targets[0]], artifacts: ['status'] };
    await writeFile(configPath, JSON.stringify({ ...tls, sides: { production: { origin: secureOrigin, remote: true } } }));
    const strict = await capture({ configPath, side: 'production' });
    assert.equal(strict.run.captures[0].state, 'failed', 'a remote side must reject a self-signed certificate');
    await writeFile(configPath, JSON.stringify({ ...tls, sides: { local: { origin: secureOrigin } } }));
    const lenient = await capture({ configPath, side: 'local' });
    assert.equal(lenient.run.captures[0].state, 'captured', 'a local side must accept a self-signed certificate');
  } finally {
    await new Promise(resolve => { secure.close(resolve); secure.closeAllConnections(); });
  }
  console.log('Remote side passes: own origin read, third party dropped, submission, off-origin write, redirect and popup blocked, local side unchanged, certificates verified.');
} finally {
  await rm(directory, { recursive: true, force: true });
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
