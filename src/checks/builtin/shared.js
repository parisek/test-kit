import { validateContentSnapshot } from '../../content/snapshot.js';
export const snapshot = validateContentSnapshot;
export function finding(ctx, checkId, message, evidence = {}, severity = 'warning') {
  return { targetId: ctx.targetId, ...(ctx.viewportId ? { viewportId: ctx.viewportId } : {}),
    artifact: 'content', checkId, severity, message, evidence };
}
export function omitted(doc, ctx, id, key) {
  return doc.omitted[key] ? [finding(ctx, id, 'The stored snapshot omits evidence. This check is incomplete.', { state: 'incomplete', omitted: doc.omitted[key] }, 'info')] : [];
}
