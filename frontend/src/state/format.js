// Pure display formats (R4.4).

// A pixel difference ratio in percent, with at most two decimals. A ratio above zero
// that rounds to 0.00 reads "<0.01%", so a small difference never looks like none.
export function formatRatio(value) {
	if (!Number.isFinite(value)) return null;
	if (value > 0 && value < 0.005) return '<0.01%';
	return `${Number(value.toFixed(2))}%`;
}
