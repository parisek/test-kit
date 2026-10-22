import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import IndexView from './IndexView.vue';
import { parseIndex } from '../state/index-list.js';

const hostile = '<img src=x onerror=alert(1)>';
const hash = (c) => 'sha256:' + c.repeat(64);
const summary = (extra = {}) => ({ unexplained: 0, explained: 0, match: 0, oracle: 0, unclassified: 0, incomplete: 0, ...extra });
const report = (id, createdAt, extra = {}) => ({ id, kind: 'update', createdAt, settingsHash: hash('a'), path: `reports/${id}/report.json`, targets: 3, viewports: 2, summary: summary({ match: 3 }), ...extra });
const index = parseIndex({
	schemaVersion: 1,
	reports: [
		report('example-c', '2026-10-03T09:00:00.000Z', { kind: hostile, settingsHash: hash('b'), summary: summary({ match: 2, unexplained: 1, incomplete: 1 }) }),
		report('example-b', '2026-10-02T09:00:00.000Z', { path: null }),
		report('example-a', '2026-10-01T09:00:00.000Z'),
		report('example-old', null, { targets: null, viewports: null, summary: null }),
		{ id: hostile, kind: 'adhoc', path: null },
	],
	runs: [{ id: 'example-run', createdAt: null, settingsHash: null, path: null }],
});

describe('Home focus', () => {
	it('makes the heading focusable by script only and focuses it on request', () => {
		const view = mount(IndexView, { props: { index }, attachTo: document.body });
		const heading = view.find('h1');
		expect(heading.attributes('tabindex')).toBe('-1');
		view.vm.focus();
		expect(document.activeElement).toBe(heading.element);
		view.unmount();
	});
});

describe('Home', () => {
	it('renders hostile strings as text and counts entries with an invalid id', () => {
		const view = mount(IndexView, { props: { index } });
		expect(view.find('img').exists()).toBe(false);
		expect(view.text()).toContain('Not listed because of an invalid id: 1.');
		expect(view.html()).toContain('&lt;img src=x onerror=alert(1)&gt;');
	});
	it('opens with the latest comparison: verdict in words, counts, incomplete as a state', async () => {
		const view = mount(IndexView, { props: { index } });
		const card = view.find('.latest-card');
		expect(card.text()).toContain('1 page differs without an explanation. 1 page is incomplete');
		expect(card.find('time').attributes('title')).toBe('2026-10-03T09:00:00.000Z');
		const counts = card.findAll('.verdict-count').map((item) => [item.attributes('data-verdict'), item.text()]);
		expect(counts).toEqual([['match', '2match'], ['zero', '0explained'], ['unexplained', '1unexplained'], ['incomplete', '1incomplete (state)']]);
		const button = card.find('a.button-primary');
		expect(button.attributes('href')).toBe('#r-example-c');
		await button.trigger('click');
		expect(view.emitted('open')).toEqual([['example-c']]);
	});
	it('shows one dot per comparison, oldest first, and marks an unavailable one', () => {
		const view = mount(IndexView, { props: { index } });
		const dots = view.findAll('.strip-dots li').map((item) => item.text());
		expect(dots).toHaveLength(4);
		expect(dots[0]).toContain('not measured');
		// An unavailable comparison keeps its class word; availability is extra text.
		expect(dots[2]).toContain('match');
		expect(dots[2]).toContain('unavailable');
		expect(dots[3]).toContain('unexplained');
	});
	it('groups rows by day and shows the change, the incomplete state and a new settings hash', () => {
		const view = mount(IndexView, { props: { index } });
		const groups = view.findAll('.home-day');
		expect(groups).toHaveLength(4);
		expect(groups[3].find('h2').text()).toBe('Time unknown');
		const first = groups[0].find('.comparison-row');
		expect(first.element.tagName).toBe('A');
		expect(first.text()).toContain('unexplained');
		expect(first.text()).toContain('1 incomplete');
		expect(first.text()).toContain('3 pages, 2 viewports');
		expect(first.text()).toContain('+1 unexplained, −1 match, +1 incomplete');
		expect(first.text()).toContain('settings changed: ' + hash('b').slice(0, 19));
	});
	it('shows an unavailable comparison with its summary, not as a link', async () => {
		const view = mount(IndexView, { props: { index } });
		const row = view.findAll('.home-day')[1].find('.comparison-row');
		expect(row.element.tagName).toBe('DIV');
		expect(row.attributes('aria-disabled')).toBe('true');
		expect(row.text()).toContain('match');
		expect(row.text()).toContain('unavailable');
		await row.trigger('click');
		expect(view.emitted('open')).toBeUndefined();
	});
	it('shows unknown values as unknown, never as 0', () => {
		const view = mount(IndexView, { props: { index } });
		const row = view.findAll('.home-day')[3].find('.comparison-row');
		expect(row.text()).toContain('not measured');
		expect(row.text()).toContain('pages unknown');
		expect(row.text()).not.toContain('0 pages');
	});
	it('lists stored runs in a closed disclosure', () => {
		const view = mount(IndexView, { props: { index } });
		const runs = view.find('details.home-runs');
		expect(runs.attributes('open')).toBeUndefined();
		expect(runs.text()).toContain('Stored runs (1)');
	});
	it('says so when the index lists no comparisons', () => {
		const view = mount(IndexView, { props: { index: parseIndex({ schemaVersion: 1, reports: [], runs: [] }) } });
		expect(view.text()).toContain('The index lists no comparisons.');
	});
});
