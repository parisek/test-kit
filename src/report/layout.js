// The layout counts of a report for `summary` (R6.15, R11.6). The report is untrusted, so each count is checked.
// A key appears only above zero, so a report without a layout difference gives no key at all.
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : 0;

export function layoutTotals(report, target = null) {
	const totals = { cells: 0, differs: 0, missing: 0, count: 0, differences: 0 };
	for (const entry of report?.entries ?? []) {
		if (target != null && entry.id !== target) continue;
		for (const row of entry.viewports ?? []) {
			const index = row?.artifacts?.layout;
			if (index?.state !== 'complete' || !index.diff || typeof index.diff.counts !== 'object' || index.diff.counts === null) continue;
			const counts = index.diff.counts;
			if (!count(counts.differences)) continue;
			totals.cells += 1;
			for (const key of ['differs', 'missing', 'count', 'differences']) totals[key] += count(counts[key]);
		}
	}
	return Object.fromEntries(Object.entries(totals).filter(([, value]) => value > 0));
}
