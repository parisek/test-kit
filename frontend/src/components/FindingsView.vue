<script setup>
import { computed } from 'vue';
import { targetClass, targetState } from '../../../src/report/classify.js';
import Badge from './Badge.vue';
const props = defineProps({ report: Object, targetId: String, viewportId: String, source: String });
const emit = defineEmits(['action']);
const groups = computed(() => {
	const map = new Map();
	for (const finding of props.report.findings) {
		const id = finding.causeId ?? null;
		if (!map.has(id)) map.set(id, []);
		map.get(id).push(finding);
	}
	return [...map].map(([id, findings]) => ({
		id,
		findings,
		cause: props.report.causes.find((item) => item.id === id),
	}));
});
const targetFor = (finding) => props.report.entries.find((item) => item.id === finding.targetId);
</script>
<template>
	<p v-if="!groups.length" class="text-sm text-ui-muted">
		No findings. Check measurement states before drawing a conclusion.
	</p>
	<section
		v-for="group in groups"
		:key="group.id ?? 'unknown'"
		class="min-w-0 rounded-ui-panel border border-ui-border bg-ui-surface p-4"
	>
		<div class="flex flex-wrap items-center gap-2">
			<h2 class="text-lg font-semibold break-words">{{ group.cause?.title ?? 'Unknown cause' }}</h2>
			<Badge :text="group.cause?.known === true ? 'explained' : 'unexplained'" />
		</div>
		<p v-if="group.cause?.detail" class="mt-2 text-sm break-words">{{ group.cause.detail }}</p>
		<div
			v-for="(finding, index) in group.findings"
			:key="finding.id ?? index"
			class="mt-4 border-t border-ui-border pt-3"
		>
			<template v-if="targetFor(finding)"
				><button
					class="text-left font-medium underline focus-visible:outline-ui-focus"
					@click="emit('action', 'target', targetFor(finding).id)"
				>
					{{ targetFor(finding).title ?? targetFor(finding).id }}
				</button>
				<div class="mt-2 flex flex-wrap gap-1">
					<Badge :text="targetClass(report, targetFor(finding)) ?? 'unclassified'" /><Badge
						:text="targetState(targetFor(finding))"
					/></div
			></template>
			<pre class="mt-2 whitespace-pre-wrap break-all text-xs">{{
				JSON.stringify(finding, null, 2)
			}}</pre>
		</div>
	</section>
</template>
