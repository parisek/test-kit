// Pure display formats (R4.4).

// A pixel difference ratio in percent, with at most two decimals. A ratio above zero
// that rounds to 0.00 reads "<0.01%", so a small difference never looks like none.
// A ratio below 100 that rounds to 100 reads ">99.99%", so it never looks like a full change.
export function formatRatio(value) {
	if (!Number.isFinite(value)) return null;
	if (value > 0 && value < 0.005) return '<0.01%';
	if (value < 100 && value.toFixed(2) === '100.00') return '>99.99%';
	return `${Number(value.toFixed(2))}%`;
}
