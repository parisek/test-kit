<script setup>
import { computed } from 'vue';
import {
	targetClass,
	targetState,
	cellClass,
	cellState,
	findingsFor,
} from '../../../src/report/classify.js';
import Badge from './Badge.vue';
import EvidenceImage from './EvidenceImage.vue';
const props = defineProps({ report: Object, targetId: String, viewportId: String, source: String });
const emit = defineEmits(['action']);
const target = computed(() => props.report.entries.find((item) => item.id === props.targetId));
const row = computed(
	() =>
		target.value?.viewports.find((item) => item.id === props.viewportId) ??
		(props.viewportId == null ? target.value?.viewports[0] : null),
);
const parts = computed(() =>
	(Array.isArray(target.value?.composedOf) ? target.value.composedOf : [])
		.map((item) => (typeof item === 'string' ? item : item?.id))
		.filter(Boolean)
		.join(', '),
);
const usedOn = computed(() =>
	props.report.entries
		.filter(
			(item) =>
				Array.isArray(item.composedOf) &&
				item.composedOf.some(
					(part) => (typeof part === 'string' ? part : part?.id) === target.value?.id,
				),
		)
		.map((item) => item.title ?? item.id)
		.join(', '),
);
const findings = computed(() => (target.value ? findingsFor(props.report, target.value.id) : []));
const diagnostic = (value) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const ratio = computed(() => {
	const value = row.value?.ratio ?? row.value?.artifacts?.screenshot?.diff?.ratio;
	return Number.isFinite(value) ? `${value.toFixed(3)}%` : 'No ratio';
});
</script>
<template>
	<section
		v-if="target"
		class="min-w-0 rounded-ui-panel border border-ui-border bg-ui-surface p-4 sm:p-5"
	>
		<h2 class="text-lg font-semibold break-words">{{ target.title ?? target.id }}</h2>
		<p class="mt-1 text-sm text-ui-muted break-words">
			{{ target.kind ?? 'target' }} · {{ target.path ?? '' }}
		</p>
		<div class="my-3 flex flex-wrap gap-2">
			<Badge :text="targetClass(report, target) ?? 'unclassified'" /><Badge
				:text="targetState(target)"
			/>
		</div>
		<p v-if="target.note" class="mb-3 break-words">{{ target.note }}</p>
		<p v-if="parts" class="mb-2 text-sm break-words">Composed of: {{ parts }}</p>
		<p v-if="usedOn" class="mb-2 text-sm break-words">Used on: {{ usedOn }}</p>
		<label class="my-4 flex flex-wrap items-center gap-2 text-sm"
			>Viewport
			<select
				:value="viewportId ?? row?.id"
				aria-label="Viewport"
				class="rounded-ui-panel border border-ui-control-border bg-ui-surface px-2 py-1 text-ui-text"
				@change="emit('action', 'viewport', $event.target.value)"
			>
				<option v-for="viewport in report.meta.viewports" :key="viewport.id" :value="viewport.id">
					{{ viewport.id }}
				</option>
			</select></label
		>
		<template v-if="row"
			><h3 class="font-semibold">{{ row.id }}</h3>
			<div class="my-2 flex flex-wrap gap-2">
				<Badge :text="cellClass(report, target, row.id) ?? 'unclassified'" /><Badge
					:text="cellState(target, row.id)"
				/><Badge
					v-for="side in ['a', 'b']"
					:key="side"
					:text="`${side.toUpperCase()}: ${row.availability?.[side] ?? 'unknown'}`"
				/>
			</div>
			<p class="mb-3 text-sm text-ui-muted">Difference: {{ ratio }}</p>
			<pre v-if="row.error ?? row.diagnostic" class="mb-4 whitespace-pre-wrap break-all text-xs">{{
				diagnostic(row.error ?? row.diagnostic)
			}}</pre>
			<div class="grid min-w-0 gap-3 xl:grid-cols-3">
				<EvidenceImage
					v-for="[key, title] in [
						['a', 'A'],
						['b', 'B'],
						['diff', 'Difference'],
					]"
					:key="key"
					:title="title"
					:src="row.artifacts?.screenshot?.[key]?.src"
					:source="source"
					:target-title="target.title ?? target.id"
					:viewport-id="row.id"
				/>
			</div>
			<pre
				v-if="row.artifacts?.screenshot?.diff?.regions != null"
				class="mt-4 whitespace-pre-wrap break-all text-xs"
				>{{ diagnostic(row.artifacts.screenshot.diff.regions) }}</pre
			>
			<details class="mt-4 text-sm">
				<summary class="cursor-pointer font-medium">Artifact provenance</summary>
				<pre class="mt-2 whitespace-pre-wrap break-all text-xs">{{
					diagnostic(row.artifacts)
				}}</pre>
			</details></template
		>
		<p v-else class="my-4 text-sm">Missing evidence for {{ viewportId ?? 'this target' }}. This measurement is unclassified.</p>
		<h3 class="mt-5 font-semibold">Findings ({{ findings.length }})</h3>
		<pre
			v-for="(finding, index) in findings"
			:key="finding.id ?? index"
			class="mt-2 whitespace-pre-wrap break-all text-xs"
			>{{ diagnostic(finding) }}</pre
		>
	</section>
	<p v-else class="text-ui-muted">No target available.</p>
</template>
