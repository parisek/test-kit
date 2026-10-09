<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { targetClass, targetState } from '../../src/report/classify.js';
import { useViewer } from './state/useViewer.js';
import TargetDetail from './components/TargetDetail.vue';
import MatrixView from './components/MatrixView.vue';
import FindingsView from './components/FindingsView.vue';
import TimelineView from './components/TimelineView.vue';

const { state, summary, dispatch, load } = useViewer();
const source = ref('/report.json');
const sidebar = ref(null);
const toggle = ref(null);
const phone = ref(innerWidth <= 860);
const mounted = ref(false);
const drawerOpen = computed(() => mounted.value && phone.value && !state.sidebarHidden);
let previousOverflow = null;
let previousFocus = null;
function resize() {
	phone.value = innerWidth <= 860;
}
function restoreScroll() {
	if (previousOverflow !== null) {
		document.body.style.overflow = previousOverflow;
		previousOverflow = null;
	}
}
const views = { detail: 'Detail', matrix: 'Matrix', findings: 'Findings', timeline: 'Timeline' };
const component = computed(
	() =>
		({ detail: TargetDetail, matrix: MatrixView, findings: FindingsView, timeline: TimelineView })[
			state.view
		],
);
const pill =
	'inline-flex h-ui-control items-center justify-center gap-1.5 rounded-ui-pill border px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-focus';
const idle =
	'border-ui-control-border bg-ui-surface text-ui-muted hover:border-ui-control-hover-border hover:text-ui-text';
const active = 'border-ui-active-surface bg-ui-active-surface text-ui-active-text';
watch(
	() => state.theme,
	(theme) => {
		document.documentElement.classList.toggle('dark', theme === 'dark');
		document.documentElement.dataset.theme = theme;
	},
	{ immediate: true },
);
watch(drawerOpen, async (open) => {
	if (open) {
		previousFocus = document.activeElement;
		previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		await nextTick();
		if (drawerOpen.value) sidebar.value?.querySelector('button')?.focus();
	} else {
		restoreScroll();
		await nextTick();
		if (!drawerOpen.value) {
			const focus =
				previousFocus?.isConnected &&
				previousFocus !== document.body &&
				previousFocus !== document.documentElement &&
				!sidebar.value?.contains(previousFocus)
					? previousFocus
					: toggle.value;
			focus?.focus();
			previousFocus = null;
		}
	}
});
function keydown(event) {
	if (event.key === 'Escape' && drawerOpen.value) {
		event.preventDefault();
		dispatch('sidebar', true);
		return;
	}
	if (event.key === 'Tab' && drawerOpen.value) {
		const controls = [
			...(sidebar.value?.querySelectorAll('button, a[href], input, select, [tabindex="0"]') ?? []),
		];
		const first = controls[0];
		const last = controls.at(-1);
		if (
			first &&
			event.shiftKey &&
			(document.activeElement === first || !sidebar.value?.contains(document.activeElement))
		) {
			event.preventDefault();
			last.focus();
		} else if (
			last &&
			!event.shiftKey &&
			(document.activeElement === last || !sidebar.value?.contains(document.activeElement))
		) {
			event.preventDefault();
			first.focus();
		}
	}
	if (
		event.key !== '[' ||
		event.ctrlKey ||
		event.metaKey ||
		event.altKey ||
		event.target?.closest?.(
			'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
		)
	)
		return;
	event.preventDefault();
	dispatch('sidebar');
}
onMounted(() => {
	resize();
	mounted.value = true;
	document.addEventListener('keydown', keydown);
	window.addEventListener('resize', resize);
	load(source.value);
});
onUnmounted(() => {
	document.removeEventListener('keydown', keydown);
	window.removeEventListener('resize', resize);
	restoreScroll();
});
</script>

