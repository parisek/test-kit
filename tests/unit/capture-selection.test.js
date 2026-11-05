import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIdList, recordSelection, validateSelection, cellSelected } from '../../src/capture/selection.js';
import { parseCommand } from '../../src/cli/run.js';
import { normalizeConfig } from '../../src/config/index.js';
import { captureSettings, contentSettings, responseSettings, settingsHash } from '../../src/config/settings.js';

const settings = {
  targets: [{ id: 'home', kind: 'page', path: '/' }, { id: 'about', kind: 'page', path: '/about' }, { id: 'blog', kind: 'page', path: '/blog' }],
  viewports: [{ id: 'mobile', width: 390, height: 800, deviceScaleFactor: 1 }, { id: 'desktop', width: 1280, height: 800, deviceScaleFactor: 1 }],
};

test('parseIdList accepts safe unique ids and rejects the rest', () => {
  assert.deepEqual(parseIdList('home,about', 'target'), ['home', 'about']);
  for (const bad of ['', 'a,,b', 'a,a', '-a', 'a b', 'a/b', 'x'.repeat(65)]) assert.throws(() => parseIdList(bad, 'target'), /Invalid target selection/);
});

test('recordSelection keeps configuration order, omits unselected axes, and checks ids', () => {
  assert.equal(recordSelection(settings, {}), null);
  assert.equal(recordSelection(settings, { targets: undefined, viewports: undefined }), null);
  assert.deepEqual(recordSelection(settings, { targets: ['blog', 'home'] }), { targets: ['home', 'blog'] });
  assert.deepEqual(recordSelection(settings, { targets: ['about'], viewports: ['desktop'] }), { targets: ['about'], viewports: ['desktop'] });
  assert.throws(() => recordSelection(settings, { targets: ['nope'] }), /Unknown target/);
  assert.throws(() => recordSelection(settings, { viewports: ['nope'] }), /Unknown viewport/);
  assert.throws(() => recordSelection(settings, { targets: [] }), /Invalid target selection/);
  assert.throws(() => recordSelection(settings, { targets: ['home', 'home'] }), /Invalid target selection/);
});

test('validateSelection rejects a bad record', () => {
  assert.deepEqual(validateSelection({ targets: ['home'] }, settings), { targets: ['home'] });
  for (const bad of [null, [], 'x', {}, { targets: [] }, { targets: ['home', 'home'] }, { targets: ['nope'] }, { targets: 'home' }, { viewports: ['home'] }, { other: ['home'] }, { targets: ['bad id'] },
    { targets: Array.from({ length: 1001 }, (_, index) => `t${index}`) }]) assert.throws(() => validateSelection(bad, settings), /Invalid stored selection/);
});

test('cellSelected treats no selection as every cell', () => {
  assert.equal(cellSelected(undefined, 'home', 'mobile'), true);
  assert.equal(cellSelected(null, 'home', 'mobile'), true);
  assert.equal(cellSelected({ targets: ['home'] }, 'home', 'desktop'), true);
  assert.equal(cellSelected({ targets: ['home'] }, 'about', 'desktop'), false);
  assert.equal(cellSelected({ viewports: ['mobile'] }, 'about', 'desktop'), false);
  assert.equal(cellSelected({ targets: ['home'], viewports: ['mobile'] }, 'home', 'mobile'), true);
});

test('a selection changes no settings hash for any artifact (screenshot, content, response)', () => {
  const config = normalizeConfig({ schemaVersion: 1, sides: { local: { origin: 'http://127.0.0.1:8080' } }, targets: settings.targets, viewports: settings.viewports, artifacts: ['screenshot', 'html', 'status', 'content'] });
  const before = structuredClone(config);
  const hashes = () => ({
    screenshot: settingsHash(captureSettings(config, 'local')), content: settingsHash(contentSettings(config, 'local', config.targets[0])),
    html: settingsHash(responseSettings(config, 'html')), status: settingsHash(responseSettings(config, 'status')),
  });
  const full = hashes();
  const selection = recordSelection(config, { targets: ['about'], viewports: ['desktop'] });
  assert.deepEqual(selection, { targets: ['about'], viewports: ['desktop'] });
  assert.deepEqual(config, before, 'recordSelection does not change the configuration');
  assert.deepEqual(hashes(), full);
});

test('capture and diff take --target and --viewport; the lists are checked at parse time', () => {
  const capture = parseCommand(['capture', '--side', 'local', '--target', 'home,about', '--viewport', 'mobile']);
  assert.equal(capture.options.target, 'home,about');
  assert.equal(capture.options.viewport, 'mobile');
  const diff = parseCommand(['diff', 'a', 'b', '--output', 'out', '--target', 'home']);
  assert.equal(diff.options.target, 'home');
  for (const command of [['capture', '--side', 'local'], ['diff', 'a', 'b', '--output', 'out']]) {
    assert.throws(() => parseCommand([...command, '--target', 'a,a']), /Invalid target selection/);
    assert.throws(() => parseCommand([...command, '--viewport', 'bad id']), /Invalid viewport selection/);
    assert.throws(() => parseCommand([...command, '--target', 'a', '--target', 'b']), /Duplicate option/);
  }
  assert.throws(() => parseCommand(['summary', 'report.json', '--viewport', 'mobile']), /Unknown option/);
});
