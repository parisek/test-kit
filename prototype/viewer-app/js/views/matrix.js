// View "Matice": every target against every viewport and artifact kind. A click opens the target in "Cíle".
import { h } from '../dom.js';
import { filterChips, causeList } from '../components/rail.js';
import { cellClass, artifactClass, filterTargets } from '../classify.js';
import { groupLabel } from '../labels.js';

const ARTIFACTS = [['html', 'HTML'], ['status', 'Stav'], ['behavior', 'Chování']];

function rows({ report, state, known }) {
	const groups = new Map();
	for (const target of filterTargets(report, state.filter, known)) {
		const key = target.group ?? 'other';
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(target);
	}
	const ratioAt = (target) => target.viewports.find((viewport) => viewport.id === state.sort)?.ratio ?? 0;
	return [...groups.entries()].map(([group, targets]) => [group, state.sort ? [...targets].sort((a, b) => ratioAt(b) - ratioAt(a)) : targets]);
}

function legend({ report }) {
	const item = (cls, text) => h('span', {}, h('i', { class: `m-key m-${cls}` }), text);
	return h('div', { class: 'm-legend' },
		item('match', `Shodné pod ${report.meta.matchBelow} %`),
		item('explained', 'Liší se, příčina známá'),
		item('unexplained', 'Liší se, příčina neznámá'),
		item('oracle', 'Poměr není verdikt'),
		h('span', {}, 'Číslo: procento změněných pixelů. Klik otevře cíl.'));
}

function cell(ctx, target, { cls, text, label, viewportId = null, tab }) {
	return h('td', {}, h('button', {
		class: `m-cell m-${cls}`, type: 'button', 'aria-label': `${target.path} ${label}`,
		on: { click: () => ctx.actions.openTarget(target.id, { viewportId, tab, from: 'matice' }) },
	}, text));
}

export default {
	id: 'matice',
	label: 'Matice',
	enabled: true,

	rail: (ctx) => h('div', {}, filterChips(ctx), causeList(ctx)),

	main(ctx) {
		const { report, state, actions, known } = ctx;
		const groups = rows(ctx);
		if (groups.length === 0) return h('div', { class: 'm-view' }, legend(ctx), h('div', { class: 'm-empty' }, 'Žádný cíl nevyhovuje filtru.'));
		const head = h('tr', {},
			h('th', {}, 'Cíl'),
			report.meta.viewports.map((viewport) => h('th', {}, h('button', {
				class: 'm-sort', type: 'button', 'aria-pressed': String(state.sort === viewport.id), title: `Řadit podle ${viewport.id}`,
				on: { click: () => actions.setSort(viewport.id) },
			}, viewport.label))),
			ARTIFACTS.map(([, text], index) => h('th', { class: index === 0 ? 'm-sep' : null }, text)));
		const body = groups.map(([group, targets]) => [
			h('tr', { class: 'm-group' }, h('td', { colspan: 1 + report.meta.viewports.length + ARTIFACTS.length }, groupLabel(report, group))),
			targets.map((target) => h('tr', {},
				h('td', {}, h('span', { class: 'm-path', title: target.path }, target.path ?? target.title)),
				report.meta.viewports.map((viewport) => {
					const entry = target.viewports.find((item) => item.id === viewport.id);
					return entry
						? cell(ctx, target, { cls: cellClass(report, target, viewport.id, known), text: entry.ratio.toFixed(1), label: `${viewport.id} ${entry.ratio} %`, viewportId: viewport.id, tab: 'screenshot' })
						: h('td', {}, h('span', { class: 'm-cell m-na' }, '–'));
				}),
				ARTIFACTS.map(([kind, text], index) => {
					const cls = artifactClass(report, target, kind, known);
					const td = cell(ctx, target, { cls, text: cls === 'match' ? '·' : '!', label: text, tab: kind });
					if (index === 0) td.classList.add('m-sep');
					return td;
				}))),
		]);
		return h('div', { class: 'm-view' }, legend(ctx),
			h('div', { class: 'm-grid' }, h('table', { class: 'm-table' }, h('thead', {}, head), h('tbody', {}, body))));
	},
};
