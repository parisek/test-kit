// R5.11: capture warnings. A warning is a `{ code, count }` entry in a stored capture. It never enters a hash.
// Run data is untrusted, so a reader checks the whole field. A bad field is ignored as a whole and adds nothing.
// Pure: no DOM, no file system.
export const WARNING_LIMIT = 10;
export const WARNING_COUNT_LIMIT = 1000;
export const LAZY_IMAGES_NOT_SWEPT = 'LAZY_IMAGES_NOT_SWEPT';

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

// The warnings a capture writes. `lazyImages` is the effective setting of the recipe.
// `unloaded` is the count of lazy images that were not loaded when the page was captured.
export function captureWarnings({ lazyImages, unloaded }) {
	if (lazyImages === true || !Number.isSafeInteger(unloaded) || unloaded < 1) return [];
	return [{ code: LAZY_IMAGES_NOT_SWEPT, count: Math.min(unloaded, WARNING_COUNT_LIMIT) }];
}

// The fields to spread into a capture result. No warning adds nothing.
export function warningFields(warnings) {
	return warnings.length ? { warnings } : {};
}

// The valid warnings of a stored capture. Any bad shape gives an empty list: the field is not a list,
// it holds too many entries, an entry is not a plain object with exactly `code` and `count`,
// a code is not 1 to 64 capital letters, digits or `_`, a count is not a safe integer from 1 to 1000,
// or two entries share a code.
export function sanitizeWarnings(list) {
	if (!Array.isArray(list) || list.length < 1 || list.length > WARNING_LIMIT) return [];
	const seen = new Set();
	const clean = [];
	for (const item of list) {
		if (!item || typeof item !== 'object' || Array.isArray(item) || Object.getPrototypeOf(item) !== Object.prototype) return [];
		const keys = Object.keys(item);
		if (keys.length !== 2 || !keys.includes('code') || !keys.includes('count')) return [];
		if (typeof item.code !== 'string' || !CODE.test(item.code) || seen.has(item.code)) return [];
		if (!Number.isSafeInteger(item.count) || item.count < 1 || item.count > WARNING_COUNT_LIMIT) return [];
		seen.add(item.code);
		clean.push({ code: item.code, count: item.count });
	}
	return clean;
}

// The warnings of one row, by side. Null when neither side holds a valid warning.
export function warningsForRow(ac, bc) {
	const a = sanitizeWarnings(ac?.warnings);
	const b = sanitizeWarnings(bc?.warnings);
	return a.length || b.length ? { a, b } : null;
}

// One count for each code over the whole report: the rows with the warning, and the sum of the counts.
// The rows of a report are untrusted too, so each side goes through the same check.
export function warningTotals(report) {
	const totals = new Map();
	for (const entry of report.entries) for (const row of entry.viewports) {
		const warnings = row.warnings && typeof row.warnings === 'object' ? row.warnings : {};
		for (const side of ['a', 'b']) for (const item of sanitizeWarnings(warnings[side])) {
			const total = totals.get(item.code) ?? { code: item.code, cells: 0, count: 0 };
			total.cells += 1;
			total.count += item.count;
			totals.set(item.code, total);
		}
	}
	return [...totals.values()].sort((x, y) => x.code.localeCompare(y.code));
}

// One stderr line for the `capture` command, or null. It names the cells, not the pages.
export function warningLine(run) {
	let cells = 0;
	let images = 0;
	for (const capture of run?.captures ?? []) for (const item of sanitizeWarnings(capture.warnings)) {
		if (item.code !== LAZY_IMAGES_NOT_SWEPT) continue;
		cells += 1;
		images += item.count;
	}
	return cells ? `Warning ${LAZY_IMAGES_NOT_SWEPT}: ${cells} ${cells === 1 ? 'capture holds' : 'captures hold'} lazy images that did not load (${images} in all). Set settle.lazyImages to true to load them.` : null;
}

// The header sentence of the viewer (DESIGN.md "Scope line", #329). It takes the list of `warningTotals`, the same
// list `summary` returns as `captureWarnings`, so both show the same numbers. No warning gives an empty string.
export const WARNING_LINE_CODES = 5;
export function captureWarningsSentence(totals) {
	if (!totals.length) return '';
	const shown = totals.slice(0, WARNING_LINE_CODES).map((item) => `${item.code} in ${item.cells} ${item.cells === 1 ? 'cell' : 'cells'} (${item.count} in all)`);
	const more = totals.length - shown.length;
	return `Capture warnings: ${shown.join('; ')}${more > 0 ? ` and ${more} more ${more === 1 ? 'code' : 'codes'}` : ''}.`;
}

// The detail of one cell: "A: LAZY_IMAGES_NOT_SWEPT (7) · B: none". Null when neither side holds a valid warning.
// The row is untrusted, so each side goes through the same check as the totals.
export function cellWarningsText(row) {
	const warnings = row?.warnings && typeof row.warnings === 'object' ? row.warnings : {};
	const sides = ['a', 'b'].map((side) => sanitizeWarnings(warnings[side]));
	if (!sides.some((list) => list.length)) return null;
	return sides.map((list, index) => `${'AB'[index]}: ${list.length ? list.map((item) => `${item.code} (${item.count})`).join(', ') : 'none'}`).join(' · ');
}
