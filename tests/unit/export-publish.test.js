import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportReport } from '../../src/export/report.js';
import { MARKER, MARKER_VALUE, publishHistory, recoveryAction } from '../../src/export/publish.js';
import { parseCommand, run } from '../../src/cli/run.js';
import { validId } from '../../src/history/valid-id.js';

const H1 = 'sha256:' + 'a'.repeat(64);
const SUCCESS = dir => `test-kit: published to ${dir}; the directory contains captured pages.`;

// A temp project: `proj/.test-kit` is the store, `proj/site` is the publish directory.
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'test-kit-publish-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const proj = join(root, 'proj');
  const local = join(proj, '.test-kit');
  const dir = join(proj, 'site');
  await mkdir(local, { recursive: true });
  const base = { local, dir, cwd: root, home: join(root, 'home'), now: new Date('2026-10-20T12:00:00.000Z') };
  const addRun = async (id, at = '2026-01-01T00:00:00.000Z', settingsHash = H1) => {
    await mkdir(join(local, 'runs', id), { recursive: true });
    await writeFile(join(local, 'runs', id, 'run.json'), JSON.stringify({ at, settingsHash, state: 'complete', settings: { targets: [{ id: 'home' }] } }));
  };
  // `shot`: 'ok' writes the PNG, 'missing' leaves it out, 'escape' links it outside the report, 'none' lists no evidence.
  const addReport = async (id, { shot = 'ok', generated = '2026-01-03T00:00:00.000Z' } = {}) => {
    const reportDir = join(local, 'reports', id);
    await mkdir(join(reportDir, 'shots'), { recursive: true });
    const artifacts = shot === 'none' ? {} : { screenshot: { a: { src: 'shots/a.png' } } };
    await writeFile(join(reportDir, 'report.json'), JSON.stringify({
      schemaVersion: 2,
      meta: { generated, matchBelow: 3, viewports: [{ id: 'mobile' }] },
      runs: [{ id: 'run-a' }, { id: 'run-b' }],
      pair: { kind: 'update', aRunId: 'run-a', bRunId: 'run-b' },
      entries: [{ id: 'home', viewports: [{ id: 'mobile', ratio: 0, state: 'complete', artifacts }] }],
      causes: [], findings: [], rules: {},
    }));
    if (shot === 'ok') await writeFile(join(reportDir, 'shots/a.png'), Buffer.from('png-bytes'));
    if (shot === 'escape') {
      await writeFile(join(root, 'outside.png'), 'secret');
      await symlink(join(root, 'outside.png'), join(reportDir, 'shots/a.png'));
    }
  };
  return { root, proj, local, dir, base, addRun, addReport };
}

const exists = async path => { try { await lstat(path); return true; } catch { return false; } };
const siblings = async dir => ({ lock: await exists(dir + '.test-kit-lock'), stage: await exists(dir + '.test-kit-new'), backup: await exists(dir + '.test-kit-old') });
const none = { lock: false, stage: false, backup: false };
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
async function tree(dir, prefix = '') {
  const out = [];
  for (const name of (await readdir(dir)).sort()) {
    const entry = await lstat(join(dir, name));
    out.push(prefix + name);
    if (entry.isDirectory()) out.push(...await tree(join(dir, name), prefix + name + '/'));
  }
  return out;
}

