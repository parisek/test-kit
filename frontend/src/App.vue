<script setup>
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue';
import { targetClass, targetState } from '../../src/report/classify.js';
import { useViewer } from './state/useViewer.js';
import TargetDetail from './components/TargetDetail.vue';
import MatrixView from './components/MatrixView.vue';
import FindingsView from './components/FindingsView.vue';
import RunSummary from './components/RunSummary.vue';
import ReportFilters from './components/ReportFilters.vue';
import IndexView from './components/IndexView.vue';
import TimelineView from './components/TimelineView.vue';
import { anchorFor } from './state/index-list.js';
import { localDateTime, reportNeighbors } from './state/report-nav.js';

const { state, summary, filteredTargets, dispatch, loadSource, start, openReport, applyHash } = useViewer();
// The decision actions of a finding build a link to the open report.
provide('reportId', computed(() => state.reportId));
// R10.14: Back, Forward and an edited hash apply the link.
const onHashChange = () => applyHash();
const source = ref('report.json');
const sidebar = ref(null);
const indexView = ref(null);
const reportHeading = ref(null);
const toggle = ref(null);
const phone = ref(innerWidth <= 860);
const mounted = ref(false);
// The Home has no side panel and no report views (DESIGN.md "Layout").
const home = computed(() => !state.report && Boolean(state.index));
const neighbors = computed(() => (state.index && state.reportId ? reportNeighbors(state.index.reports, state.reportId) : null));
const reportTime = computed(() => localDateTime(state.report?.meta.generated));
// The page title carries the report date (#148).
watch(
	() => [state.report, reportTime.value, home.value],
	() => {
		if (state.report) document.title = `${state.report.meta.title ?? 'Comparison'}${reportTime.value ? ' · ' + reportTime.value : ''} · test kit`;
		else document.title = home.value ? 'Comparisons · test kit' : 'test kit';
	},
	{ immediate: true },
);
const drawerOpen = computed(() => mounted.value && phone.value && !state.sidebarHidden && targetPanel.value);
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
// R10.4: four views. Content and speed are evidence types of the Evidence view.
const views = { overview: 'Overview', evidence: 'Evidence', findings: 'Findings', info: 'Run info' };
const component = computed(
	() => ({ overview: MatrixView, evidence: TargetDetail, findings: FindingsView, info: TimelineView })[state.view],
);
// The target list is a panel inside the Evidence view only (DESIGN.md "Layout").
const targetPanel = computed(() => Boolean(state.report) && state.view === 'evidence');
// Tabs: arrow keys move between them (WAI-ARIA tabs pattern).
function tabKey(event) {
	const order = Object.keys(views);
	const at = order.indexOf(state.view);
	// A modified key keeps its browser meaning (Alt+Left is Back).
	if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
	const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: order.length - 1 }[event.key];
	if (next === undefined) return;
	event.preventDefault();
	const view = order[(next + order.length) % order.length];
	dispatch('view', view);
	nextTick(() => document.querySelector(`[role=tab][data-view="${view}"]`)?.focus());
}
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
async function open(id) {
	const result = await openReport(id);
	if (!result.ok) return;
	await nextTick();
	reportHeading.value?.focus();
}
async function back() {
	dispatch('close-report');
	await nextTick();
	indexView.value?.focus();
}
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
		!targetPanel.value ||
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
	window.addEventListener('hashchange', onHashChange);
	start(source.value);
});
onUnmounted(() => {
	document.removeEventListener('keydown', keydown);
	window.removeEventListener('resize', resize);
	window.removeEventListener('hashchange', onHashChange);
	restoreScroll();
});
</script>

