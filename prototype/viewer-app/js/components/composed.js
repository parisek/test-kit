// "Složeno z" (a page lists its components) and "Použito na" (a component lists the pages that use it).
// Chips open the target in "Cíle". An id the report does not know stays visible but is not a link.
import { h } from '../dom.js';
import { composedIds, usedOn } from '../classify.js';

function row(label, chips) {
	return h('div', { class: 'composed-row' }, h('span', { class: 'lbl' }, label), h('div', { class: 'composed-chips' }, chips));
}

function chip(ctx, id, title) {
	const known = ctx.report.entries.some((entry) => entry.id === id);
	if (!known) return h('span', { class: 'composed-chip composed-chip-off', title: 'Cíl v reportu není' }, title ?? id);
	return h('button', { class: 'composed-chip', type: 'button', on: { click: () => ctx.actions.openTarget(id, { from: null }) } }, title ?? id);
}

export function composedRows(ctx, target) {
	const { report } = ctx;
	const parts = composedIds(target);
	const pages = usedOn(report, target.id);
	if (!parts.length && !pages.length) return null;
	const titleOf = (id) => report.entries.find((entry) => entry.id === id)?.title ?? id;
	return h('div', { class: 'composed' },
		parts.length ? row('Složeno z', parts.map((id) => chip(ctx, id, titleOf(id)))) : null,
		pages.length ? row('Použito na', pages.map((page) => chip(ctx, page.id, page.title ?? page.id))) : null);
}
