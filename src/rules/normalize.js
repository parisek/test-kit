import { ruleApplies } from './model.js';
// Match raw spans first. Rules cannot create matches for subsequent operations.
export function normalizeHtml(a, b, rules, context) {
  const spans = [[], []], fired = [], diagnostics = [], scoped = [];
  const inputs = [a, b];
  for (const [id, rule] of Object.entries(rules)) {
    if (!ruleApplies(rule, { ...context, artifact: 'html' })) continue;
    scoped.push(id);
    const token = '[[test-kit-rule:' + id + ']]';
    if (inputs.some(input => input.includes(token))) { diagnostics.push({ id, reason: 'Replacement token exists in original evidence.' }); continue; }
    const matches = [rule.operation.a, rule.operation.b].map((literal, side) => {
      const result = [];
      let position = 0;
      while ((position = inputs[side].indexOf(literal, position)) !== -1) {
        result.push({ start: position, end: position + literal.length, token });
        position += literal.length;
        if (result.length > rule.operation.maxOccurrences) break;
      }
      return result;
    });
    if (!matches[0].length || matches[0].length !== matches[1].length || matches[0].length > rule.operation.maxOccurrences) {
      diagnostics.push({ id, reason: 'Literal occurrence counts do not match the bounded contract.' }); continue;
    }
    if (matches.some((items, side) => items.some(item => spans[side].some(previous => item.start < previous.end && previous.start < item.end)))) {
      diagnostics.push({ id, reason: 'Literal spans overlap an earlier rule.' }); continue;
    }
    matches.forEach((items, side) => spans[side].push(...items));
    fired.push({ id, occurrences: matches[0].length });
  }
  const normalized = inputs.map((input, side) => {
    let result = '', position = 0;
    for (const span of spans[side].sort((a, b) => a.start - b.start)) {
      result += input.slice(position, span.start) + span.token; position = span.end;
    }
    return result + input.slice(position);
  });
  if (normalized.some(input => new TextEncoder().encode(input).byteLength > 2 * 1024 * 1024)) {
    return { a, b, fired: [], scoped, diagnostics: [...diagnostics, { id: 'limit', reason: 'Normalized evidence exceeds 2 MiB.' }] };
  }
  return { a: normalized[0], b: normalized[1], fired, scoped, diagnostics };
}
