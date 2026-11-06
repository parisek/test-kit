import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { normalizeConfig, settingsHash } from '../../src/config/index.js';
import { fileKeyProblem, nodeIdProblem, imageUrlProblem, tokenProblem, figmaScale } from '../../src/design/figma-ids.js';
import { importDesign } from '../../src/design/import.js';
import { readToken, downloadFigmaImages, FigmaError } from '../../src/design/figma.js';
import { sha256 } from '../../src/design/png.js';
import { parseCommand } from '../../src/cli/run.js';

const TOKEN = 'figd_SECRET-token-value-123';
const KEY = 'AbCdEf123456789012WxYz';

function png(width, height, [r, g, b]) {
  const image = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) { image.data[i * 4] = r; image.data[i * 4 + 1] = g; image.data[i * 4 + 2] = b; image.data[i * 4 + 3] = 255; }
  return PNG.sync.write(image);
}

const figmaConfig = () => ({ schemaVersion: 1,
  sides: { design: { kind: 'design', provider: 'figma', fileKey: KEY }, local: { origin: 'http://localhost:8080' } },
  targets: [
    { id: 'hero', kind: 'component', path: '/hero', design: { desktop: '1:2', mobile: '1:3' } },
    { id: 'card', kind: 'component', path: '/card', design: { desktop: 'I5:6;7:8' } },
  ],
  viewports: [{ id: 'desktop', width: 40, height: 30 }, { id: 'mobile', width: 20, height: 30, deviceScaleFactor: 2 }], runsRoot: 'runs' });

// A mock of the Figma API and its image storage on 127.0.0.1. It records every request, headers included.
async function mock(handlers = {}) {
  const log = [];
  const images = { '1:2': png(40, 20, [1, 2, 3]), '1:3': png(40, 20, [4, 5, 6]), 'I5:6;7:8': png(40, 20, [7, 8, 9]) };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    log.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers });
    if (handlers.any) return handlers.any(req, res, url, base());
    if (url.pathname === `/v1/images/${KEY}`) {
      const ids = url.searchParams.get('ids').split(',');
      if (handlers.api) return handlers.api(req, res, url, ids, base());
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ err: null, images: Object.fromEntries(ids.map(id => [id, `${base()}/img/${encodeURIComponent(id)}`])) }));
    }
    if (url.pathname.startsWith('/img/')) {
      if (handlers.image) return handlers.image(req, res, decodeURIComponent(url.pathname.slice(5)));
      res.setHeader('content-type', 'image/png');
      return res.end(images[decodeURIComponent(url.pathname.slice(5))]);
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const base = () => `http://127.0.0.1:${server.address().port}`;
  const hooks = { apiBase: base(), imageUrlProblem: () => null };
  return { log, base, hooks, images, close: () => new Promise(done => { server.closeAllConnections(); server.close(done); }) };
}

async function project(config = figmaConfig()) {
  const dir = await mkdtemp(join(tmpdir(), 'tk-figma-'));
  const configPath = join(dir, 'config.json');
  await writeFile(configPath, JSON.stringify(config));
  return { dir, configPath };
}

async function allText(dir) {
  const out = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) if (entry.isFile() && !entry.name.endsWith('.png')) out.push(await readFile(join(entry.parentPath ?? entry.path, entry.name), 'utf8'));
  return out.join('\n');
}

