<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { targetClass, targetState } from '../../src/report/classify.js';
import { useViewer } from './state/useViewer.js';
import TargetDetail from './components/TargetDetail.vue';
import MatrixView from './components/MatrixView.vue';
import FindingsView from './components/FindingsView.vue';
import RunSummary from './components/RunSummary.vue';
import ReportFilters from './components/ReportFilters.vue';
import TimelineView from './components/TimelineView.vue';

const { state, summary, filteredTargets, dispatch, load } = useViewer();
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
const availabilityLabel = target => {
    const states = target.viewports.flatMap(row => ['a', 'b'].map(side => row.availability?.[side]));
    return states.includes('http-error') ? 'HTTP !' : states.includes('capture-error') ? 'Capture !' : null;
};
const views = { detail: 'Detail', matrix: 'Matrix', findings: 'Findings', timeline: 'Timeline' };
const component = computed(
	() =>
		({ detail: TargetDetail, matrix: MatrixView, findings: FindingsView, timeline: TimelineView })[
			state.view
		],
);
const groups = computed(() => {
    const map = new Map();
    for (const target of filteredTargets.value) {
        const group = typeof target.group === 'string' ? target.group : (target.kind === 'component' ? 'Components' : 'Pages');
        if (!map.has(group)) map.set(group, []);
        map.get(group).push(target);
    }
    return [...map].map(([name, targets]) => ({ name, targets }));
});
const targetRatio = target => {
    const ratios = target.viewports.map(row => row.ratio ?? row.artifacts?.screenshot?.diff?.ratio).filter(Number.isFinite);
    const maximum = ratios.length ? Math.max(...ratios) : null;
    if (maximum == null || maximum === 0) {
        const findings = state.report?.findings.filter(finding => finding.targetId === target.id) ?? [];
        const screenshotFindings = findings.filter(finding => finding.artifact === 'screenshot');
        if (screenshotFindings.length) {
            const sizeChanged = target.viewports.some(row => {
                const size = row.artifacts?.screenshot?.diff?.size;
                return screenshotFindings.some(finding => finding.viewportId == null || finding.viewportId === row.id)
                    && size?.a && size?.b && (size.a.width !== size.b.width || size.a.height !== size.b.height);
            });
            return sizeChanged ? 'Size Δ' : 'Screenshot Δ';
        }
        if (findings.some(finding => finding.artifact === 'html')) return 'HTML Δ';
    }
    return maximum == null ? '—' : maximum > 0 && maximum < 0.01 ? '<0.01%' : maximum.toFixed(2) + '%';
};
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
    <div class="app-shell" :class="{ 'sidebar-hidden': state.sidebarHidden }">
        <button v-if="drawerOpen" class="drawer-backdrop" aria-label="Close targets" tabindex="-1" @click="dispatch('sidebar', true)"></button>
        <aside id="sidebar" ref="sidebar" v-show="!state.sidebarHidden" class="viewer-sidebar" :role="drawerOpen ? 'dialog' : undefined" :aria-modal="drawerOpen ? 'true' : undefined" aria-label="Targets">
            <div class="sidebar-brand">
                <div class="brand-mark" aria-hidden="true">t<span>k</span></div>
                <div><strong>test kit<span class="brand-period">.</span></strong><p>Compare. Understand. Improve.</p></div>
                <button class="drawer-close" @click="dispatch('sidebar', true)">Close</button>
            </div>
            <div class="sidebar-section-label">WORKSPACE</div>
            <p class="sidebar-project">{{ state.report?.meta.project ?? 'Local reports' }}</p>
            <div class="sidebar-section-label flex items-center justify-between"><span>TARGETS</span><span>{{ filteredTargets.length }}</span></div>
            <div v-if="state.report" class="sidebar-filters" aria-label="Quick class filters">
                <button v-for="name in ['all', 'unexplained', 'explained', 'match']" :key="name" :aria-pressed="state.filters.classification === name" @click="dispatch('filter', { key: 'classification', value: name })">
                    {{ name === 'all' ? 'All' : name }} <span>{{ name === 'all' ? summary.counts.total : summary.counts[name] }}</span>
                </button>
            </div>
            <div class="sidebar-targets">
                <section v-for="group in groups" :key="group.name">
                    <h2 class="sidebar-group">{{ group.name }} <span>{{ group.targets.length }}</span></h2>
                    <button v-for="target in group.targets" :key="target.id" class="target-row" :class="{ selected: state.targetId === target.id }" :aria-current="state.targetId === target.id ? 'true' : undefined" @click="dispatch('target', target.id)">
                        <span class="status-dot" :data-status="targetState(target) === 'complete' ? targetClass(state.report, target) : targetState(target)"></span>
                        <span class="min-w-0 flex-1"><span class="target-title">{{ target.title ?? target.id }}</span><span class="target-subtitle">{{ targetClass(state.report, target) ?? 'unclassified' }} · {{ targetState(target) }}</span></span>
                        <span class="target-ratio"><span v-if="availabilityLabel(target)" class="sidebar-availability" title="Availability problem">{{ availabilityLabel(target) }}</span>{{ targetRatio(target) }}</span>
                    </button>
                </section>
                <p v-if="!filteredTargets.length" class="px-3 py-4 text-xs text-zinc-400">No targets in this selection.</p>
            </div>
            <div class="sidebar-footer"><span class="status-dot" data-status="match"></span> Local evidence only <kbd>[</kbd></div>
        </aside>
        <div class="shell-main min-w-0" :inert="drawerOpen">
            <header class="viewer-toolbar">
                <button id="sidebar-toggle" aria-label="Targets" ref="toggle" :class="[pill, idle]" :aria-expanded="!state.sidebarHidden" aria-controls="sidebar" @click="dispatch('sidebar')"><span aria-hidden="true">☰</span><span class="target-toggle-label">Targets</span></button>
                <nav aria-label="Report views" class="view-navigation">
                    <button v-for="(title, view) in views" :key="view" :data-view="view" :class="[pill, state.view === view ? active : idle]" :aria-current="state.view === view ? 'page' : undefined" @click="dispatch('view', view)">{{ title }}</button>
                </nav>
                <div class="toolbar-end">
                    <button id="theme" :aria-label="state.theme === 'dark' ? 'Light theme' : 'Dark theme'" :class="[pill, idle]" :aria-pressed="state.theme === 'dark'" @click="dispatch('theme')"><span aria-hidden="true">{{ state.theme === 'dark' ? '☀' : '◐' }}</span><span class="theme-label">{{ state.theme === 'dark' ? 'Light theme' : 'Dark theme' }}</span></button>
                    <details class="source-switch text-xs"><summary class="cursor-pointer rounded-ui-pill px-3 py-2 text-ui-muted">Report source</summary><form id="source-form" class="source-form flex gap-2 rounded-ui-panel border border-ui-border bg-ui-surface p-3" @submit.prevent="load(source)"><label class="flex min-w-0 flex-1 flex-col gap-1" for="source">Report URL<input id="source" v-model="source" class="min-w-0 rounded border border-ui-control-border bg-ui-surface px-2 py-1 text-ui-text" /></label><button type="submit" :class="[pill, idle, 'self-end']">Load</button></form></details>
                </div>
            </header>
            <p id="notice" :class="state.report && !state.loading && state.notice.startsWith('Loaded') ? 'sr-only' : 'viewer-notice'" role="status" aria-live="polite">{{ state.notice }}</p>
            <main id="content" class="viewer-content" :aria-busy="state.loading">
                <template v-if="state.report">
                    <div class="comparison-heading"><div><p class="eyebrow">{{ state.report.pair.kind }} comparison</p><h1>{{ state.report.meta.title ?? 'Comparison' }}</h1></div><span class="local-label"><span class="status-dot" data-status="match"></span> Local report</span></div>
                    <RunSummary :report="state.report" :summary="summary" />
                    <ReportFilters :report="state.report" :filters="state.filters" :count="filteredTargets.length" @action="dispatch" />
                    <component :is="component" :report="state.report" :target-id="state.targetId" :viewport-id="state.viewportId" :source="state.source" :targets="filteredTargets" :filters="state.filters" :artifact-evidence="state.artifactEvidence" :evidence-view="state.evidenceView" :artifact="state.artifact" :comparison="state.comparison" :overlay="state.overlay" @action="dispatch" />
                    <details class="measurement-details"><summary>Measurement context</summary><p>Target states from stored rows (all targets): <span v-for="(count, name) in summary.states" :key="name">{{ name }}: {{ count }} · </span></p><p>Noise floor: {{ state.report.meta.noiseFloor == null ? 'unknown; repeatability is not measured' : JSON.stringify(state.report.meta.noiseFloor) }}. Display hint: {{ state.report.meta.matchBelow }}%. The ratio is not a verdict.</p></details>
                </template>
                <p v-else class="empty-report">Load a local report to inspect its evidence.</p>
            </main>
        </div>
    </div>
</template>
