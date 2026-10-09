import { snapshot, finding, omitted } from './shared.js';
export const id = 'heading-outline';
export const title = 'Heading outline';
export const applies = { artifacts: ['content'] };
export function check(value, ctx = {}) {
  const doc = snapshot(value), findings = omitted(doc, ctx, id, 'headings');
  const count = doc.headings.filter(item => item.level === 1).length;
  if (count !== 1 && !(count === 0 && doc.omitted.headings)) findings.push(finding(ctx, id, 'The page must have one h1 heading.', { count }));
  let previous = 0;
  doc.headings.forEach((item, index) => {
    if (item.level > previous + 1) findings.push(finding(ctx, id, 'The heading outline skips a level.', { index, previous, level: item.level, text: item.text }));
    previous = item.level;
  });
  return findings;
}
