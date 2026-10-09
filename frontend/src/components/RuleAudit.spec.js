import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import RuleAudit from './RuleAudit.vue';
describe('evidenced rule audit', () => {
    it('treats malformed fired metadata as no fired rules', () => {
        const wrapper = mount(RuleAudit, { props: { report: { pair: { kind: 'migration' }, rules: { observed: { text: 'Observed text', evidence: 'Synthetic evidence', applies: {} } } }, targetId: 'home', row: { artifacts: { html: { diff: { firedRuleIds: {} } } } } } });
        expect(wrapper.text()).toContain('No rule fires');
        expect(wrapper.text()).toContain('Other rules in scope');
        expect(wrapper.text()).not.toContain('Fired:');
    });
});
