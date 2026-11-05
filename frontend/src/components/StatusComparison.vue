<script setup>
import { computed } from 'vue';
const props = defineProps({ data: Object });
// The fields that make a finding (R6.13): final status, final path and redirect chain. Asset counts do not.
const differs = computed(() => {
    const { a, b } = props.data ?? {};
    if (!a || !b) return [];
    return [a.statusCode !== b.statusCode && 'statusCode', a.finalPath !== b.finalPath && 'finalPath',
        JSON.stringify(a.redirects ?? []) !== JSON.stringify(b.redirects ?? []) && 'redirects'].filter(Boolean);
});
</script>
<template>
    <section aria-label="HTTP comparison" class="min-w-0">
        <p v-if="differs.length" class="mb-4 text-sm font-semibold text-ui-text" data-testid="status-differs">A and B differ in {{ differs.map(field => ({ statusCode: 'status code', finalPath: 'final path', redirects: 'redirect chain' })[field]).join(', ') }}.</p>
        <p v-else class="mb-4 text-xs text-ui-muted">Status code, final path and redirect chain are equal. Request counts do not make a finding.</p>
        <div class="grid gap-4 sm:grid-cols-2">
            <article v-for="side in ['a', 'b']" :key="side" class="min-w-0 rounded-ui-panel border border-ui-border bg-ui-surface p-4">
                <p class="text-xs font-semibold text-ui-muted">{{ side.toUpperCase() }} · {{ side === 'a' ? 'Before' : 'After' }}</p>
                <template v-if="data?.[side]">
                    <p class="mt-3 text-3xl font-semibold tabular-nums text-ui-text" :class="differs.includes('statusCode') ? 'underline decoration-2 underline-offset-4' : ''">{{ data[side].statusCode }}<span class="ml-2 text-sm font-normal text-ui-muted">HTTP</span></p>
                    <p v-if="data[side].statusCode >= 400" class="mt-2 text-sm font-semibold text-ui-text">The navigation returns an HTTP error.</p>
                    <p class="mt-3 break-all font-mono text-xs" :class="differs.includes('finalPath') ? 'font-semibold underline decoration-2 underline-offset-4' : ''">{{ data[side].finalPath }}</p>
                    <dl class="mt-4 grid grid-cols-3 gap-2 border-t border-ui-border pt-4 text-xs">
                        <div><dt class="text-ui-muted">Requests</dt><dd class="mt-1 text-lg tabular-nums">{{ data[side].assets?.requests ?? 'Unknown' }}</dd></div>
                        <div><dt class="text-ui-muted">Failed</dt><dd class="mt-1 text-lg tabular-nums" :class="data[side].assets?.failed ? 'font-semibold' : ''">{{ data[side].assets?.failed ?? 'Unknown' }}</dd></div>
                        <div><dt class="text-ui-muted">HTTP errors</dt><dd class="mt-1 text-lg tabular-nums" :class="data[side].assets?.httpErrors ? 'font-semibold' : ''">{{ data[side].assets?.httpErrors ?? 'Unknown' }}</dd></div>
                    </dl>
                    <p class="mt-4 text-xs text-ui-muted" :class="differs.includes('redirects') ? 'font-semibold text-ui-text' : ''">{{ data[side].redirects?.length ?? 0 }} redirects</p>
                    <ol v-if="data[side].redirects?.length" class="mt-2 space-y-1 break-all font-mono text-xs"><li v-for="(path, index) in data[side].redirects" :key="index">{{ index + 1 }}. {{ path }}</li></ol>
                </template>
                <p v-else class="mt-3 text-sm text-ui-muted">HTTP metadata is unavailable.</p>
            </article>
        </div>
    </section>
</template>
