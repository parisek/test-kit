import { snapshot, finding, omitted } from './shared.js';
export const id = 'empty-alt';
export const title = 'Image alternative text';
export const applies = { artifacts: ['content'] };
export function check(value, ctx = {}) {
  const doc = snapshot(value), findings = omitted(doc, ctx, id, 'images');
  doc.images.forEach((item, index) => {
    if (item.alt === null) findings.push(finding(ctx, id, 'The image has no alt attribute.', { index, src: item.src }));
    else if (item.alt.trim() === '' && item.alt !== '') findings.push(finding(ctx, id, 'The image alt contains only whitespace.', { index, src: item.src }));
    else if (item.role === 'img' && item.alt === '') findings.push(finding(ctx, id, 'An image with an explicit img role has empty alt.', { index, src: item.src }));
  });
  return findings;
}
