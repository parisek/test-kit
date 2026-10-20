<script setup>
import { ref } from 'vue';
import { anchorFor } from '../state/index-list.js';
defineProps({ index: Object });
const emit = defineEmits(['open']);
const heading = ref(null);
defineExpose({ focus: () => heading.value?.focus() });
const text = (value) => value ?? 'unknown';
</script>
<template>
    <section class="index-view" aria-label="Reports in this directory">
        <h1 ref="heading" tabindex="-1">Reports</h1>
        <p v-if="index.skipped" class="summary-warning" role="status">Not listed because of an invalid id: {{ index.skipped }}.</p>
        <p v-if="!index.reports.length" class="empty-report">The index lists no reports.</p>
        <ul v-else class="index-list">
            <li v-for="row in index.reports" :key="row.id" class="index-row">
                <a v-if="row.available" class="index-open" :href="anchorFor(row.id)" @click.prevent="emit('open', row.id)">{{ row.id }}</a>
                <span v-else class="index-open" aria-disabled="true">{{ row.id }}</span>
                <span class="index-meta">{{ text(row.kind) }} · {{ text(row.createdAt) }} · {{ row.targets == null ? 'targets unknown' : row.targets + (row.targets === 1 ? ' target' : ' targets') }} · {{ text(row.settingsHash) }}</span>
                <span v-if="!row.available" class="index-unavailable">unavailable</span>
            </li>
        </ul>
        <h2>Runs</h2>
        <p v-if="!index.runs.length" class="index-meta">The index lists no runs.</p>
        <ul v-else class="index-list">
            <li v-for="row in index.runs" :key="row.id" class="index-row">
                <span class="index-open">{{ row.id }}</span>
                <span class="index-meta">{{ text(row.createdAt) }} · {{ text(row.settingsHash) }}</span>
                <span v-if="!row.available" class="index-unavailable">unavailable</span>
            </li>
        </ul>
    </section>
</template>
