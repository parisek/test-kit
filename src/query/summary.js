import { adaptReport } from '../report/model.js';
import { droppedWarnings, droppedNotListed } from '../report/dropped.js';
import { warningTotals } from '../report/warnings.js';
import { summarize, targetClass, targetState } from '../report/classify.js';
import { isHash } from '../rules/model.js';
import { noFixtureIds } from '../report/scope.js';
import { allowlistCounts } from '../allowlist/model.js';
import { layoutTotals } from '../report/layout.js';
import { clip, markCut, wasCut, outputBytes, OUTPUT_BYTE_LIMIT } from './bound.js';

const ID = 200;
const cut = (id) => markCut(id, ID);
const flag = (id) => wasCut(id, ID) ? { idTruncated: true } : {};
// R11.2: copy the documented keys of pair. A run id longer than the limit ends with an ellipsis and sets its own flag,
// so a reader sees the cut. Other keys of a report file never reach the agent.
const safePair = (pair) => pair ? {
	kind: clip(pair.kind, 64),
	aRunId: cut(pair.aRunId), ...(wasCut(pair.aRunId, ID) ? { aRunIdTruncated: true } : {}),
	bRunId: cut(pair.bRunId), ...(wasCut(pair.bRunId, ID) ? { bRunIdTruncated: true } : {}),
	...(isHash(pair.key) ? { key: pair.key } : {}),
} : null;

