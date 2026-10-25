import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile, realpath, lstat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptReport } from '../report/model.js';
import { boundedRead, reportFiles, readReportFile } from '../server/files.js';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));

function rewrite(value, paths, field = '', parent = '') {
	if (typeof value === 'string') return (['src', 'screenshot', 'traceA', 'traceB', 'json', 'html', 'evidence'].includes(field) || (parent === 'shots' && ['target', 'render', 'diff'].includes(field))) ? paths.get(value) ?? value : value;
	if (Array.isArray(value)) return value.map(item => rewrite(item, paths, field, parent));
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item, paths, key, field)]));
	return value;
}

// Read and validate a report and plan its evidence names. It creates nothing.
export async function prepareReportEvidence(reportPath) {
	const source = await realpath(reportPath);
	const root = dirname(source);
	const original = JSON.parse(await boundedRead(source));
	let adapted;
	try { adapted = adaptReport(original); } catch (error) { error.code = 'EINVALIDREPORT'; throw error; }
	const files = await reportFiles(adapted, root);
	const paths = new Map([...files].map(([src, descriptor]) => {
		const extension = descriptor.type === 'image/png' ? '.png' : descriptor.type === 'application/zip' ? '.zip' : descriptor.type === 'application/json' ? '.json' : descriptor.attachment ? '.html.txt' : '.txt';
		return [src, 'evidence/' + createHash('sha256').update(src).digest('hex') + extension];
	}));
	return { root, original, files, paths };
}

// Write report.json and its allowed evidence into `targetDir` with safe generated names.
// It adds no viewer. Export and publish share it (R10.11, R10.12).
export async function writeReportEvidence({ reportPath, targetDir, prepared }) {
	const { root, original, files, paths } = prepared ?? await prepareReportEvidence(reportPath);
	const written = [];
	async function store(path, data) {
		await mkdir(dirname(join(targetDir, path)), { recursive: true });
		await writeFile(join(targetDir, path), data, { flag: 'wx' });
		written.push(path);
	}
	for (const [src, descriptor] of files) {
		let data = await readReportFile(root, src, descriptor.maxBytes);
		// Raw Lighthouse JSON is evidence. Comparison sidecars can contain nested paths.
		if (descriptor.type === 'application/json' && descriptor.maxBytes === 2 * 1024 * 1024) data = JSON.stringify(rewrite(JSON.parse(data), paths));
		await store(paths.get(src) ?? src, data);
	}
	await store('report.json', JSON.stringify(rewrite(original, paths)));
	return { written, paths };
}

// Export only evidence that the loopback viewer can serve. Raw HTML is inert.
export async function exportReport({ reportPath, outputDir }) {
	if (!outputDir) throw new Error('An export output directory is required.');
	const outputPath = resolve(outputDir);
	const source = await realpath(reportPath);
	try { await lstat(outputPath); throw new Error('The export output already exists.'); }
	catch (error) { if (error.code !== 'ENOENT') throw error; }
	// Read and validate before any directory is created.
	const prepared = await prepareReportEvidence(source);
	await mkdir(dirname(outputPath), { recursive: true });
	const stage = await mkdtemp(join(dirname(outputPath), '.test-kit-export-'));
	let reserved = false;
	try {
		const { written, paths } = await writeReportEvidence({ reportPath, targetDir: stage, prepared });
		for (const name of ['index.html', 'app.js', 'style.css', 'favicon.svg']) {
			await writeFile(join(stage, name), await readReportFile(packageRoot, 'viewer/' + name), { flag: 'wx' });
			written.push(name);
		}
		// mkdir reserves the destination without replacing an existing export.
		await mkdir(outputPath); reserved = true;
		await rename(stage, outputPath); reserved = false;
		return { outputPath, files: written, paths: Object.fromEntries(paths) };
	} catch (error) {
		if (reserved) await rm(outputPath, { recursive: true, force: true });
		throw error;
	} finally { await rm(stage, { recursive: true, force: true }); }
}
