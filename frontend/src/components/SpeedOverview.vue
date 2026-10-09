<script setup>
import { computed } from 'vue';
import PerformanceComparison from './PerformanceComparison.vue';
const props = defineProps({ targets: Array, targetId: String, viewportId: String, evidence: Object });
const emit = defineEmits(['action']);
const rows = computed(() => props.targets.flatMap(target => target.viewports.filter(row => row.artifacts?.lighthouse).map(row => ({ target, row, artifact: row.artifacts.lighthouse }))));
</script>
<template>
<section aria-label="Measured speed overview" class="space-y-4">
  <div class="rounded-ui-panel border border-ui-border bg-ui-surface p-4"><h2 class="text-xl font-semibold">Local speed measurements</h2><p class="mt-2 text-sm text-ui-muted">Select a measured target. Different environments and suspect load remain incompatible.</p><div class="mt-4 flex flex-wrap gap-2"><button v-for="item in rows" :key="item.target.id+item.row.id" class="rounded-ui-pill border border-ui-control-border px-3 py-2 text-xs" @click="emit('action','evidence',{targetId:item.target.id,viewportId:item.row.id,artifact:'lighthouse'})">{{ item.target.title ?? item.target.id }} · {{ item.row.id }} · {{ item.artifact.state }}</button></div></div>
  <p v-if="evidence?.loading" role="status" class="p-4 text-sm text-ui-muted">Loading measured metrics…</p>
  <p v-else-if="evidence?.error" role="status" class="p-4 text-sm text-red-700 dark:text-red-300">{{ evidence.error }}</p>
  <PerformanceComparison v-else-if="evidence?.kind === 'lighthouse' && evidence.data" :data="evidence.data" />
  <p v-else class="p-4 text-sm text-ui-muted">Open a target to inspect its stored performance evidence.</p>
</section>
</template>
