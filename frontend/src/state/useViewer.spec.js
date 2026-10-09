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
const response = (value) => ({ ok: true, json: async () => value });
const viewer = (options) =>
	useViewer({ base: 'http://localhost:4178/', width: () => 1280, ...options });

describe('viewer actions', () => {
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
