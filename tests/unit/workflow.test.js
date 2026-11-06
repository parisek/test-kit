import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { loadConfig } from '../../src/config/index.js';
import { runWorkflow, selectConfig, loopbackOrigin, resolveStore, ensureStore, parseDdevDescription } from '../../src/workflow/index.js';
const config = { schemaVersion: 1, sides: { local: { origin: 'http://127.0.0.1:8000' } }, targets: [{ id: 'home', kind: 'page', path: '/' }, { id: 'contact', kind: 'page', path: '/contact' }], viewports: [{ id: 'desktop', width: 1280, height: 900 }, { id: 'mobile', width: 390, height: 844 }], artifacts: ['screenshot'], checks: [] };
async function fixture(t) {
 const dir = await mkdtemp(join(tmpdir(), 'test-kit-workflow-'));
 t.after(() => rm(dir, { recursive: true, force: true }));
 const file = join(dir, 'test-kit.config.json'); await writeFile(file, JSON.stringify(config));
 return { dir, options: { config: file } };
}
test('selection retains paths and isolates a component viewport', () => {
 const selected = selectConfig(config, { target: 'home', selector: '#header', viewport: 'mobile' });
 assert.equal(selected.targets[0].selector, '#header'); assert.equal(selected.viewports.length, 1); assert.equal(config.targets[0].kind, 'page');
 assert.throws(() => selectConfig(config, { path: '//remote.test' }));
 assert.throws(() => selectConfig(config, { target: 'missing' }));
 assert.throws(() => selectConfig(config, { selector: '#header', suite: 'content', target: 'home' }));
});
test('suite all uses the normalized default artifacts when the config has no artifacts key', () => {
 const { artifacts, ...bare } = config;
 assert.equal(selectConfig(bare, {}).artifacts.join(), 'screenshot');
 assert.equal(selectConfig(bare, { suite: 'all' }).artifacts.join(), 'screenshot');
 assert.equal(selectConfig({ ...bare, artifacts: ['screenshot', 'status'] }, {}).artifacts.join(), 'screenshot,status');
 assert.throws(() => selectConfig(bare, { suite: 'nope' }), /Unknown suite/);
});
test('DDEV rejects remote origins and store rejects traversal', () => {
 assert.equal(loopbackOrigin({ raw: { services: { web: { host_http_url: 'http://127.0.0.1:1234' } } } }), 'http://127.0.0.1:1234');
 assert.throws(() => loopbackOrigin({ raw: { services: { web: { host_http_url: 'https://example.test' } } } }));
 for (const store of ['../outside', '/tmp/store', 'a/../b']) assert.throws(() => resolveStore({ store }));
});
test('run retains partial evidence without making a comparison', async t => {
 const { dir, options } = await fixture(t); let runtime;
 const result = await runWorkflow('run', options, { capture: async input => { runtime = input.configPath; assert.equal(join(dir, 'test-kit', 'runs'), join(dir, JSON.parse(await readFile(runtime)).runsRoot)); return { run: { id: 'partial-1', state: 'partial' }, manifestPath: 'evidence' }; }, summarizeRunFeedback: async () => ({ state: 'incomplete' }), compareRuns: () => assert.fail('No fabricated pair') });
 assert.equal(result.exitCode, 1); assert.equal(result.output.id, 'partial-1'); assert.equal((await readdir(dir)).some(name => name.includes('runtime')), false);
});
test('baseline scopes and lockfile policy prevent an unrelated after run', async t => {
 const { dir, options } = await fixture(t);
 const capture = async () => ({ run: { id: 'before-1', state: 'complete' }, manifestPath: 'evidence' });
 await runWorkflow('before', { ...options, target: 'home' }, { capture });
 await assert.rejects(runWorkflow('after', { ...options, target: 'contact' }, { capture }), /Run before/);
 await writeFile(join(dir, 'package-lock.json'), '{}');
 await assert.rejects(runWorkflow('after', { ...options, target: 'home' }, { capture }), /Run before/);
});
test('partial baseline keeps the old baseline and partial after retains report', async t => {
 const { dir, options } = await fixture(t);
 await runWorkflow('before', options, { capture: async () => ({ run: { id: 'before-1', state: 'complete' } }) });
 await runWorkflow('before', options, { capture: async () => ({ run: { id: 'failed-1', state: 'partial' } }) });
 let a;
 const result = await runWorkflow('after', options, { capture: async () => ({ run: { id: 'after-1', state: 'partial' } }), compareRuns: async input => { a = input.runA; return { reportPath: join(input.outputDir, 'report.json') }; } });
 assert.equal(a, 'before-1'); assert.equal(result.exitCode, 1);
 const state = JSON.parse(await readFile(join(dir, 'test-kit/state.json'))); assert.equal(state.report, 'reports/after-1/report.json');
});
test('store lock rejects another writer and is preserved', async t => {
 const { dir, options } = await fixture(t); await mkdir(join(dir, 'test-kit/lock'), { recursive: true });
 await assert.rejects(runWorkflow('run', options), /already owns/);
 assert.ok((await readdir(join(dir, 'test-kit'))).includes('lock'));
});
test('DDEV is opt-in and runtime preserves relative source paths', async t => {
 const { dir, options } = await fixture(t);
 const input = { ...config, artifacts: ['behavior'], behavior: { source: 'tests/contracts', projects: { mobile: 'mobile-390', desktop: 'desktop-1280' } } };
 await writeFile(options.config, JSON.stringify(input)); let discovered = 0;
 const dependencies = { summarizeRunFeedback: async () => ({ state: 'complete' }), describe: async () => { discovered++; return { raw: { services: { web: { host_http_url: 'http://127.0.0.1:4567' } } } }; }, loadBehaviorSource: async input => { assert.equal(input.projectRoot, dir); assert.equal(input.directory, 'tests/contracts'); assert.deepEqual(input.enabled, ['menu']); return { fingerprint: 'source-1' }; }, capture: async ({ configPath, baseDir }) => { assert.equal(dirname(configPath), join(dir, 'test-kit')); assert.equal(baseDir, dir); const loaded = JSON.parse(await readFile(configPath)); assert.equal(loaded.sides.local.origin, 'http://127.0.0.1:4567'); assert.equal(loaded.behavior.source, 'tests/contracts'); return { run: { id: 'single-1', state: 'complete' } }; } };
 await runWorkflow('run', { ...options, ddev: true, contracts: 'menu' }, dependencies);
 assert.equal(discovered, 1);
});
test('--ddev inside the DDEV container explains where to run it (#238)', { skip: process.platform === 'win32' }, async t => {
 assert.throws(() => parseDdevDescription("You executed 'ddev describe' inside the container."), /Run --ddev on the host, not inside the DDEV container/);
 const { dir, options } = await fixture(t);
 const bin = join(dir, 'bin'); await mkdir(bin);
 await writeFile(join(bin, 'ddev'), "#!/bin/sh\necho \"You executed 'ddev $*' inside the container. This is not possible.\"\n"); await chmod(join(bin, 'ddev'), 0o755);
 const path = process.env.PATH; process.env.PATH = `${bin}${delimiter}${path}`; t.after(() => { process.env.PATH = path; });
 await assert.rejects(runWorkflow('before', { ...options, ddev: true }, { capture: () => assert.fail('No capture without an origin') }), error => /Run --ddev on the host/.test(error.message) && !/Unexpected token/.test(error.message));
});
test('report does not start capture and rejects a path as a report ID', async t => {
 const { dir, options } = await fixture(t);
 await mkdir(join(dir, 'test-kit/reports/run-1'), { recursive: true });
 await writeFile(join(dir, 'test-kit/reports/run-1/report.json'), '{}');
 let path;
 const result = await runWorkflow('report', { ...options, run: 'run-1' }, { serve: async input => { path = input.reportPath; return { origin: 'http://127.0.0.1:4567' }; } });
 assert.equal(path, join(dir, 'test-kit/reports/run-1/report.json')); assert.equal(result.exitCode, 0);
 await assert.rejects(runWorkflow('report', { ...options, run: '../outside' }), /Invalid report ID/);
});

