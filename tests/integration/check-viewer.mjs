// Explicit browser check. Engine unit tests do not run a browser.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { serve } from '../../src/server/serve.js';

const directory = await mkdtemp(join(tmpdir(), 'test-kit-viewer-'));
let viewer;
let browser;
try {
	const report = {
		schemaVersion: 2,
		meta: {
			title: '<img src=x onerror=alert(1)>',
			matchBelow: 3,
			noiseFloor: null,
			viewports: [{ id: 'mobile' }, { id: 'desktop' }],
		},
		runs: [
			{
				id: 'a',
				side: 'local',
				label: 'Before',
				settle: { motion: 'disabled' },
				tools: [{ name: 'example-tool', version: '1' }],
			},
			{ id: 'b', label: 'After' },
		],
		pair: { kind: 'update', aRunId: 'a', bRunId: 'b' },
		entries: [
			{
				id: 'home',
				title: 'Example page',
				kind: 'page',
				path: '/',
				composedOf: ['button'],
				viewports: [
					{
						id: 'mobile',
						ratio: 1,
						state: 'complete',
						availability: { a: 'available', b: 'http-error' },
					},
					{ id: 'desktop', state: 'incompatible', diagnostic: 'Different viewport dimensions.' },
				],
			},
			{
				id: 'button',
				title: 'Example button',
				kind: 'component',
				viewports: [{ id: 'mobile', state: 'failed', error: 'Capture failed.' }],
			},
		],
		causes: [{ id: 'cause', title: 'Unknown change', known: false }],
		findings: [
			{
				id: 'f1',
				targetId: 'home',
				viewportId: 'mobile',
				artifact: 'screenshot',
				causeId: 'cause',
				message: '<script>window.injected=true</script>',
			},
		],
		rules: {},
	};
	const reportPath = join(directory, 'report.json');
	await writeFile(reportPath, JSON.stringify(report));
	viewer = await serve({ reportPath });
	assert.equal((await fetch(viewer.origin + '/src/report/model.js')).status, 404);
	browser = await chromium.launch();
	for (const width of [390, 860, 1100, 1440]) {
		const context = await browser.newContext({ viewport: { width, height: 900 } });
		await context.addInitScript(() => {
			Object.defineProperty(window, 'localStorage', {
				get() {
					throw new Error('Storage blocked.');
				},
			});
			window.cspViolations = [];
			document.addEventListener('securitypolicyviolation', (event) =>
				window.cspViolations.push(event.violatedDirective),
			);
		});
		const page = await context.newPage();
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto(viewer.origin);
		await page.locator('#notice').filter({ hasText: 'Loaded' }).waitFor();
		assert.equal(await page.locator('[data-view=findings]').getAttribute('aria-current'), 'page');
		assert.ok(
			await page
				.locator('#content')
				.textContent()
				.then((text) => text.includes('<img src=x onerror=alert(1)>')),
		);
		assert.equal(await page.locator('#content script, #content img').count(), 0);
		for (const view of ['detail', 'matrix', 'timeline', 'findings']) {
			await page.locator(`[data-view=${view}]`).click();
			assert.ok(
				await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
				`${view} overflows at ${width}`,
			);
		}
		await page.locator('[data-view=detail]').click();
		assert.match(await page.locator('#content').textContent(), /http-error/);
		await page.getByLabel('Viewport', { exact: true }).selectOption('desktop');
		assert.match(await page.locator('#content').textContent(), /incompatible/);
		await page.locator('#theme').click();
		assert.equal(
			await page.evaluate(() => document.documentElement.classList.contains('dark')),
			true,
		);
		await page.locator('#sidebar-toggle').focus();
		await page.keyboard.press('[');
		const expanded = await page.locator('#sidebar-toggle').getAttribute('aria-expanded');
		assert.equal(expanded, width <= 860 ? 'true' : 'false');
		if (expanded === 'true') await page.keyboard.press('Escape');
		await page.getByText('Report source', { exact: true }).click();
		await page.locator('#source').fill('https://example.invalid/report.json');
		await page.locator('#source-form').getByRole('button').click();
		assert.match(await page.locator('#notice').textContent(), /origin/);
		assert.deepEqual(errors, []);
		assert.deepEqual(await page.evaluate(() => window.cspViolations), []);
		await context.close();
	}
	for (const initialWidth of [390, 1100]) {
		const context = await browser.newContext({ viewport: { width: initialWidth, height: 900 } });
		await context.addInitScript(() => localStorage.setItem('test-kit-sidebar', 'visible'));
		const page = await context.newPage();
		await page.goto(viewer.origin);
		await page.locator('#notice').filter({ hasText: 'Loaded' }).waitFor();
		if (initialWidth > 860) {
			await page.locator('#theme').focus();
			await page.setViewportSize({ width: 390, height: 900 });
		}
		await page.waitForFunction(() =>
			document.querySelector('#sidebar').contains(document.activeElement),
		);
		assert.equal(await page.locator('header').evaluate((element) => element.inert), true);
		assert.equal(await page.locator('#content').evaluate((element) => element.inert), true);
		assert.equal(await page.locator('#sidebar').getAttribute('aria-modal'), 'true');
		await page.keyboard.press('Shift+Tab');
		assert.equal(
			await page.evaluate(() =>
				document.querySelector('#sidebar').contains(document.activeElement),
			),
			true,
		);
		await page.keyboard.press('Escape');
		assert.equal(await page.locator('header').evaluate((element) => element.inert), false);
		assert.equal(
			await page.evaluate(() => document.activeElement.id),
			initialWidth > 860 ? 'theme' : 'sidebar-toggle',
		);
		await context.close();
	}
	console.log(
		'Viewer checks pass at 390, 860, 1100, and 1440 px with blocked storage and strict CSP.',
	);
} finally {
	if (browser) await browser.close();
	if (viewer) await viewer.close();
	await rm(directory, { recursive: true, force: true });
}
