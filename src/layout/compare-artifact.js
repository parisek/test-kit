// The layout artifact of one cell in a pair report (R6.15, R9.13). It reads the two stored files,
// writes the difference sidecar and returns the artifact index and the relative findings.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { readSidecar } from '../artifacts/compare.js';
import { artifactState } from '../artifacts/state.js';
import { settingsHash, settleRecipe, settlementMatches } from '../config/settings.js';
import { isDesignRun } from '../design/compare.js';
import { LAYOUT_CHECK_ID } from '../report/catalog.js';
import { normalizeLayoutConfig, normalizeLayoutParts } from './declaration.js';
import { validateLayoutSnapshot, MAX_LAYOUT_BYTES, INVALID_LAYOUT } from './snapshot.js';
import { compareLayout, boundComparison, differenceMessage, LENGTH_TOLERANCE, RATIO_TOLERANCE } from './compare.js';
import { LAYOUT_VERSION } from './record.js';

// The report index lists the first differences. The sidecar holds them up to its byte limit, and `query` reads it.
export const REPORT_DIFFERENCES = 50;
// The findings of one cell. The class needs one; the counts in the index stay complete.
export const MAX_FINDINGS = 100;

const declared = (run, targetId) => {
  const target = run.settings.targets.find(item => item.id === targetId);
  if (target?.layout === undefined) return null;
  try { return normalizeLayoutParts(target.layout); } catch { return 'invalid'; }
};
// The comparison binds the part IDs and repeat flags. A selector may differ between the two sides.
const shape = declaration => declaration.parts.map(part => [part.id, part.repeat === true]);

// The state of the two stored entries of a pair with a design run (R8.15, #350 part C). The extractor must be the
// same: tool and version. The settings hash and the browser version do not decide, as for the screenshot of a design
// pair: a design run binds the provider and the viewports, a browser run its settle recipe and browser settings.
export function designPairState(a, b) {
  if (!a || !b) return 'missing';
  if (a.state !== 'captured' || b.state !== 'captured') return 'failed';
  if (!['tool', 'version', 'settingsHash', 'browserVersion'].every(key => [a, b].every(index => typeof index[key] === 'string' && index[key].length > 0 && index[key].length <= 200))
    || a.tool !== b.tool || a.version !== b.version) return 'incompatible';
  return 'complete';
}

