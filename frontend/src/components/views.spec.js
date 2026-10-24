import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import EvidenceImage from './EvidenceImage.vue';
import TargetDetail from './TargetDetail.vue';
import MatrixView from './MatrixView.vue';
import FindingsView from './FindingsView.vue';
import TimelineView from './TimelineView.vue';
import RunSummary from './RunSummary.vue';
import ReportFilters from './ReportFilters.vue';
import ArtifactEvidence from './ArtifactEvidence.vue';
import Badge from './Badge.vue';
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
		expect(wrapper.text()).toContain('artifact provenance');
		await wrapper.get('[aria-label="Viewport"] button').trigger('click');
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
		expect(findings.text()).toContain('No recorded cause');
		const timeline = mount(TimelineView, { props: props() });
		expect(timeline.text()).toContain('ready');
		expect(timeline.text()).toContain('capture');
		expect(timeline.text()).toContain('hash-a');
	});
});

describe('filtered evidence navigation', () => {
    it('links a finding to its exact viewport through one action', async () => {
        const data = report();
        data.findings[0].viewportId = 'phone';
        const wrapper = mount(FindingsView, { props: { ...props(), report: data, targets: [data.entries[0]], filters: { cause: 'cause:known' } } });
        expect(wrapper.text()).not.toContain('Example page');
        await wrapper.get('button').trigger('click');
        expect(wrapper.emitted('action')[0]).toEqual(['evidence', { targetId: 'button', viewportId: 'phone', artifact: 'screenshot', findingId: data.findings[0].id }]);
    });
    it('shows missing selected evidence instead of another viewport', () => {
        const data = report();
        data.meta.viewports.push({ id: 'wide' });
        const wrapper = mount(TargetDetail, { props: { ...props(), report: data, viewportId: 'wide' } });
        expect(wrapper.text()).toContain('Missing evidence for wide');
        expect(wrapper.findAll('img')).toHaveLength(0);
    });
});

