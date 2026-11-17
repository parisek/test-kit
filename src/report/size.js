// R8.18, #390: the size signal of a screenshot pair. The comparison pads the smaller image
// with white, so `ratio` can stay low when one side is much shorter. This signal names the
// axis and the size of the change. Pure (R4.4). Report data is untrusted: a reader derives
// the signal from `diff.size` with these checks and never copies a stored value.

const MAX_PX = 100_000;
const length = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_PX;

// `size` is `{ a: { width, height }, b: { width, height } }`. Returns null when the sizes are
// equal or invalid, else `{ axis, a, b, percent }`. `axis` is `width`, `height` or `both`.
// `percent` is the largest change of one axis, relative to the larger side, with 1 decimal.
export function sizeMismatch(size) {
  const a = size?.a, b = size?.b;
  if (![a?.width, a?.height, b?.width, b?.height].every(length)) return null;
  const axes = ['width', 'height'].filter(key => a[key] !== b[key]);
  if (!axes.length) return null;
  const change = key => 100 * Math.abs(a[key] - b[key]) / Math.max(a[key], b[key]);
  return {
    axis: axes.length === 2 ? 'both' : axes[0],
    a: { width: a.width, height: a.height },
    b: { width: b.width, height: b.height },
    percent: Math.round(Math.max(...axes.map(change)) * 10) / 10,
  };
}

// The cells of a report whose screenshots differ in size, in report order.
export function sizeMismatches(report, target) {
  return (report.entries ?? []).filter(entry => target == null || entry.id === target).flatMap(entry =>
    (entry.viewports ?? []).map(row => ({ id: entry.id, viewport: row.id, mismatch: sizeMismatch(row.artifacts?.screenshot?.diff?.size) }))
      .filter(item => item.mismatch).map(({ id, viewport, mismatch }) => ({ id, viewport, axis: mismatch.axis, percent: mismatch.percent })));
}
