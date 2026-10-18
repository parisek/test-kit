import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveChecks, runChecks, detectMajor, bundleBannerVersion, lockfileVersion, defineContractSet, defineVersionedPack, selectContractSet } from '../../src/packs/index.js';
import { swiperPack, swiperSets } from '../../src/packs/versioned/swiper.js';

const load = name => JSON.parse(readFileSync(new URL(`../fixtures/contracts/${name}.json`, import.meta.url), 'utf8'));
const dom = load('swiper-dom');
const plan = () => resolveChecks({ available: [swiperPack], packs: ['swiper'] });
const run = (value, swiper, extra = {}) => runChecks(plan(), { artifact: 'behavior', value }, { targetId: 'example-site', components: ['swiper'], versions: { swiper }, ...extra });
const states = result => Object.fromEntries(Object.entries(result.checks).map(([id, item]) => [id, item.state]));

test('detectMajor reads exact versions and records the source (R13.42)', () => {
  assert.deepEqual(detectMajor({ version: '12.2.0', source: 'lockfile' }), { state: 'detected', major: 12, version: '12.2.0', source: 'lockfile' });
  assert.equal(detectMajor({ version: 'v14.3.0', source: 'bundle-banner' }).major, 14);
  assert.equal(detectMajor({ version: '14', source: 'config' }).major, 14);
  assert.deepEqual(detectMajor({ version: 12, source: 'config' }), { state: 'detected', major: 12, version: '12', source: 'config' });
  assert.ok(Object.isFrozen(detectMajor({ version: '12.0.0', source: 'lockfile' })));
});

test('detectMajor gives unknown for everything it cannot prove (R8.7)', () => {
  const bad = [
    { version: '^12.0.0', source: 'lockfile' }, { version: '~12', source: 'lockfile' }, { version: '>=12', source: 'lockfile' }, { version: '14.0.0-beta.2', source: 'lockfile' },
    { version: 'latest', source: 'lockfile' }, { version: '', source: 'lockfile' }, { version: ' 12.0.0', source: 'lockfile' }, { version: '012.0.0', source: 'lockfile' },
    { version: '12.2.0.1', source: 'lockfile' }, { version: '99999.0.0', source: 'lockfile' }, { version: 12.5, source: 'config' }, { version: -1, source: 'config' },
    { version: NaN, source: 'config' }, { version: null, source: 'lockfile' }, { version: undefined, source: 'lockfile' }, { version: ['12'], source: 'lockfile' },
    { version: '12.2.0', source: 'page-global' }, { version: '12.2.0' }, { version: '12.2.0', source: 'LOCKFILE' }, null, undefined, 'x', 12,
  ];
  for (const input of bad) {
    const result = detectMajor(input);
    assert.equal(result.state, 'unknown', JSON.stringify(input));
    assert.equal(result.major, null);
    assert.ok(result.diagnostic);
  }
});

test('detectMajor reads only own enumerable data fields, once', () => {
  const inherited = Object.create({ version: '12.2.0', source: 'lockfile' });
  assert.equal(detectMajor(inherited).state, 'unknown');
  assert.equal(selectContractSet(swiperSets, inherited).state, 'unknown');
  assert.equal(detectMajor(Object.create({ version: '12.2.0' }, { source: { value: 'lockfile', enumerable: true } })).state, 'unknown');
  let reads = 0;
  assert.equal(detectMajor({ get version() { reads += 1; return '12.0.0'; }, source: 'lockfile' }).state, 'unknown');
  assert.equal(reads, 0);
  assert.equal(detectMajor(Object.defineProperties({}, { version: { value: '12.0.0' }, source: { value: 'lockfile' } })).state, 'unknown'); // not enumerable
  const bare = Object.assign(Object.create(null), { version: '14.3.0', source: 'lockfile' });
  assert.equal(detectMajor(bare).major, 14);
});

