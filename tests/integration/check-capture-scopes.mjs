import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture } from '../../src/capture/index.js';
import { compareRuns } from '../../src/compare/runs.js';
import { settingsHash, screenshotScope } from '../../src/config/settings.js';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { captureScopedScreenshot } from '../../src/capture/scope.js';
const site = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><title>Example site</title><style>html,body{margin:0;background:white}body{height:1000px}div{position:absolute}#one{left:20px;top:10px;width:80px;height:40px;background:red}#two{left:20px;top:400px;width:80px;height:60px;background:blue}#padded{box-sizing:border-box;left:120.25px;top:20.5px;width:120.5px;height:100.5px;border:5.5px solid black;padding:10.25px;background:yellow}#padded span{display:block;width:100%;height:100%;background:green}</style><div id="one"></div><div id="two"></div><div id="padded"><span>Content</span></div>`);
});
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
const directory = await mkdtemp(join(tmpdir(), 'test-kit-capture-scopes-'));
const rgb = (png, x, y) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 300, height: 200 }, deviceScaleFactor: dpr });
    const page = await context.newPage(); await page.goto(`http://127.0.0.1:${site.address().port}`);
    const union = await captureScopedScreenshot({ page, selector: ['#one', '#two'], options: { animations: 'disabled' } });
    const unionPng = PNG.sync.read(union.bytes);
    assert.equal(union.geometry.fullPage, true); assert.equal(unionPng.width, 80 * dpr); assert.equal(unionPng.height, 450 * dpr);
    assert.deepEqual(rgb(unionPng, 20 * dpr, 440 * dpr), [0, 0, 255], 'Tall crop retains the lower target.');
    const content = await captureScopedScreenshot({ page, selector: '#padded', box: 'content', options: { animations: 'disabled' } });
    const contentPng = PNG.sync.read(content.bytes);
    assert.equal(content.geometry.fullPage, true, 'Content framing uses one document coordinate policy at every scroll position.');
    // Chromium rounds computed border widths to device pixels. Use the measured clip contract.
    assert.equal(contentPng.width, content.geometry.clip.width * dpr); assert.equal(contentPng.height, content.geometry.clip.height * dpr);
    assert.ok(contentPng.width < 120.5 * dpr); assert.ok(contentPng.height < 100.5 * dpr);
    assert.deepEqual(rgb(contentPng, Math.floor(contentPng.width / 2), contentPng.height - 5 * dpr), [0, 128, 0], 'Content crop omits the border and padding.');
    for (const mutation of [
      { selector: '#padded', property: 'transform', value: 'scale(2)' },
      { selector: 'body', property: 'transform', value: 'scale(1.5)' },
      { selector: '#padded', property: 'scale', value: '1.5' },
      { selector: 'body', property: 'rotate', value: '10deg' },
      { selector: '#padded', property: 'translate', value: '10px' },
      { selector: 'body', property: 'zoom', value: '1.5' },
    ]) {
      await page.evaluate(mutation => document.querySelector(mutation.selector).style[mutation.property] = mutation.value, mutation);
      await assert.rejects(captureScopedScreenshot({ page, selector: '#padded', box: 'content' }), /transformed or zoomed/);
      await page.evaluate(mutation => document.querySelector(mutation.selector).style[mutation.property] = '', mutation);
    }
    await page.evaluate(() => { window.scopeAnimation = document.querySelector('#one').animate([{ left: '20px', width: '80px' }, { left: '60px', width: '100px' }], { duration: 10000 }); });
    await assert.rejects(captureScopedScreenshot({ page, selector: ['#one', '#two'], options: { animations: 'disabled' } }), /settled animations/);
    await assert.rejects(captureScopedScreenshot({ page, selector: '#one', box: 'content', options: { animations: 'disabled' } }), /settled animations/);
    await page.evaluate(() => window.scopeAnimation.cancel());
    await page.evaluate(() => scrollTo(0, 350));
    const scrolled = await captureScopedScreenshot({ page, selector: ['#two'], options: { animations: 'disabled' } });
    const scrolledPng = PNG.sync.read(scrolled.bytes);
    assert.equal(scrolled.geometry.fullPage, false); assert.equal(scrolledPng.width, 80 * dpr); assert.equal(scrolledPng.height, 60 * dpr);
    assert.deepEqual(rgb(scrolledPng, 20 * dpr, 20 * dpr), [0, 0, 255], 'Viewport crop preserves a scrolled target.');
    const element = await captureScopedScreenshot({ page, selector: '#one', options: { animations: 'disabled' } });
    assert.equal(element.geometry.mode, 'element'); assert.equal(PNG.sync.read(element.bytes).height, 40 * dpr);
    await assert.rejects(captureScopedScreenshot({ page, selector: ['#absent'], options: { timeout: 50 } }));
    await context.close();
  }
  const configPath = join(directory, 'config.json');
  const config = { schemaVersion: 1, sides: { local: { origin: `http://127.0.0.1:${site.address().port}` } }, targets: [{ id: 'union', kind: 'component', path: '/', selector: ['#one', '#two'] }, { id: 'content', kind: 'component', path: '/', selector: '#padded', box: 'content' }], viewports: [{ id: 'wide', width: 300, height: 200 }], runsRoot: 'runs' };
  await writeFile(configPath, JSON.stringify(config));
  const a = await capture({ configPath, side: 'local' });
  const b = await capture({ configPath, side: 'local' });
  assert.equal(a.run.state, 'complete'); assert.equal(b.run.state, 'complete');
  assert.equal(a.run.captures[0].height, 450);
  assert.equal(a.run.captures[0].scopeHash, settingsHash(screenshotScope(config.targets[0])));
  const same = await compareRuns({ runsRoot: join(directory, 'runs'), runA: a.run.id, runB: b.run.id, outputDir: join(directory, 'report') });
  assert.equal(same.report.entries[0].viewports[0].state, 'complete');
  assert.equal(same.report.entries[0].viewports[0].ratio, 0);
  const manifest = JSON.parse(await readFile(b.manifestPath));
  manifest.settings.targets[0].selector = ['#two'];
  await writeFile(b.manifestPath, JSON.stringify(manifest));
  const changedScope = await compareRuns({ runsRoot: join(directory, 'runs'), runA: a.run.id, runB: b.run.id, outputDir: join(directory, 'changed-scope') });
  assert.equal(changedScope.report.entries[0].viewports[0].state, 'incompatible');
  assert.equal(changedScope.report.entries[1].viewports[0].state, 'complete', 'One target scope does not invalidate other target captures.');
  console.log('Scoped capture: DPR 1/2, tall unions, content boxes, scrolled clips and missing selectors pass.');
} finally { await browser.close(); await new Promise(resolve => site.close(resolve)); await rm(directory, { recursive: true, force: true }); }
