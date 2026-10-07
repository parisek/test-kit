// The active view lives in the hash as a plain token: #cile, #matice, #nalezy, #osa.
import { VIEW_IDS } from './pairs.js';

export function parseHash(hash) {
	const token = String(hash ?? '').replace(/^#/, '');
	return VIEW_IDS.includes(token) ? token : null;
}

export function writeHash(viewId, location = globalThis.location) {
	if (location && location.hash !== `#${viewId}`) location.hash = viewId;
}

export function initRouter(onChange, target = globalThis) {
	const handler = () => onChange(parseHash(target.location.hash));
	target.addEventListener('hashchange', handler);
	return () => target.removeEventListener('hashchange', handler);
}
