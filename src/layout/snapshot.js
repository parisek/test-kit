// The stored layout file is untrusted (R6.14, R12.3). A reader accepts only the bounded shape below.
// Any other value refuses the whole file, so a comparison never reads part of a bad file.
import { LAYOUT_VERSION, TOKEN_FAMILIES } from './record.js';
import { MAX_PARTS, MAX_REPEAT } from './declaration.js';

export const MAX_COUNT = 10000;
export const MAX_LAYOUT_BYTES = 2 * 1024 * 1024;
const PART_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TOKEN = /^--[A-Za-z0-9_-]{1,126}$/;
const COLOUR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, list) => plain(value) && Object.keys(value).length === list.length && list.every(key => Object.hasOwn(value, key));
const number = value => value === null || (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000);
const word = (value, max = 100) => value === null || (typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value));
const colour = value => value === null || (typeof value === 'string' && COLOUR.test(value));

function validRecord(record) {
  if (!keys(record, ['box', 'layout', 'type', 'paint', 'tokens'])) return false;
  const { box, layout, type, paint, tokens } = record;
  if (!keys(box, ['width', 'height']) || !number(box.width) || !number(box.height)) return false;
  if (!keys(layout, ['display', 'direction', 'wrap', 'justify', 'align', 'gap', 'padding'])
    || !['display', 'direction', 'wrap', 'justify', 'align'].every(key => word(layout[key])) || !number(layout.gap)
    || !Array.isArray(layout.padding) || layout.padding.length !== 4 || !layout.padding.every(number)) return false;
  if (!keys(type, ['family', 'size', 'weight', 'lineHeight', 'letterSpacing']) || !word(type.family, 200)
    || !['size', 'weight', 'lineHeight', 'letterSpacing'].every(key => number(type[key]))) return false;
  if (!keys(paint, ['color', 'background', 'borderWidth', 'borderColor', 'radius']) || !colour(paint.color) || !colour(paint.background)
    || !colour(paint.borderColor) || !number(paint.borderWidth) || !number(paint.radius)) return false;
  if (!plain(tokens) || Object.entries(tokens).some(([key, name]) => !Object.hasOwn(TOKEN_FAMILIES, key) || typeof name !== 'string' || !TOKEN.test(name))) return false;
  return true;
}

export function validateLayoutSnapshot(value) {
  const bad = () => { throw new Error('Invalid layout snapshot.'); };
  if (!keys(value, ['schemaVersion', 'version', 'source', 'parts']) || value.schemaVersion !== 1 || value.version !== LAYOUT_VERSION
    || value.source !== 'computed-style' || !Array.isArray(value.parts) || value.parts.length < 1 || value.parts.length > MAX_PARTS) bad();
  const ids = new Set();
  const parts = value.parts.map(part => {
    if (!keys(part, ['id', 'repeat', 'count', 'records']) || typeof part.id !== 'string' || !PART_ID.test(part.id) || ids.has(part.id)
      || typeof part.repeat !== 'boolean' || !Number.isSafeInteger(part.count) || part.count < 0 || part.count > (part.repeat ? MAX_COUNT : 1)
      || !Array.isArray(part.records) || part.records.length !== Math.min(part.count, MAX_REPEAT) || !part.records.every(validRecord)) bad();
    ids.add(part.id);
    return { id: part.id, repeat: part.repeat, count: part.count, records: structuredClone(part.records) };
  });
  return { schemaVersion: 1, version: LAYOUT_VERSION, source: 'computed-style', parts };
}
