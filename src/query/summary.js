import { adaptReport } from '../report/model.js';
import { droppedWarnings, droppedNotListed } from '../report/dropped.js';
import { summarize, targetClass, targetState } from '../report/classify.js';
import { isHash } from '../rules/model.js';
import { clip, outputBytes, OUTPUT_BYTE_LIMIT } from './bound.js';

// R11.2: copy the documented keys of pair, and cut each id. Other keys of a report file never reach the agent.
const safePair = (pair) => pair ? { kind: clip(pair.kind, 64), aRunId: clip(pair.aRunId, 200), bRunId: clip(pair.bRunId, 200), ...(isHash(pair.key) ? { key: pair.key } : {}) } : null;
const ID = 200;
const cut = (id) => typeof id === 'string' ? id.slice(0, ID) : '';

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
	const warnings = droppedWarnings(report).filter((item) => target == null || item.id === target);
	const requests = warnings.reduce((sum, item) => sum + item.count, 0);
	const notListed = target == null ? droppedNotListed(report) : droppedNotListed({ entries: report.entries.filter((entry) => entry.id === target) });
	// One answer for a number of listed targets. The count limit comes first. The byte limit cuts further.
	const build = (max) => ({
		pair: safePair(report.pair),
		subject: report.subject ? { kind: clip(report.subject.kind, 64), runId: String(report.subject.runId).slice(0, 200), ...(isHash(report.subject.key) ? { key: report.subject.key } : {}) } : null,
		verdict: aggregate.counts.incomplete ? 'incomplete' : problems.length ? 'availability-problems' : aggregate.counts.unexplained ? 'unexplained' : aggregate.counts.oracle ? 'oracle-review' : aggregate.counts.explained ? 'explained' : aggregate.counts.unclassified ? 'no-comparable-evidence' : 'match',
		counts: aggregate.counts, states: aggregate.states,
		availabilityCount: problems.length,
		targets: selected.slice(0, max).map((row) => ({ ...row, id: cut(row.id), availability: row.availability.slice(0, 10), availabilityOmitted: Math.max(0, row.availability.length - 10) })), omitted: Math.max(0, selected.length - max),
		unexplainedTargets: rows.filter((row) => row.class === 'unexplained' && (target == null || row.id === target)).slice(0, max).map((row) => cut(row.id)),
		unexplainedOmitted: Math.max(0, rows.filter((row) => row.class === 'unexplained' && (target == null || row.id === target)).length - max),
		availabilityProblems: problems.filter((row) => target == null || row.id === target).slice(0, max).map((row) => ({ id: cut(row.id) })),
		availabilityOmitted: Math.max(0, problems.filter((row) => target == null || row.id === target).length - max),
		// R3.8: a font or a stylesheet request aborted on a side. The verdict stays as it is.
		// droppedRequestCount is the number of aborted font and stylesheet requests: the sum of the
		// counts, the same number the viewer shows. droppedWarnings lists the groups (side, type, origin).
		// droppedNotListed counts aborted requests that the capture cut from its 50-entry list.
		// The keys appear only when one of them is above zero, so the pinned output stays the same.
		...(warnings.length || notListed ? { droppedRequestCount: requests, droppedWarnings: warnings.slice(0, max).map((item) => ({ ...item, id: cut(item.id), viewport: cut(item.viewport) })), droppedWarningsOmitted: Math.max(0, warnings.length - max), droppedNotListed: notListed } : {}),
		next: ['Open the report with test-kit serve.', 'Use summary --filter unexplained or --filter incomplete for scoped evidence.'],
	});
	let answer = build(maxTargets);
	// R11.2: halve the listed targets until the answer fits. The omitted counts say what the cut left out.
	for (let max = maxTargets; outputBytes(answer) > OUTPUT_BYTE_LIMIT && max > 0;) answer = build(max = Math.floor(max / 2));
	return answer;
}
