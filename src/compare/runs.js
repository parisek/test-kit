import { readFile, mkdir, writeFile, copyFile, realpath, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, relative, dirname } from 'node:path';
import { relativePath } from '../report/safe.js';
import { validateReport } from '../report/model.js';

async function contained(root, path) {
	if (!relativePath(path)) throw new Error('Unsafe stored artifact path.');
	const base = await realpath(root);
	const file = await realpath(resolve(base, path));
	const offset = relative(base, file);
	if (offset.startsWith('..') || offset.startsWith('/') || offset === '') throw new Error('Stored artifact escapes its run.');
	return file;
}

async function readRun(root, id) {
	if (!relativePath(id) || id.includes('/')) throw new Error('Run must be a safe ID.');
	const path = await contained(root, `${id}/run.json`);
	const run = JSON.parse(await readFile(path, 'utf8'));
	if (run.schemaVersion !== 2 || run.id !== id || !Array.isArray(run.captures) || !Array.isArray(run.settings?.targets) || !Array.isArray(run.settings?.viewports)) throw new Error(`Invalid run ${id}.`);
	if (typeof run.settingsHash !== 'string' || !run.settingsHash.startsWith('sha256:') || !Array.isArray(run.tools) || run.tools.length === 0) throw new Error('Run provenance is missing.');
	for (const rows of [run.settings.targets, run.settings.viewports]) {
		const ids = new Set();
		for (const row of rows) {
			if (!row || !relativePath(row.id) || row.id.includes('/') || ids.has(row.id)) throw new Error('Unsafe or duplicate stored capture ID.');
			ids.add(row.id);
		}
	}
	return run;
}

function available(capture) {
	return capture?.statusCode == null ? 'unknown' : capture.statusCode >= 400 ? 'http-error' : 'ok';
}

export function comparisonState(a, b, runA, runB) {
	if (!a || !b) return 'missing';
	if (a.state !== 'captured' || b.state !== 'captured') return 'failed';
	if (runA.settingsHash !== runB.settingsHash || JSON.stringify(runA.tools) !== JSON.stringify(runB.tools)) return 'incompatible';
	return 'complete';
}