test('helpers read the banner of a bundle and a lockfile', () => {
  const banner = '/**\n * Swiper 14.3.0\n * Most modern mobile touch slider\n */\n';
  assert.deepEqual(bundleBannerVersion(banner, 'Swiper'), { version: '14.3.0', source: 'bundle-banner' });
  assert.equal(bundleBannerVersion('var a = 1;', 'Swiper'), null);
  assert.equal(bundleBannerVersion(banner, '(a+)+'), null);
  assert.equal(bundleBannerVersion('/*\n * Other 14.3.0\n', 'Swiper'), null);
  const hostile = `/*${' \t'.repeat(1000)}x`;
  const started = performance.now();
  assert.equal(bundleBannerVersion(hostile, 'Swiper'), null);
  assert.ok(performance.now() - started < 200, 'the banner parse is linear');
  assert.deepEqual(lockfileVersion(load('swiper-lock'), 'swiper'), { version: '14.3.0', source: 'lockfile' });
  assert.equal(lockfileVersion(load('swiper-lock'), 'gsap'), null);
  assert.equal(lockfileVersion({ packages: { 'node_modules/swiper': {} } }, 'swiper'), null);
  assert.equal(lockfileVersion(null, 'swiper'), null);
  const nested = major => ({ packages: { 'node_modules/swiper': { version: '14.3.0' }, 'node_modules/other/node_modules/swiper': { version: `${major}.0.0` } } });
  assert.equal(lockfileVersion(nested(14), 'swiper').version, '14.3.0');
  assert.equal(lockfileVersion(nested(12), 'swiper'), null); // a second copy of another major leaves the version unknown
  assert.equal(lockfileVersion({ packages: { 'node_modules/xswiper': { version: '1.0.0' }, 'node_modules/swiper': { version: '14.3.0' } } }, 'swiper').version, '14.3.0');
});

test('Swiper 12 and 14 sets are keyed by major, name an owner and run side by side', () => {
  assert.deepEqual(swiperSets.map(item => item.major), [12, 14]);
  for (const set of swiperSets) { assert.equal(set.owner, 'test-kit'); assert.equal(set.status, 'verified'); assert.ok(set.sources.length > 0); }
  assert.equal(swiperPack.owner, 'test-kit');
  for (const [version, major] of [['12.2.0', 12], ['14.3.0', 14]]) {
    const result = run(dom.good, { version, source: 'lockfile' });
    assert.equal(result.state, 'complete', version);
    const info = result.findings.find(item => item.checkId === 'swiper-version');
    assert.equal(info.evidence.major, major);
    assert.equal(info.evidence.detectedVersion, version);
    assert.equal(info.evidence.source, 'lockfile');
    assert.equal(info.layer, 'package');
  }
});

test('a contract finding records the set, the detected version and the source', () => {
  const result = run(dom.noActive, { version: '14.3.0', source: 'bundle-banner' });
  const finding = result.findings.find(item => item.checkId === 'swiper-active-slide');
  assert.equal(finding.severity, 'error');
  assert.equal(finding.evidence.contractSet.major, 14);
  assert.equal(finding.evidence.contractSet.detectedVersion, '14.3.0');
  assert.equal(finding.evidence.contractSet.source, 'bundle-banner');
  assert.equal(finding.evidence.contractSet.owner, 'test-kit');
  assert.equal(result.state, 'complete'); // the check ran; the finding is the failure signal
  const structure = run(dom.notInitialized, { version: '12.2.0', source: 'lockfile' }).findings.filter(item => item.checkId === 'swiper-structure');
  assert.equal(structure.length, 2);
  assert.match(structure.map(item => item.message).join(' '), /swiper-initialized/);
});

