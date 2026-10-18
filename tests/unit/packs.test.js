import test from 'node:test';
import assert from 'node:assert/strict';
import { definePack, resolveChecks, runChecks, LAYERS } from '../../src/packs/index.js';
import { MAX_DEPTH } from '../../src/packs/snapshot.js';
import { examplePack, titleCheck, throwingCheck } from '../fixtures/packs/example-pack.js';

const input = (value = { title: '' }) => ({ artifact: 'content', value });
const mk = (id, extra = {}) => ({ id, title: id, basis: 'absolute', applies: { artifacts: ['content'] }, check: () => [], ...extra });
const fnd = (message, extra = {}) => ({ severity: 'warning', message, evidence: {}, ...extra });
const ctx = { targetId: 'example-site' };
const plan = (extra = {}) => resolveChecks({ available: [examplePack], packs: ['example-pack'], ...extra });

test('a pack needs the R7.2 shape and a named owner', () => {
  assert.deepEqual(LAYERS, ['package', 'project', 'component', 'page']);
  assert.ok(Object.isFrozen(examplePack));
  for (const bad of [{ ...examplePack, owner: '' }, { ...examplePack, checks: [] }, { id: 'x', title: 'x', owner: 'o', checks: [{ ...titleCheck, basis: undefined }] },
    { id: 'x', title: 'x', owner: 'o', checks: [{ ...titleCheck, applies: {} }] }, { id: 'x', title: 'x', owner: 'o', checks: [mk('a'), mk('a')] }, { id: 'Bad Id', title: 'x', owner: 'o', checks: [mk('a')] }]) assert.throws(() => definePack(bad));
});

test('nothing runs unless a project selects the pack (R5.1)', () => {
  const none = resolveChecks({ available: [examplePack] });
  assert.equal(none.checks.length, 0);
  const result = runChecks(none, input());
  assert.deepEqual(result.findings, []);
  assert.equal(result.state, 'missing');
  assert.throws(() => resolveChecks({ available: [examplePack], packs: ['nope'] }), /Unknown pack/);
  assert.throws(() => resolveChecks({ available: [examplePack], packs: ['example-pack', 'example-pack'] }), /Duplicate/);
  assert.throws(() => resolveChecks({ available: [examplePack, examplePack] }), /Duplicate pack/);
});

test('every finding names its layer, and a custom rule uses the same shape', () => {
  const custom = [{ layer: 'project', check: mk('project-rule', { check: () => [fnd('Project rule fired.')] }) }];
  const result = runChecks(resolveChecks({ available: [examplePack], packs: ['example-pack'], custom }), input(), ctx);
  const byCheck = Object.fromEntries(result.findings.map(f => [f.checkId, f]));
  assert.equal(byCheck['example-title'].layer, 'package');
  assert.equal(byCheck['project-rule'].layer, 'project');
  assert.equal(byCheck['project-rule'].checkId, 'project-rule');
  assert.equal(result.checks['project-rule'].state, 'complete');
});

test('a duplicate id is rejected across layers and shadowing is not possible', () => {
  assert.throws(() => plan({ custom: [{ layer: 'project', check: mk('example-title') }] }), /Duplicate check id/);
  assert.throws(() => resolveChecks({ custom: [{ layer: 'project', check: mk('a') }, { layer: 'page', check: mk('a') }] }), /Duplicate check id/);
  assert.throws(() => resolveChecks({ custom: [{ layer: 'package', check: mk('a') }] }));
});

