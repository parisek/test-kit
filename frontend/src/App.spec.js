import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import App from './App.vue';

const index = {
	schemaVersion: 1,
	reports: [{ id: 'example-a', kind: 'update', createdAt: '2026-10-02T09:00:00.000Z', settingsHash: null, path: 'reports/example-a/report.json', targets: 1, viewports: 1,
		summary: { unexplained: 0, explained: 0, match: 1, oracle: 0, unclassified: 0, incomplete: 0 } }],
	runs: [],
};
const respond = (status, body) => ({ ok: status < 300, status, headers: new Headers({ 'content-type': 'application/json' }), text: async () => body, json: async () => JSON.parse(body) });

afterEach(() => vi.unstubAllGlobals());

describe('App on the Home', () => {
	it('shows no side panel, no target toggle and no report views, and ignores the [ key', async () => {
		vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).endsWith('index.json') ? respond(200, JSON.stringify(index)) : respond(404, 'Not found'))));
		const app = mount(App, { attachTo: document.body });
		await flushPromises();
		await flushPromises();
		expect(app.find('h1').text()).toBe('Comparisons');
		expect(app.find('.header-brand').text()).toContain('test kit');
		expect(app.find('#sidebar').exists()).toBe(false);
		expect(app.find('#sidebar-toggle').exists()).toBe(false);
		expect(app.find('[role=tablist]').exists()).toBe(false);
		document.dispatchEvent(new KeyboardEvent('keydown', { key: '[' }));
		await flushPromises();
		expect(app.find('#sidebar').exists()).toBe(false);
		app.unmount();
	});
});

describe('App with no data (R10.10)', () => {
	it('shows the source form only when report.json and index.json are both missing, and keeps the origin rule', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => respond(404, 'Not found')));
		const app = mount(App, { attachTo: document.body });
		await flushPromises();
		await flushPromises();
		expect(app.find('h1').text()).toBe('Open a report');
		const input = app.find('#source');
		await input.setValue('https://example.invalid/report.json');
		await app.find('#source-form').trigger('submit');
		await flushPromises();
		expect(app.find('#notice').text()).toMatch(/origin/);
		app.unmount();
	});
	it('treats an HTML body with HTTP 200 as missing, alone or mixed with a 404', async () => {
		const html = () => ({ ...respond(200, '<!doctype html><p>front controller</p>'), headers: new Headers({ 'content-type': 'text/html' }) });
		for (const fetcher of [async () => html(), async (url) => (String(url).endsWith('index.json') ? html() : respond(404, 'Not found'))]) {
			vi.stubGlobal('fetch', vi.fn(fetcher));
			const app = mount(App, { attachTo: document.body });
			await flushPromises();
			await flushPromises();
			expect(app.find('#source-form').exists()).toBe(true);
			app.unmount();
		}
	});
	it('keeps the form after a failed try from the form, so the person can try again', async () => {
		// The adjacent sources are still missing, so the R10.10 condition still holds.
		vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).endsWith('other.json') ? respond(500, 'Server error') : respond(404, 'Not found'))));
		const app = mount(App, { attachTo: document.body });
		await flushPromises();
		await flushPromises();
		await app.find('#source').setValue('other.json');
		await app.find('#source-form').trigger('submit');
		await flushPromises();
		expect(app.find('#notice').text()).toMatch(/HTTP 500/);
		expect(app.find('#source-form').exists()).toBe(true);
		app.unmount();
	});
	it('shows no source form on the Home', async () => {
		vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).endsWith('index.json') ? respond(200, JSON.stringify(index)) : respond(404, 'Not found'))));
		const app = mount(App, { attachTo: document.body });
		await flushPromises();
		await flushPromises();
		expect(app.find('#source-form').exists()).toBe(false);
		expect(app.text()).not.toContain('Report source');
		app.unmount();
	});
	it('shows no source form when a source fails for another reason than missing', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => respond(500, 'Server error')));
		const app = mount(App, { attachTo: document.body });
		await flushPromises();
		await flushPromises();
		expect(app.find('#source-form').exists()).toBe(false);
		expect(app.find('#notice').text()).toMatch(/HTTP 500/);
		app.unmount();
	});
});

const reportFile = (title, generated) => ({
	schemaVersion: 2,
	meta: { title, generated, viewports: [{ id: 'wide' }], matchBelow: 3, noiseFloor: null },
	pair: { kind: 'update', aRunId: 'a', bRunId: 'b' },
	runs: [{ id: 'a' }, { id: 'b' }],
	entries: [{ id: 'example', viewports: [{ id: 'wide', state: 'complete', ratio: 0 }] }],
	findings: [], causes: [], rules: {},
});

