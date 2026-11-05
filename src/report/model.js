import { normalizeKnown, normalizeRules, isHash } from '../rules/model.js';
import { relativePath } from './safe.js';
import {
	ABSOLUTE_ARTIFACTS, ARTIFACT_KINDS, BASES, BUILTIN_CONTENT_CHECKS, CHECK_ID, ENTRY_KINDS, IMPLICIT_ARTIFACTS, LAYERS,
	LEGACY_BEHAVIOR_CHECK, LEGACY_BEHAVIOR_ID, LIGHTHOUSE_CAUSE_CHECK, LIGHTHOUSE_CHECKS, PROJECT_TARGET,
	TARGET_SCOPE_ARTIFACTS, findingBasis, isPlain,
} from './catalog.js';

export const SCHEMA_VERSION = 3;
export const PAIR_KINDS = ['convergence', 'self-baseline', 'update', 'migration', 'deploy', 'adhoc'];
const STATES = ['complete', 'missing', 'failed', 'incompatible'];
const MAX_CHECKS = 500;
const MAX_LOCATION_TEXT = 500;

// Version 1 (no schemaVersion) to version 2. The result is a version 2 object.
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

// Version 2 to version 3 (R9.1). It drops nothing and it adds only what the old file can prove:
// a `checks` catalog for the checks that fired, `checkId` where the old finding names its check
// (a speed finding names it by `cause`), and `runId` on absolute findings.
// It adds no `scope`: a version 2 file does not record the selection, so no selection is claimed.
// A behavior finding of version 2 names a step id, not a contract. It gets one legacy entry.
export function adaptV2(input) {
	const checks = isPlain(input.checks) ? { ...input.checks } : {};
	const bRunId = input.pair?.bRunId;
	const findings = Array.isArray(input.findings) ? input.findings.map((finding) => {
		if (!isPlain(finding) || finding.checkId != null) {
			const known = isPlain(finding) && Object.hasOwn(BUILTIN_CONTENT_CHECKS, finding.checkId) ? BUILTIN_CONTENT_CHECKS[finding.checkId] : null;
			if (known && !Object.hasOwn(checks, finding.checkId)) checks[finding.checkId] = { ...known };
			return known && known.basis === 'absolute' && finding.runId === undefined && bRunId !== undefined ? { ...finding, runId: bRunId } : finding;
		}
		if (finding.artifact === 'behavior') {
			checks[LEGACY_BEHAVIOR_ID] ??= { ...LEGACY_BEHAVIOR_CHECK };
			return { ...finding, checkId: LEGACY_BEHAVIOR_ID };
		}
		if (finding.artifact === 'lighthouse' && Object.hasOwn(LIGHTHOUSE_CAUSE_CHECK, finding.cause)) {
			const checkId = LIGHTHOUSE_CAUSE_CHECK[finding.cause];
			checks[checkId] ??= { ...LIGHTHOUSE_CHECKS[checkId] };
			return { ...finding, checkId, ...(LIGHTHOUSE_CHECKS[checkId].basis === 'absolute' && bRunId !== undefined ? { runId: bRunId } : {}) };
		}
		return finding;
	}) : input.findings;
	return { ...input, schemaVersion: SCHEMA_VERSION, checks, findings };
}

const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const positiveInteger = (value) => Number.isSafeInteger(value) && value >= 1 && value <= 100_000_000;

// A bounded location: { file, line?, column? } or { selector } (R9.11).
function validLocation(location) {
	if (!isPlain(location)) return false;
	const keys = Object.keys(location);
	if (keys.includes('selector')) return keys.length === 1 && text(location.selector, MAX_LOCATION_TEXT);
	if (!keys.includes('file') || keys.some((key) => !['file', 'line', 'column'].includes(key))) return false;
	if (!text(location.file, MAX_LOCATION_TEXT)) return false;
	if (location.line !== undefined && !positiveInteger(location.line)) return false;
	if (location.column !== undefined && (!positiveInteger(location.column) || location.line === undefined)) return false;
	return true;
}

