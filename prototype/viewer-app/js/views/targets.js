// View "Cíle": one target in detail. Tabs per artifact kind, the screenshot tab with side by side, overlay and diff.
import { h } from '../dom.js';
import { filterChips, targetList } from '../components/rail.js';
import { stage } from '../components/stage.js';
import { htmlDiff, statusTable, behaviorPanel } from '../components/diff.js';
import { composedRows } from '../components/composed.js';
import { cellClass, artifactClass, targetClass, worst, findingsFor, causeIsKnown, filterTargets } from '../classify.js';

const CLASS_LABEL = { match: 'Shodné', explained: 'Vysvětlené', unexplained: 'Nevysvětlené', oracle: 'Bez verdiktu' };
const TABS = [['screenshot', 'Snímek'], ['html', 'HTML'], ['status', 'Stav'], ['behavior', 'Chování']];
const MODES = [['side', 'Vedle sebe'], ['over', 'Překrytí'], ['diff', 'Rozdíl']];
const BACK_LABEL = { matice: 'Zpět na matici', nalezy: 'Zpět na nálezy' };

function visible({ report, state, known }) {
	return filterTargets(report, state.filter, known);
}

function current({ report, state }) {
	return report.entries.find((target) => target.id === state.targetId) ?? report.entries[0] ?? null;
}

function sideName(report, runId, fallback) {
	return report.runs.find((run) => run.id === runId)?.side ?? fallback;
}

function tabClass(ctx, target, kind) {
	if (kind === 'screenshot') return worst(target.viewports.map((viewport) => cellClass(ctx.report, target, viewport.id, ctx.known)));
	if (!target.artifacts?.[kind]) return 'na';
	return artifactClass(ctx.report, target, kind, ctx.known);
}

function segment(items, active, onPick, label) {
	return h('div', { class: 't-seg', role: 'group', 'aria-label': label },
		items.map(([id, text]) => h('button', { type: 'button', 'aria-pressed': String(id === active), on: { click: () => onPick(id) } }, text)));
}

function causeCards(ctx, target, viewport) {
	const { report, known } = ctx;
	const ids = [...new Set(findingsFor(report, target.id, { viewportId: viewport.id, artifact: 'screenshot' }).map((finding) => finding.causeId))];
	if (ids.length === 0) {
		const quiet = cellClass(report, target, viewport.id, known) === 'match';
		return h('p', { class: 't-quiet' }, quiet ? 'Beze změny nad hladinou šumu. Příčina se nehledá.' : 'Rozdíl nad hladinou šumu a žádná příčina. Je nevysvětlený.');
	}
	return ids.map((id) => {
		const cause = report.causes.find((entry) => entry.id === id);
		const isKnown = causeIsKnown(report, id, known);
		return h('div', { class: `t-cause${isKnown ? '' : ' t-cause-bad'}` },
			h('b', {}, `${cause?.title ?? id} · ${isKnown ? 'známý rozdíl' : 'nevysvětleno'}`),
			h('span', {}, cause?.detail ?? ''));
	});
}

