// Runs the selected page packs on the page that capture already has open (R13.51).
// It adds no navigation and no request. The a11y runner injects axe with `page.evaluate` (R4.2, R3.5).
// A bad run gives a stored artifact with status `missing` or `failed`. It never throws for a pack (R8.7).
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const MAX_BYTES = 2 * 1024 * 1024;
export const PACK_ARTIFACT = Object.freeze({ a11y: { tool: 'axe-core' } });

async function loadRunner(id) {
  if (id === 'a11y') return (await import('../packs/a11y/runner.js')).runAxe;
  throw new Error(`Pack ${id} has no page runner.`);
}

// Returns { <kind>: index } for each page pack. `runners` lets a test inject a runner.
// The sidecar holds the artifact value, also for `missing` and `failed`, so the reason stays readable.
export async function runPagePacks({ page, ids, runDir, targetId, viewportId, timeoutMs, settingsHash, browserVersion, runners = {} }) {
  const artifacts = {};
  for (const id of ids) {
    const index = { kind: id, tool: PACK_ARTIFACT[id].tool, version: 'unknown', settingsHash, browserVersion };
    const path = `${id}/${targetId}/${viewportId}.json`;
    let file;
    try {
      const run = runners[id] ?? await loadRunner(id);
      const value = await run(page, { timeoutMs });
      const bytes = Buffer.from(JSON.stringify(value));
      if (!value || typeof value !== 'object' || bytes.length > MAX_BYTES) throw new Error('The pack result is not usable or exceeds its limit.');
      file = join(runDir, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes, { mode: 0o600 });
      if (typeof value.version === 'string' && value.version) index.version = value.version.slice(0, 200);
      Object.assign(index, { path, bytes: bytes.length });
      artifacts[id] = value.status === 'complete'
        ? { ...index, state: 'captured' }
        : { ...index, state: 'failed', error: { code: value.status === 'missing' ? 'PACK_MISSING' : 'PACK_FAILED', message: String(value.reason ?? 'The pack did not complete.').slice(0, 300) } };
    } catch (error) {
      if (file) await unlink(file).catch(() => {});
      artifacts[id] = { ...index, state: 'failed', error: { code: 'PACK_FAILED', message: String(error?.message ?? error).slice(0, 300) } };
    }
  }
  return artifacts;
}