describe('comparison overview', () => {
    it('shows side identities, dates, and availability without injecting run labels', () => {
        const data = report();
        data.pair = { aRunId: 'run-a', bRunId: 'run-b' };
        data.runs[0].label = '<script>bad()</script>';
        data.runs[0].at = '2026-10-09T10:00:00Z';
        const wrapper = mount(RunSummary, { props: { report: data } });
        expect(wrapper.findAll('h2').map(title => title.text())).toEqual(['<script>bad()</script>', 'run-b']);
        expect(wrapper.text()).toContain('Baseline · a');
        expect(wrapper.text()).toContain('Compared run');
        expect(wrapper.find('time').attributes('title')).toBe('2026-10-09T10:00:00Z');
        expect(wrapper.text()).toContain('Availability problems: 1');
        expect(wrapper.find('script').exists()).toBe(false);
    });
    it('reports absent declared viewport rows separately from stored target counts', () => {
        const data = report();
        data.pair = { aRunId: 'run-a', bRunId: 'run-b' };
        data.meta.viewports.push({ id: 'wide' });
        data.entries = [data.entries[0]];
        const wrapper = mount(RunSummary, { props: { report: data } });
        expect(wrapper.text()).toContain('Absent declared viewport measurements: 1');
        expect(wrapper.text()).toContain('Stored target counts do not include absent rows');
    });
    it('marks zero counts and the unclassified count for the muted color', () => {
        const data = report();
        data.pair = { aRunId: 'run-a', bRunId: 'run-b' };
        const summary = { counts: { unexplained: 1, explained: 0, match: 0, incomplete: 2, oracle: 0, unclassified: 1 } };
        const wrapper = mount(RunSummary, { props: { report: data, summary } });
        const zero = wrapper.findAll('.summary-metric[data-zero]').map(metric => metric.attributes('data-status'));
        expect(zero).toEqual(['match', 'explained']);
        expect(wrapper.findAll('.summary-metric').filter(metric => metric.text().startsWith('0')).every(metric => metric.attributes('data-zero') !== undefined)).toBe(true);
        expect(wrapper.findAll('.summary-metric').filter(metric => !metric.text().startsWith('0')).every(metric => metric.attributes('data-zero') === undefined)).toBe(true);
        expect(wrapper.find('.summary-metric[data-status=unclassified]').text()).toContain('unclassified');
    });
    it('shows the classes first and incomplete last, labelled as a state (DESIGN.md "Counts")', () => {
        const data = report();
        data.pair = { aRunId: 'run-a', bRunId: 'run-b' };
        const summary = { counts: { unexplained: 1, explained: 0, match: 2, incomplete: 1, oracle: 1, unclassified: 1 } };
        const wrapper = mount(RunSummary, { props: { report: data, summary } });
        expect(wrapper.findAll('.summary-metric').map(metric => metric.attributes('data-status'))).toEqual(['match', 'explained', 'unexplained', 'oracle', 'unclassified', 'incomplete']);
        const state = wrapper.get('.summary-metric[data-status=incomplete]');
        expect(state.classes()).toContain('summary-state');
        expect(state.text()).toContain('Incomplete (state)');
    });
    it('does not count healthy engine availability as an error', () => {
        const data = report();
        data.pair = { aRunId: 'run-a', bRunId: 'run-b' };
        data.entries[0].viewports[0].availability = { a: 'ok', b: 'ok' };
        const wrapper = mount(RunSummary, { props: { report: data } });
        expect(wrapper.text()).not.toContain('Availability problems');
    });
    it('emits filter actions with tagged causes and an explicit clear action', async () => {
        const data = report();
        data.causes[0].known = 'false';
        const wrapper = mount(ReportFilters, { props: { report: data, count: 1, filters: { classification: 'all', measurement: 'all', cause: 'all' } } });
        await wrapper.get('[aria-label="Cause filter"]').setValue('cause:known');
        expect(wrapper.emitted('action')[0]).toEqual(['filter', { key: 'cause', value: 'cause:known' }]);
        await wrapper.findAll('button').find(button => button.text() === 'Clear filters').trigger('click');
        expect(wrapper.emitted('action')[1]).toEqual(['clear-filters']);
        expect(wrapper.text()).toContain('1 of 2 targets');
        expect(wrapper.text()).toContain('Expected change · unexplained');
    });
    it('shows each class once: All, Unexplained and Match first, the other classes under More filters (DESIGN.md "Filter group", #203)', async () => {
        const wrapper = mount(ReportFilters, { props: { report: report(), count: 2, filters: { classification: 'all', measurement: 'all', cause: 'all' } } });
        const classButtons = wrapper.findAll('[aria-pressed]').map(button => button.text());
        expect(classButtons).toEqual(['All', 'Unexplained', 'Match', 'Explained', 'Oracle', 'Unclassified']);
        expect(wrapper.find('select[aria-label="Class filter"]').exists()).toBe(false);
        expect(wrapper.get('[role="group"][aria-labelledby="filter-group-label"]').text()).toContain('Filter');
        const more = wrapper.findAll('button').find(button => button.text() === 'More filters');
        expect(more.attributes('aria-expanded')).toBe('false');
        expect(wrapper.get('#more-filters').attributes('style') ?? '').toContain('display: none');
        await more.trigger('click');
        expect(more.attributes('aria-expanded')).toBe('true');
        expect(wrapper.get('#more-filters').attributes('style') ?? '').not.toContain('display: none');
        await wrapper.findAll('button').find(button => button.text() === 'Unexplained').trigger('click');
        await wrapper.findAll('button').find(button => button.text() === 'Oracle').trigger('click');
        expect(wrapper.emitted('action')).toEqual([['filter', { key: 'classification', value: 'unexplained' }], ['filter', { key: 'classification', value: 'oracle' }]]);
    });
    it('keeps More filters open while a filter inside it is active', () => {
        for (const filters of [{ classification: 'explained', measurement: 'all', cause: 'all' }, { classification: 'all', measurement: 'failed', cause: 'all' }, { classification: 'all', measurement: 'all', cause: 'unknown' }]) {
            const wrapper = mount(ReportFilters, { props: { report: report(), count: 1, filters } });
            expect(wrapper.findAll('button').find(button => button.text() === 'More filters').attributes('aria-expanded')).toBe('true');
            expect(wrapper.get('#more-filters').attributes('style') ?? '').not.toContain('display: none');
        }
        const selected = mount(ReportFilters, { props: { report: report(), count: 1, filters: { classification: 'explained', measurement: 'all', cause: 'all' } } });
        expect(selected.findAll('[aria-pressed="true"]').map(button => button.text())).toEqual(['Explained']);
    });
});