// Bounded detail lists with counts over the full report (R11.1–R11.6).
export function summarizeReport(input, { maxTargets = 20, filter = 'all', target } = {}) {
	if (!Number.isInteger(maxTargets) || maxTargets < 1 || maxTargets > 1000) throw new Error('maxTargets must be an integer from 1 to 1000.');
	const allowed = ['all', 'match', 'explained', 'unexplained', 'oracle', 'incomplete', 'availability'];
	if (!allowed.includes(filter)) throw new Error('Unknown summary filter.');
	const report = adaptReport(input);
	if (target != null && !report.entries.some((entry) => entry.id === target)) throw new Error('Unknown target.');
	const rows = report.entries.map((entry) => ({ id: entry.id, class: targetClass(report, entry), state: targetState(entry), availability: !report.pair ? [] : entry.viewports.flatMap((row) => ['a', 'b'].map(side => [side, row.availability?.[side] ?? 'unknown']).filter(([, state]) => state !== 'ok').map(([side, state]) => ({ viewport: cut(row.id), side, state }))) }));
	const problems = rows.filter((row) => row.availability.length);
	const selected = rows.filter((row) => (target == null || row.id === target) && (filter === 'all' || filter === row.class || filter === 'incomplete' && row.state !== 'complete' || filter === 'availability' && row.availability.length));
	const aggregate = summarize(report);
	const noFixture = noFixtureIds(report);
	const warnings = droppedWarnings(report).filter((item) => target == null || item.id === target);
	const requests = warnings.reduce((sum, item) => sum + item.count, 0);
	const notListed = target == null ? droppedNotListed(report) : droppedNotListed({ entries: report.entries.filter((entry) => entry.id === target) });
	// R5.11: capture warnings by code. The verdict stays as it is.
	const captureWarnings = warningTotals(target == null ? report : { entries: report.entries.filter((entry) => entry.id === target) });
	// A target with a gap has a content difference that lists lines on one side only (#281). One integer,
	// so the answer stays bounded. The key appears only above zero, so the pinned output stays the same.
	const lineGapTargets = report.entries.filter((entry) => (target == null || entry.id === target)
		&& entry.viewports.some((row) => Number.isSafeInteger(row.artifacts?.content?.diff?.lineGaps) && row.artifacts.content.diff.lineGaps > 0)).length;
	// R6.15: layout differences by kind. The key appears only above zero, so the pinned output stays the same.
	const layout = layoutTotals(report, target);
	const allowlisted = { counts: allowlistCounts(report, target) };
	allowlisted.total = Object.values(allowlisted.counts).reduce((sum, count) => sum + count, 0);
	// One answer for a number of listed targets. The count limit comes first. The byte limit cuts further.
	const build = (max) => ({
		pair: safePair(report.pair),
		subject: report.subject ? { kind: clip(report.subject.kind, 64), runId: cut(String(report.subject.runId)), ...(wasCut(String(report.subject.runId), ID) ? { runIdTruncated: true } : {}), ...(isHash(report.subject.key) ? { key: report.subject.key } : {}) } : null,
		verdict: aggregate.counts.incomplete ? 'incomplete' : problems.length ? 'availability-problems' : aggregate.counts.unexplained ? 'unexplained' : aggregate.counts.oracle ? 'oracle-review' : aggregate.counts.explained ? 'explained' : aggregate.counts.unclassified ? 'no-comparable-evidence' : 'match',
		counts: aggregate.counts, states: aggregate.states,
		availabilityCount: problems.length,
		...(lineGapTargets ? { lineGapTargets } : {}),
		targets: selected.slice(0, max).map((row) => ({ ...row, id: cut(row.id), ...flag(row.id), availability: row.availability.slice(0, 10), availabilityOmitted: Math.max(0, row.availability.length - 10) })), omitted: Math.max(0, selected.length - max),
		unexplainedTargets: rows.filter((row) => row.class === 'unexplained' && (target == null || row.id === target)).slice(0, max).map((row) => cut(row.id)),
		unexplainedOmitted: Math.max(0, rows.filter((row) => row.class === 'unexplained' && (target == null || row.id === target)).length - max),
		availabilityProblems: problems.filter((row) => target == null || row.id === target).slice(0, max).map((row) => ({ id: cut(row.id), ...flag(row.id) })),
		availabilityOmitted: Math.max(0, problems.filter((row) => target == null || row.id === target).length - max),
		// R3.8: a font or a stylesheet request aborted on a side. The verdict stays as it is.
		// droppedRequestCount is the number of aborted font and stylesheet requests: the sum of the
		// counts, the same number the viewer shows. droppedWarnings lists the groups (side, type, origin).
		// droppedNotListed counts aborted requests that the capture cut from its 50-entry list.
		// The keys appear only when one of them is above zero, so the pinned output stays the same.
		...(warnings.length || notListed ? { droppedRequestCount: requests, droppedWarnings: warnings.slice(0, max).map((item) => ({ ...item, id: cut(item.id), ...flag(item.id), viewport: cut(item.viewport) })), droppedWarningsOmitted: Math.max(0, warnings.length - max), droppedNotListed: notListed } : {}),
		// R5.11: one entry for each warning code: the cells that carry it and the sum of the counts. The key appears only above zero.
		...(captureWarnings.length ? { captureWarnings: captureWarnings.slice(0, max), captureWarningsOmitted: Math.max(0, captureWarnings.length - max) } : {}),
		// Owner decision on #94: components the styleguide lists with no fixture. They are not targets. Bounded like other lists.
		...(noFixture.length ? { noFixture: { count: noFixture.length, ids: noFixture.slice(0, max), omitted: Math.max(0, noFixture.length - max) } } : {}),
		// R9.12: the allowlist entries of the report, counted by status. The key appears only when the report holds an entry, so the pinned output stays the same.
		...(allowlisted.total ? { allowlist: allowlisted.counts } : {}),
		...(Object.keys(layout).length ? { layout } : {}),
		// R4.5: cells outside a recorded selection or filter. The key appears only when the report skipped one, so the pinned output stays the same.
		...(Number.isSafeInteger(report.meta?.skipped) && report.meta.skipped > 0 ? { skipped: report.meta.skipped } : {}),
		next: ['Open the report with test-kit serve.', 'Use summary --filter unexplained or --filter incomplete for scoped evidence.'],
	});
	let answer = build(maxTargets);
	// R11.2: halve the listed targets until the answer fits. The omitted counts say what the cut left out.
	for (let max = maxTargets; outputBytes(answer) > OUTPUT_BYTE_LIMIT && max > 0;) answer = build(max = Math.floor(max / 2));
	return answer;
}
