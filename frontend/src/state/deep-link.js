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
// The hash never carries a URL, also not in a part that the view ignores (R10.14).
// Browsers drop white space, control and format characters inside a URL, so the
// check removes them all first. A part is refused when it then holds two slashes or
// backslashes, a colon before a slash or backslash, or starts with a scheme that a
// browser runs, fetches or opens.
// Other ids with ":" stay linkable: a finding id joins a check id, which may hold one.
const SCHEMES = /^(?:https?|ftp|wss?|javascript|vbscript|livescript|data|blob|file|filesystem|about|view-source|chrome|chrome-extension|moz-extension|resource|intent|jar|mailto|tel|sms):/i;
const URL_LIKE = {
	test(part) {
		const plain = part.replace(/[\s\p{Cc}\p{Cf}]/gu, '');
		return /[\/\\]{2}|:[\/\\]/.test(plain) || SCHEMES.test(plain);
	},
};

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
	// No URL anywhere in the query either, whatever the view or the key.
	const queryUrl = query.split(/[&=]/).some((part) => URL_LIKE.test(decode(part) ?? part));
	if (queryUrl) return bad('The link holds a URL. A link part must be an id.');
	const view = decode(segments[0] ?? '');
	if (view === undefined) return bad('A part of the link cannot be read.');
	const result = empty(reportId);
	if (view !== '') {
		if (!VIEWS.includes(view)) return bad('The link names an unknown view.');
		result.view = view;
	}
	if (!SCOPED(result.view)) {
		// Overview and Run info ignore the other parts and the mode, but never take a URL.
		const urlLike = segments.slice(1).some((part) => URL_LIKE.test(decode(part) ?? part));
		return urlLike ? bad('The link holds a URL. A link part must be an id.') : result;
	}
	if (segments.length > 1 + PARTS.length) return bad('The link has too many parts.');
	const rest = segments.slice(1).map(decode);
	if (rest.includes(undefined)) return bad('A part of the link cannot be read.');
	const mode = queryMode(query);
	if (mode === undefined) return bad('A part of the link cannot be read.');
	PARTS.forEach((name, i) => { result[name] = rest[i] ? rest[i] : null; });
	if (PARTS.some((name) => result[name] !== null && URL_LIKE.test(result[name]))) {
		return bad('The link holds a URL. A link part must be an id.');
	}
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
// For a finding whose artifact is not an evidence type (for example behavior), pass
// artifact null: the link then has an empty artifact segment (R10.14).
// A missing part is an empty segment in the middle and is omitted at the end.
export function buildDeepLink(state, options) {
	const adjacent = options?.adjacent === true;
	state = state ?? {};
	const { reportId = null, view = 'overview', mode = null } = state;
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
