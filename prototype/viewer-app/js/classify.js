// Pure classification. No DOM, no state object: every function takes the report and the set of
// cause ids the person marked as known in this window. Tests: tests/classify.test.js.
//
// Classes: match | explained | unexplained | oracle
//   match        the difference is below the report's `matchBelow` ratio, or the artifact has no finding
//   explained    every finding on it has a known cause
//   unexplained  a finding with an unknown cause, or a ratio above the threshold with no finding at all
//   oracle       the row's ratio is not the verdict (`judge: oracle` in the upstream report). Never coloured by ratio.
export const CLASSES = ['unexplained', 'explained', 'oracle', 'match'];

// Artifacts that decide the class of a whole target. `status` is shown but does not count:
// an environment difference such as asset aggregation would otherwise mark every row.
export const ROW_ARTIFACTS = ['html', 'behavior'];

export function worst(classes) {
	for (const name of CLASSES) if (classes.includes(name)) return name;
	return 'match';
}

export function causeIsKnown(report, causeId, known = new Set()) {
	if (known.has(causeId)) return true;
	return Boolean(report.causes.find((cause) => cause.id === causeId)?.known);
}

/** Findings that apply to a target. `viewportId` null on a finding means "every viewport". */
export function findingsFor(report, targetId, { viewportId = null, artifact = null } = {}) {
	return report.findings.filter((finding) => finding.targetId === targetId
		&& (artifact == null || finding.artifact === artifact)
		&& (viewportId == null || finding.viewportId == null || finding.viewportId === viewportId));
}

function fromFindings(report, findings, known) {
	if (findings.length === 0) return null;
	return findings.every((finding) => causeIsKnown(report, finding.causeId, known)) ? 'explained' : 'unexplained';
}

export function cellClass(report, target, viewportId, known = new Set()) {
	const viewport = target.viewports.find((entry) => entry.id === viewportId);
	if (!viewport) return 'match';
	if (target.judge === 'oracle') return 'oracle';
	if (viewport.error) return 'unexplained';
	if (viewport.ratio < report.meta.matchBelow) return 'match';
	return fromFindings(report, findingsFor(report, target.id, { viewportId, artifact: 'screenshot' }), known) ?? 'unexplained';
}

export function artifactClass(report, target, artifact, known = new Set()) {
	return fromFindings(report, findingsFor(report, target.id, { artifact }), known) ?? 'match';
}

export function targetClass(report, target, known = new Set()) {
	const classes = [
		...target.viewports.map((viewport) => cellClass(report, target, viewport.id, known)),
		...ROW_ARTIFACTS.map((artifact) => artifactClass(report, target, artifact, known)),
	];
	return worst(classes);
}

export function worstRatio(target, viewportId = null) {
	const rows = viewportId ? target.viewports.filter((viewport) => viewport.id === viewportId) : target.viewports;
	return Math.max(0, ...rows.map((viewport) => viewport.ratio ?? 0));
}

export function causeStatus(report, cause, known = new Set()) {
	return causeIsKnown(report, cause.id, known) ? 'known' : 'unexplained';
}

export function summarize(report, known = new Set()) {
	const cells = { match: 0, explained: 0, unexplained: 0, oracle: 0, total: 0 };
	const targets = { match: 0, explained: 0, unexplained: 0, oracle: 0, total: 0 };
	for (const target of report.entries) {
		for (const viewport of target.viewports) {
			cells[cellClass(report, target, viewport.id, known)]++;
			cells.total++;
		}
		targets[targetClass(report, target, known)]++;
		targets.total++;
	}
	const unexplainedCauses = report.causes.filter((cause) => !causeIsKnown(report, cause.id, known)).length;
	return { cells, targets, unexplainedCauses };
}

/** Ids of the targets a cause touches, derived from the findings (single source of truth). */
export function targetsOfCause(report, causeId) {
	return [...new Set(report.findings.filter((finding) => finding.causeId === causeId).map((finding) => finding.targetId))];
}

/** Viewports a cause shows up in. Only screenshot findings carry a viewport; the other artifacts are per target. */
export function viewportsOfCause(report, causeId, targetId = null) {
	const ids = new Set();
	for (const finding of report.findings) {
		if (finding.causeId !== causeId || finding.artifact !== 'screenshot' || (targetId && finding.targetId !== targetId)) continue;
		if (finding.viewportId == null) report.meta.viewports.forEach((viewport) => ids.add(viewport.id));
		else ids.add(finding.viewportId);
	}
	return [...ids];
}

/** The targets a filter lets through. One definition for the rail, "Cíle" and "Matice". filter: all | a class name. */
export function filterTargets(report, filter = 'all', known = new Set()) {
	return filter === 'all' ? report.entries : report.entries.filter((target) => targetClass(report, target, known) === filter);
}

/** Ids a page is composed of. Version 1 reports may list objects; both forms are read. Unknown ids are kept. */
export function composedIds(target) {
	return (target.composedOf ?? []).map((item) => (typeof item === 'string' ? item : item?.id)).filter(Boolean);
}

/** Entries whose `composedOf` names the target: where a component is used. */
export function usedOn(report, targetId) {
	return report.entries.filter((entry) => composedIds(entry).includes(targetId));
}
