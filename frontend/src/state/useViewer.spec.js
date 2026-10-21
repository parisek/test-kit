import { describe, expect, it, vi } from 'vitest';
import { isReadonly } from 'vue';
import { FIRST_VIEW, useViewer } from './useViewer.js';

function report(kind = 'convergence') {
	return {
		schemaVersion: 2,
		meta: { viewports: [{ id: 'wide' }], matchBelow: 3, noiseFloor: null },
		pair: { kind, aRunId: 'a', bRunId: 'b' },
		runs: [{ id: 'a' }, { id: 'b' }],
		entries: [{ id: 'example', viewports: [{ id: 'wide', state: 'failed', ratio: null }] }],
		findings: [],
		causes: [],
		rules: {},
	};
}
const response = (value) => ({ ok: true, text: async () => JSON.stringify(value) });
const page = { ok: true, text: async () => '<!doctype html><html><body>Not found</body></html>' };
const viewer = (options) =>
	useViewer({ base: 'http://localhost:4178/', width: () => 1280, ...options });

describe('viewer actions', () => {
	it('loads relative to the document base and rejects sibling reports', async () => {
		const fetch = vi.fn(async () => response(report()));
		const instance = useViewer({ browser: { document: { baseURI: 'http://localhost/reports/pair/index.html' }, location: { href: 'http://localhost/' } }, fetch });
		await instance.load('report.json');
		expect(fetch).toHaveBeenCalledWith('http://localhost/reports/pair/report.json', { redirect: 'error' });
		await instance.load('../other/report.json');
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(instance.state.notice).toBe('Use a report URL on this origin.');
	});
	it('uses the initial view for each pair kind without inventing a match', async () => {
		for (const [kind, view] of Object.entries(FIRST_VIEW)) {
			const instance = viewer({ fetch: async () => response(report(kind)) });
			await instance.load('/report.json');
			expect(instance.state.view).toBe(view);
			expect(instance.selectedTarget.value.id).toBe('example');
			expect(instance.selectedRow.value.state).toBe('failed');
			expect(instance.summary.value.counts.incomplete).toBe(1);
			expect(instance.summary.value.counts.match).toBe(0);
			expect(isReadonly(instance.state)).toBe(true);
		}
	});
	it('works when storage access throws', () => {
		const storage = {
			getItem() {
				throw new Error('blocked');
			},
			setItem() {
				throw new Error('blocked');
			},
		};
		const instance = viewer({ storage });
		instance.dispatch('theme');
		instance.dispatch('sidebar');
		expect(instance.state.theme).toBe('dark');
		expect(instance.state.sidebarHidden).toBe(true);
	});
	it('ignores invalid views and selections', () => {
		const instance = viewer();
		instance.dispatch('loaded', { report: report(), source: 'http://localhost:4178/report.json' });
		instance.dispatch('target', 'unknown');
		instance.dispatch('viewport', 'unknown');
		instance.dispatch('view', '__proto__');
		expect(instance.state.targetId).toBe('example');
		expect(instance.state.viewportId).toBe('wide');
		expect(instance.state.view).toBe('detail');
	});
	it('closes and persists the drawer when a phone selects a target', () => {
		const storage = { getItem: () => null, setItem: vi.fn() };
		const instance = viewer({ width: () => 390, storage });
		instance.dispatch('loaded', { report: report(), source: 'http://localhost:4178/report.json' });
		instance.dispatch('sidebar', false);
		instance.dispatch('target', 'example');
		expect(instance.state.sidebarHidden).toBe(true);
		expect(storage.setItem).toHaveBeenLastCalledWith('test-kit-sidebar', 'hidden');
	});
	it('keeps the latest valid request when responses arrive in reverse order', async () => {
		let resolveFirst;
		const first = new Promise((resolve) => {
			resolveFirst = resolve;
		});
		const fetch = vi
			.fn()
			.mockReturnValueOnce(first)
			.mockResolvedValueOnce(response(report('update')));
		const instance = viewer({ fetch });
		const pending = instance.load('/first.json');
		await instance.load('/second.json');
		resolveFirst(response(report('deploy')));
		await pending;
		expect(instance.state.source).toBe('http://localhost:4178/second.json');
		expect(instance.state.view).toBe('findings');
	});
	it('invalid source cancels a pending request and leaves the current report visible', async () => {
		let resolve;
		const fetch = vi.fn(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const instance = viewer({ fetch });
		instance.dispatch('loaded', { report: report(), source: 'http://localhost:4178/current.json' });
		const pending = instance.load('/pending.json');
		await instance.load('https://example.invalid/report.json');
		resolve(response(report('deploy')));
		await pending;
		expect(instance.state.source).toBe('http://localhost:4178/current.json');
		expect(instance.state.notice).toBe('Use a report URL on this origin.');
		expect(instance.state.loading).toBe(false);
	});
	it('reports transport and schema errors without removing the last report', async () => {
		const instance = viewer({ fetch: async () => response({ schemaVersion: 88 }) });
		instance.dispatch('loaded', { report: report(), source: 'http://localhost:4178/current.json' });
		await instance.load('/invalid.json');
		expect(instance.state.report.entries[0].id).toBe('example');
		expect(instance.state.notice).toMatch(/^Cannot load report: Invalid report:/);
		expect(instance.state.loading).toBe(false);
	});
});

describe('viewer filters', () => {
    it('finds each incomplete state in mixed rows and retains global counts', () => {
        const data = report();
        data.meta.viewports.push({ id: 'phone' }, { id: 'tablet' });
        data.entries[0].viewports.push({ id: 'phone', state: 'incompatible' });
        const instance = viewer();
        instance.dispatch('loaded', { report: data, source: '/report.json' });
        for (const measurement of ['failed', 'incompatible', 'missing']) {
            instance.dispatch('filter', { key: 'measurement', value: measurement });
            expect(instance.filteredTargets.value).toHaveLength(1);
            expect(instance.summary.value.counts.incomplete).toBe(1);
            expect(instance.summary.value.counts.match).toBe(0);
        }
        instance.dispatch('filter', { key: 'classification', value: 'match' });
        expect(instance.filteredTargets.value).toHaveLength(0);
        expect(instance.summary.value.counts.total).toBe(1);
        instance.dispatch('filter', { key: '__proto__', value: 'all' });
        instance.dispatch('filter', { key: 'constructor', value: 'all' });
        expect(instance.state.filters.classification).toBe('match');
    });
    it('finds absent declared rows without changing shared stored-row classification', () => {
        const data = report();
        data.meta.viewports.push({ id: 'phone' });
        data.entries[0].viewports[0].state = 'complete';
        const instance = viewer();
        instance.dispatch('loaded', { report: data, source: '/report.json' });
        instance.dispatch('filter', { key: 'measurement', value: 'missing' });
        expect(instance.filteredTargets.value).toHaveLength(1);
        expect(instance.summary.value.states.complete).toBe(1);
        expect(instance.summary.value.counts.incomplete).toBe(0);
    });
    it('keeps cause identifiers distinct from filter controls and resets on load', () => {
        const data = report();
        data.causes = [{ id: 'unknown', known: false }];
        data.findings = [{ targetId: 'example', causeId: 'unknown' }];
        const instance = viewer();
        instance.dispatch('loaded', { report: data, source: '/report.json' });
        instance.dispatch('filter', { key: 'cause', value: 'cause:unknown' });
        expect(instance.filteredTargets.value).toHaveLength(1);
        instance.dispatch('filter', { key: 'cause', value: 'unknown' });
        expect(instance.filteredTargets.value).toHaveLength(0);
        instance.dispatch('loaded', { report: data, source: '/next.json' });
        expect(instance.state.filters.cause).toBe('all');
    });
    it('selects missing declared viewport evidence without fallback', () => {
        const data = report();
        data.meta.viewports.push({ id: 'phone' });
        const instance = viewer();
        instance.dispatch('loaded', { report: data, source: '/report.json' });
        instance.dispatch('view', 'findings');
        instance.dispatch('evidence', { targetId: 'example', viewportId: 'phone' });
        expect(instance.state.view).toBe('detail');
        expect(instance.state.viewportId).toBe('phone');
        expect(instance.selectedRow.value).toBe(null);
        instance.dispatch('evidence', { targetId: 'example', viewportId: 'invalid' });
        expect(instance.state.viewportId).toBe('phone');
    });
});

describe('bounded response evidence actions', () => {
    it('discards success and failure from evidence that a new selection cancels', async () => {
        for (const fails of [false, true]) {
            const data = report();
            data.entries[0].viewports[0].artifacts = { screenshot: {}, status: { diff: { src: 'diff/status.json' } } };
            let resolve, reject;
            const instance = viewer({ fetch: () => new Promise((done, fail) => { resolve = done; reject = fail; }) });
            instance.dispatch('loaded', { report: data, source: 'http://localhost:4178/report.json' });
            instance.dispatch('artifact', 'status');
            expect(instance.state.artifactEvidence.loading).toBe(true);
            instance.dispatch('artifact', 'screenshot');
            if (fails) reject(new Error('Old failure'));
            else resolve(new Response(JSON.stringify({ changed: false, a: { statusCode: 200 }, b: { statusCode: 200 } })));
            await new Promise(done => setTimeout(done, 0));
            expect(instance.state.artifactEvidence).toBe(null);
            expect(instance.state.artifact).toBe('screenshot');
        }
    });
    it('selects the exact finding artifact and validates comparison controls', () => {
        const data = report();
        data.entries[0].viewports[0].artifacts = { screenshot: {}, html: {} };
        const instance = viewer();
        instance.dispatch('loaded', { report: data, source: '/report.json' });
        instance.dispatch('evidence', { targetId: 'example', viewportId: 'wide', artifact: 'html' });
        expect(instance.state.artifact).toBe('html');
        instance.dispatch('artifact', 'status');
        expect(instance.state.artifact).toBe('html');
        instance.dispatch('comparison', 'overlay');
        instance.dispatch('overlay', 75);
        for (const value of [-1, 101, NaN, '20']) instance.dispatch('overlay', value);
        instance.dispatch('comparison', '__proto__');
        expect(instance.state.comparison).toBe('overlay');
        expect(instance.state.overlay).toBe(75);
        instance.dispatch('evidence-view', 'raw');
        instance.dispatch('evidence-view', 'invalid');
        expect(instance.state.evidenceView).toBe('raw');
    });
});


describe('planned artifact isolation', () => {
    it('gates prototype navigation and restores real evidence on a normal report', () => {
        const data = report();
        data.meta.prototype = 'planned-artifacts-v1';
        data.entries[0].viewports[0].artifacts = { screenshot: {} };
        const instance = viewer();
        instance.dispatch('loaded', { report: data, source: '/report.json' });
        instance.dispatch('artifact', 'behavior');
        expect(instance.state.artifact).toBe('behavior');
        expect(instance.state.artifactEvidence).toBe(null);
        instance.dispatch('view', 'speed');
        expect(instance.state.view).toBe('speed');
        expect(instance.summary.value.counts.total).toBe(1);
        const real = report();
        real.entries[0].viewports[0].artifacts = { screenshot: {} };
        instance.dispatch('loaded', { report: real, source: '/real.json' });
        instance.dispatch('artifact', 'behavior');
        instance.dispatch('view', 'speed');
        expect(instance.state.artifact).toBe('screenshot');
        expect(instance.state.view).toBe('detail');
    });

	describe('publish directory index (R10.13)', () => {
		const hash = 'sha256:' + 'ab'.repeat(32);
		const index = (extra = {}) => ({ schemaVersion: 1, reports: [{ id: 'example-a', kind: 'convergence', createdAt: '2026-10-02T09:00:00.000Z', settingsHash: hash, path: 'reports/example-a/report.json', targets: 1 }], runs: [], ...extra });
		const missing = { ok: false, status: 404, text: async () => '' };
		const server = (files) => vi.fn(async (url) => files[new URL(url).pathname] ?? missing);
		const host = (hash = '') => ({ document: { baseURI: 'http://localhost:4178/site/index.html' }, location: { href: 'http://localhost:4178/site/index.html', pathname: '/site/index.html', search: '', hash }, history: { replaceState: vi.fn() } });

		it('shows the list when report.json answers 404 and index.json loads', async () => {
			const fetch = server({ '/site/index.json': response(index()) });
			const instance = useViewer({ browser: host(), fetch, width: () => 1280 });
			await instance.start();
			expect(fetch.mock.calls.map(([url]) => url)).toEqual(['http://localhost:4178/site/report.json', 'http://localhost:4178/site/index.json']);
			expect(instance.state.report).toBeNull();
			expect(instance.state.index.reports.map((row) => row.id)).toEqual(['example-a']);
			expect(instance.state.notice).toBe('');
		});
		it('keeps the single-report behavior when report.json exists, and never reads the index', async () => {
			const fetch = server({ '/site/report.json': response(report()), '/site/index.json': response(index()) });
			const instance = useViewer({ browser: host(), fetch, width: () => 1280 });
			await instance.start();
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(instance.state.report.entries[0].id).toBe('example');
			expect(instance.state.index).toBeNull();
		});
		it('does not hide a broken report.json behind the index', async () => {
			const fetch = server({ '/site/report.json': { ok: false, status: 500 }, '/site/index.json': response(index()) });
			const instance = useViewer({ browser: host(), fetch, width: () => 1280 });
			await instance.start();
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(instance.state.index).toBeNull();
			expect(instance.state.notice).toBe('Cannot load report: HTTP 500');
		});
		it('keeps the original error when neither file exists', async () => {
			const instance = useViewer({ browser: host(), fetch: server({}), width: () => 1280 });
			await instance.start();
			expect(instance.state.index).toBeNull();
			expect(instance.state.notice).toBe('Cannot load report: HTTP 404');
		});
		it('shows an honest error for an unknown schemaVersion', async () => {
			const fetch = server({ '/site/index.json': response(index({ schemaVersion: 2 })) });
			const instance = useViewer({ browser: host(), fetch, width: () => 1280 });
			await instance.start();
			expect(instance.state.index).toBeNull();
			expect(instance.state.notice).toMatch(/^Unsupported index schemaVersion \(2\)/);
			expect(instance.state.loading).toBe(false);
		});
		it('opens reports/<id>/report.json from the same copy, sets a plain anchor and returns to the list', async () => {
			const browser = host();
			const fetch = server({ '/site/index.json': response(index()), '/site/reports/example-a/report.json': response(report('update')) });
			const instance = useViewer({ browser, fetch, width: () => 1280 });
			await instance.start();
			await instance.openReport('example-a');
			expect(fetch).toHaveBeenLastCalledWith('http://localhost:4178/site/reports/example-a/report.json', { redirect: 'error' });
			expect(instance.state.report.entries[0].id).toBe('example');
			expect(instance.state.source).toBe('http://localhost:4178/site/reports/example-a/report.json');
			expect(browser.history.replaceState).toHaveBeenLastCalledWith(null, '', '/site/index.html#r-example-a');
			instance.dispatch('close-report');
			expect(instance.state.report).toBeNull();
			expect(instance.state.index.reports).toHaveLength(1);
			expect(browser.history.replaceState).toHaveBeenLastCalledWith(null, '', '/site/index.html');
		});
		it('opens the report named by the anchor, and ignores an invalid anchor', async () => {
			const files = { '/site/index.json': response(index()), '/site/reports/example-a/report.json': response(report()) };
			const opened = useViewer({ browser: host('#r-example-a'), fetch: server(files), width: () => 1280 });
			await opened.start();
			expect(opened.state.report.entries[0].id).toBe('example');
			const fetch = server(files);
			const ignored = useViewer({ browser: host('#r-../../etc'), fetch, width: () => 1280 });
			await ignored.start();
			expect(ignored.state.report).toBeNull();
			expect(fetch).toHaveBeenCalledTimes(2);
		});
		it('requests index.json with redirect error', async () => {
			const fetch = server({ '/site/index.json': response(index()) });
			await useViewer({ browser: host(), fetch, width: () => 1280 }).start();
			expect(fetch).toHaveBeenLastCalledWith('http://localhost:4178/site/index.json', { redirect: 'error' });
		});
		it('does not fall back when report.json is 200 with invalid JSON', async () => {
			const fetch = server({ '/site/report.json': { ok: true, text: async () => '{ "entries": ' }, '/site/index.json': response(index()) });
			const instance = useViewer({ browser: host(), fetch, width: () => 1280 });
			await instance.start();
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(instance.state.index).toBeNull();
			expect(instance.state.notice).toMatch(/^Cannot load report:/);
		});
		it('shows its own error when index.json is 500 or invalid JSON', async () => {
			const bad = { 500: { ok: false, status: 500 }, json: { ok: true, text: async () => '{ "schemaVersion": ' } };
			for (const answer of Object.values(bad)) {
				const instance = useViewer({ browser: host(), fetch: server({ '/site/index.json': answer }), width: () => 1280 });
				await instance.start();
				expect(instance.state.index).toBeNull();
				expect(instance.state.notice).toMatch(/^Cannot load index:/);
				expect(instance.state.loading).toBe(false);
			}
		});
		it('falls back to index.json when report.json answers 200 with an HTML page (issue #147)', async () => {
			const fetch = server({ '/site/report.json': page, '/site/index.json': response(index()) });
			const instance = useViewer({ browser: host(), fetch, width: () => 1280 });
			await instance.start();
			expect(instance.state.report).toBeNull();
			expect(instance.state.index.reports.map((row) => row.id)).toEqual(['example-a']);
			expect(instance.state.notice).toBe('');
		});
		it('treats an HTML page with a byte order mark or leading blanks as missing', async () => {
			for (const text of ['\uFEFF<html></html>', '\n  \t<!doctype html>']) {
				const fetch = server({ '/site/report.json': { ok: true, text: async () => text }, '/site/index.json': response(index()) });
				const instance = useViewer({ browser: host(), fetch, width: () => 1280 });
				await instance.start();
				expect(instance.state.index.reports).toHaveLength(1);
			}
		});
		it('keeps the report error when both sources answer an HTML page, and shows no index', async () => {
			const instance = useViewer({ browser: host(), fetch: server({ '/site/report.json': page, '/site/index.json': page }), width: () => 1280 });
			await instance.start();
			expect(instance.state.index).toBeNull();
			expect(instance.state.notice).toBe('Cannot load report: the server returned a web page, not JSON');
			expect(instance.state.loading).toBe(false);
		});
		it('does not read a listed report that answers an HTML page as a report', async () => {
			const fetch = server({ '/site/index.json': response(index()), '/site/reports/example-a/report.json': page });
			const instance = useViewer({ browser: host(), fetch, width: () => 1280 });
			await instance.start();
			const result = await instance.openReport('example-a');
			expect(result.ok).toBe(false);
			expect(instance.state.report).toBeNull();
			expect(instance.state.notice).toBe('Cannot load report: the server returned a web page, not JSON');
		});
		it('treats a missing reports array as a malformed index', async () => {
			const fetch = server({ '/site/index.json': response({ schemaVersion: 1, runs: [] }) });
			const instance = useViewer({ browser: host(), fetch, width: () => 1280 });
			await instance.start();
			expect(instance.state.index).toBeNull();
			expect(instance.state.notice).toMatch(/malformed/);
		});
		it('ignores close-report without an index', () => {
			const instance = useViewer({ browser: host(), fetch: server({}), width: () => 1280 });
			instance.dispatch('loaded', { report: report(), source: 'http://localhost:4178/site/report.json' });
			instance.dispatch('close-report');
			expect(instance.state.report.entries[0].id).toBe('example');
		});
		it('drops a stale index response when the source form loads a report meanwhile', async () => {
			let release;
			const pending = new Promise((done) => { release = done; });
			const fetch = vi.fn(async (url) => {
				const path = new URL(url).pathname;
				if (path === '/site/index.json') return pending;
				if (path === '/site/other.json') return response(report('update'));
				return missing;
			});
			const instance = useViewer({ browser: host(), fetch, width: () => 1280 });
			const starting = instance.start();
			await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
			await instance.load('other.json');
			release(response(index()));
			const result = await starting;
			expect(result).toMatchObject({ ok: false, stale: true });
			expect(instance.state.index).toBeNull();
			expect(instance.state.report.entries[0].id).toBe('example');
			expect(instance.state.view).toBe('findings');
		});
		it('drops a delayed report response after close-report', async () => {
			let release;
			const pending = new Promise((done) => { release = done; });
			const fetch = vi.fn(async (url) => {
				const path = new URL(url).pathname;
				if (path === '/site/index.json') return response(index());
				if (path === '/site/reports/example-a/report.json') return response(report());
				if (path === '/site/slow.json') return pending;
				return missing;
			});
			const instance = useViewer({ browser: host(), fetch, width: () => 1280 });
			await instance.start();
			await instance.openReport('example-a');
			const slow = instance.load('slow.json');
			instance.dispatch('close-report');
			expect(instance.state.report).toBeNull();
			release(response(report('update')));
			expect(await slow).toMatchObject({ ok: false, stale: true });
			expect(instance.state.report).toBeNull();
			expect(instance.state.index.reports).toHaveLength(1);
			expect(instance.state.loading).toBe(false);
			expect(instance.state.notice).toBe('');
		});
		it('shows a notice for an anchor that names an unlisted or unavailable report', async () => {
			for (const hash of ['#r-unlisted', '#r-example-gone']) {
				const fetch = server({ '/site/index.json': response(index({ reports: [{ id: 'example-gone', path: null }] })) });
				const instance = useViewer({ browser: host(hash), fetch, width: () => 1280 });
				await instance.start();
				expect(instance.state.index.reports).toHaveLength(1);
				expect(instance.state.report).toBeNull();
				expect(instance.state.notice).toBe(`Report ${hash.slice(3)} is not available in the index.`);
				expect(fetch).toHaveBeenCalledTimes(2);
			}
		});
		it('refuses an unavailable entry, an unlisted id and an id outside the charset', async () => {
			const fetch = server({ '/site/index.json': response(index({ reports: [{ id: 'example-gone', path: null }] })) });
			const instance = useViewer({ browser: host(), fetch, width: () => 1280 });
			await instance.start();
			for (const id of ['example-gone', 'unlisted', '../report', '']) expect(await instance.openReport(id)).toEqual({ ok: false });
			expect(fetch).toHaveBeenCalledTimes(2);
		});
	});
});