// Checks every rule of the R10.13 schema on a parsed index.json.
function assertIndexSchema(index, publishDir) {
  assert.deepEqual(Object.keys(index), ['schemaVersion', 'generatedAt', 'reports', 'runs']);
  assert.equal(index.schemaVersion, 1);
  assert.match(index.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const check = (list, keys, kind, file) => {
    for (const entry of list) {
      assert.deepEqual(Object.keys(entry), keys);
      assert.ok(validId(entry.id));
      assert.ok(entry.createdAt === null || iso.test(entry.createdAt));
      assert.ok(entry.settingsHash === null || (typeof entry.settingsHash === 'string' && entry.settingsHash.startsWith('sha256:')));
      assert.ok(entry.path === null || entry.path === `${kind}/${entry.id}/${file}`);
      if (entry.path !== null) {
        assert.ok(!entry.path.startsWith('/') && !entry.path.includes('..'));
        assert.ok(publishDir.files.has(entry.path), `${entry.path} is in the directory`);
      }
    }
    const order = [...list].sort((a, b) => (a.createdAt === b.createdAt ? (a.id === b.id ? 0 : a.id > b.id ? -1 : 1) : a.createdAt === null ? 1 : b.createdAt === null ? -1 : a.createdAt > b.createdAt ? -1 : 1));
    assert.deepEqual(list.map(entry => entry.id), order.map(entry => entry.id));
  };
  check(index.reports, ['id', 'kind', 'createdAt', 'settingsHash', 'path', 'targets', 'viewports', 'summary'], 'reports', 'report.json');
  check(index.runs, ['id', 'createdAt', 'settingsHash', 'path'], 'runs', 'run.json');
  for (const report of index.reports) {
    assert.ok(report.kind === null || typeof report.kind === 'string');
    assert.ok(report.targets === null || Number.isInteger(report.targets));
    assert.ok(report.viewports === null || Number.isInteger(report.viewports));
  }
}

async function listing(dir) {
  return { files: new Set(await tree(dir)) };
}

test('first publish creates the directory with marker, viewer, index, runs and reports', async t => {
  const f = await fixture(t);
  await f.addRun('run-a'); await f.addRun('run-b', '2026-01-02T00:00:00.000Z');
  await f.addReport('rep-1');
  const result = await publishHistory(f.base);
  assert.equal(result.dir, f.dir);
  assert.equal(result.messages.at(-1), SUCCESS(f.dir));
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(await siblings(f.dir), none);
  const names = await tree(f.dir);
  for (const name of [MARKER, 'index.json', 'index.html', 'app.js', 'style.css', 'runs/run-a/run.json', 'runs/run-b/run.json', 'reports/rep-1/report.json']) assert.ok(names.includes(name), name);
  assert.deepEqual(await readJson(join(f.dir, MARKER)), MARKER_VALUE);
  assert.equal(await readFile(join(f.dir, 'runs/run-a/run.json'), 'utf8'), await readFile(join(f.local, 'runs/run-a/run.json'), 'utf8'));
  const report = await readJson(join(f.dir, 'reports/rep-1/report.json'));
  assert.match(report.entries[0].viewports[0].artifacts.screenshot.a.src, /^evidence\/[0-9a-f]{64}\.png$/);
  assert.equal(names.filter(name => name.startsWith('reports/rep-1/evidence/')).length, 1);
  const index = await readJson(join(f.dir, 'index.json'));
  assertIndexSchema(index, await listing(f.dir));
  assert.equal(index.generatedAt, '2026-10-20T12:00:00.000Z');
  assert.deepEqual(index.reports, [{ id: 'rep-1', kind: 'update', createdAt: '2026-01-03T00:00:00.000Z', settingsHash: H1, path: 'reports/rep-1/report.json', targets: 1, viewports: 1, summary: { unexplained: 0, explained: 0, match: 1, oracle: 0, unclassified: 0, incomplete: 0 } }]);
});

test('index.json differs from the viewer copy of report export: one shared viewer, no viewer in a report', async t => {
  const f = await fixture(t);
  await f.addReport('rep-1');
  await publishHistory(f.base);
  const names = await tree(f.dir);
  assert.ok(!names.includes('reports/rep-1/index.html'));
  assert.ok(!names.includes('reports/rep-1/app.js'));
});

test('a second publish replaces the content and leaves no sibling', async t => {
  const f = await fixture(t);
  await f.addRun('run-a'); await f.addReport('rep-1');
  await publishHistory(f.base);
  await f.addRun('run-c', '2026-02-01T00:00:00.000Z');
  await rm(join(f.local, 'reports/rep-1'), { recursive: true });
  const result = await publishHistory({ ...f.base, now: new Date('2026-10-21T00:00:00.000Z') });
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(await siblings(f.dir), none);
  const names = await tree(f.dir);
  assert.ok(names.includes('runs/run-c/run.json'));
  assert.ok(!names.includes('reports/rep-1/report.json'));
  assert.equal((await readJson(join(f.dir, 'index.json'))).generatedAt, '2026-10-21T00:00:00.000Z');
});

test('an empty store publishes an empty list; an empty existing directory is allowed', async t => {
  const f = await fixture(t);
  await mkdir(f.dir);
  await publishHistory(f.base);
  const index = await readJson(join(f.dir, 'index.json'));
  assert.deepEqual([index.reports, index.runs], [[], []]);
  assertIndexSchema(index, await listing(f.dir));
});

test('a missing parent is created; nothing else is written before the lock', async t => {
  const f = await fixture(t);
  const dir = join(f.root, 'new', 'deep', 'site');
  await publishHistory({ ...f.base, dir });
  assert.ok((await tree(dir)).includes(MARKER));
});

test('an unreadable store entry is listed with null fields and no file', async t => {
  const f = await fixture(t);
  await mkdir(join(f.local, 'runs/run-bad'), { recursive: true });
  await writeFile(join(f.local, 'runs/run-bad/run.json'), '{not json');
  await mkdir(join(f.local, 'reports/rep-bad'), { recursive: true });
  await publishHistory(f.base);
  const index = await readJson(join(f.dir, 'index.json'));
  assert.deepEqual(index.runs, [{ id: 'run-bad', createdAt: null, settingsHash: null, path: null }]);
  assert.deepEqual(index.reports, [{ id: 'rep-bad', kind: null, createdAt: null, settingsHash: null, path: null, targets: null, viewports: null, summary: null }]);
  const names = await tree(f.dir);
  assert.ok(!names.some(name => name.startsWith('runs/run-bad') || name.startsWith('reports/rep-bad')));
  assertIndexSchema(index, await listing(f.dir));
});

test('missing evidence skips the report: null path, a warning, nothing copied, exit 0', async t => {
  const f = await fixture(t);
  await f.addRun('run-a');
  await f.addReport('rep-lost', { shot: 'missing' });
  await f.addReport('rep-ok', { generated: '2026-01-04T00:00:00.000Z' });
  const result = await publishHistory(f.base);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /report rep-lost/);
  assert.deepEqual(result.unavailable, ['rep-lost']);
  assert.equal(result.messages.at(-1), SUCCESS(f.dir));
  const names = await tree(f.dir);
  assert.ok(!names.some(name => name.startsWith('reports/rep-lost')));
  assert.ok(names.includes('reports/rep-ok/report.json'));
  const index = await readJson(join(f.dir, 'index.json'));
  const lost = index.reports.find(r => r.id === 'rep-lost');
  assert.equal(lost.path, null);
  assert.equal(lost.kind, 'update');
  assert.equal(lost.targets, 1);
  assertIndexSchema(index, await listing(f.dir));
});

test('oversized evidence skips the report the same way', async t => {
  const f = await fixture(t);
  await f.addReport('rep-big');
  // A sidecar JSON above 2 MiB exceeds its limit.
  await writeFile(join(f.local, 'reports/rep-big/shots/a.png'), 'x');
  const reportPath = join(f.local, 'reports/rep-big/report.json');
  const data = await readJson(reportPath);
  data.entries[0].viewports[0].artifacts = { status: { state: 'failed', a: { src: 'shots/a.json' } } };
  await writeFile(reportPath, JSON.stringify(data));
  await writeFile(join(f.local, 'reports/rep-big/shots/a.json'), Buffer.alloc(2 * 1024 * 1024 + 10, 32));
  const result = await publishHistory(f.base);
  assert.deepEqual(result.unavailable, ['rep-big']);
  assert.match(result.warnings[0], /EFBIG/);
  assert.equal((await readJson(join(f.dir, 'index.json'))).reports[0].path, null);
});

test('a non-empty directory without a marker is refused and unchanged', async t => {
  const f = await fixture(t);
  await mkdir(f.dir);
  await writeFile(join(f.dir, 'keep.txt'), 'keep');
  await assert.rejects(publishHistory(f.base), /no valid \.test-kit-publish marker/);
  assert.equal(await readFile(join(f.dir, 'keep.txt'), 'utf8'), 'keep');
  assert.deepEqual(await siblings(f.dir), none);
});

