import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import IndexView from './IndexView.vue';
import { parseIndex } from '../state/index-list.js';

const hostile = '<img src=x onerror=alert(1)>';
const index = parseIndex({
	schemaVersion: 1,
	reports: [
		{ id: 'example-a', kind: hostile, createdAt: '2026-10-02T09:00:00.000Z', settingsHash: 'sha256:' + 'ab'.repeat(32), path: 'reports/example-a/report.json', targets: 2 },
		{ id: 'example-b', kind: null, createdAt: null, settingsHash: null, path: null, targets: null },
		{ id: hostile, kind: 'adhoc', path: null },
	],
	runs: [{ id: 'example-run', createdAt: null, settingsHash: null, path: null }],
});

describe('IndexView', () => {
	it('renders hostile strings as text and lists nothing with an invalid id', () => {
		const view = mount(IndexView, { props: { index } });
		expect(view.find('img').exists()).toBe(false);
		expect(view.text()).toContain('Not listed because of an invalid id: 1.');
		expect(view.text()).toContain(hostile);
		expect(view.html()).toContain('&lt;img src=x onerror=alert(1)&gt;');
	});
	it('keeps the order and shows unknown values as unknown', () => {
		const view = mount(IndexView, { props: { index } });
		const rows = view.findAll('.index-list')[0].findAll('.index-row');
		expect(rows.map((row) => row.find('.index-open').text())).toEqual(['example-a', 'example-b']);
		expect(rows[1].text()).toContain('unknown · unknown · targets unknown · unknown');
		expect(rows[0].text()).toContain('2 targets');
	});
	it('makes an available report a same-page anchor and emits its id', async () => {
		const view = mount(IndexView, { props: { index } });
		const link = view.find('a.index-open');
		expect(link.attributes('href')).toBe('#r-example-a');
		await link.trigger('click');
		expect(view.emitted('open')).toEqual([['example-a']]);
	});
	it('shows an unavailable entry that is not clickable', async () => {
		const view = mount(IndexView, { props: { index } });
		const row = view.findAll('.index-row')[1];
		expect(row.find('a').exists()).toBe(false);
		expect(row.text()).toContain('unavailable');
		await row.find('.index-open').trigger('click');
		expect(view.emitted('open')).toBeUndefined();
	});
});