<template>
	<div class="min-h-screen bg-ui-surface text-ui-text">
		<header
			:inert="drawerOpen"
			class="flex min-h-ui-toolbar flex-wrap items-center gap-2 border-b border-ui-border bg-ui-toolbar px-3 py-2"
		>
			<button
				id="sidebar-toggle"
				ref="toggle"
				:class="[pill, idle]"
				:aria-expanded="!state.sidebarHidden"
				aria-controls="sidebar"
				@click="dispatch('sidebar')"
			>
				Targets
			</button>
			<span class="mr-2 text-sm font-semibold">Test kit</span>
			<nav aria-label="Report views" class="flex flex-wrap gap-1">
				<button
					v-for="(title, view) in views"
					:key="view"
					:data-view="view"
					:class="[pill, state.view === view ? active : idle]"
					:aria-current="state.view === view ? 'page' : undefined"
					@click="dispatch('view', view)"
				>
					{{ title }}
				</button>
			</nav>
			<button
				id="theme"
				:class="[pill, idle, 'ml-auto']"
				:aria-pressed="state.theme === 'dark'"
				@click="dispatch('theme')"
			>
				{{ state.theme === 'dark' ? 'Light theme' : 'Dark theme' }}
			</button>
			<details class="source-switch text-xs">
				<summary class="cursor-pointer rounded-ui-pill px-3 py-2 text-ui-muted">
					Report source
				</summary>
				<form
					id="source-form"
					class="source-form flex gap-2 rounded-ui-panel border border-ui-border bg-ui-surface p-3"
					@submit.prevent="load(source)"
				>
					<label class="flex min-w-0 flex-1 flex-col gap-1" for="source"
						>Report URL<input
							id="source"
							v-model="source"
							class="min-w-0 rounded border border-ui-control-border bg-ui-surface px-2 py-1 text-ui-text"
					/></label>
					<button type="submit" :class="[pill, idle, 'self-end']">Load</button>
				</form>
			</details>
		</header>
		<p
			:inert="drawerOpen"
			id="notice"
			class="border-b border-ui-border px-4 py-2 text-xs text-ui-muted"
			role="status"
			aria-live="polite"
		>
			{{ state.notice }}
		</p>
		<div class="viewer-layout" :class="{ 'sidebar-hidden': state.sidebarHidden }">
			<button
				v-if="drawerOpen"
				class="drawer-backdrop"
				aria-label="Close targets"
				tabindex="-1"
				@click="dispatch('sidebar', true)"
			></button>
			<aside
				id="sidebar"
				ref="sidebar"
				v-show="!state.sidebarHidden"
				class="viewer-sidebar border-r border-ui-border bg-ui-toolbar p-3"
				:role="drawerOpen ? 'dialog' : undefined"
				:aria-modal="drawerOpen ? 'true' : undefined"
				aria-label="Targets"
			>
				<div class="mb-3 flex items-center justify-between">
					<h2 class="text-xs font-semibold uppercase tracking-wide text-ui-muted">Targets</h2>
					<button class="drawer-close" :class="[pill, idle]" @click="dispatch('sidebar', true)">
						Close
					</button>
				</div>
				<div class="flex flex-col gap-1">
					<button
						v-for="target in state.report?.entries ?? []"
						:key="target.id"
						class="min-w-0 rounded-ui-panel border p-2 text-left text-xs focus-visible:outline-2 focus-visible:outline-ui-focus"
						:class="
							state.targetId === target.id
								? 'border-ui-control-border bg-ui-surface'
								: 'border-transparent hover:border-ui-border'
						"
						:aria-current="state.targetId === target.id ? 'true' : undefined"
						@click="dispatch('target', target.id)"
					>
						<span class="block break-words font-semibold">{{ target.title ?? target.id }}</span>
						<span class="mt-1 block text-ui-muted"
							>{{ targetClass(state.report, target) ?? 'unclassified' }} ·
							{{ targetState(target) }}</span
						>
					</button>
				</div>
			</aside>
			<main
				:inert="drawerOpen"
				id="content"
				class="min-w-0 space-y-4 p-3 sm:p-5"
				:aria-busy="state.loading"
			>
				<template v-if="state.report">
					<section class="rounded-ui-panel border border-ui-border p-4">
						<h1 class="break-words text-xl font-semibold">
							{{ state.report.meta.title ?? 'Comparison' }}
						</h1>
						<p class="mt-1 break-words text-xs text-ui-muted">
							{{ state.report.pair.kind }}: {{ state.report.pair.aRunId }} →
							{{ state.report.pair.bRunId }}
						</p>
						<div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
							<span v-for="(count, name) in summary.counts" :key="name"
								>{{ name }}: <strong>{{ count }}</strong></span
							>
						</div>
						<p class="mt-3 text-xs text-ui-muted">
							Noise floor:
							{{
								state.report.meta.noiseFloor == null
									? 'unknown; repeatability is not measured'
									: JSON.stringify(state.report.meta.noiseFloor)
							}}. Display hint: {{ state.report.meta.matchBelow }}%. The ratio is not a verdict.
						</p>
					</section>
					<component
						:is="component"
						:report="state.report"
						:target-id="state.targetId"
						:viewport-id="state.viewportId"
						:source="state.source"
						@action="dispatch"
					/>
				</template>
				<p v-else class="text-sm text-ui-muted">Load a local report to inspect its evidence.</p>
			</main>
		</div>
	</div>
</template>

<style scoped>
.viewer-layout {
	display: grid;
	grid-template-columns: 16rem minmax(0, 1fr);
}
.viewer-layout.sidebar-hidden {
	grid-template-columns: minmax(0, 1fr);
}
.viewer-sidebar {
	min-width: 0;
}
.drawer-backdrop,
.drawer-close {
	display: none;
}
.source-switch {
	position: relative;
}
.source-form {
	position: absolute;
	top: 100%;
	right: 0;
	z-index: 30;
	width: min(26rem, calc(100vw - 2rem));
}
@media (max-width: 860px) {
	.viewer-layout {
		grid-template-columns: minmax(0, 1fr);
	}
	.viewer-sidebar {
		position: fixed;
		inset: 0 auto 0 0;
		z-index: 50;
		width: min(20rem, 85vw);
		overflow-y: auto;
	}
	.drawer-backdrop {
		display: block;
		position: fixed;
		inset: 0;
		z-index: 40;
		background: rgb(0 0 0 / 40%);
	}
	.drawer-close {
		display: inline-flex;
	}
}
</style>