describe('response artifact evidence', () => {
    it('renders response content as text and emits one load action', async () => {
        const wrapper = mount(ArtifactEvidence, { props: { row: { artifacts: { html: { state: 'complete', a: { src: 'a.txt' }, diff: { src: 'diff.json' } } } },
            source: 'http://localhost/report.json', evidence: { kind: 'html', data: { changed: true, removedLines: 1, addedLines: 0, lines: [{ kind: 'removed', line: 1, text: '<script>bad()</script>', truncated: false }], omittedLines: 0 } } } });
        expect(wrapper.find('script').exists()).toBe(false);
        expect(wrapper.text()).toContain('<script>bad()</script>');
        expect(wrapper.get('a').attributes('href')).toBe('http://localhost/a.txt');
        await wrapper.setProps({ evidence: null });
        await wrapper.get('button').trigger('click');
        expect(wrapper.emitted('action')[0]).toEqual(['load-artifact', 'html']);
    });
});

describe('legacy missing screenshot artifacts', () => {
    it('retains capture failure diagnostics without a screenshot extension', () => {
        const data = report();
        delete data.entries[0].viewports[0].artifacts;
        data.entries[0].viewports[0].error = 'Capture failed.';
        const wrapper = mount(TargetDetail, { props: { ...props(), report: data } });
        expect(wrapper.text()).toContain('Capture failed.');
    });
});

describe('HTML-only detail', () => {
    it('shows response controls without missing screenshot placeholders', () => {
        const data = report();
        data.entries[0].viewports[0].artifacts = { html: { state: 'complete', diff: { src: 'diff.json' } } };
        const detail = mount(TargetDetail, { props: { ...props(), report: data } });
        expect(detail.text()).toContain('Load html comparison');
        expect(detail.text()).not.toContain('Difference:');
        expect(detail.findAll('img')).toHaveLength(0);
        const matrix = mount(MatrixView, { props: { ...props(), report: data } });
        expect(matrix.text()).toContain('Screenshot not requested');
    });
});

describe('measurement state badges', () => {
    it('shows an incomplete state in amber and never in the unexplained red', () => {
        for (const state of ['failed', 'missing', 'incompatible']) {
            const badge = mount(Badge, { props: { text: state } });
            expect(badge.classes()).toContain('badge-incomplete');
            expect(badge.classes()).not.toContain('badge-unexplained');
        }
        expect(mount(Badge, { props: { text: 'complete' } }).classes()).toContain('text-ui-muted');
    });
});
describe('run times (DESIGN.md: local time in the text, ISO in a title)', () => {
	const at = '2026-10-22T08:00:00.000Z';
	it('shows a local time with the ISO time in its title in Run info and the run cards', () => {
		const data = report();
		data.runs = [{ id: 'run-a', side: 'local', at }, { id: 'run-b', side: 'local' }];
		data.pair = { aRunId: 'run-a', bRunId: 'run-b' };
		for (const wrapper of [mount(TimelineView, { props: { report: data } }), mount(RunSummary, { props: { report: data, summary: null } })]) {
			const time = wrapper.get('time');
			expect(time.attributes('title')).toBe(at);
			expect(time.attributes('datetime')).toBe(at);
			expect(time.text()).not.toContain('T08:00');
			expect(wrapper.text()).not.toContain(at);
		}
	});
});
describe('matrix cells without noise (#198)', () => {
	it('hides only an ok side, says once when no side was measured, and shows the state only when not complete', () => {
		const data = report();
		data.entries[0].viewports[0] = { id: 'phone', state: 'complete', ratio: 18.2, availability: { a: 'ok', b: 'ok' } };
		const quiet = mount(MatrixView, { props: { report: data, targets: data.entries } });
		expect(quiet.text()).not.toMatch(/[AB]: |Availability not measured/);
		expect(quiet.text()).not.toContain('complete');
		data.entries[0].viewports[0].availability = { a: 'unknown', b: 'unknown' };
		const unmeasured = mount(MatrixView, { props: { report: data, targets: data.entries } });
		expect(unmeasured.findAll('td').at(0).text()).toContain('Availability not measured');
		expect(unmeasured.text()).not.toMatch(/[AB]: unknown/);
		data.entries[0].viewports[0].availability = { a: 'unknown', b: 'ok' };
		expect(mount(MatrixView, { props: { report: data, targets: data.entries } }).text()).toContain('A: unknown');
		expect(quiet.text()).toContain('18.2%');
		data.entries[0].viewports[0].availability = { a: 'ok', b: 'http-error' };
		data.entries[0].viewports[0].state = 'failed';
		const loud = mount(MatrixView, { props: { report: data, targets: data.entries } });
		expect(loud.text()).toContain('B: http-error');
		expect(loud.text()).not.toContain('A: ok');
		expect(loud.text()).toContain('failed');
	});
});
