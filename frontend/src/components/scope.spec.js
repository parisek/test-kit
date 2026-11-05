import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import App from '../App.vue';
import RunSummary from './RunSummary.vue';
import { reportScope, scopeLine } from '../../../src/report/scope.js';
import { summarizeReport } from '../../../src/query/summary.js';

// Owner decision on #287, option C: one scope line in the report header, the lists in "Run details".
const respond = (status, body) => ({ ok: status < 300, status, headers: new Headers({ 'content-type': 'application/json' }), text: async () => body, json: async () => JSON.parse(body) });
const viewports = ['phone', 'tablet', 'laptop', 'wide'].map((id) => ({ id, width: 400 }));

// 63 targets x 4 viewports = 252 cells. The pair compared 2 targets on 1 viewport, so 250 cells are skipped.
function scoped() {
	return {
		schemaVersion: 2,
		meta: { title: 'Scoped example', generated: null, viewports: [viewports[0]], matchBelow: 3, noiseFloor: null,
			scope: { a: { targets: ['home', 'about'] }, b: null, filter: { viewports: ['phone'] } }, skipped: 250 },
		pair: { kind: 'update', aRunId: 'a', bRunId: 'b' },
		runs: [{ id: 'a', settings: { viewports } }, { id: 'b', settings: { viewports } }],
		entries: ['home', 'about'].map((id) => ({ id, viewports: [{ id: 'phone', state: 'complete', ratio: 0 }] })),
		findings: [], causes: [], rules: {},
	};
}
const full = () => { const report = scoped(); delete report.meta.scope; delete report.meta.skipped; return report; };

async function open(file) {
	vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).endsWith('/report.json') ? respond(200, JSON.stringify(file)) : respond(404, 'Not found'))));
	const app = mount(App, { attachTo: document.body });
	await flushPromises();
	await flushPromises();
	return app;
}
const view = async (app, name) => { await app.find(`button[data-view="${name}"]`).trigger('click'); await flushPromises(); };

afterEach(() => vi.unstubAllGlobals());

