<script setup>
import { computed } from 'vue';
const props = defineProps({ report: Object });
const sides = computed(() => ['a', 'b'].map((side) => ({
    side: side.toUpperCase(),
    id: props.report.pair[side === 'a' ? 'aRunId' : 'bRunId'],
    run: props.report.runs.find((run) => run.id === props.report.pair[side === 'a' ? 'aRunId' : 'bRunId']),
})));
const absent = computed(() => props.report.entries.reduce((count, target) =>
    count + props.report.meta.viewports.filter((viewport) =>
        !target.viewports.some((row) => row.id === viewport.id)).length, 0));
const availability = computed(() => props.report.entries.reduce((count, target) =>
    count + target.viewports.filter((row) => ['a', 'b'].some((side) =>
        row.availability?.[side] && ['http-error', 'capture-error'].includes(row.availability[side]))).length, 0));
</script>
<template>
    <div class="mt-3 grid min-w-0 gap-2 sm:grid-cols-2" aria-label="Compared runs">
        <section v-for="item in sides" :key="item.side" class="min-w-0 rounded-ui-panel border border-ui-border bg-ui-toolbar p-3">
            <h2 class="text-sm font-semibold break-words">{{ item.side }} · {{ item.run?.label ?? item.id }}</h2>
            <p class="mt-1 break-words text-xs text-ui-muted">{{ item.run?.side ?? 'Side not recorded' }} · {{ item.id }}</p>
            <p class="mt-1 break-words text-xs text-ui-muted">{{ item.run?.at ?? 'Capture date not recorded' }}</p>
        </section>
    </div>
    <p v-if="absent" class="mt-2 text-xs" role="status">Absent declared viewport measurements: {{ absent }}. Stored target counts do not include absent rows. Use the missing viewport measurement filter to find these targets.</p>
    <p v-if="availability" class="mt-2 text-xs" role="status">Availability problems: {{ availability }} viewport measurements across all targets. Availability is separate from screenshot class.</p>
</template>
