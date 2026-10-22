<script setup>
// The Home: the history of comparisons in a publish directory (R10.3, R10.13,
// DESIGN.md "Latest comparison card", "Verdict history strip", "Comparison row").
// Index data is untrusted: every value goes in as text (R10.6).
import { computed, ref } from 'vue';
import { anchorFor } from '../state/index-list.js';
import { groupByDay, historyStrip, homeRows, latestRow, verdictSentence } from '../state/home-model.js';

const props = defineProps({ index: Object });
const emit = defineEmits(['open']);
const heading = ref(null);
defineExpose({ focus: () => heading.value?.focus() });

const rows = computed(() => homeRows(props.index.reports));
const latest = computed(() => latestRow(rows.value));
const strip = computed(() => historyStrip(rows.value));
const days = computed(() => groupByDay(rows.value));

// Class words of DESIGN.md. Unclassified has no class: evidence is missing.
const WORDS = { unexplained: 'unexplained', explained: 'explained', oracle: 'oracle', match: 'match', unclassified: 'not measured' };
const word = (row) => (row.verdict ? WORDS[row.verdict] : row.summary ? 'no pages' : 'not measured');
const dot = (row) => row.verdict ?? 'unknown';

function time(iso) {
	if (typeof iso !== 'string') return 'time unknown';
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? 'time unknown' : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
// The strip spans several days, so each dot shows a short date and the time.
function shortDateTime(iso) {
	if (typeof iso !== 'string') return 'time unknown';
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? 'time unknown' : date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function dateTime(iso) {
	if (typeof iso !== 'string') return 'time unknown';
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? 'time unknown' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
function dayTitle(day) {
	if (day === null) return 'Time unknown';
	const date = new Date(`${day}T12:00:00`);
	return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function detail(row) {
	const parts = [row.targets === null ? 'pages unknown' : plural(row.targets, 'page', 'pages')];
	if (row.viewports !== null) parts.push(plural(row.viewports, 'viewport', 'viewports'));
	return parts.join(', ');
}
// The classes first, oracle only above zero, then incomplete as a state (DESIGN.md "Counts").
function counts(summary) {
	if (!summary) return [];
	const list = ['match', 'explained', 'unexplained'].map((name) => ({ name, label: name, value: summary[name] }));
	if (summary.oracle > 0) list.push({ name: 'oracle', label: 'oracle', value: summary.oracle });
	if (summary.unclassified > 0) list.push({ name: 'unclassified', label: 'not measured', value: summary.unclassified });
	return list;
}
const open = (row) => emit('open', row.id);
</script>
<template>
    <section class="home-view" aria-labelledby="home-title">
        <h1 id="home-title" ref="heading" tabindex="-1">Comparisons</h1>
        <p v-if="index.skipped" class="home-notice" role="status">Not listed because of an invalid id: {{ index.skipped }}.</p>
        <p v-if="!rows.length" class="empty-report">The index lists no comparisons.</p>

        <template v-else>
            <section class="latest-card" aria-labelledby="latest-title">
                <h2 id="latest-title" class="small-heading">Latest comparison</h2>
                <p class="latest-verdict">
                    <span class="verdict-dot" :data-verdict="dot(latest)" aria-hidden="true"></span>
                    <span>{{ verdictSentence(latest.summary) }}</span>
                </p>
                <p class="latest-time"><time :datetime="latest.createdAt ?? undefined" :title="latest.createdAt ?? undefined">{{ dateTime(latest.createdAt) }}</time></p>
                <div v-if="latest.summary" class="verdict-counts">
                    <p v-for="item in counts(latest.summary)" :key="item.name" class="verdict-count" :data-verdict="item.value > 0 ? item.name : 'zero'">
                        <strong>{{ item.value }}</strong><span>{{ item.label }}</span>
                    </p>
                    <p class="verdict-count verdict-state" :data-verdict="latest.summary.incomplete > 0 ? 'incomplete' : 'zero'">
                        <strong>{{ latest.summary.incomplete }}</strong><span>incomplete (state)</span>
                    </p>
                </div>
                <p v-else class="home-meta">No counts: this comparison has no summary.</p>
                <a v-if="latest.available" class="button-primary" :href="anchorFor(latest.id)" @click.prevent="open(latest)">Open comparison</a>
                <p v-else class="home-meta">Unavailable: the publish directory holds no report file for it.</p>
            </section>

            <section class="history-strip" aria-labelledby="strip-title">
                <h2 id="strip-title" class="small-heading">Verdict history, oldest first</h2>
                <ol class="strip-dots">
                    <li v-for="row in strip.dots" :key="row.id" :title="row.createdAt ?? undefined">
                        <span class="verdict-dot" :data-verdict="dot(row)" aria-hidden="true"></span>
                        <span class="record">{{ shortDateTime(row.createdAt) }}</span>
                        <span>{{ word(row) }}</span>
                        <span v-if="!row.available" class="row-unavailable">unavailable</span>
                    </li>
                </ol>
                <p v-if="strip.omitted" class="home-meta">{{ plural(strip.omitted, 'older comparison is', 'older comparisons are') }} not shown.</p>
            </section>

            <section v-for="group in days" :key="group.day ?? 'unknown'" class="home-day" :aria-labelledby="'day-' + (group.day ?? 'unknown')">
                <h2 :id="'day-' + (group.day ?? 'unknown')" class="small-heading">{{ dayTitle(group.day) }}</h2>
                <ul class="comparison-list">
                    <li v-for="row in group.rows" :key="row.id">
                        <component :is="row.available ? 'a' : 'div'" class="comparison-row" :href="row.available ? anchorFor(row.id) : undefined" :aria-disabled="row.available ? undefined : 'true'" @click="row.available && ($event.preventDefault(), open(row))">
                            <span class="verdict-dot" :data-verdict="dot(row)" aria-hidden="true"></span>
                            <time class="record" :datetime="row.createdAt ?? undefined" :title="row.createdAt ?? undefined">{{ time(row.createdAt) }}</time>
                            <span class="row-word" :data-verdict="dot(row)">{{ word(row) }}</span>
                            <span v-if="row.incomplete" class="row-state">{{ row.incomplete }} incomplete</span>
                            <span class="home-meta">{{ detail(row) }}</span>
                            <span v-if="row.change" class="home-meta">{{ row.change }}</span>
                            <span class="record row-id" :title="row.id">{{ row.kind ? `${row.kind} ${row.id}` : row.id }}</span>
                            <span v-if="!row.available" class="row-unavailable">unavailable</span>
                            <span v-if="row.hashChanged" class="record row-hash">settings changed: {{ row.settingsHash }}</span>
                        </component>
                    </li>
                </ul>
            </section>
        </template>

        <details v-if="index.runs.length" class="home-runs">
            <summary>Stored runs ({{ index.runs.length }})</summary>
            <ul class="comparison-list">
                <li v-for="run in index.runs" :key="run.id" class="run-row">
                    <span class="record">{{ run.id }}</span>
                    <time class="home-meta" :datetime="run.createdAt ?? undefined" :title="run.createdAt ?? undefined">{{ dateTime(run.createdAt) }}</time>
                    <span v-if="run.settingsHash" class="record">{{ run.settingsHash }}</span>
                    <span v-if="!run.available" class="row-unavailable">unavailable</span>
                </li>
            </ul>
        </details>
    </section>
</template>