test('layer precedence: only a narrower layer may switch a check off, with reason and owner (R8.13)', () => {
  const ov = (extra = {}) => ({ checkId: 'example-title', layer: 'project', reason: 'Legacy page.', owner: 'example-owner', ...extra });
  assert.throws(() => plan({ overrides: [ov({ layer: 'package' })] }), /narrower/);
  assert.throws(() => plan({ overrides: [ov({ reason: '' })] }), /reason/);
  assert.throws(() => plan({ overrides: [ov({ owner: undefined })] }), /owner/);
  assert.throws(() => plan({ overrides: [ov({ checkId: 'ghost' })] }), /unknown check/);
  assert.throws(() => plan({ overrides: [ov({ scope: { colours: ['red'] } })] }), /scope/);
  assert.throws(() => plan({ custom: [{ layer: 'page', check: mk('page-rule') }], overrides: [ov({ checkId: 'page-rule' })] }), /narrower/);
  const off = plan({ overrides: [ov({ layer: 'page', scope: { targets: ['example-site'] } })] });
  const hit = runChecks(off, input(), { targetId: 'example-site' });
  assert.equal(hit.checks['example-title'].state, 'missing');
  assert.match(hit.checks['example-title'].diagnostic, /Legacy page\..*example-owner/);
  assert.equal(hit.checks['example-title'].layer, 'package');
  assert.equal(hit.overrides.length, 1);
  assert.equal(hit.findings.filter(f => f.checkId === 'example-title').length, 0);
  assert.notEqual(hit.state, 'complete');
  const miss = runChecks(off, input(), { targetId: 'other-site' });
  assert.equal(miss.overrides.length, 0, 'an override outside its scope has no effect (R8.2)');
  assert.equal(miss.findings.some(f => f.checkId === 'example-title'), true);
});

test('fail closed: a check that throws gives no finding and a failed state (R8.7)', () => {
  const result = runChecks(plan(), input({ title: 'Present' }), { targetId: 'example-site' });
  assert.equal(result.checks['example-throws'].state, 'failed');
  assert.match(result.checks['example-throws'].diagnostic, /boom/);
  assert.equal(result.checks['example-title'].state, 'complete');
  assert.equal(result.findings.length, 0);
  assert.equal(result.state, 'failed', 'an empty findings list is not a pass');
  const only = runChecks(resolveChecks({ custom: [{ layer: 'project', check: mk('ok') }] }), input({ title: 'x' }));
  assert.equal(only.state, 'complete');
});

test('fail closed: bad return values, promises and bad finding shapes never pass', () => {
  const run = check => runChecks(resolveChecks({ custom: [{ layer: 'project', check: mk('c', { check }) }] }), input({ title: 'x' }), ctx);
  const sparse = [fnd('m')]; sparse.length = 3;
  const getter = { severity: 'info', evidence: {} }; Object.defineProperty(getter, 'message', { enumerable: true, get() { throw new Error('getter'); } });
  const bad = [() => 'ok', () => undefined, () => Promise.resolve([]), () => Promise.reject(new Error('late')), () => [{ severity: 'info' }], () => [{ message: 'm' }],
    () => [fnd('m', { severity: 'loud' })], () => [fnd('m', { evidence: undefined })], () => [fnd('m', { checkId: 'other' })], () => [fnd('m', { artifact: 'html' })],
    () => [fnd('m', { extra: 1 })], () => [fnd('')], () => [fnd('x'.repeat(1001))], () => [fnd('m', { evidence: { text: 'x'.repeat(10001) } })],
    () => new Array(3), () => [, fnd('m')], () => sparse, () => [getter], () => [fnd('m', { evidence: { get a() { throw new Error('g'); } } })],
    () => [new Proxy({}, { ownKeys() { throw new Error('p'); } })]];
  for (const check of bad) {
    const result = run(check);
    assert.equal(result.checks.c.state, 'failed', String(check));
    assert.deepEqual(result.findings, []);
    assert.equal(result.state, 'failed');
  }
  assert.equal(run(() => [fnd('m', { evidence: { state: 'incomplete' } })]).checks.c.state, 'missing');
  assert.equal(run(() => [fnd('m', { evidence: { state: 'unknown' } })]).checks.c.state, 'missing');
  assert.equal(run(() => [fnd('m')]).checks.c.state, 'complete');
  assert.equal(runChecks(resolveChecks({ custom: [{ layer: 'project', check: mk('c', { check: () => [fnd('m')] }) }] }), input({ title: 'x' })).checks.c.state, 'failed', 'no targetId');
  const empty = runChecks(plan(), { artifact: 'content', value: null });
  assert.equal(empty.state, 'missing');
  assert.equal(empty.checks['example-title'].state, 'missing');
  assert.throws(() => runChecks({}, input()));
  assert.throws(() => runChecks(plan(), {}));
});

