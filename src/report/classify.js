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
	return cell?.state ?? (cell?.error ? 'failed' : cell ? 'complete' : 'missing');
}

export function cellClass(report, target, viewportId) {
	if (cellState(target, viewportId) !== 'complete') return null;
	if (target.judge === 'oracle') return 'oracle';
	const cell = target.viewports.find((row) => row.id === viewportId);
	const findings = findingsFor(report, target.id, { viewportId, artifact: 'screenshot' });
	if (findings.length) return findings.every((finding) => causeIsKnown(report, finding.causeId)) ? 'explained' : 'unexplained';
	if (report.legacy) return cell.ratio < report.meta.matchBelow || cell.ratio === 0 ? 'match' : 'unexplained';
	return 'match';
}

export function targetState(target) {
	const states = target.viewports.map((row) => cellState(target, row.id));
	return ['failed', 'incompatible', 'missing'].find((state) => states.includes(state)) ?? (states.length ? 'complete' : 'missing');
}

export function targetClass(report, target) {
	if (targetState(target) !== 'complete') return null;
	const values = target.viewports.map((row) => cellClass(report, target, row.id));
	const findings = findingsFor(report, target.id).filter((finding) => !['status', 'screenshot'].includes(finding.artifact));
	if (findings.length) values.push(findings.every((finding) => causeIsKnown(report, finding.causeId)) ? 'explained' : 'unexplained');
	return CLASSES.find((value) => values.includes(value)) ?? 'match';
}

export function summarize(report) {
	const counts = { match: 0, explained: 0, unexplained: 0, oracle: 0, incomplete: 0, total: report.entries.length };
	const states = { complete: 0, missing: 0, failed: 0, incompatible: 0 };
	for (const target of report.entries) {
		states[targetState(target)]++;
		counts[targetClass(report, target) ?? 'incomplete']++;
	}
	return { counts, states };
}
