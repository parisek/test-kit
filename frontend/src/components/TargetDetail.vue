<script setup>
import { computed } from 'vue';
import { targetClass, targetState, cellClass, cellState, findingsFor } from '../../../src/report/classify.js';
import RuleAudit from './RuleAudit.vue';
import ArtifactEvidence from './ArtifactEvidence.vue';
import ScreenshotComparison from './ScreenshotComparison.vue';
import FindingCards from './FindingCards.vue';
import Badge from './Badge.vue';
import PlannedEvidence from './PlannedEvidence.vue';
import { hasPrototypes, PLANNED_KINDS, plannedSample } from '../prototypes/planned.js';
const props = defineProps({ report: Object, targetId: String, viewportId: String, source: String, artifactEvidence: Object, artifact: { type: String, default: 'screenshot' }, comparison: { type: String, default: 'side-by-side' }, overlay: { type: Number, default: 50 }, evidenceView: { type: String, default: 'normalized' } });
const emit = defineEmits(['action']);
const target = computed(() => props.report?.entries?.find(item => item.id === props.targetId));
const row = computed(() => target.value?.viewports?.find(item => item.id === props.viewportId) ?? (props.viewportId == null ? target.value?.viewports?.[0] : null));
const artifacts = computed(() => [...['screenshot', 'html', 'status', 'content'].filter(kind => row.value?.artifacts?.[kind]), ...(hasPrototypes(props.report) && row.value ? PLANNED_KINDS.filter(kind => !row.value.artifacts?.[kind]) : [])]);
const planned = computed(() => row.value?.artifacts?.[selectedArtifact.value] ? null : plannedSample(props.report, props.targetId, row.value?.id, selectedArtifact.value));
const selectedArtifact = computed(() => artifacts.value.includes(props.artifact) ? props.artifact : artifacts.value[0] ?? props.artifact);
const viewports = computed(() => props.report?.meta?.viewports?.length ? props.report.meta.viewports : target.value?.viewports ?? []);
const parts = computed(() => (Array.isArray(target.value?.composedOf) ? target.value.composedOf : []).map(item => typeof item === 'string' ? item : item?.id).filter(Boolean).join(', '));
const usedOn = computed(() => props.report.entries.filter(item => Array.isArray(item.composedOf) && item.composedOf.some(part => (typeof part === 'string' ? part : part?.id) === target.value?.id)).map(item => item.title ?? item.id).join(', '));
const findings = computed(() => target.value ? findingsFor(props.report, target.value.id, { viewportId: row.value?.id ?? props.viewportId, artifact: selectedArtifact.value }) : []);
const diagnostic = value => typeof value === 'string' ? value : value?.message ?? 'This measurement cannot be compared. Inspect technical details for its diagnostic.';
const label = kind => ({ screenshot: 'Screenshot', html: 'HTML', status: 'Status', behavior: 'Behavior · Prototype', content: row.value?.artifacts?.content ? 'Content' : 'Content · Prototype', lighthouse: 'Lighthouse · Prototype' })[kind];
</script>
<template>
    <section v-if="target" class="min-w-0 rounded-ui-panel border border-ui-border bg-ui-surface">
        <header class="border-b border-ui-border px-4 pt-3">
            <div class="flex flex-wrap items-start justify-between gap-3"><div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1"><h2 class="break-words text-lg font-semibold tracking-tight">{{ target.title ?? target.id }}</h2><p class="break-all text-xs text-ui-muted">{{ target.kind ?? 'Target' }}<span v-if="target.path"> · {{ target.path }}</span></p></div><div class="flex flex-wrap gap-2"><Badge :text="targetClass(report, target) ?? 'unclassified'" /><Badge v-if="targetState(target) !== 'complete'" :text="targetState(target)" /></div></div>
            <nav class="mt-2 flex flex-wrap gap-x-5 gap-y-2" aria-label="Evidence artifacts">
                <button v-for="kind in artifacts" :key="kind" :aria-pressed="selectedArtifact === kind" :class="selectedArtifact === kind ? 'border-ui-text text-ui-text' : 'border-transparent text-ui-muted hover:text-ui-text'" class="border-b-2 px-0.5 pb-2 text-sm font-medium" @click="emit('action', 'artifact', kind)">{{ label(kind) }}</button>
            </nav>
        </header>
        <div class="p-3 sm:px-4">
            <div class="mb-2 flex flex-wrap items-center justify-between gap-3">
                <div class="flex flex-wrap items-center gap-2"><span class="mr-1 text-xs text-ui-muted">Viewport</span><div class="inline-flex max-w-full flex-wrap rounded-ui-pill border border-ui-control-border p-1" aria-label="Viewport"><button v-for="viewport in viewports" :key="viewport.id" :aria-pressed="(viewportId ?? row?.id) === viewport.id" :class="(viewportId ?? row?.id) === viewport.id ? 'bg-ui-active-surface text-ui-active-text' : 'text-ui-muted'" class="rounded-ui-pill break-all px-3 py-1.5 text-xs" @click="emit('action', 'viewport', viewport.id)">{{ viewport.id }}<span v-if="viewport.width" class="ml-1 opacity-60">{{ viewport.width }}</span></button></div></div>
                <div v-if="selectedArtifact === 'screenshot' && row?.artifacts?.screenshot" class="inline-flex rounded-ui-pill border border-ui-control-border p-1" aria-label="Screenshot comparison mode"><button v-for="[mode, title] in [['side-by-side', 'Side by side'], ['overlay', 'Overlay'], ['diff', 'Difference']]" :key="mode" :aria-pressed="comparison === mode" :class="comparison === mode ? 'bg-ui-active-surface text-ui-active-text' : 'text-ui-muted'" class="rounded-ui-pill px-3 py-1.5 text-xs" @click="emit('action', 'comparison', mode)">{{ title }}</button></div>
            </div>
            <template v-if="row">
                <div class="mb-2 flex flex-wrap items-center gap-2 text-xs"><Badge :text="cellClass(report, target, row.id) ?? 'unclassified'" /><Badge v-if="cellState(target, row.id) !== 'complete'" :text="cellState(target, row.id)" /><span v-for="side in ['a', 'b']" :key="side" :class="row.availability?.[side] === 'http-error' || row.availability?.[side] === 'capture-error' ? 'text-red-700 dark:text-red-300' : 'text-ui-muted'">{{ side.toUpperCase() }}: {{ row.availability?.[side] ?? 'unknown' }}</span><span v-if="selectedArtifact === 'screenshot'" class="text-ui-muted">· Pixel difference {{ Number.isFinite(row.artifacts?.screenshot?.diff?.ratio ?? row.ratio) ? `${(row.artifacts?.screenshot?.diff?.ratio ?? row.ratio).toFixed(3)}%` : 'not measured' }} · not a verdict</span></div>
                <p v-if="row.error ?? row.diagnostic" role="status" class="mb-4 rounded-ui-panel border border-ui-border bg-ui-toolbar p-3 text-sm">{{ diagnostic(row.error ?? row.diagnostic) }}</p>
                <PlannedEvidence v-if="planned" :kind="selectedArtifact" :sample="planned" />
                <ScreenshotComparison v-else-if="selectedArtifact === 'screenshot' && row.artifacts?.screenshot" :screenshot="row.artifacts.screenshot" :source="source" :target-title="target.title ?? target.id" :viewport-id="row.id" :mode="comparison" :overlay="overlay" :ratio="row.ratio" @action="(...args) => emit('action', ...args)" />
                <ArtifactEvidence v-else-if="['html', 'status', 'content'].includes(selectedArtifact)" :row="row" :source="source" :evidence="artifactEvidence" :kind="selectedArtifact" :evidence-view="evidenceView" @action="(...args) => emit('action', ...args)" />
                <p v-else role="status" class="rounded-ui-panel border border-ui-border p-5 text-sm text-ui-muted">No evidence is indexed for this viewport.</p>
                <RuleAudit v-if="selectedArtifact === 'html'" :report="report" :target-id="targetId" :row="row" :evidence="artifactEvidence?.kind === 'html' ? artifactEvidence.data : null" />

                <details v-if="selectedArtifact === 'screenshot'" class="mt-5 border-t border-ui-border pt-3 text-xs text-ui-muted"><summary class="cursor-pointer">Technical details · artifact provenance</summary><pre class="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all">{{ JSON.stringify({ state: row.state, diagnostic: row.error ?? row.diagnostic, artifacts: row.artifacts }, null, 2) }}</pre></details>
            </template>
            <p v-else role="status" class="my-4 rounded-ui-panel border border-ui-border p-5 text-sm text-ui-muted">Missing evidence for {{ viewportId ?? 'this target' }}. This measurement is unclassified.</p>
<details v-if="parts || usedOn || target.note" class="mt-4 border-t border-ui-border pt-3 text-xs text-ui-muted"><summary class="cursor-pointer">Target details · composition and usage</summary><p v-if="target.note" class="mt-2 break-words">{{ target.note }}</p><p v-if="parts" class="mt-2 break-words">Composed of: {{ parts }}</p><p v-if="usedOn" class="mt-2 break-words">Used on: {{ usedOn }}</p></details>
            <FindingCards v-if="!planned" :findings="findings" :report="report" :source="source" />
        </div>
    </section>
    <p v-else class="text-ui-muted">No target available.</p>
</template>
