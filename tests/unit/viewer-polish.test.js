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

test('the incomplete count wraps by content, with no breakpoint rule (DESIGN.md "Counts" and "Layout")', () => {
  assert.doesNotMatch(css, /summary-state \{[^}]*flex-basis: 100%/);
  assert.doesNotMatch(css, /@media[^{]*\{ \.summary-metric\.summary-state/);
});

test('a verdict dot on the light selected sidebar row uses the light verdict color', () => {
  for (const verdict of ['match', 'explained', 'unexplained', 'oracle']) {
    const match = css.match(new RegExp(`\\.target-row\\.selected \\.status-dot\\[data-status=${verdict}\\] \\{ background: (#[0-9a-f]{6})`));
    assert.ok(match, verdict);
    assert.equal(match[1], token(`verdict-${verdict}`), verdict);
  }
  for (const state of ['failed', 'missing', 'incompatible']) {
    const match = css.match(new RegExp(`\\.target-row\\.selected \\.status-dot\\[data-status=${state}\\][^{]*\\{ background: (#[0-9a-f]{6})`));
    assert.ok(match, state);
    assert.equal(match[1], token('verdict-incomplete'), state);
  }
});

test('the header controls keep a gap on a narrow screen', () => {
  assert.doesNotMatch(css, /\.toolbar-end \{ gap: 0;/);
});

test('a decision command uses the same command box as the Live page', () => {
  const box = (selector) => css.match(new RegExp(`${selector} \\{[^}]*\\}`))[0];
  for (const part of ['padding: 8px 10px', 'border: 1px solid var(--ui-border)', 'border-radius: 5px', 'background: var(--ui-toolbar)']) {
    assert.ok(box('\\.live-measure pre, \\.live-missing pre').includes(part), `live ${part}`);
    assert.ok(box('\\n\\.decision-text').includes(part), `decision ${part}`);
  }
  // The decision command keeps its one-line scroll (viewer-workflow "Decision actions").
  assert.doesNotMatch(box('\\n\\.decision-text'), /white-space/);
});
