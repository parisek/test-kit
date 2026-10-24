// Pure parse and build functions for the deep link grammar (R10.14, R4.4).
// #r-<report id>/<view>/<target id>/<viewport id>/<artifact>/<finding id>?mode=<mode>
// With an adjacent report.json the r-<report id> part is dropped. The hash is untrusted.
// Target, viewport and finding ids are checked against the open report later, not here.
import { validId } from './index-list.js';

export const VIEWS = ['overview', 'evidence', 'findings', 'info'];
// Evidence types of R10.4 by artifact id, in the order the viewer offers them.
// `lighthouse` is shown as speed.
export const ARTIFACTS = ['screenshot', 'html', 'status', 'content', 'behavior', 'lighthouse'];
export const MODES = ['side-by-side', 'overlay', 'difference'];

const PARTS = ['targetId', 'viewportId', 'artifact', 'findingId'];
const SCOPED = (view) => view === 'evidence' || view === 'findings';
const modeApplies = (artifact) => artifact === null || artifact === 'screenshot';
// The hash never carries a URL, also not in a part that the view ignores (R10.14).
// Every URL needs a ":" or a "/" or "\\", so a part that holds one is refused. Browsers
// drop white space, control and format characters inside a URL, so the check removes
// them first. No id that test-kit writes holds these characters (config ids, the
// reserved "@project", finding ids built from them). A finding id from other data
// that holds one gets no deep link.
const URL_LIKE = { test: (part) => /[:\/\\]/.test(part.replace(/[\s\p{Cc}\p{Cf}]/gu, '')) };

function empty(reportId) {
	return { reportId, view: 'overview', targetId: null, viewportId: null, artifact: null, findingId: null, mode: null, notice: null };
}

function decode(part) {
	try {
		return decodeURIComponent(part);
	} catch {
		return undefined;
	}
}

function encode(part) {
	try {
		return encodeURIComponent(part);
	} catch {
		return undefined;
	}
}

function queryMode(query) {
	let mode = null;
	for (const pair of query.split('&')) {
		const at = pair.indexOf('=');
		const key = decode(at < 0 ? pair : pair.slice(0, at));
		if (key === undefined) return undefined;
		if (key !== 'mode') continue;
		const value = decode(at < 0 ? '' : pair.slice(at + 1));
		if (value === undefined) return undefined;
		mode = value === '' ? null : value;
	}
	return mode;
}

// Returns null when the hash is not a deep link. Otherwise returns
// { reportId, view, targetId, viewportId, artifact, findingId, mode, notice }.
// A notice means the link was not usable. It never repeats text from the link: an invalid report id gives reportId null
// (open the Home), any other bad part gives the Overview of that report.
export function parseDeepLink(hash, options) {
	const adjacent = options?.adjacent === true;
	if (typeof hash !== 'string') return null;
	const body = hash.startsWith('#') ? hash.slice(1) : hash;
	if (body === '') return null;
	const cut = body.indexOf('?');
	const path = cut < 0 ? body : body.slice(0, cut);
	const query = cut < 0 ? '' : body.slice(cut + 1);
	const segments = path.split('/');
	if (segments.length > 1 && segments[segments.length - 1] === '') segments.pop();
	let reportId = null;
	if (!adjacent) {
		if (!segments[0].startsWith('r-')) return null;
		const id = decode(segments.shift().slice(2));
		if (!validId(id)) return { ...empty(null), notice: 'The link names no valid report.' };
		reportId = id;
	}
	const bad = (notice) => ({ ...empty(reportId), notice });
	// Every part and every query key and value must decode and must not hold a URL,
	// also where the view ignores it (R10.14).
	const decoded = segments.map(decode);
	const queryParts = query.split(/[&=]/).map(decode);
	if (decoded.includes(undefined) || queryParts.includes(undefined)) return bad('A part of the link cannot be read.');
	if (decoded.slice(1).some((part) => URL_LIKE.test(part)) || queryParts.some((part) => URL_LIKE.test(part))) {
		return bad('The link holds a URL. A link part must be an id.');
	}
	const view = decoded[0] ?? '';
	const result = empty(reportId);
	if (view !== '') {
		if (!VIEWS.includes(view)) return bad('The link names an unknown view.');
		result.view = view;
	}
	if (!SCOPED(result.view)) {
		// Overview and Run info ignore the other parts and the mode.
		return result;
	}
	if (segments.length > 1 + PARTS.length) return bad('The link has too many parts.');
	const rest = decoded.slice(1);
	const mode = queryMode(query);
	PARTS.forEach((name, i) => { result[name] = rest[i] ? rest[i] : null; });
	if (result.artifact !== null && !ARTIFACTS.includes(result.artifact)) {
		return bad('The link names an unknown evidence type.');
	}
	// A mode counts only where it applies. The caller drops it when an empty
	// artifact resolves to a type other than screenshot.
	if (!modeApplies(result.artifact)) return result;
	if (mode !== null && !MODES.includes(mode)) return bad('The link names an unknown mode.');
	result.mode = mode;
	return result;
}

