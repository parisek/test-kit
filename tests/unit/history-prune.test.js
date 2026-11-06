import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, readdir, readFile, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planPrune, collectReferences, parseKeep, pruneHistory, assertPlainStorePath } from '../../src/history/prune.js';
import { parseCommand, dispatch, run } from '../../src/cli/run.js';
import { MARKER_BODY } from '../../src/export/store-viewer.js';

const day = n => `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`;
async function fixture(t, { marker = true } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'test-kit-prune-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = join(root, 'test-kit');
  await mkdir(join(store, 'runs'), { recursive: true });
  await mkdir(join(store, 'reports'));
  if (marker) await writeFile(join(store, '.test-kit-viewer'), MARKER_BODY);
  const addRun = async (id, side, at) => {
    await mkdir(join(store, 'runs', id));
    await writeFile(join(store, 'runs', id, 'run.json'), JSON.stringify({ id, side, at, state: 'complete' }));
  };
  const addReport = async (id, report) => {
    await mkdir(join(store, 'reports', id));
    await writeFile(join(store, 'reports', id, 'report.json'), JSON.stringify(report));
  };
  const ids = async () => (await readdir(join(store, 'runs'))).sort();
  return { root, store, addRun, addReport, ids };
}

test('planPrune keeps the newest runs of each side by recorded time, not by id', () => {
  const runs = [
    { id: 'z-old', side: 'a', at: Date.parse(day(1)) },
    { id: 'a-new', side: 'a', at: Date.parse(day(3)) },
    { id: 'm-mid', side: 'a', at: Date.parse(day(2)) },
    { id: 'b-1', side: 'b', at: Date.parse(day(1)) },
  ];
  const plan = planPrune({ runs, keep: 2 });
  assert.deepEqual(plan.remove.map(run => run.id), ['z-old']);
  assert.equal(plan.keptCount, 3);
});
test('planPrune keeps a run with no readable time or side and a referenced run', () => {
  const runs = [
    { id: 'r1', side: 'a', at: 1 }, { id: 'r2', side: 'a', at: 2 }, { id: 'r3', side: 'a', at: 3 },
    { id: 'no-time', side: 'a', at: NaN }, { id: 'no-side', at: 5 },
  ];
  const plan = planPrune({ runs, keep: 1, referenced: new Map([['r1', 'baseline']]) });
  assert.deepEqual(plan.remove.map(run => run.id), ['r2']);
  assert.deepEqual(plan.skipped.map(item => item.id), ['no-side', 'no-time', 'r1']);
});
test('parseKeep refuses a bad value', () => {
  for (const bad of [0, -1, 1.5, '5', NaN, 100001]) assert.throws(() => parseKeep(bad), /--keep/);
  assert.equal(parseKeep(20), 20);
});
test('collectReferences reads pairs, subjects, report runs and baselines, and fails on a bad shape', () => {
  const refs = collectReferences({
    reports: [{ id: 'p', value: { pair: { aRunId: 'a', bRunId: 'b' }, runs: [{ id: 'a' }, { id: 'b' }] } }, { id: 's', value: { subject: { kind: 'single-run', runId: 'c' } } }],
    state: { profiles: { x: { before: 'd' }, y: {} } },
  });
  assert.deepEqual([...refs.keys()].sort(), ['a', 'b', 'c', 'd']);
  assert.throws(() => collectReferences({ reports: [{ id: 'p', value: null }] }), /not readable/);
  assert.throws(() => collectReferences({ state: { profiles: [] } }), /not readable/);
});

