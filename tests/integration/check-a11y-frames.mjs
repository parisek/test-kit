// Frame test for the a11y runner (R13.51, #316). It skips when Playwright, a browser or axe-core is not installed.
// A top page holds a same-origin frame, a srcdoc frame and a frame of a second local origin (another port).
// Axe must find the violations of the first two and must not enter the third.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolveChecks, runChecks } from '../../src/packs/index.js';
import { a11yPack } from '../../src/packs/a11y/index.js';
import { runAxe } from '../../src/packs/a11y/runner.js';

const skip = reason => { console.log(`check-a11y-frames skipped: ${reason}`); process.exit(0); };
const require = createRequire(import.meta.url);
try { require.resolve('axe-core/axe.min.js'); } catch { skip('axe-core is not installed.'); }
let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { skip('@playwright/test is not installed.'); }
let browser;
try { browser = await chromium.launch(); } catch { skip('no Chromium browser is installed.'); }

const child = await readFile(fileURLToPath(new URL('../fixtures/a11y/frame-child.html', import.meta.url)), 'utf8');
const serve = routes => new Promise(resolve => {
  const server = http.createServer((req, res) => {
    const body = routes(req.url);
    res.writeHead(body === null ? 404 : 200, { 'content-type': 'text/html' });
    res.end(body ?? '');
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});
const foreign = await serve(() => child); // second origin: another port
const foreignPort = foreign.address().port;
const srcdoc = '<img id="srcdoc-no-alt" src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=">'.replace(/"/g, '&quot;');
let home;
const shell = body => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Example site</title></head><body><main><h1>Example site</h1>${body}</main></body></html>`;
const top = await serve(url => (url === '/child' ? child
  : url === '/many' ? shell(Array.from({ length: 55 }, (_, index) => `<iframe title="f${index}" srcdoc="&lt;p&gt;x&lt;/p&gt;"></iframe>`).join(''))
  : url === "/spoof" ? shell(`<iframe title="spoof" sandbox="allow-scripts" srcdoc="&lt;script&gt;Object.defineProperty(window, 'origin', { value: 'http://127.0.0.1:${top.address().port}' })&lt;/script&gt;&lt;p&gt;x&lt;/p&gt;"></iframe>`)
  : url === '/nested' ? shell(`<iframe title="nested" src="/nested-inner"></iframe>`)
  : url === '/nested-inner' ? `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Inner</title></head><body><main><h1>Inner</h1><iframe title="foreign" src="http://127.0.0.1:${foreignPort}/"></iframe></main></body></html>`
  : `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Example site</title></head><body><main><h1>Example site</h1>
<iframe title="same origin" src="/child" data-test-kit-axe-skip="mine"></iframe>
<iframe title="srcdoc" srcdoc="${srcdoc}"></iframe>
<iframe title="sandbox srcdoc" sandbox srcdoc="${srcdoc}"></iframe>
<iframe title="sandbox url" sandbox src="/child"></iframe>
<iframe title="other origin" data-test-kit-axe-skip="foreign" src="http://127.0.0.1:${foreignPort}/"></iframe>
</main></body></html>`));
home = `http://127.0.0.1:${top.address().port}/`;

const plan = resolveChecks({ available: [a11yPack], packs: ['a11y'] });
try {
  const page = await browser.newPage();
  await page.goto(home, { waitUntil: 'load' });
  assert.equal(page.frames().length, 6, 'the page holds five child frames');

  const started = Date.now();
  const artifact = await runAxe(page);
  assert.equal(artifact.status, 'complete');
  assert.deepEqual(artifact.frames, { injected: 2, unreachable: 3 });
  assert.ok(Date.now() - started < 20000, 'the foreign frame does not stall the run');

  const result = runChecks(plan, { artifact: 'a11y', value: artifact }, { targetId: 'example-site' });
  const selectors = result.findings.filter(finding => finding.evidence.ruleId === 'image-alt').map(finding => finding.evidence.selector);
  assert.ok(selectors.some(selector => selector.includes('#frame-no-alt')), `same-origin frame violation found: ${selectors}`);
  assert.ok(selectors.some(selector => selector.includes('#srcdoc-no-alt')), `srcdoc frame violation found: ${selectors}`);
  assert.equal(selectors.length, 2, 'the foreign frame gives no violation');
  const review = result.findings.filter(finding => finding.evidence.unreachableFrames !== undefined);
  assert.equal(review.length, 1);
  assert.equal(review[0].severity, 'warning');
  assert.equal(review[0].evidence.needsReview, true);
  assert.equal(review[0].evidence.unreachableFrames, 3);
  assert.equal(result.state, 'complete');

  // Axe never entered the foreign frame, and the run leaves no mark on the page.
  const foreignFrame = page.frames().find(frame => frame.url().includes(`:${foreignPort}`));
  assert.equal(await foreignFrame.evaluate(() => typeof globalThis.axe), 'undefined');
  // A page-owned attribute of the old fixed name survives with its value, and no random mark is left.
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('iframe')].map(node => node.getAttribute('data-test-kit-axe-skip'))), ['mine', null, null, null, 'foreign']);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('iframe')].flatMap(node => node.getAttributeNames()).filter(name => name.startsWith('data-test-kit-axe-skip-')).length), 0);

  // Sandboxed frames (opaque origin) got no axe, although their URLs look reachable.
  for (const frame of page.frames().filter(item => item !== page.mainFrame() && !item.url().includes(`:${foreignPort}`))) {
    const sandboxed = await frame.evaluate(() => self.origin === 'null');
    if (sandboxed) assert.equal(await frame.evaluate(() => typeof globalThis.axe), 'undefined', 'a sandboxed frame has no axe');
  }

  // 55 same-origin frames: only 50 run, 5 count as unreachable, and the time stays bounded.
  const many = await browser.newPage();
  await many.goto(`${home}many`, { waitUntil: 'load' });
  const manyStart = Date.now();
  const manyArtifact = await runAxe(many);
  assert.equal(manyArtifact.status, 'complete');
  assert.deepEqual(manyArtifact.frames, { injected: 50, unreachable: 5 });
  assert.ok(Date.now() - manyStart < 30000, 'a page with many frames stays bounded');
  let withAxe = 0;
  for (const frame of many.frames().filter(item => item !== many.mainFrame())) if (await frame.evaluate(() => typeof globalThis.axe) !== 'undefined') withAxe += 1;
  assert.equal(withAxe, 50);

  // A foreign frame nested in a same-origin frame gets no axe, is counted, and costs no frame wait.
  const nested = await browser.newPage();
  await nested.goto(`${home}nested`, { waitUntil: 'load' });
  const nestedStart = Date.now();
  const nestedArtifact = await runAxe(nested);
  assert.equal(nestedArtifact.status, 'complete');
  assert.deepEqual(nestedArtifact.frames, { injected: 1, unreachable: 1 });
  assert.ok(Date.now() - nestedStart < 4000, 'the nested foreign frame costs no wait');
  assert.equal(await nested.frames().find(frame => frame.url().includes(`:${foreignPort}`)).evaluate(() => typeof globalThis.axe), 'undefined');

  // A sandboxed frame (opaque origin) whose script redefines window.origin to the page origin still gets no axe.
  const spoof = await browser.newPage();
  await spoof.goto(`${home}spoof`, { waitUntil: 'load' });
  const spoofFrame = spoof.frames().find(frame => frame !== spoof.mainFrame());
  assert.equal(await spoofFrame.evaluate(() => self.origin), home.replace(/\/$/, ''), 'the frame spoofs its origin');
  const spoofed = await runAxe(spoof);
  assert.equal(spoofed.status, 'complete');
  assert.deepEqual(spoofed.frames, { injected: 0, unreachable: 1 });
  assert.equal(await spoofFrame.evaluate(() => typeof globalThis.axe), 'undefined', 'the spoofing frame has no axe');

  // Race: a frame that navigates to the second origin after classification gets no axe.
  const racePage = await browser.newPage();
  await racePage.goto(home, { waitUntil: 'load' });
  const mover = racePage.frames().find(frame => frame.url().endsWith('/child'));
  const original = mover.evaluate.bind(mover);
  mover.evaluate = async (...args) => { await mover.goto(`http://127.0.0.1:${foreignPort}/`); return original(...args); };
  const raced = await runAxe(racePage);
  assert.equal(raced.status, 'complete');
  assert.deepEqual(raced.frames, { injected: 1, unreachable: 4 });
  mover.evaluate = original;
  assert.equal(await mover.evaluate(() => typeof globalThis.axe), 'undefined', 'the moved frame has no axe');

  // A page with no frame has no frame warning.
  const plain = await browser.newPage();
  await plain.setContent('<!doctype html><html lang="en"><head><title>x</title></head><body><main><h1>x</h1></main></body></html>');
  const none = await runAxe(plain);
  assert.deepEqual(none.frames, { injected: 0, unreachable: 0 });
  assert.equal(runChecks(plan, { artifact: 'a11y', value: none }, { targetId: 'example-site' }).findings.some(finding => finding.evidence.unreachableFrames !== undefined), false);

  // The busy claim still works with frames: a second run at once fails, the page is released after.
  const both = await Promise.all([runAxe(page), runAxe(page)]);
  assert.deepEqual(both.map(item => item.status).sort(), ['complete', 'failed']);
  assert.equal((await runAxe(page)).status, 'complete');
  console.log('check-a11y-frames passed');
} finally {
  await browser.close();
  foreign.close();
  top.close();
}
