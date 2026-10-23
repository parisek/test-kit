import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// DESIGN.md, Typography: "Text smaller than 0.75rem is not used."
const root = new URL('../../frontend/src/', import.meta.url).pathname;
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(css|vue)$/.test(entry.name) ? [path] : [];
  });
}
function tooSmall(text) {
  const sizes = [...text.matchAll(/font-size:\s*([\d.]+)(px|rem)/g), ...text.matchAll(/text-\[([\d.]+)(px|rem)\]/g)];
  return sizes.filter(([, value, unit]) => Number(value) * (unit === 'rem' ? 16 : 1) < 12).map(([match]) => match);
}

test('the type floor check finds a size below 0.75rem', () => {
  assert.equal(tooSmall('a { font-size: 10px } b { font-size: 0.7rem } <i class="text-[9px]">').length, 3);
  assert.equal(tooSmall('a { font-size: 0.75rem } b { font-size: 12px } <i class="text-xs">').length, 0);
});

test('every viewer text size is at or above 0.75rem', () => {
  const found = sources(root).flatMap((path) => tooSmall(readFileSync(path, 'utf8')).map((size) => `${path.slice(root.length)}: ${size}`));
  assert.deepEqual(found, []);
});

test('the report column has the 1040px maximum of DESIGN.md "Layout"', () => {
  const css = readFileSync(new URL('../../frontend/src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.viewer-content \{ max-width: 1040px;/);
});
