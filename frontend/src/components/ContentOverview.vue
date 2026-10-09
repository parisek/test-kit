<script setup>
import { computed } from 'vue';
const props = defineProps({ targets: Array, viewportId: String });
const emit = defineEmits(['action']);
const rows = computed(() => props.targets.flatMap(target => target.viewports.filter(row => (!props.viewportId || row.id === props.viewportId) && row.artifacts?.content).map(row => ({ target, row, content: row.artifacts.content }))));
</script>
<template>
<section aria-label="Measured content overview" class="space-y-4">
  <div class="rounded-ui-panel border border-ui-border bg-ui-surface p-5"><p class="eyebrow">Stored snapshot checks</p><h2 class="mt-1 text-xl font-semibold">Content quality</h2><p class="mt-2 text-sm text-ui-muted">These results come from captured DOM snapshots. Open a target to inspect each check and its evidence. Incomplete coverage does not prove a pass.</p></div>
  <div class="grid gap-3 md:grid-cols-2"><article v-for="item in rows" :key="item.target.id + ':' + item.row.id" class="min-w-0 rounded-ui-panel border border-ui-border bg-ui-surface p-4">
    <div class="flex items-start justify-between gap-3"><div><h3 class="font-semibold">{{ item.target.title ?? item.target.id }}</h3><p class="mt-1 text-xs text-ui-muted">{{ item.row.id }} · {{ item.content.diff?.checks ?? 0 }} enabled checks</p></div><span class="rounded-ui-pill border border-ui-border px-2 py-1 text-xs">{{ item.content.state }}</span></div>
    <p class="mt-3 text-sm">{{ item.content.diff?.changed ? 'Content findings are present.' : item.content.state === 'complete' ? 'Enabled checks find no defect.' : 'Evidence is incomplete or not comparable.' }}</p>
    <p v-if="item.content.diagnostic" class="mt-2 break-words text-xs text-ui-muted">{{ item.content.diagnostic }}</p>
    <button class="mt-4 rounded-ui-pill border border-ui-control-border px-3 py-2 text-xs font-semibold hover:bg-ui-toolbar" @click="emit('action', 'evidence', { targetId: item.target.id, viewportId: item.row.id, artifact: 'content' })">Open check evidence →</button>
  </article></div>
  <p v-if="!rows.length" class="p-4 text-sm text-ui-muted">No stored content checks are in this selection.</p>
</section>
</template>
