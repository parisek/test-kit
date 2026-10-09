import { adaptReport } from '../report/model.js';
import { summarize, targetClass, targetState } from '../report/classify.js';

// Bounded detail lists with counts over the full report (R11.1–R11.6).
export function summarizeReport(input, { maxTargets = 20, filter = 'all', target } = {}) {
	if (!Number.isInteger(maxTargets) || maxTargets < 1 || maxTargets > 1000) throw new Error('maxTargets must be an integer from 1 to 1000.');
	const allowed = ['all', 'match', 'explained', 'unexplained', 'oracle', 'incomplete', 'availability'];
	if (!allowed.includes(filter)) throw new Error('Unknown summary filter.');
	const report = adaptReport(input);
	if (target != null && !report.entries.some((entry) => entry.id === target)) throw new Error('Unknown target.');
	const rows = report.entries.map((entry) => ({ id: entry.id, class: targetClass(report, entry), state: targetState(entry), availability: entry.viewports.flatMap((row) => Object.entries(row.availability ?? {}).filter(([, state]) => state !== 'ok').map(([side, state]) => ({ viewport: row.id, side, state }))) }));
	const problems = rows.filter((row) => row.availability.length);
	const selected = rows.filter((row) => (target == null || row.id === target) && (filter === 'all' || filter === row.class || filter === 'incomplete' && row.state !== 'complete' || filter === 'availability' && row.availability.length));
	const aggregate = summarize(report);
	return {
		pair: report.pair,
		verdict: aggregate.counts.incomplete ? 'incomplete' : problems.length ? 'availability-problems' : aggregate.counts.unexplained ? 'unexplained' : aggregate.counts.oracle ? 'oracle-review' : aggregate.counts.explained ? 'explained' : 'match',
		counts: aggregate.counts, states: aggregate.states,
		availabilityCount: problems.length,
		targets: selected.slice(0, maxTargets).map((row) => ({ ...row, availability: row.availability.slice(0, 10), availabilityOmitted: Math.max(0, row.availability.length - 10) })), omitted: selected.length > maxTargets ? selected.length - maxTargets : 0,
		unexplainedTargets: rows.filter((row) => row.class === 'unexplained' && (target == null || row.id === target)).slice(0, maxTargets).map((row) => row.id),
		unexplainedOmitted: Math.max(0, rows.filter((row) => row.class === 'unexplained' && (target == null || row.id === target)).length - maxTargets),
		availabilityProblems: problems.filter((row) => target == null || row.id === target).slice(0, maxTargets).map((row) => ({ id: row.id })),
		availabilityOmitted: Math.max(0, problems.filter((row) => target == null || row.id === target).length - maxTargets),
		next: ['Open the report with test-kit serve.', 'Use summary --filter unexplained or --filter incomplete for scoped evidence.'],
	};
}