test('a dry run lists the runs and removes nothing', async t => {
  const f = await fixture(t);
  for (let n = 1; n <= 4; n++) await f.addRun(`run-${n}`, 'local', day(n));
  const { output, exitCode } = await pruneHistory({ local: f.store, keep: 2 });
  assert.equal(exitCode, 0);
  assert.equal(output.dryRun, true);
  assert.deepEqual(output.wouldRemove, ['run-1', 'run-2']);
  assert.deepEqual(await f.ids(), ['run-1', 'run-2', 'run-3', 'run-4']);
  await assert.rejects(access(join(f.store, 'lock')));
});
test('--yes removes only the oldest runs beyond keep for each side', async t => {
  const f = await fixture(t);
  for (let n = 1; n <= 3; n++) { await f.addRun(`loc-${n}`, 'local', day(n)); await f.addRun(`rem-${n}`, 'remote', day(n + 10)); }
  const { output, exitCode } = await pruneHistory({ local: f.store, keep: 2, yes: true });
  assert.equal(exitCode, 0);
  assert.deepEqual(output.removed, ['loc-1', 'rem-1']);
  assert.equal(output.failed, null);
  assert.deepEqual(await f.ids(), ['loc-2', 'loc-3', 'rem-2', 'rem-3']);
  await assert.rejects(access(join(f.store, 'lock')));
});
test('a run that a report, a baseline or a report run list names survives', async t => {
  const f = await fixture(t);
  for (let n = 1; n <= 6; n++) await f.addRun(`run-${n}`, 'local', day(n));
  await f.addReport('pair', { pair: { aRunId: 'run-1', bRunId: 'run-6' }, runs: [{ id: 'run-1' }, { id: 'run-6' }] });
  await f.addReport('single', { subject: { kind: 'single-run', runId: 'run-2' }, runs: [{ id: 'run-2' }] });
  await writeFile(join(f.store, 'state.json'), JSON.stringify({ schemaVersion: 1, profiles: { s: { before: 'run-3' } } }));
  const { output } = await pruneHistory({ local: f.store, keep: 1, yes: true });
  assert.deepEqual(output.removed, ['run-4', 'run-5']);
  assert.deepEqual(await f.ids(), ['run-1', 'run-2', 'run-3', 'run-6']);
  assert.deepEqual(output.skipped.map(item => item.id), ['run-1', 'run-2', 'run-3']);
});
test('the store viewer index.json does not protect a run', async t => {
  const f = await fixture(t);
  for (let n = 1; n <= 3; n++) await f.addRun(`run-${n}`, 'local', day(n));
  await writeFile(join(f.store, 'index.json'), JSON.stringify({ runs: [{ id: 'run-1' }] }));
  assert.deepEqual((await pruneHistory({ local: f.store, keep: 1, yes: true })).output.removed, ['run-1', 'run-2']);
});
test('an unreadable report or state stops the prune before any removal', async t => {
  const f = await fixture(t);
  for (let n = 1; n <= 3; n++) await f.addRun(`run-${n}`, 'local', day(n));
  await mkdir(join(f.store, 'reports', 'broken'));
  await writeFile(join(f.store, 'reports', 'broken', 'report.json'), '{');
  await assert.rejects(pruneHistory({ local: f.store, keep: 1, yes: true }), /Report broken is not readable/);
  assert.equal((await f.ids()).length, 3);
  await rm(join(f.store, 'reports', 'broken'), { recursive: true });
  await writeFile(join(f.store, 'state.json'), '{');
  await assert.rejects(pruneHistory({ local: f.store, keep: 1, yes: true }), /state is not readable/);
  assert.equal((await f.ids()).length, 3);
  await assert.rejects(access(join(f.store, 'lock')));
});
test('a run with no readable time, a mismatched id, an unsafe id or a symlink stays', async t => {
  const f = await fixture(t);
  for (let n = 1; n <= 3; n++) await f.addRun(`run-${n}`, 'local', day(n));
  await mkdir(join(f.store, 'runs', 'torn'));
  await writeFile(join(f.store, 'runs', 'torn', 'run.json'), JSON.stringify({ side: 'local' }));
  await f.addRun('liar', 'local', day(1));
  await writeFile(join(f.store, 'runs', 'liar', 'run.json'), JSON.stringify({ id: 'other', side: 'local', at: day(1) }));
  await mkdir(join(f.store, 'runs', '.hidden'));
  await mkdir(join(f.root, 'outside', 'run-0'), { recursive: true });
  await writeFile(join(f.root, 'outside', 'run-0', 'run.json'), JSON.stringify({ id: 'run-0', side: 'local', at: day(1) }));
  await symlink(join(f.root, 'outside', 'run-0'), join(f.store, 'runs', 'run-0'));
  const { output } = await pruneHistory({ local: f.store, keep: 1, yes: true });
  assert.deepEqual(output.removed, ['run-1', 'run-2']);
  assert.deepEqual(await f.ids(), ['.hidden', 'liar', 'run-0', 'run-3', 'torn']);
  await access(join(f.root, 'outside', 'run-0', 'run.json'));
});
test('a symlink inside a run is removed as a link and its target stays', async t => {
  const f = await fixture(t);
  for (let n = 1; n <= 2; n++) await f.addRun(`run-${n}`, 'local', day(n));
  await mkdir(join(f.root, 'outside'));
  await writeFile(join(f.root, 'outside', 'secret.txt'), 'keep');
  await symlink(join(f.root, 'outside'), join(f.store, 'runs', 'run-1', 'link'));
  await pruneHistory({ local: f.store, keep: 1, yes: true });
  assert.equal(await readFile(join(f.root, 'outside', 'secret.txt'), 'utf8'), 'keep');
  assert.deepEqual(await f.ids(), ['run-2']);
});
test('a runs/ folder that is a symlink out of the store is refused', async t => {
  const f = await fixture(t);
  await rm(join(f.store, 'runs'), { recursive: true });
  await mkdir(join(f.root, 'elsewhere', 'run-1'), { recursive: true });
  await writeFile(join(f.root, 'elsewhere', 'run-1', 'run.json'), JSON.stringify({ id: 'run-1', side: 'local', at: day(1) }));
  await symlink(join(f.root, 'elsewhere'), join(f.store, 'runs'));
  await assert.rejects(pruneHistory({ local: f.store, keep: 1, yes: true }), /real directory/);
  await access(join(f.root, 'elsewhere', 'run-1', 'run.json'));
});
test('a store that is a symlink is refused, also on the way to the store', async t => {
  const f = await fixture(t);
  await symlink(f.store, join(f.root, 'link-store'));
  await assert.rejects(pruneHistory({ local: join(f.root, 'link-store'), yes: true }), /real directory/);
  await assert.rejects(assertPlainStorePath(f.root, join(f.root, 'link-store')), /symbolic links/);
  await assert.rejects(assertPlainStorePath(f.root, join(f.root, 'absent')), /no store/);
  await assert.rejects(assertPlainStorePath(f.root, f.root), /subdirectory/);
  await assertPlainStorePath(f.root, f.store);
});
test('a store without the viewer marker, or with a foreign marker, is refused', async t => {
  const f = await fixture(t, { marker: false });
  await f.addRun('run-1', 'local', day(1));
  await f.addRun('run-2', 'local', day(2));
  await assert.rejects(pruneHistory({ local: f.store, keep: 1, yes: true }), /not a test-kit store/);
  await writeFile(join(f.store, '.test-kit-viewer'), '{"tool":"other"}\n');
  await assert.rejects(pruneHistory({ local: f.store, keep: 1, yes: true }), /not a test-kit store/);
  assert.equal((await f.ids()).length, 2);
});
test('a workflow lock stops the prune and stays in place', async t => {
  const f = await fixture(t);
  await f.addRun('run-1', 'local', day(1));
  await f.addRun('run-2', 'local', day(2));
  await mkdir(join(f.store, 'lock'));
  await assert.rejects(pruneHistory({ local: f.store, keep: 1, yes: true }), /already owns/);
  await assert.rejects(pruneHistory({ local: f.store, keep: 1 }), /already owns/);
  await access(join(f.store, 'lock'));
  assert.equal((await f.ids()).length, 2);
});
test('a failed removal stops the command, reports it and leaves the rest', async t => {
  const f = await fixture(t);
  for (let n = 1; n <= 4; n++) await f.addRun(`run-${n}`, 'local', day(n));
  if (process.getuid?.() === 0) return t.skip('root ignores file modes');
  const { chmod } = await import('node:fs/promises');
  // A run folder without write permission cannot lose run.json, so its removal fails.
  await chmod(join(f.store, 'runs', 'run-2'), 0o500);
  try {
    const { output, exitCode } = await pruneHistory({ local: f.store, keep: 1, yes: true });
    assert.equal(exitCode, 1);
    assert.deepEqual(output.removed, ['run-1']);
    assert.equal(output.failed.id, 'run-2');
    const left = await f.ids();
    assert.ok(left.includes('run-3') && left.includes('run-4'));
  } finally { await chmod(join(f.store, 'runs', 'run-2'), 0o700); }
});

