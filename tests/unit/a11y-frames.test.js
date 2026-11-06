import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveChecks, runChecks } from '../../src/packs/index.js';
import { a11yPack, reduceAxeResults } from '../../src/packs/a11y/index.js';
import { classifyFrames, frameIdsByMark, MAX_FRAMES } from '../../src/packs/a11y/frames.js';

const raw = () => JSON.parse(readFileSync(new URL('../fixtures/a11y/axe-result.json', import.meta.url), 'utf8'));
const run = value => runChecks(resolveChecks({ available: [a11yPack], packs: ['a11y'] }), { artifact: 'a11y', value }, { targetId: 'example-site' });
const top = 'http://example-site.test/page';

test('a frame of the page origin is reachable, another origin is not (R13.51)', () => {
  const out = classifyFrames(top, [
    { url: 'http://example-site.test/inner', parent: -1 },
    { url: 'http://example-site.test:8080/inner', parent: -1 },
    { url: 'https://example-site.test/inner', parent: -1 },
    { url: 'http://other.test/', parent: -1 }
  ]);
  assert.deepEqual(out.reachable, [true, false, false, false]);
  assert.deepEqual([out.injected, out.unreachable], [1, 3]);
});

test('about:blank and srcdoc frames are reachable only when the parent chain is reachable', () => {
  const out = classifyFrames(top, [
    { url: 'about:blank', parent: -1 },
    { url: 'about:srcdoc', parent: 0 },
    { url: 'http://other.test/', parent: -1 },
    { url: 'about:blank', parent: 2 },
    { url: 'about:srcdoc', parent: 3 },
    { url: 'http://example-site.test/x', parent: 2 }
  ]);
  assert.deepEqual(out.reachable, [true, true, false, false, false, false]);
});

test('a detached frame, an opaque origin and a bad parent are unreachable', () => {
  const out = classifyFrames(top, [
    { url: 'about:blank', parent: -1, detached: true },
    { url: 'data:text/html,x', parent: -1 },
    { url: 'about:blank', parent: 5 },
    { url: 'not a url', parent: -1 },
    null
  ]);
  assert.deepEqual(out.reachable, [false, false, false, false, false]);
  assert.equal(out.unreachable, 5);
});

test('a top page with an opaque origin reaches no frame (setContent)', () => {
  const out = classifyFrames('about:blank', [{ url: 'about:blank', parent: -1 }, { url: 'data:text/html,x', parent: -1 }]);
  assert.deepEqual(out.reachable, [false, false]);
  assert.equal(out.unreachable, 2);
});

test('frames beyond the bound count as unreachable', () => {
  const frames = Array.from({ length: MAX_FRAMES + 3 }, () => ({ url: 'about:blank', parent: -1 }));
  const out = classifyFrames(top, frames);
  assert.equal(out.injected, MAX_FRAMES);
  assert.equal(out.unreachable, 3);
  assert.throws(() => classifyFrames(top, 'x'), /list/);
});

test('unreachable frames give one needsReview warning and the check stays complete (R8.14)', () => {
  const artifact = reduceAxeResults(raw(), { injected: 2, unreachable: 3 });
  assert.deepEqual(artifact.frames, { injected: 2, unreachable: 3 });
  const result = run(artifact);
  assert.equal(result.state, 'complete');
  const warns = result.findings.filter(finding => finding.evidence.unreachableFrames !== undefined);
  assert.equal(warns.length, 1);
  assert.equal(warns[0].severity, 'warning');
  assert.equal(warns[0].evidence.needsReview, true);
  assert.equal(warns[0].evidence.unreachableFrames, 3);
  assert.equal(warns[0].evidence.state, undefined);
  assert.match(warns[0].message, /3 frames were not checked/);
});

test('no unreachable frame and an old artifact without frames give no warning', () => {
  for (const frames of [undefined, { injected: 1, unreachable: 0 }]) {
    const result = run(reduceAxeResults(raw(), frames));
    assert.equal(result.state, 'complete');
    assert.equal(result.findings.some(finding => finding.evidence.unreachableFrames !== undefined), false);
  }
});

test('bad frame counts fail closed', () => {
  assert.equal(reduceAxeResults(raw(), { injected: -1, unreachable: 0 }).status, 'failed');
  assert.equal(reduceAxeResults(raw(), 'x').status, 'failed');
  const good = reduceAxeResults(raw(), { injected: 1, unreachable: 1 });
  for (const frames of [{ injected: 1 }, { injected: 1.5, unreachable: 0 }, null, []]) assert.equal(run({ ...good, frames }).state, 'failed', JSON.stringify(frames));
});

