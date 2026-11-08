// Pure comparison of two layout snapshots (R6.15, R4.4). No DOM, no file system.
import { MAX_REPEAT } from './declaration.js';

export const LENGTH_TOLERANCE = 1;
export const RATIO_TOLERANCE = 0.01;
const EPSILON = 1e-9;
const RATIO = new Set(['type.lineHeight']);
const LENGTH = new Set(['box.width', 'box.height', 'layout.gap', 'layout.padding[0]', 'layout.padding[1]', 'layout.padding[2]', 'layout.padding[3]',
  'type.size', 'type.letterSpacing', 'paint.borderWidth', 'paint.radius']);

// A record as a flat list of [property, value], in a fixed order. Tokens stay out.
export function flattenRecord(record) {
  const out = [];
  for (const group of ['box', 'layout', 'type', 'paint']) {
    for (const [key, value] of Object.entries(record[group])) {
      if (Array.isArray(value)) value.forEach((item, index) => out.push([`${group}.${key}[${index}]`, item]));
      else out.push([`${group}.${key}`, value]);
    }
  }
  return out;
}

// The values of one property are equal: 1 px for a length, 0.01 for a line-height ratio, exact otherwise.
export function sameValue(property, a, b) {
  if (a === null || b === null) return a === b;
  if (LENGTH.has(property)) return Math.abs(a - b) <= LENGTH_TOLERANCE + EPSILON;
  if (RATIO.has(property)) return Math.abs(a - b) <= RATIO_TOLERANCE + EPSILON;
  return a === b;
}

// The token rule: the same token on both sides is a match, even when the values differ.
// `aliases` maps a token of side A to the token of side B that stands for it.
export function sameToken(tokenA, tokenB, aliases = {}) {
  return Boolean(tokenA && tokenB && (tokenA === tokenB || (Object.hasOwn(aliases, tokenA) && aliases[tokenA] === tokenB)));
}

export function compareRecords(part, a, b, aliases = {}) {
  const differences = [];
  const values = new Map(flattenRecord(b));
  for (const [property, valueA] of flattenRecord(a)) {
    const valueB = values.get(property) ?? null;
    const tokenA = a.tokens[property] ?? null, tokenB = b.tokens[property] ?? null;
    if (sameToken(tokenA, tokenB, aliases) || sameValue(property, valueA, valueB)) continue;
    differences.push({ part, property, kind: 'differs', a: valueA, b: valueB, ...(tokenA ? { tokenA } : {}), ...(tokenB ? { tokenB } : {}) });
  }
  return differences;
}

// Per part: `match`, `differs` (properties or the count of a repeat) or `missing`.
// A single part is `missing` when a side has no element. A repeat is `missing` only when both sides have none:
// 0 against N is a count change of one list, so it gives one `count` difference (it keeps N; `missing` would drop it).
// A repeat whose count differs gives one `count` difference. Indices beyond the shorter list are not compared.
export function compareLayout(a, b, { aliases = {} } = {}) {
  const partsB = new Map(b.parts.map(part => [part.id, part]));
  const ids = [...a.parts.map(part => part.id), ...b.parts.filter(part => !a.parts.some(item => item.id === part.id)).map(part => part.id)];
  const parts = [];
  const differences = [];
  for (const id of ids) {
    const partA = a.parts.find(part => part.id === id) ?? null, partB = partsB.get(id) ?? null;
    const countA = partA?.count ?? 0, countB = partB?.count ?? 0;
    const repeat = partA?.repeat === true || partB?.repeat === true;
    if (!repeat && (countA === 0 || countB === 0) || repeat && countA === 0 && countB === 0) {
      differences.push({ part: id, property: 'part', kind: 'missing', a: countA ? 'present' : 'absent', b: countB ? 'present' : 'absent' });
      parts.push({ id, state: 'missing' });
      continue;
    }
    const before = differences.length;
    if (repeat && countA !== countB) differences.push({ part: id, property: 'count', kind: 'count', a: countA, b: countB });
    const common = Math.min(countA, countB, MAX_REPEAT);
    for (let index = 0; index < common; index++) {
      differences.push(...compareRecords(repeat ? `${id}[${index}]` : id, partA.records[index], partB.records[index], aliases));
    }
    parts.push({ id, state: differences.length > before ? 'differs' : 'match' });
  }
  const counts = { parts: parts.length, match: 0, differs: 0, missing: 0, count: 0, differences: differences.length };
  for (const part of parts) counts[part.state]++;
  counts.count = differences.filter(item => item.kind === 'count').length;
  return { parts, differences, counts, changed: differences.length > 0 };
}

