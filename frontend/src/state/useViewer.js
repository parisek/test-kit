import { hasPrototypes, PLANNED_KINDS } from '../prototypes/planned.js';
import { comparisonDetail } from '../../../src/artifacts/schema.js';
import { computed, markRaw, readonly, shallowReactive } from 'vue';
import { adaptReport } from '../../../src/report/model.js';
import { summarize, targetClass, cellState } from '../../../src/report/classify.js';
import { sameOriginUrl } from '../../../src/report/safe.js';
import { anchorFor, idFromAnchor, parseIndex, reportPath } from './index-list.js';

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
	const base = options.base ?? browser?.document?.baseURI ?? browser?.location?.href;
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
		index: null,
		targetId: null,
		viewportId: null,
		view: 'detail',
		sidebarHidden: preference == null ? width() <= 860 : preference === 'hidden',
		theme: stored('test-kit-theme') === 'dark' ? 'dark' : 'light',
		notice: '',
		loading: false,
		// R10.10: both report.json and index.json are missing. Only then the form shows.
		// It stays after a failed try from the form: the adjacent sources are still missing.
		sourcesMissing: false,
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
		const available = ['screenshot', 'html', 'status', 'content', 'behavior', 'lighthouse'].filter(kind => Object.hasOwn(artifacts, kind));
        if (hasPrototypes(state.report) && selectedRow.value) available.push(...PLANNED_KINDS.filter(kind => !available.includes(kind)));
		state.artifact = available.includes(preferred) ? preferred : (available[0] ?? 'screenshot');
	}
	function invalidateEvidence() {
		evidenceRequest++;
		state.artifactEvidence = null;
	}
	function loadSelectedEvidence() {
		if (['detail', 'speed'].includes(state.view) && ['html', 'status', 'content', 'behavior', 'lighthouse'].includes(state.artifact)) loadArtifact(state.artifact);
	}

	function dispatch(action, value) {
		if (action === 'artifact') {
			const planned = hasPrototypes(state.report) && selectedRow.value && PLANNED_KINDS.includes(value);
            if (!planned && (!['screenshot', 'html', 'status', 'content', 'behavior', 'lighthouse'].includes(value) || !Object.hasOwn(selectedRow.value?.artifacts ?? {}, value))) return;
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
            if (['content', 'speed'].includes(value) && !hasPrototypes(state.report) && !state.report?.entries.some(target => target.viewports.some(row => row.artifacts?.[value === 'speed' ? 'lighthouse' : 'content']))) return;
			state.view = value;
            if (value === 'speed' && selectedRow.value?.artifacts?.lighthouse) { selectArtifact('lighthouse'); loadSelectedEvidence(); }
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
		} else if (action === 'sources-missing') {
			state.sourcesMissing = true;
		} else if (action === 'index-loaded') {
			state.index = markRaw(value);
			state.loading = false;
			state.notice = '';
		} else if (action === 'close-report') {
			if (!state.index) return;
			requestId++;
			state.loading = false;
			invalidateEvidence();
			state.report = null;
			state.source = null;
			state.targetId = null;
			state.viewportId = null;
			state.notice = '';
			setAnchor('');
		} else if (action === 'loading') {
			state.loading = true;
			state.notice = 'Loading report…';
		} else if (action === 'error') {
			state.loading = false;
			state.notice = value;
		}
	}

	async function loadArtifact(kind) {
		if (!['html', 'status', 'content', 'behavior', 'lighthouse'].includes(kind)) return;
		const src = selectedRow.value?.artifacts?.[kind]?.diff?.src;
		const url = sameOriginUrl(src, state.source ?? base);
		if (!src || !url) return;
		const id = ++evidenceRequest;
		dispatch('artifact-result', { kind, loading: true });
		try {
			const response = await fetchReport(url, { redirect: 'error' });
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

	// R10.10: a body that opens with "<" is an HTML page, never a report or an
	// index. A front controller serves one for an unknown path, with HTTP 200.
	async function readJson(response) {
		const text = await response.text();
		if (/^[\s\uFEFF]*</.test(text)) {
			const error = new Error('the server returned a web page, not JSON');
			error.html = true;
			throw error;
		}
		return JSON.parse(text);
	}
	function setAnchor(hash) {
		try {
			browser?.history?.replaceState?.(null, '', (browser.location.pathname ?? '') + (browser.location.search ?? '') + hash);
		} catch {
			/* A deep link is optional. */
		}
	}
	async function loadIndex() {
		const url = sameOriginUrl('index.json', base);
		if (!url) return { ok: false };
		const id = ++requestId;
		dispatch('loading');
		try {
			const response = await fetchReport(url, { redirect: 'error' });
			if (!response.ok) {
				const error = new Error(`HTTP ${response.status}`);
				error.status = response.status;
				throw error;
			}
			const index = parseIndex(await readJson(response));
			if (id !== requestId) return { ok: false, stale: true };
			if (!index.ok) {
				dispatch('error', index.error);
				return { ok: false };
			}
			dispatch('index-loaded', index);
			return { ok: true };
		} catch (error) {
			if (id !== requestId) return { ok: false, stale: true };
			dispatch('error', `Cannot load index: ${error.message}`);
			return { ok: false, status: error.status, missing: error.status === 404 || error.html === true };
		}
	}
	// Open a report that the index lists. The id must pass the id charset (R10.13).
	async function openReport(id) {
		const row = state.index?.reports.find((report) => report.id === id);
		if (!row?.available) return { ok: false };
		const result = await load(reportPath(row.id));
		if (result.ok) setAnchor(anchorFor(row.id));
		return result;
	}
	// R10.13 (viewer): a report.json next to the viewer wins. The index view
	// shows only when that file is missing (HTTP 404 or an HTML body, R10.10)
	// and index.json loads.
	async function start(source = 'report.json') {
		const result = await load(source);
		if (result.ok || result.stale || !result.missing) return result;
		const failure = state.notice;
		const listed = await loadIndex();
		if (listed.stale) return listed;
		if (listed.missing) {
			dispatch('error', failure);
			dispatch('sources-missing');
		}
		if (!listed.ok) return listed;
		const wanted = idFromAnchor(browser?.location?.hash);
		if (wanted) {
			if (state.index.reports.find((row) => row.id === wanted)?.available) await openReport(wanted);
			else dispatch('error', `Report ${wanted} is not available in the index.`);
		}
		return listed;
	}

	async function load(source) {
		const id = ++requestId;
		invalidateEvidence();
		const url = sameOriginUrl(source, base);
		if (!url) {
			dispatch('error', 'Use a report URL on this origin.');
			return { ok: false };
		}
		dispatch('loading');
		try {
			const response = await fetchReport(url, { redirect: 'error' });
			if (!response.ok) {
				const error = new Error(`HTTP ${response.status}`);
				error.status = response.status;
				throw error;
			}
			const report = adaptReport(await readJson(response));
			if (id !== requestId) return { ok: false, stale: true };
			dispatch('loaded', { report, source: url });
			return { ok: true };
		} catch (error) {
			if (id !== requestId) return { ok: false, stale: true };
			dispatch('error', `Cannot load report: ${error.message}`);
			return { ok: false, status: error.status, missing: error.status === 404 || error.html === true };
		}
	}
	return { state: readonly(state), summary, filteredTargets, selectedTarget, selectedRow, dispatch, load, start, openReport };
}
