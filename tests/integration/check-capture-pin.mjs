import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { PNG } from 'pngjs';
import { capture } from '../../src/capture/index.js';
import { compareRuns } from '../../src/compare/runs.js';

// #294 (R5.12, ADR 0008): settle.pin sets position: static on sticky or fixed elements for the capture only.
// The fixture is 1280 px wide and 4000 px tall. The header is red, sticky and 120 px high. The body below it is
// light grey stripes with no red. A red band below y = 120 in a full-page PNG is a copy of the header.
// Chromium draws a sticky element at the scroll position of the moment, so a page that scrolls itself
// (the query ?scroll=N stands for any scroll timing: a restored position, a smooth-scroll library) moves the band.
const requests = [];
const site = createServer((request, response) => {
  requests.push(`${request.method} ${request.url}`);
  const scroll = Number(new URL(request.url, 'http://localhost').searchParams.get('scroll') ?? 0);
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><title>Example site</title><style>
    body{margin:0;height:4000px;background:repeating-linear-gradient(#eee 0 100px,#ddd 100px 200px)}
    header{position:sticky;top:0;height:120px;background:#f00;z-index:10}
    #fixed{position:fixed;left:0;bottom:0;width:100px;height:60px;background:#00f}
  </style><header class="site-header">Header</header><div id="fixed"></div><main>Content</main><script>addEventListener('load',()=>scrollTo(0,${scroll}))</script>`);
});
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
const directory = await mkdtemp(join(tmpdir(), 'test-kit-capture-pin-'));
// Count the rows below the header slot that hold a red pixel in the first 100 columns.
const redRowsBelow = async (run, id) => {
  const entry = run.captures.find(item => item.targetId === id);
  const png = PNG.sync.read(await readFile(join(directory, 'runs', run.id, entry.path)));
  let rows = 0;
  for (let y = 130; y < png.height; y++) {
    const i = (png.width * y + 50) * 4;
    if (png.data[i] > 200 && png.data[i + 1] < 60 && png.data[i + 2] < 60) rows++;
  }
  return { rows, height: png.height };
};
try {
  const configPath = join(directory, 'config.json');
  const config = (pin, scroll) => ({ schemaVersion: 1, sides: { local: { origin: `http://127.0.0.1:${site.address().port}` } },
    targets: [{ id: 'home', kind: 'page', path: `/?scroll=${scroll}`, ...(pin ? { settle: { pin } } : {}) }, { id: 'plain', kind: 'page', path: '/' }],
    viewports: [{ id: 'wide', width: 1280, height: 800 }], artifacts: ['screenshot'], checks: [], runsRoot: 'runs' });
  const save = value => writeFile(configPath, JSON.stringify(value));
  const pair = async (a, b, name) => {
    const result = await compareRuns({ runsRoot: join(directory, 'runs'), runA: a.run.id, runB: b.run.id, outputDir: join(directory, name) });
    return result.report.entries.find(entry => entry.id === 'home').viewports[0];
  };
  const pin = ['header.site-header', '#fixed'];

  // Defect proof (acceptance 2): without pin, the sticky header shows again where the page scrolled, and two scroll
  // timings of one page differ. A future Chromium that fixes this fails here, so the option can be reviewed.
  await save(config(undefined, 1700));
  const plainA = await capture({ configPath, side: 'local' });
  await save(config(undefined, 2300));
  const plainB = await capture({ configPath, side: 'local' });
  assert.equal(plainA.run.state, 'complete');
  assert.ok((await redRowsBelow(plainA.run, 'home')).rows > 0, 'Without pin, the sticky header shows again below its slot.');
  const defect = await pair(plainA, plainB, 'defect');
  assert.ok(defect.ratio > 0, 'Without pin, two scroll timings of one page differ.');

  // Five A/A captures with pin give ratio 0 (acceptance 1), at five scroll timings.
  const runs = [];
  for (const scroll of [0, 1100, 1700, 2300, 3500]) { await save(config(pin, scroll)); runs.push(await capture({ configPath, side: 'local' })); }
  assert.ok(runs.every(item => item.run.state === 'complete'));
  assert.equal((await redRowsBelow(runs[2].run, 'home')).rows, 0, 'With pin, no header copy shows below the header slot.');
  assert.equal(runs[0].run.captures[0].recipe.version, 1, 'Pin does not change the engine version.');
  assert.deepEqual(runs[0].run.captures[0].recipe.settle.pin, pin, 'The recipe records pin.');
  for (let index = 1; index < runs.length; index++) {
    const row = await pair(runs[0], runs[index], `same-${index}`);
    assert.equal(row.state, 'complete'); assert.equal(row.ratio, 0, `A/A pair ${index} is identical.`);
  }

  // A pin change makes only its target incompatible (acceptance 3).
  const mixed = await compareRuns({ runsRoot: join(directory, 'runs'), runA: plainA.run.id, runB: runs[2].run.id, outputDir: join(directory, 'mixed') });
  assert.equal(mixed.report.entries.find(entry => entry.id === 'home').viewports[0].artifacts.screenshot.state, 'incompatible');
  assert.equal(mixed.report.entries.find(entry => entry.id === 'plain').viewports[0].state, 'complete');

  // Pin sends no extra request (acceptance 5: a remote side uses the same code path, with no script and no request).
  const before = requests.length;
  await capture({ configPath, side: 'local' });
  assert.ok(requests.slice(before).every(request => /^GET \/(\?scroll=\d+|favicon\.ico)?$/.test(request)), `Pin sends no extra request: ${requests.slice(before)}`);

  // A selector with no match fails only its target, with a clear message.
  await save(config(['#missing'], 0));
  const missing = await capture({ configPath, side: 'local' });
  const failed = missing.run.captures.find(item => item.targetId === 'home');
  assert.equal(failed.state, 'failed');
  assert.equal(failed.path, undefined);
  assert.match(failed.error.message, /pin selector "#missing" matches no element/);
  assert.equal(missing.run.captures.find(item => item.targetId === 'plain').state, 'captured');
  console.log('Pin: removes the repeated header, records the recipe, stays per target, fails on no match.');
} finally {
  site.close(); await rm(directory, { recursive: true, force: true });
}