test('one bad check fails alone and the others keep their results', () => {
  const p = resolveChecks({ custom: [
    { layer: 'project', check: mk('good', { check: () => [fnd('good finding')] }) },
    { layer: 'project', check: mk('bad', { check: () => [{ get message() { throw new Error('x'); } }] }) }] });
  const result = runChecks(p, input({ title: 'x' }), ctx);
  assert.equal(result.checks.bad.state, 'failed');
  assert.equal(result.checks.good.state, 'complete');
  assert.deepEqual(result.findings.map(f => f.checkId), ['good']);
  assert.ok(Object.isFrozen(result.findings[0]));
});

test('a hand-built plan is rejected', () => {
  const handmade = { checks: [{ check: mk('c'), layer: 'package', packId: null }], overrides: [] };
  assert.throws(() => runChecks(handmade, input()), /resolveChecks/);
  assert.throws(() => runChecks({ ...plan() }, input()), /resolveChecks/);
});

test('a check cannot change the stored input', () => {
  const value = { title: 'x', list: [1] };
  const p = resolveChecks({ custom: [{ layer: 'project', check: mk('mut', { check: v => { v.list.push(2); return []; } }) }] });
  const result = runChecks(p, { artifact: 'content', value }, ctx);
  assert.equal(result.checks.mut.state, 'failed');
  assert.deepEqual(value, { title: 'x', list: [1] });
});

test('an override never hides missing input (R8.13)', () => {
  const p = plan({ overrides: [{ checkId: 'example-title', layer: 'page', reason: 'Legacy page.', owner: 'example-owner' }] });
  const result = runChecks(p, { artifact: 'content', value: null }, ctx);
  assert.equal(result.checks['example-title'].state, 'missing');
  assert.match(result.checks['example-title'].diagnostic, /no input.*Switched off/i);
  assert.equal(result.overrides.length, 1);
  assert.equal(result.state, 'missing');
  const rel = resolveChecks({ custom: [{ layer: 'project', check: mk('rel', { basis: 'relative' }) }], overrides: [{ checkId: 'rel', layer: 'page', reason: 'r', owner: 'o' }] });
  assert.match(runChecks(rel, input({}), ctx).checks.rel.diagnostic, /context\.before.*Switched off/);
});

test('override scope reads own keys only and fails closed', () => {
  const ov = scope => ({ checkId: 'example-title', layer: 'page', reason: 'r', owner: 'o', scope });
  for (const scope of [Object.create({ targets: ['wanted'] }), JSON.parse('{"__proto__":["x"]}'), { constructor: ['x'] }, { targets: ['a'], extra: ['b'] },
    { [Symbol('s')]: ['a'] }, { targets: [] }, { targets: new Array(2) }, { targets: [, 'a'] }, { targets: 'a' }, [], 'targets']) {
    assert.throws(() => plan({ overrides: [ov(scope)] }), /scope/);
  }
  const hidden = {}; Object.defineProperty(hidden, 'targets', { value: ['a'], enumerable: false });
  assert.equal(plan({ overrides: [ov(hidden)] }).overrides[0].scope.targets[0], 'a');
});

test('override scope axes artifacts and kinds limit the switch-off', () => {
  const ov = scope => plan({ overrides: [{ checkId: 'example-title', layer: 'page', reason: 'r', owner: 'o', scope }] });
  const off = (p, c) => runChecks(p, input(), c).overrides.length === 1;
  assert.equal(off(ov({ artifacts: ['content'] }), ctx), true);
  assert.equal(off(ov({ artifacts: ['html'] }), ctx), false);
  assert.equal(off(ov({ kinds: ['single-run'] }), { ...ctx, kind: 'single-run' }), true);
  assert.equal(off(ov({ kinds: ['single-run'] }), { ...ctx, kind: 'pair' }), false);
  assert.equal(off(ov({ kinds: ['single-run'] }), ctx), false, 'an unknown kind does not match');
});

test('a page-layer custom check runs and names layer page', () => {
  const p = resolveChecks({ custom: [{ layer: 'page', check: mk('page-rule', { check: () => [fnd('page')] }) }] });
  assert.equal(runChecks(p, input({}), ctx).findings[0].layer, 'page');
});

