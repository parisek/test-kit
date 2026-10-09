<script setup>
import { computed } from 'vue';
const props = defineProps({ text: { type: String, default: '' } });
const tone = computed(
	() =>
		({
			match: 'text-emerald-700 dark:text-emerald-300',
			explained: 'text-sky-700 dark:text-sky-300',
			unexplained: 'text-red-700 dark:text-red-300',
			failed: 'text-red-700 dark:text-red-300',
			oracle: 'text-violet-700 dark:text-violet-300',
		})[props.text] ?? 'text-ui-muted',
);
</script>
<template>
	<span
		:class="tone"
		class="inline-flex max-w-full rounded-ui-pill border border-ui-border px-2 py-0.5 text-xs font-medium break-words"
		>{{ text }}</span
	>
</template>
