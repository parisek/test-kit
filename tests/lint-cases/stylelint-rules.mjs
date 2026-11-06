// Tests for the five portadesign Stylelint rules (R13.40, R13.50). Pure: no browser, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import stylelint from 'stylelint';

const require = createRequire(import.meta.url);
const plugins = require('../../src/stylelint/rules/index.cjs');

// Only the portadesign plugins. Each case turns on the one rule it tests.
async function lint(rule, setting, code, codeFilename = '/p/src/css/a.css') {
  const { results } = await stylelint.lint({
    code,
    codeFilename,
    config: { plugins, rules: { [rule]: setting } },
  });
  return results[0].warnings;
}

test('the plugin list keeps exactly the five rule names (R13.40)', () => {
  const names = plugins.map((p) => p.ruleName).sort();
  assert.deepEqual(names, [
    'portadesign/import-order',
    'portadesign/no-duplicate-import',
    'portadesign/no-length-division',
    'portadesign/no-undefined-tailwind-prose',
    'portadesign/prefer-utility-over-apply',
  ]);
  // The old project documentation link is gone (R13.50).
  for (const { ruleName, rule } of plugins) assert.equal(rule.meta?.url, undefined, ruleName);
});

test('no-duplicate-import', async () => {
  const rule = 'portadesign/no-duplicate-import';
  const dup = '@import "./a.css" layer(components);\n@import "./a.css";\n';
  const found = await lint(rule, true, dup);
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, rule);
  assert.equal(found[0].line, 2);
  assert.match(found[0].text, /first imported at line 1/);
  // Equivalent relative paths count as the same file.
  assert.equal((await lint(rule, true, '@import "./x/a.css";\n@import "./x/../x/a.css";\n')).length, 1);
  assert.deepEqual(await lint(rule, true, '@import "./a.css";\n@import "./b.css";\n'), []);
  assert.deepEqual(await lint(rule, false, dup), []);
});

test('no-undefined-tailwind-prose', async () => {
  const rule = 'portadesign/no-undefined-tailwind-prose';
  const found = await lint(rule, true, '.a { @apply prose prose-mega; }\n');
  assert.equal(found.length, 1);
  assert.match(found[0].text, /Unknown prose variant "prose-mega"/);
  assert.deepEqual(await lint(rule, true, '.a { @apply prose prose-base lg:prose-lg prose-invert; }\n'), []);
  // A same-file @utility declaration and the `allow` option both add names.
  assert.deepEqual(await lint(rule, true, '@utility prose-mega { color: red; }\n.a { @apply prose-mega; }\n'), []);
  assert.deepEqual(await lint(rule, [true, { allow: ['prose-mega'] }], '.a { @apply prose-mega; }\n'), []);
  // A bad option fails closed.
  const { results } = await stylelint.lint({
    code: '.a { color: red; }\n',
    config: { plugins, rules: { [rule]: [true, { allow: 'nope' }] } },
  });
  assert.match(results[0].invalidOptionWarnings[0].text, /Invalid value "nope" for option "allow"/);
});

test('prefer-utility-over-apply', async () => {
  const rule = 'portadesign/prefer-utility-over-apply';
  const found = await lint(rule, true, '.card { @apply p-4 rounded; }\n');
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, 'warning');
  assert.match(found[0].text, /@utility card/);
  for (const ok of [
    '.card { @apply p-4; color: red; }\n',
    '.card:hover { @apply p-4; }\n',
    '.wp-block { @apply p-4; }\n',
    '@media (min-width: 40rem) { .card { @apply p-4; } }\n',
    '.parent { .child { @apply p-4; } }\n',
    '@utility card { @apply p-4; }\n',
  ]) {
    assert.deepEqual(await lint(rule, true, ok), [], ok);
  }
});

test('import-order', async () => {
  const rule = 'portadesign/import-order';
  const ok = '@import "tailwindcss";\n@plugin "x";\n@config "y";\n@source "z";\n@import "./a.css";\n@theme { --a: 1; }\n@layer base { a { color: red; } }\n';
  assert.deepEqual(await lint(rule, true, ok), []);
  const found = await lint(rule, true, '@source "z";\n@config "y";\n');
  assert.equal(found.length, 1);
  assert.match(found[0].text, /slot 3: @config\) appears after .*slot 4: @source\)/);
  assert.deepEqual(await lint(rule, false, '@source "z";\n@config "y";\n'), []);
});

test('no-length-division', async () => {
  const rule = 'portadesign/no-length-division';
  const setting = [true, { severity: 'warning' }];
  const bad = [
    ':root { --a: calc(100vw / 100px); }\n',
    ':root { --a: calc(100% / 50%); }\n',
    ':root { --a: clamp(2rem, 2rem + 3rem * (100vw - 768px) / (1600px - 768px), 5rem); }\n',
    ':root { --a: calc(100vw / var(--span, 832px)); }\n',
    ':root { --bp-md: 768px; --bp-xl: 1600px; --a: calc(100vw / (var(--bp-xl) - var(--bp-md))); }\n',
    ':root { --bp: 768px; --alias: var(--bp); --a: calc(100vw / var(--alias)); }\n',
    '@media (width: calc(100vw / 10px)) { .a { color: red; } }\n',
    '@supports (width: calc(100vw / 10px)) { .a { color: red; } }\n',
  ];
  for (const code of bad) {
    const found = await lint(rule, setting, code);
    assert.equal(found.length, 1, code);
    assert.equal(found[0].severity, 'warning');
    assert.match(found[0].text, /Dividing by the length/);
  }
  const good = [
    ':root { --a: calc(100vw / 8); }\n',
    ':root { --span: 832; --a: clamp(2rem, 2rem + 36 * (100vw - 768px) / var(--span), 5rem); }\n',
    '.a { grid-area: 1 / 2 / 3 / 4; aspect-ratio: 16 / 9; font: 12px/1.5 serif; }\n',
    // A property declared in another file cannot be resolved. The rule leaves it alone.
    ':root { --a: calc(100vw / var(--elsewhere)); }\n',
  ];
  for (const code of good) assert.deepEqual(await lint(rule, setting, code), [], code);
});
