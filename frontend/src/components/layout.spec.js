import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import App from '../App.vue';
import { adaptReport } from '../../../src/report/model.js';

// The layout artifact (R6.15, #350): the viewer has no layout view yet. A report with one loads,
// and its findings show in the existing findings list through the shared classifier.
const respond = (status, body) => ({ ok: status < 300, status, headers: new Headers({ 'content-type': 'application/json' }), text: async () => body, json: async () => JSON.parse(body) });
const side = (run) => ({ kind: 'layout', src: `runs/${run}/layout/home/phone.json`, tool: 'test-kit-layout', version: '1.0.0', settingsHash: 'sha256:' + 'a'.repeat(64), browserVersion: '1' });
const MESSAGE = 'Layout part cards layout.gap: A 16 (--spacing-4), B 24 (--spacing-6).';
function report() {
	return {
		schemaVersion: 3,
		meta: { title: 'Layout example', generated: null, viewports: [{ id: 'phone', width: 400 }], matchBelow: 3, noiseFloor: null },
		pair: { kind: 'update', aRunId: 'a', bRunId: 'b' },
		runs: [{ id: 'a' }, { id: 'b' }],
		checks: { layout: { basis: 'relative', layer: 'package', title: 'Layout record difference' } },
		entries: [{ id: 'home', viewports: [{ id: 'phone', state: 'complete', ratio: 0, availability: { a: 'ok', b: 'ok' }, artifacts: {
			screenshot: { a: null, b: null, diff: null, state: 'complete' },
			layout: { kind: 'layout', state: 'complete', scope: { checks: ['layout'] }, a: side('a'), b: side('b'),
				diff: { kind: 'layout', src: 'diff/layout/home/phone.json', tool: 'test-kit-layout-compare', version: '1.0.0', settingsHash: 'sha256:' + 'b'.repeat(64), changed: true, checks: 1,
					counts: { parts: 1, match: 0, differs: 1, missing: 0, count: 0, differences: 1 },
					differences: [{ part: 'cards', property: 'layout.gap', kind: 'differs', a: 16, b: 24, tokenA: '--spacing-4', tokenB: '--spacing-6' }], differencesOmitted: 0 } },
		} }] }],
		findings: [{ id: 'layout-home-phone-0', targetId: 'home', viewportId: 'phone', artifact: 'layout', checkId: 'layout', layer: 'package', severity: 'warning', message: MESSAGE }],
		causes: [], rules: {},
	};
}
async function open(file) {
	vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).endsWith('/report.json') ? respond(200, JSON.stringify(file)) : respond(404, 'Not found'))));
	const app = mount(App, { attachTo: document.body });
	await flushPromises();
	await flushPromises();
	return app;
}
const view = async (app, name) => { await app.find(`button[data-view="${name}"]`).trigger('click'); await flushPromises(); };
afterEach(() => vi.unstubAllGlobals());

describe('layout artifact in the viewer (#350, R6.15)', () => {
	it('validates as a report and adds no evidence type', async () => {
		expect(() => adaptReport(report())).not.toThrow();
		const app = await open(report());
		await view(app, 'evidence');
		const types = app.findAll('nav.evidence-artifacts button').map((node) => node.text().toLowerCase());
		expect(types.some((text) => text.includes('layout'))).toBe(false);
		app.unmount();
	});
	it('lists the layout finding in the findings list with its message', async () => {
		const app = await open(report());
		await view(app, 'findings');
		expect(app.text()).toContain(MESSAGE);
		app.unmount();
	});
});
