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

it('bounds the visual width of finite large measurements', () => {
 const data = detail(); data.b.metrics.lcp_ms.median = 1e300;
 const wrapper = mount(PerformanceComparison,{props:{data}});
 expect(wrapper.text()).toContain('1.00e+300');
});

 it('links the unchanged original Lighthouse HTML without remote report uploads', async () => {
  const { default: Reports } = await import('./LighthouseReports.vue');
  const source = 'http://localhost/report.json';
  const wrapper = mount(Reports, { props: { source, artifact: {
    a: { reports: [{ html: { src: 'runs/a/audit.html' }, json: { src: 'runs/a/audit.json' } }] },
    b: { reports: [{ html: { src: 'https://example.com/audit.html' } }] }
  } } });
  expect(wrapper.text()).toContain('original interactive Lighthouse interface');
  expect(wrapper.findAll('a')).toHaveLength(2);
  expect(wrapper.findAll('a')[0].attributes('href')).toBe('http://localhost/runs/a/audit.html');
  expect(wrapper.findAll('a')[0].attributes('download')).toBe('lighthouse-a-1.html');
 });

 it('exposes original reports in Speed even when the selected target has no speed evidence', async () => {
  const { default: Overview } = await import('./SpeedOverview.vue');
  const artifact = { state: 'complete', a: { reports: [{ html: { src: 'runs/a/audit.html' } }] } };
  const wrapper = mount(Overview, { props: { source: 'http://localhost/report.json', targetId: 'unmeasured', viewportId: 'wide', targets: [
    { id: 'unmeasured', viewports: [{ id: 'wide', artifacts: {} }] },
    { id: 'measured', viewports: [{ id: 'wide', artifacts: { lighthouse: artifact } }] }
  ] } });
  expect(wrapper.get('details').attributes('open')).toBeDefined();
  expect(wrapper.get('a[download]').attributes('href')).toBe('http://localhost/runs/a/audit.html');
 });
