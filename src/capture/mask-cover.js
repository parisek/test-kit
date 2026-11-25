// R5.18: how much of the captured area the masks cover. Pure: no DOM, no file system (R4.4).
// Rectangles use document coordinates in CSS pixels: { x, y, width, height }.
export const MASK_COVER_RATIO = 0.95;
export const MASK_RECT_LIMIT = 500;

function valid(rect) {
  return rect && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0;
}

function clipTo(rect, area) {
  const left = Math.max(rect.x, area.x), top = Math.max(rect.y, area.y);
  const right = Math.min(rect.x + rect.width, area.x + area.width), bottom = Math.min(rect.y + rect.height, area.y + area.height);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

// The area of the union of the rectangles inside `area`. Each rectangle counts once where they overlap.
export function unionArea(rects, area) {
  const boxes = rects.filter(valid).map(rect => clipTo(rect, area)).filter(Boolean);
  if (!boxes.length) return 0;
  const xs = [...new Set(boxes.flatMap(box => [box.left, box.right]))].sort((a, b) => a - b);
  let total = 0;
  for (let index = 0; index < xs.length - 1; index++) {
    const from = xs[index], to = xs[index + 1];
    const spans = boxes.filter(box => box.left <= from && box.right >= to).map(box => [box.top, box.bottom]).sort((a, b) => a[0] - b[0]);
    let covered = 0, start = -Infinity, end = -Infinity;
    for (const [top, bottom] of spans) {
      if (top > end) { covered += end - start > 0 ? end - start : 0; start = top; end = bottom; }
      else end = Math.max(end, bottom);
    }
    covered += end - start > 0 ? end - start : 0;
    total += covered * (to - from);
  }
  return total;
}

// The count of masks for the warning, or 0. `masks` is one list of rectangles for each mask selector.
// The warning holds when the union of all mask rectangles covers at least 95 % of `area`.
// The count is the number of mask selectors with a rectangle inside `area`. A bad input gives 0.
export function masksCoveringTarget(masks, area) {
  if (!valid(area) || !Array.isArray(masks)) return 0;
  const lists = masks.map(list => (Array.isArray(list) ? list.filter(valid).slice(0, MASK_RECT_LIMIT) : []));
  const all = lists.flat();
  if (!all.length || unionArea(all, area) < MASK_COVER_RATIO * area.width * area.height) return 0;
  return lists.filter(list => list.some(rect => clipTo(rect, area))).length;
}
