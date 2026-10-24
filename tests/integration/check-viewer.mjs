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
		// R10.5: a report opens on Overview, whatever the pair kind.
		assert.equal(await page.locator('[data-view=overview]').getAttribute('aria-selected'), 'true');
		assert.ok(
			await page
				.locator('#content')
				.textContent()
				.then((text) => text.includes('<img src=x onerror=alert(1)>')),
		);
		assert.equal(await page.locator('#content script, #content img').count(), 0);
		for (const view of ['evidence', 'overview', 'info', 'findings']) {
			await page.locator(`[data-view=${view}]`).click();
            await page.waitForFunction((selected) =>
                document.querySelector('[data-view="' + selected + '"]').getAttribute('aria-selected') === 'true', view);
            const visible = {
                evidence: page.getByRole('heading', { name: 'Example page', exact: true }),
                overview: page.locator('#content table'),
                info: page.locator('.timeline-list').getByRole('heading', { name: 'Before', exact: true }),
                findings: page.getByRole('heading', { name: 'Unknown change', exact: true }),
            };
            await visible[view].waitFor();
			assert.ok(
				await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
				`${view} overflows at ${width}`,
			);
		}

        assert.match(await page.locator('[aria-label="Compared runs"]').textContent(), /Before/);
        await page.getByRole('button', { name: 'More filters' }).click();
        await page.getByLabel('Measurement filter').selectOption('failed');
        assert.match(await page.getByRole('region', { name: 'Report filters' }).textContent(), /1 of 2 targets/);
        assert.match(await page.locator('[aria-label="All target counts"] [data-status="incomplete"]').textContent(), /2\s*Incomplete \(state\)/);
        assert.match(await page.locator('#content').textContent(), /Availability problems: 1/);
        await page.getByLabel('Measurement filter').selectOption('missing');
        assert.match(await page.getByRole('region', { name: 'Report filters' }).textContent(), /1 of 2 targets/);
        await page.getByRole('button', { name: 'Clear filters' }).click();
        await page.getByRole('button', { name: 'More filters' }).click();
        await page.getByLabel('Cause filter').selectOption('cause:cause');
        await page.getByRole('button', { name: 'Example page · mobile evidence' }).click();
        assert.equal(await page.locator('[aria-label="Viewport"]').getByRole('button', { name: 'mobile', exact: true }).getAttribute('aria-pressed'), 'true');
        await page.getByRole('button', { name: 'Clear filters' }).click();
		await page.locator('[data-view=evidence]').click();
		assert.match(await page.locator('#content').textContent(), /http-error/);
		await page.locator('[aria-label="Viewport"]').getByRole('button', { name: 'desktop', exact: true }).click();
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
		// R10.10: a page that loads a report shows no source form.
		assert.equal(await page.locator('#source-form').count(), 0);
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
		// The target panel lives in the Evidence view only.
		await page.locator('[data-view=evidence]').click();
		if (initialWidth > 860) {
			await page.locator('#theme').focus();
			await page.setViewportSize({ width: 390, height: 900 });
		}
		await page.waitForFunction(() =>
			document.querySelector('#sidebar').contains(document.activeElement),
		);
		assert.equal(await page.locator('header.viewer-toolbar').evaluate((element) => Boolean(element.closest('[inert]'))), true);
		assert.equal(await page.locator('#content').evaluate((element) => Boolean(element.closest('[inert]'))), true);
		assert.equal(await page.locator('#sidebar').getAttribute('aria-modal'), 'true');
		await page.keyboard.press('Shift+Tab');
		assert.equal(
			await page.evaluate(() =>
				document.querySelector('#sidebar').contains(document.activeElement),
			),
			true,
		);
		await page.keyboard.press('Escape');
		assert.equal(await page.locator('header.viewer-toolbar').evaluate((element) => Boolean(element.closest('[inert]'))), false);
		assert.equal(
			await page.evaluate(() => document.activeElement.id),
			initialWidth > 860 ? 'theme' : 'tab-evidence',
		);
		await context.close();
	}
	// DESIGN.md control-touch: on a coarse pointer every control takes a 2.75rem (44px) tap.
	for (const width of [390, 1100]) {
		const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true, isMobile: true });
		const page = await context.newPage();
		await page.goto(viewer.origin);
		await page.locator('#notice').filter({ hasText: 'Loaded' }).waitFor();
		for (const view of ['overview', 'evidence', 'findings', 'info']) {
			await page.locator(`[data-view=${view}]`).first().click();
			// Run info has no target list, so it shows no filters.
			assert.equal(await page.getByRole('region', { name: 'Report filters' }).count(), view === 'info' ? 0 : 1, `${view}: filter panel`);
			// DESIGN.md "Layout" (#204): Evidence shows one line of counts. Run details opens the run cards.
			assert.equal(await page.locator('[aria-label="Target counts"]').isVisible(), view === 'evidence', `${view}: one-line counts`);
			assert.equal(await page.locator('[aria-label="Compared runs"]').isVisible(), view !== 'evidence', `${view}: run cards`);
			if (view === 'evidence') {
				await page.getByText('Run details', { exact: true }).click();
				assert.ok(await page.locator('[aria-label="Compared runs"]').isVisible(), 'Run details opens the run cards');
			}
			const small = await page.evaluate(() => [...document.querySelectorAll('button, a[href], select, input, summary, [role=tab]')]
				// checkVisibility() skips content inside a closed details element.
				.filter((element) => element.getBoundingClientRect().width && !element.disabled && !element.closest('[inert], [hidden]') && element.checkVisibility())
				.map((element) => {
					element.scrollIntoView({ block: 'center' });
					const box = element.getBoundingClientRect();
					const center = box.left + box.width / 2;
					const middle = box.top + box.height / 2;
					const hits = (x, y) => { const target = document.elementFromPoint(x, y); return Boolean(target) && (target === element || element.contains(target)); };
					const reach = (step) => { let distance = 0; while (distance < 30 && step(distance + 1)) distance++; return distance; };
					const height = reach((d) => hits(center, middle - d)) + reach((d) => hits(center, middle + d)) + 1;
					const width = reach((d) => hits(center - d, middle)) + reach((d) => hits(center + d, middle)) + 1;
					return height < 43 || width < 43 ? `${element.tagName} ${(element.getAttribute('aria-label') || element.textContent).trim().slice(0, 30)} ${width}x${height}` : null;
				})
				.filter(Boolean));
			assert.deepEqual(small, [], `${width} px ${view}: tap area under 2.75rem`);
		}
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
