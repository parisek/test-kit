<script setup>
import { sameOriginUrl } from '../../../src/report/safe.js';
defineProps({ row: Object, source: String, evidence: Object });
const emit = defineEmits(['action']);
</script>
<template>
    <section v-for="kind in ['html', 'status'].filter(kind => row?.artifacts?.[kind])" :key="kind" class="mt-4 rounded-ui-panel border border-ui-border p-3">
        <h3 class="font-semibold">{{ kind === 'html' ? 'HTML response' : 'HTTP status' }} · {{ row.artifacts[kind].state }}</h3>
        <p v-if="row.artifacts[kind].diagnostic" class="mt-2 text-sm">{{ row.artifacts[kind].diagnostic }}</p>
        <p v-if="kind === 'status'" class="mt-2 text-xs text-ui-muted">HTTP metadata does not affect screenshot or HTML class.</p>
        <div class="my-2 flex flex-wrap gap-3 text-sm">
            <template v-for="side in ['a', 'b']" :key="side">
                <a v-if="row.artifacts[kind][side]?.src && sameOriginUrl(row.artifacts[kind][side].src, source)" :href="sameOriginUrl(row.artifacts[kind][side].src, source)" target="_blank" rel="noreferrer" class="underline">{{ side.toUpperCase() }} raw {{ kind }}</a>
            </template>
            <button v-if="row.artifacts[kind].diff?.src" class="underline focus-visible:outline-ui-focus" @click="emit('action', 'load-artifact', kind)">Load {{ kind }} comparison</button>
        </div>
        <p v-if="kind === 'html'" class="text-xs text-ui-muted">Server response bytes. No DOM capture or normalization. The replacement window is bounded.</p>
        <details class="mt-2 text-xs"><summary class="cursor-pointer">Response artifact provenance</summary><pre class="mt-2 whitespace-pre-wrap break-all">{{ JSON.stringify(row.artifacts[kind], null, 2) }}</pre></details>
        <template v-if="evidence?.kind === kind">
            <p v-if="evidence.loading" role="status">Loading evidence…</p>
            <p v-else-if="evidence.error" role="status">{{ evidence.error }}</p>
            <pre v-else class="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{{ JSON.stringify(evidence.data, null, 2) }}</pre>
        </template>
    </section>
</template>