test('figma ids: file key, node ID, token and image URL are plain safe values (R5.5, R4.4)', () => {
  assert.equal(fileKeyProblem(KEY), null);
  for (const bad of ['', 'short', 'has space12345', 'a/b/c/d/e/f/g/h', '../etc/passwd', 'a?b=c&d=eeeeeee', 7, null, 'x'.repeat(65)]) assert.notEqual(fileKeyProblem(bad), null, String(bad));
  for (const ok of ['1:2', '123:456', 'I5:6;7:8', 'I12:34;56:78;9:10']) assert.equal(nodeIdProblem(ok), null, ok);
  for (const bad of ['', '12', '12-34', '1:2,3:4', '1:2&format=svg', '1:2/../x', '1:2 ', '1:2\n', ':2', '1:', ';1:2', '1:2;', '%31:2', 'x'.repeat(101), 5, null]) assert.notEqual(nodeIdProblem(bad), null, JSON.stringify(bad));
  assert.equal(tokenProblem(TOKEN), null);
  for (const bad of ['', 'a b', 'a\nb', 'a\r\nX-Evil: 1', 'é', 'x'.repeat(513), 5]) assert.notEqual(tokenProblem(bad), null, JSON.stringify(bad));
  assert.equal(imageUrlProblem('https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/abc?X-Amz-Signature=1'), null);
  assert.equal(imageUrlProblem('https://s3-alpha.figma.com/img/a'), null);
  for (const bad of ['http://figma-alpha-api.s3.us-west-2.amazonaws.com/a', 'https://evil.example/a', 'https://figma.com.evil.example/a', 'https://user:pw@s3-alpha.figma.com/a', 'https://s3-alpha.figma.com:8443/a', 'https://127.0.0.1/a', 'https://evilfigma.com/a', 'https://other-bucket.s3.us-west-2.amazonaws.com/a', 'file:///etc/passwd', 'not a url', 7]) assert.notEqual(imageUrlProblem(bad), null, String(bad));
  assert.equal(figmaScale({ id: 'a' }), 1);
  assert.equal(figmaScale({ id: 'a', deviceScaleFactor: 2 }), 2);
});

test('config: the figma side takes a file key only, and the token has no key (R5.5)', () => {
  const side = extra => ({ ...figmaConfig(), sides: { design: { kind: 'design', provider: 'figma', fileKey: KEY, ...extra }, local: { origin: 'http://localhost:8080' } } });
  const config = normalizeConfig(figmaConfig());
  assert.deepEqual(config.sides.design, { kind: 'design', provider: 'figma', fileKey: KEY });
  assert.deepEqual(config.targets[0].design, { desktop: '1:2', mobile: '1:3' });
  assert.throws(() => normalizeConfig(side({ token: TOKEN })), /token is unsupported/);
  assert.throws(() => normalizeConfig(side({ token: TOKEN })), error => !error.message.includes(TOKEN));
  for (const key of ['apiBase', 'endpoint', 'baseUrl', 'url', 'scale', 'headers']) assert.throws(() => normalizeConfig(side({ [key]: 'https://evil.example' })), /is unsupported/, key);
  assert.throws(() => normalizeConfig(side({ root: 'refs' })), /root is unsupported/);
  assert.throws(() => normalizeConfig(side({ fileKey: undefined })), /fileKey must be a Figma file key/);
  assert.throws(() => normalizeConfig(side({ fileKey: '../x' })), /fileKey must be a Figma file key/);
  assert.throws(() => normalizeConfig(side({ provider: 'other' })), /provider must be "files" or "figma"/);
  const files = { ...figmaConfig(), sides: { design: { kind: 'design', provider: 'files', root: 'refs', fileKey: KEY } } };
  assert.throws(() => normalizeConfig(files), /fileKey is unsupported/);
});

test('config: target.design holds node IDs for figma and paths for files, and providers do not mix (R5.5)', () => {
  const withMap = design => ({ ...figmaConfig(), targets: [{ id: 'hero', kind: 'component', path: '/hero', design }] });
  assert.throws(() => normalizeConfig(withMap({ desktop: 'hero/desktop.png' })), /target\.design\.desktop must be a Figma node ID/);
  assert.throws(() => normalizeConfig(withMap({ desktop: '1:2&format=svg' })), /must be a Figma node ID/);
  assert.throws(() => normalizeConfig(withMap({ desktop: '12-34' })), /must be a Figma node ID/);
  const files = { ...figmaConfig(), sides: { design: { kind: 'design', provider: 'files', root: 'refs' } } };
  assert.throws(() => normalizeConfig(files), /target\.design\.desktop must be a plain relative path/);
  const mixed = { ...figmaConfig(), sides: { a: { kind: 'design', provider: 'figma', fileKey: KEY }, b: { kind: 'design', provider: 'files', root: 'refs' } } };
  assert.throws(() => normalizeConfig(mixed), /one provider/);
});

