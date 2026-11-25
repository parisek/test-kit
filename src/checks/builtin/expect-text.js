import { snapshot, finding } from './shared.js';
export const id = 'expect-text';
export const title = 'Expected text on the page';
export const basis = 'absolute';
export const applies = { artifacts: ['content'] };
// R7.8: each string of `target.expectText` must occur in the stored DOM body of the page.
// The match is exact and case-sensitive on the serialized DOM, so attribute values match as well as text.
// #441: the message names the missing string, cut to 80 characters. JSON quoting keeps a quote inside the string clear.
export const MESSAGE_TEXT_LIMIT = 80;
export function missingMessage(text) {
  const shown = text.length > MESSAGE_TEXT_LIMIT ? `${text.slice(0, MESSAGE_TEXT_LIMIT - 1)}…` : text;
  return `The page does not contain the expected text ${JSON.stringify(shown)}.`;
}
export function check(value, ctx = {}) {
  snapshot(value);
  const expected = ctx.expectText;
  if (!Array.isArray(expected) || !expected.length) return [finding(ctx, id, 'No expected text is configured for this target.', { state: 'unknown' }, 'info')];
  if (typeof ctx.html !== 'string') return [finding(ctx, id, 'The stored DOM body is unavailable. This check is incomplete.', { state: 'unknown' }, 'info')];
  return expected.filter(text => !ctx.html.includes(text))
    .map(text => finding(ctx, id, missingMessage(text), { expected: text }));
}