// Builds the hash for a view state. Returns null when the state cannot form a valid link.
// For a finding whose artifact is not an evidence type (for example a11y), pass
// artifact null: the link then has an empty artifact segment (R10.14).
// A missing part is an empty segment in the middle and is omitted at the end.
export function buildDeepLink(state, options) {
	const adjacent = options?.adjacent === true;
	state = state ?? {};
	const { reportId = null, view = 'overview' } = state;
	// An empty mode is no mode, as `?mode=` reads back to null.
	const mode = state.mode === '' ? null : (state.mode ?? null);
	if (!adjacent && !validId(reportId)) return null;
	if (!VIEWS.includes(view)) return null;
	const parts = [];
	if (SCOPED(view)) {
		const values = PARTS.map((name) => state[name] ?? null);
		if (values.some((value) => value !== null && (typeof value !== 'string' || value === '' || URL_LIKE.test(value)))) return null;
		if (values[2] !== null && !ARTIFACTS.includes(values[2])) return null;
		parts.push(view, ...values);
	} else if (view !== 'overview') {
		parts.push(view);
	}
	while (parts.length && parts[parts.length - 1] === null) parts.pop();
	// A lone surrogate in an untrusted id makes encodeURIComponent throw.
	const segments = parts.map((part) => (part === null ? '' : encode(part)));
	if (segments.includes(undefined)) return null;
	if (!adjacent) segments.unshift(`r-${reportId}`);
	let hash = `#${segments.join('/')}`;
	if (mode !== null && SCOPED(view) && modeApplies(state.artifact ?? null)) {
		if (!MODES.includes(mode)) return null;
		hash += `?mode=${encodeURIComponent(mode)}`;
	}
	return hash === '#' ? '' : hash;
}

const MODE_NAMES = { 'side-by-side': 'side-by-side', overlay: 'overlay', difference: 'diff' };
// The viewer stores the difference mode as "diff". The link names it "difference".
export const modeToState = (mode) => MODE_NAMES[mode] ?? null;
export const modeFromState = (comparison) => Object.keys(MODE_NAMES).find((key) => MODE_NAMES[key] === comparison) ?? null;

// Resolves a parsed link against the open report (R10.14). The viewer accepts a target,
// viewport or finding id only when the report holds it. A finding wins over the other
// parts and gives a notice when they differ. An unknown part gives a notice and the
// Overview. An omitted part takes the first valid value (left null here; the viewer
// picks it). Pure: the report is plain data.
export function resolveDeepLink(parsed, report) {
	const overview = (notice) => ({ view: 'overview', targetId: null, viewportId: null, artifact: null, findingId: null, mode: null, notice });
	if (!parsed || !report) return overview(parsed?.notice ?? null);
	if (parsed.notice) return overview(parsed.notice);
	const result = { view: parsed.view, targetId: null, viewportId: null, artifact: null, findingId: null, mode: null, notice: null };
	if (parsed.view === 'overview' || parsed.view === 'info') return result;
	const entries = Array.isArray(report.entries) ? report.entries : [];
	let { targetId, viewportId, artifact } = parsed;
	let findingType = null;
	if (parsed.findingId !== null) {
		const finding = (Array.isArray(report.findings) ? report.findings : []).find((item) => item?.id === parsed.findingId);
		if (!finding) return overview('The link names a finding that this report does not hold.');
		const findingArtifact = ARTIFACTS.includes(finding.artifact) ? finding.artifact : null;
		findingType = findingArtifact;
		const differs = (part, value) => part !== null && value != null && part !== value;
		// The finding wins, also with its empty evidence type (an artifact such as a11y).
		if (differs(targetId, finding.targetId) || differs(viewportId, finding.viewportId) || (artifact !== null && artifact !== findingArtifact)) {
			result.notice = 'The link and its finding name different parts. The finding wins.';
		}
		targetId = finding.targetId ?? targetId;
		viewportId = finding.viewportId ?? viewportId;
		artifact = findingArtifact;
		result.findingId = finding.id;
	}
	const target = targetId === null ? entries[0] : entries.find((item) => item?.id === targetId);
	if (!target) {
		if (targetId !== null) return overview('The link names a target that this report does not hold.');
		// A report with no targets: Findings still opens; Evidence has nothing to show.
		return parsed.view === 'findings' ? result : overview(null);
	}
	result.targetId = target.id;
	if (viewportId !== null) {
		const known = (report.meta?.viewports ?? []).some((row) => row?.id === viewportId) || (target.viewports ?? []).some((row) => row?.id === viewportId);
		if (!known) return overview('The link names a viewport that this report does not hold.');
		result.viewportId = viewportId;
	}
	if (artifact !== null) {
		const row = (target.viewports ?? []).find((item) => item?.id === (result.viewportId ?? target.viewports?.[0]?.id));
		const present = Boolean(row?.artifacts) && Object.hasOwn(row.artifacts, artifact);
		// The evidence type of a finding may be missing on its row: the first valid type
		// shows then. An evidence type from the path must exist.
		if (!present && !(result.findingId !== null && artifact === findingType)) return overview('The link names an evidence type that this page does not have.');
		result.artifact = present ? artifact : null;
	}
	result.mode = parsed.mode !== null && (result.artifact === null || result.artifact === 'screenshot') ? parsed.mode : null;
	return result;
}
