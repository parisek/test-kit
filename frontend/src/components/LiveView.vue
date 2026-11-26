<script setup>
// R10.17: the Live page. One target of the config on two sides at one viewport, as live pages.
// It shows no class and no verdict: a live look is not evidence (V3).
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import {
	LAYOUTS, ZOOMS, buildLiveHash, frameSource, measureCommand, parseLiveHash, readLiveIndex, resolveLive, scaleFactor, targetsFor, validRatio,
} from '../state/live-link.js';

const props = defineProps({ back: Object });
const emit = defineEmits(['back']);
const index = ref(null);
const failed = ref(false);
const choice = reactive({ targetId: null, sideA: null, sideB: null, viewportId: null, layout: 'swap', zoom: 'fit', show: 'a' });
const notice = ref(null);
const stage = ref(null);
const stageWidth = ref(0);
// Function refs: a ref object inside v-for would collect an array.
const frames = { a: null, b: null };
const setFrame = (side) => (element) => { frames[side] = element; };
const ratio = reactive({ a: 0, b: 0 });
const ready = reactive({ a: false, b: false });
const blocked = reactive({ a: false, b: false });
const copied = ref('');
const timers = {};
let observer = null;

const sideA = computed(() => index.value?.sides.find((side) => side.id === choice.sideA) ?? null);
const sideB = computed(() => index.value?.sides.find((side) => side.id === choice.sideB) ?? null);
const viewport = computed(() => index.value?.viewports.find((entry) => entry.id === choice.viewportId) ?? null);
const targets = computed(() => (index.value ? targetsFor(index.value, choice.sideA, choice.sideB) : []));
const sources = computed(() => ({
	a: index.value ? frameSource(index.value, choice.sideA, choice.targetId) : null,
	b: index.value ? frameSource(index.value, choice.sideB, choice.targetId) : null,
}));
const origins = computed(() => ({ a: sideA.value?.origin ?? null, b: sideB.value?.origin ?? null }));
// R10.17 item 3: side by side, both frames use one factor.
const pane = computed(() => (choice.layout === 'side-by-side' ? Math.max(0, (stageWidth.value - 16) / 2) : stageWidth.value));
const factor = computed(() => (viewport.value ? scaleFactor(choice.zoom, pane.value, viewport.value.width) : 1));
const percent = computed(() => Math.round(factor.value * 100));
const command = computed(() => measureCommand(choice));
const scrollBlocked = computed(() => choice.layout === 'swap' && (blocked.a || blocked.b));
const frameStyle = computed(() => (viewport.value ? { width: `${viewport.value.width}px`, height: `${viewport.value.height}px`, transform: `scale(${factor.value})` } : {}));
const boxStyle = computed(() => (viewport.value ? { width: `${Math.round(viewport.value.width * factor.value)}px`, height: `${Math.round(viewport.value.height * factor.value)}px` } : {}));

