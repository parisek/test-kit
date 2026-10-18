// Runner test for the a11y pack. It skips when Playwright, a browser or axe-core is not installed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolveChecks, runChecks } from '../../src/packs/index.js';
import { a11yPack } from '../../src/packs/a11y/index.js';
import { runAxe } from '../../src/packs/a11y/runner.js';

const skip = reason => { console.log(`check-a11y-runner skipped: ${reason}`); process.exit(0); };
const require = createRequire(import.meta.url);
try { require.resolve('axe-core/axe.min.js'); } catch { skip('axe-core is not installed.'); }
let chromium;
try { ({ chromium } = await import('@playwright/test')); } catch { skip('@playwright/test is not installed.'); }
let browser;
try { browser = await chromium.launch(); } catch { skip('no Chromium browser is installed.'); }

const plan = resolveChecks({ available: [a11yPack], packs: ['a11y'] });
const run = value => runChecks(plan, { artifact: 'a11y', value }, { targetId: 'example-site' });
try {
  const page = await browser.newPage();
  await page.setContent(await readFile(fileURLToPath(new URL('../fixtures/a11y/page.html', import.meta.url)), 'utf8'));

  const artifact = await runAxe(page);
  assert.equal(artifact.status, 'complete');
  assert.equal(artifact.tool, 'axe-core');
  const result = run(artifact);
  const ids = new Set(result.findings.map(finding => finding.evidence.ruleId));
  assert.ok(ids.has('image-alt'), 'image-alt fires on the fixture');
  assert.ok(ids.has('link-name'), 'link-name fires on the fixture');
  const imageAlt = result.findings.find(finding => finding.evidence.ruleId === 'image-alt');
  assert.equal(imageAlt.layer, 'package');
  assert.equal(imageAlt.severity, 'error');
  assert.equal(imageAlt.evidence.selector, '#no-alt');
  assert.match(imageAlt.evidence.helpUrl, /^https:\/\//);

  // A missing axe file gives missing, never complete.
  const missing = await runAxe(page, { axePath: '/nonexistent/axe.min.js' });
  assert.equal(missing.status, 'missing');
  assert.equal(run(missing).state, 'missing');

  // A broken axe run gives failed, never complete.
  const failed = await runAxe(page, { tags: 'not-a-list' });
  assert.equal(failed.status, 'failed');
  assert.equal(run(failed).state, 'failed');

  // A closed page gives failed.
  const closed = await browser.newPage();
  await closed.close();
  assert.equal((await runAxe(closed)).status, 'failed');
  console.log('check-a11y-runner passed');
} finally {
  await browser.close();
}