<template>
    <div class="app-shell" :class="{ 'sidebar-hidden': state.sidebarHidden || !targetPanel}">
        <button v-if="drawerOpen" class="drawer-backdrop" aria-label="Close targets" tabindex="-1" @click="dispatch('sidebar', true)"></button>
        <aside v-if="targetPanel" id="sidebar" ref="sidebar" v-show="!state.sidebarHidden" class="viewer-sidebar" :role="drawerOpen ? 'dialog' : undefined" :aria-modal="drawerOpen ? 'true' : undefined" aria-label="Targets">
            <div class="sidebar-brand">
                <div class="brand-mark" aria-hidden="true">t<span>k</span></div>
                <div><strong>test kit<span class="brand-period">.</span></strong><p>Compare. Understand. Improve.</p></div>
                <button class="drawer-close" @click="dispatch('sidebar', true)">Close</button>
            </div>
            <div class="sidebar-section-label">WORKSPACE</div>
            <p class="sidebar-project">{{ state.report?.meta.project ?? 'Local reports' }}</p>
            <div class="sidebar-section-label flex items-center justify-between"><span>TARGETS</span><span>{{ filteredTargets.length }}</span></div>
            <div class="sidebar-targets">
                <section v-for="group in groups" :key="group.name">
                    <h2 class="sidebar-group">{{ group.name }} <span>{{ group.targets.length }}</span></h2>
                    <button v-for="target in group.targets" :key="target.id" class="target-row" :class="{ selected: state.targetId === target.id }" :aria-current="state.targetId === target.id ? 'true' : undefined" @click="dispatch('target', target.id)">
                        <span class="status-dot" :data-status="targetState(target) === 'complete' ? targetClass(state.report, target) : targetState(target)"></span>
                        <span class="min-w-0 flex-1"><span class="target-title">{{ target.title ?? target.id }}</span><span class="target-subtitle">{{ targetClass(state.report, target) ?? 'unclassified' }} · {{ targetState(target) }}</span></span>
                        <span class="target-ratio"><span v-if="availabilityLabel(target)" :data-availability="availabilityLabel(target) === 'Capture !' ? 'capture-error' : 'http-error'" class="sidebar-availability" title="Availability problem">{{ availabilityLabel(target) }}</span>{{ targetRatio(target) }}</span>
                    </button>
                </section>
                <p v-if="!filteredTargets.length" class="px-3 py-4 text-xs text-zinc-400">No targets in this selection.</p>
            </div>
            <div class="sidebar-footer"><span class="status-dot" data-status="match"></span> Local evidence only <kbd>[</kbd></div>
        </aside>
        <div class="shell-main min-w-0" :inert="drawerOpen">
            <header class="viewer-toolbar">
                <p v-if="!targetPanel" class="header-brand"><span class="header-mark" aria-hidden="true">tk</span><strong>test kit</strong></p>
                <button v-if="targetPanel" id="sidebar-toggle" aria-label="Targets" ref="toggle" :class="[pill, idle]" :aria-expanded="!state.sidebarHidden" aria-controls="sidebar" @click="dispatch('sidebar')"><span aria-hidden="true">☰</span><span class="target-toggle-label">Targets</span></button>
                <div class="toolbar-end">
                    <button id="theme" :aria-label="state.theme === 'dark' ? 'Light theme' : 'Dark theme'" :class="[pill, idle]" :aria-pressed="state.theme === 'dark'" @click="dispatch('theme')"><span aria-hidden="true">{{ state.theme === 'dark' ? '☀' : '◐' }}</span><span class="theme-label">{{ state.theme === 'dark' ? 'Light theme' : 'Dark theme' }}</span></button>
                </div>
            </header>
            <p id="notice" :class="state.report && !state.loading && state.notice.startsWith('Loaded') ? 'sr-only' : 'viewer-notice'" role="status" aria-live="polite">{{ state.notice }}</p>
            <main id="content" class="viewer-content" :aria-busy="state.loading">
                <template v-if="state.report">
                    <nav v-if="state.index || state.view === 'evidence'" class="breadcrumb" aria-label="Breadcrumb"><ol>
                        <li v-if="state.index"><a href="#" @click.prevent="back">Comparisons</a></li>
                        <li v-if="state.view === 'evidence'"><a href="#" @click.prevent="dispatch('view', 'overview')">{{ state.report.meta.title ?? 'Comparison' }}: Overview</a></li>
                        <li v-else aria-current="page">{{ state.report.meta.title ?? 'Comparison' }}</li>
                        <li v-if="state.view === 'evidence'" aria-current="page">Evidence</li>
                    </ol></nav>
                    <div class="comparison-heading"><div><p class="eyebrow">{{ state.report.pair.kind }} comparison</p><h1 ref="reportHeading" tabindex="-1">{{ state.report.meta.title ?? 'Comparison' }}</h1><p class="report-time"><time v-if="reportTime" :datetime="state.report.meta.generated" :title="state.report.meta.generated">{{ reportTime }}</time><template v-else>Time unknown</template></p></div><span class="local-label"><span class="status-dot" data-status="match"></span> Local report</span></div>
                    <nav v-if="neighbors" class="report-order" aria-label="Comparison order">
                        <a v-if="neighbors.older" :href="anchorFor(neighbors.older.id)" @click.prevent="open(neighbors.older.id)">Older</a><span v-else class="report-order-end">Older</span>
                        <span class="record">{{ neighbors.position }} of {{ neighbors.total }}</span>
                        <a v-if="neighbors.newer" :href="anchorFor(neighbors.newer.id)" @click.prevent="open(neighbors.newer.id)">Newer</a><span v-else class="report-order-end">Newer</span>
                    </nav>
                    <RunSummary :report="state.report" :summary="summary" />
                    <ReportFilters :report="state.report" :filters="state.filters" :count="filteredTargets.length" @action="dispatch" />
 <div role="tablist" aria-label="Report views" class="report-tabs" @keydown="tabKey">
                        <button v-for="(title, view) in views" :key="view" :id="'tab-' + view" role="tab" :data-view="view" :aria-selected="state.view === view ? 'true' : 'false'" aria-controls="report-view" :tabindex="state.view === view ? 0 : -1" @click="dispatch('view', view)">{{ title }}</button>
                    </div>
                    <div id="report-view" role="tabpanel" :aria-labelledby="'tab-' + state.view">
                    <component :is="component" :report="state.report" :target-id="state.targetId" :viewport-id="state.viewportId" :source="state.source" :targets="filteredTargets" :filters="state.filters" :artifact-evidence="state.artifactEvidence" :evidence-view="state.evidenceView" :artifact="state.artifact" :comparison="state.comparison" :overlay="state.overlay" @action="dispatch" />
                    </div>
                    <details class="measurement-details"><summary>Measurement context</summary><p>Target states from stored rows (all targets): <span v-for="(count, name) in summary.states" :key="name">{{ name }}: {{ count }} · </span></p><p>Noise floor: {{ state.report.meta.noiseFloor == null ? 'unknown; repeatability is not measured' : JSON.stringify(state.report.meta.noiseFloor) }}. Display hint: {{ state.report.meta.matchBelow }}%. The ratio is not a verdict.</p></details>
                </template>
                <IndexView v-else-if="state.index" ref="indexView" :index="state.index" @open="open" />
                <section v-else-if="state.sourcesMissing" class="open-report" aria-labelledby="open-title">
                    <h1 id="open-title">Open a report</h1>
                    <p class="home-meta">This page found no <code>report.json</code> and no <code>index.json</code> next to it. Enter the path of a report on this site.</p>
                    <form id="source-form" class="source-form" @submit.prevent="loadSource(source)"><label for="source">Report path</label><input id="source" v-model="source" class="min-w-0 rounded border border-ui-control-border bg-ui-surface px-2 py-1 text-ui-text" /><button type="submit" :class="[pill, idle]">Open</button></form>
                </section>
                <p v-else-if="!state.loading" class="empty-report">No report is open.</p>
            </main>
        </div>
    </div>
</template>
