import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, captureSettings, settingsHash } from '../../src/config/index.js';
import { parseComponents, readComponents, componentsUrl, componentPath, pagesUrl, StyleguideError } from '../../src/styleguide/index.js';
import { selectConfig } from '../../src/workflow/selection.js';
import { planPerfCommand } from '../../src/perf/plan.js';
import { comparisonState } from '../../src/compare/runs.js';

const catalogue = () => [
  { id: 'card', name: 'Card', category: 'Basic', has_styleguide: true, usage: ['home'] },
  { id: 'button', name: 'Button', has_styleguide: true },
  { id: 'hero', name: 'Hero', has_styleguide: false },
];
function input(extra = {}) {
  return { schemaVersion: 1, sides: { styleguide: { origin: 'http://localhost:8080' }, local: { origin: 'http://localhost:8081' } },
    viewports: [{ id: 'small', width: 320, height: 480 }], targetSource: { source: 'styleguide', side: 'styleguide' }, ...extra };
}

test('parseComponents: one component target for each entry, sorted by ID (R13.3)', () => {
  const { targets, noFixture } = parseComponents(catalogue());
  assert.deepEqual(targets.map(target => target.id), ['button', 'card']);
  assert.deepEqual(targets[0], { id: 'button', kind: 'component', title: 'Button', path: '/styleguide/render/component/button?canvas' });
  assert.deepEqual(noFixture, ['hero']);
  assert.equal(parseComponents(catalogue(), { mount: '/tools/ui' }).targets[0].path, '/tools/ui/render/component/button?canvas');
  assert.equal(parseComponents(catalogue(), { mount: '/' }).targets[0].path, '/render/component/button?canvas');
});

test('parseComponents: has_styleguide false makes no target and is listed as no fixture (#94)', () => {
  const { targets, noFixture } = parseComponents(catalogue());
  assert.equal(targets.some(target => target.id === 'hero'), false);
  assert.deepEqual(noFixture, ['hero']);
  // include may name it: it is skipped and listed, not an unknown name.
  const named = parseComponents(catalogue(), { include: ['card', 'hero'] });
  assert.deepEqual(named.targets.map(target => target.id), ['card']);
  assert.deepEqual(named.noFixture, ['hero']);
  // No target left: the capture stops with a named error.
  assert.throws(() => parseComponents(catalogue(), { include: ['hero'] }), error => error.code === 'STYLEGUIDE_CATALOGUE_INVALID' && /has a fixture/.test(error.message));
  assert.throws(() => parseComponents([{ id: 'a', has_styleguide: false }]), error => error.code === 'STYLEGUIDE_CATALOGUE_INVALID');
});

test('parseComponents: an entry with has_styleguide absent counts as renderable', () => {
  const { noFixture } = parseComponents([{ id: 'a', name: 'A' }, { id: 'b', name: 'B', has_styleguide: undefined }]);
  assert.deepEqual(noFixture, []);
});

test('parseComponents: a bad title falls back to the ID, a bad ID or a bad list is reported, never skipped', () => {
  assert.equal(parseComponents([{ id: 'a', name: 'x\ny' }]).targets[0].title, 'a');
  assert.equal(parseComponents([{ id: 'a' }]).targets[0].title, 'a');
  const fails = (payload, pattern, code = 'STYLEGUIDE_CATALOGUE_INVALID', options) =>
    assert.throws(() => parseComponents(payload, options), error => error instanceof StyleguideError && error.code === code && pattern.test(error.message));
  fails({}, /not an array/);
  fails([], /no component/);
  fails([{ id: 'ok' }, { id: '../x' }], /1 component\(s\) with no usable ID: entry 1/);
  fails([{ id: 'a b' }, { id: '' }, null, 'x', { id: 7 }, { id: 'a'.repeat(65) }], /6 component\(s\)/);
  fails([{ id: 'a' }, { id: 'a' }], /duplicate id "a"/);
  fails([{ id: 'a'.repeat(1001) }, { id: 'ok' }], /entry 0/);
  fails(Array.from({ length: 1001 }, (_, index) => ({ id: `c${index}` })), /more than 1000/);
  // The message bounds and cleans an untrusted ID.
  assert.throws(() => parseComponents([{ id: `x\n${'y'.repeat(500)}` }]), error => !/\n/.test(error.message) && error.message.length < 400);
});

