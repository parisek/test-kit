<script setup>
import { computed } from 'vue';
const props = defineProps({ data: Object, view: { type: String, default: 'normalized' } });
const emit = defineEmits(['action']);
const window = computed(() => props.view === 'raw' ? props.data?.rawWindow : props.data);
const lines = computed(() => Array.isArray(window.value?.lines) ? window.value.lines.slice(0, 100) : []);
</script>
<template>
    <section aria-label="HTML line comparison" class="min-w-0">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div class="inline-flex rounded-ui-pill border border-ui-control-border p-1 text-xs" aria-label="HTML evidence view">
                <button v-for="choice in ['normalized', 'raw']" :key="choice" :aria-pressed="view === choice" :disabled="choice === 'raw' && !data?.rawWindow" :class="view === choice ? 'bg-ui-active-surface text-ui-active-text' : 'text-ui-muted'" class="rounded-ui-pill px-3 py-1.5" @click="emit('action', 'evidence-view', choice)">{{ choice === 'raw' ? 'Raw response' : 'Normalized' }}</button>
            </div>
            <p class="text-xs text-ui-muted"><span class="text-red-700 dark:text-red-300">−{{ window?.removedLines ?? 0 }} removed</span> · <span class="text-emerald-700 dark:text-emerald-300">+{{ window?.addedLines ?? 0 }} added</span></p>
        </div>
        <p v-if="view === 'raw' && !data?.rawWindow" role="status" class="mb-3 text-sm text-ui-muted">A raw line comparison is not indexed. Use the original response links.</p>
        <p v-if="view === 'normalized' && data?.rawChanged && !data?.changed" class="mb-3 rounded-ui-panel border border-ui-border bg-ui-toolbar p-3 text-sm">Raw response changes are explained by evidenced normalization. Inspect Raw response to see them.</p>
        <p class="mb-3 text-xs text-ui-muted">Server response text. Markup is displayed as text. This is a bounded replacement window, not a DOM comparison.</p>
        <div v-if="lines.length" class="overflow-hidden rounded-ui-panel border border-ui-border font-mono text-xs">
            <div v-for="(line, index) in lines" :key="index" class="flex min-w-0 border-b border-ui-border last:border-b-0" :class="line.kind === 'added' ? 'bg-emerald-50 text-emerald-950 dark:bg-emerald-950/50 dark:text-emerald-100' : 'bg-red-50 text-red-950 dark:bg-red-950/50 dark:text-red-100'">
                <span class="w-12 shrink-0 border-r border-ui-border px-2 py-2 text-right opacity-60">{{ line.line }}</span>
                <span class="w-7 shrink-0 py-2 text-center font-semibold">{{ line.kind === 'added' ? '+' : '−' }}</span>
                <code class="min-w-0 flex-1 whitespace-pre-wrap break-all py-2 pr-3">{{ line.text }}<span v-if="line.truncated" class="ml-2 font-sans italic opacity-60">[line truncated]</span></code>
            </div>
        </div>
        <p v-else class="rounded-ui-panel border border-ui-border bg-ui-toolbar p-5 text-sm">{{ !window ? 'No comparison window is available.' : window.changed ? 'No changed lines are displayed in this window.' : 'No changed lines in this comparison.' }}</p>
        <p v-if="window?.omittedLines" class="mt-3 text-xs text-ui-muted">{{ window.omittedLines }} changed lines are outside this bounded window. Open the full response to inspect all text.</p>
    </section>
</template>
