<script setup>
import { computed } from 'vue';
import { ruleApplies } from '../../../src/rules/model.js';
const props = defineProps({ report: Object, targetId: String, row: Object });
const fired = computed(() => {
    const ids = props.row?.artifacts?.html?.diff?.firedRuleIds;
    return Array.isArray(ids) ? ids.filter(id => typeof id === 'string').slice(0, 50) : [];
});
const scoped = computed(() => Object.entries(props.report.rules ?? {}).filter(([, rule]) =>
    ruleApplies(rule, { pairKey: props.report.pair.key, kind: props.report.pair.kind, targetId: props.targetId, artifact: 'html' })));
</script>
<template>
    <section v-if="scoped.length" class="mt-4 rounded-ui-panel border border-ui-border p-3">
        <h3 class="font-semibold">Evidenced rules</h3>
        <article v-for="[id, rule] in scoped.filter(([id]) => fired.includes(id))" :key="id" class="mt-2 text-sm">
            <p>Fired: {{ id }} · {{ rule.text }}</p><p class="text-xs text-ui-muted">Evidence: {{ rule.evidence }}</p>
        </article>
        <p v-if="!fired.length" class="mt-2 text-sm">No rule fires on this evidence.</p>
        <details v-if="scoped.some(([id]) => !fired.includes(id))" class="mt-2 text-sm">
            <summary class="cursor-pointer">Other rules in scope</summary>
            <p v-for="[id, rule] in scoped.filter(([id]) => !fired.includes(id))" :key="id" class="mt-2">{{ id }} · {{ rule.text }} · {{ rule.evidence }}</p>
        </details>
    </section>
</template>
