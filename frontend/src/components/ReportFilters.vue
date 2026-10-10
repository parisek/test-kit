<script setup>
defineProps({ report: Object, filters: Object, count: Number });
const emit = defineEmits(['action']);
const selectClass = 'max-w-full rounded-ui-panel border border-ui-control-border bg-ui-surface p-2 text-ui-text focus-visible:outline-ui-focus';
</script>
<template>
    <section class="filter-panel rounded-ui-panel border border-ui-border bg-ui-surface p-3" aria-label="Report filters">
        <div class="flex flex-wrap items-end gap-3 text-xs">
            <label class="flex min-w-0 flex-col gap-1">Class
                <span class="filter-select">
                    <select aria-label="Class filter" :class="selectClass" :value="filters.classification" @change="emit('action', 'filter', { key: 'classification', value: $event.target.value })">
                        <option value="all">All classes</option>
                        <option v-for="name in ['match', 'explained', 'unexplained', 'oracle', 'unclassified']" :key="name" :value="name">{{ name }}</option>
                    </select>
                </span>
            </label>
            <label class="flex min-w-0 flex-col gap-1">Measurement
                <span class="filter-select">
                    <select aria-label="Measurement filter" :class="selectClass" :value="filters.measurement" @change="emit('action', 'filter', { key: 'measurement', value: $event.target.value })">
                        <option value="all">All measurements</option>
                        <option v-for="name in ['complete', 'missing', 'failed', 'incompatible']" :key="name" :value="name">{{ name }}</option>
                    </select>
                </span>
            </label>
            <label class="flex min-w-0 flex-col gap-1">Cause
                <span class="filter-select">
                    <select aria-label="Cause filter" :class="selectClass" :value="filters.cause" @change="emit('action', 'filter', { key: 'cause', value: $event.target.value })">
                        <option value="all">All causes</option>
                        <option value="unknown">No recorded cause</option>
                        <option v-for="cause in report.causes" :key="cause.id" :value="'cause:' + cause.id">{{ cause.title ?? cause.id }} · {{ cause.known === true ? 'known' : 'unexplained' }}</option>
                    </select>
                </span>
            </label>
            <button class="rounded-ui-pill border border-ui-control-border px-3 py-2 focus-visible:outline-ui-focus" @click="emit('action', 'clear-filters')">Clear filters</button>
        </div>
        <div class="filter-caption"><span>{{ count }} of {{ report.entries.length }} targets</span><details><summary>How filters work</summary><p class="filter-help mt-2 text-xs text-ui-muted">{{ count }} of {{ report.entries.length }} targets in lists. Measurement filters match any viewport row. Filters affect targets, matrix, and findings. Detail and timeline retain their evidence. Global counts stay above.</p></details></div>
    </section>
</template>
