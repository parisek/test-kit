import { it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PerformanceComparison from './PerformanceComparison.vue';
import { performanceSettings, performanceProvenance, summarizeSamples, comparePerformance } from '../../../src/perf/model.js';
const settings = performanceSettings();
function captured(values) { return { state: 'captured', settings, suspect: false, ...performanceProvenance(settings, '13.5.0', 'fixture-browser'), metrics: summarizeSamples(values.map(value => ({ lcp_ms:value, fcp_ms:value, tbt_ms:value, cls:value/1000, speed_index_ms:value })), 3) }; }
const a = captured([100,110,120]), b = captured([200,210,220]);
function detail(environmentB = 'local') { return { ...comparePerformance(a,b,{environmentA:'local',environmentB}), a, b }; }
it('shows measured samples, noise and significant changes', () => {
 const wrapper = mount(PerformanceComparison,{props:{data:detail()}});
 expect(wrapper.text()).toContain('3 measured runs');
 expect(wrapper.text()).toContain('regression');
 expect(wrapper.text()).toContain('100, 110, 120');
 expect(wrapper.text()).toContain('noise 20');
});
it('keeps incompatible measurements visible without regression labels', () => {
 const data = detail('other'); data.reason = '<script>Different environment</script>';
 const wrapper = mount(PerformanceComparison,{props:{data}});
 expect(wrapper.text()).toContain('Comparison unavailable');
 expect(wrapper.text()).toContain('210');
 expect(wrapper.findAll('span.rounded-ui-pill')).toHaveLength(0);
 expect(wrapper.find('script').exists()).toBe(false);
});
