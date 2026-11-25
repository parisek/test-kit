import test from 'node:test';
import assert from 'node:assert/strict';
import { lazyGrowthError } from '../../src/capture/settle.js';

const HINT = 'Set settle.lazyImages only on targets with native lazy images.';

test('the growth failure names both heights and the setting (R5.9, #413)', () => {
  const error = lazyGrowthError(new Error('page.evaluate: Error: Lazy-image page grows during settlement (3120 px to 3480 px).\n    at <anonymous>:12:3'));
  assert.equal(error.code, 'LAZY_PAGE_GROWS');
  assert.equal(error.message, `Lazy-image page grows during settlement (3120 px to 3480 px). ${HINT}`);
});

test('the stored message comes from two integers, never from page text (R5.9, #413)', () => {
  const error = lazyGrowthError(new Error('<img src=x> Lazy-image page grows during settlement (0012 px to 99 px) evil'));
  assert.equal(error.message, `Lazy-image page grows during settlement (12 px to 99 px). ${HINT}`);
  assert.doesNotMatch(error.message, /img|evil/);
});

test('any other error passes unchanged (R5.9)', () => {
  const other = new Error('Lazy-image page exceeds the settlement height limit.');
  assert.equal(lazyGrowthError(other), other);
  const long = new Error('Lazy-image page grows during settlement (1234567890 px to 2 px).');
  assert.equal(lazyGrowthError(long), long, 'A height with more than 9 digits is not a page height.');
  assert.equal(lazyGrowthError(undefined), undefined);
});
