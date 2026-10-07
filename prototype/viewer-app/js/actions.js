// Every state change goes through here. Pure with respect to the DOM; the only side effect is `writeHash`.
import { defaultViewFor } from './pairs.js';
import { VIEWS } from './views/index.js';
import { writeRailPref, NARROW_PX } from './state.js';

const defaultIsNarrow = () => globalThis.matchMedia?.(`(max-width: ${NARROW_PX - 1}px)`).matches ?? false;

export function createActions(store, { writeHash = () => {}, report, storage, isNarrow = defaultIsNarrow }) {
	const ui = (patch) => store.set((state) => ({ ui: { ...state.ui, ...patch } }));
	// Under NARROW_PX the rail is a drawer: choosing something in it closes it, and that choice is not remembered.
	const closeDrawer = () => (isNarrow() ? { railOpen: false } : {});
	const enabled = (id) => VIEWS.some((view) => view.id === id && view.enabled);

	const actions = {
		setView(id, { manual = true } = {}) {
			if (!enabled(id)) return;
			store.set((state) => ({ view: id, viewChosenManually: manual ? true : state.viewChosenManually, from: id === 'cile' ? state.from : null }));
			writeHash(id);
		},
		setPairKind(kindId) {
			const { viewChosenManually } = store.get();
			store.set({ pairKind: kindId });
			if (!viewChosenManually) {
				const next = defaultViewFor(kindId);
				store.set({ view: next });
				writeHash(next);
			}
		},
		/** Open a target in "Cíle". `from` is the view the person came from, so "Zpět" can return. */
		openTarget(targetId, { viewportId = null, tab = 'screenshot', from = null } = {}) {
			store.set((state) => ({ view: 'cile', targetId, from, ...closeDrawer(), ui: { ...state.ui, viewport: viewportId ?? state.ui.viewport, tab } }));
			writeHash('cile');
		},
		back() {
			const { from } = store.get();
			if (from) { store.set({ view: from, from: null }); writeHash(from); }
		},
		setFilter: (filter) => store.set({ filter }),
		setSort: (viewportId) => store.set((state) => ({ sort: state.sort === viewportId ? null : viewportId })),
		selectCause: (causeId) => store.set({ cause: causeId, ...closeDrawer() }),
		toggleRail() {
			store.set((state) => ({ railOpen: !state.railOpen }));
			if (!isNarrow()) writeRailPref(store.get().railOpen, storage);
		},
		closeRail() {
			store.set({ railOpen: false });
			if (!isNarrow()) writeRailPref(false, storage);
		},
		markKnown(causeId) {
			store.set((state) => state.known.has(causeId) ? {} : { known: new Set([...state.known, causeId]), undo: [...state.undo, causeId], cause: causeId });
		},
		undoKnown() {
			store.set((state) => {
				if (!state.undo.length) return {};
				const last = state.undo[state.undo.length - 1];
				const known = new Set(state.known);
				known.delete(last);
				return { known, undo: state.undo.slice(0, -1) };
			});
		},
		setViewport: (viewport) => ui({ viewport }),
		setTab: (tab) => ui({ tab }),
		setMode: (mode) => ui({ mode }),
		setNormalize: (normalize) => ui({ normalize }),
		setSlide: (slide) => ui({ slide }),
		toggleAbout: () => store.set((state) => ({ aboutOpen: !state.aboutOpen })),
		escape() {
			const state = store.get();
			if (state.aboutOpen) store.set({ aboutOpen: false });
			else if (state.railOpen && isNarrow()) store.set({ railOpen: false });
			else if (state.view === 'cile' && state.from) actions.back();
		},
	};
	actions.report = report;
	return actions;
}
