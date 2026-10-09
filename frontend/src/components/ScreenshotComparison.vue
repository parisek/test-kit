<script setup>
import { computed, ref, watch } from 'vue';
import { sameOriginUrl } from '../../../src/report/safe.js';
import EvidenceImage from './EvidenceImage.vue';
const props = defineProps({ screenshot: Object, source: String, targetTitle: String, viewportId: String, mode: { type: String, default: 'side-by-side' }, overlay: { type: Number, default: 50 }, ratio: Number });
const emit = defineEmits(['action']);
const urls = computed(() => Object.fromEntries(['a', 'b', 'diff'].map(side => [side, sameOriginUrl(props.screenshot?.[side]?.src, props.source)])));
const sizes = ref({});
const failures = ref({});
watch(() => [urls.value.a, urls.value.b], () => { sizes.value = {}; failures.value = {}; });
const ready = computed(() => sizes.value.a && sizes.value.b && !failures.value.a && !failures.value.b);
const equal = computed(() => ready.value && sizes.value.a.width === sizes.value.b.width && sizes.value.a.height === sizes.value.b.height);
const regions = computed(() => {
    const entries = props.screenshot?.diff?.regions;
    if (!Array.isArray(entries)) return [];
    return entries.slice(0, 50).filter(region => region && typeof region === 'object' && !Array.isArray(region)
        && [region.x, region.y, region.width ?? region.w, region.height ?? region.h].every(value => Number.isFinite(value) && value >= 0));
});
const ratio = computed(() => Number.isFinite(props.screenshot?.diff?.ratio ?? props.ratio) ? `${(props.screenshot?.diff?.ratio ?? props.ratio).toFixed(3)}%` : 'Not measured');
function failed(side, event) {
    if (event.target.src === urls.value[side]) failures.value = { ...failures.value, [side]: true };
}
function loaded(side, event) {
    if (event.target.src !== urls.value[side]) return;
    if (!event.target.naturalWidth || !event.target.naturalHeight) { failures.value = { ...failures.value, [side]: true }; return; }
    sizes.value = { ...sizes.value, [side]: { width: event.target.naturalWidth, height: event.target.naturalHeight } };
}
</script>
<template>
    <section class="min-w-0" aria-label="Screenshot comparison">
        <p class="sr-only">Pixel difference <span class="font-semibold text-ui-text">{{ ratio }}</span> · A difference measures change. It does not decide acceptance.</p>
        <template v-if="mode === 'overlay'">
            <div class="mb-3 flex flex-wrap items-center gap-3 text-sm">
                <label for="evidence-opacity" class="font-medium">B opacity {{ overlay }}%</label>
                <input id="evidence-opacity" type="range" min="0" max="100" :value="overlay" class="min-w-0 flex-1 accent-ui-active-surface" :disabled="!equal" @input="emit('action', 'overlay', Number($event.target.value))" />
                <a v-for="side in ['a', 'b']" :key="side" v-show="urls[side]" :href="urls[side] ?? undefined" target="_blank" rel="noreferrer" class="text-xs text-ui-muted underline">{{ side.toUpperCase() }} full resolution</a>
            </div>
            <p v-if="!urls.a || !urls.b" role="status" class="mb-3 rounded-ui-panel border border-ui-border p-3 text-sm">Overlay needs both original images. Missing evidence is unclassified.</p>
            <p v-else-if="failures.a || failures.b" role="status" class="mb-3 text-sm text-red-700 dark:text-red-300">An original image is unavailable. Overlay is disabled.</p>
            <p v-else-if="ready && !equal" role="status" class="mb-3 rounded-ui-panel border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">Image dimensions differ: A {{ sizes.a.width }} × {{ sizes.a.height }} px; B {{ sizes.b.width }} × {{ sizes.b.height }} px. Overlay is disabled. Use side by side to preserve each original aspect ratio.</p>
            <p v-else-if="!ready" role="status" class="mb-3 text-sm text-ui-muted">Loading original image dimensions…</p>
            <div v-if="urls.a && urls.b" class="relative min-w-0 overflow-hidden rounded-ui-panel border border-ui-border bg-ui-preview" :class="!equal && 'h-0 border-0'">
                <img :key="urls.a" :src="urls.a" :alt="`A: ${targetTitle}, ${viewportId}`" class="block h-auto w-full" :class="!equal && 'opacity-0'" @load="loaded('a', $event)" @error="failed('a', $event)" />
                <img :key="urls.b" :src="urls.b" :alt="`B: ${targetTitle}, ${viewportId}`" class="absolute top-0 left-0 h-auto w-full" :style="{ opacity: equal ? overlay / 100 : 0 }" @load="loaded('b', $event)" @error="failed('b', $event)" />
            </div>
            <div v-if="ready && !equal || failures.a || failures.b" class="grid min-w-0 gap-4 lg:grid-cols-2">
                <EvidenceImage title="A · Original dimensions" :src="screenshot?.a?.src" :source="source" :target-title="targetTitle" :viewport-id="viewportId" />
                <EvidenceImage title="B · Original dimensions" :src="screenshot?.b?.src" :source="source" :target-title="targetTitle" :viewport-id="viewportId" />
            </div>
        </template>
        <template v-else-if="mode === 'diff'">
            <EvidenceImage title="Pixel difference" :src="screenshot?.diff?.src" :source="source" :target-title="targetTitle" :viewport-id="viewportId" />
            <div v-if="regions.length" class="mt-4 rounded-ui-panel border border-ui-border p-4">
                <h4 class="text-sm font-semibold">Changed regions</h4>
                <p class="mt-1 text-xs text-ui-muted">Coordinates refer to the full-resolution difference image.</p>
                <ol class="mt-3 grid gap-2 sm:grid-cols-2">
                    <li v-for="(region, index) in regions" :key="index" class="rounded-ui-panel bg-ui-toolbar px-3 py-2 text-xs"><span class="font-semibold">Region {{ index + 1 }}</span> · x {{ region.x }}, y {{ region.y }} · {{ region.width ?? region.w }} × {{ region.height ?? region.h }} {{ region.unit ?? 'px' }}<span v-if="Number.isFinite(region.pixels)"> · {{ region.pixels }} changed pixels</span></li>
                </ol>
            </div>
        </template>
        <div v-else class="grid min-w-0 gap-4 lg:grid-cols-2">
            <EvidenceImage title="A · Before" :src="screenshot?.a?.src" :source="source" :target-title="targetTitle" :viewport-id="viewportId" />
            <EvidenceImage title="B · After" :src="screenshot?.b?.src" :source="source" :target-title="targetTitle" :viewport-id="viewportId" />
        </div>
    </section>
</template>
