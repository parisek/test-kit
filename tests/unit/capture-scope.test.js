import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeGeometry } from '../../src/capture/scope-geometry.js';
const viewport = { width: 800, height: 600, scrollX: 0, scrollY: 0 };
test('scope unions use every rectangle and preserve fractional border origins', () => {
  const rectangles = [{ x: 10.25, y: 20.5, width: 100.5, height: 40.25 }, { x: 30, y: 80, width: 200.4, height: 20.5 }];
  const copy = structuredClone(rectangles);
  assert.deepEqual(scopeGeometry(rectangles, viewport), { clip: { x: 10.25, y: 20.5, width: 220, height: 80 }, fullPage: false, coordinateSpace: 'viewport', unit: 'css-px', box: 'border' });
  assert.deepEqual(rectangles, copy);
});
test('scope uses document capture for tall unions without truncating the tail', () => {
  assert.deepEqual(scopeGeometry([{ x: 20, y: 100, width: 400, height: 900 }], viewport).clip, { x: 20, y: 100, width: 400, height: 900 });
  assert.equal(scopeGeometry([{ x: 20, y: 100, width: 400, height: 900 }], viewport).fullPage, true);
});
test('scope accounts for scroll only when switching coordinate space', () => {
  const scrolled = { ...viewport, scrollY: 250 };
  assert.deepEqual(scopeGeometry([{ x: 20, y: 300, width: 200, height: 100 }], scrolled).clip, { x: 20, y: 50, width: 200, height: 100 });
  assert.deepEqual(scopeGeometry([{ x: 20, y: 300, width: 200, height: 900 }], scrolled).clip, { x: 20, y: 300, width: 200, height: 900 });
});
test('content scope rounds outward and clips negative document origins without moving the far edge', () => {
  assert.deepEqual(scopeGeometry([{ x: 10.4, y: 20.2, width: 100.1, height: 40.3 }], viewport, { box: 'content' }).clip, { x: 10, y: 20, width: 101, height: 41 });
  assert.deepEqual(scopeGeometry([{ x: -5, y: -10, width: 100, height: 50 }], viewport).clip, { x: 0, y: 0, width: 95, height: 40 });
});
test('scope rejects invalid, empty and excessive geometry', () => {
  for (const rectangles of [[], [{ x: 0, y: 0, width: 0, height: 10 }], [{ x: NaN, y: 0, width: 10, height: 10 }], [{ x: 0, y: 0, width: 1, height: 30001 }]]) assert.throws(() => scopeGeometry(rectangles, viewport));
  assert.throws(() => scopeGeometry([{ x: 0, y: 0, width: 10, height: 10 }], viewport, { box: 'other' }));
});
