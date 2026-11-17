import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseFacts, noteRecord, validNote, addNote, listNotes, MAX_NOTE_BYTES, MAX_NOTES } from '../../src/history/note.js';
import { parseCommand, dispatch } from '../../src/cli/run.js';

// R12.7, #381: server facts attach to a stored run as notes.
test('parseFacts takes one bounded JSON object (R12.7)', () => {
  assert.deepEqual(parseFacts('{"versions":{"core":"6.8"}}'), { versions: { core: '6.8' } });
  for (const bad of ['[]', '"x"', 'null', '1', '{', `{"a":"${'x'.repeat(MAX_NOTE_BYTES)}"}`]) assert.throws(() => parseFacts(bad), /facts file/, bad.slice(0, 20));
});

test('a stored note has a fixed shape (R12.7)', () => {
  const record = noteRecord({ a: 1 }, '2026-11-17T08:00:00.000Z');
  assert.equal(validNote(record), true);
  for (const bad of [null, [], { ...record, schemaVersion: 2 }, { ...record, createdAt: 'x' }, { ...record, facts: [] }, { ...record, extra: 1 }]) assert.equal(validNote(bad), false);
  assert.throws(() => noteRecord({}, 'not a time'));
});

async function store(t) {
  const root = await mkdtemp(join(tmpdir(), 'tk-note-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const local = join(root, 'test-kit');
  await mkdir(join(local, 'runs', 'run-1'), { recursive: true });
  await writeFile(join(local, 'runs', 'run-1', 'run.json'), '{}');
  return { root, local };
}

test('addNote writes numbered files and changes no file of the run (R12.7)', async t => {
  const { root, local } = await store(t);
  let tick = 0;
  const now = () => `2026-11-17T08:0${tick++}:00.000Z`;
  const first = await addNote({ configDir: root, store: local, run: 'run-1', text: '{"versions":{"core":"6.8"}}', now });
  const second = await addNote({ configDir: root, store: local, run: 'run-1', text: '{"backup":"dump-1"}', now });
  assert.deepEqual([first.note, second.note], ['notes/001.json', 'notes/002.json']);
  assert.equal(await readFile(join(local, 'runs', 'run-1', 'run.json'), 'utf8'), '{}');
  const listed = await listNotes({ configDir: root, store: local, run: 'run-1' });
  assert.deepEqual(listed.notes.map(item => item.facts), [{ versions: { core: '6.8' } }, { backup: 'dump-1' }]);
  assert.equal(listed.notes[0].createdAt, '2026-11-17T08:00:00.000Z');
  await writeFile(join(local, 'runs', 'run-1', 'notes', '003.json'), '{"broken":');
  assert.equal((await listNotes({ configDir: root, store: local, run: 'run-1' })).notes[2].error, 'The note is unreadable or malformed.');
  assert.deepEqual((await listNotes({ configDir: root, store: local, run: 'run-1' })).notes.length, 3);
});

test('addNote refuses a bad run, a link and too many notes (R12.7)', async t => {
  const { root, local } = await store(t);
  const add = run => addNote({ configDir: root, store: local, run, text: '{}' });
  await assert.rejects(add('../run-1'), /Invalid run ID/);
  await assert.rejects(add('missing'), /no run missing/);
  await mkdir(join(local, 'runs', 'empty'));
  await assert.rejects(add('empty'), /no run.json/);
  const outside = join(root, 'outside');
  await mkdir(outside); await writeFile(join(outside, 'run.json'), '{}');
  await symlink(outside, join(local, 'runs', 'linked'));
  await assert.rejects(add('linked'), /plain directory/);
  await assert.rejects(addNote({ configDir: root, store: local, run: 'run-1', text: '[]' }), /one JSON object/);
  await mkdir(join(local, 'runs', 'run-1', 'notes'));
  for (let index = 1; index <= MAX_NOTES; index++) await writeFile(join(local, 'runs', 'run-1', 'notes', `${String(index).padStart(3, '0')}.json`), '{}');
  await assert.rejects(add('run-1'), /already has 100 notes/);
  assert.equal((await readdir(join(local, 'runs', 'run-1', 'notes'))).length, MAX_NOTES);
});

test('note takes one run and --file, --config and --store (R12.7)', async t => {
  assert.deepEqual(parseCommand(['note', 'run-1', '--file', 'facts.json']).options, { file: 'facts.json' });
  assert.throws(() => parseCommand(['note']), /positional/);
  assert.throws(() => parseCommand(['note', 'run-1', '--yes']), /Unknown option/);
  const { root, local } = await store(t);
  await writeFile(join(root, 'test-kit.config.json'), '{}');
  await writeFile(join(root, 'facts.json'), '{"log":{"highWater":120}}');
  const config = join(root, 'test-kit.config.json');
  const added = await dispatch(parseCommand(['note', 'run-1', '--file', join(root, 'facts.json'), '--config', config]));
  assert.equal(added.output.note, 'notes/001.json');
  const listed = await dispatch(parseCommand(['note', 'run-1', '--config', config]));
  assert.deepEqual(listed.output.notes[0].facts, { log: { highWater: 120 } });
  assert.ok(local);
});

test('addNote refuses a linked store, runs or notes folder and a held lock (R12.7)', async t => {
  const { root, local } = await store(t);
  const add = (options = {}) => addNote({ configDir: root, store: local, run: 'run-1', text: '{}', ...options });
  const outside = join(root, 'outside');
  await mkdir(join(outside, 'runs', 'run-1'), { recursive: true });
  await writeFile(join(outside, 'runs', 'run-1', 'run.json'), '{}');
  const linkedStore = join(root, 'linked-store');
  await symlink(outside, linkedStore);
  await assert.rejects(addNote({ configDir: root, store: linkedStore, run: 'run-1', text: '{}' }), /symbolic links/);
  await assert.rejects(addNote({ configDir: root, store: join(root, 'absent'), run: 'run-1', text: '{}' }), error => error.message === `There is no store at ${join(root, 'absent')}.`);
  await mkdir(join(local, 'lock'));
  await assert.rejects(add(), /already owns this store/);
  await rm(join(local, 'lock'), { recursive: true });
  await mkdir(join(outside, 'notes'));
  await symlink(join(outside, 'notes'), join(local, 'runs', 'run-1', 'notes'));
  await assert.rejects(add(), /notes folder must be a plain directory/);
  assert.deepEqual(await readdir(join(outside, 'notes')), []);
  await rm(join(local, 'runs', 'run-1', 'notes'));
  await rm(join(local, 'runs', 'run-1'), { recursive: true });
  await rm(join(local, 'runs'), { recursive: true });
  await symlink(join(outside, 'runs'), join(local, 'runs'));
  await assert.rejects(add(), /runs folder must not be a symbolic link/);
  assert.deepEqual(await readdir(join(outside, 'runs', 'run-1')), ['run.json']);
});

test('addNote never replaces a file that appears under its name (R12.7)', async t => {
  const { root, local } = await store(t);
  const notes = join(local, 'runs', 'run-1', 'notes');
  await mkdir(notes);
  // The clock runs after the name is chosen. It plants a file under that name, as a second writer would.
  const now = () => { writeFileSync(join(notes, '001.json'), 'planted'); return '2026-11-17T08:00:00.000Z'; };
  await assert.rejects(addNote({ configDir: root, store: local, run: 'run-1', text: '{}', now }), { code: 'EEXIST' });
  assert.equal(await readFile(join(notes, '001.json'), 'utf8'), 'planted');
});

test('listNotes marks a note of the wrong shape and note refuses a FIFO as --file (R12.7)', async t => {
  const { root, local } = await store(t);
  const notes = join(local, 'runs', 'run-1', 'notes');
  await mkdir(notes);
  await writeFile(join(notes, '001.json'), JSON.stringify({ schemaVersion: 2, createdAt: '2026-11-17T08:00:00.000Z', facts: {} }));
  assert.deepEqual((await listNotes({ configDir: root, store: local, run: 'run-1' })).notes, [{ note: 'notes/001.json', error: 'The note is unreadable or malformed.' }]);
  await writeFile(join(root, 'test-kit.config.json'), '{}');
  const fifo = join(root, 'facts.fifo');
  try { execFileSync('mkfifo', [fifo]); } catch { t.skip('mkfifo is not available'); return; }
  const started = Date.now();
  await assert.rejects(dispatch(parseCommand(['note', 'run-1', '--file', fifo, '--config', join(root, 'test-kit.config.json')])), /--file: The file must be a regular file/);
  assert.ok(Date.now() - started < 2000);
});

test('listNotes never follows a link and bounds what it reads (R12.7)', async t => {
  const { root, local } = await store(t);
  const notes = join(local, 'runs', 'run-1', 'notes');
  const outside = join(root, 'outside');
  await mkdir(outside);
  const good = JSON.stringify({ schemaVersion: 1, createdAt: '2026-11-17T08:00:00.000Z', facts: { secret: 1 } });
  await writeFile(join(outside, 'note.json'), good);
  await symlink(outside, notes);
  await assert.rejects(listNotes({ configDir: root, store: local, run: 'run-1' }), /notes folder must be a plain directory/);
  await rm(notes);
  await mkdir(notes);
  await symlink(join(outside, 'note.json'), join(notes, '001.json'));
  await writeFile(join(notes, '002.json'), JSON.stringify({ schemaVersion: 1, createdAt: '2026-11-17T08:00:00.000Z', facts: { pad: 'x'.repeat(MAX_NOTE_BYTES + 2048) } }));
  await writeFile(join(notes, '003.json'), good);
  const listed = (await listNotes({ configDir: root, store: local, run: 'run-1' })).notes;
  assert.deepEqual(listed.map(item => item.error ?? 'ok'), ['The note is unreadable or malformed.', 'The note is unreadable or malformed.', 'ok']);
  await writeFile(join(root, 'test-kit.config.json'), '{}');
  await writeFile(join(root, 'big.json'), `{"pad":"${'x'.repeat(MAX_NOTE_BYTES)}"}`);
  await assert.rejects(dispatch(parseCommand(['note', 'run-1', '--file', join(root, 'big.json'), '--config', join(root, 'test-kit.config.json')])), /--file: The file must be at most 262144 bytes/);
  await assert.rejects(dispatch(parseCommand(['note', 'run-1', '--file', join(root, 'none.json'), '--config', join(root, 'test-kit.config.json')])), /--file: the file does not exist/);
});

test('a note number is one more than the highest, and a gap is not reused (R12.7)', async t => {
  const { root, local } = await store(t);
  const notes = join(local, 'runs', 'run-1', 'notes');
  await mkdir(notes);
  for (const name of ['001.json', '003.json']) await writeFile(join(notes, name), '{}');
  const added = await addNote({ configDir: root, store: local, run: 'run-1', text: '{}' });
  assert.equal(added.note, 'notes/004.json');
  await writeFile(join(notes, '999.json'), '{}');
  await assert.rejects(addNote({ configDir: root, store: local, run: 'run-1', text: '{}' }), /No free note number/);
});
