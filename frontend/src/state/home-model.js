// Pure model for the Home: the history of comparisons (R10.3, R10.13, DESIGN.md "Comparison row").
// Input is the parsed index (index-list.js). Unknown stays unknown: null is never 0 (principle 1).

// R8.12: worst class first.
const CLASS_ORDER = ['unexplained', 'explained', 'oracle', 'match'];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The class word of a row: the worst class over its targets (R8.12).
// Returns null when the summary is unknown.
export function rowClass(summary) {
	if (!summary) return null;
	const worst = CLASS_ORDER.find((name) => summary[name] > 0);
	if (worst) return worst;
	return summary.unclassified > 0 ? 'unclassified' : null;
}

// The verdict sentence of a comparison (DESIGN.md "Verdict wording").
export function verdictSentence(summary) {
	if (!summary) return 'Not measured';
	if (summary.unexplained > 0) return `${plural(summary.unexplained, 'page differs', 'pages differ')} without an explanation`;
	if (summary.explained > 0) return `${plural(summary.explained, 'page has', 'pages have')} only known differences`;
	if (summary.unclassified > 0) return `${plural(summary.unclassified, 'page is', 'pages are')} not measured`;
	if (summary.match > 0) return 'Nothing changed';
	if (summary.oracle > 0) return `${plural(summary.oracle, 'page needs', 'pages need')} a check by a person`;
	return 'No pages';
}

// The change of a row against the previous (older) comparison, as short text.
// Returns null when either summary is unknown.
export function changeText(summary, previous) {
	if (!summary || !previous) return null;
	const parts = [];
	for (const name of ['unexplained', 'explained', 'match']) {
		const delta = summary[name] - previous[name];
		if (delta) parts.push(`${delta > 0 ? '+' : '−'}${Math.abs(delta)} ${name}`);
	}
	return parts.length ? parts.join(', ') : 'Same as before';
}

// The local calendar day of an ISO time, as YYYY-MM-DD. timeZone is for tests.
export function localDay(iso, timeZone) {
	if (typeof iso !== 'string') return null;
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return null;
	const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
	const get = (type) => parts.find((part) => part.type === type)?.value;
	return `${get('year')}-${get('month')}-${get('day')}`;
}

// Rows of the Home in file order (newest first, R10.13), with what each row shows.
// The previous row is the next older entry that is available (R10.3 skips path null).
export function homeRows(reports, { timeZone } = {}) {
	const list = Array.isArray(reports) ? reports : [];
	return list.map((row, i) => {
		const previous = list.slice(i + 1).find((item) => item.available) ?? null;
		return {
			...row,
			day: localDay(row.createdAt, timeZone),
			verdict: rowClass(row.summary),
			change: changeText(row.summary, previous?.summary ?? null),
			hashChanged: Boolean(row.settingsHash && previous?.settingsHash && row.settingsHash !== previous.settingsHash),
		};
	});
}

// Rows grouped by local day, in file order. Rows without a day go last, in one group.
export function groupByDay(rows) {
	const groups = [];
	const unknown = [];
	for (const row of rows) {
		if (row.day === null) { unknown.push(row); continue; }
		const last = groups[groups.length - 1];
		if (last && last.day === row.day) last.rows.push(row);
		else groups.push({ day: row.day, rows: [row] });
	}
	if (unknown.length) groups.push({ day: null, rows: unknown });
	return groups;
}

// The first available comparison, or null.
export const latestRow = (rows) => rows.find((row) => row.available) ?? null;

// The verdict history strip: available comparisons, oldest on the left, at most `limit`.
export function historyStrip(rows, limit = 30) {
	return rows.filter((row) => row.available).slice(0, limit).reverse();
}