test('parseComponents: include selects components and names an unknown one (R8.7)', () => {
  assert.deepEqual(parseComponents(catalogue(), { include: ['card'] }).targets.map(target => target.id), ['card']);
  assert.throws(() => parseComponents(catalogue(), { include: ['card', 'gone'] }),
    error => error.code === 'STYLEGUIDE_COMPONENT_UNKNOWN' && /"gone"/.test(error.message));
});

test('readComponents: reads the endpoint through the given transport and fails with a named state', async () => {
  const urls = [];
  const get = body => async url => { urls.push(url); return { status: 200, body: JSON.stringify(body) }; };
  const result = await readComponents({ origin: 'http://localhost:8080', get: get(catalogue()) });
  assert.equal(result.targets.length, 2);
  assert.deepEqual(result.noFixture, ['hero']);
  assert.deepEqual(urls, ['http://localhost:8080/styleguide/api/components']);
  assert.equal(componentsUrl('http://localhost:8080', '/tools/ui'), 'http://localhost:8080/tools/ui/api/components');
  assert.equal(componentPath('card'), '/styleguide/render/component/card?canvas');
  const fails = (get, pattern, code) => assert.rejects(readComponents({ origin: 'http://localhost:8080', get }), error => error.code === code && pattern.test(error.message));
  await fails(async () => { throw new Error('ECONNREFUSED'); }, /unreachable/, 'STYLEGUIDE_CATALOGUE_UNREACHABLE');
  await fails(async () => ({ status: 404, body: '' }), /HTTP 404/, 'STYLEGUIDE_CATALOGUE_UNREACHABLE');
  await fails(async () => ({ status: 301, body: '' }), /HTTP 301/, 'STYLEGUIDE_CATALOGUE_UNREACHABLE');
  await fails(async () => ({ status: 200, body: '<html>' }), /not JSON/, 'STYLEGUIDE_CATALOGUE_INVALID');
  await fails(async () => ({ status: 200, body: 'x'.repeat(9 * 1024 * 1024) }), /too large/, 'STYLEGUIDE_CATALOGUE_INVALID');
});

test('config: targetSource is absent by default and an existing config is unchanged (G3, R5.1)', () => {
  const page = { schemaVersion: 1, sides: { local: { origin: 'http://localhost:8080' } }, targets: [{ id: 'home', kind: 'page', path: '/' }], viewports: [{ id: 'small', width: 10, height: 10 }] };
  const result = normalizeConfig(page);
  assert.equal(Object.hasOwn(result, 'targetSource'), false);
  assert.deepEqual(Object.keys(result), ['schemaVersion', 'sides', 'targets', 'viewports', 'artifacts', 'checks', 'packs', 'content', 'behavior', 'runsRoot', 'screenshot', 'rules', 'known_diffs']);
  assert.equal(settingsHash(captureSettings(result, 'local')), settingsHash(captureSettings(normalizeConfig({ ...page, targetSource: { source: 'styleguide', side: 'local' }, targets: undefined }), 'local')));
});

test('config: targetSource replaces the target list, fills the mount and normalizes twice to the same value (R13.3)', () => {
  const result = normalizeConfig(input());
  assert.deepEqual(result.targets, []);
  assert.deepEqual(result.targetSource, { source: 'styleguide', side: 'styleguide', mount: '/styleguide' });
  assert.deepEqual(normalizeConfig(JSON.parse(JSON.stringify(result))), result);
  assert.deepEqual(normalizeConfig(input({ targets: [] })), result);
  assert.deepEqual(normalizeConfig(input({ targetSource: { source: 'styleguide', side: 'local', mount: '/tools/ui', include: ['card'] } })).targetSource,
    { source: 'styleguide', side: 'local', mount: '/tools/ui', include: ['card'] });
  assert.throws(() => { result.targetSource.mount = '/x'; }, TypeError);
});

