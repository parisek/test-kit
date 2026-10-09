import http from 'node:http';
import { realpath, open } from 'node:fs/promises';
import { dirname, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptReport } from '../report/model.js';
import { relativePath } from '../report/safe.js';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const MAX_BYTES = 80_000_000;
async function boundedRead(file) {
	const handle = await open(file, 'r');
	try {
		const info = await handle.stat();
		if (!info.isFile() || info.size > MAX_BYTES) throw Object.assign(new Error('File exceeds the size limit.'), { code: 'EFBIG' });
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

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

export async function serve({ reportPath, port = 0, host = '127.0.0.1' }) {
	if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('The report server must bind to loopback.');
	if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid server port.');
	const reportFile = await realpath(reportPath);
	const reportRoot = dirname(reportFile);
	const reportBytes = await boundedRead(reportFile);
	const report = adaptReport(JSON.parse(reportBytes));
	const assets = new Set();
	for (const entry of report.entries) for (const row of entry.viewports) for (const shot of Object.values(row.artifacts?.screenshot ?? {})) {
		if (relativePath(shot?.src) && extname(shot.src) === '.png') assets.add(shot.src);
	}
	const routes = new Map([
		['/', [packageRoot, 'viewer/index.html', 'text/html']],
		['/app.js', [packageRoot, 'viewer/app.js', 'text/javascript']],
		['/style.css', [packageRoot, 'viewer/style.css', 'text/css']],
		...['model.js', 'classify.js', 'safe.js'].map((name) => [`/src/report/${name}`, [packageRoot, `src/report/${name}`, 'text/javascript']]),
	]);
	const server = http.createServer(async (req, res) => {
		res.setHeader('Content-Security-Policy', CSP);
		res.setHeader('X-Content-Type-Options', 'nosniff');
		res.setHeader('Cache-Control', 'no-store');
		const fail = (code) => { res.statusCode = code; res.end(); };
		if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); fail(405); return; }
		try {
			const raw = req.url ?? '';
			if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000]/.test(raw)) { fail(400); return; }
			const path = decodeURIComponent(raw.split('?')[0]);
			if (/[\\\u0000]/.test(path) || path.split('/').some((part) => part === '.' || part === '..')) { fail(400); return; }
			if (path === '/report.json') {
				res.setHeader('Content-Type', 'application/json'); res.setHeader('Content-Length', reportBytes.length);
				res.end(req.method === 'HEAD' ? undefined : reportBytes); return;
			}
			let route = routes.get(path);
			if (!route && assets.has(path.slice(1))) route = [reportRoot, path.slice(1), 'image/png'];
			if (!route) { fail(404); return; }
			const [root, filename, type] = route;
			const canonicalRoot = await realpath(root);
			const file = await realpath(resolve(canonicalRoot, filename));
			const within = relative(canonicalRoot, file);
			if (!within || within.startsWith('../') || within === '..') { fail(403); return; }
			const bytes = await boundedRead(file);
			res.setHeader('Content-Type', type); res.setHeader('Content-Length', bytes.length);
			res.end(req.method === 'HEAD' ? undefined : bytes);
		} catch (error) { fail(error instanceof URIError ? 400 : error.code === 'ENOENT' ? 404 : error.code === 'EFBIG' ? 413 : 500); }
	});
	await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, host, accept); });
	const address = server.address();
	return { server, origin: `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`, close: () => new Promise((accept, reject) => server.close((error) => error ? reject(error) : accept())) };
}
