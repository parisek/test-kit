import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import EvidenceImage from './EvidenceImage.vue';
import TargetDetail from './TargetDetail.vue';
import MatrixView from './MatrixView.vue';
import FindingsView from './FindingsView.vue';
import TimelineView from './TimelineView.vue';
const row = {
	id: 'phone',
	state: 'failed',
	availability: { a: 'available', b: 'http-error' },
	diagnostic: '<script>bad()</script>',
	artifacts: {
		screenshot: {
			a: { src: 'a.png' },
			b: { src: 'https://other.example/b.png' },
			diff: { regions: [{ x: 2, unit: 'px' }] },
		},
	},
};
function report() {
	return {
		meta: { viewports: [{ id: 'phone' }], tools: [{ name: 'capture', version: '1' }] },
		entries: [
			{
				id: 'button',
				title: '<img src=x onerror=bad()>',
				kind: 'component',
				note: 'A note',
				viewports: [structuredClone(row)],
			},
			{ id: 'page', title: 'Example page', composedOf: ['button', { id: 'other' }], viewports: [] },
		],
		findings: [
			{ id: 'one', targetId: 'button', artifact: 'screenshot', causeId: 'known' },
			{ id: 'two', targetId: 'page', artifact: 'html' },
		],
		causes: [{ id: 'known', title: 'Expected change', known: true }],
		runs: [
			{
				id: 'run-a',
				side: 'a',
				settings: { sides: { a: { settle: { wait: 'ready' } } } },
				settingsHash: 'hash-a',
			},
		],
	};
}
const props = () => ({
	report: report(),
	targetId: 'button',
	viewportId: 'phone',
	source: 'http://localhost/report.json',
});
describe('viewer evidence', () => {
	it('guards evidence links and resets an image error when the source changes', async () => {
		const wrapper = mount(EvidenceImage, {
			props: { src: 'a.png', source: 'http://localhost/report.json', title: 'A' },
		});
		expect(wrapper.get('a').attributes('href')).toBe('http://localhost/a.png');
		await wrapper.get('img').trigger('error');
		expect(wrapper.text()).toContain('Image is unavailable.');
		await wrapper.setProps({ src: 'next.png' });
		expect(wrapper.get('img').attributes('loading')).toBe('lazy');
		await wrapper.setProps({ src: 'https://other.example/x.png' });
		expect(wrapper.find('a').exists()).toBe(false);
		expect(wrapper.find('img').exists()).toBe(false);
	});
	it('renders incomplete evidence, composition, diagnostics and untrusted text', async () => {
		const wrapper = mount(TargetDetail, { props: props() });
		expect(wrapper.text()).toContain('unclassified');
		expect(wrapper.text()).toContain('failed');
		expect(wrapper.text()).toContain('B: http-error');
		expect(wrapper.text()).toContain('Used on: Example page');
		expect(wrapper.text()).toContain('<script>bad()</script>');
		expect(wrapper.find('script').exists()).toBe(false);
		expect(wrapper.findAll('img')).toHaveLength(1);
		expect(wrapper.text()).toContain('Artifact provenance');
		await wrapper.get('select').trigger('change');
		expect(wrapper.emitted('action')[0]).toEqual(['viewport', 'phone']);
		await wrapper.setProps({ targetId: 'page' });
		expect(wrapper.text()).toContain('Composed of: button, other');
	});
	it('ignores a malformed optional composition field without hiding evidence', () => {
		const data = report();
		data.entries[0].composedOf = { id: 'page' };
		data.entries[1].composedOf = 'button';
		const wrapper = mount(TargetDetail, { props: { ...props(), report: data } });
		expect(wrapper.text()).toContain('failed');
		expect(wrapper.text()).not.toContain('Composed of:');
		expect(wrapper.text()).not.toContain('Used on:');
	});
	it('keeps missing matrix cells unclassified and routes selection through an action', async () => {
		const wrapper = mount(MatrixView, { props: props() });
		const cells = wrapper.findAll('td');
		expect(cells[0].text()).toContain('failed');
		expect(cells[1].text()).toContain('missing');
		expect(cells[1].text()).toContain('unclassified');
		await wrapper.get('button').trigger('click');
		expect(wrapper.emitted('action')[0]).toEqual(['target', 'button']);
	});
	it('groups known and unknown causes and shows run provenance', () => {
		const findings = mount(FindingsView, { props: props() });
		expect(findings.text()).toContain('Expected change');
		expect(findings.text()).toContain('explained');
		expect(findings.text()).toContain('Unknown cause');
		const timeline = mount(TimelineView, { props: props() });
		expect(timeline.text()).toContain('ready');
		expect(timeline.text()).toContain('capture');
		expect(timeline.text()).toContain('hash-a');
	});
});
