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
		expect(app.find('nav[aria-label="Report views"]').exists()).toBe(false);
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
