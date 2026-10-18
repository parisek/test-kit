import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveChecks, runChecks } from '../../src/packs/index.js';
import { lintPack, normalizeEslint, normalizeStylelint, judgeRun, relativeFile, MAX_FINDINGS } from '../../src/packs/lint/index.js';
import { runLint, validatePaths, findTool } from '../../src/packs/lint/runner.js';

const fixture = name => readFileSync(new URL(`../fixtures/lint/${name}`, import.meta.url), 'utf8');
const eslintText = fixture('eslint.json');
const stylelintText = fixture('stylelint.json');
const root = '/example-root';
const plan = () => resolveChecks({ available: [lintPack], packs: ['lint'] });
const artifact = tools => ({ root, tools });
const run = (value, context = {}) => runChecks(plan(), { artifact: 'lint', value }, context);

test('nothing runs unless the project selects the lint pack (R5.1)', () => {
  const result = runChecks(resolveChecks({ available: [lintPack] }), { artifact: 'lint', value: artifact({}) });
  assert.equal(result.state, 'missing');
  assert.deepEqual(result.findings, []);
});

test('ESLint JSON becomes findings with severity, rule and location (R9.11)', () => {
  const found = normalizeEslint(JSON.parse(eslintText), { root });
  assert.equal(found.length, 3);
  assert.deepEqual(found[0], { severity: 'error', message: 'Unexpected console statement.', evidence: { tool: 'eslint', rule: 'no-console', location: { file: 'src/app.js', line: 3, column: 5 } } });
  assert.equal(found[1].severity, 'warning');
  assert.equal(found[2].evidence.rule, null);
  assert.equal(found[2].severity, 'error');
});

test('Stylelint JSON becomes findings and drops the rule suffix from the text', () => {
  const found = normalizeStylelint(JSON.parse(stylelintText), { root });
  assert.equal(found.length, 2);
  assert.equal(found[0].message, 'Unexpected invalid hex color "#ggg"');
  assert.equal(found[0].severity, 'error');
  assert.equal(found[1].severity, 'warning');
  assert.deepEqual(found[1].evidence.location, { file: 'src/app.css', line: 8, column: 1 });
});

test('a path outside the root loses its host directory', () => {
  assert.equal(relativeFile('/other/place/a.js', root), 'a.js');
  assert.equal(relativeFile('/example-root/a/b.js', root), 'a/b.js');
  assert.equal(relativeFile('./a/b.css', root), 'a/b.css');
});

test('malformed tool output is rejected, never read as clean', () => {
  for (const bad of [{}, null, [null], [{ filePath: 'a.js' }], [{ filePath: 'a.js', messages: [{ message: 'x', severity: 3 }] }], [{ filePath: 'a.js', messages: [{ message: 5, severity: 1 }] }]]) assert.throws(() => normalizeEslint(bad, { root }));
  for (const bad of [{}, [{ source: 'a.css' }], [{ source: 'a.css', warnings: [{ text: 'x', severity: 'fatal' }] }], [{ source: 'a.css', warnings: [], invalidOptionWarnings: [{ text: 'bad' }] }]]) assert.throws(() => normalizeStylelint(bad, { root }));
});

test('a complete run with findings gives complete, findings, and no viewportId', () => {
  const result = run(artifact({
    eslint: { status: 'ok', version: '9.0.0', output: JSON.parse(eslintText) },
    stylelint: { status: 'ok', version: '16.0.0', output: JSON.parse(stylelintText) },
  }));
  assert.equal(result.state, 'complete');
  assert.equal(result.findings.length, 5);
  const first = result.findings[0];
  assert.equal(first.checkId, 'eslint-rules');
  assert.equal(first.artifact, 'lint');
  assert.equal(first.targetId, '@project');
  assert.equal(first.layer, 'package');
  assert.equal('viewportId' in first, false);
  assert.deepEqual(first.evidence.location, { file: 'src/app.js', line: 3, column: 5 });
});

test('a clean run is complete with no findings, and a target id is kept', () => {
  const result = run(artifact({ eslint: { status: 'ok', output: [] }, stylelint: { status: 'ok', output: [] } }), { targetId: 'example-card' });
  assert.equal(result.state, 'complete');
  assert.deepEqual(result.findings, []);
});

test('a tool that was not selected, or is missing, is missing and never complete (R8.7)', () => {
  const none = run(artifact({ eslint: { status: 'ok', output: [] } }));
  assert.equal(none.checks['stylelint-rules'].state, 'missing');
  assert.equal(none.state, 'missing');
  const gone = run(artifact({ eslint: { status: 'missing', diagnostic: 'eslint is not installed in the project.' }, stylelint: { status: 'ok', output: [] } }));
  assert.equal(gone.checks['eslint-rules'].state, 'missing');
  assert.equal(gone.checks['stylelint-rules'].state, 'complete');
  assert.equal(gone.state, 'missing');
});