describe('scope of a report (#287)', () => {
	it('derives the counts from the report and words them as the owner decided', () => {
		const scope = reportScope(scoped());
		expect(scope).toMatchObject({ targets: 2, ofTargets: 63, viewports: 1, ofViewports: 4, skipped: 250 });
		expect(scopeLine(scope)).toBe('Scope: 2 of 63 targets, 1 of 4 viewports. 250 cells skipped.');
	});
	it('gives no total when the compared cells are not a full grid, even when the division is exact', () => {
		const report = scoped();
		report.meta.viewports = viewports.slice(0, 2);
		report.entries[0].viewports = [{ id: 'phone', state: 'complete', ratio: 0 }, { id: 'tablet', state: 'complete', ratio: 0 }];
		// 3 cells + 5 skipped = 8 = 2 targets x 4 viewports: exact by chance, but the rows are not a grid.
		report.meta.skipped = 5;
		const scope = reportScope(report);
		expect(scope.ofTargets).toBeNull();
		expect(scopeLine(scope)).toBe('Scope: 2 targets, 2 viewports compared. 5 cells skipped.');
	});
	it('does not count the reserved @project entry as a target: the line, the caption and the target list agree', async () => {
		const report = scoped();
		report.entries.push({ id: '@project', kind: 'project', title: 'Project', viewports: [], artifacts: {} });
		const scope = reportScope(report);
		expect(scope).toMatchObject({ targets: 2, ofTargets: 63, targetIds: ['home', 'about'] });
		expect(mount(RunSummary, { props: { report } }).get('.summary-caption').text()).toContain('2 compared targets · 1 compared viewport.');
		const app = await open(report);
		await view(app, 'evidence');
		expect(app.get('[data-testid="scope-line"]').text()).toBe('Scope: 2 of 63 targets, 1 of 4 viewports. 250 cells skipped.');
		expect(app.get('details.run-details .summary-caption').text()).toContain('2 compared targets');
		expect(app.findAll('.target-row').map((row) => row.get('.target-title').text()).filter((title) => title !== 'Project')).toEqual(['home', 'about']);
		app.unmount();
	});
	it('names no total it cannot derive, and says so plainly', () => {
		const report = scoped();
		report.runs = [{ id: 'a' }, { id: 'b' }];
		expect(scopeLine(reportScope(report))).toBe('Scope: 2 targets, 1 viewport compared. 250 cells skipped.');
		report.meta.skipped = 1;
		report.entries.length = 1;
		expect(scopeLine(reportScope(report))).toBe('Scope: 1 target, 1 viewport compared. 1 cell skipped.');
	});
	it('claims no scope for a report without meta.scope', () => {
		expect(reportScope(full())).toBeNull();
	});

	it('shows the line in the report header on the Overview and on every other view, with the same skipped count as summary', async () => {
		const app = await open(scoped());
		const skipped = summarizeReport(scoped()).skipped;
		expect(skipped).toBe(250);
		for (const name of ['overview', 'evidence', 'findings', 'info']) {
			await view(app, name);
			const line = app.findAll('[data-testid="scope-line"]');
			expect(line, name).toHaveLength(1);
			expect(line[0].text()).toBe(`Scope: 2 of 63 targets, 1 of 4 viewports. ${skipped} cells skipped.`);
			expect(line[0].element.closest('.comparison-heading'), name).not.toBeNull();
			expect(line[0].element.closest('details'), name).toBeNull();
		}
		app.unmount();
	});
	it('shows no line and no empty element for a report without meta.scope', async () => {
		const app = await open(full());
		for (const name of ['overview', 'evidence', 'findings', 'info']) {
			await view(app, name);
			expect(app.find('.report-scope').exists(), name).toBe(false);
			expect(app.find('.scope-details').exists(), name).toBe(false);
			expect(app.find('.comparison-heading').element.querySelectorAll('p').length, name).toBe(name === 'evidence' ? 2 : 3);
		}
		expect(summarizeReport(full()).skipped).toBeUndefined();
		app.unmount();
	});
	it('keeps the full lists inside "Run details" on Evidence, closed by default', async () => {
		const app = await open(scoped());
		await view(app, 'evidence');
		const details = app.get('details.run-details');
		expect(details.attributes('open')).toBeUndefined();
		const lists = details.get('.scope-details');
		expect(lists.text()).toContain('Compared targets');
		expect(lists.text()).toContain('home, about');
		expect(lists.text()).toContain('Compared viewports');
		expect(lists.text()).toContain('Baseline (A) selection');
		expect(lists.text()).toContain('Targets: home, about. Viewports: all');
		expect(lists.text()).toContain('Compared run (B) selection');
		expect(lists.text()).toContain('Full run, no selection');
		expect(lists.text()).toContain('Targets: all. Viewports: phone');
		// The lists live in one place only.
		expect(app.findAll('.scope-details')).toHaveLength(1);
		app.unmount();
	});
	it('keeps the lists in a closed "Scope details" disclosure on the other views', () => {
		const wrapper = mount(RunSummary, { props: { report: scoped() } });
		expect(wrapper.find('details.run-details').exists()).toBe(false);
		const lists = wrapper.get('details.scope-details');
		expect(lists.attributes('open')).toBeUndefined();
		expect(lists.get('summary').text()).toBe('Scope details');
		expect(lists.text()).toContain('Filter of this comparison');
		expect(wrapper.get('.summary-caption').text()).toContain('2 compared targets · 1 compared viewport.');
		const one = scoped();
		one.entries.length = 1;
		one.meta.viewports = viewports.slice(0, 2);
		expect(mount(RunSummary, { props: { report: one } }).get('.summary-caption').text()).toContain('1 compared target · 2 compared viewports.');
		expect(wrapper.get('.summary-caption').text()).not.toMatch(/\bAll\b|declared/);
		expect(mount(RunSummary, { props: { report: full() } }).get('.summary-caption').text()).toContain('All 2 targets · 1 declared viewports');
	});
	it('does not list a skipped cell in the target list', async () => {
		const app = await open(scoped());
		await view(app, 'evidence');
		const rows = app.findAll('.target-row').map((row) => row.get('.target-title').text());
		expect(rows).toEqual(['home', 'about']);
		expect(app.find('.viewer-sidebar').text()).not.toMatch(/skipped/i);
		app.unmount();
	});

	it('wraps the line and the lists at a narrow width: no fixed width and no nowrap', () => {
		// jsdom has no layout. The browser check (tests/integration/check-viewer.mjs) measures the overflow at 390 px.
		const css = readFileSync(resolve(process.cwd(), 'src/style.css'), 'utf8');
		const rule = (selector) => css.split('\n').find((line) => line.startsWith(selector + ' {')) ?? '';
		for (const selector of ['.report-scope', '.scope-details', '.scope-list dd']) {
			expect(rule(selector), selector).toMatch(/min-width: 0/);
			expect(rule(selector), selector).not.toMatch(/white-space: nowrap|(?<!-)\bwidth:/);
		}
		expect(rule('.report-scope')).toMatch(/overflow-wrap: anywhere/);
		expect(rule('.scope-list dd')).toMatch(/overflow-wrap: anywhere/);
		expect(rule('.report-scope')).toMatch(/font-size: 0\.8125rem/);
	});
});

