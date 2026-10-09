import { hasPrototypes, PLANNED_KINDS } from '../prototypes/planned.js';
import { comparisonDetail } from '../../../src/artifacts/schema.js';
import { computed, markRaw, readonly, shallowReactive } from 'vue';
import { adaptReport } from '../../../src/report/model.js';
import { summarize, targetClass, cellState } from '../../../src/report/classify.js';
import { sameOriginUrl } from '../../../src/report/safe.js';

export const FIRST_VIEW = Object.freeze({
	convergence: 'detail',
	'self-baseline': 'matrix',
	update: 'findings',
	migration: 'findings',
	deploy: 'matrix',
	adhoc: 'detail',
});
const VIEWS = ['detail', 'matrix', 'findings', 'timeline', 'content', 'speed'];

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
		artifactEvidence: null,
		artifact: 'screenshot',
		comparison: 'side-by-side',
		overlay: 50,
		evidenceView: 'normalized',
		filters: { classification: 'all', measurement: 'all', cause: 'all' },
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
	let evidenceRequest = 0;
	const summary = computed(() => (state.report ? summarize(state.report) : null));
	const filteredTargets = computed(() =>
		state.report?.entries.filter((target) => {
			const filters = state.filters;
			const classification = targetClass(state.report, target) ?? 'unclassified';
			const viewportIds = new Set([
				...state.report.meta.viewports.map((row) => row.id),
				...target.viewports.map((row) => row.id),
			]);
			const states = [...viewportIds].map((id) => cellState(target, id));
			if (!states.length) states.push('missing');
			return (filters.classification === 'all' || classification === filters.classification)
				&& (filters.measurement === 'all' || states.includes(filters.measurement))
				&& (filters.cause === 'all' || state.report.findings.some((finding) =>
					finding.targetId === target.id && (filters.cause === 'unknown'
						? !state.report.causes.some((cause) => cause.id === finding.causeId)
						: 'cause:' + finding.causeId === filters.cause)));
		}) ?? [],
	);
	const selectedTarget = computed(
		() => state.report?.entries.find((target) => target.id === state.targetId) ?? null,
	);
	const selectedRow = computed(
		() => selectedTarget.value?.viewports.find((row) => row.id === state.viewportId) ?? null,
	);

	function selectArtifact(preferred = state.artifact) {
		const artifacts = selectedRow.value?.artifacts ?? {};
		const available = ['screenshot', 'html', 'status'].filter(kind => Object.hasOwn(artifacts, kind));
        if (hasPrototypes(state.report) && selectedRow.value) available.push(...PLANNED_KINDS);
		state.artifact = available.includes(preferred) ? preferred : (available[0] ?? 'screenshot');
	}
	function invalidateEvidence() {
		evidenceRequest++;
		state.artifactEvidence = null;
	}
	function loadSelectedEvidence() {
		if (state.view === 'detail' && ['html', 'status'].includes(state.artifact)) loadArtifact(state.artifact);
	}

	function dispatch(action, value) {
		if (action === 'artifact') {
			const planned = hasPrototypes(state.report) && selectedRow.value && PLANNED_KINDS.includes(value);
            if (!planned && (!['screenshot', 'html', 'status'].includes(value) || !Object.hasOwn(selectedRow.value?.artifacts ?? {}, value))) return;
			invalidateEvidence();
			state.artifact = value;
			loadSelectedEvidence();
		} else if (action === 'comparison') {
			if (['side-by-side', 'overlay', 'diff'].includes(value)) state.comparison = value;
		} else if (action === 'overlay') {
			if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) state.overlay = value;
		} else if (action === 'evidence-view') {
			if (['normalized', 'raw'].includes(value)) state.evidenceView = value;
		} else if (action === 'load-artifact') {
			loadArtifact(value);
		} else if (action === 'artifact-result') {
			state.artifactEvidence = value;
		} else if (action === 'filter') {
			const allowed = {
				classification: ['all', 'match', 'explained', 'unexplained', 'oracle', 'unclassified'],
				measurement: ['all', 'complete', 'missing', 'failed', 'incompatible'],
				cause: ['all', 'unknown', ...(state.report?.causes.map((cause) => 'cause:' + cause.id) ?? [])],
			};
			if (Object.hasOwn(allowed, value?.key ?? '') && allowed[value.key].includes(value.value)) {
				state.filters = { ...state.filters, [value.key]: value.value };
			}
		} else if (action === 'clear-filters') {
			state.filters = { classification: 'all', measurement: 'all', cause: 'all' };
		} else if (action === 'evidence') {
			const target = state.report?.entries.find((target) => target.id === value?.targetId);
			if (!target) return;
			const viewportExists = state.report.meta.viewports.some((row) => row.id === value.viewportId)
				|| target.viewports.some((row) => row.id === value.viewportId);
			if (value.viewportId != null && !viewportExists) return;
			invalidateEvidence();
			state.targetId = target.id;
			state.viewportId = value.viewportId ?? target.viewports[0]?.id ?? null;
			state.view = 'detail';
			selectArtifact(value.artifact ?? state.artifact);
			if (width() <= 860) dispatch('sidebar', true);
			loadSelectedEvidence();
		} else if (action === 'sidebar') {
			state.sidebarHidden = typeof value === 'boolean' ? value : !state.sidebarHidden;
			persist('test-kit-sidebar', state.sidebarHidden ? 'hidden' : 'visible');
		} else if (action === 'theme') {
			state.theme = state.theme === 'light' ? 'dark' : 'light';
			persist('test-kit-theme', state.theme);
		} else if (action === 'view' && VIEWS.includes(value)) {
            if (['content', 'speed'].includes(value) && !hasPrototypes(state.report)) return;
			state.view = value;
			if (!state.artifactEvidence) loadSelectedEvidence();
		}
		else if (action === 'target') {
			const target = state.report?.entries.find((target) => target.id === value);
			if (!target) return;
			invalidateEvidence();
			state.targetId = target.id;
			state.viewportId = target.viewports[0]?.id ?? null;
			state.view = 'detail';
			selectArtifact();
			if (width() <= 860) dispatch('sidebar', true);
			loadSelectedEvidence();
		} else if (
			action === 'viewport' &&
			(selectedTarget.value?.viewports.some((row) => row.id === value) || state.report?.meta.viewports.some((row) => row.id === value))
		)
		{ invalidateEvidence(); state.viewportId = value; selectArtifact(); loadSelectedEvidence(); }
		else if (action === 'loaded') {
			dispatch('clear-filters');
			invalidateEvidence();
			state.report = markRaw(value.report);
			state.source = value.source;
			state.targetId = value.report.entries[0]?.id ?? null;
			state.viewportId = value.report.entries[0]?.viewports[0]?.id ?? null;
			state.view = FIRST_VIEW[value.report.pair.kind];
			selectArtifact();
			loadSelectedEvidence();
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

	async function loadArtifact(kind) {
		if (!['html', 'status'].includes(kind)) return;
		const src = selectedRow.value?.artifacts?.[kind]?.diff?.src;
		const url = sameOriginUrl(src, state.source ?? base);
		if (!src || !url) return;
		const id = ++evidenceRequest;
		dispatch('artifact-result', { kind, loading: true });
		try {
			const response = await fetchReport(url);
			if (!response.ok) throw new Error('Evidence request fails.');
			const reader = response.body.getReader();
			const chunks = [];
			let size = 0;
			try {
				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					size += value.byteLength;
					if (size > 2 * 1024 * 1024) throw new Error('Evidence exceeds 2 MiB.');
					chunks.push(value);
				}
			} finally { await reader.cancel().catch(() => {}); }
			const bytes = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
			const data = comparisonDetail(kind, JSON.parse(new TextDecoder().decode(bytes)));
			if (id === evidenceRequest) dispatch('artifact-result', { kind, loading: false, data });
		} catch (error) {
			if (id === evidenceRequest) dispatch('artifact-result', { kind, loading: false, error: error.message });
		}
	}

	async function load(source) {
		const id = ++requestId;
		invalidateEvidence();
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
	return { state: readonly(state), summary, filteredTargets, selectedTarget, selectedRow, dispatch, load };
}
