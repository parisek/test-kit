import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { runBehavior, compareBehavior } from '../../src/behavior/index.js';
const server = createServer((request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(`<button aria-expanded="false">Open</button><script>window.dataLayer=[];document.querySelector('button').onclick=e=>{e.target.setAttribute('aria-expanded',location.search?'false':'true');console.log('opened');dataLayer.push({event:'open'});fetch('/event',{method:'POST'}).catch(()=>{})}</script>`); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const directory = await mkdtemp(join(tmpdir(), 'test-kit-behavior-'));
const browser = await chromium.launch({ headless: true });
const contract = { name: 'disclosure', detect: page => page.locator('button').all(), run: async (page, button) => { await button.click(); const expanded = await button.getAttribute('aria-expanded'); if (expanded !== 'true') throw new Error('Disclosure does not expand.'); return { expanded }; } };
try {
  const results = [];
  for (const side of ['a', 'b']) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    let blocked = 0;
    await context.route('**/*', route => { const request = route.request(); if (new URL(request.url()).origin !== origin || !['GET', 'HEAD'].includes(request.method())) { blocked++; return route.abort(); } return route.continue(); });
    const page = await context.newPage();
    await page.goto(`${origin}/${side === 'b' ? '?broken' : ''}`);
    const result = await runBehavior({ page, contracts: [contract], projectName: 'desktop-1280', artifactDir: join(directory, side), relativeDir: `behavior/${side}`, trace: true });
    assert.equal(result.steps.length, 2);
    assert.equal(result.steps[1].evidence.console[0].text, 'opened');
    assert.equal(result.steps[1].evidence.dataLayer[0].event, 'open');
    assert.equal(blocked, 1);
    assert.ok((await stat(join(directory, side, 'disclosure-1.png'))).size > 0);
    assert.ok((await stat(join(directory, side, 'trace.zip'))).size > 0);
    results.push(result);
    await context.close();
  }
  assert.equal(results[0].state, 'complete');
  assert.equal(results[1].state, 'failed');
  assert.equal(compareBehavior(...results).steps[1].state, 'failed');
  const timedContext = await browser.newContext();
  const timedPage = await timedContext.newPage();
  await timedPage.goto(origin);
  const timed = await runBehavior({ page: timedPage, contracts: [{ name: 'blocked-script', detect: async page => { await page.evaluate(() => { while (true) {} }); return []; }, run() {} }], projectName: 'desktop-1280', artifactDir: join(directory, 'timeout'), relativeDir: 'behavior/timeout', timeoutMs: 50 });
  assert.equal(timed.state, 'failed'); assert.equal(timed.steps[0].error, 'Behavior step timed out.');
  assert.equal(timedPage.isClosed(), true);
  console.log('Behavior engine: real interaction, retained failure, local evidence and blocked POST verified.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
