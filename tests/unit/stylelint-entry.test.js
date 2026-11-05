// Tests for the `@parisek/test-kit/stylelint` entry point (R13.40, R13.46 to R13.49).
// The checks here are pure and need no peer package, so `npm test` runs them without `npm ci`.
// The tests that lint CSS are in tests/lint-cases/ and need stylelint and stylelint-config-standard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runWithPeers } from '../helpers/lint-peers.js';

const require = createRequire(import.meta.url);
const { assertPeers, LintPeerError, REQUIRED } = require('../../src/stylelint/peers.cjs');

const missing = (name) => (request) => {
  if (request === name) {
    const error = new Error(`Cannot find module '${name}'`);
    error.code = 'MODULE_NOT_FOUND';
    throw error;
  }
  return request;
};

test('both Stylelint peers are required, and a missing one gives LINT_PEER_MISSING (R13.47)', () => {
  assert.deepEqual(REQUIRED.map((peer) => peer.name), ['stylelint', 'stylelint-config-standard']);
  assert.doesNotThrow(() => assertPeers((request) => request));
  for (const name of ['stylelint', 'stylelint-config-standard']) {
    assert.throws(() => assertPeers(missing(name)), (error) => {
      assert.ok(error instanceof LintPeerError);
      assert.equal(error.code, 'LINT_PEER_MISSING');
      assert.equal(error.peer, name);
      assert.match(error.message, new RegExp(`"${name}".*npm i -D ${name}`));
      return true;
    });
  }
});

test('another resolution error is not a missing peer and surfaces as it is (R13.47)', () => {
  assert.throws(() => assertPeers(() => { throw new RangeError('x'); }), RangeError);
});

await runWithPeers('Stylelint entry point (lint cases)', ['stylelint', 'stylelint-config-standard'], () => import('../lint-cases/stylelint-entry.mjs'));