test('config: invalid targetSource values fail validation', () => {
  const fails = (targetSource, pattern) => assert.throws(() => normalizeConfig(input({ targetSource })), pattern);
  fails(null, /targetSource must be an object/);
  fails({ source: 'manifest', side: 'styleguide' }, /must be "styleguide"/);
  fails({ source: 'styleguide' }, /targetSource.side must be a safe ID/);
  fails({ source: 'styleguide', side: 'nope' }, /unknown side nope/);
  fails({ source: 'styleguide', side: 'styleguide', extra: 1 }, /targetSource.extra is unsupported/);
  for (const mount of ['styleguide', '//evil.example', '/a/../b', '/a b', '/a?x=1', '/a#x', 7, '']) fails({ source: 'styleguide', side: 'styleguide', mount }, /mount must be an origin-relative path/);
  fails({ source: 'styleguide', side: 'styleguide', include: [] }, /include must have 1\.\./);
  fails({ source: 'styleguide', side: 'styleguide', include: ['a', 'a'] }, /IDs must be unique/);
  fails({ source: 'styleguide', side: 'styleguide', include: ['../a'] }, /safe ID/);
  assert.throws(() => normalizeConfig(input({ targets: [{ id: 'home', kind: 'page', path: '/' }] })), /absent or empty/);
  assert.throws(() => normalizeConfig({ ...input({ sides: undefined }), sides: { styleguide: { origin: 'https://example.com', remote: true } } }), /must be a local side/);
});

test('workflow selection: --target becomes an include list and --path drops the source', () => {
  const config = normalizeConfig(input());
  assert.deepEqual(selectConfig(config, { target: 'card,button' }).targetSource.include, ['card', 'button']);
  assert.equal(selectConfig(config, { path: '/x' }).targetSource, undefined);
  assert.throws(() => selectConfig(config, { selector: '.a', suite: 'visual' }), /requires one target/);
  assert.deepEqual(normalizeConfig(selectConfig(config, { target: 'card' })).targetSource.include, ['card']);
});

test('perf: a styleguide component target is an explicit non-pass (R8.7)', () => {
  const config = normalizeConfig(input());
  assert.throws(() => planPerfCommand(config, { side: 'styleguide', targetIds: ['card'] }), /Component targets from the styleguide are unsupported/);
  const resolved = { ...config, targets: parseComponents(catalogue()).targets };
  assert.throws(() => planPerfCommand({ ...resolved, targetSource: undefined }, { side: 'styleguide', targetIds: ['card'] }), /Component targets are unsupported/);
});

test('compare: a component in only one run has state missing, never complete (R8.7)', () => {
  const capture = { targetId: 'card', viewportId: 'small', state: 'captured' };
  assert.equal(comparisonState(capture, undefined, {}, {}), 'missing');
  assert.equal(comparisonState(undefined, capture, {}, {}), 'missing');
});

const withVariants = () => [
  { id: 'hero', name: 'Hero', has_styleguide: true, has_default_variant: true, variants: [{ id: 'dark-bg', title: 'Dark background' }, { id: 'secondary', title: '' }] },
  { id: 'banner', name: 'Banner', has_styleguide: true, has_default_variant: false, variants: [{ id: 'wide', title: 'Wide' }] },
  { id: 'card', name: 'Card', has_styleguide: true, has_default_variant: false, variants: [] },
  { id: 'hero--x', has_styleguide: false },
];
const pageList = () => [{ id: 'home', name: 'Home', has_styleguide: true, has_default_variant: true, variants: [{ id: 'empty', title: 'Empty' }] }, { id: 'blog', name: 'Blog', has_styleguide: false }];

test('parseComponents: variants are off by default and an old catalogue reads the same (R5.1)', () => {
  const plain = parseComponents(withVariants());
  assert.deepEqual(plain.targets.map(target => target.id), ['banner', 'card', 'hero']);
  assert.deepEqual(parseComponents(withVariants(), { variants: false }), plain);
});

