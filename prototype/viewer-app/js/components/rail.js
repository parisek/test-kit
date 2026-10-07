// Rail parts: filter chips, the target list, the cause list. Classes come from classify.js; clicks go through actions.
import { h } from '../dom.js';
import { targetClass, worstRatio, causeIsKnown, targetsOfCause, filterTargets } from '../classify.js';
import { groupLabel } from '../labels.js';

const FILTERS = [['all', 'Vše'], ['unexplained', 'Nevysvětlené'], ['explained', 'Vysvětlené'], ['match', 'Shodné']];

export function filterChips(ctx) {
	const { report, known, state, actions } = ctx;
	const counts = { all: report.entries.length, unexplained: 0, explained: 0, match: 0, oracle: 0 };
	for (const target of report.entries) counts[targetClass(report, target, known)]++;
	// A row whose ratio is not the verdict gets a chip only when such a row exists.
	const filters = counts.oracle ? [...FILTERS, ['oracle', 'Bez verdiktu']] : FILTERS;
	return h('div', { class: 'rail-chips', role: 'group', 'aria-label': 'Filtr cílů' }, filters.map(([id, label]) => h('button', {
		class: 'rail-chip', type: 'button', 'aria-pressed': String(state.filter === id), 'data-focus': `filter-${id}`,
		on: { click: () => actions.setFilter(id) },
	}, `${label} ${counts[id]}`)));
}

export function targetList(ctx) {
	const { report, known, state, actions } = ctx;
	const rows = filterTargets(report, state.filter, known);
	if (!rows.length) return h('div', { class: 'rail-group' }, 'Žádný cíl nevyhovuje filtru');
	const out = [];
	let last = null;
	for (const target of rows) {
		if (target.group !== last) {
			out.push(h('div', { class: 'rail-group' }, groupLabel(report, target.group)));
			last = target.group;
		}
		const label = target.path ?? target.title ?? target.id;
		out.push(h('button', {
			class: 'rail-item', type: 'button', 'aria-current': String(state.targetId === target.id),
			on: { click: () => actions.openTarget(target.id, { from: null }) },
		},
		h('span', { class: `dot ${targetClass(report, target, known)}` }),
		h('span', { class: 'rail-label', title: label }, label),
		h('span', { class: 'rail-num' }, `${worstRatio(target).toFixed(1)} %`)));
	}
	return out;
}

export function causeList(ctx) {
	const { report, known, state, actions } = ctx;
	if (!report.causes.length) return h('div', { class: 'rail-group' }, 'Žádné příčiny v reportu');
	// Unexplained first; the sort is stable, so the report order holds inside each half.
	const causes = [...report.causes].sort((a, b) => Number(causeIsKnown(report, a.id, known)) - Number(causeIsKnown(report, b.id, known)));
	return [
		h('div', { class: 'rail-group' }, 'Příčiny a počet cílů'),
		causes.map((cause) => h('button', {
			class: 'rail-item', type: 'button', 'aria-current': String(state.cause === cause.id),
			on: { click: () => actions.selectCause(cause.id) },
		},
		h('span', { class: `dot ${causeIsKnown(report, cause.id, known) ? 'explained' : 'unexplained'}` }),
		h('span', { class: 'rail-label', title: cause.title }, cause.title),
		h('span', { class: 'rail-num' }, String(targetsOfCause(report, cause.id).length)))),
	];
}
