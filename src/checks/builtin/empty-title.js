import { snapshot, finding } from './shared.js';
export const id = 'empty-title';
export const title = 'Page title';
export const applies = { artifacts: ['content'] };
export function check(value, ctx = {}) {
  return snapshot(value).title.trim() ? [] : [finding(ctx, id, 'The page title is empty.')];
}