test('a failed run or a malformed report is failed, never complete (R8.7)', () => {
  const failed = run(artifact({ eslint: { status: 'failed', diagnostic: 'eslint exited with code 2.' }, stylelint: { status: 'ok', output: { not: 'a list' } } }));
  assert.equal(failed.checks['eslint-rules'].state, 'failed');
  assert.match(failed.checks['eslint-rules'].diagnostic, /code 2/);
  assert.equal(failed.checks['stylelint-rules'].state, 'failed');
  assert.equal(failed.state, 'failed');
  assert.equal(run(undefined).state, 'missing');
});

test('a very long report is cut and the check reads missing, not complete', () => {
  const messages = Array.from({ length: MAX_FINDINGS + 5 }, (_, i) => ({ ruleId: 'no-console', severity: 1, message: 'm', line: i + 1, column: 1 }));
  const result = run(artifact({ eslint: { status: 'ok', output: [{ filePath: '/example-root/a.js', messages }] } }));
  assert.equal(result.findings.filter(item => item.checkId === 'eslint-rules').length, MAX_FINDINGS);
  assert.equal(result.checks['eslint-rules'].state, 'missing');
});

test('exit code 1 with findings is a normal ESLint run; a crash is not', () => {
  assert.equal(judgeRun({ tool: 'eslint', exitCode: 1, text: eslintText }).status, 'ok');
  assert.equal(judgeRun({ tool: 'eslint', exitCode: 0, text: '[]' }).status, 'ok');
  assert.equal(judgeRun({ tool: 'stylelint', exitCode: 2, text: stylelintText }).status, 'ok');
  assert.equal(judgeRun({ tool: 'stylelint', exitCode: 0, text: '[]' }).status, 'ok');
  for (const bad of [
    { tool: 'eslint', exitCode: 2, text: eslintText },
    { tool: 'eslint', exitCode: 1, text: 'Oops' },
    { tool: 'eslint', exitCode: 1, text: '{}' },
    { tool: 'eslint', exitCode: 1, text: '[]' },
    { tool: 'eslint', exitCode: 0, text: eslintText },
    { tool: 'eslint', exitCode: null, signal: 'SIGTERM', text: eslintText },
    { tool: 'stylelint', exitCode: 78, text: '[]' },
    { tool: 'stylelint', exitCode: 1, text: stylelintText },
    { tool: 'stylelint', exitCode: 2, text: '' },
  ]) assert.equal(judgeRun(bad).status, 'failed', JSON.stringify(bad).slice(0, 80));
});

test('lint paths must be plain relative paths', () => {
  assert.deepEqual(validatePaths(['src', 'assets/**/*.css']), ['src', 'assets/**/*.css']);
  for (const bad of [[], 'src', ['--fix'], ['/etc'], ['../x'], ['a b'], ['a;b'], [''], [5]]) assert.throws(() => validatePaths(bad));
});

// The runner starts the project's own tool. These tests use a fake tool package, not ESLint.
function fakeProject(tools) {
  const dir = mkdtempSync(path.join(tmpdir(), 'test-kit-lint-test-'));
  for (const [name, { exit, body, version = '1.2.3' }] of Object.entries(tools)) {
    const pkg = path.join(dir, 'node_modules', name);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name, version, bin: { [name]: 'bin.js' } }));
    writeFileSync(path.join(pkg, 'bin.js'), `const a = process.argv; const o = a[a.indexOf('-o') + 1]; require('node:fs').writeFileSync(o, ${JSON.stringify(body)}); process.exit(${exit});`);
  }
  return dir;
}

test('the runner reads the project tool, treats exit 1 with findings as a run, and reports crashes', async t => {
  const dir = fakeProject({ eslint: { exit: 1, body: eslintText }, stylelint: { exit: 78, body: '' } });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(findTool(dir, 'eslint').version, '1.2.3');
  const value = await runLint({ root: dir, tools: { eslint: { paths: ['src'] }, stylelint: { paths: ['src'] } } });
  assert.equal(value.tools.eslint.status, 'ok');
  assert.equal(value.tools.eslint.version, '1.2.3');
  assert.equal(value.tools.stylelint.status, 'failed');
  const result = run(value);
  assert.equal(result.checks['eslint-rules'].state, 'complete');
  assert.equal(result.findings.length, 3);
  assert.equal(result.state, 'failed');
});

test('the runner reports a tool that the project does not install as missing', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'test-kit-lint-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const value = await runLint({ root: dir, tools: { eslint: { paths: ['src'] } } });
  assert.equal(value.tools.eslint.status, 'missing');
  await assert.rejects(() => runLint({ root: dir, tools: {} }));
  await assert.rejects(() => runLint({ root: dir, tools: { prettier: { paths: ['src'] } } }));
});
