import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// DESIGN.md: text takes its color from a token. A partial opacity on muted text drops it under 4.5:1 (axe, 2026-10-24).
const root = new URL('../../frontend/src/', import.meta.url).pathname;
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.vue$/.test(entry.name) ? [path] : [];
  });
}

test('no viewer component dims text with a partial opacity utility', () => {
  for (const path of sources(root)) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /(?<![\w:-])opacity-(?:[1-9]\d?)\b/, path);
  }
});
