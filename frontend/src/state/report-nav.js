// Pure navigation between comparisons of a publish directory (R10.3, R4.4).
// Older is the next entry in the order of `reports`, newer the previous one. Both skip
// entries whose path is null (unavailable). The page counter counts only available entries.
export function reportNeighbors(reports, id) {
	const list = (Array.isArray(reports) ? reports : []).filter((row) => row.available);
	const at = list.findIndex((row) => row.id === id);
	if (at < 0) return null;
	return { position: at + 1, total: list.length, older: list[at + 1] ?? null, newer: list[at - 1] ?? null };
}

// The local date and time of an ISO string, or null when it is not a time.
export function localDateTime(iso) {
	if (typeof iso !== 'string') return null;
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? null : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
