import * as nodeFs from 'node:fs/promises';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { historyEvidencePath, scanHistory } from '../history/index.js';
import { writeIfAbsent } from '../config/store.js';
import { boundedRead } from '../server/files.js';
import { buildPublishIndex } from './index-file.js';
import { prepareReportEvidence } from './report.js';

// The store viewer (R10.16, #312): the viewer files and `index.json` at the root of the store.
// It reads the store in place. It copies nothing and replaces no folder. Each write is a temp file plus a rename.

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
export const VIEWER_FILES = ['index.html', 'app.js', 'style.css', 'favicon.svg'];
// A static server sends these as active content. Publish renames them to inert names. The store viewer cannot.
export const VIEWER_MARKER = '.test-kit-viewer';
const MARKER_BODY = `${JSON.stringify({ tool: 'test-kit', kind: 'store-viewer', schemaVersion: 1 })}\n`;
const ACTIVE = /\.(?:html?|xhtml|svg|js|mjs)$/i;
const ROUNDS = 4;

const inside = (parent, child) => {
  const offset = relative(parent, child);
  return offset !== '' && offset !== '..' && !offset.startsWith('../') && !isAbsolute(offset);
};

// Atomic file write: a temp file beside the target, then a rename. A failure removes the temp file.
async function writeAtomic(fs, path, bytes) {
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' });
    await fs.rename(temporary, path);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

// The marker says the viewer wrote the files here. A store with a viewer file name and no marker is not ours:
// write nothing. Only a regular file (not a link, not a folder) with exactly MARKER_BODY counts; any other
// marker is foreign. Returns { warning } when the store is foreign, else { fresh }: `fresh` is true when this
// call created the marker. A fresh claim then writes every viewer file and the first index.json without
// replacing anything, so a foreign file that appears after the check is never overwritten (#312).
const foreignWarning = store => `test-kit: warning: store ${store} holds files the viewer did not write; the viewer was not written.`;
async function claimStore(fs, store) {
  const marker = join(store, VIEWER_MARKER);
  let info = null;
  try { info = await fs.lstat(marker); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (info) {
    if (!info.isFile() || info.size !== Buffer.byteLength(MARKER_BODY)) return { warning: foreignWarning(store) };
    return (await fs.readFile(marker, 'utf8')) === MARKER_BODY ? { fresh: false } : { warning: foreignWarning(store) };
  }
  for (const name of [...VIEWER_FILES, 'index.json']) {
    try { await fs.lstat(join(store, name)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    return { warning: foreignWarning(store) };
  }
  if (await writeIfAbsent(marker, MARKER_BODY, { fs })) return { fresh: true };
  // Another process created a marker meanwhile: judge it like any existing marker.
  return claimStore(fs, store);
}

// Returns false when a fresh claim met a foreign file (nothing of it was replaced), else true.
async function copyViewer(fs, store, fresh) {
  for (const name of VIEWER_FILES) {
    const bytes = await boundedRead(join(packageRoot, 'viewer', name));
    if (fresh) {
      if (await writeIfAbsent(join(store, name), bytes, { fs })) continue;
      const current = await fs.readFile(join(store, name)).catch(() => null);
      if (current && current.equals(bytes)) continue;
      return false;
    }
    let current = null;
    try { current = await fs.readFile(join(store, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current && current.equals(bytes)) continue;
    await writeAtomic(fs, join(store, name), bytes);
  }
  return true;
}

// A report is listed with a path only when the viewer can read its evidence in place without active content.
// Returns null when the report is usable, else the reason.
async function reportProblem(store, id) {
  let prepared;
  try { prepared = await prepareReportEvidence(await historyEvidencePath(store, 'reports', id, 'report.json')); }
  catch (error) {
    if (error.code === 'EINVALIDREPORT') return `fails validation (${error.message})`;
    if (error.code === 'ENOENT' || error.code === 'EFBIG') return `has missing or oversized evidence (${error.code})`;
    return `cannot be read (${error.message})`;
  }
  const { root, files } = prepared;
  for (const [src, descriptor] of files) {
    if (ACTIVE.test(src)) return `holds active content (${src}). Run history --publish DIR to get an inert copy`;
    try {
      const real = await nodeFs.realpath(join(root, src));
      if (!inside(root, real)) return `holds evidence outside its folder (${src})`;
      const info = await nodeFs.stat(real);
      if (!info.isFile() || info.size > descriptor.maxBytes) return `has missing or oversized evidence (${src})`;
    } catch { return `has missing or oversized evidence (${src})`; }
  }
  return null;
}

async function build(store, now) {
  const history = await scanHistory(store);
  const unavailable = [];
  const warnings = [];
  for (const { id, value } of history.reports) {
    if (!value) continue;
    const problem = await reportProblem(store, id);
    if (problem) { unavailable.push(id); warnings.push(`test-kit: warning: report ${id} ${problem}. It is listed without a path.`); }
  }
  const index = buildPublishIndex(history, { now, unavailableReportIds: unavailable });
  return { index, unavailable, warnings, runCount: index.runs.filter(row => row.path).length, reportCount: index.reports.filter(row => row.path).length };
}

const sameListing = (a, b) => JSON.stringify({ ...a, generatedAt: 0 }) === JSON.stringify({ ...b, generatedAt: 0 });

/**
 * Write the viewer files and `index.json` at the root of the store.
 * `fs` overrides single `node:fs/promises` functions (a test seam).
 * A run or report that appears during the refresh is picked up: the index is checked against the store after each write.
 * @param {{ store: string, now?: Date|number|string, fs?: object }} options
 * @returns {Promise<{ store: string, runCount: number, reportCount: number, unavailable: string[], warnings: string[] }>}
 */
export async function refreshStoreViewer({ store, now = new Date(), fs: seam } = {}) {
  if (typeof store !== 'string' || !store) throw new Error('The store viewer needs a store.');
  const fs = { ...nodeFs, ...seam };
  const root = await nodeFs.realpath(store);
  if (!(await nodeFs.stat(root)).isDirectory()) throw new Error(`The store ${store} is not a directory.`);
  const blocked = warning => ({ store: root, runCount: 0, reportCount: 0, unavailable: [], warnings: [warning] });
  const claim = await claimStore(fs, root);
  if (claim.warning) return blocked(claim.warning);
  if (!(await copyViewer(fs, root, claim.fresh))) return blocked(foreignWarning(root));
  let result = await build(root, now);
  if (claim.fresh && !(await writeIfAbsent(join(root, 'index.json'), `${JSON.stringify(result.index, null, 2)}\n`, { fs }))) return blocked(foreignWarning(root));
  let settled = false;
  for (let round = 0; round < ROUNDS && !settled; round++) {
    await writeAtomic(fs, join(root, 'index.json'), `${JSON.stringify(result.index, null, 2)}\n`);
    const next = await build(root, now);
    settled = sameListing(result.index, next.index);
    result = next;
  }
  if (!settled) {
    // The store changed on every rescan. Write the last scan so index.json is never older than the last look at the store.
    await writeAtomic(fs, join(root, 'index.json'), `${JSON.stringify(result.index, null, 2)}\n`);
    result.warnings.push(`test-kit: warning: index.json did not settle after ${ROUNDS} rounds. It lists the store as the last scan saw it.`);
  }
  return { store: root, runCount: result.runCount, reportCount: result.reportCount, unavailable: result.unavailable, warnings: result.warnings };
}
