import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import App from '../App.vue';
import { useViewer } from './useViewer.js';

// A subject report (R9.7) through the whole viewer path: load, deep link, evidence and render. Data is example-site only.
const evidence = (src) => ({ src, tool: 'example', version: '1', settingsHash: 'sha256:x' });
const subject = () => ({
	schemaVersion: 3, meta: { title: 'Example check', matchBelow: 3, viewports: [{ id: 'desktop', width: 1280, height: 800 }] },
	runs: [{ id: 'run-1', side: 'test', label: 'Checked run', at: '2026-11-04T09:00:00.000Z' }], subject: { kind: 'single-run', runId: 'run-1' },
	checks: { 'a11y-axe': { basis: 'absolute', layer: 'package', title: 'Accessibility (axe)' }, 'eslint-no-console': { basis: 'absolute', layer: 'project', title: 'No console call' } },
	entries: [
		{ id: 'button', kind: 'component', title: 'Button', viewports: [{ id: 'desktop', state: 'complete', artifacts: { a11y: { state: 'complete', scope: { checks: ['a11y-axe'] }, evidence: evidence('runs/run-1/a11y.json'), result: { violations: true, checks: 1 } } } }], artifacts: {} },
		{ id: '@project', kind: 'project', title: 'Project', viewports: [], artifacts: { lint: { state: 'complete', scope: { checks: ['eslint-no-console'] }, evidence: evidence('runs/run-1/lint.json'), result: { violations: true, checks: 1 } } } },
	],
	causes: [], rules: {},
	findings: [
		{ id: 'f-axe', targetId: 'button', viewportId: 'desktop', artifact: 'a11y', checkId: 'a11y-axe', runId: 'run-1', layer: 'component', severity: 'error', message: 'Insufficient color contrast.', location: { selector: '.example-site-button' } },
		{ id: 'f-lint', targetId: '@project', artifact: 'lint', checkId: 'eslint-no-console', runId: 'run-1', layer: 'project', severity: 'error', message: 'Unexpected console statement.', location: { file: 'src/example-site/header.js', line: 12, column: 3 } },
	],
});
const respond = (status, body) => ({ ok: status < 300, status, headers: new Headers({ 'content-type': 'application/json' }), text: async () => body, json: async () => JSON.parse(body) });
const fetcher = () => vi.fn(async (url) => (new URL(url).pathname.endsWith('/report.json') ? respond(200, JSON.stringify(subject())) : respond(404, 'Not found')));
const host = (hash = '') => {
	const location = { href: 'http://localhost:4178/site/index.html', pathname: '/site/index.html', search: '', hash };
	const write = (state, title, url) => { const at = url.indexOf('#'); location.hash = at < 0 ? '' : url.slice(at); };
	return { document: { baseURI: 'http://localhost:4178/site/index.html' }, location, history: { replaceState: vi.fn(write), pushState: vi.fn(write) } };
};

afterEach(() => vi.unstubAllGlobals());

describe('subject report in the viewer state', () => {
	it('opens the project entry from a deep link that matches report data, and writes the link back (R10.14)', async () => {
		const browser = host();
		const instance = useViewer({ browser, fetch: fetcher(), width: () => 1280 });
		await instance.start();
		expect(instance.state.report.subject.runId).toBe('run-1');
		instance.dispatch('evidence', { targetId: '@project', artifact: 'lint', findingId: 'f-lint' });
		expect(instance.state).toMatchObject({ view: 'evidence', targetId: '@project', findingId: 'f-lint' });
		const written = browser.history.pushState.mock.lastCall[2].slice('/site/index.html'.length);
		expect(written).toContain('%40project');
		expect(written).toMatch(/\/\/f-lint$/);
		await instance.applyHash(written);
		expect(instance.state.notice).not.toMatch(/names a|finding wins|valid/);
		expect(instance.state).toMatchObject({ view: 'evidence', targetId: '@project', findingId: 'f-lint' });
	});
	it('opens the project entry from a hash on load', async () => {
		const instance = useViewer({ browser: host('#evidence/%40project///f-lint'), fetch: fetcher(), width: () => 1280 });
		await instance.start();
		expect(instance.state).toMatchObject({ view: 'evidence', targetId: '@project' });
		expect(instance.state.notice).not.toMatch(/names a/);
	});
});

describe('App with a subject report', () => {
	it('renders the heading, the run card, the matrix and the project evidence without a pair', async () => {
		vi.stubGlobal('fetch', fetcher());
		const app = mount(App, { attachTo: document.body });
		await flushPromises();
		await flushPromises();
		expect(app.find('.comparison-heading').text()).toContain('Single-run result');
		expect(app.find('h1').text()).toBe('Example check');
		expect(app.text()).toContain('Checked run');
		expect(app.text()).toContain('Open project evidence');
		expect(app.text()).not.toContain('Absent declared viewport');
		await app.find('[data-view=evidence]').trigger('click');
		await flushPromises();
		expect(app.text()).toContain('Checks');
		app.unmount();
	});
});
