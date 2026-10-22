import { comparisonDetail } from '../../../src/artifacts/schema.js';
import { computed, markRaw, readonly, shallowReactive } from 'vue';
import { adaptReport } from '../../../src/report/model.js';
import { summarize, targetClass, cellState } from '../../../src/report/classify.js';
import { sameOriginUrl } from '../../../src/report/safe.js';
import { anchorFor, parseIndex, reportPath } from './index-list.js';
import { ARTIFACTS, buildDeepLink, modeFromState, modeToState, parseDeepLink, resolveDeepLink } from './deep-link.js';

// Evidence types that load a comparison file. A screenshot shows its images directly.
const LOADED = ARTIFACTS.filter((kind) => kind !== 'screenshot');

// R10.4: four report views. A report opens on Overview, whatever the pair kind (R10.5).
export const VIEWS = Object.freeze(['overview', 'evidence', 'findings', 'info']);

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
		// The id of the open report when it comes from the index (R10.3), else null.
		reportId: null,
		// The finding that opened the Evidence view, for its deep link (R10.14), else null.
		findingId: null,
		targetId: null,
		viewportId: null,
		view: 'overview',
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
		const available = ARTIFACTS.filter(kind => Object.hasOwn(artifacts, kind));
		state.artifact = available.includes(preferred) ? preferred : (available[0] ?? 'screenshot');
	}
	function invalidateEvidence() {
		evidenceRequest++;
		state.artifactEvidence = null;
	}
	function loadSelectedEvidence() {
		if (state.view === 'evidence' && LOADED.includes(state.artifact)) loadArtifact(state.artifact);
	}

	// R10.14: a change of view, target, viewport, evidence type, finding or mode adds one
	// history entry. A change that comes from the link itself adds none.
	const LINKED = new Set(['view', 'target', 'viewport', 'artifact', 'comparison', 'evidence']);
	let applyingLink = false;
	function dispatch(action, value) {
		apply(action, value);
		if (!applyingLink && state.report && LINKED.has(action)) writeHash(true);
	}
	function apply(action, value) {
		if (action === 'artifact') {
			// R10.4: an evidence type shows only when the row has that artifact.
			if (!ARTIFACTS.includes(value) || !Object.hasOwn(selectedRow.value?.artifacts ?? {}, value)) return;
			// The selected type again changes nothing, and keeps the finding.
			if (value === state.artifact) return;
			invalidateEvidence();
			state.artifact = value;
			state.findingId = null;
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
			// The first valid viewport: the target's first row, else the report's first declared one.
			state.viewportId = value.viewportId ?? target.viewports[0]?.id ?? state.report.meta.viewports[0]?.id ?? null;
			// R10.14: a finding id names the first finding with that id. A later finding with a
			// repeated id gets no finding part, so its link does not read back as another one.
			const first = state.report.findings?.find((finding) => finding?.id === value.findingId);
			// A link already resolved its finding to the first one (resolveDeepLink).
			const same = first && first.targetId === target.id && (first.viewportId ?? null) === (value.viewportId ?? null) && (first.artifact ?? null) === (value.artifact ?? null);
			state.findingId = first && (value.fromLink || same) ? value.findingId : null;
			state.view = 'evidence';
			// A link without an evidence type takes the first valid one (R10.14). This holds
			// also for a finding whose artifact is not an evidence type: its segment is empty.
			selectArtifact(value.fromLink ? value.artifact : (value.artifact ?? state.artifact));
			if (width() <= 860) dispatch('sidebar', true);
			loadSelectedEvidence();
		} else if (action === 'sidebar') {
			state.sidebarHidden = typeof value === 'boolean' ? value : !state.sidebarHidden;
			persist('test-kit-sidebar', state.sidebarHidden ? 'hidden' : 'visible');
		} else if (action === 'theme') {
			state.theme = state.theme === 'light' ? 'dark' : 'light';
			persist('test-kit-theme', state.theme);
		} else if (action === 'view' && VIEWS.includes(value)) {
			state.view = value;
			if (!state.artifactEvidence) loadSelectedEvidence();
		}
		else if (action === 'target') {
			const target = state.report?.entries.find((target) => target.id === value);
			if (!target) return;
			invalidateEvidence();
			state.targetId = target.id;
			state.viewportId = target.viewports[0]?.id ?? state.report.meta.viewports[0]?.id ?? null;
			state.findingId = null;
			state.view = 'evidence';
			selectArtifact();
			if (width() <= 860) dispatch('sidebar', true);
			loadSelectedEvidence();
		} else if (
			action === 'viewport' &&
			(selectedTarget.value?.viewports.some((row) => row.id === value) || state.report?.meta.viewports.some((row) => row.id === value))
		)
		{ invalidateEvidence(); state.viewportId = value; state.findingId = null; selectArtifact(); loadSelectedEvidence(); }
		else if (action === 'loaded') {
			dispatch('clear-filters');
			invalidateEvidence();
			state.report = markRaw(value.report);
			state.reportId = null;
			state.findingId = null;
			state.source = value.source;
			state.targetId = value.report.entries[0]?.id ?? null;
			state.viewportId = value.report.entries[0]?.viewports[0]?.id ?? null;
			state.view = 'overview';
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
			state.reportId = null;
			state.source = null;
			state.targetId = null;
			state.viewportId = null;
			state.findingId = null;
			state.notice = '';
			// Opening the Home from the breadcrumb adds one history entry (R10.14).
			setAnchor('', !applyingLink);
		} else if (action === 'loading') {
			state.loading = true;
			state.notice = 'Loading report…';
		} else if (action === 'error') {
			state.loading = false;
			state.notice = value;
		} else if (action === 'notice') {
			// A notice from a link, or none: a valid link clears an earlier link notice.
			if (typeof value === 'string') state.notice = value;
			else if (!state.notice.startsWith('Loaded')) state.notice = '';
		} else if (action === 'cancel-load') {
			// A newer hash change cancels a report load in flight (R10.14).
			requestId++;
			invalidateEvidence();
			state.loading = false;
			state.notice = '';
		} else if (action === 'report-id') {
			state.reportId = value;
		}
	}

	async function loadArtifact(kind) {
		if (!LOADED.includes(kind)) return;
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
	function setAnchor(hash, push = false) {
		try {
			const path = (browser.location.pathname ?? '') + (browser.location.search ?? '') + hash;
			if (push) browser?.history?.pushState?.(null, '', path);
			else browser?.history?.replaceState?.(null, '', path);
		} catch {
			/* A deep link is optional. */
		}
	}
	// The hash of the current view state (R10.14). Parts go in only for the Evidence view.
	function currentHash() {
		if (!state.report) return '';
		const adjacent = !state.reportId;
		const evidence = state.view === 'evidence';
		// R10.14: a finding whose artifact is not an evidence type has an empty artifact segment.
		const finding = evidence && state.findingId ? state.report.findings?.find((item) => item?.id === state.findingId) : null;
		// With a finding, the segment carries the finding's own evidence type, and only
		// when the view shows it; otherwise it stays empty and reads back to the first valid type.
		const shown = ARTIFACTS.includes(state.artifact) && selectedRow.value?.artifacts && Object.hasOwn(selectedRow.value.artifacts, state.artifact) ? state.artifact : null;
		// Only a type that the row holds goes in, so the link reads back without a notice.
		const artifact = !evidence || !shown ? null : finding ? (ARTIFACTS.includes(finding.artifact) && finding.artifact === shown ? shown : null) : shown;
		const mode = evidence && state.artifact === 'screenshot' && state.comparison !== 'side-by-side' ? modeFromState(state.comparison) : null;
		const hash = buildDeepLink({
			reportId: state.reportId,
			view: state.view,
			targetId: evidence ? state.targetId : null,
			viewportId: evidence ? state.viewportId : null,
			artifact,
			findingId: evidence ? state.findingId : null,
			mode,
		}, { adjacent });
		// An id that cannot form a link keeps the plain report link.
		return hash ?? (adjacent ? '' : anchorFor(state.reportId));
	}
	function writeHash(push) {
		const hash = currentHash();
		if ((browser?.location?.hash ?? '') === hash) return;
		setAnchor(hash, push);
	}
	// Applies a resolved link to the view state without adding history entries.
	function applyLink(resolved) {
		applyingLink = true;
		try {
			if (resolved.targetId) apply('evidence', { targetId: resolved.targetId, viewportId: resolved.viewportId, artifact: resolved.artifact, findingId: resolved.findingId, fromLink: true });
			// A link without a mode means side by side, so Back undoes a mode change.
			// The mode applies to screenshot only; an omitted type may resolve to another one.
			if (resolved.view === 'evidence') apply('comparison', (state.artifact === 'screenshot' && modeToState(resolved.mode)) || 'side-by-side');
			apply('view', resolved.view);
			apply('notice', resolved.notice);
		} finally {
			applyingLink = false;
		}
	}
	// Reads the hash on load and on hashchange (R10.14).
	// While start() loads the sources, a hashchange waits: start applies the hash at the end.
	let booting = false;
	async function applyHash(hash = browser?.location?.hash ?? '') {
		if (booting) return;
		// With an index, a hash that is not a deep link (#main) changes nothing.
		if (state.index && !parseDeepLink(hash) && hash.replace(/^#/, '') !== '') return;
		// A newer hash change cancels a report load in flight, also when the new hash
		// names the report that is open now (Back during a slow load).
		// The source form and start-up load with no report and no index; leave those alone.
		if (state.loading && (state.report || state.index)) {
			apply('cancel-load');
		}
		if (state.index) {
			const parsed = parseDeepLink(hash);
			// close-report also cancels a report load in flight (requestId), so a
			// slow load cannot open a report after Back to the Home.
			const toHome = (notice) => {
				applyingLink = true;
				try { apply('close-report'); } finally { applyingLink = false; }
				if (notice) apply('error', notice);
			};
			// An empty hash is the Home. Another hash that is not a deep link (#main) is ignored.
			if (!parsed) return hash.replace(/^#/, '') === '' ? toHome(null) : undefined;
			if (parsed.reportId === null) return toHome(parsed.notice);
			if (parsed.reportId !== state.reportId) {
				if (!state.index.reports.find((row) => row.id === parsed.reportId)?.available) return toHome(`Report ${parsed.reportId} is not available in the index.`);
				const result = await openReport(parsed.reportId, { push: false });
				if (!result.ok) return;
			}
			applyLink(resolveDeepLink(parsed, state.report));
		} else if (state.report) {
			applyLink(resolveDeepLink(parseDeepLink(hash, { adjacent: true }), state.report));
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
	async function openReport(id, { push = true } = {}) {
		const row = state.index?.reports.find((report) => report.id === id);
		if (!row?.available) return { ok: false };
		const result = await load(reportPath(row.id));
		if (result.ok) {
			apply('report-id', row.id);
			// Opening a report from the Home adds a history entry; a link does not.
			if (push) setAnchor(anchorFor(row.id), true);
		}
		return result;
	}
	// R10.13 (viewer): a report.json next to the viewer wins. The index view
	// shows only when that file is missing (HTTP 404 or an HTML body, R10.10)
	// and index.json loads.
	async function start(source = 'report.json') {
		booting = true;
		try {
			const result = await load(source);
			if (result.ok || result.stale || !result.missing) return result;
			const failure = state.notice;
			const listed = await loadIndex();
			if (listed.stale) return listed;
			if (listed.missing) {
				dispatch('error', failure);
				dispatch('sources-missing');
			}
			return listed;
		} finally {
			booting = false;
			// The hash as it is now, after the sources load; a hashchange during the
			// load is not lost.
			if (state.report || state.index) await applyHash();
		}
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
	// The source form (R10.10): load the report, then read the hash like a start (R10.14).
	async function loadSource(source) {
		const result = await load(source);
		if (result.ok) await applyHash();
		return result;
	}
	return { state: readonly(state), summary, filteredTargets, selectedTarget, selectedRow, dispatch, load, loadSource, start, openReport, applyHash };
}
