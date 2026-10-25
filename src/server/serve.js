import http from 'node:http';
import { realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptReport } from '../report/model.js';
import { boundedRead, reportFiles, readReportFile } from './files.js';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

export async function serve({ reportPath, port = 0, host = '127.0.0.1' }) {
	if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('The report server must bind to loopback.');
	if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid server port.');
	const reportFile = await realpath(reportPath);
	const reportRoot = dirname(reportFile);
	const reportBytes = await boundedRead(reportFile);
	const report = adaptReport(JSON.parse(reportBytes));
	const files = await reportFiles(report, reportRoot);
	const routes = new Map([
		['/', [packageRoot, 'viewer/index.html', 'text/html']],
		['/app.js', [packageRoot, 'viewer/app.js', 'text/javascript']],
		['/style.css', [packageRoot, 'viewer/style.css', 'text/css']],
		['/favicon.svg', [packageRoot, 'viewer/favicon.svg', 'image/svg+xml']],
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
			const descriptor = files.get(path.slice(1));
			if (!route && descriptor) route = [reportRoot, path.slice(1), descriptor.type];
			if (!route) { fail(404); return; }
			const [root, filename, type] = route;
			const bytes = await readReportFile(root, filename, descriptor?.maxBytes);
			if (descriptor?.attachment) res.setHeader('Content-Disposition', filename.endsWith('.zip') ? 'attachment; filename="trace.zip"' : 'attachment');
			res.setHeader('Content-Type', type); res.setHeader('Content-Length', bytes.length);
			res.end(req.method === 'HEAD' ? undefined : bytes);
		} catch (error) { fail(error instanceof URIError ? 400 : error.code === 'ENOENT' ? 404 : error.code === 'EFBIG' ? 413 : error.code === 'EACCES' ? 403 : 500); }
	});
	await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, host, accept); });
	const address = server.address();
	return { server, origin: `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`, close: () => new Promise((accept, reject) => server.close((error) => error ? reject(error) : accept())) };
}
