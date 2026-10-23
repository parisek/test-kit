import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// DESIGN.md: red signals only "unexplained" and the focus ring.
const root = new URL('../../frontend/src/', import.meta.url).pathname;
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(vue|js|css)$/.test(entry.name) && !entry.name.endsWith('.spec.js') ? [path] : [];
  });
}

test('no viewer state other than unexplained uses a red utility class', () => {
  for (const path of sources(root)) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /\b(?:text|bg|border)-red-\d/, path);
  }
});

test('a failed target dot uses the incomplete color, not the unexplained one', () => {
  const css = readFileSync(join(root, 'style.css'), 'utf8');
  const rule = css.match(/([^\n}]*\[data-status=failed\][^{]*)\{ background: (#[0-9a-f]{6}); \}/);
  assert.ok(rule, 'status-dot failed rule');
  assert.equal(rule[2], '#fbbf24');
  assert.doesNotMatch(rule[1], /unexplained/);
});
