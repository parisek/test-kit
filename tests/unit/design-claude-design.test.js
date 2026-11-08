// R4.6, R5.5: the `claude-design` provider. Pure guards, the export checks, the loopback server and the import
// wiring with a stub browser. No real browser and no network: the server binds 127.0.0.1 only.
// The real render runs in tests/integration/check-design-claude-design.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rm, cp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { PNG } from 'pngjs';
import { normalizeConfig, designSettings, settingsHash } from '../../src/config/index.js';
import { parseArtboardRef, artboardRefProblem, servedPathProblem, contentType, captureClip, chromiumArgs, RENDER_STATE, NO_SOCKETS_SCRIPT, NETWORK_GLOBALS } from '../../src/design/claude-design-refs.js';
import { prepareCanvas, startCanvasServer, tokenMatches, readProjectFile, CHROMIUM_ARGS } from '../../src/design/claude-design.js';
import { importDesign } from '../../src/design/import.js';
import { sha256 } from '../../src/design/png.js';

const FIXTURE = new URL('../fixtures/claude-design/', import.meta.url);

const config = (design = { desktop: 'Example.dc.html', mobile: 'Example.dc.html##hero' }) => ({ schemaVersion: 1,
  sides: { design: { kind: 'design', provider: 'claude-design', root: 'canvas' }, local: { origin: 'http://localhost:8080' } },
  targets: [{ id: 'hero', kind: 'component', path: '/hero', design }],
  viewports: [{ id: 'desktop', width: 40, height: 30 }, { id: 'mobile', width: 20, height: 30, deviceScaleFactor: 2 }], runsRoot: 'runs' });

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), 'test-kit-claude-design-'));
  await cp(FIXTURE, join(directory, 'canvas'), { recursive: true });
  return directory;
}

test('artboard reference: a path with an optional selector after the first "#" (R5.5)', () => {
  assert.deepEqual(parseArtboardRef('Example.dc.html'), { artboard: 'Example.dc.html', selector: null });
  assert.deepEqual(parseArtboardRef('Example.dc.html#hero'), { artboard: 'Example.dc.html', selector: 'hero' });
  assert.deepEqual(parseArtboardRef('Example.dc.html##hero'), { artboard: 'Example.dc.html', selector: '#hero' });
  assert.deepEqual(parseArtboardRef('Example.dc.html#.md\\:flex > a[href="#x"]'), { artboard: 'Example.dc.html', selector: '.md\\:flex > a[href="#x"]' });
  const bad = ['', 'Example.html', 'Example.dc.htm', '.dc.html', 'a/.dc.html', 'boards/Example.dc.html', '../Example.dc.html', '/Example.dc.html', 'a//Example.dc.html', './Example.dc.html',
    'a\\Example.dc.html', 'Example.dc.html#', 'Example.dc.html#   ', `Example.dc.html#${'a'.repeat(2049)}`, 'Example.dc.html#a\u0000b', 'Ex ample.dc.html', '.hidden.dc.html',
    `${'a/'.repeat(200)}Example.dc.html`, 7, null, undefined, {}];
  for (const value of bad) assert.notEqual(artboardRefProblem(value), null, JSON.stringify(value));
  assert.equal(artboardRefProblem('Example.dc.html##hero'), null);
});

test('served path: decoded, and every escape form is refused before the file system (R5.5)', () => {
  assert.deepEqual(servedPathProblem('/Example.dc.html'), { path: 'Example.dc.html' });
  assert.deepEqual(servedPathProblem('/ds/Font%20Name.woff2'), { path: 'ds/Font Name.woff2' });
  for (const bad of ['/', '//x', '/a//b', '/..', '/%2e%2e/x', '/a/%2E%2E/b', '/.', '/.env', '/a/.git/config', '/a%2fb', '/a%5cb', '/a%00b', '/%E0%A4%A', 'x', '', `/${'a'.repeat(1100)}`, 5])
    assert.ok(servedPathProblem(bad).problem, JSON.stringify(bad));
});

