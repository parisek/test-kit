import { describe, expect, it, vi } from 'vitest';
import { isReadonly } from 'vue';
import { VIEWS, useViewer } from './useViewer.js';

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
	it('opens every pair kind on Overview without inventing a match (R10.5)', async () => {
		expect(VIEWS).toEqual(['overview', 'evidence', 'findings', 'info']);
		for (const kind of ['convergence', 'self-baseline', 'update', 'migration', 'deploy', 'adhoc']) {
			const instance = viewer({ fetch: async () => response(report(kind)) });
			await instance.load('/report.json');
			expect(instance.state.view).toBe('overview');
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
		expect(instance.state.view).toBe('overview');
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
		expect(instance.state.view).toBe('overview');
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
        expect(instance.state.view).toBe('evidence');
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
            instance.dispatch('view', 'evidence');
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


describe('evidence types (R10.4) and the publish directory', () => {
    it('never selects an evidence type that the row does not have, even with an old prototype marker', () => {
        const data = report();
        data.meta.prototype = 'planned-artifacts-v1';
        data.entries[0].viewports[0].artifacts = { screenshot: {} };
        const instance = viewer();
        instance.dispatch('loaded', { report: data, source: '/report.json' });
        for (const kind of ['behavior', 'content', 'lighthouse']) {
            instance.dispatch('artifact', kind);
            expect(instance.state.artifact).toBe('screenshot');
        }
        // Speed is an evidence type, not a view.
        instance.dispatch('view', 'speed');
        expect(instance.state.view).toBe('overview');
    });

	describe('publish directory index (R10.13)', () => {
		const hash = 'sha256:' + 'ab'.repeat(32);
		const index = (extra = {}) => ({ schemaVersion: 1, reports: [{ id: 'example-a', kind: 'convergence', createdAt: '2026-10-02T09:00:00.000Z', settingsHash: hash, path: 'reports/example-a/report.json', targets: 1 }], runs: [], ...extra });
		const missing = { ok: false, status: 404, text: async () => '' };
		const server = (files) => vi.fn(async (url) => files[new URL(url).pathname] ?? missing);
		const host = (hash = '') => ({ document: { baseURI: 'http://localhost:4178/site/index.html' }, location: { href: 'http://localhost:4178/site/index.html', pathname: '/site/index.html', search: '', hash }, history: { replaceState: vi.fn(), pushState: vi.fn() } });

		describe('deep link wiring (R10.14)', () => {
			const withFinding = () => {
				const data = report('update');
				data.entries[0].viewports[0].artifacts = { screenshot: {} };
				data.findings = [{ id: 'f1', targetId: 'example', viewportId: 'wide', artifact: 'screenshot' }, { id: 'f2', targetId: 'example', viewportId: 'wide', artifact: 'a11y' }];
				return data;
			};
			const files = () => ({ '/site/index.json': response(index()), '/site/reports/example-a/report.json': response(withFinding()) });
			it('opens the view that the link names on load, without a history entry', async () => {
				const browser = host('#r-example-a/evidence/example/wide/screenshot?mode=difference');
				const instance = useViewer({ browser, fetch: server(files()), width: () => 1280 });
				await instance.start();
				expect(instance.state).toMatchObject({ reportId: 'example-a', view: 'evidence', targetId: 'example', viewportId: 'wide', artifact: 'screenshot', comparison: 'diff' });
				expect(browser.history.pushState).not.toHaveBeenCalled();
			});
			it('adds one history entry for each change of view, target or finding', async () => {
				const browser = host('#r-example-a');
				const instance = useViewer({ browser, fetch: server(files()), width: () => 1280 });
				await instance.start();
				instance.dispatch('view', 'findings');
				expect(browser.history.pushState).toHaveBeenLastCalledWith(null, '', '/site/index.html#r-example-a/findings');
				instance.dispatch('evidence', { targetId: 'example', viewportId: 'wide', artifact: 'screenshot', findingId: 'f1' });
				expect(browser.history.pushState).toHaveBeenLastCalledWith(null, '', '/site/index.html#r-example-a/evidence/example/wide/screenshot/f1');
				instance.dispatch('comparison', 'overlay');
				expect(browser.history.pushState).toHaveBeenLastCalledWith(null, '', '/site/index.html#r-example-a/evidence/example/wide/screenshot/f1?mode=overlay');
				expect(browser.history.pushState).toHaveBeenCalledTimes(3);
			});
			it('applies a hash change from Back without a history entry, and returns to the Home for an empty hash', async () => {
				const browser = host('#r-example-a/evidence');
				const instance = useViewer({ browser, fetch: server(files()), width: () => 1280 });
				await instance.start();
				await instance.applyHash('#r-example-a/info');
				expect(instance.state.view).toBe('info');
				await instance.applyHash('');
				expect(instance.state.report).toBeNull();
				expect(browser.history.pushState).not.toHaveBeenCalled();
			});
			it('opens the Overview with a notice for a part that the report does not hold', async () => {
				const instance = useViewer({ browser: host('#r-example-a/evidence/away'), fetch: server(files()), width: () => 1280 });
				await instance.start();
				expect(instance.state.view).toBe('overview');
				expect(instance.state.notice).toBe('The link names a target that this report does not hold.');
			});
			it('lets Back undo a mode change and takes the first evidence type for an omitted one', async () => {
				const browser = host('#r-example-a/evidence/example/wide/screenshot?mode=overlay');
				const instance = useViewer({ browser, fetch: server(files()), width: () => 1280 });
				await instance.start();
				expect(instance.state.comparison).toBe('overlay');
				await instance.applyHash('#r-example-a/evidence/example/wide/screenshot');
				expect(instance.state.comparison).toBe('side-by-side');
				await instance.applyHash('#r-example-a/evidence/example/wide');
				expect(instance.state.artifact).toBe('screenshot');
			});
			it('does not open a slow report after Back to the Home', async () => {
				let release;
				const slow = new Promise((resolve) => { release = resolve; });
				const base = server(files());
				const fetch = vi.fn((url) => (new URL(url).pathname.endsWith('example-a/report.json') ? slow : base(url)));
				const instance = useViewer({ browser: host(''), fetch, width: () => 1280 });
				await instance.start();
				const opening = instance.applyHash('#r-example-a');
				await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
				await instance.applyHash('');
				release(response(withFinding()));
				await opening;
				expect(instance.state.report).toBeNull();
				expect(instance.state.reportId).toBeNull();
			});
			it('does not let a slow load win when Back returns to the open report', async () => {
				const index2 = index({ reports: [
					{ id: 'example-a', kind: 'update', createdAt: '2026-10-02T09:00:00.000Z', settingsHash: hash, path: 'reports/example-a/report.json', targets: 1 },
					{ id: 'example-b', kind: 'update', createdAt: '2026-10-01T09:00:00.000Z', settingsHash: hash, path: 'reports/example-b/report.json', targets: 1 },
				] });
				let release;
				const slow = new Promise((resolve) => { release = resolve; });
				const base = server({ ...files(), '/site/index.json': response(index2) });
				const fetch = vi.fn((url) => (new URL(url).pathname.endsWith('example-b/report.json') ? slow : base(url)));
				const instance = useViewer({ browser: host('#r-example-a'), fetch, width: () => 1280 });
				await instance.start();
				const going = instance.applyHash('#r-example-b');
				await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => url.endsWith('example-b/report.json'))).toBe(true));
				await instance.applyHash('#r-example-a/findings');
				release(response(withFinding()));
				await going;
				expect(instance.state.reportId).toBe('example-a');
				expect(instance.state.view).toBe('findings');
				expect(instance.state.loading).toBe(false);
			});
			it('shows the first valid evidence type for a finding whose artifact is not an evidence type', async () => {
				// R10.14: such a finding has an empty artifact segment, and an empty part takes the first valid value.
				const instance = useViewer({ browser: host('#r-example-a/evidence/example/wide//f2'), fetch: server(files()), width: () => 1280 });
				await instance.start();
				expect(instance.state).toMatchObject({ view: 'evidence', targetId: 'example', artifact: 'screenshot', findingId: 'f2' });
			});
			it('applies a hash that changes while the sources load, and still falls back to the index', async () => {
				let release;
				const slow = new Promise((resolve) => { release = resolve; });
				const base = server(files());
				const fetch = vi.fn((url) => (new URL(url).pathname === '/site/report.json' ? slow : base(url)));
				const browser = host('');
				const instance = useViewer({ browser, fetch, width: () => 1280 });
				const starting = instance.start();
				browser.location.hash = '#r-example-a/info';
				await instance.applyHash();
				release({ ok: false, status: 404, text: async () => 'Not found' });
				await starting;
				expect(instance.state.index).not.toBeNull();
				expect(instance.state).toMatchObject({ reportId: 'example-a', view: 'info' });
			});
			it('writes an empty evidence type for an a11y finding, so the written link reads back without a notice', async () => {
				const browser = host('#r-example-a');
				const instance = useViewer({ browser, fetch: server(files()), width: () => 1280 });
				await instance.start();
				instance.dispatch('evidence', { targetId: 'example', viewportId: 'wide', artifact: 'a11y', findingId: 'f2' });
				const written = browser.history.pushState.mock.lastCall[2].slice('/site/index.html'.length);
				expect(written).toBe('#r-example-a/evidence/example/wide//f2');
				await instance.applyHash(written);
				expect(instance.state.notice).not.toMatch(/finding wins/);
				expect(instance.state.findingId).toBe('f2');
			});
			it('clears the notice of a bad link when a valid link follows', async () => {
				const instance = useViewer({ browser: host('#r-example-a/evidence/away'), fetch: server(files()), width: () => 1280 });
				await instance.start();
				expect(instance.state.notice).toMatch(/does not hold/);
				await instance.applyHash('#r-example-a/info');
				expect(instance.state.notice).toBe('');
			});
			it('reads the hash after a report loads through the source form', async () => {
				const fetch = server({ '/site/other.json': response(withFinding()) });
				const instance = useViewer({ browser: host('#findings'), fetch, width: () => 1280 });
				await instance.start();
				expect(instance.state.sourcesMissing).toBe(true);
				await instance.loadSource('other.json');
				expect(instance.state.view).toBe('findings');
			});
			it('gives no finding part to a later finding with a repeated id', async () => {
				const browser = host('#r-example-a');
				const instance = useViewer({ browser, fetch: server(files()), width: () => 1280 });
				await instance.start();
				instance.dispatch('evidence', { targetId: 'example', viewportId: 'phone', artifact: 'screenshot', findingId: 'f1' });
				expect(instance.state.findingId).toBeNull();
				instance.dispatch('evidence', { targetId: 'example', viewportId: 'wide', artifact: 'screenshot', findingId: 'f1' });
				expect(instance.state.findingId).toBe('f1');
				// Same target and viewport, another evidence type: not the first finding with this id.
				instance.dispatch('evidence', { targetId: 'example', viewportId: 'wide', artifact: 'html', findingId: 'f1' });
				expect(instance.state.findingId).toBeNull();
			});
			it('does not cancel a source-form load when the hash changes while it runs', async () => {
				let release;
				const slow = new Promise((resolve) => { release = resolve; });
				const fetch = vi.fn((url) => (new URL(url).pathname === '/site/other.json' ? slow : Promise.resolve(missing)));
				const browser = host('');
				const instance = useViewer({ browser, fetch, width: () => 1280 });
				await instance.start();
				expect(instance.state.sourcesMissing).toBe(true);
				const loading = instance.loadSource('other.json');
				browser.location.hash = '#findings';
				await instance.applyHash();
				release(response(withFinding()));
				await loading;
				expect(instance.state.report).not.toBeNull();
				expect(instance.state.view).toBe('findings');
			});
			it('drops the mode when an omitted evidence type resolves to a type other than screenshot', async () => {
				const htmlOnly = withFinding();
				htmlOnly.entries[0].viewports[0].artifacts = { html: { state: 'missing' } };
				htmlOnly.findings = [];
				const fetch = server({ '/site/index.json': response(index()), '/site/reports/example-a/report.json': response(htmlOnly) });
				const instance = useViewer({ browser: host('#r-example-a/evidence/example/wide?mode=overlay'), fetch, width: () => 1280 });
				await instance.start();
				expect(instance.state).toMatchObject({ view: 'evidence', artifact: 'html', comparison: 'side-by-side' });
			});
			it('writes no evidence type that the row does not hold, and ignores a hash that is not a deep link', async () => {
				const data = withFinding();
				data.meta.viewports.push({ id: 'phone' });
				const browser = host('#r-example-a');
				const instance = useViewer({ browser, fetch: server({ '/site/index.json': response(index()), '/site/reports/example-a/report.json': response(data) }), width: () => 1280 });
				await instance.start();
				instance.dispatch('evidence', { targetId: 'example', viewportId: 'phone' });
				expect(browser.history.pushState).toHaveBeenLastCalledWith(null, '', '/site/index.html#r-example-a/evidence/example/phone');
				await instance.applyHash('#main');
				expect(instance.state.reportId).toBe('example-a');
			});
			it('takes the first declared viewport for a target without rows', async () => {
				const data = withFinding();
				data.entries.push({ id: 'empty', viewports: [] });
				const fetch = server({ '/site/index.json': response(index()), '/site/reports/example-a/report.json': response(data) });
				const instance = useViewer({ browser: host('#r-example-a/evidence/empty'), fetch, width: () => 1280 });
				await instance.start();
				expect(instance.state).toMatchObject({ view: 'evidence', targetId: 'empty', viewportId: 'wide' });
			});
			it('reads the link without the report part next to an adjacent report.json', async () => {
				const fetch = server({ '/site/report.json': response(withFinding()) });
				const instance = useViewer({ browser: host('#findings'), fetch, width: () => 1280 });
				await instance.start();
				expect(instance.state.view).toBe('findings');
			});
		});

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
			// Opening a report and going back to the Home each add one history entry (R10.14).
			expect(browser.history.pushState).toHaveBeenLastCalledWith(null, '', '/site/index.html#r-example-a');
			instance.dispatch('close-report');
			expect(instance.state.report).toBeNull();
			expect(instance.state.index.reports).toHaveLength(1);
			expect(browser.history.pushState).toHaveBeenLastCalledWith(null, '', '/site/index.html');
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
		it('does not treat an empty or blank body as an HTML page', async () => {
			for (const text of ['', '  \n']) {
				const fetch = server({ '/site/report.json': { ok: true, text: async () => text }, '/site/index.json': response(index()) });
				const instance = useViewer({ browser: host(), fetch, width: () => 1280 });
				await instance.start();
				expect(fetch).toHaveBeenCalledTimes(1);
			expect(instance.state.index).toBeNull();
				expect(instance.state.notice).toMatch(/^Cannot load report:/);
			}
		});
		it('keeps the report error when one source is a page and the other is 404', async () => {
			for (const files of [{ '/site/report.json': page }, { '/site/index.json': page }]) {
				const instance = useViewer({ browser: host(), fetch: server(files), width: () => 1280 });
				await instance.start();
				expect(instance.state.index).toBeNull();
				expect(instance.state.notice).toMatch(/^Cannot load report: (HTTP 404|the server returned a web page, not JSON)$/);
			}
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
			expect(instance.state.view).toBe('overview');
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
