<script setup>
import { sameOriginUrl } from '../../../src/report/safe.js';
import PerformanceComparison from './PerformanceComparison.vue';
import BehaviorComparison from './BehaviorComparison.vue';
import ContentComparison from './ContentComparison.vue';
import HtmlDiff from './HtmlDiff.vue';
import StatusComparison from './StatusComparison.vue';
const props = defineProps({ row: Object, source: String, evidence: Object, kind: { type: String, default: 'html' }, evidenceView: { type: String, default: 'normalized' } });
const emit = defineEmits(['action']);
</script>
<template>
    <section class="min-w-0" :aria-label="kind === 'html' ? 'HTML response evidence' : kind === 'lighthouse' ? 'Lighthouse performance evidence' : kind === 'behavior' ? 'Behavior contract evidence' : kind === 'content' ? 'Stored content evidence' : 'HTTP status evidence'">
        <template v-if="row?.artifacts?.[kind]">
            <p v-if="row.artifacts[kind].state !== 'complete'" role="status" class="mb-4 rounded-ui-panel border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">{{ row.artifacts[kind].state ?? 'Missing' }} evidence. {{ row.artifacts[kind].diagnostic ?? 'This artifact cannot be compared.' }}</p>
            <div class="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-ui-muted">
                <template v-for="side in ['a', 'b', 'normalizedA', 'normalizedB']" :key="side">
                    <a v-if="sameOriginUrl(row.artifacts[kind][side]?.src, source)" :href="sameOriginUrl(row.artifacts[kind][side].src, source)" target="_blank" rel="noreferrer" class="underline">{{ side.startsWith('normalized') ? side.slice(-1) + ' normalized' : side.toUpperCase() + ' raw' }} {{ kind }}</a>
                </template>
            </div>
            <div v-if="kind === 'lighthouse'" class="mb-4 flex flex-wrap gap-3 text-xs text-ui-muted"><template v-for="side in ['a','b']" :key="side"><template v-for="(raw,index) in row.artifacts[kind][side]?.reports ?? []" :key="index"><a v-for="format in ['json','html']" :key="format" v-show="sameOriginUrl(raw[format]?.src, source)" :href="sameOriginUrl(raw[format]?.src, source)" target="_blank" rel="noreferrer" class="underline">{{ side.toUpperCase() }} audit {{ index+1 }} · {{ format === 'html' ? 'HTML source' : 'JSON' }}</a></template></template></div>
            <template v-if="evidence?.kind === kind">
                <p v-if="evidence.loading" role="status" class="rounded-ui-panel border border-ui-border p-6 text-sm text-ui-muted">Loading evidence…</p>
                <div v-else-if="evidence.error" role="status" class="rounded-ui-panel border border-ui-border p-4 text-sm"><p class="text-red-700 dark:text-red-300">{{ evidence.error }}</p><button v-if="row.artifacts[kind].diff?.src" class="mt-3 underline" @click="emit('action', 'load-artifact', kind)">Retry evidence</button></div>
                <HtmlDiff v-else-if="kind === 'html' && evidence.data" :data="evidence.data" :view="evidenceView" @action="(...args) => emit('action', ...args)" />
                <PerformanceComparison v-else-if="kind === 'lighthouse' && evidence.data" :data="evidence.data" />
                <BehaviorComparison v-else-if="kind === 'behavior' && evidence.data" :data="evidence.data" :source="source" />
                <ContentComparison v-else-if="kind === 'content' && evidence.data" :data="evidence.data" />
                <StatusComparison v-else-if="kind === 'status' && evidence.data" :data="evidence.data" />
                <p v-else class="text-sm text-ui-muted">No comparison detail is available.</p>
            </template>
            <button v-else-if="row.artifacts[kind].diff?.src" class="rounded-ui-pill border border-ui-control-border px-4 py-2 text-sm" @click="emit('action', 'load-artifact', kind)">Load {{ kind }} comparison</button>
            <p v-else class="rounded-ui-panel border border-ui-border p-5 text-sm text-ui-muted">No comparison detail is indexed. Original evidence remains available through the links above.</p>
            <details class="mt-5 border-t border-ui-border pt-3 text-xs text-ui-muted"><summary class="cursor-pointer">Technical details</summary><pre class="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all">{{ JSON.stringify({ index: row.artifacts[kind], comparison: evidence?.kind === kind ? evidence.data : undefined }, null, 2) }}</pre></details>
        </template>
        <p v-else role="status" class="rounded-ui-panel border border-ui-border p-5 text-sm text-ui-muted">No {{ kind }} evidence is indexed for this viewport. This measurement is unclassified.</p>
    </section>
</template>
