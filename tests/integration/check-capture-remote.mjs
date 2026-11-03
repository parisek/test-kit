// Explicit browser regression checks for a remote side: read-only capture of its own origin.
// The server listens on loopback. `remote: true` makes the side behave as a deployed site:
// only its own origin is allowed, a request to any other origin is dropped.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { capture } from '../../src/capture/index.js';

let submissions = 0;
const agents = [];
const challenges = [];
const server = createServer((request, response) => {
  if (request.method === 'POST' && request.url.startsWith('/cdn-cgi/challenge-platform/')) {
    challenges.push(request.url);
    if (request.url.endsWith('/redirect')) { response.writeHead(307, { Location: '/submit' }); response.end(); return; }
    response.end('ok'); return;
  }
  if (request.method === 'POST') submissions++;
  agents.push({ url: request.url, agent: request.headers['user-agent'] });
  if (request.url === '/challenged') { response.writeHead(403, { 'cf-mitigated': 'challenge', 'Content-Type': 'text/html' }); response.end('<h1>Just a moment</h1>'); return; }
  if (request.url === '/limited') { response.writeHead(429); response.end(); return; }
  if (request.url === '/challenged.css') { response.writeHead(403, { 'cf-mitigated': 'challenge' }); response.end(); return; }
  if (request.url === '/pixel.css') { response.setHeader('Content-Type', 'text/css'); response.end('h1{color:#123}'); return; }
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
    '/asset-challenged': '<link rel="stylesheet" href="/challenged.css">',
    '/agent': '<link rel="stylesheet" href="/pixel.css">',
    '/behavior-edge': '<button onclick="fetch(\'/challenged.css\').catch(()=>{})">Open</button>',
    '/challenge-redirect': '<script>fetch("/cdn-cgi/challenge-platform/h/b/redirect",{method:"POST",body:"x"}).catch(()=>{})</script>',
    '/challenge-encoded': '<script>fetch("/cdn-cgi/challenge-platform/..%2fsubmit",{method:"POST",body:"x"}).catch(()=>{})</script>',
    '/challenge-form': '<iframe name="f"></iframe><form target="f" method="post" action="/cdn-cgi/challenge-platform/h/b/form"></form><script>document.forms[0].submit()</script>',
    '/challenge': '<script>fetch("/cdn-cgi/challenge-platform/h/b/jsd/oneshot/example",{method:"POST",body:"x"}).then(r=>r.text()).then(t=>{document.title=t}).catch(()=>{})</script>',
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

  // R3.4: without userAgent the capture sends the Playwright default. With it, every request sends the value.
  const named = 'Mozilla/5.0 (X11; Linux x86_64) example test-kit/1.0';
  const agentBase = { ...base, targets: [{ id: 'agent', kind: 'page', title: 'agent', path: '/agent' }] };
  agents.length = 0;
  await writeFile(configPath, JSON.stringify({ ...agentBase, sides: { production: { origin, remote: true, settle: { waitMs: 100 } } } }));
  const plain = await capture({ configPath, side: 'production' });
  assert.equal(plain.run.captures[0].state, 'captured');
  assert.ok(agents.length >= 2 && agents.every(row => /HeadlessChrome/.test(row.agent)), JSON.stringify(agents));
  agents.length = 0;
  await writeFile(configPath, JSON.stringify({ ...agentBase, sides: { production: { origin, remote: true, userAgent: named, settle: { waitMs: 100 } } } }));
  const custom = await capture({ configPath, side: 'production' });
  assert.equal(custom.run.captures[0].state, 'captured');
  assert.deepEqual([...new Set(agents.map(row => row.url))].sort(), ['/agent', '/pixel.css']);
  assert.ok(agents.every(row => row.agent === named), JSON.stringify(agents));
  assert.equal(custom.run.settings.sides.production.userAgent, named);
  assert.equal(custom.run.settingsHash, plain.run.settingsHash, 'the User-Agent must not enter the capture settings hash');

  // R3.5: without challenge the challenge POST fails the capture. With challenge cloudflare it passes,
  // and every other POST still fails.
  const challengeBase = { ...base, targets: ['challenge', 'post', 'challenge-redirect', 'challenge-encoded', 'challenge-form'].map(id => ({ id, kind: 'page', title: id, path: `/${id}` })) };
  await writeFile(configPath, JSON.stringify({ ...challengeBase, sides: { production: { origin, remote: true, settle: { waitMs: 300 } } } }));
  const strictChallenge = await capture({ configPath, side: 'production' });
  assert.equal(strictChallenge.run.captures.find(row => row.targetId === 'challenge').state, 'failed');
  assert.equal(challenges.length, 0);
  await writeFile(configPath, JSON.stringify({ ...challengeBase, sides: { production: { origin, remote: true, challenge: 'cloudflare', settle: { waitMs: 300 } } } }));
  const passed = await capture({ configPath, side: 'production' });
  assert.equal(passed.run.captures.find(row => row.targetId === 'challenge').state, 'captured', JSON.stringify(passed.run.captures));
  // A redirect of the allowed POST, an encoded separator and a form POST into a frame still fail.
  for (const id of ['post', 'challenge-redirect', 'challenge-encoded', 'challenge-form']) assert.equal(passed.run.captures.find(row => row.targetId === id).state, 'failed', id);
  assert.deepEqual(challenges, ['/cdn-cgi/challenge-platform/h/b/jsd/oneshot/example', '/cdn-cgi/challenge-platform/h/b/redirect']);
  assert.equal(passed.run.settings.sides.production.challenge, 'cloudflare');
  assert.equal(passed.run.settingsHash, strictChallenge.run.settingsHash, 'challenge must not enter the capture settings hash');
  assert.equal(submissions, 0);

  // R3.6: a challenge or a rate limit stops the run. No later target sends a request.
  for (const [stop, reason] of [['challenged', /cf-mitigated: challenge/], ['limited', /HTTP 429/], ['asset-challenged', /cf-mitigated: challenge/]]) {
    agents.length = 0;
    const stopBase = { ...base, targets: ['home', stop, 'agent'].map(id => ({ id, kind: 'page', title: id, path: id === 'home' ? '/' : `/${id}` })) };
    await writeFile(configPath, JSON.stringify({ ...stopBase, sides: { production: { origin, remote: true, settle: { waitMs: 100 } } } }));
    const halted = await capture({ configPath, side: 'production' });
    const row = id => halted.run.captures.find(item => item.targetId === id);
    assert.equal(row('home').state, 'captured', stop);
    assert.equal(row(stop).error?.code, 'REMOTE_EDGE_STOP', `${stop}: ${JSON.stringify(row(stop))}`);
    assert.match(row(stop).error.message, reason);
    assert.equal(row('agent').error?.code, 'RUN_STOPPED', stop);
    assert.equal(halted.run.state, 'partial');
    assert.ok(!agents.some(item => item.url === '/agent' || item.url === '/pixel.css'), `${stop}: ${JSON.stringify(agents)}`);
  }

  // R3.6: an edge response during behavior also stops the run.
  agents.length = 0;
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  await writeFile(join(directory, 'package-lock.json'), '{"packages":{}}');
  await mkdir(join(directory, 'contracts'), { recursive: true });
  await writeFile(join(directory, 'contracts', 'edge.contract.js'), "export const name='edge';export async function detect(page){return page.locator('button').all();}export async function run(page,button){await Promise.all([page.waitForResponse(r=>r.url().endsWith('/challenged.css')),button.click()]);return {clicked:true};}");
  const behaviorBase = { ...base, artifacts: ['screenshot', 'status', 'behavior'], behavior: { source: 'contracts', projects: { desktop: 'desktop-1280' } },
    targets: ['behavior-edge', 'agent'].map(id => ({ id, kind: 'page', title: id, path: `/${id}` })) };
  await writeFile(configPath, JSON.stringify({ ...behaviorBase, sides: { production: { origin, remote: true, settle: { waitMs: 100 } } } }));
  const duringBehavior = await capture({ configPath, side: 'production' });
  const behaviorRow = id => duringBehavior.run.captures.find(item => item.targetId === id);
  assert.equal(behaviorRow('behavior-edge').error?.code, 'REMOTE_EDGE_STOP', JSON.stringify(behaviorRow('behavior-edge')));
  assert.equal(behaviorRow('agent').error?.code, 'RUN_STOPPED');
  assert.ok(!agents.some(item => item.url === '/agent'), JSON.stringify(agents));

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
  console.log('Remote side passes: own origin read, third party dropped, submission, off-origin write, redirect and popup blocked, User-Agent sent when set, challenge POST passed only when set, edge stop ends the run, local side unchanged, certificates verified.');
} finally {
  await rm(directory, { recursive: true, force: true });
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
