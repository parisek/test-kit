import { snapshot, finding } from './shared.js';
export const id = 'lang';
export const title = 'Declared page language';
export const applies = { artifacts: ['content'] };
export function check(value, ctx = {}) {
  const doc = snapshot(value);
  if (!doc.lang.trim()) return [finding(ctx, id, 'The page has no declared language.')];
  if (typeof ctx.expectedLanguage !== 'string' || !ctx.expectedLanguage.trim()) return [finding(ctx, id, 'No expected language is configured.', { state: 'unknown' }, 'info')];
  return doc.lang.toLowerCase() === ctx.expectedLanguage.toLowerCase() ? []
    : [finding(ctx, id, 'The declared language differs from the expected language.', { actual: doc.lang, expected: ctx.expectedLanguage })];
}