test('history store and report reject symlink escapes', async t => {
 const { dir, options } = await fixture(t);
 const outside = await mkdtemp(join(tmpdir(), 'test-kit-outside-'));
 t.after(() => rm(outside, { recursive: true, force: true }));
 await symlink(outside, join(dir, 'linked'));
 await assert.rejects(ensureStore({ ...options, store: 'linked/data' }), /symbolic links/);
 await mkdir(join(dir, 'test-kit/reports'), { recursive: true });
 await writeFile(join(outside, 'report.json'), '{}');
 await symlink(outside, join(dir, 'test-kit/reports/run-1'));
 await assert.rejects(runWorkflow('report', { ...options, run: 'run-1' }), /escapes/);
});

test('report export calls the exporter without starting a server', async t => {
 const { dir, options } = await fixture(t);
 await mkdir(join(dir, 'test-kit/reports/run-1'), { recursive: true });
 await writeFile(join(dir, 'test-kit/reports/run-1/report.json'), '{}');
 let exported;
 const result = await runWorkflow('report', { ...options, run: 'run-1', export: 'test-kit-export' }, {
   serve: async () => { throw new Error('A server must not start.'); },
   exportReport: async input => { exported = input; return { outputPath: input.outputDir, files: ['index.html'] }; },
 });
 assert.equal(exported.outputDir, join(dir, 'test-kit-export'));
 assert.equal(exported.reportPath, join(dir, 'test-kit/reports/run-1/report.json'));
 assert.equal(result.exitCode, 0);
 assert.equal(result.output.url, undefined);
});

