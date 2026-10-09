<script setup>
import { computed } from 'vue';
import { ruleApplies } from '../../../src/rules/model.js';
const props = defineProps({ report: Object, targetId: String, row: Object, evidence: Object });
const fired = computed(() => {
    const ids = props.row?.artifacts?.html?.diff?.firedRuleIds;
    return Array.isArray(ids) ? ids.filter(id => typeof id === 'string').slice(0, 50) : [];
});
const scoped = computed(() => Object.entries(props.report.rules ?? {}).filter(([, rule]) => ruleApplies(rule, { pairKey: props.report.pair?.key, kind: props.report.pair?.kind, targetId: props.targetId, artifact: 'html' })));
const applied = computed(() => scoped.value.filter(([id]) => fired.value.includes(id)));
const other = computed(() => scoped.value.filter(([id]) => !fired.value.includes(id)));
const explanation = rule => typeof rule === 'string' ? rule : rule?.text;
const evidenceText = rule => typeof rule?.evidence === 'string' ? rule.evidence : rule?.evidence ? 'Bound to the stored raw responses and comparison policy.' : 'No evidence is recorded.';
</script>
<template>
    <section v-if="scoped.length" class="mt-5 rounded-ui-panel border border-ui-border bg-ui-toolbar p-4">
        <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-sm font-semibold">Evidenced rules</h3><span class="text-xs text-ui-muted">{{ applied.length }} fired · {{ scoped.length }} in scope</span></div>
        <article v-for="[id, rule] in applied" :key="id" class="mt-3 border-t border-ui-border pt-3 text-sm"><p class="font-medium">Fired: {{ id }}</p><p class="mt-1 break-words">{{ explanation(rule) }}</p><p class="mt-2 break-words text-xs text-ui-muted">Evidence: {{ evidenceText(rule) }}</p><p v-if="evidence?.normalization?.fired?.find(item => item.id === id)" class="mt-1 text-xs text-ui-muted">{{ evidence.normalization.fired.find(item => item.id === id).occurrences }} occurrences</p></article>
        <p v-if="!fired.length" class="mt-3 text-sm text-ui-muted">No rule fires on this evidence.</p>
        <details v-if="other.length" class="mt-3 border-t border-ui-border pt-3 text-sm"><summary class="cursor-pointer text-ui-muted">Other rules in scope ({{ other.length }})</summary><article v-for="[id, rule] in other" :key="id" class="mt-3"><p class="font-medium">{{ id }} · {{ explanation(rule) }}</p><p class="mt-1 break-words text-xs text-ui-muted">{{ evidenceText(rule) }}</p></article></details>
    </section>
</template>
