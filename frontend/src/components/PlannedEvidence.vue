<script setup>
import { computed } from 'vue';

const props = defineProps({ kind: String, sample: Object, report: Object, source: String });
const list = (value) => Array.isArray(value) ? value.slice(0, 50).filter((item) => item && typeof item === 'object') : [];
const text = (value, fallback = 'Unavailable') => typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 2000) : fallback;
const messages = (value) => Array.isArray(value) ? value.slice(0, 12).map((item) => text(item)) : [];
const steps = computed(() => list(props.sample?.steps));
const checks = computed(() => list(props.sample?.checks));
const metrics = computed(() => list(props.sample?.metrics));
const status = (value) => ['same', 'changed', 'failed', 'skipped', 'passed'].includes(value) ? value : 'unavailable';
const tone = (value) => ['failed', 'changed'].includes(value) ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200' : ['passed', 'same'].includes(value) ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200' : 'border-ui-border bg-ui-toolbar text-ui-muted';
const count = (items, state) => items.filter((item) => status(item.state) === state).length;
function stats(values) {
    const finite = Array.isArray(values) ? values.slice(0, 5).filter((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0).sort((a, b) => a - b) : [];
    if (finite.length < 3) return null;
    const middle = Math.floor(finite.length / 2);
    return { median: finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2, spread: finite.at(-1) - finite[0], values: finite };
}
const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : 'Unavailable';
const unit = (value) => ['ms', 's', 'score', '%', 'bytes'].includes(value) ? value : '';
const comparable = computed(() => props.sample?.compatible === true);
const delta = (metric) => {
    const a = stats(metric.a), b = stats(metric.b);
    return a && b ? b.median - a.median : null;
};
const budgetState = (metric) => {
    const result = stats(metric.b);
    if (!result || typeof metric.budget !== 'number' || !Number.isFinite(metric.budget) || metric.budget < 0) return 'unavailable';
    const breach = metric.direction === 'higher' ? result.median < metric.budget : result.median > metric.budget;
    return breach ? 'failed' : 'passed';
};
const barWidth = (metric, side) => {
    const a = stats(metric.a), b = stats(metric.b);
    if (!a || !b) return '0%';
    const max = Math.max(a.median, b.median, 1);
    return `${Math.max(0, Math.min(100, stats(metric[side]).median / max * 100))}%`;
};
const title = computed(() => ({ behavior: 'Behavior contracts', content: 'Content checks', lighthouse: 'Performance lab' })[props.kind] ?? 'Planned evidence');
</script>

<template>
    <section :aria-label="`${title} prototype`" class="min-w-0 space-y-4">
        <div class="flex flex-wrap items-start justify-between gap-3 rounded-ui-panel border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <div class="min-w-0"><p class="text-xs font-semibold uppercase tracking-wide">Design preview · Not implemented</p><h3 class="mt-1 text-lg font-semibold">{{ title }}</h3><p class="mt-2 max-w-2xl text-xs leading-relaxed">All results and numbers below are simulated. No runner or check produced this evidence. This preview does not affect target classes or report counts.</p></div>
            <span class="rounded-ui-pill border border-amber-300 px-3 py-1 text-xs dark:border-amber-800">Synthetic sample</span>
        </div>

        <template v-if="kind === 'behavior'">
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Simulated behavior summary"><div v-for="state in ['same', 'changed', 'failed', 'skipped']" :key="state" class="rounded-ui-panel border border-ui-border bg-ui-surface p-3"><p class="text-2xl font-semibold tabular-nums">{{ count(steps, state) }}</p><p class="mt-1 text-xs capitalize text-ui-muted">{{ state }} steps · simulated</p></div></div>
            <ol class="space-y-3">
                <li v-for="(step, index) in steps" :key="index" class="min-w-0 rounded-ui-panel border border-ui-border bg-ui-surface p-4">
                    <div class="flex flex-wrap items-center gap-3"><span class="grid size-7 shrink-0 place-items-center rounded-full border border-ui-border bg-ui-toolbar text-xs">{{ index + 1 }}</span><h4 class="min-w-0 flex-1 break-words text-sm font-semibold">{{ text(step.title) }}</h4><span :class="tone(status(step.state))" class="rounded-ui-pill border px-2 py-1 text-xs capitalize">{{ status(step.state) }}</span></div>
                    <div class="mt-4 grid gap-3 sm:grid-cols-2"><div v-for="side in ['a', 'b']" :key="side" class="min-w-0 rounded border border-ui-border bg-ui-toolbar p-3"><p class="text-xs font-semibold text-ui-muted">{{ side.toUpperCase() }} · Simulated result</p><p class="mt-2 break-words text-sm">{{ text(step[side]) }}</p></div></div>
                    <details v-if="messages(step.console).length || messages(step.network).length || messages(step.dataLayer).length" class="mt-3 text-xs"><summary class="cursor-pointer text-ui-muted">Simulated console, network and dataLayer</summary><div class="mt-3 grid gap-3 lg:grid-cols-3"><div v-for="channel in ['console', 'network', 'dataLayer']" :key="channel" class="min-w-0"><p class="font-semibold">{{ channel }}</p><ul class="mt-2 space-y-1 break-all font-mono"><li v-for="(message, messageIndex) in messages(step[channel])" :key="messageIndex">{{ message }}</li><li v-if="!messages(step[channel]).length" class="text-ui-muted">No simulated event.</li></ul></div></div></details>
                </li>
            </ol>
            <div class="rounded-ui-panel border border-dashed border-ui-border p-4"><h4 class="text-sm font-semibold">Local recordings</h4><p class="mt-2 text-xs text-ui-muted">Trace, video and step screenshots are not available in this prototype. The trace command needs a real local recording path. No recording file exists for this sample.</p></div>
            <p v-if="!steps.length" class="text-sm text-ui-muted">No simulated steps are available.</p>
        </template>

        <template v-else-if="kind === 'content'">
            <div class="grid grid-cols-3 gap-3" aria-label="Simulated content summary"><div v-for="state in ['passed', 'failed', 'skipped']" :key="state" class="rounded-ui-panel border border-ui-border bg-ui-surface p-3"><p class="text-2xl font-semibold tabular-nums">{{ count(checks, state) }}</p><p class="mt-1 text-xs capitalize text-ui-muted">{{ state }} · simulated</p></div></div>
            <article v-for="(check, index) in checks" :key="index" class="min-w-0 rounded-ui-panel border border-ui-border bg-ui-surface p-4">
                <div class="flex flex-wrap items-center gap-2"><h4 class="min-w-0 flex-1 break-words text-sm font-semibold">{{ text(check.title) }}</h4><span class="text-xs text-ui-muted">{{ text(check.severity, 'info') }}</span><span :class="tone(status(check.state))" class="rounded-ui-pill border px-2 py-1 text-xs capitalize">{{ status(check.state) }}</span></div>
                <p class="mt-2 break-words text-xs text-ui-muted">{{ text(check.message) }}</p><p class="mt-2 break-all font-mono text-xs">{{ text(check.selector, 'Whole page') }}</p>
                <div class="mt-3 grid gap-3 sm:grid-cols-2"><div v-for="side in ['a', 'b']" :key="side" class="min-w-0 rounded border border-ui-border bg-ui-toolbar p-3"><p class="text-xs font-semibold text-ui-muted">{{ side.toUpperCase() }} · Simulated observation</p><p class="mt-2 break-words text-sm">{{ text(check[side]) }}</p></div></div>
            </article>
            <p v-if="!checks.length" class="text-sm text-ui-muted">No simulated checks are available.</p>
            <p class="text-xs text-ui-muted">The real check engine will read stored content. No crawl or language detection runs in this preview.</p>
        </template>

        <template v-else-if="kind === 'lighthouse'">
            <div v-if="sample?.compatible !== true" class="rounded-ui-panel border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"><h4 class="text-sm font-semibold">Comparison unavailable · Simulated incompatible pair</h4><p class="mt-2 break-words text-xs">{{ text(sample?.reason, 'Compatibility is not established for this sample.') }}</p><p class="mt-2 text-xs">No regression or delta is drawn between these samples.</p></div>
            <div v-if="sample?.suspect === true" class="rounded-ui-panel border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><h4 class="text-sm font-semibold">Suspect measurement · Simulated state</h4><p class="mt-2 text-xs">High machine load makes a speed result unreliable. A real runner must guard the load and mark an override as suspect.</p></div>
            <div class="grid gap-3 lg:grid-cols-2">
                <article v-for="(metric, index) in metrics" :key="index" class="min-w-0 rounded-ui-panel border border-ui-border bg-ui-surface p-4">
                    <div class="flex flex-wrap items-center justify-between gap-2"><h4 class="text-sm font-semibold">{{ text(metric.title) }}</h4><span class="text-xs text-ui-muted">Simulated · {{ unit(metric.unit) }}</span></div>
                    <div class="mt-4 grid grid-cols-2 gap-3"><div v-for="side in ['a', 'b']" :key="side" class="min-w-0"><p class="text-xs font-semibold text-ui-muted">{{ side.toUpperCase() }} · Illustrative median</p><p class="mt-2 break-words text-2xl font-semibold tabular-nums">{{ number(stats(metric[side])?.median) }} <span class="text-xs font-normal text-ui-muted">{{ unit(metric.unit) }}</span></p><p class="mt-2 break-words text-xs text-ui-muted">Spread {{ number(stats(metric[side])?.spread) }} {{ unit(metric.unit) }}</p><p class="mt-1 break-words text-xs text-ui-muted">Samples: {{ stats(metric[side])?.values.map(number).join(' / ') ?? 'At least 3 finite samples are required.' }}</p></div></div>
                    <div v-if="comparable" class="mt-4 space-y-3 border-t border-ui-border pt-3" aria-label="Simulated speed comparison">
                        <div class="flex flex-wrap items-center justify-between gap-2"><p class="text-xs">Simulated delta A → B: <strong class="tabular-nums">{{ delta(metric) === null ? 'Unavailable' : `${delta(metric) > 0 ? '+' : ''}${number(delta(metric))}` }} {{ unit(metric.unit) }}</strong></p><span :class="tone(budgetState(metric))" class="rounded-ui-pill border px-2 py-1 text-xs">{{ budgetState(metric) === 'failed' ? 'Simulated budget breach' : budgetState(metric) === 'passed' ? 'Within simulated budget' : 'Simulated budget unavailable' }}</span></div>
                        <div aria-label="Simulated median comparison" class="space-y-2"><div v-for="side in ['a', 'b']" :key="side" class="flex items-center gap-2"><span class="w-3 text-xs text-ui-muted">{{ side.toUpperCase() }}</span><div class="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-ui-toolbar"><div :style="{ width: barWidth(metric, side) }" :class="side === 'a' ? 'bg-slate-400' : 'bg-red-400'" class="h-full rounded-full"></div></div></div></div>
                        <p class="text-xs text-ui-muted">Illustrative budget: {{ number(metric.budget) }} {{ unit(metric.unit) }} ({{ metric.direction === 'higher' ? 'minimum' : 'maximum' }}). This simulated evaluation is a design example. The runner is not implemented.</p>
                    </div><p v-else class="mt-4 border-t border-ui-border pt-3 text-xs text-ui-muted">Illustrative budget: {{ number(metric.budget) }} {{ unit(metric.unit) }}. Comparison and budget evaluation are unavailable for this incompatible sample.</p>
                </article>
            </div>
            <details class="rounded-ui-panel border border-ui-border bg-ui-surface p-4 text-xs"><summary class="cursor-pointer font-semibold">Planned measurement contract</summary><dl class="mt-3 grid gap-3 sm:grid-cols-2"><div><dt class="text-ui-muted">Form factor</dt><dd class="mt-1 break-words">{{ text(sample?.settings?.formFactor) }}</dd></div><div><dt class="text-ui-muted">Throttling preset</dt><dd class="mt-1 break-words">{{ text(sample?.settings?.throttling) }}</dd></div></dl><p class="mt-3 text-ui-muted">A real capture discards one warm-up request, then measures 3 to 5 runs. Tool versions and settings hashes must agree. The noise floor is not measured here. Raw Lighthouse reports will stay local; none exist for this sample.</p></details>
            <p v-if="!metrics.length" class="text-sm text-ui-muted">No simulated metrics are available.</p>
        </template>
    </section>
</template>
