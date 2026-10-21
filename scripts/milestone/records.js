// Parse and validate a review record (docs/process-skills.md, "Review record" and "Record validation").
// Pure functions. No file system, no network. The record text is untrusted input: it is parsed as data only.

export const MARKER = '<!-- test-kit-review -->';

const FIELDS_PR = ['mode', 'reviewer', 'sha', 'verdict', 'principle', 'tier', 'requirements', 'default_behavior', 'evidence', 'unverified', 'security', 'unexpected_files', 'tests', 'risk', 'citations'];
const FIELDS_ISSUE = ['mode', 'reviewer', 'verdict', 'principle', 'tier', 'requirements', 'default_behavior', 'security', 'risk', 'citations'];
const VERDICTS = ['fits', 'needs-owner', 'conflicts'];
const REVIEWERS = ['codex', 'claude', 'author'];
const LISTS = ['evidence', 'unverified', 'requirements', 'citations'];

const nonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const nonEmptyList = (value) => Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);

// Returns { ok: true, record } or { ok: false, errors: [...] }.
export function parseRecord(body) {
	if (typeof body !== 'string') return { ok: false, errors: ['The comment is not text.'] };
	const lines = body.split(/\r?\n/);
	if (lines[0]?.trim() !== MARKER) return { ok: false, errors: ['The first line is not the marker.'] };
	const blocks = [...body.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)];
	if (blocks.length !== 1) return { ok: false, errors: [`Expected exactly one JSON block, found ${blocks.length}.`] };
	try {
		const record = JSON.parse(blocks[0][1]);
		if (record === null || typeof record !== 'object' || Array.isArray(record)) return { ok: false, errors: ['The JSON block is not an object.'] };
		return { ok: true, record };
	} catch (error) {
		return { ok: false, errors: [`The JSON block does not parse: ${error.message}`] };
	}
}

// options: { headSha, requirementIds } (requirementIds is a Set of R-numbers from the base specification).
export function validateRecord(record, { headSha, requirementIds } = {}) {
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
			if (typeof id !== 'string' || !/^R[0-9]+(\.[0-9]+)?$/.test(id)) errors.push(`requirements entry is not an R-number: ${String(id).slice(0, 40)}.`);
			else if (requirementIds && !requirementIds.has(id)) errors.push(`requirements entry is not in the specification: ${id}.`);
		}
	}
	if (Array.isArray(record.citations)) for (const entry of record.citations) {
		if (typeof entry !== 'string' || !/^[^\s:][^\s]*:[0-9]+$/.test(entry) || entry.startsWith('/') || entry.split(':')[0].split('/').includes('..')) errors.push(`citations entry is not path:line: ${String(entry).slice(0, 60)}.`);
	}
	if (mode === 'pr') {
		if (typeof record.sha !== 'string' || !/^[0-9a-f]{40}$/.test(record.sha)) errors.push('sha must be 40 hex characters.');
		else if (headSha && record.sha !== headSha) errors.push('sha differs from the head SHA.');
		for (const field of ['unexpected_files']) if (!nonEmptyString(record[field])) errors.push(`${field} must be non-empty text.`);
		if (!nonEmptyString(record.tests) || !(['present', 'docs-only'].includes(record.tests) || /^none: .+/.test(record.tests))) errors.push('tests must be present, docs-only or "none: <reason>".');
	}
	return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

// The content rules for a merge (docs/process-skills.md, "Record validation", content rules).
// Returns the list of reasons the record does not count as an approval. An empty list means approve.
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

// R-numbers defined in the specification text ("- R10.4 ..." at the start of a line).
export function requirementIdsFrom(specText) {
	return new Set([...specText.matchAll(/^(?:- )?\*{0,2}(R[0-9]+(?:\.[0-9]+)?)\b/gm)].map((match) => match[1]));
}