function readHash() {
	if (!index.value?.usable) return;
	const resolved = resolveLive(parseLiveHash(location.hash), index.value);
	notice.value = resolved.notice;
	for (const key of Object.keys(choice)) choice[key] = resolved[key];
}
// R10.17 item 5: a change adds one history entry. A swap replaces the current entry.
function write({ replace = false } = {}) {
	const hash = buildLiveHash(choice);
	if (location.hash === hash) return;
	if (replace) history.replaceState(history.state, '', hash);
	else history.pushState(history.state, '', hash);
}
function change(key, value) {
	choice[key] = value;
	if (key === 'sideA' && choice.sideB === value) choice.sideB = index.value.sides.find((side) => side.id !== value)?.id ?? null;
	if (key === 'sideB' && choice.sideA === value) choice.sideA = index.value.sides.find((side) => side.id !== value)?.id ?? null;
	if (!targets.value.some((target) => target.id === choice.targetId)) choice.targetId = targets.value[0]?.id ?? null;
	notice.value = null;
	write();
}
function post(side, message) {
	const win = frames[side]?.contentWindow;
	if (win && origins.value[side]) win.postMessage(message, origins.value[side]);
}
// The scroll position carries over as a ratio of the page height (R10.17 item 2).
function swap() {
	if (choice.layout !== 'swap') return;
	const from = choice.show;
	const to = from === 'a' ? 'b' : 'a';
	choice.show = to;
	post(to, { type: 'test-kit/live-scroll-to', ratio: ratio[from] });
	write({ replace: true });
}
// R10.18 item 6: accept a message only from the origin and the window of that frame.
function onMessage(event) {
	for (const side of ['a', 'b']) {
		if (!origins.value[side] || event.origin !== origins.value[side] || event.source !== frames[side]?.contentWindow) continue;
		const data = event.data;
		if (data?.type === 'test-kit/live-ready') { ready[side] = true; blocked[side] = false; }
		if (data?.type === 'test-kit/live-scroll' && validRatio(data.ratio)) ratio[side] = data.ratio;
		return;
	}
}
// A page whose policy blocks the scroll script never says it is ready.
function loaded(side) {
	clearTimeout(timers[side]);
	timers[side] = setTimeout(() => { if (!ready[side]) blocked[side] = true; }, 2000);
}
// R10.17 item 2: the space bar swaps only outside a form control, a link and a frame.
function onKey(event) {
	if (event.key !== ' ' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || choice.layout !== 'swap') return;
	if (event.target?.closest?.('input, textarea, select, button, a, iframe, [contenteditable]:not([contenteditable="false"])')) return;
	event.preventDefault();
	swap();
}
async function copy() {
	try {
		await navigator.clipboard.writeText(command.value);
		copied.value = 'Copied.';
	} catch {
		copied.value = 'Copy is not available. Select the text and copy it.';
	}
}
watch(() => [choice.targetId, choice.sideA, choice.sideB, choice.viewportId], () => {
	for (const side of ['a', 'b']) { ready[side] = false; blocked[side] = false; ratio[side] = 0; }
});
const onHash = () => readHash();
onMounted(async () => {
	window.addEventListener('message', onMessage);
	window.addEventListener('hashchange', onHash);
	window.addEventListener('popstate', onHash);
	document.addEventListener('keydown', onKey);
	try {
		const response = await fetch(new URL('live.json', location.href), { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
		if (!response.ok || !/^application\/json\b/.test(response.headers.get('content-type') ?? '')) throw new Error('no live.json');
		index.value = readLiveIndex(await response.json());
		if (!index.value?.usable) throw new Error('unusable');
		readHash();
		write({ replace: true });
	} catch {
		failed.value = true;
	}
	await nextTick();
	if (stage.value && typeof ResizeObserver === 'function') {
		observer = new ResizeObserver(([entry]) => { stageWidth.value = entry.contentRect.width; });
		observer.observe(stage.value);
	}
});
onUnmounted(() => {
	window.removeEventListener('message', onMessage);
	window.removeEventListener('hashchange', onHash);
	window.removeEventListener('popstate', onHash);
	document.removeEventListener('keydown', onKey);
	observer?.disconnect();
	for (const timer of Object.values(timers)) clearTimeout(timer);
});
watch(stage, (element) => {
	if (!element || observer || typeof ResizeObserver !== 'function') return;
	observer = new ResizeObserver(([entry]) => { stageWidth.value = entry.contentRect.width; });
	observer.observe(element);
});
const pill = 'inline-flex h-ui-control items-center justify-center gap-1.5 rounded-ui-pill border px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-focus';
const idle = 'border-ui-control-border bg-ui-surface text-ui-muted hover:border-ui-control-hover-border hover:text-ui-text';
const select = 'min-w-0 rounded border border-ui-control-border bg-ui-surface px-2 py-1 text-sm text-ui-text';
</script>

<template>
	<section class="live-page" aria-labelledby="live-title">
		<nav class="breadcrumb" aria-label="Breadcrumb"><ol>
			<li><a href="#" @click.prevent="emit('back')">{{ props.back?.label ?? 'Back' }}</a></li>
			<li aria-current="page">Live</li>
		</ol></nav>
		<div class="comparison-heading"><div><p class="eyebrow">Live pages, not evidence</p><h1 id="live-title" tabindex="-1">Live</h1></div></div>
		<div v-if="failed" class="live-missing">
			<p>The live proxy does not run for this viewer. Start the report server with the live proxy:</p>
			<pre><code>test-kit serve REPORT --live</code></pre>
		</div>
		<template v-else-if="index?.usable">
			<p v-if="notice" class="viewer-notice" role="status">{{ notice }}</p>
			<form class="live-pickers" @submit.prevent>
				<label>Target <select :class="select" :value="choice.targetId" @change="change('targetId', $event.target.value)"><option v-for="target in targets" :key="target.id" :value="target.id">{{ target.id }}</option></select></label>
				<label>Side A <select :class="select" :value="choice.sideA" @change="change('sideA', $event.target.value)"><option v-for="side in index.sides" :key="side.id" :value="side.id">{{ side.id }}</option></select></label>
				<label>Side B <select :class="select" :value="choice.sideB" @change="change('sideB', $event.target.value)"><option v-for="side in index.sides" :key="side.id" :value="side.id">{{ side.id }}</option></select></label>
				<label>Viewport <select :class="select" :value="choice.viewportId" @change="change('viewportId', $event.target.value)"><option v-for="entry in index.viewports" :key="entry.id" :value="entry.id">{{ entry.id }}</option></select></label>
				<label>Layout <select :class="select" :value="choice.layout" @change="change('layout', $event.target.value)"><option v-for="layout in LAYOUTS" :key="layout" :value="layout">{{ layout }}</option></select></label>
				<label>Zoom <select :class="select" :value="choice.zoom" @change="change('zoom', $event.target.value)"><option v-for="zoom in ZOOMS" :key="zoom" :value="zoom">{{ zoom === 'fit' ? 'fit' : zoom + ' %' }}</option></select></label>
			</form>
			<div class="live-bar">
				<p v-if="viewport" class="live-scale">{{ viewport.id }} · {{ viewport.width }} px at {{ percent }} %</p>
				<p v-if="choice.layout === 'swap'" class="live-showing">Showing side {{ choice.show === 'a' ? 'A' : 'B' }}: {{ choice.show === 'a' ? choice.sideA : choice.sideB }}</p>
				<button v-if="choice.layout === 'swap'" type="button" :class="[pill, idle]" @click="swap">Swap sides <kbd>Space</kbd></button>
			</div>
			<p v-if="scrollBlocked" class="live-note">The page blocks the scroll script, so a swap does not carry the scroll position.</p>
			<p v-if="!targets.length" class="live-note">No target has a path on both picked sides.</p>
			<div ref="stage" class="live-stage" :data-layout="choice.layout">
				<figure v-for="side in ['a', 'b']" :key="side" class="live-pane" :hidden="choice.layout === 'swap' && choice.show !== side">
					<figcaption>Side {{ side === 'a' ? 'A' : 'B' }}: {{ side === 'a' ? choice.sideA : choice.sideB }}</figcaption>
					<div class="live-box" :style="boxStyle">
						<iframe v-if="sources[side]" :ref="setFrame(side)" :key="sources[side] + choice.viewportId" class="live-frame" :style="frameStyle" :src="sources[side]" :title="`Side ${side === 'a' ? 'A' : 'B'}: ${side === 'a' ? choice.sideA : choice.sideB}`" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="no-referrer" @load="loaded(side)"></iframe>
					</div>
				</figure>
			</div>
			<section v-if="command" class="live-measure" aria-labelledby="measure-title">
				<h2 id="measure-title">Measure this view</h2>
				<p>Copy the command and run it in the project. <code>before</code> replaces the stored baseline of this selection. Copying runs nothing and stores nothing.</p>
				<pre><code>{{ command }}</code></pre>
				<button type="button" :class="[pill, idle]" @click="copy">Copy command</button>
				<span role="status" class="live-copied">{{ copied }}</span>
			</section>
		</template>
		<p v-else class="viewer-notice" role="status">Loading the live sides.</p>
	</section>
</template>
