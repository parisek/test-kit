<script setup>
import { sameOriginUrl, relativePath } from '../../../src/report/safe.js';
defineProps({ data: Object, source: String });
const tone = state => state === 'same' ? 'text-emerald-700 dark:text-emerald-300' : state === 'failed' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300';
</script>
<template>
<section aria-label="Measured behavior steps" class="min-w-0 space-y-4">
  <div class="rounded-ui-panel border border-ui-border bg-ui-toolbar p-4"><p class="eyebrow">Project contract evidence</p><h2 class="mt-1 text-lg font-semibold">Behavior comparison</h2><p class="mt-2 text-sm text-ui-muted">Steps run after passive capture on the same guarded local page. Missing or failed evidence does not prove a match.</p><p class="mt-2 text-xs">Measurement: {{ data.state }}</p></div>
  <p v-if="!data.steps.length" class="p-4 text-sm text-ui-muted">No comparable contract step is available.</p>
  <article v-for="step in data.steps" :key="step.id" class="min-w-0 rounded-ui-panel border border-ui-border bg-ui-surface p-4">
    <div class="flex justify-between gap-3"><h3 class="min-w-0 break-words text-sm font-semibold">{{ step.title }}</h3><span class="text-xs font-semibold" :class="tone(step.state)">{{ step.state }}</span></div>
    <div class="mt-4 grid gap-3 md:grid-cols-2"><div v-for="side in ['A','B']" :key="side" class="min-w-0 rounded border border-ui-border bg-ui-toolbar p-3">
      <template v-if="step['result' + side]"><div class="flex justify-between gap-2 text-xs"><strong>{{ side }} · Contract result</strong><span>{{ step['result' + side].state }}</span></div>
        <p v-if="step['result' + side].error || step['result' + side].reason" class="mt-2 break-words text-sm">{{ step['result' + side].error ?? step['result' + side].reason }}</p>
        <pre class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{{ JSON.stringify(step['result' + side].result, null, 2) }}</pre>
        <a v-if="sameOriginUrl(step['result' + side].evidence?.screenshot, source)" :href="sameOriginUrl(step['result' + side].evidence.screenshot, source)" target="_blank" rel="noreferrer" class="mt-3 block text-xs underline">Open step screenshot<img :src="sameOriginUrl(step['result' + side].evidence.screenshot, source)" alt="Stored behavior step screenshot" loading="lazy" class="mt-2 max-h-64 max-w-full rounded border border-ui-border object-contain" /></a>
        <details v-if="step['result' + side].evidence" class="mt-3 text-xs text-ui-muted"><summary class="cursor-pointer">Console, network and dataLayer evidence</summary><pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">{{ JSON.stringify(step['result' + side].evidence, null, 2) }}</pre></details>
      </template><p v-else class="text-xs text-ui-muted">{{ side }} · Step evidence is missing.</p>
    </div></div>
  </article>
  <div v-if="data.traceA || data.traceB" class="rounded-ui-panel border border-ui-border p-4 text-xs"><p class="font-semibold">Open local trace</p><template v-for="side in ['A','B']" :key="side"><pre v-if="relativePath(data['trace' + side])" class="mt-2 overflow-auto whitespace-pre-wrap break-all">{{ side }}: npx playwright show-trace {{ data['trace' + side] }}</pre></template></div>
</section>
</template>
