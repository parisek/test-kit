import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
import { capture } from '../../src/capture/index.js';
import { compareRuns } from '../../src/compare/runs.js';

// Slice 4 of #49 (R5.9): lazy-image settlement gives the same result for a full-page, a viewport-only (overlay), an element and a clip capture.
// A script sets the image source only when the image scrolls into view (a common lazy loader). Unloaded, it shows red. Loaded, it shows blue.
// A screenshot alone does not scroll, so only the settlement sweep loads it.
const site = createServer((request, response) => {
  if (request.url === '/image.svg') {
    response.setHeader('Content-Type', 'image/svg+xml');
    response.end('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>');
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  // Overlay parity: the image sits inside the first viewport and a scroll event, not the viewport, loads it.
  if (request.url === '/top') { response.end('<!doctype html><title>Example site</title><style>body{margin:0;height:2000px}img{position:absolute;left:0;top:100px;width:40px;height:40px;background:red}</style><img id="lazy" data-src="/image.svg" alt=""><script>addEventListener("scroll",()=>{const i=document.getElementById("lazy");i.src=i.dataset.src;});</script>'); return; }
  response.end('<!doctype html><title>Example site</title><style>body{margin:0;height:2000px}img{position:absolute;left:0;top:1600px;width:40px;height:40px;background:red}</style><img id="lazy" data-src="/image.svg" alt=""><script>new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting)e.target.src=e.target.dataset.src;}).observe(document.getElementById("lazy"));</script>');
});
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
const directory = await mkdtemp(join(tmpdir(), 'test-kit-capture-lazy-'));
const colorAt = async (run, id, x, y) => {
  const entry = run.captures.find(item => item.targetId === id);
  const png = PNG.sync.read(await readFile(join(directory, 'runs', run.id, entry.path)));
  const index = (png.width * y + x) * 4;
  return [...png.data.subarray(index, index + 3)];
};
try {
  const configPath = join(directory, 'config.json');
  const config = lazyImages => ({ schemaVersion: 1, sides: { local: { origin: `http://127.0.0.1:${site.address().port}` } },
    targets: [
      { id: 'full', kind: 'page', path: '/', settle: { lazyImages } },
      { id: 'scoped', kind: 'component', path: '/', selector: '#lazy', settle: { lazyImages } },
      { id: 'union', kind: 'component', path: '/', selector: ['#lazy'], settle: { lazyImages } },
    ], viewports: [{ id: 'small', width: 300, height: 200 }], runsRoot: 'runs' });
  await writeFile(configPath, JSON.stringify(config(true)));
  const a = await capture({ configPath, side: 'local' }), b = await capture({ configPath, side: 'local' });
  assert.equal(a.run.state, 'complete'); assert.equal(b.run.state, 'complete');
  assert.deepEqual(await colorAt(a.run, 'full', 20, 1620), [0, 0, 255], 'Full-page capture shows the loaded image.');
  assert.deepEqual(await colorAt(a.run, 'scoped', 20, 20), [0, 0, 255], 'Element capture shows the loaded image.');
  assert.deepEqual(await colorAt(a.run, 'union', 20, 20), [0, 0, 255], 'Clip capture shows the loaded image.');
  for (const entry of a.run.captures) {
    assert.equal(entry.recipe.settle.lazyImages, true, 'The recipe records lazy-image settlement (R5.6).');
    assert.equal(entry.state, 'captured');
  }
  assert.equal(a.run.captures.find(entry => entry.targetId === 'full').height, 2000, 'The page height does not change.');
  const same = await compareRuns({ runsRoot: join(directory, 'runs'), runA: a.run.id, runB: b.run.id, outputDir: join(directory, 'same') });
  assert.ok(same.report.entries.every(entry => entry.viewports[0].state === 'complete' && entry.viewports[0].ratio === 0), 'An A/A pair is identical.');
  // The same declaration with lazy images off is another recipe: incompatible, not a pixel diff.
  await writeFile(configPath, JSON.stringify(config(false)));
  const off = await capture({ configPath, side: 'local' });
  const mixed = await compareRuns({ runsRoot: join(directory, 'runs'), runA: a.run.id, runB: off.run.id, outputDir: join(directory, 'mixed') });
  assert.ok(mixed.report.entries.every(entry => entry.viewports[0].state === 'incompatible'));
  assert.deepEqual(await colorAt(off.run, 'full', 20, 1620), [255, 0, 0], 'Without settlement the loader never runs.');
  // R5.9: a viewport-only capture (overlay parity, `screenshot.fullPage: false`) runs the same sweep before the screenshot.
  const viewportConfig = lazyImages => ({ ...config(lazyImages), screenshot: { fullPage: false },
    targets: [{ id: 'overlay', kind: 'component', path: '/top', settle: { lazyImages } }] });
  await writeFile(configPath, JSON.stringify(viewportConfig(true)));
  const v = await capture({ configPath, side: 'local' }), w = await capture({ configPath, side: 'local' });
  assert.equal(v.run.state, 'complete');
  assert.equal(v.run.captures[0].height, 200, 'A viewport-only capture has the viewport height, not the page height.');
  assert.deepEqual(await colorAt(v.run, 'overlay', 20, 120), [0, 0, 255], 'Viewport-only capture shows the loaded image.');
  assert.equal(v.run.captures[0].recipe.settle.lazyImages, true);
  const viewportSame = await compareRuns({ runsRoot: join(directory, 'runs'), runA: v.run.id, runB: w.run.id, outputDir: join(directory, 'viewport-same') });
  assert.ok(viewportSame.report.entries.every(entry => entry.viewports[0].state === 'complete' && entry.viewports[0].ratio === 0), 'A viewport-only A/A pair is identical.');
  await writeFile(configPath, JSON.stringify(viewportConfig(false)));
  const viewportOff = await capture({ configPath, side: 'local' });
  assert.deepEqual(await colorAt(viewportOff.run, 'overlay', 20, 120), [255, 0, 0], 'Without settlement the viewport-only loader never runs.');
  console.log('Lazy-image settlement: full-page, element, clip and viewport-only captures show the loaded image and record the recipe.');
} finally {
  site.close(); await rm(directory, { recursive: true, force: true });
}
