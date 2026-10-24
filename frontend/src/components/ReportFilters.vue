<script setup>
import { computed, ref } from 'vue';
const props = defineProps({ report: Object, filters: Object, count: Number });
const emit = defineEmits(['action']);
const selectClass = 'max-w-full rounded-ui-panel border border-ui-control-border bg-ui-surface p-2 text-ui-text focus-visible:outline-ui-focus';
// DESIGN.md "Filter group" (#203): one class filter in two rows. Each class shows once.
const primary = [['all', 'All'], ['unexplained', 'Unexplained'], ['match', 'Match']];
const secondary = [['explained', 'Explained'], ['oracle', 'Oracle'], ['unclassified', 'Unclassified']];
const opened = ref(false);
// An active filter never hides behind a closed "More filters".
const hiddenActive = computed(() => props.filters.measurement !== 'all' || props.filters.cause !== 'all' || secondary.some(([value]) => value === props.filters.classification));
const expanded = computed(() => opened.value || hiddenActive.value);
const choose = (value) => emit('action', 'filter', { key: 'classification', value });
function clear() {
    opened.value = false;
    emit('action', 'clear-filters');
}
</script>
<template>
    <section class="filter-panel rounded-ui-panel border border-ui-border bg-ui-surface p-3" aria-label="Report filters">
        <div role="group" aria-labelledby="filter-group-label" class="flex flex-wrap items-center gap-3 text-xs">
            <p id="filter-group-label" class="eyebrow w-full">Filter</p>
            <div class="filter-segment inline-flex max-w-full flex-wrap rounded-ui-pill border border-ui-control-border p-1" role="group" aria-label="Class filter">
                <button v-for="[value, title] in primary" :key="value" type="button" :aria-pressed="filters.classification === value" :class="filters.classification === value ? 'bg-ui-active-surface text-ui-active-text' : 'text-ui-muted'" class="rounded-ui-pill px-3 py-1.5" @click="choose(value)">{{ title }}</button>
            </div>
            <button type="button" class="more-filters text-ui-text underline" aria-controls="more-filters" :aria-expanded="expanded" @click="opened = !opened">More filters</button>
            <button type="button" class="rounded-ui-pill border border-ui-control-border px-3 py-2 focus-visible:outline-ui-focus" @click="clear">Clear filters</button>
        </div>
        <div v-show="expanded" id="more-filters" class="more-filters-panel mt-3 flex flex-wrap items-end gap-3 text-xs">
            <div class="flex min-w-0 flex-col gap-1"><span id="more-class-label">Other classes</span>
                <div class="filter-segment inline-flex max-w-full flex-wrap rounded-ui-pill border border-ui-control-border p-1" role="group" aria-labelledby="more-class-label">
                    <button v-for="[value, title] in secondary" :key="value" type="button" :aria-pressed="filters.classification === value" :class="filters.classification === value ? 'bg-ui-active-surface text-ui-active-text' : 'text-ui-muted'" class="rounded-ui-pill px-3 py-1.5" @click="choose(value)">{{ title }}</button>
                </div>
            </div>
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
        </div>
        <div class="filter-caption"><span>{{ count }} of {{ report.entries.length }} targets</span><details><summary>How filters work</summary><p class="filter-help mt-2 text-xs text-ui-muted">{{ count }} of {{ report.entries.length }} targets in lists. Measurement filters match any viewport row. Filters affect targets, matrix, and findings. Detail and timeline retain their evidence. Global counts stay above.</p></details></div>
    </section>
</template>
