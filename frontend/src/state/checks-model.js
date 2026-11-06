// Pure model of the "Checks" list of a target (R8.6, ADR 0004 sections 7 and 8).
// It reads the catalog, the findings and `scope.checks` of the report. It never invents a selection:
// a check counts as selected only where an artifact index lists it in `scope.checks` (owner decision, 2026-11-04).
import { ABSOLUTE_ARTIFACTS, findingBasis, findingLayer, isPlain } from '../../../src/report/catalog.js';
import { artifactIndex } from '../../../src/report/classify.js';

const WORST = ['failed', 'incompatible', 'missing'];

// The words of the absolute basis (ADR 0004 section 8). Class words stay as DESIGN.md sets them.
export const CHECK_LABELS = Object.freeze({ violation: 'violation', clean: 'no finding', switchedOff: 'switched off', notSelected: 'not selected on this target' });

export function locationText(location) {
	if (!isPlain(location)) return '';
	if (typeof location.selector === 'string') return location.selector;
	if (typeof location.file !== 'string') return '';
	return [location.file, location.line, location.line === undefined ? undefined : location.column].filter((part) => part !== undefined).join(':');
}

// The check of a finding for display: id, title and layer from the catalog.
export function checkLabel(report, finding) {
	if (!finding?.checkId) return null;
	const entry = isPlain(report?.checks) && isPlain(report.checks[finding.checkId]) ? report.checks[finding.checkId] : null;
	return { id: finding.checkId, title: typeof entry?.title === 'string' ? entry.title : finding.checkId, layer: findingLayer(report, finding), basis: findingBasis(report, finding) };
}

function selectedIds(report, kind) {
	const ids = new Set();
	for (const target of report.entries ?? []) {
		const indexes = [target.artifacts?.[kind], ...(target.viewports ?? []).map((row) => row.artifacts?.[kind])];
		for (const index of indexes) if (Array.isArray(index?.scope?.checks)) for (const id of index.scope.checks) ids.add(id);
	}
	return ids;
}

// kinds: the artifact kinds that the Evidence view shows now. viewportId: the selected viewport, or null.
// Returns { fired, other }. Each item: { id, title, layer, count, label, state, reason, owner }.
export function checksFor(report, target, { viewportId = null, kinds = [] } = {}) {
	const catalog = isPlain(report?.checks) ? report.checks : {};
	const wanted = [...new Set(kinds)].filter((kind) => ABSOLUTE_ARTIFACTS.includes(kind) || kind === 'content' || kind === 'lighthouse');
	const candidates = wanted.flatMap((kind) => [artifactIndex(target, null, kind), artifactIndex(target, viewportId, kind)].filter(Boolean).map((index) => ({ kind, index })));
	const fired = [], other = [];
	for (const [id, entry] of Object.entries(catalog)) {
		if (entry?.basis !== 'absolute') continue;
		const findings = (report.findings ?? []).filter((finding) => finding.targetId === target.id && finding.checkId === id && wanted.includes(finding.artifact)
			&& (viewportId === null || finding.viewportId == null || finding.viewportId === viewportId));
		const scoped = candidates.filter(({ index }) => Array.isArray(index.scope?.checks) && index.scope.checks.includes(id));
		const recorded = candidates.filter(({ index }) => Array.isArray(index.scope?.checks));
		const override = (report.overrides ?? []).find((item) => item.checkId === id && (!isPlain(item.scope) || !Array.isArray(item.scope.targets) || item.scope.targets.includes(target.id)));
		// A check that is neither selected here nor fired here says nothing about this evidence, unless another artifact of the report selects it.
		const selectedElsewhere = wanted.some((kind) => selectedIds(report, kind).has(id));
		if (!findings.length && !scoped.length && !override && !(recorded.length && selectedElsewhere)) continue;
		const states = scoped.map(({ index }) => index.state).filter(Boolean);
		const state = WORST.find((item) => states.includes(item)) ?? (states.length ? 'complete' : null);
		const item = { id, title: typeof entry.title === 'string' ? entry.title : id, layer: findingLayer(report, { layer: entry.layer }), count: findings.length, state: state === 'complete' ? null : state, reason: null, owner: null, label: null };
		if (override) Object.assign(item, { label: CHECK_LABELS.switchedOff, state: 'missing', reason: override.reason, owner: override.owner });
		else if (findings.length) item.label = CHECK_LABELS.violation;
		else if (scoped.length) item.label = state === 'complete' ? CHECK_LABELS.clean : null;
		else item.label = CHECK_LABELS.notSelected;
		(findings.length ? fired : other).push(item);
	}
	return { fired, other };
}

// One line for each absolute artifact index in view: kind, state and the executed checks (R9.9).
export function absoluteResults(target, { viewportId = null } = {}) {
	return ABSOLUTE_ARTIFACTS.flatMap((kind) => [[null, artifactIndex(target, null, kind)], [viewportId, viewportId === null ? undefined : artifactIndex(target, viewportId, kind)]]
		.filter(([, index]) => index).map(([where, index]) => ({ kind, scope: where === null ? 'target' : 'viewport', state: index.state, diagnostic: typeof index.diagnostic === 'string' ? index.diagnostic : null,
			checks: Number.isSafeInteger(index.result?.checks) ? index.result.checks : null, violations: typeof index.result?.violations === 'boolean' ? index.result.violations : null })));
}
