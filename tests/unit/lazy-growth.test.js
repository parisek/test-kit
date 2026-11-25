import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lazyGrowthError } from '../../src/capture/settle.js';

const HINT = 'Set settle.lazyImages only on targets with native lazy images.';

test('the growth failure names both heights and the setting (R5.9, #413)', () => {
  const error = lazyGrowthError({ grew: [3120, 3480] });
  assert.equal(error.code, 'LAZY_PAGE_GROWS');
  assert.equal(error.message, `Lazy-image page grows during settlement (3120 px to 3480 px). ${HINT}`);
});

test('only a structured result of two safe integers is a growth failure (R5.9, #413)', () => {
  for (const value of [null, undefined, {}, { grew: [] }, { grew: [1] }, { grew: [1, 2, 3] }, { grew: ['1', 2] }, { grew: [1.5, 2] }, { grew: [-1, 2] }, { grew: [1, Number.MAX_SAFE_INTEGER + 2] }, { grew: '<img src=x>' }, new Error('Lazy-image page grows during settlement (1 px to 2 px).')]) {
    assert.equal(lazyGrowthError(value), null, JSON.stringify(value));
  }
});

test('the growth signal is a local class, never parsed from error text (R5.9, #413)', () => {
  const source = readFileSync(new URL('../../src/capture/settle.js', import.meta.url), 'utf8');
  assert.match(source, /class Grown/);
  assert.match(source, /error instanceof Grown/);
  assert.doesNotMatch(source, /exec\(String\(error/);
});
