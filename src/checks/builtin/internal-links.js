import { snapshot, finding, omitted } from './shared.js';
export const id = 'internal-links';
export const title = 'Stored internal link responses';
export const applies = { artifacts: ['content'] };
export function check(value, ctx = {}) {
  const doc = snapshot(value), findings = omitted(doc, ctx, id, 'links');
  const responses = ctx.responses && typeof ctx.responses === 'object' ? ctx.responses : {};
  for (const path of new Set(doc.links.map(link => link.path))) {
    const status = Object.hasOwn(responses, path) ? responses[path] : null;
    if (!Number.isInteger(status) || status < 100 || status > 599) findings.push(finding(ctx, id, 'No stored response proves this internal link.', { path, state: 'unknown' }, 'info'));
    else if (status >= 400) findings.push(finding(ctx, id, 'The stored internal link response is an HTTP error.', { path, statusCode: status }));
    else if (status < 200 || status >= 300) findings.push(finding(ctx, id, 'The stored response does not prove a successful final response.', { path, statusCode: status, state: 'unknown' }, 'info'));
  }
  return findings;
}
