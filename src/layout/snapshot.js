// The stored layout file is untrusted (R6.14). A reader accepts only the bounded shape below.
// Any other value refuses the whole file, so a comparison never reads part of a bad file.
// The error names the part, the property and the value, as safe text (#384). It does not accept anything more.
import { LAYOUT_VERSION, MAX_NUMBER, TOKEN_FAMILIES, colour as normalColour } from './record.js';
import { MAX_PARTS, MAX_REPEAT } from './declaration.js';

export const MAX_COUNT = 10000;
export const MAX_LAYOUT_BYTES = 2 * 1024 * 1024;
// The code of a refusal by this reader. Only an error with this code may carry its message into a report diagnostic.
export const INVALID_LAYOUT = 'LAYOUT_SNAPSHOT_INVALID';
const PART_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TOKEN = /^--[A-Za-z0-9_-]{1,126}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, list) => plain(value) && Object.keys(value).length === list.length && list.every(key => Object.hasOwn(value, key));
const number = value => value === null || (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_NUMBER);
const word = (value, max = 100) => value === null || (typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value));
// A stored colour is in its normal form: the reader gives the same text back (`#rrggbb`, `#rrggbbaa`
// without an alpha byte of ff, or the bounded lowercase text of a colour that it does not convert).
const colour = value => value === null || (typeof value === 'string' && normalColour(value) === value);

// The value of a refused property as safe text: a number as JSON (finite or not), any other value only by its type.
const shown = value => typeof value === 'number' ? String(value) : value === null ? 'null' : Array.isArray(value) ? 'an array' : `${/^[aeiou]/.test(typeof value) ? 'an' : 'a'} ${typeof value}`;

// The first property of a record outside the bounds, as `{ property, value?, numeric? }`, or null when the record is valid.
// The property names come from this list only, never from the file.
function recordProblem(record) {
  if (!keys(record, ['box', 'layout', 'type', 'paint', 'tokens'])) return { property: 'record' };
  const { box, layout, type, paint, tokens } = record;
  if (!keys(box, ['width', 'height'])) return { property: 'box' };
  for (const key of ['width', 'height']) if (!number(box[key])) return { property: `box.${key}`, value: box[key], numeric: true };
  if (!keys(layout, ['display', 'direction', 'wrap', 'justify', 'align', 'gap', 'padding'])) return { property: 'layout' };
  for (const key of ['display', 'direction', 'wrap', 'justify', 'align']) if (!word(layout[key])) return { property: `layout.${key}`, value: layout[key] };
  if (!number(layout.gap)) return { property: 'layout.gap', value: layout.gap, numeric: true };
  if (!Array.isArray(layout.padding) || layout.padding.length !== 4) return { property: 'layout.padding' };
  for (const [index, value] of layout.padding.entries()) if (!number(value)) return { property: `layout.padding[${index}]`, value, numeric: true };
  if (!keys(type, ['family', 'size', 'weight', 'lineHeight', 'letterSpacing'])) return { property: 'type' };
  if (!word(type.family, 200)) return { property: 'type.family', value: type.family };
  for (const key of ['size', 'weight', 'lineHeight', 'letterSpacing']) if (!number(type[key])) return { property: `type.${key}`, value: type[key], numeric: true };
  if (!keys(paint, ['color', 'background', 'borderWidth', 'borderColor', 'radius'])) return { property: 'paint' };
  for (const key of ['color', 'background', 'borderColor']) if (!colour(paint[key])) return { property: `paint.${key}`, value: paint[key] };
  for (const key of ['borderWidth', 'radius']) if (!number(paint[key])) return { property: `paint.${key}`, value: paint[key], numeric: true };
  if (!plain(tokens) || Object.entries(tokens).some(([key, name]) => !Object.hasOwn(TOKEN_FAMILIES, key) || typeof name !== 'string' || !TOKEN.test(name))) return { property: 'tokens' };
  return null;
}

function refuse(detail) {
  const error = new Error(detail ? `Invalid layout snapshot: ${detail}.` : 'Invalid layout snapshot.');
  error.code = INVALID_LAYOUT;
  throw error;
}

export function validateLayoutSnapshot(value) {
  if (!keys(value, ['schemaVersion', 'version', 'source', 'parts']) || value.schemaVersion !== 1 || value.version !== LAYOUT_VERSION
    || value.source !== 'computed-style' || !Array.isArray(value.parts) || value.parts.length < 1 || value.parts.length > MAX_PARTS) refuse();
  const ids = new Set();
  const parts = value.parts.map((part, index) => {
    // A part ID from the file enters the message only when it is a safe ID. Else the message names the position.
    const name = typeof part?.id === 'string' && PART_ID.test(part.id) ? `part ${part.id}` : `part at index ${index}`;
    if (!keys(part, ['id', 'repeat', 'count', 'records']) || typeof part.id !== 'string' || !PART_ID.test(part.id) || ids.has(part.id)
      || typeof part.repeat !== 'boolean' || !Number.isSafeInteger(part.count) || part.count < 0 || part.count > (part.repeat ? MAX_COUNT : 1)
      || !Array.isArray(part.records) || part.records.length !== Math.min(part.count, MAX_REPEAT)) refuse(`${name} has an invalid shape`);
    for (const [position, record] of part.records.entries()) {
      const problem = recordProblem(record);
      if (!problem) continue;
      const where = part.repeat ? `${name}[${position}]` : name;
      const range = problem.numeric && typeof problem.value === 'number' && Number.isFinite(problem.value) ? ` (the bound is ${MAX_NUMBER})` : '';
      refuse(`${where}, property ${problem.property}` + (Object.hasOwn(problem, 'value') ? `, value ${shown(problem.value)}${range}` : ''));
    }
    ids.add(part.id);
    return { id: part.id, repeat: part.repeat, count: part.count, records: structuredClone(part.records) };
  });
  return { schemaVersion: 1, version: LAYOUT_VERSION, source: 'computed-style', parts };
}
