import { findingIsExplained } from '../rules/classify.js';
import { TARGET_SCOPE_ARTIFACTS } from './catalog.js';
export { findingIsExplained } from '../rules/classify.js';
// Shared pure classification for the viewer and queries (R4.4, R11.6).
export const CLASSES = ['unexplained', 'explained', 'oracle', 'match'];
// The order in which the Evidence view picks its first target: worst class first (#218).
export const WORST_FIRST = ['unexplained', 'explained', 'oracle', 'unclassified', 'match'];

export function findingsFor(report, targetId, { viewportId = null, artifact = null } = {}) {
	return report.findings.filter((finding) => finding.targetId === targetId
		&& (artifact === null || finding.artifact === artifact)
		&& (viewportId === null || (finding.viewportId == null ? !TARGET_SCOPE_ARTIFACTS.includes(finding.artifact) : finding.viewportId === viewportId)));
}

// The artifact index at viewport scope, or at target scope when `viewportId` is null (R9.9).
export function artifactIndex(target, viewportId, artifact) {
	if (viewportId === null || viewportId === undefined) return target.artifacts?.[artifact];
	return target.viewports.find(row => row.id === viewportId)?.artifacts?.[artifact];
}

// The number of executed checks of an artifact: `diff.checks` for a pair artifact, `result.checks` for an absolute one.
const executedChecks = (index) => index?.diff?.checks ?? index?.result?.checks;

export function causeIsKnown(report, causeId) {
	return report.causes.some((cause) => cause.id === causeId && cause.known === true);
}

export function cellState(target, viewportId) {
	const cell = target.viewports.find((row) => row.id === viewportId);
	const stored = cell?.state ?? (cell?.error ? 'failed' : cell ? 'complete' : 'missing');
	const kinds = Object.keys(cell?.artifacts ?? {}).filter(kind => kind !== 'status');
	const states = [stored, ...kinds.map(kind => cell.artifacts[kind]?.state)].filter(Boolean);
	if (cell?.artifacts?.status && !kinds.length) states.push(cell.artifacts.status.state);
	return ['failed', 'incompatible', 'missing'].find(state => states.includes(state)) ?? stored;
}

// A selected artifact keeps its state when another artifact fails (R11.6).
export function artifactState(target, viewportId, artifact) {
	if (viewportId === null || viewportId === undefined) return target.artifacts?.[artifact]?.state ?? 'missing';
	const cell = target.viewports.find(row => row.id === viewportId);
	if (!cell) return 'missing';
	const selected = cell.artifacts?.[artifact];
	const stored = cell.state ?? (cell.error ? 'failed' : 'complete');
	if (selected) return selected.state ?? stored;
	// Legacy reports store screenshot measurements on the cell itself.
	if (artifact === 'screenshot' && !cell.artifacts
		&& (Number.isFinite(cell.ratio) || cell.error || cell.state)) return stored;
	return 'missing';
}

export function artifactClass(report, target, viewportId, artifact) {
	if (artifactState(target, viewportId, artifact) !== 'complete') return null;
	const selected = artifactIndex(target, viewportId, artifact);
	if ((artifact === 'content' || selected?.result) && !(executedChecks(selected) > 0)) return null;
	if (target.judge === 'oracle') return 'oracle';
	const findings = findingsFor(report, target.id, { viewportId, artifact });
	if (findings.length) return findings.every(finding => findingIsExplained(report, finding)) ? 'explained' : 'unexplained';
	// Equal status evidence is not proof of a match (R6.1): without a finding it stays unclassified.
	return artifact === 'status' ? null : 'match';
}

export function cellClass(report, target, viewportId) {
	if (cellState(target, viewportId) !== 'complete') return null;
	const contentCell = target.viewports.find(row => row.id === viewportId);
	if (contentCell?.artifacts?.content && !contentCell.artifacts.screenshot && !contentCell.artifacts.html && !contentCell.artifacts.behavior && !(executedChecks(contentCell.artifacts.content) > 0)) return null;
	const cell = target.viewports.find((row) => row.id === viewportId);
	const statusOnly = cell?.artifacts?.status && Object.keys(cell.artifacts).every(kind => kind === 'status');
	if (target.judge === 'oracle') return statusOnly ? null : 'oracle';
	// State first (R8.7): a status finding counts only while its artifact is complete.
	const findings = findingsFor(report, target.id, { viewportId }).filter(finding => finding.artifact !== 'status' || cell?.artifacts?.status?.state === 'complete');
	if (findings.length) return findings.every((finding) => findingIsExplained(report, finding)) ? 'explained' : 'unexplained';
	// A cell with status evidence only never reads match (R6.1).
	return statusOnly ? null : 'match';
}

export function targetState(target) {
	// An artifact at target scope (a lint result) counts like a cell (R9.9).
	const states = [...target.viewports.map((row) => cellState(target, row.id)),
		...Object.values(target.artifacts ?? {}).map((artifact) => artifact?.state).filter(Boolean)];
	return ['failed', 'incompatible', 'missing'].find((state) => states.includes(state)) ?? (states.length ? 'complete' : 'missing');
}

export function targetClass(report, target) {
	const values = [...target.viewports.map((row) => cellClass(report, target, row.id)),
		...Object.keys(target.artifacts ?? {}).map((kind) => artifactClass(report, target, null, kind))].filter((value) => value !== null);
	const findings = findingsFor(report, target.id).filter((finding) => {
		if (!['screenshot', 'html', 'status'].includes(finding.artifact)) return true;
		if (finding.artifact === 'html' && finding.viewportId == null) return true;
		const row = target.viewports.find(row => row.id === finding.viewportId);
		return row?.artifacts?.[finding.artifact]?.state === 'complete';
	});
	if (findings.length) values.push(target.judge === 'oracle' ? 'oracle' : findings.every((finding) => findingIsExplained(report, finding)) ? 'explained' : 'unexplained');
	const value = CLASSES.find((value) => values.includes(value)) ?? null;
	// R8.12: a target that is not complete never reads match (issue #182).
	return value === 'match' && targetState(target) !== 'complete' ? null : value;
}

// The first target of the worst class, in list order inside a class. Null for no targets.
export function worstTarget(report, targets = report?.entries ?? []) {
	let best = null;
	let bestRank = Infinity;
	for (const target of targets) {
		const rank = WORST_FIRST.indexOf(targetClass(report, target) ?? 'unclassified');
		if (rank < bestRank) { best = target; bestRank = rank; }
	}
	return best;
}

export function summarize(report) {
	const counts = { match: 0, explained: 0, unexplained: 0, oracle: 0, unclassified: 0, incomplete: 0, total: report.entries.length };
	const states = { complete: 0, missing: 0, failed: 0, incompatible: 0 };
	for (const target of report.entries) {
		states[targetState(target)]++;
		counts[targetClass(report, target) ?? 'unclassified']++;
		if (targetState(target) !== 'complete') counts.incomplete++;
	}
	return { counts, states };
}
