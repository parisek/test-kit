import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import App from '../App.vue';
import { summarizeReport } from '../../../src/query/summary.js';

// Owner decision on #329 (2026-11-06): capture warnings (R5.11) in the header line and in the cell.
const respond = (status, body) => ({ ok: status < 300, status, headers: new Headers({ 'content-type': 'application/json' }), text: async () => body, json: async () => JSON.parse(body) });
const CODE = 'LAZY_IMAGES_NOT_SWEPT';
const row = (id, warnings) => ({ id, state: 'complete', ratio: 0, availability: { a: 'ok', b: 'ok' }, ...(warnings ? { warnings } : {}) });
function report() {
	return {
		schemaVersion: 2,
		meta: { title: 'Warning example', generated: null, viewports: [{ id: 'phone', width: 400 }, { id: 'laptop', width: 1200 }], matchBelow: 3, noiseFloor: null },
		pair: { kind: 'update', aRunId: 'a', bRunId: 'b' },
		runs: [{ id: 'a' }, { id: 'b' }],
		entries: [
			{ id: 'home', viewports: [row('phone', { a: [{ code: CODE, count: 7 }], b: [] }), row('laptop', { a: [{ code: CODE, count: 3 }], b: [{ code: CODE, count: 2 }] })] },
			{ id: 'about', viewports: [row('phone'), row('laptop')] },
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

afterEach(() => vi.unstubAllGlobals());

describe('capture warnings in the viewer (#329, R5.11)', () => {
	it('adds one sentence to the header line on every view, with the numbers of summary', async () => {
		const data = report();
		const [item] = summarizeReport(data).captureWarnings;
		expect(item).toEqual({ code: CODE, cells: 3, count: 12 });
		const app = await open(data);
		for (const name of ['overview', 'evidence', 'findings', 'info']) {
			await view(app, name);
			const line = app.findAll('[data-testid="scope-line"]');
			expect(line, name).toHaveLength(1);
			expect(line[0].text(), name).toBe(`Capture warnings: ${item.code} in ${item.cells} cells (${item.count} in all).`);
			expect(line[0].element.closest('.comparison-heading'), name).not.toBeNull();
		}
		app.unmount();
	});
	it('shows the detail of each cell in the Overview matrix and on Evidence, and none for a clean cell', async () => {
		const app = await open(report());
		await view(app, 'overview');
		const cells = app.findAll('[data-testid="cell-warning"]').map((node) => node.text());
		expect(cells).toEqual([`A: ${CODE} (7) · B: none`, `A: ${CODE} (3) · B: ${CODE} (2)`]);
		await view(app, 'evidence');
		expect(app.get('[data-testid="cell-warning"]').text()).toMatch(/^A: LAZY_IMAGES_NOT_SWEPT \(\d+\) · B: /);
		app.unmount();
	});
	it('shows nothing new for a report without a valid warning, and ignores a bad shape', async () => {
		const data = report();
		data.entries[0].viewports = [row('phone', { a: [{ code: 'bad code', count: 1 }], b: 'x' }), row('laptop', { a: [{ code: CODE, count: 0 }], b: [] })];
		const app = await open(data);
		for (const name of ['overview', 'evidence']) {
			await view(app, name);
			expect(app.findAll('[data-testid="scope-line"]'), name).toHaveLength(0);
			expect(app.findAll('[data-testid="cell-warning"]'), name).toHaveLength(0);
		}
		app.unmount();
	});
	it('renders warning text as text, never as markup', async () => {
		const data = report();
		data.entries[0].viewports[0].warnings = { a: [{ code: 'X<img src=x onerror=alert(1)>', count: 1 }], b: [{ code: CODE, count: 1 }] };
		const app = await open(data);
		await view(app, 'overview');
		expect(app.html()).not.toContain('<img src=x');
		expect(app.findAll('[data-testid="cell-warning"]')[0].text()).toBe(`A: none · B: ${CODE} (1)`);
		app.unmount();
	});
});
