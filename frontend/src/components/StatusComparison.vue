<script setup>
defineProps({ data: Object });
</script>
<template>
    <section aria-label="HTTP comparison" class="min-w-0">
        <p class="mb-4 text-xs text-ui-muted">HTTP metadata does not decide the screenshot or HTML class.</p>
        <div class="grid gap-4 sm:grid-cols-2">
            <article v-for="side in ['a', 'b']" :key="side" class="min-w-0 rounded-ui-panel border border-ui-border bg-ui-surface p-4">
                <p class="text-xs font-semibold text-ui-muted">{{ side.toUpperCase() }} · {{ side === 'a' ? 'Before' : 'After' }}</p>
                <template v-if="data?.[side]">
                    <p class="mt-3 text-3xl font-semibold tabular-nums" :class="data[side].statusCode >= 400 ? 'text-red-700 dark:text-red-300' : 'text-ui-text'">{{ data[side].statusCode }}<span class="ml-2 text-sm font-normal text-ui-muted">HTTP</span></p>
                    <p v-if="data[side].statusCode >= 400" class="mt-2 text-sm text-red-700 dark:text-red-300">The navigation returns an HTTP error.</p>
                    <p class="mt-3 break-all font-mono text-xs">{{ data[side].finalPath }}</p>
                    <dl class="mt-4 grid grid-cols-3 gap-2 border-t border-ui-border pt-4 text-xs">
                        <div><dt class="text-ui-muted">Requests</dt><dd class="mt-1 text-lg tabular-nums">{{ data[side].assets?.requests ?? 'Unknown' }}</dd></div>
                        <div><dt class="text-ui-muted">Failed</dt><dd class="mt-1 text-lg tabular-nums" :class="data[side].assets?.failed ? 'text-red-700 dark:text-red-300' : ''">{{ data[side].assets?.failed ?? 'Unknown' }}</dd></div>
                        <div><dt class="text-ui-muted">HTTP errors</dt><dd class="mt-1 text-lg tabular-nums" :class="data[side].assets?.httpErrors ? 'text-red-700 dark:text-red-300' : ''">{{ data[side].assets?.httpErrors ?? 'Unknown' }}</dd></div>
                    </dl>
                    <p class="mt-4 text-xs text-ui-muted">{{ data[side].redirects?.length ?? 0 }} redirects</p>
                    <ol v-if="data[side].redirects?.length" class="mt-2 space-y-1 break-all font-mono text-xs"><li v-for="(path, index) in data[side].redirects" :key="index">{{ index + 1 }}. {{ path }}</li></ol>
                </template>
                <p v-else class="mt-3 text-sm text-ui-muted">HTTP metadata is unavailable.</p>
            </article>
        </div>
    </section>
</template>
