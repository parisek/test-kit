import { mkdir, writeFile, rename, realpath, open, rm } from 'node:fs/promises';
import { resolve, join, relative, dirname, isAbsolute } from 'node:path';
import { loadConfig, designSettings, settingsHash } from '../config/index.js';
import { screenshotScope, settleRecipe } from '../config/settings.js';
import { recordSelection, cellSelected } from '../capture/selection.js';
import { createRunId } from '../capture/helpers.js';
import { gitSha } from '../capture/git.js';
import { designPathProblem } from './paths.js';
import { ensureDefaultRunsIgnore } from '../config/store.js';
import { MAX_DESIGN_BYTES, designProvenance } from './png.js';

export const DESIGN_IMPORT_VERSION = '1.0.0';

// Resolve one image under the side root. The real path must stay inside the real root (R4.6):
// a symlink that leaves the root, in the root or in the path, is refused. Run bytes come from this one read.
export async function readDesignFile(root, source) {
  const problem = designPathProblem(source);
  if (problem) throw new Error(`Design path ${problem}.`);
  let base;
  try { base = await realpath(root); } catch { throw new Error('The design root does not exist.'); }
  let file;
  try { file = await realpath(resolve(base, source)); } catch { throw new Error(`Design image is missing: ${source}`); }
  const offset = relative(base, file);
  if (!offset || offset.startsWith('..') || isAbsolute(offset)) throw new Error(`Design image escapes its root: ${source}`);
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`Design image is not a regular file: ${source}`);
    if (info.size > MAX_DESIGN_BYTES) throw new Error(`Design image exceeds the file size limit: ${source}`);
    const bytes = await handle.readFile();
    if (bytes.length > MAX_DESIGN_BYTES) throw new Error(`Design image exceeds the file size limit: ${source}`);
    return bytes;
  } finally { await handle.close(); }
}

// R4.6: import the supplied images of one design side into an immutable run.
// The work is all-or-nothing: any path or file problem fails the import before a run directory exists.
// Nothing here opens a browser or a network connection.
export async function importDesign({ configPath, side, label = '', runsRoot, targets: selectedTargets, viewports: selectedViewports, baseDir }) {
  const loaded = await loadConfig(configPath, { baseDir });
  const config = loaded.config;
  if (!Object.hasOwn(config.sides, side)) throw new Error(`Unknown side: ${side}`);
  const design = config.sides[side];
  if (design.kind !== 'design') throw new Error(`Side ${side} is not a design side. Use capture for a browser side.`);
  if (typeof label !== 'string' || label.length > 200 || /[\x00-\x1f\x7f]/.test(label)) throw new Error('Run label must be bounded text');
  if (config.targetSource) throw new Error('import reads targets from the configuration only. Remove targetSource or list the targets.');
  const selection = recordSelection(config, { targets: selectedTargets, viewports: selectedViewports });
  const root = resolve(loaded.configDir, design.root);
  const at = new Date();
  const importedAt = at.toISOString();
  // Read and check every image first.
  const images = [];
  for (const target of config.targets) for (const viewport of config.viewports) {
    const source = target.design?.[viewport.id];
    if (source === undefined || !cellSelected(selection, target.id, viewport.id)) continue;
    const bytes = await readDesignFile(root, source);
    let provenance;
    try { provenance = designProvenance({ source, importedAt, bytes }); } catch (error) { throw new Error(`${error.message} (${source})`); }
    images.push({ target, viewport, bytes, provenance });
  }
  if (!images.length) throw new Error('No design image to import. Map a file in target.design for a selected target and viewport.');
  const id = createRunId(at, process.pid, await gitSha(loaded.configDir));
  const runs = runsRoot ? resolve(loaded.configDir, runsRoot) : loaded.runsRoot;
  const runDir = join(runs, id);
  const settings = designSettings(config, side);
  const hash = settingsHash(settings);
  // The stored settings read like those of a capture, so every reader of a run keeps working.
  // A design run holds screenshots only: no other artifact is claimed.
  const stored = { ...config, artifacts: ['screenshot'], checks: [], packs: [] };
  const run = { schemaVersion: 2, id, side, label, at: importedAt, state: 'complete', settings: stored, captureSettings: settings, settingsHash: hash,
    ...(selection ? { selection } : {}), tools: [{ name: 'test-kit-design', version: DESIGN_IMPORT_VERSION, settingsHash: hash }], captures: [] };
  await mkdir(runs, { recursive: true });
  await ensureDefaultRunsIgnore(loaded.configDir, runs);
  await mkdir(runDir);
  try {
    for (const { target, viewport, bytes, provenance } of images) {
      const path = `screenshots/${target.id}/${viewport.id}.png`;
      await mkdir(dirname(join(runDir, path)), { recursive: true });
      await writeFile(join(runDir, path), bytes, { mode: 0o600 });
      // The scope and settle hashes keep the record readable like a capture (known differences bind them).
      run.captures.push({ targetId: target.id, viewportId: viewport.id, settleHash: settingsHash(settleRecipe(config, side, target)),
        scopeHash: settingsHash(screenshotScope(target, side)), state: 'captured', path, width: provenance.width, height: provenance.height,
        deviceScaleFactor: viewport.deviceScaleFactor, artifacts: {}, design: provenance });
    }
    const manifestPath = join(runDir, 'run.json');
    await writeFile(`${manifestPath}.tmp`, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
    await rename(`${manifestPath}.tmp`, manifestPath);
    return { run, runDir, manifestPath };
  } catch (error) {
    await rm(runDir, { recursive: true, force: true });
    throw error;
  }
}
