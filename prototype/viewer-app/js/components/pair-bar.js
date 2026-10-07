// The toolbar: ONE row above both columns. Hamburger, title, view switch, pair, sides, counters, data source, About.
// Wide screens never wrap it; narrower ones hide the least important parts by container width (css/components.css).
// With no report loaded (a failed load) it still shows the title and the data-source select, so the person can switch back.
import { h } from '../dom.js';
import { PAIR_KINDS, pairKind, defaultViewFor } from '../pairs.js';

export const VIEW_LABELS = { cile: 'Cíle', matice: 'Matice', nalezy: 'Nálezy', osa: 'Osa běhů' };

function counter(kind, count, label, tip) {
	return h('span', { class: `tb-count ${kind}`, title: tip },
		h('strong', {}, String(count)),
		h('span', { class: 'tb-count-label' }, ` ${label}`));
}

function burger({ state, actions }) {
	return h('button', {
		class: 'tb-burger', type: 'button', title: 'Panel ([)', 'aria-label': 'Panel',
		'aria-expanded': state.railOpen, 'aria-controls': 'rail', on: { click: actions.toggleRail },
	}, h('span', { class: 'tb-bar' }), h('span', { class: 'tb-bar' }), h('span', { class: 'tb-bar' }));
}

function viewSwitch({ state, actions, views }) {
	return h('div', { class: 'tb-views', role: 'group', 'aria-label': 'Pohled' },
		views.map((view) => h('button', {
			class: 'pill', type: 'button', disabled: !view.enabled, title: view.enabled ? null : view.reason,
			'aria-pressed': view.id === state.view, on: { click: () => actions.setView(view.id) },
		}, view.label)));
}

function pairSelect({ report, state, actions }) {
	if (report.legacy) return h('span', { class: 'tb-pill', title: 'Report ve starém formátu (verze 1)' }, 'Formát verze 1');
	return [
		h('select', {
			class: 'tb-select tb-pair', 'data-focus': 'pair-select', 'aria-label': 'Druh páru',
			on: { change: (event) => actions.setPairKind(event.target.value) },
		}, PAIR_KINDS.map((option) => h('option', { value: option.id, selected: option.id === state.pairKind }, option.label))),
		h('span', { class: 'tb-pill tb-default', title: 'Pohled, který se otevře při změně páru' }, `výchozí: ${VIEW_LABELS[defaultViewFor(state.pairKind)]}`),
	];
}

function sides({ report, state }) {
	if (report.legacy) return null;
	const kind = pairKind(state.pairKind);
	return h('span', { class: 'tb-sides', title: `Strana A: ${kind.a}\nStrana B: ${kind.b}` },
		h('b', {}, 'A'), ` ${kind.a} `, h('i', { 'aria-hidden': 'true' }, '→'), ' ', h('b', {}, 'B'), ` ${kind.b}`);
}

function counters({ summary }) {
	const { cells } = summary;
	const of = `z ${cells.total}`;
	return h('span', { class: 'tb-sum', role: 'group', 'aria-label': 'Souhrn snímků' },
		counter('ok', cells.match, 'shodných', `Shodných snímků: ${cells.match} ${of}`),
		counter('warn', cells.explained, 'vysvětlených', `Vysvětlených rozdílů: ${cells.explained} ${of}`),
		counter('bad', cells.unexplained, 'nevysvětlených', `Nevysvětlených rozdílů: ${cells.unexplained} ${of}`),
		cells.oracle ? counter('', cells.oracle, 'bez verdiktu', `Bez verdiktu (judge: oracle): ${cells.oracle} ${of}`) : null);
}

function sampleBadge({ report, actions }) {
	if (!report.meta.sample) return null;
	return h('button', { class: 'tb-sample', type: 'button', title: report.meta.note || 'Ukázková data', on: { click: actions.toggleAbout } },
		h('span', { class: 'tb-sample-long' }, 'Ukázková data'), h('span', { class: 'tb-sample-short' }, 'Ukázka'));
}

function dataSelect({ datasets }) {
	if (!datasets || datasets.list.length < 2) return null;
	const known = datasets.list.some((entry) => entry.url === datasets.source);
	return h('select', {
		class: 'tb-select tb-data', 'data-focus': 'data-select', 'aria-label': 'Zdroj dat', title: 'Zdroj dat',
		on: { change: (event) => datasets.onChange(event.target.value) },
	},
	datasets.list.map((entry) => h('option', { value: entry.url, selected: entry.url === datasets.source }, entry.label)),
	known ? null : h('option', { value: datasets.source, selected: true }, 'Vlastní'));
}

export function toolbar(ctx) {
	const { report, state, actions } = ctx;
	if (!report) {
		return [
			h('strong', { class: 'tb-title' }, 'Porovnání běhů'),
			h('span', { class: 'grow' }),
			dataSelect(ctx),
		];
	}
	const title = [report.meta.title, report.meta.project].filter(Boolean).join(' · ');
	return [
		burger(ctx),
		h('strong', { class: 'tb-title', title }, title),
		viewSwitch(ctx),
		pairSelect(ctx),
		sides(ctx),
		h('span', { class: 'grow' }),
		sampleBadge(ctx),
		counters(ctx),
		dataSelect(ctx),
		h('button', { class: 'pill tb-about', type: 'button', 'aria-expanded': state.aboutOpen, on: { click: actions.toggleAbout } }, 'O návrhu'),
	];
}
