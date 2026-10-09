<script setup>
const props = defineProps({ report: Object, targetId: String, viewportId: String, source: String });
const toolsFor = run => {
    const tools = run.tools ?? props.report.meta.tools;
    return Array.isArray(tools) ? tools.filter(tool => tool && typeof tool === 'object') : [];
};
const diagnostic = (value) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
</script>
<template>
    <div class="timeline-list">
        <section v-for="(run, index) in report.runs" :key="run.id" class="timeline-card">
            <div class="timeline-marker">{{ index + 1 }}</div>
            <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2"><span class="eyebrow">{{ run.side ?? 'Unknown side' }}</span><span class="ml-auto text-xs text-ui-muted">{{ run.at ?? 'Time unknown' }}</span></div>
                <h2 class="mt-2 break-words text-lg font-semibold">{{ run.label ?? run.id }}</h2>
                <p class="mt-1 text-xs text-ui-muted">{{ run.state ?? 'State unknown' }}</p>
                <div class="mt-4 flex flex-wrap gap-2"><span v-for="(tool, toolIndex) in toolsFor(run)" :key="toolIndex" class="tool-tag">{{ tool.name }} {{ tool.version }}</span></div>
                <details class="technical-details"><summary>Settle recipe and tools</summary><h3 class="mt-4 font-semibold">Settle recipe and tools</h3><pre>{{ diagnostic(run.settings?.sides?.[run.side]?.settle ?? run.settle ?? 'Settle recipe unavailable') }}</pre><pre>{{ diagnostic(run.tools ?? report.meta.tools ?? 'Tool provenance unavailable') }}</pre><pre v-if="run.settingsHash != null">{{ diagnostic(run.settingsHash) }}</pre><p class="mt-3 break-all">Run ID: {{ run.id }}</p></details>
            </div>
        </section>
    </div>
</template>