test('a relative check needs a prior artifact and a check skips artifacts it does not apply to', () => {
  const rel = resolveChecks({ custom: [{ layer: 'project', check: mk('rel', { basis: 'relative', check: () => [fnd('differs')] }) }] });
  assert.equal(runChecks(rel, input({})).checks.rel.state, 'missing');
  assert.equal(runChecks(rel, input({}), { ...ctx, before: {} }).checks.rel.state, 'complete');
  const other = runChecks(rel, { artifact: 'html', value: '<p>' }, { ...ctx, before: {} });
  assert.deepEqual(other.checks, {});
  assert.equal(other.state, 'missing');
});

test('a component check runs only for a target that shows the component', () => {
  const check = mk('header-rule', { applies: { artifacts: ['content'], components: ['header'] }, check: () => [fnd('header')] });
  const p = resolveChecks({ custom: [{ layer: 'component', check }] });
  assert.equal(runChecks(p, input({}), { ...ctx, components: ['footer'] }).checks['header-rule'], undefined);
  assert.equal(runChecks(p, input({}), { ...ctx, components: ['header'] }).findings[0].layer, 'component');
  const unknown = runChecks(p, input({}), ctx);
  assert.equal(unknown.checks['header-rule'].state, 'missing');
  assert.match(unknown.checks['header-rule'].diagnostic, /context\.components/);
  assert.equal(unknown.state, 'missing');
  assert.throws(() => resolveChecks({ custom: [{ layer: 'project', check }] }));
  assert.throws(() => resolveChecks({ custom: [{ layer: 'component', check: mk('no-comp') }] }));
});

test('hostile check outputs and contexts never end complete and never hide other checks', () => {
  const good = { layer: 'project', check: mk('good', { check: () => [fnd('good finding')] }) };
  const run = (check, { value = { title: 'x' }, context = ctx, extra = [] } = {}) =>
    runChecks(resolveChecks({ custom: [{ layer: 'project', check: mk('hostile', { check }) }, good, ...extra] }), { artifact: 'content', value }, context);
  const thrownNoMessage = Object.create(null);
  const outputs = {
    'toJSON hides incomplete marker': () => [fnd('m', { evidence: { toJSON: () => [{ state: 'incomplete' }] } })],
    'toJSON returns a string': () => [fnd('m', { evidence: { toJSON: () => 'ok' } })],
    'toJSON returns null': () => [fnd('m', { evidence: { toJSON: () => null } })],
    'toJSON returns a number': () => [fnd('m', { evidence: { toJSON: () => 1 } })],
    'toJSON returns undefined': () => [fnd('m', { evidence: { toJSON: () => undefined } })],
    'toJSON throws': () => [fnd('m', { evidence: { toJSON() { throw new Error('t'); } } })],
    'whitespace-only message': () => [fnd('   ')],
    'severity getter throws': () => [{ get severity() { throw new Error('s'); }, message: 'm', evidence: {} }],
    'evidence getter throws': () => [{ severity: 'info', message: 'm', get evidence() { throw new Error('e'); } }],
    'proxy finding': () => [new Proxy({}, { getPrototypeOf() { throw new Error('p'); } })],
    'sparse list': () => { const list = [fnd('m')]; list.length = 2; return list; },
    'throws an object with a throwing message getter': () => { throw { get message() { throw new Error('m'); } }; },
    'throws an object with a throwing toString': () => { throw { toString() { throw new Error('ts'); } }; },
    'throws an object with no prototype': () => { throw thrownNoMessage; },
    'throws null': () => { throw null; },
  };
  for (const [name, check] of Object.entries(outputs)) {
    const result = run(check);
    assert.equal(result.checks.hostile.state, 'failed', name);
    assert.equal(typeof result.checks.hostile.diagnostic, 'string', name);
    assert.equal(result.state, 'failed', name);
    assert.equal(result.checks.good.state, 'complete', `${name}: sibling survives`);
    assert.deepEqual(result.findings.map(f => f.checkId), ['good'], name);
  }
  // A check cannot change the caller's context or starve a later component check.
  const components = ['header'];
  const header = { layer: 'component', check: mk('header-rule', { applies: { artifacts: ['content'], components: ['header'] }, check: () => [fnd('header')] }) };
  const result = run(c => { c.components.length = 0; return []; }, { context: { ...ctx, components }, extra: [header] });
  assert.deepEqual(components, ['header']);
  assert.equal(result.checks.hostile.state, 'failed');
  assert.equal(result.checks['header-rule'].state, 'complete');
  assert.notEqual(result.state, 'complete');
  // A non-cloneable input or context fails closed with a diagnostic.
  for (const [name, options] of Object.entries({
    'function in value': { value: { title: 'x', fn() {} } },
    'function in before': { context: { ...ctx, before: { fn() {} } } },
    'function in context': { context: { ...ctx, fn() {} } },
    'proxy context': { context: new Proxy({ ...ctx }, {}) },
  })) {
    const out = run(() => [], options);
    assert.equal(out.state, 'failed', name);
    assert.deepEqual(out.findings, [], name);
    for (const item of Object.values(out.checks)) { assert.equal(item.state, 'failed', name); assert.match(item.diagnostic, /cannot be used/, name); }
  }
});

