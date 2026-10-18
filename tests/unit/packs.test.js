import test from 'node:test';
import assert from 'node:assert/strict';
import { definePack, resolveChecks, runChecks, LAYERS } from '../../src/packs/index.js';
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