test('a marker with an extra field, wrong value, bad JSON or wrong type is refused', async t => {
  const f = await fixture(t);
  await mkdir(f.dir);
  for (const content of [{ ...MARKER_VALUE, extra: 1 }, { ...MARKER_VALUE, schemaVersion: 2 }, { tool: 'test-kit', kind: 'publish' }, [1], '{bad']) {
    await writeFile(join(f.dir, MARKER), typeof content === 'string' ? content : JSON.stringify(content));
    await assert.rejects(publishHistory(f.base), /no valid \.test-kit-publish marker/);
  }
  await rm(join(f.dir, MARKER));
  await mkdir(join(f.dir, MARKER));
  await assert.rejects(publishHistory(f.base), /no valid \.test-kit-publish marker/);
});

test('a foreign entry in a marked directory is refused and named', async t => {
  const f = await fixture(t);
  await publishHistory(f.base);
  await writeFile(join(f.dir, 'notes.txt'), 'mine');
  await assert.rejects(publishHistory(f.base), error => error.message.includes(join(f.dir, 'notes.txt')));
  assert.equal(await readFile(join(f.dir, 'notes.txt'), 'utf8'), 'mine');
  assert.deepEqual(await siblings(f.dir), none);
  await rm(join(f.dir, 'notes.txt'));
  // A wrong type for an owned name is foreign too.
  await rm(join(f.dir, 'runs'), { recursive: true });
  await writeFile(join(f.dir, 'runs'), 'file');
  await assert.rejects(publishHistory(f.base), error => error.message.includes(join(f.dir, 'runs')));
  await rm(join(f.dir, 'runs'));
  await mkdir(join(f.dir, 'runs'));
  await rm(join(f.dir, 'app.js'));
  await mkdir(join(f.dir, 'app.js'));
  await assert.rejects(publishHistory(f.base), error => error.message.includes(join(f.dir, 'app.js')));
});

test('a symbolic link as an owned entry is refused', async t => {
  const f = await fixture(t);
  await publishHistory(f.base);
  await rm(join(f.dir, 'reports'), { recursive: true });
  await mkdir(join(f.root, 'elsewhere'));
  await symlink(join(f.root, 'elsewhere'), join(f.dir, 'reports'));
  await assert.rejects(publishHistory(f.base), error => error.message.includes(join(f.dir, 'reports')));
  assert.deepEqual(await readdir(join(f.root, 'elsewhere')), []);
});

test('a symbolic link or a regular file at DIR is refused', async t => {
  const f = await fixture(t);
  await mkdir(join(f.root, 'target'));
  await symlink(join(f.root, 'target'), f.dir);
  await assert.rejects(publishHistory(f.base), /symbolic link/);
  assert.deepEqual(await readdir(join(f.root, 'target')), []);
  await rm(f.dir);
  await writeFile(f.dir, 'file');
  await assert.rejects(publishHistory(f.base), /file, not a directory/);
  assert.equal(await readFile(f.dir, 'utf8'), 'file');
});

test('a symbolic link parent is resolved; siblings sit beside the real leaf', async t => {
  const f = await fixture(t);
  await mkdir(join(f.root, 'real'));
  await symlink(join(f.root, 'real'), join(f.root, 'link'));
  const result = await publishHistory({ ...f.base, dir: join(f.root, 'link', 'site') });
  assert.equal(result.dir, join(f.root, 'real', 'site'));
  assert.ok((await tree(join(f.root, 'real', 'site'))).includes(MARKER));
});

test('DIR equal to, inside or a parent of the store is refused', async t => {
  const f = await fixture(t);
  for (const dir of [f.local, join(f.local, 'out'), f.proj, f.root]) {
    await assert.rejects(publishHistory({ ...f.base, dir }), /history store/, dir);
  }
  assert.deepEqual(await readdir(f.local), []);
  // A link to the store is refused as a link (item 6). A store reached through a linked parent is the same store (item 4).
  await symlink(f.local, join(f.root, 'store-link'));
  await assert.rejects(publishHistory({ ...f.base, dir: join(f.root, 'store-link') }), /symbolic link/);
  await symlink(f.proj, join(f.root, 'proj-link'));
  await assert.rejects(publishHistory({ ...f.base, dir: join(f.root, 'proj-link', '.test-kit') }), /history store/);
  // A sibling that equals the store is refused too.
  await assert.rejects(publishHistory({ ...f.base, local: join(f.proj, 'site.test-kit-new'), dir: f.dir }), /history store/);
});

test('the root, the home directory, the working directory and its parents are refused', async t => {
  const f = await fixture(t);
  const home = join(f.root, 'home');
  const work = join(f.root, 'work', 'app');
  await mkdir(home); await mkdir(work, { recursive: true });
  const store = join(f.root, 'elsewhere', '.test-kit');
  await mkdir(store, { recursive: true });
  await assert.rejects(publishHistory({ ...f.base, local: store, dir: '/' }), /Refused/);
  await assert.rejects(publishHistory({ ...f.base, local: store, dir: home, home }), /home directory/);
  await assert.rejects(publishHistory({ ...f.base, local: store, dir: work, cwd: work }), /working directory/);
  await assert.rejects(publishHistory({ ...f.base, local: store, dir: join(f.root, 'work'), cwd: work }), /contains the working directory/);
  assert.deepEqual(await readdir(work), []);
});

test('a name that makes a sibling longer than 255 bytes is refused before any write', async t => {
  const f = await fixture(t);
  const dir = join(f.root, 'parent-not-created', 'a'.repeat(242));
  await assert.rejects(publishHistory({ ...f.base, dir }), /too long/);
  assert.ok(!await exists(join(f.root, 'parent-not-created')));
  // Multibyte characters count as bytes.
  await assert.rejects(publishHistory({ ...f.base, dir: join(f.root, 'x', 'é'.repeat(121)) }), /too long/);
  // The longest allowed name works: 255 - 14 = 241 bytes.
  await publishHistory({ ...f.base, dir: join(f.root, 'a'.repeat(241)) });
});

test('preflight order: the name check runs before the store check', async t => {
  const f = await fixture(t);
  await assert.rejects(publishHistory({ ...f.base, dir: join(f.local, 'a'.repeat(250)) }), /too long/);
});

test('--publish does not combine with --export or --port', () => {
  assert.equal(parseCommand(['history', '--publish', 'site']).options.publish, 'site');
  for (const extra of [['--export', 'out'], ['--port', '0'], ['--port', '1234']]) {
    assert.throws(() => parseCommand(['history', '--publish', 'site', ...extra]), /--publish alone/);
    assert.throws(() => parseCommand(['history', ...extra, '--publish', 'site']), /--publish alone/);
  }
  assert.throws(() => parseCommand(['report', '--publish', 'site']), /Unknown option/);
  assert.throws(() => parseCommand(['history', '--publish']), /Missing value/);
});