test('holes in pack, check, available and override lists give a clear error', () => {
  const sparse = n => { const list = new Array(n); return list; };
  const withHole = [mk('a'), , mk('b')];
  assert.throws(() => definePack({ id: 'p', title: 'p', owner: 'o', checks: withHole }), /hole/);
  assert.throws(() => resolveChecks({ available: [examplePack, ,] }), /hole/);
  assert.throws(() => resolveChecks({ custom: sparse(1) }), /hole/);
  assert.throws(() => resolveChecks({ packs: sparse(1) }), /hole/);
  assert.throws(() => plan({ overrides: sparse(1) }), /hole/);
});

test('evidence toJSON cannot change evidence.state, and a hook or accessor never yields complete', () => {
  const run = evidence => runChecks(resolveChecks({ custom: [{ layer: 'project', check: mk('c', { check: () => [fnd('m', { evidence })] }) }] }), input({ title: 'x' }), ctx);
  for (const evidence of [{ state: 'incomplete', toJSON() { return { note: 'x' }; } }, { state: 'unknown', toJSON: () => ({}) }]) {
    assert.notEqual(run(evidence).checks.c.state, 'complete');
    assert.notEqual(run(evidence).state, 'complete');
  }
  assert.equal(run({ get state() { return 'incomplete'; } }).checks.c.state, 'missing');
  assert.equal(run({ state: 'incomplete' }).checks.c.state, 'missing');
  assert.equal(run({ state: 'Incomplete' }).checks.c.state, 'complete', 'only the lowercase value is an open state');
});

test('override scope kinds accepts only single-run (R8.5)', () => {
  const ov = kinds => plan({ overrides: [{ checkId: 'example-title', layer: 'page', reason: 'r', owner: 'o', scope: { kinds } }] });
  assert.throws(() => ov(['pair']), /scope/);
  assert.throws(() => ov(['single-run', 'pair']), /scope/);
  assert.doesNotThrow(() => ov(['single-run']));
});

