// Browser check for `allowOrigins` on a local side (R3.9, issue #251).
// A local side loads a stylesheet and a font from a named third-party HTTPS origin.
// The capture verifies the certificate of that origin although the local context ignores errors.
// The script runs itself twice: once with the test certificate trusted, once without it.
// A loopback host counts as local, so the third-party origins use a non-loopback address of this machine.
// A machine without one skips the check. The trusted run adds the test certificate with NODE_EXTRA_CA_CERTS.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { execFileSync, execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ADDRESS = Object.values(networkInterfaces()).flat().find(item => item && item.family === 'IPv4' && !item.internal)?.address;
const here = fileURLToPath(import.meta.url);

if (process.env.ALLOW_ORIGINS_CHILD) {
  const { capture } = await import('../../src/capture/index.js');
  const trusted = process.env.ALLOW_ORIGINS_CHILD === 'trusted';
  const { key, cert, directory } = JSON.parse(process.env.ALLOW_ORIGINS_PARAMS);
  const hits = [];
  const tls = { key: readFileSync(key), cert: readFileSync(cert) };
  const otherHost = createSecureServer(tls, (request, response) => { hits.push(`other${request.url}`); response.setHeader('Content-Type', 'text/css'); response.end(''); });
  await new Promise(resolve => otherHost.listen(0, '0.0.0.0', resolve));
  const otherOrigin = `https://${ADDRESS}:${otherHost.address().port}`;
  const fontHost = createSecureServer(tls, (request, response) => {
    hits.push(`font${request.url}`);
    if (request.url === '/a.css') { response.setHeader('Content-Type', 'text/css'); response.end(`@font-face{font-family:Ex;src:url(https://${ADDRESS}:${fontHost.address().port}/f.woff2)}`); return; }
    if (request.url === '/r.css') { response.writeHead(302, { Location: `${otherOrigin}/a.css` }); response.end(); return; }
    if (request.url === '/f.woff2') { response.setHeader('Content-Type', 'font/woff2'); response.end(Buffer.alloc(32)); return; }
    response.statusCode = 404; response.end();
  });
  await new Promise(resolve => fontHost.listen(0, '0.0.0.0', resolve));
  const fontOrigin = `https://${ADDRESS}:${fontHost.address().port}`;
  const local = createServer((request, response) => {
    const bodies = {
      '/': '',
      '/font': `<link rel="stylesheet" href="${fontOrigin}/a.css"><p style="font-family:Ex,serif">Hello</p>`,
      '/redirect': `<link rel="stylesheet" href="${fontOrigin}/r.css">`,
      '/script': `<script src="${fontOrigin}/a.js"></script>`,
      '/other': `<link rel="stylesheet" href="${otherOrigin}/a.css">`,
    };
    response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><body><h1>Example site</h1>${bodies[request.url] ?? ''}</body>`);
  });
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  try {
    const targets = ['home', 'font', 'redirect', 'script', 'other'].map(id => ({ id, kind: 'page', title: id, path: id === 'home' ? '/' : `/${id}` }));
    const base = { schemaVersion: 1, targets, viewports: [{ id: 'desktop', width: 400, height: 300 }], artifacts: ['screenshot', 'status'], checks: [], runsRoot: 'runs', screenshot: { timeoutMs: 5000 } };
    const side = list => ({ local: { origin: `http://127.0.0.1:${local.address().port}`, settle: { waitMs: 100 }, ...(list ? { allowOrigins: list } : {}) } });
    const configPath = join(directory, `config-${process.env.ALLOW_ORIGINS_CHILD}.json`);
    const run = async list => {
      await writeFile(configPath, JSON.stringify({ ...base, sides: side(list) }));
      const { run: result } = await capture({ configPath, side: 'local' });
      return id => result.captures.find(row => row.targetId === id);
    };
    // Without the list a local side blocks the request, as before.
    const plain = await run(null);
    assert.equal(plain('font').state, 'failed');
    assert.equal(plain('font').error.code, 'LOCAL_NAVIGATION_REQUIRED');
    assert.equal(hits.length, 0, 'no request reaches the font host without the list');
    const row = await run([{ origin: fontOrigin, types: ['stylesheet', 'font'] }]);
    assert.equal(row('home').state, 'captured');
    assert.equal(row('script').state, 'failed', 'a script is not on the list of types');
    assert.equal(row('other').state, 'failed', 'an origin that is not named stays blocked');
    if (trusted) {
      assert.equal(row('font').state, 'captured', JSON.stringify(row('font')));
      assert.ok(hits.includes('font/a.css') && hits.includes('font/f.woff2'), `the stylesheet and the font load: ${hits}`);
      assert.equal(row('redirect').state, 'failed', 'a redirect to an origin that is not named fails the capture');
      assert.equal(row('redirect').error.code, 'LOCAL_NAVIGATION_REQUIRED');
      assert.ok(!hits.some(hit => hit.startsWith('other')), 'the redirect target receives no request');
    } else {
      assert.equal(hits.length, 0, `the capture verifies the certificate, so no request completes: ${hits}`);
      assert.equal(row('font').state, 'failed', 'a certificate failure of an allowed origin fails the capture');
      assert.match(row('font').error.message, /certificate of an allowed origin/);
      assert.ok(row('font').error.message.includes(fontOrigin) && row('font').error.message.includes('stylesheet'), row('font').error.message);
    }
    console.log(`Local side with allowOrigins (${process.env.ALLOW_ORIGINS_CHILD} certificate) passes.`);
  } finally {
    await new Promise(resolve => { local.close(resolve); local.closeAllConnections(); });
    await new Promise(resolve => { fontHost.close(resolve); fontHost.closeAllConnections(); });
    await new Promise(resolve => { otherHost.close(resolve); otherHost.closeAllConnections(); });
  }
  process.exit(0);
}

if (!ADDRESS) { console.log('allowOrigins check skipped: no non-loopback IPv4 address.'); process.exit(0); }
const directory = await mkdtemp(join(tmpdir(), 'test-kit-allow-'));
try {
  const key = join(directory, 'key.pem');
  const cert = join(directory, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=example-site',
    '-addext', `subjectAltName=IP:${ADDRESS}`], { stdio: 'ignore' });
  for (const mode of ['trusted', 'untrusted']) {
    const env = { ...process.env, ALLOW_ORIGINS_CHILD: mode, ALLOW_ORIGINS_PARAMS: JSON.stringify({ key, cert, directory }), ...(mode === 'trusted' ? { NODE_EXTRA_CA_CERTS: cert } : {}) };
    if (mode === 'untrusted') delete env.NODE_EXTRA_CA_CERTS;
    try {
      const { stdout } = await promisify(execFile)(process.execPath, [here], { env, timeout: 120000 });
      process.stdout.write(stdout);
    } catch (error) { process.stderr.write(`${mode} run failed:\n${error.stderr}\n${error.stdout ?? ''}`); throw error; }
  }
  console.log('allowOrigins passes: a local side loads a stylesheet and a font from a named origin, verifies its certificate, and fails on a redirect to an origin that is not named.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