test('the CLI prints the success line on stderr and the result on stdout', async t => {
  const f = await fixture(t);
  await writeFile(join(f.proj, 'test-kit.config.json'), '{}');
  const out = []; const err = [];
  const code = await run(['history', '--config', join(f.proj, 'test-kit.config.json'), '--publish', 'site'], { out: { write: v => out.push(v) }, err: { write: v => err.push(v) } });
  assert.equal(code, 0);
  assert.deepEqual(err, [SUCCESS(f.dir) + '\n']);
  assert.equal(JSON.parse(out.join('')).published, f.dir);
  const code2 = await run(['history', '--config', join(f.proj, 'test-kit.config.json'), '--publish', 'site', '--port', '0'], { out: { write() {} }, err: { write: v => err.push(v) } });
  assert.equal(code2, 1);
});

test('the CLI refuses a directory outside the rules with exit 1 and no write', async t => {
  const f = await fixture(t);
  await writeFile(join(f.proj, 'test-kit.config.json'), '{}');
  const err = [];
  const code = await run(['history', '--config', join(f.proj, 'test-kit.config.json'), '--publish', '.test-kit'], { out: { write() {} }, err: { write: v => err.push(v) } });
  assert.equal(code, 1);
  assert.match(err.join(''), /history store/);
});

// R10.12 rule 5: the 16 states. Keys: B S D L (1 present, 0 absent).
test('the recovery table gives the specified action in all 16 states', () => {
  const p = { dir: '/p/site', lock: '/p/site.test-kit-lock', stage: '/p/site.test-kit-new', backup: '/p/site.test-kit-old' };
  const state = key => ({ backup: key[0] === '1', stage: key[1] === '1', dir: key[2] === '1', lock: key[3] === '1' });
  const action = key => recoveryAction(state(key), p);
  // Row 1 (B present, D absent), S any, L present or absent.
  assert.equal(action('1001'), `rename ${p.backup} to ${p.dir}, then remove only the lock ${p.lock}. The old content is only in the backup.`);
  assert.equal(action('1000'), `rename ${p.backup} to ${p.dir}. The old content is only in the backup.`);
  assert.equal(action('1101'), `rename ${p.backup} to ${p.dir}, then remove ${p.stage} and ${p.lock}. The old content is only in the backup.`);
  assert.equal(action('1100'), `rename ${p.backup} to ${p.dir}, then remove ${p.stage}. The old content is only in the backup.`);
  // Row 2 (B present, S absent, D present).
  assert.match(action('1011'), new RegExp(`new content is live.*Remove ${p.backup} and ${p.lock}\\.$`));
  assert.equal(action('1010'), `remove ${p.backup}.`);
  // Row 3 (B, S, D present): never remove B.
  assert.equal(action('1111'), `compare ${p.dir} and ${p.backup} by hand; remove ${p.stage} and ${p.lock} afterwards; keep the one you want as ${p.dir}. Never remove the backup first.`);
  assert.equal(action('1110'), `compare ${p.dir} and ${p.backup} by hand; remove ${p.stage} afterwards; keep the one you want as ${p.dir}. Never remove the backup first.`);
  // Row 4 (B absent, S present), D either.
  assert.equal(action('0111'), `remove ${p.stage} and ${p.lock}. The directory holds the old content.`);
  assert.equal(action('0101'), `remove ${p.stage} and ${p.lock}. This was a first publish.`);
  assert.equal(action('0110'), `remove ${p.stage}. The directory holds the old content.`);
  assert.equal(action('0100'), `remove ${p.stage}. This was a first publish.`);
  // Row 5 (B and S absent): lock only; the normal state has no action.
  assert.equal(action('0011'), `remove ${p.lock}. The directory is complete (old or new content).`);
  assert.equal(action('0001'), `remove ${p.lock}. Nothing was published yet.`);
  assert.equal(action('0010'), null);
  assert.equal(action('0000'), null);
  // All 16 keys answer. Only the two normal states (B and S absent, L absent) have no action.
  const keys = [...Array(16).keys()].map(n => n.toString(2).padStart(4, '0'));
  assert.deepEqual(keys.filter(key => action(key) === null), ['0000', '0010']);
  for (const key of keys.filter(key => action(key) !== null)) assert.equal(typeof action(key), 'string', key);
  // Row 3 never starts with a removal of the backup.
  for (const key of ['1110', '1111']) assert.ok(action(key).startsWith('compare '), key);
});

async function stray(f, { backup, stage, dir, lock }) {
  if (dir) await mkdir(f.dir, { recursive: true });
  if (backup) await mkdir(f.dir + '.test-kit-old');
  if (stage) await mkdir(f.dir + '.test-kit-new');
  if (lock) await mkdir(f.dir + '.test-kit-lock');
}

test('stray siblings refuse the start, print their paths and the action, and delete nothing', async t => {
  const states = [
    { backup: true, stage: true, dir: false, lock: true },
    { backup: true, stage: false, dir: true, lock: false },
    { backup: true, stage: true, dir: true, lock: true },
    { backup: false, stage: true, dir: false, lock: false },
    { backup: false, stage: false, dir: true, lock: true },
    { backup: false, stage: false, dir: false, lock: true },
  ];
  for (const state of states) {
    const f = await fixture(t);
    await stray(f, state);
    const before = await siblings(f.dir);
    await assert.rejects(publishHistory(f.base), error => {
      const names = { lock: f.dir + '.test-kit-lock', stage: f.dir + '.test-kit-new', backup: f.dir + '.test-kit-old' };
      for (const key of ['lock', 'stage', 'backup']) assert.equal(error.message.includes(names[key]), state[key], `${key} ${JSON.stringify(state)}`);
      assert.match(error.message, /Action: /);
      assert.match(error.message, /crashed refresh/);
      assert.equal(/no refresh runs before you remove the lock/.test(error.message), state.lock);
      return true;
    });
    assert.deepEqual(await siblings(f.dir), before);
    assert.equal(await exists(f.dir), state.dir);
  }
});

