<script setup>
import { computed } from 'vue';
import Badge from './Badge.vue';
import { findingIsExplained } from '../../../src/report/classify.js';
import { sameOriginUrl } from '../../../src/report/safe.js';
const props = defineProps({ findings: Array, report: Object, source: String });
const items = computed(() => Array.isArray(props.findings) ? props.findings.slice(0, 200) : []);
const cause = finding => props.report?.causes?.find(item => item.id === finding.causeId);
const evidence = finding => sameOriginUrl(typeof finding.evidence === 'string' ? finding.evidence : finding.evidence?.src, props.source);
</script>
<template>
    <section class="mt-6 border-t border-ui-border pt-5" aria-label="Findings for selected evidence">
        <h3 class="text-sm font-semibold">Findings <span class="ml-1 text-ui-muted">{{ findings?.length ?? 0 }}</span></h3>
        <p v-if="!items.length" class="mt-3 text-sm text-ui-muted">No finding is recorded in this evidence scope. Check measurement availability above.</p>
        <div v-else class="mt-3 grid gap-3">
            <article v-for="(finding, index) in items" :key="finding.id ?? index" class="min-w-0 rounded-ui-panel border border-ui-border bg-ui-toolbar p-4">
                <div class="flex flex-wrap items-start justify-between gap-2"><p class="min-w-0 flex-1 break-words text-sm font-medium">{{ finding.message ?? finding.title ?? (finding.artifact === 'screenshot' ? 'Screenshot pixels differ.' : `${finding.artifact ?? 'Evidence'} differs.`) }}</p><Badge :text="findingIsExplained(report, finding) ? 'explained' : 'unexplained'" /></div>
                <p class="mt-2 break-words text-xs text-ui-muted">{{ finding.artifact ?? 'Evidence' }} · {{ finding.viewportId ?? 'All viewports' }}<span v-if="cause(finding)"> · {{ cause(finding).title ?? cause(finding).id }}</span><span v-else> · No cause is recorded</span></p>
                <p v-if="cause(finding)?.detail" class="mt-2 break-words text-sm">{{ cause(finding).detail }}</p>
                <a v-if="evidence(finding)" :href="evidence(finding)" target="_blank" rel="noreferrer" class="mt-2 inline-block text-xs underline">Open finding evidence</a>
                <details class="mt-3 text-xs text-ui-muted"><summary class="cursor-pointer">Finding details</summary><pre class="mt-2 whitespace-pre-wrap break-all">{{ JSON.stringify(finding, null, 2) }}</pre></details>
            </article>
        </div>
        <p v-if="findings?.length > items.length" class="mt-3 text-xs text-ui-muted">{{ findings.length - items.length }} more findings are omitted from this bounded list.</p>
    </section>
</template>