test('the runtime copy sits inside the store and relative paths still resolve from the project root (#312)', async t => {
 const { dir, options } = await fixture(t);
 const input = { ...config, artifacts: ['behavior'], behavior: { source: 'tests/contracts', projects: { mobile: 'mobile-390', desktop: 'desktop-1280' } } };
 await writeFile(options.config, JSON.stringify(input));
 let seen;
 await runWorkflow('run', { ...options, contracts: 'menu' }, {
  summarizeRunFeedback: async () => ({ state: 'complete' }),
  loadBehaviorSource: async () => ({ fingerprint: 'source-1' }),
  capture: async ({ configPath, baseDir }) => {
   const loaded = await loadConfig(configPath, { baseDir });
   seen = { runtimeDir: dirname(configPath), configDir: loaded.configDir, runsRoot: loaded.runsRoot, source: loaded.config.behavior.source };
   return { run: { id: 'single-1', state: 'complete' } };
  },
 });
 assert.equal(seen.runtimeDir, join(dir, 'test-kit'));
 assert.equal(seen.configDir, dir);
 assert.equal(seen.runsRoot, join(dir, 'test-kit', 'runs'));
 assert.equal(seen.source, 'tests/contracts');
 assert.equal((await readdir(dir)).filter(name => name.includes('runtime')).length, 0);
 assert.equal((await readdir(join(dir, 'test-kit'))).filter(name => name.includes('runtime')).length, 0);
});
test('without baseDir a config copy in the store would resolve from the store (why the option exists)', async t => {
 const { dir, options } = await fixture(t);
 await mkdir(join(dir, 'test-kit'));
 const copy = join(dir, 'test-kit', 'copy.json');
 await writeFile(copy, JSON.stringify(config));
 assert.equal((await loadConfig(copy)).configDir, join(dir, 'test-kit'));
 assert.equal((await loadConfig(copy, { baseDir: dir })).configDir, dir);
 assert.equal((await loadConfig(copy, { baseDir: dir })).runsRoot, join(dir, 'test-kit', 'runs'));
});
test('after with a deleted store or a deleted baseline says to run before again (#312)', async t => {
 const { dir, options } = await fixture(t);
 await assert.rejects(runWorkflow('after', options, { capture: () => assert.fail('no capture') }), /run before again/i);
 assert.equal((await readdir(dir)).includes('test-kit'), false);
 await mkdir(join(dir, 'test-kit'));
 await writeFile(join(dir, 'test-kit', 'state.json'), JSON.stringify({ schemaVersion: 1, profiles: {} }));
 await assert.rejects(runWorkflow('after', options, { capture: () => assert.fail('no capture') }), /run before again/i);
 const ok = { summarizeRunFeedback: async () => ({}), capture: async () => ({ run: { id: 'b1', state: 'complete' } }) };
 await mkdir(join(dir, 'test-kit', 'runs', 'b1'), { recursive: true });
 await writeFile(join(dir, 'test-kit', 'runs', 'b1', 'run.json'), '{}');
 await runWorkflow('before', options, ok);
 await rm(join(dir, 'test-kit', 'runs'), { recursive: true });
 await assert.rejects(runWorkflow('after', options, { capture: async () => ({ run: { id: 'a1', state: 'complete' } }) }), /run before again/i);
});