test('a caller value is read once: a list that changes between reads is never stored', () => {
  const flip = (first, second) => { let reads = 0; return new Proxy([first], { get(target, key, receiver) { if (key === '0') { reads += 1; return reads === 1 ? first : second; } return Reflect.get(target, key, receiver); } }); };
  const scope = kinds => plan({ overrides: [{ checkId: 'example-title', layer: 'page', reason: 'r', owner: 'o', scope: { kinds } }] });
  // The list passes on its first read and would be 'pair' on a second read. Only the validated copy is stored.
  const stored = scope(flip('single-run', 'pair')).overrides[0].scope.kinds;
  assert.deepEqual([...stored], ['single-run']);
  assert.throws(() => scope(flip('pair', 'single-run')), /scope/);
  // Accessor-backed items and fields of a check definition are read once as well.
  let titleReads = 0;
  const applies = { get artifacts() { titleReads += 1; return titleReads === 1 ? ['content'] : ['html']; } };
  const defined = definePack({ id: 'once', title: 't', owner: 'o', checks: [{ ...titleCheck, id: 'once-check', applies }] });
  assert.deepEqual([...defined.checks[0].applies.artifacts], ['content']);
  assert.equal(titleReads, 1);
  let idReads = 0;
  const pack = { get id() { idReads += 1; return idReads === 1 ? 'first-pack' : 'second-pack'; }, title: 't', owner: 'o', checks: [mk('x')] };
  assert.equal(definePack(pack).id, 'first-pack');
  let layerReads = 0;
  const item = { get layer() { layerReads += 1; return layerReads === 1 ? 'project' : 'package'; }, check: mk('y') };
  assert.equal(resolveChecks({ custom: [item] }).checks[0].layer, 'project');
  let artifactReads = 0;
  const reads = { get artifact() { artifactReads += 1; return artifactReads === 1 ? 'content' : 'html'; }, value: { title: 'x' } };
  assert.equal(runChecks(plan(), reads, ctx).checks['example-title'].state, 'complete');
  assert.equal(artifactReads, 1);
});

test('a present evidence.state that is not a closed string never ends complete', () => {
  const run = evidence => runChecks(resolveChecks({ custom: [{ layer: 'project', check: mk('c', { check: () => [fnd('m', { evidence })] }) }] }), input({ title: 'x' }), ctx);
  for (const state of [1, 0, NaN, null, undefined, true, ['incomplete'], { v: 'incomplete' }, new Date(0), 1n, new String('unknown'), new String('incomplete'), new Number(1), new Boolean(true)]) {
    const result = run({ state });
    assert.equal(result.checks.c.state, 'failed', String(state));
    assert.notEqual(result.state, 'complete');
  }
  assert.equal(run({ state: 'incomplete' }).checks.c.state, 'missing');
  assert.equal(run({ state: 'unknown' }).checks.c.state, 'missing');
  assert.equal(run({ state: 'fine' }).checks.c.state, 'complete');
  assert.equal(run({}).checks.c.state, 'complete');
});

test('getters on override and check fields are read once (stored value equals validated value)', () => {
  const once = (first, second) => { let reads = 0; return () => { reads += 1; return reads === 1 ? first : second; }; };
  const base = { checkId: 'example-title', layer: 'page', reason: 'r', owner: 'o' };
  const make = extra => plan({ overrides: [Object.defineProperties({ ...base }, Object.fromEntries(Object.entries(extra).map(([key, get]) => [key, { get, enumerable: true }])))] }).overrides[0];
  assert.equal(make({ reason: once('valid', { x: 1 }) }).reason, 'valid');
  assert.equal(make({ owner: once('valid', { x: 1 }) }).owner, 'valid');
  assert.equal(make({ checkId: once('example-title', 'zzz') }).checkId, 'example-title');
  assert.equal(make({ layer: once('page', 'package') }).layer, 'page');
  const scope = { get kinds() { return once(['single-run'], ['x'])(); } };
  assert.deepEqual([...make({ scope: () => scope }).scope.kinds], ['single-run']);
  const packs = once([mk('p1')], []);
  const pack = { id: 'getter-pack', title: 't', owner: 'o', get checks() { return packs(); } };
  assert.equal(definePack(pack).checks.length, 1);
  const comps = once(['header'], ['other']);
  const check = mk('c-getter', { applies: { artifacts: ['content'], get components() { return comps(); } } });
  assert.deepEqual([...resolveChecks({ custom: [{ layer: 'component', check }] }).checks[0].check.applies.components], ['header']);
});


