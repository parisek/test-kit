// Pure model for the Home: the history of comparisons (R10.3, R10.13, DESIGN.md "Comparison row").
// Input is the parsed index (index-list.js). Unknown stays unknown: null is never 0 (principle 1).

import { SUMMARY_KEYS } from './index-list.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The word of a row: the worst class over its targets (R8.12). A target without a
// class (unclassified) is never match (R8.12), so it ranks just above match: a row
// with an unmeasured page never shows the match color. Null when the summary is unknown.
const ROW_ORDER = ['unexplained', 'explained', 'oracle', 'unclassified', 'match'];
export function rowClass(summary) {
	if (!summary) return null;
	return ROW_ORDER.find((name) => summary[name] > 0) ?? null;
}

// The verdict sentence of a comparison (DESIGN.md "Verdict wording"). Incomplete is a
// measurement state beside the class (DESIGN.md "Verdict incomplete"), so the sentence
// names it too: an incomplete measurement never reads as "Nothing changed".
export function verdictSentence(summary) {
	if (!summary) return 'Not measured';
	const sentence = classSentence(summary);
	if (summary.incomplete === 0) return sentence;
	return `${sentence}. ${plural(summary.incomplete, 'page is', 'pages are')} incomplete`;
}

function classSentence(summary) {
	if (summary.unexplained > 0) return `${plural(summary.unexplained, 'page differs', 'pages differ')} without an explanation`;
	if (summary.explained > 0) return `${plural(summary.explained, 'page has', 'pages have')} only known differences`;
	if (summary.oracle > 0) return `${plural(summary.oracle, 'page needs', 'pages need')} a check by a person`;
	if (summary.unclassified > 0) return `${plural(summary.unclassified, 'page is', 'pages are')} not measured`;
	if (summary.match > 0) return summary.incomplete > 0 ? 'No difference found' : 'Nothing changed';
	return 'No pages';
}

// The change of a row against the previous (older) comparison, as short text.
// Returns null when either summary is unknown.
export function changeText(summary, previous) {
	if (!summary || !previous) return null;
	const parts = [];
	for (const name of SUMMARY_KEYS) {
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
		// An unavailable row is not a link and shows no verdict.
		const summary = row.available ? row.summary : null;
		return {
			...row,
			day: localDay(row.createdAt, timeZone),
			verdict: rowClass(summary),
			// Incomplete is a state beside the class, never the class (DESIGN.md).
			// The row carries it so that no view can show the class without it.
			incomplete: summary ? summary.incomplete : null,
			change: changeText(summary, previous?.summary ?? null),
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