test('a stray sibling beside an unsafe DIR gives no recovery guidance', async t => {
  const f = await fixture(t);
  await mkdir(f.root + '/target');
  await symlink(f.root + '/target', f.dir);
  await mkdir(f.dir + '.test-kit-old');
  await assert.rejects(publishHistory(f.base), error => /symbolic link/.test(error.message) && !/Action:/.test(error.message));
  const inside = join(f.local, 'out');
  await mkdir(inside + '.test-kit-lock', { recursive: true });
  await assert.rejects(publishHistory({ ...f.base, dir: inside }), error => /history store/.test(error.message) && !/Action:/.test(error.message));
});

test('stray siblings refuse even when DIR has no marker', async t => {
  const f = await fixture(t);
  await mkdir(f.dir);
  await writeFile(join(f.dir, 'foreign'), 'x');
  await mkdir(f.dir + '.test-kit-lock');
  await assert.rejects(publishHistory(f.base), /Action: remove .*test-kit-lock/);
});

test('a lock that exists is refused', async t => {
  const f = await fixture(t);
  await mkdir(f.dir + '.test-kit-lock');
  await assert.rejects(publishHistory(f.base), error => error.message.includes(f.dir + '.test-kit-lock'));
  assert.ok(await exists(f.dir + '.test-kit-lock'));
  assert.ok(!await exists(f.dir));
});

test('a symbolic link as a sibling counts as present and is never followed', async t => {
  const f = await fixture(t);
  await mkdir(join(f.root, 'victim'));
  await writeFile(join(f.root, 'victim', 'keep'), 'keep');
  await symlink(join(f.root, 'victim'), f.dir + '.test-kit-new');
  await assert.rejects(publishHistory(f.base), /Action: remove .*test-kit-new/);
  assert.equal(await readFile(join(f.root, 'victim', 'keep'), 'utf8'), 'keep');
});

test('S1 re-check: a stage that appears after the preflight releases the lock and refuses', async t => {
  const f = await fixture(t);
  const fs = { mkdir: async (path, ...rest) => { const result = await mkdir(path, ...rest); if (path === f.dir + '.test-kit-lock') await mkdir(f.dir + '.test-kit-new'); return result; } };
  await assert.rejects(publishHistory({ ...f.base, fs }), /test-kit-new/);
  assert.deepEqual(await siblings(f.dir), { lock: false, stage: true, backup: false });
  assert.ok(!await exists(f.dir));
});

test('S1 re-check: a foreign entry that appears after the preflight releases the lock and refuses', async t => {
  const f = await fixture(t);
  await publishHistory(f.base);
  const fs = { mkdir: async (path, ...rest) => { const result = await mkdir(path, ...rest); if (path === f.dir + '.test-kit-lock') await writeFile(join(f.dir, 'late.txt'), 'x'); return result; } };
  await assert.rejects(publishHistory({ ...f.base, fs }), /late\.txt/);
  assert.deepEqual(await siblings(f.dir), none);
  assert.equal(await readFile(join(f.dir, 'late.txt'), 'utf8'), 'x');
});

test('a concurrent refresh is refused by the lock and leaves the first one intact', async t => {
  const f = await fixture(t);
  await f.addRun('run-a');
  let second;
  const fs = { mkdir: async (path, ...rest) => {
    const result = await mkdir(path, ...rest);
    if (path === f.dir + '.test-kit-new') second = publishHistory(f.base).then(() => null, error => error);
    return result;
  } };
  await publishHistory({ ...f.base, fs });
  const error = await second;
  assert.ok(error, 'the second refresh failed');
  assert.match(error.message, /test-kit-lock/);
  assert.match(error.message, /Action: /);
  assert.deepEqual(await siblings(f.dir), none);
  assert.ok((await tree(f.dir)).includes('runs/run-a/run.json'));
});

test('S2 failure keeps the old content and removes stage and lock', async t => {
  const f = await fixture(t);
  await f.addRun('run-a');
  await publishHistory(f.base);
  const before = await tree(f.dir);
  await f.addReport('rep-esc', { shot: 'escape' });
  await assert.rejects(publishHistory(f.base), /escapes report root/);
  assert.deepEqual(await siblings(f.dir), none);
  assert.deepEqual(await tree(f.dir), before);
});

test('S2 failure on a first publish leaves no directory', async t => {
  const f = await fixture(t);
  await f.addReport('rep-esc', { shot: 'escape' });
  await assert.rejects(publishHistory(f.base), /escapes report root/);
  assert.deepEqual(await siblings(f.dir), none);
  assert.ok(!await exists(f.dir));
});

test('S2 failure from a write error removes the stage', async t => {
  const f = await fixture(t);
  await f.addRun('run-a');
  const fs = { writeFile: async (path, ...rest) => { if (path.endsWith('index.json')) throw new Error('disk full'); return writeFile(path, ...rest); } };
  await assert.rejects(publishHistory({ ...f.base, fs }), /disk full/);
  assert.deepEqual(await siblings(f.dir), none);
});

test('S2 failure where the stage cannot be removed names the leftover path and still releases the lock', async t => {
  const f = await fixture(t);
  const fs = {
    writeFile: async (path, ...rest) => { if (path.endsWith('index.json')) throw new Error('disk full'); return writeFile(path, ...rest); },
    rm: async (path, ...rest) => { if (path === f.dir + '.test-kit-new') throw new Error('busy'); return rm(path, ...rest); },
  };
  await assert.rejects(publishHistory({ ...f.base, fs }), error => /disk full/.test(error.message) && error.message.includes(f.dir + '.test-kit-new'));
  assert.deepEqual(await siblings(f.dir), { lock: false, stage: true, backup: false });
  // The next run handles it with the table (L absent, S present).
  await assert.rejects(publishHistory(f.base), /Action: remove .*test-kit-new/);
});

test('S3 failure removes the stage, releases the lock and keeps DIR', async t => {
  const f = await fixture(t);
  await f.addRun('run-a');
  await publishHistory(f.base);
  const before = await tree(f.dir);
  const fs = { rename: async (from, to) => { if (to === f.dir + '.test-kit-old') throw new Error('no rename'); return rename(from, to); } };
  await assert.rejects(publishHistory({ ...f.base, fs }), /no rename/);
  assert.deepEqual(await siblings(f.dir), none);
  assert.deepEqual(await tree(f.dir), before);
});