const rule = (id, impact, ...targets) => ({ id, impact, help: id, helpUrl: null, nodes: targets.map(target => ({ target, html: '<x>' })) });
const base = () => ({ ...raw(), violations: [rule('image-alt', 'minor', ['#a'])], incomplete: [], passes: [{ id: 'p1' }], inapplicable: [] });

test('a frame result merges by rule id with the frame chain in front of each target (R13.51)', async () => {
  const { mergeFrameResult } = await import('../../src/packs/a11y/axe.js');
  const merged = mergeFrameResult(base(), ['iframe#f'], { violations: [rule('image-alt', 'critical', ['#b']), rule('link-name', 'serious', ['a'])], incomplete: [], passes: [{ id: 'p1' }, { id: 'p2' }], inapplicable: [] });
  assert.equal(merged.violations.length, 2);
  assert.equal(merged.violations[0].impact, 'critical');
  assert.deepEqual(merged.violations[0].nodes.map(node => node.target), [['#a'], ['iframe#f', '#b']]);
  assert.equal(merged.passes.length, 2);
  const artifact = reduceAxeResults(merged);
  assert.equal(artifact.violations[0].nodes[1].selector, 'iframe#f #b');
});

test('a malformed frame result throws and leaves the base unchanged', async () => {
  const { mergeFrameResult } = await import('../../src/packs/a11y/axe.js');
  const input = base();
  const before = JSON.stringify(input);
  for (const bad of [null, { violations: 'x', incomplete: [], passes: [], inapplicable: [] }, { violations: [{ id: '' }], incomplete: [], passes: [], inapplicable: [] }]) assert.throws(() => mergeFrameResult(input, ['iframe'], bad));
  assert.throws(() => mergeFrameResult(input, [], { violations: [], incomplete: [], passes: [], inapplicable: [] }));
  assert.equal(JSON.stringify(input), before);
});

test('the warning reads in the singular for one frame', () => {
  const warn = run(reduceAxeResults(raw(), { injected: 0, unreachable: 1 })).findings.find(finding => finding.evidence.unreachableFrames === 1);
  assert.match(warn.message, /^1 frame was not checked/);
});

test('frame IDs come from the marks in the browser DOM tree, through nested documents (R13.51)', () => {
  const frame = (value, frameId, ...children) => ({ attributes: ['title', 'x', 'data-m', value], frameId, children: [], contentDocument: { children } });
  const root = { children: [{ children: [frame('0', 'A', frame('1', 'B')), { attributes: ['data-m', '2'], children: [] }, frame('3', 'C')] }] };
  const ids = frameIdsByMark(root, 'data-m');
  assert.deepEqual([...ids].sort(), [['0', 'A'], ['1', 'B'], ['3', 'C']]); // a node with no frame ID gives no entry
  assert.equal(frameIdsByMark(root, 'other').size, 0);
  assert.equal(frameIdsByMark(null, 'data-m').size, 0);
});

test('a DOM tree beyond the bound throws', () => {
  let root = { children: [] };
  const wide = { children: Array.from({ length: 600000 }, () => ({})) };
  root = wide;
  assert.throws(() => frameIdsByMark(root, 'x'), /too large/);
});

test('a failed frame gets its own warning and the counts are validated', () => {
  const artifact = reduceAxeResults(raw(), { injected: 1, unreachable: 1, failed: 2 });
  assert.deepEqual(artifact.frames, { injected: 1, unreachable: 1, failed: 2 });
  const result = run(artifact);
  assert.equal(result.state, 'complete');
  const warn = result.findings.find(finding => finding.evidence.failedFrames !== undefined);
  assert.equal(warn.severity, 'warning');
  assert.equal(warn.evidence.needsReview, true);
  assert.match(warn.message, /^2 frames could not be checked: axe failed in the frame, or its result did not merge/);
  assert.doesNotMatch(warn.message, /page origin/);
  assert.equal(result.findings.filter(finding => finding.evidence.unreachableFrames !== undefined).length, 1);
  assert.equal(reduceAxeResults(raw(), { injected: 1, unreachable: 0, failed: -1 }).status, 'failed');
  assert.equal(run({ ...artifact, frames: { injected: 1, unreachable: 0, failed: 1.5 } }).state, 'failed');
  assert.equal(reduceAxeResults(raw(), { injected: 1, unreachable: 0, failed: 0 }).frames.failed, undefined);
});
