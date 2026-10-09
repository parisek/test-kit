<script setup>
import { computed, ref, watch } from 'vue';
import { sameOriginUrl } from '../../../src/report/safe.js';
const props = defineProps({
	src: String,
	source: String,
	title: String,
	targetTitle: String,
	viewportId: String,
});
const url = computed(() => sameOriginUrl(props.src, props.source));
const failed = ref(false);
watch(url, () => {
	failed.value = false;
});
</script>
<template>
	<figure class="min-w-0 rounded-ui-panel border border-ui-border bg-ui-surface p-3">
		<figcaption class="mb-2 text-sm font-semibold">{{ title }}</figcaption>
		<template v-if="url && !failed"
			><a
				:href="url"
				class="mb-2 inline-block text-xs text-ui-muted underline focus-visible:outline-ui-focus"
				>Open full resolution</a
			><img
				:src="url"
				:alt="`${title}: ${targetTitle}, ${viewportId}`"
				loading="lazy"
				class="block h-auto max-w-full border border-ui-border"
				@error="failed = true"
		/></template>
		<p v-else class="text-sm text-ui-muted">
			{{ failed ? 'Image is unavailable.' : 'No image evidence.' }}
		</p>
	</figure>
</template>
