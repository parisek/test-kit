// R12.7, #381: server facts of a run. A note is a free JSON object that a workflow attaches to a stored run.
// The run directory keeps its files. A note is a new file in `runs/<id>/notes/`. Nothing reads a note for a verdict.
import { lstat, mkdir, open, readdir, realpath, writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { validId } from './valid-id.js';
import { assertPlainStorePath } from './prune.js';

export const MAX_NOTE_BYTES = 256 * 1024;
export const MAX_NOTES = 100;
const NAME = /^(\d{3})\.json$/;

// Pure: parse the text of a facts file. It must be one JSON object, at most MAX_NOTE_BYTES.
export function parseFacts(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_NOTE_BYTES) throw new Error(`The facts file must be at most ${MAX_NOTE_BYTES} bytes.`);
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('The facts file must be valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The facts file must hold one JSON object.');
  return value;
}

// Pure: the stored form of one note, and the check of a stored note.
export function noteRecord(facts, createdAt) {
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) throw new Error('Invalid note time.');
  return { schemaVersion: 1, createdAt, facts };
}
export function validNote(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && value.schemaVersion === 1
    && typeof value.createdAt === 'string' && !Number.isNaN(Date.parse(value.createdAt))
    && !!value.facts && typeof value.facts === 'object' && !Array.isArray(value.facts)
    && Object.keys(value).length === 3;
}

async function runDirectory({ configDir, store, run }) {
  if (!validId(run)) throw new Error('Invalid run ID.');
  await assertPlainStorePath(configDir, store);
  const root = await realpath(store);
  const dir = join(root, 'runs', run);
  let info;
  try { info = await lstat(dir); } catch (error) { if (error.code === 'ENOENT') throw new Error(`There is no run ${run} in the store.`); throw error; }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('The run must be a plain directory.');
  const runs = await lstat(join(root, 'runs'));
  if (runs.isSymbolicLink()) throw new Error('The runs folder must not be a symbolic link.');
  const offset = relative(root, await realpath(dir));
  if (!offset || offset.startsWith('..') || isAbsolute(offset)) throw new Error('The run escapes the store.');
  try { if (!(await lstat(join(dir, 'run.json'))).isFile()) throw new Error(); } catch { throw new Error(`The run ${run} has no run.json.`); }
  return dir;
}

async function readBounded(path) {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_NOTE_BYTES + 1024) throw new Error();
    return (await handle.readFile()).toString('utf8');
  } finally { await handle.close(); }
}

async function noteFiles(dir) {
  const notes = join(dir, 'notes');
  let info;
  try { info = await lstat(notes); } catch (error) { if (error.code === 'ENOENT') return { notes, names: [] }; throw error; }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('The notes folder must be a plain directory.');
  return { notes, names: (await readdir(notes)).filter(name => NAME.test(name)).sort() };
}

// Add one note. The file name is the next free number, and the write fails if the file exists.
export async function addNote({ configDir, store, run, text, now = () => new Date().toISOString() }) {
  const facts = parseFacts(text);
  const dir = await runDirectory({ configDir, store, run });
  const { notes, names } = await noteFiles(dir);
  if (names.length >= MAX_NOTES) throw new Error(`The run already has ${MAX_NOTES} notes.`);
  const next = names.length ? Number(NAME.exec(names.at(-1))[1]) + 1 : 1;
  if (next > 999) throw new Error('No free note number is left.');
  await mkdir(notes, { recursive: true, mode: 0o700 });
  const name = `${String(next).padStart(3, '0')}.json`;
  const record = noteRecord(facts, now());
  await writeFile(join(notes, name), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { run, note: `notes/${name}`, createdAt: record.createdAt };
}

// List the notes of a run in order. A malformed note stays in the list with `error`.
export async function listNotes({ configDir, store, run }) {
  const dir = await runDirectory({ configDir, store, run });
  const { notes, names } = await noteFiles(dir);
  const result = [];
  for (const name of names) {
    try {
      const value = JSON.parse(await readBounded(join(notes, name)));
      if (!validNote(value)) throw new Error();
      result.push({ note: `notes/${name}`, createdAt: value.createdAt, facts: value.facts });
    } catch { result.push({ note: `notes/${name}`, error: 'The note is unreadable or malformed.' }); }
  }
  return { run, notes: result };
}