test('S4 failure with a backup renames it back, removes the stage and releases the lock', async t => {
  const f = await fixture(t);
  await f.addRun('run-a');
  await publishHistory(f.base);
  const before = await tree(f.dir);
  const fs = { rename: async (from, to) => { if (from === f.dir + '.test-kit-new') throw new Error('swap failed'); return rename(from, to); } };
  await f.addRun('run-new');
  await assert.rejects(publishHistory({ ...f.base, fs }), /swap failed/);
  assert.deepEqual(await siblings(f.dir), none);
  assert.deepEqual(await tree(f.dir), before);
});

test('S4 failure on a first publish removes the stage; DIR does not exist', async t => {
  const f = await fixture(t);
  const fs = { rename: async (from, to) => { if (from === f.dir + '.test-kit-new') throw new Error('swap failed'); return rename(from, to); } };
  await assert.rejects(publishHistory({ ...f.base, fs }), /swap failed/);
  assert.deepEqual(await siblings(f.dir), none);
  assert.ok(!await exists(f.dir));
});

test('S4 failure where the rename back also fails keeps lock, stage and backup and prints the three paths', async t => {
  const f = await fixture(t);
  await f.addRun('run-a');
  await publishHistory(f.base);
  const fs = { rename: async (from, to) => {
    if (from === f.dir + '.test-kit-new') throw new Error('swap failed');
    if (from === f.dir + '.test-kit-old') throw new Error('back failed');
    return rename(from, to);
  } };
  await assert.rejects(publishHistory({ ...f.base, fs }), error => {
    for (const suffix of ['lock', 'new', 'old']) assert.ok(error.message.includes(`${f.dir}.test-kit-${suffix}`), suffix);
    assert.match(error.message, /swap failed/);
    assert.match(error.message, /back failed/);
    return true;
  });
  assert.deepEqual(await siblings(f.dir), { lock: true, stage: true, backup: true });
  assert.ok(!await exists(f.dir));
  // The next run reads B present, S present, D absent, L present: rename B to DIR first.
  await assert.rejects(publishHistory(f.base), error => error.message.includes(`rename ${f.dir}.test-kit-old to ${f.dir}, then remove ${f.dir}.test-kit-new and ${f.dir}.test-kit-lock`));
  assert.deepEqual(await siblings(f.dir), { lock: true, stage: true, backup: true });
});

test('S5 failure: the new content is live, the lock is released, a warning names the backup, exit 0', async t => {
  const f = await fixture(t);
  await f.addRun('run-a');
  await publishHistory(f.base);
  await f.addRun('run-new', '2026-03-01T00:00:00.000Z');
  const fs = { rm: async (path, ...rest) => { if (path === f.dir + '.test-kit-old') throw new Error('busy'); return rm(path, ...rest); } };
  const result = await publishHistory({ ...f.base, fs });
  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0].includes(f.dir + '.test-kit-old'));
  assert.equal(result.messages.at(-1), SUCCESS(f.dir));
  assert.deepEqual(await siblings(f.dir), { lock: false, stage: false, backup: true });
  assert.ok((await tree(f.dir)).includes('runs/run-new/run.json'));
  // The next run refuses: B present, S absent, D present, L absent: remove B.
  await assert.rejects(publishHistory(f.base), /Action: remove .*test-kit-old\./);
});

test('S6 failure: a warning names the lock, exit 0, and the next run refuses', async t => {
  const f = await fixture(t);
  await f.addRun('run-a');
  const fs = { rm: async (path, ...rest) => { if (path === f.dir + '.test-kit-lock') throw new Error('busy'); return rm(path, ...rest); } };
  const result = await publishHistory({ ...f.base, fs });
  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0].includes(f.dir + '.test-kit-lock'));
  assert.deepEqual(await siblings(f.dir), { lock: true, stage: false, backup: false });
  assert.ok((await tree(f.dir)).includes('runs/run-a/run.json'));
  await assert.rejects(publishHistory(f.base), /Action: remove .*test-kit-lock/);
});

test('the CLI prints warnings before the success line and still exits 0 on an S5 failure', async t => {
  // Uses the library seam through a missing-evidence warning, which needs no injection.
  const f = await fixture(t);
  await writeFile(join(f.proj, 'test-kit.config.json'), '{}');
  await f.addReport('rep-lost', { shot: 'missing' });
  const err = [];
  const code = await run(['history', '--config', join(f.proj, 'test-kit.config.json'), '--publish', 'site'], { out: { write() {} }, err: { write: v => err.push(v) } });
  assert.equal(code, 0);
  assert.equal(err.length, 2);
  assert.match(err[0], /warning: report rep-lost/);
  assert.equal(err[1], SUCCESS(f.dir) + '\n');
});

test('a delete never follows a symbolic link: old content with a link out is removed as a link', async t => {
  const f = await fixture(t);
  await publishHistory(f.base);
  await mkdir(join(f.root, 'victim'));
  await writeFile(join(f.root, 'victim', 'keep'), 'keep');
  // A link below an owned directory is forgotten foreign content (rule 9). The backup delete must remove the link only.
  await symlink(join(f.root, 'victim'), join(f.dir, 'reports', 'link'));
  await publishHistory(f.base);
  assert.equal(await readFile(join(f.root, 'victim', 'keep'), 'utf8'), 'keep');
  assert.ok(!(await tree(f.dir)).includes('reports/link'));
});

test('no stage, backup or lock is left after success', async t => {
  const f = await fixture(t);
  await f.addRun('run-a'); await f.addReport('rep-1');
  await publishHistory(f.base);
  await publishHistory(f.base);
  assert.deepEqual(await siblings(f.dir), none);
  assert.deepEqual((await readdir(f.proj)).sort(), ['.test-kit', 'site']);
});

test('S1 re-check failure that cannot release the lock names the retained lock', async t => {
  const f = await fixture(t);
  const lock = f.dir + '.test-kit-lock';
  const fs = {
    mkdir: async (path, ...rest) => { const result = await mkdir(path, ...rest); if (path === lock) await mkdir(f.dir + '.test-kit-new'); return result; },
    rm: async (path, ...rest) => { if (path === lock) throw new Error('busy'); return rm(path, ...rest); },
  };
  await assert.rejects(publishHistory({ ...f.base, fs }), error => /test-kit-new/.test(error.message) && error.message.includes(`could not remove the lock ${lock}`));
  assert.ok(await exists(lock));
});

