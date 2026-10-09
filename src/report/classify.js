import { findingIsExplained } from '../rules/classify.js';
export { findingIsExplained } from '../rules/classify.js';
// Shared pure classification for the viewer and queries (R4.4, R11.6).
export const CLASSES = ['unexplained', 'explained', 'oracle', 'match'];

export function findingsFor(report, targetId, { viewportId = null, artifact = null } = {}) {
	return report.findings.filter((finding) => finding.targetId === targetId
		&& (artifact === null || finding.artifact === artifact)
		&& (viewportId === null || finding.viewportId == null || finding.viewportId === viewportId));
}

export function causeIsKnown(report, causeId) {
	return report.causes.some((cause) => cause.id === causeId && cause.known === true);
}

export function cellState(target, viewportId) {
	const cell = target.viewports.find((row) => row.id === viewportId);
	const stored = cell?.state ?? (cell?.error ? 'failed' : cell ? 'complete' : 'missing');
	const states = [stored, cell?.artifacts?.html?.state, cell?.artifacts?.screenshot?.state, cell?.artifacts?.content?.state].filter(Boolean);
	if (cell?.artifacts?.status && !cell.artifacts.html && !cell.artifacts.screenshot && !cell.artifacts.content) states.push(cell.artifacts.status.state);
	return ['failed', 'incompatible', 'missing'].find(state => states.includes(state)) ?? stored;
}

export function cellClass(report, target, viewportId) {
	if (cellState(target, viewportId) !== 'complete') return null;
	const contentCell = target.viewports.find(row => row.id === viewportId);
	if (contentCell?.artifacts?.content && !contentCell.artifacts.screenshot && !contentCell.artifacts.html && !contentCell.artifacts.content.diff?.checks) return null;
	const cell = target.viewports.find((row) => row.id === viewportId);
	if (cell?.artifacts?.status && !cell.artifacts.screenshot && !cell.artifacts.html && !cell.artifacts.content) return null;
	if (target.judge === 'oracle') return 'oracle';
	const findings = findingsFor(report, target.id, { viewportId }).filter(finding => finding.artifact !== 'status');
	if (findings.length) return findings.every((finding) => findingIsExplained(report, finding)) ? 'explained' : 'unexplained';
	return 'match';
}

export function targetState(target) {
	const states = target.viewports.map((row) => cellState(target, row.id));
	return ['failed', 'incompatible', 'missing'].find((state) => states.includes(state)) ?? (states.length ? 'complete' : 'missing');
}

export function targetClass(report, target) {
	const values = target.viewports.map((row) => cellClass(report, target, row.id)).filter((value) => value !== null);
	const findings = findingsFor(report, target.id).filter((finding) => {
		if (finding.artifact === 'status') return false;
		if (!['screenshot', 'html'].includes(finding.artifact)) return true;
		if (finding.artifact === 'html' && finding.viewportId == null) return true;
		const row = target.viewports.find(row => row.id === finding.viewportId);
		return row?.artifacts?.[finding.artifact]?.state === 'complete';
	});
	if (findings.length) values.push(target.judge === 'oracle' ? 'oracle' : findings.every((finding) => findingIsExplained(report, finding)) ? 'explained' : 'unexplained');
	return CLASSES.find((value) => values.includes(value)) ?? null;
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
