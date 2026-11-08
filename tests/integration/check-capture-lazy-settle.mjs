import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { capture } from '../../src/capture/index.js';
import { compareRuns } from '../../src/compare/runs.js';

// #353 (R5.9): the lazy-image sweep scrolls with `behavior: 'instant'`, also when it restores the scroll position.
// The page has a sticky header with a strip. The strip hides when the page scrolls: an IntersectionObserver watches a
// sentinel at the top, and a scroll listener applies the class two animation frames late, as real headers do.
// A lazy image sits below the fold, so the sweep must scroll. One capture plus three more with no edit must give 0 differences.
// `/smooth` also sets `scroll-behavior: smooth` on the root, which many site themes do. Before the fix the restore of the
// scroll position animated there, so the screenshot caught the page scrolled with the strip hidden: on the code before #353
// this check fails (measured 2026-11-08: the header crop was 30 px high, not 70 px, and full-page pairs differed).
const page = smooth => `<!doctype html><title>Example site</title><style>
${smooth ? 'html{scroll-behavior:smooth}' : ''}
body{margin:0;height:2000px;font:16px sans-serif}
#sentinel{position:absolute;top:0;left:0;width:1px;height:1px}
header{position:sticky;top:0;background:#222;color:#fff}
header .strip{height:40px;background:orange}
header.scrolled .strip{display:none}
header .bar{height:30px}
img{position:absolute;left:0;top:1600px;width:40px;height:40px;background:red}
</style><div id="sentinel"></div><header id="header"><div class="strip"></div><div class="bar">Example site</div></header>
<img id="lazy" data-src="/image.svg" alt="">
<script>
const header = document.getElementById('header');
new IntersectionObserver(entries => { for (const entry of entries) requestAnimationFrame(() => header.classList.toggle('scrolled', !entry.isIntersecting)); }).observe(document.getElementById('sentinel'));
addEventListener('scroll', () => requestAnimationFrame(() => requestAnimationFrame(() => header.classList.toggle('scrolled', scrollY > 0))));
new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) entry.target.src = entry.target.dataset.src; }).observe(document.getElementById('lazy'));
</script>`;
// R5.15: `/debounced` has a header that a scroll listener sets to its scrolled state at once and reverts only 1500 ms after
// the scroll returns to the top, as a debounced listener does. The capture runs well inside that time, so without
// `settle.afterSweep` it shows the scrolled header. With `afterSweep: ['#header:not(.scrolled)']` it waits for the revert.
const debounced = `<!doctype html><title>Example site</title><style>
body{margin:0;height:2000px;font:16px sans-serif}
header{position:sticky;top:0;background:#222;color:#fff}
header .strip{height:40px;background:orange}
header.scrolled .strip{display:none}
header .bar{height:30px}
img{position:absolute;left:0;top:1600px;width:40px;height:40px;background:red}
</style><header id="header"><div class="strip"></div><div class="bar">Example site</div></header>
<img id="lazy" data-src="/image.svg" alt="">
<script>
const header = document.getElementById('header');
let timer;
addEventListener('scroll', () => {
  clearTimeout(timer);
  if (scrollY > 0) header.classList.add('scrolled');
  else timer = setTimeout(() => header.classList.remove('scrolled'), 1500);
});
new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) entry.target.src = entry.target.dataset.src; }).observe(document.getElementById('lazy'));
</script>`;
const site = createServer((request, response) => {
  if (request.url === '/image.svg') {
    response.setHeader('Content-Type', 'image/svg+xml');
    response.end('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>');
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.end(request.url === '/debounced' ? debounced : page(request.url === '/smooth'));
});
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
const directory = await mkdtemp(join(tmpdir(), 'test-kit-capture-lazy-settle-'));
try {
  const configPath = join(directory, 'config.json');
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, sides: { local: { origin: `http://127.0.0.1:${site.address().port}` } },
    targets: [
      { id: 'full', kind: 'page', path: '/', settle: { lazyImages: true } },
      { id: 'header', kind: 'component', path: '/', selector: '#header', settle: { lazyImages: true } },
      { id: 'smooth-full', kind: 'page', path: '/smooth', settle: { lazyImages: true } },
      { id: 'smooth-header', kind: 'component', path: '/smooth', selector: '#header', settle: { lazyImages: true } },
      { id: 'debounced-header', kind: 'component', path: '/debounced', selector: '#header', settle: { lazyImages: true } },
      { id: 'debounced-header-settled', kind: 'component', path: '/debounced', selector: '#header', settle: { lazyImages: true, afterSweep: ['#header:not(.scrolled)'] } },
      { id: 'debounced-full-settled', kind: 'page', path: '/debounced', settle: { lazyImages: true, afterSweep: ['#header:not(.scrolled)'] } },
    ], viewports: [{ id: 'small', width: 300, height: 200 }], runsRoot: 'runs' }));
  const height = (run, id) => run.captures.find(entry => entry.targetId === id).height;
  const before = await capture({ configPath, side: 'local' });
  assert.equal(before.run.state, 'complete');
  const failures = [];
  const heights = { without: [height(before.run, 'debounced-header')], with: [height(before.run, 'debounced-header-settled')] };
  for (let index = 1; index <= 3; index++) {
    const after = await capture({ configPath, side: 'local' });
    assert.equal(after.run.state, 'complete');
    heights.without.push(height(after.run, 'debounced-header'));
    heights.with.push(height(after.run, 'debounced-header-settled'));
    const result = await compareRuns({ runsRoot: join(directory, 'runs'), runA: before.run.id, runB: after.run.id, outputDir: join(directory, `after-${index}`) });
    for (const entry of result.report.entries) {
      // Without afterSweep the debounced page shows the scrolled header. That is the defect R5.15 opts out of, checked below.
      if (entry.id === 'debounced-header') continue;
      const cell = entry.viewports[0];
      if (cell.state !== 'complete' || cell.ratio !== 0) failures.push(`after ${index}, ${entry.id}: ${cell.state}, ratio ${cell.ratio}`);
    }
  }
  assert.deepEqual(failures, [], 'Before plus three after with lazyImages give 0 differences (#353, R5.15).');
  for (const run of [before.run]) for (const id of ['header', 'smooth-header']) {
    assert.equal(height(run, id), 70, `${id} shows its top state: strip and bar.`);
  }
  // Both directions on the debounced page: 30 px is the bar alone (scrolled), 70 px is strip and bar (top state).
  assert.deepEqual(heights.without, [30, 30, 30, 30], 'Without afterSweep each capture shows the scrolled header.');
  assert.deepEqual(heights.with, [70, 70, 70, 70], 'With afterSweep each capture shows the top state.');

  // R5.15: a selector that stays hidden after the restore fails the capture and names the selector.
  const failingPath = join(directory, 'failing.json');
  await writeFile(failingPath, JSON.stringify({ schemaVersion: 1, sides: { local: { origin: `http://127.0.0.1:${site.address().port}` } },
    targets: [{ id: 'never', kind: 'page', path: '/debounced', settle: { lazyImages: true, afterSweep: ['#header.never'] } }],
    viewports: [{ id: 'small', width: 300, height: 200 }], screenshot: { timeoutMs: 2000 }, runsRoot: 'runs-failing' }));
  const failed = await capture({ configPath: failingPath, side: 'local' });
  const failedEntry = failed.run.captures[0];
  assert.equal(failedEntry.state, 'failed');
  // The stored code is the phase code, as for a pin with no match (R5.12). AFTER_SWEEP_NOT_VISIBLE stays internal.
  assert.equal(failedEntry.error.code, 'CAPTURE_SETTLEMENT_FAILED');
  assert.match(failedEntry.error.message, /afterSweep selector "#header\.never" matches no visible element/);
  console.log(`Lazy-image settlement: before plus three after give 0 differences. Debounced header height without afterSweep: ${heights.without.join(', ')} px; with afterSweep: ${heights.with.join(', ')} px. A hidden afterSweep selector fails the capture.`);
} finally {
  site.close(); await rm(directory, { recursive: true, force: true });
}
