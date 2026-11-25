import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import App from '../App.vue';

// #433, R8.18: the size signal of a screenshot pair in the sidebar label, the Overview matrix and Evidence.
const respond = (status, body) => ({ ok: status < 300, status, headers: new Headers({ 'content-type': 'application/json' }), text: async () => body, json: async () => JSON.parse(body) });
const shot = (ratio, size) => ({ kind: 'screenshot', state: 'complete', diff: { ratio, ...(size ? { size } : {}) } });
const row = (id, ratio, size) => ({ id, state: 'complete', ratio, availability: { a: 'ok', b: 'ok' }, artifacts: { screenshot: shot(ratio, size) } });
const tall = { a: { width: 1280, height: 2000 }, b: { width: 1280, height: 1340 } };
const same = { a: { width: 1280, height: 900 }, b: { width: 1280, height: 900 } };
function report() {
	return {
		schemaVersion: 2,
		meta: { title: 'Size example', generated: null, viewports: [{ id: 'phone', width: 400 }, { id: 'laptop', width: 1280 }], matchBelow: 3, noiseFloor: null },
		pair: { kind: 'update', aRunId: 'a', bRunId: 'b' },
		runs: [{ id: 'a' }, { id: 'b' }],
		entries: [
			{ id: 'home', viewports: [row('phone', 0.014, tall), row('laptop', 0.002, same)] },
			{ id: 'about', viewports: [row('phone', 0.01, same), row('laptop', 0.01, { a: { width: 0, height: 5 }, b: { width: 3, height: 5 } })] },
		],
		findings: [], causes: [], rules: {},
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
const LINE = 'Size: A 1280×2000 px · B 1280×1340 px · height 33.0 %';

afterEach(() => vi.unstubAllGlobals());

describe('size signal in the viewer (#433, R8.18)', () => {
	it('adds the size label after the ratio of a target with a size change only', async () => {
		const app = await open(report());
		await view(app, 'evidence');
		const labels = app.findAll('.target-ratio').map((node) => node.text());
		expect(labels).toHaveLength(2);
		expect(labels[0]).toMatch(/ · Size Δ$/);
		expect(labels[1]).not.toMatch(/Size/);
		app.unmount();
	});
	it('shows one size line in the matrix cell and on Evidence, and none for equal or invalid sizes', async () => {
		const app = await open(report());
		await view(app, 'overview');
		expect(app.findAll('[data-testid="cell-size"]').map((node) => node.text())).toEqual([LINE]);
		await view(app, 'evidence');
		expect(app.get('[data-testid="cell-size"]').text()).toBe(LINE);
		app.unmount();
	});
	it('gives Size Δ for a ratio of 0 only when the stored sizes are valid', async () => {
		const data = report();
		data.entries[0].viewports = [row('phone', 0, tall), row('laptop', 0, same)];
		data.entries[1].viewports = [row('phone', 0, { a: { width: 0, height: 5 }, b: { width: 3, height: 5 } }), row('laptop', 0, same)];
		data.findings = ['home', 'about'].map((id) => ({ id: `${id}-phone`, targetId: id, viewportId: 'phone', artifact: 'screenshot', layer: 'package', message: 'Screenshot dimensions differ.' }));
		const app = await open(data);
		await view(app, 'evidence');
		expect(app.findAll('.target-ratio').map((node) => node.text())).toEqual(['Size Δ', 'Screenshot Δ']);
		app.unmount();
	});
	it('derives the line from the sizes and ignores a stored sizeMismatch', async () => {
		const data = report();
		data.entries[1].viewports[0].artifacts.screenshot.diff.sizeMismatch = { axis: 'height', a: { width: 1, height: 1 }, b: { width: 1, height: 2 }, percent: 50 };
		const app = await open(data);
		await view(app, 'overview');
		expect(app.findAll('[data-testid="cell-size"]').map((node) => node.text())).toEqual([LINE]);
		app.unmount();
	});
});
