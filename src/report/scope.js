// The scope of a report: what the pair compared and what it skipped (R4.5, #287).
// Pure logic, shared by the viewer. The numbers come from the report alone, so a reader needs no other file.
// A report without `meta.scope` is a full report: it has no scope and this returns null.
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// `of` counts are derived. The report keeps the full viewport lists of both runs in `runs[].settings`,
// and `meta.skipped` is (all targets x all viewports) - compared cells. The target total follows from both.
// When the report does not allow that derivation, the total is null and the sentence names no total.
export function reportScope(report) {
	const meta = report?.meta;
	if (!meta || meta.scope === undefined || !Number.isSafeInteger(meta.skipped)) return null;
	const entries = (report.entries ?? []).filter((entry) => entry.kind !== 'project');
	const cells = entries.reduce((sum, entry) => sum + (entry.viewports?.length ?? 0), 0);
	const viewportIds = (meta.viewports ?? []).map((viewport) => viewport.id);
	const declared = new Set((report.runs ?? []).flatMap((run) => (run.settings?.viewports ?? []).map((viewport) => viewport.id)));
	const ofViewports = declared.size >= viewportIds.length && declared.size > 0 ? declared.size : null;
	const allCells = cells + meta.skipped;
	// The total is shown only when it is provably right: every compared target has one row for each compared viewport
	// (so the compared cells are a full grid), and the cells divide by the declared viewports with no rest.
	const grid = entries.every((entry) => entry.viewports?.length === viewportIds.length
		&& entry.viewports.every((row) => viewportIds.includes(row.id)));
	const ofTargets = grid && ofViewports !== null && allCells % ofViewports === 0 && allCells / ofViewports >= entries.length ? allCells / ofViewports : null;
	return {
		targets: entries.length, ofTargets,
		viewports: viewportIds.length, ofViewports,
		skipped: meta.skipped,
		targetIds: entries.map((entry) => entry.id),
		viewportIds,
		a: meta.scope.a ?? null, b: meta.scope.b ?? null, filter: meta.scope.filter ?? null,
	};
}

// The one line of the report header. "Scope: 2 of 63 targets, 1 of 4 viewports. 250 cells skipped."
export function scopeLine(scope) {
	const skipped = scope.skipped === 0 ? 'No cells skipped.' : `${plural(scope.skipped, 'cell')} skipped.`;
	if (scope.ofTargets !== null && scope.ofViewports !== null) {
		return `Scope: ${scope.targets} of ${plural(scope.ofTargets, 'target')}, ${scope.viewports} of ${plural(scope.ofViewports, 'viewport')}. ${skipped}`;
	}
	return `Scope: ${plural(scope.targets, 'target')}, ${plural(scope.viewports, 'viewport')} compared. ${skipped}`;
}
