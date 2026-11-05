import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import RunSummary from './RunSummary.vue';
import { droppedRenderRequests } from '../state/dropped.js';

const report = dropped => ({
    pair: { aRunId: 'run-a', bRunId: 'run-b' },
    runs: [{ id: 'run-a', side: 'production' }, { id: 'run-b', side: 'local' }],
    meta: { viewports: [{ id: 'desktop' }] },
    entries: [{ id: 'home', viewports: [{ id: 'desktop', availability: { a: 'ok', b: 'ok' }, ...(dropped ? { dropped } : {}) }] }],
});
const summary = { counts: { unexplained: 0, explained: 0, match: 1, incomplete: 0, oracle: 0, unclassified: 0 } };

describe('aborted font and stylesheet requests (R3.8)', () => {
    it('warns with the side, type and origin as text, and not for other types', () => {
        const data = report({ a: [{ resourceType: 'font', origin: 'https://use.example-site.net', count: 3 }, { resourceType: 'image', origin: 'https://img.example-site.net', count: 9 }], b: [] });
        const wrapper = mount(RunSummary, { props: { report: data, summary, compact: true } });
        expect(wrapper.get('[aria-label="Target counts"]').text()).toContain('3 aborted font or stylesheet requests');
        const warning = wrapper.get('.summary-warning');
        expect(warning.text()).toContain('side A: font from https://use.example-site.net');
        expect(warning.text()).not.toContain('img.example-site.net');
        expect(warning.attributes('role')).toBe('status');
    });
    it('shows the number of requests, not of groups, and says when a list was cut', () => {
        const data = report({ a: [{ resourceType: 'font', origin: 'https://use.example-site.net', count: 3 }], b: [], omitted: { a: 4, b: 0 } });
        expect(droppedRenderRequests(data)).toMatchObject({ count: 3, notListed: 4 });
        const wrapper = mount(RunSummary, { props: { report: data, summary, compact: true } });
        expect(wrapper.get('[aria-label="Target counts"]').text()).toContain('3 aborted font or stylesheet requests (and 4 more not listed)');
        expect(wrapper.get('.summary-warning').text()).toContain('4 more requests were cut from the stored list');
    });
    it('shows a cut list even when no font or stylesheet is listed', () => {
        const wrapper = mount(RunSummary, { props: { report: report({ a: [], b: [], omitted: { a: 2, b: 0 } }), summary } });
        expect(wrapper.get('.summary-warning').text()).toContain('2 more requests were cut');
    });
    it('shows nothing without a record', () => {
        const wrapper = mount(RunSummary, { props: { report: report(), summary } });
        expect(wrapper.text()).not.toContain('Aborted requests');
    });
    it('ignores a malformed record and renders markup as text', () => {
        expect(droppedRenderRequests(report({ a: [{ resourceType: 'font', origin: 'javascript:alert(1)', count: 1 }, { resourceType: 'font', origin: 'https://x.example-site.net', count: -1 }, null], b: 'x' })).count).toBe(0);
        expect(droppedRenderRequests(report('x')).count).toBe(0);
        expect(droppedRenderRequests(report({ a: [{ resourceType: 'font', origin: 'https://<img src=x>.example-site.net', count: 1 }] })).count).toBe(0);
    });
});