describe('components without a fixture (#290)', () => {
	const skipped = (report) => { report.runs[0].noFixture = ['hero', 'zeta']; report.runs[1].noFixture = ['hero', 'alpha']; return report; };
	it('adds one sentence to the header line of a full report, on every view, with the count of summary', async () => {
		const report = skipped(full());
		expect(summarizeReport(report).noFixture.count).toBe(3);
		const app = await open(report);
		for (const name of ['overview', 'evidence', 'findings', 'info']) {
			await view(app, name);
			const line = app.findAll('[data-testid="scope-line"]');
			expect(line, name).toHaveLength(1);
			expect(line[0].text(), name).toBe('Not compared: 3 components have no fixture.');
			expect(line[0].element.closest('.comparison-heading'), name).not.toBeNull();
		}
		app.unmount();
	});
	it('puts it after the scope sentence in the same line when the report is scoped too', async () => {
		const app = await open(skipped(scoped()));
		await view(app, 'overview');
		expect(app.findAll('[data-testid="scope-line"]')).toHaveLength(1);
		expect(app.get('[data-testid="scope-line"]').text()).toBe('Scope: 2 of 63 targets, 1 of 4 viewports. 250 cells skipped. Not compared: 3 components have no fixture.');
		app.unmount();
	});
	it('lists them in "Run details" on Evidence, closed by default', async () => {
		const app = await open(skipped(full()));
		await view(app, 'evidence');
		const details = app.get('details.run-details');
		expect(details.attributes('open')).toBeUndefined();
		expect(details.get('.scope-details').text()).toContain('Components without a fixture');
		expect(details.get('.scope-details').text()).toContain('alpha, hero, zeta');
		expect(app.findAll('.scope-details')).toHaveLength(1);
		app.unmount();
	});
	it('lists them in the closed "Scope details" disclosure on the other views', () => {
		const wrapper = mount(RunSummary, { props: { report: skipped(full()) } });
		const lists = wrapper.get('details.scope-details');
		expect(lists.attributes('open')).toBeUndefined();
		expect(lists.get('summary').text()).toBe('Scope details');
		expect(lists.text()).toContain('alpha, hero, zeta');
		expect(lists.text()).not.toContain('Compared targets');
	});
	it('shows nothing new for a report without noFixture', async () => {
		const app = await open(full());
		await view(app, 'evidence');
		expect(app.find('[data-testid="scope-line"]').exists()).toBe(false);
		expect(app.find('.scope-details').exists()).toBe(false);
		app.unmount();
	});
});