test('parseComponents: variants add one target for each variant, with the variant in the path (R13.52)', () => {
  const { targets, noFixture } = parseComponents(withVariants(), { variants: true });
  assert.deepEqual(targets.map(target => target.id), ['banner--wide', 'card', 'hero', 'hero--dark-bg', 'hero--secondary']);
  const dark = targets.find(target => target.id === 'hero--dark-bg');
  assert.deepEqual(dark, { id: 'hero--dark-bg', kind: 'component', title: 'Hero / Dark background', path: '/styleguide/render/component/hero?canvas&variant=dark-bg' });
  assert.equal(targets.find(target => target.id === 'hero--secondary').title, 'Hero / secondary', 'An empty variant title falls back to the variant ID.');
  // No default fixture, so no default tile: the grid shows none and the default render would fall back to the bare template.
  assert.equal(targets.some(target => target.id === 'banner'), false);
  assert.equal(targets.find(target => target.id === 'card').path, '/styleguide/render/component/card?canvas', 'No variants: the default target stays.');
  assert.deepEqual(noFixture, ['hero--x']);
});

test('parseComponents: a bad variant list or a repeated or long target ID stops the read (R13.52)', () => {
  const fails = (payload, pattern) => assert.throws(() => parseComponents(payload, { variants: true }), error => error.code === 'STYLEGUIDE_CATALOGUE_INVALID' && pattern.test(error.message));
  fails([{ id: 'a', variants: [{ id: 'Bad Id' }] }], /variant with no usable ID/);
  fails([{ id: 'a', variants: [{ id: '../x' }] }], /variant with no usable ID/);
  fails([{ id: 'a', variants: [{ id: 'x' }, { id: 'x' }] }], /variant with no usable ID/);
  fails([{ id: 'a', variants: 'x' }], /not a list/);
  fails([{ id: 'a', variants: Array.from({ length: 101 }, (_, index) => ({ id: `v${index}` })) }], /not a list/);
  fails([{ id: 'a'.repeat(63), variants: [{ id: 'x' }] }], /longer than 64/);
  fails([{ id: 'a', variants: [{ id: 'b' }] }, { id: 'a--b' }], /repeated or longer/);
  // A bad variant list in a catalogue that does not ask for variants is not read.
  assert.doesNotThrow(() => parseComponents([{ id: 'a', variants: 'x' }]));
});

test('parseComponents: pages are opt-in, kind page, and never collide with a component (R13.52)', () => {
  const same = [{ id: 'home', name: 'Home Component', has_styleguide: true }];
  assert.deepEqual(parseComponents(same, { pages: undefined }).targets.map(target => target.id), ['home']);
  const { targets, noFixture } = parseComponents(same, { pages: pageList(), variants: true });
  assert.deepEqual(targets.map(target => [target.id, target.kind]), [['home', 'component'], ['page--home', 'page'], ['page--home--empty', 'page']]);
  assert.equal(targets.find(target => target.id === 'page--home').path, '/styleguide/render/page/home?canvas');
  assert.equal(targets.find(target => target.id === 'page--home--empty').path, '/styleguide/render/page/home?canvas&variant=empty');
  assert.deepEqual(noFixture, ['page--blog']);
  assert.deepEqual(parseComponents(same, { pages: [] }).targets.map(target => target.id), ['home'], 'An empty page list is not an error.');
  assert.throws(() => parseComponents(same, { pages: {} }), error => /page list is not an array/.test(error.message));
  assert.throws(() => parseComponents(same, { pages: [{ id: 'a'.repeat(60) }] }), /longer than 64/);
  assert.throws(() => parseComponents(same, { pages: [{ id: '../x' }] }), /page\(s\) with no usable ID/);
});

