<script setup>
import { targetClass, targetState, cellClass, cellState } from '../../../src/report/classify.js';
import Badge from './Badge.vue';
defineProps({ report: Object, targetId: String, viewportId: String, source: String, targets: Array });
const emit = defineEmits(['action']);
function ratio(row) {
	const value = row.ratio ?? row.artifacts?.screenshot?.diff?.ratio;
	return Number.isFinite(value) ? `${value.toFixed(3)}%` : 'No ratio';
}
const rowFor = (target, id) => target.viewports.find((row) => row.id === id);
</script>
<template>
	<div class="min-w-0 max-w-full overflow-x-auto rounded-ui-panel border border-ui-border">
		<table class="w-full border-collapse text-left text-sm">
			<thead class="bg-ui-toolbar">
				<tr>
					<th scope="col" class="p-4">Target</th>
					<th v-for="viewport in report.meta.viewports" :key="viewport.id" scope="col" class="p-4">
						{{ viewport.id }}
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="target in targets ?? report.entries" :key="target.id" class="border-t border-ui-border">
					<th scope="row" class="min-w-44 p-4 align-top">
						<button
							:aria-current="String(targetId === target.id)"
							class="text-left font-medium underline decoration-ui-border underline-offset-4 focus-visible:outline-ui-focus"
							@click="emit('action', 'target', target.id)"
						>
							{{ target.title ?? target.id }}
						</button>
						<div class="mt-2 flex flex-wrap gap-1">
							<Badge :text="targetClass(report, target) ?? 'unclassified'" /><Badge
								:text="targetState(target)"
							/>
						</div>
					</th>
					<td
						v-for="viewport in report.meta.viewports"
						:key="viewport.id"
						class="min-w-48 p-4 align-top"
					>
						<button class="mb-2 underline focus-visible:outline-ui-focus" @click="emit('action', 'evidence', { targetId: target.id, viewportId: viewport.id })" :disabled="!rowFor(target, viewport.id)">Open {{ viewport.id }} evidence</button>
						<div class="flex flex-wrap gap-1">
							<Badge :text="cellClass(report, target, viewport.id) ?? 'unclassified'" /><Badge
								:text="cellState(target, viewport.id)"
							/>
						</div>
						<template v-if="rowFor(target, viewport.id)"
							><p class="my-2 text-ui-muted">{{ ratio(rowFor(target, viewport.id)) }}</p>
							<div class="flex flex-wrap gap-1">
								<Badge
									v-for="side in ['a', 'b']"
									:key="side"
									:text="`${side.toUpperCase()}: ${rowFor(target, viewport.id).availability?.[side] ?? 'unknown'}`"
								/></div
						></template>
					</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>