export async function compareLayoutArtifact({ a, b, ac, bc, runsRoot, output, targetId, viewportId }) {
  const indexes = [ac?.artifacts?.layout, bc?.artifacts?.layout];
  const declarations = [declared(a, targetId), declared(b, targetId)];
  // A target that declares no parts on either side has no layout artifact (R6.14).
  if (!indexes.some(Boolean) && declarations.every(item => item === null)) return null;
  const design = isDesignRun(a) || isDesignRun(b);
  const artifact = { kind: 'layout', state: design ? designPairState(...indexes) : artifactState(...indexes), scope: { checks: [LAYOUT_CHECK_ID] }, a: null, b: null, diff: null };
  const fail = (state, diagnostic) => { artifact.state = state; artifact.diagnostic ??= diagnostic; return { artifact, findings: [] }; };
  // A `files` or `figma` design run holds raster images only. A `claude-design` run renders a document, so its
  // import reads layout records like a browser capture (#350 part C).
  const raster = run => isDesignRun(run) && run.settings.sides[run.side].provider !== 'claude-design';
  if (raster(a) || raster(b)) return fail('missing', 'The layout artifact applies to browser sides and claude-design sides only.');
  if (declarations.includes('invalid')) return fail('failed', 'A stored layout declaration is invalid.');
  if (artifact.state !== 'complete') return fail(artifact.state, 'Requested layout evidence is missing, failed, or incompatible.');
  const viewport = run => run.settings.viewports.find(item => item.id === viewportId);
  if (declarations.includes(null) || JSON.stringify(shape(declarations[0])) !== JSON.stringify(shape(declarations[1])))
    return fail('incompatible', 'Layout parts differ: the two runs declare other part IDs or repeat flags.');
  if (settingsHash(viewport(a)) !== settingsHash(viewport(b)) || (!design && settingsHash(a.captureSettings?.browser ?? null) !== settingsHash(b.captureSettings?.browser ?? null)))
    return fail('incompatible', 'Layout viewports or browser settings differ.');
  // R8.15: a design run has no browser and no settle recipe that decides compatibility. The viewport and the part shape do.
  if (!design) try {
    const targets = [a, b].map(run => run.settings.targets.find(target => target.id === targetId));
    const recipes = [a, b].map((run, index) => settleRecipe(run.settings, run.side, targets[index]));
    if (![a, b].every((run, index) => settlementMatches([ac, bc][index], run.settings, run.side, targets[index])) || settingsHash(recipes[0]) !== settingsHash(recipes[1]))
      return fail('incompatible', 'Layout settle recipes differ.');
  } catch { return fail('incompatible', 'Layout settle recipes differ.'); }
  // The comparison policy comes from the settings of run B, as the content checks do. Stored data is untrusted.
  let aliases;
  try { aliases = b.settings.layout === undefined ? {} : normalizeLayoutConfig(b.settings.layout).aliases ?? {}; }
  catch { return fail('failed', 'The stored layout aliases are invalid.'); }
  const snapshots = [];
  for (const [index, run, side, declaration] of [[indexes[0], a, 'a', declarations[0]], [indexes[1], b, 'b', declarations[1]]]) {
    try {
      if (typeof index.path !== 'string' || index.path !== `layout/${targetId}/${viewportId}.json`) throw new Error('Unexpected layout path.');
      const bytes = await readSidecar(join(runsRoot, run.id), index.path, MAX_LAYOUT_BYTES);
      if (index.sha256 !== 'sha256:' + createHash('sha256').update(bytes).digest('hex')) throw new Error('Layout file changed after capture.');
      const snapshot = validateLayoutSnapshot(JSON.parse(bytes));
      if (JSON.stringify(snapshot.parts.map(part => [part.id, part.repeat])) !== JSON.stringify(shape(declaration))) throw new Error('Layout file and declaration differ.');
      const src = `runs/${run.id}/${index.path}`;
      await mkdir(dirname(join(output, src)), { recursive: true }); await writeFile(join(output, src), bytes);
      artifact[side] = { kind: 'layout', src, tool: index.tool, version: index.version, settingsHash: index.settingsHash, browserVersion: index.browserVersion, bytes: bytes.length };
      snapshots.push(snapshot);
    } catch (error) {
      // A refusal of the reader names the run side, the part, the property and the value (#384). It is built from safe
      // text only (`snapshot.js`). Any other error keeps the generic text: a path, a hash or a parse error stays out.
      if (error?.code === INVALID_LAYOUT && typeof error.message === 'string') return fail('failed', `The layout file of run ${side.toUpperCase()} is invalid. ${error.message.slice(0, 400)}`);
      return fail('failed', 'A layout file is missing, changed, invalid, or exceeds its limit.');
    }
  }
  const detail = compareLayout(...snapshots, { aliases });
  const src = `diff/layout/${targetId}/${viewportId}.json`;
  await mkdir(dirname(join(output, src)), { recursive: true }); // The sidecar fits the read limit of `query`: the list stops at the byte bound, and the cut is counted.
  await writeFile(join(output, src), JSON.stringify(boundComparison(detail)));
  const policy = { lengthTolerance: LENGTH_TOLERANCE, ratioTolerance: RATIO_TOLERANCE, aliases };
  artifact.diff = { kind: 'layout', src, tool: 'test-kit-layout-compare', version: LAYOUT_VERSION, settingsHash: settingsHash(policy), changed: detail.changed,
    checks: 1, counts: detail.counts, differences: detail.differences.slice(0, REPORT_DIFFERENCES), differencesOmitted: Math.max(0, detail.differences.length - REPORT_DIFFERENCES),
    // The findings stop at MAX_FINDINGS. The key says how many differences have no finding, so a reader sees the cut.
    ...(detail.differences.length > MAX_FINDINGS ? { findingsOmitted: detail.differences.length - MAX_FINDINGS } : {}) };
  // A finding names its part and property, so a decision binds it without reading the message (R9.14).
  const findings = detail.differences.slice(0, MAX_FINDINGS).map((item, index) => ({ id: `layout-${targetId}-${viewportId}-${index}`, targetId, viewportId,
    artifact: 'layout', checkId: LAYOUT_CHECK_ID, layer: 'package', severity: 'warning', message: differenceMessage(item), part: item.part, property: item.property }));
  // The full list stays in memory for the decisions of this cell: a decided difference beyond the finding cap still gets a status.
  return { artifact, findings, differences: detail.differences };
}