describe('App on a report from the index (R10.3)', () => {
	const entry = (id, createdAt, path = `reports/${id}/report.json`) => ({ id, kind: 'update', createdAt, settingsHash: null, path, targets: 1, viewports: 1,
		summary: { unexplained: 0, explained: 0, match: 1, oracle: 0, unclassified: 0, incomplete: 0 } });
	const listed = { schemaVersion: 1, reports: [entry('example-c', '2026-10-03T09:00:00.000Z'), entry('example-b', '2026-10-02T09:00:00.000Z', null), entry('example-a', '2026-10-01T09:00:00.000Z')], runs: [] };
	const files = {
		'index.json': listed,
		'reports/example-c/report.json': reportFile('Newest example', '2026-10-03T09:00:00.000Z'),
		'reports/example-a/report.json': reportFile('Oldest example', '2026-10-01T09:00:00.000Z'),
	};
	const serve = async (url) => {
		const key = Object.keys(files).find((name) => String(url).endsWith('/' + name));
		return key ? respond(200, JSON.stringify(files[key])) : respond(404, 'Not found');
	};
	it('shows the breadcrumb first, the time in the title, and older and newer links that skip unavailable entries', async () => {
		vi.stubGlobal('fetch', vi.fn(serve));
		const app = mount(App, { attachTo: document.body });
		await flushPromises();
		await flushPromises();
		await app.find('a.button-primary').trigger('click', { button: 0 });
		await flushPromises();
		await flushPromises();
		const crumb = app.find('nav[aria-label="Breadcrumb"]');
		expect(crumb.exists()).toBe(true);
		expect(crumb.text()).toContain('Comparisons');
		expect(app.find('.report-time time').attributes('title')).toBe('2026-10-03T09:00:00.000Z');
		expect(document.title).toContain('Newest example');
		const order = app.find('nav[aria-label="Comparison order"]');
		expect(order.text()).toContain('1 of 2');
		expect(order.find('a').text()).toBe('Older');
		await order.find('a').trigger('click');
		await flushPromises();
		await flushPromises();
		expect(app.find('h1').text()).toBe('Oldest example');
		expect(app.find('nav[aria-label="Comparison order"]').text()).toContain('2 of 2');
		await app.find('nav[aria-label="Breadcrumb"] a').trigger('click');
		await flushPromises();
		expect(app.find('h1').text()).toBe('Comparisons');
		expect(document.title).toBe('Comparisons · test kit');
		app.unmount();
	});
	it('shows no breadcrumb and no order links for a report next to the viewer', async () => {
		vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).endsWith('/report.json') ? respond(200, JSON.stringify(reportFile('Adjacent', null))) : respond(404, 'Not found'))));
		const app = mount(App, { attachTo: document.body });
		await flushPromises();
		await flushPromises();
		expect(app.find('nav[aria-label="Breadcrumb"]').exists()).toBe(false);
		expect(app.find('nav[aria-label="Comparison order"]').exists()).toBe(false);
		expect(app.find('.report-time').text()).toBe('Time unknown');
		app.unmount();
	});
});

describe('App report views (R10.4, R10.5)', () => {
	it('opens on Overview with four tabs, shows the target panel only on Evidence, and leads back to the Overview', async () => {
		const file = reportFile('Adjacent', null);
		vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).endsWith('/report.json') ? respond(200, JSON.stringify(file)) : respond(404, 'Not found'))));
		const app = mount(App, { attachTo: document.body });
		await flushPromises();
		await flushPromises();
		const tabs = app.findAll('[role=tab]');
		expect(tabs.map((tab) => tab.text())).toEqual(['Overview', 'Evidence', 'Findings', 'Run info']);
		expect(app.find('[role=tab][aria-selected=true]').text()).toBe('Overview');
		expect(app.find('[role=tabpanel]').attributes('aria-labelledby')).toBe('tab-overview');
		expect(app.find('#sidebar').exists()).toBe(false);
		await app.find('[role=tablist]').trigger('keydown', { key: 'ArrowRight' });
		await flushPromises();
		expect(app.find('[role=tab][aria-selected=true]').text()).toBe('Evidence');
		expect(app.find('#sidebar').exists()).toBe(true);
		const crumb = app.find('nav[aria-label="Breadcrumb"]');
		expect(crumb.text()).toContain('Evidence');
		await crumb.find('a').trigger('click');
		await flushPromises();
		expect(app.find('[role=tab][aria-selected=true]').text()).toBe('Overview');
		expect(app.find('#sidebar').exists()).toBe(false);
		expect(app.find('nav[aria-label="Breadcrumb"]').exists()).toBe(false);
		app.unmount();
	});
});