function validCatalog(catalog, problems, subject) {
	if (!isPlain(catalog)) { problems.push('checks must be an object.'); return; }
	const ids = Object.keys(catalog);
	if (ids.length > MAX_CHECKS) problems.push('checks lists too many checks.');
	for (const id of ids) {
		const entry = catalog[id];
		if (!CHECK_ID.test(id)) problems.push('Invalid check id.');
		if (!isPlain(entry)) { problems.push('Check needs a basis of absolute or relative.'); continue; }
		if (!BASES.includes(entry.basis)) problems.push('Check needs a basis of absolute or relative.');
		if (!LAYERS.includes(entry.layer)) problems.push('Check needs a layer.');
		if (!text(entry.title, 200)) problems.push('Check needs a title.');
		if (subject && entry.basis === 'relative') problems.push('A subject report holds no relative check.');
	}
}

function validOverrides(overrides, catalog, problems) {
	if (overrides === undefined) return;
	if (!Array.isArray(overrides) || overrides.length > MAX_CHECKS) { problems.push('overrides must be an array.'); return; }
	for (const item of overrides) {
		if (!isPlain(item) || !text(item.reason, 1000) || !text(item.owner, 200) || !LAYERS.includes(item.layer)
			|| (item.scope !== undefined && !isPlain(item.scope))) problems.push('Invalid override.');
		else if (typeof item.checkId !== 'string' || !Object.hasOwn(catalog, item.checkId)) problems.push('An override names a check that is not in the catalog.');
	}
}

