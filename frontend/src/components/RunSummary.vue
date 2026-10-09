<script setup>
import { computed } from 'vue';
const props = defineProps({ report: Object, summary: Object });
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
    <section class="run-overview" aria-label="Comparison summary">
        <div class="run-pair" aria-label="Compared runs">
            <section v-for="item in sides" :key="item.side" class="run-card">
                <span class="run-letter">{{ item.side }}</span>
                <div class="min-w-0"><p class="eyebrow">{{ item.side === 'A' ? 'Baseline' : 'Compared run' }} · {{ item.run?.side ?? 'Side not recorded' }}</p><h2>{{ item.run?.label ?? item.id }}</h2><details class="run-id"><summary>Capture details</summary><p>{{ item.run?.at ?? 'Capture date not recorded' }}</p><p>{{ item.id }}</p></details></div>
            </section>
        </div>
        <div v-if="summary" class="summary-metrics" aria-label="All target counts">
            <div v-for="name in ['unexplained', 'explained', 'match', 'incomplete']" :key="name" class="summary-metric" :data-status="name"><strong>{{ summary.counts[name] }}</strong><span>{{ name }}</span></div>
            <div v-if="summary.counts.oracle" class="summary-metric" data-status="oracle"><strong>{{ summary.counts.oracle }}</strong><span>oracle</span></div>
            <div v-if="summary.counts.unclassified" class="summary-metric"><strong>{{ summary.counts.unclassified }}</strong><span>unclassified</span></div>
        </div>
        <p class="summary-caption">All {{ report.entries.length }} targets · {{ report.meta.viewports.length }} declared viewports. Counts remain visible under filters.</p>
        <p v-if="absent" class="summary-warning" role="status">Absent declared viewport measurements: {{ absent }}. Stored target counts do not include absent rows. Use the missing viewport measurement filter to find these targets.</p>
        <p v-if="availability" class="summary-warning" role="status">Availability problems: {{ availability }} viewport measurements across all targets. Availability is separate from screenshot class.</p>
    </section>
</template>