export async function compareRuns({ runsRoot, runA: aId, runB: bId, outputDir, kind = 'update' }) {
	const a = await readRun(runsRoot, aId);
	const b = await readRun(runsRoot, bId);
	const { PNG } = await import('pngjs');
	const { default: pixelmatch } = await import('pixelmatch');
	const { extractRegions } = await import('./regions.js');
	const output = resolve(outputDir);
	await mkdir(output, { recursive: true });
	if ((await readdir(output)).length) throw new Error('Comparison output directory must be empty.');
	const diffSettingsHash = `sha256:${createHash('sha256').update(JSON.stringify({ threshold: 0.1, padding: 'white', maxRegions: 8, minPixels: 1 })).digest('hex')}`;
	const viewports = new Map([...a.settings.viewports, ...b.settings.viewports].map((item) => [item.id, item]));
	const targets = new Map([...a.settings.targets, ...b.settings.targets].map((item) => [item.id, item]));
	const findings = [];
	const entries = [];
	for (const target of targets.values()) {
		const rows = [];
		for (const viewport of viewports.values()) {
			const ac = a.captures.find((item) => item.targetId === target.id && item.viewportId === viewport.id);
			const bc = b.captures.find((item) => item.targetId === target.id && item.viewportId === viewport.id);
			const row = { id: viewport.id, state: comparisonState(ac, bc, a, b), availability: { a: available(ac), b: available(bc) }, artifacts: { screenshot: { a: null, b: null, diff: null } } };
			const images = [];
			for (const [run, capture, key] of [[a, ac, 'a'], [b, bc, 'b']]) {
				if (capture?.state !== 'captured') { images.push(null); continue; }
				try {
					const source = await contained(join(runsRoot, run.id), capture.path);
					const bytes = await readFile(source);
					if (bytes.length > 80_000_000) throw new Error('PNG exceeds the file size limit.');
					if (bytes.length < 24 || bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 40_000_000) throw new Error('PNG exceeds the pixel limit.');
					const image = PNG.sync.read(bytes);
					const src = `runs/${run.id}/${capture.path}`;
					await mkdir(dirname(join(output, src)), { recursive: true });
					await copyFile(source, join(output, src));
					row.artifacts.screenshot[key] = { src, kind: 'screenshot', ...run.tools[0] };
					images.push(image);
				} catch (error) {
					row.state = 'failed'; row.diagnostic = String(error.message); images.push(null);
				}
			}
			if (row.state === 'complete' && images.every(Boolean)) {
				const [ai, bi] = images;
				const width = Math.max(ai.width, bi.width), height = Math.max(ai.height, bi.height);
				if (width * height > 40_000_000) { row.state = 'failed'; row.diagnostic = 'Comparison canvas exceeds 40 million pixels.'; rows.push(row); continue; }
				const pad = (image) => {
					const result = new PNG({ width, height }); result.data.fill(255);
					PNG.bitblt(image, result, 0, 0, image.width, image.height, 0, 0); return result;
				};
				const diff = new PNG({ width, height });
				const changed = pixelmatch(pad(ai).data, pad(bi).data, diff.data, width, height, { threshold: 0.1 });
				const ratio = 100 * changed / (width * height);
				const src = `diff/${target.id}/${viewport.id}.png`;
				await mkdir(dirname(join(output, src)), { recursive: true });
				await writeFile(join(output, src), PNG.sync.write(diff));
				row.ratio = ratio;
				row.artifacts.screenshot.diff = { src, kind: 'screenshot', tool: 'pixelmatch', version: '8.0.0', settingsHash: diffSettingsHash, ratio, size: { a: { width: ai.width, height: ai.height }, b: { width: bi.width, height: bi.height } }, regions: extractRegions(diff.data, width, height, { minPixels: 1 }).map(({ x, y, w, h, pixels }) => ({ x, y, width: w, height: h, pixels, unit: 'px' })) };
				if (changed || ai.width !== bi.width || ai.height !== bi.height) findings.push({ id: `${target.id}-${viewport.id}`, targetId: target.id, viewportId: viewport.id, artifact: 'screenshot', message: ai.width !== bi.width || ai.height !== bi.height ? 'Screenshot dimensions differ.' : 'Screenshot pixels differ.' });
			} else row.diagnostic ??= row.state === 'incompatible' ? 'Capture settings or tool versions differ.' : ac?.error?.message ?? bc?.error?.message ?? 'Evidence is missing.';
			rows.push(row);
		}
		entries.push({ id: target.id, kind: target.kind, title: target.title, path: target.path ?? '/', viewports: rows, artifacts: {} });
	}
	const report = { schemaVersion: 2, meta: { project: 'example-site', title: `${a.label} → ${b.label}`, generated: new Date().toISOString(), matchBelow: 3, primaryViewport: [...viewports.keys()][0], viewports: [...viewports.values()], noiseFloor: null, tools: [...a.tools, ...b.tools, { name: 'pixelmatch', version: '8.0.0', settingsHash: diffSettingsHash }] }, runs: [a, b].map((run) => ({ id: run.id, side: run.side, label: run.label, at: run.at, state: run.state, settings: { sides: { [run.side]: run.settings.sides[run.side] }, viewports: run.settings.viewports, screenshot: run.settings.screenshot }, tools: run.tools })), pair: { kind, aRunId: a.id, bRunId: b.id }, entries, causes: [], findings, rules: {} };
	const problems = validateReport(report);
	if (problems.length) throw new Error(problems.join(' '));
	const reportPath = join(output, 'report.json');
	await writeFile(reportPath, JSON.stringify(report, null, 2));
	return { report, reportPath };
}
