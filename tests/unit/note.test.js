import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
