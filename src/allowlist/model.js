// Pure allowlist logic (R4.4, R9.12). No file system, no clock, no Node module.
// The viewer bundles this file through `report/model.js` and `rules/classify.js`.
// The producer reads the file and the clock, and passes both in. The classifier reads only the report.
import { isHash } from '../rules/model.js';
import { CHECK_ID, PROJECT_TARGET, isPlain } from '../report/catalog.js';

export const ALLOWLIST_FILE = 'test-kit.allowlist.json';
export const ALLOWLIST_SCHEMA_VERSION = 1;
export const MAX_ENTRIES = 500;
export const MAX_FILE_BYTES = 1024 * 1024;
// The most entries one report copies (ADR 0004, "Where the pure logic reads it").
export const MAX_REPORT_ENTRIES = 100;
export const STATUSES = Object.freeze(['active', 'expired', 'stale', 'unchecked', 'wrong-basis']);
const TARGET_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const FILE_KEYS = ['checkId', 'targetId', 'fingerprint', 'reason', 'owner', 'expires', 'message'];
const REPORT_KEYS = ['checkId', 'targetId', 'fingerprint', 'reason', 'owner', 'expires', 'status', 'diagnostic'];
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);

// A real calendar date in the form YYYY-MM-DD.
export function validDate(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// The first problem of one entry, or null. `allowed` lists the keys that the entry may hold.
function entryProblem(entry, allowed) {
	if (!isPlain(entry)) return 'The entry must be an object.';
	const unknown = Object.keys(entry).find((key) => !allowed.includes(key));
	if (unknown !== undefined) return `The key ${JSON.stringify(unknown.slice(0, 40))} is not allowed.`;
	if (typeof entry.checkId !== 'string' || !CHECK_ID.test(entry.checkId)) return 'checkId must be a check id.';
	if (typeof entry.targetId !== 'string' || !(TARGET_ID.test(entry.targetId) || entry.targetId === PROJECT_TARGET)) return 'targetId must be a target id or @project.';
	if (!isHash(entry.fingerprint)) return 'fingerprint must be a sha256 hash.';
	if (!text(entry.reason, 1000)) return 'reason is required: 1 to 1000 characters, no control character.';
	if (!text(entry.owner, 200)) return 'owner is required: 1 to 200 characters, no control character.';
	if (entry.expires !== undefined && !validDate(entry.expires)) return 'expires must be a date YYYY-MM-DD.';
	if (entry.message !== undefined && !(typeof entry.message === 'string' && entry.message.length <= 300 && !/[\x00-\x1f\x7f]/.test(entry.message))) return 'message must be text of up to 300 characters.';
	return null;
}

export const tripleKey = (entry) => `${entry.checkId}\u0000${entry.targetId}\u0000${entry.fingerprint}`;

// Validates the parsed allowlist file and returns a clean copy. It throws on the first problem (ADR 0004, question 4).
// A rejected file never falls back to an empty list.
export function normalizeAllowlist(input) {
	const fail = (message) => { throw new Error(`Invalid allowlist: ${message}`); };
	if (!isPlain(input)) fail('the file must hold an object.');
	const unknown = Object.keys(input).find((key) => !['schemaVersion', 'entries'].includes(key));
	if (unknown !== undefined) fail(`the key ${JSON.stringify(unknown.slice(0, 40))} is not allowed.`);
	if (input.schemaVersion !== ALLOWLIST_SCHEMA_VERSION) fail(`schemaVersion must be ${ALLOWLIST_SCHEMA_VERSION}.`);
	if (!Array.isArray(input.entries)) fail('entries must be an array.');
	if (input.entries.length > MAX_ENTRIES) fail(`the file holds more than ${MAX_ENTRIES} entries.`);
	const seen = new Set();
	const entries = input.entries.map((entry, index) => {
		const problem = entryProblem(entry, FILE_KEYS);
		if (problem) fail(`entry ${index + 1}: ${problem}`);
		const key = tripleKey(entry);
		if (seen.has(key)) fail(`entry ${index + 1} repeats the check, the target and the fingerprint of an earlier entry.`);
		seen.add(key);
		return Object.fromEntries(FILE_KEYS.filter((name) => entry[name] !== undefined).map((name) => [name, entry[name]]));
	});
	return { schemaVersion: ALLOWLIST_SCHEMA_VERSION, entries };
}

// Parses the bytes of the file. The caller has already limited the size (MAX_FILE_BYTES).
export function parseAllowlist(bytes) {
	if (bytes.length > MAX_FILE_BYTES) throw new Error('Invalid allowlist: the file is larger than 1 MB.');
	let value;
	try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Invalid allowlist: the file is not JSON.'); }
	return normalizeAllowlist(value);
}

// The entries of `report.allowlist`, checked by the report validator (R9.12). Pushes problems.
export function validateReportAllowlist(list, { catalog, targetIds }, problems) {
	if (list === undefined) return;
	if (!Array.isArray(list) || list.length > MAX_REPORT_ENTRIES) { problems.push('allowlist must be an array of at most 100 entries.'); return; }
	for (const entry of list) {
		const problem = entryProblem(entry, REPORT_KEYS);
		if (problem) { problems.push('Invalid allowlist entry.'); continue; }
		if (!STATUSES.includes(entry.status)) problems.push('An allowlist entry needs a known status.');
		else if (entry.diagnostic !== undefined && !text(entry.diagnostic, 1000)) problems.push('An allowlist diagnostic must be bounded text.');
		else if (!Object.hasOwn(catalog, entry.checkId)) problems.push('An allowlist entry names a check that is not in the catalog.');
		else if (!targetIds.has(entry.targetId)) problems.push('An allowlist entry names an unknown target.');
		else if (entry.status === 'active' && catalog[entry.checkId]?.basis !== 'absolute') problems.push('An active allowlist entry needs an absolute check.');
	}
}

// The entries of `report.allowlist` that the viewer lists for one target (R9.12, DESIGN.md "Allowlist list").
// Run data is untrusted: an entry that fails the producer check, or has an unknown status or a bad diagnostic, is left out.
// The order of the report stays (active first). At most MAX_REPORT_ENTRIES entries are read.
export function allowlistEntriesFor(report, targetId) {
	if (!Array.isArray(report?.allowlist)) return [];
	return report.allowlist.slice(0, MAX_REPORT_ENTRIES).filter((entry) => isPlain(entry) && entry.targetId === targetId && entryProblem(entry, REPORT_KEYS) === null
		&& STATUSES.includes(entry.status) && (entry.diagnostic === undefined || text(entry.diagnostic, 1000)));
}

// R9.12: an absolute finding is explained exactly when the report holds an active entry with the same check, target and fingerprint.
// A finding with no fingerprint is never explained. The check must be an absolute check of the catalog.
export function isAllowlisted(report, finding) {
	if (!isHash(finding?.evidenceFingerprint) || !Array.isArray(report?.allowlist)) return false;
	if (finding.checkId === 'lighthouse-budget') return false; // A budget changes in the config, never in the allowlist.
	const entry = isPlain(report.checks) && typeof finding.checkId === 'string' && Object.hasOwn(report.checks, finding.checkId) ? report.checks[finding.checkId] : null;
	if (!isPlain(entry) || entry.basis !== 'absolute') return false;
	return report.allowlist.some((item) => isPlain(item) && item.status === 'active' && item.checkId === finding.checkId
		&& item.targetId === finding.targetId && item.fingerprint === finding.evidenceFingerprint);
}

// The artifact indexes of one target that select a check: at viewport scope and at target scope (R9.9, R9.10).
function selectingIndexes(target, checkId) {
	const rows = (Array.isArray(target?.viewports) ? target.viewports : []).flatMap((row) => Object.values(isPlain(row?.artifacts) ? row.artifacts : {}));
	const own = Object.values(isPlain(target?.artifacts) ? target.artifacts : {});
	return [...rows, ...own].filter((index) => isPlain(index) && Array.isArray(index.scope?.checks) && index.scope.checks.includes(checkId));
}

const ORDER = new Map(STATUSES.map((status, index) => [status, index]));

// The producer decides the status of each entry once, with the clock of the run (ADR 0004, question 4).
// `entries` come from the allowlist file. `report` holds `checks`, `entries` and `findings`. `now` is a Date.
// Returns { allowlist, omitted }. The list holds only entries whose check is in the catalog and whose target is in the report.
// Order of the decision: wrong-basis, expired, active, then stale or unchecked.
// An entry is `stale` only when every artifact index that selects the check on that target is complete and no finding has the fingerprint.
// A gap in one viewport makes it `unchecked`: the entry binds one viewport through its fingerprint, but it does not name that viewport.
export function allowlistForReport(entries, report, now) {
	const today = now.toISOString().slice(0, 10);
	const targets = new Map(report.entries.map((target) => [target.id, target]));
	const checks = isPlain(report.checks) ? report.checks : {};
	const relevant = entries.filter((entry) => Object.hasOwn(checks, entry.checkId) && targets.has(entry.targetId));
	const matches = (entry) => (finding) => finding.targetId === entry.targetId && finding.checkId === entry.checkId && finding.evidenceFingerprint === entry.fingerprint;
	const decided = relevant.map((entry) => {
		if (checks[entry.checkId].basis !== 'absolute') return { entry, status: 'wrong-basis', diagnostic: 'The check is relative. A relative finding uses known_diffs (R7.3).' };
		if (entry.expires !== undefined && today > entry.expires) return { entry, status: 'expired', diagnostic: `The entry expired on ${entry.expires}.` };
		if (report.findings.some(matches(entry))) return { entry, status: 'active' };
		const indexes = selectingIndexes(targets.get(entry.targetId), entry.checkId);
		if (!indexes.length || indexes.some((index) => index.state !== 'complete')) {
			return { entry, status: 'unchecked', diagnostic: 'The check has no complete outcome on this target, so the entry proves nothing.' };
		}
		return { entry, status: 'stale' };
	});
	const active = new Set(decided.filter((item) => item.status === 'active').map((item) => tripleKey(item.entry)));
	for (const item of decided) {
		if (item.status !== 'stale') continue;
		const current = [...new Set(report.findings
			.filter((finding) => finding.targetId === item.entry.targetId && finding.checkId === item.entry.checkId && isHash(finding.evidenceFingerprint)
				&& !active.has(tripleKey({ ...item.entry, fingerprint: finding.evidenceFingerprint })))
			.map((finding) => finding.evidenceFingerprint))];
		item.diagnostic = current.length
			? `No finding has this fingerprint. The unexplained findings of this check on this target have: ${current.slice(0, 5).join(', ')}${current.length > 5 ? `, and ${current.length - 5} more` : ''}.`
			: 'No finding of this check remains on this target.';
	}
	const ordered = decided.map((item, index) => ({ ...item, index })).sort((a, b) => ORDER.get(a.status) - ORDER.get(b.status) || a.index - b.index);
	const list = ordered.slice(0, MAX_REPORT_ENTRIES).map(({ entry, status, diagnostic }) => ({
		checkId: entry.checkId, targetId: entry.targetId, fingerprint: entry.fingerprint, reason: entry.reason, owner: entry.owner,
		...(entry.expires !== undefined ? { expires: entry.expires } : {}), status, ...(diagnostic ? { diagnostic } : {}),
	}));
	return { allowlist: list, omitted: Math.max(0, ordered.length - list.length) };
}

// The count of entries for each status. Used by `summary` and `query`. Run data is untrusted, so only known statuses count.
export function allowlistCounts(report, targetId) {
	const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
	if (!Array.isArray(report?.allowlist)) return counts;
	for (const entry of report.allowlist) {
		if (isPlain(entry) && STATUSES.includes(entry.status) && (targetId == null || entry.targetId === targetId)) counts[entry.status]++;
	}
	return counts;
}
