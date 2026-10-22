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
		expect(app.find('#sidebar').exists()).toBe(false);
		expect(app.find('#sidebar-toggle').exists()).toBe(false);
		expect(app.find('nav[aria-label="Report views"]').exists()).toBe(false);
		document.dispatchEvent(new KeyboardEvent('keydown', { key: '[' }));
		await flushPromises();
		expect(app.find('#sidebar').exists()).toBe(false);
		app.unmount();
	});
});