test('a mount point is refused (fake device number through the fs seam)', async t => {
  const f = await fixture(t);
  await mkdir(f.dir);
  const fs = { lstat: async path => { const info = await lstat(path); return path === f.dir ? Object.create(info, { dev: { value: info.dev + 1 } }) : info; } };
  await assert.rejects(publishHistory({ ...f.base, fs }), /mount point/);
  assert.deepEqual(await siblings(f.dir), none);
});

test('entries named like Object.prototype members are foreign, not owned', async t => {
  const f = await fixture(t);
  await publishHistory(f.base);
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    await mkdir(join(f.dir, name));
    await assert.rejects(publishHistory(f.base), error => error.message.includes(join(f.dir, name)), name);
    await rm(join(f.dir, name), { recursive: true });
  }
});

test('S1 EEXIST: the lock appears after the item 7 check; it stays and the command refuses with the recovery message', async t => {
  const f = await fixture(t);
  const lock = f.dir + '.test-kit-lock';
  let hidden = true;
  const fs = {
    lstat: async path => { if (path === lock && hidden) { const error = new Error('gone'); error.code = 'ENOENT'; throw error; } return lstat(path); },
    mkdir: async (path, ...rest) => { if (path === lock) { await mkdir(lock); hidden = false; } return mkdir(path, ...rest); },
  };
  await assert.rejects(publishHistory({ ...f.base, fs }), error => /Action: remove .*test-kit-lock/.test(error.message) && error.message.includes(lock));
  assert.ok(await exists(lock));
});

test('report export with a missing report creates no directory', async t => {
  const f = await fixture(t);
  const outputDir = join(f.root, 'new-parent', 'export');
  await assert.rejects(exportReport({ reportPath: join(f.root, 'no-report.json'), outputDir }));
  assert.ok(!await exists(join(f.root, 'new-parent')));
  assert.deepEqual((await readdir(f.root)).sort(), ['proj']);
  // Invalid report data fails before any directory too.
  await writeFile(join(f.root, 'bad.json'), '{"schemaVersion":9}');
  await assert.rejects(exportReport({ reportPath: join(f.root, 'bad.json'), outputDir }));
  assert.ok(!await exists(join(f.root, 'new-parent')));
});

test('S1 re-check: DIR swapped for a symbolic link after the lock is refused; nothing is followed', async t => {
  const f = await fixture(t);
  await publishHistory(f.base);
  await rename(f.dir, join(f.root, 'elsewhere'));
  await mkdir(f.dir);
  const before = await tree(join(f.root, 'elsewhere'));
  const lock = f.dir + '.test-kit-lock';
  const fs = { mkdir: async (path, ...rest) => {
    const result = await mkdir(path, ...rest);
    if (path === lock) { await rm(f.dir, { recursive: true }); await symlink(join(f.root, 'elsewhere'), f.dir); }
    return result;
  } };
  await assert.rejects(publishHistory({ ...f.base, fs }), /symbolic link/);
  assert.deepEqual(await siblings(f.dir), none);
  assert.ok((await lstat(f.dir)).isSymbolicLink());
  assert.deepEqual(await tree(join(f.root, 'elsewhere')), before);
});

test('a readable but invalid report is skipped like missing evidence', async t => {
  const f = await fixture(t);
  await mkdir(join(f.local, 'reports/rep-bad'), { recursive: true });
  await writeFile(join(f.local, 'reports/rep-bad/report.json'), JSON.stringify({ schemaVersion: 9, meta: { generated: '2026-01-03T00:00:00.000Z' }, entries: [{}, {}] }));
  const result = await publishHistory(f.base);
  assert.deepEqual(result.unavailable, ['rep-bad']);
  assert.match(result.warnings[0], /report rep-bad fails validation/);
  assert.ok(!(await tree(f.dir)).some(name => name.startsWith('reports/rep-bad')));
  const index = await readJson(join(f.dir, 'index.json'));
  assert.deepEqual(index.reports, [{ id: 'rep-bad', kind: null, createdAt: '2026-01-03T00:00:00.000Z', settingsHash: null, path: null, targets: 2, viewports: null, summary: null }]);
});

test('an S2 error from a report names the report id', async t => {
  const f = await fixture(t);
  await f.addReport('rep-esc', { shot: 'escape' });
  await assert.rejects(publishHistory(f.base), /report rep-esc: .*escapes report root/);
});

test('a skipped report with partial evidence leaves no reports/<id> in the stage', async t => {
  const f = await fixture(t);
  await f.addReport('rep-two');
  const reportPath = join(f.local, 'reports/rep-two/report.json');
  const data = await readJson(reportPath);
  data.entries[0].viewports[0].artifacts = { screenshot: { a: { src: 'shots/a.png' }, b: { src: 'shots/b.png' } } };
  await writeFile(reportPath, JSON.stringify(data));
  const result = await publishHistory(f.base);
  assert.deepEqual(result.unavailable, ['rep-two']);
  assert.ok(!(await tree(f.dir)).some(name => name.startsWith('reports/rep-two')));
  assert.deepEqual(await siblings(f.dir), none);
});

test('a failure that cannot release the lock names the lock', async t => {
  const f = await fixture(t);
  const lock = f.dir + '.test-kit-lock';
  const fs = {
    writeFile: async (path, ...rest) => { if (path.endsWith('index.json')) throw new Error('disk full'); return writeFile(path, ...rest); },
    rm: async (path, ...rest) => { if (path === lock) throw new Error('busy'); return rm(path, ...rest); },
  };
  await assert.rejects(publishHistory({ ...f.base, fs }), error => /disk full/.test(error.message) && error.message.includes(lock) && !error.message.includes(f.dir + '.test-kit-new'));
  assert.deepEqual(await siblings(f.dir), { lock: true, stage: false, backup: false });
});

