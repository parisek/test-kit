import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unionArea, masksCoveringTarget, MASK_COVER_RATIO } from '../../src/capture/mask-cover.js';
import { captureWarnings, captureWarningLines, warningTotals, MASK_COVERS_TARGET } from '../../src/report/warnings.js';
import { readMaskCover } from '../../src/capture/settle.js';

const area = { x: 0, y: 0, width: 100, height: 100 };
const box = (x, y, width, height) => ({ x, y, width, height });

test('the union area counts an overlap once and clips to the captured area (R5.18)', () => {
  assert.equal(unionArea([box(0, 0, 100, 100)], area), 10000);
  assert.equal(unionArea([box(0, 0, 60, 100), box(40, 0, 60, 100)], area), 10000);
  assert.equal(unionArea([box(0, 0, 50, 50), box(0, 0, 50, 50)], area), 2500);
  assert.equal(unionArea([box(-50, -50, 100, 100)], area), 2500);
  assert.equal(unionArea([box(200, 0, 10, 10)], area), 0);
  assert.equal(unionArea([box(0, 0, 50, 100), box(60, 0, 40, 100)], area), 9000);
  assert.equal(unionArea([box(0, 0, 0, 10), box(0, 0, NaN, 1), null], area), 0);
});

test('masks warn from 95 % of the captured area, and the count names the masks inside it (R5.18)', () => {
  assert.equal(MASK_COVER_RATIO, 0.95);
  assert.equal(masksCoveringTarget([[box(0, 0, 100, 100)]], area), 1);
  assert.equal(masksCoveringTarget([[box(0, 0, 100, 95)]], area), 1, 'Exactly 95 % warns.');
  assert.equal(masksCoveringTarget([[box(0, 0, 100, 94)]], area), 0);
  assert.equal(masksCoveringTarget([[box(0, 0, 50, 100)], [box(50, 0, 50, 100)], [box(500, 0, 10, 10)]], area), 2, 'A mask outside the area is not counted.');
  assert.equal(masksCoveringTarget([[box(0, 0, 50, 100), box(50, 0, 50, 100)]], area), 1, 'One selector with two matches is one mask.');
  assert.equal(masksCoveringTarget([], area), 0);
  assert.equal(masksCoveringTarget([[]], area), 0);
  assert.equal(masksCoveringTarget([[box(0, 0, 100, 100)]], box(0, 0, 0, 0)), 0, 'An area with no size gives no warning.');
  assert.equal(masksCoveringTarget('x', area), 0);
});

test('the warning and its stderr line name counts only (R5.11, R5.18)', () => {
  assert.deepEqual(captureWarnings({ lazyImages: true, covering: 2 }), [{ code: MASK_COVERS_TARGET, count: 2 }]);
  for (const covering of [0, -1, 1.5, '2', undefined]) assert.deepEqual(captureWarnings({ lazyImages: true, covering }), []);
  const lines = captureWarningLines({ captures: [{ targetId: 'hero', warnings: [{ code: MASK_COVERS_TARGET, count: 1 }] }, { targetId: 'home' }] });
  assert.deepEqual(lines, [`Warning ${MASK_COVERS_TARGET}: 1 capture has masks that cover at least 95 % of the captured area. The comparison checks almost nothing there. Mask the media element, not its container.`]);
  assert.match(captureWarningLines({ captures: [{ warnings: [{ code: MASK_COVERS_TARGET, count: 1 }] }, { warnings: [{ code: MASK_COVERS_TARGET, count: 3 }] }] })[0], /^Warning MASK_COVERS_TARGET: 2 captures have masks/);
  assert.deepEqual(warningTotals({ entries: [{ viewports: [{ warnings: { a: [], b: [{ code: MASK_COVERS_TARGET, count: 1 }] } }] }] }), [{ code: MASK_COVERS_TARGET, cells: 1, count: 1 }]);
});

test('the read needs a mask and never fails a capture (R5.18)', async () => {
  const throwing = { locator: () => ({ evaluateAll: async () => { throw new Error('bad selector'); }, first() { return this; } }), evaluate: async () => { throw new Error('x'); } };
  assert.equal(await readMaskCover(throwing, { masks: [] }), null);
  assert.equal(await readMaskCover(throwing, { masks: undefined }), null);
  assert.equal(await readMaskCover(throwing, { masks: ['::bad'] }), null);
  const page = { locator: selector => ({ first() { return this; }, evaluateAll: async () => (selector === '#hero' ? [box(10, 10, 100, 50)] : [box(0, 0, 500, 500)]) }), evaluate: async () => area };
  assert.deepEqual(await readMaskCover(page, { selector: '#hero', masks: ['.bg'] }), { masks: [[box(0, 0, 500, 500)]], area: box(10, 10, 100, 50) });
  assert.deepEqual(await readMaskCover(page, { masks: ['.bg'], fullPage: true }), { masks: [[box(0, 0, 500, 500)]], area });
  const empty = { locator: () => ({ first() { return this; }, evaluateAll: async () => [] }) };
  assert.equal(await readMaskCover(empty, { selector: '#none', masks: ['.bg'] }), null);
});

test('the read changes nothing on the page and enters no hash (R5.18)', () => {
  const settle = readFileSync(new URL('../../src/capture/settle.js', import.meta.url), 'utf8');
  const body = settle.slice(settle.indexOf('export async function readMaskCover'));
  assert.doesNotMatch(body, /click|scroll\(|scrollTo|fill|style\./);
  const capture = readFileSync(new URL('../../src/capture/index.js', import.meta.url), 'utf8');
  assert.match(capture, /covering: cover \? masksCoveringTarget\(cover\.masks, cover\.area\) : 0/);
  assert.doesNotMatch(capture, /settingsHash\([^)]*cover/);
});
