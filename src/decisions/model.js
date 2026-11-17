// Pure decision logic (R4.4, R9.14, #350 part C). No file system, no clock, no hash, no Node module.
// The viewer bundles this file through `rules/classify.js` and `report/model.js`.
// A decision answers one layout difference of a design pair: `implement` or `report-only`. It binds the key of the
// difference (target, viewport, part, property) and the design value at the time, through a fingerprint.
// The producer computes the fingerprints and the statuses. The classifier reads only the report.
import { isHash } from '../rules/model.js';
import { isPlain } from '../report/catalog.js';
import { PART, PROPERTY } from '../layout/compare.js';

export const DECISIONS_FILE = 'test-kit.decisions.json';
export const DECISIONS_SCHEMA_VERSION = 1;
export const MAX_ENTRIES = 500;
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_REPORT_ENTRIES = 100;
export const DECISIONS = Object.freeze(['implement', 'report-only']);
// `active`: a difference has the key and the fingerprint. `stale`: a difference has the key, and the design value
// moved. `absent`: the layout artifact of the cell is complete and no difference has the key. `unchecked`: the cell has
// no complete layout artifact in this report.
export const STATUSES = Object.freeze(['active', 'stale', 'absent', 'unchecked']);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const FILE_KEYS = ['targetId', 'viewportId', 'part', 'property', 'decision', 'designValue', 'fingerprint', 'reason', 'owner'];
const REPORT_KEYS = [...FILE_KEYS, 'status', 'diagnostic'];
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
// A design value has the shape of a value in the layout difference sidecar (src/layout/compare.js).
export const validDesignValue = (value) => value === null || (typeof value === 'number' && Number.isFinite(value))
	|| (typeof value === 'string' && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value));

// The key of a difference. Two entries with one key and other fingerprints answer two design values.
export const decisionKey = (item) => `${item.targetId}\u0000${item.viewportId}\u0000${item.part}\u0000${item.property}`;
const entryKey = (item) => `${decisionKey(item)}\u0000${item.fingerprint}`;

// The first problem of one entry, or null. `keys` lists the keys that the entry holds.
function entryProblem(entry, keys) {
	if (!isPlain(entry)) return 'The entry must be an object.';
	const unknown = Object.keys(entry).find((key) => !keys.includes(key));
	if (unknown !== undefined) return `The key ${JSON.stringify(unknown.slice(0, 40))} is not allowed.`;
	if (typeof entry.targetId !== 'string' || !ID.test(entry.targetId)) return 'targetId must be a target id.';
	if (typeof entry.viewportId !== 'string' || !ID.test(entry.viewportId)) return 'viewportId must be a viewport id.';
	if (typeof entry.part !== 'string' || !PART.test(entry.part)) return 'part must be a layout part id, with [index] for a repeat.';
	if (typeof entry.property !== 'string' || !PROPERTY.test(entry.property)) return 'property must be a layout property, part or count.';
	if (!DECISIONS.includes(entry.decision)) return 'decision must be implement or report-only.';
	if (!Object.hasOwn(entry, 'designValue') || !validDesignValue(entry.designValue)) return 'designValue must be null, a number or text of up to 200 characters.';
	if (!isHash(entry.fingerprint)) return 'fingerprint must be a sha256 hash.';
	if (!text(entry.reason, 1000)) return 'reason is required: 1 to 1000 characters, no control character.';
	if (!text(entry.owner, 200)) return 'owner is required: 1 to 200 characters, no control character.';
	return null;
}

// Validates the parsed decisions file and returns a clean copy. It throws on the first problem.
// A rejected file never falls back to an empty list. The fingerprint check needs a hash, so `file.js` adds it.
export function normalizeDecisions(input) {
	const fail = (message) => { throw new Error(`Invalid decisions: ${message}`); };
	if (!isPlain(input)) fail('the file must hold an object.');
	const unknown = Object.keys(input).find((key) => !['schemaVersion', 'entries'].includes(key));
	if (unknown !== undefined) fail(`the key ${JSON.stringify(unknown.slice(0, 40))} is not allowed.`);
	if (input.schemaVersion !== DECISIONS_SCHEMA_VERSION) fail(`schemaVersion must be ${DECISIONS_SCHEMA_VERSION}.`);
	if (!Array.isArray(input.entries)) fail('entries must be an array.');
	if (input.entries.length > MAX_ENTRIES) fail(`the file holds more than ${MAX_ENTRIES} entries.`);
	const seen = new Set();
	const entries = Array.from({ length: input.entries.length }, (_, index) => {
		const entry = input.entries[index];
		const problem = entryProblem(entry, FILE_KEYS);
		if (problem) fail(`entry ${index + 1}: ${problem}`);
		if (seen.has(entryKey(entry))) fail(`entry ${index + 1} repeats the difference and the design value of an earlier entry.`);
		seen.add(entryKey(entry));
		return Object.fromEntries(FILE_KEYS.map((name) => [name, entry[name]]));
	});
	return { schemaVersion: DECISIONS_SCHEMA_VERSION, entries };
}

// Parses the bytes of the file. The caller has already limited the size (MAX_FILE_BYTES).
export function parseDecisions(bytes) {
	if (bytes.length > MAX_FILE_BYTES) throw new Error('Invalid decisions: the file is larger than 1 MB.');
	let value;
	try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Invalid decisions: the file is not JSON.'); }
	return normalizeDecisions(value);
}

const ORDER = new Map(STATUSES.map((status, index) => [status, index]));
const shown = (value) => (value === null ? 'none' : String(value)).slice(0, 120);

