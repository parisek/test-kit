// Tests for the `@parisek/test-kit/eslint` entry point (R13.40, R13.46 to R13.50).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';
import { ESLint } from 'eslint';
import entry, { plugin } from '../../src/eslint/index.js';
import { buildConfig } from '../../src/eslint/config.js';
import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const register = path.join(root, 'tests/fixtures/lint/block-modules-register.mjs');
const entryUrl = pathToFileURL(path.join(root, 'src/eslint/index.js')).href;

async function lint(code, filePath, extra = []) {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: [...entry, ...extra] });
  const [result] = await eslint.lintText(code, { filePath: path.join(root, filePath) });
  return result.messages;
}

const ids = (messages) => messages.map((m) => m.ruleId);

test('the entry point is a flat-config array with the portadesign namespace and its four rules at fixed levels', () => {
  assert.ok(Array.isArray(entry));
  assert.deepEqual(Object.keys(plugin.rules).sort(), [
    'no-deprecated-dependency', 'no-top-level-heavy-lib-import', 'no-top-level-throw', 'require-reduced-motion-guard',
  ]);
  const base = entry.find((block) => block.name === 'test-kit/eslint/base');
  assert.equal(base.plugins.portadesign, plugin);
  assert.deepEqual(
    Object.fromEntries(Object.entries(base.rules).filter(([id]) => id.startsWith('portadesign/'))),
    {
      'portadesign/no-top-level-heavy-lib-import': 'error',
      'portadesign/no-deprecated-dependency': 'error',
      'portadesign/no-top-level-throw': 'error',
      'portadesign/require-reduced-motion-guard': 'warn',
    },
  );
});

test('the config holds no project value: no vendor globals and no ignore paths (R13.48)', async () => {
  assert.ok(entry.every((block) => !('ignores' in block) || block.files));
  const base = entry.find((block) => block.name === 'test-kit/eslint/base');
  for (const name of ['gsap', 'Alpine', 'wp', 'dataLayer', 'google']) {
    assert.equal(name in base.languageOptions.globals, false, name);
  }
  assert.deepEqual(ids(await lint('gsap.to(".x");\n', 'src/a.js')), ['no-undef']);
});

test('portadesign rules report through the entry point', async () => {
  const messages = await lint('import $ from "jquery";\nexport { $ };\nthrow new Error("x");\n', 'src/a.js');
  assert.deepEqual(ids(messages).sort(), ['portadesign/no-deprecated-dependency', 'portadesign/no-top-level-throw']);
  const motion = await lint('import gsap from "gsap";\nexport { gsap };\n', 'src/b.js');
  assert.deepEqual(motion.map((m) => [m.ruleId, m.severity]).sort(), [
    ['portadesign/no-top-level-heavy-lib-import', 2],
    ['portadesign/require-reduced-motion-guard', 1],
  ]);
});

test('a project block after the entry point overrides rules, options and globals (R13.40)', async () => {
  const code = 'import gsap from "gsap";\nexport { gsap };\nthrow new Error("x");\n';
  const off = await lint(code, 'src/a.js', [
    { rules: { 'portadesign/no-top-level-throw': 'off', 'portadesign/no-top-level-heavy-lib-import': ['error', { heavyLibs: ['lightgallery'] }] } },
  ]);
  assert.deepEqual(ids(off), ['portadesign/require-reduced-motion-guard']);
  const globalsAdded = await lint('gsap.to(".x");\n', 'src/a.js', [{ languageOptions: { globals: { gsap: 'readonly' } } }]);
  assert.deepEqual(globalsAdded, []);
  // The project ignore path works after the entry point.
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: [...entry, { ignores: ['src/legacy/**'] }] });
  assert.equal(await eslint.isPathIgnored(path.join(root, 'src/legacy/a.js')), true);
});

test('a portadesign disable comment works and the namespace resolves (R13.49)', async () => {
  const inline = 'import $ from "jquery"; // eslint-disable-line portadesign/no-deprecated-dependency -- migration\nexport { $ };\n';
  assert.deepEqual(await lint(inline, 'src/a.js'), []);
  const next = '/* eslint-disable portadesign/no-top-level-throw -- one boot guard */\nthrow new Error("x");\n';
  assert.deepEqual(await lint(next, 'src/a.js'), []);
  // A disable comment for a rule that does not exist is reported. This proves the check above is not vacuous.
  const wrong = await lint('// eslint-disable-next-line portadesign/no-such-rule\nconst a = 1;\nexport { a };\n', 'src/a.js');
  assert.match(wrong[0].message, /no-such-rule/);
});

test('TypeScript and Vue files lint with their parsers', async () => {
  const ts = await lint('import type { Ref } from "vue";\nexport const a: Ref<number> | null = null;\n', 'src/a.ts');
  assert.deepEqual(ts, []);
  const vue = [
    '<script setup lang="ts">',
    'import { ref } from "vue";',
    'const n = ref<number>(0);',
    '</script>',
    '<template><p>{{ n }}</p></template>',
    '',
  ].join('\n');
  const fatal = (await lint(vue, 'src/widget/Widget.vue')).filter((m) => m.fatal);
  assert.deepEqual(fatal, []);
});

test('buildConfig drops the TypeScript, Vue and globals blocks when their peers are absent (R13.47)', async () => {
  const config = buildConfig({ js, importPlugin });
  assert.deepEqual(config.map((b) => b.name).filter(Boolean), ['test-kit/eslint/base']);
  assert.deepEqual(config[1].languageOptions.globals, {});
  assert.equal(config[1].rules['no-undef'], 'off');
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: config });
  const [result] = await eslint.lintText('throw new Error("x");\n', { filePath: path.join(root, 'src/a.js') });
  assert.deepEqual(ids(result.messages), ['portadesign/no-top-level-throw']);
});

async function importEntry(block) {
  return run(process.execPath, [
    '--import', register, '--input-type=module', '-e',
    `const m = await import(${JSON.stringify(entryUrl)}); console.log(JSON.stringify({ blocks: m.default.length }));`,
  ], { cwd: root, env: { ...process.env, TEST_KIT_BLOCK: block.join(',') } });
}

test('importing the entry point loads no browser package (R13.46)', async () => {
  const browser = ['@playwright/test', 'playwright', 'playwright-core', 'axe-core', 'lighthouse'];
  const { stdout } = await importEntry(browser);
  assert.ok(JSON.parse(stdout).blocks > 3);
  // Control: the block works. A module that needs a blocked package fails to load.
  await assert.rejects(
    run(process.execPath, ['--import', register, '--input-type=module', '-e', 'await import("axe-core")'], {
      cwd: root, env: { ...process.env, TEST_KIT_BLOCK: 'axe-core' },
    }),
    /axe-core/,
  );
});

test('a missing required peer gives a clear error at import (R13.47)', async () => {
  await assert.rejects(importEntry(['@eslint/js']), (error) => {
    assert.match(error.stderr, /LintPeerError/);
    assert.match(error.stderr, /LINT_PEER_MISSING/);
    assert.match(error.stderr, /needs the package "@eslint\/js"/);
    assert.match(error.stderr, /Install it: npm i -D eslint @eslint\/js/);
    assert.doesNotMatch(error.stderr, /ERR_MODULE_NOT_FOUND/);
    return true;
  });
});

test('a missing enhancement prints one warning and the import succeeds (R13.47)', async () => {
  const { stdout, stderr } = await importEntry(['globals', 'typescript-eslint']);
  assert.ok(JSON.parse(stdout).blocks > 3);
  const warnings = stderr.split('\n').filter((line) => line.startsWith('[test-kit/eslint]'));
  assert.equal(warnings.length, 2);
});
