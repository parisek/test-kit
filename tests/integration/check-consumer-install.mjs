// Synthetic packed-package adoption. No CMS or DDEV instance runs here.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'test-kit-consumers-'));
const offline = process.env.TEST_KIT_CONSUMER_ALLOW_NETWORK !== '1';
const layouts = [
  ['parent', 'static'],
  ['wordpress', 'wp-content/themes/example-theme/static'],
  ['drupal', 'web/themes/custom/example-theme/static'],
];
function execute(command, args, cwd, expected = 0) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, npm_config_logs_dir: join(temporary, 'npm-logs') } });
  if (result.error) throw result.error;
  assert.equal(result.status, expected, `${command} ${args.join(' ')} fails:\n${result.stderr || result.stdout}`);
  return result;
}
const node = (args, cwd, expected = 0) => execute(process.execPath, args, cwd, expected);

try {
  const [pack] = JSON.parse(execute('npm', ['pack', '--ignore-scripts', '--pack-destination', temporary, '--json'], repository).stdout);
  const tarball = join(temporary, pack.filename);
  assert.equal(pack.files.some(file => file.path.startsWith('frontend/')), false);
  assert.equal(pack.files.some(file => file.path.startsWith('tests/')), false);
  for (const [cms, relative] of layouts) {
    const directory = join(temporary, cms, relative);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: `example-site-${cms}`, private: true, type: 'module' }));
    const install = ['install', '--save-dev', tarball, '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund',
      offline ? '--offline' : '--prefer-offline'];
    execute('npm', install, directory);
    const installed = join(directory, 'node_modules/@parisek/test-kit');
    const bin = join(directory, 'node_modules/.bin/test-kit');
    await access(bin);
    for (const peer of ['@playwright/test', 'lighthouse', 'chrome-launcher', 'puppeteer-core', 'vue', 'vite']) {
      await assert.rejects(access(join(directory, 'node_modules', peer)), `${cms} unexpectedly installs ${peer}`);
    }
    for (const file of ['viewer/app.js', 'viewer/style.css', 'viewer/index.html', 'templates/test-kit.config.json']) {
      assert.deepEqual(await readFile(join(installed, file)), await readFile(join(repository, file)));
    }
    const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
    assert.equal(manifest.private, true);
    assert.equal(manifest.scripts.prepare, undefined);
    assert.equal(manifest.scripts.postinstall, undefined);
    assert.match(node([bin, '--help'], directory).stdout, /capture|query|perf/);
    assert.equal(node([bin, '--version'], directory).stdout.trim(), manifest.version);
    // init is not implemented in the current release. Verify an honest failure.
    const initialization = node([bin, 'init'], directory, 1);
    assert.match(initialization.stderr, /Unknown command: init/);
    const template = await readFile(join(installed, 'templates/test-kit.config.json'));
    await writeFile(join(directory, 'test-kit.config.json'), template);
    const copied = JSON.parse(await readFile(join(directory, 'test-kit.config.json'), 'utf8'));
    assert.equal(copied.sides.local.origin, 'http://localhost:8080');
    const imports = node(['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import * as api from '@parisek/test-kit';
      import { planLegacySelection } from '@parisek/test-kit/compat/selection';
      for (const name of ['run', 'runPerformance', 'comparePerformance', 'evaluateBudgets', 'collectContracts', 'validateContracts']) {
        assert.equal(typeof api[name], 'function', name);
      }
      assert.equal(api.performanceSettings().runs, 3);
      assert.equal(typeof planLegacySelection, 'function');
      console.log('Public imports work without browser peers.');
    `], directory);
    assert.match(imports.stdout, /Public imports work/);
    const reportDir = join(directory, '.test-kit/report');
    await mkdir(reportDir, { recursive: true });
    const difference = { changed: true, method: 'prefix-suffix-replacement', removedLines: 1, addedLines: 1,
      displayedLines: 2, omittedLines: 0, lines: [
        { kind: 'removed', line: 1, text: '<h1>Before example</h1>', truncated: false },
        { kind: 'added', line: 1, text: '<h1>After example</h1>', truncated: false },
      ] };
    await writeFile(join(reportDir, 'html-diff.json'), JSON.stringify(difference));
    await writeFile(join(reportDir, 'html-a.txt'), '<h1>Before example</h1>');
    await writeFile(join(reportDir, 'html-b.txt'), '<h1>After example</h1>');
    const provenance = { kind: 'html', tool: 'synthetic-fixture', version: '1', settingsHash: `sha256:${'a'.repeat(64)}` };
    const report = { schemaVersion: 2, meta: { title: 'Synthetic adoption comparison', matchBelow: 3, viewports: [{ id: 'desktop' }] },
      runs: [{ id: 'before' }, { id: 'after' }], pair: { kind: 'adhoc', aRunId: 'before', bRunId: 'after' },
      entries: [{ id: 'home', title: 'Example page', viewports: [{ id: 'desktop', state: 'complete', availability: { a: 'ok', b: 'ok' },
        artifacts: { html: { kind: 'html', state: 'complete', a: { ...provenance, src: 'html-a.txt' }, b: { ...provenance, src: 'html-b.txt' }, diff: { ...provenance, src: 'html-diff.json', changed: true } } } }] }],
      causes: [], findings: [{ id: 'html-home', targetId: 'home', viewportId: 'desktop', artifact: 'html', message: 'Synthetic HTML changes.' }], rules: {} };
    const reportPath = join(reportDir, 'report.json');
    await writeFile(reportPath, JSON.stringify(report));
    const query = JSON.parse(node([bin, 'query', reportPath, '--target', 'home', '--viewport', 'desktop', '--artifact', 'html', '--max-lines', '1'], directory).stdout);
    assert.equal(query.state, 'complete');
    assert.equal(query.diff.lines.length, 1);
    assert.equal(query.diff.omittedLines, 1);
    assert.equal(query.diff.lines[0].text, '<h1>Before example</h1>');
    const summary = JSON.parse(node([bin, 'summary', reportPath], directory).stdout);
    assert.equal(summary.verdict, 'unexplained');
    assert.equal(summary.counts.total, 1);
    // Use the generated lockfile, then check reproducible installation too.
    const lock = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8'));
    assert.ok(lock.packages['node_modules/@parisek/test-kit']);
    await rm(join(directory, 'node_modules'), { recursive: true, force: true });
    execute('npm', ['ci', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund', offline ? '--offline' : '--prefer-offline'], directory);
    assert.equal(node([bin, '--version'], directory).stdout.trim(), manifest.version);
    console.log(`${cms}: packed install, lockfile reinstall, bin, imports, query and compiled viewer pass.`);
  }
  console.log(`Synthetic adoption passes in three layouts (${offline ? 'offline npm cache' : 'network permitted'}). init, exact git release adoption and DDEV are not verified.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
