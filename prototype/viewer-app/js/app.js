// Boot and render loop. State lives in js/state.js, changes in js/actions.js, views in js/views/.
// Rendering is a full redraw of toolbar, rail and main on every state change: small reports, no diffing needed.
// Focus and scroll position survive the redraw (see `keep`).
import { loadReport, ReportError } from './data.js';
import { createStore, initialState, defaultRailOpen, readRailPref } from './state.js';
import { createActions } from './actions.js';
import { VIEWS, viewById } from './views/index.js';
import { parseHash, writeHash, initRouter } from './router.js';
import { summarize } from './classify.js';
import { h, mount, $ } from './dom.js';
import { toolbar } from './components/pair-bar.js';
import { aboutPanel } from './components/about.js';
import { NARROW_PX } from './state.js';

const DEFAULT_DATA = 'data/report.json';
const INDEX_URL = 'data/index.json';

let current = null;    // { store, report, actions } of the loaded report; null while none is loaded
let failure = null;    // the error of the last failed load
let datasets = [];     // optional data/index.json: [{ label, url }]
let source = DEFAULT_DATA;
let railOpen = defaultRailOpen({ width: innerWidth, stored: readRailPref() }); // survives a switch of report

async function boot() {
	document.addEventListener('keydown', onKey);
	initRouter((view) => {
		if (current && view && viewById(view).id === view && current.store.get().view !== view) current.store.set({ view, viewChosenManually: true });
	});
	matchMedia(`(max-width: ${NARROW_PX - 1}px)`).addEventListener('change', (event) => { if (event.matches) current?.actions.closeRail(); });
	new ResizeObserver(syncToolbarHeight).observe($('#toolbar'));
	$('#rail-backdrop').addEventListener('click', () => current?.actions.closeRail());
	await load(new URL(location.href).searchParams.get('data') ?? DEFAULT_DATA);
	loadIndex();
}

async function load(url) {
	source = url;
	let report;
	try {
		report = await loadReport(url);
	} catch (error) {
		current = null;
		failure = error;
		render();
		return;
	}
	failure = null;
	const store = createStore(initialState(report, { view: parseHash(location.hash), railOpen }));
	const actions = createActions(store, { writeHash, report });
	store.subscribe((state) => { railOpen = state.railOpen; render(); });
	current = { store, report, actions };
	render();
}

/** data/index.json is optional. A missing or broken file just means there is no data-source select. */
async function loadIndex() {
	try {
		const response = await fetch(INDEX_URL, { cache: 'no-store' });
		if (!response.ok) return;
		const list = await response.json();
		if (Array.isArray(list)) datasets = list.filter((entry) => entry && typeof entry.url === 'string' && typeof entry.label === 'string');
	} catch { return; }
	render();
}

function datasetContext() {
	return { list: datasets, source, onChange: (url) => load(url) };
}

function render() {
	if (!current) { renderFailure(); return; }
	const { store, report, actions } = current;
	draw(store.get(), report, actions);
}

function context(state, report, actions) {
	return { state, report, actions, known: state.known, summary: summarize(report, state.known), views: VIEWS, datasets: datasetContext() };
}

function draw(state, report, actions) {
	const ctx = context(state, report, actions);
	const view = viewById(state.view);
	keep(() => {
		mount($('#toolbar'), toolbar(ctx));
		syncShell(state);
		mount($('#rail-body'), view.rail(ctx));
		mount($('#view'), view.main(ctx));
		mount($('#rail-foot'), report.legacy ? 'Formát verze 1 · bez příčin a běhů' : `schemaVersion ${report.schemaVersion} · čte i verzi 1`);
		mount($('#about'), state.aboutOpen ? aboutPanel(ctx) : null);
	});
	syncToolbarHeight();
}

/** Open/closed rail on the shell. `inert` keeps a hidden rail out of the tab order and the accessibility tree. */
function syncShell(state) {
	$('#app').dataset.rail = state.railOpen ? 'open' : 'closed';
	$('#rail').inert = !state.railOpen;
}

/** The drawer and its backdrop start below the toolbar, whose height changes when it wraps on a phone. */
function syncToolbarHeight() {
	$('#app').style.setProperty('--tb-h', `${$('#toolbar').offsetHeight}px`);
}

/** Redraw while keeping scroll offsets and the focused control (marked with data-focus). */
function keep(redraw) {
	const scrolls = ['.main', '#rail-body'].map((selector) => [selector, $(selector)?.scrollTop ?? 0]);
	const focus = document.activeElement?.dataset?.focus ?? null;
	redraw();
	for (const [selector, top] of scrolls) if ($(selector)) $(selector).scrollTop = top;
	if (focus) document.querySelector(`[data-focus="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
}

function onKey(event) {
	if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
	if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || !current) return;
	const { store, report, actions } = current;
	if (event.key === 'Escape') { actions.escape(); return; }
	if (event.key === '[') { actions.toggleRail(); event.preventDefault(); return; }
	const state = store.get();
	if (viewById(state.view).keys?.(context(state, report, actions), event)) event.preventDefault();
}

function renderFailure() {
	keep(() => {
		mount($('#toolbar'), toolbar({ report: null, datasets: datasetContext(), views: VIEWS }));
		$('#app').dataset.rail = 'closed';
		$('#rail').inert = true;
		mount($('#about'), null);
		mount($('#view'), h('div', { class: 'state' },
			h('h1', {}, failure instanceof ReportError ? failure.message : 'Prohlížeč se nespustil.'),
			failure?.problems?.length ? h('ul', {}, failure.problems.slice(0, 20).map((problem) => h('li', {}, problem))) : null,
			h('p', { class: 'muted' }, 'Adresu reportu lze změnit přes ?data=cesta/k/report.json.'),
		));
	});
	syncToolbarHeight();
}

boot();
