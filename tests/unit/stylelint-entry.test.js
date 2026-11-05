// Tests for the `@parisek/test-kit/stylelint` entry point (R13.40, R13.46 to R13.49).
// The package is "type": "module". The entry is a .cjs file, so both loaders must work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import stylelint from 'stylelint';
import viaImport from '@parisek/test-kit/stylelint';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../..');
const viaRequire = require('@parisek/test-kit/stylelint');
const { assertPeers, LintPeerError } = require('../../src/stylelint/peers.cjs');
const entryPath = path.join(root, 'src/stylelint/index.cjs');

async function lint(code, config = viaRequire) {
  const { results } = await stylelint.lint({ code, codeFilename: path.join(root, 'src/css/a.css'), config, configBasedir: root });
  return results[0].warnings.map((w) => w.rule);
}

test('require and import load the same config object (CommonJS and ESM, R13.48)', () => {
  assert.equal(viaImport, viaRequire);
  assert.equal(typeof viaRequire, 'object');
  assert.deepEqual(viaRequire.extends, ['stylelint-config-standard']);
  assert.equal(viaRequire.plugins.length, 5);
});

test('a CommonJS file and an ES module file load the entry in a child process', async () => {
  const cjs = await run(process.execPath, ['-e', `const c = require(${JSON.stringify(entryPath)}); console.log(Object.keys(c.rules).filter((r) => r.startsWith('portadesign/')).length)`], { cwd: root });
  assert.equal(cjs.stdout.trim(), '5');
  const esm = await run(process.execPath, ['--input-type=module', '-e', `import c from ${JSON.stringify(entryPath)}; console.log(c.plugins.length)`], { cwd: root });
  assert.equal(esm.stdout.trim(), '5');
});

test('the config enables the five portadesign rules at fixed levels', () => {
  const rules = Object.fromEntries(Object.entries(viaRequire.rules).filter(([id]) => id.startsWith('portadesign/')));
  assert.deepEqual(rules, {
    'portadesign/no-duplicate-import': true,
    'portadesign/no-undefined-tailwind-prose': true,
    'portadesign/prefer-utility-over-apply': true,
    'portadesign/import-order': true,
    'portadesign/no-length-division': [true, { severity: 'warning' }],
  });
});

test('the config holds no project value: only generic pseudo-classes and no ignore paths (R13.48)', async () => {
  assert.equal('ignoreFiles' in viaRequire, false);
  assert.deepEqual(viaRequire.rules['selector-pseudo-class-no-unknown'][1].ignorePseudoClasses, ['root', 'deep', 'global']);
  assert.deepEqual(await lint('a:is-scrolled { color: red; }\n'), ['selector-pseudo-class-no-unknown']);
});

test('the shared config lints Tailwind v4 CSS and reports a portadesign rule', async () => {
  const tailwind = [
    '@import "tailwindcss";',
    '@custom-variant dark (&:where(.dark, .dark *));',
    '@theme { --text-foo: 1rem; --text-foo--line-height: 1.5; }',
    '@utility tab-4 { tab-size: 4; }',
    '.btn:hover { color: red; }',
    '.card { @apply p-4; color: red; }',
    '',
  ].join('\n');
  assert.deepEqual(await lint(tailwind), []);
  assert.deepEqual(await lint('@source "z";\n@config "y";\n'), ['portadesign/import-order']);
  assert.deepEqual(await lint('.card { @apply p-4 rounded; }\n'), ['portadesign/prefer-utility-over-apply']);
});

