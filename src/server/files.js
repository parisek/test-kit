import { realpath, open } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { comparisonDetail } from '../artifacts/schema.js';
import { relativePath } from '../report/safe.js';

export const MAX_BYTES = 80_000_000;
export async function boundedRead(file, maxBytes = MAX_BYTES) {
	const handle = await open(file, 'r');
	try {
		const info = await handle.stat();
		if (!info.isFile() || info.size > maxBytes) throw Object.assign(new Error('File exceeds the size limit.'), { code: 'EFBIG' });
		const buffer = Buffer.alloc(info.size + 1);
		let length = 0;
		while (length < buffer.length) {
			const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
			if (!bytesRead) break;
			length += bytesRead;
		}
		if (length > info.size) throw Object.assign(new Error('File changes during reading.'), { code: 'EFBIG' });
		return buffer.subarray(0, length);
	} finally { await handle.close(); }
}


export async function reportFiles(report, reportRoot) {
	const assets = new Set();
	const sidecars = new Map();
	const attachments = new Set();
	const rawPerformance = new Set();
	for (const entry of report.entries) for (const row of entry.viewports) for (const kind of ['html', 'status', 'content', 'behavior', 'lighthouse']) {
		for (const side of ['a', 'b', 'diff', 'normalizedA', 'normalizedB']) {
			const index = row.artifacts?.[kind]?.[side];
			if (relativePath(index?.src)) sidecars.set(index.src, kind === 'html' && side !== 'diff' ? 'text/plain; charset=utf-8' : 'application/json');
		}
	}
	for (const entry of report.entries) for (const row of entry.viewports) for (const shot of Object.values(row.artifacts?.screenshot ?? {})) {
		if (relativePath(shot?.src) && extname(shot.src) === '.png') assets.add(shot.src);
	}
	for (const entry of report.entries) for (const row of entry.viewports) {
    const index = row.artifacts?.behavior?.diff;
    if (!relativePath(index?.src)) continue;
    const file = await realpath(resolve(reportRoot, index.src));
    const offset = relative(reportRoot, file);
    if (!offset || offset.startsWith('../') || offset === '..') throw new Error('Behavior sidecar escapes report root.');
    const detail = comparisonDetail('behavior', JSON.parse(await boundedRead(file, 2 * 1024 * 1024)));
    for (const step of detail.steps) for (const result of [step.resultA, step.resultB]) {
      const src = result?.evidence?.screenshot;
      if (relativePath(src) && src.endsWith('.png')) assets.add(src);
    }
    for (const src of [detail.traceA, detail.traceB]) if (relativePath(src) && src.endsWith('.zip')) attachments.add(src);
  }
	for (const entry of report.entries) for (const row of entry.viewports) for (const side of ['a', 'b']) {
		const reports = row.artifacts?.lighthouse?.[side]?.reports;
		if (!Array.isArray(reports)) continue;
		for (const raw of reports.slice(0, 5)) for (const kind of ['json', 'html']) {
			const src = raw?.[kind]?.src;
			if (relativePath(src) && src.endsWith('.' + kind)) { rawPerformance.add(src); sidecars.set(src, kind === 'html' ? 'text/plain; charset=utf-8' : 'application/json'); }
		}
	}
	const files = new Map();
	for (const src of assets) files.set(src, { type: 'image/png', maxBytes: MAX_BYTES });
	for (const src of attachments) files.set(src, { type: 'application/zip', maxBytes: MAX_BYTES, attachment: true });
	for (const [src, type] of sidecars) files.set(src, { type, maxBytes: rawPerformance.has(src) ? 20 * 1024 * 1024 : 2 * 1024 * 1024, attachment: rawPerformance.has(src) && src.endsWith('.html') });
	for (const src of files.keys()) if (['index.html', 'app.js', 'style.css', 'report.json'].includes(src)) throw new Error('Evidence path conflicts with a viewer file.');
	return files;
}

export async function readReportFile(root, filename, maxBytes = MAX_BYTES) {
	const canonicalRoot = await realpath(root);
	const file = await realpath(resolve(canonicalRoot, filename));
	const within = relative(canonicalRoot, file);
	if (!within || within.startsWith('../') || within === '..') throw Object.assign(new Error('File escapes report root.'), { code: 'EACCES' });
	return boundedRead(file, maxBytes);
}
