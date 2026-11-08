// Explicit browser integration check. npm test does not discover this file.
// R4.6, R5.5 and R8.15: import a synthetic Claude Design export as a design side, render it in Chromium from the
// loopback server, and pair it with itself and with a captured run of the synthetic example site.
// The fixture (tests/fixtures/claude-design) has a stub runtime only. The real canvas runtime is never in this
// repository. Example.dc.html is plain markup, so it renders the same with the stub and with a real runtime.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, cp, symlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { createSocket } from 'node:dgram';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { startExampleSite } from './example-site-server.mjs';
import { capture } from '../../src/capture/index.js';
import { importDesign } from '../../src/design/import.js';
import { compareRuns } from '../../src/compare/runs.js';
import { run as cli } from '../../src/cli/run.js';
import { sha256 } from '../../src/design/png.js';

const directory = await mkdtemp(join(tmpdir(), 'test-kit-claude-design-'));
let site;
let probe;
let turn;
let quic;
try {
  site = await startExampleSite();
  // A second loopback server on another port. The page asks it for an image, a stylesheet and a fetch.
  // The import must abort all of them: only its own server answers. A count above zero fails the check.
  // Workers and a speculation-rules prefetch also ask it. `probeConnections` counts every TCP connection, so a
  // WebSocket upgrade counts too, and `probePaths` names what arrived.
  let probeRequests = 0;
  let probeConnections = 0;
  const probePaths = [];
  probe = createServer((request, response) => { probeRequests++; probePaths.push(request.url); response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end('probe'); });
  probe.on('connection', () => { probeConnections++; });
  probe.on('upgrade', (request, socket) => { probePaths.push(request.url); socket.destroy(); });
  await new Promise(done => probe.listen(0, '127.0.0.1', done));
  const other = `http://127.0.0.1:${probe.address().port}`;
  // The same script runs in a dedicated and in a shared worker. It asks the probe server for a fetch, a WebSocket and
  // an EventSource. A speculation rule asks it for a prefetch. Without the proxy (measured 2026-11-08) the route still
  // aborts the fetch and the EventSource of the dedicated worker, but the WebSocket of the dedicated worker, all three
  // of the shared worker and the prefetch reach this server. So the closing proxy is their guard.
  const channels = tag => `fetch('${other}/${tag}-fetch').catch(() => {});
try { const socket = new WebSocket('ws://127.0.0.1:${probe.address().port}/${tag}-socket'); socket.onerror = () => {}; } catch {}
try { const source = new EventSource('${other}/${tag}-events'); source.onerror = () => source.close(); } catch {}`;
  const blob = text => `URL.createObjectURL(new Blob([${JSON.stringify(text)}], { type: 'text/javascript' }))`;
  const workers = `new Worker(${blob(channels('worker'))}); new SharedWorker(${blob(channels('shared'))});`;
  const prefetch = JSON.stringify({ prefetch: [{ source: 'list', urls: [`${other}/prefetch`] }] });
  // A plain TCP listener on a third loopback port, as a TURN server. The artboard asks WebRTC for a relay over TCP there,
  // in the page and in an iframe it creates. `--force-webrtc-ip-handling-policy` allows that connection, and the
  // request route does not see it (measured 2026-11-08: a STUN Allocate arrived). The import removes WebRTC from every
  // frame before any artboard script runs, so this listener must see 0 connections.
  let turnConnections = 0;
  turn = createTcpServer(socket => { turnConnections++; socket.on('error', () => {}); socket.destroy(); });
  await new Promise(done => turn.listen(0, '127.0.0.1', done));
  const relay = `turn:127.0.0.1:${turn.address().port}?transport=tcp`;
  const webrtc = scope => `(async () => { const Peer = ${scope}.RTCPeerConnection; if (typeof Peer !== 'function') return;
  const peer = new Peer({ iceServers: [{ urls: '${relay}', username: 'user', credential: 'secret' }], iceTransportPolicy: 'relay' });
  peer.createDataChannel('probe'); await peer.setLocalDescription(await peer.createOffer()); })();`;
  // A UDP listener on a fourth loopback port, as a WebTransport server. WebTransport opens QUIC over UDP, which the
  // route does not see (measured 2026-11-08: 4 datagrams arrived, also with --disable-quic). The artboard tries it in
  // the page, in an iframe and in a worker, where no init script runs. The proxy that closes every connection is the
  // guard in the worker. The listener must see 0 datagrams.
  let quicDatagrams = 0;
  quic = createSocket('udp4');
  quic.on('message', () => { quicDatagrams++; });
  await new Promise(done => quic.bind(0, '127.0.0.1', done));
  const transport = `try { const session = new WebTransport('https://127.0.0.1:${quic.address().port}/probe'); session.ready.catch(() => {}); session.closed.catch(() => {}); } catch {}`;
  const webtransport = scope => `(() => { const Transport = ${scope}.WebTransport; if (typeof Transport !== 'function') return; ${transport.replace('new WebTransport', 'new Transport')} })();`;
  const worker = `new Worker(URL.createObjectURL(new Blob([${JSON.stringify(transport)}], { type: 'text/javascript' })));`;

  const root = join(directory, 'canvas');
  await cp(new URL('../fixtures/claude-design/', import.meta.url), root, { recursive: true });
  await writeFile(join(root, 'project/Probe.dc.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ds/tokens.css">
<link rel="stylesheet" href="${other}/x.css"><script src="./support.js"></script></head>
<body><x-dc><main class="page"><img src="${other}/x.png" alt=""><img src="https://example.invalid/x.png" alt="">
<section class="card"><h1>{{hold}}</h1></section></main></x-dc>
<script>fetch('${other}/fetch').catch(() => {}); fetch('https://example.invalid/fetch').catch(() => {});</script>
<script>${webrtc('window')}</script>
<script>const frame = document.createElement('iframe'); document.body.append(frame); ${webrtc('frame.contentWindow')} ${webtransport('frame.contentWindow')}</script>
<script>${webtransport('window')} ${worker}</script>
<script>${workers}</script>
<script type="speculationrules">${prefetch}</script>
<script>// The hole resolves only when the init script removed the interfaces in the page and in the iframe. Else the import fails.
const gone = scope => ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport'].every(name => scope[name] === undefined);
setTimeout(() => { if (gone(window) && gone(frame.contentWindow)) document.querySelector('.card h1').textContent = 'Probe'; frame.remove(); }, 1500);</script></body></html>`);

  const configPath = join(directory, 'config.json');
  const config = {
    schemaVersion: 1,
    sides: { site: { origin: site.origin }, design: { kind: 'design', provider: 'claude-design', root: 'canvas' } },
    targets: [
      { id: 'whole', kind: 'page', path: '/unchanged', design: { desktop: 'Example.dc.html', mobile: 'Example.dc.html' } },
      { id: 'card', kind: 'page', path: '/unchanged', design: { desktop: 'Example.dc.html##hero' } },
      { id: 'probe', kind: 'page', path: '/unchanged', design: { desktop: 'Probe.dc.html' } },
    ],
    viewports: [{ id: 'mobile', width: 390, height: 700, deviceScaleFactor: 2 }, { id: 'desktop', width: 800, height: 600 }],
    screenshot: { timeoutMs: 5000 },
    runsRoot: 'runs',
  };
  await writeFile(configPath, JSON.stringify(config));

  // The command prints one line of JSON.
  const lines = [];
  const code = await cli(['import', '--config', configPath, '--side', 'design', '--label', 'canvas'], { out: { write: chunk => lines.push(chunk) }, err: { write: chunk => process.stderr.write(chunk) } });
  assert.equal(code, 0);
  const first = JSON.parse(lines.join(''));
  assert.equal(first.state, 'complete');
  assert.equal(first.images, 4);
  await new Promise(done => setTimeout(done, 500));
  assert.equal(probeConnections, 0, `No connection reaches another server: ${probePaths.join(', ')}.`);
  assert.equal(probeRequests, 0, 'No request reaches another server.');
  assert.equal(turnConnections, 0, 'No WebRTC connection reaches another loopback port.');
  assert.equal(quicDatagrams, 0, 'No WebTransport datagram reaches another loopback port.');
  const manifest = JSON.parse(await readFile(first.manifestPath, 'utf8'));
  const entry = (target, viewport) => manifest.captures.find(row => row.targetId === target && row.viewportId === viewport);
  const runtimeSha256 = sha256(await readFile(join(root, 'project/support.js')));
  for (const [target, viewport, width] of [['whole', 'mobile', 780], ['whole', 'desktop', 800], ['card', 'desktop', 800], ['probe', 'desktop', 800]]) {
    const row = entry(target, viewport);
    assert.equal(row.design.provider, 'claude-design');
    assert.equal(row.design.width, width, `${target}/${viewport} is viewport width x scale wide (R8.15).`);
    assert.equal(row.design.runtimeSha256, runtimeSha256);
    assert.match(row.design.projectSha256, /^[0-9a-f]{64}$/);
    assert.equal(row.design.projectSha256, entry('whole', 'desktop').design.projectSha256, 'One import has one snapshot of project/.');
    const image = PNG.sync.read(await readFile(join(first.manifestPath, '..', row.path)));
    assert.equal(image.width, width);
    assert.equal(row.design.sha256, sha256(await readFile(join(first.manifestPath, '..', row.path))));
  }
  assert.equal(entry('card', 'desktop').design.source, 'Example.dc.html##hero');
  assert.ok(entry('card', 'desktop').design.height < entry('whole', 'desktop').design.height, 'The selector form captures the element band only.');
  assert.ok(entry('card', 'desktop').design.height >= 96, 'The band holds the whole card.');
  // The card band holds the card colour, so the stylesheet from project/ds was served and applied.
  const card = PNG.sync.read(await readFile(join(first.manifestPath, '..', entry('card', 'desktop').path)));
  const at = (x, y) => [...card.data.slice((y * card.width + x) * 4, (y * card.width + x) * 4 + 3)];
  assert.deepEqual(at(card.width - 40, Math.floor(card.height / 2)), [0xee, 0xf2, 0xfb]);
  assert.equal(entry('whole', 'mobile').deviceScaleFactor, 2);

  // A second import of the same export is a new run with equal pixels: the render is deterministic.
  const second = await importDesign({ configPath, side: 'design', label: 'again' });
  assert.equal(probeRequests, 0);
  const runsRoot = join(directory, 'runs');
  const same = await compareRuns({ runsRoot, runA: first.id, runB: second.run.id, outputDir: join(directory, 'report-same') });
  for (const target of same.report.entries) for (const row of target.viewports) {
    if (!config.targets.find(item => item.id === target.id).design[row.id]) { assert.equal(row.state, 'missing'); continue; }
    assert.equal(row.state, 'complete', `${target.id}/${row.id}`);
    assert.equal(row.ratio, 0, `${target.id}/${row.id} renders the same twice.`);
  }

  // A pair with a captured run of the example site at the same viewports is compatible (R8.15).
  const captured = await capture({ configPath, side: 'site', label: 'browser', artifacts: ['screenshot'] });
  assert.equal(captured.run.state, 'complete');
  const pair = await compareRuns({ runsRoot, runA: first.id, runB: captured.run.id, outputDir: join(directory, 'report-site') });
  assert.equal(pair.report.pair.kind, 'convergence');
  const cell = (target, viewport) => pair.report.entries.find(row => row.id === target).viewports.find(row => row.id === viewport);
  assert.equal(cell('whole', 'desktop').state, 'complete');
  assert.equal(cell('whole', 'mobile').state, 'complete');
  assert.equal(cell('card', 'mobile').state, 'missing', 'A viewport with no mapped artboard is missing.');

  // A hole left in the text fails the target by name, and no run is written.
  const before = (await readdir(runsRoot)).length;
  await writeFile(configPath, JSON.stringify({ ...config, screenshot: { timeoutMs: 1500 }, targets: [{ id: 'hole', kind: 'page', path: '/unchanged', design: { desktop: 'Hole.dc.html' } }] }));
  await assert.rejects(importDesign({ configPath, side: 'design' }), /Artboard did not render for target hole, viewport desktop: Hole\.dc\.html: a "\{\{" hole is still in the text/);
  // A selector that matches nothing fails, and a symlink that leaves project/ fails before a browser starts.
  await writeFile(configPath, JSON.stringify({ ...config, targets: [{ id: 'card', kind: 'page', path: '/unchanged', design: { desktop: 'Example.dc.html#nothing' } }] }));
  await assert.rejects(importDesign({ configPath, side: 'design' }), /matches 0 elements/);
  await writeFile(configPath, JSON.stringify({ ...config, targets: [{ id: 'card', kind: 'page', path: '/unchanged', design: { desktop: 'Example.dc.html#hero' } }] }));
  await assert.rejects(importDesign({ configPath, side: 'design' }), /matches 0 elements\. .*write "Example\.dc\.html##hero"/);
  await writeFile(join(directory, 'outside.dc.html'), '<p>outside</p>');
  await symlink(join(directory, 'outside.dc.html'), join(root, 'project/Out.dc.html'));
  await writeFile(configPath, JSON.stringify({ ...config, targets: [{ id: 'out', kind: 'page', path: '/unchanged', design: { desktop: 'Out.dc.html' } }] }));
  await assert.rejects(importDesign({ configPath, side: 'design' }), /escapes project\//);
  await writeFile(configPath, JSON.stringify({ ...config, targets: [{ id: 'up', kind: 'page', path: '/unchanged', design: { desktop: '../config.dc.html' } }] }));
  await assert.rejects(importDesign({ configPath, side: 'design' }), /directly in project\//);
  assert.equal((await readdir(runsRoot)).length, before, 'A failed import leaves no run.');
  console.log('design claude-design check passed');
} finally {
  await site?.close();
  await new Promise(done => (probe ? probe.close(() => done()) : done()));
  await new Promise(done => (turn ? turn.close(() => done()) : done()));
  await new Promise(done => (quic ? quic.close(() => done()) : done()));
  await rm(directory, { recursive: true, force: true });
}
