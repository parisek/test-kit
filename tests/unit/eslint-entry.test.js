// Pure tests for the ESLint entry point (R13.46 to R13.50). They need no peer package: `npm test` runs them
// without `npm ci`. The tests that lint code are in tests/lint-cases/ and need the peers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig } from '../../src/eslint/config.js';
import { LintPeerError, loadPeers, isMissing } from '../../src/eslint/peers.js';
import plugin from '../../src/eslint/rules/index.js';
import { runWithPeers } from '../helpers/lint-peers.js';

const stubs = { js: { configs: { recommended: {} } }, importPlugin: {} };

test('every rule keeps its messageIds, and no message holds a link (R13.50)', () => {
  const expected = {
    'no-deprecated-dependency': ['deprecated'],
    'no-top-level-heavy-lib-import': ['topLevel'],
    'no-top-level-throw': ['topLevelThrow'],
    'require-reduced-motion-guard': ['unguarded'],
  };
  assert.deepEqual(Object.keys(plugin.rules).sort(), Object.keys(expected));
  for (const [name, ids] of Object.entries(expected)) {
    const messages = plugin.rules[name].meta.messages;
    assert.deepEqual(Object.keys(messages), ids, name);
    for (const text of Object.values(messages)) assert.doesNotMatch(text, /https?:\/\/|www\./, name);
  }
});

test('buildConfig adds the globals, TypeScript and Vue blocks only when their peers are present (R13.47)', () => {
  const names = (config) => config.map((block) => block.name).filter(Boolean);
  assert.deepEqual(names(buildConfig(stubs)), ['test-kit/eslint/base']);
  assert.deepEqual(names(buildConfig({ ...stubs, globals: { browser: { window: 'readonly' }, node: { process: 'readonly' } } })), [
    'test-kit/eslint/base', 'test-kit/eslint/node',
  ]);
  const tseslint = { parser: {}, plugin: {} };
  assert.ok(names(buildConfig({ ...stubs, tseslint })).includes('test-kit/eslint/typescript'));
  const bare = buildConfig(stubs)[1];
  assert.deepEqual(bare.languageOptions.globals, {});
  assert.equal(bare.rules['no-undef'], 'off');
  const full = buildConfig({ ...stubs, globals: { browser: { window: 'readonly' }, node: {} } })[1];
  assert.equal(full.rules['no-undef'], 'error');
  assert.deepEqual(full.languageOptions.globals, { window: 'readonly' });
});

test('loadPeers: required peers throw LINT_PEER_MISSING, enhancements warn (R13.47)', async () => {
  const present = { '@eslint/js': { default: { configs: {} } }, 'eslint-plugin-import': { default: {} } };
  const importer = (missing = [], extra = {}) => async (name) => {
    if (missing.includes(name)) {
      const error = new Error(`Cannot find package '${name}' imported from /p/x.js`);
      error.code = 'ERR_MODULE_NOT_FOUND';
      throw error;
    }
    const mod = { ...present, ...extra }[name];
    return mod ?? { default: { name } };
  };

  await assert.rejects(loadPeers(importer(['@eslint/js'])), (error) => {
    assert.ok(error instanceof LintPeerError);
    assert.equal(error.code, 'LINT_PEER_MISSING');
    assert.equal(error.peer, '@eslint/js');
    assert.match(error.message, /"@eslint\/js".*npm i -D eslint @eslint\/js/);
    return true;
  });
  await assert.rejects(loadPeers(importer(['eslint-plugin-import'])), { code: 'LINT_PEER_MISSING', peer: 'eslint-plugin-import' });

  const all = await loadPeers(importer());
  assert.deepEqual(all.warnings, []);
  assert.ok(all.globals && all.tseslint && all.vue && all.vueParser);

  const none = await loadPeers(importer(['globals', 'typescript-eslint', 'eslint-plugin-vue']));
  assert.equal(none.warnings.length, 3);
  assert.match(none.warnings[0], /"globals".*npm i -D globals/);
  assert.match(none.warnings[1], /"typescript-eslint".*not linted/);
  assert.match(none.warnings[2], /"eslint-plugin-vue" is not installed/);
  assert.equal(none.vue, null);

  const half = await loadPeers(importer(['vue-eslint-parser']));
  assert.equal(half.vue, null);
  assert.equal(half.vueParser, null);
  assert.match(half.warnings[0], /"vue-eslint-parser" is not installed/);
});

test('loadPeers rethrows an error that is not "this package is missing"', async () => {
  const broken = async (name) => {
    if (name === 'globals') {
      const error = new Error("Cannot find package 'other-thing' imported from /p/globals.js");
      error.code = 'ERR_MODULE_NOT_FOUND';
      throw error;
    }
    return { default: { name } };
  };
  await assert.rejects(loadPeers(broken), /other-thing/);
  assert.equal(isMissing(new Error('x'), 'globals'), false);
  assert.equal(isMissing(null, 'globals'), false);
});

await runWithPeers('ESLint entry point (lint cases)', ['eslint', '@eslint/js', 'eslint-plugin-import', 'typescript-eslint', 'eslint-plugin-vue', 'vue-eslint-parser', 'globals'], () => import('../lint-cases/eslint-entry.mjs'));
