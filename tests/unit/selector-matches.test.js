import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureWarnings, captureWarningLines, sanitizeWarnings, warningTotals, cellWarningsText, SELECTOR_MULTIPLE_MATCHES, WARNING_COUNT_LIMIT } from '../../src/report/warnings.js';
import { countSelectorMatches } from '../../src/capture/settle.js';
import { runWorkflow } from '../../src/workflow/index.js';

const CODE = SELECTOR_MULTIPLE_MATCHES;
// A page stub: `counts` maps a selector to its match count. A selector that is not in the map throws, as a bad selector does.
const pageOf = (counts) => ({ locator: (selector) => ({ count: async () => { if (!Object.hasOwn(counts, selector)) throw new Error('bad selector'); return counts[selector]; } }) });

test('a scope selector with more than one match warns with the match count (R5.17)', () => {
  assert.deepEqual(captureWarnings({ lazyImages: true, unloaded: 0, matches: 17 }), [{ code: CODE, count: 17 }]);
  assert.deepEqual(captureWarnings({ lazyImages: false, unloaded: 2, matches: 3 }), [{ code: 'LAZY_IMAGES_NOT_SWEPT', count: 2 }, { code: CODE, count: 3 }]);
  for (const matches of [0, 1, -2, 1.5, NaN, '5', null, undefined]) assert.deepEqual(captureWarnings({ lazyImages: true, unloaded: 0, matches }), [], String(matches));
  assert.deepEqual(captureWarnings({ lazyImages: true, matches: 99999 }), [{ code: CODE, count: WARNING_COUNT_LIMIT }]);
  assert.deepEqual(sanitizeWarnings(captureWarnings({ lazyImages: false, unloaded: 2, matches: 3 })), [{ code: 'LAZY_IMAGES_NOT_SWEPT', count: 2 }, { code: CODE, count: 3 }]);
});

test('the read takes the highest match count of the scope selectors and never fails (R5.17)', async () => {
  assert.equal(await countSelectorMatches(pageOf({ '.card': 17 }), '.card'), 17);
  assert.equal(await countSelectorMatches(pageOf({ '#one': 1, '.card': 4, '.tag': 2 }), ['#one', '.card', '.tag']), 4);
  assert.equal(await countSelectorMatches(pageOf({ '#one': 1 }), '#one'), 1);
  assert.equal(await countSelectorMatches(pageOf({ '#none': 0 }), '#none'), 0);
  assert.equal(await countSelectorMatches(pageOf({}), undefined), 0, 'A page target has no scope selector.');
  assert.equal(await countSelectorMatches(pageOf({ '#one': 3 }), ['#one', '::bad']), 0, 'A failed read writes no warning.');
});

test('the read changes nothing on the page and enters no hash (R5.17)', () => {
  const settle = readFileSync(new URL('../../src/capture/settle.js', import.meta.url), 'utf8');
  const body = settle.slice(settle.indexOf('export async function countSelectorMatches'));
  assert.doesNotMatch(body, /evaluate|click|scroll|fill/);
  const capture = readFileSync(new URL('../../src/capture/index.js', import.meta.url), 'utf8');
  assert.match(capture, /matches: await countSelectorMatches\(page, target\.selector\)/);
  assert.doesNotMatch(capture, /settingsHash\([^)]*matches/);
});

test('capture prints one stderr line that names counts, never a selector or a page (R5.11, R5.17)', () => {
  const run = { captures: [
    { targetId: 'cards', warnings: [{ code: CODE, count: 17 }] },
    { targetId: 'tags', warnings: [{ code: 'LAZY_IMAGES_NOT_SWEPT', count: 1 }, { code: CODE, count: 2 }] },
    { targetId: 'home' },
    { targetId: 'bad', warnings: [{ code: CODE, count: 0 }] },
  ] };
  const lines = captureWarningLines(run);
  assert.deepEqual(lines.filter((line) => line.startsWith(`Warning ${CODE}:`)), [`Warning ${CODE}: 2 captures use a selector that matches more than one element (up to 17 matches). The capture takes the first match.`]);
  assert.equal(lines.some((line) => /cards|tags|home/.test(line)), false);
  assert.deepEqual(captureWarningLines({ captures: [{ warnings: [{ code: CODE, count: 2 }] }] }), [`Warning ${CODE}: 1 capture uses a selector that matches more than one element (up to 2 matches). The capture takes the first match.`]);
  assert.deepEqual(captureWarningLines({ captures: [{}] }), []);
});

test('the report and the summary show the warning like any other code (R5.11, R5.17)', () => {
  const row = { warnings: { a: [{ code: CODE, count: 17 }], b: [] } };
  assert.deepEqual(warningTotals({ entries: [{ viewports: [row] }] }), [{ code: CODE, cells: 1, count: 17 }]);
  assert.equal(cellWarningsText(row), `A: ${CODE} (17) · B: none`);
});

test('run prints the same line as capture; before and after share its code path (R5.11, R5.17)', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'test-kit-matches-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'test-kit.config.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 1, sides: { local: { origin: 'http://127.0.0.1:8000' } }, targets: [{ id: 'home', kind: 'page', path: '/' }], viewports: [{ id: 'desktop', width: 1280, height: 900 }], artifacts: ['screenshot'], checks: [] }));
  const captures = [{ targetId: 'home', viewportId: 'desktop', state: 'captured', warnings: [{ code: CODE, count: 5 }] }];
  const ran = await runWorkflow('run', { config: file }, { capture: async () => ({ run: { id: 'run-1', state: 'complete', captures } }), summarizeRunFeedback: async () => ({ state: 'complete' }) });
  assert.deepEqual(ran.stderr, [`Warning ${CODE}: 1 capture uses a selector that matches more than one element (up to 5 matches). The capture takes the first match.`]);
  assert.equal(JSON.stringify(ran.output).includes('Warning'), false);
});