// The byte limit of the difference sidecar. It equals the default read limit of `readSidecar`
// (MAX_RESPONSE_BYTES, 2 MiB), so `query` can always read the file that `compareRuns` writes (R6.15, R11.8).
export const MAX_COMPARISON_BYTES = 2 * 1024 * 1024;
const encoder = new TextEncoder();
const byteLength = value => encoder.encode(JSON.stringify(value)).length;

// The sidecar form of a comparison: the counts stay complete, and the differences stay in the order of
// `compareLayout` (parts of A, then parts of B only; record index; property order). The list stops at the
// first difference that does not fit `maxBytes`, and `differencesOmitted` counts the rest.
export function boundComparison(detail, maxBytes = MAX_COMPARISON_BYTES) {
  const total = detail.differences.length;
  // The envelope holds the largest omitted count, so the real file is never longer than the estimate.
  let bytes = byteLength({ ...detail, differences: [], differencesOmitted: total });
  let kept = 0;
  for (const item of detail.differences) {
    const size = byteLength(item) + (kept ? 1 : 0);
    if (bytes + size > maxBytes) break;
    bytes += size; kept++;
  }
  return { ...detail, differences: detail.differences.slice(0, kept), differencesOmitted: total - kept };
}

// The text of one difference, bounded, for a finding message.
export function differenceMessage(item) {
  const shown = (value, token) => (value === null ? 'none' : String(value)).slice(0, 120) + (token ? ` (${token})` : '');
  if (item.kind === 'missing') return `Layout part ${item.part}: A ${item.a}, B ${item.b}.`;
  if (item.kind === 'count') return `Layout part ${item.part}: count A ${item.a}, B ${item.b}.`;
  return `Layout part ${item.part} ${item.property}: A ${shown(item.a, item.tokenA)}, B ${shown(item.b, item.tokenB)}.`;
}

// The stored difference sidecar is untrusted (R11.2). A reader accepts only this bounded shape and copies it.
// The part and the property of one difference. A decision names them too (src/decisions, #350 part C).
export const PART = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:\[\d{1,5}\])?$/;
export const PROPERTY = /^(?:part|count|[a-z]+\.[A-Za-z]+(?:\[[0-3]\])?)$/;
const TOKEN = /^--[A-Za-z0-9_-]{1,126}$/;
const scalar = value => value === null || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value));
const count = (value, max = 1_000_000) => Number.isSafeInteger(value) && value >= 0 && value <= max;
export const MAX_DIFFERENCES = 2500 * 25 + 50;
export function validateLayoutComparison(value) {
  const bad = () => { throw new Error('Invalid layout comparison.'); };
  if (!value || typeof value.changed !== 'boolean' || !Array.isArray(value.parts) || value.parts.length > 50
    || !Array.isArray(value.differences) || value.differences.length > MAX_DIFFERENCES || !value.counts
    || !count(value.differencesOmitted, MAX_DIFFERENCES)) bad();
  const parts = value.parts.map(part => {
    if (!part || typeof part.id !== 'string' || !PART.test(part.id) || !['match', 'differs', 'missing'].includes(part.state)) bad();
    return { id: part.id, state: part.state };
  });
  const differences = value.differences.map(item => {
    if (!item || typeof item.part !== 'string' || !PART.test(item.part) || typeof item.property !== 'string' || !PROPERTY.test(item.property)
      || !['differs', 'missing', 'count'].includes(item.kind) || !scalar(item.a) || !scalar(item.b)
      || (item.tokenA !== undefined && !(typeof item.tokenA === 'string' && TOKEN.test(item.tokenA)))
      || (item.tokenB !== undefined && !(typeof item.tokenB === 'string' && TOKEN.test(item.tokenB)))) bad();
    return { part: item.part, property: item.property, kind: item.kind, a: item.a, b: item.b, ...(item.tokenA ? { tokenA: item.tokenA } : {}), ...(item.tokenB ? { tokenB: item.tokenB } : {}) };
  });
  const counts = {};
  for (const key of ['parts', 'match', 'differs', 'missing', 'count', 'differences']) { if (!count(value.counts[key])) bad(); counts[key] = value.counts[key]; }
  // The sidecar may cut the list (boundComparison). The counts stay complete, so they cover the cut.
  const omitted = value.differencesOmitted;
  if (counts.differences !== differences.length + omitted || counts.differences > MAX_DIFFERENCES || value.changed !== counts.differences > 0) bad();
  return { changed: value.changed, counts, parts, differences, differencesOmitted: omitted };
}
