// Thin runner. It injects axe-core into a Playwright page and returns a stored `a11y` artifact.
// axe-core is an optional peer dependency. This file is the only place that reads it.
// It never throws for a bad run or bad options. It returns a `missing` or `failed` artifact (R8.7).
//
// Limits:
// - After a timeout, axe may still run on the page. Do not reuse that page. A second run on it returns `failed`.
// - Axe runs inside the page. A hostile page can replace `window.axe` and fake a clean result. Run it on pages you control.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { reduceAxeResults, gapArtifact } from './axe.js';

const require = createRequire(import.meta.url);
const DEFAULT_TIMEOUT_MS = 30000;
const BUSY = '__testKitAxeBusy';
const isPlain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));

async function loadSource(axePath) {
  try {
    return await readFile(axePath ?? require.resolve('axe-core/axe.min.js'), 'utf8');
  } catch {
    return null;
  }
}

// Reads each option once. Returns { tags, timeoutMs, axePath } or throws.
function readOptions(options) {
  if (options === undefined || options === null) options = {};
  if (!isPlain(options)) throw new Error('The options must be a plain object.');
  const { tags, timeoutMs = DEFAULT_TIMEOUT_MS, axePath } = options; // one read of each field
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) throw new Error('timeoutMs must be a finite number from 1 to 2147483647.');
  if (axePath !== undefined && (typeof axePath !== 'string' || axePath === '')) throw new Error('axePath must be a path text.');
  let copy;
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.length === 0 || tags.length > 50) throw new Error('tags must be a list of 1 to 50 texts.');
    copy = Array.from({ length: tags.length }, (_, index) => tags[index]); // one read of each element
    if (copy.some(tag => typeof tag !== 'string' || tag === '' || tag.length > 100)) throw new Error('tags must be a list of texts.');
  }
  return { tags: copy, timeoutMs, axePath };
}

// `page` is a Playwright page that is already on the URL to check.
// Options: `tags` (axe rule tags, for example ['wcag2a', 'wcag2aa']), `timeoutMs`, `axePath` (path to axe.min.js).
// Every step that touches the page runs inside the timer, so a busy page cannot hang the caller.
export async function runAxe(page, options) {
  let timer;
  let timedOut = false;
  try {
    const { tags, timeoutMs, axePath } = readOptions(options);
    const run = (async () => {
      const source = await loadSource(axePath);
      if (source === null) return gapArtifact('missing', 'axe-core is not installed.');
      // One atomic step claims the page. A second run, or a run after an unfinished one, stops here.
      const claimed = await page.evaluate(busy => { if (globalThis[busy]) return false; globalThis[busy] = true; return true; }, BUSY);
      if (!claimed) throw new Error('An axe run is active on this page, or an earlier one did not finish. Use a new page.');
      try {
        await page.evaluate(source);
        const raw = await page.evaluate(async runTags => {
          if (typeof globalThis.axe?.run !== 'function') throw new Error('axe did not load in the page.');
          for (const tag of runTags ?? []) if (globalThis.axe.getRules([tag]).length === 0) throw new Error(`No axe rule has the tag ${tag}.`);
          return globalThis.axe.run(document, runTags ? { runOnly: { type: 'tag', values: runTags } } : {});
        }, tags ?? null);
        return reduceAxeResults(raw);
      } finally {
        // Only the run that claimed the page releases it. After a timeout the page stays claimed.
        if (!timedOut) await page.evaluate(busy => { delete globalThis[busy]; }, BUSY).catch(() => {});
      }
    })();
    run.catch(() => {}); // a late failure after a timeout is not an unhandled rejection
    return await Promise.race([run, new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error(`axe did not finish in ${timeoutMs} ms. Do not reuse this page.`)); }, timeoutMs); })]);
  } catch (error) {
    return gapArtifact('failed', error?.message ?? error);
  } finally {
    clearTimeout(timer);
  }
}
