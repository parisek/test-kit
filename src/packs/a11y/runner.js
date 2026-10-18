// Thin runner. It injects axe-core into a Playwright page and returns a stored `a11y` artifact.
// axe-core is an optional peer dependency. This file is the only place that reads it.
// It never throws for a bad run. It returns a `missing` or `failed` artifact (R8.7).
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { reduceAxeResults, gapArtifact } from './axe.js';

const require = createRequire(import.meta.url);
const DEFAULT_TIMEOUT_MS = 30000;

async function loadSource(axePath) {
  try {
    return await readFile(axePath ?? require.resolve('axe-core/axe.min.js'), 'utf8');
  } catch {
    return null;
  }
}

// `page` is a Playwright page that is already on the URL to check.
// Options: `tags` (axe rule tags, for example ['wcag2a', 'wcag2aa']), `timeoutMs`, `axePath` (path to axe.min.js).
export async function runAxe(page, { tags, timeoutMs = DEFAULT_TIMEOUT_MS, axePath } = {}) {
  const source = await loadSource(axePath);
  if (source === null) return gapArtifact('missing', 'axe-core is not installed.');
  let timer;
  try {
    const run = (async () => {
      await page.evaluate(source);
      return page.evaluate(options => globalThis.axe.run(document, options), tags ? { runOnly: { type: 'tag', values: tags } } : {});
    })();
    run.catch(() => {}); // a late failure after a timeout is not an unhandled rejection
    const raw = await Promise.race([run, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`axe did not finish in ${timeoutMs} ms.`)), timeoutMs); })]);
    return reduceAxeResults(raw);
  } catch (error) {
    return gapArtifact('failed', error?.message ?? error);
  } finally {
    clearTimeout(timer);
  }
}
