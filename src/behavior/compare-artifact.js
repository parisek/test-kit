import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { readSidecar } from '../artifacts/compare.js';
import { artifactState } from '../artifacts/state.js';
import { settingsHash, settleRecipe, settlementMatches } from '../config/settings.js';
import { relativePath } from '../report/safe.js';
import { validateBehaviorSnapshot } from './snapshot.js';
import { compareBehavior } from './compare.js';
import { BEHAVIOR_VERSION } from './index.js';
import { DEFAULT_PROJECTS } from './contracts.js';
import { LEGACY_BEHAVIOR_CHECK, LEGACY_BEHAVIOR_ID, behaviorCheckId } from '../report/catalog.js';

// The contracts selected for one viewport, read from the settings of the stored snapshot (owner decision 2).
// A contract is selected when it applies to the project name of the viewport. An unmet library version
// or media setting is an outcome (`incompatible`), not a different selection.
function selectedContracts(snapshot) {
  const settings = snapshot?.settings;
  if (!settings || !Array.isArray(settings.contracts) || snapshot.version === '1') return null;
  return settings.contracts.filter(contract => (contract.projects ?? DEFAULT_PROJECTS).includes(settings.projectName));
}

export async function compareBehaviorArtifact({ a, b, ac, bc, runsRoot, output, targetId, viewportId }) {
  for (const id of [targetId, viewportId, a.id, b.id]) if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Unsafe behavior scope.');
  const indexes = [ac?.artifacts?.behavior, bc?.artifacts?.behavior];
  const artifact = { kind: 'behavior', state: artifactState(...indexes), a: null, b: null, diff: null };
  const viewport = run => run.settings.viewports.find(item => item.id === viewportId);
  if (indexes.every(Boolean) && (['tool', 'version', 'settingsHash', 'browserVersion'].some(key => indexes[0][key] !== indexes[1][key]) || settingsHash(viewport(a)) !== settingsHash(viewport(b)) || settingsHash(a.captureSettings?.browser ?? null) !== settingsHash(b.captureSettings?.browser ?? null))) artifact.state = 'incompatible';
  if (indexes.every(Boolean)) {
    try {
      const targets = [a, b].map(run => run.settings.targets.find(target => target.id === targetId));
      const recipes = [a, b].map((run, index) => settleRecipe(run.settings, run.side, targets[index]));
      if (![a, b].every((run, index) => settlementMatches([ac, bc][index], run.settings, run.side, targets[index]))
        || settingsHash(recipes[0]) !== settingsHash(recipes[1])) artifact.state = 'incompatible';
    } catch { artifact.state = 'incompatible'; }
  }
  const incompatible = artifact.state === 'incompatible';
  const snapshots = [];
  for (const [index, run, side] of [[indexes[0], a, 'a'], [indexes[1], b, 'b']]) {
    if (!index?.path) { snapshots.push(null); continue; }
    try {
      const bytes = await readSidecar(join(runsRoot, run.id), index.path);
      const snapshot = validateBehaviorSnapshot(JSON.parse(bytes));
      if (snapshot.settingsHash !== index.settingsHash || snapshot.version !== index.version || snapshot.tool !== index.tool) throw new Error('Behavior provenance differs.');
      const paths = new Set(snapshot.steps.map(step => step.evidence?.screenshot).filter(Boolean));
      if (snapshot.trace) paths.add(snapshot.trace);
      for (const path of paths) {
        if (!relativePath(path)) throw new Error('Unsafe behavior evidence path.');
        let evidence;
        try { evidence = await readSidecar(join(runsRoot, run.id), path, 32 * 1024 * 1024); } catch {
          artifact.state = 'failed'; artifact.diagnostic = 'A behavior recording is missing or exceeds its limit.';
          for (const step of snapshot.steps) if (step.evidence?.screenshot === path) { delete step.evidence.screenshot; step.evidence.screenshotError = 'Stored screenshot is unavailable.'; }
          if (snapshot.trace === path) delete snapshot.trace;
          continue;
        }
        const src = `runs/${run.id}/${path}`;
        await mkdir(dirname(join(output, src)), { recursive: true }); await writeFile(join(output, src), evidence);
      }
      for (const step of snapshot.steps) if (step.evidence?.screenshot) step.evidence.screenshot = `runs/${run.id}/${step.evidence.screenshot}`;
      if (snapshot.trace) snapshot.trace = `runs/${run.id}/${snapshot.trace}`;
      const src = `runs/${run.id}/${index.path}`;
      await mkdir(dirname(join(output, src)), { recursive: true }); await writeFile(join(output, src), bytes);
      artifact[side] = { kind: 'behavior', src, tool: index.tool, version: index.version, settingsHash: index.settingsHash, browserVersion: index.browserVersion };
      snapshots.push(snapshot);
    } catch { snapshots.push(null); artifact.state = 'failed'; artifact.diagnostic = 'Behavior sidecar or evidence is missing, invalid, or exceeds its limit.'; }
  }
  let detail;
  if (snapshots.every(Boolean)) detail = compareBehavior(...snapshots);
  else detail = { state: artifact.state, steps: (snapshots[0]?.steps ?? snapshots[1]?.steps ?? []).map(step => ({ id: step.id, title: step.title, state: 'failed', contract: step.contract ?? null, resultA: snapshots[0] ? step : null, resultB: snapshots[1] ? step : null })) };
  if (incompatible) artifact.state = 'incompatible';
  if (artifact.state === 'incompatible') detail = { ...detail, state: 'incompatible' };
  else if (detail.state !== 'complete') artifact.state = detail.state;
  if (artifact.state === 'failed' && detail.state === 'complete') detail.state = 'failed';
  detail.traceA = snapshots[0]?.trace ?? null; detail.traceB = snapshots[1]?.trace ?? null;
  const changed = detail.steps.some(step => step.state !== 'same');
  const src = `diff/behavior/${targetId}/${viewportId}.json`;
  await mkdir(dirname(join(output, src)), { recursive: true }); await writeFile(join(output, src), JSON.stringify({ ...detail, changed }));
  artifact.diff = { kind: 'behavior', src, tool: 'test-kit-behavior-compare', version: BEHAVIOR_VERSION, settingsHash: indexes[1]?.settingsHash ?? indexes[0]?.settingsHash ?? '', changed, steps: detail.steps.length };
  if (artifact.state !== 'complete') artifact.diagnostic ??= 'Behavior evidence is missing, failed, or incompatible.';
  // One catalog entry for each selected contract. A `-detect` or `-scoping` step folds into its contract (ADR 0004, question 1).
  const catalog = {};
  const selected = selectedContracts(snapshots[1] ?? snapshots[0]);
  for (const contract of selected ?? []) catalog[behaviorCheckId(contract.name)] = { basis: 'relative', layer: contract.origin, title: contract.name };
  if (selected) artifact.scope = { checks: selected.map(contract => behaviorCheckId(contract.name)) };
  const origins = new Map(snapshots.flatMap(snapshot => (snapshot?.settings?.contracts ?? []).map(contract => [contract.name, contract.origin])));
  const identity = step => {
    if (!step.contract) { catalog[LEGACY_BEHAVIOR_ID] ??= { ...LEGACY_BEHAVIOR_CHECK }; return { checkId: LEGACY_BEHAVIOR_ID, layer: LEGACY_BEHAVIOR_CHECK.layer }; }
    const checkId = behaviorCheckId(step.contract);
    catalog[checkId] ??= { basis: 'relative', layer: origins.get(step.contract) ?? 'project', title: step.contract };
    return { checkId, layer: catalog[checkId].layer };
  };
  const findings = artifact.state === 'incompatible' ? [] : detail.steps.filter(step => step.state !== 'same').map(step => ({ id: `behavior-${targetId}-${viewportId}-${step.id}`, targetId, viewportId, artifact: 'behavior', ...identity(step), causeId: null, message: `${step.title}: ${step.state}`, severity: step.state === 'failed' ? 'error' : 'warning' }));
  return { artifact, findings, catalog };
}
