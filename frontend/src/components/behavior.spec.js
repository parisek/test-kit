import { it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import BehaviorComparison from './BehaviorComparison.vue';
it('keeps failed steps and safe local evidence visible as text', () => {
  const wrapper = mount(BehaviorComparison, { props: { source: 'http://localhost/report.json', data: { state: 'failed', traceB: 'runs/example/behavior/trace.zip', steps: [{ id: 'click', title: '<script>step</script>', state: 'failed', resultA: null, resultB: { state: 'failed', error: '<img src=x>', evidence: { screenshot: 'https://remote.example/shot.png', console: [{ text: '<script>bad</script>' }] } } }] } } });
  expect(wrapper.text()).toContain('Step evidence is missing');
  expect(wrapper.text()).toContain('<img src=x>');
  expect(wrapper.text()).toContain('npx playwright show-trace runs/example/behavior/trace.zip');
  expect(wrapper.find('img').exists()).toBe(false);
  expect(wrapper.find('script').exists()).toBe(false);
});