// The producer decides the status of each entry once (R9.14). `entries` come from the file. `cells` maps
// `<target>\0<viewport>` to `{ state, differences: [{ part, property, designValue, fingerprint }] }`: the layout artifact of
// each compared cell, with the full list of its differences and the fingerprint of the design value of each.
// Only a report with a design run passes cells. An entry whose target or viewport the report does not hold is not copied.
// Returns { decisions, omitted }: at most 100 entries, the active ones first.
export function decisionsForReport(entries, cells) {
	const decided = [];
	for (const entry of entries) {
		const cell = cells.get(`${entry.targetId}\u0000${entry.viewportId}`);
		if (cell === undefined) continue;
		if (cell.state !== 'complete') { decided.push({ entry, status: 'unchecked', diagnostic: 'The layout artifact of this cell is not complete, so the entry proves nothing.' }); continue; }
		const same = cell.differences.filter((item) => item.part === entry.part && item.property === entry.property);
		if (same.some((item) => item.fingerprint === entry.fingerprint)) decided.push({ entry, status: 'active' });
		else if (same.length) decided.push({ entry, status: 'stale', diagnostic: `The design value moved: recorded ${shown(entry.designValue)}, now ${shown(same[0].designValue)}. Decide again.` });
		else decided.push({ entry, status: 'absent', diagnostic: 'No layout difference has this key in this report.' });
	}
	const ordered = decided.map((item, index) => ({ ...item, index })).sort((a, b) => ORDER.get(a.status) - ORDER.get(b.status) || a.index - b.index);
	const decisions = ordered.slice(0, MAX_REPORT_ENTRIES).map(({ entry, status, diagnostic }) => ({ ...entry, status, ...(diagnostic ? { diagnostic } : {}) }));
	return { decisions, omitted: Math.max(0, ordered.length - decisions.length) };
}

// The label of one difference: the active entry of its key, else a stale one, else null. A label never explains.
export function decisionLabel(decisions, item) {
	const same = decisions.filter((entry) => decisionKey(entry) === decisionKey(item));
	const entry = same.find((candidate) => candidate.status === 'active' && candidate.fingerprint === item.fingerprint)
		?? same.find((candidate) => candidate.status === 'stale');
	return entry ? { decision: entry.decision, status: entry.status } : null;
}

// R9.14: a layout finding is explained exactly when the report holds an active `report-only` entry with the same key
// and the fingerprint of the finding. `implement` never explains: it labels. A finding without a fingerprint, or a
// report without a pair, is never explained. This fails closed.
export function isDecided(report, finding) {
	if (finding?.artifact !== 'layout' || !isHash(finding.designFingerprint) || !isPlain(report?.pair) || !Array.isArray(report?.decisions)) return false;
	return report.decisions.slice(0, MAX_REPORT_ENTRIES).some((entry) => isPlain(entry) && entry.status === 'active' && entry.decision === 'report-only'
		&& entry.targetId === finding.targetId && entry.viewportId === finding.viewportId && entry.part === finding.part
		&& entry.property === finding.property && entry.fingerprint === finding.designFingerprint);
}

// The first problem of one entry of `report.decisions`, or null.
export function reportEntryProblem(entry, { targetIds, viewportIds }) {
	if (entryProblem(entry, REPORT_KEYS)) return 'Invalid decision entry.';
	if (!STATUSES.includes(entry.status)) return 'A decision entry needs a known status.';
	if (entry.diagnostic !== undefined && !text(entry.diagnostic, 1000)) return 'A decision diagnostic must be bounded text.';
	if (!targetIds.has(entry.targetId)) return 'A decision entry names an unknown target.';
	if (!viewportIds.has(entry.viewportId)) return 'A decision entry names an unknown viewport.';
	return null;
}

// The entries of `report.decisions` and the decision keys of the layout findings, checked by the report validator.
export function validateReportDecisions(report, context, problems) {
	if (report.decisions !== undefined) {
		if (!Array.isArray(report.decisions) || report.decisions.length > MAX_REPORT_ENTRIES) problems.push('decisions must be an array of at most 100 entries.');
		else if (report.pair === undefined) problems.push('A subject report holds no decisions.');
		else for (const entry of report.decisions) {
			const problem = reportEntryProblem(entry, context);
			if (problem) problems.push(problem);
		}
	}
	const omitted = report.meta?.decisionsOmitted;
	if (omitted !== undefined && (!Number.isSafeInteger(omitted) || omitted < 1)) problems.push('meta.decisionsOmitted must be a positive integer.');
	for (const finding of Array.isArray(report.findings) ? report.findings : []) {
		if (!isPlain(finding)) continue;
		if (finding.designFingerprint !== undefined && !isHash(finding.designFingerprint)) problems.push('A design fingerprint must be a sha256 hash.');
		if (finding.part !== undefined && !(typeof finding.part === 'string' && PART.test(finding.part))) problems.push('A finding part must be a layout part id.');
		if (finding.property !== undefined && !(typeof finding.property === 'string' && PROPERTY.test(finding.property))) problems.push('A finding property must be a layout property.');
		if (finding.decision !== undefined && !(isPlain(finding.decision) && Object.keys(finding.decision).length === 2
			&& DECISIONS.includes(finding.decision.decision) && ['active', 'stale'].includes(finding.decision.status))) problems.push('Invalid finding decision.');
	}
}

// The count of entries for each status. Used by `summary` and `query`. Run data is untrusted, so only known statuses count.
export function decisionCounts(report, targetId) {
	const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
	if (!Array.isArray(report?.decisions)) return counts;
	for (const entry of report.decisions) {
		if (isPlain(entry) && STATUSES.includes(entry.status) && (targetId == null || entry.targetId === targetId)) counts[entry.status]++;
	}
	return counts;
}
