import { adaptReport } from '../report/model.js';
import { droppedWarnings, droppedNotListed } from '../report/dropped.js';
import { summarize, targetClass, targetState } from '../report/classify.js';
import { isHash } from '../rules/model.js';
import { noFixtureIds } from '../report/scope.js';

// Bounded detail lists with counts over the full report (R11.1–R11.6).
export function summarizeReport(input, { maxTargets = 20, filter = 'all', target } = {}) {
	if (!Number.isInteger(maxTargets) || maxTargets < 1 || maxTargets > 1000) throw new Error('maxTargets must be an integer from 1 to 1000.');
	const allowed = ['all', 'match', 'explained', 'unexplained', 'oracle', 'incomplete', 'availability'];
	if (!allowed.includes(filter)) throw new Error('Unknown summary filter.');
	const report = adaptReport(input);
	if (target != null && !report.entries.some((entry) => entry.id === target)) throw new Error('Unknown target.');
	const rows = report.entries.map((entry) => ({ id: entry.id, class: targetClass(report, entry), state: targetState(entry), availability: !report.pair ? [] : entry.viewports.flatMap((row) => ['a', 'b'].map(side => [side, row.availability?.[side] ?? 'unknown']).filter(([, state]) => state !== 'ok').map(([side, state]) => ({ viewport: row.id, side, state }))) }));
	const problems = rows.filter((row) => row.availability.length);
	const selected = rows.filter((row) => (target == null || row.id === target) && (filter === 'all' || filter === row.class || filter === 'incomplete' && row.state !== 'complete' || filter === 'availability' && row.availability.length));
	const aggregate = summarize(report);
	const noFixture = noFixtureIds(report);
	const warnings = droppedWarnings(report).filter((item) => target == null || item.id === target);
	const requests = warnings.reduce((sum, item) => sum + item.count, 0);
	const notListed = target == null ? droppedNotListed(report) : droppedNotListed({ entries: report.entries.filter((entry) => entry.id === target) });
	// A target with a gap has a content difference that lists lines on one side only (#281). One integer,
	// so the answer stays bounded. The key appears only above zero, so the pinned output stays the same.
	const lineGapTargets = report.entries.filter((entry) => (target == null || entry.id === target)
		&& entry.viewports.some((row) => Number.isSafeInteger(row.artifacts?.content?.diff?.lineGaps) && row.artifacts.content.diff.lineGaps > 0)).length;
	return {
		pair: report.pair ?? null,
		subject: report.subject ? { kind: report.subject.kind, runId: String(report.subject.runId).slice(0, 200), ...(isHash(report.subject.key) ? { key: report.subject.key } : {}) } : null,
		verdict: aggregate.counts.incomplete ? 'incomplete' : problems.length ? 'availability-problems' : aggregate.counts.unexplained ? 'unexplained' : aggregate.counts.oracle ? 'oracle-review' : aggregate.counts.explained ? 'explained' : aggregate.counts.unclassified ? 'no-comparable-evidence' : 'match',
		counts: aggregate.counts, states: aggregate.states,
		availabilityCount: problems.length,
		...(lineGapTargets ? { lineGapTargets } : {}),
		targets: selected.slice(0, maxTargets).map((row) => ({ ...row, availability: row.availability.slice(0, 10), availabilityOmitted: Math.max(0, row.availability.length - 10) })), omitted: selected.length > maxTargets ? selected.length - maxTargets : 0,
		unexplainedTargets: rows.filter((row) => row.class === 'unexplained' && (target == null || row.id === target)).slice(0, maxTargets).map((row) => row.id),
		unexplainedOmitted: Math.max(0, rows.filter((row) => row.class === 'unexplained' && (target == null || row.id === target)).length - maxTargets),
		availabilityProblems: problems.filter((row) => target == null || row.id === target).slice(0, maxTargets).map((row) => ({ id: row.id })),
		availabilityOmitted: Math.max(0, problems.filter((row) => target == null || row.id === target).length - maxTargets),
		// R3.8: a font or a stylesheet request aborted on a side. The verdict stays as it is.
		// droppedRequestCount is the number of aborted font and stylesheet requests: the sum of the
		// counts, the same number the viewer shows. droppedWarnings lists the groups (side, type, origin).
		// droppedNotListed counts aborted requests that the capture cut from its 50-entry list.
		// The keys appear only when one of them is above zero, so the pinned output stays the same.
		...(warnings.length || notListed ? { droppedRequestCount: requests, droppedWarnings: warnings.slice(0, maxTargets), droppedWarningsOmitted: Math.max(0, warnings.length - maxTargets), droppedNotListed: notListed } : {}),
		// Owner decision on #94: components the styleguide lists with no fixture. They are not targets. Bounded like other lists.
		...(noFixture.length ? { noFixture: { count: noFixture.length, ids: noFixture.slice(0, maxTargets), omitted: Math.max(0, noFixture.length - maxTargets) } } : {}),
		// R4.5: cells outside a recorded selection or filter. The key appears only when the report skipped one, so the pinned output stays the same.
		...(Number.isSafeInteger(report.meta?.skipped) && report.meta.skipped > 0 ? { skipped: report.meta.skipped } : {}),
		next: ['Open the report with test-kit serve.', 'Use summary --filter unexplained or --filter incomplete for scoped evidence.'],
	};
}
