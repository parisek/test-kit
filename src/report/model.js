import { normalizeKnown, normalizeRules, isHash } from '../rules/model.js';
import { relativePath } from './safe.js';

export const PAIR_KINDS = ['convergence', 'self-baseline', 'update', 'migration', 'deploy', 'adhoc'];
const STATES = ['complete', 'missing', 'failed', 'incompatible'];

export function adaptV1(input) {
	if (input.entries != null && !Array.isArray(input.entries)) throw new Error('Legacy entries must be an array.');
	const meta = input.meta ?? {};
	const entries = (input.entries ?? []).map((entry) => ({
		...entry, kind: entry.kind ?? 'component', title: entry.title ?? entry.id,
		path: entry.path ?? entry.selector ?? entry.source ?? '/', group: entry.category ?? 'other',
		viewports: (entry.viewports ?? []).map((row) => ({
			...row, ratio: Number.isFinite(row.ratio) ? row.ratio : null,
			state: row.error ? 'failed' : Number.isFinite(row.ratio) ? 'complete' : 'missing',
			artifacts: { ...row.artifacts, screenshot: {
				a: row.shots?.target ? { src: row.shots.target } : null,
				b: row.shots?.render ? { src: row.shots.render } : null,
				diff: row.shots?.diff ? { src: row.shots.diff } : null,
			} },
		})),
	}));
	return {
		...input, schemaVersion: 2, legacy: input,
		meta: { ...meta, matchBelow: 3, viewports: meta.viewports ?? [], noiseFloor: null },
		runs: [{ id: 'reference', side: 'reference' }, { id: 'render', side: 'styleguide' }],
		pair: { kind: 'convergence', aRunId: 'reference', bRunId: 'render' },
		entries, causes: [], findings: entries.flatMap((target) => target.viewports
			.filter((row) => row.state === 'complete' && row.ratio > 0)
			.map((row) => ({ id: `legacy-${target.id}-${row.id}`, targetId: target.id, viewportId: row.id, artifact: 'screenshot' }))), rules: {},
	};
}

export function validateReport(report) {
	const problems = [];
	const array = (value) => Array.isArray(value);
	if (!report || typeof report !== 'object' || array(report)) return ['Report must be an object.'];
	if (report.schemaVersion !== 2) problems.push('Unsupported report schema version.');
	for (const field of ['runs', 'entries', 'causes', 'findings']) if (!array(report[field])) problems.push(`${field} must be an array.`);
	if (!array(report.meta?.viewports)) problems.push('meta.viewports must be an array.');
	if (!Number.isFinite(report.meta?.matchBelow) || report.meta.matchBelow < 0 || report.meta.matchBelow > 100) problems.push('matchBelow must be a percentage from 0 to 100.');
	if (!PAIR_KINDS.includes(report.pair?.kind)) problems.push('Unknown pair kind.');
	if (report.known_diffs !== undefined) {
		try { normalizeKnown(report.known_diffs); } catch { problems.push('Invalid known difference evidence.'); }
	}
	if (report.meta?.comparisonPolicyHash !== undefined) {
		if (!isHash(report.meta.comparisonPolicyHash) || !isHash(report.pair?.key)) problems.push('Invalid comparison policy identity.');
		try { normalizeRules(report.rules); } catch { problems.push('Invalid evidenced rules.'); }
	}
	if (problems.length) return problems;
	const ids = (rows, field) => {
		const out = new Set();
		for (const row of rows) {
			if (!row || typeof row.id !== 'string' || !row.id || out.has(row.id)) problems.push(`${field} contains an invalid or duplicate id.`);
			else out.add(row.id);
		}
		return out;
	};
	const targetIds = ids(report.entries, 'entries');
	const viewportIds = ids(report.meta.viewports, 'viewports');
	const causeIds = ids(report.causes, 'causes');
	for (const cause of report.causes) if (cause && Object.hasOwn(cause, 'acceptance') && !['normalization', 'recorded-evidence'].includes(cause.acceptance)) problems.push('Invalid scoped cause acceptance.');
	const runIds = ids(report.runs, 'runs');
	if (!runIds.has(report.pair.aRunId) || !runIds.has(report.pair.bRunId)) problems.push('Pair refers to an unknown run.');
	for (const target of report.entries) {
		if (!target || !array(target.viewports)) { problems.push('Target viewports must be an array.'); continue; }
		ids(target.viewports, 'target.viewports');
		for (const row of target.viewports) {
			if (!row || !viewportIds.has(row.id)) { problems.push('Unknown target viewport.'); continue; }
			const state = row.state ?? (row.error ? 'failed' : 'complete');
			if (!STATES.includes(state)) problems.push('Unknown measurement state.');
			const ratio = row.ratio ?? row.artifacts?.screenshot?.diff?.ratio;
			if (state === 'complete' && (row.artifacts?.screenshot || (!row.artifacts?.html && !row.artifacts?.status && !row.artifacts?.content && !row.artifacts?.behavior)) && (!Number.isFinite(ratio) || ratio < 0 || ratio > 100)) problems.push('A complete measurement needs a percentage ratio.');
			for (const kind of ['html', 'status', 'content', 'behavior']) {
				const artifact = row.artifacts?.[kind];
				if (!artifact) continue;
				if (!STATES.includes(artifact.state)) problems.push('Unknown artifact measurement state.');
				if (artifact.state === 'complete') {
					for (const side of ['a', 'b', 'diff']) {
						const index = artifact[side];
						if (!index || typeof index.src !== 'string'
							|| !['tool', 'version', 'settingsHash'].every(key => typeof index[key] === 'string' && index[key].length > 0 && index[key].length <= 200)) problems.push('Complete artifact needs indexed provenance.');
					}
					if (typeof artifact.diff?.changed !== 'boolean') problems.push('Complete artifact needs a comparison result.');
				}
				for (const side of ['a', 'b', 'diff', 'normalizedA', 'normalizedB']) {
					const index = artifact[side];
					if (index?.src != null && (!relativePath(index.src) || index.src.length > 2000
						|| !index.src.endsWith(kind === 'html' && side !== 'diff' ? '.txt' : '.json'))) problems.push('Unsafe artifact path.');
				}
			}
			for (const shot of Object.values(row.artifacts?.screenshot ?? {})) {
				if (shot?.src != null && !relativePath(shot.src)) problems.push('Unsafe artifact path.');
			}
		}
	}
	for (const finding of report.findings) {
		if (!finding || !targetIds.has(finding.targetId)) { problems.push('Finding refers to an unknown target.'); continue; }
		if (finding.viewportId != null && !viewportIds.has(finding.viewportId)) problems.push('Finding refers to an unknown viewport.');
		if (finding.causeId != null && !causeIds.has(finding.causeId)) problems.push('Finding refers to an unknown cause.');
	}
	return problems;
}

export function adaptReport(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Report must be an object.');
	const report = input.schemaVersion == null || input.schemaVersion === 1 ? adaptV1(input) : input;
	const problems = validateReport(report);
	if (problems.length) throw new Error(`Invalid report: ${problems.join(' ')}`);
	return report;
}
