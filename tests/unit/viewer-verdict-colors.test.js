import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// DESIGN.md names one color for each verdict, in light and dark.
const design = readFileSync(new URL('../../DESIGN.md', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../frontend/src/style.css', import.meta.url), 'utf8');
function token(name) {
  const match = design.match(new RegExp(`^\\s+${name}: "(#[0-9a-f]{6})"`, 'm'));
  assert.ok(match, `DESIGN.md token ${name}`);
  return match[1];
}
function color(selector) {
  const match = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]=]/g, '\\$&')} \\{ color: (#[0-9a-f]{6})`));
  assert.ok(match, `style.css rule ${selector}`);
  return match[1];
}

test('verdict badges and counts use the DESIGN.md verdict colors', () => {
  for (const verdict of ['match', 'explained', 'unexplained', 'oracle']) {
    assert.equal(color(`.badge-${verdict}`), token(`verdict-${verdict}`), verdict);
    assert.equal(color(`.dark .badge-${verdict}`), token(`dark-verdict-${verdict}`), `dark ${verdict}`);
  }
  for (const verdict of ['match', 'explained', 'unexplained', 'incomplete']) {
    assert.equal(color(`.summary-metric[data-status=${verdict}] strong`), token(`verdict-${verdict}`), verdict);
    assert.equal(color(`.dark .summary-metric[data-status=${verdict}] strong`), token(`dark-verdict-${verdict}`), `dark ${verdict}`);
  }
});

test('a zero count and an oracle count use the muted text color', () => {
  assert.match(css, /\.summary-metric\[data-status=oracle\] strong, \.summary-metric\[data-zero\] strong, \.dark \.summary-metric\[data-zero\] strong \{ color: var\(--ui-muted\); \}/);
  const at = (rule) => css.indexOf(rule);
  assert.ok(at('.summary-metric[data-zero] strong') > at('.dark .summary-metric[data-status=incomplete] strong'), 'the zero rule comes after the verdict rules');
});
