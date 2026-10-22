// Pure parse and build functions for the deep link grammar (R10.14, R4.4).
// #r-<report id>/<view>/<target id>/<viewport id>/<artifact>/<finding id>?mode=<mode>
// With an adjacent report.json the r-<report id> part is dropped. The hash is untrusted.
// Target, viewport and finding ids are checked against the open report later, not here.
import { validId } from './index-list.js';

export const VIEWS = ['overview', 'evidence', 'findings', 'info'];
// Evidence types of R10.4 by artifact id. `lighthouse` is shown as speed.
export const ARTIFACTS = ['screenshot', 'html', 'status', 'content', 'lighthouse'];
export const MODES = ['side-by-side', 'overlay', 'difference'];

const PARTS = ['targetId', 'viewportId', 'artifact', 'findingId'];
const SCOPED = (view) => view === 'evidence' || view === 'findings';
const modeApplies = (artifact) => artifact === null || artifact === 'screenshot';

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
// A notice means the link was not usable: an invalid report id gives reportId null
// (open the Home), any other bad part gives the Overview of that report.
export function parseDeepLink(hash, { adjacent = false } = {}) {
	if (typeof hash !== 'string') return null;
	const body = hash.startsWith('#') ? hash.slice(1) : hash;
	if (body === '') return null;
	const cut = body.indexOf('?');
	const path = cut < 0 ? body : body.slice(0, cut);
	const query = cut < 0 ? '' : body.slice(cut + 1);
	const segments = path.split('/');
	let reportId = null;
	if (!adjacent) {
		if (!segments[0].startsWith('r-')) return null;
		const id = decode(segments.shift().slice(2));
		if (!validId(id)) return { ...empty(null), notice: 'The link names no valid report.' };
		reportId = id;
	}
	const bad = (notice) => ({ ...empty(reportId), notice });
	if (segments.length > 1 + PARTS.length) return bad('The link has too many parts.');
	const decoded = segments.map(decode);
	if (decoded.includes(undefined)) return bad('A part of the link cannot be read.');
	const [view = '', ...rest] = decoded;
	const result = empty(reportId);
	if (view !== '') {
		if (!VIEWS.includes(view)) return bad(`The link names an unknown view: ${view}.`);
		result.view = view;
	}
	const mode = queryMode(query);
	if (mode === undefined) return bad('A part of the link cannot be read.');
	if (mode !== null && !MODES.includes(mode)) return bad(`The link names an unknown mode: ${mode}.`);
	if (!SCOPED(result.view)) return result;
	PARTS.forEach((name, i) => { result[name] = rest[i] ? rest[i] : null; });
	if (result.artifact !== null && !ARTIFACTS.includes(result.artifact)) {
		return bad(`The link names an unknown evidence type: ${result.artifact}.`);
	}
	result.mode = modeApplies(result.artifact) ? mode : null;
	return result;
}

// Builds the hash for a view state. Returns null when the state cannot form a valid link.
// A missing part is an empty segment in the middle and is omitted at the end.
export function buildDeepLink(state, { adjacent = false } = {}) {
	const { reportId = null, view = 'overview', mode = null } = state ?? {};
	if (!adjacent && !validId(reportId)) return null;
	if (!VIEWS.includes(view)) return null;
	const parts = [];
	if (SCOPED(view)) {
		const values = PARTS.map((name) => state[name] ?? null);
		if (values.some((value) => value !== null && (typeof value !== 'string' || value === ''))) return null;
		if (values[2] !== null && !ARTIFACTS.includes(values[2])) return null;
		parts.push(view, ...values);
	} else if (view !== 'overview') {
		parts.push(view);
	}
	while (parts.length && parts[parts.length - 1] === null) parts.pop();
	const segments = parts.map((part) => (part === null ? '' : encodeURIComponent(part)));
	if (!adjacent) segments.unshift(`r-${reportId}`);
	let hash = `#${segments.join('/')}`;
	if (mode !== null && SCOPED(view) && modeApplies(state.artifact ?? null)) {
		if (!MODES.includes(mode)) return null;
		hash += `?mode=${encodeURIComponent(mode)}`;
	}
	return hash === '#' ? '' : hash;
}
