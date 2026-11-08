import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { capture } from '../../src/capture/index.js';
import { compareRuns } from '../../src/compare/runs.js';

// #353 (R5.9): the lazy-image sweep scrolls with `behavior: 'instant'`, and after it restores the scroll position, capture settles again.
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
const site = createServer((request, response) => {
  if (request.url === '/image.svg') {
    response.setHeader('Content-Type', 'image/svg+xml');
    response.end('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>');
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.end(page(request.url === '/smooth'));
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
    ], viewports: [{ id: 'small', width: 300, height: 200 }], runsRoot: 'runs' }));
  const before = await capture({ configPath, side: 'local' });
  assert.equal(before.run.state, 'complete');
  const failures = [];
  for (let index = 1; index <= 3; index++) {
    const after = await capture({ configPath, side: 'local' });
    assert.equal(after.run.state, 'complete');
    const result = await compareRuns({ runsRoot: join(directory, 'runs'), runA: before.run.id, runB: after.run.id, outputDir: join(directory, `after-${index}`) });
    for (const entry of result.report.entries) {
      const cell = entry.viewports[0];
      if (cell.state !== 'complete' || cell.ratio !== 0) failures.push(`after ${index}, ${entry.id}: ${cell.state}, ratio ${cell.ratio}`);
    }
  }
  assert.deepEqual(failures, [], 'Before plus three after with lazyImages give 0 differences (#353).');
  for (const run of [before.run]) for (const id of ['header', 'smooth-header']) {
    assert.equal(run.captures.find(entry => entry.targetId === id).height, 70, `${id} shows its top state: strip and bar.`);
  }
  console.log('Lazy-image settlement: scroll-driven state reverts before the screenshot; before plus three after give 0 differences.');
} finally {
  site.close(); await rm(directory, { recursive: true, force: true });
}
