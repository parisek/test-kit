import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// DESIGN.md: the touch size is 2.75rem. On a coarse pointer every control gets that hit area.
const css = readFileSync(new URL('../../frontend/src/style.css', import.meta.url), 'utf8');

test('a coarse pointer gives every button, tab, summary, link, select and input a 2.75rem hit area', () => {
  const coarse = [...css.matchAll(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/g)].map(([, body]) => body).join('\n');
  assert.match(coarse, /button:not\(\.button-primary\)::after, \[role=tab\]::after, summary::after, a\[href\]::after \{[^}]*inset: min\(0px, calc\(\(100% - 2\.75rem\) \/ 2\)\) 0;/);
  assert.match(coarse, /button:not\(\.button-primary\), \[role=tab\], summary, a\[href\] \{ position: relative; \}/);
  assert.match(coarse, /select, input:not\(\[type=checkbox\], \[type=radio\]\) \{ min-height: 2\.75rem; \}/);
});
