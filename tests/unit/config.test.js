import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeConfig, loadConfig, captureSettings, settingsHash } from '../../src/config/index.js';

function input() {
  return { schemaVersion: 1, sides: { local: { origin: 'http://localhost:8080' } },
    targets: [{ id: 'home', kind: 'page', path: '/' }], viewports: [{ id: 'small', width: 10, height: 10 }] };
}

test('normalization copies and freezes capture configuration', () => {
  const source = input();
  const result = normalizeConfig(source);
  source.targets[0].path = '/changed';
  assert.equal(result.targets[0].path, '/');
  assert.deepEqual(result.artifacts, ['screenshot']);
  assert.deepEqual(result.checks, []);
  assert.equal(result.sides.local.settle.disableMotion, true);
  assert.throws(() => { result.viewports[0].width = 20; }, TypeError);
});

test('explicit local origins include DDEV and loopback', () => {
  for (const origin of ['http://127.0.0.1:8080', 'http://[::1]:8080', 'https://example-site.ddev.site', 'http://localhost']) {
    const source = input(); source.sides.local.origin = origin;
    assert.equal(normalizeConfig(source).sides.local.origin, origin);
  }
  for (const origin of ['https://example.com', 'http://localhost.example.com', 'http://localhost@evil.example', 'http://user:password@localhost', 'http://localhost/?token=secret', 'http://localhost/#secret', 'file:///tmp/test', 'http://localhost/path']) {
    const source = input(); source.sides.local.origin = origin;
    assert.throws(() => normalizeConfig(source), /Invalid configuration/);
  }
});

test('per-side paths must cover every side and remain on the origin', () => {
  const source = input(); source.sides.other = { origin: 'http://localhost:8081' };
  source.targets[0] = { id: 'home', kind: 'page', paths: { local: '/', other: '/different?lang=en' } };
  assert.equal(normalizeConfig(source).targets[0].paths.other, '/different?lang=en');
  delete source.targets[0].paths.other;
  assert.throws(() => normalizeConfig(source), /no path/);
  for (const path of ['https://example.com', '//example.com', '/\\example.com', '/a\npath']) {
    const value = input(); value.targets[0].path = path;
    assert.throws(() => normalizeConfig(value), /Invalid configuration/);
  }
});

test('unsafe IDs and duplicate capture keys fail', () => {
  for (const id of ['../escape', '.', '', 'a/b', 'a b']) {
    const source = input(); source.targets[0].id = id;
    assert.throws(() => normalizeConfig(source), /safe ID/);
  }
  const source = input(); source.targets.push({ ...source.targets[0] });
  assert.throws(() => normalizeConfig(source), /unique/);
  source.targets.pop(); source.viewports.push({ ...source.viewports[0] });
  assert.throws(() => normalizeConfig(source), /unique/);
});

test('component selectors remain bounded text', () => {
  const source = input();
  source.targets[0] = { id: 'card', kind: 'component', path: '/components/card', selector: '.card' };
  assert.equal(normalizeConfig(source).targets[0].selector, '.card');
  for (const selector of ['', 'a'.repeat(2049), ['.card']]) {
    source.targets[0].selector = selector;
    assert.throws(() => normalizeConfig(source), /target.selector/);
  }
});

test('numeric and resource limits reject nonfinite and excessive values', () => {
  for (const width of [0, 4097, Infinity, NaN, 1.5, '100']) {
    const source = input(); source.viewports[0].width = width;
    assert.throws(() => normalizeConfig(source), /width/);
  }
  const source = input(); source.viewports[0] = { id: 'huge', width: 4096, height: 4096, deviceScaleFactor: 3 };
  assert.throws(() => normalizeConfig(source), /million pixels/);
  source.viewports[0] = { id: 'small', width: 10, height: 10 };
  source.sides.local.settle = { waitMs: 10001 };
  assert.throws(() => normalizeConfig(source), /waitMs/);
  delete source.sides.local.settle; source.screenshot = { timeoutMs: 120001 };
  assert.throws(() => normalizeConfig(source), /timeoutMs/);
});

test('unsupported features and unsafe run roots fail explicitly', () => {
  for (const change of [{ artifacts: ['html'] }, { checks: ['heading-outline'] }, { cookies: [] }, { runsRoot: '../runs' }, { runsRoot: '/tmp/runs' }]) {
    assert.throws(() => normalizeConfig({ ...input(), ...change }), /Invalid configuration/);
  }
});

test('settings hashes ignore origin and input paths but retain effective settings', () => {
  const first = normalizeConfig(input());
  const source = input(); source.sides.local.origin = 'http://localhost:9090'; source.targets[0].path = '/other';
  const second = normalizeConfig(source);
  assert.equal(settingsHash(captureSettings(first, 'local')), settingsHash(captureSettings(second, 'local')));
  source.sides.local.settle = { masks: ['.clock'] };
  assert.notEqual(settingsHash(captureSettings(first, 'local')), settingsHash(captureSettings(normalizeConfig(source), 'local')));
  assert.equal(settingsHash({ b: 1, a: { d: 2, c: 3 } }), settingsHash({ a: { c: 3, d: 2 }, b: 1 }));
  assert.throws(() => captureSettings(first, 'missing'), /Unknown side/);
});

test('loadConfig resolves storage relative to the configuration file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'test-kit-config-'));
  try {
    const path = join(directory, 'test-kit.config.json');
    await writeFile(path, JSON.stringify(input()));
    const loaded = await loadConfig(path);
    assert.equal(loaded.configDir, directory);
    assert.equal(loaded.runsRoot, join(directory, 'tests/visual/runs'));
    assert.equal(loaded.configPath, path);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('inherited side paths do not satisfy target coverage', () => {
  assert.throws(() => normalizeConfig({ schemaVersion: 1, sides: { constructor: { origin: 'http://localhost:8080' } }, targets: [{ id: 'home', kind: 'page', paths: {} }], viewports: [{ id: 'desktop', width: 800, height: 600 }] }), /no path/);
});