test('an unknown or unsupported version never passes and no contract runs (R8.7)', () => {
  const cases = [undefined, null, { version: '^12.0.0', source: 'lockfile' }, { version: '13.0.0', source: 'lockfile' }, { version: '11.2.10', source: 'lockfile' }, { version: '15.0.0', source: 'lockfile' }, { version: '12.2.0', source: 'page-global' }, { version: '14.0.0-beta.2', source: 'lockfile' }];
  for (const swiper of cases) {
    const result = run(dom.good, swiper);
    assert.notEqual(result.state, 'complete', JSON.stringify(swiper));
    assert.deepEqual(states(result), { 'swiper-version': 'missing', 'swiper-structure': 'missing', 'swiper-active-slide': 'missing' });
    assert.ok(result.findings.every(item => item.severity === 'error' && item.evidence.state === 'unknown'));
    assert.ok(result.findings.every(item => !item.evidence.contractSet));
    assert.ok(result.findings.every(item => Array.isArray(item.evidence.supportedMajors)));
    assert.match(result.checks['swiper-version'].diagnostic, /incomplete or unknown/);
  }
  assert.match(run(dom.good, { version: '13.0.0', source: 'lockfile' }).findings[0].message, /Supported majors: 12, 14/);
});

test('missing facts, no instance and a missing component list never pass', () => {
  const ok = { version: '12.2.0', source: 'lockfile' };
  assert.equal(run(dom.empty, ok).checks['swiper-structure'].state, 'missing');
  assert.equal(run({ instances: [{ id: 'x' }] }, ok).checks['swiper-structure'].state, 'missing');
  assert.equal(run({ instances: [{ id: 'x', containerClasses: 'swiper', wrapperClasses: [], slides: [] }] }, ok).checks['swiper-structure'].state, 'missing');
  assert.equal(run(null, ok).state, 'missing');
  const noComponents = runChecks(plan(), { artifact: 'behavior', value: dom.good }, { targetId: 'example-site', versions: { swiper: ok } });
  assert.equal(noComponents.state, 'missing');
  const other = runChecks(plan(), { artifact: 'behavior', value: dom.good }, { targetId: 'example-site', components: ['gsap'], versions: { swiper: ok } });
  assert.deepEqual(other.checks, {});
});

test('the pack runs nothing unless the project selects it (R5.1)', () => {
  const none = resolveChecks({ available: [swiperPack] });
  assert.equal(runChecks(none, { artifact: 'behavior', value: dom.good }, { components: ['swiper'] }).state, 'missing');
});

test('a placeholder set cannot pass', () => {
  const holder = major => defineContractSet({ library: 'example-lib', major, owner: 'example-owner', status: 'placeholder', facts: {}, contracts: [{ id: 'basic', title: 'Basic', check: () => [] }] });
  const pack = defineVersionedPack({ id: 'example-lib', title: 'Example', owner: 'example-owner', library: 'example-lib', sets: [holder(1), holder(2)] });
  const result = runChecks(resolveChecks({ available: [pack], packs: ['example-lib'] }), { artifact: 'behavior', value: {} }, { targetId: 'example-site', components: ['example-lib'], versions: { 'example-lib': { version: '2.0.0', source: 'config' } } });
  assert.equal(result.checks['example-lib-basic'].state, 'missing');
  assert.equal(result.checks['example-lib-version'].state, 'complete');
  assert.equal(result.state, 'missing');
  assert.match(result.findings.find(item => item.checkId === 'example-lib-basic').message, /placeholder/);
  assert.match(result.findings.find(item => item.checkId === 'example-lib-version').message, /placeholder/);
  assert.doesNotMatch(result.findings.find(item => item.checkId === 'example-lib-version').message, /applies/);
});

