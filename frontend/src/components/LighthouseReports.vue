<script setup>
import { sameOriginUrl } from '../../../src/report/safe.js';
defineProps({ artifact: Object, source: String });
</script>
<template>
<section aria-label="Original Lighthouse reports" class="rounded-ui-panel border border-ui-border bg-ui-surface p-4">
  <h3 class="text-base font-semibold">Original Lighthouse reports</h3>
  <p class="mt-2 text-sm text-ui-muted">Download an HTML report and open it locally to use the original interactive Lighthouse interface. Each link is one measured audit.</p>
  <div class="mt-4 grid gap-4 sm:grid-cols-2">
    <div v-for="side in ['a', 'b']" :key="side">
      <h4 class="text-sm font-semibold">{{ side.toUpperCase() }} · {{ side === 'a' ? 'Before' : 'After' }}</h4>
      <div v-for="(raw, index) in artifact?.[side]?.reports ?? []" :key="index" class="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <a v-if="sameOriginUrl(raw.html?.src, source)" :href="sameOriginUrl(raw.html.src, source)" :download="`lighthouse-${side}-${index + 1}.html`" class="rounded-ui-pill border border-ui-control-border px-3 py-2 font-medium">{{ side.toUpperCase() }} audit {{ index + 1 }} · Original Lighthouse HTML</a>
        <a v-if="sameOriginUrl(raw.json?.src, source)" :href="sameOriginUrl(raw.json.src, source)" :download="`lighthouse-${side}-${index + 1}.json`" class="text-xs text-ui-muted underline">JSON</a>
      </div>
      <p v-if="!artifact?.[side]?.reports?.length" class="mt-2 text-sm text-ui-muted">No original report is indexed.</p>
    </div>
  </div>
</section>
</template>
