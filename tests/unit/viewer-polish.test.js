import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Small visual fixes from the viewer design review (#471, items 1 to 5). Each rule follows DESIGN.md.
const design = readFileSync(new URL('../../DESIGN.md', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../frontend/src/style.css', import.meta.url), 'utf8');
function token(name) {
  const match = design.match(new RegExp(`^\\s+${name}: "(#[0-9a-f]{6})"`, 'm'));
  assert.ok(match, `DESIGN.md token ${name}`);
  return match[1];
}

test('the incomplete count sits beside the classes, not on a row of its own (DESIGN.md "Counts")', () => {
  const rule = css.match(/\n\.summary-metric\.summary-state \{([^}]*)\}/);
  assert.ok(rule, 'summary-state rule');
  assert.doesNotMatch(rule[1], /flex-basis: 100%/);
  assert.doesNotMatch(rule[1], /border-left: 0/);
});

test('a verdict dot on the light selected sidebar row uses the light verdict color', () => {
  for (const verdict of ['match', 'explained', 'unexplained', 'oracle']) {
    const match = css.match(new RegExp(`\\.target-row\\.selected \\.status-dot\\[data-status=${verdict}\\] \\{ background: (#[0-9a-f]{6})`));
    assert.ok(match, verdict);
    assert.equal(match[1], token(`verdict-${verdict}`), verdict);
  }
  const failed = css.match(/\.target-row\.selected \.status-dot\[data-status=failed\][^{]*\{ background: (#[0-9a-f]{6})/);
  assert.ok(failed, 'failed');
  assert.equal(failed[1], token('verdict-incomplete'));
});

test('the header controls keep a gap on a narrow screen', () => {
  assert.doesNotMatch(css, /\.toolbar-end \{ gap: 0;/);
});

test('a decision command uses the same command box as the Live page', () => {
  assert.match(css, /\.live-measure pre, \.live-missing pre, \.decision-text \{[^}]*border: 1px solid var\(--ui-border\)/);
});