test('set and pack definitions fail closed', () => {
  const base = { library: 'example-lib', major: 1, owner: 'example-owner', status: 'verified', verifiedAgainst: '1.0.0', sources: ['https://example.com/docs'], facts: {}, contracts: [{ id: 'a', title: 'A', check: () => [] }] };
  const set = (major, ids = ['a']) => ({ ...base, major, verifiedAgainst: `${major}.0.0`, contracts: ids.map(id => ({ id, title: id, check: () => [] })) });
  assert.ok(Object.isFrozen(defineContractSet(base)));
  for (const bad of [{ ...base, owner: '' }, { ...base, owner: undefined }, { ...base, major: 1.5 }, { ...base, major: '1' }, { ...base, status: 'guess' }, { ...base, verifiedAgainst: '' }, { ...base, sources: [] },
    { ...base, library: 'Bad Name' }, { ...base, owner: 'TODO' }, { ...base, owner: 'tbd' }, { ...base, verifiedAgainst: '2.0.0' }, { ...base, verifiedAgainst: '1.0.0-beta.1' }, { ...base, verifiedAgainst: '1' }, { ...base, sources: ['ok', 5] }, { ...base, contracts: [] }, { ...base, contracts: [{ id: 'a', title: 'A', check: () => [] }, { id: 'a', title: 'A', check: () => [] }] }, { ...base, contracts: [{ id: 'a', title: 'A' }] }, null]) {
    assert.throws(() => defineContractSet(bad));
  }
  const make = sets => defineVersionedPack({ id: 'example-lib', title: 'Example', owner: 'example-owner', library: 'example-lib', sets });
  assert.ok(make([set(1), set(2)]));
  assert.throws(() => make([set(1), set(1)]), /one major/);
  assert.throws(() => make([set(1), set(2, ['a', 'b'])]), /same contract ids/);
  assert.throws(() => make([{ ...set(1), library: 'other-lib' }]), /must be for/);
  assert.throws(() => make([]), /needs contract sets/);
  const retitled = set(2); retitled.contracts = [{ id: 'a', title: 'Other title', check: () => [] }];
  assert.throws(() => make([set(1), retitled]), /different title/);
  assert.throws(() => defineVersionedPack({ id: 'example-lib', title: 'Example', owner: 'TBD', library: 'example-lib', sets: [set(1)] }), /owner/);
});

test('definitions read each caller field and list once', () => {
  const base = { library: 'example-lib', major: 1, owner: 'example-owner', status: 'verified', verifiedAgainst: '1.0.0', facts: {}, contracts: [{ id: 'a', title: 'A', check: () => [] }] };
  let reads = 0;
  const sources = [];
  Object.defineProperty(sources, 0, { get() { reads += 1; return reads === 1 ? 'https://example.com/docs' : { evil: true }; }, enumerable: true });
  const made = defineContractSet({ ...base, sources });
  assert.deepEqual(made.sources, ['https://example.com/docs']);
  assert.equal(reads, 1);
  let titleReads = 0;
  const contract = { id: 'a', check: () => [], get title() { titleReads += 1; return titleReads === 1 ? 'A' : ''; } };
  assert.equal(defineContractSet({ ...base, sources: ['x'], contracts: [contract] }).contracts[0].title, 'A');
});

test('selectContractSet never falls back to another major', () => {
  const found = selectContractSet(swiperSets, { version: '14.0.0', source: 'config' });
  assert.equal(found.state, 'selected');
  assert.equal(found.set.major, 14);
  assert.equal(selectContractSet(swiperSets, { version: '13.9.9', source: 'config' }).state, 'unsupported');
  assert.equal(selectContractSet(swiperSets, { version: 'next', source: 'config' }).state, 'unknown');
});

