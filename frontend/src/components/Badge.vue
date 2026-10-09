<script setup>
import { computed } from 'vue';
const props = defineProps({ text: { type: String, default: '' } });
const tone = computed(
	() =>
		({
			match: 'badge-match',
			explained: 'badge-explained',
			unexplained: 'badge-unexplained',
			failed: 'badge-unexplained',
			oracle: 'badge-oracle',
		})[props.text] ?? 'text-ui-muted',
);
</script>
<template>
	<span
		:class="tone"
		class="status-badge inline-flex max-w-full rounded-ui-pill border border-ui-border px-2 py-0.5 text-xs font-medium break-words"
		>{{ text }}</span
	>
</template>
