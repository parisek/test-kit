import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { capture } from '../../src/capture/index.js';
import { compareRuns } from '../../src/compare/runs.js';
import { queryArtifact } from '../../src/query/artifact.js';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { settlePage } from '../../src/capture/settle.js';
let imageRequests = 0, otherRequests = 0;
const requests = new Map();
const site = createServer((request, response) => {
  if (request.url === '/other') otherRequests++;
  requests.set(`${request.method} ${request.url}`, (requests.get(`${request.method} ${request.url}`) ?? 0) + 1);
  if (request.url === '/stalled.svg') { response.writeHead(200, { 'Content-Type': 'image/svg+xml' }); response.flushHeaders(); return; }
  if (request.url === '/image.svg') { imageRequests++; response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>'); return; }
  if (request.url === '/broken.svg') { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', 'text/html');
  if (request.url === '/stalled') response.end('<!doctype html><style>body{height:2000px}img{position:absolute;top:1600px;width:40px;height:40px}</style><img loading="lazy" src="/stalled.svg">');
  else if (request.url === '/tall') response.end('<!doctype html><style>body{height:30001px}</style>');
  else if (request.url === '/growing') response.end('<!doctype html><style>body{margin:0;height:1500px}</style><script>addEventListener("scroll",()=>{if(scrollY>0)document.body.style.height="2500px";});</script>');
  else response.end(`<!doctype html><title>Example site</title><style>body{margin:0;height:2000px}#shown,#focus-result,#hover-result{display:none}#focus:focus+#focus-result{display:block}#hover:hover #hover-result{display:block}img{position:absolute;top:1600px;width:40px;height:40px}</style><button id="open" onclick="document.querySelector('#shown').style.display='block'">Open</button><h1 id="shown">Revealed</h1><button id="focus">Focus</button><span id="focus-result">Focused</span><div id="hover">Hover<span id="hover-result">Hovered</span></div><a id="navigate" href="/other">Other page</a><a id="popup" target="_blank" href="/other">Popup</a><button id="blank" onclick="window.open('about:blank')">Blank popup</button><button id="submit" onclick="fetch('/submit',{method:'POST'}).catch(()=>{})">Submit</button><img id="lazy" loading="lazy" src="/image.svg"><img loading="lazy" src="/broken.svg">`);
});
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${site.address().port}`;
const browser = await chromium.launch();
const directory = await mkdtemp(join(tmpdir(), 'test-kit-capture-settlement-'));
try {
  const context = await browser.newContext({ viewport: { width: 500, height: 300 } });
  const page = await context.newPage(); page.setDefaultTimeout(500);
  await page.goto(origin);
  await settlePage({ page, recipe: { reveal: [{ action: 'hover', selector: '#hover' }], selectors: ['#hover-result'] } });
  await settlePage({ page, recipe: { reveal: [{ action: 'click', selector: '#open' }, { action: 'focus', selector: '#focus' }], selectors: ['#shown', '#focus-result'], waitMs: 0 } });
  assert.equal(await page.locator('#shown').isVisible(), true);
  assert.equal(page.url(), `${origin}/`);
  await page.evaluate(() => scrollTo(0, 100));
  const scrollBefore = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  await settlePage({ page, recipe: { lazyImages: true } });
  assert.deepEqual(await page.evaluate(() => ({ x: scrollX, y: scrollY })), scrollBefore);
  assert.equal(await page.locator('#lazy').evaluate(image => image.complete && image.naturalWidth === 40), true);
  assert.ok(imageRequests >= 1);
  await assert.rejects(settlePage({ page, recipe: { reveal: [{ action: 'click', selector: '#missing' }] } }));
  await assert.rejects(settlePage({ page, recipe: { selectors: ['#missing'] } }));
  await assert.rejects(settlePage({ page, recipe: {}, active: () => false }), /no longer active/);
  await page.goto(origin);
  await assert.rejects(settlePage({ page, recipe: { reveal: [{ action: 'click', selector: '#navigate' }] } }));
  await page.goto(`${origin}/tall`);
  await assert.rejects(settlePage({ page, recipe: { lazyImages: true } }), /height limit/);
  await page.goto(`${origin}/growing`);
  await assert.rejects(settlePage({ page, recipe: { lazyImages: true } }), /grows during settlement/);
  assert.equal(await page.evaluate(() => scrollY), 0, 'Failure restores the initial scroll position.');
  await page.setViewportSize({ width: 500, height: 10 });
  await assert.rejects(settlePage({ page, recipe: { lazyImages: true } }), /step limit/);
  await page.setViewportSize({ width: 500, height: 300 });
  await page.goto(`${origin}/stalled`, { waitUntil: 'domcontentloaded' });
  await assert.rejects(settlePage({ page, recipe: { lazyImages: true } }), /does not finish loading/);
  const settlementDirectory = await mkdtemp(join(tmpdir(), 'test-kit-settlement-'));
  try {
    const configPath = join(settlementDirectory, 'config.json');
    const config = { schemaVersion: 1, sides: { local: { origin } }, targets: [
      { id: 'revealed', kind: 'page', path: '/', settle: { reveal: [{ action: 'click', selector: '#open' }], selectors: ['#shown'] } },
      { id: 'other', kind: 'page', path: '/' }
    ], viewports: [{ id: 'wide', width: 500, height: 300 }], artifacts: ['screenshot','html','content'], checks: ['empty-title'], runsRoot: 'runs' };
    const save = () => writeFile(configPath, JSON.stringify(config));
    await save();
    const a = await capture({ configPath, side: 'local' }), b = await capture({ configPath, side: 'local' });
    assert.equal(a.run.state, 'complete'); assert.equal(b.run.state, 'complete');
    const compare = (second, name) => compareRuns({ runsRoot: join(settlementDirectory, 'runs'), runA: a.run.id, runB: second.run.id, outputDir: join(settlementDirectory, name) });
    const same = await compare(b, 'same');
    assert.ok(same.report.entries.every(entry => entry.viewports[0].state === 'complete'));
    assert.ok(same.report.entries.every(entry => entry.viewports[0].ratio === 0));
    config.targets[0].settle.waitMs = 1;
    await save(); const changed = await capture({ configPath, side: 'local' });
    const result = await compare(changed, 'changed');
    const row = result.report.entries.find(entry => entry.id === 'revealed').viewports[0];
    assert.equal(row.artifacts.screenshot.state, 'incompatible'); assert.equal(row.artifacts.content.state, 'incompatible');
    assert.equal(row.artifacts.html.state, 'complete');
    assert.equal(result.report.entries.find(entry => entry.id === 'other').viewports[0].state, 'complete');
    assert.equal(result.report.runs[0].settings.targets[0].settle.reveal[0].selector, '#open');
    for (const selector of ['#navigate', '#popup', '#blank']) {
      otherRequests = 0;
      config.targets = [{ id: 'navigation', kind: 'page', path: '/', settle: { reveal: [{ action: 'click', selector }] } }];
      await save(); const failed = await capture({ configPath, side: 'local' });
      assert.equal(failed.run.captures[0].state, 'failed', selector);
      assert.equal(failed.run.captures[0].error.code, 'SETTLEMENT_NAVIGATION_REQUIRED', selector);
      assert.equal(otherRequests, 0, 'Settlement does not fetch a second page.');
    }
  } finally { await rm(settlementDirectory, { recursive: true, force: true }); }
  await context.close();
  const configPath = join(directory, 'config.json');
  const config = { schemaVersion: 1, sides: { local: { origin, settle: { waitMs: 1, selectors: ['body'], reveal: [{ action: 'hover', selector: '#hover' }] } } },
    targets: [{ id: 'revealed', kind: 'page', path: '/', settle: { selectors: ['#shown'], reveal: [{ action: 'click', selector: '#open' }], waitMs: 2, lazyImages: true }, settleBySide: { local: { waitMs: 3 } } },
      { id: 'sibling', kind: 'page', path: '/', settle: { selectors: [], reveal: [] } }],
    viewports: [{ id: 'wide', width: 500, height: 300 }], artifacts: ['screenshot', 'content'], checks: ['heading-outline', 'empty-alt'], runsRoot: 'runs' };
  await writeFile(configPath, JSON.stringify(config));
  const a = await capture({ configPath, side: 'local' });
  const b = await capture({ configPath, side: 'local' });
  assert.equal(a.run.state, 'complete'); assert.equal(b.run.state, 'complete');
  const contentIndex = a.run.captures[0].artifacts.content;
  const snapshot = JSON.parse(gunzipSync(await readFile(join(a.runDir, contentIndex.path))));
  assert.ok(snapshot.text.includes('Revealed'), 'Content follows the reveal before extraction.');
  assert.ok(snapshot.headings.some(heading => heading.level === 1 && heading.text === 'Revealed'));
  const settledBody = gunzipSync(await readFile(join(a.runDir, contentIndex.bodyPath))).toString();
  assert.match(settledBody, /id="lazy" loading="eager"/);
  const siblingBody = gunzipSync(await readFile(join(a.runDir, a.run.captures[1].artifacts.content.bodyPath))).toString();
  assert.match(siblingBody, /id="lazy" loading="lazy"/, 'Sibling does not inherit target lazy-image mutation.');
  const same = await compareRuns({ runsRoot: join(directory, 'runs'), runA: a.run.id, runB: b.run.id, outputDir: join(directory, 'report') });
  assert.equal(same.report.entries[0].viewports[0].ratio, 0);
  const contentQuery = await queryArtifact(same.reportPath, { target: 'revealed', viewport: 'wide', artifact: 'content' });
  assert.ok(contentQuery.diff.checks.length > 0); assert.ok(contentQuery.diff.findings.length > 0);
  const manifest = JSON.parse(await readFile(b.manifestPath));
  manifest.settings.targets[0].settle.reveal[0].selector = '#focus';
  manifest.settings.targets[0].settleBySide.local.waitMs = 4;
  await writeFile(b.manifestPath, JSON.stringify(manifest));
  const modified = await compareRuns({ runsRoot: join(directory, 'runs'), runA: a.run.id, runB: b.run.id, outputDir: join(directory, 'modified') });
  const changed = modified.report.entries[0].viewports[0];
  assert.equal(changed.artifacts.screenshot.state, 'incompatible'); assert.equal(changed.artifacts.content.state, 'incompatible');
  assert.equal(modified.report.entries[1].viewports[0].state, 'complete', 'One target recipe change does not invalidate its sibling.');
  const beforeNavigation = requests.get('GET /other') ?? 0;
  config.targets = [{ id: 'navigation', kind: 'page', path: '/', settle: { reveal: [{ action: 'click', selector: '#navigate' }], selectors: [], waitMs: 0 } }];
  config.artifacts = ['screenshot']; config.checks = [];
  await writeFile(configPath, JSON.stringify(config));
  const navigation = await capture({ configPath, side: 'local' });
  assert.equal(navigation.run.captures[0].state, 'failed');
  assert.equal(requests.get('GET /other') ?? 0, beforeNavigation, 'Reveal navigation is blocked before server access.');
  const beforePost = requests.get('POST /submit') ?? 0;
  config.targets[0].settle.reveal[0].selector = '#submit';
  await writeFile(configPath, JSON.stringify(config));
  const submission = await capture({ configPath, side: 'local' });
  assert.equal(submission.run.captures[0].state, 'failed');
  assert.equal(requests.get('POST /submit') ?? 0, beforePost, 'Reveal submissions are blocked before server access.');
  console.log('Settlement: click/hover/focus, lazy-image readiness, broken image, scroll restoration and bounded failures pass.');
} finally { await browser.close(); await new Promise(resolve => site.close(resolve)); await rm(directory, { recursive: true, force: true }); }