test('parseComponents: include names targets, a component also selects its variants (R13.52)', () => {
  const options = { variants: true, pages: pageList() };
  const ids = include => parseComponents(withVariants(), { ...options, include }).targets.map(target => target.id);
  assert.deepEqual(ids(['hero']), ['hero', 'hero--dark-bg', 'hero--secondary']);
  assert.deepEqual(ids(['hero--dark-bg']), ['hero--dark-bg']);
  assert.deepEqual(ids(['page--home']), ['page--home', 'page--home--empty']);
  assert.deepEqual(ids(['page--home--empty', 'card']), ['card', 'page--home--empty']);
  assert.throws(() => parseComponents(withVariants(), { ...options, include: ['hero--gone'] }), error => error.code === 'STYLEGUIDE_COMPONENT_UNKNOWN');
  // A variant or page ID is unknown while its option is off.
  assert.throws(() => parseComponents(withVariants(), { include: ['hero--dark-bg'] }), error => error.code === 'STYLEGUIDE_COMPONENT_UNKNOWN');
  assert.throws(() => parseComponents(withVariants(), { include: ['page--home'] }), error => error.code === 'STYLEGUIDE_COMPONENT_UNKNOWN');
  // A page with no fixture named in include is skipped and listed, not unknown.
  assert.deepEqual(parseComponents(withVariants(), { ...options, include: ['card', 'page--blog'] }).noFixture, ['page--blog']);
});

test('readComponents: pages and variants add one GET for the page list only (R13.52)', async () => {
  const urls = [];
  const get = async url => { urls.push(url); return { status: 200, body: JSON.stringify(url.endsWith('/api/pages') ? pageList() : withVariants()) }; };
  await readComponents({ origin: 'http://localhost:8080', variants: true, get });
  assert.deepEqual(urls, ['http://localhost:8080/styleguide/api/components']);
  urls.length = 0;
  const result = await readComponents({ origin: 'http://localhost:8080', variants: true, pages: true, get });
  assert.deepEqual(urls, ['http://localhost:8080/styleguide/api/components', 'http://localhost:8080/styleguide/api/pages']);
  assert.ok(result.targets.some(target => target.id === 'page--home--empty'));
  assert.equal(pagesUrl('http://localhost:8080', '/tools/ui'), 'http://localhost:8080/tools/ui/api/pages');
  await assert.rejects(readComponents({ origin: 'http://localhost:8080', pages: true, get: async url => url.endsWith('/api/pages') ? { status: 404, body: '' } : { status: 200, body: '[{"id":"a"}]' } }),
    error => error.code === 'STYLEGUIDE_CATALOGUE_UNREACHABLE' && /page list answers HTTP 404/.test(error.message));
});

test('config: targetSource variants and pages are optional booleans (R13.52)', () => {
  const source = extra => input({ targetSource: { source: 'styleguide', side: 'styleguide', ...extra } });
  assert.deepEqual(normalizeConfig(source({ variants: true, pages: true })).targetSource, { source: 'styleguide', side: 'styleguide', mount: '/styleguide', variants: true, pages: true });
  assert.deepEqual(normalizeConfig(source({ variants: false })).targetSource, normalizeConfig(input()).targetSource, 'false equals absent.');
  for (const key of ['variants', 'pages']) for (const value of ['yes', 1, null]) assert.throws(() => normalizeConfig(source({ [key]: value })), new RegExp(`targetSource.${key} must be a boolean`));
  const normalized = normalizeConfig(source({ variants: true, pages: true }));
  assert.deepEqual(normalizeConfig(JSON.parse(JSON.stringify(normalized))), normalized);
  assert.deepEqual(selectConfig(normalized, { target: 'hero--dark-bg,page--home' }).targetSource.include, ['hero--dark-bg', 'page--home']);
});

test('parseComponents: the expanded target list has the same 1000 limit as the config (R13.52)', () => {
  const big = Array.from({ length: 11 }, (_, index) => ({ id: `c${index}`, variants: Array.from({ length: 100 }, (__, v) => ({ id: `v${v}` })) }));
  assert.throws(() => parseComponents(big, { variants: true }), error => error.code === 'STYLEGUIDE_CATALOGUE_INVALID' && /makes 1111 targets/.test(error.message));
  assert.equal(parseComponents(big, { variants: true, include: ['c0', 'c1'] }).targets.length, 202, 'include narrows below the limit.');
  assert.equal(parseComponents(big).targets.length, 11, 'Without variants the list is not expanded.');
  assert.throws(() => parseComponents([{ id: 'a' }], { pages: Array.from({ length: 1000 }, (_, index) => ({ id: `p${index}` })) }), /makes 1001 targets/);
});
