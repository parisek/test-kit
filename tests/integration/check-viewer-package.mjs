// Check the package boundary, not the development checkout.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'test-kit-package-'));
let viewer;
let browser;
function npm(args) {
	const result = spawnSync('npm', args, { cwd: root, encoding: 'utf8' });
	if (result.status !== 0) throw new Error(result.stderr || 'Package command failed.');
	return result.stdout;
}
try {
	const [pack] = JSON.parse(
		npm(['pack', '--ignore-scripts', '--pack-destination', temp, '--json']),
	);
	npm([
		'install',
		'--prefix',
		join(temp, 'consumer'),
		join(temp, pack.filename),
		'--prefer-offline',
		'--ignore-scripts',
		'--omit=dev',
		'--no-audit',
		'--no-fund',
	]);
	const installed = join(temp, 'consumer/node_modules/@parisek/test-kit');
	for (const excluded of ['frontend', 'node_modules/vue'])
		await assert.rejects(access(join(installed, excluded)));
	await assert.rejects(access(join(temp, 'consumer/node_modules/vue')));
	for (const file of [
		'viewer/app.js',
		'viewer/index.html',
		'viewer/style.css',
		'THIRD_PARTY_NOTICES.txt',
	]) {
		assert.deepEqual(await readFile(join(installed, file)), await readFile(join(root, file)));
	}
	const reportPath = join(temp, 'report.json');
	await writeFile(
		reportPath,
		JSON.stringify({
			schemaVersion: 2,
			meta: { title: 'Example comparison', matchBelow: 3, viewports: [{ id: 'phone' }] },
			runs: [{ id: 'a' }, { id: 'b' }],
			pair: { kind: 'adhoc', aRunId: 'a', bRunId: 'b' },
			entries: [
				{
					id: 'home',
					title: 'Example page',
					viewports: [{ id: 'phone', state: 'failed', diagnostic: 'Capture failed.' }],
				},
			],
			causes: [],
			findings: [],
			rules: {},
		}),
	);
	const { serve } = await import(pathToFileURL(join(installed, 'src/server/serve.js')));
	viewer = await serve({ reportPath });
	browser = await chromium.launch();
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(viewer.origin);
	await page.locator('#notice').filter({ hasText: 'Loaded' }).waitFor();
	assert.match(await page.locator('#content').textContent(), /Capture failed/);
	assert.deepEqual(errors, []);
	console.log('Installed viewer works without frontend source, dependencies, or a build step.');
} finally {
	if (browser) await browser.close();
	if (viewer) await viewer.close();
	await rm(temp, { recursive: true, force: true });
}