// One artifact index. An absolute index has `evidence` and `result` and no side A, side B or difference (R9.9).
function validArtifact(problems, kind, artifact, { absolute, catalog }) {
	if (!STATES.includes(artifact.state)) problems.push('Unknown artifact measurement state.');
	if (artifact.scope !== undefined) {
		const list = artifact.scope?.checks;
		if (!isPlain(artifact.scope) || !Array.isArray(list) || list.length > MAX_CHECKS || new Set(list).size !== list.length
			|| list.some((id) => typeof id !== 'string')) problems.push('Invalid artifact scope.');
		else if (list.some((id) => !Object.hasOwn(catalog, id))) problems.push('scope.checks names a check that is not in the catalog.');
	}
	if (absolute) {
		if (['a', 'b', 'diff', 'normalizedA', 'normalizedB'].some((side) => artifact[side] != null)) problems.push('An absolute artifact has no a, b or diff.');
		if (artifact.state === 'complete') {
			const evidence = artifact.evidence;
			if (!isPlain(evidence) || typeof evidence.src !== 'string'
				|| !['tool', 'version', 'settingsHash'].every((key) => typeof evidence[key] === 'string' && evidence[key].length > 0 && evidence[key].length <= 200)) problems.push('A complete absolute artifact needs indexed evidence.');
			const result = artifact.result;
			if (!isPlain(result) || typeof result.violations !== 'boolean' || !Number.isSafeInteger(result.checks) || result.checks < 0) problems.push('A complete absolute artifact needs a result.');
			else if (result.checks === 0) problems.push('A complete artifact needs at least one executed check.');
		}
		const src = artifact.evidence?.src;
		if (src != null && (!relativePath(src) || src.length > 2000 || !src.endsWith('.json'))) problems.push('Unsafe artifact path.');
		return;
	}
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

export function validateReport(report) {
	const problems = [];
	const array = (value) => Array.isArray(value);
	if (!report || typeof report !== 'object' || array(report)) return ['Report must be an object.'];
	if (report.schemaVersion !== SCHEMA_VERSION) problems.push('Unsupported report schema version.');
	for (const field of ['runs', 'entries', 'causes', 'findings']) if (!array(report[field])) problems.push(`${field} must be an array.`);
	if (!array(report.meta?.viewports)) problems.push('meta.viewports must be an array.');
	if (!Number.isFinite(report.meta?.matchBelow) || report.meta.matchBelow < 0 || report.meta.matchBelow > 100) problems.push('matchBelow must be a percentage from 0 to 100.');
	// R4.5: an optional record of the compared scope. It claims nothing about a report that has none.
	if (report.meta?.skipped !== undefined && (!Number.isSafeInteger(report.meta.skipped) || report.meta.skipped < 0)) problems.push('meta.skipped must be a non-negative integer.');
	if (report.meta?.scope !== undefined) {
		const scope = report.meta.scope;
		const selection = (value) => value === null || (isPlain(value) && Object.keys(value).every((axis) => ['targets', 'viewports'].includes(axis)
			&& array(value[axis]) && value[axis].length <= 1000 && value[axis].every((id) => typeof id === 'string')));
		if (!isPlain(scope) || !['a', 'b', 'filter'].every((key) => selection(scope[key])) || Object.keys(scope).length !== 3) problems.push('Invalid meta.scope.');
	}
	// R9.7: exactly one of pair and subject.
	const hasPair = report.pair !== undefined, hasSubject = report.subject !== undefined;
	const subject = hasSubject && !hasPair;
	if (hasPair === hasSubject) problems.push('A report has exactly one of pair and subject.');
	else if (hasPair && !PAIR_KINDS.includes(report.pair?.kind)) problems.push('Unknown pair kind.');
	else if (hasSubject && (!isPlain(report.subject) || report.subject.kind !== 'single-run' || typeof report.subject.runId !== 'string')) problems.push('Unknown subject kind.');
	const identity = hasPair ? report.pair : hasSubject ? report.subject : undefined;
	if (subject) {
		if (report.known_diffs !== undefined) problems.push('A subject report holds no known_diffs.');
		if (!isPlain(report.rules) || Object.keys(report.rules).length) problems.push('A subject report holds rules: {}.');
	}
	if (report.known_diffs !== undefined && !subject) {
		try { normalizeKnown(report.known_diffs); } catch { problems.push('Invalid known difference evidence.'); }
	}
	if (report.meta?.comparisonPolicyHash !== undefined) {
		if (!isHash(report.meta.comparisonPolicyHash) || !isHash(identity?.key)) problems.push('Invalid comparison policy identity.');
		try { normalizeRules(report.rules); } catch { problems.push('Invalid evidenced rules.'); }
	} else if (subject && identity?.key !== undefined) problems.push('A subject key needs a comparison policy hash.');
	validCatalog(report.checks, problems, subject);
	const catalog = isPlain(report.checks) ? report.checks : {};
	validOverrides(report.overrides, catalog, problems);
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
	if (subject) { if (!runIds.has(report.subject.runId)) problems.push('Subject refers to an unknown run.'); }
	else if (!runIds.has(report.pair.aRunId) || !runIds.has(report.pair.bRunId)) problems.push('Pair refers to an unknown run.');
	const artifactProblems = (kind, artifact) => {
		if (artifact === null || artifact === undefined) return;
		if (!ARTIFACT_KINDS.includes(kind)) { problems.push('Unknown artifact kind.'); return; }
		if (!isPlain(artifact)) { problems.push('Invalid artifact index.'); return; }
		if (subject && ['html', 'status'].includes(kind)) { problems.push('A subject report holds no comparison artifact.'); return; }
		validArtifact(problems, kind, artifact, { absolute: subject || ABSOLUTE_ARTIFACTS.includes(kind), catalog });
	};
	for (const target of report.entries) {
		if (!target || !array(target.viewports)) { problems.push('Target viewports must be an array.'); continue; }
		if (target.kind !== undefined && !ENTRY_KINDS.includes(target.kind)) problems.push('Unknown entry kind.');
		if ((target.kind === 'project') !== (target.id === PROJECT_TARGET)) problems.push('The project entry has the id @project and the kind project.');
		if (target.artifacts !== undefined && !isPlain(target.artifacts)) problems.push('Target artifacts must be an object.');
		// R9.9: an absolute result at target scope.
		for (const [kind, artifact] of Object.entries(isPlain(target.artifacts) ? target.artifacts : {})) {
			if (kind === 'screenshot') problems.push('Unknown artifact kind.');
			else artifactProblems(kind, artifact);
		}
		ids(target.viewports, 'target.viewports');
		for (const row of target.viewports) {
			if (!row || !viewportIds.has(row.id)) { problems.push('Unknown target viewport.'); continue; }
			const state = row.state ?? (row.error ? 'failed' : 'complete');
			if (!STATES.includes(state)) problems.push('Unknown measurement state.');
			const ratio = row.ratio ?? row.artifacts?.screenshot?.diff?.ratio;
			if (state === 'complete' && (row.artifacts?.screenshot || !ARTIFACT_KINDS.some(kind => row.artifacts?.[kind])) && (!Number.isFinite(ratio) || ratio < 0 || ratio > 100)) problems.push('A complete measurement needs a percentage ratio.');
			for (const kind of Object.keys(isPlain(row.artifacts) ? row.artifacts : {})) {
				if (kind === 'screenshot') continue;
				artifactProblems(kind, row.artifacts[kind]);
			}
			if (row.artifacts?.screenshot && subject) problems.push('A subject report holds no comparison artifact.');
			for (const shot of Object.values(row.artifacts?.screenshot ?? {})) {
				if (shot?.src != null && !relativePath(shot.src)) problems.push('Unsafe artifact path.');
			}
		}
	}
	const entryKind = (id) => report.entries.find((entry) => entry?.id === id)?.kind;
	for (const finding of report.findings) {
		if (!finding || !targetIds.has(finding.targetId)) { problems.push('Finding refers to an unknown target.'); continue; }
		if (finding.viewportId != null && !viewportIds.has(finding.viewportId)) problems.push('Finding refers to an unknown viewport.');
		if (finding.causeId != null && !causeIds.has(finding.causeId)) problems.push('Finding refers to an unknown cause.');
		if (!ARTIFACT_KINDS.includes(finding.artifact)) { problems.push('Finding names an unknown artifact.'); continue; }
		// R8.11 and R9.8: a finding names a check of the catalog, except a screenshot or html finding.
		if (IMPLICIT_ARTIFACTS.includes(finding.artifact)) {
			if (finding.checkId != null) problems.push('A screenshot or html finding has no checkId.');
		} else if (typeof finding.checkId !== 'string' || !finding.checkId) problems.push('A finding of this artifact needs a checkId.');
		else if (!Object.hasOwn(catalog, finding.checkId)) problems.push('A finding names a check that is not in the catalog.');
		const basis = findingBasis(report, finding);
		if (subject && basis === 'relative') problems.push('A subject report holds no relative finding.');
		if (ABSOLUTE_ARTIFACTS.includes(finding.artifact) && basis !== 'absolute') problems.push('A lint or a11y finding comes from an absolute check.');
		// R9.8: only an absolute finding carries a run, and the run belongs to the report.
		if (basis === 'relative') { if (finding.runId !== undefined) problems.push('A relative finding has no runId.'); }
		else {
			const allowed = subject ? [report.subject.runId] : [report.pair.aRunId, report.pair.bRunId];
			if (typeof finding.runId !== 'string' || !allowed.includes(finding.runId)) problems.push('An absolute finding needs a runId that names a run of the report.');
		}
		if (finding.layer !== undefined && !LAYERS.includes(finding.layer)) problems.push('Unknown finding layer.');
		if (finding.location !== undefined && !validLocation(finding.location)) problems.push('Invalid finding location.');
		// R9.11: a lint finding has a location and no viewport. Its target is a component or the project entry.
		if (TARGET_SCOPE_ARTIFACTS.includes(finding.artifact)) {
			if (finding.viewportId != null) problems.push('A lint finding has no viewportId.');
			if (finding.location === undefined) problems.push('A lint finding needs a location.');
			if (!['component', 'project'].includes(entryKind(finding.targetId))) problems.push('A lint finding names a component or the project entry.');
		}
	}
	return problems;
}

// Reads any supported version and returns a validated version 3 report (R9.1).
export function adaptReport(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Report must be an object.');
	const version = input.schemaVersion;
	let report = input;
	if (version == null || version === 1) report = adaptV2(adaptV1(input));
	else if (version === 2) report = adaptV2(input);
	const problems = validateReport(report);
	if (problems.length) throw new Error(`Invalid report: ${problems.join(' ')}`);
	return report;
}
