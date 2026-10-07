// One store, one shape. Views read state and call actions; they never write to it directly.
import { defaultViewFor } from './pairs.js';

export function createStore(initial) {
	let state = initial;
	const subscribers = new Set();
	return {
		get: () => state,
		set(patch) {
			state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
			subscribers.forEach((fn) => fn(state));
		},
		subscribe(fn) {
			subscribers.add(fn);
			return () => subscribers.delete(fn);
		},
	};
}

// Rail (left column) preference. Wide screens remember the choice; narrow screens always start closed,
// because there the rail is a drawer over the content. Storage can throw (private window): every access is guarded.
export const RAIL_KEY = 'rv.rail';
export const WIDE_PX = 1100;
export const NARROW_PX = 860;

// `storage` is looked up INSIDE the try: with site data blocked, merely reading `localStorage` throws.
export function readRailPref(storage) {
	try { return (storage ?? globalThis.localStorage)?.getItem(RAIL_KEY) ?? null; } catch { return null; }
}

export function writeRailPref(open, storage) {
	try { (storage ?? globalThis.localStorage)?.setItem(RAIL_KEY, open ? 'open' : 'closed'); } catch { /* the choice just does not persist */ }
}

export function defaultRailOpen({ width, stored = null }) {
	if (width < NARROW_PX) return false;
	if (stored === 'open') return true;
	if (stored === 'closed') return false;
	return width >= WIDE_PX;
}

export function initialState(report, { view = null, railOpen = true } = {}) {
	const pairKind = report.pair?.kind ?? 'reference-styleguide';
	const first = report.entries[0]?.id ?? null;
	return {
		pairKind,
		view: view ?? defaultViewFor(pairKind),
		viewChosenManually: Boolean(view),
		filter: 'all',            // all | unexplained | explained | match
		sort: null,               // viewport id or null (matrix)
		targetId: first,          // current target in the "Cíle" view
		known: new Set(),         // cause ids the person marked known in this window
		undo: [],                 // stack of cause ids, last marked last
		cause: null,              // selected cause id in "Nálezy"
		from: null,               // 'matice' | 'nalezy' when the target was opened from there
		aboutOpen: false,
		railOpen,                 // the left column; a drawer under NARROW_PX
		ui: { viewport: report.meta.primaryViewport ?? report.meta.viewports[0]?.id, tab: 'screenshot', mode: 'side', normalize: true, slide: 50 },
	};
}