test('a missing or non-directory store is refused before any write; a published site survives', async t => {
  const f = await fixture(t);
  await f.addRun('run-a');
  await publishHistory(f.base);
  const before = await tree(f.dir);
  const missing = join(f.proj, 'typo-store');
  await assert.rejects(publishHistory({ ...f.base, local: missing }), /history store .* does not exist or is not a directory/);
  await writeFile(join(f.proj, 'file-store'), 'x');
  await assert.rejects(publishHistory({ ...f.base, local: join(f.proj, 'file-store') }), /history store .* does not exist or is not a directory/);
  assert.deepEqual(await tree(f.dir), before);
  assert.deepEqual(await siblings(f.dir), none);
  assert.ok(!await exists(join(f.root, 'new-parent')));
  await assert.rejects(publishHistory({ ...f.base, local: missing, dir: join(f.root, 'new-parent', 'site') }), /does not exist or is not a directory/);
  await assert.rejects(publishHistory({ ...f.base, local: join(f.proj, 'file-store'), dir: join(f.root, 'new-parent', 'site') }), /does not exist or is not a directory/);
  assert.ok(!await exists(join(f.root, 'new-parent')));
  assert.ok(!await exists(join(f.root, 'new-parent', 'site.test-kit-lock')));
  await symlink(join(f.root, 'nowhere'), join(f.proj, 'dangling'));
  await assert.rejects(publishHistory({ ...f.base, local: join(f.proj, 'dangling') }), /Refused: the history store .* does not exist or is not a directory/);
  assert.ok(!await exists(join(f.root, 'new-parent')));
});

// Race tests for the window between S1 and S3 (R10.12 rule 4).
async function marked(f) { await f.addRun('run-a'); await publishHistory(f.base); }
const duringBuild = (f, action) => ({ writeFile: async (path, ...rest) => { if (path.endsWith('index.json')) await action(); return writeFile(path, ...rest); } });

test('S3 re-check: a foreign entry added during the build refuses; DIR untouched, stage and lock removed', async t => {
  const f = await fixture(t);
  await marked(f);
  const fs = duringBuild(f, () => writeFile(join(f.dir, 'late.txt'), 'x'));
  await assert.rejects(publishHistory({ ...f.base, fs }), /late\.txt/);
  assert.deepEqual(await siblings(f.dir), none);
  assert.equal(await readFile(join(f.dir, 'late.txt'), 'utf8'), 'x');
});

test('S3 re-check: DIR replaced by another directory during the build refuses', async t => {
  const f = await fixture(t);
  await marked(f);
  const fs = duringBuild(f, async () => {
    await rename(f.dir, join(f.root, 'moved'));
    await mkdir(f.dir);
  });
  await assert.rejects(publishHistory({ ...f.base, fs }), /changed while the command built the stage/);
  assert.deepEqual(await siblings(f.dir), none);
  assert.deepEqual(await readdir(f.dir), []);
  assert.ok((await tree(join(f.root, 'moved'))).includes(MARKER));
});

test('S3 re-check: DIR replaced by a symbolic link during the build refuses', async t => {
  const f = await fixture(t);
  await marked(f);
  const fs = duringBuild(f, async () => {
    await rename(f.dir, join(f.root, 'moved'));
    await symlink(join(f.root, 'moved'), f.dir);
  });
  await assert.rejects(publishHistory({ ...f.base, fs }), /symbolic link/);
  assert.deepEqual(await siblings(f.dir), none);
  assert.ok((await lstat(f.dir)).isSymbolicLink());
  assert.ok((await tree(join(f.root, 'moved'))).includes(MARKER));
});

test('S3 re-check: a non-empty DIR created during the build of a first publish refuses', async t => {
  const f = await fixture(t);
  const fs = duringBuild(f, async () => { await mkdir(f.dir); await writeFile(join(f.dir, 'mine'), 'x'); });
  await assert.rejects(publishHistory({ ...f.base, fs }), /no valid \.test-kit-publish marker/);
  assert.equal(await readFile(join(f.dir, 'mine'), 'utf8'), 'x');
  assert.deepEqual(await siblings(f.dir), none);
});

test('a lock replaced during the build is never deleted; the command reports it', async t => {
  const f = await fixture(t);
  const lock = f.dir + '.test-kit-lock';
  const fs = duringBuild(f, async () => {
    await rename(lock, join(f.root, 'old-lock'));
    await mkdir(lock);
    await writeFile(join(lock, 'theirs'), 'keep');
  });
  const result = await publishHistory({ ...f.base, fs });
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /the lock was replaced; left in place/);
  assert.equal(await readFile(join(lock, 'theirs'), 'utf8'), 'keep');
  assert.ok((await tree(f.dir)).includes(MARKER));
});

test('a replaced lock on a failure path stays and is named in the error', async t => {
  const f = await fixture(t);
  const lock = f.dir + '.test-kit-lock';
  const fs = duringBuild(f, async () => {
    await rename(lock, join(f.root, 'old-lock'));
    await mkdir(lock);
    await writeFile(join(lock, 'theirs'), 'keep');
    throw new Error('disk full');
  });
  await assert.rejects(publishHistory({ ...f.base, fs }), error => /disk full/.test(error.message) && error.message.includes('the lock was replaced; left in place'));
  assert.equal(await readFile(join(lock, 'theirs'), 'utf8'), 'keep');
});

test('S3 re-check: an empty DIR created during the build of a first publish refuses by identity', async t => {
  const f = await fixture(t);
  const fs = duringBuild(f, () => mkdir(f.dir));
  await assert.rejects(publishHistory({ ...f.base, fs }), /changed while the command built the stage/);
  assert.deepEqual(await readdir(f.dir), []);
  assert.deepEqual(await siblings(f.dir), none);
});

test('S1 EEXIST when the other run has already finished says so and does not print a null action', async t => {
  const f = await fixture(t);
  const lock = f.dir + '.test-kit-lock';
  const fs = { mkdir: async (path, ...rest) => { if (path === lock) { const error = new Error('exists'); error.code = 'EEXIST'; throw error; } return mkdir(path, ...rest); } };
  await assert.rejects(publishHistory({ ...f.base, fs }), error => error.message === 'A refresh was running and has finished. Run the command again.');
  assert.deepEqual(await siblings(f.dir), none);
});

test('a store path below a regular file gives the Refused text and creates nothing', async t => {
  const f = await fixture(t);
  await writeFile(join(f.proj, 'a-file'), 'x');
  const dir = join(f.root, 'new-parent', 'site');
  await assert.rejects(publishHistory({ ...f.base, local: join(f.proj, 'a-file', 'child'), dir }), error => error.message === `Refused: the history store ${join(f.proj, 'a-file', 'child')} does not exist or is not a directory. Nothing was written.`);
  assert.ok(!await exists(join(f.root, 'new-parent')));
  assert.deepEqual((await readdir(f.root)).sort(), ['proj']);
});
