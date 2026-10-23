import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// DESIGN.md: state colors come from the verdict tokens. A verdict color never fills a row or a panel.
const root = new URL('../../frontend/src/', import.meta.url).pathname;
const design = readFileSync(new URL('../../DESIGN.md', import.meta.url), 'utf8');
const token = (name) => design.match(new RegExp(`^\\s+${name}: "(#[0-9a-f]{6})"`, 'm'))[1];
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(vue|js|css)$/.test(entry.name) && !entry.name.endsWith('.spec.js') ? [path] : [];
  });
}

test('no viewer source uses a Tailwind green or amber palette class for a state', () => {
  for (const path of sources(root)) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /\b(?:text|bg|border)-(?:emerald|green|amber|yellow)-\d/, path);
  }
});

test('the sidebar status dots use the dark verdict tokens', () => {
  const css = readFileSync(join(root, 'style.css'), 'utf8');
  const dot = (status) => css.match(new RegExp(`\\.status-dot\\[data-status=${status}\\][^{]*\\{ background: (#[0-9a-f]{6}); \\}`))[1];
  for (const verdict of ['match', 'explained', 'unexplained', 'oracle']) assert.equal(dot(verdict), token(`dark-verdict-${verdict}`), verdict);
  for (const state of ['failed', 'missing', 'incompatible']) assert.equal(dot(state), token('dark-verdict-incomplete'), state);
});
