import { snapshot, finding } from './shared.js';
export const id = 'text-difference';
export const title = 'Stored text difference';
export const basis = 'relative';
export const applies = { artifacts: ['content'] };

// Limits of the evidence. A page can hold thousands of lines. The finding lists 20 per side and counts the rest.
export const MAX_LINES = 20;
export const MAX_LINE_LENGTH = 200;

// A line is one line of `innerText` with its whitespace collapsed. An empty line does not count.
// A short line stays: a heading, a price, a call to action.
const lines = text => text.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);

// The lines of `from` that `against` does not hold, as multisets. One line that occurs twice in
// `from` and once in `against` counts once.
function surplus(from, against) {
  const held = new Map();
  for (const line of against) held.set(line, (held.get(line) ?? 0) + 1);
  const out = [];
  for (const line of from) {
    const count = held.get(line) ?? 0;
    if (count > 0) held.set(line, count - 1); else out.push(line);
  }
  return out;
}
const cut = line => line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH - 1) + '…' : line;

export function check(value, ctx = {}) {
  const b = snapshot(value);
  if (!ctx.before) return [finding(ctx, id, 'No prior content snapshot is available.', { state: 'unknown' }, 'info')];
  const a = snapshot(ctx.before);
  if (a.omitted.text || b.omitted.text) return [finding(ctx, id, 'The stored text is truncated. A full text comparison is unavailable.', { state: 'incomplete' }, 'info')];
  const la = lines(a.text), lb = lines(b.text);
  const onlyInA = surplus(la, lb), onlyInB = surplus(lb, la);
  // A whitespace-only change gives the same lines in the same order, so it gives no finding.
  if (!onlyInA.length && !onlyInB.length && la.join('\n') === lb.join('\n')) return [];
  const evidence = {
    // The side names say which side is which: `a: production`. A position alone does not.
    ...(ctx.sideA ? { sideA: String(ctx.sideA).slice(0, 200) } : {}), ...(ctx.sideB ? { sideB: String(ctx.sideB).slice(0, 200) } : {}),
    onlyInA: onlyInA.slice(0, MAX_LINES).map(cut), onlyInACount: onlyInA.length,
    onlyInB: onlyInB.slice(0, MAX_LINES).map(cut), onlyInBCount: onlyInB.length,
    ...(onlyInA.length || onlyInB.length ? {} : { orderChanged: true }),
  };
  return [finding(ctx, id, onlyInA.length || onlyInB.length ? 'The stored page text has lines that exist on one side only.' : 'The stored page text has the same lines in a different order.', evidence)];
}

// The evidence of a stored comparison is untrusted data. These readers accept the documented shape only.
const isCount = n => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000;
const isLineList = list => Array.isArray(list) && list.length <= MAX_LINES && list.every(line => typeof line === 'string' && line.length <= MAX_LINE_LENGTH);
// True when the evidence has the lists of this check, false when it has none (a version 1.0.0 finding).
export const hasLineLists = evidence => evidence !== null && typeof evidence === 'object' && ('onlyInA' in evidence || 'onlyInB' in evidence);
// The shape a stored finding must have. A list needs at most 20 strings of at most 200 characters, and a count at least as large as its list.
export const validLineEvidence = e => isLineList(e.onlyInA) && isLineList(e.onlyInB) && isCount(e.onlyInACount) && isCount(e.onlyInBCount)
  && e.onlyInACount >= e.onlyInA.length && e.onlyInBCount >= e.onlyInB.length
  && ['sideA', 'sideB'].every(key => e[key] === undefined || typeof e[key] === 'string' && e[key].length <= 200);
// A copy for an answer: strings only, bounded count and length. Never throws.
export const safeLines = list => (Array.isArray(list) ? list : []).filter(line => typeof line === 'string').slice(0, MAX_LINES).map(line => line.slice(0, MAX_LINE_LENGTH));
export const safeCount = (n, fallback = 0) => isCount(n) ? n : fallback;
