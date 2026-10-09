import { snapshot, finding } from './shared.js';
export const id = 'text-difference';
export const title = 'Stored text difference';
export const applies = { artifacts: ['content'] };
export function check(value, ctx = {}) {
  const b = snapshot(value);
  if (!ctx.before) return [finding(ctx, id, 'No prior content snapshot is available.', { state: 'unknown' }, 'info')];
  const a = snapshot(ctx.before);
  if (a.omitted.text || b.omitted.text) return [finding(ctx, id, 'The stored text is truncated. A full text comparison is unavailable.', { state: 'incomplete' }, 'info')];
  return a.text === b.text ? [] : [finding(ctx, id, 'The stored page text changes.', { before: a.text.slice(0, 2000), after: b.text.slice(0, 2000), beforeLength: a.text.length, afterLength: b.text.length, omitted: a.text.length > 2000 || b.text.length > 2000 })];
}
