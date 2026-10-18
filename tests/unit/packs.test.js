import test from 'node:test';
import assert from 'node:assert/strict';
import { definePack, resolveChecks, runChecks, LAYERS } from '../../src/packs/index.js';
import { examplePack, titleCheck, throwingCheck } from '../fixtures/packs/example-pack.js';

const input = (value = { title: '' }) => ({ artifact: 'content', value });
const mk = (id, extra = {}) => ({ id, title: id, basis: 'absolute', applies: { artifacts: ['content'] }, check: () => [], ...extra });
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
  const custom = [{ layer: 'project', check: mk('project-rule', { check: (v, c) => [{ targetId: c.targetId, artifact: 'content', message: 'Project rule fired.' }] }) }];
  const result = runChecks(resolveChecks({ available: [examplePack], packs: ['example-pack'], custom }), input(), { targetId: 'example-site' });
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

test('fail closed: bad return values, promises and missing input never pass', () => {
  const run = check => runChecks(resolveChecks({ custom: [{ layer: 'project', check: mk('c', { check }) }] }), input({ title: 'x' }), { targetId: 't' });
  for (const check of [() => 'ok', () => undefined, () => Promise.resolve([]), () => [{ severity: 'info' }], () => [{ message: 'm', checkId: 'other' }]]) {
    const result = run(check);
    assert.equal(result.checks.c.state, 'failed');
    assert.deepEqual(result.findings, []);
  }
  assert.equal(run(() => [{ message: 'm', evidence: { state: 'incomplete' } }]).checks.c.state, 'missing');
  const empty = runChecks(plan(), { artifact: 'content', value: null });
  assert.equal(empty.state, 'missing');
  assert.equal(empty.checks['example-title'].state, 'missing');
  assert.throws(() => runChecks({}, input()));
  assert.throws(() => runChecks(plan(), {}));
});

test('a relative check needs a prior artifact and a check skips artifacts it does not apply to', () => {
  const rel = resolveChecks({ custom: [{ layer: 'project', check: mk('rel', { basis: 'relative', check: () => [{ message: 'differs' }] }) }] });
  assert.equal(runChecks(rel, input({})).checks.rel.state, 'missing');
  assert.equal(runChecks(rel, input({}), { before: {} }).checks.rel.state, 'complete');
  const other = runChecks(rel, { artifact: 'html', value: '<p>' }, { before: {} });
  assert.deepEqual(other.checks, {});
  assert.equal(other.state, 'missing');
});

test('a component check runs only for a target that shows the component', () => {
  const check = mk('header-rule', { applies: { artifacts: ['content'], components: ['header'] }, check: () => [{ message: 'header' }] });
  const p = resolveChecks({ custom: [{ layer: 'component', check }] });
  assert.equal(runChecks(p, input({}), { components: ['footer'] }).checks['header-rule'], undefined);
  assert.equal(runChecks(p, input({}), { components: ['header'] }).findings[0].layer, 'component');
  assert.throws(() => resolveChecks({ custom: [{ layer: 'project', check }] }));
  assert.throws(() => resolveChecks({ custom: [{ layer: 'component', check: mk('no-comp') }] }));
});