test('the active-slide contract stands alone: zero slides are missing, not one active is an error', () => {
  const ok = { version: '14.3.0', source: 'lockfile' };
  const inst = slides => ({ instances: [{ id: 'x', containerClasses: ['swiper-initialized'], wrapperClasses: ['swiper-wrapper'], slides: slides.map(active => ({ classes: active ? ['swiper-slide', 'swiper-slide-active'] : ['swiper-slide'] })) }] });
  const check = value => run(value, ok).checks['swiper-active-slide'].state;
  assert.equal(check(inst([])), 'missing');
  assert.equal(run(inst([]), ok).findings.find(item => item.checkId === 'swiper-active-slide').evidence.state, 'incomplete');
  assert.equal(run(inst([false]), ok).findings.filter(item => item.checkId === 'swiper-active-slide' && item.severity === 'error').length, 1);
  assert.equal(run(inst([false, false]), ok).findings.filter(item => item.checkId === 'swiper-active-slide').length, 1);
  assert.equal(run(inst([true, true]), ok).findings.filter(item => item.checkId === 'swiper-active-slide').length, 1);
  assert.equal(run(inst([false, true]), ok).findings.filter(item => item.checkId === 'swiper-active-slide').length, 0);
  assert.equal(check(inst([false, true])), 'complete');
});

test('set facts are a plain object and deeply frozen', () => {
  const base = { library: 'example-lib', major: 1, owner: 'example-owner', status: 'placeholder', contracts: [{ id: 'a', title: 'A', check: () => [] }] };
  for (const bad of [[], new Map(), 'x', null, new Date()]) assert.throws(() => defineContractSet({ ...base, facts: bad }), /plain object/);
  const input = { nested: { list: ['a'] } };
  const made = defineContractSet({ ...base, facts: input });
  assert.ok(Object.isFrozen(made.facts.nested) && Object.isFrozen(made.facts.nested.list));
  assert.throws(() => { made.facts.nested.list.push('b'); }, TypeError);
  input.nested.list.push('c');
  assert.deepEqual(made.facts.nested.list, ['a']);
  assert.ok(Object.isFrozen(swiperSets[0].facts));
});

test('set facts must be JSON-like data, checked before the clone', () => {
  const base = { library: 'example-lib', major: 3, owner: 'example-owner', status: 'placeholder', contracts: [{ id: 'a', title: 'A', check: () => [] }] };
  class Box {}
  const cyc = { a: {} }; cyc.a.back = cyc;
  let deep = {}; for (let i = 0; i < 3000; i += 1) deep = { d: deep };
  const cases = [
    [{ m: new Map() }, /Set example-lib 3 facts: m is a Map/], [{ s: new Set() }, /s is a Set/], [{ d: new Date() }, /d is a Date/], [{ t: new Uint8Array(2) }, /t is a Uint8Array/],
    [{ b: new Box() }, /b is a Object|b is a Box|b is a/], [{ f() {} }, /f is a function/], [cyc, /cycle/], [deep, /nested deeper than 256/],
  ];
  for (const [facts, message] of cases) assert.throws(() => defineContractSet({ ...base, facts }), error => error instanceof Error && !(error instanceof RangeError) && message.test(error.message), String(message));
  assert.ok(defineContractSet({ ...base, facts: { ok: [1, { a: 'b' }] } }));
});

test('earlier error findings stay when a later instance is incomplete', () => {
  const ok = { version: '12.2.0', source: 'lockfile' };
  const bad = { id: 'one', containerClasses: [], wrapperClasses: null, slides: [{ classes: ['swiper-slide'] }] };
  const value = { instances: [bad, { id: 'two', containerClasses: 'oops', wrapperClasses: [], slides: [] }] };
  const structure = run(value, ok).findings.filter(item => item.checkId === 'swiper-structure');
  assert.equal(structure.length, 3);
  assert.equal(structure.filter(item => item.severity === 'error' && item.evidence.state === undefined).length, 2);
  assert.equal(structure.at(-1).evidence.state, 'incomplete');
  const active = run({ instances: [{ ...bad, slides: [{ classes: ['swiper-slide'] }] }, { id: 'two', slides: [] }] }, ok).findings.filter(item => item.checkId === 'swiper-active-slide');
  assert.equal(active.length, 2);
  assert.equal(active[0].evidence.actual, 0);
  assert.equal(active[1].evidence.state, 'incomplete');
});