test('a project config after the entry point overrides rules and adds values (R13.40)', async () => {
  const project = {
    ...viaRequire,
    ignoreFiles: ['src/legacy/**'],
    rules: {
      ...viaRequire.rules,
      'portadesign/prefer-utility-over-apply': null,
      'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['root', 'deep', 'global', 'is-scrolled'] }],
      'portadesign/no-length-division': [true, { severity: 'error' }],
    },
  };
  assert.deepEqual(await lint('.card { @apply p-4 rounded; }\n', project), []);
  assert.deepEqual(await lint('a:is-scrolled { color: red; }\n', project), []);
  const { results } = await stylelint.lint({
    code: ':root { --a: calc(100vw / 100px); }\n',
    codeFilename: path.join(root, 'src/css/a.css'),
    config: project,
    configBasedir: root,
  });
  assert.deepEqual(results[0].warnings.map((w) => [w.rule, w.severity]), [['portadesign/no-length-division', 'error']]);
  const { results: ignored } = await stylelint.lint({
    code: '.a { color: red\n',
    codeFilename: path.join(root, 'src/legacy/a.css'),
    config: project,
    configBasedir: root,
  });
  assert.equal(ignored[0].ignored, true);
});

test('a portadesign disable comment works (R13.49)', async () => {
  const dup = '@import "./a.css" layer(components);\n@import "./a.css";\n';
  assert.deepEqual(await lint(dup), ['portadesign/no-duplicate-import']);
  const disabled = '/* stylelint-disable portadesign/no-duplicate-import -- reason */\n' + dup;
  assert.deepEqual(await lint(disabled), []);
  const next = '@import "./a.css" layer(components);\n/* stylelint-disable-next-line portadesign/no-duplicate-import -- reason */\n@import "./a.css";\n';
  assert.deepEqual(await lint(next), []);
});

test('a missing required peer gives LINT_PEER_MISSING (R13.47)', async () => {
  assert.doesNotThrow(() => assertPeers());
  const missing = (name) => (request) => {
    if (request === name) {
      const error = new Error(`Cannot find module '${name}'`);
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }
    return request;
  };
  for (const name of ['stylelint', 'stylelint-config-standard']) {
    assert.throws(() => assertPeers(missing(name)), (error) => {
      assert.ok(error instanceof LintPeerError);
      assert.equal(error.code, 'LINT_PEER_MISSING');
      assert.equal(error.peer, name);
      assert.match(error.message, new RegExp(`"${name}".*npm i -D ${name}`));
      return true;
    });
  }
  // Any other resolution error is not a missing peer. It surfaces as it is.
  assert.throws(() => assertPeers(() => { throw new RangeError('x'); }), RangeError);

  // The real entry file, in a child process where Node cannot find `stylelint`.
  const script = [
    "const M = require('node:module'); const original = M._resolveFilename;",
    "M._resolveFilename = function (request, ...rest) { if (request === 'stylelint') { const e = new Error(\"Cannot find module 'stylelint'\"); e.code = 'MODULE_NOT_FOUND'; throw e; } return original.call(this, request, ...rest); };",
    `require(${JSON.stringify(entryPath)});`,
  ].join('\n');
  await assert.rejects(run(process.execPath, ['-e', script], { cwd: root }), (error) => {
    assert.match(error.stderr, /LINT_PEER_MISSING/);
    assert.match(error.stderr, /needs the package "stylelint"/);
    assert.match(error.stderr, /npm i -D stylelint/);
    return true;
  });
});

test('loading the entry point loads no browser package (R13.46)', async () => {
  const script = [
    `require(${JSON.stringify(entryPath)});`,
    'const hit = (k) => /[\\\\/]node_modules[\\\\/](@playwright|playwright|playwright-core|axe-core|lighthouse)[\\\\/]/.test(k);',
    'console.log(JSON.stringify({ loaded: Object.keys(require.cache).filter(hit) }));',
  ].join('\n');
  const { stdout } = await run(process.execPath, ['-e', script], { cwd: root });
  assert.deepEqual(JSON.parse(stdout).loaded, []);
  // Control: the probe sees a browser package when one is loaded.
  const control = await run(process.execPath, ['-e', script.replace(/^require\(.*\);$/m, "require('axe-core');")], { cwd: root });
  assert.ok(JSON.parse(control.stdout).loaded.length > 0);
});
