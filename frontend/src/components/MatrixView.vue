<script setup>
import { targetClass, targetState, cellClass, cellState } from '../../../src/report/classify.js';
import Badge from './Badge.vue';
import { formatRatio } from '../state/format.js';
defineProps({ report: Object, targetId: String, viewportId: String, source: String, targets: Array });
const emit = defineEmits(['action']);
function ratio(row) {
	if (row.artifacts && !row.artifacts.screenshot && (row.artifacts.html || row.artifacts.status)) return 'Screenshot not requested';
	const value = row.ratio ?? row.artifacts?.screenshot?.diff?.ratio;
	return Number.isFinite(value) ? formatRatio(value) : 'No ratio';
}
const rowFor = (target, id) => target.viewports.find((row) => row.id === id);
// A side shows only when its availability is a problem. "ok" and "unknown" add no
// information to a cell; the evidence view shows both sides in full.
const problems = (row) => ['a', 'b'].filter((side) => ['http-error', 'capture-error'].includes(row?.availability?.[side]));
</script>
<template>
	<div class="matrix-panel min-w-0 max-w-full overflow-x-auto rounded-ui-panel border border-ui-border bg-ui-surface">
		<table class="w-full border-collapse text-left text-xs">
			<thead class="bg-ui-toolbar">
				<tr>
					<th scope="col" class="p-4 text-xs font-semibold">Target</th>
					<th v-for="viewport in report.meta.viewports" :key="viewport.id" scope="col" class="p-4 text-xs font-semibold">
						{{ viewport.id }}<span class="mt-1 block text-xs font-normal text-ui-muted">{{ viewport.width }} × {{ viewport.height }}</span>
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
								v-if="targetState(target) !== 'complete'"
								:text="targetState(target)"
							/>
						</div>
					</th>
					<td
						v-for="viewport in report.meta.viewports"
						:key="viewport.id"
						class="min-w-48 p-4 align-top"
					>
						<button class="matrix-evidence mb-2 focus-visible:outline-ui-focus" @click="emit('action', 'evidence', { targetId: target.id, viewportId: viewport.id })" :disabled="!rowFor(target, viewport.id)">Open {{ viewport.id }} evidence</button>
						<div class="flex flex-wrap gap-1">
							<Badge :text="cellClass(report, target, viewport.id) ?? 'unclassified'" /><Badge
								v-if="cellState(target, viewport.id) !== 'complete'"
								:text="cellState(target, viewport.id)"
							/>
						</div>
						<template v-if="rowFor(target, viewport.id)"
							><p class="matrix-ratio my-2 text-ui-muted">{{ ratio(rowFor(target, viewport.id)) }}</p>
							<div v-if="problems(rowFor(target, viewport.id)).length" class="flex flex-wrap gap-1">
								<Badge
									v-for="side in problems(rowFor(target, viewport.id))"
									:key="side"
									:text="`${side.toUpperCase()}: ${rowFor(target, viewport.id).availability[side]}`"
								/></div
						></template>
					</td>
				</tr>
			</tbody>
		</table>
	</div>
</template>
