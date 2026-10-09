<script setup>
const props = defineProps({ data: Object });
const metrics = { lcp_ms: ['Largest contentful paint', 'ms'], fcp_ms: ['First contentful paint', 'ms'], tbt_ms: ['Total blocking time', 'ms'], cls: ['Cumulative layout shift', ''], speed_index_ms: ['Speed index', 'ms'] };
const format = (value, key) => Number.isFinite(value) ? Math.abs(value) >= 1e9 ? value.toExponential(2) : key === 'cls' ? value.toFixed(3) : Math.round(value).toLocaleString('en') : 'Unknown';
const width = (side, key) => {
  const a = props.data.a.metrics[key]?.median ?? 0, b = props.data.b.metrics[key]?.median ?? 0;
  return Math.max(0, Math.min(100, (side === 'a' ? a : b) / Math.max(1, a, b) * 100)) + '%';
};
</script>
<template>
<section aria-label="Measured performance comparison" class="min-w-0 space-y-4">
  <div class="rounded-ui-panel border border-ui-border bg-ui-toolbar p-4"><p class="eyebrow">Repeated local Lighthouse audits</p><h2 class="mt-1 text-xl font-semibold">Performance lab</h2><p class="mt-2 text-sm text-ui-muted">Median and full observed spread from {{ data.b.settings.runs }} measured runs. A discarded warmup precedes each set. The observed spread is the comparison noise band.</p><p class="mt-2 text-xs text-ui-muted">{{ data.b.settings.formFactor }} · {{ data.b.settings.throttlingMethod }} throttling · {{ data.b.suspect ? 'Suspect machine load' : 'Load guard checked' }}</p></div>
  <p v-if="!data.compatible" role="status" class="rounded-ui-panel border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">Comparison unavailable. {{ data.reason }} A/B measurements remain visible. No regression is inferred.</p>
  <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><article v-for="([title, unit], key) in metrics" :key="key" class="min-w-0 rounded-ui-panel border border-ui-border bg-ui-surface p-5">
    <h3 class="text-xs font-semibold text-ui-muted">{{ title }}</h3>
    <div class="mt-3 flex items-end justify-between gap-2"><strong class="text-3xl tracking-tight">{{ format(data.b.metrics[key]?.median, key) }}<small class="ml-1 text-xs font-normal text-ui-muted">{{ unit }}</small></strong><span v-if="data.compatible" class="rounded-ui-pill border border-ui-border px-2 py-1 text-xs" :class="data.metrics[key].state === 'regression' ? 'text-red-700 dark:text-red-300' : data.metrics[key].state === 'improvement' ? 'text-emerald-700 dark:text-emerald-300' : 'text-ui-muted'">{{ data.metrics[key].state }}</span></div>
    <div class="mt-4 space-y-3"><div v-for="side in ['a','b']" :key="side"><div class="mb-1 flex justify-between text-xs text-ui-muted"><span>{{ side.toUpperCase() }} median</span><span>{{ format(data[side].metrics[key]?.median, key) }} {{ unit }}</span></div><div class="h-1.5 overflow-hidden rounded-full bg-ui-toolbar"><div class="h-full rounded-full" :class="side === 'a' ? 'bg-blue-500' : 'bg-violet-500'" :style="{ width: width(side,key) }"></div></div></div></div>
    <p v-if="data.compatible" class="mt-4 text-xs text-ui-muted">Δ {{ data.metrics[key].delta > 0 ? '+' : '' }}{{ format(data.metrics[key].delta, key) }} {{ unit }} · noise {{ format(data.metrics[key].noiseFloor, key) }} {{ unit }}</p>
    <details class="mt-4 border-t border-ui-border pt-3 text-xs text-ui-muted"><summary class="cursor-pointer">Samples and spread</summary><p v-for="side in ['a','b']" :key="side" class="mt-2 break-words">{{ side.toUpperCase() }}: {{ data[side].metrics[key].samples.map(value => format(value,key)).join(', ') }} {{ unit }} · spread {{ format(data[side].metrics[key].spread,key) }} {{ unit }}</p></details>
  </article></div>
  <div v-if="data.findings.length" class="rounded-ui-panel border border-ui-border p-4"><h3 class="text-sm font-semibold">Measured findings</h3><ul class="mt-3 space-y-2 text-sm"><li v-for="(finding,index) in data.findings" :key="index" class="break-words">{{ finding.message }} <span class="text-xs text-ui-muted">{{ finding.metric }} · {{ finding.severity }}</span></li></ul><p class="mt-3 text-xs text-ui-muted">Only an explicit fail-on-budget option changes the command exit code for a budget breach.</p></div>
</section>
</template>
