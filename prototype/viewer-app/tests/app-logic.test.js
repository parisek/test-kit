import test from 'node:test';
import assert from 'node:assert/strict';
import { sample } from './helpers.js';
import { createStore, initialState, defaultRailOpen, readRailPref, writeRailPref, RAIL_KEY } from '../js/state.js';
import { createActions } from '../js/actions.js';
import { parseHash, writeHash } from '../js/router.js';
import { PAIR_KINDS, defaultViewFor } from '../js/pairs.js';

function setup(view = null) {
	const report = sample();
	const store = createStore(initialState(report, { view }));
	const hashes = [];
	const actions = createActions(store, { report, writeHash: (id) => hashes.push(id) });
	return { report, store, actions, hashes };
}

test('every pair kind opens its default view when nothing was chosen', () => {
	for (const kind of PAIR_KINDS) {
		const { store, actions } = setup();
		actions.setPairKind(kind.id);
		assert.equal(store.get().view, defaultViewFor(kind.id), kind.id);
	}
});

test('the default table matches the approved plan', () => {
	const table = Object.fromEntries(PAIR_KINDS.map((kind) => [kind.id, kind.defaultView]));
	assert.deepEqual(table, {
		'reference-styleguide': 'cile', 'styleguide-before-after': 'matice', 'local-before-after': 'nalezy',
		'production-local': 'nalezy', 'production-before-after': 'matice', adhoc: 'cile',
	});
});

test('a view chosen by hand survives a change of pair', () => {
	const { store, actions } = setup();
	actions.setView('matice');
	actions.setPairKind('local-before-after');
	assert.equal(store.get().view, 'matice');
});

test('a disabled view cannot be opened', () => {
	const { store, actions } = setup();
	const before = store.get().view;
	actions.setView('osa');
	assert.equal(store.get().view, before);
});

test('openTarget switches to Cíle, remembers where from, and back returns', () => {
	const { store, actions } = setup('matice');
	actions.openTarget('blog', { viewportId: 'mobile-390', from: 'matice' });
	assert.equal(store.get().view, 'cile');
	assert.equal(store.get().targetId, 'blog');
	assert.equal(store.get().ui.viewport, 'mobile-390');
	actions.back();
	assert.equal(store.get().view, 'matice');
	assert.equal(store.get().from, null);
});

test('marking a cause known is undoable and idempotent', () => {
	const { store, actions } = setup();
	actions.markKnown('article-1px');
	actions.markKnown('article-1px');
	assert.deepEqual([...store.get().known], ['article-1px']);
	assert.deepEqual(store.get().undo, ['article-1px']);
	actions.undoKnown();
	assert.equal(store.get().known.size, 0);
});

test('escape closes the about panel first, then goes back', () => {
	const { store, actions } = setup('matice');
	actions.openTarget('blog', { from: 'matice' });
	actions.toggleAbout();
	actions.escape();
	assert.equal(store.get().aboutOpen, false);
	assert.equal(store.get().view, 'cile');
	actions.escape();
	assert.equal(store.get().view, 'matice');
});

test('the hash holds a plain view token', () => {
	assert.equal(parseHash('#matice'), 'matice');
	assert.equal(parseHash('#nic'), null);
	assert.equal(parseHash(''), null);
	const location = { hash: '' };
	writeHash('nalezy', location);
	assert.equal(location.hash, 'nalezy');
});

test('marking a cause known keeps it selected', () => {
	const { store, actions } = setup('nalezy');
	actions.markKnown('redirect-escape');
	assert.equal(store.get().cause, 'redirect-escape');
});

function memoryStorage() {
	const data = new Map();
	return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test('the rail is open by default from 1100px, closed below, and a drawer under 860px', () => {
	assert.equal(defaultRailOpen({ width: 1440 }), true);
	assert.equal(defaultRailOpen({ width: 1100 }), true);
	assert.equal(defaultRailOpen({ width: 1099 }), false);
	assert.equal(defaultRailOpen({ width: 390 }), false);
});

test('a stored choice wins on wide screens, never on a phone', () => {
	assert.equal(defaultRailOpen({ width: 1440, stored: 'closed' }), false);
	assert.equal(defaultRailOpen({ width: 900, stored: 'open' }), true);
	assert.equal(defaultRailOpen({ width: 390, stored: 'open' }), false);
});

test('storage that throws never breaks the rail preference', () => {
	const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
	assert.equal(readRailPref(broken), null);
	assert.doesNotThrow(() => writeRailPref(true, broken));
	assert.equal(readRailPref(undefined), null);
});

test('a localStorage getter that throws does not break reading or writing the preference', () => {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
	try {
		assert.equal(readRailPref(), null);
		assert.doesNotThrow(() => writeRailPref(true));
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage;
	}
});

test('toggleRail flips the state and remembers it on a wide screen', () => {
	const report = sample();
	const storage = memoryStorage();
	const store = createStore(initialState(report, { railOpen: true }));
	const actions = createActions(store, { report, storage, writeHash: () => {}, isNarrow: () => false });
	actions.toggleRail();
	assert.equal(store.get().railOpen, false);
	assert.equal(storage.data.get(RAIL_KEY), 'closed');
	actions.toggleRail();
	assert.equal(store.get().railOpen, true);
	assert.equal(storage.data.get(RAIL_KEY), 'open');
});

test('on a phone the drawer closes on a choice and the choice is not remembered', () => {
	const report = sample();
	const storage = memoryStorage();
	const store = createStore(initialState(report, { railOpen: true }));
	const actions = createActions(store, { report, storage, writeHash: () => {}, isNarrow: () => true });
	actions.openTarget('blog');
	assert.equal(store.get().railOpen, false);
	actions.toggleRail();
	actions.selectCause('turnstile');
	assert.equal(store.get().railOpen, false);
	assert.equal(storage.data.size, 0);
});

test('escape closes the drawer on a phone before it goes back', () => {
	const report = sample();
	const store = createStore(initialState(report, { railOpen: true, view: 'matice' }));
	const actions = createActions(store, { report, writeHash: () => {}, isNarrow: () => true });
	actions.escape();
	assert.equal(store.get().railOpen, false);
});

test('a wide screen keeps the rail open on a choice', () => {
	const report = sample();
	const store = createStore(initialState(report, { railOpen: true }));
	const actions = createActions(store, { report, writeHash: () => {}, isNarrow: () => false });
	actions.openTarget('blog');
	assert.equal(store.get().railOpen, true);
});
