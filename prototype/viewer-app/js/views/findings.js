// View "Nálezy": differences grouped by cause. The question: is anything unexplained left?
import { h } from '../dom.js';
import { causeList } from '../components/rail.js';
import { stage } from '../components/stage.js';
import { causeIsKnown, targetsOfCause, viewportsOfCause } from '../classify.js';

const ARTIFACT_LABEL = { screenshot: 'Snímek', html: 'HTML', status: 'Stav', behavior: 'Chování' };

function selected({ report, state, known }) {
	return report.causes.find((cause) => cause.id === state.cause)
		?? report.causes.find((cause) => !causeIsKnown(report, cause.id, known))
		?? report.causes[0] ?? null;
}

function headline({ report, state, summary }) {
	const remaining = summary.unexplainedCauses;
	const knownCount = report.causes.length - remaining;
	return h('div', { class: `f-head${remaining === 0 ? ' f-done' : ''}` },
		h('div', { class: 'f-big' }, String(remaining)),
		h('div', {},
			h('h1', {}, 'Zbývá nevysvětlených'),
			h('p', { class: 'muted' }, `${report.causes.length} příčin celkem · ${knownCount} vysvětlených · ${summary.cells.unexplained} nevysvětlených snímků`)));
}

function yamlFor(ctx, cause) {
	const { report, state } = ctx;
	const artifacts = [...new Set(report.findings.filter((finding) => finding.causeId === cause.id).map((finding) => finding.artifact))];
	const lines = [
		'known_diffs:',
		`  - cause: ${cause.id}`,
		`    pair: ${state.pairKind}`,
		`    artifacts: [${artifacts.join(', ')}]`,
		`    targets: [${targetsOfCause(report, cause.id).join(', ')}]`,
		`    viewports: [${viewportsOfCause(report, cause.id).join(', ')}]`,
		'    evidence: ""',
	];
	return lines.join('\n');
}

function chips(ctx, cause) {
	const { report, actions } = ctx;
	return targetsOfCause(report, cause.id).map((id) => {
		const target = report.entries.find((entry) => entry.id === id);
		const own = report.findings.find((finding) => finding.causeId === cause.id && finding.targetId === id);
		const first = viewportsOfCause(report, cause.id, id)[0] ?? null;
		return h('button', {
			class: 'f-chip', type: 'button', title: target?.path,
			on: { click: () => actions.openTarget(id, { viewportId: first, tab: own?.artifact ?? 'screenshot', from: 'nalezy' }) },
		}, target?.path ?? id);
	});
}

function preview(ctx, cause) {
	const { report } = ctx;
	const finding = report.findings.find((entry) => entry.causeId === cause.id && entry.artifact === 'screenshot');
	if (!finding) return null;
	const target = report.entries.find((entry) => entry.id === finding.targetId);
	const viewportId = viewportsOfCause(report, cause.id, finding.targetId)[0];
	if (!target || !viewportId) return null;
	return h('div', {},
		h('span', { class: 'f-label' }, 'Náhled ', h('code', { class: 'f-path' }, `${target.path} · ${viewportId}`)),
		h('div', { class: 'f-preview' },
			h('div', {}, h('h3', {}, 'A'), stage({ report, target, viewportId, side: 'a' })),
			h('div', {}, h('h3', {}, 'B'), stage({ report, target, viewportId, side: 'b', regions: true }))));
}

export default {
	id: 'nalezy',
	label: 'Nálezy',
	enabled: true,

	rail: (ctx) => h('div', {}, causeList(ctx)),

	main(ctx) {
		const { report, state, actions, known } = ctx;
		if (report.causes.length === 0) {
			return h('div', { class: 'f-view' }, h('div', { class: 'f-empty' }, 'Starý formát reportu nemá příčiny. Použij Cíle nebo Matici.'));
		}
		const cause = selected(ctx);
		const isKnown = causeIsKnown(report, cause.id, known);
		const kinds = [...new Set(report.findings.filter((finding) => finding.causeId === cause.id).map((finding) => finding.artifact))];
		const viewports = viewportsOfCause(report, cause.id);
		const marked = state.known.has(cause.id);
		return h('div', { class: 'f-view' },
			headline(ctx),
			h('div', { class: 'f-body' },
				h('div', { class: 'f-cause-h' },
					h('h2', {}, cause.title),
					h('span', { class: `f-pill ${isKnown ? 'f-pill-known' : 'f-pill-bad'}` }, isKnown ? 'Známý rozdíl' : 'Nevysvětleno')),
				h('p', { class: 'f-lead' }, cause.detail),
				h('span', { class: 'f-label' }, 'Kde se projevuje'),
				h('div', { class: 'f-kinds' }, kinds.map((kind) => h('span', { class: 'f-kind' }, ARTIFACT_LABEL[kind] ?? kind))),
				h('span', { class: 'f-label' }, viewports.length ? 'Viewporty' : 'Viewporty (bez snímku)'),
				h('div', { class: 'f-kinds' }, viewports.map((id) => h('span', { class: 'f-kind' }, id))),
				h('span', { class: 'f-label' }, `Cíle (${targetsOfCause(report, cause.id).length})`),
				h('div', { class: 'f-chips' }, chips(ctx, cause)),
				h('div', { class: 'f-actions' },
					isKnown ? null : h('button', { class: 'f-btn f-primary', type: 'button', on: { click: () => { actions.selectCause(cause.id); actions.markKnown(cause.id); } } }, 'Označit jako známý rozdíl'),
					state.undo.length ? h('button', { class: 'f-btn', type: 'button', on: { click: actions.undoKnown } }, 'Vrátit zpět') : null),
				marked ? h('div', { class: 'f-yaml-box' },
					h('span', { class: 'f-label' }, 'Zápis do known_diffs tohoto páru'),
					h('pre', { class: 'f-yaml' }, yamlFor(ctx, cause)),
					h('p', { class: 'muted' }, 'Zápis do konfigurace proběhne příkazem, ne z tohoto okna.')) : null,
				preview(ctx, cause)));
	},
};