test('input is JSON-like data: other types are rejected before any check runs, with type and path', () => {
  const ran = [];
  const p = resolveChecks({ custom: [{ layer: 'project', check: mk('probe', { check: () => { ran.push(1); return []; } }) }] });
  const run = (value, context = ctx) => runChecks(p, { artifact: 'content', value }, context);
  class Sample { constructor() { this.a = 1; } }
  const accessor = {}; Object.defineProperty(accessor, 'a', { get: () => 1, enumerable: true });
  const cases = {
    'value.map': new Map(), 'value.set': new Set(), 'value.date': new Date(0), 'value.buffer': new ArrayBuffer(1), 'value.shared': new SharedArrayBuffer(1),
    'value.typed': new Uint8Array(new SharedArrayBuffer(1)), 'value.typed2': new Uint8Array(2), 'value.view': new DataView(new ArrayBuffer(1)),
    'value.regexp': /x/, 'value.error': new Error('e'), 'value.instance': new Sample(), 'value.fn': () => {}, 'value.sym': Symbol('s'), 'value.big': 1n,
    'value.accessor': accessor, 'value.sparse': new Array(2),
  };
  for (const [path, bad] of Object.entries(cases)) {
    const result = run({ [path.slice(6)]: bad });
    assert.equal(result.state, 'failed', path);
    assert.equal(result.checks.probe.state, 'failed', path);
    assert.ok(result.checks.probe.diagnostic.includes(path), `${path}: ${result.checks.probe.diagnostic}`);
  }
  assert.match(run({ a: [{ m: new Map() }] }).checks.probe.diagnostic, /value\.a\[0\]\.m is a Map/);
  assert.match(run({}, { ...ctx, set: new Set() }).checks.probe.diagnostic, /context\.set is a Set/);
  assert.deepEqual(ran, []);
});

test('the snapshot keeps shared references and is frozen and shared by all checks', () => {
  const seen = [];
  const a = mk('a-first', { check: (v, c) => { seen.push(v.ref === c.ref); assert.throws(() => { v.ref.n = 2; }, TypeError); assert.throws(() => { c.list.push(1); }, TypeError); seen.push(v); return []; } });
  const b = mk('b-second', { check: v => { seen.push(v); return []; } });
  const shared = { n: 1 };
  const value = { ref: shared };
  const context = { ...ctx, ref: shared, list: [] };
  const result = runChecks(resolveChecks({ custom: [{ layer: 'project', check: a }, { layer: 'project', check: b }] }), { artifact: 'content', value }, context);
  assert.equal(result.checks['a-first'].state, 'complete');
  assert.equal(seen[0], true);
  assert.equal(seen[1], seen[2], 'all checks get the same frozen snapshot');
  assert.equal(shared.n, 1);
  assert.equal(context.list.length, 0);
  const cyclic = { name: 'x' }; cyclic.self = cyclic;
  assert.equal(runChecks(resolveChecks({ custom: [{ layer: 'project', check: mk('cyc') }] }), { artifact: 'content', value: cyclic }, ctx).checks.cyc.state, 'complete');
});

test('depth limit: at the limit passes, above it fails with a message, very deep fails cleanly', () => {
  const nest = depth => { const root = {}; let node = root; for (let i = 0; i < depth; i += 1) { node.n = {}; node = node.n; } return root; };
  const p = resolveChecks({ custom: [{ layer: 'project', check: mk('deep') }] });
  const run = value => runChecks(p, { artifact: 'content', value }, ctx);
  // value is at depth 1 inside the wrapper, so the root object of nest(n) sits at depth 1 and its deepest node at depth n + 1.
  assert.equal(MAX_DEPTH, 256);
  assert.equal(run(nest(MAX_DEPTH - 1)).checks.deep.state, 'complete');
  const over = run(nest(MAX_DEPTH));
  assert.equal(over.checks.deep.state, 'failed');
  assert.match(over.checks.deep.diagnostic, /deeper than 256 levels/);
  const huge = run(nest(20000));
  assert.equal(huge.checks.deep.state, 'failed');
  assert.match(huge.checks.deep.diagnostic, /deeper than 256 levels/);
});

test('the result of a check is read once: then, length and elements', () => {
  const reads = { then: 0, length: 0, item: 0 };
  const list = new Proxy([fnd('m')], {
    get(target, key, receiver) {
      if (key === 'then') { reads.then += 1; return undefined; }
      if (key === 'length') reads.length += 1;
      if (key === '0') reads.item += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  const result = runChecks(resolveChecks({ custom: [{ layer: 'project', check: mk('once', { check: () => list }) }] }), input({ title: 'x' }), ctx);
  assert.equal(result.checks.once.state, 'complete');
  assert.deepEqual(reads, { then: 1, length: 1, item: 1 });
});
