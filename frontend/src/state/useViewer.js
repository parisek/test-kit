import { computed, markRaw, readonly, shallowReactive } from 'vue';
import { adaptReport } from '../../../src/report/model.js';
import { summarize } from '../../../src/report/classify.js';
import { sameOriginUrl } from '../../../src/report/safe.js';

export const FIRST_VIEW = Object.freeze({
	convergence: 'detail',
	'self-baseline': 'matrix',
	update: 'findings',
	migration: 'findings',
	deploy: 'matrix',
	adhoc: 'detail',
});
const VIEWS = ['detail', 'matrix', 'findings', 'timeline'];

export function useViewer(options = {}) {
	const browser = options.browser ?? globalThis.window;
	const base = options.base ?? browser?.location?.href;
	const fetchReport = options.fetch ?? globalThis.fetch;
	const width = () => options.width?.() ?? browser?.innerWidth ?? 1280;
	function stored(key) {
		try {
			return (options.storage ?? browser?.localStorage)?.getItem(key);
		} catch {
			return null;
		}
	}
	function persist(key, value) {
		try {
			(options.storage ?? browser?.localStorage)?.setItem(key, value);
		} catch {
			/* Storage is optional (R10.9). */
		}
	}
	const preference = stored('test-kit-sidebar');
	const state = shallowReactive({
		report: null,
		source: null,
		targetId: null,
		viewportId: null,
		view: 'detail',
		sidebarHidden: preference == null ? width() <= 860 : preference === 'hidden',
		theme: stored('test-kit-theme') === 'dark' ? 'dark' : 'light',
		notice: '',
		loading: false,
	});
	let requestId = 0;
	const summary = computed(() => (state.report ? summarize(state.report) : null));
	const selectedTarget = computed(
		() => state.report?.entries.find((target) => target.id === state.targetId) ?? null,
	);
	const selectedRow = computed(
		() => selectedTarget.value?.viewports.find((row) => row.id === state.viewportId) ?? null,
	);

	function dispatch(action, value) {
		if (action === 'sidebar') {
			state.sidebarHidden = typeof value === 'boolean' ? value : !state.sidebarHidden;
			persist('test-kit-sidebar', state.sidebarHidden ? 'hidden' : 'visible');
		} else if (action === 'theme') {
			state.theme = state.theme === 'light' ? 'dark' : 'light';
			persist('test-kit-theme', state.theme);
		} else if (action === 'view' && VIEWS.includes(value)) state.view = value;
		else if (action === 'target') {
			const target = state.report?.entries.find((target) => target.id === value);
			if (!target) return;
			state.targetId = target.id;
			state.viewportId = target.viewports[0]?.id ?? null;
			state.view = 'detail';
			if (width() <= 860) dispatch('sidebar', true);
		} else if (
			action === 'viewport' &&
			selectedTarget.value?.viewports.some((row) => row.id === value)
		)
			state.viewportId = value;
		else if (action === 'loaded') {
			state.report = markRaw(value.report);
			state.source = value.source;
			state.targetId = value.report.entries[0]?.id ?? null;
			state.viewportId = value.report.entries[0]?.viewports[0]?.id ?? null;
			state.view = FIRST_VIEW[value.report.pair.kind];
			state.loading = false;
			state.notice = `Loaded ${value.report.entries.length} targets.`;
		} else if (action === 'loading') {
			state.loading = true;
			state.notice = 'Loading report…';
		} else if (action === 'error') {
			state.loading = false;
			state.notice = value;
		}
	}

	async function load(source) {
		const id = ++requestId;
		const url = sameOriginUrl(source, base);
		if (!url) {
			dispatch('error', 'Use a report URL on this origin.');
			return;
		}
		dispatch('loading');
		try {
			const response = await fetchReport(url);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const report = adaptReport(await response.json());
			if (id === requestId) dispatch('loaded', { report, source: url });
		} catch (error) {
			if (id === requestId) dispatch('error', `Cannot load report: ${error.message}`);
		}
	}
	return { state: readonly(state), summary, selectedTarget, selectedRow, dispatch, load };
}
