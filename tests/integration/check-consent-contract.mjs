import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { runBehavior } from '../../src/behavior/index.js';
import { consentBar, createConsentBar } from '../../templates/contracts/consent-bar.contract.js';

// #380: the sample consent contract against fixture pages with the markup of the defaults. No consent library is loaded.
const bar = ({ reject = true, botAware = false, sticky = false, noCookie = false, descLink = false }) => `<!doctype html><html><body><p>Example site</p>
<div id="cc-main"><div class="cm" style="position:fixed;bottom:0;width:300px;height:80px">
<p class="cm__desc">We use cookies.${descLink ? ' <a href="#" class="cm__link">Refuse</a>' : ''}</p><button data-role="all">Accept all</button>${reject ? '<button data-role="necessary">Reject all</button>' : ''}</div></div>
<script>
const main = document.getElementById('cc-main');
if (${botAware} && navigator.webdriver) main.remove();
document.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click', () => {
  const categories = button.dataset.role === 'all' ? ['necessary', 'analytics'] : ['necessary'];
  if (!${noCookie}) document.cookie = 'cc_cookie=' + encodeURIComponent(JSON.stringify({ categories })) + '; path=/';
  if (!${sticky}) main.querySelector('.cm').style.display = 'none';
}));
</script></body></html>`;
const pages = { '/': bar({}), '/sticky': bar({ sticky: true }), '/no-cookie': bar({ noCookie: true }), '/desc-link': bar({ reject: false, descLink: true }), '/no-reject': bar({ reject: false }), '/bot-aware': bar({ botAware: true }), '/no-bar': '<!doctype html><p>Example site</p>' };
const server = createServer((request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(pages[new URL(request.url, 'http://x').pathname] ?? ''); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const directory = await mkdtemp(join(tmpdir(), 'test-kit-consent-'));
const browser = await chromium.launch({ headless: true });
async function measure(path, contract = consentBar) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${origin}${path}`);
    const result = await runBehavior({ page, contracts: [contract], projectName: 'desktop-1280', artifactDir: join(directory, path.replace(/\W/g, '_') || 'home'), relativeDir: 'behavior/consent' });
    return result.steps.find(step => step.id !== 'consent-bar-detect') ?? result.steps[0];
  } finally { await context.close(); }
}
try {
  const ok = await measure('/');
  assert.equal(ok.state, 'complete', ok.error);
  assert.deepEqual(ok.result, { rendered: true, refusal: 'control' });
  const noReject = await measure('/no-reject');
  assert.equal(noReject.state, 'failed'); assert.match(noReject.error, /no visible refusal/);
  const botAware = await measure('/bot-aware');
  assert.equal(botAware.state, 'failed'); assert.match(botAware.error, /navigator\.webdriver/);
  const noBar = await measure('/no-bar');
  assert.equal(noBar.state, 'failed'); assert.match(noBar.error, /no visible box/);
  const clicked = await measure('/', createConsentBar({ clickRefusal: true }));
  assert.equal(clicked.state, 'complete', clicked.error);
  assert.deepEqual(clicked.result, { rendered: true, refusal: 'control', categories: ['necessary'] });
  const wrong = await measure('/', createConsentBar({ clickRefusal: true, refusal: { control: '[data-role="all"]' } }));
  assert.equal(wrong.state, 'failed'); assert.match(wrong.error, /more than the necessary categories: analytics/);
  const sentence = await measure('/no-reject', createConsentBar({ refusal: { control: null, sentence: 'we use cookies' } }));
  assert.equal(sentence.state, 'complete', sentence.error); assert.equal(sentence.result.refusal, 'sentence');
  const sticky = await measure('/sticky', createConsentBar({ clickRefusal: true }));
  assert.equal(sticky.state, 'failed'); assert.match(sticky.error, /stays visible after the refusal/);
  const noCookie = await measure('/no-cookie', createConsentBar({ clickRefusal: true }));
  assert.equal(noCookie.state, 'failed'); assert.match(noCookie.error, /no readable cc_cookie cookie/);
  const inDescription = await measure('/desc-link', createConsentBar({ refusal: { control: null, inDescription: '.cm__desc a' } }));
  assert.equal(inDescription.state, 'complete', inDescription.error); assert.equal(inDescription.result.refusal, 'in-description');
  assert.equal(createConsentBar({ name: 'consent-bar-refusal' }).name, 'consent-bar-refusal');
  console.log('Consent contract: a visible bar with refusal passes, a refusal click keeps only the necessary category, and a missing refusal, a hidden bar, a bot-aware bar, a bar that stays after the refusal and a missing choice cookie fail with a reason.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
