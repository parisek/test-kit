// Real local captures exercise the visual workspace (R10.2–R10.10).
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';
import { buildDemo } from '../../scripts/demo.mjs';
import { serve } from '../../src/server/serve.js';

const directory = await mkdtemp(join(tmpdir(), 'test-kit-workspace-'));
let server, browser;
try {
  const demo = await buildDemo({ outputRoot: directory });
  assert.deepEqual(demo.summary.counts, { unexplained: 2, explained: 1, match: 2, incomplete: 0, oracle: 0, unclassified: 0, total: 5 });
  server = await serve({ reportPath: demo.reportPath });
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.origin);
  await page.getByRole('heading', { name: 'Homepage', exact: true }).waitFor();
  // This section has an accessible label, but no region role without a heading in some browsers.
  const comparison = page.locator('[aria-label="Screenshot comparison"]');
  await comparison.locator('img').first().waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Screenshot comparison"] img')].every(image => image.naturalWidth > 0));
  assert.equal(await comparison.locator('img').count(), 2);
  await page.getByRole('button', { name: 'Overlay', exact: true }).click();
  const opacity = page.getByLabel(/B opacity/);
  await opacity.waitFor();
  await page.waitForFunction(() => !document.querySelector('#evidence-opacity').disabled);
  await opacity.fill('25');
  assert.equal(await opacity.inputValue(), '25');
  assert.equal(await comparison.locator('img').nth(1).evaluate(image => image.style.opacity), '0.25');
  await page.getByRole('button', { name: 'Difference', exact: true }).click();
  assert.equal(await comparison.locator('img').count(), 1);
  await page.getByRole('button', { name: 'HTML', exact: true }).click();
  await page.locator('[aria-label="HTML line comparison"]').waitFor();
  assert.match(await page.locator('[aria-label="HTML line comparison"]').textContent(), /good ideas|better ideas/);
  await page.getByRole('button', { name: 'Status', exact: true }).click();
  await page.getByText('200HTTP', { exact: true }).first().waitFor();
  await page.locator('#sidebar').getByRole('button', { name: /Support page/ }).click();
  await page.getByText('503HTTP', { exact: true }).waitFor();
  assert.match(await page.locator('#sidebar').textContent(), /HTTP\s*!/);
  await page.locator('#sidebar').getByRole('button', { name: /Primary button/ }).click();
  await page.getByRole('button', { name: 'Screenshot', exact: true }).click();
  await page.getByRole('button', { name: /mobile\s*390/ }).click();
  await page.getByRole('button', { name: 'Overlay', exact: true }).click();
  await page.getByText(/Image dimensions differ:/).waitFor();
  assert.equal(await opacity.isDisabled(), true);
  assert.equal(await page.locator('[aria-label="Screenshot comparison"] a[href]').count() >= 2, true);
  for (const width of [390, 860, 1100, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Workspace overflows at ${width}`);
  }
  await page.locator('[data-view=timeline]').click();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.keyboard.press('Escape');
  for (const details of await page.locator('.technical-details summary').all()) await details.click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Expanded provenance overflows on a phone');
  assert.deepEqual(errors, []);
  console.log('Visual workspace uses real local screenshots, guarded overlay, diff, HTML and HTTP evidence.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(directory, { recursive: true, force: true });
}
