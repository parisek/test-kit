<script setup>
import { computed } from 'vue';
import { absoluteResults, checksFor } from '../state/checks-model.js';
import Badge from './Badge.vue';
// R8.6 and ADR 0004 section 7: the checks that fired come first. The other checks of the catalog are collapsed.
// A check whose artifact is not complete shows as missing, failed or incompatible, never as "no finding" (R8.7).
const props = defineProps({ report: Object, targetId: String, viewportId: { type: String, default: null }, kinds: { type: Array, default: () => [] } });
const target = computed(() => props.report?.entries?.find(item => item.id === props.targetId));
const model = computed(() => target.value ? checksFor(props.report, target.value, { viewportId: props.viewportId, kinds: props.kinds }) : { fired: [], other: [] });
const results = computed(() => target.value ? absoluteResults(target.value, { viewportId: props.viewportId }) : []);
const names = { a11y: 'Accessibility', lint: 'Lint' };
const total = computed(() => model.value.fired.length + model.value.other.length);
</script>
<template>
    <section v-if="total || results.length" class="check-audit mt-5 rounded-ui-panel border border-ui-border bg-ui-toolbar p-4" aria-label="Checks">
        <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-sm font-semibold">Checks</h3><span v-if="total" class="text-xs text-ui-muted">{{ model.fired.length }} fired · {{ total }} in the catalog</span></div>
        <ul v-if="results.length" class="mt-3 grid gap-1 text-sm" aria-label="Absolute results">
            <li v-for="result in results" :key="result.kind + result.scope" class="flex flex-wrap items-center gap-x-2 gap-y-1"><span class="font-medium">{{ names[result.kind] ?? result.kind }}</span><Badge :text="result.state" /><span v-if="result.checks !== null" class="text-xs text-ui-muted">{{ result.checks }} {{ result.checks === 1 ? 'check' : 'checks' }} executed · {{ result.violations ? 'violations found' : 'no violation found' }}</span><span v-if="result.diagnostic" class="min-w-0 break-words text-xs text-ui-muted">{{ result.diagnostic }}</span></li>
        </ul>
        <p v-if="total && !model.fired.length" class="mt-3 text-sm text-ui-muted">No check has a finding here. Read the state of each check before you read this as a pass.</p>
        <article v-for="item in model.fired" :key="item.id" class="mt-3 border-t border-ui-border pt-3 text-sm">
            <p class="break-words font-medium">{{ item.title }} <code class="text-xs text-ui-muted">{{ item.id }}</code></p>
            <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ui-muted"><span>{{ item.layer }} layer</span><span>· {{ item.count }} {{ item.count === 1 ? 'finding' : 'findings' }}</span><span>· {{ item.label }}</span><Badge v-if="item.state" :text="item.state" /></p>
        </article>
        <details v-if="model.other.length" class="mt-3 border-t border-ui-border pt-3 text-sm"><summary class="cursor-pointer text-ui-muted">Other checks in the catalog ({{ model.other.length }})</summary>
            <article v-for="item in model.other" :key="item.id" class="mt-3">
                <p class="break-words font-medium">{{ item.title }} <code class="text-xs text-ui-muted">{{ item.id }}</code></p>
                <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ui-muted"><span>{{ item.layer }} layer</span><span v-if="item.label">· {{ item.label }}</span><Badge v-if="item.state" :text="item.state" /></p>
                <p v-if="item.reason" class="mt-1 break-words text-xs text-ui-muted">Reason: {{ item.reason }} Owner: {{ item.owner }}.</p>
            </article>
        </details>
    </section>
</template>
