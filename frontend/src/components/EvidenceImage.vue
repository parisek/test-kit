<script setup>
import { computed, ref, watch } from 'vue';
import { sameOriginUrl } from '../../../src/report/safe.js';
const props = defineProps({ src: String, source: String, title: String, targetTitle: String, viewportId: String });
const url = computed(() => sameOriginUrl(props.src, props.source));
const failed = ref(false);
const dimensions = ref(null);
watch(url, () => { failed.value = false; dimensions.value = null; });
function imageError(event) { if (event.target.src === url.value) failed.value = true; }
function imageLoaded(event) { if (event.target.src === url.value) dimensions.value = `${event.target.naturalWidth} × ${event.target.naturalHeight} px`; }
</script>
<template>
    <figure class="min-w-0 overflow-hidden rounded-ui-panel border border-ui-border bg-ui-preview">
        <figcaption class="flex flex-wrap items-center justify-between gap-2 border-b border-ui-border bg-ui-surface px-3 py-2">
            <span class="text-xs font-semibold">{{ title }}<span v-if="dimensions" class="ml-2 font-normal text-ui-muted">{{ dimensions }}</span></span>
            <a v-if="url" :href="url" target="_blank" rel="noreferrer" class="text-xs text-ui-muted underline focus-visible:outline-ui-focus">Open full resolution</a>
        </figcaption>
        <img v-if="url && !failed" :key="url" :src="url" :alt="`${title}: ${targetTitle}, ${viewportId}`" loading="lazy" class="block h-auto w-full" @error="imageError" @load="imageLoaded" />
        <p v-else class="px-4 py-10 text-center text-sm text-ui-muted">{{ failed ? 'Image is unavailable.' : 'No image evidence.' }}</p>
    </figure>
</template>
