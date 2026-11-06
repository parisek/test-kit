// R3.8: read the aborted requests of a stored capture. Run data is untrusted, so each part
// is checked and bounded. A malformed entry is dropped, not repaired. Pure: no DOM, no file system.
export const DROPPED_LIMIT = 50;
// A font or a stylesheet that does not load changes how the page renders.
export const RENDER_TYPES = ['font', 'stylesheet'];

const TYPE = /^[a-z][a-z-]{0,19}$/;
const ORIGIN = /^https?:\/\/[A-Za-z0-9.:[\]-]{1,95}$/;

export function sanitizeDropped(list) {
	const dropped = [];
	for (const item of Array.isArray(list) ? list.slice(0, DROPPED_LIMIT) : []) {
		if (!item || typeof item.resourceType !== 'string' || typeof item.origin !== 'string' || !TYPE.test(item.resourceType) || !ORIGIN.test(item.origin)) continue;
		if (!Number.isInteger(item.count) || item.count < 1 || item.count > 1_000_000) continue;
		dropped.push({ resourceType: item.resourceType, origin: item.origin, count: item.count });
	}
	return dropped;
}

// The requests beyond the 50-entry cap of a capture, as a safe count.
function omittedCount(capture) {
	const value = capture?.droppedOmitted;
	return Number.isInteger(value) && value > 0 && value <= 1_000_000 ? value : 0;
}

// The dropped lists of one row, by side, and the requests cut from each list. Null when
// neither side dropped a request.
export function droppedForRow(ac, bc) {
	const a = sanitizeDropped(ac?.dropped);
	const b = sanitizeDropped(bc?.dropped);
	const omitted = { a: omittedCount(ac), b: omittedCount(bc) };
	if (!a.length && !b.length && !omitted.a && !omitted.b) return null;
	return { a, b, ...(omitted.a || omitted.b ? { omitted } : {}) };
}

// R3.8: requests that a capture counted but did not list, over the whole report.
export function droppedNotListed(report) {
	let total = 0;
	for (const entry of report.entries) for (const row of entry.viewports) {
		const omitted = row.dropped && typeof row.dropped === 'object' ? row.dropped.omitted : null;
		for (const side of ['a', 'b']) total += omittedCount({ droppedOmitted: omitted?.[side] });
	}
	return total;
}

// One warning for each side, resource type and origin of a font or a stylesheet.
export function droppedWarnings(report) {
	const warnings = [];
	for (const entry of report.entries) for (const row of entry.viewports) {
		const dropped = row.dropped && typeof row.dropped === 'object' ? row.dropped : {};
		for (const side of ['a', 'b']) for (const item of sanitizeDropped(dropped[side])) {
			if (RENDER_TYPES.includes(item.resourceType)) warnings.push({ id: entry.id, viewport: row.id, side, ...item });
		}
	}
	return warnings;
}
