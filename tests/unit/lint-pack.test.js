import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveChecks, runChecks } from '../../src/packs/index.js';
import { lintPack, checkRelativeFile, copyFileTargets, scrubRoots, normalizeEslint, normalizeStylelint, judgeRun, relativeFile, MAX_FINDINGS, MAX_ITEMS } from '../../src/packs/lint/index.js';
import { runLint, validatePaths, findTool, childEnv, sweepGroup } from '../../src/packs/lint/runner.js';

const fixture = name => readFileSync(new URL(`../fixtures/lint/${name}`, import.meta.url), 'utf8');
const eslintText = fixture('eslint.json');
const stylelintText = fixture('stylelint.json');
const root = '/example-root';
const plan = () => resolveChecks({ available: [lintPack], packs: ['lint'] });
const run = (value, context = {}) => runChecks(plan(), { artifact: 'lint', value }, context);
const stored = (tool, text) => ({ status: 'ok', version: '1.0.0', ...(tool === 'eslint' ? normalizeEslint(JSON.parse(text), { root }) : normalizeStylelint(JSON.parse(text), { root })) });
const clean = { status: 'ok', items: [], total: 0 };
const tmp = () => mkdtempSync(path.join(tmpdir(), 'test-kit-lint-test-'));

test('nothing runs unless the project selects the lint pack (R5.1)', () => {
  const result = runChecks(resolveChecks({ available: [lintPack] }), { artifact: 'lint', value: { tools: {} } });
  assert.equal(result.state, 'missing');
  assert.deepEqual(result.findings, []);
});

test('ESLint JSON becomes items with severity, rule and location (R9.11)', () => {
  const { items, total } = normalizeEslint(JSON.parse(eslintText), { root });
  assert.equal(total, 3);
  assert.deepEqual(items[0], { severity: 'error', rule: 'no-console', message: 'Unexpected console statement.', location: { file: 'src/app.js', line: 3, column: 5 } });
  assert.equal(items[1].severity, 'warning');
  assert.equal(items[2].rule, null);
});

test('real ESLint 9.39.5 and Stylelint 16.26.1 output parse', () => {
  const e = normalizeEslint(JSON.parse(fixture('eslint-real.json')), { root });
  assert.deepEqual(e.items.map(item => item.rule), ['no-console', 'eqeqeq']);
  const s = normalizeStylelint(JSON.parse(fixture('stylelint-real.json')), { root });
  assert.deepEqual(s.items.map(item => item.rule), ['block-no-empty', 'color-no-invalid-hex']);
  assert.equal(s.items[1].message, 'Unexpected invalid hex color "#ggg"');
});

test('Stylelint JSON drops the rule suffix from the text', () => {
  const { items } = normalizeStylelint(JSON.parse(stylelintText), { root });
  assert.equal(items[0].message, 'Unexpected invalid hex color "#ggg"');
  assert.deepEqual(items[1].location, { file: 'src/app.css', line: 8, column: 1 });
});

test('a finding keeps location at the top level and only there (R9.11)', () => {
  const result = run({ tools: { eslint: stored('eslint', eslintText), stylelint: clean } });
  const first = result.findings[0];
  assert.deepEqual(first.location, { file: 'src/app.js', line: 3, column: 5 });
  assert.deepEqual(first.evidence, { tool: 'eslint', rule: 'no-console' });
  assert.equal('viewportId' in first, false);
  assert.equal(first.checkId, 'eslint-rules');
});

test('the pack API validates a location and a finding with a bad one is failed', () => {
  const bad = location => resolveChecks({ custom: [{ layer: 'project', check: { id: 'loc', title: 'loc', basis: 'absolute', applies: { artifacts: ['lint'] }, check: () => [{ targetId: 't', severity: 'info', message: 'm', evidence: {}, location }] } }] });
  const state = location => runChecks(bad(location), { artifact: 'lint', value: {} }).checks.loc.state;
  assert.equal(state({ file: 'a.js', line: 1, column: 2 }), 'complete');
  assert.equal(state({ selector: '.example-site-button' }), 'complete');
  for (const location of [{ file: 'a.js', selector: '.x' }, { file: 'a.js', line: 0 }, { file: 'a.js', column: 3 }, { file: '' }, { file: 'a.js', extra: 1 }, 'a.js', { selector: 'x'.repeat(501) }, {}]) assert.equal(state(location), 'failed', JSON.stringify(location));
});

