// Parse and validate a review record (docs/process.md, section 5).
// Pure functions: no file system, no network. The record text is untrusted input and is parsed as data only.
// Port of scripts/milestone/records.js in parisek/test-kit, with a configurable identifier pattern.
// The same file lives in every repository of the standard; change them together (docs/process.md, section 1).

export const MARKER = '<!-- agent:review -->';
// Markers of the repositories before they adopted the plugin. They count until each repository moves.
export const LEGACY_MARKERS = ['<!-- test-kit-review -->', '<!-- styleguide-review -->'];

const FIELDS_PR = ['mode', 'reviewer', 'sha', 'verdict', 'principle', 'tier', 'requirements', 'default_behavior', 'evidence', 'unverified', 'security', 'unexpected_files', 'tests', 'risk', 'citations'];
const FIELDS_ISSUE = ['mode', 'reviewer', 'verdict', 'principle', 'tier', 'requirements', 'default_behavior', 'security', 'risk', 'citations'];
const VERDICTS = ['fits', 'needs-owner', 'conflicts'];
const REVIEWERS = ['codex', 'claude', 'author'];
const LISTS = ['evidence', 'unverified', 'requirements', 'citations'];
export const DEFAULT_REQUIREMENT_PATTERN = '^(?:- )?\\*{0,2}(R[0-9]+(?:\\.[0-9]+)?)\\b';

const nonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const nonEmptyList = (value) => Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);

// Returns { ok: true, record, marker } or { ok: false, errors: [...] }.
export function parseRecord(body) {
	if (typeof body !== 'string') return { ok: false, errors: ['The comment is not text.'] };
	const marker = body.split(/\r?\n/)[0]?.trim();
	if (marker !== MARKER && !LEGACY_MARKERS.includes(marker)) return { ok: false, errors: ['The first line is not the marker.'] };
	const blocks = [...body.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)];
	if (blocks.length !== 1) return { ok: false, errors: [`Expected exactly one JSON block, found ${blocks.length}.`] };
	try {
		const record = JSON.parse(blocks[0][1]);
		if (record === null || typeof record !== 'object' || Array.isArray(record)) return { ok: false, errors: ['The JSON block is not an object.'] };
		return { ok: true, record, marker };
	} catch (error) {
		return { ok: false, errors: [`The JSON block does not parse: ${error.message}`] };
	}
}

export const R_NUMBER = /^R[0-9]+(\.[0-9]+)?$/;

// options: { headSha, requirementIds, idFormat }. requirementIds: a Set of identifiers from the base branch's
// normative source. idFormat: the shape of one identifier; R-numbers by default, null for a custom source.
export function validateRecord(record, { headSha, requirementIds, idFormat = R_NUMBER } = {}) {
	const errors = [];
	const mode = record.mode;
	if (mode !== 'pr' && mode !== 'issue') return { ok: false, errors: ['mode must be "pr" or "issue".'] };
	const fields = mode === 'pr' ? FIELDS_PR : FIELDS_ISSUE;
	for (const field of fields) if (!Object.hasOwn(record, field)) errors.push(`Missing field: ${field}.`);
	for (const field of Object.keys(record)) if (!fields.includes(field)) errors.push(`Unknown field: ${field}.`);
	if (errors.length) return { ok: false, errors };

	if (!REVIEWERS.includes(record.reviewer)) errors.push('reviewer must be codex, claude or author.');
	if (!VERDICTS.includes(record.verdict)) errors.push('verdict must be fits, needs-owner or conflicts.');
	if (!Number.isInteger(record.principle) || record.principle < 1) errors.push('principle must be a positive integer.');
	if (![1, 2, 3].includes(record.tier)) errors.push('tier must be 1, 2 or 3.');
	for (const field of ['default_behavior', 'security', 'risk']) if (!nonEmptyString(record[field])) errors.push(`${field} must be non-empty text.`);
	for (const field of LISTS.filter((name) => fields.includes(name))) if (!nonEmptyList(record[field])) errors.push(`${field} must be a non-empty list of non-empty text.`);

	if (Array.isArray(record.requirements)) {
		const isNone = record.requirements.length === 1 && record.requirements[0] === 'none';
		if (!isNone) for (const id of record.requirements) {
			if (idFormat && (typeof id !== 'string' || !idFormat.test(id))) errors.push(`requirements entry is not an ${idFormat === R_NUMBER ? 'R-number' : 'identifier'}: ${String(id).slice(0, 40)}.`);
			else if (requirementIds && !requirementIds.has(id)) errors.push(`requirements entry is not in the specification: ${String(id).slice(0, 40)}.`);
		}
	}
	if (Array.isArray(record.citations)) for (const entry of record.citations) {
		if (typeof entry !== 'string' || !/^[^\s:][^\s]*:[0-9]+(-[0-9]+)?$/.test(entry) || entry.startsWith('/') || entry.split(':')[0].split('/').includes('..')) errors.push(`citations entry is not path:line or path:start-end: ${String(entry).slice(0, 60)}.`);
	}
	if (mode === 'pr') {
		if (typeof record.sha !== 'string' || !/^[0-9a-f]{40}$/.test(record.sha)) errors.push('sha must be 40 hex characters.');
		else if (headSha && record.sha !== headSha) errors.push('sha differs from the head SHA.');
		if (!nonEmptyString(record.unexpected_files)) errors.push('unexpected_files must be non-empty text.');
		if (!nonEmptyString(record.tests) || !(['present', 'docs-only'].includes(record.tests) || /^none: .+/.test(record.tests))) errors.push('tests must be present, docs-only or "none: <reason>".');
	}
	return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

// Reasons the record does not count as an approval (docs/process.md, section 5). Empty means approve.
export function approvalBlockers(record) {
	const blockers = [];
	if (record.mode !== 'pr') blockers.push('A record in mode issue never counts as a merge review.');
	if (record.verdict !== 'fits') blockers.push(`verdict is ${record.verdict}.`);
	if (record.reviewer === 'author') blockers.push('The author is not a reviewer.');
	if (record.tier === 3) blockers.push('tier is 3.');
	if (record.default_behavior !== 'none') blockers.push('default_behavior is not none.');
	if (record.security !== 'none') blockers.push('security is not none.');
	if (record.unexpected_files !== 'none') blockers.push('unexpected_files is not none.');
	if (record.risk !== 'none') blockers.push('risk is not none.');
	if (!['present', 'docs-only'].includes(record.tests)) blockers.push('tests is not present or docs-only.');
	return blockers;
}

// Identifiers defined in the normative source text: the first capture group of each match, line by line.
export function requirementIdsFrom(sourceText, pattern = DEFAULT_REQUIREMENT_PATTERN) {
	const regex = new RegExp(pattern, 'gm');
	return new Set([...sourceText.matchAll(regex)].map((match) => match[1]).filter(Boolean));
}
