// Pure parse, check and build functions of the Live page (R10.17 item 5, R4.4).
// #live/<target id>/<side A>/<side B>/<viewport id>?layout=swap|side-by-side&zoom=fit|50|75|100&show=a|b
// The hash and /live.json are untrusted. The hash never carries a URL (R10.14).
import { validId } from './index-list.js';

export const LAYOUTS = ['swap', 'side-by-side'];
export const ZOOMS = ['fit', '50', '75', '100'];
export const SHOWS = ['a', 'b'];
const PROXY_ORIGIN = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/;
const MAX_SIZE = 20000;

// R10.14: a Live hash is `#live`, or starts with `#live/` or `#live?`.
export function isLiveHash(hash) {
	return typeof hash === 'string' && /^#live(?:$|[/?])/.test(hash);
}

function decode(part) {
	try {
		return decodeURIComponent(part);
	} catch {
		return undefined;
	}
}

// Returns null for a hash that is not a Live hash. Otherwise the raw choices: an id that fails
// `validId` becomes `undefined`, so the resolver can say that the link held an unknown part.
export function parseLiveHash(hash) {
	if (!isLiveHash(hash)) return null;
	const body = hash.slice('#live'.length);
	const at = body.indexOf('?');
	const path = at < 0 ? body : body.slice(0, at);
	const query = at < 0 ? '' : body.slice(at + 1);
	const parts = path.split('/').slice(1);
	const id = (index) => {
		if (parts[index] === undefined || parts[index] === '') return null;
		const value = decode(parts[index]);
		return validId(value) ? value : undefined;
	};
	const result = { targetId: id(0), sideA: id(1), sideB: id(2), viewportId: id(3), layout: null, zoom: null, show: null, extra: parts.length > 4 };
	for (const pair of query ? query.split('&') : []) {
		const eq = pair.indexOf('=');
		const key = decode(eq < 0 ? pair : pair.slice(0, eq));
		const value = decode(eq < 0 ? '' : pair.slice(eq + 1));
		const allowed = { layout: LAYOUTS, zoom: ZOOMS, show: SHOWS }[key];
		if (!allowed) { result.extra = true; continue; }
		result[key] = allowed.includes(value) ? value : undefined;
	}
	return result;
}

function validPath(value) {
	return value === null || (typeof value === 'string' && value.length <= 2048 && value.startsWith('/') && !value.startsWith('//') && !/[\\\s\u0000-\u001f\u007f]/.test(value));
}

const size = (value) => Number.isSafeInteger(value) && value > 0 && value <= MAX_SIZE;

// Checks /live.json (R10.18 item 9). Each id passes `validId`; an entry that fails is dropped.
// A side origin must be `http://127.0.0.1:<port>` (R10.17 item 4). It must differ from the viewer
// origin and from every other side, because each proxy is an origin of its own (R10.18 item 2).
// A side that breaks this is dropped, also the first side with a repeated origin.
export function readLiveIndex(input, { viewerOrigin = null } = {}) {
	if (!input || typeof input !== 'object') return null;
	const list = (value) => (Array.isArray(value) ? value.slice(0, 500) : []);
	const valid = list(input.sides).filter((side) => side && validId(side.id) && typeof side.origin === 'string' && PROXY_ORIGIN.test(side.origin) && Number(PROXY_ORIGIN.exec(side.origin)[1]) <= 65535);
	const count = new Map();
	for (const side of valid) count.set(side.origin, (count.get(side.origin) ?? 0) + 1);
	const sides = valid.filter((side) => side.origin !== viewerOrigin && count.get(side.origin) === 1)
		.map((side) => ({ id: side.id, origin: side.origin }));
	const sideIds = new Set(sides.map((side) => side.id));
	const targets = list(input.targets).filter((target) => target && validId(target.id) && target.paths && typeof target.paths === 'object')
		.map((target) => ({ id: target.id, paths: Object.fromEntries([...sideIds].map((id) => [id, validPath(target.paths[id]) ? target.paths[id] ?? null : null])) }));
	const viewports = list(input.viewports).filter((viewport) => viewport && validId(viewport.id) && size(viewport.width) && size(viewport.height))
		.map(({ id, width, height }) => ({ id, width, height }));
	if (sides.length < 2 || !targets.length || !viewports.length) return { sides, targets, viewports, usable: false };
	return { sides, targets, viewports, usable: true };
}

