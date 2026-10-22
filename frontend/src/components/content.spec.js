import { it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ContentComparison from './ContentComparison.vue';
it('shows failed and incomplete checks as text with retained omissions', () => {
  const wrapper = mount(ContentComparison, { props: { data: { checkVersion: '1', incomplete: true, checks: [{ id: 'title', title: 'Title', a: { state: 'passed', findings: [], omitted: 0 }, b: { state: 'incomplete', omitted: 2, findings: [{ severity: 'error', message: '<img src=x onerror=alert(1)>', evidence: { text: '<script>bad</script>' } }] } }] } } });
  expect(wrapper.text()).toContain('do not prove a pass');
  expect(wrapper.text()).toContain('2 findings are omitted');
  expect(wrapper.text()).toContain('<img src=x');
  expect(wrapper.find('img').exists()).toBe(false);
  expect(wrapper.find('script').exists()).toBe(false);
});