test('a file that maps to a component uses its id; others use @project (R9.11)', () => {
  const result = run({ fileTargets: { 'src/app.js': 'example-card' }, tools: { eslint: { status: 'ok', items: [
    { severity: 'error', rule: 'a', message: 'm', location: { file: 'src/app.js', line: 1 } },
    { severity: 'error', rule: 'a', message: 'm', location: { file: 'src/other.js', line: 1 } },
  ], total: 2 }, stylelint: clean } });
  assert.deepEqual(result.findings.map(f => f.targetId), ['example-card', '@project']);
  for (const fileTargets of [{ 'a.js': 'bad id' }, { 'a.js': 5 }, [], 'x']) assert.equal(run({ fileTargets, tools: { eslint: clean, stylelint: clean } }).state, 'failed');
});

test('a path never carries a host directory or traversal', () => {
  const out = (file, roots = root) => relativeFile(file, roots);
  for (const [input, expected] of [['/other/place/a.js', '<outside>/a.js'], ['/example-root/../private/x.js', '<outside>/x.js'], ['/example-root/a/../../etc/x.js', '<outside>/x.js'],
    ['../private/x.js', '<outside>/x.js'], ['file:///other/dir/y.js', '<outside>/y.js'], ['C:\\other\\z.js', '<outside>/z.js'], ['file://evil.example/example-root/src/a.js', '<outside>/a.js']]) {
    assert.deepEqual(out(input), { file: expected, inRoot: false }, input);
  }
  for (const [input, expected] of [['/example-root/a/b.js', 'a/b.js'], ['./a/b.css', 'a/b.css'], ['file:///example-root/src/y.js', 'src/y.js'], ['file://localhost/example-root/src/y.js', 'src/y.js'],
    ['file:///example-root/dir%20x/y.js', 'dir x/y.js'], ['a:b.js', 'a:b.js']]) assert.deepEqual(out(input), { file: expected, inRoot: true }, input);
  assert.deepEqual(out('/real/root/a.js', ['/example-root', '/real/root']), { file: 'a.js', inRoot: true });
  assert.deepEqual(out('/real/root/sub/a.js', ['/example-root', '/real/root']), { file: 'sub/a.js', inRoot: true });
  for (const bad of ['..', '/', '../..', 'file://%E0%A4%A', 'file:///%E0%A4%A']) { const r = out(bad); assert.equal(r.inRoot, false, bad); assert.doesNotMatch(r.file, /\.\.|^\//); }
  assert.equal(out('C:\\Proj\\src\\a.js', 'c:\\proj').file, 'src/a.js'); // Windows-style roots ignore case
});

test('malformed tool output is rejected, never read as clean', () => {
  for (const bad of [{}, null, [null], [{ filePath: 'a.js' }], [{ filePath: 'a.js', messages: [{ message: 'x', severity: 3 }] }], [{ filePath: 'a.js', messages: [{ message: 5, severity: 1 }] }]]) assert.throws(() => normalizeEslint(bad, { root }));
  for (const bad of [{}, [{ source: 'a.css' }], [{ source: 'a.css', warnings: [{ text: 'x', severity: 'fatal' }] }], [{ source: 'a.css', warnings: [], invalidOptionWarnings: [{ text: 'bad' }] }]]) assert.throws(() => normalizeStylelint(bad, { root }));
});

test('a stored report that is malformed is failed (R8.7)', () => {
  const item = { severity: 'error', rule: null, message: 'm', location: { file: 'a.js' } };
  for (const entry of [{ status: 'ok', items: 'x', total: 0 }, { status: 'ok', items: [item], total: 0 }, { status: 'ok', items: [{ ...item, severity: 'fatal' }], total: 1 },
    { status: 'ok', items: [{ ...item, extra: 1 }], total: 1 }, { status: 'ok', items: [{ ...item, location: { file: '' } }], total: 1 }, { status: 'weird' }, { status: 'failed', diagnostic: 'eslint exited with code 2.' }]) {
    assert.equal(run({ tools: { eslint: entry, stylelint: clean } }).checks['eslint-rules'].state, 'failed', JSON.stringify(entry));
  }
});

test('a clean run is complete with no findings', () => {
  const result = run({ tools: { eslint: clean, stylelint: clean } });
  assert.equal(result.state, 'complete');
  assert.deepEqual(result.findings, []);
});

test('a tool that was not selected, or is missing, is missing and never complete (R8.7)', () => {
  const none = run({ tools: { eslint: clean } });
  assert.equal(none.checks['stylelint-rules'].state, 'missing');
  assert.equal(none.state, 'missing');
  const gone = run({ tools: { eslint: { status: 'missing', diagnostic: 'eslint is not installed in the project.' }, stylelint: clean } });
  assert.equal(gone.checks['eslint-rules'].state, 'missing');
  assert.equal(gone.state, 'missing');
  assert.equal(run(undefined).state, 'missing');
});

test('a very long report is cut and the check reads missing, not complete', () => {
  const messages = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => ({ ruleId: 'no-console', severity: 1, message: 'm', line: i + 1, column: 1 }));
  const entry = { status: 'ok', ...normalizeEslint([{ filePath: '/example-root/a.js', messages }], { root }) };
  assert.equal(entry.items.length, MAX_ITEMS);
  const result = run({ tools: { eslint: entry, stylelint: clean } });
  assert.equal(result.findings.filter(item => item.checkId === 'eslint-rules').length, MAX_FINDINGS);
  assert.equal(result.checks['eslint-rules'].state, 'missing');
});

test('exit code 1 with findings is a normal ESLint run; a crash is not', () => {
  assert.equal(judgeRun({ tool: 'eslint', exitCode: 1, text: eslintText }).status, 'ok');
  assert.equal(judgeRun({ tool: 'eslint', exitCode: 0, text: '[]' }).status, 'ok');
  assert.equal(judgeRun({ tool: 'stylelint', exitCode: 2, text: stylelintText }).status, 'ok');
  assert.equal(judgeRun({ tool: 'stylelint', exitCode: 0, text: '[]' }).status, 'ok');
  for (const bad of [
    { tool: 'eslint', exitCode: 2, text: eslintText }, { tool: 'eslint', exitCode: 1, text: 'Oops' }, { tool: 'eslint', exitCode: 1, text: '{}' },
    { tool: 'eslint', exitCode: 1, text: '[]' }, { tool: 'eslint', exitCode: 0, text: eslintText }, { tool: 'eslint', exitCode: null, signal: 'SIGTERM', text: eslintText },
    { tool: 'eslint', exitCode: 1, text: null }, { tool: 'eslint', exitCode: 1, text: 'x'.repeat(33 * 1024 * 1024) },
    { tool: 'stylelint', exitCode: 78, text: '[]' }, { tool: 'stylelint', exitCode: 1, text: stylelintText }, { tool: 'stylelint', exitCode: 2, text: '' },
  ]) assert.equal(judgeRun(bad).status, 'failed', JSON.stringify(bad).slice(0, 80));
});

test('Stylelint exit 2 with an invalid option names the configuration problem; exit 1 means no files', () => {
  const bad = judgeRun({ tool: 'stylelint', exitCode: 2, text: fixture('stylelint-invalid-option.json') });
  assert.equal(bad.status, 'failed');
  assert.match(bad.diagnostic, /invalid option.*configuration problem/);
  assert.match(judgeRun({ tool: 'stylelint', exitCode: 1, text: '' }).diagnostic, /no matching file/);
  assert.match(judgeRun({ tool: 'eslint', exitCode: 2, text: '' }).diagnostic, /no matching file/);
});

test('lint paths must be plain relative paths, with no brace list', () => {
  assert.deepEqual(validatePaths(['src', 'assets/**/*.css']), ['src', 'assets/**/*.css']);
  for (const bad of [[], 'src', ['--fix'], ['/etc'], ['../x'], ['a b'], ['a;b'], [''], [5], ['{/etc,x}/hosts'], ['{..,x}/a'], ['a,b'], ['a}'], ['a[b]'], ['a/../../b']]) assert.throws(() => validatePaths(bad), /Invalid lint path|needs 1 to 100/);
});

test('the child gets a reduced environment', () => {
  const env = childEnv({ EXTRA: '1' }, { PATH: '/bin', HOME: '/h', SECRET_TOKEN: 's', NODE_ENV: 'x', NODE_OPTIONS: '--require x', NODE_PATH: '/p', NODE_AUTH_TOKEN: 't', NODE_EXTRA_CA_CERTS: '/c', AWS_KEY: 'k' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', EXTRA: '1' });
  assert.deepEqual(childEnv({ NODE_OPTIONS: '--no-warnings' }, {}), { NODE_OPTIONS: '--no-warnings' });
  assert.throws(() => childEnv({ 'bad name': '1' }, {}));
  assert.throws(() => childEnv({ A: 1 }, {}));
});

// The runner starts the project's own tool. These tests use a fake tool package, not ESLint.
function fakeProject(tools, dir = tmp()) {
  for (const [name, { exit = 0, body = '[]', version = '1.2.3', script }] of Object.entries(tools)) {
    const pkg = path.join(dir, 'node_modules', name);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name, version, bin: { [name]: 'bin.js' } }));
    writeFileSync(path.join(pkg, 'bin.js'), script ?? `const a = process.argv; const o = a[a.indexOf('-o') + 1]; require('node:fs').writeFileSync(o, ${JSON.stringify(body)}); process.exit(${exit});`);
  }
  return dir;
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const lintTmpDirs = () => readdirSync(tmpdir()).filter(name => name.startsWith('test-kit-lint-')).length;

test('the runner reads the project tool, treats exit 1 with findings as a run, stores only relative data', async t => {
  const dir = fakeProject({ eslint: { exit: 1, body: eslintText.replaceAll('/example-root/', '') }, stylelint: { exit: 78, body: '' } });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(findTool(dir, 'eslint').version, '1.2.3');
  const value = await runLint({ root: dir, tools: { eslint: { paths: ['src'] }, stylelint: { paths: ['src'] } }, fileTargets: { 'src/app.js': 'example-card' } });
  assert.equal(value.tools.eslint.status, 'ok');
  assert.equal(value.tools.stylelint.status, 'failed');
  assert.equal('output' in value.tools.eslint, false);
  assert.equal('root' in value, false);
  assert.doesNotMatch(JSON.stringify(value), /example-root|\/private|\/tmp|\/var/);
  const result = run(value);
  assert.equal(result.checks['eslint-rules'].state, 'complete');
  assert.equal(result.findings.length, 3);
  assert.equal(result.findings[0].targetId, 'src/app.js' in value.fileTargets ? 'example-card' : '@project');
  assert.equal(result.state, 'failed');
});

test('a symlinked root still gives relative file names', async t => {
  const real = tmp();
  const holder = tmp();
  const link = path.join(holder, 'link');
  symlinkSync(real, link);
  t.after(() => { rmSync(real, { recursive: true, force: true }); rmSync(holder, { recursive: true, force: true }); });
  const body = JSON.stringify([{ filePath: path.join(realpathSync(real), 'src', 'a.js'), messages: [{ ruleId: 'x', severity: 2, message: 'm', line: 1, column: 1 }] }]);
  fakeProject({ eslint: { exit: 1, body } }, real);
  const value = await runLint({ root: link, tools: { eslint: { paths: ['src'] } } });
  assert.equal(value.tools.eslint.items[0].location.file, 'src/a.js');
});

test('the runner reports a tool that the project does not install as missing, and bad paths first', async t => {
  const dir = tmp();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal((await runLint({ root: dir, tools: { eslint: { paths: ['src'] } } })).tools.eslint.status, 'missing');
  await assert.rejects(() => runLint({ root: dir, tools: { eslint: { paths: ['{/etc,x}/hosts'] } } }), /Invalid lint path/);
  await assert.rejects(() => runLint({ root: dir, tools: {} }));
  await assert.rejects(() => runLint({ root: dir, tools: { prettier: { paths: ['src'] } } }));
});

test('the runner stops at the project root unless hoisted is set', async t => {
  const outer = fakeProject({ eslint: { exit: 0, body: '[]' } });
  const inner = path.join(outer, 'packages', 'site');
  mkdirSync(inner, { recursive: true });
  t.after(() => rmSync(outer, { recursive: true, force: true }));
  assert.equal(findTool(inner, 'eslint'), null);
  assert.ok(findTool(inner, 'eslint', { hoisted: true }));
  assert.equal((await runLint({ root: inner, tools: { eslint: { paths: ['src'] } } })).tools.eslint.status, 'missing');
  assert.equal((await runLint({ root: inner, hoisted: true, tools: { eslint: { paths: ['src'] } } })).tools.eslint.status, 'ok');
});

test('the child sees a reduced environment and an opt-in env option', async t => {
  process.env.TEST_KIT_SECRET = 'leak';
  t.after(() => { delete process.env.TEST_KIT_SECRET; });
  const script = `const a = process.argv; const o = a[a.indexOf('-o') + 1]; const e = process.env;
require('node:fs').writeFileSync(o, JSON.stringify([{ filePath: 'a.js', messages: [{ ruleId: 'env', severity: 2, message: 's=' + e.TEST_KIT_SECRET + ' x=' + e.TEST_KIT_EXTRA, line: 1, column: 1 }] }])); process.exit(1);`;
  const dir = fakeProject({ eslint: { script } });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const value = await runLint({ root: dir, env: { TEST_KIT_EXTRA: 'yes' }, tools: { eslint: { paths: ['src'] } } });
  assert.equal(value.tools.eslint.items[0].message, 's=undefined x=yes');
});

test('a tool that ignores SIGTERM is killed, the run fails, and the temp dir is removed', async t => {
  const dir = fakeProject({ eslint: { script: "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);" } });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const before = lintTmpDirs();
  const started = Date.now();
  const value = await runLint({ root: dir, tools: { eslint: { paths: ['src'] } }, timeoutMs: 300, killGraceMs: 200 });
  assert.equal(value.tools.eslint.status, 'failed');
  assert.match(value.tools.eslint.diagnostic, /TIMEOUT/);
  assert.ok(Date.now() - started < 5000);
  assert.equal(lintTmpDirs(), before);
});

test('a timeout kills a grandchild in the process group', { skip: process.platform === 'win32' }, async t => {
  const dir = tmp();
  const pidFile = path.join(dir, 'grandchild.pid');
  const child = path.join(dir, 'grandchild.js');
  writeFileSync(child, `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`);
  fakeProject({ eslint: { script: `require('node:child_process').spawn(process.execPath, [${JSON.stringify(child)}], { stdio: 'ignore' }); setInterval(() => {}, 1000);` } }, dir);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const value = await runLint({ root: dir, tools: { eslint: { paths: ['src'] } }, timeoutMs: 800, killGraceMs: 200 });
  assert.equal(value.tools.eslint.status, 'failed');
  assert.ok(existsSync(pidFile));
  const pid = Number(readFileSync(pidFile, 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(alive(pid), false);
});

test('an output file over the size cap is failed', async t => {
  const dir = fakeProject({ eslint: { script: "const a = process.argv; const o = a[a.indexOf('-o') + 1]; const fs = require('node:fs'); const fd = fs.openSync(o, 'w'); fs.ftruncateSync(fd, 33 * 1024 * 1024); process.exit(1);" } });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const value = await runLint({ root: dir, tools: { eslint: { paths: ['src'] } } });
  assert.equal(value.tools.eslint.status, 'failed');
  assert.match(value.tools.eslint.diagnostic, /no usable report/);
});

const GRANDCHILD = pidFile => `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
const waitFor = async (file, ms = 5000) => { const end = Date.now() + ms; while (!existsSync(file) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 20)); };
const spawnGrandchild = (child, pidFile) => `const fs = require('node:fs'); require('node:child_process').spawn(process.execPath, [${JSON.stringify(child)}], { stdio: 'ignore' });
while (!fs.existsSync(${JSON.stringify(pidFile)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);`;

test('a SIGTERM-ignoring grandchild dies when the leader exits on SIGTERM', { skip: process.platform === 'win32' }, async t => {
  const dir = tmp();
  const pidFile = path.join(dir, 'g.pid');
  const child = path.join(dir, 'g.js');
  writeFileSync(child, GRANDCHILD(pidFile));
  fakeProject({ eslint: { script: `${spawnGrandchild(child, pidFile)}\nsetInterval(() => {}, 1000);` } }, dir);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const value = await runLint({ root: dir, tools: { eslint: { paths: ['src'] } }, timeoutMs: 1000, killGraceMs: 200 });
  assert.equal(value.tools.eslint.status, 'failed');
  const pid = Number(readFileSync(pidFile, 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(alive(pid), false);
});

test('a SIGTERM-ignoring grandchild dies when the tool exits 0 and leaves it behind', { skip: process.platform === 'win32' }, async t => {
  const dir = tmp();
  const pidFile = path.join(dir, 'g.pid');
  const child = path.join(dir, 'g.js');
  writeFileSync(child, GRANDCHILD(pidFile));
  const write = "const a = process.argv; require('node:fs').writeFileSync(a[a.indexOf('-o') + 1], '[]'); process.exit(0);";
  fakeProject({ eslint: { script: `${spawnGrandchild(child, pidFile)}\n${write}` } }, dir);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const value = await runLint({ root: dir, tools: { eslint: { paths: ['src'] } } });
  assert.equal(value.tools.eslint.status, 'ok');
  const pid = Number(readFileSync(pidFile, 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(alive(pid), false);
});

test('fileTargets: container, keys and ids are validated, and __proto__ is refused', () => {
  assert.deepEqual(copyFileTargets({ 'src/a.js': 'example-card' }), { 'src/a.js': 'example-card' });
  assert.deepEqual(copyFileTargets(undefined), {});
  for (const bad of [null, 'x', [], 5, { '../a.js': 'x' }, { '/a.js': 'x' }, { 'file:///a.js': 'x' }, { 'a/../b.js': 'x' }, { './a.js': 'x' }, { 'a\\b.js': 'x' }, { 'C:/a.js': 'x' }, { '': 'x' }, JSON.parse('{"__proto__":"example-card"}'), Object.create({ inherited: 1 })]) assert.throws(() => copyFileTargets(bad), /fileTargets|file name/, JSON.stringify(bad));
  assert.equal(run({ fileTargets: JSON.parse('{"__proto__":"example-card"}'), tools: { eslint: clean, stylelint: clean } }).state, 'failed');
});

test('a stored artifact with a traversal or absolute file never gives a complete finding', () => {
  for (const file of ['../private/x.js', '/etc/passwd', 'file:///etc/passwd', 'a/../../b.js', 'C:/x.js', 'a\\b.js']) {
    const entry = { status: 'ok', total: 1, items: [{ severity: 'error', rule: 'r', message: 'm', location: { file } }] };
    const result = run({ tools: { eslint: entry, stylelint: clean } });
    assert.equal(result.checks['eslint-rules'].state, 'failed', file);
    assert.deepEqual(result.findings, []);
  }
  assert.equal(run({ fileTargets: { '../x.js': 'example-card' }, tools: { eslint: clean, stylelint: clean } }).state, 'failed');
});

test('the root is scrubbed from message text', () => {
  assert.equal(scrubRoots('Cannot read /example-root/src/a.js and /real/root', ['/example-root', '/real/root']), 'Cannot read src/a.js and .');
  assert.equal(scrubRoots('see file:///example-root/x.css', root), 'see x.css');
  assert.equal(scrubRoots('C:\\proj\\src\\a.js', 'C:\\proj'), 'src\\a.js');
  const { items } = normalizeEslint([{ filePath: '/example-root/a.js', messages: [{ ruleId: 'plugin/x', severity: 2, message: 'Failed in /example-root/lib/rule.js', line: 1, column: 1 }] }], { root });
  assert.equal(items[0].message, 'Failed in lib/rule.js');
});

test('sweepGroup skips an empty group and kills a live one', () => {
  const calls = [];
  const gone = (pid, signal) => { calls.push([pid, signal]); const error = new Error('no such process'); error.code = 'ESRCH'; throw error; };
  assert.equal(sweepGroup(4242, gone), 'skipped');
  assert.deepEqual(calls, [[-4242, 0]]); // only the probe ran, no SIGKILL
  const live = [];
  assert.equal(sweepGroup(4242, (pid, signal) => { live.push([pid, signal]); }), 'killed');
  assert.deepEqual(live, [[-4242, 0], [-4242, 'SIGKILL']]);
  const denied = () => { const error = new Error('not permitted'); error.code = 'EPERM'; throw error; };
  assert.equal(sweepGroup(4242, denied), 'skipped');
  for (const pid of [0, 1, -5, 1.5, undefined]) assert.equal(sweepGroup(pid, () => assert.fail('must not signal')), 'skipped');
});

test('a root is scrubbed only at a path boundary', () => {
  assert.equal(scrubRoots('Error in /srv/example-root2/private.js', '/srv/example-root'), 'Error in /srv/example-root2/private.js');
  assert.equal(scrubRoots('/srv/example-root/a.js and /srv/example-root2/b.js', '/srv/example-root'), 'a.js and /srv/example-root2/b.js');
  assert.equal(scrubRoots('at (/srv/example-root) and "/srv/example-root": bad', '/srv/example-root'), 'at (.) and ".": bad');
  assert.equal(scrubRoots('/srv/example-root', '/srv/example-root'), '.');
  assert.equal(scrubRoots('x/other/srv/example-root/a.js', '/srv/example-root'), 'x/other/srv/example-root/a.js');
});

test('a filesystem root is never scrubbed and runLint refuses it', async () => {
  assert.equal(scrubRoots('/etc/passwd and C:\\x', ['/', 'C:\\', 'C:/', '']), '/etc/passwd and C:\\x');
  const root0 = path.parse(process.cwd()).root;
  const value = await runLint({ root: root0, tools: { eslint: { paths: ['src'] }, stylelint: { paths: ['src'] } } });
  assert.equal(value.tools.eslint.status, 'failed');
  assert.match(value.tools.stylelint.diagnostic, /filesystem root/);
  assert.equal(run(value).state, 'failed');
});

test('fileTargets refuses a symbol key and a non-enumerable key', () => {
  const symbolic = { 'src/a.js': 'example-card', [Symbol('x')]: 'example-card' };
  assert.throws(() => copyFileTargets(symbolic), /plain string keys/);
  const hidden = { 'src/a.js': 'example-card' };
  Object.defineProperty(hidden, 'src/b.js', { value: 'example-card', enumerable: false });
  assert.throws(() => copyFileTargets(hidden), /plain string keys/);
  assert.equal(run({ fileTargets: symbolic, tools: { eslint: clean, stylelint: clean } }).state, 'failed');
});

test('a file name with a trailing slash, control or bidi character is refused or reduced', () => {
  for (const bad of ['src/', 'src/a\n.js', 'a\r.js', 'a\u0000.js', 'a\u202e.js', 'a\u2066b.js', 'a\u200f.js', 'a\u007f.js']) {
    assert.throws(() => checkRelativeFile(bad), /file name/, JSON.stringify(bad));
    assert.throws(() => copyFileTargets({ [bad]: 'example-card' }), /file name/);
    const entry = { status: 'ok', total: 1, items: [{ severity: 'error', rule: 'r', message: 'm', location: { file: bad } }] };
    assert.equal(run({ tools: { eslint: entry, stylelint: clean } }).checks['eslint-rules'].state, 'failed');
  }
  assert.deepEqual(relativeFile('/example-root/src/a\u202e.js', root), { file: '<outside>/unknown', inRoot: false });
  assert.deepEqual(relativeFile('/example-root/dir\n/a.js', root), { file: '<outside>/a.js', inRoot: false });
  assert.equal(relativeFile('/example-root/src/', root).file, 'src');
  assert.equal(checkRelativeFile('src/ok.js'), 'src/ok.js');
});

test('a root is scrubbed before punctuation and left alone before a name character', () => {
  const r = '/srv/example-root';
  const cases = [
    [`see ${r}.`, 'see ..'], [`${r}: bad`, '.: bad'], [`"${r}"`, '"."'], [`${r}/a.js`, 'a.js'], [`${r}\\a.js`, 'a.js'],
    [`(${r})`, '(.)'], [`${r}, next`, '., next'],
    [`${r}-old/a.js`, `${r}-old/a.js`], [`${r}_x/a.js`, `${r}_x/a.js`], [`${r}2/a.js`, `${r}2/a.js`],
    [`${r}.eslintrc.json`, `${r}.eslintrc.json`], [`${r}.old/a.js`, `${r}.old/a.js`],
  ];
  for (const [input, expected] of cases) assert.equal(scrubRoots(input, r), expected, input);
});

test('an outside file never maps to a component, even when its base name is a mapped key (R9.11)', () => {
  const value = { fileTargets: { 'a.js': 'example-card' }, tools: { stylelint: clean, eslint: { status: 'ok', ...normalizeEslint([
    { filePath: '/example-root/a.js', messages: [{ ruleId: 'r', severity: 2, message: 'in root', line: 1, column: 1 }] },
    { filePath: '/outside/a.js', messages: [{ ruleId: 'r', severity: 2, message: 'outside', line: 1, column: 1 }] },
    { filePath: 'file://evil.example/a.js', messages: [{ ruleId: 'r', severity: 2, message: 'remote', line: 1, column: 1 }] },
  ], { root }) } } };
  const result = run(value);
  assert.deepEqual(result.findings.map(f => [f.message, f.targetId, f.location.file]), [['in root', 'example-card', 'a.js'], ['outside', '@project', '<outside>/a.js'], ['remote', '@project', '<outside>/a.js']]);
  // A real in-root file in a directory named `<outside>` is an ordinary name: no flag, so it maps by name.
  const real = { status: 'ok', total: 1, items: [{ severity: 'error', rule: 'r', message: 'm', location: { file: '<outside>/a.js' } }] };
  assert.equal(run({ fileTargets: { '<outside>/a.js': 'example-card' }, tools: { eslint: real, stylelint: clean } }).findings[0].targetId, 'example-card');
  assert.equal(relativeFile('/example-root/<outside>/a.js', root).inRoot, true);
  const marked = { ...real, items: [{ ...real.items[0], outside: true }] };
  assert.equal(run({ fileTargets: { '<outside>/a.js': 'example-card' }, tools: { eslint: marked, stylelint: clean } }).findings[0].targetId, '@project');
  assert.equal(run({ tools: { eslint: { ...real, items: [{ ...real.items[0], outside: 'yes' }] }, stylelint: clean } }).checks['eslint-rules'].state, 'failed');
});

test('a legal name with a colon is kept; a drive path and a URL are not names', () => {
  assert.equal(checkRelativeFile('a:b.js'), 'a:b.js');
  assert.equal(relativeFile('/example-root/dir/a:b.js', root).file, 'dir/a:b.js');
  for (const bad of ['C:/x.js', 'c:\\x.js', 'http://x/y', 'file://x']) assert.throws(() => checkRelativeFile(bad), /file name/, bad);
});

test('file URLs with localhost and URL-encoded roots are scrubbed in messages', () => {
  assert.equal(scrubRoots('at file://localhost/example-root/src/a.js', root), 'at src/a.js');
  assert.equal(scrubRoots('at file:///example-root/src/a.js', root), 'at src/a.js');
  assert.equal(scrubRoots('at /my%20root/src/a.js', '/my root'), 'at src/a.js');
  assert.equal(scrubRoots('at file:///my%20root/src/a.js', '/my root'), 'at src/a.js');
  assert.equal(scrubRoots('at file://evil.example/example-root/a.js', root), 'at file://evil.example/example-root/a.js');
});

test('root scrubbing ignores case for Windows-style roots and when asked', () => {
  assert.equal(scrubRoots('Error in c:\\proj\\src\\a.js', 'C:\\Proj'), 'Error in src\\a.js');
  assert.equal(scrubRoots('Error in C:/PROJ/src/a.js', 'c:/proj'), 'Error in src/a.js');
  assert.equal(scrubRoots('see /Srv/Example-Root/a.js', '/srv/example-root', { ignoreCase: true }), 'see a.js');
  assert.equal(scrubRoots('see /Srv/Example-Root/a.js', '/srv/example-root', { ignoreCase: false }), 'see /Srv/Example-Root/a.js');
});

test('every tool path is validated before any tool runs', async t => {
  const dir = tmp();
  const marker = path.join(dir, 'ran.txt');
  fakeProject({ eslint: { script: `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x'); process.exit(0);` } }, dir);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  await assert.rejects(() => runLint({ root: dir, tools: { eslint: { paths: ['src'] }, stylelint: { paths: ['{/etc,x}'] } } }), /Invalid lint path/);
  assert.equal(existsSync(marker), false);
});

test('an encoded separator or NUL in a file URL is malformed and outside', () => {
  for (const url of ['file:///example-root/a%2Fb.js', 'file:///example-root/a%5Cb.js', 'file:///example-root/a%5cb.js', 'file:///example-root/a%00b.js']) {
    assert.deepEqual(relativeFile(url, root), { file: '<outside>/unknown', inRoot: false }, url);
  }
  assert.deepEqual(relativeFile('file:///example-root/a%20b.js', root), { file: 'a b.js', inRoot: true });
});

test('a Windows file URL is scrubbed for a drive-letter root, ignoring case', () => {
  assert.equal(scrubRoots('at file:///c:/users/me/proj/c.js', 'C:\\Users\\Me\\proj'), 'at c.js');
  assert.equal(scrubRoots('at file://localhost/C:/Users/Me/proj/c.js', 'C:\\Users\\Me\\proj'), 'at c.js');
  assert.equal(scrubRoots('at file:///c:/users/me/proj2/c.js', 'C:\\Users\\Me\\proj'), 'at file:///c:/users/me/proj2/c.js');
});