// The targets with a path on both picked sides (R10.17 item 1, R5.19).
export function targetsFor(index, sideA, sideB) {
	return index.targets.filter((target) => typeof target.paths[sideA] === 'string' && typeof target.paths[sideB] === 'string');
}

// Fills each omitted or unknown part with the first valid value (R10.17 item 5). Side B defaults
// to the first side that is not side A. `notice` is set when the link held an unknown part.
export function resolveLive(parsed, index) {
	const choice = parsed ?? { targetId: null, sideA: null, sideB: null, viewportId: null, layout: null, zoom: null, show: null, extra: false };
	let unknown = Boolean(choice.extra);
	const pick = (value, options) => {
		if (value !== null && value !== undefined && options.includes(value)) return value;
		if (value !== null) unknown = true;
		return options[0] ?? null;
	};
	const sideIds = index.sides.map((side) => side.id);
	const sideA = pick(choice.sideA, sideIds);
	const sideB = pick(choice.sideB, sideIds.filter((id) => id !== sideA));
	const targetId = pick(choice.targetId, targetsFor(index, sideA, sideB).map((target) => target.id));
	const viewportId = pick(choice.viewportId, index.viewports.map((viewport) => viewport.id));
	const layout = pick(choice.layout, LAYOUTS);
	const zoom = pick(choice.zoom, ZOOMS);
	const show = pick(choice.show, SHOWS);
	return { targetId, sideA, sideB, viewportId, layout, zoom, show, notice: unknown ? 'The link held an unknown part. The page shows the first valid choice instead.' : null };
}

export function buildLiveHash({ targetId, sideA, sideB, viewportId, layout, zoom, show }) {
	const ids = [targetId, sideA, sideB, viewportId];
	if (!ids.every(validId) || !LAYOUTS.includes(layout) || !ZOOMS.includes(zoom) || !SHOWS.includes(show)) return '#live';
	return `#live/${ids.map(encodeURIComponent).join('/')}?layout=${layout}&zoom=${zoom}&show=${show}`;
}

// R10.17 item 4: the frame src is the proxy origin of the side plus the target path, or null.
export function frameSource(index, sideId, targetId) {
	const side = index.sides.find((entry) => entry.id === sideId);
	const target = index.targets.find((entry) => entry.id === targetId);
	const path = target?.paths[sideId];
	if (!side || typeof path !== 'string' || !PROXY_ORIGIN.test(side.origin) || !validPath(path)) return null;
	return `${side.origin}${path}`;
}

// R10.17 item 8: the measurement of exactly the shown cell. `--config` stays a placeholder.
// Every value is a checked id, so the text needs no shell quoting.
export function measureCommand({ targetId, sideA, sideB, viewportId }) {
	if (![targetId, sideA, sideB, viewportId].every(validId)) return null;
	return `test-kit before --config FILE --side ${sideA} --target ${targetId} --viewport ${viewportId} && test-kit after --config FILE --side ${sideB} --target ${targetId} --viewport ${viewportId}`;
}

// R10.18 item 6: a valid scroll ratio is a finite number from 0 to 1.
export function validRatio(value) {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

// R10.17 item 3: one scale factor for each frame, at most 1.
export function scaleFactor(zoom, paneWidth, viewportWidth) {
	if (zoom !== 'fit') return Number(zoom) / 100;
	if (!(paneWidth > 0) || !(viewportWidth > 0)) return 1;
	return Math.min(1, paneWidth / viewportWidth);
}