test('token: it comes from the environment only, and a missing or odd token fails before any request (R5.5)', async () => {
  assert.throws(() => readToken({}), error => error instanceof FigmaError && error.code === 'FIGMA_TOKEN_MISSING' && /FIGMA_TOKEN/.test(error.message));
  assert.throws(() => readToken({ FIGMA_TOKEN: '' }), /FIGMA_TOKEN_MISSING|environment variable/);
  const odd = 'bad token\nwith newline';
  assert.throws(() => readToken({ FIGMA_TOKEN: odd }), error => error.code === 'FIGMA_TOKEN_INVALID' && !error.message.includes('bad token'));
  const server = await mock();
  const { dir, configPath } = await project();
  try {
    await assert.rejects(importDesign({ configPath, side: 'design', env: {}, figma: server.hooks }), error => error.code === 'FIGMA_TOKEN_MISSING');
    await assert.rejects(importDesign({ configPath, side: 'design', env: { FIGMA_TOKEN: odd }, figma: server.hooks }), error => error.code === 'FIGMA_TOKEN_INVALID');
    assert.equal(server.log.length, 0, 'No request was made.');
    await assert.rejects(readdir(join(dir, 'runs')), /ENOENT/, 'No run directory exists.');
  } finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('import: figma writes a run with provenance, sends the token to the API only, and uses the viewport scale (R4.6, R5.5)', async () => {
  const server = await mock();
  const { dir, configPath } = await project();
  try {
    const { run, runDir } = await importDesign({ configPath, side: 'design', label: 'refs', env: { FIGMA_TOKEN: TOKEN }, figma: server.hooks });
    assert.equal(run.state, 'complete');
    assert.equal(run.captures.length, 4 - 1, 'hero desktop, hero mobile, card desktop');
    assert.deepEqual(run.settings.artifacts, ['screenshot']);
    assert.equal(run.settingsHash, settingsHash({ provider: 'figma', viewports: run.settings.viewports }));
    const hero = run.captures.find(row => row.targetId === 'hero' && row.viewportId === 'desktop');
    assert.equal(hero.design.sha256, sha256(await readFile(join(runDir, hero.path))));
    assert.deepEqual({ ...hero.design, importedAt: undefined, sha256: undefined }, { provider: 'figma', source: '1:2', fileKey: KEY, scale: 1, importedAt: undefined, sha256: undefined, width: 40, height: 20 });
    const mobile = run.captures.find(row => row.targetId === 'hero' && row.viewportId === 'mobile');
    assert.equal(mobile.design.scale, 2);
    assert.equal(mobile.design.source, '1:3');
    // One API call for each distinct scale, ids joined, format png.
    const api = server.log.filter(entry => entry.path.startsWith('/v1/images/'));
    assert.deepEqual(api.map(entry => entry.query.scale).sort(), ['1', '2']);
    assert.ok(api.every(entry => entry.query.format === 'png'));
    assert.ok(api.every(entry => entry.headers['x-figma-token'] === TOKEN), 'The API gets the token.');
    const storage = server.log.filter(entry => entry.path.startsWith('/img/'));
    assert.equal(storage.length, 3);
    for (const entry of storage) {
      assert.equal(entry.headers['x-figma-token'], undefined, 'The image storage gets no token.');
      assert.equal(entry.headers.authorization, undefined);
      assert.equal(entry.headers.cookie, undefined);
    }
    // The token is nowhere in the run, the config copy, or any file under the project.
    assert.equal((await allText(dir)).includes(TOKEN), false);
    assert.equal(JSON.stringify(run).includes(TOKEN), false);
  } finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('import: a design image is stored as received and never resized, with its real width recorded (R8.15)', async () => {
  const server = await mock();
  const { dir, configPath } = await project();
  try {
    const { run, runDir } = await importDesign({ configPath, side: 'design', env: { FIGMA_TOKEN: TOKEN }, figma: server.hooks });
    const mobile = run.captures.find(row => row.viewportId === 'mobile');
    assert.deepEqual([mobile.width, mobile.height], [40, 20], 'Mobile needs 40 px (20 x 2). The mock returned 40 px, so it fits.');
    assert.deepEqual(await readFile(join(runDir, mobile.path)), server.images['1:3'], 'The bytes are the bytes that Figma sent.');
    const hero = run.captures.find(row => row.targetId === 'hero' && row.viewportId === 'desktop');
    assert.equal(hero.width, 40);
    // A frame with the wrong width in Figma gives an incompatible cell with both sizes named.
    server.images['1:2'] = png(41, 20, [1, 1, 1]);
    const second = await importDesign({ configPath, side: 'design', env: { FIGMA_TOKEN: TOKEN }, figma: server.hooks, targets: ['hero'], viewports: ['desktop'] });
    assert.equal(second.run.captures[0].width, 41);
    assert.equal(second.run.captures[0].design.width, 41);
  } finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('import: a failed request fails the import before a run exists (R5.5)', async () => {
  const cases = [
    ['API 403', { api: (req, res) => { res.statusCode = 403; res.end(JSON.stringify({ status: 403, err: `Forbidden for ${TOKEN}` })); } }, /answered 403/],
    ['API 429', { api: (req, res) => { res.statusCode = 429; res.setHeader('retry-after', '17'); res.end('{}'); } }, /answered 429.*Retry after 17 s/],
    ['API redirect', { api: (req, res, url, ids, base) => { res.statusCode = 302; res.setHeader('location', `${base}/elsewhere`); res.end(); } }, /redirect/],
    ['API err field', { api: (req, res) => res.end(JSON.stringify({ err: 'Not found', images: {} })) }, /reported an error \(Not found\)/],
    ['API not JSON', { api: (req, res) => res.end('<html>') }, /not an object/],
    ['no images map', { api: (req, res) => res.end(JSON.stringify({ err: null })) }, /without an images map/],
    ['null image (render failed)', { api: (req, res, url, ids) => res.end(JSON.stringify({ err: null, images: Object.fromEntries(ids.map(id => [id, null])) })) }, /rendered no image for node/],
    ['image 404', { image: (req, res) => { res.statusCode = 404; res.end(); } }, /image download for node .* answered 404/],
    ['image redirect', { image: (req, res, id) => { res.statusCode = 301; res.setHeader('location', 'http://169.254.169.254/'); res.end(); } }, /redirect/],
    ['image not a PNG', { image: (req, res) => res.end('this is not a png but it is long enough to pass a length check') }, /must be a PNG file/],
  ];
  for (const [name, handlers, pattern] of cases) {
    const server = await mock(handlers);
    const { dir, configPath } = await project();
    try {
      await assert.rejects(importDesign({ configPath, side: 'design', env: { FIGMA_TOKEN: TOKEN }, figma: server.hooks }), error => pattern.test(error.message) && !error.message.includes(TOKEN) && !String(error.stack).includes(TOKEN), name);
      assert.equal((await readdir(join(dir, 'runs')).catch(() => [])).length, 0, `${name}: no run directory`);
    } finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
  }
});

test('import: an image URL off the host list is refused before any download (R5.5)', async () => {
  const server = await mock({ api: (req, res, url, ids) => res.end(JSON.stringify({ err: null, images: Object.fromEntries(ids.map(id => [id, 'https://evil.example/steal'])) })) });
  const { dir, configPath } = await project();
  try {
    // The default policy applies: only the API base is a test hook here.
    await assert.rejects(importDesign({ configPath, side: 'design', env: { FIGMA_TOKEN: TOKEN }, figma: { apiBase: server.hooks.apiBase } }), error => error.code === 'FIGMA_IMAGE_URL' && !error.message.includes('evil.example'));
    assert.equal(server.log.filter(entry => entry.path.startsWith('/img/')).length, 0);
    // The default policy refuses a plain http URL to the mock itself.
    const plain = await mock();
    try {
      await assert.rejects(importDesign({ configPath, side: 'design', env: { FIGMA_TOKEN: TOKEN }, figma: { apiBase: plain.base() } }), error => error.code === 'FIGMA_IMAGE_URL');
      assert.equal(plain.log.filter(entry => entry.path.startsWith('/img/')).length, 0);
    } finally { await plain.close(); }
  } finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('download: size and count caps hold, and a hanging server times out (R5.5)', async () => {
  const big = await mock({ image: (req, res) => { res.setHeader('content-type', 'image/png'); res.write(Buffer.alloc(1024 * 1024, 1)); res.write(Buffer.alloc(1024 * 1024, 1)); res.end(); } });
  try {
    // Call the downloader with a small cap by faking a body larger than the API cap instead of sending 40 MiB.
    const api = await mock({ api: (req, res) => { res.setHeader('content-type', 'application/json'); res.write('{"err":null,"images":{"1:2":"'); res.write('a'.repeat(2 * 1024 * 1024)); res.end('"}}'); } });
    try {
      await assert.rejects(downloadFigmaImages({ fileKey: KEY, requests: [{ nodeId: '1:2', scale: 1 }], token: TOKEN, apiBase: api.base(), imageUrlProblem: () => null }), error => error.code === 'FIGMA_TOO_LARGE');
    } finally { await api.close(); }
    const declared = await mock({ image: (req, res) => { res.setHeader('content-length', String(50 * 1024 * 1024)); res.write(Buffer.alloc(10)); setTimeout(() => res.destroy(), 50); } });
    try {
      await assert.rejects(downloadFigmaImages({ fileKey: KEY, requests: [{ nodeId: '1:2', scale: 1 }], token: TOKEN, apiBase: declared.base(), imageUrlProblem: () => null }), error => error.code === 'FIGMA_TOO_LARGE');
    } finally { await declared.close(); }
    const many = Array.from({ length: 101 }, (_, i) => ({ nodeId: `1:${i}`, scale: 1 }));
    await assert.rejects(downloadFigmaImages({ fileKey: KEY, requests: many, token: TOKEN, apiBase: big.base(), imageUrlProblem: () => null }), error => error.code === 'FIGMA_TOO_MANY');
    assert.equal(big.log.length, 0, 'The count cap fails before any request.');
    const hang = await mock({ api: () => {} });
    try {
      await assert.rejects(downloadFigmaImages({ fileKey: KEY, requests: [{ nodeId: '1:2', scale: 1 }], token: TOKEN, apiBase: hang.base(), imageUrlProblem: () => null, apiTimeoutMs: 100 }), error => error.code === 'FIGMA_TIMEOUT');
    } finally { await hang.close(); }
    const hangImage = await mock({ image: () => {} });
    try {
      await assert.rejects(downloadFigmaImages({ fileKey: KEY, requests: [{ nodeId: '1:2', scale: 1 }], token: TOKEN, apiBase: hangImage.base(), imageUrlProblem: () => null, imageTimeoutMs: 100 }), error => error.code === 'FIGMA_TIMEOUT');
    } finally { await hangImage.close(); }
  } finally { await big.close(); }
});

test('download: a network failure names a code and never the token or a URL (R5.5)', async () => {
  const server = await mock();
  const apiBase = server.base();
  await server.close();
  await assert.rejects(downloadFigmaImages({ fileKey: KEY, requests: [{ nodeId: '1:2', scale: 1 }], token: TOKEN, apiBase, imageUrlProblem: () => null }), error => error.code === 'FIGMA_NETWORK' && !error.message.includes(TOKEN) && !error.message.includes('127.0.0.1'));
});

test('download: the API request goes to the fixed host by default and follows no redirect (R5.5)', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ err: null, images: { '1:2': 'https://s3-alpha.figma.com/a' } }), { status: 200 }); };
  await downloadFigmaImages({ fileKey: KEY, requests: [{ nodeId: '1:2', scale: 1.5 }], token: TOKEN, fetchImpl });
  assert.equal(calls[0].url.startsWith(`https://api.figma.com/v1/images/${KEY}?ids=1%3A2&format=png&scale=1.5`), true);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.headers['X-Figma-Token'], TOKEN);
  assert.ok(calls[0].init.signal, 'A timeout signal is set.');
  assert.equal(calls[1].init.headers['X-Figma-Token'], undefined, 'The image request gets no token.');
  assert.equal(calls[1].init.redirect, 'manual');
});

test('cli: no option sets an endpoint or a token, and the command reads the token from the environment (R5.5)', () => {
  for (const flag of ['--api-base', '--token', '--figma-token', '--endpoint']) assert.throws(() => parseCommand(['import', '--side', 'design', flag, 'x']), /Unknown option/, flag);
});
