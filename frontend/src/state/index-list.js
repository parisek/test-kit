// Pure reader for the publish directory index (R10.13). Input is untrusted.
export const INDEX_SCHEMA_VERSION = 1;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const validId = (value) => typeof value === 'string' && ID.test(value);
export const reportPath = (id) => `reports/${id}/report.json`;
export const runPath = (id) => `runs/${id}/run.json`;
export const anchorFor = (id) => `#r-${id}`;
export function idFromAnchor(hash) {
	const match = typeof hash === 'string' ? /^#r-(.+)$/.exec(hash) : null;
	return match && validId(match[1]) ? match[1] : null;
}
// "sha256:" and the first 12 characters of the hex digest.
export function shortHash(value) {
	return typeof value === 'string' && /^sha256:[0-9a-f]+$/i.test(value) ? value.slice(0, 19) : null;
}

const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
export const SUMMARY_KEYS = ['unexplained', 'explained', 'match', 'oracle', 'unclassified', 'incomplete'];
// R10.13: every key must be a count, else the whole summary is unknown (null).
function summaryOf(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const result = {};
	for (const key of SUMMARY_KEYS) {
		const n = count(value[key]);
		if (n === null) return null;
		result[key] = n;
	}
	return result;
}

function common(row, expectedPath) {
	if (!row || typeof row !== 'object' || !validId(row.id)) return null;
	return {
		id: row.id,
		createdAt: typeof row.createdAt === 'string' && TIME.test(row.createdAt) ? row.createdAt : null,
		settingsHash: shortHash(row.settingsHash),
		// Only the exact path of the entry counts. Anything else is unavailable.
		available: row.path === expectedPath(row.id),
	};
}

// Returns { ok: true, reports, runs, skipped } or { ok: false, error }.
// The order of the file is kept: the writer sorts (R10.13).
export function parseIndex(data) {
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		return { ok: false, error: 'The index is not an object.' };
	}
	if (data.schemaVersion !== INDEX_SCHEMA_VERSION) {
		const seen = typeof data.schemaVersion === 'number' ? String(data.schemaVersion) : 'missing or invalid';
		return { ok: false, error: `Unsupported index schemaVersion (${seen}). This viewer reads schemaVersion ${INDEX_SCHEMA_VERSION}.` };
	}
	if (!Array.isArray(data.reports) || !Array.isArray(data.runs)) {
		return { ok: false, error: 'The index is malformed: reports and runs must be arrays.' };
	}
	let skipped = 0;
	const list = (rows, build) => rows.flatMap((row) => {
		const entry = build(row);
		if (!entry) skipped++;
		return entry ? [entry] : [];
	});
	const reports = list(data.reports, (row) => {
		const base = common(row, reportPath);
		return base && {
			...base,
			kind: typeof row.kind === 'string' ? row.kind : null,
			targets: count(row.targets),
			viewports: count(row.viewports),
			summary: summaryOf(row.summary),
		};
	});
	const runs = list(data.runs, (row) => common(row, runPath));
	return { ok: true, reports, runs, skipped };
}