test('a missing or odd reports/ and an odd report entry stop the prune, dry run too', async t => {
  const cases = {
    'missing reports/': async f => rm(join(f.store, 'reports'), { recursive: true }),
    'reports/ as a file': async f => { await rm(join(f.store, 'reports'), { recursive: true }); await writeFile(join(f.store, 'reports'), 'x'); },
    'reports/ as a symlink': async f => { await rm(join(f.store, 'reports'), { recursive: true }); await mkdir(join(f.root, 'other')); await symlink(join(f.root, 'other'), join(f.store, 'reports')); },
    'unsafe report folder name': async f => mkdir(join(f.store, 'reports', '.hidden')),
    'report entry as a file': async f => writeFile(join(f.store, 'reports', 'loose.json'), '{}'),
    'symlinked report folder': async f => { await mkdir(join(f.root, 'real-report')); await writeFile(join(f.root, 'real-report', 'report.json'), JSON.stringify({ pair: { aRunId: 'run-1', bRunId: 'run-2' } })); await symlink(join(f.root, 'real-report'), join(f.store, 'reports', 'linked')); },
  };
  for (const [name, setup] of Object.entries(cases)) {
    const f = await fixture(t);
    for (let n = 1; n <= 3; n++) await f.addRun(`run-${n}`, 'local', day(n));
    await setup(f);
    for (const yes of [false, true]) {
      await assert.rejects(pruneHistory({ local: f.store, keep: 1, yes }), /reports|Nothing was removed/, name);
      assert.equal((await f.ids()).length, 3, name);
    }
    await assert.rejects(access(join(f.store, 'lock')), undefined, name);
  }
});
test('parseCommand accepts --prune and refuses a bad --keep or a bad combination', () => {
  const ok = parseCommand(['history', '--prune', '--keep', '5', '--yes']);
  assert.deepEqual([ok.options.prune, ok.options.keep, ok.options.yes], [true, 5, true]);
  assert.equal(parseCommand(['history', '--prune']).options.keep, undefined);
  for (const keep of ['0', '-1', '1.5', 'x', '100001']) assert.throws(() => parseCommand(['history', '--prune', '--keep', keep]), /--keep|Missing/);
  assert.throws(() => parseCommand(['history', '--keep', '5']), /need --prune/);
  assert.throws(() => parseCommand(['history', '--yes']), /need --prune/);
  assert.throws(() => parseCommand(['history', '--prune', '--port', '0']), /--prune alone/);
  assert.throws(() => parseCommand(['history', '--prune', '--export', 'x']), /--prune alone/);
  assert.throws(() => parseCommand(['history', '--prune', '--publish', 'x']), /--prune alone/);
  assert.throws(() => parseCommand(['run', '--prune']), /Unknown option/);
});
test('the command prunes, prints one JSON line and refreshes the store viewer', async t => {
  const f = await fixture(t);
  for (let n = 1; n <= 3; n++) await f.addRun(`run-${n}`, 'local', day(n));
  await writeFile(join(f.root, 'test-kit.config.json'), '{}');
  const lines = [];
  const capture = { write: text => lines.push(text) };
  const dry = await run(['history', '--prune', '--keep', '1', '--config', join(f.root, 'test-kit.config.json')], { out: capture, err: capture });
  assert.equal(dry, 0);
  assert.equal(JSON.parse(lines[0]).dryRun, true);
  assert.equal((await f.ids()).length, 3);
  lines.length = 0;
  const code = await run(['history', '--prune', '--keep', '1', '--yes', '--config', join(f.root, 'test-kit.config.json')], { out: capture, err: capture });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(lines[0]).removed, ['run-1', 'run-2']);
  assert.deepEqual(await f.ids(), ['run-3']);
  const index = JSON.parse(await readFile(join(f.store, 'index.json'), 'utf8'));
  assert.deepEqual(index.runs.map(row => row.id), ['run-3']);
});
test('the command refuses a symlinked store path before it reads anything', async t => {
  const f = await fixture(t);
  await symlink(f.store, join(f.root, 'alias'));
  await writeFile(join(f.root, 'test-kit.config.json'), '{}');
  await assert.rejects(dispatch(parseCommand(['history', '--prune', '--yes', '--store', 'alias', '--config', join(f.root, 'test-kit.config.json')])), /symbolic links/);
  await assert.rejects(dispatch(parseCommand(['history', '--prune', '--store', '../x', '--config', join(f.root, 'test-kit.config.json')])), /plain relative path/);
});
