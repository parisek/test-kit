// Thin runner. It injects axe-core into a Playwright page and returns a stored `a11y` artifact.
// axe-core is an optional peer dependency. This file is the only place that reads it.
// It never throws for a bad run or bad options. It returns a `missing` or `failed` artifact (R8.7).
//
// Limits:
// - Frames: axe goes into frames of the page origin and about:blank / srcdoc frames below them, never into another origin (R13.51).
//   A frame that axe cannot enter is counted in `frames.unreachable`. The busy claim stays per page: the top document holds it.
// - After a timeout, axe may still run on the page. Do not reuse that page. A second run on it returns `failed`.
// - Axe runs inside the page. A hostile page can replace `window.axe` and fake a clean result. Run it on pages you control.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { reduceAxeResults, gapArtifact } from './axe.js';
import { classifyFrames, originOf, MAX_FRAMES } from './frames.js';

const require = createRequire(import.meta.url);
const DEFAULT_TIMEOUT_MS = 30000;
const BUSY = '__testKitAxeBusy';
// The mark name is random for each run, so a page attribute of any fixed name is never touched.
const newSkipAttr = () => `data-test-kit-axe-skip-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
// Axe waits this long for a frame that does not answer. The default is 60 s, longer than the run timeout.
const FRAME_WAIT_MS = 5000;
const isPlain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));

// Gives axe to each frame of the page origin and to about:blank / srcdoc frames below them. Never to another origin (R13.51).
// A frame whose own origin differs from the page origin at injection time, or where the injection throws, counts as unreachable. A frame of another origin is excluded from the run by an attribute on its element.
async function injectFrames(page, source) {
  const children = page.frames().filter(frame => frame !== page.mainFrame());
  const parents = children.map(frame => (frame.parentFrame() === page.mainFrame() ? -1 : children.indexOf(frame.parentFrame())));
  const urls = children.map(frame => frame.url());
  const topOrigin = originOf(page.url());
  const plan = classifyFrames(page.url(), children.map((frame, index) => ({ url: urls[index], parent: parents[index], detached: frame.isDetached() })));
  const ok = [];
  for (let index = 0; index < children.length; index += 1) {
    let done = false;
    if (plan.reachable[index] && (parents[index] === -1 || ok[parents[index]])) {
      // One string evaluation. Its first statement reads the origin of the frame itself, so a frame that navigated after the URL
      // snapshot, or that has an opaque origin (sandbox without allow-same-origin), throws before axe loads. Any throw means unreachable.
      try {
        if (children[index].url() !== urls[index]) throw new Error('TEST_KIT_FRAME_MOVED');
        await children[index].evaluate(`if (self.origin !== ${JSON.stringify(topOrigin)}) throw new Error('TEST_KIT_FRAME_ORIGIN');\n${source}`);
        done = true;
      } catch { done = false; }
    }
    ok.push(done);
  }
  const attr = newSkipAttr();
  const marked = [];
  // Frames beyond the bound stay unmarked (they count as unreachable) so a huge page costs a bounded number of calls.
  for (let index = 0; index < Math.min(children.length, MAX_FRAMES); index += 1) {
    if (ok[index] || (parents[index] !== -1 && !ok[parents[index]])) continue; // only the top-most frame that axe skips
    try {
      const element = await children[index].frameElement();
      await element.evaluate((node, attr) => node.setAttribute(attr, ''), attr);
      marked.push(element);
    } catch { /* a detached frame has no element */ }
  }
  const injected = ok.filter(Boolean).length;
  return { frames: { injected, unreachable: children.length - injected }, marked, attr };
}

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
        const { frames, marked, attr } = await injectFrames(page, source);
        try {
          const raw = await page.evaluate(async ({ runTags, attr, wait }) => {
            if (typeof globalThis.axe?.run !== 'function') throw new Error('axe did not load in the page.');
            for (const tag of runTags ?? []) if (globalThis.axe.getRules([tag]).length === 0) throw new Error(`No axe rule has the tag ${tag}.`);
            const options = { frameWaitTime: wait, ...(runTags ? { runOnly: { type: 'tag', values: runTags } } : {}) };
            return globalThis.axe.run({ exclude: [[`[${attr}]`]] }, options);
          }, { runTags: tags ?? null, attr, wait: FRAME_WAIT_MS });
          return reduceAxeResults(raw, frames);
        } finally {
          for (const element of marked) await element.evaluate((node, attr) => node.removeAttribute(attr), attr).catch(() => {});
        }
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