test('content type: by extension, opaque bytes otherwise', () => {
  assert.equal(contentType('Example.dc.html'), 'text/html; charset=utf-8');
  assert.equal(contentType('support.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentType('ds/a.WOFF2'), 'font/woff2');
  assert.equal(contentType('canvas'), 'application/octet-stream');
});

test('clip: a band at x = 0, the viewport wide, so the image width is viewport x scale (R8.15)', () => {
  assert.deepEqual(captureClip(1280, { top: 0, bottom: 900 }), { x: 0, y: 0, width: 1280, height: 900 });
  assert.deepEqual(captureClip(390, { top: 10.6, bottom: 70.2 }), { x: 0, y: 10, width: 390, height: 61 });
  assert.deepEqual(captureClip(390, { top: -5, bottom: 20 }), { x: 0, y: 0, width: 390, height: 20 });
  assert.equal(captureClip(390, { top: 10, bottom: 10 }), null);
  assert.equal(captureClip(390, { top: Number.NaN, bottom: 10 }), null);
});

test('server token: equal length and equal bytes only (R4.6)', () => {
  const token = 'a'.repeat(32);
  assert.equal(tokenMatches(token, token), true);
  for (const value of ['', 'a'.repeat(31), 'a'.repeat(33), `${'a'.repeat(31)}b`, 'A'.repeat(32), undefined]) assert.equal(tokenMatches(value, token), false, String(value));
});

test('socket removal: every listed WebRTC and WebTransport interface becomes undefined and cannot be put back (R4.6)', () => {
  const scope = {};
  for (const name of NETWORK_GLOBALS) scope[name] = function Interface() {};
  new Function('globalThis', NO_SOCKETS_SCRIPT)(scope);
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCIceTransport', 'RTCSctpTransport', 'WebTransport', 'WebSocketStream']) assert.ok(NETWORK_GLOBALS.includes(name), name);
  for (const name of NETWORK_GLOBALS) {
    assert.equal(scope[name], undefined, name);
    const descriptor = Object.getOwnPropertyDescriptor(scope, name);
    assert.equal(descriptor.writable, false, name);
    assert.equal(descriptor.configurable, false, name);
  }
  assert.ok(Object.isFrozen(NETWORK_GLOBALS));
});

test('project file: reads a regular file and refuses a directory and a missing file (R5.5)', async () => {
  const directory = await workspace();
  try {
    const project = await realpath(join(directory, 'canvas/project'));
    assert.match((await readProjectFile(project, 'Example.dc.html', 'artboard')).toString(), /<x-dc>/);
    await assert.rejects(readProjectFile(project, 'ds', 'file'), /not a regular file/);
    await assert.rejects(readProjectFile(project, 'Missing.dc.html', 'artboard'), /artboard is missing/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('browser switches: a proxy that closes every connection, bypassed for the import server only (R4.6)', () => {
  assert.deepEqual(chromiumArgs(4100, 4200), [...CHROMIUM_ARGS, '--proxy-server=http://127.0.0.1:4200', '--proxy-bypass-list=<-loopback>;http://127.0.0.1:4100', '--disable-features=WebTransport']);
  for (const [server, proxy] of [[0, 4200], [4100, 70000], ['4100', 4200], [4100, 1.5], [4100, Number.NaN]]) assert.throws(() => chromiumArgs(server, proxy), /TCP port number/);
});

test('render state and Chromium switches are fixed text, not configuration', () => {
  assert.match(RENDER_STATE, /innerText\.includes\('\{\{'\)/);
  assert.match(RENDER_STATE, /x-import/);
  assert.ok(CHROMIUM_ARGS.some(arg => arg.startsWith('--host-resolver-rules=MAP * ~NOTFOUND')));
  assert.ok(Object.isFrozen(CHROMIUM_ARGS));
});

test('config: a claude-design side and artboard references normalize (R5.5)', () => {
  const result = normalizeConfig(config());
  assert.deepEqual(result.sides.design, { kind: 'design', provider: 'claude-design', root: 'canvas' });
  assert.deepEqual(result.targets[0].design, { desktop: 'Example.dc.html', mobile: 'Example.dc.html##hero' });
  // The settings hash binds the provider, so a claude-design run never shares a hash with a files run.
  const files = normalizeConfig({ ...config({ desktop: 'a.png' }), sides: { design: { kind: 'design', provider: 'files', root: 'canvas' }, local: { origin: 'http://localhost:8080' } } });
  assert.notEqual(settingsHash(designSettings(result, 'design')), settingsHash(designSettings(files, 'design')));
});

test('config: a claude-design side refuses other keys, bad roots, bad references and a mix of providers (R5.5)', () => {
  const side = extra => ({ ...config(), sides: { design: { kind: 'design', provider: 'claude-design', root: 'canvas', ...extra }, local: { origin: 'http://localhost:8080' } } });
  assert.throws(() => normalizeConfig(side({ fileKey: 'abcdefgh12' })), /fileKey is unsupported with the provider "claude-design"/);
  assert.throws(() => normalizeConfig(side({ origin: 'http://localhost:8080' })), /origin is unsupported/);
  assert.throws(() => normalizeConfig(side({ runtime: 'https://example.com/support.js' })), /runtime is unsupported/);
  assert.throws(() => normalizeConfig(side({ root: '../outside' })), /root must be a plain relative path/);
  assert.throws(() => normalizeConfig(side({ root: undefined })), /root/);
  assert.throws(() => normalizeConfig(config({ desktop: 'Example.png' })), /target\.design\.desktop must name an artboard file/);
  assert.throws(() => normalizeConfig(config({ desktop: '../Example.dc.html' })), /target\.design\.desktop must name an artboard file directly in project\//);
  assert.throws(() => normalizeConfig(config({ desktop: 'Example.dc.html#' })), /must have a CSS selector/);
  assert.throws(() => normalizeConfig(config({ desktop: '12:34' })), /target\.design\.desktop/);
  const mixed = { ...config(), sides: { design: { kind: 'design', provider: 'claude-design', root: 'canvas' }, refs: { kind: 'design', provider: 'files', root: 'refs' }, local: { origin: 'http://localhost:8080' } } };
  assert.throws(() => normalizeConfig(mixed), /one provider/);
});

test('export checks: the project directory, the runtime and each artboard, with no escape (R4.6)', async () => {
  const directory = await workspace();
  try {
    const root = join(directory, 'canvas');
    const canvas = await prepareCanvas(root, ['Example.dc.html', 'Example.dc.html']);
    assert.equal(canvas.artboards.size, 1);
    assert.equal(canvas.runtimeSha256, sha256(await readFile(join(root, 'project/support.js'))));
    assert.equal(canvas.artboards.get('Example.dc.html').sha256, sha256(await readFile(join(root, 'project/Example.dc.html'))));
    await assert.rejects(prepareCanvas(join(directory, 'nothing'), ['Example.dc.html']), /design root does not exist/);
    await assert.rejects(prepareCanvas(root, ['Missing.dc.html']), /artboard is missing: project\/Missing\.dc\.html/);
    await mkdir(join(root, 'project/Dir.dc.html'));
    await assert.rejects(prepareCanvas(root, ['Dir.dc.html']), /not a regular file/);
    // A symlink that leaves project/ is refused, also when it stays inside root.
    await writeFile(join(directory, 'outside.dc.html'), '<p>outside</p>');
    await symlink(join(directory, 'outside.dc.html'), join(root, 'project/Out.dc.html'));
    await assert.rejects(prepareCanvas(root, ['Out.dc.html']), /escapes project\//);
    await writeFile(join(root, 'Sibling.dc.html'), '<p>sibling</p>');
    await symlink(join(root, 'Sibling.dc.html'), join(root, 'project/Sibling.dc.html'));
    await assert.rejects(prepareCanvas(root, ['Sibling.dc.html']), /escapes project\//);
    // The runtime: missing, or a symlink out.
    await rm(join(root, 'project/support.js'));
    await assert.rejects(prepareCanvas(root, ['Example.dc.html']), /needs the canvas runtime at project\/support\.js.*never ships or downloads it/);
    await symlink(join(directory, 'outside.dc.html'), join(root, 'project/support.js'));
    await assert.rejects(prepareCanvas(root, ['Example.dc.html']), /canvas runtime escapes project\//);
    // No project directory, and a project directory that is a symlink out of root.
    await rm(join(root, 'project'), { recursive: true });
    await assert.rejects(prepareCanvas(root, ['Example.dc.html']), /has no project\/ directory/);
    await mkdir(join(directory, 'elsewhere'));
    await symlink(join(directory, 'elsewhere'), join(root, 'project'));
    await assert.rejects(prepareCanvas(root, ['Example.dc.html']), /project\/ directory escapes the design root/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function get(origin, path, { method = 'GET', host } = {}) {
  const url = new URL(origin);
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: url.port, path, method, headers: { host: host ?? url.host } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => done({ status: response.statusCode, type: response.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', fail);
    req.end();
  });
}

test('loopback server: serves project/ only, from 127.0.0.1, and refuses every escape (R4.6)', async () => {
  const directory = await workspace();
  let server;
  try {
    const root = join(directory, 'canvas');
    await writeFile(join(directory, 'secret.txt'), 'secret');
    await writeFile(join(root, 'beside.txt'), 'beside');
    await symlink(join(directory, 'secret.txt'), join(root, 'project/link.txt'));
    await writeFile(join(root, 'project/.hidden'), 'hidden');
    const canvas = await prepareCanvas(root, ['Example.dc.html']);
    server = await startCanvasServer(canvas);
    assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    // Every path starts with the random token of this server (32 hex digits). Without it, every file is 404.
    const token = server.base.slice(server.origin.length + 1);
    assert.match(token, /^[0-9a-f]{32}$/);
    const other = await startCanvasServer(canvas);
    assert.notEqual(other.base.slice(other.origin.length + 1), token, 'Each server draws its own token.');
    await other.close();
    for (const path of ['/Example.dc.html', '/support.js', `/${token}`, `/${token.slice(1)}/Example.dc.html`, `/${token}0/Example.dc.html`, `/${token.toUpperCase()}/Example.dc.html`, `/x/${token}/Example.dc.html`])
      assert.equal((await get(server.origin, path)).status, 404, path);
    const at = path => `/${token}${path}`;
    const page = await get(server.origin, at('/Example.dc.html'));
    assert.equal(page.status, 200);
    assert.equal(page.type, 'text/html; charset=utf-8');
    assert.match(page.body, /<x-dc>/);
    assert.equal((await get(server.origin, at('/ds/tokens.css'))).type, 'text/css; charset=utf-8');
    assert.equal((await get(server.origin, at('/support.js?v=1'))).status, 200);
    // The artboard bytes are the bytes read at the check, so a later edit does not reach the render.
    await writeFile(join(root, 'project/Example.dc.html'), '<p>changed</p>');
    assert.match((await get(server.origin, at('/Example.dc.html'))).body, /<x-dc>/);
    for (const path of ['/', '/../beside.txt', '/%2e%2e/beside.txt', '/ds/%2e%2e/%2e%2e/beside.txt', '/link.txt', '/.hidden', '/nothing.css', '/ds', '/a%2f..%2fbeside.txt'])
      assert.equal((await get(server.origin, at(path))).status, 404, path);
    assert.equal((await get(server.origin, 'http://example.com/Example.dc.html')).status, 400);
    assert.equal((await get(server.origin, at('/Example.dc.html'), { method: 'POST' })).status, 405);
    assert.equal((await get(server.origin, at('/Example.dc.html'), { host: 'localhost' })).status, 403);
    assert.equal((await get(server.origin, at('/Example.dc.html'), { host: 'attacker.example' })).status, 403);
  } finally {
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

function png(width, height) {
  const image = new PNG({ width, height });
  image.data.fill(255);
  return PNG.sync.write(image);
}

// A stub browser with the Playwright surface the provider uses. It records what the provider asked for.
function stubChromium({ fail, hang } = {}) {
  const calls = { launch: [], contexts: [], gotos: [], clips: [], routes: 0, initScripts: [], closedPages: 0 };
  const chromium = {
    launch: async options => {
      calls.launch.push(options);
      return {
        version: () => 'stub',
        close: async () => {},
        newContext: async options => {
          calls.contexts.push(options);
          return {
            addInitScript: async script => { calls.initScripts.push(script); },
            routeWebSocket: async () => {},
            route: async () => { calls.routes++; },
            close: async () => {},
            newPage: async () => ({
              on: () => {}, setDefaultTimeout: () => {}, setDefaultNavigationTimeout: () => {}, close: async () => { calls.closedPages++; },
              goto: async url => { calls.gotos.push(url); return { status: () => 200 }; },
              waitForFunction: async () => { if (fail === 'render') throw new Error('Timeout'); },
              addStyleTag: async () => {},
              // `hang` makes every evaluate wait forever, as a page.evaluate with no timeout can.
              evaluate: async () => (hang ? new Promise(() => {}) : fail === 'selector' ? { count: 2 } : { holes: true, emptyImports: 1, count: 1, top: 0, bottom: 15 }),
              screenshot: async ({ clip }) => { calls.clips.push(clip); return png(clip.width * options.deviceScaleFactor, clip.height * options.deviceScaleFactor); },
            }),
          };
        },
      };
    },
  };
  return { chromium, calls };
}

test('import: renders each mapped cell and writes provenance with both hashes (R4.6)', async () => {
  const directory = await workspace();
  try {
    const configPath = join(directory, 'config.json');
    await writeFile(configPath, JSON.stringify(config()));
    const { chromium, calls } = stubChromium();
    const { run, runDir } = await importDesign({ configPath, side: 'design', claudeDesign: { chromium } });
    assert.equal(run.state, 'complete');
    assert.deepEqual(run.tools.map(tool => tool.name), ['test-kit-design']);
    assert.deepEqual(run.settings.artifacts, ['screenshot']);
    assert.equal(calls.launch.length, 1);
    assert.deepEqual(calls.launch[0].args.slice(0, CHROMIUM_ARGS.length), [...CHROMIUM_ARGS]);
    assert.ok(calls.launch[0].args.some(arg => /^--proxy-server=http:\/\/127\.0\.0\.1:\d+$/.test(arg)));
    assert.ok(calls.launch[0].args.some(arg => /^--proxy-bypass-list=<-loopback>;http:\/\/127\.0\.0\.1:\d+$/.test(arg)));
    assert.ok(calls.launch[0].args.includes('--disable-features=WebTransport'));
    assert.ok(calls.contexts.every(options => options.reducedMotion === 'reduce' && options.serviceWorkers === 'block'));
    assert.deepEqual(calls.contexts.map(options => options.deviceScaleFactor), [1, 2]);
    assert.equal(calls.routes, 2);
    assert.ok(calls.gotos.every(url => /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/Example\.dc\.html$/.test(url)));
    assert.deepEqual(calls.initScripts, [NO_SOCKETS_SCRIPT, NO_SOCKETS_SCRIPT], 'Each context removes WebRTC and WebTransport before any artboard script.');
    assert.deepEqual(calls.clips, [{ x: 0, y: 0, width: 40, height: 15 }, { x: 0, y: 0, width: 20, height: 15 }]);
    const root = join(directory, 'canvas/project');
    const artboardSha256 = sha256(await readFile(join(root, 'Example.dc.html')));
    const runtimeSha256 = sha256(await readFile(join(root, 'support.js')));
    const mobile = run.captures.find(row => row.viewportId === 'mobile');
    assert.deepEqual(Object.keys(mobile.design), ['provider', 'source', 'artboardSha256', 'runtimeSha256', 'importedAt', 'sha256', 'width', 'height']);
    assert.equal(mobile.design.provider, 'claude-design');
    assert.equal(mobile.design.source, 'Example.dc.html##hero');
    assert.equal(mobile.design.artboardSha256, artboardSha256);
    assert.equal(mobile.design.runtimeSha256, runtimeSha256);
    assert.equal(mobile.design.width, 40, 'Viewport 20 x scale 2.');
    assert.equal(mobile.design.sha256, sha256(await readFile(join(runDir, 'screenshots/hero/mobile.png'))));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('import: a failed check or render leaves no run, and no browser starts before the file checks pass (R4.6)', async () => {
  const directory = await workspace();
  try {
    const configPath = join(directory, 'config.json');
    const runs = join(directory, 'runs');
    const noRun = async () => assert.deepEqual(await readdir(runs).catch(() => []), []);
    await writeFile(configPath, JSON.stringify(config()));
    let stub = stubChromium({ fail: 'render' });
    await assert.rejects(importDesign({ configPath, side: 'design', claudeDesign: { chromium: stub.chromium } }), /Artboard did not render for target hero, viewport desktop: Example\.dc\.html: a "\{\{" hole is still in the text and 1 x-import element\(s\) are empty/);
    await noRun();
    stub = stubChromium({ fail: 'selector' });
    await assert.rejects(importDesign({ configPath, side: 'design', viewports: ['mobile'], claudeDesign: { chromium: stub.chromium } }), /selector of target hero, viewport mobile: Example\.dc\.html##hero matches 2 elements/);
    await noRun();
    await writeFile(configPath, JSON.stringify(config({ desktop: 'Missing.dc.html' })));
    stub = stubChromium();
    await assert.rejects(importDesign({ configPath, side: 'design', claudeDesign: { chromium: stub.chromium } }), /artboard is missing/);
    assert.equal(stub.calls.launch.length, 0, 'No browser starts when a file check fails.');
    await rm(join(directory, 'canvas/project/support.js'));
    await writeFile(configPath, JSON.stringify(config()));
    await assert.rejects(importDesign({ configPath, side: 'design', claudeDesign: { chromium: stub.chromium } }), /needs the canvas runtime/);
    assert.equal(stub.calls.launch.length, 0);
    await noRun();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('import: one deadline bounds the whole cell, also an evaluate that never returns (R4.6)', async () => {
  const directory = await workspace();
  try {
    const configPath = join(directory, 'config.json');
    await writeFile(configPath, JSON.stringify({ ...config(), screenshot: { timeoutMs: 200 } }));
    const stub = stubChromium({ hang: true });
    const started = Date.now();
    await assert.rejects(importDesign({ configPath, side: 'design', claudeDesign: { chromium: stub.chromium } }),
      /Artboard did not finish within 200 ms \(screenshot\.timeoutMs\) for target hero, viewport desktop: Example\.dc\.html\./);
    assert.ok(Date.now() - started < 2000, `The cell failed after ${Date.now() - started} ms.`);
    assert.equal(stub.calls.closedPages, 1, 'The deadline closes the page.');
    assert.deepEqual(await readdir(join(directory, 'runs')).catch(() => []), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
