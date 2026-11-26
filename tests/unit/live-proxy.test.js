// R10.18: the live proxy of `serve --live`. Pure rules first, then loopback servers only (no outside network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  badTarget, crossSiteRefused, forwardHeaders, injectScript, isHtmlPage, liveIndex, liveScript, proxyRefusal, responseHeaders, rewriteLocation, LIVE_SCRIPT_PATH,
} from '../../src/server/live-rules.js';
import { startLiveProxies } from '../../src/server/live.js';
import { serve } from '../../src/server/serve.js';
import { parseCommand } from '../../src/cli/run.js';

const SIDE = 'http://127.0.0.1:9';
const host = (port) => ({ host: `127.0.0.1:${port}` });

test('the request target follows the rule of serve', () => {
  for (const raw of ['//evil.example/', 'http://evil.example/', 'evil', '/a\\b', '/a\u0000', '']) assert.equal(badTarget(raw), true, raw);
  for (const raw of ['/', '/a/b?c=1', '/%2e%2e/']) assert.equal(badTarget(raw), false, raw);
});

test('a proxy refuses a foreign host, a cross-site request, other methods, a bad target and a service worker', () => {
  const check = (request) => proxyRefusal({ method: 'GET', url: '/', ...request, headers: { ...host(5000), ...request.headers } }, { port: 5000, sideOrigin: SIDE });
  assert.equal(check({}), null);
  assert.equal(check({ headers: { host: 'localhost:5000' } }), 400);
  assert.equal(check({ headers: { host: 'rebind.example:5000' } }), 400);
  assert.equal(check({ headers: { 'sec-fetch-site': 'cross-site' } }), 403);
  assert.equal(check({ headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } }), 403);
  assert.equal(check({ headers: { 'sec-fetch-site': 'same-site' } }), null);
  assert.equal(check({ method: 'POST' }), 405);
  assert.equal(check({ url: '//evil.example/' }), 400);
  assert.equal(check({ url: 'http://evil.example/' }), 400);
  assert.equal(check({ headers: { 'service-worker': 'script' } }), 403);
});