function screenshotTab(ctx, target) {
	const { report, state, actions } = ctx;
	const viewport = target.viewports.find((entry) => entry.id === state.ui.viewport) ?? target.viewports[0];
	if (!viewport) return h('div', { class: 't-empty' }, 'Cíl nemá žádný snímek.');
	const mode = state.ui.mode;
	const meta = h('span', { class: 't-meta' },
		h('b', {}, `${viewport.ratio.toFixed(1)} %`), ' změněných pixelů · rozdíl výšky ',
		h('b', {}, viewport.dh ? `+${viewport.dh} px` : '0 px'), ` · ${viewport.id}`);
	const bar = h('div', { class: 't-bar' },
		h('span', { class: 'lbl' }, 'Viewport'),
		segment(report.meta.viewports.map((entry) => [entry.id, entry.label]), viewport.id, actions.setViewport, 'Viewport'),
		h('span', { class: 'lbl' }, 'Zobrazení'),
		segment(MODES, mode, actions.setMode, 'Zobrazení'),
		meta);
	const a = sideName(report, report.pair?.aRunId, 'A');
	const b = sideName(report, report.pair?.bRunId, 'B');
	const shot = (title, side, regions = false, caption = null) => h('div', { class: 't-shot' },
		h('h3', {}, h('span', {}, title), h('span', {}, viewport.id)),
		stage({ report, target, viewportId: viewport.id, side, regions }),
		caption ? h('div', { class: 't-cap' }, caption) : null);
	let body;
	if (mode === 'diff') {
		const count = viewport.artifacts?.screenshot?.diff?.regions?.length ?? 0;
		body = h('div', { class: 't-shots' }, shot(`Rozdíl A a B · ${count} ${count === 1 ? 'oblast' : count > 1 && count < 5 ? 'oblasti' : 'oblastí'}`, 'b', true, 'Červeně: shluky změněných pixelů.'));
	} else if (mode === 'over') {
		const slide = state.ui.slide;
		body = h('div', { class: 't-shots' }, h('div', { class: 't-shot' },
			h('h3', {}, h('span', {}, `A (vlevo) a B (vpravo)`), h('span', {}, `${slide} %`)),
			h('div', { class: 't-over' },
				stage({ report, target, viewportId: viewport.id, side: 'a' }),
				h('div', { class: 't-over-b', style: `clip-path: inset(0 0 0 ${slide}%)` }, stage({ report, target, viewportId: viewport.id, side: 'b' }))),
			h('input', { class: 't-slider', type: 'range', min: 0, max: 100, value: slide, 'aria-label': 'Posuvník porovnání', dataset: { focus: 'slider' },
				on: { input: (event) => actions.setSlide(Number(event.target.value)) } })));
	} else {
		body = h('div', { class: 't-shots' }, shot(`A · ${a}`, 'a'), shot(`B · ${b}`, 'b'));
	}
	return [bar, body, h('div', { class: 't-causes' }, h('h3', {}, 'Příčiny'), causeCards(ctx, target, viewport)),
		target.note ? h('p', { class: 't-quiet' }, target.note) : null];
}

function artifactTab(ctx, target, kind) {
	if (!target.artifacts?.[kind]) return h('div', { class: 't-empty' }, 'Pro tento cíl nejsou data.');
	if (kind === 'html') return htmlDiff(ctx, target);
	if (kind === 'status') return statusTable(target);
	return behaviorPanel(target, ctx);
}

export default {
	id: 'cile',
	label: 'Cíle',
	enabled: true,

	rail: (ctx) => h('div', {}, filterChips(ctx), targetList(ctx)),

	main(ctx) {
		const { report, state, actions, known } = ctx;
		const target = current(ctx);
		if (!target) return h('div', { class: 'state' }, h('h1', {}, 'Report nemá žádný cíl.'));
		const cls = targetClass(report, target, known);
		const tabs = h('div', { class: 't-tabs', role: 'tablist' }, TABS.map(([kind, text]) => h('button', {
			type: 'button', role: 'tab', 'aria-selected': String(state.ui.tab === kind), on: { click: () => actions.setTab(kind) },
		}, h('span', { class: `t-dot t-dot-${tabClass(ctx, target, kind)}` }), text)));
		return h('div', { class: 't-view' },
			state.from ? h('button', { class: 't-back', type: 'button', on: { click: actions.back } }, BACK_LABEL[state.from] ?? 'Zpět') : null,
			h('h1', { class: 't-title' }, h('code', {}, target.path ?? target.title), h('span', { class: `t-badge t-badge-${cls}` }, CLASS_LABEL[cls])),
			composedRows(ctx, target),
			tabs,
			h('div', { class: 't-body' }, state.ui.tab === 'screenshot' ? screenshotTab(ctx, target) : artifactTab(ctx, target, state.ui.tab)));
	},

	keys(ctx, event) {
		const { report, state, actions } = ctx;
		const list = visible(ctx);
		const index = list.findIndex((target) => target.id === state.targetId);
		const open = (target) => actions.openTarget(target.id, { from: state.from, viewportId: state.ui.viewport, tab: state.ui.tab });
		if (event.key === 'j' && index < list.length - 1) { open(list[index + 1]); return true; }
		if (event.key === 'k' && index > 0) { open(list[index - 1]); return true; }
		const ids = report.meta.viewports.map((viewport) => viewport.id);
		const at = ids.indexOf(state.ui.viewport);
		if (event.key === 'ArrowRight' && at < ids.length - 1) { actions.setViewport(ids[at + 1]); return true; }
		if (event.key === 'ArrowLeft' && at > 0) { actions.setViewport(ids[at - 1]); return true; }
		return false;
	},
};
