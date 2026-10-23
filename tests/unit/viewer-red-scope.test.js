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

// A literal red in style.css is an unexplained verdict token of DESIGN.md, and nothing else.
const design = readFileSync(new URL('../../DESIGN.md', import.meta.url), 'utf8');
const unexplained = ['verdict-unexplained', 'dark-verdict-unexplained'].map((name) => design.match(new RegExp(`^\\s+${name}: "(#[0-9a-f]{6})"`, 'm'))[1]);
function isRed(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 0.25 || max !== r) return false;
  const hue = (60 * (g - b) / (max - min) + 360) % 360;
  return hue < 15 || hue > 345;
}

test('a literal red color in style.css is an unexplained verdict token', () => {
  const css = readFileSync(join(root, 'style.css'), 'utf8');
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const declaration of body.split(';')) {
      for (const [hex] of declaration.matchAll(/#[0-9a-f]{6}\b/gi)) {
        if (!isRed(hex)) continue;
        const where = `${selector.trim()} ${declaration.trim()}`;
        assert.match(selector + declaration, /unexplained/, where);
        assert.ok(unexplained.includes(hex.toLowerCase()), where);
      }
    }
  }
});
