<script setup>
import { localDateTime } from '../state/report-nav.js';
import { computed } from 'vue';
const props = defineProps({ report: Object, summary: Object, compact: Boolean });
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
    <!-- DESIGN.md "Layout" (#204): on the Evidence view the summary is one line of counts, and "Run details" opens the full summary. -->
    <section class="run-overview" :class="{ 'run-overview-compact': compact }" aria-label="Comparison summary">
        <p v-if="compact && summary" class="summary-line" aria-label="Target counts">
            <span v-for="name in ['match', 'explained', 'unexplained']" :key="name" class="summary-count" :data-status="name" :data-zero="summary.counts[name] === 0 || undefined"><strong>{{ summary.counts[name] }}</strong> {{ name }}</span>
            <span v-if="summary.counts.oracle" class="summary-count" data-status="oracle"><strong>{{ summary.counts.oracle }}</strong> oracle</span>
            <span v-if="summary.counts.unclassified" class="summary-count" data-status="unclassified"><strong>{{ summary.counts.unclassified }}</strong> unclassified</span>
            <span class="summary-count" data-status="incomplete" :data-zero="summary.counts.incomplete === 0 || undefined"><strong>{{ summary.counts.incomplete }}</strong> incomplete (state)</span>
            <span v-if="absent" class="summary-count" data-status="warning">{{ absent }} absent viewport measurements</span>
            <span v-if="availability" class="summary-count" data-status="warning">{{ availability }} availability problems</span>
        </p>
        <component :is="compact ? 'details' : 'div'" class="run-details">
        <summary v-if="compact">Run details</summary>
        <div class="run-pair" aria-label="Compared runs">
            <section v-for="item in sides" :key="item.side" class="run-card">
                <span class="run-letter">{{ item.side }}</span>
                <div class="min-w-0"><p class="eyebrow">{{ item.side === 'A' ? 'Baseline' : 'Compared run' }} · {{ item.run?.side ?? 'Side not recorded' }}</p><h2>{{ item.run?.label ?? item.id }}</h2><details class="run-id"><summary>Capture details</summary><p><time v-if="localDateTime(item.run?.at)" :datetime="item.run.at" :title="item.run.at">{{ localDateTime(item.run.at) }}</time><template v-else>Capture date not recorded</template></p><p>{{ item.id }}</p></details></div>
            </section>
        </div>
        <div v-if="summary" class="summary-metrics" aria-label="All target counts">
            <!-- DESIGN.md "Counts": the classes first, oracle only above zero, then a rule and incomplete as a state. -->
            <div v-for="name in ['match', 'explained', 'unexplained']" :key="name" class="summary-metric" :data-status="name" :data-zero="summary.counts[name] === 0 || undefined"><strong>{{ summary.counts[name] }}</strong><span>{{ name }}</span></div>
            <div v-if="summary.counts.oracle" class="summary-metric" data-status="oracle"><strong>{{ summary.counts.oracle }}</strong><span>oracle</span></div>
            <div v-if="summary.counts.unclassified" class="summary-metric" data-status="unclassified"><strong>{{ summary.counts.unclassified }}</strong><span>unclassified</span></div>
            <div class="summary-metric summary-state" data-status="incomplete" :data-zero="summary.counts.incomplete === 0 || undefined"><strong>{{ summary.counts.incomplete }}</strong><span>Incomplete (state)</span></div>
        </div>
        <p class="summary-caption">All {{ report.entries.length }} targets · {{ report.meta.viewports.length }} declared viewports. Counts remain visible under filters.</p>
        <p v-if="absent" class="summary-warning" role="status">Absent declared viewport measurements: {{ absent }}. Stored target counts do not include absent rows. Use the missing viewport measurement filter to find these targets.</p>
        <p v-if="availability" class="summary-warning" role="status">Availability problems: {{ availability }} viewport measurements across all targets. Availability is separate from screenshot class.</p>
        </component>
    </section>
</template>
