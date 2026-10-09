<script setup>
defineProps({ data: Object });
const tone = state => state === 'passed' ? 'text-emerald-700 dark:text-emerald-300' : state === 'failed' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300';
</script>
<template>
<section aria-label="Stored content checks" class="min-w-0 space-y-3">
  <div class="rounded-ui-panel border border-ui-border bg-ui-toolbar p-3 text-xs text-ui-muted">Measured from versioned stored DOM snapshots. No new crawl runs during comparison. Check version {{ data.checkVersion }}. <span v-if="data.incomplete">Some checks have incomplete coverage. They do not prove a pass.</span></div>
  <p v-if="!data.checks.length" role="status" class="p-4 text-sm text-ui-muted">No content check is enabled. Stored snapshots alone do not prove a match.</p>
  <article v-for="check in data.checks" :key="check.id" class="min-w-0 rounded-ui-panel border border-ui-border p-4">
    <h3 class="text-sm font-semibold">{{ check.title }}</h3>
    <div class="mt-3 grid gap-3 sm:grid-cols-2"><div v-for="side in ['a','b']" :key="side" class="min-w-0 rounded border border-ui-border bg-ui-toolbar p-3">
      <div class="flex justify-between gap-2 text-xs"><strong>{{ side.toUpperCase() }} · Stored evidence</strong><span :class="tone(check[side].state)">{{ check[side].state }}</span></div>
      <p v-if="!check[side].findings.length" class="mt-2 text-xs text-ui-muted">{{ check[side].state === 'passed' ? 'No defect is found by this enabled check.' : 'Evidence is incomplete.' }}</p>
      <ul class="mt-2 space-y-3"><li v-for="(finding,index) in check[side].findings" :key="index" class="text-xs"><span class="font-semibold">{{ finding.severity }}</span><p class="mt-1 break-words">{{ finding.message }}</p><details class="mt-2 text-ui-muted"><summary class="cursor-pointer">Finding evidence</summary><pre class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">{{ JSON.stringify(finding.evidence,null,2) }}</pre></details></li></ul>
      <p v-if="check[side].omitted" class="mt-3 text-xs text-amber-700 dark:text-amber-300">{{ check[side].omitted }} findings are omitted. Coverage is incomplete.</p>
    </div></div>
  </article>
</section>
</template>
