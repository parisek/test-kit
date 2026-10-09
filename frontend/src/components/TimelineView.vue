<script setup>
defineProps({ report: Object, targetId: String, viewportId: String, source: String });
const diagnostic = (value) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
</script>
<template>
	<section
		v-for="run in report.runs"
		:key="run.id"
		class="min-w-0 rounded-ui-panel border border-ui-border bg-ui-surface p-4"
	>
		<h2 class="text-lg font-semibold break-words">{{ run.label ?? run.id }} ({{ run.id }})</h2>
		<p class="mt-1 text-sm text-ui-muted break-words">
			{{ run.side ?? 'Unknown side' }} · {{ run.at ?? 'Time unknown' }} ·
			{{ run.state ?? 'State unknown' }}
		</p>
		<h3 class="mt-4 font-semibold">Settle recipe and tools</h3>
		<pre class="mt-2 whitespace-pre-wrap break-all text-xs">{{
			diagnostic(
				run.settings?.sides?.[run.side]?.settle ?? run.settle ?? 'Settle recipe unavailable',
			)
		}}</pre>
		<pre class="mt-2 whitespace-pre-wrap break-all text-xs">{{
			diagnostic(run.tools ?? report.meta.tools ?? 'Tool provenance unavailable')
		}}</pre>
		<pre v-if="run.settingsHash != null" class="mt-2 whitespace-pre-wrap break-all text-xs">{{
			diagnostic(run.settingsHash)
		}}</pre>
	</section>
</template>
