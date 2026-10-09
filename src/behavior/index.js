import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { contractApplicability, validateContracts } from './contracts.js';
export { collectContracts, validateContracts, contractApplicability, DEFAULT_PROJECTS } from './contracts.js';
export { loadProjectContracts } from './registry.js';
export { loadBehaviorSource } from './source.js';
export { validateBehaviorSnapshot } from './snapshot.js';
export { compareBehavior } from './compare.js';
export const BEHAVIOR_VERSION = '1';
const text = value => String(value ?? '').slice(0, 2000);
const bounded = value => { try { const encoded = JSON.stringify(value ?? null); return encoded.length <= 4000 ? JSON.parse(encoded) : { omitted: true }; } catch { return { omitted: true }; } };

// The capture owner supplies an already guarded, navigated page (R4.2).
export async function runBehavior({ page, contracts, projectName, libraryVersions = {}, contractFingerprints = {}, emulate = {}, eagerImages = false, artifactDir, relativeDir, timeoutMs = 10000, maxInstances = 20, trace = false }) {
  validateContracts(contracts);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('Behavior timeout must be between 1 and 120000 ms.');
  if (!Number.isInteger(maxInstances) || maxInstances < 1 || maxInstances > 100) throw new Error('Behavior instance limit must be between 1 and 100.');
  if (!relativeDir || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(relativeDir)) throw new Error('Behavior evidence needs a plain relative directory.');
  for (const [name, hash] of Object.entries(contractFingerprints)) { if (!contracts.some(contract => contract.name === name) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Contract fingerprints must bind a selected contract to a SHA-256 hash.'); }
  const directory = resolve(artifactDir);
  await mkdir(directory, { recursive: true });
  const settings = { contracts: contracts.map(c => ({ name: c.name, projects: c.projects ?? null, library: c.library ?? null, emulate: c.emulate ?? null, eagerImages: !!c.eagerImages, source: createHash('sha256').update(`${c.detect}\n${c.run}\n${c.runScoping ?? ''}`).digest('hex') })), projectName, libraryVersions, contractFingerprints, emulate, eagerImages, timeoutMs, maxInstances, trace };
  const settingsHash = createHash('sha256').update(JSON.stringify(settings)).digest('hex');
  const steps = [], consoleEvents = [], network = [], dataLayer = [];
  const capture = (list, value) => { if (list.length < 100) list.push(value); };
  const onConsole = message => capture(consoleEvents, { type: message.type(), text: text(message.text()) });
  const onError = error => capture(consoleEvents, { type: 'pageerror', text: text(error.message) });
  const onResponse = response => capture(network, { path: (() => { try { const u = new URL(response.url()); return u.pathname.slice(0, 2000); } catch { return ''; } })(), status: response.status() });
  page.on('console', onConsole); page.on('pageerror', onError); page.on('response', onResponse);
  let timedOut = false, tracing = false, traceError;
  if (trace) { try { await page.context().tracing.start({ screenshots: true, snapshots: true }); tracing = true; } catch (error) { traceError = text(error.message); } }
  const execute = async (id, title, operation) => {
    const step = { id, title, state: 'complete', result: null, evidence: {} };
    const offsets = [consoleEvents.length, network.length, dataLayer.length];
    let timer;
    try {
      step.result = bounded(await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error('Behavior step timed out.')); }, timeoutMs); })]));
    } catch (error) { step.state = 'failed'; step.error = text(error.message); }
    finally { clearTimeout(timer); }
    if (timedOut) await page.context().close().catch(() => {});
    if (!timedOut) try { const layer = await page.evaluate(() => Array.isArray(window.dataLayer) ? window.dataLayer.slice(-100).map(value => { try { const encoded = JSON.stringify(value ?? null); return encoded.length <= 4000 ? JSON.parse(encoded) : { omitted: true }; } catch { return { omitted: true }; } }) : []); dataLayer.splice(0, dataLayer.length, ...layer.map(bounded)); } catch {}
    step.evidence.console = consoleEvents.slice(offsets[0]); step.evidence.network = network.slice(offsets[1]); step.evidence.dataLayer = dataLayer.slice(offsets[2]);
    if (!timedOut) {
      try { const name = `${id}.png`; await page.screenshot({ path: join(directory, name), timeout: timeoutMs }); step.evidence.screenshot = `${relativeDir}/${name}`; } catch (error) { step.evidence.screenshotError = text(error.message); }
    }
    steps.push(step);
    return step;
  };
  try {
    for (const contract of contracts) {
      if (timedOut) { steps.push({ id: contract.name, title: contract.name, state: 'skipped', result: null, reason: 'A prior step timed out.' }); continue; }
      const applicability = contractApplicability(contract, { projectName, libraryVersions, emulate, eagerImages });
      if (applicability.state !== 'ready') { steps.push({ id: contract.name, title: contract.name, result: null, ...applicability }); continue; }
      let instances;
      const detection = await execute(`${contract.name}-detect`, `${contract.name}: detect`, async () => { instances = await contract.detect(page); if (!Array.isArray(instances)) throw new Error('Contract detect must return an array.'); if (instances.length > maxInstances) throw new Error('Contract instance limit exceeded.'); return { instances: instances.length }; });
      if (detection.state === 'failed') continue;
      if (!instances.length) { steps.push({ id: contract.name, title: contract.name, state: 'skipped', result: null, reason: 'No contract marker on this target.' }); continue; }
      for (let index = 0; index < instances.length && !timedOut; index++) await execute(`${contract.name}-${index + 1}`, `${contract.name}: instance ${index + 1}`, () => contract.run(page, instances[index]));
      if (!timedOut && instances.length > 1 && contract.runScoping) await execute(`${contract.name}-scoping`, `${contract.name}: instance isolation`, () => contract.runScoping(page, instances));
    }
  } finally {
    page.off('console', onConsole); page.off('pageerror', onError); page.off('response', onResponse);
    if (tracing && !timedOut) { try { await page.context().tracing.stop({ path: join(directory, 'trace.zip') }); } catch (error) { traceError = text(error.message); tracing = false; } }
  }
  const result = { tool: 'test-kit-behavior', version: BEHAVIOR_VERSION, settingsHash, settings, state: steps.some(step => step.state === 'failed' || step.state === 'incompatible') ? 'failed' : steps.some(step => step.state === 'complete' && !step.id.endsWith('-detect')) ? 'complete' : 'missing', steps };
  if (tracing && !timedOut) result.trace = `${relativeDir}/trace.zip`;
  if (traceError) result.traceError = traceError;
  await writeFile(join(directory, 'results.json'), JSON.stringify(result));
  return result;
}
