import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { builtinChecks } from '../../src/checks/index.js';
import { BUILTIN_CONTENT_CHECKS } from '../../src/report/catalog.js';
import { normalizeConfig } from '../../src/config/normalize.js';
import { captureSettings } from '../../src/config/settings.js';
import { compareContentArtifact } from '../../src/content/compare-artifact.js';
import { validateContentComparison } from '../../src/content/compare.js';
import { parseCommand } from '../../src/cli/run.js';

// R7.8, #378: a target names text that its page must contain.
const doc = { schemaVersion: 1, extractorVersion: '1.1.0', source: 'settled-dom', title: 'Example site', lang: 'en', text: 'Hello', headings: [{ level: 1, text: 'Hello' }], images: [], links: [], omitted: { headings: 0, images: 0, links: 0, text: false } };
const check = builtinChecks['expect-text'];

test('expect-text is an absolute, opt-in content check in the catalog (R7.8)', () => {
  assert.equal(check.basis, 'absolute');
  assert.deepEqual(BUILTIN_CONTENT_CHECKS['expect-text'], { basis: 'absolute', layer: 'package', title: check.title });
});

test('expect-text reports each missing string and passes when all occur (R7.8)', () => {
  const html = '<html><body><div class="component-page-header-home"><form id="wpforms-form-125"></form></div></body></html>';
  assert.deepEqual(check.check(doc, { expectText: ['component-page-header-home', 'id="wpforms-form-125"'], html }), []);
  const findings = check.check(doc, { targetId: 'home', viewportId: 'desktop', expectText: ['component-page-header-home', 'Missing anchor', 'ID="wpforms-form-125"'], html });
  assert.deepEqual(findings.map(item => item.evidence.expected), ['Missing anchor', 'ID="wpforms-form-125"']);
  assert.equal(findings[0].checkId, 'expect-text'); assert.equal(findings[0].severity, 'warning'); assert.equal(findings[0].targetId, 'home');
});

test('the finding message names the missing string, cut to 80 characters (R7.8, #441)', () => {
  const html = '<main>Hello</main>';
  const [short] = check.check(doc, { expectText: ['Missing footer'], html });
  assert.equal(short.message, 'The page does not contain the expected text "Missing footer".');
  assert.deepEqual(short.evidence, { expected: 'Missing footer' });
  const [quoted] = check.check(doc, { expectText: ['id="example-form"'], html });
  assert.equal(quoted.message, 'The page does not contain the expected text "id=\\"example-form\\"".');
  const long = 'x'.repeat(500);
  const [cut] = check.check(doc, { expectText: [long], html });
  assert.equal(cut.message, `The page does not contain the expected text "${'x'.repeat(79)}…".`);
  assert.equal(cut.evidence.expected, long, 'The evidence keeps the whole string.');
});

test('expect-text is unknown without configured strings or a stored body (R7.8)', () => {
  assert.equal(check.check(doc, { html: '<html></html>' })[0].evidence.state, 'unknown');
  assert.equal(check.check(doc, { expectText: [], html: '<html></html>' })[0].evidence.state, 'unknown');
  assert.equal(check.check(doc, { expectText: ['x'] })[0].evidence.state, 'unknown');
  assert.throws(() => check.check({ ...doc, extractorVersion: '2.0.0' }, { expectText: ['x'], html: 'x' }));
});

const base = { schemaVersion: 1, sides: { local: { origin: 'http://127.0.0.1:8000' } }, targets: [{ id: 'home', kind: 'page', path: '/' }], viewports: [{ id: 'desktop', width: 1280, height: 900 }], artifacts: ['content'], checks: ['expect-text'] };

test('target.expectText takes 1 to 20 bounded unique strings and enters no capture settings (R7.8)', () => {
  const withText = { ...base, targets: [{ ...base.targets[0], expectText: ['component-page-header-home', 'id="wpforms-form-125"'] }] };
  assert.deepEqual(normalizeConfig(withText).targets[0].expectText, ['component-page-header-home', 'id="wpforms-form-125"']);
  assert.equal(normalizeConfig(base).targets[0].expectText, undefined);
  assert.deepEqual(captureSettings(normalizeConfig(withText), 'local'), captureSettings(normalizeConfig(base), 'local'));
  for (const bad of ['x', [], Array(21).fill(0).map((_, index) => `t${index}`), [''], ['x'.repeat(501)], ['a\nb'], [1], ['x', 'x'], null])
    assert.throws(() => normalizeConfig({ ...base, targets: [{ ...base.targets[0], expectText: bad }] }), /expectText/, JSON.stringify(bad));
});

test('all seven built-in checks fit in the checks list', () => {
  assert.equal(normalizeConfig({ ...base, checks: Object.keys(builtinChecks) }).checks.length, 7);
});

test('compareContentArtifact reads the stored DOM body of each side for expect-text (R7.8)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tk-expect-text-'));
  try {
    const settings = normalizeConfig({ ...base, targets: [{ ...base.targets[0], expectText: ['component-page-header-home'] }] });
    const run = async (id, body, withBody = true) => {
      const dir = join(root, 'runs', id, 'content', 'home');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'desktop.json.gz'), gzipSync(JSON.stringify(doc)));
      if (withBody) await writeFile(join(dir, 'desktop.body.html.gz'), gzipSync(body));
      const content = { kind: 'content', tool: 'test-kit-content', version: '1.1.0', settingsHash: 'sha256:' + 'a'.repeat(64), browserVersion: 'chromium 1', state: 'captured', path: 'content/home/desktop.json.gz', ...(withBody ? { bodyPath: 'content/home/desktop.body.html.gz', bodyBytes: body.length } : {}) };
      const capture = { targetId: 'home', viewportId: 'desktop', state: 'captured', statusCode: 200, artifacts: { content } };
      return { run: { id, side: 'local', settings, captures: [capture] }, capture };
    };
    const compare = async (a, b, name) => {
      const output = join(root, name);
      const result = await compareContentArtifact({ a: a.run, b: b.run, ac: a.capture, bc: b.capture, runsRoot: join(root, 'runs'), output, targetId: 'home', viewportId: 'desktop' });
      return { result, detail: result.artifact.diff ? validateContentComparison(JSON.parse(await readFile(join(output, result.artifact.diff.src), 'utf8'))) : null };
    };
    const good = await run('a', '<div class="component-page-header-home"></div>');
    const bad = await run('b', '<div class="error-page"></div>');
    const pass = await compare(good, good, 'out-pass');
    assert.equal(pass.result.findings.length, 0); assert.equal(pass.result.artifact.state, 'complete');
    const fail = await compare(good, bad, 'out-fail');
    assert.deepEqual(fail.result.findings.map(item => [item.checkId, item.evidence.expected]), [['expect-text', 'component-page-header-home']]);
    assert.equal(fail.detail.checks[0].a.state, 'passed'); assert.equal(fail.detail.checks[0].b.state, 'failed');
    const old = await run('c', '', false);
    const missing = await compare(good, old, 'out-old');
    assert.equal(missing.result.artifact.state, 'missing'); assert.equal(missing.detail.checks[0].b.findings[0].evidence.state, 'unknown');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('--checks takes all seven built-in checks and no more (R7.8)', () => {
  const all = Object.keys(builtinChecks).join(',');
  assert.equal(parseCommand(['diff', 'a', 'b', '--output', 'out', '--checks', all]).options.checks, all);
  assert.equal(parseCommand(['run', '--checks', 'expect-text']).options.checks, 'expect-text');
  assert.throws(() => parseCommand(['run', '--checks', `${all},lang`]), /duplicate/);
});
