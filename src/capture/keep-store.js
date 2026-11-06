// R5.13: the file system side of keep-existing. It lists the runs of a store, newest first, reads each manifest with the
// validated run reader, and copies the stored files of a kept cell into the new run.
// A path comes from a stored manifest, so it is rebuilt from IDs (`expectedFiles`) and checked again here.
import { readdir, lstat, open, mkdir, writeFile, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { readRun } from '../compare/runs.js';
import { relativePath } from '../report/safe.js';
import { runProblem, entryProblem, keptEntry, expectedFiles } from './keep.js';

const MAX_FILE_BYTES = 80_000_000;
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const IHDR = Buffer.from('IHDR');
const MAX_BODY_BYTES = 2 * 1024 * 1024;

// The run IDs of a store, newest first. A run ID starts with its ISO time, so the order of the names is the order of time.
export async function listRunIds(root) {
  let names;
  try { names = await readdir(root, { withFileTypes: true }); } catch { return []; }
  return names.filter(item => item.isDirectory() && !item.isSymbolicLink() && relativePath(item.name)).map(item => item.name).sort().reverse();
}

// No component of the path may be a symbolic link, and the last one must be a regular file.
async function plainFile(base, path) {
  if (!relativePath(path)) throw new Error('Unsafe stored path.');
  let current = base;
  const parts = path.split('/');
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error('A stored path is a symbolic link.');
    if (index < parts.length - 1 ? !info.isDirectory() : !info.isFile()) throw new Error('A stored path is not plain.');
  }
  return current;
}

async function readPlain(base, path, maxBytes) {
  const file = await plainFile(base, path);
  // O_NOFOLLOW closes the gap between the check and the read.
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error('A stored file is too large.');
    return await handle.readFile();
  } finally { await handle.close(); }
}

// Copy the files of one kept entry from the source run to the same paths in the new run.
// All or nothing: a failed copy removes what it wrote and the caller captures the cell fresh.
export async function copyKeptFiles({ sourceDir, runDir, entry, requested }) {
  const written = [];
  try {
    const files = expectedFiles(entry.targetId, entry.viewportId, requested);
    const stored = entry.artifacts ?? {};
    for (const path of Object.values(files)) {
      const bytes = await readPlain(sourceDir, path, MAX_FILE_BYTES);
      if (path === files.screenshot) {
        if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG) || !bytes.subarray(12, 16).equals(IHDR) || bytes.readUInt32BE(16) !== entry.width || bytes.readUInt32BE(20) !== entry.height) throw new Error('A stored screenshot does not match its entry.');
      } else if (path === files.contentBody) {
        // `bodyBytes` is the size before compression.
        if (gunzipSync(bytes, { maxOutputLength: MAX_BODY_BYTES + 1 }).length !== stored.content?.bodyBytes) throw new Error('A stored file does not match its entry.');
      } else {
        const kind = Object.keys(files).find(name => files[name] === path);
        if (bytes.length !== stored[kind]?.bytes) throw new Error('A stored file does not match its entry.');
      }
      const target = join(runDir, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { mode: 0o600, flag: 'wx' });
      written.push(target);
    }
    return true;
  } catch {
    for (const file of written) await unlink(file).catch(() => {});
    return false;
  }
}

// A finder for the cells of one run. It reads runs lazily, newest first, and remembers them.
// `describe(target, viewport)` gives `{ requested, provenance, recipe, settleHash }` for a cell.
export function createKeepFinder({ root, excludeId, current, describe, copy = copyKeptFiles, read = readRun }) {
  let ids;
  let next = 0;
  const loaded = [];
  async function more() {
    ids ??= (await listRunIds(root)).filter(id => id !== excludeId);
    while (next < ids.length) {
      const id = ids[next++];
      let run;
      try { run = await read(root, id); } catch { continue; }
      if (runProblem(run, current) !== null) continue;
      loaded.push({ run, dir: join(root, id) });
      return true;
    }
    return false;
  }
  // The new entry for a cell, or null. The newest eligible run wins. A copy that fails moves on to the next run.
  return async function find({ target, viewport, runDir }) {
    const cell = describe(target, viewport);
    let index = 0;
    while (true) {
      if (index >= loaded.length && !(await more())) return null;
      const { run, dir } = loaded[index++];
      const entry = run.captures.find(item => item.targetId === target.id && item.viewportId === viewport.id);
      if (!entry || entryProblem(entry, run, { ...cell, target, viewport }) !== null) continue;
      if (await copy({ sourceDir: dir, runDir, entry, requested: cell.requested })) return keptEntry(entry, run);
    }
  };
}
