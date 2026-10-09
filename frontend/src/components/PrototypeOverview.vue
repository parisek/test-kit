<script setup>
import { computed } from 'vue';
import { plannedSample } from '../prototypes/planned.js';
const props = defineProps({ report: Object, targets: Array, viewportId: String, prototypeKind: String });
const emit = defineEmits(['action']);
const rows = computed(() => (props.targets ?? []).map(target => {
  const viewport = target.viewports.some(row => row.id === props.viewportId) ? props.viewportId : target.viewports[0]?.id;
  return { target, viewport, sample: plannedSample(props.report, target.id, viewport, props.prototypeKind) };
}).filter(row => row.sample));
</script>
<template>
<section class="rounded-ui-panel border border-ui-border bg-ui-surface p-4" aria-label="Planned artifact overview">
  <div class="flex flex-wrap items-center justify-between gap-2"><h2 class="text-lg font-semibold">{{ prototypeKind === 'content' ? 'Content checks' : 'Performance evidence' }}</h2><span class="rounded-ui-pill border border-amber-400 px-3 py-1 text-xs">UI prototype · simulated</span></div>
  <p class="my-3 text-sm text-ui-muted">These examples test the interface. No check or Lighthouse runner executes. They do not affect measured findings, target classes, or acceptance.</p>
  <div class="grid gap-3 lg:grid-cols-2"><article v-for="row in rows" :key="row.target.id" class="min-w-0 rounded-ui-panel border border-ui-border p-4">
    <div class="flex items-center justify-between gap-2"><h3 class="font-semibold">{{ row.target.title ?? row.target.id }}</h3><span class="text-xs text-ui-muted">{{ row.viewport }}</span></div>
    <p class="mt-2 text-sm text-ui-muted" v-if="prototypeKind === 'content'">6 illustrative checks · failed, passed and skipped states</p>
    <p class="mt-2 text-sm" v-else>{{ !row.sample.compatible ? 'Incompatible settings · comparison blocked' : row.sample.suspect ? 'Suspect measurement · review machine load' : 'Three illustrative samples · median, spread and budgets' }}</p>
    <button class="mt-3 rounded-ui-pill border border-ui-control-border px-3 py-2 text-xs font-semibold" @click="emit('action', 'evidence', { targetId: row.target.id, viewportId: row.viewport, artifact: prototypeKind })">Explore prototype</button>
  </article></div>
</section>
</template>