test('the report server lets a cross-site top-level navigation through and nothing else', () => {
  assert.equal(crossSiteRefused({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }, { allowNavigation: true }), false);
  assert.equal(crossSiteRefused({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }, { allowNavigation: true }), true);
  assert.equal(crossSiteRefused({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' }, { allowNavigation: true }), true);
  assert.equal(crossSiteRefused({}, { allowNavigation: true }), false);
});

test('only the fixed request headers reach the side', () => {
  const sent = forwardHeaders({ accept: 'text/html', 'accept-language': 'cs', 'user-agent': 'Browser', cookie: 'a=1', authorization: 'x', origin: 'o', referer: 'r', 'accept-encoding': 'gzip' }, { sideOrigin: 'https://www.example.com', userAgent: undefined });
  assert.deepEqual(sent, { host: 'www.example.com', 'accept-encoding': 'identity', accept: 'text/html', 'accept-language': 'cs', 'user-agent': 'Browser' });
  assert.equal(forwardHeaders({ 'user-agent': 'Browser' }, { sideOrigin: SIDE, userAgent: 'Side agent' })['user-agent'], 'Side agent');
});

test('a redirect to the side origin moves to the proxy origin; another origin stays', () => {
  const options = { sideOrigin: 'https://www.example.com', proxyOrigin: 'http://127.0.0.1:7000', requestUrl: '/a/' };
  assert.equal(rewriteLocation('https://www.example.com/b?c=1', options), 'http://127.0.0.1:7000/b?c=1');
  assert.equal(rewriteLocation('next', options), 'http://127.0.0.1:7000/a/next');
  assert.equal(rewriteLocation('https://login.example.org/', options), 'https://login.example.org/');
});

test('the response drops cookies and frame blocks and allows only the viewer as a frame parent', () => {
  const headers = responseHeaders({
    'set-cookie': ['a=1'], 'service-worker-allowed': '/', 'x-frame-options': 'DENY', 'transfer-encoding': 'chunked',
    'content-security-policy': "default-src 'self'; frame-ancestors 'none'", 'content-security-policy-report-only': 'frame-ancestors https://x.example',
    'content-length': '10', 'content-type': 'text/html',
  }, { sideOrigin: SIDE, proxyOrigin: 'http://127.0.0.1:7000', viewerOrigin: 'http://127.0.0.1:6000', requestUrl: '/', html: true, clearStorage: true });
  for (const name of ['set-cookie', 'service-worker-allowed', 'x-frame-options', 'transfer-encoding', 'content-length', 'content-security-policy-report-only']) assert.equal(Object.hasOwn(headers, name), false, name);
  assert.deepEqual(headers['content-security-policy'], ["default-src 'self'", 'frame-ancestors http://127.0.0.1:6000']);
  assert.equal(headers['clear-site-data'], '"storage"');
  const plain = responseHeaders({ 'content-length': '5' }, { sideOrigin: SIDE, proxyOrigin: 'p', viewerOrigin: 'v', requestUrl: '/', html: false, clearStorage: false });
  assert.equal(plain['content-length'], '5');
  assert.deepEqual(plain['content-security-policy'], ['frame-ancestors v']);
});

test('the script goes after the head tag, or first', () => {
  const tag = `<script src="${LIVE_SCRIPT_PATH}"></script>`;
  assert.equal(injectScript(Buffer.from('<html><HEAD lang="cs"><title>t</title>')).toString(), `<html><HEAD lang="cs">${tag}<title>t</title>`);
  assert.equal(injectScript(Buffer.from('<p>x</p>')).toString(), `${tag}<p>x</p>`);
  assert.equal(injectScript(Buffer.from('<header>x</header>')).toString(), `${tag}<header>x</header>`);
  assert.equal(injectScript(Buffer.from('<!DOCTYPE html><html lang="cs"><body>x')).toString(), `<!DOCTYPE html><html lang="cs">${tag}<body>x`);
  assert.equal(injectScript(Buffer.from('<!doctype html>\n<body>x')).toString(), `<!doctype html>${tag}\n<body>x`);
  assert.equal(injectScript(Buffer.from('<!DOCTYPE html><html><body><script>var s="<head>"</script>')).toString(), `<!DOCTYPE html><html>${tag}<body><script>var s="<head>"</script>`);
  assert.equal(injectScript(Buffer.from('<!-- c --><!DOCTYPE html><p>x')).toString(), `<!-- c --><!DOCTYPE html>${tag}<p>x`);
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  assert.deepEqual(injectScript(Buffer.concat([bom, Buffer.from('<p>x')])), Buffer.concat([bom, Buffer.from(`${tag}<p>x`)]));
  assert.deepEqual(injectScript(Buffer.concat([bom, Buffer.from('<!DOCTYPE html><p>x')])), Buffer.concat([bom, Buffer.from(`<!DOCTYPE html>${tag}<p>x`)]));
});

test('a status without a body is not an HTML page', () => {
  for (const code of [101, 204, 304]) assert.equal(isHtmlPage(code, { 'content-type': 'text/html' }), false, String(code));
  assert.equal(isHtmlPage(200, { 'content-type': 'text/html; charset=utf-8' }), true);
  assert.equal(isHtmlPage(404, { 'content-type': 'text/html' }), true);
  assert.equal(isHtmlPage(200, { 'content-type': 'text/plain' }), false);
});

test('the scroll script names the viewer origin as target and sender, and checks the ratio', () => {
  const script = liveScript('http://127.0.0.1:6000');
  assert.match(script, /const viewer = "http:\/\/127\.0\.0\.1:6000";/);
  assert.match(script, /event\.origin !== viewer \|\| event\.source !== window\.parent/);
  assert.match(script, /Number\.isFinite\(data\.ratio\) \|\| data\.ratio < 0 \|\| data\.ratio > 1/);
});

test('/live.json lists sides with a proxy, the path of each target on each side, and the viewports', () => {
  const config = {
    sides: { a: { origin: 'http://localhost:8080' }, b: { origin: 'https://www.example.com', remote: true }, d: { kind: 'design' } },
    targets: [{ id: 'home', path: '/' }, { id: 'old', path: '/old', paths: { b: null } }],
    viewports: [{ id: 'desktop', width: 1440, height: 900, extra: 1 }],
  };
  assert.deepEqual(liveIndex(config, { a: 'http://127.0.0.1:1', b: 'http://127.0.0.1:2' }), {
    sides: [{ id: 'a', origin: 'http://127.0.0.1:1' }, { id: 'b', origin: 'http://127.0.0.1:2' }],
    targets: [{ id: 'home', paths: { a: '/', b: '/' } }, { id: 'old', paths: { a: '/old', b: null } }],
    viewports: [{ id: 'desktop', width: 1440, height: 900 }],
  });
});

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((accept) => server.listen(0, '127.0.0.1', () => accept(server)));
}

function get(origin, path, headers = {}, method = 'GET') {
  const url = new URL(path, origin);
  return new Promise((accept, reject) => {
    const req = http.request(url, { method, headers: { host: url.host, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => accept({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('a proxy forwards to its side, adds the script once per HTML page and clears storage once', async () => {
  const seen = [];
  const side = await listen((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    if (req.url === '/move') { res.writeHead(302, { location: `http://127.0.0.1:${side.address().port}/home` }); res.end(); return; }
    if (req.url === '/away') { res.writeHead(302, { location: 'https://other.example/' }); res.end(); return; }
    if (req.url === '/data') { res.writeHead(200, { 'content-type': 'application/json', 'content-length': '2' }); res.end('{}'); return; }
    if (req.url === '/zip') { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); res.end('raw'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'a=1', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" });
    res.end('<html><head><title>x</title></head><body>ok</body></html>');
  });
  const sideOrigin = `http://127.0.0.1:${side.address().port}`;
  const live = await startLiveProxies({ sides: { a: { origin: sideOrigin }, d: { kind: 'design' } } }, { viewerOrigin: 'http://127.0.0.1:6000' });
  try {
    assert.deepEqual(Object.keys(live.origins), ['a']);
    const proxy = live.origins.a;
    const first = await get(proxy, '/page?x=1', { cookie: 'secret=1', authorization: 'Basic x', 'accept-encoding': 'gzip' });
    assert.equal(first.status, 200);
    assert.match(first.body, new RegExp(`<head><script src="${LIVE_SCRIPT_PATH}"></script><title>`));
    assert.equal(first.headers['content-length'], String(Buffer.byteLength(first.body)));
    assert.equal(first.headers['set-cookie'], undefined);
    assert.equal(first.headers['x-frame-options'], undefined);
    assert.equal(first.headers['content-security-policy'], 'frame-ancestors http://127.0.0.1:6000');
    assert.equal(first.headers['clear-site-data'], '"storage"');
    assert.equal(seen[0].url, '/page?x=1');
    assert.equal(seen[0].headers.host, new URL(sideOrigin).host);
    assert.equal(seen[0].headers.cookie, undefined);
    assert.equal(seen[0].headers.authorization, undefined);
    assert.equal(seen[0].headers['accept-encoding'], 'identity');
    const second = await get(proxy, '/page');
    assert.equal(second.headers['clear-site-data'], undefined);
    assert.equal((await get(proxy, '/move')).headers.location, `${proxy}/home`);
    assert.equal((await get(proxy, '/away')).headers.location, 'https://other.example/');
    const data = await get(proxy, '/data');
    assert.equal(data.body, '{}');
    assert.equal(data.headers['content-length'], '2');
    const zip = await get(proxy, '/zip');
    assert.equal(zip.body, 'raw');
    const script = await get(proxy, LIVE_SCRIPT_PATH);
    assert.equal(script.status, 200);
    assert.match(script.headers['content-type'], /^text\/javascript/);
    const count = seen.length;
    assert.equal((await get(proxy, '/', { host: 'localhost:1' })).status, 400);
    assert.equal((await get(proxy, '/', { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await get(proxy, '/', { 'service-worker': 'script' })).status, 403);
    assert.equal((await get(proxy, '/', {}, 'POST')).status, 405);
    assert.equal(seen.length, count, 'a refused request never reaches the side');
  } finally {
    await live.close();
    side.close();
  }
});

test('the limits hold: a large HTML page gives 502, a long stream is cut, a slow side gives 504', async () => {
  const side = await listen((req, res) => {
    if (req.url === '/big') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('x'.repeat(2000)); return; }
    if (req.url === '/stream') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(Buffer.alloc(5000)); return; }
    if (req.url === '/slow-body') { res.writeHead(200, { 'content-type': 'text/html' }); res.write('<p>'); return; }
    if (req.url === '/video') { res.writeHead(200, { 'content-type': 'video/mp4' }); res.write('a'); setTimeout(() => res.end('b'), 300); return; }
    // '/hang' never answers.
  });
  const live = await startLiveProxies({ sides: { a: { origin: `http://127.0.0.1:${side.address().port}` } } }, { viewerOrigin: 'http://127.0.0.1:6000', limits: { html: 1000, stream: 1000, timeoutMs: 150 } });
  try {
    const proxy = live.origins.a;
    const big = await get(proxy, '/big');
    assert.equal(big.status, 502);
    assert.equal(big.body, 'HTML_TOO_LARGE');
    await assert.rejects(get(proxy, '/stream'), 'a cut stream ends the connection');
    assert.equal((await get(proxy, '/hang')).status, 504);
    assert.equal((await get(proxy, '/slow-body')).status, 504);
    const video = await get(proxy, '/video');
    assert.equal(video.status, 200);
    assert.equal(video.body, 'ab', 'a streamed body may take longer than the header limit');
  } finally {
    await live.close();
    side.closeAllConnections();
    side.close();
  }
});

test('a client abort ends the side request and the proxy keeps working', async () => {
  let aborted;
  const gone = new Promise((accept) => { aborted = accept; });
  const side = await listen((req, res) => {
    if (req.url === '/ok') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
    req.socket.on('close', aborted);
  });
  const live = await startLiveProxies({ sides: { a: { origin: `http://127.0.0.1:${side.address().port}` } } }, { viewerOrigin: 'http://127.0.0.1:6000' });
  try {
    const url = new URL('/wait', live.origins.a);
    const request = http.request(url, { headers: { host: url.host } });
    request.on('error', () => {});
    request.end();
    await new Promise((accept) => setTimeout(accept, 100));
    request.destroy();
    await gone;
    assert.equal((await get(live.origins.a, '/ok')).body, 'ok');
  } finally {
    await live.close();
    side.close();
  }
});

test('a bodiless HTML response gets no script and does not spend the storage clear; a compressed page spends it', async () => {
  const side = await listen((req, res) => {
    if (req.url === '/empty') { res.writeHead(204, { 'content-type': 'text/html' }); res.end(); return; }
    if (req.url === '/zip') { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); res.end('raw'); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<p>x</p>');
  });
  const live = await startLiveProxies({ sides: { a: { origin: `http://127.0.0.1:${side.address().port}` } } }, { viewerOrigin: 'http://127.0.0.1:6000' });
  try {
    const empty = await get(live.origins.a, '/empty');
    assert.equal(empty.status, 204);
    assert.equal(empty.headers['content-length'], undefined);
    assert.equal(empty.headers['clear-site-data'], undefined);
    const zip = await get(live.origins.a, '/zip');
    assert.equal(zip.body, 'raw');
    assert.equal(zip.headers['clear-site-data'], '"storage"');
    assert.equal((await get(live.origins.a, '/')).headers['clear-site-data'], undefined);
  } finally {
    await live.close();
    side.close();
  }
});

test('a failed side gives 502 with the error code', async () => {
  const closed = await listen(() => {});
  const port = closed.address().port;
  await new Promise((accept) => closed.close(accept));
  const live = await startLiveProxies({ sides: { a: { origin: `http://127.0.0.1:${port}` } } }, { viewerOrigin: 'http://127.0.0.1:6000' });
  try {
    const response = await get(live.origins.a, '/');
    assert.equal(response.status, 502);
    assert.equal(response.body, 'ECONNREFUSED');
  } finally { await live.close(); }
});

test('serve --live checks the Host, refuses cross-site fetches, serves /live.json and allows the proxies as frames', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'test-kit-live-'));
  const reportPath = join(dir, 'report.json');
  await writeFile(reportPath, JSON.stringify({ schemaVersion: 1, rows: [] }));
  const side = await listen((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); });
  const config = { sides: { a: { origin: `http://127.0.0.1:${side.address().port}` } }, targets: [{ id: 'home', path: '/' }], viewports: [{ id: 'desktop', width: 1440, height: 900 }] };
  let plain;
  let live;
  try {
    plain = await serve({ reportPath });
    assert.equal(plain.live, undefined);
    assert.equal((await get(plain.origin, '/live.json')).status, 404);
    assert.equal((await get(plain.origin, '/report.json', { host: 'localhost:1' })).status, 200, 'a plain serve is as before');
    live = await serve({ reportPath, live: config });
    const index = await get(live.origin, '/live.json');
    assert.equal(index.status, 200);
    assert.deepEqual(JSON.parse(index.body).sides, [{ id: 'a', origin: live.live.a }]);
    assert.match(index.headers['content-security-policy'], new RegExp(`frame-src ${live.live.a}$`));
    assert.equal((await get(live.origin, '/report.json', { host: 'localhost:1' })).status, 400);
    assert.equal((await get(live.origin, '/report.json', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' })).status, 403);
    assert.notEqual((await get(live.origin, '/', { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' })).status, 403);
    await assert.rejects(serve({ reportPath, host: 'localhost', live: config }), /127\.0\.0\.1/);
  } finally {
    await plain?.close();
    await live?.close();
    side.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the command line takes --live as a flag and --config with it', () => {
  assert.deepEqual(parseCommand(['serve', 'report.json', '--live', '--config', 'c.json']).options, { live: true, config: 'c.json' });
  assert.deepEqual(parseCommand(['serve', 'report.json']).options, {});
});
