import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PlannedEvidence from './PlannedEvidence.vue';

const speed = { compatible: true, metrics: [{ title: 'LCP', unit: 'ms', a: [1800, 2000, 2200], b: [2700, 2800, 3000], budget: 2500 }] };

describe('planned evidence design', () => {
    it('shows simulated medians, a delta and a budget breach for compatible samples', () => {
        const wrapper = mount(PlannedEvidence, { props: { kind: 'lighthouse', sample: speed } });
        expect(wrapper.text()).toContain('All results and numbers below are simulated');
        expect(wrapper.text()).toContain('Not implemented');
        expect(wrapper.text()).toContain('+800 ms');
        expect(wrapper.text()).toContain('Simulated budget breach');
        expect(wrapper.text()).toContain('Spread 400 ms');
        expect(wrapper.findAll('[aria-label="Simulated median comparison"]').length).toBe(1);
    });
    it('does not draw a delta or budget verdict for incompatible samples', () => {
        const wrapper = mount(PlannedEvidence, { props: { kind: 'lighthouse', sample: { ...speed, compatible: false, suspect: true, reason: 'Different environments' } } });
        expect(wrapper.text()).toContain('Simulated incompatible pair');
        expect(wrapper.text()).toContain('Different environments');
        expect(wrapper.text()).toContain('Suspect measurement');
        expect(wrapper.find('[aria-label="Simulated speed comparison"]').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('Simulated budget breach');
    });
    it('renders untrusted check text literally and keeps missing collections usable', () => {
        const wrapper = mount(PlannedEvidence, { props: { kind: 'content', sample: { checks: [null, { title: '<script>alert(1)</script>', state: 'failed', selector: '<img onerror="alert(1)">', a: {}, b: 'Missing alt', severity: 'warning' }] } } });
        expect(wrapper.text()).toContain('<script>alert(1)</script>');
        expect(wrapper.find('script').exists()).toBe(false);
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.text()).toContain('Unavailable');
        const empty = mount(PlannedEvidence, { props: { kind: 'behavior', sample: { steps: {} } } });
        expect(empty.text()).toContain('No simulated steps');
        expect(empty.text()).toContain('No recording file exists');
    });
    it('refuses insufficient numeric samples and bounds plot widths', () => {
        const wrapper = mount(PlannedEvidence, { props: { kind: 'lighthouse', sample: { compatible: true, metrics: [{ title: 'Malformed', a: [NaN, Infinity, -1], b: null, budget: NaN }, speed.metrics[0]] } } });
        expect(wrapper.text()).toContain('At least 3 finite samples are required');
        expect(wrapper.text()).toContain('Simulated budget unavailable');
        for (const bar of wrapper.findAll('[style]')) {
            const width = Number.parseFloat(bar.element.style.width);
            expect(width).toBeGreaterThanOrEqual(0);
            expect(width).toBeLessThanOrEqual(100);
        }
    });
});
